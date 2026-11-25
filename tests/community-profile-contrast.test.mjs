import test from 'node:test';
import assert from 'node:assert/strict';
import { profileNameInk } from '../src/community-name-effects.ts';

const pixels = (...colours) => new Uint8ClampedArray(colours.flatMap(([r, g, b]) => [r, g, b, 255]));
test('profile nickname chooses readable ink from actual sampled background rather than site theme', () => {
  assert.equal(profileNameInk(pixels([0, 0, 0])), '#ffffff');
  assert.equal(profileNameInk(pixels([255, 255, 255])), '#000000');
  assert.equal(profileNameInk(pixels([119, 119, 119])), '#000000');
  assert.equal(profileNameInk(pixels([40, 54, 80])), '#ffffff');
  assert.equal(profileNameInk(pixels([244, 239, 229])), '#000000');
});
test('isolated stars or speckles do not flip a predominantly dark or light name area', () => {
  assert.equal(profileNameInk(pixels([0, 0, 0], [0, 0, 0], [0, 0, 0], [255, 255, 255])), '#ffffff');
  assert.equal(profileNameInk(pixels([255, 255, 255], [255, 255, 255], [255, 255, 255], [0, 0, 0])), '#000000');
});
