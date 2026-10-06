// Only the loopback demonstration imports this adapter. All rows and files live
// in the demo's disposable directory; production uses the account authority.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Payload } from 'payload';
import { createReaderWorkflow } from '../../server/reader-workflow.ts';
import { createReaderProfileCommands } from '../../server/reader-profile-commands.ts';
import { createLocalCommunityProfileAccess } from '../../server/community-profile-access.ts';

type Sample = { name: string; uid: string; bio: string };
type Row = { id: string; nickname: string; signature: string; avatar: string | null; _verified: true };
export function createCommunityPreviewProfile(directory: string, samples: Record<string, Sample>) {
  const rows = new Map<string, Row>(Object.entries(samples).map(([id, sample]) => [id, { id, nickname: sample.name, signature: sample.bio, avatar: null, _verified: true }]));
  const identity = (req: IncomingMessage) => {
    const chosen = /(?:^|;\s*)preview_as=([a-z]+)/.exec(String(req.headers.cookie || ''))?.[1] || 'demo';
    return chosen === 'owner' ? 'owner' : rows.has(chosen) ? chosen : 'demo';
  };
  const find = (id: string) => { const row = rows.get(id); if (!row) throw Object.assign(Error('示例账号不存在。'), { status: 404 }); return row; };
  // A finite fake Payload boundary lets the preview reuse real review commands.
  const payload = {
    findByID: async ({ id }: { id: string }) => structuredClone(find(id)),
    update: async ({ id, data }: { id: string; data: Partial<Pick<Row, 'avatar' | 'signature'>> }) => {
      const row = find(id); Object.assign(row, data); return structuredClone(row);
    },
    find: async ({ where }: { where: { avatar: { equals: string } } }) => ({ totalDocs: [...rows.values()].filter(row => row.avatar === where.avatar.equals).length }),
  } as unknown as Payload;
  const workflow = createReaderWorkflow(directory, randomBytes(32).toString('hex'));
  const commands = createReaderProfileCommands({ payload, directory, workflow, uidStore: { get: id => samples[id]?.uid || null } });
  const access = createLocalCommunityProfileAccess({ commands, ownerId: 'owner',
    readerIdentity: async req => { const id = identity(req); return id === 'owner' ? null : { id }; },
    ownerIdentity: async req => identity(req) === 'owner' ? { id: 'owner' } : null,
  });
  return { access,
    publicRow: (id: string) => rows.get(id) || null,
    avatarFile: async (uid: string) => { const row = [...rows.values()].find(row => samples[row.id]?.uid === uid); return row?.avatar ? resolve(directory, 'uploads', `reader-avatar-${row.avatar}.webp`) : null; },
  };
}
