// js/ui_shortcuts.js
// Keyboard-shortcut settings panel.
// Shows all configurable shortcuts grouped by category.
// Click ✎ on any row to enter capture mode and press a new key combo.

import * as Shortcuts from './shortcuts.js';


// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

let _panel           = null;  // the DOM panel element (persists between open/close)
let _captureListener = null;  // active keydown capture handler, or null


// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────

export function openShortcutsPanel() {
    if (!_panel) {
        _panel = _buildPanel();
        document.body.appendChild(_panel);
    }
    _panel.style.display = 'flex';
    _refreshPanel();
}

export function closeShortcutsPanel() {
    _stopCapture();
    if (_panel) _panel.style.display = 'none';
}


// ─────────────────────────────────────────────
//  PANEL SHELL
// ─────────────────────────────────────────────

function _buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'sk-panel';
    panel.id        = 'shortcutsPanel';

    // ── Header (drag handle) ──────────────────
    const header = document.createElement('div');
    header.className = 'sk-header';

    const title = document.createElement('span');
    title.textContent = '⌨ Keyboard Shortcuts';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className   = 'sk-close';
    closeBtn.textContent = '×';
    closeBtn.title       = 'Close';
    closeBtn.onclick     = closeShortcutsPanel;
    header.appendChild(closeBtn);

    // ── Body (scrollable list) ────────────────
    const body = document.createElement('div');
    body.className = 'sk-body';
    body.id        = 'skBody';

    // ── Footer ────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'sk-footer';

    const resetBtn = document.createElement('button');
    resetBtn.className   = 'sk-reset-btn';
    resetBtn.textContent = 'Reset all to defaults';
    resetBtn.onclick     = _onReset;
    footer.appendChild(resetBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);

    _makeDraggable(panel, header);
    return panel;
}


// ─────────────────────────────────────────────
//  BODY RENDER
// ─────────────────────────────────────────────

function _refreshPanel() {
    const body = document.getElementById('skBody');
    if (!body) return;
    body.innerHTML = '';

    const shortcuts = Shortcuts.getShortcuts();

    // Group shortcuts by category in the declared group order
    const grouped = {};
    for (const [id, def] of Object.entries(shortcuts)) {
        const g = def.group || 'Other';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push({ id, def });
    }

    // Render groups in canonical order; append any unlisted groups at the end
    const allGroups = [...Shortcuts.SHORTCUT_GROUPS,
                       ...Object.keys(grouped).filter(g => !Shortcuts.SHORTCUT_GROUPS.includes(g))];

    for (const group of allGroups) {
        const items = grouped[group];
        if (!items || items.length === 0) continue;

        const groupLabel = document.createElement('div');
        groupLabel.className   = 'sk-group-label';
        groupLabel.textContent = group;
        body.appendChild(groupLabel);

        for (const { id, def } of items) {
            body.appendChild(_buildRow(id, def));
        }
    }
}

function _buildRow(actionId, def) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    row.id        = `sk-row-${actionId}`;

    const label = document.createElement('span');
    label.className   = 'sk-action-label';
    label.textContent = def.label;

    const chip = document.createElement('span');
    chip.className   = 'sk-shortcut-chip';
    chip.textContent = Shortcuts.formatShortcut(def);

    const editBtn = document.createElement('button');
    editBtn.className   = 'sk-edit-btn';
    editBtn.title       = 'Remap this shortcut';
    editBtn.textContent = '✎';
    editBtn.onclick     = () => _startCapture(actionId);

    row.appendChild(label);
    row.appendChild(chip);
    row.appendChild(editBtn);
    return row;
}


// ─────────────────────────────────────────────
//  CAPTURE MODE
// ─────────────────────────────────────────────

