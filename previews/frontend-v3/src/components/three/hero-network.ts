type Vector3 = readonly [number, number, number];
type Layer = {
  id: number;
  x: number;
  height: number;
  depth: number;
  thickness: number;
  accent: number;
  kernel?: boolean;
};
type Sample = { position: Vector3; style: Vector3; link: Vector3 };
type Part = { weight: number; sample: (index: number, count: number) => Sample };

// The wider architecture needs its own framing; the other particle shapes stay unchanged.
export const NETWORK_SCALE = 0.86;
export const NETWORK_SWAY = 0.045;

// An illustrative feature-extraction pipeline, not a claim about a trained model.
// The final two narrow columns represent dense features and the output vector.
const LAYERS: readonly Layer[] = [
  { id: 0, x: -2.12, height: 2.20, depth: 1.48, thickness: 0.10, accent: 0.04 },
  { id: 1, x: -1.35, height: 1.82, depth: 1.22, thickness: 0.20, accent: 0.08, kernel: true },
  { id: 2, x: -0.62, height: 1.42, depth: 1.00, thickness: 0.12, accent: 0.04 },
  { id: 3, x: 0.05, height: 1.10, depth: 0.82, thickness: 0.28, accent: 0.12, kernel: true },
  { id: 4, x: 0.70, height: 0.82, depth: 0.62, thickness: 0.14, accent: 0.04 },
  { id: 5, x: 1.25, height: 0.60, depth: 0.48, thickness: 0.26, accent: 0.12, kernel: true },
  { id: 6, x: 1.82, height: 1.18, depth: 0.18, thickness: 0.10, accent: 0.80 },
  { id: 7, x: 2.25, height: 1.60, depth: 0.12, thickness: 0.08, accent: 0.18 },
];

/** Bake an oblique view into real 3D geometry, including when motion is reduced. */
function viewingAngle([x, y, z]: Vector3): Vector3 {
  const yaw = -0.62;
  const pitch = 0.24;
  const turnedX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const turnedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [turnedX, y * Math.cos(pitch) - turnedZ * Math.sin(pitch),
    y * Math.sin(pitch) + turnedZ * Math.cos(pitch)];
}

function corners(layer: Layer): Vector3[] {
  return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) =>
    [layer.x + x * layer.thickness / 2, y * layer.height / 2, z * layer.depth / 2] as Vector3)));
}

/** The scene projects the same eight corners for layer-shaped hover targets. */
export function getNetworkLayers(): { id: number; center: Vector3; corners: Vector3[] }[] {
  return LAYERS.map((layer) => ({
    id: layer.id,
    center: viewingAngle([layer.x, 0, 0]),
    corners: corners(layer).map(viewingAngle),
  }));
}

function segment(start: Vector3, end: Vector3, style: Vector3, from: number, to = from): Part {
  return {
    weight: Math.hypot(...start.map((value, axis) => end[axis] - value)),
    sample(index, count) {
      const t = (index + 0.5) / count;
      return {
        position: viewingAngle(start.map((value, axis) => value + (end[axis] - value) * t) as unknown as Vector3),
        style,
        link: [from, to, from === to ? -1 : t],
      };
    },
  };
}

function face(layer: Layer, axis: 0 | 1 | 2, style: Vector3): Part {
  const size = [layer.thickness, layer.height, layer.depth];
  const axes = [0, 1, 2].filter((value) => value !== axis);
  const [u, v] = axes;
  return {
    weight: size[u] * size[v],
    sample(index, count) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(count * size[u] / size[v])));
      const rows = Math.ceil(count / cols);
      const cell = Math.floor((index + 0.5) * cols * rows / count);
      const position = [0, 0, 0];
      position[axis] = size[axis] / 2;
      position[u] = ((cell % cols + 0.5) / cols - 0.5) * size[u];
      position[v] = ((Math.floor(cell / cols) + 0.5) / rows - 0.5) * size[v];
      position[0] += layer.x;
      return { position: viewingAngle(position as unknown as Vector3), style, link: [layer.id, layer.id, -1] };
    },
  };
}

function distribute(parts: Part[], count: number, samples: Sample[]) {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  let used = 0;
  let weight = 0;
  parts.forEach((part, index) => {
    weight += part.weight;
    const end = index === parts.length - 1 ? count : Math.round(weight / total * count);
    const budget = end - used;
    for (let i = 0; i < budget; i++) samples.push(part.sample(i, budget));
    used = end;
  });
}

