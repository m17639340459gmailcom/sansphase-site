// Bilingual content for the portfolio demos. Chinese text, section copy (both languages),
// covers and links come from the live site's public API and src/data.mjs
// (read 2026-10-17). English for posts, bio, tagline and services is a draft
// translation of that Chinese for review; nothing describes work that does not exist.
export type Lang = 'en' | 'zh';
export type Text = { en: string; zh: string };

const site = 'https://www.sansphase.com';

export const profile = {
  brand: 'SANSPHASE',
  mark: '無相',
  tagline: {
    en: 'Recording ideas, sharing work, keeping the trail of exploration.',
    zh: '记录想法，分享作品，保留探索的轨迹。',
  } as Text,
  fields: { en: 'AI LEARNING · CREATIVE WORK · WEB DEVELOPMENT', zh: 'AI 学习 · 创作过程 · 网站建设' } as Text,
  bio: [
    { en: 'Knowledge is priceless.', zh: '知识是无价的，' },
    { en: 'It can be free.', zh: '可以是免费的，' },
    { en: 'It must never be cheap.', zh: '不能是廉价的。' },
  ] as Text[],
  // Words the statement highlights, per language and line.
  bioKeys: { en: ['priceless.', 'free.', 'never', 'cheap.'], zh: ['无价', '免费', '廉价'] },
  signature: '一身清贫怎敢入繁华 两袖清风怎敢误佳人',
};

export type Post = {
  slug: string;
  title: Text;
  summary: Text;
  category: Text;
  tags: Text[];
  date: string;
  cover: string;
  url: string;
};

const tag = (zh: string, en: string): Text => ({ zh, en });

export const posts: Post[] = [
  {
    slug: 'personal-knowledge-base-completed',
    title: {
      zh: '我的个人知识库完成了：让 AI 协作有据可查、有路可走',
      en: 'My personal knowledge base is done: AI collaboration you can trace and navigate',
    },
    summary: {
      zh: '从分散的项目背景与方法，到可以接续工作的知识库：记录这一版的建立过程、信息分层、本地检索和创作工具接入，也说明完成后的使用边界与维护方式。',
      en: 'From scattered project context and methods to a knowledge base that lets work carry on: how this version was built, how information is layered, local search and creative-tool integration, and the limits and upkeep once it was done.',
    },
    category: { zh: '项目复盘', en: 'Retrospective' },
    tags: [tag('个人知识库', 'Knowledge base'), tag('AI协作', 'AI collaboration'), tag('Obsidian', 'Obsidian'), tag('工作流程', 'Workflow')],
    date: '2026.10.01',
    cover: '/media/c57acd8d-a84c-459b-9eb3-6e7f84a82a2e',
    url: `${site}/blog/personal-knowledge-base-completed`,
  },
  {
    slug: 'ai-short-video-workflow-consolidation',
    title: {
      zh: 'AI短视频工作流整理完成：从两期复盘到下一期验证',
      en: 'The AI short-video workflow, consolidated: from two retrospectives to the next test',
    },
    summary: {
      zh: '上一篇记录了仍在调试中的 AI 短视频制作。这篇接着复盘第三、第四期后完成的工作流整理：从文案、配音、分镜到成片验收，每一步交什么、怎样检查，以及哪些效果仍要等新一期验证。',
      en: 'The last post covered AI short videos still being debugged. This one reviews the workflow consolidated after episodes three and four: what each step hands over from script, voice-over and storyboard to final review, how it is checked, and what still waits for the next episode.',
    },
    category: { zh: '项目复盘', en: 'Retrospective' },
    tags: [tag('AI视频', 'AI video'), tag('短视频工作流', 'Short-video workflow'), tag('内容创作', 'Content creation')],
    date: '2026.09.27',
    cover: '/media/83c0fc01-f511-4fa4-a808-e6f2761f0646',
    url: `${site}/blog/ai-short-video-workflow-consolidation`,
  },
  {
    slug: 'personal-knowledge-base-for-codex',
    title: {
      zh: '我正在搭建一套给自己和 Codex 共用的知识库',
      en: 'Building a knowledge base that Codex and I can share',
    },
    summary: {
      zh: '记录我如何用 Obsidian 组织个人与项目知识，并尝试让 Codex 按任务读取有状态、可追溯的上下文。文章区分当前基础、有限测试和仍未完成的检索验收，不把规划中的能力写成既成事实。',
      en: 'How I organise personal and project knowledge in Obsidian and try to let Codex read stateful, traceable context for each task. The post separates what exists, what has had limited testing and what retrieval checks remain, without presenting plans as facts.',
    },
    category: { zh: '项目复盘', en: 'Retrospective' },
    tags: [tag('个人知识库', 'Knowledge base'), tag('Obsidian', 'Obsidian'), tag('Codex', 'Codex'), tag('AI协作', 'AI collaboration')],
    date: '2026.09.25',
    cover: '/media/69effed5-7ec9-437d-8b8d-241e08d74de0',
    url: `${site}/blog/personal-knowledge-base-for-codex`,
  },
  {
    slug: 'ai-short-video-workflow-retrospective',
    title: {
      zh: '把 AI 视频做成工作流：一次仍在进行中的项目复盘',
      en: 'Turning AI video into a workflow: a retrospective of a project still in progress',
    },
    summary: {
      zh: '记录一套 AI 短视频流程如何从文案、配音、画面设计走到组件和成片验收，也复盘 B07 单元“技术修好了，观众还是没看懂”的教训。本文以仍在进行的项目为例，不把局部通过写成整期完成。',
      en: 'How an AI short-video process moved from script, voice-over and visual design to components and final review, and the lesson of unit B07: the tech was fixed, yet viewers still did not get it. Written about an ongoing project, without calling partial passes a finished episode.',
    },
    category: { zh: '项目复盘', en: 'Retrospective' },
    tags: [tag('AI 视频', 'AI video'), tag('工作流', 'Workflow'), tag('内容创作', 'Content creation')],
    date: '2026.09.14',
    cover: '/media/d260448e-40de-44de-b50a-7b077766630e',
    url: `${site}/blog/ai-short-video-workflow-retrospective`,
  },
];

