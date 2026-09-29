import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {enhanceContentImages,setContentHTML} from '../src/content-images.mjs';
import {cleanBody} from '../server/content-service.ts';
import {imageSourceSet} from '../src/image-sources.mjs';

test('responsive images receive measured sizes before any source is activated',()=>{
 const dom=new JSDOM('<main></main>');const root=dom.window.document.querySelector('main');
 setContentHTML(root,'<img src="/large.webp" srcset="/small.webp 384w, /large.webp 960w" width="960" height="540">');
 const img=root.querySelector('img');assert.equal(img.hasAttribute('src'),false);assert.equal(img.hasAttribute('srcset'),false);
 img.getBoundingClientRect=()=>({width:270,height:152});
 const assigned=[],set=img.setAttribute.bind(img);img.setAttribute=(key,value)=>{if(key==='src'||key==='srcset')assigned.push({key,sizes:img.sizes});set(key,value);};
 const dispose=enhanceContentImages(root);
 assert.equal(img.src,'/large.webp');assert.equal(img.sizes,'270px');assert(assigned.every(x=>x.sizes==='270px'));
 assert.deepEqual(assigned.map(x=>x.key),['srcset','src']);dispose();dom.window.close();
});

test('cropped cover requests enough pixels for its height; body uses its actual column width',()=>{
 const dom=new JSDOM('<main><img class="catalog-cover" width="1672" height="941" srcset="/image 384w"><img width="1586" height="992" srcset="/body 960w"></main>');
 const [cover,body]=dom.window.document.images;
 cover.getBoundingClientRect=()=>({width:425,height:474});body.getBoundingClientRect=()=>({width:276,height:172});
 cover.style.objectFit='cover';
 const dispose=enhanceContentImages(dom.window.document.querySelector('main'));
 assert.equal(cover.sizes,'843px');assert.equal(body.sizes,'276px');
 dispose();dom.window.close();
});

test('failed content image offers a bounded retry, recovers and cleans up on navigation',()=>{
 const dom=new JSDOM('<main><div><img src="/api/media/465bea9a-2167-4e36-ae3f-ab61260c997b?w=768" alt="封面"></div></main>',{url:'https://www.sansphase.com'});
 const d=dom.window.document,img=d.querySelector('img');
 const dispose=enhanceContentImages(d.querySelector('main'));
 img.dispatchEvent(new dom.window.Event('error'));
 const button=d.querySelector('button');assert.match(button.textContent,/重新加载/);
 button.click();assert.equal(d.querySelectorAll('button').length,1);
 img.dispatchEvent(new dom.window.Event('load'));assert.equal(d.querySelector('button'),null);
 dispose();img.dispatchEvent(new dom.window.Event('error'));assert.equal(d.querySelector('button'),null);dom.window.close();
});

test('all published body images use bounded display variants and trusted dimensions; small icons do not claim false widths',()=>{
 const id='465bea9a-2167-4e36-ae3f-ab61260c997b';const media=new Set();
 const result=cleanBody(`<p><img src="/api/media/${id}" width="99999" height="1"></p>`,'https://www.sansphase.com',media,'',{[id]:{width:256,height:256}});
 const doc=new JSDOM(result).window.document,img=doc.querySelector('img');
 assert.equal(img.width,256);assert.equal(img.height,256);assert.match(img.src,/view=content/);
 assert(!img.srcset.includes('3840w'));assert.match(img.srcset,/256w/);assert(media.has(id));
 assert.equal(imageSourceSet(`/api/media/${id}?preview=private`,256),`/api/media/${id}?preview=private&w=384 256w`);
});
