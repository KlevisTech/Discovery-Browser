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
  minimizeCard: (cardId) =>
    ipcRenderer.invoke('minimize-card', cardId),

  // Bookmark management
  toggleBookmark: (bookmarkData) =>
    ipcRenderer.invoke('toggle-bookmark', bookmarkData),

  isBookmarked: (url) =>
    ipcRenderer.invoke('is-bookmarked', url),

  getBookmarkFolders: () =>
    ipcRenderer.invoke('get-bookmark-folders'),

  saveBookmarkToFolder: (bookmarkData, folderId) =>
    ipcRenderer.invoke('save-bookmark-to-folder', bookmarkData, folderId),

  // Password management
  savePassword: (passwordData) =>
    ipcRenderer.invoke('save-password', passwordData),

  onPasswordDetected: (callback) => {
    ipcRenderer.on('password-detected', (event, data) => callback(data));
  },

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
});

// Receive requests from main to load a URL into this card's webview
ipcRenderer.on('card-load-url', (event, url) => {
  window.dispatchEvent(new CustomEvent('card-load-url', { detail: url }));
});