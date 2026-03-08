// js/main.js

import { project, APP_VERSION } from './state.js';
import * as FileSystem      from './file_system.js';
import * as ProjectManager  from './project_manager.js';
import * as SidebarUI       from './ui_sidebar.js';
import * as EditorUI        from './ui_editor.js';
// mergeCellDown, splitCell, pushUndo, undoLastOp, toggleColHidden imported via EditorUI.*


// ─────────────────────────────────────────────
//  INITIALIZATION
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

    // ── Static button wiring ────────────────────────────────────────────
    document.getElementById('btnAddPair').addEventListener('click', handleNewPair);
    document.getElementById('btnRefresh')?.addEventListener('click', handleRefresh);
    document.getElementById('btnRelink')?.addEventListener('click', handleRelink);
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

    // ── Auto-save every 5 s ─────────────────────────────────────────────
    setInterval(() => FileSystem.saveAppState(), 5000);

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

    // ── Undo: Cmd+Z / Ctrl+Z (skip when editing text in a cell) ─────────
    document.addEventListener('keydown', (e) => {
        if (!((e.metaKey || e.ctrlKey) && e.key === 'z')) return;
        const active = document.activeElement;
        // Let the browser handle native text undo inside contenteditable cells
        if (active && active.contentEditable === 'true') return;
        e.preventDefault();
        EditorUI.undoLastOp();
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
    if (project.activePairId) EditorUI.syncEditorToState(project.activePairId);
    const result = await FileSystem.refreshActivePair();
    if (result.success) {
        EditorUI.renderEditor();
        EditorUI.updateStats();
    }
}

async function handleRelink() {
    const btn = document.getElementById('btnRelink');
    if (btn) { btn.disabled = true; btn.innerText = '🔗 Linking…'; }

    const count = await ProjectManager.relinkAllFiles();
    refreshAllUI();

    if (btn) { btn.disabled = false; btn.innerText = '🔗 Relink'; }
    if (count === 0) {
        alert("No stored file handles found.\nTry dropping or clicking a file zone in the sidebar.");
    }
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
//  WINDOW GLOBALS  (called from HTML / editor)
// ─────────────────────────────────────────────

window.saveProject  = ProjectManager.saveProject;
window.closeProject = () => {
    if (!confirm("Close project? Unsaved changes will be lost.")) return;
    project.pairs        = [];
    project.activePairId = null;
    project.name         = "Untitled Project";
    refreshAllUI();
};

window.loadProject = async (input) => {
    const result = await ProjectManager.loadProject(input.files[0]);
    if (result.success) {
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
};

window.updatePairName = (id, val) => SidebarUI.updatePairName(id, val);

window.updateProjectName = (newName) => { project.name = newName; };

// Grid control globals (called inline from rendered HTML)
window.modifyGrid     = EditorUI.modifyGrid;
window.toggleBackupUI = EditorUI.toggleBackupUI;
window.triggerSave    = handleSave;        // Ctrl+S in cells passes colIdx
window.mergeCellDown  = EditorUI.mergeCellDown;
window.splitCell      = EditorUI.splitCell;
window.toggleColHidden = EditorUI.toggleColHidden;
window.unlinkFile      = handleUnlinkFile;
