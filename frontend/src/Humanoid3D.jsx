import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default function Humanoid3D() {
  const containerRef = useRef(null);
  const [statusText, setStatusText] = useState('Инициализация робота...');
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.Fog(0x0f172a, 10, 28);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 4.2, 8.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.3, 0);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 9, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.7);
    rimLight.position.set(-5, 4, -5);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(24, 24, 0x334155, 0x1e293b);
    grid.position.y = 0.01;
    scene.add(grid);
    const createTable = (xPos, labelColor) => {
      const group = new THREE.Group();
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.12, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.4, roughness: 0.5 })
      );
      top.position.y = 0.9;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(1.62, 0.04, 0.1),
        new THREE.MeshStandardMaterial({ color: labelColor, emissive: labelColor, emissiveIntensity: 0.8 })
      );
      strip.position.set(0, 0.9, 0.78);
      group.add(strip);

      const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.9);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
      [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([lx, lz]) => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx, 0.45, lz);
        leg.castShadow = true;
        group.add(leg);
      });

      group.position.x = xPos;
      scene.add(group);
      return group;
    };

    const TABLE_A_X = -3.0;
    const TABLE_B_X = 3.0;
    createTable(TABLE_A_X, 0x38bdf8);
    createTable(TABLE_B_X, 0x22c55e);

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.35, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 })
    );
    box.castShadow = true;
    const BOX_ON_TABLE_Y = 0.96 + 0.175;
    box.position.set(TABLE_A_X, BOX_ON_TABLE_Y, 0);
    scene.add(box);
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.55,
      roughness: 0.25,
    });
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.3,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.2,
    });

    const robot = new THREE.Group();
    scene.add(robot);

    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.16, 8, 16), jointMat);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.position.y = 1.05;
    pelvis.castShadow = true;
    robot.add(pelvis);

    const torsoGroup = new THREE.Group();
    torsoGroup.position.set(0, 1.08, 0);
    robot.add(torsoGroup);

    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.36, 12, 20), armorMat);
    chest.position.y = 0.32;
    chest.scale.set(1.15, 1, 0.75);
    chest.castShadow = true;
    torsoGroup.add(chest);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.68, 0);
    torsoGroup.add(headGroup);

    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.1, 12, 20), armorMat);
    head.castShadow = true;
    headGroup.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), visorMat);
    visor.position.set(0, 0.02, 0.12);
    headGroup.add(visor);
    const createLimb = (upperLen, lowerLen, radius) => {
      const rootPivot = new THREE.Group();

      const jointSphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.15, 16, 16), jointMat);
      rootPivot.add(jointSphere);

      const upperMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, upperLen, 8, 16),
        armorMat
      );
      upperMesh.position.y = -upperLen / 2;
      upperMesh.castShadow = true;
      rootPivot.add(upperMesh);

      const midPivot = new THREE.Group();
      midPivot.position.y = -upperLen;
      rootPivot.add(midPivot);

      const midSphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 16, 16), jointMat);
      midPivot.add(midSphere);

      const lowerMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius * 0.85, lowerLen, 8, 16),
        armorMat
      );
      lowerMesh.position.y = -lowerLen / 2;
      lowerMesh.castShadow = true;
      midPivot.add(lowerMesh);

      return { rootPivot, midPivot };
    };

    const leftArm = createLimb(0.32, 0.30, 0.065);
    leftArm.rootPivot.position.set(-0.34, 0.52, 0);
    torsoGroup.add(leftArm.rootPivot);

    const rightArm = createLimb(0.32, 0.30, 0.065);
    rightArm.rootPivot.position.set(0.34, 0.52, 0);
    torsoGroup.add(rightArm.rootPivot);

    const carryAnchor = new THREE.Object3D();
    carryAnchor.position.set(0, 0.15, 0.48);
    torsoGroup.add(carryAnchor);

    const leftLeg = createLimb(0.42, 0.42, 0.085);
    leftLeg.rootPivot.position.set(-0.15, 1.02, 0);
    robot.add(leftLeg.rootPivot);

    const rightLeg = createLimb(0.42, 0.42, 0.085);
    rightLeg.rootPivot.position.set(0.15, 1.02, 0);
    robot.add(rightLeg.rootPivot);
    let state = 0;
    let actionTimer = 0;
    let walkPhase = 0;
    let carryingBox = false;
    const WALK_SPEED = 1.8;

    const lerp = (a, b, t) => a + (b - a) * Math.min(t, 1);

    const clock = new THREE.Clock();
    let animationFrameId;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);

      if (!pausedRef.current) {
        let isWalking = false;
        let targetX = 0;
        let targetArmAngle = 0;
        let targetElbowAngle = -0.2;
        let targetTorsoBend = 0;

        if (state === 0) {
          setStatusText('Шаг 1/5: Идёт к Столу А за SKU-6500');
          targetX = TABLE_A_X + 0.75;
          isWalking = true;
          if (Math.abs(robot.position.x - targetX) < 0.05) {
            state = 1;
            actionTimer = 0;
          }
        } else if (state === 1) {
          setStatusText('Шаг 2/5: Захват коробки SKU-6500');
          actionTimer += dt;
          targetTorsoBend = 0.25;
          targetArmAngle = -1.1;
          targetElbowAngle = -0.6;
          if (actionTimer > 0.8) {
            carryingBox = true;
            state = 2;
          }
        } else if (state === 2) {
          setStatusText('Шаг 3/5: Переносит SKU-6500 на Стол Б');
          targetX = TABLE_B_X - 0.75;
          isWalking = true;
          targetArmAngle = -0.95;
          targetElbowAngle = -0.85;
          if (Math.abs(robot.position.x - targetX) < 0.05) {
            state = 3;
            actionTimer = 0;
          }
        } else if (state === 3) {
          setStatusText('Шаг 4/5: Разгрузка SKU-6500 на Стол Б');
          actionTimer += dt;
          targetTorsoBend = 0.25;
          targetArmAngle = -1.1;
          targetElbowAngle = -0.5;
          if (actionTimer > 0.8) {
            carryingBox = false;
            box.position.set(TABLE_B_X, BOX_ON_TABLE_Y, 0);
            state = 4;
          }
        } else if (state === 4) {
          setStatusText('Шаг 5/5: Возврат в исходную точку');
          targetX = 0;
          isWalking = true;
          if (Math.abs(robot.position.x - targetX) < 0.05) {
            box.position.set(TABLE_A_X, BOX_ON_TABLE_Y, 0);
            state = 0;
          }
        }
        if (isWalking) {
          const dir = Math.sign(targetX - robot.position.x);
          robot.position.x += dir * WALK_SPEED * dt;
          const desiredRotY = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          robot.rotation.y = lerp(robot.rotation.y, desiredRotY, dt * 8);

          walkPhase += dt * 9;
          const swing = Math.sin(walkPhase) * 0.55;
          leftLeg.rootPivot.rotation.x = swing;
          rightLeg.rootPivot.rotation.x = -swing;
          leftLeg.midPivot.rotation.x = Math.max(0, -swing) * 0.9;
          rightLeg.midPivot.rotation.x = Math.max(0, swing) * 0.9;

          robot.position.y = Math.abs(Math.cos(walkPhase)) * 0.04;

          if (!carryingBox) {
            leftArm.rootPivot.rotation.x = -swing * 0.5;
            rightArm.rootPivot.rotation.x = swing * 0.5;
          }
        } else {
          leftLeg.rootPivot.rotation.x = lerp(leftLeg.rootPivot.rotation.x, 0, dt * 8);
          rightLeg.rootPivot.rotation.x = lerp(rightLeg.rootPivot.rotation.x, 0, dt * 8);
          leftLeg.midPivot.rotation.x = lerp(leftLeg.midPivot.rotation.x, 0, dt * 8);
          rightLeg.midPivot.rotation.x = lerp(rightLeg.midPivot.rotation.x, 0, dt * 8);
          robot.position.y = lerp(robot.position.y, 0, dt * 8);
        }

        torsoGroup.rotation.x = lerp(torsoGroup.rotation.x, targetTorsoBend, dt * 6);
        if (carryingBox || !isWalking) {
          leftArm.rootPivot.rotation.x = lerp(leftArm.rootPivot.rotation.x, targetArmAngle, dt * 6);
          rightArm.rootPivot.rotation.x = lerp(rightArm.rootPivot.rotation.x, targetArmAngle, dt * 6);
          leftArm.midPivot.rotation.x = lerp(leftArm.midPivot.rotation.x, targetElbowAngle, dt * 6);
          rightArm.midPivot.rotation.x = lerp(rightArm.midPivot.rotation.x, targetElbowAngle, dt * 6);
        }

        if (carryingBox) {
          const worldPos = new THREE.Vector3();
          carryAnchor.getWorldPosition(worldPos);
          box.position.copy(worldPos);
          box.rotation.y = robot.rotation.y;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);
  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 50px)' }}>
      <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '12px 18px',
        color: '#f8fafc',
        fontFamily: 'sans-serif',
        backdropFilter: 'blur(6px)'
      }}>
        <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 'bold', textTransform: 'uppercase' }}>
          Cloud-Collar 4.0 • Кибер-гуманоид
        </div>
        <div style={{ fontSize: '15px', margin: '6px 0 12px 0' }}>{statusText}</div>
        <button
          onClick={() => setIsPaused((prev) => !prev)}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isPaused ? '#22c55e' : '#f59e0b',
            color: '#0f172a',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          {isPaused ? '▶ Продолжить' : '⏸ Пауза'}
        </button>
      </div>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
