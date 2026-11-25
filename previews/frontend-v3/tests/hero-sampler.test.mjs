import assert from "node:assert/strict";
import test from "node:test";
import { importParticleModule } from "./hero-import.mjs";

const { defineSampledShape, sampleMask } = await importParticleModule("hero-sampler");
const { getHeroShape, packShapeAtlas, playbackShapeIds, registerHeroShape } = await importParticleModule("hero-shapes");

/** A 40×20 alpha mask: a solid 20×10 bar with a 4-pixel hole, like a tiny glyph. */
function barMask() {
  const width = 40, height = 20;
  const data = new Uint8ClampedArray(width * height);
  for (let y = 5; y < 15; y += 1) {
    for (let x = 10; x < 30; x += 1) data[y * width + x] = 255;
  }
  for (let y = 9; y < 11; y += 1) {
    for (let x = 19; x < 21; x += 1) data[y * width + x] = 0;
  }
  return { width, height, data };
}

/** RGBA mask: left half orange (accent), right half black ink, fully opaque. */
function twoToneMask() {
  const width = 16, height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set(x < 8 ? [201, 71, 32, 255] : [20, 20, 20, 255], i);
    }
  }
  return { width, height, data };
}

/** Map a sampled point back to mask pixels, given the documented fitting. */
function pixelOf(x, y, mask, bounds, unit) {
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  return [Math.floor(x / unit + cx), Math.floor(cy - y / unit)];
}

for (const count of [0, 1, 17, 5000]) {
  test(`sampleMask(${count}) is exact, deterministic and GPU-ready`, () => {
    const first = sampleMask(barMask(), count);
    const second = sampleMask(barMask(), count);
    assert.deepEqual(first, second);
    assert.equal(first.positions.length, count * 3);
    assert.equal(first.styles.length, count * 3);
    assert.equal(first.groups.length, count);
    assert.equal(first.details.length, count * 2);
    for (const values of [first.positions, first.styles]) for (const value of values) assert.ok(Number.isFinite(value));
  });
}

test("samples land only on filled pixels and fit the requested frame", () => {
  const mask = barMask();
  const count = 4000;
  const width = 2.4;
  const { positions } = sampleMask(mask, count, { width, height: 2, depth: 0.2 });
  // The bar spans pixels 10..30 × 5..15, so the width limit (2.4 / 20 px) sets the scale.
  const unit = width / 20;
  let maxX = 0, maxY = 0, maxZ = 0;
  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = positions.subarray(i * 3, i * 3 + 3);
    maxX = Math.max(maxX, Math.abs(x));
    maxY = Math.max(maxY, Math.abs(y));
    maxZ = Math.max(maxZ, Math.abs(z));
    const [px, py] = pixelOf(x, y, mask, { minX: 10, maxX: 30, minY: 5, maxY: 15 }, unit);
    assert.equal(mask.data[py * mask.width + px], 255, `sample ${i} must sit on a filled pixel`);
  }
  assert.ok(maxX <= width / 2 + 1e-6 && maxX > width / 2 - 0.05, "the result spans the requested width");
  assert.ok(maxY <= 0.6 + 1e-6, "the aspect ratio is preserved");
  assert.ok(maxZ <= 0.1 + 1e-6 && maxZ > 0.02, "slight depth, bounded by the depth option");
});

test("outline weighting concentrates particles on edges without starving the fill", () => {
  const mask = barMask();
  const count = 6000;
  const share = (edgeWeight) => {
    const { styles } = sampleMask(mask, count, { edgeWeight });
    let outline = 0;
    for (let i = 0; i < count; i += 1) outline += styles[i * 3 + 1] > 0.9 ? 1 : 0;
    return outline / count;
  };
  const uniform = share(0);
  const weighted = share(3);
  // 20×10 bar with a 2×2 hole: 56 outer + 4 inner outline pixels out of 196 filled.
  assert.ok(Math.abs(uniform - 60 / 196) < 0.03, `uniform outline share ${uniform.toFixed(3)}`);
  assert.ok(weighted > uniform + 0.2, "edge weight raises the outline share");
  assert.ok(weighted < 0.8, "the interior still receives particles");
});

test("alpha and RGBA masks, 0..1 and 0..255 values sample the same silhouette", () => {
  const alpha = barMask();
  const rgba = { width: alpha.width, height: alpha.height, data: new Uint8ClampedArray(alpha.data.length * 4) };
  const float = { width: alpha.width, height: alpha.height, data: new Float32Array(alpha.data.length) };
  alpha.data.forEach((value, i) => { rgba.data[i * 4 + 3] = value; float[i] = 0; float.data[i] = value / 255; });
  const reference = sampleMask(alpha, 900);
  assert.deepEqual(sampleMask(rgba, 900).positions, reference.positions);
  assert.deepEqual(sampleMask(float, 900).positions, reference.positions);
});

test("colour accents follow saturated source pixels only when requested", () => {
  const mask = twoToneMask();
  const plain = sampleMask(mask, 800);
  assert.ok(plain.styles.every((value, index) => index % 3 !== 0 || value === 0), "no accents by default");
  const coloured = sampleMask(mask, 800, { accent: "color" });
  let leftAccent = 0, left = 0, rightAccent = 0, right = 0;
  for (let i = 0; i < 800; i += 1) {
    const isLeft = coloured.positions[i * 3] < 0;
    const accent = coloured.styles[i * 3];
    if (isLeft) { left += 1; leftAccent += accent; } else { right += 1; rightAccent += accent; }
  }
  assert.equal(leftAccent, left, "orange pixels become accent particles");
  assert.equal(rightAccent, 0, "neutral ink stays neutral");
  assert.ok(left > 300 && right > 300);
});

test("invalid masks fail loudly instead of producing an empty hero", () => {
  assert.throws(() => sampleMask({ width: 4, height: 4, data: new Uint8ClampedArray(16) }, 10), /no filled pixels/);
  assert.throws(() => sampleMask({ width: 0, height: 4, data: [] }, 10), RangeError);
  assert.throws(() => sampleMask({ width: 3, height: 3, data: new Uint8ClampedArray(10) }, 10), RangeError);
  assert.throws(() => sampleMask(barMask(), -1), RangeError);
  assert.throws(() => sampleMask(barMask(), 2.5), RangeError);
});

test("a sampled logo registers as a shape and packs into the atlas without joining playback", () => {
  const shape = defineSampledShape({ id: 30, key: "community", mask: barMask(), sample: { width: 3 } });
  registerHeroShape(shape);
  assert.equal(getHeroShape(30).effect, "plain");
  const atlas = packShapeAtlas([2, 30], 500);
  assert.deepEqual(atlas.ids, [2, 30]);
  const build = getHeroShape(30).build(500);
  const offset = atlas.side * atlas.side;
  assert.deepEqual([...atlas.positions.subarray(offset * 4, offset * 4 + 3)], [...build.positions.subarray(0, 3)]);
  assert.ok(!playbackShapeIds().includes(30), "community shapes are opt-in via PLAYBACK_ORDER");
});
