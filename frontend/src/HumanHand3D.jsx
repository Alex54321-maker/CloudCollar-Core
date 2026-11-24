import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const HumanHand3D = () => {
  const mountRef = useRef(null);
  const wsRef = useRef(null);

  const [robotStatus, setRobotStatus] = useState('Симулятор (Офлайн)');
  const [robotIp, setRobotIp] = useState('ws://192.168.1.100:9090');

  const [fingers, setFingers] = useState({
    thumb: 0.1,
    index: 0.1,
    middle: 0.1,
    ring: 0.1,
    pinky: 0.1,
  });

  const [wristRot, setWristRot] = useState(0);
  const [armPosZ, setArmPosZ] = useState(0);
  const [isGrabbed, setIsGrabbed] = useState(false);

  const jointsRef = useRef({
    armGroup: null,
    wristGroup: null,
    fingers: {},
    targetBox: null,
  });

  const stateRef = useRef({ fingers, wristRot, armPosZ, isGrabbed });
  stateRef.current = { fingers, wristRot, armPosZ, isGrabbed };

  const connectToRobot = () => {
    try {
      const socket = new WebSocket(robotIp);
      socket.onopen = () => {
        setRobotStatus('🟢 Подключено к роботу');
        wsRef.current = socket;
      };
      socket.onclose = () => {
        setRobotStatus('🔴 Отключено (Режим симулятора)');
        wsRef.current = null;
      };
      socket.onerror = () => {
        setRobotStatus('⚠️ Робот не найден (Работает симулятор)');
      };
    } catch (err) {
      setRobotStatus('⚠️ Ошибка адреса');
    }
  };
  useEffect(() => {
    const MAX_RAD = 1.8;
    const commandPacket = {
      type: 'joint_trajectory',
      joints: {
        thumb_servo: +(fingers.thumb * MAX_RAD).toFixed(3),
        index_servo: +(fingers.index * MAX_RAD).toFixed(3),
        middle_servo: +(fingers.middle * MAX_RAD).toFixed(3),
        ring_servo: +(fingers.ring * MAX_RAD).toFixed(3),
        pinky_servo: +(fingers.pinky * MAX_RAD).toFixed(3),
        wrist_servo: +wristRot.toFixed(3),
        arm_rail_z: +armPosZ.toFixed(3),
      },
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(commandPacket));
    }
  }, [fingers, wristRot, armPosZ]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d16');
    scene.fog = new THREE.Fog('#090d16', 10, 25);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(4.5, 3.5, 5.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.2, 0.5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x10b981, 1.0);
    rimLight.position.set(-5, 4, -5);
    scene.add(rimLight);
    scene.add(new THREE.GridHelper(12, 24, 0x1e293b, 0x0f172a));

    const shellMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.4 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.3 });

    const armGroup = new THREE.Group();
    armGroup.position.set(0, 1.5, 0);
    scene.add(armGroup);
    jointsRef.current.armGroup = armGroup;

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 2.2, 20), shellMat);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.z = -1.3;
    forearm.castShadow = true;
    armGroup.add(forearm);

    armGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 16), jointMat));

    const wristGroup = new THREE.Group();
    armGroup.add(wristGroup);
    jointsRef.current.wristGroup = wristGroup;

    const palm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.32, 1.25), shellMat);
    palm.position.set(0, 0, 0.65);
    palm.castShadow = true;
    wristGroup.add(palm);

    const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.15), accentMat);
    led.position.set(0, 0.17, 0.65);
    wristGroup.add(led);

    const createFinger = (name, xPos, zPos, scaleLength, isThumb = false) => {
      const basePivot = new THREE.Group();
      basePivot.position.set(xPos, 0, zPos);
      if (isThumb) {
        basePivot.rotation.y = -0.65;
        basePivot.rotation.z = 0.5;
      }
      wristGroup.add(basePivot);

      const segments = [];
      let parent = basePivot;
      const lengths = isThumb ? [0.42, 0.36, 0.3] : [0.48 * scaleLength, 0.38 * scaleLength, 0.28 * scaleLength];
      lengths.forEach((len, idx) => {
        parent.add(new THREE.Mesh(new THREE.SphereGeometry(0.11 - idx * 0.012, 12, 12), jointMat));
        const pivot = new THREE.Group();
        parent.add(pivot);

        const phalanx = new THREE.Mesh(
          new THREE.CylinderGeometry(0.095 - idx * 0.012, 0.105 - idx * 0.012, len, 14),
          shellMat
        );
        phalanx.rotation.x = Math.PI / 2;
        phalanx.position.z = len / 2;
        phalanx.castShadow = true;
        pivot.add(phalanx);

        const nextOrigin = new THREE.Group();
        nextOrigin.position.z = len;
        pivot.add(nextOrigin);

        segments.push(pivot);
        parent = nextOrigin;
      });

      jointsRef.current.fingers[name] = { basePivot, segments, isThumb };
    };

    createFinger('thumb', -0.62, 0.35, 0.85, true);
    createFinger('index', -0.42, 1.28, 0.96);
    createFinger('middle', -0.14, 1.32, 1.05);
    createFinger('ring', 0.14, 1.28, 0.96);
    createFinger('pinky', 0.42, 1.22, 0.8);

    const targetBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 })
    );
    targetBox.position.set(0, 0.3, 1.8);
    targetBox.castShadow = true;
    scene.add(targetBox);
    jointsRef.current.targetBox = targetBox;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const { fingers: fState, wristRot: wRot, armPosZ: aPos, isGrabbed: grabbed } = stateRef.current;

      armGroup.position.z += (aPos - armGroup.position.z) * 0.12;
      wristGroup.rotation.z += (wRot - wristGroup.rotation.z) * 0.12;
      Object.entries(jointsRef.current.fingers).forEach(([key, fObj]) => {
        const curl = fState[key] ?? 0;
        fObj.segments.forEach((seg, idx) => {
          const targetAngle = curl * (idx === 0 ? 1.15 : 1.05);
          seg.rotation.x += (targetAngle - seg.rotation.x) * 0.15;
        });
      });

      if (grabbed) {
        const worldPalmPos = new THREE.Vector3(0, -0.35, 0.95);
        wristGroup.localToWorld(worldPalmPos);
        targetBox.position.lerp(worldPalmPos, 0.2);
        targetBox.rotation.z = wristGroup.rotation.z;
      } else {
        targetBox.position.lerp(new THREE.Vector3(0, 0.28, 1.8), 0.12);
        targetBox.rotation.z += (0 - targetBox.rotation.z) * 0.12;
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
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (wsRef.current) wsRef.current.close();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  const setGesture = (type) => {
    if (type === 'open') {
      setFingers({ thumb: 0.05, index: 0.05, middle: 0.05, ring: 0.05, pinky: 0.05 });
      setIsGrabbed(false);
    } else if (type === 'fist') {
      setFingers({ thumb: 0.85, index: 0.95, middle: 0.95, ring: 0.95, pinky: 0.95 });
    } else if (type === 'grab') {
      setArmPosZ(0.85);
      setFingers({ thumb: 0.65, index: 0.68, middle: 0.68, ring: 0.68, pinky: 0.68 });
      setIsGrabbed(true);
    } else if (type === 'release') {
      setFingers({ thumb: 0.1, index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.1 });
      setIsGrabbed(false);
      setArmPosZ(0);
    }
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono flex flex-col lg:flex-row">
      <div className="w-full lg:w-96 bg-slate-900 border-r border-slate-800 p-6 flex flex-col gap-4 z-10 overflow-y-auto">
        <div>
          <h1 className="text-lg font-bold text-emerald-400 tracking-wider">🖐️ BIONIC HAND // SIM-TO-REAL</h1>
          <p className="text-xs text-slate-400 mt-1">{robotStatus}</p>
        </div>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col gap-2">
          <div className="text-[11px] text-slate-400 uppercase">Адрес робота (WebSocket / ROS):</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={robotIp}
              onChange={(e) => setRobotIp(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-cyan-300"
            />
            <button
              onClick={connectToRobot}
              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-bold"
            >
              Связь
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setGesture('open')} className="py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs border border-slate-700">
            ✋ Открыть ладонь
          </button>
          <button onClick={() => setGesture('fist')} className="py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs border border-slate-700">
            ✊ Сжать кулак
          </button>
          <button onClick={() => setGesture('grab')} className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs">
            🦾 Взять деталь
          </button>
          <button onClick={() => setGesture('release')} className="py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs">
            📦 Положить деталь
          </button>
        </div>

        <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Управление пальцами:</div>
          {[
            { key: 'thumb', label: 'Большой (Thumb)' },
            { key: 'index', label: 'Указательный (Index)' },
            { key: 'middle', label: 'Средний (Middle)' },
            { key: 'ring', label: 'Безымянный (Ring)' },
            { key: 'pinky', label: 'Мизинец (Pinky)' },
          ].map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>{label}</span>
                <span className="text-emerald-400">{Math.round(fingers[key] * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fingers[key]}
                onChange={(e) => setFingers((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                className="accent-emerald-500 cursor-pointer"
              />
            </div>
          ))}
        </div>

        <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span>Поворот запястья</span>
              <span className="text-cyan-400">{Math.round((wristRot * 180) / Math.PI)}°</span>
            </div>
            <input
              type="range"
              min="-1.5"
              max="1.5"
              step="0.05"
              value={wristRot}
              onChange={(e) => setWristRot(parseFloat(e.target.value))}
              className="accent-cyan-500 cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span>Вылет руки вперед</span>
              <span className="text-cyan-400">{armPosZ.toFixed(2)} м</span>
            </div>
            <input
              type="range"
              min="-0.5"
              max="1.2"
              step="0.05"
              value={armPosZ}
              onChange={(e) => setArmPosZ(parseFloat(e.target.value))}
              className="accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div ref={mountRef} className="flex-1 h-[60vh] lg:h-screen cursor-grab active:cursor-grabbing" />
    </div>
  );
};

export default HumanHand3D;
