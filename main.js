// main.js
const { app, BrowserWindow, ipcMain, session, shell, dialog, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

const { Menu, MenuItem } = require('electron');

// GPU stability flags - prevent GPU process crashes (exit_code=-1073740791)
app.commandLine.appendSwitch('disable-gpu-sandbox'); // Prevents GPU sandbox crashes on Windows
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

const allowedSchemes = new Set([
  'http:',
  'https:',
  'file:',
  'data:',
  'about:',
  'blob:',
  'javascript:',
  'chrome:',
  'devtools:',
]);

function getUrlProtocol(rawUrl) {
  try {
    return new URL(rawUrl).protocol;
  } catch (e) {
    const match = String(rawUrl || '').match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
    return match ? match[1] : '';
  }
}

function isExternalAppUrl(rawUrl) {
  const protocol = getUrlProtocol(rawUrl);
  if (!protocol) return false;
  return !allowedSchemes.has(protocol);
}

function deriveWebFallbackUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const protocol = u.protocol;
    if (protocol === 'zoommtg:' || protocol === 'zoomus:') {
      if (u.hostname) {
        return `https://${u.host}${u.pathname}${u.search}${u.hash}`;
      }
      return 'https://zoom.us';
    }
    if (protocol === 'spotify:') {
      const path = String(rawUrl).replace(/^spotify:\/\//, '').replace(/^spotify:/, '').replace(/^\/+/, '');
      if (path) {
        return `https://open.spotify.com/${path}`;
      }
      return 'https://open.spotify.com';
    }
    if (u.hostname && u.hostname.includes('.')) {
      return `https://${u.host}${u.pathname}${u.search}${u.hash}`;
    }
  } catch (e) {
    const match = String(rawUrl || '').match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (match && match[2] && match[2].includes('.')) {
      return `https://${match[2]}${match[3] || ''}${match[4] || ''}${match[5] || ''}`;
    }
  }
  return null;
}

