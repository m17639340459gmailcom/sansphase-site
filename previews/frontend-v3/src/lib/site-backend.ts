/** Trusted deploy-time configuration. Never derive this URL from the request. */
export function parseSiteBackendOrigin(value: string | undefined): string | null {
  const configured = value?.trim();
  if (!configured) return null;
  const url = URL.parse(configured);
  if (!url || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid SANSPHASE site backend origin");
  }
  return url.origin;
}

export function siteBackendOrigin(): string | null {
  return parseSiteBackendOrigin(process.env.SANSPHASE_V3_SITE_BACKEND);
}

export function isPublishedSiteOrigin(origin: string): boolean {
  return URL.parse(origin)?.href === "https://www.sansphase.com/";
}
