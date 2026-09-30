# 北京南站 Beijing South Railway Station (2008), built in Blender for the game and marked with the bcity_landmark
# add-on's conventions. OSM has the station as one elliptical outline (way 43045237, building=train_station, layer 2)
# which the city never drew: its drop-off viaducts (service roads, bridge=viaduct) run through it, so the tiles cut it
# (build.mjs, `deckOver`). The city lifts those roads itself (6.5 m, with parapets, piers and colliders): a loop
# across the hall at X ~ +-100 and along its north and south eaves, and ramps round the four corners. This model
# leaves them to the city and keeps clear of them (the script reads the tiles and checks).
#
#   blender -b -P scripts/blender/landmarks/south_station.py -- [--out art/landmarks/southstation.blend] [--export]
#
# The sign needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X along the tracks (bearing 47.7 deg, towards 天津), +Y the station's north (北广场, north-west in
# the world), metres, origin on the ground at the centre of the ellipse fitted to OSM's outline, game
# (-2112.54, 5031.18), heading -42.31 (the model's +Y points at bearing -42.31). Published figures: the ellipse
# 500 x 350 m (OSM's outline fits 491 x 348); the central building a double-curved vault 40 m high with its eaves
# at 20 m and photovoltaic panels on its roof (3264 panels); either side two spans of cable-suspended canopy, 31.5 m
# at the top, eaves 16.5 m; the elevated waiting hall about 350 x 195 m, spanning the tracks. Platforms from the
# OSM tracks (the platform outlines overlap the tracks; their centres are taken between each pair of tracks).
#
#   ellipse   A x B = 245.5 x 174 (the eave line of every tier)
#   central   |X| < 115: z = 20 + 20 (1 - rho^2), rho^2 = (X/A)^2 + (Y/B)^2; photovoltaic panels either side of the crown
#   span 1    115 < |X| < 180: eave 16.5, 31.5 at its inner edge, sagging between its supports
#   span 2    180 < |X| < A: eave 14.5, 23 at its inner edge; clerestory glass at every step
#   hall      the waiting hall: an ellipse 88 x 168 (inside the city's road loop), its floor at 6.5 m (the decks'
#             level), glass walls to the roof, tree columns; under it the tracks, and the ground floor's ends
#             (|Y| > 135, off the tracks) closed in glass
#   outer     thin wavy canopies over the platforms beyond the ellipse, out to X +-265, 12-13.4 m
#   platforms 13 islands, 1.25 m, with tactile strips; the columns stand on them

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, place, rect  # noqa: E402
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "southstation.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = -2112.54, 5031.18, -42.31
A, B = 245.5, 174.0
XC, X2 = 115.0, 180.0
EAVE_C, TOP_C, THICK_C = 20.0, 40.0, 1.2
EAVE_1, TOP_1, THICK_1 = 16.5, 31.5, 0.7
EAVE_2, TOP_2, THICK_2 = 14.5, 23.0, 0.6
SAG = 1.6
HA, HB = 88.0, 168.0                 # the waiting hall
ZS, ZSB = 6.5, 5.7                   # its floor, and the floor's underside
CAP_Y = 135.0                        # the ground floor is closed where |Y| > CAP_Y (off the tracks)
PLAT_H = 1.25
XO = 265.0                           # the outer canopies' ends
YO0, YO1 = -141.0, 120.0             # and the band they cover
ZO, WAVE, THICK_O = 12.0, 1.4, 0.35

# (centre y, width, x0, x1): between the pairs of tracks (OSM's rails), their ends from OSM's platforms (01 ... 24)
PLATFORMS = [
    (113.3, 10.0, -261.0, 255.0), (93.75, 10.0, -260.0, 256.0), (73.75, 12.0, -259.8, 260.0),
    (52.75, 11.0, -248.0, 245.6), (32.25, 11.0, -247.8, 246.4), (10.75, 12.0, -248.0, 247.5),
    (-10.0, 11.5, -247.5, 246.7), (-28.75, 12.0, -248.5, 246.8), (-50.0, 12.5, -248.1, 246.6),
    (-72.5, 11.5, -247.8, 228.9), (-93.0, 12.5, -248.1, 229.6), (-114.0, 12.5, -249.0, 228.9),
    (-134.3, 10.0, -248.4, 229.1),
]

