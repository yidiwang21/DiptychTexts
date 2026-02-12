import { project } from './state.js';

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
        
        // Left Cell
        const cellL = createCell(pair.leftData[i], i, 'left');
        
        // Controls
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'left', ${i})">▼</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'left', ${i})">×</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:2px">
                <button class="ctrl-btn" onclick="modifyGrid('insert', 'right', ${i})">▼</button>
                <button class="ctrl-btn btn-del" onclick="modifyGrid('delete', 'right', ${i})">×</button>
            </div>
        `;

        // Right Cell
        const cellR = createCell(pair.rightData[i], i, 'right');

        grid.append(lineNum, cellL, controls, cellR);
    }
}

function createCell(text, idx, side) {
    const div = document.createElement('div');
    div.className = 'cell';
    if (text === undefined || text === "") div.classList.add('empty-row');
    div.contentEditable = true;
    div.innerText = text || "";
    div.dataset.side = side;
    
    div.addEventListener('input', () => {
        const pair = project.pairs.find(p => p.id === project.activePairId);
        if (pair) {
            if (side === 'left') {
                pair.leftData[idx] = div.innerText;
                pair.leftDirty = true;
            } else {
                pair.rightData[idx] = div.innerText;
                pair.rightDirty = true;
            }
            updateStats(); 
        }
    });

    // Save Shortcut
    div.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            window.triggerSave(side); // Call global handler
        }
    });
    
    return div;
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