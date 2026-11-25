import { adminReturnDestination } from "../../shared/site/admin-console-navigation.mjs";

type AccountMode = "register" | "forgot" | "verify" | "sign-in";
type Search = { [key: string]: string | string[] | undefined };
export type AccountReturn = { page: string | null; admin: string | null };
export type Invitation = { present: boolean; code: string | null };

export function toSearchParams(search: Search) {
  const params = new URLSearchParams();
  for (const [key, entry] of Object.entries(search)) {
    if (entry === undefined) continue;
    for (const value of Array.isArray(entry) ? entry : [entry]) params.append(key, value);
  }
  return params;
}

export function accountInvitation(params: URLSearchParams): Invitation {
  const codes = params.getAll("invite");
  return {
    present: codes.length > 0,
    code: codes.length === 1 && /^[A-Za-z0-9_-]{24}$/.test(codes[0]) ? codes[0] : null,
  };
}

const localOrigin = "https://account-return.invalid";
const supportedReturnPath = /^(?:\/(?:en\/?)?|(?:\/en)?\/(?:about|contact|support|community)\/?|(?:\/en)?\/(?:projects|work|learning|resources|software|blog)(?:\/[a-zA-Z0-9_-]+){0,2}\/?)$/;

export function accountReturn(params: URLSearchParams): AccountReturn {
  const candidates = [...params.getAll("return"), ...params.getAll("returnTo")];
  const admin = adminReturnDestination(params.toString(), true);
  if (candidates.length !== 1) return { page: null, admin };
  const [value] = candidates;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/u.test(value) || value.length > 2048) {
    return { page: null, admin };
  }
  const path = value.split(/[?#]/u, 1)[0];
  if (!supportedReturnPath.test(path)) return { page: null, admin };
  const url = new URL(value, localOrigin);
  const pathname = url.pathname.replace(/^((?:\/en)?)\/work(?=\/|$)/u, "$1/projects");
  return { page: url.origin === localOrigin ? pathname + url.search + url.hash : null, admin };
}

export function signInDestination(role: "reader" | "owner", requested: AccountReturn): string | null {
  return requested.admin ? (role === "owner" ? requested.admin : null) : requested.page;
}

export function accountFlowHref(mode: AccountMode, requested: AccountReturn, invite: string | null = null) {
  const params = new URLSearchParams();
  if (mode === "register" || mode === "forgot") params.set("mode", mode);
  if (mode === "register" && invite) params.set("invite", invite);
  if (requested.page) params.set("return", requested.page);
  if (requested.admin) params.set("adminReturn", requested.admin.split("/").at(-1) ?? "");
  return (mode === "verify" ? "/verify" : "/account") + (params.size ? "?" + params : "");
}

export function resetTokenFromAddress(url: URL): string | null {
  const pathname = url.pathname.replace(/^\/(?:en|zh)(?=\/|$)/u, "");
  const legacy = pathname === "/" ? /^#\/reset\/([^/]+)$/u.exec(url.hash)?.[1] : null;
  if (!legacy && !/^\/reset(?:\/[^/]+)?\/?$/u.test(pathname)) return null;
  const pathToken = /^\/reset\/([^/]+)\/?$/u.exec(pathname)?.[1];
  const fragment = legacy ?? (url.hash ? url.hash.slice(1) : null);
  const searchTokens = url.searchParams.getAll("token");
  const tokenCount = Number(Boolean(pathToken)) + Number(Boolean(fragment)) + searchTokens.length;
  if (tokenCount !== 1) return null;
  try {
    const token = searchTokens[0] ?? decodeURIComponent(pathToken ?? fragment ?? "");
    return /^[A-Za-z0-9._~-]{20,256}$/u.test(token) ? token : null;
  } catch {
    return null;
  }
}
