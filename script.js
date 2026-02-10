// --- STATE MANAGEMENT ---
let project = {
    pairs: [], // Array of { id, name, leftData, rightData, leftHandle, rightHandle }
    activePairId: null
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnAddPair').addEventListener('click', createNewPair);
    document.getElementById('btnSaveLeft').addEventListener('click', () => saveActiveFile('left'));
    document.getElementById('btnSaveRight').addEventListener('click', () => saveActiveFile('right'));
});

// --- PAIR MANAGEMENT (Sidebar) ---

function createNewPair() {
    const id = Date.now().toString(); // Simple ID
    const newPair = {
        id: id,
        name: `Chapter ${project.pairs.length + 1}`,
        leftData: [],
        rightData: [],
        leftHandle: null,
        rightHandle: null
    };

    project.pairs.push(newPair);
    renderSidebar();
    setActivePair(id); // Automatically switch to the new pair
}

function renderSidebar() {
    const list = document.getElementById('pairList');
    list.innerHTML = '';

    project.pairs.forEach(pair => {
        const card = document.createElement('div');
        card.className = `pair-card ${pair.id === project.activePairId ? 'active' : ''}`;
        
        // Card HTML Structure
        card.innerHTML = `
            <div class="pair-header">
                <input type="text" class="pair-title" value="${pair.name}" onchange="updatePairName('${pair.id}', this.value)">
                <button class="ctrl-btn btn-del" onclick="deletePair('${pair.id}')" title="Delete Chapter">×</button>
            </div>
            <div class="drop-zones">
                <div class="drop-zone ${pair.leftHandle ? 'loaded' : ''}" id="drop-left-${pair.id}">
                    ${pair.leftHandle ? pair.leftHandle.name : 'Drop Chinese'}
                </div>
                <div class="drop-zone ${pair.rightHandle ? 'loaded' : ''}" id="drop-right-${pair.id}">
                    ${pair.rightHandle ? pair.rightHandle.name : 'Drop English'}
                </div>
            </div>
        `;

        // Click on card to activate (unless clicking an input or button)
        card.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                setActivePair(pair.id);
            }
        });

        // Add Drag and Drop Logic to Zones
        setTimeout(() => {
            attachDropHandler(`drop-left-${pair.id}`, pair.id, 'left');
            attachDropHandler(`drop-right-${pair.id}`, pair.id, 'right');
        }, 0);

        list.appendChild(card);
    });
}

function attachDropHandler(elementId, pairId, side) {
    const zone = document.getElementById(elementId);
    
    zone.ondragover = (e) => { e.preventDefault(); zone.style.background = '#e2e8f0'; };
    zone.ondragleave = (e) => { e.preventDefault(); zone.style.background = ''; };
    
    zone.ondrop = async (e) => {
        e.preventDefault();
        zone.style.background = '';
        
        if (e.dataTransfer.items) {
            const item = e.dataTransfer.items[0];
            if (item.kind === 'file') {
                const handle = await item.getAsFileSystemHandle();
                const file = await handle.getFile();
                const text = (await file.text()).trimEnd();
                
                // Update Project State
                const pair = project.pairs.find(p => p.id === pairId);
                if (pair) {
                    if(side === 'left') {
                        pair.leftHandle = handle;
                        pair.leftName = file.name; 
                        pair.leftData = text.split(/\r?\n/);
                    } else {
                        pair.rightHandle = handle;
                        pair.rightName = file.name; 
                        pair.rightData = text.split(/\r?\n/);
                    }
                    
                    // If we just dropped into the active view, re-render immediately
                    if(project.activePairId === pairId) {
                        renderEditor();
                        updateToolbar();
                    }
                    renderSidebar(); // Update the green "Loaded" status
                }
            }
        }
    };
}

function updatePairName(id, newName) {
    const pair = project.pairs.find(p => p.id === id);
    if(pair) pair.name = newName;
}

window.deletePair = function(id) {
    if(!confirm("Delete this chapter?")) return;
    project.pairs = project.pairs.filter(p => p.id !== id);
    if(project.activePairId === id) {
        project.activePairId = null;
        renderEditor(); // Clears editor
    }
    renderSidebar();
};

// --- EDITOR LOGIC ---

function setActivePair(id) {
    // 1. Save current editor state to the OLD active pair before switching
    if (project.activePairId) {
        syncEditorToState(project.activePairId);
    }

    // 2. Set new ID
    project.activePairId = id;
    
    // 3. Render
    renderSidebar(); // Updates border highlight
    renderEditor();
    updateToolbar();
}

function syncEditorToState(id) {
    const pair = project.pairs.find(p => p.id === id);
    if (!pair) return;

    // Scrape the DOM to get current text (handling edits)
    const cells = document.querySelectorAll('.cell');
    let newLeft = [];
    let newRight = [];
    
    cells.forEach(cell => {
        if (cell.dataset.side === 'left') newLeft.push(cell.innerText);
        else if (cell.dataset.side === 'right') newRight.push(cell.innerText);
    });
    
    // Only update if we actually found cells (prevent wiping data on empty render)
    if(cells.length > 0) {
        pair.leftData = newLeft;
        pair.rightData = newRight;
    }
}

