// main.js
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { Menu, MenuItem } = require('electron');
const APP_ICON_PATH = path.join(__dirname, 'assets', 'discoverybrowser.ico');

function dirLooksLikeBrowserProfile(dirPath) {
  if (!dirPath) return false;
  try {
    const checks = [
      path.join(dirPath, 'Partitions', 'webview'),
      path.join(dirPath, 'Partitions', 'cards'),
      path.join(dirPath, 'Network'),
      path.join(dirPath, 'Cookies'),
      path.join(dirPath, 'Local Storage'),
    ];
    return checks.some((candidate) => fs.existsSync(candidate));
  } catch (e) {
    return false;
  }
}

function pickStableUserDataPath() {
  let appDataPath = '';
  let defaultUserData = '';
  try {
    appDataPath = app.getPath('appData');
    defaultUserData = app.getPath('userData');
  } catch (e) {
    return '';
  }
  if (!appDataPath) return defaultUserData || '';

  const preferred = path.join(appDataPath, 'Discovery Browser');
  const candidates = [
    preferred,
    defaultUserData,
    path.join(appDataPath, 'discovery-browser'),
    path.join(appDataPath, 'Discovery Web'),
    path.join(appDataPath, 'DiscoveryWeb'),
  ].filter(Boolean);

  let bestPath = preferred;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    let score = 0;
    if (dirLooksLikeBrowserProfile(candidate)) score += 100;
    try {
      const stat = fs.statSync(candidate);
      const modifiedAt = stat && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
      score += Math.floor(modifiedAt / 1000);
    } catch (e) { }
    if (score > bestScore) {
      bestScore = score;
      bestPath = candidate;
    }
  }

  return bestPath || preferred;
}

try {
  const stableUserDataPath = pickStableUserDataPath();
  if (stableUserDataPath) {
    app.setPath('userData', stableUserDataPath);
    console.log(`[Storage] Using userData path: ${stableUserDataPath}`);
  }
} catch (e) {
  console.warn('[Storage] Failed to set stable userData path:', e && e.message ? e.message : e);
}
const WINDOW_HANG_RECOVERY_COOLDOWN_MS = 20000;
const WINDOW_HANG_FORCE_RELOAD_MS = 8000;
const WINDOW_HANG_CARD_GRACE_MS = 15000; // Reduced grace period for card loads
const WINDOW_HANG_NETWORK_SUPPRESS_MS = 120000;
const WINDOW_HANG_BURST_WINDOW_MS = 180000;
const WINDOW_HANG_BURST_LIMIT = 2;
const WINDOW_HANG_FORCE_CRASH_COOLDOWN_MS = 180000;
const CARD_LOAD_TIMEOUT_MS = 25000; // Maximum time to wait for card to load before timeout
const hangRecoveryAttachedWindows = new WeakSet();
const hangRecoveryWindowState = new WeakMap();
const cardLoadTimeouts = new WeakMap(); // Store load timeout timers per window

function isLikelyNetworkLoadFailure(errorCode, errorDescription) {
  const code = Number(errorCode);
  const desc = String(errorDescription || '').toUpperCase();
  if (desc.includes('INTERNET') || desc.includes('NETWORK') ||
    desc.includes('CONNECTION') || desc.includes('TIMED OUT') ||
    desc.includes('DNS') || desc.includes('ADDRESS') || desc.includes('REACHABLE') ||
    desc.includes('RESET') || desc.includes('DISCONNECTED')) {
    return true;
  }
  const networkCodes = new Set([
    -2,   // ERR_NAME_NOT_RESOLVED
    // -3 is ERR_ABORTED (usually navigation cancellation), not a connectivity loss.
    -6,   // ERR_CONNECTION_FAILED
    -7,   // ERR_CONNECTION_TIMED_OUT
    -17,  // ERR_INTERNET_DISCONNECTED
    -101, // ERR_CONNECTION_RESET
    -105, // ERR_NAME_NOT_RESOLVED
    -118, // ERR_CONNECTION_TIMED_OUT
    -109, // ERR_ADDRESS_UNREACHABLE
    -200  // ERR_NETWORK_ACCESS_DENIED
  ]);
  return networkCodes.has(code);
}

function triggerWindowHangRecovery(win, windowLabel, reason) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;

  const state = hangRecoveryWindowState.get(win);
  if (!state) return;
  const isCardLikeWindow = String(windowLabel || '').startsWith('card-') ||
    String(windowLabel || '').startsWith('direct-card-') ||
    String(windowLabel || '').startsWith('prewarmed-card');
  if (isCardLikeWindow && reason === 'window-event') {
    // Do not auto-reload card windows on transient unresponsive spikes.
    // Heavy streaming pages can recover on their own; forced reloads make UX worse.
    console.warn(`[HangRecovery] ${windowLabel} unresponsive event observed; waiting for renderer recovery.`);
    return;
  }

  const now = Date.now();
  if (state.lastNetworkFailureAt > 0 && (now - state.lastNetworkFailureAt) < WINDOW_HANG_NETWORK_SUPPRESS_MS) {
    console.warn(`[HangRecovery] ${windowLabel} recovery suppressed after recent network load failure.`);
    return;
  }

  state.recoveryAttempts = state.recoveryAttempts.filter((ts) => (now - ts) < WINDOW_HANG_BURST_WINDOW_MS);
  if (isCardLikeWindow && state.recoveryAttempts.length >= WINDOW_HANG_BURST_LIMIT) {
    console.warn(`[HangRecovery] ${windowLabel} recovery suppressed to avoid restart loop.`);
    return;
  }

  if ((now - state.lastRecoveryAt) < WINDOW_HANG_RECOVERY_COOLDOWN_MS) return;

  state.lastRecoveryAt = now;
  state.waitingForResponsive = true;
  state.recoveryAttempts.push(now);
  console.warn(`[HangRecovery] ${windowLabel} became unresponsive (${reason}). Attempting reload.`);

  try {
    if (wc.isLoadingMainFrame()) wc.stop();
  } catch (e) { }

  try {
    wc.reloadIgnoringCache();
  } catch (e) {
    try { wc.reload(); } catch (reloadErr) { }
  }

  if (state.forceReloadTimer) {
    clearTimeout(state.forceReloadTimer);
    state.forceReloadTimer = null;
  }

  state.forceReloadTimer = setTimeout(() => {
    if (!state.waitingForResponsive) return;
    if (!win || win.isDestroyed()) return;
    if (!win.webContents || win.webContents.isDestroyed()) return;
    const timerNow = Date.now();

    if (state.lastNetworkFailureAt > 0 && (timerNow - state.lastNetworkFailureAt) < WINDOW_HANG_NETWORK_SUPPRESS_MS) {
      state.waitingForResponsive = false;
      return;
    }

    if (isCardLikeWindow && (timerNow - state.lastForceCrashAt) < WINDOW_HANG_FORCE_CRASH_COOLDOWN_MS) {
      state.waitingForResponsive = false;
      console.warn(`[HangRecovery] ${windowLabel} skip force-crash (cooldown active).`);
      return;
    }

    console.warn(`[HangRecovery] ${windowLabel} still unresponsive. Forcing renderer restart.`);
    try {
      if (typeof win.webContents.forcefullyCrashRenderer === 'function') {
        win.webContents.forcefullyCrashRenderer();
        state.lastForceCrashAt = timerNow;
      }
    } catch (e) { }

    try {
      win.webContents.reloadIgnoringCache();
    } catch (e) {
      try { win.webContents.reload(); } catch (reloadErr) { }
    }
  }, WINDOW_HANG_FORCE_RELOAD_MS);
}

function attachWindowHangRecovery(win, windowLabel) {
  if (!win || win.isDestroyed()) return;
  if (hangRecoveryAttachedWindows.has(win)) return;
  hangRecoveryAttachedWindows.add(win);

  const state = {
    lastRecoveryAt: 0,
    waitingForResponsive: false,
    forceReloadTimer: null,
    unresponsiveTimer: null,
    recoveryAttempts: [],
    lastNetworkFailureAt: 0,
    lastForceCrashAt: 0,
  };
  hangRecoveryWindowState.set(win, state);

  const clearForceTimer = () => {
    if (!state.forceReloadTimer) return;
    clearTimeout(state.forceReloadTimer);
    state.forceReloadTimer = null;
  };

  const clearUnresponsiveTimer = () => {
    if (!state.unresponsiveTimer) return;
    clearTimeout(state.unresponsiveTimer);
    state.unresponsiveTimer = null;
  };

  const isCardLikeWindow = String(windowLabel || '').startsWith('card-') ||
    String(windowLabel || '').startsWith('direct-card-') ||
    String(windowLabel || '').startsWith('prewarmed-card');

  win.on('unresponsive', () => {
    if (!isCardLikeWindow) {
      triggerWindowHangRecovery(win, windowLabel, 'window-event');
      return;
    }
    // Keep card windows passive on unresponsive; avoid reload loops on heavy pages.
    triggerWindowHangRecovery(win, windowLabel, 'window-event');
  });

  win.on('responsive', () => {
    state.waitingForResponsive = false;
    clearForceTimer();
    clearUnresponsiveTimer();
    console.log(`[HangRecovery] ${windowLabel} recovered.`);
  });

  try {
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (!isLikelyNetworkLoadFailure(errorCode, errorDescription)) return;
      state.lastNetworkFailureAt = Date.now();
    });

    win.webContents.on('render-process-gone', (event, details) => {
      const reason = details && details.reason ? String(details.reason) : 'unknown';
      if (reason === 'unresponsive' || reason === 'crashed' || reason === 'abnormal') {
        triggerWindowHangRecovery(win, windowLabel, `render-process-gone:${reason}`);
      }
    });
  } catch (e) { }

  win.on('closed', () => {
    state.waitingForResponsive = false;
    clearForceTimer();
    clearUnresponsiveTimer();
    hangRecoveryWindowState.delete(win);
    hangRecoveryAttachedWindows.delete(win);
  });
}

// Setup load timeout for card windows to prevent indefinite loading with bad internet
function setupCardLoadTimeout(win, windowLabel) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;

  // Clear any existing timeout
  const existingTimer = cardLoadTimeouts.get(win);
  if (existingTimer) {
    clearTimeout(existingTimer);
    cardLoadTimeouts.delete(win);
  }

  // Set up a timeout to abort loading if it takes too long
  const loadTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) return;

    let isStillLoading = false;
    try {
      isStillLoading = wc.isLoading();
    } catch (e) { }

    if (isStillLoading) {
      console.warn(`[CardLoadTimeout] ${windowLabel} still loading after ${CARD_LOAD_TIMEOUT_MS}ms, forcing stop`);
      try {
        wc.stop();
      } catch (e) { }

      // Trigger recovery
      triggerWindowHangRecovery(win, windowLabel, 'load-timeout');
    }

    cardLoadTimeouts.delete(win);
  }, CARD_LOAD_TIMEOUT_MS);

  cardLoadTimeouts.set(win, loadTimer);
}

function clearCardLoadTimeout(win) {
  if (!win) return;
  const timer = cardLoadTimeouts.get(win);
  if (timer) {
    clearTimeout(timer);
    cardLoadTimeouts.delete(win);
  }
}

// GPU stability flags
// Keep GPU sandbox enabled by default. Allow disabling only in development for troubleshooting.
if (!app.isPackaged && process.env.DISCOVERY_DISABLE_GPU_SANDBOX === '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // Updated flag name (ignore-gpu-blacklist is deprecated)
app.commandLine.appendSwitch('use-angle', 'd3d11'); // Use D3D11 ANGLE backend for Windows stability
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder'); // Hardware video decode
// QUIC/HTTP3 can cause ERR_QUIC_PROTOCOL_ERROR in some environments.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-http3');
// Reduce automation fingerprints that can break bot challenges.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Avoid Private Access Token challenges that Electron can't complete.
app.commandLine.appendSwitch('disable-features', 'PrivateStateTokens,PrivacyPass');

// Network/DNS stability flags - help with slow DNS servers
// Use system DNS resolver with extended timeout for slow DNS servers
app.commandLine.appendSwitch('dns-resolver-timeout', '15000'); // Increase DNS timeout to 15 seconds

// Disable unnecessary features
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Reduce Chromium process stderr noise (for example repeated STUN DNS failures).
app.commandLine.appendSwitch('log-level', '3');

// Use a Chrome-like UA to improve compatibility with security challenges.
const chromeVersion = process.versions && process.versions.chrome ? process.versions.chrome : '120.0.0.0';
const CHROME_LIKE_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
const chromeMajor = (() => {
  const major = parseInt(String(chromeVersion).split('.')[0], 10);
  return Number.isFinite(major) && major > 0 ? major : 120;
})();
const CH_UA = `"Not A(Brand";v="99", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`;
try {
  app.userAgentFallback = CHROME_LIKE_UA;
} catch (e) { }
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.discovery.browser'); } catch (e) { }
}

