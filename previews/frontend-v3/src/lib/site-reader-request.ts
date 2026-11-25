const sessionCookies = new Set(["sansphase_reader_session", "sansphase_author_session"]);

/** Read only from the host configured by the application, with existing session cookies. */
export function readSiteContent(origin: string, query: URLSearchParams, incomingCookie: string | null, request = fetch): Promise<Response> {
  const url = new URL("/api/content", origin);
  url.search = query.toString();
  const headers = new Headers({ Accept: "application/json" });
  const cookie = incomingCookie?.split(";").map((part) => part.trim()).filter((part) => {
    const separator = part.indexOf("=");
    return separator > 0 && sessionCookies.has(part.slice(0, separator)) && /^[\w.~%-]+$/.test(part.slice(separator + 1));
  }).join("; ");
  if (cookie) headers.set("Cookie", cookie);
  return request(url, {
    headers,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
}
