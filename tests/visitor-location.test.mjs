import test from 'node:test';
import assert from 'node:assert/strict';
import {visitorTimezone,validTimezone,locateVisitor,searchWeatherCities,watchVisitorLocation} from '../src/visitor-location.mjs';
test('device time zone works outside the old eight-city list',()=>{
  assert.equal(visitorTimezone({DateTimeFormat:()=>({resolvedOptions:()=>({timeZone:'America/Los_Angeles'})})}),'America/Los_Angeles');
  assert.ok(validTimezone('Asia/Kathmandu')); assert.equal(validTimezone('bad-zone'),false);
});
test('live location updates discard invalid coordinates and stop their watcher',()=>{
 const updates=[];let callback,cleared;
 const stop=watchVisitorLocation(place=>updates.push(place),{watchPosition:fn=>{callback=fn;return 7;},clearWatch:id=>{cleared=id;}});
 callback({coords:{latitude:40.7128,longitude:-74.006}});
 callback({coords:{latitude:999,longitude:0}});
 assert.deepEqual(updates,[[40.71,-74.01,'当前位置','Current location']]);stop();assert.equal(cleared,7);
});
test('weather location uses permitted coordinates and minimizes precision',async()=>{
  assert.deepEqual(await locateVisitor({getCurrentPosition:success=>success({coords:{latitude:31.234567,longitude:121.456789}})}),[31.23,121.46,'当前位置','Current location']);
  await assert.rejects(locateVisitor({getCurrentPosition:(_ok,fail)=>fail()}),/未获得/);
  await assert.rejects(locateVisitor(null),/不支持/);
});
test('city search uses documented geocoding endpoint and handles failures',async()=>{
  const cities=await searchWeatherCities('上海',{fetcher:async url=>{assert.equal(new URL(url).searchParams.get('name'),'上海');return {ok:true,json:async()=>({results:[{name:'上海',latitude:31,longitude:121}]})};}});
  assert.equal(cities[0][0],31);
  await assert.rejects(searchWeatherCities('上海',{fetcher:async()=>({ok:false})}),/不可用/);
});
