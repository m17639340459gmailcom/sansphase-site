import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { ScrambleText } from "@/components/fx/scramble-text";
import { FxTrigger } from "@/components/fx/trigger";
import { LocalClock } from "@/components/layout/local-clock";
import { SANSPHASE_NAME } from "@/data/sansphase";
import { cn } from "@/lib/utils";
import { HoloCard } from "./holo-card";
import styles from "./about.module.css";

const corners = ["tl", "tr", "bl", "br"] as const;

export async function Portrait({ alt, caption, clockLabel }: { alt: string; caption: string; clockLabel: string }) {
  const t = await getTranslations("FX.about.portrait");
  const hud = (
    <div aria-hidden className={styles.hud}>
      {corners.map((corner, index) => (
        <span key={corner} data-c={corner} className={styles.corner} style={{ "--i": index } as CSSProperties} />
      ))}
      <div className={cn(styles.chips, "absolute inset-x-3 top-3 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em]")}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg/85 px-2 py-1 text-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <ScrambleText text={t("label")} delay={0.75} />
        </span>
        <span className="rounded-full bg-bg/85 px-2 py-1 text-muted">
          <ScrambleText text={SANSPHASE_NAME.en} delay={0.9} />
        </span>
      </div>
    </div>
  );

  return (
    <FxTrigger className={styles.holo}>
      <HoloCard hud={hud} className="mx-auto w-full max-w-[17rem] lg:mr-0 lg:max-w-[19rem]" max={6}>
        <figure>
          <div className={styles.media}>
            <Image
              src="/images/sansphase/author-portrait.webp"
              alt={alt}
              fill
              sizes="(min-width: 1024px) 304px, 272px"
              className="object-contain"
              preload
            />
            <span aria-hidden className={styles.scanlines} />
            <span aria-hidden className={styles.foil} />
            <span aria-hidden className={styles.glare} />
            <span aria-hidden className={styles.band} />
            <span aria-hidden className={styles.edge} />
          </div>
          <figcaption className="flex flex-wrap items-center justify-between gap-1.5 rounded-b-2xl border border-t-0 border-line bg-bg-elevated px-4 py-3 font-mono text-xs tracking-[0.14em] text-muted">
            {caption}
            <LocalClock label={clockLabel} className="text-[10px]" />
          </figcaption>
        </figure>
        <BorderBeam duration={9} size={80} />
      </HoloCard>
    </FxTrigger>
  );
}