// Increase max listeners to prevent memory leak warnings
require('events').EventEmitter.defaultMaxListeners = 50;

// Track which webContents have been initialized to prevent duplicate listeners
const initializedWebContents = new WeakSet();

// Function to create and show the context menu
app.on('web-contents-created', (event, contents) => {
  // Prevent adding duplicate listeners to the same webContents
  if (initializedWebContents.has(contents)) {
    return;
  }
  initializedWebContents.add(contents);

  // Set max listeners for this specific webContents to prevent warnings
  contents.setMaxListeners(20);

  // Ensure all new windows/popups become card windows with the same layout
  try {
    contents.setWindowOpenHandler(({ url }) => {
      openUrlInCard(url);
      return { action: 'deny' };
    });
  } catch (e) { }

  contents.on('context-menu', (e, props) => {
    const menu = new Menu();
    let hasItems = false;

    // Spelling suggestions for misspelled words.
    const misspelledWord = String((props && props.misspelledWord) || '').trim();
    const suggestions = Array.isArray(props && props.dictionarySuggestions)
      ? props.dictionarySuggestions.filter((s) => typeof s === 'string' && s.trim()).slice(0, 6)
      : [];
    if (misspelledWord) {
      if (suggestions.length > 0) {
        suggestions.forEach((word) => {
          menu.append(new MenuItem({
            label: word,
            click: () => {
              try { contents.replaceMisspelling(word); } catch (e) { }
            }
          }));
          hasItems = true;
        });
      } else {
        menu.append(new MenuItem({
          label: 'No Spelling Suggestions',
          enabled: false
        }));
        hasItems = true;
      }

      menu.append(new MenuItem({
        label: `Add "${misspelledWord}" to Dictionary`,
        click: () => {
          try {
            const targetSession = contents.session || session.defaultSession;
            if (targetSession && typeof targetSession.addWordToSpellCheckerDictionary === 'function') {
              targetSession.addWordToSpellCheckerDictionary(misspelledWord);
            }
          } catch (e) { }
        }
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      hasItems = true;
    }

    // Handle images - add Save Image and Copy Image URL options
    if (props && props.mediaType === 'image' && props.srcURL) {
      // Check if the image URL is downloadable (http/https)
      const imageUrl = props.srcURL;
      const isDownloadable = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');

      if (isDownloadable) {
        menu.append(new MenuItem({
          label: 'Save Image As...',
          click: () => {
            try {
              // Trigger download for the image
              const targetSession = contents.session || session.defaultSession;
              if (targetSession) {
                // Get filename from URL
                let filename = 'image';
                try {
                  const urlPath = new URL(imageUrl).pathname;
                  const pathParts = urlPath.split('/');
                  filename = pathParts[pathParts.length - 1] || 'image';
                  // Ensure it has an extension
                  if (!filename.includes('.')) {
                    filename += '.jpg';
                  }
                } catch (e) {
                  filename = 'image.jpg';
                }

                // Queue the download with Save As dialog
                const downloadsDir = app.getPath('downloads');
                const savePath = path.join(downloadsDir, filename);
                queueSaveAsForWebContents(contents.id, imageUrl, savePath);
                contents.downloadURL(imageUrl);
              }
            } catch (e) {
              console.error('Error saving image:', e);
            }
          }
        }));
        hasItems = true;
      }

      menu.append(new MenuItem({
        label: 'Copy Image URL',
        click: () => {
          try {
            contents.copyImageURLAt(props.x, props.y);
          } catch (e) {
            // Fallback: write URL to clipboard
            const { clipboard } = require('electron');
            clipboard.writeText(imageUrl);
          }
        }
      }));
      hasItems = true;

      menu.append(new MenuItem({
        label: 'Copy Image',
        click: () => {
          try {
            contents.copyImageAt(props.x, props.y);
          } catch (e) { }
        }
      }));
      hasItems = true;

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Handle videos - add Save Video option
    if (props && props.mediaType === 'video' && props.srcURL) {
      const videoUrl = props.srcURL;
      const isDownloadable = videoUrl.startsWith('http://') || videoUrl.startsWith('https://');

      if (isDownloadable) {
        menu.append(new MenuItem({
          label: 'Save Video As...',
          click: () => {
            try {
              // Get filename from URL
              let filename = 'video';
              try {
                const urlPath = new URL(videoUrl).pathname;
                const pathParts = urlPath.split('/');
                filename = pathParts[pathParts.length - 1] || 'video';
                // Ensure it has an extension
                if (!filename.includes('.')) {
                  filename += '.mp4';
                }
              } catch (e) {
                filename = 'video.mp4';
              }

              // Queue the download with Save As dialog
              const downloadsDir = app.getPath('downloads');
              const savePath = path.join(downloadsDir, filename);
              queueSaveAsForWebContents(contents.id, videoUrl, savePath);
              contents.downloadURL(videoUrl);
            } catch (e) {
              console.error('Error saving video:', e);
            }
          }
        }));
        hasItems = true;
      }

      menu.append(new MenuItem({
        label: 'Copy Video URL',
        click: () => {
          try {
            const { clipboard } = require('electron');
            clipboard.writeText(videoUrl);
          } catch (e) { }
        }
      }));
      hasItems = true;

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Handle audio - add Save Audio option
    if (props && props.mediaType === 'audio' && props.srcURL) {
      const audioUrl = props.srcURL;
      const isDownloadable = audioUrl.startsWith('http://') || audioUrl.startsWith('https://');

      if (isDownloadable) {
        menu.append(new MenuItem({
          label: 'Save Audio As...',
          click: () => {
            try {
              // Get filename from URL
              let filename = 'audio';
              try {
                const urlPath = new URL(audioUrl).pathname;
                const pathParts = urlPath.split('/');
                filename = pathParts[pathParts.length - 1] || 'audio';
                // Ensure it has an extension
                if (!filename.includes('.')) {
                  filename += '.mp3';
                }
              } catch (e) {
                filename = 'audio.mp3';
              }

              // Queue the download with Save As dialog
              const downloadsDir = app.getPath('downloads');
              const savePath = path.join(downloadsDir, filename);
              queueSaveAsForWebContents(contents.id, audioUrl, savePath);
              contents.downloadURL(audioUrl);
            } catch (e) {
              console.error('Error saving audio:', e);
            }
          }
        }));
        hasItems = true;
      }

      menu.append(new MenuItem({
        label: 'Copy Audio URL',
        click: () => {
          try {
            const { clipboard } = require('electron');
            clipboard.writeText(audioUrl);
          } catch (e) { }
        }
      }));
      hasItems = true;

      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Handle links - add Save Link As option
    if (props && props.linkURL && props.linkURL.startsWith('http')) {
      menu.append(new MenuItem({
        label: 'Save Link As...',
        click: () => {
          try {
            const linkUrl = props.linkURL;
            // Get filename from URL
            let filename = 'download';
            try {
              const urlPath = new URL(linkUrl).pathname;
              const pathParts = urlPath.split('/');
              filename = pathParts[pathParts.length - 1] || 'download';
            } catch (e) {
              filename = 'download';
            }

            // Queue the download with Save As dialog
            const downloadsDir = app.getPath('downloads');
            const savePath = path.join(downloadsDir, filename);
            queueSaveAsForWebContents(contents.id, linkUrl, savePath);
            contents.downloadURL(linkUrl);
          } catch (e) {
            console.error('Error saving link:', e);
          }
        }
      }));
      menu.append(new MenuItem({
        label: 'Copy Link URL',
        click: () => {
          try {
            const { clipboard } = require('electron');
            clipboard.writeText(props.linkURL);
          } catch (e) { }
        }
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      hasItems = true;
    }

    // Add Copy if text is selected
    if (props.selectionText && props.selectionText.trim() !== '') {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      hasItems = true;
    }

    // Add Cut if text is selected and the area is editable
    if (props.isEditable && props.selectionText && props.selectionText.trim() !== '') {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      hasItems = true;
    }

    // Add Paste if the area is editable
    if (props.isEditable) {
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      hasItems = true;
    }

    // Add Select All
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    hasItems = true;

    // Add a separator and Inspect Element (useful for development)
    if (!app.isPackaged) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Inspect Element',
        click: () => { contents.inspectElement(props.x, props.y); }
      }));
      hasItems = true;
    }

    // Only show the menu if there are items in it
    if (hasItems && menu.items.length > 0) {
      menu.popup({ window: BrowserWindow.fromWebContents(contents) });
    }
  });

  // Password detection is intentionally disabled until secure OS-backed storage is implemented.
});

// Enforce strict TLS handling: never bypass certificate validation errors.
app.on('certificate-error', (event, webContentsRef, url, error, certificate, callback) => {
  try {
    event.preventDefault();
  } catch (e) { }
  try {
    callback(false);
  } catch (e) { }
  try {
    console.warn('[TLS] Blocked certificate error', { url, error });
  } catch (e) { }
});

// Helper function to extract URL from command line arguments
function getUrlFromArgs(argv) {
  return argv.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));
}

let pendingStartupUrl = getUrlFromArgs(process.argv) || null;
let deferInitialMainShow = !!pendingStartupUrl;

// Register as default protocol client for http and https
if (require('electron').app.isPackaged) {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
  }
}

// Keep references to main window and all card windows
let mainWindow;
const cardWindows = new Map(); // cardId -> BrowserWindow
const cardBubbles = new Map(); // cardId -> bubble BrowserWindow
const bubbleNotifications = new Map(); // cardId -> notification count
const bubbleNotificationSources = new Map(); // cardId -> 'api' | 'title'
let visualizerEnabled = false;
let currentCardTheme = 'primary'; // Store the user's preferred card theme
let currentCardLaunchSizeMode = 'normal'; // Store user's preferred launch size for new cards
const pendingAuthRedirects = new Map(); // requestId -> { authUrl, launchUrl, createdAt }
const recentAuthRedirects = new Map(); // dedupeKey -> { ts, requestId }

const CARD_LAUNCH_MODE_NORMAL = 'normal';
const CARD_LAUNCH_MODE_WIDE = 'wide';
const CARD_LAUNCH_MODE_FULLSCREEN = 'fullscreen';
const CARD_LAUNCH_VERTICAL_OFFSET = 36;
const CARD_LAUNCH_SIZE_MODES = new Set([
  CARD_LAUNCH_MODE_NORMAL,
  CARD_LAUNCH_MODE_WIDE,
  CARD_LAUNCH_MODE_FULLSCREEN,
]);

function normalizeCardLaunchSizeMode(mode) {
  const candidate = String(mode || '').trim().toLowerCase();
  if (CARD_LAUNCH_SIZE_MODES.has(candidate)) return candidate;
  return CARD_LAUNCH_MODE_NORMAL;
}

function getLaunchWindowSizeByMode(mode) {
  const normalized = normalizeCardLaunchSizeMode(mode);
  if (normalized === CARD_LAUNCH_MODE_WIDE) {
    return { width: 1100, height: 600 };
  }
  return { width: 800, height: 500 };
}

const AUTH_EXTERNAL_HOSTS = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'auth.yahoo.com',
  'api.login.yahoo.com',
]);

function isAuthSensitiveUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = (parsed.hostname || '').toLowerCase();
    if (AUTH_EXTERNAL_HOSTS.has(hostname)) return true;
    // Capture common hosted auth endpoints.
    if (hostname.endsWith('.google.com') && parsed.pathname.startsWith('/o/oauth2')) return true;
    if (hostname.endsWith('.google.com') && parsed.pathname.includes('/signin')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function closeCardBubble(cardId) {
  const bubble = cardBubbles.get(cardId);
  if (!bubble) return;
  try {
    if (!bubble.isDestroyed()) bubble.close();
  } catch (e) { }
  cardBubbles.delete(cardId);
  bubbleNotifications.delete(cardId);
  bubbleNotificationSources.delete(cardId);
}

// Update notification badge on bubble
function updateBubbleNotification(cardId, count, source) {
  bubbleNotifications.set(cardId, count);
  if (source) {
    bubbleNotificationSources.set(cardId, source);
  } else {
    bubbleNotificationSources.delete(cardId);
  }
  const bubble = cardBubbles.get(cardId);
  if (bubble && !bubble.isDestroyed()) {
    try {
      bubble.webContents.send('bubble-notification-update', count);
    } catch (e) { }
  }
}

// Increment bubble notification count
function incrementBubbleNotification(cardId) {
  const currentCount = bubbleNotifications.get(cardId) || 0;
  updateBubbleNotification(cardId, currentCount + 1, 'api');
}

// Clear bubble notifications
function clearBubbleNotifications(cardId) {
  updateBubbleNotification(cardId, 0);
}

function deriveBubbleLabel(pageTitle, pageUrl) {
  try {
    const parsed = new URL(String(pageUrl || ''));
    const host = String(parsed.hostname || '').replace(/^www\./i, '');
    const ch = host.replace(/^[^a-zA-Z0-9]+/, '').charAt(0);
    if (ch) return ch.toUpperCase();
  } catch (e) { }
  return 'D';
}

function extractTitleNotificationCount(rawTitle) {
  const title = String(rawTitle || '').trim();
  if (!title) return null;
  const patterns = [
    /^\((\d{1,4})\)/,
    /^\[(\d{1,4})\]/,
    /^(\d{1,4})\s*[•\-:]/,
    /(\d{1,4})\+?\s*$/
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      const count = parseInt(match[1], 10);
      if (Number.isFinite(count) && count >= 0) return count;
    }
  }
  return null;
}

