import assert from "node:assert/strict";
import test from "node:test";
import { importParticleModule } from "./hero-import.mjs";

const shapes = await importParticleModule("hero-shapes");
const math = await importParticleModule("hero-math");
const { buildDatabase } = await importParticleModule("hero-database");
const { buildNetwork } = await importParticleModule("hero-network");
const { PLAYBACK_ORDER, REDUCED_PHASE } = await importParticleModule("hero-cycle");

const {
  HERO_SHAPES, SHAPE_EFFECT_IDS, STILL_MOTION, atlasSide, getHeroShape, listHeroShapes,
  motionElements, packShapeAtlas, packShapeAtlasAsync, playbackShapeIds, registerHeroShape,
} = shapes;

/** Frame bounds with generous margin: the hero never shows anything beyond ±3 × ±2.5. */
const LIMITS = [3, 2.5, 3];

/** Sorted "position|style" records: equal lists mean the same particles with the same looks. */
function records(positions, styles) {
  const result = [];
  for (let i = 0; i < positions.length / 3; i += 1) {
    result.push(`${positions.subarray(i * 3, i * 3 + 3).join(",")}|${styles.subarray(i * 3, i * 3 + 3).join(",")}`);
  }
  return result.sort();
}

test("the registry keeps shader IDs, message keys and the owner's playback set", () => {
  assert.deepEqual(HERO_SHAPES.map((shape) => [shape.id, shape.key]), [
    [0, "monogram"], [1, "database"], [2, "network"], [3, "lattice"],
  ]);
  assert.deepEqual(listHeroShapes().map((shape) => shape.id), [0, 1, 2, 3]);
  assert.equal(getHeroShape(1).effect, "database");
  assert.equal(getHeroShape(2).effect, "network");
  assert.equal(getHeroShape(3).effect, "plain");
  assert.deepEqual(SHAPE_EFFECT_IDS, { plain: 0, database: 1, network: 2 });
  assert.deepEqual(playbackShapeIds(), [2, 1, 3]);
  assert.ok(!playbackShapeIds().includes(0), "the reserved monogram is never uploaded or played");
  for (const id of [...PLAYBACK_ORDER, REDUCED_PHASE]) assert.ok(playbackShapeIds().includes(id));
  assert.throws(() => getHeroShape(99), /Unknown particle shape/);
});

test("registering shapes validates IDs, keys and uniqueness", () => {
  const build = (count) => ({ positions: new Float32Array(count * 3), styles: new Float32Array(count * 3).fill(1) });
  assert.throws(() => registerHeroShape({ id: 1, key: "dupe", effect: "plain", motion: STILL_MOTION, build }), /already registered/);
  assert.throws(() => registerHeroShape({ id: -1, key: "negative", effect: "plain", motion: STILL_MOTION, build }), RangeError);
  assert.throws(() => registerHeroShape({ id: 1.5, key: "fraction", effect: "plain", motion: STILL_MOTION, build }), RangeError);
  assert.throws(() => registerHeroShape({ id: 40, key: "", effect: "plain", motion: STILL_MOTION, build }), /message key/);
  registerHeroShape({ id: 40, key: "test", effect: "plain", motion: STILL_MOTION, build });
  assert.equal(getHeroShape(40).key, "test");
  assert.ok(!playbackShapeIds().includes(40), "registering does not add a shape to playback");
});

for (const count of [0, 1, 7, 31, 1000, 14400]) {
  test(`every registered shape builds ${count} deterministic, bounded, GPU-ready particles`, () => {
    for (const shape of HERO_SHAPES) {
      const first = shape.build(count);
      const second = shape.build(count);
      assert.equal(first.positions.length, count * 3, `${shape.key} positions`);
      assert.equal(first.styles.length, count * 3, `${shape.key} styles`);
      if (first.groups) assert.equal(first.groups.length, count, `${shape.key} groups`);
      if (first.details) assert.equal(first.details.length, count * 2, `${shape.key} details`);
      for (const key of ["positions", "styles", "groups", "details"]) {
        if (!first[key]) continue;
        assert.deepEqual(first[key], second[key], `${shape.key} ${key} must be deterministic`);
        for (const value of first[key]) assert.ok(Number.isFinite(value), `${shape.key} ${key} must be finite`);
      }
      for (let i = 0; i < count; i += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          assert.ok(Math.abs(first.positions[i * 3 + axis] * shape.motion.scale) < LIMITS[axis], `${shape.key} fits the frame`);
        }
        const [accent, opacity, size] = first.styles.subarray(i * 3, i * 3 + 3);
        assert.ok(accent >= 0 && accent <= 1 && opacity > 0 && size > 0, `${shape.key} style ${i}`);
      }
    }
  });
}

