"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { PUBLISHED_BOOK_BODY_ID } from "@/lib/site-book-position";
import { createBookImageViewer } from "@/shared/site/book-image-viewer.mjs";
import styles from "./published-book-illustrations.module.css";

// The existing book service emits only this same-origin, width-specific URL for
// published <img> elements. The modal requests that image at original width.
const publishedMedia = /^(\/api\/media\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\?w=\d+&view=content$/i;

export function PublishedBookIllustrations({ passage }: { passage: string }) {
  const locale = useLocale();
  const t = useTranslations("FX.blog");
  useEffect(() => {
    const body = document.getElementById(PUBLISHED_BOOK_BODY_ID);
    if (!body) return;
    const originals = new Map<HTMLImageElement, string>();
    for (const image of body.querySelectorAll("img")) {
      const match = publishedMedia.exec(image.getAttribute("src") ?? "");
      if (!match || image.closest("a")) continue;
      originals.set(image, `${match[1]}?view=content`);
      image.classList.add(styles.trigger);
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-haspopup", "dialog");
      image.setAttribute("aria-label", image.alt ? `${image.alt} · ${t("zoomImage")}` : t("zoomImage"));
    }
    if (!originals.size) return;

    const viewer = createBookImageViewer(body, { english: locale === "en", className: styles.viewer });
    const open = (event: MouseEvent | KeyboardEvent) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      const source = originals.get(event.target);
      if (!source || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      viewer.open(event.target, { source, opener: event.target });
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") open(event); };
    body.addEventListener("click", open);
    body.addEventListener("keydown", keydown);
    return () => {
      viewer.destroy();
      body.removeEventListener("click", open);
      body.removeEventListener("keydown", keydown);
      for (const image of originals.keys()) {
        image.classList.remove(styles.trigger);
        for (const attribute of ["tabindex", "role", "aria-haspopup", "aria-label"]) image.removeAttribute(attribute);
      }
    };
  }, [locale, passage, t]);
  return null;
}
