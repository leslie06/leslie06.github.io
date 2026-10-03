# 智化寺 Zhihua Temple on 禄米仓胡同 (东城), the Ming temple of 1443 built by the eunuch 王振, in Blender with the
# timber halls of hall.py and the courtyard pieces of gongwangfu.py (imported: halls, walls, instances), marked
# with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/zhihuasi.py -- [--out art/landmarks/zhihuasi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the axis at game (2436, -840) (by 智化殿), heading -1.0
# (the halls' edges in OSM lean 0.3-1.7 degrees). OSM has the precinct (way 40542154, narrowing to the north in
# steps) and its halls (ways 528902242-528902245, 1368732103-1368732108): 山门, the drum and bell towers, 智化门,
# 智化殿 with its two side halls (大智殿 west, 藏殿 east), 万佛阁 and 大悲堂; the city drew them as small houses.
#
# Its mark is the roofs: black glazed tiles (黑琉璃瓦) on every hall. South to north: the 山门, a brick gate hall
# with an arched doorway set in the south wall; the 钟楼 and 鼓楼, brick lower storeys with arched doors, a skirt
# roof and a timber upper storey; 智化门 (three bays, 歇山, walked through); 智化殿 (three bays, 歇山 with tile
# rows, brackets and beasts, on a platform with steps); the side halls (歇山, textured); 如来殿 with 万佛阁 over it
# (five bays, two storeys: a skirt roof round the ground storey, the upper storey set back under a 庑殿 roof,
# about 16 m); two small halls in its court; 大悲堂 (硬山) at the back. The wall follows OSM's steps, kept a
# metre inside the lanes that run along both sides. Doubtful: 万佛阁's height and roof, the courtyard halls.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, save_and_export  # noqa: E402
from kit import QUAD, Geo, flat_marker, rect  # noqa: E402
import hall  # noqa: E402
from hall import ring_beams, roofs, to_world, uvs  # noqa: E402
import gongwangfu as K  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "zhihuasi.blend")
HEADING = -1.0
ANCHOR = (2436.0, -840.0)
BLACK, BLACK_TEX = "#2a2c2f", "#383b40"


