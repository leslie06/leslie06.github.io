# 首都机场 T3 交通中心 GTC (2026-11-16, airport batch 2): the glass egg in front of T3C and the car parks either side,
# built in Blender and marked with the bcity_landmark add-on's conventions.
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/pek_gtc.py -- [--out art/landmarks/t3gtc.blend] [--export]
#
# Needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header) for the signs.
#
# OSM: way 121364869 (building=train_station, public_transport=station, height 20, roof:shape=dome, roof:height 20,
# roof:colour #86b2a7, layer 2) - the 机场线 T3 station's hall, an egg 125 x 262 m, long axis north-south, its east
# side nearly straight and its west side leaning. The city drew it as a 20 m station prism with a dome roof.
#
# The car parks: OSM has no outlines for them. The brief (and the design doc §5.1: 「GTC 是 T3C 前面的椭圆玻璃顶建筑加
# 两侧停车楼」) puts one on each side; here they fill the ground inside the road loop round the GTC (OSM 87682 north,
# 86713-86719 round the west, south and east) that the city drew as lawn and trees: the loop kept 12 m off every
# road's edge, the six service stubs that end inside it (86706/86707/86708/86724/86731/86741: the car parks' gates)
# left as notches 10 m wide, 16 m kept round the dome, the ground south of the dome open (stub 86724's forecourt)
# and north of it towards T3C. `.scratch/lm/t3gtc/plan.mjs` computes them from public/city/network.json (polygon-
# clipping) and prints PARKS below; rerun it if the roads change. They are drawn as one storey above the ground
# (open sides behind aluminium louvres, a concrete fascia, a glass balustrade) under a planted roof with rows of
# small trees - a guess: the real car park is said to be mostly underground (B1/B2), with landscaped roofs; how much
# of it stands above the ground I could not confirm.
#
# Not from drawings: the dome's section (a superellipse from a 1.2 m granite plinth to OSM's 20 m), its lattice
# (8 m diamonds, a purlin every 4 m: the roof is a steel grid of glass, so the colour of OSM's roof:colour), the two
# glazed portals at the north tip (towards T3C) and the south tip, the signs.
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the OSM outline's box
# (40.0516999, 116.6097805; game 18120.53, -15904.20), heading 0. The T3C departure viaducts (6.5 m) pass 50 m
# north of the dome's tip; the nearest roads keep >= 12 m from every wall and collider (plan.mjs prints it).

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, collider_box, collider_pts, flat_marker, mesh_of, place  # noqa: E402
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "t3gtc.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

TAU = 2 * math.pi
# OSM way 121364869 in the local frame
DOME = [(-42.14, 117.95), (-30.96, 124.66), (-19.12, 129.36), (-8.26, 130.78), (3.47, 130.53), (15.47, 127.14), (27, 121.39),
        (35.2, 113.4), (42.08, 104.76), (48.29, 92.92), (52.37, 81.16), (56.4, 66.46), (59.87, 46.82), (61.37, 26.38),
        (62.56, -18.85), (62.26, -45.04), (60.17, -75.79), (57.19, -104.55), (55.6, -111), (51.02, -116.46), (46.46, -120.53),
        (38.4, -124.69), (30.15, -127.86), (23.29, -129.75), (15.06, -130.78), (7.11, -130.78), (-1.34, -130.29), (-9.05, -127.81),
        (-16.25, -123.95), (-21.22, -119.37), (-26.12, -111.13), (-35.38, -83.9), (-45.94, -48.25), (-51.54, -24.85), (-60.23, 18.25),
        (-62.56, 39.47), (-62.25, 59.78), (-60.7, 75.29), (-58.99, 87.22), (-54.95, 99.15), (-49.68, 109.99)]
