// Sketch Engine - Antigravity CAD Pro v2
// 2D drawing on canvas overlay -> extrude to 3D via THREE.js ExtrudeGeometry
import * as THREE from 'three';
import { CSG } from '../core/csg.js';

var SNAP_DIST = 10; // px - snap threshold

// --- PBD Solver ---
class PBDSolver {
    constructor() { this.constraints = []; }
    solve(iters = 100) {
        for(var i=0; i<iters; i++) {
            for(var j=0; j<this.constraints.length; j++) this.constraints[j].solve();
        }
    }
}
class DistanceConstraint {
    constructor(p1, p2, dist, weight) {
        this.p1 = p1; this.p2 = p2; this.dist = dist; this.weight = weight || 1.0;
    }
    solve() {
        var dx = this.p2.x - this.p1.x, dy = this.p2.y - this.p1.y;
        var d = Math.hypot(dx, dy);
        if (d < 1e-5) return;
        var diff = ((d - this.dist) / d) * this.weight * 0.5;
        var px = dx * diff, py = dy * diff;
        if (!this.p1.fixed) { this.p1.x += px; this.p1.y += py; }
        if (!this.p2.fixed) { this.p2.x -= px; this.p2.y -= py; }
    }
}
class AxisConstraint {
    constructor(p1, p2, axis, weight) {
        this.p1 = p1; this.p2 = p2; this.axis = axis; this.weight = weight || 1.0;
    }
    solve() {
        var diff = (this.p2[this.axis] - this.p1[this.axis]) * 0.5 * this.weight;
        if (!this.p1.fixed) this.p1[this.axis] += diff;
        if (!this.p2.fixed) this.p2[this.axis] -= diff;
    }
}

export function createExtrudeGeometry(shapesData, extrusionDepth, onYOffset) {
    if (onYOffset === undefined) onYOffset = 0;
    if (!shapesData || !shapesData.length) return new THREE.BoxGeometry(1,1,1);
    
    var geoms = [];
    for (var si = 0; si < shapesData.length; si++) {
        var sh = shapesData[si];
        var shape = new THREE.Shape();
        if (sh.type === 'poly' && sh.pts.length >= 3) {
            shape.moveTo(sh.pts[0].x, sh.pts[0].y);
            for (var i = 1; i < sh.pts.length; i++) shape.lineTo(sh.pts[i].x, sh.pts[i].y);
            shape.closePath();
        } else if (sh.type === 'circle') {
            if (sh.r < 0.1) continue;
            shape.absarc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2, false);
        } else if (sh.type === 'arc') {
            if (sh.r < 0.1) continue;
            shape.moveTo(sh.cx, sh.cy);
            shape.absarc(sh.cx, sh.cy, sh.r, sh.startAngle, sh.endAngle, false);
            shape.closePath();
        } else { continue; }
        
        var extSettings = { depth: extrusionDepth, bevelEnabled: false, steps: 1, curveSegments: 48 };
        var geom = new THREE.ExtrudeGeometry(shape, extSettings);
        geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        geom.applyMatrix4(new THREE.Matrix4().makeTranslation(0, onYOffset, 0));
        geom.computeVertexNormals();
        geoms.push(geom);
    }
    
    if (geoms.length === 0) return new THREE.BoxGeometry(1,1,1);
    if (geoms.length === 1) return geoms[0];
    
    // Merge via CSG
    var combinedCSG = CSG.fromGeometry(geoms[0]);
    for(var k=1; k<geoms.length; k++) {
        combinedCSG = combinedCSG.union(CSG.fromGeometry(geoms[k]));
    }
    return combinedCSG.toGeometry();
}

