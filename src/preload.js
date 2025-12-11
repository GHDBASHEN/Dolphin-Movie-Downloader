const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchMovies: (query) => ipcRenderer.invoke('search-movies', query),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  startDownload: (torrent) => ipcRenderer.send('start-download', torrent),
  pauseDownload: (magnet) => ipcRenderer.send('pause-download', magnet),
  resumeDownload: (torrent) => ipcRenderer.send('resume-download', torrent),
  cancelDownload: (magnet) => ipcRenderer.send('cancel-download', magnet),

  // Listeners
  onStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  
  // NEW: Error Listener
  onError: (callback) => ipcRenderer.on('download-error', (event, data) => callback(data))
});