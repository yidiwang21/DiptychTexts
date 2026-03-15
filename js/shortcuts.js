// js/shortcuts.js
// Central keyboard-shortcut registry with IndexedDB persistence.
//
// Only "app-specific" shortcuts live here — the standard platform ones
// (Cmd/Ctrl+S to save, Cmd/Ctrl+Z to undo) remain hardcoded in main.js
// because they intentionally accept either modifier key.

import { APP_CONSTANTS } from './state.js';


// ─────────────────────────────────────────────
//  DEFAULTS
// ─────────────────────────────────────────────

export const SHORTCUT_GROUPS = ['Navigation', 'Editor', 'File', 'App'];

/** Master list of configurable shortcuts. */
export const DEFAULT_SHORTCUTS = {
    // Navigation ────────────────────────────────────────────────────────
    'nav-left':  { key: 'j', meta: false, ctrl: true,  shift: true,  alt: false,
                   label: 'Move to Left Column',  group: 'Navigation' },
    'nav-right': { key: 'k', meta: false, ctrl: true,  shift: true,  alt: false,
                   label: 'Move to Right Column', group: 'Navigation' },
    'nav-up':    { key: 'p', meta: false, ctrl: true,  shift: false, alt: false,
                   label: 'Move to Cell Above',   group: 'Navigation' },
    'nav-down':  { key: 'n', meta: false, ctrl: true,  shift: false, alt: false,
                   label: 'Move to Cell Below',   group: 'Navigation' },

    // Editor ────────────────────────────────────────────────────────────
    'find':      { key: 'f', meta: true,  ctrl: false, shift: false, alt: false,
                   label: 'Find & Replace',       group: 'Editor' },
    'find-alt':  { key: 'h', meta: true,  ctrl: false, shift: false, alt: false,
                   label: 'Find & Replace (alt)', group: 'Editor' },

    // File ──────────────────────────────────────────────────────────────
    'print':     { key: 'p', meta: true,  ctrl: false, shift: false, alt: false,
                   label: 'Print Dialog',         group: 'File' },

    // App ───────────────────────────────────────────────────────────────
    'shortcuts': { key: ',', meta: true,  ctrl: false, shift: false, alt: false,
                   label: 'Keyboard Shortcuts',   group: 'App' },
};


// ─────────────────────────────────────────────
//  IN-MEMORY CACHE
// ─────────────────────────────────────────────

/** Merged user overrides + defaults. Populated by loadShortcuts(). */
let _shortcuts = null;


// ─────────────────────────────────────────────
//  INDEXEDDB HELPERS
// ─────────────────────────────────────────────

function _getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(APP_CONSTANTS.DB_NAME, APP_CONSTANTS.DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}


// ─────────────────────────────────────────────
//  LOAD / SAVE
// ─────────────────────────────────────────────

/**
 * Load user overrides from IndexedDB and merge over defaults.
 * Always call this once at app startup before registering key listeners.
 */
export async function loadShortcuts() {
    try {
        const db = await _getDB();
        const overrides = await new Promise((resolve) => {
            const tx  = db.transaction('app_state', 'readonly');
            const req = tx.objectStore('app_state').get('user_shortcuts');
            req.onsuccess = () => resolve(req.result || {});
            req.onerror   = () => resolve({});
        });

        // Merge: start from defaults, apply any user overrides (key+modifier only).
        _shortcuts = {};
        for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
            _shortcuts[id] = overrides[id]
                ? { ...def, ...overrides[id] }   // keep label/group from defaults
                : { ...def };
        }
    } catch {
        _shortcuts = structuredClone(DEFAULT_SHORTCUTS);
    }
    return _shortcuts;
}

/**
 * Persist the full shortcuts map to IndexedDB and update the in-memory cache.
 * @param {Object} shortcuts  — same shape as DEFAULT_SHORTCUTS
 */
export async function saveShortcuts(shortcuts) {
    // Only persist the binding fields; label/group come from defaults at load time.
    const toStore = {};
    for (const [id, def] of Object.entries(shortcuts)) {
        toStore[id] = { key: def.key, meta: !!def.meta, ctrl: !!def.ctrl,
                        shift: !!def.shift, alt: !!def.alt };
    }
    _shortcuts = structuredClone(shortcuts);
    try {
        const db = await _getDB();
        const tx = db.transaction('app_state', 'readwrite');
        tx.objectStore('app_state').put(toStore, 'user_shortcuts');
    } catch (e) {
        console.warn('saveShortcuts failed:', e);
    }
}

/** Return the current in-memory shortcuts (falls back to defaults if not loaded). */
export function getShortcuts() {
    return _shortcuts ?? DEFAULT_SHORTCUTS;
}


// ─────────────────────────────────────────────
//  MATCHING
// ─────────────────────────────────────────────

/**
 * Returns true when a KeyboardEvent matches the stored shortcut for actionId.
 * All four modifier booleans must match exactly.
 */
export function matches(e, actionId) {
    const sc = getShortcuts()[actionId];
    if (!sc) return false;
    return e.key.toLowerCase() === sc.key.toLowerCase()
        && !!e.metaKey  === !!sc.meta
        && !!e.ctrlKey  === !!sc.ctrl
        && !!e.shiftKey === !!sc.shift
        && !!e.altKey   === !!sc.alt;
}


// ─────────────────────────────────────────────
//  DISPLAY
// ─────────────────────────────────────────────

/**
 * Format a shortcut definition as a human-readable string, e.g. "⌘F", "⌃⇧J".
 */
export function formatShortcut(def) {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const parts = [];
    if (def.meta)  parts.push(isMac ? '⌘' : 'Meta+');
    if (def.ctrl)  parts.push(isMac ? '⌃' : 'Ctrl+');
    if (def.shift) parts.push(isMac ? '⇧' : 'Shift+');
    if (def.alt)   parts.push(isMac ? '⌥' : 'Alt+');
    const key = def.key === ' ' ? 'Space' : def.key.toUpperCase();
    parts.push(key);
    return parts.join('');
}


// ─────────────────────────────────────────────
//  CONFLICT DETECTION
// ─────────────────────────────────────────────

/**
 * Returns the actionId of any existing shortcut that matches the given binding,
 * or null if there is no conflict.
 * @param {Object} def         — { key, meta, ctrl, shift, alt }
 * @param {string} excludeId   — action being edited (skip its own entry)
 */
export function findConflict(def, excludeId) {
    for (const [id, sc] of Object.entries(getShortcuts())) {
        if (id === excludeId) continue;
        if (sc.key.toLowerCase() === def.key.toLowerCase()
            && !!sc.meta  === !!def.meta
            && !!sc.ctrl  === !!def.ctrl
            && !!sc.shift === !!def.shift
            && !!sc.alt   === !!def.alt) {
            return id;
        }
    }
    return null;
}
