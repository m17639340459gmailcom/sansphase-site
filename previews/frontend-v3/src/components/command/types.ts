import type { NavKey } from "@/data/nav";

export type CommandPageKey = NavKey | "blog";

/** "closing" plays the exit animation; an instant close skips straight to "closed". */
export type Phase = "closed" | "open" | "closing";

export type CloseOptions = {
  /** Skip the exit animation (navigation and theme swaps take over the screen). */
  instant?: boolean;
  /** Runs once the palette is gone: focus restored, page unlocked, Lenis released. */
  then?: () => void;
};

/** Serializable, localized index the server hands to the client palette. */
export type CommandData = {
  pages: { key: CommandPageKey; href: string; label: string; alias: string }[];
  posts: { slug: string; href: string; title: string; tags: string[]; date: string }[];
};
