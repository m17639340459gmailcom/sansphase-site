import { createLocalReq, logoutOperation } from 'payload';
import type { Payload, TypedUser } from 'payload';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clientAddress } from './client-ip.ts';
import { loginIpKey } from './login-ledger.ts';
import { membershipState } from './reader-membership.ts';
import { uuidPattern } from './content-service.ts';
import { withStreamUpload } from './stream-upload.ts';
import { readerImageBytes } from '../src/upload-policy.mjs';
import { createReaderWorkflow } from './reader-workflow.ts';
import { createReaderProfileCommands, normalizeReaderAvatar, readerSignature, readerNickname } from './reader-profile-commands.ts';
import type { ReaderProfileCommands } from './reader-profile-commands.ts';
import { validCommunityFrame, vipCommunityFrame } from './community-frame-authority.ts';
import type { CommunityFrameAccess, CommunityFrameState } from './community-frame-authority.ts';
import { validReaderNickname } from '../src/reader-policy.ts';
import type { createReaderUidStore } from './reader-uids.ts';
import { strictPayloadIdentity } from './payload/strict-identity.ts';
import { activeOwnerReader, readOwnerReaderId } from './owner-reader.ts';

type ReaderUser = {
  id: string; collection?: string; email: string; nickname: string; phone?: string | null;
  signature?: string | null; avatar?: string | null; disabled?: boolean; _verified?: boolean;
  _verificationToken?: string | null; createdAt: string;
  vip_until?: string | null; vip_started_at?: string | null;
};
type ReaderBody = Record<string, unknown>;
type AuthorLogin = { loginCredentials: (res: ServerResponse, credentials: { email: string; password: unknown }, req: IncomingMessage) => Promise<Record<string, unknown>>; identityStrict?: (req: IncomingMessage) => Promise<unknown> };
type LoginLedger = { record: (entry: { actorType: 'reader'; actorId: string; email: string; address: ReturnType<typeof clientAddress>; userAgent: string | undefined }) => unknown };
type ReaderServiceOptions = {
  payload: Payload; siteOrigin: string; directory: string; emailReady?: boolean;
  authorService?: AuthorLogin; loginLedger?: LoginLedger;
  uidStore: ReturnType<typeof createReaderUidStore>;
  workflow?: ReturnType<typeof createReaderWorkflow>;
  profileCommands?: ReaderProfileCommands;
  frames?: CommunityFrameAccess;
  ownerReaderId?: string;
};
type ServiceError = Error & { status: number };
const errorStatus = (error: unknown): number | undefined => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const cookieName = 'sansphase_reader_session';
const fail = (message: string, status = 400): ServiceError => Object.assign(new Error(message), { status });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^1[3-9]\d{9}$/;

