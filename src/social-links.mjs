// Pure URL handling shared by the editor and server. No redirects or remote requests.
export function normalizeSocialLink(value) {
  const raw = String(value ?? "").trim();
  const candidate = raw.match(/https?:\/\/[^\s<>"“”]+/)?.[0];
  try {
    const url = new URL(candidate || raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    const douyin = url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com");
    // Douyin's copied share text may include a caption and an invitation code.
    // Other platforms must still supply an ordinary complete URL.
    if (!douyin && candidate !== raw) return "";
    if (url.hostname === "v.douyin.com") {
      const shortPath = /^\/([A-Za-z0-9_-]+)\/?(?:$|%20|%0[AD]|[，。])/i.exec(url.pathname);
      if (shortPath) url.pathname = `/${shortPath[1]}/`;
    }
    return url.href;
  } catch { return ""; }
}
