/** The public editor keeps image UUIDs, never caller-provided asset URLs. */
export type CommunityBannerItem = {
  topicId: string;
  title: string;
  cover: string | null;
  board: string;
  topicTitle: string;
  image?: string | null;
  topicImage?: string | null;
};

/** Home and every board have independent ordered configurations. */
export type CommunityBannerConfig = {
  scope: string;
  version: number;
  items: CommunityBannerItem[];
};
