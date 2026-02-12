import { project, APP_VERSION } from './state.js';
import * as FileSystem from './file_system.js';
import * as ProjectManager from './project_manager.js';
import * as SidebarUI from './ui_sidebar.js';
import * as EditorUI from './ui_editor.js';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    
    // Hook up Static Buttons
    document.getElementById('btnAddPair').addEventListener('click', handleNewPair);
    document.getElementById('btnSaveLeft').addEventListener('click', () => handleSave('left'));
    document.getElementById('btnSaveRight').addEventListener('click', () => handleSave('right'));
    
    const refreshBtn = document.getElementById('btnRefresh');
    if(refreshBtn) refreshBtn.addEventListener('click', handleRefresh);

    document.getElementById('appVersion').innerText = APP_VERSION;

    // Initial Render
    refreshAllUI();

    // Start Polling for Changes
    setInterval(async () => {
        const changed = await FileSystem.checkForExternalChanges();
        if (changed) {
            EditorUI.updateStats(); // Only update dots, don't re-render whole grid
        }
    }, 2000);

    // View Toggle
    const toggleBtn = document.getElementById('btnToggleView');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const grid = document.getElementById('grid');
            grid.classList.toggle('document-mode');
            
            // Optional: Save preference
            const isDocMode = grid.classList.contains('document-mode');
            localStorage.setItem('viewMode', isDocMode ? 'document' : 'grid');
        });

        // Load saved preference
        if (localStorage.getItem('viewMode') === 'document') {
            document.getElementById('grid').classList.add('document-mode');
        }
    } else {
        console.error("View Toggle Button not found in HTML!");
    }

    // --- WIDTH SLIDER LOGIC ---
    const slider = document.getElementById('widthSlider');
    const grid = document.getElementById('grid');

    if (slider && grid) {
        // 1. Function to apply width
        const setWidth = (val) => {
            grid.style.maxWidth = val + '%';
            slider.value = val; // Sync slider UI
        };

        // 2. Load saved preference (default to 95% if not set)
        const savedWidth = localStorage.getItem('editorWidth') || 95;
        setWidth(savedWidth);

        // 3. Listen for changes
        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            setWidth(val);
            localStorage.setItem('editorWidth', val);
        });
    }

});

// --- CONTROLLER FUNCTIONS (Orchestrators) ---

function refreshAllUI() {
    SidebarUI.renderSidebar();
    SidebarUI.attachAllDropHandlers((pairId) => {
        // Callback when a file is dropped
        if (project.activePairId === pairId) {
            EditorUI.renderEditor();
            EditorUI.updateToolbar();
            EditorUI.updateStats();
        }
        SidebarUI.renderSidebar(); // Update border colors
    });
    
    EditorUI.renderEditor();
    EditorUI.updateToolbar();
    EditorUI.updateStats();
}

// Handler for "New Chapter"
function handleNewPair() {
    const newId = ProjectManager.createNewPair();
    project.activePairId = newId;
    refreshAllUI();
}

// Handler for "Save"
async function handleSave(side) {
    const result = await FileSystem.saveActiveFile(side);
    if (result.success) {
        SidebarUI.renderSidebar(); // In case name changed (Save As)
        EditorUI.updateToolbar();
        EditorUI.updateStats(); // Turn dot green
    } else if (result.error) {
        alert("Save failed: " + result.error);
    }
}

// Handler for "Refresh"
async function handleRefresh() {
    // Before refreshing, sync current edits to state so we don't lose them if we cancel
    if(project.activePairId) EditorUI.syncEditorToState(project.activePairId);

    const result = await FileSystem.refreshActivePair();
    if (result.success) {
        EditorUI.renderEditor();
        EditorUI.updateStats();
    }
}

// --- EXPOSE TO WINDOW (For HTML onclicks) ---

window.saveProject = ProjectManager.saveProject;

window.loadProject = async (input) => {
    const result = await ProjectManager.loadProject(input.files[0]);
    if (result.success) {
        // Handle Auto-Relink UI flow
        if (result.needsFolder) {
            if (confirm("Project loaded! Click OK to select source folder for auto-linking.")) {
                const linkResult = await ProjectManager.relinkFolder();
                if (linkResult.success) alert(`Linked ${linkResult.count} files.`);
            }
        } else if (result.linkedCount !== undefined) {
            alert(`Project loaded & ${result.linkedCount} files linked automatically.`);
        }

        // Set active pair to first one
        if (project.pairs.length > 0) project.activePairId = project.pairs[0].id;
        refreshAllUI();
    }
    input.value = ''; // Reset input
};

window.closeProject = () => {
    if(confirm("Close project? Unsaved changes lost.")) {
        project.pairs = [];
        project.activePairId = null;
        project.name = "Untitled Project";
        refreshAllUI();
    }
};

window.deletePair = (id) => {
    if(confirm("Delete this chapter?")) {
        ProjectManager.deletePair(id);
        refreshAllUI();
    }
};

window.setActivePair = (id) => {
    // Save current state before switching
    if (project.activePairId) EditorUI.syncEditorToState(project.activePairId);
    
    project.activePairId = id;
    refreshAllUI();
};

window.updatePairName = (id, val) => {
    SidebarUI.updatePairName(id, val);
    // No need to full re-render
};

// Grid Controls
window.modifyGrid = EditorUI.modifyGrid;
window.triggerSave = handleSave; // For Ctrl+S shortcut

window.updateProjectName = (newName) => {
    project.name = newName;
};