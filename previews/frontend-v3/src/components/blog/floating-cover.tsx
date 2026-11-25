"use client";

import Image from "next/image";
import { ViewTransition } from "react";
import { Parallax } from "@/components/fx/parallax";
import { TiltCard } from "@/components/ui/tilt-card";

/**
 * A post cover floating on its own depth plane: scroll parallax + pointer tilt with glare, whole
 * and uncropped. Shares `post-cover-<slug>` with the article hero so it morphs into it on click.
 */
export function FloatingCover({
  slug,
  src,
  alt,
  width,
  height,
  sizes,
  className,
}: {
  slug: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
}) {
  return (
    <Parallax speed={-0.06} className={className}>
      <TiltCard max={6} className="rounded-xl">
        <ViewTransition name={`post-cover-${slug}`} share="morph" default="none">
          <div className="overflow-hidden rounded-xl border border-line bg-[#f6f3ed] shadow-[0_32px_80px_-40px_var(--accent-glow)]">
            <Image src={src} alt={alt} width={width} height={height} sizes={sizes} unoptimized={src.startsWith("/api/media/") || src === "/share/cover.jpg"} className="h-auto w-full" />
          </div>
        </ViewTransition>
      </TiltCard>
    </Parallax>
  );
}
