let activeDownloads = new Map();
let currentSearchTimestamp = 0;
// DATA STORAGE
let allSearchResults = []; // Raw list from backend (100 items)
let filteredResults = [];  // List after filters applied (e.g. 20 items)
let currentPage = 0;
const RESULTS_PER_PAGE = 20;

// --- INITIALIZATION ---
window.onload = async () => {
    const config = await window.api.getConfig();
    document.getElementById('pathDisplay').value = config.downloadPath;
};

function handleEnter(e) {
    if (e.key === 'Enter') search();
}

// Helper: Convert bytes to readable size (MB, GB)
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

function toggleSidebar() {
    document.getElementById('downloadSidebar').classList.toggle('open');
}

async function changeFolder() {
    const newPath = await window.api.selectFolder();
    if (newPath) document.getElementById('pathDisplay').value = newPath;
}

async function search() {
    const query = document.getElementById('searchInput').value;
    const searchBtn = document.getElementById('searchBtn');
    const cancelBtn = document.getElementById('cancelSearchBtn');
    const table = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');
    
    if(!query) return;

    // 1. GENERATE ID for this specific search
    const mySearchId = Date.now();
    currentSearchTimestamp = mySearchId;

    // 2. UPDATE UI: Show Cancel, Hide Search
    searchBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block'; // Show Cancel
    
    table.innerHTML = ""; 
    document.getElementById('resultCount').innerText = "Searching...";
    loadMoreDiv.style.display = "none";
    
    // Reset Data
    currentPage = 0;
    allSearchResults = [];
    filteredResults = [];

    try {
        // 3. CALL BACKEND (This takes time)
        const results = await window.api.searchMovies(query);
        
        // 4. CHECK: Is this still the active search?
        // If user clicked "Cancel" or started a NEW search, this ID won't match.
        if (currentSearchTimestamp !== mySearchId) {
            console.log("Old search result ignored.");
            return; 
        }

        allSearchResults = results;

        if (results.length === 0) {
            table.innerHTML = "<tr><td colspan='4'>No results found (Check VPN).</td></tr>";
            document.getElementById('resultCount').innerText = "0 results";
        } else {
            // Apply filters and render
            applyFilters();
        }

    } catch (err) {
        if (currentSearchTimestamp === mySearchId) {
            table.innerHTML = "<tr><td colspan='4'>Error occurred during search.</td></tr>";
        }
    } finally {
        // 5. RESET UI (Only if this is still the active search)
        if (currentSearchTimestamp === mySearchId) {
            searchBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'none';
        }
    }
}

function cancelSearch() {
    // 1. Invalidate the current search
    currentSearchTimestamp = 0;

    // 2. Reset UI immediately
    document.getElementById('searchBtn').style.display = 'inline-block';
    document.getElementById('cancelSearchBtn').style.display = 'none';
    
    // 3. Show message
    const table = document.getElementById('resultsBody');
    table.innerHTML = "<tr><td colspan='4' style='color:#ffc107'>⚠️ Search Cancelled by user.</td></tr>";
    document.getElementById('resultCount').innerText = "";
}

function applyFilters() {
    // 1. Get Filter Values
    const quality = document.getElementById('qualityFilter').value;
    const sort = document.getElementById('sortFilter').value;

    // 2. Filter by Quality
    let temp = allSearchResults.filter(t => {
        if (quality === 'all') return true;
        // Check if title contains "1080p", "720p", etc.
        return t.title.toLowerCase().includes(quality);
    });

    // 3. Sort Logic
    temp.sort((a, b) => {
        if (sort === 'seeds_desc') return b.seeds - a.seeds;
        if (sort === 'seeds_asc') return a.seeds - b.seeds;
        
        // Helper to parse size string "1.2 GB" -> number
        const parseSize = (str) => {
            const num = parseFloat(str);
            if (str.includes('GB')) return num * 1024;
            return num; // MB
        };

        if (sort === 'size_desc') return parseSize(b.size) - parseSize(a.size);
        if (sort === 'size_asc') return parseSize(a.size) - parseSize(b.size);
    });

    // 4. Update State & Reset Page
    filteredResults = temp;
    currentPage = 0;
    
    // Update Stats text
    document.getElementById('resultCount').innerText = `${filteredResults.length} results`;

    // 5. Render
    document.getElementById('resultsBody').innerHTML = ""; // Clear table
    renderPage();
}

function loadMore() {
    currentPage++;
    renderPage();
}

