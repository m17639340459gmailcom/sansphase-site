import {validTimezone} from './visitor-location.mjs';
import {timezoneCitiesZh} from './vendor/cldr/timezone-cities-zh.mjs';
const catalogs=new Map();
const chineseText=value=>typeof value==='string'&&/\p{Script=Han}/u.test(value)&&!/[A-Za-z]/.test(value);
function zoneName(zone,locale,type){
 return new Intl.DateTimeFormat(locale,{timeZone:zone,timeZoneName:type}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'';
}
export function timezoneLabel(zone,locale='zh-CN'){
 if(!validTimezone(zone))return zone;
 const offset=zoneName(zone,locale,'shortOffset');
 if(!locale.startsWith('zh'))return `${zone.replaceAll('_',' ')} · ${offset}`;
 const canonical=new Intl.DateTimeFormat('zh-CN',{timeZone:zone}).resolvedOptions().timeZone;
 if(canonical==='UTC')return '协调世界时';
 const city=timezoneCitiesZh[zone]||timezoneCitiesZh[canonical];
 const localOffset=offset.replace(/^(GMT|UTC)/,'协调时');
 if(city)return `${city} · ${localOffset}`;
 const generic=zoneName(zone,'zh-CN','longGeneric');
 return chineseText(generic)?`${generic} · ${localOffset}`:localOffset;
}
function catalog(locale){
 if(catalogs.has(locale))return catalogs.get(locale);
 const zones=new Set(['UTC',Intl.DateTimeFormat().resolvedOptions().timeZone,...(Intl.supportedValuesOf?.('timeZone')||[])]);
 const items=[...zones].filter(validTimezone).map(value=>{
  const names=['zh-CN','en-US'].map(lang=>new Intl.DateTimeFormat(lang,{timeZone:value,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'').join(' ');
  const label=timezoneLabel(value,locale);
  // Keep IANA codes searchable even when their visible labels are Chinese.
  return {value,label,search:(value+' '+value.replaceAll('_',' ')+' '+label+' '+names).normalize('NFKC').toLowerCase()};
 });
 catalogs.set(locale,items);return items;
}
export function filterTimezones(query,locale='zh-CN'){
 const text=query.trim().normalize('NFKC').toLowerCase().replace(/([+-])0(\d):/,'$1$2:');
 if(!text)return [];
 const result=catalog(locale).filter(x=>x.search.includes(text));
 if(validTimezone(query.trim())&&!result.some(x=>x.value===query.trim()))result.unshift({value:query.trim(),label:timezoneLabel(query.trim(),locale)});
 return result.slice(0,12);
}
export async function searchTimezoneCities(query,{locale='zh-CN',fetcher=fetch,signal}={}){
 if(query.trim().length<2||query.includes('/'))return [];
 const params=new URLSearchParams({name:query.trim(),count:'10',language:locale.startsWith('zh')?'zh':'en',format:'json'});
 const response=await fetcher('https://geocoding-api.open-meteo.com/v1/search?'+params,{signal});
 if(!response.ok)throw new Error('City search unavailable');
 const data=await response.json();
 return (data.results||[]).filter(city=>validTimezone(city.timezone)).map(city=>{
  let places=[city.name,city.admin1,city.country].filter(Boolean);
  if(locale.startsWith('zh')){
   let country=city.country;
   if(/^[a-z]{2}$/i.test(city.country_code||''))country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(city.country_code.toUpperCase());
   places=[city.name,city.admin1,country].filter(chineseText);
   // A provider may have no Chinese city translation. Describe its timezone,
   // without pretending the zone's exemplar city is the actual searched place.
   if(!chineseText(city.name))places.push('所用时区');
  }
  const prefix=[...new Set(places)].join(' · ');
  return {value:city.timezone,label:(prefix?prefix+' — ':'')+timezoneLabel(city.timezone,locale)};
 });
}
