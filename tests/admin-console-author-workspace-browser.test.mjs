import test from "node:test";
import assert from "node:assert/strict";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";

test(
  "redesigned admin collapses navigation to icons and hosts the original author editor",
  { skip: process.env.ADMIN_CONSOLE_BROWSER !== "1", timeout: 90000 },
  async (t) => {
    const preview = await createAdminConsolePreview({ port: 0, redesign: true });
    t.after(preview.close);
    const errors = [];
    const result = await evaluateInWebGLBrowser(
      process.env.TEST_BROWSER_PATH ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "window.authorWorkspaceTest",
      "about:blank",
      async (socket) => {
        let id = 1100;
        const call = (method, params = {}) =>
          new Promise((resolve, reject) => {
            const current = id++;
            const receive = (event) => {
              const response = JSON.parse(event.data);
              if (response.id !== current) return;
              socket.removeEventListener("message", receive);
              if (response.error || response.result?.exceptionDetails)
                reject(Error(JSON.stringify(response)));
              else resolve(response.result);
            };
            socket.addEventListener("message", receive);
            socket.send(JSON.stringify({ id: current, method, params }));
          });
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          if (message.method === "Runtime.exceptionThrown")
            errors.push(message.params.exceptionDetails.text);
        });
        const evaluate = async (expression) =>
          (await call("Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: true,
          })).result.value;
        const wait = async (expression, description) => {
          for (let attempt = 0; attempt < 90; attempt++) {
            try { if (await evaluate(expression)) return; } catch {}
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          throw Error(description + ": " + await evaluate("location.href + ' ' + document.body.innerText.slice(-600)"));
        };
        await call("Runtime.enable");
        await call("Emulation.setDeviceMetricsOverride", {
          width: 1440, height: 960, deviceScaleFactor: 1, mobile: false,
        });
        await call("Page.navigate", { url: preview.origin + "/preview-login" });
        await wait("!!document.querySelector('#login button') && document.readyState === 'complete'", "demo login loads");
        await evaluate("document.querySelector('#login button').click()");
        const authorLink = 'a[href="#/author-panel"]';
        const shell = '[data-author-host="admin-console"] #author-dialog';
        const hub = shell + " .author-hub-heading";
        const title = shell + ' input[name="title"]';
        const editor = shell + " .tiptap";
        const discard = shell + " .author-discard:not([hidden])";
        const readersLink = 'a[href="#/readers"]';
        const sidebarToggle = "header .RaAppBar-menuButton";
        const sidebar = ".RaSidebar-docked";
        const query = (selector) => "document.querySelector(" + JSON.stringify(selector) + ")";
        const click = (selector) => evaluate(query(selector) + ".click()");
        const setTitle = (value) => evaluate(`(() => {
          const input = ${query(title)};
          input.value = ${JSON.stringify(value)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);

        await wait("!!" + query(authorLink), "management overview loaded");
        await wait("!!" + query(sidebar + " " + readersLink), "user navigation is available");
        const sidebarLink = sidebar + " " + readersLink;
        const sidebarLabel = sidebarLink + " .MuiTypography-root";
        assert.equal(await evaluate(query(sidebarLabel) + ".textContent"), "用户");
        assert.ok(await evaluate(query(sidebarLabel) + ".getBoundingClientRect().width") > 20);

        await click(sidebarToggle);
        await wait("!!" + query(sidebar + ".RaSidebar-closed"), "desktop sidebar collapses");
        await wait(`Math.abs(${query(sidebar)}.getBoundingClientRect().width - 58) < 0.1`, "collapsed rail settles at its theme width");
        assert.deepEqual(await evaluate(`(() => {
          const menu = ${query(sidebar + " .RaMenu-closed")};
          const frame = ${query(sidebar + " .RaSidebar-fixed")};
          const links = [...menu.querySelectorAll("a")];
          return {
            linkCount: links.length,
            textClippedVisually: links.every(link => {
              const text = link.querySelector(".MuiTypography-root");
              return getComputedStyle(text).position === "absolute" &&
                text.getBoundingClientRect().width <= 1;
            }),
            iconsCentered: links.every(link => {
              const item = link.getBoundingClientRect();
              const icon = link.querySelector("svg").getBoundingClientRect();
              return Math.abs(item.left + item.width / 2 - icon.left - icon.width / 2) < 1;
            }),
            groupHeadingsHidden: [...menu.querySelectorAll(".MuiTypography-overline")].every(
              heading => !heading.getClientRects().length
            ),
            noteHidden: ![...frame.querySelectorAll(".MuiTypography-caption")].some(
              note => note.getClientRects().length
            ),
            horizontalOverflow: frame.scrollWidth > frame.clientWidth,
          };
        })()`), {
          linkCount: 7,
          textClippedVisually: true,
          iconsCentered: true,
          groupHeadingsHidden: true,
          noteHidden: true,
          horizontalOverflow: false,
        });
        const { root: sidebarDocument } = await call("DOM.getDocument");
        const { nodeId } = await call("DOM.querySelector", {
          nodeId: sidebarDocument.nodeId, selector: sidebarLink,
        });
        const { nodes: [readerAccessibility] } = await call("Accessibility.getPartialAXTree", {
          nodeId, fetchRelatives: false,
        });
        assert.equal(readerAccessibility.name.value, "用户");
        await click(sidebarToggle);
        await wait("!!" + query(sidebar + ".RaSidebar-open"), "desktop sidebar expands again");
        await wait(query(sidebarLabel) + ".getBoundingClientRect().width > 20", "expanded desktop sidebar shows its labels");

        await evaluate("(window.authorWorkspaceDocument = document, true)");
        await click(authorLink);
        await wait("!!" + query(hub), "author hub appears inside the redesigned console");
        assert.deepEqual(await evaluate(`({
          sameDocument: document === window.authorWorkspaceDocument,
          path: location.pathname,
          route: location.hash,
          modal: document.body.classList.contains("dialog-open"),
          sidebarVisible: ${query(readersLink)}?.getBoundingClientRect().width > 0,
          duplicateAdmin: !!${query(shell + ' [data-author-open=admin]')},
        })`), {
          sameDocument: true,
          path: "/admin-console/",
          route: "#/author-panel",
          modal: false,
          sidebarVisible: true,
          duplicateAdmin: false,
        });

        await click(shell + ' [data-author-open="articles"]');
        await wait("!!" + query(shell + " .author-item-list [data-edit]"), "existing articles load");
        await evaluate(`[...document.querySelectorAll(${JSON.stringify(shell + " .author-item-list [data-edit]")})]
          .find(item => item.querySelector("small")?.textContent === "草稿").click()`);
        await wait("!!" + query(editor), "existing Tiptap editor mounts");

        const editorFrame = shell + " .author-editor-wrap";
        const formattingOptions = editorFrame + " .author-text-options > summary";
        const themeToggle = 'header button[aria-label="切换明暗主题"]';
        const editorBorder = `getComputedStyle(${query(editorFrame)}).borderTopColor`;
        const themeMode = `getComputedStyle(${query(editorFrame)}).colorScheme`;
        for (const mode of ["light", "dark"]) {
          if (await evaluate(themeMode) !== mode) await click(themeToggle);
          await wait(`${themeMode} === ${JSON.stringify(mode)}`, `${mode} editor theme is active`);
          await evaluate(query(title) + ".focus()");
          const restingBorder = await evaluate(editorBorder);
          await evaluate(query(formattingOptions) + ".focus()");
          await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await wait(`document.activeElement === ${query(editor)} && document.activeElement.matches(":focus-visible")`, `${mode} editor takes keyboard focus`);
          assert.notEqual(await evaluate(editorBorder), restingBorder, `${mode} editor frame highlights the existing border`);
          assert.deepEqual(await evaluate(`(() => {
            const body = getComputedStyle(${query(editor)});
            const frame = getComputedStyle(${query(editorFrame)});
            return [body.outlineStyle, body.boxShadow, frame.outlineStyle, frame.boxShadow];
          })()`), ["none", "none", "none", "none"], `${mode} editor focus has no second outline or shadow`);
          await evaluate(query(title) + ".focus()");
          assert.equal(await evaluate(editorBorder), restingBorder, `${mode} editor frame restores the resting border`);
        }

        const savedTitle = "本地作者工作台保存验证";
        const unsavedTitle = "本地未保存修改";
        await setTitle(savedTitle);
        await click(shell + " [data-save]");
        await wait(query(shell + " .author-feedback") + '?.textContent.includes("草稿已保存")', "article draft saves");
        await setTitle(unsavedTitle);
        await click(readersLink);
        await wait("!!" + query(discard), "changing sidebar route opens the unsaved-changes warning");
        assert.equal(await evaluate("location.hash"), "#/author-panel");
        await click(discard + " [data-keep-editing]");
        await wait("!" + query(discard), "continue editing closes the warning");
        assert.equal(await evaluate(query(title) + ".value"), unsavedTitle);
        await click(readersLink);
        await wait("!!" + query(discard), "unsaved changes are still guarded");
        await click(discard + " [data-discard]");
        await wait(`location.hash === "#/readers" && !!${query('[data-testid="reader-table"] tbody tr')}`, "discard returns to user management inside the same document");
        assert.equal(await evaluate("document === window.authorWorkspaceDocument"), true);

        await click(authorLink);
        await wait("!!" + query(hub), "author hub reopens");
        await click(shell + ' [data-author-open="articles"]');
        await wait("!!" + query(shell + " .author-item-list [data-edit]"), "article list reloads");
        assert.equal(await evaluate(query(shell + " .author-item-list") + ".textContent.includes(" + JSON.stringify(savedTitle) + ")"), true);
        assert.equal(await evaluate(query(shell + " .author-item-list") + ".textContent.includes(" + JSON.stringify(unsavedTitle) + ")"), false);

        await click(sidebarToggle);
        await wait("!!" + query(sidebar + ".RaSidebar-closed"), "desktop sidebar closes before resizing");
        await call("Emulation.setDeviceMetricsOverride", {
          width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
        });
        await wait("!" + query(sidebar), "phone viewport uses a temporary drawer");
        await click(sidebarToggle);
        const mobileLabel = ".RaSidebar-modal " + readersLink + " .MuiTypography-root";
        await wait(`${query(mobileLabel)}?.getBoundingClientRect().width > 20`, "open phone drawer shows navigation labels");
        assert.equal(await evaluate(query(mobileLabel) + ".textContent"), "用户");
        await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await wait("!" + query(".RaSidebar-modal"), "phone drawer closes with Escape");
        await click(shell + " .author-item-list [data-edit]");
        await wait("!!" + query(editor), "embedded editor still mounts at phone width");
        await evaluate(`window.authorWorkspaceTest = {
          viewport: innerWidth,
          documentOverflow: document.documentElement.scrollWidth > innerWidth,
          editorOverflow: ${query(shell + " .author-frame")}.getBoundingClientRect().right > innerWidth + 1,
        };`);
      },
    );
    assert.deepEqual(result, { viewport: 390, documentOverflow: false, editorOverflow: false });
    assert.deepEqual(errors, []);
  },
);
