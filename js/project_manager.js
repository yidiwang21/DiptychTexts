// js/project_manager.js

import { project, MAX_COLUMNS, MIN_COLUMNS } from './state.js';
import {
    loadAppState, saveAppState,
    getDirectoryHandle, saveDirectoryHandle,
    getFileHandle, saveFileHandle, removeFileHandle,
    parseFileContent
} from './file_system.js';


// ─────────────────────────────────────────────
//  COLUMN FACTORY
// ─────────────────────────────────────────────

/** Returns a fresh, empty column object. */
export function createColumn(name = null, data = [], backups = [], spans = [], hidden = false) {
    return {
        name,           // Linked filename (or null)
        data,           // Array of paragraph strings (one per logical cell)
        backups,        // Array-of-arrays for backup options per cell
        spans,          // spans[i] = how many grid rows cell i occupies (absent/1 = normal)
        hidden,         // Whether the column is hidden from the grid view
        handle: null,   // FileSystemFileHandle (stored separately in IndexedDB)
        dirty: false,
        lastModified: 0,
        externalChange: false
    };
}


// ─────────────────────────────────────────────
//  SESSION RESTORE
// ─────────────────────────────────────────────

export async function restoreSession() {
    const savedState = await loadAppState();
    if (!savedState) return false;

    project.name         = savedState.name || "Untitled Project";
    project.activePairId = savedState.activePairId;
    project.pairs        = sanitizeProjectData(savedState.pairs).map(p => ({
        ...p,
        columns: p.columns.map(col => ({
            ...col,
            handle:         null,   // Handles restored below
            dirty:          false,
            externalChange: false
        }))
    }));

    // ── Step 1: Restore individual file handles (silently, no user gesture) ──
    // For each column that has a stored handle in IndexedDB, try queryPermission.
    // If already granted (browser remembers the grant), reload content from disk.
    // If not granted yet, the column stays linked-by-name (gray dot) until the
    // user clicks "🔗 Relink Files".
    await _tryRelinkHandles({ requireGesture: false });

    // ── Step 2: Directory-scan fallback for any still-unlinked columns ────────
    try {
        const dirHandle = await getDirectoryHandle();
        if (dirHandle) {
            if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
                await scanAndLink(dirHandle);
            }
        }
    } catch (e) {
        console.log("Auto-relink (dir) waiting for user gesture");
    }

    return true;
}

/**
 * Re-request file permissions for all stored handles (all chapters).
 * Must be called from a user-gesture handler (button click).
 * Returns the number of columns successfully relinked.
 */
export async function relinkAllFiles() {
    return _tryRelinkHandles({ requireGesture: true });
}

/**
 * Reconnect and reload files for a single chapter.
 * Tries to re-request browser permission for any columns that have a stored
 * IndexedDB handle but no live in-memory handle (e.g. after a page reload).
 * Must be called from a user-gesture handler so requestPermission() can show
 * the browser prompt.
 * Returns the number of columns successfully linked.
 */
export async function relinkPair(pairId) {
    const pair = project.pairs.find(p => p.id === pairId);
    if (!pair) return 0;

    let linked = 0;
    for (let c = 0; c < pair.columns.length; c++) {
        const col = pair.columns[c];
        if (col.handle) { linked++; continue; }   // Already live

        try {
            const handle = await getFileHandle(pair.id, c);
            if (!handle) continue;

            const opts    = { mode: 'readwrite' };
            let granted   = (await handle.queryPermission(opts)) === 'granted';
            if (!granted) granted = (await handle.requestPermission(opts)) === 'granted';
            if (!granted) continue;

            col.handle         = handle;
            col.name           = handle.name;
            const file         = await handle.getFile();
            col.data           = parseFileContent(await file.text());
            col.lastModified   = file.lastModified;
            col.dirty          = false;
            col.externalChange = false;
            linked++;
        } catch (e) {
            console.warn(`relinkPair failed [${pairId}][${c}]:`, e.message);
        }
    }
    return linked;
}

/**
 * Internal: iterate all columns, restore handles from IndexedDB,
 * optionally calling requestPermission (needs user gesture).
 */
async function _tryRelinkHandles({ requireGesture }) {
    let linked = 0;
    for (const pair of project.pairs) {
        for (let c = 0; c < pair.columns.length; c++) {
            const col = pair.columns[c];
            // Skip if already linked
            if (col.handle) { linked++; continue; }

            try {
                const handle = await getFileHandle(pair.id, c);
                if (!handle) continue;

                const opts   = { mode: 'readwrite' };
                let granted  = (await handle.queryPermission(opts)) === 'granted';

                if (!granted && requireGesture) {
                    granted = (await handle.requestPermission(opts)) === 'granted';
                }

                if (!granted) continue;

                // Reload content directly from the source file
                col.handle         = handle;
                col.name           = handle.name;
                const file         = await handle.getFile();
                col.data           = parseFileContent(await file.text());
                col.lastModified   = file.lastModified;
                col.dirty          = false;
                col.externalChange = false;
                linked++;
            } catch (e) {
                console.warn(`Handle restore failed [${pair.id}][${c}]:`, e.message);
            }
        }
    }
    return linked;
}


// ─────────────────────────────────────────────
//  PAIR (CHAPTER) CRUD
// ─────────────────────────────────────────────

