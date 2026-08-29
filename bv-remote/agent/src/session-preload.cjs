// Preload for the hidden session window. Bridges the WebRTC renderer to the main
// process (screen source, signaling relay, input relay). CommonJS on purpose —
// Electron loads preloads as CJS.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bvSession', {
  getSource: () => ipcRenderer.invoke('bv:get-source'),
  onStart: (cb) => ipcRenderer.on('bv:start', (_e, d) => cb(d)),
  onAnswer: (cb) => ipcRenderer.on('bv:answer', (_e, a) => cb(a)),
  onAdminCandidate: (cb) => ipcRenderer.on('bv:admin-candidate', (_e, c) => cb(c)),
  onSetFps: (cb) => ipcRenderer.on('bv:set-fps', (_e, fps) => cb(fps)),
  sendOffer: (nonce, offer) => ipcRenderer.send('bv:offer', { nonce, offer }),
  sendCandidate: (nonce, candidate) => ipcRenderer.send('bv:device-candidate', { nonce, candidate }),
  sendInput: (evt) => ipcRenderer.send('bv:input', evt),
})
