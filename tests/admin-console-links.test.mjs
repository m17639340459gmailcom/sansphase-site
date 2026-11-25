import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

test("real MUI console navigation has a visible same-tab return and a distinct original author destination", async (t) => {
  const base = resolve(".local");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "admin-links-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outfile = resolve(root, "navigation.mjs");
  await build({
    entryPoints: ["src/admin-console/navigation.tsx"],
    outfile,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
  });
  const { ConsoleReturnLink, OriginalAuthorPanel } = await import(
    pathToFileURL(outfile).href
  );
  const theme = createTheme();
  const markup = (component, preview, mainFrontend = "v1") =>
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme },
        createElement(component, { preview, mainFrontend }),
      ),
    );
  for (const preview of [false, true]) {
    const html = markup(ConsoleReturnLink, preview);
    const doc = new JSDOM(html).window.document;
    const link = doc.querySelector("a");
    assert.ok(
      link?.classList.contains("MuiButton-root"),
      "reuse the actual MUI button",
    );
    assert.equal(link.textContent, "返回主站");
    assert.equal(
      link.getAttribute("href"),
      preview ? "/?mainPreview=1#/notes" : "/",
    );
    assert.equal(
      link.hasAttribute("target"),
      false,
      "the return uses the current tab",
    );
    assert.equal(link.hasAttribute("hidden"), false);
    const css = [...doc.querySelectorAll("style")]
      .map((node) => node.textContent)
      .join("\n");
    assert.match(css, /display:inline-flex/);
    assert.doesNotMatch(
      css,
      /display:none/,
      "narrow screens must retain the return button",
    );
    assert.match(css, /flex-shrink:0/);
    assert.match(css, /min-width:0/);
    assert.match(css, /white-space:nowrap/);
    assert.match(
      css,
      /min-width:0px[^}]*padding-left:8px[^}]*padding-right:8px/,
      "compact mobile padding keeps the existing header usable",
    );

    for (const mainFrontend of ["v1", "v2"]) {
      const authorDoc = new JSDOM(
        markup(OriginalAuthorPanel, preview, mainFrontend),
      ).window.document;
      const author = authorDoc.querySelector("a");
      assert.equal(author?.textContent, "打开博客作者面板");
      assert.equal(
        author?.getAttribute("href"),
        preview
          ? "/?mainPreview=1#/account"
          : mainFrontend === "v2"
            ? "/original#/account"
            : "/#/account",
      );
      assert.equal(author?.hasAttribute("target"), false);
    }
  }
});
