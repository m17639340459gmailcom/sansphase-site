// Reviewed English for the site's current notices, profile and resource guides.
// Exact source matching prevents an older translation replacing newly edited
// text. This is display-only; article/work content and stored originals bypass it.
const english = new Map([
  ['这里记录正在发生的事。','A record of what is taking shape.'],
  ['AI 学习、作品制作与网站建设会逐步整理在这里。','AI learning, project making and site development will be collected here.'],
  ['首页宇宙入口已完成。','The immersive home is in place.'],
  ['首页保留空间场景，博客从导航进入，不打断首屏体验。','The space scene remains the entrance. Open the blog from the navigation.'],
  ['博客内容会逐步更新。','The blog will grow over time.'],
  ['文章、资料和作品会在准备好后陆续发布。','Posts, resources and projects will be published as they are ready.'],
  ['一身清贫怎敢入繁华 两袖清风怎敢误佳人','With little to my name, how could I enter a world of splendor—or hold back the one I love?'],
  ['-知识是无价的\n-可以是免费的\n -不能是廉价的','Knowledge is priceless.\nIt can be free.\nIt should never be cheapened.'],
  ['AI 学习记录 · 本站模板','AI learning journal · Site template'],
  ['空白记录表，包含学习目标、资料来源、实践结果和下一步。','A blank journal for learning goals, sources, practice results and next steps.'],
  ['作品整理清单 · 本站模板','Project checklist · Site template'],
  ['准备作品介绍时使用，逐项整理背景、本人贡献、展示素材和版本。','Prepare a project introduction by collecting its background, your contribution, presentation materials and version.'],
  ['资料来源索引 · 本站模板','Source index · Site template'],
  ['用于填写资料链接、适用场景和阅读日期的空表，不含推荐名单。','A blank index for resource links, use cases and reading dates. No recommendations are included.'],
  ['学习记录','Learning journal'],['作品整理','Project preparation'],['资料管理','Resource management'],
  ['本地预演','Local preview'],['作品、推荐与试听音均为模拟内容，仅用于确认接入后的展示效果。','Projects, recommendations and audio are samples for previewing the interface.'],
  ['此页面用于预览，模拟内容不会发布到正式网站。','This is a preview. Sample content will not be published to the live site.'],
]);
// Only these simple, reviewed resource descriptions have HTML translations.
for(const [zh,en] of [...english]) if(zh.startsWith('空白记录表')||zh.startsWith('准备作品介绍')||zh.startsWith('用于填写资料链接')) english.set(`<p>${zh}</p>`,`<p>${en}</p>`);
export function siteCopy(value,locale='zh') { return locale==='en' ? english.get(value) ?? value : value; }
export function localizedResource(item,locale='zh') {
  if(locale!=='en') return item;
  return {...item,en:item.en || siteCopy(item.title,locale),summaryEn:item.summaryEn || siteCopy(item.summary,locale),categoryEn:item.categoryEn || siteCopy(item.category,locale),bodyHTML:siteCopy(item.bodyHTML,locale)};
}
