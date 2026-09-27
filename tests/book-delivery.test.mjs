import test from 'node:test';
import assert from 'node:assert/strict';
import {bookManifest,bookPart} from '../server/book-delivery.mjs';
import {publicPage} from '../server/content-delivery.mjs';
const body='<section data-book-chapter="chapter-one" data-book-title="第一章"><p data-book-block="paragraph-one">'+ '正文内容'.repeat(8000)+'</p></section><section data-book-chapter="chapter-two" data-book-title="第二章"><p data-book-block="paragraph-two">后续章节</p></section>';
const item={id:'test-book',recordId:'book-record',title:'一本书',bodyHTML:body};
test('chapter outline includes headings in unloaded fragments and stable jump anchors',()=>{
 const book={title:'教程',bodyHTML:`<section data-book-chapter="guide" data-book-title="教程"><h2 data-book-block="start">开始</h2><p>${'正文'.repeat(18000)}</p><h3 data-book-block="later">后面的小节</h3><p>内容</p><h4 data-book-block="detail">细节</h4></section>`};
 const chapter=bookManifest(book).chapters[0];
 assert.deepEqual(chapter.headings.map(h=>[h.title,h.level]),[['开始',2],['后面的小节',3],['细节',4]]);
 const later=chapter.headings[1];assert.equal(later.block,'later');assert.equal(later.offset,0);
 const target=bookPart(book,{chapter:'guide',...later});assert(target.part>0);assert(target.html.includes('后面的小节'));
 assert.equal(later.part,target.part);assert.equal(chapter.headings[0].part,0);
 assert.deepEqual(bookManifest(item).chapters[0].headings,[]);
});
test('nested and repeated subsection titles keep distinct source anchors',()=>{
 const book={title:'目录',bodyHTML:'<section data-book-chapter="a" data-book-title="章"><div data-book-block="nested"><p>前文</p><h3>相同标题</h3><p>中间</p><h4>相同标题</h4></div></section>'};
 const headings=bookManifest(book).chapters[0].headings;
 assert.deepEqual(headings.map(h=>[h.block,h.offset]),[['nested',2],['nested',8]]);
 assert.equal(bookPart(book,{chapter:'a',...headings[1]}).relocated,false);
});
test('book manifest omits text; long chapters are bounded; stable anchors survive earlier edits',()=>{
 const manifest=bookManifest(item);
 assert.equal(manifest.chapters.length,2);
 assert(!JSON.stringify(manifest).includes('正文内容'));
 assert(manifest.chapters[0].parts>1);
 const part=bookPart(item,{chapter:'chapter-one',part:0});
 assert(part.html.length<16000);
 const anchored=bookPart(item,{chapter:'chapter-one',block:'paragraph-one',offset:18000});
 assert(anchored.part>0);
 const edited={...item,bodyHTML:body.replace('<p data-book-block="paragraph-one">','<p data-book-block="new">新增文字</p><p data-book-block="paragraph-one">')};
 assert(bookPart(edited,{chapter:'chapter-one',block:'paragraph-one',offset:18000}).html.includes('paragraph-one'));
 assert.throws(()=>bookPart(item,{chapter:'missing'}),{status:404});
});
test('public resources send metadata and only the requested book fragment, with withdrawal checked',()=>{
 const data={'resource-center':[item]};
 const detail=publicPage(data,new URLSearchParams({view:'detail',kind:'resource-center',id:item.id}));
 assert(!detail.item.bodyHTML);assert.equal(detail.item.book.chapters.length,2);
 const params=new URLSearchParams({view:'book-part',kind:'resource-center',id:item.id,chapter:'chapter-two'});
 assert(publicPage(data,params).html.includes('后续章节'));
 assert.throws(()=>publicPage({'resource-center':[]},params),{status:404});
});

test('invalid fragment indices cannot cause a server error and legacy whitespace does not create an empty chapter',()=>{
 for(const part of ['0.5','-4','Infinity','NaN','bad']) {
  const fragment=bookPart(item,{chapter:'chapter-one',part});
  assert(Number.isInteger(fragment.part));assert(fragment.html.length>0);
 }
 const legacy={title:'旧教程',bodyHTML:'\n  <h2>第一章</h2><p>内容</p>\n<h2>第二章</h2><p>续写</p>'};
 assert.deepEqual(bookManifest(legacy).chapters.map(c=>c.title),['第一章','第二章']);
});
