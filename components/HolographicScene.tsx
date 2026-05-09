'use client';

import { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Torus, Ring, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

const ACCENT = '#38bdf8';
const ACCENT_SOFT = '#0ea5e9';
const ACCENT_GREEN = '#34d399';
const CORE_BASE = '#0c1424';
const CORE_EMISSIVE = '#1e3a5c';

function CoreSphere({ active }: { active: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5;
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.2;
    }
    if (glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group>
      <Sphere ref={glowRef} args={[1.2, 32, 32]}>
        <meshBasicMaterial
          color={ACCENT}
          transparent
          opacity={active ? 0.08 : 0.04}
          side={THREE.BackSide}
        />
      </Sphere>
      <Sphere ref={meshRef} args={[0.8, 64, 64]}>
        <MeshDistortMaterial
          color={CORE_BASE}
          emissive={CORE_EMISSIVE}
          emissiveIntensity={active ? 0.8 : 0.3}
          distort={active ? 0.3 : 0.1}
          speed={active ? 3 : 1}
          metalness={0.8}
          roughness={0.2}
        />
      </Sphere>
      <Sphere args={[0.82, 16, 16]}>
        <meshBasicMaterial
          color={ACCENT}
          transparent
          opacity={active ? 0.3 : 0.15}
          wireframe
        />
      </Sphere>
    </group>
  );
}

function OrbitRing({
  radius,
  speed,
  tilt,
  color,
}: {
  radius: number;
  speed: number;
  tilt: number;
  color: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.z = state.clock.elapsedTime * speed;
  });
  return (
    <group ref={ref} rotation={[tilt, 0, 0]}>
      <Ring args={[radius - 0.01, radius + 0.01, 128]}>
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </Ring>
      <mesh position={[radius, 0, 0]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function makeParticlePositions(count: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 1.5 + Math.random() * 1.5;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  return positions;
}

function DataParticles({ active }: { active: boolean }) {
  const count = 200;
  const pointsRef = useRef<THREE.Points>(null);
  // 랜덤 좌표는 마운트 시 한 번만 계산 — 재렌더에 영향 없음
  const [positions] = useState(() => makeParticlePositions(count));

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.1;
      pointsRef.current.rotation.x = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={active ? 0.03 : 0.02}
        color={ACCENT}
        transparent
        opacity={active ? 0.8 : 0.4}
        sizeAttenuation
      />
    </points>
  );
}

function HexGrid() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = -Math.PI / 2 + Math.sin(state.clock.elapsedTime * 0.1) * 0.05;
      ref.current.position.y = -2 + Math.sin(state.clock.elapsedTime * 0.2) * 0.1;
    }
  });
  return (
    <mesh ref={ref} position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[10, 10, 20, 20]} />
      <meshBasicMaterial color={ACCENT} transparent opacity={0.05} wireframe />
    </mesh>
  );
}

function FloatingTorus({ y, speed, color }: { y: number; speed: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = state.clock.elapsedTime * speed;
      ref.current.rotation.y = state.clock.elapsedTime * speed * 0.7;
    }
  });
  return (
    <Torus ref={ref} args={[1.5, 0.005, 8, 100]} position={[0, y, 0]}>
      <meshBasicMaterial color={color} transparent opacity={0.3} />
    </Torus>
  );
}

export default function HolographicScene({
  active,
  visible = true,
}: {
  active: boolean;
  visible?: boolean;
}) {
  // 모션 감소 모드에서는 정적 렌더(demand)로 GPU 부담 축소
  const [reduce, setReduce] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const frameloop: 'always' | 'demand' | 'never' = !visible
    ? 'never'
    : reduce
    ? 'demand'
    : 'always';

  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 60 }}
      style={{ background: 'transparent' }}
      gl={{ alpha: true, antialias: true }}
      frameloop={frameloop}
      dpr={[1, 1.5]}
    >
      <ambientLight intensity={0.1} />
      <pointLight position={[0, 0, 0]} color={ACCENT} intensity={2} distance={10} />
      <pointLight position={[3, 2, 2]} color={ACCENT_SOFT} intensity={0.5} />
      <pointLight position={[-3, -2, -2]} color={ACCENT_GREEN} intensity={0.3} />

      <CoreSphere active={active} />
      <OrbitRing radius={1.4} speed={0.8} tilt={0.3} color={ACCENT} />
      <OrbitRing radius={1.8} speed={-0.5} tilt={1.2} color={ACCENT_SOFT} />
      <OrbitRing radius={2.2} speed={0.3} tilt={0.8} color={ACCENT_GREEN} />
      <DataParticles active={active} />
      <HexGrid />
      <FloatingTorus y={0} speed={0.2} color={ACCENT} />
      <FloatingTorus y={0} speed={-0.15} color={ACCENT_SOFT} />
    </Canvas>
  );
}
