// js/state.js

export const APP_VERSION = "0.7.0";

export const APP_CONSTANTS = {
    DB_NAME: 'TranslationToolDB',
    DB_VERSION: 1
};

// The main state object
export const project = {
    name: "Untitled Project",
    pairs: [],          // Array of chapter objects
    activePairId: null  // ID of the currently open chapter
};