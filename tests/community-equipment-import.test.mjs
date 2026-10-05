import test from 'node:test';
import assert from 'node:assert/strict';
import { readNameEffectFile } from '../src/community-equipment-import.ts';

const file = (value, name = 'nickname.json') => new File([typeof value === 'string' ? value : JSON.stringify(value)], name, { type: 'application/json' });
const effect = { style: 'shimmer', colors: ['#8fe3c8', '#9d76e8'] };
const wrapped = value => ({ format: 'sansphase-name-effect', version: 1, effect: value });

test('nickname import accepts existing safe effect configurations and normalises colours', async () => {
  for (const style of ['solid', 'gradient', 'shimmer']) {
    const colors = style === 'solid' ? ['#123abc'] : ['#123abc', '#8fe3c8'];
    assert.deepEqual(await readNameEffectFile(file({ style, colors })), { style, colors: colors.map(color => color.toUpperCase()) });
  }
});

test('nickname import accepts the versioned portable format and UTF-8 BOM', async () => {
  assert.deepEqual(await readNameEffectFile(file(wrapped(effect), '星河昵称.JSON')), { style: 'shimmer', colors: ['#8FE3C8', '#9D76E8'] });
  assert.deepEqual(await readNameEffectFile(file('\uFEFF' + JSON.stringify(wrapped(effect)))), { style: 'shimmer', colors: ['#8FE3C8', '#9D76E8'] });
});

test('nickname import rejects unsupported formats, versions, kinds and unknown fields', async () => {
  const invalid = [
    { ...wrapped(effect), version: 2 }, { ...wrapped(effect), version: '1' },
    { ...wrapped(effect), format: 'avatar-frame' }, { format: 'sansphase-name-effect', effect },
    { ...wrapped(effect), kind: 'color' }, { ...wrapped(effect), name: 'nickname' },
    { ...effect, script: 'alert(1)' }, { ...effect, css: 'color:red' },
    wrapped({ ...effect, html: '<img src=x onerror=alert(1)>' }),
    wrapped({ ...effect, duration: 2 }), JSON.parse('{"style":"solid","colors":["#123456"],"__proto__":{}}'),
  ];
  for (const value of invalid) await assert.rejects(readNameEffectFile(file(value)), /格式|版本|字段/);
});

test('nickname import rejects unsafe colours, unknown styles and malformed JSON structures', async () => {
  const invalid = [null, [], true, '"text"', '{}',
    { style: 'blink', colors: ['#123456'] }, { style: 'solid', colors: ['red'] },
    { style: 'solid', colors: ['#123456;opacity:0'] }, { style: 'solid', colors: ['#123456', '#ABCDEF'] },
    { style: 'gradient', colors: ['#123456'] }, { style: 'shimmer', colors: ['#123456', 'url(javascript:x)'] },
    '<script>alert(1)</script>', 'body{color:red}', '{"style":',
  ];
  for (const value of invalid) await assert.rejects(readNameEffectFile(file(value)), /格式|JSON|颜色|样式/);
});

test('nickname import requires a JSON file within the 64 KiB byte limit', async () => {
  for (const name of ['nickname.html', 'nickname.css', 'nickname.js', 'nickname.json.png', 'nickname']) {
    await assert.rejects(readNameEffectFile(file(effect, name)), /JSON/);
  }
  const value = JSON.stringify(effect);
  assert.deepEqual(await readNameEffectFile(file(value + ' '.repeat(64 * 1024 - Buffer.byteLength(value)))), { style: 'shimmer', colors: ['#8FE3C8', '#9D76E8'] });
  await assert.rejects(readNameEffectFile(file(value + ' '.repeat(64 * 1024 - Buffer.byteLength(value) + 1))), /64\s?KB/);
  await assert.rejects(readNameEffectFile(file('\u4e2d'.repeat(22 * 1024))), /64\s?KB/);
});

test('nickname import rejects invalid UTF-8 instead of silently replacing characters', async () => {
  const bytes = new Uint8Array([...Buffer.from(JSON.stringify(effect)), 0xff]);
  await assert.rejects(readNameEffectFile(new File([bytes], 'nickname.json')), /UTF-8/);
});
