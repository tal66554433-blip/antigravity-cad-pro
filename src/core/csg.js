// ===== CSG Engine - Constructive Solid Geometry for Three.js =====
// Based on the classic BSP-tree algorithm by Evan Wallace
// Adapted for Three.js BufferGeometry with full matrix support

import * as THREE from 'three';

const EPSILON = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

// --- Vector ---
class Vector {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
    }
    clone() { return new Vector(this.x, this.y, this.z); }
    negate() { return new Vector(-this.x, -this.y, -this.z); }
    plus(v) { return new Vector(this.x + v.x, this.y + v.y, this.z + v.z); }
    minus(v) { return new Vector(this.x - v.x, this.y - v.y, this.z - v.z); }
    times(s) { return new Vector(this.x * s, this.y * s, this.z * s); }
    dividedBy(s) { return this.times(1 / s); }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    lerp(v, t) { return this.plus(v.minus(this).times(t)); }
    length() { return Math.sqrt(this.dot(this)); }
    unit() { const len = this.length(); return len > 0 ? this.dividedBy(len) : new Vector(); }
    cross(v) {
        return new Vector(
            this.y * v.z - this.z * v.y,
            this.z * v.x - this.x * v.z,
            this.x * v.y - this.y * v.x
        );
    }
}

// --- Vertex ---
class Vertex {
    constructor(pos, normal) {
        this.pos = pos instanceof Vector ? pos : new Vector(pos.x, pos.y, pos.z);
        this.normal = normal instanceof Vector ? normal : new Vector(normal.x, normal.y, normal.z);
    }
    clone() { return new Vertex(this.pos.clone(), this.normal.clone()); }
    flip() { this.normal = this.normal.negate(); }
    interpolate(other, t) {
        return new Vertex(this.pos.lerp(other.pos, t), this.normal.lerp(other.normal, t));
    }
}

// --- Plane ---
class Plane {
    constructor(normal, w) {
        this.normal = normal;
        this.w = w;
    }
    clone() { return new Plane(this.normal.clone(), this.w); }
    flip() { this.normal = this.normal.negate(); this.w = -this.w; }

    splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
        let polygonType = 0;
        const types = [];
        for (const vertex of polygon.vertices) {
            const t = this.normal.dot(vertex.pos) - this.w;
            const type = (t < -EPSILON) ? BACK : (t > EPSILON) ? FRONT : COPLANAR;
            polygonType |= type;
            types.push(type);
        }
        switch (polygonType) {
            case COPLANAR:
                (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
                break;
            case FRONT:
                front.push(polygon);
                break;
            case BACK:
                back.push(polygon);
                break;
            case SPANNING: {
                const f = [], b = [];
                for (let i = 0; i < polygon.vertices.length; i++) {
                    const j = (i + 1) % polygon.vertices.length;
                    const ti = types[i], tj = types[j];
                    const vi = polygon.vertices[i], vj = polygon.vertices[j];
                    if (ti !== BACK) f.push(vi);
                    if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
                    if ((ti | tj) === SPANNING) {
                        const denom = this.normal.dot(vj.pos.minus(vi.pos));
                        const t = denom !== 0 ? (this.w - this.normal.dot(vi.pos)) / denom : 0;
                        const v = vi.interpolate(vj, Math.max(0, Math.min(1, t)));
                        f.push(v);
                        b.push(v.clone());
                    }
                }
                if (f.length >= 3) front.push(new Polygon(f, polygon.shared));
                if (b.length >= 3) back.push(new Polygon(b, polygon.shared));
                break;
            }
        }
    }
}

Plane.fromPoints = (a, b, c) => {
    const n = b.minus(a).cross(c.minus(a)).unit();
    return new Plane(n, n.dot(a));
};

// --- Polygon ---
class Polygon {
    constructor(vertices, shared) {
        this.vertices = vertices;
        this.shared = shared;
        if (vertices.length >= 3) {
            this.plane = Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
        }
    }
    clone() { return new Polygon(this.vertices.map(v => v.clone()), this.shared); }
    flip() {
        this.vertices.reverse().forEach(v => v.flip());
        this.plane.flip();
    }
}

