"use client";

import { CornerDownLeft, Search, SearchX, X } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useTranslations } from "next-intl";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { ScrambleText } from "@/components/fx/scramble-text";
import { isCjk } from "@/components/fx/split";
import { TerminalPath } from "@/components/fx/terminal-path";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import styles from "./command.module.css";
import { search, useCommands, type Point, type Result } from "./commands";
import { Kbd, KeyChord } from "./kbd";
import { isApplePlatform } from "./keys";
import type { CloseOptions, CommandData, Phase } from "./types";

export type CommandDialogProps = {
  data: CommandData;
  phase: Phase;
  seed: string;
  onClose: (options?: CloseOptions) => void;
  onExited: () => void;
  onClosed: () => void;
};

type RunOptions = { newTab?: boolean; origin?: Point };

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.32, 0, 0.67, 0] as const;
const HIGHLIGHT_SPRING = { type: "spring", stiffness: 560, damping: 42, mass: 0.7 } as const;

const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  open: { opacity: 1, transition: { duration: 0.35, ease: EASE_OUT } },
  // Ends before the panel, whose completion unmounts both.
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_IN } },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: -18 },
  open: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 28, mass: 0.9, opacity: { duration: 0.2, ease: "easeOut" } },
  },
  exit: { opacity: 0, scale: 0.97, y: -8, transition: { duration: 0.17, ease: EASE_IN } },
};

/** HUD brackets that fly in and lock onto the panel's corners. */
const cornerVariants: Variants = {
  hidden: ([dx, dy]: readonly [number, number]) => ({ opacity: 0, x: dx * 16, y: dy * 16 }),
  open: { opacity: 1, x: 0, y: 0, transition: { delay: 0.12, type: "spring", stiffness: 300, damping: 20 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const CORNERS = [
  { dir: [-1, -1], className: "-left-2 -top-2 rounded-tl-lg border-l-[1.5px] border-t-[1.5px]" },
  { dir: [1, -1], className: "-right-2 -top-2 rounded-tr-lg border-r-[1.5px] border-t-[1.5px]" },
  { dir: [-1, 1], className: "-bottom-2 -left-2 rounded-bl-lg border-b-[1.5px] border-l-[1.5px]" },
  { dir: [1, 1], className: "-bottom-2 -right-2 rounded-br-lg border-b-[1.5px] border-r-[1.5px]" },
] as const;

function Highlight({ text, indices }: { text: string; indices?: readonly number[] }) {
  if (!indices?.length) return text;
  const hits = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  Array.from(text).forEach((char, i) => {
    const hit = hits.has(i);
    const last = runs.at(-1);
    if (last?.hit === hit) last.text += char;
    else runs.push({ text: char, hit });
  });
  return runs.map((run, i) =>
    run.hit ? (
      <mark key={i} className={styles.mark}>
        {run.text}
      </mark>
    ) : (
      <Fragment key={i}>{run.text}</Fragment>
    ),
  );
}

/**
 * While open: page scroll locked (its gutter kept, so nothing shifts), background inert and
 * Lenis stopped via `site:dialog-change`. The teardown runs once the DOM is gone, then `onClosed`.
 */
function useModalLock(root: RefObject<HTMLElement | null>, onClosed: () => void) {
  const closed = useEffectEvent(onClosed);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const html = document.documentElement;
    const { overflow, scrollbarGutter } = html.style;
    // Everything beside the palette's branch, at every level up to <body>, becomes inert.
    const background: HTMLElement[] = [];
    let node: HTMLElement = element;
    while (node.parentElement && node !== document.body) {
      const parent: HTMLElement = node.parentElement;
      for (const sibling of parent.children) {
        if (
          sibling !== node &&
          sibling instanceof HTMLElement &&
          !sibling.inert &&
          !sibling.hasAttribute("data-command-keep") &&
          !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|NEXT-ROUTE-ANNOUNCER)$/.test(sibling.tagName)
        ) {
          background.push(sibling);
        }
      }
      node = parent;
    }
    if (window.innerWidth > html.clientWidth) html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    background.forEach((sibling) => {
      sibling.inert = true;
    });
    document.dispatchEvent(new Event("site:dialog-change"));

    return () => {
      background.forEach((sibling) => {
        sibling.inert = false;
      });
      // Lenis restarts first, so its own overflow lock never outlives the kept gutter.
      document.dispatchEvent(new Event("site:dialog-change"));
      html.style.overflow = overflow;
      html.style.scrollbarGutter = scrollbarGutter;
      closed();
    };
  }, [root]);
}

