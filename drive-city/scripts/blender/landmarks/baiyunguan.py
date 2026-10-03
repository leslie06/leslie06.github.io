# 白云观 White Cloud Temple outside 西便门, the headquarters of the 全真 school of Daoism, in Blender with the timber
# halls of hall.py and the courtyard pieces of gongwangfu.py (imported, as zhihuasi.py does: halls, walls, towers,
# pavilions, rockery, instances), marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/baiyunguan.py -- [--out art/landmarks/baiyunguan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the axis at the 山门's front face, game (-5116, 1183) - where
# OSM's service road from 白云观街 turns north into the gate and the gap in the front walls (ways 1021328009/13,
# the 撇山照壁) is centred - heading -2.5 (the precinct's long edges, way 232729444, lean 2-3 degrees west of north;
# in this frame they run straight). OSM has the precinct (182 x 311 m), its walls and the 影壁 across the street, and
# no halls: the tiles had ~90 machine-learnt roofs in it, drawn as blocks of flats; the footprints take them all and
# the whole precinct is modelled. Hall positions on the axis follow the learnt roofs that line up on it (灵官殿 y 47,
# 玉皇殿 y 98, 老律堂 y 139, 邱祖殿 y 158-168, the 49 m line of 四御殿 and its wings y 196, the garden halls y 234/260)
# and the published order (照壁, 牌楼, 华表, 山门, 窝风桥, 灵官殿, 钟鼓楼, 三官殿 and 财神殿, 玉皇殿, 救苦殿 and 药王殿,
# 老律堂, 邱祖殿, 三清四御殿, then 云集园 with the 戒台 and 云集山房).
#
# South to north on the 中路: the 棂星门 牌楼 (三间四柱七楼 in grey tiles, 洞天勝境 on the south board, 瓊林閬苑 on the north) in the
# notch between the splayed walls, a pair of 华表 and of stone lions; the 山门, a brick-and-plaster gate with three
# arched passages framed in white marble (the middle one wide enough for a car), the plaque 敕建白雲觀 and the little
# stone monkey on the middle arch's west jamb, a 歇山 roof in grey tiles edged with green glaze; 窝风桥, a humped
# single-arch marble bridge over a dry pond in a balustrade, with the bronze coin (钱眼) hanging under its arch; 灵官殿
# (three bays); the 钟楼 (east) and 鼓楼 (west); 玉皇殿 (five bays, 歇山, green-edged, on a platform with its 月台);
# 老律堂 (two 硬山 roofs back to back, 勾连搭, on a 月台); 邱祖殿 (three bays, 歇山); 四御殿 with 三清阁 over it (five
# bays, two storeys, green-edged) between two-storey wings (藏经楼, 朝天楼) - side halls on every court. Behind, 云集园:
# the 戒台 hall, 云集山房, the rockery, 妙香亭 and 友鹤亭, 退居楼. East and west routes of smaller halls (八仙殿,
# 吕祖殿, 元辰殿, 元君殿, 文昌殿; 南极殿, 真武殿, 火神殿, 斗姥阁 and the 罗公塔), the 道教协会's offices along the
# east wall. All roofs grey (灰筒瓦), the main ones with tile rows, brackets and beasts, the rest textured.
#
# Doubtful: the halls' sizes and exact positions (from the learnt roofs, which are rough), the 山门's depth, the
# 牌楼's colours (grey tiles here), which side halls are which, the east and west routes' plans
# (generic courtyards), the offices; the 照壁 is OSM's wall in the street (way 1021328008), left to the city.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import QUAD, Geo, T, Rz, balustrade, cyl, ell, flat_marker, lathe, mesh_of, panel_geo, place, post_geo, rect  # noqa: E402
import hall  # noqa: E402
from hall import ring_beams, roofs, to_world, uvs  # noqa: E402
import gongwangfu as K  # noqa: E402
from tiananmen import huabiao, lion_mesh  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "baiyunguan.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
HEADING = -2.5
ANCHOR = (-5116.0, 1183.0)
GREY, GREY_TEX = "#5c5f62", "#686b6e"
GREEN = "#3d7a4e"
TEXTS = []               # (text, x, y, z, w, h, face) plaques in gilt lettering

# the precinct (OSM way 232729444) in this frame
OUTLINE = [(-35.9, 285.1), (-36.2, 295.7), (-28.9, 295.7), (-29.0, 298.5), (-22.4, 298.8), (-17.6, 299.0), (12.7, 299.7), (13.0, 286.3),
           (28.5, 286.5), (35.6, 265.5), (78.1, 263.5), (77.3, 245.7), (89.0, 245.6), (87.0, 233.7), (103.2, 233.7), (103.5, 176.9),
           (104.0, 87.6), (98.1, 87.6), (95.6, 16.3), (93.5, 4.5), (79.4, 4.6), (79.4, 7.7), (60.6, 7.9), (61.1, -4.7), (41.6, -5.4),
           (23.0, -6.1), (23.0, 0.0), (8.7, 0.0), (-8.9, 0.0), (-24.5, 0.0), (-24.2, -6.8), (-38.8, -7.2), (-70.6, -7.7),
           (-71.4, 8.8), (-69.5, 9.0), (-71.3, 97.6), (-74.8, 103.0), (-75.7, 151.1), (-65.1, 152.3), (-67.1, 235.0), (-60.4, 235.4),
           (-61.6, 284.1)]


def inset(poly, d):
    """The polygon moved d metres inward (miter offset)."""
    n = len(poly)
    area = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(n))
    if area < 0:                                   # clockwise: the left normals point out
        d = -d
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        a, b = (p1 - p0).normalized(), (p2 - p1).normalized()
        na, nb = Vector((-a.y, a.x)), Vector((-b.y, b.x))
        m = (na + nb)
        k = d / max(0.35, m.length / 2) if m.length > 1e-6 else d
        out.append(tuple(p1 + m.normalized() * k * (1 if m.length > 1e-6 else 0)))
    return out


# --- arched gate (山门) -----------------------------------------------------------------------------------

def arc_pts(cx, aw, ah, seg=10):
    return [(cx - aw * math.cos(math.pi * k / seg), ah + aw * math.sin(math.pi * k / seg)) for k in range(seg + 1)]


def arch_face(g, y, sy, x0, x1, arches, z0, zt, key):
    """A wall plane at y facing sy from x0 to x1, z0 to zt, with round-headed openings (cx, half width, spring)."""
    xs = [x0]
    for cx, aw, ah in sorted(arches):
        xs += [cx - aw, cx + aw]
    xs.append(x1)
    for i in range(0, len(xs), 2):
        if xs[i + 1] - xs[i] > 0.01:
            g.polyn([(xs[i], y, z0), (xs[i + 1], y, z0), (xs[i + 1], y, zt), (xs[i], y, zt)], key, (0, sy, 0))
    for cx, aw, ah in arches:
        if zt <= ah + aw:
            continue
        arc = arc_pts(cx, aw, ah)
        for (xa, za), (xb, zb) in zip(arc, arc[1:]):
            g.polyn([(xa, y, max(za, z0)), (xb, y, max(zb, z0)), (xb, y, zt), (xa, y, zt)], key, (0, sy, 0))


