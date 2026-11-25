import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";
import { Reveal } from "@/components/ui/reveal";

export function CtaBand() {
  const t = useTranslations("Home.cta");

  return (
    <section className="container-x pb-8 pt-8">
      <Reveal>
        <div className="noise relative overflow-hidden rounded-[2rem] bg-accent px-8 py-16 text-white sm:px-14 sm:py-20">
          <div className="grid-bg-dense pointer-events-none absolute inset-0 opacity-30 [--grid:rgba(255,255,255,0.25)]" />
          <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-amber/60 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-white/20 blur-3xl" />
          <div className="relative flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow mb-5 flex items-center gap-3 text-white/70">
                <span className="inline-block h-px w-6 bg-white/70" />
                {t("eyebrow")}
              </p>
              <h2 className="font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl lg:text-6xl">
                {t("title")}{" "}
                <span className="font-serif font-normal italic">{t("titleAccent")}</span>
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
                {t("body")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Magnetic>
                <ButtonLink
                  href="/contact"
                  size="lg"
                  arrow
                  className="bg-white text-accent shadow-none hover:bg-white/90 hover:shadow-none"
                >
                  {t("button")}
                </ButtonLink>
              </Magnetic>
              <ButtonLink
                href="/about"
                size="lg"
                variant="secondary"
                className="border-white/40 text-white hover:border-white hover:text-white"
              >
                {t("secondary")}
              </ButtonLink>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
