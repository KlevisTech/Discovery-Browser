using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Discovery.GoogleAuth;

internal static class GoogleAuthProgram
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try { Application.Run(new GoogleSignInForm(ParseArguments(args))); }
        catch (Exception error)
        {
            Console.Error.WriteLine($"WebView2 sign-in failed: {error}");
            Environment.ExitCode = 1;
        }
    }

    private static Dictionary<string, string> ParseArguments(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal)) continue;
            var key = args[index][2..];
            var value = index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal)
                ? args[++index]
                : "true";
            values[key] = value;
        }
        return values;
    }
}

internal sealed class GoogleSignInForm : Form
{
    private const string ResultMarker = "DISCOVERY_AUTH_RESULT:";
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly Button completeButton = new()
    {
        Text = "Use this signed-in session",
        AutoSize = true,
        Enabled = false,
        Padding = new Padding(12, 5, 12, 5),
        Margin = new Padding(8),
    };
    private readonly Label statusLabel = new()
    {
        Text = "Complete Google sign-in, then use the signed-in session.",
        AutoSize = true,
        Padding = new Padding(12, 13, 8, 8),
    };
    private readonly string profilePath;
    private readonly string startUrl;
    private readonly bool exportOnly;
    private bool exportStarted;
    private bool resultSent;

    public GoogleSignInForm(IReadOnlyDictionary<string, string> arguments)
    {
        profilePath = arguments.TryGetValue("profile", out var profile) && !string.IsNullOrWhiteSpace(profile)
            ? Path.GetFullPath(profile)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Discovery Browser", "WebView2GoogleAuth");
        startUrl = arguments.TryGetValue("url", out var url) && IsHttpUrl(url)
            ? url
            : "https://www.google.com/";
        exportOnly = arguments.ContainsKey("export-only");

        Text = "Google Sign In — Discovery Browser";
        Width = 1120;
        Height = 800;
        MinimumSize = new Size(820, 620);
        StartPosition = FormStartPosition.CenterScreen;
        if (exportOnly)
        {
            ShowInTaskbar = false;
            Opacity = 0;
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            WindowState = FormWindowState.Minimized;
            Size = new Size(1, 1);
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
        }

        var toolbar = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 58,
            ColumnCount = 2,
            RowCount = 1,
            BackColor = Color.FromArgb(245, 247, 250),
        };
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        toolbar.Controls.Add(statusLabel, 0, 0);
        toolbar.Controls.Add(completeButton, 1, 0);
        Controls.Add(browser);
        Controls.Add(toolbar);

