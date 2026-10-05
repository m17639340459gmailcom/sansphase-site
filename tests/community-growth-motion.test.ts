import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import sharp from 'sharp';
import {growthMotionGrades, growthMotionVector} from '../scripts/growth-motion-rig.ts';
import {growthMotionSVG} from '../scripts/build-growth-motion.mjs';
import {communityGrowthArtHTML} from '../src/community-growth-art.ts';

test('phoenix wings move at the tips while neck and shoulders stay pinned',()=>{
  for(const grade of [7,8] as const){
    const neck=grade===7?[338,158]:[275,159];
    assert.deepEqual(growthMotionVector(grade,0,neck[0],neck[1]),[0,0]);
    const tip=growthMotionVector(grade,0,grade===7?123:121,35);
    assert.ok(Math.hypot(...tip)>18,'wing stroke must visibly move the wing tip');
    assert.ok(Math.hypot(...growthMotionVector(grade,1,220,440))>1,'tail follows the wings');
  }
});

test('Chinese dragon whisker waves increase towards the tips without deforming the face',()=>{
  for(const grade of [9,10] as const){
    const face=grade===9?[365,257]:[257,276];
    assert.deepEqual(growthMotionVector(grade,0,face[0],face[1]),[0,0]);
    const root=grade===9?[465,314]:[190,337];
    assert.ok(Math.hypot(...growthMotionVector(grade,0,root[0],root[1]))<.1);
    const tip=grade===9?[414,203]:[16,317];
    assert.ok(Math.hypot(...growthMotionVector(grade,0,tip[0],tip[1]))>5);
    assert.notDeepEqual(growthMotionVector(grade,0,tip[0],tip[1]),growthMotionVector(grade,1,tip[0],tip[1]),'wave phases must differ');
  }
  const left=growthMotionVector(10,0,16,317),right=growthMotionVector(10,0,496,317);
  assert.notDeepEqual(left,right,'whiskers must not swing mechanically in lockstep');
});

test('four motion assets embed approved artwork, loop without scripts and fall back to the original',async()=>{
  for(const grade of [7,8,9,10] as const){
    const original=await readFile(`public/assets/community/levels/c-g${grade}-v3.webp`);
    const svg=await readFile(`public/assets/community/levels/c-g${grade}-motion-v2.svg`,'utf8');
    assert.equal(svg,await growthMotionSVG(grade),'published animation must be reproducible from the rig');
    const doc=new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
    assert.equal(doc.querySelectorAll('script,foreignObject,a').length,0);
    assert.equal(doc.querySelectorAll('[href^="https:"],[href^="http:"]').length,0);
    assert.match(doc.querySelector('#original')!.getAttribute('href')!,/^data:image\/webp;base64,/);
    const embedded=Buffer.from(doc.querySelector('#original')!.getAttribute('href')!.split(',')[1],'base64');
    assert.equal(createHash('sha256').update(embedded).digest('hex'),createHash('sha256').update(original).digest('hex'));
    assert.equal(doc.querySelectorAll('feDisplacementMap').length,2);
    assert.equal(doc.querySelectorAll('feTurbulence').length,0,'anatomical motion must not be random ripples');
    assert.match(doc.querySelector('style')!.textContent!,/prefers-reduced-motion/);
    for(const animation of doc.querySelectorAll('animate,animateTransform')){
      const values=animation.getAttribute('values')!.split(';');
      assert.equal(values[0],values.at(-1),'every loop must return to the same state');
      assert.equal(animation.getAttribute('repeatCount'),'indefinite');
    }
    assert.ok(doc.querySelector('.still use[href="#original"]'));
    assert.ok(doc.querySelector('feBlend[mode="color"]'),'iridescence preserves original luminance');
    assert.ok(doc.querySelector('feComposite[in="lit"][in2="base"][operator="in"]'),'colour and shine use the artwork alpha before deformation');
    assert.equal(doc.querySelector('.alive rect')!.getAttribute('opacity'),null,'iridescence must not fade the entire character');
    assert.equal(Number(doc.querySelector('.alive rect')!.getAttribute('fill-opacity')),growthMotionGrades[grade].colourOpacity);
    if(grade<9)assert.equal(doc.querySelector('feDisplacementMap animate')!.getAttribute('keyTimes'),'0;.34;1','downstroke is faster than recovery');
    for(const map of doc.querySelectorAll('feImage[result^="encoded"]')){
      const bytes=Buffer.from(map.getAttribute('href')!.split(',')[1],'base64');
      const meta=await sharp(bytes).metadata();assert.equal(meta.width,552);assert.equal(meta.height,552);
    }
    const html=new JSDOM(communityGrowthArtHTML(grade)).window.document;
    assert.equal(html.querySelector('img')!.getAttribute('src'),`/assets/community/levels/c-g${grade}-motion-v2.svg`);
    assert.equal(html.querySelector('[data-growth-rig]')!.getAttribute('data-growth-rig'),grade<9?'phoenix':'dragon');
  }
});

test('motion grades retain controlled strokes and increasing iridescent strength',()=>{
  assert.equal(growthMotionGrades[7].cycle,3.6);assert.equal(growthMotionGrades[8].cycle,3.2);
  const strengths=[7,8,9,10].map(grade=>growthMotionGrades[grade as 7|8|9|10].colourOpacity);
  assert.ok(strengths.every((value,index)=>value<=.72&&(index===0||value>strengths[index-1])));
});