function createCardBubble(cardId, cardWindow, meta = {}) {
  try {
    if (!cardWindow || cardWindow.isDestroyed()) return null;
    const existing = cardBubbles.get(cardId);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }

    const bubbleSize = 72;
    const cardBounds = cardWindow.getBounds();
    const startX = Math.max(0, Math.floor(cardBounds.x + cardBounds.width - bubbleSize - 16));
    const startY = Math.max(0, Math.floor(cardBounds.y + 16));
    let title = '';
    try {
      title = String(cardWindow.webContents.getTitle() || '').trim();
    } catch (e) { }
    if (!title && meta && meta.pageTitle) title = String(meta.pageTitle);
    if (!title) title = `Card ${cardId}`;
    const label = deriveBubbleLabel(meta && meta.pageTitle, meta && meta.pageUrl);

    const bubbleWindow = new BrowserWindow({
      width: bubbleSize,
      height: bubbleSize,
      x: startX,
      y: startY,
      icon: APP_ICON_PATH,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-card-bubble.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    attachWindowHangRecovery(bubbleWindow, `card-bubble-${cardId}`);

    try {
      bubbleWindow.setAlwaysOnTop(true, 'floating');
    } catch (e) {
      bubbleWindow.setAlwaysOnTop(true);
    }

    const bubbleTheme = String((meta && meta.themeKey) || 'primary').toLowerCase();
    const bubblePath = path.join(__dirname, 'src', 'card-bubble.html');
    // Use loadFile instead of loadURL to properly handle query parameters on Windows
    bubbleWindow.loadFile(bubblePath, {
      query: {
        cardId: String(cardId),
        title: title,
        label: label,
        theme: bubbleTheme
      }
    }).catch((err) => {
      console.error('Error loading card bubble:', err);
    });
    bubbleWindow.once('ready-to-show', () => {
      if (!bubbleWindow.isDestroyed()) bubbleWindow.show();
      try {
        const existingCount = bubbleNotifications.get(cardId) || 0;
        bubbleWindow.webContents.send('bubble-notification-update', existingCount);
      } catch (e) { }
    });
    bubbleWindow.on('closed', () => {
      cardBubbles.delete(cardId);
      // Note: We no longer auto-close the card when bubble is closed.
      // User can restore by clicking the bubble, or close via the card's own controls.
    });

    cardBubbles.set(cardId, bubbleWindow);
    return bubbleWindow;
  } catch (e) {
    console.error('Error creating card bubble:', e);
    return null;
  }
}

function restoreCardFromBubble(cardId) {
  const cardWindow = cardWindows.get(cardId);
  if (!cardWindow || cardWindow.isDestroyed()) {
    closeCardBubble(cardId);
    return { success: false, error: 'Card window not found' };
  }

  try {
    // Clear notifications when restoring
    clearBubbleNotifications(cardId);

    if (cardWindow.isMinimized()) cardWindow.restore();
    cardWindow.show();
    cardWindow.focus();
    try {
      if (cardWindow.webContents && !cardWindow.webContents.isDestroyed()) {
        cardWindow.webContents.send('card-restore-animate');
      }
    } catch (e) { }
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    closeCardBubble(cardId);
  }

  return { success: true };
}

function broadcastVisualizerSetting(enabled) {
  for (const [, win] of cardWindows) {
    try {
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('visualizer-setting', !!enabled);
      }
    } catch (e) { }
  }
}

function isHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function normalizeOrigin(rawUrlOrOrigin) {
  try {
    if (!rawUrlOrOrigin) return '';
    const parsed = new URL(String(rawUrlOrOrigin));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch (e) {
    return '';
  }
}

function normalizeTypedNavigationTarget(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) return '';

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    return isHttpUrl(input) ? input : '';
  }

  if (input.includes('.') && !input.includes(' ')) {
    const withScheme = `https://${input}`;
    return isHttpUrl(withScheme) ? withScheme : '';
  }

  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

const PROMPTABLE_SITE_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
  'fullscreen',
]);
const ALLOW_WITHOUT_PROMPT = new Set(['fullscreen']);
const permissionDecisionCache = new Map(); // key: origin|permission -> boolean
const pendingPermissionPrompts = new Map(); // key: origin|permission -> Promise<boolean>
const PERMISSION_DECISIONS_FILENAME = 'permission-decisions.json';
let permissionDecisionsLoaded = false;
let permissionPersistTimer = null;

function getPermissionDecisionsFilePath() {
  try {
    return path.join(app.getPath('userData'), PERMISSION_DECISIONS_FILENAME);
  } catch (e) {
    return '';
  }
}

function isValidPermissionDecisionKey(key) {
  if (!key || typeof key !== 'string') return false;
  const splitIndex = key.lastIndexOf('|');
  if (splitIndex <= 0 || splitIndex >= key.length - 1) return false;
  const origin = key.slice(0, splitIndex);
  const permission = key.slice(splitIndex + 1);
  if (!normalizeOrigin(origin)) return false;
  if (!PROMPTABLE_SITE_PERMISSIONS.has(permission)) return false;
  return true;
}

function loadPermissionDecisionsFromDisk() {
  if (permissionDecisionsLoaded) return;
  permissionDecisionsLoaded = true;
  const filePath = getPermissionDecisionsFilePath();
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const decisions = parsed && parsed.decisions && typeof parsed.decisions === 'object'
      ? parsed.decisions
      : {};
    for (const [key, value] of Object.entries(decisions)) {
      if (!isValidPermissionDecisionKey(key)) continue;
      permissionDecisionCache.set(key, value === true);
    }
  } catch (e) {
    console.warn('Failed to load persisted permission decisions:', e.message || e);
  }
}

function writePermissionDecisionsToDisk() {
  const filePath = getPermissionDecisionsFilePath();
  if (!filePath) return;
  try {
    const decisions = {};
    for (const [key, value] of permissionDecisionCache.entries()) {
      if (!isValidPermissionDecisionKey(key)) continue;
      decisions[key] = value === true;
    }
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      decisions,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to persist permission decisions:', e.message || e);
  }
}

function schedulePermissionDecisionPersist() {
  if (permissionPersistTimer) clearTimeout(permissionPersistTimer);
  permissionPersistTimer = setTimeout(() => {
    permissionPersistTimer = null;
    writePermissionDecisionsToDisk();
  }, 150);
}

function flushPermissionDecisionPersist() {
  if (permissionPersistTimer) {
    clearTimeout(permissionPersistTimer);
    permissionPersistTimer = null;
  }
  writePermissionDecisionsToDisk();
}

function getPermissionRequestOrigin(details, requestingOrigin) {
  const candidates = [
    requestingOrigin,
    details && details.requestingUrl,
    details && details.embeddingOrigin,
    details && details.securityOrigin,
  ];
  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }
  return '';
}

function shouldPromptForPermission(permission, origin) {
  if (!PROMPTABLE_SITE_PERMISSIONS.has(permission)) return false;
  if (ALLOW_WITHOUT_PROMPT.has(permission)) return false;
  return !!origin;
}

async function promptPermissionDecision(webContentsRef, permission, origin) {
  const key = `${origin}|${permission}`;
  if (pendingPermissionPrompts.has(key)) {
    return pendingPermissionPrompts.get(key);
  }

  const parentWindow = BrowserWindow.fromWebContents(webContentsRef) || null;
  const originHost = (() => {
    try { return new URL(origin).host; } catch (e) { return origin; }
  })();

  const prompt = dialog.showMessageBox(parentWindow, {
    type: 'question',
    title: 'Permission Request',
    message: `${originHost} wants ${permission} permission`,
    detail: 'Allow this permission for this site?',
    buttons: ['Allow', 'Block'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    checkboxLabel: 'Remember this decision for this session',
    checkboxChecked: false,
  }).then((result) => {
    const allowed = result && result.response === 0;
    if (result && result.checkboxChecked) {
      permissionDecisionCache.set(key, allowed);
      schedulePermissionDecisionPersist();
    }
    return allowed;
  }).catch(() => false).finally(() => {
    pendingPermissionPrompts.delete(key);
  });

  pendingPermissionPrompts.set(key, prompt);
  return prompt;
}

function configurePermissionHandlersForSession(targetSession) {
  if (!targetSession) return;

  targetSession.setPermissionCheckHandler((webContentsRef, permission, requestingOrigin, details) => {
    try {
      const origin = getPermissionRequestOrigin(details, requestingOrigin);
      if (!origin) return false;
      if (!PROMPTABLE_SITE_PERMISSIONS.has(permission)) return false;
      if (ALLOW_WITHOUT_PROMPT.has(permission)) return true;
      const key = `${origin}|${permission}`;
      return permissionDecisionCache.get(key) === true;
    } catch (e) {
      return false;
    }
  });

  targetSession.setPermissionRequestHandler((webContentsRef, permission, callback, details) => {
    try {
      const origin = getPermissionRequestOrigin(details, '');
      if (!origin || !PROMPTABLE_SITE_PERMISSIONS.has(permission)) {
        callback(false);
        return;
      }
      if (ALLOW_WITHOUT_PROMPT.has(permission)) {
        callback(true);
        return;
      }
      const key = `${origin}|${permission}`;
      if (permissionDecisionCache.has(key)) {
        callback(permissionDecisionCache.get(key) === true);
        return;
      }
      if (!shouldPromptForPermission(permission, origin)) {
        callback(false);
        return;
      }
      promptPermissionDecision(webContentsRef, permission, origin)
        .then((allowed) => callback(!!allowed))
        .catch(() => callback(false));
    } catch (e) {
      callback(false);
    }
  });
}

function pickExternalLaunchUrl(authUrl, context = {}) {
  const candidates = [context.sourceUrl, context.referrerUrl];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!isHttpUrl(candidate)) continue;
    if (isAuthSensitiveUrl(candidate)) continue;
    return candidate;
  }
  return authUrl;
}

function launchBrowserExecutable(executablePath, url) {
  try {
    if (!executablePath || !fs.existsSync(executablePath)) {
      try { console.warn('[External Browser] Not found:', executablePath); } catch (e) { }
      return false;
    }
    const proc = spawn(executablePath, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.unref();
    return true;
  } catch (e) {
    try { console.warn('[External Browser] Failed to launch', executablePath, e && e.message ? e.message : e); } catch (err) { }
    return false;
  }
}

function openExternalBrowserForChallenge(url) {
  if (!url) return { opened: false, launchUrl: null };
  const launchUrl = String(url).trim();
  if (!launchUrl) return { opened: false, launchUrl: null };

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const browserCandidates = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
      path.join(pfx86, 'Mozilla Firefox', 'firefox.exe'),
      localAppData ? path.join(localAppData, 'Mozilla Firefox', 'firefox.exe') : '',
    ];
    for (const candidate of browserCandidates) {
      if (launchBrowserExecutable(candidate, launchUrl)) {
        return { opened: true, launchUrl };
      }
    }
  }

  try {
    dialog.showMessageBox({
      type: 'info',
      title: 'Open In Browser',
      message: 'A security challenge requires a full browser to complete.',
      detail: 'Please open this page in Chrome, Edge, or Firefox and complete the verification.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    });
  } catch (e) { }

  return { opened: false, launchUrl };
}

function openAuthInExternalBrowser(url, context = {}) {
  if (!url) return { opened: false, launchUrl: null };
  const launchUrl = pickExternalLaunchUrl(url, context);

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const browserCandidates = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
      path.join(pfx86, 'Mozilla Firefox', 'firefox.exe'),
      localAppData ? path.join(localAppData, 'Mozilla Firefox', 'firefox.exe') : '',
      path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const candidate of browserCandidates) {
      if (launchBrowserExecutable(candidate, launchUrl)) {
        return { opened: true, launchUrl };
      }
    }
  }

  // Avoid shell.openExternal here because the app may be the default browser.
  try {
    dialog.showMessageBox({
      type: 'info',
      title: 'Open In Browser',
      message: 'This sign-in requires Chrome, Edge, or Firefox.',
      detail: 'No supported browser was found on this system.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    });
  } catch (e) { }
  return { opened: false, launchUrl: null };
}

function notifyExternalAuthRedirect(authUrl, launchUrl, requestId) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('auth-opened-externally', { authUrl, launchUrl, requestId });
  } catch (e) {
    // ignore
  }
}

