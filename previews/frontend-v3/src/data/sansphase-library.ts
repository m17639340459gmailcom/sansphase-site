import type { LocalizedText } from "./sansphase";

export const bookCategories = {
  practice: { zh: "创作实践", en: "Creative practice" },
  video: { zh: "AI 影像", en: "AI video" },
  knowledge: { zh: "个人知识库", en: "Knowledge systems" },
} satisfies Record<string, LocalizedText>;

export type BookCategory = keyof typeof bookCategories;
export type BookChapter = { id: string; title: LocalizedText; summary: LocalizedText };
export type DemoBook = {
  slug: string;
  href: `/resources/${string}`;
  title: LocalizedText;
  summary: LocalizedText;
  overview: LocalizedText;
  cover: { src: string; width: number; height: number };
  category: BookCategory;
  tags: readonly LocalizedText[];
  date: string;
  vipOnly: boolean;
  chapters: readonly BookChapter[];
};

export const demoBooks: readonly DemoBook[] = [
  {
    slug: "creative-practice-notebook",
    href: "/resources/creative-practice-notebook",
    title: { zh: "创作记录手册", en: "Creative Practice Notebook" },
    summary: {
      zh: "从一周的学习记录，到一个作品的发布与归档。适合想把过程整理清楚的独立创作者。",
      en: "From a week of learning notes to publishing and archiving a project, for independent makers who want a legible process.",
    },
    overview: {
      zh: "本书用虚构的《窗边光线》小项目串起学习笔记、作品说明和资料索引。每一章附有可照填的例子，可以依次做完，也可以从当前最缺的一项开始。",
      en: "A fictional project called Window Light connects learning notes, a project write-up and a source index. Each chapter offers a worked example you can adapt in order or on its own.",
    },
    cover: { src: "/images/demo-editorial/star-window.webp", width: 960, height: 540 },
    category: "practice",
    tags: [{ zh: "学习记录", en: "Learning journal" }, { zh: "项目复盘", en: "Project review" }],
    date: "2026-11-20",
    vipOnly: false,
    chapters: [
      {
        id: "learning-journal",
        title: { zh: "把学习记成可以重做的一次实验", en: "Record a lesson as a repeatable experiment" },
        summary: { zh: "用目标、唯一变量、结果和下一步记录一次光线练习。", en: "Document one lighting exercise with a goal, a single variable, a result and a next step." },
      },
      {
        id: "project-checklist",
        title: { zh: "写好一篇作品说明", en: "Write a project case note" },
        summary: { zh: "从一个看得见的结果讲起，把试错、选择和交付材料组织起来。", en: "Start with a visible outcome, then organize the choices, mistakes and deliverables." },
      },
      {
        id: "source-index",
        title: { zh: "整理可追溯的资料索引", en: "Build a traceable source index" },
        summary: { zh: "把光线参考、取舍和适用场景放进一张可维护的表。", en: "Keep lighting references, decisions and use cases in a searchable table." },
      },
    ],
  },
  {
    slug: "ai-production-field-guide",
    href: "/resources/ai-production-field-guide",
    title: { zh: "AI 短片制作现场笔记", en: "AI Short-Film Field Notes" },
    summary: {
      zh: "以一支 30 秒虚构短片为例，串起脚本节拍、分镜交接与成片查验。",
      en: "Use a fictional 30-second short to connect script beats, shot handoffs and final review.",
    },
    overview: {
      zh: "从虚构的《末班信号》开始。先决定观众在每十秒看到什么，再把镜头拆成可以独立预览的交付项，最后用普通观众的视角核查一个完整版本。",
      en: "Start with the fictional Last Signal. Decide what viewers should see every ten seconds, hand over shots as independently reviewable units, and watch the final cut from a first-time viewer's perspective.",
    },
    cover: { src: "/images/demo-editorial/film-detail.webp", width: 960, height: 540 },
    category: "video",
    tags: [{ zh: "短片工作流", en: "Short-film workflow" }, { zh: "分镜设计", en: "Shot design" }],
    date: "2026-11-14",
    vipOnly: false,
    chapters: [
      {
        id: "script-beats",
        title: { zh: "安排三十秒的脚本节拍", en: "Plan the beats of a thirty-second short" },
        summary: { zh: "把开场、转折和落点分别落到可检查的时间点。", en: "Turn setup, turn and payoff into reviewable time markers." },
      },
      {
        id: "shot-handoff",
        title: { zh: "把分镜交给下一环节", en: "Hand off a storyboard" },
        summary: { zh: "每条镜头只说清一个任务，并记录跨镜头连续性。", en: "Give each shot one job and record what needs to carry across cuts." },
      },
      {
        id: "final-review",
        title: { zh: "成片发布前的两遍检查", en: "Review a final cut in two passes" },
        summary: { zh: "先看观众是否能懂，再逐条检查字幕、音乐和剪辑点。", en: "Check comprehension first, then inspect captions, music and edits." },
      },
    ],
  },
  {
    slug: "knowledge-system-handbook",
    href: "/resources/knowledge-system-handbook",
    title: { zh: "个人知识库接续手册", en: "The Knowledge Handoff Handbook" },
    summary: {
      zh: "给一人维护的资料库补齐收件箱、来源记录和项目接续页。",
      en: "Add an inbox, source records and project handoffs to a one-person knowledge base.",
    },
    overview: {
      zh: "用虚构的《星图整理》项目演练如何归档资料、保留决定的出处，以及隔了一周后从哪里继续。封面的会员标签用于预览正式书架上的会员样式，演示章节可直接阅读。",
      en: "The fictional Star Atlas project demonstrates how to archive sources, preserve the basis of decisions and resume a week later. The membership label previews a member title on the shelf; all sample chapters are readable here.",
    },
    cover: { src: "/images/demo-editorial/archive-detail.webp", width: 960, height: 540 },
    category: "knowledge",
    tags: [{ zh: "来源追踪", en: "Source tracking" }, { zh: "任务接续", en: "Project handoff" }],
    date: "2026-11-03",
    vipOnly: true,
    chapters: [
      {
        id: "capture-inbox",
        title: { zh: "设置一个每周能清空的收件箱", en: "Set up an inbox you can clear weekly" },
        summary: { zh: "把待处理资料与长期笔记分开，每条保留来源和下一步。", en: "Separate incoming material from lasting notes and give each entry a source and a next action." },
      },
      {
        id: "source-records",
        title: { zh: "让关键结论有原始出处", en: "Connect a decision to its source" },
        summary: { zh: "把原话、个人判断和验证截图按职责保留。", en: "Keep excerpts, interpretations and validation evidence in distinct places." },
      },
      {
        id: "project-handoff",
        title: { zh: "写给一周后的接续页", en: "Write a handoff for next week" },
        summary: { zh: "用当前状态、已验证结论和下一步恢复项目上下文。", en: "Recover project context from the current state, checked conclusions and next action." },
      },
    ],
  },
];

export function resolveDemoBook(slug: string, segments: readonly string[] = []) {
  const book = demoBooks.find((item) => item.slug === slug);
  if (!book || segments.length > 1) return undefined;
  if (segments.length === 0) return { book, chapterIndex: -1, chapter: undefined };
  const chapterIndex = book.chapters.findIndex(({ id }) => id === segments[0]);
  if (chapterIndex === -1) return undefined;
  return { book, chapterIndex, chapter: book.chapters[chapterIndex] };
}

export function demoChapterDownload(slug: string, id: string, locale: string) {
  return `/demo-library/${slug}/${id}.${locale === "en" ? "en" : "zh"}.md` as const;
}

