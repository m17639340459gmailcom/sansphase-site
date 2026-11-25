"use client";

import Image from "next/image";
import { useState } from "react";

export function BentoArtwork({ cover, fallback, sizes, className }: { cover?: string; fallback: string; sizes: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const src = cover && !failed ? cover : fallback;
  return <Image src={src} alt="" fill sizes={sizes} className={className} unoptimized={src === cover}
    onError={src === cover ? () => setFailed(true) : undefined} />;
}
