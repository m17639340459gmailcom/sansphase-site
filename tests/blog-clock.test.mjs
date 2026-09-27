import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { escapeHTML } from '../src/core.mjs';
import { createBlogClock } from '../src/blog-clock.mjs';

const icons = {clock:'CLOCK',calendar:'CALENDAR'};
const t = (zh,en) => zh;

test('blog clock restores a chosen zone, changes calendar and releases its timer and picker', () => {
  const dom = new JSDOM('<main></main>');
  const {document} = dom.window;
  const timers = [];
  let selected, unmounted = 0, layout;
  const clock = createBlogClock({
    document, window:dom.window,
    restoredView:{timezoneManual:true,timezone:'Asia/Kathmandu',calendarOpen:true},
    visitorTimezone:()=> 'Asia/Shanghai', validTimezone:()=>true,
    mountTimezoneSelect(_host, options) { selected=options; return ()=>{unmounted++;}; },
    escapeHTML, icons, t, english:()=>false,
    now:()=>new Date('2026-09-25T12:00:00Z'),
    setInterval(callback, delay) { timers.push(['start',delay]); return callback; },
    clearInterval(callback) { timers.push(['stop',typeof callback]); },
    afterLayout(callback) {layout=callback;},
  });
  assert.deepEqual(clock.state(), {timezone:'Asia/Kathmandu',timezoneManual:true,calendarOpen:true});
  document.querySelector('main').innerHTML=clock.html();
  assert.equal(document.querySelector('[data-clock-zone]').textContent,'Asia/Kathmandu');
  assert.equal(document.querySelector('#blog-calendar-body').hidden,false);
  clock.mount();
  assert.equal(selected.value,'Asia/Kathmandu');
  clock.sync('notes');
  const toggle=document.querySelector('[data-action="blog-calendar"]');
  clock.toggleCalendar(toggle);
  layout();
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(document.querySelector('#blog-calendar-body').hidden,true);
  assert.equal(clock.state().calendarOpen,false);
  selected.onChange('UTC');
  assert.equal(clock.state().timezone,'UTC');
  assert.equal(document.querySelector('[data-clock-zone]').textContent,'UTC');
  clock.sync('works');
  clock.unmount();
  assert.deepEqual(timers,[['start',1000],['stop','function']]);
  assert.equal(unmounted,1);
  dom.window.close();
});

test('automatic zone follows a device change without replacing the page', () => {
  const dom = new JSDOM('<main></main>');
  const {document} = dom.window;
  let deviceZone='Asia/Shanghai';
  const clock = createBlogClock({
    document, window:dom.window, restoredView:{},
    visitorTimezone:()=>deviceZone, validTimezone:()=>true,
    mountTimezoneSelect:()=>()=>{}, escapeHTML, icons, t, english:()=>false,
    now:()=>new Date('2026-09-25T12:00:00Z'),
  });
  document.querySelector('main').innerHTML=clock.html();
  deviceZone='Europe/London';
  clock.refreshAutoTimezone();
  assert.deepEqual(clock.state(),{timezone:'Europe/London',timezoneManual:false,calendarOpen:false});
  assert.equal(document.querySelector('[data-clock-zone]').textContent,'Europe/London');
  dom.window.close();
});

test('clock behavior stays in the existing UI bundle without a new startup request', async () => {
  const {readFile,readdir}=await import('node:fs/promises');
  const app=await readFile('dist/app.mjs','utf8');
  const ui=await readFile('dist/ui.bundle.mjs','utf8');
  assert.doesNotMatch(app,/from ["']\.\/blog-clock\.mjs["']/);
  assert.match(ui,/createBlogClock/);
  assert.ok(!(await readdir('dist')).includes('blog-clock.mjs'));
});
