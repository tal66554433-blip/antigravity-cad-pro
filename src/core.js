// Antigravity CAD Pro v2 -- Main Application
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Kernel } from './core/kernel.js';
import { SketchEngine } from './sketch/sketch.js';
import { state, pushHistory, undo, redo, getDefaults, genId } from './state/state.js';
import {
    initScene, scene, camera, renderer, orbitControls, transformControls,
    ghostGroup, setResultMesh, getResultMaterial, getGhostMaterial,
    raycastGround, setView, startRenderLoop
} from './scene/scene.js';

// DOM refs
const canvas       = document.getElementById('canvas');
const skCanvas     = document.getElementById('sketch-canvas');
const featureTree  = document.getElementById('feature-tree');
const emptyTree    = document.getElementById('empty-tree');
const propsContent = document.getElementById('properties-content');
const statusMsg    = document.getElementById('status-msg');
const faceCount    = document.getElementById('face-count');
const coordDisplay = document.getElementById('coord-display');
const measureDisp  = document.getElementById('measure-display');
const measureText  = document.getElementById('measure-text');
const skToolbar     = document.getElementById('sketch-toolbar');
const skDimPanel    = document.getElementById('sketch-dim-panel');
const skDimList     = document.getElementById('sketch-dim-list');
const btnExtrude    = document.getElementById('btn-extrude');
const btnExitSketch = document.getElementById('btn-exit-sketch');
const btnNewSketch  = document.getElementById('btn-new-sketch');

// Init Three.js scene -- delay until DOM layout is complete
function init() {
    initScene(canvas);
    // Sketch state
    // (moved below)
}

// Use setTimeout to ensure CSS layout is complete
window.addEventListener('load', function() {
    setTimeout(function() { init(); boot(); }, 100);
});

let sketcher = null;
let inSketchMode = false;

// --- Geometry Factory (via Kernel) ---
function createGeometry(op) {
    const d = op.dimensions;
    switch (op.type) {
        case 'box':      return Kernel.createBox(d.width, d.height, d.depth);
        case 'cylinder': return Kernel.createCylinder(d.radius, d.height, d.segments || 32);
        case 'sphere':   return Kernel.createSphere(d.radius, d.widthSeg || 32, d.heightSeg || 24);
        case 'cone':     return Kernel.createCone(d.radius, d.height, d.segments || 32);
        case 'torus':    return Kernel.createTorus(d.radius, d.tube, d.radialSeg || 20, d.tubularSeg || 64);
        case 'extrude':  return Kernel.createExtrusion(op.sketchShapes, d.depth);
        case 'revolve':  return Kernel.createRevolve(op.sketchShapes, d.angle || 360, d.segments || 32);
        default:         return Kernel.createBox(50, 50, 50);
    }
}

function getMatrix(op) {
    const p = op.position;
    const r = op.rotation;
    const m = new THREE.Matrix4();
    m.compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
                r.x * Math.PI / 180,
                r.y * Math.PI / 180,
                r.z * Math.PI / 180
            )
        ),
        new THREE.Vector3(1, 1, 1)
    );
    return m;
}

// --- Evaluator (via Kernel) ---
function evaluateCSG() {
    if (!state.operations.length) {
        setResultMesh(null);
        updateFaceCount(0);
        return;
    }
    try {
        let baseMesh = null;
        for (const op of state.operations) {
            const geom = createGeometry(op);
            geom.computeVertexNormals();
            
            if (!baseMesh) {
                baseMesh = new THREE.Mesh(geom);
                baseMesh.applyMatrix4(getMatrix(op));
                baseMesh.updateMatrixWorld(true);
                continue;
            }
            
            baseMesh = Kernel.performBoolean(
                baseMesh.geometry, baseMesh.matrixWorld,
                geom, getMatrix(op),
                op.mode
            );
        }
        if (baseMesh) {
            baseMesh.material = getResultMaterial();
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            setResultMesh(baseMesh);
            updateFaceCount((baseMesh.geometry.getAttribute('position').count / 3) | 0);
        }
        setStatus('Model updated');
    } catch (e) {
        console.error('CSG error:', e);
        setStatus('CSG error -- check geometry');
    }
}

