import {
  ArrowUpToLine,
  FileText,
  FolderKanban,
  GraduationCap,
  House,
  Keyboard,
  Languages,
  LibraryBig,
  Mail,
  MessagesSquare,
  Monitor,
  Moon,
  PenLine,
  RotateCcw,
  Search,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, type ComponentType } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { INTRO_STORAGE_KEY } from "@/components/fx/intro-bootstrap";
import { scrollToTarget } from "@/components/fx/lenis";
import { startThemeReveal } from "@/components/fx/theme-reveal";
import { getPathname, usePathname, useRouter } from "@/i18n/navigation";
import { localeLabels, routing, type Locale } from "@/i18n/routing";
import { rank, tokenize, type Ranked } from "./fuzzy";
import { GO_KEY_OF } from "./keys";
import type { CommandData, CommandPageKey } from "./types";

export type Group = "pages" | "posts" | "actions" | "shortcuts";
export type Point = { x: number; y: number };
export type RunContext = { origin: Point; newTab: boolean };

export type Command = {
  id: string;
  group: Group;
  label: string;
  sub?: string;
  hint?: string;
  keywords?: readonly string[];
  detail?: string;
  icon?: ComponentType<{ className?: string }>;
  keys?: readonly string[];
  href?: string;
  current?: boolean;
  /** Navigation and theme swaps take over the screen, so the palette leaves without an exit. */
  instant?: boolean;
  /** Stay open and swap the query instead of running (rows of the shortcut sheet). */
  query?: string;
  run?: (context: RunContext) => void;
};

/** `index` is the position in the flattened listbox (drives `aria-activedescendant`). */
export type Result = Command & { match?: Ranked; index: number };
export type Section = { group: Group; items: Result[] };

const GROUPS: Group[] = ["pages", "posts", "actions", "shortcuts"];

const PAGE_ICONS: Record<CommandPageKey, LucideIcon> = {
  home: House,
  work: FolderKanban,
  resources: LibraryBig,
  blog: PenLine,
  learning: GraduationCap,
  software: Monitor,
  community: MessagesSquare,
  about: UserRound,
  contact: Mail,
};

// Search aliases in both languages, so either locale finds every command.
const ALIASES = {
  theme: ["theme", "dark", "light", "mode", "appearance", "主题", "暗色", "亮色", "深色", "浅色"],
  locale: ["language", "locale", "english", "chinese", "中文", "英文", "语言"],
  top: ["top", "scroll", "up", "顶部"],
  intro: ["intro", "preloader", "replay", "animation", "开场", "动画", "重播"],
};

