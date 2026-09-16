import {createReadStream} from 'node:fs';
import {PassThrough,Readable} from 'node:stream';
import {request as httpRequest} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import {fileHash} from '../server/file-hash.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { getPayload } from "payload";
import sharp from "sharp";
import { makePayloadConfig } from "../server/payload/config.mjs";
import { createPayloadStore } from "../server/payload/store.mjs";
import { createAuthorService } from "../server/author-service.mjs";
import { createContentService } from "../server/content-service.mjs";
import { createPreviewServer } from "../server.mjs";

test(
  "Payload backend: complete author and visitor workflows in an isolated database",
  { timeout: process.env.TEST_GB_UPLOAD ? 1800000 : 120000 },
  async (t) => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "sansphase-payload-test-"),
    );
    const authorId = randomUUID(),
      password = randomBytes(24).toString("hex"),
      email = "owner@example.test";
    const payload = await getPayload({
      config: makePayloadConfig({
        directory,
        secret: randomBytes(48).toString("hex"),
        push: true,
      }),
    });
    let server,
      cookie = "",
      origin;
    try {
      await payload.create({
        collection: "authors",
        data: {
          id: authorId,
          email,
          password,
          first_name: "作者",
          role: "owner",
        },
      });
      await payload.create({
        collection: "site_profile",
        data: {
          name: "原作者",
          signature: "原个签",
          bio: "原简介",
          social_links: [],
        },
      });
      const store = createPayloadStore(payload, { directory, authorId });
      const contentService = createContentService({
        url: "http://127.0.0.1:8055",
        store,
      });
      server = createPreviewServer({ contentService });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      await new Promise((r) => server.close(r));
      origin = `http://127.0.0.1:${port}`;
      const authorService = createAuthorService({
        url: "http://127.0.0.1:8055",
        siteOrigin: origin,
        authorId,
        store,
      });
      server = createPreviewServer({ contentService, authorService });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
      async function req(
        path,
        method = "GET",
        body,
        expected = 200,
        headers = {},
      ) {
        const response = await fetch(origin + "/api/author/" + path, {
          method,
          headers: {
            Cookie: cookie,
            ...(method !== "GET"
              ? {
                  Origin: origin,
                  "X-Author-Request": "1",
                  ...(body instanceof FormData
                    ? {}
                    : { "Content-Type": "application/json" }),
                }
              : {}),
            ...headers,
          },
          body:
            body === undefined
              ? undefined
              : body instanceof FormData
                ? body
                : JSON.stringify(body),
        });
        assert.equal(
          response.status,
          expected,
          `${method} ${path}: ${await response.clone().text()}`,
        );
        return response;
      }
      const json = async (...args) => (await req(...args)).json();
      let image, attachment, article;
      const values = {
        title: "测试文章",
        slug: "test-article",
        summary: "摘要",
        category: "教程",
        tags: ["测试"],
        body: "<h2>标题</h2><p>正文</p>",
        attachments: [],
      };
      await t.test("authentication, owner access and CSRF", async () => {
        await req("content/articles", "GET", undefined, 401);
        await req("login", "POST", { email, password }, 403, {
          Origin: "https://untrusted.example",
        });
        await req("login", "POST", { email, password: "wrong" }, 401);
        const login = await req("login", "POST", { email, password });
        const header = login.headers.getSetCookie()[0];
        assert.match(header, /HttpOnly/);
        assert.match(header, /SameSite=Strict/);
        cookie = header.split(";")[0];
        assert.equal((await json("session")).name, "作者");
        await assert.rejects(
          payload.find({ collection: "articles", overrideAccess: false }),
          { status: 403 },
        );
        const httpsService = createAuthorService({
          url: origin,
          siteOrigin: "https://site.test",
          authorId,
          store,
        });
        assert(httpsService);
      });
      await t.test(
        "uploads, original downloads and draft media isolation",
        async () => {
          const bytes = await sharp({
            create: { width: 8, height: 8, channels: 3, background: "#4488aa" },
          })
            .png()
            .toBuffer();
          const form = new FormData();
          form.set(
            "file",
            new Blob([bytes], { type: "image/png" }),
            "封面.png",
          );
          form.set("purpose", "background");
          image = await json("upload", "POST", form);
          const other = new FormData();
          other.set(
            "file",
            new Blob(["附件正文"], { type: "text/plain" }),
            "附件.txt",
          );
          attachment = await json("upload", "POST", other);
          assert.equal(
            await (await req("media/" + attachment.id)).text(),
            "附件正文",
          );
          assert.equal(
            (await fetch(origin + "/api/media/" + image.id)).status,
            404,
          );
          assert.equal(
            (await json("profile")).background_library[0].id,
            image.id,
          );
          values.cover = image.id;
          values.attachments = [attachment.id];
          values.body += `<img src="/api/author/media/${image.id}"><p><span style="color:#25a3ff">彩色</span></p><script>alert(1)</script>`;
        },
      );
      await t.test(
        "draft, preview, publish, pending edits, conflict and unpublish",
        async () => {
          article = await json("content/articles", "POST", {
            ...values,
            action: "draft",
          });
          assert.equal((await contentService.snapshot()).data.notes.length, 0);
          await assert.rejects(contentService.preview(article.id), {
            status: 401,
          });
          const preview = await contentService.preview(article.id, cookie);
          assert.equal(preview.note.attachments.length, 1);
          assert(preview.media.has(image.id));
          assert.match(preview.note.bodyHTML, /#25a3ff/);
          assert.doesNotMatch(preview.note.bodyHTML, /<script/);
          assert.match(
            (await json("content/articles/" + article.id)).body,
            /\/api\/author\/media\//,
          );
          article = await json("content/articles/" + article.id, "PATCH", {
            ...values,
            action: "publish",
            expectedUpdated: article.date_updated,
          });
          assert.equal((await contentService.snapshot()).data.notes.length, 1);
          assert.equal(
            (await fetch(origin + "/api/media/" + image.id)).status,
            200,
          );
          await req(
            "content/articles/" + article.id,
            "PATCH",
            { ...values, action: "publish", expectedUpdated: "old" },
            409,
          );
          await json("content/articles/" + article.id, "PATCH", {
            ...values,
            title: "未发布修改",
            action: "draft",
          });
          assert.equal(
            (await contentService.snapshot()).data.notes[0].title,
            values.title,
          );
          assert.equal(
            (await contentService.preview(article.id, cookie)).note.title,
            "未发布修改",
          );
          assert.equal((await json("content/articles"))[0].hasDraft, true);
          await json("content/articles/" + article.id, "PATCH", {
            action: "unpublish",
          });
          assert.equal((await contentService.snapshot()).data.notes.length, 0);
          assert.equal(
            (await fetch(origin + "/api/media/" + attachment.id)).status,
            404,
          );
          await req(
            "content/articles",
            "POST",
            { ...values, action: "publish" },
            400,
          );
        },
      );
      await t.test(
        "announcement optional link and poster; resource/software downloads",
        async () => {
          const ann = await json("content/announcements", "POST", {
            title: "公告",
            summary: "说明",
            image: image.id,
            link: "",
            sort: 1,
            action: "publish",
          });
          assert.equal(
            (await contentService.snapshot()).data.announcements[0].link,
            "",
          );
          assert.equal((await json("content/announcements"))[0].id, ann.id);
          for (const kind of ["works", "resources", "software", "resource-center"]) {
            const item = await json("content/" + kind, "POST", {
              ...values,
              slug: kind,
              file: attachment.id,
              external_url: "https://example.com/",
              action: "publish",
            });
            const dto = (await contentService.snapshot()).data[kind][0];
            assert.equal(dto.recordId, item.id);
            assert.match(dto.downloadUrl, /download=1/);
            assert.equal(
              await (await fetch(origin + dto.downloadUrl)).text(),
              "附件正文",
            );
            assert.equal((await json('content/' + kind)).some(row => row.id === item.id), true);
            const otherKind = kind === 'works' ? 'software' : 'works';
            await req(`content/${otherKind}/${item.id}`, 'GET', undefined, 404);
            await json(`content/${kind}/${item.id}`, 'PATCH', {...values, slug: kind, title: '未发布的修改', file: attachment.id, action: 'draft'});
            assert.equal((await contentService.snapshot()).data[kind][0].title, values.title);
            assert.equal((await json(`content/${kind}/${item.id}`)).title, '未发布的修改');
            await json(`content/${kind}/${item.id}`, 'PATCH', {action: 'unpublish'});
            assert.equal((await contentService.snapshot()).data[kind].length, 0);
            await json(`content/${kind}/${item.id}`, 'PATCH', {...values, slug: kind, file: attachment.id, action: 'publish'});
          }
        },
      );
      await t.test(
        "profile, theme, platform links, music and background library persistence",
        async () => {
          const before = await json("profile");
          await json("profile", "PATCH", {
            ...before,
            name: "新作者",
            avatar: image.id,
            background: image.id,
            social_links: [
              { label: "抖音", url: "https://v.douyin.com/example/" },
            ],
            music_settings: {
              title: "歌单",
              playlistUrl: "https://t1.kugou.com/1bKaRccG5V3",
              tracks: [],
            },
            appearance: {
              accentColor: "#25a3ff",
              cardColor: "#112233",
              cardOpacity: 0.1,
              cardBorderColor: "#ffffff",
              cardBorderOpacity: 0.5,
              articleTextColor: "#eeeeee",
              articleTextOpacity: 0.9,
            },
          });
          const live = (await contentService.snapshot()).data.profile;
          assert.equal(live.name, "新作者");
          assert.equal(live.appearance.cardColor, "#112233");
          assert.equal(live.appearance.articleTextColor, "#eeeeee");
          assert.equal(live.music.title, "歌单");
          assert.equal(live.socialLinks[0].label, "抖音");
          await req(
            "backgrounds",
            "POST",
            { action: "remove", id: image.id },
            409,
          );
          await json("backgrounds", "POST", { action: "default" });
          await json("backgrounds", "POST", { action: "remove", id: image.id });
          assert((await json("profile")).background_library[0].deletedAt);
          await json("backgrounds", "POST", {
            action: "restore",
            id: image.id,
          });
          await json("backgrounds", "POST", { action: "use", id: image.id });
          assert.equal((await json("profile")).background, image.id);
          const unknown = randomUUID();
          await req("profile", "PATCH", { ...before, avatar: unknown }, 404);
        },
      );
      await t.test('software installers publish as downloads and retain their bytes',async()=>{
        for(const [extension,mime] of [
          ['exe','application/vnd.microsoft.portable-executable'],['msi','application/x-msi'],
          ['apk','application/vnd.android.package-archive'],['dmg','application/x-apple-diskimage'],
          ['zip','application/zip'],['7z','application/x-7z-compressed'],
        ]) {
          const bytes=Buffer.from(`software download fixture ${extension}`);
          const data=new FormData();data.set('file',new Blob([bytes],{type:mime}),`installer.${extension}`);
          const saved=await json('upload','POST',data);
          assert.equal((await fetch(origin+'/api/media/'+saved.id)).status,404);
          await json('content/works','POST',{...values,slug:`installer-${extension}`,file:saved.id,action:'publish'});
          const downloaded=await fetch(origin+'/api/media/'+saved.id);
          assert.equal(downloaded.status,200);
          assert.match(downloaded.headers.get('content-disposition'),/^attachment/);
          assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
        }
      });
      await t.test('concurrent upload is rejected and upload slot is released after completion',async()=>{
        const slow=new PassThrough();
        slow.headers={'content-type':'multipart/form-data; boundary=slot-test','content-length':'200'};
        const token=decodeURIComponent(cookie.slice(cookie.indexOf('=')+1));
        const ready=once(slow,'resume');
        const pending=store.uploadRequest(slow,token);
        await ready;
        try {
          await assert.rejects(store.uploadRequest(new PassThrough(),token),{status:429});
        } finally {
          slow.end('--slot-test\r\nContent-Disposition: form-data; name="file"; filename="slot.txt"\r\nContent-Type: text/plain\r\n\r\nslot test\r\n--slot-test--\r\n');
          assert((await pending).id);
        }
        const data=new FormData();data.set('file',new Blob(['after slot']),'next.txt');
        assert((await json('upload','POST',data)).id);
      });
      if(process.env.TEST_GB_UPLOAD) await t.test('large upload streams to Payload and preserves checksum',async()=>{
        const bytes=Number(process.env.TEST_GB_UPLOAD)*1024**3;
        assert([1,15].includes(Number(process.env.TEST_GB_UPLOAD)));
        t.diagnostic(`Uploading and hashing ${bytes} bytes`);
        const source=resolve(directory,'large-fixture.bin');const file=await open(source,'wx');
        await file.truncate(bytes);await file.write(Buffer.from('large-start'),0,11,0);await file.write(Buffer.from('large-end'),0,9,bytes-9);await file.close();
        // A backpressured HTTP client measures the server without Node fetch's
        // multipart Blob buffering affecting the large-file memory measurement.
        const prefix=Buffer.from('--large-test\r\nContent-Disposition: form-data; name="file"; filename="installer.exe"\r\nContent-Type: application/vnd.microsoft.portable-executable\r\n\r\n');
        const suffix=Buffer.from('\r\n--large-test--\r\n');
        let peakRss=process.memoryUsage().rss;
        const monitor=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},1000);
        let result;
        try {
          let upload;
          const response=new Promise((resolve,reject)=>{
            upload=httpRequest(origin+'/api/author/upload',{method:'POST',headers:{
              Cookie:cookie,Origin:origin,'X-Author-Request':'1',
              'Content-Type':'multipart/form-data; boundary=large-test',
              'Content-Length':String(prefix.length+bytes+suffix.length),
            }},async res=>{
              try {
                const chunks=[];for await(const chunk of res) chunks.push(chunk);
                assert.equal(res.statusCode,200,Buffer.concat(chunks).toString());
                resolve(JSON.parse(Buffer.concat(chunks)));
              } catch(error){reject(error);}
            });
            upload.on('error',reject);
          });
          const sent=pipeline(Readable.from((async function*(){yield prefix;yield* createReadStream(source);yield suffix;})()),upload);
          [result]=await Promise.all([response,sent]);
        } finally {clearInterval(monitor);}
        t.diagnostic(`Peak process RSS during HTTP upload: ${Math.round(peakRss/1024**2)} MiB`);
        assert(peakRss<1024**3,'upload memory must stay below 1 GiB');
        const row=await payload.findByID({collection:'media',id:result.id});
        assert.equal(row.filesize,bytes);
        assert.equal(await fileHash(resolve(directory,'uploads',row.filename)),await fileHash(source));
      });
      await t.test('streamed uploads above 25 MB, audio publishing and byte ranges',async()=>{
        assert.equal((await json('upload')).maxFileBytes,15*1024**3);
        const large=new FormData();large.set('file',new Blob([new Uint8Array(26*1024**2).fill(23)],{type:'application/octet-stream'}),'大安装包.zip');
        const uploaded=await json('upload','POST',large);
        assert.equal((await fetch(origin+'/api/media/'+uploaded.id)).status,404);
        const resource=await json('content/resource-center','POST',{...values,slug:'large-resource',file:uploaded.id,action:'publish'});
        const partial=await fetch(origin+'/api/media/'+uploaded.id,{headers:{Range:'bytes=1024-2047'}});
        assert.equal(partial.status,206);assert.equal(partial.headers.get('content-length'),'1024');
        assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),new Uint8Array(1024).fill(23));
        const invalid=await fetch(origin+'/api/media/'+uploaded.id,{headers:{Range:'bytes=99999999999-'}});assert.equal(invalid.status,416);
        await json('content/resource-center/'+resource.id,'PATCH',{action:'unpublish'});
        assert.equal((await fetch(origin+'/api/media/'+uploaded.id,{headers:{Range:'bytes=0-8'}})).status,404);
        const sound=new FormData();sound.set('file',new Blob(['ID3-audio-test'],{type:'audio/mpeg'}),'音乐.mp3');sound.set('purpose','music');
        const track=await json('upload','POST',sound);
        const profile=await json('profile');
        await json('profile','PATCH',{...profile,music_settings:{title:'音乐',tracks:[{title:'测试',url:'/api/media/'+track.id}]}});
        const playing=await fetch(origin+'/api/media/'+track.id,{headers:{Range:'bytes=0-2'}});
        assert.equal(playing.status,206);assert.equal(await playing.text(),'ID3');assert.notEqual(playing.headers.get('content-disposition'),'attachment');
        await json('profile','PATCH',{...profile,music_settings:{tracks:[]}});
        assert.equal((await fetch(origin+'/api/media/'+track.id)).status,404);
        const hugeImage=new FormData();hugeImage.set('file',new Blob([new Uint8Array(26*1024**2)],{type:'image/png'}),'too-big.png');await req('upload','POST',hugeImage,413);
        const wrong=new FormData();wrong.set('file',new Blob(['text'],{type:'text/plain'}),'not-audio.txt');wrong.set('purpose','music');await req('upload','POST',wrong,400);
      });
      await t.test(
        "server rendered initial data and revoked sessions",
        async () => {
          const html = await (
            await fetch(origin + "/", { headers: { Cookie: cookie } })
          ).text();
          assert.match(html, /新作者/);
          assert.match(html, /id="site-content"/);
          const mediaETag = (await req('media/' + image.id + '?w=384')).headers.get('etag');
          assert(mediaETag);
          await req('media/' + image.id + '?w=384', 'GET', undefined, 304, {'If-None-Match':mediaETag});
          await json("logout", "POST", {});
          assert.equal(await json("session"), null);
          await req("content/articles", "GET", undefined, 401);
          await req('media/' + image.id + '?w=384', 'GET', undefined, 401, {'If-None-Match':mediaETag});
          await assert.rejects(contentService.preview(article.id, cookie), {
            status: 401,
          });
          await req("login", "POST", { email, password }, 200);
        },
      );
    } finally {
      if (server?.listening) await new Promise((r) => server.close(r));
      await payload.destroy();
      payload.db.client.close();
      const target = resolve(directory),
        allowed = resolve(tmpdir()) + sep;
      if (
        !target.startsWith(allowed) ||
        !target.split(sep).at(-1).startsWith("sansphase-payload-test-")
      )
        throw Error("Unexpected cleanup directory");
      // libSQL's Windows native module may retain its schema-inspection handle
      // until process exit. Keep that isolated temp directory if still locked.
      await rm(target, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 50,
      }).catch((error) => {
        if (error.code !== "EBUSY") throw error;
      });
    }
  },
);