K1 = (TOP_1 - EAVE_1) / (1 - (XC / A) ** 2)
K2 = (TOP_2 - EAVE_2) / (1 - (X2 / A) ** 2)


def rho2(x, y):
    return (x / A) ** 2 + (y / B) ** 2


def ye(x, a=A, b=B):
    return b * math.sqrt(max(0.0, 1 - (x / a) ** 2))


def xe(y, a=A, b=B):
    return a * math.sqrt(max(0.0, 1 - (y / b) ** 2))


def z_central(x, y):
    return EAVE_C + (TOP_C - EAVE_C) * max(0.0, 1 - rho2(x, y))


def z_span1(x, y):
    q = max(0.0, 1 - rho2(x, y))
    s = (abs(x) - XC) / (X2 - XC)
    return EAVE_1 + K1 * q - SAG * math.sin(math.pi * min(1, max(0, s))) * q


def z_span2(x, y):
    q = max(0.0, 1 - rho2(x, y))
    s = (abs(x) - X2) / (A - X2)
    return EAVE_2 + K2 * q - SAG * 0.7 * math.sin(math.pi * min(1, max(0, s))) * q


def z_outer(y):
    d = min(abs(y - p[0]) for p in PLATFORMS)
    return ZO + WAVE * math.sin(math.pi / 2 * min(d / 10.3, 1.0)) ** 2


# --- the city's roads, to keep clear of (from the tiles, in this frame) ----------------------------------------

def load_roads():
    h = math.radians(HEADING)
    ex, ey = (math.cos(h), math.sin(h)), (math.sin(h), -math.cos(h))
    segs = []
    for ix in range(-11, -6):
        for iz in range(17, 23):
            f = os.path.join(REPO, "public", "city", f"t_{ix}_{iz}.json")
            if not os.path.isfile(f):
                continue
            t = json.load(open(f))
            for r in t["roads"]:
                if r["c"] in ("footway", "path", "steps", "cycleway", "pedestrian"):
                    continue
                p = r["p"]
                hs = r.get("h") or [0.0] * (len(p) // 2)
                pts = []
                for i in range(0, len(p), 2):
                    dx, dz = p[i] - GX, p[i + 1] - GZ
                    pts.append((dx * ex[0] + dz * ex[1], dx * ey[0] + dz * ey[1]))
                for i in range(1, len(pts)):
                    segs.append((pts[i - 1], pts[i], r["w"] / 2, max(hs[i - 1], hs[i])))
    return segs


def seg_dist(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / L2))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)


def clear_of(roads, x, y, raised_gap, ground_gap):
    """How far (x, y) is inside the keep-out of the nearest road (<= 0: clear)."""
    worst = -1e9
    for a, b, hw, hmax in roads:
        gap = raised_gap if hmax >= 0.3 else ground_gap
        worst = max(worst, hw + gap - seg_dist(x, y, a, b))
    return worst


# --- textures and materials -------------------------------------------------------------------------------------

