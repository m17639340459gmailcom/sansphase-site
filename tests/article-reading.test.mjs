import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {enhanceArticleReading} from '../src/article-reading.mjs';
import {articleTemplates} from '../src/article-templates.mjs';

test('article navigation keeps the route and code copying preserves literal source', async()=>{
  const dom=new JSDOM('<article><div class="article-body"><h2>准备</h2><h3>验证</h3><pre><code>const text = "**原样保留**";</code></pre></div></article>',{url:'http://localhost/#/note/example'});
  const {document:d}=dom.window; let copied,scrolled=false;
  d.querySelector('h3').scrollIntoView=()=>{scrolled=true;};
  const dispose=enhanceArticleReading(d.querySelector('article'),{copy:async text=>{copied=text;}});
  assert.equal(d.querySelectorAll('.article-contents nav button').length,2);
  assert.equal(d.querySelector('article > details.article-contents + .article-body'),d.querySelector('.article-body'));
  assert.equal(d.querySelector('.article-reading-layout'),null);
  d.querySelector('.article-contents-child').click();
  assert.equal(scrolled,true); assert.equal(dom.window.location.hash,'#/note/example');
  d.querySelector('.article-code-tools button').click(); await Promise.resolve();
  assert.equal(copied,'const text = "**原样保留**";');
  assert.equal(d.querySelector('[role=status]').textContent,'已复制');
  dispose(); assert.equal(d.querySelector('.article-contents'),null);
  assert.equal(d.querySelector('.article-reading-layout'),null);
  assert.equal(d.querySelector('h3').hasAttribute('tabindex'),false);
  assert.equal(d.querySelector('.article-code-tools'),null);
  assert.equal(d.querySelector('code').textContent,copied); dom.window.close();
});
test('the original inline directory expands without changing layout and respects reduced motion',()=>{
  const dom=new JSDOM('<main><article><div class="article-body"><h2>A</h2><h3 tabindex="0">B</h3></div></article></main>',{url:'http://localhost/#/software/demo'});
  const w=dom.window,d=w.document;w.matchMedia=()=>({matches:true});
  let options;d.querySelector('h3').scrollIntoView=value=>{options=value;};
  const dispose=enhanceArticleReading(d.querySelector('article'),{english:true});
  const contents=d.querySelector('details.article-contents');
  assert.equal(contents.open,false);assert.equal(contents.querySelector('summary').textContent,'On this page');
  contents.querySelector('summary').click();assert.equal(contents.open,true);
  contents.querySelector('.article-contents-child').click();assert.equal(options.behavior,'instant');
  assert.equal(contents.open,true);assert.equal(d.activeElement,d.querySelector('h3'));
  assert.equal(w.location.hash,'#/software/demo');assert(d.querySelector('main > article'));
  dispose();assert.equal(d.querySelector('h3').getAttribute('tabindex'),'0');dom.window.close();
});

test('a short article needs no empty directory; clipboard failures are visible',async()=>{
  const dom=new JSDOM('<article><div class="article-body"><h2>唯一章节</h2><pre><code>example</code></pre></div></article>');
  const d=dom.window.document;
  const dispose=enhanceArticleReading(d.querySelector('article'),{copy:async()=>{throw Error('blocked');}});
  assert.equal(d.querySelector('.article-contents'),null);
  d.querySelector('button').click(); await Promise.resolve();
  assert.match(d.querySelector('[role=status]').textContent,/手动复制/);dispose();dom.window.close();
});

test('reading sidebar has one responsive directory and preserves article content, route and cleanup',()=>{
  const dom=new JSDOM('<section class="page"><article><h1>资料</h1><div class="article-body"><h2>开始</h2><p>原始正文</p><h3>步骤</h3></div></article></section>',{url:'http://localhost/#/resources/demo',pretendToBeVisual:true});
  const w=dom.window,d=w.document;
  let mediaChange,jumped;
  const media={matches:false,addEventListener:(_,fn)=>mediaChange=fn,removeEventListener:(_,fn)=>assert.equal(fn,mediaChange)};
  w.matchMedia=query=>query.includes('max-width')?media:{matches:true};
  const article=d.querySelector('article'),body=d.querySelector('.article-body'),original=body.innerHTML;
  d.querySelector('h3').scrollIntoView=value=>jumped=value;
  const dispose=enhanceArticleReading(article,{sidebarHTML:'<div class="blog-identity">作者</div><div class="blog-music-card">音乐</div>'});
  const directory=d.querySelector('.article-contents');
  assert(d.querySelector('.reading-sidebar .blog-identity'));
  assert(d.querySelector('.reading-sidebar .blog-music-card'));
  assert.equal(d.querySelector('.reading-layout').firstElementChild,article,'the article is read before the rail');
  assert.equal(article.nextElementSibling,d.querySelector('.reading-sidebar'));
  assert.equal(d.querySelector('.blog-identity').nextElementSibling,d.querySelector('.blog-music-card'));
  assert.equal(directory.parentElement.className,'reading-directory-slot');
  assert.equal(directory.open,true);assert.equal(d.querySelectorAll('.article-contents').length,1);
  assert.equal(body.innerHTML,original);
  directory.querySelector('.article-contents-child').click();
  assert.equal(jumped.behavior,'instant');assert.equal(w.location.hash,'#/resources/demo');
  media.matches=true;mediaChange();
  assert.equal(directory.nextElementSibling,body);assert.equal(directory.open,false);
  assert.equal(d.querySelectorAll('.article-contents').length,1);
  media.matches=false;mediaChange();assert.equal(directory.parentElement.className,'reading-directory-slot');
  dispose();assert.equal(d.querySelector('.reading-layout'),null);assert.equal(d.querySelector('.article-contents'),null);
  assert.equal(d.querySelector('.page').firstElementChild,article);assert.equal(body.innerHTML,original);
  dom.window.close();
});

