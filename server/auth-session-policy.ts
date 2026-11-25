// Fixed lifetime after successful login. Session probes do not renew this
// deadline; logout, account disabling and password recovery can revoke sooner.
export const accountSessionLifetimeSeconds = 7 * 86400;
export const accountSessionLifetimeMs = accountSessionLifetimeSeconds * 1000;