/** Lets the list's height follow its content through a CSS transition on a measured property. */
function useFitHeight(list: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const scroller = list.current;
    const inner = content.current;
    if (!scroller || !inner) return;
    const sync = () => scroller.style.setProperty("--cmd-h", `${inner.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [list, content]);
}

export function CommandDialog(props: CommandDialogProps) {
  return props.phase === "closed" ? null : <Palette {...props} />;
}

function Palette({ data, phase, seed, onClose, onExited, onClosed }: CommandDialogProps) {
  const t = useTranslations("FX.command");
  const router = useRouter();
  const [apple] = useState(isApplePlatform);
  const commands = useCommands(data, apple);
  const [query, setQuery] = useState(seed);
  const [active, setActive] = useState(0);
  const [pressed, setPressed] = useState<string | null>(null);
  const [fired, setFired] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const revealActive = useRef(false);
  const lastPointer = useRef("");
  const backdropPress = useRef(false);

  const sections = useMemo(() => search(commands, query), [commands, query]);
  const results = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeIndex = results.length ? Math.min(active, results.length - 1) : -1;
  const current = activeIndex >= 0 ? results[activeIndex] : undefined;
  const closing = phase === "closing";
  const typed = query.trim();
  const help = typed.startsWith("?");
  const optionId = (index: number) => `${id}-option-${index}`;
  const titleId = `${id}-title`;
  const listId = `${id}-list`;

  useModalLock(rootRef, onClosed);
  useFitHeight(listRef, contentRef);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  // Again after passive cleanups: a menu closing in the same commit hands focus back to its toggle.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!revealActive.current) return;
    revealActive.current = false;
    if (activeIndex <= 0) listRef.current?.scrollTo({ top: 0 });
    else document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  // Warm the route while the user deliberates, so Enter navigates instantly.
  const prefetch = current?.href;
  useEffect(() => {
    if (!prefetch?.startsWith("/")) return;
    const timer = window.setTimeout(() => router.prefetch(prefetch), 120);
    return () => window.clearTimeout(timer);
  }, [prefetch, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(typed ? t("announce", { count: results.length }) : ""), 450);
    return () => window.clearTimeout(timer);
  }, [typed, results.length, t]);

  function updateQuery(value: string) {
    setQuery(value);
    setActive(0);
    listRef.current?.scrollTo({ top: 0 });
  }

  function move(index: number) {
    revealActive.current = true;
    setActive(index);
  }

  function run(index: number, { newTab: wantsTab = false, origin }: RunOptions = {}) {
    const item = results[index];
    if (!item || closing) return;
    if (item.query !== undefined) {
      updateQuery(item.query);
      return;
    }
    // Effects such as the theme reveal grow out of the row's icon.
    const glyph = document.getElementById(optionId(index))?.querySelector("[data-glyph]")?.getBoundingClientRect();
    const center = glyph
      ? { x: glyph.left + glyph.width / 2, y: glyph.top + glyph.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const newTab = wantsTab && Boolean(item.href);
    const context = { origin: origin ?? center, newTab };
    setFired(item.id);
    if (newTab) {
      item.run?.(context);
      onClose();
    } else {
      onClose({ instant: item.instant, then: () => item.run?.(context) });
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || closing) return;
    setPressed(event.key);
    const count = results.length;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (count) move((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
        return;
      case "PageDown":
      case "PageUp":
        event.preventDefault();
        if (count) move(Math.max(0, Math.min(count - 1, activeIndex + (event.key === "PageDown" ? 5 : -5))));
        return;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0) run(activeIndex, { newTab: event.metaKey || event.ctrlKey });
        return;
      case "Escape":
        event.preventDefault();
        onClose();
    }
  }

  // The rest of the page is inert; this keeps Tab from wandering into the browser chrome.
  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusables = [...event.currentTarget.querySelectorAll<HTMLElement>("input, button:not(:disabled)")].filter(
      (element) => element.getClientRects().length > 0,
    );
    const first = focusables[0];
    const last = focusables.at(-1);
    if (!first || !last) return;
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  function onOptionPointerMove(event: PointerEvent<HTMLElement>, index: number) {
    if (event.pointerType !== "mouse" || closing) return;
    // Rows scrolling under a resting pointer must not steal the keyboard selection.
    const point = `${event.clientX},${event.clientY}`;
    if (point === lastPointer.current) return;
    lastPointer.current = point;
    if (index !== activeIndex) setActive(index);
  }

  return (
    <div
      ref={rootRef}
      data-command-root=""
      className={cn(
        "fixed inset-0 z-[90] flex justify-center px-3 pt-3 sm:px-6 sm:pt-[12vh] short:sm:pt-[6vh]",
        closing && "pointer-events-none",
      )}
    >
      <motion.div
        aria-hidden="true"
        variants={overlayVariants}
        initial="hidden"
        animate={closing ? "exit" : "open"}
        className="absolute inset-0 touch-none bg-bg/60 backdrop-blur-[10px]"
        onPointerDown={(event) => {
          backdropPress.current = event.target === event.currentTarget;
        }}
        onPointerUp={(event) => {
          if (backdropPress.current && event.target === event.currentTarget) onClose();
          backdropPress.current = false;
        }}
        onPointerCancel={() => {
          backdropPress.current = false;
        }}
      >
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(52%_42%_at_50%_28%,#000,transparent)]" />
      </motion.div>

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        variants={panelVariants}
        initial="hidden"
        animate={closing ? "exit" : "open"}
        onAnimationComplete={(definition) => {
          if (definition === "exit") onExited();
        }}
        onKeyDown={onPanelKeyDown}
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[42rem] origin-top flex-col self-start"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[8%] -top-16 h-40 bg-[radial-gradient(closest-side,var(--accent-glow),transparent)] opacity-50"
        />
        {CORNERS.map((corner) => (
          <motion.span
            key={corner.className}
            aria-hidden="true"
            custom={corner.dir}
            variants={cornerVariants}
            className={cn("pointer-events-none absolute h-4 w-4 border-accent", corner.className)}
          />
        ))}

        <div className="relative flex min-h-0 flex-col rounded-2xl border border-line-strong bg-bg-elevated/95 shadow-2xl">
          <BorderBeam duration={9} size={90} />
          <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
            <span aria-hidden="true" className={styles.boot} />
            <h2 id={titleId} className="sr-only">
              {t("title")}
            </h2>

            {/* HUD strip */}
            <div
              aria-hidden="true"
              className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)]" />
                <span className="text-fg">SANSPHASE</span>
                <span className="text-line-strong">/</span>
                <ScrambleText text={t("hud")} trigger="mount" duration={0.8} className="shrink-0" />
                <TerminalPath className="ml-2 hidden min-w-0 truncate normal-case tracking-[0.04em] sm:inline" />
              </span>
              <span className="shrink-0 tabular-nums">{t("count", { count: results.length })}</span>
            </div>

            {/* Search field */}
            <div className="group/search relative flex shrink-0 items-center gap-3 pl-4 pr-2">
              <Search
                aria-hidden="true"
                className={cn("h-[18px] w-[18px] shrink-0 transition-colors duration-300", typed ? "text-accent" : "text-muted")}
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                aria-autocomplete="list"
                aria-label={t("inputLabel")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder={t("placeholder")}
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                onKeyUp={() => setPressed(null)}
                onBlur={() => setPressed(null)}
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-fg caret-accent outline-none placeholder:text-muted/70 focus-visible:outline-none sm:h-[3.75rem] sm:text-[17px]"
              />
              <button
                type="button"
                onClick={() => onClose()}
                aria-label={t("close")}
                className="grid h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:text-accent"
              >
                <Kbd pressed={pressed === "Escape"} className="hidden px-1.5 [@media(hover:hover)]:inline-grid">
                  esc
                </Kbd>
                <X aria-hidden="true" className="h-5 w-5 [@media(hover:hover)]:hidden" />
              </button>
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-line" />
              {/* Focus indicator for the field: the rule under it draws in. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-accent/60 transition-transform duration-500 ease-out group-focus-within/search:scale-x-100"
              />
              <span key={query} aria-hidden="true" className={styles.sweep} />
            </div>

            {/* Results */}
            <motion.div
              ref={listRef}
              layoutScroll
              // Out of the tab order; a click on its padding hands focus back to the field.
              tabIndex={-1}
              onFocus={(event) => {
                if (event.target === event.currentTarget) inputRef.current?.focus({ preventScroll: true });
              }}
              data-lenis-prevent=""
              className="relative h-[var(--cmd-h,auto)] max-h-[min(58vh,27rem)] min-h-0 overflow-y-auto overscroll-contain transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] [scrollbar-width:thin] max-sm:max-h-[calc(100dvh-8rem)]"
            >
              <div ref={contentRef} className="p-2">
                {/* mousedown would move focus off the combobox input */}
                <div
                  id={listId}
                  role="listbox"
                  aria-label={t("results")}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {sections.map((section) => {
                    const headingId = `${id}-group-${section.group}`;
                    return (
                      <div key={section.group} role="group" aria-labelledby={headingId} className="pb-1">
                        <div
                          id={headingId}
                          aria-hidden="true"
                          className="flex items-center gap-3 px-2.5 pb-1.5 pt-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted"
                        >
                          <span>{t(`groups.${section.group}`)}</span>
                          <span className="h-px flex-1 bg-line" />
                          <span className="tabular-nums">{String(section.items.length).padStart(2, "0")}</span>
                        </div>
                        {section.items.map((item) => (
                          <CommandRow
                            key={item.id}
                            item={item}
                            optionId={optionId(item.index)}
                            layoutId={`${id}-highlight`}
                            selected={item.index === activeIndex}
                            fired={fired === item.id}
                            help={help}
                            onPointerMove={(event) => onOptionPointerMove(event, item.index)}
                            onRun={(options) => run(item.index, options)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>

                {results.length === 0 && (
                  <div className="grid place-items-center gap-3 px-6 pb-10 pt-8 text-center">
                    <span
                      aria-hidden="true"
                      className="relative grid h-12 w-12 place-items-center rounded-full border border-line-strong text-accent"
                    >
                      <span key={typed} className={styles.ping} />
                      <SearchX className="h-5 w-5" />
                    </span>
                    <ScrambleText
                      text={t("empty.eyebrow")}
                      trigger="mount"
                      className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted"
                    />
                    <p className="font-display text-xl font-medium tracking-tight text-fg">
                      {t.rich("empty.title", {
                        query: typed,
                        q: (chunks) => (
                          <span className={cn("break-all font-serif font-normal text-accent", !isCjk(typed) && "italic")}>
                            {chunks}
                          </span>
                        ),
                      })}
                    </p>
                    <p className="max-w-[20rem] text-pretty text-sm leading-relaxed text-muted">{t("empty.hint")}</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Keyboard legend (devices that can hover, i.e. have a keyboard nearby) */}
            <div className="hidden shrink-0 items-center justify-between gap-4 border-t border-line bg-bg/40 py-1.5 pl-4 pr-2 [@media(hover:hover)]:flex">
              <div aria-hidden="true" className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                <span className="flex items-center gap-1.5">
                  <Kbd pressed={pressed === "ArrowUp"}>↑</Kbd>
                  <Kbd pressed={pressed === "ArrowDown"}>↓</Kbd>
                  {t("footer.navigate")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd pressed={pressed === "Enter"}>↵</Kbd>
                  {t("footer.open")}
                </span>
                <span className="hidden items-center gap-1.5 sm:flex">
                  <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
                  <Kbd>↵</Kbd>
                  {t("footer.newTab")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  updateQuery(help ? "" : "?");
                  inputRef.current?.focus();
                }}
                className="flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
              >
                <Kbd accent={help}>?</Kbd>
                {t("footer.shortcuts")}
              </button>
            </div>
          </div>
        </div>

        <p role="status" className="sr-only">
          {announcement}
        </p>
      </motion.div>
    </div>
  );
}

function CommandRow({
  item,
  optionId,
  layoutId,
  selected,
  fired,
  help,
  onPointerMove,
  onRun,
}: {
  item: Result;
  optionId: string;
  layoutId: string;
  selected: boolean;
  fired: boolean;
  help: boolean;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onRun: (options: RunOptions) => void;
}) {
  const t = useTranslations("FX.command");
  const Icon = item.icon;
  const via = item.match?.via;

  function onClick(event: MouseEvent<HTMLDivElement>) {
    onRun({ newTab: event.metaKey || event.ctrlKey, origin: { x: event.clientX, y: event.clientY } });
  }

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={selected}
      data-active={selected || undefined}
      onPointerMove={onPointerMove}
      onClick={onClick}
      onAuxClick={(event) => {
        if (event.button !== 1 || !item.href) return;
        event.preventDefault();
        onRun({ newTab: true });
      }}
      className="group/row relative isolate flex min-h-12 cursor-pointer select-none scroll-my-10 items-center gap-3 rounded-xl px-2.5 py-1.5"
    >
      {selected && (
        <motion.span
          layoutId={layoutId}
          transition={HIGHLIGHT_SPRING}
          style={{ borderRadius: 12 }}
          className={cn(
            "absolute inset-0 -z-10 border transition-colors duration-200",
            fired ? "border-accent/60 bg-accent/15" : "border-accent/20 bg-accent-soft",
          )}
        >
          <span className="absolute left-0 top-1/2 h-[46%] w-[3px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_12px_var(--accent-glow)]" />
        </motion.span>
      )}

      <span
        data-glyph=""
        aria-hidden="true"
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-bg/70 transition-colors duration-200",
          selected ? "border-accent/40 text-accent" : "border-line text-muted",
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
      </span>

      <span className="min-w-0 flex-1 transition-transform duration-300 ease-out group-data-[active]/row:translate-x-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14.5px] font-medium leading-snug text-fg">
            <Highlight text={item.label} indices={item.match?.label} />
          </span>
          {item.current && (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-accent">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
              {t("current")}
            </span>
          )}
        </span>
        {item.sub && (
          <span aria-hidden="true" className="mt-0.5 block truncate text-xs leading-snug text-muted">
            {item.sub}
          </span>
        )}
      </span>

      {via ? (
        <span
          aria-hidden="true"
          className="hidden max-w-[9rem] shrink-0 truncate rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline"
        >
          ↳ <Highlight text={via.text} indices={via.indices} />
        </span>
      ) : (
        item.hint && (
          <span aria-hidden="true" className="hidden max-w-[12rem] shrink-0 truncate font-mono text-[10.5px] tracking-[0.04em] text-muted sm:inline">
            {item.hint}
          </span>
        )
      )}

      {item.keys && (
        <KeyChord
          keys={item.keys}
          then={help && item.keys[0] === "G" ? t("shortcuts.then") : undefined}
          className={help ? "flex-wrap justify-end" : "hidden [@media(hover:hover)]:flex"}
        />
      )}

      <span
        aria-hidden="true"
        className="hidden h-6 w-6 shrink-0 -translate-x-1 place-items-center rounded-md border border-accent/40 text-accent opacity-0 transition-[opacity,translate] duration-200 group-data-[active]/row:translate-x-0 group-data-[active]/row:opacity-100 [@media(hover:hover)]:grid"
      >
        <CornerDownLeft className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}
