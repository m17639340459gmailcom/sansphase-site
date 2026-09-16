export function visitorTimezone(intl = Intl) {
  try { return intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
export function validTimezone(value) {
  try { return typeof value === 'string' && !!new Intl.DateTimeFormat('en', {timeZone:value}); }
  catch { return false; }
}
export function locateVisitor(geolocation = globalThis.navigator?.geolocation, {locale='zh'}={}) {
  const t=(zh,en)=>locale.startsWith('en')?en:zh;
  return new Promise((resolve,reject) => {
    if (!geolocation) return reject(new Error(t('浏览器不支持定位，请选择城市。','Your browser does not support location. Please choose a city.')));
    geolocation.getCurrentPosition(({coords}) => {
      const {latitude,longitude} = coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180)
        return reject(new Error(t('定位结果无效，请选择城市。','The location is invalid. Please choose a city.')));
      // Weather does not need a street-level position; never persist coordinates.
      resolve([Number(latitude.toFixed(2)), Number(longitude.toFixed(2)), '当前位置', 'Current location']);
    }, () => reject(new Error(t('未获得位置，请允许定位或搜索城市。','Location unavailable. Allow location access or search for a city.'))),
    {enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  });
}
export function watchVisitorLocation(onLocation,geolocation=globalThis.navigator?.geolocation){
 if(!geolocation?.watchPosition)return ()=>{};
 const id=geolocation.watchPosition(({coords:{latitude,longitude}})=>{
  if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180)
   onLocation([Number(latitude.toFixed(2)),Number(longitude.toFixed(2)),'当前位置','Current location']);
 },()=>{},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
 return ()=>geolocation.clearWatch(id);
}
export async function searchWeatherCities(query, {fetcher=fetch, signal,locale='zh'}={}) {
  if (query.trim().length < 2) return [];
  const english=locale.startsWith('en');
  const params=new URLSearchParams({name:query.trim(),count:'6',language:english?'en':'zh',format:'json'});
  const response=await fetcher('https://geocoding-api.open-meteo.com/v1/search?'+params,{signal});
  if (!response.ok) throw new Error(english?'City search is unavailable. Please try again later.':'城市搜索暂时不可用，请稍后重试。');
  const data=await response.json();
  return (data.results||[]).filter(city => Number.isFinite(city.latitude) && Number.isFinite(city.longitude))
    .map(city=>{
      const label=[city.name,city.admin1,city.country].filter(Boolean).join(' · ');
      return [city.latitude,city.longitude,label,label,city.id,[english?'en':'zh']];
    });
}
export async function localizeWeatherPlace(place,{locale='zh',fetcher=fetch,signal}={}) {
  const code=locale.startsWith('en')?'en':'zh';
  if(!Number.isInteger(place?.[4]) || place[5]?.includes(code)) return place;
  const response=await fetcher(`https://geocoding-api.open-meteo.com/v1/get?id=${place[4]}&language=${code}`,{signal});
  if(!response.ok)throw new Error('City lookup unavailable');
  const city=await response.json();
  if(city.id!==place[4] || !city.name)throw new Error('Invalid city lookup');
  const next=[...place];
  next[code==='en'?3:2]=[city.name,city.admin1,city.country].filter(Boolean).join(' · ');
  next[5]=[...new Set([...(place[5]||[]),code])];
  return next;
}
