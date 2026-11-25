import { BookOpen, LibraryBig, PanelsTopLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { BorderBeam } from "@/components/fx/border-beam";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SplitText } from "@/components/fx/split-text";
import { FxTrigger } from "@/components/fx/trigger";
import { ArrowSwap } from "@/components/home/data/arrow-swap";
import styles from "@/components/home/data/learning.module.css";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { localize, sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const sections = [
  {
    icon: BookOpen,
    title: { zh: "资料", en: "Learning materials" },
    detail: { zh: "学习资料与可用模板", en: "Guides and editable templates" },
    href: sansphaseLinks.learning,
  },
  {
    icon: PanelsTopLeft,
    title: { zh: "软件推荐", en: "Software" },
    detail: { zh: "软件用途、上手方法与适用场景", en: "What to use, when to use it and how to get started" },
    href: sansphaseLinks.software,
  },
  {
    icon: LibraryBig,
    title: { zh: "资源中心", en: "Resource center" },
    detail: { zh: "浏览藏书目录，打开章节试读", en: "Browse the catalogue and open sample chapters" },
    href: sansphaseLinks.resources,
  },
] as const;

export async function LearningSpotlight({ connected = false }: { connected?: boolean }) {
  const [locale, cursor] = await Promise.all([getLocale(), getTranslations("FX.common.cursor")]);
  const en = locale === "en";

  return (
    <section className="container-x section-space border-t border-line">
      <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
        <SectionHeading eyebrow={en ? "RESOURCES" : "学习与阅读"} title={en ? "Learn at" : "从一份资料开始，"} accent={en ? "your own pace." : "按你的节奏读。"} />
        <ButtonLink href={sansphaseLinks.resources} variant="secondary" arrow>{en ? "Browse the library" : "浏览资源中心"}</ButtonLink>
      </div>
      <FxTrigger
        as="article"
        amount={0.25}
        className={cn("relative mt-10 grid rounded-2xl border border-line bg-bg-elevated lg:grid-cols-2", styles.card)}
      >
        <BorderBeam duration={9} size={90} />
        <div className="p-6 sm:p-8">
          <p className="eyebrow flex items-center gap-2 text-accent">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            <span>SANSPHASE</span>
          </p>
          <SplitText as="h3" text={en ? "Guides, tools and books" : "资料、工具与藏书"} delay={0.1} className="mt-4 text-2xl font-semibold tracking-tight" />
          <p className="mt-3 max-w-xl text-sm leading-8 text-muted">
            {en ? "Find a template for your next project, compare tools for the task, or return to a book you want to finish." : "找一份能用在手头项目里的模板，看看哪款软件适合当前任务，或者挑一本书继续读。"}
          </p>
        </div>
        <div className="border-t border-line p-6 sm:p-8 lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between gap-6">
            <p className="eyebrow text-muted">
              <ScrambleText text={en ? "Browse by section" : "按栏目查找"} />
            </p>
            <div aria-hidden className="flex gap-1.5">
              {sections.map((section, index) => (
                <div className="flex flex-col gap-1.5" key={section.href}>
                  {sections.map((cell, row) => (
                    <span
                      key={cell.href}
                      className={styles.mapCell}
                      data-pick={row === index ? "" : undefined}
                      data-x={row === index ? index : undefined}
                      style={{ "--d": index + row } as CSSProperties}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-4 divide-y divide-line">
            {sections.map(({ icon: Icon, title, detail, href }, index) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={connected ? false : undefined}
                  data-x={index}
                  data-cursor-text={cursor("open")}
                  style={{ "--i": index } as CSSProperties}
                  className={cn(
                    "group relative flex min-h-12 items-center gap-4 py-3 text-sm text-fg transition-colors duration-300 hover:text-accent focus-visible:text-accent",
                    styles.lesson,
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 transition-[translate] duration-500 ease-(--fx-ease) motion-safe:group-hover:translate-x-1">
                    <span className="block font-medium">{localize(title, locale)}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{localize(detail, locale)}</span>
                  </span>
                  <ArrowSwap className="size-3.5 shrink-0" />
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-accent transition-[scale] duration-700 ease-(--fx-ease) group-hover:scale-x-100 group-focus-visible:scale-x-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </FxTrigger>
    </section>
  );
}
