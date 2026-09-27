// Read-only demonstration content. Imported by the opt-in preview, never the site build.
import { statSync } from "node:fs";
import { escapeHTML } from "../../src/core.mjs";

const covers = [
  "eso-orion.jpg",
  "eso-m78.jpg",
  "eso-milky-way.jpg",
  "eso-triangulum.jpg",
];
const files = [
  "project-checklist.md",
  "learning-journal.md",
  "source-index.md",
];
const download = (index) => {
  const file = files[index % files.length];
  return {
    file,
    fileSize: statSync(new URL(`../../public/assets/${file}`, import.meta.url))
      .size,
    downloadUrl: `./assets/${file}`,
  };
};
const works = [
  [
    "星轨文件整理",
    "桌面工具",
    "按文件类型和日期整理文件，展示批量操作工具的介绍方式。",
  ],
  [
    "微光截图",
    "效率工具",
    "区域截图、标注与导出，展示以图片和操作说明为主的软件作品。",
  ],
  ["轨道笔记", "桌面工具", "记录灵感与待办事项，展示日常使用工具的功能说明。"],
  [
    "镜像校验",
    "开发工具",
    "核对文件校验值，展示轻量开发工具的版本与使用步骤。",
  ],
  ["素材标签管理", "创作工具", "通过标签管理图片与文档，展示素材管理类软件。"],
  [
    "批量重命名工具：中英文长标题与文件规则预览",
    "效率工具",
    "展示较长的软件名称、规则说明和文件名示例。",
  ],
  [
    "专注计时",
    "效率工具",
    "记录专注时段与休息时间，展示一个没有封面的作品条目。",
  ],
  ["代码片段收藏", "开发工具", "收藏常用代码片段，展示有代码块的详细介绍。"],
  ["图片尺寸检查", "创作工具", "检查图片尺寸，展示用于网站素材准备的小工具。"],
  [
    "离线资料索引",
    "桌面工具",
    "集中查看本地资料目录，展示离线工具的使用场景。",
  ],
  ["日志阅读器", "开发工具", "按关键词筛选文本日志，展示面向开发者的工具。"],
  ["配色记录簿", "创作工具", "保存颜色搭配与备注，展示创作辅助工具。"],
  ["快捷启动面板", "桌面工具", "集合常用程序入口，用于验证第二页作品的显示。"],
  ["版本记录助手", "开发工具", "整理更新记录，用于验证分页和分类组合。"],
];
const resources = [
  [
    "软件发布检查清单",
    "作品整理",
    "整理封面、版本、运行环境和下载说明的准备事项。",
  ],
  ["学习记录模板", "学习记录", "记录学习目标、实践结果和下一步计划。"],
  ["资料来源索引", "资料管理", "登记资料链接、用途和阅读日期，方便再次查找。"],
  ["安装说明写作示例", "作品整理", "演示准备环境、安装步骤与常见问题的排版。"],
  [
    "无封面文档条目",
    "学习记录",
    "演示只用标题、摘要和文件信息展示资料的效果。",
  ],
  [
    "仅在线阅读的资料",
    "资料管理",
    "演示没有附件时的详情页面，不提供虚假的下载入口。",
  ],
];
const software = [
  [
    "文本编辑器介绍",
    "开发工具",
    "模拟用途、上手方式和适用场景的介绍，不代表真实软件推荐。",
  ],
  [
    "图像处理工具介绍",
    "创作工具",
    "模拟有封面的第三方软件介绍及详细使用说明。",
  ],
  [
    "文件压缩工具介绍",
    "桌面工具",
    "模拟轻量工具推荐，便于比较网格与列表的信息密度。",
  ],
  ["Markdown 写作工具介绍", "写作工具", "模拟写作类工具的功能介绍与使用场景。"],
  ["截图标注工具介绍", "效率工具", "模拟没有封面的推荐条目，验证文字排版。"],
  [
    "本地文件搜索工具介绍",
    "桌面工具",
    "模拟较长摘要：介绍适用人群、使用方式和注意事项，检查卡片摘要截断后是否仍易于浏览。",
  ],
];

function entries(kind, rows) {
  return rows.map(([name, category, summary], index) => {
    const title = `${name}（模拟）`;
    const noCover = index % 5 === 4 || index === 6;
    const heading =
      kind === "works"
        ? "软件简介"
        : kind === "resources"
          ? "资料用途"
          : "工具用途";
    return {
      id: `demo-${kind}-${index + 1}`,
      title,
      category,
      summary,
      date: `2026-09-${String(15 - index).padStart(2, "0")}`,
      tags: [category, "模拟内容", ...(kind === "works" ? ["Windows"] : [])],
      coverSrc: noCover
        ? ""
        : `./assets/materials/${covers[index % covers.length]}`,
      bodyHTML: `<p><strong>模拟预览：</strong>此条目用于检查页面结构，不是真实作品或推荐。天文照片仅作为已有封面素材示意。</p>
        <h2>${heading}</h2><p>${escapeHTML(summary)}</p>
        ${kind === "works" ? "<h2>版本与运行环境</h2><p>模拟版本 1.2.0 · Windows。此处展示信息格式，不代表已有可运行的软件。</p>" : ""}
        <h2>内容示例</h2><ul><li>先阅读简介，了解用途。</li><li>查看具体步骤与说明。</li><li>有附件时可在页面底部下载。</li></ul>
        <h2>使用步骤</h2><p>第一步：查看说明。第二步：准备资料。第三步：记录结果。</p>
        ${kind === 'works' ? '<h2>更新记录</h2><p>模拟版本 1.2.0：补充使用说明，调整文件列表展示。此更新记录仅用于排版示意。</p>' : ''}
        ${index === 7 ? '<pre><code>console.log("模拟代码展示");</code></pre>' : ""}
        <h2>附件说明</h2><p>${kind === "software" || index === rows.length - 1 ? "此模拟条目不提供安装包或外部软件链接。" : "下载的是本站已有的 Markdown 示例文档，不是安装程序。可用来检查下载入口与文件大小。"}</p>`,
      ...(kind !== "software" && index !== rows.length - 1
        ? download(index)
        : {}),
    };
  });
}
export function makeCatalogDemo() {
  return {
    works: entries("works", works),
    resources: entries("resources", resources),
    software: entries("software", software),
    'resource-center': entries('resource-center', [
      ['创作资源索引','创作素材','集中展示素材来源、使用说明与授权备注。'],
      ['开发文档导航','开发参考','演示按用途整理文档与参考资料的资源中心。'],
      ['发布流程模板','实用模板','演示可下载的清单与模板，附件为本站现有示例文档。'],
      ['在线资源说明','在线参考','演示没有下载附件的资源介绍。'],
    ]),
  };
}
