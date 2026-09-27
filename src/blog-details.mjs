import { siGithub, siBilibili, siX, siYoutube, siTelegram, siSteam, siZhihu, siDouban, siNeteasecloudmusic, siQq, siWechat, siXiaohongshu, siTiktok } from "simple-icons";
import { normalizeSocialLink } from "./social-links.mjs";
const platforms = [
  ["抖音", ["douyin.com"], siTiktok], ["TikTok", ["tiktok.com"], siTiktok],
  ["GitHub", ["github.com"], siGithub], ["哔哩哔哩", ["bilibili.com", "b23.tv"], siBilibili],
  ["X", ["x.com", "twitter.com"], siX], ["YouTube", ["youtube.com", "youtu.be"], siYoutube],
  ["Telegram", ["t.me", "telegram.me"], siTelegram], ["Steam", ["steamcommunity.com"], siSteam],
  ["知乎", ["zhihu.com"], siZhihu], ["豆瓣", ["douban.com"], siDouban],
  ["网易云音乐", ["music.163.com"], siNeteasecloudmusic], ["QQ", ["qq.com"], siQq],
  ["微信", ["mp.weixin.qq.com"], siWechat], ["小红书", ["xiaohongshu.com", "xhslink.com"], siXiaohongshu],
];
export function socialPlatform(value) {
  try {
    const url = new URL(normalizeSocialLink(value));
    if (!/^https?:$/.test(url.protocol)) return null;
    // Prefer the most specific hostname, e.g. WeChat before the general qq.com.
    return platforms.flatMap(([name, hosts, icon]) => hosts.map(host => ({name, host, icon})))
      .sort((a,b) => b.host.length - a.host.length)
      .find(({host}) => url.hostname === host || url.hostname.endsWith("." + host)) || null;
  } catch { return null; }
}
export function socialIcon(url, fallback) {
  const platform = socialPlatform(url);
  return platform ? `<svg class="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${platform.icon.path}"/></svg>` : fallback;
}
export function tagTone(tag) {
  return [...String(tag)].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 0) % 5;
}
