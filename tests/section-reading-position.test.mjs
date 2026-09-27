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
