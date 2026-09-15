// Local demonstration server. No database, login service or write endpoints.
import { createPreviewServer } from '../server.mjs';
import { makeCatalogDemo } from './fixtures/catalog-data.mjs';
import { createMusicDemo } from './fixtures/music-demo.mjs';
import { notes } from '../tests/fixtures/site-data.mjs';

const music=createMusicDemo();
const data={...makeCatalogDemo(),notes,author:null,announcements:[{title:'本地预演',summary:'作品、推荐与试听音均为模拟内容，仅用于确认接入后的展示效果。'}],profile:{
  name:'無相',signature:'本地预演',bio:'此页面用于预览，模拟内容不会发布到正式网站。',socialLinks:[],music:music.settings,
}};
const server=createPreviewServer({contentService:{snapshot:async()=>({data:structuredClone(data)}),media:music.media},release:'local-catalog-and-music-preview'});
server.listen(4177,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4177/#/works'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
