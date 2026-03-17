// js/ui_editor.js

import { project, MAX_COLUMNS, MIN_COLUMNS } from './state.js';


// ─────────────────────────────────────────────
//  TEXT UTILITIES
// ─────────────────────────────────────────────

/**
 * Returns true when the text is predominantly CJK
 * (Chinese / Japanese / Korean / other logographic scripts).
 *
 * Matches the following Unicode blocks:
 *   U+3040–U+30FF  Hiragana + Katakana
 *   U+3400–U+9FFF  CJK Extension A + CJK Unified Ideographs (bulk of Chinese)
 *   U+AC00–U+D7AF  Hangul Syllables
 *   U+F900–U+FAFF  CJK Compatibility Ideographs
 *
 * The check: if more than 30 % of non-whitespace characters fall in those
 * ranges, we treat the column as CJK-dominant and show a character count.
 * A minimum of 10 non-whitespace chars is required to avoid false positives
 * on very short strings that happen to contain a single CJK character.
 */
function isCJKDominant(text) {
    const nonWs   = text.replace(/\s/g, '');
    if (nonWs.length < 10) return false;
    const cjkHits = (nonWs.match(/[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g) || []).length;
    return cjkHits / nonWs.length > 0.3;
}


// ─────────────────────────────────────────────
//  SPAN HELPERS
// ─────────────────────────────────────────────

/** Return the row-span for a given data index (default 1). */
function getSpan(col, dataIdx) {
    return (col.spans && col.spans[dataIdx] > 1) ? col.spans[dataIdx] : 1;
}

/**
 * Total grid rows consumed by a column.
 * = sum of all its cell spans (or data.length if no spans exist).
 */
function getColGridRows(col) {
    if (!col.data || col.data.length === 0) return 0;
    return col.data.reduce((sum, _, i) => sum + getSpan(col, i), 0);
}

/**
 * Build a map: gridRow (1-based) → dataIdx, for a single column.
 * Every grid row inside a multi-row span maps to that span's data index.
 */
function buildGridRowMap(col) {
    const map = {};
    let row = 1;
    col.data.forEach((_, i) => {
        const span = getSpan(col, i);
        for (let r = 0; r < span; r++) map[row + r] = i;
        row += span;
    });
    return map;
}


// ─────────────────────────────────────────────
//  UNDO STACK
// ─────────────────────────────────────────────

const MAX_UNDO  = 50;
const undoStack = [];

/**
 * Snapshot the active pair's columns into the undo stack.
 * Call this AFTER syncEditorToState but BEFORE the destructive operation.
 */
export function pushUndo() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const snapshot = {
        pairId:  pair.id,
        columns: pair.columns.map(col => ({
            name:           col.name,
            data:           [...col.data],
            backups:        (col.backups || []).map(b => [...(b || [])]),
            spans:          [...(col.spans || [])],
            hidden:         col.hidden  || false,
            handle:         col.handle,
            dirty:          col.dirty,
            lastModified:   col.lastModified,
            externalChange: col.externalChange
        }))
    };

    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
}

/** Restore the most recent snapshot. Returns true if something was undone. */
export function undoLastOp() {
    if (undoStack.length === 0) return false;

    const snap = undoStack.pop();
    const pair = project.pairs.find(p => p.id === snap.pairId);
    if (!pair) return false;

    pair.columns = snap.columns.map(col => ({ ...col }));
    renderEditor();
    updateToolbar();
    updateStats();
    return true;
}


// ─────────────────────────────────────────────
//  HIDE / SHOW COLUMN
// ─────────────────────────────────────────────

/** Toggle visibility of column colIdx. */
export function toggleColHidden(colIdx) {
    syncEditorToState(project.activePairId);
    pushUndo();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const col = pair.columns[colIdx];
    if (!col) return;

    col.hidden = !col.hidden;
    renderEditor();
    updateToolbar();
}


// ─────────────────────────────────────────────
//  BACKUP UI
// ─────────────────────────────────────────────

export function toggleBackupUI(colIdx, dataIdx) {
    const wrapper = document.getElementById(`cell-wrapper-${colIdx}-${dataIdx}`);
    if (!wrapper) return;
    wrapper.querySelector('.backup-container')?.classList.toggle('open');
}