# .scratch/lm/t3gtc/plan.mjs
PARKS = [
    [(-279.6, -55), (-275.9, -79), (-268.6, -99.4), (-254.9, -120.6), (-238.3, -139.3), (-208.5, -162.2), (-164.8, -184.7), (-165.4, -179.6),
     (-164.8, -176.5), (-160.4, -174), (-156.1, -176.5), (-154.1, -190.2), (-150.1, -192.2), (-120.7, -205.8), (-74.7, -217.9), (-72, -100),
     (-46.8, -100), (-50.5, -89.1), (-61.3, -52.8), (-67.1, -28.6), (-75.9, 15.1), (-78.5, 37.7), (-78.2, 60), (-76.6, 76.9), (-74.8, 89.5),
     (-71.6, 100), (-80, 100), (-80, 126.3), (-91.7, 124.2), (-142.9, 105.1), (-185.1, 84.8), (-184.1, 81.2), (-184.7, 77), (-189.4, 74.3),
     (-194.2, 77), (-195.2, 80), (-218, 69.1), (-238.2, 54.1), (-253.2, 37.8), (-266.7, 15.1), (-274.8, -7.3), (-278.8, -30.5)],
    [(62.4, 100), (67.5, 86.4), (71.8, 70.7), (75.6, 49.6), (77.3, 27.6), (78.6, -18.4), (78.3, -45.2), (76.1, -76.9), (73.1, -106.2),
     (72, -111.3), (72, -209), (93, -203.5), (92.9, -199.1), (93.6, -196.2), (98.4, -193.4), (103.1, -196.2), (103.9, -199.3), (120.7, -192.6),
     (159.4, -172.7), (192.7, -150.8), (195.6, -147.9), (194.7, -139.3), (195.4, -136), (200.2, -133.2), (204.9, -136), (212.6, -131.4),
     (233.7, -107.1), (252.7, -80.3), (265.7, -53.9), (274.1, -25.1), (276.9, -3.9), (275.7, 16.8), (270.8, 36.8), (262.9, 57.9),
     (252.6, 74.8), (236.1, 94.3), (215.7, 110.1), (193.6, 119.8), (175.1, 124.8), (174.3, 120.6), (169.6, 117.9), (164.8, 120.6),
     (164.1, 123.6), (164.2, 127.4), (114.6, 134.6), (80, 137.6), (80, 100)],
]
H, Z0 = 20.0, 1.2                 # the dome's top (OSM) and its granite plinth
PH, PT = 5.6, 6.6                 # the car parks' roof deck and parapet top
PW = 8.0                          # the car parks' bay (u metres per texture repeat)
LAT = 8.0                         # the dome's lattice, metres a diamond


# ---------------------------------------------------------------- geometry helpers

def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def centroid(pts):
    a, cx, cy = 0.0, 0.0, 0.0
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        k = x0 * y1 - x1 * y0
        a += k
        cx += (x0 + x1) * k
        cy += (y0 + y1) * k
    return cx / (3 * a), cy / (3 * a)


def resample(pts, n):
    """n points evenly along a closed outline (after one Chaikin pass, so OSM's corners round off)."""
    sm = []
    for i in range(len(pts)):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
        sm += [(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by), (0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by)]
    seg = [math.hypot(sm[(i + 1) % len(sm)][0] - sm[i][0], sm[(i + 1) % len(sm)][1] - sm[i][1]) for i in range(len(sm))]
    tot = sum(seg)
    out, i, acc = [], 0, 0.0
    for k in range(n):
        d = tot * k / n
        while acc + seg[i] < d:
            acc += seg[i]
            i += 1
        t = (d - acc) / seg[i]
        (ax, ay), (bx, by) = sm[i], sm[(i + 1) % len(sm)]
        out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    return out


def inside(p, poly):
    x, y = p
    c = False
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c


def edge_dist(p, poly):
    best = 1e9
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
    return best


def walls(g, poly, z0, z1, key, us, v0, vs, out=True):
    """Vertical faces round a closed outline (counter-clockwise), u = metres along it / us, v = (z - v0) / vs."""
    u = 0.0
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        uv = [(u / us, (z0 - v0) / vs), ((u + L) / us, (z0 - v0) / vs), ((u + L) / us, (z1 - v0) / vs), (u / us, (z1 - v0) / vs)]
        q = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        if out:
            g.poly(q, key, uv)
        else:
            g.poly(q[::-1], key, uv[::-1])
        u += L