function queueAuthRedirectExternally(authUrl, context = {}) {
  const launchUrl = pickExternalLaunchUrl(authUrl, context);
  const dedupeKey = `${authUrl}|${launchUrl}`;
  const now = Date.now();

  // Cleanup stale dedupe entries.
  for (const [key, value] of recentAuthRedirects) {
    if (!value || !value.ts || (now - value.ts) > 5000) {
      recentAuthRedirects.delete(key);
    }
  }

  // Suppress repeated prompt for the same auth redirect burst.
  const recent = recentAuthRedirects.get(dedupeKey);
  if (recent && (now - recent.ts) < 2500) {
    return {
      queued: false,
      duplicate: true,
      requestId: recent.requestId,
      launchUrl,
    };
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingAuthRedirects.set(requestId, {
    authUrl,
    launchUrl,
    createdAt: Date.now(),
  });
  recentAuthRedirects.set(dedupeKey, { ts: now, requestId });
  notifyExternalAuthRedirect(authUrl, launchUrl, requestId);
  return {
    queued: true,
    requestId,
    launchUrl,
  };
}

// Counter for generating unique card IDs for direct creation
let directCardIdCounter = 100000;
let prewarmedCardWindow = null;
let prewarmInProgress = false;
let prewarmTimer = null;

function cleanupPrewarmedCardWindow() {
  if (prewarmTimer) {
    clearTimeout(prewarmTimer);
    prewarmTimer = null;
  }
  if (prewarmedCardWindow && !prewarmedCardWindow.isDestroyed()) {
    try {
      prewarmedCardWindow.destroy();
    } catch (e) { }
  }
  prewarmedCardWindow = null;
  prewarmInProgress = false;
}

function scheduleCardPrewarm(delayMs = 1200) {
  if (prewarmTimer) return;
  prewarmTimer = setTimeout(() => {
    prewarmTimer = null;
    ensurePrewarmedCardWindow();
  }, delayMs);
}

function ensurePrewarmedCardWindow() {
  if (prewarmedCardWindow && !prewarmedCardWindow.isDestroyed()) return;
  if (prewarmInProgress) return;
  prewarmInProgress = true;
  try {
    const prewarmMode = currentCardLaunchSizeMode === CARD_LAUNCH_MODE_FULLSCREEN
      ? CARD_LAUNCH_MODE_NORMAL
      : currentCardLaunchSizeMode;
    const prewarmSize = getLaunchWindowSizeByMode(prewarmMode);
    const cardHtmlPath = path.join(__dirname, 'src', 'card.html');
    const win = new BrowserWindow({
      width: prewarmSize.width,
      height: prewarmSize.height,
      icon: APP_ICON_PATH,
      frame: false,
      transparent: true,
      resizable: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: true,
        preload: path.join(__dirname, 'preload-card.js'),
        enableWebSQL: false,
        spellcheck: true,
        backgroundThrottling: false,
        enablePreferredSizeMode: true,
        partition: 'persist:cards',
      },
    });
    attachWindowHangRecovery(win, 'prewarmed-card');
    prewarmedCardWindow = win;
    win.loadFile(cardHtmlPath, {
      query: {
        cardId: '0',
        url: '',
        theme: currentCardTheme,
      }
    }).catch(() => { });
    win.on('closed', () => {
      if (prewarmedCardWindow === win) {
        prewarmedCardWindow = null;
      }
    });
  } catch (e) {
    prewarmedCardWindow = null;
  } finally {
    prewarmInProgress = false;
  }
}

// Direct card creation function - creates card window immediately without renderer round-trip
// This ensures instant visual feedback when external apps call the browser
// Options: { showHidden: boolean, themeKey: string, launchSizeMode: 'normal'|'wide'|'fullscreen' }
function createCardDirectly(url, options = {}) {
  try {
    // Support both old signature (themeKey as string) and new options object
    const opts = typeof options === 'string' ? { themeKey: options } : options;
    const minimizeAfterShow = opts.minimizeAfterShow === true;
    const requestedLaunchMode = normalizeCardLaunchSizeMode(opts.launchSizeMode || currentCardLaunchSizeMode);
    const launchMode = minimizeAfterShow ? CARD_LAUNCH_MODE_NORMAL : requestedLaunchMode;
    const launchSize = getLaunchWindowSizeByMode(launchMode);

    const targetUrl = normalizeTypedNavigationTarget(url);
    if (!targetUrl) {
      return null;
    }

    if (isAuthSensitiveUrl(targetUrl)) {
      queueAuthRedirectExternally(targetUrl);
      return null;
    }

    // Use provided theme or fall back to current saved theme
    const allowedThemes = new Set(['primary', 'sunset', 'ocean', 'emerald', 'amber', 'midnight', 'cocoa', 'alt']);
    const effectiveTheme = opts.themeKey || currentCardTheme;
    const normalizedTheme = allowedThemes.has(String(effectiveTheme || '').toLowerCase())
      ? String(effectiveTheme || '').toLowerCase()
      : 'primary';
    const cardTheme = normalizedTheme === 'alt' ? 'sunset' : normalizedTheme;

    // Generate unique card ID
    const cardId = ++directCardIdCounter;

    // Calculate centered position
    let finalX = 200;
    let finalY = 150;
    try {
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      finalX = Math.floor((screenWidth - launchSize.width) / 2);
      finalY = Math.floor((screenHeight - launchSize.height) / 2) + CARD_LAUNCH_VERTICAL_OFFSET;
      // Offset based on existing cards
      const cardCount = cardWindows.size;
      if (cardCount > 0) {
        finalX += (cardCount * 25);
        finalY += (cardCount * 25);
      }
    } catch (e) { }

    let cardWindow = null;
    if (prewarmedCardWindow && !prewarmedCardWindow.isDestroyed()) {
      cardWindow = prewarmedCardWindow;
      prewarmedCardWindow = null;
      try {
        cardWindow.setSkipTaskbar(minimizeAfterShow);
        try { cardWindow.setFullScreen(false); } catch (e) { }
        cardWindow.setBounds({
          x: finalX,
          y: finalY,
          width: launchSize.width,
          height: launchSize.height,
        });
        cardWindow.show();
      } catch (e) { }
      scheduleCardPrewarm(1500);
    }

    // Create floating card window with visible background for instant display
    if (!cardWindow) {
      cardWindow = new BrowserWindow({
        width: launchSize.width,
        height: launchSize.height,
        x: finalX,
        y: finalY,
        icon: APP_ICON_PATH,
        frame: false,
        transparent: true,
        resizable: true,
        skipTaskbar: minimizeAfterShow, // Hide from taskbar when opening as bubble
        show: true, // Always show initially
        backgroundColor: '#00000000', // Transparent for rounded corners from HTML
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: true,
          preload: path.join(__dirname, 'preload-card.js'),
          enableWebSQL: false,
          spellcheck: true,
          backgroundThrottling: false,
          enablePreferredSizeMode: true,
          partition: 'persist:cards',
        },
      });
    }
    attachWindowHangRecovery(cardWindow, `direct-card-${cardId}`);

    if (launchMode === CARD_LAUNCH_MODE_FULLSCREEN && !minimizeAfterShow) {
      const applyFullscreen = () => {
        try {
          if (cardWindow && !cardWindow.isDestroyed()) {
            cardWindow.setFullScreen(true);
          }
        } catch (e) { }
      };
      cardWindow.once('ready-to-show', applyFullscreen);
      setTimeout(applyFullscreen, 120);
    }

    // Store reference before loading
    cardWindows.set(cardId, cardWindow);

    // Add network error handlers at main process level
    cardWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      clearCardLoadTimeout(cardWindow);
      console.log('[Card] did-fail-load:', errorCode, errorDescription);
      // Forward to renderer for display
      if (isMainFrame) {
        cardWindow.webContents.send('card-load-failed', { errorCode, errorDescription: errorDescription || '' });
      }
    });

    cardWindow.webContents.on('render-process-gone', (event, details) => {
      clearCardLoadTimeout(cardWindow);
      console.log('[Card] render-process-gone:', details.reason);
      if (details.reason === 'crashed' || details.reason === 'abnormal') {
        cardWindow.webContents.send('card-load-failed', { errorCode: -1, errorDescription: details.reason });
      }
    });

    // If we need to minimize after show, do so after a brief delay
    if (minimizeAfterShow) {
      let minimizeScheduled = false;
      const scheduleMinimize = () => {
        if (minimizeScheduled) return;
        minimizeScheduled = true;
        setTimeout(() => {
          try {
            if (cardWindow && !cardWindow.isDestroyed() && !cardWindow.isMinimized()) {
              cardWindow.minimize();
            }
          } catch (e) { }
        }, 500);
      };
      cardWindow.once('ready-to-show', scheduleMinimize);
      cardWindow.webContents.once('did-finish-load', scheduleMinimize);
      setTimeout(scheduleMinimize, 1400);
    }

    // Load the actual card HTML directly without placeholder for faster startup
    const encodedUrl = Buffer.from(targetUrl).toString('base64');
    const cardHtmlPath = path.join(__dirname, 'src', 'card.html');
    // Use loadFile instead of loadURL to properly handle query parameters on Windows
    cardWindow.loadFile(cardHtmlPath, {
      query: {
        cardId: String(cardId),
        url: encodedUrl,
        theme: cardTheme
      }
    }).catch((err) => {
      console.error('Error loading card HTML:', err);
    });

    // Force any window.open/target=_blank to open as a card window
    try {
      cardWindow.webContents.setWindowOpenHandler(({ url: openUrl, referrer }) => {
        let sourceUrl = '';
        try {
          sourceUrl = cardWindow.webContents.getURL();
        } catch (e) { }
        openUrlInCard(openUrl, { sourceUrl, referrerUrl: referrer && referrer.url });
        return { action: 'deny' };
      });
    } catch (e) { }

    // Setup event listeners
    cardWindow.webContents.on('did-start-loading', () => {
      // Setup load timeout for card - will force-stop if loading takes too long
      setupCardLoadTimeout(cardWindow, `direct-card-${cardId}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-loading-start', cardId);
      }
    });

    cardWindow.webContents.on('did-finish-load', () => {
      clearCardLoadTimeout(cardWindow);
      if (mainWindow && !mainWindow.isDestroyed() && cardWindow && !cardWindow.isDestroyed()) {
        const pageTitle = cardWindow.webContents.getTitle();
        const currentUrl = cardWindow.webContents.getURL();
        mainWindow.webContents.send('card-loading-finish', cardId, pageTitle, currentUrl);
      }
      try {
        if (cardWindow && !cardWindow.isDestroyed() && cardWindow.webContents && !cardWindow.webContents.isDestroyed()) {
          cardWindow.webContents.send('visualizer-setting', !!visualizerEnabled);
        }
      } catch (e) { }
    });

    cardWindow.webContents.on('did-navigate', (event, navUrl) => {
      if (mainWindow && !mainWindow.isDestroyed() && cardWindow && !cardWindow.isDestroyed()) {
        mainWindow.webContents.send('card-url-updated', cardId, navUrl);
        mainWindow.webContents.send('card-title-updated', cardId, cardWindow.webContents.getTitle());
      }
    });

    cardWindow.webContents.on('page-title-updated', (event, title) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-title-updated', cardId, title);
      }
      try {
        if (cardBubbles.has(cardId)) {
          const parsedCount = extractTitleNotificationCount(title);
          if (parsedCount !== null) {
            updateBubbleNotification(cardId, parsedCount, 'title');
          } else if (bubbleNotificationSources.get(cardId) === 'title') {
            updateBubbleNotification(cardId, 0, 'title');
          }
        }
      } catch (e) { }
    });

    cardWindow.on('show', () => {
      closeCardBubble(cardId);
    });

    cardWindow.on('closed', () => {
      clearCardLoadTimeout(cardWindow);
      closeCardBubble(cardId);
      cardWindows.delete(cardId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-closed', cardId);
      }
    });

    // Notify renderer about the new card so it can update its state
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const parsedUrl = new URL(targetUrl);
        const domain = parsedUrl.hostname || 'Loading...';
        mainWindow.webContents.send('external-card-created', {
          cardId,
          url: targetUrl,
          title: domain
        });
      } catch (e) {
        mainWindow.webContents.send('external-card-created', {
          cardId,
          url: targetUrl,
          title: 'Loading...'
        });
      }
    }

    return { cardId, cardWindow };
  } catch (error) {
    console.error('Error creating card directly:', error);
    return null;
  }
}

function openUrlInCard(url, context = {}) {
  try {
    if (!url) return;
    const targetUrl = String(url).trim();
    if (!isHttpUrl(targetUrl)) {
      return;
    }
    if (isAuthSensitiveUrl(targetUrl)) {
      queueAuthRedirectExternally(targetUrl, context);
      return;
    }

    // Create card directly for instant visual feedback
    // This bypasses the renderer round-trip for external URLs
    createCardDirectly(targetUrl);
  } catch (e) {
    // ignore
  }
}

// Open URL as a bubble (minimized card) - for non-distracting background loading
function openUrlAsBubble(url, meta = {}) {
  try {
    if (!url) return null;
    const targetUrl = String(url).trim();
    if (!isHttpUrl(targetUrl)) {
      return null;
    }
    if (isAuthSensitiveUrl(targetUrl)) {
      // Auth URLs should still open externally, not as bubbles
      queueAuthRedirectExternally(targetUrl, { sourceUrl: meta.sourceUrl });
      return null;
    }

    // Create the card window normally, then minimize it
    const result = createCardDirectly(targetUrl, { minimizeAfterShow: true });
    if (!result || !result.cardWindow) {
      return null;
    }

    const { cardId, cardWindow } = result;

    const canShowBubble = () => {
      try {
        if (!cardWindow || cardWindow.isDestroyed()) return false;
        if (cardWindow.isMinimized()) return true;
        if (!cardWindow.isVisible()) return true;
      } catch (e) { }
      return false;
    };

    // Create bubble for this card
    const bubbleMeta = {
      pageTitle: meta.title || '',
      pageUrl: targetUrl,
      themeKey: meta.themeKey || currentCardTheme,
    };

    // Wait for the page to get a title, then create bubble
    let bubbleCreated = false;
    const createBubbleWithMeta = () => {
      if (bubbleCreated) return;
      bubbleCreated = true;

      if (!canShowBubble()) {
        return;
      }

      try {
        let title = '';
        try {
          title = String(cardWindow.webContents.getTitle() || '').trim();
        } catch (e) { }
        if (!title && meta.title) title = meta.title;
        if (!title) title = `Card ${cardId}`;

        createCardBubble(cardId, cardWindow, {
          ...bubbleMeta,
          pageTitle: title,
        });
      } catch (e) {
        console.error('Error creating bubble for URL:', e);
      }
    };

    // Create bubble immediately with placeholder, will update when page loads
    createCardBubble(cardId, cardWindow, bubbleMeta);

    // Update bubble when page title changes
    cardWindow.webContents.on('page-title-updated', (event, title) => {
      if (!canShowBubble()) {
        return;
      }
      if (!bubbleCreated) {
        createBubbleWithMeta();
      }
      // Update existing bubble's title
      const bubble = cardBubbles.get(cardId);
      if (bubble && !bubble.isDestroyed()) {
        // Recreate bubble with updated title
        closeCardBubble(cardId);
        createCardBubble(cardId, cardWindow, {
          ...bubbleMeta,
          pageTitle: title,
        });
      }
    });

    // Also create bubble after finish load if not yet created
    cardWindow.webContents.on('did-finish-load', () => {
      if (!bubbleCreated && canShowBubble()) {
        createBubbleWithMeta();
      }
    });

    return { cardId, cardWindow };
  } catch (e) {
    console.error('Error opening URL as bubble:', e);
    return null;
  }
}

// ========================
// Downloads
// ========================

const downloadIdByItem = new WeakMap();
const downloadHandlerSessions = new WeakSet();

// Map to store queued save-as paths for specific webContents and URLs
const queuedSaveAsPaths = new Map(); // key: `${webContentsId}|${url}` -> savePath

// Queue a save-as path for a specific webContents and URL
function queueSaveAsForWebContents(webContentsId, url, savePath) {
  if (!webContentsId || !url || !savePath) return;
  const key = `${webContentsId}|${url}`;
  queuedSaveAsPaths.set(key, savePath);
  // Clean up after 30 seconds to prevent memory leaks
  setTimeout(() => {
    queuedSaveAsPaths.delete(key);
  }, 30000);
}

// Consume a queued save-as path for a specific webContents and URL
function consumeQueuedSaveAsPath(webContentsId, url) {
  if (!webContentsId || !url) return null;
  const key = `${webContentsId}|${url}`;
  const savePath = queuedSaveAsPaths.get(key);
  if (savePath) {
    queuedSaveAsPaths.delete(key);
    return savePath;
  }
  return null;
}

function ensureUniquePath(savePath) {
  try {
    if (!fs.existsSync(savePath)) return savePath;
    const dir = path.dirname(savePath);
    const ext = path.extname(savePath);
    const base = path.basename(savePath, ext);
    for (let i = 1; i < 1000; i++) {
      const candidate = path.join(dir, `${base} (${i})${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
  } catch (e) { }
  return savePath;
}

// Map MIME types to file extensions
function extensionFromMime(mime) {
  if (!mime) return '';
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/x-icon': '.ico',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-ms-wmv': '.wmv',
    'video/x-matroska': '.mkv',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/x-m4a': '.m4a',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/json': '.json',
    'application/xml': '.xml',
    'text/html': '.html',
    'text/css': '.css',
    'text/javascript': '.js',
    'text/plain': '.txt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-powerpoint': '.ppt',
  };
  const lowerMime = String(mime).toLowerCase().split(';')[0].trim();
  return mimeMap[lowerMime] || '';
}

function sendDownloadEvent(channel, payload, originatingWebContents) {
  console.warn('[DownloadEvent] Sending to mainWindow:', !!mainWindow, mainWindow ? !mainWindow.isDestroyed() : 'N/A');

  // Send to main window - ensure it gets the event
  try {
    if (!mainWindow) {
      console.warn('[DownloadEvent] mainWindow is null');
    } else if (mainWindow.isDestroyed()) {
      console.warn('[DownloadEvent] mainWindow is destroyed');
    } else if (!mainWindow.webContents) {
      console.warn('[DownloadEvent] mainWindow.webContents is missing');
    } else if (mainWindow.webContents.isDestroyed()) {
      console.warn('[DownloadEvent] mainWindow.webContents is destroyed');
    } else if (!mainWindow.webContents.isLoading()) {
      // Only send if the page has loaded
      mainWindow.webContents.send(channel, payload);
      console.warn('[DownloadEvent] Sent to mainWindow, channel:', channel);
    } else {
      // Page is still loading, try again after a short delay
      console.warn('[DownloadEvent] mainWindow page is still loading, queuing event');
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
            console.warn('[DownloadEvent] Sent to mainWindow after delay');
          }
        } catch (e) { }
      }, 500);
    }
  } catch (e) {
    console.warn('[DownloadEvent] Error sending to mainWindow:', e.message);
  }

  // Also send to the specific BrowserWindow that initiated the download (e.g. card window)
  try {
    if (originatingWebContents) {
      let win = BrowserWindow.fromWebContents(originatingWebContents);

      // If webContents is a webview, BrowserWindow.fromWebContents returns null
      // Use hostWebContents to get the parent window's webContents
      if (!win) {
        try {
          const hostWebContents = originatingWebContents.hostWebContents;
          if (hostWebContents) {
            win = BrowserWindow.fromWebContents(hostWebContents);
          }
        } catch (e) { }
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
        console.warn('[DownloadEvent] Sent to originating window');
      } else {
        console.warn('[DownloadEvent] Originating window not available');
      }
    } else {
      console.warn('[DownloadEvent] No originatingWebContents');
    }
  } catch (e) {
    console.warn('[DownloadEvent] Error sending to originating window:', e.message);
  }
}

