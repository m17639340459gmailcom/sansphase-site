"use client";

import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/fx/events";

/** Opens the command palette from the 404 page's jump row. */
export function SearchSiteButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      className="group/jump inline-flex min-h-11 items-center gap-1.5 uppercase transition-colors hover:text-accent"
    >
      <Search aria-hidden className="h-3.5 w-3.5 text-accent transition-transform duration-300 group-hover/jump:scale-110" />
      {label}
    </button>
  );
}
