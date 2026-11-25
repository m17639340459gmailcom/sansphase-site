export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** "01", "02", … for HUD-style indices. */
export function pad(index: number) {
  return String(index + 1).padStart(2, "0");
}
