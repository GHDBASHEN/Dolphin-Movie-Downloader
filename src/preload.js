const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchMovies: (query) => ipcRenderer.invoke('search-movies', query),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  startDownload: (torrent) => ipcRenderer.send('start-download', torrent),
  pauseDownload: (magnet) => ipcRenderer.send('pause-download', magnet),
  resumeDownload: (torrent) => ipcRenderer.send('resume-download', torrent),
  cancelDownload: (magnet) => ipcRenderer.send('cancel-download', magnet),
  
  // NEW: Locate File
  showItemInFolder: (path) => ipcRenderer.send('show-in-folder', path),
  previewFile: (id) => ipcRenderer.send('preview-file', id),

  // Listeners
  onStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('download-error', (event, data) => callback(data)),
  onUpdateMessage: (callback) => ipcRenderer.on('update-message', (event, msg) => callback(msg)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, text) => callback(text)),
  onRestore: (callback) => ipcRenderer.on('restore-downloads', (event, data) => callback(data))
});