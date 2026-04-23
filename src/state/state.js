// State Management -- Antigravity CAD Pro
export var state = {
    operations: [],
    selectedId: null,
    currentMode: 'add',
    transformMode: 'translate',
    counters: { box: 0, cylinder: 0, sphere: 0, cone: 0, torus: 0, extrude: 0 },
    history: [],
    historyIndex: -1,
    nextId: 1
};

export function genId() {
    return 'op_' + (state.nextId++);
}

export function getDefaults(type) {
    var d = {
        box:      { width: 50, height: 50, depth: 50 },
        cylinder: { radius: 25, height: 50, segments: 32 },
        sphere:   { radius: 25, widthSeg: 32, heightSeg: 24 },
        cone:     { radius: 25, height: 50, segments: 32 },
        torus:    { radius: 30, tube: 10, radialSeg: 16, tubularSeg: 48 }
    };
    return d[type] || d.box;
}

export function pushHistory() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    // Deep copy but skip non-serializable _geom
    var snap = state.operations.map(function(op) {
        var copy = Object.assign({}, op);
        delete copy._geom;
        copy.dimensions = Object.assign({}, op.dimensions);
        copy.position = Object.assign({}, op.position);
        copy.rotation = Object.assign({}, op.rotation);
        if (op.sketchShapes) copy.sketchShapes = JSON.parse(JSON.stringify(op.sketchShapes));
        return copy;
    });
    state.history.push(snap);
    state.historyIndex = state.history.length - 1;
}

export function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        state.operations = state.history[state.historyIndex].map(function(op) {
            var copy = Object.assign({}, op,
                { dimensions: Object.assign({}, op.dimensions),
                  position: Object.assign({}, op.position),
                  rotation: Object.assign({}, op.rotation) });
            if (op.sketchShapes) copy.sketchShapes = JSON.parse(JSON.stringify(op.sketchShapes));
            return copy;
        });
        return true;
    }
    return false;
}

export function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        state.operations = state.history[state.historyIndex].map(function(op) {
            var copy = Object.assign({}, op,
                { dimensions: Object.assign({}, op.dimensions),
                  position: Object.assign({}, op.position),
                  rotation: Object.assign({}, op.rotation) });
            if (op.sketchShapes) copy.sketchShapes = JSON.parse(JSON.stringify(op.sketchShapes));
            return copy;
        });
        return true;
    }
    return false;
}
