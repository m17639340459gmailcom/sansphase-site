import assert from "node:assert/strict";
import test from "node:test";
import { CONSTELLATION_CATALOG } from "../../src/community-atlas/constellation-catalog.ts";

test("the catalog contains six distinct, named constellation groups in layout order", () => {
  assert.deepEqual(
    CONSTELLATION_CATALOG.map((group) => group.id),
    ["Ori", "Cas", "Cyg", "UMa", "Lyr", "Sco"],
  );
  assert.equal(new Set(CONSTELLATION_CATALOG.map((group) => group.id)).size, 6);
  for (const group of CONSTELLATION_CATALOG) {
    assert.ok(group.name.length > 0 && group.englishName.length > 0);
    assert.ok(group.stars.length >= 5);
  }
});

test("catalog stars have unique Hipparcos identities and finite J2000 coordinates in degrees", () => {
  for (const group of CONSTELLATION_CATALOG) {
    const stars = [...group.stars, ...group.fieldStars];
    assert.equal(
      new Set(stars.map((star) => star.id)).size,
      stars.length,
      group.id,
    );
    for (const star of stars) {
      assert.match(star.id, /^HIP \d+$/);
      assert.ok(
        [star.ra, star.dec, star.magnitude].every(Number.isFinite),
        star.id,
      );
      assert.ok(star.ra >= 0 && star.ra < 360, `${star.id}: RA degrees`);
      assert.ok(
        star.dec >= -90 && star.dec <= 90,
        `${star.id}: declination degrees`,
      );
      assert.ok(star.magnitude >= -2 && star.magnitude <= 6.5, star.id);
      if (star.colorIndex !== undefined)
        assert.ok(Number.isFinite(star.colorIndex), star.id);
    }
  }
});

test("all edges address existing stars and contain no self-loops or repeated undirected pairs", () => {
  for (const group of CONSTELLATION_CATALOG) {
    const seen = new Set<string>();
    for (const [a, b] of group.edges) {
      assert.ok(Number.isInteger(a) && Number.isInteger(b), group.id);
      assert.ok(
        a >= 0 && b >= 0 && a < group.stars.length && b < group.stars.length,
        group.id,
      );
      assert.notEqual(a, b, group.id);
      const key = [a, b].sort((x, y) => x - y).join(":");
      assert.ok(!seen.has(key), `${group.id}: duplicate ${key}`);
      seen.add(key);
    }
  }
});

test("every outline is a connected graph without orphan stars", () => {
  for (const group of CONSTELLATION_CATALOG) {
    const visited = new Set<number>([0]);
    const pending = [0];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const [a, b] of group.edges) {
        const neighbor = a === current ? b : b === current ? a : undefined;
        if (neighbor !== undefined && !visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }
    assert.equal(visited.size, group.stars.length, group.id);
  }
});

test("field stars remain a small, local selection of fainter catalog entries", () => {
  const allFieldStars = CONSTELLATION_CATALOG.flatMap(
    (group) => group.fieldStars,
  );
  assert.ok(allFieldStars.length <= 200);
  for (const group of CONSTELLATION_CATALOG) {
    assert.ok(
      group.fieldStars.length >= 20 && group.fieldStars.length <= 45,
      group.id,
    );
    const centreRa =
      group.stars.reduce((sum, star) => sum + star.ra, 0) / group.stars.length;
    const centreDec =
      group.stars.reduce((sum, star) => sum + star.dec, 0) / group.stars.length;
    const cosDec = Math.cos((centreDec * Math.PI) / 180);
    const outlineRadius = Math.max(
      ...group.stars.map((star) =>
        Math.hypot((star.ra - centreRa) * cosDec, star.dec - centreDec),
      ),
    );
    for (const star of group.fieldStars) {
      assert.ok(star.magnitude >= 4 && star.magnitude <= 6.5, star.id);
      const deltaRa = ((star.ra - centreRa + 540) % 360) - 180;
      assert.ok(
        Math.hypot(deltaRa * cosDec, star.dec - centreDec) <=
          outlineRadius + 12,
        `${group.id}: ${star.id} is too distant`,
      );
    }
  }
});

test("well-known source anchors preserve catalog coordinates and magnitude", () => {
  const stars = CONSTELLATION_CATALOG.flatMap((group) => group.stars);
  const anchors = [
    { id: "HIP 27989", ra: 88.7929, dec: 7.4071, magnitude: 0.45 },
    { id: "HIP 91262", ra: 279.2347, dec: 38.7837, magnitude: 0.03 },
    { id: "HIP 80763", ra: 247.3519, dec: -26.432, magnitude: 1.06 },
  ];
  for (const anchor of anchors) {
    const actual = stars.find((star) => star.id === anchor.id);
    assert.ok(actual, anchor.id);
    assert.equal(actual.ra, anchor.ra);
    assert.equal(actual.dec, anchor.dec);
    assert.equal(actual.magnitude, anchor.magnitude);
  }
});
