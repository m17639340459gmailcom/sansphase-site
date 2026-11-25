// The standalone management application is a required part of every new release.
// Keep this contract free of build/runtime-framework dependencies.
export const adminConsoleRequiredFiles = [
  "admin-console/index.html",
  "admin-console/admin-console.js",
  "admin-console/admin-console.css",
] as const;

/** One console build follows the active main-site entry without inline scripts. */
export function adminConsoleDocument(
  html: string,
  mainFrontend: unknown = "v1",
): string {
  const version = mainFrontend === "v2" || mainFrontend === "v3" ? mainFrontend : "v1";
  return html.replace(
    /<html(?=[\s>])[^>]*>/i,
    (root) => root.replace(/\s+data-main-frontend=["'][^"']*["']/gi, "")
      .replace(/<html/i, `<html data-main-frontend="${version}"`),
  );
}
