"use client";

import { useEffect, useRef } from "react";
import { HOME_INTRO_READY_EVENT } from "@/components/fx/intro-bootstrap";

/** The streamed homepage has arrived and its client region has committed. */
export function HomeIntroReady() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    marker.current?.setAttribute("data-home-intro-ready", "");
    document.dispatchEvent(new Event(HOME_INTRO_READY_EVENT));
  }, []);

  return <span hidden data-home-intro-content ref={marker} />;
}
