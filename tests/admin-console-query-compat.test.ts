import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const adminRequire = createRequire(require.resolve("react-admin"));
const corePath = adminRequire.resolve("ra-core");
const coreRequire = createRequire(corePath);
const materialRequire = createRequire(adminRequire.resolve("ra-ui-materialui"));
const queryPath = coreRequire.resolve("query-string");
const listParamsPath = resolve(
  dirname(corePath),
  "controller/list/useListParams.js",
);

test(
  "both React-admin consumers resolve the patched upstream query-string and safe decoder",
  { timeout: 10000 },
  async () => {
    for (const consumer of [coreRequire, materialRequire]) {
      const path = consumer.resolve("query-string");
      assert.equal(
        JSON.parse(
          await readFile(resolve(dirname(path), "package.json"), "utf8"),
        ).version,
        "9.5.1",
      );
      const query = await import(pathToFileURL(path).href);
      assert.equal(typeof query.parse, "function");
      assert.equal(
        query.default.parse,
        query.parse,
        "named exports reuse the original upstream functions",
      );
      assert.equal(query.default.stringify, query.stringify);
      assert.equal(
        typeof consumer("query-string").parse,
        "function",
        "Node 24 CJS consumers remain compatible",
      );
      const decoderPath = createRequire(path).resolve("decode-uri-component");
      assert.equal(
        JSON.parse(
          await readFile(resolve(dirname(decoderPath), "package.json"), "utf8"),
        ).version,
        "0.5.0",
      );
    }
  },
);

test(
  "real React-admin URL parser preserves five routing cases in a browser bundle and Node",
  { timeout: 15000 },
  async () => {
    const { parseQueryFromLocation } = await import(
      pathToFileURL(listParamsPath).href
    );
    const query = await import(pathToFileURL(queryPath).href);
    const filter = { q: "读者 + VIP & %", status: "active", membership: "vip" };
    const encoded = query.stringify({
      page: 2,
      perPage: 20,
      sort: "createdAt",
      order: "DESC",
      filter: JSON.stringify(filter),
      displayedFilters: JSON.stringify({ q: true }),
    });
    const cases = [
      {
        search: "?" + encoded,
        expected: {
          displayedFilters: { q: true },
          filter,
          order: "DESC",
          page: "2",
          perPage: "20",
          sort: "createdAt",
        },
      },
      {
        search: "?tag=a&tag=b&q=a%2Bb+c",
        expected: { tag: ["a", "b"], q: "a+b c" },
      },
      {
        search: "?empty=&flag&page=1",
        expected: { empty: "", flag: null, page: "1" },
      },
      {
        search: "?filter=not-json&displayedFilters=%7Bbad%7D&q=%E0%A4%A",
        expected: { q: "%E0%A4%A" },
      },
      {
        search: "?__proto__=polluted&constructor=x&q=%E8%AF%BB%E8%80%85",
        expected: { ["__proto__"]: "polluted", constructor: "x", q: "读者" },
      },
    ];
    const entry = `import {parseQueryFromLocation} from ${JSON.stringify(listParamsPath)};
    import {parse,stringify,parseUrl,stringifyUrl} from ${JSON.stringify(queryPath)};
    globalThis.queryCompat={parseQueryFromLocation,parse,stringify,parseUrl,stringifyUrl};`;
    // Resolves the installed production dependency tree; no test-only alias can hide an incompatible override.
    const built = await build({
      stdin: {
        contents: entry,
        resolveDir: process.cwd(),
        sourcefile: "admin-query-compat.js",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "es2022",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const context = vm.createContext({ URL, URLSearchParams });
    vm.runInContext(built.outputFiles[0].text, context, { timeout: 2000 });
    for (const sample of cases) {
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(parseQueryFromLocation({ search: sample.search })),
        ),
        sample.expected,
      );
      const result = vm.runInContext(
        `JSON.stringify(queryCompat.parseQueryFromLocation({search:${JSON.stringify(sample.search)}}))`,
        context,
        { timeout: 2000 },
      );
      assert.deepEqual(JSON.parse(result), sample.expected);
    }
    assert.equal(Object.prototype.hasOwnProperty.call({}, "polluted"), false);
    assert.deepEqual(query.parseUrl("/readers?page=2#profile"), {
      url: "/readers",
      query: Object.assign(Object.create(null), { page: "2" }),
    });
    assert.equal(
      query.stringifyUrl({ url: "/readers?old=1", query: { page: 2 } }),
      "/readers?old=1&page=2",
    );

    // A VM execution deadline prevents a vulnerable regression from hanging the entire test runner.
    const result = vm.runInContext(
      `(() => {
    const input = '%ab'.repeat(100000);
    const parsed = queryCompat.parseQueryFromLocation({search:'?q='+input});
    return parsed.q === input && parsed.q.length === 300000;
  })()`,
      context,
      { timeout: 2000 },
    );
    assert.equal(
      result,
      true,
      "malformed percent-encoded input remains bounded and lossless",
    );
  },
);
