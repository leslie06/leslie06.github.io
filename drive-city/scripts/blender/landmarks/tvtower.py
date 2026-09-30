# 中央广播电视塔 Central Radio & TV Tower (1992, 405 m), built in Blender and marked with the bcity_landmark
# add-on's conventions. OSM has it as way 403383764 (building=yes, man_made=tower, height=405: a 72 m circle,
# which the city drew as a 405 m prism) inside way 652347738 (building=yes, no height: the round terrace and
# the 栈桥 approach running 205 m east towards 西三环).
#
#   blender -b -P scripts/blender/landmarks/tvtower.py -- [--out art/landmarks/tvtower.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the tower's circle
# (39.9181765, 116.3002994), heading 0.
#
# The figures (zh.wikipedia, and proportions measured off Commons photographs, e.g. "Central TV Tower from
# Yuyuantan (20211022095011)" and "Beijing TV Tower 1 (2007-07)"): the 退台, two terraces ringed by white
# marble railings (r 77 at 0.9 m with the approach, r 55 at 2.4 m); the round 塔座 (OSM's circle, r 36):
# a glass ground storey under a gold fascia, a glass storey above leaning out to a gold crown, a flat roof
# with a gold collar round the foot of the shaft; the concrete shaft, ~30 m across at its foot and ~15 m at
# 192 m, slip-formed (the lift lines drawn in its texture; the real shaft is smooth - the vertical ribs are
# on the gold drum under the pod); the 宫灯-shaped pod: the ribbed gold drum (192-206 m), a band with two
# glass stripes, the gold bowl flaring out to the glazed restaurant / observation floors (46 m across,
# 218-236 m), the open-air deck at 238 m with its railing, the set-back upper glass tier, a gold cone roof
# and the top drum to 257.5 m; then the square antenna column (panels painted on it) to 330 m and the
# red-and-white mast to 405 m. Red aviation lights on the mast, the pod and the shaft (lit at night); the
# pod's glass is the kit's facade shader, so its windows light up at night.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_box, collider_pts, flat_marker, paving  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tvtower.blend")

TAU = 2 * math.pi
T1 = dict(r=77.0, h=0.9)                   # lower terrace
ARM = dict(x0=72.0, x1=281.0, hw=25.0)     # the approach (栈桥), level with the lower terrace
T2 = dict(r=55.0, h=2.4)                   # upper terrace
POD_R = 36.0                               # the 塔座 (OSM's circle)
ROOF = 20.5                                # its flat roof
SHAFT_TOP = 192.0
TOP_DRUM = 257.5
MAST_STEP, MAST_TOP, RW_TOP, TOP = 296.0, 330.0, 399.0, 405.0


def shaft_r(z):
    t = max(0.0, (SHAFT_TOP - z) / SHAFT_TOP)
    return 7.3 + 8.0 * t ** 1.1


# the pod, bottom to top, as (key, [(r, z), ...]) bands walked along the outer skin
POD = [
    ("dark", [(7.3, 192.0), (10.7, 192.0)]),                               # underside of the drum
    ("goldrib", [(10.7, 192.0), (10.7, 206.0)]),                           # the ribbed drum
    ("dark", [(10.7, 206.0), (12.9, 206.0), (12.9, 206.35), (12.5, 206.35)]),  # floodlight ledge
    ("gold", [(12.5, 206.35), (12.5, 208.0)]),
    ("podglass", [(12.5, 208.0), (12.5, 209.8)]),
    ("gold", [(12.5, 209.8), (12.5, 211.0)]),
    ("podglass", [(12.5, 211.0), (12.5, 212.8)]),
    ("gold", [(12.5, 212.8), (12.5, 215.0)]),
    ("gold", [(12.5, 215.0), (15.4, 215.45), (17.4, 216.3), (18.5, 217.4), (18.8, 218.3)]),   # the bowl
    ("podglass", [(18.8, 218.3), (20.6, 221.6), (22.1, 225.0), (22.9, 228.6)]),             # restaurant, sloped glass
    ("podglass", [(22.9, 228.6), (23.0, 235.4)]),                                           # observation floor
    ("gold", [(23.0, 235.4), (23.2, 235.6), (23.2, 237.5)]),                                # deck fascia
    ("deck", [(23.2, 237.5), (18.8, 237.5)]),                                               # the open-air deck
    ("gold", [(18.8, 237.5), (16.6, 238.6), (15.2, 239.6)]),
    ("podglass", [(15.2, 239.6), (15.6, 245.8)]),                                           # upper tier
    ("gold", [(15.6, 245.8), (15.9, 246.0), (15.9, 247.3)]),
    ("gold", [(15.9, 247.3), (13.0, 248.8), (10.4, 250.0), (8.0, 251.0)]),                  # the cone roof
    ("gold", [(8.0, 251.0), (8.0, TOP_DRUM)]),                                              # the top drum
    ("roof", [(8.0, TOP_DRUM), (3.6, TOP_DRUM)]),
]


