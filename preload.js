'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  launchGame: (id) => ipcRenderer.invoke('launch-game', id),
});
