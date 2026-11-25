const sections = [
  "readers",
  "memberships",
  "profile-reviews",
  "maintenance",
  "activity",
] as const;
export type AdminConsoleSection = (typeof sections)[number];
const isSection = (value: string): value is AdminConsoleSection =>
  sections.some((section) => section === value);

/** Keep only a section name: never persist search terms, account IDs or arbitrary URLs. */
export function consoleSection(route: string): AdminConsoleSection {
  const path = route.replace(/^#/, "").split("?")[0];
  const section = path.startsWith("/") ? path.slice(1) : path;
  return isSection(section) ? section : "readers";
}

export function adminConsoleHref(section: string = "readers"): string {
  return "/admin-console/#/" + consoleSection(section);
}

/** Fixed same-origin exits must not carry console filters or login-return intent. */
export function adminMainSiteHref(preview = false, mainFrontend: unknown = "v1"): string {
  return preview && mainFrontend !== "v3" ? "/?mainPreview=1#/notes" : "/";
}

export function adminAuthorPanelHref(
  preview = false,
  mainFrontend: unknown = "v1",
): string {
  // Only the runtime-selected V2 retains V1 at /original; V1 uses its root.
  if (preview) return "/?mainPreview=1#/account";
  return mainFrontend === "v2" ? "/original#/account" : "/#/account";
}

export function adminLoginHref(route: string, mainFrontend: unknown = "v1"): string {
  const section = consoleSection(route);
  return mainFrontend === "v3" ? `/account?adminReturn=${section}` : `/?adminReturn=${section}#/account`;
}

export function adminReturnDestination(
  search: string,
  authenticatedOwner: boolean,
): string | null {
  if (!authenticatedOwner) return null;
  const section = requestedSection(search);
  return section ? adminConsoleHref(section) : null;
}

function requestedSection(search: string): AdminConsoleSection | null {
  const values = new URLSearchParams(search).getAll("adminReturn");
  return values.length === 1 && isSection(values[0]) ? values[0] : null;
}

/** A reader signing in at an admin entrance keeps their existing account UI. */
export function readerAdminReturnLocation(search: string): string | null {
  if (!requestedSection(search)) return null;
  const params = new URLSearchParams(search);
  params.delete("adminReturn");
  return "/" + (params.size ? "?" + params.toString() : "") + "#/account";
}
