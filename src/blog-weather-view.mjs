// Weather card presentation only. Requests, permissions and timers live in
// blog-weather.mjs, so the page entry does not own either responsibility.
export function weatherText(code) {
  const labels={
    0:['晴朗','Clear sky'],1:['基本晴朗','Mainly clear'],2:['局部多云','Partly cloudy'],3:['阴天','Overcast'],
    45:['雾','Fog'],48:['雾凇','Rime fog'],51:['小毛毛雨','Light drizzle'],53:['毛毛雨','Drizzle'],55:['较强毛毛雨','Dense drizzle'],
    61:['小雨','Light rain'],63:['中雨','Rain'],65:['大雨','Heavy rain'],71:['小雪','Light snow'],73:['中雪','Snow'],75:['大雪','Heavy snow'],
    80:['阵雨','Rain showers'],81:['阵雨','Rain showers'],82:['强阵雨','Heavy showers'],95:['雷雨','Thunderstorm'],96:['雷雨伴冰雹','Thunderstorm with hail'],99:['强雷雨伴冰雹','Heavy thunderstorm with hail'],
  };
  return labels[code] || ['天气状况未知','Conditions unavailable'];
}

export function weatherGlyph(code,isDay=1,icons) {
  if(code===0)return isDay?icons.sun:icons.moon;
  if([1,2].includes(code))return isDay?icons['cloud-sun']:icons.moon;
  if([3,45,48,51,53,55,61,63,65,80,81,82].includes(code))return icons['cloud-sun'];
  if([95,96,99].includes(code))return icons.sun;
  return icons['cloud-sun'];
}

export function weatherPanel({icons,t,place,open}) {
  const [,,cityZh,cityEn]=place;
  return `<div class="blog-side-card blog-weather-card"><div class="weather-heading"><span class="eyebrow">${icons['cloud-sun']}${t('天气','WEATHER')}</span><span class="weather-source">${t('实时','LIVE')}</span></div><div class="weather-line"><span class="weather-orb" data-weather-glyph aria-hidden="true">${icons.sun}</span><div><strong data-weather-value>${t('正在获取…','Loading…')}</strong><span class="weather-location" data-weather-location>${t(cityZh,cityEn)}</span></div></div><div class="weather-range" data-weather-range>${t('最高 —°C · 最低 —°C','High —°C · Low —°C')}</div><button class="weather-details-toggle" data-action="weather-details" aria-expanded="${open}" aria-controls="blog-weather-details">${open?t('收起详情','Hide details'):t('查看详情','View details')} <span class="control-icon" aria-hidden="true">${icons.document}</span></button><div id="blog-weather-details" class="weather-details" ${open?'':'hidden'}><div><span>${t('风力','WIND')}</span><strong data-weather-wind>—</strong></div><div><span>${t('能见度','VISIBILITY')}</span><strong data-weather-visibility>—</strong></div><div><span>${t('湿度','HUMIDITY')}</span><strong data-weather-humidity>—</strong></div><div><span>${t('气压','PRESSURE')}</span><strong data-weather-pressure>—</strong></div><div><span>${t('降水量','PRECIPITATION')}</span><strong data-weather-precipitation>—</strong></div><div><span>${t('日出','SUNRISE')}</span><strong data-weather-sunrise>—</strong></div><div class="weather-attribution" aria-label="${t('数据来源','Data sources')}"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a><span aria-hidden="true">·</span><a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a><span aria-hidden="true">·</span><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></div></div><details class="weather-city-picker"><summary>${t('位置设置','Location')}</summary><button type="button" data-action="weather-locate">${icons.clock}${t('使用当前位置','Use my location')}</button><form id="weather-city-search"><label class="search"><input name="city" minlength="2" required aria-label="${t('搜索天气城市','Search weather city')}" placeholder="${t('城市名称','City name')}"></label><button type="submit">${icons.search}${t('搜索','Search')}</button></form><div data-weather-cities role="status"></div></details><p data-weather-detail>${t('正在连接公开天气服务。','Connecting to a public weather service.')}</p></div>`;
}

export function applyWeather({document,t,icons,place,data}) {
  if(!Number.isFinite(data.current?.temperature_2m)||!Number.isFinite(data.current?.weather_code))throw Error('Incomplete weather data');
  const current=data.current||{},daily=data.daily||{};
  const value=document.querySelector('[data-weather-value]');
  const detail=document.querySelector('[data-weather-detail]');
  const location=document.querySelector('[data-weather-location]');
  const [zh,en]=weatherText(current.weather_code);
  if(value)value.textContent=`${Math.round(Number(current.temperature_2m))}°C · ${t(zh,en)}`;
  if(location)location.textContent=t(place[2],place[3]);
  const set=(selector,text)=>{const node=document.querySelector(selector);if(node)node.textContent=text;};
  set('[data-weather-range]',t(`最高 ${Math.round(Number(daily.temperature_2m_max?.[0]))}°C · 最低 ${Math.round(Number(daily.temperature_2m_min?.[0]))}°C`,`High ${Math.round(Number(daily.temperature_2m_max?.[0]))}°C · Low ${Math.round(Number(daily.temperature_2m_min?.[0]))}°C`));
  set('[data-weather-wind]',`${Math.round(Number(current.wind_speed_10m)||0)} km/h`);
  set('[data-weather-visibility]',`${Math.round((Number(current.visibility)||0)/1000)} km`);
  set('[data-weather-humidity]',`${Math.round(Number(current.relative_humidity_2m)||0)}%`);
  set('[data-weather-pressure]',`${Math.round(Number(current.surface_pressure)||0)} hPa`);
  set('[data-weather-precipitation]',`${Number(current.precipitation||0).toFixed(1)} mm`);
  set('[data-weather-sunrise]',daily.sunrise?.[0]?daily.sunrise[0].split('T').pop().slice(0,5):'—');
  const glyph=document.querySelector('[data-weather-glyph]');
  if(glyph)glyph.innerHTML=weatherGlyph(current.weather_code,current.is_day,icons);
  if(detail)detail.textContent=t(`更新于 ${current.time?.replace('T',' ')||''}`,`Updated ${current.time?.replace('T',' ')||''}`);
}
