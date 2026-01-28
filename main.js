// main.js
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

const { Menu, MenuItem } = require('electron');

// Function to create and show the context menu
app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, props) => {
    const menu = new Menu();

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

// Global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Handle app ready
app.on('ready', createMainWindow);

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
  if (mainWindow) {
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
    // Someone tried to run a second instance, focus our window and open the URL
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // Use the helper to find the URL in the command line
      const url = getUrlFromArgs(commandLine);
      if (url) {
        mainWindow.webContents.send('open-external-url', url);
      }
    }
  });
}

function createMainWindow() {
  // Main window - control panel (matches card dimensions: 650x500px)
  let windowX = 100;
  let windowY = 20;
  const CARD_WIDTH = 650;
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
    minWidth: 400,
    minHeight: 200,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile('src/index.html');
  setupAddonBlocking();

  // Wait for the main window to be ready, then check if we were started with a URL
  mainWindow.webContents.on('did-finish-load', () => {
    const url = getUrlFromArgs(process.argv);
    if (url) {
      mainWindow.webContents.send('open-external-url', url);
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
// IPC Handlers for Card Windows
// ========================

// Addon management: maintain active addons and apply simple blocking rules
let activeAddons = [];
let blocklist = new Set();

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
// Enhanced create-card handler with beautiful animations
// ========================
ipcMain.handle('create-card', async (event, cardId, url, position) => {
  try {
    let targetUrl = url.trim();
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
      width: 650,
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
      },
    });

    // Store reference before loading
    cardWindows.set(cardId, cardWindow);

    // Load the card HTML
    const encodedUrl = Buffer.from(targetUrl).toString('base64');
    const cardHtmlUrl = `file://${path.join(__dirname, 'src', 'card.html').replace(/\\/g, '/')}?cardId=${cardId}&url=${encodedUrl}`;
    await cardWindow.webContents.loadURL(cardHtmlUrl);

    // Optimized for instant, snappy launch with minimal rendering issues
    cardWindow.setOpacity(0.3); // Start slightly visible to reduce flash
    cardWindow.show();

    // Ultra-fast, snappy animation - 180ms total
    const startTime = Date.now();
    const animationDuration = 180; // Super fast and snappy
    
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
      const scaledWidth = 650 * scale;
      const scaledHeight = 500 * scale;
      const offsetX = (650 - scaledWidth) / 2;
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
        setTimeout(animate, 12); // Slightly faster than 60fps for snappiness
      } else {
        // Ensure final crisp state
        try {
          cardWindow.setOpacity(1);
          cardWindow.setBounds({
            x: finalX,
            y: finalY,
            width: 650,
            height: 500
          });
        } catch (e) {
          // Window closed
        }
      }
    };
    
    animate();

    // Setup event listeners
    cardWindow.webContents.on('did-start-loading', () => {
      mainWindow.webContents.send('card-loading-start', cardId);
    });

    cardWindow.webContents.on('did-finish-load', () => {
      const pageTitle = cardWindow.webContents.getTitle();
      const currentUrl = cardWindow.webContents.getURL();
      mainWindow.webContents.send('card-loading-finish', cardId, pageTitle, currentUrl);
    });

    cardWindow.webContents.on('did-navigate', (event, url) => {
      mainWindow.webContents.send('card-url-updated', cardId, url);
      mainWindow.webContents.send('card-title-updated', cardId, cardWindow.webContents.getTitle());
    });

    cardWindow.webContents.on('page-title-updated', (event, title) => {
      mainWindow.webContents.send('card-title-updated', cardId, title);
    });

    cardWindow.on('closed', () => {
      cardWindows.delete(cardId);
      mainWindow.webContents.send('card-closed', cardId);
    });

    return { success: true, cardId };
  } catch (error) {
    console.error('Error creating card:', error);
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

// You can call this when user clicks a "Set as Default" button in your UI
ipcMain.handle('set-as-default-browser', async () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  openDefaultAppsSettings();
  return { success: true };
});

// Add this IPC handler for setting as default browser
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