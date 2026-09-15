import { sceneAssetUrl } from "./scene-delivery.mjs";

// This module is built as a tiny classic script so downloads begin while HTML
// is parsed, before the renderer's larger module graph has finished loading.
if (!location.hash || /^#\/?(?:home)?\/?$/.test(location.hash)) {
  const urls = __SANSPHASE_SCENE_IMAGES__.map((path) => sceneAssetUrl(path));
  for (const [index, href] of urls.entries()) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.setAttribute("as", "image");
    link.crossOrigin = "anonymous";
    link.fetchPriority = index === 0 ? "high" : "low";
    link.href = href;
    document.head.append(link);
  }
  const module = document.createElement("link");
  module.rel = "modulepreload";
  module.href = "./cosmos.bundle.mjs";
  document.head.append(module);
}