// --- BSP Node ---
class Node {
    constructor(polygons) {
        this.plane = null;
        this.front = null;
        this.back = null;
        this.polygons = [];
        if (polygons) this.build(polygons);
    }
    clone() {
        const node = new Node();
        node.plane = this.plane && this.plane.clone();
        node.front = this.front && this.front.clone();
        node.back = this.back && this.back.clone();
        node.polygons = this.polygons.map(p => p.clone());
        return node;
    }
    invert() {
        this.polygons.forEach(p => p.flip());
        if (this.plane) this.plane.flip();
        if (this.front) this.front.invert();
        if (this.back) this.back.invert();
        const tmp = this.front;
        this.front = this.back;
        this.back = tmp;
    }
    clipPolygons(polygons) {
        if (!this.plane) return polygons.slice();
        let front = [], back = [];
        for (const p of polygons) {
            this.plane.splitPolygon(p, front, back, front, back);
        }
        if (this.front) front = this.front.clipPolygons(front);
        back = this.back ? this.back.clipPolygons(back) : [];
        return front.concat(back);
    }
    clipTo(bsp) {
        this.polygons = bsp.clipPolygons(this.polygons);
        if (this.front) this.front.clipTo(bsp);
        if (this.back) this.back.clipTo(bsp);
    }
    allPolygons() {
        let out = this.polygons.slice();
        if (this.front) out = out.concat(this.front.allPolygons());
        if (this.back) out = out.concat(this.back.allPolygons());
        return out;
    }
    build(polygons) {
        if (!polygons.length) return;
        if (!this.plane) this.plane = polygons[0].plane.clone();
        const front = [], back = [];
        for (const p of polygons) {
            this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
        }
        if (front.length) {
            if (!this.front) this.front = new Node();
            this.front.build(front);
        }
        if (back.length) {
            if (!this.back) this.back = new Node();
            this.back.build(back);
        }
    }
}

// --- CSG ---
export class CSG {
    constructor() {
        this.polygons = [];
    }
    clone() {
        const csg = new CSG();
        csg.polygons = this.polygons.map(p => p.clone());
        return csg;
    }

    union(other) {
        const a = new Node(this.clone().polygons);
        const b = new Node(other.clone().polygons);
        a.clipTo(b);
        b.clipTo(a);
        b.invert();
        b.clipTo(a);
        b.invert();
        a.build(b.allPolygons());
        const result = new CSG();
        result.polygons = a.allPolygons();
        return result;
    }

    subtract(other) {
        const a = new Node(this.clone().polygons);
        const b = new Node(other.clone().polygons);
        a.invert();
        a.clipTo(b);
        b.clipTo(a);
        b.invert();
        b.clipTo(a);
        b.invert();
        a.build(b.allPolygons());
        a.invert();
        const result = new CSG();
        result.polygons = a.allPolygons();
        return result;
    }

    intersect(other) {
        const a = new Node(this.clone().polygons);
        const b = new Node(other.clone().polygons);
        a.invert();
        b.clipTo(a);
        b.invert();
        a.clipTo(b);
        b.clipTo(a);
        a.build(b.allPolygons());
        a.invert();
        const result = new CSG();
        result.polygons = a.allPolygons();
        return result;
    }

    // Convert Three.js BufferGeometry to CSG
    static fromGeometry(geom, matrix) {
        const csg = new CSG();
        let g = geom;
        if (matrix) {
            g = geom.clone().applyMatrix4(matrix);
            g.computeVertexNormals();
        }
        const pos = g.getAttribute('position');
        const norm = g.getAttribute('normal');
        const idx = g.getIndex();

        const getTriangle = (i0, i1, i2) => {
            const vertices = [i0, i1, i2].map(k => new Vertex(
                new Vector(pos.getX(k), pos.getY(k), pos.getZ(k)),
                new Vector(norm.getX(k), norm.getY(k), norm.getZ(k))
            ));
            return new Polygon(vertices);
        };

        if (idx) {
            for (let i = 0; i < idx.count; i += 3) {
                csg.polygons.push(getTriangle(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)));
            }
        } else {
            for (let i = 0; i < pos.count; i += 3) {
                csg.polygons.push(getTriangle(i, i + 1, i + 2));
            }
        }

        if (matrix && g !== geom) g.dispose();
        return csg;
    }

    // CSG to Three.js BufferGeometry
    toGeometry() {
        const positions = [];
        const normals = [];
        for (const poly of this.polygons) {
            for (let i = 2; i < poly.vertices.length; i++) {
                for (const v of [poly.vertices[0], poly.vertices[i - 1], poly.vertices[i]]) {
                    positions.push(v.pos.x, v.pos.y, v.pos.z);
                    normals.push(v.normal.x, v.normal.y, v.normal.z);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        return geometry;
    }
}
