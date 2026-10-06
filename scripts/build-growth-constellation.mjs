// Writes the ten approved growth medallions and their provenance records.
// Run after changing scripts/growth-constellation.ts: node scripts/build-growth-constellation.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {growthConstellationSVG} from './growth-constellation.ts';
import {communityGrowthLevels} from '../src/community-growth.ts';

const directory='public/assets/community/levels';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const motifs=['sprout','flame','lantern','compass needle','watching eye','sail','woven net','guiding bird','river of stars','spiral sea of stars'];

export async function buildGrowthConstellation(){
  const icons=[];
  for(const {level,name,en} of communityGrowthLevels){
    const slug=`constellation-g${level}`,file=`${slug}.svg`,svg=growthConstellationSVG(level);
    await writeFile(`${directory}/${file}`,svg);
    icons.push({level,slug,file,kind:'original-vector',title:name,titleEn:en,motif:motifs[level-1],sha256:digest(svg),bytes:Buffer.byteLength(svg),generator:'scripts/build-growth-constellation.mjs',design:'scripts/growth-constellation.ts',origin:'Drawn for this project with AI assistance at the owner\'s direction; no third-party artwork, fonts or bitmaps.',approvedAt:'2026-10-06'});
  }
  const sources=JSON.parse(await readFile(`${directory}/sources.json`,'utf8'));
  sources.description='Approved constellation medallion growth sequence: ten original, self-contained animated SVG icons generated deterministically by the project. G1–G7 use one material and colour per grade with a seven-slot rank track; G8–G10 use gold with prism inlay. Motion is CSS inside each file with a reduced-motion rule; no scripts, external resources or raster images.';
  sources.approvedAt='2026-10-06';
  sources.sequence='constellation';
  sources.icons=icons;
  delete sources.motion;
  await writeFile(`${directory}/sources.json`,JSON.stringify(sources,null,2)+'\n');
  console.log(`Built ten constellation medallions (${icons.reduce((sum,item)=>sum+item.bytes,0)} bytes).`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildGrowthConstellation();