def shanmen():
    """The 山门: a three-bay masonry gate, red plaster over a stone base course, three arched passages through it
    (each lined, its doors folded back), carved marble frames on both faces, a beam band and brackets, a 歇山
    roof with tile rows, grey tiles edged in green; the plaque over the middle arch and the stone monkey."""
    bx, y0, y1 = 8.0, 0.0, 8.0
    cy = (y0 + y1) / 2
    by = (y1 - y0) / 2
    m = K.M_of(0.0, cy, 0)
    g = Geo()
    zw = 6.6
    ARCH = [(-5.0, 1.25, 2.6), (0.0, 1.7, 3.0), (5.0, 1.25, 2.6)]
    g.box(-bx - 0.35, bx + 0.35, -by - 0.35, by + 0.35, 0.0, 0.25, "marble", skip=("-z",))
    for sy in (-1, 1):
        y = sy * by
        arch_face(g, y, sy, -bx, bx, ARCH, 0.25, 1.1, "marble")          # the stone base course
        arch_face(g, y + sy * 0.001, sy, -bx, bx, ARCH, 1.1, zw, "plaster")
        for cx, aw, ah in ARCH:                                           # marble frames, a little proud
            yy = y + sy * 0.08
            ri, ro = arc_pts(cx, aw, ah), arc_pts(cx, aw + 0.45, ah)
            for k in range(len(ri) - 1):
                g.polyn([(ri[k][0], yy, ri[k][1]), (ri[k + 1][0], yy, ri[k + 1][1]), (ro[k + 1][0], yy, ro[k + 1][1]), (ro[k][0], yy, ro[k][1])], "white", (0, sy, 0))
            for s in (-1, 1):
                g.box(cx + s * aw - (0.45 if s < 0 else 0), cx + s * aw + (0.45 if s > 0 else 0), min(y, yy), max(y, yy) + 0.001, 0.25, ah, "white")
            if cx == 0.0:
                continue
            # the carved lintel band over the side arches
            g.box(cx - aw - 0.7, cx + aw + 0.7, min(y, yy + sy * 0.04), max(y, yy + sy * 0.04), ah + aw + 0.45, ah + aw + 0.85, "white")
    for cx, aw, ah in ARCH:                                               # the passages: jambs, the barrel vault, doors
        for s in (-1, 1):
            g.polyn([(cx + s * aw, -by, 0.25), (cx + s * aw, by, 0.25), (cx + s * aw, by, ah), (cx + s * aw, -by, ah)], "plaster", (-s, 0, 0))
            g.polyn([(cx + s * (aw - 0.06), -0.35, 0.25), (cx + s * (aw - 0.06), 0.45, 0.25), (cx + s * (aw - 0.06), 0.45, ah + 0.2),
                     (cx + s * (aw - 0.06), -0.35, ah + 0.2)], "red", (-s, 0, 0))
        arc = arc_pts(cx, aw, ah)
        for (xa, za), (xb, zb) in zip(arc, arc[1:]):
            g.polyn([(xa, -by, za), (xb, -by, zb), (xb, by, zb), (xa, by, za)], "plaster", (cx - (xa + xb) / 2, 0, ah - (za + zb) / 2))
        g.polyn([(cx - aw, -by, 0.26), (cx + aw, -by, 0.26), (cx + aw, by, 0.26), (cx - aw, by, 0.26)], "marble", (0, 0, 1))
    for sx in (-1, 1):
        g.polyn([(sx * bx, -by, 0.25), (sx * bx, by, 0.25), (sx * bx, by, zw), (sx * bx, -by, zw)], "plaster", (sx, 0, 0))
    # the plaque: blue board in a gilt frame between the middle arch and the beams
    pz, pw, ph = 5.85, 3.0, 0.9
    for sy in (-1,):
        y = sy * (by + 0.12)
        g.box(-pw / 2 - 0.1, pw / 2 + 0.1, y - 0.06, y + 0.06, pz - ph / 2 - 0.1, pz + ph / 2 + 0.1, "gold")
        g.polyn([(-pw / 2, y - 0.07, pz - ph / 2), (pw / 2, y - 0.07, pz - ph / 2), (pw / 2, y - 0.07, pz + ph / 2), (-pw / 2, y - 0.07, pz + ph / 2)], "board", (0, -1, 0))
    TEXTS.append(("觀雲白建敕", 0.0, cy - by - 0.19, pz, pw, ph, -1))
    # the stone monkey on the middle arch's west jamb (rubbed shiny), at about 1.6 m
    for (c, r) in (((-1.98, -by - 0.13, 1.55), (0.1, 0.05, 0.13)), ((-1.98, -by - 0.13, 1.72), (0.07, 0.05, 0.07)), ((-1.92, -by - 0.13, 1.42), (0.05, 0.04, 0.09))):
        ell(g, c, r, "white", nu=6, nv=4)
    K.beam_band(g, bx, by, zw, zw + 0.55)
    ov = 1.35
    A, D = bx + ov, by + ov
    U = dict(A=A, D=D, z=zw + 0.95, H=0.62 * D, p=1.5, o=0.6, lift=0.6, Lc=0.7 * D, Vc=0.42 * D)
    h = SimpleNamespace(XS=K.lin(bx, 3), YS=[-by, by], OX=bx, OY=by, IX=bx, IY=by, BEAM=(zw, zw + 0.3, zw + 0.45, zw + 1.15),
                        UBEAM=(zw, zw + 0.3, zw + 0.45, zw + 1.15), OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.55 * D - 0.8),
                        PITCH=0.46, AMP=0.1, TRIM=0.9, RIDGE="trim", ROWS=6, END_ROWS=4, BRACKET_GAP=1.5)
    g.box(-bx - 0.1, bx + 0.1, -by - 0.1, by + 0.1, zw + 0.55, zw + 0.75, "red", skip=("-z",))
    hips = K.roofs_k(h, g, 0.6)
    for line in hips:
        K.HIPS.append(([m @ p for p in line], 3))
    K.brackets_on(h, m, True, h.BEAM[2], 0.7)
    K.G.add(g, m)
    # colliders: piers between the passages, the masonry over them
    xs = [-bx]
    for cx, aw, ah in ARCH:
        xs += [cx - aw, cx + aw]
    xs.append(bx)
    for i in range(0, len(xs), 2):
        K.cbox(m, xs[i], xs[i + 1], -by, by, 0.0, zw + 0.6)
    for cx, aw, ah in ARCH:
        K.cbox(m, cx - aw, cx + aw, -by, by, ah + aw * 0.75, zw + 0.6)
    K.body_rect(m, -bx - 0.35, bx + 0.35, -by - 0.35, by + 0.35)
    K.far_block(m, A, D, (-bx, bx, -by, by), zw, U["z"] + U["H"] + 0.6)


