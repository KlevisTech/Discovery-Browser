const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sideFlamesWidgetAPI', {
  onStateUpdate: (callback) => {
    const listener = (event, payload) => callback(payload || {});
    ipcRenderer.on('side-flames-widget-state', listener);
    return () => ipcRenderer.removeListener('side-flames-widget-state', listener);
  },
});
