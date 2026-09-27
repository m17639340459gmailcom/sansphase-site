import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {catalogResults} from '../src/catalog.mjs';
import {mountVipBookPrompt,vipContactURL} from '../src/vip-book-prompt.mjs';

test('locked book cards prompt for VIP and the action uses the exact author QQ link', () => {
  const ui={t:(zh)=>zh,icons:{download:'',right:'',link:'',grid:'',search:''},tagTone:()=>''};
  const card=catalogResults('resource-center',[{id:'book',title:'书',summary:'简介',vipOnly:true,locked:true}],{category:'all',query:'',page:1,view:'grid'},ui);
  assert.match(card,/data-vip-book="1"/);
  assert.match(card,/catalog-vip-badge/);
  const dom=new JSDOM('<!doctype html><body></body>');
  const previous=globalThis.document;
  globalThis.document=dom.window.document;
  try {
    const prompt=mountVipBookPrompt();
    const action=dom.window.document.querySelector('.vip-book-dialog-actions a');
    assert.equal(action.href,vipContactURL);
    assert.equal(action.textContent,'开通 VIP');
    assert.equal(action.target,'');
    prompt.destroy();
  } finally {globalThis.document=previous;dom.window.close();}
});
