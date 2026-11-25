import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const preview = process.env.SANSPHASE_V3_BROWSER_TEST_URL;
const browser = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function withPage(path, exercise, { mobile = false, reducedMotion = true, viewport } = {}) {
  const { evaluateInWebGLBrowser } = await import("../../../tests/helpers/webgl-browser.mjs");
  await evaluateInWebGLBrowser(browser, "true", new URL(path, preview).href, async (socket) => {
    let requestId = 200;
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
    const read = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    const waitFor = async (expression) => {
      for (let step = 0; step < 80; step++) {
        try {
          if (await read(expression)) return;
        } catch (error) {
          if (!/context|navigat/i.test(error.message)) throw error;
        }
        await delay(75);
      }
      assert.fail(`Expected ${expression}, at ${await read("location.href")}`);
    };
    const changeLocale = (locale) => read(`document.querySelector('header a[hreflang="${locale}"]').click()`);
    const assertLocation = (url) => waitFor(`location.pathname + location.search + location.hash === ${JSON.stringify(url)}`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport?.width ?? (mobile ? 390 : 1440),
      height: viewport?.height ?? (mobile ? 844 : 900),
      mobile,
      deviceScaleFactor: 1,
    });
    if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true });
    if (reducedMotion) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    }
    await waitFor("!!document.querySelector('main h1') && !!document.querySelector('header a[hreflang]')");
    await exercise({ read, send, waitFor, changeLocale, assertLocation });
  });
}

const sampleBook = "/resources/ai-production-field-guide";
const finalChapter = `${sampleBook}/final-review`;

async function pressKey(send, key, windowsVirtualKeyCode, modifiers = 0) {
  const data = { key, windowsVirtualKeyCode, modifiers };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...data });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...data });
}

async function clickHeaderLink({ read, send, waitFor, assertLocation }, path) {
  const link = `document.querySelector('header a[href=${JSON.stringify(path)}]')`;
  const center = `(() => {
    const node = ${link};
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  })()`;
  await waitFor(center);
  const point = await read(center);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await assertLocation(path);
}

test("Escape releases the clicked header link and Tab still shows keyboard focus", { skip: !preview }, async () => {
  await withPage("/learning", async (page) => {
    const { read, send, waitFor, assertLocation } = page;
    await clickHeaderLink(page, "/software");
    assert.equal(await read(`document.activeElement === document.querySelector('header a[href="/software"]')`), true);
    await pressKey(send, "Escape", 27);
    await assertLocation("/learning");
    assert.equal(await read(`!!document.activeElement.closest('header')`), false);
    await pressKey(send, "Tab", 9);
    await waitFor(`document.activeElement.matches('header :focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid'`);
  });
});

