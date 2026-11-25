import type { LocalizedText } from "./sansphase";

type SoftwareSample = {
  id: string;
  date: string;
  title: LocalizedText;
  summary: LocalizedText;
  category: LocalizedText;
  platforms: LocalizedText;
  license: LocalizedText;
  usage: LocalizedText;
  setup: LocalizedText;
  limitations: LocalizedText;
};

// Fictional tools model the live catalogue's recommendation and walkthrough fields.
export const softwareSamples: readonly SoftwareSample[] = [
  {
    id: "lumen-cuts",
    date: "2026-11-17",
    title: { zh: "光栅切片", en: "Lumen Cuts" },
    summary: { zh: "把一批镜头按场景、时长和版本排成可对照的清单，适合短片选片和团队复盘。", en: "Arrange shots by scene, duration and version for short-film selects and team review." },
    category: { zh: "影像工具", en: "Video tools" },
    platforms: { zh: "Windows、macOS", en: "Windows and macOS" },
    license: { zh: "免费单机版", en: "Free desktop edition" },
    usage: { zh: "剪辑前先给每个镜头定编号，把不同生成版本排在一起，再记录采用与弃用的原因。下次复盘时，可以从镜头编号定位到源文件。", en: "Give each shot an ID before editing. Compare generated versions side by side and record the reason for each keep or reject decision. During review, use the shot IDs to find the source files." },
    setup: { zh: "新建项目后导入一个素材目录，选择按文件名前缀分组，再给每组标记待看、候选或定稿。", en: "Create a project, import a footage folder and group by filename prefix. Mark each group as unreviewed, shortlisted or final." },
    limitations: { zh: "适合小型项目选片。正式剪辑、色彩管理和声音混录仍在剪辑软件中完成。", en: "Best for selecting clips in a small project. Use an editor for the final cut, colour management and audio mixing." },
  },
  {
    id: "margin-index",
    date: "2026-11-11",
    title: { zh: "页边索引", en: "Margin Index" },
    summary: { zh: "给本地 Markdown 文档做目录，按标签和出处找回读过的笔记。", en: "Index local Markdown files and find your reading notes by tag or source." },
    category: { zh: "知识管理", en: "Knowledge management" },
    platforms: { zh: "Windows、macOS、Linux", en: "Windows, macOS and Linux" },
    license: { zh: "免费个人版", en: "Free personal edition" },
    usage: { zh: "把读书摘录、项目备忘和教程分成几类，再给常查的条目标记出处。搜索时可以先按标签缩小范围。", en: "Group book excerpts, project notes and tutorials, and record a source for each frequently used entry. Narrow searches by tag." },
    setup: { zh: "选择本地笔记目录，预览索引范围，再试搜一个熟悉的词，检查旧文档能否被找到。", en: "Choose a notes folder, inspect its indexing scope and search for a familiar term to check that older notes appear." },
    limitations: { zh: "只索引选中的 Markdown 目录。扫描件和图片文字需要提前转成文本。", en: "Indexes selected Markdown folders. Convert scanned pages and text in images to plain text first." },
  },
  {
    id: "batch-shelf",
    date: "2026-11-06",
    title: { zh: "工作台分拣器", en: "Batch Shelf" },
    summary: { zh: "用同一套命名规范整理一批导出文件，执行前先预览会发生哪些变化。", en: "Organize a batch of exports with one naming rule and preview every change before applying it." },
    category: { zh: "效率工具", en: "Productivity" },
    platforms: { zh: "Windows", en: "Windows" },
    license: { zh: "免费单机版", en: "Free desktop edition" },
    usage: { zh: "给图像、字幕和预览视频统一加上项目名与版本号，交付后凭文件名也能找到素材对应的版本。", en: "Give images, captions and preview videos a shared project name and version number so recipients can match related exports." },
    setup: { zh: "选中导出副本并按扩展名分组，预览新文件名列表，解决重名后再确认。", en: "Select a copy of the exports, group by file extension and preview the new names. Resolve duplicates before confirming." },
    limitations: { zh: "适合整理已导出的文件。剪辑工程正在引用的素材，需要在工程里同步更新路径。", en: "Best for finished exports. Files actively linked by an editing project need their paths updated in that project too." },
  },
];

export function findSoftwareSample(id: string) {
  return softwareSamples.find((item) => item.id === id);
}
