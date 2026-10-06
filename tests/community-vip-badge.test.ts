import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import postcss from 'postcss';
import {vipBadgeSVG} from '../scripts/vip-badge.ts';
import {vipGlyphs} from '../scripts/vip-badge-glyphs.ts';
import {communityLevelExplorerHTML} from '../src/community-level-explorer.ts';

const directory='public/assets/community/levels';
const levels=[1,2,3,4,5,6,7,8];
const parse=(svg:string)=>new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
const styleOf=(level:number)=>parse(vipBadgeSVG(level)).querySelector('style')!.textContent!;
const common={t:(zh:string)=>zh,esc:(text:unknown)=>String(text??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icons:{},members:true};
const data={balance:0,gainedToday:0,behaviourToday:0,dailyCap:6,checkedIn:true,month:{gained:0,spent:0},flow:'all' as const,ledger:[],level:1,owner:false,steward:false,stats:{},progress:{next:2,rows:[],clean:false},growth:{level:1 as const,points:0,configured:false}};

test('eight published VIP badges are reproducible and recorded with their hashes',async()=>{
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));
  assert.equal(sources.vipIcons.length,8);
  for(const level of levels){
    const file=`vip-${level}.svg`,svg=await readFile(`${directory}/${file}`,'utf8');
    assert.equal(svg,vipBadgeSVG(level),`${file} must be rebuilt with scripts/build-vip-badge.mjs, not edited by hand`);
    const record=sources.vipIcons.find((item:{file:string})=>item.file===file);
    assert.ok(record,`${file} has a provenance record`);
    assert.equal(record.level,level);assert.equal(record.kind,'original-vector');
    assert.equal(record.sha256,createHash('sha256').update(svg).digest('hex'));
    assert.equal(record.bytes,Buffer.byteLength(svg));
    assert.match(record.origin,/Noto Serif SC.*OFL/,'the outlined typeface is credited');
  }
  assert.match(await readFile('THIRD_PARTY_NOTICES.md','utf8'),/Noto Serif SC.*SIL Open Font License/);
});

