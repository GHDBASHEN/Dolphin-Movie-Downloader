const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const WebTorrent = require('webtorrent');
const TorrentSearchApi = require('torrent-search-api');
const fs = require('fs');

// --- CONFIGURATION ---
TorrentSearchApi.enablePublicProviders(); // Fix for "No Results"
const client = new WebTorrent();
let mainWindow;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

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
  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(createWindow);

// --- HANDLER 1: SEARCH MOVIES ---
ipcMain.handle('search-movies', async (event, query) => {
  try {
    const activeProviders = TorrentSearchApi.getActiveProviders().map(p => p.name).join(', ');
    console.log(`🔎 Searching for: "${query}" via [${activeProviders}]`);

    // FETCH 100 RESULTS (Enough for 5 pages of 20)
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
// We use the same helper function for both
ipcMain.on('start-download', (event, torrentData) => {
    startTorrent(event, torrentData);
});

ipcMain.on('resume-download', (event, torrentData) => {
    console.log(`▶️ Resuming: ${torrentData.title}`);
    startTorrent(event, torrentData);
});

// --- CORE FUNCTION: THE DOWNLOADER ---
// --- CORE FUNCTION: THE DOWNLOADER ---
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
              message: "Failed to get Magnet Link." 
          });
          return;
      }
  }

  const finalPath = config.downloadPath;

  // 2. Check duplicates
  if (client.get(magnet)) {
      console.log("⚠️ Torrent already active.");
      return; 
  }

  // 3. Start Download
  client.add(magnet, { path: finalPath }, (torrent) => {
    console.log(`✅ Download started: ${torrentData.title}`);

    mainWindow.webContents.send('download-started', {
        id: torrentData.id,
        magnet: magnet
    });
    
    const interval = setInterval(() => {
        if (!mainWindow || torrent.destroyed) return clearInterval(interval);
        
        mainWindow.webContents.send('download-progress', {
            id: torrentData.id,
            progress: (torrent.progress * 100).toFixed(1),
            speed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2),
            peers: torrent.numPeers,
            magnet: magnet 
        });

        if (torrent.progress === 1) clearInterval(interval);
    }, 1000);

    // --- UPDATED: HANDLE COMPLETION ---
    torrent.on('done', () => {
      // Find the video file again to get the correct path
      const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));
      
      let fullPath = "";
      if (file) {
          // Construct full path for Windows/Mac
          fullPath = path.join(finalPath, file.path);
      }

      console.log(`🎉 Done: ${fullPath}`);

      // Send ID and PATH so UI can show "Locate" button
      mainWindow.webContents.send('download-complete', { 
          id: torrentData.id,
          title: torrentData.title,
          path: fullPath 
      });
    });
    
    torrent.on('error', (err) => {
        mainWindow.webContents.send('download-error', { 
            id: torrentData.id, 
            message: "Error: " + err.message 
        });
    });
  });
}
// --- HANDLER 5: PAUSE ---
ipcMain.on('pause-download', (event, magnet) => {
    if (!magnet) return console.error("❌ Pause failed: No magnet link provided.");
    
    const torrent = client.get(magnet);
    if (torrent) {
        console.log("⏸️ Pausing torrent...");
        torrent.destroy(); // Stops connection, keeps files
    } else {
        console.log("⚠️ Torrent not found to pause.");
    }
});

// --- HANDLER 6: CANCEL ---
ipcMain.on('cancel-download', (event, magnet) => {
    if (!magnet) return console.error("❌ Cancel failed: No magnet link provided.");

    const torrent = client.get(magnet);
    if (torrent) {
        console.log("❌ Canceling torrent...");
        // destroyStore: true -> Deletes the file from disk
        client.remove(magnet, { destroyStore: true }, (err) => {
            if (!err) console.log("🗑️ File deleted.");
        });
    }
});

ipcMain.on('show-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});