/** Every palette entry for the current locale, route and theme. */
export function useCommands(data: CommandData, apple: boolean) {
  const t = useTranslations("FX.command");
  const tNav = useTranslations("Nav");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const reduced = usePrefersReducedMotion();

  return useMemo(() => {
    const go = (href: string) => ({ newTab }: RunContext) => {
      const external = href.startsWith("https://");
      if (newTab) window.open(external ? href : getPathname({ href, locale }), "_blank", "noopener");
      else if (external) window.location.assign(href);
      else router.push(href);
    };
    const here = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
    const other = routing.locales.find((code) => code !== locale) ?? routing.defaultLocale;
    const dark = resolvedTheme === "dark";

    const pages = data.pages.map(
      (page): Command => ({
        id: `page:${page.key}`,
        group: "pages",
        label: page.label,
        hint: page.href,
        keywords: [page.key, page.href, page.alias],
        icon: PAGE_ICONS[page.key],
        keys: ["G", GO_KEY_OF[page.key]],
        href: page.href,
        current: here(page.href),
        instant: true,
        run: go(page.href),
      }),
    );

    const posts = data.posts.map((post): Command => {
      const href = post.href;
      return {
        id: `post:${post.slug}`,
        group: "posts",
        label: post.title,
        sub: post.tags.join(" · "),
        hint: post.date,
        keywords: [post.slug, ...post.tags],
        icon: FileText,
        href,
        current: pathname === href,
        instant: true,
        run: go(href),
      };
    });

    const actions: Command[] = [
      {
        id: "action:theme",
        group: "actions",
        label: t(dark ? "actions.themeLight" : "actions.themeDark"),
        hint: `${tNav(dark ? "dark" : "light")} → ${tNav(dark ? "light" : "dark")}`,
        keywords: ALIASES.theme,
        icon: dark ? Sun : Moon,
        instant: true,
        run: ({ origin }) => {
          const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
          startThemeReveal(origin.x, origin.y, next, setTheme);
        },
      },
      {
        id: "action:locale",
        group: "actions",
        label: t("actions.language"),
        hint: `${localeLabels[locale].short} → ${localeLabels[other].short}`,
        keywords: ALIASES.locale,
        icon: Languages,
        instant: true,
        run: () => {
          const query = Object.fromEntries(new URLSearchParams(window.location.search));
          router.push({ pathname, query }, { locale: other });
        },
      },
      {
        id: "action:top",
        group: "actions",
        label: t("actions.top"),
        keywords: ALIASES.top,
        icon: ArrowUpToLine,
        run: () => scrollToTarget(0),
      },
      ...(reduced || pathname !== "/"
        ? []
        : [
            {
              id: "action:intro",
              group: "actions",
              label: t("actions.intro"),
              keywords: ALIASES.intro,
              icon: RotateCcw,
              instant: true,
              run: () => {
                try {
                  sessionStorage.removeItem(INTRO_STORAGE_KEY);
                } catch {}
                if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
                window.location.reload();
              },
            } satisfies Command,
          ]),
    ];

    const shortcuts: Command[] = [
      { id: "key:palette", group: "shortcuts", label: t("shortcuts.palette"), keys: [apple ? "⌘" : "Ctrl", "K"], icon: Keyboard, query: "" },
      { id: "key:search", group: "shortcuts", label: t("shortcuts.search"), keys: ["/"], icon: Search, query: "" },
      { id: "key:help", group: "shortcuts", label: t("shortcuts.help"), keys: ["?"], icon: Keyboard, query: "?" },
      ...data.pages.map(
        (page): Command => ({
          id: `key:${page.key}`,
          group: "shortcuts",
          label: t("shortcuts.goto", { page: page.label }),
          keywords: [page.key, page.alias],
          keys: ["G", GO_KEY_OF[page.key]],
          icon: PAGE_ICONS[page.key],
          href: page.href,
          instant: true,
          run: go(page.href),
        }),
      ),
    ];

    return [...pages, ...posts, ...actions, ...shortcuts];
  }, [data, apple, t, tNav, locale, pathname, router, resolvedTheme, setTheme, reduced]);
}

/**
 * A leading "?" switches to the shortcut sheet. Without a query, groups keep their order;
 * with one, each group follows its best hit and items their score.
 */
export function search(commands: Command[], query: string): Section[] {
  const help = query.trimStart().startsWith("?");
  const tokens = tokenize(help ? query.trimStart().slice(1) : query);
  const pool = commands.filter((command) => (command.group === "shortcuts") === help);
  const groups = new Map<Group, Result[]>();
  const add = (command: Command, match?: Ranked) =>
    groups.set(command.group, [...(groups.get(command.group) ?? []), { ...command, match, index: 0 }]);

  if (!tokens.length) {
    for (const group of GROUPS) {
      for (const command of pool) if (command.group === group) add(command);
    }
  } else {
    pool
      .map((command, order) => ({ command, order, match: rank(tokens, command) }))
      .filter(
        (entry): entry is { command: Command; order: number; match: Ranked } =>
          entry.match !== null,
      )
      .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
      .forEach(({ command, match }) => add(command, match));
  }

  const sections = [...groups].map(([group, items]) => ({ group, items }));
  let next = 0;
  for (const section of sections) for (const item of section.items) item.index = next++;
  return sections;
}
