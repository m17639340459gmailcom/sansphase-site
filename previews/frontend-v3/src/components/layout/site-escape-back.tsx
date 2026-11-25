"use client";

import { useEffect, useEffectEvent } from "react";
import { isTyping, modalOpen } from "@/components/command/keys";
import { getIntroDone } from "@/components/fx/intro-store";
import { sansphaseLinks } from "@/data/sansphase";
import { usePathname, useRouter } from "@/i18n/navigation";
import { canGoBackInSite, trackSiteBackHistory } from "./site-back-history";

const sectionBack = new Map<string, string>([
  [sansphaseLinks.learning, sansphaseLinks.learning],
  [sansphaseLinks.software, sansphaseLinks.software],
  [sansphaseLinks.work, sansphaseLinks.work],
  [sansphaseLinks.blog, sansphaseLinks.blogIndex],
  [sansphaseLinks.resources, sansphaseLinks.resources],
  [sansphaseLinks.community, sansphaseLinks.community],
]);

export function SiteEscapeBack() {
  const router = useRouter();
  const pathname = usePathname();
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTyping(event.target) ||
        document.fullscreenElement || !getIntroDone() || modalOpen() || document.querySelector("main[inert]")) return;

    // The persistent header can retain focus on a link clicked on the previous page.
    // Escape releases that focus; regular keyboard navigation keeps its visible outline.
    const active = document.activeElement;
    if (active instanceof HTMLAnchorElement && active.closest("header")) active.blur();

    if (canGoBackInSite()) {
      event.preventDefault();
      router.back();
    } else if (pathname && pathname !== sansphaseLinks.home) {
      const readerParent = document.querySelector<HTMLElement>("[data-reader-parent]")?.dataset.readerParent;
      const sectionEnd = pathname.indexOf("/", 1);
      const sectionParent = sectionEnd > 0 ? sectionBack.get(pathname.slice(0, sectionEnd)) : undefined;
      event.preventDefault();
      router.replace(readerParent ?? sectionParent ?? sansphaseLinks.home);
    }
  });

  useEffect(() => {
    const stopTracking = trackSiteBackHistory();
    const onKeyDown = (event: KeyboardEvent) => onEscape(event);
    // Page controls get the first chance to consume Escape before global navigation.
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopTracking?.();
    };
  }, []);

  return null;
}
