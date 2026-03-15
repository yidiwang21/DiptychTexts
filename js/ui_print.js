// js/ui_print.js
// Print / Export PDF panel.
//
// Renders a hidden #printFrame with the selected chapters × columns, then
// calls window.print().  @media print hides .app-layout and shows #printFrame
// so the browser's print dialog / Save as PDF sees only the formatted content.

import { project } from './state.js';
import { syncEditorToState } from './ui_editor.js';


// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────

let _panel = null;

export function openPrintDialog() {
    if (!_panel) _buildPanel();
    _refreshPanel();
    _panel.style.display = 'flex';
}

export function closePrintDialog() {
    if (_panel) _panel.style.display = 'none';
}


// ─────────────────────────────────────────────
//  PANEL CONSTRUCTION
// ─────────────────────────────────────────────

function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id        = 'printPanel';
    _panel.className = 'pr-panel';

    // ── Header ──────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'pr-header';

    const title   = document.createElement('span');
    title.textContent = '🖨  Print / Export PDF';

    const closeBtn = document.createElement('button');
    closeBtn.className   = 'pr-close';
    closeBtn.textContent = '✕';
    closeBtn.title       = 'Close';
    closeBtn.onclick     = closePrintDialog;

    header.append(title, closeBtn);
    _makeDraggable(_panel, header);

    // ── Body (populated by _refreshPanel) ───────────────────────────────
    const body = document.createElement('div');
    body.className = 'pr-body';
    body.id        = 'printPanelBody';

    _panel.append(header, body);
    document.body.appendChild(_panel);
}

function _refreshPanel() {
    const body = document.getElementById('printPanelBody');
    if (!body) return;
    body.innerHTML = '';

    const pairs   = project.pairs;
    const maxCols = Math.max(...pairs.map(p => p.columns.length), 1);

    // ── Chapter section ──────────────────────────────────────────────────
    const chSec   = _section('CHAPTERS');

    // "Select all" row
    const saRow   = document.createElement('div');
    saRow.className = 'pr-select-all-row';
    const saCb    = _checkbox('pr-sa-chapters', true);
    saCb.addEventListener('change', () => {
        document.querySelectorAll('.pr-chapter-cb')
            .forEach(cb => { cb.checked = saCb.checked; });
    });
    const saLbl   = _label('pr-sa-chapters', 'Select all');
    saRow.append(saCb, saLbl);
    chSec.appendChild(saRow);

    // One row per chapter
    const chList  = document.createElement('div');
    chList.className = 'pr-item-list';
    pairs.forEach(pair => {
        const row = document.createElement('label');
        row.className = 'pr-check-item';
        const cb  = _checkbox(null, true, 'pr-chapter-cb', pair.id);
        cb.addEventListener('change', _syncSelectAll.bind(null, '.pr-chapter-cb', 'pr-sa-chapters'));
        const sp  = document.createElement('span');
        sp.textContent = pair.name;
        row.append(cb, sp);
        chList.appendChild(row);
    });
    chSec.appendChild(chList);

    // ── Column section ───────────────────────────────────────────────────
    const colSec  = _section('COLUMNS  (by position)');
    const colNote = document.createElement('div');
    colNote.className   = 'pr-note';
    colNote.textContent = 'Chapters with fewer columns silently skip missing positions.';
    colSec.appendChild(colNote);

    const colList = document.createElement('div');
    colList.className = 'pr-item-list';

    for (let i = 0; i < maxCols; i++) {
        // Collect distinct file-names at this column position across all chapters
        const names = [...new Set(
            pairs.map(p => p.columns[i]?.name).filter(Boolean)
        )].slice(0, 3);
        const hint = names.length ? `  —  ${names.join(', ')}` : '';

        const row = document.createElement('label');
        row.className = 'pr-check-item';
        const cb  = _checkbox(null, true, 'pr-col-cb', String(i));
        const sp  = document.createElement('span');
        sp.innerHTML = `<b>Col ${i + 1}</b><span class="pr-hint">${hint}</span>`;
        row.append(cb, sp);
        colList.appendChild(row);
    }
    colSec.appendChild(colList);

    // ── Options section ──────────────────────────────────────────────────
    const optSec  = _section('OPTIONS');
    const optList = document.createElement('div');
    optList.className = 'pr-item-list';

    // Chapter break option
    const breakRow = document.createElement('label');
    breakRow.className = 'pr-check-item';
    const breakCb = _checkbox('pr-opt-break', false);
    breakCb.title = 'Start each chapter on a new page';
    const breakSp = document.createElement('span');
    breakSp.textContent = 'Page break between chapters';
    breakRow.append(breakCb, breakSp);

    // Show project title option
    const titleRow = document.createElement('label');
    titleRow.className = 'pr-check-item';
    const titleCb = _checkbox('pr-opt-title', true);
    const titleSp = document.createElement('span');
    titleSp.textContent = 'Show project title';
    titleRow.append(titleCb, titleSp);

    optList.append(breakRow, titleRow);
    optSec.appendChild(optList);

    // ── Action buttons ───────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'pr-actions';

    const printBtn  = document.createElement('button');
    printBtn.className   = 'pr-print-btn';
    printBtn.textContent = '🖨  Print / Save as PDF';
    printBtn.onclick     = _onPrint;

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'pr-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick     = closePrintDialog;

    actions.append(printBtn, cancelBtn);

    body.append(chSec, colSec, optSec, actions);
}

function _syncSelectAll(itemSel, allId) {
    const all     = document.querySelectorAll(itemSel);
    const checked = document.querySelectorAll(`${itemSel}:checked`);
    const allCb   = document.getElementById(allId);
    if (allCb) allCb.checked = (all.length === checked.length);
}