# --- textures ------------------------------------------------------------------------------------------

def concrete_image():
    """Slip-formed concrete: 12 m a repeat vertically, a lift line every 1.5 m, faint streaks."""
    cv = Canvas(256, 512, "#b4ab9b")
    cv.noise(0.06, 3)
    rng = np.random.default_rng(7)
    streak = np.repeat(rng.uniform(0.95, 1.04, 64), 4)[None, :, None]
    cv.a *= streak
    cv.put(np.mod(cv.y, 64) < 2.2, "#a59d8d")
    cv.put((np.mod(cv.y, 64) >= 2.2) & (np.mod(cv.y, 64) < 4), "#c7bfae")
    return image("TV_Concrete", np.flipud(cv.a).copy())


def gold_image():
    """Gold-anodised cladding: panels 1.6 m wide and 3.2 m tall, dark seams."""
    cv = Canvas(256, 256, "#d2b05a")
    rng = np.random.default_rng(5)
    col = (cv.x // 128).astype(int)
    row = (cv.y // 256).astype(int)
    cv.a *= rng.uniform(0.93, 1.06, (2, 2))[row % 2, col % 2][..., None]
    cv.a *= (0.92 + 0.12 * (np.mod(cv.x, 128) / 128.0))[..., None]
    cv.put((np.mod(cv.x, 128) < 3) | (cv.y < 3), "#6d5a2a")
    return image("TV_Gold", np.flipud(cv.a).copy())


def mast_image():
    """The antenna column's face: legs at the edges, a strut every 3 m, V dipole panels."""
    cv = Canvas(128, 256, "#d4ccb6")
    cv.noise(0.05, 9)
    cv.rect(0, 0, 9, 256, "#9d977f")
    cv.rect(119, 0, 128, 256, "#9d977f")
    for y in (0, 128):
        cv.rect(0, y, 128, y + 6, "#a8a18a")
        cv.line(34, y + 22, 64, y + 100, 5, "#6f6c62")
        cv.line(94, y + 22, 64, y + 100, 5, "#6f6c62")
    return image("TV_Mast", np.flipud(cv.a).copy())


def redwhite_image():
    cv = Canvas(32, 256, "#eeeeea")
    cv.rect(0, 0, 32, 128, "#c43228")
    return image("TV_RedWhite", np.flipud(cv.a).copy())


def rail_image():
    """White marble railing: a post every 2.4 m, the panel between with its carved recess."""
    cv = Canvas(256, 128, "#e6e2d8")
    cv.noise(0.05, 13)
    cv.rect(0, 0, 256, 12, "#f2efe8")
    cv.rect(24, 34, 232, 100, "#bdb8ad")
    cv.rect(30, 40, 226, 94, "#d8d3c8")
    cv.rect(0, 0, 14, 128, "#f4f1ea")
    cv.rect(242, 0, 256, 128, "#f4f1ea")
    cv.rect(0, 118, 256, 128, "#c9c4b9")
    return image("TV_Rail", np.flipud(cv.a).copy())


def materials():
    lit = dict(glass="#34444f", frame="#b79549", spandrel="#b79549", mull=0.05, slab=0.12, metal=0.75, rough=0.08, lit=0.75, warm="#ffd6a0", coolShare=0.1)
    return dict(
        concrete=material("TV_Concrete", "#b4ab9b", 0.85, tex=concrete_image(), props={"wet": "damp", "glowStrength": 0.8}),
        gold=material("TV_Gold", "#d2b05a", 0.35, metal=0.65, tex=gold_image(), props={"wet": "surface", "glowStrength": 0.9}),
        goldrib=material("TV_GoldRib", "#cfad58", 0.35, metal=0.65, tex=gold_image(), props={"wet": "surface", "glowStrength": 0.9}),
        podglass=facade("TV_PodGlass", dict(lit, floorH=4.4, colW=1.25, seed=17)),
        baseglass=facade("TV_BaseGlass", dict(lit, floorH=5.0, colW=1.8, lit=0.6, seed=18)),
        dark=material("TV_Dark", "#3a3c3e", 0.5, metal=0.6, props={"wet": "surface", "glow": "none"}),
        deck=material("TV_Deck", "#8d8a84", 0.7, props={"wet": "ground", "glow": "none"}),
        roof=material("TV_Roof", "#6b6a66", 0.85, props={"wet": "ground", "glow": "none"}),
        mast=material("TV_Mast", "#d4ccb6", 0.6, metal=0.3, tex=mast_image(), props={"wet": "surface", "glowStrength": 0.5}),
        redwhite=material("TV_RedWhite", "#d8d0cc", 0.5, tex=redwhite_image(), props={"wet": "surface", "glowStrength": 0.5}),
        granite=material("TV_Granite", "#b3aea4", 0.75, props={"wet": "damp", "glowStrength": 0.6}),
        paving=material("TV_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 10}),
        rail=material("TV_Rail", "#e6e2d8", 0.6, tex=rail_image(), props={"wet": "damp", "glowStrength": 0.7}),
        water=material("TV_Water", "#1d2a30", 0.05, metal=0.2, props={"wet": "none", "glow": "none", "layer": 12}),
        red=material("TV_Red", "#b01810", 0.4, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.04, 0.02], "glowStrength": 9.0}),
    )


TILE = dict(paving=4.0, granite=3.0, roof=4.0, deck=3.0, dark=3.0, water=4.0)
FACADES = ("podglass", "baseglass")


# --- geometry ------------------------------------------------------------------------------------------

def rev(g, prof, segs, key, us=None, vs=None, smooth=True, turn=0.0):
    """
    A surface of revolution through (r, z) points walked along the outer skin from bottom to top (a flat
    underside outwards, a flat top inwards). UVs: facades in metres (u round the mid radius, v = z); the
    textured keys u = arc / us, v = z / vs.
    """
    rm = sum(r for r, _ in prof) / len(prof)
    circ = TAU * rm
    if key in FACADES:
        us, vs = 1.0, 1.0
    us = us or 3.2
    vs = vs or 3.2
    rings = [[g.vert((r * math.cos(turn + TAU * i / segs), r * math.sin(turn + TAU * i / segs), z)) for i in range(segs)] for r, z in prof]
    flat = all(abs(prof[j][1] - prof[0][1]) < 1e-6 for j in range(len(prof)))
    for j in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[j], prof[j + 1]
        for i in range(segs):
            k = (i + 1) % segs
            if flat:
                uv = None      # planar
            else:
                u0, u1 = circ * i / segs / us, circ * (i + 1) / segs / us
                uv = [(u0, z0 / vs), (u1, z0 / vs), (u1, z1 / vs), (u0, z1 / vs)]
            g.face((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]), key, uv, smooth and not flat)


