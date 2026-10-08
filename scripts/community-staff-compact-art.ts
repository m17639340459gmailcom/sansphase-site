import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postcss from 'postcss';
import type { Declaration, Rule } from 'postcss';
import sharp from 'sharp';

/** Freeze the original initial keyframe on an in-memory copy for librsvg. */
async function staticStaffSVG(body: string): Promise<string> {
  // librsvg does not support embedded WebP images. Convert only this in-memory
  // copy to PNG so the original raster pixels and alpha render correctly.
  const images = [...new Set([...body.matchAll(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g)].map(match => match[0]))];
  for (const image of images) {
    const pixels = Buffer.from(image.slice('data:image/webp;base64,'.length), 'base64');
    const png = await sharp(pixels).png().toBuffer();
    body = body.replaceAll(image, `data:image/png;base64,${png.toString('base64')}`);
  }
  return body.replace(/<style>([\s\S]*?)<\/style>/g, (_style: string, css: string) => {
    const stylesheet = postcss.parse(css);
    const initialFrames = new Map<string, Declaration[]>();
    stylesheet.walkAtRules('keyframes', keyframes => {
      const first = keyframes.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector.split(',').some(selector => /^(?:0%|from)$/.test(selector.trim())));
      if (first) initialFrames.set(keyframes.params, first.nodes.filter((node): node is Declaration => node.type === 'decl'));
    });
    // The derivative is static in every environment; reduced-motion handling
    // remains untouched in the approved SVG used while the page is idle.
    stylesheet.walkAtRules(rule => { if (rule.name === 'keyframes' || rule.name === 'media') rule.remove(); });
    stylesheet.walkRules(rule => {
      const animation = rule.nodes.find((node): node is Declaration => node.type === 'decl' && node.prop === 'animation');
      const frame = animation ? initialFrames.get(animation.value.split(/\s+/)[0]) : undefined;
      rule.walkDecls(/^animation(?:-|$)/, declaration => { declaration.remove(); });
      // CSS animation values normally outrank inline presentation values. This
      // temporary export-only priority keeps that same baseline, especially
      // the white light layer whose initial opacity is zero rather than one.
      for (const declaration of frame ?? []) rule.append(declaration.clone({ important: true }));
    });
    return `<style>${stylesheet.toString()}</style>`;
  });
}

/** Build bounded static staff decorations in each fresh site build. */
export async function buildCompactCommunityStaffArt(root: string): Promise<void> {
  const directory = resolve(root, 'assets/community/staff');
  const destination = resolve(directory, 'compact');
  await mkdir(destination, { recursive: true });
  for (const role of ['assistant', 'moderator', 'general']) {
    for (const kind of ['badge', 'frame']) {
      const slug = `${kind}-${role}`;
      const original = await readFile(resolve(directory, `${slug}.svg`), 'utf8');
      // 256px supports the largest 88px profile avatar frame at 2×; 192px
      // covers inline emblems without repeated SVG filter/compositing work.
      const size = kind === 'frame' ? 256 : 192;
      const bytes = await sharp(Buffer.from(await staticStaffSVG(original)), { density: 144 })
        .resize(size, size).webp({ lossless: true }).toBuffer();
      await writeFile(resolve(destination, `${slug}.webp`), bytes);
    }
  }
}