def roof_image(size=512):
    """Silver standing-seam panels: a seam every metre along X, a cross joint every 4 m (8 m a repeat)."""
    cv = Canvas(size, size, "#c9cdd1")
    cv.noise(0.04, 71)
    q = size / 8
    cv.put(np.mod(cv.x, q) < 2.2, "#a9aeb3")
    cv.put(np.mod(cv.y, q * 4) < 1.6, "#b4b9be")
    rng = np.random.default_rng(72)
    tint = rng.uniform(0.96, 1.03, (8, 8))
    cv.a *= tint[(cv.y // (q * 4)).astype(int) % 8, (cv.x // q).astype(int) % 8][..., None]
    return image("SS_Roof", np.flipud(cv.a).copy())


def pv_image(size=512):
    """Photovoltaic modules, 1 x 2 m in silver frames, in rows 5 m deep with 3 m of roof between (8 m a repeat)."""
    cv = Canvas(size, size, "#1c2946")
    cv.noise(0.08, 73)
    q = size / 8
    cv.put(np.mod(cv.x, q / 6) < 1.0, "#26365a")
    cv.put(np.mod(cv.y, q / 3) < 1.0, "#26365a")
    cv.put((np.mod(cv.x, q) < 2.0) | (np.mod(cv.y, q * 2) < 2.0), "#9aa3ad")
    gap = cv.y >= q * 5
    cv.put(gap, "#c9cdd1")
    cv.put(gap & (np.mod(cv.x, q) < 2.2), "#a9aeb3")
    return image("SS_PV", np.flipud(cv.a).copy())


def platform_image(size=256):
    """A platform's top across its width (u) and 8 m along it (v): white edge line, yellow tactile strip, paving."""
    cv = Canvas(size, size, "#b9b5ad")
    cv.noise(0.06, 74)
    q = size / 8
    cv.put(np.mod(cv.y, q) < 1.2, "#a29e96")
    for u0, u1, col in ((0.0, 0.015, "#e8e6e0"), (0.06, 0.1, "#d9b31e"), (0.9, 0.94, "#d9b31e"), (0.985, 1.0, "#e8e6e0")):
        cv.put((cv.x >= u0 * size) & (cv.x < u1 * size), col)
    return image("SS_Platform", np.flipud(cv.a).copy())


def soffit_glow(size=16):
    return image("SS_SoffitGlow", np.full((size, size, 3), (0.26, 0.24, 0.2), np.float32))


def materials():
    return dict(
        roof=material("SS_Roof", "#c9cdd1", 0.35, metal=0.55, tex=roof_image(), props={"wet": "surface", "glow": "none"}),
        pv=material("SS_PV", "#1c2946", 0.2, metal=0.3, tex=pv_image(), props={"wet": "surface", "glow": "none"}),
        sky=material("SS_Skylight", "#7d93a2", 0.08, metal=0.6, props={"wet": "surface", "glow": "none"}),
        soffit=material("SS_Soffit", "#e3e1db", 0.6, emit_tex=soffit_glow(), props={"wet": "none", "emit": "night", "glow": "none"}),
        trim=material("SS_Trim", "#aab0b6", 0.35, metal=0.6, props={"wet": "surface", "glow": "none"}),
        glass=facade("SS_Glass", dict(floorH=9.0, colW=2.2, glass="#56707f", frame="#dcdcd6", mull=0.08, slab=0.14, metal=0.7, rough=0.1, lit=0.8, coolShare=0.25, seed=41)),
        steel=material("SS_Steel", "#ecece8", 0.4, metal=0.4, props={"wet": "surface", "glow": "none"}),
        concrete=material("SS_Concrete", "#b7b2a8", 0.8, props={"wet": "damp", "glowStrength": 0.4}),
        granite=material("SS_Granite", "#9b968e", 0.6, props={"wet": "ground", "glow": "none"}),
        platform=material("SS_Platform", "#b9b5ad", 0.75, tex=platform_image(), props={"wet": "ground", "glow": "none"}),
        letters=material("SS_Letters", "#c3261d", 0.4, props={"glow": "lamp", "glowColor": [1.0, 0.25, 0.15], "glowStrength": 0.7}),
    )


TILE = dict(concrete=3.0, granite=3.0, steel=1.0, trim=2.0, sky=4.0)


# --- surfaces ---------------------------------------------------------------------------------------------------

def surface(g, xs, nt, zf, thick, keyf, uvs=True, soffit=True, edges=("t0", "t1")):
    """A roof shell over x in xs, y from -ye(x) to ye(x) in nt steps: the top (keyf(x, y) per quad), the soffit
    `thick` below, a fascia along the eaves and across the ends. Returns the rows of (x, y, z_top) per x."""
    rows = []
    for x in xs:
        e = ye(x)
        rows.append([(x, e * (2 * j / nt - 1), zf(x, e * (2 * j / nt - 1))) for j in range(nt + 1)])
    top = [[g.vert((x, y, z)) for x, y, z in r] for r in rows]
    bot = [[g.vert((x, y, z - thick)) for x, y, z in r] for r in rows] if soffit else None
    for i in range(len(rows) - 1):
        for j in range(nt):
            a, b, c, d = rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]
            cx, cy = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
            k = keyf(cx, cy)
            uv = [(p[0] / 8, p[1] / 8) for p in (a, b, c, d)] if uvs else None
            ids = (top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1])
            if xs[i + 1] < xs[i]:
                ids, uv = ids[::-1], (uv[::-1] if uv else None)
            g.face(ids, k, uv, smooth=True)
            if soffit:
                ids = (bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j])
                if xs[i + 1] < xs[i]:
                    ids = ids[::-1]
                g.face(ids, "soffit", [(p[0] / 8, p[1] / 8) for p in (a, d, c, b)], smooth=True)
    if soffit:
        for j in (0, nt):          # the eaves
            s = 1 if j == nt else -1
            for i in range(len(rows) - 1):
                p, q = rows[i][j], rows[i + 1][j]
                g.polyn([(p[0], p[1], p[2]), (q[0], q[1], q[2]), (q[0], q[1], q[2] - thick), (p[0], p[1], p[2] - thick)], "trim", (0, s, 0))
        for i, sx in ((0, -1 if xs[1] > xs[0] else 1), (len(rows) - 1, 1 if xs[1] > xs[0] else -1)):   # the ends
            r = rows[i]
            if abs(r[0][1]) < 0.05:
                continue
            for j in range(nt):
                p, q = r[j], r[j + 1]
                g.polyn([(p[0], p[1], p[2]), (q[0], q[1], q[2]), (q[0], q[1], q[2] - thick), (p[0], p[1], p[2] - thick)], "trim", (sx, 0, 0))
    return rows


