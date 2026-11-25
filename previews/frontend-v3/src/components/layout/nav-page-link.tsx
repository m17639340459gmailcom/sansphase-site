"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { scrollToTarget } from "@/components/fx/lenis";
import { getPathname, Link, usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

type SelectPage = (href: string, event?: { preventDefault(): void }, replace?: boolean) => void;
const NavPageScrollContext = createContext<SelectPage>(() => {});

export function NavPageScrollProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locale = useLocale() as Locale;
  const pending = useRef<string | null>(null);
  const selectPage = useCallback<SelectPage>((href, event, replace) => {
    pending.current = href === pathname ? null : href;
    if (href !== pathname) return;
    const destination = getPathname({ href, locale });
    if (event && !window.location.search && destination === window.location.pathname) {
      // Next can reuse a cached fragment on a scroll-disabled same-page navigation.
      event.preventDefault();
      if (window.location.hash) {
        if (replace) window.history.replaceState(null, "", destination);
        else window.history.pushState(null, "", destination);
      }
    }
    // Mobile closes and releases its scroll lock before the next frame.
    requestAnimationFrame(() => scrollToTarget(0, { immediate: true }));
  }, [locale, pathname]);

  useLayoutEffect(() => {
    const target = pending.current;
    pending.current = null;
    // Set the new page's position before paint, leaving the outgoing page and history alone.
    if (target === pathname) scrollToTarget(0, { immediate: true });
  }, [pathname]);

  return <NavPageScrollContext.Provider value={selectPage}>{children}</NavPageScrollContext.Provider>;
}

export function useNavPageScroll() {
  return useContext(NavPageScrollContext);
}

type Props = Omit<ComponentProps<typeof Link>, "href" | "onNavigate" | "scroll"> & { href: string; onNavigate?: () => void };

/** Header destinations start at the top without changing native history or content links. */
export function NavPageLink({ href, onNavigate, ...props }: Props) {
  const selectPage = useNavPageScroll();
  return (
    <Link {...props} href={href} scroll={false} onNavigate={(event) => {
      selectPage(href, event, props.replace);
      onNavigate?.();
    }} />
  );
}