function setupDownloadHandlingForSession(sess) {
  try {
    if (!sess || downloadHandlerSessions.has(sess)) return;
    downloadHandlerSessions.add(sess);

    sess.on('will-download', (event, item, webContents) => {
      try {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        downloadIdByItem.set(item, id);

        const url = item.getURL();
        const mime = item.getMimeType ? item.getMimeType() : '';
        const suggested = item.getFilename ? item.getFilename() : 'download';
        const downloadsDir = app.getPath('downloads');
        const initialSavePath = path.join(downloadsDir, suggested);
        const queuedSaveAsPath = consumeQueuedSaveAsPath(webContents && webContents.id, url);
        let finalSavePath = queuedSaveAsPath || ensureUniquePath(initialSavePath);
        const mimeExt = extensionFromMime(mime);
        if (!path.extname(finalSavePath) && mimeExt) {
          finalSavePath = `${finalSavePath}${mimeExt}`;
          if (!queuedSaveAsPath) {
            finalSavePath = ensureUniquePath(finalSavePath);
          }
        }
        item.setSavePath(finalSavePath);

        sendDownloadEvent('download-started', {
          id,
          url,
          mime,
          filename: path.basename(finalSavePath),
          savePath: finalSavePath,
          receivedBytes: 0,
          totalBytes: item.getTotalBytes ? item.getTotalBytes() : 0,
          percent: 0,
          state: 'progressing',
          startTime: Date.now(),
        }, webContents);
        console.warn('[Download] Download started, sending event to card window');

        item.on('updated', (e, state) => {
          try {
            const receivedBytes = item.getReceivedBytes ? item.getReceivedBytes() : 0;
            const totalBytes = item.getTotalBytes ? item.getTotalBytes() : 0;
            const percent = totalBytes > 0 ? Math.max(0, Math.min(1, receivedBytes / totalBytes)) : null;

            sendDownloadEvent('download-progress', {
              id,
              url,
              filename: item.getFilename ? item.getFilename() : path.basename(finalSavePath),
              savePath: item.getSavePath ? item.getSavePath() : finalSavePath,
              receivedBytes,
              totalBytes,
              percent,
              state,
            }, webContents);
          } catch (err) { }
        });

        item.once('done', (e, state) => {
          console.warn('[Download] Done event fired, state:', state, 'webContents:', webContents ? 'exists' : 'none');
          try {
            const receivedBytes = item.getReceivedBytes ? item.getReceivedBytes() : 0;
            const totalBytes = item.getTotalBytes ? item.getTotalBytes() : 0;
            const percent = totalBytes > 0 ? Math.max(0, Math.min(1, receivedBytes / totalBytes)) : null;
            const savePath = item.getSavePath ? item.getSavePath() : finalSavePath;

            const entry = {
              id,
              url,
              filename: item.getFilename ? item.getFilename() : path.basename(savePath),
              savePath,
              receivedBytes,
              totalBytes,
              percent,
              state, // completed | cancelled | interrupted
              endTime: Date.now(),
            };

            recordDownloadHistory(entry);
            sendDownloadEvent('download-done', entry, webContents);
          } catch (err) {
            console.error('[Download] Error in done handler:', err);
          }
        });
      } catch (err) {
        console.error('Error in will-download handler:', err);
      }
    });
  } catch (e) { }
}

