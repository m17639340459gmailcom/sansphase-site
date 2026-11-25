import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const preview = process.env.SANSPHASE_V3_BROWSER_TEST_URL;
const browser = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const trigger = "[data-login-verification-control]";
const popover = "[data-login-verification-popover]";
const slider = "[data-login-slider]";
const thumb = "[data-login-slider-thumb]";
const cancel = "[data-login-slider-cancel]";
const email = 'input[name="email"]';
const password = 'input[name="password"]';
const submit = 'form button[type="submit"]';
const find = (selector) => `document.querySelector(${JSON.stringify(selector)})`;

const layout = `(() => {
  const heading = document.getElementById("account-heading");
  const pageBox = (node) => {
    const { left, top, width, height } = node.getBoundingClientRect();
    return [left + scrollX, top + scrollY, width, height];
  };
  return {
    card: pageBox(heading.parentElement),
    submit: pageBox(${find(submit)}),
    page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  };
})()`;

for (const [device, width, height, mobile, short] of [
  ["desktop", 1440, 900, false, false],
  ["mobile", 390, 844, true, false],
  ["short mobile", 320, 568, true, true],
]) {
  test(`V3 ${device} verification floats below its button without shifting the login card`, { skip: !preview }, async () => {
    const { evaluateInWebGLBrowser } = await import("../../../tests/helpers/webgl-browser.mjs");
    await evaluateInWebGLBrowser(browser, "true", new URL("/account", preview).href, async (socket) => {
      let requestId = 300;
      const pending = new Map();
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        const error = message.error ?? message.result?.exceptionDetails;
        if (error) request.reject(new Error(JSON.stringify(error)));
        else request.resolve(message.result);
      });
      const send = (method, params) => new Promise((resolve, reject) => {
        pending.set(++requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
      const read = async (expression) => (
        await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      ).result.value;
      const waitFor = async (expression, explanation) => {
        for (let step = 0; step < 60; step++) {
          if (await read(expression)) return;
          await delay(75);
        }
        assert.fail(explanation);
      };
      const click = async (selector) => {
        const clickTarget = `(() => {
          const target = ${find(selector)};
          const { x, y, width, height } = target.getBoundingClientRect();
          return { x: x + width / 2, y: y + height / 2 };
        })()`;
        const receivesInput = `(() => {
          const { x, y } = ${clickTarget};
          return ${find(selector)}.contains(document.elementFromPoint(x, y));
        })()`;
        await waitFor(receivesInput, `The ${selector} control receives pointer input`);
        const point = await read(clickTarget);
        if (mobile) {
          await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
          await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          return;
        }
        await send("Input.dispatchMouseEvent", { ...point, button: "left", clickCount: 1, type: "mousePressed" });
        await send("Input.dispatchMouseEvent", { ...point, button: "left", clickCount: 1, type: "mouseReleased" });
      };
      const type = async (selector, text) => {
        await read(`${find(selector)}.focus()`);
        await send("Input.insertText", { text });
      };
      const ready = `${find(trigger)}?.dataset.state === 'ready'`;
      const openSlider = async () => {
        await click(trigger);
        await waitFor(`!!${find(thumb + ":not(:disabled)")}`, "The puzzle opens and can receive slider input");
        assert.equal(await read(`!!${find(popover)}`), true, "The verification floating surface is present");
        await waitFor(`getComputedStyle(${find(popover)}).visibility === 'visible'`, "The floating puzzle finishes positioning");
        await waitFor(`document.activeElement === ${find(thumb)}`, "Opening the floating puzzle moves keyboard focus to its slider");
      };
      const checkClosed = async (before) => {
        await waitFor(`${ready} && !${find(slider)}`, "Closing the floating puzzle restores the ready button");
        await waitFor(`document.activeElement === ${find(trigger)}`, "Closing the floating puzzle returns focus to its button");
        assert.deepEqual(await read(layout), before, "Closing preserves the page and login geometry");
        assert.equal(await read(`${find(submit)}.disabled`), true);
        assert.equal(await read(`${find(email)}.value === 'preview@example.test' && ${find(password)}.value === 'preview-password'`), true);
      };

      await send("Emulation.setDeviceMetricsOverride", { width, height, mobile, deviceScaleFactor: 1 });
      if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await waitFor(ready, "The local login-verification fixture is ready");
      await read("document.fonts.ready.then(() => true)");
      await type(email, "preview@example.test");
      await type(password, "preview-password");
      await read(`${find(trigger)}.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
      const before = await read(layout);

      await openSlider();
      const geometry = await read(`(() => {
        const floating = ${find(popover)};
        const anchor = ${find(trigger)}.getBoundingClientRect();
        const puzzle = ${find(slider)};
        const bounds = floating.getBoundingClientRect();
        const visibleInPanel = (element) => {
          const region = element.getBoundingClientRect();
          return region.width > 0 && region.height > 0 && region.left >= bounds.left - 1
            && region.right <= bounds.right + 1 && region.top >= bounds.top - 1
            && region.bottom <= bounds.bottom + 1;
        };
        return {
          outside: !document.getElementById('account-heading').parentElement.contains(floating),
          containsPuzzle: floating.contains(puzzle),
          gap: bounds.top - anchor.bottom,
          anchorCenterCovered: bounds.left <= (anchor.left + anchor.right) / 2 && bounds.right >= (anchor.left + anchor.right) / 2,
          viewportFit: bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1
            && bounds.top >= -1 && bounds.bottom <= innerHeight + 1,
          puzzleFits: visibleInPanel(${find("[data-login-slider-background]")}) && visibleInPanel(${find(thumb)}),
        };
      })()`);
      assert.equal(geometry.outside, true, "The floating surface is outside the login card");
      assert.equal(geometry.containsPuzzle, true);
      assert.ok(geometry.gap >= 0 && geometry.gap < 32, `Expected the popup below its button, got a ${geometry.gap}px gap`);
      assert.equal(geometry.anchorCenterCovered, true);
      assert.equal(geometry.viewportFit, true, "The floating puzzle fits in the viewport");
      assert.equal(geometry.puzzleFits, true, "The puzzle image and slider are both visible and unclipped");
      const during = await read(layout);
      assert.deepEqual(during.card, before.card, "Opening preserves the login card geometry");
      assert.deepEqual(during.submit, before.submit, "Opening preserves the sign-in button geometry");
      assert.equal(during.page[0], before.page[0]);
      if (!short) assert.equal(during.page[1], before.page[1], "Opening on regular screens preserves document height");
      assert.equal(await read(`${find(submit)}.disabled`), true);

      await click(cancel);
      await checkClosed(before);
      await openSlider();
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await checkClosed(before);
    });
  });
}
