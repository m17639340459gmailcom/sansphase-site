import {setContentHTML} from './content-images.mjs';
// Reuse the existing article and sidebar widgets; the route still owns both.
// The article comes first so keyboard, screen-reader and phone order all reach
// the text before the author rail.
export function mountReadingLayout(article, sidebarHTML, english) {
  const doc=article.ownerDocument,page=article.parentElement;
  const layout=doc.createElement('div');layout.className='reading-layout';
  const sidebar=doc.createElement('aside');sidebar.className='blog-page reading-sidebar';
  sidebar.setAttribute('aria-label',english?'Author, music and contents':'作者、音乐与文章目录');
  setContentHTML(sidebar,sidebarHTML);
  const directory=doc.createElement('div');directory.className='reading-directory-slot';
  sidebar.append(directory);article.before(layout);layout.append(article,sidebar);page.classList.add('reading-page');
  return {directory,dispose(){layout.before(article);layout.remove();page.classList.remove('reading-page');}};
}
