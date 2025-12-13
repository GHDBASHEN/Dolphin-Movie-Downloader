let activeDownloads = new Map();
let currentSearchTimestamp = 0;

// DATA STORAGE
let allSearchResults = []; 
let filteredResults = [];  
let currentPage = 0;
const RESULTS_PER_PAGE = 20;

// --- INITIALIZATION ---
window.onload = async () => {
    const config = await window.api.getConfig();
    if(document.getElementById('pathDisplay')) {
        document.getElementById('pathDisplay').value = config.downloadPath;
    }
};

function handleEnter(e) {
    if (e.key === 'Enter') search();
}

// Helper: Convert bytes to readable size
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

// ---------------------------------------------------------
// SEARCH LOGIC
// ---------------------------------------------------------
async function search() {
    const query = document.getElementById('searchInput').value;
    const searchBtn = document.getElementById('searchBtn');
    const cancelBtn = document.getElementById('cancelSearchBtn');
    
    // Get the UI elements
    const tableContainer = document.querySelector('.results-container'); // The wrapper
    const emptyState = document.getElementById('emptyState');
    const tbody = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');
    
    if(!query) return;

    const mySearchId = Date.now();
    currentSearchTimestamp = mySearchId;

    // UI UPDATES:
    searchBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    
    // 1. Hide Empty State immediately
    emptyState.style.display = 'none'; 
    
    // 2. Clear table and Hide it while loading
    tbody.innerHTML = ""; 
    tableContainer.style.display = 'none'; 
    
    document.getElementById('resultCount').innerText = "Searching...";
    loadMoreDiv.style.display = "none";
    
    currentPage = 0;
    allSearchResults = [];
    filteredResults = [];

    try {
        const results = await window.api.searchMovies(query);
        
        if (currentSearchTimestamp !== mySearchId) return;

        allSearchResults = results;

        if (results.length === 0) {
            document.getElementById('resultCount').innerText = "0 results found.";
            // If no results, show Empty State again (or a specific 'No Results' view)
            emptyState.style.display = 'block';
            emptyState.innerHTML = '<i class="fas fa-search-minus" style="font-size: 48px; margin-bottom: 10px;"></i><p>No results found</p>';
        } else {
            applyFilters();
        }

    } catch (err) {
        if (currentSearchTimestamp === mySearchId) {
            document.getElementById('resultCount').innerText = "Error occurred.";
            emptyState.style.display = 'block'; // Show state on error
        }
    } finally {
        if (currentSearchTimestamp === mySearchId) {
            searchBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'none';
        }
    }
}

function cancelSearch() {
    currentSearchTimestamp = 0;
    document.getElementById('searchBtn').style.display = 'inline-block';
    document.getElementById('cancelSearchBtn').style.display = 'none';
    document.getElementById('resultCount').innerText = "";

    // SWITCH LOGIC: Hide Table, Show Empty State
    document.querySelector('.results-container').style.display = 'none';
    
    const emptyState = document.getElementById('emptyState');
    emptyState.style.display = 'block';
    // Reset text back to original
    emptyState.innerHTML = '<i class="fas fa-film" style="font-size: 48px; margin-bottom: 10px;"></i><p>Ready to search</p>';
}


