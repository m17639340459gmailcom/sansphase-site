import {byteRange} from '../http-range.ts';
import {withStreamUpload,uploadLimits} from '../stream-upload.mjs';
import { createLocalReq, logoutOperation } from "payload";
import { randomUUID, createHash } from "node:crypto";
import { createImageVariants } from '../image-variants.mjs';
import { createAudioVariants } from '../audio-variants.mjs';
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { basename, resolve } from "node:path";
import { isPublished, uuidPattern } from "../content-service.ts";
import { createMediaRetention } from './media-retention.mjs';
import type { Payload } from 'payload';
import type { IncomingMessage } from 'node:http';

// Payload's runtime collections share this adapter. Schema-specific fields are
// validated by Payload; the adapter keeps the dynamic field boundary here.
type CmsRecord = Record<string, any>;
type ContentCollection = 'articles' | 'announcements' | 'library_entries';
type StreamFile = {name: string; mimetype: string; size: number; tempFilePath: string; data: Buffer};

const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
const collections = new Set(["articles", "announcements", "library_entries"]);
export function createPayloadStore(payload: Payload, { directory, authorId, mediaRetention = createMediaRetention({ payload, directory }) }: {directory: string; authorId: string; mediaRetention?: ReturnType<typeof createMediaRetention>}) {
  const imageVariant = createImageVariants(directory);
  const audioVariant = createAudioVariants(directory);
  let activeUploads=0;
  async function identity(token: string | undefined) {
    if (!token) throw fail("请先登录作者账号。", 401);
    const { user } = await payload.auth({
      headers: new Headers({ Authorization: `JWT ${token}` }),
    });
    if (
      !user ||
      user.id !== authorId ||
      user.collection !== "authors" ||
      user.role !== "owner"
    )
      throw fail("请重新登录作者账号。", 401);
    return user;
  }
  const authorized = async (token: string | undefined) => ({
    user: await identity(token),
    overrideAccess: false,
  });
  async function mediaRecord(id: string) {
    if (!uuidPattern.test(id || "")) throw fail("文件不存在。", 404);
    return payload.findByID({ collection: "media", id });
  }
  async function readMedia(id: string,rangeHeader: string | undefined, imageWidth: string | number | null | undefined,{streaming=false,presentation=false}: {streaming?: boolean; presentation?: boolean}={}) {
    // Internal only: callers must authorize the owner or check published references first.
    const row = await mediaRecord(id);
    if (!row.filename || basename(row.filename) !== row.filename)
      throw fail("文件不存在。", 404);
    const original = resolve(directory, "uploads", row.filename);
    const variant = await imageVariant(original, imageWidth, row.mimeType || '',presentation);
    const audio = streaming ? await audioVariant(original,row.mimeType || '') : null;
    const path = variant || audio || original;
    const info = await stat(path);
    const size = info.size;
    const etag = '"' + createHash('sha256').update(`${path}:${size}:${info.mtimeMs}`).digest('hex') + '"';
    const range=byteRange(rangeHeader,size);
    if(range===false) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Content-Length':'0'}});
    return new Response(Readable.toWeb(createReadStream(path,range||undefined)) as ReadableStream, {
      status:range?206:200,
      headers: {
        "Content-Type": variant ? 'image/webp' : audio ? 'audio/mpeg' : row.mimeType || "application/octet-stream",
        "ETag": etag,
        "Content-Length": String(range?range.end-range.start+1:size),
        'Accept-Ranges':'bytes',
        ...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${size}`}:{ }),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName || row.filename)}`,
      },
    });
  }
  const fileDTO = (row: CmsRecord | null) =>
    row && {
      id: row.id,
      title: row.title,
      filename_download: row.originalName || row.filename,
      type: row.mimeType,
      filesize: row.filesize,
    };
  async function hydrate(row: CmsRecord) {
    const ids = new Set([row.cover, row.showcase_cover, ...String(row.body || '').matchAll(/\/(?:assets|api\/media)\/([0-9a-f-]{36})/gi)].map(value=>Array.isArray(value)?value[1]:value).filter(id=>uuidPattern.test(id || '')));
    const imageDimensions: Record<string, {width: number; height: number}> = {};
    await Promise.all([...ids].map(async id=>{
      try {
        const file = await mediaRecord(id);
        if(file.width > 0 && file.height > 0) imageDimensions[id] = {width:file.width,height:file.height};
      } catch(error) {if((error as {status?: number}).status !== 404) throw error;}
    }));
    return {
      ...row,
      imageDimensions,
      attachments: await Promise.all(
        (row.attachments || []).map(async (item: CmsRecord) => ({
          id: item.id,
          directus_files_id: fileDTO(
            await mediaRecord(
              item.directus_files_id?.id || item.directus_files_id,
            ),
          ),
        })),
      ),
      ...(row.file ? { file: fileDTO(await mediaRecord(row.file)) } : {}),
    };
  }
  async function profile(token: string | undefined) {
    const result = await payload.find({
      collection: "site_profile",
      limit: 1,
      ...(await authorized(token)),
    });
    if (!result.docs[0]) throw fail("作者资料不存在。", 404);
    return result.docs[0];
  }
  async function validateFiles(data: CmsRecord) {
    const ids = [
      data.cover,
      data.showcase_cover,
      data.file,
      data.image,
      data.avatar,
      data.background,
    ];
    const attachments = Array.isArray(data.attachments)
      ? data.attachments
      : data.attachments?.create || [];
    for (const item of attachments)
      ids.push(
        typeof item === "string"
          ? item
          : item.directus_files_id?.id || item.directus_files_id,
      );
    for (const item of data.background_library || []) ids.push(item.id);
    for (const track of data.music_settings?.tracks || []) if(track.url.startsWith('/api/media/')) {
      const audio=await mediaRecord(track.url.split('/').at(-1));
      if(!audio.mimeType?.startsWith('audio/')) throw fail('本站播放列表只能选择音频文件。');
    }
    for (const id of new Set(ids.filter(Boolean))) await mediaRecord(id);
    if (data.pending_content) await validateFiles(data.pending_content);
  }
  return {
    mediaPrefix: "/api/media",
    uploadLimits,
    async uploadRequest(req: IncomingMessage,token: string | undefined) {
      const auth=await authorized(token);
      // One upload, including Payload's final copy, at a time on this single-
      // process server: two 15 GiB uploads must not reserve the same disk space.
      if(activeUploads>=1) throw fail('已有文件正在上传，请等待完成后再上传下一个。',429);
      activeUploads++;
      try { return await withStreamUpload(req,directory,async(file: StreamFile,fields: CmsRecord)=>{
        if(fields.purpose==='background' && !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.mimetype)) throw fail('背景请选择图片。');
        if(fields.purpose==='music' && !/^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|wave|x-wav|flac|webm)$/.test(file.mimetype)) throw fail('请选择 MP3、M4A、OGG、WAV 或 FLAC 音频。');
        const saved=await payload.create({collection:'media',data:{title:file.name,originalName:file.name},file,...auth});
        if(fields.purpose==='music' && saved.filename && basename(saved.filename)===saved.filename)
          await audioVariant(resolve(directory,'uploads',saved.filename),saved.mimeType || '');
        return {...fileDTO(saved),purpose:fields.purpose};
      }); } finally {activeUploads--;}
    },
    identity,
    async login(data: {email: string; password: string}) {
      try {
        const result = await payload.login({ collection: "authors", data });
        if (!result.token) throw fail("账号或密码不正确，或账号暂时锁定。", 401);
        await identity(result.token);
        return result.token;
      } catch {
        throw fail("账号或密码不正确，或账号暂时锁定。", 401);
      }
    },
    async logout(token: string | undefined) {
      const user = await identity(token);
      await logoutOperation({
        collection: payload.collections.authors,
        req: await createLocalReq({ user }, payload),
      });
    },
    async get(collection: string, id: string, token: string | undefined) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      return payload.findByID({ collection: collection as ContentCollection, id, ...(await authorized(token)) });
    },
    async list(collection: string, { kind, sort }: {kind?: string; sort?: string | string[]}, token: string | undefined) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      return (
        await payload.find({
          collection: collection as ContentCollection,
          pagination: false,
          sort,
          where: kind ? { kind: { equals: kind } } : undefined,
          ...(await authorized(token)),
        })
      ).docs;
    },
    async remove(collection: string,id: string,expectedUpdated: string | number,token: string | undefined) {
      if(!collections.has(collection)||!uuidPattern.test(id))throw fail('内容不存在。',404);
      const auth = await authorized(token);
      const current = await payload.findByID({ collection: collection as ContentCollection, id, ...auth });
      await mediaRetention.queueFromDeleted(current);
      const versions = await payload.findVersions({ collection: collection as ContentCollection, where: { parent: { equals: id } }, pagination: false, depth: 0, ...auth });
      for (const version of versions.docs) await mediaRetention.queueFromDeleted(version);
      const result=await payload.delete({collection: collection as ContentCollection,where:{and:[
        {id:{equals:id}},{updatedAt:{equals:expectedUpdated}},
      ]},...auth});
      if(result.errors?.length)throw fail('删除失败，请稍后重试。',503);
      if(result.docs.length!==1)throw fail('内容已在其他窗口修改，请重新打开后编辑。',409);
      mediaRetention.queueVersions(collection, id);
      const remaining = await payload.findVersions({ collection: collection as ContentCollection, where: { parent: { equals: id } }, limit: 1, depth: 0, ...auth });
      if (remaining.totalDocs) await payload.db.deleteVersions({ collection: collection as ContentCollection, where: { parent: { equals: id } } });
      const afterCleanup = await payload.findVersions({ collection: collection as ContentCollection, where: { parent: { equals: id } }, limit: 1, depth: 0, ...auth });
      if (afterCleanup.totalDocs) throw fail('内容已删除，但历史版本清理失败；请联系管理员检查。', 503);
      await mediaRetention.sweepVersions();
      await mediaRetention.sweep();
    },
    async save(collection: string, id: string | undefined, values: CmsRecord, token: string | undefined) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      const auth = await authorized(token);
      await validateFiles(values);
      const data: CmsRecord = { ...values, date_updated: new Date().toISOString() };
      if (!id) data.date_created = data.date_updated;
      if (data.attachments)
        data.attachments = (
          Array.isArray(data.attachments)
            ? data.attachments
            : data.attachments.create || []
        ).map((item: string | CmsRecord) => ({
          id: (typeof item === 'string' ? undefined : item.id) || randomUUID(),
          directus_files_id:
            typeof item === "string" ? item : item.directus_files_id,
        }));
      try {
        return id
          ? await payload.update({ collection: collection as ContentCollection, id, data, ...auth })
          : await payload.create({ collection: collection as ContentCollection, data, ...auth });
      } catch (error) {
        const failure = error as {status?: number; name?: string; data?: {errors?: Array<{path: string}>}};
        if (failure.status === 400 || failure.name === "ValidationError") {
          const fields = new Set((Array.isArray(failure.data?.errors) ? failure.data.errors : []).map(field => field.path));
          if (fields.has('body'))
            throw fail('正文校验未通过，请检查正文长度与格式。');
          if (fields.has('slug'))
            throw fail('网址名称不可用，可能已被其他内容使用，请换一个后重试。');
          throw fail("保存失败，请检查网址名称是否重复以及必填内容。");
        }
        throw error;
      }
    },
    profile,
    async saveProfile(data: CmsRecord, token: string | undefined) {
      const row = await profile(token);
      await validateFiles(data);
      return payload.update({
        collection: "site_profile",
        id: row.id,
        data,
        ...(await authorized(token)),
      });
    },
    async upload(form: FormData, token: string | undefined) {
      const auth = await authorized(token),
        file = form.get("file") as File | null;
      if (!file || typeof file.arrayBuffer !== "function")
        throw fail("请选择文件。");
      const data = Buffer.from(await file.arrayBuffer());
      if (data.length > 25 * 1024 * 1024)
        throw fail("文件太大，最多上传 25 MB。", 413);
      const saved = await payload.create({
        collection: "media",
        data: {
          title: String(form.get("title") || file.name),
          originalName: file.name,
        },
        file: {
          data,
          name: file.name,
          mimetype: file.type || "application/octet-stream",
          size: data.length,
        },
        ...auth,
      });
      return fileDTO(saved);
    },
    async media(id: string, token: string | undefined, imageWidth?: string | number | null) {
      await identity(token);
      return readMedia(id, undefined, imageWidth);
    },
    readMedia,
    async publicData() {
      const snapshotStartedAt=Date.now();
      // Fixed server-side queries. Never expose arbitrary Local API access to visitors.
      const [articles, profile, announcements, library] = await Promise.all([
        payload.find({
          collection: "articles",
          where: { status: { equals: "published" } },
          sort: ["-published_at", "-date_created"],
          pagination: false,
        }),
        payload.find({ collection: "site_profile", limit: 1 }),
        payload.find({
          collection: "announcements",
          where: { status: { equals: "published" } },
          sort: "sort",
          pagination: false,
        }),
        payload.find({
          collection: "library_entries",
          where: { status: { equals: "published" } },
          sort: ["-published_at", "date_created"],
          pagination: false,
        }),
      ]);
      return [
        await Promise.all(
          articles.docs.filter((row) => isPublished(row as unknown as {status: string; published_at?: string})).map(hydrate),
        ),
        profile.docs[0],
        announcements.docs,
        await Promise.all(
          library.docs.filter((row) => isPublished(row as unknown as {status: string; published_at?: string})).map(hydrate),
        ),
        Math.min(Infinity,...[...articles.docs,...library.docs]
          .filter(row=>row.status==='published')
          .map(row=>Date.parse(row.published_at)).filter(time=>time>snapshotStartedAt)),
      ];
    },
    async preview(id: string, cookie: string, kind='articles') {
      if(!['articles','resource-center'].includes(kind))throw Object.assign(new Error('Invalid preview kind'),{status:400});
      const token = cookie
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("sansphase_author_session="))
        ?.split("=")
        .slice(1)
        .join("=");
      const row = await payload.findByID({
        collection: kind==='articles'?'articles':'library_entries',
        id,
        ...(await authorized(token)),
      });
      if(kind==='resource-center'&&row.kind!==kind)throw Object.assign(new Error('Not found'),{status:404});
      const draft = { ...row, ...row.pending_content };
      if (row.pending_content?.attachments)
        draft.attachments = row.pending_content.attachments.map((id: string) => ({
          directus_files_id: id,
        }));
      return hydrate(draft);
    },
  };
}
