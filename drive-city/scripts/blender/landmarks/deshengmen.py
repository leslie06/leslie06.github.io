# 德胜门箭楼 the arrow tower of Deshengmen, the north-west gate of the Ming inner city, on its traffic island just
# north of the 北二环, built in Blender with the timber hall of hall.py and marked with the bcity_landmark add-on's
# conventions. OSM has its outline only (way 958430463, historic=fort), which the city drew as a red hall.
#
#   blender -b -P scripts/blender/landmarks/deshengmen.py -- [--out art/landmarks/deshengmen.blend] [--export]
#
# The 箭楼 approach of zhengyangmen.py (its materials, arrow windows and hall parts are copied here, so that file
# stays as it is), turned round: Deshengmen's arrow tower faces north, out of the city.
#
# Frame: Blender +X, +Y, metres, origin on the ground at the keep's centre, game (-2069.4, -4417.5), heading 179.86:
# the model is built facing -Y (as 正阳门's arrow tower, which faces south) and turned half round, so local -Y is
# north and local +X is west. OSM's outline (41.8 x 11 m, its long edges 0.14 degrees off east-west) gives the
# platform's north face and width; its depth (11 m) cannot hold the tower and is not used.
#
# The figures (北京旅游网, 墙根网, zh.wikipedia 德胜门): the 城台 12.6 m high, 39.5 m east-west at the top, battered;
# the tower 19.3 m over it (31.9 m in all), seen from above an inverted 凸: the front block seven bays, 34 x 12 m,
# grey brick with four rows of arrow windows (three under the 腰檐, one in the upper storey: 12 a row on the north,
# 4 a row on each end), and behind it the five-bay 庑座 (抱厦), 25 x 7.6 m, its three lintel doors to the south and
# one window in each end (82 windows in all); grey tiles edged in green glaze (灰筒瓦绿琉璃剪边), a double-eaved 歇山.
# The platform's depth (26 m) is the tower's 19.6 m plus a walk front and back. The barbican (瓮城) went in 1921 and
# the 1960s; a stretch of its west wall survives beside the 真武庙 behind the tower: drawn here as 27 m of 10 m wall
# running south from the platform's south-west corner. Doubtful: the exact line and height of that wall, and the
# 马道 (a ramp of steps up the platform's back from the east) - neither is in OSM.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, paving, place  # noqa: E402
from hall import beast_geo, beasts_on, bracket_geo, bracket_spots, paint_atlas, plaster, ring_beams, roofs, uvs  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "deshengmen.blend")
GREEN = "#2e7d57"

# --- the plan (local: -Y north, +X west) ------------------------------------------------------------------------
PLAT = dict(x0=-20.8, x1=20.8, y0=-8.2, y1=17.8, h=12.6)
BATTER = 1.0
BASE = 1.0
ZT = PLAT["h"]
KEEP = dict(hw=17.0, hd=6.0)
TOWER = SimpleNamespace(
    XS=[-17.0, -15.6, 15.6, 17.0], YS=[-6.0, -4.6, 4.6, 6.0], OX=17.0, OY=6.0, IX=15.6, IY=4.6,
    BEAM=(21.6, 22.2, 22.2, 23.1), UBEAM=(27.0, 27.6, 27.6, 28.5), OVERHANG=2.2,
    LOWER=dict(A=19.4, D=8.4, z=22.8, H=2.0, p=1.2, o=0.6, lift=0.6, Lc=5.0, Vc=2.6),
    UPPER=dict(A=18.1, D=7.1, z=28.1, H=3.4, p=1.6, o=0.8, lift=0.8, Lc=5.5, Vc=3.2),
    GABLE_X=14.9, PITCH=0.42, AMP=0.09, TRIM=1.2, RIDGE="trim", ROWS=10, END_ROWS=5, LOWER_ROWS=6)
