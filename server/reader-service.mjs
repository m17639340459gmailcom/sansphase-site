import { createLocalReq, logoutOperation } from 'payload';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { clientAddress } from './client-ip.ts';
import { membershipState } from './reader-membership.ts';
import { uuidPattern } from './content-service.mjs';
import { withStreamUpload } from './stream-upload.mjs';
import { createReaderWorkflow, registrationLifetimeMs } from './reader-workflow.ts';
import { contactDetailReason } from './reader-profile-policy.mjs';
import { cleanReaderFiles } from './reader-file-cleanup.mjs';

const cookieName = 'sansphase_reader_session';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nicknamePattern = /^[^\u0000-\u001f\u007f<>]{2,30}$/u;
const phonePattern = /^1[3-9]\d{9}$/;

export function createReaderService({ payload, siteOrigin, directory, emailReady = false, authorService, loginLedger, uidStore, workflow = createReaderWorkflow(directory, payload.config.secret) }) {
  if (!payload || !siteOrigin || !directory || !uidStore) throw Error('Reader service requires Payload, site origin, private storage and UID store.');
  const attempts = new Map();
  const avatarDir = resolve(directory, 'uploads');
  const avatarPath = id => resolve(avatarDir, `reader-avatar-${id}.webp`);
  const pendingAvatarPath = id => resolve(avatarDir, `pending-reader-avatar-${id}.webp`);
  const avatarLimits = { maxFileBytes: 4 * 1024 ** 2, maxImageBytes: 4 * 1024 ** 2, maxAudioBytes: 0 };
  const avatarFormats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
  let avatarQueue = Promise.resolve();
  let verificationQueue = Promise.resolve();
  const serializeVerification = operation => {
    const next = verificationQueue.then(operation);
    verificationQueue = next.catch(() => {});
    return next;
  };
  const serializeAvatar = operation => {
    const next = avatarQueue.then(operation);
    avatarQueue = next.catch(() => {});
    return next;
  };
  const session = req => req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  const cookie = token => `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 7 * 86400 : 0}${siteOrigin.startsWith('https:') ? '; Secure' : ''}`;
  const client = req => clientAddress(req).ip || 'unknown';
  const throttle = (key, limit, windowMs) => {
    const now = Date.now();
    if (attempts.size > 10000) for (const [name, state] of attempts) if (state.until <= now) attempts.delete(name);
    const state = attempts.get(key);
    if (!state || state.until <= now) { attempts.set(key, { count: 1, until: now + windowMs }); return; }
    if (++state.count > limit) throw fail('尝试过于频繁，请稍后再试。', 429);
  };
  const origin = req => {
    if (req.headers.origin !== siteOrigin || req.headers['x-reader-request'] !== '1')
      throw fail('请求来源验证失败，请从本站操作。', 403);
  };
  const json = async req => {
    if (Number(req.headers['content-length']) > 16384) throw fail('请求内容过大。', 413);
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16384) throw fail('请求内容过大。', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('请求格式无效。'); }
  };
  const cleanEmail = value => {
    const email = String(value || '').trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email)) throw fail('请填写有效的邮箱地址。');
    return email;
  };
  const password = value => {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw fail('密码需为 8 至 128 个字符。');
    return value;
  };
  const nickname = value => {
    const name = String(value || '').trim();
    if (!nicknamePattern.test(name)) throw fail('昵称需为 2 至 30 个可见字符。');
    return name;
  };
  const phone = value => {
    const number = String(value || '').trim();
    if (!phonePattern.test(number)) throw fail('请输入正确的手机号：仅支持 1 开头的 11 位中国大陆手机号。');
    return number;
  };
  const signature = value => {
    if (typeof value !== 'string') throw fail('请填写有效的个性签名。');
    const text = value.trim();
    if (text.length > 100 || /[\u0000-\u001f\u007f]/u.test(text)) throw fail('个性签名限 100 字，且不能换行。');
    const contact = contactDetailReason(text);
    if (contact) throw fail(contact);
    return text;
  };
  const dto = user => user && ({ id: user.id, uid: uidStore.get(user.id), nickname: user.nickname, email: user.email, phone: user.phone || '', signature: user.signature || '', avatar: uuidPattern.test(user.avatar || '') ? `/api/reader/avatar/${user.avatar}.webp` : null,
    pendingSignature: workflow.profileFor(user.id, 'signature')?.proposed_value ?? null,
    pendingAvatar: Boolean(workflow.profileFor(user.id, 'avatar')),
    role: 'reader', ...membershipState(user) });
  async function authenticated(req) {
    const token = session(req);
    if (!token) return null;
    try {
      const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) });
      return user?.collection === 'readers' && user._verified === true && !user.disabled ? user : null;
    } catch { return null; }
  }
  async function findEmail(email, showHiddenFields = false) {
    const result = await payload.find({ collection: 'readers', where: { email: { equals: email } }, limit: 1, depth: 0, showHiddenFields });
    return result.docs[0] || null;
  }
  async function ownerEmail(email) {
    if (!authorService?.loginCredentials) return false;
    const result = await payload.find({ collection: 'authors', where: { email: { equals: email } }, limit: 1, depth: 0 });
    return result.docs.some(row => row.role === 'owner');
  }
  const send = (res, body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const sendVerification = async (email, token) => {
    const link = `${siteOrigin}/#/verify/${encodeURIComponent(token)}`;
    await payload.sendEmail({ to: email, subject: '验证你的 SANSPHASE 账号',
      html: `<p>请在 5 分钟内验证邮箱并启用账号：</p><p><a href="${link}">验证邮箱</a></p><p>如果不是你注册的账号，可以忽略这封邮件。</p>` });
  };
  const expireRegistration = request => {
    const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      try { workflow.removeRegistration(request.id); }
      catch (error) { process.stderr.write(JSON.stringify({ event: 'registration-expiry-error', message: error.message, at: new Date().toISOString() }) + '\n'); }
    }, delay);
    timer.unref();
  };
  const legacyExpired = row => row && row._verified !== true && Date.now() - Date.parse(row.createdAt) >= registrationLifetimeMs;
  return {
    registrationEnabled: Boolean(emailReady),
    identity: async req => dto(await authenticated(req)),
    async handle(req, res) {
      const path = new URL(req.url, siteOrigin).pathname.slice('/api/reader/'.length);
      try {
        if (path === 'session' && req.method === 'GET') { send(res, dto(await authenticated(req))); return; }
        if (path.startsWith('avatar/') && ['GET', 'HEAD'].includes(req.method)) {
          const id = path.slice('avatar/'.length).replace(/\.webp$/, '');
          const user = await authenticated(req);
          if (!user) throw fail('请先登录。', 401);
          if (!uuidPattern.test(id) || user.avatar !== id || !path.endsWith('.webp')) throw fail('头像不存在。', 404);
          let image;
          try { image = await readFile(avatarPath(id)); }
          catch (error) { if (error.code === 'ENOENT') throw fail('头像不存在。', 404); throw error; }
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': image.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(req.method === 'HEAD' ? undefined : image); return;
        }
        if (req.method !== 'POST') throw fail('不存在的操作。', 404);
        origin(req);
        if (path === 'avatar') {
          const user = await authenticated(req);
          if (!user) throw fail('请先登录。', 401);
          if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data;')) throw fail('请选择图片文件。', 415);
          const result = await withStreamUpload(req, directory, async file => {
            if (!avatarFormats[file.mimetype]) throw fail('头像只支持 JPG、PNG 或 WebP 图片。', 415);
            let image;
            try {
              const source = sharp(file.tempFilePath, { limitInputPixels: 25_000_000, animated: false });
              const metadata = await source.metadata();
              if (metadata.format !== avatarFormats[file.mimetype] || !metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64)
                throw fail('请选择至少 64 × 64 像素的有效图片。');
              image = await source.rotate().resize(320, 320, { fit: 'cover', position: 'centre', withoutEnlargement: false }).webp({ quality: 82, effort: 4 }).toBuffer();
            } catch (error) { if (error.status) throw error; throw fail('图片无法读取，请换一张 JPG、PNG 或 WebP 图片。'); }
            return serializeAvatar(async () => {
              const current = await authenticated(req);
              if (!current || current.id !== user.id) throw fail('请重新登录后上传。', 401);
              const id = randomUUID(), path = pendingAvatarPath(id);
              await mkdir(avatarDir, { recursive: true });
              await writeFile(path, image, { flag: 'wx', mode: 0o600 });
              let previous;
              try { ({ previous } = workflow.putProfile(current.id, 'avatar', id)); }
              catch (error) { await unlink(path).catch(() => {}); throw error; }
              if (previous && uuidPattern.test(previous.proposed_value)) {
                workflow.queueFile(`pending-reader-avatar-${previous.proposed_value}.webp`, 'superseded-pending-avatar');
                await cleanReaderFiles({ workflow, payload, directory });
              }
              return { ...dto(current), reviewPending: true };
            });
          }, avatarLimits);
          send(res, result); return;
        }
        const body = await json(req);
        const key = client(req);
        if (path === 'register') {
          if (!emailReady) throw fail('邮箱验证服务尚未配置，暂时不能注册。', 503);
          throttle(`register:${key}`, 30, 3600000);
          const email = cleanEmail(body.email), name = nickname(body.nickname), number = phone(body.phone), pass = password(body.password);
          throttle(`register-email:${email}`, 3, 3600000);
          const existing = await findEmail(email);
          if (legacyExpired(existing)) await payload.delete({ collection: 'readers', id: existing.id });
          if ((!existing || legacyExpired(existing)) && !await ownerEmail(email)) {
            const pending = workflow.putRegistration({ email, nickname: name, phone: number, password: pass });
            try { await sendVerification(email, pending.token); }
            catch (error) { workflow.removeRegistration(pending.id); throw error; }
            expireRegistration(pending);
          }
          send(res, { message: '如果该邮箱可以注册，验证邮件已发送。请查收邮箱。' }); return;
        }
        if (path === 'verify') {
          throttle(`verify:${key}`, 20, 3600000);
          const token = String(body.token || '');
          if (token.length < 20 || token.length > 256) throw fail('验证链接无效或已过期。');
          await serializeVerification(async () => {
            const pending = workflow.registrationByToken(token);
            if (pending) {
              if (await findEmail(pending.email) || await ownerEmail(pending.email)) throw fail('该邮箱已注册，请直接登录。', 409);
              const user = await payload.create({ collection: 'readers', data: {
                email: pending.email, password: pending.password, nickname: pending.nickname,
                phone: pending.phone, disabled: false, _verified: true,
              }, disableVerificationEmail: true });
              try { uidStore.assignRandom(user.id); }
              catch (error) { await payload.delete({ collection: 'readers', id: user.id }); throw error; }
              workflow.removeRegistration(pending.id);
              return;
            }
            const match = await payload.find({ collection: 'readers', where: { _verificationToken: { equals: token } }, limit: 1, depth: 0 });
            if (!match.docs[0] || match.docs[0]._verified === true || legacyExpired(match.docs[0])) throw fail('验证链接无效或已过期，请重新注册。');
            uidStore.assignRandom(match.docs[0].id);
            try { await payload.verifyEmail({ collection: 'readers', token }); }
            catch { throw fail('验证链接无效或已过期。'); }
          });
          send(res, { message: '邮箱验证成功，账号已启用。现在可以登录。' }); return;
        }
        if (path === 'resend') {
          if (!emailReady) throw fail('邮箱服务尚未配置。', 503);
          throttle(`resend:${key}`, 30, 3600000);
          const email = cleanEmail(body.email);
          throttle(`resend-email:${email}`, 3, 3600000);
          const user = await findEmail(email, true);
          if (!user && workflow.registrationByEmail(email)) {
            const pending = workflow.registrationByEmail(email);
            const renewed = workflow.putRegistration(pending);
            try { await sendVerification(email, renewed.token); }
            catch (error) { workflow.removeRegistration(renewed.id); throw error; }
            expireRegistration(renewed);
          } else if (user && user._verified !== true && user._verificationToken && !user.disabled && !legacyExpired(user)) {
            const link = `${siteOrigin}/#/verify/${encodeURIComponent(user._verificationToken)}`;
            await payload.sendEmail({ to: email, subject: '验证你的 SANSPHASE 账号', html: `<p>请在原申请的 5 分钟内点击链接验证邮箱：</p><p><a href="${link}">验证邮箱</a></p>` });
          }
          send(res, { message: '如果该邮箱正在等待验证，验证邮件已重新发送。' }); return;
        }
        if (path === 'login') {
          throttle(`login:${key}`, 200, 3600000);
          const email = cleanEmail(body.email);
          if (await ownerEmail(email)) {
            try {
              const identity = await authorService.loginCredentials(res, { email, password: body.password }, req);
              send(res, { ...identity, role: 'owner' });
            } catch (error) { if (error.status === 503) throw error; throw fail('邮箱或密码不正确，或账号尚未验证。', 401); }
            return;
          }
          let result;
          try { result = await payload.login({ collection: 'readers', data: { email, password: String(body.password || '') } }); }
          catch { throw fail('邮箱或密码不正确，或账号尚未验证。', 401); }
          if (result.user?.disabled || result.user?._verified !== true) {
            await logoutOperation({ collection: payload.collections.readers, req: await createLocalReq({ user: result.user }, payload) });
            throw fail('账号无法登录。', 403);
          }
          if (loginLedger) {
            try { loginLedger.record({ actorType: 'reader', actorId: result.user.id, email, address: clientAddress(req), userAgent: req.headers['user-agent'] }); }
            catch (error) {
              await logoutOperation({ collection: payload.collections.readers, req: await createLocalReq({ user: result.user }, payload) });
              throw error;
            }
          }
          const identity = dto(result.user);
          res.setHeader('Set-Cookie', cookie(result.token));
          send(res, identity); return;
        }
        if (path === 'logout') {
          const user = await authenticated(req);
          if (user) await logoutOperation({ collection: payload.collections.readers, req: await createLocalReq({ user }, payload) });
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
          try { result = await payload.resetPassword({ collection: 'readers', data: { token, password: newPassword } }); }
          catch { throw fail('重置链接无效或已过期。'); }
          // Payload issues a new session on reset but retains old sessions.
          // Revoke all of them so a stolen cookie cannot outlive recovery.
          await logoutOperation({ collection: payload.collections.readers,
            req: await createLocalReq({ user: result.user }, payload), allSessions: true });
          send(res, { message: '密码已更新，请重新登录。' }); return;
        }
        if (path === 'profile') {
          const user = await authenticated(req);
          if (!user) throw fail('请先登录。', 401);
          const proposed = Object.hasOwn(body, 'signature') ? signature(body.signature) : null;
          const updated = await payload.update({ collection: 'readers', id: user.id, data: { nickname: nickname(body.nickname), ...(Object.hasOwn(body, 'phone') ? { phone: phone(body.phone) } : {}) } });
          if (proposed !== null && proposed !== (user.signature || '')) workflow.putProfile(user.id, 'signature', proposed);
          else if (proposed !== null) {
            const previous = workflow.profileFor(user.id, 'signature');
            if (previous) workflow.removeProfile(previous.id);
          }
          send(res, { ...dto(updated), reviewPending: proposed !== null && proposed !== (user.signature || '') }); return;
        }
        if (path === 'avatar/remove') {
          const updated = await serializeAvatar(async () => {
            const user = await authenticated(req);
            if (!user) throw fail('请先登录。', 401);
            const pending = workflow.profileFor(user.id, 'avatar');
            if (pending) {
              workflow.removeProfile(pending.id);
              workflow.queueFile(`pending-reader-avatar-${pending.proposed_value}.webp`, 'avatar-cancelled');
            }
            if (!uuidPattern.test(user.avatar || '')) {
              if (pending) await cleanReaderFiles({ workflow, payload, directory });
              return user;
            }
            const result = await payload.update({ collection: 'readers', id: user.id, data: { avatar: null } });
            workflow.queueFile(`reader-avatar-${user.avatar}.webp`, 'avatar-removed');
            await cleanReaderFiles({ workflow, payload, directory });
            return result;
          });
          send(res, dto(updated)); return;
        }
        throw fail('不存在的操作。', 404);
      } catch (error) {
        send(res, { error: error.status ? error.message : '服务暂时不可用，请稍后重试。' }, error.status || 503);
      }
    },
  };
}