export function createRevolveGeometry(shapesData, angle, segments) {
    if (!shapesData || !shapesData.length) return new THREE.BoxGeometry(1,1,1);
    var geoms = [];
    var radAngle = angle * Math.PI / 180;
    
    for (var si = 0; si < shapesData.length; si++) {
        var sh = shapesData[si];
        var points = [];
        if (sh.type === 'poly' && sh.pts.length >= 3) {
            for (var i = 0; i < sh.pts.length; i++) {
                points.push(new THREE.Vector2(sh.pts[i].x, sh.pts[i].y));
            }
            points.push(new THREE.Vector2(sh.pts[0].x, sh.pts[0].y));
        } else if (sh.type === 'circle') {
            var csegs = 32;
            for(var i=0; i<=csegs; i++) {
                var a = i * Math.PI * 2 / csegs;
                points.push(new THREE.Vector2(sh.cx + Math.cos(a)*sh.r, sh.cy + Math.sin(a)*sh.r));
            }
        } else if (sh.type === 'arc') {
            var asegs = 16;
            points.push(new THREE.Vector2(sh.cx, sh.cy));
            for(var i=0; i<=asegs; i++) {
                var a = sh.startAngle + (sh.endAngle - sh.startAngle) * (i/asegs);
                points.push(new THREE.Vector2(sh.cx + Math.cos(a)*sh.r, sh.cy + Math.sin(a)*sh.r));
            }
            points.push(new THREE.Vector2(sh.cx, sh.cy));
        } else { continue; }
        
        var geom = new THREE.LatheGeometry(points, segments || 32, 0, radAngle);
        geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        geom.computeVertexNormals();
        geoms.push(geom);
    }
    
    if (geoms.length === 0) return new THREE.BoxGeometry(1,1,1);
    if (geoms.length === 1) return geoms[0];
    
    var combinedCSG = CSG.fromGeometry(geoms[0]);
    for(var k=1; k<geoms.length; k++) {
        combinedCSG = combinedCSG.union(CSG.fromGeometry(geoms[k]));
    }
    return combinedCSG.toGeometry();
}

export class SketchEngine {
    constructor(skCanvas, threeCanvas, camera, scene) {
        this.skCanvas = skCanvas;
        this.threeCanvas = threeCanvas;
        this.camera = camera;
        this.scene = scene;
        this.ctx = skCanvas.getContext('2d');

        this.active = false;
        this.tool = 'line';
        this.shapes = [];
        this.currentPts = [];
        this.previewPt = null;
        this.startPt = null;
        this.arcStartPt = null;
        this.sketchPlaneY = 0;
        this.dimensions = {};

        this._onMouseMove = this._onMouseMove.bind(this);
        this._onClick = this._onClick.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onKey = this._onKey.bind(this);
        this._resizeObserver = new ResizeObserver(this._syncSize.bind(this));
    }

    enter(planeY) {
        this.active = true;
        this.sketchPlaneY = planeY || 0;
        this.shapes = [];
        this.currentPts = [];
        this.dimensions = {};
        this._syncSize();
        this.skCanvas.style.display = 'block';
        this.skCanvas.addEventListener('mousemove', this._onMouseMove);
        this.skCanvas.addEventListener('click', this._onClick);
        this.skCanvas.addEventListener('dblclick', this._onDblClick);
        window.addEventListener('keydown', this._onKey);
        this._resizeObserver.observe(this.skCanvas.parentElement);
        this._draw();
    }

    exit() {
        this.active = false;
        this.skCanvas.style.display = 'none';
        this.skCanvas.removeEventListener('mousemove', this._onMouseMove);
        this.skCanvas.removeEventListener('click', this._onClick);
        this.skCanvas.removeEventListener('dblclick', this._onDblClick);
        window.removeEventListener('keydown', this._onKey);
        this._resizeObserver.disconnect();
        this.ctx.clearRect(0, 0, this.skCanvas.width, this.skCanvas.height);
    }

    setTool(t) {
        this.tool = t;
        this.currentPts = [];
        this.startPt = null;
        this.arcStartPt = null;
    }

    _syncSize() {
        var parent = this.skCanvas.parentElement;
        var w = Math.max(parent.offsetWidth || parent.clientWidth, 100);
        var h = Math.max(parent.offsetHeight || parent.clientHeight, 100);
        this.skCanvas.width = w;
        this.skCanvas.height = h;
        this.skCanvas.style.width = w + 'px';
        this.skCanvas.style.height = h + 'px';
        this._draw();
    }

