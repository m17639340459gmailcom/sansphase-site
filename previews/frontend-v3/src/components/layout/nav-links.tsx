"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, type FocusEvent, type PointerEvent } from "react";
import { TextRoll } from "@/components/fx/text-roll";
import { v3NavItems } from "@/data/nav";
import { cn } from "@/lib/utils";
import { NavPageLink } from "./nav-page-link";
import { isActive } from "./nav-utils";
import styles from "./navbar.module.css";

/**
 * Desktop link row. A single hover capsule glides between links (measured once per hover, written
 * as CSS variables), labels roll on hover/focus, and the current page carries a springy glow bar.
 */
export function NavLinks({ pathname, reducedMotion }: { pathname: string; reducedMotion: boolean }) {
  const t = useTranslations("Nav");
  const pill = useRef<HTMLSpanElement>(null);
  const index = useRef(-1);

  const moveTo = (item: HTMLElement) => {
    const element = pill.current;
    const frame = item.offsetParent as HTMLElement | null;
    if (!element || !frame) return;
    const next = Number(item.dataset.index);
    if (next === index.current) return;
    const appearing = index.current === -1;
    if (appearing) element.dataset.instant = "";
    else element.dataset.dir = next > index.current ? "next" : "prev";
    element.style.setProperty("--pill-l", `${item.offsetLeft}px`);
    element.style.setProperty("--pill-r", `${frame.offsetWidth - item.offsetLeft - item.offsetWidth}px`);
    if (appearing) {
      void element.offsetWidth; // commit the new edges untransitioned, then fade in place
      delete element.dataset.instant;
    }
    element.dataset.visible = "";
    index.current = next;
  };

  const hide = () => {
    const element = pill.current;
    if (!element) return;
    delete element.dataset.visible;
    delete element.dataset.dir;
    index.current = -1;
  };

  const onPointerEnter = (event: PointerEvent<HTMLLIElement>) => {
    if (event.pointerType === "mouse") moveTo(event.currentTarget);
  };
  const onFocus = (event: FocusEvent<HTMLLIElement>) => {
    if ((event.target as HTMLElement).matches(":focus-visible")) moveTo(event.currentTarget);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
  };

  return (
    <div className={styles.links} onPointerLeave={hide} onBlur={onBlur}>
      <span ref={pill} aria-hidden="true" className={styles.pill} />
      <ul className="relative flex items-center gap-0.5">
        {v3NavItems.map((item, i) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key} data-index={i} className="relative" onPointerEnter={onPointerEnter} onFocus={onFocus}>
              <NavPageLink
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "fx-roll-host relative inline-flex h-10 items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors duration-300 xl:px-3",
                  active ? "text-accent [--fx-roll-to:var(--accent)]" : "text-muted hover:text-fg [--fx-roll-to:var(--fg)]",
                )}
              >
                <TextRoll>{t(item.key)}</TextRoll>
              </NavPageLink>
              {active && (
                <motion.span
                  aria-hidden="true"
                  layoutId={reducedMotion ? undefined : "nav-current"}
                  className={styles.current}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