// User action helpers
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  try {
    if (filePath) shell.showItemInFolder(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-visualizer-enabled', async (event, enabled) => {
  try {
    visualizerEnabled = !!enabled;
    broadcastVisualizerSetting(visualizerEnabled);
    return { success: true, enabled: visualizerEnabled };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-download-history', async () => {
  try {
    loadDownloadHistoryFromDisk();
    return { success: true, items: downloadHistory.slice(0, 200) };
  } catch (e) {
    return { success: false, items: [] };
  }
});

ipcMain.handle('get-visualizer-enabled', async () => {
  try {
    return visualizerEnabled;
  } catch (e) {
    return false;
  }
});

// Card theme management - store user's preferred theme for external URL cards
ipcMain.handle('set-card-theme', async (event, themeKey) => {
  try {
    const allowedThemes = new Set(['primary', 'sunset', 'ocean', 'emerald', 'amber', 'midnight', 'cocoa', 'alt']);
    if (allowedThemes.has(String(themeKey || '').toLowerCase())) {
      currentCardTheme = String(themeKey || '').toLowerCase();
      if (currentCardTheme === 'alt') currentCardTheme = 'sunset';
    }
    return { success: true, theme: currentCardTheme };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-card-theme', async () => {
  return currentCardTheme;
});

ipcMain.handle('set-card-launch-size-mode', async (event, mode) => {
  try {
    currentCardLaunchSizeMode = normalizeCardLaunchSizeMode(mode);
    return { success: true, mode: currentCardLaunchSizeMode };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-card-launch-size-mode', async () => {
  try {
    return currentCardLaunchSizeMode;
  } catch (e) {
    return CARD_LAUNCH_MODE_NORMAL;
  }
});

// Global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Handle app ready
app.on('ready', () => {
  console.log('[App] Ready event fired, starting app...');
  try {
    createMainWindow();
  } catch (error) {
    console.error('[App] Error in createMainWindow:', error);
  }
});

app.on('before-quit', () => {
  flushPermissionDecisionPersist();
  cleanupPrewarmedCardWindow();
});

app.on('window-all-closed', () => {
  cleanupPrewarmedCardWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

// Handle protocol URLs when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  // Create card directly for instant visual feedback
  createCardDirectly(url);
});

// Handle when launched with a URL (Windows)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance.
    const url = getUrlFromArgs(commandLine);
    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingStartupUrl = url || null;
      deferInitialMainShow = !!pendingStartupUrl;
      createMainWindow();
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (url) {
        // Create card directly for instant visual feedback
        createCardDirectly(url);
        return;
      }

      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createMainWindow() {
  console.log('[App] createMainWindow called');
  loadPermissionDecisionsFromDisk();

  let windowX = 100;
  let windowY = 20;
  const CARD_WIDTH = 800;
  const CARD_HEIGHT = 500;

  try {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    windowX = Math.floor((screenWidth - CARD_WIDTH) / 2);
    windowY = Math.floor((screenHeight - CARD_HEIGHT) / 2);
  } catch (e) {
    console.warn('Could not get screen dimensions, using default position');
  }

  mainWindow = new BrowserWindow({
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    x: windowX,
    y: windowY,
    icon: APP_ICON_PATH,
    minWidth: 800,
    minHeight: 500,
    show: false, // Don't show until ready - prevents white flash
    backgroundColor: '#1a1a2e', // Match your theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disable sandbox for better compatibility
      // PERFORMANCE BOOSTS:
      enableWebSQL: false, // Disable deprecated WebSQL
      spellcheck: true,
      enablePreferredSizeMode: true,
      // Allow Chromium to throttle background renderers so active video stays smoother.
      backgroundThrottling: true,
      offscreen: false,
    },
  });
  attachWindowHangRecovery(mainWindow, 'main-window');

  console.log('[App] BrowserWindow created');

  // Show window only when ready - prevents flash.
  // If app was launched via external URL, delay dashboard show so the site card appears first.
  mainWindow.once('ready-to-show', () => {
    if (!deferInitialMainShow) {
      mainWindow.show();
    }
  });

  mainWindow.loadFile('src/index.html').then(() => {
    console.log('[App] index.html loaded successfully');
  }).catch(err => {
    console.error('[App] Failed to load index.html:', err);
  });
  setupAddonBlocking();

  // Force any window.open/target=_blank to open as a card window
  try {
    mainWindow.webContents.setWindowOpenHandler(({ url, referrer }) => {
      let sourceUrl = '';
      try {
        sourceUrl = mainWindow.webContents.getURL();
      } catch (e) { }
      openUrlInCard(url, { sourceUrl, referrerUrl: referrer && referrer.url });
      return { action: 'deny' };
    });
  } catch (e) { }

  // Enable downloads for all sessions that can trigger downloads.
  try {
    setupDownloadHandlingForSession(session.defaultSession);
    const cardSession = session.fromPartition('persist:cards');
    setupDownloadHandlingForSession(cardSession);
    const webviewSession = session.fromPartition('persist:webview');
    setupDownloadHandlingForSession(webviewSession);
  } catch (e) {
    console.warn('Download handler setup failed:', e.message);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingStartupUrl) {
      // Create card directly for instant visual feedback
      createCardDirectly(pendingStartupUrl);
      pendingStartupUrl = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cardWindows.forEach((window) => {
      if (window && !window.isDestroyed()) {
        window.close();
      }
    });
    cleanupPrewarmedCardWindow();
  });

  scheduleCardPrewarm();
}

// ========================
// Addon Management
// ========================

let activeAddons = [];
let blocklist = new Set();
let blockExactHosts = new Set();
let blockSuffixHosts = [];
let blockSubstringPatterns = [];
const downloadHistory = []; // newest first
const DOWNLOAD_HISTORY_FILENAME = 'download-history.json';
let downloadHistoryLoaded = false;
let downloadPersistTimer = null;

function getDownloadHistoryFilePath() {
  try {
    return path.join(app.getPath('userData'), DOWNLOAD_HISTORY_FILENAME);
  } catch (e) {
    return '';
  }
}

function loadDownloadHistoryFromDisk() {
  if (downloadHistoryLoaded) return;
  downloadHistoryLoaded = true;
  const filePath = getDownloadHistoryFilePath();
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed && parsed.items) ? parsed.items : [];
    downloadHistory.length = 0;
    items.forEach((it) => {
      if (it && it.id) downloadHistory.push(it);
    });
  } catch (e) {
    console.warn('Failed to load download history:', e.message || e);
  }
}

function saveDownloadHistoryToDisk() {
  const filePath = getDownloadHistoryFilePath();
  if (!filePath) return;
  try {
    const payload = { version: 1, updatedAt: Date.now(), items: downloadHistory.slice(0, 200) };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to persist download history:', e.message || e);
  }
}

function scheduleDownloadHistoryPersist() {
  if (downloadPersistTimer) clearTimeout(downloadPersistTimer);
  // Persist immediately for new downloads to ensure renderer can fetch latest history
  saveDownloadHistoryToDisk();
}

function recordDownloadHistory(entry) {
  if (!entry || !entry.id) return;
  loadDownloadHistoryFromDisk();
  downloadHistory.unshift(entry);
  if (downloadHistory.length > 200) {
    downloadHistory.length = 200;
  }
  try {
    console.warn('[Downloads] Recorded', {
      id: entry.id,
      filename: entry.filename,
      savePath: entry.savePath,
      state: entry.state,
    });
  } catch (e) { }
  scheduleDownloadHistoryPersist();
}
const SOCIAL_ALLOWLIST_HOSTS = new Set([
  'facebook.com',
  'fb.com',
  'fbcdn.net',
  'fbsbx.com',
  'messenger.com',
  'instagram.com',
  'cdninstagram.com',
  'threads.net',
  'threads.com',
]);

const SECURITY_CHALLENGE_ALLOWLIST_HOSTS = new Set([
  'challenges.cloudflare.com',
  'cloudflare.com',
  'cloudflareinsights.com',
  'cloudflareaccess.com',
  'hcaptcha.com',
  'recaptcha.net',
  'gstatic.com',
]);

function isSocialAllowlistedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (SOCIAL_ALLOWLIST_HOSTS.has(host)) return true;
  for (const allowed of SOCIAL_ALLOWLIST_HOSTS) {
    if (host.endsWith('.' + allowed)) return true;
  }
  return false;
}

function isSecurityAllowlistedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (SECURITY_CHALLENGE_ALLOWLIST_HOSTS.has(host)) return true;
  for (const allowed of SECURITY_CHALLENGE_ALLOWLIST_HOSTS) {
    if (host.endsWith('.' + allowed)) return true;
  }
  return false;
}

function applyAddons(addonsArray) {
  // Build a blocklist based on addon metadata heuristics
  blocklist.clear();
  blockExactHosts.clear();
  blockSuffixHosts = [];
  blockSubstringPatterns = [];
  if (!Array.isArray(addonsArray)) return;

  // Comprehensive ad and tracking host blocklist (common ad networks)
  const defaultAdHosts = [
    // Google Ad Services
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adservice.google.com', 'googletagservices.com', 'googletagmanager.com',
    'google-analytics.com', 'analytics.google.com', 'googleanalytics.com',
    'pagead2.googlesyndication.com', 'tpc.googlesyndication.com',
    'googleads.g.doubleclick.net', 'ad.doubleclick.net',

    // Facebook & Meta ad endpoints (keep first-party app domains allowlisted below)
    'facebook.net',

    // Advertising Networks
    'criteo.com', 'criteo.net', 'criteo.xcdn.net',
    'rubiconproject.com', 'rubiconproject.net',
    'casalemedia.com', 'casaleads.com',
    'openx.net', 'openx.com', 'oxads.com',
    'pubmatic.com', 'pubmatic.net',
    'bidswitch.net', 'bidswitch.com',
    'districtm.io',
    'exponential.com', 'exponentialadserver.com',
    'turn.com', 'turn.net',
    'sonobi.com', 'sonobix.com',
    'lijit.com', 'sovrn.com',
    'media.net', 'contextual.media.net',
    'undertone.com',
    'conversantmedia.com', 'tradedeskadserver.com',
    'zedo.com', 'zedo-img.com',

    // Ad Tech Platforms
    'adtech.de', 'adtech.fr',
    'adroll.com', 'adrollcdn.com', 'adn.adroll.com',
    'rubycon.com', 'rubyconvert.com',
    'contentsquare.com',

    // Tracking Services
    'analytics', 'tracking', 'tracker',
    'mixpanel.com', 'api.mixpanel.com',
    'intercom.io', 'intercom-analytics.com',
    'fullstory.com', 'rs.fullstory.com',
    'newrelic.com', 'bam.nr-data.net',

    // Video Ad Networks
    'yumenetworks.com', 'yume.com',
    'tremor.com', 'tremorvideo.com',
    'spotxchange.com',
    'brightroll.com',

    // Ad Pattern Blockers
    'ads.', 'ad.', 'adv.', 'adserver', 'advertising',
  ];

  let hasAdBlocker = false;
  addonsArray.forEach(a => {
    if (a && a.enabled) {
      const name = (a.name || '').toLowerCase();
      const desc = (a.description || '').toLowerCase();

      // Detect ad blocker addons
      if (name.includes('ublock') || name.includes('adblock') ||
        name.includes('ad block') || name.includes('adblocker') ||
        desc.includes('block ads') || desc.includes('advertisement')) {
        hasAdBlocker = true;
        defaultAdHosts.forEach(h => blocklist.add(h));
      }
    }
  });

  if (!hasAdBlocker) {
    blocklist.clear();
    return;
  }

  // Compile blocklist once so request path does O(1)/small-array checks.
  for (const raw of blocklist) {
    const blocked = String(raw || '').toLowerCase().trim();
    if (!blocked) continue;
    const looksLikeHost = /^[a-z0-9.-]+$/.test(blocked) && !blocked.endsWith('.') && blocked.includes('.');
    if (looksLikeHost) {
      blockExactHosts.add(blocked);
      blockSuffixHosts.push(blocked);
    } else {
      blockSubstringPatterns.push(blocked);
    }
  }
}

