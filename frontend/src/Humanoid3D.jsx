import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry';
import { Sky } from 'three/examples/jsm/objects/Sky';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass';

export default function Humanoid3D() {
  const containerRef = useRef(null);
  const [statusText, setStatusText] = useState('Стёпа готов! WASD — ход, Shift — бег, Q/Z — торс 360°');
  const [equippedItem, setEquippedItem] = useState('Пусто');
  const [isDriving, setIsDriving] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [activeCam, setActiveCam] = useState('orbit');

  const actionTriggerRef = useRef(null);
  const driveTriggerRef = useRef(false);
  const activeCamRef = useRef('orbit');

  const switchCamera = (camId) => {
    activeCamRef.current = camId;
    setActiveCam(camId);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. СЦЕНА, ШЕЙДЕРНОЕ НЕБО (ATMOSPHERIC SKY) И ПОСТОБРАБОТКА (BLOOM)
    const scene = new THREE.Scene();
// Было: scene.fog = new THREE.FogExp2(0xcbd5e1, 0.011);
scene.fog = new THREE.FogExp2(0x1e293b, 0.0045); // Тёмно-сланцевый и в 2.5 раза прозрачнее

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      160
    );
    camera.position.set(0, 6.2, 13.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.55;

    container.appendChild(renderer.domElement);

    // Физически корректное небо и положение солнца
    const sky = new Sky();
    sky.scale.setScalar(450);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 2.0;
    skyUniforms['rayleigh'].value = 0.8;
    skyUniforms['mieCoefficient'].value = 0.001;
    skyUniforms['mieDirectionalG'].value = 0.7;

    const sunVec = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - 65);
    const theta = THREE.MathUtils.degToRad(42);
    sunVec.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(sunVec);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.15;

    // Постобработка: рендер + мягкое свечение оптики и LED (Bloom)
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.22,
      0.40,
      1.15
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.3, 0);

    // 2. ПРОЦЕДУРНЫЕ PBR-ТЕКСТУРЫ (ALBEDO + BUMP/РЕЛЬЕФ + ROUGHNESS/МАТОВОСТЬ)
    const makeCanvasTexture = (drawFn, repeatX = 1, repeatY = 1, isColor = true) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      drawFn(ctx, 512, 512);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 8;
      if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const concreteColor = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 14000; i++) {
        const shade = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.07)';
        ctx.fillStyle = shade;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 2, 2 + Math.random() * 2);
      }
      for (let i = 0; i < 8; i++) {
        const gx = Math.random() * w;
        const gy = Math.random() * h;
        const grad = ctx.createRadialGradient(gx, gy, 4, gx, gy, 45);
        grad.addColorStop(0, 'rgba(15, 23, 42, 0.16)');
        grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = 'rgba(234, 179, 8, 0.42)';
      ctx.fillRect(0, h - 22, w, 12);
    }, 8, 8, true);

    const concreteBump = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 18000; i++) {
        const v = 100 + Math.floor(Math.random() * 60);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 5;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }, 8, 8, false);

    const concreteRoughness = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#d4d4d4';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 10; i++) {
        const gx = Math.random() * w;
        const gy = Math.random() * h;
        const grad = ctx.createRadialGradient(gx, gy, 5, gx, gy, 55);
        grad.addColorStop(0, 'rgba(70, 70, 70, 0.65)');
        grad.addColorStop(1, 'rgba(212, 212, 212, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    }, 8, 8, false);

    const carbonTex = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        for (let x = 0; x < w; x += 8) {
          ctx.fillStyle = (x + y) % 16 === 0 ? '#1f2937' : '#090d16';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }, 6, 6, true);

    const brushedMetalBump = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = 115 + Math.floor(Math.random() * 28);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, Math.random() * h, w, 1);
      }
    }, 2, 2, false);

    const hazardTex = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0f172a';
      for (let i = -h; i < w + h; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 32, 0);
        ctx.lineTo(i - h + 32, h);
        ctx.lineTo(i - h, h);
        ctx.closePath();
        ctx.fill();
      }
    }, 6, 1, true);

    const crateTex = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#b47b44';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(120, 72, 28, 0.35)';
      for (let y = 0; y < h; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(217, 160, 91, 0.8)';
      ctx.fillRect(0, h / 2 - 22, w, 44);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(40, 45, 195, 110);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('SKU-6500', 52, 82);
      for (let x = 52; x < 215; x += 6) {
        ctx.fillRect(x, 96, x % 12 === 0 ? 4 : 2, 42);
      }
    }, 1, 1, true);

    const woodTex = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#92400e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(45, 18, 2, 0.28)';
      for (let i = 0; i < 160; i++) {
        ctx.fillRect(0, Math.random() * h, w, 2 + Math.random() * 3);
      }
    }, 2, 2, true);

    // 3. ОСВЕЩЕНИЕ
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 0.35);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.15);
    sunLight.position.copy(sunVec).multiplyScalar(32);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.camera.left = -18;
    sunLight.shadow.camera.right = 18;
    sunLight.shadow.camera.top = 18;
    sunLight.shadow.camera.bottom = -18;
    scene.add(sunLight);

    // 4. БЕТОННЫЙ ПОЛ С PBR-РЕЛЬЕФОМ, ЯМЫ, СТЕНЫ, СТЕЛЛАЖИ, ГОРКИ И ЛЕСТНИЦА
    const floorMat = new THREE.MeshStandardMaterial({
      map: concreteColor,
      bumpMap: concreteBump,
      bumpScale: 0.018,
      roughnessMap: concreteRoughness,
      roughness: 0.85,
      metalness: 0.06
    });
    const pitWallMat = new THREE.MeshStandardMaterial({
      map: concreteColor,
      bumpMap: concreteBump,
      bumpScale: 0.02,
      color: 0x64748b,
      roughness: 0.9
    });
    const pitBottomMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.95 });
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.45, metalness: 0.1 });

    const addFloorPatch = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), floorMat);
      m.position.set(x, -0.1, z);
      m.receiveShadow = true;
      scene.add(m);
    };

    addFloorPatch(9.0, 30, -10.5, 0);

