export const SANSPHASE_NAME = { zh: "無相", en: "SANSPHASE" };

export const sansphaseLinks = {
  home: "/",
  about: "/about",
  blogIndex: "/about#blog",
  blog: "/blog",
  work: "/projects",
  learning: "/learning",
  software: "/software",
  resources: "/resources",
  community: "/community",
  contact: "/contact",
} as const;

export type LocalizedText = { zh: string; en: string };

export function localize(text: LocalizedText, locale: string): string {
  return locale === "en" ? text.en : text.zh;
}

type Topic = "knowledge" | "video";
type Article = {
  slug: string;
  title: LocalizedText;
  summary: LocalizedText;
  tags: LocalizedText[];
  topic: Topic;
  date: string;
  coverSize: { width: number; height: number };
};

// Fictional V3 case notes modeled on the public site's editorial categories.
const selections: Article[] = [
  {
    slug: "personal-knowledge-base-completed",
    title: { zh: "给「潮汐档案」做一轮交接：从归档到找回一条决定", en: "Handing over the Tide Archive and finding a decision again" },
    summary: { zh: "用一组虚构的影像资料验证目录、来源卡与复盘如何衔接，并记录找不到答案时的处理。", en: "A trial with fictional film records tests how an index, source cards, and review notes work together." },
    tags: [{ zh: "个人知识库", en: "Knowledge base" }, { zh: "AI 协作", en: "AI collaboration" }, { zh: "资料管理", en: "Research records" }],
    topic: "knowledge",
    date: "2026-11-18",
    coverSize: { width: 960, height: 540 },
  },
  {
    slug: "ai-short-video-workflow-consolidation",
    title: { zh: "从《晨线》到《返航》：短片制作的一次交接复盘", en: "From First Light to Homeward: a film production handoff" },
    summary: { zh: "用两支虚构短片梳理文稿、旁白、分镜和试看的交接点，重点检查观众是否来得及看清。", en: "Two fictional films show how scripts, narration, storyboards, and previews pass between stages." },
    tags: [{ zh: "AI 视频", en: "AI video" }, { zh: "短视频工作流", en: "Short-video workflow" }, { zh: "项目复盘", en: "Retrospective" }],
    topic: "video",
    date: "2026-11-12",
    coverSize: { width: 960, height: 540 },
  },
  {
    slug: "personal-knowledge-base-for-codex",
    title: { zh: "一张线索卡怎样交给 AI：潮汐档案的检索练习", en: "Giving AI a source card: a Tide Archive search exercise" },
    summary: { zh: "从四份虚构笔记开始，观察关键词搜索和来源索引分别在哪些问题上有效。", en: "Four fictional notes illustrate when keyword search and a source index each help." },
    tags: [{ zh: "个人知识库", en: "Knowledge base" }, { zh: "资料管理", en: "Research records" }, { zh: "检索", en: "Search" }],
    topic: "knowledge",
    date: "2026-11-05",
    coverSize: { width: 960, height: 540 },
  },
  {
    slug: "ai-short-video-workflow-retrospective",
    title: { zh: "让三张分镜接得上：《静港》片段试看的记录", en: "Making three shots connect: a Quiet Harbor review" },
    summary: { zh: "一次虚构的片段试看，记录图像、声音与字幕怎样暴露分镜交接中的断点。", en: "A fictional preview shows how images, voice and captions expose a break between shots." },
    tags: [{ zh: "AI 视频", en: "AI video" }, { zh: "分镜设计", en: "Storyboard" }, { zh: "项目复盘", en: "Retrospective" }],
    topic: "video",
    date: "2026-10-29",
    coverSize: { width: 960, height: 540 },
  },
];

export const articles = selections.map((article) => ({
  ...article,
  href: sansphaseLinks.blog + "/" + article.slug,
  cover: "/images/demo-editorial/" + article.slug + ".webp",
}));

export const topicNames: Record<Topic, LocalizedText> = {
  knowledge: { zh: "个人知识库", en: "Personal knowledge base" },
  video: { zh: "AI 影像工作流", en: "AI video workflow" },
};

export const readingTopics = (["knowledge", "video"] as const).map((id) => ({
  id,
  title: topicNames[id],
  articles: articles.filter((article) => article.topic === id),
}));