function createBackupCard(text, dataIdx, colIdx, backupIdx) {
    const card = document.createElement('div');
    card.className = 'backup-card';

    const input = document.createElement('input');
    input.className   = 'backup-input';
    input.value       = text;
    input.placeholder = "Alternative translation…";
    input.oninput = (e) => {
        const pair = project.pairs.find(p => p.id === project.activePairId);
        pair.columns[colIdx].backups[dataIdx][backupIdx] = e.target.value;
    };

    const delBtn = document.createElement('span');
    delBtn.className = 'backup-btn-del';
    delBtn.innerText = '×';
    delBtn.title     = "Remove backup";
    delBtn.onclick   = () => {
        if (!confirm("Delete this backup option?")) return;
        const pair = project.pairs.find(p => p.id === project.activePairId);
        pair.columns[colIdx].backups[dataIdx].splice(backupIdx, 1);
        renderEditor();
    };

    card.appendChild(input);
    card.appendChild(delBtn);
    return card;
}


// ─────────────────────────────────────────────
//  CELL CREATION
// ─────────────────────────────────────────────

/**
 * Build a cell-wrapper for one logical cell.
 * Grid position is set by the caller (renderEditor) via inline style.
 *
 * @param {string}  text    - Cell content
 * @param {number}  dataIdx - Index in col.data[]
 * @param {number}  colIdx  - Column index
 */
export function createCell(text, dataIdx, colIdx) {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    const col  = pair.columns[colIdx];

    // ── Wrapper ──────────────────────────────────
    const wrapper     = document.createElement('div');
    wrapper.className = 'cell-wrapper';
    wrapper.id        = `cell-wrapper-${colIdx}-${dataIdx}`;
    wrapper.style.position = 'relative';

    // ── Editable div ─────────────────────────────
    const div           = document.createElement('div');
    div.className       = 'cell';
    div.contentEditable = true;
    div.innerText       = text || "";
    div.dataset.col     = colIdx;  // used by syncEditorToState
    if (!text) div.classList.add('empty-row');

    div.addEventListener('input', () => {
        col.data[dataIdx] = div.innerText;
        col.dirty         = true;
        if (div.innerText) div.classList.remove('empty-row');
        else               div.classList.add('empty-row');
        updateStats();
    });

    div.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            window.triggerSave(colIdx);
        }
    });

    // ── Backup badge ─────────────────────────────
    if (!col.backups[dataIdx]) col.backups[dataIdx] = [];
    const backupList = col.backups[dataIdx];

    if (backupList.length > 0) {
        const badge     = document.createElement('div');
        badge.className = 'backup-count';
        badge.innerText = backupList.length;
        badge.title     = `${backupList.length} backup option(s)`;
        badge.onclick   = (e) => { e.stopPropagation(); toggleBackupUI(colIdx, dataIdx); };
        wrapper.appendChild(badge);
    }

    // ── Backup container ─────────────────────────
    const container     = document.createElement('div');
    container.className = 'backup-container';

    backupList.forEach((backupText, backupIdx) => {
        container.appendChild(createBackupCard(backupText, dataIdx, colIdx, backupIdx));
    });

    const addBtn     = document.createElement('button');
    addBtn.className = 'btn-add-backup';
    addBtn.innerText = "+ Add Option";
    addBtn.onclick   = () => {
        if (!col.backups[dataIdx]) col.backups[dataIdx] = [];
        col.backups[dataIdx].push("");
        renderEditor();
        setTimeout(() => {
            document.getElementById(`cell-wrapper-${colIdx}-${dataIdx}`)
                ?.querySelector('.backup-container')?.classList.add('open');
        }, 0);
    };
    container.appendChild(addBtn);

    wrapper.appendChild(div);
    wrapper.appendChild(container);
    return wrapper;
}


// ─────────────────────────────────────────────
//  MERGE / SPLIT BUTTON BAR  (shown on hover)
// ─────────────────────────────────────────────

/**
 * Append a small hover-bar to a cell-wrapper with Merge↓ and/or Split↑ buttons.
 *
 * @param {HTMLElement} wrapper
 * @param {number} colIdx
 * @param {number} dataIdx
 * @param {number} span          - current span of this cell (≥ 1)
 * @param {number} totalDataItems - col.data.length
 */
