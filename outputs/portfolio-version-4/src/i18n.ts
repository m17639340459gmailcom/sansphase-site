// UI strings in both languages. English is the default for the international
// direction; the toggle swaps every [data-i18n] node (text) and
// [data-i18n-aria] node (aria-label), then re-renders the dynamic parts.
import type { Lang, Text } from './content';

export const ui: Record<string, Text> = {
  'page.title': { en: 'SANSPHASE — 無相 · Portfolio & Journal · Version 4', zh: '無相 SANSPHASE · 作品集与博客 · 第 4 版' },
  'page.description': { en: '無相 SANSPHASE — portfolio and journal. Version 4 demo.', zh: '無相 SANSPHASE —— 作品集与博客，第 4 版演示。' },

  'nav.home': { en: 'Home', zh: '首页' },
  'nav.blog': { en: 'Blog', zh: '博客' },
  'nav.work': { en: 'Work', zh: '作品' },
  'nav.learning': { en: 'Learning', zh: '资料' },
  'nav.software': { en: 'Software', zh: '软件推荐' },
  'nav.community': { en: 'Community', zh: '社区交流' },
  'nav.resources': { en: 'Resources', zh: '资源中心' },
  'nav.contact': { en: 'Contact', zh: '联系与合作' },
  'nav.support': { en: 'Support', zh: '赞助与支持' },
  'nav.search': { en: 'Search', zh: '搜索' },
  'nav.cta': { en: 'Let’s talk', zh: '聊聊合作' },

  'aria.primary': { en: 'Primary', zh: '主导航' },
  'aria.home': { en: 'SANSPHASE home', zh: '無相首页' },
  'aria.theme': { en: 'Switch light / dark', zh: '切换浅色 / 深色' },
  'aria.lang': { en: 'EN / 中 — switch to Chinese', zh: 'EN / 中 — 切换到英文' },
  'aria.menu': { en: 'Menu', zh: '菜单' },
  'aria.topics': { en: 'Topics', zh: '主题' },
  'aria.prev': { en: 'Previous case', zh: '上一篇复盘' },
  'aria.next': { en: 'Next case', zh: '下一篇复盘' },
  'aria.cases': { en: 'Case notes', zh: '项目复盘' },
  'aria.log': { en: 'Publishing log, newest weeks on the right', zh: '发布记录，最近的几周在右侧' },
  'aria.cover': { en: 'Recent posts', zh: '近期文章' },
  'aria.pause': { en: 'Pause the slideshow', zh: '暂停轮播' },

  'hero.eyebrow': { en: 'Portfolio + Journal — AI · Creative · Web', zh: '作品集 + 博客 —— AI · 创作 · 网站' },
  'hero.title1': { en: 'Formless ideas,', zh: '无形的想法，' },
  'hero.title2': { en: 'taking shape.', zh: '正在成相。' },
  'hero.primary': { en: 'Explore the cases', zh: '查看复盘' },
  'hero.secondary': { en: 'Read the journal', zh: '阅读博客' },
  'hero.cue': { en: 'Scroll to explore', zh: '向下滚动' },
  'hero.live': { en: 'Recent posts', zh: '近期文章' },
  'hero.posts': { en: 'Posts', zh: '文章' },
  'hero.sections': { en: 'Sections', zh: '栏目' },
  'hero.latest': { en: 'Latest', zh: '最近更新' },
  'hero.lead': { en: 'Notes on AI learning, creative work, and building the 無相 website.', zh: '内容涵盖 AI 学习、创作过程，以及無相网站的建设。' },
  'statement.label': { en: 'Manifesto', zh: '宣言' },

  'fields.eyebrow': { en: '01 / Focus', zh: '01 / 方向' },
  'fields.title': { en: 'Practice, in', zh: '三个方向，' },
  'fields.accent': { en: 'three fields.', zh: '一套实践。' },
  'fields.cta': { en: 'Read the journal', zh: '查看博客' },
  'fields.posts': { en: 'posts', zh: '篇文章' },
  'fields.soon': { en: 'Notes on the way', zh: '记录整理中' },
  'fields.open': { en: 'Open the notes', zh: '查看记录' },

  'work.eyebrow': { en: '02 / Case notes', zh: '02 / 项目复盘' },
  'work.title': { en: 'Four', zh: '四篇' },
  'work.accent': { en: 'case notes.', zh: '项目复盘。' },
  'work.body': { en: 'Retrospectives of real projects: what was built, how it was checked, and what is still open.', zh: '真实项目的复盘：做了什么、怎样验收、还有哪些没完成。' },
  'work.read': { en: 'Read the case', zh: '阅读全文' },
  'work.of': { en: 'Case', zh: '案例' },

  'facts.eyebrow': { en: '03 / In numbers', zh: '03 / 数据一览' },
  'numbers.posts': { en: 'Published posts', zh: '已发布文章' },
  'numbers.tags': { en: 'Topic tags', zh: '主题标签' },
  'numbers.sections': { en: 'Site sections', zh: '网站栏目' },
  'numbers.latest': { en: 'Latest update', zh: '最近更新' },
  'facts.daysAgo': { en: 'days ago', zh: '天前' },
  'facts.today': { en: 'today', zh: '今天' },
  'facts.open': { en: '{n} open', zh: '已开放 {n} 个' },

  'community.eyebrow': { en: '04 / Community', zh: '04 / 社区' },
  'community.title': { en: 'A place to', zh: '一起学习的' },
  'community.accent': { en: 'learn together.', zh: '地方。' },
  'community.name': { en: '無相 Community', zh: '無相社区' },
  'community.boardsCount': { en: 'Boards', zh: '版块' },
  'community.systemsCount': { en: 'Systems', zh: '机制' },
  'community.board': { en: 'Board', zh: '版块' },
  'community.note': {
    en: 'Not open yet. Rules follow the community design notes and may change before launch.',
    zh: '尚未开放。规则来自社区设计文档，上线前可能调整。',
  },
  'log.label': { en: 'Publishing log', zh: '发布记录' },
  'log.total': { en: 'posts in the last 26 weeks', zh: '篇文章 · 最近 26 周' },
  'log.foot': { en: 'Each square is a day; lit squares are days a post went live on sansphase.com.', zh: '每格一天；亮起的格子是主站发布文章的日子。' },

  'journal.eyebrow': { en: '05 / Journal', zh: '05 / 博客' },
  'journal.title': { en: 'Notes, written', zh: '一边做，' },
  'journal.accent': { en: 'while building.', zh: '一边复盘。' },
  'journal.all': { en: 'All posts', zh: '全部文章' },

  'index.eyebrow': { en: '06 / Index', zh: '06 / 索引' },
  'index.title': { en: 'Six sections,', zh: '六个栏目，' },
  'index.accent': { en: 'one archive.', zh: '一个档案。' },
  'index.kicker': { en: 'The main site', zh: '主站' },
  'index.side': { en: 'Everything on sansphase.com, mapped.', zh: '主站的全部内容，一张图看清。' },
  'index.sideBody': { en: 'One section is open today; five are being prepared and will open as their content is ready.', zh: '目前开放一个栏目，另外五个正在整理，内容就绪后陆续开放。' },
  'index.visit': { en: 'Visit sansphase.com', zh: '访问主站' },
  'index.open': { en: 'Open', zh: '已开放' },

  'contact.eyebrow': { en: 'Start a conversation', zh: '聊聊合作' },
  'contact.title': { en: 'Have a project', zh: '有想做的' },
  'contact.accent': { en: 'in mind?', zh: '项目吗？' },
  'contact.qq': { en: 'Join the QQ group', zh: '加入 QQ 群' },
  'contact.douyin': { en: 'Follow on Douyin', zh: '关注抖音' },


  'footer.navigate': { en: 'Navigate', zh: '导航' },
  'footer.connect': { en: 'Connect', zh: '联系' },
  'footer.site': { en: 'Main site', zh: '主站' },
  'footer.time': { en: 'China time (UTC+8)', zh: '北京时间（UTC+8）' },
  'footer.top': { en: 'Back to top', zh: '回到顶部' },
  'footer.fonts': { en: 'Type: Archivo, Inter, Noto Sans SC, JetBrains Mono (OFL) · WebGL: three.js', zh: '字体：Archivo、Inter、Noto Sans SC、JetBrains Mono（OFL）· WebGL：three.js' },

  'article.back': { en: 'Back', zh: '返回' },
  'article.contents': { en: 'Contents', zh: '目录' },
  'article.only': { en: 'This article is available in Chinese only.', zh: '' },
  'article.next': { en: 'Next case', zh: '下一篇' },
  'article.original': { en: 'Read on sansphase.com', zh: '在主站阅读' },
  'article.minutes': { en: 'min read', zh: '分钟读完' },
  'loader.label': { en: 'Taking shape', zh: '正在成相' },
  'demo.badge': { en: 'Version 4 · demo', zh: '第 4 版 · 演示' },
  'palette.chapters': { en: 'Chapters', zh: '章节' },
  'palette.posts': { en: 'Posts', zh: '文章' },
  'palette.sections': { en: 'Sections', zh: '栏目' },
  'palette.actions': { en: 'Actions', zh: '操作' },
  'palette.theme': { en: 'Switch light / dark', zh: '切换浅色 / 深色' },
  'palette.lang': { en: '切换到中文', zh: 'Switch to English' },
  'blog.all': { en: 'All', zh: '全部' },
  'blog.filter': { en: 'Filter by category', zh: '按分类筛选' },
  'blog.search': { en: 'Search posts…', zh: '搜索文章…' },
  'blog.view': { en: 'Layout', zh: '排列方式' },
  'blog.grid': { en: 'Grid', zh: '网格' },
  'blog.list': { en: 'List', zh: '列表' },
  'blog.count': { en: '{n} posts', zh: '{n} 篇文章' },
  'blog.empty': { en: 'No posts match.', zh: '没有匹配的文章。' },
  'blog.clear': { en: 'Clear filters', zh: '清除筛选' },
  'blog.latest': { en: 'Latest', zh: '最新' },
  'page.prepTitle': { en: 'Being prepared', zh: '正在整理' },
  'page.prepBody': { en: 'This section is being prepared and will open once its content is ready.', zh: '这个栏目正在整理，内容就绪后会在这里开放。' },
  'page.meanwhile': { en: 'Read the blog', zh: '先去看看博客' },
  'page.others': { en: 'Other sections', zh: '其他栏目' },
  'community.enter': { en: 'Enter the community', zh: '进入社区' },
  'community.ring': { en: 'ENTER THE COMMUNITY · ENTER THE COMMUNITY · ', zh: '进入社区 · ENTER · 进入社区 · ENTER · ' },
  'community.entryNote': { en: 'The community is being prepared; it opens from here when it launches.', zh: '社区正在筹备，开放后从这里进入。' },
  'activity.title': { en: 'Community pulse', zh: '社区活跃度' },
  'activity.preview': { en: 'Preview data · live numbers once the community opens', zh: '示意数据 · 社区开放后接入实时数据' },
  'activity.live': { en: 'Live', zh: '实时' },
  'activity.online': { en: 'online now', zh: '当前在线' },
  'activity.hours': { en: 'Activity over the last 24 hours (China time)', zh: '最近 24 小时活跃度（北京时间）' },
  'activity.posts': { en: 'Posts today', zh: '今日发帖' },
  'activity.replies': { en: 'Replies today', zh: '今日回复' },
  'activity.checkins': { en: 'Check-ins today', zh: '今日签到' },
  'activity.stardust': { en: 'Stardust moved', zh: '星尘流转' },
  'contact.services': { en: 'What I take on', zh: '承接内容' },
  'contact.reach': { en: 'Where to find me', zh: '在哪里找到我' },
  'contact.note': { en: 'Dedicated contact details are being prepared; for now you can reach me on the platforms above.', zh: '专门的合作联系方式正在准备中，目前可以通过上面的平台找到我。' },
  'support.title': { en: 'Thank you', zh: '感谢' },
  'support.accent': { en: 'for stopping by.', zh: '你的关注。' },
  'support.body': { en: 'Thank you for your interest. Support channels are not open yet.', zh: '感谢你的关注。赞助渠道暂未开放。' },
  'nf.title': { en: 'Nothing here', zh: '这个角落' },
  'nf.accent': { en: 'just yet.', zh: '还没有内容。' },
  'nf.body': { en: 'The link may have changed, or this content is not public yet.', zh: '这条链接可能已变更，或内容尚未公开。' },
  'nf.home': { en: 'Back home', zh: '回到首页' },
  'palette.placeholder': { en: 'Search posts, chapters, actions…', zh: '搜索文章、章节或操作…' },
  'palette.empty': { en: 'Nothing matches.', zh: '没有匹配的结果。' },
};

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export const lang = () => current;
export const t = (key: string) => ui[key]?.[current] ?? key;
export const pick = (text: Text) => text[current];

export function onLang(listener: (lang: Lang) => void) {
  listeners.add(listener);
}

export function setLang(next: Lang) {
  current = next;
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = next;
  document.title = t('page.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('page.description'));
  try {
    localStorage.setItem('sansphase-v4-lang', next);
  } catch {
    // Storage may be unavailable; the toggle still works for this visit.
  }
  listeners.forEach((listener) => listener(next));
}

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('sansphase-v4-lang');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Fall through to the default.
  }
  return 'en';
}
