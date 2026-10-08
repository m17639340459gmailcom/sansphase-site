import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { communityLevelExplorerHTML } from '../src/community-level-explorer.ts';
import { communityStaffArtSource, communityStaffArtRevision } from '../src/community-staff-art.ts';

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
      assert.equal(page.window.document.querySelector('[data-level-preview] img').getAttribute('src'), `/assets/community/staff/compact/badge-${role}.webp?v=staff-20261009-r2`);
      assert.equal(page.window.document.querySelector('[data-level-preview] [data-staff-art]').getAttribute('data-staff-art'), `badge-${role}`);
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

test('all six public staff asset URLs carry the recorded repair revision and reject unknown paths', async () => {
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  assert.equal(sources.assetRevision, communityStaffArtRevision);
  for (const role of roles) for (const kind of ['badge', 'frame']) for (const compact of [false, true]) {
    const path = new URL(communityStaffArtSource(`${kind}-${role}`, compact), 'http://localhost');
    assert.equal(path.searchParams.get('v'), 'staff-20261009-r2');
    assert.deepEqual([...path.searchParams.keys()], ['v']);
    assert.ok(path.pathname.startsWith('/assets/community/staff/'));
  }
  for (const slug of ['frame-owner', '../../frame-general', 'frame-general?cache=old', 'https://example.test/frame-general']) assert.equal(communityStaffArtSource(slug, true), '');
});

test('the three role avatar frames keep their collaborator artwork, outlined lettering and source licence', async () => {
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  assert.deepEqual(sources.frames.map(frame => frame.role), roles);
  assert.equal(sources.fontOutline.name, 'Ma Shan Zheng Regular');
  assert.equal(sources.fontOutline.license, 'SIL Open Font License 1.1');
  const licence = await readFile(new URL(sources.fontOutline.licenseFile, directory));
  assert.equal(createHash('sha256').update(licence).digest('hex'), sources.fontOutline.licenseSha256);
  assert.match(licence.toString(), /Copyright 2018 The Ma Shan Zheng Project Authors/);
  assert.match(licence.toString(), /SIL OPEN FONT LICENSE Version 1\.1/);
  for (const [index, role] of roles.entries()) {
    const record = sources.frames[index];
    assert.equal(record.file, `frame-${role}.svg`);
    const bytes = await readFile(new URL(record.file, directory));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.ok(bytes.length < 160 * 1024, 'full animated frame remains a bounded local asset');
    const page = new JSDOM(bytes.toString(), { contentType: 'image/svg+xml' });
    try {
      const svg = page.window.document.documentElement;
      assert.equal(svg.getAttribute('viewBox'), '0 0 400 400');
      assert.equal(svg.querySelector('script, foreignObject, a, text, animate, animateTransform'), null);
      assert.ok(svg.querySelector('image'));
      assert.ok(svg.querySelectorAll('defs path').length >= 2, 'role lettering stays outlined; no runtime font request');
      assert.equal(svg.querySelectorAll('style').length, 1, 'no extra global rule disables the original animation');
      assert.match(svg.querySelector('style').textContent, /@keyframes/);
      assert.match(svg.querySelector('style').textContent, /prefers-reduced-motion:reduce/);
      assert.doesNotMatch(svg.querySelector('style').textContent, /@import|https?:|javascript:/i);
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        for (const attribute of element.attributes) {
          assert.doesNotMatch(attribute.name, /^on/i);
          if (/href$/i.test(attribute.name)) assert.match(attribute.value, /^(?:#[\w-]+|data:image\/webp;base64,[A-Za-z0-9+/=]+)$/);
          for (const reference of attribute.value.matchAll(/url\(([^)]+)\)/g)) assert.match(reference[1], /^#[\w-]+$/);
        }
      }
    } finally { page.window.close(); }
  }
});

test('radial backdrop correction preserves every original artwork, lettering and animation byte outside the added mask', async () => {
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  for (const role of ['moderator', 'general']) {
    const record = sources.frames.find(frame => frame.role === role);
    assert.equal(record.correction.kind, 'radial-backdrop-alpha-fade');
    const body = await readFile(new URL(record.file, directory), 'utf8');
    const page = new JSDOM(body, { contentType: 'image/svg+xml' });
    try {
      const backdrop = page.window.document.querySelector('[data-staff-backdrop="radial"]');
      assert.equal(backdrop.getAttribute('mask'), 'url(#staff-backdrop-mask)');
      assert.equal(backdrop.querySelector('use:not([filter]), defs, clipPath'), null, 'only background light is masked');
      const fade = page.window.document.querySelector('#staff-backdrop-fade');
      assert.equal(fade.getAttribute('cx'), '200'); assert.equal(fade.getAttribute('cy'), '200');
      assert.equal(fade.getAttribute('r'), '200');
      assert.equal(fade.lastElementChild.getAttribute('stop-opacity'), '0');
      assert.equal(fade.lastElementChild.getAttribute('offset'), '1');
    } finally { page.window.close(); }
    const original = body
      .replace(/<radialGradient id="staff-backdrop-fade"[\s\S]*?<\/mask>/, '')
      .replace('<g data-staff-backdrop="radial" mask="url(#staff-backdrop-mask)">', '')
      .replace('</g><use href="#art"/><g mask="url(#am)">', '<use href="#art"/><g mask="url(#am)">');
    assert.equal(createHash('sha256').update(original).digest('hex'), record.correction.originalSha256);
  }
  assert.equal(sources.frames.find(frame => frame.role === 'assistant').sha256, '9a54b4b00875216c72e12c378141efd39acb849c629aff4d6f894ce8206b3972', 'the assistant artwork has no square bloom defect and stays unchanged');
});
