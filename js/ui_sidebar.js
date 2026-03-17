// js/ui_sidebar.js

import { project } from './state.js';
import { saveAppState, parseFileContent, saveFileHandle } from './file_system.js';


// ─────────────────────────────────────────────
//  EXPANDED STATE  (chapters + sections)
// ─────────────────────────────────────────────

/** Set of pair IDs whose cards are currently expanded. */
const _expandedPairs = new Set();

/** Set of section IDs that are currently collapsed. */
const _collapsedSections = new Set();

/** Expand a chapter card by id (idempotent). */
export function expandPair(id) {
    _expandedPairs.add(id);
}

/** Collapse a chapter card by id (idempotent). */
export function collapsePair(id) {
    _expandedPairs.delete(id);
}

/** Toggle expand/collapse for a chapter card. */
export function togglePair(id) {
    if (_expandedPairs.has(id)) {
        _expandedPairs.delete(id);
    } else {
        _expandedPairs.add(id);
    }
}


// ─────────────────────────────────────────────
//  SIDEBAR RENDER
// ─────────────────────────────────────────────

export function renderSidebar() {
    const list = document.getElementById('pairList');
    list.innerHTML = '';

    // Sync project title input
    const titleInput = document.getElementById('projectNameInput');
    if (titleInput) titleInput.value = project.name;

    const sections = project.sections || [];
    const pairs    = project.pairs    || [];

    if (sections.length === 0 && pairs.length === 0) {
        list.innerHTML = '<div class="empty-state">No chapters yet. Click "+ New Chapter".</div>';
        return;
    }

    // ── Render sections and their chapters ────────────────────────────────
    sections.forEach(sec => {
        const isCollapsed = _collapsedSections.has(sec.id);
        const chevron     = isCollapsed ? '▸' : '▾';

        // Section header
        const secEl = document.createElement('div');
        secEl.className = `section-group${isCollapsed ? ' collapsed' : ''}`;
        secEl.dataset.secId = sec.id;

        const hdr = document.createElement('div');
        hdr.className = 'section-header';
        hdr.innerHTML = `
            <span class="section-chevron">${chevron}</span>
            <span class="section-name">${_esc(sec.name)}</span>
            <button class="section-rename" title="Rename section">✎</button>
            <button class="section-del" title="Delete section (chapters become unsectioned)">×</button>
        `;

        // Toggle collapse on header click (ignore button clicks)
        hdr.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            if (_collapsedSections.has(sec.id)) {
                _collapsedSections.delete(sec.id);
            } else {
                _collapsedSections.add(sec.id);
            }
            renderSidebar();
            window._reattachDropHandlers?.();
        });

        // Rename button — replace name span with an input in-place
        hdr.querySelector('.section-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            _inlineRenameSection(sec.id, hdr.querySelector('.section-name'));
        });

        // Delete button
        hdr.querySelector('.section-del').addEventListener('click', (e) => {
            e.stopPropagation();
            window.deleteSection(sec.id);
        });

        secEl.appendChild(hdr);

        // Children: pairs belonging to this section
        const children = document.createElement('div');
        children.className = 'section-children';

        const sectionPairs = pairs.filter(p => p.sectionId === sec.id);
        sectionPairs.forEach(pair => {
            children.appendChild(_buildPairCard(pair));
        });

        if (sectionPairs.length === 0) {
            const empty = document.createElement('div');
            empty.className   = 'section-empty';
            empty.textContent = 'No chapters. Assign chapters using the section selector.';
            children.appendChild(empty);
        }

        secEl.appendChild(children);
        list.appendChild(secEl);
    });

    // ── Render unsectioned chapters ────────────────────────────────────────
    const unsectioned = pairs.filter(p => !p.sectionId);
    if (unsectioned.length > 0) {
        if (sections.length > 0) {
            // Show a subtle "Unsectioned" divider
            const divider = document.createElement('div');
            divider.className   = 'section-unsectioned-label';
            divider.textContent = 'Unsectioned';
            list.appendChild(divider);
        }
        unsectioned.forEach(pair => {
            list.appendChild(_buildPairCard(pair));
        });
    }
}


// ─────────────────────────────────────────────
//  PAIR CARD
// ─────────────────────────────────────────────

function _buildPairCard(pair) {
    const isActive   = pair.id === project.activePairId;
    const isExpanded = _expandedPairs.has(pair.id);
    const chevron    = isExpanded ? '▾' : '▸';

    const card     = document.createElement('div');
    card.className = `pair-card${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}`;
    card.dataset.pairId = pair.id;

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

    // Section selector (shown in expanded state)
    const sections    = project.sections || [];
    const sectionOpts = sections.map(s =>
        `<option value="${s.id}" ${pair.sectionId === s.id ? 'selected' : ''}>${_esc(s.name)}</option>`
    ).join('');
    const sectionSelectHtml = sections.length > 0 ? `
        <div class="pair-section-row">
            <span class="pair-section-label">Section:</span>
            <select class="pair-section-select"
                    onchange="event.stopPropagation(); window.movePairToSection('${pair.id}', this.value)">
                <option value="" ${!pair.sectionId ? 'selected' : ''}>— none —</option>
                ${sectionOpts}
            </select>
        </div>
    ` : '';

    card.innerHTML = `
        <div class="pair-header">
            <span class="pair-chevron">${chevron}</span>
            <input type="text" class="pair-title" value="${_esc(pair.name)}"
                   onchange="updatePairName('${pair.id}', this.value)">
            <button class="ctrl-btn btn-del" onclick="deletePair('${pair.id}')" title="Delete Chapter">×</button>
        </div>
        <div class="drop-zones">${dropZonesHtml}</div>
        ${sectionSelectHtml ? `<div class="pair-section-area">${sectionSelectHtml}</div>` : ''}
    `;

    // Click header to toggle expand + activate
    card.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON'
            || e.target.tagName === 'SELECT' || e.target.closest('.drop-zone')
            || e.target.closest('.pair-section-row')) return;

        togglePair(pair.id);
        window.setActivePair(pair.id);
    });

    return card;
}


// ─────────────────────────────────────────────
//  INLINE SECTION RENAME
// ─────────────────────────────────────────────

function _inlineRenameSection(secId, nameEl) {
    const current = project.sections.find(s => s.id === secId);
    if (!current) return;

    const input = document.createElement('input');
    input.type      = 'text';
    input.value     = current.name;
    input.className = 'section-name-input';

    const commit = () => {
        const newName = input.value.trim() || current.name;
        window.renameSection(secId, newName);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current.name; input.blur(); }
    });

    nameEl.replaceWith(input);
    input.focus();
    input.select();
}

/** Minimal HTML-escape for text placed in attributes/innerHTML. */
function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
