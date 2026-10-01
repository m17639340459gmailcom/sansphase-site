import React, { useState, useEffect, useRef } from "react";
import type { ComponentType, KeyboardEvent } from 'react';
export { socialIcon, socialPlatform, tagTone } from "./blog-details.mjs";
export { applyCardAppearance } from "./glass-theme.mjs";
export { mountMobileBlogOrder } from "./mobile-blog-order.mjs";
export { createBlogNotice } from "./blog-notice.mjs";
export { createBlogClock } from "./blog-clock.mjs";
export { createBlogWeather } from "./blog-weather.mjs";
export { createBlogPage } from "./blog-page.ts";
import { createRoot } from "react-dom/client";
import { flushSync, createPortal } from "react-dom";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import {filterTimezones,searchTimezoneCities,timezoneLabel} from './timezone-search.mjs';
import { Toaster, toast } from "sonner";
import A11yDialog from "a11y-dialog";
import GlassSurface from "./vendor/react-bits/GlassSurface.jsx";
import {
  createElement,
  Menu,
  GripVertical,
  ArrowRight,
  ArrowLeft,
  Download,
  Plus,
  X,
  Search,
  FileText,
  Grid2X2,
  List,
  Link,
  Sun,
  Moon,
  CalendarDays,
  CloudSun,
  UserRound,
  Music2,
  Disc3,
  Tags,
  Bell,
  MessagesSquare,
  Clock3,
  ChevronDown,
  ChevronUp,
  Check,
  Image as ImageIcon,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  CircleHelp, Box, Feather, Megaphone, Coffee, TrendingUp, MessageSquare, ChevronRight, BookOpen, Users, Lock, Pin, Award, Trash2, Send, Star, Copy,
  Eye, Flag, Gift, PenLine, ThumbsUp, Bookmark, Sunrise, ImagePlus, ShieldCheck,
  AtSign, LockOpen, ExternalLink, TriangleAlert, Ban, FolderInput, Ellipsis, Trophy, Crown, Bold, Code, Quote, Upload, Truck, Sparkles, Package, RotateCcw, Inbox,
} from "lucide";

const family = {
  menu: Menu,
  grip: GripVertical,
  right: ArrowRight,
  left: ArrowLeft,
  download: Download,
  plus: Plus,
  close: X,
  search: Search,
  document: FileText,
  grid: Grid2X2,
  list: List,
  link: Link,
  sun: Sun,
  moon: Moon,
  calendar: CalendarDays,
  "cloud-sun": CloudSun,
  user: UserRound,
  music: Music2,
  disc: Disc3,
  tags: Tags,
  bell: Bell,
  message: MessagesSquare,
  clock: Clock3,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  check: Check,
  image: ImageIcon,
  play: Play, pause: Pause, previous: SkipBack, next: SkipForward, volume: Volume2, muted: VolumeX,
  // Community boards and actions.
  help: CircleHelp, box: Box, feather: Feather, megaphone: Megaphone, coffee: Coffee, trending: TrendingUp,
  reply: MessageSquare, "chevron-right": ChevronRight, book: BookOpen, users: Users, lock: Lock, pin: Pin,
  award: Award, trash: Trash2, send: Send, star: Star, copy: Copy,
  eye: Eye, flag: Flag, gift: Gift, pen: PenLine, like: ThumbsUp, bookmark: Bookmark, sunrise: Sunrise, "image-plus": ImagePlus, shield: ShieldCheck,
  at: AtSign, unlock: LockOpen, external: ExternalLink, alert: TriangleAlert, ban: Ban, move: FolderInput, more: Ellipsis, trophy: Trophy, crown: Crown,
  bold: Bold, code: Code, quote: Quote, upload: Upload, truck: Truck, sparkles: Sparkles, package: Package, restore: RotateCcw, inbox: Inbox,
};
export const icon = (name: keyof typeof family, classes = "") =>
  createElement(family[name], {
    class: `ui-icon ${classes}`,
    "aria-hidden": "true",
    focusable: "false",
    "stroke-width": 1.6,
  }).outerHTML;
export const icons = Object.fromEntries(
  (Object.keys(family) as Array<keyof typeof family>).map((name) => [name, icon(name)]),
);
export const arrow = icon("right", "arrow");
export { toast };

export function mountToaster(container: Element) {
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <Toaster
        position="bottom-center"
        theme="dark"
        closeButton
        duration={4000}
        toastOptions={{
          style: {
            background: "var(--dialog-fill)",
            backdropFilter: "var(--dialog-blur)",
            border: "1px solid rgb(224 237 255 / 42%)",
            color: "#eff4ff",
            fontFamily: "inherit",
          },
        }}
      />,
    ),
  );
  return () => {
    toast.dismiss();
    root.unmount();
  };
}

