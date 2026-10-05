// Only images uploaded through the community API may become body image blocks.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const imagePath = new RegExp(`^/api/community/images/(${uuid})\\.webp$`);
const imageLine = new RegExp(`^\\s*!\\[[^\\]\\r\\n]{0,120}\\]\\((/api/community/images/(${uuid})\\.webp)\\)\\s*$`);
export const imageIdFromPath = (path: string) => imagePath.exec(path)?.[1] || '';
export const imageIdFromLine = (line: string) => imageLine.exec(line)?.[2] || '';
export const bodyImageMarker = (id: string) => `![图片](/api/community/images/${id}.webp)`;

export function bodyImageContent(body: string) {
  const images: string[] = [], text: string[] = [];
  let code = false;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) code = !code;
    const id = code ? '' : imageIdFromLine(line);
    if (id) images.push(id);
    else text.push(line);
  }
  return { images: [...new Set(images)], text: text.join('\n') };
}

export function withBodyImages(body: string, images: readonly string[]) {
  const existing = new Set(bodyImageContent(body).images);
  const extra = images.filter(id => !existing.has(id)).map(bodyImageMarker);
  return [body, ...extra].filter(Boolean).join('\n\n');
}
