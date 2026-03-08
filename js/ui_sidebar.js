// js/ui_sidebar.js

import { project } from './state.js';
import { saveAppState, parseFileContent, saveFileHandle } from './file_system.js';


// ─────────────────────────────────────────────
//  SIDEBAR RENDER
// ─────────────────────────────────────────────

export function renderSidebar() {
    const list = document.getElementById('pairList');
    list.innerHTML = '';

    // Sync project title input
    const titleInput = document.getElementById('projectNameInput');
    if (titleInput) titleInput.value = project.name;

    project.pairs.forEach(pair => {
        const card     = document.createElement('div');
        card.className = `pair-card ${pair.id === project.activePairId ? 'active' : ''}`;

        // Drop-zone HTML for every column
        const dropZonesHtml = pair.columns.map((col, i) => {
            const isLinked = !!col.name;
            return `
                <div id="drop-col-${i}-${pair.id}"
                     class="drop-zone ${isLinked ? 'loaded' : ''}"
                     style="${!isLinked ? 'border-color:#fca5a5; background:#fef2f2;' : ''}"
                     title="${isLinked ? `Col ${i+1}: ${col.name} (click or drop to re-link)` : `Col ${i+1}: click or drop a file`}">
                    ${isLinked
                        ? `<span class="drop-zone-name">${col.name}</span>
                           <button class="drop-zone-unlink-btn"
                                   title="Unlink file (clears this column's text)"
                                   onclick="event.stopPropagation(); unlinkFile('${pair.id}', ${i})">×</button>`
                        : `<span class="drop-zone-hint">📂 Click or drop</span>`}
                </div>
            `;
        }).join('');

        card.innerHTML = `
            <div class="pair-header">
                <input type="text" class="pair-title" value="${pair.name}"
                       onchange="updatePairName('${pair.id}', this.value)">
                <button class="ctrl-btn btn-del" onclick="deletePair('${pair.id}')" title="Delete Chapter">×</button>
            </div>
            <div class="drop-zones">${dropZonesHtml}</div>
        `;

        // Click card body to activate (ignore inputs/buttons)
        card.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON'
                && !e.target.closest('.drop-zone')) {
                window.setActivePair(pair.id);
            }
        });

        list.appendChild(card);
    });
}


// ─────────────────────────────────────────────
//  PAIR NAME
// ─────────────────────────────────────────────

export function updatePairName(id, newName) {
    const pair = project.pairs.find(p => p.id === id);
    if (pair) {
        pair.name = newName;
        saveAppState();
    }
}


// ─────────────────────────────────────────────
//  DROP ZONE HANDLERS  (drag-and-drop + click)
// ─────────────────────────────────────────────

/** Wire drag-and-drop AND click-to-open for every column drop zone. */
export function attachAllDropHandlers(onDropCallback) {
    project.pairs.forEach(pair => {
        pair.columns.forEach((_, colIdx) => {
            setupDropZone(`drop-col-${colIdx}-${pair.id}`, pair, colIdx, onDropCallback);
        });
    });
}

function setupDropZone(elementId, pair, colIdx, callback) {
    const zone = document.getElementById(elementId);
    if (!zone) return;

    // ── Drag-and-drop ─────────────────────────────────────────────────────────
    zone.ondragover  = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
    zone.ondragleave = ()  => { zone.classList.remove('drag-over'); };

    zone.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');

        if (!e.dataTransfer.items) return;
        const item = e.dataTransfer.items[0];
        if (item.kind !== 'file') return;

        const handle = await item.getAsFileSystemHandle();
        await _linkFile(handle, pair, colIdx, callback);
    };

    // ── Click to open file picker ─────────────────────────────────────────────
    zone.style.cursor = 'pointer';
    zone.addEventListener('click', async (e) => {
        e.stopPropagation();  // Don't activate the card
        try {
            const [handle] = await window.showOpenFilePicker({ multiple: false });
            await _linkFile(handle, pair, colIdx, callback);
        } catch (err) {
            if (err.name !== 'AbortError') console.error('File open error:', err);
            // User cancelled — do nothing
        }
    });
}

/**
 * Shared logic: load a file into a column, parse as paragraphs,
 * persist the handle in IndexedDB, and notify the controller.
 */
async function _linkFile(handle, pair, colIdx, callback) {
    const file = await handle.getFile();
    const text = await file.text();

    const col           = pair.columns[colIdx];
    col.handle          = handle;
    col.name            = file.name;
    col.data            = parseFileContent(text);
    col.lastModified    = file.lastModified;
    col.dirty           = false;
    col.externalChange  = false;

    // Persist the handle immediately so it survives a page reload
    await saveFileHandle(pair.id, colIdx, handle);

    if (callback) callback(pair.id);
}