test("Escape follows Back and Forward on browsers without the Navigation API", { skip: !preview }, async () => {
  await withPage("/learning", async (page) => {
    const { read, send, waitFor, assertLocation } = page;
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, 'navigation', { value: undefined })` });
    await send("Page.reload", {});
    await waitFor(`typeof window.navigation === 'undefined' && document.documentElement.dataset.intro !== 'play' && !!document.querySelector('header a[href="/software"]')`);
    for (const path of ["/software", "/resources"]) await clickHeaderLink(page, path);
    await pressKey(send, "Escape", 27);
    await assertLocation("/software");
    await read("history.forward()");
    await assertLocation("/resources");
    for (const path of ["/software", "/learning", "/"]) {
      await pressKey(send, "Escape", 27);
      await assertLocation(path);
    }
  });
});

test("Escape from a directly opened localized detail goes to its list and then home", { skip: !preview }, async () => {
  await withPage("/en/learning/project-checklist", async ({ send, waitFor, assertLocation }) => {
    await waitFor("document.documentElement.dataset.intro !== 'play'");
    for (const path of ["/en/learning", "/en"]) {
      await pressKey(send, "Escape", 27);
      await assertLocation(path);
    }
  });
});

test("global Escape returns through a materials detail, a list and a top-level route", { skip: !preview }, async () => {
  await withPage("/software", async ({ read, send, waitFor, assertLocation }) => {
    for (const path of ["/learning", "/learning/project-checklist"]) {
      const link = `document.querySelector('a[href=${JSON.stringify(path)}]')`;
      await waitFor(`!!${link}`);
      await read(`${link}.click()`);
      await assertLocation(path);
    }
    for (const path of ["/learning", "/software", "/"]) {
      await pressKey(send, "Escape", 27);
      await assertLocation(path);
    }
    assert.equal(await read("navigation.canGoBack"), false);
    assert.equal(await read(`!window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))`), false);
  });
});

test("global Escape works on the account layout and leaves an active input alone", { skip: !preview }, async () => {
  await withPage("/software", async ({ read, send, waitFor, assertLocation }) => {
    const email = `document.querySelector('main input[type="email"]')`;
    await read(`document.querySelector('header a[href="/account"]').click()`);
    await assertLocation("/account");
    await waitFor(`!!${email}`);
    await read(`${email}.focus()`);
    await pressKey(send, "Escape", 27);
    assert.equal(await read(`location.pathname === '/account' && document.activeElement === ${email}`), true);
    await read(`${email}.blur()`);
    await pressKey(send, "Escape", 27);
    await assertLocation("/software");
  });
});

test("global Escape cancels the keyboard navigation hint before going back", { skip: !preview }, async () => {
  await withPage("/software", async ({ read, send, waitFor, assertLocation }) => {
    await read(`document.querySelector('header a[href="/learning"]').click()`);
    await assertLocation("/learning");
    const hint = "document.querySelector('[data-command-keep] > div')";
    await pressKey(send, "g", 71);
    await waitFor(`!!${hint}`);
    await pressKey(send, "Escape", 27);
    await waitFor(`!${hint}`);
    assert.equal(await read("location.pathname"), "/learning");
    await pressKey(send, "Escape", 27);
    await assertLocation("/software");
  });
});

test("reader Escape follows the previous visits to the chapter, book and shelf", { skip: !preview }, async () => {
  const firstChapter = `${sampleBook}/script-beats`;
  await withPage("/resources", async ({ read, send, waitFor, assertLocation }) => {
    for (const path of [sampleBook, firstChapter, finalChapter]) {
      const link = `document.querySelector('main a[href=${JSON.stringify(path)}]')`;
      await waitFor(`!!${link}`);
      await read(`${link}.click()`);
      await assertLocation(path);
    }
    await waitFor("document.documentElement.dataset.intro !== 'play'");
    for (const path of [firstChapter, sampleBook, "/resources"]) {
      await pressKey(send, "Escape", 27);
      await assertLocation(path);
    }
  });
});

test("reader Escape closes search first and returns to the localized book and shelf for a direct link", { skip: !preview }, async () => {
  await withPage(`/en${finalChapter}`, async ({ read, send, waitFor, assertLocation }) => {
    const palette = "document.querySelector('[role=dialog][aria-modal=true]')";
    await waitFor("document.documentElement.dataset.intro !== 'play'");
    await pressKey(send, "k", 75, 2);
    await waitFor(`!!${palette}?.querySelector('input')`);
    await pressKey(send, "Escape", 27);
    await waitFor(`!${palette}`);
    assert.equal(await read("location.pathname"), `/en${finalChapter}`);

    await pressKey(send, "Escape", 27);
    await assertLocation(`/en${sampleBook}`);
    await pressKey(send, "Escape", 27);
    await assertLocation("/en/resources");
  });
});

test("reader Escape closes the mobile navigation before leaving the chapter", { skip: !preview }, async () => {
  await withPage(finalChapter, async ({ read, send, waitFor, assertLocation }) => {
    const menu = `document.querySelector('button[aria-controls="mobile-menu"]')`;
    await waitFor(`!!${menu}`);
    await read(`${menu}.click()`);
    await waitFor(`${menu}.getAttribute('aria-expanded') === 'true' && !!document.querySelector('main[inert]')`);
    await pressKey(send, "Escape", 27);
    await waitFor(`${menu}.getAttribute('aria-expanded') === 'false' && !document.querySelector('main[inert]')`);
    assert.equal(await read("location.pathname"), finalChapter);
    await pressKey(send, "Escape", 27);
    await assertLocation(sampleBook);
  }, { mobile: true });
});

test("switching languages retains both the original and newly selected post board", { skip: !preview }, async () => {
  await withPage("/community/new?board=tools&tag=one&tag=two", async ({ read, waitFor, changeLocale, assertLocation }) => {
    const board = "document.querySelector('#community-demo-board').value";
    assert.equal(await read(board), "tools");
    await changeLocale("en");
    await assertLocation("/en/community/new?board=tools&tag=one&tag=two");
    await waitFor("document.documentElement?.lang === 'en'");
    assert.equal(await read(board), "tools");
    await read(`(() => {
      const field = document.querySelector('#community-demo-board');
      field.value = 'moments';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await changeLocale("zh");
    await assertLocation("/community/new?board=moments&tag=one&tag=two");
    await waitFor("document.documentElement?.lang === 'zh-CN'");
    assert.equal(await read(board), "moments");
  });
});

