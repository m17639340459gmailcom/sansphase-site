import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createSectionPositionTracker} from '../src/section-reading-position.mjs';

function fixture({firstPart=0,headings=[{block:'a',offset:0,part:0},{block:'b',offset:0,part:1}],html='<div data-book-block="a" data-book-offset="0"><h2>相同标题</h2><p>正文</p></div><div data-book-block="b" data-book-offset="0"><h2>相同标题</h2><p>正文</p></div>'}={}) {
 const dom=new JSDOM('<aside><div data-section-headings="chapter">'+headings.map((_,i)=>`<button data-section-heading="${i}">小节</button>`).join('')+'</div></aside><header></header><main><div class="section-body">'+html+'</div></main>',{pretendToBeVisual:true});
 const doc=dom.window.document,content=doc.querySelector('main'),sidebar=doc.querySelector('aside');
 let chapter={id:'chapter',headings},paused=false;
 doc.querySelector('header').getBoundingClientRect=()=>({bottom:152});
 content.getBoundingClientRect=()=>({bottom:2000});
 const nodes=[...content.querySelectorAll('h2,h3,h4')];let tops=nodes.map((_,i)=>220+i*300);
 nodes.forEach((n,i)=>n.getBoundingClientRect=()=>({top:tops[i]}));
 const tracker=createSectionPositionTracker({content,sidebar,toolbar:doc.querySelector('header'),getChapter:()=>chapter,getFirstPart:()=>firstPart,isPaused:()=>paused});
 const selected=()=>[...sidebar.querySelectorAll('[aria-current="location"]')].map(b=>Number(b.dataset.sectionHeading));
 return {dom,tracker,content,sidebar,selected,setTops:v=>{tops=v;},setChapter:v=>{chapter=v;},pause:v=>{paused=v;}};
}

test('current subsection remains highlighted while idle, transfers both directions and ignores duplicate titles',()=>{
 const f=fixture();f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[]);
 f.setTops([160,600]);f.tracker.update();assert.deepEqual(f.selected(),[0]);
 f.tracker.update();assert.deepEqual(f.selected(),[0]);
 f.setTops([-400,172]);f.tracker.update();assert.deepEqual(f.selected(),[1]);
 f.setTops([100,400]);f.tracker.update();assert.deepEqual(f.selected(),[0]);
 f.tracker.destroy();f.dom.window.close();
});

test('resuming inside an unloaded subsection uses fragment metadata without fetching older text',()=>{
 const f=fixture({firstPart:2,headings:[{block:'a',offset:0,part:0},{block:'b',offset:0,part:4}],html:'<div data-book-block="middle" data-book-offset="1000"><p>续读的段落，没有标题</p></div>'});
 f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[0]);
 f.setChapter(null);f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[]);
 f.tracker.destroy();f.dom.window.close();
});

test('a short final subsection visible below the current one does not steal the reading highlight',()=>{
 const f=fixture();Object.defineProperty(f.dom.window,'scrollY',{value:1000});
 Object.defineProperty(f.dom.window.document.documentElement,'scrollHeight',{value:2000,configurable:true});
 f.content.getBoundingClientRect=()=>({bottom:700});f.setTops([170,566]);
 f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[0]);
 f.setTops([-250,170]);f.tracker.update();assert.deepEqual(f.selected(),[1]);
 Object.defineProperty(f.dom.window.document.documentElement,'scrollHeight',{value:1768});
 f.setTops([-250,300]);f.tracker.update();assert.deepEqual(f.selected(),[1]);
 f.tracker.destroy();f.dom.window.close();
});

test('nested headings map by text offset; refresh survives new fragments and never unfolds a collapsed directory',()=>{
 const f=fixture({headings:[{block:'a',offset:0,part:0},{block:'a',offset:6,part:0}],html:'<div data-book-block="a" data-book-offset="0"><div><h2>标题</h2><p>四字正文</p><h3>小标题</h3></div></div>'});
 f.sidebar.firstElementChild.hidden=true;f.setTops([-100,170]);f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[1]);assert(f.sidebar.firstElementChild.hidden);
 f.pause(true);f.setTops([400,700]);f.tracker.update();assert.deepEqual(f.selected(),[1]);
 f.pause(false);f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[]);
 f.tracker.destroy();f.dom.window.close();
});

