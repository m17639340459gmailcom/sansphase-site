// Local demonstration server. No database, login service or write endpoints.
import { createPreviewServer } from '../server.mjs';
import { makeReadingDemo } from './fixtures/reading-demo.mjs';
import { createMusicDemo } from './fixtures/music-demo.mjs';

const music=createMusicDemo();
const data={...makeReadingDemo(),author:null,announcements:[{title:'本地预演',summary:'文章、作品、推荐与试听音均为模拟内容，仅用于确认展示效果。',image:'./assets/materials/eso-triangulum.jpg'}],profile:{
  name:'無相',signature:'本地预演',bio:'此页面用于预览，模拟内容不会发布到正式网站。',socialLinks:[],music:music.settings,
}};
const server=createPreviewServer({contentService:{snapshot:async()=>({data:structuredClone(data)}),media:music.media},release:'local-reading-directory-preview'});
server.listen(4177,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4177/#/notes'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