def clerestory(g, x, nt, z_low, z_high_soffit, out):
    """Glass across the step at x: from the lower tier's top up to the upper tier's soffit."""
    e = ye(x)
    for j in range(nt):
        y0, y1 = e * (2 * j / nt - 1), e * (2 * (j + 1) / nt - 1)
        a0, a1 = z_low(x, y0), z_low(x, y1)
        b0, b1 = z_high_soffit(x, y0), z_high_soffit(x, y1)
        if b0 - a0 < 0.1 and b1 - a1 < 0.1:
            continue
        g.polyn([(x, y0, a0), (x, y1, a1), (x, y1, max(b1, a1)), (x, y0, max(b0, a0))], "glass", (out, 0, 0),
                uvs=[(y0, a0), (y1, a1), (y1, max(b1, a1)), (y0, max(b0, a0))])


def ring(a, b, n, cx=0.0, cy=0.0):
    return [(cx + a * math.cos(2 * math.pi * i / n), cy + b * math.sin(2 * math.pi * i / n)) for i in range(n)]


# --- parts (linked duplicates) -----------------------------------------------------------------------------------

def trunk_geo(r0=0.55, r1=0.42, n=8):
    """A column one metre high (scaled in z to its height), tapering."""
    g = Geo()
    a = [g.vert((r0 * math.cos(2 * math.pi * i / n), r0 * math.sin(2 * math.pi * i / n), 0.0)) for i in range(n)]
    b = [g.vert((r1 * math.cos(2 * math.pi * i / n), r1 * math.sin(2 * math.pi * i / n), 1.0)) for i in range(n)]
    for i in range(n):
        k = (i + 1) % n
        g.face((a[i], a[k], b[k], b[i]), "steel", smooth=True)
    return g


