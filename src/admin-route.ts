type DeferredModuleOptions = { timeoutMs?: number };

/** Share a real module import; a failed or stalled attempt must remain retryable. */
export function createDeferredModuleLoader<Module>(importModule: () => Promise<Module>, { timeoutMs = 0 }: DeferredModuleOptions = {}) {
  let pending: Promise<Module> | undefined;
  return (): Promise<Module> => {
    if (!pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const imported = Promise.resolve().then(importModule);
      const ready = timeoutMs > 0 ? Promise.race([imported, new Promise<Module>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Module preparation timed out')), timeoutMs);
      })]) : imported;
      const attempt = ready.finally(() => { clearTimeout(timer); }).catch(error => {
        if (pending === attempt) pending = undefined;
        throw error;
      });
      pending = attempt;
    }
    return pending;
  };
}

export const loadAdminReaders = createDeferredModuleLoader(() => import('./admin-readers.mjs'));