def offset(poly, d):
    """The outline moved d to its left (inwards for a counter-clockwise outline), mitred, capped at 3d."""
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        e0 = Vector((p1[0] - p0[0], p1[1] - p0[1])).normalized()
        e1 = Vector((p2[0] - p1[0], p2[1] - p1[1])).normalized()
        n0, n1 = Vector((-e0.y, e0.x)), Vector((-e1.y, e1.x))
        m = (n0 + n1)
        if m.length < 1e-6:
            m = n1
        m.normalize()
        k = d / max(0.34, m.dot(n1))
        out.append((p1[0] + m.x * k, p1[1] + m.y * k))
    return out


# ---------------------------------------------------------------- textures

def dome_images():
    """The glass egg's lattice, LAT metres a repeat (u along the rings, v up the meridians): 8 m diamonds of white
    steel over pale teal glass, a lighter purlin every 4 m; the night map lights the glass from inside."""
    n = 512
    k = n / LAT
    cv = Canvas(n, n, "#7aa59e")
    yy, xx = cv.y / k, cv.x / k
    cv.a *= (0.9 + 0.12 * (yy / LAT))[..., None]
    rng = np.random.default_rng(3)
    pane = (np.floor((xx + yy) / (LAT / 2)) + 7 * np.floor((xx - yy) / (LAT / 2))).astype(int)
    cv.a *= rng.uniform(0.93, 1.06, 64)[np.mod(pane, 64)][..., None]
    def lines(d, w):
        return np.abs(np.mod(d + LAT / 4, LAT / 2) - LAT / 4) < w / 2
    steel = lines(xx + yy, 0.22) | lines(xx - yy, 0.22)
    purlin = np.abs(np.mod(yy, LAT / 2) - LAT / 4) < 0.06
    cv.put(purlin, "#c9d3d0")
    cv.put(steel, "#eef0ee")
    emit = Canvas(n, n, "#000000")
    emit.a[:] = np.array([0.55, 0.42, 0.26], np.float32) * (0.75 + 0.25 * rng.random((n, n, 1), np.float32))
    emit.put(steel | purlin, "#000000")
    return image("GTC_Dome", np.flipud(cv.a).copy()), image("GTC_DomeNight", np.flipud(emit.a).copy())


def park_images():
    """A car park's side, PW metres wide and PT tall: plinth, the open storey behind vertical aluminium louvres
    between concrete columns, the fascia, a glass balustrade round the roof; the night map lights the deck inside."""
    w, h = 256, 212                        # 32 px a metre
    k = w / PW
    cv = Canvas(w, h, "#c4c2bc")
    z = (h - cv.y) / k                      # metres up (row 0 is the top before the flip below)
    x = cv.x / k
    cv.noise(0.04, 5)
    opening = (z > 0.45) & (z < 3.9)
    col = np.abs(x - PW / 2) < 0.45
    cv.put(opening, "#2c3032")
    louvre = opening & (np.mod(x, 0.3) < 0.09) & ~col & (z > 1.1)
    cv.put(louvre, "#9aa2a6")
    cv.put(opening & (np.abs(z - 1.05) < 0.06) & ~col, "#8a9196")
    cv.put(col & opening, "#bdbbb5")
    cv.put((np.abs(z - 4.75) < 0.05), "#8f8d88")
    cv.put((z >= PH) & (z < PT - 0.06), "#9fb7b6")
    cv.put((z >= PH) & ((np.mod(x, 2.0) < 0.07) | (z > PT - 0.12)), "#b9bdbe")
    cv.put(z < 0.45, "#a9a7a1")
    emit = Canvas(w, h, "#000000")
    emit.put(opening & ~louvre & ~col, "#5a5648")
    return image("GTC_Park", np.flipud(cv.a).copy()), image("GTC_ParkNight", np.flipud(emit.a).copy())


