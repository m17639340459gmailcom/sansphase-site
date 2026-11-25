import assert from "node:assert/strict";
import test from "node:test";
import { buildNetwork, getNetworkLayers } from "../src/components/three/hero-network.ts";

const LIMITS = [3, 2, 3];

function finiteVector(vector, label) {
  assert.equal(vector.length, 3, `${label} must have three coordinates`);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Number.isFinite(vector[axis]), `${label}[${axis}] must be finite`);
    assert.ok(Math.abs(vector[axis]) < LIMITS[axis], `${label} must fit inside the hero`);
  }
}

function bounds(points) {
  return [0, 1, 2].map((axis) => {
    const values = points.map((point) => point[axis]);
    return [Math.min(...values), Math.max(...values)];
  });
}

function determinant(a, b, c) {
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function largestVolume(points) {
  const vectors = points.slice(1).map((point) => point.map((value, axis) => value - points[0][axis]));
  let volume = 0;
  for (let a = 0; a < vectors.length; a += 1) {
    for (let b = a + 1; b < vectors.length; b += 1) {
      for (let c = b + 1; c < vectors.length; c += 1) {
        volume = Math.max(volume, Math.abs(determinant(vectors[a], vectors[b], vectors[c])));
      }
    }
  }
  return volume;
}

test("network layers have consecutive identities, ordered centers, and real cuboid depth", () => {
  const layers = getNetworkLayers();
  assert.ok(layers.length >= 6, "the architecture must contain multiple feature-processing stages");
  assert.deepEqual(layers.map((layer) => layer.id), layers.map((_, index) => index));
  assert.deepEqual(getNetworkLayers(), layers, "layer metadata must be deterministic");

  for (const [index, layer] of layers.entries()) {
    finiteVector(layer.center, `layer ${index} center`);
    if (index > 0) assert.ok(layer.center[0] > layers[index - 1].center[0]);
    assert.equal(layer.corners.length, 8, "each layer must expose eight baked-view cuboid corners");
    for (const corner of layer.corners) finiteVector(corner, `layer ${index} corner`);
    assert.ok(largestVolume(layer.corners) > 1e-6, "a layer must not collapse into a flat plane");
    for (let axis = 0; axis < 3; axis += 1) {
      const midpoint = layer.corners.reduce((sum, corner) => sum + corner[axis], 0) / 8;
      assert.ok(Math.abs(midpoint - layer.center[axis]) < 1e-6, "corners and center must share the same view transform");
    }
  }

  for (const [minimum, maximum] of bounds(layers.flatMap((layer) => layer.corners))) {
    assert.ok(Math.abs((minimum + maximum) / 2) < 0.5, "the full architecture must remain reasonably centered");
  }
});

for (const count of [0, 1, 2, 7, 31, 127, 7200, 11000]) {
  test(`buildNetwork(${count}) uses its exact particle budget with finite, deterministic attributes`, () => {
    const first = buildNetwork(count);
    const second = buildNetwork(count);
    const layerCount = getNetworkLayers().length;
    for (const key of ["positions", "styles", "links"]) {
      assert.ok(first[key] instanceof Float32Array, `${key} must be a GPU-ready Float32Array`);
      assert.equal(first[key].length, count * 3, `${key} must match the exact particle budget`);
      assert.deepEqual(first[key], second[key], `${key} must not change between builds`);
      for (const value of first[key]) assert.ok(Number.isFinite(value), `${key} cannot contain NaN or infinity`);
    }

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      finiteVector(first.positions.subarray(offset, offset + 3), `particle ${index}`);
      const [accent, opacity, size] = first.styles.subarray(offset, offset + 3);
      assert.ok(accent >= 0 && accent <= 1, "accent mixing must stay in its valid range");
      assert.ok(opacity > 0, "every allocated particle must be visible");
      assert.ok(size > 0, "every particle must have a positive point size");
      const [source, target, progress] = first.links.subarray(offset, offset + 3);
      assert.ok(Number.isInteger(source) && source >= 0 && source < layerCount);
      assert.ok(Number.isInteger(target) && target >= 0 && target < layerCount);
      if (progress === -1) {
        assert.equal(source, target, "layer particles must belong to one layer");
      } else {
        assert.equal(target, source + 1, "connections must join adjacent processing stages");
        assert.ok(progress >= 0 && progress <= 1, "connection progress must stay within its segment");
      }
    }
  });
}

for (const count of [7200, 11000]) {
  test(`${count}-particle quality contains every volumetric layer and every adjacent connection`, () => {
    const { positions, links } = buildNetwork(count);
    const layers = getNetworkLayers();
    const layerPoints = layers.map(() => []);
    const connections = new Set();
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const [source, target, progress] = links.subarray(offset, offset + 3);
      if (progress === -1) {
        layerPoints[source].push(Array.from(positions.subarray(offset, offset + 3)));
      } else {
        connections.add(`${source}:${target}`);
      }
    }

    for (const [index, points] of layerPoints.entries()) {
      assert.ok(points.length >= 8, `layer ${index} must have enough samples to express a volume`);
      for (const [minimum, maximum] of bounds(points)) {
        assert.ok(maximum - minimum > 0.005, `layer ${index} must occupy all three baked-view axes`);
      }
      // Extremal points capture the outer shell without a cubic scan over all particles.
      const extrema = [points[0]];
      for (let axis = 0; axis < 3; axis += 1) {
        extrema.push(points.reduce((best, point) => point[axis] < best[axis] ? point : best));
        extrema.push(points.reduce((best, point) => point[axis] > best[axis] ? point : best));
      }
      assert.ok(largestVolume(extrema) > 1e-7, `layer ${index} particles must not be coplanar`);
    }

    assert.deepEqual(connections, new Set(layers.slice(1).map((layer) => `${layer.id - 1}:${layer.id}`)));
  });
}

test("invalid particle budgets are rejected before allocating geometry", () => {
  for (const count of [-1, -7200, 0.5, 7.25, NaN, Infinity, -Infinity]) {
    assert.throws(() => buildNetwork(count), `invalid particle budget ${count} must fail explicitly`);
  }
});
