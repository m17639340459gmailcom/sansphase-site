const previewHost = "localhost:4308";
const previewOrigin = `http://${previewHost}`;

const routes = new Map<string, "GET" | "reader" | "author">([
  ["/api/reader/session", "GET"],
  ["/api/author/session", "GET"],
  ["/api/reader/login-challenge", "reader"],
  ["/api/reader/login-challenge/verify", "reader"],
  ["/api/reader/login", "reader"],
  ["/api/reader/logout", "reader"],
  ["/api/author/logout", "author"],
]);

const accountCookies = new Set([
  "sansphase_reader_session",
  "sansphase_author_session",
  "sansphase_login_verification_nonce",
]);

type LocalReaderRequest = {
  method: string;
  pathname: string;
  search: string;
  headers: Headers;
};

type LocalReaderDecision =
  | { status: 403 | 404 }
  | { destination: URL; headers: Headers };

function localReaderOrigin(configuredOrigin: string | undefined) {
  if (!configuredOrigin || !/^http:\/\/(127\.0\.0\.1|localhost):[1-9]\d{0,4}$/.test(configuredOrigin)) return null;
  try {
    const upstream = new URL(configuredOrigin);
    return upstream.origin === configuredOrigin && upstream.port !== "4308" ? upstream : null;
  } catch {
    return null;
  }
}

export function localV3AdminOrigin(configuredOrigin: string | undefined) {
  const upstream = localReaderOrigin(configuredOrigin);
  // V3 and the integrated console use the same host-only session cookie across their two local ports.
  return upstream?.hostname === "localhost" ? upstream : null;
}

export function planLocalAdminEntry(request: LocalReaderRequest, configuredOrigin: string | undefined) {
  if ((request.pathname !== "/admin-console" && request.pathname !== "/admin-console/") || request.search ||
    (request.method !== "GET" && request.method !== "HEAD") || request.headers.get("host") !== previewHost) return null;
  const upstream = localV3AdminOrigin(configuredOrigin);
  return upstream ? new URL("/admin-console/", upstream) : null;
}

export function planLocalReaderRequest(request: LocalReaderRequest, configuredOrigin: string | undefined): LocalReaderDecision {
  const route = routes.get(request.pathname);
  if (!route || request.search || request.headers.get("host") !== previewHost) {
    return { status: 404 };
  }

  const isPost = route !== "GET";
  if (request.method !== (isPost ? "POST" : "GET")) {
    return { status: 404 };
  }

  const upstream = localReaderOrigin(configuredOrigin);
  if (!upstream) {
    return { status: 404 };
  }

  const origin = request.headers.get("origin");
  const intentHeader = `x-${route}-request`;
  if (isPost && (origin !== previewOrigin || request.headers.get(intentHeader) !== "1")) {
    return { status: 403 };
  }
  if (!isPost && origin !== null && origin !== previewOrigin) {
    return { status: 403 };
  }

  const headers = new Headers({ host: previewHost });
  const forwardedHeaders = isPost ? ["accept", "user-agent", "content-type", "content-length"] : ["accept", "user-agent"];
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).filter((part) => {
    const separator = part.indexOf("=");
    return separator > 0 && accountCookies.has(part.slice(0, separator));
  }).join("; ");
  if (cookie) headers.set("cookie", cookie);

  if (isPost) {
    headers.set("origin", upstream.origin);
    headers.set(intentHeader, "1");
  }
  const proof = request.headers.get("x-login-verification");
  if (request.pathname === "/api/reader/login" && proof !== null) {
    headers.set("x-login-verification", proof);
  }

  return { destination: new URL(request.pathname, upstream), headers };
}
