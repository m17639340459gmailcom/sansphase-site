import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, lstatSync, openSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientAddress } from './client-ip.ts';
import type { createReaderWorkflow } from './reader-workflow.ts';

export type LoginNamespace = 'reader' | 'author';
export type LoginVerificationSettings = { enabled: true; engine: 'tianai'; serviceOrigin: string; serviceSecret: string; hmacSecret: string; keySecret: string };
type SliderImages = { id: string; type: 'SLIDER'; backgroundImage: string; templateImage: string; backgroundImageWidth: number; backgroundImageHeight: number; templateImageWidth: number; templateImageHeight: number };
export type LoginChallengeResult = { enabled: false } | { enabled: true; engine: 'slider'; challenge: SliderImages & { token: string; expiresAt: number } };
export type LoginVerification = {
  issue(req: IncomingMessage, res: ServerResponse, namespace: LoginNamespace): Promise<LoginChallengeResult>;
  match(req: IncomingMessage, namespace: LoginNamespace, body: unknown): Promise<{ proof: string; expiresAt: number }>;
  verify(req: IncomingMessage, namespace: LoginNamespace): Promise<void>;
};
type Options = { directory: string; siteOrigin: string; settings: LoginVerificationSettings | null;
  workflow: Pick<ReturnType<typeof createReaderWorkflow>, 'consumeAuthLimits'>; now?: () => number; engineRequest?: typeof fetch };
type SignedToken = { v: 1; id: string; nonce: string; purpose: 'slider-challenge' | 'login-proof'; namespace: LoginNamespace; origin: string; binding: string; issuedAt: number; expiresAt: number };
type Track = { bgImageWidth: number; bgImageHeight: number; templateImageWidth: number; templateImageHeight: number; startTime: number; stopTime: number; left: number; top: number; trackList: {x: number; y: number; t: number; type: 'DOWN' | 'MOVE' | 'UP'}[] };
export const loginVerificationLifetimeMs = 120_000;
const proofLifetimeMs = 90_000;
const nonceCookie = 'sansphase_login_verification_nonce';
const hex = (length: number) => new RegExp(`^[0-9a-f]{${length}}$`);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string, status = 403) => Object.assign(Error(message), { status });
const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const idValid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);

export function readLoginVerificationSettings(value: unknown, payloadSecret: string, otherPrivateSecrets: readonly string[] = []): LoginVerificationSettings | null {
  if (value === undefined || object(value) && value.enabled === false && Object.keys(value).length === 1) return null;
  const privateKey = (key: unknown): key is string => typeof key === 'string' && Buffer.byteLength(key) >= 32 && Buffer.byteLength(key) <= 4096 && !/[\u0000-\u001f\u007f]/.test(key);
  if (!object(value) || Object.keys(value).sort().join(',') !== 'enabled,engine,hmacSecret,keySecret,serviceOrigin,serviceSecret'
    || value.enabled !== true || value.engine !== 'tianai' || typeof value.serviceOrigin !== 'string'
    || !privateKey(value.hmacSecret) || !privateKey(value.keySecret) || typeof value.serviceSecret !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(value.serviceSecret))
    throw Error('Slider login verification requires explicit Tianai configuration and three separate private keys.');
  let service: URL;
  try { service = new URL(value.serviceOrigin); } catch { throw Error('Invalid private captcha service origin.'); }
  if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1' || !service.port || service.origin !== value.serviceOrigin || service.username || service.password)
    throw Error('Captcha service must use a literal loopback HTTP origin with an explicit port.');
  const keys = [value.hmacSecret, value.keySecret, value.serviceSecret];
  if (new Set(keys).size !== 3 || keys.some(key => [payloadSecret, ...otherPrivateSecrets].includes(key)))
    throw Error('Captcha service and proof keys must not reuse account or other private keys.');
  return { enabled: true, engine: 'tianai', serviceOrigin: value.serviceOrigin, serviceSecret: value.serviceSecret, hmacSecret: value.hmacSecret, keySecret: value.keySecret };
}

