import { HttpError } from "react-admin";
import type {
  DataProvider,
  GetListParams,
  GetListResult,
  GetOneParams,
  GetOneResult,
  RaRecord,
} from "react-admin";
import type {
  AdminReader,
  AdminReaderAction,
  AdminReaderActionOptions,
  AdminReadersResponse,
  AdminReaderLogin,
  AdminReaderDeletion,
  AdminProfileAdvice,
  AdminProfileReview,
  AdminProfileDecision,
  AdminProfileReviewOptions,
  AdminProfileReviewResult,
} from "./types.ts";

export type AdminConsoleDataProvider = DataProvider & {
  readerLogins(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<AdminReaderLogin[]>;
  saveReaderUid(
    id: string,
    uid: string,
    options?: { signal?: AbortSignal },
  ): Promise<AdminReader>;
  deleteReaderAccount(
    id: string,
    confirmEmail: string,
    options?: { signal?: AbortSignal },
  ): Promise<AdminReaderDeletion>;
  saveReaderRemark(
    id: string,
    remark: string,
    options?: { signal?: AbortSignal },
  ): Promise<AdminReader>;
  readerAction(
    id: string,
    action: AdminReaderAction,
    options?: AdminReaderActionOptions,
  ): Promise<AdminReader>;
  reviewProfile(
    id: string,
    decision: AdminProfileDecision,
    options?: AdminProfileReviewOptions,
  ): Promise<AdminProfileReviewResult>;
  clearIdentityCache(): void;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions: readonly AdminReaderAction[] = [
  "disable",
  "enable",
  "revoke",
  "vip-grant",
  "vip-add-days",
  "vip-revoke",
];
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const invalidResponse = (): never => {
  throw new HttpError("服务器返回的数据格式无效，请刷新重试。", 502);
};
const text = (value: unknown): string =>
  typeof value === "string" ? value : invalidResponse();
const nullableText = (value: unknown): string | null =>
  value === null ? null : text(value);
const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidResponse();
const count = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse();
const object = (value: unknown): Record<string, unknown> =>
  record(value) ? value : invalidResponse();
const idInput = (value: unknown): string => {
  if (typeof value !== "string" || !uuid.test(value))
    throw new HttpError("请选择有效的记录。", 400);
  return value;
};
const unsupported = async (): Promise<never> => {
  throw new HttpError("此操作不受支持，请使用对应的账号或审核操作。", 405);
};

function parseReader(value: unknown): AdminReader {
  const row = object(value);
  const id = text(row.id),
    uid = text(row.uid);
  if (!uuid.test(id) || !/^\d{1,15}$/.test(uid)) return invalidResponse();
  return {
    id,
    uid,
    nickname: text(row.nickname),
    remark:
      row.remark === undefined || row.remark === null ? "" : text(row.remark),
    email: text(row.email),
    phone: text(row.phone),
    verified: bool(row.verified),
    disabled: bool(row.disabled),
    createdAt: text(row.createdAt),
    lastLoginIp: nullableText(row.lastLoginIp),
    lastLoginAt: nullableText(row.lastLoginAt),
    vip: bool(row.vip),
    vipStartedAt: nullableText(row.vipStartedAt),
    vipUntil: nullableText(row.vipUntil),
  };
}

function parseReaders(value: unknown): AdminReadersResponse {
  const result = object(value),
    summary = object(result.summary);
  if (!Array.isArray(result.users)) return invalidResponse();
  return {
    users: result.users.map(parseReader),
    page: count(result.page),
    totalPages: count(result.totalPages),
    total: count(result.total),
    summary: {
      total: count(summary.total),
      active: count(summary.active),
      disabled: count(summary.disabled),
      vip: count(summary.vip),
      expiredVip: count(summary.expiredVip),
    },
  };
}

function parseLogins(value: unknown): AdminReaderLogin[] {
  const result = object(value);
  if (!Array.isArray(result.events)) return invalidResponse();
  return result.events.map((entry: unknown) => {
    const row = object(entry),
      id = text(row.id),
      at = text(row.at);
    if (!uuid.test(id) || !Number.isFinite(Date.parse(at)))
      return invalidResponse();
    return {
      id,
      at,
      ip: text(row.ip),
      peerIp: text(row.peerIp),
      source: text(row.source),
      userAgent: text(row.userAgent),
    };
  });
}

function parseAdvice(value: unknown): AdminProfileAdvice {
  const row = object(value),
    by = object(row.by);
  if (
    (row.decision !== "approve" && row.decision !== "reject") ||
    (by.kind !== "owner" && by.kind !== "reader")
  )
    return invalidResponse();
  return {
    id: text(row.id),
    decision: row.decision,
    reason: text(row.reason),
    by: { kind: by.kind, id: text(by.id) },
    createdAt: text(row.createdAt),
  };
}

function parseProfiles(value: unknown): AdminProfileReview[] {
  const result = object(value);
  if (!Array.isArray(result.profiles)) return invalidResponse();
  return result.profiles.map((value: unknown) => {
    const row = object(value),
      id = text(row.id),
      readerId = text(row.readerId);
    if (
      !uuid.test(id) ||
      !uuid.test(readerId) ||
      !Array.isArray(row.advice) ||
      (row.kind !== "avatar" &&
        row.kind !== "signature" &&
        row.kind !== "nickname")
    )
      return invalidResponse();
    const avatarUrl = nullableText(row.avatarUrl),
      proposedValue = nullableText(row.proposedValue);
    if (
      row.kind === "avatar"
        ? avatarUrl !== `/api/manage/review/avatar/${id}.webp` ||
          proposedValue !== null
        : avatarUrl !== null
    )
      return invalidResponse();
    return {
      id,
      readerId,
      nickname: text(row.nickname),
      kind: row.kind,
      proposedValue,
      avatarUrl,
      createdAt: text(row.createdAt),
      advice: row.advice.map(parseAdvice),
    };
  });
}

function pageInput(params: GetListParams, fixedSize?: number) {
  const { page = 1, perPage = 20 } = params.pagination || {};
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100 ||
    (fixedSize !== undefined && perPage !== fixedSize)
  )
    throw new HttpError("分页参数无效，用户列表每页显示 20 人。", 400);
  return { page, perPage };
}

function searchInput(value: unknown): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string") throw new HttpError("搜索条件无效。", 400);
  return value.trim().slice(0, 80);
}

