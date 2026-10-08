import type { IncomingMessage, ServerResponse } from 'node:http';
import { communityTags, communityRules, communityUsages, communityResourceKinds, communityResourcePrices, imageLimit } from '../src/community-rules.mjs';
import type { PromptMode } from '../src/community-rules.ts';
import type { CommunityPerson } from '../src/community.ts';
import { fail } from './community-db.ts';
import type { CommunityAuthor } from './community-db.ts';
import type { CommunityAuditDetails } from './community-audit.ts';
import type { CommunityStore, StoredTopic, ShowcaseMeta, ResourceMeta } from './community-store.ts';
import { imageIdFromLine } from '../src/community-body-images.ts';
import type { OwnerReaderPreview } from './community-owner-reader-preview.ts';
import type { CommunityProfileAccess } from './community-profile-access.ts';
import type { CommunityStaffPermission, CommunityStaffState } from '../src/community-staff.ts';

// The signed-in member making a request.
export type CommunityViewer = { kind: 'reader' | 'owner'; id: string; name: string; vip: boolean; ownerAccountId?: string };
// What the site knows about a member outside the community: nickname, public UID,
// approved avatar, VIP, registration time and approved signature.
export type PersonInfo = { name: string; uid: string | null; avatar: string | null; vip: boolean; joinedAt: string | null; bio: string; ownerReader?: true; active?: boolean };
export type ServiceOptions = {
  store: CommunityStore | null;
  siteOrigin: string;
  // Private data directory: images are kept in its uploads/ folder.
  directory?: string;
  ownerId?: string;
  identify: (req: IncomingMessage) => Promise<CommunityViewer | null>;
  // A verified owner can act through one explicitly linked real reader.
  ownerReaderIdentity?: (req: IncomingMessage) => Promise<CommunityViewer | null>;
  // Optional host session guard, rechecked synchronously after asynchronous
  // work and immediately before any request can recreate community data.
  assertActive?: (req: IncomingMessage) => void;
  // Members' profiles, keyed `${kind}:${id}`; missing means the account is gone.
  people: (authors: CommunityAuthor[]) => Promise<Map<string, PersonInfo>>;
  // A member by public UID ('owner' is the site owner), and by exact nickname (for @mentions).
  findMember?: (uid: string) => Promise<CommunityAuthor | null>;
  findByNames?: (names: string[]) => Promise<Map<string, CommunityAuthor>>;
  // The approved avatar file of a reader, for other members.
  avatarFile?: (uid: string) => Promise<string | null>;
  // Approved bytes provided by the account authority on a separate host.
  avatarBytes?: (uid: string) => Promise<Buffer | null>;
  profile?: CommunityProfileAccess;
  // Mirror committed database audit events to the existing private audit log.
  audit?: (action: string, details: Record<string, unknown>) => Promise<void>;
  // Drain the host's existing persistent cleanup queue after SQL commits.
  drainFileQueue?: () => Promise<unknown>;
  // Words that may not appear in posts (private configuration).
  words?: readonly string[];
  // Required title, body text and inline cover. False is only for legacy API compatibility.
  simplePosting?: boolean;
};
export type Body = Record<string, unknown>;
export type Ctx = {
  req: IncomingMessage; res: ServerResponse; url: URL; path: string; method: string;
  viewer: CommunityViewer; me: CommunityAuthor; live: CommunityStore; options: ServiceOptions;
  // Ordinary trust includes the active general's temporary maximum projection;
  // earned trust remains stored separately, and board moderation stays capability based.
  level: number; trustLevel: number; owner: boolean; mod: boolean; ownerMember: CommunityAuthor;
  moderationBoards: string[];
  staff: CommunityStaffState | null;
  canStaff: (permission: CommunityStaffPermission, board?: string) => boolean;
  requireStaff: (permission: CommunityStaffPermission, board?: string) => void;
  refreshStaff: (related?: readonly CommunityAuthor[]) => Promise<void>;
  canModerateBoard: (board: string) => boolean;
  actualOwner: boolean; actualMod: boolean; browsingAsReader: boolean; readOnly: boolean;
  ownerReaderPreview: OwnerReaderPreview | null;
  canSeeBoard: (board: string) => boolean; hiddenBoard: string;
  send: (body: unknown, status?: number) => void;
  json: () => Promise<Body>;
  people: (authors: CommunityAuthor[]) => Promise<Map<string, PersonInfo>>;
  person: (author: CommunityAuthor, map: Map<string, PersonInfo>) => CommunityPerson;
  topicDTO: (topic: StoredTopic, map: Map<string, PersonInfo>) => Record<string, unknown>;
  topicsDTO: (topics: StoredTopic[]) => Promise<Record<string, unknown>[]>;
  throttle: (kind: 'topic' | 'reply' | 'image' | 'report' | 'action') => void;
  requireConsent: () => void;
  auditMutation: <T>(action: string, execute: () => T, details?: CommunityAuditDetails<T>) => Promise<T>;
  clean: (value: unknown, limits: readonly [number, number], label: string, multiline: boolean, imageIds?: readonly string[]) => string;
  mentions: (body: string) => Promise<CommunityAuthor[]>;
};

