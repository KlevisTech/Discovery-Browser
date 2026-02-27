//preload-card.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods for card windows via contextBridge
contextBridge.exposeInMainWorld('cardAPI', {
  // Navigation controls
  cardGoBack: (cardId) =>
    ipcRenderer.invoke('card-go-back', cardId),

  cardGoForward: (cardId) =>
    ipcRenderer.invoke('card-go-forward', cardId),

  cardReload: (cardId) =>
    ipcRenderer.invoke('card-reload', cardId),

  // Navigation
  navigateCard: (cardId, url) =>
    ipcRenderer.invoke('navigate-card', cardId, url),

  // Close card
  closeCard: (cardId) =>
    ipcRenderer.invoke('close-card', cardId),

  // Resize card
  resizeCard: (cardId, x, y, width, height) =>
    ipcRenderer.invoke('resize-card', cardId, x, y, width, height),

  // Toggle fullscreen
  toggleFullscreen: (cardId, shouldBeFullscreen) =>
    ipcRenderer.invoke('toggle-fullscreen', cardId, shouldBeFullscreen),

  // Minimize card
  minimizeCard: (cardId, pageUrl, pageTitle, themeKey) =>
    ipcRenderer.invoke('minimize-card', cardId, pageUrl, pageTitle, themeKey),

  // Open URL as bubble (creates new card that starts minimized as bubble)
  openUrlAsBubble: (url, meta) =>
    ipcRenderer.invoke('open-url-as-bubble', url, meta),

  // Bookmark management
  toggleBookmark: (bookmarkData) =>
    ipcRenderer.invoke('toggle-bookmark', bookmarkData),

  isBookmarked: (url) =>
    ipcRenderer.invoke('is-bookmarked', url),

  getBookmarkFolders: () =>
    ipcRenderer.invoke('get-bookmark-folders'),

  saveBookmarkToFolder: (bookmarkData, folderId) =>
    ipcRenderer.invoke('save-bookmark-to-folder', bookmarkData, folderId),

  // Password manager is disabled until secure OS-backed storage is implemented.

  onVisualizerSetting: (callback) => {
    ipcRenderer.on('visualizer-setting', (event, enabled) => callback(enabled));
  },
  getVisualizerSetting: () => ipcRenderer.invoke('get-visualizer-enabled'),

  // Get card launch size mode (normal, wide, fullscreen)
  getCardLaunchSizeMode: () => ipcRenderer.invoke('get-card-launch-size-mode'),

  // Get current window position
  getWindowPosition: () => {
    return {
      x: window.screenX,
      y: window.screenY,
    };
  },

  // Update window position
  updateWindowPosition: (x, y, cardId) =>
    ipcRenderer.invoke('update-card-position', cardId, x, y),

  // Listen for window events
  onWindowMoved: (callback) => {
    const listener = (event) => callback();
    window.addEventListener('move', listener);
    return () => window.removeEventListener('move', listener);
  },

  // Downloads (per card window)
  onDownloadStarted: (callback) => {
    ipcRenderer.on('download-started', (event, payload) => callback(payload));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, payload) => callback(payload));
  },
  onDownloadDone: (callback) => {
    ipcRenderer.on('download-done', (event, payload) => callback(payload));
  },
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

  // Forward web notifications from webview to main process
  sendNotification: (payload) => ipcRenderer.send('web-notification', payload),

  // Send custom events to main process
  sendToMain: (channel, payload) => ipcRenderer.send(channel, payload),
  getUserAgent: () => ipcRenderer.invoke('get-user-agent'),
});

// Receive requests from main to load a URL into this card's webview
ipcRenderer.on('card-load-url', (event, url) => {
  window.dispatchEvent(new CustomEvent('card-load-url', { detail: url }));
});

ipcRenderer.on('card-restore-animate', () => {
  window.dispatchEvent(new CustomEvent('card-restore-animate'));
});

ipcRenderer.on('cloudflare-challenge-banner', (event, payload) => {
  window.dispatchEvent(new CustomEvent('cloudflare-challenge-banner', { detail: payload || {} }));
});

// Listen for load failures from main process
ipcRenderer.on('card-load-failed', (event, payload) => {
  window.dispatchEvent(new CustomEvent('card-load-failed', { detail: payload }));
});