test("switching languages retains the targeted blog section and scrolls to it", { skip: !preview }, async () => {
  await withPage("/about#blog", async ({ waitFor, changeLocale, assertLocation }) => {
    await assertLocation("/about#blog");
    for (const [language, path] of [["en", "/en/about#blog"], ["zh", "/about#blog"]]) {
      await waitFor(`document.querySelector('header a[hreflang="${language}"]')?.hash === '#blog'`);
      await changeLocale(language);
      await assertLocation(path);
      await waitFor(`document.documentElement?.lang === '${language === "zh" ? "zh-CN" : "en"}'`);
      await waitFor(`(() => {
        const top = document.getElementById('blog')?.getBoundingClientRect().top;
        return top >= 0 && top < window.innerHeight / 2;
      })()`);
    }
  });
});

for (const [home, innerPage, backToTop] of [["/", "/projects", "回到顶部"], ["/en", "/en/projects", "Back to top"]]) {
  test(`the cooperation banner and footer appear only on the homepage (${home})`, { skip: !preview }, async () => {
    await withPage(home, async ({ read, waitFor, assertLocation }) => {
      const open = async (path) => {
        await read(`document.querySelector('header nav li a[href=${JSON.stringify(path)}]').click()`);
        await assertLocation(path);
      };
      const verifyFooter = async () => {
        await waitFor("!!document.querySelector('main ~ footer [data-contact-banner]')");
        assert.equal(await read("document.querySelectorAll('main ~ footer').length"), 1);
        assert.equal(await read(`document.querySelector('main ~ footer a[href="#top"]').textContent.trim()`), backToTop);
        assert.equal(await read(`!!document.querySelector('main ~ footer a[href=${JSON.stringify(innerPage)}]')`), true);
      };

      await verifyFooter();
      await open(innerPage);
      await waitFor("!document.querySelector('main ~ footer, [data-contact-banner]')");
      await open(home);
      await verifyFooter();
    });
  });
}

async function checkNavigationFromLowerPage(api, selectLink, from, to) {
  const { read, waitFor, assertLocation } = api;
  await assertLocation(from);
  await read("window.scrollTo({ top: 700, behavior: 'instant' })");
  await waitFor("window.scrollY > 200");
  await selectLink(to);
  await assertLocation(to);
  await waitFor("window.scrollY < 2");
}

for (const reducedMotion of [true, false]) {
  test(`desktop header links start a different page or the current page at the top (${reducedMotion ? "reduced motion" : "Lenis"})`,
    { skip: !preview }, async () => {
      await withPage("/about", async (api) => {
        if (!reducedMotion) await api.waitFor("document.documentElement.classList.contains('lenis')");
        const link = (path) => api.read(`document.querySelector('header nav li a[href=${JSON.stringify(path)}]').click()`);
        await checkNavigationFromLowerPage(api, link, "/about", "/about");
        await checkNavigationFromLowerPage(api, link, "/about", "/projects");
      }, { reducedMotion });
    });
}

for (const viewport of [{ width: 1120, height: 640 }, { width: 1920, height: 1080 }]) {
  test(`desktop wheel can reach the bottom after navigating from Contact to About (${viewport.width}×${viewport.height})`,
    { skip: !preview }, async () => {
      await withPage("/contact", async ({ read, send, waitFor, assertLocation }) => {
        const scrollLimit = "document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight";
        await waitFor("document.documentElement.classList.contains('lenis')");
        // Let the initial page and the emulated viewport settle before switching routes.
        await delay(550);
        const previousLimit = await read(scrollLimit);
        const documentStart = await read("performance.timeOrigin");
        await read(`document.querySelector('header nav li a[href="/about"]').click()`);
        await assertLocation("/about");
        await waitFor("!!document.querySelector('main #blog')");
        assert.equal(await read("performance.timeOrigin"), documentStart, "navigation must use the same document");
        assert.equal(await read("window.scrollY"), 0);
        assert.ok(await read(scrollLimit) > previousLimit + 1000, "About needs a substantially longer page");

        const wheel = (deltaY) => send("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: viewport.width * 0.63, y: viewport.height * 0.7, deltaX: 0, deltaY,
        });
        await wheel(previousLimit + 1800);
        await waitFor(`window.scrollY > ${previousLimit + 400}`);
        await wheel(await read(scrollLimit) * 2);
        await waitFor(`window.scrollY >= (${scrollLimit}) - 5`);
      }, { viewport, reducedMotion: false });
    });
}

