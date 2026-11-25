import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommunityBoards } from "@/components/community/community-boards";
import { CommunityFeed } from "@/components/community/community-feed";
import { communityCopy, toCommunityLocale } from "@/components/community/copy";
import { TeaRoomPreview } from "@/components/community/tea-room-preview";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tag } from "@/components/ui/tag";
import { communityBoardHref, demoBoards, demoTopicSummaries, getDemoBoard } from "@/data/sansphase-community";
import { routing } from "@/i18n/routing";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";

type Props = { params: Promise<{ locale: string; board: string }> };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => demoBoards.map(({ id }) => ({ locale, board: id })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: language, board } = await params;
  const locale = toCommunityLocale(language);
  const info = getDemoBoard(board);
  if (!info) return {};
  return sansphasePageMetadata(locale, communityBoardHref(info.id), info.name[locale], info.description[locale]);
}

export default async function CommunityBoardPage({ params }: Props) {
  const { locale: language, board } = await params;
  const locale = toCommunityLocale(language);
  const copy = communityCopy[locale];
  const info = getDemoBoard(board);
  if (!info) notFound();
  const topics = demoTopicSummaries.filter((topic) => topic.board === info.id);

  return (
    <>
      <PageHeader eyebrow={copy.boards} title={info.name[locale]} body={info.description[locale]} className="sm:pt-36">
        <div className="flex flex-wrap items-center gap-2.5">
          <ButtonLink href="/community" variant="secondary">{copy.home}</ButtonLink>
          {info.id !== "vip" && <ButtonLink href={`/community/new?board=${info.id}`} arrow>{copy.newPost}</ButtonLink>}
          <Tag tone="accent">{copy.preview}</Tag>
        </div>
      </PageHeader>
      <div className="container-x grid items-start gap-9 pb-16 pt-6 lg:grid-cols-[minmax(0,1fr)_19rem] xl:gap-12">
        <div className="min-w-0">
          <div className="mb-5 rounded-xl border border-line bg-bg-elevated p-4 text-sm leading-6">
            <strong className="mr-2 text-accent">{copy.guide}</strong>
            <span className="text-muted">{info.tip[locale]}</span>
          </div>
          {info.id === "vip" ? <TeaRoomPreview locale={locale} /> : <CommunityFeed locale={locale} topics={topics} />}
        </div>
        <CommunityBoards locale={locale} current={info.id} />
      </div>
    </>
  );
}
