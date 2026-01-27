// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // Card management
  createCard: (cardId, url, position) => 
    ipcRenderer.invoke('create-card', cardId, url, position),
  
  updateCardPosition: (cardId, x, y) => 
    ipcRenderer.invoke('update-card-position', cardId, x, y),
  
  navigateCard: (cardId, url) => 
    ipcRenderer.invoke('navigate-card', cardId, url),
  
  closeCard: (cardId) => 
    ipcRenderer.invoke('close-card', cardId),

  // Navigation controls
  cardGoBack: (cardId) => 
    ipcRenderer.invoke('card-go-back', cardId),
  
  cardGoForward: (cardId) => 
    ipcRenderer.invoke('card-go-forward', cardId),
  
  cardReload: (cardId) => 
    ipcRenderer.invoke('card-reload', cardId),

  // Event listeners
  onCardClosed: (callback) => {
    const listener = (event, cardId) => callback(cardId);
    ipcRenderer.on('card-closed', listener);
    return () => ipcRenderer.removeListener('card-closed', listener);
  },

  onCardTitleUpdated: (callback) => {
    const listener = (event, cardId, title) => callback(cardId, title);
    ipcRenderer.on('card-title-updated', listener);
    return () => ipcRenderer.removeListener('card-title-updated', listener);
  },

  onCardUrlUpdated: (callback) => {
    const listener = (event, cardId, url) => callback(cardId, url);
    ipcRenderer.on('card-url-updated', listener);
    return () => ipcRenderer.removeListener('card-url-updated', listener);
  },

  // Update addons metadata (from renderer)
  updateAddons: (addonsArray) =>
    ipcRenderer.invoke('update-addons', addonsArray),

  // ADD THIS:
  onOpenUrl: (callback) => {
    const listener = (event, url) => callback(url);
    ipcRenderer.on('open-external-url', listener);
    return () => ipcRenderer.removeListener('open-external-url', listener);
  }
});