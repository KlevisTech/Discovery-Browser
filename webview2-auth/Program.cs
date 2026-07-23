using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Discovery.YouTubeAuth;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try
        {
            Application.Run(new SignInForm(ParseArguments(args)));
        }
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

internal sealed class SignInForm : Form
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
        Text = "Sign in to YouTube, then select ‘Use this signed-in session’.",
        AutoSize = true,
        Padding = new Padding(12, 13, 8, 8),
    };
    private readonly string profilePath;
    private readonly string startUrl;
    private bool resultSent;

    public SignInForm(IReadOnlyDictionary<string, string> arguments)
    {
        profilePath = arguments.TryGetValue("profile", out var profile) && !string.IsNullOrWhiteSpace(profile)
            ? Path.GetFullPath(profile)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Discovery Browser", "WebView2YouTubeAuth");
        startUrl = arguments.TryGetValue("url", out var url) && Uri.TryCreate(url, UriKind.Absolute, out _)
            ? url
            : "https://www.youtube.com/";

        Text = "YouTube Sign In — Discovery Browser";
        Width = 1120;
        Height = 800;
        MinimumSize = new Size(820, 620);
        StartPosition = FormStartPosition.CenterScreen;

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
        FormClosing += (_, _) =>
        {
            if (!resultSent) Environment.ExitCode = 2;
        };
    }

    private async Task InitializeBrowserAsync()
    {
        Directory.CreateDirectory(profilePath);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profilePath);
        await browser.EnsureCoreWebView2Async(environment);
        browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
        browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        browser.CoreWebView2.Settings.IsStatusBarEnabled = true;
        browser.CoreWebView2.NavigationCompleted += (_, _) => UpdateCompletionState();
        browser.CoreWebView2.SourceChanged += (_, _) => UpdateCompletionState();
        browser.CoreWebView2.DocumentTitleChanged += (_, _) =>
        {
            var pageTitle = browser.CoreWebView2.DocumentTitle;
            Text = string.IsNullOrWhiteSpace(pageTitle)
                ? "YouTube Sign In — Discovery Browser"
                : $"{pageTitle} — Discovery Browser";
        };
        browser.CoreWebView2.Navigate(startUrl);
    }

    private void UpdateCompletionState()
    {
        if (!Uri.TryCreate(browser.Source?.ToString(), UriKind.Absolute, out var current)) return;
        var isYouTube = current.Host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase)
            || current.Host.EndsWith(".youtube.com", StringComparison.OrdinalIgnoreCase);
        completeButton.Enabled = isYouTube;
        statusLabel.Text = isYouTube
            ? "When your YouTube avatar appears, use this signed-in session."
            : "Complete Google sign-in in this secure Microsoft Edge window.";
    }

    private async void CompleteButton_Click(object? sender, EventArgs e)
    {
        completeButton.Enabled = false;
        statusLabel.Text = "Transferring the signed-in session to Discovery Browser…";
        try
        {
            var cookies = await CollectCookiesAsync();
            if (!HasAuthenticatedYouTubeCookie(cookies))
            {
                statusLabel.Text = "YouTube does not appear signed in yet. Finish signing in and try again.";
                completeButton.Enabled = true;
                return;
            }

            var result = JsonSerializer.Serialize(new AuthResult(true, cookies));
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(result));
            Console.Out.WriteLine(ResultMarker + encoded);
            Console.Out.Flush();
            resultSent = true;
            Environment.ExitCode = 0;
            Close();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Cookie transfer failed: {error}");
            statusLabel.Text = "Discovery could not transfer this session. Please try again.";
            completeButton.Enabled = true;
        }
    }

    private async Task<List<AuthCookie>> CollectCookiesAsync()
    {
        var manager = browser.CoreWebView2.CookieManager;
        var sources = new[]
        {
            "https://www.youtube.com/",
            "https://accounts.google.com/",
            "https://www.google.com/",
        };
        var collected = new Dictionary<string, AuthCookie>(StringComparer.Ordinal);
        foreach (var source in sources)
        {
            foreach (var cookie in await manager.GetCookiesAsync(source))
            {
                if (!IsAllowedDomain(cookie.Domain)) continue;
                var model = new AuthCookie(
                    cookie.Name,
                    cookie.Value,
                    cookie.Domain,
                    string.IsNullOrWhiteSpace(cookie.Path) ? "/" : cookie.Path,
                    cookie.IsSecure,
                    cookie.IsHttpOnly,
                    cookie.IsSession ? null : new DateTimeOffset(cookie.Expires).ToUnixTimeSeconds(),
                    cookie.SameSite.ToString());
                collected[$"{model.Domain}\n{model.Path}\n{model.Name}"] = model;
            }
        }
        return collected.Values.ToList();
    }

    private static bool IsAllowedDomain(string domain)
    {
        var host = domain.TrimStart('.');
        return host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".youtube.com", StringComparison.OrdinalIgnoreCase)
            || host.Equals("google.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".google.com", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasAuthenticatedYouTubeCookie(IEnumerable<AuthCookie> cookies)
    {
        var authenticatedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO"
        };
        return cookies.Any(cookie => authenticatedNames.Contains(cookie.Name));
    }
}

internal sealed record AuthResult(bool Success, IReadOnlyList<AuthCookie> Cookies);
internal sealed record AuthCookie(
    string Name,
    string Value,
    string Domain,
    string Path,
    bool Secure,
    bool HttpOnly,
    long? ExpirationDate,
    string SameSite);
