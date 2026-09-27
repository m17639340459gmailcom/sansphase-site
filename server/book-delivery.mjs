import {parseDocument} from 'htmlparser2';
import render from 'dom-serializer';
import {createHash} from 'node:crypto';
const cache=new WeakMap();
const text=node=>node.type==='text'?node.data:(node.children||[]).map(text).join('');
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const failure=()=>Object.assign(new Error('Book content not found'),{status:404});
// Slice text without losing inline marks or links. Images/tables remain atomic.
function slice(node,start,end,cursor={value:0}) {
 if(node.type==='text') {const from=cursor.value;cursor.value+=node.data.length;return escape(node.data.slice(Math.max(0,start-from),Math.max(0,end-from)));}
 if(!node.name)return '';
 const inside=(node.children||[]).map(child=>slice(child,start,end,cursor)).join('');
 if(!inside)return node.name==='br'&&cursor.value>=start&&cursor.value<end?'<br>':'';
 const attrs=Object.entries(node.attribs||{}).filter(([k])=>!k.startsWith('data-book')).map(([k,v])=>` ${k}="${escape(v)}"`).join('');
 return `<${node.name}${attrs}>${inside}</${node.name}>`;
}
function model(item) {
 if(cache.has(item))return cache.get(item);
 const nodes=parseDocument(item.bodyHTML||'<p></p>').children;
 const explicit=nodes.filter(n=>n.name==='section'&&n.attribs?.['data-book-chapter']);
 let chapters=[];
 if(explicit.length) chapters=explicit.map(n=>({id:n.attribs['data-book-chapter'],title:n.attribs['data-book-title']||'未命名章节',nodes:n.children}));
 else {
  for(const node of nodes) {
   if(node.type==='comment'||(node.type==='text'&&!node.data.trim()))continue;
   if(node.name==='h2'||!chapters.length) chapters.push({id:'chapter-'+digest(node.name==='h2'?text(node):'body'),title:node.name==='h2'?text(node):item.title,nodes:[]});
   if(node.name!=='h2')chapters.at(-1).nodes.push(node);
  }
 }
 if(!chapters.length)chapters=[{id:'chapter-body',title:item.title,nodes:[]}];
 const seenChapters=new Set();
 for(const [index,chapter] of chapters.entries()) {
  if(seenChapters.has(chapter.id))chapter.id+='-'+index;
  seenChapters.add(chapter.id);
  const fragments=[],headings=[];let current=[],length=0;const used=new Set();
  for(const [i,node] of chapter.nodes.entries()) {
   if(node.type==='text'&&!node.data.trim())continue;
   let id=node.attribs?.['data-book-block']||'block-'+digest(render(node));
   if(used.has(id))id+='-'+i;used.add(id);
   let headingOffset=0;
   function collectHeadings(element){
    if(element.type==='text'){headingOffset+=element.data.length;return;}
    if(/^h[2-4]$/.test(element.name)&&text(element).trim())headings.push({title:text(element).trim(),level:Number(element.name[1]),block:id,offset:headingOffset});
    for(const child of element.children||[])collectHeadings(child);
   }
   collectHeadings(node);
   const value=text(node);const atomic=!['p','h1','h2','h3','h4','blockquote','pre'].includes(node.name)||render(node).includes('<img');
   const step=atomic?Math.max(1,value.length):1000;
   for(let offset=0;offset<Math.max(1,value.length);) {
    let end=Math.min(value.length,offset+step);
    if(!atomic&&end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
    end=Math.max(offset+1,end);
    const content=atomic?render(node):slice(node,offset,end);
    const html=`<div class="book-block" data-book-block="${escape(id)}" data-book-offset="${offset}">${content}</div>`;
    if(current.length&&(length+html.length>12000||current.length>=12)){fragments.push(current);current=[];length=0;}
    current.push({id,offset,end,html});length+=html.length;offset=end;
   }
  }
  if(current.length||!fragments.length)fragments.push(current);
  // Expose each heading's fragment so a resumed reader can highlight a heading
  // preceding the loaded text without requesting earlier chapter fragments.
  const headingsByBlock=new Map();
  for(const heading of headings){if(!headingsByBlock.has(heading.block))headingsByBlock.set(heading.block,[]);headingsByBlock.get(heading.block).push(heading);}
  fragments.forEach((fragment,part)=>{for(const block of fragment)for(const heading of headingsByBlock.get(block.id)||[])if(heading.offset>=block.offset&&heading.offset<block.end)heading.part=part;});
  chapter.fragments=fragments;chapter.headings=headings;delete chapter.nodes;
 }
 const result={revision:digest(item.bodyHTML||''),chapters};cache.set(item,result);return result;
}
export function bookManifest(item) {
 const {revision,chapters}=model(item);
 return {revision,chapters:chapters.map(c=>({id:c.id,title:c.title,parts:c.fragments.length,headings:c.headings}))};
}
export function bookPart(item,{chapter:chapterId,part=0,block,offset=0}={}) {
 const {revision,chapters}=model(item);const chapter=chapters.find(c=>c.id===chapterId);
 if(!chapter)throw failure();
 const requested=Number(part);
 let index=Math.min(chapter.fragments.length-1,Math.max(0,Number.isFinite(requested)?Math.floor(requested):0));
 let relocated=false;
 if(block){
  const located=chapter.fragments.findIndex(f=>f.some(b=>b.id===block&&b.offset<=Number(offset)&&b.end>Number(offset)));
  if(located>=0)index=located;
  else {const fallback=chapter.fragments.findIndex(f=>f.some(b=>b.id===block));index=Math.max(0,fallback);relocated=true;}
 }
 return {revision,chapter:chapter.id,title:chapter.title,part:index,parts:chapter.fragments.length,relocated,html:chapter.fragments[index].map(b=>b.html).join('')};
}
