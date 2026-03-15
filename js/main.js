// js/main.js

import { project, APP_VERSION } from './state.js';
import * as FileSystem      from './file_system.js';
import * as ProjectManager  from './project_manager.js';
import * as SidebarUI       from './ui_sidebar.js';
import * as EditorUI        from './ui_editor.js';
import * as FindReplace     from './ui_find_replace.js';
import * as PrintUI         from './ui_print.js';
import * as Shortcuts       from './shortcuts.js';
import * as ShortcutsUI     from './ui_shortcuts.js';


// ─────────────────────────────────────────────
//  INITIALIZATION
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

    // ── Load user shortcut preferences from IndexedDB ───────────────────
    await Shortcuts.loadShortcuts();

    // ── Static button wiring ────────────────────────────────────────────
    document.getElementById('btnAddPair').addEventListener('click', handleNewPair);
    document.getElementById('btnRefresh')?.addEventListener('click', handleRefresh);
    document.getElementById('btnAddCol')?.addEventListener('click', handleAddColumn);
    document.getElementById('btnRemoveCol')?.addEventListener('click', handleRemoveColumn);

    document.getElementById('appVersion').innerText = APP_VERSION;

    // ── Initial render ──────────────────────────────────────────────────
    refreshAllUI();

    // ── Poll for external file changes every 2 s ────────────────────────
    setInterval(async () => {
        const changed = await FileSystem.checkForExternalChanges();
        if (changed) EditorUI.updateStats();
    }, 2000);

    // ── Width slider ────────────────────────────────────────────────────
    const slider = document.getElementById('widthSlider');
    const grid   = document.getElementById('grid');

    if (slider && grid) {
        const setWidth = (val) => {
            grid.style.maxWidth = val + '%';
            slider.value = val;
        };
        const savedWidth = localStorage.getItem('editorWidth') || 95;
        setWidth(savedWidth);
        slider.addEventListener('input', (e) => {
            setWidth(e.target.value);
            localStorage.setItem('editorWidth', e.target.value);
        });
    }

    // ── Session restore ─────────────────────────────────────────────────
    const restored = await ProjectManager.restoreSession();
    if (restored) {
        refreshAllUI();
        console.log("Session restored!");
    }

    // ── Restore project save-status label ────────────────────────────────
    // Check if we have a stored project file handle so we can show its name.
    {
        const ph = await FileSystem.getProjectFileHandle();
        if (ph) updateProjectSaveStatus(ph.name);
        else    updateProjectSaveStatus(null);
    }

    // ── Auto-save to IndexedDB every 5 s (fast, silent) ─────────────────
    setInterval(() => FileSystem.saveAppState(), 5000);

    // ── Auto-save to project file every 2 min ───────────────────────────
    // Only fires if the project file handle is stored and permission is live.
    // Never shows a dialog — safe even when the tab is in the background.
    setInterval(async () => {
        if (project.pairs.length === 0) return;
        EditorUI.syncEditorToState(project.activePairId);
        const result = await ProjectManager.autoSaveProject();
        if (result.success) showSaveToast('✓ Auto-saved', 1800);
    }, 2 * 60 * 1000);

    // ── Sidebar collapse toggle ──────────────────────────────────────────
    const sidebar          = document.querySelector('.sidebar');
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');

    if (sidebar && btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            sidebar.classList.add('collapsed');
        }
    }

    // ── Save state on tab hide ───────────────────────────────────────────
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') FileSystem.saveAppState();
    });

    // ── Global keyboard shortcuts ────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        const mod    = e.metaKey || e.ctrlKey;
        const inCell = document.activeElement?.contentEditable === 'true';

        // Cmd+S / Ctrl+S — save project (hardcoded; accepts either modifier key)
        // Only fires when cursor is NOT in a text cell; the cell's own keydown
        // handler intercepts it first for per-column saves.
        if (mod && e.key === 's' && !inCell) {
            e.preventDefault();
            window.saveProject();
            return;
        }

        // Cmd+Z / Ctrl+Z — structural undo (hardcoded; skip inside text cells)
        if (mod && e.key === 'z' && !inCell) {
            e.preventDefault();
            EditorUI.undoLastOp();
            return;
        }

        // ── Configurable shortcuts (loaded from IndexedDB via shortcuts.js) ──

        if (Shortcuts.matches(e, 'print')) {
            e.preventDefault();
            PrintUI.openPrintDialog();
            return;
        }

        if (Shortcuts.matches(e, 'find') || Shortcuts.matches(e, 'find-alt')) {
            e.preventDefault();
            FindReplace.openFindReplace();
            return;
        }

        if (Shortcuts.matches(e, 'shortcuts')) {
            e.preventDefault();
            ShortcutsUI.openShortcutsPanel();
            return;
        }

        // Navigation shortcuts — intentionally fire even inside text cells
        if (Shortcuts.matches(e, 'nav-left')) {
            e.preventDefault();
            EditorUI.navigateCell('left');
            return;
        }
        if (Shortcuts.matches(e, 'nav-right')) {
            e.preventDefault();
            EditorUI.navigateCell('right');
            return;
        }
        if (Shortcuts.matches(e, 'nav-up')) {
            e.preventDefault();
            EditorUI.navigateCell('up');
            return;
        }
        if (Shortcuts.matches(e, 'nav-down')) {
            e.preventDefault();
            EditorUI.navigateCell('down');
            return;
        }

        // Escape — close any open floating panel (if focus is outside it)
        if (e.key === 'Escape') {
            const frPanel = document.getElementById('findReplacePanel');
            if (frPanel?.style.display !== 'none' && !frPanel?.contains(document.activeElement)) {
                FindReplace.closeFindReplace();
            }
            const skPanel = document.getElementById('shortcutsPanel');
            if (skPanel?.style.display !== 'none' && !skPanel?.contains(document.activeElement)) {
                ShortcutsUI.closeShortcutsPanel();
            }
        }
    });

    // ── Sync state before printing so the printed content is up to date ──
    window.addEventListener('beforeprint', () => {
        if (project.activePairId) EditorUI.syncEditorToState(project.activePairId);
    });
});


