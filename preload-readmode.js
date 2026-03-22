//preload-readmode.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods for readmode windows via contextBridge
contextBridge.exposeInMainWorld('readmodeAPI', {
  // Close readmode window
  closeReadmode: (readmodeId) =>
    ipcRenderer.invoke('close-readmode', readmodeId),

  // Navigate readmode webview
  navigateReadmode: (readmodeId, url) =>
    ipcRenderer.invoke('navigate-readmode', readmodeId, url),

  // Get current URL
  getCurrentUrl: () =>
    ipcRenderer.invoke('get-readmode-url'),

  // Update window position
  updateWindowPosition: (x, y, readmodeId) =>
    ipcRenderer.invoke('update-readmode-position', readmodeId, x, y),

  // Listen for window events
  onWindowMoved: (callback) => {
    const listener = () => callback();
    window.addEventListener('move', listener);
    return () => window.removeEventListener('move', listener);
  },

  // Minimize window
  minimizeReadmode: () =>
    ipcRenderer.invoke('minimize-readmode-window'),

  // Toggle fullscreen
  toggleFullscreen: (shouldBeFullscreen) =>
    ipcRenderer.invoke('toggle-readmode-fullscreen', shouldBeFullscreen),
});

// Receive URL updates from main process
ipcRenderer.on('readmode-url-updated', (event, url) => {
  window.dispatchEvent(new CustomEvent('readmode-url-updated', { detail: url }));
});