export type Section = { id: string; name: Text; description: Text; status: Text; url: string; open: boolean };

// Names and descriptions as in src/data.mjs; status from the public collection counts.
export const sections: Section[] = [
  {
    id: 'notes',
    name: { zh: '博客', en: 'Blog' },
    description: { zh: '记录 AI 学习、创作过程，以及無相网站的建设。', en: 'Notes on AI learning, creative work, and website development.' },
    status: { zh: '04 篇', en: '04 posts' },
    url: `${site}/#/notes`,
    open: true,
  },
  {
    id: 'works',
    name: { zh: '作品', en: 'Work' },
    description: { zh: '作品与项目记录，整理后会陆续发布。', en: 'Projects and the process behind them, published as they are prepared.' },
    status: { zh: '整理中', en: 'In preparation' },
    url: `${site}/#/works`,
    open: false,
  },
  {
    id: 'resources',
    name: { zh: '资料', en: 'Learning' },
    description: { zh: '学习资料与可填写的模板，先了解用途，再选择适合自己的内容。', en: 'Learning materials and editable templates. Explore their purpose and choose what you need.' },
    status: { zh: '整理中', en: 'In preparation' },
    url: `${site}/#/resources`,
    open: false,
  },
  {
    id: 'software',
    name: { zh: '软件推荐', en: 'Software' },
    description: { zh: '整理软件的用途、上手方法和适用场景。', en: 'Software notes covering purpose, getting started, and suitable use cases.' },
    status: { zh: '整理中', en: 'In preparation' },
    url: `${site}/#/software`,
    open: false,
  },
  {
    id: 'community',
    name: { zh: '社区交流', en: 'Community' },
    description: { zh: '交流 AI 学习、作品制作和使用中的问题。', en: 'Discuss learning AI, making projects, and questions along the way.' },
    status: { zh: '筹备中', en: 'In preparation' },
    url: `${site}/#/community`,
    open: false,
  },
  {
    id: 'resource-center',
    name: { zh: '资源中心', en: 'Resource center' },
    description: { zh: '集中查找本站的下载文件与内容入口。', en: 'Find downloadable files and navigate the site’s content in one place.' },
    status: { zh: '整理中', en: 'In preparation' },
    url: `${site}/#/resource-center`,
    open: false,
  },
];

