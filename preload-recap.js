const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recapAPI', {
  closeWindow: () => ipcRenderer.invoke('close-recap-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-recap-window'),
  toggleFullscreen: (shouldBeFullscreen) => ipcRenderer.invoke('toggle-recap-fullscreen', shouldBeFullscreen),
  openReadmodeCard: (url, title) => ipcRenderer.invoke('open-readmode-card', url, title || 'Read Mode'),
  getSavedArticles: () => ipcRenderer.invoke('get-saved-articles-for-recap'),
  setSavedArticles: (articles) => ipcRenderer.invoke('set-saved-articles-for-recap', articles),
  googleSearch: (query) => ipcRenderer.invoke('google-search', query),
  openChatGPT: () => ipcRenderer.invoke('open-chatgpt'),
});
