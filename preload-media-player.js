const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaPlayerAPI', {
  closeWindow: () => ipcRenderer.invoke('close-media-player-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-media-player-window'),
  toggleFullscreen: (shouldBeFullscreen) => ipcRenderer.invoke('toggle-media-player-fullscreen', shouldBeFullscreen),
  pickMediaFile: () => ipcRenderer.invoke('pick-media-file'),
  pickMediaFolder: () => ipcRenderer.invoke('pick-media-folder'),
  openExternal: (targetUrl) => ipcRenderer.invoke('open-media-player-external', targetUrl),
  onOpenSource: (callback) => {
    ipcRenderer.on('media-player-open-source', (event, payload) => callback(payload));
  },
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('media-player-fullscreen-changed', (event, value) => callback(Boolean(value)));
  },
  onStreamDetected: (callback) => {
    ipcRenderer.on('stream-detected', (event, streamUrl) => {
      console.log('[MediaPlayer Preload] Stream detected:', streamUrl);
      callback(streamUrl);
    });
  },
});
