# 签到星图专用背景

2026-10-05，用户要求取消签到页卡片，并改成原神风格。本轮以「命之座」界面的蓝金星空语言为参考，使用内置 imagegen 全新生成背景。没有传入或导入游戏原图，没有使用 CLI 或外部图库。上一轮云雾背景已被替代，旧资产从当前演示素材中移除，可从上一提交恢复。

- 最终资产：`public/assets/community/checkin-astral-depth-v2.webp`。
- 原始生成尺寸：1774 × 887；网页资产：1600 × 800，WebP，38182 字节。
- 编码：沿用项目已有 sharp，仅缩小与压缩为 WebP（quality 86、effort 6）。
- 使用位置：每月签到星图的装饰背景。签到星点、连线、日期、已签状态和奖励仍由现有代码与数据决定。背景没有签到标记或文字，不参与交互。
- 设计意图：靛蓝深空、层次细微的远星、克制的蓝色光感，突出代码绘制的暖金星线。取消云雾环绕中央的构图，不用卡片外框包围星空。
- 视觉参考：[HoYoLAB 玩家分享的莫娜命之座实机截图](https://www.hoyolab.com/article/18087603)。参考其星空与界面方向，未复刻角色命之座形状或游戏标识。

## 最终生成提示词

```text
Use case: stylized-concept
Asset type: original background for a website monthly check-in constellation sky.
Primary request: a brand-new deep-space starfield with the elegant fantasy atmosphere of a Genshin Impact constellation menu, designed to sit behind a separately coded golden star path. Background ONLY. Create original artwork rather than reproducing any game screenshot.
Scene/backdrop: immense open midnight-blue and indigo space. Distinct layers of extremely fine distant stars and a few small silver starlights recede into a deep, quiet void. A very subtle, smooth cobalt luminosity through the mid-distance gives a magical celestial depth; a trace of muted violet at the far perimeter. It must feel like looking into a limitless enchanted cosmos.
Composition: panoramic horizontal 2:1. Open uncluttered middle covering at least 70% of the image, fine stars dispersed with organic uneven spacing and very low density. A few tiny softly radiant points around the outer areas, all much weaker than foreground constellation stars. No focal object, no clouds surrounding an empty center, no defined bands or visible structures. Sophisticated luminous darkness, not a flat black rectangle.
Style/medium: finely painted high-end fantasy game environment background, smooth deep blue light, delicate starlight, elegant and serene. Very subtle depth, minimal visible grain. No photorealistic nebula texture, no heavy swirling fog.
Color palette: rich deep indigo navy, restrained cobalt, faint silvery-white points. Subdued atmospheric light. No teal ocean tones and no neon purple.
Constraints: no text, no letters, no numbers, no logos, no watermark, no UI, no panels, no frames, no borders, no constellations or connecting lines, no large glowing stars, no characters, no planets, no moon, no ground or horizon.
Avoid: nebula clouds, Milky Way stripes, dusty cloudy wallpaper, galaxies, cracks or rifts, portals, tunnels, colorful explosions, smoke, mist, fantasy architecture, dense star noise, grids.
```

