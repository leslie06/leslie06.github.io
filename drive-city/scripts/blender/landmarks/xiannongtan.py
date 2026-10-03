# 先农坛 the Temple of Agriculture (北京古代建筑博物馆), west of 天坛 across the axis, built in Blender with the timber
# halls of hall.py through yonghegong.py's toolkit (main_hall, simple_hall, walls, its accumulators), marked with the
# bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/xiannongtan.py -- [--out art/landmarks/xiannongtan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (-860, 3640), heading -2.0 (the halls'
# edges in OSM). The groups are placed from OSM's outlines turned into this frame (`.scratch/lm/xiannongtan/`), the
# layouts inside them checked on satellite imagery; OSM traces the halls from the air, so an outline is the eaves:
#   - 太岁殿 (way 587608666): seven bays, 歇山 in black glaze edged in green (黑琉璃筒瓦绿剪边), three flights in
#     front; 拜殿 (587608670) closing the court on the south; the long east and west halls (727056022/021, eleven
#     bays, 硬山 black edged green); the compound wall; 焚帛炉 (1486050468), a small green-glazed furnace;
#   - 具服殿 (727056014): five bays, 歇山 in green glaze, steps south, east and west (the OSM building 727056016 north of
#     it is the hall's shadow traced from the imagery and is removed);
#   - 观耕台 (587608669 亲耕台): the 18 m square terrace, 1.9 m, its sides of yellow and green glazed tiles, white marble
#     balustrades, flights of nine steps east, west and south; 一亩三分地 lies south of it (OSM farmland, the city's);
#   - 先农神坛 (587608667): the 15 m square stone altar, 1.5 m, eight steps on each side;
#   - 神仓 (east of 太岁殿; OSM has only its walls and a learnt blob): the gate, 收谷亭 (a square pavilion), 圆廪神仓
#     (the round granary under a conical roof), the east and west granaries and 祭器库 on the north, grey tiles;
#   - 庆成宫 (OSM area 1429689042, halls 477934704/705; restored and opened in 2024): 正殿 and 后殿 under 庑殿 roofs of
#     green glaze, the side halls, the inner and outer gates, red walls.
# Not touched: 先农坛体育场 (south-west), 山川坛 (587608668) and the 神厨 west of the altar. Doubtful: the 神仓 and
# 庆成宫 layouts (sizes from imagery, a few metres either way), all heights (from bays and photographs).

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import (Canvas, Geo, T, collider_box, collider_pts, cyl, flat_marker, mesh_of, panel_geo, paving, place,  # noqa: E402
                 post_geo, balustrade, rect)
import yonghegong as Y  # noqa: E402  (its module-level setup wraps hall.roof_face / hall.wen; nothing is built on import)
from hall import beast_geo, beasts_on, bracket_geo, uvs  # noqa: E402
from round import finial, round_eave, round_roof  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "xiannongtan.blend")

ORIGIN, HEADING = (-860.0, 3640.0), -2.0
I4 = Matrix.Identity(4)

# eave rects (x0, x1, y0, y1) in this frame
TSD = (-135.7, -83.7, 72.6, 101.3)        # 太岁殿
BD = (-135.2, -84.5, -4.4, 17.5)          # 拜殿
TS_E = (-83.9, -71.1, 19.0, 72.6)         # 东配殿
TS_W = (-150.2, -135.7, 21.6, 72.6)       # 西配殿
TS_WALL = (-153.5, -67.5, -2.0, 104.5)    # the compound wall (拜殿 stands in its south side)
FBL = (-89.3, -84.7, -26.3, -19.3)        # 焚帛炉
JFD = (-79.1, -43.0, -61.3, -45.1)        # 具服殿
GGT = (-73.0, -55.6, -118.1, -99.5)       # 观耕台
XNT = (-204.4, -188.4, -54.7, -39.0)      # 先农神坛
SC = (-33.5, 13.5, 14.5, 106.0)           # 神仓's compound
QA = 172.0                                # 庆成宫's axis
QZD = (159.3, 184.8, 36.8, 51.3)          # 正殿
QHD = (158.1, 184.9, 58.4, 69.8)          # 后殿
QC_N = (101.5, 226.0, -11.0, 70.5)        # its main court
QC_S = (113.6, 226.0, -48.4, -11.0)       # the south court


