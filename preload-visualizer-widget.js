const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visualizerWidgetAPI', {
  onStateUpdate: (callback) => {
    const listener = (event, payload) => callback(payload || {});
    ipcRenderer.on('visualizer-widget-state', listener);
    return () => ipcRenderer.removeListener('visualizer-widget-state', listener);
  },
  sendAction: (cardId, action, value) =>
    ipcRenderer.invoke('visualizer-widget-action', cardId, action, value),
});
