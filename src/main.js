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
let splash;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DOWNLOADS_DB = path.join(app.getPath('userData'), 'active_downloads.json');

// ---------------------------------------------------------
// SINGLE INSTANCE LOCK
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
      if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
  });
}

// ---------------------------------------------------------
// SAVE & RESTORE LOGIC (AUTO-RESUME)
// ---------------------------------------------------------

// 1. SAVE: Runs before the app quits
function saveState() {
    // Convert active torrents to a simple JSON list
    const active = client.torrents.map(t => ({
        id: t.uiId,      // Custom ID we attached
        title: t.uiTitle,
        magnet: t.magnetURI,
        path: t.path,
        paused: false 
    }));
    
    try {
        fs.writeFileSync(DOWNLOADS_DB, JSON.stringify(active));
        console.log("✅ Saved state:", active.length, "downloads.");
    } catch (e) { console.error("Save failed:", e); }
}

// 2. RESTORE: Runs when app starts
function restoreDownloads() {
    if (!fs.existsSync(DOWNLOADS_DB)) return;

    try {
        const saved = JSON.parse(fs.readFileSync(DOWNLOADS_DB));
        console.log("🔄 Restoring", saved.length, "downloads...");

        saved.forEach(item => {
            // Restart the torrent engine for each item
            // We pass 'true' to indicate this is a RESTORE (not a new user click)
            startTorrent(null, item, true); 
        });

        // Send the list to the UI so the Sidebar pops up
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('restore-downloads', saved);
            }
        }, 2000); // Wait 2s for window to fully load

    } catch (e) { console.error("Restore failed:", e); }
}

// Save when quitting
app.on('before-quit', () => {
    saveState();
});

// --- HELPER: CONFIG ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch (e) {}
    return { downloadPath: app.getPath('downloads') };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

