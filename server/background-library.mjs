import { uuidPattern } from "./content-service.mjs";
export function backgroundLibrary(profile = {}) {
  const seen = new Set();
  const entries = (Array.isArray(profile.background_library) ? profile.background_library : [])
    .filter(item => uuidPattern.test(item?.id || "") && !seen.has(item.id) && seen.add(item.id))
    .map(item => ({id:item.id, name:String(item.name || "背景图片").slice(0,200), deletedAt:item.deletedAt || null}));
  if (uuidPattern.test(profile.background || "") && !seen.has(profile.background)) entries.unshift({id:profile.background,name:"当前背景",deletedAt:null});
  return entries;
}
export function changeBackground(profile, action, id, now = new Date().toISOString()) {
  const list = backgroundLibrary(profile);
  const item = list.find(item => item.id === id);
  const fail = message => { throw Object.assign(new Error(message), {status:409}); };
  if (action === "default") return {background:null,background_library:list};
  if (!item) fail("背景不存在，请重新打开背景库。");
  if (action === "use") {
    if (item.deletedAt) fail("请先恢复这张背景。");
    return {background:id, background_library:list};
  }
  if (action === "remove") {
    if (profile.background === id) fail("请先切换背景，再删除正在使用的图片。");
    item.deletedAt = now;
  } else if (action === "restore") item.deletedAt = null;
  else fail("不支持的背景操作。");
  return {background_library:list};
}
