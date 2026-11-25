import type { Localized } from "./types";

export type EducationEntry = {
  id: string;
  school: Localized;
  shortName: string;
  degree?: Localized;
  field: Localized;
  period: Localized;
  classOf?: string;
  location?: Localized;
  focus: Localized[];
  logo: string;
  logoFit: "cover" | "contain" | "wordmark";
  hue: number;
};

export const education: EducationEntry[] = [
  {
    id: "usc",
    school: { en: "University of Southern California", zh: "南加州大学" },
    shortName: "USC",
    degree: { en: "Master of Science", zh: "理学硕士" },
    field: { en: "Analytics", zh: "分析学" },
    period: { en: "2026 — 2027", zh: "2026 — 2027" },
    classOf: "2027",
    location: { en: "Los Angeles, CA", zh: "加州 · 洛杉矶" },
    focus: [
      { en: "Statistical modeling & forecasting", zh: "统计建模与预测" },
      { en: "Machine learning for decision-making", zh: "面向决策的机器学习" },
      { en: "Data engineering & experimentation", zh: "数据工程与实验设计" },
    ],
    logo: "/education/usc.png",
    logoFit: "cover",
    hue: 0,
  },
  {
    id: "uci",
    school: { en: "University of California, Irvine", zh: "加州大学尔湾分校" },
    shortName: "UCI",
    degree: { en: "Bachelor of Science", zh: "理学学士" },
    field: { en: "Computer Science", zh: "计算机科学" },
    period: { en: "2023 — 2025", zh: "2023 — 2025" },
    classOf: "2025",
    location: { en: "Irvine, CA", zh: "加州 · 尔湾" },
    focus: [
      { en: "Systems, algorithms & software design", zh: "系统、算法与软件设计" },
      { en: "Machine learning & AI", zh: "机器学习与人工智能" },
      { en: "Human-computer interaction", zh: "人机交互" },
    ],
    logo: "/education/uci.png",
    logoFit: "contain",
    hue: 210,
  },
  {
    id: "shoreline",
    school: { en: "Shoreline Community College", zh: "雪兰社区大学" },
    shortName: "Shoreline CC",
    field: { en: "Computer Science", zh: "计算机科学" },
    period: { en: "2021 — 2023", zh: "2021 — 2023" },
    classOf: "2023",
    location: { en: "Shoreline, WA", zh: "华盛顿州 · 雪兰" },
    focus: [
      { en: "Computer science fundamentals", zh: "计算机基础" },
      { en: "Linear algebra", zh: "线性代数" },
      { en: "Probability theory", zh: "概率论" },
    ],
    logo: "/education/shoreline.png",
    logoFit: "cover",
    hue: 176,
  },
];

export type ExperienceEntry = {
  id: string;
  title: Localized;
  org: Localized;
  period: Localized;
  kind: "fde" | "ai" | "fullstack";
  summary: Localized;
  bullets: Localized[];
  stack: string[];
};

/**
 * NOTE: Organization names are intentionally generic placeholders.
 * Replace them with your actual employers / clients.
 */
export const experience: ExperienceEntry[] = [
  {
    id: "fde",
    title: { en: "Forward Deployed Engineer", zh: "前沿部署工程师（FDE）" },
    org: { en: "AI platform · enterprise deployments", zh: "AI 平台 · 企业客户部署" },
    period: { en: "2025 — Present", zh: "2025 — 至今" },
    kind: "fde",
    summary: {
      en: "Embedded with enterprise customers to take AI products from pilot to production inside their environments.",
      zh: "深入企业客户现场，把 AI 产品从试点推进到客户环境内的生产上线。",
    },
    bullets: [
      { en: "Led discovery, solution design and rollout for RAG and agent deployments in regulated environments.", zh: "在受监管环境中主导 RAG 与智能体部署的需求发现、方案设计与上线。" },
      { en: "Built integrations against customer identity, document and ticketing systems.", zh: "对接客户的身份认证、文档与工单系统，完成集成。" },
      { en: "Owned evaluation harnesses that gated every prompt and model change.", zh: "负责评测体系，为每一次 prompt 与模型变更设置门禁。" },
    ],
    stack: ["Python", "TypeScript", "LangGraph", "PostgreSQL", "AWS", "Docker"],
  },
  {
    id: "ai-fullstack",
    title: { en: "AI Full-Stack Engineer", zh: "AI 全栈开发工程师" },
    org: { en: "Product teams · startups & labs", zh: "产品团队 · 初创公司与实验室" },
    period: { en: "2023 — 2025", zh: "2023 — 2025" },
    kind: "ai",
    summary: {
      en: "Designed and shipped LLM-powered product features end to end — from data model to streaming UI.",
      zh: "端到端设计并交付基于 LLM 的产品功能——从数据模型到流式界面。",
    },
    bullets: [
      { en: "Shipped agentic workflow tooling with typed tool schemas and replayable runs.", zh: "交付带类型化工具 schema 与可回放运行记录的智能体工作流工具。" },
      { en: "Built observability for model calls: traces, costs and model-graded quality.", zh: "为模型调用构建可观测性：链路、成本与模型评分质量。" },
      { en: "Designed component systems and motion for React / Next.js frontends.", zh: "为 React / Next.js 前端设计组件体系与动效。" },
    ],
    stack: ["Next.js", "React", "FastAPI", "ClickHouse", "Redis", "Vercel"],
  },
  {
    id: "fullstack",
    title: { en: "Software Engineer (Full-Stack)", zh: "软件工程师（全栈）" },
    org: { en: "Internships & university projects", zh: "实习与校园项目" },
    period: { en: "2022 — 2023", zh: "2022 — 2023" },
    kind: "fullstack",
    summary: {
      en: "Learned the full stack by shipping: web apps, APIs, databases and the deployments that kept them online.",
      zh: "通过真正上线来学习全栈：Web 应用、API、数据库，以及让它们持续在线的部署。",
    },
    bullets: [
      { en: "Built data-driven web applications with React and Node.", zh: "用 React 与 Node 构建数据驱动的 Web 应用。" },
      { en: "Set up CI/CD, containerization and monitoring for student and client projects.", zh: "为校园与客户项目搭建 CI/CD、容器化与监控。" },
    ],
    stack: ["React", "Node.js", "PostgreSQL", "Docker", "GitHub Actions"],
  },
];