def roof_image():
    """The planted roof, 48 m a repeat: grass in patches of two greens, a paved path every 48 m each way."""
    n = 256
    k = n / 48.0
    cv = Canvas(n, n, "#6c8748")
    cv.noise(0.16, 9)
    rng = np.random.default_rng(4)
    cv.a *= np.kron(rng.uniform(0.9, 1.08, (16, 16)), np.ones((16, 16)))[..., None]
    x, y = cv.x / k, cv.y / k
    cv.put((np.abs(x - 24) < 1.1) | (np.abs(y - 24) < 1.1), "#a9a796")
    return image("GTC_Roof", np.flipud(cv.a).copy())


def materials():
    dome, dome_n = dome_images()
    park, park_n = park_images()
    lobby = dict(floorH=7.0, colW=2.4, glass="#5e7783", frame="#d4d7d8", spandrel="#d4d7d8", mull=0.03, slab=0.02,
                 metal=0.85, rough=0.04, lit=0.9, warm="#ffe2b8", coolShare=0.0, seed=41)
    return dict(
        dome=material("GTC_Dome", "#86b2a7", 0.12, metal=0.55, tex=dome, emit_tex=dome_n, props={"wet": "surface", "glow": "none", "emit": "night"}),
        granite=material("GTC_Granite", "#a9a59c", 0.7, props={"wet": "damp", "glowStrength": 0.6}),
        park=material("GTC_Park", "#c4c2bc", 0.8, tex=park, emit_tex=park_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.5}),
        concrete=material("GTC_Concrete", "#c4c2bc", 0.85, props={"wet": "damp", "glow": "none"}),
        roof=material("GTC_Roof", "#6f8a4a", 0.95, tex=roof_image(), props={"wet": "ground", "glow": "none"}),
        lobby=facade("GTC_Lobby", lobby),
        white=material("GTC_White", "#e8e9e6", 0.45, metal=0.3, props={"wet": "surface", "glowStrength": 0.6}),
        steel=material("GTC_Steel", "#9aa0a4", 0.4, metal=0.8, props={"wet": "surface", "glow": "none"}),
        letters=material("GTC_Letters", "#f4f6f8", 0.4, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 1.0, 1.0], "glowStrength": 0.5}),
        board=material("GTC_Board", "#24425f", 0.5, props={"wet": "surface", "glow": "none"}),
        leaf=material("GTC_Leaf", "#5d7a3c", 0.9, props={"wet": "none", "glow": "none"}),
        trunk=material("GTC_Trunk", "#6b5a48", 0.9, props={"wet": "none", "glow": "none"}),
    )


TILE = dict(granite=3.0, concrete=4.0, roof=48.0, white=3.0, steel=2.0, board=2.0, leaf=2.0, trunk=1.0)


# ---------------------------------------------------------------- parts

def dome_shell(g, base, c, steps, key="dome"):
    """The egg: rings scaled about c by s, at z = Z0 + (H - Z0)(1 - s^2.2)^0.42, closed by a fan at the top.
    u along each ring scaled to the base's perimeter (the lattice converges like a grid shell), v up the slant."""
    m = len(base)

    def ring(s):
        return [(c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s) for x, y in base]

    def zf(s):
        return Z0 + (H - Z0) * max(0.0, 1 - s ** 2.2) ** 0.42

    per0 = sum(math.hypot(base[(i + 1) % m][0] - base[i][0], base[(i + 1) % m][1] - base[i][1]) for i in range(m))
    cum = [0.0]
    for i in range(m):
        cum.append(cum[-1] + math.hypot(base[(i + 1) % m][0] - base[i][0], base[(i + 1) % m][1] - base[i][1]))
    # u stretched so the perimeter is a whole number of diamonds: no seam where the ring closes
    kk = max(1, round(per0 / LAT)) * LAT / per0
    cum = [u * kk for u in cum]
    rings = [(s, ring(s), zf(s)) for s in steps]
    ids = [[g.vert((x, y, z)) for x, y in r] for s, r, z in rings]
    # v: slant length along the mean meridian
    v = [0.0]
    rm = per0 / TAU
    for j in range(1, len(rings)):
        v.append(v[-1] + math.hypot(rm * (rings[j - 1][0] - rings[j][0]), rings[j][2] - rings[j - 1][2]))
    for j in range(len(rings) - 1):
        for i in range(m):
            k = (i + 1) % m
            uv = [(cum[i] / LAT, v[j] / LAT), (cum[i + 1] / LAT, v[j] / LAT), (cum[i + 1] / LAT, v[j + 1] / LAT), (cum[i] / LAT, v[j + 1] / LAT)]
            g.face([ids[j][i], ids[j][k], ids[j + 1][k], ids[j + 1][i]], key, uv, True)
    top = g.vert((c[0], c[1], H))
    vt = v[-1] + rm * rings[-1][0]
    for i in range(m):
        k = (i + 1) % m
        g.face([ids[-1][i], ids[-1][k], top], key, [(cum[i] / LAT, v[-1] / LAT), (cum[i + 1] / LAT, v[-1] / LAT), ((cum[i] + cum[i + 1]) / 2 / LAT, vt / LAT)], True)
    return zf


