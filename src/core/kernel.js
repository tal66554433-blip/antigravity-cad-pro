// kernel.js - Geometric Kernel Abstraction Layer
// Currently wraps CSG.js and Three.js for fast execution, but exposes a B-Rep style API.
// This is the placeholder for the future OpenCASCADE (OCCT) WASM integration.

import * as THREE from 'three';
import initOpenCascade from '../../lib/opencascade.js';
import { CSG } from './csg.js';
import { createExtrudeGeometry, createRevolveGeometry } from '../sketch/sketch.js';

export class CADKernel {
    constructor() {
        this.isWasmActive = false; // Flag for future OCCT injection
        this.oc = null;
    }

    async init() {
        if (!this.oc) {
            console.log("Loading Geometric Kernel (OpenCASCADE)...");
            
            try {
                this.oc = await initOpenCascade({
                    locateFile: (path) => {
                        if(path.endsWith('.wasm')) {
                            return 'lib/opencascade.wasm';
                        }
                        return path;
                    }
                });
                this.isWasmActive = true;
                console.log("OpenCASCADE initialized successfully!");
            } catch (err) {
                console.error("OpenCASCADE initialization failed:", err);
            }
        }
    }

    // --- OpenCASCADE B-Rep Methods ---

    createShape(op) {
        if (!this.isWasmActive) return null;
        const oc = this.oc;
        const d = op.dimensions;
        let shape = null;

        switch (op.type) {
            case 'box':
                shape = new oc.BRepPrimAPI_MakeBox_2(d.width, d.height, d.depth).Shape();
                break;
            case 'cylinder':
                shape = new oc.BRepPrimAPI_MakeCylinder_2(d.radius, d.height).Shape();
                break;
            case 'sphere':
                shape = new oc.BRepPrimAPI_MakeSphere_1(d.radius).Shape();
                break;
            case 'cone':
                shape = new oc.BRepPrimAPI_MakeCone_1(d.radius, 0, d.height).Shape();
                break;
            case 'torus':
                shape = new oc.BRepPrimAPI_MakeTorus_1(d.radius, d.tube).Shape();
                break;
            default:
                shape = new oc.BRepPrimAPI_MakeBox_2(50, 50, 50).Shape();
        }

        // Apply Position and Rotation
        const trsf = new oc.gp_Trsf_1();
        const ax = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(1, 0, 0));
        const ay = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 1, 0));
        const az = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 0, 1));
        
        let transform = new oc.gp_Trsf_1();
        // Rotation Z
        if (op.rotation.z !== 0) {
            trsf.SetRotation_1(az, op.rotation.z * Math.PI / 180);
            transform.Multiply(trsf);
        }
        // Rotation Y
        if (op.rotation.y !== 0) {
            trsf.SetRotation_1(ay, op.rotation.y * Math.PI / 180);
            transform.Multiply(trsf);
        }
        // Rotation X
        if (op.rotation.x !== 0) {
            trsf.SetRotation_1(ax, op.rotation.x * Math.PI / 180);
            transform.Multiply(trsf);
        }
        // Translation
        trsf.SetTranslation_1(new oc.gp_Vec_4(op.position.x, op.position.y, op.position.z));
        transform.Multiply(trsf);

        const loc = new oc.TopLoc_Location_2(transform);
        shape.Location(loc);

        return shape;
    }

    performBooleanOCCT(shape1, shape2, mode) {
        if (!this.isWasmActive || !shape1 || !shape2) return null;
        const oc = this.oc;
        let algo;
        if (mode === 'add') {
            algo = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2);
        } else if (mode === 'cut') {
            algo = new oc.BRepAlgoAPI_Cut_3(shape1, shape2);
        } else if (mode === 'intersect') {
            algo = new oc.BRepAlgoAPI_Common_3(shape1, shape2);
        } else {
            return shape1;
        }
        algo.Build();
        const result = algo.Shape();
        algo.delete();
        return result;
    }

    shapeToMesh(shape, maxDeviation = 0.5) {
        if (!this.isWasmActive || !shape) return null;
        const oc = this.oc;
        
        // 1. Mesh the shape
        new oc.BRepMesh_IncrementalMesh_2(shape, maxDeviation, false, maxDeviation * 5, false);

        // 2. Extract faces
        const expFace = new oc.TopExp_Explorer_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
        
        const positions = [];
        const indices = [];
        let vertexOffset = 0;

        while (expFace.More()) {
            const face = oc.TopoDS.Face_1(expFace.Current());
            const location = new oc.TopLoc_Location_1();
            const tri = oc.BRep_Tool.Triangulation(face, location);
            if (tri.IsNull()) {
                expFace.Next();
                continue;
            }

            const trsf = location.Transformation();
            
            // Extract vertices
            const numNodes = tri.get().NbNodes();
            for (let i = 1; i <= numNodes; i++) {
                const p = tri.get().Node(i);
                p.Transform(trsf);
                positions.push(p.X(), p.Y(), p.Z());
            }

            // Extract triangles
            const numTriangles = tri.get().NbTriangles();
            const orient = face.Orientation();
            for (let i = 1; i <= numTriangles; i++) {
                const t = tri.get().Triangle(i);
                const n1 = t.Value(1);
                const n2 = t.Value(2);
                const n3 = t.Value(3);
                if (orient === oc.TopAbs_Orientation.TopAbs_REVERSED) {
                    indices.push(vertexOffset + n1 - 1, vertexOffset + n3 - 1, vertexOffset + n2 - 1);
                } else {
                    indices.push(vertexOffset + n1 - 1, vertexOffset + n2 - 1, vertexOffset + n3 - 1);
                }
            }

            vertexOffset += numNodes;
            expFace.Next();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return geometry;
    }

    // --- Legacy CSG / Primitive Generators ---

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
