"use client";

import { ArrowUpRight, LogIn } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { lockScroll, unlockScroll } from "@/components/fx/lenis";
import { TextRoll } from "@/components/fx/text-roll";
import { buttonClasses } from "@/components/ui/button";
import { sansphaseLinks } from "@/data/sansphase";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CommandButton } from "./command-button";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileMenu, type MenuOrigin } from "./mobile-menu";
import { NavBrand } from "./nav-brand";
import { NavLinks } from "./nav-links";
import { NavPageLink } from "./nav-page-link";
import { ThemeToggle } from "./theme-toggle";
import { useHeaderScroll } from "./use-header-scroll";
import styles from "./navbar.module.css";

const MENU_ID = "mobile-menu";
// While tucked away, the mouse at the very top peeks the bar back in; it stays until the pointer moves away.
const PEEK_ENTER = 32;
const PEEK_LEAVE = 132;

export function Navbar() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const pathname = usePathname();
  const learningDetail = pathname.startsWith("/learn/");
  const reduced = usePrefersReducedMotion();
  const fine = useFinePointer();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<MenuOrigin>({ x: 0, y: 0, r: 0 });
  const [focusInside, setFocusInside] = useState(false);
  const [peek, setPeek] = useState(false);
  const [routeSeen, setRouteSeen] = useState(pathname);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { condensed, hidden: tucked } = useHeaderScroll(!reduced);
  const hidden = tucked && !open && !focusInside && !peek;

  // Any navigation (menu link, history, palette) closes the menu.
  if (routeSeen !== pathname) {
    setRouteSeen(pathname);
    setOpen(false);
  }
  if (peek && !tucked) setPeek(false);

  useEffect(() => {
    if (!tucked || !fine) return;
    const update = rafThrottle((y: number) => setPeek((shown) => (shown ? y < PEEK_LEAVE : y < PEEK_ENTER)));
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") update(event.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      update.cancel();
      window.removeEventListener("pointermove", onMove);
    };
  }, [tucked, fine]);

  // Mobile menu: lock scroll, make the page inert, trap focus, close on Escape or at desktop width.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    lockScroll("menu");
    const background = [...document.querySelectorAll<HTMLElement>("main, footer")];
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    const toggle = toggleRef.current;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const links = [...(menuRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [])];
      const targets = toggle ? [toggle, ...links] : links;
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => {
      if (desktop.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
      document.body.style.overflow = previous;
      unlockScroll("menu");
      background.forEach((element, i) => {
        element.inert = previousInert[i];
      });
      toggle?.focus({ preventScroll: true });
    };
  }, [open]);

  const toggleMenu = () => {
    const rect = toggleRef.current?.getBoundingClientRect();
    if (!open && rect) {
      // The diagonal covers the screen from any origin (also after a rotation); the extra clears the rim.
      setOrigin({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        r: Math.hypot(window.innerWidth, window.innerHeight) + 128,
      });
    }
    setOpen((value) => !value);
  };
  const close = () => setOpen(false);

  // Keyboard focus pins the bar in view; a mouse click on a link does not.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).matches(":focus-visible")) setFocusInside(true);
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false);
  };

  return (
    <>
      {/* The glass island carries the view-transition name: a named ancestor would become a
          backdrop root and switch off the island's backdrop blur. */}
      <header
        className={styles.header}
        data-condensed={condensed ? "" : undefined}
        data-hidden={hidden ? "" : undefined}
        data-open={open ? "" : undefined}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <div className="container-x">
          <nav aria-label="Primary" className={styles.island} style={{ viewTransitionName: "site-header" }}>
            <div className={styles.start}>
              <NavBrand label={`${locale === "zh" ? "無相 SANSPHASE" : "SANSPHASE"} · ${t("home")}`} onNavigate={close} />
              <CommandButton variant="bar" className="hidden lg:inline-flex" />
            </div>

            <NavLinks pathname={pathname} reducedMotion={reduced} />

            <div className={styles.end}>
              <LocaleSwitcher label={t("switchLocale")} className="hidden shrink-0 sm:grid" onNavigate={close} />
              <CommandButton variant="icon" className="lg:hidden" onOpen={close} />
              <ThemeToggle label={t("toggleTheme")} className="shrink-0" />
              <NavPageLink
                href="/account"
                prefetch={false}
                onNavigate={close}
                aria-label={t("signIn")}
                aria-current={pathname === "/account" ? "page" : undefined}
                title={t("signIn")}
                data-cursor="snap"
                className={cn(
                  "hidden h-10 w-10 shrink-0 place-items-center rounded-full border bg-surface transition-colors duration-300 hover:border-accent hover:text-accent lg:grid",
                  pathname === "/account" ? "border-accent text-accent" : "border-line text-fg",
                )}
              >
                <LogIn aria-hidden="true" className="h-4 w-4" />
              </NavPageLink>
              {/* Hidden between lg and xl, where the centred link row needs the room. From xl it
                  folds into a round arrow button while the bar is condensed. */}
              {!learningDetail && (
                <NavPageLink
                  href={sansphaseLinks.contact}
                  onNavigate={close}
                  aria-label={t("cta")}
                  className={buttonClasses({
                    size: "sm",
                    className: cn(styles.cta, "hidden md:inline-flex lg:hidden xl:inline-flex"),
                  })}
                >
                  <span aria-hidden="true" className="fx-btn-fill" />
                  <span aria-hidden="true" className="fx-btn-shine" />
                  <span className={styles.ctaLabel}>
                    <span>
                      <TextRoll>{t("cta")}</TextRoll>
                    </span>
                  </span>
                  <span aria-hidden="true" className="relative inline-grid h-4 w-4 place-items-center overflow-hidden">
                    <ArrowUpRight className="absolute h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-4 group-hover/btn:-translate-y-4 group-focus-visible/btn:translate-x-4 group-focus-visible/btn:-translate-y-4" />
                    <ArrowUpRight className="absolute h-4 w-4 -translate-x-4 translate-y-4 transition-transform duration-300 [color:var(--fx-roll-to,currentColor)] group-hover/btn:translate-x-0 group-hover/btn:translate-y-0 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:translate-y-0" />
                  </span>
                </NavPageLink>
              )}
              <button
                ref={toggleRef}
                type="button"
                aria-expanded={open}
                aria-controls={MENU_ID}
                aria-label={open ? t("closeMenu") : t("openMenu")}
                data-cursor="snap"
                onClick={toggleMenu}
                className={cn(
                  styles.toggle,
                  "grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-fg transition-colors duration-300 hover:border-accent hover:text-accent lg:hidden",
                )}
              >
                <span aria-hidden="true" className={styles.burger}>
                  <span />
                  <span />
                </span>
              </button>
            </div>
          </nav>
        </div>
      </header>

      <MobileMenu
        id={MENU_ID}
        open={open}
        origin={origin}
        pathname={pathname}
        showCta={!learningDetail}
        menuRef={menuRef}
        onClose={close}
      />
    </>
  );
}
