import type { Payload } from 'payload';
import type { ReaderInvitations } from '../../server/reader-invitations.ts';
import { addMembershipDays } from '../../server/reader-membership.ts';
import type { createReaderUidStore } from '../../server/reader-uids.ts';

export const LOCAL_TEST_READER_PASSWORD = 'SansphaseLocal2026!';
const identities = [
  { kind: 'reader', email: 'local-reader@example.test', nickname: '本地读者' },
  { kind: 'vip', email: 'local-vip@example.test', nickname: '本地会员' },
] as const;

export interface CreatedLocalTestReader {
  kind: typeof identities[number]['kind'];
  id: string;
  email: string;
  nickname: string;
  uid: string;
}
type PendingLocalTestReader = Omit<CreatedLocalTestReader, 'uid'>;

/** A failed allocation can leave only the new rows listed here; never remove old data automatically. */
export class LocalTestReaderCreationError extends Error {
  readonly created: readonly PendingLocalTestReader[];

  constructor(created: readonly PendingLocalTestReader[], cause: unknown) {
    super(`Local test reader creation stopped; ${created.length} new account(s) may remain. Existing accounts were not changed.`, { cause });
    this.name = 'LocalTestReaderCreationError';
    this.created = created.map(reader => ({ ...reader }));
  }
}

/**
 * Adds only independent local acceptance readers through the original Payload API.
 * The caller must guard and back up its local-only target before calling this helper.
 * It never seeds content, updates accounts, deletes data or changes login verification.
 */
export async function createLocalTestReaders(payload: Payload, { uidStore, invitations, now = new Date() }: {
  uidStore: Pick<ReturnType<typeof createReaderUidStore>, 'assignRandom'>;
  invitations: Pick<ReaderInvitations, 'registrationFields'>;
  now?: Date;
}): Promise<CreatedLocalTestReader[]> {
  if (!Number.isFinite(now.getTime())) throw Error('Invalid local test reader membership date.');
  const emails = identities.map(identity => identity.email);
  // Check the complete batch, including the separate author namespace, before any write.
  for (const collection of ['readers', 'authors'] as const) {
    const matches = await payload.find({ collection, where: { email: { in: emails } }, limit: 1, depth: 0, overrideAccess: true });
    if (matches.totalDocs) throw Error('A local test reader email already exists; no accounts were changed.');
  }

  const created: PendingLocalTestReader[] = [], result: CreatedLocalTestReader[] = [];
  const startedAt = now.toISOString(), until = addMembershipDays(startedAt, 30);
  try {
    for (const identity of identities) {
      const reader = await payload.create({ collection: 'readers', overrideAccess: true, disableVerificationEmail: true, data: {
        email: identity.email, password: LOCAL_TEST_READER_PASSWORD, nickname: identity.nickname,
        phone: '', signature: '本地验收测试账号，仅用于当前本地主站副本。', _verified: true, disabled: false,
        vip_started_at: identity.kind === 'vip' ? startedAt : null,
        vip_until: identity.kind === 'vip' ? until : null,
        ...invitations.registrationFields(null, false),
      } });
      const pending = { ...identity, id: String(reader.id) };
      created.push(pending);
      result.push({ ...pending, uid: uidStore.assignRandom(reader.id) });
    }
  } catch (cause) {
    // This SQLite adapter has no cross-connection transaction with the UID store.
    // Preserve partial new rows and report their IDs rather than guessing cleanup.
    throw new LocalTestReaderCreationError(created, cause);
  }
  return result;
}
