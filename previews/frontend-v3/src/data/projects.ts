import type { Localized } from "./types";

/** Project case studies backed by Dingxin Tao's actual repositories and deployments. */

export type ProjectCategory = "ai" | "fullstack" | "data" | "fde";

export type ProjectImage = {
  src: string;
  alt: Localized;
  width: number;
  height: number;
  caption?: Localized;
};

export type Project = {
  slug: string;
  index: string;
  title: Localized;
  tagline: Localized;
  description: Localized;
  problem: Localized;
  approach: Localized;
  impact: Localized;
  learning?: Localized;
  highlights: Localized[];
  role: Localized;
  /** Display labels summarize the case study, not a live service-health check. */
  kind: Localized;
  stage: { label: Localized; tone: "ready" | "preview" | "paused" };
  year: string;
  category: ProjectCategory;
  stack: string[];
  links: { github?: string; githubPrivate?: boolean; demo?: string; download?: string };
  article?: { slug: string; label: Localized };
  cover?: ProjectImage;
  gallery?: ProjectImage[];
  galleryNote?: Localized;
  /** Optional maintenance notice shown above the case study sections. */
  notice?: Localized;
  featured?: boolean;
  /** Hue (0-360) used to tint the generative cover artwork. */
  hue: number;
  /** Visual motif for the generative cover. */
  motif: "orbit" | "grid" | "wave" | "stack" | "graph" | "prism";
  metrics: { value: string; label: Localized }[];
};

export type ProjectListItem = Pick<Project,
  "slug" | "index" | "title" | "tagline" | "year" | "kind" | "stage" | "stack" |
  "cover" | "gallery" | "hue" | "motif" | "highlights"
> & { category: string };