function addMergeBar(wrapper, colIdx, dataIdx, span, totalDataItems) {
    // Don't render bar if there's nothing to offer
    const canMerge = dataIdx < totalDataItems - 1;
    const canSplit = span > 1;
    if (!canMerge && !canSplit) return;

    const bar     = document.createElement('div');
    bar.className = 'merge-bar';

    if (canMerge) {
        const btn     = document.createElement('button');
        btn.className = 'ctrl-btn merge-btn';
        btn.title     = 'Merge with row below';
        btn.textContent = '⤵';
        btn.onclick   = (e) => { e.stopPropagation(); window.mergeCellDown(colIdx, dataIdx); };
        bar.appendChild(btn);
    }

    if (canSplit) {
        const btn     = document.createElement('button');
        btn.className = 'ctrl-btn split-btn';
        btn.title     = `Split (spans ${span} rows)`;
        btn.textContent = '⤴';
        btn.onclick   = (e) => { e.stopPropagation(); window.splitCell(colIdx, dataIdx); };
        bar.appendChild(btn);
    }

    wrapper.appendChild(bar);
}


// ─────────────────────────────────────────────
//  GRID RENDER
// ─────────────────────────────────────────────

export function renderEditor() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:3rem; text-align:center; color:#94a3b8">Select a chapter to edit</div>';
        return;
    }

    // Ensure spans arrays exist on every column
    pair.columns.forEach(col => { if (!col.spans) col.spans = []; });

    // ── Visible columns only ─────────────────────────────────────────────
    // visibleCols = array of { col, origIdx } for columns that are not hidden.
    // origIdx is the real index in pair.columns (used for data operations).
    const visibleCols = pair.columns
        .map((col, i) => ({ col, origIdx: i }))
        .filter(({ col }) => !col.hidden);

    const numVisible = visibleCols.length;

    if (numVisible === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; padding:3rem; text-align:center; color:#94a3b8">All columns are hidden. Use the 👁 eye buttons in the toolbar to show them.</div>';
        return;
    }

    // ── Grid template columns ────────────────────────────────────────────
    // Layout: 25px [1fr 40px]*(numVisible-1) 1fr
    //   CSS col 1              = line numbers
    //   CSS col 2 + v*2        = v-th visible text column
    //   CSS col 3 + v*2        = controls between visible col v and v+1
    const parts = ['25px'];
    for (let v = 0; v < numVisible; v++) {
        parts.push('1fr');
        if (v < numVisible - 1) parts.push('40px');
    }
    grid.style.gridTemplateColumns = parts.join(' ');

    const getCssTxtCol  = (v) => 2 + v * 2;   // text column for v-th visible
    const getCssCtrlCol = (v) => 3 + v * 2;   // controls between v-th and (v+1)-th visible

    // ── Total grid rows (based on visible columns only) ──────────────────
    const totalGridRows = Math.max(0, ...visibleCols.map(({ col }) => getColGridRows(col)));

    // Per-visible-column: gridRow (1-based) → dataIdx
    const gridRowMaps = visibleCols.map(({ col }) => buildGridRowMap(col));

    // ── Line numbers (one per grid row) ─────────────────────────────────
    for (let r = 1; r <= totalGridRows; r++) {
        const el     = document.createElement('div');
        el.className = 'line-num';
        el.innerText = r;
        el.style.gridColumn = '1';
        el.style.gridRow    = String(r);
        grid.appendChild(el);
    }

    // ── Text cells (explicitly placed) ──────────────────────────────────
    // dataset.col is always the ORIGINAL column index (origIdx), so that
    // syncEditorToState correctly maps DOM cells back to pair.columns[origIdx].
    visibleCols.forEach(({ col, origIdx }, v) => {
        const cssCol = getCssTxtCol(v);
        let gridRow  = 1;

        if (!col.backups) col.backups = [];

        col.data.forEach((text, dataIdx) => {
            if (!col.backups[dataIdx]) col.backups[dataIdx] = [];

            const span    = getSpan(col, dataIdx);
            const wrapper = createCell(text, dataIdx, origIdx);  // origIdx for dataset.col

            // Explicit CSS grid placement
            wrapper.style.gridColumn = String(cssCol);
            wrapper.style.gridRow    = span > 1 ? `${gridRow} / span ${span}` : String(gridRow);

            // Visual treatment for merged cells
            if (span > 1) {
                wrapper.classList.add('is-merged');
                wrapper.dataset.span = span;
            }

            // Hover bar: merge-down / split buttons (use origIdx for data ops)
            addMergeBar(wrapper, origIdx, dataIdx, span, col.data.length);

            grid.appendChild(wrapper);
            gridRow += span;
        });

        // Pad remaining grid rows with empty placeholders
        const colGridRows = getColGridRows(col);
        for (let r = colGridRows + 1; r <= totalGridRows; r++) {
            const pad            = document.createElement('div');
            pad.className        = 'cell-pad';
            pad.style.gridColumn = String(cssCol);
            pad.style.gridRow    = String(r);
            grid.appendChild(pad);
        }
    });

    // ── Controls (one cell per grid row, between adjacent VISIBLE columns) ──
    for (let v = 0; v < numVisible - 1; v++) {
        const cssCol      = getCssCtrlCol(v);
        const leftOrigIdx = visibleCols[v].origIdx;
        const rightOrigIdx = visibleCols[v + 1].origIdx;

        for (let r = 1; r <= totalGridRows; r++) {
            const leftDataIdx  = gridRowMaps[v][r];
            const rightDataIdx = gridRowMaps[v + 1][r];

            const controls     = document.createElement('div');
            controls.className = 'controls';
            controls.style.gridColumn = String(cssCol);
            controls.style.gridRow    = String(r);

            // Build one button group for each side (use origIdx for data ops)
            const makeGroup = (colI, dIdx) => {
                if (dIdx === undefined) return `<div style="width:14px"></div>`;
                return `
                    <div style="display:flex;flex-direction:column;gap:1px">
                        <button class="ctrl-btn"
                                onclick="modifyGrid('insert',${colI},${dIdx})"
                                title="Insert Below (Col ${colI + 1})">▼</button>
                        <button class="ctrl-btn btn-backup"
                                onclick="toggleBackupUI(${colI},${dIdx})"
                                title="Backups (Col ${colI + 1})">+</button>
                        <button class="ctrl-btn btn-del"
                                onclick="modifyGrid('delete',${colI},${dIdx})"
                                title="Delete Row (Col ${colI + 1})">×</button>
                    </div>`;
            };

            controls.innerHTML = makeGroup(leftOrigIdx, leftDataIdx) + makeGroup(rightOrigIdx, rightDataIdx);
            grid.appendChild(controls);
        }
    }
}


