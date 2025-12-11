const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const WebTorrent = require('webtorrent');
const TorrentSearchApi = require('torrent-search-api');
const fs = require('fs');

// Initialize
const client = new WebTorrent();
TorrentSearchApi.enablePublicProviders();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // Security best practice
      contextIsolation: true
    }
  });

  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(createWindow);

// --- 1. SEARCH HANDLER ---
ipcMain.handle('search-movies', async (event, query) => {
  try {
    console.log(`🔎 Searching for: ${query}`);
    const results = await TorrentSearchApi.search(query, 'All', 50);
    
    // Filter for videos with seeds
    return results.filter(t => t.seeds > 0 && /1080p|720p|BRRip|WebRip/i.test(t.title));
  } catch (err) {
    console.error(err);
    return [];
  }
});

// --- 2. DOWNLOAD HANDLER ---
ipcMain.on('start-download', async (event, torrentData) => {
  const magnet = await TorrentSearchApi.getMagnet(torrentData);
  const downloadPath = app.getPath('downloads'); // Saves to user's "Downloads" folder

  console.log(`⬇️ Starting download: ${torrentData.title}`);

  client.add(magnet, { path: downloadPath }, (torrent) => {
    
    // Send progress updates every 1 second
    const interval = setInterval(() => {
        if (!mainWindow) return clearInterval(interval);
        
        const progress = (torrent.progress * 100).toFixed(1);
        const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2); // MB/s
        
        mainWindow.webContents.send('download-progress', {
            id: torrentData.id, // Use ID to update specific row
            progress: progress,
            speed: speed,
            peers: torrent.numPeers
        });

        if (torrent.progress === 1) clearInterval(interval);
    }, 1000);

    torrent.on('done', () => {
      console.log('✅ Download complete');
      mainWindow.webContents.send('download-complete', { title: torrentData.title });
    });
  });
});

// --- 3. OPEN FOLDER ---
ipcMain.on('open-folder', () => {
    shell.openPath(app.getPath('downloads'));
});