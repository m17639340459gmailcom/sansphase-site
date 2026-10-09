import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { moonFrameSVG } from './vip-moon-frame.ts';
import type { MoonFrameAssetName } from './vip-moon-frame.ts';

const sourceFiles = [
  'base-640.webp', 'still-640.webp', 'ribbon-640.webp',
  'mask-gold.png', 'mask-blue.png', 'mask-pale.png', 'wave.png', 'env.png',
] as const;
type SourceFile = typeof sourceFiles[number];
interface SourceIntegrity { bytes: number; sha256: string; mime: 'image/png' | 'image/webp' }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceManifest(body: string): Record<SourceFile, SourceIntegrity> {
  const parsed: unknown = JSON.parse(body);
  if (!record(parsed) || parsed.schemaVersion !== 1
    || parsed.commit !== 'c78bcdbb5df9f21d2c27819f7b53ac6ac99ab9c4'
    || !record(parsed.files) || Object.keys(parsed.files).length !== sourceFiles.length) {
    throw new Error('Invalid VIP frame source manifest');
  }
  const files = {} as Record<SourceFile, SourceIntegrity>;
  for (const file of sourceFiles) {
    const entry = parsed.files[file];
    const mime = file.endsWith('.png') ? 'image/png' : 'image/webp';
    if (!record(entry) || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.mime !== mime) {
      throw new Error(`Invalid VIP frame source manifest entry: ${file}`);
    }
    files[file] = { bytes: entry.bytes, sha256: entry.sha256, mime };
  }
  return files;
}

/** Build the approved moon frame from formal inputs copied into a fresh release. */
export async function buildCommunityVipFrameArt(root: string): Promise<void> {
  const directory = resolve(root, 'assets/community/vip-frame');
  const manifest = sourceManifest(await readFile(resolve(directory, 'sources.json'), 'utf8'));
  const entries = await Promise.all(sourceFiles.map(async file => {
    const bytes = await readFile(resolve(directory, file));
    const expected = manifest[file];
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
      throw new Error(`VIP frame source integrity mismatch: ${file}`);
    }
    return [file, bytes] as const;
  }));
  const sources = Object.fromEntries(entries) as Record<SourceFile, Buffer>;
  const images = {} as Record<MoonFrameAssetName, string>;
  for (const file of sourceFiles) {
    if (file !== 'base-640.webp') images[file] = `data:${manifest[file].mime};base64,${sources[file].toString('base64')}`;
  }
  const svg = Buffer.from(moonFrameSVG(images));
  if (svg.length >= 700 * 1024) throw new Error('VIP moon frame SVG exceeds 700 KiB delivery limit');
  // Use the approved base painting for the still. Rendering the animated SVG
  // with librsvg would turn unsupported WebP/filter layers into opaque light.
  const compact = await sharp(sources['base-640.webp']).resize(256, 256)
    .webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
  if (compact.length >= 96 * 1024) throw new Error('Compact VIP moon frame exceeds 96 KiB delivery limit');
  await mkdir(resolve(directory, 'compact'), { recursive: true });
  await writeFile(resolve(directory, 'frame-moon.svg'), svg);
  await writeFile(resolve(directory, 'compact/frame-moon.webp'), compact);
}