        completeButton.Click += CompleteButton_Click;
        Shown += async (_, _) => await InitializeBrowserAsync();
        FormClosing += (_, _) => { if (!resultSent && Environment.ExitCode == 0) Environment.ExitCode = 2; };
    }

    private static bool IsHttpUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);

    private async Task InitializeBrowserAsync()
    {
        Directory.CreateDirectory(profilePath);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profilePath);
        await browser.EnsureCoreWebView2Async(environment);
        browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
        browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        browser.CoreWebView2.Settings.IsStatusBarEnabled = true;
        browser.CoreWebView2.NavigationCompleted += async (_, _) =>
        {
            UpdateCompletionState();
            if (!exportOnly || exportStarted || resultSent) return;
            if (!Uri.TryCreate(browser.Source?.ToString(), UriKind.Absolute, out var current)) return;
            if (current.Host.Equals("accounts.google.com", StringComparison.OrdinalIgnoreCase)
                || current.Host.Equals("accounts.youtube.com", StringComparison.OrdinalIgnoreCase)) return;
            exportStarted = true;
            await Task.Delay(2500);
            await ExportSessionAndCloseAsync(interactive: false);
        };
        browser.CoreWebView2.SourceChanged += (_, _) => UpdateCompletionState();
        browser.CoreWebView2.DocumentTitleChanged += (_, _) =>
        {
            var title = browser.CoreWebView2.DocumentTitle;
            Text = string.IsNullOrWhiteSpace(title) ? "Google Sign In — Discovery Browser" : $"{title} — Discovery Browser";
        };
        browser.CoreWebView2.Navigate(startUrl);
    }

    private void UpdateCompletionState()
    {
        if (!Uri.TryCreate(browser.Source?.ToString(), UriKind.Absolute, out var current)) return;
        var isAccountPage = current.Host.Equals("accounts.google.com", StringComparison.OrdinalIgnoreCase)
            || current.Host.Equals("accounts.youtube.com", StringComparison.OrdinalIgnoreCase);
        completeButton.Enabled = !isAccountPage && IsHttpUrl(current.ToString());
        statusLabel.Text = isAccountPage
            ? "Complete Google sign-in in this secure Microsoft Edge window."
            : "When the destination site shows you as signed in, use this session.";
    }

    private async void CompleteButton_Click(object? sender, EventArgs e)
    {
        await ExportSessionAndCloseAsync(interactive: true);
    }

    private async Task ExportSessionAndCloseAsync(bool interactive)
    {
        completeButton.Enabled = false;
        if (interactive) statusLabel.Text = "Transferring the signed-in session to Discovery Browser...";
        try
        {
            var cookies = await CollectCookiesAsync();
            if (!HasAuthenticatedGoogleCookie(cookies))
            {
                if (interactive)
                {
                    statusLabel.Text = "Google does not appear signed in yet. Finish signing in and try again.";
                    completeButton.Enabled = true;
                    return;
                }
                Environment.ExitCode = 3;
                Close();
                return;
            }
            var finalUrl = browser.Source?.ToString() ?? startUrl;
            var result = JsonSerializer.Serialize(new AuthResult(true, finalUrl, cookies));
            Console.Out.WriteLine(ResultMarker + Convert.ToBase64String(Encoding.UTF8.GetBytes(result)));
            Console.Out.Flush();
            resultSent = true;
            Environment.ExitCode = 0;
            Close();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Cookie transfer failed: {error}");
            if (interactive)
            {
                statusLabel.Text = "Discovery could not transfer this session. Please try again.";
                completeButton.Enabled = true;
            }
            else
            {
                Environment.ExitCode = 1;
                Close();
            }
        }
    }

    private async Task<List<AuthCookie>> CollectCookiesAsync()
    {
        var sources = new[]
        {
            startUrl,
            browser.Source?.ToString() ?? startUrl,
            "https://www.youtube.com/",
            "https://accounts.google.com/",
            "https://www.google.com/",
        }.Where(IsHttpUrl).Distinct(StringComparer.OrdinalIgnoreCase);
        var collected = new Dictionary<string, AuthCookie>(StringComparer.Ordinal);
        foreach (var source in sources)
        {
            foreach (var cookie in await browser.CoreWebView2.CookieManager.GetCookiesAsync(source))
            {
                var model = new AuthCookie(cookie.Name, cookie.Value, cookie.Domain,
                    string.IsNullOrWhiteSpace(cookie.Path) ? "/" : cookie.Path,
                    cookie.IsSecure, cookie.IsHttpOnly,
                    cookie.IsSession ? null : new DateTimeOffset(cookie.Expires).ToUnixTimeSeconds(),
                    cookie.SameSite.ToString());
                collected[$"{model.Domain}\n{model.Path}\n{model.Name}"] = model;
            }
        }
        return collected.Values.ToList();
    }

    private static bool HasAuthenticatedGoogleCookie(IEnumerable<AuthCookie> cookies)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO" };
        return cookies.Any(cookie => names.Contains(cookie.Name));
    }
}

internal sealed record AuthResult(bool Success, string FinalUrl, IReadOnlyList<AuthCookie> Cookies);
internal sealed record AuthCookie(string Name, string Value, string Domain, string Path,
    bool Secure, bool HttpOnly, long? ExpirationDate, string SameSite);
