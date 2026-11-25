import type { Project } from "./projects";
import { articles, sansphaseLinks } from "./sansphase";

const [archiveNote, filmNote, searchNote, storyboardNote] = articles;

function editorialCover(note: (typeof articles)[number]): NonNullable<Project["cover"]> {
  return { src: note.cover, ...note.coverSize, alt: note.title };
}

export const sansphaseWorks: (Project & { date: string })[] = [
  {
    slug: "sansphase-site",
    date: "2026-11-20",
    index: "01",
    title: { zh: "星窗 · 创作档案站", en: "Star Window" },
    tagline: { zh: "把零散的项目、文章和资料汇入一处可浏览的创作档案。", en: "A browsable archive that brings projects, articles, and reference material together." },
    description: {
      zh: "星窗是一个虚构的个人创作站案例，涵盖作品目录、实践博客、资料下载和社区入口。演示用两条浏览路径呈现同一个项目：读者可以先看成品，再进入文章，也可以先从一篇记录找到相关项目。",
      en: "Star Window is a fictional personal site with a project directory, a practice journal, material downloads, and a community entrance. Visitors can start with a finished project and read its notes, or discover the work from an article first.",
    },
    problem: { zh: "旧目录把文章、作品和资料混在一起，同一主题的条目散在不同位置，读者经常在找到入口前退出。", en: "The old directory mixed articles, projects, and downloads. Related entries were split across collections and often hard to find." },
    approach: { zh: "按读者要完成的动作拆分目录，为每个作品补齐简介、制作过程和相关资料。两种浏览路径各安排一次移动端试走，再对照键盘访问。", en: "Organize the directory around reader tasks and give each project a summary, process notes, and related material. Run both journeys on mobile and repeat them with the keyboard." },
    impact: { zh: "演示记录覆盖作品阅读、资料预览和章节浏览。下一版计划用首次访问者的反馈判断目录名称是否直观。", en: "The sample records cover projects, material previews, and chapter reading. A future round with first-time visitors would test whether the directory labels are clear." },
    highlights: [
      { zh: "按作品、博客和资料拆分内容入口", en: "Separate routes for projects, journal entries, and materials" },
      { zh: "由项目记录前往对应学习资料", en: "Follow project records to related learning material" },
      { zh: "按桌面和手机分别复核浏览路径", en: "Review both journeys on desktop and mobile" },
    ],
    role: { zh: "信息架构与界面设计", en: "Information architecture and interface design" },
    kind: { zh: "个人站原型", en: "Personal-site prototype" },
    stage: { label: { zh: "演示原型", en: "Demo prototype" }, tone: "preview" },
    year: "2026",
    category: "fullstack",
    stack: ["Next.js", "TypeScript", "Markdown"],
    links: { demo: sansphaseLinks.learning },
    cover: { src: "/images/demo-editorial/star-window.webp", width: 960, height: 540, alt: { zh: "星窗创作档案的虚构界面示意", en: "Fictional interface for the Star Window creative archive" } },
    featured: true,
    hue: 231,
    motif: "grid",
    metrics: [
      { value: "3", label: { zh: "演示目录", en: "Sample collections" } },
      { value: "2", label: { zh: "主要阅读路径", en: "Primary reading paths" } },
    ],
  },
  {
    slug: "ai-short-video-workflow",
    date: "2026-11-14",
    index: "02",
    title: { zh: "静港 · AI 短片工作流", en: "Quiet Harbor" },
    tagline: { zh: "用三段演示片段梳理脚本、镜头和试看之间的交接。", en: "Three sample clips map the handoff from script and shots to a timed preview." },
    description: { zh: "以一段虚构港口短片为题，整理文字、旁白、分镜、字幕和试看记录。重点是每个阶段交什么和怎么确认可读，最后留下能继续修改的资料。", en: "A fictional harbor film brings the script, narration, storyboards, subtitles, and review notes into one production record. Each step specifies its handoff and what makes the result readable." },
    problem: { zh: "一段旁白打算同时介绍船灯和航向，镜头切换太快，字幕停留时背景已换，试看者很难把文字和画面联系起来。", en: "A line of narration introduced a navigation light and the route at once. The shot changed before the caption cleared, making it hard to connect the words to the image." },
    approach: { zh: "把一句旁白拆成两个信息点，并给对象留一段稳定画面。先只试看最密集的镜头，再核对字幕从上一句退场到下一句入场的间隔。", en: "Separate the narration into two ideas and keep the relevant subject on screen long enough to read. Review the densest shot first, then verify the transitions from one caption to the next." },
    impact: { zh: "演示流程留下三张分镜、一份接力表和两次试看的问题记录，足以从问题发生的镜头继续修改。", en: "The sample workflow leaves three storyboard panels, a handoff sheet, and two review logs, enough to resume work at the affected shot." },
    highlights: [
      { zh: "文案、旁白和字幕按同一个样例版本核对", en: "Check the script, narration, and captions against the same demo revision" },
      { zh: "用分镜卡标记拍摄重点和对象接续", en: "Use storyboard cards to mark focal points and continuity" },
      { zh: "先复看片段，再整理试看记录", en: "Review the sample clips and organize the findings" },
    ],
    role: { zh: "分镜设计与制作复盘", en: "Storyboard design and production review" },
    kind: { zh: "影像创作", en: "Film production" },
    stage: { label: { zh: "演示案例", en: "Demo case study" }, tone: "preview" },
    year: "2026",
    category: "ai",
    stack: ["Script", "Storyboard", "Motion"],
    links: {},
    article: { slug: storyboardNote.slug, label: { zh: "读片段试看记录", en: "Read the clip review" } },
    cover: editorialCover(storyboardNote),
    gallery: [editorialCover(filmNote)],
    hue: 245,
    motif: "wave",
    metrics: [
      { value: "3", label: { zh: "演示分镜", en: "Demo storyboard panels" } },
      { value: "2", label: { zh: "模拟试看", en: "Sample review passes" } },
    ],
  },
  {
    slug: "personal-knowledge-base",
    date: "2026-11-03",
    index: "03",
    title: { zh: "潮汐档案 · 个人知识库", en: "Tide Archive" },
    tagline: { zh: "将任务背景、来源和决定分别保存，让下一次接手时找得到依据。", en: "Keep briefs, sources, and decisions distinct so the next person can trace the reasoning." },
    description: { zh: "潮汐档案是一个虚构的小型知识库，用来整理拍摄笔记、制作决定和查证记录。演示从一段旧工作交接开始，沿来源卡追到具体记录。", en: "Tide Archive is a fictional working knowledge base for filming notes, production decisions, and verification records. Its demo starts with a handoff and follows a source card to the relevant note." },
    problem: { zh: "工作记录和最终决定混在长文里，搜索能找到一句话，却很难判断它是猜想、承诺还是被替换的旧决定。", en: "Working notes and final decisions share long documents. A search result can find a sentence without showing whether it was a guess, a commitment, or a superseded decision." },
    approach: { zh: "用 Markdown 给来源卡、任务目录和复盘留出固定字段。保存原句、所在小节和适用范围，检索结果回到对应位置核对。", en: "Give source cards, task indexes, and reviews consistent fields in Markdown. Save the original wording, section, and scope so a search result can be verified in context." },
    impact: { zh: "演示中可以从四份样例找到素材选择的原因和暂停事项。描述模糊的问题仍需要先补资料。", en: "Four sample records show how to recover the reason behind an asset choice and find open tasks. Questions with vague descriptions still need better source material." },
    highlights: [
      { zh: "保留从关键词到原文的核验路径", en: "Keep a traceable route from keyword to original source" },
      { zh: "分别保存阶段性的观察与长期决定", en: "Keep temporary observations and standing decisions apart" },
      { zh: "记录没有找到结果的查询与补充方向", en: "Record unsuccessful queries and what to add" },
    ],
    role: { zh: "资料整理与检索试验", en: "Research organization and search experiments" },
    kind: { zh: "个人工具", en: "Personal tool" },
    stage: { label: { zh: "演示案例", en: "Demo case study" }, tone: "preview" },
    year: "2026",
    category: "data",
    stack: ["Markdown", "Obsidian", "SQLite"],
    links: {},
    article: { slug: archiveNote.slug, label: { zh: "读档案交接记录", en: "Read the archive handoff" } },
    cover: editorialCover(archiveNote),
    gallery: [editorialCover(searchNote)],
    hue: 202,
    motif: "stack",
    metrics: [
      { value: "4", label: { zh: "样例记录", en: "Sample records" } },
      { value: "2", label: { zh: "检索方式", en: "Search methods" } },
    ],
  },
];