def tex_rows(name, col):
    return Y.tile_tex(name, col)


def glazed_image(size=256):
    """观耕台's sides: yellow and green glazed tiles in panels, a lotus roundel in each."""
    cv = Canvas(size, size, "#c9a43a")
    q = size // 4
    for i in range(4):
        for j in range(4):
            col = "#2f7a55" if (i + j) % 2 else "#d4aa34"
            cv.rect(i * q + 2, j * q + 2, (i + 1) * q - 2, (j + 1) * q - 2, col)
            cx, cy = i * q + q / 2, j * q + q / 2
            cv.ring(cx, cy, q * 0.18, q * 0.3, "#e6c65a" if (i + j) % 2 else "#3e8f68")
            for k in range(8):
                a = math.pi * k / 4
                cv.ellipse(cx + math.cos(a) * q * 0.2, cy + math.sin(a) * q * 0.2, q * 0.07, q * 0.07, "#f0dc8a" if (i + j) % 2 else "#5aa77f")
    cv.noise(0.08, 13)
    return image("XN_Glazed", np.flipud(cv.a).copy())


def materials():
    M = Y.materials()
    M.update(
        black=material("XN_BlackGlaze", "#2b2e31", 0.3, props={"wet": "surface", "glowStrength": 0.45}),
        btex=material("XN_BlackRows", "#2b2e31", 0.35, tex=tex_rows("XN_BlackRowsTex", "#34383b"), props={"wet": "surface", "glowStrength": 0.45}),
        gntex=material("XN_GreenRows", "#2e7d57", 0.35, tex=tex_rows("XN_GreenRowsTex", "#3a8a60"), props={"wet": "surface", "glowStrength": 0.5}),
        glazed=material("XN_Glazed", "#c9a43a", 0.35, tex=glazed_image(), props={"wet": "surface", "glowStrength": 0.55}),
        trim=M["green"],
    )
    return M


TILE = dict(Y.TILE, black=2.0, btex=2.0, gntex=2.0, glazed=2.0, trim=2.0)
TONE_BLACK = {"tile": "black", "ytex": "btex"}           # main halls: black with green trim (hall.py's TRIM / RIDGE)
TONE_BLACK_SIDE = {"tile": "green", "ytex": "btex"}      # simple halls: black rows, their edges and ridges green
TONE_GREEN = {"tile": "green", "ytex": "gntex", "trim": "green"}
TONE_GREY = {"tile": "grey", "ytex": "gtex", "trim": "green"}


def toned(mapping, fn, *a, **kw):
    """Run a yonghegong builder into fresh accumulators, recolour its roofs, and add the result."""
    g0, f0 = Y.G, Y.FAR
    Y.G, Y.FAR = Geo(), Geo()
    try:
        out = fn(*a, **kw)
        g, f = Y.G, Y.FAR
    finally:
        Y.G, Y.FAR = g0, f0
    Y.remap(g, mapping)
    Y.remap(f, {k: v for k, v in mapping.items() if k in ("tile", "grey")})
    Y.G.add(g, I4)
    Y.FAR.add(f, I4)
    return out


def hall_spec(r, ov, zb, bays, deep=3, kind="xieshan", trim=0.0, Hk=0.58, rows=7, gap=1.8, big=True):
    A, D = (r[1] - r[0]) / 2, (r[3] - r[2]) / 2
    OX, OY = A - ov, D - ov
    h = Y.spec(OX, OY, Y.lin(OX, bays), Y.lin(OY, deep), zb, ov, kind=kind, rows=rows, end_rows=4, gap=gap, Hk=Hk, big=big)
    if trim:
        h.TRIM, h.RIDGE = trim, "trim"
    return h