// ─────────────────────────────────────────────
//  CONTROLLER / ORCHESTRATOR FUNCTIONS
// ─────────────────────────────────────────────

function refreshAllUI() {
    SidebarUI.renderSidebar();
    // Always re-attach handlers after every render — the callback must call
    // refreshAllUI() so that the newly-created DOM nodes for other columns
    // also get their listeners re-wired (fixes: click on col 2/3 does nothing
    // after col 1 was linked, because renderSidebar replaces the DOM nodes).
    SidebarUI.attachAllDropHandlers(() => refreshAllUI());

    EditorUI.renderEditor();
    EditorUI.updateToolbar();
    EditorUI.updateStats();
}

// ── Chapter (pair) handlers ──────────────────────────────────────────────────

function handleNewPair() {
    const newId = ProjectManager.createNewPair();
    project.activePairId = newId;
    refreshAllUI();
}

async function handleRefresh() {
    if (!project.activePairId) return;

    const btn = document.getElementById('btnRefresh');
    if (btn) { btn.disabled = true; btn.innerText = '↻ …'; }

    // Step 1: Reconnect any columns that have a stored IndexedDB handle but
    // lost their live in-memory reference (e.g. after a page reload where the
    // browser needs to re-prompt for permission). This is what the old "Relink"
    // button used to do — now it's folded in automatically here.
    await ProjectManager.relinkPair(project.activePairId);

    // Step 2: Sync editor DOM → state so we don't lose unsaved typing.
    EditorUI.syncEditorToState(project.activePairId);

    // Step 3: Re-read the latest file contents from disk for all linked columns.
    const result = await FileSystem.refreshActivePair();

    if (result.success) {
        EditorUI.renderEditor();
        EditorUI.updateStats();
    }

    if (btn) { btn.disabled = false; btn.innerText = '↻ Refresh'; }
}

