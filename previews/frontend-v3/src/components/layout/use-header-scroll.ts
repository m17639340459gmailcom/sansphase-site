import { useEffect, useState } from "react";

const CONDENSE_AT = 24;
const HIDE_AFTER = 160;
// Scroll travel (px) in one direction before the header reacts, so trackpad jitter does not flicker it.
const HIDE_TRAVEL = 14;
const SHOW_TRAVEL = 8;

type HeaderScroll = { condensed: boolean; hidden: boolean };

/**
 * `condensed` once the page leaves the top; `hidden` while scrolling down past HIDE_AFTER and
 * false again on the way up. Reads scrollY once per frame and only re-renders when a flag flips.
 */
export function useHeaderScroll(autoHide: boolean): HeaderScroll {
  const [state, setState] = useState<HeaderScroll>({ condensed: false, hidden: false });

  useEffect(() => {
    let current: HeaderScroll = { condensed: false, hidden: false };
    let last = window.scrollY;
    let travel = 0;
    let frame = 0;

    const read = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - last;
      last = y;
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      let hidden = current.hidden;
      if (!autoHide || y < HIDE_AFTER) hidden = false;
      else if (travel > HIDE_TRAVEL) hidden = true;
      else if (travel < -SHOW_TRAVEL) hidden = false;
      const condensed = y > CONDENSE_AT;
      if (condensed !== current.condensed || hidden !== current.hidden) {
        current = { condensed, hidden };
        setState(current);
      }
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(read);
    };

    frame = requestAnimationFrame(read);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [autoHide]);

  return state;
}
