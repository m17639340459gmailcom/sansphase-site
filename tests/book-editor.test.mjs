import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {BookBlockIdentity,mountBookEditor} from '../src/book-editor.ts';
import {validateArticle} from '../server/author-service.ts';
import {cleanBody} from '../server/content-service.ts';
test('chapter edits, reordering and stable paragraph identities survive publication sanitization',()=>{
 const dom=new JSDOM('<main><div class="author-editor-wrap"><div id="editor"></div></div></main>',{pretendToBeVisual:true});
 for(const key of ['window','document','Node','HTMLElement','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])globalThis[key]=dom.window[key];
 const editor=new Editor({element:document.querySelector('#editor'),extensions:[StarterKit,Image,BookBlockIdentity],content:'<p></p>'});
 const book=mountBookEditor(document.querySelector('main'),editor,'<section data-book-chapter="one" data-book-title="起点"><p data-book-block="stable">原文</p></section><section data-book-chapter="two" data-book-title="后来"><p>第二章</p></section>');
 editor.commands.insertContentAt(2,'补充');
 const select=document.querySelector('select');select.value='1';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 editor.commands.insertContentAt(2,'续写');
 editor.commands.undo();assert.equal(editor.getText(),'第二章');
 editor.commands.redo();assert(editor.getText().includes('续写'));
 document.querySelector('select').value='0';document.querySelector('select').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 editor.commands.undo();assert.equal(editor.getText(),'原文');
 editor.commands.redo();assert(editor.getText().includes('补充'));
 document.querySelector('select').value='1';document.querySelector('select').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert(editor.getText().includes('续写'));assert(!editor.getText().includes('补充'));
 document.querySelector('[data-book-edit="up"]').click();
 const html=book.serialize();assert(html.indexOf('two')<html.indexOf('one'));assert(html.includes('补充'));assert(html.includes('续写'));assert(html.includes('data-book-block="stable"'));
 const data=validateArticle({title:'书',slug:'book',body:html},'resource-center');
 const publicHTML=cleanBody(data.body,'https://example.test',new Set());
 assert(publicHTML.includes('data-book-chapter="one"'));assert(publicHTML.includes('data-book-block="stable"'));assert(publicHTML.includes('data-book-title="起点"'));
 editor.destroy();dom.window.close();
});

test('new and deleted chapters cannot inherit another chapter undo history; preview follows chapter and title',()=>{
 const dom=new JSDOM('<main><div class="author-editor-wrap"><div id="editor"></div></div></main>',{pretendToBeVisual:true});
 for(const key of ['window','document','Node','HTMLElement','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])globalThis[key]=dom.window[key];
 const editor=new Editor({element:document.querySelector('#editor'),extensions:[StarterKit,Image,BookBlockIdentity],content:'<p></p>'});
 let shown,changed=0,renamed=0;
 const book=mountBookEditor(document.querySelector('main'),editor,'<section data-book-chapter="one" data-book-title="章一"><p>原文</p></section>',{
  onChapterChange:chapter=>{shown={title:chapter.title,body:editor.getText()};changed++;},
  onTitleChange:chapter=>{shown={title:chapter.title,body:editor.getText()};renamed++;},
 });
 editor.commands.insertContentAt(2,'补充');
 document.querySelector('[data-book-edit="add"]').click();
 assert.equal(editor.getText(),'');assert.equal(editor.commands.undo(),false);assert.equal(shown.body,'');
 editor.commands.insertContent('新章节正文');
 const title=document.querySelector('[data-book-chapter-title]');title.value='续写';title.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(book.title,'续写');assert.deepEqual(shown,{title:'续写',body:'新章节正文'});assert.equal(changed,2);assert.equal(renamed,1);
 document.querySelector('[data-book-edit="remove"]').click();
 assert.equal(shown.title,'章一');assert(editor.getText().includes('补充'));
 editor.commands.undo();assert.equal(editor.getText(),'原文');assert(!book.serialize().includes('新章节正文'));
 editor.destroy();dom.window.close();
});