function createReplayStore(directory: string, secret: string) {
  if (!isAbsolute(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    throw Error('Login verification requires an existing private data directory.');
  const path = resolve(directory, 'login-verification.db');
  try { closeSync(openSync(path, 'wx', 0o600)); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error; }
  const withDb = <T>(work: (db: DatabaseSync) => T): T => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      throw Error('Login verification storage must remain a private regular file.');
    const db = new DatabaseSync(path);
    try { db.exec('PRAGMA busy_timeout=5000'); return work(db); }
    finally { db.close(); }
  };
  withDb(db => db.exec(`CREATE TABLE IF NOT EXISTS login_verification_used (
    nonce_hash TEXT PRIMARY KEY NOT NULL CHECK(length(nonce_hash)=64), expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS login_verification_expiry_idx ON login_verification_used(expires_at);`));
  return (nonce: string, expiresAt: number, now: number) => withDb(db => {
    // INSERT OR IGNORE is the single-use boundary across requests, processes and restarts.
    const hash = createHmac('sha256', secret).update('sansphase-login-used-v1\0').update(nonce).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      // Expiry cleanup stays bounded so one login never inherits a large maintenance job.
      db.prepare('DELETE FROM login_verification_used WHERE rowid IN (SELECT rowid FROM login_verification_used WHERE expires_at<=? LIMIT 128)').run(now);
      const added = db.prepare('INSERT OR IGNORE INTO login_verification_used(nonce_hash,expires_at) VALUES(?,?)').run(hash, expiresAt).changes === 1;
      db.exec('COMMIT'); return added;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
}

function browserNonce(req: IncomingMessage): string | null {
  const values = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(nonceCookie + '='));
  const nonce = values.length === 1 ? values[0].slice(nonceCookie.length + 1) : '';
  return hex(64).test(nonce) ? nonce : null;
}

function imagesOf(value: unknown): SliderImages | null {
  const image = (v: unknown, type: 'jpeg' | 'png', max: number): v is string => typeof v === 'string' && v.length <= max
    && (type === 'jpeg' ? /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/ : /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).test(v);
  if (!object(value) || value.type !== 'SLIDER' || !idValid(value.id) || !image(value.backgroundImage, 'jpeg', 500_000) || !image(value.templateImage, 'png', 200_000)
    || !integer(value.backgroundImageWidth, 300, 1200) || !integer(value.backgroundImageHeight, 180, 720)
    || !integer(value.templateImageWidth, 30, 200) || value.templateImageHeight !== value.backgroundImageHeight
    || value.templateImageWidth >= value.backgroundImageWidth) return null;
  // Deliberately project the official public VO, never serialize an engine's answer/cache object.
  return { id: value.id, type: 'SLIDER', backgroundImage: value.backgroundImage, templateImage: value.templateImage,
    backgroundImageWidth: value.backgroundImageWidth, backgroundImageHeight: value.backgroundImageHeight,
    templateImageWidth: value.templateImageWidth, templateImageHeight: value.templateImageHeight };
}

function trackOf(value: unknown): Track | null {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'bgImageHeight,bgImageWidth,left,startTime,stopTime,templateImageHeight,templateImageWidth,top,trackList'
    || !integer(value.bgImageWidth, 100, 1200) || !integer(value.bgImageHeight, 60, 720)
    || !integer(value.templateImageWidth, 5, 400) || value.templateImageWidth >= value.bgImageWidth || value.templateImageHeight !== value.bgImageHeight
    || !integer(value.left, 0, value.bgImageWidth - value.templateImageWidth) || value.top !== 0
    || !integer(value.startTime, 0, Number.MAX_SAFE_INTEGER) || !integer(value.stopTime, value.startTime, value.startTime + loginVerificationLifetimeMs)
    || !Array.isArray(value.trackList) || value.trackList.length < 1 || value.trackList.length > 512) return null;
  const points: Track['trackList'] = []; let last = -1;
  for (const p of value.trackList) {
    if (!object(p) || Object.keys(p).sort().join(',') !== 't,type,x,y' || !finite(p.x, -2000, 2000) || !finite(p.y, -2000, 2000)
      || !finite(p.t, 0, loginVerificationLifetimeMs) || p.t < last || typeof p.type !== 'string' || !['DOWN','MOVE','UP'].includes(p.type)) return null;
    last = p.t; points.push({ x: p.x, y: p.y, t: p.t, type: p.type as 'DOWN' | 'MOVE' | 'UP' });
  }
  return { bgImageWidth: value.bgImageWidth, bgImageHeight: value.bgImageHeight, templateImageWidth: value.templateImageWidth,
    templateImageHeight: value.bgImageHeight, startTime: value.startTime, stopTime: value.stopTime, left: value.left, top: 0, trackList: points };
}

/** Only the reviewed private puzzle engine decides a match. The public login consumes a separate bound, one-time proof. */
export function createLoginVerification({ directory, siteOrigin, settings, workflow, now = Date.now, engineRequest = fetch }: Options): LoginVerification {
  if (!settings) return { issue: async () => ({enabled:false}), match: async () => {throw fail('登录验证未启用。');}, verify: async () => {} };
  const origin = new URL(siteOrigin);
  if (origin.origin !== siteOrigin || !['http:', 'https:'].includes(origin.protocol)) throw Error('Login verification requires the exact site origin.');
  const consume = createReplayStore(directory, settings.hmacSecret);
  const binding = (nonce: string) => createHmac('sha256', settings.hmacSecret).update('sansphase-login-binding-v1\0').update(siteOrigin).update('\0').update(nonce).digest('hex');
  const sign = (token: SignedToken, key: string) => {
    const body = Buffer.from(JSON.stringify(token)).toString('base64url');
    return body + '.' + createHmac('sha256', key).update('sansphase-slider-token-v1\0').update(body).digest('base64url');
  };
  const decode = (raw: unknown, key: string, purpose: SignedToken['purpose'], req: IncomingMessage, namespace: LoginNamespace, time: number): SignedToken => {
    if (typeof raw !== 'string' || raw.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) throw fail('请完成滑块验证后重试。');
    const [body, signature] = raw.split('.');
    const expected = createHmac('sha256', key).update('sansphase-slider-token-v1\0').update(body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.toString('base64url') !== signature || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw fail('登录验证未通过，请重新验证。');
    let value: unknown; try { const bytes = Buffer.from(body, 'base64url'); if (bytes.toString('base64url') !== body) throw Error('encoding'); value = JSON.parse(bytes.toString('utf8')); } catch { throw fail('登录验证格式无效。'); }
    const nonce = browserNonce(req), seconds = Math.floor(time / 1000), lifetime = purpose === 'slider-challenge' ? loginVerificationLifetimeMs : proofLifetimeMs;
    if (!object(value) || Object.keys(value).sort().join(',') !== 'binding,expiresAt,id,issuedAt,namespace,nonce,origin,purpose,v'
      || value.v !== 1 || !idValid(value.id) || typeof value.nonce !== 'string' || !hex(32).test(value.nonce)
      || value.purpose !== purpose || value.namespace !== namespace || value.origin !== siteOrigin || !nonce || value.binding !== binding(nonce)
      || !integer(value.issuedAt, 0, seconds + 1) || !integer(value.expiresAt, seconds + 1, seconds + Math.floor(lifetime / 1000))
      || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > lifetime / 1000) throw fail('登录验证已失效，请重新验证。');
    return {v:1,id:value.id,nonce:value.nonce,purpose,namespace,origin:siteOrigin,binding:binding(nonce),issuedAt:value.issuedAt,expiresAt:value.expiresAt};
  };
  const ownOrigin = (req: IncomingMessage) => { if (req.headers.origin !== siteOrigin) throw fail('请求来源验证失败，请从本站操作。'); };
  const limit = (req: IncomingMessage, action: 'challenge'|'match'|'verify', time: number) => {
    const ip = clientAddress(req).ip || 'unknown';
    try {
      if (!workflow.consumeAuthLimits([{key:`login-verification:${action}:minute:${ip}`,limit:30,windowMs:60_000},
        {key:`login-verification:${action}:hour:${ip}`,limit:200,windowMs:3_600_000}], time)) throw fail('登录验证请求过于频繁，请稍后再试。',429);
    } catch(error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) throw error;
      throw fail('登录验证暂时不可用，请稍后重试。',503);
    }
  };
  const markUsed = (key: string, expiresAt: number, time: number) => {
    let fresh: boolean;
    try { fresh = consume(key, expiresAt, time / 1000); } catch { throw fail('登录验证暂时不可用，请稍后重试。',503); }
    if (!fresh) throw fail('登录验证已使用，请重新验证。');
  };
  let inFlight = 0;
  const engine = async (path: '/challenge'|'/verify', body: unknown): Promise<unknown> => {
    if (inFlight >= 4) throw fail('登录验证繁忙，请稍后重试。',503);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),5000); inFlight++;
    try {
      const response = await engineRequest(settings.serviceOrigin + path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+settings.serviceSecret},body:JSON.stringify(body),signal:controller.signal});
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length')) > 750_000) throw Error('Invalid service response');
      const reader = response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
      try { while(true){ const part=await reader.read(); if(part.done)break; size+=part.value.length;if(size>750_000){await reader.cancel();throw Error('Too large');} chunks.push(part.value); } } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch { throw fail('登录验证暂时不可用，请稍后重试。',503); }
    finally { clearTimeout(timer); inFlight--; }
  };
  return {
    async issue(req,res,namespace) {
      ownOrigin(req); const time=now(); limit(req,'challenge',time);
      const images=imagesOf(await engine('/challenge',{})); if(!images)throw fail('登录验证响应无效，请稍后重试。',503);
      const nonce=browserNonce(req)||randomBytes(32).toString('hex'),issuedAt=Math.floor(time/1000),expiresAt=issuedAt+loginVerificationLifetimeMs/1000;
      const token=sign({v:1,id:images.id,nonce:randomBytes(16).toString('hex'),purpose:'slider-challenge',namespace,origin:siteOrigin,binding:binding(nonce),issuedAt,expiresAt},settings.hmacSecret);
      const cookie=`${nonceCookie}=${nonce}; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=600${origin.protocol==='https:'?'; Secure':''}`;
      const previous=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',previous?[...(Array.isArray(previous)?previous:[String(previous)]),cookie]:cookie);
      res.setHeader('Cache-Control','private, no-store');
      return {enabled:true,engine:'slider',challenge:{...images,token,expiresAt}};
    },
    async match(req,namespace,body) {
      ownOrigin(req); const time=now();limit(req,'match',time);
      if(!object(body)||Object.keys(body).sort().join(',')!=='token,track')throw fail('滑块验证请求格式无效。',400);
      const track=trackOf(body.track);if(!track)throw fail('滑块轨迹格式无效，请重新拖动。',400);
      const challenge=decode(body.token,settings.hmacSecret,'slider-challenge',req,namespace,time);
      markUsed('slider-attempt:'+challenge.id,challenge.expiresAt,time);
      const result=await engine('/verify',{id:challenge.id,track});
      if(!object(result)||result.verified!==true)throw fail('滑块未对齐或操作已失效，请重新拖动。');
      const issuedAt=Math.floor(now()/1000),expiresAt=Math.min(challenge.expiresAt,issuedAt+proofLifetimeMs/1000);
      if(expiresAt<=issuedAt)throw fail('滑块验证已过期，请重新验证。');
      const proof=sign({...challenge,purpose:'login-proof',nonce:randomBytes(16).toString('hex'),issuedAt,expiresAt},settings.keySecret);
      return {proof,expiresAt};
    },
    async verify(req,namespace) {
      ownOrigin(req);const time=now();limit(req,'verify',time);
      const proof=decode(req.headers['x-login-verification'],settings.keySecret,'login-proof',req,namespace,time);
      markUsed('slider-login:'+proof.nonce,proof.expiresAt,time);
    },
  };
}