export const projects: Project[] = [
  {
    slug: "multimix",
    kind: { en: "Product development", zh: "产品开发" },
    stage: { label: { en: "Frontend deployed", zh: "前端已部署" }, tone: "ready" },
    index: "01",
    title: { en: "MultiMix", zh: "MultiMix" },
    tagline: {
      en: "Create short videos through conversation, with scripts and source assets in one workspace.",
      zh: "通过对话创作短视频，集中管理文案与素材。",
    },
    description: {
      en: "MultiMix is a workspace for short video creation through conversation. Users can describe a creative brief, organize references, and save generated scripts, images, and videos in separate libraries for revision and reuse.",
      zh: "MultiMix 是通过对话创作短视频的工作台。用户可以提出创作需求、整理参考资料，将生成的文案、图片和视频分类保存，便于后续修改与复用。",
    },
    problem: {
      en: "When briefs, references, and revision history are scattered across tools, resuming a project requires rebuilding its context. MultiMix keeps this context and the generated assets in one workspace.",
      zh: "创作需求、参考资料和修改记录分散在不同工具中，后续修改需要重新整理上下文。MultiMix 将这些内容与生成产物集中保存在同一工作区。",
    },
    approach: {
      en: "The Next.js interface uses the same conversation for creating content and organizing references. FastAPI handles assets and video tasks. PostgreSQL stores the data; Redis and RQ handle queued work. Generated files can be stored locally, in S3, or in Supabase.",
      zh: "界面使用 Next.js，内容生成和资料整理共用一个对话入口。FastAPI 后端处理资产和视频任务，PostgreSQL 存储数据，Redis 和 RQ 处理排队执行的任务。生成的文件可以保存在本地、S3 或 Supabase。",
    },
    impact: {
      en: "The deployed frontend includes scripts, images, and video projects. The backend API, task workers, and scheduler can run separately. Offline tests cover the main product flows and security constraints.",
      zh: "前端已部署，包含文案、图片和视频项目的操作流程。后端 API、任务 Worker 和调度器可以分别运行，离线测试覆盖主要产品流程和安全约束。",
    },
    highlights: [
      {
        en: "Create content and organize references in the same conversation",
        zh: "在同一个对话里创作内容、整理参考资料",
      },
      {
        en: "Separate libraries for source assets, scripts, images, and videos",
        zh: "来源资产、文案、图片和视频分库管理",
      },
      {
        en: "Run video tasks through a queue, with separate API, worker, and scheduler processes",
        zh: "视频任务排队执行，API、Worker 与调度器分别运行",
      },
      {
        en: "Check source compliance when searching public media and save the material used in a project",
        zh: "搜索公共素材时检查来源合规性，并保存项目采用的素材",
      },
    ],
    role: { en: "Product and full-stack development", zh: "产品与全栈开发" },
    year: "2026",
    category: "ai",
    stack: [
      "Next.js",
      "TypeScript",
      "FastAPI",
      "Python",
      "PostgreSQL",
      "Redis",
      "RQ",
      "Supabase",
      "Remotion",
      "Railway",
    ],
    links: {
      github: "https://github.com/DingxinTao0417/MultiMix-Frontend",
      demo: "https://multimix-frontend.vercel.app/",
    },
    cover: {
      src: "/projects/multimix.png",
      width: 1920,
      height: 945,
      alt: {
        en: "MultiMix new video project workspace",
        zh: "MultiMix 新建视频项目界面",
      },
    },
    gallery: [
      {
        src: "/projects/multimix-conversation.png",
        width: 1920,
        height: 911,
        alt: {
          en: "MultiMix conversation workspace with generation progress and a failed generation status",
          zh: "MultiMix 对话创作界面，显示生成进度与生成失败状态",
        },
        caption: {
          en: "Conversation and generation progress",
          zh: "对话创作与生成进度",
        },
      },
      {
        src: "/projects/multimix-image-library.png",
        width: 1920,
        height: 911,
        alt: {
          en: "MultiMix image library with image cards and category filters",
          zh: "MultiMix 图片库界面，展示图片卡片与分类筛选",
        },
        caption: { en: "Image library", zh: "图片库" },
      },
      {
        src: "/projects/multimix-script-library.png",
        width: 1920,
        height: 911,
        alt: {
          en: "MultiMix script library with saved content plans and category filters",
          zh: "MultiMix 文案库界面，展示已保存的内容方案与分类筛选",
        },
        caption: { en: "Script library", zh: "文案库" },
      },
    ],
    featured: true,
    hue: 22,
    motif: "graph",
    metrics: [
      { value: "Web", label: { en: "conversation workspace", zh: "对话工作台" } },
      { value: "RQ", label: { en: "video task queue", zh: "视频任务队列" } },
    ],
  },
  {
    slug: "opc-workspace",
    kind: { en: "Desktop development", zh: "桌面应用开发" },
    stage: { label: { en: "Windows test build", zh: "Windows 测试版" }, tone: "preview" },
    index: "02",
    title: { en: "opc-workspace", zh: "opc-workspace" },
    tagline: {
      en: "An offline desktop workspace for one-person businesses, with local data storage.",
      zh: "面向一人公司的离线桌面工作台，数据保存在本地。",
    },
    description: {
      en: "opc-workspace is a desktop application for tasks, projects, client records, an inbox, and focus sessions. It works offline. Core business data is stored in SQLite and controlled file directories on the user's computer.",
      zh: "opc-workspace 是包含任务、项目、客户记录、收件箱和专注计时的桌面应用。核心流程支持离线运行，业务数据保存在用户电脑上的 SQLite 数据库和受控文件目录中。",
    },
    problem: {
      en: "Independent developers, freelancers, creators, and consultants may rely on separate tools for tasks, project records, clients, and time tracking. opc-workspace combines these modules in one application with shared local data.",
      zh: "独立开发者、自由职业者、内容创作者和顾问的日常工作，可能分散在任务工具、项目表格、客户记录和计时器中。opc-workspace 将这些模块集中在一个应用中，共用本地数据。",
    },
    approach: {
      en: "The React and TypeScript interface calls a Go sidecar through a versioned local API. Tauri handles the desktop shell and starts and stops the sidecar. Data handling includes SQLite migrations, controlled file storage, and backup and restore. Runtime dependencies are included in the installer.",
      zh: "React 与 TypeScript 界面通过版本化的本地 API 调用 Go Sidecar，Tauri 负责桌面外壳和 Sidecar 的启停。数据部分包含 SQLite 迁移、受控文件存储，以及备份和恢复。运行依赖随安装包一起提供。",
    },
    impact: {
      en: "Version 0.1.1 can produce unsigned Windows test installers in EXE and MSI formats. It supports task acceptance and rework, project and client records, focus tracking, search across modules, and data backup. These core workflows can run offline.",
      zh: "v0.1.1 可以生成 EXE 和 MSI 格式的 Windows 测试安装包，尚未签名。这个版本支持任务验收与返工、项目和客户记录、专注计时、跨模块搜索，以及数据备份。这些核心流程可以离线运行。",
    },
    highlights: [
      {
        en: "Tasks have six states and support subtasks, deliverables, acceptance, and rework",
        zh: "任务分为六种状态，支持子任务、提交产出、验收和返工",
      },
      {
        en: "Versioned SQLite migrations, backup and restore, and controlled file storage",
        zh: "SQLite 迁移有版本记录，数据支持备份恢复，文件保存在受控目录",
      },
      {
        en: "Tauri desktop package with an embedded Go sidecar",
        zh: "Tauri 桌面安装包内置 Go Sidecar",
      },
      {
        en: "Search tasks, projects, clients, and inbox items locally or open them from the command palette",
        zh: "通过本地搜索和命令面板查找任务、项目、客户与收件箱事项",
      },
      {
        en: "Workbench and agent modes in one shell; agent mode adds a right-side workspace with review, terminal, browser, and file tabs",
        zh: "工作台与智能体两种模式共用一个外壳；智能体模式右侧提供变更审查、终端、浏览器和文件等标签",
      },
      {
        en: "Tasks, projects, and client records can be handed to the agent, and its suggestions wait for the user's confirmation",
        zh: "任务、项目和客户记录都可以交给智能体处理，智能体的建议需要用户确认后才会生效",
      },
    ],
    role: { en: "Product design and full-stack development", zh: "产品设计与全栈开发" },
    year: "2026",
    category: "fullstack",
    stack: ["React", "TypeScript", "Go", "SQLite", "Tauri", "Rust", "Vite", "Tailwind CSS"],
    links: {
      github: "https://github.com/DingxinTao0417/opc-workspace",
      download: "https://github.com/DingxinTao0417/opc-workspace/releases/tag/opc-workspace-v0.1.1-20260929",
    },
    cover: {
      src: "/projects/opc-workspace-demo-today.png",
      width: 1920,
      height: 911,
      alt: {
        en: "opc-workspace Today view with inbox counts, client follow-ups, overdue and scheduled tasks, and a right rail with focus timer, milestones, revenue, and client activity",
        zh: "opc-workspace 今日工作台，包含收件箱统计、客户回访、逾期与今日任务，以及右侧的专注计时、项目节点、本月收入和客户动态",
      },
      caption: { en: "Today workspace (demo data)", zh: "今日工作台（演示数据）" },
    },
    gallery: [
      {
        src: "/projects/opc-workspace-demo-tasks.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace task list grouped by status, with project, priority, and estimated time on each row",
          zh: "opc-workspace 任务列表，按状态分组并显示所属项目、优先级和预计时长",
        },
        caption: { en: "Tasks by status", zh: "按状态分组的任务" },
      },
      {
        src: "/projects/opc-workspace-demo-review.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace task detail showing a submitted deliverable with accept and request-rework actions",
          zh: "opc-workspace 任务详情，显示已提交的产出以及“接受并完成”“要求返工”操作",
        },
        caption: { en: "Deliverable acceptance", zh: "产出验收与返工" },
      },
      {
        src: "/projects/opc-workspace-demo-project.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace project detail with progress, contract amount, project tasks, and deliverables",
          zh: "opc-workspace 项目详情，包含完成进度、合同金额、项目任务和项目产出",
        },
        caption: { en: "Project detail", zh: "项目详情" },
      },
      {
        src: "/projects/opc-workspace-demo-client.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace client detail with linked projects, local activity notes, and scheduled follow-ups",
          zh: "opc-workspace 客户详情，包含关联项目、本地活动记录和客户回访计划",
        },
        caption: { en: "Client records and follow-ups", zh: "客户记录与回访" },
      },
      {
        src: "/projects/opc-workspace-demo-income.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace income and expense list with monthly confirmed totals and net cash flow",
          zh: "opc-workspace 收入与支出列表，包含本月已确认金额和净现金流",
        },
        caption: { en: "Income and expenses", zh: "收入与支出" },
      },
      {
        src: "/projects/opc-workspace-demo-search.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace command palette searching tasks, projects, milestones, and inbox items at once",
          zh: "opc-workspace 命令面板，同时搜索任务、项目、里程碑和收件箱事项",
        },
        caption: { en: "Command palette search", zh: "命令面板跨模块搜索" },
      },
      {
        src: "/projects/opc-workspace-agent-workspace.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace agent mode with a conversation area and a right-side workspace for review, terminal, browser, files, side chat, and agent runs",
          zh: "opc-workspace 智能体模式，左侧为对话区，右侧工作区提供变更审查、终端、浏览器、文件、侧边聊天和 Agent 执行",
        },
        caption: { en: "Agent mode workspace", zh: "智能体模式的右侧工作区" },
      },
      {
        src: "/projects/opc-workspace-ai-assistant.png",
        width: 1920,
        height: 911,
        alt: {
          en: "opc-workspace AI assistant proposing a website development task from a conversation",
          zh: "opc-workspace AI 助手根据对话建议创建网站开发任务",
        },
        caption: { en: "AI task assistant", zh: "AI 任务助手" },
      },
    ],
    featured: true,
    hue: 36,
    motif: "stack",
    metrics: [
      { value: "Windows", label: { en: "test installers", zh: "测试安装包" } },
      { value: "SQLite", label: { en: "local data storage", zh: "本地数据存储" } },
    ],
  },
  {
    slug: "omnigate",
    kind: { en: "Open-source customization", zh: "开源二次开发" },
    stage: { label: { en: "Deployed", zh: "已部署" }, tone: "ready" },
    index: "03",
    title: { en: "Omnigate", zh: "Omnigate" },
    tagline: {
      en: "An AI API gateway based on new-api, with custom branding and a single-server deployment setup.",
      zh: "基于 new-api 二次开发的 AI API 网关，包含品牌定制与单机部署配置。",
    },
    description: {
      en: "Omnigate is based on the open-source new-api project. Protocol adapters, usage tracking, billing, and user management come from upstream. The custom work covers branding, review of default and security settings, and deployment and operations for a single server.",
      zh: "Omnigate 基于开源项目 new-api，多协议适配、用量统计、计费和用户管理来自上游。定制工作包括品牌调整、默认配置与安全设置整理，以及单机部署和运维方案。",
    },
    problem: {
      en: "Self-hosting the gateway means handling HTTPS, streamed responses through the proxy, the database, and the cache. Secret configuration and backups also need a defined place in the deployment process so it can be repeated when the service is updated.",
      zh: "在服务器上部署网关，需要处理 HTTPS、代理流式响应、数据库和缓存。密钥配置与数据备份也需要纳入部署流程，便于在服务更新时重复执行。",
    },
    approach: {
      en: "Docker Compose builds the application from source and runs it alongside Caddy, PostgreSQL, and Redis. Caddy handles HTTPS with response buffering turned off for streaming. The repository includes environment variable templates, a database backup script with retention settings, and deployment notes.",
      zh: "Docker Compose 从源码构建应用，并运行 Caddy、PostgreSQL 和 Redis。Caddy 处理 HTTPS，为流式输出关闭响应缓冲。仓库包含环境变量模板、支持按保留期清理旧备份的数据库备份脚本，以及部署记录。",
    },
    impact: {
      en: "The service is deployed at omnigate.cc. OpenAI-compatible clients can use its base URL and an issued token to call different models. The repository records how the service is configured, backed up, and updated.",
      zh: "服务部署在 omnigate.cc。兼容 OpenAI 格式的客户端可以配置这个地址和系统签发的令牌，调用不同模型。服务的配置、备份和更新方式都记录在仓库里。",
    },
    learning: {
      en: "This project provided practice in reading an existing Go and TypeScript codebase and limiting custom changes to a maintainable scope. Deployment work covered proxy buffering of streamed responses, HTTPS, PostgreSQL, Redis, and backups during upgrades. It also required license review and documentation of upstream features and custom changes.",
      zh: "通过阅读现有 Go 和 TypeScript 代码确定修改范围，并将定制控制在可维护的规模。部署实践加深了对代理流式缓冲、HTTPS 配置、PostgreSQL 与 Redis 配合，以及升级备份流程的理解。同时检查许可证，在文档中区分上游功能与定制修改。",
    },
    highlights: [
      {
        en: "Build from source and deploy with Caddy, PostgreSQL, and Redis using Docker Compose",
        zh: "用 Docker Compose 从源码构建应用，配套 Caddy、PostgreSQL 和 Redis",
      },
      {
        en: "Automatic HTTPS and unbuffered streamed responses",
        zh: "自动配置 HTTPS，关闭流式响应缓冲",
      },
      {
        en: "Back up the database and remove old backups according to the retention setting",
        zh: "备份数据库，按设置的保留期清理旧备份",
      },
      {
        en: "Documentation distinguishes new-api features from custom changes",
        zh: "文档明确区分 new-api 上游功能与定制修改",
      },
    ],
    role: { en: "Brand customization, deployment, and operations", zh: "品牌定制、部署与运维" },
    year: "2026",
    category: "fde",
    stack: ["Go", "TypeScript", "Docker", "PostgreSQL", "Redis", "Caddy", "Linux"],
    links: {
      github: "https://github.com/DingxinTao0417/omnigate",
      demo: "https://omnigate.cc/",
    },
    cover: {
      src: "/projects/omnigate-dashboard.png",
      width: 1920,
      height: 911,
      alt: {
        en: "Omnigate dashboard with setup guidance, API request examples, and usage panels",
        zh: "Omnigate 控制台概览，包含使用引导、API 请求示例和用量面板",
      },
      caption: { en: "Dashboard overview", zh: "控制台概览" },
    },
    gallery: [
      {
        src: "/projects/omnigate-service-status.png",
        width: 1920,
        height: 911,
        alt: {
          en: "Omnigate service status page with request history and infrastructure health panels",
          zh: "Omnigate 服务状态页，展示请求记录和基础设施健康面板",
        },
        caption: { en: "Service status", zh: "服务状态" },
      },
      {
        src: "/projects/omnigate-home.png",
        width: 1920,
        height: 911,
        alt: {
          en: "Omnigate public homepage with API gateway positioning and model routing illustration",
          zh: "Omnigate 公开首页，展示 API 网关定位和模型路由示意图",
        },
        caption: { en: "Public homepage", zh: "公开首页" },
      },
      {
        src: "/projects/omnigate-ai-usage-guide.png",
        width: 1920,
        height: 911,
        alt: {
          en: "Omnigate documentation article about personal practices for using AI coding tools",
          zh: "Omnigate 文档文章，记录个人使用 AI 编程工具的经验",
        },
        caption: { en: "AI usage guide", zh: "AI 使用心得" },
      },
    ],
    featured: true,
    hue: 14,
    motif: "orbit",
    metrics: [
      { value: "new-api", label: { en: "upstream project", zh: "二次开发基础" } },
      { value: "Compose", label: { en: "single-server deployment", zh: "单机部署" } },
    ],
  },
  {
    slug: "as-a",
    kind: { en: "Full-stack development", zh: "全栈开发" },
    stage: { label: { en: "Demo available", zh: "在线演示" }, tone: "preview" },
    index: "04",
    title: { en: "As-a", zh: "As-a" },
    tagline: {
      en: "An Arabic and English service marketplace with conversations and order management.",
      zh: "支持阿拉伯语与英语的专业服务平台，包含需求沟通与订单管理。",
    },
    description: {
      en: "As-a connects buyers with professional service providers. Buyers can browse services by category, review the delivery scope, and discuss requirements before ordering. Providers manage listings, orders, and earnings in a dedicated workspace. The interface supports Arabic and English, including right-to-left layouts.",
      zh: "As-a 连接服务需求方与专业服务商。买家可以按分类浏览服务、查看交付范围，并与服务商沟通和下单。服务商后台支持管理上架内容、订单与收益。界面提供阿拉伯语、英语和从右向左的阅读布局。",
    },
    problem: {
      en: "Professional service orders require clear scope, pricing, and delivery terms. As-a links conversations with orders so buyers and providers can review agreements and track progress.",
      zh: "专业服务交易需要明确服务范围、价格和交付条件。As-a 将会话与订单关联，便于买家和服务商查看约定并跟进进度。",
    },
    approach: {
      en: "The application uses Next.js and TypeScript, with Supabase for accounts, PostgreSQL data, file storage, and message subscriptions. Providers can create an order in a conversation; buyers can also order from a listing. The Tap checkout code checks payments on the server and handles repeated callbacks without settling an order twice. Database permissions and transactions govern who can read or change records.",
      zh: "应用使用 Next.js 和 TypeScript，账户、PostgreSQL 数据、文件存储与消息订阅交给 Supabase。服务商可以在会话里创建订单，买家也能从服务页直接下单。Tap 支付接入在服务端核对交易结果，并处理重复回调；哪些记录能看、哪些状态能改，由数据库权限和事务约束。",
    },
    impact: {
      en: "The product demo includes a service directory, provider onboarding, conversations, order delivery confirmation, and administrator review. The repository includes local tests for permissions and payment logic. Live payment integration, migration of the existing database, and refund and dispute procedures still require acceptance before real transactions can be enabled.",
      zh: "当前产品演示包含服务目录、服务商入驻、站内会话、订单交付确认和管理员审核，仓库包含针对权限与支付逻辑的本地测试。真实支付联调、旧数据库迁移，以及退款和争议处理，仍需在开放交易前完成验收。",
    },
    learning: {
      en: "The project reinforced the need to handle repeated payment callbacks, validate prices received from the browser, and define separate buyer and provider permissions for the same order. These rules belong on the server and in the database, with tests that check what each role can do.",
      zh: "重点学习了重复支付回调处理、浏览器传入价格的校验，以及买家和服务商对同一订单的权限划分。业务规则应由服务端和数据库约束，并通过测试检查各角色的操作范围。",
    },
    highlights: [
      {
        en: "Arabic and English service content, search, category filters, and right-to-left layouts",
        zh: "阿拉伯语与英语服务内容、搜索和分类筛选，以及 RTL 布局",
      },
      {
        en: "Conversations with order cards and separate delivery and buyer-confirmation steps",
        zh: "会话中展示订单卡片，服务商交付与买家确认分开处理",
      },
      {
        en: "Server-side payment verification, checks against duplicate processing, and manual payout records",
        zh: "服务端核对支付、防止重复处理，并记录人工提现转账凭据",
      },
      {
        en: "Listing moderation, database access rules, and administrator audit records",
        zh: "服务上架审核、数据库访问权限与管理员操作记录",
      },
    ],
    role: { en: "Full-stack development", zh: "全栈开发" },
    year: "2026",
    category: "fullstack",
    stack: ["Next.js", "TypeScript", "Supabase", "PostgreSQL", "Tailwind CSS", "Tap Payments", "Vitest", "Playwright"],
    links: {
      github: "https://github.com/DingxinTao0417/As-a",
      demo: "https://v0-professional-services-pl-git-feeafe-dingxintao0417s-projects.vercel.app/",
    },
    cover: {
      src: "/projects/as-a.png",
      width: 1920,
      height: 911,
      alt: { en: "As-a marketplace homepage with Arabic branding and English content", zh: "As-a 服务平台首页，展示阿拉伯语标识与英语内容" },
      caption: { en: "Marketplace homepage", zh: "平台首页" },
    },
    gallery: [
      {
        src: "/projects/as-a-services.png",
        width: 1920,
        height: 911,
        alt: { en: "As-a service directory with search, categories, and demo service cards", zh: "As-a 服务目录，包含搜索、分类筛选和演示服务卡片" },
        caption: { en: "Service directory", zh: "服务列表与筛选" },
      },
      {
        src: "/projects/as-a-service-detail.png",
        width: 1920,
        height: 911,
        alt: { en: "As-a demo service detail with a provider profile and pricing panel", zh: "As-a 演示服务详情，展示服务商资料与价格面板" },
        caption: { en: "Service details", zh: "服务详情" },
      },
      {
        src: "/projects/as-a-service-workflow.png",
        width: 1920,
        height: 911,
        alt: { en: "As-a service page showing included deliverables, workflow, and frequently asked questions", zh: "As-a 服务页的交付范围、工作步骤与常见问题" },
        caption: { en: "Scope and delivery steps", zh: "交付说明与常见问题" },
      },
      {
        src: "/projects/as-a-provider-dashboard.png",
        width: 1920,
        height: 911,
        alt: { en: "As-a provider dashboard with test orders, earnings panels, and a payment account connection notice", zh: "As-a 服务商后台，显示测试订单、收益面板和支付账户待连接提示" },
        caption: { en: "Provider dashboard", zh: "服务商后台" },
      },
      {
        src: "/projects/as-a-messages.png",
        width: 1920,
        height: 911,
        alt: { en: "As-a messages page with a conversation list and a pending order card", zh: "As-a 消息页面，展示会话列表与待付款订单卡片" },
        caption: { en: "Conversations and orders", zh: "消息与订单" },
      },
    ],
    galleryNote: {
      en: "Screenshots show the demo interface. Service data, ratings, badges, and amounts do not represent verified credentials or real trading results.",
      zh: "截图为演示界面，其中的服务数据、评分、认证标识和金额不代表真实资质或交易业绩。",
    },
    featured: true,
    hue: 145,
    motif: "grid",
    metrics: [
      { value: "AR / EN", label: { en: "bilingual interface", zh: "双语界面" } },
      { value: "RTL", label: { en: "right-to-left layout", zh: "从右向左布局" } },
    ],
  },
  {
    slug: "conuo",
    kind: { en: "Product development", zh: "产品开发" },
    stage: { label: { en: "In development", zh: "开发中" }, tone: "preview" },
    index: "05",
    title: { en: "Conuo", zh: "Conuo" },
    tagline: {
      en: "Read source material beside AI answers, then organize what you learn into notes and knowledge pages.",
      zh: "对照原文向 AI 提问，将学习内容整理为笔记与知识页。",
    },
    description: {
      en: "Conuo is an AI learning workspace in development. It brings imported documents and webpages together with a PDF reader, conversations with source citations, notes, and knowledge pages that users can review and edit.",
      zh: "Conuo 是正在开发的 AI 学习工作台。用户可以导入文档和网页，在 PDF 原文旁进行带来源引用的问答，并将学习内容整理为可审核、编辑的笔记与知识页。",
    },
    problem: {
      en: "Reading material, AI answers, and notes often sit in separate tools. Checking an answer against its source requires switching views, while useful discussion can remain buried in chat history.",
      zh: "学习资料、AI 回答和笔记常常分散在不同工具里。核对回答需要反复切换原文，有用的讨论也容易留在聊天记录中，难以继续整理。",
    },
    approach: {
      en: "The Next.js and React interface places PDF.js source reading beside the conversation. Questions can use source text or a selected PDF region sent to a vision model. Tiptap supports notes and knowledge pages; Supabase handles accounts and cloud storage, with save results shown in the interface.",
      zh: "Next.js 与 React 界面将 PDF.js 原文阅读器和对话并排展示。提问可以引用资料文本，也可以把框选的 PDF 区域交给视觉模型解释。Tiptap 用于笔记和知识页编辑，Supabase 处理账户与云端存储，界面显示保存结果。",
    },
    impact: {
      en: "The core flow covers importing materials, reading and asking questions, checking sources, and saving notes. Live-model and account checks have covered document Q&A, PDF region study, and cloud recovery. The first web release remains in development and has not been publicly deployed; production background tasks and vector retrieval still need complete validation.",
      zh: "已实现资料导入、阅读问答、原文核对与笔记保存，并用真实模型和账号验证问答、区域学习与云端恢复。首版仍在开发，尚未公开部署；生产后台和向量检索链路仍待完整验证。",
    },
    learning: {
      en: "The work involved keeping answers connected to source passages and distinguishing generated drafts from reviewed knowledge. It also required clear save feedback so users can tell whether an edit has reached cloud storage.",
      zh: "实践重点是保留回答与原文的关联，区分生成草稿和经过审核的知识内容。云端保存也需要明确反馈，让用户知道编辑内容是否已经保存成功。",
    },
    highlights: [
      {
        en: "Import PDF, DOCX, Markdown, text files, and webpages",
        zh: "导入 PDF、DOCX、Markdown、文本文件和网页",
      },
      {
        en: "Read the source PDF beside conversations with citations",
        zh: "PDF 原文与带引用的问答并排阅读",
      },
      {
        en: "Ask a vision model about a selected region of a PDF page",
        zh: "框选 PDF 页面区域，向视觉模型提问",
      },
      {
        en: "Edit notes and review knowledge pages, with cloud save feedback",
        zh: "编辑笔记、审核知识页，并查看云端保存结果",
      },
    ],
    role: { en: "Product and full-stack development", zh: "产品与全栈开发" },
    year: "2026",
    category: "ai",
    stack: ["Next.js", "React", "TypeScript", "Supabase", "PDF.js", "Tiptap"],
    links: {},
    article: {
      slug: "conuo",
      label: { en: "Read the development and usage article", zh: "阅读开发与使用文章" },
    },
    cover: {
      src: "/projects/conuo-overview.jpg",
      width: 1280,
      height: 720,
      alt: {
        en: "Conuo learning workspace overview with sample study material",
        zh: "Conuo 学习工作台概览，展示测试学习资料",
      },
      caption: { en: "Learning workspace", zh: "学习工作台" },
    },
    gallery: [
      {
        src: "/projects/conuo-reader.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Conuo PDF source reader beside the AI conversation",
          zh: "Conuo PDF 原文阅读器与 AI 对话并排展示",
        },
        caption: { en: "Source reading and questions", zh: "原文阅读与提问" },
      },
      {
        src: "/projects/conuo-library.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Conuo source library with knowledge collections arranged as book covers",
          zh: "Conuo 资料库，以书封形式展示不同知识库",
        },
        caption: { en: "Source library", zh: "资料库" },
      },
      {
        src: "/projects/conuo-knowledge.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Conuo knowledge page for reviewing and editing study notes",
          zh: "Conuo 知识页，支持审核与编辑学习内容",
        },
        caption: { en: "Knowledge page", zh: "知识页" },
      },
    ],
    galleryNote: {
      en: "Screenshots show the local development interface with original test material. They contain no real users' study content.",
      zh: "截图为本地开发界面，使用自编测试资料，不含真实用户学习内容。",
    },
    featured: true,
    hue: 195,
    motif: "graph",
    metrics: [
      { value: "Web", label: { en: "in development", zh: "开发中" } },
      { value: "PDF", label: { en: "source reading", zh: "原文阅读" } },
    ],
  },
  {
    slug: "dsh-session-conductor",
    kind: { en: "Plugin development", zh: "插件开发" },
    stage: { label: { en: "Updates stopped", zh: "停止更新" }, tone: "paused" },
    index: "06",
    title: { en: "DSH Session Conductor", zh: "DSH Session Conductor" },
    tagline: {
      en: "Create and coordinate tasks across native DeepSeek Harness conversations.",
      zh: "在 DeepSeek Harness 原生聊天中创建任务、协调多个会话。",
    },
    description: {
      en: "DSH Session Conductor is a plugin for DeepSeek Harness Desktop. Users can create or fork a task from a conversation, inherit its workspace, and open the new session through an inline card. The first delegated turn can return its result to that card without starting another parent-model turn.",
      zh: "DSH Session Conductor 是面向 DeepSeek Harness Desktop 的插件。用户可以从当前聊天创建或分叉任务，继承工作区，通过卡片打开新会话。首轮委派结束后，结果可回传到原卡片，无须再次启动主会话模型。",
    },
    problem: {
      en: "Working across several AI conversations requires keeping track of task origins, context, and progress. Creating a task also needs to remain distinct from confirming that its instruction arrived or its work passed review.",
      zh: "在多个 AI 会话中安排工作，需要记住任务来源、上下文和执行进度。创建任务、指令送达和成果通过验收，也需要分别确认。",
    },
    approach: {
      en: "The TypeScript plugin uses Cordis services and React extensions to add creation cards and return links to native chat. Durable task and operation records track each session. Completion returns match the exact initial instruction and turn, then check the original conversation's read permission before displaying a result.",
      zh: "TypeScript 插件通过 Cordis 服务和 React 扩展，在原生聊天中加入创建卡片与返回链接。持久化的任务和操作记录用于追踪会话，结果回传精确匹配首条指令及其执行轮次，并在展示前检查发起会话的读取权限。",
    },
    impact: {
      en: "Task creation, native navigation, and authorized history reading passed local runtime checks in version 0.1.5. The 0.1.6 candidate adds the first-turn return implementation and local tests, but full desktop validation was never completed before development stopped. The package was never published to npm; remote connections and sharing are off by default.",
      zh: "任务创建、原生跳转和授权历史读取已通过 v0.1.5 的本地运行验证。0.1.6 候选包含首轮结果回传实现与本地测试，但在停止更新前没有完成完整的桌面实机验证。插件一直没有发布到 npm，远程连接和分享默认关闭。",
    },
    learning: {
      en: "The project required separate states for message delivery, turn completion, and artifact acceptance. Stable operation IDs and permission checks help preserve those distinctions through retries, session handoffs, and access changes.",
      zh: "项目需要分别记录消息投递、轮次结束和成果验收状态。稳定的操作身份与权限检查，有助于在重试、会话转交和授权变化时保留准确的任务记录。",
    },
    highlights: [
      {
        en: "Create or fork sessions with inherited workspaces and explicit titles",
        zh: "创建或分叉会话，继承工作区并指定标题",
      },
      {
        en: "Open child sessions from chat cards and return through the session header",
        zh: "通过聊天卡片打开子会话，从标题栏返回发起会话",
      },
      {
        en: "Return the exact first delegated turn's result to its original card",
        zh: "精确匹配首轮委派，将结果一次性回传到原创建卡片",
      },
      {
        en: "Read authorized public history and control queued instructions",
        zh: "读取已授权的公开历史，管理排队指令",
      },
    ],
    role: { en: "Plugin design and development", zh: "插件设计与开发" },
    year: "2026",
    category: "ai",
    stack: ["TypeScript", "Node.js", "React", "Cordis", "DeepSeek Harness", "Vitest", "Playwright"],
    links: { github: "https://github.com/DingxinTao0417/dsh-session-conductor" },
    article: {
      slug: "dsh-session-conductor",
      label: { en: "Read the development and usage article", zh: "阅读开发与使用文章" },
    },
    cover: {
      src: "/projects/dsh-session-conductor-parent.png",
      width: 1200,
      height: 820,
      alt: {
        en: "DSH Session Conductor creation card and public-history result in the parent conversation",
        zh: "DSH Session Conductor 发起会话中的创建卡片与公开历史读取结果",
      },
      caption: { en: "Task creation and history reading", zh: "创建任务与读取历史" },
    },
    gallery: [
      {
        src: "/projects/dsh-session-conductor-child.png",
        width: 1200,
        height: 820,
        alt: {
          en: "DSH Session Conductor child conversation with a return link in its header",
          zh: "DSH Session Conductor 子会话，标题栏提供返回发起会话的链接",
        },
        caption: { en: "Return to the parent conversation", zh: "返回发起会话" },
      },
    ],
    galleryNote: {
      en: "Screenshots come from version 0.1.5 running in a real local test environment with separate test data. They show creation, navigation, and public-history reading. The 0.1.6 first-turn return only passed local source and build checks; it was never validated on the desktop.",
      zh: "截图来自 v0.1.5 的真实本地测试环境，使用独立测试数据，仅展示创建、会话跳转和公开历史读取。0.1.6 的首轮结果回传只通过本地源码与构建检查，未做桌面实机验证。",
    },
    notice: {
      en: "Updates have stopped. DeepSeek Harness Desktop ships frequent releases, and the plugin interfaces this project depends on change in nearly every version, so each release needs its own adaptation work. Keeping up with that costs more than this side project is worth, so it is no longer updated. The repository and this write-up stay online as they are and are not adapted to newer DSH releases.",
      zh: "目前不再更新。DeepSeek Harness Desktop 更新频繁，插件依赖的接口几乎每个版本都会变化，需要逐版重新适配，继续跟进的开发难度和维护成本都太高。仓库与项目记录保持现状，不再适配更新后的 DSH 版本。",
    },
    featured: true,
    hue: 230,
    motif: "orbit",
    metrics: [
      { value: "Native", label: { en: "native sessions", zh: "原生会话" } },
      { value: "1st", label: { en: "delegated-turn return", zh: "首轮结果回传" } },
    ],
  },
];

export const featuredProjects = projects.filter((p) => p.featured);

export function getProject(slug: string) {
  return projects.find((project) => project.slug === slug);
}

export function getAdjacentProject(slug: string) {
  const index = projects.findIndex((project) => project.slug === slug);
  if (index === -1) return undefined;
  return projects[(index + 1) % projects.length];
}
