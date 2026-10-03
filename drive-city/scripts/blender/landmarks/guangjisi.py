# 广济寺 Guangji Temple (弘慈广济寺) on 阜成门内大街 (西城), the seat of the Buddhist Association of China, a Ming
# plan of 1457 rebuilt after the fire of 1934; built in Blender with the timber halls of hall.py, the courtyard
# pieces of gongwangfu.py and the gates and tones of dongyuemiao.py (all imported), marked with the
# bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/guangjisi.py -- [--out art/landmarks/guangjisi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the axis at game (-2682.5, -1640) (in front of 大雄殿's
# 月台), heading +0.3. OSM has the precinct (way 233219116, landuse=religious: narrow at the street, widening
# behind) and two halls by name, 大雄殿 and 圆通殿 (ways 1178498883/2); the rest is placed from the machine-learnt
# roofs in the tiles (天王殿's west half, the side halls, the rear building's pieces) and the published layout.
#
# South to north (zh.wikipedia 广济寺 (北京市)):
#   山门       three gates joined by walls: the middle one yellow glazed 歇山 over a stone arch, the side ones
#              green glazed (the yellow trim is left out: the small roofs are textured), 敕建弘慈广济寺 on the board.
#   钟楼, 鼓楼 two storeys, in the first court either side of the axis.
#   天王殿     three bays, grey tiles, 歇山, stone-arched doors (a masonry hall here, passages through).
#   大雄殿     five bays, single-eaved 歇山 in yellow glaze, on a platform with a 月台 and the bronze 宝鼎 of 1793.
#   圆通殿     five bays (its tiles are not given: grey with green edges here).
#   多宝殿 / 舍利阁   the two-storey rear building: yellow-glazed skirt (多宝殿) under the green-roofed 舍利阁, with
#              two-storey wings along the north.
#   side halls (配殿) east and west of the courts, where the learnt roofs put them.
# Doubtful: where 天王殿 and the 钟鼓楼 stand (no OSM outlines; the courts are under trees in the imagery), the
# heights (大雄殿 ~15 m to the ridge), the rear building's length and the side halls; the west court with the
# 戒坛 and the east court (法器库, 延寿堂) are outside OSM's precinct and not built.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, save_and_export  # noqa: E402
from kit import Geo, flat_marker, rect  # noqa: E402
import hall  # noqa: E402
from hall import ring_beams, roofs, to_world, uvs  # noqa: E402
from kit import QUAD  # noqa: E402
import gongwangfu as K  # noqa: E402
import dongyuemiao as D  # noqa: E402

import bpy  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "guangjisi.blend")
HEADING = 0.3
ANCHOR = (-2682.5, -1640.0)