/** Particle-only cuboids, feature windows and sparse adjacent-layer signal paths. */
export function buildNetwork(count: number): {
  positions: Float32Array; styles: Float32Array; links: Float32Array;
} {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Particle count must be a non-negative safe integer.");
  }
  const surfaces: Part[] = [];
  const rims: Part[] = [];
  const details: Part[] = [];
  const connections: Part[] = [];

  LAYERS.forEach((layer, layerIndex) => {
    // Only the three camera-facing surfaces get a point grid. Back faces would
    // superimpose a second grid and make thin feature maps look muddy.
    surfaces.push(face(layer, 0, [layer.accent, 0.52, 0.78]));
    surfaces.push(face(layer, 1, [layer.accent * 0.6, 0.38, 0.72]));
    surfaces.push(face(layer, 2, [layer.accent * 0.7, 0.30, 0.74]));

    const vertices = corners(layer);
    for (let a = 0; a < vertices.length; a++) {
      for (let axis = 0; axis < 3; axis++) {
        const b = a ^ (1 << (2 - axis));
        if (a >= b) continue;
        const back = vertices[a][0] < layer.x && vertices[b][0] < layer.x;
        rims.push(segment(vertices[a], vertices[b],
          [layer.accent, back ? 0.40 : 0.94, back ? 0.65 : 0.84], layer.id));
      }
    }

    // A small receptive-field window makes the feature planes more specific
    // than a generic row of boxes; its outline is also entirely sampled points.
    if (layer.kernel) {
      const x = layer.x + layer.thickness / 2 + 0.004;
      const h = layer.height * 0.30;
      const d = layer.depth * 0.34;
      const cy = layer.height * 0.12;
      const cz = layer.depth * 0.08;
      const window: Vector3[] = [[x, cy - h / 2, cz - d / 2], [x, cy + h / 2, cz - d / 2],
        [x, cy + h / 2, cz + d / 2], [x, cy - h / 2, cz + d / 2]];
      for (let side = 0; side < 4; side++) {
        details.push(segment(window[side], window[(side + 1) % 4], [0.96, 1.0, 0.90], layer.id));
      }
    }

    if (layer.id >= 6) {
      // Dot clusters read as a compact feature/output vector, not another map.
      const dots = layer.id === 6 ? 7 : 5;
      for (let dot = 0; dot < dots; dot++) {
        const y = (dot / (dots - 1) - 0.5) * layer.height * 0.84;
        details.push({
          weight: 0.35,
          sample(index, budget) {
            const radius = Math.sqrt((index + 0.5) / budget) * 0.037;
            const angle = index * Math.PI * (3 - Math.sqrt(5));
            const center = viewingAngle([layer.x + layer.thickness / 2, y, 0]);
            return {
              position: [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius, center[2] + 0.01],
              style: [layer.id === 6 ? 0.95 : 0.30, 1.30, 1.12],
              link: [layer.id, layer.id, -1],
            };
          },
        });
      }
    }

    const next = LAYERS[layerIndex + 1];
    if (!next) return;
    // Four corner paths and one axial path keep the feed-forward flow legible.
    const anchors = [[-0.36, -0.36], [-0.36, 0.36], [0.36, -0.36], [0.36, 0.36], [0, 0]];
    for (const [y, z] of anchors) {
      connections.push(segment(
        [layer.x + layer.thickness / 2, y * layer.height, z * layer.depth],
        [next.x - next.thickness / 2, y * next.height, z * next.depth],
        [0.08, 0.33, 0.64], layer.id, next.id,
      ));
    }
  });

  const samples: Sample[] = [];
  const surfaceCount = Math.floor(count * 0.62);
  const rimCount = Math.floor(count * 0.22);
  const detailCount = Math.floor(count * 0.06);
  distribute(surfaces, surfaceCount, samples);
  distribute(rims, rimCount, samples);
  distribute(details, detailCount, samples);
  distribute(connections, count - surfaceCount - rimCount - detailCount, samples);

  // Keep model position, appearance and layer identity together during morphs.
  samples.sort((a, b) => a.position[0] - b.position[0]
    || a.position[1] - b.position[1] || a.position[2] - b.position[2]);
  const positions = new Float32Array(count * 3);
  const styles = new Float32Array(count * 3);
  const links = new Float32Array(count * 3);
  samples.forEach((sample, index) => {
    positions.set(sample.position, index * 3);
    styles.set(sample.style, index * 3);
    links.set(sample.link, index * 3);
  });
  return { positions, styles, links };
}
