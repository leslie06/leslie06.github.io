# 法源寺 Fayuan Temple on 法源寺前街 (西城, 宣南), Beijing's oldest Buddhist temple (founded 645 as 悯忠寺; the
# halls are Ming and Qing) and since 1956 the 中国佛学院, in Blender with the timber halls of hall.py and the
# courtyard pieces of gongwangfu.py (imported: halls, towers, walls, instances), marked with the bcity_landmark
# add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/fayuansi.py -- [--out art/landmarks/fayuansi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin at game (-2893, 2761) on the axis by the 悯忠台, heading -1.0
# (the halls' edges and the axis lean about a degree). OSM has the precinct (way 30834367, 104 x 251 m; its
# east third is the academy's houses, left to the city) and every hall on the axis by name: 山门, 钟楼, 鼓楼,
# 天王殿, 大雄宝殿, 悯忠阁, 毗卢殿, 观音殿 (the 大悲坛's place), 藏经阁; the side-hall ranges are its
# landuse=religious strips and the machine-learnt roofs in the tiles.
#
# South to north (six courts, the ground built up towards the back, here as rising platforms): the 山门, a
# three-bay gate hall with a side gate either side in the grey brick wall; the drum (west) and bell (east)
# towers, brick below, timber above, double-eaved 歇山; the 天王殿 (walked through); the 大雄宝殿 - five bays
# on a stone platform with a 月台, 歇山 in grey tiles edged with green glaze (灰筒瓦绿琉璃剪边), brackets, beasts;
# the 悯忠台, a raised brick terrace with the 观音阁 on it and old steles; the 毗卢殿; the 大悲坛 (OSM's 观音殿);
# the two-storey 藏经阁 across the back; side halls down both sides of every court; grey brick walls with tiled
# copings. The courts' old trees (lilacs, pines, gingkos) are the city's canopy trees: clear zones only where
# something stands.
#
# Sources: OSM; 维基百科 法源寺 (北京): faces south, ~240 x 75 m, six courts; 山门 with two side gates and a
# carved screen wall across the lane; bell and drum towers in the first court; 大雄宝殿 five bays with a
# three-bay porch; 悯忠台 with the Tang and Liao steles; 毗卢殿; 大悲坛; 藏经阁 two storeys, five bays; the
# ground raised from south to north. Doubtful: every height (OSM's are defaults), the 大雄宝殿's porch (not
# modelled), the green trim on the main halls only, the 悯忠台's size and height (1.6 m here) and its hall's
# roof, the side halls' extents (OSM's strips and learnt roofs disagree by a metre or two), the screen wall
# (not modelled: it stands across the lane).

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import Geo, flat_marker, rect  # noqa: E402
import gongwangfu as K  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "fayuansi.blend")
HEADING = -1.0
ANCHOR = (-2893.0, 2761.0)
PI2 = math.pi / 2
GREEN = "#3f7d4c"

# the wall (local metres): the south front on the 山门's line, the west side along OSM's precinct a metre in,
# the east side outside the side halls (the academy beyond it is the city's)
WALL = [(-43.9, -118.7), (37.3, -118.7), (37.3, -79.0), (30.2, -79.0), (30.2, 123.0), (-30.4, 123.0)]
CROSS = [[(-41.9, -65.4), (-6.6, -65.4)], [(7.4, -65.4), (30.2, -65.4)]]


def trimmed(h, trim=1.1):
    h.TRIM, h.RIDGE = trim, "trim"
    return h


def terrace(r, z, gap):
    """A raised brick-faced terrace with a stone edge and a low parapet, open over the stair at `gap` (x range)."""
    x0, x1, y0, y1 = r
    K.G.box(x0, x1, y0, y1, 0.0, z - 0.2, "brick", skip=("-z",))
    K.G.box(x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, z - 0.2, z, "marble", skip=("-z",))
    K.FAR.box(x0, x1, y0, y1, 0.0, z, "brick", skip=("-z",))
    K.COLL.append(("box", x0, x1, y0, y1, 0.0, z))
    t, hp = 0.35, 0.75
    runs = [((x0, y1 - t), (x1, y1)), ((x0, y0), (x0 + t, y1)), ((x1 - t, y0), (x1, y1)), ((x0, y0), (gap[0], y0 + t)), ((gap[1], y0), (x1, y0 + t))]
    for (a0, b0), (a1, b1) in runs:
        K.G.box(a0, a1, b0, b1, z, z + hp, "brick", skip=("-z",))
        K.G.box(a0 - 0.06, a1 + 0.06, b0 - 0.06, b1 + 0.06, z + hp, z + hp + 0.12, "grey", skip=())
        K.COLL.append(("box", a0, a1, b0, b1, z, z + hp + 0.12))
    K.BODIES.append((x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4))
    K.CLEARS.append(rect(x0 - 1.0, x1 + 1.0, y0 - 1.0, y1 + 1.0))


