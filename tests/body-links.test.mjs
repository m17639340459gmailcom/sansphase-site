import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeBodyLinks} from '../src/body-links.mjs';
import {validateArticle} from '../server/author-service.ts';
import {cleanBody} from '../server/content-service.mjs';

test('body URLs become links without altering labels, punctuation, existing links or code',()=>{
  const input='<p>官网：https://example.com/download?a=1&amp;b=2。另见 www.example.org。</p><p><a href="https://example.com/docs"><span style="color:#afe5d7;font-family:Georgia">官方文档</span></a></p><pre><code>https://example.com/code</code></pre><p><code>https://example.com/inline</code></p>';
  const normalized=normalizeBodyLinks(input),body=JSDOM.fragment(normalized);
  assert.deepEqual([...body.querySelectorAll('a')].map(a=>[a.textContent,a.getAttribute('href')]),[
    ['https://example.com/download?a=1&b=2','https://example.com/download?a=1&b=2'],
    ['www.example.org','https://www.example.org'],['官方文档','https://example.com/docs'],
  ]);
  assert.equal(body.querySelectorAll('code a,a a').length,0);
  assert.equal(body.textContent,JSDOM.fragment(input).textContent);
  assert.equal(normalizeBodyLinks(normalized),normalized);
  const escaped='<p>&amp;lt;strong&amp;gt; https://example.com/?a=1&amp;copy=2</p>';
  const once=normalizeBodyLinks(escaped);
  assert.equal(normalizeBodyLinks(once),once,'reopening does not decode entities a second time');
  assert.equal(JSDOM.fragment(once).textContent,JSDOM.fragment(escaped).textContent);
});

test('all five publishing kinds and legacy public bodies linkify while retaining safe authored styles',()=>{
  const input='<p>下载 https://example.com/download</p><p><a href="https://example.com/docs"><span style="color:#afe5d7;font-family:Georgia;font-size:20px">阅读文档</span></a></p><script>https://bad.example/</script><a href="javascript:alert(1)">危险</a>';
  for(const kind of ['articles','works','resources','software','resource-center']){
    const saved=validateArticle({title:'链接',slug:'links',body:input},kind);
    for(const html of [saved.body,cleanBody(saved.body,'https://example.com',new Set()),cleanBody(input,'https://example.com',new Set())]){
      const body=JSDOM.fragment(html),links=[...body.querySelectorAll('a[href]')].filter(a=>a.getAttribute('href'));
      assert.deepEqual(links.map(a=>a.getAttribute('href')),['https://example.com/download','https://example.com/docs']);
      assert.equal(links[1].firstElementChild.style.color,'rgb(175, 229, 215)');
      assert.equal(links[1].firstElementChild.style.fontFamily,'Georgia');
      assert.equal(links[1].firstElementChild.style.fontSize,'20px');
      assert(!/javascript|<script/.test(html));
    }
  }
});
