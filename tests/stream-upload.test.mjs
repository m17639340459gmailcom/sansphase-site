import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withStreamUpload,uploadLimits} from '../server/stream-upload.mjs';

test('upload policy permits 15 GiB attachments and keeps media limits',()=>{
  assert.deepEqual(uploadLimits,{maxFileBytes:15*1024**3,maxImageBytes:25*1024**2,maxAudioBytes:100*1024**2});
});
test('stream enforces exact boundary without Content-Length and cleans temporary files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sansphase-upload-boundary-'));
  const limits={maxFileBytes:1024,maxImageBytes:64,maxAudioBytes:128};
  const request=(size,type='application/octet-stream')=>{
    const req=Readable.from([
      Buffer.from(`--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: ${type}\r\n\r\n`),
      Buffer.alloc(size,37),Buffer.from('\r\n--boundary--\r\n')
    ]);
    req.headers={'content-type':'multipart/form-data; boundary=boundary'};
    return req;
  };
  try {
    await withStreamUpload(request(1024),directory,async file=>{
      assert.equal(file.size,1024);
      assert.deepEqual(await readFile(file.tempFilePath),Buffer.alloc(1024,37));
    },limits);
    for(const [size,type] of [[1025,'application/octet-stream'],[65,'image/png'],[129,'audio/mpeg']]) {
      await assert.rejects(withStreamUpload(request(size,type),directory,()=>assert.fail('oversize file saved'),limits),{status:413});
      assert.deepEqual(await readdir(join(directory,'incoming')),[]);
    }
    const oversized=request(1);oversized.headers['content-length']=String(15*1024**3+65537);
    await assert.rejects(withStreamUpload(oversized,directory,()=>assert.fail('oversize request consumed')),{status:413});
    await assert.rejects(withStreamUpload(request(10),directory,()=>{throw Error('storage failed');},limits),/storage failed/);
    assert.deepEqual(await readdir(join(directory,'incoming')),[]);
  } finally {await rm(directory,{recursive:true,force:true});}
});
