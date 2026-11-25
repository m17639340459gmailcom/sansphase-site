/** Existing /api/manage DTOs. These are projected fields, never Payload documents. */
export type AdminReader = {
  id: string;
  uid: string;
  nickname: string;
  remark: string;
  email: string;
  phone: string;
  verified: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginIp: string | null;
  lastLoginAt: string | null;
  vip: boolean;
  vipStartedAt: string | null;
  vipUntil: string | null;
};

export type AdminReaderSummary = {
  total: number;
  active: number;
  disabled: number;
  vip: number;
  expiredVip: number;
};

export type AdminReadersResponse = {
  users: AdminReader[];
  page: number;
  totalPages: number;
  total: number;
  summary: AdminReaderSummary;
};

export type AdminReaderLogin = {
  id: string;
  at: string;
  ip: string;
  peerIp: string;
  source: string;
  userAgent: string;
};
export type AdminReaderDeletion = { id: string; uid: string; deleted: true };

export type AdminProfileKind = "avatar" | "signature" | "nickname";
export type AdminProfileAdvice = {
  id: string;
  decision: "approve" | "reject";
  reason: string;
  by: { kind: "owner" | "reader"; id: string };
  createdAt: string;
};

export type AdminProfileReview = {
  id: string;
  readerId: string;
  nickname: string;
  kind: AdminProfileKind;
  proposedValue: string | null;
  avatarUrl: string | null;
  createdAt: string;
  advice: AdminProfileAdvice[];
};

export type AdminReaderAction =
  "disable" | "enable" | "revoke" | "vip-grant" | "vip-add-days" | "vip-revoke";
export type AdminReaderActionOptions = { days?: number; signal?: AbortSignal };
export type AdminProfileDecision = "approve" | "reject";
export type AdminProfileReviewOptions = {
  reason?: string;
  signal?: AbortSignal;
};
export type AdminProfileReviewResult = { ok: true };

export type AdminReaderFilter = {
  q?: string;
  status?: "all" | "active" | "disabled";
  membership?: "all" | "vip" | "expired";
};
export type AdminProfileFilter = {
  q?: string;
  kind?: AdminProfileKind | "all";
};
