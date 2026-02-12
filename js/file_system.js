import { project, APP_CONSTANTS } from './state.js';

// --- DATABASE HELPERS ---
function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(APP_CONSTANTS.DB_NAME, APP_CONSTANTS.DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            // e.target.result.createObjectStore('handles');
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
            // Create app_state store if missing (NEW)
            if (!db.objectStoreNames.contains('app_state')) {
                db.createObjectStore('app_state');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveDirectoryHandle(handle) {
    const db = await getDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'project_root');
    return tx.complete;
}

export async function getDirectoryHandle() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project_root');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

// --- FILE OPERATIONS ---

export async function saveActiveFile(side) {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if(!pair) return { success: false, error: "No active chapter" };

    let handle = side === 'left' ? pair.leftHandle : pair.rightHandle;
    const data = side === 'left' ? pair.leftData : pair.rightData;

    // 1. If no file linked, ask user to "Save As"
    if (!handle) {
        try {
            handle = await window.showSaveFilePicker({
                suggestedName: side === 'left' ? 'chapter_cn.txt' : 'chapter_en.txt'
            });
            // Update State
            if (side === 'left') { pair.leftHandle = handle; pair.leftName = handle.name; }
            else { pair.rightHandle = handle; pair.rightName = handle.name; }
        } catch (err) {
            return { success: false, cancelled: true };
        }
    }

    // 2. Write to disk
    try {
        const writable = await handle.createWritable();
        await writable.write(data.join('\n'));
        await writable.close();

        // 3. Update Timestamp & Flags
        const file = await handle.getFile();
        if (side === 'left') {
            pair.leftLastModified = file.lastModified;
            pair.leftDirty = false;
            pair.leftExternalChange = false;
        } else {
            pair.rightLastModified = file.lastModified;
            pair.rightDirty = false;
            pair.rightExternalChange = false;
        }

        return { success: true };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

export async function refreshActivePair() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return { success: false };

    try {
        let reloaded = false;
        
        // Reload Left
        if (pair.leftHandle) {
            const file = await pair.leftHandle.getFile();
            pair.leftData = (await file.text()).trimEnd().split(/\r?\n/);
            pair.leftLastModified = file.lastModified;
            pair.leftDirty = false;
            pair.leftExternalChange = false;
            reloaded = true;
        }

        // Reload Right
        if (pair.rightHandle) {
            const file = await pair.rightHandle.getFile();
            pair.rightData = (await file.text()).trimEnd().split(/\r?\n/);
            pair.rightLastModified = file.lastModified;
            pair.rightDirty = false;
            pair.rightExternalChange = false;
            reloaded = true;
        }

        return { success: reloaded };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

export async function checkForExternalChanges() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return false;

    let changed = false;

    // Check Left
    if (pair.leftHandle) {
        try {
            const file = await pair.leftHandle.getFile();
            if (file.lastModified > pair.leftLastModified) {
                if (!pair.leftExternalChange) {
                    pair.leftExternalChange = true;
                    changed = true;
                }
            }
        } catch(e) { /* ignore permission errors during poll */ }
    }

    // Check Right
    if (pair.rightHandle) {
        try {
            const file = await pair.rightHandle.getFile();
            if (file.lastModified > pair.rightLastModified) {
                if (!pair.rightExternalChange) {
                    pair.rightExternalChange = true;
                    changed = true;
                }
            }
        } catch(e) { /* ignore */ }
    }

    return changed;
}

// ---- APP STATE PERSISTENCE (for UI state, not file handles) ----
export async function saveAppState() {
    const db = await getDB();
    const tx = db.transaction('app_state', 'readwrite');
    
    // We strip out the file handles because they can't be saved in this JSON blob
    // (We rely on the 'handles' store and auto-relink for that)
    const cleanState = {
        name: project.name,
        activePairId: project.activePairId,
        pairs: project.pairs.map(p => ({
            id: p.id,
            name: p.name,
            leftName: p.leftName,
            rightName: p.rightName,
            leftData: p.leftData,
            rightData: p.rightData,
            leftLastModified: p.leftLastModified,
            rightLastModified: p.rightLastModified
        }))
    };

    tx.objectStore('app_state').put(cleanState, 'current_session');
    return tx.complete;
}

export async function loadAppState() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx = db.transaction('app_state', 'readonly');
        const req = tx.objectStore('app_state').get('current_session');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}