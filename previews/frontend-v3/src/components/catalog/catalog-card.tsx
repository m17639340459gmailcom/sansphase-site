import { ArrowUpRight, Download } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { SpotlightCard, SpotlightGroup } from "@/components/fx/spotlight";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CatalogCover } from "./catalog-cover";

export function CatalogCardGrid({ children, fillWidth = false }: { children: ReactNode; fillWidth?: boolean }) {
  return (
    <SpotlightGroup as="ul" className={cn("grid gap-4", fillWidth
      ? "mx-auto w-full max-w-[22rem] grid-cols-1 sm:max-w-none sm:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-[minmax(0,22rem)] sm:grid-cols-[repeat(2,minmax(0,19rem))] lg:grid-cols-[repeat(3,minmax(0,19rem))]")}>
      {children}
    </SpotlightGroup>
  );
}

export function CatalogCard({ href, title, summary, image, fallback, label, download }: ComponentProps<typeof CatalogCover> & {
  href: string;
  title: string;
  summary: string;
  label?: string;
  download?: { href: string; label: string };
}) {
  return (
    <li className="min-w-0">
      <SpotlightCard as="article" className="h-full overflow-hidden rounded-2xl border border-line bg-bg-elevated">
        <Link href={href} prefetch={false} aria-label={label} className="group flex h-full flex-col rounded-2xl transition-colors hover:text-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
          <CatalogCover image={image} fallback={fallback} />
          <div className={cn("flex min-h-[4.5rem] items-center gap-2.5 px-3.5 py-2.5", download && "pr-14")}>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="truncate font-display text-base leading-5 font-semibold">{title}</h2>
              {summary && <p className="line-clamp-1 text-sm leading-5 text-muted">{summary}</p>}
            </div>
            {!download && <ArrowUpRight className="size-4 shrink-0 text-muted transition-colors group-hover:text-accent group-focus-visible:text-accent" aria-hidden />}
          </div>
        </Link>
        {download && (
          <a href={download.href} download aria-label={download.label} title={download.label}
            className="absolute end-1.5 bottom-3.5 grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-soft hover:text-accent focus-visible:text-accent">
            <Download className="size-4" aria-hidden />
          </a>
        )}
      </SpotlightCard>
    </li>
  );
}
