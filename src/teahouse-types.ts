import type { CommunityIconRef } from './community-icon-policy.ts';

export type TeahouseRole = 'owner' | 'general' | 'moderator' | 'assistant' | null;

/** Trusted, freshly resolved account data; never accepted from a socket payload. */
export interface TeahouseActor {
  kind: 'reader' | 'owner';
  id: string;
  /** Public community profile UID; distinct from the internal account id. */
  uid?: string | null;
  name: string;
  avatarUrl?: string;
  role: TeahouseRole;
  vip: boolean;
  /** Current community-wide sanction; chat writes must enforce this too. */
  muted?: boolean;
  /** Current single equipped community icon; atlas achievements use the same renderer. */
  icon?: CommunityIconRef | null;
}

export interface TeahouseAuthor {
  kind: 'reader' | 'owner';
  id: string;
  name: string;
  avatarUrl?: string;
  icon?: CommunityIconRef | null;
}

export interface TeahouseAttachment {
  id: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  width: number;
  height: number;
  url: string;
}

export interface TeahouseMessage {
  id: string;
  /** Stable creation order, independent of later withdrawals. */
  seq: number;
  /** Last mutation cursor; withdrawal must also be replayed after reconnection. */
  revisionSeq: number;
  author: TeahouseAuthor;
  createdAt: string;
  withdrawn: boolean;
  withdrawnAt?: string;
  text?: string;
  attachments: TeahouseAttachment[];
}

export interface TeahouseSendInput {
  id: string;
  text: string;
  attachmentIds?: string[];
}

export interface TeahouseHistoryQuery {
  before?: number;
  after?: number;
  limit?: number;
}

export interface TeahouseHistory {
  messages: TeahouseMessage[];
  hasMore: boolean;
  /** Replay cursor, advance only after merging this entire response. */
  cursor: number;
}

export interface TeahouseAnnouncement {
  id: string;
  title: string;
  text: string;
  author: TeahouseAuthor;
  createdAt: string;
  updatedAt: string;
  revision: number;
  pinned: boolean;
}

export interface TeahouseAnnouncementInput {
  id?: string;
  title: string;
  text: string;
  revision?: number;
  pinned?: boolean;
}

export function isTeahouseManager(actor: Pick<TeahouseActor, 'role'>): boolean {
  return actor.role === 'owner' || actor.role === 'general' || actor.role === 'moderator';
}

export function canEnterTeahouse(actor: Pick<TeahouseActor, 'role' | 'vip'>): boolean {
  return actor.vip === true || isTeahouseManager(actor);
}
