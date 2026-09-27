import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountNavigationPrefetch} from '../src/navigation-prefetch.mjs';
test('intent prefetch is bounded, collection-only and paused during homepage preparation',async()=>{
 const dom=new JSDOM('<nav id="navigation"><a href="#/notes">Blog</a><a href="#/software">Software</a><a href="#/note/private">Post</a></nav>',{url:'https://example.com/#/home',pretendToBeVisual:true});
 const {document}=dom.window;const calls=[];let enabled=false,time=0;
 const clean=mountNavigationPrefetch(document,{prefetch:async q=>calls.push(q.toString())},{enabled:()=>enabled,now:()=>time,delay:0});
 const links=document.querySelectorAll('a');
 const intent=async index=>{links[index].dispatchEvent(new dom.window.Event('pointerover',{bubbles:true}));await new Promise(r=>setTimeout(r,5));};
 await intent(0);assert.equal(calls.length,0);
 enabled=true;await intent(0);assert.equal(calls.length,1);
 await intent(1);assert.equal(calls.length,1);
 time=2000;await intent(2);assert.equal(calls.length,1);
 for(let i=1;i<=8;i++){time=i*2000;await intent(i%2);}
 assert.equal(calls.length,5);assert(calls.every(q=>q.includes('view=list')));
 clean();time=70000;await intent(0);assert.equal(calls.length,5);dom.window.close();
});
