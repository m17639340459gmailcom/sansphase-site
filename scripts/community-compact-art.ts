import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

/** Build delivery derivatives of the approved community artwork in a fresh release. */
export async function buildCompactCommunityArt(root: string): Promise<void> {
  const directory = resolve(root, 'assets/community/levels');
  const destination = resolve(directory, 'compact');
  await mkdir(destination, { recursive: true });
  const slugs = [
    ...Array.from({ length: 10 }, (_, index) => `constellation-g${index + 1}`),
    ...Array.from({ length: 4 }, (_, index) => `trust-l${index}`),
    ...Array.from({ length: 8 }, (_, index) => `vip-${index + 1}`),
  ];
  for (const slug of slugs) {
    // librsvg renders the original artwork as a still; lossless WebP retains
    // transparency and colour. 192px covers even the 64px profile marks at 3×.
    const body = await sharp(await readFile(resolve(directory, `${slug}.svg`)), { density: 144 })
      .resize(192, 192).webp({ lossless: true }).toBuffer();
    await writeFile(resolve(destination, `${slug}.webp`), body);
  }
  // Keep the approved PNG and every original pixel, including transparent RGB.
  // The atlas is not resized: CSS background and mask crops share its geometry.
  const badges = resolve(root, 'assets/community/badges');
  const atlas = await sharp(await readFile(resolve(badges, 'badge-atlas.png')))
    .webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
  await writeFile(resolve(badges, 'badge-atlas.webp'), atlas);
}