// --- Ghost wireframes ---
function updateGhosts() {
    ghostGroup.children.slice().forEach(function(c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
        ghostGroup.remove(c);
    });
    for (const op of state.operations) {
        if (op.id !== state.selectedId) continue;
        const geom = createGeometry(op);
        const mat = getGhostMaterial(op.mode);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(op.position.x, op.position.y, op.position.z);
        mesh.rotation.set(
            op.rotation.x * Math.PI / 180,
            op.rotation.y * Math.PI / 180,
            op.rotation.z * Math.PI / 180
        );
        mesh.userData.opId = op.id;
        ghostGroup.add(mesh);
    }
    attachTransform(state.selectedId);
}

function attachTransform(id) {
    var ghost = null;
    for (var i = 0; i < ghostGroup.children.length; i++) {
        if (ghostGroup.children[i].userData.opId === id) { ghost = ghostGroup.children[i]; break; }
    }
    if (ghost) {
        transformControls.attach(ghost);
        transformControls.setMode(state.transformMode);
    } else {
        transformControls.detach();
    }
}

function wireTransformControls() {
    transformControls.addEventListener('objectChange', function() {
        var obj = transformControls.object;
        if (!obj) return;
        var op = null;
        for (var i = 0; i < state.operations.length; i++) {
            if (state.operations[i].id === obj.userData.opId) { op = state.operations[i]; break; }
        }
        if (!op) return;
        op.position = {
            x: +obj.position.x.toFixed(2),
            y: +obj.position.y.toFixed(2),
            z: +obj.position.z.toFixed(2)
        };
        op.rotation = {
            x: +(obj.rotation.x * 180 / Math.PI).toFixed(2),
            y: +(obj.rotation.y * 180 / Math.PI).toFixed(2),
            z: +(obj.rotation.z * 180 / Math.PI).toFixed(2)
        };
        renderProperties();
    });
    transformControls.addEventListener('mouseUp', function() {
        pushHistory();
        evaluateCSG();
    });
}

// --- Add Primitive ---
function addShape(type) {
    state.counters[type] = (state.counters[type] || 0) + 1;
    const isFirst = state.operations.length === 0;
    const d = getDefaults(type);
    const h = d.height || (d.radius * 2) || 50;
    const op = {
        id: genId(),
        type: type,
        mode: isFirst ? 'add' : state.currentMode,
        name: type[0].toUpperCase() + type.slice(1) + ' ' + state.counters[type],
        dimensions: d,
        position: { x: 0, y: h / 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }
    };
    state.operations.push(op);
    pushHistory();
    refresh();
    setStatus('Added ' + op.name + ' (' + op.mode + ')');
}

function deleteOp(id) {
    const op = state.operations.find(function(o) { return o.id === id; });
    if (op && op._geom) op._geom.dispose();
    state.operations = state.operations.filter(function(o) { return o.id !== id; });
    if (state.selectedId === id) {
        state.selectedId = state.operations.length ? state.operations[state.operations.length - 1].id : null;
        transformControls.detach();
    }
    pushHistory();
    refresh();
    setStatus('Feature deleted');
}

// --- Sketch Mode ---
function enterSketchMode() {
    inSketchMode = true;
    sketcher = new SketchEngine(skCanvas, canvas, camera, scene);
    sketcher.enter(0);

    skToolbar.style.display = 'flex';
    btnExtrude.style.display = 'flex';
    document.getElementById('btn-revolve').style.display = 'flex';
    btnExitSketch.style.display = 'flex';
    btnNewSketch.style.display = 'none';
    skDimPanel.style.display = 'none';

    setView('top');
    skCanvas.addEventListener('sketch-dims', onSketchDims);
    setStatus('Sketch mode: click to place points (Line). Double-click or Close to finish shape. Then Extrude.');
}

function exitSketchMode() {
    if (!sketcher) return;
    sketcher.exit();
    sketcher = null;
    inSketchMode = false;
    skToolbar.style.display = 'none';
    skDimPanel.style.display = 'none';
    btnExtrude.style.display = 'none';
    document.getElementById('btn-revolve').style.display = 'none';
    btnExitSketch.style.display = 'none';
    btnNewSketch.style.display = 'flex';
    skCanvas.removeEventListener('sketch-dims', onSketchDims);
    setView('perspective');
    setStatus('Exited sketch mode');
}

