import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicDemo } from '../scripts/fixtures/music-demo.mjs';

test('local music preview provides playable PCM and range requests without external media',async()=>{
  const demo=createMusicDemo();
  assert.equal(demo.settings.autoplay,false);
  const response=demo.media('demo-audio-one');
  const body=Buffer.from(await response.arrayBuffer());
  assert.equal(body.toString('ascii',0,4),'RIFF');
  assert.equal(body.toString('ascii',8,12),'WAVE');
  assert.equal(body.readUInt32LE(40),body.length-44);
  const range=demo.media('demo-audio-one',{range:'bytes=44-143'});
  assert.equal(range.status,206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),body.subarray(44,144));
  assert.equal(demo.media('missing').status,404);
  assert.equal(demo.media('demo-audio-one',{range:'bytes=9999999-'}).status,416);
});