// Obvious contact details (lead generation). Unlike reader signatures, the
// word 微信 alone is fine here: posts legitimately discuss WeChat.
export function communityContactReason(value: string) {
  const text = value.normalize('NFKC').toLowerCase();
  // Match a whole number, not an eleven-digit slice of a news URL or ID.
  // Allow the existing phone separators without joining separate numeric tokens.
  if (/(?<!\d)(?:(?:\+?86|0086)[\s\u200b-\u200d\u2060·._－—-]*)?1[\s\u200b-\u200d\u2060·._－—-]*[3-9](?:[\s\u200b-\u200d\u2060·._－—-]*\d){9}(?!\d)/u.test(text)) return '帖子里不能留手机号。';
  const normalized = text.replace(/[\s​-‍⁠·._－—-]/gu, '');
  if (/(?:加|\+|添加)(?:我)?(?:微信|vx|wx|v信|威信)|(?:vx|wx|v信|微信号|威信)[:：]?[a-z0-9_]{5,}/iu.test(normalized)) return '帖子里不能留微信等联系方式。';
  return null;
}
const controls = /[\u0000-\u0008\u000b-\u001f\u007f]/u;
export function cleanText(value: unknown, [min, max]: readonly [number, number], label: string, multiline: boolean, words: readonly string[] = [], imageIds: readonly string[] = []) {
  if (typeof value !== 'string') throw fail(`请填写${label}。`);
  const cleaned = (multiline ? value.replace(/\r\n?/g, '\n') : value).trim();
  const length = [...cleaned].length;
  if (length < min) throw fail(`${label}至少 ${min} 个字。`);
  if (length > max) throw fail(`${label}最多 ${max} 个字。`);
  if (controls.test(cleaned) || (!multiline && /[\n\t]/.test(cleaned))) throw fail(`${label}里有无法显示的字符。`);
  // Internal attachment identifiers are not authored contact information. Strip
  // only exact attached image URLs from recognized blocks, retaining captions.
  // The store still checks that every attachment belongs to the post's author.
  const attached = new Set(imageIds);
  const authored = attached.size ? cleaned.split('\n').map(line => {
    const id = imageIdFromLine(line);
    return id && attached.has(id) ? line.replace(`/api/community/images/${id}.webp`, '') : line;
  }).join('\n') : cleaned;
  const contact = communityContactReason(authored);
  if (contact) throw fail(contact);
  const lower = authored.normalize('NFKC').toLowerCase();
  if (words.some(word => word && lower.includes(word))) throw fail(`${label}里有不允许的内容，请修改后再发。`);
  return cleaned;
}
export function tagList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(tag => !(communityTags as readonly string[]).includes(String(tag)))) throw fail('请从列表里选择标签。');
  const tags = [...new Set(value.map(String))];
  if (tags.length > communityRules.tagMax) throw fail(`最多选 ${communityRules.tagMax} 个标签。`);
  return tags;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function imageList(value: unknown, board: string, level: number, simple = false) {
  if (value === undefined) return [];
  const max = imageLimit(simple && board === 'tools' ? 'qa' : board, level);
  if (!Array.isArray(value) || value.some(id => !uuid.test(String(id)))) throw fail('图片无效，请重新上传。');
  const images = [...new Set(value.map(String))];
  if (images.length > max) throw fail(max === 0 ? '这个版块的帖子不配图。' : level < 1 && max === communityRules.l0Images ? `初光等级每帖最多 ${max} 张图。` : `这个版块每帖最多 ${max} 张图。`);
  return images;
}
const short = (value: unknown, max: number, label: string, required = false) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw fail(`请填写${label}。`);
  if ([...text].length > max) throw fail(`${label}最多 ${max} 个字。`);
  if (controls.test(text) || /[\n\t<>]/.test(text)) throw fail(`${label}里有无法显示的字符。`);
  return text;
};
// 作品帖：工具必填；提示词公开、不公开或星尘解锁（5–50）。没写提示词就是不公开。
export function showcaseMeta(body: Body, optional = false): ShowcaseMeta {
  const usage = String(body.usage || (optional ? '' : communityUsages[0]));
  if (usage && !(communityUsages as readonly string[]).includes(usage)) throw fail('请选择作品用途。');
  const prompt = typeof body.prompt === 'string' ? body.prompt.replace(/\r\n?/g, '\n').trim() : '';
  if ([...prompt].length > 4000) throw fail('提示词最多 4000 个字。');
  if (controls.test(prompt)) throw fail('提示词里有无法显示的字符。');
  let promptMode = String(body.promptMode || 'public') as PromptMode;
  if (!['public', 'hidden', 'paid'].includes(promptMode)) throw fail('请选择提示词给谁看。');
  if (!prompt) promptMode = 'hidden';
  const price = promptMode === 'paid' ? Number(body.promptPrice) : 0;
  if (promptMode === 'paid' && (!Number.isInteger(price) || price < communityRules.unlockMin || price > communityRules.unlockMax))
    throw fail(`解锁价格在 ${communityRules.unlockMin} 到 ${communityRules.unlockMax} 星尘之间。`);
  return { tools: short(body.tools, 80, '工具', !optional), model: short(body.model, 80, '模型'), usage, prompt, promptMode, price };
}
// 资源帖：链接必填（http 或 https），类型、价格从列表里选，平台可选。
export function resourceMeta(body: Body, optional = false): ResourceMeta | null {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (optional && !url) return null;
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.') || url.length > 500) throw fail('请填写正确的链接，以 http:// 或 https:// 开头。');
  const kind = String(body.kind || (optional ? '' : communityResourceKinds[0])), price = String(body.price || (optional ? '' : communityResourcePrices[0]));
  if (kind && !(communityResourceKinds as readonly string[]).includes(kind)) throw fail('请选择资源类型。');
  if (price && !(communityResourcePrices as readonly string[]).includes(price)) throw fail('请选择价格。');
  return { url: parsed.href, kind, price, platform: short(body.platform, 60, '平台') };
}
