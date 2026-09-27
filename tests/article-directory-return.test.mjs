import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {enhanceArticleReading} from '../src/article-reading.mjs';

function setup(english=false){
  const dom=new JSDOM('<header id="site-header"><nav class="nav"></nav></header><main><article><div class="article-body"><h2>A</h2><h3>B</h3></div><div class="article-bottom" tabindex="0">文章底部</div></article></main>',{url:'http://localhost/#/note/demo'});
  const w=dom.window,d=w.document;w.matchMedia=()=>({matches:true});
  let time=0,sequence=0,contentsBottom=400;
  const timers=new Map();
  w.setTimeout=(fn,delay=0)=>{timers.set(++sequence,{fn,at:time+delay});return sequence;};
  w.clearTimeout=id=>timers.delete(id);
  w.requestAnimationFrame=fn=>w.setTimeout(fn,16);w.cancelAnimationFrame=w.clearTimeout;
  const advance=ms=>{const end=time+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;};
  const header=d.querySelector('header'),article=d.querySelector('article');
  header.getBoundingClientRect=()=>({top:0,bottom:100,height:100});
  article.getBoundingClientRect=()=>({top:-200,bottom:3000});
  const dispose=enhanceArticleReading(article,{english});
  const contents=d.querySelector('.article-contents'),drawer=d.querySelector('.reading-drawer');
  const trigger=drawer.querySelector('.reading-drawer-toggle'),panel=drawer.querySelector('.reading-drawer-panel');
  contents.getBoundingClientRect=()=>({top:contentsBottom-80,bottom:contentsBottom});
  const scroll=(y,bottom)=>{contentsBottom=bottom;w.scrollY=y;w.dispatchEvent(new w.Event('scroll'));advance(16);};
  const visible=()=>drawer.classList.contains('is-visible');
  return {w,d,article,contents,drawer,trigger,panel,dispose,advance,scroll,visible,timers,close:()=>dom.window.close()};
}
test('the V entrance appears only past the directory and never opens without a click',()=>{
  const x=setup();assert.equal(x.visible(),false);assert.equal(x.d.querySelector('.article-directory-return'),null);
  x.scroll(100,150);assert.equal(x.visible(),false);
  x.scroll(200,99);assert(x.visible());assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.drawer.dispatchEvent(new x.w.Event('pointerenter'));x.advance(5000);
  assert(x.visible());assert.equal(x.panel.getAttribute('aria-hidden'),'true');
  assert([...x.panel.querySelectorAll('button')].every(b=>b.disabled));
  x.trigger.click();assert.equal(x.trigger.getAttribute('aria-expanded'),'true');
  assert.equal(x.panel.getAttribute('aria-hidden'),'false');
  x.scroll(220,79);assert.equal(x.trigger.getAttribute('aria-expanded'),'true');
  x.scroll(0,400);assert.equal(x.visible(),false);assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.dispose();x.close();
});
test('idle hides the drawer after 1.5 seconds and scrolling reveals it again',()=>{
  const x=setup();x.scroll(200,90);x.advance(1499);assert(x.visible());
  x.advance(1);assert.equal(x.visible(),false);assert.equal(x.panel.inert,true);
  x.scroll(210,80);assert(x.visible());x.trigger.click();x.advance(1500);
  assert.equal(x.visible(),false);assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.scroll(220,70);assert(x.visible());assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.dispose();x.close();
});
test('hover and keyboard focus keep the drawer available until the interaction ends',()=>{
  const x=setup();x.scroll(200,90);x.advance(1000);
  x.drawer.dispatchEvent(new x.w.Event('pointerenter'));x.advance(2000);assert(x.visible());
  x.drawer.dispatchEvent(new x.w.Event('pointerleave'));x.advance(1499);assert(x.visible());
  x.advance(1);assert.equal(x.visible(),false);
  x.scroll(210,80);x.trigger.focus();x.advance(3000);assert(x.visible());
  x.trigger.blur();x.advance(1500);assert.equal(x.visible(),false);
  x.dispose();x.close();
});
test('click, Escape, and outside actions close the drawer without a focus trap',()=>{
  const x=setup();x.scroll(200,50);x.trigger.click();x.trigger.click();
  assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.trigger.click();x.panel.querySelector('button').focus();
  x.panel.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(x.trigger.getAttribute('aria-expanded'),'false');assert.equal(x.d.activeElement,x.trigger);
  x.trigger.click();x.d.querySelector('h2').dispatchEvent(new x.w.Event('pointerdown',{bubbles:true}));
  assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.dispose();x.close();
});
test('returning opens the original directory while reaching bottom goes to the end of this article',()=>{
  const x=setup();let toContents,toBottom;
  x.contents.scrollIntoView=v=>{toContents=v;};x.article.scrollIntoView=v=>{toBottom=v;};
  x.scroll(200,90);x.trigger.click();x.drawer.querySelector('[data-reading-jump="contents"]').click();
  assert.equal(x.contents.open,true);assert.deepEqual(toContents,{block:'start',behavior:'instant'});
  assert.equal(x.d.activeElement,x.contents.querySelector('summary'));assert.equal(x.trigger.getAttribute('aria-expanded'),'false');
  x.scroll(210,80);x.trigger.click();x.drawer.querySelector('[data-reading-jump="bottom"]').click();
  assert.deepEqual(toBottom,{block:'end',behavior:'instant'});assert.equal(x.d.activeElement,x.d.querySelector('.article-bottom'));
  assert.equal(x.trigger.getAttribute('aria-expanded'),'false');assert.equal(x.w.location.hash,'#/note/demo');
  x.dispose();assert.equal(x.d.querySelector('.article-bottom').getAttribute('tabindex'),'0');x.close();
});
test('drawer labels translate and the small entrance is keyboard accessible',()=>{
  const x=setup(true);x.scroll(300,80);assert.equal(x.trigger.getAttribute('aria-label'),'Open reading navigation');
  assert.equal(x.drawer.querySelector('[data-reading-jump="contents"]').textContent,'Back to contents');
  assert.equal(x.drawer.querySelector('[data-reading-jump="bottom"]').textContent,'Go to bottom');
  x.trigger.focus();x.trigger.click();assert.equal(x.trigger.getAttribute('aria-label'),'Close reading navigation');
  assert.equal(x.d.activeElement,x.drawer.querySelector('[data-reading-jump="contents"]'));
  assert.equal(x.panel.inert,false);x.dispose();x.close();
});
test('unmounting removes the entrance, observers and queued scroll work',()=>{
  const x=setup();x.scroll(200,90);x.trigger.click();x.dispose();x.advance(3000);x.scroll(300,0);
  assert.equal(x.d.querySelector('.reading-drawer'),null);assert.equal(x.timers.size,0);x.close();
});
