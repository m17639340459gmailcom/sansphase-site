// Published content lives here. Empty collections are intentional until real
// projects and community content are available; do not invent portfolio history.
export const works = [];

// Navigation and section headings share this source of truth.
export const siteSections = [
  {
    id: "notes",
    zh: "博客",
    en: "Blog",
    description: "记录 AI 学习、创作过程，以及無相网站的建设。",
    descriptionEn:
      "Notes on AI learning, creative work, and website development.",
  },
  {
    id: "works",
    zh: "作品",
    en: "Work",
    description: "作品与项目记录，整理后会陆续发布。",
    descriptionEn:
      "Projects and the process behind them, published as they are prepared.",
  },
  {
    id: "resources",
    zh: "资料",
    en: "Learning",
    description: "学习资料与可填写的模板，先了解用途，再选择适合自己的内容。",
    descriptionEn:
      "Learning materials and editable templates. Explore their purpose and choose what you need.",
  },
  {
    id: "software",
    zh: "软件推荐",
    en: "Software",
    description: "整理软件的用途、上手方法和适用场景。",
    descriptionEn:
      "Software notes covering purpose, getting started, and suitable use cases.",
  },
  {
    id: "community",
    zh: "社区交流",
    en: "Community",
    description: "交流 AI 学习、作品制作和使用中的问题。",
    descriptionEn:
      "Discuss learning AI, making projects, and questions along the way.",
  },
  {
    id: "resource-center",
    zh: "资源中心",
    en: "Resource center",
    description: "集中查找本站的下载文件与内容入口。",
    descriptionEn:
      "Find downloadable files and navigate the site’s content in one place.",
  },
];

export const notes = [
  {
    id: "building-sansphase",
    title: "無相网站建设记录",
    en: "Website development journal",
    category: "建站记录",
    categoryEn: "Site journal",
    summary: "本站的内容规划与建设进展。",
    summaryEn: "Content planning and development progress for this website.",
    sections: [
      [
        "网站内容",
        "本站用于发布無相的作品、AI 学习记录与资料，并提供社区交流和项目合作入口。",
      ],
      [
        "当前状态",
        "目前正在制作本地原型，调整首页视觉和各栏目的浏览体验。作品尚未发布，资料页提供建站过程中整理的空白模板。社区可以体验发帖、回复和签到，但没有连接服务器，刷新页面后演示内容会清空。",
      ],
      [
        "后续内容",
        "真实作品和学习资料会逐步整理后发布。注册登录、论坛数据保存、赞助及正式联系方式也需要分别完成后接入；当前页面中的演示操作不代表这些服务已经上线。",
      ],
    ],
    sectionsEn: [
      [
        "Site content",
        "This website presents work, AI learning notes, and resources by 無相, with sections for community discussions and project collaborations.",
      ],
      [
        "Current status",
        "This is a local prototype. The homepage visuals and content pages are being developed. Projects are not published yet; the resource page offers blank templates made during this site’s development. Posting, replies, and check-ins are temporary demos without a server and clear on refresh.",
      ],
      [
        "What comes next",
        "Real projects and learning materials will be added after they are prepared. Accounts, persistent discussions, support options, and contact details each need to be completed before launch. The current demos do not mean these services are live.",
      ],
    ],
  },
];

// These blank Markdown templates were created for this site. They are not
// previous projects, courses, or a list of endorsed third-party resources.
export const resources = [
  {
    id: "learning",
    title: "AI 学习记录 · 本站模板",
    en: "AI learning journal · Site template",
    category: "学习记录",
    categoryEn: "Learning",
    summary: "空白记录表，包含学习目标、资料来源、实践结果和下一步。",
    summaryEn:
      "A blank journal for goals, sources, experiments, and next steps.",
    file: "learning-journal.md",
    format: "MARKDOWN",
    symbol: "document",
  },
  {
    id: "project",
    title: "作品整理清单 · 本站模板",
    en: "Project checklist · Site template",
    category: "作品整理",
    categoryEn: "Projects",
    summary: "准备作品介绍时使用，逐项整理背景、本人贡献、展示素材和版本。",
    summaryEn:
      "Prepare project context, your contribution, presentation assets, and version notes.",
    file: "project-checklist.md",
    format: "MARKDOWN",
    symbol: "grid",
  },
  {
    id: "sources",
    title: "资料来源索引 · 本站模板",
    en: "Source index · Site template",
    category: "资料管理",
    categoryEn: "Sources",
    summary: "用于填写资料链接、适用场景和阅读日期的空表，不含推荐名单。",
    summaryEn:
      "A blank table for links, use cases, and reading dates. No recommendations are prefilled.",
    file: "source-index.md",
    format: "MARKDOWN",
    symbol: "link",
  },
];

export const initialPosts = [];
