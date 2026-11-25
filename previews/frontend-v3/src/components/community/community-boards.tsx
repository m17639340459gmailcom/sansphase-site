import { ArrowUpRight, Coffee, Feather, Image, LifeBuoy, Megaphone, Package } from "lucide-react";
import { demoBoards, demoTopicSummaries, communityBoardHref, type DemoBoardId } from "@/data/sansphase-community";
import { Link } from "@/i18n/navigation";
import { communityCopy, type CommunityLocale } from "./copy";

const boardIcons = { qa: LifeBuoy, showcase: Image, tools: Package, moments: Feather, meta: Megaphone, vip: Coffee };

export function CommunityBoards({ locale, current }: { locale: CommunityLocale; current?: DemoBoardId }) {
  const copy = communityCopy[locale];

  return (
    <nav aria-labelledby="community-boards-label" className="min-w-0">
      <h2 id="community-boards-label" className="mb-4 font-display text-2xl font-semibold tracking-tight">{copy.boards}</h2>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {demoBoards.map(({ id, name, description }) => {
          const Icon = boardIcons[id];
          const count = demoTopicSummaries.filter((topic) => topic.board === id).length;
          return (
            <li key={id}>
              <Link
                className="group grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-line bg-bg-elevated px-3.5 py-3 transition-colors hover:border-accent/50 aria-[current=page]:border-accent/50 aria-[current=page]:bg-accent-soft"
                href={communityBoardHref(id)}
                aria-current={current === id ? "page" : undefined}
                prefetch={false}
              >
                <span className="mt-0.5 grid size-8 place-items-center rounded-md border border-line bg-surface text-accent"><Icon aria-hidden className="size-4" /></span>
                <span className="min-w-0">
                  <strong className="block text-sm text-fg">{name[locale]}</strong>
                  <span className="mt-1 block text-pretty text-xs leading-5 text-muted">{description[locale]}</span>
                </span>
                <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted">
                  {id === "vip" ? "VIP" : <span aria-label={copy.resultCount(count)}>{count}</span>}
                  <ArrowUpRight aria-hidden className="size-3.5 group-hover:text-accent" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