// ─────────────────────────────────────────────
//  MERGE  (combine cell i with cell i+1)
// ─────────────────────────────────────────────

export function mergeCellDown(colIdx, dataIdx) {
    syncEditorToState(project.activePairId);
    pushUndo();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const col = pair.columns[colIdx];
    if (!col || dataIdx >= col.data.length - 1) return;   // Nothing below

    if (!col.spans) col.spans = [];

    // Join text (preserve non-empty content of both cells)
    const textA = col.data[dataIdx];
    const textB = col.data[dataIdx + 1];
    col.data[dataIdx] = (textA && textB) ? `${textA}\n${textB}`
                      : (textA || textB);
    col.data.splice(dataIdx + 1, 1);

    // Grow span: new span = span_A + span_B
    const spanA = getSpan(col, dataIdx);
    const spanB = (col.spans[dataIdx + 1] > 1) ? col.spans[dataIdx + 1] : 1;
    col.spans[dataIdx] = spanA + spanB;
    col.spans.splice(dataIdx + 1, 1);

    // Keep backups in sync
    if (col.backups) col.backups.splice(dataIdx + 1, 1);

    col.dirty = true;
    renderEditor();
    updateStats();
}


// ─────────────────────────────────────────────
//  SPLIT  (peel one row off the top of a merged cell)
// ─────────────────────────────────────────────

