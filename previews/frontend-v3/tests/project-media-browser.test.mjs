import assert from "node:assert/strict";
import test from "node:test";

const preview = process.env.SANSPHASE_V3_BROWSER_TEST_URL;
const browser = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function measure(path, viewport, expression) {
  const { evaluateInWebGLBrowser } = await import("../../../tests/helpers/webgl-browser.mjs");
  return evaluateInWebGLBrowser(browser, expression, new URL(path, preview).href, (socket) => new Promise((resolve, reject) => {
    const requestId = 200;
    const receive = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== requestId) return;
      socket.removeEventListener("message", receive);
      if (message.error) reject(new Error(message.error.message));
      else resolve();
    };
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id: requestId, method: "Emulation.setDeviceMetricsOverride", params: {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: viewport.width < 640,
    } }));
  }));
}

const cardMedia = `Array.from(document.querySelectorAll('a[data-project-card]')).flatMap((card) => {
  const image = card.querySelector('img[alt]:not([alt=""])');
  return image ? [{ href: card.href, lead: card.hasAttribute('data-project-lead'), width: image.offsetWidth, height: image.offsetHeight, fit: getComputedStyle(image).objectFit }] : [];
})`;

test("project covers fit the card deck on desktop and mobile", { skip: !preview }, async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 740 }]) {
    const covers = await measure("/projects", viewport, cardMedia);
    assert.ok(covers.length > 0, "project list should expose real cover elements");
    if (covers.length > 1) assert.ok(covers.some((cover) => cover.lead), "featured project should have a real cover");
    for (const cover of covers) {
      const maxWidth = Math.min(viewport.width - 32, cover.lead ? 496 : 432);
      const maxHeight = viewport.width >= 1024 && cover.lead ? 304 : 256;
      assert.ok(cover.width > 0 && cover.width <= maxWidth, `${cover.href} cover width: ${cover.width}px (max ${maxWidth}px)`);
      assert.ok(cover.height > 0 && cover.height <= maxHeight, `${cover.href} cover height: ${cover.height}px (max ${maxHeight}px)`);
      assert.equal(cover.fit, "contain");
    }
  }
});

test("project details keep covers and gallery slides within the reading area", { skip: !preview }, async () => {
  const desktop = { width: 1440, height: 900 };
  const covers = await measure("/projects", desktop, cardMedia);
  assert.ok(covers.length > 0, "project list should link to a project with a cover");
  for (const { href } of covers.slice(0, 2)) {
    for (const viewport of [desktop, { width: 1440, height: 430 }, { width: 390, height: 740 }]) {
      const images = await measure(href, viewport, `Array.from(document.querySelectorAll('main header img[alt]:not([alt=""])')).map((image) => ({
        width: image.offsetWidth, height: image.offsetHeight, fit: getComputedStyle(image).objectFit
      }))`);
      assert.ok(images.length > 0, `${href} should render its project media`);
      for (const image of images) {
        const maxWidth = Math.min(896, viewport.width - 32);
        const maxHeight = Math.min(512, Math.ceil(viewport.height * 0.58));
        assert.ok(image.width > 0 && image.width <= maxWidth, `${href} detail width: ${image.width}px (max ${maxWidth}px)`);
        assert.ok(image.height > 0 && image.height <= maxHeight, `${href} detail height: ${image.height}px (max ${maxHeight}px)`);
        assert.equal(image.fit, "contain");
      }
    }
  }
});
