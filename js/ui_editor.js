import { project } from './state.js';


export function toggleBackupUI(side, idx) {
    // Find the specific cell wrapper by its new ID
    const wrapper = document.getElementById(`cell-wrapper-${side}-${idx}`);
    if (wrapper) {
        // Find the backup container inside it
        const container = wrapper.querySelector('.backup-container');
        if (container) {
            // Toggle its visibility
            container.classList.toggle('open');
        }
    }
}
export function createCell(text, idx, side) {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    
    // 1. Create Wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'cell-wrapper';
    wrapper.id = `cell-wrapper-${side}-${idx}`;
    wrapper.style.position = 'relative'; 

    // 2. Create Editable Cell
    const div = document.createElement('div');
    div.className = 'cell';
    if (text === undefined || text === "") div.classList.add('empty-row');
    div.contentEditable = true;
    div.innerText = text || "";
    div.dataset.side = side;
    
    // Input Handler
    div.addEventListener('input', () => {
        if (side === 'left') { pair.leftData[idx] = div.innerText; pair.leftDirty = true; }
        else { pair.rightData[idx] = div.innerText; pair.rightDirty = true; }
        updateStats(); 
    });

    // Keyboard Shortcuts
    div.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            window.triggerSave(side);
        }
    });

    // 3. NEW: Add Counter Badge if backups exist
    // Ensure array exists safely
    if (side === 'left' && !pair.leftBackups) pair.leftBackups = [];
    if (side === 'right' && !pair.rightBackups) pair.rightBackups = [];

    const backupList = side === 'left' ? (pair.leftBackups[idx] || []) : (pair.rightBackups[idx] || []);

    if (backupList.length > 0) {
        const countBadge = document.createElement('div');
        countBadge.className = 'backup-count';
        countBadge.innerText = backupList.length;
        countBadge.title = `${backupList.length} backup option(s)`;
        
        // Optional: Clicking the number also toggles the list
        countBadge.onclick = (e) => {
            e.stopPropagation(); // Prevent focusing the text editor
            toggleBackupUI(side, idx);
        };
        
        wrapper.appendChild(countBadge);
    }

    // 4. Create Backup Container (Hidden by default)
    const container = document.createElement('div');
    container.className = 'backup-container';

    // Render Cards
    backupList.forEach((backupText, backupIdx) => {
        container.appendChild(createBackupCard(backupText, idx, side, backupIdx));
    });

    // Add "New" Button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-backup';
    addBtn.innerText = "+ Add Option";
    addBtn.onclick = () => {
        const targetArray = side === 'left' ? pair.leftBackups : pair.rightBackups;
        if (!targetArray[idx]) targetArray[idx] = []; 
        targetArray[idx].push(""); 
        renderEditor(); // Re-render to update the badge count!
        
        // Auto-open the container so user sees the new input
        setTimeout(() => {
            const newWrapper = document.getElementById(`cell-wrapper-${side}-${idx}`);
            if(newWrapper) {
                newWrapper.querySelector('.backup-container').classList.add('open');
            }
        }, 0);
    };
    container.appendChild(addBtn);

    // Assemble
    wrapper.appendChild(div);
    wrapper.appendChild(container);
    
    return wrapper;
}

// Helper to create the individual gray cards
function createBackupCard(text, rowIdx, side, backupIdx) {
    const card = document.createElement('div');
    card.className = 'backup-card';

    const input = document.createElement('input'); // or textarea
    input.className = 'backup-input';
    input.value = text;
    input.placeholder = "Alternative translation...";
    
    // Save on Type
    input.oninput = (e) => {
        const pair = project.pairs.find(p => p.id === project.activePairId);
        const targetArray = side === 'left' ? pair.leftBackups : pair.rightBackups;
        targetArray[rowIdx][backupIdx] = e.target.value;
    };

    const delBtn = document.createElement('span');
    delBtn.className = 'backup-btn-del';
    delBtn.innerText = '×';
    delBtn.title = "Remove backup";
    delBtn.onclick = () => {
        if(confirm("Delete this backup option?")) {
            const pair = project.pairs.find(p => p.id === project.activePairId);
            const targetArray = side === 'left' ? pair.leftBackups : pair.rightBackups;
            targetArray[rowIdx].splice(backupIdx, 1);
            renderEditor(); // Re-render to fix indices
        }
    };

    card.appendChild(input);
    card.appendChild(delBtn);
    return card;
}

