import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { musicPlayerShellHTML, musicPlayerControlsHTML, musicPlayerStaticHTML } from '../src/music-player-markup.ts';

test('static music reserves the same record and controls without enabling playback or downloading audio', () => {
  const dom = new JSDOM(musicPlayerStaticHTML({ trackCount: 3 }));
  const doc = dom.window.document, player = doc.querySelector('[data-music-player-static]')!;
  const shell = new JSDOM(musicPlayerShellHTML());
  assert.equal(player.className, 'site-music-player vinyl-player');
  assert.equal(player.hasAttribute('inert'), true);
  assert.equal(doc.querySelector('.music-turntable')!.outerHTML, shell.window.document.querySelector('.music-turntable')!.outerHTML);
  assert.ok(doc.querySelector('.plyr.plyr--audio.plyr--stopped .vinyl-controls'));
  assert.equal(doc.querySelector('[data-track-position]')!.textContent, '1/3');
  assert.equal(doc.querySelector('audio')!.getAttribute('preload'), 'none');
  assert.equal(doc.querySelector('audio[src], source, script'), null);
  assert.equal(doc.querySelector('.music-current')!.classList.contains('sr-only'), true);
  assert.equal(doc.querySelector('[data-music-state]')!.parentElement!.className, 'sr-only');
  assert.equal(doc.querySelectorAll('[data-plyr="play"]').length, 1);
  shell.window.close(); dom.window.close();
});

test('shared music controls keep bilingual names and caller supplied drawings', () => {
  const icons = { previous: '<i>previous</i>', next: '<i>next</i>', play: '<i>play</i>', pause: '<i>pause</i>', muted: '<i>muted</i>', volume: '<i>volume</i>' };
  for (const english of [false, true]) {
    const dom = new JSDOM(musicPlayerControlsHTML({ english, icons }));
    const doc = dom.window.document;
    assert.equal(doc.querySelector('[data-prev]')!.getAttribute('aria-label'), english ? 'Previous track' : '上一首');
    assert.equal(doc.querySelector('[data-plyr="volume"]')!.getAttribute('aria-label'), english ? 'Volume' : '音量');
    assert.equal(doc.querySelectorAll('i').length, 6);
    assert.equal(doc.querySelectorAll('.music-seek-row, .music-transport, .music-volume-row').length, 3);
    dom.window.close();
  }
});
