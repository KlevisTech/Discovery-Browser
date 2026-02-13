// main.js
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { Menu, MenuItem } = require('electron');

// GPU stability flags
// Keep GPU sandbox enabled by default. Allow disabling only in development for troubleshooting.
if (!app.isPackaged && process.env.DISCOVERY_DISABLE_GPU_SANDBOX === '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // Updated flag name (ignore-gpu-blacklist is deprecated)
app.commandLine.appendSwitch('use-angle', 'd3d11'); // Use D3D11 ANGLE backend for Windows stability
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder'); // Hardware video decode


// Disable unnecessary features
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

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
  } catch (e) {}

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
              try { contents.replaceMisspelling(word); } catch (e) {}
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
          } catch (e) {}
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
  } catch (e) {}
  try {
    callback(false);
  } catch (e) {}
  try {
    console.warn('[TLS] Blocked certificate error', { url, error });
  } catch (e) {}
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
let visualizerEnabled = false;
const pendingAuthRedirects = new Map(); // requestId -> { authUrl, launchUrl, createdAt }
const recentAuthRedirects = new Map(); // dedupeKey -> { ts, requestId }

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
  } catch (e) {}
  cardBubbles.delete(cardId);
}

function deriveBubbleLabel(pageTitle, pageUrl) {
  const title = String(pageTitle || '').trim();
  if (title) {
    const ch = title.replace(/^[^a-zA-Z0-9]+/, '').charAt(0);
    if (ch) return ch.toUpperCase();
  }
  try {
    const parsed = new URL(String(pageUrl || ''));
    const host = String(parsed.hostname || '').replace(/^www\./i, '');
    const ch = host.replace(/^[^a-zA-Z0-9]+/, '').charAt(0);
    if (ch) return ch.toUpperCase();
  } catch (e) {}
  return 'D';
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
    } catch (e) {}
    if (!title && meta && meta.pageTitle) title = String(meta.pageTitle);
    if (!title) title = `Card ${cardId}`;
    const label = deriveBubbleLabel(meta && meta.pageTitle, meta && meta.pageUrl);

    const bubbleWindow = new BrowserWindow({
      width: bubbleSize,
      height: bubbleSize,
      x: startX,
      y: startY,
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

    try {
      bubbleWindow.setAlwaysOnTop(true, 'floating');
    } catch (e) {
      bubbleWindow.setAlwaysOnTop(true);
    }

    const bubbleTheme = String((meta && meta.themeKey) || 'primary').toLowerCase();
    const bubbleUrl = `file://${path.join(__dirname, 'src', 'card-bubble.html').replace(/\\/g, '/')}?cardId=${encodeURIComponent(String(cardId))}&title=${encodeURIComponent(title)}&label=${encodeURIComponent(label)}&theme=${encodeURIComponent(bubbleTheme)}`;
    bubbleWindow.loadURL(bubbleUrl).catch((err) => {
      console.error('Error loading card bubble:', err);
    });
    bubbleWindow.once('ready-to-show', () => {
      if (!bubbleWindow.isDestroyed()) bubbleWindow.show();
    });
    bubbleWindow.on('closed', () => {
      cardBubbles.delete(cardId);
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
    if (cardWindow.isMinimized()) cardWindow.restore();
    cardWindow.show();
    cardWindow.focus();
    try {
      if (cardWindow.webContents && !cardWindow.webContents.isDestroyed()) {
        cardWindow.webContents.send('card-restore-animate');
      }
    } catch (e) {}
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
    } catch (e) {}
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
    if (!executablePath || !fs.existsSync(executablePath)) return false;
    const proc = spawn(executablePath, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.unref();
    return true;
  } catch (e) {
    return false;
  }
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
      path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const candidate of browserCandidates) {
      if (launchBrowserExecutable(candidate, launchUrl)) {
        return { opened: true, launchUrl };
      }
    }
  }

  try {
    shell.openExternal(launchUrl);
    return { opened: true, launchUrl };
  } catch (e) {
    return { opened: false, launchUrl: null };
  }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-external-url', targetUrl);
    }
  } catch (e) {
    // ignore
  }
}

