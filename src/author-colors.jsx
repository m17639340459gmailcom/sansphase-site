import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {HexColorPicker, HexColorInput} from "react-colorful";
import {cardAppearance, defaultCardColor, accentColors, colorConcentrations} from "./glass-theme.mjs";

const targets = [
  ["accentColor", "文字与图标"],
  ["cardColor", "卡片底色"],
  ["cardBorderColor", "卡片边框"],
  ["articleTextColor", "文章正文"],
  ["articleBackgroundColor", "阅读区底色"],
];
const presets = [
  ["星蓝", "#bfdfff"], ["淡紫", "#dac5ff"], ["薄荷", "#afe5d7"], ["暖杏", "#f3c9b1"],
  ["浅玫红", "#f4b8c8"], ["月白", "#eff6ff"], ["雾灰", "#abb9cc"], ["深空蓝", "#334968"],
];
export function mountCardColorPicker(host, initial, onChange) {
  let value = {...cardAppearance(initial), accent: Object.hasOwn(accentColors,initial?.accent) ? initial.accent : "blue"};
  const root = createRoot(host);
  const background = document.querySelector("#blog-backdrop img")?.src;
  function Picker() {
    const [settings,setSettings] = useState(value);
    const [target,setTarget] = useState("accentColor");
    const defaults = {accentColor:accentColors[settings.accent], cardColor:defaultCardColor, cardBorderColor:"#e0edff",articleTextColor:"#e2ecf9",articleBackgroundColor:"#071121"};
    const reading = target === "articleTextColor" || target === "articleBackgroundColor";
    const color = settings[target] || defaults[target];
    const channel = colorConcentrations[target];
    const update = next => { value=next; setSettings(next); onChange(); };
    const changeColor = selectedColor => update({...settings,[target]:selectedColor});
    const reset = () => update({...settings,[target]:"",[channel.key]:channel.fallback,...(target==="accentColor"?{accent:"blue"}:{})});
    return <section className="author-card-colors" aria-label="统一调色">
      <div className="author-color-targets" role="group" aria-label="选择调色对象">
        {targets.map(([key,label])=><button type="button" key={key} aria-pressed={target===key} onClick={()=>setTarget(key)}>{label}</button>)}
      </div>
      <p className="author-description">当前调整：{targets.find(([key])=>key===target)[1]}。每一项独立保存，切换对象不会丢失已选颜色。</p>
      <div className="author-color-presets" role="group" aria-label="预设颜色">
        {presets.map(([name,hex])=><button key={hex} type="button" aria-label={`预设颜色：${name}`} aria-pressed={color===hex} onClick={()=>changeColor(hex)}><span style={{background:hex}}/>{name}</button>)}
      </div>
      <div className="author-color-layout">
        <HexColorPicker color={color} onChange={changeColor} aria-label="共用调色板" />
        <div className="author-color-values">
          <label className="author-field">颜色代码<HexColorInput color={color} onChange={changeColor} prefixed aria-label="颜色代码" /></label>
          <div className="author-color-strength">
            <label className="author-field">{channel.label} <output>{Math.round(settings[channel.key]*100)}%</output><input type="range" min="0" max={channel.max*100} step="1" value={Math.round(settings[channel.key]*100)} aria-label={channel.label} onChange={e=>update({...settings,[channel.key]:Number(e.target.value)/100,...(target==="cardColor"?{cardColor:color}:{})})}/></label>
          </div>
          <button type="button" onClick={reset}>恢复此项默认</button>
        </div>
      </div>
      <div className="glass-preview-scene" data-reading={reading} style={{backgroundImage:background?`url(${JSON.stringify(background)})`:undefined,"--card-tint":settings.cardColor||defaultCardColor,"--card-opacity":settings.cardOpacity,"--accent-opacity":settings.accentOpacity,"--card-edge-opacity":settings.cardBorderOpacity,"--preview-accent":settings.accentColor||accentColors[settings.accent],"--preview-edge":settings.cardBorderColor||"#e0edff","--article-text-color":settings.articleTextColor||defaults.articleTextColor,"--article-text-opacity":settings.articleTextOpacity,"--article-background-color":settings.articleBackgroundColor||defaults.articleBackgroundColor,"--article-background-opacity":settings.articleBackgroundOpacity}}>
        <div className="glass-preview-card"><strong>{reading?"文章阅读预览":"卡片预览 · 点缀文字"}</strong><span>{reading?"记录每一次学习与发现。正文和阅读底色独立调整，手动标色的文字保留原色。":"底色、文字和边框在这里一起预览，保存后生效。"}</span></div>
      </div>
    </section>;
  }
  flushSync(()=>root.render(<Picker/>));
  host.querySelector('[aria-label="Color"]').setAttribute('aria-label','调色饱和度与亮度');
  host.querySelector('[aria-label="Hue"]').setAttribute('aria-label','调色色相');
  return {value:()=>value,dispose:()=>root.unmount()};
}