/** Adapt the existing owner-only commands; never expose direct collection CRUD. */
export function createAdminConsoleDataProvider(
  options: { fetch?: typeof fetch } = {},
): AdminConsoleDataProvider {
  const fetcher = options.fetch || globalThis.fetch;
  // Only lookup hints are retained. Reader details and permissions always come from a fresh request.
  const knownUids = new Map<string, string>();
  const pending = new Set<string>();
  let identityGeneration = 0;
  const clearIdentityCache = () => {
    identityGeneration++;
    knownUids.clear();
  };
  const remember = (rows: AdminReader[]) => {
    for (const row of rows) {
      knownUids.delete(row.id);
      knownUids.set(row.id, row.uid);
    }
    while (knownUids.size > 500) {
      const first = knownUids.keys().next().value;
      if (first) knownUids.delete(first);
    }
  };
  const request = async (
    url: string,
    signal?: AbortSignal,
    body?: object,
  ): Promise<unknown> => {
    const generation = identityGeneration;
    const response = await fetcher(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      ...(body === undefined
        ? {}
        : {
            headers: {
              "Content-Type": "application/json",
              "X-Author-Request": "1",
            },
            body: JSON.stringify(body),
          }),
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      value = null;
    }
    if (generation !== identityGeneration)
      throw new HttpError("登录身份已变化，请刷新后重试。", 409);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        clearIdentityCache();
      throw new HttpError(
        record(value) && typeof value.error === "string"
          ? value.error
          : "请求失败，请稍后重试。",
        response.status,
      );
    }
    if (value === null) return invalidResponse();
    return value;
  };
  const loadReaders = async (
    q: string,
    status: string,
    membership: string,
    page: number,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      q,
      status,
      membership,
      page: String(page),
    });
    const result = parseReaders(
      await request(`/api/manage/readers?${query}`, signal),
    );
    remember(result.users);
    return result;
  };
  const loadProfiles = async (signal?: AbortSignal) =>
    parseProfiles(await request("/api/manage/review", signal));
  const singleCommand = async <T>(
    key: string,
    command: () => Promise<T>,
  ): Promise<T> => {
    if (pending.has(key))
      throw new HttpError("该记录正在处理，请等待完成后再试。", 409);
    pending.add(key);
    try {
      return await command();
    } finally {
      pending.delete(key);
    }
  };

  return {
    supportAbortSignal: true,
    clearIdentityCache,
    async getList<RecordType extends RaRecord = RaRecord>(
      resource: string,
      params: GetListParams,
    ): Promise<GetListResult<RecordType>> {
      const filter = record(params.filter) ? params.filter : {};
      const q = searchInput(filter.q);
      if (resource === "readers" || resource === "memberships") {
        const { page } = pageInput(params, 20);
        const status = filter.status ?? "all",
          membership = filter.membership ?? "all";
        if (
          typeof status !== "string" ||
          !["all", "active", "disabled"].includes(status) ||
          typeof membership !== "string" ||
          !["all", "vip", "expired"].includes(membership)
        )
          throw new HttpError("筛选条件无效。", 400);
        const result = await loadReaders(
          q,
          status,
          membership,
          page,
          params.signal,
        );
        // React-admin selects the generic record shape by resource at its call site.
        return {
          data: result.users as unknown as RecordType[],
          total: result.total,
          meta: {
            summary: result.summary,
            page: result.page,
            totalPages: result.totalPages,
            serverSorted: true,
          },
        };
      }
      if (resource === "profile-reviews") {
        const { page, perPage } = pageInput(params),
          kind = filter.kind ?? "all";
        if (
          typeof kind !== "string" ||
          !["all", "avatar", "signature", "nickname"].includes(kind)
        )
          throw new HttpError("资料类型无效。", 400);
        const profiles = await loadProfiles(params.signal);
        const query = q.toLocaleLowerCase();
        const filtered = profiles.filter(
          (row) =>
            (kind === "all" || row.kind === kind) &&
            (!query ||
              `${row.nickname} ${row.proposedValue || ""}`
                .toLocaleLowerCase()
                .includes(query)),
        );
        const { field = "createdAt", order = "ASC" } = params.sort || {};
        if (field === "createdAt" || field === "nickname" || field === "kind") {
          filtered.sort(
            (a, b) =>
              (a[field].localeCompare(b[field]) || a.id.localeCompare(b.id)) *
              (order === "DESC" ? -1 : 1),
          );
        }
        return {
          data: filtered.slice(
            (page - 1) * perPage,
            page * perPage,
          ) as unknown as RecordType[],
          total: filtered.length,
          meta: {
            queueLimit: 100,
            loadedCount: profiles.length,
            mayHaveMore: profiles.length === 100,
          },
        };
      }
      throw new HttpError("不存在的管理列表。", 404);
    },
    async getOne<RecordType extends RaRecord = RaRecord>(
      resource: string,
      params: GetOneParams<RecordType>,
    ): Promise<GetOneResult<RecordType>> {
      const id = idInput(params.id);
      let row: AdminReader | AdminProfileReview | undefined;
      if (resource === "readers" || resource === "memberships") {
        const uid: unknown = record(params.meta)
          ? (params.meta.uid ?? knownUids.get(id))
          : knownUids.get(id);
        if (typeof uid !== "string" || !/^\d{1,15}$/.test(uid))
          throw new HttpError("请从用户列表打开账号详情。", 405);
        row = (
          await loadReaders(`UID ${uid}`, "all", "all", 1, params.signal)
        ).users.find((user) => user.id === id);
      } else if (resource === "profile-reviews")
        row = (await loadProfiles(params.signal)).find(
          (profile) => profile.id === id,
        );
      else throw new HttpError("不存在的管理列表。", 404);
      if (!row) throw new HttpError("记录不存在或已处理，请刷新列表。", 404);
      return { data: row as unknown as RecordType };
    },
    getMany: unsupported,
    getManyReference: unsupported,
    create: unsupported,
    update: unsupported,
    updateMany: unsupported,
    delete: unsupported,
    deleteMany: unsupported,
    async readerLogins(id, { signal } = {}) {
      idInput(id);
      return parseLogins(
        await request(`/api/manage/readers/${id}/logins`, signal),
      );
    },
    async saveReaderUid(id, uid, { signal } = {}) {
      idInput(id);
      if (
        typeof uid !== "string" ||
        !/^\d{4,9}$/.test(uid.trim()) ||
        Number(uid) < 1
      )
        throw new HttpError("UID 需要填写 4 至 9 位数字，且不能全为 0。", 400);
      return singleCommand(`reader:${id}`, async () => {
        const row = parseReader(
          await request(`/api/manage/readers/${id}/uid`, signal, {
            confirmId: id,
            uid: uid.trim(),
          }),
        );
        if (row.id !== id) return invalidResponse();
        remember([row]);
        return row;
      });
    },
    async deleteReaderAccount(id, confirmEmail, { signal } = {}) {
      idInput(id);
      if (typeof confirmEmail !== "string" || !confirmEmail.trim())
        throw new HttpError("请完整输入该账号的邮箱以确认删除。", 400);
      return singleCommand(`reader:${id}`, async () => {
        const result = object(
          await request(`/api/manage/readers/${id}/delete`, signal, {
            confirmId: id,
            confirmEmail: confirmEmail.trim(),
          }),
        );
        const uid = text(result.uid);
        if (
          result.id !== id ||
          result.deleted !== true ||
          !/^\d{1,15}$/.test(uid)
        )
          return invalidResponse();
        knownUids.delete(id);
        return { id, uid, deleted: true };
      });
    },
    async saveReaderRemark(id, remark, { signal } = {}) {
      idInput(id);
      if (typeof remark !== "string" || [...remark.trim()].length > 200)
        throw new HttpError("备注最多 200 个字。", 400);
      return singleCommand(`reader:${id}`, async () => {
        const row = parseReader(
          await request(`/api/manage/readers/${id}/remark`, signal, {
            confirmId: id,
            remark: remark.trim(),
          }),
        );
        if (row.id !== id) return invalidResponse();
        remember([row]);
        return row;
      });
    },
    async readerAction(id, action, { days, signal } = {}) {
      idInput(id);
      if (!actions.includes(action))
        throw new HttpError("不支持的账号操作。", 400);
      if (
        action === "vip-add-days" &&
        (!Number.isInteger(days) ||
          days === undefined ||
          days < 1 ||
          days > 365)
      )
        throw new HttpError("请输入 1 至 365 的整数天数。", 400);
      return singleCommand(`reader:${id}`, async () => {
        const row = parseReader(
          await request(`/api/manage/readers/${id}/${action}`, signal, {
            confirmId: id,
            ...(action === "vip-add-days" ? { days } : {}),
          }),
        );
        if (row.id !== id) return invalidResponse();
        remember([row]);
        return row;
      });
    },
    async reviewProfile(id, decision, { reason = "", signal } = {}) {
      idInput(id);
      if (
        (decision !== "approve" && decision !== "reject") ||
        typeof reason !== "string"
      )
        throw new HttpError("审核参数无效。", 400);
      reason = reason.trim();
      if (
        (decision === "reject" && !reason) ||
        [...reason].length > 200 ||
        /[\u0000-\u001f\u007f<>]/u.test(reason)
      )
        throw new HttpError("驳回需填写理由，最多 200 个字。", 400);
      return singleCommand(`profile:${id}`, async () => {
        const result = object(
          await request(
            `/api/manage/review/profile/${id}/${decision}`,
            signal,
            { reason },
          ),
        );
        if (result.ok !== true) return invalidResponse();
        return { ok: true };
      });
    },
  };
}