// ========================
// Downloads
// ========================

const downloadIdByItem = new WeakMap();
const downloadHandlerSessions = new WeakSet();

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
  } catch (e) {}
  return savePath;
}

function sendDownloadEvent(channel, payload, originatingWebContents) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (e) {}

  // Also send to the specific BrowserWindow that initiated the download (e.g. card window)
  try {
    if (originatingWebContents) {
      const win = BrowserWindow.fromWebContents(originatingWebContents);
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  } catch (e) {}
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
          } catch (err) {}
        });

        item.once('done', (e, state) => {
          try {
            const receivedBytes = item.getReceivedBytes ? item.getReceivedBytes() : 0;
            const totalBytes = item.getTotalBytes ? item.getTotalBytes() : 0;
            const percent = totalBytes > 0 ? Math.max(0, Math.min(1, receivedBytes / totalBytes)) : null;
            const savePath = item.getSavePath ? item.getSavePath() : finalSavePath;

            sendDownloadEvent('download-done', {
              id,
              url,
              filename: item.getFilename ? item.getFilename() : path.basename(savePath),
              savePath,
              receivedBytes,
              totalBytes,
              percent,
              state, // completed | cancelled | interrupted
              endTime: Date.now(),
            }, webContents);
          } catch (err) {}
        });
      } catch (err) {
        console.error('Error in will-download handler:', err);
      }
    });
  } catch (e) {}
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

ipcMain.handle('get-visualizer-enabled', async () => {
  try {
    return visualizerEnabled;
  } catch (e) {
    return false;
  }
});

// Global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Handle app ready
app.on('ready', createMainWindow);

app.on('before-quit', () => {
  flushPermissionDecisionPersist();
});

app.on('window-all-closed', () => {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Create a new card with the URL
    mainWindow.webContents.send('open-external-url', url);
  }
});

// Handle when launched with a URL (Windows)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance.
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Use the helper to find the URL in the command line.
      const url = getUrlFromArgs(commandLine);
      if (url) {
        // URL-first: open the site card without forcing dashboard focus first.
        mainWindow.webContents.send('open-external-url', url);
        return;
      }

      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createMainWindow() {
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
    minWidth: 800,
    minHeight: 500,
    show: false, // Don't show until ready - prevents white flash
    backgroundColor: '#1a1a2e', // Match your theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // PERFORMANCE BOOSTS:
      enableWebSQL: false, // Disable deprecated WebSQL
      spellcheck: true,
      enablePreferredSizeMode: true,
      // Allow Chromium to throttle background renderers so active video stays smoother.
      backgroundThrottling: true,
      offscreen: false,
    },
  });

  // Show window only when ready - prevents flash.
  // If app was launched via external URL, delay dashboard show so the site card appears first.
  mainWindow.once('ready-to-show', () => {
    if (!deferInitialMainShow) {
      mainWindow.show();
    }
  });

  mainWindow.loadFile('src/index.html');
  setupAddonBlocking();

  // Force any window.open/target=_blank to open as a card window
  try {
    mainWindow.webContents.setWindowOpenHandler(({ url, referrer }) => {
      let sourceUrl = '';
      try {
        sourceUrl = mainWindow.webContents.getURL();
      } catch (e) {}
      openUrlInCard(url, { sourceUrl, referrerUrl: referrer && referrer.url });
      return { action: 'deny' };
    });
  } catch (e) {}

  // Enable downloads for both the main session and card partition session
  try {
    setupDownloadHandlingForSession(session.defaultSession);
    const cardSession = session.fromPartition('persist:cards');
    setupDownloadHandlingForSession(cardSession);
  } catch (e) {
    console.warn('Download handler setup failed:', e.message);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingStartupUrl) {
      mainWindow.webContents.send('open-external-url', pendingStartupUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cardWindows.forEach((window) => {
      if (window && !window.isDestroyed()) {
        window.close();
      }
    });
  });
}

// ========================
// Addon Management
// ========================