// --- WINDOW CREATION ---
function createWindow() {
  
  // 1. Create SPLASH Window
  splash = new BrowserWindow({
    width: 500, height: 350, transparent: true, frame: false, alwaysOnTop: true,
    icon: path.join(__dirname, '../icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  splash.loadFile('src/splash.html');

  // 2. Create MAIN Window (Hidden initially)
  mainWindow = new BrowserWindow({
    width: 1000, height: 800, show: false,
    icon: path.join(__dirname, '../icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true }
  });
  
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('src/index.html');

  // --- UPDATE / LAUNCH LOGIC ---
  
  const sendStatus = (text) => {
      if (splash && !splash.isDestroyed()) {
        try { splash.webContents.send('update-status', text); } catch (e) {}
      }
  };

  const launchMainApp = () => {
      if (splash && !splash.isDestroyed()) {
          splash.destroy();
          mainWindow.show();
          restoreDownloads(); // <--- RESTORE STARTS HERE
      }
  };

  splash.webContents.once('did-finish-load', () => {
      splash.webContents.send('app-version', app.getVersion());

      // FIX: Skip updates if in Dev Mode (npm start)
      if (!app.isPackaged) {
          sendStatus("Dev Mode: Launching...");
          setTimeout(launchMainApp, 1500); 
          return; 
      }

      sendStatus("Checking for updates...");
      
      // Safety Timeout
      setTimeout(() => {
          console.log("Updater timed out. Forcing launch.");
          launchMainApp();
      }, 10000);

      autoUpdater.checkForUpdatesAndNotify().catch(err => console.log(err));
  });

  // Events to switch to Main Window
  autoUpdater.on('update-not-available', () => {
      sendStatus("Up to date! Launching...");
      setTimeout(launchMainApp, 1500);
  });

  autoUpdater.on('error', (err) => {
      sendStatus("Update check failed. Launching...");
      setTimeout(launchMainApp, 1500);
  });

  // Standard Update Events
  autoUpdater.on('update-available', () => sendStatus("New version found. Downloading..."));
  autoUpdater.on('download-progress', (p) => sendStatus(`Downloading: ${p.percent.toFixed(0)}%`));
  autoUpdater.on('update-downloaded', () => {
      sendStatus("Update Ready. Restarting...");
      setTimeout(() => autoUpdater.quitAndInstall(), 2000);
  });
}

// --- HANDLERS ---
ipcMain.handle('search-movies', async (event, query) => {
  try {
    const results = await TorrentSearchApi.search(query, 'All', 1000);
    return results.filter(t => {
       const isVideo = /1080p|720p|480p|BluRay|WEBRip|H.264|x265|AVI|MKV|MP4/i.test(t.title);
       return t.seeds > 0 && isVideo;
    });
  } catch (err) { return []; }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    saveConfig({ downloadPath: result.filePaths[0] });
    return result.filePaths[0];
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.on('start-download', (event, torrentData) => { startTorrent(event, torrentData); });
ipcMain.on('resume-download', (event, torrentData) => { startTorrent(event, torrentData); });

ipcMain.on('pause-download', (event, magnet) => {
    if (!magnet) return;
    const torrent = client.get(magnet);
    if (torrent) torrent.destroy();
});

ipcMain.on('cancel-download', (event, magnet) => {
    if (!magnet) return;
    const torrent = client.get(magnet);
    if (torrent) {
        client.remove(magnet, { destroyStore: true });
    }
});

ipcMain.on('show-in-folder', (event, filePath) => { shell.showItemInFolder(filePath); });

// ---------------------------------------------------------
// CORE DOWNLOAD FUNCTION (UPDATED FOR RESTORE)
// ---------------------------------------------------------
async function startTorrent(event, torrentData, isRestore = false) {
  const config = loadConfig();
  
  // If restoring, use the path saved in the file. Otherwise use default config.
  const downloadLocation = (isRestore && torrentData.path) ? torrentData.path : config.downloadPath;

  let magnet = torrentData.magnet;
  if (!magnet) {
      try {
          console.log(`🧲 Fetching magnet for: ${torrentData.title}`);
          magnet = await TorrentSearchApi.getMagnet(torrentData);
          if (!magnet) throw new Error("Magnet link not found.");
      } catch (e) {
          console.error(e);
          if(mainWindow) mainWindow.webContents.send('download-error', { id: torrentData.id, message: "No Magnet" });
          return;
      }
  }

  // Prevent duplicates
  if (client.get(magnet)) return; 

  // START DOWNLOAD
  client.add(magnet, { path: downloadLocation }, (torrent) => {
    
    // Save metadata needed for restoring later
    torrent.uiId = torrentData.id;       
    torrent.uiTitle = torrentData.title; 

    // IMPORTANT: Only tell UI "Started" if it's NEW (not restoring)
    // If we are restoring, the UI gets the list separately via 'restore-downloads'
    if (!isRestore && mainWindow) {
        mainWindow.webContents.send('download-started', { id: torrentData.id, magnet: magnet });
    }
    
    // Progress Loop
    const interval = setInterval(() => {
        if (!mainWindow || torrent.destroyed) return clearInterval(interval);
        
        mainWindow.webContents.send('download-progress', {
            id: torrent.uiId, 
            progress: (torrent.progress * 100).toFixed(1),
            speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2),
            downloaded: torrent.downloaded,
            total: torrent.length,
            peers: torrent.numPeers,
            magnet: magnet 
        });

        if (torrent.progress === 1) clearInterval(interval);
    }, 1000);

    torrent.on('done', () => {
      const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));
      const fullPath = file ? path.join(downloadLocation, file.path) : "";
      
      mainWindow.webContents.send('download-complete', { 
          id: torrent.uiId, 
          title: torrent.uiTitle, 
          path: fullPath 
      });
    });
    
    torrent.on('error', (err) => {
        mainWindow.webContents.send('download-error', { id: torrent.uiId, message: err.message });
    });
  });
}