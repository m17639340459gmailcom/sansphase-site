export function createDeferredModuleLoader(importModule) {
  let pending;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(importModule).catch((error) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

export const loadAdminReaders = createDeferredModuleLoader(() => import("./admin-readers.mjs"));