function onSketchDims(e) {
    const dims = e.detail;
    const keys = Object.keys(dims);
    if (!keys.length) {
        skDimPanel.style.display = 'none';
        return;
    }
    skDimPanel.style.display = 'block';
    let html = '';
    for (const key of keys) {
        const dim = dims[key];
        html += '<div class="sk-dim-row">' +
            '<span class="sk-dim-lbl">' + dim.label + '</span>' +
            '<input class="sk-dim-inp" type="number" step="0.5" data-key="' + key + '" value="' + dim.value + '">' +
            '<span style="font-size:0.65rem;color:var(--t3)">mm</span>' +
            '</div>';
    }
    skDimList.innerHTML = html;
    skDimList.querySelectorAll('.sk-dim-inp').forEach(function(inp) {
        inp.addEventListener('change', function() {
            if (sketcher) {
                sketcher.applyDimension(inp.dataset.key, parseFloat(inp.value) || 0);
                skCanvas.dispatchEvent(new CustomEvent('sketch-dims', { detail: sketcher.dimensions }));
            }
        });
    });
}

function doExtrude() {
    if (!sketcher || !sketcher.hasShapes()) {
        setStatus('No closed shapes -- draw and close a shape first');
        return;
    }
    const depth = 20; // Default extrusion depth

    // Deep copy shapes to store in state
    const sketchShapes = JSON.parse(JSON.stringify(sketcher.shapes));
    const geom = Kernel.createExtrusion(sketchShapes, depth);
    
    if (!geom) {
        setStatus('Extrusion failed');
        return;
    }

    state.counters.extrude = (state.counters.extrude || 0) + 1;
    const isFirst = state.operations.length === 0;
    const op = {
        id: genId(),
        type: 'extrude',
        mode: isFirst ? 'add' : state.currentMode,
        name: 'Extrude ' + state.counters.extrude,
        dimensions: { depth: depth },
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        sketchShapes: sketchShapes,
        _geom: geom
    };
    state.operations.push(op);
    state.selectedId = op.id;

    exitSketchMode();
    pushHistory();
    refresh();
    setStatus('Extruded ' + depth + 'mm -- mode: ' + op.mode);
}

function doRevolve() {
    if (!sketcher || !sketcher.hasShapes()) {
        setStatus('No shapes to revolve -- draw something first');
        return;
    }
    const angle = 360;

    const sketchShapes = JSON.parse(JSON.stringify(sketcher.shapes));
    const geom = Kernel.createRevolve(sketchShapes, angle, 32);
    
    if (!geom) {
        setStatus('Revolve failed');
        return;
    }

    state.counters.revolve = (state.counters.revolve || 0) + 1;
    const isFirst = state.operations.length === 0;
    const op = {
        id: genId(),
        type: 'revolve',
        mode: isFirst ? 'add' : state.currentMode,
        name: 'Revolve ' + state.counters.revolve,
        dimensions: { angle: angle, segments: 32 },
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        sketchShapes: sketchShapes,
        _geom: geom
    };
    state.operations.push(op);
    state.selectedId = op.id;

    exitSketchMode();
    pushHistory();
    refresh();
    setStatus('Revolved ' + angle + 'deg -- mode: ' + op.mode);
}

// --- Feature Tree ---
const TYPE_ICONS = {
    box:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    cylinder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5"/></svg>',
    sphere:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/></svg>',
    cone:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L3 20h18L12 2z"/></svg>',
    torus:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
    extrude:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>',
    revolve:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 3v18" /></svg>'
};
const MODE_LABEL = { add: 'Union', cut: 'Cut', intersect: 'Intersect' };

function getDimDesc(op) {
    const d = op.dimensions;
    switch (op.type) {
        case 'box':      return d.width + 'x' + d.height + 'x' + d.depth + ' mm';
        case 'cylinder': return 'R' + d.radius + ' H' + d.height + ' mm';
        case 'sphere':   return 'R' + d.radius + ' mm';
        case 'cone':     return 'R' + d.radius + ' H' + d.height + ' mm';
        case 'torus':    return 'R' + d.radius + ' T' + d.tube + ' mm';
        case 'extrude':  return 'Depth ' + d.depth + ' mm';
        case 'revolve':  return 'Angle ' + d.angle + '°';
        default: return '';
    }
}

