/**
 * Antigravity CAD v3 - Core Application Controller
 * Manages UI, Feature Tree, and Kernel Lifecycle.
 */

import { Kernel } from './core/kernel.js';
import { Engine } from './core/engine.js';
import { UI } from './ui/ui_controller.js';

class App {
    constructor() {
        this.state = {
            features: [],
            selectedFeature: null,
            isSketching: false,
            unitScale: 1.0
        };
        
        this.init();
    }

    async init() {
        console.log("Antigravity CAD v3 Initializing...");
        
        // 1. Initialize Rendering Engine
        Engine.init(document.getElementById('canvas'));
        
        // 2. Initialize Geometric Kernel
        try {
            document.getElementById('loading-text').innerText = "Waking up OpenCASCADE...";
            await Kernel.init();
            document.getElementById('loading-text').innerText = "Finalizing UI...";
        } catch (err) {
            console.error("Kernel failed to load:", err);
            document.getElementById('loading-text').innerText = "Critical Error: Kernel Crash";
            return;
        }

        // 3. Initialize UI Listeners
        UI.init(this);

        // 4. Ready!
        this.hideOverlay();
        console.log("App Ready.");
    }

    hideOverlay() {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 500);
    }

    // --- Feature Management ---

    addFeature(type, params) {
        const id = 'f_' + Math.random().toString(36).substr(2, 9);
        const feature = {
            id,
            type,
            name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${this.state.features.length + 1}`,
            params,
            visible: true
        };
        
        this.state.features.push(feature);
        this.rebuildModel();
        UI.updateFeatureTree(this.state.features);
        return feature;
    }

    deleteFeature(id) {
        this.state.features = this.state.features.filter(f => f.id !== id);
        this.rebuildModel();
        UI.updateFeatureTree(this.state.features);
    }

    async rebuildModel() {
        if (!Kernel.isWasmActive) return;

        try {
            let finalShape = null;
            
            for (const feature of this.state.features) {
                const shape = Kernel.createShapeFromFeature(feature);
                if (!shape) continue;

                if (!finalShape) {
                    finalShape = shape;
                } else {
                    // For now, primitives are unioned (add mode)
                    finalShape = Kernel.performBooleanOCCT(finalShape, shape, 'add');
                }
            }

            if (finalShape) {
                const geometry = Kernel.shapeToMesh(finalShape);
                Engine.updateMainModel(geometry);
            } else {
                Engine.updateMainModel(null);
            }
            
            UI.setStatus("Rebuild Successful");
        } catch (err) {
            console.error("Rebuild failed:", err);
            UI.setStatus("Error in geometry rebuild", "danger");
        }
    }
}

// Global instance
window.CADApp = new App();
export default window.CADApp;
