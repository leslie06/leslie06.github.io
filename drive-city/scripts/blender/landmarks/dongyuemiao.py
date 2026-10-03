# 东岳庙 Dongyue Temple on 朝阳门外大街 (朝阳), the Daoist temple of Mount Tai's god, founded 1319 and rebuilt in
# the Qing, now also the 北京民俗博物馆; built in Blender with the timber halls of hall.py and the courtyard pieces
# of gongwangfu.py (imported, as zhihuasi.py does), marked with the bcity_landmark add-on's conventions. Also the
# helper library of guangjisi.py (tones, extra materials, arched gates, glazed pieces).
#
#   blender -b -P scripts/blender/landmarks/dongyuemiao.py -- [--out art/landmarks/dongyuemiao.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the axis at game (3429.2, -1635) (the front of 岱岳殿's
# 月台), heading +3.0 (every hall outline in OSM leans 2.4-3.5 degrees: going east, the edges run south).
# OSM has the precinct (way 263608113), the halls as outlines (ways 469512039-469512053: 岱岳殿 with its front
# 抱厦, the 穿堂 and 育德殿 as one outline; 瞻岱门 with the 七十二司 rows; the two 碑亭; the 后罩楼's U), the small
# 钟楼 and 鼓楼 by the street (ways 1370812416/7) and, across the street, the 琉璃牌楼 (way 345219804,
# building=gatehouse, 24 x 13 m on the axis of 神路街).
#
# South to north (zh.wikipedia 北京东岳庙, the museum's descriptions):
#   琉璃牌楼   south of 朝外大街: 三间四柱七楼, a stone-arched body faced in yellow glaze with green pillars, white
#              arch rings and plinth, painted (glazed) beam bands, 秩祀岱宗 / 永延帝祚 on the boards, seven
#              roofs in grey tiles with green glazed edges (灰筒瓦绿琉璃剪边); the arches open to the ground.
#   钟楼, 鼓楼 outside the gate, west and east, two storeys (as OSM puts them; 5.5 m square).
#   棂星门     the entrance on the street (the old 山门 south of it is gone): red walls, three stone arches.
#   瞻岱门     five bays, 庑殿, a passage hall, between the two front rows of the 七十二司.
#   the main court: the 七十二司 rows round it (west and east corridors with a taller hall in each), two
#              碑亭 (yellow glaze) and rows of steles on turtles (the 碑林).
#   岱岳殿     five bays, single-eaved 庑殿, grey tiles with green edges, a three-bay 抱厦 in front on the 月台;
#              the 穿堂 behind it to 育德殿 (five bays, 庑殿), whose rear 抱厦 closes the axis.
#   后罩楼     two storeys, round the north, east and west of the rear court (seventy-four rooms).
# Doubtful: 玉皇殿 is in the west court, outside OSM's precinct (not built); the 棂星门's form (three arches
# under one 歇山 roof here); 岱岳殿's roof (庑殿 per Wikipedia; some guides say 歇山); the heights (none published:
# 岱岳殿 ~16 m to the ridge); the side rooms of the front court (from the learnt roofs); the 碑亭 tiles.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, cyl, flat_marker, mesh_of, place, rect  # noqa: E402
import hall  # noqa: E402
from hall import roofs, uvs  # noqa: E402
import gongwangfu as K  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "dongyuemiao.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
HEADING = 3.0
ANCHOR = (3429.2, -1635.0)
GREY, GREY_TEX = "#5d6064", "#696c70"
GREEN, GREEN_TEX = "#2f7547", "#367f4f"
YELLOW, YELLOW_TEX = "#d39a2c", "#dca634"
I4 = Matrix.Identity(4)


# --- shared helpers (guangjisi.py imports these) ---------------------------------------------------------

def panel_image(name):
    """Glazed facing: yellow tiles in green frames with a lozenge in each (2 m a repeat)."""
    n = 256
    cv = Canvas(n, n, "#c99a33")
    X, Y = cv.x, cv.y
    for i in range(4):
        for j in range(4):
            cx, cy = (i + 0.5) * n / 4, (j + 0.5) * n / 4
            d = np.abs(X - cx) + np.abs(Y - cy)
            cv.put(d < n / 11, "#e1b84a")
            cv.put((d > n / 11) & (d < n / 9.5), "#2f7547")
    for k in range(5):
        cv.line(k * n / 4, 0, k * n / 4, n, 5, "#2b6d41")
        cv.line(0, k * n / 4, n, k * n / 4, 5, "#2b6d41")
    cv.noise(0.08, 17)
    return image(name, np.flipud(cv.a).copy())


