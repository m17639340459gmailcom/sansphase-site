import {byteRange} from '../http-range.mjs';
import {withStreamUpload,uploadLimits} from '../stream-upload.mjs';
import { createLocalReq, logoutOperation } from "payload";
import { randomUUID, createHash } from "node:crypto";
import { createImageVariants } from '../image-variants.mjs';
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { basename, resolve } from "node:path";
import { isPublished, uuidPattern } from "../content-service.mjs";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const collections = new Set(["articles", "announcements", "library_entries"]);
export function createPayloadStore(payload, { directory, authorId }) {
  const imageVariant = createImageVariants(directory);
  let activeUploads=0;
  async function identity(token) {
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
  const authorized = async (token) => ({
    user: await identity(token),
    overrideAccess: false,
  });
  async function mediaRecord(id) {
    if (!uuidPattern.test(id || "")) throw fail("文件不存在。", 404);
    return payload.findByID({ collection: "media", id });
  }
  async function readMedia(id,rangeHeader, imageWidth) {
    // Internal only: callers must authorize the owner or check published references first.
    const row = await mediaRecord(id);
    if (!row.filename || basename(row.filename) !== row.filename)
      throw fail("文件不存在。", 404);
    const original = resolve(directory, "uploads", row.filename);
    const variant = await imageVariant(original, imageWidth, row.mimeType || '');
    const path = variant || original;
    const info = await stat(path);
    const size = info.size;
    const etag = '"' + createHash('sha256').update(`${path}:${size}:${info.mtimeMs}`).digest('hex') + '"';
    const range=byteRange(rangeHeader,size);
    if(range===false) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Content-Length':'0'}});
    return new Response(Readable.toWeb(createReadStream(path,range||undefined)), {
      status:range?206:200,
      headers: {
        "Content-Type": variant ? 'image/webp' : row.mimeType || "application/octet-stream",
        "ETag": etag,
        "Content-Length": String(range?range.end-range.start+1:size),
        'Accept-Ranges':'bytes',
        ...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${size}`}:{ }),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName || row.filename)}`,
      },
    });
  }
  const fileDTO = (row) =>
    row && {
      id: row.id,
      title: row.title,
      filename_download: row.originalName || row.filename,
      type: row.mimeType,
      filesize: row.filesize,
    };
  async function hydrate(row) {
    return {
      ...row,
      attachments: await Promise.all(
        (row.attachments || []).map(async (item) => ({
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
  async function profile(token) {
    const result = await payload.find({
      collection: "site_profile",
      limit: 1,
      ...(await authorized(token)),
    });
    if (!result.docs[0]) throw fail("作者资料不存在。", 404);
    return result.docs[0];
  }
  async function validateFiles(data) {
    const ids = [
      data.cover,
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
    async uploadRequest(req,token) {
      const auth=await authorized(token);
      // One upload, including Payload's final copy, at a time on this single-
      // process server: two 15 GiB uploads must not reserve the same disk space.
      if(activeUploads>=1) throw fail('已有文件正在上传，请等待完成后再上传下一个。',429);
      activeUploads++;
      try { return await withStreamUpload(req,directory,async(file,fields)=>{
        if(fields.purpose==='background' && !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.mimetype)) throw fail('背景请选择图片。');
        if(fields.purpose==='music' && !/^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|wave|x-wav|flac|webm)$/.test(file.mimetype)) throw fail('请选择 MP3、M4A、OGG、WAV 或 FLAC 音频。');
        const saved=await payload.create({collection:'media',data:{title:file.name,originalName:file.name},file,...auth});
        return {...fileDTO(saved),purpose:fields.purpose};
      }); } finally {activeUploads--;}
    },
    identity,
    async login(data) {
      try {
        const result = await payload.login({ collection: "authors", data });
        await identity(result.token);
        return result.token;
      } catch {
        throw fail("账号或密码不正确，或账号暂时锁定。", 401);
      }
    },
    async logout(token) {
      const user = await identity(token);
      await logoutOperation({
        collection: payload.collections.authors,
        req: await createLocalReq({ user }, payload),
      });
    },
    async get(collection, id, token) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      return payload.findByID({ collection, id, ...(await authorized(token)) });
    },
    async list(collection, { kind, sort }, token) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      return (
        await payload.find({
          collection,
          pagination: false,
          sort,
          where: kind ? { kind: { equals: kind } } : undefined,
          ...(await authorized(token)),
        })
      ).docs;
    },
    async save(collection, id, values, token) {
      if (!collections.has(collection)) throw fail("内容不存在。", 404);
      const auth = await authorized(token);
      await validateFiles(values);
      const data = { ...values, date_updated: new Date().toISOString() };
      if (!id) data.date_created = data.date_updated;
      if (data.attachments)
        data.attachments = (
          Array.isArray(data.attachments)
            ? data.attachments
            : data.attachments.create || []
        ).map((item) => ({
          id: item.id || randomUUID(),
          directus_files_id:
            typeof item === "string" ? item : item.directus_files_id,
        }));
      try {
        return id
          ? await payload.update({ collection, id, data, ...auth })
          : await payload.create({ collection, data, ...auth });
      } catch (error) {
        if (error.status === 400 || error.name === "ValidationError")
          throw fail("保存失败，请检查网址名称是否重复以及必填内容。");
        throw error;
      }
    },
    profile,
    async saveProfile(data, token) {
      const row = await profile(token);
      await validateFiles(data);
      return payload.update({
        collection: "site_profile",
        id: row.id,
        data,
        ...(await authorized(token)),
      });
    },
    async upload(form, token) {
      const auth = await authorized(token),
        file = form.get("file");
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
    async media(id, token) {
      await identity(token);
      return readMedia(id);
    },
    readMedia,
    async publicData() {
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
          articles.docs.filter((row) => isPublished(row)).map(hydrate),
        ),
        profile.docs[0],
        announcements.docs,
        await Promise.all(
          library.docs.filter((row) => isPublished(row)).map(hydrate),
        ),
      ];
    },
    async preview(id, cookie) {
      const token = cookie
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("sansphase_author_session="))
        ?.split("=")
        .slice(1)
        .join("=");
      const row = await payload.findByID({
        collection: "articles",
        id,
        ...(await authorized(token)),
      });
      const draft = { ...row, ...row.pending_content };
      if (row.pending_content?.attachments)
        draft.attachments = row.pending_content.attachments.map((id) => ({
          directus_files_id: id,
        }));
      return hydrate(draft);
    },
  };
}
