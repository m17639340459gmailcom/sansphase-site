"use client";

import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { ViewTransition, useId, useState } from "react";
import { TextRoll } from "@/components/fx/text-roll";
import { ButtonLink } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ProjectWindow } from "./project-window";
import styles from "./next-project.module.css";

type Cover = { src: string; alt: string; width: number; height: number };

/**
 * Oversized "next project" link: the outlined title fills with an angled accent sweep and the next
 * cover swings in beside it. While engaged, a copy of that cover carries the morph name, so it
 * flies into the next case's hero; idle, it never pairs with anything.
 */
export function NextProject({
  slug,
  title,
  tagline,
  category,
  position,
  cover,
  labels,
}: {
  slug: string;
  title: string;
  tagline: string;
  category: string;
  position: string;
  cover?: Cover;
  labels: { eyebrow: string; more: string; cta: string; aria: string; cursor: string };
}) {
  const id = useId();
  const [armed, setArmed] = useState(false);
  const shot = cover && (
    <ProjectWindow label={title}>
      <Image
        src={cover.src}
        alt=""
        width={cover.width}
        height={cover.height}
        sizes="(min-width: 1024px) 25rem, 22rem"
        className="block h-auto w-full object-contain"
      />
    </ProjectWindow>
  );

  return (
    <section aria-labelledby={id} className="container-x mt-20 sm:mt-28">
      <div className="flex items-end justify-between gap-6">
        <p id={id} className="eyebrow flex items-center gap-3">
          <span aria-hidden="true" className="inline-block h-px w-6 bg-accent" />
          {labels.eyebrow}
        </p>
        <ButtonLink href="/projects" variant="ghost" size="sm" arrow className="h-11">
          {labels.more}
        </ButtonLink>
      </div>
      <Link
        href={`/projects/${slug}`}
        aria-label={labels.aria}
        data-cursor-text={labels.cursor}
        className={cn(styles.next, "fx-roll-host")}
        onPointerEnter={() => setArmed(true)}
        onPointerLeave={(event) => {
          // Touch fires pointerleave before click; only a mouse really leaves.
          if (event.pointerType === "mouse") setArmed(false);
        }}
        onFocus={() => setArmed(true)}
        onBlur={() => setArmed(false)}
      >
        <div className={styles.meta}>
          <span className="font-mono text-[11px] uppercase tracking-[.14em] text-accent">{category}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted">{position}</span>
        </div>
        <div className={styles.title}>
          <span aria-hidden="true" className={styles.outline}>
            {title}
          </span>
          <span className={styles.fill}>{title}</span>
        </div>
        {shot && (
          <div aria-hidden="true" className={styles.preview}>
            <div className={styles.previewCard}>
              {shot}
              {armed && (
                <ViewTransition name={`project-cover-${slug}`} share="morph" default="none">
                  <div className={styles.clone}>{shot}</div>
                </ViewTransition>
              )}
            </div>
          </div>
        )}
        <div className={styles.foot}>
          <p className={styles.tagline}>{tagline}</p>
          <span className={styles.cta}>
            <TextRoll>{labels.cta}</TextRoll>
            <span aria-hidden="true" className={styles.arrow}>
              <ArrowUpRight className="h-5 w-5" />
              <ArrowUpRight className="h-5 w-5" />
            </span>
          </span>
        </div>
      </Link>
    </section>
  );
}
