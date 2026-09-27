import test from 'node:test';
import assert from 'node:assert/strict';
import { socialPlatform, tagTone } from '../src/blog-details.mjs';
import {normalizeSocialLink} from '../src/social-links.mjs';
import { cleanMusic, cleanAppearance } from '../server/profile-settings.mjs';
import { validateArticle } from '../server/author-service.mjs';
import { cleanBody } from '../server/content-service.mjs';
test('social identification uses actual hostname and rejects impersonation', () => {
  assert.equal(socialPlatform('https://v.douyin.com/E061MSnp8oM/').name, '抖音');
  assert.equal(socialPlatform('https://www.douyin.com/user/test').name, '抖音');
  assert.equal(socialPlatform('https://www.tiktok.com/@test').name, 'TikTok');
  assert.equal(socialPlatform('https://douyin.com.evil.example/a'), null);
  assert.equal(socialPlatform('https://space.bilibili.com/123').name, '哔哩哔哩');
  assert.equal(socialPlatform('https://mp.weixin.qq.com/s/123').name, '微信');
  assert.equal(socialPlatform('https://github.com.evil.example/a'), null);
  assert.equal(socialPlatform('https://github.com@evil.example'), null);
  assert.equal(socialPlatform('javascript:alert(1)'), null);
  assert.equal(tagTone('学习'), tagTone('学习'));
});
test('Douyin share captions and appended codes are excluded from the URL', () => {
  assert.equal(normalizeSocialLink('分享我的主页 https://v.douyin.com/E061MSnp8oM/ 8@8.com'), 'https://v.douyin.com/E061MSnp8oM/');
  assert.equal(normalizeSocialLink('https://v.douyin.com/E061MSnp8oM/%208@8.com'), 'https://v.douyin.com/E061MSnp8oM/');
  assert.equal(normalizeSocialLink('https://github.com/test?q=a%20b'), 'https://github.com/test?q=a%20b');
  assert.equal(normalizeSocialLink('https://douyin.com@evil.example/a'), '');
});
test('announcement links are optional even when CMS returns null', () => {
  for (const link of [null, '', undefined]) assert.equal(validateArticle({title:'公告',link}, 'announcements').link, '');
});
test('music settings keep share links separate from playable tracks and reject unsafe URLs', () => {
  const result = cleanMusic({playlistUrl:'https://t1.kugou.com/1bKaRccG5V3', tracks:[{url:'javascript:bad'},{title:'测试',url:'https://example.com/a.mp3'}]});
  assert.equal(result.tracks.length, 1);
  assert.equal(result.playlistUrl, 'https://t1.kugou.com/1bKaRccG5V3');
  assert.equal(cleanAppearance({accent:'url(evil)'}).accent, 'blue');
});
test('glass color settings preserve valid colors and constrain opacity', () => {
  assert.deepEqual(cleanAppearance({accent:'mint',cardColor:'#AABBDD',cardOpacity:.23}), {accent:'mint',accentColor:'',accentOpacity:1,cardBorderColor:'',cardBorderOpacity:.38,cardColor:'#aabbdd',cardOpacity:.23,articleTextColor:'',articleTextOpacity:1,articleBackgroundColor:'',articleBackgroundOpacity:.64});
  assert.equal(cleanAppearance({cardColor:'url(https://bad.example)'}).cardColor,'');
  assert.equal(cleanAppearance({cardOpacity:90}).cardOpacity,.6);
  assert.equal(cleanAppearance({cardOpacity:-1}).cardOpacity,0);
});
test('each color channel preserves its own concentration and accepts zero', () => {
  const value=cleanAppearance({accentOpacity:.72,cardBorderOpacity:.21,cardOpacity:.12});
  assert.equal(value.accentOpacity,.72);
  assert.equal(value.cardBorderOpacity,.21);
  assert.equal(value.cardOpacity,.12);
  for(const key of ['accentOpacity','cardBorderOpacity']) {
    assert.equal(cleanAppearance({[key]:0})[key],0);
    assert.equal(cleanAppearance({[key]:99})[key],1);
    assert.equal(cleanAppearance({[key]:-1})[key],0);
    assert.equal(cleanAppearance({[key]:'invalid'})[key],key==='accentOpacity'?1:.38);
  }
});
test('independent custom accents and edges are sanitized without losing legacy presets', () => {
  const appearance=cleanAppearance({accent:'violet',accentColor:'#BBAADD',cardBorderColor:'#AABBCC',cardColor:'#123456',cardOpacity:.15});
  assert.equal(appearance.accent,'violet');
  assert.equal(appearance.accentColor,'#bbaadd');
  assert.equal(appearance.cardBorderColor,'#aabbcc');
  assert.equal(appearance.cardColor,'#123456');
  assert.equal(cleanAppearance({accentColor:'red;position:fixed',cardBorderColor:'url(evil)'}).accentColor,'');
  assert.equal(cleanAppearance({cardBorderColor:'url(evil)'}).cardBorderColor,'');
});
test('editor color and font survive save and public render; layout CSS and URLs do not', () => {
  const saved = validateArticle({title:'文章',slug:'article',body:'<p><span style="color:#dac5ff;font-family:New Tegomin;font-size:20px;position:fixed;background:url(https://bad.example)">Hello 世界</span></p>'}, 'articles');
  const published = cleanBody(saved.body, 'http://127.0.0.1:8055', new Set());
  assert.match(published, /color:#dac5ff/);
  assert.match(published, /font-family:New Tegomin/);
  assert.doesNotMatch(published, /position|background|bad\.example/);
});
test('reading colors and concentrations are independent of listing cards', () => {
  const saved=cleanAppearance({cardColor:'#abcdef',cardOpacity:.1,articleTextColor:'#FEDCBA',articleTextOpacity:.8,articleBackgroundColor:'#112244',articleBackgroundOpacity:.75});
  assert.equal(saved.articleTextColor,'#fedcba');
  assert.equal(saved.articleTextOpacity,.8);
  assert.equal(saved.articleBackgroundColor,'#112244');
  assert.equal(saved.articleBackgroundOpacity,.75);
  assert.equal(saved.cardColor,'#abcdef');
  assert.equal(saved.cardOpacity,.1);
  assert.equal(cleanAppearance({articleTextColor:'url(evil)',articleBackgroundOpacity:3}).articleTextColor,'');
  assert.equal(cleanAppearance({articleBackgroundOpacity:3}).articleBackgroundOpacity,1);
});

import {filterItems} from '../src/core.mjs';
test('clickable tags can find articles by their tags, not just title',()=>{assert.equal(filterItems([{title:'文章',tags:['学习笔记']}],'all','学习笔记').length,1);});

test('uploaded audio is accepted but platform landing links cannot enter player sources',()=>{
 const result=cleanMusic({tracks:[{url:'/api/media/12345678-1234-1234-1234-123456789012'},{url:'https://t1.kugou.com/abc'},{url:'/api/media/../../private'},{url:'https://music.163.com/song?id=1'}]});
 assert.equal(result.tracks.length,1);
});
