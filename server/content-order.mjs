const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const orderedContentKinds=['articles','works','resources','software','resource-center'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

// New entries precede the saved sequence; existing entries keep their relative order.
export function applyContentOrder(rows, ids, key='id') {
  const rank=new Map((Array.isArray(ids)?ids:[]).map((id,index)=>[id,index]));
  return [...rows].sort((a,b)=>(rank.get(a[key])??-1)-(rank.get(b[key])??-1));
}
export function validateContentOrder(input,currentIds) {
  const valid=ids=>Array.isArray(ids)&&ids.length<=5000&&ids.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(ids).size===ids.length;
  if(!valid(input?.ids)||!valid(input?.expectedIds))throw fail('排序数据无效，请重新打开列表。');
  const expected=new Set(input.expectedIds),current=new Set(currentIds);
  if(input.ids.length!==expected.size||input.ids.some(id=>!expected.has(id)))throw fail('排序必须包含当前栏目全部内容，且不能重复。');
  if(input.ids.length!==current.size||input.ids.some(id=>!current.has(id)))throw fail('排序必须包含当前栏目全部内容，且不能重复。');
  if(currentIds.some((id,index)=>id!==input.expectedIds[index]))throw fail('列表已在其他窗口变化，请重新加载后排序。',409);
  return [...input.ids];
}
