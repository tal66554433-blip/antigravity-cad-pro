// Scene setup -- Antigravity CAD Pro v2
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export let scene, camera, renderer, orbitControls, transformControls;
export let resultMesh = null;
export let ghostGroup;

export function initScene(canvas) {
    const vp = canvas.parentElement;

    function getSize() {
        const rect = vp.getBoundingClientRect();
        const w = Math.max(rect.width, vp.offsetWidth, 100);
        const h = Math.max(rect.height, vp.offsetHeight, 100);
        return { w: w, h: h };
    }

    const sz = getSize();
    canvas.width = sz.w;
    canvas.height = sz.h;
    canvas.style.width = sz.w + 'px';
    canvas.style.height = sz.h + 'px';

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(sz.w, sz.h, false);
    renderer.setClearColor(0x10111a);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x10111a, 0.0006);

    camera = new THREE.PerspectiveCamera(50, sz.w / sz.h, 0.1, 10000);
    camera.position.set(130, 100, 130);

    // Ambient light
    scene.add(new THREE.AmbientLight(0x405878, 0.5));

    // Key light
    var key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(80, 120, 60);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 500;
    key.shadow.camera.left = -200;
    key.shadow.camera.right = 200;
    key.shadow.camera.top = 200;
    key.shadow.camera.bottom = -200;
    scene.add(key);

    // Fill light
    var fill = new THREE.DirectionalLight(0x7090ff, 0.35);
    fill.position.set(-60, 40, -30);
    scene.add(fill);

    // Rim light
    var rim = new THREE.DirectionalLight(0xff7040, 0.2);
    rim.position.set(-20, 60, 80);
    scene.add(rim);

    // Shadow ground plane
    var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000),
        new THREE.ShadowMaterial({ opacity: 0.12 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid
    var g1 = new THREE.GridHelper(600, 60, 0x1e2235, 0x181920);
    g1.material.opacity = 0.7;
    g1.material.transparent = true;
    scene.add(g1);

    var g2 = new THREE.GridHelper(600, 300, 0x15161e, 0x15161e);
    g2.material.opacity = 0.35;
    g2.material.transparent = true;
    scene.add(g2);

    // Axes helper
    var ax = new THREE.AxesHelper(100);
    ax.setColors(
        new THREE.Color(0xef4444),
        new THREE.Color(0x22c55e),
        new THREE.Color(0x3b82f6)
    );
    scene.add(ax);

    // Ghost group for wireframe previews
    ghostGroup = new THREE.Group();
    scene.add(ghostGroup);

    // Orbit controls
    orbitControls = new OrbitControls(camera, canvas);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.07;
    orbitControls.minDistance = 5;
    orbitControls.maxDistance = 3000;

    // Transform controls
    transformControls = new TransformControls(camera, canvas);
    transformControls.size = 0.75;
    scene.add(transformControls);
    transformControls.addEventListener('dragging-changed', function(e) {
        orbitControls.enabled = !e.value;
    });

    // Resize observer
    new ResizeObserver(function() {
        var s = getSize();
        canvas.width = s.w;
        canvas.height = s.h;
        canvas.style.width = s.w + 'px';
        canvas.style.height = s.h + 'px';
        camera.aspect = s.w / s.h;
        camera.updateProjectionMatrix();
        renderer.setSize(s.w, s.h, false);
    }).observe(vp);

    return { scene, camera, renderer, orbitControls, transformControls };
}

export function setResultMesh(mesh) {
    if (resultMesh) {
        scene.remove(resultMesh);
        if (resultMesh.geometry) resultMesh.geometry.dispose();
        if (resultMesh.material) {
            if (Array.isArray(resultMesh.material)) {
                resultMesh.material.forEach(function(m) { m.dispose(); });
            } else {
                resultMesh.material.dispose();
            }
        }
    }
    resultMesh = mesh;
    if (mesh) scene.add(mesh);
}

export function getResultMaterial() {
    return new THREE.MeshPhysicalMaterial({
        color: 0x8899bb,
        metalness: 0.45,
        roughness: 0.3,
        clearcoat: 0.4,
        clearcoatRoughness: 0.15,
        side: THREE.DoubleSide
    });
}

export function getGhostMaterial(mode) {
    var colors = { add: 0x10b981, cut: 0xef4444, intersect: 0xf59e0b, sketch: 0xa855f7 };
    return new THREE.MeshBasicMaterial({
        color: colors[mode] || 0x3b82f6,
        wireframe: true,
        transparent: true,
        opacity: 0.2
    });
}

export function raycastGround(clientX, clientY, canvas) {
    var rect = canvas.getBoundingClientRect();
    var mx = ((clientX - rect.left) / rect.width) * 2 - 1;
    var my = -((clientY - rect.top) / rect.height) * 2 + 1;
    var ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(mx, my), camera);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var pt = new THREE.Vector3();
    ray.ray.intersectPlane(plane, pt);
    return pt;
}

export function setView(name) {
    var d = 200;
    var views = {
        perspective: [130, 100, 130],
        front: [0, 0, d],
        top: [0, d, 0.001],
        right: [d, 0, 0]
    };
    var pos = views[name] || views.perspective;
    camera.position.set(pos[0], pos[1], pos[2]);
    orbitControls.target.set(0, 0, 0);
    orbitControls.update();
}

export function startRenderLoop(callback) {
    function loop() {
        requestAnimationFrame(loop);
        orbitControls.update();
        if (callback) callback();
        renderer.render(scene, camera);
    }
    loop();
}
