const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tracker', {
  state: () => ipcRenderer.invoke('state'),
  sendCode: email => ipcRenderer.invoke('code.send', email),
  verify: (email, code) => ipcRenderer.invoke('code.verify', email, code),
  accept: () => ipcRenderer.invoke('accept'),
  refresh: () => ipcRenderer.invoke('refresh'),
  signOut: () => ipcRenderer.invoke('signout'),
  open: what => ipcRenderer.invoke('open', what),
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
});
