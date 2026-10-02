# 中国国家图书馆 National Library of China, on 中关村南大街 by 紫竹院, built in Blender and marked with the
# bcity_landmark add-on's conventions: the 1987 总馆南区 (杨廷宝, 戴念慈, 张镈, 吴良镛, 黄远强; one of the ten
# great buildings of the 1980s) and the 2008 总馆北区 (二期, KSP Jürgen Engel) 230 m north of it.
#
#   blender -b -P scripts/blender/landmarks/nationallibrary.py -- [--out art/landmarks/nationallibrary.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, heading -5.57 (the edges of both OSM outlines). The plans are written in
# the frame of the south building (`S0`: game (-6880, -3640)) and moved by ORIGIN, the midpoint between the two
# buildings, so the far level's switch distance suits both.
#
# 南区 (OSM relation 6907054, one outline round the whole complex with two courtyards): the central book stack - two
# towers of 19 storeys, 64 m (北京日报 / Wikipedia) - stands in the middle, ringed by reading rooms, catalogue hall,
# lecture halls and offices of 2-6 storeys round courtyards, symmetric about the east-west axis of the main entrance
# on 中关村南大街. Pale grey-white tiles, peacock-blue (孔雀蓝) glazed tile eaves and roofs, granite steps (the
# photographs: Wikimedia Commons, the front from the avenue, the towers from the south-east). The heights per wing
# are read from those photographs: four storeys round the courtyards, the front and the catalogue hall higher, the
# lecture halls to the south lower. Every roof is a 盝顶: a glazed skirt round a flat top; the main wings carry a
# second, narrower skirt above the second floor. In front: the granite steps, the portico, three flagpoles and the
# stone with 中国国家图书馆.
#
# 北区 (OSM way 78051436): a stone podium with louvred bands, the recessed glazed reading-room floor over it, and the
# long "floating" box of the upper floors - glass between rounded aluminium rims, the ends in panels with scattered
# square windows - cantilevered 28 m east over the entrance on raking struts; the entrance steps are cut into the
# podium's east face. 27 m (二期 project figures).

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, T, collider_box, collider_pts, flat_marker  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "nationallibrary.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

HEADING = -5.57
S0 = (-6880.0, -3640.0)              # game x, z of the south building's frame
ORIGIN = (20.0, 125.0)               # the model's origin in that frame

# --- the south building's plan (OSM, in the S0 frame) ------------------------------------------------------
OUTER = [(-86.7, 99.6), (89.5, 99.6), (89.5, 77.3), (75.3, 77.3), (75.3, 46.8), (82.9, 46.8), (82.9, 7.8), (77.1, 7.8), (77.1, -27.4),
         (90.4, -27.4), (90.4, -48.8), (56.5, -48.8), (56.5, -42.2), (0.7, -42.2), (0.7, -52.3), (5.3, -52.3), (5.3, -56.9), (36.8, -56.9),
         (36.8, -78.4), (42.4, -78.4), (42.4, -95.0), (27.3, -95.0), (27.3, -78.8), (2.1, -78.8), (2.1, -87.0), (-15.5, -87.0), (-15.5, -79.3),
         (-40.6, -79.3), (-40.6, -94.5), (-56.4, -94.5), (-56.4, -80.6), (-50.4, -80.6), (-50.4, -59.5), (-18.4, -59.5), (-18.4, -52.4),
         (-16.0, -52.4), (-16.0, -44.4), (-87.4, -44.4), (-87.4, -29.6), (-69.5, -29.6), (-69.5, -16.4), (-87.5, -16.4), (-87.5, 0.7),
         (-48.0, 0.7), (-48.0, -14.7), (-32.6, -14.7), (-32.6, 67.5), (-48.5, 67.5), (-48.5, 49.2), (-86.6, 49.2), (-86.6, 70.0),
         (-70.2, 70.0), (-70.2, 82.0), (-86.7, 82.0)]
COURTS = [[(18.4, 75.5), (56.4, 75.1), (56.1, 48.2), (48.7, 48.3), (48.6, 42.9), (18.1, 43.2)],
          [(18.9, 9.5), (49.5, 9.3), (49.5, 6.3), (56.0, 6.3), (55.8, -18.4), (18.7, -18.2)]]
AXIS = 27.5                          # the east-west axis of the entrance
# the book stack: two towers and the link between them (x0, x1, y0, y1, top of the shaft)
TOWERS = [(-30.0, -2.0, 35.0, 50.0), (-30.0, -2.0, 5.0, 20.0)]
SHAFT, LINK = 52.0, 46.0
STOREY, BAY = 4.3, 3.9
MID = 9.4                            # the second skirt, over the second floor
PORCH = dict(x0=82.9, x1=87.6, y0=12.5, y1=42.5, floor=1.05, top=7.6)
STEPS = dict(x0=87.6, x1=91.6)
STONE = dict(x=108.0, y=AXIS, L=16.0, W=2.6, H=4.2)
KIOSK = dict(x0=124.0, x1=132.7, y0=-3.9, y1=7.2, h=4.2)   # OSM way 973220918, the metro entrance (the tiles made it 30 m)

# --- the north building (S0 frame) ----------------------------------------------------------------------
NB = dict(x0=-20.2, x1=85.1, y0=231.8, y1=347.2)              # the podium (OSM's main rectangle)
BOX = dict(x0=-20.2, x1=112.9, y0=241.6, y1=335.2, z0=15.5, z1=27.5, r=1.6)   # the floating box (OSM's whole outline)
POD_H, GLASS_IN = 9.5, 8.0
NOTCH = dict(y0=276.5, y1=300.5, back=71.0, land=74.0, top=3.6)


# --- textures ------------------------------------------------------------------------------------------

