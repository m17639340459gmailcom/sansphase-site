import { communityBoards } from '../src/community.mjs';
import { fail, memberKey } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { CommunityStore } from './community-store.ts';
import type { PersonInfo } from './community-context.ts';

export type ModerationContact = { qq: string; email: string };
const qqPattern = /^[1-9]\d{4,11}$/;
const emailPattern = /^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const validEmail = (value: string) => value.length <= 254 && value.split('@')[0].length <= 64
  && !value.startsWith('.') && !value.split('@')[0].endsWith('.') && !value.includes('..') && emailPattern.test(value);

// These are voluntarily public identifiers, never copied from account credentials.
export function validateModerationContact(input: Record<string, unknown>): ModerationContact {
  if (Object.keys(input).some(key => key !== 'qq' && key !== 'email')) throw fail('只能设置自己的 QQ 和联系邮箱。');
  if (typeof input.qq !== 'string' || typeof input.email !== 'string') throw fail('请填写 QQ 或联系邮箱；不公开的项目留空。');
  if (/[^\x20-\x7e]/.test(input.qq + input.email)) throw fail('联系方式不能包含控制字符或无法显示的字符。');
  const qq = input.qq.trim(), email = input.email.trim();
  if (qq && !qqPattern.test(qq)) throw fail('QQ 号码应为 5–12 位数字。');
  if (email && !validEmail(email)) throw fail('请填写正确的联系邮箱。');
  return { qq, email };
}

export function storedModerationContact(qq: string | null, email: string | null): ModerationContact {
  return { qq: qq && qqPattern.test(qq) ? qq : '', email: email && validEmail(email) ? email : '' };
}

// Explicit voluntary-contact DTO for signed-in readers, including muted accounts.
export async function publicModerationContacts(store: CommunityStore, owner: CommunityAuthor,
  people: (authors: CommunityAuthor[]) => Promise<Map<string, PersonInfo>>, board: string) {
  if (board && !communityBoards.some(item => item.id === board)) throw fail('板块不存在。');
  const candidates = [owner, ...store.members.stewards()].filter(member => {
    const boards = store.members.moderationBoards(member);
    return boards.length > 0 && (!board || boards.includes(board));
  });
  const map = await people(candidates);
  const items = candidates.flatMap(member => {
    // Appointments and public settings can change while profiles are being resolved.
    const boards = store.members.moderationBoards(member);
    const info = map.get(memberKey(member));
    const contact = store.members.moderationContact(member);
    if (!info?.uid || !boards.length || board && !boards.includes(board) || !contact || !contact.qq && !contact.email) return [];
    return [{ uid: info.uid, name: info.name, owner: member.kind === 'owner', boards, ...contact }];
  });
  return { items };
}