    _screenToWorld(x, y) {
        var W = this.skCanvas.width, H = this.skCanvas.height;
        var nx = (x / W) * 2 - 1;
        var ny = -(y / H) * 2 + 1;
        var vec = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera);
        var dir = vec.sub(this.camera.position).normalize();
        if (Math.abs(dir.y) < 0.0001) return { x: 0, y: 0 };
        var t = (this.sketchPlaneY - this.camera.position.y) / dir.y;
        var pt = new THREE.Vector3().copy(this.camera.position).addScaledVector(dir, t);
        return { x: pt.x, y: pt.z };
    }

    _worldToScreen(wx, wy) {
        var vec = new THREE.Vector3(wx, this.sketchPlaneY, wy);
        vec.project(this.camera);
        var W = this.skCanvas.width, H = this.skCanvas.height;
        return {
            x: (vec.x + 1) / 2 * W,
            y: -(vec.y - 1) / 2 * H
        };
    }

    _snap(x, y) {
        var gridMM = 5;
        var wx = this._screenToWorld(x, y);
        wx.x = Math.round(wx.x / gridMM) * gridMM;
        wx.y = Math.round(wx.y / gridMM) * gridMM;

        var best = null, bestD = SNAP_DIST;
        var allPts = this._getAllPts();
        for (var i = 0; i < allPts.length; i++) {
            var p = allPts[i];
            var s = this._worldToScreen(p.x, p.y);
            var d = Math.hypot(s.x - x, s.y - y);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best || wx;
    }

    _getAllPts() {
        var pts = [];
        for (var i = 0; i < this.shapes.length; i++) {
            var sh = this.shapes[i];
            if (sh.type === 'poly') {
                for (var j = 0; j < sh.pts.length; j++) pts.push(sh.pts[j]);
            }
        }
        for (var k = 0; k < this.currentPts.length; k++) pts.push(this.currentPts[k]);
        return pts;
    }

    _onMouseMove(e) {
        this.previewPt = this._snap(e.offsetX, e.offsetY);
        this._draw();
    }

    _onClick(e) {
        var pt = this._snap(e.offsetX, e.offsetY);

        if (this.tool === 'line') {
            if (this.currentPts.length >= 3) {
                var first = this.currentPts[0];
                var s = this._worldToScreen(first.x, first.y);
                if (Math.hypot(s.x - e.offsetX, s.y - e.offsetY) < SNAP_DIST) {
                    this._closeShape();
                    return;
                }
            }
            this.currentPts.push({ x: pt.x, y: pt.y });
            this._draw();

        } else if (this.tool === 'rect') {
            if (!this.startPt) {
                this.startPt = pt;
            } else {
                var p1 = this.startPt, p2 = pt;
                var pts = [
                    {x: p1.x, y: p1.y},
                    {x: p2.x, y: p1.y},
                    {x: p2.x, y: p2.y},
                    {x: p1.x, y: p2.y}
                ];
                var poly = { type: 'poly', pts: pts, constraints: [
                    {type:'axis', i:0, j:1, axis:'y'},
                    {type:'axis', i:1, j:2, axis:'x'},
                    {type:'axis', i:2, j:3, axis:'y'},
                    {type:'axis', i:3, j:0, axis:'x'}
                ]};
                this.shapes.push(poly);
                this.startPt = null;
                this._buildDimensions();
                this._draw();
                this._fireDimensionsUpdate();
            }

        } else if (this.tool === 'circle') {
            if (!this.startPt) {
                this.startPt = pt;
            } else {
                var cx = this.startPt.x, cy = this.startPt.y;
                var r = Math.hypot(pt.x - cx, pt.y - cy);
                this.shapes.push({ type: 'circle', cx: cx, cy: cy, r: r });
                this.startPt = null;
                this._buildDimensions();
                this._draw();
                this._fireDimensionsUpdate();
            }
        } else if (this.tool === 'polygon') {
            if (!this.startPt) {
                this.startPt = pt;
            } else {
                var cx = this.startPt.x, cy = this.startPt.y;
                var r = Math.hypot(pt.x - cx, pt.y - cy);
                var angleOffset = Math.atan2(pt.y - cy, pt.x - cx);
                var sides = 6; // Hexagon
                var pts = [];
                for(var i=0; i<sides; i++) {
                    var a = angleOffset + (i * Math.PI * 2 / sides);
                    pts.push({ x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r });
                }
                var poly = { type: 'poly', pts: pts, constraints: [] };
                this.shapes.push(poly);
                this.startPt = null;
                this._buildDimensions();
                this._draw();
                this._fireDimensionsUpdate();
            }
        } else if (this.tool === 'arc') {
            if (!this.startPt) {
                this.startPt = pt;
            } else if (!this.arcStartPt) {
                this.arcStartPt = pt;
            } else {
                var cx = this.startPt.x, cy = this.startPt.y;
                var r = Math.hypot(this.arcStartPt.x - cx, this.arcStartPt.y - cy);
                var startA = Math.atan2(this.arcStartPt.y - cy, this.arcStartPt.x - cx);
                var endA = Math.atan2(pt.y - cy, pt.x - cx);
                // Ensure it draws the shortest path or specific winding
                if (endA < startA) endA += Math.PI * 2;
                this.shapes.push({ type: 'arc', cx: cx, cy: cy, r: r, startAngle: startA, endAngle: endA });
                this.startPt = null;
                this.arcStartPt = null;
                this._buildDimensions();
                this._draw();
                this._fireDimensionsUpdate();
            }
        }
    }

    _onDblClick(e) {
        if (this.tool === 'line' && this.currentPts.length >= 2) {
            this._closeShape();
        }
    }

    _onKey(e) {
        if (!this.active) return;
        if (e.key === 'Escape') { this.currentPts = []; this.startPt = null; this.arcStartPt = null; this._draw(); }
        if (e.key === 'l' || e.key === 'L') { this.setTool('line'); window.dispatchEvent(new CustomEvent('tool-changed', {detail: 'line'})); }
        if (e.key === 'z' && e.ctrlKey) { e.preventDefault(); this._undoLastSegment(); }
    }

    _closeShape() {
        if (this.currentPts.length < 3) return;
        var pts = this.currentPts.slice();
        var constraints = [];
        // Auto-detect orthogonal constraints (within 5% of axis)
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i], b = pts[(i + 1) % pts.length];
            var dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
            if (dx < dy * 0.05) constraints.push({type: 'axis', i: i, j: (i+1)%pts.length, axis: 'x'}); // vertical
            if (dy < dx * 0.05) constraints.push({type: 'axis', i: i, j: (i+1)%pts.length, axis: 'y'}); // horizontal
        }
        this.shapes.push({ type: 'poly', pts: pts, constraints: constraints });
        this.currentPts = [];
        this._buildDimensions();
        this._draw();
        this._fireDimensionsUpdate();
    }

    _undoLastSegment() {
        if (this.currentPts.length > 0) {
            this.currentPts.pop();
        } else if (this.shapes.length > 0) {
            var last = this.shapes.pop();
            if (last.type === 'poly') this.currentPts = last.pts.slice();
        }
        this._buildDimensions();
        this._draw();
        this._fireDimensionsUpdate();
    }

    _buildDimensions() {
        var dims = {};
        var idx = 0;
        for (var si = 0; si < this.shapes.length; si++) {
            var sh = this.shapes[si];
            if (sh.type === 'poly') {
                for (var i = 0; i < sh.pts.length; i++) {
                    var a = sh.pts[i], b = sh.pts[(i + 1) % sh.pts.length];
                    var len = Math.hypot(b.x - a.x, b.y - a.y);
                    dims['poly_' + idx + '_seg_' + i] = { label: 'Seg ' + (i + 1), value: +len.toFixed(2), shapeIdx: idx, segIdx: i, type: 'seg' };
                }
            } else if (sh.type === 'circle') {
                dims['circle_' + idx + '_r'] = { label: 'Radius', value: +sh.r.toFixed(2), shapeIdx: idx, type: 'circle_r' };
            } else if (sh.type === 'arc') {
                dims['arc_' + idx + '_r'] = { label: 'Arc Rad', value: +sh.r.toFixed(2), shapeIdx: idx, type: 'arc_r' };
            }
            idx++;
        }
        this.dimensions = dims;
    }

    applyDimension(key, newVal) {
        var dim = this.dimensions[key];
        if (!dim) return;
        var sh = this.shapes[dim.shapeIdx];
        if (!sh) return;

        if (dim.type === 'seg' && sh.type === 'poly') {
            var solver = new PBDSolver();
            // Add soft constraints for all edges
            for (var i = 0; i < sh.pts.length; i++) {
                var a = sh.pts[i], b = sh.pts[(i + 1) % sh.pts.length];
                var initLen = Math.hypot(b.x - a.x, b.y - a.y);
                solver.constraints.push(new DistanceConstraint(a, b, initLen, 0.1)); // Soft
            }
            // Add axis constraints
            if (sh.constraints) {
                for (var c=0; c<sh.constraints.length; c++) {
                    var cx = sh.constraints[c];
                    if (cx.type === 'axis') {
                        solver.constraints.push(new AxisConstraint(sh.pts[cx.i], sh.pts[cx.j], cx.axis, 1.0));
                    }
                }
            }
            // Add hard constraint for the edited edge
            var editA = sh.pts[dim.segIdx], editB = sh.pts[(dim.segIdx + 1) % sh.pts.length];
            solver.constraints.push(new DistanceConstraint(editA, editB, newVal, 1.0)); // Hard
            
            // Fix the first point to prevent drift
            editA.fixed = true;
            
            // Solve
            solver.solve(100);
            editA.fixed = false;
            
        } else if (dim.type === 'circle_r' && sh.type === 'circle') {
            sh.r = newVal;
        } else if (dim.type === 'arc_r' && sh.type === 'arc') {
            sh.r = newVal;
        }
        this._buildDimensions();
        this._draw();
    }

    _fireDimensionsUpdate() {
        this.skCanvas.dispatchEvent(new CustomEvent('sketch-dims', { detail: this.dimensions }));
    }

    _draw() {
        var ctx = this.ctx;
        var W = this.skCanvas.width, H = this.skCanvas.height;
        ctx.clearRect(0, 0, W, H);
        this._drawGrid(ctx, W, H);

        for (var i = 0; i < this.shapes.length; i++) {
            this._drawShape(ctx, this.shapes[i]);
        }

        // In-progress line
        if (this.tool === 'line' && this.currentPts.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            var s0 = this._worldToScreen(this.currentPts[0].x, this.currentPts[0].y);
            ctx.moveTo(s0.x, s0.y);
            for (var j = 1; j < this.currentPts.length; j++) {
                var si = this._worldToScreen(this.currentPts[j].x, this.currentPts[j].y);
                ctx.lineTo(si.x, si.y);
            }
            if (this.previewPt) {
                var sp = this._worldToScreen(this.previewPt.x, this.previewPt.y);
                ctx.lineTo(sp.x, sp.y);
            }
            ctx.stroke();

            // Close hint
            if (this.currentPts.length >= 3 && this.previewPt) {
                var first = this.currentPts[0];
                var sf = this._worldToScreen(first.x, first.y);
                var sp2 = this._worldToScreen(this.previewPt.x, this.previewPt.y);
                if (Math.hypot(sf.x - sp2.x, sf.y - sp2.y) < SNAP_DIST) {
                    ctx.beginPath();
                    ctx.arc(sf.x, sf.y, 8, 0, Math.PI * 2);
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                }
            }

            // Points
            for (var k = 0; k < this.currentPts.length; k++) {
                var sk = this._worldToScreen(this.currentPts[k].x, this.currentPts[k].y);
                ctx.beginPath();
                ctx.arc(sk.x, sk.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#a855f7';
                ctx.fill();
            }
        }

        // Rect preview
        if (this.tool === 'rect' && this.startPt && this.previewPt) {
            var r1 = this._worldToScreen(this.startPt.x, this.startPt.y);
            var r2 = this._worldToScreen(this.previewPt.x, this.previewPt.y);
            ctx.beginPath();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(r1.x, r1.y, r2.x - r1.x, r2.y - r1.y);
            ctx.setLineDash([]);
            this._drawDimLabel(ctx, r1.x, r1.y, r2.x, r1.y,
                Math.abs(this.previewPt.x - this.startPt.x).toFixed(1) + ' mm');
            this._drawDimLabel(ctx, r2.x, r1.y, r2.x, r2.y,
                Math.abs(this.previewPt.y - this.startPt.y).toFixed(1) + ' mm');
        }

        // Circle preview
        if (this.tool === 'circle' && this.startPt && this.previewPt) {
            var sc = this._worldToScreen(this.startPt.x, this.startPt.y);
            var se = this._worldToScreen(this.previewPt.x, this.previewPt.y);
            var rpx = Math.hypot(se.x - sc.x, se.y - sc.y);
            var rMM = Math.hypot(this.previewPt.x - this.startPt.x, this.previewPt.y - this.startPt.y);
            ctx.beginPath();
            ctx.arc(sc.x, sc.y, rpx, 0, Math.PI * 2);
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#a855f7'; ctx.fill();
            this._drawDimLabel(ctx, sc.x, sc.y, se.x, se.y, 'R' + rMM.toFixed(1) + ' mm');
        }

        // Polygon preview
        if (this.tool === 'polygon' && this.startPt && this.previewPt) {
            var cx = this.startPt.x, cy = this.startPt.y;
            var rMM = Math.hypot(this.previewPt.x - cx, this.previewPt.y - cy);
            var angleOffset = Math.atan2(this.previewPt.y - cy, this.previewPt.x - cx);
            var sides = 6;
            ctx.beginPath();
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            for(var i=0; i<sides; i++) {
                var a = angleOffset + (i * Math.PI * 2 / sides);
                var px = cx + Math.cos(a)*rMM;
                var py = cy + Math.sin(a)*rMM;
                var sp = this._worldToScreen(px, py);
                if (i===0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            var sc = this._worldToScreen(cx, cy);
            var se = this._worldToScreen(this.previewPt.x, this.previewPt.y);
            ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(se.x, se.y);
            ctx.strokeStyle = 'rgba(168,85,247,0.5)'; ctx.stroke();
            this._drawDimLabel(ctx, sc.x, sc.y, se.x, se.y, 'R' + rMM.toFixed(1) + ' mm');
        }

        // Arc preview
        if (this.tool === 'arc' && this.startPt && this.previewPt) {
            var sc = this._worldToScreen(this.startPt.x, this.startPt.y);
            
            if (!this.arcStartPt) {
                // defining radius and start angle
                var se = this._worldToScreen(this.previewPt.x, this.previewPt.y);
                var rMM = Math.hypot(this.previewPt.x - this.startPt.x, this.previewPt.y - this.startPt.y);
                ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(se.x, se.y);
                ctx.strokeStyle = 'rgba(168,85,247,0.5)'; ctx.stroke();
                this._drawDimLabel(ctx, sc.x, sc.y, se.x, se.y, 'R' + rMM.toFixed(1) + ' mm');
                ctx.beginPath(); ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#a855f7'; ctx.fill();
            } else {
                // defining end angle
                var rMM = Math.hypot(this.arcStartPt.x - this.startPt.x, this.arcStartPt.y - this.startPt.y);
                var sa = this._worldToScreen(this.arcStartPt.x, this.arcStartPt.y);
                var rpx = Math.hypot(sa.x - sc.x, sa.y - sc.y);
                var startA = Math.atan2(sa.y - sc.y, sa.x - sc.x);
                var pe = this._worldToScreen(this.previewPt.x, this.previewPt.y);
                var endA = Math.atan2(pe.y - sc.y, pe.x - sc.x);
                if (endA < startA) endA += Math.PI * 2;
                
                ctx.beginPath();
                ctx.moveTo(sc.x, sc.y);
                ctx.arc(sc.x, sc.y, rpx, startA, endA, false);
                ctx.closePath();
                ctx.fillStyle = 'rgba(168,85,247,0.1)'; ctx.fill();
                
                ctx.beginPath();
                ctx.arc(sc.x, sc.y, rpx, startA, endA, false);
                ctx.strokeStyle = '#a855f7';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(sa.x, sa.y);
                ctx.strokeStyle = 'rgba(168,85,247,0.5)'; ctx.stroke();
                ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(pe.x, pe.y);
                ctx.stroke();
            }
        }

        // Cursor dot
        if (this.previewPt) {
            var cp = this._worldToScreen(this.previewPt.x, this.previewPt.y);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(168,85,247,0.7)';
            ctx.fill();
        }
    }

    _drawGrid(ctx, W, H) {
        var o = this._worldToScreen(0, 0);
        ctx.save();
        ctx.strokeStyle = 'rgba(59,130,246,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, o.y); ctx.lineTo(W, o.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    _drawShape(ctx, sh) {
        ctx.save();
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;

        if (sh.type === 'poly') {
            var s0 = this._worldToScreen(sh.pts[0].x, sh.pts[0].y);
            ctx.beginPath();
            ctx.moveTo(s0.x, s0.y);
            for (var i = 1; i < sh.pts.length; i++) {
                var si = this._worldToScreen(sh.pts[i].x, sh.pts[i].y);
                ctx.lineTo(si.x, si.y);
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(168,85,247,0.06)';
            ctx.fill();
            ctx.stroke();
            for (var j = 0; j < sh.pts.length; j++) {
                var a = sh.pts[j], b = sh.pts[(j + 1) % sh.pts.length];
                var sa = this._worldToScreen(a.x, a.y), sb = this._worldToScreen(b.x, b.y);
                var len = Math.hypot(b.x - a.x, b.y - a.y);
                this._drawDimLabel(ctx, sa.x, sa.y, sb.x, sb.y, len.toFixed(1) + ' mm');
            }

        } else if (sh.type === 'circle') {
            var sc = this._worldToScreen(sh.cx, sh.cy);
            var se = this._worldToScreen(sh.cx + sh.r, sh.cy);
            var rpx = Math.hypot(se.x - sc.x, se.y - sc.y);
            ctx.beginPath(); ctx.arc(sc.x, sc.y, rpx, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(168,85,247,0.06)'; ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.arc(sc.x, sc.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#a855f7'; ctx.fill();
            this._drawDimLabel(ctx, sc.x, sc.y, se.x, se.y, 'R' + sh.r.toFixed(1) + ' mm');
        } else if (sh.type === 'arc') {
            var sc = this._worldToScreen(sh.cx, sh.cy);
            var sa = this._worldToScreen(sh.cx + Math.cos(sh.startAngle)*sh.r, sh.cy - Math.sin(sh.startAngle)*sh.r);
            var rpx = Math.hypot(sa.x - sc.x, sa.y - sc.y);
            
            // Recompute screen angles because world Y is inverted relative to screen Y
            var screenStartA = Math.atan2(sa.y - sc.y, sa.x - sc.x);
            var se = this._worldToScreen(sh.cx + Math.cos(sh.endAngle)*sh.r, sh.cy - Math.sin(sh.endAngle)*sh.r);
            var screenEndA = Math.atan2(se.y - sc.y, se.x - sc.x);
            if (screenEndA < screenStartA) screenEndA += Math.PI*2;

            ctx.beginPath();
            ctx.moveTo(sc.x, sc.y);
            ctx.arc(sc.x, sc.y, rpx, screenStartA, screenEndA, false);
            ctx.closePath();
            ctx.fillStyle = 'rgba(168,85,247,0.06)'; ctx.fill();
            
            ctx.beginPath(); ctx.arc(sc.x, sc.y, rpx, screenStartA, screenEndA, false);
            ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(sa.x, sa.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(se.x, se.y); ctx.stroke();
            
            ctx.beginPath(); ctx.arc(sc.x, sc.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#a855f7'; ctx.fill();
            this._drawDimLabel(ctx, sc.x, sc.y, sa.x, sa.y, 'R' + sh.r.toFixed(1) + ' mm');
        }

        // Vertex dots
        var vpts = sh.type === 'poly' ? sh.pts : [];
        for (var vi = 0; vi < vpts.length; vi++) {
            var vs = this._worldToScreen(vpts[vi].x, vpts[vi].y);
            ctx.beginPath(); ctx.arc(vs.x, vs.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#c084fc'; ctx.fill();
        }

        ctx.restore();
    }

    _drawDimLabel(ctx, x1, y1, x2, y2, text) {
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.font = '11px JetBrains Mono, monospace';
        var tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = 'rgba(10,11,16,0.8)';
        ctx.fillRect(-tw / 2, -15, tw, 16);
        ctx.fillStyle = '#c084fc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, -7);
        ctx.restore();
    }

    hasShapes() { return this.shapes.length > 0; }
    hasOpenPath() { return this.currentPts.length > 0; }
}

export default SketchEngine;
