import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHTML,
  parseRoute,
  dragTarget,
  dragPosition,
  filterItems,
} from "../dist/core.mjs";

test("routes support direct details and reject unknown pages", () => {
  assert.deepEqual(parseRoute("#/work/orbit"), { page: "work", id: "orbit" });
  assert.deepEqual(parseRoute("#/community"), { page: "community", id: "" });
  assert.deepEqual(parseRoute("#/software"), { page: "software", id: "" });
  assert.deepEqual(parseRoute("#/resource-center"), {
    page: "resource-center",
    id: "",
  });
  assert.equal(parseRoute("#/unknown").page, "404");
  assert.equal(parseRoute("#/work/%E0%A4%A").page, "404");
});
test("left drag advances, right reverses, taps do not advance, ends clamp", () => {
  assert.equal(dragTarget(0, -110, 600, 3), 1);
  assert.equal(dragTarget(1, 110, 600, 3), 0);
  assert.equal(dragTarget(1, 5, 600, 3), 1);
  assert.equal(dragTarget(2, -200, 600, 3), 2);
  assert.equal(dragTarget(0, 200, 600, 3), 0);
});
test("search combines category and Chinese / English text", () => {
  const items = [
    { title: "AI 学习笔记", category: "学习", summary: "模型与工作流" },
    { title: "设计实验", category: "作品", summary: "Visual" },
  ];
  assert.equal(filterItems(items, "学习", "AI").length, 1);
  assert.equal(filterItems(items, "作品", "AI").length, 0);
  assert.equal(filterItems(items, "all", "visual").length, 1);
});
test("drag preview stays within the adjacent scene and has end resistance", () => {
  assert.equal(dragPosition(0, -1400, 1000, 3), 1);
  assert.equal(dragPosition(1, 1400, 1000, 3), 0);
  assert.equal(dragPosition(0, 1400, 1000, 3), -0.12);
  assert.equal(dragPosition(2, -1400, 1000, 3), 2.12);
});
test("rendered text escapes untrusted markup", () => {
  assert.equal(escapeHTML('<script>"&'), "&lt;script&gt;&quot;&amp;");
});