def portal(g, tip, out, width, depth_in, depth_out, h, canopy):
    """A glazed entrance box at a tip of the egg: `out` the unit vector away from the dome (the tips are on the y
    axis here, so the box is axis-aligned), glass front and sides, a white roof slab running on as a canopy on two
    columns. Returns the front's centre (for the sign) and the box for a collider."""
    sx, sy = tip
    o = out[1]
    y_in, y_out = sy - o * depth_in, sy + o * depth_out
    y0, y1 = min(y_in, y_out), max(y_in, y_out)
    x0, x1 = sx - width / 2, sx + width / 2
    # glass front and sides (the facade shader wants u metres along, v metres up)
    yf = y_out
    front = [(x0, yf, 0), (x1, yf, 0), (x1, yf, h), (x0, yf, h)]
    g.polyn(front, "lobby", (0, o, 0), [(0, 0), (width, 0), (width, h), (0, h)] if o > 0 else [(width, 0), (0, 0), (0, h), (width, h)])
    for x, sgn in ((x0, -1), (x1, 1)):
        q = [(x, y0, 0), (x, y1, 0), (x, y1, h), (x, y0, h)]
        g.polyn(q, "lobby", (sgn, 0, 0), [(0, 0), (y1 - y0, 0), (y1 - y0, h), (0, h)])
    # the roof slab, running out as the canopy
    yc = y_out + o * canopy
    cy0, cy1 = min(y_in, yc), max(y_in, yc)
    g.box(x0 - 1.5, x1 + 1.5, cy0, cy1, h, h + 1.5, "white")
    # the name board along the fascia
    yb = yc + o * 0.03
    g.polyn([(x0 + 1.0, yb, h + 0.18), (x1 - 1.0, yb, h + 0.18), (x1 - 1.0, yb, h + 1.32), (x0 + 1.0, yb, h + 1.32)], "board", (0, o, 0))
    for x in (x0 - 0.8, x1 + 0.8):
        g.box(x - 0.3, x + 0.3, yc - o * 1.0 - 0.3, yc - o * 1.0 + 0.3, 0.0, h, "steel", skip=("-z", "+z"))
    # doors: four darker leaves in the front
    for i in range(4):
        dx = sx + (i - 1.5) * 3.2
        g.polyn([(dx - 1.3, yf + o * 0.05, 0), (dx + 1.3, yf + o * 0.05, 0), (dx + 1.3, yf + o * 0.05, 2.8), (dx - 1.3, yf + o * 0.05, 2.8)],
                "board", (0, o, 0))
    return (sx, yc, h + 0.75), (x0 - 1.5, x1 + 1.5, cy0, cy1), (x0, x1, y0, y1)


