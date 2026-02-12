import { project } from './state.js';

export function renderSidebar() {
    const list = document.getElementById('pairList');
    list.innerHTML = '';
    
    // Update Project Title Input
    const titleInput = document.getElementById('projectNameInput');
    if (titleInput) titleInput.value = project.name;

    project.pairs.forEach(pair => {
        const card = document.createElement('div');
        card.className = `pair-card ${pair.id === project.activePairId ? 'active' : ''}`;
        const isLinkedL = !!pair.leftHandle;
        const isLinkedR = !!pair.rightHandle;
        
        card.innerHTML = `
            <div class="pair-header">
                <input type="text" class="pair-title" value="${pair.name}" onchange="updatePairName('${pair.id}', this.value)">
                <button class="ctrl-btn btn-del" onclick="deletePair('${pair.id}')" title="Delete Chapter">×</button>
            </div>
            <div class="drop-zones">
                <div id="drop-left-${pair.id}" class="drop-zone ${isLinkedL ? 'loaded' : ''}" 
                     style="${!isLinkedL ? 'border-color:#fca5a5; background:#fef2f2;' : ''}">
                    ${isLinkedL ? pair.leftName : '⚠️ ' + (pair.leftName || 'Drop File')}
                </div>
                <div id="drop-right-${pair.id}" class="drop-zone ${isLinkedR ? 'loaded' : ''}" 
                     style="${!isLinkedR ? 'border-color:#fca5a5; background:#fef2f2;' : ''}">
                    ${isLinkedR ? pair.rightName : '⚠️ ' + (pair.rightName || 'Drop File')}
                </div>
            </div>
        `;

        // Click to activate
        card.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                window.setActivePair(pair.id); // Call global handler
            }
        });

        list.appendChild(card);
    });
}

export function updatePairName(id, newName) {
    const pair = project.pairs.find(p => p.id === id);
    if(pair) pair.name = newName;
}

// This function needs to be exported so Main can call it after rendering
export function attachAllDropHandlers(onDropCallback) {
    project.pairs.forEach(pair => {
        setupDropZone(`drop-left-${pair.id}`, pair, 'left', onDropCallback);
        setupDropZone(`drop-right-${pair.id}`, pair, 'right', onDropCallback);
    });
}

function setupDropZone(elementId, pair, side, callback) {
    const zone = document.getElementById(elementId);
    if (!zone) return;
    
    zone.ondragover = (e) => { e.preventDefault(); zone.style.background = '#e2e8f0'; };
    zone.ondragleave = (e) => { e.preventDefault(); zone.style.background = ''; };
    
    zone.ondrop = async (e) => {
        e.preventDefault();
        zone.style.background = '';
        
        if (e.dataTransfer.items) {
            const item = e.dataTransfer.items[0];
            if (item.kind === 'file') {
                const handle = await item.getAsFileSystemHandle();
                const file = await handle.getFile();
                const text = (await file.text()).trimEnd();
                
                // Update State Directly (Simple enough for UI to do)
                if(side === 'left') {
                    pair.leftHandle = handle;
                    pair.leftName = file.name; 
                    pair.leftData = text.split(/\r?\n/);
                    pair.leftLastModified = file.lastModified;
                    pair.leftDirty = false;
                    pair.leftExternalChange = false;
                } else {
                    pair.rightHandle = handle;
                    pair.rightName = file.name; 
                    pair.rightData = text.split(/\r?\n/);
                    pair.rightLastModified = file.lastModified;
                    pair.rightDirty = false;
                    pair.rightExternalChange = false;
                }

                // Notify Controller
                if (callback) callback(pair.id);
            }
        }
    };
}