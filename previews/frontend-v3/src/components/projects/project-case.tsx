import { ArrowUpRight, CircleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { Odometer } from "@/components/fx/odometer";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SpotlightCard } from "@/components/fx/spotlight";
import { FxTrigger } from "@/components/fx/trigger";
import { Reveal } from "@/components/ui/reveal";
import { TechIcon } from "@/components/ui/tech-icon";
import { Link } from "@/i18n/navigation";
import { iconKeyForStack } from "@/lib/icons";
import { cn } from "@/lib/utils";
import styles from "./project-detail.module.css";

/**
 * One numbered chapter of the case study. Its rule draws in, the number rolls and the label
 * decodes as a group; the label stays pinned beside the text while the chapter scrolls.
 */
export function CaseSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <FxTrigger
      as="section"
      id={id}
      aria-labelledby={`${id}-title`}
      amount={0.25}
      className="relative grid gap-4 py-10 sm:grid-cols-12 sm:gap-6 sm:py-12"
    >
      <span aria-hidden="true" className="fx-line absolute inset-x-0 top-0 h-px bg-line-strong" />
      <div className="sm:col-span-3">
        <h2
          id={`${id}-title`}
          className="flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[.16em] text-muted sm:sticky sm:top-28"
        >
          <Odometer value={number} duration={1.1} className="text-accent" />
          <span aria-hidden="true" className="fx-line inline-block h-px w-5 bg-accent/60 [--fx-line-delay:.2s]" />
          <ScrambleText text={title} delay={0.15} />
        </h2>
      </div>
      <div className="min-w-0 sm:col-span-9">{children}</div>
    </FxTrigger>
  );
}

/** Checklist whose ticks draw themselves in sequence (inside a CaseSection). */
export function CaseHighlights({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-4">
      {items.map((item, i) => (
        <li
          key={item}
          className={cn(styles.highlight, "flex items-start gap-3 text-[15px] leading-7")}
          style={{ "--i": i } as CSSProperties}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className={styles.check}>
            <circle cx="10" cy="10" r="10" />
            <path d="M6 10.4 8.7 13.1 14 7.6" pathLength={1} />
          </svg>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function CaseNotice({ title, body }: { title: string; body: string }) {
  return (
    <Reveal>
      <div className="fx-scan relative mt-2 flex gap-3 overflow-hidden rounded-2xl border border-line bg-bg-elevated p-5 sm:p-6">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <p className="eyebrow mb-2">{title}</p>
          <p className="text-sm leading-7 text-fg/85">{body}</p>
        </div>
      </div>
    </Reveal>
  );
}

export type CaseLink = {
  href: string;
  label: string;
  external: boolean;
  cursor: string;
  icon?: ReactNode;
};

/** Sticky facts panel: spotlight border, a travelling beam, staggered stack chips, sweeping links. */
export function CaseSidebar({
  labels,
  role,
  year,
  stack,
  links,
}: {
  labels: { role: string; year: string; stack: string; links: string };
  role: string;
  year: string;
  stack: string[];
  links: CaseLink[];
}) {
  return (
    <aside className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
      <Reveal variant="clip" delay={0.05}>
        <SpotlightCard className="flex flex-col gap-7 rounded-2xl border border-line bg-bg-elevated p-6 sm:p-7">
          <BorderBeam duration={9} size={80} />
          <div>
            <p className="eyebrow mb-2">{labels.role}</p>
            <p className="text-[15px] leading-7">{role}</p>
          </div>
          <div>
            <p className="eyebrow mb-2">{labels.year}</p>
            <p className="font-mono text-[15px]">
              <Odometer value={year} duration={1.3} />
            </p>
          </div>
          <div>
            <p className="eyebrow mb-3">{labels.stack}</p>
            <FxTrigger as="ul" amount={0.3} className="flex flex-wrap gap-2">
              {stack.map((name, i) => (
                <li key={name} className={styles.chip} style={{ "--i": i } as CSSProperties}>
                  <TechIcon icon={iconKeyForStack(name)} name={name} size={14} className="text-fg/70" />
                  {name}
                </li>
              ))}
            </FxTrigger>
          </div>
          {links.length > 0 && (
            <div>
              <p className="eyebrow mb-3">{labels.links}</p>
              <div className="flex flex-col gap-2">
                {links.map((link) => {
                  const content = (
                    <>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        {link.icon}
                        <span className="min-w-0">{link.label}</span>
                      </span>
                      <span aria-hidden="true" className={styles.linkArrow}>
                        <ArrowUpRight />
                        <ArrowUpRight />
                      </span>
                    </>
                  );
                  return link.external ? (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={styles.link}
                      data-cursor-text={link.cursor}
                    >
                      {content}
                    </a>
                  ) : (
                    <Link key={link.href} href={link.href} className={styles.link} data-cursor-text={link.cursor}>
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </SpotlightCard>
      </Reveal>
    </aside>
  );
}
