const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaProgressWidgetAPI', {
  onStateUpdate: (callback) => {
    ipcRenderer.on('media-progress-widget-state', (_event, payload) => {
      try {
        callback(payload || {});
      } catch (e) { }
    });
  },
});