async function promptOpenExternalApp(contents, targetUrl) {
  try {
    const parentWin = BrowserWindow.fromWebContents(contents) || mainWindow;
    const fallbackUrl = deriveWebFallbackUrl(targetUrl);
    const protocol = getUrlProtocol(targetUrl) || 'app';
    const detail = fallbackUrl
      ? `If the app isn't installed, we'll open the web version instead.`
      : `If the app isn't installed, nothing will open.`;

    const result = await dialog.showMessageBox(parentWin, {
      type: 'question',
      buttons: ['Open App', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Open in app?',
      detail: `This link wants to open ${protocol} on your device.\n${detail}`,
      noLink: true,
    });

    if (result.response !== 0) return true;

    try {
      const ok = await shell.openExternal(targetUrl, { activate: true });
      if (!ok && fallbackUrl) {
        openUrlInCard(fallbackUrl);
      }
    } catch (e) {
      if (fallbackUrl) {
        openUrlInCard(fallbackUrl);
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function handleExternalAppNavigation(event, contents, targetUrl) {
  if (!targetUrl || !isExternalAppUrl(targetUrl)) return false;
  if (event && event.preventDefault) event.preventDefault();
  promptOpenExternalApp(contents, targetUrl);
  return true;
}

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
      if (isExternalAppUrl(url)) {
        promptOpenExternalApp(contents, url);
        return { action: 'deny' };
      }
      openUrlInCard(url);
      return { action: 'deny' };
    });
  } catch (e) {}

  contents.on('context-menu', (e, props) => {
    const menu = new Menu();

    // Spelling suggestions
    if (props.misspelledWord && Array.isArray(props.dictionarySuggestions) && props.dictionarySuggestions.length > 0) {
      props.dictionarySuggestions.slice(0, 8).forEach((suggestion) => {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => {
            try {
              contents.replaceMisspelling(suggestion);
            } catch (err) {}
          }
        }));
      });
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => {
          try {
            if (contents.session && contents.session.addWordToSpellCheckerDictionary) {
              contents.session.addWordToSpellCheckerDictionary(props.misspelledWord);
            }
          } catch (err) {}
        }
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Media download options (images / videos)
    try {
      const mediaType = props.mediaType || '';
      const mediaURL = props.srcURL || props.mediaURL || '';
      const isHttp = mediaURL && (mediaURL.startsWith('http://') || mediaURL.startsWith('https://'));

      if (isHttp && mediaType === 'image') {
        menu.append(new MenuItem({
          label: 'Save Image As...',
          click: async () => {
            try {
              const downloadsDir = app.getPath('downloads');
              const baseName = path.basename(new URL(mediaURL).pathname) || 'image';
              const defaultPath = path.join(downloadsDir, baseName);
              const { canceled, filePath } = await dialog.showSaveDialog({
                title: 'Save Image As',
                defaultPath,
              });
              if (canceled || !filePath) return;
              pendingDownloadSavePathByUrl.set(mediaURL, filePath);
              contents.downloadURL(mediaURL);
            } catch (err) {}
          }
        }));
        menu.append(new MenuItem({
          label: 'Download Image',
          click: () => {
            try { contents.downloadURL(mediaURL); } catch (err) {}
          }
        }));
      }

      if (isHttp && (mediaType === 'video' || mediaType === 'audio')) {
        menu.append(new MenuItem({
          label: mediaType === 'audio' ? 'Save Audio As...' : 'Save Video As...',
          click: async () => {
            try {
              const downloadsDir = app.getPath('downloads');
              const baseName = path.basename(new URL(mediaURL).pathname) || (mediaType === 'audio' ? 'audio' : 'video');
              const defaultPath = path.join(downloadsDir, baseName);
              const { canceled, filePath } = await dialog.showSaveDialog({
                title: mediaType === 'audio' ? 'Save Audio As' : 'Save Video As',
                defaultPath,
              });
              if (canceled || !filePath) return;
              pendingDownloadSavePathByUrl.set(mediaURL, filePath);
              contents.downloadURL(mediaURL);
            } catch (err) {}
          }
        }));
        menu.append(new MenuItem({
          label: mediaType === 'audio' ? 'Download Audio' : 'Download Video',
          click: () => {
            try { contents.downloadURL(mediaURL); } catch (err) {}
          }
        }));
      }

      if (menu.items.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
    } catch (err) {}

    // Add Copy if text is selected
    if (props.selectionText && props.selectionText.trim() !== '') {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    }

    // Add Cut if text is selected and the area is editable
    if (props.isEditable && props.selectionText && props.selectionText.trim() !== '') {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
    }

    // Add Paste if the area is editable
    if (props.isEditable) {
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    }

    // Add Select All
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));

    // Add a separator and Inspect Element (useful for development)
    if (!app.isPackaged) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Inspect Element',
        click: () => { contents.inspectElement(props.x, props.y); }
      }));
    }

    // Only show the menu if there are items in it
    if (menu.items.length > 0) {
      menu.popup({ window: BrowserWindow.fromWebContents(contents) });
    }
  });

  // Block suspicious main-frame redirects without a recent user gesture
  function shouldBlockNavigation(targetUrl) {
    try {
      if (!targetUrl || !targetUrl.startsWith('http')) return false;
      if (blocklist.size === 0) return false;
      if (!contents || contents.isDestroyed()) return false;
      if (contents.getType && contents.getType() !== 'webview') return false;

      const currentUrl = contents.getURL ? contents.getURL() : '';
      if (!currentUrl || !currentUrl.startsWith('http')) return false;

      let currentHost = '';
      let targetHost = '';
      try { currentHost = new URL(currentUrl).hostname; } catch (e) {}
      try { targetHost = new URL(targetUrl).hostname; } catch (e) {}
      if (!currentHost || !targetHost) return false;

      if (currentHost === targetHost) return false;

      const lastGesture = lastGestureByContentsId.get(contents.id) || 0;
      const delta = Date.now() - lastGesture;
      if (delta < 800) return false;

      return true;
    } catch (e) {
      return false;
    }
  }

  // ─── Password detection for inner webviews inside card windows ───
  // Skip the main window and the card.html shell itself (those load file:// URLs).
  // Only target webviews that navigate to real http(s) sites.
  let pwdPollTimer = null;

  // Helper to safely execute JavaScript on webContents
  function safeExecuteJS(wc, script) {
    try {
      if (!wc || wc.isDestroyed()) return Promise.resolve(null);
      let frame = null;
      try {
        frame = wc.mainFrame;
      } catch (e) {
        return Promise.resolve(null);
      }
      if (!frame || frame.isDestroyed && frame.isDestroyed()) return Promise.resolve(null);
      try {
        return frame.executeJavaScript(script, true).catch(() => null);
      } catch (e) {
        return Promise.resolve(null);
      }
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function stopPasswordDetection() {
    if (pwdPollTimer) {
      clearInterval(pwdPollTimer);
      pwdPollTimer = null;
    }
  }

  function startPasswordDetection(webviewContents, pageUrl) {
    // Stop any previous poll on this webContents
    stopPasswordDetection();

    // Early exit if webContents is already destroyed
    if (!webviewContents || webviewContents.isDestroyed()) return;

    // Inject the detector script
    const DETECTOR = `
      (function() {
        if (window.__pwdDetectorActive) return;
        window.__pwdDetectorActive = true;
        function findCreds(form) {
          var pw = form.querySelector('input[type="password"]');
          if (!pw || !pw.value) return null;
          var user = form.querySelector('input[type="email"]')
            || form.querySelector('input[type="text"]')
            || form.querySelector('input[type="tel"]');
          if (!user) {
            var all = Array.from(form.querySelectorAll('input'));
            var idx = all.indexOf(pw);
            for (var i = idx - 1; i >= 0; i--) {
              if (all[i].type !== 'hidden' && all[i].type !== 'password') { user = all[i]; break; }
            }
          }
          return { username: (user && user.value) ? user.value.trim() : '', password: pw.value };
        }
        document.addEventListener('submit', function(e) {
          var c = findCreds(e.target);
          if (c && c.password) window.__pwdPending = c;
        }, true);
        document.addEventListener('click', function(e) {
          var btn = e.target.closest('button[type="submit"],input[type="submit"],button:not([type])');
          if (!btn) return;
          var form = btn.closest('form');
          if (!form) return;
          var c = findCreds(form);
          if (c && c.password) window.__pwdPending = c;
        }, true);
      })();
    `;

    // Use safe helper to inject detector
    safeExecuteJS(webviewContents, DETECTOR);

    // Poll for __pwdPending every 2s — runs for the lifetime of this page
    pwdPollTimer = setInterval(() => {
      // Check if webContents is still valid
      if (!webviewContents || webviewContents.isDestroyed()) {
        stopPasswordDetection();
        return;
      }
      // Guard against disposed mainFrame
      try {
        if (!webviewContents.mainFrame || (webviewContents.mainFrame.isDestroyed && webviewContents.mainFrame.isDestroyed())) {
          stopPasswordDetection();
          return;
        }
      } catch (e) {
        stopPasswordDetection();
        return;
      }
      
      safeExecuteJS(webviewContents, `
        (function(){
          if(window.__pwdPending){var d=window.__pwdPending;window.__pwdPending=null;return d;}
          return null;
        })();
      `).then((result) => {
        if (!result || !result.password) return;
        // Find the card window that owns this webview.
        // Prefer hostWebContents (webview -> embedder) to avoid missing the correct card.
        let targetWindow = null;
        try {
          if (webviewContents && webviewContents.hostWebContents) {
            targetWindow = BrowserWindow.fromWebContents(webviewContents.hostWebContents);
          }
        } catch (e) {}

        // Fallback: last known card window (older Electron or edge cases)
        if (!targetWindow || targetWindow.isDestroyed()) {
          for (const [cardId, cardWin] of cardWindows) {
            if (cardWin && !cardWin.isDestroyed()) {
              targetWindow = cardWin;
            }
          }
        }
        if (targetWindow && !targetWindow.isDestroyed()) {
          try {
            targetWindow.webContents.send('password-detected', {
              site: pageUrl,
              username: result.username,
              password: result.password
            });
          } catch (e) {
            // Ignore send errors
          }
        }
      });
    }, 2000);
  }

  // Clean up timer when webContents is destroyed
  contents.on('destroyed', () => {
    stopPasswordDetection();
  });
  
  contents.on('render-process-gone', () => {
    stopPasswordDetection();
  });

  // Hook into navigation events on every webContents - use 'once' pattern where appropriate
  contents.on('did-start-navigation', (event, url) => {
    if (url && url.startsWith('http')) {
      stopPasswordDetection();
    }
  });

  contents.on('did-navigate', (event, url) => {
    if (url && url.startsWith('http')) {
      // Small delay so the new page DOM is available
      setTimeout(() => {
        // Check if contents is still valid after timeout
        if (contents && !contents.isDestroyed()) {
          startPasswordDetection(contents, url);
        }
      }, 1000);
    }
  });

  contents.on('will-navigate', (event, url) => {
    if (handleExternalAppNavigation(event, contents, url)) return;
    if (event && event.isMainFrame && shouldBlockNavigation(url)) {
      event.preventDefault();
      console.log('[Addon] Blocked suspicious redirect:', url);
    }
  });

  contents.on('will-redirect', (event, url) => {
    if (handleExternalAppNavigation(event, contents, url)) return;
    if (event && event.isMainFrame && shouldBlockNavigation(url)) {
      event.preventDefault();
      console.log('[Addon] Blocked suspicious redirect:', url);
    }
  });

  contents.on('did-navigate-in-page', (event, url) => {
    if (url && url.startsWith('http')) {
      setTimeout(() => {
        // Check if contents is still valid after timeout
        if (contents && !contents.isDestroyed()) {
          startPasswordDetection(contents, url);
        }
      }, 1000);
    }
  });

  contents.on('did-finish-load', () => {
    try {
      if (contents && !contents.isDestroyed()) {
        const url = contents.getURL();
        if (url && url.startsWith('http')) {
          startPasswordDetection(contents, url);
        }
      }
    } catch(e) {}
  });
});

