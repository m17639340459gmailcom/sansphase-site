import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import postcss from 'postcss';

// Protect the user's explicitly requested bright text through material changes.
function luminance(hex: string): number {
  assert.match(hex, /^#[\da-f]{6}$/i, 'reading tokens must have a measurable opaque base colour');
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}

test('normal community text remains readable over the page and both panel surfaces', async () => {
  const css = postcss.parse(await readFile(new URL('../../src/community-layout/stable-frame.css', import.meta.url), 'utf8'));
  const tokens = new Map<string, string>();
  css.walkRules('body.community-open:is(.community-frame-open, .community-management-open)', rule => {
    rule.walkDecls(declaration => { tokens.set(declaration.prop, declaration.value); });
  });
  const foregrounds = ['--text', '--muted', '--dim', '--community-reading-nav', '--cm-body-text'];
  const backgrounds = ['--bg', '--community-reading-card-top', '--community-reading-card-bottom'];
  for (const foreground of foregrounds) {
    for (const background of backgrounds) {
      const values = [luminance(tokens.get(foreground)!), luminance(tokens.get(background)!)].sort((a, b) => b - a);
      const ratio = (values[0]! + .05) / (values[1]! + .05);
      assert.ok(ratio >= 4.5, `${foreground} against ${background} must reach 4.5:1, got ${ratio.toFixed(2)}:1`);
    }
  }
});

test('light community body text, navigation, metadata and gold headings remain readable on paper', async () => {
  const css = postcss.parse(await readFile(new URL('../../src/community-layout/appearance.css', import.meta.url), 'utf8'));
  const tokens = new Map<string, string>();
  css.walkRules('body.community-open:is(.community-frame-open, .community-management-open)[data-community-theme="light"]', rule => {
    rule.walkDecls(declaration => { tokens.set(declaration.prop, declaration.value); });
  });
  for (const foreground of ['--text', '--muted', '--dim', '--community-reading-nav', '--cm-body-text', '--community-reading-title', '--signal']) {
    for (const background of ['--bg', '--community-reading-card-top', '--community-reading-card-bottom']) {
      const values = [luminance(tokens.get(foreground)!), luminance(tokens.get(background)!)].sort((a, b) => b - a);
      const ratio = (values[0]! + .05) / (values[1]! + .05);
      assert.ok(ratio >= 4.5, `${foreground} on ${background} must reach 4.5:1, got ${ratio.toFixed(2)}:1`);
    }
  }
});