// ── Column +/− handlers ──────────────────────────────────────────────────────

function handleAddColumn() {
    if (!project.activePairId) return;
    EditorUI.syncEditorToState(project.activePairId);
    EditorUI.pushUndo();
    const added = ProjectManager.addColumn(project.activePairId);
    if (added) refreshAllUI();
}

function handleRemoveColumn() {
    if (!project.activePairId) return;
    const pair    = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    // Warn if last column has content or a linked file
    const lastCol = pair.columns[pair.columns.length - 1];
    const hasData = lastCol.data.some(d => d.trim()) || !!lastCol.name;
    if (hasData && !confirm("The last column has content or a linked file. Remove it anyway?")) return;

    EditorUI.syncEditorToState(project.activePairId);
    EditorUI.pushUndo();
    const removed = ProjectManager.removeColumn(project.activePairId);
    if (removed) refreshAllUI();
}

// ── Delete column handler (any column, not just last) ────────────────────────

async function handleDeleteColumn(pairId, colIdx) {
    const pair = project.pairs.find(p => p.id === pairId);
    if (!pair) return;

    const col      = pair.columns[colIdx];
    const label    = col.name ? ` "${col.name}"` : ` ${colIdx + 1}`;
    const hasData  = col.data.some(d => d.trim()) || !!col.name;

    if (hasData && !confirm(
        `Delete column${label}?\n\nAll text and the file link will be permanently removed. This cannot be undone.`
    )) return;

    // Sync editor DOM → state before deleting so we read the latest content
    EditorUI.syncEditorToState(pairId);

    const ok = await ProjectManager.deleteColumn(pairId, colIdx);
    if (ok) refreshAllUI();
}

// ── Download column content ───────────────────────────────────────────────────

