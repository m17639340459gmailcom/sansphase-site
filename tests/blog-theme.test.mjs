import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";

test("blog card materials have one owner, outside shared layout styles", async () => {
  const shared = postcss.parse(await readFile("src/styles.css", "utf8"));
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
    const css = postcss.parse(await readFile("src/" + file, "utf8"));
    css.walkDecls("outline", (decl) =>
      assert.ok(
        ["none", "0"].includes(decl.value),
        `${file}: ${decl.parent.selector} adds an outer focus frame`,
      ),
    );
  }
});
