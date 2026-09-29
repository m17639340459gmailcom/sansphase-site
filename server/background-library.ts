import { uuidPattern } from "./content-service.ts";
type BackgroundItem={id:string;name:string;deletedAt:string|null};
type BackgroundProfile={background?:string|null;background_library?:unknown};
export function backgroundLibrary(profile:unknown = {}):BackgroundItem[] {
  const current=profile as BackgroundProfile;
  const seen = new Set();
  const entries:BackgroundItem[] = (Array.isArray(current.background_library) ? current.background_library : [])
    .filter((item:Record<string,unknown>) => uuidPattern.test(String(item?.id || "")) && !seen.has(item.id) && seen.add(item.id))
    .map((item:Record<string,unknown>) => ({id:String(item.id), name:String(item.name || "背景图片").slice(0,200), deletedAt:item.deletedAt ? String(item.deletedAt) : null}));
  if (typeof current.background==='string' && uuidPattern.test(current.background) && !seen.has(current.background)) entries.unshift({id:current.background,name:"当前背景",deletedAt:null});
  return entries;
}
export function changeBackground(profile:unknown, action:string, id:string, now = new Date().toISOString()) {
  const current=profile as BackgroundProfile;
  const list = backgroundLibrary(profile);
  const item = list.find(item => item.id === id);
  const fail = (message:string):never => { throw Object.assign(new Error(message), {status:409}); };
  if (action === "default") return {background:null,background_library:list};
  if (!item) return fail("背景不存在，请重新打开背景库。");
  if (action === "use") {
    if (item.deletedAt) fail("请先恢复这张背景。");
    return {background:id, background_library:list};
  }
  if (action === "remove") {
    if (current.background === id) fail("请先切换背景，再删除正在使用的图片。");
    item.deletedAt = now;
  } else if (action === "restore") item.deletedAt = null;
  else fail("不支持的背景操作。");
  return {background_library:list};
}