def flight(x0, x1, y_edge, z, dirn=-1):
    """Steps off an edge at y_edge down to -y (dirn -1) or +y; the WALK ramp with it."""
    g = Geo()
    ramp = K.steps(g, x0, x1, y_edge, dirn, 0.0, z)
    K.G.add(g, K.M_of(0, 0, 0))
    K.walk(K.M_of(0, 0, 0), ramp)


def stele(cx, cy, h=3.0, w=1.1, ang=0.0, z0=0.0):
    """A stele: a base block, the slab, its head."""
    m = K.T(cx, cy, z0) @ K.Rz(ang)
    g = Geo()
    g.box(-w * 0.75, w * 0.75, -w * 0.9, w * 0.9, 0.0, 0.7, "marble")
    g.box(-w / 2, w / 2, -0.16, 0.16, 0.7, 0.7 + h, "white")
    g.box(-w * 0.58, w * 0.58, -0.2, 0.2, 0.7 + h, 1.25 + h, "marble")
    K.G.add(g, m)
    K.COLL.append(("box", cx - w * 0.75, cx + w * 0.75, cy - w * 0.9, cy + w * 0.9, z0, z0 + 1.25 + h))


def fayuansi(z_mzt):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # the gate: a three-bay gate hall on the wall's line and a side gate either side
    K.simple_hall((-7.0, 2.8, -122.2, -115.3), "s", 4.4, passages=((-3.6, -0.6),), roof="xie", ov=1.2, door_bays=1, Hk=0.6, z0=0.45, tone="g")
    for cx in (-13.0, 8.8):
        K.simple_hall_at(cx, -118.7, 0.0, 2.3, 2.4, 3.4, roof="ying", tone="g", ov=1.0, z0=0.3, pas=((-0.9, 0.9),), door_bays=0)
    mark("shanmen")
    K.tower((-21.9, -14.3, -100.8, -93.6), K.tower_spec(3.7, 1.0, 4.0, 6.1, 8.4, 1.8), 0.45, 6.1, facing="e", tone="g", brick_ground=True)     # 鼓楼
    K.tower((13.3, 20.2, -99.4, -92.8), K.tower_spec(3.5, 1.0, 4.0, 6.1, 8.4, 1.7), 0.45, 6.1, facing="w", tone="g", brick_ground=True)      # 钟楼
    mark("towers")
    K.simple_hall((-6.4, 7.2, -69.9, -61.0), "s", 4.8, passages=((-1.1, 1.9),), roof="xie", ov=1.3, door_bays=1, Hk=0.6, z0=0.6, back=True, tone="g")  # 天王殿
    mark("tianwangdian")
    # 大雄宝殿 on its platform, the 月台 and steps before it
    base = 1.2
    h = trimmed(K.spec(7.85, 5.95, K.lin(7.85, 5), K.lin(5.95, 3), base + 4.7, 1.5, rows=7, end_rows=4, gap=1.6, Hk=0.6, big=False))
    nb = len(K.BRK)
    K.main_hall((-9.4, 9.3, -30.8, -15.9), h, base, False, front_doors=3, back_doors=1, beasts=5, back_steps=2.4, col_r=0.36, tone="g")
    for i in range(nb, len(K.BRK)):                 # the small hall's beams are 0.8 of a big one's: so are its brackets
        K.BRK[i] = K.BRK[i] @ Matrix.Diagonal((0.78, 0.78, 0.78, 1.0))
    K.platform((-6.6, 6.6, -36.0, -29.9), base - 0.1)
    flight(-2.2, 2.2, -36.0, base - 0.1)
    for sx in (-1, 1):
        K.G.box(sx * 4.6 - 0.5, sx * 4.6 + 0.5, -34.0, -33.0, base - 0.1, base + 0.9, "marble")      # incense burners' plinths
        K.G.box(sx * 4.6 - 0.35, sx * 4.6 + 0.35, -33.85, -33.15, base + 0.9, base + 1.9, "grey")
    mark("daxiongbaodian")
    # 悯忠台 and the 观音阁 on it; steles on the terrace
    terrace((-13.0, 12.5, -1.0, 18.0), z_mzt, (-2.6, 2.4))
    flight(-2.4, 2.2, -1.0, z_mzt)
    K.simple_hall_at(-0.15, 9.05, 0.0, 5.85, 3.45, z_mzt + 4.2, roof="xie", tone="g", ov=1.1, z0=z_mzt + 0.35, door_bays=3, Hk=0.6, clear=False)
    for x in (-9.6, -7.2, 7.0, 9.4):
        stele(x, 2.6, h=2.2, w=0.9, z0=z_mzt)
    mark("minzhongtai")
    K.simple_hall((-8.7, 6.4, 41.0, 51.6), "s", 5.0, roof="xie", ov=1.3, door_bays=3, Hk=0.6, z0=0.9, tone="g")       # 毗卢殿
    K.simple_hall((-13.5, 8.0, 68.8, 79.6), "s", 4.8, roof="xie", ov=1.3, door_bays=3, Hk=0.6, z0=0.9, tone="g")      # 大悲坛 (OSM 观音殿)
    K.simple_hall((-14.3, 12.2, 100.3, 113.1), "s", 8.6, roof="xie", ov=1.3, storeys=2, zm=4.5, door_bays=3, Hk=0.6, z0=0.9, tone="g")  # 藏经阁
    mark("back_halls")
    # side halls down both sides of each court, facing the axis
    for r, f in (((-41.6, -32.2, -116.0, -99.0), "e"), ((28.1, 36.1, -116.5, -81.8), "w"),
                 ((-27.3, -18.7, -59.5, -33.5), "e"), ((21.0, 29.4, -59.5, -33.5), "w"),
                 ((-28.5, -19.6, -12.5, 25.0), "e"), ((17.5, 27.0, -12.5, 26.0), "w"),
                 ((-20.9, -12.4, 34.0, 63.0), "e"), ((9.0, 15.8, 34.0, 64.0), "w"),
                 ((-28.4, -18.8, 81.0, 98.5), "e"), ((14.9, 24.0, 81.0, 98.5), "w")):
        K.simple_hall(r, f, 3.9, ov=1.0, door_bays=1, z0=0.45, tone="g")
    mark("side_halls")
    stats["walls"] = K.walls([(WALL, True)] + [(c, False) for c in CROSS], zt=3.6, th=0.7, key="brick", cop="gtex")
    mark("walls")
    K.paved([(-43.5, -118.3), (36.9, -118.3), (36.9, -79.4), (29.8, -79.4), (29.8, 122.6), (-30.0, 122.6)])
    K.paved(rect(-16.0, 12.0, -126.0, -118.4))
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = K.materials("FY", glaze=GREEN, beam_glow=0.75)
    M["trim"] = material("FY_GreenEdge", GREEN, 0.32, props={"wet": "surface", "glowStrength": 0.5})
    tile = dict(K.TILE, trim=2.0)
    main = collection("法源寺")
    parts = collection("构件", main)
    stats = fayuansi(1.6)
    K.G.build("Temple", collection("寺", main), M, tile)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=GREEN))
    K.FAR.build("Massing", collection("LOD1", main), M, tile)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: the temple's part of the precinct, out to OSM's west line, in a south and a north piece
    flat_marker(helpers, "south", [(-45.6, -124.5), (38.6, -124.5), (38.6, -77.0), (-42.6, -77.0)], "FOOTPRINT")
    flat_marker(helpers, "north", [(-42.6, -77.0), (31.2, -77.0), (31.2, 126.0), (-30.6, 126.0)], "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "fayuansi", "法源寺", "Fayuan Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 400
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
