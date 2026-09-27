import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookProgress} from '../src/book-progress.mjs';
test('resume and multiple bookmarks persist independently for each book',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const one=createBookProgress(storage,'one');const a={chapter:'c',block:'p',offset:24,title:'章节'};
 one.save(a);one.toggle(a);one.toggle({...a,offset:200});
 assert.equal(createBookProgress(storage,'one').value.progress.offset,24);
 assert.equal(createBookProgress(storage,'one').value.bookmarks.length,2);
 assert.equal(createBookProgress(storage,'two').value.progress,null);
 one.toggle(a);assert.equal(one.value.bookmarks.length,1);
});
test('corrupt or unavailable storage does not break reading',()=>{
 const s=createBookProgress({getItem:()=>'{broken',setItem:()=>{throw Error('quota');}},'x');
 s.save({chapter:'c',block:'b',offset:0});assert.equal(s.available,false);assert.equal(s.value.progress.chapter,'c');
});
