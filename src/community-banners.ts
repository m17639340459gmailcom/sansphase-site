/** The public editor keeps image UUIDs, never caller-provided asset URLs. */
type CommunityBannerFields = {
  title: string;
  cover: string | null;
  board: string;
  topicTitle: string;
  image?: string | null;
  topicImage?: string | null;
};

/** Historical post slides keep their response shape; images never need a fake post. */
export type CommunityBannerItem = CommunityBannerFields & (
  | { kind?: 'post'; topicId: string }
  | { kind: 'image'; topicId: null }
);

/** Home and every board have independent ordered configurations. */
export type CommunityBannerConfig = {
  scope: string;
  version: number;
  items: CommunityBannerItem[];
};
