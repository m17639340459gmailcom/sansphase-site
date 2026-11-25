import { autoUpdate, computePosition, offset, shift, size } from "@floating-ui/dom";
import type { MountLoginSliderPanel } from "@/shared/site/login-verification";
import styles from "./sign-in.module.css";

const popoverId = "v3-login-verification-popover";
const viewportInset = 12;
const gap = 8;

function revealBelowControl(control: HTMLButtonElement, host: HTMLElement) {
  const document = control.ownerDocument;
  const view = document.defaultView;
  const scroller = document.scrollingElement;
  if (!view || !scroller) return;
  const viewportHeight = view.visualViewport?.height ?? view.innerHeight;
  const panelHeight = Math.min(host.offsetHeight, Math.max(0, viewportHeight - control.offsetHeight - 2 * viewportInset - gap));
  const distance = Math.ceil(control.getBoundingClientRect().bottom + gap + panelHeight + viewportInset - viewportHeight);
  if (distance <= 0) return;

  const location = view.location.href;
  const previousScroll = view.scrollY;
  const bottom = Math.ceil(previousScroll + distance + scroller.clientHeight);
  let space: HTMLElement | undefined;
  if (bottom > scroller.scrollHeight) {
    // On short screens extend the scroll area below the card without reflowing it.
    space = document.createElement("div");
    space.className = styles.verificationScrollSpace;
    space.style.top = `${bottom - 1}px`;
    space.setAttribute("aria-hidden", "true");
    document.body.append(space);
  }
  view.scrollBy({ top: distance, behavior: "instant" });
  const revealedScroll = view.scrollY;
  return () => {
    const stillAtReveal = Math.abs(view.scrollY - revealedScroll) < 1;
    space?.remove();
    if (control.isConnected && stillAtReveal && view.location.href === location) view.scrollTo({ top: previousScroll, behavior: "instant" });
  };
}

export const mountLoginVerificationPopover: MountLoginSliderPanel = (panel, control, dismiss) => {
  const document = control.ownerDocument;
  const host = document.createElement("div");
  const events = new AbortController();
  host.id = popoverId;
  host.className = `${styles.verificationPopover} reader-card--auth`;
  host.setAttribute("data-login-verification-popover", "");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", document.documentElement.lang.startsWith("en") ? "Slider verification" : "滑块验证");
  host.style.width = `${control.getBoundingClientRect().width}px`;
  host.append(panel);
  document.body.append(host);
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !host.contains(event.target) && !control.contains(event.target)) dismiss();
  }, { signal: events.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    dismiss();
  }, { signal: events.signal });
  control.setAttribute("aria-expanded", "true");
  control.setAttribute("aria-controls", popoverId);

  const restoreScroll = revealBelowControl(control, host);
  const position = async () => {
    const { x, y } = await computePosition(control, host, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [
        offset(gap),
        shift({ padding: viewportInset }),
        size({ padding: viewportInset, apply({ availableHeight, availableWidth, rects }) {
          host.style.width = `${Math.max(0, Math.min(rects.reference.width, availableWidth))}px`;
          host.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        } }),
      ],
    });
    if (events.signal.aborted) return;
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    host.style.visibility = "visible";
  };
  let stopPositioning: (() => void) | undefined;
  const ready = position().then(() => {
    if (!events.signal.aborted) stopPositioning = autoUpdate(control, host, () => { void position().catch(dismiss); });
  });

  return {
    ready,
    unmount() {
      events.abort();
      stopPositioning?.();
      control.setAttribute("aria-expanded", "false");
      control.removeAttribute("aria-controls");
      host.remove();
      restoreScroll?.();
    },
  };
};
