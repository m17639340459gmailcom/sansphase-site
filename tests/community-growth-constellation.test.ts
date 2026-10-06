import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {growthConstellationSVG} from '../scripts/growth-constellation.ts';
import {communityGrowthLevels} from '../src/community-growth.ts';

const directory='public/assets/community/levels';
const parse=(svg:string)=>new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
const prismOnly=['rip','run2','ray0','au0','orbitr','nova'];

test('ten published medallions are reproducible from the generator',async()=>{
  for(let grade=1;grade<=10;grade++){
    const svg=await readFile(`${directory}/constellation-g${grade}.svg`,'utf8');
    assert.equal(svg,growthConstellationSVG(grade),`G${grade} must be rebuilt with scripts/build-growth-constellation.mjs, not edited by hand`);
  }
});

test('every medallion is a self-contained vector: no scripts, links, bitmaps or external resources',()=>{
  for(let grade=1;grade<=10;grade++){
    const svg=growthConstellationSVG(grade),doc=parse(svg);
    assert.equal(doc.documentElement.getAttribute('viewBox'),'0 0 200 200');
    assert.equal(doc.documentElement.getAttribute('aria-label'),`G${grade} ${communityGrowthLevels[grade-1].name}`);
    assert.equal(doc.querySelectorAll('script,foreignObject,a,image,use,iframe,text').length,0,'no executable, linked, raster or textual content inside the artwork');
    assert.doesNotMatch(svg,/https?:\/\/(?!www\.w3\.org\/2000\/svg")|url\((?!#)/,'only same-document references');
    assert.doesNotMatch(svg,/\son[a-z]+=/i,'no inline event handlers');
    for(const node of doc.querySelectorAll('[id]'))assert.ok(node.id.startsWith(`g${grade}`),'ids are namespaced per grade');
    assert.ok(Buffer.byteLength(svg)<64*1024,`G${grade} stays below 64 KiB`);
  }
});

test('animated medallions provide a reduced-motion rule and only loop CSS animations',()=>{
  for(let grade=1;grade<=10;grade++){
    const doc=parse(growthConstellationSVG(grade)),style=doc.querySelector('style')?.textContent??'';
    assert.match(style,/@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}/);
    assert.equal(doc.querySelectorAll('animate,animateTransform,animateMotion,set').length,0,'motion is CSS-only so the reduced-motion rule covers all of it');
    assert.doesNotMatch(style,/animation:[^;}]*\b(?!infinite)\d+(?=\s*[;}])/,'no finite iteration counts');
  }
});

test('G1–G7 each carry their own motif motion and a seven-slot rank track lit to their grade',()=>{
  const origins=new Set<string>();
  for(let grade=1;grade<=7;grade++){
    const svg=growthConstellationSVG(grade),doc=parse(svg),style=doc.querySelector('style')!.textContent!;
    assert.equal(doc.querySelectorAll('.motif').length,1);
    const motif=style.match(/@keyframes motif\{(.+)\}\n/)![1];
    origins.add(motif);
    const empty=doc.querySelectorAll('path[fill="#070b16"]').length;
    assert.equal(empty,7-grade,'unlit rank slots');
    assert.equal(doc.querySelectorAll(`#g${grade}j`).length,1,'grade jewel colour');
    for(const name of prismOnly)assert.equal(doc.querySelectorAll(`.${name}`).length,0,`G${grade} must not use prism-tier effect .${name}`);
    assert.equal(doc.querySelector(`#g${grade}p,#g${grade}bp,#g${grade}ry`),null,'no prism inlay, enamel backplate or light rays below G8');
  }
  assert.equal(origins.size,7,'seven distinct motif animations');
});

test('G8–G10 alone use prism, comets and ripples, and strengthen with rank',()=>{
  const count=(grade:number,selector:string)=>parse(growthConstellationSVG(grade)).querySelectorAll(selector).length;
  for(const grade of [8,9,10]){
    assert.equal(count(grade,`#g${grade}p`),1);assert.equal(count(grade,`#g${grade}bp`),1);
    assert.equal(count(grade,'.motif'),0);assert.equal(count(grade,'path[fill="#070b16"]'),0,'rank track is replaced by the backplate');
  }
  assert.deepEqual([8,9,10].map(grade=>count(grade,'.rip')),[1,2,3]);
  assert.deepEqual([8,9,10].map(grade=>count(grade,'.ray0,.ray1')),[0,1,2]);
  assert.deepEqual([8,9,10].map(grade=>count(grade,'.run2')/4),[0,1,2],'tilted rings: two strokes on each of the back and front halves');
  assert.deepEqual([8,9,10].map(grade=>count(grade,'.nova')),[0,0,1],'supernova pulse is reserved for the top grade');
  const speed=(grade:number)=>Number(parse(growthConstellationSVG(grade)).querySelector('style')!.textContent!.match(/\.spin\{[^}]*animation:spin ([\d.]+)s/)![1]);
  assert.ok(speed(8)>speed(9)&&speed(9)>speed(10),'higher grades run faster');
  assert.ok(speed(7)>speed(8),'G7 stays calmer than G8');
});

test('the generator clamps invalid grades like the shared growth definition',()=>{
  assert.equal(growthConstellationSVG(0),growthConstellationSVG(1));
  assert.equal(growthConstellationSVG(99),growthConstellationSVG(10));
  assert.equal(growthConstellationSVG(NaN),growthConstellationSVG(1));
});
