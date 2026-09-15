import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import React from 'react';import {create} from '@react-three/test-renderer';import {Group,Mesh,BoxGeometry,InstancedBufferGeometry,ShaderMaterial} from 'three';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
await build({entryPoints:['src/library-glass.jsx'],outfile:'outputs/verification/glass-pass-test.mjs',bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/*','three','three/*','@react-three/*','motion']});
const {GlassSceneBuffer}=await import('../outputs/verification/glass-pass-test.mjs');
test('glass retains full-resolution multisampling and both refraction passes when cursor trails exist',async()=>{
 const group=new Group();const glass=new Mesh(new BoxGeometry(),new ShaderMaterial({uniforms:{tRefraction:{value:null},tVideo:{value:null}}}));glass.material.userData.referenceGlass=true;
 const tube=new Mesh(new InstancedBufferGeometry(),new ShaderMaterial({uniforms:{tRefraction:{value:null}}}));tube.material.userData.referenceTubes=true;tube.geometry.instanceCount=0;
 const parent=new Group();parent.add(tube);group.add(glass,parent);
 let target=null;const calls=[];const model={paused:false};
 const renderer=await create(React.createElement(GlassSceneBuffer,{model},React.createElement('primitive',{object:group})),{width:1920,height:1080,dpr:2,onCreated(s){s.gl.getRenderTarget=()=>target;s.gl.setRenderTarget=t=>target=t;s.gl.render=()=>calls.push({target,glass:glass.visible,tube:tube.visible});}});
 try {
  calls.length=0;await renderer.advanceFrames(1,1/60);assert.equal(calls.length,1);assert.equal(calls[0].glass,false);assert.equal(glass.visible,true);assert.equal(calls[0].target.width,3840);assert.equal(calls[0].target.height,2160);assert.equal(calls[0].target.samples,2);assert.equal(glass.material.uniforms.tRefraction.value,calls[0].target.texture);assert.equal(target,null);
  calls.length=0;tube.geometry.instanceCount=1;await renderer.advanceFrames(1,1/60);assert.equal(calls.length,2);assert.equal(calls[0].tube,false);assert.equal(calls[1].tube,true);assert.equal(tube.material.uniforms.tRefraction.value,calls[0].target.texture);assert.equal(glass.material.uniforms.tRefraction.value,calls[1].target.texture);assert.notEqual(calls[0].target,calls[1].target);
  calls.length=0;parent.visible=false;await renderer.advanceFrames(1,1/60);assert.equal(calls.length,1);assert.equal(parent.visible,false);
  calls.length=0;model.paused=true;await renderer.advanceFrames(1,1/60);assert.equal(calls.length,0);
 } finally {await renderer.unmount();glass.geometry.dispose();glass.material.dispose();tube.geometry.dispose();tube.material.dispose();}
});
