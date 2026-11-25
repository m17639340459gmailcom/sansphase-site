import type { LocalizedText } from "./sansphase";

type MaterialId = "learning-journal" | "project-checklist" | "source-index";

type SansphaseMaterial = {
  id: MaterialId;
  title: LocalizedText;
  summary: LocalizedText;
  date: string;
  href: `/materials/${MaterialId}.md`;
  detailHref: `/learning/${MaterialId}`;
};

export const sansphaseMaterials = [
  {
    id: "learning-journal",
    title: { zh: "AI 影像学习记录模板", en: "AI Film Learning Journal" },
    summary: {
      zh: "以一次「静港」分镜练习为示例，记录学习目标、出处、试看观察和下次复核的问题。",
      en: "Use a Quiet Harbor storyboard exercise to record a goal, sources, review observations, and an open question.",
    },
    date: "2026-11-20",
    href: "/materials/learning-journal.md",
    detailHref: "/learning/learning-journal",
  },
  {
    id: "project-checklist",
    title: { zh: "个人作品交付检查表", en: "Portfolio Handoff Checklist" },
    summary: {
      zh: "按实际展示顺序整理作品介绍、画面素材、下载文件与验收记录，附星窗项目的示例。",
      en: "Prepare a project summary, presentation assets, downloads, and acceptance notes using the Star Window example.",
    },
    date: "2026-11-11",
    href: "/materials/project-checklist.md",
    detailHref: "/learning/project-checklist",
  },
  {
    id: "source-index",
    title: { zh: "知识库来源索引模板", en: "Knowledge-base Source Index" },
    summary: {
      zh: "用表格记录依据、所在章节、适用范围与是否核验，附四条潮汐档案样例。",
      en: "Track evidence, sections, scope, and verification, with four sample entries from Tide Archive.",
    },
    date: "2026-11-03",
    href: "/materials/source-index.md",
    detailHref: "/learning/source-index",
  },
] as const satisfies readonly SansphaseMaterial[];

export function materialDownloadHref(id: MaterialId, locale: string) {
  return `/materials/${id}${locale === "en" ? ".en" : ""}.md`;
}
