import { isTeahouseManager } from '../teahouse-types.ts';
import type { TeahouseActor, TeahouseAnnouncement, TeahouseMessage, TeahouseSendInput } from '../teahouse-types.ts';

/** Merge HTTP history and live events by mutation cursor, preserving terminal withdrawals. */
export function mergeMessages(current: Map<string, TeahouseMessage>, incoming: readonly TeahouseMessage[], purgedReaders?: ReadonlySet<string>): TeahouseMessage[] {
  const changed: TeahouseMessage[] = [];
  for (const original of incoming) {
    const item: TeahouseMessage = original.author.kind === 'reader' && purgedReaders?.has(original.author.id)
      ? { ...original, withdrawn: true, text: undefined, attachments: [], author: { kind: 'reader', id: original.author.id, name: '已注销用户', icon: null } }
      : original;
    const existing = current.get(item.id);
    if (existing?.withdrawn && !item.withdrawn) continue;
    if (existing && existing.revisionSeq > item.revisionSeq) continue;
    if (existing && existing.revisionSeq === item.revisionSeq && (!item.withdrawn || existing.withdrawn)) {
      if (JSON.stringify(existing.author) !== JSON.stringify(item.author)) {
        const refreshed = { ...existing, author: item.author };
        current.set(item.id, refreshed); changed.push(refreshed);
      }
      continue;
    }
    const next = item.withdrawn ? { ...item, text: undefined, attachments: [] } : item;
    current.set(item.id, next);
    changed.push(next);
  }
  return changed.sort((left, right) => left.seq - right.seq);
}

export function createPendingSend(previous: TeahouseSendInput | undefined, text: string, attachmentIds: string[], uuid: () => string = () => crypto.randomUUID()): TeahouseSendInput {
  if (previous && previous.text === text && JSON.stringify(previous.attachmentIds ?? []) === JSON.stringify(attachmentIds)) return previous;
  return { id: uuid(), text, attachmentIds: [...attachmentIds] };
}

export function mayWithdraw(actor: TeahouseActor, message: TeahouseMessage, serverNow: number): boolean {
  if (message.withdrawn) return false;
  if (isTeahouseManager(actor)) return true;
  const elapsed = serverNow - Date.parse(message.createdAt);
  return actor.kind === message.author.kind && actor.id === message.author.id && elapsed >= 0 && elapsed < 300000;
}

export function mayEditAnnouncement(actor: TeahouseActor, announcement: TeahouseAnnouncement): boolean {
  return actor.role === 'owner' || actor.role === 'general' || actor.role === 'moderator' && actor.kind === announcement.author.kind && actor.id === announcement.author.id;
}
