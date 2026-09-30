import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { composeSiteStyles } from "../scripts/compose-site-styles.mjs";

test("blog card materials have one owner, outside shared layout styles", async () => {
  const shared = postcss.parse((await composeSiteStyles()).toString("utf8"));
  const host =
    /\.(blog-card|blog-identity|blog-side-card|blog-notice|blog-toolbar)(?::(?:hover|focus-visible|focus-within))?$/;
  shared.walkRules((rule) => {
    if (!rule.selectors.some((s) => host.test(s))) return;
    rule.walkDecls((decl) => {
      assert.ok(
        !/^(background.*|border.*|box-shadow|backdrop-filter|transform|transition.*)$/.test(
          decl.prop,
        ),
        `Material belongs in blog-background.css, not ${rule.selector}: ${decl.prop}`,
      );
    });
  });
  const theme = postcss.parse(
    await readFile("src/blog-background.css", "utf8"),
  );
  theme.walkRules((rule) => {
    assert.ok(
      !rule.selector.includes(".theme-light"),
      "retired light-theme overrides must not return",
    );
    assert.ok(
      !rule.selector.includes(".blog-ready"),
      "card material cannot depend on image/network readiness",
    );
  });
});

test("site focus styles never add an outer frame", async () => {
  for (const file of ["styles.css", "blog-background.css", "author.css"]) {
    const source = file === "styles.css"
      ? (await composeSiteStyles()).toString("utf8")
      : await readFile("src/" + file, "utf8");
    const css = postcss.parse(source);
    css.walkDecls("outline", (decl) =>
      assert.ok(
        ["none", "0"].includes(decl.value),
        `${file}: ${decl.parent.selector} adds an outer focus frame`,
      ),
    );
  }
});

test('text inputs and editors never receive a second focus frame', async () => {
  for (const file of ['styles-foundation.css','reader.css','author.css','blog-background.css','styles-reading.css']) {
    const css=postcss.parse(await readFile('src/'+file,'utf8'));
    css.walkRules(rule=>{
      if(!rule.selectors.some(selector=>/:(focus|focus-visible|focus-within)/.test(selector)&&/\b(input|textarea|select)\b|\[contenteditable/.test(selector)))return;
      rule.walkDecls(decl=>{
        if(decl.prop==='box-shadow')assert.equal(decl.value,'none',`${file}: ${rule.selector} adds a second input frame`);
        if(decl.prop==='outline')assert.ok(['0','none'].includes(decl.value),`${file}: ${rule.selector} adds an outline`);
      });
    });
  }
});

test('shared glass cards own a continuous border across pages and views', async () => {
  const css = postcss.parse(await readFile('src/blog-background.css', 'utf8'));
  const rules = [...css.nodes].filter(node => node.type === 'rule');
  const declarations = selector => Object.fromEntries(
    rules.find(rule => rule.selector === selector).nodes
      .filter(node => node.type === 'decl').map(node => [node.prop, node.value]),
  );
  const hosts = declarations('.blog-page :is(.blog-card, .blog-identity, .blog-side-card, .blog-notice, .blog-toolbar)');
  assert.equal(hosts.overflow, 'visible', 'the host must not clip the rounded surface a second time');
  const surface = declarations('.blog-page .blog-third-party-glass');
  assert.equal(surface.border, '2px solid transparent', 'the surface reserves the same space as the visible outline');
  assert.equal(surface.overflow, 'hidden', 'the material surface owns image clipping');
  assert.equal(hosts.position, 'relative');
  assert.equal(hosts.isolation, 'isolate');
  const edge = declarations('.blog-page :is(.blog-card, .blog-identity, .blog-side-card, .blog-notice)::after');
  assert.equal(edge.border, '2px solid var(--glass-edge)', 'one continuous outline owns straight edges and all four corners');
  assert.ok(!declarations('body.blog-open')['--glass-shadow'].includes('var(--smoked-shadow)'), 'the card must not reintroduce the directional inset highlight');
  assert.ok(!declarations('body.blog-open')['--glass-shadow'].includes('inset'), 'one edge must not get an extra inner highlight');
  assert.equal(edge.inset, '0');
  assert.equal(edge['border-radius'], 'inherit');
  assert.equal(edge['pointer-events'], 'none', 'the outline must not block card links');
  assert.equal(edge['z-index'], '2', 'the outline paints above the clipped content');
  assert.equal(surface['z-index'], '0', 'content stacking stays below the outline');
  const content = declarations('.blog-page .blog-third-party-glass .glass-surface__content');
  assert.equal(content['border-radius'], '0', 'inner content must not inherit the outer radius');
  assert.equal(declarations('.blog-page .blog-toolbar .blog-third-party-glass').border, '0', 'the borderless toolbar stays borderless');
  css.walkRules(rule => {
    if (!rule.selector.includes('.blog-results') || !rule.selector.includes('.blog-third-party-glass')) return;
    assert.ok(!rule.nodes.some(node => node.type === 'decl' && /^(border|border-width)$/.test(node.prop)),
      'list/grid must not fork the shared card border');
  });
});
