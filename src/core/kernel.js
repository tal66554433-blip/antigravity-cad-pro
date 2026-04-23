/**
 * Antigravity CAD v3 - Geometric Kernel
 * Robust bridge to OpenCASCADE WASM.
 */

import initOpenCascade from '../../lib/opencascade.js';
import * as THREE from '../../lib/three.module.js';

class CADKernel {
    constructor() {
        this.oc = null;
        this.isWasmActive = false;
    }

    async init() {
        if (this.oc) return;

        try {
            this.oc = await initOpenCascade({
                locateFile: (path) => {
                    if (path.endsWith('.wasm')) return 'lib/opencascade.wasm';
                    return path;
                }
            });
            this.isWasmActive = true;
            console.log("Geometric Kernel (OCCT) Online.");
        } catch (err) {
            console.error("OCCT Load Error:", err);
            throw err;
        }
    }

    // --- High Level API ---

    createShapeFromFeature(feature) {
        if (!this.isWasmActive) return null;
        const oc = this.oc;
        const p = feature.params || {};
        let shape = null;

        try {
            switch (feature.type) {
                case 'box':
                    shape = new oc.BRepPrimAPI_MakeBox_2(
                        p.width || 50, 
                        p.height || 50, 
                        p.depth || 50
                    ).Shape();
                    break;
                case 'cylinder':
                    shape = new oc.BRepPrimAPI_MakeCylinder_2(
                        p.radius || 25, 
                        p.height || 100
                    ).Shape();
                    break;
                case 'sphere':
                    shape = new oc.BRepPrimAPI_MakeSphere_1(p.radius || 50).Shape();
                    break;
                default:
                    console.warn("Unknown feature type:", feature.type);
                    return null;
            }

            // Apply transformations if present
            if (p.position || p.rotation) {
                shape = this.applyTransform(shape, p.position, p.rotation);
            }

            return shape;
        } catch (err) {
            console.error(`Failed to create ${feature.type}:`, err);
            return null;
        }
    }

    applyTransform(shape, pos = {x:0, y:0, z:0}, rot = {x:0, y:0, z:0}) {
        const oc = this.oc;
        const trsf = new oc.gp_Trsf_1();
        
        // Translation
        trsf.SetTranslation_1(new oc.gp_Vec_4(pos.x, pos.y, pos.z));
        
        // Rotations (simplified Euler YZX)
        const ax = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(1, 0, 0));
        const ay = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 1, 0));
        const az = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 0, 1));
        
        const rx = new oc.gp_Trsf_1(); rx.SetRotation_1(ax, rot.x * Math.PI / 180);
        const ry = new oc.gp_Trsf_1(); ry.SetRotation_1(ay, rot.y * Math.PI / 180);
        const rz = new oc.gp_Trsf_1(); rz.SetRotation_1(az, rot.z * Math.PI / 180);
        
        trsf.Multiply(rz);
        trsf.Multiply(ry);
        trsf.Multiply(rx);

        const loc = new oc.TopLoc_Location_2(trsf);
        shape.Location(loc);
        return shape;
    }

    performBooleanOCCT(shape1, shape2, mode) {
        if (!this.isWasmActive || !shape1 || !shape2) return shape1;
        const oc = this.oc;
        let result = shape1;

        try {
            let algo;
            if (mode === 'add' || mode === 'union') {
                algo = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2);
            } else if (mode === 'cut' || mode === 'subtract') {
                algo = new oc.BRepAlgoAPI_Cut_3(shape1, shape2);
            } else if (mode === 'intersect') {
                algo = new oc.BRepAlgoAPI_Common_3(shape1, shape2);
            } else {
                return shape1;
            }

            algo.Build();
            result = algo.Shape();
            algo.delete();
        } catch (err) {
            console.error("Boolean Operation Failed:", err);
        }

        return result;
    }

    shapeToMesh(shape, maxDeviation = 0.5) {
        if (!this.isWasmActive || !shape) return null;
        const oc = this.oc;
        
        try {
            // Mesh the shape
            new oc.BRepMesh_IncrementalMesh_2(shape, maxDeviation, false, maxDeviation * 5, false);

            const expFace = new oc.TopExp_Explorer_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
            const positions = [];
            const indices = [];
            let vertexOffset = 0;

            while (expFace.More()) {
                const face = oc.TopoDS.Face_1(expFace.Current());
                const location = new oc.TopLoc_Location_1();
                const tri = oc.BRep_Tool.Triangulation(face, location);
                
                if (!tri.IsNull()) {
                    const trsf = location.Transformation();
                    const numNodes = tri.get().NbNodes();
                    
                    for (let i = 1; i <= numNodes; i++) {
                        const p = tri.get().Node(i);
                        p.Transform(trsf);
                        positions.push(p.X(), p.Y(), p.Z());
                    }

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
                }
                expFace.Next();
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();

            return geometry;
        } catch (err) {
            console.error("Meshing Failed:", err);
            return null;
        }
    }
}

export const Kernel = new CADKernel();