let activeAddons = [];
let blocklist = new Set();
let blockExactHosts = new Set();
let blockSuffixHosts = [];
let blockSubstringPatterns = [];
const SOCIAL_ALLOWLIST_HOSTS = new Set([
  'facebook.com',
  'fb.com',
  'fbcdn.net',
  'fbsbx.com',
  'messenger.com',
  'instagram.com',
  'cdninstagram.com',
  'threads.net',
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
  
  const requestHandler = (details, callback) => {
    try {
      if (details && details.resourceType === 'mainFrame' && isAuthSensitiveUrl(details.url)) {
        let sourceUrl = '';
        try {
          if (details.webContentsId) {
            const wc = webContents.fromId(details.webContentsId);
            if (wc && !wc.isDestroyed()) sourceUrl = wc.getURL();
          }
        } catch (e) {}
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
        if (isSocialAllowlistedHost(host)) {
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
  
  // Redirect handler kept minimal to avoid extra work in navigation hot path.
  const redirectHandler = (details) => {
    return;
  };
  
  session.defaultSession.webRequest.onBeforeRequest(requestHandler);
  session.defaultSession.webRequest.onBeforeRedirect(redirectHandler);
  configurePermissionHandlersForSession(session.defaultSession);
  
  const cardPartition = 'persist:cards';
  const cardSession = session.fromPartition(cardPartition);
  if (cardSession && cardSession.webRequest) {
    cardSession.webRequest.onBeforeRequest(requestHandler);
    cardSession.webRequest.onBeforeRedirect(redirectHandler);
    
    configurePermissionHandlersForSession(cardSession);
  }
  
  const defaultPartition = 'persist:webview';
  const webviewSession = session.fromPartition(defaultPartition);
  if (webviewSession && webviewSession.webRequest) {
    webviewSession.webRequest.onBeforeRequest(requestHandler);
    webviewSession.webRequest.onBeforeRedirect(redirectHandler);
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

    // Calculate center position if not provided
    let finalX = position.x;
    let finalY = position.y;
    
    if (!position.x || !position.y) {
      try {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        // Center the card on screen
        finalX = Math.floor((screenWidth - 650) / 2);
        finalY = Math.floor((screenHeight - 500) / 2);
      } catch (e) {
        // Fallback to default centered position
        finalX = 200;
        finalY = 150;
      }
    }

    // Create floating card window with initial hidden state for animation
    const cardWindow = new BrowserWindow({
      width: 800,
      height: 500,
      x: finalX,
      y: finalY,
      frame: false,
      transparent: true, // Enable transparency for smooth animations
      resizable: true,
      skipTaskbar: false,
      show: false, // Show immediately after creation for faster perceived startup
      backgroundColor: '#00000000', // Fully transparent background
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: true,
        preload: path.join(__dirname, 'preload-card.js'),
        // PERFORMANCE OPTIMIZATIONS:
        enableWebSQL: false,
        spellcheck: true,
        // Keep focused card responsive by reducing background contention from other cards.
        backgroundThrottling: true,
        enablePreferredSizeMode: true,
        partition: 'persist:cards',
      },
    });

    // Store reference before loading
    cardWindows.set(cardId, cardWindow);

    // Force any window.open/target=_blank to open as a card window
    try {
      cardWindow.webContents.setWindowOpenHandler(({ url, referrer }) => {
        let sourceUrl = '';
        try {
          sourceUrl = cardWindow.webContents.getURL();
        } catch (e) {}
        openUrlInCard(url, { sourceUrl, referrerUrl: referrer && referrer.url });
        return { action: 'deny' };
      });
    } catch (e) {}

    // Show window shell immediately; load card content asynchronously.
    cardWindow.setOpacity(1);
    cardWindow.show();

    // Load the card HTML without blocking window display.
    const encodedUrl = Buffer.from(targetUrl).toString('base64');
    const cardHtmlUrl = `file://${path.join(__dirname, 'src', 'card.html').replace(/\\/g, '/')}?cardId=${cardId}&url=${encodedUrl}&theme=${encodeURIComponent(cardTheme)}`;
    cardWindow.webContents.loadURL(cardHtmlUrl).catch((loadErr) => {
      console.error('Error loading card HTML:', loadErr);
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
      } catch (e) {}
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
  const fallback = 'https://discovery-web-fvtn.onrender.com';
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

