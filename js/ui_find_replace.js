// js/ui_find_replace.js
//
// Floating Find & Replace panel scoped to the active chapter.
// Open with Cmd+F (find) or Cmd+H (find & replace).

import { project } from './state.js';
import { syncEditorToState, renderEditor, updateStats } from './ui_editor.js';


// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

let _matches  = [];  // [{ colIdx, dataIdx, start, end }]
let _matchIdx = -1;  // currently highlighted match (-1 = none)


// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────

/** Open the panel (or bring it to front if already open). */
export function openFindReplace() {
    const panel = _getOrBuildPanel();
    panel.style.display = 'flex';
    _refreshColCheckboxes();
    _recompute();
    // Put focus in the find input and select any existing text
    const findInput = document.getElementById('frFind');
    if (findInput) { findInput.focus(); findInput.select(); }
}

/** Close the panel and clear any highlights. */
export function closeFindReplace() {
    const panel = document.getElementById('findReplacePanel');
    if (panel) panel.style.display = 'none';
    _clearHighlight();
}

/** Call this when the active chapter changes while the panel is open. */
export function refreshIfOpen() {
    const panel = document.getElementById('findReplacePanel');
    if (panel && panel.style.display !== 'none') {
        _refreshColCheckboxes();
        _recompute();
    }
}


// ─────────────────────────────────────────────
//  PANEL CONSTRUCTION  (built once, reused)
// ─────────────────────────────────────────────

function _getOrBuildPanel() {
    let panel = document.getElementById('findReplacePanel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id        = 'findReplacePanel';
    panel.className = 'fr-panel';
    panel.innerHTML = `
        <div class="fr-header" id="frHeader">
            <span>Find &amp; Replace</span>
            <button class="fr-close" title="Close (Esc)">×</button>
        </div>
        <div class="fr-body">

            <div class="fr-row">
                <label class="fr-label" for="frFind">Find</label>
                <input id="frFind" class="fr-input" type="text"
                       autocomplete="off" spellcheck="false" placeholder="Search…">
                <span id="frCount" class="fr-count"></span>
            </div>

            <div class="fr-row">
                <label class="fr-label" for="frReplace">Replace</label>
                <input id="frReplace" class="fr-input" type="text"
                       autocomplete="off" spellcheck="false" placeholder="Replace with…">
            </div>

            <div class="fr-options">
                <label title="Case-sensitive search">
                    <input type="checkbox" id="frMatchCase"> Match case
                </label>
                <label title="Match whole words only">
                    <input type="checkbox" id="frWholeWord"> Whole word
                </label>
            </div>

            <div class="fr-section-label">Columns:</div>
            <div id="frColList" class="fr-col-list"></div>

            <div class="fr-actions">
                <button id="frFindPrev"    title="Find previous (Shift+Enter)">◀ Prev</button>
                <button id="frFindNext"    title="Find next (Enter)">Next ▶</button>
                <button id="frReplaceOne"  title="Replace current match">Replace</button>
                <button id="frReplaceAll"  title="Replace all in selected columns">Replace All</button>
            </div>

            <div id="frStatus" class="fr-status"></div>
        </div>
    `;

    document.body.appendChild(panel);

    // ── Event wiring ──────────────────────────────────────────────────────────

    panel.querySelector('.fr-close').onclick = closeFindReplace;

    const findInput = document.getElementById('frFind');
    findInput.addEventListener('input', () => { _recompute(); if (_matches.length) _goTo(0); });
    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); e.shiftKey ? _step(-1) : _step(1); }
        if (e.key === 'Escape') { e.preventDefault(); closeFindReplace(); }
    });

    const replaceInput = document.getElementById('frReplace');
    replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeFindReplace(); }
    });

    document.getElementById('frMatchCase').addEventListener('change', () => { _recompute(); if (_matches.length) _goTo(0); });
    document.getElementById('frWholeWord').addEventListener('change', () => { _recompute(); if (_matches.length) _goTo(0); });

    document.getElementById('frFindPrev').onclick   = () => _step(-1);
    document.getElementById('frFindNext').onclick   = () => _step(1);
    document.getElementById('frReplaceOne').onclick = _replaceOne;
    document.getElementById('frReplaceAll').onclick = _replaceAll;

    _makeDraggable(panel, document.getElementById('frHeader'));

    return panel;
}