test("mobile navigation closes the menu and resets scrolling, including from an anchored page", { skip: !preview }, async () => {
  await withPage("/about#blog", async (api) => {
    const link = async (path) => {
      await api.read(`document.querySelector('header button[aria-controls="mobile-menu"]').click()`);
      await api.waitFor(`!!document.querySelector('#mobile-menu nav a[href=${JSON.stringify(path)}]')`);
      await api.read(`document.querySelector('#mobile-menu nav a[href=${JSON.stringify(path)}]').click()`);
      await api.waitFor(`!document.querySelector('#mobile-menu')`);
    };
    await checkNavigationFromLowerPage(api, link, "/about#blog", "/about");
    await api.read("window.history.back()");
    await api.assertLocation("/about#blog");
    await api.waitFor("window.scrollY > 200");
    await api.read("window.history.forward()");
    await api.assertLocation("/about");
    await api.waitFor("window.scrollY < 2");
    await checkNavigationFromLowerPage(api, link, "/about", "/about");
    await checkNavigationFromLowerPage(api, link, "/about", "/resources");
  }, { mobile: true });
});

test("desktop cursor keeps hover labels without displaying pointer coordinates", { skip: !preview }, async () => {
  await withPage("/projects", async ({ read, waitFor }) => {
    const link = "main [data-cursor-text]";
    await waitFor(`!!document.querySelector('.fx-cursor') && !!document.querySelector(${JSON.stringify(link)})`);
    const moveTo = (selector) => read(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      for (const type of ['pointerover', 'pointermove']) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', clientX: 180, clientY: 250 }));
      }
    })()`);
    const chip = "document.querySelector('.fx-cursor-chip')";
    await moveTo("main");
    await waitFor("!!document.querySelector('.fx-cursor[data-visible][data-mode=idle]')");
    await delay(100);
    assert.equal(await read(`${chip}.textContent`), "");
    assert.equal(await read(`getComputedStyle(${chip}).display`), "none");

    const label = await read(`document.querySelector(${JSON.stringify(link)}).dataset.cursorText`);
    assert.ok(label);
    await moveTo(link);
    await waitFor(`${chip}.textContent === ${JSON.stringify(label)}`);
    assert.notEqual(await read(`getComputedStyle(${chip}).display`), "none");

    await moveTo("main");
    await waitFor(`${chip}.textContent === '' && getComputedStyle(${chip}).display === 'none'`);
  }, { reducedMotion: false });
});

test("Beijing theme switches at both boundaries and clears a manual choice", { skip: !preview }, async () => {
  await withPage("/contact", async ({ read, send, waitFor }) => {
    await send("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
    await send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-color-scheme", value: "dark" },
    ] });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: String.raw`
      (() => {
        let now;
        let origin;
        window.testBeijingClock = (iso) => {
          sessionStorage.setItem('theme-browser-test-clock', iso);
          now = Date.parse(iso);
          origin = performance.now();
        };
        window.testBeijingClock(sessionStorage.getItem('theme-browser-test-clock') || '2026-11-25T11:00:00Z');
        Date.now = () => now + Math.floor(performance.now() - origin);
        localStorage.setItem('theme', 'dark');
      })();
    ` });
    const matches = (theme) => "document.documentElement.classList.contains(" + JSON.stringify(theme) + ")" +
      " && document.documentElement.style.colorScheme === " + JSON.stringify(theme);
    const toggle = 'document.querySelector(\'button[aria-label="切换主题"]\')';
    const shift = (instant, event = "focus") => read("window.testBeijingClock(" + JSON.stringify(instant) + "); " +
      "window.dispatchEvent(new Event(" + JSON.stringify(event) + "));");
    const reload = async () => {
      const previousDocument = await read("performance.timeOrigin");
      await send("Page.reload", { ignoreCache: true });
      await waitFor(`performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && !!` + toggle);
    };

    // The inline first-paint script must work with the React bundles blocked.
    await send("Network.enable", {});
    await send("Network.setBlockedURLs", { urls: ["*/_next/static/*.js*"] });
    await reload();
    assert.equal(await read(matches("light")), true);
    await send("Network.setBlockedURLs", { urls: [] });
    await reload();
    await waitFor("typeof window.testBeijingClock === 'function' && " + matches("light"));
    assert.equal(await read("Intl.DateTimeFormat().resolvedOptions().timeZone"), "America/Los_Angeles");

    // No further browser event after focus sets up this timer.
    await shift("2026-11-25T11:59:58.500Z");
    assert.equal(await read(matches("light")), true);
    await waitFor(matches("dark"));

    await shift("2026-11-25T13:00:00Z");
    await read(toggle + ".click()");
    await waitFor(matches("light"));
    await reload();
    await waitFor(matches("light"));
    assert.equal(await read("JSON.parse(localStorage.getItem('sansphase-v3-theme-override')).theme"), "light");

    await read(toggle + ".click()");
    await waitFor(matches("dark"));
    await shift("2026-11-25T21:59:58.500Z");
    assert.equal(await read(matches("dark")), true);
    await waitFor(matches("light"));
    await shift("2026-11-26T12:05:00Z", "pageshow");
    await waitFor(matches("dark"));
  });
});