def side_steps(m, h, base_z, x_edge, s, width=3.6):
    """A flight on a hall platform's east (s = 1) or west (s = -1) end, down along x; adds its WALK ramp."""
    g = Geo()
    n = max(2, round(base_z / 0.15))
    run = 0.32
    for k in range(n):
        xa, xb = x_edge, x_edge + s * (n - k) * run
        g.box(min(xa, xb), max(xa, xb), -width / 2, width / 2, 0.0, base_z * (k + 1) / n, "marble", skip=("-z",))
    Y.G.add(g, m)
    xe = x_edge + s * n * run
    Y.walk(m, [(x_edge, -width / 2 - 0.3, base_z), (x_edge, width / 2 + 0.3, base_z), (xe, -width / 2 - 0.3, 0.0), (xe, width / 2 + 0.3, 0.0),
               (x_edge, -width / 2 - 0.3, 0.0), (x_edge, width / 2 + 0.3, 0.0)])


def rect_walls(r, gates=(), zt=4.2):
    """A walled rectangle; `gates` are plan rects the wall stops at (the halls themselves are BODIES already)."""
    for b in gates:
        Y.BODIES.append(b)
    x0, x1, y0, y1 = r
    return [([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True)]


def furnace(r):
    """焚帛炉: a small green-glazed furnace, its body and a little hipped roof."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # far_roof builds round the origin; move the roof to the furnace
    rg = Geo()
    Y.far_roof(rg, (x1 - x0) / 2, (y1 - y0) / 2, 3.2, 4.9, "green")
    body = Geo()
    body.box(x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, 0.0, 0.6, "marble", skip=("-z",))
    body.box(x0 + 0.6, x1 - 0.6, y0 + 0.6, y1 - 0.6, 0.6, 3.2, "green", skip=("-z",))
    body.polyn([(cx - 0.6, y0 + 0.58, 1.0), (cx + 0.6, y0 + 0.58, 1.0), (cx + 0.6, y0 + 0.58, 2.0), (cx - 0.6, y0 + 0.58, 2.0)], "red", (0, -1, 0))
    Y.G.add(body, I4)
    Y.G.add(rg, T(cx, cy, 0))
    Y.COLL.append(("box", x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, 0.0, 3.2))


def terrace(r, h, side_key, steps_on, rails=True, meshes=None, parts=None, tag="T", cap="marble"):
    """A square terrace (观耕台, 先农神坛): sides in `side_key` under a marble coping, paved top, flights of steps on
    the named sides ('s', 'e', 'w', 'n') with their WALK ramps, a balustrade round the edge with gaps at the flights."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    g = Geo()
    # body inset a little so the coping stands proud
    g.box(x0 + 0.1, x1 - 0.1, y0 + 0.1, y1 - 0.1, 0.0, h - 0.25, side_key, skip=("-z", "+z"))
    g.box(x0, x1, y0, y1, h - 0.25, h, cap, skip=("-z", "+z"))
    g.box(x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, 0.0, 0.3, cap, skip=("-z", "+z"))
    g.polyn([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], "paving", (0, 0, 1))
    w = 4.8
    n = max(2, round(h / 0.2))
    run = 0.32
    L = n * run
    gaps = []
    for side in steps_on:
        sx, sy = {"s": (0, -1), "n": (0, 1), "e": (1, 0), "w": (-1, 0)}[side]
        for k in range(n):
            d = (n - k) * run
            z = h * (k + 1) / n
            if sx == 0:
                ye = y0 if sy < 0 else y1
                g.box(cx - w / 2, cx + w / 2, min(ye, ye + sy * d), max(ye, ye + sy * d), 0.0, z, "marble", skip=("-z",))
            else:
                xe = x0 if sx < 0 else x1
                g.box(min(xe, xe + sx * d), max(xe, xe + sx * d), cy - w / 2, cy + w / 2, 0.0, z, "marble", skip=("-z",))
        if sx == 0:
            ye = y0 if sy < 0 else y1
            yf = ye + sy * L
            Y.walk(I4, [(cx - w / 2, ye, h), (cx + w / 2, ye, h), (cx - w / 2, yf, 0.0), (cx + w / 2, yf, 0.0), (cx - w / 2, ye, 0.0), (cx + w / 2, ye, 0.0)])
            gaps.append((cx - w / 2, cx + w / 2, min(ye, yf) - 1, max(ye, yf) + 1))
        else:
            xe = x0 if sx < 0 else x1
            xf = xe + sx * L
            Y.walk(I4, [(xe, cy - w / 2, h), (xe, cy + w / 2, h), (xf, cy - w / 2, 0.0), (xf, cy + w / 2, 0.0), (xe, cy - w / 2, 0.0), (xe, cy + w / 2, 0.0)])
            gaps.append((min(xe, xf) - 1, max(xe, xf) + 1, cy - w / 2, cy + w / 2))
    Y.G.add(g, I4)
    Y.COLL.append(("box", x0, x1, y0, y1, 0.0, h))
    if rails and meshes is not None:
        e = 0.35
        pts = [(x0 + e, y0 + e, h), (x1 - e, y0 + e, h), (x1 - e, y1 - e, h), (x0 + e, y1 - e, h), (x0 + e, y0 + e, h)]
        skip = [(a - 0.0, b + 0.0, c, d) for a, b, c, d in gaps]
        balustrade(parts, meshes, pts, tag, gap=1.6, skip=skip)
    f = Geo()
    f.box(x0, x1, y0, y1, 0.0, h, side_key, skip=("-z",))
    Y.FAR.add(f, I4)


def granary(cx, cy):
    """圆廪神仓: the round granary on a low base, red walls, a conical roof of grey tiles edged green, the finial."""
    g = Geo()
    cyl(g, 0, 0, 0.0, 0.6, 5.8, 5.8, 32, "marble", caps=(False, True))
    cyl(g, 0, 0, 0.6, 4.6, 4.3, 4.3, 32, "plaster", caps=(False, False))
    # the door (south) and two vents
    g.polyn([(-0.8, -4.33, 0.6), (0.8, -4.33, 0.6), (0.8, -4.33, 3.2), (-0.8, -4.33, 3.2)], "red", (0, -1, 0))
    cyl(g, 0, 0, 4.6, 5.2, 4.4, 4.4, 32, "red", caps=(False, False))
    R = dict(r0=6.1, r1=0.0, z=5.35, H=3.9, p=1.55, lift=0.25, Vl=1.6)
    round_roof(g, R, rows=7, key="grey", pitch=0.5, amp=0.08, spp=3, trim=1.0)
    round_eave(g, R, 4.4, 5.2, key="green")
    finial(g, R["z"] + R["H"] - 0.1, 1.4, r=0.35)
    Y.remap(g, {"trim": "green"})
    Y.G.add(g, T(cx, cy, 0))
    Y.COLL.append(("box", cx - 4.3, cx + 4.3, cy - 4.3, cy + 4.3, 0.0, 6.0))
    Y.COLL.append(("box", cx - 5.8, cx + 5.8, cy - 5.8, cy + 5.8, 0.0, 0.6))
    Y.BODIES.append((cx - 6.2, cx + 6.2, cy - 6.2, cy + 6.2))
    f = Geo()
    cyl(f, 0, 0, 0.0, 5.2, 4.4, 4.4, 10, "plaster", caps=(False, False))
    lr = Geo()
    round_roof(lr, R, rows=2, key="grey", waves=False, segs=10)
    f.add(lr, I4)
    Y.FAR.add(f, T(cx, cy, 0))


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("先农坛")
    parts = collection("构件", main)
    stats = {}
    meshes = dict(post=mesh_of(post_geo(), "PostMesh", M, TILE), panel=mesh_of(panel_geo(), "PanelMesh", M, TILE))

    # ---- 太岁殿's court ---------------------------------------------------------------------------------------------
    h = hall_spec(TSD, 2.4, 1.0 + 6.8, 7, trim=1.1, Hk=0.6)
    m = toned(TONE_BLACK, Y.main_hall, "太岁殿", TSD, h, 1.0, False, front_doors=3, back_doors=1, beasts=5, front_steps=5.0)
    for x in (-13.0, 13.0):
        rg = Geo()
        Y.walk(m @ T(x, 0, 0), Y.steps(rg, -2.2, 2.2, -h.OY - 0.9, -1, 0.0, 1.0))
        Y.G.add(rg, m @ T(x, 0, 0))
    hb = hall_spec(BD, 2.2, 0.8 + 6.0, 7, trim=1.0, Hk=0.58)
    toned(TONE_BLACK, Y.main_hall, "拜殿", BD, hb, 0.8, False, front_doors=3, back_doors=3, passage=True, beasts=3, front_steps=5.0, back_steps=5.0)
    toned(TONE_BLACK_SIDE, Y.simple_hall, TS_E, "w", 5.0, ov=1.3, z0=0.45)
    toned(TONE_BLACK_SIDE, Y.simple_hall, TS_W, "e", 5.0, ov=1.3, z0=0.45)
    furnace(FBL)
    stats["t_taisui"] = Y.G.tris()

    # ---- 具服殿 and 观耕台 -------------------------------------------------------------------------------------------
    hj = hall_spec(JFD, 1.9, 1.1 + 5.4, 5, Hk=0.6)
    mj = toned(TONE_GREEN, Y.main_hall, "具服殿", JFD, hj, 1.1, False, front_doors=3, back_doors=1, beasts=5, front_steps=5.0)
    side_steps(mj, hj, 1.1, hj.OX + 0.9, 1)
    side_steps(mj, hj, 1.1, -hj.OX - 0.9, -1)
    terrace(GGT, 1.9, "glazed", "sew", meshes=meshes, parts=parts, tag="GGT")
    terrace(XNT, 1.5, "marble", "sewn", rails=False, cap="marble")
    stats["t_jufu"] = Y.G.tris() - stats["t_taisui"]

    # ---- 神仓 ----------------------------------------------------------------------------------------------------------
    t0 = Y.G.tris()
    ax = -10.0
    toned(TONE_GREY, Y.simple_hall, (ax - 9.0, ax + 9.0, 33.0, 41.0), "s", 4.2, ov=1.0, passages=[(ax - 2.0, ax + 2.0)])     # 山门
    hp = SimpleNamespace(**vars(Y.spec(2.6, 2.6, Y.lin(2.6, 3), Y.lin(2.6, 3), 0.5 + 3.6, 1.2, kind="cuanjian", rows=4, end_rows=4, gap=1.3, Hk=0.7, big=False)))
    hp.TRIM, hp.RIDGE = 0.7, "trim"
    toned(TONE_GREY, Y.main_hall, "收谷亭", (ax - 3.8, ax + 3.8, 49.7, 57.3), hp, 0.5, False, front_doors=1, beasts=0, col_r=0.26)
    granary(ax, 73.0)
    toned(TONE_GREY, Y.simple_hall, (SC[0] + 2.0, SC[0] + 10.0, 54.0, 82.0), "e", 4.4, ov=1.1)          # 西仓房
    toned(TONE_GREY, Y.simple_hall, (SC[1] - 10.0, SC[1] - 2.0, 54.0, 82.0), "w", 4.4, ov=1.1)          # 东仓房
    toned(TONE_GREY, Y.simple_hall, (ax - 12.0, ax + 12.0, 94.5, 104.0), "s", 4.8, ov=1.2, door_bays=3)   # 祭器库
    stats["t_shencang"] = Y.G.tris() - t0

    # ---- 庆成宫 --------------------------------------------------------------------------------------------------------
    t0 = Y.G.tris()
    hz = hall_spec(QZD, 1.8, 1.2 + 5.4, 5, kind="wudian", Hk=0.62)
    toned(TONE_GREEN, Y.main_hall, "正殿", (QA - 12.75, QA + 12.75, QZD[2], QZD[3]), hz, 1.2, False, front_doors=3, back_doors=1, beasts=5)
    # the 月台 in front of 正殿
    g = Geo()
    yb = (QZD[2] + QZD[3]) / 2 - hz.OY - 0.9
    g.box(QA - 8.5, QA + 8.5, yb - 6.5, yb, 0.0, 1.05, "marble", skip=("-z",))
    ramp = Y.steps(g, QA - 2.5, QA + 2.5, yb - 6.5, -1, 0.0, 1.05)
    Y.G.add(g, I4)
    Y.walk(I4, ramp)
    Y.COLL.append(("box", QA - 8.5, QA + 8.5, yb - 6.5, yb, 0.0, 1.05))
    Y.BODIES.append((QA - 8.9, QA + 8.9, yb - 7.0, yb))
    hh = hall_spec(QHD, 1.6, 0.8 + 4.8, 5, kind="wudian", Hk=0.62)
    toned(TONE_GREEN, Y.main_hall, "后殿", (QA - 13.4, QA + 13.4, QHD[2], QHD[3]), hh, 0.8, False, front_doors=3, beasts=3, front_steps=4.0)
    toned(TONE_GREEN, Y.simple_hall, (QA - 47.0, QA - 38.0, 42.0, 64.0), "e", 4.6, ov=1.2)            # 西配殿
    toned(TONE_GREEN, Y.simple_hall, (QA + 38.0, QA + 47.0, 42.0, 64.0), "w", 4.6, ov=1.2)            # 东配殿
    toned(TONE_GREEN, Y.simple_hall, (QA - 8.5, QA + 8.5, -15.0, -7.0), "s", 4.4, ov=1.1, passages=[(QA - 2.2, QA + 2.2)], back=True)   # 内宫门
    toned(TONE_GREEN, Y.simple_hall, (QA - 9.5, QA + 9.5, -52.0, -44.0), "s", 4.6, ov=1.1, passages=[(QA - 2.4, QA + 2.4)], back=True)  # 外宫门
    stats["t_qingcheng"] = Y.G.tris() - t0

    # ---- walls and paving -------------------------------------------------------------------------------------------
    polys = []
    polys += rect_walls(TS_WALL)
    polys += rect_walls(SC)
    polys += rect_walls(QC_N)
    polys += [([(QC_S[0], QC_N[2]), (QC_S[0], QC_S[2]), (QC_S[1], QC_S[2]), (QC_S[1], QC_N[2])], False)]
    stats["walls"] = toned(TONE_GREEN, Y.walls, polys, zt=4.0, th=0.9)
    for r in ((TS_WALL[0] + 0.5, TS_WALL[1] - 0.5, TS_WALL[2] + 0.5, TS_WALL[3] - 0.5), (SC[0] + 0.5, SC[1] - 0.5, SC[2] + 0.5, SC[3] - 0.5),
              (QC_N[0] + 0.5, QC_N[1] - 0.5, QC_N[2] + 0.5, QC_N[3] - 0.5), (QC_S[0] + 0.5, QC_S[1] - 0.5, QC_S[2] + 0.5, QC_N[2] - 0.5),
              (JFD[0] - 2.0, JFD[1] + 2.0, JFD[2] - 10.0, JFD[3] + 18.0)):
        Y.G.polyn([(x, y, 0.03) for x, y in rect(*r)], "paving", (0, 0, 1))
        Y.FAR.polyn([(x, y, 0.03) for x, y in rect(*r)], "paving", (0, 0, 1))

    Y.G.build("Temple", collection("殿", main), M, TILE)
    stats["tris"] = Y.G.tris()

    # ---- instances: columns, brackets, beasts (green glaze) ---------------------------------------------------------
    cg = Geo()
    cyl(cg, 0, 0, 0.0, 1.0, 1.0, 0.96, 10, "red", caps=(False, False))
    col_me = mesh_of(cg, "ColumnMesh", M, TILE)
    bg = Geo()
    cyl(bg, 0, 0, 0.0, 0.22, 1.45, 1.3, 8, "marble", caps=(False, True))
    base_me = mesh_of(bg, "ColumnBaseMesh", M, TILE)
    for i, (mm, r, hh_) in enumerate(Y.COLS):
        place(col_me, f"Column.{i:04d}", parts, mm @ T(0, 0, 0.18) @ Matrix.Diagonal((r, r, hh_ - 0.18, 1.0)))
        place(base_me, f"ColumnBase.{i:04d}", parts, mm @ Matrix.Diagonal((r, r, 1.0, 1.0)))
    br = mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE)
    for i, mm in enumerate(Y.BRK):
        place(br, f"Bracket.{i:04d}", parts, mm)
    beast = mesh_of(beast_geo(glaze="#2f7a55", lite=True), "BeastMesh", M, TILE)
    bm = dict(beast=beast, immortal=beast)
    for i, (line, n) in enumerate(Y.HIPS):
        if n:
            beasts_on(line, parts, bm, f"Beast{i}", n=n)
    stats.update(columns=len(Y.COLS), brackets=len(Y.BRK), hips=len(Y.HIPS))

    Y.FAR.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = Y.FAR.tris()

    helpers = collection("碰撞体")
    nb = nh = nw = 0
    for c in Y.COLL:
        if c[0] == "box":
            collider_box(helpers, f"b{nb}", *c[1:])
            nb += 1
        elif c[0] == "hull":
            collider_pts(helpers, f"h{nh}", c[1])
            nh += 1
        else:
            collider_pts(helpers, f"w{nw}", c[1], role="WALK")
            nw += 1
    stats.update(boxes=nb, hulls=nh, ramps=nw)

    # footprints: each group on its own, kept off the school and housing between them
    for name, r in (("taisui", (TS_WALL[0] - 1.5, TS_WALL[1] + 1.0, TS_WALL[2] - 7.0, TS_WALL[3] + 1.0)), ("fenbo", (FBL[0] - 1.2, FBL[1] + 1.2, FBL[2] - 0.7, FBL[3] + 0.8)),
                    ("jufu", (JFD[0] - 1.0, JFD[1] + 1.0, JFD[2] - 1.0, -20.0)), ("guangeng", (GGT[0] - 3.5, GGT[1] + 3.5, GGT[2] - 3.5, GGT[3] + 0.6)),
                    ("altar", (XNT[0] - 2.6, XNT[1] + 2.6, XNT[2] - 2.6, XNT[3] + 2.6)), ("shencang", (SC[0] - 0.6, SC[1] + 0.6, SC[2] - 0.6, SC[3] + 0.6)),
                    ("qingcheng", (QC_N[0] - 0.6, QC_N[1] + 0.6, -53.0, QC_N[3] + 0.6))):
        flat_marker(helpers, name, rect(*r), "FOOTPRINT")
    # clear zones: the halls themselves (the canopy trees stand in the courts and stay)
    for i, r in enumerate((TSD, BD, TS_E, TS_W, JFD, (GGT[0] - 3.5, GGT[1] + 3.5, GGT[2] - 3.5, GGT[3] + 0.5), (XNT[0] - 2.6, XNT[1] + 2.6, XNT[2] - 2.6, XNT[3] + 2.6),
                           (SC[0], SC[1], 30.0, SC[3]), (QA - 14.0, QA + 14.0, 28.0, 71.0), (QA - 48.0, QA - 37.0, 41.0, 65.0), (QA + 37.0, QA + 48.0, 41.0, 65.0),
                           (QA - 10.0, QA + 10.0, -16.0, -6.0), (QA - 10.5, QA + 10.5, -53.0, -43.0))):
        flat_marker(helpers, f"clear{i}", rect(r[0] - 1.0, r[1] + 1.0, r[2] - 1.0, r[3] + 1.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "xiannongtan", "先农坛", "Temple of Agriculture (Xiannongtan)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ORIGIN[0], ORIGIN[1], HEADING
    s.far_distance = 500
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