# --- 牌楼 (棂星门) ------------------------------------------------------------------------------------------

PL_Y = -5.5
PL_COLS = [-7.6, -3.2, 3.2, 7.6]
PL_BAYS = [(-7.6, -3.2, 5.5), (-3.2, 3.2, 6.7), (3.2, 7.6, 5.5)]               # (x0, x1, top of the beams)
# the seven 楼: (x0, x1, band bottom, eave height, main)
PL_ROOFS = [(-2.3, 2.3, 6.7, 7.6, True), (-4.0, -2.4, 6.2, 6.95, False), (2.4, 4.0, 6.2, 6.95, False),
            (-6.9, -4.0, 5.5, 6.25, False), (4.0, 6.9, 5.5, 6.25, False), (-8.4, -6.8, 5.0, 5.6, False), (6.8, 8.4, 5.0, 5.6, False)]
PL_R = 0.3


def pl_spec(x0, x1, zb, ze, main):
    half = (x1 - x0) / 2 + 0.2
    D = 0.5
    return SimpleNamespace(
        XS=[-half, -half + 0.01, half - 0.01, half], YS=[-D, -D + 0.01, D - 0.01, D], OX=half, OY=D, IX=half - 0.01, IY=D - 0.01,
        BEAM=(zb, zb + 0.45, zb + 0.45, ze - 0.2), UBEAM=(zb, zb + 0.45, zb + 0.45, ze - 0.2), OVERHANG=1.0, LOWER=None,
        UPPER=dict(A=half + 0.65, D=D + 0.85, z=ze, H=1.6 if main else 1.15, p=1.5, o=0.35, lift=0.4, Lc=1.5, Vc=0.85),
        GABLE_X=half, PITCH=0.4, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=5 if main else 4, END_ROWS=3, BRACKET_GAP=0.9, WEN=0.28)


