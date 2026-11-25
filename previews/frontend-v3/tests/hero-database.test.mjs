import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatabase,
  DATABASE_PITCH,
  DATABASE_RADIUS,
  DATABASE_SPACING,
  DATABASE_THICKNESS,
  DATABASE_TIERS,
} from "../src/components/three/hero-database.ts";

const TOLERANCE = 0.02;

function localPosition(positions, offset) {
  const cosine = Math.cos(DATABASE_PITCH);
  const sine = Math.sin(DATABASE_PITCH);
  const [x, y, z] = positions.subarray(offset, offset + 3);
  // Undo the baked camera pitch before checking the actual cylinder geometry.
  return [x, y * cosine + z * sine, -y * sine + z * cosine];
}

test("database constants describe three thick, separated cylindrical tiers", () => {
  assert.equal(DATABASE_TIERS, 3);
  for (const value of [DATABASE_PITCH, DATABASE_RADIUS, DATABASE_SPACING, DATABASE_THICKNESS]) {
    assert.ok(Number.isFinite(value), "geometry constants must be finite");
  }
  assert.ok(DATABASE_RADIUS > 0);
  assert.ok(DATABASE_THICKNESS > 0);
  assert.ok(DATABASE_SPACING > DATABASE_THICKNESS, "adjacent tiers must leave a real gap");
  assert.ok(Math.abs(DATABASE_PITCH) > 0 && Math.abs(DATABASE_PITCH) < Math.PI / 2,
    "a pitched view must show both the top and the wall");
});

for (const count of [0, 1, 7, 31, 7200, 11000]) {
  test(`buildDatabase(${count}) returns an exact, deterministic GPU-ready particle budget`, () => {
    const first = buildDatabase(count);
    const second = buildDatabase(count);
    for (const key of ["positions", "styles", "details"]) {
      assert.ok(first[key] instanceof Float32Array, `${key} must be a Float32Array`);
      assert.equal(first[key].length, count * 3, `${key} must match the allocated particle count`);
      assert.deepEqual(first[key], second[key], `${key} must be deterministic`);
      for (const value of first[key]) {
        assert.ok(Number.isFinite(value), `${key} cannot contain NaN or infinity`);
      }
    }

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const [accent, opacity, size] = first.styles.subarray(offset, offset + 3);
      assert.ok(accent >= 0 && accent <= 1, "accent mixing must remain in the valid range");
      assert.ok(opacity > 0, "all allocated particles must be visible");
      assert.ok(size > 0, "all particles must have positive sizes");

      const [tier, angle, kind] = first.details.subarray(offset, offset + 3);
      assert.ok(Number.isInteger(tier) && tier >= 0 && tier < DATABASE_TIERS,
        "each particle must belong to one of the three tiers");
      assert.ok(angle >= 0 && angle <= 1, "the shader angle must be normalized");
      assert.ok(Number.isInteger(kind) && kind >= 0 && kind <= 4,
        "surface metadata must identify a wall, top, rim, bottom edge, or status light");

      const [x, y, z] = localPosition(first.positions, offset);
      const center = (tier - (DATABASE_TIERS - 1) / 2) * DATABASE_SPACING;
      assert.ok(Math.abs(y - center) <= DATABASE_THICKNESS / 2 + TOLERANCE,
        `particle ${index} must stay inside tier ${tier}'s thickness`);
      assert.ok(Math.hypot(x, z) <= DATABASE_RADIUS + TOLERANCE,
        `particle ${index} must stay within the cylindrical radius`);
    }
  });
}

for (const count of [7200, 11000]) {
  test(`${count}-particle quality produces three volumes with uninterrupted gaps between them`, () => {
    const { positions, details } = buildDatabase(count);
    const bounds = Array.from({ length: DATABASE_TIERS }, () => ({
      count: 0,
      minimum: [Infinity, Infinity, Infinity],
      maximum: [-Infinity, -Infinity, -Infinity],
    }));
    const kinds = new Set();
    const uniquePositions = new Set();

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const [tier, , kind] = details.subarray(offset, offset + 3);
      const point = localPosition(positions, offset);
      uniquePositions.add(Array.from(positions.subarray(offset, offset + 3)).join(","));
      const bound = bounds[tier];
      bound.count += 1;
      kinds.add(kind);
      for (let axis = 0; axis < 3; axis += 1) {
        bound.minimum[axis] = Math.min(bound.minimum[axis], point[axis]);
        bound.maximum[axis] = Math.max(bound.maximum[axis], point[axis]);
      }
    }

    for (const [tier, bound] of bounds.entries()) {
      assert.ok(bound.count > 100, `tier ${tier} must retain a meaningful particle budget`);
      assert.ok(bound.maximum[0] - bound.minimum[0] > DATABASE_RADIUS,
        `tier ${tier} must have a visibly wide cylinder silhouette`);
      assert.ok(bound.maximum[1] - bound.minimum[1] > DATABASE_THICKNESS * 0.65,
        `tier ${tier} must retain thickness instead of collapsing into a disk`);
      assert.ok(bound.maximum[2] - bound.minimum[2] > DATABASE_RADIUS * 0.5,
        `tier ${tier} must contain real depth`);
      if (tier > 0) {
        const gap = bound.minimum[1] - bounds[tier - 1].maximum[1];
        assert.ok(gap > 0, "particles must not bridge the empty space between tiers");
        assert.ok(gap >= DATABASE_SPACING - DATABASE_THICKNESS - TOLERANCE * 2,
          "layer spacing must match the geometric constants after the view transform");
      }
    }

    assert.deepEqual(kinds, new Set([0, 1, 2, 3, 4]),
      "normal quality must include surface depth, restrained outlines, and status lights");
    assert.equal(uniquePositions.size, count,
      "occlusion resampling must not fill the particle budget with repeated positions");
  });
}

test("invalid database particle budgets are rejected before geometry allocation", () => {
  for (const count of [-1, -7200, 0.5, 7.25, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildDatabase(count), `invalid particle budget ${count} must fail explicitly`);
  }
});
