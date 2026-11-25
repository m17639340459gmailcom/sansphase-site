import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import { evaluateInWebGLBrowser } from "./helpers/webgl-browser.mjs";

test(
  "reader detail preserves UID/deletion drafts on errors and only closes after confirmed deletion",
  {
    skip: process.env.ADMIN_CONSOLE_BROWSER !== "1",
    timeout: 60_000,
  },
  async () => {
    const bundle = await build({
      stdin: {
        resolveDir: resolve("."),
        loader: "tsx",
        contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';
    import {CoreAdminContext,memoryStore} from 'react-admin';
    import {ReaderDialog} from './src/admin-console/readers.tsx';
    import {createAdminConsoleDataProvider} from './src/admin-console/data-provider.ts';
    window.mountReaderFixture=(reader)=>createRoot(document.querySelector('#root')).render(
      <MemoryRouter><CoreAdminContext store={memoryStore()} dataProvider={createAdminConsoleDataProvider()}>
        <ReaderDialog selected={reader} onClose={()=>{window.extrasClosed=true;document.querySelector('#root').dataset.closed='true';}}/>
      </CoreAdminContext></MemoryRouter>);`,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const inspect = async (code) => {
      const scriptErrors = [];
      window.addEventListener("error", (event) =>
        scriptErrors.push(event.message),
      );
      const reader = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        uid: "10009",
        nickname: "测试读者",
        remark: "仅作者备注",
        email: "reader@example.test",
        phone: "",
        verified: true,
        disabled: false,
        createdAt: "2026-10-01T00:00:00Z",
        lastLoginIp: null,
        lastLoginAt: null,
        vip: false,
        vipStartedAt: null,
        vipUntil: null,
      };
      const requests = [];
      let historyFail = true,
        uidFail = true,
        deleteFail = true,
        finishDelete;
      window.fetch = async (url, options = {}) => {
        requests.push({ url, method: options.method, body: options.body });
        if (url.endsWith("/logins"))
          return historyFail
            ? Response.json({ error: "登录记录暂不可用" }, { status: 503 })
            : Response.json({
                events: [
                  {
                    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    at: "2026-10-12T01:00:00Z",
                    ip: "192.0.2.8",
                    peerIp: "127.0.0.1",
                    source: "forwarded",
                    userAgent: "Example browser",
                  },
                ],
              });
        if (url.endsWith("/uid"))
          return uidFail
            ? Response.json({ error: "UID 已被使用。" }, { status: 409 })
            : Response.json({ ...reader, uid: "34567" });
        if (url.endsWith("/delete"))
          return deleteFail
            ? Response.json({ error: "删除暂时失败" }, { status: 503 })
            : await new Promise((resolve) => {
                finishDelete = resolve;
              });
        throw Error("Unexpected request");
      };
      document.body.innerHTML = '<div id="root"></div>';
      new Function(code)();
      window.mountReaderFixture(reader);
      const wait = async (fn) => {
        for (let i = 0; i < 120; i++) {
          if (fn()) return;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        throw Error(
          "UI wait timed out: " +
            JSON.stringify({
              errors: scriptErrors,
              text: document.body.textContent.slice(0, 600),
              requests,
            }),
        );
      };
      const button = (text) =>
        [...document.querySelectorAll("button")].find(
          (el) => el.textContent === text,
        );
      const click = (text) => {
        const el = button(text);
        if (!el) throw Error("Missing button: " + text);
        el.click();
      };
      const enter = async (name, value) => {
        const el = document.querySelector('input[name="' + name + '"]');
        if (!el) throw Error("Missing input: " + name);
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      await wait(() => document.body.textContent.includes("登录记录暂不可用"));
      historyFail = false;
      click("重试登录记录");
      await wait(() => document.body.textContent.includes("192.0.2.8"));
      click("修改 UID");
      await wait(() => document.querySelector('input[name="readerUid"]'));
      await enter("readerUid", "0000");
      const invalidUidBlocked = button("保存 UID").disabled;
      await enter("readerUid", "34567");
      click("保存 UID");
      await wait(() => document.body.textContent.includes("UID 已被使用。"));
      const uidDraftPreserved =
        document.querySelector('input[name="readerUid"]').value === "34567";
      uidFail = false;
      click("保存 UID");
      await wait(() => !document.querySelector('input[name="readerUid"]'));
      const uidAndRemark =
        document
          .querySelector('[role="dialog"]')
          .textContent.includes("UID 34567") &&
        document.body.textContent.includes(reader.remark);
      click("永久删除账号");
      await wait(() => document.querySelector('input[name="confirmEmail"]'));
      const before = requests.length;
      await enter("confirmEmail", "wrong@example.test");
      const wrongEmailBlocked = button("确认永久删除").disabled;
      click("确认永久删除");
      const noWrongRequest = before === requests.length;
      await enter("confirmEmail", "READER@example.test");
      click("确认永久删除");
      await wait(() => document.body.textContent.includes("删除暂时失败"));
      const emailDraftPreserved =
        document.querySelector('input[name="confirmEmail"]').value ===
          "READER@example.test" && !window.extrasClosed;
      deleteFail = false;
      click("确认永久删除");
      await wait(() => Boolean(finishDelete));
      const during = requests.length;
      click("正在保存…");
      const waitsForServer =
        !window.extrasClosed &&
        button("返回详情").disabled &&
        requests.length === during;
      finishDelete(
        Response.json({ id: reader.id, uid: "34567", deleted: true }),
      );
      await wait(() => window.extrasClosed);
      return {
        invalidUidBlocked,
        uidDraftPreserved,
        uidAndRemark,
        wrongEmailBlocked,
        noWrongRequest,
        emailDraftPreserved,
        waitsForServer,
        closed: window.extrasClosed,
        privateRemarkNotSent: requests
          .filter((req) => /\/(uid|delete)$/.test(req.url))
          .every((req) => !req.body.includes(reader.remark)),
      };
    };
    const result = await evaluateInWebGLBrowser(
      process.env.TEST_BROWSER_PATH ||
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      `(${inspect.toString()})(${JSON.stringify(bundle.outputFiles[0].text)})`,
    );
    assert.deepEqual(result, {
      invalidUidBlocked: true,
      uidDraftPreserved: true,
      uidAndRemark: true,
      wrongEmailBlocked: true,
      noWrongRequest: true,
      emailDraftPreserved: true,
      waitsForServer: true,
      closed: true,
      privateRemarkNotSent: true,
    });
  },
);

test(
  "real isolated account commands keep remarks through UID changes and refresh the list after deletion",
  {
    skip: process.env.ADMIN_CONSOLE_BROWSER !== "1",
    timeout: 90_000,
  },
  async () => {
    const { createAdminConsolePreview } =
      await import("../scripts/preview-admin-console.ts");
    const preview = await createAdminConsolePreview({ port: 0 });
    try {
      const inspect = async () => {
        const wait = async (fn) => {
          for (let i = 0; i < 150; i++) {
            if (fn()) return;
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
          throw Error("Account UI wait timed out");
        };
        const click = (text) => {
          const button = [...document.querySelectorAll("button")].find(
            (el) => el.textContent === text,
          );
          if (!button) throw Error("Missing button: " + text);
          button.click();
          return button;
        };
        const enter = async (selector, value) => {
          const el = document.querySelector(selector);
          if (!el) throw Error("Missing input: " + selector);
          Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype,
            "value",
          ).set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        };
        const nativeFetch = window.fetch.bind(window),
          requests = window.readerTestRequests;
        click("查看用户");
        await wait(() => document.querySelector('[role="dialog"]'));
        await wait(() =>
          document.body.textContent.includes("尚无成功登录记录"),
        );
        const email = [...document.querySelectorAll("dt")].find(
          (el) => el.textContent === "邮箱",
        ).nextElementSibling.textContent;
        const remark = "UID 修改后必须保留的私有备注";
        click("编辑备注");
        await wait(() =>
          document.querySelector('textarea[name="readerRemark"]'),
        );
        await enter('textarea[name="readerRemark"]', remark);
        click("保存备注");
        await wait(
          () => !document.querySelector('textarea[name="readerRemark"]'),
        );
        click("修改 UID");
        await wait(() => document.querySelector('input[name="readerUid"]'));
        await enter('input[name="readerUid"]', "987654321");
        click("保存 UID");
        await wait(() => !document.querySelector('input[name="readerUid"]'));
        const remarkPreserved = document
          .querySelector('[role="dialog"]')
          .textContent.includes(remark);
        const uidShown = document
          .querySelector('[role="dialog"]')
          .textContent.includes("UID 987654321");
        click("关闭详情");
        await wait(() => !document.querySelector('[role="dialog"]'));
        await enter('input[name="q"]', "UID 987654321");
        await wait(
          () =>
            document.querySelectorAll('[data-testid="reader-table"] tbody tr')
              .length === 1,
        );
        click("查看用户");
        await wait(() => document.querySelector('[role="dialog"]'));
        const remarkAfterReload = document
          .querySelector('[role="dialog"]')
          .textContent.includes(remark);
        click("永久删除账号");
        await wait(() => document.querySelector('input[name="confirmEmail"]'));
        await enter('input[name="confirmEmail"]', "wrong@example.test");
        const before = requests.length,
          confirm = click("确认永久删除");
        const blockedWrongEmail =
          confirm.disabled && requests.length === before;
        await enter('input[name="confirmEmail"]', email);
        const sent = click("确认永久删除");
        sent.click();
        await wait(() => !document.querySelector('[role="dialog"]'));
        await wait(
          () =>
            !document.querySelector('[data-testid="reader-table"] tbody tr'),
        );
        const result = await nativeFetch(
          "/api/manage/readers?q=UID+987654321&status=all&membership=all&page=1",
        ).then((response) => response.json());
        return {
          emptyHistory: true,
          uidShown,
          remarkPreserved,
          remarkAfterReload,
          blockedWrongEmail,
          deletionRequests: requests.filter(
            (req) => req.method === "POST" && req.url.endsWith("/delete"),
          ).length,
          dialogClosed: !document.querySelector('[role="dialog"]'),
          listRefreshed: !document.querySelector(
            '[data-testid="reader-table"] tbody tr',
          ),
          accountDeleted: result.users.length === 0,
        };
      };
      const result = await evaluateInWebGLBrowser(
        process.env.TEST_BROWSER_PATH ||
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        `(${inspect.toString()})()`,
        preview.origin + "/preview-login",
        async (socket) => {
          let nextId = 1400;
          const call = (method, params = {}) =>
            new Promise((resolveCall, reject) => {
              const id = nextId++;
              const receive = (event) => {
                const message = JSON.parse(event.data);
                if (message.id !== id) return;
                socket.removeEventListener("message", receive);
                if (message.error || message.result?.exceptionDetails)
                  reject(
                    Error(
                      JSON.stringify(
                        message.error || message.result.exceptionDetails,
                      ),
                    ),
                  );
                else resolveCall(message.result);
              };
              socket.addEventListener("message", receive);
              socket.send(JSON.stringify({ id, method, params }));
            });
          await call("Runtime.evaluate", {
            expression: `(async()=>{const r=await fetch('/api/author/login',{method:'POST',headers:{'Content-Type':'application/json','X-Author-Request':'1'},body:JSON.stringify({email:'owner@example.test',password:'DemoLogin2026!'})});if(!r.ok)throw Error('Synthetic owner login failed');})()`,
            awaitPromise: true,
          });
          await call("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 960,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await call("Page.addScriptToEvaluateOnNewDocument", {
            source: `window.readerTestRequests=[];const original=window.fetch.bind(window);window.fetch=(url,options={})=>{window.readerTestRequests.push({url:String(url),method:options.method||'GET'});return original(url,options);};`,
          });
          await call("Page.navigate", {
            url: preview.origin + "/admin-console/#/readers",
          });
          for (let i = 0; i < 120; i++) {
            try {
              if (
                (
                  await call("Runtime.evaluate", {
                    expression: `!!document.querySelector('[data-testid="reader-table"] tbody tr')`,
                    returnByValue: true,
                  })
                ).result.value
              )
                return;
            } catch {}
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
          }
          throw Error("Isolated console did not render");
        },
      );
      assert.deepEqual(result, {
        emptyHistory: true,
        uidShown: true,
        remarkPreserved: true,
        remarkAfterReload: true,
        blockedWrongEmail: true,
        deletionRequests: 1,
        dialogClosed: true,
        listRefreshed: true,
        accountDeleted: true,
      });
    } finally {
      await preview.close();
    }
  },
);
