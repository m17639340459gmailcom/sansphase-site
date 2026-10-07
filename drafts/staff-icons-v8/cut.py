# 从带透明通道的原图 source-white.webp 里切出三档头像框和三枚身份徽标，清理边缘后写入 assets/，
# 并把每件的几何信息（环心、内孔半径、宝石位置等）写进 geometry.json，供 build.mjs 加动效用。
# 仅供预览，不是发布源码。
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from hole_fit import fit_hole_centroid

here = Path(__file__).parent
src = np.asarray(Image.open(here / 'source-white.webp').convert('RGBA')).astype(float)
(here / 'assets').mkdir(exist_ok=True)

# Where each piece sits in the sheet, found from the gaps between them.
frames = {'general': (39, 18, 554, 535), 'moderator': (569, 18, 1102, 535), 'assistant': (1145, 18, 1601, 535)}
badges = {'general': (110, 550, 475, 899), 'moderator': (666, 550, 1006, 899), 'assistant': (1247, 550, 1501, 899)}
SPREAD = 1.6  # a frame's canvas is this many hole radii from the centre to each side


def clean(rgba):
    """Solid art becomes fully opaque, the faint haze around it is dropped, and edge pixels take the colour of the
    art next to them, so nothing of the old background shows as a fringe on a light or a dark page."""
    a = np.clip((rgba[..., 3] - 18) / (244 - 18), 0, 1)
    rgb = rgba[..., :3].copy()
    solid = a >= 0.92
    for _ in range(3):
        todo = (a > 0) & ~solid
        if not todo.any():
            break
        acc, cnt = np.zeros_like(rgb), np.zeros(a.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(rgb * solid[..., None], dy, 0), dx, 1)
                cnt += np.roll(np.roll(solid, dy, 0), dx, 1)
        got = todo & (cnt > 0)
        rgb[got] = acc[got] / cnt[got][:, None]
        solid = solid | got
    return np.dstack([rgb, a * 255])


def canvas(rgba, cx, cy, half, box):
    """A square of the sheet centred on (cx, cy). Only what lies inside the piece's own box is copied, so nothing
    of its neighbours on the sheet comes along; the rest of the square stays transparent."""
    size = int(round(half * 2))
    out = np.zeros((size, size, 4))
    x0, y0 = int(round(cx - half)), int(round(cy - half))
    sx0, sy0, sx1, sy1 = max(x0, box[0]), max(y0, box[1]), min(x0 + size, box[2]), min(y0 + size, box[3])
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgba[sy0:sy1, sx0:sx1]
    return out


def drop_specks(arr, least=200):
    """Remove loose specks of paint left by the cut: anything not joined to the piece's main body and smaller than `least`."""
    solid = arr[..., 3] > 128
    for pts in blobs(solid, 1)[1:]:
        if len(pts) < least:
            xs, ys = pts[:, 0], pts[:, 1]
            arr[ys, xs, 3] = 0
    return arr