export function createNewPair() {
    const id = Date.now().toString();
    const newPair = {
        id,
        name: `Chapter ${project.pairs.length + 1}`,
        columns: [createColumn(), createColumn()]   // Default: 2 columns
    };
    project.pairs.push(newPair);
    saveAppState();
    return id;
}

export function deletePair(id) {
    const pair = project.pairs.find(p => p.id === id);
    if (pair) {
        // Clean up all stored file handles for this chapter (fire-and-forget)
        pair.columns.forEach((_, c) => removeFileHandle(id, c));
    }
    project.pairs        = project.pairs.filter(p => p.id !== id);
    if (project.activePairId === id) project.activePairId = null;
    saveAppState();
}

/**
 * Add a new empty column to a chapter (max MAX_COLUMNS).
 * Returns true on success.
 */
export function addColumn(pairId) {
    const pair = project.pairs.find(p => p.id === pairId);
    if (!pair || pair.columns.length >= MAX_COLUMNS) return false;
    pair.columns.push(createColumn());
    saveAppState();
    return true;
}

/**
 * Remove the last column from a chapter (min MIN_COLUMNS).
 * Cleans up its stored file handle. Returns true on success.
 */
export function removeColumn(pairId) {
    const pair = project.pairs.find(p => p.id === pairId);
    if (!pair || pair.columns.length <= MIN_COLUMNS) return false;
    const lastIdx = pair.columns.length - 1;
    removeFileHandle(pairId, lastIdx);   // fire-and-forget
    pair.columns.pop();
    saveAppState();
    return true;
}


// ─────────────────────────────────────────────
//  PROJECT SAVE / LOAD
// ─────────────────────────────────────────────

export function saveProject() {
    const projectData = {
        name: project.name,
        pairs: project.pairs.map(p => ({
            id:      p.id,
            name:    p.name,
            columns: p.columns.map(col => ({
                name:    col.name    || null,
                data:    col.data    || [],
                backups: col.backups || [],
                spans:   col.spans   || [],
                hidden:  col.hidden  || false
            }))
        }))
    };

    const filename = (project.name || "project")
        .replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".json";
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
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

                project.name  = data.name || "Untitled Project";
                project.pairs = sanitizeProjectData(data.pairs).map(p => ({
                    ...p,
                    columns: p.columns.map(col => ({
                        ...col,
                        spans:          col.spans   || [],
                        handle:         null,
                        dirty:          false,
                        lastModified:   col.lastModified || 0,
                        externalChange: false
                    }))
                }));

                // Try to relink from previously-stored individual handles
                const linked = await _tryRelinkHandles({ requireGesture: false });

                // Fall back to directory scan
                let dirHandle   = await getDirectoryHandle();
                let linkedCount = linked;

                if (dirHandle) {
                    const opts = { mode: 'readwrite' };
                    if ((await dirHandle.queryPermission(opts)) !== 'granted') {
                        if ((await dirHandle.requestPermission(opts)) !== 'granted') {
                            dirHandle = null;
                        }
                    }
                }

                if (!dirHandle) {
                    resolve({ success: true, needsFolder: linkedCount === 0 });
                    return;
                }

                await saveAppState();
                const dirLinked = await scanAndLink(dirHandle);
                resolve({ success: true, linkedCount: linkedCount + dirLinked });

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
        await saveDirectoryHandle(dirHandle);
        const count = await scanAndLink(dirHandle);
        return { success: true, count };
    } catch (err) {
        return { success: false, error: "User cancelled" };
    }
}


// ─────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────

/** Scan a directory and link matching file handles into unlinked columns. */
async function scanAndLink(dirHandle) {
    let matches = 0;
    for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        for (const pair of project.pairs) {
            for (let c = 0; c < pair.columns.length; c++) {
                const col = pair.columns[c];
                if (col.name === entry.name && !col.handle) {
                    col.handle = entry;
                    const file = await entry.getFile();
                    // Reload content from the actual file
                    col.data         = parseFileContent(await file.text());
                    col.lastModified = file.lastModified;
                    col.dirty        = false;
                    col.externalChange = false;
                    // Persist the handle
                    await saveFileHandle(pair.id, c, entry);
                    matches++;
                }
            }
        }
    }
    return matches;
}

/**
 * Normalize loaded pair data.
 * Handles migration from old { leftData, rightData } format.
 */
function sanitizeProjectData(pairs) {
    return (pairs || []).map(p => {

        // ── MIGRATION: old left/right format ──────────────────────────────
        if (!p.columns && (p.leftData || p.rightData)) {
            p.columns = [
                createColumn(p.leftName  || null, p.leftData  || [], p.leftBackups  || [], []),
                createColumn(p.rightName || null, p.rightData || [], p.rightBackups || [], [])
            ];
            if (p.columns[0]) p.columns[0].lastModified = p.leftLastModified  || 0;
            if (p.columns[1]) p.columns[1].lastModified = p.rightLastModified || 0;
        }

        // ── ENSURE valid columns array ─────────────────────────────────────
        const sanitizedColumns = (p.columns || [createColumn(), createColumn()])
            .map(col => ({
                name:           col.name    || null,
                data:           col.data    || [],
                backups:        col.backups || [],
                spans:          col.spans   || [],
                hidden:         col.hidden  || false,
                handle:         null,
                dirty:          false,
                lastModified:   col.lastModified || 0,
                externalChange: false
            }));

        return { ...p, columns: sanitizedColumns };
    });
}