def louge(r, base_z=0.9, bays=7, beasts=3):
    """多宝殿 below, 舍利阁 above: a two-storey hall, the ground storey under a skirt roof of yellow glaze, the
    upper storey set back on the inner ring under a green 歇山 (zhihuasi.py's 万佛阁, made to any length)."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    A, Dp = (x1 - x0) / 2, (y1 - y0) / 2
    OX, OY = A - 2.0, Dp - 2.0
    IX, IY = OX - 1.35, OY - 1.35
    m = K.M_of(cx, cy, 0)
    h = SimpleNamespace(
        XS=[-OX] + K.lin(IX, bays) + [OX], YS=[-OY, -IY, 0.0, IY, OY], OX=OX, OY=OY, IX=IX, IY=IY,
        BEAM=(5.0, 5.6, 5.75, 6.4), UBEAM=(10.6, 11.15, 11.3, 11.95), OVERHANG=2.0,
        LOWER=dict(A=A, D=Dp, z=6.15, H=1.55, p=1.3, o=0.8, lift=0.7, Lc=4.0, Vc=2.0),
        UPPER=dict(A=IX + 1.9, D=IY + 1.9, z=11.65, H=0.62 * (IY + 1.9), p=1.55, o=0.8, lift=0.75, Lc=3.6, Vc=2.2),
        GABLE_X=max(0.6, IX + 1.9 - 0.55 * (IY + 1.9) - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="xieshan",
        ROWS=6, END_ROWS=4, LOWER_ROWS=4, BRACKET_GAP=1.6)
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
        K.HIPS.append(([m @ p for p in line], beasts))
    # the upper roof green, the skirt yellow: by height
    for i, (idx, u, k, sm) in enumerate(g.f):
        if k in ("tile", "trim") and sum(g.v[j][2] for j in idx) / len(idx) > zs + 0.3:
            g.f[i] = (idx, u, "grn", sm)
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
    K.far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.6, "grn")
    K.FAR.add(f, m)
    return h.UPPER["z"] + h.UPPER["H"]


# the precinct wall (local metres): OSM's outline half a metre in, the front on the gates' line
GATE_Y = -90.0
WALL = [(-14.5, GATE_Y), (-14.5, -67.5), (-23.6, -67.5), (-23.6, -7.5), (-40.5, -7.5), (-40.5, 75.2), (34.1, 75.2), (34.1, 49.4),
        (42.4, 49.4), (42.4, 1.0), (24.9, 1.0), (23.0, -65.3), (31.4, -65.3), (31.4, GATE_Y)]


def guangjisi(coll, M):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # ---- 山门: three gates joined by walls --------------------------------------------------------------
    gm = D.arch_gate(0.0, GATE_Y, 0.0, 5.0, 1.6, 5.2, [(0.0, 1.6, 3.0)], plaque=(3.4, 0.85), ov=1.2)        # yellow (the palette's glaze)
    for face in (-1, 1):
        D.plaque_text(coll, M, "寺济广慈弘建敕", gm, 0.0, face * 1.7, 5.2 - 0.75, 3.4, 0.85, face, f"GatePlaque{face:+d}")
    with D.toned(D.TO_GREEN):
        for x in (-10.9, 11.2):
            D.arch_gate(x, GATE_Y, 0.0, 2.6, 1.3, 4.0, [(0.0, 1.1, 2.3)], ov=0.9, Hk=0.6)
    K.simple_hall((24.0, 31.0, -86.0, -70.0), "w", 3.4, tone="g")
    mark("gates")
    # ---- 钟楼, 鼓楼, 天王殿 ------------------------------------------------------------------------------
    for r in ((-19.6, -12.4, -61.6, -54.4), (12.4, 19.6, -61.6, -54.4)):
        K.tower(r, K.tower_spec(3.6, 1.0, 4.2, 6.4, 9.0, 2.0), 0.45, 6.4, brick_ground=True, tone="g")
    with D.toned(D.TO_GREY):
        D.arch_gate(0.0, -37.5, 0.0, 7.6, 4.6, 6.2, [(-4.4, 1.0, 2.4), (0.0, 1.3, 2.8), (4.4, 1.0, 2.4)], z0=0.35, ov=1.6, Hk=0.62, roof_k=0.7)
    mark("tianwangdian")
    # ---- 大雄殿 on its platform, the 月台 and the 宝鼎; its side halls ------------------------------------------
    K.platform((-10.0, 10.0, 0.4, 9.5), 1.2)
    g = Geo()
    ramp = K.steps(g, -2.8, 2.8, 0.4, -1, 0.0, 1.2)
    K.G.add(g, D.I4)
    K.walk(D.I4, ramp)
    D.censer(0.0, 4.4, 1.25)
    hd = K.spec(11.4, 6.65, K.lin(11.4, 5), K.lin(6.65, 3), 1.5 + 6.2, 1.9, kind="xieshan", rows=7, end_rows=5, Hk=0.62, gap=1.8)
    K.main_hall((-13.1, 13.5, 8.3, 25.4), hd, 1.5, False, front_doors=3, back_doors=1, beasts=5, col_r=0.44)
    K.simple_hall((-23.4, -15.6, -28.0, -9.0), "e", 3.8, tone="g")
    K.simple_hall((14.8, 22.6, -28.0, -9.0), "w", 3.8, tone="g")
    mark("daxiongdian")
    # ---- 圆通殿 and the halls either side of the two halls -------------------------------------------------
    hy = D.trimmed(K.spec(9.95, 5.4, K.lin(9.95, 5), K.lin(5.4, 2), 1.0 + 5.4, 1.7, kind="xieshan", rows=6, end_rows=4, Hk=0.6, gap=1.7, big=False), 1.2)
    K.main_hall((-12.1, 11.2, 31.3, 45.5), hy, 1.0, False, front_doors=3, back_doors=1, beasts=3, front_steps=3.5, col_r=0.4, tone="g")
    K.simple_hall((-36.5, -25.0, 15.0, 42.0), "e", 4.0, tone="g", door_bays=3)
    K.simple_hall((25.0, 36.5, 15.0, 42.0), "w", 4.0, tone="g", door_bays=3)
    K.simple_hall((-38.5, -28.5, 47.5, 58.5), "e", 3.6, tone="g")
    K.simple_hall((19.0, 28.0, 47.5, 58.5), "w", 3.6, tone="g")
    mark("yuantongdian")
    # ---- 多宝殿 / 舍利阁 and its wings -----------------------------------------------------------------------
    stats["top"] = louge((-16.0, 16.0, 60.5, 74.0))
    K.simple_hall((-39.8, -16.6, 62.0, 74.2), "s", 7.0, storeys=2, zm=3.7, back=True, tone="g", z0=0.45)
    K.simple_hall((16.6, 33.4, 62.0, 74.2), "s", 7.0, storeys=2, zm=3.7, back=True, tone="g", z0=0.45)
    mark("duobaodian")
    # ---- walls and paving -----------------------------------------------------------------------------------
    stats["walls"] = K.walls([(WALL, True)], zt=4.0, th=0.75, key="plaster", cop="gtex")
    mark("walls")
    K.paved(rect(-14.1, 31.0, GATE_Y + 0.4, -67.1))
    K.paved(rect(-23.2, 22.6, -67.1, -7.1))
    K.paved(rect(-40.1, 42.0, -7.1, 49.0))
    K.paved(rect(-40.1, 33.7, 49.0, 74.8))
    K.paved(rect(-14.0, 31.0, -95.5, GATE_Y - 1.9))          # the apron to the pavement
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = D.extra_materials("GJ", K.materials("GJ", glaze=D.YELLOW, glaze_tex=D.YELLOW_TEX, beam_glow=0.75))
    main = collection("广济寺")
    parts = collection("构件", main)
    stats = guangjisi(parts, M)
    K.G.build("Temple", collection("寺", main), M, D.TILE)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=D.YELLOW))
    K.FAR.build("Massing", collection("LOD1", main), M, D.TILE)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: OSM's precinct in convex pieces (the apron to the pavement, not into the carriageway)
    flat_marker(helpers, "front", rect(-15.4, 31.6, -95.5, -66.6), "FOOTPRINT")
    flat_marker(helpers, "middle", rect(-24.4, 25.6, -67.6, -7.9), "FOOTPRINT")
    flat_marker(helpers, "rear", rect(-41.2, 43.4, -7.9, 49.6), "FOOTPRINT")
    flat_marker(helpers, "north", rect(-41.2, 35.0, 49.6, 76.6), "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "guangjisi", "广济寺", "Guangji Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 350
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
