import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Color, Curve } from "three";
import {
  ReferenceTubes,
  TubeInput,
} from "../src/vendor/active-theory-tubes/adapter.mjs";
test("reference input emits separate chains and cannot bridge an old location", () => {
  const input = new TubeInput(),
    releases = [],
    emit = (...args) => releases.push(args);
  input.move(new Vector3(), emit);
  input.move(new Vector3(0.2, 0, 0), emit);
  assert.equal(releases.length, 0);
  input.move(new Vector3(0.8, 0.2, 0), emit);
  assert.equal(releases.length, 1);
  assert.ok(Math.abs(releases[0][1].length() - 0.4) < 1e-8);
  for (let i = 0; i < 90; i++) input.move(new Vector3(0.8, 0.2, 0), emit);
  assert.equal(releases.length, 1, "stationary input does not keep emitting");
  input.reset();
  input.move(new Vector3(-18, 6, 0), emit);
  assert.equal(
    releases.length,
    1,
    "reentry does not draw from an old location",
  );
});
test("reference topology, bounded emission buffers and disposal", () => {
  const tubes = new ReferenceTubes(null);
  assert.equal(tubes.capacity, Math.floor(16384 / 12));
  assert.equal(
    tubes.geometry.instanceCount,
    0,
    "unemitted chains do not consume vertex work",
  );
  assert.ok(
    tubes.geometry.getAttribute("cIndex").array.every((i) => i >= 0 && i <= 10),
  );
  assert.equal(tubes.material.uniforms.thickness.value, 2);
  assert.equal(tubes.material.depthWrite, false);
  tubes.release(
    new Vector3(2, 3, 0),
    new Vector3(0.4, 0, 0),
    new Color("#8198de"),
    0,
  );
  const spawn = tubes.emission.image.data;
  assert.equal(tubes.geometry.instanceCount, 1);
  assert.deepEqual([...spawn.slice(0, 4)], [1, 2, 3, 0]);
  for (let i = 1; i < 12; i++) {
    assert.equal(spawn[i * 4], 1);
    assert.ok(spawn[i * 4 + 1] < spawn[(i - 1) * 4 + 1]);
    assert.equal(spawn[i * 4 + 2], 3);
    assert.equal(spawn[i * 4 + 3], 0);
  }
  for (let i = 0; i < 1600; i++)
    tubes.release(new Vector3(), new Vector3(), new Color("#fff"), 0);
  assert.ok(tubes.next < tubes.capacity);
  tubes.reset();
  assert.ok(spawn.every((v) => v === 0));
  assert.equal(tubes.next, 0);
  let disposals = 0;
  for (const resource of [
    tubes.geometry,
    tubes.material,
    ...tubes.ownedTextures,
  ])
    resource.addEventListener("dispose", () => disposals++);
  tubes.dispose();
  assert.equal(disposals, 2 + tubes.ownedTextures.length);
});

test("newborn tubes have the cursor direction before their first simulated frame", () => {
  const tubes = new ReferenceTubes(null);
  for (let degrees = 0; degrees < 360; degrees += 5) {
    tubes.reset();
    const radians = (degrees * Math.PI) / 180;
    const direction = new Vector3(
      Math.cos(radians),
      Math.sin(radians),
      0.08,
    ).normalize();
    const point = new Vector3(2, 44.5, -10);
    tubes.release(
      point,
      direction.clone().multiplyScalar(0.4),
      new Color("#8198de"),
      0,
    );
    const data = tubes.emission.image.data;
    let previous = new Vector3().fromArray(data, 1);
    assert.ok(previous.distanceTo(point) < 0.00001);
    for (let segment = 1; segment < 12; segment++) {
      const next = new Vector3().fromArray(data, segment * 4 + 1);
      const tangent = previous.clone().sub(next).normalize();
      assert.ok(
        tangent.dot(direction) > 0.99999,
        "the visible newborn axis must already match this movement, not turn to it later",
      );
      previous = next;
    }
  }
  tubes.dispose();
});

test("Three curve transport avoids the surface flip captured from a live newborn tube", () => {
  const [a, b, c] = [
    [-5.3033857345581055, 48.7436408996582, -9.02548885345459],
    [-5.302166938781738, 48.81243133544922, -9.036957740783691],
    [-5.30786657333374, 48.870758056640625, -9.068611145019531],
  ].map((point) => new Vector3(...point));
  const tangents = [b.clone().sub(a).normalize(), c.clone().sub(b).normalize()];
  const oldFrames = [
    tangents[0].clone().cross(a.clone().add(b)).normalize(),
    tangents[1].clone().cross(b.clone().add(c)).normalize(),
  ];
  assert.ok(
    oldFrames[0].dot(oldFrames[1]) < 0,
    "the recorded old cross-sections flip by more than 90 degrees",
  );
  const frames = Curve.prototype.computeFrenetFrames.call(
    {
      getTangentAt: (u, target) => target.copy(tangents[Math.round(u)]),
    },
    1,
    false,
  );
  assert.ok(
    frames.normals[0].dot(frames.normals[1]) > 0.9,
    "the existing Three algorithm follows the gentle bend without a surface flip",
  );
});

test("cursor turns and reversals launch each new chain along that stroke", () => {
  const input = new TubeInput();
  const strokes = [
    new Vector3(0, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(1, 1, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 0),
    new Vector3(-1, -1, 0.4),
  ];
  const releases = [];
  for (const point of strokes) {
    input.move(point, (position, velocity) =>
      releases.push({ position, velocity }),
    );
  }
  assert.equal(releases.length, strokes.length - 1);
  releases.forEach(({ position, velocity }, index) => {
    const direction = strokes[index + 1]
      .clone()
      .sub(strokes[index])
      .normalize();
    assert.ok(position.equals(strokes[index + 1]));
    assert.ok(
      velocity.clone().normalize().dot(direction) > 0.99999,
      "new strokes must use the current trajectory, including a reversed turn",
    );
  });
  const stopped = strokes.at(-1);
  for (let i = 0; i < 180; i++)
    input.move(stopped, () => assert.fail("stationary pointer emitted"));
});

test("continuous circular input and its reversal are not quantized to compass directions", () => {
  const input = new TubeInput();
  const path = [];
  for (const reverse of [false, true]) {
    for (let step = 0; step <= 64; step++) {
      const angle = ((reverse ? 64 - step : step) * Math.PI) / 32;
      path.push(
        new Vector3(8 * Math.cos(angle), 44.5 + 8 * Math.sin(angle), -10),
      );
    }
  }
  let previous = path[0],
    count = 0;
  for (const point of path) {
    input.move(point, (_, velocity) => {
      const direction = point.clone().sub(previous).normalize();
      assert.ok(direction.dot(velocity.clone().normalize()) > 0.99999);
      count++;
    });
    previous = point;
  }
  assert.equal(
    count,
    128,
    "all 64 directions in both rotations remain distinct",
  );
});