def office_images(size=512):
    """One bay by one storey of the old building: pale tiles, a window of four lights in a white frame, lit at night."""
    cv, glow = Canvas(size, size, "#d9dbd6"), Canvas(size, size, "#000000")
    cv.noise(0.05, 3)
    y, x = cv.y / size, cv.x / size
    cv.put(np.mod(cv.y, size / 10) < 1.3, cv.a[0, 0] * 0.95)
    cv.put(np.mod(cv.x, size / 6) < 1.3, cv.a[0, 0] * 0.96)
    win = (np.abs(x - 0.5) < 0.3) & (y > 0.24) & (y < 0.78)
    frame = (np.abs(x - 0.5) < 0.33) & (y > 0.21) & (y < 0.81) & ~win
    cv.put(frame, "#f1f1ec")
    glass = srgb("#34414c") + (0.12 * (y - 0.24))[..., None] * srgb("#93a8ba")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(np.mod((x - 0.2) / 0.6 * 4, 1.0) - 0.5) > 0.46) | (np.abs(y - 0.42) < 0.007))
    cv.put(bars, "#e8e9e4")
    cv.put((y > 0.84) & (y < 0.9) & (np.abs(x - 0.5) < 0.33), "#c4c8c4")
    rng = np.random.default_rng(4)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffd59c") * (0.25 + 0.35 * (rng.random((size, size), np.float32)[lit][:, None] > 0.45))
    return image("NL_Office", np.flipud(cv.a).copy()), image("NL_OfficeNight", np.flipud(glow.a).copy())


def stack_images(size=256):
    """The book stack's walls: 1.95 m by one 3.25 m storey, a narrow slot window, lit at night here and there."""
    cv, glow = Canvas(size, size, "#dcdeda"), Canvas(size, size, "#000000")
    cv.noise(0.04, 5)
    y, x = cv.y / size, cv.x / size
    cv.put(np.mod(cv.y, size / 6) < 1.2, cv.a[0, 0] * 0.95)
    win = (np.abs(x - 0.5) < 0.17) & (y > 0.2) & (y < 0.82)
    cv.put((np.abs(x - 0.5) < 0.2) & (y > 0.17) & (y < 0.85) & ~win, "#f0f0eb")
    cv.put(win, "#36424c")
    glow.put(win & (np.abs(y - 0.5) < 0.3), (0.18, 0.15, 0.1))
    return image("NL_Stack", np.flipud(cv.a).copy()), image("NL_StackNight", np.flipud(glow.a).copy())