# the 庑座 (抱厦): five bays against the keep's back (south) face under a single-eaved 歇山, centred on BAOSHA_Y
BAOSHA_Y = 9.8
BAOSHA = SimpleNamespace(
    XS=[-12.5, -7.5, -2.5, 2.5, 7.5, 12.5], YS=[-3.8, 0.0, 3.8], OX=12.5, OY=3.8, IX=12.5, IY=3.8,
    BEAM=(17.6, 18.2, 18.2, 19.0), UBEAM=(17.6, 18.2, 18.2, 19.0), OVERHANG=1.8, LOWER=None,
    UPPER=dict(A=14.3, D=5.6, z=18.7, H=2.8, p=1.5, o=0.6, lift=0.6, Lc=4.5, Vc=2.6),
    GABLE_X=11.6, PITCH=0.42, AMP=0.09, TRIM=1.2, RIDGE="trim", ROWS=8, END_ROWS=4)
WIN_ROWS = [ZT + 2.6, ZT + 5.0, ZT + 7.4]
ZU = TOWER.LOWER["z"] + TOWER.LOWER["H"] - 0.4           # the upper storey's wall foot
WIN_UPPER = ZU + 1.55
# the barbican's west wall (local +X is west), running south (local +Y) from the platform's back
WALL = dict(x0=14.3, x1=20.8, y0=16.6, y1=44.8, h=10.0)
# the 马道: steps along the platform's back face, rising from the middle to the east (local -X) corner
RAMP = dict(y0=16.8, y1=20.5, xg=7.0, xt=-17.4)
PARA = dict(t=0.55, low=1.0, high=1.85, merlon=1.35, gap=0.5)


# --- materials (zhengyangmen.py's, with the brick a little warmer) ------------------------------------------------

def brick_image(name, size=512):
    """Grey city-wall brick, 4 m a repeat: 0.48 x 0.12 m bricks in running bond, each a slightly different grey."""
    cv = Canvas(size, size, "#7e807d")
    rng = np.random.default_rng(37)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    col = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.85, 1.09, (40, 12))[row % 40, col % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.6) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.6), "#a3a5a0")
    cv.noise(0.08, 33)
    return image(name, np.flipud(cv.a).copy())