function directoryViewport(f,{top=126,height=400,scrollHeight=1600,initialScroll=0,items=[{offset:60,height:40},{offset:620,height:40}]}={}) {
 const win=f.dom.window,doc=win.document;
 let scroll=initialScroll,viewportHeight=height;
 const writes=[];
 Object.defineProperties(f.sidebar,{
  clientTop:{value:1},clientHeight:{get:()=>viewportHeight},scrollHeight:{value:scrollHeight},
  scrollTop:{get:()=>scroll,set:value=>{scroll=value;writes.push(value);}}
 });
 Object.defineProperty(win,'scrollY',{value:300});
 Object.defineProperty(doc.documentElement,'scrollHeight',{value:10000});
 f.sidebar.getBoundingClientRect=()=>({top,bottom:top+viewportHeight+2,height:viewportHeight+2});
 const wireButtons=()=>[...f.sidebar.querySelectorAll('[data-section-heading],[data-section-anchor]')].forEach((button,index)=>{
  const item=items[index];
  button.getBoundingClientRect=()=>({top:top+1+item.offset-scroll,bottom:top+1+item.offset-scroll+item.height,height:item.height});
  button.scrollIntoView=()=>assert.fail('following the directory must not scroll ancestor containers');
 });
 wireButtons();
 win.scrollTo=()=>assert.fail('following the directory must not move the reading page');
 const focus=doc.createElement('input');doc.body.append(focus);focus.focus();
 const assertReadingUnchanged=()=>{assert.equal(win.scrollY,300);assert.equal(doc.activeElement,focus);};
 return {writes,wireButtons,assertReadingUnchanged,setHeight:value=>{viewportHeight=value;}};
}

function closeFixture(t,f){t.after(()=>{f.tracker.destroy();f.dom.window.close();});}

test('reading down and back up brings the current subsection into the directory viewport only',t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f);
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();assert.equal(f.sidebar.scrollTop,0);
 f.setTops([-400,170]);f.tracker.update();assert.deepEqual(f.selected(),[1]);assert.equal(f.sidebar.scrollTop,260);
 f.setTops([100,400]);f.tracker.update();assert.deepEqual(f.selected(),[0]);assert.equal(f.sidebar.scrollTop,60);
 viewport.assertReadingUnchanged();
});

test('visible subsections stay still and idle updates respect manual directory scrolling',t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{items:[{offset:60,height:40},{offset:200,height:40}]});
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
 f.setTops([-400,170]);f.tracker.update();assert.deepEqual(viewport.writes,[]);
 f.sidebar.scrollTop=600;viewport.writes.length=0;
 f.tracker.update();f.tracker.refresh();f.tracker.update();
 assert.equal(f.sidebar.scrollTop,600);assert.deepEqual(viewport.writes,[]);viewport.assertReadingUnchanged();
});

test('rebuilding a fragment directory follows the same selected subsection without resetting the page',t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f);
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
 f.sidebar.scrollTop=600;viewport.writes.length=0;
 const group=f.sidebar.firstElementChild;group.replaceChildren(...[...group.children].map(button=>button.cloneNode(true)));
 viewport.wireButtons();f.tracker.refresh();f.tracker.update();
 assert.deepEqual(f.selected(),[0]);assert.equal(f.sidebar.scrollTop,60);assert.deepEqual(viewport.writes,[60]);viewport.assertReadingUnchanged();
});

test('a smaller window keeps the unchanged current subsection visible',async t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{items:[{offset:250,height:40},{offset:620,height:40}]});
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();assert.equal(f.sidebar.scrollTop,0);
 viewport.setHeight(100);f.dom.window.dispatchEvent(new f.dom.window.Event('resize'));
 await new Promise(resolve=>f.dom.window.requestAnimationFrame(resolve));
 assert.deepEqual(f.selected(),[0]);assert.equal(f.sidebar.scrollTop,190);viewport.assertReadingUnchanged();
});

test('collapsed directories, image pauses and destroyed readers cannot cause unwanted following',t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{items:[{offset:620,height:40},{offset:900,height:40}]});
 const group=f.sidebar.firstElementChild;group.hidden=true;f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
 assert.deepEqual(f.selected(),[0]);assert.equal(group.hidden,true);assert.deepEqual(viewport.writes,[]);
 group.hidden=false;f.tracker.update();assert.equal(f.sidebar.scrollTop,260);
 f.pause(true);f.setTops([-400,170]);f.tracker.update();assert.deepEqual(f.selected(),[0]);assert.equal(f.sidebar.scrollTop,260);
 f.pause(false);f.tracker.update();assert.deepEqual(f.selected(),[1]);assert.equal(f.sidebar.scrollTop,540);
 f.tracker.destroy();viewport.writes.length=0;f.setTops([160,600]);f.tracker.update();
 assert.deepEqual(viewport.writes,[]);viewport.assertReadingUnchanged();
});

test('directory disclosure clicks schedule following and all event listeners are removed on exit',async t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{items:[{offset:620,height:40},{offset:900,height:40}]}),win=f.dom.window,group=f.sidebar.firstElementChild;
 const click=async()=>{f.sidebar.dispatchEvent(new win.Event('click',{bubbles:true}));await new Promise(resolve=>win.requestAnimationFrame(resolve));};
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();assert.equal(f.sidebar.scrollTop,260);
 group.hidden=true;await click();f.sidebar.scrollTop=0;viewport.writes.length=0;
 group.hidden=false;await click();assert.equal(f.sidebar.scrollTop,260);viewport.assertReadingUnchanged();
 f.tracker.destroy();let queued=0;win.requestAnimationFrame=()=>{queued++;return 1;};
 win.dispatchEvent(new win.Event('scroll'));win.dispatchEvent(new win.Event('resize'));
 f.sidebar.dispatchEvent(new win.Event('click',{bubbles:true}));f.content.dispatchEvent(new win.Event('load'));
 assert.equal(queued,0);
});

