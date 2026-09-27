import {uiText} from './ui-language.mjs';
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {HexColorPicker, HexColorInput} from "react-colorful";
import {cardAppearance, defaultCardColor, accentColors, colorConcentrations} from "./glass-theme.mjs";

const targets = () => [
  ["accentColor", uiText("文字与图标", "Text and icons")],
  ["cardColor", uiText("卡片底色", "Card background")],
  ["cardBorderColor", uiText("卡片边框", "Card border")],
  ["articleTextColor", uiText("文章正文", "Article body")],
  ["articleBackgroundColor", uiText("阅读区底色", "Reading background")],
];
const presets = () => [
  [uiText("星蓝", "Star blue"), "#bfdfff"], [uiText("淡紫", "Lavender"), "#dac5ff"], [uiText("薄荷", "Mint"), "#afe5d7"], [uiText("暖杏", "Apricot"), "#f3c9b1"],
  [uiText("浅玫红", "Rose"), "#f4b8c8"], [uiText("月白", "Moon white"), "#eff6ff"], [uiText("雾灰", "Mist gray"), "#abb9cc"], [uiText("深空蓝", "Deep blue"), "#334968"],
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
    const channelLabel=uiText(channel.label,({accentColor:"Text and icon opacity",cardColor:"Card background opacity",cardBorderColor:"Card border opacity",articleTextColor:"Article text opacity",articleBackgroundColor:"Reading background opacity"})[target]);
    const update = next => { value=next; setSettings(next); onChange(); };
    const changeColor = selectedColor => update({...settings,[target]:selectedColor});
    const reset = () => update({...settings,[target]:"",[channel.key]:channel.fallback,...(target==="accentColor"?{accent:"blue"}:{})});
    return <section className="author-card-colors" aria-label={uiText("统一调色", "Color settings")}>
      <div className="author-color-targets" role="group" aria-label={uiText("选择调色对象", "Choose a color target")}>
        {targets().map(([key,label])=><button type="button" key={key} aria-pressed={target===key} onClick={()=>setTarget(key)}>{label}</button>)}
      </div>
      <p className="author-description">{uiText("当前调整：", "Editing: ")}{targets().find(([key])=>key===target)[1]}{uiText("。每一项独立保存，切换对象不会丢失已选颜色。", ". Each setting is saved independently; switching targets keeps your selected colors.")}</p>
      <div className="author-color-presets" role="group" aria-label={uiText("预设颜色", "Color presets")}>
        {presets().map(([name,hex])=><button key={hex} type="button" aria-label={`${uiText("预设颜色：", "Preset: ")}${name}`} aria-pressed={color===hex} onClick={()=>changeColor(hex)}><span style={{background:hex}}/>{name}</button>)}
      </div>
      <div className="author-color-layout">
        <HexColorPicker color={color} onChange={changeColor} aria-label={uiText("共用调色板", "Shared color palette")} />
        <div className="author-color-values">
          <label className="author-field">{uiText("颜色代码", "Color code")}<HexColorInput color={color} onChange={changeColor} prefixed aria-label={uiText("颜色代码", "Color code")} /></label>
          <div className="author-color-strength">
            <label className="author-field">{channelLabel} <output>{Math.round(settings[channel.key]*100)}%</output><input type="range" min="0" max={channel.max*100} step="1" value={Math.round(settings[channel.key]*100)} aria-label={channelLabel} onChange={e=>update({...settings,[channel.key]:Number(e.target.value)/100,...(target==="cardColor"?{cardColor:color}:{})})}/></label>
          </div>
          <button type="button" onClick={reset}>{uiText("恢复此项默认", "Restore this default")}</button>
        </div>
      </div>
      <div className="glass-preview-scene" data-reading={reading} style={{backgroundImage:background?`url(${JSON.stringify(background)})`:undefined,"--card-tint":settings.cardColor||defaultCardColor,"--card-opacity":settings.cardOpacity,"--accent-opacity":settings.accentOpacity,"--card-edge-opacity":settings.cardBorderOpacity,"--preview-accent":settings.accentColor||accentColors[settings.accent],"--preview-edge":settings.cardBorderColor||"#e0edff","--article-text-color":settings.articleTextColor||defaults.articleTextColor,"--article-text-opacity":settings.articleTextOpacity,"--article-background-color":settings.articleBackgroundColor||defaults.articleBackgroundColor,"--article-background-opacity":settings.articleBackgroundOpacity}}>
        <div className="glass-preview-card"><strong>{reading?uiText("文章阅读预览", "Reading preview"):uiText("卡片预览 · 点缀文字", "Card preview · Accent text")}</strong><span>{reading?uiText("记录每一次学习与发现。正文和阅读底色独立调整，手动标色的文字保留原色。", "Record each discovery. Adjust body text and reading background independently. Manually colored text keeps its original color."):uiText("底色、文字和边框在这里一起预览，保存后生效。", "Preview the background, text and border together. Save to apply.")}</span></div>
      </div>
    </section>;
  }
  flushSync(()=>root.render(<Picker/>));
  host.querySelector('[aria-label="Color"]').setAttribute('aria-label',uiText("调色饱和度与亮度", "Color saturation and brightness"));
  host.querySelector('[aria-label="Hue"]').setAttribute('aria-label',uiText("调色色相", "Color hue"));
  return {value:()=>value,dispose:()=>root.unmount()};
}
