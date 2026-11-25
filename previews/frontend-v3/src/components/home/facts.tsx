import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SplitText } from "@/components/fx/split-text";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { FxTrigger } from "@/components/fx/trigger";
import { FactValue } from "@/components/home/hero/fact-value";
import styles from "@/components/home/hero/facts.module.css";
import { articles, readingTopics } from "@/data/sansphase";
import { cn } from "@/lib/utils";

type Fact = { value: string; label: string };

export function Facts({ selectedCount, topicCount }: { selectedCount?: number | null; topicCount?: number | null }) {
  const t = useTranslations("Home.facts");
  const items: Fact[] = [
    { value: selectedCount === null ? "—" : String(selectedCount ?? articles.length).padStart(2, "0"), label: t("selected") },
    { value: topicCount === null ? "—" : String(topicCount ?? readingTopics.length).padStart(2, "0"), label: t("topics") },
    { value: "中文 · EN", label: t("languages") },
    { value: "UTC+8", label: t("time") },
  ];

  return (
    <section className="container-x pt-16 sm:pt-20">
      <FxTrigger as="p" className="eyebrow mb-6 flex items-center gap-3">
        <span className="fx-line inline-block h-px w-6 bg-accent" />
        <ScrambleText text={t("eyebrow")} />
      </FxTrigger>
      <SpotlightGroup data-fx-spot="" className={styles.grid}>
        {items.map((item, i) => {
          const index = String(i + 1).padStart(2, "0");
          const delay = i * 0.07;
          return (
            <FxTrigger
              key={item.label}
              data-fx-spot=""
              className={styles.cell}
              style={{ "--delay": `${delay}s` } as CSSProperties}
            >
              <span aria-hidden="true" className={styles.sweep} />
              <span aria-hidden="true" className={styles.index}>
                <SplitText text={index} by="char" delay={delay} stagger={0.07} className={styles.indexBase} />
                <span data-fx-spot="" className={cn("fx-spot-lit", styles.indexLit)}>
                  <SplitText text={index} by="char" delay={delay} stagger={0.07} />
                </span>
              </span>
              <div className={styles.body}>
                <FactValue
                  value={item.value}
                  delay={delay + 0.12}
                  className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
                />
                <span data-reveal="" className={cn(styles.label, "text-sm text-muted")}>
                  {item.label}
                </span>
              </div>
            </FxTrigger>
          );
        })}
      </SpotlightGroup>
    </section>
  );
}
