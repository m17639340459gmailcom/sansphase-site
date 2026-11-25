import { sansphaseLinks } from "./sansphase";

export const navItems = [
  { key: "home", href: "/" },
  { key: "projects", href: "/projects" },
  { key: "skills", href: "/skills" },
  { key: "blog", href: "/blog" },
  { key: "learn", href: "/learn" },
  { key: "about", href: "/about" },
  { key: "contact", href: "/contact" },
] as const;

export const v3NavItems = [
  { key: "home", href: "/" },
  { key: "work", href: sansphaseLinks.work },
  { key: "learning", href: sansphaseLinks.learning },
  { key: "resources", href: sansphaseLinks.resources },
  { key: "software", href: sansphaseLinks.software },
  { key: "community", href: sansphaseLinks.community },
  { key: "about", href: sansphaseLinks.about },
  { key: "contact", href: sansphaseLinks.contact },
] as const;

export type NavKey = (typeof v3NavItems)[number]["key"];
