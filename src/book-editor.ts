import {Extension} from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import {Plugin,EditorState} from '@tiptap/pm/state';
import {escapeHTML as esc} from './core.mjs';
const newId=()=>crypto.randomUUID();
type Chapter = {id: string; title: string; html: string};
type EditorOptions = {
 text?: (zh: string, en: string) => string;
 onDirty?: () => void;
 onChapterChange?: (chapter: Chapter) => void;
 onTitleChange?: (chapter: Chapter) => void;
 confirmDelete?: (message: string, remove: () => void) => void;
 isBusy?: () => boolean;
};
// Stable paragraph identities travel with the actual editor document, not its current page number.
export const BookBlockIdentity=Extension.create({
 name:'bookBlockIdentity',
 addGlobalAttributes(){return [{types:['paragraph','heading','blockquote','bulletList','orderedList','codeBlock','image','table'],attributes:{bookBlock:{default:null,parseHTML:el=>el.getAttribute('data-book-block'),renderHTML:attrs=>attrs.bookBlock?{'data-book-block':attrs.bookBlock}:{}}}}];},
 addProseMirrorPlugins(){return [new Plugin({appendTransaction(transactions,old,state){if(!transactions.some(t=>t.docChanged))return;const seen=new Set();const tr=state.tr;state.doc.descendants((node,pos)=>{if(!Object.hasOwn(node.attrs,'bookBlock'))return;const id=node.attrs.bookBlock;if(!id||seen.has(id)){const next=newId();tr.setNodeMarkup(pos,undefined,{...node.attrs,bookBlock:next});seen.add(next);}else seen.add(id);});return tr.docChanged?tr:null;}})];},
});
export function parseBookChapters(html: string,doc: Document=document): Chapter[] {
 const container=doc.createElement('div');container.innerHTML=html||'';
 const sections=[...container.children].filter(n=>n.matches('section[data-book-chapter]'));
 if(sections.length)return sections.map(n=>({id:(n as HTMLElement).dataset.bookChapter || newId(),title:(n as HTMLElement).dataset.bookTitle||'未命名章节',html:n.innerHTML}));
 const chapters: Chapter[]=[];
 for(const node of container.childNodes){
  if(node.nodeType===3&&!(node.textContent || '').trim())continue;
  if(node.nodeName==='H2'||!chapters.length)chapters.push({id:newId(),title:node.nodeName==='H2'?(node.textContent || ''):'第一章',html:''});
  if(node.nodeName!=='H2')chapters.at(-1)!.html+=(node.nodeType===1 ? (node as Element).outerHTML : '')||esc(node.textContent || '');
 }
 return chapters.length?chapters:[{id:newId(),title:'第一章',html:'<p></p>'}];
}
export function mountBookEditor(host: HTMLElement,editor: Editor,body: string,{text=(zh)=>zh,onDirty=()=>{},onChapterChange=()=>{},onTitleChange=()=>{},confirmDelete=(_message,remove)=>remove(),isBusy=()=>false}: EditorOptions={}) {
 const chapters=parseBookChapters(body,host.ownerDocument);let selected=0;
 const states=new Map<string, EditorState>();
 const panel=host.ownerDocument.createElement('section');panel.className='author-book-chapters';
 host.querySelector('.author-editor-wrap')!.before(panel);
 const flush=()=>{chapters[selected].html=editor.getHTML();states.set(chapters[selected].id,editor.state);};
 function load(){
  const chapter=chapters[selected];
  if(states.has(chapter.id))editor.view.updateState(states.get(chapter.id)!);
  else {
   editor.commands.setContent(chapter.html||'<p></p>',{emitUpdate:false});
   // A new chapter starts with clean history; visited chapters retain their own state.
   editor.view.updateState(EditorState.create({schema:editor.schema,doc:editor.state.doc,plugins:editor.state.plugins}));
  }
  onChapterChange(chapter);
 }
 function render(){
  panel.innerHTML=`<h3>${text('书籍章节','Book chapters')}</h3><p>${text('切换章节会保留本次编辑。完成后点击“保存草稿”或“发布”保存整本书。','Switching chapters retains your edits. Save draft or publish to save the book.')}</p><div class="author-book-select"><label>${text('选择章节','Choose chapter')}<select data-book-edit-select>${chapters.map((c,i)=>`<option value="${i}" ${i===selected?'selected':''}>${i+1}. ${esc(c.title)}</option>`).join('')}</select></label><button type="button" data-book-edit="add">＋ ${text('续写新章节','New chapter')}</button></div><label>${text('当前章节标题','Chapter title')}<input data-book-chapter-title value="${esc(chapters[selected].title)}" maxlength="160"></label><div class="author-book-edit-actions"><button type="button" data-book-edit="up" ${selected===0?'disabled':''}>↑ ${text('前移','Move up')}</button><button type="button" data-book-edit="down" ${selected===chapters.length-1?'disabled':''}>↓ ${text('后移','Move down')}</button><button type="button" data-book-edit="remove" ${chapters.length===1?'disabled':''}>${text('删除当前章','Delete chapter')}</button><span>${selected+1} / ${chapters.length}</span></div>`;
 }
 function select(index: number){flush();selected=index;load();render();}
 panel.addEventListener('input',event=>{const target=event.target as HTMLInputElement;if(target.matches('[data-book-chapter-title]')){chapters[selected].title=target.value;panel.querySelector('select')!.options[selected].textContent=`${selected+1}. ${target.value}`;onDirty();onTitleChange(chapters[selected]);}});
 panel.addEventListener('change',event=>{const target=event.target as HTMLSelectElement;if(target.matches('select')){if(isBusy()){target.value=String(selected);return;}select(Number(target.value));}});
 panel.addEventListener('click',event=>{
  const action=(event.target as HTMLElement).closest<HTMLElement>('[data-book-edit]')?.dataset.bookEdit;if(!action||isBusy())return;
  flush();
  if(action==='add'){chapters.push({id:newId(),title:text(`第 ${chapters.length+1} 章`,`Chapter ${chapters.length+1}`),html:'<p></p>'});select(chapters.length-1);onDirty();}
  if(action==='up'||action==='down'){const index=selected+(action==='up'?-1:1);if(index<0||index>=chapters.length)return;[chapters[index],chapters[selected]]=[chapters[selected],chapters[index]];selected=index;render();onDirty();}
  if(action==='remove'&&chapters.length>1)confirmDelete(text('删除当前章节？保存前可关闭编辑并放弃本次修改。','Delete this chapter? Discard the editing session before saving to undo.'),()=>{states.delete(chapters[selected].id);chapters.splice(selected,1);selected=Math.min(selected,chapters.length-1);load();render();onDirty();});
 });
 load();render();
 return {get title(){return chapters[selected].title;},serialize(){flush();if(chapters.some(c=>!c.title.trim()))throw Error(text('请填写每一章的标题。','Every chapter needs a title.'));return chapters.map(c=>`<section data-book-chapter="${esc(c.id)}" data-book-title="${esc(c.title.trim())}">${c.html}</section>`).join('');}};
}