def arm(g, p0, p1, r0, r1):
    """A tapered square strut from p0 to p1."""
    import mathutils
    p0, p1 = mathutils.Vector(p0), mathutils.Vector(p1)
    d = (p1 - p0).normalized()
    u = d.cross(mathutils.Vector((0, 0, 1)))
    if u.length < 1e-6:
        u = mathutils.Vector((1, 0, 0))
    u.normalize()
    v = d.cross(u)
    ra = [p0 + (u * math.cos(k * math.pi / 2 + math.pi / 4) + v * math.sin(k * math.pi / 2 + math.pi / 4)) * r0 for k in range(4)]
    rb = [p1 + (u * math.cos(k * math.pi / 2 + math.pi / 4) + v * math.sin(k * math.pi / 2 + math.pi / 4)) * r1 for k in range(4)]
    ia = [g.vert(p) for p in ra]
    ib = [g.vert(p) for p in rb]
    for k in range(4):
        m = (k + 1) % 4
        g.face((ia[k], ia[m], ib[m], ib[k]), "steel", smooth=False)
    g.face(tuple(ib), "steel")


def crown_geo(spread=5.5, rise=5.0):
    """The tree column's head: four branches forking from the trunk's top, each splitting in two, up to the roof."""
    g = Geo()
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        mid = (math.cos(a) * spread * 0.45, math.sin(a) * spread * 0.45, rise * 0.55)
        arm(g, (0, 0, -0.2), mid, 0.34, 0.26)
        for da in (-0.42, 0.42):
            e = (math.cos(a + da) * spread, math.sin(a + da) * spread, rise)
            arm(g, mid, e, 0.24, 0.16)
    # a ring collar at the fork
    n = 8
    lo = [g.vert((0.5 * math.cos(2 * math.pi * i / n), 0.5 * math.sin(2 * math.pi * i / n), -0.6)) for i in range(n)]
    hi = [g.vert((0.5 * math.cos(2 * math.pi * i / n), 0.5 * math.sin(2 * math.pi * i / n), 0.3)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        g.face((lo[i], lo[j], hi[j], hi[i]), "steel", smooth=True)
    return g


# --- the build -----------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    roads = load_roads()
    raised = [r for r in roads if r[3] >= 0.3]
    print("roads near the station:", len(roads), "segments,", len(raised), "raised")
    M = materials()
    main = collection("北京南站")
    helpers = collection("碰撞体")
    warn = []

    # --- the roofs
    g = Geo()
    NT = 28

    def key_central(x, y):
        t = abs(y) / max(ye(x), 1.0)
        if abs(x) < 84.0 and 0.06 < t < 0.46:
            return "pv"
        return "roof"

    def key_span(x0, x1):
        def f(x, y):
            s = (abs(x) - x0) / (x1 - x0)
            return "sky" if 0.44 < s < 0.56 and abs(y) < ye(x) * 0.9 else "roof"
        return f

    xs_c = [-XC + 2 * XC * i / 30 for i in range(31)]
    surface(g, xs_c, NT, z_central, THICK_C, key_central)
    for sx in (-1, 1):
        xs1 = [sx * (XC + (X2 - XC) * i / 10) for i in range(11)]
        surface(g, xs1, NT, z_span1, THICK_1, key_span(XC, X2))
        xs2 = [sx * (X2 + (A - 0.05 - X2) * math.sin(math.pi / 2 * i / 12)) for i in range(13)]
        surface(g, xs2, NT, z_span2, THICK_2, key_span(X2, A))
        clerestory(g, sx * XC, NT, z_span1, lambda x, y: z_central(x, y) - THICK_C, sx)
        clerestory(g, sx * X2, NT, z_span2, lambda x, y: z_span1(x, y) - THICK_1, sx)

    # the outer canopies over the platforms beyond the ellipse: a mapped grid from under the eave out to XO
    ys = sorted(set([YO0, YO1] + [p[0] for p in PLATFORMS] + [(PLATFORMS[i][0] + PLATFORMS[i + 1][0]) / 2 for i in range(len(PLATFORMS) - 1)]
                    + [(3 * PLATFORMS[i][0] + PLATFORMS[i + 1][0]) / 4 for i in range(len(PLATFORMS) - 1)]
                    + [(PLATFORMS[i][0] + 3 * PLATFORMS[i + 1][0]) / 4 for i in range(len(PLATFORMS) - 1)]))
    ys = [y for y in ys if YO0 <= y <= YO1]
    NC = 5
    for sx in (-1, 1):
        grid = []
        for y in ys:
            x0 = xe(y) - 3.0
            grid.append([(sx * (x0 + (XO - x0) * i / NC), y, z_outer(y)) for i in range(NC + 1)])
        top = [[g.vert(p) for p in r] for r in grid]
        bot = [[g.vert((p[0], p[1], p[2] - THICK_O)) for p in r] for r in grid]
        for j in range(len(ys) - 1):
            for i in range(NC):
                a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
                ids = [top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]]
                bids = [bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]]
                uv = [(p[0] / 8, p[1] / 8) for p in (a, b, c, d)]
                buv = [(p[0] / 8, p[1] / 8) for p in (a, d, c, b)]
                if sx < 0:
                    ids, uv, bids, buv = ids[::-1], uv[::-1], bids[::-1], buv[::-1]
                s = i / NC
                g.face(ids, "sky" if 0.55 < s < 0.75 else "roof", uv, smooth=True)
                g.face(bids, "soffit", buv, smooth=True)
        for j in (0, len(ys) - 1):
            s = -1 if j == 0 else 1
            for i in range(NC):
                p, q = grid[j][i], grid[j][i + 1]
                g.polyn([p, q, (q[0], q[1], q[2] - THICK_O), (p[0], p[1], p[2] - THICK_O)], "trim", (0, s, 0))
        for j in range(len(ys) - 1):
            p, q = grid[j][NC], grid[j + 1][NC]
            g.polyn([p, q, (q[0], q[1], q[2] - THICK_O), (p[0], p[1], p[2] - THICK_O)], "trim", (sx, 0, 0))

    # --- the waiting hall: its floor, glass walls to the roof, the ground floor's ends
    NH = 72
    hall = ring(HA, HB, NH)
    for x, y in hall:
        d = clear_of(raised, x, y, 0.6, -99)
        if d > 0:
            warn.append(f"hall wall at ({x:.0f},{y:.0f}) {d:.1f} m into a raised road")
    g.polyn([(x, y, ZS) for x, y in hall], "granite", (0, 0, 1))
    g.polyn([(x, y, ZSB) for x, y in hall], "soffit", (0, 0, -1))
    u = 0.0
    for i in range(NH):
        (x0, y0), (x1, y1) = hall[i], hall[(i + 1) % NH]
        L = math.hypot(x1 - x0, y1 - y0)
        out = ((y1 - y0), -(x1 - x0), 0)
        g.polyn([(x0, y0, ZSB), (x1, y1, ZSB), (x1, y1, ZS + 0.3), (x0, y0, ZS + 0.3)], "concrete", out)
        z0t, z1t = z_central(x0, y0) - THICK_C, z_central(x1, y1) - THICK_C
        g.polyn([(x0, y0, ZS + 0.3), (x1, y1, ZS + 0.3), (x1, y1, z1t), (x0, y0, z0t)], "glass", out,
                uvs=[(u, ZS + 0.3), (u + L, ZS + 0.3), (u + L, z1t), (u, z0t)])
        # the ground floor, off the tracks
        if abs(y0) > CAP_Y and abs(y1) > CAP_Y:
            g.polyn([(x0, y0, 0.0), (x1, y1, 0.0), (x1, y1, 0.6), (x0, y0, 0.6)], "concrete", out)
            g.polyn([(x0, y0, 0.6), (x1, y1, 0.6), (x1, y1, ZSB), (x0, y0, ZSB)], "glass", out,
                    uvs=[(u, 0.6), (u + L, 0.6), (u + L, ZSB), (u, ZSB)])
        u += L
    cap_x = HA * math.sqrt(1 - (CAP_Y / HB) ** 2)
    for s in (-1, 1):
        g.polyn([(-cap_x, s * CAP_Y, 0.0), (cap_x, s * CAP_Y, 0.0), (cap_x, s * CAP_Y, ZSB), (-cap_x, s * CAP_Y, ZSB)], "concrete", (0, -s, 0))
        pts = [(x, y) for x, y in hall if s * y > CAP_Y] + [(-cap_x, s * CAP_Y), (cap_x, s * CAP_Y)]
        collider_pts(helpers, "groundEnd", [(x, y, z) for x, y in pts for z in (0.0, ZSB)])
    collider_pts(helpers, "hallFloor", [(x, y, z) for x, y in hall for z in (ZSB, ZS)])

    # --- the platforms
    for i, (y, w, x0, x1) in enumerate(PLATFORMS):
        g.box(x0, x1, y - w / 2, y + w / 2, 0.0, PLAT_H, "concrete", skip=("-z", "+z"))
        L = x1 - x0
        g.polyn([(x0, y - w / 2, PLAT_H), (x1, y - w / 2, PLAT_H), (x1, y + w / 2, PLAT_H), (x0, y + w / 2, PLAT_H)], "platform", (0, 0, 1),
                uvs=[(0, x0 / 8), (0, x1 / 8), (1, x1 / 8), (1, x0 / 8)])
        collider_box(helpers, f"platform{i:02d}", x0, x1, y - w / 2, y + w / 2, 0.0, PLAT_H)
        for xx in np.arange(x0, x1, 4.0):
            d = clear_of([r for r in roads if r[3] < 0.3], float(xx), y, 0.0, 0.0)
            if d > -w / 2:
                warn.append(f"platform {i} at x {xx:.0f} meets a ground road")
                break

    # --- the sign over the drop-off, north and south
    font = bpy.data.fonts.load(FONT)
    lt = collection("站名", main)
    tris_sign = 0
    for s in (-1, 1):
        yb = s * 171.0
        zb = z_central(0, s * 171.4) - THICK_C
        g.box(-15.0, 15.0, yb - 0.25, yb + 0.25, 12.6, zb + 0.2, "trim")
        m = T(0, yb + s * 0.27, 15.6) @ (Rz(math.pi) if s > 0 else Matrix.Identity(4)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        tris_sign += sign(font, "北京南站", 4.2, m, f"Sign{'N' if s > 0 else 'S'}", lt, M["letters"], extrude=0.15)

    g.build("Station", collection("站房", main), M, TILE)
    tris = g.tris() + tris_sign

    # --- the columns: tree columns in the hall and under the canopies, piers under the hall's floor
    parts = collection("构件", main)
    trunk = mesh_of(trunk_geo(), "TrunkMesh", M, TILE)
    crown = mesh_of(crown_geo(), "CrownMesh", M, TILE)
    pier = mesh_of(trunk_geo(0.5, 0.5), "PierMesh", M, TILE)
    n_tree = n_pier = 0

    def tree(x, y, zb, zt, k, tag):
        nonlocal n_tree
        zc = zt - 5.0 * k
        if zc - zb < 1.0:
            return
        place(trunk, f"{tag}.Trunk.{n_tree:03d}", parts, T(x, y, zb) @ Matrix.Diagonal((k, k, zc - zb, 1)))
        place(crown, f"{tag}.Crown.{n_tree:03d}", parts, T(x, y, zc) @ Matrix.Diagonal((k, k, k, 1)))
        n_tree += 1

    # in the hall, on its floor, up to the vault
    for x in (-62.0, -31.0, 0.0, 31.0, 62.0):
        for y in (-124.0, -93.0, -62.0, -31.0, 0.0, 31.0, 62.0, 93.0, 124.0):
            if (x / (HA - 14)) ** 2 + (y / (HB - 16)) ** 2 < 1 and abs(y) > 8:
                tree(x, y, ZS, z_central(x, y) - THICK_C, 1.9, "Hall")
    skipped = 0
    for (py, w, x0, x1) in PLATFORMS:
        # under the hall's floor
        for x in (-62.0, -31.0, 0.0, 31.0, 62.0):
            if (x / HA) ** 2 + (py / HB) ** 2 < 0.9:
                place(pier, f"Pier.{n_pier:03d}", parts, T(x, py, PLAT_H) @ Matrix.Diagonal((1, 1, ZSB - PLAT_H, 1)))
                n_pier += 1
        # under the canopies (inside the ellipse) and the outer canopies (beyond it)
        for sx in (-1, 1):
            for ax in np.arange(131.0, 262.0, 32.0):
                x = sx * float(ax)
                if not (min(x0, x1) + 4 < x < max(x0, x1) - 4):
                    continue
                r = rho2(x, py)
                if r < 0.93:
                    zt = (z_span1 if abs(x) < X2 else z_span2)(x, py) - (THICK_1 if abs(x) < X2 else THICK_2)
                    # keep clear of the steps' glass
                    if abs(abs(x) - X2) < 7:
                        continue
                    k = 1.0
                elif abs(x) > xe(py) + 6:
                    zt, k = z_outer(py) - THICK_O, 0.8
                else:
                    continue
                if clear_of(raised, x, py, 6.5, 0.0) > 0 or clear_of([r_ for r_ in roads if r_[3] < 0.3], x, py, 0.0, 1.5) > 0:
                    skipped += 1
                    continue
                tree(x, py, PLAT_H, zt, k, "Canopy")
    print(f"tree columns {n_tree}, piers {n_pier}, skipped for roads {skipped}")

    # --- the far level: coarse shells, the hall's glass
    far = Geo()
    surface(far, [-XC + 2 * XC * i / 8 for i in range(9)], 8, z_central, THICK_C, lambda x, y: "roof", soffit=False)
    for sx in (-1, 1):
        surface(far, [sx * (XC + (X2 - XC) * i / 3) for i in range(4)], 8, z_span1, THICK_1, lambda x, y: "roof", soffit=False)
        surface(far, [sx * (X2 + (A - 0.05 - X2) * math.sin(math.pi / 2 * i / 3)) for i in range(4)], 6, z_span2, THICK_2, lambda x, y: "roof", soffit=False)
        clerestory(far, sx * XC, 4, z_span1, lambda x, y: z_central(x, y) - THICK_C, sx)
        for y0, y1 in ((YO0, 0.0), (0.0, YO1)):
            a, b = xe(y0) - 3, xe(y1) - 3
            far.polyn([(sx * a, y0, ZO + 0.7), (sx * XO, y0, ZO + 0.7), (sx * XO, y1, ZO + 0.7), (sx * b, y1, ZO + 0.7)], "roof", (0, 0, 1))
    hall16 = ring(HA, HB, 16)
    for i in range(16):
        (x0, y0), (x1, y1) = hall16[i], hall16[(i + 1) % 16]
        far.polyn([(x0, y0, ZS), (x1, y1, ZS), (x1, y1, z_central(x1, y1) - THICK_C), (x0, y0, z_central(x0, y0) - THICK_C)], "glass", ((y1 - y0), -(x1 - x0), 0),
                  uvs=[(0, ZS), (1, ZS), (1, 20), (0, 20)])
    far.build("Massing", collection("LOD1", main), M, TILE)
    far_tris = far.tris()

    # --- the footprint: the ellipse, and the platform band out to the outer canopies' ends (machine-learnt blocks
    # stood in the rail yard there); roads are not buildings and stay
    flat_marker(helpers, "ellipse", ring(A + 1.0, B + 1.0, 48), "FOOTPRINT")
    for sx in (-1, 1):
        flat_marker(helpers, "platformsE" if sx > 0 else "platformsW", rect(*sorted((sx * 150.0, sx * 276.0)), YO0 - 4, YO1 + 4), "FOOTPRINT")

    for w in warn:
        print("WARNING", w)

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "southstation", "北京南站", "Beijing South Railway Station"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 800
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris, trees=n_tree, piers=n_pier)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
