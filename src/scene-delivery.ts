// One URL mapping shared by the HTML preloader and Three's texture consumers.
// An empty build setting keeps development and self-hosted installations local.
declare const __SANSPHASE_SCENE_CDN_ORIGIN__: string | undefined;
const configuredOrigin =
  typeof __SANSPHASE_SCENE_CDN_ORIGIN__ === "string"
    ? __SANSPHASE_SCENE_CDN_ORIGIN__
    : "";

export function validateSceneCdnOrigin(value: string = ""): string {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "SANSPHASE_SCENE_CDN_ORIGIN must be an HTTPS origin without a path or credentials",
    );
  }
  return url.origin;
}

export function sceneAssetUrl(path: string, origin: string = configuredOrigin): string {
  if (!origin || !/^\.?\/assets\/scene\/[\w.-]+\.jpg$/.test(path)) return path;
  return origin + "/" + path.replace(/^\.?\//, "");
}

export function staticAssetUrl(
  path: string,
  base: string = globalThis.document?.documentElement?.dataset.staticBase || "",
): string {
  const relative = path.replace(/^\.?\//, "");
  if (!base || relative.includes("..") || !/^(?:[\w.-]+\.(?:m?js|css)(?:\?|$)|chunks\/[\w.-]+\.mjs$|assets\/(?:materials|fonts)\/[\w.-]+$|assets\/plyr\.svg$)/.test(relative)) return path;
  return base + relative;
}
