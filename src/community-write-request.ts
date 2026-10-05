type Options = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  identity: () => string | null;
  storage?: () => Storage | null;
};
type PendingWrite = { id: string; path: string; hash: string; key: string; uncertain: boolean };

const storageKey = 'sansphase-community-pending-writes-v1';
const maxEntries = 32;
const protectedPath = (path: string) => path === 'shop/redeem' || path === 'topics'
  || /^(?:topics\/[^/?#]+\/(?:replies|thank)|replies\/[^/?#]+\/thank)$/.test(path);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validIdentity = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/.test(id);
const tokenOf = (path: string, hash: string) => `${path}\0${hash}`;
const failure = (message: string) => Object.assign(new Error(message), { status: 409 });

function validEntry(value: unknown): value is PendingWrite {
  return object(value) && Object.keys(value).length === 5 && validIdentity(value.id)
    && typeof value.path === 'string' && value.path.length <= 200 && protectedPath(value.path)
    && typeof value.hash === 'string' && /^[0-9a-f]{64}$/.test(value.hash)
    && typeof value.key === 'string' && uuid.test(value.key) && typeof value.uncertain === 'boolean';
}

/** Keys protect retries of an unresolved write, and confirmed success ends that intent. */
export function createCommunityWriteRequest(options: Options) {
  const pending = new Map<string, PendingWrite>();
  const inFlight = new Map<string, Promise<unknown>>();
  let activeIdentity: string | null | undefined;
  let epoch = 0;
  const storage = () => {
    try { return options.storage ? options.storage() : globalThis.sessionStorage ?? null; }
    catch { return null; }
  };
  const persist = () => {
    try {
      const store = storage();
      // A reload can lose the response before a catch handler runs. Persist
      // in-flight writes as uncertain even while their current attempt awaits.
      const entries = [...pending.values()].map(entry => ({ ...entry, uncertain: entry.uncertain || inFlight.has(tokenOf(entry.path, entry.hash)) }));
      if (entries.length) store?.setItem(storageKey, JSON.stringify({ version: 1, entries }));
      else store?.removeItem(storageKey);
    } catch { /* An unavailable store never disables the in-memory protection. */ }
  };
  const restore = (id: string | null) => {
    try {
      const raw = storage()?.getItem(storageKey);
      if (!raw || raw.length > 32768) return;
      const value: unknown = JSON.parse(raw);
      if (!object(value) || value.version !== 1 || Object.keys(value).length !== 2
        || !Array.isArray(value.entries) || value.entries.length > maxEntries) return;
      const entries: unknown[] = value.entries;
      for (const entry of entries) if (validEntry(entry) && entry.id === id)
        pending.set(tokenOf(entry.path, entry.hash), { ...entry });
    } catch { /* Corrupt metadata cannot become a trusted request key. */ }
  };
  const currentIdentity = () => {
    const value = options.identity();
    const id = validIdentity(value) ? value : null;
    if (activeIdentity === undefined) { activeIdentity = id; restore(id); persist(); }
    else if (activeIdentity !== id) {
      epoch++; activeIdentity = id; pending.clear(); inFlight.clear(); persist();
    }
    return id;
  };
  const clear = () => { epoch++; activeIdentity = undefined; pending.clear(); inFlight.clear(); persist(); };

  async function send<T>(path: string, body: unknown = {}): Promise<T> {
    const json = JSON.stringify(body);
    if (typeof json !== 'string') throw failure('提交内容不正确，请检查后重试。');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Reader-Request': '1' };
    if (!protectedPath(path)) return options.request<T>(path, { method: 'POST', headers, body: json });
    if (path.length > 200) throw failure('提交地址不正确，请重新打开内容后重试。');
    const id = currentIdentity(), captured = epoch;
    if (!id) throw failure('账号身份尚未确认，请等待登录完成后重试。');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (captured !== epoch || options.identity() !== id) throw failure('账号已切换，请重新确认后提交。');
    const token = tokenOf(path, hash);
    const running = inFlight.get(token);
    if (running) return await running as T;
    let entry = pending.get(token);
    if (!entry) {
      if (pending.size >= maxEntries) throw failure('还有未确认的提交，请先重试原来的操作，确认结果后再提交新的内容。');
      entry = { id, path, hash, key: globalThis.crypto.randomUUID(), uncertain: false };
      pending.set(token, entry);
    }
    headers['X-Idempotency-Key'] = entry.key;
    const selected = entry;
    const stillCurrent = () => captured === epoch && options.identity() === id && pending.get(token) === selected;
    const request: Promise<T> = Promise.resolve().then(() => {
      if (!stillCurrent()) throw failure('账号已切换，请重新确认后提交。');
      return options.request<T>(path, { method: 'POST', headers, body: json });
    }).then(result => {
      if (stillCurrent()) { pending.delete(token); persist(); }
      return result;
    }, (error: unknown) => {
      if (stillCurrent()) {
        const status = object(error) && typeof error.status === 'number' ? error.status : 0;
        if (status >= 400 && status < 500 && status !== 429 && !selected.uncertain) pending.delete(token);
        else {
          if (!(status >= 400 && status < 500)) selected.uncertain = true;
        }
        persist();
      }
      throw error;
    }).finally(() => { if (inFlight.get(token) === request) inFlight.delete(token); });
    inFlight.set(token, request); persist();
    return await request;
  }
  return { send, clear };
}
