// preload.js - For main control panel window
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Card management
  createCard: (cardId, url, position) => ipcRenderer.invoke('create-card', cardId, url, position),
  closeCard: (cardId) => ipcRenderer.invoke('close-card', cardId),
  
  // Card navigation
  cardGoBack: (cardId) => ipcRenderer.invoke('card-go-back', cardId),
  cardGoForward: (cardId) => ipcRenderer.invoke('card-go-forward', cardId),
  cardReload: (cardId) => ipcRenderer.invoke('card-reload', cardId),
  
  // Card events from main process
  onCardClosed: (callback) => {
    ipcRenderer.on('card-closed', (event, cardId) => callback(cardId));
  },
  onCardTitleUpdated: (callback) => {
    ipcRenderer.on('card-title-updated', (event, cardId, title) => callback(cardId, title));
  },
  onCardUrlUpdated: (callback) => {
    ipcRenderer.on('card-url-updated', (event, cardId, url) => callback(cardId, url));
  },
  onCardLoadingStart: (callback) => {
    ipcRenderer.on('card-loading-start', (event, cardId) => callback(cardId));
  },
  onCardLoadingFinish: (callback) => {
    ipcRenderer.on('card-loading-finish', (event, cardId, title, url) => callback(cardId, title, url));
  },
  
  // External URL handler - for when links are opened from outside the app
  onOpenUrl: (callback) => {
    console.log('[PRELOAD] onOpenUrl listener registered');
    ipcRenderer.on('open-external-url', (event, url) => {
      console.log('=== [PRELOAD DEBUG] ===');
      console.log('[PRELOAD] Received open-external-url IPC');
      console.log('[PRELOAD] URL:', url);
      console.log('[PRELOAD] Calling callback...');
      callback(url);
      console.log('[PRELOAD] Callback completed');
      console.log('=== [END PRELOAD DEBUG] ===\n');
    });
  },
  
  // Bookmark management
  onToggleBookmark: (callback) => {
    ipcRenderer.on('toggle-bookmark', (event, bookmarkData) => callback(bookmarkData));
  },
  
  onCheckBookmarkStatus: (callback) => {
    ipcRenderer.on('check-bookmark-status', (event, url) => callback(url));
  },
  
  sendBookmarkStatus: (isBookmarked) => {
    ipcRenderer.send('bookmark-status-response', isBookmarked);
  },

  onGetBookmarkFolders: (callback) => {
    ipcRenderer.on('get-bookmark-folders', (event) => callback());
  },

  sendBookmarkFolders: (folders) => {
    ipcRenderer.send('bookmark-folders-response', folders);
  },

  onSaveBookmarkToFolder: (callback) => {
    ipcRenderer.on('save-bookmark-to-folder', (event, bookmarkData, folderId) => callback(bookmarkData, folderId));
  },

  // Sync folders to main process so card windows can read them directly
  syncBookmarkFolders: (folders) => {
    ipcRenderer.invoke('sync-bookmark-folders', folders);
  },

  // Password management
  onSavePassword: (callback) => {
    ipcRenderer.on('save-password', (event, passwordData) => callback(passwordData));
  },

  syncPasswords: (passwords) => {
    ipcRenderer.invoke('sync-passwords', passwords);
  },
  
  // Addon management
  updateAddons: (addons) => ipcRenderer.invoke('update-addons', addons),
  
  // Default browser setting
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser-ui'),
  isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser-ui'),

  // Downloads
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

  // Notifications
  onNotificationReceived: (callback) => {
    ipcRenderer.on('notification-received', (event, payload) => callback(payload));
  },

  // Visualizer setting
  setVisualizerEnabled: (enabled) => ipcRenderer.invoke('set-visualizer-enabled', enabled),
  getVisualizerEnabled: () => ipcRenderer.invoke('get-visualizer-enabled'),

  // Clear all user data
  clearUserData: () => ipcRenderer.invoke('clear-user-data'),
});
