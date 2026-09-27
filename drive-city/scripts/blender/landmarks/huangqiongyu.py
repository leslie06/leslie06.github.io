# 天坛皇穹宇 Imperial Vault of Heaven, built in Blender with round.py and hall.py, marked with the bcity_landmark
# add-on's conventions. It replaces the kit-built huangqiongyu.ts.
#
#   blender -b -P scripts/blender/landmarks/huangqiongyu.py -- [--out art/landmarks/huangqiongyu.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the old anchor (39.877144 N, 116.406922 E,
# heading -1.53), the hall's centre.
#
# The figures (OSM ways 43921117-43921123 and the old model): the small round hall, eight bays of lattice
# between red columns, painted beams and brackets, a single conical eave of deep blue glaze under a gilt
# finial, 19 m; its round marble terrace (2.3 m) with a balustrade and flights south, east and west; the
# Echo Wall (回音壁) round the court, 65 m across, grey brick with a blue glazed coping, opened on the south
# by the three-door glazed gate; the two five-bay side halls facing the court under blue 歇山 roofs.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, collider_pts, coping, cyl, flat_marker, mesh_of, panel_geo, paving, place, post_geo  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, to_world, uvs)
from round import finial, round_eave, round_flights, round_roof, round_storey, round_tiers, ring_pts  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "huangqiongyu.blend")

TIER = (11.2, 0.0, 2.3)
FLIGHTS = {"S": (6.5, 2.2), "E": (3.0, 0.0), "W": (3.0, 0.0)}
OFF = math.radians(22.5)
S1 = dict(r=6.9, z0=2.3, z1=7.6, beam=(7.6, 8.3, 8.5), top=9.4)
R1 = dict(r0=10.0, z=8.9, r1=0.0, H=8.0, p=1.45, lift=0.35, Vl=2.0)
WALL = dict(cy=-19.9, r=32.6, h=3.7, t=0.9, gate=10.2)
SIDE = SimpleNamespace(
    XS=[-7.2 + 2.88 * i for i in range(6)], YS=[-2.3, 2.3], OX=7.2, OY=2.3, IX=7.2, IY=2.3,
    BEAM=(4.5, 4.95, 5.05, 5.55), UBEAM=(4.5, 4.95, 5.05, 5.55), OVERHANG=1.3, LOWER=None,
    UPPER=dict(A=8.5, D=3.6, z=5.2, H=2.8, p=1.5, o=0.5, lift=0.45, Lc=3.5, Vc=2.2),
    GABLE_X=5.9, PITCH=0.42, AMP=0.08, TRIM=0.0, RIDGE="tile", ROWS=6, END_ROWS=4, BRACKET_GAP=2.4)
SIDE_BASE = 0.9
SIDE_AT = [(19.0, -24.9, 1), (-18.5, -26.0, -1)]         # (x, y, east or west): each faces the court


def brick_image(size=512):
    """Grey brick in running bond, 4 m a repeat."""
    cv = Canvas(size, size, "#80837f")
    rng = np.random.default_rng(7)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    col = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.88, 1.08, (40, 12))[row % 40, col % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.6) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.6), "#a5a7a2")
    return image("HQ_Brick", np.flipud(cv.a).copy())


