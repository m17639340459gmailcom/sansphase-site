import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { composeCommunityStyles } from '../../scripts/compose-community-styles.mjs';
import { communityStewardsHTML } from '../../src/community-stewards.ts';
import { communityStaffCapabilities } from '../../src/community-staff.ts';
import type { CommunityStaffState } from '../../src/community-staff.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window };
};
const owner: CommunityStaffState = { role: 'owner', boards: ['qa', 'tools'], permissions: communityStaffCapabilities.map(cap => cap.id), delegable: communityStaffCapabilities.map(cap => cap.id), parent: null };
const themeSelector = 'body.community-open:is(.community-frame-open, .community-management-open)';

async function fixture(theme: 'light' | 'dark', english = false) {
  const foundation = await readFile(new URL('../../src/styles-foundation.css', import.meta.url), 'utf8');
  const source = foundation + '\n' + await composeCommunityStyles();
  const tokens = new Map<string, string>();
  postcss.parse(source).walkRules(rule => {
    if (rule.parent?.type !== 'root' || ![':root', 'body.community-open', themeSelector, ...(theme === 'light' ? [`${themeSelector}[data-community-theme="light"]`] : [])].includes(rule.selector)) return;
    rule.walkDecls(d => { if (d.prop.startsWith('--')) tokens.set(d.prop, d.value); });
  });
  // Exercise the composed cascade and interactive states, not JSDOM layout.
  // The actual Radix component and native FormData are covered by select tests.
  let css = source.replaceAll(':hover', '.test-hover').replaceAll(':focus-visible', '.test-focus');
  for (let n = 0; n < 10; n++) css = css.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (match: string, name: string, fallback: string | undefined) => tokens.get(name) ?? fallback ?? match);
  const content = communityStewardsHTML([], { state: 'ready', data: { person: { uid: '10001', name: '读者', role: 'reader', level: 2 }, steward: false, canAppoint: true, self: false, staff: null } }, {
    t: (zh, en) => english ? en : zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {},
  }, null, owner);
  const { window } = new JSDOM(`<style>${css}</style><body class="community-open community-management-open" data-community-theme="${theme}">${content}</body>`, { url: 'http://localhost/#/community/manage/stewards' });
  return { window, tokens, style: (element: Element) => window.getComputedStyle(element) };
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the appointment lookup and role field share a scale and long actions can wrap`, async () => {
    const { window, style } = await fixture(theme, true);
    try {
      const doc = window.document;
      const input = doc.querySelector<HTMLInputElement>('.community-steward-lookup input')!;
      const lookupButton = doc.querySelector<HTMLButtonElement>('.community-steward-lookup button')!;
      const role = doc.querySelector<HTMLSelectElement>('select[name="role"]')!;
      assert.equal(style(input).height, '48px');
      assert.equal(style(lookupButton).height, style(input).height, 'search input and action have the same field height');
      assert.equal(style(role).height, style(input).height, 'the native fallback retains the same appointment scale');
      assert.equal(style(role.parentElement!).maxWidth, '320px', 'the three-role selector does not stretch across the whole permission matrix');
      assert.equal(style(input).fontSize, '16px', 'text entry retains readable native sizing and avoids mobile auto-zoom');
      const submit = doc.querySelector<HTMLButtonElement>('[data-community-form="steward-scope"] button[type="submit"]')!;
      submit.querySelector('span')!.textContent = 'Confirm the changed appointment and revoke subordinate appointments';
      assert.equal(style(submit).whiteSpace, 'normal', 'long confirmation text can wrap instead of overflowing a narrow staff card');
      assert.equal(style(submit).height, 'auto');
      assert.equal(style(submit).maxWidth, '100%');
      assert.equal(style(submit.querySelector('span')!).overflowWrap, 'anywhere');
      assert.deepEqual([...role.options].map(option => option.value), ['general', 'moderator', 'assistant']);
    } finally { window.close(); }
  });

  test(`${theme}: permission labels have usable hit areas and stable selected, focus and disabled states`, async () => {
    const { window, style } = await fixture(theme);
    try {
      const doc = window.document;
      const input = doc.querySelector<HTMLInputElement>('[data-staff-permission="topic.approve"] input[name="permissions"]')!;
      const label = input.closest('label')!;
      input.checked = false;
      doc.body.dataset.testState = 'unchecked';
      const original = style(label);
      const idleFill = original.backgroundColor;
      assert.ok(Number.parseFloat(original.minHeight) >= 36, 'the whole native label offers a useful click target');
      assert.equal(original.fontSize, '14px', 'permission choices follow the shared UI typography');
      label.click();
      doc.body.dataset.testState = 'checked';
      assert.equal(input.checked, true);
      const checkedFill = style(label).backgroundColor;
      assert.notEqual(checkedFill, idleFill, 'the selected capability is visible across its clickable label');
      input.classList.add('test-focus');
      assert.notEqual(style(label).borderColor, original.borderColor, 'keyboard focus changes the existing edge');
      assert.equal(style(label).boxShadow, 'none');
      input.classList.remove('test-focus');
      input.disabled = true;
      doc.body.dataset.testState = 'disabled';
      const disabledFill = style(label).backgroundColor;
      label.classList.add('test-hover');
      assert.equal(style(label).backgroundColor, disabledFill, 'pending controls do not react as if enabled');
      assert.equal(style(label).cursor, 'default');
      label.click();
      assert.equal(input.checked, true, 'styling preserves the native disabled checkbox');
      const board = doc.querySelector<HTMLInputElement>('input[name="boards"]')!;
      board.disabled = true;
      board.closest('label')!.classList.add('test-hover');
      assert.equal(style(board.closest('label')!).cursor, 'default');
    } finally { window.close(); }
  });

  test(`${theme}: the shared role dropdown keeps readable selected options and a quiet disabled trigger`, async () => {
    const { window, tokens, style } = await fixture(theme);
    try {
      const doc = window.document;
      const role = doc.querySelector('select[name="role"]')!;
      const host = doc.createElement('span');
      host.className = 'community-select-host';
      host.innerHTML = '<button type="button" class="community-select-trigger"><span>General moderator</span><span><svg></svg></span></button>';
      role.after(host);
      const trigger = host.querySelector<HTMLButtonElement>('button')!;
      assert.equal(style(trigger).height, '48px');
      const idle = style(trigger).borderColor;
      trigger.classList.add('test-focus');
      assert.notEqual(style(trigger).borderColor, idle);
      assert.equal(style(trigger).boxShadow, 'none', 'the select uses only its existing input edge');
      trigger.setAttribute('aria-invalid', 'true');
      trigger.classList.add('test-hover');
      const errorProbe = doc.createElement('span');
      errorProbe.style.color = tokens.get('--error')!;
      doc.body.append(errorProbe);
      assert.equal(style(trigger).borderColor, style(errorProbe).color, 'validation errors remain visible while focused or hovered');
      trigger.removeAttribute('aria-invalid');
      trigger.classList.remove('test-hover');
      trigger.classList.remove('test-focus');
      trigger.disabled = true;
      const disabled = style(trigger).borderColor;
      trigger.classList.add('test-hover');
      assert.equal(style(trigger).borderColor, disabled, 'disabled triggers do not light up on hover');
      const menu = doc.createElement('div');
      menu.className = 'community-select-menu';
      menu.innerHTML = '<div class="community-select-option" data-state="checked" data-highlighted><span>General moderator</span></div>';
      doc.body.append(menu);
      assert.notEqual(style(menu.firstElementChild!).color, style(trigger).color, 'selected option uses the shared selected ink');
      assert.equal(style(menu.firstElementChild!).whiteSpace, 'normal', 'long option labels remain readable');
    } finally { window.close(); }
  });
}
