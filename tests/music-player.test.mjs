import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
test('real Plyr mounts controls, switches tracks, and disposes audio',async()=>{
  const dom=new JSDOM('<div id="player"></div>',{url:'http://127.0.0.1:4176/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.TextTrack=class TextTrack {};
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  let played=0,paused=0;
  const playing=new WeakSet();
  Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return !playing.has(this);}});
  w.HTMLMediaElement.prototype.play=function(){played++;playing.add(this);return Promise.resolve();};
  w.HTMLMediaElement.prototype.pause=function(){paused++;playing.delete(this);};
  w.HTMLMediaElement.prototype.load=function(){};
  w.HTMLMediaElement.prototype.canPlayType=()=> 'probably';
  const context=dom.getInternalVMContext(),cache=new Map();
  async function load(url){
    if(cache.has(url.href))return cache.get(url.href);
    const mod=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,identifier:url.href});
    cache.set(url.href,mod);await mod.link(name=>load(new URL(name,url)));return mod;
  }
  try {
    const mod=await load(new URL('../dist/music.bundle.mjs',import.meta.url)); await mod.evaluate();
    const host=w.document.querySelector('#player');
    const dispose=mod.namespace.mountMusicPlayer(host,[{title:'第一首',url:'https://example.com/one.mp3'},{title:'第二首',url:'https://example.com/two.mp3'}]);
    assert(host.querySelector('[data-plyr="play"]'));
    assert(host.querySelector('input[data-plyr="volume"]'));
    assert.equal(played,0,'does not autoplay on visit');
    host.querySelector('[data-next]').click();
    assert.equal(host.querySelector('.music-current').textContent,'第二首');
    assert.equal(host.querySelector('audio source').getAttribute('src'),'https://example.com/two.mp3');
    assert(played>0);
    host.querySelector('[data-prev]').click();
    assert.equal(host.querySelector('.music-current').textContent,'第一首');
    dispose(); assert(paused>0);
    const tracks=[{title:'持续播放',url:'https://example.com/stay.mp3'}];
    mod.namespace.mountSiteMusic(host,{tracks},()=>{});
    const persistent=host.querySelector('.site-music-player audio');persistent.currentTime=34;
    mod.namespace.toggleSiteMusic();assert.equal(persistent.paused,false);
    mod.namespace.parkSiteMusic();
    assert.equal(host.contains(persistent),false);
    mod.namespace.mountSiteMusic(host,{tracks},()=>{});
    assert.equal(host.querySelector('.site-music-player audio'),persistent);
    assert.equal(persistent.currentTime,34);
    mod.namespace.toggleSiteMusic();assert.equal(persistent.paused,true);
    mod.namespace.mountSiteMusic(null,{tracks:[]},()=>{});
    assert.equal(w.document.querySelector('.site-music-player'),null);
  } finally {dom.window.close();}
});
