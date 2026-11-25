import { z } from "zod";
import { readSiteContent } from "./site-reader-request";

type ContactChannel = "qq" | "douyin";
type ContactLinks = Partial<Record<ContactChannel, string>>;

const qqHosts = new Set(["qm.qq.com", "wpa.qq.com"]);
const douyinHosts = new Set(["douyin.com", "www.douyin.com", "v.douyin.com"]);
const bootstrap = z.object({ profile: z.object({ socialLinks: z.array(z.unknown()).default([]) }).nullable() });
const socialLink = z.object({ url: z.string().max(4096) });

function contactDestination(value: string): { channel: ContactChannel; href: string } | null {
  if (/[\s\\]/.test(value)) return null;
  const url = URL.parse(value);
  if (!url || url.username || url.password || url.port) return null;
  // The previous author profile published an HTTP QQ invite. Use the same
  // official destination over HTTPS without altering its invitation parameters.
  if (qqHosts.has(url.hostname) && (url.protocol === "http:" || url.protocol === "https:")) {
    url.protocol = "https:";
    return { channel: "qq", href: url.href };
  }
  return url.protocol === "https:" && douyinHosts.has(url.hostname) ? { channel: "douyin", href: url.href } : null;
}

export async function readSiteContactLinks(origin: string, request = fetch): Promise<ContactLinks | null> {
  try {
    const response = await readSiteContent(origin, new URLSearchParams({ view: "bootstrap" }), null, request);
    if (!response.ok) return null;
    const data = bootstrap.safeParse(await response.json());
    if (!data.success) return null;

    const links: ContactLinks = {};
    for (const item of data.data.profile?.socialLinks ?? []) {
      const link = socialLink.safeParse(item);
      if (!link.success) continue;
      const destination = contactDestination(link.data.url);
      if (destination) links[destination.channel] ??= destination.href;
    }
    return links;
  } catch {
    return null;
  }
}
