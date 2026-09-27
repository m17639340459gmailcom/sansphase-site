import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTimezones,searchTimezoneCities,timezoneLabel} from '../src/timezone-search.mjs';

test('Chinese labels cover every supported timezone and still accept English codes',()=>{
 for(const zone of ['UTC',...Intl.supportedValuesOf('timeZone')]){
  assert.match(timezoneLabel(zone),/\p{Script=Han}/u,zone);
  assert.doesNotMatch(timezoneLabel(zone),/[A-Za-z_/]/,zone);
 }
 assert.match(timezoneLabel('America/New_York'),/纽约/);
 assert.match(timezoneLabel('Asia/Kolkata'),/加尔各答/);
 assert.match(timezoneLabel('Asia/Kathmandu'),/加德满都/);
 assert.match(timezoneLabel('Europe/Kyiv'),/基辅/);
 assert.match(timezoneLabel('UTC'),/协调世界时/);
 assert(filterTimezones('纽约').some(x=>x.value==='America/New_York'));
 assert(filterTimezones('America/New_York').some(x=>x.value==='America/New_York'&&x.label.includes('纽约')));
 assert.match(timezoneLabel('America/New_York','en-US'),/America\/New York/);
});
test('timezone search covers the device IANA database without a fixed city menu',()=>{
 assert.deepEqual(filterTimezones(''),[]);
 assert(filterTimezones('America/Los').some(x=>x.value==='America/Los_Angeles'));
 assert(filterTimezones('+05:45').some(x=>/Kat[h]?mandu/.test(x.value)));
 assert(filterTimezones('UTC').some(x=>x.value==='UTC'));
});
test('live city search uses the service timezone and rejects unsupported values',async()=>{
 const results=await searchTimezoneCities('北京',{fetcher:async url=>{
  assert.equal(new URL(url).searchParams.get('name'),'北京');
  return {ok:true,json:async()=>({results:[{name:'北京',country:'中国',timezone:'Asia/Shanghai'},{name:'无效',timezone:'not/a/timezone'}]})};
 }});
 assert.equal(results.length,1);assert.equal(results[0].value,'Asia/Shanghai');assert.match(results[0].label,/北京/);
});

test('city search stays Chinese even when the provider lacks a translated place name',async()=>{
 const results=await searchTimezoneCities('New York',{fetcher:async url=>{
  assert.equal(new URL(url).searchParams.get('language'),'zh');
  return {ok:true,json:async()=>({results:[{name:'纽约',admin1:'New York',country:'United States',country_code:'US',timezone:'America/New_York'},{name:'Small Town',admin1:'California',country:'United States',country_code:'US',timezone:'America/Los_Angeles'}]})};
 }});
 assert.equal(results.length,2);
 for(const row of results)assert.doesNotMatch(row.label,/[A-Za-z_/]/);
 assert.match(results[0].label,/纽约.*美国/);
 assert.match(results[1].label,/所用时区.*洛杉矶/);
 assert.equal(results[1].value,'America/Los_Angeles');
});
