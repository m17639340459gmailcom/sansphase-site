import { pick, type Localized } from "./types";

export type SkillLevel = "expert" | "advanced" | "proficient" | "familiar";

export type Skill = {
  name: string;
  label?: Localized;
  /** Key into the simple-icons registry (see lib/icons.ts). */
  icon?: string;
  level: SkillLevel;
};

export function getSkillName(skill: Skill, locale: string): string {
  return skill.label ? pick(skill.label, locale) : skill.name;
}

export type SkillCategory = {
  id: string;
  title: Localized;
  blurb: Localized;
  skills: Skill[];
};

export const levelValue: Record<SkillLevel, number> = {
  expert: 0.95,
  advanced: 0.8,
  proficient: 0.62,
  familiar: 0.42,
};

export const skillCategories: SkillCategory[] = [
  {
    id: "ai",
    title: { en: "AI Engineering", zh: "AI 工程" },
    blurb: {
      en: "Model API integration, RAG applications, and agent workflows.",
      zh: "模型 API 接入、RAG 与智能体工作流的应用实践。",
    },
    skills: [
      { name: "LangGraph", icon: "langgraph", level: "expert" },
      { name: "LangChain", icon: "langchain", level: "advanced" },
      { name: "RAG Systems", level: "expert" },
      { name: "Agentic Workflows", level: "expert" },
      { name: "PyTorch", icon: "pytorch", level: "proficient" },
      { name: "Hugging Face", icon: "huggingface", level: "advanced" },
      { name: "Fine-tuning", level: "proficient" },
      { name: "Ollama", icon: "ollama", level: "proficient" },
    ],
  },
  {
    id: "frontend",
    title: { en: "Frontend", zh: "前端" },
    blurb: {
      en: "Responsive interfaces with React and Next.js, including interaction feedback and keyboard navigation.",
      zh: "使用 React 和 Next.js 构建响应式界面，关注交互反馈与键盘操作。",
    },
    skills: [
      { name: "React", icon: "react", level: "expert" },
      { name: "Next.js", icon: "nextdotjs", level: "expert" },
      { name: "TypeScript", icon: "typescript", level: "expert" },
      { name: "Tailwind CSS", icon: "tailwindcss", level: "expert" },
      { name: "Vite", icon: "vite", level: "advanced" },
    ],
  },
  {
    id: "backend",
    title: { en: "Backend & APIs", zh: "后端与 API" },
    blurb: {
      en: "APIs, database integration, and streaming responses, with clear responsibilities for easier maintenance.",
      zh: "开发 API、连接数据库与处理流式响应，保持接口职责清晰，便于维护。",
    },
    skills: [
      { name: "Node.js", icon: "nodedotjs", level: "expert" },
      { name: "Python", icon: "python", level: "expert" },
      { name: "FastAPI", icon: "fastapi", level: "expert" },
      { name: "PostgreSQL", icon: "postgresql", level: "advanced" },
      { name: "Redis", icon: "redis", level: "advanced" },
      { name: "Prisma", icon: "prisma", level: "advanced" },
      { name: "Supabase", icon: "supabase", level: "advanced" },
    ],
  },
  {
    id: "data",
    title: { en: "Data & Analytics", zh: "数据与分析" },
    blurb: {
      en: "Data processing and analysis with SQL and Python, alongside my Analytics studies at USC.",
      zh: "结合在 USC 的分析学学习，用 SQL 和 Python 处理数据并开展分析。",
    },
    skills: [
      { name: "SQL", icon: "postgresql", level: "expert" },
      { name: "pandas", icon: "pandas", level: "advanced" },
      { name: "NumPy", icon: "numpy", level: "advanced" },
      { name: "scikit-learn", icon: "scikitlearn", level: "advanced" },
      { name: "Tableau", level: "proficient" },
      { name: "Jupyter", icon: "jupyter", level: "expert" },
      { name: "R", icon: "r", level: "familiar" },
    ],
  },
  {
    id: "cloud",
    title: { en: "Cloud & DevOps", zh: "云与 DevOps" },
    blurb: {
      en: "Application deployment, environment configuration, and log-based troubleshooting, including maintenance after launch.",
      zh: "应用部署、环境配置与日志排查，关注服务上线后的运行和维护。",
    },
    skills: [
      { name: "AWS", level: "advanced" },
      { name: "Google Cloud", icon: "googlecloud", level: "proficient" },
      { name: "Vercel", icon: "vercel", level: "expert" },
      { name: "Docker", icon: "docker", level: "advanced" },
      { name: "Kubernetes", icon: "kubernetes", level: "proficient" },
      { name: "GitHub Actions", icon: "githubactions", level: "advanced" },
      { name: "Cloudflare", icon: "cloudflare", level: "proficient" },
      { name: "Linux", icon: "linux", level: "advanced" },
    ],
  },
  {
    id: "fde",
    title: { en: "Forward Deployed", zh: "前沿部署" },
    blurb: {
      en: "Studying requirements analysis and system integration, connecting technical approaches to actual usage workflows.",
      zh: "关注需求分析与系统集成，学习将技术方案与实际使用流程对接。",
    },
    skills: [
      { name: "Customer Discovery", label: { en: "Customer Discovery", zh: "客户需求调研" }, level: "advanced" },
      { name: "Solution Architecture", label: { en: "Solution Architecture", zh: "解决方案架构" }, level: "advanced" },
      { name: "Systems Integration", label: { en: "Systems Integration", zh: "系统集成" }, level: "expert" },
      { name: "Security Reviews", label: { en: "Security Reviews", zh: "安全评审" }, level: "proficient" },
      { name: "Technical Writing", label: { en: "Technical Writing", zh: "技术文档编写" }, level: "advanced" },
      { name: "Bilingual EN / 中文", label: { en: "Bilingual Communication", zh: "中英双语沟通" }, level: "expert" },
      { name: "Enablement & Training", label: { en: "Enablement & Training", zh: "使用指导与培训" }, level: "advanced" },
    ],
  },
];

/** Flattened list for the 3D sphere: unique names, weighted by level. */
export const sphereSkills = Array.from(
  new Map(
    skillCategories
      .flatMap((c) => c.skills.map((s) => ({ ...s, category: c.id })))
      .map((s) => [s.name, s] as const),
  ).values(),
);

export const toolbelt: { name: string; icon?: string; note: Localized }[] = [
  { name: "Cursor", note: { en: "Editor", zh: "编辑器" } },
  { name: "TypeScript", icon: "typescript", note: { en: "Default language", zh: "默认语言" } },
  { name: "Next.js", icon: "nextdotjs", note: { en: "Web framework", zh: "Web 框架" } },
  { name: "FastAPI", icon: "fastapi", note: { en: "Python services", zh: "Python 服务" } },
  { name: "PostgreSQL", icon: "postgresql", note: { en: "System of record", zh: "主数据库" } },
  { name: "LangGraph", icon: "langgraph", note: { en: "Agent runtime", zh: "智能体运行时" } },
  { name: "Docker", icon: "docker", note: { en: "Packaging", zh: "打包与交付" } },
  { name: "Vercel", icon: "vercel", note: { en: "Deploy target", zh: "部署平台" } },
  { name: "Linear", icon: "linear", note: { en: "Planning", zh: "项目规划" } },
  { name: "Figma", icon: "figma", note: { en: "Design", zh: "设计" } },
];
