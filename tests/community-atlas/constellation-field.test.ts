import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSTELLATION_EDGES,
  constellationLayout,
  constellationHitGroup,
  createConstellationFocus,
} from "../../src/community-atlas/constellation-layout.ts";
import { paintConstellation, resetConstellationFocus } from "../../src/community-atlas/constellation-field.ts";
import { CONSTELLATION_CATALOG } from "../../src/community-atlas/constellation-catalog.ts";
import type { AstralState } from "../../src/community-atlas/types.ts";

const state: AstralState = {
  width: 1200,
  height: 800,
  time: 0,
  hover: 0,
  quietRects: [],
};

test("constellations occupy the rectangular field, including the centre and corners", () => {
  const nodes = constellationLayout(state);
  assert.ok(nodes.length >= 35 && nodes.length <= 100);
  for (const [x0, x1, y0, y1] of [
    [0, 0.4, 0, 0.4],
    [0.6, 1, 0, 0.4],
    [0, 0.4, 0.6, 1],
    [0.6, 1, 0.6, 1],
  ]) {
    assert.ok(
      nodes.some(
        (p) =>
          p.x / state.width >= x0! &&
          p.x / state.width <= x1! &&
          p.y / state.height >= y0! &&
          p.y / state.height <= y1!,
      ),
    );
  }
  const radii = nodes.map((p) =>
    Math.hypot(p.x / state.width - 0.5, p.y / state.height - 0.5),
  );
  assert.ok(
    Math.max(...radii) - Math.min(...radii) > 0.25,
    "patterns must not share an orbital corridor",
  );
});

test("topology is sparse, stable, open and contains multiple distinct constellations", () => {
  const nodes = constellationLayout(state);
  const degrees = nodes.map(() => 0);
  for (const [a, b] of CONSTELLATION_EDGES) {
    assert.ok(a !== b && nodes[a] && nodes[b]);
    degrees[a]!++;
    degrees[b]!++;
    assert.equal(nodes[a]!.group, nodes[b]!.group);
  }
  assert.ok(CONSTELLATION_EDGES.length < nodes.length * 1.4);
  assert.ok(Math.max(...degrees) <= 5);
  assert.ok(degrees.filter((degree) => degree === 1).length >= 6);
  assert.ok(new Set(nodes.map((node) => node.group)).size >= 6);
  assert.deepEqual(constellationLayout(state), constellationLayout(state));
});

test("each named constellation preserves its shape throughout animation and pointer movement", () => {
  const initial = constellationLayout(state);
  const moved = constellationLayout({
    ...state,
    time: 89,
    hover: 1, pointerX: 600, pointerY: 300,
  });
  for (const [a, b] of CONSTELLATION_EDGES) {
    const distance = (nodes: ReturnType<typeof constellationLayout>) =>
      Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
    assert.ok(
      Math.abs(distance(initial) - distance(moved)) < 1e-8,
      "hover and time must not stretch an asterism",
    );
  }
});

test("hover selects a whole nearby group and ignores text/empty space", () => {
  const nodes = constellationLayout(state),
    anchor = nodes[0]!;
  const input = { ...state, pointerX: anchor.x, pointerY: anchor.y, hover: 1 };
  assert.equal(constellationHitGroup(input, nodes), anchor.group);
  assert.equal(
    constellationHitGroup(
      {
        ...input,
        quietRects: [
          {
            left: anchor.x - 10,
            top: anchor.y - 10,
            right: anchor.x + 10,
            bottom: anchor.y + 10,
          },
        ],
      },
      nodes,
    ),
    -1,
  );
  assert.equal(
    constellationHitGroup(
      { ...state, hover: 1, pointerX: -100, pointerY: -100 },
      nodes,
    ),
    -1,
  );
  const focus = createConstellationFocus();
  let values = focus.step(anchor.group, 0.03, false);
  for (let i = 0; i < 40; i++) values = focus.step(anchor.group, 0.03, false);
  assert.ok(values[anchor.group]!.strength > 0.98);
  assert.ok(values.every((v, i) => i === anchor.group || v.strength === 0));
  for (let i = 0; i < 100; i++) values = focus.step(-1, 0.03, false);
  assert.ok(values.every((v) => v.strength < 0.001));
});

test("reduced motion responds immediately without advancing a reveal animation", () => {
  const focus = createConstellationFocus();
  const selected = focus.step(2, 0, true);
  assert.equal(selected[2]!.strength, 1);
  assert.equal(selected[2]!.reveal, 1);
  assert.ok(focus.step(-1, 0, true).every((v) => v.strength === 0));
});

