const { app, dialog, session, webContents } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULT_MARKER = 'DISCOVERY_AUTH_RESULT:';

function createGoogleWebView2Auth({ isGoogleAuthSensitiveUrl, isGoogleAuthIntentUrl, getMainWindow }) {
  let activeProcess = null;
  let syncProcess = null;
  let syncStartTimer = null;
  let syncInterval = null;

  function shouldHandle(authUrl) {
    return process.platform === 'win32' && (isGoogleAuthSensitiveUrl(authUrl) || isGoogleAuthIntentUrl(authUrl));
  }

  function isHttpUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(String(value || '')).protocol); }
    catch (e) { return false; }
  }

  function helperPath() {
    const root = app.isPackaged ? process.resourcesPath : __dirname;
    return path.join(root, 'webview2-auth', app.isPackaged ? '' : 'publish', 'Discovery.YouTubeAuth.exe');
  }

  function showError(message) {
    try {
      dialog.showMessageBox(getMainWindow() || undefined, {
        type: 'error', title: 'Google Sign In',
        message: 'Discovery Browser could not complete Google sign-in.',
        detail: String(message || 'The WebView2 sign-in helper failed.'),
        buttons: ['OK'], noLink: true,
      });
    } catch (e) { }
  }

  function hostname(value) {
    try { return new URL(String(value || '')).hostname.toLowerCase(); }
    catch (e) { return ''; }
  }

  function domainMatchesHost(domain, host) {
    const normalizedDomain = String(domain || '').trim().replace(/^\./, '').toLowerCase();
    const normalizedHost = String(host || '').trim().toLowerCase();
    return !!normalizedDomain && !!normalizedHost
      && (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`));
  }

  function isGoogleDomain(domain) {
    return domainMatchesHost(domain, 'google.com')
      || domainMatchesHost(domain, 'www.google.com')
      || domainMatchesHost(domain, 'accounts.google.com')
      || domainMatchesHost(domain, 'youtube.com')
      || domainMatchesHost(domain, 'www.youtube.com');
  }

  function normalizedSameSite(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'strict') return 'strict';
    if (normalized === 'lax') return 'lax';
    if (normalized === 'none') return 'no_restriction';
    return 'unspecified';
  }

  async function importCookies(cookies, allowedHosts) {
    if (!Array.isArray(cookies) || cookies.length === 0 || cookies.length > 750) {
      throw new Error('The WebView2 helper returned an invalid cookie set.');
    }
    const partitions = ['persist:webview', 'persist:cards'];
    let totalImported = 0;
    for (const partitionName of partitions) {
      const targetSession = session.fromPartition(partitionName);
      let importedForPartition = 0;
      for (const cookie of cookies) {
        const name = String(cookie && cookie.Name || '');
        const value = String(cookie && cookie.Value || '');
        const domain = String(cookie && cookie.Domain || '');
        const allowed = isGoogleDomain(domain) || allowedHosts.some((host) => domainMatchesHost(domain, host));
        if (!allowed || !name || name.length > 512 || value.length > 16384) continue;
        const host = domain.replace(/^\./, '');
        const isHostPrefixed = name.startsWith('__Host-');
        const isSecurePrefixed = name.startsWith('__Secure-');
        const cookiePath = isHostPrefixed ? '/' : String(cookie.Path || '/');
        const secure = isHostPrefixed || isSecurePrefixed || cookie.Secure !== false;
        const details = {
          url: `${secure ? 'https' : 'http'}://${host}${cookiePath.startsWith('/') ? cookiePath : '/'}`,
          name,
          value,
          path: cookiePath,
          secure,
          httpOnly: cookie.HttpOnly === true,
          sameSite: normalizedSameSite(cookie.SameSite),
        };
        // Chromium requires __Host- cookies to be host-only, so Domain must be omitted.
        if (!isHostPrefixed) details.domain = domain;
        const expirationDate = Number(cookie.ExpirationDate);
        if (Number.isFinite(expirationDate) && expirationDate > 0) {
          details.expirationDate = expirationDate;
        } else {
          // Force session cookies to be persistent by setting an expiration date in the future (1 year)
          details.expirationDate = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
        }
        try {
          await targetSession.cookies.set(details);
          importedForPartition += 1;
          totalImported += 1;
        } catch (error) {
          console.warn(`[Google WebView2 Auth] Skipped incompatible cookie in partition ${partitionName}:`, name, error && error.message ? error.message : error);
        }
      }
      try { await targetSession.cookies.flushStore(); } catch (e) { }
    }
    if (totalImported === 0) throw new Error('No valid Google or site sign-in cookies were returned.');
  }

  function refreshAffectedPages(allowedHosts) {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents || contents.isDestroyed()) continue;
      try {
        const currentHost = hostname(contents.getURL());
        if (allowedHosts.some((host) => currentHost === host || currentHost.endsWith(`.${host}`) || host.endsWith(`.${currentHost}`))) {
          contents.reload();
        }
      } catch (e) { }
    }
  }

  function start(authUrl, context = {}) {
    if (!shouldHandle(authUrl)) return false;
    if (activeProcess && !activeProcess.killed) return true;
    const executable = helperPath();
    if (!fs.existsSync(executable)) {
      showError('The WebView2 sign-in component is missing. Reinstall Discovery Browser or run npm run build:auth.');
      return true;
    }

    const sourceUrl = [context.sourceUrl, context.referrerUrl].find((candidate) => isHttpUrl(candidate) && !isGoogleAuthSensitiveUrl(candidate));
    const launchUrl = isHttpUrl(authUrl) && !isGoogleAuthSensitiveUrl(authUrl)
      ? authUrl
      : (sourceUrl || (isHttpUrl(authUrl) ? authUrl : 'https://www.google.com/'));
    const sourceHost = hostname(sourceUrl || launchUrl);
    const profilePath = path.join(app.getPath('userData'), 'WebView2YouTubeAuth');
    const child = spawn(executable, ['--profile', profilePath, '--url', launchUrl], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
    });
    activeProcess = child;
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-3 * 1024 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64 * 1024); });
    child.on('error', (error) => {
      if (activeProcess === child) activeProcess = null;
      showError(error.message);
    });
    child.on('close', async (code) => {
      if (activeProcess === child) activeProcess = null;
      if (code === 2) return;
      try {
        const line = stdout.split(/\r?\n/).find((value) => value.startsWith(RESULT_MARKER));
        if (!line) throw new Error(stderr.trim() || `The sign-in helper exited with code ${code}.`);
        const result = JSON.parse(Buffer.from(line.slice(RESULT_MARKER.length), 'base64').toString('utf8'));
        if (!result || result.Success !== true) throw new Error('The sign-in helper did not return a successful session.');
        const finalHost = hostname(result.FinalUrl);
        const allowedHosts = Array.from(new Set([sourceHost, finalHost, 'google.com', 'youtube.com'].filter(Boolean)));
        await importCookies(result.Cookies, allowedHosts);
        refreshAffectedPages(allowedHosts);
      } catch (error) {
        showError(error && error.message ? error.message : error);
      } finally {
        stdout = '';
        stderr = '';
      }
    });
    return true;
  }

  function syncPersistedSession() {
    if (process.platform !== 'win32' || syncProcess || activeProcess) return;
    const executable = helperPath();
    if (!fs.existsSync(executable)) return;

    const profilePath = path.join(app.getPath('userData'), 'WebView2YouTubeAuth');
    const child = spawn(executable, [
      '--profile', profilePath,
      // Visit Google itself so its rotating account cookies are renewed;
      // YouTube cookies are still collected from the shared WebView2 profile.
      '--url', 'https://www.google.com/',
      '--export-only',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    syncProcess = child;
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-3 * 1024 * 1024); });
    child.on('error', () => { if (syncProcess === child) syncProcess = null; });
    child.on('close', async (code) => {
      if (syncProcess === child) syncProcess = null;
      if (code !== 0) return;
      try {
        const line = stdout.split(/\r?\n/).find((value) => value.startsWith(RESULT_MARKER));
        if (!line) return;
        const result = JSON.parse(Buffer.from(line.slice(RESULT_MARKER.length), 'base64').toString('utf8'));
        if (!result || result.Success !== true) return;
        await importCookies(result.Cookies, ['google.com', 'youtube.com']);
        // Do not reload open pages here: updated cookies apply to future requests.
      } catch (error) {
        console.warn('[Google WebView2 Auth] Silent session refresh failed:', error && error.message ? error.message : error);
      } finally {
        stdout = '';
      }
    });
  }

  function startSessionSync() {
    if (syncStartTimer || syncInterval) return;
    syncStartTimer = setTimeout(() => {
      syncStartTimer = null;
      syncPersistedSession();
      syncInterval = setInterval(syncPersistedSession, 60 * 60 * 1000);
      if (syncInterval && typeof syncInterval.unref === 'function') syncInterval.unref();
    }, 8000);
    if (syncStartTimer && typeof syncStartTimer.unref === 'function') syncStartTimer.unref();
  }

  function stop() {
    if (syncStartTimer) clearTimeout(syncStartTimer);
    if (syncInterval) clearInterval(syncInterval);
    syncStartTimer = null;
    syncInterval = null;
    if (syncProcess && !syncProcess.killed) {
      try { syncProcess.kill(); } catch (e) { }
    }
    syncProcess = null;
    if (activeProcess && !activeProcess.killed) {
      try { activeProcess.kill(); } catch (e) { }
    }
    activeProcess = null;
  }

  return { shouldHandle, start, startSessionSync, syncPersistedSession, stop };
}

module.exports = { createGoogleWebView2Auth };
