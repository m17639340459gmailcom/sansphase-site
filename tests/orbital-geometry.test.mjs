import test from "node:test";
import assert from "node:assert/strict";
import { IcosahedronGeometry } from "three";
import { orbitalGeometry } from "../src/orbital-geometry.mjs";

test("indexed orbital grains retain every triangle, normal and UV with fewer unique vertices", () => {
  const original = new IcosahedronGeometry(1, 1), indexed = orbitalGeometry();
  const expanded = indexed.toNonIndexed();
  try {
    assert.equal(indexed.index.count, original.attributes.position.count);
    assert.ok(indexed.attributes.position.count < original.attributes.position.count / 2);
    for (const name of Object.keys(original.attributes)) {
      const before = original.attributes[name].array, after = expanded.attributes[name].array;
      assert.equal(after.length, before.length);
      for (let i=0;i<before.length;i++) assert.ok(Math.abs(before[i]-after[i])<1e-7, `${name}[${i}] changed`);
    }
  } finally {original.dispose();indexed.dispose();expanded.dispose();}
});