function renderPage() {
    const table = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');

    const start = currentPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    
    // IMPORTANT: Use 'filteredResults' here, NOT 'allSearchResults'
    const itemsToShow = filteredResults.slice(start, end);

    itemsToShow.forEach((t, i) => {
        // We use the actual ID from the object because array index changes after sorting
        if (!t.id) t.id = `search-${Math.random().toString(36).substr(2, 9)}`;

        const row = `
            <tr>
                <td>${t.title}</td>
                <td>${t.size}</td>
                <td>🟢 ${t.seeds}</td>
                <td>
                    <button class="download-btn" onclick="startDownload('${t.id}')">
                        <i class="fas fa-download"></i> Download
                    </button>
                </td>
            </tr>
        `;
        table.innerHTML += row;
    });

    if (end < filteredResults.length) {
        loadMoreDiv.style.display = "block";
    } else {
        loadMoreDiv.style.display = "none";
    }
}
// --- DOWNLOAD MANAGER LOGIC ---

function startDownload(id) {
    // Find item in the filtered list using the ID
    const torrent = filteredResults.find(t => t.id === id);
    if (!torrent) return;
    
    addToSidebar(torrent);
    document.getElementById('downloadSidebar').classList.add('open');
    window.api.startDownload(torrent);
}

function addToSidebar(torrent) {
    const list = document.getElementById('downloadList');
    if(list.querySelector('.empty-state')) list.innerHTML = '';

    const cardId = `card-${torrent.id}`;
    if(document.getElementById(cardId)) return;

    const cardHTML = `
        <div id="${cardId}" class="download-card">
            <div class="card-title" title="${torrent.title}">${torrent.title}</div>
            
            <div class="progress-info">
                <span id="speed-${torrent.id}">0 MB/s</span>
                <span id="size-${torrent.id}" style="color:#888; font-size:11px;">Waiting...</span>
                <span id="percent-${torrent.id}">0%</span>
            </div>
            
            <div class="progress-bar-bg">
                <div id="bar-${torrent.id}" class="progress-bar-fill"></div>
            </div>

            <div class="card-actions">
                <button class="action-icon-btn" onclick="pause('${torrent.id}')" id="btn-pause-${torrent.id}" title="Pause">
                    <i class="fas fa-pause"></i>
                </button>
                <button class="action-icon-btn btn-cancel" onclick="cancel('${torrent.id}')" title="Cancel">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;

    list.innerHTML = cardHTML + list.innerHTML;
    activeDownloads.set(torrent.id, torrent);
    updateBadge();
}

// --- ACTIONS (Pause/Resume/Cancel) ---

function pause(id) {
    const torrent = activeDownloads.get(id);
    if(!torrent || !torrent.magnet) {
        alert("⚠️ Still connecting... please wait 2 seconds.");
        return;
    }

    window.api.pauseDownload(torrent.magnet);

    // Update UI
    const btn = document.getElementById(`btn-pause-${id}`);
    btn.innerHTML = '<i class="fas fa-play"></i>';
    btn.setAttribute('onclick', `resume('${id}')`);
    btn.title = "Resume";
    
    document.getElementById(`speed-${id}`).innerText = "Paused";
}

function resume(id) {
    const torrent = activeDownloads.get(id);
    // Reuse the magnet we saved earlier
    if(!torrent || !torrent.magnet) return; 

    window.api.resumeDownload(torrent);

    const btn = document.getElementById(`btn-pause-${id}`);
    btn.innerHTML = '<i class="fas fa-pause"></i>';
    btn.setAttribute('onclick', `pause('${id}')`);
    btn.title = "Pause";
    document.getElementById(`speed-${id}`).innerText = "Resuming...";
}

function cancel(id) {
    const torrent = activeDownloads.get(id);
    if(!torrent) return;

    if(torrent.magnet) {
        window.api.cancelDownload(torrent.magnet);
    } else {
        console.log("Canceling before magnet fetch...");
    }

    // Remove from UI
    const card = document.getElementById(`card-${id}`);
    if(card) card.remove();
    activeDownloads.delete(id);
    updateBadge();

    if(activeDownloads.size === 0) {
        document.getElementById('downloadList').innerHTML = '<div class="empty-state">No active downloads</div>';
    }
}

function updateBadge() {
    const count = activeDownloads.size;
    const badge = document.getElementById('activeCount');
    badge.innerText = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}

// --- LISTENERS ---

window.api.onProgress((data) => {
    const torrent = activeDownloads.get(data.id);
    
    if (torrent) {
        if(!torrent.magnet) torrent.magnet = data.magnet;

        const bar = document.getElementById(`bar-${data.id}`);
        const percentText = document.getElementById(`percent-${data.id}`);
        const speedText = document.getElementById(`speed-${data.id}`);
        const sizeText = document.getElementById(`size-${data.id}`); // Get the new element

        if(bar) bar.style.width = `${data.progress}%`;
        if(percentText) percentText.innerText = `${data.progress}%`;
        if(speedText) speedText.innerText = `${data.speed} MB/s`;

        // NEW: Update Size Text (e.g. "450 MB / 1.2 GB")
        if (sizeText && data.total) {
            const downStr = formatBytes(data.downloaded);
            const totalStr = formatBytes(data.total);
            sizeText.innerText = `${downStr} / ${totalStr}`;
        }
    }
});

window.api.onComplete((data) => {
    // data = { id, title, path }
    
    // 1. Store the path in our activeDownloads map
    const torrent = activeDownloads.get(data.id);
    if (torrent) {
        torrent.filePath = data.path;
    }

    const card = document.getElementById(`card-${data.id}`);
    if (!card) return;

    // 2. Update Progress Bar to Green "100%"
    const bar = document.getElementById(`bar-${data.id}`);
    const percentText = document.getElementById(`percent-${data.id}`);
    const speedText = document.getElementById(`speed-${data.id}`);

    if (bar) {
        bar.style.width = '100%';
        bar.style.backgroundColor = '#4caf50'; // Green
    }
    if (percentText) percentText.innerText = "100%";
    if (speedText) {
        speedText.innerHTML = '<span style="color:#4caf50; font-weight:bold;">✅ Download Completed</span>';
    }

    // 3. SWAP BUTTONS: Remove Pause/Cancel -> Add Locate
    const actionDiv = card.querySelector('.card-actions');
    actionDiv.innerHTML = `
        <button class="action-icon-btn" onclick="locateFile('${data.id}')" title="Open File Location" style="background:#4caf50; width:100%; border-radius:4px;">
            <i class="fas fa-folder-open"></i>&nbsp; Locate File
        </button>
    `;

    // Notification
    new Notification('Download Finished', { body: data.title });
});

// --- NEW FUNCTION: LOCATE FILE ---
function locateFile(id) {
    const torrent = activeDownloads.get(id);
    if (torrent && torrent.filePath) {
        window.api.showItemInFolder(torrent.filePath);
    } else {
        alert("File path not found. It might have been moved.");
    }
}

// --- NEW LISTENER: CAPTURE MAGNET IMMEDIATELY ---
window.api.onStarted((data) => {
    // data = { id, magnet }
    const torrent = activeDownloads.get(data.id);
    if (torrent) {
        console.log(`🔗 Magnet received for ${data.id}`);
        torrent.magnet = data.magnet; // Save it!
        updateCardButtons(data.id, data.magnet);
    }
});

// Helper to refresh buttons with the correct magnet
function updateCardButtons(id, magnet) {
    const pauseBtn = document.getElementById(`btn-pause-${id}`);
    if (pauseBtn) {
        pauseBtn.setAttribute('onclick', `pause('${id}')`);
    }
}

// --- NEW: ERROR HANDLING ---
window.api.onError((data) => {
    // data = { id, message }
    const card = document.getElementById(`card-${data.id}`);
    
    if (card) {
        // Change progress text to red error message
        const progressText = document.getElementById(`speed-${data.id}`);
        if(progressText) {
            progressText.innerHTML = `<span style="color:#ff4444">⚠️ ${data.message}</span>`;
        }
    }
});

// --- NEW: CLICK OUTSIDE TO CLOSE SIDEBAR ---
document.addEventListener('click', (event) => {
    const sidebar = document.getElementById('downloadSidebar');
    const toggleBtn = document.querySelector('.toggle-downloads-btn');
    
    // Check if we clicked on a "Download" button in the table (to prevent immediate closing)
    const isDownloadBtn = event.target.closest('.download-btn');

    // Logic:
    // 1. Sidebar must be OPEN
    // 2. Click must NOT be inside the Sidebar
    // 3. Click must NOT be on the "Downloads" toggle button at the top
    // 4. Click must NOT be on a "Download" button in the table
    if (sidebar.classList.contains('open') && 
        !sidebar.contains(event.target) && 
        !toggleBtn.contains(event.target) &&
        !isDownloadBtn) {
        
        // Close it
        sidebar.classList.remove('open');
    }
});