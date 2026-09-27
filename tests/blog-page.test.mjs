import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {escapeHTML,filterItems} from '../src/core.mjs';
import {createBlogPage} from '../src/blog-page.mjs';

const icons={calendar:'CAL',document:'DOC',search:'SEARCH',grid:'GRID',music:'MUSIC',tags:'TAGS',user:'USER',link:'LINK',right:'RIGHT'};
const first={id:'first',title:'第一篇 <记录>',summary:'关于阅读 & 写作',category:'写作与记录',date:'2026-09-17',tags:['阅读'],coverSrc:'/first.jpg',coverWidth:960,coverHeight:540};
const second={id:'second',title:'第二篇',summary:'没有配图',category:'生活随笔',date:'2026-09-16',tags:['生活']};

function setup() {
  let language='zh';
  const state={notes:[first,second],activeCategory:'all',activeQuery:'',blogView:'list',remotePage:null,siteContent:{delivery:'local',profile:{name:'作者',signature:{zh:'记录生活',en:'Keeping notes'},bio:{zh:'一点简介',en:'A short bio'},socialLinks:[],music:{tracks:[]}},collections:{notes:{totalPublished:2,tagCount:2,tags:['阅读','生活']}}}};
  const t=(zh,en)=>language==='zh'?zh:en;
  const page=createBlogPage({
    getState:()=>state,t,icons,esc:escapeHTML,filterItems,
    imageSources:()=>'',tagTone:()=>'',socialIcon:()=>'',socialPlatform:()=>null,
    categoryLabel:name=>name,noteDate:()=> '2026/09/17',copy:value=>value?.[language]??value,
    arrow:'ARROW',notice:{html:()=>'<section class="blog-notice">公告</section>'},
    weather:{html:()=>'<section class="blog-weather-card">天气</section>'},
    clock:{html:()=>'<section class="blog-clock-card">时间</section>'},
  });
  return {page,state,setLanguage:value=>{language=value;}};
}

test('blog cards preserve filtering, escaped content, images and remote pagination',()=>{
  const {page,state}=setup();
  const dom=new JSDOM(`<main>${page.results()}</main>`);
  const {document}=dom.window;
  assert.equal(document.querySelectorAll('.blog-card').length,2);
  assert.equal(document.querySelector('.blog-card h2').textContent,'第一篇 <记录>');
  assert.equal(document.querySelector('.blog-card img').getAttribute('src'),'/first.jpg');
  assert.equal(document.querySelectorAll('.blog-card img').length,1);
  state.activeQuery='第二篇';
  document.querySelector('main').innerHTML=page.results();
  assert.equal(document.querySelectorAll('.blog-card').length,1);
  assert.equal(document.querySelector('.blog-card h2').textContent,'第二篇');
  state.siteContent.delivery='paged-v1';state.activeQuery='';state.remotePage={page:2,pages:3};
  document.querySelector('main').innerHTML=page.results();
  assert.equal(document.querySelectorAll('.blog-card').length,2);
  assert.equal(document.querySelector('[data-catalog-page="1"]').disabled,false);
  assert.equal(document.querySelector('[data-catalog-page="3"]').disabled,false);
  dom.window.close();
});

test('blog layout keeps notice, article area and side cards in their existing order',()=>{
  const {page,state,setLanguage}=setup();
  const dom=new JSDOM(`<main>${page.html()}</main>`);
  const {document}=dom.window;
  assert.deepEqual([...document.querySelectorAll('.blog-main > *')].map(node=>node.className),['blog-notice','blog-article-area']);
  assert.deepEqual([...document.querySelector('.blog-left').children].map(node=>node.className),['blog-identity','blog-side-card blog-music-card','blog-side-card blog-tags-card']);
  assert.deepEqual([...document.querySelector('.blog-sidebar').children].map(node=>node.className),['blog-weather-card','blog-clock-card']);
  assert.equal(document.querySelector('.blog-identity h2').textContent,'作者');
  assert.equal(document.querySelectorAll('.blog-tags button').length,2);
  state.blogView='grid';setLanguage('en');
  document.querySelector('main').innerHTML=page.html();
  assert.equal(document.querySelector('.blog-results').classList.contains('is-grid'),true);
  assert.equal(document.querySelector('#content-search').getAttribute('placeholder'),'Search notes');
  assert.match(document.querySelector('.blog-identity').textContent,/Keeping notes/);
  dom.window.close();
});

test('blog presentation stays in the existing UI bundle',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');
  const app=await readFile('dist/app.mjs','utf8');
  const ui=await readFile('dist/ui.bundle.mjs','utf8');
  assert.doesNotMatch(app,/from ["']\.\/blog-page\.mjs["']/);
  assert.match(ui,/createBlogPage/);
  assert.ok(!(await readdir('dist')).includes('blog-page.mjs'));
});
