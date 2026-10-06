import { JWTAuthentication } from 'payload';
import type { Payload, TypedUser } from 'payload';

// Payload's public JWT strategy correctly verifies signatures, expiration and
// persisted session IDs, but treats every findByID error as a missing user.
// The bridge reuses that strategy with a read-only delegate which preserves
// unexpected lookup errors; original Payload and ordinary auth are unchanged.
export async function strictPayloadIdentity(payload: Payload, token: string | undefined): Promise<TypedUser | null> {
  if (!token) return null;
  let lookupFailed = false, lookupError: unknown;
  const probe = Object.create(payload) as Payload;
  Object.defineProperty(probe, 'findByID', { value: async (options: Parameters<Payload['findByID']>[0]) => {
    try { return await payload.findByID(options); }
    catch (error) { lookupFailed = true; lookupError = error; throw error; }
  } });
  const result = await JWTAuthentication({ payload: probe, headers: new Headers({ Authorization: `JWT ${token}`, DisableAutologin: 'true' }), strategyName: 'local-jwt' });
  if (lookupFailed) {
    const status = lookupError && typeof lookupError === 'object' && 'status' in lookupError ? lookupError.status : undefined;
    // Only this exact user lookup's explicit rejection or absence means the
    // original account/session is gone. Other storage faults remain errors.
    if (![401, 403, 404].includes(typeof status === 'number' ? status : 0)) throw lookupError;
    return null;
  }
  return result.user || null;
}