def tree_mesh(M):
    """A small roof-garden tree: a trunk and a two-tier crown, ~50 triangles."""
    t = Geo()
    n = 6
    for i in range(n):
        a0, a1 = TAU * i / n, TAU * (i + 1) / n
        t.poly([(0.12 * math.cos(a0), 0.12 * math.sin(a0), 0), (0.12 * math.cos(a1), 0.12 * math.sin(a1), 0),
                (0.09 * math.cos(a1), 0.09 * math.sin(a1), 1.6), (0.09 * math.cos(a0), 0.09 * math.sin(a0), 1.6)], "trunk")
    rings = [(1.2, 0.0), (1.6, 1.25), (3.2, 1.45), (4.3, 0.9), (4.8, 0.0)]
    pts = []
    for z, r in rings:
        pts.append([(r * math.cos(TAU * i / 7 + 0.3 * z), r * math.sin(TAU * i / 7 + 0.3 * z), z) for i in range(7)])
    for j in range(len(rings) - 1):
        for i in range(7):
            k = (i + 1) % 7
            a, b, c, d = pts[j][i], pts[j][k], pts[j + 1][k], pts[j + 1][i]
            if rings[j][1] == 0:
                t.poly([a, c, d], "leaf", smooth=True)
            elif rings[j + 1][1] == 0:
                t.poly([a, b, c], "leaf", smooth=True)
            else:
                t.poly([a, b, c, d], "leaf", smooth=True)
    return mesh_of(t, "RoofTree", M, TILE)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("交通中心")
    helpers = collection("碰撞体")
    font = bpy.data.fonts.load(FONT) if os.path.exists(FONT) else None

    base = resample(DOME, 144)
    if area(base) < 0:
        base = base[::-1]
    c = centroid(base)
    g = Geo()

    # ---- the egg: granite plinth, then the glass shell
    walls(g, base, 0.0, Z0, "granite", 3.0, 0.0, 3.0)
    steps = [1.0, 0.993, 0.98, 0.96, 0.93, 0.89, 0.84, 0.77, 0.69, 0.6, 0.5, 0.39, 0.27, 0.15, 0.06]
    zf = dome_shell(g, base, c, steps)
    # ---- the portals: north (towards T3C) and south
    north = max(base, key=lambda p: p[1])
    south = min(base, key=lambda p: p[1])
    # the north one stays short: the 机场线 T3 station's entrance kiosk (game (18103, -16045), 10.5 x 4.4 m, local
    # (-17.5, 140.8)) and the arrivals road north of it (centre local y 151.8) must stay clear - its canopy ends at
    # ~y 135, 3 m short of the kiosk
    pn = portal(g, (north[0], north[1]), (0, 1), 26.0, 9.0, 2.5, 7.5, 2.0)
    ps = portal(g, (south[0], south[1]), (0, -1), 22.0, 9.0, 6.0, 7.5, 5.0)

    # ---- the car parks
    pk = Geo()
    trees = []
    for poly in PARKS:
        poly = list(poly)
        if area(poly) < 0:
            poly = poly[::-1]
        walls(pk, poly, 0.0, PT, "park", PW, 0.0, PT)
        inner = offset(poly, 0.3)
        walls(pk, inner, PH, PT, "concrete", 4.0, 0.0, 4.0, out=False)
        # parapet cap and the roof deck
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            pk.polyn([(*poly[i], PT), (*poly[j], PT), (*inner[j], PT), (*inner[i], PT)], "concrete", (0, 0, 1))
        pk.polyn([(x, y, PH) for x, y in inner], "roof", (0, 0, 1))
        # trees on the roof: a staggered 17 m grid, 7 m off the edge
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        for row, y in enumerate(np.arange(min(ys) + 6, max(ys) - 6, 17.0)):
            for x in np.arange(min(xs) + 6 + (row % 2) * 8.5, max(xs) - 6, 17.0):
                if inside((x, y), poly) and edge_dist((x, y), poly) > 7.0:
                    trees.append((float(x), float(y)))

    det = collection("近景", main)
    g.build("Dome", det, M, TILE)
    pk.build("CarParks", det, M, TILE)
    tm = tree_mesh(M)
    rng = np.random.default_rng(12)
    for i, (x, y) in enumerate(trees):
        s = float(rng.uniform(0.85, 1.15))
        place(tm, f"tree{i}", det, T(x, y, PH) @ Matrix.Rotation(float(rng.uniform(0, TAU)), 4, "Z") @ Matrix.Scale(s, 4))
    tris = g.tris() + pk.tris()
    tree_tris = sum(len(p.vertices) - 2 for p in tm.polygons) * len(trees)

    # ---- signs: 交通中心 GTC over the north portal (seen from T3C and the viaducts), the station's name south
    nsign = 0
    if font is not None:
        sx, sy, sz = pn[0]
        # (a text faces -Y after the turn about X; turned atan2(out) + 90 deg about Z to face out)
        m = Matrix.Translation((sx, sy + 0.06, sz)) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
        nsign += sign(font, "交通中心  GTC", 1.0, m, "SignN", det, M["letters"], extrude=0.05)
        sx, sy, sz = ps[0]
        m = Matrix.Translation((sx, sy - 0.06, sz)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        nsign += sign(font, "交通中心  机场线 3号航站楼站", 0.9, m, "SignS", det, M["letters"], extrude=0.05)

    # ---- far level: the egg in 48 segments, the car parks as plain boxes with their roofs
    f = Geo()
    fb = resample(DOME, 48)
    if area(fb) < 0:
        fb = fb[::-1]
    walls(f, fb, 0.0, Z0, "granite", 3.0, 0.0, 3.0)
    dome_shell(f, fb, c, [1.0, 0.97, 0.88, 0.72, 0.5, 0.25])
    for poly in PARKS:
        poly = list(poly)
        if area(poly) < 0:
            poly = poly[::-1]
        walls(f, poly, 0.0, PT, "park", PW, 0.0, PT)
        f.polyn([(x, y, PT) for x, y in poly], "roof", (0, 0, 1))
    far = collection("LOD1", main)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    # ---- colliders: the egg as a hull (its west side is nearly straight), the portals' boxes, the car parks as
    # trimeshes (concave outlines with their gate notches)
    pts = [(x, y, 0.0) for x, y in base[::3]]
    for s in (0.98, 0.9, 0.75, 0.5, 0.2):
        pts += [(c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s, zf(s)) for x, y in base[::3]]
    pts.append((c[0], c[1], H))
    collider_pts(helpers, "dome", pts)
    for _, cb, bx in (pn, ps):
        collider_box(helpers, "portal", bx[0], bx[1], bx[2], bx[3], 0.0, 9.0)
        collider_box(helpers, "canopy", cb[0], cb[1], cb[2], cb[3], 7.5, 9.0)
    import bcity_landmark
    for k, poly in enumerate(PARKS):
        poly = list(poly)
        if area(poly) < 0:
            poly = poly[::-1]
        cg = Geo()
        walls(cg, poly, 0.0, PT, "x", 1.0, 0.0, 1.0)
        cg.polyn([(x, y, PH) for x, y in poly], "x", (0, 0, 1))
        o = cg.build(f"park{k}", helpers, {"x": None})
        o.data.materials.clear()
        bcity_landmark.rename(o, "COLMESH")

    # ---- footprint (the OSM building, and each car park) and clear zones (the lawn's trees and lamps go)
    flat_marker(helpers, "gtc", resample(DOME, 48), "FOOTPRINT")
    for k, poly in enumerate(PARKS):
        flat_marker(helpers, f"park{k}", list(poly), "FOOTPRINT")
    flat_marker(helpers, "gtc", [(c[0] + (x - c[0]) * 1.06, c[1] + (y - c[1]) * 1.025) for x, y in resample(DOME, 48)], "CLEAR")
    for k, poly in enumerate(PARKS):
        flat_marker(helpers, f"park{k}", list(poly), "CLEAR")

    sc = bpy.context.scene.bcity
    sc.lm_id, sc.name_zh, sc.name_en = "t3gtc", "T3交通中心", "T3 Ground Transportation Centre"
    sc.coord_mode, sc.lat, sc.lon, sc.heading = "LATLON", "40.0516999", "116.6097805", 0.0
    sc.far_distance = 1100
    sc.repo_path = REPO
    return dict(tris=tris, trees=len(trees), tree_tris=tree_tris, signs=nsign, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
