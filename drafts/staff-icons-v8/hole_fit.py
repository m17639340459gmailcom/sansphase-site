# 头像框内孔的圆心和半径：从透明内孔的边缘射线出发，用 RANSAC 拟合圆，剔除顶部、底部宝石尖等伸进内孔的离群点。
# 之前按中心竖线拟合会被顶底宝石尖拉偏，这里不再使用中心竖线。
import numpy as np


def ray(alpha, cx, cy, ang, start=4.0):
    """Distance from (cx, cy) to the first opaque pixel along an angle (0 = up, clockwise)."""
    dx, dy, r = np.sin(np.radians(ang)), -np.cos(np.radians(ang)), start
    h, w = alpha.shape
    while True:
        x, y = int(round(cx + dx * r)), int(round(cy + dy * r))
        if not (0 <= x < w and 0 <= y < h) or alpha[y, x] >= 128:
            return r
        r += 0.5


def edge_points(alpha, cx, cy, step=0.5):
    pts = []
    for ang in np.arange(0, 360, step):
        r = ray(alpha, cx, cy, ang)
        pts.append((cx + np.sin(np.radians(ang)) * r, cy - np.cos(np.radians(ang)) * r))
    return np.array(pts)


def circle_through(p1, p2, p3):
    ax, ay = p1
    bx, by = p2
    cx, cy = p3
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return ux, uy, np.hypot(ax - ux, ay - uy)


def refit(pts):
    sol = np.linalg.lstsq(np.c_[2 * pts, np.ones(len(pts))], (pts ** 2).sum(1), rcond=None)[0]
    return sol[0], sol[1], float(np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2))


def fit_hole(alpha, cx0, cy0, rounds=3, trials=3000, tol=1.2, seed=7):
    rng = np.random.default_rng(seed)
    cx, cy = cx0, cy0
    for _ in range(rounds):
        pts = edge_points(alpha, cx, cy)
        best = None
        for _ in range(trials):
            i, j, k = rng.choice(len(pts), 3, replace=False)
            c = circle_through(pts[i], pts[j], pts[k])
            if c is None or not (60 < c[2] < 300):
                continue
            inl = np.abs(np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]) - c[2]) < tol
            if best is None or inl.sum() > best.sum():
                best = inl
        cx, cy, r = refit(pts[best])
    return cx, cy, r, int(best.sum()), len(pts)


def hole_region(alpha, sx, sy):
    """Transparent pixels joined to (sx, sy), as a boolean mask."""
    from collections import deque
    h, w = alpha.shape
    mask = np.zeros(alpha.shape, bool)
    mask[sy, sx] = True
    queue = deque([(sy, sx)])
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and alpha[ny, nx] < 128:
                mask[ny, nx] = True
                queue.append((ny, nx))
    return mask


def fit_hole_centroid(alpha, cx0, cy0, rounds=4):
    """Centre = centroid of the hole region, re-flooded from that centroid until it settles; radius = median edge distance.
    The centroid is not thrown off by a gem tip poking into the hole, and it does not depend on a single column or row."""
    cx, cy = int(round(cx0)), int(round(cy0))
    for _ in range(rounds):
        m = hole_region(alpha, cx, cy)
        ys, xs = np.nonzero(m)
        ncx, ncy = int(round(xs.mean())), int(round(ys.mean()))
        if (ncx, ncy) == (cx, cy):
            break
        cx, cy = ncx, ncy
    m = hole_region(alpha, cx, cy)
    ys, xs = np.nonzero(m)
    fx, fy = float(xs.mean()), float(ys.mean())
    edge = np.array([ray(alpha, fx, fy, ang, 4.0) for ang in np.arange(0, 360, 1.0)])
    r = float(np.median(edge))
    return fx, fy, r