function renderTree() {
    if (!state.operations.length) {
        featureTree.innerHTML = '';
        featureTree.appendChild(emptyTree);
        emptyTree.style.display = '';
        return;
    }
    emptyTree.style.display = 'none';

    featureTree.innerHTML = state.operations.map(function(op, i) {
        const sel = op.id === state.selectedId ? ' selected' : '';
        return '<div class="tree-item' + sel + '" data-id="' + op.id + '">' +
            '<div class="ti-icon mode-' + op.mode + '">' + (TYPE_ICONS[op.type] || TYPE_ICONS.box) + '</div>' +
            '<div class="ti-info">' +
                '<div class="ti-name">' + (i + 1) + '. ' + op.name + '</div>' +
                '<div class="ti-desc">' + (MODE_LABEL[op.mode] || op.mode) + ' - ' + getDimDesc(op) + '</div>' +
            '</div>' +
            '<button class="ti-del" data-del="' + op.id + '" title="Delete">x</button>' +
            '</div>';
    }).join('');

    featureTree.querySelectorAll('.tree-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target.closest('[data-del]')) return;
            state.selectedId = el.dataset.id;
            refresh();
        });
    });
    featureTree.querySelectorAll('[data-del]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteOp(btn.dataset.del);
        });
    });
}

// --- Properties Panel ---
function renderProperties() {
    const op = state.operations.find(function(o) { return o.id === state.selectedId; });
    if (!op) {
        propsContent.innerHTML = '<div class="empty-state"><p>Select a feature</p></div>';
        return;
    }
    const d = op.dimensions;
    const p = op.position;
    const r = op.rotation;

    let dimHtml = '';
    for (const [k, v] of Object.entries(d)) {
        if (k.startsWith('_')) continue;
        dimHtml += '<div class="prop-row">' +
            '<span class="prop-label">' + k + '</span>' +
            '<input class="prop-input" type="number" step="1" data-dim="' + k + '" value="' + v + '">' +
            '</div>';
    }

    function posRow(ax, col) {
        return '<div class="prop-row">' +
            '<span class="prop-label" style="border-left: 2px solid ' + col + '; padding-left: 8px;">Position ' + ax.toUpperCase() + '</span>' +
            '<input class="prop-input" type="number" step="1" data-pos="' + ax + '" value="' + p[ax] + '">' +
            '</div>';
    }
    function rotRow(ax, col) {
        return '<div class="prop-row">' +
            '<span class="prop-label" style="border-left: 2px solid ' + col + '; padding-left: 8px;">Rotation ' + ax.toUpperCase() + '</span>' +
            '<input class="prop-input" type="number" step="5" data-rot="' + ax + '" value="' + r[ax] + '">' +
            '</div>';
    }

    propsContent.innerHTML =
        '<div class="p-sec"><div class="tb-label" style="margin-bottom:10px">Dimensions</div>' + dimHtml + '</div>' +
        '<div class="p-sec"><div class="tb-label" style="margin:15px 0 10px">Position</div>' +
        posRow('x', '#ff4444') + posRow('y', '#44ff44') + posRow('z', '#4444ff') + '</div>' +
        '<div class="p-sec"><div class="tb-label" style="margin:15px 0 10px">Rotation</div>' +
        rotRow('x', '#ff4444') + rotRow('y', '#44ff44') + rotRow('z', '#4444ff') + '</div>';

    propsContent.querySelectorAll('[data-dim]').forEach(function(inp) {
        inp.addEventListener('change', function() {
            op.dimensions[inp.dataset.dim] = parseFloat(inp.value) || 0;
            pushHistory();
            refresh();
        });
    });
    propsContent.querySelectorAll('[data-pos]').forEach(function(inp) {
        inp.addEventListener('change', function() {
            op.position[inp.dataset.pos] = parseFloat(inp.value) || 0;
            pushHistory();
            refresh();
        });
    });
    propsContent.querySelectorAll('[data-rot]').forEach(function(inp) {
        inp.addEventListener('change', function() {
            op.rotation[inp.dataset.rot] = parseFloat(inp.value) || 0;
            pushHistory();
            refresh();
        });
    });
}

// --- Refresh ---
function refresh() {
    evaluateCSG();
    updateGhosts();
    renderTree();
    renderProperties();
}

function setStatus(msg) { statusMsg.textContent = msg; }
function updateFaceCount(n) { faceCount.textContent = 'Faces: ' + n.toLocaleString(); }

// --- Measurement ---
let measureMode = false;
let measurePts = [];

