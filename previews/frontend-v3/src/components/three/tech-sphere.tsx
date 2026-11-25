"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ScenePalette } from "./palette";

export type SphereItem = {
  name: string;
  category: string;
  weight: number; // 0..1
};

type Props = {
  items: SphereItem[];
  palette: ScenePalette;
  activeCategory: string | null;
  categoryColors: Record<string, string>;
  reduced: boolean;
  active: boolean;
};

const sphereRadius = 2.45;
const cameraDistance = 6.4;
/** Seconds for the nodes to assemble the first time the sphere comes into view. */
const assembleTime = 1.6;
const arcSteps = 8;

type LabelLayout = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  score: number;
  targetOpacity: number;
  opacity: number;
  eligible: boolean;
  visible: boolean;
};

/** Fit both the globe and its HTML labels inside the current canvas. */
function FitCamera() {
  const { size } = useThree();
  const labelInset = Math.min(84, size.width * 0.24);
  const usableWidth = Math.max(size.width - labelInset * 2, 1);
  const usableHeight = Math.max(size.height - 56, 1);
  // A sphere's silhouette uses asin(radius / distance), not atan(radius / distance).
  const globeTangent = Math.tan(Math.asin(sphereRadius / cameraDistance));
  const orbitTangent = Math.tan(Math.asin((sphereRadius * 1.25) / cameraDistance));
  const halfFovTangent = Math.max(
    (globeTangent * size.height) / usableWidth,
    (globeTangent * size.height) / usableHeight,
    (orbitTangent * size.height) / Math.max(Math.min(size.width, size.height) - 24, 1),
  );
  const fov = size.width > 1 && size.height > 1
    ? THREE.MathUtils.radToDeg(2 * Math.atan(halfFovTangent))
    : 64;

  return <PerspectiveCamera makeDefault position={[0, 0, cameraDistance]} fov={fov} />;
}

/** Evenly distributes N points on a sphere (Fibonacci lattice). */
function fibonacciSphere(count: number, radius: number) {
  const pts: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return pts;
}

