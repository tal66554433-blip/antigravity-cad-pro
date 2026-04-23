/**
 * Antigravity CAD v3 - UI Controller
 * Manages DOM interactions, Feature Tree updates, and Toolbars.
 */

export const UI = {
    app: null,

    init(appInstance) {
        this.app = appInstance;
        this.setupListeners();
        this.setStatus("System Ready");
    },

    setupListeners() {
        // Toolbar Tools
        document.querySelectorAll('.tool-btn[data-shape]').forEach(btn => {
            btn.addEventListener('click', () => {
                const shapeType = btn.dataset.shape;
                this.app.addFeature(shapeType, {
                    width: 50, height: 50, depth: 50, radius: 25,
                    position: {x: 0, y: 0, z: 0},
                    rotation: {x: 0, y: 0, z: 0}
                });
            });
        });

        // Global Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.app.state.selectedFeature) {
                this.app.deleteFeature(this.app.state.selectedFeature.id);
            }
        });
    },

    setStatus(msg, type = "normal") {
        const status = document.getElementById('status-msg');
        status.innerText = msg;
        status.style.color = type === "danger" ? "var(--danger)" : "var(--text-dim)";
    },

    updateFeatureTree(features) {
        const tree = document.getElementById('feature-tree');
        const emptyMsg = document.getElementById('empty-tree');
        
        // Clear existing (except empty message)
        const items = tree.querySelectorAll('.tree-item');
        items.forEach(i => i.remove());

        if (features.length === 0) {
            emptyMsg.style.display = 'block';
            return;
        }

        emptyMsg.style.display = 'none';

        features.forEach(f => {
            const el = document.createElement('div');
            el.className = `tree-item ${this.app.state.selectedFeature?.id === f.id ? 'selected' : ''}`;
            el.innerHTML = `
                <div class="ti-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <span class="ti-name">${f.name}</span>
            `;
            
            el.addEventListener('click', () => this.selectFeature(f));
            tree.appendChild(el);
        });
    },

    selectFeature(feature) {
        this.app.state.selectedFeature = feature;
        this.updateFeatureTree(this.app.app.state.features); // Refresh selection highlight
        this.showProperties(feature);
    },

    showProperties(feature) {
        const panel = document.getElementById('properties-content');
        if (!feature) {
            panel.innerHTML = `<p style="color: var(--text-dim); font-size: 0.8rem;">Select a feature to edit.</p>`;
            return;
        }

        // Simple property editor
        panel.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <label style="font-size: 0.75rem; color: var(--text-secondary);">Position X</label>
                <input type="number" value="${feature.params.position.x}" class="prop-input" data-path="position.x">
                <label style="font-size: 0.75rem; color: var(--text-secondary);">Position Y</label>
                <input type="number" value="${feature.params.position.y}" class="prop-input" data-path="position.y">
            </div>
        `;

        panel.querySelectorAll('.prop-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const path = input.dataset.path.split('.');
                feature.params[path[0]][path[1]] = parseFloat(e.target.value);
                this.app.rebuildModel();
            });
        });
    }
};
