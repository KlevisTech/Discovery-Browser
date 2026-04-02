// preload.js - For main control panel window
const { contextBridge, ipcRenderer } = require('electron');

// Simple IPC invoke wrapper that inline scripts can use
window.ipcInvoke = function(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
};

// Build the complete electronAPI object
const electronAPI = {
  // ========================
  // Card management
  // ========================
  createCard: (cardId, url, position, themeKey, launchSizeMode) => ipcRenderer.invoke('create-card', cardId, url, position, themeKey, launchSizeMode),
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
    ipcRenderer.on('open-external-url', (event, url) => {
      callback(url);
    });
  },

  // External card created handler - for when cards are created directly from main process
  onExternalCardCreated: (callback) => {
    ipcRenderer.on('external-card-created', (event, cardData) => {
      callback(cardData);
    });
  },

  onAuthOpenedExternally: (callback) => {
    ipcRenderer.on('auth-opened-externally', (event, payload) => callback(payload));
  },
  confirmAuthOpenExternal: (requestId) => {
    return ipcRenderer.invoke('confirm-auth-open-external', requestId);
  },
  cancelAuthOpenExternal: (requestId) => {
    return ipcRenderer.invoke('cancel-auth-open-external', requestId);
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

  syncBookmarkFolders: (folders) => {
    ipcRenderer.invoke('sync-bookmark-folders', folders);
  },

  // Article management
  onSaveArticle: (callback) => {
    ipcRenderer.on('save-article', (event, articleData) => callback(articleData));
  },

  // Password manager is disabled until secure OS-backed storage is implemented.
  onSavePassword: () => {},
  syncPasswords: async () => ({ success: false, disabled: true }),
  
  // Addon management
  updateAddons: (addons) => ipcRenderer.invoke('update-addons', addons),
  
  // Default browser setting
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser-ui'),
  isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser-ui'),

  // Downloads
  onDownloadStarted: (callback) => {
    ipcRenderer.on('download-started', (event, payload) => {
      console.warn('[Preload] download-started received');
      callback(payload);
    });
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, payload) => {
      console.warn('[Preload] download-progress received');
      callback(payload);
    });
  },
  onDownloadDone: (callback) => {
    ipcRenderer.on('download-done', (event, payload) => {
      console.warn('[Preload] download-done received', payload);
      callback(payload);
    });
  },
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),

  // Notifications
  onNotificationReceived: (callback) => {
    ipcRenderer.on('notification-received', (event, payload) => callback(payload));
  },

  // Updates
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  openUpdateDownload: () => ipcRenderer.invoke('open-update-download'),

  // Visualizer setting
  setVisualizerEnabled: (enabled) => ipcRenderer.invoke('set-visualizer-enabled', enabled),
  getVisualizerEnabled: () => ipcRenderer.invoke('get-visualizer-enabled'),

  // Card theme management
  setCardTheme: (themeKey) => ipcRenderer.invoke('set-card-theme', themeKey),
  getCardTheme: () => ipcRenderer.invoke('get-card-theme'),
  setCardLaunchSizeMode: (mode) => ipcRenderer.invoke('set-card-launch-size-mode', mode),
  getCardLaunchSizeMode: () => ipcRenderer.invoke('get-card-launch-size-mode'),
  setSiteLayoutOverrides: (overrides) => ipcRenderer.invoke('set-site-layout-overrides', overrides),

  // Clear all user data
  clearUserData: () => ipcRenderer.invoke('clear-user-data'),

  // Search card creation from readmode
  onCreateCardFromSearch: (callback) => {
    ipcRenderer.on('create-card-from-search', (event, searchUrl) => callback(searchUrl));
  },

  // Articles recap window
  openArticlesRecap: () => ipcRenderer.invoke('open-articles-recap'),

  // Uploaded document reading
  pickReadmodeFile: () => ipcRenderer.invoke('pick-readmode-file'),
  openReadmodeDocument: (fileUrl, title) => ipcRenderer.invoke('open-readmode-document', fileUrl, title),
};
// Expose to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
