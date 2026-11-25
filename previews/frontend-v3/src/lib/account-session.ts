import { withRequestDeadline } from "./request-deadline.ts";

type Role = "reader" | "owner";
type Account = { role: "owner"; name: string } | { role: "reader"; name: string; uid: string | null; vip: boolean };
type AccountFailure = "credentials" | "verification" | "rateLimit" | "unavailable" | "accountRequired" | "invalidDetails";

export class AccountRequestError extends Error {
  readonly code: AccountFailure;
  readonly detail?: string;

  constructor(code: AccountFailure, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function readIdentity(value: unknown, role: Role): Account | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new AccountRequestError("unavailable");
  if (role === "owner" && "name" in value && typeof value.name === "string") {
    return { role, name: value.name };
  }
  if (role === "reader" && "nickname" in value && typeof value.nickname === "string") {
    return {
      role, name: value.nickname,
      uid: "uid" in value && typeof value.uid === "string" ? value.uid : null,
      vip: "vip" in value && value.vip === true,
    };
  }
  throw new AccountRequestError("unavailable");
}

async function accountRequest(
  path: string, intent: "reader" | "author", signal: AbortSignal, request: typeof fetch,
  payload?: object, proof?: string | null, credentials: RequestCredentials = "same-origin",
): Promise<unknown> {
  const headers = new Headers({ [intent === "reader" ? "X-Reader-Request" : "X-Author-Request"]: "1" });
  const multipart = payload instanceof FormData;
  if (payload && !multipart) headers.set("Content-Type", "application/json");
  if (proof) headers.set("X-Login-Verification", proof);
  return withRequestDeadline(signal, payload ? 30_000 : 8_000, async (requestSignal) => {
    const response = await request(path, {
      method: payload ? "POST" : "GET",
      body: multipart ? payload : payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      credentials,
      redirect: "error",
      headers,
      signal: requestSignal,
    });
    if (path === "/api/reader/login" && response.status === 401) throw new AccountRequestError("credentials");
    if (path === "/api/reader/login" && response.status === 403) throw new AccountRequestError("verification");
    if (response.status === 429) throw new AccountRequestError("rateLimit");
    if (response.status === 401) throw new AccountRequestError("accountRequired");
    if ([400, 409, 413, 415, 422].includes(response.status)) {
      const value: unknown = await response.json().catch(() => null);
      const detail = value && typeof value === "object" && "error" in value &&
        typeof value.error === "string" && value.error.length <= 300 ? value.error : undefined;
      throw new AccountRequestError("invalidDetails", detail);
    }
    if (!response.ok) throw new AccountRequestError("unavailable");
    return response.json();
  });
}

export async function readAccount(signal: AbortSignal, request = fetch) {
  const [owner, reader] = await Promise.all([
    accountRequest("/api/author/session", "author", signal, request),
    accountRequest("/api/reader/session", "reader", signal, request),
  ]);
  return readIdentity(owner, "owner") ?? readIdentity(reader, "reader");
}

export async function signIn(email: string, password: string, proof: string | null, signal: AbortSignal, request = fetch) {
  const value = await accountRequest("/api/reader/login", "reader", signal, request, { email, password }, proof);
  const role = value && typeof value === "object" && "role" in value && value.role === "owner" ? "owner" : "reader";
  const account = readIdentity(value, role);
  if (!account) throw new AccountRequestError("unavailable");
  return account;
}

export async function signOut(role: Role, signal: AbortSignal, request = fetch) {
  const intent = role === "owner" ? "author" : "reader";
  await accountRequest(`/api/${intent}/logout`, intent, signal, request, {});
}

type Registration = { email: string; nickname: string; phone: string; password: string; inviteCode?: string };
type ReaderProfileInput = { nickname: string; signature: string; phone?: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

export function isRegistrationRequestId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export async function readerRegistrationEnabled(signal: AbortSignal, request = fetch) {
  const value = await accountRequest("/api/content?view=bootstrap&public=1", "reader", signal, request, undefined, undefined, "omit");
  if (!value || typeof value !== "object" || !("readerRegistrationEnabled" in value) ||
    typeof value.readerRegistrationEnabled !== "boolean") throw new AccountRequestError("unavailable");
  return value.readerRegistrationEnabled;
}

async function registrationRequest(path: string, payload: Registration | { email: string; requestId: string }, signal: AbortSignal, request: typeof fetch) {
  const value = await accountRequest(path, "reader", signal, request, payload);
  if (!value || typeof value !== "object" || !("requestId" in value) ||
    !isRegistrationRequestId(value.requestId)) throw new AccountRequestError("unavailable");
  return value.requestId;
}

export function registerReader(payload: Registration, signal: AbortSignal, request = fetch) {
  return registrationRequest("/api/reader/register", payload, signal, request);
}

export function resendReaderCode(email: string, requestId: string, signal: AbortSignal, request = fetch) {
  return registrationRequest("/api/reader/resend", { email, requestId }, signal, request);
}

export function verifyReaderCode(email: string, requestId: string, code: string, signal: AbortSignal, request = fetch) {
  return accountRequest("/api/reader/verify", "reader", signal, request, { email, requestId, code });
}

export function requestReaderReset(email: string, signal: AbortSignal, request = fetch) {
  return accountRequest("/api/reader/forgot", "reader", signal, request, { email });
}

export function resetReaderPassword(token: string, password: string, signal: AbortSignal, request = fetch) {
  return accountRequest("/api/reader/reset", "reader", signal, request, { token, password });
}

export async function readPersonalProfile(signal: AbortSignal, request = fetch) {
  const value = await accountRequest("/api/reader/session", "reader", signal, request);
  if (value === null) return null;
  if (!value || typeof value !== "object" || !("nickname" in value) || typeof value.nickname !== "string" ||
    !("email" in value) || typeof value.email !== "string") throw new AccountRequestError("unavailable");
  const profile = value as Record<string, unknown>;
  const string = (item: unknown) => typeof item === "string" ? item : null;
  const issuedAvatar = typeof profile.avatar === "string" ? /^\/api\/reader\/avatar\/([0-9a-f-]{36})\.webp$/u.exec(profile.avatar) : null;
  const expiry = string(profile.vipUntil);
  return {
    nickname: value.nickname,
    email: value.email,
    uid: string(profile.uid),
    signature: string(profile.signature),
    phone: string(profile.phone) ?? "",
    avatar: issuedAvatar && uuid.test(issuedAvatar[1]) ? issuedAvatar[0] : null,
    pendingAvatar: profile.pendingAvatar === true,
    pendingNickname: string(profile.pendingNickname),
    pendingSignature: string(profile.pendingSignature),
    ownerReader: profile.ownerReader === true,
    vip: profile.vip === true,
    vipUntil: expiry && Number.isFinite(Date.parse(expiry)) ? expiry : null,
  };
}

export async function saveReaderProfile(payload: ReaderProfileInput, signal: AbortSignal, request = fetch) {
  const value = await accountRequest("/api/reader/profile", "reader", signal, request, payload);
  return Boolean(value && typeof value === "object" && "reviewPending" in value && value.reviewPending === true);
}

export function uploadReaderAvatar(file: File, signal: AbortSignal, request = fetch) {
  const data = new FormData();
  data.append("file", file);
  return accountRequest("/api/reader/avatar", "reader", signal, request, data);
}

export function removeReaderAvatar(signal: AbortSignal, request = fetch) {
  return accountRequest("/api/reader/avatar/remove", "reader", signal, request, {});
}
