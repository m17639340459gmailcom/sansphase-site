import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { setImmediate } from 'node:timers/promises';
import sharp from 'sharp';

// Native Files expose Blob.arrayBuffer; jsdom's File currently does not.
// Real Sharp output lets these UI fixtures exercise the actual header preflight.
const still = sharp({ create: { width: 32, height: 24, channels: 4, background: '#4488aacc' } });
const animation = Buffer.alloc(32 * 64 * 4, 180); animation.fill(255, 32 * 32 * 4);
const sources = new Map(await Promise.all([
  still.clone().png().toBuffer().then(bytes => ['image/png', bytes]),
  still.clone().webp().toBuffer().then(bytes => ['image/webp', bytes]),
  still.clone().jpeg().toBuffer().then(bytes => ['image/jpeg', bytes]),
  sharp(animation, { raw: { width: 32, height: 64, channels: 4, pageHeight: 32 } }).gif({ loop: 0, delay: [100, 200] }).toBuffer().then(bytes => ['image/gif', bytes]),
]));

export function uploadImageFile(name = 'image.png', type = 'image/png', realm) {
  const bytes = sources.get(type); assert.ok(bytes, `known image fixture: ${type}`);
  const native = new File([bytes], name, { type });
  if (!realm) return native;
  // Preserve DOM FormData/FileReader semantics while supplying the Blob methods
  // that are missing from jsdom, using the same real bytes in both instances.
  const file = new realm.File([bytes], name, { type });
  Object.defineProperties(file, {
    arrayBuffer: { value: () => native.arrayBuffer() },
    slice: { value: (...args) => native.slice(...args) },
  });
  return file;
}

export async function waitForImageState(check, reason) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    assert.ok(performance.now() < deadline, reason);
    await setImmediate();
  }
}
