const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchMovies: (query) => ipcRenderer.invoke('search-movies', query),
  startDownload: (torrent) => ipcRenderer.send('start-download', torrent),
  openFolder: () => ipcRenderer.send('open-folder'),
  onProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data))
});