def hole_mask(alpha):
    """Transparent pixels joined to the middle of a frame canvas: the inside of the ring."""
    h, w = alpha.shape
    mask = np.zeros(alpha.shape, bool)
    queue = deque([(h // 2, w // 2)])
    mask[h // 2, w // 2] = True
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and alpha[ny, nx] < 128:
                mask[ny, nx] = True
                queue.append((ny, nx))
    return mask


def save(arr, name):
    arr = drop_specks(arr)
    image = Image.fromarray(arr.round().astype(np.uint8), 'RGBA')
    image.save(here / 'assets' / f'{name}.png', optimize=True)
    image.save(here / 'assets' / f'{name}.webp', quality=92, method=6)
    # A soft halo of the piece's own outline, drawn small: the breathing light behind it needs no filter at run time.
    alpha = image.getchannel('A').resize((160, 160), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    halo = Image.merge('RGBA', [Image.new('L', (160, 160), v) for v in (86, 150, 255)] + [alpha])
    halo.save(here / 'assets' / f'{name}-halo.webp', quality=70, method=6)
    return image.size[0]


def ray(alpha, cx, cy, ang, start, opaque):
    """Walk outward from the centre along one angle until the pixels stop being transparent (or stop being opaque)."""
    dx, dy, r = np.sin(np.radians(ang)), -np.cos(np.radians(ang)), start
    while True:
        x, y = int(round(cx + dx * r)), int(round(cy + dy * r))
        if not (0 <= x < alpha.shape[1] and 0 <= y < alpha.shape[0]) or (alpha[y, x] >= 128) != opaque:
            return r
        r += 0.5


def blobs(mask, least):
    seen, out = np.zeros(mask.shape, bool), []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        queue, pts = deque([(y, x)]), []
        while queue:
            cy, cx = queue.popleft()
            pts.append((cx, cy))
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if len(pts) >= least:
            out.append(np.array(pts))
    return sorted(out, key=len, reverse=True)


def gems(rgba, least):
    r, g, b, a = (rgba[..., i] for i in range(4))
    return blobs((a > 200) & (b > 150) & (b - r > 70) & (b - g > 30), least)


geometry = {'frames': {}, 'badges': {}}
sheet = clean(src)

for name, (x0, y0, x1, y1) in frames.items():
    alpha = src[y0:y1, x0:x1, 3]
    cx, cy = (x1 - x0) / 2, (y1 - y0) / 2
    cx, cy, hole = fit_hole_centroid(alpha, cx, cy)  # centre of the hole region, radius from its edge, see hole_fit.py
    outer = float(np.median([ray(alpha, cx, cy, ang, hole + 4, True) for ang in range(360)]))
    # the hairline outside the ring, where there is one: thin runs of art well clear of the ring
    thin = []
    for ang in range(360):
        dx, dy, r, run = np.sin(np.radians(ang)), -np.cos(np.radians(ang)), outer + 6, None
        while r < hole * SPREAD:
            x, y = int(round(cx + dx * r)), int(round(cy + dy * r))
            on = 0 <= x < alpha.shape[1] and 0 <= y < alpha.shape[0] and alpha[y, x] >= 128
            if on and run is None:
                run = r
            if not on and run is not None:
                if r - run <= 5:
                    thin.append((run + r) / 2)
                run = None
            r += 0.5
    half = hole * SPREAD
    size = save(canvas(sheet, x0 + cx, y0 + cy, half, (x0, y0, x1, y1)), f'frame-{name}')
    # self-check: the hole's own centre should land on the middle of the saved canvas
    hm = hole_mask(np.asarray(Image.open(here / 'assets' / f'frame-{name}.png'))[..., 3])
    hy, hx = np.nonzero(hm)
    print(name, 'hole centre offset from canvas middle (px):', round(float(hx.mean() - size / 2), 2), round(float(hy.mean() - size / 2), 2))
    unit = 200 / half  # canvas units per source pixel
    found = [{'x': round(float(200 + (p[:, 0].mean() - cx) * unit), 1), 'y': round(float(200 + (p[:, 1].mean() - cy) * unit), 1), 'size': round(float(np.sqrt(len(p)) * unit), 1)} for p in gems(src[y0:y1, x0:x1], 600)]
    geometry['frames'][name] = {'pixels': size, 'hole': round(hole * unit, 2), 'outer': round(outer * unit, 2), 'hairline': round(float(np.median(thin)) * unit, 2) if len(thin) > 40 else None, 'gems': found}
    print(name, 'frame', size, 'px', geometry['frames'][name])

for name, (x0, y0, x1, y1) in badges.items():
    piece = src[y0:y1, x0:x1]
    ys, xs = np.nonzero(piece[..., 3] > 40)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 * 1.06
    size = save(canvas(sheet, x0 + cx, y0 + cy, half, (x0, y0, x1, y1)), f'badge-{name}')
    unit = 120 / half
    found = [{'x': round(float(120 + (p[:, 0].mean() - cx) * unit), 1), 'y': round(float(120 + (p[:, 1].mean() - cy) * unit), 1), 'size': round(float(np.sqrt(len(p)) * unit), 1)} for p in gems(piece, 1500)]
    geometry['badges'][name] = {'pixels': size, 'gems': found}
    print(name, 'badge', size, 'px', geometry['badges'][name])

(here / 'geometry.json').write_text(json.dumps(geometry, ensure_ascii=False, indent=1), encoding='utf-8')

# contact sheets for checking the edges on a dark and a light page
for label, bg in (('dark', (12, 24, 48)), ('light', (243, 239, 230))):
    out = Image.new('RGB', (1800, 1000), bg)
    for i, name in enumerate(frames):
        f = Image.open(here / 'assets' / f'frame-{name}.png').resize((600, 600), Image.LANCZOS)
        b = Image.open(here / 'assets' / f'badge-{name}.png').resize((380, 380), Image.LANCZOS)
        out.paste(f, (i * 600, 0), f)
        out.paste(b, (i * 600 + 110, 610), b)
    out.save(here / f'check-{label}.png')