test("the sky stays registered while time and the pointer change; only hover lighting can move", () => {
  const initial = constellationLayout(state);
  for (const time of [10, 100, 10000]) {
    const next = constellationLayout({ ...state, time });
    assert.deepEqual(next, initial);
  }
  for (const [pointerX, pointerY] of [[100, 100], [600, 400], [1100, 700]]) {
    const hovered = constellationLayout({ ...state, hover: 1, pointerX, pointerY });
    assert.deepEqual(hovered, initial);
  }
});

test("wide title regions are not occupied by a complete constellation outline", () => {
  for (const [width, height] of [
    [795, 603],
    [1050, 850],
    [1920, 1080],
  ]) {
    const nodes = constellationLayout({
      ...state,
      width: width!,
      height: height!,
    });
    const inside = (p: { x: number; y: number }) =>
      p.x > width! * 0.3 &&
      p.x < width! * 0.7 &&
      p.y > height! * 0.3 &&
      p.y < height! * 0.6;
    assert.ok(nodes.filter(inside).length <= 2, "the central title must not sit inside an entire constellation");
    assert.ok(
      CONSTELLATION_EDGES.filter(
        ([a, b]) => inside(nodes[a]!) && inside(nodes[b]!),
      ).length <= 1,
    );
  }
});

test("narrow and wide viewports retain finite, inset positions", () => {
  for (const [width, height] of [
    [390, 720],
    [2560, 900],
    [320, 420],
  ]) {
    const nodes = constellationLayout({
      ...state,
      width: width!,
      height: height!,
      time: 123,
      hover: 1, pointerX: width! * 2, pointerY: -height!,
    });
    assert.ok(
      nodes.every(
        (p) =>
          Number.isFinite(p.x + p.y) &&
          p.x >= 0 &&
          p.x <= width! &&
          p.y >= 0 &&
          p.y <= height!,
      ),
    );
  }
});

