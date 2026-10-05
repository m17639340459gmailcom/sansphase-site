import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postcss, { type Rule } from "postcss";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: { document: Document; close(): void } };
};
const sheet = postcss.parse(await readFile(new URL("../../src/community-atlas/styles.css", import.meta.url), "utf8"));

test("landing entrance is route-gated, respects reduced motion and keeps its action visible and stationary", () => {
  const entranceRules: Rule[] = [];
  sheet.walkRules(rule => {
    if (rule.selector.includes(".community-landing") && rule.nodes.some(node => node.type === "decl" && node.prop === "animation")) entranceRules.push(rule);
  });
  assert.ok(entranceRules.length > 0, "the landing content has an entrance");
  const dom = new JSDOM('<body data-orbit-experiment="astral"><main id="main" class="community-entering"><section class="community-landing"><h1>無相社区</h1><p>介绍</p><div class="community-landing-actions"><a href="#/community/all">进入社区</a></div></section><section class="community-page"><h1>其他内容</h1></section></main></body>');
  const { document } = dom.window;
  try {
    const applies = (element: Element) => entranceRules.filter(rule => element.matches(rule.selector));
    const title = document.querySelector(".community-landing h1")!;
    const action = document.querySelector(".community-landing-actions")!;
    assert.ok(applies(title).length && applies(action).length);
    assert.equal(applies(document.querySelector(".community-page h1")!).length, 0);
    assert.equal(applies(document.querySelector(".community-landing")!).length, 0, "never transform the parent of the fixed star canvas");
    for (const rule of entranceRules) {
      assert.equal(rule.parent?.type, "atrule");
      const media = rule.parent as postcss.AtRule;
      assert.equal(media.name, "media");
      assert.equal(media.params, "(prefers-reduced-motion: no-preference)", "reduced motion keeps the normal visible layout");
      rule.walkDecls(declaration => assert.doesNotMatch(declaration.value, /infinite|pointer-events:\s*none/));
    }
    const actionAnimation = applies(action).flatMap(rule => rule.nodes)
      .find(node => node.type === "decl" && node.prop === "animation") as postcss.Declaration;
    const name = actionAnimation.value.split(/\s+/)[0];
    let found = false;
    sheet.walkAtRules("keyframes", frames => {
      if (frames.params !== name) return;
      found = true;
      frames.walkDecls(declaration => {
        assert.notEqual(declaration.prop, "transform", "button hit area stays fixed during entrance");
        if (declaration.prop === "opacity") assert.ok(Number(declaration.value) >= .65, "Tab focus is never hidden by the button's entrance");
      });
    });
    assert.ok(found);
    document.getElementById("main")!.classList.remove("community-entering");
    assert.equal(applies(title).length, 0, "later updates do not restart the entrance");
    document.getElementById("main")!.classList.add("community-entering");
    document.body.removeAttribute("data-orbit-experiment");
    assert.equal(applies(title).length, 0, "formal pages remain untouched");
  } finally { dom.window.close(); }
});
const headerRules: Rule[] = [];
sheet.walkRules((rule) => {
  if (rule.selector.includes("#site-header")) headerRules.push(rule);
});

test("navigation fade applies only to the mounted community landing with the menu closed", () => {
  assert.equal(headerRules.length, 1, "Use one scoped paint rule, not stacked header patches");
  const dom = new JSDOM('<body class="content-open community-open" data-orbit-experiment="astral"><header id="site-header"><nav class="nav"></nav></header></body>');
  const { document } = dom.window;
  const header = document.getElementById("site-header")!;
  const nav = document.querySelector(".nav")!;
  const matches = () => headerRules.some((rule) => header.matches(rule.selector));
  try {
    assert.ok(matches());
    nav.classList.add("open");
    assert.equal(matches(), false, "The existing full-screen menu keeps its readable surface");
    nav.classList.remove("open");
    header.classList.add("community-header");
    assert.equal(matches(), false, "Internal community pages retain their own navigation chrome");
    header.classList.remove("community-header");
    document.body.classList.remove("community-open");
    assert.equal(matches(), false, "Other routes stay untouched even before preview cleanup");
    document.body.classList.add("community-open");
    document.body.removeAttribute("data-orbit-experiment");
    assert.equal(matches(), false, "The original community page does not opt in");
  } finally {
    dom.window.close();
  }
});

test("navigation fade changes paint only and leaves the bottom fully clear", () => {
  assert.equal(headerRules.length, 1);
  const declarations = new Map<string, string>();
  headerRules[0]!.walkDecls((declaration) => {
    assert.equal(declaration.important, undefined);
    declarations.set(declaration.prop, declaration.value);
  });
  assert.deepEqual([...declarations.keys()].sort(), [
    "-webkit-backdrop-filter", "backdrop-filter", "background", "border-bottom-color",
  ]);
  assert.match(declarations.get("background")!, /^linear-gradient\(180deg,/);
  assert.match(declarations.get("background")!, /rgb\(5 7 11 \/ 0%\) 100%\) no-repeat$/);
  assert.equal(declarations.get("border-bottom-color"), "transparent");
  assert.equal(declarations.get("backdrop-filter"), "none");
  assert.equal(declarations.get("-webkit-backdrop-filter"), "none");
});

test("pure-space base belongs only to the mounted local landing, not other backgrounds", () => {
  const rules: Rule[] = [];
  sheet.walkRules(rule => { if (rule.selector.includes("#blog-backdrop")) rules.push(rule); });
  assert.equal(rules.length, 1);
  const dom = new JSDOM('<body class="community-open" data-orbit-experiment="astral"><div id="blog-backdrop"></div></body>');
  const { document } = dom.window;
  const backdrop = document.getElementById("blog-backdrop")!;
  try {
    assert.ok(backdrop.matches(rules[0]!.selector));
    document.body.removeAttribute("data-orbit-experiment");
    assert.equal(backdrop.matches(rules[0]!.selector), false);
    document.body.dataset.orbitExperiment = "astral";
    document.body.classList.remove("community-open");
    assert.equal(backdrop.matches(rules[0]!.selector), false);
    rules[0]!.walkDecls(declaration => {
      assert.equal(declaration.prop, "background", "Paint only: preserve backdrop geometry and input handling");
      assert.doesNotMatch(declaration.value, /url\(/i, "The accepted picture is a reference, not a shipped bitmap");
      assert.equal(declaration.important, undefined);
    });
  } finally { dom.window.close(); }
});