function renderEditor() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:3rem; text-align:center; color:#94a3b8">Select a chapter to edit</div>';
        return;
    }

    // Render Grid using the Pair's data
    const max = Math.max(pair.leftData.length, pair.rightData.length);
    
    for (let i = 0; i < max; i++) {
        // Left
        const cellL = createCell(pair.leftData[i], i, 'left');
        
        // Controls
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'left', ${i})" title="Push Left Down">▼</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'left', ${i})" title="Delete Left">×</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'right', ${i})" title="Push Right Down">▼</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'right', ${i})" title="Delete Right">×</button>
            </div>
        `;

        // Right
        const cellR = createCell(pair.rightData[i], i, 'right');
        grid.append(cellL, controls, cellR);
    }
}

function createCell(text, idx, side) {
    const div = document.createElement('div');
    div.className = 'cell';
    if (text === undefined || text === "") div.classList.add('empty-row');
    div.contentEditable = true;
    div.innerText = text || "";
    div.dataset.side = side; // Used for scraping later
    
    // Save shortcut
    div.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveActiveFile(side);
        }
    });
    
    return div;
}

function updateToolbar() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    const title = document.getElementById('activeChapterTitle');
    const btnL = document.getElementById('btnSaveLeft');
    const btnR = document.getElementById('btnSaveRight');
    
    if(pair) {
        title.innerText = pair.name;
        // btnL.disabled = !pair.leftHandle;
        // btnR.disabled = !pair.rightHandle;
        // btnL.innerText = pair.leftHandle ? `💾 Save ${pair.leftHandle.name}` : "💾 Save Left";
        // btnR.innerText = pair.rightHandle ? `💾 Save ${pair.rightHandle.name}` : "💾 Save Right";
        btnL.disabled = false; 
        btnR.disabled = false;
        btnL.innerText = pair.leftHandle ? `💾 Save ${pair.leftHandle.name}` : "💾 Save As...";
        btnR.innerText = pair.rightHandle ? `💾 Save ${pair.rightHandle.name}` : "💾 Save As...";
    } else {
        title.innerText = "No Chapter Selected";
        btnL.disabled = true;
        btnR.disabled = true;
    }
}

// --- GRID OPERATIONS ---

window.modifyGrid = function(action, side, idx) {
    // 1. Sync DOM to Memory first (crucial!)
    syncEditorToState(project.activePairId);
    
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    // 2. Perform Operation on Memory
    const targetArray = side === 'left' ? pair.leftData : pair.rightData;
    
    if (action === 'insert') {
        targetArray.splice(idx, 0, "");
    } else if (action === 'delete') {
        if(targetArray[idx] && targetArray[idx].trim() !== "" && !confirm("Delete text?")) return;
        targetArray.splice(idx, 1);
    }

    // 3. Re-render from Memory
    renderEditor();
};

async function saveActiveFile(side) {
    syncEditorToState(project.activePairId); // Ensure latest edits are captured
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if(!pair) return;

    const handle = side === 'left' ? pair.leftHandle : pair.rightHandle;
    const data = side === 'left' ? pair.leftData : pair.rightData;

    if (!handle) {
        try {
            // Prompt user to pick a save location
            handle = await window.showSaveFilePicker({
                suggestedName: side === 'left' ? 'chapter_cn.txt' : 'chapter_en.txt'
            });
            // Save this new handle back to the pair so we don't ask again
            if (side === 'left') pair.leftHandle = handle;
            else pair.rightHandle = handle;
            
            renderSidebar(); // Update sidebar to show green "Loaded" status
            updateToolbar(); // Update button text
        } catch (err) {
            return; // User cancelled
        }
    }

    try {
        const writable = await handle.createWritable();
        await writable.write(data.join('\n'));
        await writable.close();
        alert("Saved!");
    } catch(e) {
        alert("Save failed: " + e);
    }
}

// --- PROJECT MANAGEMENT ---

function saveProject() {
    // 1. Create a clean copy of the project data (handles cannot be saved to JSON)
    const projectData = {
        pairs: project.pairs.map(p => ({
            id: p.id,
            name: p.name,
            leftName: p.leftName || null,
            rightName: p.rightName || null,
            leftData: p.leftData,
            rightData: p.rightData
            // Note: leftHandle and rightHandle are stripped automatically by JSON.stringify
        }))
    };

    // 2. Download as JSON file
    const blob = new Blob([JSON.stringify(projectData, null, 2)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "translation_project.json";
    a.click();
}

function loadProject(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            // 1. Load data
            project.pairs = data.pairs.map(p => ({
                ...p,
                leftHandle: null, // Handles are lost on reload
                rightHandle: null
            }));
            
            // 2. Reset UI
            project.activePairId = null;
            if (project.pairs.length > 0) {
                setActivePair(project.pairs[0].id);
            } else {
                renderSidebar();
                renderEditor();
            }
            input.value = ''; // Reset input so we can load same file again if needed
            alert("Project loaded! Note: You will need to re-link files to save to disk.");
        } catch (err) {
            alert("Invalid Project File");
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function closeProject() {
    if(confirm("Close current project? Unsaved changes will be lost.")) {
        project.pairs = [];
        project.activePairId = null;
        renderSidebar();
        renderEditor();
        updateToolbar();
    }
}

async function relinkFolder() {
    try {
        // 1. Ask user for the folder containing their files
        const dirHandle = await window.showDirectoryPicker();
        let matchesFound = 0;

        // 2. Loop through every file in that folder
        for await (const entry of dirHandle.values()) {
            if (entry.kind !== 'file') continue;

            // 3. Check if this file is needed by ANY of our pairs
            // We loop through all pairs to see if they are waiting for this filename
            project.pairs.forEach(pair => {
                // Check Left
                if (pair.leftName === entry.name) {
                    pair.leftHandle = entry; // RE-LINKED!
                    matchesFound++;
                }
                // Check Right
                if (pair.rightName === entry.name) {
                    pair.rightHandle = entry; // RE-LINKED!
                    matchesFound++;
                }
            });
        }

        // 4. Update UI
        renderSidebar(); // Will turn green if linked
        updateToolbar(); // Will enable save buttons
        alert(`Relinked ${matchesFound} files successfully!`);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            alert("Error accessing folder.");
        }
    }
}