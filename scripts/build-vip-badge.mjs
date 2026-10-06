// Writes the eight approved VIP badges and their provenance records.
// Run after changing scripts/vip-badge.ts: node scripts/build-vip-badge.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {vipBadgeSVG,vipBadgeTiers} from './vip-badge.ts';

const directory='public/assets/community/levels';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const motifs=['single rim over nested hexagons','inlaid light line over a rosette','corner plates over honeycomb','side clasps on a double rail over fine rays','two-colour frame, glowing corners, turning dial; plates off the top and bottom corners','open bracket frame, halo and ripples; a plate off every corner; breathing','self-drawing constellation and an orbiting ring of light; stepped side plates; breathing','star with a turning corona and a nova; second plate layer and a ring around the whole badge; breathing'];

export async function buildVipBadges(){
  const vipIcons=[];
  for(let level=1;level<=8;level++){
    const slug=`vip-${level}`,file=`${slug}.svg`,svg=vipBadgeSVG(level);
    await writeFile(`${directory}/${file}`,svg);
    vipIcons.push({level,slug,file,kind:'original-vector',title:`VIP${level}`,colour:vipBadgeTiers[level-1].name,motif:motifs[level-1],sha256:digest(svg),bytes:Buffer.byteLength(svg),generator:'scripts/build-vip-badge.mjs',design:'scripts/vip-badge.ts',lettering:'scripts/vip-badge-glyphs.ts',origin:'Drawn for this project with AI assistance at the owner\'s direction; no third-party artwork or bitmaps. The lettering is Noto Serif SC Black (SIL OFL 1.1) converted to outlines; no font is loaded.',approvedAt:'2026-10-06'});
  }
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));
  sources.vipIcons=vipIcons;
  await writeFile(`${directory}/sources.json`,JSON.stringify(sources,null,2)+'\n');
  console.log(`Built eight VIP badges (${vipIcons.reduce((sum,item)=>sum+item.bytes,0)} bytes).`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildVipBadges();
