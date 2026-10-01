// Local demonstration server. No content database or login service; the
// community uses a throwaway database that is removed when the preview stops.
import { createPreviewServer } from '../server.mjs';
import { makeReadingDemo } from './fixtures/reading-demo.mjs';
import { createMusicDemo } from './fixtures/music-demo.mjs';
import { createCommunityDemo } from './fixtures/community-demo.mjs';

const origin='http://127.0.0.1:4177';
const music=createMusicDemo();
const community=await createCommunityDemo();
const data={...makeReadingDemo(),author:null,announcements:[{title:'本地预演',summary:'文章、作品、推荐与试听音均为模拟内容，仅用于确认展示效果。',image:'./assets/materials/eso-triangulum.jpg'}],profile:{
  name:'無相',signature:'本地预演',bio:'此页面用于预览，模拟内容不会发布到正式网站。',socialLinks:[],music:music.settings,
}};
const server=createPreviewServer({contentService:{snapshot:async()=>({data:structuredClone(data)}),media:music.media},communityService:community.service(4177),release:'local-reading-directory-preview'});
server.listen(4177,'127.0.0.1',()=>console.log(`Local preview: ${origin}/#/notes`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{community.close();process.exit(0);}));
process.on('exit',()=>{try{community.close();}catch{}});
