export const defaultCardColor = "#eff6ff";
export const accentColors = { blue: "#bfdfff", violet: "#dac5ff", mint: "#afe5d7", peach: "#f3c9b1" };
const hexColor = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : "";
export const colorConcentrations = {
  accentColor: {key:"accentOpacity", label:"文字与图标浓度", fallback:1, max:1},
  cardColor: {key:"cardOpacity", label:"卡片底色浓度", fallback:.08, max:.6},
  cardBorderColor: {key:"cardBorderOpacity", label:"卡片边框浓度", fallback:.38, max:1},
  articleTextColor: {key:"articleTextOpacity", label:"文章正文浓度", fallback:1, max:1},
  articleBackgroundColor: {key:"articleBackgroundOpacity", label:"阅读区底色浓度", fallback:.64, max:1},
};
function concentration(value, {fallback,max}) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Math.max(0,Math.min(max,Number(value))) : fallback;
}
export function cardAppearance(value = {}) {
  return {
    accentColor: hexColor(value?.accentColor),
    accentOpacity: concentration(value?.accentOpacity,colorConcentrations.accentColor),
    cardBorderColor: hexColor(value?.cardBorderColor),
    cardBorderOpacity: concentration(value?.cardBorderOpacity,colorConcentrations.cardBorderColor),
    cardColor: hexColor(value?.cardColor),
    cardOpacity: concentration(value?.cardOpacity,colorConcentrations.cardColor),
    articleTextColor: hexColor(value?.articleTextColor),
    articleTextOpacity: concentration(value?.articleTextOpacity,colorConcentrations.articleTextColor),
    articleBackgroundColor: hexColor(value?.articleBackgroundColor),
    articleBackgroundOpacity: concentration(value?.articleBackgroundOpacity,colorConcentrations.articleBackgroundColor),
  };
}
export function applyCardAppearance(element, value) {
  const settings = cardAppearance(value);
  element.dataset.glassTint = settings.cardColor ? "custom" : "default";
  element.style.setProperty("--card-tint", settings.cardColor || defaultCardColor);
  element.style.setProperty("--card-opacity", String(settings.cardOpacity));
  element.dataset.customAccent = settings.accentColor || settings.accentOpacity !== 1 ? "true" : "false";
  element.dataset.customEdge = settings.cardBorderColor || settings.cardBorderOpacity !== .38 ? "true" : "false";
  element.style.setProperty("--accent-opacity",String(settings.accentOpacity));
  element.style.setProperty("--card-edge-opacity",String(settings.cardBorderOpacity));
  element.style.setProperty("--custom-accent", settings.accentColor || accentColors[value?.accent] || accentColors.blue);
  element.style.setProperty("--card-edge-color", settings.cardBorderColor || "#e0edff");
  element.dataset.customArticleText = settings.articleTextColor || settings.articleTextOpacity !== 1 ? "true" : "false";
  element.dataset.customArticleBackground = settings.articleBackgroundColor || settings.articleBackgroundOpacity !== .64 ? "true" : "false";
  element.style.setProperty("--article-text-color",settings.articleTextColor || "#e2ecf9");
  element.style.setProperty("--article-text-opacity",String(settings.articleTextOpacity));
  element.style.setProperty("--article-background-color",settings.articleBackgroundColor || "#071121");
  element.style.setProperty("--article-background-opacity",String(settings.articleBackgroundOpacity));
}