test('every VIP badge is a self-contained vector with a reduced-motion rule',()=>{
  for(const level of levels){
    const svg=vipBadgeSVG(level),doc=parse(svg);
    assert.equal(doc.documentElement.getAttribute('viewBox'),'0 0 200 200');
    assert.equal(doc.documentElement.getAttribute('aria-label'),`VIP${level}`);
    assert.equal(doc.querySelectorAll('script,foreignObject,a,image,use,iframe,text').length,0,'the lettering is outlines, never live text');
    assert.doesNotMatch(svg,/https?:\/\/(?!www\.w3\.org\/2000\/svg")|url\((?!#)|font-family|@font-face|@import/,'only same-document references and no font');
    assert.doesNotMatch(svg,/\son[a-z]+=/i);
    for(const node of doc.querySelectorAll('[id]'))assert.ok(node.id.startsWith(`v${level}`),'ids are namespaced per rank');
    assert.match(styleOf(level),/@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}/);
    assert.equal(doc.querySelectorAll('animate,animateTransform,animateMotion,set').length,0);
    assert.ok(Buffer.byteLength(svg)<48*1024,`vip-${level}.svg stays under 48 KB`);
  }
  assert.equal(vipBadgeSVG(-3),vipBadgeSVG(1));
  assert.equal(vipBadgeSVG(99),vipBadgeSVG(8));
  assert.equal(vipBadgeSVG(Number.NaN),vipBadgeSVG(1));
});

test('the label is one line of outlined lettering, the same size on every rank',()=>{
  assert.deepEqual(Object.keys(vipGlyphs).sort(),['1','2','3','4','5','6','7','8','I','P','V']);
  const heights:number[]=[],labels=new Set<string>();
  for(const level of levels){
    const d=parse(vipBadgeSVG(level)).querySelector('[data-lettering]')!.getAttribute('d')!;
    const ys=[...d.matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map(match=>Number(match[1]));
    // Serif overshoot is a few tenths of a unit; two stacked rows would be at least twice the cap height.
    assert.ok(Math.max(...ys)-Math.min(...ys)<40,'VIP and the numeral sit on one line');
    heights.push(Math.max(...ys)-Math.min(...ys));
    labels.add(d);
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)<1.5,'all ranks share one cap height, give or take the overshoot of round numerals');
  assert.equal(labels.size,8,'each rank spells its own numeral');
});

test('ranks differ by construction: every frame and every low-rank ground is its own',()=>{
  const frames=new Set<string>(),grounds=new Set<string>();
  for(const level of levels){
    const doc=parse(vipBadgeSVG(level));
    frames.add(doc.querySelector('[data-frame]')!.getAttribute('d')!+(doc.querySelector('[data-frame]')!.nextElementSibling?.getAttribute('d')??'')+(doc.querySelector('[data-hot]')?.getAttribute('d')??'')+(doc.querySelector('[data-inlay]')?'inlay':''));
    const ground=doc.querySelector('[data-ground]');
    assert.equal(Boolean(ground),level<=4,'ranks 1-4 have an engraved ground; ranks 5-8 have turning rays instead');
    if(ground)grounds.add(ground.getAttribute('d')!);
    assert.equal(doc.querySelectorAll('.rays').length,level>=5?1:0);
  }
  assert.equal(frames.size,8,'no two ranks share a frame');
  assert.equal(grounds.size,4,'no two low ranks share a ground');
});

test('only ranks 5-8 are lit and reach outside the frame, more with each rank',()=>{
  const armour:number[]=[];
  for(const level of levels){
    const doc=parse(vipBadgeSVG(level)),plates=doc.querySelector('[data-armour]');
    assert.equal(Boolean(plates),level>=5,'floating armour starts at VIP5');
    assert.equal(Boolean(doc.querySelector('[data-hot]')),level>=5,'glowing frame parts start at VIP5');
    armour.push(Number(plates?.getAttribute('data-armour')??0));
    assert.equal(doc.querySelectorAll('[data-ring]').length,level===8?2:0,'only VIP8 wears the ring, drawn behind and in front');
    assert.equal(doc.querySelectorAll('.cor,.bw').length,level===8?3:0,'only VIP8 has the star and the nova');
    assert.equal(doc.querySelectorAll('.cn').length,level===7?2:0,'only VIP7 draws a constellation');
    assert.equal(doc.querySelectorAll('.rip').length,level===6?3:0,'only VIP6 ripples');
  }
  assert.deepEqual(armour,[0,0,0,0,2,6,10,14]);
});

test('VIP6-8 breathe on one shared rhythm that quickens with rank',()=>{
  const periods:number[]=[];
  for(const level of levels){
    const doc=parse(vipBadgeSVG(level)),style=styleOf(level);
    assert.equal(doc.querySelectorAll('.br').length,level>=6?1:0);
    assert.equal(/\.br\{/.test(style),level>=6,'the breathing rule is only written where it is used');
    if(level<6)continue;
    const seconds=['br','bg','bc','bh','glow'].map(name=>Number(style.match(new RegExp(`\\.${name}\\{[^}]*animation:${name} ([\\d.]+)s`))![1]));
    assert.equal(new Set(seconds).size,1,'armour, glow, core, edge and lettering glow share one period');
    assert.ok(doc.querySelector('.br [data-armour]'),'the armour opens and settles with the breath');
    assert.ok(!doc.querySelector('.br [data-frame]')&&!doc.querySelector('.br [data-lettering]'),'the frame and lettering stay still');
    periods.push(seconds[0]);
  }
  assert.deepEqual(periods,[5,4.6,4.2]);
});

test('the level page shows the badge for every VIP rank',async()=>{
  for(const level of levels){
    const dom=new JSDOM(communityLevelExplorerHTML(data,common,{mode:'vip',growth:null,trust:null,vip:level}));
    const art=dom.window.document.querySelector<HTMLElement>('[data-level-preview] [data-vip-art]')!;
    assert.equal(art.dataset.vipArt,String(level));assert.equal(art.dataset.levelIcon,`vip-${level}`);
    assert.equal(art.getAttribute('aria-hidden'),'true');assert.equal(art.getAttribute('style'),null);
    const images=[...art.querySelectorAll('img')];
    assert.deepEqual(images.map(image=>image.getAttribute('src')),[`/assets/community/levels/vip-${level}.svg`]);
    assert.ok(images.every(image=>image.alt===''&&image.draggable===false));
    assert.equal(dom.window.document.querySelector('[data-level-gallery]'),null);
    assert.equal(dom.window.document.querySelectorAll('[data-carousel-neighbour] [data-vip-art]').length,level===1||level===8?1:2);
    assert.equal(dom.window.document.querySelector(`[data-level-track] [data-level="${level}"]`)!.getAttribute('aria-pressed'),'true');
    assert.equal(dom.window.document.querySelector('.community-level-neighbour,.community-level-controls'),null);
    assert.equal(dom.window.document.querySelector('.community-vip-emblem,[data-growth-art],[data-trust-art]'),null,'no text emblem or other level art in VIP mode');
    dom.window.close();
  }
  const css=postcss.parse(await readFile(new URL('../src/community.css',import.meta.url),'utf8')).toString();
  assert.doesNotMatch(css,/\.community-vip-emblem\b/,'the superseded text emblem styles are removed');
  assert.match(css,/\.community-vip-art\b/);
});