export const services = {
  title: { zh: '代码开发 · 项目承接', en: 'Development & commissions' } as Text,
  summary: {
    zh: '承接网站搭建、功能开发与自动化脚本项目。从需求梳理到开发实现，让每一步都清楚，让想法成为可用的产品。',
    en: 'Websites, feature development and automation scripts, from scoping the requirements to shipping the build. Every step stays clear, and the idea becomes a product you can use.',
  } as Text,
  items: [
    { en: 'Websites', zh: '网站搭建' },
    { en: 'Features', zh: '功能开发' },
    { en: 'Automation', zh: '自动化脚本' },
  ] as Text[],
};

export const socials = [
  { label: { en: 'Douyin', zh: '抖音' } as Text, url: 'https://v.douyin.com/E061MSnp8oM/' },
  {
    label: { en: 'QQ group', zh: 'QQ 群' } as Text,
    url: 'http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=weduN62bpexe-6YWv1Og8SoUI-g0snJs&authKey=HvCh15boO2NfkVR6wRx7abpscq9ubv5EygVe3YVAanf7Q1LIoleYfu23%2BnMV8bm2&noverify=0&group_code=1064900620',
  },
];

export const icp = { text: '豫ICP备2026037683号-1', url: 'https://beian.miit.gov.cn/' };

// The three fields the live site names (AI learning · creative work · web development),
// with the posts that belong to each.
export const fields = [
  {
    key: 'ai',
    name: { en: 'AI learning', zh: 'AI 学习' } as Text,
    line: { en: 'Notes on learning AI and ways of working with it.', zh: '记录 AI 学习，以及和 AI 协作的方法。' } as Text,
    posts: [0, 2],
  },
  {
    key: 'video',
    name: { en: 'Creative work', zh: '创作过程' } as Text,
    line: { en: 'AI short video, from script and voice-over to the final cut.', zh: 'AI 短视频从文案、配音到成片验收的工作流。' } as Text,
    posts: [1, 3],
  },
  {
    key: 'web',
    name: { en: 'Web development', zh: '网站建设' } as Text,
    line: { en: 'Building 無相 itself, plus websites, features and automation.', zh: '無相网站的建设，以及网站搭建、功能开发与自动化。' } as Text,
    posts: [] as number[],
  },
];

// Community rules as written in docs/COMMUNITY-DESIGN.md; the community is not open yet.
export const community = {
  name: { en: 'Community', zh: '社区交流' } as Text,
  status: { en: 'In preparation', zh: '筹备中' } as Text,
  description: {
    en: 'Discuss learning AI, making projects, and questions along the way.',
    zh: '交流 AI 学习、作品制作和使用中的问题。',
  } as Text,
  boards: [
    { key: 'qa', name: { en: 'Q&A', zh: '学习问答' } as Text, line: { en: 'Ask and answer; accept the best reply, or offer a stardust bounty.', zh: '可采纳答案，也可以用星尘悬赏。' } as Text },
    { key: 'showcase', name: { en: 'Showcase', zh: '作品展廊' } as Text, line: { en: 'Galleries with the tools and models behind them; prompts public, hidden or unlockable.', zh: '图集加必填的工具与模型；提示词可公开、隐藏或用星尘解锁。' } as Text },
    { key: 'tools', name: { en: 'Tools', zh: '工具资源' } as Text, line: { en: 'Links and tags; readers vote “still works” or “broken”.', zh: '链接加标签，读者可以投“仍可用 / 已失效”。' } as Text },
    { key: 'moments', name: { en: 'Moments', zh: '随想' } as Text, line: { en: 'Short posts under 300 characters, up to four images.', zh: '300 字以内的动态，最多 4 张图。' } as Text },
  ],
  systems: [
    { name: { en: 'Stardust', zh: '星尘' } as Text, line: { en: 'Earned and spent; meant to circulate between members.', zh: '可以挣、可以花，尽量在用户之间流转。' } as Text },
    { name: { en: 'Levels', zh: '等级' } as Text, line: { en: 'Only steady participation and others’ recognition count; never bought.', zh: '只看持续参与和别人给的认可，不能买。' } as Text },
    { name: { en: 'Check-in', zh: '签到' } as Text, line: { en: 'A little stardust each day; streaks earn badges.', zh: '每天小额星尘，连签换荣誉徽章。' } as Text },
  ],
  url: 'https://community.sansphase.com',
};

// Public counts from /api/content (2026-10-17).
export const numbers = { posts: 4, tags: 11, sections: 6, latest: '2026.10.01' };