test('an offscreen, empty or non-scrollable directory never pulls the page back',t=>{
 for(const options of [{top:-600},{top:900},{height:0},{scrollHeight:400}]){
  const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{...options,items:[{offset:620,height:40},{offset:900,height:40}]});
  f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
  assert.deepEqual(f.selected(),[0]);assert.deepEqual(viewport.writes,[]);viewport.assertReadingUnchanged();
 }
});

test('a partially offscreen phone directory keeps the current item below the fixed site header',t=>{
 for(const height of [220,120]){
  const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{top:-60,height,initialScroll:100,items:[{offset:150,height:40},{offset:620,height:40}]});
  const header=f.dom.window.document.createElement('header');header.id='site-header';header.getBoundingClientRect=()=>({top:0,bottom:64,height:64});f.dom.window.document.body.prepend(header);
  f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
  if(height===220){const item=f.sidebar.querySelector('[aria-current="location"]').getBoundingClientRect();assert.equal(f.sidebar.scrollTop,27);assert(item.top>=64&&item.bottom<=161);}
  else{assert.equal(f.sidebar.scrollTop,100);assert.deepEqual(viewport.writes,[]);}
  viewport.assertReadingUnchanged();
 }
});

test('a long directory title shows its beginning and stays stable through repeated resizes',async t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{items:[{offset:620,height:600},{offset:1300,height:40}]});
 f.setTops([160,600]);f.tracker.refresh();f.tracker.update();assert.equal(f.sidebar.scrollTop,620);
 viewport.writes.length=0;
 for(let i=0;i<2;i++){
  f.dom.window.dispatchEvent(new f.dom.window.Event('resize'));
  await new Promise(resolve=>f.dom.window.requestAnimationFrame(resolve));
 }
 assert.equal(f.sidebar.scrollTop,620);assert.deepEqual(viewport.writes,[]);viewport.assertReadingUnchanged();
});

test('following stays within both ends of the directory scroll range',t=>{
 for(const {offset,initialScroll,expected} of [{offset:-20,initialScroll:80,expected:0},{offset:1800,initialScroll:0,expected:1200}]){
  const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f,{initialScroll,items:[{offset,height:40},{offset:1900,height:40}]});
  f.setTops([160,600]);f.tracker.refresh();f.tracker.update();
  assert.equal(f.sidebar.scrollTop,expected);viewport.assertReadingUnchanged();
 }
});

test('legacy subsection anchors and resumed unloaded headings receive the same directory following',t=>{
 const legacy=fixture();closeFixture(t,legacy);const legacyViewport=directoryViewport(legacy);
 [...legacy.sidebar.querySelectorAll('button')].forEach((button,index)=>{button.removeAttribute('data-section-heading');button.dataset.sectionAnchor=`section-${index}`;});
 legacyViewport.wireButtons();legacy.setChapter({id:'chapter'});legacy.setTops([-400,170]);legacy.tracker.refresh();legacy.tracker.update();
 assert.equal(legacy.sidebar.querySelector('[aria-current="location"]').dataset.sectionAnchor,'section-1');assert.equal(legacy.sidebar.scrollTop,260);legacyViewport.assertReadingUnchanged();
 const resumed=fixture({firstPart:2,headings:[{block:'a',offset:0,part:0},{block:'b',offset:0,part:4}],html:'<div data-book-block="middle" data-book-offset="1000"><p>续读段落</p></div>'});
 closeFixture(t,resumed);const resumedViewport=directoryViewport(resumed,{items:[{offset:620,height:40},{offset:900,height:40}]});
 resumed.tracker.refresh();resumed.tracker.update();assert.deepEqual(resumed.selected(),[0]);assert.equal(resumed.sidebar.scrollTop,260);resumedViewport.assertReadingUnchanged();
});

test('opening a later chapter keeps its chapter entry visible before the first subsection',t=>{
 const f=fixture();closeFixture(t,f);const viewport=directoryViewport(f),button=f.dom.window.document.createElement('button');
 button.dataset.sectionChapter='chapter';button.setAttribute('aria-current','page');f.sidebar.prepend(button);
 button.getBoundingClientRect=()=>({top:1027-f.sidebar.scrollTop,bottom:1067-f.sidebar.scrollTop,height:40});
 button.scrollIntoView=()=>assert.fail('chapter following must not move ancestor containers');
 f.tracker.refresh();f.tracker.update();assert.deepEqual(f.selected(),[]);assert.equal(f.sidebar.scrollTop,540);
 assert.equal(button.getAttribute('aria-current'),'page');viewport.assertReadingUnchanged();
});
