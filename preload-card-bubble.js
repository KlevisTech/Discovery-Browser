const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cardBubbleAPI', {
  restoreCard: (cardId) => ipcRenderer.invoke('restore-card-from-bubble', cardId),
});