function applyFilters() {
    // 1. Get Filter Values
    const quality = document.getElementById('qualityFilter').value;
    const sort = document.getElementById('sortFilter').value;

    // 2. Filter by Quality
    let temp = allSearchResults.filter(t => {
        if (quality === 'all') return true;
        return t.title.toLowerCase().includes(quality);
    });

    // 3. Sort Logic
    temp.sort((a, b) => {
        if (sort === 'seeds_desc') return b.seeds - a.seeds;
        if (sort === 'seeds_asc') return a.seeds - b.seeds;
        
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
    document.getElementById('resultsBody').innerHTML = ""; // Clear rows
    renderPage();
}

function loadMore() {
    currentPage++;
    renderPage();
}

function renderPage() {
    const tableContainer = document.querySelector('.results-container');
    const tbody = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');
    const emptyState = document.getElementById('emptyState');

    // SWITCH LOGIC:
    if (filteredResults.length > 0) {
        // ✅ CORRECT FIX: Use 'flex' so the scrollbar works!
        tableContainer.style.display = "flex"; 
        emptyState.style.display = "none";
    } else {
        tableContainer.style.display = "none";
        emptyState.style.display = "block";
        return;
    }

    const start = currentPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    const itemsToShow = filteredResults.slice(start, end);

    itemsToShow.forEach((t) => {
        if (!t.id) t.id = `search-${Math.random().toString(36).substr(2, 9)}`;

        // Use the formatBytes helper if available, else raw size
        let displaySize = (typeof formatBytes === 'function' && !isNaN(t.size)) 
                          ? formatBytes(t.size) 
                          : t.size;

        const row = `
            <tr>
                <td>${t.title}</td>
                <td>${displaySize}</td>
                <td style="color: #4caf50;">${t.seeds}</td>
                <td>
                    <button class="download-btn" onclick="startDownload('${t.id}')">
                        <i class="fas fa-download"></i> Download
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });

    loadMoreDiv.style.display = (end < filteredResults.length) ? "block" : "none";
}

// ---------------------------------------------------------
// DOWNLOAD MANAGER LOGIC
// ---------------------------------------------------------

function startDownload(id) {
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

    const btn = document.getElementById(`btn-pause-${id}`);
    btn.innerHTML = '<i class="fas fa-play"></i>';
    btn.setAttribute('onclick', `resume('${id}')`);
    btn.title = "Resume";
    
    document.getElementById(`speed-${id}`).innerText = "Paused";
}

function resume(id) {
    const torrent = activeDownloads.get(id);
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
    if(badge) {
        badge.innerText = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

// --- LISTENERS ---

window.api.onProgress((data) => {
    const torrent = activeDownloads.get(data.id);
    
    if (torrent) {
        if(!torrent.magnet) torrent.magnet = data.magnet;

        const bar = document.getElementById(`bar-${data.id}`);
        const percentText = document.getElementById(`percent-${data.id}`);
        const speedText = document.getElementById(`speed-${data.id}`);
        const sizeText = document.getElementById(`size-${data.id}`); 

        if(bar) bar.style.width = `${data.progress}%`;
        if(percentText) percentText.innerText = `${data.progress}%`;
        if(speedText) speedText.innerText = `${data.speed} MB/s`;

        if (sizeText && data.total) {
            const downStr = formatBytes(data.downloaded);
            const totalStr = formatBytes(data.total);
            sizeText.innerText = `${downStr} / ${totalStr}`;
        }
    }
});

window.api.onComplete((data) => {
    const torrent = activeDownloads.get(data.id);
    if (torrent) {
        torrent.filePath = data.path;
    }

    const card = document.getElementById(`card-${data.id}`);
    if (!card) return;

    // Green "100%"
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

    // Swap Buttons for "Locate"
    const actionDiv = card.querySelector('.card-actions');
    actionDiv.innerHTML = `
        <button class="action-icon-btn" onclick="locateFile('${data.id}')" title="Open File Location" style="background:#4caf50; width:100%; border-radius:4px;">
            <i class="fas fa-folder-open"></i>&nbsp; Locate File
        </button>
    `;

    new Notification('Download Finished', { body: data.title });
});

function locateFile(id) {
    const torrent = activeDownloads.get(id);
    if (torrent && torrent.filePath) {
        window.api.showItemInFolder(torrent.filePath);
    } else {
        alert("File path not found. It might have been moved.");
    }
}

window.api.onStarted((data) => {
    const torrent = activeDownloads.get(data.id);
    if (torrent) {
        torrent.magnet = data.magnet;
        updateCardButtons(data.id, data.magnet);
    }
});

function updateCardButtons(id, magnet) {
    const pauseBtn = document.getElementById(`btn-pause-${id}`);
    if (pauseBtn) {
        pauseBtn.setAttribute('onclick', `pause('${id}')`);
    }
}

window.api.onError((data) => {
    const card = document.getElementById(`card-${data.id}`);
    if (card) {
        const progressText = document.getElementById(`speed-${data.id}`);
        if(progressText) {
            progressText.innerHTML = `<span style="color:#ff4444">⚠️ ${data.message}</span>`;
        }
    }
});

// CLICK OUTSIDE TO CLOSE SIDEBAR
document.addEventListener('click', (event) => {
    const sidebar = document.getElementById('downloadSidebar');
    const toggleBtn = document.querySelector('.toggle-downloads-btn');
    const isDownloadBtn = event.target.closest('.download-btn');

    if (sidebar.classList.contains('open') && 
        !sidebar.contains(event.target) && 
        !toggleBtn.contains(event.target) &&
        !isDownloadBtn) {
        
        sidebar.classList.remove('open');
    }
});

if (window.api.onRestore) {
    window.api.onRestore((savedList) => {
        console.log("Restoring session:", savedList);
        
        savedList.forEach(item => {
            // Add card to UI
            addToSidebar(item);
            
            // Track internally
            activeDownloads.set(item.id, item);
            
            // Update status text
            const speedText = document.getElementById(`speed-${item.id}`);
            if (speedText) speedText.innerText = "Resuming...";
        });

        // Open Sidebar
        if (savedList.length > 0) {
            document.getElementById('downloadSidebar').classList.add('open');
            updateBadge();
        }
    });
}