function drawingRecorder() {
  let depth = 0,
    clears = 0;
  const coordinates: number[] = [];
  const alphas: number[] = [];
  const starAlphas: number[] = [];
  const lineAlphas: number[] = [];
  type RecordedGradient = { stops: number[]; addColorStop(offset: number, value: string): void };
  let strokeStyle: string | RecordedGradient = "";
  const labels: {
    text: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  const recordColor = (value: string | CanvasGradient) => {
    if (typeof value !== "string") return;
    const alpha = value.match(/,([\d.e+-]+)\)$/)?.[1];
    if (alpha) alphas.push(Number(alpha));
  };
  const gradient = (isStar = false): RecordedGradient => ({
    stops: [],
    addColorStop(_offset: number, value: string) {
      recordColor(value);
      const opacity = Number(value.match(/,([\d.e+-]+)\)$/)?.[1] ?? 0);
      this.stops.push(opacity);
      if (isStar) starAlphas.push(opacity);
    },
  });
  const record = (...values: number[]) => coordinates.push(...values);
  const ctx = {
    save() {
      depth++;
    },
    restore() {
      depth--;
    },
    clearRect() {
      clears++;
    },
    beginPath() {},
    stroke() { if (typeof strokeStyle !== "string") lineAlphas.push(...strokeStyle.stops); },
    fill() {},
    moveTo: record,
    lineTo: record,
    arc: record,
    fillText(text: string, x: number, y: number) {
      record(x, y);
      labels.push({
        text,
        left: x,
        top: y - 12,
        right: x + text.length * 7,
        bottom: y + 2,
      });
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    createRadialGradient(...values: number[]) {
      record(...values);
      return gradient(true);
    },
    createLinearGradient(...values: number[]) {
      record(...values);
      return gradient();
    },
    fillRect() {
      assert.fail("the foreground must never paint an opaque background");
    },
    set fillStyle(value: string | CanvasGradient) {
      recordColor(value);
    },
    set strokeStyle(value: string | CanvasGradient) {
      recordColor(value);
      strokeStyle = value as string | RecordedGradient;
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    coordinates,
    alphas,
    starAlphas,
    lineAlphas,
    labels,
    depth: () => depth,
    clears: () => clears,
  };
}

test("desktop names stay hidden at rest and each hovered group has one unobstructed cached label", () => {
  const quietRects = [
    { left: 260, top: 245, right: 790, bottom: 335 },
    { left: 280, top: 415, right: 770, bottom: 470 },
    { left: 460, top: 560, right: 590, bottom: 605 },
  ];
  const drawing = drawingRecorder();
  const input = {
    ...state,
    width: 1050,
    height: 850,
    time: 24,
    quietRects,
  };
  paintConstellation(drawing.ctx, input);
  assert.equal(drawing.labels.length, 0, "idle labels must not turn the sky into an annotated chart");
  const labels: typeof drawing.labels = [];
  const nodes = constellationLayout(input);
  for (let group = 0; group < CONSTELLATION_CATALOG.length; group++) {
    const anchor = nodes.find(node => node.group === group && !quietRects.some(rect =>
      node.x >= rect.left && node.x <= rect.right && node.y >= rect.top && node.y <= rect.bottom))!;
    drawing.labels.length = 0;
    paintConstellation(drawing.ctx, { ...input, reducedMotion: true, hover: 1, pointerX: anchor.x, pointerY: anchor.y });
    assert.equal(drawing.labels.length, 1, "reduced-motion users can inspect the selected name immediately");
    assert.ok(drawing.labels[0]!.text.startsWith(CONSTELLATION_CATALOG[group]!.name));
    labels.push({ ...drawing.labels[0]! });
  }
  for (const [index, label] of labels.entries()) {
    for (const other of [...quietRects, ...labels.slice(0, index)]) {
      assert.ok(
        label.right <= other.left ||
          label.left >= other.right ||
          label.bottom <= other.top ||
          label.top >= other.bottom,
        `${label.text} overlaps text`,
      );
    }
  }
  drawing.labels.length = 0;
  paintConstellation(drawing.ctx, input);
  assert.equal(drawing.labels.length, 0, "old focus decay must not leave names visible after hover ends");
});

test("painting is transparent, finite, repeatable and balanced at every viewport", () => {
  for (const [width, height] of [
    [390, 720],
    [1200, 800],
  ]) {
    const input = {
      ...state,
      width: width!,
      height: height!,
      time: 42,
      hover: 1,
      pointerX: 150,
      pointerY: 200,
    };
    const first = drawingRecorder(),
      second = drawingRecorder();
    paintConstellation(first.ctx, input);
    paintConstellation(second.ctx, input);
    assert.equal(first.clears(), 1);
    assert.equal(first.depth(), 0);
    assert.ok(first.coordinates.length > 200);
    assert.ok(first.coordinates.every(Number.isFinite));
    assert.deepEqual(first.coordinates, second.coordinates);
    assert.deepEqual(first.alphas, second.alphas);
    assert.ok(Math.max(...first.alphas) <= 1);
  }
});

test("resizing and reset preserve current line exposure and geometry without stale hover state", () => {
  const shared = drawingRecorder();
  for (const [width, height] of [[1600, 900], [390, 640], [1600, 900], [1050, 850]]) {
    const input = { ...state, width: width!, height: height!, time: 12, reducedMotion: true };
    const fresh = drawingRecorder();
    shared.lineAlphas.length = 0;
    shared.coordinates.length = 0;
    paintConstellation(shared.ctx, input);
    paintConstellation(fresh.ctx, input);
    assert.deepEqual(shared.lineAlphas, fresh.lineAlphas, "resizing retains the current line treatment");
    assert.deepEqual(shared.coordinates, fresh.coordinates, "focus state must never change star or line geometry");
    const beforeReset = [...shared.lineAlphas];
    resetConstellationFocus(shared.ctx);
    shared.lineAlphas.length = 0;
    paintConstellation(shared.ctx, input);
    assert.deepEqual(shared.lineAlphas, beforeReset, "fresh mount retains the same fixed structure");
  }
});

test("content softens lines by half while stars retain their light and the complete sky retains geometry", () => {
  const plain = drawingRecorder(),
    covered = drawingRecorder();
  // Mobile idle mode draws no labels, so this compares the complete sky layer.
  const input = {
    ...state,
    width: 390,
    height: 640,
    time: 24,
  };
  paintConstellation(plain.ctx, input);
  paintConstellation(covered.ctx, {
    ...input,
    quietRects: [
      {
        left: -100,
        top: -100,
        right: state.width + 100,
        bottom: state.height + 100,
      },
    ],
  });
  assert.ok(plain.alphas.length > 100);
  assert.deepEqual(covered.starAlphas, plain.starAlphas, "content may not mask stellar light");
  assert.ok(plain.lineAlphas.length > 100);
  assert.equal(covered.lineAlphas.length, plain.lineAlphas.length);
  covered.lineAlphas.forEach((opacity, index) => {
    assert.ok(Math.abs(opacity - plain.lineAlphas[index]! * .5) < 1e-12, "the covered annotation lines remain present at half opacity");
  });
  assert.deepEqual(covered.coordinates, plain.coordinates);
});

test("idle catalog stars scintillate without moving their geometry or adding a text mask", () => {
  const first = drawingRecorder(),
    later = drawingRecorder();
  const input = { ...state, width: 390, height: 640, time: 3 };
  paintConstellation(first.ctx, input);
  paintConstellation(later.ctx, { ...input, time: 8 });
  assert.deepEqual(
    first.coordinates,
    later.coordinates,
    "light changes must not displace stars or enlarge halos",
  );
  assert.notDeepEqual(
    first.alphas,
    later.alphas,
    "main stars must no longer be static",
  );
});

test("scrolling content never relocates constellation labels; hidden names restore at the same anchors", () => {
  const drawing = drawingRecorder();
  const input = { ...state, width: 1050, height: 850, time: 24 };
  const nodes = constellationLayout(input);
  const selections = new Map<string, { pointerX: number; pointerY: number; hover: number; reducedMotion: boolean }>();
  const anchors = new Map<string, (typeof drawing.labels)[number]>();
  for (let group = 0; group < CONSTELLATION_CATALOG.length; group++) {
    const node = nodes.find(node => node.group === group)!;
    const selection = { pointerX: node.x, pointerY: node.y, hover: 1, reducedMotion: true };
    drawing.labels.length = 0;
    paintConstellation(drawing.ctx, { ...input, ...selection });
    assert.equal(drawing.labels.length, 1);
    const label = drawing.labels[0]!;
    anchors.set(label.text, { ...label });
    selections.set(label.text, selection);
  }
  assert.equal(anchors.size, 6);
  const targets = [...anchors.values()].filter(
    (p) => p.text.includes("天琴") || p.text.includes("大熊"),
  );
  let hidden = false;
  for (const lyra of targets)
    for (let scroll = -20; scroll <= 40; scroll++) {
      drawing.labels.length = 0;
      const quiet = {
        left: lyra.left - 20,
        right: lyra.right + 20,
        top: lyra.top + scroll,
        bottom: lyra.bottom + scroll + 10,
      };
      paintConstellation(drawing.ctx, { ...input, ...selections.get(lyra.text)!, quietRects: [quiet] });
      if (!drawing.labels.some((p) => p.text === lyra.text)) hidden = true;
      for (const name of drawing.labels) {
        assert.deepEqual(
          name,
          anchors.get(name.text),
          `${name.text} jumped while content moved`,
        );
      }
    }
  assert.ok(hidden, "only the overlapping label should disappear");
  for (const [text, anchor] of anchors) {
    drawing.labels.length = 0;
    paintConstellation(drawing.ctx, { ...input, ...selections.get(text)! });
    assert.deepEqual(drawing.labels, [anchor]);
  }
});

test("mobile hover only exposes the selected label and resize rebuilds inset anchors", () => {
  const drawing = drawingRecorder();
  paintConstellation(drawing.ctx, { ...state, width: 390, height: 640 });
  assert.equal(drawing.labels.length, 0);
  const anchor = constellationLayout({ ...state, width: 390, height: 640 })[0]!;
  paintConstellation(drawing.ctx, {
    ...state,
    width: 390,
    height: 640,
    reducedMotion: true,
    hover: 1,
    pointerX: anchor.x,
    pointerY: anchor.y,
  });
  assert.equal(drawing.labels.length, 1);
  drawing.labels.length = 0;
  paintConstellation(drawing.ctx, { ...state, width: 1050, height: 850 });
  assert.equal(drawing.labels.length, 0);
  const desktopNode = constellationLayout({ ...state, width: 1050, height: 850 })[0]!;
  paintConstellation(drawing.ctx, { ...state, width: 1050, height: 850, reducedMotion: true,
    hover: 1, pointerX: desktopNode.x, pointerY: desktopNode.y });
  assert.equal(drawing.labels.length, 1);
  assert.ok(
    drawing.labels.every(
      (p) => p.left >= 16 && p.right <= 1034 && p.top >= 0 && p.bottom <= 850,
    ),
  );
});

test("switching hover never leaves the previous name visible during its light fade-out", () => {
  const drawing = drawingRecorder();
  const nodes = constellationLayout(state);
  const first = nodes.find(node => node.group === 0)!;
  const next = nodes.find(node => node.group === 2)!;
  const hovered = { ...state, hover: 1, deltaSeconds: 1 / 30 };
  for (let frame = 0; frame < 40; frame++) {
    drawing.labels.length = 0;
    paintConstellation(drawing.ctx, { ...hovered, time: frame / 30, pointerX: first.x, pointerY: first.y });
  }
  assert.equal(drawing.labels.length, 1);
  assert.ok(drawing.labels[0]!.text.startsWith(CONSTELLATION_CATALOG[0]!.name));
  for (let frame = 40; frame < 44; frame++) {
    drawing.labels.length = 0;
    paintConstellation(drawing.ctx, { ...hovered, time: frame / 30, pointerX: next.x, pointerY: next.y });
    assert.ok(drawing.labels.every(label => label.text.startsWith(CONSTELLATION_CATALOG[2]!.name)));
  }
  assert.equal(drawing.labels.length, 1);
});
