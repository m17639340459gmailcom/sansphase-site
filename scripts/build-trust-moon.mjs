// Writes the four approved permission-level badges and their provenance records.
// Run after changing scripts/trust-moon.ts: node scripts/build-trust-moon.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {trustMoonSVG} from './trust-moon.ts';
import {communityLevels} from '../src/community-rules.ts';

const directory='public/assets/community/levels';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const motifs=['thin crescent in a single-rim diamond','half moon, inlaid light line','gibbous moon with one circling light, double rail','full moon with a halo and two circling lights, glowing tip plates'];

export async function buildTrustMoon(){
  const trustIcons=[];
  for(let level=0;level<4;level++){
    const slug=`trust-l${level}`,file=`${slug}.svg`,svg=trustMoonSVG(level);
    await writeFile(`${directory}/${file}`,svg);
    trustIcons.push({level,slug,file,kind:'original-vector',title:communityLevels[level].name,titleEn:communityLevels[level].en,motif:motifs[level],sha256:digest(svg),bytes:Buffer.byteLength(svg),generator:'scripts/build-trust-moon.mjs',design:'scripts/trust-moon.ts',origin:'Drawn for this project with AI assistance at the owner\'s direction; no third-party artwork, fonts or bitmaps.',approvedAt:'2026-10-06'});
  }
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));
  sources.trustIcons=trustIcons;
  await writeFile(`${directory}/sources.json`,JSON.stringify(sources,null,2)+'\n');
  console.log(`Built four permission-level badges (${trustIcons.reduce((sum,item)=>sum+item.bytes,0)} bytes).`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildTrustMoon();