def make_materials():
    atlas, night = paint_atlas("DSM", portrait=False, emblem=False)
    return dict(
        atlas=material("DSM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("DSM_Plaster", "#a8321f", 0.85, tex=plaster(name="DSM_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        brick=material("DSM_Brick", "#7e807d", 0.9, tex=brick_image("DSM_BrickTex"), props={"wet": "damp", "glowStrength": 0.8}),
        stone=material("DSM_Stone", "#b3aea3", 0.75, props={"wet": "damp", "glowStrength": 0.6}),
        paving=material("DSM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
        tile=material("DSM_Tile", "#5d6164", 0.6, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("DSM_Trim", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.6}),
        marble=material("DSM_Marble", "#e4e0d6", 0.5, props={"wet": "surface", "glowStrength": 0.45}),
        red=material("DSM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        paint=material("DSM_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material("DSM_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
        cap=material("DSM_Cap", "#5f615e", 0.7, props={"wet": "damp"}),
    )


TILE = dict(plaster=4.0, brick=4.0, stone=2.0, paving=4.0, tile=2.0, trim=2.0, marble=2.0, red=2.0, paint=1.0, dark=1.0, cap=2.0)


# --- walls (observatory.py's battered block and parapet) ----------------------------------------------------------

def battered(g, x0, x1, y0, y1, z0, z1, key, faces, inset=BATTER, base=BASE):
    """A block whose named faces ('w' x0, 'e' x1, 's' y0, 'n' y1) lean in by `inset` over its height, on a stone base
    course 12 cm proud; returns the top's edges."""
    zb = z0 + base
    sign = dict(w=1, e=-1, s=1, n=-1)

    def edges(d):
        e = dict(w=x0, e=x1, s=y0, n=y1)
        for f in faces:
            e[f] += sign[f] * d
        return e

    def ring(e, z):
        return [(e["w"], e["s"], z), (e["e"], e["s"], z), (e["e"], e["n"], z), (e["w"], e["n"], z)]

    outs = ((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0))

    def band(ea, za, eb, zb_, k):
        a, b = ring(ea, za), ring(eb, zb_)
        for i, want in enumerate(outs):
            j = (i + 1) % 4
            g.polyn([a[i], a[j], b[j], b[i]], k, want)

    proud, foot, top = edges(-0.12), edges(0.0), edges(inset)
    if base > 0.01:
        band(proud, z0, proud, zb, "stone")
        a, b = ring(proud, zb), ring(foot, zb)
        for i in range(4):
            j = (i + 1) % 4
            g.polyn([a[i], a[j], b[j], b[i]], "stone", (0, 0, 1))
    band(foot, zb, top, z1, key)
    g.polyn(ring(top, z1), "paving", (0, 0, 1))
    return top


def parapet(g, a, b, out, battlements, key="brick", z=0.0, t=PARA["t"]):
    """A parapet along a..b (plan points) on a wall top at z, its outer face towards `out`; battlements: merlons with
    crenels between, else a plain 女墙."""
    a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
    d = (b - a)
    L = d.length
    d.normalize()
    o = Vector((out[0], out[1], 0))
    inner = -o * t

    def slab(s0, s1, z0, z1):
        p0, p1 = a + d * s0, a + d * s1
        P = [p0, p1, p1 + inner, p0 + inner]
        lo = [p + Vector((0, 0, z0)) for p in P]
        hi = [p + Vector((0, 0, z1)) for p in P]
        g.polyn([lo[0], lo[1], hi[1], hi[0]], key, tuple(o))
        g.polyn([lo[2], lo[3], hi[3], hi[2]], key, tuple(-o))
        g.polyn([lo[1], lo[2], hi[2], hi[1]], key, tuple(d))
        g.polyn([lo[3], lo[0], hi[0], hi[3]], key, tuple(-d))
        g.polyn(hi, "cap", (0, 0, 1))
    slab(0.0, L, 0.0, PARA["low"])
    if not battlements:
        return
    step = PARA["merlon"] + PARA["gap"]
    n = max(1, int((L + PARA["gap"]) // step))
    pad = (L - (n * step - PARA["gap"])) / 2
    for i in range(n):
        s0 = pad + i * step
        slab(s0, s0 + PARA["merlon"], PARA["low"], PARA["high"])


# --- parts --------------------------------------------------------------------------------------------------

def arrow_window():
    """An arrow window: a dark opening in a white lime frame with a sill and a lintel (no 1915 hoods here)."""
    g = Geo()
    g.polyn([(-0.5, 0.0, -0.55), (0.5, 0.0, -0.55), (0.5, 0.0, 0.55), (-0.5, 0.0, 0.55)], "dark", (0, -1, 0))
    g.box(-0.7, 0.7, -0.18, 0.02, -0.74, -0.59, "marble")
    for sx in (-1, 1):
        g.box(sx * 0.6 - 0.08, sx * 0.6 + 0.08, -0.12, 0.02, -0.59, 0.6, "marble", skip=("+y",))
    g.box(-0.7, 0.7, -0.12, 0.02, 0.6, 0.74, "marble", skip=("+y",))
    return g


def hall_parts(M):
    return dict(
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze=GREEN), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze=GREEN), "ImmortalMesh", M, TILE),
        window=mesh_of(arrow_window(), "Window", M, TILE),
    )


def build():
    clear_file()
    ensure_addon()
    M = make_materials()
    main = collection("德胜门箭楼")
    H, K, B, P, W = TOWER, KEEP, BAOSHA, PLAT, WALL
    g = Geo()
    # the platform: battered all round, paved on top, battlements outside (north, east, west), a plain parapet behind
    pt = battered(g, P["x0"], P["x1"], P["y0"], P["y1"], 0.0, ZT, "brick", "wens")
    parapet(g, (pt["w"], pt["s"]), (pt["e"], pt["s"]), (0, -1), True, z=ZT)
    parapet(g, (pt["w"], pt["n"]), (pt["w"], pt["s"]), (-1, 0), True, z=ZT)
    parapet(g, (pt["e"], pt["s"]), (pt["e"], pt["n"]), (1, 0), True, z=ZT)
    ry_top = pt["w"] + 3.4                                  # the opening at the 马道's head (east end of the back)
    parapet(g, (pt["e"], pt["n"]), (ry_top, pt["n"]), (0, 1), False, z=ZT)
    # the barbican's west wall, its outer face (local +X) crenellated, a plain parapet inside
    wt = battered(g, W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"], "brick", "wen", inset=0.8)
    parapet(g, (wt["e"], P["y1"] - 0.2), (wt["e"], wt["n"]), (1, 0), True, z=W["h"])
    parapet(g, (wt["e"], wt["n"]), (wt["w"], wt["n"]), (0, 1), True, z=W["h"])
    parapet(g, (wt["w"], wt["n"]), (wt["w"], P["y1"] - 0.2), (-1, 0), False, z=W["h"])

    # the 马道: steps on a brick wedge along the platform's back, from the middle up to the east corner, and a landing
    y0, y1, xg, xt = RAMP["y0"], RAMP["y1"], RAMP["xg"], RAMP["xt"]
    n = 42
    run = (xg - xt) / n
    for k in range(n):
        xa, xb, z = xg - (k + 1) * run, xg - k * run, (k + 1) * ZT / n
        g.box(xa - 0.02, xb, y0, y1, z - ZT / n, z, "stone", skip=("-z", "-y", "-x") if k else ("-z", "-y"))
    g.polyn([(xg, y1, 0.0), (xt, y1, ZT), (xt, y1, 0.0)], "brick", (0, 1, 0))
    g.box(P["x0"] - 0.12, xt, y0, y1, 0.0, ZT, "brick", skip=("-z", "-y", "+x"))           # the landing
    g.polyn([(P["x0"] - 0.12, y0, ZT), (xt, y0, ZT), (xt, y1, ZT), (P["x0"] - 0.12, y1, ZT)], "paving", (0, 0, 1))
    rail = [(xg - k * run, k * ZT / n) for k in range(n + 1)]
    for (xa, za), (xb, zb) in zip(rail, rail[1:]):
        for yy, out in ((y1 + 0.02, 1), (y1 - 0.4, -1)):
            g.polyn([(xa, yy, za), (xb, yy, zb), (xb, yy, zb + 1.0), (xa, yy, za + 1.0)], "brick", (0, out, 0))
        g.polyn([(xa, y1 + 0.02, za + 1.0), (xb, y1 + 0.02, zb + 1.0), (xb, y1 - 0.4, zb + 1.0), (xa, y1 - 0.4, za + 1.0)], "cap", (0, 0, 1))
    parapet(g, (xt, y1), (P["x0"] - 0.12, y1), (0, 1), True, z=ZT)
    parapet(g, (P["x0"] - 0.12, y1), (P["x0"] - 0.12, pt["n"]), (-1, 0), True, z=ZT)

    # the keep: brick from the terrace to the bracket band, a plinth course at its foot
    g.box(-K["hw"], K["hw"], -K["hd"], K["hd"], ZT, H.BEAM[0], "brick", skip=("-z", "+z"))
    g.box(-K["hw"] - 0.25, K["hw"] + 0.25, -K["hd"] - 0.25, K["hd"] + 0.25, ZT, ZT + 0.7, "brick", skip=("-z",))
    ring_beams(H, g, True, *H.BEAM)
    g.box(-H.IX, H.IX, -H.IY, H.IY, ZU, H.UBEAM[0], "brick", skip=("-z", "+z"))
    ring_beams(H, g, False, *H.UBEAM)
    hips = roofs(H, g)
    # the 庑座: brick ends, a red back with three lintel doors, its own roof
    gb = Geo()
    gb.box(-B.OX, B.OX, -B.OY, B.OY, ZT, B.BEAM[0], "brick", skip=("-z", "+z", "-y", "+y"))
    gb.polyn([(-B.OX, B.OY, ZT), (B.OX, B.OY, ZT), (B.OX, B.OY, B.BEAM[0]), (-B.OX, B.OY, B.BEAM[0])], "plaster", (0, 1, 0))
    gb.box(-B.OX - 0.2, B.OX + 0.2, -B.OY, B.OY + 0.2, ZT, ZT + 0.6, "stone", skip=("-z", "-y"))
    for xd in (-5.0, 0.0, 5.0):
        gb.polyn([(xd - 1.2, B.OY + 0.06, ZT + 0.6), (xd + 1.2, B.OY + 0.06, ZT + 0.6), (xd + 1.2, B.OY + 0.06, ZT + 3.8), (xd - 1.2, B.OY + 0.06, ZT + 3.8)],
                 "atlas", (0, 1, 0), uvs=uvs("gatedoor", QUAD))
        gb.box(xd - 1.5, xd + 1.5, B.OY, B.OY + 0.25, ZT + 3.8, ZT + 4.2, "stone", skip=("-y",))         # the lintel
        for sx in (-1, 1):
            gb.box(xd + sx * 1.35 - 0.15, xd + sx * 1.35 + 0.15, B.OY, B.OY + 0.22, ZT + 0.6, ZT + 3.8, "stone", skip=("-y",))
    ring_beams(B, gb, True, *B.BEAM)
    bhips = roofs(B, gb)
    mb = T(0, BAOSHA_Y, 0)
    g.add(gb, mb)
    bhips = [[mb @ p for p in line] for line in bhips]
    g.build("ArrowTower", collection("箭楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = hall_parts(M)
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    spots += [(p + Vector((0, BAOSHA_Y, 0)), yaw) for p, yaw in bracket_spots(B, True, B.BEAM[2])]
    for i, (p, yaw) in enumerate(spots):
        if p.y < K["hd"] + 0.5 and p.y > K["hd"] - 0.5 and abs(p.x) < B.OX + 0.5 and p.z < 20:
            continue                       # the 庑座's front ring stands inside the keep's wall
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips + bhips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=5 if i >= len(hips) else 6)
    k = 0
    for z in WIN_ROWS + [WIN_UPPER]:
        upper = z > ZU
        hw, hd = (H.IX, H.IY) if upper else (K["hw"], K["hd"])
        for i in range(12):                                          # the north (local -Y) face
            place(mesh["window"], f"Win.{k:03d}", parts, T((-14.3 + 2.6 * i) * hw / K["hw"], -hd - 0.02, z))
            k += 1
        for sx in (-1, 1):                                           # the ends
            for j in range(4):
                y = (-4.2 + 2.8 * j) * hd / K["hd"]
                place(mesh["window"], f"Win.{k:03d}", parts, T(sx * (hw + 0.02), y, z) @ Rz(sx * math.pi / 2))
                k += 1
    for sx in (-1, 1):                                               # one in each end of the 庑座
        place(mesh["window"], f"Win.{k:03d}", parts, T(sx * (B.OX + 0.02), BAOSHA_Y + 0.6, ZT + 3.4) @ Rz(sx * math.pi / 2))
        k += 1

    far = Geo()
    battered(far, P["x0"], P["x1"], P["y0"], P["y1"], 0.0, ZT + 1.4, "brick", "wens", base=0.0)
    battered(far, W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"] + 1.4, "brick", "wen", inset=0.8, base=0.0)
    far.polyn([(xg, y1, 0.0), (xt, y1, ZT), (xt, y0, ZT), (xg, y0, 0.0)], "stone", (0.5, 0, 1))
    far.box(-K["hw"], K["hw"], -K["hd"], K["hd"], ZT, H.LOWER["z"] + 0.4, "brick", skip=("-z",))
    far.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "brick", skip=("-z",))
    far.box(-B.OX, B.OX, K["hd"], BAOSHA_Y + B.OY, ZT, B.UPPER["z"] + 0.3, "brick", skip=("-z",))
    roofs(H, far, lod=True)
    fb = Geo()
    roofs(B, fb, lod=True)
    far.add(fb, mb)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    foot = [(x, y, 0.0) for x in (P["x0"], P["x1"]) for y in (P["y0"], P["y1"])]
    top = [(x, y, ZT) for x in (pt["w"], pt["e"]) for y in (pt["s"], pt["n"])]
    collider_pts(helpers, "platform", foot + top)
    wfoot = [(x, y, 0.0) for x in (W["x0"], W["x1"]) for y in (W["y0"], W["y1"])]
    wtop = [(x, y, W["h"]) for x in (wt["w"], wt["e"]) for y in (W["y0"], wt["n"])]
    collider_pts(helpers, "wall", wfoot + wtop)
    collider_box(helpers, "keep", -K["hw"], K["hw"], -K["hd"], K["hd"], ZT, 31.0)
    collider_box(helpers, "baosha", -B.OX, B.OX, K["hd"], BAOSHA_Y + B.OY, ZT, 21.0)
    t = PARA["t"]
    for x0_, x1_, y0_, y1_, z_ in ((pt["w"], pt["e"], pt["s"], pt["s"] + t, ZT), (pt["w"], pt["w"] + t, pt["s"], pt["n"], ZT),
                                   (pt["e"] - t, pt["e"], pt["s"], pt["n"], ZT), (ry_top, pt["e"], pt["n"] - t, pt["n"], ZT),
                                   (wt["e"] - t, wt["e"], P["y1"], wt["n"], W["h"]), (wt["w"], wt["w"] + t, P["y1"], wt["n"], W["h"]),
                                   (wt["w"], wt["e"], wt["n"] - t, wt["n"], W["h"]),
                                   (P["x0"] - 0.12, xt, y1 - t, y1, ZT), (P["x0"] - 0.12, P["x0"] - 0.12 + t, y0, y1, ZT)):
        collider_box(helpers, "parapet", x0_, x1_, y0_, y1_, z_, z_ + 1.3)
    collider_pts(helpers, "ramp", [(xg, y0, 0.0), (xg, y1, 0.0), (xt, y0, ZT), (xt, y1, ZT), (xt, y0, 0.0), (xt, y1, 0.0)], role="WALK")
    collider_box(helpers, "landing", P["x0"] - 0.12, xt, y0, y1, 0.0, ZT)
    collider_pts(helpers, "ramprail", [(xg, y1 - 0.4, 0.0), (xg, y1 + 0.02, 0.0), (xg, y1 - 0.4, 1.0), (xg, y1 + 0.02, 1.0),
                                       (xt, y1 - 0.4, ZT), (xt, y1 + 0.02, ZT), (xt, y1 - 0.4, ZT + 1.0), (xt, y1 + 0.02, ZT + 1.0)])
    flat_marker(helpers, "platform", [(P["x0"] - 0.6, P["y0"] - 0.4), (P["x1"] + 0.6, P["y0"] - 0.4), (P["x1"] + 0.6, P["y1"] + 0.2),
                                      (P["x0"] - 0.6, P["y1"] + 0.2)], "FOOTPRINT")
    flat_marker(helpers, "ramp", [(P["x0"] - 0.6, y0), (xg + 0.5, y0), (xg + 0.5, y1 + 0.3), (P["x0"] - 0.6, y1 + 0.3)], "FOOTPRINT")
    flat_marker(helpers, "wall", [(W["x0"] - 0.2, P["y1"]), (W["x1"] + 0.3, P["y1"]), (W["x1"] + 0.3, W["y1"] + 0.3), (W["x0"] - 0.2, W["y1"] + 0.3)], "FOOTPRINT")
    # clear zones are hulled: one round the platform and its ramp, one round the wall
    flat_marker(helpers, "clear", [(P["x0"] - 2.0, P["y0"] - 1.5), (P["x1"] + 2.0, P["y0"] - 1.5), (P["x1"] + 2.0, y1 + 1.5),
                                   (P["x0"] - 2.0, y1 + 1.5)], "CLEAR")
    flat_marker(helpers, "clearWall", [(W["x0"] - 1.5, P["y1"]), (W["x1"] + 2.0, P["y1"]), (W["x1"] + 2.0, W["y1"] + 1.5),
                                       (W["x0"] - 1.5, W["y1"] + 1.5)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "deshengmen", "德胜门箭楼", "Deshengmen Arrow Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -2069.4, -4417.5, 179.86
    s.far_distance = 600
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots), windows=k)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
