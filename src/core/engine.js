/**
 * Antigravity CAD v3 - Rendering Engine
 * Simplified Three.js wrapper with PBR materials and better performance.
 */

import * as THREE from '../../lib/three.module.js';
import { OrbitControls } from '../../lib/OrbitControls.js';

export const Engine = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    mainMesh: null,
    
    init(canvas) {
        this.scene = new THREE.Scene();
        this.scene.background = null; // Background handled by CSS gradient

        const aspect = canvas.clientWidth / canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
        this.camera.position.set(200, 200, 200);

        this.renderer = new THREE.WebGLRenderer({ 
            canvas, 
            antialias: true, 
            alpha: true 
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.setupLights();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
    },

    setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(100, 200, 100);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        this.scene.add(sun);

        const rim = new THREE.PointLight(0x3b82f6, 0.5);
        rim.position.set(-100, -100, -100);
        this.scene.add(rim);
        
        // Add a grid for scale
        const grid = new THREE.GridHelper(500, 50, 0x333333, 0x1a1a1a);
        grid.position.y = -0.5;
        this.scene.add(grid);
    },

    updateMainModel(geometry) {
        if (this.mainMesh) {
            this.scene.remove(this.mainMesh);
            this.mainMesh.geometry.dispose();
        }

        if (!geometry) return;

        const material = new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            metalness: 0.6,
            roughness: 0.3,
            flatShading: false
        });

        this.mainMesh = new THREE.Mesh(geometry, material);
        this.mainMesh.castShadow = true;
        this.mainMesh.receiveShadow = true;
        this.scene.add(this.mainMesh);
    },

    onResize() {
        const canvas = this.renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    },

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
};
