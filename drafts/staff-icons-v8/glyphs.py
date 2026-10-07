# 把“总版主协管版”导出为轮廓，写入 glyphs.json，供 build.mjs 画名字用。
# 字体：Ma Shan Zheng（马善政楷书，Google Fonts 收录，SIL Open Font License 1.1）。
# 用法：python glyphs.py <MaShanZheng-Regular.ttf 的路径>。字体文件和 OFL.txt 不进仓库。
import hashlib
import json
import re
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

src = Path(sys.argv[1])
font = TTFont(src)
glyphs, cmap, top = font.getGlyphSet(), font.getBestCmap(), font['hhea'].ascent
k = 1000 / font['head'].unitsPerEm
out = {}
for ch in '总版主协管':
    name = cmap[ord(ch)]
    pen, box = SVGPathPen(glyphs), BoundsPen(glyphs)
    glyphs[name].draw(pen)
    glyphs[name].draw(box)
    d = ''
    for cmd, body in re.findall(r'([A-Za-z])([^A-Za-z]*)', pen.getCommands()):
        nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', body)]
        if cmd == 'H':
            d += 'H' + ' '.join(str(round(v * k)) for v in nums)
        elif cmd == 'V':
            d += 'V' + ' '.join(str(round((top - v) * k)) for v in nums)
        else:
            d += cmd + ' '.join(str(round((v if i % 2 == 0 else top - v) * k)) for i, v in enumerate(nums))
    x0, y0, x1, y1 = box.bounds
    out[ch] = {'d': d, 'box': [round(x0 * k), round((top - y1) * k), round(x1 * k), round((top - y0) * k)]}
meta = {'brush': {'font': 'Ma Shan Zheng Regular', 'licence': 'SIL Open Font License 1.1', 'sha256': hashlib.sha256(src.read_bytes()).hexdigest(), 'glyphs': out}}
Path(__file__).with_name('glyphs.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
print('brush', {c: v['box'] for c, v in out.items()}, meta['brush']['sha256'][:16])
