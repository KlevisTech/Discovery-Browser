const { app, dialog, session, webContents } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULT_MARKER = 'DISCOVERY_AUTH_RESULT:';

function createYouTubeWebView2Auth({ isGoogleAuthSensitiveUrl, isYouTubeUrl, getMainWindow }) {
  let activeProcess = null;

  function shouldHandle(authUrl, context = {}) {
    if (process.platform !== 'win32' || !isGoogleAuthSensitiveUrl(authUrl)) return false;
    if ([context.sourceUrl, context.referrerUrl].some((candidate) => isYouTubeUrl(candidate))) return true;
    return /(?:youtube\.com|youtu\.be|service=youtube)/i.test(String(authUrl || ''));
  }

  function executablePath() {
    const root = app.isPackaged ? process.resourcesPath : __dirname;
    return path.join(root, 'webview2-auth', app.isPackaged ? '' : 'publish', 'Discovery.YouTubeAuth.exe');
  }

  function showError(message) {
    try {
      dialog.showMessageBox(getMainWindow() || undefined, {
        type: 'error',
        title: 'YouTube Sign In',
        message: 'Discovery Browser could not complete YouTube sign-in.',
        detail: String(message || 'The WebView2 sign-in helper failed.'),
        buttons: ['OK'],
        noLink: true,
      });
    } catch (e) { }
  }

  function isAllowedDomain(domain) {
    const host = String(domain || '').trim().replace(/^\./, '').toLowerCase();
    return host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'google.com'
      || host.endsWith('.google.com');
  }

  function sameSite(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'strict') return 'strict';
    if (normalized === 'lax') return 'lax';
    if (normalized === 'none') return 'no_restriction';
    return 'unspecified';
  }

  async function importCookies(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0 || cookies.length > 500) {
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
        if (!name || name.length > 512 || value.length > 16384 || !isAllowedDomain(domain)) continue;
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
          sameSite: sameSite(cookie.SameSite),
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
          // One browser-specific cookie should not block the remaining session.
          console.warn(`[YouTube WebView2 Auth] Skipped incompatible cookie in partition ${partitionName}:`, name, error && error.message ? error.message : error);
        }
      }
      try { await targetSession.cookies.flushStore(); } catch (e) { }
    }
    if (totalImported === 0) throw new Error('No valid YouTube sign-in cookies were returned.');
  }

  function refreshYouTube() {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents || contents.isDestroyed()) continue;
      try {
        if (isYouTubeUrl(contents.getURL())) contents.reload();
      } catch (e) { }
    }
  }

  function start(authUrl, context = {}) {
    if (!shouldHandle(authUrl, context)) return false;
    if (activeProcess && !activeProcess.killed) return true;
    const helperPath = executablePath();
    if (!fs.existsSync(helperPath)) {
      showError('The WebView2 sign-in component is missing. Reinstall Discovery Browser or run npm run build:auth.');
      return true;
    }

    const sourceUrl = [context.sourceUrl, context.referrerUrl].find((candidate) => isYouTubeUrl(candidate)) || 'https://www.youtube.com/';
    const profilePath = path.join(app.getPath('userData'), 'WebView2YouTubeAuth');
    const child = spawn(helperPath, ['--profile', profilePath, '--url', sourceUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    activeProcess = child;
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-2 * 1024 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-64 * 1024); });
    child.on('error', (error) => {
      if (activeProcess === child) activeProcess = null;
      showError(error.message);
    });
    child.on('close', async (code) => {
      if (activeProcess === child) activeProcess = null;
      if (code === 2) return;
      try {
        const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_MARKER));
        if (!resultLine) throw new Error(stderr.trim() || `The sign-in helper exited with code ${code}.`);
        const decoded = Buffer.from(resultLine.slice(RESULT_MARKER.length), 'base64').toString('utf8');
        const result = JSON.parse(decoded);
        if (!result || result.Success !== true) throw new Error('The sign-in helper did not return a successful session.');
        await importCookies(result.Cookies);
        refreshYouTube();
      } catch (error) {
        showError(error && error.message ? error.message : error);
      } finally {
        stdout = '';
        stderr = '';
      }
    });
    return true;
  }

  function stop() {
    if (!activeProcess || activeProcess.killed) return;
    try { activeProcess.kill(); } catch (e) { }
    activeProcess = null;
  }

  return { shouldHandle, start, stop };
}

module.exports = { createYouTubeWebView2Auth };
