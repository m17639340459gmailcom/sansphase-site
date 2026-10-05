import assert from "node:assert/strict";
import test from "node:test";
import { catalogStarTint, STELLAR_PALETTE } from "../../src/community-atlas/stellar-palette.ts";

test("the sky uses a restrained silver-blue family with only near-white warm stars", () => {
  for (const color of Object.values(STELLAR_PALETTE)) {
    const channels = color.split(",").map(Number);
    assert.equal(channels.length, 3);
    assert.ok(channels.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255));
  }
  for (const key of ["line", "lineHalo", "active", "coolStar", "neutralStar"] as const) {
    const [r, g, b] = STELLAR_PALETTE[key].split(",").map(Number);
    assert.ok(r! <= g! && g! <= b!, `${key} should stay in the silver-blue family`);
  }
  const warm = STELLAR_PALETTE.warmStar.split(",").map(Number);
  assert.ok(Math.max(...warm) - Math.min(...warm) < 20, "warm stars must not become yellow decorative nodes");
});

test("catalog stars retain broad B-V color classes without inventing a new temperature or position", () => {
  assert.equal(catalogStarTint(-.2), STELLAR_PALETTE.coolStar);
  assert.equal(catalogStarTint(.049), STELLAR_PALETTE.coolStar);
  assert.equal(catalogStarTint(.05), STELLAR_PALETTE.neutralStar);
  assert.equal(catalogStarTint(.55), STELLAR_PALETTE.neutralStar);
  assert.equal(catalogStarTint(.551), STELLAR_PALETTE.warmStar);
  assert.equal(catalogStarTint(1.8), STELLAR_PALETTE.warmStar);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(catalogStarTint(value), STELLAR_PALETTE.neutralStar);
});
