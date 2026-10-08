import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { communityLevelExplorerHTML } from '../src/community-level-explorer.ts';

const directory = new URL('../public/assets/community/staff/', import.meta.url);
const roles = ['assistant', 'moderator', 'general'];
const common = { t: zh => zh, esc: value => String(value ?? ''), icons: {} };

test('all three displayed staff emblems exist with recorded hashes and contained artwork', async () => {
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  assert.equal(sources.collaboratorCommit, '099f293c3f8ea7ed4abd1d385e98b55e84c1b859');
  assert.deepEqual(sources.icons.map(icon => icon.role), roles);
  for (const [level, role] of roles.entries()) {
    const record = sources.icons[level];
    const file = `badge-${role}.svg`;
    assert.equal(record.file, file);
    const bytes = await readFile(new URL(file, directory));
    assert.equal(record.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(record.bytes, bytes.length);
    assert.ok(bytes.length < 128 * 1024, 'detail emblems remain small, fixed local assets');
    const dom = new JSDOM(bytes.toString(), { contentType: 'image/svg+xml' });
    try {
      const svg = dom.window.document.documentElement;
      assert.equal(svg.getAttribute('viewBox'), '0 0 240 240');
      assert.equal(svg.querySelector('script, foreignObject, a, text, animate, animateTransform'), null);
      assert.ok(svg.querySelector('image'), 'the collaborator design contains the original raster artwork');
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        for (const attribute of element.attributes) {
          assert.doesNotMatch(attribute.name, /^on/i);
          if (/href$/i.test(attribute.name)) assert.match(attribute.value, /^(?:#[\w-]+|data:image\/webp;base64,[A-Za-z0-9+/=]+)$/);
          for (const reference of attribute.value.matchAll(/url\(([^)]+)\)/g)) assert.match(reference[1], /^#[\w-]+$/);
        }
      }
      const styles = svg.querySelector('style').textContent;
      assert.match(styles, /prefers-reduced-motion:reduce/);
      assert.doesNotMatch(styles, /@import|https?:|javascript:/i);
    } finally { dom.window.close(); }
    const page = new JSDOM(communityLevelExplorerHTML({ owner: false, level: 1, vip: false }, common, { mode: 'staff', growth: null, trust: null, staff: level }));
    try {
      assert.equal(page.window.document.querySelector('[data-level-preview] img').getAttribute('src'), `/assets/community/staff/${file}`);
      assert.equal(page.window.document.querySelectorAll('[data-level-preview] img').length, 1);
    } finally { page.window.close(); }
  }
});

test('other level tabs do not request management artwork', () => {
  for (const mode of ['growth', 'trust', 'vip']) {
    const html = communityLevelExplorerHTML({ owner: false, level: 1, vip: false }, common, { mode, growth: null, trust: null });
    assert.doesNotMatch(html, /\/assets\/community\/staff\//);
  }
});
