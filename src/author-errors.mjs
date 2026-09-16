import {uiText} from './ui-language.mjs';
const messages=new Map([
  ['请先登录作者账号。','Please sign in to your author account.'],
  ['请重新登录作者账号。','Your session has expired. Please sign in again.'],
  ['账号或密码不正确，或账号暂时锁定。','The email or password is incorrect, or the account is temporarily locked.'],
  ['这个账号没有个人网站的作者权限。','This account does not have author access.'],
  ['请求来源验证失败，请从本站操作。','The request origin could not be verified. Please use this site directly.'],
  ['内容已在其他窗口修改，请重新打开后编辑。','This content changed in another window. Reopen it before editing.'],
  ['保存失败，请检查网址名称是否重复以及必填内容。','Unable to save. Check required fields and use a unique URL slug.'],
  ['请填写标题。','Please enter a title.'],['请填写作者名称。','Please enter an author name.'],
  ['网址名称请使用小写英文、数字和短横线。','Use lowercase letters, numbers and hyphens for the URL slug.'],
  ['正文超过当前长度限制。','The body exceeds the current length limit.'],
  ['内容不存在。','Content not found.'],['文件不存在。','File not found.'],['作者资料不存在。','Author profile not found.'],
  ['文件编号无效。','Invalid file ID.'],['请选择文件。','Please select a file.'],
  ['文件太大，最多上传 25 MB。','The file is too large. The limit is 25 MB.'],
  ['请求内容太大。','The request is too large.'],['请求格式无效。','Invalid request format.'],
  ['不支持的内容类型。','Unsupported content type.'],['不支持的操作。','Unsupported operation.'],
  ['请选择保存草稿或发布。','Choose Save draft or Publish.'],['请先保存内容。','Please save the content first.'],
  ['本站播放列表只能选择音频文件。','The playlist only accepts audio files.'],
  ['已有文件正在上传，请等待完成后再上传下一个。','Another file is uploading. Wait for it to finish first.'],
  ['背景请选择图片。','Please select an image for the background.'],
  ['背景请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。','Select a PNG, JPEG, WebP, GIF or AVIF background image.'],
  ['请选择 MP3、M4A、OGG、WAV 或 FLAC 音频。','Select MP3, M4A, OGG, WAV or FLAC audio.'],
  ['作者服务暂时不可用，请稍后重试。','The author service is unavailable. Please try again later.'],
]);
export function authorError(message) {
  const original=String(message||'');
  return uiText(original,messages.get(original)||(/\p{Script=Han}/u.test(original)?'The operation could not be completed. Check the input and try again.':original));
}