// ─────────────────────────────────────────────
//  PRINT EXECUTION
// ─────────────────────────────────────────────

function _onPrint() {
    const selectedPairIds = [...document.querySelectorAll('.pr-chapter-cb:checked')]
        .map(cb => cb.value);
    const selectedColIdxs = [...document.querySelectorAll('.pr-col-cb:checked')]
        .map(cb => parseInt(cb.value, 10));
    const pageBreaks = document.getElementById('pr-opt-break')?.checked ?? false;
    const showTitle  = document.getElementById('pr-opt-title')?.checked ?? true;

    if (selectedPairIds.length === 0) {
        alert('Please select at least one chapter.'); return;
    }
    if (selectedColIdxs.length === 0) {
        alert('Please select at least one column.'); return;
    }

    closePrintDialog();

    // Sync the active chapter's editor DOM → state so we print the latest text
    if (project.activePairId) syncEditorToState(project.activePairId);

    // Build the off-screen print content
    _buildPrintFrame(selectedPairIds, selectedColIdxs, { pageBreaks, showTitle });

    // Give the browser one frame to lay out the new DOM, then print
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.print();
            // After the print dialog closes, clean up
            setTimeout(_clearPrintFrame, 800);
        });
    });
}

function _buildPrintFrame(pairIds, colIdxs, { pageBreaks, showTitle }) {
    const frame = document.getElementById('printFrame');
    if (!frame) return;
    frame.innerHTML = '';

    if (showTitle && project.name) {
        const h = document.createElement('h1');
        h.className   = 'print-project-title';
        h.textContent = project.name;
        frame.appendChild(h);
    }

    pairIds.forEach((id, i) => {
        const pair = project.pairs.find(p => p.id === id);
        if (!pair) return;

        const chDiv = document.createElement('div');
        chDiv.className = 'print-chapter';
        if (i > 0 && pageBreaks) chDiv.classList.add('print-page-break');

        const chTitle = document.createElement('h2');
        chTitle.className   = 'print-chapter-title';
        chTitle.textContent = pair.name;
        chDiv.appendChild(chTitle);

        const grid = _buildChapterGrid(pair, colIdxs);
        chDiv.appendChild(grid);

        frame.appendChild(chDiv);
    });
}

function _buildChapterGrid(pair, colIdxs) {
    // Only include positions that exist in this chapter
    const activeCols = colIdxs
        .filter(i => i < pair.columns.length)
        .map(i => pair.columns[i]);

    const wrapper = document.createElement('div');
    if (activeCols.length === 0) return wrapper;

    const grid = document.createElement('div');
    grid.className = 'print-grid';
    grid.style.gridTemplateColumns = activeCols.map(() => '1fr').join(' ');

    const getSpan     = (col, i) => (col.spans?.[i] > 1 ? col.spans[i] : 1);
    const colGridRows = col =>
        (col.data || []).reduce((s, _, i) => s + getSpan(col, i), 0);

    const totalRows = Math.max(...activeCols.map(colGridRows), 1);

    activeCols.forEach((col, v) => {
        let gridRow = 1;
        (col.data || []).forEach((text, dataIdx) => {
            const span = getSpan(col, dataIdx);
            const cell = document.createElement('div');
            cell.className = 'print-cell';
            if (!text.trim()) cell.classList.add('print-cell-empty');
            if (span > 1)    cell.classList.add('print-cell-merged');
            cell.textContent          = text || '';
            cell.style.gridColumn     = String(v + 1);
            cell.style.gridRow        = span > 1
                ? `${gridRow} / span ${span}`
                : String(gridRow);
            grid.appendChild(cell);
            gridRow += span;
        });

        // Padding cells to fill rows shorter than the tallest column
        const rows = colGridRows(col);
        for (let r = rows + 1; r <= totalRows; r++) {
            const pad = document.createElement('div');
            pad.className         = 'print-cell print-cell-pad';
            pad.style.gridColumn  = String(v + 1);
            pad.style.gridRow     = String(r);
            grid.appendChild(pad);
        }
    });

    wrapper.appendChild(grid);
    return wrapper;
}

function _clearPrintFrame() {
    const frame = document.getElementById('printFrame');
    if (frame) frame.innerHTML = '';
}


// ─────────────────────────────────────────────
//  SMALL DOM HELPERS
// ─────────────────────────────────────────────

/** Create a labelled section div. */
function _section(labelText) {
    const sec = document.createElement('div');
    sec.className = 'pr-section';
    const lbl = document.createElement('div');
    lbl.className   = 'pr-section-label';
    lbl.textContent = labelText;
    sec.appendChild(lbl);
    return sec;
}

function _checkbox(id, checked, className, value) {
    const cb    = document.createElement('input');
    cb.type     = 'checkbox';
    cb.checked  = checked;
    if (id)        cb.id        = id;
    if (className) cb.className = className;
    if (value)     cb.value     = value;
    return cb;
}

function _label(forId, text) {
    const l = document.createElement('label');
    l.htmlFor     = forId;
    l.textContent = text;
    return l;
}

/** Make panel draggable by its header. */
function _makeDraggable(panel, handle) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        mx = e.clientX; my = e.clientY;
        const r = panel.getBoundingClientRect();
        ox = r.left;  oy = r.top;
        panel.style.right  = 'auto';
        panel.style.left   = ox + 'px';
        panel.style.top    = oy + 'px';
        handle.style.cursor = 'grabbing';

        const onMove = ev => {
            panel.style.left = (ox + ev.clientX - mx) + 'px';
            panel.style.top  = (oy + ev.clientY - my) + 'px';
        };
        const onUp = () => {
            handle.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}
