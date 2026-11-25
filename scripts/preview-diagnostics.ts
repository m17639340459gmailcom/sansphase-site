// Uses the established synthetic preview; no private settings or production
// databases are read. Binding remains 127.0.0.1 in catalog-fixture-preview.
process.env.LOCAL_DIAGNOSTICS = '1';
process.env.PORT ||= '4252';
await import('./catalog-fixture-preview.mjs');
