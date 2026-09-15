import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadAuthorFile} from '../src/author-upload.mjs';
test('author upload reports transfer progress, errors and cancellation',async()=>{
  const original=globalThis.XMLHttpRequest;
  let request;
  globalThis.XMLHttpRequest=class {
    constructor(){this.upload={};request=this;}
    open(method,url){assert.equal(method,'POST');assert.equal(url,'/api/author/upload');}
    setRequestHeader(name,value){assert.equal(name,'X-Author-Request');assert.equal(value,'1');}
    send(){}
    abort(){this.onabort();}
  };
  try {
    const progress=[];const pending=uploadAuthorFile(new FormData(),{onProgress:value=>progress.push(value)});
    assert.equal(request.timeout,6*60*60*1000);
    request.upload.onprogress({lengthComputable:true,loaded:5,total:10});
    request.status=200;request.responseText='{"id":"saved"}';request.onload();
    assert.deepEqual(await pending,{id:'saved'});assert.deepEqual(progress,[50]);
    const failed=uploadAuthorFile(new FormData());request.status=413;request.responseText='{"error":"文件过大"}';request.onload();
    await assert.rejects(failed,/文件过大/);
    const controller=new AbortController();const cancelled=uploadAuthorFile(new FormData(),{signal:controller.signal});controller.abort();
    await assert.rejects(cancelled,/取消/);
  } finally {globalThis.XMLHttpRequest=original;}
});