function setupAddonBlocking() {
  if (!session || !session.defaultSession) {
    console.warn('Session not available for addon blocking');
    return;
  }

  // Ensure sessions use the Chrome-like UA for better challenge compatibility.
  try { session.defaultSession.setUserAgent(CHROME_LIKE_UA); } catch (e) { }

  const requestHandler = (details, callback) => {
    try {
      if (details && details.resourceType === 'mainFrame' && isAuthSensitiveUrl(details.url)) {
        let sourceUrl = '';
        try {
          if (details.webContentsId) {
            const wc = webContents.fromId(details.webContentsId);
            if (wc && !wc.isDestroyed()) sourceUrl = wc.getURL();
          }
        } catch (e) { }
        queueAuthRedirectExternally(details.url, {
          sourceUrl,
          referrerUrl: details.referrer || '',
        });
        return callback({ cancel: true });
      }

      const reqUrl = details.url || '';
      let hostname = '';

      try {
        hostname = new URL(reqUrl).hostname;
      } catch (e) {
        const match = reqUrl.match(/^https?:\/\/([^/?#]+)/);
        hostname = match ? match[1] : reqUrl;
      }

      if (blocklist.size > 0) {
        const host = String(hostname || '').toLowerCase();
        // Never block top-level navigations; only filter subresources.
        // Blocking a main frame can look like total connectivity failure.
        if (details && details.resourceType === 'mainFrame') {
          return callback({ cancel: false });
        }
        if (isSocialAllowlistedHost(host)) {
          return callback({ cancel: false });
        }
        if (isSecurityAllowlistedHost(host)) {
          return callback({ cancel: false });
        }

        if (blockExactHosts.has(host)) {
          return callback({ cancel: true });
        }

        for (const blocked of blockSuffixHosts) {
          if (host.endsWith('.' + blocked)) {
            return callback({ cancel: true });
          }
        }

        for (const pattern of blockSubstringPatterns) {
          if (host.includes(pattern)) {
            return callback({ cancel: true });
          }
        }
      }
    } catch (e) {
      console.error('[WebRequest] Error in blocking logic:', e.message);
    }

    return callback({ cancel: false });
  };

  const headerHandler = (details, callback) => {
    try {
      const url = details && details.url ? String(details.url) : '';
      const host = url ? new URL(url).hostname : '';
      if (isSecurityAllowlistedHost(host)) {
        const headers = Object.assign({}, details.requestHeaders);
        headers['User-Agent'] = CHROME_LIKE_UA;
        headers['sec-ch-ua'] = CH_UA;
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"Windows"';
        callback({ requestHeaders: headers });
        return;
      }
    } catch (e) { }
    callback({ requestHeaders: details.requestHeaders });
  };

  // Redirect handler kept minimal to avoid extra work in navigation hot path.
  const redirectHandler = (details) => {
    return;
  };

  session.defaultSession.webRequest.onBeforeRequest(requestHandler);
  session.defaultSession.webRequest.onBeforeSendHeaders(headerHandler);
  session.defaultSession.webRequest.onBeforeRedirect(redirectHandler);
  // Challenge request logging removed (noise in production).
  // Setup CSP override handler to allow external scripts like reCAPTCHA
  const cspOverrideHandler = (details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    let host = '';
    try {
      host = details && details.url ? String(new URL(details.url).hostname || '').toLowerCase() : '';
    } catch (e) { }
    // Keep normal browser behavior for most sites; only relax CSP for
    // known challenge/security hosts where external scripts are required.
    if (!isSecurityAllowlistedHost(host)) {
      callback({ responseHeaders });
      return;
    }
    // Remove or relax CSP headers to allow external scripts
    if (responseHeaders['Content-Security-Policy'] || responseHeaders['content-security-policy']) {
      // Allow Google scripts and other common external resources
      const csp = (responseHeaders['Content-Security-Policy'] || responseHeaders['content-security-policy'])[0];
      const relaxedCsp = csp
        .replace(/script-src\s+'none'/g, "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com")
        .replace(/object-src\s+'none'/g, "object-src 'self' data:")
        .replace(/frame-ancestors\s+'none'/g, "frame-ancestors *");
      responseHeaders['Content-Security-Policy'] = [relaxedCsp];
      responseHeaders['content-security-policy'] = [relaxedCsp];
    }
    callback({ responseHeaders });
  };

  configurePermissionHandlersForSession(session.defaultSession);

  const cardPartition = 'persist:cards';
  const cardSession = session.fromPartition(cardPartition);
  if (cardSession && cardSession.webRequest) {
    try { cardSession.setUserAgent(CHROME_LIKE_UA); } catch (e) { }
    cardSession.webRequest.onBeforeRequest(requestHandler);
    cardSession.webRequest.onBeforeSendHeaders(headerHandler);
    cardSession.webRequest.onBeforeRedirect(redirectHandler);
    cardSession.webRequest.onHeadersReceived(cspOverrideHandler);
    // Challenge request logging removed (noise in production).

    configurePermissionHandlersForSession(cardSession);
  }

  const defaultPartition = 'persist:webview';
  const webviewSession = session.fromPartition(defaultPartition);
  if (webviewSession && webviewSession.webRequest) {
    try { webviewSession.setUserAgent(CHROME_LIKE_UA); } catch (e) { }
    webviewSession.webRequest.onBeforeRequest(requestHandler);
    webviewSession.webRequest.onBeforeSendHeaders(headerHandler);
    webviewSession.webRequest.onBeforeRedirect(redirectHandler);
    webviewSession.webRequest.onHeadersReceived(cspOverrideHandler);
    // Challenge request logging removed (noise in production).
    configurePermissionHandlersForSession(webviewSession);
  }
}

// ========================
// IPC Handlers for Card Windows
// ========================

// Enhanced create-card handler with beautiful animations
ipcMain.handle('create-card', async (event, cardId, url, position, themeKey = 'primary') => {
  try {
    const allowedThemes = new Set(['primary', 'sunset', 'ocean', 'emerald', 'amber', 'midnight', 'cocoa', 'alt']);
    const normalizedTheme = allowedThemes.has(String(themeKey || '').toLowerCase())
      ? String(themeKey || '').toLowerCase()
      : 'primary';
    const cardTheme = normalizedTheme === 'alt' ? 'sunset' : normalizedTheme;

    let targetUrl = normalizeTypedNavigationTarget(url);
    if (!targetUrl) {
      return { success: false, error: 'Invalid or unsupported URL scheme' };
    }

    if (isAuthSensitiveUrl(targetUrl)) {
      queueAuthRedirectExternally(targetUrl);
      if (deferInitialMainShow) {
        deferInitialMainShow = false;
        pendingStartupUrl = null;
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.show();
        }
      }
      return { success: false, externalOpened: true, reason: 'auth-url-opened-externally' };
    }

    const launchMode = normalizeCardLaunchSizeMode(currentCardLaunchSizeMode);
    const launchSize = getLaunchWindowSizeByMode(launchMode);

    // Calculate center position if not provided
    let finalX = position && Number.isFinite(Number(position.x)) ? Number(position.x) : null;
    let finalY = position && Number.isFinite(Number(position.y)) ? Number(position.y) : null;

    if (!Number.isFinite(finalX) || !Number.isFinite(finalY)) {
      try {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

        finalX = Math.floor((screenWidth - launchSize.width) / 2);
        finalY = Math.floor((screenHeight - launchSize.height) / 2) + CARD_LAUNCH_VERTICAL_OFFSET;
      } catch (e) {
        // Fallback to default centered position
        finalX = 200;
        finalY = 150;
      }
    }

    // Create floating card window with visible background for instant display
    const cardWindow = new BrowserWindow({
      width: launchSize.width,
      height: launchSize.height,
      x: finalX,
      y: finalY,
      icon: APP_ICON_PATH,
      frame: false,
      transparent: true, // Enable transparency for smooth animations
      resizable: true,
      skipTaskbar: false,
      show: true, // Show immediately for instant visual feedback
      backgroundColor: '#00000000', // Transparent for rounded corners from HTML
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: true,
        preload: path.join(__dirname, 'preload-card.js'),
        // PERFORMANCE OPTIMIZATIONS:
        enableWebSQL: false,
        spellcheck: true,
        // Keep card renderers fully responsive for split-screen media playback.
        backgroundThrottling: false,
        enablePreferredSizeMode: true,
        partition: 'persist:cards',
      },
    });
    attachWindowHangRecovery(cardWindow, `card-${cardId}`);

    if (launchMode === CARD_LAUNCH_MODE_FULLSCREEN) {
      cardWindow.once('ready-to-show', () => {
        try {
          if (!cardWindow.isDestroyed()) cardWindow.setFullScreen(true);
        } catch (e) { }
      });
    }

    // Store reference before loading
    cardWindows.set(cardId, cardWindow);

    // Force any window.open/target=_blank to open as a card window
    try {
      cardWindow.webContents.setWindowOpenHandler(({ url, referrer }) => {
        let sourceUrl = '';
        try {
          sourceUrl = cardWindow.webContents.getURL();
        } catch (e) { }
        openUrlInCard(url, { sourceUrl, referrerUrl: referrer && referrer.url });
        return { action: 'deny' };
      });
    } catch (e) { }

    // Load the actual card HTML directly without placeholder for faster startup
    const encodedUrl = Buffer.from(targetUrl).toString('base64');
    const cardHtmlPath = path.join(__dirname, 'src', 'card.html');
    // Use loadFile instead of loadURL to properly handle query parameters on Windows
    cardWindow.loadFile(cardHtmlPath, {
      query: {
        cardId: String(cardId),
        url: encodedUrl,
        theme: cardTheme
      }
    }).catch((err) => {
      console.error('Error loading card HTML:', err);
    });

    // Setup event listeners with guards for destroyed windows
    cardWindow.webContents.on('did-start-loading', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-loading-start', cardId);
      }
    });

    cardWindow.webContents.on('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed() && cardWindow && !cardWindow.isDestroyed()) {
        const pageTitle = cardWindow.webContents.getTitle();
        const currentUrl = cardWindow.webContents.getURL();
        mainWindow.webContents.send('card-loading-finish', cardId, pageTitle, currentUrl);
      }
      try {
        if (cardWindow && !cardWindow.isDestroyed() && cardWindow.webContents && !cardWindow.webContents.isDestroyed()) {
          cardWindow.webContents.send('visualizer-setting', !!visualizerEnabled);
        }
      } catch (e) { }
    });

    cardWindow.webContents.on('did-navigate', (event, url) => {
      if (mainWindow && !mainWindow.isDestroyed() && cardWindow && !cardWindow.isDestroyed()) {
        mainWindow.webContents.send('card-url-updated', cardId, url);
        mainWindow.webContents.send('card-title-updated', cardId, cardWindow.webContents.getTitle());
      }
    });

    cardWindow.webContents.on('page-title-updated', (event, title) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-title-updated', cardId, title);
      }
    });

    cardWindow.on('show', () => {
      closeCardBubble(cardId);
    });

    cardWindow.on('closed', () => {
      closeCardBubble(cardId);
      cardWindows.delete(cardId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-closed', cardId);
      }
    });

    if (deferInitialMainShow) {
      deferInitialMainShow = false;
      pendingStartupUrl = null;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }

    return { success: true, cardId };
  } catch (error) {
    console.error('Error creating card:', error);
    if (deferInitialMainShow) {
      deferInitialMainShow = false;
      pendingStartupUrl = null;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }
    return { success: false, error: error.message };
  }
});

// Update card window position (for dragging)
ipcMain.handle('update-card-position', async (event, cardId, x, y) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.setPosition(Math.floor(x), Math.floor(y));
    return { success: true };
  } catch (error) {
    console.error('Error updating position:', error);
    return { success: false, error: error.message };
  }
});

// Navigate card to URL
ipcMain.handle('navigate-card', async (event, cardId, url) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    let targetUrl = normalizeTypedNavigationTarget(url);
    if (!targetUrl) {
      return { success: false, error: 'Invalid or unsupported URL scheme' };
    }

    if (isAuthSensitiveUrl(targetUrl)) {
      queueAuthRedirectExternally(targetUrl);
      return { success: false, externalOpened: true, reason: 'auth-url-opened-externally' };
    }

    try {
      cardWindow.webContents.send('card-load-url', targetUrl);
      return { success: true };
    } catch (err) {
      cardWindow.webContents.loadURL(targetUrl);
      return { success: true };
    }
  } catch (error) {
    console.error('Error navigating card:', error);
    return { success: false, error: error.message };
  }
});

// Close card
ipcMain.handle('close-card', async (event, cardId) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.close();
    return { success: true };
  } catch (error) {
    console.error('Error closing card:', error);
    return { success: false, error: error.message };
  }
});

// Navigation: Go Back
ipcMain.handle('card-go-back', async (event, cardId) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    if (cardWindow.webContents.canGoBack()) {
      cardWindow.webContents.goBack();
    }
    return { success: true };
  } catch (error) {
    console.error('Error going back:', error);
    return { success: false, error: error.message };
  }
});

// Navigation: Go Forward
ipcMain.handle('card-go-forward', async (event, cardId) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    if (cardWindow.webContents.canGoForward()) {
      cardWindow.webContents.goForward();
    }
    return { success: true };
  } catch (error) {
    console.error('Error going forward:', error);
    return { success: false, error: error.message };
  }
});

// Navigation: Reload
ipcMain.handle('card-reload', async (event, cardId) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.webContents.reload();
    return { success: true };
  } catch (error) {
    console.error('Error reloading:', error);
    return { success: false, error: error.message };
  }
});

// Resize card window
ipcMain.handle('resize-card', async (event, cardId, x, y, width, height) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.setBounds({
      x: Math.floor(x),
      y: Math.floor(y),
      width: Math.floor(width),
      height: Math.floor(height)
    });

    return { success: true };
  } catch (error) {
    console.error('Error resizing card:', error);
    return { success: false, error: error.message };
  }
});

// Toggle fullscreen
ipcMain.handle('toggle-fullscreen', async (event, cardId, shouldBeFullscreen) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.setFullScreen(shouldBeFullscreen);
    return { success: true };
  } catch (error) {
    console.error('Error toggling fullscreen:', error);
    return { success: false, error: error.message };
  }
});