def shanmen(r):
    """山门: a brick gate hall - an arched doorway through it, a stone arch ring, a beam band and a 歇山 roof."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    m = K.M_of(cx, cy, 0)
    g = Geo()
    ov = 1.0
    bx, by = hx - ov, hy - ov
    z0, zw = 0.4, 4.3
    K.base(g, bx, by, z0)
    aw, ah = 1.15, 2.4 + z0
    seg = 10
    arc = [(aw * math.cos(math.pi * k / seg), ah + aw * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
    for sy in (-1, 1):
        y = sy * by
        g.polyn([(-bx, y, z0), (-aw, y, z0), (-aw, y, ah), (-bx, y, ah)], "brick", (0, sy, 0))
        g.polyn([(aw, y, z0), (bx, y, z0), (bx, y, ah), (aw, y, ah)], "brick", (0, sy, 0))
        g.polyn([(-bx, y, ah), (-aw, y, ah), (-aw, y, zw), (-bx, y, zw)], "brick", (0, sy, 0))
        g.polyn([(aw, y, ah), (bx, y, ah), (bx, y, zw), (aw, y, zw)], "brick", (0, sy, 0))
        for (xa, za), (xb, zb) in zip(arc, arc[1:]):
            g.polyn([(xa, y, za), (xb, y, zb), (xb, y, zw), (xa, y, zw)], "brick", (0, sy, 0))
        # the stone arch ring, a little proud
        ring_in = [(x * 1.0, z) for x, z in arc]
        ring_out = [((aw + 0.35) * math.cos(math.pi * k / seg), ah + (aw + 0.35) * math.sin(math.pi * k / seg)) for k in range(seg + 1)]
        yy = y + sy * 0.06
        for k in range(seg):
            g.polyn([(ring_in[k][0], yy, ring_in[k][1]), (ring_in[k + 1][0], yy, ring_in[k + 1][1]),
                     (ring_out[k + 1][0], yy, ring_out[k + 1][1]), (ring_out[k][0], yy, ring_out[k][1])], "marble", (0, sy, 0))
        # a plaque over the arch
        g.box(-0.9, 0.9, y + (0 if sy > 0 else -0.08), y + (0.08 if sy > 0 else 0), ah + aw + 0.45, ah + aw + 1.05, "board")
    for (xa, za), (xb, zb) in zip(arc, arc[1:]):
        g.polyn([(xa, -by, za), (xb, -by, zb), (xb, by, zb), (xa, by, za)], "brick", (-(xa + xb) / 2, 0, -((za + zb) / 2 - ah)))
    for sx in (-1, 1):
        g.polyn([(sx * aw, -by, z0), (sx * aw, by, z0), (sx * aw, by, ah), (sx * aw, -by, ah)], "brick", (-sx, 0, 0))
        g.polyn([(sx * bx, -by, z0), (sx * bx, by, z0), (sx * bx, by, zw), (sx * bx, -by, zw)], "brick", (sx, 0, 0))
    # the door leaves folded back inside the passage
    for sx in (-1, 1):
        g.polyn([(sx * (aw - 0.05), -0.3, z0), (sx * (aw - 0.05), 0.3, z0), (sx * (aw - 0.05), 0.3, ah), (sx * (aw - 0.05), -0.3, ah)], "red", (-sx, 0, 0))
    K.beam_band(g, bx, by, zw, zw + 0.55)
    D, A = hy, hx
    U = dict(A=A, D=D, z=zw + 0.35, H=0.66 * D, p=1.5, o=0.5, lift=0.5, Lc=0.7 * D, Vc=0.42 * D)
    h = SimpleNamespace(XS=[-bx, bx], YS=[-by, by], OX=bx, OY=by, IX=bx, IY=by, BEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55), UBEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.55 * D - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3)
    K.FLAT["on"] = True
    K.roofs_k(h, g, 0.45)
    K.FLAT["on"] = False
    K.G.add(g, m)
    K.cbox(m, -bx, -aw, -by, by, 0.0, zw + 0.5)
    K.cbox(m, aw, bx, -by, by, 0.0, zw + 0.5)
    K.cbox(m, -aw, aw, -by, by, ah + aw * 0.6, zw + 0.5)
    K.body_rect(m, -bx - 0.45, bx + 0.45, -by - 0.45, by + 0.45)
    K.far_block(m, hx, hy, (-bx, bx, -by, by), zw, U["z"] + U["H"])


def wanfoge(r):
    """如来殿 and 万佛阁 over it: five bays, two storeys; a skirt roof round the ground storey, the upper storey set
    back on the inner ring under a 庑殿 roof; tile rows, brackets on both storeys, beasts on the hips."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    m = K.M_of(cx, cy, 0)
    base_z = 0.9
    h = SimpleNamespace(
        XS=[-8.3, -7.0, -4.2, -1.4, 1.4, 4.2, 7.0, 8.3], YS=[-6.2, -4.9, -1.6, 1.6, 4.9, 6.2], OX=8.3, OY=6.2, IX=7.0, IY=4.9,
        BEAM=(5.0, 5.6, 5.75, 6.4), UBEAM=(10.6, 11.15, 11.3, 11.95), OVERHANG=1.9,
        LOWER=dict(A=(x1 - x0) / 2, D=(y1 - y0) / 2, z=6.15, H=1.55, p=1.3, o=0.8, lift=0.7, Lc=5.0, Vc=2.4),
        UPPER=dict(A=8.9, D=6.8, z=11.65, H=4.3, p=1.55, o=0.9, lift=0.8, Lc=5.5, Vc=3.0),
        GABLE_X=4.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=7, END_ROWS=5, LOWER_ROWS=4, BRACKET_GAP=1.6)
    up0 = 7.95
    g = Geo()
    px, py = h.OX + 0.9, h.OY + 0.9
    g.box(-px, px, -py, py, 0.0, base_z, "marble", skip=("-z",))
    K.ring_walls(g, h, base_z, h.BEAM[0], True, front_doors=3, back_doors=1, inset=0.0)
    K.ring_walls(g, h, up0, h.UBEAM[0], False, front_doors=1, fill=("window", "window"))
    ring_beams(h, g, True, *h.BEAM)
    ring_beams(h, g, False, *h.UBEAM)
    zs = h.LOWER["z"] + h.LOWER["H"]
    for rot in range(4):                                      # the plank band between the skirt and the upper sill
        Dd, Uu = (h.IY, h.IX) if rot % 2 == 0 else (h.IX, h.IY)
        P = lambda u, z: to_world(rot, Dd, u, -0.02, z)          # noqa: E731
        g.polyn([P(-Uu, zs - 0.3), P(Uu, zs - 0.3), P(Uu, up0), P(-Uu, up0)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("plank", QUAD))
    K.columns_on(h, m, True, base_z, h.BEAM[0], 0.4)
    K.columns_on(h, m, False, up0 - 0.4, h.UBEAM[0], 0.36)
    K.brackets_on(h, m, True, h.BEAM[2], 0.85)
    K.brackets_on(h, m, False, h.UBEAM[2], 0.9)
    hips = roofs(h, g)
    for line in hips:
        K.HIPS.append(([m @ p for p in line], 5))
    ramp = K.steps(g, -3.0, 3.0, -py, -1, 0.0, base_z)
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


# the wall (local metres): OSM's steps, a metre inside the lanes on either side
WALL = [(-19.6, -68.7), (21.3, -68.7), (21.3, 7.7), (13.8, 7.7), (13.8, 44.6), (8.1, 44.6), (8.1, 72.7), (-9.6, 72.7),
        (-9.6, 45.2), (-12.6, 45.2), (-12.6, 27.4), (-16.6, 27.4), (-16.6, 8.9), (-19.6, 8.9)]


def zhihuasi():
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    shanmen((-3.2, 5.0, -71.4, -66.0))
    for r in ((14.7, 21.6, -62.1, -55.5), (-19.5, -12.6, -62.5, -55.9)):          # 钟楼, 鼓楼
        half = min(r[1] - r[0], r[3] - r[2]) / 2
        K.tower(r, K.tower_spec(half, 1.0, 4.0, 6.1, 8.6, 1.9), 0.45, 6.1, brick_ground=True, upper_fill=("window", "window"))
    mark("gate_towers")
    K.main_hall((-6.8, 7.3, -53.7, -42.7), K.spec(5.55, 3.9, K.lin(5.55, 3), K.lin(3.9, 2), 0.6 + 4.3, 1.5, rows=6, end_rows=3, Hk=0.62, gap=1.6, big=False),
                0.6, False, front_doors=3, back_doors=3, passage=True, beasts=3, front_steps=3.0, back_steps=3.0, col_r=0.34)       # 智化门
    mark("zhihuamen")
    K.simple_hall((-22.1, -12.7, -34.4, -19.4), "e", 4.4, roof="xie", ov=1.3, door_bays=1, Hk=0.6, z0=0.5)        # 大智殿
    K.simple_hall((12.9, 22.3, -33.7, -18.8), "w", 4.4, roof="xie", ov=1.3, door_bays=1, Hk=0.6, z0=0.5)          # 藏殿
    K.main_hall((-8.6, 8.2, -13.5, 1.9), K.spec(6.4, 5.7, K.lin(6.4, 3), K.lin(5.7, 3), 1.0 + 4.9, 2.0, rows=6, end_rows=4, Hk=0.62, gap=1.6),
                1.0, False, front_doors=3, back_doors=1, beasts=5, front_steps=4.0, back_steps=2.4, col_r=0.4)           # 智化殿
    mark("zhihuadian")
    K.simple_hall((-16.0, -10.0, 10.5, 24.0), "e", 3.6, ov=1.0, tone="g")
    K.simple_hall((7.6, 13.4, 10.5, 24.0), "w", 3.6, ov=1.0, tone="g")
    stats["top"] = wanfoge((-11.8, 9.2, 26.6, 43.3))
    mark("wanfoge")
    K.simple_hall((-8.8, 5.9, 60.7, 71.3), "s", 4.2, door_bays=3, z0=0.5)                                          # 大悲堂
    mark("dabeitang")
    stats["walls"] = K.walls([(WALL, True)], zt=3.8, th=0.7, cop="ytex")
    mark("walls")
    for poly in (rect(-19.25, 20.95, -68.35, 8.55), rect(-16.25, 13.45, 8.55, 44.25), rect(-9.25, 7.75, 44.25, 72.35)):
        K.paved(poly)
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = K.materials("ZH", glaze=BLACK, glaze_tex=BLACK_TEX, beam_glow=0.75)
    main = collection("智化寺")
    parts = collection("构件", main)
    stats = zhihuasi()
    K.G.build("Temple", collection("寺", main), M, K.TILE)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=BLACK))
    K.FAR.build("Massing", collection("LOD1", main), M, K.TILE)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: the precinct's three steps, out to OSM's outline (the city's generated walls along it go too)
    flat_marker(helpers, "south", rect(-24.0, 26.0, -75.5, 8.6), "FOOTPRINT")
    flat_marker(helpers, "middle", rect(-17.5, 15.0, 8.6, 45.2), "FOOTPRINT")
    flat_marker(helpers, "north", rect(-10.5, 9.0, 45.2, 73.4), "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "zhihuasi", "智化寺", "Zhihua Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 350
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