def pailou():
    g = Geo()
    m0 = T(0, PL_Y, 0)
    for x0, x1, zb in PL_BAYS:
        bg = Geo()
        Lb = x1 - x0 - 2 * PL_R
        for za, zc, reg in ((zb - 0.5, zb, "beam"), (zb - 0.95, zb - 0.5, "plank"), (zb - 1.35, zb - 0.95, "beam")):
            for side in (-1, 1):
                bg.polyn([(-Lb / 2, side * 0.25, za), (Lb / 2, side * 0.25, za), (Lb / 2, side * 0.25, zc), (-Lb / 2, side * 0.25, zc)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
            bg.polyn([(-Lb / 2, -0.25, za), (Lb / 2, -0.25, za), (Lb / 2, 0.25, za), (-Lb / 2, 0.25, za)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
        if x0 < 0 < x1:
            bw, bh, bz = 3.0, 1.0, zb - 1.95
            for side in (-1, 1):
                bg.polyn([(-bw / 2, side * 0.27, bz - bh / 2), (bw / 2, side * 0.27, bz - bh / 2), (bw / 2, side * 0.27, bz + bh / 2), (-bw / 2, side * 0.27, bz + bh / 2)], "board", (0, side, 0))
            bg.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.3, 0.3, bz + bh / 2, bz + bh / 2 + 0.12, "gold")
            bg.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.3, 0.3, bz - bh / 2 - 0.12, bz - bh / 2, "gold")
            for sx in (-1, 1):
                bg.box(sx * bw / 2 - (0.12 if sx < 0 else 0), sx * bw / 2 + (0.12 if sx > 0 else 0), -0.3, 0.3, bz - bh / 2, bz + bh / 2, "gold")
            TEXTS.append(("境勝天洞", 0.0, PL_Y - 0.28, bz, bw, bh, -1))
            TEXTS.append(("苑閬林瓊", 0.0, PL_Y + 0.28, bz, bw, bh, 1))
        g.add(bg, T((x0 + x1) / 2, 0, 0))
    for x0, x1, zb, ze, main in PL_ROOFS:
        h = pl_spec(x0, x1, zb, ze, main)
        rg = Geo()
        w = (x1 - x0) / 2
        rg.box(-w, w, -0.2, 0.2, zb, zb + 0.45, "plaster")
        rg.box(-w - 0.1, w + 0.1, -0.32, 0.32, zb + 0.45, zb + 0.55, "red")
        roofs(h, rg)
        g.add(rg, T((x0 + x1) / 2, 0, 0))
        n = max(2, round((x1 - x0) / 0.8))
        for j in range(n + 1):
            x = x0 + (x1 - x0) * j / n
            for side, yaw in ((-1, 0.0), (1, math.pi)):
                K.BRK.append(m0 @ T(x, side * 0.22, zb + 0.45) @ Rz(yaw) @ Matrix.Diagonal((0.55, 0.55, 0.55, 1.0)))
    tops = {-7.6: 5.55, -3.2: 7.2, 3.2: 7.2, 7.6: 5.55}
    for x in PL_COLS:
        g.box(x - 0.5, x + 0.5, -0.5, 0.5, 0.0, 1.7, "marble", skip=("-z",))
        g.box(x - 0.56, x + 0.56, -0.56, 0.56, 1.7, 1.82, "marble", skip=("-z",))
        K.column(m0, x, 0.0, 1.82, tops[x] - 1.82, PL_R)
        for side in (-1, 1):                         # the raking posts (戗柱) front and back
            a, b = Vector((x, side * 0.2, 3.9)), Vector((x, side * 2.0, 0.0))
            d = (b - a).normalized()
            u = Vector((1, 0, 0))
            v = d.cross(u).normalized()
            ring = lambda c: [c + (u * math.cos(2 * math.pi * k / 6) + v * math.sin(2 * math.pi * k / 6)) * 0.12 for k in range(6)]   # noqa: E731
            A_, B_ = ring(a), ring(b)
            for k in range(6):
                j = (k + 1) % 6
                g.poly([A_[k], A_[j], B_[j], B_[k]], "red", smooth=True)
            g.box(x - 0.26, x + 0.26, side * 2.0 - 0.26, side * 2.0 + 0.26, 0.0, 0.3, "marble", skip=("-z",))
    K.G.add(g, m0)
    for x in PL_COLS:
        K.COLL.append(("box", x - 0.5, x + 0.5, PL_Y - 0.5, PL_Y + 0.5, 0.0, 9.0))
        for side in (-1, 1):
            K.COLL.append(("hull", [(x + dx, PL_Y + side * yy, z) for dx in (-0.14, 0.14) for yy, z in ((0.3, 3.9), (2.0, 0.0), (0.3, 0.0))]))
        K.CLEARS.append(rect(x - 0.8, x + 0.8, PL_Y - 2.5, PL_Y + 2.5))
    K.BODIES.append((-8.6, 8.6, PL_Y - 0.7, PL_Y + 0.7))
    f = Geo()
    for x in PL_COLS:
        f.box(x - 0.35, x + 0.35, -0.35, 0.35, 0.0, tops[x], "red", skip=("-z",))
    for x0, x1, zb, ze, main in PL_ROOFS:
        fb = Geo()
        fb.box(-(x1 - x0) / 2, (x1 - x0) / 2, -0.25, 0.25, zb - 1.3, zb + 0.45, "atlas", uvs={k_: uvs("beam", QUAD) for k_ in ("-y", "+y")})
        roofs(pl_spec(x0, x1, zb, ze, main), fb, lod=True)
        f.add(fb, T((x0 + x1) / 2, 0, 0))
    K.FAR.add(f, m0)


# --- 窝风桥 over its dry pond ---------------------------------------------------------------------------

POND = (-7.5, 7.5, 16.5, 27.5)
BR = dict(w=3.6, y0=12.5, y1=31.5, hump=2.0)


def bridge_z(y):
    L = BR["y1"] - BR["y0"]
    s = (y - BR["y0"]) / L
    return BR["hump"] * math.sin(math.pi * s) ** 1.2


def wofengqiao(meshes, parts):
    g = Geo()
    x0, x1, y0, y1 = POND
    # the pond: a floor of dark gravel over the court's paving, a stone kerb round it
    g.polyn([(x0, y0, 0.07), (x1, y0, 0.07), (x1, y1, 0.07), (x0, y1, 0.07)], "dry", (0, 0, 1))
    K.FAR.polyn([(x0, y0, 0.07), (x1, y0, 0.07), (x1, y1, 0.07), (x0, y1, 0.07)], "dry", (0, 0, 1))
    for a, b, out in (((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)), ((x1, y1), (x0, y1), (0, 1)), ((x0, y1), (x0, y0), (-1, 0))):
        a, b, o = Vector(a), Vector(b), Vector(out)
        ao, bo = a + o * 0.45, b + o * 0.45
        g.polyn([(a.x, a.y, 0.3), (b.x, b.y, 0.3), (bo.x, bo.y, 0.3), (ao.x, ao.y, 0.3)], "marble", (0, 0, 1))
        g.polyn([(a.x, a.y, 0.0), (b.x, b.y, 0.0), (b.x, b.y, 0.3), (a.x, a.y, 0.3)], "marble", (-o.x, -o.y, 0))
        g.polyn([(ao.x, ao.y, 0.0), (bo.x, bo.y, 0.0), (bo.x, bo.y, 0.3), (ao.x, ao.y, 0.3)], "marble", (o.x, o.y, 0))
    # the bridge: a humped deck, side walls pierced by one round arch over the pond
    hw = BR["w"] / 2
    n = 24
    ys = [BR["y0"] + (BR["y1"] - BR["y0"]) * i / n for i in range(n + 1)]
    zs = [bridge_z(y) + 0.06 for y in ys]
    aw = 4.2                     # the arch's half span along y, centred on the pond
    yc = (y0 + y1) / 2
    def lo(y):
        d = abs(y - yc)
        return 0.0 if d >= aw else 0.15 + 1.25 * math.sqrt(max(0.0, 1 - (d / aw) ** 2))
    for i in range(n):
        g.polyn([(-hw + 0.25, ys[i], zs[i]), (hw - 0.25, ys[i], zs[i]), (hw - 0.25, ys[i + 1], zs[i + 1]), (-hw + 0.25, ys[i + 1], zs[i + 1])], "deck", (0, 0, 1))
        for sx in (-1, 1):
            x = sx * hw
            # the side wall from the arch (or the ground) up to the deck edge, its coping
            g.polyn([(x, ys[i], lo(ys[i])), (x, ys[i + 1], lo(ys[i + 1])), (x, ys[i + 1], zs[i + 1] + 0.12), (x, ys[i], zs[i] + 0.12)], "white", (sx, 0, 0))
            xi = x - sx * 0.25
            g.polyn([(x, ys[i], zs[i] + 0.12), (x, ys[i + 1], zs[i + 1] + 0.12), (xi, ys[i + 1], zs[i + 1] + 0.12), (xi, ys[i], zs[i] + 0.12)], "white", (0, 0, 1))
    # the vault's soffit under the arch
    ks = 12
    va = [yc - aw + 2 * aw * k / ks for k in range(ks + 1)]
    for a, b in zip(va, va[1:]):
        g.polyn([(-hw, a, lo(a)), (hw, a, lo(a)), (hw, b, lo(b)), (-hw, b, lo(b))], "white", (0, 0, -1))
    # the coin (钱眼) hanging under the arch: a bronze disc with a square hole, on a chain
    cz, cr = 0.85, 0.38
    ring = [(cr * math.cos(2 * math.pi * k / 16), cr * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    sq = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        c, s_ = math.cos(a), math.sin(a)
        t = 0.11 / max(abs(c), abs(s_))
        sq.append((c * t, s_ * t))
    for sy in (-1, 1):
        for k in range(16):
            j = (k + 1) % 16
            g.polyn([(ring[k][0], yc + sy * 0.03, cz + ring[k][1]), (ring[j][0], yc + sy * 0.03, cz + ring[j][1]),
                     (sq[j][0], yc + sy * 0.03, cz + sq[j][1]), (sq[k][0], yc + sy * 0.03, cz + sq[k][1])], "bronze", (0, sy, 0))
    g.box(-0.02, 0.02, yc - 0.02, yc + 0.02, cz + cr, lo(yc), "bronze")
    K.G.add(g, Matrix.Identity(4))
    # the balustrade round the pond, open where the bridge lands; and along the bridge
    edge = [(x0 - 0.2, y0 - 0.2, 0.3), (x1 + 0.2, y0 - 0.2, 0.3), (x1 + 0.2, y1 + 0.2, 0.3), (x0 - 0.2, y1 + 0.2, 0.3), (x0 - 0.2, y0 - 0.2, 0.3)]
    balustrade(parts, meshes, edge, "pond", gap=1.9, skip=((-hw - 0.4, hw + 0.4, y0 - 1, y0 + 1), (-hw - 0.4, hw + 0.4, y1 - 1, y1 + 1)))
    for sx in (-1, 1):
        pts = [(sx * (hw - 0.12), ys[i], zs[i] + 0.12) for i in range(0, n + 1, 2)]
        balustrade(parts, meshes, pts, f"bridge{sx:+d}", gap=1.6)
    # colliders: the deck as triangles (a car can cross), the balustrades as thin hulls
    dg = Geo()
    for i in range(n):
        dg.poly([(-hw, ys[i], zs[i]), (hw, ys[i], zs[i]), (hw, ys[i + 1], zs[i + 1]), (-hw, ys[i + 1], zs[i + 1])], "rock")
    K.COLL.append(("mesh", dg))
    for sx in (-1, 1):
        x = sx * (hw - 0.12)
        for part in range(3):
            pts = []
            for i in range(part * 8, part * 8 + 9):
                pts += [(x - 0.13, ys[i], 0.0), (x + 0.13, ys[i], 0.0), (x - 0.13, ys[i], zs[i] + 1.1), (x + 0.13, ys[i], zs[i] + 1.1)]
            K.COLL.append(("hull", pts))
    for (a, b) in (((x0 - 0.4, y0 - 0.4), (-hw - 0.3, y0 - 0.4)), ((hw + 0.3, y0 - 0.4), (x1 + 0.4, y0 - 0.4)), ((x1 + 0.4, y0 - 0.4), (x1 + 0.4, y1 + 0.4)),
                   ((x1 + 0.4, y1 + 0.4), (hw + 0.3, y1 + 0.4)), ((-hw - 0.3, y1 + 0.4), (x0 - 0.4, y1 + 0.4)), ((x0 - 0.4, y1 + 0.4), (x0 - 0.4, y0 - 0.4))):
        K.COLL.append(("hull", [(a[0] + dx, a[1] + dy, z) for dx in (-0.12, 0.12) for dy in (-0.12, 0.12) for z in (0.0, 1.2)] +
                       [(b[0] + dx, b[1] + dy, z) for dx in (-0.12, 0.12) for dy in (-0.12, 0.12) for z in (0.0, 1.2)]))
    K.BODIES.append((x0 - 0.6, x1 + 0.6, BR["y0"], BR["y1"]))
    K.CLEARS.append(rect(x0 - 1.0, x1 + 1.0, BR["y0"] - 0.5, BR["y1"] + 0.5))
    f = Geo()
    for sx in (-1, 1):
        for i in range(0, n, 4):
            f.polyn([(sx * hw, ys[i], 0), (sx * hw, ys[i + 4], 0), (sx * hw, ys[i + 4], zs[i + 4] + 0.9), (sx * hw, ys[i], zs[i] + 0.9)], "white", (sx, 0, 0))
    for i in range(0, n, 4):
        f.polyn([(-hw, ys[i], zs[i]), (hw, ys[i], zs[i]), (hw, ys[i + 4], zs[i + 4]), (-hw, ys[i + 4], zs[i + 4])], "deck", (0, 0, 1))
    K.FAR.add(f, Matrix.Identity(4))


# --- 四御殿 / 三清阁: two storeys -------------------------------------------------------------------------

def siyudian(cy):
    m = K.M_of(0.0, cy, 0)
    base_z = 0.9
    h = SimpleNamespace(
        XS=[-10.6, -9.0, -5.4, -1.8, 1.8, 5.4, 9.0, 10.6], YS=[-6.4, -4.8, -1.6, 1.6, 4.8, 6.4], OX=10.6, OY=6.4, IX=9.0, IY=4.8,
        BEAM=(5.0, 5.6, 5.75, 6.4), UBEAM=(10.4, 10.95, 11.1, 11.75), OVERHANG=1.9,
        LOWER=dict(A=12.5, D=8.3, z=6.15, H=1.5, p=1.3, o=0.8, lift=0.7, Lc=5.0, Vc=2.4),
        UPPER=dict(A=10.9, D=6.7, z=11.45, H=4.1, p=1.55, o=0.9, lift=0.8, Lc=5.0, Vc=2.8),
        GABLE_X=5.6, PITCH=0.46, AMP=0.1, TRIM=0.9, RIDGE="trim", KIND="xieshan", ROWS=7, END_ROWS=5, LOWER_ROWS=4, BRACKET_GAP=1.6)
    up0 = 7.75
    g = Geo()
    px, py = h.OX + 0.9, h.OY + 0.9
    g.box(-px, px, -py, py, 0.0, base_z, "marble", skip=("-z",))
    K.ring_walls(g, h, base_z, h.BEAM[0], True, front_doors=3, back_doors=1, inset=0.0)
    K.ring_walls(g, h, up0, h.UBEAM[0], False, front_doors=1, fill=("window", "window"))
    ring_beams(h, g, True, *h.BEAM)
    ring_beams(h, g, False, *h.UBEAM)
    zs = h.LOWER["z"] + h.LOWER["H"]
    for rot in range(4):
        Dd, Uu = (h.IY, h.IX) if rot % 2 == 0 else (h.IX, h.IY)
        P = lambda u, z: to_world(rot, Dd, u, -0.02, z)          # noqa: E731
        g.polyn([P(-Uu, zs - 0.3), P(Uu, zs - 0.3), P(Uu, up0), P(-Uu, up0)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("plank", QUAD))
    K.columns_on(h, m, True, base_z, h.BEAM[0], 0.38)
    K.columns_on(h, m, False, up0 - 0.4, h.UBEAM[0], 0.34)
    K.brackets_on(h, m, True, h.BEAM[2], 0.8)
    K.brackets_on(h, m, False, h.UBEAM[2], 0.85)
    for line in K.roofs_k(h, g, 0.75):
        K.HIPS.append(([m @ p for p in line], 5))
    ramp = K.steps(g, -3.0, 3.0, -py, -1, 0.0, base_z)
    TEXTS.append(("閣清三", 0.0, cy - h.IY - 0.25, up0 + 1.25, 2.4, 0.8, -1))
    g.box(-1.3, 1.3, -h.IY - 0.2, -h.IY - 0.05, up0 + 0.75, up0 + 1.75, "board")
    K.G.add(g, m)
    K.walk(m, ramp)
    K.cbox(m, -px, px, -py, py, 0.0, base_z)
    K.cbox(m, -h.OX, h.OX, -h.OY, h.OY, 0.0, zs)
    K.cbox(m, -h.IX, h.IX, -h.IY, h.IY, zs, h.UPPER["z"])
    K.body_rect(m, -px, px, -py, py)
    f = Geo()
    f.box(-h.OX, h.OX, -h.OY, h.OY, 0.0, h.LOWER["z"] + 0.3, "plaster", skip=("-z",))
    K.far_roof(f, h.LOWER["A"], h.LOWER["D"], h.LOWER["z"], zs, "tile")
    f.box(-h.IX, h.IX, -h.IY, h.IY, zs, h.UPPER["z"] + 0.3, "plaster", skip=("-z",))
    K.far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.6, "tile")
    K.FAR.add(f, m)
    return h.UPPER["z"] + h.UPPER["H"]


def terrace(x0, x1, y0, y1, z):
    """A 月台: a stone terrace in front of a hall, its steps on the front."""
    m = K.M_of(0, 0, 0)
    g = Geo()
    g.box(x0, x1, y0, y1, 0.0, z, "marble", skip=("-z",))
    ramp = K.steps(g, -2.2, 2.2, y0, -1, 0.0, z)
    K.G.add(g, m)
    K.walk(m, ramp)
    K.COLL.append(("box", x0, x1, y0, y1, 0.0, z))
    K.BODIES.append((x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3))
    K.FAR.box(x0, x1, y0, y1, 0.0, z, "marble", skip=("-z",))


def luogongta(cx, cy):
    """罗公塔: a small octagonal brick pagoda of two storeys on a stone base, eaves of grey tile, a gilt finial."""
    g = Geo()
    lathe(g, [(2.6, 0.0), (2.6, 0.9), (2.3, 1.0), (2.3, 1.3)], 8, "marble", cx, cy, smooth=False)
    lathe(g, [(1.8, 1.3), (1.8, 4.6)], 8, "brick", cx, cy, smooth=False)
    lathe(g, [(1.8, 4.6), (2.7, 4.75), (2.75, 4.95), (1.6, 5.7)], 8, "grey", cx, cy, smooth=False)
    lathe(g, [(1.35, 5.7), (1.35, 7.9)], 8, "brick", cx, cy, smooth=False)
    lathe(g, [(1.35, 7.9), (2.2, 8.05), (2.25, 8.25), (0.25, 9.6)], 8, "grey", cx, cy, smooth=False)
    lathe(g, [(0.25, 9.6), (0.42, 9.8), (0.3, 10.1), (0.38, 10.4), (0.12, 11.3), (0.0, 11.5)], 8, "gold", cx, cy)
    for k in range(4):                                       # doorways in the lower storey
        a = math.pi / 2 * k
        x, y = cx + 1.82 * math.cos(a), cy + 1.82 * math.sin(a)
        d = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-d.y, d.x, 0))
        p = Vector((x, y, 0))
        g.polyn([p - t * 0.5 + Vector((0, 0, 1.4)), p + t * 0.5 + Vector((0, 0, 1.4)), p + t * 0.5 + Vector((0, 0, 3.3)), p - t * 0.5 + Vector((0, 0, 3.3))],
                "red", tuple(d))
    K.G.add(g, Matrix.Identity(4))
    K.COLL.append(("box", cx - 2.6, cx + 2.6, cy - 2.6, cy + 2.6, 0.0, 1.0))
    K.COLL.append(("box", cx - 1.8, cx + 1.8, cy - 1.8, cy + 1.8, 0.0, 9.0))
    K.BODIES.append((cx - 2.8, cx + 2.8, cy - 2.8, cy + 2.8))
    K.CLEARS.append(rect(cx - 3.5, cx + 3.5, cy - 3.5, cy + 3.5))
    f = Geo()
    lathe(f, [(2.4, 0.0), (1.8, 1.3), (1.8, 4.6), (2.7, 4.8), (1.35, 5.7), (1.35, 7.9), (2.2, 8.1), (0.0, 11.0)], 8, "brick", cx, cy, smooth=False)
    K.FAR.add(f, Matrix.Identity(4))


# old cypresses (侧柏) in the courts and the garden - the tiles have few trees here (the learnt roofs took their
# places when the city was built), and a Daoist court is full of them
TREES = [(-13.0, 13.0), (13.0, 13.0), (-14.5, 33.0), (14.5, 33.0), (-17.0, 23.0), (17.0, 23.0),
         (-9.0, 56.0), (9.0, 56.0), (-9.5, 70.0), (9.5, 70.0), (-9.0, 84.0), (9.0, 84.0),
         (-10.5, 112.0), (10.5, 112.0), (-10.5, 122.0), (10.5, 122.0), (-11.0, 152.5), (11.0, 152.5), (-8.0, 179.0), (8.0, 179.0),
         (-50.0, 220.0), (-50.0, 237.0), (-48.0, 262.0), (-20.0, 225.0), (-15.0, 245.0), (15.0, 224.0), (18.0, 238.0), (-5.0, 249.0),
         (21.0, 256.0), (5.0, 281.0), (-12.0, 287.0), (-55.0, 269.0), (30.0, 228.0),
         (-52.0, 26.0), (-42.0, 49.0), (-52.0, 74.0), (-42.0, 100.0), (-52.0, 125.0), (-42.0, 149.0), (-51.0, 174.0), (-44.0, 198.0),
         (40.0, 22.0), (41.0, 50.0), (51.0, 50.0), (42.0, 82.0), (50.0, 112.0), (40.0, 150.0), (54.0, 162.0), (57.0, 199.0), (36.0, 184.0)]


def cypress_geo():
    g = Geo()
    cyl(g, 0, 0, 0.0, 3.4, 0.28, 0.2, 6, "bark", caps=(False, False))
    for c, r in (((0.15, 0.0, 4.4), (2.1, 1.9, 2.5)), ((-0.3, 0.25, 6.6), (1.7, 1.6, 2.2)), ((0.2, -0.1, 8.5), (1.15, 1.1, 1.6)), ((-0.1, 0.05, 9.9), (0.55, 0.55, 0.8))):
        ell(g, c, r, "leaf", nu=8, nv=5)
    return g


def trees(parts, M, tile):
    import random
    rnd = random.Random(1706)
    me = mesh_of(cypress_geo(), "CypressMesh", M, tile)
    f = Geo()
    for i, (x, y) in enumerate(TREES):
        k = rnd.uniform(0.8, 1.2)
        place(me, f"Cypress.{i:03d}", parts, T(x, y, 0.0) @ Rz(rnd.uniform(0, 6.28)) @ Matrix.Diagonal((k, k, k * rnd.uniform(0.9, 1.15), 1.0)))
        K.COLL.append(("box", x - 0.3, x + 0.3, y - 0.3, y + 0.3, 0.0, 3.0))
        K.CLEARS.append(rect(x - 2.0, x + 2.0, y - 2.0, y + 2.0))
        h = 10.0 * k
        for tri in (((x - 1.8 * k, y, 1.8 * k), (x + 1.8 * k, y, 1.8 * k), (x, y, h)), ((x, y - 1.8 * k, 1.8 * k), (x, y + 1.8 * k, 1.8 * k), (x, y, h))):
            f.poly(tri, "leaf")
            f.poly(tri[::-1], "leaf")
    K.FAR.add(f, Matrix.Identity(4))
    return len(TREES)


def text_meshes(coll, M):
    """Gilt lettering on the plaques (Noto Serif SC, read right to left: the strings are given reversed)."""
    for i, (text, x, y, z, w, hgt, face) in enumerate(TEXTS):
        cu = bpy.data.curves.new(f"Plaque{i}", "FONT")
        cu.body, cu.font, cu.size, cu.extrude = text, bpy.data.fonts.load(FONT, check_existing=True), 1.0, 0.03
        cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
        cu.space_character = 1.1
        ob = bpy.data.objects.new(f"Plaque{i}", cu)
        bpy.context.scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
        k = min((hgt - 0.25) / (max(ys) - min(ys)), (w - 0.4) / (max(xs) - min(xs)))
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        m = T(x, y + face * 0.04, z) @ Rz(0.0 if face < 0 else math.pi) @ Matrix.Rotation(math.pi / 2, 4, "X")
        for v in me.vertices:
            v.co = m @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, v.co.z))
        me.materials.append(M["gold"])
        o = bpy.data.objects.new(f"Plaque{i}", me)
        coll.objects.link(o)