export function splitCell(colIdx, dataIdx) {
    syncEditorToState(project.activePairId);
    pushUndo();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const col  = pair.columns[colIdx];
    if (!col) return;

    const span = getSpan(col, dataIdx);
    if (span <= 1) return;   // Not merged, nothing to do

    if (!col.spans) col.spans = [];

    // Split text at first newline if present; otherwise leave new cell empty
    const fullText = col.data[dataIdx] || "";
    const nlPos    = fullText.indexOf('\n');
    let topText, bottomText;
    if (nlPos !== -1) {
        topText    = fullText.slice(0, nlPos);
        bottomText = fullText.slice(nlPos + 1);
    } else {
        topText    = fullText;
        bottomText = "";
    }

    col.data[dataIdx] = topText;
    col.data.splice(dataIdx + 1, 0, bottomText);

    // Distribute the span: top cell keeps span-1, new cell gets 1
    col.spans[dataIdx] = span - 1;
    col.spans.splice(dataIdx + 1, 0, 1);

    // Keep backups in sync
    if (col.backups) col.backups.splice(dataIdx + 1, 0, []);

    col.dirty = true;
    renderEditor();
    updateStats();
}


// ─────────────────────────────────────────────
//  GRID MODIFICATIONS  (insert / delete rows)
// ─────────────────────────────────────────────

export function modifyGrid(action, colIdx, dataIdx) {
    syncEditorToState(project.activePairId);
    pushUndo();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const col = pair.columns[colIdx];
    if (!col) return;

    if (!col.spans) col.spans = [];

    if (action === 'insert') {
        // Insert a new empty row BELOW the current data index
        col.data.splice(dataIdx + 1, 0, "");
        col.spans.splice(dataIdx + 1, 0, 1);
        if (col.backups) col.backups.splice(dataIdx + 1, 0, []);
    } else if (action === 'delete') {
        col.data.splice(dataIdx, 1);
        col.spans.splice(dataIdx, 1);
        if (col.backups) col.backups.splice(dataIdx, 1);
    }

    col.dirty = true;
    renderEditor();
    updateStats();
}


// ─────────────────────────────────────────────
//  TOOLBAR  (dynamic save buttons)
// ─────────────────────────────────────────────

export function updateToolbar() {
    const pair         = project.pairs.find(p => p.id === project.activePairId);
    const title        = document.getElementById('activeChapterTitle');
    const container    = document.getElementById('saveButtonsContainer');
    const colCountEl   = document.getElementById('colCount');
    const btnAddCol    = document.getElementById('btnAddCol');
    const btnRemoveCol = document.getElementById('btnRemoveCol');

    if (!pair) {
        title.innerText   = "No Chapter Selected";
        if (container)    container.innerHTML = '';
        if (colCountEl)   colCountEl.innerText = '–';
        if (btnAddCol)    btnAddCol.disabled = true;
        if (btnRemoveCol) btnRemoveCol.disabled = true;
        return;
    }

    title.innerText = pair.name;

    if (colCountEl)   colCountEl.innerText  = pair.columns.length;
    if (btnAddCol)    btnAddCol.disabled    = (pair.columns.length >= MAX_COLUMNS);
    if (btnRemoveCol) btnRemoveCol.disabled = (pair.columns.length <= MIN_COLUMNS);

    // Rebuild save button groups
    if (container) {
        container.innerHTML = '';
        pair.columns.forEach((col, i) => {
            if (i > 0) {
                const spacer = document.createElement('div');
                spacer.style.width = '12px';
                container.appendChild(spacer);
            }

            const group = document.createElement('div');
            group.style.cssText = 'display:flex; flex-direction:column; align-items:flex-end; gap:2px;';

            // ── Top row: eye toggle + save button ──────────────────────────
            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex; gap:4px; align-items:center;';

            const eyeBtn     = document.createElement('button');
            eyeBtn.className = 'btn-save';
            eyeBtn.style.padding = '4px 6px';
            eyeBtn.title     = col.hidden ? `Show column ${i + 1}` : `Hide column ${i + 1}`;
            eyeBtn.innerText = col.hidden ? '👁' : '🙈';
            eyeBtn.onclick   = () => window.toggleColHidden(i);

            const saveBtn     = document.createElement('button');
            saveBtn.id        = `btn-save-col-${i}`;
            saveBtn.className = 'btn-save';
            saveBtn.style.padding = '4px 6px';
            saveBtn.innerText = '💾';
            saveBtn.title     = col.handle ? `Save: ${col.name}` : 'Save As…';
            saveBtn.disabled  = col.hidden;
            saveBtn.onclick   = () => window.triggerSave(i);

            // Download column content as a text file
            const dlBtn     = document.createElement('button');
            dlBtn.className = 'btn-save';
            dlBtn.style.padding = '4px 6px';
            dlBtn.title     = `Download column ${i + 1} as text file`;
            dlBtn.innerText = '⬇';
            dlBtn.onclick   = () => window.downloadColumn(i);

            // Delete this column permanently (requires confirmation)
            const delColBtn     = document.createElement('button');
            delColBtn.className = 'btn-save btn-del-col';
            delColBtn.style.padding = '4px 6px';
            delColBtn.title     = `Delete column ${i + 1}`;
            delColBtn.innerText = '🗑';
            delColBtn.disabled  = pair.columns.length <= MIN_COLUMNS;
            delColBtn.onclick   = () => window.deleteColumn(pair.id, i);

            topRow.append(eyeBtn, saveBtn, dlBtn, delColBtn);

            // ── Status row: dot + word/char count ──────────────────────────
            const statusRow = document.createElement('div');
            statusRow.style.cssText = 'display:flex; align-items:center; gap:2px; max-width:160px;';

            const dot = document.createElement('span');
            dot.id        = `dot-col-${i}`;
            dot.className = 'sync-dot';
            dot.title     = 'Sync Status';

            const nameLabel = document.createElement('span');
            nameLabel.id        = `name-col-${i}`;
            nameLabel.title     = col.name || '';
            nameLabel.style.cssText = 'font-size:10px; color:#475569; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace;';
            nameLabel.innerText = col.name || '(no file)';

            const stats = document.createElement('div');
            stats.id            = `stats-col-${i}`;
            stats.style.cssText = 'font-size:10px; color:#94a3b8; font-family:monospace;';

            statusRow.append(dot, nameLabel, stats);
            group.append(topRow, statusRow);
            container.appendChild(group);
        });
    }

    updateStats();
}


