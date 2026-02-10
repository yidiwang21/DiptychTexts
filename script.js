// --- STATE ---
let fileHandleLeft = null;
let fileHandleRight = null;
let dataLeft = [];
let dataRight = [];

// --- INITIALIZATION ---
// Connect buttons to functions once the page loads
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnOpenLeft').addEventListener('click', () => openFile('left'));
    document.getElementById('btnOpenRight').addEventListener('click', () => openFile('right'));
    document.getElementById('btnSaveLeft').addEventListener('click', () => saveFile('left'));
    document.getElementById('btnSaveRight').addEventListener('click', () => saveFile('right'));
});

// --- FILE OPERATIONS ---

async function openFile(side) {
    try {
        const [handle] = await window.showOpenFilePicker();
        const file = await handle.getFile();
        const text = await file.text();
        
        // Split by newlines
        const lines = text.split(/\r?\n/);

        if (side === 'left') {
            fileHandleLeft = handle;
            dataLeft = lines;
            updateSaveButton('left', file.name);
        } else {
            fileHandleRight = handle;
            dataRight = lines;
            updateSaveButton('right', file.name);
        }
        render();
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            alert("Error opening file. Note: This feature requires Chrome/Edge on Desktop.");
        }
    }
}

async function saveFile(side) {
    syncData(); // 1. Capture what is on screen RIGHT NOW
    
    const handle = side === 'left' ? fileHandleLeft : fileHandleRight;
    const lines = side === 'left' ? dataLeft : dataRight;

    if (!handle) return alert("No file loaded for " + side);

    try {
        const writable = await handle.createWritable();
        await writable.write(lines.join('\n')); 
        await writable.close();
        
        // Flash "Saved" message
        const btn = document.getElementById(side === 'left' ? 'btnSaveLeft' : 'btnSaveRight');
        const originalText = btn.innerText;
        btn.innerText = "✅ Saved!";
        setTimeout(() => btn.innerText = originalText, 1500);
    } catch (err) {
        alert("Failed to save: " + err);
    }
}

function updateSaveButton(side, filename) {
    const btn = document.getElementById(side === 'left' ? 'btnSaveLeft' : 'btnSaveRight');
    btn.disabled = false;
    btn.innerText = `💾 Save ${filename}`;
}

// --- RENDERING ---

function render() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    
    const max = Math.max(dataLeft.length, dataRight.length);
    
    for (let i = 0; i < max; i++) {
        // 1. Left Cell
        const cellL = createCell(dataLeft[i], i, 'left');
        
        // 2. Controls (Middle)
        const controls = document.createElement('div');
        controls.className = 'controls';
        
        // Note: We use "onclick" strings here for simplicity in generating dynamic HTML
        controls.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="insertGap('left', ${i})" title="Push Left Down">▼</button>
                <button class="ctrl-btn btn-del" onclick="deleteCell('left', ${i})" title="Delete Left">×</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="insertGap('right', ${i})" title="Push Right Down">▼</button>
                <button class="ctrl-btn btn-del" onclick="deleteCell('right', ${i})" title="Delete Right">×</button>
            </div>
        `;

        // 3. Right Cell
        const cellR = createCell(dataRight[i], i, 'right');

        grid.append(cellL, controls, cellR);
    }
}

function createCell(text, idx, side) {
    const div = document.createElement('div');
    div.className = 'cell';
    if (text === undefined || text === "") div.classList.add('empty-row');
    
    div.contentEditable = true;
    div.innerText = text || "";
    div.dataset.idx = idx;
    div.dataset.side = side;
    
    // Save shortcut (Ctrl+S)
    div.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile(side);
        }
    });
    
    return div;
}

// --- LOGIC ---

// Needed to expose these to the window so the HTML onclick="" works
window.insertGap = function(side, idx) {
    syncData();
    if (side === 'left') dataLeft.splice(idx, 0, "");
    else dataRight.splice(idx, 0, "");
    render();
};

window.deleteCell = function(side, idx) {
    syncData();
    
    // Optional: Warn if deleting text
    const text = side === 'left' ? dataLeft[idx] : dataRight[idx];
    if (text && text.trim() !== "" && !confirm("Delete this text cell?")) {
        return;
    }

    if (side === 'left') dataLeft.splice(idx, 1);
    else dataRight.splice(idx, 1);
    
    render();
};

function syncData() {
    const cells = document.querySelectorAll('.cell');
    let newLeft = [];
    let newRight = [];
    
    cells.forEach(cell => {
        // We push the text into the array corresponding to its side
        if (cell.dataset.side === 'left') newLeft.push(cell.innerText);
        else if (cell.dataset.side === 'right') newRight.push(cell.innerText);
    });
    
    dataLeft = newLeft;
    dataRight = newRight;
}