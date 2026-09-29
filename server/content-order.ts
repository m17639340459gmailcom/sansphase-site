const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const orderedContentKinds=['articles','works','resources','software','resource-center'];
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});

// New entries precede the saved sequence; existing entries keep their relative order.
export function applyContentOrder<T>(rows:T[], ids:unknown, key='id'):T[] {
  const rank=new Map((Array.isArray(ids)?ids:[]).map((id:string,index:number)=>[id,index]));
  const idOf=(row:T)=>(row as Record<string,unknown>)[key];
  return [...rows].sort((a,b)=>(rank.get(idOf(a) as string)??-1)-(rank.get(idOf(b) as string)??-1));
}
export function validateContentOrder(input:unknown,currentIds:string[]):string[] {
  const proposal=input as {ids?:unknown;expectedIds?:unknown}|null|undefined;
  const ids=proposal?.ids, expectedIds=proposal?.expectedIds;
  const valid=(ids:unknown):ids is string[]=>Array.isArray(ids)&&ids.length<=5000&&ids.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(ids).size===ids.length;
  if(!valid(ids)||!valid(expectedIds))throw fail('排序数据无效，请重新打开列表。');
  const expected=new Set(expectedIds),current=new Set(currentIds);
  if(ids.length!==expected.size||ids.some(id=>!expected.has(id)))throw fail('排序必须包含当前栏目全部内容，且不能重复。');
  if(ids.length!==current.size||ids.some(id=>!current.has(id)))throw fail('排序必须包含当前栏目全部内容，且不能重复。');
  if(currentIds.some((id,index)=>id!==expectedIds[index]))throw fail('列表已在其他窗口变化，请重新加载后排序。',409);
  return [...ids];
}
