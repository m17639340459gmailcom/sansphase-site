import {
  communityHomeHref,
  communityPageTabs,
  communityRoute,
  manageHref,
} from "../community-routing.ts";

/** Keep bookmarks useful without creating a second UI or accepting return URLs. */
export function communityConsoleDestination(
  hash: string,
  search: string,
): string {
  const fragment = hash.split("?")[0];
  const section = /^#\/([a-z-]+)$/.exec(fragment)?.[1];
  const existing = communityRoute(fragment);
  const tab =
    communityPageTabs.manage.find((candidate) => candidate === section) ||
    (existing.view === "manage" ? existing.tab : "queue");
  const destination =
    section === "community" || existing.view === "home"
      ? communityHomeHref
      : manageHref(tab);
  const input = new URLSearchParams(search);
  const output = new URLSearchParams();
  // These parameters are only carried through. Existing page controllers retain
  // their own appearance/session-language behavior; this entry does not set it.
  for (const [key, values] of [
    ["communityTheme", ["light", "dark"]],
    ["lang", ["zh", "en"]],
  ] as const) {
    const supplied = input.getAll(key);
    if (supplied.length === 1 && values.some((value) => value === supplied[0]))
      output.set(key, supplied[0]);
  }
  const query = output.toString();
  return `/${query ? `?${query}` : ""}${destination}`;
}