def materials():
    atlas, night = paint_atlas("HQ", portrait=False, emblem=False)
    return dict(
        atlas=material("HQ_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        marble=material("HQ_Marble", "#e9e5dc", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("HQ_Paving", "#b3aea3", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        relief=material("HQ_Relief", "#efebe2", 0.5, props={"wet": "damp", "glowStrength": 0.5}),
        tile=material("HQ_Tile", "#23418f", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        red=material("HQ_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        plaster=material("HQ_Plaster", "#a8321f", 0.85, tex=plaster(name="HQ_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        brick=material("HQ_Brick", "#80837f", 0.9, tex=brick_image(), props={"wet": "damp", "glowStrength": 0.6}),
        gold=material("HQ_Gold", "#e0b04a", 0.25, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.5}),
        paint=material("HQ_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material("HQ_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
    )


TILE = dict(marble=2.0, paving=4.0, tile=2.0, red=2.0, gold=1.0, paint=1.0, plaster=4.0, brick=4.0, dark=1.0, relief=1.0)


def wall_segments():
    """The Echo Wall's segments: (angle0, angle1) round the circle, open at the south for the gate."""
    n = 96
    gap = WALL["gate"] / WALL["r"]
    out = []
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        if abs((a0 + a1) / 2 - 3 * math.pi / 2) < gap:
            continue
        out.append((a0, a1))
    return out


def echo_wall(g):
    r, h, t, cy = WALL["r"], WALL["h"], WALL["t"], WALL["cy"]
    for a0, a1 in wall_segments():
        P = lambda a, rr, z: (rr * math.cos(a), cy + rr * math.sin(a), z)          # noqa: E731
        m = (a0 + a1) / 2
        for rr, sgn in ((r + t / 2, 1), (r - t / 2, -1)):
            L = (a1 - a0) * rr
            g.polyn([P(a0, rr, 0.0), P(a1, rr, 0.0), P(a1, rr, h), P(a0, rr, h)], "brick", (sgn * math.cos(m), sgn * math.sin(m), 0),
                    uvs=[(a0 * rr / 4, 0), (a0 * rr / 4 + L / 4, 0), (a0 * rr / 4 + L / 4, h / 4), (a0 * rr / 4, h / 4)])
        coping(g, (r * math.cos(a0), cy + r * math.sin(a0)), (r * math.cos(a1), cy + r * math.sin(a1)), t + 0.5, h, rise=0.45, key="tile")


def gate(g):
    """琉璃门: a red wall with three arched doors under a blue glazed coping, across the Echo Wall's opening."""
    y = WALL["cy"] - WALL["r"]
    hw, t, h = 9.6, 1.4, 4.6
    doors = [(-5.2, 2.2, 3.4), (0.0, 2.6, 3.8), (5.2, 2.2, 3.4)]
    for f in (-1, 1):
        yy = y + f * t / 2
        x0 = -hw
        for x, w, c in doors:
            g.polyn([(x0, yy, 0.0), (x - w / 2, yy, 0.0), (x - w / 2, yy, h), (x0, yy, h)], "plaster", (0, f, 0))
            arc = [(x + w / 2 * math.cos(math.pi * i / 10), c - w / 2 + w / 2 * math.sin(math.pi * i / 10)) for i in range(11)]
            g.polyn([(ax, yy, az) for ax, az in arc] + [(x - w / 2, yy, h), (x + w / 2, yy, h)], "plaster", (0, f, 0))
            x0 = x + w / 2
        g.polyn([(x0, yy, 0.0), (hw, yy, 0.0), (hw, yy, h), (x0, yy, h)], "plaster", (0, f, 0))
    for x, w, c in doors:
        # the doors, shut, a little way in
        g.polyn([(x - w / 2, y + 0.2, 0.0), (x + w / 2, y + 0.2, 0.0), (x + w / 2, y + 0.2, c), (x - w / 2, y + 0.2, c)], "atlas", (0, -1, 0), uvs=uvs("gatedoor", QUAD))
        g.polyn([(x - w / 2, y + 0.21, 0.0), (x + w / 2, y + 0.21, 0.0), (x + w / 2, y + 0.21, c), (x - w / 2, y + 0.21, c)], "atlas", (0, 1, 0), uvs=uvs("gatedoor", QUAD))
    for sx in (-1, 1):
        g.polyn([(sx * hw, y - t / 2, 0.0), (sx * hw, y + t / 2, 0.0), (sx * hw, y + t / 2, h), (sx * hw, y - t / 2, h)], "plaster", (sx, 0, 0))
    g.box(-hw - 0.3, hw + 0.3, y - t / 2 - 0.3, y + t / 2 + 0.3, h, h + 0.35, "atlas", uvs={k: uvs("beam", ((0, 0), (1, 0), (1, 1), (0, 1))) for k in ("-y", "+y")})
    coping(g, (-hw - 0.6, y), (hw + 0.6, y), t + 1.4, h + 0.35, rise=1.2, key="tile")
    g.box(-hw - 0.5, hw + 0.5, y - t / 2 - 0.2, y + t / 2 + 0.2, 0.0, 0.4, "marble", skip=("-z",))


def side_hall(g):
    """In its own frame: along x, the court side to -y."""
    H, z0 = SIDE, SIDE_BASE
    g.box(-H.OX - 1.4, H.OX + 1.4, -H.OY - 1.4, H.OY + 1.4, 0.0, z0, "marble", skip=("-z",))
    for rot, D, us in ring_sides(H, True):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.3, z)          # noqa: E731
            quad = [P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if rot == 0:
                g.polyn(quad, "atlas", cdir(rot, 0, -1), uvs=uvs("door" if i == 2 else "window", QUAD))
            else:
                g.polyn(quad, "plaster", cdir(rot, 0, -1))
    ring_beams(H, g, True, *H.BEAM)
    return roofs(H, g)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("皇穹宇")
    g = Geo()
    round_tiers(g, [TIER], segs=72)
    ramps = round_flights(g, [TIER], FLIGHTS)
    round_storey(g, S1["r"], 8, S1["z0"], S1["z1"], S1["beam"], "window", doors={6}, off=OFF)
    round_roof(g, R1, rows=12, pitch=0.46, amp=0.09, spp=3)
    round_eave(g, R1, S1["r"] + 0.45, S1["top"] + 0.05)
    finial(g, R1["z"] + R1["H"] - 0.1, 2.2, r=0.45)
    echo_wall(g)
    gate(g)
    # the court's paving between the hall and the gate
    g.polyn([(-2.5, -11.0, 0.03), (2.5, -11.0, 0.03), (2.5, WALL["cy"] - WALL["r"] + 1.0, 0.03), (-2.5, WALL["cy"] - WALL["r"] + 1.0, 0.03)], "paving", (0, 0, 1))
    sg = Geo()
    ships = side_hall(sg)
    side_m = []
    for x, y, e in SIDE_AT:
        m = T(x, y, 0) @ Rz(-e * math.pi / 2)            # the east hall's court side (-y in its frame) to -x
        side_m.append(m)
        g.add(sg, m)
    g.build("Vault", collection("殿", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(
        column=mesh_of(column_geo(S1["beam"][0] - S1["z0"], r=0.36), "Column", M, TILE),
        scol=mesh_of(column_geo(SIDE.BEAM[0] - SIDE_BASE, r=0.25), "SideColumn", M, TILE),
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze="#23418f"), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze="#23418f"), "ImmortalMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )
    for k in range(8):
        a = OFF + 2 * math.pi * k / 8
        place(mesh["column"], f"Column.{k}", parts, T((S1["r"] + 0.15) * math.cos(a), (S1["r"] + 0.15) * math.sin(a), S1["z0"]))
    n = round(2 * math.pi * S1["r"] / 1.3)
    for k in range(n):
        a = 2 * math.pi * (k + 0.5) / n
        place(mesh["bracket"], f"Bracket.{k:03d}", parts, T(S1["r"] * math.cos(a), S1["r"] * math.sin(a), S1["beam"][2]) @ Rz(a + math.pi / 2))
    r = TIER[0]
    skip = [(-4.0, 4.0, -r - 2, -r + 3), (r - 3, r + 2, -2.2, 2.2), (-r - 2, -r + 3, -2.2, 2.2)]
    balustrade(parts, mesh, ring_pts(r - 0.35, TIER[2], 64), "Rail", gap=1.6, skip=skip)
    k = 0
    for m in side_m:
        for rot, D, us in ring_sides(SIDE, True):
            for u in us[1:]:
                place(mesh["scol"], f"SideColumn.{k:03d}", parts, m @ T(*to_world(rot, D, u, 0, SIDE_BASE)))
                k += 1
        for i, (p, yaw) in enumerate(bracket_spots(SIDE, True, SIDE.BEAM[2])):
            place(mesh["bracket"], f"SideBracket.{k:03d}.{i}", parts, m @ T(*p) @ Rz(yaw))
        for i, line in enumerate(ships):
            beasts_on([m @ p for p in line], parts, mesh, f"Beast{k}.{i}", n=3)

    far = Geo()
    cyl(far, 0, 0, 0.0, TIER[2], r, r, 24, "marble", caps=(False, True))
    cyl(far, 0, 0, TIER[2], S1["top"], S1["r"], S1["r"], 12, "red", caps=(False, False))
    round_roof(far, R1, rows=3, waves=False, segs=12)
    for a0, a1 in wall_segments()[::4]:
        a1 = a0 + 4 * (a1 - a0)
        P = lambda a, rr, z: (rr * math.cos(a), WALL["cy"] + rr * math.sin(a), z)       # noqa: E731
        far.polyn([P(a0, WALL["r"], 0.0), P(a1, WALL["r"], 0.0), P(a1, WALL["r"], WALL["h"] + 0.4), P(a0, WALL["r"], WALL["h"] + 0.4)], "brick", (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0))
    fs = Geo()
    fs.box(-SIDE.OX, SIDE.OX, -SIDE.OY, SIDE.OY, 0.0, SIDE.UPPER["z"], "plaster", skip=("-z",))
    roofs(SIDE, fs, lod=True)
    for m in side_m:
        far.add(fs, m)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    prism = lambda rr, z1, n=24: [(rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n), z) for i in range(n) for z in (0.0, z1)]   # noqa: E731
    collider_pts(helpers, "terrace", prism(r, TIER[2]))
    collider_pts(helpers, "hall", prism(S1["r"] + 0.5, 16.0, 12))
    for i, (side, w, r_top, r_foot, z_top, z_foot, (c, s)) in enumerate(ramps):
        P = lambda along, x, z: (c * along - s * x, s * along + c * x, z)       # noqa: E731
        collider_pts(helpers, f"flight{i}", [P(r_top, -w / 2, z_top), P(r_top, w / 2, z_top), P(r_foot, -w / 2, z_foot), P(r_foot, w / 2, z_foot), P(r_top, -w / 2, z_foot), P(r_top, w / 2, z_foot)], role="WALK")
    segs = wall_segments()
    for j in range(0, len(segs), 4):
        a0, a1 = segs[j][0], segs[min(j + 3, len(segs) - 1)][1]
        pts = []
        for a in (a0, a1):
            for rr in (WALL["r"] - WALL["t"] / 2, WALL["r"] + WALL["t"] / 2):
                for z in (0.0, WALL["h"]):
                    pts.append((rr * math.cos(a), WALL["cy"] + rr * math.sin(a), z))
        collider_pts(helpers, f"wall{j}", pts)
    y = WALL["cy"] - WALL["r"]
    for x0, x1, top in ((-9.6, -6.3, 4.6), (-4.1, -1.3, 4.6), (1.3, 4.1, 4.6), (6.3, 9.6, 4.6)):
        collider_box(helpers, "gatepier", x0, x1, y - 0.7, y + 0.7, 0.0, top)
    for x, yy, e in SIDE_AT:
        collider_box(helpers, "side", x - SIDE.OY - 1.4, x + SIDE.OY + 1.4, yy - SIDE.OX - 1.4, yy + SIDE.OX + 1.4, 0.0, 6.0)
    fp = [((WALL["r"] + 1.0) * math.cos(2 * math.pi * i / 32), WALL["cy"] + (WALL["r"] + 1.0) * math.sin(2 * math.pi * i / 32)) for i in range(32)]
    flat_marker(helpers, "huangqiongyu", fp, "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "huangqiongyu", "天坛皇穹宇", "Imperial Vault of Heaven"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.877144", "116.406922", -1.53
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
