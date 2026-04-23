// kernel.js - Geometric Kernel Abstraction Layer
// Currently wraps CSG.js and Three.js for fast execution, but exposes a B-Rep style API.
// This is the placeholder for the future OpenCASCADE (OCCT) WASM integration.

import * as THREE from 'three';
import { CSG } from './csg.js';
import { createExtrudeGeometry, createRevolveGeometry } from '../sketch/sketch.js';

export class CADKernel {
    constructor() {
        this.isWasmActive = false; // Flag for future OCCT injection
    }

    // --- Primitive Generators ---
    // In a true B-Rep kernel, these would return Topological Shapes (TopoDS_Shape).
    // Here we return Three.js geometries as our "Shapes" for now.

    createBox(width, height, depth) {
        return new THREE.BoxGeometry(width, height, depth);
    }

    createCylinder(radius, height, segments = 32) {
        return new THREE.CylinderGeometry(radius, radius, height, segments);
    }

    createSphere(radius, widthSeg = 32, heightSeg = 24) {
        return new THREE.SphereGeometry(radius, widthSeg, heightSeg);
    }

    createCone(radius, height, segments = 32) {
        return new THREE.ConeGeometry(radius, height, segments);
    }

    createTorus(radius, tube, radialSeg = 20, tubularSeg = 64) {
        return new THREE.TorusGeometry(radius, tube, radialSeg, tubularSeg);
    }

    createExtrusion(sketchShapes, depth) {
        return createExtrudeGeometry(sketchShapes, depth, 0);
    }

    createRevolve(sketchShapes, angle, segments) {
        return createRevolveGeometry(sketchShapes, angle, segments);
    }

    // --- Boolean Operations (The Engine) ---
    // Takes multiple "Shapes" and performs CSG.
    
    performBoolean(baseGeom, baseMatrix, toolGeom, toolMatrix, operation) {
        // Build base CSG
        let baseCSG = CSG.fromGeometry(baseGeom, baseMatrix);

        // Build tool CSG
        const toolCSG = CSG.fromGeometry(toolGeom, toolMatrix);

        // Execute boolean
        if (operation === 'add') {
            baseCSG = baseCSG.union(toolCSG);
        } else if (operation === 'cut') {
            baseCSG = baseCSG.subtract(toolCSG);
        } else if (operation === 'intersect') {
            baseCSG = baseCSG.intersect(toolCSG);
        }

        const resultGeom = baseCSG.toGeometry();
        // Since we already applied the base matrix in the CSG conversion, we shouldn't re-apply it to the resulting mesh.
        // We return a new Mesh with the identity matrix, but vertices in world space.
        const mesh = new THREE.Mesh(resultGeom);
        return mesh;
    }
}

// Global Kernel Instance
export const Kernel = new CADKernel();
