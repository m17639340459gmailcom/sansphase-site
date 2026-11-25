import { withRequestDeadline } from "./request-deadline.ts";

const mainOrigin = "https://www.sansphase.com";
export const communityOrigin = "https://community.sansphase.com";
const postId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entryFragment = /^#community-entry=[A-Za-z0-9_-]{32,256}$/;

export function communityEntryPost(value: string | string[] | null | undefined) {
  return typeof value === "string" && postId.test(value) ? value : null;
}

export function communityPublicHref(post: string | null) {
  const id = communityEntryPost(post);
  return `${communityOrigin}/#${id ? `/post/${id}` : "/community/home"}`;
}

export function trustedCommunitySite(origin: string) {
  return origin === mainOrigin;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function readCommunityAccess(signal: AbortSignal, request: typeof fetch = fetch) {
  return withRequestDeadline(signal, 8_000, async (requestSignal) => {
    const response = await request("/api/content?view=bootstrap", {
      credentials: "same-origin", cache: "no-store", redirect: "error", signal: requestSignal,
    });
    if (!response.ok) throw new Error("Community access unavailable");
    const bootstrap = record(await response.json());
    if (!bootstrap) throw new Error("Invalid community status");
    const origin = bootstrap.communityDestination;
    if (bootstrap.communityOnly === true || (origin !== communityOrigin && origin !== communityOrigin + "/")) return "disabled";
    const author = record(bootstrap.author);
    const reader = record(bootstrap.reader);
    return typeof author?.name === "string" || typeof reader?.nickname === "string" ? "ready" : "auth";
  });
}

export async function requestCommunityEntry(post: string | null, signal: AbortSignal, request: typeof fetch = fetch) {
  return withRequestDeadline(signal, 12_000, async (requestSignal) => {
    const response = await request("/api/community-entry", {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Reader-Request": "1" }, body: "{}", signal: requestSignal,
    });
    if (response.status === 401) return { status: "auth" } as const;
    if (!response.ok) throw new Error("Community entry unavailable");
    const entry = record(await response.json());
    if (!entry || typeof entry.url !== "string") throw new Error("Invalid community entry");
    const expiresAt = typeof entry.expiresAt === "number" ? entry.expiresAt
      : typeof entry.expiresAt === "string" ? Date.parse(entry.expiresAt) : NaN;
    const target = new URL(entry.url);
    // The existing identity authority checks freshness and consumes the credential.
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0 || target.origin !== communityOrigin ||
      target.username || target.password || target.pathname !== "/community-enter" || target.search ||
      !entryFragment.test(target.hash)) throw new Error("Invalid community entry");
    const requestedPost = communityEntryPost(post);
    if (requestedPost) target.hash += `&post=${requestedPost}`;
    return { status: "leaving", destination: target.href } as const;
  });
}
