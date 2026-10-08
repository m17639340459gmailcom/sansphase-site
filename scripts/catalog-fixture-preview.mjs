// Local demonstration server. No content database or login service; the
// community uses a throwaway database that is removed when the preview stops.
import { createPreviewServer } from '../server.mjs';
import { makeReadingDemo } from './fixtures/reading-demo.mjs';
import { createMusicDemo } from './fixtures/music-demo.mjs';
import { createCommunityDemo } from './fixtures/community-demo.mjs';
import { createCommunityPreviewService, previewIdentityPath } from './fixtures/community-preview-identity.ts';

const port=Number(process.env.PORT || 4177);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
const origin=`http://127.0.0.1:${port}`;
const music=createMusicDemo();
const community=await createCommunityDemo({ visualDemo: true, newsDemo: process.env.COMMUNITY_NEWS_DEMO === '1' });
const data={...makeReadingDemo(),author:null,announcements:[{title:'本地预演',summary:'文章、作品、推荐与试听音均为模拟内容，仅用于确认展示效果。',image:'./assets/materials/eso-triangulum.jpg'}],profile:{
  name:'無相',signature:'本地预演',bio:'此页面用于预览，模拟内容不会发布到正式网站。',socialLinks:[],music:music.settings,
}};
const server=createPreviewServer({contentService:{snapshot:async()=>({data:structuredClone(data)}),media:music.media},communityService:createCommunityPreviewService(community.service(port),port),readerService:community.readerService(port),authorService:community.authorService,communityEnabled:true,release:'local-community-visual-demo'});
server.listen(port,'127.0.0.1',()=>console.log(`Local preview: ${origin}/#/community/home\nRole preview: ${origin}${previewIdentityPath}`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{community.close();process.exit(0);}));
process.on('exit',()=>{try{community.close();}catch{}});