test("registry builds reorder the historic database and network data without losing a particle", () => {
  const count = 11000;
  const database = buildDatabase(count);
  const registryDatabase = getHeroShape(1).build(count);
  const tiers = new Float32Array(count);
  const databaseDetails = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    tiers[i] = database.details[i * 3];
    databaseDetails.set([database.details[i * 3 + 1], database.details[i * 3 + 2]], i * 2);
  }
  assert.deepEqual(
    records(registryDatabase.positions, registryDatabase.styles),
    records(database.positions, database.styles),
    "database positions and their styles stay paired",
  );
  const pair = (positions, groups, details) => Array.from({ length: count }, (_, i) =>
    `${positions.subarray(i * 3, i * 3 + 3).join(",")}|${groups[i]}|${details.subarray(i * 2, i * 2 + 2).join(",")}`).sort();
  assert.deepEqual(pair(registryDatabase.positions, registryDatabase.groups, registryDatabase.details),
    pair(database.positions, tiers, databaseDetails), "tier, azimuth and surface kind stay paired");

  const network = buildNetwork(count);
  const registryNetwork = getHeroShape(2).build(count);
  const sources = new Float32Array(count);
  const links = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    sources[i] = network.links[i * 3];
    links.set([network.links[i * 3 + 1], network.links[i * 3 + 2]], i * 2);
  }
  assert.deepEqual(records(registryNetwork.positions, registryNetwork.styles), records(network.positions, network.styles),
    "network positions and their styles stay paired");
  assert.deepEqual(pair(registryNetwork.positions, registryNetwork.groups, registryNetwork.details),
    pair(network.positions, sources, links), "layer identity and edge progress stay paired");
});

test("locality ordering keeps consecutive particles close so morph streams stay coherent", () => {
  for (const id of [1, 2, 3]) {
    const { positions } = getHeroShape(id).build(20000);
    let step = 0;
    for (let i = 1; i < 20000; i += 1) {
      step += Math.hypot(positions[i * 3] - positions[i * 3 - 3], positions[i * 3 + 1] - positions[i * 3 - 2]);
    }
    const mean = step / 19999;
    // Random order would average ~1.5 units between neighbours; a space-filling curve stays tiny.
    assert.ok(mean < 0.08, `shape ${id} mean screen-space step ${mean.toFixed(3)} is local`);
  }
});

test("Hilbert keys are unique per grid cell and step between 4-neighbour cells", () => {
  const X = 2.15, Y = 1.7, GRID = 1024;
  const center = (index, limit) => ((index + 0.5) / (GRID - 1)) * limit * 2 - limit;
  const cells = new Map();
  for (let iy = 0; iy < GRID; iy += 7) {
    for (let ix = 0; ix < GRID; ix += 7) {
      const key = math.spatialOrder(center(ix, X), center(iy, Y));
      assert.ok(Number.isInteger(key) && key >= 0 && key < GRID * GRID);
      assert.ok(!cells.has(key), "one key per cell");
      cells.set(key, [ix, iy]);
    }
  }
  // Walk a dense block and verify the curve only moves between adjacent cells.
  const block = new Map();
  for (let iy = 0; iy < 64; iy += 1) {
    for (let ix = 0; ix < 64; ix += 1) block.set(math.spatialOrder(center(ix, X), center(iy, Y)), [ix, iy]);
  }
  const keys = [...block.keys()].sort((a, b) => a - b);
  assert.equal(keys.length, 64 * 64);
  assert.equal(keys.at(-1) - keys[0], 64 * 64 - 1, "an aligned 64×64 block is one contiguous curve segment");
  for (let i = 1; i < keys.length; i += 1) {
    const [ax, ay] = block.get(keys[i - 1]);
    const [bx, by] = block.get(keys[i]);
    assert.equal(Math.abs(ax - bx) + Math.abs(ay - by), 1);
  }
});

test("localityOrder is a permutation and reorder moves whole records", () => {
  const positions = new Float32Array([1, 1, 0, -1, -1, 0, 0.5, -0.5, 0, -2, 1.5, 0]);
  const order = math.localityOrder(positions);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
  const reordered = math.reorder(positions, 3, order);
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual([...reordered.subarray(i * 3, i * 3 + 3)], [...positions.subarray(order[i] * 3, order[i] * 3 + 3)]);
  }
  assert.throws(() => math.localityOrder(new Float32Array((math.MAX_ORDERED_PARTICLES + 1) * 3)), RangeError);
});

