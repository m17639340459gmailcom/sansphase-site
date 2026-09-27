// The notice card owns its slide index and timer; app.mjs only supplies current
// content, language and utilities already loaded by the page.
export function createBlogNotice({
  document,
  announcements,
  english,
  icons,
  escapeHTML: esc,
  imageSources,
  copy,
  setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval,
}) {
  let index = 0;
  let timer;
  const t = (zh, en) => english() ? en : zh;
  const items = () => {
    const published = announcements();
    if (published) return published.map(item => ({
      ...item,
      title: copy(item.title),
      summary: copy(item.summary),
    }));
    return [
      ['这里记录正在发生的事。', 'A record of what is taking shape.', 'AI 学习、作品制作与网站建设会逐步整理在这里。', 'AI learning, project making, and site development will be organised here.'],
      ['首页宇宙入口已完成。', 'The immersive home is in place.', '首页保留空间场景，博客从导航进入，不打断首屏体验。', 'The space scene remains the entrance; the blog opens from navigation.'],
      ['博客内容会逐步更新。', 'The blog will grow over time.', '文章、资料和作品会在准备好后陆续发布。', 'Notes, resources, and work will be published as they are ready.'],
    ].map(item => ({title:t(item[0],item[1]),summary:t(item[2],item[3])}));
  };

  function html() {
    const notices = items();
    if (!notices.length) return '';
    const slides = notices.map((item, slideIndex) => {
      const linkAttrs = item.link ? `href="${esc(item.link)}" target="_blank" rel="noopener noreferrer" tabindex="${slideIndex===index?0:-1}"` : '';
      const headline = item.image && item.link ? `<a ${linkAttrs}>${esc(item.title)}</a>` : esc(item.title);
      return `<div class="blog-notice-slide ${item.image?'has-image':''}" aria-hidden="${slideIndex !== index}">${item.image?`<div class="cover-frame cover-frame--notice"><img class="blog-notice-poster" src="${esc(item.image)}" ${imageSources(item.image, '(max-width: 700px) 100vw, 800px')} decoding="async" alt="${esc(item.title)}" width="960" height="400"></div>`:''}<div class="blog-notice-copy"><span class="eyebrow">${icons.bell}${t('公告','NOTICE')}</span><h2 title="${esc(item.title)}">${headline}</h2><p class="${item.image?'sr-only':''}">${esc(item.summary)}</p>${item.link&&!item.image?`<a ${linkAttrs}>${t('查看公告','Read notice')} ${icons.right}</a>`:''}</div></div>`;
    }).join('');
    return `<div class="blog-notice ${notices[index]?.image?'is-poster':''}" role="region" aria-label="${t('公告','Notices')}" aria-live="polite"><div class="blog-notice-slides">${slides}</div><div class="blog-notice-side"><span class="blog-notice-mark">${String(index+1).padStart(2,'0')} / ${String(notices.length).padStart(2,'0')}</span><div class="blog-notice-controls"><button data-action="blog-notice-prev" aria-label="${t('上一条公告','Previous notice')}">${icons.left}</button><button data-action="blog-notice-next" aria-label="${t('下一条公告','Next notice')}">${icons.right}</button></div></div></div>`;
  }

  function stop() {
    if (timer) cancel(timer);
    timer = undefined;
  }

  function rotate(direction = 1) {
    const notices = items();
    const count = notices.length;
    if (count < 2) return;
    index = (index + direction + count) % count;
    const current = document.querySelector('.blog-notice');
    if (!current) return;
    current.classList.toggle('is-poster', Boolean(notices[index]?.image));
    current.querySelectorAll('.blog-notice-slide').forEach((slide, slideIndex) => {
      slide.setAttribute('aria-hidden', String(slideIndex !== index));
      slide.querySelectorAll('a').forEach(link => { link.tabIndex = slideIndex === index ? 0 : -1; });
    });
    const mark = current.querySelector('.blog-notice-mark');
    if (mark) mark.textContent = `${String(index + 1).padStart(2,'0')} / ${String(count).padStart(2,'0')}`;
  }

  function sync(page) {
    stop();
    if (page !== 'notes' || items().length < 2) return;
    timer = schedule(() => rotate(1), 6500);
  }

  return { html, rotate, sync, stop };
}
