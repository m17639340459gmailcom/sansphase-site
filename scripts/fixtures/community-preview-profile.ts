// Only the loopback demonstration imports this adapter. All rows and files live
// in the demo's disposable directory; production uses the account authority.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Payload } from 'payload';
import { createReaderWorkflow } from '../../server/reader-workflow.ts';
import { createReaderProfileCommands } from '../../server/reader-profile-commands.ts';
import { createLocalCommunityProfileAccess } from '../../server/community-profile-access.ts';
import { createReaderService } from '../../server/reader-service.ts';
import type { CommunityFrameAccess } from '../../server/community-frame-authority.ts';
import type { createReaderUidStore } from '../../server/reader-uids.ts';

type Sample = { name: string; uid: string; bio: string; vip?: boolean };
type Row = { id: string; nickname: string; signature: string; avatar: string | null; _verified: true; disabled: boolean;
  email: string; phone: string; createdAt: string; vip_started_at: string | null; vip_until: string | null };
type Options = { ownerReaderId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createCommunityPreviewProfile(directory: string, samples: Record<string, Sample>, { ownerReaderId }: Options = {}) {
  if (ownerReaderId && (!uuid.test(ownerReaderId) || !samples[ownerReaderId] || Object.values(samples).filter(sample => sample.uid === samples[ownerReaderId].uid).length !== 1))
    throw Error('The owner preview requires its own verified sample reader and unique UID.');
  const createdAt = new Date().toISOString();
  const rows = new Map<string, Row>(Object.entries(samples).map(([id, sample]) => [id, { id, nickname: sample.name, signature: sample.bio, avatar: null, _verified: true, disabled: false,
    email: `${sample.uid}@preview.invalid`, phone: `138000${sample.uid.padStart(5, '0')}`, createdAt,
    vip_started_at: sample.vip ? createdAt : null, vip_until: sample.vip ? new Date(Date.now() + 86400_000).toISOString() : null }]));
  const identity = (req: IncomingMessage) => {
    const chosen = /(?:^|;\s*)preview_as=([a-z]+)/.exec(String(req.headers.cookie || ''))?.[1] || 'demo';
    return chosen === 'owner' ? 'owner' : rows.has(chosen) ? chosen : 'demo';
  };
  const find = (id: string) => { const row = rows.get(id); if (!row) throw Object.assign(Error('示例账号不存在。'), { status: 404 }); return row; };
  const ownerReaderIdentity = async (req: IncomingMessage) => {
    if (identity(req) !== 'owner' || !ownerReaderId) return null;
    const row = rows.get(ownerReaderId); return row && !row.disabled ? { id: row.id, nickname: row.nickname, vip: samples[row.id].vip === true } : null;
  };
  const uidStore: ReturnType<typeof createReaderUidStore> = {
    get: id => { const sample = samples[String(id)]; if (!sample) throw Error('Sample reader has no UID.'); return sample.uid; },
    readerId: uid => Object.entries(samples).find(([, sample]) => sample.uid === String(uid))?.[0] ?? null,
    assignRandom: () => { throw Error('Sample UIDs are fixed.'); }, set: () => { throw Error('Sample UIDs are fixed.'); }, close: () => {},
  };
  // A finite fake Payload boundary lets the preview reuse real review commands.
  const payload = {
    config: { secret: randomBytes(32).toString('hex') },
    findByID: async ({ id }: { id: string }) => structuredClone(find(id)),
    update: async ({ id, data }: { id: string; data: Partial<Pick<Row, 'avatar' | 'signature' | 'nickname' | 'phone'>> }) => {
      const row = find(id); Object.assign(row, data); return structuredClone(row);
    },
    find: async ({ where }: { where: { avatar: { equals: string } } }) => ({ totalDocs: [...rows.values()].filter(row => row.avatar === where.avatar.equals).length }),
    auth: async ({ headers }: { headers: Headers }) => {
      const id = /^JWT preview-([a-z0-9-]+)$/.exec(headers.get('authorization') || '')?.[1];
      const row = id ? rows.get(id) : null; return { user: row && !row.disabled ? { ...structuredClone(row), collection: 'readers' } : null };
    },
  } as unknown as Payload;
  const workflow = createReaderWorkflow(directory, randomBytes(32).toString('hex'));
  const commands = createReaderProfileCommands({ payload, directory, workflow, uidStore });
  const access = createLocalCommunityProfileAccess({ commands, ownerId: 'owner',
    readerIdentity: async req => { const id = identity(req); return id === 'owner' ? null : { id }; },
    ownerIdentity: async req => identity(req) === 'owner' ? { id: 'owner' } : null,
    ownerReaderIdentity,
  });
  return { access, ownerReaderIdentity,
    readerService(siteOrigin: string, frames?: CommunityFrameAccess) {
      const service = createReaderService({ payload, directory, workflow, uidStore, profileCommands: commands, siteOrigin, frames, ownerReaderId,
        authorService: { identityStrict: async req => identity(req) === 'owner' ? { id: 'owner' } : null,
          loginCredentials: async () => { throw Error('Sample author login is chosen only by the local identity picker.'); } },
      });
      const cookieFor = async (req: IncomingMessage) => {
        const selected = identity(req), id = selected === 'owner' ? null : selected;
        const retained = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => !part.startsWith('sansphase_reader_session='));
        return [...retained, ...(id ? [`sansphase_reader_session=preview-${id}`] : [])].join('; ');
      };
      const projected = async (req: IncomingMessage) => Object.assign(Object.create(req) as IncomingMessage, { headers: { ...req.headers, cookie: await cookieFor(req) } });
      return { registrationEnabled: false,
        identity: async (req: IncomingMessage) => service.identity(await projected(req)),
        displayIdentity: async (req: IncomingMessage) => service.displayIdentity(await projected(req)),
        async handle(req: IncomingMessage, res: Parameters<typeof service.handle>[1]) {
          const path = new URL(req.url || '', siteOrigin).pathname;
          if (!/^\/api\/reader\/(?:session|profile|avatar(?:\/remove|\/[0-9a-f-]{36}\.webp)?|frame(?:-state|\/[0-9a-f-]{36}\.webp)?)$/.test(path)) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(JSON.stringify({ error: '本地样例只开放资料编辑。' })); return;
          }
          const previous = req.headers.cookie; req.headers.cookie = await cookieFor(req);
          try { await service.handle(req, res); } finally { req.headers.cookie = previous; }
        },
      };
    },
    publicRow: (id: string) => rows.get(id) || null,
    avatarFile: async (uid: string) => { const row = [...rows.values()].find(row => samples[row.id]?.uid === uid); return row?.avatar ? resolve(directory, 'uploads', `reader-avatar-${row.avatar}.webp`) : null; },
  };
}
