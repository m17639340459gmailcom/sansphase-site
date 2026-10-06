import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import postcss from 'postcss';
import {communityGrowthArtHTML} from '../src/community-growth-art.ts';
import {growthChipHTML} from '../src/community.ts';
import {communityLevelExplorerHTML} from '../src/community-level-explorer.ts';

const common={t:(zh:string)=>zh,esc:(text:unknown)=>String(text??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icons:{},members:true};
const data={balance:0,gainedToday:0,behaviourToday:0,dailyCap:6,checkedIn:true,month:{gained:0,spent:0},flow:'all' as const,ledger:[],level:1,owner:false,steward:false,stats:{},progress:{next:2,rows:[],clean:false},growth:{level:7 as const,points:0,configured:false}};

test('every grade renders its approved constellation medallion as one inert image',()=>{
 for(let grade=1;grade<=10;grade++){
  const dom=new JSDOM(communityGrowthArtHTML(grade));
  const icon=dom.window.document.querySelector<HTMLElement>('[data-growth-art]')!;
  assert.equal(icon.dataset.growthArt,String(grade));
  assert.equal(icon.dataset.levelIcon,`constellation-g${grade}`);
  assert.equal(icon.getAttribute('aria-hidden'),'true');
  assert.equal(icon.getAttribute('style'),null,'no per-element style or mask variable remains');
  assert.equal(icon.children.length,1);
  assert.equal(dom.window.document.querySelector('svg,canvas,video,button,.community-growth-art-mask'),null);
  const image=icon.querySelector('img')!;
  assert.equal(image.getAttribute('src'),`/assets/community/levels/constellation-g${grade}.svg`);
  assert.equal(image.alt,'');assert.equal(image.draggable,false);
  assert.equal(image.getAttribute('width'),image.getAttribute('height'),'square intrinsic size avoids layout shift');
  dom.window.close();
 }
});

test('shared user labels and level explorer render the same approved icon; trust stays static',()=>{
 for(const grade of [7,8,9,10] as const){
  const person={id:'reader',uid:'10001',name:'读者',role:'reader' as const,growth:{level:grade,points:0,configured:false}};
  const chip=new JSDOM(growthChipHTML(person,common));
  assert.equal(chip.window.document.querySelector('[data-growth-art]')?.getAttribute('data-growth-art'),String(grade));
  assert.match(chip.window.document.body.textContent!,new RegExp(`G${grade}`));
  const explorer=new JSDOM(communityLevelExplorerHTML({...data,growth:person.growth},common,{mode:'growth',growth:grade,trust:null}));
  assert.equal(explorer.window.document.querySelector('[data-level-preview] [data-growth-art]')?.getAttribute('data-growth-art'),String(grade));
  assert.equal(explorer.window.document.querySelector('[data-level-preview] img')?.getAttribute('src'),chip.window.document.querySelector('img')?.getAttribute('src'));
  chip.window.close();explorer.window.close();
 }
 const trust=new JSDOM(communityLevelExplorerHTML(data,common,{mode:'trust',growth:10,trust:3}));
 assert.equal(trust.window.document.querySelector('[data-growth-art]'),null);
 assert.ok(trust.window.document.querySelector('[data-level-preview] .community-trust-art'));
 trust.window.close();
 assert.equal(growthChipHTML({id:'owner',name:'作者',role:'owner',growth:{level:10,points:0,configured:false}},common),'');
});

test('art boundary clamps invalid levels and never interpolates caller input into asset URLs',()=>{
 for(const [input,expected] of [[NaN,1],[Infinity,1],[-10,1],[0,1],[100,10],[7.8,7]]){
  const dom=new JSDOM(communityGrowthArtHTML(input));
  assert.equal(dom.window.document.querySelector('[data-growth-art]')?.getAttribute('data-growth-art'),String(expected));
  dom.window.close();
 }
});

test('shared artwork styling preserves size and delegates motion to the self-contained assets',async()=>{
 const css=postcss.parse(await readFile(new URL('../src/community.css',import.meta.url),'utf8'));
 const base=css.nodes.find(node=>node.type==='rule'&&node.selectors.includes('.community-growth-art'));
 assert.ok(base&&base.type==='rule');
 assert.equal(base.nodes.find(node=>node.type==='decl'&&node.prop==='background')?.type,'decl');
 assert.equal(base.nodes.find(node=>node.type==='decl'&&node.prop==='border')?.type,'decl');
 const chip=css.nodes.find(node=>node.type==='rule'&&node.selector==='.community-growth-chip .community-growth-art');
 assert.ok(chip&&chip.type==='rule');assert.match(chip.toString(),/width:\s*20px/);assert.match(chip.toString(),/height:\s*20px/);
 assert.equal(css.nodes.filter(node=>node.type==='atrule'&&node.name==='keyframes'&&node.params.startsWith('community-growth-')).length,0);
 assert.doesNotMatch(css.toString(),/--growth-colour-opacity|\.community-growth-art::before|community-growth-art-mask|--growth-art\b/,'no stationary alpha mask or replaced motion branch remains');
});
