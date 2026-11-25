"use client";

import { ArrowUpRight, Download, MessageCircle, X } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { cn } from "@/lib/utils";
import styles from "./contact.module.css";

const qrImage = "/contact/wechat-qr.jpg";
const finders = ["tl", "tr", "bl", "br"] as const;

/** Transform that shrinks the dialog onto its trigger, for the open/close morph. */
function fromTrigger(dialog: HTMLElement, trigger: HTMLElement | null) {
  const box = dialog.getBoundingClientRect();
  const origin = trigger?.getBoundingClientRect();
  if (!origin?.width || !box.width) return "translateY(16px) scale(0.94)";
  const x = origin.left + origin.width / 2 - (box.left + box.width / 2);
  const y = origin.top + origin.height / 2 - (box.top + box.height / 2);
  const scale = Math.min(0.6, Math.max(0.12, origin.width / box.width));
  return `translate(${x}px, ${y}px) scale(${scale})`;
}

export function WeChatDialog({ compact = false, label }: { compact?: boolean; label?: string }) {
  const t = useTranslations("Contact.wechat");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pressedBackdrop = useRef(false);
  const closing = useRef(false);
  const morphs = useRef<Animation[]>([]);
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    const opener = trigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    closing.current = false;
    document.dispatchEvent(new Event("site:dialog-change"));
    // Grow out of the button that opened it.
    if (!reduced) {
      morphs.current.push(
        element.animate(
          [
            { transform: fromTrigger(element, opener), opacity: 0 },
            { opacity: 1, offset: 0.35 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 560, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        ),
      );
    }
    return () => {
      morphs.current.forEach((animation) => animation.cancel());
      morphs.current = [];
      element.close();
      document.body.style.overflow = previousOverflow;
      document.dispatchEvent(new Event("site:dialog-change"));
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, reduced]);

  /** Shrinks back onto the trigger, then closes. */
  function requestClose() {
    const element = dialog.current;
    if (!element || closing.current) return;
    if (reduced) {
      setOpen(false);
      return;
    }
    closing.current = true;
    const shrink = element.animate(
      [{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.6 }, { transform: fromTrigger(element, trigger.current), opacity: 0 }],
      { duration: 320, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    morphs.current.push(shrink);
    try {
      morphs.current.push(
        element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: "forwards", pseudoElement: "::backdrop" }),
      );
    } catch {
      // Animating the backdrop is progressive enhancement.
    }
    shrink.onfinish = () => setOpen(false);
  }

  function isBackdrop(event: PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  const button = (
    <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-controls={id}
      className={compact
        ? "inline-flex items-center gap-3 text-sm text-muted transition-colors hover:text-accent pointer-coarse:min-h-11"
        : "group/wx relative isolate inline-flex min-h-11 items-center gap-2 overflow-hidden rounded-full border border-accent/30 bg-accent-soft px-5 text-sm font-medium text-accent transition-colors hover:border-accent"}>
      {!compact && (
        <span aria-hidden className="absolute inset-0 -z-10 origin-left scale-x-0 bg-accent/10 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/wx:scale-x-100" />
      )}
      <MessageCircle className={cn("h-4 w-4", !compact && "transition-transform duration-500 group-hover/wx:-rotate-12")} aria-hidden />
      {label ?? t("trigger")}
    </button>
  );

  return (
    <>
      {compact ? button : (
        <section id="wechat" className="scroll-mt-28 border-b border-line pb-8">
          <h2 className="eyebrow mb-4">{t("title")}</h2>
          {button}
          <p className="mt-3 text-sm leading-relaxed text-muted">{t("shortNote")}</p>
        </section>
      )}

      <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`}
        onClose={() => setOpen(false)} data-lenis-prevent
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onPointerDown={(event) => { pressedBackdrop.current = isBackdrop(event); }}
        onPointerUp={(event) => {
          if (pressedBackdrop.current && isBackdrop(event)) requestClose();
          pressedBackdrop.current = false;
        }}
        onPointerCancel={() => { pressedBackdrop.current = false; }}
        className={cn(styles.dialog, "m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-[26rem] overflow-y-auto overscroll-contain rounded-3xl border border-line bg-bg-elevated p-0 text-fg shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm")}>
        <div className="relative p-5 sm:p-7">
          <button type="button" onClick={requestClose} aria-label={t("close")}
            className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full text-muted transition-[color,background-color,rotate] duration-300 hover:rotate-90 hover:bg-accent-soft hover:text-accent sm:right-3 sm:top-3">
            <X className="h-5 w-5" aria-hidden />
          </button>
          <h2 id={`${id}-title`} className="pr-9 font-display text-xl font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1.5 pr-8 text-sm text-muted">{t("scan")}</p>

          <div className="relative mx-auto my-6 w-64 max-w-full">
            {finders.map((corner) => (
              <span key={corner} aria-hidden data-c={corner} className={styles.finder} />
            ))}
            {/* Clip only the display: the original QR and its quiet zone stay intact. */}
            <a href={qrImage} target="_blank" rel="noreferrer noopener" aria-label={t("open")}
              className="relative block aspect-square w-full overflow-hidden rounded-xl border border-line bg-white">
              <span className="relative block h-full w-full">
                <Image src={qrImage} alt={t("alt")} width={912} height={1354} unoptimized
                  className="absolute h-auto max-w-none"
                  style={{ width: `${912 / 752 * 100}%`, left: `${-80 / 752 * 100}%`, top: `${-346 / 752 * 100}%` }} />
              </span>
              <span aria-hidden className={styles.qrScan} />
            </a>
          </div>

          <p id={`${id}-note`} className="text-sm font-medium leading-relaxed">{t("note")}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">{t("example")}</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            <a href={qrImage} download="dingxin-wechat-qr.jpg"
              className="group/save inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent transition-colors hover:text-accent-strong">
              <Download className="h-4 w-4 transition-transform duration-300 group-hover/save:translate-y-0.5" aria-hidden />{t("save")}
            </a>
            <a href={qrImage} target="_blank" rel="noreferrer noopener"
              className="group/open inline-flex min-h-11 items-center gap-1 text-sm text-muted transition-colors hover:text-fg">
              {t("open")}<ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover/open:-translate-y-0.5 group-hover/open:translate-x-0.5" aria-hidden />
            </a>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("mobileHint")}</p>
        </div>
      </dialog>
    </>
  );
}
