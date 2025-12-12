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
  
  // 1. Create SPLASH Window
  const splash = new BrowserWindow({
    width: 500,
    height: 350,
    transparent: true, 
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, '../icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  
  splash.loadFile('src/splash.html');

  splash.webContents.once('did-finish-load', () => {
      splash.webContents.send('app-version', app.getVersion());
      });

  // 2. Create MAIN Window (Hidden)
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('src/index.html');

  // --- UPDATE CHECK LOGIC ---
  
  const sendStatus = (text) => {
      // Check if splash still exists before sending
      if (splash && !splash.isDestroyed()) {
        try { splash.webContents.send('update-status', text); } catch (e) {}
      }
  };

  // Helper to safely switch windows
  const launchMainApp = () => {
      if (splash && !splash.isDestroyed()) {
          splash.destroy();
          mainWindow.show();
      }
  };

  splash.webContents.once('did-finish-load', () => {
      
      // FIX 1: SKIP UPDATES IF IN DEV MODE
      // 'app.isPackaged' is true only in built production apps (.exe/.dmg)
      if (!app.isPackaged) {
          sendStatus("Dev Mode: Launching...");
          setTimeout(launchMainApp, 1500); 
          return; // Stop here, don't run the updater
      }

      sendStatus("Checking for updates...");
      
      // FIX 2: SAFETY TIMEOUT
      // If the updater hangs for 10 seconds, force the app to open
      setTimeout(() => {
          console.log("Updater timed out. Forcing launch.");
          launchMainApp();
      }, 10000);

      // Start the check
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.log("Update check issue:", err);
          // Don't launch here, let the 'error' event or timeout handle it
      });
  });

  // Event: No Update Found (Launch App)
  autoUpdater.on('update-not-available', () => {
      sendStatus("Up to date! Launching...");
      setTimeout(launchMainApp, 1500);
  });

  // Event: Update Found (Download it)
  autoUpdater.on('update-available', () => {
      sendStatus("New version found. Downloading...");
  });

  // Event: Downloading Progress
  autoUpdater.on('download-progress', (progressObj) => {
      const log_message = `Downloading: ${progressObj.percent.toFixed(0)}%`;
      sendStatus(log_message);
  });

  // Event: Update Downloaded (Restart)
  autoUpdater.on('update-downloaded', () => {
      sendStatus("Update Ready. Restarting...");
      setTimeout(() => {
          autoUpdater.quitAndInstall();
      }, 2000);
  });

  // Event: Error (Launch App anyway)
  autoUpdater.on('error', (err) => {
      sendStatus("Update check failed. Launching...");
      console.log(err);
      setTimeout(launchMainApp, 2000);
  });
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