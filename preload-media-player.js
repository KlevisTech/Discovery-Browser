const { contextBridge, ipcRenderer } = require('electron');

function getInitialCardTheme() {
  try {
    const prefix = '--discovery-media-theme=';
    const arg = process.argv.find((value) => typeof value === 'string' && value.startsWith(prefix));
    return arg ? decodeURIComponent(arg.slice(prefix.length)) : 'primary';
  } catch (e) {
    return 'primary';
  }
}
contextBridge.exposeInMainWorld('mediaPlayerAPI', {
  closeWindow: (options) => ipcRenderer.invoke('close-media-player-window', options),
  minimizeWindow: () => ipcRenderer.invoke('minimize-media-player-window'),
  toggleFullscreen: (shouldBeFullscreen) => ipcRenderer.invoke('toggle-media-player-fullscreen', shouldBeFullscreen),
  getInitialCardTheme: () => getInitialCardTheme(),
  getCardTheme: () => ipcRenderer.invoke('get-card-theme'),
  pickMediaFile: () => ipcRenderer.invoke('pick-media-file'),
  pickMediaFolder: () => ipcRenderer.invoke('pick-media-folder'),
  getMediaThumbnail: (filePath) => ipcRenderer.invoke('get-media-file-thumbnail', filePath),
  onOpenSource: (callback) => {
    ipcRenderer.on('media-player-open-source', (event, payload) => callback(payload));
  },
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('media-player-fullscreen-changed', (event, value) => callback(Boolean(value)));
  },
  onCardThemeChanged: (callback) => {
    ipcRenderer.on('card-theme-changed', (event, themeKey) => callback(themeKey));
  },
  onStreamDetected: (callback) => {
    ipcRenderer.on('stream-detected', (event, streamUrl) => {
      console.log('[MediaPlayer Preload] Stream detected:', streamUrl);
      callback(streamUrl);
    });
  },
});
