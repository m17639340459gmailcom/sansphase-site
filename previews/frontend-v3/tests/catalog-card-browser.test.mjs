import assert from "node:assert/strict";
import test from "node:test";

const preview = process.env.SANSPHASE_V3_BROWSER_TEST_URL;
const browser = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("software cards fill the centered content row while keeping the compact card design", { skip: !preview, timeout: 180_000 }, async () => {
  const { evaluateInWebGLBrowser } = await import("../../../tests/helpers/webgl-browser.mjs");
  for (const [width, height, columns] of [[1440, 900, 3], [1024, 768, 3], [820, 720, 2], [540, 740, 1], [390, 740, 1]]) {
    const measurements = [];
    for (const path of ["/software", "/learning"]) {
      const result = await evaluateInWebGLBrowser(browser, `(() => {
        const cards = Array.from(document.querySelectorAll('main li')).filter(item => item.querySelector('h2'));
        const grid = cards[0].parentElement;
        const content = grid.closest('.container-x');
        const contentRect = content.getBoundingClientRect();
        const contentStyle = getComputedStyle(content);
        const left = contentRect.left + parseFloat(contentStyle.paddingLeft);
        const right = contentRect.right - parseFloat(contentStyle.paddingRight);
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        return {
          cols: columns,
          leftGap: cards[0].getBoundingClientRect().left - left,
          rightGap: right - cards[columns - 1].getBoundingClientRect().right,
          contentWidth: right - left,
          overflow: document.documentElement.scrollWidth > innerWidth,
          cards: cards.map(card => {
            const heading = card.querySelector('h2');
            const cover = card.querySelector('img')?.parentElement ?? card.querySelector('div[aria-hidden="true"]');
            return {
              width: card.offsetWidth, height: card.offsetHeight, coverHeight: cover.offsetHeight,
              titleSize: getComputedStyle(heading).fontSize,
              link: card.querySelector('a[href*="${path}/"]')?.pathname,
              download: card.querySelector('a[download]')?.pathname,
            };
          }),
        };
      })()`, new URL(path, preview).href, (socket) => new Promise((resolve, reject) => {
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
      assert.equal(result.cols, columns, `${path} at ${width}px`);
      assert.equal(result.cards.length, 3);
      assert.equal(result.overflow, false);
      for (const card of result.cards) {
        if (path === "/learning" && width >= 640) assert.ok(card.width <= 320, `${path} has a ${card.width}px card at ${width}px`);
        assert.ok(Math.abs(card.coverHeight - (card.width - 2) * 9 / 16) <= 1, `${path} uses a 16:9 cover at ${width}px`);
        assert.ok(card.height - card.coverHeight <= 80, `${path} caption should stay compact at ${width}px`);
        assert.ok(card.link?.startsWith(`${path}/`));
        if (path === "/learning") assert.match(card.download ?? "", /^\/materials\/.+\.md$/);
      }
      if (path === "/software") {
        assert.ok(Math.abs(result.leftGap - result.rightGap) <= 2, `software grid is centered at ${width}px`);
        if (columns > 1) {
          assert.ok(Math.abs(result.leftGap) <= 2 && Math.abs(result.rightGap) <= 2,
            `software row spans the content width at ${width}px`);
        } else {
          assert.ok(Math.abs(result.cards[0].width - Math.min(352, result.contentWidth)) <= 2,
            `software cards fit within a readable single column at ${width}px`);
        }
      }
      measurements.push(result.cards[0]);
    }
    const [software, material] = measurements;
    if (width === 1440) assert.ok(software.width >= material.width + 50, "software uses its extra desktop space");
    assert.equal(material.titleSize, software.titleSize);
  }
});
