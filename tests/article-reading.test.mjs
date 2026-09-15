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
  assert.equal(d.querySelectorAll('.article-contents button').length,2);
  d.querySelector('.article-contents-child').click();
  assert.equal(scrolled,true); assert.equal(dom.window.location.hash,'#/note/example');
  d.querySelector('.article-code-tools button').click(); await Promise.resolve();
  assert.equal(copied,'const text = "**原样保留**";');
  assert.equal(d.querySelector('[role=status]').textContent,'已复制');
  dispose(); assert.equal(d.querySelector('.article-contents'),null);
  assert.equal(d.querySelector('.article-code-tools'),null);
  assert.equal(d.querySelector('code').textContent,copied); dom.window.close();
});
test('a short article needs no empty directory; clipboard failures are visible',async()=>{
  const dom=new JSDOM('<article><div class="article-body"><h2>唯一章节</h2><pre><code>example</code></pre></div></article>');
  const d=dom.window.document;
  const dispose=enhanceArticleReading(d.querySelector('article'),{copy:async()=>{throw Error('blocked');}});
  assert.equal(d.querySelector('.article-contents'),null);
  d.querySelector('button').click(); await Promise.resolve();
  assert.match(d.querySelector('[role=status]').textContent,/手动复制/);dispose();dom.window.close();
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
