import {uiText} from './ui-language.mjs';
import {authorError} from './author-errors.mjs';
import {uploadTimeoutMs} from './upload-policy.mjs';
// Same authenticated endpoint as small uploads; XMLHttpRequest provides real
// transfer progress and cancellation without reading the file into JS memory.
export function uploadAuthorFile(data,{signal,onProgress=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST','/api/author/upload');
    xhr.setRequestHeader('X-Author-Request','1');
    xhr.timeout=uploadTimeoutMs;
    const abort=()=>xhr.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const end=()=>signal?.removeEventListener('abort',abort);
    xhr.upload.onprogress=event=>{if(event.lengthComputable) onProgress(Math.round(event.loaded/event.total*100));};
    xhr.onload=()=>{
      end();
      try {const value=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300) throw new Error(authorError(value.error)||uiText("上传失败。", "Upload failed."));resolve(value);}
      catch(error){reject(error);}
    };
    xhr.onerror=()=>{end();reject(new Error(uiText("网络中断，文件未完成上传，请重新选择重试。", "The connection was interrupted. Select the file again to retry.")));};
    xhr.ontimeout=()=>{end();reject(new Error(uiText("上传超时，请检查网络后重新上传。", "The upload timed out. Check your connection and try again.")));};
    xhr.onabort=()=>{end();reject(new Error(uiText("已取消上传。", "Upload canceled.")));};
    if(signal?.aborted){end();reject(new Error(uiText("已取消上传。", "Upload canceled.")));return;}
    xhr.send(data);
  });
}
