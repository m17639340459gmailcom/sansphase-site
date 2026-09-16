import test from 'node:test';
import assert from 'node:assert/strict';
import {siteCopy,localizedResource} from '../src/site-copy.mjs';
test('reviewed site copy switches without altering the original or using stale translations',()=>{
  const title='AI 学习记录 · 本站模板';
  assert.equal(siteCopy(title,'en'),'AI learning journal · Site template');
  assert.equal(siteCopy(title,'zh'),title);
  assert.equal(siteCopy(title+'（已修改）','en'),title+'（已修改）');
  const item={title,summary:'空白记录表，包含学习目标、资料来源、实践结果和下一步。',category:'学习记录',bodyHTML:'<p>空白记录表，包含学习目标、资料来源、实践结果和下一步。</p>'};
  const original=structuredClone(item),result=localizedResource(item,'en');
  assert.deepEqual(item,original);
  assert.match(result.bodyHTML,/blank journal/);
  assert.equal(result.category,'学习记录','filter values stay stable across languages');
  assert.equal(result.categoryEn,'Learning journal');
});