// ─────────────────────────────────────────────
//  SYNC DOTS / STATS
// ─────────────────────────────────────────────

export function updateStats() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    pair.columns.forEach((col, i) => {
        const dot   = document.getElementById(`dot-col-${i}`);
        const stats = document.getElementById(`stats-col-${i}`);
        if (!dot) return;

        if (!col.handle) {
            dot.className = 'sync-dot';
            dot.title     = "No file linked";
        } else if (col.externalChange) {
            dot.className = 'sync-dot orange';
            dot.title     = "External change detected – click ↻ Refresh";
        } else if (col.dirty) {
            dot.className = 'sync-dot red';
            dot.title     = "Unsaved changes";
        } else {
            dot.className = 'sync-dot green';
            dot.title     = "Synced";
        }

        if (stats) {
            const fullText = (col.data || []).join(' ');
            if (isCJKDominant(fullText)) {
                // CJK text: show non-whitespace character count
                const charCount = fullText.replace(/\s/g, '').length;
                stats.innerText = ` · ${charCount}字`;
            } else {
                // Latin / other: show word count
                const wordCount = fullText.split(/\s+/).filter(w => w.length).length;
                stats.innerText = ` · ${wordCount}w`;
            }
        }
    });
}


// ─────────────────────────────────────────────
//  STATE SYNC  (editor DOM → project state)
// ─────────────────────────────────────────────

export function syncEditorToState(id) {
    const pair = project.pairs.find(p => p.id === id);
    if (!pair) return;

    const cells = document.querySelectorAll('.cell');
    if (cells.length === 0) return;

    // Cells are appended in column order (all of col 0, then all of col 1, …)
    // so grouping by dataset.col preserves the correct data-index order.
    const newData = pair.columns.map(() => []);
    cells.forEach(cell => {
        const c = parseInt(cell.dataset.col, 10);
        if (!isNaN(c) && newData[c] !== undefined) newData[c].push(cell.innerText);
    });

    pair.columns.forEach((col, i) => {
        if (newData[i].length > 0) col.data = newData[i];
    });
}


// ─────────────────────────────────────────────
//  RECENTER VIEW  (Emacs Ctrl+L style)
// ─────────────────────────────────────────────

/** Cycles: 0 = center, 1 = top, 2 = bottom */
let _recenterState  = 0;
let _recenterTarget = null;   // tracks last element so moving focus resets the cycle

