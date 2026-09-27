import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundLibrary,changeBackground} from '../server/background-library.mjs';
const first='11111111-1111-4111-8111-111111111111', second='22222222-2222-4222-8222-222222222222';
test('existing background is retained, uploads can be selected, deletion is recoverable',()=>{
  const profile={background:first,background_library:[{id:second,name:'星空'}]};
  assert.equal(backgroundLibrary(profile).length,2);
  assert.throws(()=>changeBackground(profile,'remove',first), /先切换/);
  const switched={...profile,...changeBackground(profile,'use',second)};
  const removed={...switched,...changeBackground(switched,'remove',first,'2026-09-15')};
  assert.equal(removed.background,second);
  assert.equal(removed.background_library.find(x=>x.id===first).deletedAt,'2026-09-15');
  assert.throws(()=>changeBackground(removed,'use',first), /先恢复/);
  assert.equal(changeBackground(removed,'restore',first).background_library.find(x=>x.id===first).deletedAt,null);
  assert.equal(changeBackground(profile,'default').background,null);
});
