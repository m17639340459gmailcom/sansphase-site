import { HttpError } from "react-admin";

export const cleanupKinds = ["expired", "files", "versions", "media"] as const;
export type CleanupKind = (typeof cleanupKinds)[number];
export type CleanupRow = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  needsRetry: boolean;
};
export type CleanupQueues = Record<CleanupKind, CleanupRow[]>;
export type CleanupResult = {
  cleaned: number;
  failed: number;
  protected: number;
  shared: number;
  deferred: boolean;
};
export const activityNames = {
  disable: "停用账号",
  enable: "恢复账号",
  revoke: "退出所有登录",
  delete: "删除账号",
  "auto-delete-inactive": "清理长期未登录账号",
  "vip-grant": "开通或续期 VIP",
  "vip-add-days": "增加 VIP 天数",
  "vip-revoke": "取消 VIP",
  "uid-change": "修改 UID",
  remark: "修改管理备注",
} as const;
export type ActivityAction = keyof typeof activityNames;
export type ActivityRow = {
  action: ActivityAction;
  at: string;
  readerId: string;
  uid?: string;
  days?: number;
  until?: string;
  from?: string;
  to?: string;
  cleared?: boolean;
  length?: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badResponse = (): never => {
  throw new HttpError("返回的数据不完整，请刷新后重试。", 502);
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return badResponse();
  return value as Record<string, unknown>;
}
const text = (value: unknown) =>
  typeof value === "string" ? value : badResponse();
const id = (value: unknown) => {
  const result = text(value);
  return uuid.test(result) ? result : badResponse();
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : badResponse();
const date = (value: unknown) => {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : badResponse();
};
const optionalText = (value: unknown) => (value == null ? "" : text(value));
function parseQueues(value: unknown): CleanupQueues {
  const source = object(value);
  const result: CleanupQueues = {
    expired: [],
    files: [],
    versions: [],
    media: [],
  };
  for (const kind of cleanupKinds) {
    const rows = source[kind];
    if (!Array.isArray(rows) || rows.length > (kind === "expired" ? 200 : 100))
      return badResponse();
    result[kind] = rows.map((value) => {
      const row = object(value),
        key = id(row.id);
      const base = {
        id: key,
        needsRetry: Boolean(optionalText(row.last_error)),
      };
      if (kind === "expired")
        return {
          ...base,
          title: text(row.email),
          description: "验证申请已过期",
          createdAt: date(row.expiresAt),
        };
      if (kind === "files")
        return {
          ...base,
          title: "待清理头像",
          description: text(row.filename),
          createdAt: date(row.created_at),
        };
      if (kind === "versions") {
        const names: Record<string, string> = {
          articles: "文章",
          library_entries: "资源",
          announcements: "公告",
          site_profile: "站点资料",
        };
        return {
          ...base,
          title: `已删除${names[text(row.collection)] || "内容"}的旧版本`,
          description: `内容编号 ${id(row.parent_id)}`,
          createdAt: date(row.created_at),
        };
      }
      return {
        ...base,
        title: "待清理内容附件",
        description: `附件编号 ${id(row.media_id)}`,
        createdAt: date(row.created_at),
      };
    });
    if (new Set(result[kind].map((row) => row.id)).size !== result[kind].length)
      return badResponse();
  }
  return result;
}
function parseActivity(value: unknown): ActivityRow[] {
  const events = object(value).events;
  if (!Array.isArray(events) || events.length > 20) return badResponse();
  return events.map((value) => {
    const row = object(value),
      action = text(row.action);
    if (!Object.hasOwn(activityNames, action)) return badResponse();
    const result: ActivityRow = {
      action: action as ActivityAction,
      at: date(row.at),
      readerId: id(row.readerId),
    };
    if (row.uid != null) result.uid = text(row.uid);
    if (action === "vip-add-days") result.days = count(row.days);
    if (row.until != null) result.until = date(row.until);
    if (action === "uid-change") {
      result.from = text(row.from);
      result.to = text(row.to);
    }
    if (action === "remark") {
      if (typeof row.cleared !== "boolean") return badResponse();
      result.cleared = row.cleared;
      result.length = count(row.length);
    }
    return result;
  });
}
export function retainCleanupSelection(
  selected: readonly string[],
  rows: readonly CleanupRow[],
) {
  const present = new Set(rows.map((row) => row.id));
  return selected.filter((value) => present.has(value));
}
export function cleanupFeedback(
  result: CleanupResult,
  requested: number,
): { severity: "success" | "info" | "warning"; message: string } {
  const pieces = [`已处理 ${result.cleaned} 项`];
  if (result.protected) pieces.push(`仍在使用，保留 ${result.protected} 项`);
  if (result.shared) pieces.push(`共享附件保留 ${result.shared} 项`);
  if (result.failed) pieces.push(`失败 ${result.failed} 项，可再次重试`);
  const remaining = Math.max(
    0,
    requested -
      result.cleaned -
      result.failed -
      result.protected -
      result.shared,
  );
  if (remaining)
    pieces.push(`未处理 ${remaining} 项，可能已变化或已由系统处理`);
  if (result.deferred) pieces.push("附件清理暂缓，请先重试旧版本清理");
  return {
    severity:
      result.failed || result.deferred || remaining
        ? "warning"
        : result.protected || result.shared
          ? "info"
          : "success",
    message: pieces.join("；") + "。",
  };
}
export function createMaintenanceApi(options: { fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  let writing = false;
  async function request(
    path: string,
    signal?: AbortSignal,
    body?: object,
  ): Promise<unknown> {
    const response = await fetcher("/api/manage/" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      ...(body
        ? {
            headers: {
              "Content-Type": "application/json",
              "X-Author-Request": "1",
            },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const value: unknown = await response.json().catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    });
    if (!response.ok)
      throw new HttpError(
        value &&
          typeof value === "object" &&
          "error" in value &&
          typeof value.error === "string"
          ? value.error
          : "请求未完成，请稍后重试。",
        response.status,
      );
    return value;
  }
  return {
    async loadQueues(signal?: AbortSignal) {
      return parseQueues(await request("review", signal));
    },
    async loadActivity(signal?: AbortSignal) {
      return parseActivity(await request("audit", signal));
    },
    async cleanup(
      kind: CleanupKind,
      selected: readonly string[],
      displayed: readonly CleanupRow[],
      signal?: AbortSignal,
    ): Promise<CleanupResult> {
      if (
        !cleanupKinds.includes(kind) ||
        selected.length < 1 ||
        selected.length > 100 ||
        selected.some((value) => !uuid.test(value)) ||
        retainCleanupSelection(selected, displayed).length !== selected.length
      )
        throw new HttpError("请从当前列表中选择 1 至 100 项。", 400);
      if (writing) throw new HttpError("正在处理，请勿重复提交。", 409);
      writing = true;
      try {
        const source = object(
          await request(`review/${kind}/cleanup`, signal, {
            ids: [...new Set(selected)],
          }),
        );
        const result = {
          cleaned: count(source.cleaned),
          failed: count(source.failed ?? 0),
          protected: count(source.protected ?? 0),
          shared: count(source.shared ?? 0),
          deferred: source.deferred === true,
        };
        if (source.deferred != null && typeof source.deferred !== "boolean")
          return badResponse();
        if (
          result.cleaned + result.failed + result.protected + result.shared >
          new Set(selected).size
        )
          return badResponse();
        return result;
      } finally {
        writing = false;
      }
    },
  };
}
