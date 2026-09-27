import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {escapeHTML} from '../src/core.mjs';
import {createBlogWeather} from '../src/blog-weather.mjs';

const icons={sun:'SUN',moon:'MOON','cloud-sun':'CLOUD',document:'DOC',clock:'CLOCK',search:'SEARCH'};
const forecast={current:{temperature_2m:21,weather_code:0,is_day:1,wind_speed_10m:8,visibility:10000,relative_humidity_2m:65,surface_pressure:1010,precipitation:0,time:'2026-09-25T12:00'},daily:{temperature_2m_max:[24],temperature_2m_min:[18],sunrise:['2026-09-25T06:15']}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function setup(overrides={}) {
  const dom=new JSDOM('<main></main>',{url:'http://127.0.0.1:4177/#/notes',pretendToBeVisual:true});
  const {document}=dom.window;
  let page='notes',lang='zh',now=1000;
  const requests=[];
  const weather=createBlogWeather({
    document,window:dom.window,navigator:{},restoredView:{},
    route:()=>page,language:()=>lang,icons,escapeHTML,
    locateVisitor:async()=>[31.23,121.47,'当前位置','Current location'],
    watchVisitorLocation:()=>()=>{},
    searchWeatherCities:async()=>[],localizeWeatherPlace:async place=>place,
    fetchWeather:(_url,{signal})=>{const request=deferred();requests.push({signal,...request});return request.promise;},
    now:()=>now,setTimeout:()=>1,clearTimeout:()=>{},afterLayout:callback=>callback(),
    ...overrides,
  });
  document.querySelector('main').innerHTML=weather.html();
  return {dom,document,weather,requests,setPage:value=>{page=value;},setLanguage:value=>{lang=value;},setNow:value=>{now=value;}};
}

test('weather request is cancelled on route change and cannot write into a later card',async()=>{
  const env=setup();
  await env.weather.sync('notes');
  assert.equal(env.requests.length,1);
  env.setPage('works');
  env.weather.sync('works');
  assert.equal(env.requests[0].signal.aborted,true);
  env.requests[0].resolve({ok:true,json:async()=>forecast});
  await tick();
  assert.doesNotMatch(env.document.querySelector('[data-weather-value]').textContent,/21/);
  env.dom.window.close();
});

test('manual city selection wins over an older location result and reuses a fresh forecast',async()=>{
  const locate=deferred();
  let stopped=0;
  const env=setup({locateVisitor:()=>locate.promise,watchVisitorLocation:()=>()=>{stopped++;},searchWeatherCities:async()=>[[31.2,121.5,'上海','Shanghai',1796236,['zh']]]});
  env.weather.sync('notes');
  await env.weather.searchCities('Shanghai');
  env.weather.chooseCity(0);
  await tick();
  assert.equal(env.requests.length,1);
  env.requests[0].resolve({ok:true,json:async()=>forecast});
  await tick();
  assert.match(env.document.querySelector('[data-weather-value]').textContent,/21°C/);
  locate.resolve([40,100,'旧定位','Old location']);
  await tick();
  assert.equal(env.weather.place()[2],'上海');
  env.weather.stop();
  assert.equal(stopped,0,'manual selection never starts a location watcher');
  env.dom.window.close();
});

test('network error is visible, city search aborts on leave, and detail state persists',async()=>{
  const citySearch=deferred();
  const env=setup({searchWeatherCities:(_query,{signal})=>{env.citySignal=signal;return citySearch.promise;}});
  await env.weather.sync('notes');
  env.requests[0].reject(Error('network'));
  await tick();
  assert.match(env.document.querySelector('[data-weather-value]').textContent,/暂时无法获取/);
  const toggle=env.document.querySelector('[data-action="weather-details"]');
  env.weather.toggleDetails(toggle);
  assert.equal(env.weather.state().weatherOpen,true);
  const searching=env.weather.searchCities('London');
  env.weather.sync('works');
  assert.equal(env.citySignal.aborted,true);
  citySearch.resolve([[51.5,-.1,'伦敦','London']]);
  await searching;
  assert.equal(env.document.querySelectorAll('[data-weather-city]').length,0);
  env.dom.window.close();
});

test('weather behavior shares the UI bundle without an extra startup module',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');
  const app=await readFile('dist/app.mjs','utf8');
  const ui=await readFile('dist/ui.bundle.mjs','utf8');
  assert.doesNotMatch(app,/from ["']\.\/blog-weather\.mjs["']/);
  assert.match(ui,/createBlogWeather/);
  assert.ok(!(await readdir('dist')).includes('blog-weather.mjs'));
});
