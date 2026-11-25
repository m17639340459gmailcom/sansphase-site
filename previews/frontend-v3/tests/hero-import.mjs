import { registerHooks } from "node:module";

/**
 * Test support (not a test file): the particle modules use bundler-style
 * extensionless relative imports. Node resolves those to `.ts` once this hook
 * is registered; import the modules dynamically afterwards.
 */
let registered = false;

export function importParticleModule(name) {
  if (!registered) {
    registered = true;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
          }
          throw error;
        }
      },
    });
  }
  return import(new URL(`../src/components/three/${name}.ts`, import.meta.url).href);
}
