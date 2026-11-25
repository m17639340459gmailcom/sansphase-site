import Image from "next/image";
import type { ReactNode } from "react";

export function CatalogCover({ image, fallback }: {
  image?: { src: string; width: number; height: number } | null;
  fallback?: ReactNode;
}) {
  return (
    <div aria-hidden="true" className="relative aspect-video shrink-0 overflow-hidden border-b border-line bg-bg">
      {image ? (
        <Image
          src={image.src}
          width={image.width}
          height={image.height}
          alt=""
          unoptimized={image.src.startsWith("/api/media/")}
          sizes="(max-width: 639px) min(100vw - 40px, 352px), 304px"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="grid h-full place-items-center bg-[radial-gradient(ellipse_at_center,var(--accent-soft),transparent_70%)] text-accent/75">
          {fallback}
        </div>
      )}
    </div>
  );
}