addFloorPatch(2.5, 13, -4.75, -8.5);
addFloorPatch(2.5, 13, -4.75, 8.5);
addFloorPatch(10.0, 30, 1.5, 0);
addFloorPatch(2.5, 11, 7.75, -9.5);
addFloorPatch(2.5, 16, 7.75, 7.0);
addFloorPatch(6.0, 30, 12.0, 0);
const buildRealPit = (xMin, xMax, zMin, zMax, depth) => {
const w = xMax - xMin;
const d = zMax - zMin;
const cx = (xMin + xMax) / 2;
const cz = (zMin + zMax) / 2;
const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), pitBottomMat);
bottom.position.set(cx, depth - 0.1, cz);
bottom.receiveShadow = true;
scene.add(bottom);
const curbN = new THREE.Mesh(new RoundedBoxGeometry(w + 0.26, 0.07, 0.13, 3, 0.02), hazardMat);
curbN.position.set(cx, 0.035, zMin - 0.06);
const curbS = new THREE.Mesh(new RoundedBoxGeometry(w + 0.26, 0.07, 0.13, 3, 0.02), hazardMat);
curbS.position.set(cx, 0.035, zMax + 0.06);
const curbW = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.07, d, 3, 0.02), hazardMat);
curbW.position.set(xMin - 0.06, 0.035, cz);
const curbE = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.07, d, 3, 0.02), hazardMat);
curbE.position.set(xMax + 0.06, 0.035, cz);
curbN.castShadow = curbS.castShadow = curbW.castShadow = curbE.castShadow = true;
scene.add(curbN, curbS, curbW, curbE);
const wallN = new THREE.Mesh(new THREE.BoxGeometry(w, Math.abs(depth), 0.15), pitWallMat);
wallN.position.set(cx, depth / 2, zMin);
const wallS = new THREE.Mesh(new THREE.BoxGeometry(w, Math.abs(depth), 0.15), pitWallMat);
wallS.position.set(cx, depth / 2, zMax);
const wallW = new THREE.Mesh(new THREE.BoxGeometry(0.15, Math.abs(depth), d), pitWallMat);
wallW.position.set(xMin, depth / 2, cz);
const wallE = new THREE.Mesh(new THREE.BoxGeometry(0.15, Math.abs(depth), d), pitWallMat);
wallE.position.set(xMax, depth / 2, cz);
scene.add(wallN, wallS, wallW, wallE);
};
buildRealPit(-6.0, -3.5, -2.0, 2.0, -3.5);
buildRealPit(6.5, 9.0, -4.0, -1.0, -3.0);
const wallMat = new THREE.MeshStandardMaterial({
color: 0x94a3b8,
bumpMap: brushedMetalBump,
bumpScale: 0.008,
metalness: 0.42,
roughness: 0.48
});
const plinthMat = new THREE.MeshStandardMaterial({
map: concreteColor,
bumpMap: concreteBump,
bumpScale: 0.02,
color: 0x475569,
roughness: 0.85
});
const createPerimeterWall = (w, h, d, x, y, z) => {
const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
wall.position.set(x, y, z);
wall.castShadow = true;
wall.receiveShadow = true;
const plinth = new THREE.Mesh(new RoundedBoxGeometry(w + 0.06, 0.85, d + 0.06, 2, 0.02), plinthMat);
plinth.position.set(x, 0.425, z);
scene.add(wall, plinth);
};
createPerimeterWall(30.4, 4.2, 0.4, 0, 2.1, -15);
createPerimeterWall(30.4, 4.2, 0.4, 0, 2.1, 15);
createPerimeterWall(0.4, 4.2, 30, -15, 2.1, 0);
createPerimeterWall(0.4, 4.2, 30, 15, 2.1, 0);
const beamSteelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 });
const lampGlowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe0f2fe, emissiveIntensity: 2.2 });
[-12, -4, 4, 12].forEach((cx) => {
const col = new THREE.Mesh(new RoundedBoxGeometry(0.35, 4.3, 0.35, 2, 0.03), beamSteelMat);
col.position.set(cx, 2.15, -14.75);
col.castShadow = true;
const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.14, 0.25, 2, 0.02), lampGlowMat);
lamp.position.set(cx, 3.85, -14.52);
scene.add(col, lamp);
});
const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, bumpMap: concreteBump, bumpScale: 0.006, roughness: 0.75 });
const buildRack = (rx, rz, rotY = 0) => {
const rack = new THREE.Group();
const postMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.65, roughness: 0.32 });
const beamMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.55, roughness: 0.35 });
[[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.5], [1.3, 0.5]].forEach(([px, pz]) => {
const post = new THREE.Mesh(new RoundedBoxGeometry(0.09, 3.2, 0.09, 2, 0.015), postMat);
post.position.set(px, 1.6, pz);
post.castShadow = true;
rack.add(post);
});
[1.1, 2.2, 3.05].forEach((by, lvl) => {
const beamF = new THREE.Mesh(new RoundedBoxGeometry(2.7, 0.09, 0.06, 2, 0.01), beamMat);
beamF.position.set(0, by, 0.5);
const beamB = new THREE.Mesh(new RoundedBoxGeometry(2.7, 0.09, 0.06, 2, 0.01), beamMat);
beamB.position.set(0, by, -0.5);
rack.add(beamF, beamB);
if (lvl < 2) {
[-0.65, 0.65].forEach((bx, idx) => {
if ((lvl + idx) % 2 === 0) {
const cargo = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.58, 0.72, 3, 0.02), crateMat);
cargo.position.set(bx, by + 0.33, 0);
cargo.castShadow = true;
cargo.receiveShadow = true;
rack.add(cargo);
}
});
}
});
rack.position.set(rx, 0, rz);
rack.rotation.y = rotY;
scene.add(rack);
};
buildRack(-11.5, -13.5, 0);
buildRack(-8.2, -13.5, 0);
buildRack(11.5, -13.5, 0);
buildRack(-13.5, -8.5, Math.PI / 2);
const buildRamp = (xMin, xMax, zMin, zMax, maxH) => {
const w = xMax - xMin;
const d = zMax - zMin;
const shape = new THREE.Shape();
shape.moveTo(0, 0);
shape.lineTo(d, 0);
shape.lineTo(d, maxH);
shape.closePath();
const geo = new THREE.ExtrudeGeometry(shape, { depth: w - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 });
geo.rotateY(Math.PI / 2);
const mesh = new THREE.Mesh(
geo,
new THREE.MeshStandardMaterial({
map: concreteColor,
bumpMap: concreteBump,
bumpScale: 0.015,
color: 0x0284c7,
roughness: 0.65
})
);
mesh.position.set(xMin + 0.02, 0, zMax);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);
};
buildRamp(2.0, 4.0, -2.5, 1.5, 1.1);
buildRamp(-9.5, -7.5, 3.0, 7.0, 0.9);
const stairGroup = new THREE.Group();
const stepMat = new THREE.MeshStandardMaterial({
map: concreteColor,
bumpMap: concreteBump,
bumpScale: 0.015,
color: 0x64748b,
roughness: 0.72
});
for (let i = 0; i < 6; i++) {
const stepH = (i + 1) * 0.25;
const step = new THREE.Mesh(new RoundedBoxGeometry(2.4, stepH, 0.5, 2, 0.015), stepMat);
step.position.set(0, stepH / 2, -3.25 - i * 0.5);
step.castShadow = true;
step.receiveShadow = true;
stairGroup.add(step);
}
const platform = new THREE.Mesh(new RoundedBoxGeometry(3.6, 1.5, 2.5, 3, 0.03), stepMat);
platform.position.set(0, 0.75, -7.25);
platform.castShadow = true;
platform.receiveShadow = true;
stairGroup.add(platform);
const railMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.5, roughness: 0.35 });
[-1.72, 1.72].forEach((rx) => {
[-6.1, -8.4].forEach((rz) => {
const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 12), railMat);
post.position.set(rx, 1.95, rz);
stairGroup.add(post);
});
const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.35, 12), railMat);
topBar.rotation.x = Math.PI / 2;
topBar.position.set(rx, 2.38, -7.25);
stairGroup.add(topBar);
});
scene.add(stairGroup);
// 5. ВЕРСТАКИ, ЕВРОПАЛЛЕТА И ИНТЕРАКТИВНЫЕ ПРЕДМЕТЫ
const tables = [
{ x: -2.0, z: 3.5, color: 0x38bdf8 },
{ x: 2.0, z: 3.5, color: 0x22c55e }
];
tables.forEach(({ x, z, color }) => {
const group = new THREE.Group();
const top = new THREE.Mesh(
new RoundedBoxGeometry(1.62, 0.1, 1.62, 3, 0.02),
new THREE.MeshStandardMaterial({ map: woodTex, bumpMap: concreteBump, bumpScale: 0.008, roughness: 0.6 })
);
top.position.y = 0.91;
top.castShadow = true;
top.receiveShadow = true;
group.add(top);
const frame = new THREE.Mesh(
new RoundedBoxGeometry(1.64, 0.055, 1.64, 2, 0.01),
new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.3 })
);
frame.position.y = 0.85;
group.add(frame);
const strip = new THREE.Mesh(
new RoundedBoxGeometry(1.5, 0.024, 0.04, 2, 0.008),
new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.0 })
);
strip.position.set(0, 0.85, 0.81);
group.add(strip);
const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.32 });
[[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]].forEach(([lx, lz]) => {
const leg = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.85, 0.08, 2, 0.015), legMat);
leg.position.set(lx, 0.425, lz);
leg.castShadow = true;
group.add(leg);
});
group.position.set(x, 0, z);
scene.add(group);
});
const items = [];
const boxMesh = new THREE.Mesh(
new RoundedBoxGeometry(0.48, 0.38, 0.48, 3, 0.02),
crateMat
);
boxMesh.castShadow = true;
boxMesh.position.set(-2.0, 1.15, 3.5);
scene.add(boxMesh);
items.push({ id: 'box', name: 'Коробка SKU-6500', mesh: boxMesh, halfH: 0.19, twoHands: true });
const palletGroup = new THREE.Group();
const palletMat = new THREE.MeshStandardMaterial({ map: woodTex, bumpMap: concreteBump, bumpScale: 0.01, roughness: 0.78 });
[-0.42, 0, 0.42].forEach((px) => {
const runner = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.11, 1.1, 2, 0.01), palletMat);
runner.position.set(px, 0.055, 0);
runner.castShadow = true;
palletGroup.add(runner);
});
for (let pz = -0.45; pz <= 0.46; pz += 0.225) {
const plank = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.03, 0.16, 2, 0.006), palletMat);
plank.position.set(0, 0.125, pz);
plank.castShadow = true;
plank.receiveShadow = true;
palletGroup.add(plank);
}
palletGroup.position.set(5.5, 0, 8.2);
scene.add(palletGroup);
const shovelGroup = new THREE.Group();
const sShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.95, 14), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 }));
sShaft.position.y = 0.2;
const sBlade = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.32, 0.025, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x94a3b8, bumpMap: brushedMetalBump, bumpScale: 0.01, metalness: 0.88, roughness: 0.22 }));
sBlade.position.y = -0.35;
shovelGroup.add(sShaft, sBlade);
shovelGroup.position.set(1.7, 1.46, 3.5);
scene.add(shovelGroup);
items.push({ id: 'shovel', name: 'Лопата', mesh: shovelGroup, halfH: 0.5, twoHands: false });
const hammerGroup = new THREE.Group();
const hHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 14), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 }));
const hHead = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.065, 0.065, 3, 0.012), new THREE.MeshStandardMaterial({ color: 0x475569, bumpMap: brushedMetalBump, bumpScale: 0.01, metalness: 0.9, roughness: 0.2 }));
hHead.position.y = 0.2;
hammerGroup.add(hHandle, hHead);
hammerGroup.position.set(2.3, 1.17, 3.5);
scene.add(hammerGroup);
items.push({ id: 'hammer', name: 'Молоток', mesh: hammerGroup, halfH: 0.21, twoHands: false });
// 6. ДЕТАЛИЗИРОВАННЫЙ 3D-ШТАБЕЛЁР
const forklift = new THREE.Group();
forklift.position.set(5.5, 0, 5.5);
scene.add(forklift);
const flPaintMat = new THREE.MeshStandardMaterial({
color: 0xf97316,
bumpMap: brushedMetalBump,
bumpScale: 0.005,
metalness: 0.35,
roughness: 0.28
});
const flDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.65, roughness: 0.35 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, bumpMap: concreteBump, bumpScale: 0.02, roughness: 0.85 });
const flBody = new THREE.Mesh(new RoundedBoxGeometry(1.32, 0.62, 1.95, 4, 0.06), flPaintMat);
flBody.position.set(0, 0.52, -0.05);
flBody.castShadow = true;
forklift.add(flBody);
const counterWeight = new THREE.Mesh(new RoundedBoxGeometry(1.26, 0.55, 0.42, 4, 0.08), flDarkMat);
counterWeight.position.set(0, 0.55, -0.92);
counterWeight.castShadow = true;
forklift.add(counterWeight);
const wheels = [];
[[-0.64, 0.58], [0.64, 0.58], [-0.60, -0.68], [0.60, -0.68]].forEach(([wx, wz], idx) => {
const wheelGroup = new THREE.Group();
const r = idx < 2 ? 0.28 : 0.22;
const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 24), tireMat);
tire.rotation.z = Math.PI / 2;
tire.castShadow = true;
const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.23, 16), flPaintMat);
rim.rotation.z = Math.PI / 2;
wheelGroup.add(tire, rim);
wheelGroup.position.set(wx, r, wz);
forklift.add(wheelGroup);
wheels.push(wheelGroup);
});
[[-0.48, 1.62, 0.52], [0.48, 1.62, 0.52]].forEach(([lx, ly, lz]) => {
const headLight = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.09, 0.08, 2, 0.02), lampGlowMat);
headLight.position.set(lx, ly, lz);
forklift.add(headLight);
});
const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.55, 16), flDarkMat);
steeringCol.position.set(0, 0.96, 0.45);
steeringCol.rotation.x = -0.45;
forklift.add(steeringCol);
const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.026, 12, 28), new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.4 }));
steeringWheel.position.set(0, 1.19, 0.34);
steeringWheel.rotation.x = Math.PI / 2 - 0.45;
forklift.add(steeringWheel);
const brakePedal = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.03, 0.16, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0xef4444 }));
brakePedal.position.set(-0.14, 0.85, 0.55);
const gasPedal = new THREE.Mesh(new RoundedBoxGeometry(0.10, 0.03, 0.18, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
gasPedal.position.set(0.14, 0.85, 0.55);
forklift.add(brakePedal, gasPedal);
const flRoof = new THREE.Mesh(new RoundedBoxGeometry(1.22, 0.08, 1.32, 3, 0.025), flDarkMat);
flRoof.position.set(0, 1.88, -0.1);
flRoof.castShadow = true;
forklift.add(flRoof);
[[-0.55, -0.7], [0.55, -0.7], [-0.55, 0.5], [0.55, 0.5]].forEach(([px, pz]) => {
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 1.12, 16), flDarkMat);
pillar.position.set(px, 1.32, pz);
forklift.add(pillar);
});
const mast = new THREE.Mesh(new RoundedBoxGeometry(0.92, 2.25, 0.12, 2, 0.02), flDarkMat);
mast.position.set(0, 1.22, 1.05);
mast.castShadow = true;
forklift.add(mast);
const forksGroup = new THREE.Group();
forksGroup.position.set(0, 0.2, 1.15);
const forkMat = new THREE.MeshStandardMaterial({
color: 0x94a3b8,
bumpMap: brushedMetalBump,
bumpScale: 0.012,
metalness: 0.88,
roughness: 0.24
});
[-0.28, 0.28].forEach((fx) => {
const fork = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.05, 1.02, 2, 0.01), forkMat);
fork.position.set(fx, 0, 0.5);
fork.castShadow = true;
forksGroup.add(fork);
});
forklift.add(forksGroup);
// 7. ФОТОРЕАЛИСТИЧНЫЙ ГУМАНОИД СТЁПА
const armorMat = new THREE.MeshStandardMaterial({
color: 0xf8fafc,
bumpMap: brushedMetalBump,
bumpScale: 0.004,
metalness: 0.32,
roughness: 0.24
});
const carbonMat = new THREE.MeshStandardMaterial({
map: carbonTex,
bumpMap: carbonTex,
bumpScale: 0.01,
metalness: 0.38,
roughness: 0.52
});
const titaniumMat = new THREE.MeshStandardMaterial({
color: 0x94a3b8,
bumpMap: brushedMetalBump,
bumpScale: 0.01,
metalness: 0.9,
roughness: 0.2
});
const visorMat = new THREE.MeshStandardMaterial({
color: 0x020617,
metalness: 0.96,
roughness: 0.05
});
const lensMat = new THREE.MeshStandardMaterial({
color: 0x38bdf8,
emissive: 0x00f0ff,
emissiveIntensity: 2.4
});
const fingerMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.72, roughness: 0.32 });
const robot = new THREE.Group();
scene.add(robot);
const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.16, 0.22, 4, 0.05), carbonMat);
pelvis.position.y = 1.03;
pelvis.castShadow = true;
robot.add(pelvis);
[-0.16, 0.16].forEach((hx) => {
const hipServo = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20), titaniumMat);
hipServo.rotation.z = Math.PI / 2;
hipServo.position.set(hx, 1.01, 0);
robot.add(hipServo);
});
const torsoGroup = new THREE.Group();
torsoGroup.position.set(0, 1.08, 0);
robot.add(torsoGroup);
for (let s = 0; s < 4; s++) {
const vertebra = new THREE.Mesh(new THREE.CylinderGeometry(0.115 - s * 0.006, 0.125 - s * 0.006, 0.065, 20), titaniumMat);
vertebra.position.y = 0.04 + s * 0.072;
vertebra.castShadow = true;
torsoGroup.add(vertebra);
}
[-0.06, 0.06].forEach((cx) => {
const cableCurve = new THREE.CatmullRomCurve3([
new THREE.Vector3(cx, 0.04, -0.11),
new THREE.Vector3(cx * 1.2, 0.22, -0.14),
new THREE.Vector3(cx, 0.44, -0.12)
]);
const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 16, 0.012, 8, false), carbonMat);
torsoGroup.add(cable);
});
const innerTorso = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.34, 0.22, 4, 0.04), carbonMat);
innerTorso.position.set(0, 0.37, 0);
torsoGroup.add(innerTorso);
const chestArmor = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.31, 0.26, 5, 0.055), armorMat);
chestArmor.position.set(0, 0.40, 0.015);
chestArmor.castShadow = true;
torsoGroup.add(chestArmor);
const reactorHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.03, 24), titaniumMat);
reactorHousing.rotation.x = Math.PI / 2;
reactorHousing.position.set(0, 0.41, 0.14);
const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 12, 28), lensMat);
coreRing.position.set(0, 0.41, 0.156);
torsoGroup.add(reactorHousing, coreRing);
[-0.26, 0.26].forEach((sx) => {
const pauldron = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.18, 0.22, 4, 0.055), armorMat);
pauldron.position.set(sx, 0.51, 0);
pauldron.rotation.z = sx < 0 ? 0.18 : -0.18;
pauldron.castShadow = true;
torsoGroup.add(pauldron);
});
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.078, 0.12, 20), titaniumMat);
neck.position.set(0, 0.60, 0);
torsoGroup.add(neck);
[-0.045, 0.045].forEach((nx) => {
const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), carbonMat);
piston.position.set(nx, 0.60, -0.04);
torsoGroup.add(piston);
});
const headGroup = new THREE.Group();
headGroup.position.set(0, 0.74, 0);
torsoGroup.add(headGroup);
const helmetPoints = [
new THREE.Vector2(0.001, -0.14),
new THREE.Vector2(0.085, -0.13),
new THREE.Vector2(0.128, -0.07),
new THREE.Vector2(0.142, 0.01),
new THREE.Vector2(0.132, 0.09),
new THREE.Vector2(0.095, 0.145),
new THREE.Vector2(0.001, 0.165)
];
const skull = new THREE.Mesh(new THREE.LatheGeometry(helmetPoints, 32), armorMat);
skull.scale.set(0.92, 1.02, 1.12);
skull.castShadow = true;
headGroup.add(skull);
const visor = new THREE.Mesh(
new THREE.SphereGeometry(0.145, 32, 24, -Math.PI / 2.7, (2 * Math.PI) / 2.7, Math.PI / 3.2, Math.PI / 2.8),
visorMat
);
visor.rotation.y = Math.PI / 2;
visor.scale.set(1.13, 1.02, 0.93);
headGroup.add(visor);
const cameraNodes = {};
const addCameraEye = (id, x, y, z, rx = 0, ry = 0) => {
const camHousing = new THREE.Group();
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.028, 0.042, 20), titaniumMat);
barrel.rotation.x = Math.PI / 2;
const lens = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), lensMat);
lens.position.z = 0.019;
const viewAnchor = new THREE.Object3D();
viewAnchor.position.z = 0.085;
viewAnchor.rotation.y = Math.PI;
camHousing.add(barrel, lens, viewAnchor);
camHousing.position.set(x, y, z);
camHousing.rotation.set(rx, ry, 0);
headGroup.add(camHousing);
cameraNodes[id] = viewAnchor;
};
addCameraEye('front', 0, 0.01, 0.162, 0, 0);
addCameraEye('back', 0, 0.01, -0.162, 0, Math.PI);
addCameraEye('left', -0.135, 0.01, 0, 0, -Math.PI / 2);
addCameraEye('right', 0.135, 0.01, 0, 0, Math.PI / 2);
addCameraEye('top', 0, 0.168, 0, -Math.PI / 2, 0);
const createLimbWithFiveDigits = (upperLen, lowerLen, radius, isLeg = false) => {
const rootPivot = new THREE.Group();
rootPivot.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.08, 20, 20), titaniumMat));
const innerUpper = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.4, upperLen, 16), titaniumMat);
innerUpper.position.y = -upperLen / 2;
rootPivot.add(innerUpper);
const hydro = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, upperLen * 0.75, 12), carbonMat);
hydro.position.set(0, -upperLen * 0.5, isLeg ? -radius * 0.72 : -radius * 0.65);
rootPivot.add(hydro);
const upperShell = new THREE.Mesh(
new RoundedBoxGeometry(radius * 1.65, upperLen * 0.76, radius * 1.75, 4, radius * 0.45),
armorMat
);
upperShell.position.set(0, -upperLen * 0.5, isLeg ? 0.014 : 0);
upperShell.castShadow = true;
rootPivot.add(upperShell);
const midPivot = new THREE.Group();
midPivot.position.y = -upperLen;
rootPivot.add(midPivot);
const kneeJoint = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, radius * 1.75, 20), titaniumMat);
kneeJoint.rotation.z = Math.PI / 2;
midPivot.add(kneeJoint);
const innerLower = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.38, radius * 0.32, lowerLen, 16), titaniumMat);
innerLower.position.y = -lowerLen / 2;
midPivot.add(innerLower);
const lowerShell = new THREE.Mesh(
new RoundedBoxGeometry(radius * 1.42, lowerLen * 0.74, radius * 1.5, 4, radius * 0.38),
carbonMat
);
lowerShell.position.y = -lowerLen * 0.46;
lowerShell.castShadow = true;
midPivot.add(lowerShell);
const endPivot = new THREE.Group();
endPivot.position.y = -lowerLen;
midPivot.add(endPivot);
const digits = [];
if (isLeg) {
const ankle = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.65, 16, 16), titaniumMat);
endPivot.add(ankle);
const footBase = new THREE.Mesh(new RoundedBoxGeometry(0.115, 0.048, 0.175, 3, 0.015), carbonMat);
footBase.position.set(0, -0.024, 0.035);
footBase.castShadow = true;
endPivot.add(footBase);
for (let i = 0; i < 5; i++) {
const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.042, 8, 10), titaniumMat);
toe.rotation.x = Math.PI / 2;
toe.position.set((i - 2) * 0.022, -0.028, 0.13);
endPivot.add(toe);
digits.push(toe);
}
} else {
const wrist = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.58, 16, 16), titaniumMat);
endPivot.add(wrist);
const palm = new THREE.Mesh(new RoundedBoxGeometry(0.084, 0.08, 0.032, 3, 0.01), carbonMat);
palm.position.set(0, -0.04, 0);
endPivot.add(palm);
for (let i = 0; i < 5; i++) {
const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.052, 8, 10), fingerMat);
if (i === 0) {
finger.position.set(-0.046, -0.048, 0.015);
finger.rotation.z = 0.45;
} else {
finger.position.set((i - 2.5) * 0.019, -0.092, 0);
}
endPivot.add(finger);
digits.push(finger);
}
}
return { rootPivot, midPivot, endPivot, digits };
};
const leftArm = createLimbWithFiveDigits(0.32, 0.30, 0.062, false);
leftArm.rootPivot.position.set(-0.33, 0.50, 0);
torsoGroup.add(leftArm.rootPivot);
const rightArm = createLimbWithFiveDigits(0.32, 0.30, 0.062, false);
rightArm.rootPivot.position.set(0.33, 0.50, 0);
torsoGroup.add(rightArm.rootPivot);
const carryAnchor = new THREE.Object3D();
carryAnchor.position.set(0, 0.15, 0.45);
torsoGroup.add(carryAnchor);
const handAnchor = new THREE.Object3D();
handAnchor.position.set(0, -0.34, 0.04);
rightArm.midPivot.add(handAnchor);
const leftLeg = createLimbWithFiveDigits(0.42, 0.42, 0.082, true);
leftLeg.rootPivot.position.set(-0.145, 1.00, 0);
robot.add(leftLeg.rootPivot);
const rightLeg = createLimbWithFiveDigits(0.42, 0.42, 0.082, true);
rightLeg.rootPivot.position.set(0.145, 1.00, 0);
robot.add(rightLeg.rootPivot);
// 8. ФИЗИКА ВЫСОТ
const getFloorHeight = (x, z, includeTables = false) => {
if (x > -6.0 && x < -3.5 && z > -2.0 && z < 2.0) return -3.5;
if (x > 6.5 && x < 9.0 && z > -4.0 && z < -1.0) return -3.0;
if (x >= 2.0 && x <= 4.0 && z >= -2.5 && z <= 1.5) {
return ((1.5 - z) / 4.0) * 1.1;
}
if (x >= -9.5 && x <= -7.5 && z >= 3.0 && z <= 7.0) {
return ((7.0 - z) / 4.0) * 0.9;
}
if (x > -1.2 && x < 1.2 && z <= -3.0 && z > -6.0) {
const stepIdx = Math.min(5, Math.floor((-3.0 - z) / 0.5));
return (stepIdx + 1) * 0.25;
}
if (x > -1.8 && x < 1.8 && z <= -6.0 && z > -8.5) return 1.5;
if (includeTables) {
for (const t of tables) {
if (Math.abs(x - t.x) < 0.8 && Math.abs(z - t.z) < 0.8) return 0.96;
}
}
return 0.0;
};
const isBlocked = (x, z, radius = 0.45) => {
if (x < -14.5 + radius || x > 14.5 - radius || z < -14.5 + radius || z > 14.5 - radius) return true;
for (const t of tables) {
if (Math.abs(x - t.x) < 0.8 + radius && Math.abs(z - t.z) < 0.8 + radius) return true;
}
return false;
};
// 9. УПРАВЛЕНИЕ И ЦИКЛ 60 FPS
const keys = {};
let velocityY = 0;
let isGrounded = true;
let heldItem = null;
let inForklift = false;
let walkPhase = 0;
let idleTime = 0;
let forkliftSpeed = 0;
const camKeyMap = {
Digit0: 'orbit',
Digit1: 'front',
Digit2: 'back',
Digit3: 'left',
Digit4: 'right',
Digit5: 'top'
};
const onKeyDown = (e) => {
keys[e.code] = true;
if (e.code === 'KeyE') actionTriggerRef.current = 'TOGGLE_ITEM';
if (e.code === 'KeyF') driveTriggerRef.current = true;
if (camKeyMap[e.code]) switchCamera(camKeyMap[e.code]);
};
const onKeyUp = (e) => { keys[e.code] = false; };
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
const clock = new THREE.Clock();
const worldCamPos = new THREE.Vector3();
const worldCamQuat = new THREE.Quaternion();
let animId;
const animate = () => {
animId = requestAnimationFrame(animate);
const dt = Math.min(clock.getDelta(), 0.08);
idleTime += dt;
if (actionTriggerRef.current === 'TOGGLE_ITEM') {
actionTriggerRef.current = null;
if (heldItem) {
scene.attach(heldItem.mesh);
const worldAngle = robot.rotation.y + torsoGroup.rotation.y;
const dropX = Math.max(-14.2, Math.min(14.2, robot.position.x + Math.sin(worldAngle) * 0.75));
const dropZ = Math.max(-14.2, Math.min(14.2, robot.position.z + Math.cos(worldAngle) * 0.75));
const surfaceY = getFloorHeight(dropX, dropZ, true);
heldItem.mesh.position.set(dropX, surfaceY + heldItem.halfH, dropZ);
heldItem.mesh.rotation.set(0, worldAngle, 0);
setEquippedItem('Пусто');
setStatusText(surfaceY < 0 ? `Бросил ${heldItem.name} в яму!` : `Положил: ${heldItem.name}`);

heldItem = null;
} else if (!inForklift) {
let closest = null;
let minDist = 2.1;
items.forEach((it) => {
const d = robot.position.distanceTo(it.mesh.position);
if (d < minDist) { minDist = d; closest = it; }
});
if (closest) {
heldItem = closest;
if (closest.twoHands) {
carryAnchor.add(closest.mesh);
closest.mesh.position.set(0, 0, 0);
closest.mesh.rotation.set(0, 0, 0);
} else {
handAnchor.add(closest.mesh);
closest.mesh.position.set(0, -0.1, 0.15);
closest.mesh.rotation.set(Math.PI / 2, 0, 0);
}
setEquippedItem(closest.name);
setStatusText(`Стёпа взял: ${closest.name}`);

} else {
setStatusText('Рядом нет предметов');
}
}
}
if (driveTriggerRef.current) {
driveTriggerRef.current = false;
if (inForklift) {
scene.attach(robot);
robot.position.set(forklift.position.x - 1.3, forklift.position.y, forklift.position.z);
torsoGroup.rotation.y = 0;
torsoGroup.rotation.x = 0;
inForklift = false;
setIsDriving(false);
setSpeedKmh(0);
setStatusText('Стёпа вышел из штабелёра');
} else if (robot.position.distanceTo(forklift.position) < 2.8) {
forklift.add(robot);
robot.position.set(0, 0.35, -0.15);
robot.rotation.set(0, 0, 0);
torsoGroup.rotation.y = 0;
torsoGroup.rotation.x = 0;
inForklift = true;
setIsDriving(true);
setStatusText('За рулём! W — газ, Space — тормоз, A/D — руль');
} else {
setStatusText('Подойди ближе к штабелёру');
}
}
const throttle = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
const steer = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
if (inForklift) {
const isBraking = Boolean(keys['Space']);
const maxSpeed = 11.5;
gasPedal.position.y = throttle > 0 ? 0.81 : 0.85;
brakePedal.position.y = isBraking ? 0.81 : 0.85;
steeringWheel.rotation.z = steer * 0.85;
if (isBraking) {
if (Math.abs(forkliftSpeed) < 0.25) forkliftSpeed = 0;
else forkliftSpeed -= Math.sign(forkliftSpeed) * 14.0 * dt;
} else if (throttle !== 0) {
const accel = 4.2 + Math.abs(forkliftSpeed) * 0.35;
forkliftSpeed = Math.max(-5.5, Math.min(maxSpeed, forkliftSpeed + throttle * accel * dt));
} else {
forkliftSpeed *= Math.pow(0.25, dt);
if (Math.abs(forkliftSpeed) < 0.05) forkliftSpeed = 0;
}
if (Math.abs(forkliftSpeed) > 0.1) {
forklift.rotation.y += steer * 2.1 * Math.sign(forkliftSpeed) * dt;
}
wheels.forEach((w) => { w.rotation.x += forkliftSpeed * dt * 3.8; });
const nextFx = forklift.position.x + Math.sin(forklift.rotation.y) * forkliftSpeed * dt;
const nextFz = forklift.position.z + Math.cos(forklift.rotation.y) * forkliftSpeed * dt;
const fSurfaceY = getFloorHeight(nextFx, nextFz, false);
if (!isBlocked(nextFx, nextFz, 0.85)) {
forklift.position.x = nextFx;
forklift.position.z = nextFz;
forklift.position.y += (fSurfaceY - forklift.position.y) * Math.min(1, dt * 12);
} else {
forkliftSpeed = -forkliftSpeed * 0.3;
}
if (forklift.position.y < -2.2) {
forklift.position.set(5.5, 0, 5.5);
forkliftSpeed = 0;
setStatusText('Штабелёр упал в яму! Эвакуация на базу');
}
if (keys['KeyR']) forksGroup.position.y = Math.min(1.6, forksGroup.position.y + 1.1 * dt);
if (keys['KeyT']) forksGroup.position.y = Math.max(0.2, forksGroup.position.y - 1.1 * dt);
setSpeedKmh(Math.round(Math.abs(forkliftSpeed) * 3.6));
} else {
const isRunning = Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
const speed = isRunning ? 6.8 : 3.2;
const torsoTurn = (keys['KeyQ'] ? 1 : 0) - (keys['KeyZ'] ? 1 : 0);
torsoGroup.rotation.y += torsoTurn * 3.4 * dt;
robot.rotation.y += steer * 3.0 * dt;
if (throttle !== 0) {
const nextX = robot.position.x + Math.sin(robot.rotation.y) * throttle * speed * dt;
const nextZ = robot.position.z + Math.cos(robot.rotation.y) * throttle * speed * dt;
const nextFloor = getFloorHeight(nextX, nextZ, false);
if (!isBlocked(nextX, nextZ, 0.4) && (nextFloor - robot.position.y <= 0.35)) {
robot.position.x = nextX;
robot.position.z = nextZ;
}
walkPhase += dt * (isRunning ? 17 : 10);
const swingAmp = isRunning ? 0.85 : 0.52;
const swing = Math.sin(walkPhase) * swingAmp;
leftLeg.rootPivot.rotation.x = swing;
rightLeg.rootPivot.rotation.x = -swing;
leftLeg.midPivot.rotation.x = Math.max(0, -swing) * (isRunning ? 1.15 : 0.75);
rightLeg.midPivot.rotation.x = Math.max(0, swing) * (isRunning ? 1.15 : 0.75);
torsoGroup.rotation.x += ((isRunning ? 0.14 : 0.04) - torsoGroup.rotation.x) * Math.min(1, dt * 8);
headGroup.rotation.y *= 0.88;
leftLeg.digits.forEach((toe) => { toe.rotation.x = Math.PI / 2 + Math.max(0, -swing) * 0.4; });
rightLeg.digits.forEach((toe) => { toe.rotation.x = Math.PI / 2 + Math.max(0, swing) * 0.4; });
if (!heldItem) {
leftArm.rootPivot.rotation.x = -swing * 0.65;
rightArm.rootPivot.rotation.x = swing * 0.65;
leftArm.midPivot.rotation.x = -0.25 - Math.max(0, swing) * 0.35;
rightArm.midPivot.rotation.x = -0.25 - Math.max(0, -swing) * 0.35;
}
} else {
leftLeg.rootPivot.rotation.x *= 0.85;
rightLeg.rootPivot.rotation.x *= 0.85;
leftLeg.midPivot.rotation.x *= 0.85;
rightLeg.midPivot.rotation.x *= 0.85;
torsoGroup.rotation.x = Math.sin(idleTime * 2.2) * 0.02;
headGroup.rotation.y = Math.sin(idleTime * 0.85) * 0.14;
}
if (heldItem?.twoHands) {
leftArm.rootPivot.rotation.x = -1.0;
rightArm.rootPivot.rotation.x = -1.0;
leftArm.midPivot.rotation.x = -0.35;
rightArm.midPivot.rotation.x = -0.35;
leftArm.digits.forEach((f) => { f.rotation.x = 0.5; });
rightArm.digits.forEach((f) => { f.rotation.x = 0.5; });
} else if (heldItem) {
rightArm.rootPivot.rotation.x = -0.9;
rightArm.midPivot.rotation.x = -0.4;
rightArm.digits.forEach((f) => { f.rotation.x = 0.7; });
} else {
leftArm.digits.forEach((f) => { f.rotation.x = 0.15; });
rightArm.digits.forEach((f) => { f.rotation.x = 0.15; });
if (throttle === 0) {
leftArm.rootPivot.rotation.x = Math.sin(idleTime * 2.2) * 0.03;
rightArm.rootPivot.rotation.x = -Math.sin(idleTime * 2.2) * 0.03;
leftArm.midPivot.rotation.x = -0.15;
rightArm.midPivot.rotation.x = -0.15;
}
}
if (keys['Space'] && isGrounded) {
velocityY = 7.6;
isGrounded = false;
}
velocityY -= 20.0 * dt;
robot.position.y += velocityY * dt;
const floorY = getFloorHeight(robot.position.x, robot.position.z, false);
if (robot.position.y <= floorY) {
robot.position.y = floorY;
velocityY = 0;
isGrounded = true;
}
if (robot.position.y < -2.6) {
robot.position.set(0, 0.5, 0);
velocityY = 0;
setStatusText('Стёпа упал в глубокую яму! Респавн в центре');
}
}
// ПЕРЕКЛЮЧЕНИЕ МЕЖДУ ОБЗОРНОЙ КАМЕРОЙ (0) И 5 ОБЪЕКТИВАМИ СТЁПЫ (1-5)
const currentCamMode = activeCamRef.current;
if (currentCamMode === 'orbit') {
const activeActor = inForklift ? forklift : robot;
const targetPos = new THREE.Vector3(
activeActor.position.x,
activeActor.position.y + 1.3,
activeActor.position.z
);
if (!controls.enabled) {
controls.enabled = true;
controls.target.copy(targetPos);
camera.position.set(
activeActor.position.x,
activeActor.position.y + 6.2,
activeActor.position.z + 13.0
);
} else {
const camDelta = new THREE.Vector3().subVectors(targetPos, controls.target).multiplyScalar(Math.min(dt * 5, 1));
controls.target.add(camDelta);
camera.position.add(camDelta);
}
controls.update();
} else if (cameraNodes[currentCamMode]) {
controls.enabled = false;
scene.updateMatrixWorld(true);
cameraNodes[currentCamMode].getWorldPosition(worldCamPos);
cameraNodes[currentCamMode].getWorldQuaternion(worldCamQuat);
camera.position.copy(worldCamPos);
camera.quaternion.copy(worldCamQuat);
}
composer.render();
};
animate();
return () => {
window.removeEventListener('keydown', onKeyDown);
window.removeEventListener('keyup', onKeyUp);
cancelAnimationFrame(animId);
pmremGenerator.dispose();
composer.dispose();
renderer.dispose();
if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
};
}, []);
const camButtons = [
{ id: 'orbit', label: '🎥 Обзор (0)' },
{ id: 'front', label: '👁 Перед (1)' },
{ id: 'back', label: '👁 Зад (2)' },
{ id: 'left', label: '👁 Лево (3)' },
{ id: 'right', label: '👁 Право (4)' },
{ id: 'top', label: '🛰 Верх (5)' }
];
  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 50px)' }}>
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 10, backgroundColor: 'rgba(15, 23, 42, 0.88)', border: '1px solid #334155', borderRadius: '10px', padding: '12px 16px', color: '#f8fafc', fontFamily: 'sans-serif', maxWidth: '460px' }}>
        <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 'bold' }}>
          CLOUD-COLLAR 4.0 • РОБОТ СТЁПА (5 КАМЕР • 20 ПАЛЬЦЕВ)
        </div>
        <div style={{ fontSize: '13px', margin: '6px 0' }}>
          {statusText}
        </div>
        <div style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '8px', lineHeight: '1.4' }}>
          • <b>Стёпа:</b> WASD — шаг, <b>Shift</b> — бег, <b>Q / Z</b> — торс 360°, Space — прыжок<br />
          • <b>Штабелёр:</b> <b>W</b> — газ, <b>Space</b> — тормоз, R/T — вилы {isDriving && <b style={{ color: '#22c55e' }}>({speedKmh} км/ч)</b>}
        </div>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
          В руках: <b style={{ color: '#f59e0b' }}>{equippedItem}</b>
        </div>

        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {camButtons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => switchCamera(btn.id)}
              style={{
                padding: '4px 8px',
                borderRadius: '5px',
                border: '1px solid #475569',
                backgroundColor: activeCam === btn.id ? '#0284c7' : '#1e293b',
                color: '#f8fafc',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => { actionTriggerRef.current = 'TOGGLE_ITEM'; }}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#38bdf8', color: '#0f172a', fontWeight: 'bold', cursor: 'pointer' }}
          >
            ✋ Взять / Положить (E)
          </button>
          <button
            onClick={() => { driveTriggerRef.current = true; }}
            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: isDriving ? '#ef4444' : '#f97316', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
          >
            🚜 {isDriving ? 'Выйти (F)' : 'Штабелёр (F)'}
          </button>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