// ─────────────────────────────────────────────
//  COLUMN CHECKBOXES
// ─────────────────────────────────────────────

function _refreshColCheckboxes() {
    const list = document.getElementById('frColList');
    if (!list) return;

    // Preserve which indices were checked before refresh
    const prevChecked = new Set(
        [...list.querySelectorAll('input[type=checkbox]')]
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.colIdx)
    );

    list.innerHTML = '';
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    pair.columns.forEach((col, i) => {
        const label = document.createElement('label');
        label.className = 'fr-col-check';
        label.title     = col.name ? `Col ${i + 1}: ${col.name}` : `Col ${i + 1} (no file)`;

        const cb        = document.createElement('input');
        cb.type         = 'checkbox';
        cb.dataset.colIdx = String(i);
        // Default: checked. Re-check if it was checked before, or if it's a fresh open.
        cb.checked      = (prevChecked.size === 0) ? true : prevChecked.has(String(i));
        cb.addEventListener('change', () => { _recompute(); if (_matches.length) _goTo(0); });

        const nameSpan        = document.createElement('span');
        nameSpan.className    = 'fr-col-check-label';
        nameSpan.innerText    = col.name || `Col ${i + 1}`;

        label.append(cb, nameSpan);
        list.appendChild(label);
    });
}

function _getSelectedColIdxs() {
    return [...document.querySelectorAll('#frColList input[type=checkbox]')]
        .filter(cb => cb.checked)
        .map(cb => parseInt(cb.dataset.colIdx, 10));
}


// ─────────────────────────────────────────────
//  MATCH ENGINE
// ─────────────────────────────────────────────

/**
 * Build a global RegExp from the current search parameters.
 * Returns null if the query is empty or invalid.
 */
function _buildRegex(query, matchCase, wholeWord) {
    if (!query) return null;
    try {
        let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) pattern = `\\b${pattern}\\b`;
        return new RegExp(pattern, matchCase ? 'g' : 'gi');
    } catch (e) {
        return null;
    }
}

/**
 * Recompute _matches from the current query + column selection.
 * Each match: { colIdx, dataIdx, start, end }
 */
function _recompute() {
    _matches  = [];
    _matchIdx = -1;

    const query     = document.getElementById('frFind')?.value  || '';
    const matchCase = document.getElementById('frMatchCase')?.checked || false;
    const wholeWord = document.getElementById('frWholeWord')?.checked || false;
    const colIdxs   = _getSelectedColIdxs();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair || !query) { _updateCountDisplay(query); _clearHighlight(); return; }

    const regex = _buildRegex(query, matchCase, wholeWord);
    if (!regex) { _updateCountDisplay(query); return; }

    for (const colIdx of colIdxs) {
        const col = pair.columns[colIdx];
        if (!col) continue;
        col.data.forEach((text, dataIdx) => {
            regex.lastIndex = 0;
            let m;
            while ((m = regex.exec(text)) !== null) {
                _matches.push({ colIdx, dataIdx, start: m.index, end: m.index + m[0].length });
                if (m[0].length === 0) regex.lastIndex++;  // prevent infinite loop on zero-width
            }
        });
    }

    _updateCountDisplay(query);
}

function _updateCountDisplay(query) {
    const countEl   = document.getElementById('frCount');
    const findInput = document.getElementById('frFind');
    if (!countEl) return;

    const hasQuery   = !!query;
    const hasMatches = _matches.length > 0;

    if (!hasQuery) {
        countEl.innerText    = '';
        if (findInput) { findInput.style.background = ''; findInput.style.borderColor = ''; }
    } else if (!hasMatches) {
        countEl.innerText    = 'no matches';
        countEl.style.color  = '#ef4444';
        if (findInput) { findInput.style.background = '#fef2f2'; findInput.style.borderColor = '#fca5a5'; }
    } else {
        const label = _matchIdx >= 0 ? `${_matchIdx + 1} / ${_matches.length}` : `${_matches.length} found`;
        countEl.innerText   = label;
        countEl.style.color = '#0f766e';
        if (findInput) { findInput.style.background = ''; findInput.style.borderColor = ''; }
    }
}


// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────

