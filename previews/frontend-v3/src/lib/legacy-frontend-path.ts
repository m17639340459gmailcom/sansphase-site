import { communityEntryPost } from "@/lib/community-entry";

const pages = {
  home: "/", notes: "/about", note: "/blog",
  works: "/projects", work: "/projects", resources: "/learning",
  software: "/software", "resource-center": "/resources", community: "/community",
  contact: "/contact", support: "/support", account: "/account", verify: "/verify", reset: "/reset",
} as const;

const detailPages = new Set(["note", "works", "work", "resources", "software", "resource-center", "verify", "reset"]);
const accountPages = new Set(["account", "verify", "reset"]);

function pathSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded === "." || decoded === ".." || /[\/\\\u0000-\u0020\u007f]/.test(decoded)) return null;
    return encodeURIComponent(decoded);
  } catch {
    return null;
  }
}

export function legacyFrontendPath(hash: string, search = "", english = false) {
  if (!hash.startsWith("#/")) return null;
  const question = hash.indexOf("?");
  const route = hash.slice(2, question === -1 ? undefined : question);
  const [page, ...segments] = route.split("/");
  if (page === "admin") return segments.length ? null : "/admin-console/";

  const parameters = new URLSearchParams(search);
  const fragmentQuery = new URLSearchParams(question === -1 ? "" : hash.slice(question + 1));
  for (const key of new Set(fragmentQuery.keys())) {
    parameters.delete(key);
    for (const value of fragmentQuery.getAll(key)) parameters.append(key, value);
  }
  if (!accountPages.has(page)) {
    for (const key of ["return", "returnTo", "invite", "adminReturn"]) parameters.delete(key);
  }
  const prefix = english ? "/en" : "";
  const searchSuffix = () => parameters.size ? `?${parameters}` : "";

  if (page === "post") {
    const post = communityEntryPost(segments[0]);
    if (!post || (segments.length !== 1 &&
      !(segments.length === 3 && segments[1] === "reply" && communityEntryPost(segments[2])))) return null;
    parameters.set("post", post);
    return `${prefix}/community${searchSuffix()}`;
  }
  if (page === "community") {
    if (segments.length && !(segments.length === 1 && ["home", ""].includes(segments[0]))) return null;
    const [post, ...duplicates] = parameters.getAll("post");
    if (duplicates.length || !communityEntryPost(post)) parameters.delete("post");
  } else if (segments.length > 1 || segments.length && !detailPages.has(page) ||
    page === "note" && segments.length !== 1) return null;
  if (!Object.hasOwn(pages, page)) return null;
  const base = pages[page as keyof typeof pages];
  const detail = segments.length && page !== "community" ? pathSegment(segments[0]) : "";
  if (detail === null) return null;
  const path = base === "/" && english ? "/en" : prefix + base;
  if (page === "reset" && detail) return path + searchSuffix() + "#" + detail;
  return path + (detail ? "/" + detail : "") + searchSuffix() + (page === "notes" ? "#blog" : "");
}
