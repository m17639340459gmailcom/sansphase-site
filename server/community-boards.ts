import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommunityBoard } from '../src/community.ts';
import { defaultCommunityBoards } from '../src/community.ts';
import { fail } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

export type CommunityBoardCatalog = { version: number; items: CommunityBoard[] };
export type NewCommunityBoard = { name?: unknown; description?: unknown; icon?: unknown; id?: unknown };
type BoardRow = { id: string; position: number; definition: string };
const safeId = /^[a-z][a-z0-9-]{1,47}$/;
const controls = /[\u0000-\u001f\u007f-\u009f<>]/;
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
function label(value: unknown, min: number, max: number, name: string) {
  if (typeof value !== 'string' || controls.test(value)) throw fail(`请填写有效的${name}。`);
  const text = normalize(value);
  if ([...text].length < min || [...text].length > max) throw fail(`${name}需要 ${min}–${max} 个字。`);
  return text;
}

/** Catalog and its version belong to one content.db; the source defaults stay immutable. */
export function createCommunityBoards(db: DatabaseSync, tx: Transaction, isOwner: (actor: CommunityAuthor) => boolean) {
  const versionRow = db.prepare('SELECT version FROM community_board_catalog WHERE id=1');
  const all = db.prepare('SELECT id,position,definition FROM community_boards ORDER BY position');
  const present = db.prepare('SELECT id FROM community_boards WHERE id=?');
  const insert = db.prepare('INSERT INTO community_boards(id,position,definition,created_at,actor_id) VALUES(?,?,?,?,?)');
  const bump = db.prepare('UPDATE community_board_catalog SET version=version+1 WHERE id=1 AND version=?');
  const position = db.prepare('UPDATE community_boards SET position=? WHERE id=?');
  const catalog = (): CommunityBoardCatalog => ({ version: Number((versionRow.get() as { version: number }).version),
    items: (all.all() as BoardRow[]).map(row => ({ ...(JSON.parse(row.definition) as CommunityBoard), id: row.id })) });
  const authorize = (actor: CommunityAuthor) => { if (!isOwner(actor)) throw fail('只有作者能创建和排列社区板块。', 403); };
  return {
    catalog,
    list: () => catalog().items,
    ids: () => (all.all() as BoardRow[]).map(row => row.id),
    has: (id: string) => Boolean(present.get(id)),
    create(input: NewCommunityBoard, actor: CommunityAuthor, now = new Date().toISOString()) {
      return tx(() => {
        authorize(actor);
        const name = label(input.name, 2, 24, '板块名称');
        const description = label(input.description, 2, 120, '板块说明');
        const icon = input.icon === undefined ? 'megaphone' : input.icon;
        const template = defaultCommunityBoards.find(board => board.icon === icon);
        if (!template) throw fail('请选择已有的板块图标。');
        const previous = catalog();
        if (previous.items.some(board => normalize(board.zh).toLocaleLowerCase() === name.toLocaleLowerCase())) throw fail('这个板块名称已经存在。');
        const id = input.id === undefined ? `board-${randomUUID().replaceAll('-', '').slice(0, 12)}` : input.id;
        if (typeof id !== 'string' || !safeId.test(id) || id === 'home' || present.get(id)) throw fail('板块标识无效或已被使用。');
        const board: CommunityBoard = { id, zh: name, en: name, description, descriptionEn: description,
          icon: template.icon, color: template.color, lightColor: template.lightColor, kind: '讨论帖', kindEn: 'Discussion',
          tips: ['围绕板块主题交流', '遵守社区公约'], tipsEn: ['Discuss the board topic', 'Follow the community convention'] };
        insert.run(id, previous.items.length, JSON.stringify(board), now, actor.id);
        if (bump.run(previous.version).changes !== 1) throw fail('板块已更新，请重新打开管理页面。', 409);
        return catalog();
      });
    },
    reorder(value: unknown, actor: CommunityAuthor, expectedVersion: unknown, _now = new Date().toISOString()) {
      return tx(() => {
        authorize(actor);
        if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) throw fail('板块版本无效，请重新打开管理页面。');
        const previous = catalog();
        if (previous.version !== expectedVersion) throw fail('板块已被更新，请刷新后再保存顺序。', 409);
        if (!Array.isArray(value) || value.length !== previous.items.length || new Set(value).size !== value.length
          || value.some(id => typeof id !== 'string' || !previous.items.some(board => board.id === id))) throw fail('请提交全部板块的有效排列顺序。');
        if (previous.items.every((board, index) => board.id === value[index])) return previous;
        // Move to an unused positive range first so UNIQUE(position) stays true during swaps.
        const offset = previous.items.length;
        previous.items.forEach((board, index) => position.run(offset + index, board.id));
        value.forEach((id: string, index: number) => position.run(index, id));
        if (bump.run(previous.version).changes !== 1) throw fail('板块已更新，请刷新后再保存顺序。', 409);
        return catalog();
      });
    },
  };
}