// Helper function to extract URL from command line arguments
function getUrlFromArgs(argv) {
  return argv.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));
}

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
let nextDirectCardId = 100000;
let startupUrlHandled = false;
let suppressMainWindowOnStartup = false;

function openUrlInCard(url) {
  try {
    handleExternalUrl(url);
  } catch (e) {
    // ignore
  }
}

function handleExternalUrl(url) {
  if (!url) return;
  const canUseRenderer = mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isLoading();

  if (canUseRenderer) {
    try {
      mainWindow.webContents.send('open-external-url', url);
      return;
    } catch (e) {}
  }

  // Cold-start or renderer not ready: open card directly
  createCardWindow(nextDirectCardId++, url, {});
}

// ========================
// Downloads
// ========================

const downloadIdByItem = new WeakMap();
const downloadHandlerSessions = new WeakSet();
const pendingDownloadSavePathByUrl = new Map();
const lastGestureByContentsId = new Map();
const lastScrollByContentsId = new Map();

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
        let finalSavePath = null;
        if (url && pendingDownloadSavePathByUrl.has(url)) {
          finalSavePath = pendingDownloadSavePathByUrl.get(url);
          pendingDownloadSavePathByUrl.delete(url);
        } else {
          const initialSavePath = path.join(downloadsDir, suggested);
          finalSavePath = ensureUniquePath(initialSavePath);
        }
        if (finalSavePath) {
          item.setSavePath(finalSavePath);
        }

        sendDownloadEvent('download-started', {
          id,
          url,
          mime,
          filename: path.basename(finalSavePath || suggested),
          savePath: finalSavePath || '',
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

// Web notifications from webviews -> forward to main window
ipcMain.on('web-notification', (event, payload) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification-received', payload || {});
    }
  } catch (e) {}
});