def disk(g, r, z, segs, key, up=True):
    pts = [(r * math.cos(TAU * i / segs), r * math.sin(TAU * i / segs), z) for i in range(segs)]
    c = g.vert((0.0, 0.0, z))
    ids = [g.vert(p) for p in pts]
    for i in range(segs):
        k = (i + 1) % segs
        g.face((c, ids[i], ids[k]) if up else (c, ids[k], ids[i]), key)


def arc_pts(r, a0, a1, step):
    n = max(1, math.ceil(abs(a1 - a0) / step))
    return [(r * math.cos(a0 + (a1 - a0) * i / n), r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def rail(g, pts, z0, h=1.05, t=0.24, key="rail"):
    """A marble railing along a polyline (plan points): both faces and the top, u every 2.4 m."""
    u = 0.0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, by - ay)
        if L < 1e-6:
            continue
        nx, ny = -(by - ay) / L * t / 2, (bx - ax) / L * t / 2
        u1 = u + L / 2.4
        for s in (1, -1):
            quad = [(ax + nx * s, ay + ny * s, z0), (bx + nx * s, by + ny * s, z0), (bx + nx * s, by + ny * s, z0 + h), (ax + nx * s, ay + ny * s, z0 + h)]
            uv = [(u, 0), (u1, 0), (u1, 1), (u, 1)]
            g.polyn(quad, key, (nx * s, ny * s, 0), uv)
        g.polyn([(ax + nx, ay + ny, z0 + h), (bx + nx, by + ny, z0 + h), (bx - nx, by - ny, z0 + h), (ax - nx, ay - ny, z0 + h)], key, (0, 0, 1),
                [(u, 0.98), (u1, 0.98), (u1, 1.0), (u, 1.0)])
        u = u1


def wall_ring(g, pts, z0, z1, key):
    """Vertical outward faces along a plan polyline wound counter-clockwise."""
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        g.polyn([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], key, (by - ay, -(bx - ax), 0))


def flight(g, ang, width, z_top, n_rise, run, r_edge, key="granite", z_base=0.0):
    """Straight steps down from a terrace edge at polar angle `ang`, outward; returns the WALK ramp's points."""
    rise = (z_top - z_base) / n_rise
    loc = Geo()
    back = -0.8         # into the terrace, behind its curved edge
    for i in range(1, n_rise):
        loc.box(back, i * run, -width / 2, width / 2, z_base, z_top - i * rise, key, skip=("-z",))
    length = (n_rise - 1) * run
    m = Rz(ang) @ T(r_edge, 0.0, 0.0)
    g.add(loc, m)
    pts = []
    for (x, z) in ((0.0, z_base), (0.0, z_top), (length + run * 0.5, z_base)):
        for y in (-width / 2, width / 2):
            q = m @ Vector((x, y, z))
            pts.append((q.x, q.y, q.z))
    return pts


def openings_arc(r, gaps, step):
    """Arc runs of a full circle leaving out the angular gaps [(centre, half angle)]."""
    cuts = sorted(((c - h) % TAU, (c + h) % TAU) for c, h in gaps)
    runs = []
    for i, (a0, a1) in enumerate(cuts):
        b0 = a1
        b1 = cuts[(i + 1) % len(cuts)][0]
        if b1 <= b0:
            b1 += TAU
        runs.append(arc_pts(r, b0, b1, step))
    return runs


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("中央电视塔")
    helpers = collection("碰撞体")

    # ---- the terraces (退台) and the approach (栈桥)
    g = Geo()
    th = math.asin(ARM["hw"] / T1["r"])                          # where the arm leaves the circle
    wall_ring(g, arc_pts(T1["r"], th, TAU - th, TAU / 96), 0.0, T1["h"], "granite")
    for x0, x1, y in ((ARM["x0"], ARM["x1"], ARM["hw"]), (ARM["x0"], ARM["x1"], -ARM["hw"])):
        g.polyn([(x0, y, 0), (x1, y, 0), (x1, y, T1["h"]), (x0, y, T1["h"])], "granite", (0, 1 if y > 0 else -1, 0))
    g.polyn([(ARM["x1"], -ARM["hw"], 0), (ARM["x1"], ARM["hw"], 0), (ARM["x1"], ARM["hw"], T1["h"]), (ARM["x1"], -ARM["hw"], T1["h"])], "granite", (1, 0, 0))
    rev(g, [(T1["r"], T1["h"]), (T2["r"] - 1.0, T1["h"])], 96, "paving")       # lower terrace top (flat ring)
    g.polyn([(T1["r"] * math.cos(th) - 5.0, -ARM["hw"], T1["h"]), (ARM["x1"], -ARM["hw"], T1["h"]), (ARM["x1"], ARM["hw"], T1["h"]),
             (T1["r"] * math.cos(th) - 5.0, ARM["hw"], T1["h"])], "paving", (0, 0, 1))
    rev(g, [(T2["r"], T1["h"] - 0.05), (T2["r"], T2["h"])], 72, "granite", us=3.0, vs=3.0, smooth=False)
    rev(g, [(T2["r"], T2["h"]), (POD_R - 3.0, T2["h"])], 72, "paving")
    # the pool down the approach
    px0, px1, pw = 105.0, 262.0, 7.0
    for (x0, x1, y0, y1) in ((px0, px1, pw, pw + 0.5), (px0, px1, -pw - 0.5, -pw), (px0 - 0.5, px0, -pw - 0.5, pw + 0.5), (px1, px1 + 0.5, -pw - 0.5, pw + 0.5)):
        g.box(x0, x1, y0, y1, T1["h"] - 0.05, T1["h"] + 0.4, "granite", skip=("-z",))
    g.polyn([(px0, -pw, T1["h"] + 0.22), (px1, -pw, T1["h"] + 0.22), (px1, pw, T1["h"] + 0.22), (px0, pw, T1["h"] + 0.22)], "water", (0, 0, 1))

    # the flights: the lower terrace from the loop road (N, W, S) and at the approach's east end; the upper on all four axes
    walks = []
    for ang in (math.pi / 2, math.pi, 1.5 * math.pi):
        walks.append(flight(g, ang, 14.0, T1["h"], 3, 0.9, T1["r"]))
    loc = Geo()
    for i in range(1, 3):
        loc.box(ARM["x1"] - 0.5, ARM["x1"] + i * 0.9, -15.0, 15.0, 0.0, T1["h"] - i * 0.3, "granite")
    g.add(loc, Matrix.Identity(4))
    walks.append([(ARM["x1"], y, z) for y in (-15.0, 15.0) for z in (0.0, T1["h"])] + [(ARM["x1"] + 2.25, y, 0.0) for y in (-15.0, 15.0)])
    for ang in (0.0, math.pi / 2, math.pi, 1.5 * math.pi):
        walks.append(flight(g, ang, 12.0, T2["h"], 5, 0.42, T2["r"], z_base=T1["h"]))
    # railings: gaps at the flights and the approach
    g1 = Geo()
    ht1 = 7.6 / T1["r"]
    for run in openings_arc(T1["r"] - 0.2, [(math.pi / 2, ht1), (math.pi, ht1), (1.5 * math.pi, ht1), (0.0, th + 0.004)], TAU / 128):
        rail(g1, run, T1["h"])
    for y in (ARM["hw"] - 0.2, -(ARM["hw"] - 0.2)):
        rail(g1, [(T1["r"] * math.cos(th) - 0.2, y), (ARM["x1"] - 0.2, y)], T1["h"])
    for y0, y1 in ((-ARM["hw"] + 0.2, -15.6), (15.6, ARM["hw"] - 0.2)):
        rail(g1, [(ARM["x1"] - 0.2, y0), (ARM["x1"] - 0.2, y1)], T1["h"])
    ht2 = 6.6 / T2["r"]
    for run in openings_arc(T2["r"] - 0.2, [(0.0, ht2), (math.pi / 2, ht2), (math.pi, ht2), (1.5 * math.pi, ht2)], TAU / 96):
        rail(g1, run, T2["h"])

    # ---- the 塔座
    b = Geo()
    rev(b, [(POD_R - 2.5, T2["h"]), (POD_R - 2.5, 7.4)], 72, "baseglass")
    rev(b, [(POD_R - 2.5, 7.4), (POD_R, 7.4)], 72, "gold")                      # soffit over the set-back storey
    rev(b, [(POD_R, 7.4), (POD_R, 9.8)], 72, "gold", smooth=True)
    rev(b, [(POD_R, 9.8), (POD_R + 1.5, 17.0)], 72, "baseglass")
    rev(b, [(POD_R + 1.5, 17.0), (POD_R + 2.5, 20.5)], 72, "gold")
    rev(b, [(POD_R + 2.5, ROOF), (POD_R + 1.8, ROOF)], 72, "gold")
    rev(b, [(POD_R + 1.8, ROOF), (24.0, ROOF)], 72, "roof")
    rev(b, [(24.0, ROOF), (22.5, ROOF + 1.2), (18.0, ROOF + 2.6), (shaft_r(ROOF + 3.4) + 0.2, ROOF + 3.4)], 72, "gold")   # the collar
    # a gold gate over the east flight's head (the entrance's 门楼)
    for y in (-8.6, 7.4):
        b.box(47.0, 48.2, y, y + 1.2, T2["h"], T2["h"] + 9.0, "gold")
    b.box(46.6, 48.6, -9.0, 9.0, T2["h"] + 9.0, T2["h"] + 10.6, "gold")

    # ---- the shaft
    s = Geo()
    zs = [ROOF + 2.0, 40.0, 60.0, 85.0, 110.0, 135.0, 160.0, 178.0, SHAFT_TOP]
    rev(s, [(shaft_r(z), z) for z in zs], 40, "concrete", us=TAU * 11.0 / 16, vs=12.0)

    # ---- the pod
    p = Geo()
    for key, prof in POD:
        rev(p, prof, 48, key, us=3.2, vs=3.2)
    fin = Geo()
    fin.box(10.62, 11.1, -0.2, 0.2, 192.0, 206.0, "goldrib", skip=("-z", "-x"))
    for i in range(40):
        p.add(fin, Rz(TAU * (i + 0.5) / 40))
    # the deck's railing and the floodlight brackets under the pod
    for i in range(96):
        a = TAU * i / 96
        p.box(22.75 * math.cos(a) - 0.04, 22.75 * math.cos(a) + 0.04, 22.75 * math.sin(a) - 0.04, 22.75 * math.sin(a) + 0.04, 237.5, 238.7, "dark", skip=("-z",))
    rev(p, [(22.9, 238.6), (22.9, 238.75), (22.6, 238.75), (22.6, 238.6)], 96, "dark", smooth=False)

    # ---- the mast
    m = Geo()

    def column(g_, z0, z1, h0, h1, key, vs, cap_key="roof"):
        c0 = [(h0, -h0), (h0, h0), (-h0, h0), (-h0, -h0)]
        c1 = [(h1, -h1), (h1, h1), (-h1, h1), (-h1, -h1)]
        for i in range(4):
            k = (i + 1) % 4
            g_.polyn([(*c0[i], z0), (*c0[k], z0), (*c1[k], z1), (*c1[i], z1)], key, (c0[i][0] + c0[k][0], c0[i][1] + c0[k][1], 0),
                     [(0, z0 / vs), (1, z0 / vs), (1, z1 / vs), (0, z1 / vs)])
        if cap_key:
            g_.polyn([(*c, z1) for c in c1], cap_key, (0, 0, 1))

    column(m, TOP_DRUM - 0.5, MAST_STEP, 3.3, 3.0, "mast", 6.0)
    m.box(-4.2, 4.2, -4.2, 4.2, MAST_STEP - 0.4, MAST_STEP, "dark")
    column(m, MAST_STEP, MAST_TOP, 2.2, 1.9, "mast", 5.0)
    m.box(-2.8, 2.8, -2.8, 2.8, MAST_TOP - 0.4, MAST_TOP, "dark")
    rev(m, [(1.5, MAST_TOP), (0.8, RW_TOP)], 12, "redwhite", us=TAU * 1.15, vs=10.0)
    rev(m, [(0.8, RW_TOP), (0.45, RW_TOP), (0.45, RW_TOP + 0.3), (0.18, RW_TOP + 0.3), (0.1, TOP)], 8, "dark")
    # aviation lights: the tip, the red-and-white mast, the column's steps, the pod's top and deck, down the shaft
    L = Geo()
    lamps = [(0.0, 0.0, TOP - 0.2)]
    for z, r, n in ((RW_TOP + 0.3, 0.55, 3), (365.0, 1.25, 4), (MAST_TOP, 2.6, 4), (MAST_STEP, 4.0, 4), (TOP_DRUM, 7.6, 4),
                    (238.9, 22.9, 8), (192.4, 10.8, 4), (135.0, shaft_r(135.0), 4), (85.0, shaft_r(85.0), 4)):
        for i in range(n):
            a = TAU * (i + 0.5) / n
            lamps.append((r * math.cos(a), r * math.sin(a), z))
    for x, y, z in lamps:
        L.box(x - 0.3, x + 0.3, y - 0.3, y + 0.3, z, z + 0.55, "red")

    det = collection("塔", main)
    g.build("Terraces", det, M, TILE)
    g1.build("Railings", det, M, TILE)
    b.build("Base", det, M, TILE)
    s.build("Shaft", det, M, TILE)
    p.build("Pod", det, M, TILE)
    m.build("Mast", det, M, TILE)
    L.build("Lights", det, M, TILE)
    tris = sum(x.tris() for x in (g, g1, b, s, p, m, L))

    # ---- the far level: the silhouette in a few hundred triangles, seven materials
    f = Geo()
    wall_ring(f, arc_pts(T1["r"], th, TAU - th, TAU / 12), 0.0, T1["h"], "granite")
    f.box(ARM["x0"], ARM["x1"], -ARM["hw"], ARM["hw"], 0.0, T1["h"], "granite", skip=("-z", "-x"))
    disk(f, T1["r"], T1["h"], 12, "granite")
    rev(f, [(T2["r"], T1["h"]), (T2["r"], T2["h"]), (POD_R - 2.5, T2["h"])], 12, "granite", smooth=False)
    rev(f, [(POD_R - 2.5, T2["h"]), (POD_R + 1.5, 17.0)], 12, "podglass")
    rev(f, [(POD_R + 1.5, 17.0), (POD_R + 2.5, ROOF), (24.0, ROOF), (shaft_r(ROOF + 3.4), ROOF + 3.4)], 12, "gold", smooth=False)
    rev(f, [(shaft_r(z), z) for z in (ROOF + 3.4, 100.0, SHAFT_TOP)], 10, "concrete", us=TAU * 11.0 / 16, vs=12.0)
    far_pod = [
        ("gold", [(7.3, 192.0), (10.7, 192.0), (10.7, 206.0), (12.5, 206.0), (12.5, 215.0), (17.4, 216.3), (18.8, 218.3)]),
        ("podglass", [(18.8, 218.3), (22.1, 225.0), (23.0, 235.4)]),
        ("gold", [(23.0, 235.4), (23.2, 237.5), (15.2, 239.6)]),
        ("podglass", [(15.2, 239.6), (15.6, 245.8)]),
        ("gold", [(15.6, 245.8), (15.9, 247.3), (8.0, 251.0), (8.0, TOP_DRUM), (3.6, TOP_DRUM)]),
    ]
    for key, prof in far_pod:
        rev(f, prof, 10, key, smooth=key != "gold")
    fm = Geo()
    column(fm, TOP_DRUM - 0.5, MAST_STEP, 3.3, 3.0, "mast", 6.0, cap_key=None)
    column(fm, MAST_STEP, MAST_TOP, 2.2, 1.9, "mast", 5.0, cap_key="mast")
    rev(fm, [(1.5, MAST_TOP), (0.8, RW_TOP), (0.1, TOP)], 6, "redwhite", us=TAU * 1.15, vs=10.0)
    for x, y, z in lamps[:1] + lamps[16:20]:
        fm.box(x - 0.5, x + 0.5, y - 0.5, y + 0.5, z, z + 0.9, "red", skip=("-z",))
    far = collection("LOD1", main)
    f.build("Far", far, M, TILE)
    fm.build("FarMast", far, M, TILE)
    far_tris = f.tris() + fm.tris()

    # ---- colliders
    def ring_hull(name, r, z0, z1, n=24, role="COL"):
        pts = [(r * math.cos(TAU * i / n), r * math.sin(TAU * i / n), z) for z in (z0, z1) for i in range(n)]
        return collider_pts(helpers, name, pts, role)

    def frustum(name, z0, z1, n=16):
        pts = [(shaft_r(z) * math.cos(TAU * i / n) / math.cos(math.pi / n), shaft_r(z) * math.sin(TAU * i / n) / math.cos(math.pi / n), z) for z in (z0, z1) for i in range(n)]
        return collider_pts(helpers, name, pts)

    ring_hull("terrace", T1["r"], 0.0, T1["h"], 32)
    collider_box(helpers, "approach", ARM["x0"], ARM["x1"], -ARM["hw"], ARM["hw"], 0.0, T1["h"])
    ring_hull("upper", T2["r"], 0.0, T2["h"], 32)
    ring_hull("base", POD_R + 2.0, 0.0, ROOF, 24)
    ring_hull("collar", 23.0, ROOF, ROOF + 2.0, 16)
    for z0, z1 in ((ROOF, 70.0), (70.0, 130.0), (130.0, SHAFT_TOP)):
        frustum("shaft", z0, z1)
    pod_pts = []
    for _, prof in POD:
        for r, z in prof:
            pod_pts += [(r * math.cos(TAU * i / 16), r * math.sin(TAU * i / 16), z) for i in range(16)]
    collider_pts(helpers, "pod", pod_pts)
    collider_box(helpers, "mast", -3.3, 3.3, -3.3, 3.3, TOP_DRUM, MAST_TOP)
    for y in (-8.6, 7.4):
        collider_box(helpers, "gate", 47.0, 48.2, y, y + 1.2, T2["h"], T2["h"] + 9.0)
    for pts in walks:
        collider_pts(helpers, "steps", pts, role="WALK")
    # pool curb: a person steps over it, a stray car is already stopped by the terrace
    # footprint: the lower terrace with its flights and the approach (two pieces: circle and arm)
    circle = [((T1["r"] + 2.6) * math.cos(TAU * i / 32), (T1["r"] + 2.6) * math.sin(TAU * i / 32)) for i in range(32)]
    arm = [(ARM["x0"], -ARM["hw"] - 1.0), (ARM["x1"] + 2.6, -ARM["hw"] - 1.0), (ARM["x1"] + 2.6, ARM["hw"] + 1.0), (ARM["x0"], ARM["hw"] + 1.0)]
    flat_marker(helpers, "tower", circle, "FOOTPRINT")
    flat_marker(helpers, "approach", arm, "FOOTPRINT")
    flat_marker(helpers, "tower", circle, "CLEAR")
    flat_marker(helpers, "approach", arm, "CLEAR")

    sc = bpy.context.scene.bcity
    sc.lm_id, sc.name_zh, sc.name_en = "tvtower", "中央广播电视塔", "Central Radio & TV Tower"
    sc.coord_mode, sc.lat, sc.lon, sc.heading = "LATLON", "39.9181765", "116.3002994", 0.0
    sc.far_distance = 1500
    sc.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
