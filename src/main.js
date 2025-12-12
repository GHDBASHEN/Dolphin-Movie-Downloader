const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const WebTorrent = require('webtorrent');
const TorrentSearchApi = require('torrent-search-api');
const fs = require('fs');

// --- CONFIGURATION ---
TorrentSearchApi.enablePublicProviders();
const client = new WebTorrent();
let mainWindow;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// ---------------------------------------------------------
// SINGLE INSTANCE LOCK (Prevents multiple windows)
// ---------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
      createWindow();
      // Check for updates after window loads
      autoUpdater.checkForUpdatesAndNotify();
  });
}

// --- HELPER: LOAD/SAVE CONFIG ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH));
        }
    } catch (e) { console.error(e); }
    return { downloadPath: app.getPath('downloads') };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

// --- WINDOW CREATION ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  mainWindow.setMenuBarVisibility(false); // Optional: Hides top menu
  mainWindow.loadFile('src/index.html');
}

// --- HANDLER 1: SEARCH MOVIES ---
ipcMain.handle('search-movies', async (event, query) => {
  try {
    const activeProviders = TorrentSearchApi.getActiveProviders().map(p => p.name).join(', ');
    console.log(`🔎 Searching for: "${query}" via [${activeProviders}]`);

    // Fetch 100 results for pagination
    const results = await TorrentSearchApi.search(query, 'All', 100);
    console.log(`✅ Found ${results.length} raw results`);

    return results.filter(t => {
        const isVideo = /1080p|720p|480p|BluRay|WEBRip|H.264|x265|AVI|MKV|MP4/i.test(t.title);
        return t.seeds > 0 && isVideo;
    });

  } catch (err) {
    console.error("❌ Search Error:", err);
    return [];
  }
});

// --- HANDLER 2: SELECT FOLDER ---
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled) return null;
    
    const newPath = result.filePaths[0];
    saveConfig({ downloadPath: newPath });
    return newPath;
});

// --- HANDLER 3: GET CONFIG ---
ipcMain.handle('get-config', () => {
    return loadConfig();
});

// --- HANDLER 4: START & RESUME DOWNLOAD ---
ipcMain.on('start-download', (event, torrentData) => { startTorrent(event, torrentData); });
ipcMain.on('resume-download', (event, torrentData) => { startTorrent(event, torrentData); });

// --- HANDLER 5: PAUSE ---
ipcMain.on('pause-download', (event, magnet) => {
    if (!magnet) return;
    const torrent = client.get(magnet);
    if (torrent) torrent.destroy();
});

// --- HANDLER 6: CANCEL ---
ipcMain.on('cancel-download', (event, magnet) => {
    if (!magnet) return;
    const torrent = client.get(magnet);
    if (torrent) {
        // Destroy and delete file
        client.remove(magnet, { destroyStore: true }, (err) => {
            if(!err) console.log("Deleted file");
        });
    }
});

// --- HANDLER 7: LOCATE FILE ---
ipcMain.on('show-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});

// ---------------------------------------------------------
// CORE DOWNLOAD FUNCTION
// ---------------------------------------------------------
async function startTorrent(event, torrentData) {
  const config = loadConfig();
  
  // 1. Get Magnet
  let magnet = torrentData.magnet;
  if (!magnet) {
      try {
          console.log(`🧲 Fetching magnet for: ${torrentData.title}`);
          magnet = await TorrentSearchApi.getMagnet(torrentData);
          if (!magnet) throw new Error("Magnet link not found.");
      } catch (e) {
          console.error("Failed to fetch magnet:", e);
          mainWindow.webContents.send('download-error', { 
              id: torrentData.id, 
              message: "Failed to get Magnet. Check VPN." 
          });
          return;
      }
  }

  // 2. Check Duplicates
  if (client.get(magnet)) return; 

  // 3. Start
  client.add(magnet, { path: config.downloadPath }, (torrent) => {
    
    // Send Magnet back to UI immediately
    mainWindow.webContents.send('download-started', {
        id: torrentData.id,
        magnet: magnet
    });
    
    // Progress Loop
    const interval = setInterval(() => {
        if (!mainWindow || torrent.destroyed) return clearInterval(interval);
        
        mainWindow.webContents.send('download-progress', {
            id: torrentData.id,
            progress: (torrent.progress * 100).toFixed(1),
            speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2), // MB/s
            downloaded: torrent.downloaded, // New: Bytes downloaded
            total: torrent.length,          // New: Total file size
            peers: torrent.numPeers,
            magnet: magnet 
        });

        if (torrent.progress === 1) clearInterval(interval);
    }, 1000);

    // Completion
    torrent.on('done', () => {
      const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));
      
      let fullPath = "";
      if (file) {
          fullPath = path.join(config.downloadPath, file.path);
      }

      mainWindow.webContents.send('download-complete', { 
          id: torrentData.id,
          title: torrentData.title,
          path: fullPath 
      });
    });
    
    // Errors
    torrent.on('error', (err) => {
        mainWindow.webContents.send('download-error', { 
            id: torrentData.id, 
            message: "Error: " + err.message 
        });
    });
  });
}

// ---------------------------------------------------------
// AUTO UPDATER EVENTS
// ---------------------------------------------------------
autoUpdater.on('update-available', () => {
  mainWindow.webContents.send('update-message', 'New version available. Downloading...');
});

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'A new version has been downloaded. Restart now to install?',
    buttons: ['Restart', 'Later']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});