function handleMeasureClick(e) {
    if (!measureMode || inSketchMode) return;
    const pt = raycastGround(e.clientX, e.clientY, canvas);
    if (!pt) return;

    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
    );
    marker.position.copy(pt);
    marker.userData.isMeasure = true;
    scene.add(marker);
    measurePts.push(pt);

    if (measurePts.length === 2) {
        const dist = measurePts[0].distanceTo(measurePts[1]);
        measureText.textContent = 'Distance: ' + dist.toFixed(2) + ' mm';
        measureDisp.style.display = 'flex';
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(measurePts),
            new THREE.LineBasicMaterial({ color: 0x06b6d4 })
        );
        line.userData.isMeasure = true;
        scene.add(line);
        measurePts = [];
        setStatus('Measured: ' + dist.toFixed(2) + ' mm');
    } else {
        setStatus('Click second point to complete measurement');
    }
}

function clearMeasure() {
    scene.children.filter(function(c) { return c.userData.isMeasure; }).forEach(function(c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
        scene.remove(c);
    });
    measurePts = [];
    measureDisp.style.display = 'none';
}

// --- STL Export ---
async function exportSTL() {
    const mod = await import('three/addons/exporters/STLExporter.js');
    const STLExporter = mod.STLExporter;
    const exporter = new STLExporter();
    const target = scene.children.find(function(c) {
        return c.isMesh && !c.userData.isMeasure && !c.userData.opId;
    });
    if (!target) {
        setStatus('Nothing to export yet');
        return;
    }
    const data = exporter.parse(target, { binary: true });
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'antigravity_model.stl';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Model exported as antigravity_model.stl');
}

