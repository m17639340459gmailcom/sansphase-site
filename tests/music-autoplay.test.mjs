import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicAutoplay} from '../src/music-autoplay.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(){const listeners=new Map();return {hidden:false,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},emit(name,extra={}){for(const fn of listeners.get(name)||[])fn({type:name,isTrusted:true,target:{closest:()=>false},...extra});}};}
test('music waits for scene readiness and never retries after an intentional pause',async()=>{
 const doc=environment();let calls=0;const auto=createMusicAutoplay({document:doc,play:()=>{calls++;return Promise.resolve();}});
 auto.update({enabled:true,ready:false});doc.emit('click');assert.equal(calls,0);
 auto.update({enabled:true,ready:true});await tick();assert.equal(calls,1);
 auto.cancel();doc.emit('click');auto.update({enabled:true,ready:true});await tick();assert.equal(calls,1);auto.dispose();
});
test('blocked autoplay retries on a real general gesture, without competing with music controls',async()=>{
 const doc=environment();let calls=0,blocked=0;
 const auto=createMusicAutoplay({document:doc,play:()=>++calls===1?Promise.reject(Object.assign(new Error(),{name:'NotAllowedError'})):Promise.resolve(),onBlocked:()=>blocked++});
 auto.update({enabled:true,ready:true});await tick();assert.equal(blocked,1);
 doc.emit('click',{isTrusted:false});doc.emit('click',{target:{closest:()=>true}});assert.equal(calls,1);
 doc.emit('pointerup');await tick();assert.equal(calls,2);doc.emit('click');assert.equal(calls,2);auto.dispose();
});
test('disabled, hidden and disposed players do not start audio',async()=>{
 const doc=environment();let calls=0;const auto=createMusicAutoplay({document:doc,play:()=>{calls++;}});
 auto.update({enabled:false,ready:true});doc.emit('click');assert.equal(calls,0);
 doc.hidden=true;auto.update({enabled:true,ready:true});assert.equal(calls,0);
 doc.hidden=false;doc.emit('visibilitychange');await tick();assert.equal(calls,1);
 auto.dispose();doc.emit('click');auto.update({enabled:true,ready:true});assert.equal(calls,1);
});
test('cancelling a pending blocked play cannot arm a later gesture restart',async()=>{
 const doc=environment();let reject,calls=0,blocked=0;const auto=createMusicAutoplay({document:doc,play:()=>{calls++;return new Promise((_,r)=>reject=r);},onBlocked:()=>blocked++});
 auto.update({enabled:true,ready:true});auto.cancel();reject({name:'NotAllowedError'});await tick();doc.emit('click');assert.equal(calls,1);assert.equal(blocked,0);auto.dispose();
});