/**
 * Scroll the editor container so the currently focused cell sits at the
 * center, top, or bottom of the visible area — cycling on each call,
 * resetting to center whenever the focused element changes.
 */
export function recenterCurrentLine() {
    const active    = document.activeElement;
    const target    = active?.closest('.cell-wrapper') ?? active;
    const container = document.querySelector('.container');
    if (!container || !target || target === document.body) return;

    // Reset cycle if focus moved to a different element
    if (target !== _recenterTarget) {
        _recenterState  = 0;
        _recenterTarget = target;
    }

    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const PAD   = 20;

    // Target's top edge relative to the container's scrollable origin
    const targetTop = tRect.top - cRect.top + container.scrollTop;
    const cHeight   = container.clientHeight;

    let scrollTo;
    switch (_recenterState) {
        case 0:  // center
            scrollTo = targetTop - cHeight / 2 + tRect.height / 2;
            break;
        case 1:  // top
            scrollTo = targetTop - PAD;
            break;
        case 2:  // bottom
            scrollTo = targetTop + tRect.height - cHeight + PAD;
            break;
    }

    _recenterState = (_recenterState + 1) % 3;
    container.scrollTo({ top: Math.max(0, scrollTo), behavior: 'smooth' });
}


// ─────────────────────────────────────────────
//  KEYBOARD NAVIGATION
// ─────────────────────────────────────────────

/**
 * Move editor focus to an adjacent cell or column.
 *
 * @param {'left'|'right'|'up'|'down'} direction
 *
 * 'left'/'right' — move to the same dataIdx in the previous/next *visible* column.
 *                  Clamps to the target column's last row if it has fewer rows.
 * 'up'/'down'    — move to the previous/next dataIdx in the same column.
 *
 * The function reads the currently focused .cell element to determine the
 * current column and row position, so it is a no-op if focus is not in a cell.
 */
export function navigateCell(direction) {
    const active = document.activeElement;
    if (!active || !active.classList.contains('cell')) return;

    const origColIdx = parseInt(active.dataset.col, 10);
    if (isNaN(origColIdx)) return;

    // Parse dataIdx from the wrapper id: "cell-wrapper-{colIdx}-{dataIdx}"
    const wrapper = active.closest('[id^="cell-wrapper-"]');
    if (!wrapper) return;
    const match = wrapper.id.match(/^cell-wrapper-(\d+)-(\d+)$/);
    if (!match) return;
    const dataIdx = parseInt(match[2], 10);

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const visibleCols = pair.columns
        .map((col, i) => ({ col, origIdx: i }))
        .filter(({ col }) => !col.hidden);

    const visibleIdx = visibleCols.findIndex(({ origIdx }) => origIdx === origColIdx);
    if (visibleIdx === -1) return;

    let targetColOrigIdx, targetDataIdx;

    if (direction === 'left') {
        if (visibleIdx === 0) return;
        const tv = visibleCols[visibleIdx - 1];
        targetColOrigIdx = tv.origIdx;
        targetDataIdx    = Math.min(dataIdx, tv.col.data.length - 1);

    } else if (direction === 'right') {
        if (visibleIdx === visibleCols.length - 1) return;
        const tv = visibleCols[visibleIdx + 1];
        targetColOrigIdx = tv.origIdx;
        targetDataIdx    = Math.min(dataIdx, tv.col.data.length - 1);

    } else if (direction === 'up') {
        if (dataIdx === 0) return;
        targetColOrigIdx = origColIdx;
        targetDataIdx    = dataIdx - 1;

    } else if (direction === 'down') {
        const col = pair.columns[origColIdx];
        if (dataIdx >= col.data.length - 1) return;
        targetColOrigIdx = origColIdx;
        targetDataIdx    = dataIdx + 1;

    } else {
        return;
    }

    const targetWrapper = document.getElementById(
        `cell-wrapper-${targetColOrigIdx}-${targetDataIdx}`);
    if (!targetWrapper) return;

    const targetCell = targetWrapper.querySelector('.cell');
    if (!targetCell) return;

    targetCell.focus();

    // Place cursor at the end of the target cell
    try {
        const range = document.createRange();
        const sel   = window.getSelection();
        range.selectNodeContents(targetCell);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch { /* non-fatal */ }
}