// Minimize card window
ipcMain.handle('minimize-card', async (event, cardId, pageUrl = '', pageTitle = '', themeKey = 'primary') => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    createCardBubble(cardId, cardWindow, { pageUrl, pageTitle, themeKey });
    cardWindow.hide();
    return { success: true };
  } catch (error) {
    console.error('Error minimizing card:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-card-from-bubble', async (event, cardId) => {
  try {
    return restoreCardFromBubble(cardId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Close bubble and associated card window
ipcMain.handle('close-bubble-and-card', async (event, cardId) => {
  try {
    // First close the card window if it exists
    const cardWindow = cardWindows.get(cardId);
    if (cardWindow && !cardWindow.isDestroyed()) {
      try {
        cardWindow.close();
      } catch (e) { }
    }
    // Then close the bubble
    closeCardBubble(cardId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Show context menu for bubble
ipcMain.handle('show-bubble-context-menu', async (event, cardId) => {
  const { Menu } = require('electron');
  const menu = new Menu();

  menu.append(new MenuItem({
    label: 'Close Card',
    click: async () => {
      // Close both card and bubble
      const cardWindow = cardWindows.get(cardId);
      if (cardWindow && !cardWindow.isDestroyed()) {
        try { cardWindow.close(); } catch (e) { }
      }
      closeCardBubble(cardId);
    }
  }));

  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// Open URL as a bubble (minimized card window)
ipcMain.handle('open-url-as-bubble', async (event, url, meta = {}) => {
  try {
    const result = openUrlAsBubble(url, meta);
    if (!result) {
      return { success: false, error: 'Failed to create bubble' };
    }
    return { success: true, cardId: result.cardId };
  } catch (error) {
    console.error('Error opening URL as bubble:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-user-agent', async () => {
  return CHROME_LIKE_UA;
});

// Title updates from embedded webview inside card window
ipcMain.on('webview-title-updated', (event, payload) => {
  try {
    const cardId = payload && typeof payload.cardId === 'number' ? payload.cardId : Number(payload && payload.cardId);
    const title = payload && payload.title ? String(payload.title) : '';
    if (!cardId || !title) return;
    if (!cardBubbles.has(cardId)) return;
    const parsedCount = extractTitleNotificationCount(title);
    if (parsedCount !== null) {
      updateBubbleNotification(cardId, parsedCount, 'title');
    } else if (bubbleNotificationSources.get(cardId) === 'title') {
      updateBubbleNotification(cardId, 0, 'title');
    }
  } catch (e) { }
});

ipcMain.on('webview-console-message', (event, payload) => {
  try {
    const msg = payload && payload.message ? String(payload.message) : '';
    if (!msg) return;
    const sourceId = payload && payload.sourceId ? String(payload.sourceId) : '';
    // Filter noisy report-only CSP logs and STUN resolution noise.
    if (/^\[Report Only\]\s+Refused to evaluate/i.test(msg)) return;
    if (/stun\.l\.google\.com|socket_manager\.cc|errorcode:\s*-105/i.test(msg)) return;
    if (/ttwstatic\.com|tiktok_web_login_static/i.test(sourceId) && /Content Security Policy|unsafe-eval/i.test(msg)) return;
    if (!/turnstile|cloudflare|captcha|challenge/i.test(msg)) return;
    console.warn('[Webview Console]', {
      cardId: payload.cardId,
      level: payload.level,
      message: msg,
      line: payload.line,
      sourceId,
    });
  } catch (e) { }
});

const recentChallengeRedirects = new Map(); // cardId -> timestamp

ipcMain.on('cloudflare-challenge', (event, payload) => {
  try {
    const cardId = payload && typeof payload.cardId === 'number' ? payload.cardId : Number(payload && payload.cardId);
    const now = Date.now();
    const last = recentChallengeRedirects.get(cardId) || 0;
    if (now - last < 4000) return;
    recentChallengeRedirects.set(cardId, now);
    const targetUrl = String(payload && (payload.targetUrl || payload.challengeUrl) || '').trim();
    if (!targetUrl) return;
    const cardWindow = cardWindows.get(cardId);
    if (cardWindow && !cardWindow.isDestroyed()) {
      cardWindow.webContents.send('cloudflare-challenge-banner', { url: targetUrl });
    }
  } catch (e) { }
});

ipcMain.on('open-external-challenge', (event, payload) => {
  try {
    const targetUrl = String(payload && payload.url || '').trim();
    if (!targetUrl) return;
    openExternalBrowserForChallenge(targetUrl);
  } catch (e) { }
});

// Handle web notifications from card windows - increment bubble notification count
ipcMain.on('web-notification', (event, payload) => {
  try {
    // Find the cardId for this webContents
    const webContentsId = event.sender.id;
    for (const [cardId, cardWindow] of cardWindows) {
      if (cardWindow && !cardWindow.isDestroyed() && cardWindow.webContents) {
        if (cardWindow.webContents.id === webContentsId) {
          // Check if this card has a bubble (is minimized)
          if (cardBubbles.has(cardId)) {
            incrementBubbleNotification(cardId);
          }
          break;
        }
      }
    }
  } catch (e) {
    console.error('Error handling web notification:', e);
  }
});

// Clear bubble notifications when card is restored
ipcMain.handle('clear-bubble-notifications', async (event, cardId) => {
  try {
    clearBubbleNotifications(cardId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('confirm-auth-open-external', async (event, requestId) => {
  try {
    if (!requestId || !pendingAuthRedirects.has(requestId)) {
      return { success: false, error: 'Auth redirect request not found or expired' };
    }
    const pending = pendingAuthRedirects.get(requestId);
    pendingAuthRedirects.delete(requestId);
    const result = openAuthInExternalBrowser(pending.launchUrl || pending.authUrl || '');
    if (!result || !result.opened) {
      return { success: false, error: 'Failed to open external browser' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-auth-open-external', async (event, requestId) => {
  try {
    if (requestId && pendingAuthRedirects.has(requestId)) {
      pendingAuthRedirects.delete(requestId);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Bookmark management - folders stored directly in main process
let bookmarkFolders = [];

// Renderer syncs its folders to main whenever they change
ipcMain.handle('sync-bookmark-folders', async (event, folders) => {
  bookmarkFolders = folders || [];
  return { success: true };
});

// Card window: remove a bookmark (toggle off)
ipcMain.handle('toggle-bookmark', async (event, bookmarkData) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-bookmark', bookmarkData);
    }
    // Also remove from local copy
    bookmarkFolders.forEach(folder => {
      folder.bookmarks = folder.bookmarks.filter(b => b.url !== bookmarkData.url);
    });
    return { success: true };
  } catch (error) {
    console.error('Error toggling bookmark:', error);
    return { success: false, error: error.message };
  }
});

// Card window: check if URL is bookmarked â€” answered directly, no round-trip
ipcMain.handle('is-bookmarked', async (event, url) => {
  for (const folder of bookmarkFolders) {
    if (folder.bookmarks && folder.bookmarks.some(b => b.url === url)) {
      return true;
    }
  }
  return false;
});

// Card window: get folder list â€” answered directly, no round-trip
ipcMain.handle('get-bookmark-folders', async (event) => {
  return bookmarkFolders.map(f => ({
    id: f.id,
    name: f.name,
    count: f.bookmarks ? f.bookmarks.length : 0
  }));
});

// Card window: save bookmark to a specific folder
ipcMain.handle('save-bookmark-to-folder', async (event, bookmarkData, folderId) => {
  try {
    // Update local copy
    const folder = bookmarkFolders.find(f => f.id === folderId);
    if (folder) {
      if (!folder.bookmarks) folder.bookmarks = [];
      folder.bookmarks.push(bookmarkData);
    }
    // Tell renderer to update its copy and persist to localStorage
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save-bookmark-to-folder', bookmarkData, folderId);
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving bookmark to folder:', error);
    return { success: false, error: error.message };
  }
});

// Password manager is disabled until secure OS-backed storage is implemented.
ipcMain.handle('sync-passwords', async () => {
  return { success: false, disabled: true };
});

ipcMain.handle('save-password', async () => {
  return { success: false, disabled: true };
});

// Update addons metadata from renderer
ipcMain.handle('update-addons', async (event, addonsArray) => {
  try {
    activeAddons = Array.isArray(addonsArray) ? addonsArray : [];
    applyAddons(activeAddons);
    return { success: true };
  } catch (error) {
    console.error('Error updating addons:', error);
    return { success: false, error: error.message };
  }
});

// Add manual default browser setting method
function openDefaultAppsSettings() {
  if (process.platform === 'win32') {
    const { shell } = require('electron');
    shell.openExternal('ms-settings:defaultapps');
  }
}

function parseVersionParts(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const segments = cleaned.split('.').map((part) => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (segments.length < 3) segments.push(0);
  return segments.slice(0, 3);
}

function compareVersions(a, b) {
  const av = parseVersionParts(a);
  const bv = parseVersionParts(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] > bv[i]) return 1;
    if (av[i] < bv[i]) return -1;
  }
  return 0;
}

function getConfiguredUpdateUrl() {
  const fallback = 'https://gitlab.com/moderntechgroup/discovery-web/-/releases';
  const candidate = String(process.env.DISCOVERY_UPDATE_URL || fallback).trim();
  if (!isHttpUrl(candidate)) return fallback;
  return candidate;
}

function getConfiguredUpdateCheckUrl() {
  const fallback = 'https://discovery-browser.onrender.com';
  const candidate = String(process.env.DISCOVERY_UPDATE_CHECK_URL || fallback).trim();
  if (!isHttpUrl(candidate)) return fallback;
  return candidate;
}

function extractVersionFromAnyPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') {
    const match = payload.match(/\b\d+\.\d+\.\d+\b/);
    return match ? match[0] : '';
  }
  if (typeof payload === 'object') {
    const candidates = [
      payload.latestVersion,
      payload.latest_version,
      payload.version,
      payload.appVersion,
      payload.app_version,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

async function fetchLatestVersionFromRemote() {
  const sourceUrl = getConfiguredUpdateCheckUrl();
  const endpoints = [sourceUrl];
  if (sourceUrl.endsWith('/')) {
    endpoints.push(`${sourceUrl}version.json`);
    endpoints.push(`${sourceUrl}update.json`);
    endpoints.push(`${sourceUrl}api/version`);
  } else {
    endpoints.push(`${sourceUrl}/version.json`);
    endpoints.push(`${sourceUrl}/update.json`);
    endpoints.push(`${sourceUrl}/api/version`);
  }

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { 'accept': 'application/json,text/plain,*/*' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res || !res.ok) continue;

      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      let version = '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        version = extractVersionFromAnyPayload(json);
      } else {
        const text = await res.text();
        version = extractVersionFromAnyPayload(text);
      }

      if (version) {
        return { latestVersion: version, source: endpoint };
      }
    } catch (e) {
      // Try next endpoint.
    }
  }

  return { latestVersion: '', source: sourceUrl };
}

ipcMain.handle('get-update-status', async () => {
  try {
    const currentVersion = String(app.getVersion ? app.getVersion() : '0.0.0');
    const remote = await fetchLatestVersionFromRemote();
    const envLatestVersion = String(process.env.DISCOVERY_LATEST_VERSION || '').trim();
    const latestVersion = String(remote.latestVersion || envLatestVersion || '').trim();
    const updateUrl = getConfiguredUpdateUrl();
    const updateMessage = String(process.env.DISCOVERY_UPDATE_MESSAGE || '').trim();
    const hasLatest = latestVersion.length > 0;
    const isUpdateAvailable = hasLatest ? compareVersions(latestVersion, currentVersion) > 0 : false;

    return {
      success: true,
      currentVersion,
      latestVersion: hasLatest ? latestVersion : currentVersion,
      isUpdateAvailable,
      updateUrl,
      checkedFrom: remote.source || getConfiguredUpdateCheckUrl(),
      updateMessage: updateMessage || (isUpdateAvailable
        ? `Version ${latestVersion} is available.`
        : `You are running the latest version (${currentVersion}).`)
    };
  } catch (error) {
    return {
      success: false,
      error: error && error.message ? error.message : 'Failed to read update status',
      currentVersion: String(app.getVersion ? app.getVersion() : '0.0.0'),
      latestVersion: '',
      isUpdateAvailable: false,
      updateUrl: getConfiguredUpdateUrl(),
      updateMessage: 'Unable to check update status right now.'
    };
  }
});

ipcMain.handle('open-update-download', async () => {
  try {
    const updateUrl = getConfiguredUpdateUrl();
    if (!/^https:\/\//i.test(updateUrl)) {
      return { success: false, error: 'Update URL must use HTTPS' };
    }
    await shell.openExternal(updateUrl);
    return { success: true };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : 'Failed to open update URL' };
  }
});

// Set as default browser
ipcMain.handle('set-as-default-browser-ui', async () => {
  try {
    // Try to set as default programmatically first
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');

    // Then open Windows settings to allow manual confirmation
    openDefaultAppsSettings();

    return { success: true };
  } catch (error) {
    console.error('Error setting as default:', error);
    return { success: false, error: error.message };
  }
});

// Check if app is already the default browser
ipcMain.handle('is-default-browser-ui', async () => {
  try {
    // In dev mode Electron needs the same execPath/args used during registration,
    // otherwise isDefaultProtocolClient() often reports false after restart.
    const isDefaultFor = (scheme) => {
      if (!app.isPackaged && process.defaultApp && process.argv.length >= 2) {
        return app.isDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
      }
      return app.isDefaultProtocolClient(scheme);
    };

    const isHttp = isDefaultFor('http');
    const isHttps = isDefaultFor('https');
    return isHttp && isHttps;
  } catch (error) {
    console.error('Error checking default browser status:', error);
    return false;
  }
});
