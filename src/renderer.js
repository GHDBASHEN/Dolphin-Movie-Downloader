// Store search results to access data later
let currentResults = [];

async function search() {
    const query = document.getElementById('searchInput').value;
    const btn = document.querySelector('button');
    const table = document.getElementById('resultsBody');
    
    if(!query) return;

    btn.innerText = "Searching...";
    table.innerHTML = "";

    const results = await window.api.searchMovies(query);
    currentResults = results; // Save for later

    btn.innerText = "Search";

    if (results.length === 0) {
        table.innerHTML = "<tr><td colspan='4'>No results found.</td></tr>";
        return;
    }

    results.forEach((t, index) => {
        // We attach the ID to the row so we can update it later
        const row = `
            <tr id="row-${index}">
                <td>${t.title}</td>
                <td>${t.size}</td>
                <td>🟢 ${t.seeds}</td>
                <td id="action-${index}">
                    <button class="download-btn" onclick="download(${index})">⬇ Download</button>
                </td>
            </tr>
        `;
        table.innerHTML += row;
    });
}

function download(index) {
    const torrent = currentResults[index];
    // Add an ID property to track this download
    torrent.id = index; 

    const actionCell = document.getElementById(`action-${index}`);
    actionCell.innerHTML = `<span class="progress-bar">Starting...</span>`;

    window.api.startDownload(torrent);
}

// Listen for progress from Backend
window.api.onProgress((data) => {
    const actionCell = document.getElementById(`action-${data.id}`);
    if (actionCell) {
        actionCell.innerHTML = `
            <span class="progress-bar">
                ${data.progress}% <br> 
                <small>${data.speed} MB/s</small>
            </span>`;
    }
});

window.api.onComplete((data) => {
    alert(`✅ Download Complete: ${data.title}`);
});