// Global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Handle app ready
app.on('ready', () => {
  const startupUrl = getUrlFromArgs(process.argv);
  if (startupUrl) {
    startupUrlHandled = true;
    suppressMainWindowOnStartup = true;
    createCardWindow(nextDirectCardId++, startupUrl, {});
  }
  createMainWindow({ showOnReady: !suppressMainWindowOnStartup });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});

// Handle protocol URLs when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleExternalUrl(url);
});

// Handle when launched with a URL (Windows)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window and open the URL
    const url = getUrlFromArgs(commandLine);
    if (url) {
      handleExternalUrl(url);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createMainWindow(options) {
  const showOnReady = !options || options.showOnReady !== false;
  let windowX = 100;
  let windowY = 20;
  const CARD_WIDTH = 900;
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
    minWidth: 900,
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
      spellcheck: true, // Enable spellcheck for context menu suggestions
      enablePreferredSizeMode: true,
      backgroundThrottling: false, // Keep animations smooth
      offscreen: false,
    },
  });

  // Show window only when ready - prevents flash
  mainWindow.once('ready-to-show', () => {
    if (showOnReady) {
      mainWindow.show();
    }
  });

  mainWindow.loadFile('src/index.html');
  setupAddonBlocking();

  // Force any window.open/target=_blank to open as a card window
  try {
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalAppUrl(url)) {
        promptOpenExternalApp(mainWindow.webContents, url);
        return { action: 'deny' };
      }
      openUrlInCard(url);
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
    const url = getUrlFromArgs(process.argv);
    if (url && !startupUrlHandled) {
      handleExternalUrl(url);
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
let visualizerEnabled = false;
const allowlistBySite = new Map([
  ['instagram.com', new Set(['fbcdn.net'])],
  ['facebook.com', new Set(['fbcdn.net'])],
]);

function getTopHostForContentsId(contentsId) {
  try {
    const wc = webContents.fromId(contentsId);
    const curUrl = wc && wc.getURL ? wc.getURL() : '';
    return curUrl ? new URL(curUrl).hostname : '';
  } catch (e) {
    return '';
  }
}

function isAllowlistedHost(hostname, topHost) {
  if (!hostname || !topHost) return false;
  for (const [siteHost, allowedSet] of allowlistBySite.entries()) {
    if (topHost === siteHost || topHost.endsWith('.' + siteHost)) {
      for (const allowed of allowedSet) {
        if (hostname === allowed || hostname.endsWith('.' + allowed)) {
          return true;
        }
      }
    }
  }
  return false;
}

function applyAddons(addonsArray) {
  // Build a blocklist based on addon metadata heuristics
  blocklist.clear();
  if (!Array.isArray(addonsArray)) return;
  
  // Comprehensive ad and tracking host blocklist (common ad networks)
  const defaultAdHosts = [
    // Google Ad Services
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adservice.google.com', 'googletagservices.com', 'googletagmanager.com',
    'google-analytics.com', 'analytics.google.com', 'googleanalytics.com',
    'pagead2.googlesyndication.com', 'tpc.googlesyndication.com',
    'googleads.g.doubleclick.net', 'ad.doubleclick.net',
    
    // Facebook & Meta
    'facebook.net', 'fbcdn.net', 'facebook.com',
    
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
        console.log(`[Addon] Enabled ad blocker: ${a.name}, blocking ${blocklist.size} hosts`);
        console.log(`[Addon] Blocklist contents:`, Array.from(blocklist).slice(0, 10), '... and more');
      }
    }
  });
  
  if (!hasAdBlocker) {
    console.log('[Addon] No ad blocker enabled');
    blocklist.clear();
  }
}

