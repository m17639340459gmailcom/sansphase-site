"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react";
import Image from "next/image";
import { ViewTransition, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useFinePointer, useHydrated, usePrefersReducedMotion } from "@/components/fx/hooks";
import type { ProjectListItem } from "@/data/projects";
import { pick } from "@/data/types";
import { Link } from "@/i18n/navigation";
import { clamp, cn } from "@/lib/utils";
import { ProjectWindow } from "./project-window";
import styles from "./project-index-list.module.css";

const ease = [0.16, 1, 0.3, 1] as const;
const areas =
  "[grid-template-areas:'meta_thumb'_'title_thumb'] grid-cols-[minmax(0,1fr)_auto] lg:[grid-template-areas:'index_title_category_year_arrow'] lg:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,15rem)_4rem_2.75rem]";

/**
 * Typographic index of the projects. On fine pointers a preview window trails the cursor on a
 * spring (tilting with its velocity) and wipes between covers; it is also the shared element
 * that morphs into the case hero. Touch and reduced-motion users get inline thumbnails instead.
 */
export function ProjectIndexList({
  projects,
  locale,
  categories,
  columns,
  cursorLabel,
}: {
  projects: ProjectListItem[];
  locale: string;
  categories: Record<string, string>;
  columns: { index: string; project: string; category: string; year: string };
  cursorLabel: string;
}) {
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();
  const floating = fine && !reduced && hydrated;
  const [active, setActive] = useState<string | null>(null);
  const hovering = useRef(false);
  const follower = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-600);
  const y = useMotionValue(-600);
  const sx = useSpring(x, { stiffness: 240, damping: 28, mass: 0.7 });
  const sy = useSpring(y, { stiffness: 240, damping: 28, mass: 0.7 });
  const lean = useTransform(useVelocity(sx), [-1800, 1800], [-9, 9], { clamp: true });
  const rotate = useSpring(lean, { stiffness: 180, damping: 22 });
  const current = projects.find((project) => project.slug === active);

  function place(clientX: number, clientY: number, jump: boolean) {
    const side = clientX > window.innerWidth * 0.6 ? "left" : "right";
    if (follower.current) follower.current.dataset.side = side;
    const top = clamp(clientY, 130, window.innerHeight - 130);
    x.set(clientX);
    y.set(top);
    if (jump) {
      sx.jump(clientX);
      sy.jump(top);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLUListElement>) {
    if (event.pointerType !== "mouse" || !floating) return;
    place(event.clientX, event.clientY, !hovering.current);
    hovering.current = true;
  }

  function onPointerLeave(event: PointerEvent<HTMLUListElement>) {
    if (event.pointerType !== "mouse") return;
    hovering.current = false;
    setActive(null);
  }

  function onRowFocus(event: FocusEvent<HTMLAnchorElement>, slug: string) {
    if (!floating || !event.currentTarget.matches(":focus-visible")) return;
    const row = event.currentTarget.getBoundingClientRect();
    place(row.left + row.width * 0.64, row.top + row.height / 2, true);
    setActive(slug);
  }

  function onListBlur(event: FocusEvent<HTMLUListElement>) {
    if (hovering.current || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setActive(null);
  }

  return (
    <div className="mt-8">
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-x-6 pb-3 font-mono text-[10px] uppercase tracking-[.16em] text-muted lg:grid",
          areas,
        )}
      >
        <span className="[grid-area:index]">{columns.index}</span>
        <span className="[grid-area:title]">{columns.project}</span>
        <span className="[grid-area:category]">{columns.category}</span>
        <span className="[grid-area:year]">{columns.year}</span>
      </div>
      <ul
        className="group/list relative border-t border-line"
        data-active={current ? "" : undefined}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onBlur={onListBlur}
      >
        <AnimatePresence mode="popLayout">
          {projects.map((project, i) => {
            const title = pick(project.title, locale);
            const category = Object.hasOwn(categories, project.category) ? categories[project.category] : project.category;
            return (
              <motion.li
                key={project.slug}
                layout="position"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.7, ease, delay: i * 0.05, layout: { duration: 0.6, ease } }}
                data-reveal
                className="relative"
              >
                <Link
                  href={`/projects/${project.slug}`}
                  prefetch={false}
                  data-cursor-text={cursorLabel}
                  data-current={project.slug === active ? "" : undefined}
                  onPointerEnter={(event) => event.pointerType === "mouse" && floating && setActive(project.slug)}
                  onFocus={(event) => onRowFocus(event, project.slug)}
                  className={cn(
                    "group/row relative grid items-center gap-x-4 gap-y-2 border-b border-line py-6 transition-opacity duration-500 sm:py-8 lg:gap-x-6",
                    "group-data-[active]/list:opacity-35 data-[current]:opacity-100!",
                    areas,
                  )}
                >
                  <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-accent transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/row:scale-x-100 group-focus-visible/row:scale-x-100" />
                  <span className="hidden font-mono text-xs text-muted transition-colors [grid-area:index] group-hover/row:text-accent lg:block">
                    {project.index}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[.14em] text-muted [grid-area:meta] lg:hidden">
                    <span className="text-accent">{project.index}</span>
                    <span aria-hidden="true">/</span>
                    {category}
                    <span aria-hidden="true">/</span>
                    {project.year}
                  </span>
                  <h2 className="flex min-w-0 items-center font-display text-[clamp(1.9rem,5.4vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.045em] [grid-area:title]">
                    <ArrowRight
                      aria-hidden="true"
                      className="h-[0.55em] w-0 shrink-0 text-accent opacity-0 transition-[width,opacity,margin] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/row:mr-[0.2em] group-hover/row:w-[0.55em] group-hover/row:opacity-100 group-focus-visible/row:mr-[0.2em] group-focus-visible/row:w-[0.55em] group-focus-visible/row:opacity-100 motion-reduce:transition-none"
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
                  </h2>
                  <span className="hidden min-w-0 flex-col gap-1 [grid-area:category] lg:flex">
                    <span className="font-mono text-[11px] uppercase tracking-[.12em] text-accent">{category}</span>
                    <span className="truncate text-xs text-muted">{pick(project.kind, locale)}</span>
                  </span>
                  <span className="hidden font-mono text-xs tabular-nums text-muted [grid-area:year] lg:block">{project.year}</span>
                  <span
                    aria-hidden="true"
                    className="hidden h-11 w-11 place-items-center rounded-full border border-line transition-colors [grid-area:arrow] group-hover/row:border-accent group-hover/row:bg-accent group-hover/row:text-[color:var(--fx-on-accent)] lg:grid"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                  {project.cover && (
                    <span className={cn(styles.thumb, "[grid-area:thumb] lg:hidden")}>
                      <Image
                        src={project.cover.src}
                        unoptimized={project.cover.src.startsWith("/api/media/")}
                        alt=""
                        width={project.cover.width}
                        height={project.cover.height}
                        sizes="(min-width: 640px) 8.5rem, 6.5rem"
                        className="h-auto w-full rounded-[5px] border border-line object-contain"
                      />
                    </span>
                  )}
                </Link>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {floating &&
        createPortal(
          <motion.div
            ref={follower}
            aria-hidden="true"
            className={styles.follower}
            style={{ x: sx, y: sy, rotate }}
            data-side="right"
          >
            <AnimatePresence>
              {current && (
                <motion.div
                  key={current.slug}
                  className={styles.preview}
                  initial={{ clipPath: "inset(100% 0% 0% 0% round 0.6rem)", scale: 1.06 }}
                  animate={{ clipPath: "inset(0% 0% 0% 0% round 0.6rem)", scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.3, delay: 0.2 } }}
                  transition={{ duration: 0.6, ease }}
                >
                  <ViewTransition name={`project-cover-${current.slug}`} share="morph" default="none">
                    <div>
                      <ProjectWindow label={pick(current.title, locale)}>
                        {current.cover ? (
                          <Image
                            src={current.cover.src}
                            unoptimized={current.cover.src.startsWith("/api/media/")}
                            alt=""
                            width={current.cover.width}
                            height={current.cover.height}
                            sizes="24rem"
                            className="block h-auto w-full object-contain"
                          />
                        ) : (
                          <span className="block aspect-[16/9] bg-bg" />
                        )}
                      </ProjectWindow>
                    </div>
                  </ViewTransition>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>,
          document.body,
        )}
    </div>
  );
}
