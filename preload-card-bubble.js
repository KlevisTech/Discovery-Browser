const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cardBubbleAPI', {
  restoreCard: (cardId) => ipcRenderer.invoke('restore-card-from-bubble', cardId),
  closeBubbleAndCard: (cardId) => ipcRenderer.invoke('close-bubble-and-card', cardId),
  showContextMenu: (cardId) => ipcRenderer.invoke('show-bubble-context-menu', cardId),
  
  // Listen for notification updates from main process
  onNotificationUpdate: (callback) => {
    ipcRenderer.on('bubble-notification-update', (event, count) => callback(count));
  },
  
  // Remove notification listener
  removeNotificationListener: () => {
    ipcRenderer.removeAllListeners('bubble-notification-update');
  }
});
