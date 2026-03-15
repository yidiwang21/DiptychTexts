// js/file_system.js

import { project, APP_CONSTANTS } from './state.js';


// ─────────────────────────────────────────────
//  TEXT PARSING  (shared by drop, click, refresh)
// ─────────────────────────────────────────────

/**
 * Parse raw file text into an array of paragraph strings.
 * Paragraphs are blocks of text separated by one or more blank lines.
 * Each cell in the editor holds one paragraph.
 *
 * Example input:        → output cells:
 *   "Para one.\n        ["Para one.", "Para two.\nLine 2.", "Para three."]
 *    \n
 *    Para two.\nLine 2.
 *    \n
 *    Para three."
 */
export function parseFileContent(rawText) {
    const text = (rawText || '').replace(/\r\n/g, '\n').trimEnd();
    if (!text) return [''];

    // Split on EXACTLY one blank line (\n\n).
    // This preserves intentional empty cells (alignment rows saved as empty
    // segments between double-blank-line pairs) while still separating normal
    // paragraphs correctly.
    //
    //   "A\n\nB"       → ["A", "B"]       (normal paragraph split)
    //   "A\n\n\n\nB"   → ["A", "", "B"]   (empty alignment cell preserved ✓)
    //   "A\n\n\nB"     → ["A", "B"]       (odd trailing \n trimmed away)
    //
    // Leading / trailing empty entries (file-level whitespace) are dropped,
    // but INTERNAL empty entries are kept — they are empty alignment cells.
    const cells = text.split('\n\n').map(p => p.trim());

    let lo = 0, hi = cells.length - 1;
    while (lo <= hi && cells[lo]  === '') lo++;
    while (hi >= lo && cells[hi] === '') hi--;

    const result = cells.slice(lo, hi + 1);
    return result.length > 0 ? result : [''];
}

/**
 * Serialize editor cells back to file text.
 * Paragraphs are joined with a blank line, matching parseFileContent's format.
 */
export function serializeFileContent(cells) {
    return (cells || []).join('\n\n');
}


// ─────────────────────────────────────────────
//  DATABASE HELPERS
// ─────────────────────────────────────────────

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(APP_CONSTANTS.DB_NAME, APP_CONSTANTS.DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('handles'))   db.createObjectStore('handles');
            if (!db.objectStoreNames.contains('app_state')) db.createObjectStore('app_state');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror   = () => reject(request.error);
    });
}

// ── Directory handle (for bulk folder relink) ─────────────────────────────────

export async function saveDirectoryHandle(handle) {
    const db = await getDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'project_root');
    return tx.complete;
}

export async function getDirectoryHandle() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx  = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project_root');
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
    });
}

// ── Project file handle (for persistent project save) ─────────────────────────
// Stores the FileSystemFileHandle for the project's .json file so that
// subsequent "Save Project" calls can write back to the same location without
// showing a new save dialog.

export async function saveProjectFileHandle(handle) {
    try {
        const db = await getDB();
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'project_file');
    } catch (e) {
        console.warn('saveProjectFileHandle failed:', e.message);
    }
}

export async function getProjectFileHandle() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx  = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('project_file');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => resolve(null);
    });
}

export async function removeProjectFileHandle() {
    try {
        const db = await getDB();
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('project_file');
    } catch (e) { /* ignore */ }
}

/**
 * Write serialized project JSON to a FileSystemFileHandle.
 * Returns { success, error? }.
 */
export async function writeProjectFile(handle, projectData) {
    try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(projectData, null, 2));
        await writable.close();
        return { success: true, filename: handle.name };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ── Rotating auto-save snapshots (IndexedDB fallback) ─────────────────────────
// Keeps the last MAX_AUTOSAVES full project snapshots in the app_state store.
// These survive even if the browser loses file permissions.

const MAX_AUTOSAVES = 3;

/**
 * Prepend a new snapshot to the rotating autosave list in IndexedDB.
 * Trims the list to MAX_AUTOSAVES entries.
 */
export async function saveAutoSnapshot(projectData) {
    try {
        const db = await getDB();

        // Read existing slots
        const slots = await new Promise((resolve) => {
            const tx  = db.transaction('app_state', 'readonly');
            const req = tx.objectStore('app_state').get('autosave_slots');
            req.onsuccess = () => resolve(req.result || []);
            req.onerror   = () => resolve([]);
        });

        slots.unshift({ timestamp: Date.now(), data: projectData });
        if (slots.length > MAX_AUTOSAVES) slots.length = MAX_AUTOSAVES;

        const tx2 = db.transaction('app_state', 'readwrite');
        tx2.objectStore('app_state').put(slots, 'autosave_slots');
    } catch (e) {
        console.warn('saveAutoSnapshot failed:', e.message);
    }
}

/**
 * Return the last MAX_AUTOSAVES snapshots, newest first.
 * Each entry: { timestamp: number, data: projectData }
 */
