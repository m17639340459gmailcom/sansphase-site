import { ArrowRight, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { SpotlightCard, SpotlightGroup } from "@/components/fx/spotlight";
import { FxTrigger } from "@/components/fx/trigger";
import { TiltCard } from "@/components/ui/tilt-card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { FlowRail } from "./flow-rail";
import styles from "./skills.module.css";

const steps = [
  { image: "context", href: "/blog/structured-workflows" },
  { image: "review", href: "/projects/as-a" },
  { image: "scope", href: "/projects/omnigate" },
  { image: "docs", href: "/blog" },
] as const;
type Step = { title: string; body: string; link: string };

const ease = "ease-[cubic-bezier(0.16,1,0.3,1)]";

export function WorkflowCards() {
  const t = useTranslations("Skills.principles");
  const items = t.raw("items") as Step[];
  return (
    <FxTrigger className={cn(styles.flow, "mt-10")} amount={0.15}>
      <FlowRail count={items.length} />
      <SpotlightGroup as="ol" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-workflow-cards="">
        {items.map((item, index) => (
          <li key={steps[index].image} className={cn(styles.step, "min-w-0")} style={{ "--i": index } as CSSProperties}>
            <TiltCard max={6} glare={false} className="group/step h-full rounded-2xl">
              <SpotlightCard className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-bg-elevated">
                <div className="relative aspect-[3/2] overflow-hidden bg-[#eee5d8]">
                  <Image
                    src={`/images/workflow/${steps[index].image}.webp`}
                    alt=""
                    fill
                    sizes="(min-width: 1280px) 280px, (min-width: 1024px) 23vw, (min-width: 640px) 45vw, 100vw"
                    className={cn("object-cover transition-transform duration-700", ease, "group-hover/step:scale-[1.04]")}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "text-outline-accent absolute right-3 bottom-1 font-display text-6xl leading-none font-semibold tracking-[-0.04em] opacity-80 transition-[color,translate] duration-500",
                      ease,
                      "group-hover/step:-translate-y-1 group-hover/step:text-accent",
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5 sm:p-6">
                  <div className="mb-4 flex items-center justify-between text-accent">
                    <span className="font-mono text-[11px] tracking-widest">0{index + 1} /</span>
                    {index < items.length - 1 && (
                      <ArrowRight aria-hidden="true" className={cn("h-4 w-4 transition-transform duration-500", ease, "group-hover/step:translate-x-1")} />
                    )}
                  </div>
                  <h3 className="font-display text-lg font-semibold leading-snug tracking-tight">{item.title}</h3>
                  <p className="mt-3 mb-6 text-[13px] leading-[1.9] text-muted">{item.body}</p>
                  <Link
                    href={steps[index].href}
                    className="group/link mt-auto inline-flex min-h-11 items-center justify-between gap-3 border-t border-line pt-3 text-xs font-medium transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                  >
                    <span className={cn("bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-500", ease, "group-hover/link:bg-[length:100%_1px] group-focus-visible/link:bg-[length:100%_1px]")}>
                      {item.link}
                    </span>
                    <span aria-hidden className="relative inline-grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden">
                      <ArrowUpRight className={cn("absolute h-3.5 w-3.5 transition-transform duration-300", ease, "group-hover/link:translate-x-3.5 group-hover/link:-translate-y-3.5 group-focus-visible/link:translate-x-3.5 group-focus-visible/link:-translate-y-3.5")} />
                      <ArrowUpRight className={cn("absolute h-3.5 w-3.5 -translate-x-3.5 translate-y-3.5 transition-transform duration-300", ease, "group-hover/link:translate-x-0 group-hover/link:translate-y-0 group-focus-visible/link:translate-x-0 group-focus-visible/link:translate-y-0")} />
                    </span>
                  </Link>
                </div>
              </SpotlightCard>
            </TiltCard>
          </li>
        ))}
      </SpotlightGroup>
    </FxTrigger>
  );
}