export function renderEditor() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:3rem; text-align:center; color:#94a3b8">Select a chapter to edit</div>';
        return;
    }

    const max = Math.max(pair.leftData.length, pair.rightData.length);
    
    for (let i = 0; i < max; i++) {
        // Line Num
        const lineNum = document.createElement('div');
        lineNum.className = 'line-num';
        lineNum.innerText = i + 1;
        
        if (!pair.leftBackups[i]) pair.leftBackups[i] = [];
        if (!pair.rightBackups[i]) pair.rightBackups[i] = [];
        // Left Cell
        const cellL = createCell(pair.leftData[i], i, 'left');
        
        // Controls
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
            <div style="display:flex; flex-direction:row; gap:0px;">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'left', ${i})" title="Push Left Down">▼</button>
                <button class="ctrl-btn btn-backup" onclick="toggleBackupUI('left', ${i})" title="Backups">+</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'left', ${i})" title="Delete Left">×</button>
            </div>
            <div style="width:1px; background:#e2e8f0; height:12px; margin-top:2px;"></div> <div style="display:flex; flex-direction:row; gap:0px;">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'right', ${i})" title="Push Right Down">▼</button>
                <button class="ctrl-btn btn-backup" onclick="toggleBackupUI('right', ${i})" title="Backups">+</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'right', ${i})" title="Delete Right">×</button>
            </div>
        `;

        // Right Cell
        const cellR = createCell(pair.rightData[i], i, 'right');

        grid.append(lineNum, cellL, controls, cellR);
    }
}

export function updateToolbar() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    const title = document.getElementById('activeChapterTitle');
    const btnL = document.getElementById('btnSaveLeft');
    const btnR = document.getElementById('btnSaveRight');
    
    if(pair) {
        title.innerText = pair.name;
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

export function updateStats() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    const dotL = document.getElementById('dotLeft');
    const dotR = document.getElementById('dotRight');
    const statsL = document.getElementById('statsLeft');
    const statsR = document.getElementById('statsRight');

    if (!pair) {
        dotL.className = 'sync-dot';
        dotR.className = 'sync-dot';
        statsL.innerText = '';
        statsR.innerText = '';
        return;
    }

    // Helper to set class and title
    const setStatus = (el, handle, dirty, external) => {
        if (!handle) { el.className = 'sync-dot'; el.title = "No file linked"; }
        else if (external) { el.className = 'sync-dot orange'; el.title = "External Change! Click Refresh."; }
        else if (dirty) { el.className = 'sync-dot red'; el.title = "Unsaved Changes"; }
        else { el.className = 'sync-dot green'; el.title = "Synced"; }
    };

    setStatus(dotL, pair.leftHandle, pair.leftDirty, pair.leftExternalChange);
    setStatus(dotR, pair.rightHandle, pair.rightDirty, pair.rightExternalChange);

    const calc = (lines) => {
        const fullText = (lines || []).join(' ');
        return `${fullText.split(/\s+/).filter(w => w.length).length}w / ${fullText.length}c`;
    };

    statsL.innerText = calc(pair.leftData);
    statsR.innerText = calc(pair.rightData);
}

export function syncEditorToState(id) {
    const pair = project.pairs.find(p => p.id === id);
    if (!pair) return;

    const cells = document.querySelectorAll('.cell');
    if(cells.length === 0) return;

    let newLeft = [];
    let newRight = [];
    
    cells.forEach(cell => {
        if (cell.dataset.side === 'left') newLeft.push(cell.innerText);
        else if (cell.dataset.side === 'right') newRight.push(cell.innerText);
    });
    
    pair.leftData = newLeft;
    pair.rightData = newRight;
}

export function modifyGrid(action, side, idx) {
    // 1. Sync
    syncEditorToState(project.activePairId);
    
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    // 2. Modify
    const targetArray = side === 'left' ? pair.leftData : pair.rightData;
    if (action === 'insert') targetArray.splice(idx, 0, "");
    else if (action === 'delete') targetArray.splice(idx, 1);

    if (side === 'left') pair.leftDirty = true;
    else pair.rightDirty = true;

    // 3. Render
    renderEditor();
    updateStats();
}