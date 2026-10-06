import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import postcss from 'postcss';
import {trustMoonSVG,trustMoonPhases} from '../scripts/trust-moon.ts';
import {communityLevels} from '../src/community-rules.ts';
import {communityLevelExplorerHTML} from '../src/community-level-explorer.ts';

const directory='public/assets/community/levels';
const levels=[0,1,2,3];
const parse=(svg:string)=>new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
const styleOf=(level:number)=>parse(trustMoonSVG(level)).querySelector('style')!.textContent!;
const common={t:(zh:string)=>zh,esc:(text:unknown)=>String(text??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icons:{},members:true};
const data={balance:0,gainedToday:0,behaviourToday:0,dailyCap:6,checkedIn:true,month:{gained:0,spent:0},flow:'all' as const,ledger:[],level:1,owner:false,steward:false,stats:{},progress:{next:2,rows:[],clean:false},growth:{level:1 as const,points:0,configured:false}};

test('four published permission badges are reproducible and recorded with their hashes',async()=>{
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));
  assert.equal(sources.trustIcons.length,4);
  for(const level of levels){
    const file=`trust-l${level}.svg`,svg=await readFile(`${directory}/${file}`,'utf8');
    assert.equal(svg,trustMoonSVG(level),`${file} must be rebuilt with scripts/build-trust-moon.mjs, not edited by hand`);
    const record=sources.trustIcons.find((item:{file:string})=>item.file===file);
    assert.ok(record,`${file} has a provenance record`);
    assert.equal(record.level,level);assert.equal(record.kind,'original-vector');assert.equal(record.theme,undefined,'one file serves both themes');
    assert.equal(record.sha256,createHash('sha256').update(svg).digest('hex'));
    assert.equal(record.license,undefined,'project artwork is not attributed to stock artists');
    for(const old of [`trust-l${level}-dark.svg`,`trust-l${level}-light.svg`])
      await assert.rejects(readFile(`${directory}/${old}`),{code:'ENOENT'},`superseded aperture asset ${old} must not ship`);
  }
});

test('every permission badge is a self-contained vector with a reduced-motion rule',()=>{
  for(const level of levels){
    const svg=trustMoonSVG(level),doc=parse(svg);
    assert.equal(doc.documentElement.getAttribute('viewBox'),'0 0 200 200');
    assert.equal(doc.documentElement.getAttribute('aria-label'),`L${level} ${communityLevels[level].name}`);
    assert.equal(doc.querySelectorAll('script,foreignObject,a,image,use,iframe,text').length,0);
    assert.doesNotMatch(svg,/https?:\/\/(?!www\.w3\.org\/2000\/svg")|url\((?!#)|font-family|@import/,'only same-document references');
    assert.doesNotMatch(svg,/\son[a-z]+=/i);
    for(const node of doc.querySelectorAll('[id]'))assert.ok(node.id.startsWith(`t${level}`),'ids are namespaced per level');
    assert.match(styleOf(level),/@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}/);
    assert.equal(doc.querySelectorAll('animate,animateTransform,animateMotion,set').length,0);
    assert.ok(Buffer.byteLength(svg)<16*1024);
  }
  assert.equal(trustMoonSVG(-3),trustMoonSVG(0));
  assert.equal(trustMoonSVG(99),trustMoonSVG(3));
  assert.equal(trustMoonSVG(Number.NaN),trustMoonSVG(0));
});

test('the moon gains light with each level and one more tip light is lit',()=>{
  assert.deepEqual([...trustMoonPhases],[0.16,0.5,0.8,1]);
  const shapes=new Set<string>();
  for(const level of levels){
    const doc=parse(trustMoonSVG(level)),lit=doc.querySelector('[data-moon]')!;
    assert.equal(Number(lit.getAttribute('data-moon')),trustMoonPhases[level]);
    shapes.add(lit.getAttribute('d')!);
    assert.equal(doc.querySelectorAll('[data-rank="lit"]').length,level+1);
    assert.equal(doc.querySelectorAll('[data-rank="unlit"]').length,3-level);
    assert.equal(doc.querySelectorAll('[data-satellite]').length,[0,0,1,2][level],'circling lights arrive at L2 and double at L3');
    assert.equal(doc.querySelectorAll('[data-halo]').length,level===3?1:0,'only the full moon has a halo');
    assert.equal(doc.querySelector('.turn,.scan,.lock,.look,.blink'),null,'nothing of the superseded aperture or eye remains');
  }
  assert.equal(shapes.size,4,'four distinct phases');
});

test('levels differ by construction, and only light moves',()=>{
  const frames=new Set<string>(),grounds=new Set<string>(),styles=new Set<string>();
  for(const level of levels){
    const doc=parse(trustMoonSVG(level)),style=styleOf(level);
    frames.add(doc.querySelector('[data-frame]')!.getAttribute('d')!+(doc.querySelector('[data-inlay]')?'inlay':'')+(doc.querySelector('[data-hot]')?'hot':''));
    grounds.add(doc.querySelector('[data-ground]')!.getAttribute('d')!);
    styles.add(style);
    assert.equal(Boolean(doc.querySelector('[data-hot]')),level===3,'glowing tip plates belong to the top level');
    assert.equal(/\.br\{/.test(style),level===3,'only the top level breathes');
    assert.equal(/\.ob\{/.test(style),level>=2);
    assert.ok(!doc.querySelector('[class] [data-frame]')&&!doc.querySelector('.core[data-moon],.msh [data-moon]'),'the frame and the moon itself are never animated');
    assert.doesNotMatch(style.split('@media')[0],/rotate\(|scale\(/,'no part turns or pulses in size');
  }
  assert.equal(frames.size,4);assert.equal(grounds.size,4);assert.equal(styles.size,4);
});

test('the level page and nickname marks use the single-file badge on both themes',async()=>{
  for(const level of levels){
    const dom=new JSDOM(communityLevelExplorerHTML(data,common,{mode:'trust',growth:null,trust:level}));
    const art=dom.window.document.querySelector<HTMLElement>('[data-level-preview] [data-trust-art]')!;
    assert.equal(art.dataset.trustArt,String(level));assert.equal(art.dataset.levelIcon,`trust-l${level}`);
    assert.equal(art.getAttribute('aria-hidden'),'true');assert.equal(art.getAttribute('style'),null);
    const images=[...art.querySelectorAll('img')];
    assert.deepEqual(images.map(image=>[image.getAttribute('src'),image.getAttribute('data-theme')]),[[`/assets/community/levels/trust-l${level}.svg`,null]]);
    assert.ok(images.every(image=>image.alt===''&&image.draggable===false));
    assert.equal(dom.window.document.querySelector('.community-level-icon,[data-growth-art],[data-vip-art]'),null,'no other level art in permission mode');
    dom.window.close();
  }
  const css=postcss.parse(await readFile(new URL('../src/community.css',import.meta.url),'utf8')).toString();
  assert.doesNotMatch(css,/community-trust-art-image\[data-theme/,'the per-theme switch for the superseded icons is removed');
  assert.doesNotMatch(css,/\.community-level-icon\b|--level-icon\b|--level-fill\b/,'the superseded mask icon styles are removed');
});