export async function getAutoSnapshots() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx  = db.transaction('app_state', 'readonly');
        const req = tx.objectStore('app_state').get('autosave_slots');
        req.onsuccess = () => resolve(req.result || []);
        req.onerror   = () => resolve([]);
    });
}

// ── Per-column file handles ───────────────────────────────────────────────────
// Key pattern: "file_{pairId}_{colIdx}"

export async function saveFileHandle(pairId, colIdx, handle) {
    try {
        const db = await getDB();
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, `file_${pairId}_${colIdx}`);
    } catch (e) {
        console.warn('saveFileHandle failed:', e.message);
    }
}

export async function getFileHandle(pairId, colIdx) {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx  = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get(`file_${pairId}_${colIdx}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => resolve(null);
    });
}

export async function removeFileHandle(pairId, colIdx) {
    try {
        const db = await getDB();
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(`file_${pairId}_${colIdx}`);
    } catch (e) { /* ignore */ }
}

/**
 * After deleting the column at deletedIdx, shift the stored file handles for
 * columns (deletedIdx + 1) … (oldColCount - 1) down by one position so that
 * the IndexedDB keys stay in sync with pair.columns indices.
 *
 * Call this BEFORE splicing pair.columns so that oldColCount is still correct.
 */
export async function shiftFileHandlesAfterDelete(pairId, deletedIdx, oldColCount) {
    // Remove the deleted column's handle first
    await removeFileHandle(pairId, deletedIdx);

    // Move each subsequent handle one position to the left
    for (let i = deletedIdx + 1; i < oldColCount; i++) {
        const handle = await getFileHandle(pairId, i);
        if (handle) {
            await saveFileHandle(pairId, i - 1, handle);
        }
        await removeFileHandle(pairId, i);
    }
}


// ─────────────────────────────────────────────
//  FILE OPERATIONS
// ─────────────────────────────────────────────

/**
 * Save a column to disk (paragraph-joined).
 * Opens a Save As picker if the column has no linked file yet.
 * Persists the file handle in IndexedDB so it survives page reloads.
 */
export async function saveActiveFile(colIdx) {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return { success: false, error: "No active chapter" };

    const col = pair.columns[colIdx];
    if (!col)  return { success: false, error: `Invalid column index: ${colIdx}` };

    let handle = col.handle;

    // No file linked → Save As
    if (!handle) {
        try {
            handle = await window.showSaveFilePicker({
                suggestedName: col.name || `column_${colIdx + 1}.txt`
            });
            col.handle = handle;
            col.name   = handle.name;
        } catch (err) {
            return { success: false, cancelled: true };
        }
    }

    // Write paragraphs joined by blank line
    try {
        const writable = await handle.createWritable();
        await writable.write(serializeFileContent(col.data));
        await writable.close();

        const file          = await handle.getFile();
        col.lastModified    = file.lastModified;
        col.dirty           = false;
        col.externalChange  = false;

        // Persist the handle so the file stays linked after reload
        await saveFileHandle(pair.id, colIdx, handle);

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** Reload all linked column files from disk (paragraph mode). */
export async function refreshActivePair() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return { success: false };

    try {
        let reloaded = false;
        for (const col of pair.columns) {
            if (!col.handle) continue;
            const file          = await col.handle.getFile();
            col.data            = parseFileContent(await file.text());
            col.lastModified    = file.lastModified;
            col.dirty           = false;
            col.externalChange  = false;
            reloaded            = true;
        }
        return { success: reloaded };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

/** Poll for external disk changes on all columns of the active pair. */
export async function checkForExternalChanges() {
    const pair = project.pairs.find(p => p.id === project.activePairId);
    if (!pair) return false;

    let changed = false;
    for (const col of pair.columns) {
        if (!col.handle) continue;
        try {
            const file = await col.handle.getFile();
            if (file.lastModified > col.lastModified && !col.externalChange) {
                col.externalChange = true;
                changed = true;
            }
        } catch (e) { /* ignore permission errors during poll */ }
    }
    return changed;
}


// ─────────────────────────────────────────────
//  APP STATE PERSISTENCE  (text cache + metadata)
// ─────────────────────────────────────────────

/**
 * Save project state to IndexedDB.
 * File handles are NOT stored here (they live in the 'handles' store).
 * This state is a fallback for when handles aren't available.
 */
export async function saveAppState() {
    const db = await getDB();
    const tx = db.transaction('app_state', 'readwrite');

    const cleanState = {
        name:         project.name,
        activePairId: project.activePairId,
        pairs: project.pairs.map(p => ({
            id:   p.id,
            name: p.name,
            columns: p.columns.map(col => ({
                name:         col.name,
                data:         col.data,
                backups:      col.backups || [],
                spans:        col.spans   || [],
                hidden:       col.hidden  || false,
                lastModified: col.lastModified
            }))
        }))
    };

    tx.objectStore('app_state').put(cleanState, 'current_session');
    return tx.complete;
}

export async function loadAppState() {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx  = db.transaction('app_state', 'readonly');
        const req = tx.objectStore('app_state').get('current_session');
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
    });
}