export function createReaderService({ payload, siteOrigin, directory, emailReady = false, authorService, loginLedger, uidStore, workflow = createReaderWorkflow(directory, payload.config.secret), profileCommands, frames, ownerReaderId }: ReaderServiceOptions) {
  if (!payload || !siteOrigin || !directory || !uidStore) throw Error('Reader service requires Payload, site origin, private storage and UID store.');
  const attempts = new Map<string, { count: number; until: number }>();
  const avatarDir = resolve(directory, 'uploads');
  const avatarPath = (id: string) => resolve(avatarDir, `reader-avatar-${id}.webp`);
  const avatarLimits = { maxFileBytes: readerImageBytes, maxImageBytes: readerImageBytes, maxAudioBytes: 0 };
  const profiles = profileCommands || createReaderProfileCommands({ payload, directory, workflow, uidStore });
  const ownerBinding = readOwnerReaderId({ ownerReaderId });
  let verificationQueue: Promise<unknown> = Promise.resolve();
  const serializeVerification = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = verificationQueue.then(operation);
    verificationQueue = next.catch(() => {});
    return next;
  };
  const session = (req: IncomingMessage) => req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  const cookie = (token: string) => `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 7 * 86400 : 0}${siteOrigin.startsWith('https:') ? '; Secure' : ''}`;
  const client = (req: IncomingMessage) => loginIpKey(clientAddress(req).ip || '') || 'unknown';
  const throttle = (key: string, limit: number, windowMs: number) => {
    const now = Date.now();
    if (attempts.size > 10000) for (const [name, state] of attempts) if (state.until <= now) attempts.delete(name);
    const state = attempts.get(key);
    if (!state || state.until <= now) { attempts.set(key, { count: 1, until: now + windowMs }); return; }
    if (++state.count > limit) throw fail('尝试过于频繁，请稍后再试。', 429);
  };
  const origin = (req: IncomingMessage) => {
    if (req.headers.origin !== siteOrigin || req.headers['x-reader-request'] !== '1')
      throw fail('请求来源验证失败，请从本站操作。', 403);
  };
  const json = async (req: IncomingMessage): Promise<ReaderBody> => {
    if (Number(req.headers['content-length']) > 16384) throw fail('请求内容过大。', 413);
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16384) throw fail('请求内容过大。', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReaderBody; } catch { throw fail('请求格式无效。'); }
  };
  const cleanEmail = (value: unknown) => {
    const email = String(value || '').trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email)) throw fail('请填写有效的邮箱地址。');
    return email;
  };
  const password = (value: unknown) => {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw fail('密码需为 8 至 128 个字符。');
    return value;
  };
  const nickname = (value: unknown) => {
    const name = String(value || '').trim().normalize('NFC');
    if (!validReaderNickname(name)) throw fail('昵称需为 2 至 8 个可见字符。');
    return name;
  };
  const phone = (value: unknown) => {
    const number = String(value || '').trim();
    if (!phonePattern.test(number)) throw fail('请输入正确的手机号：仅支持 1 开头的 11 位中国大陆手机号。');
    return number;
  };
  const dto = (user: ReaderUser | null) => user && ({ id: user.id, uid: uidStore.get(user.id), nickname: user.nickname, email: user.email, phone: user.phone || '', signature: user.signature || '', avatar: uuidPattern.test(user.avatar || '') ? `/api/reader/avatar/${user.avatar}.webp` : null,
    pendingSignature: workflow.profileFor(user.id, 'signature')?.proposed_value ?? null,
    pendingAvatar: Boolean(workflow.profileFor(user.id, 'avatar')),
    pendingNickname: workflow.profileFor(user.id, 'nickname')?.proposed_value ?? null,
    role: 'reader', ...membershipState(user), ...(ownerBinding && user.id === ownerBinding ? { ownerReader: true as const } : {}) });
  const noFrames = (): CommunityFrameState => ({ frame: null, frameImage: null, items: [], available: false });
  const frameState = async (user: ReaderUser): Promise<CommunityFrameState> => {
    try {
      const state = frames ? await frames.state(user.id) : noFrames();
      if (user._verified === true && !user.disabled && membershipState(user).vip) return state;
      // The current account can veto a short display cache without removing
      // the saved choice or another frame from the permanent inventory.
      return { ...state, frame: state.frame === vipCommunityFrame ? null : state.frame,
        frameImage: state.frame === vipCommunityFrame ? null : state.frameImage, items: state.items.filter(item => item.ref !== vipCommunityFrame) };
    } catch { return noFrames(); }
  };
  const displayDTO = async (user: ReaderUser | null) => {
    if (!user) return null;
    const state = await frameState(user);
    return { ...dto(user), frame: state.frame, frameImage: state.frameImage };
  };
  async function authenticated(req: IncomingMessage, strict = false): Promise<ReaderUser | null> {
    const token = session(req);
    if (!token) return null;
    try {
      const user = strict ? await strictPayloadIdentity(payload, token) : (await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })).user;
      return user?.collection === 'readers' && user._verified === true && !user.disabled ? user as ReaderUser : null;
    } catch (error) { if (strict && ![401, 403].includes(errorStatus(error) || 0)) throw error; return null; }
  }
  const ownerPersonal = async (req: IncomingMessage): Promise<ReaderUser | null> => {
    if (!ownerBinding || !authorService?.identityStrict || !await authorService.identityStrict(req)) return null;
    return activeOwnerReader(payload, ownerBinding);
  };
  // Only personal-account endpoints use this delegation. Ordinary identity and
  // identityStrict keep the original owner login as the management identity.
  const personal = async (req: IncomingMessage) => await authenticated(req) || await ownerPersonal(req);
  async function findEmail(email: string, showHiddenFields = false): Promise<ReaderUser | null> {
    const result = await payload.find({ collection: 'readers', where: { email: { equals: email } }, limit: 1, depth: 0, showHiddenFields });
    return result.docs[0] as ReaderUser | undefined || null;
  }
  async function ownerEmail(email: string) {
    if (!authorService?.loginCredentials) return false;
    const result = await payload.find({ collection: 'authors', where: { email: { equals: email } }, limit: 1, depth: 0 });
    return result.docs.some(row => row.role === 'owner');
  }
  const send = (res: ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  // Payload's generic types do not know this site's readers collection fields.
  const localReq = (user: object) => createLocalReq({ user: user as TypedUser }, payload);
  const revokeIssuedSession = async (token: string) => {
    // login().user does not contain _sid. auth() resolves the actual issued
    // session so logout revokes that session without affecting other devices.
    const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) });
    if (user?.collection === 'readers') await logoutOperation({ collection: payload.collections.readers, req: await localReq(user) });
  };
  const sendVerification = async (email: string, code: string) => {
    await payload.sendEmail({ to: email, subject: '验证你的 SANSPHASE 账号',
      text: `你的 SANSPHASE 注册验证码为：${code}。5 分钟内有效，请返回注册页面填写。请勿将验证码提供给他人。如果不是你申请的，请忽略。`,
      html: `<p>请返回注册页面，填写邮箱验证码：</p><p><strong>${code}</strong></p><p>5 分钟内有效，请勿将验证码提供给他人。如果不是你申请的，请忽略此邮件。</p>` });
  };
  const verificationMailLimit = (email: string, ip: string) => {
    if (!workflow.consumeAuthLimits([
      { key: `mail-minute:${email}`, limit: 1, windowMs: 60000 },
      { key: `mail-hour:${email}`, limit: 3, windowMs: 3600000 },
      { key: `mail-ip:${ip}`, limit: 10, windowMs: 3600000 },
    ])) throw fail('验证码发送过于频繁，请至少间隔 60 秒，每个邮箱每小时最多 3 次。', 429);
  };
  const expireRegistration = (request: { id: string; expiresAt: string }) => {
    const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      try { workflow.removeRegistration(request.id); }
      catch (error) { process.stderr.write(JSON.stringify({ event: 'registration-expiry-error', message: errorMessage(error), at: new Date().toISOString() }) + '\n'); }
    }, delay);
    timer.unref();
  };
  return {
    profiles,
    registrationEnabled: Boolean(emailReady),
    identity: async (req: IncomingMessage) => dto(await authenticated(req)),
    displayIdentity: async (req: IncomingMessage) => displayDTO(await personal(req)),
    ownerReaderIdentity: async (req: IncomingMessage) => {
      const user = await ownerPersonal(req);
      return user && { id: user.id, uid: uidStore.get(user.id), nickname: user.nickname, signature: user.signature || '',
        avatar: uuidPattern.test(user.avatar || '') ? user.avatar! : null, ...membershipState(user) };
    },
    // Server-to-server checks must distinguish revoked/invalid sessions from
    // account storage failure. Ordinary page reads keep their existing behavior.
    identityStrict: async (req: IncomingMessage) => dto(await authenticated(req, true)),
    async handle(req: IncomingMessage, res: ServerResponse) {
      const path = new URL(req.url || '', siteOrigin).pathname.slice('/api/reader/'.length);
      try {
        if (path === 'session' && req.method === 'GET') { send(res, await displayDTO(await personal(req))); return; }
        if (path === 'frame-state' && req.method === 'GET') {
          const user = await personal(req); if (!user) throw fail('请先登录。', 401);
          send(res, await frameState(user)); return;
        }
        if (path.startsWith('frame/') && ['GET', 'HEAD'].includes(req.method || '')) {
          const user = await personal(req); if (!user) throw fail('请先登录。', 401);
          const id = path.slice('frame/'.length).replace(/\.webp$/, '');
          if (!frames || !uuidPattern.test(id) || !path.endsWith('.webp')) throw fail('头像框图片不存在。', 404);
          const bytes = await frames.image(user.id, id);
          const current = await personal(req); if (!current || current.id !== user.id) throw fail('请重新登录。', 401);
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(req.method === 'HEAD' ? undefined : bytes); return;
        }
        if (path.startsWith('avatar/') && ['GET', 'HEAD'].includes(req.method || '')) {
          const id = path.slice('avatar/'.length).replace(/\.webp$/, '');
          const user = await personal(req);
          if (!user) throw fail('请先登录。', 401);
          if (!uuidPattern.test(id) || user.avatar !== id || !path.endsWith('.webp')) throw fail('头像不存在。', 404);
          let image;
          try { image = await readFile(avatarPath(id)); }
          catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw fail('头像不存在。', 404); throw error; }
          const current = await personal(req); if (!current || current.id !== user.id || current.avatar !== id) throw fail('请重新登录。', 401);
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': image.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(req.method === 'HEAD' ? undefined : image); return;
        }
        if (req.method !== 'POST') throw fail('不存在的操作。', 404);
        origin(req);
        if (path === 'avatar') {
          const user = await personal(req);
          if (!user) throw fail('请先登录。', 401);
          if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data;')) throw fail('请选择图片文件。', 415);
          const result = await withStreamUpload(req, directory, async (file: { mimetype: string; tempFilePath: string }) => {
            const image = await normalizeReaderAvatar(file.tempFilePath, file.mimetype);
            await profiles.submitAvatar(user.id, image, async () => {
              const current = await personal(req);
              if (!current || current.id !== user.id) throw fail('请重新登录后上传。', 401);
            });
            return { ...dto(await personal(req)), reviewPending: true };
          }, avatarLimits);
          send(res, result); return;
        }
        const body = await json(req);
        const key = client(req);
        if (path === 'frame') {
          const user = await personal(req); if (!user) throw fail('请先登录。', 401);
          if (!frames) throw fail('头像框暂不可用，请稍后再试。', 503);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'ref') || !Object.hasOwn(body, 'ref') || !validCommunityFrame(body.ref)) throw fail('请选择已拥有的头像框。');
          send(res, await frames.equip(user.id, body.ref)); return;
        }
        if (path === 'register') {
          if (!emailReady) throw fail('邮箱验证服务尚未配置，暂时不能注册。', 503);
          throttle(`register:${key}`, 30, 3600000);
          const email = cleanEmail(body.email), name = nickname(body.nickname), number = phone(body.phone), pass = password(body.password);
          verificationMailLimit(email, key);
          const existing = await findEmail(email);
          let requestId = randomUUID();
          if (existing && existing._verified !== true) await payload.delete({ collection: 'readers', id: existing.id });
          if ((!existing || existing._verified !== true) && !await ownerEmail(email)) {
            const pending = workflow.putRegistration({ email, nickname: name, phone: number, password: pass });
            requestId = pending.id;
            try { await sendVerification(email, pending.code); }
            catch (error) { workflow.removeRegistration(pending.id); throw error; }
            expireRegistration(pending);
          }
          send(res, { requestId, message: '如果该邮箱可以注册，验证码已发送，请在 5 分钟内填写。' }); return;
        }
        if (path === 'verify') {
          if (!workflow.consumeAuthLimits([{ key: `verify:${key}`, limit: 20, windowMs: 3600000 }])) throw fail('验证尝试过于频繁，请稍后再试。', 429);
          const email = cleanEmail(body.email), code = String(body.code || ''), requestId = String(body.requestId || '');
          if (!uuidPattern.test(requestId)) throw fail('验证码无效或注册申请已失效，请重新获取。');
          await serializeVerification(async () => {
            const pending = workflow.registrationByCode(email, requestId, code);
            if (pending) {
              if (await findEmail(pending.email) || await ownerEmail(pending.email)) throw fail('该邮箱已注册，请直接登录。', 409);
              const user = await payload.create({ collection: 'readers', data: {
                email: pending.email, password: pending.password, nickname: nickname(pending.nickname),
                phone: pending.phone, disabled: false, _verified: true,
              }, disableVerificationEmail: true });
              try { uidStore.assignRandom(user.id); }
              catch (error) { await payload.delete({ collection: 'readers', id: user.id }); throw error; }
              workflow.removeRegistration(pending.id);
              return;
            }
            throw fail('验证码无效、已过期或错误次数过多，请重新获取。');
          });
          send(res, { message: '邮箱验证成功，账号已启用。现在可以登录。' }); return;
        }
        if (path === 'resend') {
          if (!emailReady) throw fail('邮箱服务尚未配置。', 503);
          throttle(`resend:${key}`, 30, 3600000);
          const email = cleanEmail(body.email);
          verificationMailLimit(email, key);
          const user = await findEmail(email);
          const pending = workflow.registrationByEmail(email);
          let requestId = randomUUID();
          if (!user && pending && pending.id === body.requestId) {
            const renewed = workflow.putRegistration(pending);
            requestId = renewed.id;
            try { await sendVerification(email, renewed.code); }
            catch (error) { workflow.removeRegistration(renewed.id); throw error; }
            expireRegistration(renewed);
          }
          send(res, { requestId, message: '如果该邮箱正在等待验证，验证码已重新发送，之前的验证码已失效。' }); return;
        }
        if (path === 'login') {
          throttle(`login:${key}`, 200, 3600000);
          const email = cleanEmail(body.email);
          if (await ownerEmail(email)) {
            try {
              if (!authorService) throw fail('作者登录暂不可用。', 503);
              const identity = await authorService.loginCredentials(res, { email, password: body.password }, req);
              send(res, { ...identity, role: 'owner' });
            } catch (error) { if (errorStatus(error) === 503) throw error; throw fail('邮箱或密码不正确，或账号尚未验证。', 401); }
            return;
          }
          let result;
          try { result = await payload.login({ collection: 'readers', data: { email, password: String(body.password || '') } }); }
          catch { throw fail('邮箱或密码不正确，或账号尚未验证。', 401); }
          if (!result.user) throw fail('登录会话暂不可用，请重试。', 503);
          const issuedToken = result.token;
          if (!issuedToken) throw fail('登录会话暂不可用，请重试。', 503);
          if (result.user.disabled || result.user._verified !== true) {
            await revokeIssuedSession(issuedToken);
            throw fail('账号无法登录。', 403);
          }
          if (loginLedger) {
            try { loginLedger.record({ actorType: 'reader', actorId: String(result.user.id), email, address: clientAddress(req), userAgent: req.headers['user-agent'] }); }
            catch (error) {
              await revokeIssuedSession(issuedToken);
              throw error;
            }
          }
          const identity = dto(result.user as ReaderUser);
          res.setHeader('Set-Cookie', cookie(issuedToken));
          send(res, identity); return;
        }
        if (path === 'logout') {
          const user = await authenticated(req);
          if (user) await logoutOperation({ collection: payload.collections.readers, req: await localReq(user) });
          res.setHeader('Set-Cookie', cookie(''));
          send(res, { ok: true }); return;
        }
        if (path === 'forgot') {
          if (!emailReady) throw fail('邮箱服务尚未配置。', 503);
          throttle(`forgot:${key}`, 30, 3600000);
          const email = cleanEmail(body.email);
          throttle(`forgot-email:${email}`, 3, 3600000);
          const user = await findEmail(email);
          if (user && !user.disabled && user._verified === true)
            await payload.forgotPassword({ collection: 'readers', data: { email } });
          send(res, { message: '如果该邮箱已注册，重置邮件已发送。' }); return;
        }
        if (path === 'reset') {
          throttle(`reset:${key}`, 20, 3600000);
          const token = String(body.token || '');
          if (token.length < 20 || token.length > 256) throw fail('重置链接无效或已过期。');
          const newPassword = password(body.password);
          let result;
          // Keep the existing Local API call shape; the generic type requires an
          // overrideAccess field that was not part of this service's runtime call.
          try { result = await payload.resetPassword({ collection: 'readers', data: { token, password: newPassword } } as Parameters<Payload['resetPassword']>[0]); }
          catch { throw fail('重置链接无效或已过期。'); }
          // Payload issues a new session on reset but retains old sessions.
          // Revoke all of them so a stolen cookie cannot outlive recovery.
          await logoutOperation({ collection: payload.collections.readers,
            req: await localReq(result.user), allSessions: true });
          send(res, { message: '密码已更新，请重新登录。' }); return;
        }
        if (path === 'profile') {
          const user = await personal(req);
          if (!user) throw fail('请先登录。', 401);
          const proposed = Object.hasOwn(body, 'signature') ? readerSignature(body.signature) : null;
          const proposedNickname = readerNickname(body.nickname);
          const data = Object.hasOwn(body, 'phone') ? { phone: phone(body.phone) } : null;
          const check = async () => { const current = await personal(req); if (!current || current.id !== user.id) throw fail('请重新登录。', 401); };
          const updated = data ? await profiles.accountMutation(async () => {
            const current = await personal(req); if (!current || current.id !== user.id) throw fail('请重新登录。', 401);
            return payload.update({ collection: 'readers', id: user.id, data });
          }) : user;
          await profiles.submitNickname(user.id, proposedNickname, check);
          if (proposed !== null) await profiles.submitSignature(user.id, proposed, check);
          send(res, { ...dto(updated as ReaderUser), reviewPending: proposedNickname !== user.nickname || proposed !== null && proposed !== (user.signature || '') }); return;
        }
        if (path === 'avatar/remove') {
          const user = await personal(req); if (!user) throw fail('请先登录。', 401);
          await profiles.removeAvatar(user.id, async () => { const current = await personal(req); if (!current || current.id !== user.id) throw fail('请重新登录。', 401); });
          send(res, dto(await personal(req))); return;
        }
        throw fail('不存在的操作。', 404);
      } catch (error) {
        send(res, { error: errorStatus(error) ? errorMessage(error) : '服务暂时不可用，请稍后重试。' }, errorStatus(error) || 503);
      }
    },
  };
}
