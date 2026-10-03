# 月坛 (夕月坛) what stands of the Altar of the Moon in 月坛公园, built in Blender with ditan.py's materials and
# hall.py's roofs, marked with the bcity_landmark add-on's conventions. The altar itself (方四丈, white glazed tiles)
# was pulled down in the 1960s and a transmitter tower stands on its site, so this is the two buildings OSM
# outlines: the 钟楼 (way 606113402, drawn by the city as a small hipped pavilion) and the 北天门 (way 663760247,
# "北门", a grey block by 月坛北街).
#
#   blender -b -P scripts/blender/landmarks/yuetan.py -- [--out art/landmarks/yuetan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the bell tower's centre, game (-4419.65,
# -857.26), heading -4.0 (the tower's edges). The figures (维基百科 月坛; meet99):
#   钟楼    two storeys of red-plastered brick on a stone base, OSM's 13.8 m square, arched doors through it,
#           arched windows above, the painted beam band under the eave, a single 歇山 roof in green glaze
#   北天门  三座券门 22 m wide and 4.5 m deep: red walls on a stone plinth, three arched gateways (the middle
#           one widest, all open), a glazed cornice and a 庑殿 roof in green glaze; OSM's outline at (30.2, 29.3)
#           in this frame, turned 3.2 degrees further
# Doubtful: the tower's storey heights and its arches (from the descriptions, not drawings); whether the gate's
# roof is 庑殿 or 歇山.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, save_and_export  # noqa: E402
from kit import QUAD, Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, place  # noqa: E402
from hall import beast_geo, beasts_on, roofs, uvs  # noqa: E402
from ditan import GREEN, TILE, make_materials  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "yuetan.blend")

TW = 6.2                     # the tower's half width (body), on a base of 6.9
BASE = 0.6
S1, S2, TOP = 5.4, 9.4, 10.2  # first floor, top of the walls, top of the beam band
TOWER = SimpleNamespace(
    XS=[-TW, TW], YS=[-TW, TW], OX=TW, OY=TW, IX=TW - 1, IY=TW - 1,
    BEAM=(S2, S2 + 0.4, S2 + 0.5, TOP), UBEAM=(S2, S2 + 0.4, S2 + 0.5, TOP), OVERHANG=1.5, LOWER=None,
    UPPER=dict(A=TW + 1.5, D=TW + 1.5, z=TOP + 0.1, H=4.4, p=1.5, o=0.55, lift=0.6, Lc=3.8, Vc=2.4),
    GABLE_X=TW - 1.6, PITCH=0.44, AMP=0.08, TRIM=0.0, RIDGE="tile", ROWS=10, END_ROWS=6, BRACKET_GAP=1.4)
GATE_AT = (30.15, 29.3, math.radians(-3.2))
GW, GD, GH = 11.0, 2.25, 6.2      # the gate's half width, half depth, wall height
ARCHES = [(-7.0, 3.0, 4.3), (0.0, 3.6, 5.0), (7.0, 3.0, 4.3)]     # (x, width, crown)
GATE_ROOF = SimpleNamespace(
    XS=[-GW, GW], YS=[-GD, GD], OX=GW, OY=GD, IX=GW - 0.01, IY=GD - 0.01,
    BEAM=(GH, GH + 0.3, GH + 0.3, GH + 0.8), UBEAM=(GH, GH + 0.3, GH + 0.3, GH + 0.8), OVERHANG=1.2, LOWER=None,
    UPPER=dict(A=GW + 1.2, D=GD + 1.2, z=GH + 0.8, H=2.6, p=1.5, o=0.45, lift=0.5, Lc=2.8, Vc=1.5),
    GABLE_X=GW, PITCH=0.42, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=7, END_ROWS=4, BRACKET_GAP=1.2, WEN=0.6)


