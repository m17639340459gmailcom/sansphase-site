import { Asterisk } from "lucide-react";
import { useTranslations } from "next-intl";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { VelocityMarquee } from "@/components/fx/velocity-marquee";
import { TechIcon } from "@/components/ui/tech-icon";
import { iconKeyForStack } from "@/lib/icons";

function Glyph({ item }: { item: string }) {
  const key = iconKeyForStack(item);
  return key ? <TechIcon icon={key} name={item} size={15} /> : <span className="block h-1.5 w-1.5 rounded-full bg-accent" />;
}

/**
 * Two counter-running rows whose speed and skew follow scroll velocity and which ease to a stop
 * under the pointer: mono chips whose icons light up in accent near the cursor, and a row of
 * large outlined names that fill with accent around it.
 */
export function TechMarquee() {
  const t = useTranslations("Home");
  const fx = useTranslations("FX.hero");
  const items = t.raw("marquee") as string[];

  return (
    <section aria-label={fx("marquee")} className="relative overflow-hidden border-y border-line">
      <SpotlightGroup className="py-5 [--fx-spot-size:5.5rem]">
        <VelocityMarquee baseVelocity={40} itemClassName="px-7">
          {items.map((item) => (
            <span key={item} className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-muted">
              <span aria-hidden="true" className="relative grid place-items-center text-fg/70">
                <Glyph item={item} />
                <span data-fx-spot="" className="fx-spot-lit absolute inset-0 grid place-items-center text-accent">
                  <Glyph item={item} />
                </span>
              </span>
              {item}
            </span>
          ))}
        </VelocityMarquee>
      </SpotlightGroup>
      <SpotlightGroup aria-hidden="true" className="border-t border-line py-3 [--fx-spot-size:12rem] motion-reduce:hidden sm:py-4">
        <VelocityMarquee reverse baseVelocity={26} itemClassName="px-3 sm:px-4">
          {[...items].reverse().map((item) => (
            <span key={item} className="flex items-center gap-6 sm:gap-8">
              <span className="relative font-display text-[clamp(2.25rem,6vw,5rem)] font-semibold leading-[1.05] tracking-[-0.04em] whitespace-nowrap">
                <span className="text-outline">{item}</span>
                <span data-fx-spot="" className="fx-spot-lit absolute inset-0 text-accent">
                  {item}
                </span>
              </span>
              <Asterisk className="h-5 w-5 shrink-0 text-accent/70 sm:h-6 sm:w-6" strokeWidth={1.5} />
            </span>
          ))}
        </VelocityMarquee>
      </SpotlightGroup>
    </section>
  );
}