/** Great-circle arcs joining each node to its two nearest neighbours of the same category. */
function constellations(items: SphereItem[], positions: THREE.Vector3[]) {
  const byCategory = new Map<string, number[]>();
  items.forEach((item, i) => byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), i]));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  return Array.from(byCategory, ([category, indices]) => {
    const pairs = new Set<string>();
    const points: number[] = [];
    for (const i of indices) {
      const nearest = indices
        .filter((j) => j !== i)
        .sort((x, y) => positions[i].distanceToSquared(positions[x]) - positions[i].distanceToSquared(positions[y]))
        .slice(0, 2);
      for (const j of nearest) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        for (let s = 0; s < arcSteps; s++) {
          a.copy(positions[i]).lerp(positions[j], s / arcSteps).setLength(sphereRadius * 1.004);
          b.copy(positions[i]).lerp(positions[j], (s + 1) / arcSteps).setLength(sphereRadius * 1.004);
          points.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return { category, geometry };
  });
}

/** easeOutBack: a small overshoot so each node pops into place. */
function pop(t: number) {
  const c = 1.70158;
  return t <= 0 ? 0 : 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function Cloud({
  items,
  palette,
  activeCategory,
  categoryColors,
  reduced,
}: Omit<Props, "active">) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const linkMaterials = useRef<(THREE.LineBasicMaterial | null)[]>([]);
  const assembled = useRef(0);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelSizes = useRef<{ width: number; height: number }[]>([]);
  const labelLayouts = useRef<LabelLayout[]>([]);
  const labelOrder = useRef<number[]>([]);
  const placedLabels = useRef<number[]>([]);
  const nodes = useRef<THREE.InstancedMesh>(null);
  const { camera, size } = useThree();
  const radius = sphereRadius;
  const positions = useMemo(() => fibonacciSphere(items.length, sphereRadius), [items.length]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const world = useMemo(() => new THREE.Vector3(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const towardCamera = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const links = useMemo(() => constellations(items, positions), [items, positions]);

  useEffect(() => () => links.forEach((link) => link.geometry.dispose()), [links]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    if (!reduced) g.rotation.y += delta * 0.12;
    g.updateWorldMatrix(true, false);
    towardCamera.copy(camera.position).normalize();

    // Assemble once: the first frame after a long pause can carry a huge delta, so clamp it.
    assembled.current = reduced ? 1 : Math.min(1, assembled.current + Math.min(delta, 1 / 20) / assembleTime);
    const assemble = assembled.current;
    const settle = 1 - (1 - assemble) ** 3;
    inner.current?.scale.setScalar(0.72 + 0.28 * settle);
    const time = clock.elapsedTime;
    linkMaterials.current.forEach((material, i) => {
      if (!material) return;
      const category = links[i]?.category;
      const target = activeCategory === null ? 0.22 : category === activeCategory ? 0.7 : 0.04;
      material.opacity = THREE.MathUtils.damp(material.opacity, target * settle, 6, delta);
    });

    if (labelLayouts.current.length !== items.length) {
      labelLayouts.current = Array.from({ length: items.length }, () => ({
        left: 0, right: 0, top: 0, bottom: 0,
        score: 0, targetOpacity: 0, opacity: 0,
        eligible: false, visible: false,
      }));
      labelOrder.current = Array.from({ length: items.length }, (_, i) => i);
    }

    const layouts = labelLayouts.current;
    const labelLimit = size.width < 480 ? 7 : 16;
    const labelGap = size.width < 480 ? 7 : 9;
    const edgeInset = 8;

    // Project each name once. Cached DOM sizes avoid layout reads during animation.
    const mesh = nodes.current;
    for (let i = 0; i < positions.length; i++) {
      world.copy(positions[i]).applyMatrix4(g.matrixWorld);
      const frontness = THREE.MathUtils.clamp(world.dot(towardCamera) / radius, -1, 1);
      const item = items[i];
      const dimmed = activeCategory !== null && item.category !== activeCategory;
      const layout = layouts[i];
      projected.copy(world).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      const width = labelSizes.current[i]?.width ?? item.name.length * 7.5 + 34;
      const height = labelSizes.current[i]?.height ?? 28;
      layout.left = x - width / 2;
      layout.right = x + width / 2;
      layout.top = y - height / 2;
      layout.bottom = y + height / 2;
      layout.score = frontness + (layout.visible ? 0.12 : 0) + (activeCategory === item.category ? 2 : 0);
      layout.visible = false;
      layout.targetOpacity = THREE.MathUtils.smoothstep(frontness, 0.12, 0.7);
      layout.eligible = !dimmed && frontness > 0.2 && projected.z > -1 && projected.z < 1
        && layout.left >= edgeInset && layout.right <= size.width - edgeInset
        && layout.top >= edgeInset && layout.bottom <= size.height - edgeInset;

      if (mesh) {
        tmp.position.copy(positions[i]);
        // Nodes pop in from the north pole down, then highlighted ones breathe.
        const grow = pop(Math.min(1, Math.max(0, assemble * 1.7 - (i / positions.length) * 0.7)));
        const breathe = !reduced && activeCategory === item.category ? 1 + Math.sin(time * 3.2 + i) * 0.14 : 1;
        const s = (0.045 + item.weight * 0.05) * (dimmed ? 0.5 : 1) * grow * breathe;
        tmp.scale.setScalar(s);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        color.set(dimmed || frontness < 0 ? palette.wire : categoryColors[item.category] ?? palette.accent);
        mesh.setColorAt(i, color);
      }
    }

    // Greedy placement keeps the nearest names readable without moving their anchors.
    // A small preference for last frame's names prevents rapid label swapping.
    labelOrder.current.sort((a, b) => layouts[b].score - layouts[a].score || a - b);
    const placed = placedLabels.current;
    placed.length = 0;
    for (const index of labelOrder.current) {
      if (placed.length >= labelLimit) break;
      const candidate = layouts[index];
      if (!candidate.eligible) continue;
      let overlaps = false;
      for (const otherIndex of placed) {
        const other = layouts[otherIndex];
        if (candidate.left < other.right + labelGap && candidate.right > other.left - labelGap
          && candidate.top < other.bottom + labelGap && candidate.bottom > other.top - labelGap) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        candidate.visible = true;
        placed.push(index);
      }
    }

    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];
      // Hide displaced names immediately; fade in replacements without cross-overlap.
      layout.opacity = layout.visible
        ? THREE.MathUtils.damp(layout.opacity, layout.targetOpacity, 14, delta)
        : 0;
      const el = labelRefs.current[i];
      if (el) el.style.opacity = String(layout.opacity * settle * settle);
    }

    if (mesh) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      {/* Structural wireframe */}
      <mesh>
        <sphereGeometry args={[radius * 0.98, 24, 16]} />
        <meshBasicMaterial color={palette.wire} wireframe transparent opacity={0.08} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.12, 0.004, 8, 128]} />
        <meshBasicMaterial color={palette.accent} transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[Math.PI / 2.6, 0.5, 0]}>
        <torusGeometry args={[radius * 1.25, 0.003, 8, 128]} />
        <meshBasicMaterial color={palette.amber} transparent opacity={0.3} />
      </mesh>

      <group ref={inner}>
        {/* Constellations: one arc set per category, brightened while it is previewed. */}
        {links.map((link, i) => (
          <lineSegments key={link.category} geometry={link.geometry}>
            <lineBasicMaterial
              ref={(material: THREE.LineBasicMaterial | null) => {
                linkMaterials.current[i] = material;
              }}
              color={categoryColors[link.category] ?? palette.accent}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </lineSegments>
        ))}

        {/* Nodes */}
        <instancedMesh ref={nodes} args={[undefined, undefined, items.length]}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      </group>

      {/* Labels */}
      {items.map((item, i) => (
        <Html
          key={item.name}
          position={positions[i]}
          center
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            ref={(el) => {
              labelRefs.current[i] = el;
              if (el) {
                labelSizes.current[i] = {
                  width: el.offsetWidth || item.name.length * 7.5 + 34,
                  height: el.offsetHeight || 28,
                };
              }
            }}
            className="whitespace-nowrap rounded-md border border-line bg-bg-elevated/90 px-2.5 py-1 font-mono text-[12px] tracking-[0.02em] text-fg"
            style={{
              opacity: 0,
              transform: "none",
              borderColor:
                activeCategory === item.category ? categoryColors[item.category] : undefined,
              fontWeight: item.weight > 0.85 ? 600 : 400,
            }}
          >
            <span
              aria-hidden
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ background: categoryColors[item.category] ?? palette.accent }}
            />
            {item.name}
          </div>
        </Html>
      ))}
    </group>
  );
}

export default function TechSphere(props: Props) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={props.active ? "always" : "never"}
      camera={{ position: [0, 0, cameraDistance], fov: 64 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <FitCamera />
      <ambientLight intensity={1} />
      <Cloud {...props} />
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        autoRotate={false}
      />
    </Canvas>
  );
}
