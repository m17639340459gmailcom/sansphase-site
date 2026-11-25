"use client";

import { Box, Grid3x3, Orbit } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { Odometer } from "@/components/fx/odometer";
import { ScrambleText } from "@/components/fx/scramble-text";
import { FxTrigger, useFxPlay, useFxState } from "@/components/fx/trigger";
import { ArrowSwap } from "@/components/home/data/arrow-swap";
import { contributionStats } from "@/components/home/data/contribution-stats";
import styles from "@/components/home/data/contributions.module.css";
import { sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { publicationCalendar, publicationYears, type PublicationCalendar, type ResourcePublicationDay } from "@/lib/site-publishing-model";
import { clamp, cn } from "@/lib/utils";

type View = "grid" | "city";
type StatItem = { key: string; label: string; value: number; unit: string; note?: string };

const WEEK_MS = 86_400_000 * 7;
const LEVELS = [0, 1, 2, 3, 4] as const;
/** Skyline column heights in px; any activity gets at least the minimum. */
const MIN_HEIGHT = 3;
const MAX_HEIGHT = 56;
/** Longest skyline transition (0.9s rise + the widest diagonal delay) before the 3D scaffold is dropped. */
const SETTLE_MS = 1500;

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function cellFrom(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLButtonElement>("button[data-date]") : null;
}

/**
 * Skyline camera for a pointer offset in -1…1 around the resting tilt/turn of
 * `.stage[data-view="city"] .plane`. Written inline so only the plane and the peak billboard
 * restyle per frame (custom properties would cascade into all 371 cells).
 */
function skylineTransforms(x: number, y: number) {
  const tilt = 60 + y * 3;
  const turn = 10 + x * 7;
  return {
    plane: `translateY(10%) rotateX(${tilt.toFixed(2)}deg) rotateZ(${turn.toFixed(2)}deg) scale(0.8)`,
    peak: `rotateZ(${(-turn).toFixed(2)}deg) rotateX(${(-tilt).toFixed(2)}deg)`,
  };
}

function PublicationGrid({
  calendar,
  today,
  view,
  solid,
  unavailable,
}: {
  calendar: PublicationCalendar;
  today: string;
  view: View;
  solid: boolean;
  unavailable: boolean;
}) {
  const t = useTranslations("Home.sitePublishing.calendar");
  const fx = useTranslations("FX.home");
  const locale = useLocale();
  const hintId = useId();
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const scrollArea = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const stageBox = useRef<DOMRect | null>(null);
  const tipFrame = useRef(0);
  const playing = useFxPlay(gridRef, { amount: 0.3 });
  const fxState = useFxState(playing);

  const layout = useMemo(() => {
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const dayFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
    const start = parseDate(calendar.startDate);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const weekOf = (date: string) => Math.floor((parseDate(date).getTime() - start.getTime()) / WEEK_MS);
    const weekCount = weekOf(calendar.endDate) + 1;
    const days = calendar.days.filter((day) => day.date <= today);
    const stats = contributionStats(days);
    const max = stats.busiest?.count ?? 0;
    const cells = calendar.days.map((day) => ({
      day,
      week: weekOf(day.date),
      weekday: parseDate(day.date).getUTCDay(),
      label: dayFormatter.format(parseDate(day.date)),
      height: day.count ? Math.round(MIN_HEIGHT + (day.count / max) * (MAX_HEIGHT - MIN_HEIGHT)) : 0,
    }));
    const months = calendar.days
      .filter((day, index) => index === 0 || day.date.endsWith("-01"))
      .map((day) => ({ date: day.date, label: monthFormatter.format(parseDate(day.date)), week: weekOf(day.date) }))
      // Leave room for each label, including partial months at either end.
      .filter((month, index, all) => weekCount - month.week >= 3 && (!all[index + 1] || all[index + 1].week - month.week >= 3));
    const latest = days.at(-1)?.date;
    return { days, cells, months, stats, weekCount, latestWeek: latest ? weekOf(latest) : weekCount - 1 };
  }, [calendar, today, locale]);

  const { days, cells, months, stats, weekCount, latestWeek } = layout;
  const [focusDate, setFocusDate] = useState(days.at(-1)?.date);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  // Kept after hiding, so the tooltip fades out with its own content.
  const [tipDate, setTipDate] = useState<string | null>(null);
  const [focusLevel, setFocusLevel] = useState<number | null>(null);
  const activeCell = cells.find(({ day }) => day.date === (hoverDate ?? selectedDate));
  const tipCell = cells.find(({ day }) => day.date === tipDate);
  const gridTemplateColumns = `repeat(${weekCount}, minmax(0, 1fr))`;
  const city = view === "city" && playing;
  const orbiting = city && fine && !reduced;
  const peakDate = stats.busiest?.date;
  const peakLabel = `${fx("publicationPeak")} ${stats.busiest?.count ?? 0}`;

  // Memoized so hover/tooltip renders skip the 371 buttons.
  const cellNodes = useMemo(
    () =>
      cells.map(({ day, week, weekday, label, height }, index) => {
        const style = { gridColumnStart: week + 1, gridRowStart: weekday + 1 };
        if (day.date > today) {
          return <span key={day.date} style={style} className="aspect-square rounded-[2px] border border-line/50" aria-hidden />;
        }
        if (unavailable) {
          return <span key={day.date} style={style} data-level={0} className={cn(styles.cell, styles.lv)} aria-hidden />;
        }
        return (
          <button
            key={day.date}
            type="button"
            tabIndex={focusDate === day.date ? 0 : -1}
            aria-label={t("day", { date: label, count: day.count })}
            aria-pressed={selectedDate === day.date}
            data-date={day.date}
            data-count={day.count}
            data-index={index}
            data-level={day.level}
            data-h={height || undefined}
            className={cn(styles.cell, styles.lv)}
            style={{ ...style, "--d": week + weekday, "--h": height } as CSSProperties}
          >
            {day.date === peakDate && (
              <span className={styles.peak} aria-hidden="true">
                <span className={cn("flex items-center gap-1.5 rounded-full bg-fg px-2 py-0.5 font-mono text-[10px] text-bg shadow-soft", styles.peakPill)}>
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {peakLabel}
                </span>
              </span>
            )}
          </button>
        );
      }),
    [cells, today, focusDate, selectedDate, peakDate, peakLabel, t, unavailable],
  );

  const orbit = useMemo(
    () =>
      rafThrottle((plane: HTMLElement, x: number, y: number) => {
        const camera = x === 0 && y === 0 ? null : skylineTransforms(x, y);
        plane.style.transform = camera?.plane ?? "";
        const peak = plane.querySelector<HTMLElement>(`.${styles.peak}`);
        if (peak) peak.style.transform = camera?.peak ?? "";
      }),
    [],
  );

  useEffect(() => () => {
    orbit.cancel();
    cancelAnimationFrame(tipFrame.current);
  }, [orbit]);

  // Leaving the skyline (e.g. from the keyboard while the pointer rests on it) drops the camera offset.
  useEffect(() => {
    const plane = planeRef.current;
    if (city || !plane) return;
    orbit.cancel();
    plane.style.transform = "";
    plane.querySelector<HTMLElement>(`.${styles.peak}`)?.style.removeProperty("transform");
  }, [city, orbit]);

  useEffect(() => {
    const scroller = scrollArea.current;
    if (!scroller) return;
    // Show the most recent days on narrow screens without scrolling the page (2rem = weekday labels).
    const labels = 32;
    const right = labels + ((latestWeek + 1) / weekCount) * (scroller.scrollWidth - labels);
    scroller.scrollLeft = Math.max(0, right - scroller.clientWidth + 8);
  }, [latestWeek, weekCount]);

  function showTip(cell: HTMLElement) {
    const tip = tipRef.current;
    const stage = stageRef.current;
    const grid = gridRef.current;
    const host = tip?.offsetParent;
    if (!tip || !stage || !grid || !(host instanceof HTMLElement)) return;
    // Flat: layout offsets, unaffected by the magnifier's scale. 3D: the projected top face.
    const gridBox = grid.getBoundingClientRect();
    const box = solid
      ? cell.getBoundingClientRect()
      : { left: gridBox.left + cell.offsetLeft, top: gridBox.top + cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight };
    const hostBox = host.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = clamp(box.left + box.width / 2 - hostBox.left, half, hostBox.width - half);
    tip.style.setProperty("--tx", `${x.toFixed(1)}px`);
    tip.style.setProperty("--ty", `${(box.top - hostBox.top).toFixed(1)}px`);
    stage.style.setProperty("--cx", `${(box.left + box.width / 2 - frame.left).toFixed(1)}px`);
    stage.style.setProperty("--cy", `${(box.top + box.height / 2 - frame.top).toFixed(1)}px`);
    stage.dataset.hover = "";
    setTipDate(cell.dataset.date ?? null);
    // Appear in place first; only later moves glide.
    if (!tip.hasAttribute("data-show")) {
      cancelAnimationFrame(tipFrame.current);
      tipFrame.current = requestAnimationFrame(() => tip.setAttribute("data-show", ""));
    }
  }

  function hideTip() {
    cancelAnimationFrame(tipFrame.current);
    tipRef.current?.removeAttribute("data-show");
    if (stageRef.current) delete stageRef.current.dataset.hover;
  }

  function onGridOver(event: PointerEvent<HTMLDivElement>) {
    const cell = cellFrom(event.target);
    const date = cell?.dataset.date;
    if (!cell || !date || date === hoverDate) return;
    setHoverDate(date);
    if (event.pointerType === "mouse") showTip(cell);
  }

  function onGridLeave() {
    setHoverDate(null);
    hideTip();
  }

  function select(cell: HTMLElement | null) {
    const date = cell?.dataset.date;
    if (!date) return;
    setSelectedDate(date);
    setFocusDate(date);
  }

  function onGridFocus(event: FocusEvent<HTMLDivElement>) {
    const cell = cellFrom(event.target);
    select(cell);
    if (cell?.matches(":focus-visible")) showTip(cell);
  }

  function onGridBlur(event: FocusEvent<HTMLDivElement>) {
    if (!hoverDate && !event.currentTarget.contains(event.relatedTarget as Node | null)) hideTip();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const cell = cellFrom(event.target);
    if (!cell || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = Number(cell.dataset.index);
    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    let target: number;
    if (event.key === "Home") target = 0;
    else if (event.key === "End") target = days.length - 1;
    else if (event.key in offsets) target = Math.max(0, Math.min(days.length - 1, index + offsets[event.key]));
    else return;
    event.preventDefault();
    setHoverDate(null);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-date="${days[target].date}"]`)?.focus();
  }

  function onStageMove(event: PointerEvent<HTMLDivElement>) {
    const plane = planeRef.current;
    if (!orbiting || !plane || event.pointerType !== "mouse") return;
    const box = (stageBox.current ??= event.currentTarget.getBoundingClientRect());
    const x = clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1);
    const y = clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1);
    orbit(plane, x, y);
  }

  function onStageLeave() {
    stageBox.current = null;
    if (orbiting && planeRef.current) orbit(planeRef.current, 0, 0);
  }

  const numbers = new Intl.NumberFormat(locale);
  const shortDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const includesToday = calendar.year === null || calendar.year === Number(today.slice(0, 4));
  const statItems: StatItem[] = [
    { key: "active", label: fx("publicationActiveDays"), value: stats.activeDays, unit: fx("publicationDayUnit", { count: stats.activeDays }) },
    { key: "longest", label: fx("publicationLongestStreak"), value: stats.longestStreak, unit: fx("publicationDayUnit", { count: stats.longestStreak }) },
    ...(includesToday
      ? [{ key: "current", label: fx("publicationCurrentStreak"), value: stats.currentStreak, unit: fx("publicationDayUnit", { count: stats.currentStreak }) }]
      : []),
    {
      key: "busiest",
      label: fx("publicationBusiestDay"),
      value: stats.busiest?.count ?? 0,
      unit: fx("publicationUnit", { count: stats.busiest?.count ?? 0 }),
      note: stats.busiest ? shortDate.format(parseDate(stats.busiest.date)) : undefined,
    },
  ];

  return (
    <>
      <FxTrigger
        as="dl"
        className={cn(
          "mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line max-sm:[&>:last-child:nth-child(odd)]:col-span-2",
          statItems.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        {statItems.map((item, index) => (
          <div key={item.key} className="flex min-w-0 flex-col gap-1 bg-bg-elevated px-4 py-3">
            <dt className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{item.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-1.5">
              {unavailable ? <span className="font-display text-xl font-semibold text-fg">—</span> : (
                <>
                  <Odometer value={numbers.format(item.value)} delay={index * 0.08} className="font-display text-xl font-semibold text-fg" />
                  <span className="text-xs text-muted">{item.unit}</span>
                  {item.note && <span className="w-full font-mono text-[10px] text-muted/80">{item.note}</span>}
                </>
              )}
            </dd>
          </div>
        ))}
      </FxTrigger>

      <div
        ref={scrollArea}
        className="mt-4 min-w-0 overflow-x-auto lg:overflow-visible"
        data-lenis-prevent-horizontal
        data-contribution-scroll
        onScroll={hideTip}
      >
        <div
          ref={stageRef}
          className={styles.stage}
          data-view={city ? "city" : "grid"}
          data-3d={solid ? "" : undefined}
          onPointerMove={onStageMove}
          onPointerLeave={onStageLeave}
        >
          <div ref={planeRef} className={cn("grid min-w-[720px] grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-2 px-1", styles.plane)}>
            <div
              className="col-start-2 row-start-1 grid h-4 gap-[3px] font-mono text-[10px] text-muted"
              style={{ gridTemplateColumns }}
              aria-hidden
              data-contribution-months
            >
              {months.map(({ date, label, week }) => (
                <span key={date} className="whitespace-nowrap" style={{ gridColumn: `${week + 1} / span 3`, gridRow: 1 }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="col-start-1 row-start-2 grid grid-rows-7 gap-[3px] font-mono text-[10px] text-muted" aria-hidden>
              <span className="self-center" style={{ gridRowStart: 2 }}>{t("monday")}</span>
              <span className="self-center" style={{ gridRowStart: 4 }}>{t("wednesday")}</span>
              <span className="self-center" style={{ gridRowStart: 6 }}>{t("friday")}</span>
            </div>
            <div
              ref={gridRef}
              role={unavailable ? undefined : "group"}
              aria-hidden={unavailable || undefined}
              aria-label={unavailable ? undefined : t("summary", { count: calendar.total, period: calendar.year ?? t("period") })}
              aria-describedby={unavailable ? undefined : hintId}
              className={cn("relative col-start-2 row-start-2 grid gap-[3px]", styles.grid)}
              style={{ gridTemplateColumns, gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
              data-fx-state={fxState}
              data-focus={focusLevel ?? undefined}
              onPointerOver={onGridOver}
              onPointerLeave={onGridLeave}
              onClick={(event) => select(cellFrom(event.target))}
              onFocus={onGridFocus}
              onBlur={onGridBlur}
              onKeyDown={onGridKeyDown}
              data-contribution-grid
            >
              {cellNodes}
            </div>
          </div>
          <span aria-hidden className={cn(styles.xh, styles.xhV)} />
          <span aria-hidden className={cn(styles.xh, styles.xhH)} />
          {fine && !reduced && (
            <span
              aria-hidden
              className={cn("pointer-events-none absolute right-1 top-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted", styles.hint)}
            >
              <Orbit className="h-3 w-3 text-accent" />
              {fx("publicationOrbitHint")}
            </span>
          )}
        </div>
      </div>

      <div ref={tipRef} aria-hidden="true" className={styles.tip}>
        <div className={cn("w-44 rounded-xl border border-line bg-bg-elevated/95 px-3 py-2.5 shadow-soft backdrop-blur-md", styles.tipBody)}>
          {tipCell && (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{tipCell.label}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="font-display text-xl font-semibold tabular-nums text-fg">{numbers.format(tipCell.day.count)}</span>
                <span className="text-xs text-muted">{fx("publicationUnit", { count: tipCell.day.count })}</span>
              </p>
              <span className="mt-2 flex gap-[3px]">
                {LEVELS.map((level) => (
                  <span
                    key={level}
                    data-level={level}
                    className={cn("h-1 flex-1 rounded-full", level <= tipCell.day.level ? styles.lv : "bg-line")}
                  />
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="min-h-5 text-xs leading-5 text-muted" data-contribution-detail role={unavailable ? "status" : undefined}>
          {unavailable ? t("unavailable") : activeCell ? t("day", { date: activeCell.label, count: activeCell.day.count }) : t("hint")}
        </p>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted" aria-hidden onPointerLeave={() => setFocusLevel(null)}>
          <span>{t("less")}</span>
          {LEVELS.map((level) => (
            <span
              key={level}
              data-level={level}
              className={cn(
                "h-3 w-3 rounded-[2px] transition-[scale,box-shadow] duration-300 ease-(--fx-ease)",
                styles.lv,
                focusLevel === level && "scale-125 shadow-[0_0_0_1.5px_var(--accent)]",
              )}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setFocusLevel(level);
              }}
            />
          ))}
          <span>{t("more")}</span>
        </div>
      </div>
      {!unavailable && <p id={hintId} className="sr-only">{t("keyboardHint")}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-muted/80 sm:hidden">{t("scrollHint")}</p>
    </>
  );
}

export function ResourcePublicationCalendar({
  activity,
  today,
  connected = false,
}: {
  activity: ResourcePublicationDay[] | null;
  today: string;
  connected?: boolean;
}) {
  const t = useTranslations("Home.sitePublishing.calendar");
  const fx = useTranslations("FX.home");
  const cursor = useTranslations("FX.common.cursor");
  const locale = useLocale();
  const selectId = useId();
  const reduced = usePrefersReducedMotion();
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<View>("grid");
  const [solid, setSolid] = useState(false);
  const viewFrame = useRef(0);
  const settle = useRef(0);
  const years = useMemo(() => (activity ? publicationYears(activity, today) : []), [activity, today]);
  const selectedYear = year !== null && years.includes(year) ? year : null;
  const unavailable = activity === null;
  const calendar = useMemo(
    () => publicationCalendar(activity ?? [], today, selectedYear),
    [activity, today, selectedYear],
  );
  const calendarKey = `${calendar.year}-${calendar.startDate}`;

  useEffect(() => () => {
    cancelAnimationFrame(viewFrame.current);
    window.clearTimeout(settle.current);
  }, []);

  function switchView(next: View) {
    cancelAnimationFrame(viewFrame.current);
    window.clearTimeout(settle.current);
    if (reduced) {
      setSolid(next === "city");
      setView(next);
    } else if (next === "city") {
      // The flat 3D scaffold paints first, so the columns rise from the floor instead of popping.
      setSolid(true);
      viewFrame.current = requestAnimationFrame(() => {
        viewFrame.current = requestAnimationFrame(() => setView("city"));
      });
    } else {
      setView("grid");
      settle.current = window.setTimeout(() => setSolid(false), SETTLE_MS);
    }
  }

  const views = [
    { id: "grid" as const, label: fx("publicationViewGrid"), Icon: Grid3x3 },
    { id: "city" as const, label: fx("publicationViewCity"), Icon: Box },
  ];

  return (
    <div
      data-fx-spot=""
      className={cn("fx-spotlight relative min-w-0 rounded-2xl border border-line bg-bg-elevated/60 p-5 sm:p-7", styles.panel)}
      data-resource-publication-calendar
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <ScrambleText text={t("eyebrow")} />
          </h3>
          <p className="mt-2 flex items-baseline gap-2 font-display text-2xl font-semibold text-fg">
            {!unavailable ? (
              <>
                <Odometer key={calendarKey} value={new Intl.NumberFormat(locale).format(calendar.total)} />
                <span className="text-base font-medium text-muted">{fx("publicationUnit", { count: calendar.total })}</span>
              </>
            ) : (
              "—"
            )}
          </p>
            <p className="mt-1 text-xs text-muted" data-contribution-period aria-live="polite">
              {calendar.year ?? t("period")}<span className="mx-2" aria-hidden>·</span>
              <span className="font-mono text-[10px]">{calendar.startDate} — {calendar.endDate > today ? today : calendar.endDate}</span>
            </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div role="group" aria-label={fx("publicationViewLabel")} className="relative grid grid-cols-2 rounded-full border border-line bg-bg p-1">
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-fg transition-[translate] duration-500 ease-(--fx-ease)"
                style={{ translate: view === "city" ? "100% 0" : "0 0" }}
              />
              {views.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => switchView(id)}
                  className={cn(
                    "relative inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 font-mono text-[11px] transition-colors duration-300 pointer-coarse:min-h-11",
                    view === id ? "text-bg" : "text-muted hover:text-fg",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          <label htmlFor={selectId} className="sr-only">{t("chooseYear")}</label>
          <select
            id={selectId}
            value={selectedYear ?? "recent"}
            onChange={(event) => setYear(event.target.value === "recent" ? null : Number(event.target.value))}
            disabled={unavailable}
            className="min-h-10 cursor-pointer rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-fg transition-colors hover:border-accent/40 pointer-coarse:min-h-11"
          >
            <option value="recent">{t("period")}</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <Link
            href={sansphaseLinks.resources}
            prefetch={connected ? false : undefined}
            data-cursor-text={cursor("visit")}
            className="group inline-flex items-center gap-1.5 py-2 font-mono text-xs text-accent transition-colors hover:text-fg pointer-coarse:min-h-11"
          >
            {t("view")}
            <ArrowSwap className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <PublicationGrid key={calendarKey} calendar={calendar} today={today} view={view} solid={solid} unavailable={unavailable} />
      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted/80">
        {connected ? t("scope") : t("source", { scope: t("scope") })}
      </p>
    </div>
  );
}