export function createDialog(container: HTMLElement) {
  const dialog = new A11yDialog(container);
  const doc = container.ownerDocument;
  const priorInert = new Map<HTMLElement, boolean>();
  const setBackground = (value: boolean) => {
    doc.body.classList.toggle("dialog-open", value);
    for (const id of ["site-header", "home-stage", "main", "site-footer"]) {
      const node = doc.getElementById(id);
      if (node) {
        if (value) {
          priorInert.set(node, node.inert);
          node.inert = true;
        } else if (priorInert.has(node)) node.inert = priorInert.get(node) ?? false;
      }
    }
    if (!value) priorInert.clear();
  };
  const show = dialog.show.bind(dialog);
  dialog.show = (event) => {
    const wasShown = dialog.shown;
    show(event);
    if (!wasShown && dialog.shown) setBackground(true);
    return dialog;
  };
  dialog.on("hide", () => setBackground(false));
  dialog.on("destroy", () => setBackground(false));
  return dialog;
}

// Small adapters keep the existing content controller while Radix owns focus,
// keyboard selection and control state. Content and labels are site data.
type FilterOptions = {
  value: string;
  label: string;
  items: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

export function mountFilters(container: Element, options: FilterOptions) {
  const root = createRoot(container);
  const update = (value: string = options.value) =>
    flushSync(() =>
      root.render(
        <ToggleGroup.Root
          type="single"
          className="filters"
          value={value}
          aria-label={options.label}
          onValueChange={(next) => {
            if (next) options.onChange(next);
          }}
        >
          {options.items.map((item) => (
            <ToggleGroup.Item
              key={item.value}
              value={item.value}
              className="filter"
              data-category={item.value}
            >
              {item.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>,
      ),
    );
  update();
  return { update, dispose: () => root.unmount() };
}

// React Bits GlassSurface is the source of the visual card surface. The
// existing content renderer can keep its semantic anchors and article markup;
// this adapter mounts the published component inside each existing card.
export function mountGlassSurface(container: Element, html: string, className = "") {
  const root = createRoot(container);
  // Each host declares its corner radius in CSS (--card-radius); the upstream
  // component only accepts a number, so read it once at mount.
  const view = container.ownerDocument.defaultView;
  const radius = Number.parseFloat(view?.getComputedStyle(container).getPropertyValue("--card-radius") || "") || 0;
  // The upstream component explicitly accepts CSS width/height strings.
  const ResponsiveGlassSurface = GlassSurface as ComponentType<{
    width: string | number;
    height: string | number;
    borderRadius: number;
    borderWidth: number;
    brightness: number;
    opacity: number;
    blur: number;
    displace: number;
    backgroundOpacity: number;
    saturation: number;
    distortionScale: number;
    className: string;
    children: React.ReactNode;
  }>;
  flushSync(() =>
    root.render(
      <ResponsiveGlassSurface
        width="100%"
        height="auto"
        borderRadius={radius}
        borderWidth={0}
        brightness={28}
        opacity={0}
        blur={8}
        displace={0}
        backgroundOpacity={0}
        saturation={1.12}
        distortionScale={-70}
        className={`blog-third-party-glass ${className}`}
      >
        <div
          className="blog-third-party-glass-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </ResponsiveGlassSurface>,
    ),
  );
  return () => root.unmount();
}

type TimezoneChoice = { value: string; label: string };
type TimezoneSelectProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  locale?: string;
};

function TimezoneSelect({ value: initialValue, label, onChange, locale='zh-CN' }: TimezoneSelectProps) {
  const [value,setValue]=useState(initialValue),[open,setOpen]=useState(false),[query,setQuery]=useState('');
  const [cities,setCities]=useState<TimezoneChoice[]>([]),[searching,setSearching]=useState(false),[searchFailed,setSearchFailed]=useState(false),[active,setActive]=useState(0);
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),wasOpen=useRef(false);
  const zh=locale.startsWith('zh'),autoLabel=zh?'跟随设备时区':'Use device time zone';
  const results=[...(query.trim()?[]:[{value:'auto',label:autoLabel}]),...cities,...filterTimezones(query,locale)].filter((item,index,items)=>items.findIndex(x=>x.value===item.value)===index).slice(0,13);
  const choose=(next: string)=>{setValue(next);setOpen(false);setQuery('');onChange(next);trigger.current?.focus();};
  useEffect(()=>{
    setCities([]);setActive(0);setSearchFailed(false);
    if(!open||query.trim().length<2){setSearching(false);return;}
    const abort=new AbortController();setSearching(true);
    const timer=setTimeout(()=>searchTimezoneCities(query,{locale,signal:abort.signal}).then(rows=>{if(!abort.signal.aborted)setCities(rows);}).catch(()=>{if(!abort.signal.aborted)setSearchFailed(true);}).finally(()=>{if(!abort.signal.aborted)setSearching(false);}),250);
    return ()=>{clearTimeout(timer);abort.abort();};
  },[query,locale,open]);
  useEffect(()=>{
    if(!open)return;
    if (!trigger.current) return;
    const doc=trigger.current.ownerDocument;
    const surface=trigger.current.closest<HTMLElement>('.blog-third-party-glass'),previousInert=surface?.inert;
    if(surface)surface.inert=true;
    const outside=(event: PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);};
    input.current?.focus();doc.addEventListener('pointerdown',outside);
    return ()=>{doc.removeEventListener('pointerdown',outside);if(surface)surface.inert=previousInert ?? false;};
  },[open]);
  useEffect(()=>{if(wasOpen.current&&!open)trigger.current?.focus({preventScroll:true});wasOpen.current=open;},[open]);
  useEffect(()=>{if(!open)return;const option=panel.current?.querySelector<HTMLElement>('#timezone-result-'+active),list=option?.parentElement;if(option&&list){if(option.offsetTop<list.scrollTop)list.scrollTop=option.offsetTop;else if(option.offsetTop+option.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=option.offsetTop+option.offsetHeight-list.clientHeight;}},[active,open]);
  const keydown=(event: KeyboardEvent<HTMLDivElement>)=>{
    if(event.nativeEvent?.isComposing||event.nativeEvent?.keyCode===229)return;
    if(event.key==='Escape'){event.stopPropagation();setOpen(false);trigger.current?.focus();}
    if(event.target===input.current&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();if(results.length)setActive(i=>(i+(event.key==='ArrowDown'?1:-1)+results.length)%results.length);}
    if(event.target===input.current&&event.key==='Enter'){event.preventDefault();const selection=results[active]||results[0];if(selection)choose(selection.value);}
    if(event.key==='Tab'){setOpen(false);trigger.current?.focus();}
  };
  return <>
    <button ref={trigger} id="blog-timezone" className="timezone-select" type="button" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(x=>!x)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}><span>{value==='auto'?autoLabel:timezoneLabel(value,locale)}</span><span aria-hidden="true" dangerouslySetInnerHTML={{__html:icons['chevron-down']}} /></button>
    {open&&createPortal(<div ref={panel} className="blog-timezone-menu timezone-search-panel" data-state="open" role="dialog" aria-label={label} onKeyDown={keydown}>
      <div className="timezone-search-heading"><span>{zh?'选择时区':'Choose time zone'}</span><button type="button" aria-label={zh?'关闭时区搜索':'Close time zone search'} onClick={()=>setOpen(false)} dangerouslySetInnerHTML={{__html:icons.close}} /></div>
      <input ref={input} className="timezone-search-input" role="combobox" aria-label={zh?'搜索城市或时区':'Search city or time zone'} aria-expanded="true" aria-controls="timezone-results" aria-autocomplete="list" aria-activedescendant={results[active]?'timezone-result-'+active:undefined} value={query} onChange={event=>{setQuery(event.target.value);setCities([]);setActive(0);}} placeholder={zh?'搜索城市、地区或时区…':'Search cities, regions or time zones…'} autoComplete="off" />
      <div id="timezone-results" role="listbox" aria-label={zh?'匹配的时区':'Matching time zones'} className="timezone-search-results">{results.map((item,index)=><button key={item.value} id={'timezone-result-'+index} type="button" role="option" aria-selected={index===active} data-highlighted={index===active?'':undefined} className="timezone-option" tabIndex={-1} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(item.value)} onMouseEnter={()=>setActive(index)}>{item.label}</button>)}</div>
      <p className="timezone-search-status" role="status">{!query?(zh?'输入城市或地区名称，支持中英文搜索。':'Enter a city or an IANA time zone.'):searching?(zh?'正在搜索城市…':'Searching cities…'):searchFailed?(zh?'城市搜索暂不可用，仍可搜索时区名称。':'City search unavailable; time zone names still work.'):results.length===0?(zh?'未找到匹配地区，请尝试其他名称。':'No matching places. Try another name.'):(zh?'时间会按所选地区及夏令时自动计算。':'Local time includes daylight saving where applicable.')}</p>
    </div>,trigger.current!.closest('.blog-date-card')||trigger.current!.parentElement!)}
  </>;
}
export function mountTimezoneSelect(container: Element, options: TimezoneSelectProps) {
  const root = createRoot(container);
  flushSync(() => root.render(<TimezoneSelect {...options} />));
  return () => root.unmount();
}

export {enhanceArticleReading} from './article-reading.mjs';
