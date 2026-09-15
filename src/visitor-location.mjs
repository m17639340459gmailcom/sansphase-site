export function visitorTimezone(intl = Intl) {
  try { return intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
export function validTimezone(value) {
  try { return typeof value === 'string' && !!new Intl.DateTimeFormat('en', {timeZone:value}); }
  catch { return false; }
}
export function locateVisitor(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve,reject) => {
    if (!geolocation) return reject(new Error('浏览器不支持定位，请选择城市。'));
    geolocation.getCurrentPosition(({coords}) => {
      const {latitude,longitude} = coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180)
        return reject(new Error('定位结果无效，请选择城市。'));
      // Weather does not need a street-level position; never persist coordinates.
      resolve([Number(latitude.toFixed(2)), Number(longitude.toFixed(2)), '当前位置', 'Current location']);
    }, () => reject(new Error('未获得位置，请允许定位或搜索城市。')),
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
export async function searchWeatherCities(query, {fetcher=fetch, signal}={}) {
  if (query.trim().length < 2) return [];
  const params=new URLSearchParams({name:query.trim(),count:'6',language:'zh',format:'json'});
  const response=await fetcher('https://geocoding-api.open-meteo.com/v1/search?'+params,{signal});
  if (!response.ok) throw new Error('城市搜索暂时不可用，请稍后重试。');
  const data=await response.json();
  return (data.results||[]).filter(city => Number.isFinite(city.latitude) && Number.isFinite(city.longitude))
    .map(city=>[city.latitude,city.longitude,[city.name,city.admin1,city.country].filter(Boolean).join(' · '),city.name]);
}
