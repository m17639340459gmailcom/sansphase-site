import {weatherPanel,applyWeather} from './blog-weather-view.mjs';

// One owner for weather location, city search, forecast requests and cleanup.
// The view lives separately so changing card markup cannot change request flow.
export function createBlogWeather({
  document,window,navigator,restoredView,route,language,icons,escapeHTML:esc,
  locateVisitor,watchVisitorLocation,searchWeatherCities,localizeWeatherPlace,
  fetchWeather=globalThis.fetch?.bind(globalThis),
  now=()=>Date.now(),setTimeout:schedule=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout,
  afterLayout=callback=>window.requestAnimationFrame?.(callback)??window.setTimeout(callback,0),
}) {
  const t=(zh,en)=>language()==='en'?en:zh;
  let placeValue=null,locating=null,attempted=false,manual=false,locationGeneration=0;
  let cityResults=[],cityAbort,weatherAbort,weatherTimer,weatherKey='',weatherCache,stopWatch;
  let detailsOpen=restoredView.weatherOpen===true;
  let permission,permissionListener,bound=false;
  const place=()=>placeValue||[null,null,'等待定位','Location pending'];
  const state=()=>({weatherOpen:detailsOpen});
  const html=()=>weatherPanel({icons,t,place:place(),open:detailsOpen});
  const setText=(selector,text)=>{const node=document.querySelector(selector);if(node)node.textContent=text;};

  function stopForecast() {
    cancel(weatherTimer);weatherTimer=undefined;
    weatherAbort?.abort();weatherAbort=undefined;weatherKey='';
  }
  function stopWeather() {
    stopForecast();
    stopWatch?.();stopWatch=undefined;
  }
  function stop() {
    stopWeather();
    cityAbort?.abort();cityAbort=undefined;
  }
  function fail() {
    setText('[data-weather-value]',t('暂时无法获取','Unavailable'));
    setText('[data-weather-detail]',t('公开天气服务暂时没有响应。','The public weather service did not respond.'));
  }

  function requestLocation() {
    if(locating)return locating;
    attempted=true;
    const generation=++locationGeneration;
    setText('[data-weather-detail]',t('正在请求定位许可…','Requesting location permission…'));
    const pending=Promise.resolve().then(()=>locateVisitor(undefined,{locale:language()})).then(next=>{
      if(generation!==locationGeneration)return;
      placeValue=next;
      sync(route());
    }).catch(()=>{
      if(generation!==locationGeneration)return;
      setText('[data-weather-value]',t('请选择位置','Choose location'));
      setText('[data-weather-detail]',t('未获得位置，请允许定位或搜索城市。','Location unavailable. Allow location access or search for a city.'));
    }).finally(()=>{if(locating===pending)locating=null;});
    locating=pending;
    return pending;
  }
  function locate() {
    locationGeneration++;
    locating=null;
    manual=false;placeValue=null;
    stopWeather();
    return requestLocation();
  }
  function refreshCityLabel() {
    const original=placeValue,locale=language();
    if(!original?.[4])return;
    localizeWeatherPlace(original,{locale}).then(next=>{
      if(placeValue!==original||language()!==locale)return;
      placeValue=next;
      setText('[data-weather-location]',t(next[2],next[3]));
    }).catch(()=>{});
  }

  function sync(page) {
    stopForecast();
    if(page!=='notes'||document.hidden||typeof fetchWeather!=='function') {
      stopWatch?.();stopWatch=undefined;
      cityAbort?.abort();cityAbort=undefined;
      return;
    }
    if(!placeValue) {
      if(!attempted)return requestLocation();
      if(!locating) {
        setText('[data-weather-detail]',t('请允许定位或搜索城市。','Allow location or search a city.'));
        setText('[data-weather-value]',t('请选择位置','Choose location'));
      }
      return;
    }
    if(!manual&&!stopWatch)stopWatch=watchVisitorLocation(next=>{
      if(manual||document.hidden||route()!=='notes')return;
      if(next[0]===placeValue?.[0]&&next[1]===placeValue?.[1])return;
      placeValue=next;sync('notes');
    });
    const [latitude,longitude]=place();
    const key=`${latitude}:${longitude}:${language()}`;
    weatherKey=key;
    const controller=new AbortController();weatherAbort=controller;
    const valid=()=>!controller.signal.aborted&&weatherKey===key&&route()==='notes';
    const apply=data=>{if(valid())applyWeather({document,t,icons,place:place(),data});};
    const coordinatesKey=`${latitude}:${longitude}`;
    const age=now()-(weatherCache?.time||0);
    if(weatherCache?.key===coordinatesKey&&age<10*60*1000) {
      weatherTimer=schedule(()=>sync(route()),Math.max(1000,10*60*1000-age));
      try {apply(weatherCache.data);} catch {fail();}
      return;
    }
    weatherTimer=schedule(()=>sync(route()),10*60*1000);
    Promise.resolve().then(()=>fetchWeather(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,visibility,precipitation,surface_pressure,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=1&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`,{signal:controller.signal}))
      .then(response=>{if(!response.ok)throw Error(`weather ${response.status}`);return response.json();})
      .then(data=>{if(!valid())return;apply(data);weatherCache={key:coordinatesKey,time:now(),data};})
      .catch(()=>{if(valid())fail();});
  }

  async function searchCities(query) {
    const result=document.querySelector('[data-weather-cities]');
    if(!result)return;
    cityAbort?.abort();
    const controller=new AbortController();cityAbort=controller;
    result.textContent=t('正在搜索…','Searching…');
    try {
      const cities=await searchWeatherCities(query,{signal:controller.signal,locale:language()});
      if(!result.isConnected||controller.signal.aborted||route()!=='notes')return;
      cityResults=cities;
      result.innerHTML=cities.length?cities.map((city,index)=>`<button type="button" data-weather-city="${index}">${esc(city[2])}</button>`).join(''):t('没有找到，请尝试英文名或附近城市。','No results. Try another name or a nearby city.');
    } catch(error) {
      if(!controller.signal.aborted&&result.isConnected)result.textContent=error.message;
    }
  }
  function chooseCity(index,picker) {
    if(!cityResults[index])return false;
    locationGeneration++;
    manual=true;
    stopWatch?.();stopWatch=undefined;
    placeValue=cityResults[index];
    refreshCityLabel();
    cityAbort?.abort();cityAbort=undefined;
    if(picker)picker.open=false;
    sync(route());
    return true;
  }
  function toggleDetails(button) {
    const scrollY=window.scrollY;
    detailsOpen=!detailsOpen;
    const details=document.querySelector('#blog-weather-details');
    if(details)details.hidden=!detailsOpen;
    button.setAttribute('aria-expanded',String(detailsOpen));
    button.firstChild.textContent=`${detailsOpen?t('收起详情','Hide details'):t('查看详情','View details')} `;
    afterLayout(()=>{if(window.scrollY!==scrollY)window.scrollTo({top:scrollY,behavior:'instant'});});
  }
  function onVisibility() {
    if(document.hidden)sync(route());
    else if(route()==='notes') {
      if(manual)sync('notes');
      else requestLocation();
    }
  }
  function onClick(event) {
    if(event.target.closest('[data-action="weather-locate"]'))locate();
    const city=event.target.closest('[data-weather-city]');
    if(city)chooseCity(Number(city.dataset.weatherCity),city.closest('details'));
  }
  function onSubmit(event) {
    if(event.target.id!=='weather-city-search')return;
    event.preventDefault();
    searchCities(new window.FormData(event.target).get('city'));
  }
  function bind() {
    if(bound)return;
    bound=true;
    document.addEventListener('click',onClick);
    document.addEventListener('submit',onSubmit);
    document.addEventListener('visibilitychange',onVisibility);
    if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(result=>{
      if(!bound)return;
      permission=result;
      permissionListener=()=>{if(permission.state==='granted'&&!manual&&!document.hidden&&route()==='notes')requestLocation();};
      permission.addEventListener('change',permissionListener);
    }).catch(()=>{});
  }
  function dispose() {
    stop();
    bound=false;
    document.removeEventListener('click',onClick);
    document.removeEventListener('submit',onSubmit);
    document.removeEventListener('visibilitychange',onVisibility);
    if(permission&&permissionListener)permission.removeEventListener('change',permissionListener);
    permission=permissionListener=undefined;
  }
  return {html,state,place,sync,stop,locate,refreshCityLabel,searchCities,chooseCity,toggleDetails,bind,dispose};
}