test("the lattice keeps its ~4% accent sprinkle and the monogram keeps an accented T", () => {
  const count = 14400;
  const lattice = getHeroShape(3).build(count);
  let accents = 0;
  for (let i = 0; i < count; i += 1) accents += lattice.styles[i * 3];
  assert.ok(Math.abs(accents / count - 0.04) < 0.01, `accent share ${(accents / count).toFixed(3)}`);

  const monogram = getHeroShape(0).build(count);
  for (let i = 0; i < count; i += 1) {
    assert.equal(monogram.styles[i * 3], monogram.positions[i * 3] < -0.8 ? 1 : 0);
  }
});

test("motion blocks follow the documented column-major mat4 layout", () => {
  // Stored as float32, exactly as the GPU receives them.
  const f32 = Math.fround;
  const network = motionElements(getHeroShape(2).motion);
  assert.equal(network.length, 16);
  assert.equal(network[0], f32(getHeroShape(2).motion.scale));
  assert.equal(network[1], f32(getHeroShape(2).motion.sway.amplitude));
  assert.equal(network[2], f32(getHeroShape(2).motion.sway.speed));
  const database = motionElements(getHeroShape(1).motion);
  assert.equal(database[6], f32(0.055));
  assert.equal(database[7], f32(0.035));
  assert.equal(database[8], f32(1.15));
  assert.equal(database[9], 1, "breathing is centred on the middle tier");
  assert.ok(Math.abs(Math.hypot(database[12], database[13], database[14]) - 1) < 1e-6, "unit breathing axis");
  const lattice = motionElements(getHeroShape(3).motion);
  assert.deepEqual([...lattice.subarray(3, 6)].map((value) => Math.round(value * 1000) / 1000), [0.06, 0.9, 0.12]);
});

for (const count of [1, 1000, 14400]) {
  test(`packShapeAtlas(${count}) lays every shape out in its own side² block`, () => {
    const ids = playbackShapeIds();
    const atlas = packShapeAtlas(ids, count);
    const side = atlasSide(count);
    assert.equal(atlas.side, side);
    assert.ok(side * side >= count && (side - 1) * (side - 1) < count);
    assert.deepEqual(atlas.ids, ids);
    assert.equal(atlas.positions.length, side * side * ids.length * 4);
    assert.equal(atlas.styles.length, side * side * ids.length * 4);
    assert.equal(atlas.details.length, side * side * ids.length * 2);
    ids.forEach((id, slot) => {
      const build = getHeroShape(id).build(count);
      const offset = slot * side * side;
      for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 257))) {
        const texel = offset + i;
        assert.deepEqual([...atlas.positions.subarray(texel * 4, texel * 4 + 3)], [...build.positions.subarray(i * 3, i * 3 + 3)]);
        assert.equal(atlas.positions[texel * 4 + 3], build.groups ? build.groups[i] : 0);
        assert.deepEqual([...atlas.styles.subarray(texel * 4, texel * 4 + 3)], [...build.styles.subarray(i * 3, i * 3 + 3)]);
        assert.equal(atlas.styles[texel * 4 + 3], build.details ? build.details[i * 2] : 0);
        assert.equal(atlas.details[texel * 2], build.details ? build.details[i * 2 + 1] : 0);
      }
      // Padding texels beyond the particle count stay zero.
      for (let texel = offset + count; texel < offset + side * side; texel += 1) {
        assert.equal(atlas.positions[texel * 4 + 3], 0);
        assert.equal(atlas.styles[texel * 4 + 1], 0);
      }
    });
  });
}

test("the async atlas matches the synchronous one and rejects invalid input", async () => {
  let pauses = 0;
  const pause = () => { pauses += 1; return Promise.resolve(); };
  const asyncAtlas = await packShapeAtlasAsync([2, 1, 3], 2048, pause);
  assert.equal(pauses, 3, "one task per shape keeps page load responsive");
  assert.deepEqual(asyncAtlas, packShapeAtlas([2, 1, 3], 2048));
  assert.throws(() => packShapeAtlas([], 10), /at least one shape/);
  assert.throws(() => packShapeAtlas([2, 2], 10), /unique/);
  assert.throws(() => packShapeAtlas([2], -1), RangeError);
  assert.throws(() => packShapeAtlas([2], 1.5), RangeError);
  await assert.rejects(packShapeAtlasAsync([7777], 10, pause), /Unknown particle shape/);
  registerHeroShape({ id: 41, key: "broken", effect: "plain", motion: STILL_MOTION, build: () => ({ positions: new Float32Array(3), styles: new Float32Array(3) }) });
  assert.throws(() => packShapeAtlas([41], 5), /wrong length/);
});
