# 日坛 (朝日坛) the Altar of the Sun in 日坛公园, built in Blender with ditan.py's altar pieces, marked with the
# bcity_landmark add-on's conventions. The city drew a three-storey block of flats on the altar (OSM way 1429665519,
# building=yes) inside OSM's round wall line (way 1551953951, barrier=wall).
#
#   blender -b -P scripts/blender/landmarks/ritan.py -- [--out art/landmarks/ritan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the round wall, game (3463.6,
# -628.0), heading -4.3 (the altar square's edges in the game's frame). The figures (维基百科 日坛; visitbeijing):
#   拜神台  one square tier of white stone, 16 m (五丈) and 1.89 m (五尺九寸) high, its top once red glazed tiles,
#           paved with square bricks since the Qing; nine white stone steps down each side; a white stone
#           balustrade round it
#   壝墙    round, OSM's line 83.5 m across, red, a green glazed coping (日坛's buildings are green-tiled)
#   棂星门  white stone, three openings (六柱三门) on the west, the main approach; one (两柱一门) east, south, north
# Doubtful: the coping's colour and the wall's height (2.6 m assumed), the steps' widths.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, panel_geo, place, post_geo  # noqa: E402
from ditan import GREEN, SIDE_M, TILE, add_colliders, brick_image, flights_round, gate_set, make_materials, square_rail, tier, wall_piece  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "ritan.blend")

ALTAR = (8.0, 0.0, 1.89)
FLIGHT_W = dict(W=5.6, E=4.4, S=4.4, N=4.4)
WALL = dict(r=41.75, h=2.2, t=0.8, gw=3.2, hl=3.4)
GATES = dict(W=3, E=1, S=1, N=1)
AXIS = dict(E=0.0, N=math.pi / 2, W=math.pi, S=-math.pi / 2)


def ring_wall(g, cols):
    """The round wall in chords of ~3 m between the gates; each gate's straight frame stands at the radius less
    half its sagitta, so its ends sit in the wall line. Returns the gates' (axis, frame radius, half width)."""
    r, t = WALL["r"], WALL["t"]
    pitch = WALL["gw"] + 1.24 + 1.8
    gates = []
    for side, n in GATES.items():
        hw = (n - 1) / 2 * pitch + WALL["gw"] / 2 + 0.62
        rg = r - (r - math.sqrt(r * r - hw * hw)) / 2
        gates.append((AXIS[side], rg, hw, side, n))
    # arcs between consecutive gates
    gates.sort(key=lambda x: x[0])
    segs = []
    for i, (a, rg, hw, _, _) in enumerate(gates):
        a2, rg2, hw2, _, _ = gates[(i + 1) % len(gates)]
        if a2 <= a:
            a2 += 2 * math.pi
        s0 = a + math.atan2(hw - 0.25, rg)
        s1 = a2 - math.atan2(hw2 - 0.25, rg2)
        n = max(1, round((s1 - s0) * r / 3.0))
        pts = [(r * math.cos(s0 + (s1 - s0) * k / n), r * math.sin(s0 + (s1 - s0) * k / n)) for k in range(n + 1)]
        # the run's ends on the gate frames' lines
        pts[0] = (rg * math.cos(a) - (hw - 0.25) * math.sin(a), rg * math.sin(a) + (hw - 0.25) * math.cos(a))
        pts[-1] = (rg2 * math.cos(a2) + (hw2 - 0.25) * math.sin(a2), rg2 * math.sin(a2) - (hw2 - 0.25) * math.cos(a2))
        for p, q in zip(pts, pts[1:]):
            wall_piece(g, p, q, WALL["h"], t, "tile")
            segs.append((p, q))
    # colliders: hulls over three chords at a time
    for j in range(0, len(segs), 3):
        chunk = segs[j:j + 3]
        pts = []
        for p, q in chunk:
            p, q = Vector((p[0], p[1], 0)), Vector((q[0], q[1], 0))
            d = (q - p).normalized()
            n = Vector((-d.y, d.x, 0)) * (t / 2)
            for c in (p + n, p - n, q + n, q - n):
                pts += [Vector((c.x, c.y, 0.0)), Vector((c.x, c.y, WALL["h"] + 0.4))]
        cols.append(("pts", pts))
    return gates, segs


