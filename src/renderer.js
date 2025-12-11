let currentResults = [];
let allSearchResults = []; // Stores the full list (e.g., 100 items)
let currentPage = 0;
const RESULTS_PER_PAGE = 20;

// --- INITIALIZATION ---
window.onload = async () => {
    const config = await window.api.getConfig();
    document.getElementById('pathDisplay').value = config.downloadPath;
};

function toggleSidebar() {
    document.getElementById('downloadSidebar').classList.toggle('open');
}

async function changeFolder() {
    const newPath = await window.api.selectFolder();
    if (newPath) document.getElementById('pathDisplay').value = newPath;
}

async function search() {
    const query = document.getElementById('searchInput').value;
    const btn = document.querySelector('.primary-btn');
    const table = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');
    
    if(!query) return;

    // Reset UI
    btn.innerText = "Searching...";
    table.innerHTML = ""; 
    loadMoreDiv.style.display = "none";
    
    // Reset Data
    currentPage = 0;
    allSearchResults = [];

    // Fetch from Backend
    const results = await window.api.searchMovies(query);
    allSearchResults = results;
    currentResults = results; // Keep for download referencing

    btn.innerText = "Search";

    if (results.length === 0) {
        table.innerHTML = "<tr><td colspan='4'>No results found (Check VPN).</td></tr>";
        return;
    }

    // Render FIRST Page
    renderPage();
}

function loadMore() {
    currentPage++;
    renderPage();
}

function renderPage() {
    const table = document.getElementById('resultsBody');
    const loadMoreDiv = document.getElementById('loadMoreContainer');

    // Calculate slice indices
    const start = currentPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    
    // Get next batch of items
    const itemsToShow = allSearchResults.slice(start, end);

    itemsToShow.forEach((t, i) => {
        // Calculate global index so download button grabs correct item
        const globalIndex = start + i;
        
        // Ensure the item has an ID (if not already set)
        if (!t.id) t.id = `search-${globalIndex}-${Date.now()}`;

        const row = `
            <tr>
                <td>${t.title}</td>
                <td>${t.size}</td>
                <td>🟢 ${t.seeds}</td>
                <td>
                    <button class="download-btn" onclick="startDownload(${globalIndex})">
                        <i class="fas fa-download"></i> Download
                    </button>
                </td>
            </tr>
        `;
        table.innerHTML += row;
    });

    // Show/Hide "Load More" Button
    if (end < allSearchResults.length) {
        loadMoreDiv.style.display = "block";
    } else {
        loadMoreDiv.style.display = "none";
    }
}
// --- DOWNLOAD MANAGER LOGIC ---

function startDownload(index) {
    const torrent = currentResults[index];
    
    // 1. Add to Sidebar UI
    addToSidebar(torrent);

    // 2. Open Sidebar so user sees it
    document.getElementById('downloadSidebar').classList.add('open');

    // 3. Tell Backend to Start
    window.api.startDownload(torrent);
}

function addToSidebar(torrent) {
    const list = document.getElementById('downloadList');
    
    // Remove empty state if exists
    if(list.querySelector('.empty-state')) list.innerHTML = '';

    // Create Card HTML
    const cardId = `card-${torrent.id}`;
    
    // Prevent duplicates in UI
    if(document.getElementById(cardId)) return;

    const cardHTML = `
        <div id="${cardId}" class="download-card">
            <div class="card-title" title="${torrent.title}">${torrent.title}</div>
            
            <div class="progress-info">
                <span id="speed-${torrent.id}">0 MB/s</span>
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

    list.innerHTML = cardHTML + list.innerHTML; // Add to top
    
    // Store in map
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
        // If no magnet yet (still fetching), we just remove from UI
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
    // data has: id, progress, speed, magnet
    const torrent = activeDownloads.get(data.id);
    
    if (torrent) {
        // Save magnet for pause/resume actions
        if(!torrent.magnet) torrent.magnet = data.magnet;

        // Update UI
        const bar = document.getElementById(`bar-${data.id}`);
        const percentText = document.getElementById(`percent-${data.id}`);
        const speedText = document.getElementById(`speed-${data.id}`);

        if(bar) bar.style.width = `${data.progress}%`;
        if(percentText) percentText.innerText = `${data.progress}%`;
        if(speedText) speedText.innerText = `${data.speed} MB/s`;
    }
});

window.api.onComplete((data) => {
    // Show notification
    new Notification('Download Complete', { body: data.title });
    
    // Update card style to show complete
    // You might want to remove the Pause button here
    // But for now, we just leave it.
});

// --- NEW LISTENER: CAPTURE MAGNET IMMEDIATELY ---
window.api.onStarted((data) => {
    // data = { id, magnet }
    const torrent = activeDownloads.get(data.id);
    if (torrent) {
        console.log(`🔗 Magnet received for ${data.id}`);
        torrent.magnet = data.magnet; // Save it!
        
        // Update the card to ensure buttons have the magnet
        // We re-render the buttons just to be safe
        updateCardButtons(data.id, data.magnet);
    }
});

// Helper to refresh buttons with the correct magnet
function updateCardButtons(id, magnet) {
    const pauseBtn = document.getElementById(`btn-pause-${id}`);
    const cancelBtn = document.querySelector(`#card-${id} .btn-cancel`);

    if (pauseBtn) {
        pauseBtn.setAttribute('onclick', `pause('${id}')`);
    }
}