def extra_materials(P, M):
    """Glazes beside K.materials' palette: green (the trim and green roofs), yellow, the glazed facing, bronze."""
    M.update(
        trim=material(f"{P}_GreenGlaze", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        grn=material(f"{P}_GreenGlazeB", GREEN, 0.32, props={"wet": "surface", "glowStrength": 0.5}),
        grntex=material(f"{P}_GreenRows", GREEN, 0.35, tex=K.tile_tex(f"{P}_GreenRowsTex", GREEN_TEX), props={"wet": "surface", "glowStrength": 0.5}),
        yel=material(f"{P}_YellowGlaze", YELLOW, 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        yeltex=material(f"{P}_YellowRows", YELLOW, 0.33, tex=K.tile_tex(f"{P}_YellowRowsTex", YELLOW_TEX), props={"wet": "surface", "glowStrength": 0.5}),
        panel=material(f"{P}_GlazedFacing", "#d0a03a", 0.35, tex=panel_image(f"{P}_GlazedFacingTex"), props={"wet": "surface", "glowStrength": 0.6}),
        bronze=material(f"{P}_Bronze", "#4a3f2c", 0.45, metal=0.8, props={"wet": "surface"}),
    )
    return M


TILE = dict(K.TILE, trim=2.0, grn=2.0, yel=2.0, panel=2.0, bronze=1.0)
TO_YELLOW = {"tile": "yel", "ytex": "yeltex", "grey": "yel", "gtex": "yeltex"}
TO_GREEN = {"tile": "grn", "ytex": "grntex", "grey": "grn", "gtex": "grntex"}
TO_GREY = {"tile": "grey", "ytex": "gtex"}


class toned:
    """Everything added to K.G / K.FAR inside the block has its roof keys remapped (yellow, green, grey)."""

    def __init__(self, keys):
        self.keys = keys

    def __enter__(self):
        self.g0, self.f0 = K.G, K.FAR
        K.G, K.FAR = Geo(), Geo()
        return self

    def __exit__(self, *exc):
        g, f = K.G, K.FAR
        K.G, K.FAR = self.g0, self.f0
        K.remap(g, self.keys)
        K.remap(f, self.keys)
        K.G.add(g, I4)
        K.FAR.add(f, I4)
        return False


def trimmed(h, t=1.2):
    """灰筒瓦绿琉璃剪边: the first `t` metres of every eave and the ridges in green glaze."""
    h.TRIM, h.RIDGE = t, "trim"
    return h


def plaque_text(coll, M, text, m, x, y, z, w, hgt, face, name):
    """Gilt characters on a board in a frame `m`, facing -y (face -1) or +y (face 1); `text` as it is read."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, bpy.data.fonts.load(FONT, check_existing=True), 1.0, 0.04
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_character = 1.1
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min((hgt - 0.2) / (max(ys) - min(ys)), (w - 0.3) / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    mm = m @ T(x, y + face * 0.05, z) @ Rz(0.0 if face < 0 else math.pi) @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = mm @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, v.co.z))
    me.materials.append(M["gold"])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def board(g, x, z, w, hgt, by):
    """A blue board in a gilt frame on both faces of a wall of half depth `by`."""
    for side in (-1, 1):
        y = side * (by + 0.04)
        g.polyn([(x - w / 2, y, z - hgt / 2), (x + w / 2, y, z - hgt / 2), (x + w / 2, y, z + hgt / 2), (x - w / 2, y, z + hgt / 2)], "board", (0, side, 0))
        for a, b, c, d in ((x - w / 2 - 0.1, x + w / 2 + 0.1, z + hgt / 2, z + hgt / 2 + 0.1), (x - w / 2 - 0.1, x + w / 2 + 0.1, z - hgt / 2 - 0.1, z - hgt / 2),
                           (x - w / 2 - 0.1, x - w / 2, z - hgt / 2, z + hgt / 2), (x + w / 2, x + w / 2 + 0.1, z - hgt / 2, z + hgt / 2)):
            y0, y1 = (y, y + 0.06) if side > 0 else (y - 0.06, y)
            g.box(a, b, y0, y1, c, d, "gold", skip=("-y", "+y")[(side + 1) // 2:(side + 1) // 2 + 1])


def arch_face(g, y, side, bx, z0, zw, arches, key, seg=10):
    """One face (y, normal side) of a wall from x -bx..bx, z0..zw, with round-headed openings `arches`
    [(cx, half width, springing height)], sorted by x."""
    xs = [-bx]
    for c, w, _ in arches:
        xs += [c - w, c + w]
    xs.append(bx)
    for i in range(0, len(xs), 2):
        if xs[i + 1] - xs[i] > 0.01:
            g.polyn([(xs[i], y, z0), (xs[i + 1], y, z0), (xs[i + 1], y, zw), (xs[i], y, zw)], key, (0, side, 0))
    for c, w, ah in arches:
        arc = [(c + w * math.cos(math.pi * k / seg), ah + w * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
        for (xa, za), (xb, zb) in zip(arc, arc[1:]):
            g.polyn([(xa, y, za), (xb, y, zb), (xb, y, zw), (xa, y, zw)], key, (0, side, 0))


def arch_body(g, bx, by, z0, zw, arches, key="plaster", ring="marble", seg=10):
    """A wall body with arched passages right through it: both faces, the ends, the vaults, white arch rings."""
    for side in (-1, 1):
        arch_face(g, side * by, side, bx, z0, zw, arches, key, seg)
    for sx in (-1, 1):
        g.polyn([(sx * bx, -by, z0), (sx * bx, by, z0), (sx * bx, by, zw), (sx * bx, -by, zw)], key, (sx, 0, 0))
    for c, w, ah in arches:
        arc = [(c + w * math.cos(math.pi * k / seg), ah + w * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
        for (xa, za), (xb, zb) in zip(arc, arc[1:]):
            g.polyn([(xa, -by, za), (xb, -by, zb), (xb, by, zb), (xa, by, za)], ring, (c - (xa + xb) / 2, 0, ah - (za + zb) / 2))
        for sx in (-1, 1):
            g.polyn([(c + sx * w, -by, z0), (c + sx * w, by, z0), (c + sx * w, by, ah), (c + sx * w, -by, ah)], ring, (-sx, 0, 0))
        g.polyn([(c - w, -by, z0 + 0.01), (c + w, -by, z0 + 0.01), (c + w, by, z0 + 0.01), (c - w, by, z0 + 0.01)], "marble", (0, 0, 1))
        for side in (-1, 1):
            yy = side * (by + 0.05)
            out = [(c + (w + 0.32) * math.cos(math.pi * k / seg), ah + (w + 0.32) * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
            for k in range(seg):
                g.polyn([(arc[k][0], yy, arc[k][1]), (arc[k + 1][0], yy, arc[k + 1][1]), (out[k + 1][0], yy, out[k + 1][1]), (out[k][0], yy, out[k][1])],
                        ring, (0, side, 0))
            for sx in (-1, 1):
                g.polyn([(c + sx * w, yy, z0), (c + sx * (w + 0.32), yy, z0), (c + sx * (w + 0.32), yy, ah), (c + sx * w, yy, ah)], ring, (0, side, 0))


def arch_colliders(m, bx, by, z0, zt, arches):
    xs = [-bx]
    for c, w, _ in arches:
        xs += [c - w, c + w]
    xs.append(bx)
    for i in range(0, len(xs), 2):
        if xs[i + 1] - xs[i] > 0.01:
            K.cbox(m, xs[i], xs[i + 1], -by, by, 0.0, zt)
    for c, w, ah in arches:
        K.cbox(m, c - w, c + w, -by, by, ah + 0.6 * w, zt)


def arch_gate(cx, cy, ang, bx, by, zw, arches, roof_k=0.5, z0=0.25, key="plaster", plaque=None, ov=1.0, Hk=0.62):
    """A gate of brick or red plaster with arched passages under a (textured) 歇山 roof - 山门, 棂星门, 天王殿's
    kind; the roof keys are 'tile'/'ytex' (wrap the call in `toned`). Returns the frame."""
    m = K.M_of(cx, cy, ang)
    g = Geo()
    g.box(-bx - 0.35, bx + 0.35, -by - 0.35, by + 0.35, 0.0, z0, "marble", skip=("-z",))
    arch_body(g, bx, by, z0, zw, arches, key)
    if plaque:
        board(g, 0.0, zw - 0.75, *plaque, by)
    K.beam_band(g, bx, by, zw, zw + 0.55)
    A, D = bx + ov, by + ov
    U = dict(A=A, D=D, z=zw + 0.35, H=Hk * D, p=1.5, o=min(0.6, 0.1 * D + 0.2), lift=min(0.6, 0.1 * D + 0.2), Lc=0.7 * D, Vc=0.42 * D)
    h = SimpleNamespace(XS=[-bx, bx], YS=[-by, by], OX=bx, OY=by, IX=bx, IY=by, BEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55), UBEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.55 * D - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3)
    K.FLAT["on"] = True
    K.roofs_k(h, g, roof_k)
    K.FLAT["on"] = False
    K.G.add(g, m)
    K.cbox(m, -bx - 0.35, bx + 0.35, -by - 0.35, by + 0.35, 0.0, z0)
    arch_colliders(m, bx, by, z0, zw + 0.5, arches)
    K.body_rect(m, -bx - 0.35, bx + 0.35, -by - 0.35, by + 0.35)
    K.far_block(m, A, D, (-bx, bx, -by, by), zw, U["z"] + U["H"])
    return m


def stele_pavilion(cx, cy, half, zw=4.6, z0=0.6):
    """碑亭: a square pavilion of red plaster with an arched door on each face, a beam band, a textured 歇山."""
    m = K.M_of(cx, cy, 0.0)
    g = Geo()
    ov = 1.2
    b = half - ov
    g.box(-b - 0.6, b + 0.6, -b - 0.6, b + 0.6, 0.0, z0, "marble", skip=("-z",))
    g.box(-b, b, -b, b, z0, zw, "plaster", skip=("-z", "+z"))
    for rot in range(4):
        P = lambda u, z: hall.to_world(rot, b + 0.03, u, 0, z)          # noqa: E731
        g.polyn([P(-0.85, z0), P(0.85, z0), P(0.85, z0 + 2.6), P(-0.85, z0 + 2.6)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("gatedoor", QUAD))
    K.beam_band(g, b, b, zw, zw + 0.55)
    A = half
    U = dict(A=A, D=A, z=zw + 0.35, H=0.66 * A, p=1.5, o=0.5, lift=0.5, Lc=0.7 * A, Vc=0.42 * A)
    h = SimpleNamespace(XS=[-b, b], YS=[-b, b], OX=b, OY=b, IX=b, IY=b, BEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55), UBEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.55 * A - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=4)
    K.FLAT["on"] = True
    K.roofs_k(h, g, 0.45)
    K.FLAT["on"] = False
    # the stele inside, seen through the doors
    g.box(-0.8, 0.8, -0.5, 0.5, z0, z0 + 0.7, "marble")
    g.box(-0.55, 0.55, -0.16, 0.16, z0 + 0.7, z0 + 3.3, "white")
    K.G.add(g, m)
    K.cbox(m, -b - 0.6, b + 0.6, -b - 0.6, b + 0.6, 0.0, z0)
    K.cbox(m, -b, b, -b, b, 0.0, zw + 0.5)
    K.body_rect(m, -b - 0.6, b + 0.6, -b - 0.6, b + 0.6)
    K.far_block(m, A, A, (-b, b, -b, b), zw, U["z"] + U["H"])
    return m


def stele(x, y, yaw=0.0):
    """A stele on a turtle (赑屃): a dark stone base, the slab, a carved cap."""
    m = K.M_of(x, y, yaw)
    g = Geo()
    g.box(-0.55, 0.55, -1.05, 1.05, 0.0, 0.55, "grey")
    g.box(-0.35, 0.35, 0.9, 1.35, 0.15, 0.55, "grey")
    g.box(-0.4, 0.4, -0.13, 0.13, 0.55, 3.0, "marble")
    g.box(-0.47, 0.47, -0.18, 0.18, 3.0, 3.45, "grey")
    K.G.add(g, m)
    K.cbox(m, -0.55, 0.55, -1.05, 1.35, 0.0, 3.45)


def censer(x, y, s=1.0, key="bronze"):
    """A bronze tripod censer (宝鼎) on a stone base."""
    g = Geo()
    g.box(-0.9 * s, 0.9 * s, -0.9 * s, 0.9 * s, 0.0, 0.35 * s, "marble", skip=("-z",))
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        cyl(g, 0.45 * s * math.cos(a), 0.45 * s * math.sin(a), 0.35 * s, 1.0 * s, 0.1 * s, 0.08 * s, 6, key)
    cyl(g, 0, 0, 0.95 * s, 1.85 * s, 0.58 * s, 0.7 * s, 14, key, caps=(True, True))
    for sx in (-1, 1):
        g.box(sx * 0.5 * s - 0.05 * s, sx * 0.5 * s + 0.05 * s, -0.25 * s, 0.25 * s, 1.85 * s, 2.3 * s, key)
    cyl(g, 0, 0, 1.85 * s, 2.25 * s, 0.35 * s, 0.25 * s, 10, key, caps=(False, True))
    K.G.add(g, T(x, y, 0))
    K.COLL.append(("box", x - 0.9 * s, x + 0.9 * s, y - 0.9 * s, y + 0.9 * s, 0.0, 2.3 * s))


def mini_spec(half, core_d, ze, H, kind="xieshan", trim=0.45, ov=0.55):
    """A small roof over a 牌楼's bay: eave half sizes half+ov by core_d+ov, eave height ze, rise H."""
    A, D = half + ov, core_d + ov
    zb = ze - 0.75
    return SimpleNamespace(
        XS=[-half, -half + 0.01, half - 0.01, half], YS=[-core_d, -core_d + 0.01, core_d - 0.01, core_d], OX=half, OY=core_d, IX=half - 0.01, IY=core_d - 0.01,
        BEAM=(zb, zb + 0.2, zb + 0.2, ze - 0.15), UBEAM=(zb, zb + 0.2, zb + 0.2, ze - 0.15), OVERHANG=ov, LOWER=None,
        UPPER=dict(A=A, D=D, z=ze, H=H, p=1.5, o=0.6 * ov, lift=0.7 * ov, Lc=min(2.5 * ov, 0.6 * min(A, D)), Vc=1.2 * ov),
        GABLE_X=max(0.4, A - 0.55 * D - 0.6), PITCH=0.42, AMP=0.09, TRIM=trim, RIDGE="trim" if trim else "tile", KIND=kind,
        ROWS=5, END_ROWS=3, LOWER_ROWS=3, BRACKET_GAP=1.3, WEN=0.6)


# --- 东岳庙 -------------------------------------------------------------------------------------------------

def glazed_pailou(coll, M, cx, cy, ang):
    """琉璃牌楼, 三间四柱七楼: a body of three stone arches faced in yellow glaze with green pillars, white
    arch rings and a 须弥座 plinth under the piers (not across the passages), glazed beam bands, the boards
    (秩祀岱宗 to the south, 永延帝祚 to the north) and seven small roofs - 明楼, two 夹楼, two 次楼, two 边楼."""
    m = K.M_of(cx, cy, ang)
    g = Geo()
    bx, by = 10.6, 1.3
    arches = [(-6.6, 1.5, 3.2), (0.0, 2.1, 4.2), (6.6, 1.5, 3.2)]
    zo, zc = 7.2, 8.6                       # the body's top: outer bays, the raised middle
    xc = 4.6
    arch_body(g, bx, by, 0.0, zo, arches, key="panel", ring="white")
    # the raised middle over the centre bay
    for side in (-1, 1):
        g.polyn([(-xc, side * by, zo), (xc, side * by, zo), (xc, side * by, zc), (-xc, side * by, zc)], "panel", (0, side, 0))
    for sx in (-1, 1):
        g.polyn([(sx * xc, -by, zo), (sx * xc, by, zo), (sx * xc, by, zc), (sx * xc, -by, zc)], "panel", (sx, 0, 0))
    # pillars: green glazed strips, a little proud, at the bay lines and the ends
    for sx in (-1, 1):
        for a, b, top in ((3.1, 4.1, zc), (9.6, 10.6, zo)):
            x0, x1 = (a, b) if sx > 0 else (-b, -a)
            g.box(x0, x1, -by - 0.08, by + 0.08, 0.9, top - 0.8, "grn", skip=("-z", "+z"))
    # the plinth under the piers
    xs = [-bx]
    for c, w, _ in arches:
        xs += [c - w, c + w]
    xs.append(bx)
    for i in range(0, len(xs), 2):
        a = xs[i] - (0.18 if i == 0 else 0.0)
        b = xs[i + 1] + (0.18 if i + 1 == len(xs) - 1 else 0.0)
        g.box(a, b, -by - 0.18, by + 0.18, 0.0, 0.9, "white", skip=("-z",))
        g.box(a - (0.08 if i == 0 else 0), b + (0.08 if i + 1 == len(xs) - 1 else 0), -by - 0.26, by + 0.26, 0.0, 0.25, "marble", skip=("-z",))
    # beam bands under the roofs
    for x0, x1, z0, z1 in ((-bx, -xc, zo - 0.8, zo), (xc, bx, zo - 0.8, zo), (-xc, xc, zc - 0.8, zc)):
        for side in (-1, 1):
            y = side * (by + 0.06)
            K.strip(g, (x0, y) if side < 0 else (x1, y), (x1, y) if side < 0 else (x0, y), z0, z1, "beam", (0, side, 0), seg=3.0)
    for x0, x1, z in ((-bx, -xc, zo), (xc, bx, zo), (-xc, xc, zc)):
        g.box(x0 - 0.1, x1 + 0.1, -by - 0.12, by + 0.12, z, z + 0.15, "grn")
    board(g, 0.0, 6.95, 3.2, 1.05, by + 0.06)
    # the seven roofs: (cx, half, eave z, rise, kind, rotated)
    tops = [(0.0, 2.4, zc + 1.2, 2.0, "xieshan", False),
            (-3.85, 1.3, zc + 0.15, 1.05, "wudian", True), (3.85, 1.3, zc + 0.15, 1.05, "wudian", True),
            (-6.6, 1.5, zo + 0.85, 1.5, "xieshan", False), (6.6, 1.5, zo + 0.85, 1.5, "xieshan", False),
            (-10.0, 1.3, zo + 0.25, 0.95, "wudian", True), (10.0, 1.3, zo + 0.25, 0.95, "wudian", True)]
    # each roof is built at 1/S scale and shrunk, so its ridges, sweeps and ornaments shrink with it
    S = 0.55
    SM = Matrix.Diagonal((S, S, S, 1.0))
    nb = 0
    for x, half, ze, H, kind, rot in tops:
        rg = Geo()
        if rot:
            h = mini_spec(by / S, 0.55 / S, ze / S, H / S, kind, trim=0.5 / S, ov=0.6 / S)
            mm = T(x, 0, 0) @ Rz(math.pi / 2) @ SM
            base = zc if abs(x) < 5 else zo
            g.box(x - 0.5, x + 0.5, -0.5, 0.5, base + 0.15, ze - 0.05, "grn", skip=("-z",))
        else:
            h = mini_spec(half / S, by / S, ze / S, H / S, kind, trim=0.5 / S, ov=0.6 / S)
            mm = T(x, 0, 0) @ SM
            # the bracket band between the body and the eave
            base = zc if abs(x) < 1 else zo
            g.box(x - half, x + half, -by + 0.15, by - 0.15, base + 0.15, ze - 0.1, "grn", skip=("-z",))
            for p, yaw in hall.bracket_spots(h, True, (base + 0.2) / S):
                K.BRK.append(m @ mm @ T(*p) @ Rz(yaw) @ Matrix.Diagonal((1.0, 1.0, 1.0, 1.0)))
                nb += 1
        K.roofs_k(h, rg, 0.6)
        g.add(rg, mm)
    K.G.add(g, m)
    plaque_text(coll, M, "宗岱祀秩", m, 0.0, -(by + 0.1), 6.95, 3.2, 1.05, -1, "PlaqueS")
    plaque_text(coll, M, "祚帝延永", m, 0.0, by + 0.1, 6.95, 3.2, 1.05, 1, "PlaqueN")
    arch_colliders(m, bx + 0.26, by + 0.26, 0.0, zo, arches)
    K.cbox(m, -xc, xc, -by, by, zo, zc + 1.0)
    K.body_rect(m, -bx - 0.3, bx + 0.3, -by - 0.3, by + 0.3)
    f = Geo()
    f.box(-bx, bx, -by, by, 0.0, zo, "panel", skip=("-z",))
    f.box(-xc, xc, -by, by, zo, zc, "panel", skip=("-z",))
    for x, half, ze, H, kind, rot in tops:
        if not rot:
            fr = Geo()
            K.far_roof(fr, half + 0.55, by + 0.55, ze, ze + H + 0.4, "grey")
            f.add(fr, T(x, 0, 0))
    K.FAR.add(f, m)
    # the paved square it stands in (OSM's outline, the body near its north edge)
    p = [m @ Vector((x, y, 0)) for x, y in rect(-12.15, 12.15, -7.9, 4.9)]
    K.paved([(v.x, v.y) for v in p])
    return m, nb


def dongyuemiao(coll, M):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # ---- across the street: the 琉璃牌楼 ------------------------------------------------------------------
    px, py = K.L(3417.2, -1454.0)
    _, stats["pailou_brackets"] = glazed_pailou(coll, M, px, py, math.radians(1.0))
    stats["pailou_at"] = (round(px, 1), round(py, 1))
    mark("pailou")

    # ---- the forecourt: 钟楼 / 鼓楼 outside the gate, the 棂星门, the front rooms ----------------------------
    for r in ((-18.7, -11.9, -113.4, -106.6), (12.2, 19.0, -114.1, -107.3)):
        K.tower(r, K.tower_spec(3.4, 1.0, 4.0, 6.1, 8.6, 1.9), 0.45, 6.1, brick_ground=True, tone="g")
    with toned(TO_GREY):
        gm = arch_gate(0.5, -94.5, 0.0, 9.6, 1.5, 5.4, [(-5.9, 1.25, 2.6), (0.0, 1.75, 3.1), (5.9, 1.25, 2.6)], plaque=(2.6, 0.9), ov=1.1)
    for face in (-1, 1):
        plaque_text(coll, M, "庙岳东", gm, 0.0, face * 1.6, 5.4 - 0.75, 2.6, 0.9, face, f"GatePlaque{face:+d}")
    K.simple_hall((-33.9, -18.1, -99.7, -93.6), "n", 3.4, tone="g")
    K.simple_hall((21.4, 33.0, -101.9, -92.9), "n", 3.4, tone="g")
    K.simple_hall((-44.4, -35.2, -90.0, -74.0), "e", 3.4, tone="g")
    K.simple_hall((35.6, 45.0, -90.0, -74.0), "w", 3.4, tone="g")
    mark("forecourt")

    # ---- 瞻岱门 and the front rows of the 七十二司 ------------------------------------------------------------
    hz = trimmed(K.spec(9.95, 5.9, K.lin(9.95, 5), K.lin(5.9, 2), 0.6 + 5.0, 1.6, kind="wudian", rows=6, end_rows=4, Hk=0.6, gap=1.7, big=False))
    K.main_hall((-10.7, 12.4, -72.0, -57.0), hz, 0.6, False, front_doors=3, back_doors=3, passage=True, beasts=3, front_steps=4.0, back_steps=4.0, col_r=0.38, tone="g")
    K.simple_hall((-42.9, -11.6, -69.0, -58.8), "n", 3.5, tone="g", door_bays=2)
    K.simple_hall((13.3, 42.7, -68.5, -59.0), "n", 3.5, tone="g", door_bays=2)
    mark("zhandaimen")

    # ---- the main court: corridors, 碑亭, the 碑林 ------------------------------------------------------------
    K.simple_hall((-43.0, -35.4, -58.8, -26.0), "e", 3.4, tone="g", door_bays=4)
    K.simple_hall((-43.6, -33.0, -22.3, -9.8), "e", 4.6, roof="xie", ov=1.3, tone="g", Hk=0.6, z0=0.5)
    K.simple_hall((-42.9, -32.6, -7.1, 27.2), "e", 3.4, tone="g", door_bays=4)
    K.simple_hall((-42.9, -15.4, 27.2, 41.6), "s", 3.8, tone="g", door_bays=3)
    K.simple_hall((33.4, 42.7, -59.0, -28.2), "w", 3.4, tone="g", door_bays=4)
    K.simple_hall((34.5, 44.8, -24.0, -11.0), "w", 4.6, roof="xie", ov=1.3, tone="g", Hk=0.6, z0=0.5)
    K.simple_hall((33.4, 43.8, -8.0, 28.2), "w", 3.4, tone="g", door_bays=4)
    K.simple_hall((17.2, 43.8, 28.2, 41.7), "s", 3.8, tone="g", door_bays=3)
    with toned(TO_YELLOW):
        stele_pavilion(-17.45, -28.5, 5.5)
        stele_pavilion(17.4, -29.1, 5.4)
    n = 0
    for y in (-50.0, -45.5, -15.0, -10.5):
        for x in (8.0, 11.5, 15.0, 18.5, 22.0, 25.5, 29.0):
            for sx in (-1, 1):
                if -36 < y < -21 and 10.5 < x < 24.5:
                    continue
                stele(sx * x, y)
                n += 1
    stats["steles"] = n
    mark("court")

    # ---- 岱岳殿: the 月台, the front 抱厦, the hall ----------------------------------------------------------
    K.platform((-11.8, 11.8, 0.2, 13.0), 1.0)
    g = Geo()
    ramp = K.steps(g, -2.6, 2.6, 0.2, -1, 0.0, 1.0)
    K.G.add(g, I4)
    K.walk(I4, ramp)
    censer(0.0, 6.0, 1.1)
    hp = trimmed(K.spec(6.9, 4.0, K.lin(6.9, 3), K.lin(4.0, 2), 1.2 + 4.6, 1.5, kind="xieshan", rows=5, end_rows=3, Hk=0.55, gap=1.6, big=False), 1.0)
    K.main_hall((-8.4, 8.4, 12.0, 23.0), hp, 1.2, False, front_doors=3, back_doors=0, beasts=3, col_r=0.36, tone="g")
    hd = trimmed(K.spec(11.4, 8.25, K.lin(11.4, 5), K.lin(8.25, 3), 1.2 + 6.0, 2.0, kind="wudian", rows=7, end_rows=5, Hk=0.6, gap=1.8), 1.4)
    K.main_hall((-13.4, 13.4, 20.7, 41.2), hd, 1.2, False, front_doors=3, back_doors=1, beasts=5, col_r=0.44, tone="g")
    mark("daiyuedian")
    # ---- the 穿堂 and 育德殿 -------------------------------------------------------------------------------
    K.simple_hall((-2.6, 4.1, 40.0, 63.0), "e", 4.2, tone="g", door_bays=2, z0=1.0)
    hy = trimmed(K.spec(10.5, 10.15, K.lin(10.5, 5), K.lin(10.15, 4), 1.0 + 5.6, 1.9, kind="wudian", rows=7, end_rows=5, Hk=0.55, gap=1.8), 1.3)
    K.main_hall((-12.4, 12.4, 61.8, 85.9), hy, 1.0, False, front_doors=1, back_doors=1, beasts=5, col_r=0.42, tone="g")
    K.simple_hall((-6.6, 7.4, 85.0, 93.0), "n", 4.0, roof="xie", ov=1.2, tone="g", door_bays=3, z0=0.8, Hk=0.6)
    mark("yudedian")
    # ---- side halls between the courts, the 后罩楼 ----------------------------------------------------------
    K.simple_hall((-41.2, -33.1, 45.9, 58.1), "e", 3.6, tone="g")
    K.simple_hall((35.3, 45.6, 46.1, 57.5), "w", 3.6, tone="g")
    K.simple_hall((-42.3, -34.7, 60.2, 75.8), "e", 3.6, tone="g")
    K.simple_hall((36.2, 45.1, 60.5, 76.0), "w", 3.6, tone="g")
    K.simple_hall((-44.2, 44.5, 102.4, 114.0), "s", 7.4, storeys=2, zm=3.9, back=True, tone="g", z0=0.45)
    K.simple_hall((-43.9, -34.3, 76.1, 102.4), "e", 7.0, storeys=2, zm=3.7, tone="g", z0=0.45)
    K.simple_hall((35.4, 44.5, 78.6, 102.4), "w", 7.0, storeys=2, zm=3.7, tone="g", z0=0.45)
    mark("houzhaolou")

    # ---- walls ---------------------------------------------------------------------------------------------
    WX0, WX1, WY0, WY1 = -45.0, 47.0, -94.5, 114.9
    outer = [((WX0, WY0), (WX0, WY1), (WX1, WY1), (WX1, WY0)), ((WX1, WY0), (WX0, WY0))]
    n1 = K.walls([(list(outer[0]), False), (list(outer[1]), False)], zt=4.0, th=0.75, key="plaster", cop="gtex")
    n2 = K.walls([([(WX0, -64.0), (WX1, -64.0)], False)], zt=3.6, th=0.6, key="plaster", cop="gtex")
    stats["walls"] = n1 + n2
    mark("walls")
    # ---- paving: inside the walls, the forecourt -------------------------------------------------------------
    K.paved(rect(WX0, WX1, WY0, WY1))
    K.paved(rect(-40.0, 46.0, -116.0, WY0))
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = extra_materials("DY", K.materials("DY", glaze=GREY, glaze_tex=GREY_TEX, beam_glow=0.75))
    main = collection("东岳庙")
    parts = collection("构件", main)
    stats = dongyuemiao(parts, M)
    K.G.build("Temple", collection("庙", main), M, TILE)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=GREEN))
    K.FAR.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: the precinct with the forecourt (OSM's outline and the halls beyond it), and the 牌楼's square
    flat_marker(helpers, "temple", rect(-45.6, 48.3, -116.0, 116.0), "FOOTPRINT")
    px, py = K.L(3417.2, -1454.0)
    m = K.M_of(px, py, math.radians(1.0))
    flat_marker(helpers, "pailou", [tuple(m @ Vector((x, y, 0)))[:2] for x, y in rect(-12.4, 12.4, -8.0, 5.0)], "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "dongyuemiao", "东岳庙", "Dongyue Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 400
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