function handleDownloadColumn(colIdx) {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return;

    const col = pair.columns[colIdx];
    if (!col) return;

    // Sync first so we get the very latest content, including unsaved typing
    EditorUI.syncEditorToState(project.activePairId);

    const content  = FileSystem.serializeFileContent(col.data);
    const filename = col.name || `column_${colIdx + 1}.txt`;

    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Unlink handler ───────────────────────────────────────────────────────────

async function handleUnlinkFile(pairId, colIdx) {
    const pair = project.pairs.find(p => p.id === pairId);
    if (!pair) return;

    const col = pair.columns[colIdx];
    if (!col) return;

    // Clear all column state (keep the column itself, just wipe its content)
    col.handle         = null;
    col.name           = null;
    col.data           = [''];
    col.spans          = [];
    col.backups        = [];
    col.dirty          = false;
    col.lastModified   = 0;
    col.externalChange = false;

    // Remove the stored IndexedDB handle so it doesn't get re-linked on reload
    await FileSystem.removeFileHandle(pairId, colIdx);

    refreshAllUI();
}

// ── Save handler ─────────────────────────────────────────────────────────────

async function handleSave(colIdx) {
    const result = await FileSystem.saveActiveFile(colIdx);
    if (result.success) {
        SidebarUI.renderSidebar();
        EditorUI.updateToolbar();
        EditorUI.updateStats();
    } else if (result.error) {
        alert("Save failed: " + result.error);
    }
}


// ─────────────────────────────────────────────
//  TOAST NOTIFICATION
// ─────────────────────────────────────────────

/**
 * Show a brief toast notification at the bottom-right of the screen.
 * Creates the element on first call and reuses it thereafter.
 *
 * @param {string} msg        - Message to display
 * @param {number} durationMs - How long to show it (default 2000 ms)
 */
function showSaveToast(msg, durationMs = 2000) {
    let toast = document.getElementById('_saveToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_saveToast';
        toast.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px',
            'background:#1e293b', 'color:#f8fafc',
            'padding:8px 18px', 'border-radius:8px',
            'font-size:0.82rem', 'font-family:-apple-system,sans-serif',
            'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
            'z-index:9999', 'pointer-events:none',
            'transition:opacity 0.4s ease', 'opacity:0'
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, durationMs);
}


/**
 * Update the small "project file" label in the sidebar header.
 * @param {string|null} filename  - e.g. "my_project.json", or null to clear
 */
function updateProjectSaveStatus(filename) {
    const el = document.getElementById('projectSaveStatus');
    if (!el) return;
    if (!filename) {
        el.textContent = '📄 Not saved to file yet';
        el.style.color = '#94a3b8';
    } else {
        el.textContent = `📁 ${filename}`;
        el.style.color = '#475569';
    }
}


// ─────────────────────────────────────────────
//  WINDOW GLOBALS  (called from HTML / editor)
// ─────────────────────────────────────────────

window.saveProject = async () => {
    // Sync editor DOM → state first so the saved file has the latest content
    if (project.activePairId) EditorUI.syncEditorToState(project.activePairId);

    const result = await ProjectManager.saveProject();

    if (result.success) {
        showSaveToast(`💾 Saved: ${result.filename}`);
        updateProjectSaveStatus(result.filename);
    } else if (result.error) {
        alert('Save failed: ' + result.error);
    }
    // result.cancelled → user dismissed picker, do nothing
};
window.closeProject = async () => {
    if (!confirm("Close project? Unsaved changes will be lost.")) return;
    project.pairs        = [];
    project.activePairId = null;
    project.name         = "Untitled Project";
    // Clear stored project file handle so a fresh project won't overwrite it
    await FileSystem.removeProjectFileHandle();
    updateProjectSaveStatus(null);
    refreshAllUI();
};

window.loadProject = async (input) => {
    const result = await ProjectManager.loadProject(input.files[0]);
    if (result.success) {
        // The old project file handle was cleared in loadProject().
        // Show the user that the file association needs to be (re-)established.
        updateProjectSaveStatus(null);

        if (result.needsFolder) {
            if (confirm("Project loaded! Click OK to select the source folder for auto-linking.")) {
                const link = await ProjectManager.relinkFolder();
                if (link.success) alert(`Linked ${link.count} files.`);
            }
        } else if (result.linkedCount !== undefined) {
            alert(`Project loaded & ${result.linkedCount} files linked automatically.`);
        }
        if (project.pairs.length > 0) project.activePairId = project.pairs[0].id;
        refreshAllUI();
    }
    input.value = '';
};

window.deletePair = (id) => {
    if (confirm("Delete this chapter?")) {
        ProjectManager.deletePair(id);
        refreshAllUI();
    }
};

window.setActivePair = (id) => {
    if (project.activePairId) EditorUI.syncEditorToState(project.activePairId);
    project.activePairId = id;
    refreshAllUI();
    FindReplace.refreshIfOpen();   // Keep column checkboxes in sync when chapter changes
};

window.updatePairName = (id, val) => SidebarUI.updatePairName(id, val);

window.updateProjectName = (newName) => { project.name = newName; };

// Grid control globals (called inline from rendered HTML)
window.modifyGrid      = EditorUI.modifyGrid;
window.toggleBackupUI  = EditorUI.toggleBackupUI;
window.triggerSave     = handleSave;        // Ctrl+S in cells passes colIdx
window.mergeCellDown   = EditorUI.mergeCellDown;
window.splitCell       = EditorUI.splitCell;
window.toggleColHidden = EditorUI.toggleColHidden;
window.unlinkFile      = handleUnlinkFile;
window.deleteColumn    = handleDeleteColumn;
window.downloadColumn  = handleDownloadColumn;
window.openPrintDialog    = PrintUI.openPrintDialog;
window.closePrintDialog   = PrintUI.closePrintDialog;
window.openShortcutsPanel = ShortcutsUI.openShortcutsPanel;