// --- boot() -- called after initScene() is ready ---
function boot() {
    wireTransformControls();

    // Shape buttons
    document.querySelectorAll('[data-shape]').forEach(function(btn) {
        btn.addEventListener('click', function() { addShape(btn.dataset.shape); });
    });

    // Boolean mode
    document.querySelectorAll('.mode-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            state.currentMode = btn.dataset.mode;
            setStatus('Boolean mode: ' + btn.dataset.mode);
        });
    });

    // Transform mode
    document.querySelectorAll('.transform-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.transform-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            state.transformMode = btn.dataset.transform;
            transformControls.setMode(state.transformMode);
            setStatus('Transform: ' + btn.dataset.transform);
        });
    });

    // Sketch buttons
    btnNewSketch.addEventListener('click', enterSketchMode);
    btnExitSketch.addEventListener('click', exitSketchMode);
    btnExtrude.addEventListener('click', doExtrude);
    document.getElementById('btn-do-extrude').addEventListener('click', doExtrude);
    document.getElementById('btn-revolve').addEventListener('click', doRevolve);

    // Sketch tool buttons
    document.getElementById('sk-line').addEventListener('click', function() {
        document.querySelectorAll('#sketch-toolbar .sk-btn').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('sk-line').classList.add('active');
        if (sketcher) sketcher.setTool('line');
    });
    document.getElementById('sk-rect').addEventListener('click', function() {
        document.querySelectorAll('#sketch-toolbar .sk-btn').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('sk-rect').classList.add('active');
        if (sketcher) sketcher.setTool('rect');
    });
    document.getElementById('sk-circle').addEventListener('click', function() {
        document.querySelectorAll('#sketch-toolbar .sk-btn').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('sk-circle').classList.add('active');
        if (sketcher) sketcher.setTool('circle');
    });
    document.getElementById('sk-polygon').addEventListener('click', function() {
        document.querySelectorAll('#sketch-toolbar .sk-btn').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('sk-polygon').classList.add('active');
        if (sketcher) sketcher.setTool('polygon');
    });
    document.getElementById('sk-arc').addEventListener('click', function() {
        document.querySelectorAll('#sketch-toolbar .sk-btn').forEach(function(b) { b.classList.remove('active'); });
        document.getElementById('sk-arc').classList.add('active');
        if (sketcher) sketcher.setTool('arc');
    });
    document.getElementById('sk-undo-line').addEventListener('click', function() {
        if (sketcher) sketcher._undoLastSegment();
    });
    document.getElementById('sk-close-shape').addEventListener('click', function() {
        if (sketcher) sketcher._closeShape();
    });

    // Measure
    document.getElementById('btn-measure').addEventListener('click', function() {
        measureMode = !measureMode;
        document.getElementById('btn-measure').classList.toggle('active', measureMode);
        if (!measureMode) clearMeasure();
        setStatus(measureMode ? 'Click two points to measure distance' : 'Ready');
    });
    document.getElementById('measure-clear').addEventListener('click', clearMeasure);

    // Undo/Redo
    document.getElementById('btn-undo').addEventListener('click', function() { if (undo()) refresh(); });
    document.getElementById('btn-redo').addEventListener('click', function() { if (redo()) refresh(); });

    // Export
    document.getElementById('btn-export').addEventListener('click', exportSTL);

    // View buttons
    document.querySelectorAll('.view-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { setView(btn.dataset.view); });
    });

    // Canvas click for measure
    canvas.addEventListener('click', handleMeasureClick);

    // Canvas click for selection/deselection
    canvas.addEventListener('mousedown', function(e) {
        if (inSketchMode || measureMode) return;
        if (transformControls.dragging || transformControls.axis) return;
        
        var rect = canvas.getBoundingClientRect();
        var mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        var my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        var ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(mx, my), camera);
        
        var hits = resultMesh ? ray.intersectObject(resultMesh) : [];
        if (hits.length === 0) {
            state.selectedId = null;
            refresh();
        }
    });

    // Mouse move for coordinate display
    canvas.addEventListener('mousemove', function(e) {
        var pt = raycastGround(e.clientX, e.clientY, canvas);
        if (pt) {
            coordDisplay.textContent = 'X: ' + pt.x.toFixed(1) + '  Y: ' + pt.y.toFixed(1) + '  Z: ' + pt.z.toFixed(1) + ' mm';
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (undo()) refresh(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); if (redo()) refresh(); }
        if (!e.ctrlKey && !e.altKey) {
            if (e.key === 'b') addShape('box');
            if (e.key === 'c') addShape('cylinder');
            if (e.key === 's') addShape('sphere');
            if (e.key === 'g') document.getElementById('btn-translate').click();
            if (e.key === 'r') document.getElementById('btn-rotate').click();
            if (e.key === 'm') document.getElementById('btn-measure').click();
            if (e.key === 'k') btnNewSketch.click();
            if (e.key === 'e' && inSketchMode) doExtrude();
            if (e.key === 'Escape' && inSketchMode) exitSketchMode();
            if (e.key === 'Delete' && state.selectedId) deleteOp(state.selectedId);
        }
    });

    pushHistory();
    startRenderLoop();
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    console.log('Antigravity CAD Pro v2.1.1 Booted Successfully');
    setStatus('Ready -- Press K for New Sketch, or click a Primitive to start');
    // Context Menu Logic
    const contextMenu = document.getElementById('context-menu');
    const cmGlobal = document.getElementById('cm-global-options');
    const cmObject = document.getElementById('cm-object-options');
    const cmSketch = document.getElementById('cm-sketch-options');
    const cmObjTitle = document.getElementById('cm-object-title');

    function hideContextMenu() {
        contextMenu.classList.remove('active');
    }

    window.addEventListener('click', hideContextMenu);
    window.addEventListener('contextmenu', function(e) {
        if (e.target.tagName === 'CANVAS') {
            e.preventDefault();
            contextMenu.style.left = e.pageX + 'px';
            contextMenu.style.top = e.pageY + 'px';
            
            if (inSketchMode) {
                cmGlobal.style.display = 'none';
                cmObject.style.display = 'none';
                cmSketch.style.display = 'flex';
            } else {
                cmSketch.style.display = 'none';
                
                // Raycast to check for object click
                var rect = canvas.getBoundingClientRect();
                var mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                var my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                var ray = new THREE.Raycaster();
                ray.setFromCamera(new THREE.Vector2(mx, my), camera);
                
                // Exclude ghosts and helpers
                var objectsToIntersect = scene.children.filter(c => c.isMesh && !c.userData.isMeasure && !c.parent?.userData?.isGhostGroup);
                
                // In a proper implementation, we should intersect the individual feature meshes if we split them.
                // Currently resultMesh is a single merged mesh. For this prototype step, we will use state.selectedId if an object is selected.
                var hits = resultMesh ? ray.intersectObject(resultMesh) : [];
                
                if (hits.length > 0 || state.selectedId) {
                    // Object Menu
                    cmGlobal.style.display = 'none';
                    cmObject.style.display = 'flex';
                    
                    // Try to show feature name if one is selected
                    const selectedOp = state.operations.find(o => o.id === state.selectedId);
                    cmObjTitle.textContent = selectedOp ? selectedOp.name : 'Feature';
                } else {
                    // Global Menu (Empty space)
                    cmGlobal.style.display = 'flex';
                    cmObject.style.display = 'none';
                }
            }
            contextMenu.classList.add('active');
        } else {
            hideContextMenu();
        }
    });

    // Global Menu Actions
    document.getElementById('cm-global-new-sketch').addEventListener('click', enterSketchMode);
    document.querySelectorAll('[data-cm-shape]').forEach(function(btn) {
        btn.addEventListener('click', function() { addShape(btn.dataset.cmShape); });
    });
    document.getElementById('cm-global-export').addEventListener('click', exportSTL);

    // Object Menu Actions
    document.getElementById('cm-obj-edit').addEventListener('click', function() {
        // Just focus the properties panel for now
        document.getElementById('props-panel').scrollIntoView();
        setStatus('Editing feature properties');
    });
    document.getElementById('cm-obj-color').addEventListener('click', function() {
        setStatus('Appearance change coming soon');
    });
    document.getElementById('cm-obj-delete').addEventListener('click', function() {
        if (state.selectedId) {
            deleteOp(state.selectedId);
        } else if (state.operations.length > 0) {
             deleteOp(state.operations[state.operations.length - 1].id);
        }
    });
    
    // Sketch Menu Actions
    document.getElementById('cm-sk-close').addEventListener('click', function() {
        if (sketcher) sketcher._closeShape();
    });
    document.getElementById('cm-sk-extrude').addEventListener('click', doExtrude);
    document.getElementById('cm-sk-revolve').addEventListener('click', doRevolve);
    document.getElementById('cm-sk-cancel').addEventListener('click', exitSketchMode);

    // Command HUD Logic
    const cmdHud = document.getElementById('command-hud');
    const cmdInput = document.getElementById('cmd-input');
    const cmdList = document.getElementById('cmd-list');

    const commands = [
        { name: 'Box', action: () => addShape('box'), shortcut: 'B' },
        { name: 'Cylinder', action: () => addShape('cylinder'), shortcut: 'C' },
        { name: 'Sphere', action: () => addShape('sphere'), shortcut: 'S' },
        { name: 'New Sketch', action: enterSketchMode, shortcut: 'K' },
        { name: 'Extrude', action: doExtrude, shortcut: 'E' },
        { name: 'Revolve', action: doRevolve, shortcut: '' },
        { name: 'Measure', action: () => document.getElementById('btn-measure').click(), shortcut: 'M' },
        { name: 'Translate', action: () => document.getElementById('btn-translate').click(), shortcut: 'G' },
        { name: 'Rotate', action: () => document.getElementById('btn-rotate').click(), shortcut: 'R' },
        { name: 'Export STL', action: exportSTL, shortcut: '' }
    ];

    let selectedCmdIndex = 0;
    let filteredCmds = [];

    function renderCmds() {
        cmdList.innerHTML = filteredCmds.map((cmd, i) => 
            `<div class="cmd-item ${i === selectedCmdIndex ? 'selected' : ''}" data-index="${i}">
                <span>${cmd.name}</span>
                ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ''}
            </div>`
        ).join('');
        
        cmdList.querySelectorAll('.cmd-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                executeCmd(idx);
            });
            item.addEventListener('mouseenter', () => {
                selectedCmdIndex = parseInt(item.dataset.index);
                renderCmds();
            });
        });
    }

    function executeCmd(idx) {
        if (filteredCmds[idx]) {
            cmdHud.classList.remove('active');
            filteredCmds[idx].action();
        }
    }

    cmdInput.addEventListener('input', () => {
        const query = cmdInput.value.toLowerCase();
        filteredCmds = commands.filter(cmd => cmd.name.toLowerCase().includes(query));
        selectedCmdIndex = 0;
        renderCmds();
    });

    cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedCmdIndex = (selectedCmdIndex + 1) % filteredCmds.length;
            renderCmds();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedCmdIndex = (selectedCmdIndex - 1 + filteredCmds.length) % filteredCmds.length;
            renderCmds();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            executeCmd(selectedCmdIndex);
        } else if (e.key === 'Escape') {
            cmdHud.classList.remove('active');
            canvas.focus();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName !== 'INPUT' && e.key === ' ') {
            e.preventDefault();
            filteredCmds = [...commands];
            selectedCmdIndex = 0;
            cmdInput.value = '';
            cmdHud.classList.add('active');
            cmdInput.focus();
            renderCmds();
        } else if (cmdHud.classList.contains('active') && e.key === 'Escape') {
            cmdHud.classList.remove('active');
            canvas.focus();
        }
    });

}
