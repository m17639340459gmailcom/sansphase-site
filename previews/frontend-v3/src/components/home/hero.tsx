import { useLocale, useTranslations } from "next-intl";
import { Aurora } from "@/components/fx/aurora";
import { BorderBeam } from "@/components/fx/border-beam";
import { FxTrigger } from "@/components/fx/trigger";
import { HeroGridTrail } from "@/components/home/hero/grid-trail";
import { HeroAccent } from "@/components/home/hero/hero-accent";
import { HeroScrollLayer, HeroSection } from "@/components/home/hero/hero-motion";
import styles from "@/components/home/hero/hero.module.css";
import { HeroScrollCue } from "@/components/home/hero/scroll-cue";
import { HeroCanvas } from "@/components/three/hero-canvas";
import { ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";
import { sansphaseLinks } from "@/data/sansphase";
import { cn } from "@/lib/utils";

/**
 * The headline and links are ready on first paint. Accent and particle flourishes stay decorative.
 * Scrolling away lifts the copy and sinks the stage.
 */
export function Hero() {
  const t = useTranslations("Home");
  const isChinese = useLocale() === "zh";
  const title = t("headline1");
  const accent = t("headline2");

  return (
    <HeroSection className="relative isolate overflow-hidden pt-28 sm:pt-32 lg:pt-28" aria-labelledby="hero-title">
      {/* Atmosphere: grid, glow, drifting light, and a grid that lights up around the pointer. */}
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-20 opacity-40" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20"
        style={{ backgroundImage: "var(--hero-glow)" }}
      />
      <Aurora className="-z-20" intensity={0.75} />
      <div
        aria-hidden
        data-fx-spot=""
        className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0 -z-10 [--fx-spot-size:18rem]"
      />
      <HeroGridTrail />

      <FxTrigger
        trigger="mount"
        className="container-x relative grid items-center gap-10 pb-16 lg:min-h-[calc(min(100svh,960px)-7rem)] lg:grid-cols-2 lg:gap-14 lg:pt-8 lg:pb-24"
      >
        <HeroScrollLayer layer="copy" className="relative z-10 max-w-2xl">
          <p className="eyebrow mb-7 flex items-center gap-3 leading-relaxed">
            <span aria-hidden="true" className="inline-block h-px w-8 shrink-0 bg-accent" />
            {t("eyebrow")}
          </p>

          <h1
            id="hero-title"
            className={cn(
              "font-display font-semibold",
              isChinese
                ? "text-[clamp(1.8rem,4vw,3.65rem)] leading-[1.28] tracking-[-0.035em] sm:text-[clamp(2.5rem,4vw,3.65rem)]"
                : "text-[clamp(2.8rem,5.4vw,4.8rem)] leading-[1.08] tracking-[-0.04em]",
            )}
          >
            <span className="block">{title}</span>{" "}
            <span className="block pb-3 font-serif font-normal italic tracking-[-0.01em] text-accent">
              <HeroAccent text={accent} />
            </span>
          </h1>

          <p className="mt-7 max-w-[34rem] text-[15px] leading-[1.95] text-muted sm:text-base lg:max-w-[30rem] lg:pr-6 xl:max-w-[34rem]">
            {t("intro")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Magnetic>
              <ButtonLink href={sansphaseLinks.work} size="lg" arrow>
                {t("ctaPrimary")}
              </ButtonLink>
            </Magnetic>
            <Magnetic strength={0.25}>
              <span className="relative inline-flex rounded-full">
                <ButtonLink href={sansphaseLinks.blogIndex} size="lg" variant="secondary">
                  {t("ctaSecondary")}
                </ButtonLink>
                <BorderBeam duration={7} size={60} />
              </span>
            </Magnetic>
          </div>
        </HeroScrollLayer>

        <HeroScrollLayer layer="stage" className="relative mx-auto w-full max-w-[38rem] lg:max-w-none">
          <div data-reveal="" className={styles.reveal}>
            <HeroCanvas className="w-full" />
          </div>
          <span aria-hidden className={styles.scan} />
        </HeroScrollLayer>
      </FxTrigger>

      <HeroScrollCue hint={t("scrollHint")} />
    </HeroSection>
  );
}