function setupAddonBlocking() {
  if (!session || !session.defaultSession) {
    console.warn('Session not available for addon blocking');
    return;
  }
  
  let requestCount = 0;
  let blockCount = 0;
  
  const requestHandler = (details, callback) => {
    try {
      // Block main-frame redirects without recent user gesture (scroll popups)
      if (blocklist.size > 0 && details.resourceType === 'mainFrame') {
        const lastGesture = lastGestureByContentsId.get(details.webContentsId) || 0;
        const lastScroll = lastScrollByContentsId.get(details.webContentsId) || 0;
        const delta = Date.now() - lastGesture;
        const scrollDelta = Date.now() - lastScroll;
        let currentHost = '';
        let targetHost = '';
        try { currentHost = new URL(details.referrer || '').hostname; } catch (e) {}
        if (!currentHost) {
          try {
            const wc = webContents.fromId(details.webContentsId);
            const curUrl = wc && wc.getURL ? wc.getURL() : '';
            if (curUrl) currentHost = new URL(curUrl).hostname;
          } catch (e) {}
        }
        try { targetHost = new URL(details.url || '').hostname; } catch (e) {}
        if (targetHost && currentHost && currentHost !== targetHost && delta > 800 && scrollDelta < 2000) {
          blockCount++;
          console.log(`[Block Redirect #${blockCount}] Blocked main-frame redirect to: ${targetHost}`);
          return callback({ cancel: true });
        }
      }

      const reqUrl = details.url || '';
      let hostname = '';
      
      try {
        hostname = new URL(reqUrl).hostname;
      } catch (e) {
        const match = reqUrl.match(/^https?:\/\/([^/?#]+)/);
        hostname = match ? match[1] : reqUrl;
      }
      
      requestCount++;
      if (requestCount % 20 === 0 && blocklist.size > 0) {
        console.log(`[WebRequest] Sample: ${hostname} (blocklist size: ${blocklist.size})`);
      }
      
      if (blocklist.size > 0) {
        const topHost = getTopHostForContentsId(details.webContentsId);
        if (isAllowlistedHost(hostname, topHost)) {
          return callback({ cancel: false });
        }
      }

      if (blocklist.size > 0) {
        for (const blocked of blocklist) {
          if (!blocked) continue;
          
          if (hostname === blocked) {
            blockCount++;
            console.log(`[Block #${blockCount}] Blocked: ${hostname} (matched exactly to: ${blocked})`);
            return callback({ cancel: true });
          }
          
          if (hostname.endsWith('.' + blocked)) {
            blockCount++;
            console.log(`[Block #${blockCount}] Blocked: ${hostname} (matched subdomain: ${blocked})`);
            return callback({ cancel: true });
          }
          
          if (blocked.includes('.') === false && hostname.includes(blocked)) {
            blockCount++;
            console.log(`[Block #${blockCount}] Blocked: ${hostname} (matched pattern: ${blocked})`);
            return callback({ cancel: true });
          }
        }
      }
    } catch (e) {
      console.error('[WebRequest] Error in blocking logic:', e.message);
    }
    
    return callback({ cancel: false });
  };
  
  // Redirect handler - NO CALLBACK, just returns normally
  const redirectHandler = (details) => {
    try {
      const location = details.redirectURL || '';
      if (location) {
        let hostname = '';
        try {
          hostname = new URL(location).hostname;
        } catch (e) {
          const match = location.match(/^https?:\/\/([^/?#]+)/);
          hostname = match ? match[1] : location;
        }

        const topHost = getTopHostForContentsId(details.webContentsId);
        if (isAllowlistedHost(hostname, topHost)) {
          return;
        }
        
        if (blocklist.size > 0) {
          for (const blocked of blocklist) {
            if (!blocked) continue;
            if (hostname === blocked || hostname.endsWith('.' + blocked) || 
                (blocked.includes('.') === false && hostname.includes(blocked))) {
              blockCount++;
              console.log(`[Block Redirect #${blockCount}] Blocked redirect to: ${hostname}`);
              // Note: onBeforeRedirect is informational only, can't cancel
            }
          }
        }
      }
    } catch (e) {
      // ignore errors
    }
  };
  
  session.defaultSession.webRequest.onBeforeRequest(requestHandler);
  session.defaultSession.webRequest.onBeforeRedirect(redirectHandler);
  
  const cardPartition = 'persist:cards';
  const cardSession = session.fromPartition(cardPartition);
  if (cardSession && cardSession.webRequest) {
    cardSession.webRequest.onBeforeRequest(requestHandler);
    cardSession.webRequest.onBeforeRedirect(redirectHandler);
    
    // Enable clipboard and other permissions for webviews
    cardSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = [
        'clipboard-read',
        'clipboard-write', 
        'clipboard-sanitized-write',
        'media',
        'geolocation',
        'notifications',
        'fullscreen'
      ];
      
      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });
    
    console.log('[Addon] Ad blocking registered for card webview partition');
  }
  
  const defaultPartition = 'persist:webview';
  const webviewSession = session.fromPartition(defaultPartition);
  if (webviewSession && webviewSession.webRequest) {
    webviewSession.webRequest.onBeforeRequest(requestHandler);
    webviewSession.webRequest.onBeforeRedirect(redirectHandler);
    console.log('[Addon] Ad blocking registered for default webview partition');
  }
  
  console.log('[Addon] Ad blocking webRequest handler registered');
}

// ========================
// IPC Handlers for Card Windows
// ========================

async function createCardWindow(cardId, url, position) {
  position = position || {};
  try {
    let targetUrl = String(url || '').trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
      }
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
      width: 900,
      height: 500,
      x: finalX,
      y: finalY,
      frame: false,
      transparent: true, // Enable transparency for smooth animations
      resizable: true,
      skipTaskbar: false,
      show: false, // Start hidden for smooth animation entrance
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
        backgroundThrottling: false,
        enablePreferredSizeMode: true,
        partition: 'persist:cards',
      },
    });

    // Store reference before loading
    cardWindows.set(cardId, cardWindow);

    // Load the card HTML (fire-and-forget to keep UI snappy)
    const encodedUrl = Buffer.from(targetUrl).toString('base64');
    const theme = (cardWindows.size % 2 === 0) ? 'alt' : 'primary';
    const cardHtmlUrl = `file://${path.join(__dirname, 'src', 'card.html').replace(/\\/g, '/')}?cardId=${cardId}&url=${encodedUrl}&theme=${theme}`;
    cardWindow.webContents.loadURL(cardHtmlUrl).catch((e) => {
      console.error('Card loadURL failed:', e && e.message ? e.message : e);
    });

    // Force any window.open/target=_blank to open as a card window
    try {
      cardWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternalAppUrl(url)) {
          promptOpenExternalApp(cardWindow.webContents, url);
          return { action: 'deny' };
        }
        openUrlInCard(url);
        return { action: 'deny' };
      });
    } catch (e) {}

    // ULTRA-FAST animation (120ms instead of 180ms)
    cardWindow.setOpacity(0.3); // Start slightly visible to reduce flash
    cardWindow.show();
    cardWindow.focus();
    cardWindow.moveTop();
    try {
      cardWindow.setAlwaysOnTop(true, 'floating');
      setTimeout(() => {
        if (cardWindow && !cardWindow.isDestroyed()) {
          cardWindow.setAlwaysOnTop(false);
        }
      }, 500);
    } catch (e) {}

    const startTime = Date.now();
    const animationDuration = 120; // Super fast and snappy
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / animationDuration, 1);
      
      // Ease-out-back for snappy, spring-like feel
      const easeProgress = progress < 0.5 
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      // Minimal opacity fade (0.3 -> 1) for less visual disruption
      const opacity = 0.3 + (0.7 * easeProgress);
      
      // Subtle scale: 0.92 -> 1.0 (barely noticeable, feels "compact")
      const scale = 0.92 + (0.08 * easeProgress);
      
      // Calculate offset for scale effect
      const scaledWidth = 900 * scale;
      const scaledHeight = 500 * scale;
      const offsetX = (800 - scaledWidth) / 2;
      const offsetY = (500 - scaledHeight) / 2;
      
      // Apply transformations in single operation
      try {
        cardWindow.setOpacity(opacity);
        cardWindow.setBounds({
          x: Math.floor(finalX + offsetX),
          y: Math.floor(finalY + offsetY),
          width: Math.floor(scaledWidth),
          height: Math.floor(scaledHeight)
        });
      } catch (e) {
        return;
      }
      
      if (progress < 1) {
        setTimeout(animate, 8); // 125fps for ultra-smooth
      } else {
        // Ensure final crisp state
        try {
          cardWindow.setOpacity(1);
          cardWindow.setBounds({
            x: finalX,
            y: finalY,
          width: 900,
            height: 500
          });
        } catch (e) {
          // Window closed
        }
      }
    };
    
    animate();

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
        if (cardWindow && !cardWindow.isDestroyed()) {
          cardWindow.webContents.send('visualizer-setting', visualizerEnabled);
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

    cardWindow.on('closed', () => {
      cardWindows.delete(cardId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('card-closed', cardId);
      }
    });

    return { success: true, cardId };
  } catch (error) {
    console.error('Error creating card:', error);
    return { success: false, error: error.message };
  }
}