function _startCapture(actionId) {
    _stopCapture();   // cancel any in-progress capture first

    const row = document.getElementById(`sk-row-${actionId}`);
    if (!row) return;

    // Switch row to capture UI
    row.innerHTML = '';
    row.classList.add('sk-row-capturing');

    const label = document.createElement('span');
    label.className   = 'sk-action-label';
    label.textContent = Shortcuts.getShortcuts()[actionId]?.label ?? actionId;

    const captureChip = document.createElement('span');
    captureChip.className   = 'sk-shortcut-chip sk-capturing';
    captureChip.textContent = 'Press shortcut…';

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'sk-edit-btn';
    cancelBtn.title       = 'Cancel';
    cancelBtn.textContent = '✕';
    cancelBtn.onclick     = _stopCapture;

    row.appendChild(label);
    row.appendChild(captureChip);
    row.appendChild(cancelBtn);

    // Intercept keydown at capture phase so it doesn't fire any other shortcut
    _captureListener = (e) => _onCapture(e, actionId, captureChip);
    document.addEventListener('keydown', _captureListener, { capture: true });
}

function _stopCapture() {
    if (_captureListener) {
        document.removeEventListener('keydown', _captureListener, { capture: true });
        _captureListener = null;
    }
    _refreshPanel();
}

function _onCapture(e, actionId, captureChip) {
    // Escape = cancel
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _stopCapture();
        return;
    }

    // Ignore bare modifier key presses — wait for a real key
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;

    e.preventDefault();
    e.stopPropagation();

    const newDef = {
        key:   e.key.toLowerCase(),
        meta:  e.metaKey,
        ctrl:  e.ctrlKey,
        shift: e.shiftKey,
        alt:   e.altKey,
    };

    // Update the chip to show what was pressed
    captureChip.textContent = Shortcuts.formatShortcut(newDef);

    // Check for conflicts
    const conflictId = Shortcuts.findConflict(newDef, actionId);
    if (conflictId) {
        const conflictLabel = Shortcuts.getShortcuts()[conflictId]?.label ?? conflictId;
        captureChip.classList.add('sk-conflict');

        // Remove the capture listener — user must explicitly confirm or cancel
        document.removeEventListener('keydown', _captureListener, { capture: true });
        _captureListener = null;

        // Rebuild the end of the row with conflict UI
        const row = document.getElementById(`sk-row-${actionId}`);
        const existingCancel = row?.querySelector('.sk-edit-btn');

        const warning = document.createElement('span');
        warning.className   = 'sk-conflict-msg';
        warning.textContent = `Conflicts: "${conflictLabel}"`;

        const useBtn = document.createElement('button');
        useBtn.className   = 'sk-use-btn';
        useBtn.textContent = 'Use anyway';
        useBtn.onclick     = () => _commitShortcut(actionId, newDef);

        const cancelBtn2 = document.createElement('button');
        cancelBtn2.className   = 'sk-edit-btn';
        cancelBtn2.title       = 'Cancel';
        cancelBtn2.textContent = '✕';
        cancelBtn2.onclick     = _stopCapture;

        existingCancel?.replaceWith(warning);
        row?.appendChild(useBtn);
        row?.appendChild(cancelBtn2);
    } else {
        // No conflict — commit immediately
        _commitShortcut(actionId, newDef);
    }
}

async function _commitShortcut(actionId, newDef) {
    _stopCapture();   // removes listener and calls _refreshPanel at end
    const current = Shortcuts.getShortcuts();
    const updated  = { ...current };
    updated[actionId] = { ...current[actionId], ...newDef };
    await Shortcuts.saveShortcuts(updated);
    _refreshPanel();  // re-render with new values
}

async function _onReset() {
    if (!confirm('Reset all keyboard shortcuts to defaults?')) return;
    await Shortcuts.saveShortcuts(structuredClone(Shortcuts.DEFAULT_SHORTCUTS));
    _refreshPanel();
}


// ─────────────────────────────────────────────
//  DRAG
// ─────────────────────────────────────────────

function _makeDraggable(panel, handle) {
    let ox = 0, oy = 0, startX = 0, startY = 0;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        ox = rect.left;
        oy = rect.top;
        handle.style.cursor = 'grabbing';

        const onMove = (me) => {
            panel.style.left  = (ox + me.clientX - startX) + 'px';
            panel.style.top   = (oy + me.clientY - startY) + 'px';
            panel.style.right = 'auto';
        };
        const onUp = () => {
            handle.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
        e.preventDefault();
    });
}