def arch_outline(x, w, crown, z0=0.0, n=12):
    """An arched opening's outline (x across, z up), anticlockwise from the bottom left: jambs and a semicircle."""
    r = w / 2
    spring = crown - r
    pts = [(x - r, z0), (x + r, z0)]
    pts += [(x + r * math.cos(math.pi * i / n), spring + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return pts


def holed_face(g, x0, x1, z0, z1, y, out, holes, key):
    """A wall face from x0 to x1 at y facing `out` (0, +-1, 0), with arched holes [(x, w, crown)] cut out of it,
    built as strips: plain piers between the holes, over each hole the spandrel above its arch."""
    xs = [x0]
    for x, w, c in sorted(holes):
        xs += [x - w / 2, x + w / 2]
    xs.append(x1)
    for i in range(0, len(xs), 2):
        a, b = xs[i], xs[i + 1]
        if b - a > 1e-3:
            g.polyn([(a, y, z0), (b, y, z0), (b, y, z1), (a, y, z1)], key, out)
    for x, w, c in holes:
        r = w / 2
        spring = c - r
        arc = [(x + r * math.cos(math.pi * i / 12), spring + r * math.sin(math.pi * i / 12)) for i in range(13)]
        # the spandrel: the arc (right to left) closed by the top edge
        g.polyn([(ax, y, az) for ax, az in arc] + [(x - r, y, z1), (x + r, y, z1)], key, out)
        # the jambs below the springing are the piers' edges; nothing else to fill


def vault(g, x, w, c, y0, y1, key, n=12):
    """The inside of an arched passage from y0 to y1: two jamb walls and the barrel."""
    r = w / 2
    spring = c - r
    for sx in (-1, 1):
        g.polyn([(x + sx * r, y0, 0.0), (x + sx * r, y1, 0.0), (x + sx * r, y1, spring), (x + sx * r, y0, spring)], key, (-sx, 0, 0))
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        p0 = (x + r * math.cos(a0), spring + r * math.sin(a0))
        p1 = (x + r * math.cos(a1), spring + r * math.sin(a1))
        mid = (a0 + a1) / 2
        g.polyn([(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])], key, (-math.cos(mid), 0, -math.sin(mid)))


def arch_trim(g, x, w, c, y, out, key="stone", band=0.3, z0=0.0):
    """A stone surround round an arch on a face (a ring of quads standing a few cm proud)."""
    r = w / 2
    spring = c - r
    d = out * 0.03
    pts_in = [(x + r * math.cos(math.pi * i / 12), spring + r * math.sin(math.pi * i / 12)) for i in range(13)]
    pts_out = [(x + (r + band) * math.cos(math.pi * i / 12), spring + (r + band) * math.sin(math.pi * i / 12)) for i in range(13)]
    for i in range(12):
        g.polyn([(pts_in[i][0], y + d, pts_in[i][1]), (pts_out[i][0], y + d, pts_out[i][1]), (pts_out[i + 1][0], y + d, pts_out[i + 1][1]), (pts_in[i + 1][0], y + d, pts_in[i + 1][1])], key, (0, out, 0))
    for sx in (-1, 1):
        xa, xb = sorted((x + sx * r, x + sx * (r + band)))
        g.polyn([(xa, y + d, z0), (xb, y + d, z0), (xb, y + d, spring), (xa, y + d, spring)], key, (0, out, 0))


def tower(g):
    """The bell tower: base, two storeys of red plaster with arches, the beam band, the 歇山 roof."""
    b = TW + 0.7
    g.box(-b, b, -b, b, 0.0, BASE, "stone", skip=("-z",))
    # through-passage south-north on the ground floor, a blind arch east and west; arched windows above
    door = (0.0, 2.8, BASE + 3.6)
    for rot in range(4):
        m = Rz(rot * math.pi / 2)
        f = Geo()
        holes = [door] if rot % 2 == 0 else []
        holed_face(f, -TW, TW, BASE, S2, -TW, (0, -1, 0), holes, "plaster")
        arch_trim(f, *door, -TW, -1, z0=BASE)
        if rot % 2 == 1:
            # a blind arch with a shut red door
            f.polyn([(x, -TW - 0.03, z) for x, z in arch_outline(0.0, 2.8, BASE + 3.6, BASE)], "red", (0, -1, 0))
        # the upper storey's three arched windows, shut with lattice
        for x in (-3.4, 0.0, 3.4):
            f.polyn([(xx, -TW - 0.03, z) for xx, z in arch_outline(x, 1.3, S1 + 2.4, S1 + 0.5)], "door", (0, -1, 0),
                    uvs=[((xx - x + 0.65) / 1.3, (z - S1 - 0.5) / 1.9) for xx, z in arch_outline(x, 1.3, S1 + 2.4, S1 + 0.5)])
            arch_trim(f, x, 1.3, S1 + 2.4, -TW, -1, band=0.18, z0=S1 + 0.5)
            f.box(x - 0.8, x + 0.8, -TW - 0.15, -TW, S1 + 0.38, S1 + 0.5, "stone", skip=("+y",))
        # a stone string course between the storeys
        f.box(-TW - 0.12, TW + 0.12, -TW - 0.12, -TW, S1 - 0.1, S1 + 0.15, "stone", skip=("+y",))
        g.add(f, m)
    for rot in (0, 2):
        vf = Geo()
        vault(vf, 0.0, 2.8, BASE + 3.6, -TW, TW, "plaster")
        g.add(vf, Rz(rot * math.pi / 2))
        break
    g.polyn([(-1.4, -TW, BASE), (1.4, -TW, BASE), (1.4, TW, BASE), (-1.4, TW, BASE)], "stone", (0, 0, 1))
    for sy in (-1, 1):
        for k, (d0, d1, z) in enumerate(((0.6, 0.3, 0.2), (0.3, 0.0, 0.4))):
            y0, y1 = sorted((sy * (b + d0), sy * (b + d1)))
            g.box(-1.6, 1.6, y0, y1, 0.0, z, "stone", skip=("-z",))
    # the painted beam band under the eave all round
    for rot in range(4):
        m = Rz(rot * math.pi / 2)
        f = Geo()
        f.polyn([(-TW - 0.15, -TW - 0.15, S2), (TW + 0.15, -TW - 0.15, S2), (TW + 0.15, -TW - 0.15, S2 + 0.45), (-TW - 0.15, -TW - 0.15, S2 + 0.45)], "atlas", (0, -1, 0), uvs=uvs("beam", QUAD))
        f.polyn([(-TW - 0.15, -TW - 0.15, S2 + 0.45), (TW + 0.15, -TW - 0.15, S2 + 0.45), (TW + 0.15, -TW - 0.15, TOP + 0.15), (-TW - 0.15, -TW - 0.15, TOP + 0.15)], "atlas", (0, -1, 0), uvs=uvs("plank", QUAD))
        f.polyn([(-TW - 0.15, -TW - 0.15, S2), (TW + 0.15, -TW - 0.15, S2), (TW, -TW, S2), (-TW, -TW, S2)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
        g.add(f, m)
    return roofs(TOWER, g)


def gate(g):
    """北天门 in its own frame (along x, the park to -y... the street side +y): plinth, red walls with three
    arched passages, a glazed cornice, the 庑殿 roof."""
    edges = [-GW - 0.3]
    for x, w, c in ARCHES:
        edges += [x - w / 2, x + w / 2]
    edges.append(GW + 0.3)
    for i in range(0, len(edges), 2):
        g.box(edges[i], edges[i + 1], -GD - 0.3, GD + 0.3, 0.0, 0.5, "stone", skip=("-z",))
    for side in (-1, 1):
        holed_face(g, -GW, GW, 0.5, GH, side * GD, (0, side, 0), [(x, w, c) for x, w, c in ARCHES], "plaster")
        for x, w, c in ARCHES:
            arch_trim(g, x, w, c, side * GD, side, z0=0.5)
    # the arches cut through the plinth too: their floors
    for x, w, c in ARCHES:
        vault(g, x, w, c, -GD, GD, "plaster")
        g.polyn([(x - w / 2, -GD - 0.3, 0.06), (x + w / 2, -GD - 0.3, 0.06), (x + w / 2, GD + 0.3, 0.06), (x - w / 2, GD + 0.3, 0.06)], "stone", (0, 0, 1))
    for sx in (-1, 1):
        g.polyn([(sx * GW, -GD, 0.5), (sx * GW, GD, 0.5), (sx * GW, GD, GH), (sx * GW, -GD, GH)], "plaster", (sx, 0, 0))
    # the glazed cornice: two corbelled courses in green, a yellow-green frieze between
    g.box(-GW - 0.1, GW + 0.1, -GD - 0.1, GD + 0.1, GH, GH + 0.3, "tile", skip=("-z",))
    g.box(-GW - 0.3, GW + 0.3, -GD - 0.3, GD + 0.3, GH + 0.3, GH + 0.8, "tile")
    return roofs(GATE_ROOF, g)


def build():
    clear_file()
    ensure_addon()
    M = make_materials("YT", roof=GREEN, face="#a8321f", face_tex=False)
    main = collection("月坛")
    g = Geo()
    hips_t = tower(g)
    gg = Geo()
    hips_g = gate(gg)
    mg = T(GATE_AT[0], GATE_AT[1], 0) @ Rz(GATE_AT[2])
    g.add(gg, mg)
    g.build("Buildings", collection("钟楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(beast=mesh_of(beast_geo(glaze=GREEN, lite=True), "BeastMesh", M, TILE), immortal=mesh_of(beast_geo(True, glaze=GREEN), "ImmortalMesh", M, TILE))
    for i, line in enumerate(hips_t):
        beasts_on(line, parts, mesh, f"Beast{i}", n=4)
    for i, line in enumerate(hips_g):
        beasts_on([mg @ p for p in line], parts, mesh, f"GBeast{i}", n=3)

    far = Geo()
    far.box(-TW, TW, -TW, TW, 0.0, TOP, "plaster", skip=("-z",))
    roofs(TOWER, far, lod=True)
    fg = Geo()
    fg.box(-GW, GW, -GD, GD, 0.0, GH + 0.8, "plaster", skip=("-z",))
    roofs(GATE_ROOF, fg, lod=True)
    far.add(fg, mg)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    b = TW + 0.7
    # the tower: the base and the walls either side of the passage (a person walks through it)
    collider_box(helpers, "base_w", -b, -1.4, -b, b, 0.0, BASE)
    collider_box(helpers, "base_e", 1.4, b, -b, b, 0.0, BASE)
    collider_box(helpers, "tower_w", -TW, -1.4, -TW, TW, 0.0, TOP + 2.0)
    collider_box(helpers, "tower_e", 1.4, TW, -TW, TW, 0.0, TOP + 2.0)
    collider_box(helpers, "tower_top", -1.4, 1.4, -TW, TW, BASE + 3.6, TOP + 2.0)
    collider_pts(helpers, "step_s", [(-1.4, -b - 0.6, 0.0), (1.4, -b - 0.6, 0.0), (-1.4, -TW, BASE), (1.4, -TW, BASE), (-1.4, -TW, 0.0), (1.4, -TW, 0.0)], role="WALK")
    collider_pts(helpers, "step_n", [(-1.4, b + 0.6, 0.0), (1.4, b + 0.6, 0.0), (-1.4, TW, BASE), (1.4, TW, BASE), (-1.4, TW, 0.0), (1.4, TW, 0.0)], role="WALK")
    collider_box(helpers, "passage", -1.4, 1.4, -TW, TW, 0.0, BASE)
    # the gate: piers between the passages, the walls over them (a car drives through the middle one)
    edges = [-GW - 0.3]
    for x, w, c in ARCHES:
        edges += [x - w / 2, x + w / 2]
    edges.append(GW + 0.3)
    for i in range(0, len(edges), 2):
        a, b_ = edges[i], edges[i + 1]
        collider_pts(helpers, f"gpier{i}", [tuple(mg @ Vector((x, y, z))) for x in (a, b_) for y in (-GD - 0.3, GD + 0.3) for z in (0.0, GH + 1.0)])
    for x, w, c in ARCHES:
        collider_pts(helpers, f"garch{x:+.0f}", [tuple(mg @ Vector((xx, y, z))) for xx in (x - w / 2, x + w / 2) for y in (-GD, GD) for z in (c - 0.6, GH + 1.0)])

    flat_marker(helpers, "tower", [(-b, -b), (b, -b), (b, b), (-b, b)], "FOOTPRINT")
    gp = [mg @ Vector((x, y, 0)) for x, y in ((-GW - 1.0, -GD - 2.6), (GW + 1.0, -GD - 2.6), (GW + 1.0, GD + 2.0), (-GW - 1.0, GD + 2.0))]
    flat_marker(helpers, "gate", [(p.x, p.y) for p in gp], "FOOTPRINT")
    gc = [mg @ Vector((x, y, 0)) for x, y in ((-GW - 0.8, -GD - 1.0), (GW + 0.8, -GD - 1.0), (GW + 0.8, GD + 1.0), (-GW - 0.8, GD + 1.0))]
    flat_marker(helpers, "gate_clear", [(p.x, p.y) for p in gc], "CLEAR")
    flat_marker(helpers, "tower_clear", [(-b - 1.5, -b - 1.5), (b + 1.5, -b - 1.5), (b + 1.5, b + 1.5), (-b - 1.5, b + 1.5)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "yuetan", "月坛钟楼", "Temple of the Moon Bell Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -4419.65, -857.26, -4.0
    s.far_distance = 400
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
