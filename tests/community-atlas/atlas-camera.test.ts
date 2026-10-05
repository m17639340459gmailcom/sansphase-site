import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { atlasSourceCrop, projectAtlasPoint, unprojectAtlasPoint } from "../../src/community-atlas/atlas-camera.ts";

test("fixed framing retains the accepted crop and overlay coordinates exactly", () => {
  const samples = [[1440, 900], [1050, 850], [390, 844], [2560, 720]].map(([w, h]) => ({
    crop: atlasSourceCrop(w!, h!, 1672, 941),
    points: [[-100, -50], [w! * .25, h! * .3], [w! / 2, h! / 2], [w! + 100, h! + 50]].map(([x, y]) => ({
      point: projectAtlasPoint(x!, y!, w!, h!),
      inverse: unprojectAtlasPoint(x!, y!, w!, h!),
    })),
  }));
  assert.equal(createHash("sha256").update(JSON.stringify(samples)).digest("hex"),
    "16e44f90547b159664901e193c5487b1b10419b026543bcde5a288a7ee48cb6b");
});

test("the shared view stays centred without exposing empty image edges", () => {
  for (const [width, height] of [[1440, 900], [1050, 850], [390, 844], [2560, 720]]) {
    const crop = atlasSourceCrop(width!, height!, 1672, 941);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1 && crop.y + crop.height <= 1);
    assert.ok(Math.abs(crop.width * 1672 / (crop.height * 941) - width! / height!) < 1e-8);
    assert.ok(Math.abs(crop.x + crop.width / 2 - .5) < 1e-10 && Math.abs(crop.y + crop.height / 2 - .5) < 1e-10);
  }
});

test("image sampling and overlay points share an exact inverse transform at every viewport", () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const scale = Math.max(width! / 1672, height! / 941);
    const sw = width! / scale, sh = height! / scale;
    const crop = atlasSourceCrop(width!, height!, 1672, 941);
    for (const [u, v] of [[.2, .1], [.5, .5], [.82, .75]]) {
      const base = { x: (u! * 1672 - (1672 - sw) / 2) * scale, y: (v! * 941 - (941 - sh) / 2) * scale };
      const point = projectAtlasPoint(base.x, base.y, width!, height!);
      assert.ok(Math.abs(crop.x + point.x / width! * crop.width - u!) < 1e-8);
      assert.ok(Math.abs(crop.y + point.y / height! * crop.height - v!) < 1e-8);
      const inverse = unprojectAtlasPoint(point.x, point.y, width!, height!);
      assert.ok(Math.hypot(inverse.x - base.x, inverse.y - base.y) < 1e-8);
    }
  }
});