# --- the whole precinct ------------------------------------------------------------------------------------

def main_hall(*a, wen_k=0.7, **kw):
    """K.main_hall with the ridge-end ornaments (正吻) scaled to a temple's halls."""
    K.WEN_K["k"] = wen_k
    try:
        return K.main_hall(*a, **kw)
    finally:
        K.WEN_K["k"] = 1.0


def side(x0, x1, y0, y1, facing, zw=3.9, **kw):
    kw.setdefault("roof", "ying")
    kw.setdefault("tone", "g")
    return K.simple_hall((x0, x1, y0, y1), facing, zw, **kw)


def baiyunguan(M, parts):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # 牌楼, 华表 and lions in front of the gate
    pailou()
    hb = Geo()
    huabiao(hb, 0.0, 0.0, -1)
    for x in (-12.0, 12.0):
        K.G.add(hb, T(x, -3.2, 0) @ Matrix.Diagonal((0.62, 0.62, 0.62, 1.0)))
        K.FAR.box(x - 0.35, x + 0.35, -3.55, -2.85, 0.0, 5.6, "white", skip=("-z",))
        K.COLL.append(("box", x - 0.95, x + 0.95, -4.15, -2.25, 0.0, 1.1))
        K.COLL.append(("box", x - 0.35, x + 0.35, -3.55, -2.85, 1.1, 5.8))
        K.CLEARS.append(rect(x - 1.5, x + 1.5, -4.7, -1.7))
    for i, (x, male) in enumerate(((-2.75, True), (2.75, False))):
        me = lion_mesh(f"Lion{i}", male=male)
        me.materials.append(M["paint"])
        place(me, f"Lion.{i}", parts, T(x, -1.7, 0.45) @ Matrix.Diagonal((0.62, 0.62, 0.62, 1.0)))
        K.G.box(x - 0.55, x + 0.55, -2.6, -0.75, 0.0, 0.45, "marble", skip=("-z",))
        K.FAR.box(x - 0.55, x + 0.55, -2.6, -0.75, 0.0, 1.8, "white", skip=("-z",))
        K.COLL.append(("box", x - 0.55, x + 0.55, -2.6, -0.75, 0.0, 2.0))
    mark("front")
    shanmen()
    mark("shanmen")
    meshes = dict(post=mesh_of(post_geo(), "PostMesh", M, K.TILE), panel=mesh_of(panel_geo(), "PanelMesh", M, K.TILE))
    wofengqiao(meshes, parts)
    mark("bridge")

    # 灵官殿
    main_hall((-6.8, 6.8, 43.0, 51.0), K.spec(5.4, 2.8, K.lin(5.4, 3), K.lin(2.8, 2), 0.6 + 4.2, 1.4, rows=5, end_rows=3, Hk=0.62, gap=1.5, big=False),
                0.6, False, front_doors=3, back_doors=1, beasts=3, front_steps=3.0, back_steps=2.4, col_r=0.32)
    mark("lingguandian")
    # 鼓楼 (west) and 钟楼 (east)
    for cx in (-15.5, 15.5):
        K.tower((cx - 3.8, cx + 3.8, 59.2, 66.8), K.tower_spec(3.8, 0.9, 3.9, 5.9, 8.3, 1.8), 0.45, 5.9, brick_ground=True,
                upper_fill=("window", "window"), facing="e" if cx < 0 else "w")
    mark("towers")
    # 财神殿 / 三官殿, 药王殿 / 救苦殿
    side(-21.5, -13.8, 71.0, 84.0, "e", 4.0, roof="xie", door_bays=1)
    side(13.8, 21.5, 71.0, 84.0, "w", 4.0, roof="xie", door_bays=1)
    side(-21.5, -13.8, 109.0, 123.0, "e", 4.0, roof="xie", door_bays=1)
    side(13.8, 21.5, 109.0, 123.0, "w", 4.0, roof="xie", door_bays=1)
    # 玉皇殿 on its platform, the 月台 in front
    yh = K.spec(8.8, 4.8, K.lin(8.8, 5), K.lin(4.8, 3), 1.0 + 5.0, 1.8, rows=6, end_rows=4, Hk=0.6, gap=1.6)
    yh.TRIM, yh.RIDGE = 0.9, "trim"
    terrace(-7.5, 7.5, 87.6, 94.4, 1.0)
    main_hall((-10.6, 10.6, 93.4, 106.6), yh, 1.0, False, front_doors=3, back_doors=1, beasts=5, back_steps=2.4, col_r=0.38)
    TEXTS.append(("殿皇玉", 0.0, 100.0 - 4.8 - 0.55, 6.45, 2.4, 0.75, -1))
    K.G.box(-1.3, 1.3, 100.0 - 4.8 - 0.53, 100.0 - 4.8 - 0.35, 6.05, 6.85, "board")
    mark("yuhuangdian")
    # 老律堂: 勾连搭, two 硬山 halls back to back on a 月台
    terrace(-7.5, 7.5, 126.2, 133.4, 0.8)
    K.simple_hall_at(0.0, 136.75, 0.0, 11.0, 3.9, 4.7, roof="ying", tone="g", ov=1.3, z0=0.8, door_bays=3)
    K.simple_hall_at(0.0, 142.55, 0.0, 11.0, 3.9, 4.7, roof="ying", tone="g", ov=1.3, z0=0.8, door_bays=0, back=True)
    TEXTS.append(("堂律老", 0.0, 136.75 - 2.6 - 0.42, 4.95, 2.2, 0.7, -1))
    K.G.box(-1.2, 1.2, 136.75 - 2.6 - 0.4, 136.75 - 2.6 - 0.22, 4.6, 5.3, "board")
    mark("laolvtang")
    side(-21.5, -14.5, 131.0, 147.0, "e", 3.9)
    side(14.5, 21.5, 131.0, 147.0, "w", 3.9)
    # 邱祖殿
    main_hall((-7.6, 7.6, 160.2, 171.8), K.spec(6.0, 4.2, K.lin(6.0, 3), K.lin(4.2, 2), 0.8 + 4.6, 1.6, rows=6, end_rows=4, Hk=0.62, gap=1.6),
                0.8, False, front_doors=3, back_doors=1, beasts=5, front_steps=3.0, back_steps=2.4, col_r=0.36)
    mark("qiuzudian")
    side(-21.5, -14.5, 156.0, 172.0, "e", 3.9)
    side(14.5, 21.5, 156.0, 172.0, "w", 3.9)
    # 四御殿 / 三清阁 and its wings
    stats["top"] = siyudian(197.0)
    for cx in (-19.6, 19.6):
        K.simple_hall_at(cx, 197.0, 0.0, 7.0, 5.0, 7.6, roof="ying", tone="g", ov=1.2, storeys=2, zm=3.9, z0=0.45, door_bays=1)
    mark("siyudian")

    # 云集园: the 戒台 hall, 云集山房, rockery, pavilions, 退居楼
    main_hall((-7.2, 7.2, 225.4, 238.6), K.spec(5.6, 5.0, K.lin(5.6, 3), K.lin(5.0, 3), 1.2 + 4.6, 1.6, rows=6, end_rows=4, Hk=0.6, gap=1.6),
                1.2, False, front_doors=3, back_doors=1, beasts=3, front_steps=3.0, col_r=0.36)
    K.simple_hall_at(2.0, 262.0, 0.0, 10.0, 4.6, 4.0, roof="xie", tone="g", ov=1.3, z0=0.45, door_bays=3)
    K.simple_hall_at(-34.0, 279.0, 0.0, 10.0, 4.6, 7.4, roof="ying", tone="g", ov=1.2, storeys=2, zm=3.8, z0=0.35, door_bays=1)
    K.rockery(-34.0, 249.0, 10.0, 7.5, 4.5, 77, peaks=((-37.0, 250.0, 1.6, 2.5), (-30.0, 247.0, 1.0, 2.0)))
    K.pavilion(-36.0, 230.0, 2.2, zb=0.45, H_body=3.0, tone="g")
    K.pavilion(26.0, 247.0, 1.8, zb=0.4, H_body=2.8, tone="g")
    side(-24.0, -14.0, 255.0, 268.0, "e", 3.6, roof="xie")
    mark("garden")

    # the west route (八仙殿, 吕祖殿, 元辰殿, 元君殿, 文昌殿 ...) and its long side halls
    side(-56.0, -37.0, 12.0, 20.0, "s", 3.8, passages=((-48.5, -44.5),))
    for y0, y1 in ((32.0, 42.0), (56.0, 66.0), (80.0, 92.0), (108.0, 118.0), (132.0, 142.0), (156.0, 166.0), (182.0, 192.0)):
        side(-57.0, -37.0, y0, y1, "s", 4.2, roof="xie", door_bays=3)
    side(-68.5, -62.5, 14.0, 70.0, "e", 3.6)
    side(-70.0, -64.0, 78.0, 146.0, "e", 3.6)
    side(-62.5, -56.5, 156.0, 228.0, "e", 3.6)
    side(-34.0, -28.0, 30.0, 60.0, "w", 3.6)
    side(-34.0, -28.0, 100.0, 146.0, "w", 3.6)
    side(-50.0, -30.0, 204.0, 213.0, "s", 3.8)
    mark("west")
    # the east route (南极殿, 真武殿, 火神殿, 斗姥阁, 罗公塔) and the offices along the east wall
    side(37.0, 55.0, 10.0, 17.0, "s", 3.8, passages=((44.0, 48.0),))
    for y0, y1 in ((30.0, 40.0), (62.0, 72.0), (92.0, 102.0)):
        side(37.0, 55.0, y0, y1, "s", 4.2, roof="xie", door_bays=3)
    side(28.5, 34.5, 42.0, 58.0, "e", 3.6)
    side(57.5, 63.5, 42.0, 58.0, "w", 3.6)
    K.simple_hall_at(46.0, 125.5, 0.0, 10.0, 5.2, 7.6, roof="xie", tone="g", ov=1.3, storeys=2, zm=3.9, z0=0.45, door_bays=1)
    luogongta(46.0, 192.0)
    side(36.0, 56.0, 210.0, 219.0, "s", 3.8)
    for y0 in (14.0, 34.0, 54.0, 72.0):
        side(68.0, 90.0, y0, y0 + 9.0, "s", 3.8)
    for y0 in (96.0, 118.0, 140.0, 162.0, 184.0, 206.0, 222.0):
        side(70.0, 99.0, y0, y0 + 9.0, "s", 3.8)
    for y0 in (238.0, 253.0):
        side(40.0, 72.0, y0, y0 + 8.5, "s", 3.8)
    side(15.0, 32.0, 269.0, 278.0, "s", 3.6)
    mark("east")

    # walls: the precinct (OSM's line) and the 中路's two sides with doorways into the routes
    walls = [(inset(OUTLINE, 0.5), True)]
    for sx in (-1, 1):
        x = sx * 22.4
        cuts = [9.5, 29.0, 32.0, 95.0, 98.0, 150.0, 153.0, 210.0]
        for a, b in zip(cuts[0::2], cuts[1::2]):
            walls.append(([(x, a), (x, b)], False))
    walls.append(([(65.5, 8.5), (65.5, 86.0)], False))
    walls.append(([(65.5, 92.0), (65.5, 230.0)], False))
    stats["walls"] = K.walls(walls, zt=3.4, th=0.65, cop="gtex")
    mark("walls")
    # the courts' paving: the front notch and the 中路 round the pond
    for poly in (rect(-24.0, 23.0, -6.5, -0.4), rect(-22.0, 22.0, 8.6, 16.0), rect(-22.0, -8.1, 16.0, 28.1), rect(8.1, 22.0, 16.0, 28.1),
                 rect(-22.0, 22.0, 28.1, 210.0)):
        K.paved(poly)
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    TEXTS.clear()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = K.materials("BY", glaze=GREY, glaze_tex=GREY_TEX, grey=GREY, grey_tex=GREY_TEX, beam_glow=0.7)
    M["trim"] = material("BY_GreenGlaze", GREEN, 0.32, props={"wet": "surface", "glowStrength": 0.5})
    M["dry"] = material("BY_PondFloor", "#6e685c", 0.95, props={"wet": "ground", "glowStrength": 0.4, "layer": 10})
    M["deck"] = material("BY_Deck", "#b9b3a6", 0.7, props={"wet": "ground", "glowStrength": 0.5})
    M["bronze"] = material("BY_Bronze", "#7a5a2e", 0.35, metal=1.0, props={"wet": "surface"})
    M["leaf"] = material("BY_Cypress", "#3d5534", 0.85, props={"wet": "damp", "glowStrength": 0.3})
    M["bark"] = material("BY_Bark", "#5a4a3c", 0.9, props={"wet": "damp"})
    tile = dict(K.TILE, trim=2.0, dry=2.0, deck=1.5, bronze=1.0, leaf=2.0, bark=1.0)
    main = collection("白云观")
    parts = collection("构件", main)
    stats = baiyunguan(M, parts)
    stats["trees"] = trees(parts, M, tile)
    K.G.build("Temple", collection("观", main), M, tile)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=GREY))
    text_meshes(parts, M)
    K.FAR.build("Massing", collection("LOD1", main), M, tile)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: the precinct in axis-aligned pieces (its edges run straight in this frame), out past the walls
    for i, r in enumerate(((-73.5, 100.0, 3.0, 99.0), (-73.5, -23.0, -9.5, 3.5), (-25.0, 25.0, -9.0, 3.5), (22.0, 62.5, -7.5, 3.5),
                           (-77.5, 106.0, 98.0, 153.0), (-69.0, 106.0, 152.0, 236.0), (-63.0, 91.0, 235.0, 247.0), (-63.5, 80.0, 246.0, 266.5),
                           (-63.5, 37.0, 265.5, 287.0), (-38.0, 15.0, 286.0, 301.5))):
        flat_marker(helpers, f"precinct{i}", rect(*r), "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "baiyunguan", "白云观", "White Cloud Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 400
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
