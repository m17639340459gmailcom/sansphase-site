import test from 'node:test';
import assert from 'node:assert/strict';
import { nameEffectVariables } from '../src/community-name-effects.ts';

const surfaces = { light: ['#e8e2d5', '#f4efe5'], dark: ['#1b293e', '#23354d'] };
const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
function luminance(channels) {
  const [r, g, b] = channels.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return r * .2126 + g * .7152 + b * .0722;
}
function contrast(channels, background) {
  const values = [luminance(channels), luminance(rgb(background))].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
const variables = effect => Object.fromEntries(nameEffectVariables(effect).split(';').filter(Boolean).map(part => part.split(':')));

test('nickname effects reject unsupported or injected CSS configurations', () => {
  for (const effect of [null, 2, '', {}, { style: 'url', colors: ['#112233'] },
    { style: 'solid', colors: ['red'] }, { style: 'solid', colors: ['#123456;opacity:0'] },
    { style: 'gradient', colors: ['#123456'] }, { style: 'solid', colors: ['#123456', '#ABCDEF'] },
    { style: 'shimmer', colors: ['#123456', 'url(javascript:x)'] }]) {
    assert.equal(nameEffectVariables(effect), '');
  }
});

test('validated original colours remain available and readable solid colours stay unchanged', () => {
  const light = variables({ style: 'solid', colors: ['#264c75'] });
  assert.equal(light['--name-start'], '#264C75');
  assert.equal(light['--name-end'], '#264C75');
  assert.equal(light['--name-light-start'], '#264C75');
  assert.equal(light['--name-light-end'], '#264C75');
  const dark = variables({ style: 'solid', colors: ['#e4be73'] });
  assert.equal(dark['--name-dark-start'], '#E4BE73');
  assert.equal(dark['--name-dark-end'], '#E4BE73');
  assert.equal(Object.keys(dark).length, 6);
});

test('black, white and saturated nickname colours remain readable on both theme surfaces', () => {
  const colours = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#9D76E8', '#7F8D91'];
  for (const colour of colours) {
    const result = variables({ style: 'solid', colors: [colour] });
    for (const [theme, backgrounds] of Object.entries(surfaces)) {
      for (const endpoint of ['start', 'end']) {
        const adjusted = result[`--name-${theme}-${endpoint}`];
        assert.match(adjusted, /^#[A-F\d]{6}$/);
        for (const background of backgrounds) assert.ok(contrast(rgb(adjusted), background) >= 4.5, `${colour} becomes ${adjusted} on ${background}`);
      }
    }
  }
});

test('contrast adjustment preserves custom colour hue rather than replacing it with a preset', () => {
  const hue = hex => {
    const [r, g, b] = rgb(hex), high = Math.max(r, g, b), low = Math.min(r, g, b), difference = high - low;
    return high === r ? ((g - b) / difference + 6) % 6 * 60 : high === g ? ((b - r) / difference + 2) * 60 : ((r - g) / difference + 4) * 60;
  };
  for (const colour of ['#8FE3C8', '#9D76E8', '#FF7048', '#3886C2']) {
    const result = variables({ style: 'solid', colors: [colour] });
    for (const theme of ['light', 'dark']) {
      const changed = hue(result[`--name-${theme}-start`]), original = hue(colour);
      const distance = Math.abs(changed - original);
      assert.ok(Math.min(distance, 360 - distance) < 2, `${colour} ${theme} retains its hue`);
    }
  }
});

test('gradient and shimmer colours retain readable endpoints and intermediate colours', () => {
  for (const style of ['gradient', 'shimmer']) {
    for (const colours of [['#FF0000', '#0000FF'], ['#00FF00', '#FF00FF'], ['#000000', '#FFFFFF'], ['#8FE3C8', '#C9B6F2']]) {
      const result = variables({ style, colors: colours });
      assert.equal(result['--name-start'], colours[0]);
      assert.equal(result['--name-end'], colours[1]);
      for (const [theme, backgrounds] of Object.entries(surfaces)) {
        const start = rgb(result[`--name-${theme}-start`]), end = rgb(result[`--name-${theme}-end`]);
        for (let step = 0; step <= 256; step++) {
          const mixed = start.map((channel, index) => channel + (end[index] - channel) * step / 256);
          for (const background of backgrounds) assert.ok(contrast(mixed, background) >= 4.5, `${style} ${colours} ${theme} at ${step}/256 on ${background}`);
        }
      }
    }
  }
});
