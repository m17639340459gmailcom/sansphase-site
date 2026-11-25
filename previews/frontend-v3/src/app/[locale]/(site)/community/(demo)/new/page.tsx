import type { Metadata } from "next";
import { CommunityComposer } from "@/components/community/community-composer";
import { communityCopy, toCommunityLocale } from "@/components/community/copy";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { publicDemoBoards } from "@/data/sansphase-community";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ board?: string | string[] }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale: language } = await params;
  const locale = toCommunityLocale(language);
  const copy = communityCopy[locale];
  return sansphasePageMetadata(locale, "/community/new", copy.newPost, copy.disclosure);
}

export default async function ComposePreviewPage({ params, searchParams }: Props) {
  const [{ locale: language }, { board }] = await Promise.all([params, searchParams]);
  const locale = toCommunityLocale(language);
  const copy = communityCopy[locale];
  const initialBoard = publicDemoBoards.find(({ id }) => id === board)?.id ?? "qa";

  return (
    <>
      <PageHeader eyebrow={copy.name} title={copy.newPost} body={copy.disclosure} className="sm:pt-36">
        <div><ButtonLink href="/community" variant="secondary">{copy.home}</ButtonLink></div>
      </PageHeader>
      <div className="container-x pb-16 pt-5">
        <div className="max-w-3xl"><CommunityComposer key={initialBoard} locale={locale} initialBoard={initialBoard} /></div>
      </div>
    </>
  );
}
