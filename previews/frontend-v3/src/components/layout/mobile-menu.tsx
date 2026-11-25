"use client";

import { LogIn } from "lucide-react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  usePresence,
  type MotionStyle,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, type CSSProperties, type RefObject } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { SplitText } from "@/components/fx/split-text";
import { TerminalPath } from "@/components/fx/terminal-path";
import { ButtonLink } from "@/components/ui/button";
import { v3NavItems } from "@/data/nav";
import { sansphaseLinks } from "@/data/sansphase";
import { cn } from "@/lib/utils";
import { LocalClock } from "./local-clock";
import { LocaleSwitcher } from "./locale-switcher";
import { NavPageLink, useNavPageScroll } from "./nav-page-link";
import { isActive, pad } from "./nav-utils";
import styles from "./mobile-menu.module.css";

/** Centre of the toggle button and a radius that covers the viewport from there. */
export type MenuOrigin = { x: number; y: number; r: number };

type MobileMenuProps = {
  id: string;
  open: boolean;
  origin: MenuOrigin;
  pathname: string;
  showCta: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
};

const EASE_IN_OUT = [0.76, 0, 0.24, 1] as const;

export function MobileMenu({ open, ...panel }: MobileMenuProps) {
  return <AnimatePresence>{open && <MenuPanel key="menu" {...panel} />}</AnimatePresence>;
}

/** Full-screen menu that grows out of the toggle as a circle and folds back into it on close. */
function MenuPanel({ id, origin, pathname, showCta, menuRef, onClose }: Omit<MobileMenuProps, "open">) {
  const selectPage = useNavPageScroll();
  const t = useTranslations("Nav");
  const tFx = useTranslations("FX.nav");
  const [present, safeToRemove] = usePresence();
  const reduced = usePrefersReducedMotion();
  const { x, y, r } = origin;
  const radius = useMotionValue(0);
  const fade = useMotionValue(0);
  const clipPath = useMotionTemplate`circle(${radius}px at ${x}px ${y}px)`;
  const rim = useMotionTemplate`${radius}px`;

  // One radius drives the clip and the rim of light riding its edge; closing runs it backwards
  // after the rows have dropped. Reduced motion gets a short fade instead.
  useEffect(() => {
    const onComplete = present ? undefined : safeToRemove;
    const controls = reduced
      ? animate(fade, present ? 1 : 0, { duration: 0.2, onComplete })
      : animate(radius, present ? r : 0, {
          duration: present ? 0.75 : 0.55,
          delay: present ? 0 : 0.12,
          ease: EASE_IN_OUT,
          onComplete,
        });
    return () => controls.stop();
  }, [present, reduced, r, radius, fade, safeToRemove]);

  return (
    <motion.div
      ref={menuRef}
      id={id}
      data-lenis-prevent
      data-closing={present ? undefined : ""}
      className={styles.menu}
      style={
        {
          "--ox": `${x}px`,
          "--oy": `${y}px`,
          ...(reduced ? { opacity: fade } : { clipPath, "--r": rim }),
        } as unknown as MotionStyle
      }
    >
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden="true" className={styles.glow} />
      <div aria-hidden="true" className={styles.rim} />

      <div className={cn(styles.hud, "flex items-center justify-between gap-4 border-b border-line pb-3")}>
        <TerminalPath />
        <LocalClock label={tFx("clock")} className="text-[11px]" />
      </div>

      <nav aria-label={t("menu")} className={styles.list}>
        <ul style={{ "--rows": v3NavItems.length } as CSSProperties}>
          {v3NavItems.map((item, i) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.key} className={styles.item} style={{ "--row": i } as CSSProperties}>
                <NavPageLink
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onNavigate={onClose}
                  className={cn(styles.link, active ? "text-accent" : "text-fg")}
                >
                  <span aria-hidden="true" className={cn(styles.index, "font-mono text-[11px] tracking-[0.2em] text-muted")}>
                    {pad(i)}
                  </span>
                  <SplitText
                    text={t(item.key)}
                    play
                    delay={0.18 + i * 0.05}
                    className={cn(
                      styles.label,
                      "font-display text-[clamp(2rem,9.5vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.03em] short:text-[clamp(1.75rem,7vw,2.5rem)]",
                    )}
                  />
                  {active && (
                    <span aria-hidden="true" className={cn(styles.marker, "font-mono text-[10px] uppercase tracking-[0.2em]")}>
                      <span className="hidden sm:inline">{tFx("current")}</span>
                    </span>
                  )}
                </NavPageLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn(styles.foot, "flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6")}>
        <LocaleSwitcher label={t("switchLocale")} size="lg" onNavigate={onClose} />
        <NavPageLink
          href="/account"
          prefetch={false}
          onNavigate={onClose}
          aria-current={pathname === "/account" ? "page" : undefined}
          className={cn(
            "inline-flex h-12 shrink-0 items-center gap-2 rounded-full border bg-surface px-4 text-sm font-medium transition-colors duration-300 hover:border-accent hover:text-accent",
            pathname === "/account" ? "border-accent text-accent" : "border-line text-fg",
          )}
        >
          <LogIn aria-hidden="true" className="h-4 w-4" />
          {t("signIn")}
        </NavPageLink>
        {showCta && (
          <ButtonLink href={sansphaseLinks.contact} size="lg" arrow scroll={false} onNavigate={(event) => {
            selectPage(sansphaseLinks.contact, event);
            onClose();
          }}>
            {t("cta")}
          </ButtonLink>
        )}
      </div>
    </motion.div>
  );
}