function _goTo(idx) {
    _clearHighlight();
    if (_matches.length === 0) return;

    _matchIdx = ((idx % _matches.length) + _matches.length) % _matches.length;
    const m   = _matches[_matchIdx];

    const wrapper = document.getElementById(`cell-wrapper-${m.colIdx}-${m.dataIdx}`);
    if (wrapper) {
        wrapper.classList.add('fr-active');
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    _updateCountDisplay(document.getElementById('frFind')?.value || '');
}

function _step(delta) {
    if (_matches.length === 0) return;
    const next = _matchIdx < 0
        ? (delta > 0 ? 0 : _matches.length - 1)
        : _matchIdx + delta;
    _goTo(next);
}

function _clearHighlight() {
    document.querySelectorAll('.cell-wrapper.fr-active')
        .forEach(el => el.classList.remove('fr-active'));
}


// ─────────────────────────────────────────────
//  REPLACE
// ─────────────────────────────────────────────

function _replaceOne() {
    // If no match is selected, try to highlight one first
    if (_matchIdx < 0) {
        _recompute();
        if (_matches.length > 0) { _goTo(0); return; }  // Show match, wait for second click
        return;
    }

    const query       = document.getElementById('frFind')?.value    || '';
    const replacement = document.getElementById('frReplace')?.value || '';
    const pair        = project.pairs.find(p => p.id === project.activePairId);
    if (!pair || !query) return;

    syncEditorToState(project.activePairId);

    const m   = _matches[_matchIdx];
    const col = pair.columns[m.colIdx];
    if (!col) return;

    // Splice in the replacement at the exact match offsets
    const original     = col.data[m.dataIdx];
    col.data[m.dataIdx] = original.slice(0, m.start) + replacement + original.slice(m.end);
    col.dirty = true;

    renderEditor();
    updateStats();

    // Recompute and advance to the next logical position
    const prevIdx = _matchIdx;
    _recompute();
    if (_matches.length > 0) {
        _goTo(Math.min(prevIdx, _matches.length - 1));
    } else {
        _clearHighlight();
    }

    _setStatus('Replaced 1 occurrence.');
}

function _replaceAll() {
    const query       = document.getElementById('frFind')?.value    || '';
    const replacement = document.getElementById('frReplace')?.value || '';
    const matchCase   = document.getElementById('frMatchCase')?.checked || false;
    const wholeWord   = document.getElementById('frWholeWord')?.checked || false;
    const colIdxs     = _getSelectedColIdxs();

    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair || !query) return;

    const regex = _buildRegex(query, matchCase, wholeWord);
    if (!regex) return;

    syncEditorToState(project.activePairId);

    let count = 0;
    for (const colIdx of colIdxs) {
        const col = pair.columns[colIdx];
        if (!col) continue;
        col.data = col.data.map(text => {
            regex.lastIndex = 0;
            // Using a function replacer avoids interpreting $& / $1 in replacement string
            return text.replace(regex, () => { count++; return replacement; });
        });
        if (count > 0) col.dirty = true;
    }

    renderEditor();
    updateStats();
    _clearHighlight();
    _recompute();

    _setStatus(count > 0
        ? `Replaced ${count} occurrence${count !== 1 ? 's' : ''}.`
        : 'No matches found.');
}


// ─────────────────────────────────────────────
//  STATUS BAR
// ─────────────────────────────────────────────

function _setStatus(msg) {
    const el = document.getElementById('frStatus');
    if (!el) return;
    el.innerText = msg;
    setTimeout(() => { if (el.innerText === msg) el.innerText = ''; }, 3000);
}


// ─────────────────────────────────────────────
//  DRAG
// ─────────────────────────────────────────────

function _makeDraggable(panel, handle) {
    let startX, startY, origLeft, origTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;  // don't drag when clicking × button
        e.preventDefault();
        startX   = e.clientX;
        startY   = e.clientY;
        const r  = panel.getBoundingClientRect();
        origLeft = r.left;
        origTop  = r.top;
        handle.style.cursor = 'grabbing';

        const onMove = (ev) => {
            panel.style.left  = (origLeft + ev.clientX - startX) + 'px';
            panel.style.top   = (origTop  + ev.clientY - startY) + 'px';
            panel.style.right = 'auto';
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
