import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { defaultCommunityBoards, resetCommunityBoardCatalog, communityManagementHref } from '../src/community.ts';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const seed = () => ({ version: 0, items: structuredClone(defaultCommunityBoards) });
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const owner = { name: '作者', uid: 'owner', role: 'owner', owner: true, mod: true, vip: true, agreed: true,
  checkedIn: true, streak: 1, nextReward: { total: 1 }, unread: { all: 0 }, balance: 0, inventory: {},
  management: { role: 'owner', browsingAsReader: false } };
const turn = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check) { const deadline = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < deadline, 'operation settles'); await turn(); } }

async function setup(t, hash, handle, viewer = owner, context = {}) {
  resetCommunityBoardCatalog();
  const dom = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true }), w = dom.window;
  w.scrollTo = () => {};
  const names = ['window','document','location','HTMLElement','Element','Node','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','HTMLFormElement','HTMLAnchorElement','Event','MutationObserver'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const main = w.document.querySelector('main'), calls = [];
  const request = async (url, init = {}) => {
    calls.push({url, init});
    if (url.endsWith('/me')) return response(viewer);
    if (url.endsWith('/active/visit')) return response({ uid: viewer.uid, visited: true, awarded: 0 });
    return handle(url, init);
  };
  const ui = createCommunityUI({request});
  const ctx = {t: zh => zh, esc, icons: {megaphone:'<svg data-announcement></svg>'}, members: true, simpleCompose: false, ...context};
  main.innerHTML = ui.html(ctx);
  const cleanup = ui.mount(main, ctx);
  t.after(() => { cleanup(); ui.clear(); resetCommunityBoardCatalog(); for (const [name,value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name]=value; } w.close(); });
  return {main,w,ui,calls};
}

test('a moderator assigned only to a new board gains the header entry when the later catalog confirms the scope', async t => {
  const catalog=seed();catalog.version=1;catalog.items.push({...catalog.items[4],id:'board-new-1',zh:'新讨论',en:'Discussion'});
  const viewer={...owner,owner:false,role:'reader',uid:'10003',moderationBoards:['board-new-1'],management:{role:'steward',browsingAsReader:false},staff:{role:'moderator',boards:['board-new-1'],permissions:['content.inspect'],delegable:[]}};
  let resolveSummary;const slow=new Promise(resolve=>{resolveSummary=resolve;});const entries=[];let activeUI;
  const {ui}=await setup(t,'#/community/home',url=>url.endsWith('/summary')?slow:response({items:[],total:0,page:1,pageSize:20}),viewer,{headerChanged:()=>entries.push(communityManagementHref(activeUI?.me()))});activeUI=ui;
  await until(()=>ui.me());assert.equal(communityManagementHref(ui.me()),null);
  resolveSummary(response({total:0,boards:{},tags:{},hot:[],boardCatalog:catalog}));
  await until(()=>entries.includes('#/community/manage'));
});

test('cold generated board and compose URLs wait for catalog and expose the confirmed name', async t => {
  for (const path of ['boards', 'new']) await t.test(path, async t => {
    const catalog = seed(); catalog.items.push({...catalog.items[4], id:'board-ai-2026', zh:'新讨论板块', en:'新讨论板块'}); catalog.version=1;
    let resolveSummary; const slow = new Promise(resolve => {resolveSummary=resolve;});
    const {main} = await setup(t, `#/community/${path}/board-ai-2026`, url => {
      if (url.endsWith('/summary')) return slow;
      if (url.includes('/topics?')) return response({items:[],total:0,page:1,pageSize:20});
      throw Error(`Unexpected ${url}`);
    });
    await turn(); assert.equal(main.querySelector('form[data-community-form="topic"]'), null);
    resolveSummary(response({total:0,boards:{},tags:{},hot:[],boardCatalog:catalog}));
    await until(() => main.textContent.includes('新讨论板块'));
    assert.doesNotMatch(main.textContent, /不存在/);
    if (path === 'new') assert.ok(main.querySelector('[name="board"][value="board-ai-2026"]'));
  });
});

test('author board management consumes the light channel and saves without replacing the shell or rows', async t => {
  let catalog = seed();
  const {main,w,calls} = await setup(t,'#/community/manage/boards',(url,init) => {
    if (url.includes('/manage?')) return response({tab:'boards',owner:true,allowedTabs:['boards','queue','banners'],boardCatalog:catalog});
    if (url.endsWith('/manage/boards/order')) {const body=JSON.parse(init.body); assert.equal(body.version,catalog.version); catalog={version:catalog.version+1,items:body.ids.map(id=>catalog.items.find(board=>board.id===id))}; return response(catalog);}
    if (url.endsWith('/manage/boards')) {const body=JSON.parse(init.body); catalog={version:catalog.version+1,items:[...catalog.items,{...catalog.items[4],id:'board-new-1',zh:body.name,en:body.name,description:body.description,descriptionEn:body.description}]};return response(catalog);}
    throw Error(`Unexpected ${url}`);
  });
  await until(()=>main.querySelector('[data-board-editor]'));
  const shell=main.querySelector('.community-management-page'), sidebar=main.querySelector('.community-management-nav'), list=main.querySelector('[data-board-order-list]'), first=list.firstElementChild;
  assert.equal(main.querySelector('.community-kpis'),null,'light channel does not invent activity counts');
  const down=first.querySelector('[data-action="community-board-down"]'); down.focus(); down.click();
  assert.equal(list.children[1],first); assert.equal(w.document.activeElement,down);
  main.querySelector('[data-community-form="board-order"]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>calls.some(call=>call.url.endsWith('/manage/boards/order')) && !main.querySelector('[data-board-editor][aria-busy="true"]'));
  assert.equal(main.querySelector('.community-management-page'),shell); assert.equal(main.querySelector('.community-management-nav'),sidebar); assert.equal(list.children[1],first);
  const form=main.querySelector('[data-community-form="board-create"]');
  for (const [name,value] of [['name','摄影讨论'],['description','分享摄影作品和经验']]) {const field=form.elements.namedItem(name);field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));}
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>list.children.length===7);
  assert.equal(main.querySelector('.community-management-page'),shell); assert.equal(list.lastElementChild.querySelector('[data-board-name]').textContent,'摄影讨论');
  assert.ok(list.lastElementChild.querySelector('[data-announcement]'),'appended row uses the existing icon set');
  assert.equal(calls.filter(call=>call.url.includes('/manage?')).length,1);
});
