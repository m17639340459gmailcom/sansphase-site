import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAuthorOrder} from '../src/author-order.mjs';
test('drag drop stages the chosen position; keyboard, cancellation and busy state preserve control',()=>{
  const dom=new JSDOM('<div class="author-panel"><div class="author-item-list">'+['a','b','c'].map(id=>`<div data-order-id="${id}"><button data-order-handle draggable="true">Move</button><button data-edit="${id}">${id}</button></div>`).join('')+'</div></div>');
  const list=dom.window.document.querySelector('.author-item-list'),changes=[];let busy=false;
  const mounted=mountAuthorOrder(list,{onChange:ids=>changes.push(ids),isBusy:()=>busy});
  const handles=()=>[...list.querySelectorAll('[data-order-handle]')];
  const drag=(type,target,y=100)=>{const e=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientY:y,dataTransfer:{setData(){},setDragImage(){}}});target.dispatchEvent(e);return e;};
  drag('dragstart',handles()[0]);drag('dragover',list.lastChild);assert.equal(changes.length,0);
  drag('drop',list.lastChild);assert.deepEqual(mounted.ids(),['b','c','a']);assert.equal(changes.length,1);
  drag('dragstart',handles()[0]);drag('dragend',handles()[0]);assert.equal(changes.length,1);
  handles()[2].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.deepEqual(mounted.ids(),['a','b','c']);
  busy=true;assert(drag('dragstart',handles()[0]).defaultPrevented);drag('drop',list.lastChild);assert.deepEqual(mounted.ids(),['a','b','c']);
  mounted.dispose();busy=false;handles()[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.deepEqual(mounted.ids(),['a','b','c']);dom.window.close();
});
