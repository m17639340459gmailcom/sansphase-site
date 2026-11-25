import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
import {JSDOM} from 'jsdom';
import {catalogPage,catalogDetail} from '../src/catalog.mjs';

test('works titles use the complete Song font stack in hero, card and detail',async()=>{
  const item={id:'qingxie',title:'轻卸：Windows 卸载清理工具',category:'友人作品',coverSrc:'/api/media/test-cover',bodyHTML:'<p>正文</p>'};
  const ui={t:zh=>zh,icons:{},tagTone:()=>0};
  const css=postcss.parse(await readFile('src/catalog.css','utf8'));
  const rules=[];
  css.walkRules(rule=>{if(rule.nodes.some(n=>n.prop==='font-family'&&n.value==='var(--font-wordmark)'))rules.push(rule)});
  for(const [html,selector] of [[catalogPage('works',[item],{},ui),'.catalog-feature-copy h2'],[catalogPage('works',[item],{},ui),'.catalog-card-copy h2'],[catalogDetail('works',item,ui),'.reading-article > h1']]){
    const node=new JSDOM(html).window.document.querySelector(selector);
    assert.ok(node,selector);
    assert.ok(rules.some(rule=>node.matches(rule.selector)),`${selector}: title must avoid partial local Heavy font`);
  }
  const software=new JSDOM(catalogDetail('software',item,ui)).window.document.querySelector('h1');
  assert.ok(!rules.some(rule=>software.matches(rule.selector)),'works fix must not change other sections');
  const foundation=postcss.parse(await readFile('src/styles-foundation.css','utf8'));
  let stack='';foundation.walkDecls('--font-wordmark',d=>stack=d.value);
  assert.match(stack,/^"SimSun", "Songti SC", "STSong",/,'complete system Song families must precede optional local fonts');
});