def build():
    clear_file()
    ensure_addon()
    M = make_materials("RT", roof=GREEN, face="#e6e2d8", face_tex=False)
    M["top"] = material("RT_BrickTop", "#8f8e88", 0.85, tex=brick_image("RT_BrickTopTex", "#8e8d87"), props={"wet": "ground", "glowStrength": 0.5})
    tile = dict(TILE, top=4.0)
    main = collection("日坛")
    g = Geo()
    ramps, cols = [], []
    a, z0, z1 = ALTAR
    tier(g, a, z0, z1, face="glaze", top="top")
    flights_round(g, a, z1, z0, 9, FLIGHT_W, ramps, run=0.3)
    gates, segs = ring_wall(g, cols)
    for ang, rg, hw, side, n in gates:
        gate_set(g, cols, SIDE_M[side] @ T(0, -rg, 0), n, WALL["gw"], WALL["t"], WALL["hl"])
    # a paved way from each gate to the altar's steps
    for side, w in FLIGHT_W.items():
        m = SIDE_M[side]
        q = [m @ Vector(p) for p in ((-w / 2 - 0.5, -a - 0.15 - 2.7, 0.03), (w / 2 + 0.5, -a - 0.15 - 2.7, 0.03), (w / 2 + 0.5, -WALL["r"] + 0.6, 0.03), (-w / 2 - 0.5, -WALL["r"] + 0.6, 0.03))]
        g.polyn([tuple(p) for p in q], "ground", (0, 0, 1))
    g.build("Altar", collection("坛", main), M, tile)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(post=mesh_of(post_geo(), "PostMesh", M, tile), panel=mesh_of(panel_geo(), "PanelMesh", M, tile))
    square_rail(parts, mesh, a - 0.25, z1, FLIGHT_W, "Rail")

    far = Geo()
    far.box(-a, a, -a, a, 0.0, z1, "glaze", skip=("-z",))
    n = 32
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        P = lambda ang, z: (WALL["r"] * math.cos(ang), WALL["r"] * math.sin(ang), z)          # noqa: E731
        m_ = (a0 + a1) / 2
        far.polyn([P(a0, 0.0), P(a1, 0.0), P(a1, WALL["h"] + 0.4), P(a0, WALL["h"] + 0.4)], "plaster", (math.cos(m_), math.sin(m_), 0))
        far.polyn([P(a1, 0.0), P(a0, 0.0), P(a0, WALL["h"] + 0.4), P(a1, WALL["h"] + 0.4)], "plaster", (-math.cos(m_), -math.sin(m_), 0))
    far.build("Massing", collection("LOD1", main), M, tile)

    helpers = collection("碰撞体")
    collider_box(helpers, "altar", -a - 0.15, a + 0.15, -a - 0.15, a + 0.15, 0.0, z1)
    for i, pts in enumerate(ramps):
        collider_pts(helpers, f"flight{i}", [tuple(p) for p in pts], role="WALK")
    add_colliders(helpers, cols, "wall")
    R = WALL["r"] + 1.2
    circle = [(R * math.cos(2 * math.pi * k / 32), R * math.sin(2 * math.pi * k / 32)) for k in range(32)]
    flat_marker(helpers, "precinct", circle, "FOOTPRINT")
    Rc = WALL["r"] + 0.8
    flat_marker(helpers, "precinct_clear", [(Rc * math.cos(2 * math.pi * k / 32), Rc * math.sin(2 * math.pi * k / 32)) for k in range(32)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "ritan", "日坛", "Temple of the Sun"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 3463.6, -628.0, -4.3
    s.far_distance = 450
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
