import { project } from './state.js';
import { loadAppState, getDirectoryHandle, saveDirectoryHandle } from './file_system.js';

// --- restore the session and try to reconnect the files
export async function restoreSession() {
    const savedState = await loadAppState();
    if (!savedState) return false;

    // 1. Restore Data
    project.name = savedState.name || "Untitled Project";
    project.activePairId = savedState.activePairId;
    project.pairs = savedState.pairs.map(p => ({
        ...p,
        leftHandle: null,  // Handles are lost on reload
        rightHandle: null,
        leftDirty: false,  // Reset dirty flags
        rightDirty: false,
        leftExternalChange: false,
        rightExternalChange: false
    }));

    // 2. Try Auto-Relink (Silent)
    // We try to grab the folder handle again. 
    // Note: The browser might require a click to grant permission again, 
    // so we just try silently. If it fails, dots stay gray until user clicks something.
    try {
        const dirHandle = await getDirectoryHandle();
        if (dirHandle) {
            const opts = { mode: 'readwrite' };
            // Check if we still have permission (rare on reload, but possible)
            if ((await dirHandle.queryPermission(opts)) === 'granted') {
                await scanAndLink(dirHandle);
            }
        }
    } catch (e) {
        console.log("Auto-relink waiting for user gesture");
    }

    return true;
}

export function createNewPair() {
    const id = Date.now().toString();
    const newPair = {
        id: id,
        name: `Chapter ${project.pairs.length + 1}`,
        leftData: [],
        rightData: [],
        leftHandle: null,
        rightHandle: null,
        leftDirty: false,  
        rightDirty: false,
        leftLastModified: 0,
        rightLastModified: 0, 
        leftExternalChange: false,
        rightExternalChange: false 
    };
    project.pairs.push(newPair);
    return id; // Return ID so Main can switch to it
}

export function deletePair(id) {
    project.pairs = project.pairs.filter(p => p.id !== id);
    if(project.activePairId === id) {
        project.activePairId = null;
    }
}

export function saveProject() {
    const projectData = {
        name: project.name,
        pairs: project.pairs.map(p => ({
            id: p.id,
            name: p.name,
            leftName: p.leftName || null,
            rightName: p.rightName || null,
            leftData: p.leftData,
            rightData: p.rightData
        }))
    };

    const filename = (project.name || "project").replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".json";
    const blob = new Blob([JSON.stringify(projectData, null, 2)], {type: "application/json"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}

export async function loadProject(file) {
    if (!file) return { success: false };

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                project.name = data.name || "Untitled Project";
                project.pairs = data.pairs.map(p => ({
                    ...p,
                    leftHandle: null,
                    rightHandle: null,
                    leftData: p.leftData || [],
                    rightData: p.rightData || [],
                    leftDirty: false,
                    rightDirty: false,
                    leftLastModified: 0,
                    rightLastModified: 0,
                    leftExternalChange: false,
                    rightExternalChange: false
                }));

                // Auto-Relink Attempt
                let dirHandle = await getDirectoryHandle();
                let linkedCount = 0;

                // If saved handle exists, verify permission
                if (dirHandle) {
                    const opts = { mode: 'readwrite' };
                    if ((await dirHandle.queryPermission(opts)) !== 'granted') {
                        if ((await dirHandle.requestPermission(opts)) !== 'granted') {
                            dirHandle = null;
                        }
                    }
                }

                // If no valid handle, ask user (optional, returns null if cancelled)
                if (!dirHandle) {
                   // We return 'needsFolder: true' to tell Main.js to ask the user
                   resolve({ success: true, needsFolder: true });
                   return;
                }

                // If we have a handle, scan it
                linkedCount = await scanAndLink(dirHandle);
                resolve({ success: true, linkedCount: linkedCount });

            } catch (err) {
                console.error(err);
                resolve({ success: false, error: err.message });
            }
        };
        reader.readAsText(file);
    });
}

export async function relinkFolder() {
    try {
        const dirHandle = await window.showDirectoryPicker();
        await saveDirectoryHandle(dirHandle); // Save for next time
        const count = await scanAndLink(dirHandle);
        return { success: true, count: count };
    } catch (err) {
        return { success: false, error: "User cancelled" };
    }
}

// Helper function (Internal)
async function scanAndLink(dirHandle) {
    let matches = 0;
    for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        for (const pair of project.pairs) {
            // Check Left
            if (pair.leftName === entry.name) { 
                pair.leftHandle = entry; 
                const file = await entry.getFile();
                pair.leftLastModified = file.lastModified;
                matches++; 
            }
            // Check Right
            if (pair.rightName === entry.name) { 
                pair.rightHandle = entry; 
                const file = await entry.getFile();
                pair.rightLastModified = file.lastModified;
                matches++; 
            }
        }
    }
    return matches;
}