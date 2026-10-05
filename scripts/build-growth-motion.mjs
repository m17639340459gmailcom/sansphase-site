import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {growthMotionGrades,growthMotionVector} from './growth-motion-rig.ts';

const directory='public/assets/community/levels';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const spline='0.42 0 0.58 1';
const animation=(attribute,values,duration,times='0;.25;.5;.75;1',begin='0s')=>`<animate attributeName="${attribute}" values="${values}" keyTimes="${times}" calcMode="spline" keySplines="${Array(times.split(';').length-1).fill(spline).join(';')}" dur="${duration}s" begin="${begin}" repeatCount="indefinite"/>`;

async function field(grade,phase){
  const bytes=Buffer.alloc(552*552*3);
  for(let y=0;y<552;y++)for(let x=0;x<552;x++){
    const [dx,dy]=growthMotionVector(grade,phase,x-20,y-20),offset=(y*552+x)*3;
    // The filter removes the 128/255 neutral bias before using these channels.
    bytes[offset]=Math.max(0,Math.min(255,Math.round(128+dx*255/128)));
    bytes[offset+1]=Math.max(0,Math.min(255,Math.round(128+dy*255/128)));
    bytes[offset+2]=128;
  }
  return sharp(bytes,{raw:{width:552,height:552,channels:3}}).png().toBuffer();
}

export async function growthMotionSVG(grade){
  const config=growthMotionGrades[grade];
  const original=await readFile(`${directory}/c-g${grade}-v3.webp`);
  const maps=await Promise.all([field(grade,0),field(grade,1)]);
  const primary=grade<9?animation('scale','0;128;0',config.cycle,'0;.34;1'):animation('scale','0;128;0;-128;0',config.cycle);
  const secondary=grade<9?animation('scale','0;128;0;-128;0',config.cycle,'0;.25;.5;.75;1','-.28s'):animation('scale','128;0;-128;0;128',config.cycle);
  const mapFilter=maps.map((map,index)=>`<feImage href="data:image/png;base64,${map.toString('base64')}" x="-20" y="-20" width="552" height="552" preserveAspectRatio="none" result="encoded${index}"/><feComponentTransfer in="encoded${index}" result="field${index}"><feFuncR type="linear" slope="1" intercept="-0.00196078431372549"/><feFuncG type="linear" slope="1" intercept="-0.00196078431372549"/></feComponentTransfer><feDisplacementMap in="${index?'stroke':'painted'}" in2="field${index}" xChannelSelector="R" yChannelSelector="G" scale="${index&&grade>=9?128:0}" result="${index?'alive':'stroke'}">${index?secondary:primary}</feDisplacementMap>`).join('');
  const stops=config.colours.map((colour,index)=>`<stop offset="${index/(config.colours.length-1)}" stop-color="${colour}"/>`).join('');
  const float=grade<9?'0 0;0 -2.4;0 0;0 1;0 0':'0 0;0 -1.2;0 0;0 .8;0 0';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="-20 -20 552 552">
<title>G${grade} ${config.kind==='phoenix'?'凤凰':'中国龙'} · 分级动态炫彩</title>
<desc>Original approved C artwork. Anchored wing/tail or whisker spatial motion; all colour layers follow the deformed alpha. No scripts, network resources, frame or particles.</desc>
<style>.still{display:none}.alive{isolation:isolate}@media(prefers-reduced-motion:reduce){.alive{display:none}.still{display:inline}}</style>
<defs><image id="original" href="data:image/webp;base64,${original.toString('base64')}" width="512" height="512"/>
<linearGradient id="aurora" gradientUnits="userSpaceOnUse" x1="-128" y1="0" x2="640" y2="512">${stops}<animateTransform attributeName="gradientTransform" type="translate" values="-460 0;460 0;-460 0" keyTimes="0;.5;1" calcMode="spline" keySplines="${spline};${spline}" dur="${config.flow}s" repeatCount="indefinite"/></linearGradient>
<linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="0" x2="512"><stop offset=".4" stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="#f9faff"/><stop offset=".6" stop-color="white" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="-620 0;620 0;-620 0" keyTimes="0;.5;1" calcMode="spline" keySplines="${spline};${spline}" dur="${config.flow+2}s" repeatCount="indefinite"/></linearGradient>
<rect id="shine-layer" x="0" y="0" width="512" height="512" fill="url(#shine)" opacity="${config.shineOpacity}"/>
<filter id="rig" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="-20" y="-20" width="552" height="552" color-interpolation-filters="sRGB">
<feImage href="#original" x="0" y="0" width="512" height="512" result="base"/>
<feComponentTransfer in="base" result="opaque"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>
<feBlend in="SourceGraphic" in2="opaque" mode="color" result="chromatic"/>
<feImage href="#shine-layer" x="0" y="0" width="512" height="512" result="shine"/>
<feBlend in="shine" in2="chromatic" mode="screen" result="lit"/>
<feComposite in="lit" in2="base" operator="in" result="painted"/>
${mapFilter}</filter></defs>
<g class="still"><use href="#original"/></g>
<g class="alive"><animateTransform attributeName="transform" type="translate" values="${float}" keyTimes="0;.25;.5;.75;1" calcMode="spline" keySplines="${Array(4).fill(spline).join(';')}" dur="${config.cycle}s" repeatCount="indefinite"/>
<rect x="0" y="0" width="512" height="512" fill="url(#aurora)" fill-opacity="${config.colourOpacity}" filter="url(#rig)"/></g></svg>\n`;
}

export async function buildGrowthMotion(){
  const records=[];
  for(const grade of [7,8,9,10]){
    const file=`c-g${grade}-motion-v2.svg`,svg=await growthMotionSVG(grade),config=growthMotionGrades[grade];
    await writeFile(`${directory}/${file}`,svg);
    records.push({level:grade,file,kind:'anatomical-svg-motion',sourceArtwork:`c-g${grade}-v3.webp`,sourceSha256:digest(await readFile(`${directory}/c-g${grade}-v3.webp`)),sha256:digest(svg),bytes:Buffer.byteLength(svg),cycleSeconds:config.cycle,flowSeconds:config.flow,colourOpacity:config.colourOpacity,anatomy:grade<9?'Anchored wing fold, delayed feather/tail flex':'Root-pinned whiskers, phase-offset travelling tip waves',generator:'scripts/build-growth-motion.mjs',rig:'scripts/growth-motion-rig.ts',staticFallback:'Original artwork on prefers-reduced-motion'});
  }
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));sources.motion=records;
  sources.description=sources.description.replace('G7–G10 graded colour motion is supplied separately by the website.','G7–G10 use separate self-contained animated SVG assets with anchored spatial motion and graded iridescence; original static files remain unchanged.');
  await writeFile(`${directory}/sources.json`,JSON.stringify(sources,null,2)+'\n');
  console.log(`Built four self-contained motion assets (${records.reduce((sum,item)=>sum+item.bytes,0)} bytes). Original artwork unchanged.`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildGrowthMotion();