def tile_image(size=128):
    """Peacock-blue glazed tiles: rolls down the slope (one every 0.4 m along the eave), courses across."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.72 + 0.28 * np.cos(np.pi * u * 2) ** 2
    course = 1 - 0.15 * (((v * 4) % 1) < 0.1)
    return image("NL_Tiles", srgb("#2e6f74") * (ridge * course)[..., None])


def podium_image(size=512):
    """The north building's podium: sandy stone in long courses, two bands of horizontal louvre slats (8 x 9.5 m)."""
    cv = Canvas(size, size, "#b9ab92")
    cv.noise(0.06, 7)
    y, x = cv.y / size, cv.x / size
    rows = (cv.y // (size / 12)).astype(int)
    cv.a *= np.random.default_rng(8).uniform(0.94, 1.05, (13, 1))[rows][..., 0][..., None]
    cv.put(np.mod(cv.y, size / 12) < 1.2, "#968a74")
    cv.put(np.mod(cv.x + (rows % 2) * size / 4, size / 2) < 1.2, "#9b8f78")
    for a, b in ((0.18, 0.4), (0.58, 0.8)):
        band = (y > a) & (y < b) & (np.abs(x - 0.5) < 0.46)
        cv.put(band, "#5f584c")
        cv.put(band & (np.mod(cv.y, size / 48) < 4.5), "#a69a83")
    return image("NL_Podium", np.flipud(cv.a).copy())


def endpanel_images(size=512):
    """The box's ends: aluminium panels in a grid, square windows scattered over them (13 x 12 m a repeat)."""
    cv, glow = Canvas(size, size, "#c9cdd0"), Canvas(size, size, "#000000")
    cv.noise(0.04, 9)
    n = 12
    cell = size / n
    cv.put((np.mod(cv.x, cell) < 1.3) | (np.mod(cv.y, cell) < 1.3), "#a7abae")
    rng = np.random.default_rng(12)
    on = rng.random((n, n)) < 0.13
    ci, cj = (cv.y // cell).astype(int), (cv.x // cell).astype(int)
    win = on[ci, cj] & (np.mod(cv.x, cell) > cell * 0.18) & (np.mod(cv.y, cell) > cell * 0.18)
    cv.put(win, "#3a4650")
    glow.put(win, (0.3, 0.24, 0.16))
    return image("NL_Ends", np.flipud(cv.a).copy()), image("NL_EndsNight", np.flipud(glow.a).copy())


# --- helpers -------------------------------------------------------------------------------------------

def wall(g, a, b, z0, z1, key, out, su=1.0, sv=1.0, zref=0.0):
    """A vertical face from plan point a to b; UVs: u along the wall (metres / su), v height (metres / sv)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ua, ub = a.dot(d) / su, b.dot(d) / su
    g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out[0], out[1], 0),
            uvs=[(ua, (z0 - zref) / sv), (ub, (z0 - zref) / sv), (ub, (z1 - zref) / sv), (ua, (z1 - zref) / sv)])


def snap(rings, tol=1.0):
    """Square the plan: coordinates within `tol` of each other on an axis become their mean."""
    def clusters(vals):
        vals = sorted(vals)
        groups, cur = [], [vals[0]]
        for v in vals[1:]:
            if v - cur[-1] <= tol:
                cur.append(v)
            else:
                groups.append(cur)
                cur = [v]
        groups.append(cur)
        m = {}
        for gr in groups:
            mean = round(sum(gr) / len(gr), 2)
            for v in gr:
                m[v] = mean
        return m
    mx = clusters([p[0] for r in rings for p in r])
    my = clusters([p[1] for r in rings for p in r])
    return [[(mx[x], my[y]) for x, y in r] for r in rings]


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % len(ring)]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c


def height_at(x, y):
    """The wall height of the south building at a cell centre (0 = outside or a courtyard)."""
    for x0, x1, y0, y1 in TOWERS:
        if x0 <= x <= x1 and y0 <= y <= y1:
            return SHAFT, "stack"
    if -26.0 <= x <= -6.0 and 20.0 <= y <= 35.0:
        return LINK, "stack"
    if x > 56.2 and x < 82.9 and 7.8 < y < 46.8:
        return 25.8, "office"                       # the entrance block
    if x > 75.0 and (y > 77.3 or y < -27.4):
        return 22.4, "office"                       # the corner pavilions
    if x > 56.2:
        return 19.4, "office"                       # the front range
    if 18.0 < x < 56.2 and 9.4 < y < 43.0:
        return 21.6, "office"                       # the catalogue hall between the courts
    if y < -48.0 or (y < -42.2 and x > 0.0):
        return 9.0, "office"                        # the lecture halls to the south
    if -32.6 < x < 18.0:
        return 19.4, "office"                       # round the book stack
    if y > 75.0 or y < -18.3:
        return 17.2, "office"                       # the north and south ranges
    return 13.0, "office"                           # the west wings


class Plan:
    """The south building as a grid of cells with heights; walls, skirts and colliders from its contours."""

    def __init__(self):
        rings = snap([OUTER] + COURTS)
        self.outer, self.courts = rings[0], rings[1:]
        xs = {p[0] for r in rings for p in r} | {-30.0, -26.0, -6.0, -2.0}
        ys = {p[1] for r in rings for p in r} | {5.0, 20.0, 35.0, 50.0}
        self.xs, self.ys = sorted(xs), sorted(ys)
        nx, ny = len(self.xs) - 1, len(self.ys) - 1
        self.h = [[0.0] * ny for _ in range(nx)]
        self.style = [[None] * ny for _ in range(nx)]
        for i in range(nx):
            for j in range(ny):
                c = ((self.xs[i] + self.xs[i + 1]) / 2, (self.ys[j] + self.ys[j + 1]) / 2)
                if inside(c, self.outer) and not any(inside(c, r) for r in self.courts):
                    self.h[i][j], self.style[i][j] = height_at(*c)
        self.nx, self.ny = nx, ny

    def H(self, i, j):
        return self.h[i][j] if 0 <= i < self.nx and 0 <= j < self.ny else 0.0

    def edges(self):
        """Directed boundary edges with the higher side on the left: (a, b, h, hn, style)."""
        out = []
        X, Y = self.xs, self.ys
        for i in range(self.nx):
            for j in range(self.ny):
                h = self.h[i][j]
                if h <= 0:
                    continue
                st = self.style[i][j]
                for (a, b, n) in (((X[i], Y[j]), (X[i + 1], Y[j]), (i, j - 1)), ((X[i + 1], Y[j]), (X[i + 1], Y[j + 1]), (i + 1, j)),
                                  ((X[i + 1], Y[j + 1]), (X[i], Y[j + 1]), (i, j + 1)), ((X[i], Y[j + 1]), (X[i], Y[j]), (i - 1, j))):
                    hn = self.H(*n)
                    if hn != h:
                        out.append((a, b, h, hn, st))
        return out

    def loops(self):
        """Each height level's boundary as loops of edges (a, b, hn)."""
        by_h = {}
        for a, b, h, hn, st in self.edges():
            by_h.setdefault(h, {}).setdefault(a, []).append((a, b, hn))
        loops = []
        for h, starts in by_h.items():
            while starts:
                a0 = next(iter(starts))
                e = starts[a0].pop()
                if not starts[a0]:
                    del starts[a0]
                loop = [e]
                while loop[-1][1] != a0 and loop[-1][1] in starts:
                    nxt = starts[loop[-1][1]].pop()
                    if not starts[loop[-1][1]]:
                        del starts[loop[-1][1]]
                    loop.append(nxt)
                loops.append((h, loop))
        return loops

    def rects(self):
        """The cells merged into rectangles of one height (for colliders and the far level)."""
        runs = []
        for j in range(self.ny):
            i = 0
            while i < self.nx:
                h = self.h[i][j]
                k = i
                while k + 1 < self.nx and self.h[k + 1][j] == h:
                    k += 1
                if h > 0:
                    runs.append([self.xs[i], self.xs[k + 1], self.ys[j], self.ys[j + 1], h])
                i = k + 1
        merged = []
        for r in runs:
            for m in merged:
                if m[0] == r[0] and m[1] == r[1] and m[4] == r[4] and abs(m[3] - r[2]) < 1e-6:
                    m[3] = r[3]
                    break
            else:
                merged.append(r)
        return merged


def segments(loop, test):
    """Merge a loop's consecutive collinear edges passing `test` into runs: (a, b, ok) with ok = test passed."""
    runs = []
    for a, b, hn in loop:
        ok = test(hn)
        d = (Vector(b) - Vector(a)).normalized()
        if runs and runs[-1][2] == ok and (Vector(runs[-1][1]) - Vector(runs[-1][0])).normalized().dot(d) > 0.999 and runs[-1][1] == a:
            runs[-1][1] = b
        else:
            runs.append([a, b, ok])
    if len(runs) > 1 and runs[0][2] == runs[-1][2] and runs[-1][1] == runs[0][0]:
        d0 = (Vector(runs[0][1]) - Vector(runs[0][0])).normalized()
        d1 = (Vector(runs[-1][1]) - Vector(runs[-1][0])).normalized()
        if d0.dot(d1) > 0.999:
            runs[0][0] = runs[-1][0]
            runs.pop()
    return runs


def skirt_ring(g, runs, z, out, inn, drop, rise, key="tile", soffit="white"):
    """
    A glazed skirt along the runs that pass (ok): from `out` metres outside the wall line at z - drop, through the wall
    line at z, up to `inn` metres inside at z + rise; mitred at corners to the next run that passes, flush where the
    next does not. A white soffit under its overhang and a fascia at its edge; a short upstand down from its inner edge.
    """
    n = len(runs)
    for k, (a, b, ok) in enumerate(runs):
        if not ok:
            continue
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        nrm = Vector((d.y, -d.x))
        pa, pb = runs[k - 1], runs[(k + 1) % n]
        dp = (Vector(pa[1]) - Vector(pa[0])).normalized()
        dn = (Vector(pb[1]) - Vector(pb[0])).normalized()
        os_, is_ = a + nrm * out, a - nrm * inn
        if pa[2] and n > 1:
            left = dp.x * d.y - dp.y * d.x > 0
            os_ = os_ - d * out if left else os_ + d * out
            is_ = is_ + d * inn if left else is_ - d * inn
        oe, ie = b + nrm * out, b - nrm * inn
        if pb[2] and n > 1:
            left = d.x * dn.y - d.y * dn.x > 0
            oe = oe + d * out if left else oe - d * out
            ie = ie - d * inn if left else ie + d * inn
        zo, zi = z - drop, z + rise
        L = (b - a).length
        ua, ub = a.dot(d) / 0.4, b.dot(d) / 0.4
        g.polyn([(os_.x, os_.y, zo), (oe.x, oe.y, zo), (ie.x, ie.y, zi), (is_.x, is_.y, zi)], key, (nrm.x, nrm.y, 3.0),
                uvs=[(ua - out / 0.4, 0), (ub + out / 0.4, 0), (ub, 1), (ua, 1)])
        g.polyn([(os_.x, os_.y, zo - 0.22), (oe.x, oe.y, zo - 0.22), (oe.x, oe.y, zo), (os_.x, os_.y, zo)], soffit, (nrm.x, nrm.y, 0))
        g.polyn([(os_.x, os_.y, zo - 0.22), (oe.x, oe.y, zo - 0.22), (b.x, b.y, zo - 0.22), (a.x, a.y, zo - 0.22)], soffit, (0, 0, -1))
        if inn > 0:
            g.polyn([(is_.x, is_.y, zi), (ie.x, ie.y, zi), (ie.x, ie.y, z), (is_.x, is_.y, z)], key, (-nrm.x, -nrm.y, 0),
                    uvs=[(0, 0), (L / 0.4, 0), (L / 0.4, 0.3), (0, 0.3)])
            g.polyn([(is_.x, is_.y, zi + 0.12), (ie.x, ie.y, zi + 0.12), (ie.x, ie.y, zi), (is_.x, is_.y, zi)], "tile", (-nrm.x, -nrm.y, 0))


def rod(g, a, b, r, key, segs=8):
    d = (b - a).normalized()
    u = d.cross(Vector((0, 0, 1)))
    if u.length < 1e-3:
        u = Vector((1, 0, 0))
    u.normalize()
    v = d.cross(u)
    ra = [g.vert(a + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    rb = [g.vert(b + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    for i in range(segs):
        k = (i + 1) % segs
        g.face([ra[i], ra[k], rb[k], rb[i]], key, smooth=True)


# --- the south building ----------------------------------------------------------------------------------

def build_south(g, plan):
    tris0 = g.tris()
    for a, b, h, hn, st in plan.edges():
        if hn > h:
            continue
        d = Vector(b) - Vector(a)
        out = (d.y / d.length, -d.x / d.length)
        if st == "stack":
            wall(g, a, b, hn, h, "stack", out, su=1.95, sv=3.25)
        else:
            wall(g, a, b, hn, h, "office", out, su=BAY, sv=STOREY)
    # the flat roofs
    X, Y = plan.xs, plan.ys
    for i in range(plan.nx):
        for j in range(plan.ny):
            h = plan.h[i][j]
            if h > 0:
                g.polyn([(X[i], Y[j], h), (X[i + 1], Y[j], h), (X[i + 1], Y[j + 1], h), (X[i], Y[j + 1], h)], "roof", (0, 0, 1))
    # the skirts: one round every roof where it stands 2 m or more over what is next to it, a second over the
    # second floor along the outside walls of the wings
    for h, loop in plan.loops():
        runs = segments(loop, lambda hn, h=h: h - hn >= 2.0)
        inn = 3.2 if h < SHAFT else 2.0
        skirt_ring(g, runs, h, 1.7 if h < 30 else 1.3, inn, 0.6, 0.35 * inn + 0.1)
        if 15.0 <= h < 30:
            runs = segments(loop, lambda hn: hn == 0.0)
            skirt_ring(g, runs, MID, 1.1, 0.0, 0.42, 0.0)
    # the book stack's top: a recessed storey under a second skirt, the lift house
    for x0, x1, y0, y1 in TOWERS:
        e = 2.4
        bx0, bx1, by0, by1 = x0 + e, x1 - e, y0 + e, y1 - e
        z0, z1 = SHAFT + 0.9, 58.6
        for a, b, out in (((bx0, by0), (bx1, by0), (0, -1)), ((bx1, by0), (bx1, by1), (1, 0)), ((bx1, by1), (bx0, by1), (0, 1)), ((bx0, by1), (bx0, by0), (-1, 0))):
            wall(g, a, b, SHAFT, z0, "white", out)
            wall(g, a, b, z0, z1, "band", out)
        runs = [[(bx0, by0), (bx1, by0), True], [(bx1, by0), (bx1, by1), True], [(bx1, by1), (bx0, by1), True], [(bx0, by1), (bx0, by0), True]]
        skirt_ring(g, runs, z1, 1.6, 1.8, 0.55, 0.9)
        g.polyn([(bx0, by0, z1), (bx1, by0, z1), (bx1, by1, z1), (bx0, by1, z1)], "roof", (0, 0, 1))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        lx, ly = 5.0, 3.6
        for a, b, out in (((cx - lx, cy - ly), (cx + lx, cy - ly), (0, -1)), ((cx + lx, cy - ly), (cx + lx, cy + ly), (1, 0)),
                          ((cx + lx, cy + ly), (cx - lx, cy + ly), (0, 1)), ((cx - lx, cy + ly), (cx - lx, cy - ly), (-1, 0))):
            wall(g, a, b, z1, 62.6, "white", out)
        runs = [[(cx - lx, cy - ly), (cx + lx, cy - ly), True], [(cx + lx, cy - ly), (cx + lx, cy + ly), True],
                [(cx + lx, cy + ly), (cx - lx, cy + ly), True], [(cx - lx, cy + ly), (cx - lx, cy - ly), True]]
        skirt_ring(g, runs, 62.6, 1.2, 1.4, 0.45, 0.8)
        g.polyn([(cx - lx, cy - ly, 62.6), (cx + lx, cy - ly, 62.6), (cx + lx, cy + ly, 62.6), (cx - lx, cy + ly, 62.6)], "roof", (0, 0, 1))
    # the entrance: a granite platform, the steps, piers carrying a canopy, the doors
    P, S = PORCH, STEPS
    g.box(P["x0"], P["x1"], P["y0"], P["y1"], 0.0, P["floor"], "granite", skip=("-z", "-x"))
    n = 6
    for k in range(n):
        x = S["x1"] - (k + 1) * (S["x1"] - S["x0"]) / n
        g.box(x, S["x1"] - k * (S["x1"] - S["x0"]) / n, P["y0"] - 1.0, P["y1"] + 1.0, 0.0, P["floor"] * (k + 1) / n, "granite", skip=("-z", "-x"))
    for k in range(6):
        y = P["y0"] + 1.2 + k * (P["y1"] - P["y0"] - 2.4) / 5
        g.box(P["x1"] - 1.5, P["x1"] - 0.5, y - 0.5, y + 0.5, P["floor"], P["top"], "white", skip=("-z", "+z"))
    g.box(P["x0"], P["x1"] + 0.3, P["y0"] - 0.3, P["y1"] + 0.3, P["top"], P["top"] + 0.7, "white", skip=("-x",))
    runs = [[(P["x1"] + 0.3, P["y0"] - 0.3), (P["x1"] + 0.3, P["y1"] + 0.3), True]]
    skirt_ring(g, runs, P["top"] + 0.7, 0.9, 0.0, 0.3, 0.0)
    wall(g, (P["x0"] + 0.06, P["y0"] + 3.0), (P["x0"] + 0.06, P["y1"] - 3.0), P["floor"], 7.0, "door", (1, 0))
    # three flagpoles and the flag
    for k, y in enumerate((AXIS - 5.0, AXIS, AXIS + 5.0)):
        x = 97.0
        g.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, 0.0, 0.5, "granite", skip=("-z",))
        top = 22.0 if k == 1 else 20.0
        rod(g, Vector((x, y, 0.5)), Vector((x, y, top)), 0.09, "steel", segs=6)
        if k == 1:
            g.polyn([(x, y, top - 0.4), (x, y + 4.2, top - 0.6), (x, y + 4.2, top - 3.2), (x, y, top - 3.2)], "red", (1, 0, 0))
            g.polyn([(x, y, top - 0.4), (x, y + 4.2, top - 0.6), (x, y + 4.2, top - 3.2), (x, y, top - 3.2)], "red", (-1, 0, 0))
    # the stone with the name, on its lawn
    st = STONE
    hw, hd = st["L"] / 2, st["W"] / 2
    stone = Geo()
    prof = [(-hw, 0.0), (-hw - 0.3, 1.2), (-hw + 0.4, st["H"] - 0.5), (-hw + 2.0, st["H"]), (hw - 3.0, st["H"] + 0.3), (hw - 0.6, st["H"] - 0.6), (hw + 0.2, 1.4), (hw, 0.0)]
    for (ya, za), (yb, zb) in zip(prof, prof[1:]):
        stone.polyn([(hd, ya, za), (hd, yb, zb), (-hd, yb, zb), (-hd, ya, za)], "granite", (0, (ya + yb) / 2 * 0.1, 1 if za + zb > 1 else 0))
    stone.polyn([(hd, y, z) for y, z in prof], "granite", (1, 0, 0))
    stone.polyn([(-hd, y, z) for y, z in prof], "granite", (-1, 0, 0))
    g.add(stone, T(st["x"], st["y"], 0))
    lawn = [(st["x"] + 2.0 + 13.0 * math.cos(2 * math.pi * k / 24), st["y"] + 13.0 * math.sin(2 * math.pi * k / 24), 0.05) for k in range(24)]
    g.polyn(lawn, "lawn", (0, 0, 1))
    # the metro entrance in the forecourt: glass under a white roof with a glazed edge
    K = KIOSK
    for a, b, out in (((K["x0"], K["y0"]), (K["x1"], K["y0"]), (0, -1)), ((K["x1"], K["y0"]), (K["x1"], K["y1"]), (1, 0)),
                      ((K["x1"], K["y1"]), (K["x0"], K["y1"]), (0, 1)), ((K["x0"], K["y1"]), (K["x0"], K["y0"]), (-1, 0))):
        wall(g, a, b, 0.0, K["h"] - 0.6, "door", out, su=1.0, sv=1.0)
        wall(g, a, b, K["h"] - 0.6, K["h"], "white", out)
    g.polyn([(K["x0"], K["y0"], K["h"]), (K["x1"], K["y0"], K["h"]), (K["x1"], K["y1"], K["h"]), (K["x0"], K["y1"], K["h"])], "roof", (0, 0, 1))
    runs = [[(K["x0"], K["y0"]), (K["x1"], K["y0"]), True], [(K["x1"], K["y0"]), (K["x1"], K["y1"]), True],
            [(K["x1"], K["y1"]), (K["x0"], K["y1"]), True], [(K["x0"], K["y1"]), (K["x0"], K["y0"]), True]]
    skirt_ring(g, runs, K["h"], 0.9, 0.9, 0.35, 0.4)
    return g.tris() - tris0


# --- the north building ----------------------------------------------------------------------------------

def box_section(r, segs=3):
    """The box's rounded section in (y offset from a long side, z): from the soffit round the edge to the top."""
    B = BOX
    pts = []
    for k in range(segs + 1):
        a = -math.pi / 2 - (math.pi / 2) * k / segs          # bottom edge: from under to the side
        pts.append((r + r * math.cos(a), B["z0"] + r + r * math.sin(a)))
    top = []
    for k in range(segs + 1):
        a = math.pi - (math.pi / 2) * k / segs                # top edge: from the side up to over
        top.append((r + r * math.cos(a), B["z1"] - r + r * math.sin(a)))
    return pts, top


def build_north(g, M):
    B, N, NO = BOX, NB, NOTCH
    tris0 = g.tris()
    # the podium: walls round OSM's main rectangle with the entrance cut into its east face, a terrace on top
    for a, b, out in (((N["x0"], N["y0"]), (N["x1"], N["y0"]), (0, -1)), ((N["x1"], N["y1"]), (N["x0"], N["y1"]), (0, 1)),
                      ((N["x0"], N["y1"]), (N["x0"], N["y0"]), (-1, 0)),
                      ((N["x1"], N["y0"]), (N["x1"], NO["y0"]), (1, 0)), ((N["x1"], NO["y1"]), (N["x1"], N["y1"]), (1, 0))):
        wall(g, a, b, 0.0, POD_H, "podium", out, su=8.0, sv=POD_H)
    wall(g, (N["x1"], NO["y1"]), (NO["back"], NO["y1"]), 0.0, POD_H, "podium", (0, -1), su=8.0, sv=POD_H)
    wall(g, (NO["back"], NO["y0"]), (N["x1"], NO["y0"]), 0.0, POD_H, "podium", (0, 1), su=8.0, sv=POD_H)
    wall(g, (NO["back"], NO["y0"]), (NO["back"], NO["y1"]), NO["top"], POD_H, "lobby", (1, 0))
    for x0, x1, y0, y1 in ((N["x0"], N["x1"], N["y0"], NO["y0"]), (N["x0"], N["x1"], NO["y1"], N["y1"]), (N["x0"], NO["back"], NO["y0"], NO["y1"])):
        g.polyn([(x0, y0, POD_H), (x1, y0, POD_H), (x1, y1, POD_H), (x0, y1, POD_H)], "terrace", (0, 0, 1))
    # the steps up into the notch and the landing
    n = 12
    for k in range(n):
        xa = N["x1"] - (k + 1) * (N["x1"] - NO["land"]) / n
        xb = N["x1"] - k * (N["x1"] - NO["land"]) / n
        g.box(xa, xb, NO["y0"], NO["y1"], 0.0, NO["top"] * (k + 1) / n, "granite", skip=("-z", "-x", "-y", "+y"))
    g.polyn([(NO["back"], NO["y0"], NO["top"]), (NO["land"], NO["y0"], NO["top"]), (NO["land"], NO["y1"], NO["top"]), (NO["back"], NO["y1"], NO["top"])], "granite", (0, 0, 1))
    # the glazed reading-room floor, recessed over the podium
    gx0, gx1, gy0, gy1 = B["x0"] + GLASS_IN, N["x1"] - GLASS_IN, B["y0"] + GLASS_IN, B["y1"] - GLASS_IN
    for a, b, out in (((gx0, gy0), (gx1, gy0), (0, -1)), ((gx1, gy0), (gx1, gy1), (1, 0)), ((gx1, gy1), (gx0, gy1), (0, 1)), ((gx0, gy1), (gx0, gy0), (-1, 0))):
        wall(g, a, b, POD_H, B["z0"], "lobby", out)
    # the floating box: a rounded section along the long sides, flat ends with their panels
    r, segs = B["r"], 3
    bot, top = box_section(r, segs)
    prof = bot + top                                          # (y offset in from the south side, z)
    L0, L1 = B["x0"], B["x1"]
    W = B["y1"] - B["y0"]
    for side in (-1, 1):
        def P(o, z, x):
            y = B["y0"] + o if side < 0 else B["y1"] - o
            return (x, y, z)
        for k in range(len(prof) - 1):
            (oa, za), (ob, zb) = prof[k], prof[k + 1]
            if k == segs:                                     # the straight side: glass between aluminium bands
                for z0, z1, key in ((za, 17.6, "alu"), (17.6, 25.4, "glass"), (25.4, zb, "alu")):
                    pa, pb, pc, pd = P(oa, z0, L0), P(oa, z0, L1), P(oa, z1, L1), P(oa, z1, L0)
                    g.polyn([pa, pb, pc, pd], key, (0, side, 0), uvs=[(L0, z0), (L1, z0), (L1, z1), (L0, z1)])
                continue
            mid = ((oa + ob) / 2, (za + zb) / 2)
            want = (0, side * (r - mid[0]), mid[1] - (B["z0"] + r if mid[1] < (B["z0"] + B["z1"]) / 2 else B["z1"] - r))
            g.polyn([P(oa, za, L0), P(oa, za, L1), P(ob, zb, L1), P(ob, zb, L0)], "alu", want, smooth=True)
    for z, want in ((B["z0"], -1), (B["z1"], 1)):
        g.polyn([(L0, B["y0"] + r, z), (L1, B["y0"] + r, z), (L1, B["y1"] - r, z), (L0, B["y1"] - r, z)], "soffit" if want < 0 else "roof", (0, 0, want))
    # the ends: the section's outline as one face each
    for x, out in ((L0, -1), (L1, 1)):
        ring = [(B["y0"] + o, z) for o, z in prof] + [(B["y1"] - o, z) for o, z in reversed(prof)]
        g.polyn([(x, y, z) for y, z in ring], "ends", (out, 0, 0), uvs=[((y - B["y0"]) / 13.0, (z - B["z0"]) / 12.0) for y, z in ring])
    # raking struts under the cantilever
    for y in (252.0, 276.0, 301.0, 325.0):
        rod(g, Vector((94.0, y, 0.0)), Vector((106.0, y, B["z0"])), 0.45, "alu")
    return g.tris() - tris0


def struts_north():
    return [(Vector((94.0, y, 0.0)), Vector((106.0, y, BOX["z0"]))) for y in (252.0, 276.0, 301.0, 325.0)]


# --- the build ---------------------------------------------------------------------------------------------

def shifted(g):
    out = Geo()
    out.add(g, T(-ORIGIN[0], -ORIGIN[1], 0))
    return out


def anchor():
    """The game position of ORIGIN."""
    th = -HEADING * math.pi / 180
    lx, ly = ORIGIN
    e = lx * math.cos(th) - ly * math.sin(th)
    n = lx * math.sin(th) + ly * math.cos(th)
    return S0[0] + e, S0[1] - n


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    of, of_n = office_images()
    sk, sk_n = stack_images()
    en, en_n = endpanel_images()
    glass = dict(floorH=4.0, colW=1.8, glass="#7d93a6", frame="#cfd3d6", spandrel="#9aa3aa", mull=0.05, slab=0.04, metal=0.8, rough=0.06, lit=0.6, warm="#ffe0b0", seed=4)
    M = dict(
        office=material("NL_Office", "#d9dbd6", 0.8, tex=of, emit_tex=of_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        stack=material("NL_Stack", "#dcdeda", 0.8, tex=sk, emit_tex=sk_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        band=material("NL_Band", "#3a4652", 0.25, metal=0.4, props={"facade": json.dumps(dict(glass, floorH=5.7, colW=1.95, glass="#6f8496", frame="#e4e5e1", spandrel="#e4e5e1", mull=0.12, lit=0.5)), "wet": "surface", "glow": "none"}),
        tile=material("NL_Tiles", "#2e6f74", 0.3, tex=tile_image(), props={"wet": "surface", "glowStrength": 0.5}),
        white=material("NL_White", "#ecece7", 0.6, props={"wet": "damp", "glowStrength": 0.6}),
        roof=material("NL_Roof", "#8a8b87", 0.9, props={"wet": "ground", "glow": "none"}),
        granite=material("NL_Granite", "#b3ada2", 0.75, props={"wet": "ground", "glowStrength": 0.5}),
        door=material("NL_Door", "#5c6a74", 0.1, metal=0.8, props={"facade": json.dumps(dict(glass, floorH=6.15, colW=3.0, glass="#4f6070", frame="#c8b27a", lit=0.9)), "wet": "surface", "glow": "none"}),
        red=material("NL_Red", "#b8261e", 0.5, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.35, 0.25], "glowStrength": 0.1}),
        steel=material("NL_Steel", "#c8cbcd", 0.3, metal=1.0, props={"wet": "surface", "glow": "none"}),
        lawn=material("NL_Lawn", "#5f7f3e", 0.95, props={"wet": "ground", "glow": "none", "layer": 10}),
        podium=material("NL_Podium", "#b9ab92", 0.75, tex=podium_image(), props={"wet": "damp", "glowStrength": 0.6}),
        terrace=material("NL_Terrace", "#9e9a90", 0.85, props={"wet": "ground", "glow": "none"}),
        glass=material("NL_Glass", "#7d93a6", 0.1, metal=0.8, props={"facade": json.dumps(glass), "wet": "surface", "glow": "none"}),
        lobby=material("NL_Lobby", "#5f7483", 0.1, metal=0.8, props={"facade": json.dumps(dict(glass, floorH=6.0, colW=2.4, glass="#5d7182", lit=0.85, seed=6)), "wet": "surface", "glow": "none"}),
        alu=material("NL_Alu", "#cfd3d6", 0.3, metal=0.8, props={"wet": "surface", "glowStrength": 0.6}),
        soffit=material("NL_Soffit", "#b8bcbf", 0.5, metal=0.4, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.9, 0.75], "glowStrength": 0.2}),
        ends=material("NL_Ends", "#c9cdd0", 0.35, metal=0.6, tex=en, emit_tex=en_n, props={"wet": "surface", "emit": "night", "glowStrength": 0.6}),
    )
    TILE = dict(white=2.0, roof=8.0, granite=2.0, red=1.0, steel=1.0, lawn=4.0, terrace=6.0, alu=3.0, soffit=6.0)
    main = collection("国家图书馆")
    plan = Plan()
    g = Geo()
    south = build_south(g, plan)
    north = build_north(g, M)
    shifted(g).build("Library", collection("主体", main), M, TILE)
    tris = g.tris()
    font = bpy.data.fonts.load(FONT)
    from national_museum import lettering
    letters = collection("题字", main)
    st = STONE
    M2 = dict(M, gold=M["red"])
    m = T(st["x"] + st["W"] / 2 + 0.03 - ORIGIN[0], st["y"] - ORIGIN[1], 2.3) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    lettering(font, "中国国家图书馆", 1.3, 12.0, "NameStone", M2, letters, m)
    M3 = dict(M, gold=M["white"])
    m = T(NB["x1"] + 0.03 - ORIGIN[0], (NB["y1"] + NOTCH["y1"]) / 2 - ORIGIN[1], 6.0) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    lettering(font, "国家图书馆", 1.5, 10.0, "NameNorth", M3, letters, m)

    # the far level: walls and roofs of the south building without the skirts, the north building's boxes
    far = Geo()
    for a, b, h, hn, stl in plan.edges():
        if hn > h:
            continue
        d = Vector(b) - Vector(a)
        wall(far, a, b, hn, h + 0.8, "office" if stl == "office" else "stack", (d.y / d.length, -d.x / d.length), su=BAY, sv=STOREY)
    for x0, x1, y0, y1, h in plan.rects():
        far.polyn([(x0, y0, h + 0.8), (x1, y0, h + 0.8), (x1, y1, h + 0.8), (x0, y1, h + 0.8)], "tile", (0, 0, 1))
    for x0, x1, y0, y1 in TOWERS:
        far.box(x0 + 2.4, x1 - 2.4, y0 + 2.4, y1 - 2.4, SHAFT, 60.0, "tile", skip=("-z",))
    N, B = NB, BOX
    far.box(N["x0"], N["x1"], N["y0"], N["y1"], 0.0, POD_H, "podium", skip=("-z",))
    far.box(B["x0"] + GLASS_IN, N["x1"] - GLASS_IN, B["y0"] + GLASS_IN, B["y1"] - GLASS_IN, POD_H, B["z0"], "lobby", skip=("-z", "+z"))
    far.box(B["x0"], B["x1"], B["y0"], B["y1"], B["z0"], B["z1"], "glass", skip=())
    shifted(far).build("Massing", collection("LOD1", main), M, TILE)

    # colliders
    import bcity_landmark
    helpers = collection("碰撞体")
    ox, oy = ORIGIN

    def box(name, x0, x1, y0, y1, z0, z1):
        collider_box(helpers, name, x0 - ox, x1 - ox, y0 - oy, y1 - oy, z0, z1)

    def ramp(name, x_low, x_top, y0, y1, z_top):
        me = bpy.data.meshes.new(name)
        xa, xb = x_low - ox, x_top - ox
        ya, yb = y0 - oy, y1 - oy
        me.from_pydata([(xa, ya, 0), (xa, yb, 0), (xb, yb, z_top), (xb, ya, z_top), (xb, ya, 0), (xb, yb, 0)], [],
                       [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (0, 1, 5, 4), (4, 5, 2, 3)])
        o = bpy.data.objects.new(name, me)
        helpers.objects.link(o)
        bcity_landmark.rename(o, "WALK")

    for i, (x0, x1, y0, y1, h) in enumerate(plan.rects()):
        box(f"s{i}", x0, x1, y0, y1, 0.0, h)
    for i, (x0, x1, y0, y1) in enumerate(TOWERS):
        box(f"top{i}", x0 + 2.4, x1 - 2.4, y0 + 2.4, y1 - 2.4, SHAFT, 62.6)
    P, S = PORCH, STEPS
    box("porch", P["x0"], P["x1"], P["y0"], P["y1"], 0.0, P["floor"])
    ramp("steps", S["x1"], P["x1"], P["y0"] - 1.0, P["y1"] + 1.0, P["floor"])
    for k in range(6):
        y = P["y0"] + 1.2 + k * (P["y1"] - P["y0"] - 2.4) / 5
        box(f"pier{k}", P["x1"] - 1.5, P["x1"] - 0.5, y - 0.5, y + 0.5, P["floor"], P["top"])
    box("canopy", P["x0"], P["x1"] + 0.3, P["y0"] - 0.3, P["y1"] + 0.3, P["top"], P["top"] + 0.7)
    for k, y in enumerate((AXIS - 5.0, AXIS, AXIS + 5.0)):
        box(f"pole{k}", 96.6, 97.4, y - 0.4, y + 0.4, 0.0, 22.0)
    box("kiosk", KIOSK["x0"], KIOSK["x1"], KIOSK["y0"], KIOSK["y1"], 0.0, KIOSK["h"])
    box("stone", st["x"] - st["W"] / 2, st["x"] + st["W"] / 2, st["y"] - st["L"] / 2, st["y"] + st["L"] / 2, 0.0, st["H"])
    NO = NOTCH
    box("podS", N["x0"], N["x1"], N["y0"], NO["y0"], 0.0, POD_H)
    box("podN", N["x0"], N["x1"], NO["y1"], N["y1"], 0.0, POD_H)
    box("podW", N["x0"], NO["back"], NO["y0"], NO["y1"], 0.0, POD_H)
    box("landing", NO["back"], NO["land"], NO["y0"], NO["y1"], 0.0, NO["top"])
    ramp("nsteps", N["x1"], NO["land"], NO["y0"], NO["y1"], NO["top"])
    box("reading", B["x0"] + GLASS_IN, N["x1"] - GLASS_IN, B["y0"] + GLASS_IN, B["y1"] - GLASS_IN, POD_H, B["z0"])
    box("box", B["x0"], B["x1"], B["y0"], B["y1"], B["z0"], B["z1"])
    for i, (a, b) in enumerate(struts_north()):
        pts = [(p.x + dx - ox, p.y + dy - oy, p.z) for p in (a, b) for dx in (-0.45, 0.45) for dy in (-0.45, 0.45)]
        collider_pts(helpers, f"strut{i}", pts)

    def fp(name, x0, x1, y0, y1, role="FOOTPRINT"):
        flat_marker(helpers, name, [(x0 - ox, y0 - oy), (x1 - ox, y0 - oy), (x1 - ox, y1 - oy), (x0 - ox, y1 - oy)], role)

    fp("south", -88.0, 91.0, -49.5, 100.5)
    fp("halls", -57.0, 43.0, -95.5, -42.0)
    fp("north", -21.0, 113.5, 231.0, 348.0)
    fp("kiosk", KIOSK["x0"] - 0.3, KIOSK["x1"] + 0.3, KIOSK["y0"] - 0.3, KIOSK["y1"] + 0.3)
    fp("forecourt", 86.0, 123.0, 9.0, 46.0, "CLEAR")
    fp("cantilever", 84.0, 114.0, 240.0, 337.0, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "nationallibrary", "中国国家图书馆", "National Library of China"
    gx, gz = anchor()
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", gx, gz, HEADING
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, south=south, north=north, rects=len(plan.rects()), anchor=(round(gx, 2), round(gz, 2)))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
