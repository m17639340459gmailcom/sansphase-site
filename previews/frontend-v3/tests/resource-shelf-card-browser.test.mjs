import assert from "node:assert/strict";
import test from "node:test";

const preview = process.env.SANSPHASE_V3_BROWSER_TEST_URL;
const browser = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("resource cards give covers more room while keeping names, VIP and book links", { skip: !preview }, async () => {
  const { evaluateInWebGLBrowser } = await import("../../../tests/helpers/webgl-browser.mjs");
  for (const [width, height] of [[1440, 900], [390, 740]]) {
    const result = await evaluateInWebGLBrowser(browser, `(async () => {
      const shelf = document.querySelector('#resource-shelf');
      const links = Array.from(shelf.querySelectorAll('a[href^="/resources/"]')).filter(link => link.querySelector('h3'));
      const cards = [];
      for (const link of links) {
        const image = link.querySelector('img');
        image.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await image.decode();
        const imageWidth = image.offsetWidth;
        const imageHeight = image.offsetHeight;
        const scale = Math.min(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
        const title = link.querySelector('h3');
        const featured = link.classList.contains('group/feat');
        cards.push({
          href: link.getAttribute('href'), title: title.textContent.trim(), text: link.textContent,
          featured, width: link.offsetWidth, bodyHeight: title.parentElement.offsetHeight,
          paintedWidth: image.naturalWidth * scale, paintedHeight: image.naturalHeight * scale,
        });
      }
      return cards;
    })()`, new URL("/resources", preview).href, (socket) => new Promise((resolve, reject) => {
      socket.addEventListener("message", function onResize({ data }) {
        const reply = JSON.parse(data);
        if (reply.id !== 200) return;
        socket.removeEventListener("message", onResize);
        if (reply.error) reject(new Error(reply.error.message));
        else resolve();
      });
      socket.send(JSON.stringify({ id: 200, method: "Emulation.setDeviceMetricsOverride", params: {
        width, height, deviceScaleFactor: 1, mobile: width < 640,
      } }));
    }));

    assert.equal(result.length, 3);
    const feature = result.find((card) => card.featured);
    const regular = result.filter((card) => !card.featured);
    assert.ok(feature.paintedWidth / feature.width >= (width >= 1024 ? 0.54 : 0.89), `${width}px featured cover occupies too little of the card`);
    if (width < 640) assert.ok(feature.bodyHeight <= 220, `${width}px featured text area is ${feature.bodyHeight}px`);
    assert.match(regular.find(({ href }) => href.endsWith("/knowledge-system-handbook"))?.text ?? "", /VIP/);
    for (const card of regular) {
      assert.ok(card.title && card.href.startsWith("/resources/"));
      assert.ok(card.paintedHeight > card.bodyHeight, `${width}px ${card.href} image ${card.paintedHeight}px, text ${card.bodyHeight}px`);
      if (width >= 1024) assert.ok(card.width >= 500, `${card.href} is too narrow at ${width}px`);
    }
  }
});