// Enhanced create-card handler with beautiful animations
ipcMain.handle('create-card', async (event, cardId, url, position) => {
  return createCardWindow(cardId, url, position);
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

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(targetUrl);
      }
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
ipcMain.handle('minimize-card', async (event, cardId) => {
  try {
    const cardWindow = cardWindows.get(cardId);
    if (!cardWindow || cardWindow.isDestroyed()) {
      return { success: false, error: 'Card window not found' };
    }

    cardWindow.minimize();
    return { success: true };
  } catch (error) {
    console.error('Error minimizing card:', error);
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

// Card window: check if URL is bookmarked — answered directly, no round-trip
ipcMain.handle('is-bookmarked', async (event, url) => {
  for (const folder of bookmarkFolders) {
    if (folder.bookmarks && folder.bookmarks.some(b => b.url === url)) {
      return true;
    }
  }
  return false;
});

// Card window: get folder list — answered directly, no round-trip
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

// Password management - stored directly in main process (same pattern as bookmarks)
let savedPasswords = [];

// Renderer syncs its passwords to main on load
ipcMain.handle('sync-passwords', async (event, passwords) => {
  savedPasswords = passwords || [];
  return { success: true };
});

// Card window saves a new password
ipcMain.handle('save-password', async (event, passwordData) => {
  try {
    // Check for duplicate (same site + username) - update if exists
    const existingIndex = savedPasswords.findIndex(
      p => p.site === passwordData.site && p.username === passwordData.username
    );
    if (existingIndex !== -1) {
      savedPasswords[existingIndex] = passwordData;
    } else {
      savedPasswords.push(passwordData);
    }
    // Tell renderer to persist
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save-password', passwordData);
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving password:', error);
    return { success: false, error: error.message };
  }
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

ipcMain.handle('set-visualizer-enabled', async (event, enabled) => {
  visualizerEnabled = !!enabled;
  try {
    for (const [, win] of cardWindows) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('visualizer-setting', visualizerEnabled);
      }
    }
  } catch (e) {}
  return { success: true };
});

ipcMain.handle('get-visualizer-enabled', async () => {
  return visualizerEnabled;
});

ipcMain.handle('clear-user-data', async () => {
  try {
    const defaultSession = session.defaultSession;
    if (defaultSession) {
      await defaultSession.clearCache();
      await defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cache', 'cachestorage', 'filesystem'],
      });
    }
    const cardSession = session.fromPartition('persist:cards');
    if (cardSession) {
      await cardSession.clearCache();
      await cardSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cache', 'cachestorage', 'filesystem'],
      });
    }
    return true;
  } catch (e) {
    console.warn('Failed to clear user data:', e.message);
    return false;
  }
});

// Track user gestures from webviews to allow legitimate navigations
ipcMain.on('webview-user-gesture', (event, payload) => {
  try {
    const id = payload && payload.id;
    if (typeof id === 'number') {
      lastGestureByContentsId.set(id, Date.now());
    }
  } catch (e) {}
});

ipcMain.on('webview-user-scroll', (event, payload) => {
  try {
    const id = payload && payload.id;
    if (typeof id === 'number') {
      lastScrollByContentsId.set(id, Date.now());
    }
  } catch (e) {}
});

// Add manual default browser setting method
function openDefaultAppsSettings() {
  if (process.platform === 'win32') {
    const { shell } = require('electron');
    shell.openExternal('ms-settings:defaultapps');
  }
}

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