test('a sidebar offers a single chapter and omits a directory for unstructured short content',()=>{
  for(const hasHeading of [true,false]){
    const dom=new JSDOM(`<section><article><div class="article-body">${hasHeading?'<h2>说明</h2>':''}<p>短文</p></div></article></section>`,{pretendToBeVisual:true});
    const d=dom.window.document;
    const dispose=enhanceArticleReading(d.querySelector('article'),{english:true,sidebarHTML:'<div class="blog-identity">Author</div>'});
    assert.equal(d.querySelectorAll('.article-contents nav button').length,hasHeading?1:0);
    if(hasHeading)assert.equal(d.querySelector('.article-contents summary').textContent,'On this page');
    dispose();dom.window.close();
  }
});
test('writing templates provide outlines rather than invented author content',()=>{
  for(const template of Object.values(articleTemplates)) {
    const dom=new JSDOM(template.body);
    assert(dom.window.document.querySelectorAll('h2').length>=3);
    assert([...dom.window.document.querySelectorAll('p')].every(p=>!p.textContent));
    assert.equal(dom.window.document.querySelector('img,a,script'),null);
    dom.window.close();
  }
});

const shareMarkup='<article><h1>演示标题</h1><div class="article-body"><p>短文也可以分享。</p></div><div class="article-bottom"><a class="text-link article-more" href="#/software">浏览更多</a></div></article>';
test('the footer shares the complete reading route and leaves Browse more on the right',async()=>{
  const dom=new JSDOM(shareMarkup,{url:'http://localhost:4177/#/software/demo-software-1'});
  const d=dom.window.document;let copied;
  const dispose=enhanceArticleReading(d.querySelector('article'),{copy:async text=>{copied=text;}});
  assert.equal(d.querySelector('.article-footer-links').lastElementChild,d.querySelector('.article-more'));
  assert.equal(d.querySelector('.article-share-separator').textContent,'·');
  d.querySelector('.article-share-button').click();await Promise.resolve();
  assert.equal(copied,'http://localhost:4177/#/software/demo-software-1');
  assert.equal(d.querySelector('[role=status]').textContent,'链接已复制');
  assert.equal(d.querySelector('.article-more').getAttribute('href'),'#/software');
  dispose(); assert.equal(d.querySelector('.article-share'),null);
  assert.equal(d.querySelector('.article-bottom > .article-more')!==null,true);
  dom.window.close();
});
test('sharing uses the native sheet when available and treats cancellation as cancellation',async()=>{
  const dom=new JSDOM(shareMarkup,{url:'http://localhost/#/work/demo-works-1'}),w=dom.window,d=w.document;
  let payload,copies=0;
  w.navigator.share=async value=>{payload=value;throw new w.DOMException('cancelled','AbortError');};
  const dispose=enhanceArticleReading(d.querySelector('article'),{copy:async()=>{copies++;}});
  d.querySelector('.article-share-button').click();await Promise.resolve();await Promise.resolve();
  assert.equal(payload.title,'演示标题');assert.equal(payload.url,w.location.href);
  assert.equal(copies,0);assert.equal(d.querySelector('[role=status]').textContent,'');
  dispose();dom.window.close();
});
test('denied sharing offers a selectable URL instead of claiming success',async()=>{
  const dom=new JSDOM(shareMarkup,{url:'http://localhost/#/resources/demo'}),d=dom.window.document;
  const dispose=enhanceArticleReading(d.querySelector('article'),{english:true,copy:async()=>{throw Error('denied');}});
  d.querySelector('.article-share-button').click();await Promise.resolve();await Promise.resolve();
  assert.equal(d.querySelector('[role=status] input').value,dom.window.location.href);
  assert.match(d.querySelector('[role=status]').textContent,/Copy this link/);
  d.querySelector('h1').click();assert.equal(d.querySelector('[role=status]').textContent,'');
  dispose();dom.window.close();
});

test('on wide screens the author and contents rail sits on the left of the article',async()=>{
  const {readFile}=await import('node:fs/promises');
  const css=await readFile('src/styles-reading.css','utf8');
  assert.match(css,/\.reading-layout \{ display: grid; grid-template-columns: 280px minmax\(0, 1fr\)/);
  assert.match(css,/\.reading-layout > \.reading-article \{ grid-column: 2;/);
  assert.match(css,/\.reading-layout > \.reading-sidebar \{ grid-column: 1;/);
});
