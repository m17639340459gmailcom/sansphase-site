// Owns the blog date card, its timezone choice, calendar and one-second timer.
// Page utilities are supplied by the existing UI entry to avoid another request.
export function createBlogClock({
  document, window, restoredView,
  visitorTimezone, validTimezone, mountTimezoneSelect,
  escapeHTML: esc, icons, t, english,
  now = () => new Date(),
  setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval,
  afterLayout = callback => window.requestAnimationFrame?.(callback) ?? window.setTimeout(callback,0),
}) {
  let localTimezone = visitorTimezone();
  let timezoneManual = restoredView.timezoneManual === true;
  let timezone = timezoneManual && validTimezone(restoredView.timezone) ? restoredView.timezone : localTimezone;
  let calendarOpen = restoredView.calendarOpen === true;
  let timer;
  let cleanTimezone;
  const locale = () => english() ? 'en-US' : 'zh-CN';
  const state = () => ({timezone,timezoneManual,calendarOpen});
  const clockText = () => new Intl.DateTimeFormat(locale(), {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:timezone}).format(now());
  const dayText = () => new Intl.DateTimeFormat(locale(), {month:'2-digit',day:'2-digit',timeZone:timezone}).format(now());

  function html() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now()).filter(({type})=>['year','month','day'].includes(type)).map(({type,value})=>[type,Number(value)]));
    const month = parts.month - 1;
    const firstDay = new Date(Date.UTC(parts.year,month,1,12)).getUTCDay();
    const days = new Date(Date.UTC(parts.year,month+1,0)).getUTCDate();
    const weekdays = english() ? ['S','M','T','W','T','F','S'] : ['日','一','二','三','四','五','六'];
    const cells = Array.from({length:firstDay+days},(_,position)=>{
      if(position<firstDay)return '<span class="calendar-empty" aria-hidden="true"></span>';
      const day=position-firstDay+1;
      return `<span class="calendar-day ${day===parts.day?'is-today':''}"${day===parts.day?' aria-current="date"':''}>${day}</span>`;
    }).join('');
    return `<div class="blog-side-card blog-date-card"><div class="date-panel-heading"><span class="eyebrow">${icons.clock}${t('时间与提醒','TIME & NOTE')}</span><button class="calendar-toggle" data-action="blog-calendar" aria-expanded="${calendarOpen}" aria-controls="blog-calendar-body">${calendarOpen?t('收起','Close'):t('日历','Calendar')} <span class="control-icon" aria-hidden="true">${icons.calendar}</span></button></div><div class="calendar-time" data-clock-time>${esc(clockText())}</div><div class="calendar-head"><strong data-clock-day>${esc(dayText())}</strong><span data-clock-zone>${esc(timezone)}</span></div><label class="timezone-label" for="blog-timezone">${t('当前时区','TIME ZONE')}</label><div id="blog-timezone-control"></div><div id="blog-calendar-body" class="calendar-body" ${calendarOpen?'':'hidden'}><div class="calendar-weekdays">${weekdays.map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><p>${t('下一节点 · 国庆节','Next marker · National Day')}</p></div></div>`;
  }

  function update() {
    const time=document.querySelector('[data-clock-time]');
    const date=document.querySelector('[data-clock-day]');
    if(!time||!date)return;
    time.textContent=clockText();
    date.textContent=dayText();
  }

  function stop() {
    if(timer)cancel(timer);
    timer=undefined;
  }
  function sync(page) {
    stop();
    if(page==='notes')timer=schedule(update,1000);
  }

  function changeTimezone(value) {
    timezoneManual=value!=='auto';
    timezone=value==='auto'?localTimezone:value;
    update();
    const zone=document.querySelector('[data-clock-zone]');
    if(zone)zone.textContent=timezone;
    const calendar=document.querySelector('#blog-calendar-body');
    if(calendar) {
      const next=document.createElement('div');
      next.innerHTML=html();
      calendar.innerHTML=next.querySelector('#blog-calendar-body').innerHTML;
    }
  }

  function refreshAutoTimezone() {
    if(timezoneManual)return;
    localTimezone=visitorTimezone();
    timezone=localTimezone;
    update();
    const zone=document.querySelector('[data-clock-zone]');
    if(zone)zone.textContent=timezone;
  }

  function toggleCalendar(button) {
    const scrollY=window.scrollY;
    calendarOpen=!calendarOpen;
    const body=document.querySelector('#blog-calendar-body');
    if(body)body.hidden=!calendarOpen;
    button.setAttribute('aria-expanded',String(calendarOpen));
    button.firstChild.textContent=`${calendarOpen?t('收起','Close'):t('日历','Calendar')} `;
    afterLayout(()=>{
      if(window.scrollY!==scrollY)window.scrollTo({top:scrollY,behavior:'instant'});
    });
  }

  function mount() {
    unmount();
    const host=document.querySelector('#blog-timezone-control');
    if(host)cleanTimezone=mountTimezoneSelect(host,{
      value:timezoneManual?timezone:'auto',
      locale:locale(),
      label:t('选择时区','Choose time zone'),
      onChange:changeTimezone,
    });
  }
  function unmount() {
    cleanTimezone?.();
    cleanTimezone=undefined;
  }

  return {html,state,update,sync,stop,mount,unmount,changeTimezone,refreshAutoTimezone,toggleCalendar};
}
