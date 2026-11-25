import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFrontendIntegrationPreview } from "../scripts/preview-frontend-integration.ts";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";

const build = process.env.SANSPHASE_TEST_V3_BUILD;
const browser = process.env.SANSPHASE_UI_TEST_BROWSER;

test("V3 admin Escape returns to the previous console route and lets menus and the editor handle Escape first", {
  skip: !build || !browser, timeout: 150000,
}, async (t) => {
  const preview = await createFrontendIntegrationPreview({ frontend: "v3", port: 0, v3AppDirectory: build });
  t.after(preview.close);
  const signed = await fetch(`${preview.origin}/api/author/login`, {
    method: "POST",
    headers: { Origin: preview.origin, "Content-Type": "application/json", "X-Author-Request": "1" },
    body: JSON.stringify({ email: "owner@example.test", password: "DemoLogin2026!" }),
  });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const separator = cookie.indexOf("=");

  await evaluateInWebGLBrowser(browser, "location.pathname", "about:blank", async (socket) => {
    let id = 200;
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const current = ++id;
      const receive = ({ data }) => {
        const response = JSON.parse(data);
        if (response.id !== current) return;
        socket.removeEventListener("message", receive);
        const error = response.error ?? response.result?.exceptionDetails;
        if (error) reject(new Error(JSON.stringify(error)));
        else resolve(response.result);
      };
      socket.addEventListener("message", receive);
      socket.send(JSON.stringify({ id: current, method, params }));
    });
    const read = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await read(expression).catch(() => false)) return;
        await delay(60);
      }
      assert.fail(`Expected ${expression}, at ${await read("location.href")}`);
    };
    const escape = async () => {
      const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
      await call("Input.dispatchKeyEvent", { type: "keyDown", ...key });
      await call("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    };
    const query = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
    const click = async (selector) => {
      await wait(`!!${query(selector)}`);
      await read(`${query(selector)}.click()`);
    };
    const resize = (width, mobile) => call("Emulation.setDeviceMetricsOverride", { width, height: 844, mobile, deviceScaleFactor: 1 });
    const adminTable = '[data-testid="reader-table"] tbody tr';
    const authorShell = '[data-author-host="admin-console"] #author-dialog';
    const editor = `${authorShell} .tiptap`;
    const title = `${authorShell} input[name="title"]`;
    const discard = `${authorShell} .author-discard:not([hidden])`;
    const menuToggle = "header .RaAppBar-menuButton";

    await resize(1440, false);
    const installed = await call("Network.setCookie", {
      url: preview.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1), httpOnly: true, sameSite: "Strict",
    });
    assert.equal(installed.success, true);
    await call("Page.navigate", { url: `${preview.origin}/admin-console/#/readers` });
    await wait(`!!${query(adminTable)}`);
    assert.equal(await read("location.pathname"), "/admin-console/");
    await escape();
    assert.equal(await read("location.pathname"), "/admin-console/");

    await click('a[href="#/memberships"]');
    await wait(`location.hash.startsWith("#/memberships") && !!${query(adminTable)}`);
    const membership = await read("location.hash");
    await click('a[href="#/activity"]');
    await wait('location.hash.startsWith("#/activity")');
    await escape();
    await wait(`location.hash === ${JSON.stringify(membership)} && !!${query(adminTable)}`);

    await click('a[href="#/activity"]');
    await wait('location.hash.startsWith("#/activity")');
    await read('(Object.defineProperty(window, "navigation", { value: undefined, configurable: true }), true)');
    await escape();
    await wait(`location.hash === ${JSON.stringify(membership)} && !!${query(adminTable)}`);
    await read('delete window.navigation');

    if (await read(`!!${query(".RaSidebar-docked.RaSidebar-open")}`)) {
      await click(menuToggle);
      await wait(`!!${query(".RaSidebar-docked.RaSidebar-closed")}`);
    }
    await resize(390, true);
    await wait(`!${query(".RaSidebar-docked")}`);
    await click(menuToggle);
    await wait(`!!${query(".RaSidebar-modal")}`);
    await escape();
    await wait(`!${query(".RaSidebar-modal")}`);
    assert.equal(await read("location.hash"), membership);
    await resize(1440, false);

    await click('a[href="#/author-panel"]');
    await click(`${authorShell} [data-author-open="articles"]`);
    await click(`${authorShell} .author-item-list [data-edit]`);
    await wait(`!!${query(editor)}`);
    await read(`(() => {
      const field = ${query(title)};
      field.value = 'Unsaved Escape test';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      ${query(editor)}.focus();
    })()`);
    await escape();
    await wait(`!!${query(discard)}`);
    assert.equal(await read("location.hash"), "#/author-panel");
    await escape();
    await wait(`!${query(discard)}`);
    assert.equal(await read(`${query(title)}.value`), "Unsaved Escape test");

    await read(`${query(menuToggle)}.focus()`);
    await escape();
    await wait(`!!${query(discard)}`);
    await click(`${discard} [data-keep-editing]`);
    await wait(`location.hash === "#/author-panel" && !${query(discard)}`);
    assert.equal(await read(`${query(title)}.value`), "Unsaved Escape test");
  });
});
