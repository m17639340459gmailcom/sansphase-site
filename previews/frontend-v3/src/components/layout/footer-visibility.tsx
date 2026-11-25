"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

export function FooterVisibility({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? children : null;
}
