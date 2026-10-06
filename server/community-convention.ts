import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { communityConventionText } from '../src/community-convention.ts';
import { fail } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

const readDelay = 10000;
const baseline = { version: `base-${createHash('sha256').update(communityConventionText).digest('hex').slice(0, 24)}`, body: communityConventionText.trim() };
type ConventionRow = { version: string; body: string };
type AgreementRow = { agreed_at: string | null; agreed_version: string | null; convention_read_version: string | null; convention_read_at: number | null };

export function conventionVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:base-[a-f0-9]{24}|[a-f0-9-]{36})$/.test(value)) throw fail('请重新打开当前社区公约。');
  return value;
}
function safeBody(value: unknown): string {
  if (typeof value !== 'string') throw fail('请填写社区公约正文。');
  const body = value.replace(/\r\n?/g, '\n').trim();
  if (!body || [...body].length > 20000) throw fail('社区公约正文需要为 1–20000 个字。');
  if (/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(body)
    || /<\s*(?:\/?[A-Za-z]|[!?])/u.test(body) || /\b(?:javascript|vbscript|data|file|blob)\s*:/iu.test(body))
    throw fail('社区公约只支持纯文本或安全 Markdown，不能包含 HTML 或可执行链接。');
  return body;
}

// Immutable publication rows and per-account consent share the existing database
// transaction. Legacy agreement timestamps never imply consent to a new version.
export function createCommunityConvention(db: DatabaseSync, tx: Transaction) {
  const latest = db.prepare('SELECT version,body FROM community_conventions ORDER BY rowid DESC LIMIT 1');
  const insert = db.prepare('INSERT INTO community_conventions(version,body,actor_kind,actor_id,created_at) VALUES(?,?,?,?,?)');
  const ensure = db.prepare('INSERT OR IGNORE INTO community_members(member_kind,member_id,created_at) VALUES(?,?,?)');
  const agreement = db.prepare('SELECT agreed_at,agreed_version,convention_read_version,convention_read_at FROM community_members WHERE member_kind=? AND member_id=?');
  const start = db.prepare('UPDATE community_members SET convention_read_version=?,convention_read_at=? WHERE member_kind=? AND member_id=?');
  const accept = db.prepare('UPDATE community_members SET agreed_version=?,agreed_at=? WHERE member_kind=? AND member_id=?');
  const current = (): ConventionRow => {
    const saved = latest.get() as ConventionRow | undefined;
    return saved ? { version: saved.version, body: saved.body } : { ...baseline };
  };
  const row = (member: CommunityAuthor) => agreement.get(member.kind, member.id) as AgreementRow | undefined;
  const state = (member: CommunityAuthor) => {
    const version = current().version, value = row(member);
    return { version, agreed: value?.agreed_version === version && Boolean(value.agreed_at) };
  };
  const assertCurrent = (version: unknown) => {
    const checked = conventionVersion(version);
    if (current().version !== checked) throw fail('社区公约已更新，请重新阅读当前版本。', 409);
    return checked;
  };
  return {
    current, state,
    assertAgreed(member: CommunityAuthor) {
      if (!state(member).agreed) throw fail('请先阅读当前社区公约，满 10 秒后确认同意。', 428);
    },
    read(member: CommunityAuthor, version: unknown, now = Date.now()) {
      return tx(() => {
        const checked = assertCurrent(version);
        ensure.run(member.kind, member.id, new Date(now).toISOString());
        const previous = row(member)!;
        const startedAt = previous.convention_read_version === checked && previous.convention_read_at !== null ? previous.convention_read_at : now;
        if (previous.convention_read_version !== checked || previous.convention_read_at === null) start.run(checked, now, member.kind, member.id);
        return { version: checked, eligibleAt: new Date(startedAt + readDelay).toISOString() };
      });
    },
    agree(member: CommunityAuthor, version: unknown, now = Date.now()) {
      return tx(() => {
        const checked = assertCurrent(version), previous = row(member);
        if (previous?.agreed_version === checked && previous.agreed_at) return { agreed: true as const, version: checked };
        if (!previous || previous.convention_read_version !== checked || previous.convention_read_at === null || now - previous.convention_read_at < readDelay)
          throw fail('请先阅读社区公约，满 10 秒后再确认同意。', 428);
        accept.run(checked, new Date(now).toISOString(), member.kind, member.id);
        return { agreed: true as const, version: checked };
      });
    },
    replace(actor: CommunityAuthor, version: unknown, value: unknown, now = Date.now()) {
      return tx(() => {
        if (actor.kind !== 'owner') throw fail('只有作者能修改社区公约。', 403);
        assertCurrent(version);
        if (!state(actor).agreed) throw fail('请先阅读并同意当前社区公约。', 428);
        const body = safeBody(value), previous = current();
        if (previous.body === body) return previous;
        const saved = { version: randomUUID(), body };
        insert.run(saved.version, saved.body, actor.kind, actor.id, new Date(now).toISOString());
        return saved;
      });
    },
  };
}
export type CommunityConvention = ReturnType<typeof createCommunityConvention>;
