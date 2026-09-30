# 北京西站 Beijing West Railway Station (1996), the north building on 莲花池东路 with the waiting hall over the
# tracks and the south building as massing, built in Blender with hall.py's roofs and brackets and the kit's facade
# shader for its windows (tower.py), marked with the bcity_landmark add-on's conventions. OSM has the whole station
# as one outline (way 30680817, 856 x 350 m, building=train_station) which the city never drew: the departure deck
# (the elevated service road along the front) passes over it, so the tiles cut it (build.mjs, `deckOver`).
#
#   blender -b -P scripts/blender/landmarks/west_station.py -- [--out art/landmarks/weststation.blend] [--export]
#
# The sign needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north (the front faces 莲花池东路), metres, origin on the ground at game
# (-7040.95, 1560), heading 0: OSM's outline runs exactly along the game's axes. x = game x + 7040.95,
# y = 1560 - game z. The plan is OSM's steps, west to east (the seven sections of the design: annex, wing,
# 亭楼, main building, 亭楼, wing, annex):
#   the gate frame        x +-30.75 (OSM's centre projection, 61.5 m), front y 43; the opening 43.8 m wide and 50 m
#                         high, the beam over it to 62 m, on it the pavilion (门楼): a 27 m square base, three eaves,
#                         its gilt finial 102 m up (published figures).
#   the main building     x -170.65..174.95, y -37.5..10 (OSM's front is y 14-16; it stands back to 10 because the
#                         city's departure deck runs along it at 6.5 m, y 16.5-21.5, and through the gate between the
#                         piers, which are open under it); 15 storeys (52 m) either side of the gate, where the four
#                         corner pavilions stand, stepping down to 34 m; the hall behind the opening is 24 m, so the
#                         sky shows through the gate.
#   the wings             24 m, green-glazed eaves; the west one stands on columns over the service road OSM runs
#                         through it (y -18.5).
#   the 亭楼              33 m wide blocks at x -344..-311 and 358..392, 42 m with a smaller gate and a pavilion,
#                         a low block in front of each to OSM's line (y 69).
#   the annexes           20 m, plain.
#   the waiting hall      over the tracks, x -82..84, y -253..-38, 9-22 m up on columns (the service road at y -52
#                         passes under it).
#   the south building    x -179.5..167.35, y -279.6..-253: 30 m in the middle (201 m), 18 m at the ends.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, flat_marker, mesh_of, panel_geo, place, post_geo, rect  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, eave_edge, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roof_face, roofs, sweep, to_world, uvs)
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "weststation.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ = -7040.95, 1560.0

GATE = dict(hw=30.75, ow=21.9, y0=10.0, y1=43.0, ylow=23.5, zlow=13.0, zopen=50.0, ztop=62.0)
MAIN = dict(x0=-170.65, x1=174.95, y0=-37.5, y1=10.0, h=34.0)
TALL = dict(x=62.0, h=52.0)
CORE_H = 24.0
PIL = dict(z=5.0, yb=-27.0)                               # the west wing on columns: open under 5 m, the back wall 8.5 m behind the road (y -18.5)
WINGS = [dict(x0=-310.75, x1=-170.65, y0=-37.5, y1=-10.5, h=24.0, pilotis=True),
         dict(x0=174.95, x1=358.35, y0=-37.5, y1=-16.25, h=24.0, pilotis=False)]
TING = [dict(x0=-344.05, x1=-310.75, yf=68.6), dict(x0=358.35, x1=391.55, yf=69.8)]
TING_Y, TING_H, TING_LOW = 12.0, 42.0, 12.0
ANNEX = [dict(x0=-422.0, x1=-344.05, y0=-37.5, y1=-16.1), dict(x0=-422.0, x1=-372.15, y0=-16.1, y1=36.4),
         dict(x0=391.55, x1=434.05, y0=-38.2, y1=-14.5)]
ANNEX_H = 20.0
HALL = dict(x0=-82.0, x1=84.25, y0=-253.0, y1=-37.5, z0=9.0, h=22.0)
SOUTH = dict(x0=-179.5, x1=167.35, y0=-279.6, y1=-253.0, cx=100.5, hc=30.0, h=18.0)
DECK_Y = (16.5, 21.5)          # the city's departure deck (6.5 m up), for the canopy
ROADS_X = (-300.05, -183.55)   # service roads entering under the west wing


def pav_spec(r_out, r_in, col, s=1.0):
    """A two-storey pavilion with double 攒尖 roofs of green glaze, its floor at z 0 (station.py's, all green)."""
    bz = col
    up0 = bz + 2.0 * s
    ub = up0 + 1.5 * s
    return SimpleNamespace(
        XS=[-r_out, -r_in, 0.0, r_in, r_out], YS=[-r_out, -r_in, 0.0, r_in, r_out], OX=r_out, OY=r_out, IX=r_in, IY=r_in,
        BEAM=(bz, bz + 0.5 * s, bz + 0.62 * s, bz + 1.1 * s), UBEAM=(ub, ub + 0.45 * s, ub + 0.55 * s, ub + 1.0 * s), OVERHANG=1.6 * s,
        LOWER=dict(A=r_out + 1.6 * s, D=r_out + 1.6 * s, z=bz + 0.8 * s, H=1.5 * s, p=1.3, o=0.5, lift=0.45, Lc=3.0, Vc=2.0),
        UPPER=dict(A=r_in + 1.5 * s, D=r_in + 1.5 * s, z=ub + 0.75 * s, H=4.2 * s, p=1.6, o=0.5, lift=0.5, Lc=3.0, Vc=2.0),
        GABLE_X=1.0, PITCH=0.36, AMP=0.07, TRIM=0.0, RIDGE="trim", KIND="cuanjian", ROWS=5, LOWER_ROWS=3, BRACKET_GAP=1.6,
        Z0=0.0, UP0=up0)


UNIT = pav_spec(5.0, 3.4, 3.2, 1.1)
UNIT_TOP = UNIT.UPPER["z"] + UNIT.UPPER["H"]         # the pyramid's apex over the unit's floor (the finial adds 2.6)
UNIT_EAVE = UNIT.LOWER["A"]
CENTRE_K, CENTRE_Z = 1.75, 75.5                     # the gate's pavilion: the unit x1.75 on its base block
CORNER_K, TING_K = 1.0, 1.2
CORNERS = [(sx * 50.0, y) for sx in (-1, 1) for y in (0.5, -27.0)]


def stone_image(size=512):
    """Pale stone cladding in big panels, 3 m a panel (6 m a repeat)."""
    cv = Canvas(size, size, "#e6dfd0")
    cv.noise(0.05, 51)
    q = size / 2
    joint = (np.mod(cv.y, q / 2) < 1.6) | (np.mod(cv.x, q) < 1.6)
    cv.put(joint, "#c9c0ae")
    return image("WS_Stone", np.flipud(cv.a).copy())


def eave_image(size=256):
    """Green glazed tiles for the blocks' eaves: four tube rows across (u), six courses down the slope (v)."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.62 + 0.38 * np.cos(np.pi * ((u * 4) % 1 - 0.5)) ** 2
    course = 1 - 0.18 * (((v * 6) % 1) < 0.07)
    return image("WS_Eave", srgb_arr("#2f7a55") * (ridge * course)[..., None])


def srgb_arr(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def materials():
    atlas, night = paint_atlas("WS", portrait=False, emblem=False)
    return dict(
        atlas=material("WS_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("WS_Plaster", "#a3301f", 0.85, tex=plaster(name="WS_PlasterTex", col="#a3301f"), props={"wet": "damp", "glowStrength": 0.6}),
        stone=material("WS_Stone", "#e6dfd0", 0.7, tex=stone_image(), props={"wet": "damp", "glowStrength": 0.55}),
        granite=material("WS_Granite", "#8f8a82", 0.75, props={"wet": "ground", "glowStrength": 0.5}),
        windows=facade("WS_Windows", dict(floorH=3.5, colW=2.6, glass="#34434e", frame="#e4ddce", spandrel="#dcd4c3", mull=0.26, slab=0.38, metal=0.55, rough=0.15, lit=0.5, coolShare=0.35, seed=31)),
        glass=facade("WS_Glass", dict(floorH=4.2, colW=2.0, glass="#44545f", frame="#cfc8b8", mull=0.06, slab=0.07, metal=0.7, rough=0.1, lit=0.85, coolShare=0.1, seed=32)),
        eave=material("WS_Eave", "#2f7a55", 0.35, tex=eave_image(), props={"wet": "surface", "glowStrength": 0.5}),
        tile=material("WS_Tile", "#2f7a55", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("WS_Ridge", "#25624a", 0.35, props={"wet": "surface", "glowStrength": 0.5}),
        roof=material("WS_Roof", "#77736b", 0.85, props={"wet": "ground", "glow": "none"}),
        red=material("WS_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("WS_Gold", "#e0b04a", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.8}),
        letters=material("WS_Letters", "#b8241b", 0.4, props={"glow": "lamp", "glowColor": [1.0, 0.25, 0.15], "glowStrength": 0.6}),
        paint=material("WS_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        marble=material("WS_Marble", "#ebe6da", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
    )


TILE = dict(plaster=4.0, stone=6.0, granite=3.0, tile=2.0, trim=2.0, roof=4.0, red=2.0, gold=1.0, paint=1.0, marble=2.0)


# --- walls and eaves ------------------------------------------------------------------------------------------

def wall_box(g, x0, x1, y0, y1, z0, z1, key, faces=("-x", "+x", "-y", "+y")):
    """The sides of a block in `key`, UVs in metres (for the facade shader: u along the wall, v height)."""
    P = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    names = ["-y", "+x", "+y", "-x"]
    u = 0.0
    for i in range(4):
        a, b = P[i], P[(i + 1) % 4]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if names[i] in faces:
            g.polyn([(*a, z0), (*b, z0), (*b, z1), (*a, z1)], key, (b[1] - a[1], -(b[0] - a[0]), 0),
                    uvs=[(u, z0), (u + L, z0), (u + L, z1), (u, z1)])
        u += L


def eave_ring(g, x0, x1, y0, y1, ztop, out, rise, key="eave"):
    """A glazed eave round a block's top: from the wall line at ztop out `out` and down `rise`, concave, hips at the
    corners; the tile ends as a dark strip, the soffit under it. UVs: u along the eave (2 m a repeat), v down the slope."""
    offs, zs = (out, out * 0.5, -0.3), (ztop - rise, ztop - rise * 0.32, ztop + 0.05)
    rings = [[Vector((x0 - o, y0 - o, z)), Vector((x1 + o, y0 - o, z)), Vector((x1 + o, y1 + o, z)), Vector((x0 - o, y1 + o, z))] for o, z in zip(offs, zs)]
    outs = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    for i in range(4):
        a, b = i, (i + 1) % 4
        d = (rings[0][b] - rings[0][a]).normalized()
        mid = (rings[0][a] + rings[0][b]) / 2
        vacc = 0.0
        for j in range(2):
            p = [rings[j][a], rings[j][b], rings[j + 1][b], rings[j + 1][a]]
            seg = ((rings[j][a] + rings[j][b]) / 2 - (rings[j + 1][a] + rings[j + 1][b]) / 2).length
            uv = [((q - mid).dot(d) / 2.0, (vacc + (seg if k >= 2 else 0.0)) / 2.0) for k, q in enumerate(p)]
            g.polyn(p, key, (outs[i][0], outs[i][1], 1.5), uvs=uv)
            vacc += seg
        drop = Vector((0, 0, -0.45))
        ea, eb = rings[0][a], rings[0][b]
        g.polyn([ea, eb, eb + drop, ea + drop], "trim", (outs[i][0], outs[i][1], 0))
        wa = Vector((ea.x + (x0 - ea.x if ea.x < x0 else x1 - ea.x if ea.x > x1 else 0), ea.y + (y0 - ea.y if ea.y < y0 else y1 - ea.y if ea.y > y1 else 0), ea.z - 0.45))
        wb = Vector((eb.x + (x0 - eb.x if eb.x < x0 else x1 - eb.x if eb.x > x1 else 0), eb.y + (y0 - eb.y if eb.y < y0 else y1 - eb.y if eb.y > y1 else 0), eb.z - 0.45))
        g.polyn([ea + drop, eb + drop, wb, wa], "stone", (0, 0, -1))


def flat_roof(g, x0, x1, y0, y1, z, key="roof"):
    g.polyn([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], key, (0, 0, 1))


def block(g, x0, x1, y0, y1, h, z0=0.0, eave=(2.8, 2.6), faces=("-x", "+x", "-y", "+y"), low=None, wall="windows"):
    """A block: a granite base course, windows (or `low` = (z, key): a different wall up to z on the front), a
    glazed eave round the top and a flat roof."""
    if z0 < 0.5:
        wall_box(g, x0 - 0.2, x1 + 0.2, y0 - 0.2, y1 + 0.2, z0, z0 + 1.2, "granite", faces)
        zw = z0 + 1.2
    else:
        zw = z0
    if low:
        zl, key = low
        wall_box(g, x0, x1, y0, y1, zw, zl, key, tuple(f for f in faces if f == "+y"))
        wall_box(g, x0, x1, y0, y1, zw, zl, wall, tuple(f for f in faces if f != "+y"))
        if h > zl + 0.01:
            wall_box(g, x0, x1, y0, y1, zl, h, wall, faces)
    else:
        wall_box(g, x0, x1, y0, y1, zw, h, wall, faces)
    if eave:
        eave_ring(g, x0, x1, y0, y1, h + 0.3, eave[0], eave[1])
        flat_roof(g, x0 - 0.25, x1 + 0.25, y0 - 0.25, y1 + 0.25, h + 0.3)
    else:
        g.box(x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4, h, h + 0.9, "stone", skip=("-z", "+z"))
        g.polyn([(x0 - 0.4, y0 - 0.4, h), (x1 + 0.4, y0 - 0.4, h), (x1 + 0.4, y1 + 0.4, h), (x0 - 0.4, y1 + 0.4, h)], "stone", (0, 0, -1))
        flat_roof(g, x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4, h + 0.9)


# --- pavilions (station.py's, built at a unit size and scaled) ------------------------------------------------

def pavilion(g, parts, mesh, H, m, tag):
    """A pavilion through matrix m (its floor at the origin): walls, beams, ceilings and roofs; the linked columns,
    brackets and beasts."""
    pg = Geo()
    z0 = H.Z0
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            pg.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("window", QUAD))
            pg.polyn([P(us[i], H.UP0), P(us[i + 1], H.UP0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, pg, True, *H.BEAM)
    ring_beams(H, pg, False, *H.UBEAM)
    pg.polyn([(-H.OX, -H.OY, H.BEAM[1]), (H.OX, -H.OY, H.BEAM[1]), (H.OX, H.OY, H.BEAM[1]), (-H.OX, H.OY, H.BEAM[1])], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    # the floor: a marble platform under the columns
    pg.box(-H.OX - 0.8, H.OX + 0.8, -H.OY - 0.8, H.OY + 0.8, -0.6, 0.0, "marble", skip=("-z",))
    hips = roofs(H, pg)
    g.add(pg, m)
    n = 0
    col, ucol = mesh["col"], mesh["ucol"]
    for outer in (True, False):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(col, f"{tag}.Column.{n:03d}", parts, m @ T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(ucol, f"{tag}.UpperColumn.{n:03d}", parts, m @ T(*to_world(rot, D, u, 0, H.UP0 - 0.4)))
                n += 1
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"{tag}.Bracket.{i:03d}", parts, m @ T(*p) @ Rz(yaw) @ Matrix.Diagonal((0.7, 0.7, 0.7, 1)))
    for i, line in enumerate(hips):
        beasts_on([m @ p for p in line], parts, mesh, f"{tag}.Beast{i}", n=2)
    return len(spots)


def skirt(g, hw, z, out, rise, cx=0.0, cy=0.0, rows=2):
    """A glazed eave of hall.py tiles round a square base's top (the gate pavilion's lowest eave)."""
    R = dict(z=z, H=rise, p=1.3, o=0.45, lift=0.4, Lc=3.5, Vc=1.8)
    top = out + 0.6
    hips = []
    sub = Geo()
    for rot in range(4):
        rw = roof_face(sub, R, top, rot, hw + out, hw + out, top, rows=rows, waves=True, key="tile", pitch=0.5, amp=0.09)
        eave_edge(sub, rw[0], key="trim")
        if rot % 2 == 1:
            hips.append([r[0] for r in rw])
            hips.append([r[-1] for r in rw])
    for line in hips:
        sweep(sub, line, 0.5, 0.4, key="trim")
    g.add(sub, T(cx, cy, 0))


def pav_far(far, cx, cy, z0, k):
    """A pavilion for the far level: a box and a pyramid."""
    r = UNIT.OX * k
    far.box(cx - r, cx + r, cy - r, cy + r, z0, z0 + UNIT.BEAM[0] * k, "red", skip=("-z",))
    e, top, ze = UNIT_EAVE * k, z0 + (UNIT_TOP + 1.5) * k, z0 + UNIT.LOWER["z"] * k
    pts = [(cx - e, cy - e), (cx + e, cy - e), (cx + e, cy + e), (cx - e, cy + e)]
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        far.polyn([(*a, ze), (*b, ze), (cx, cy, top)], "tile", ((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 1))


# --- the build ------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    M = materials()
    main = collection("北京西站")
    g = Geo()
    G = GATE
    hw, ow = G["hw"], G["ow"]

    # the main building: the low ends, the tall blocks either side of the gate, the hall behind the opening;
    # the departure level along the front is glass up to 13 m
    y0, y1 = MAIN["y0"], MAIN["y1"]
    block(g, MAIN["x0"], -TALL["x"], y0, y1, MAIN["h"], low=(13.0, "glass"), faces=("-x", "-y", "+y"))
    block(g, TALL["x"], MAIN["x1"], y0, y1, MAIN["h"], low=(13.0, "glass"), faces=("+x", "-y", "+y"))
    for sx in (-1, 1):
        a, b = sorted((sx * ow, sx * TALL["x"]))
        block(g, a, b, y0, y1, TALL["h"], low=(13.0, "glass"), eave=(3.2, 3.0))
    block(g, -ow, ow, y0, y1, CORE_H, low=(CORE_H - 3.0, "glass"), faces=("-y", "+y"), eave=(2.0, 1.8))
    # a canopy over the departure deck, cantilevered from the front
    for sx in (-1, 1):
        a, b = sorted((sx * (hw + 1.0), sx * 114.0))
        g.box(a, b, y1, DECK_Y[0] - 1.0, 12.6, 13.2, "stone")
        g.box(a, b, DECK_Y[0] - 1.3, DECK_Y[0] - 1.0, 12.1, 12.6, "stone", skip=("+z",))

    # the gate: two piers (open under the deck: the lower part stands in front of it), the beam, a stone
    # surround proud of the front round the opening, glazed slots up the piers' fronts
    for sx in (-1, 1):
        a, b = sorted((sx * ow, sx * hw))
        g.box(a, b, G["ylow"], G["y1"], 0.0, G["zlow"], "stone", skip=("-z",))
        g.box(a, b, G["y0"], G["y1"], G["zlow"], G["ztop"], "stone", skip=("+z",))
        c = sx * (ow + hw) / 2
        g.polyn([(c - 1.7, G["y1"] + 0.02, 3.0), (c + 1.7, G["y1"] + 0.02, 3.0), (c + 1.7, G["y1"] + 0.02, 47.5), (c - 1.7, G["y1"] + 0.02, 47.5)], "glass", (0, 1, 0),
                uvs=[(0, 3.0), (3.4, 3.0), (3.4, 47.5), (0, 47.5)])
        xo = sx * hw
        # windows down the piers' outer sides (over the deck's portal only above it)
        for ya, za, zc in ((G["y1"] - 29.0, 14.5, 47.5), (G["ylow"] + 2.5, 3.0, 11.5)):
            L = G["y1"] - 4.0 - ya
            g.polyn([(xo + sx * 0.02, G["y1"] - 4.0, za), (xo + sx * 0.02, ya, za), (xo + sx * 0.02, ya, zc), (xo + sx * 0.02, G["y1"] - 4.0, zc)], "windows", (sx, 0, 0),
                    uvs=[(0, za), (L, za), (L, zc), (0, zc)])
        # the jamb band
        a2, b2 = sorted((sx * (ow + 1.6), sx * ow))
        g.box(a2, b2, G["y1"], G["y1"] + 0.8, 0.0, G["zopen"] + 1.6, "stone", skip=("-z", "-y"))
    g.box(-ow, ow, G["y0"], G["y1"], G["zopen"], G["ztop"], "stone", skip=("-x", "+x"))
    g.box(-ow - 1.6, ow + 1.6, G["y1"], G["y1"] + 0.8, G["zopen"], G["zopen"] + 1.6, "stone", skip=("-y",))
    # the beam's cornice and the platform round the pavilion
    g.box(-hw - 0.8, hw + 0.8, G["y0"] - 0.8, G["y1"] + 0.8, G["ztop"], G["ztop"] + 0.8, "stone", skip=("-z",))
    g.polyn([(-hw - 0.8, G["y0"] - 0.8, G["ztop"]), (hw + 0.8, G["y0"] - 0.8, G["ztop"]), (hw + 0.8, G["y1"] + 0.8, G["ztop"]), (-hw - 0.8, G["y1"] + 0.8, G["ztop"])], "stone", (0, 0, -1))
    # a band of glazed tiles along the beam's front under the cornice
    eave_ring(g, -hw, hw, G["y0"], G["y1"], G["ztop"] - 0.2, 1.4, 1.2)

    # the gate's pavilion: a red base block with lattice bays, the lowest eave, then the unit pavilion scaled up
    pcy = (G["y0"] + G["y1"]) / 2
    zb = G["ztop"] + 0.8
    B = 13.5
    g.box(-B - 0.4, B + 0.4, pcy - B - 0.4, pcy + B + 0.4, zb, zb + 1.2, "marble", skip=("-z",))
    zw0, zw1 = zb + 1.2, zb + 9.6
    for rot in range(4):
        bays = 6
        for i in range(bays):
            u0, u1 = -B + 2 * B * i / bays, -B + 2 * B * (i + 1) / bays
            P = lambda u, z: to_world(rot, B, u, 0, z) + Vector((0, pcy, 0))        # noqa: E731
            g.polyn([P(u0 + 0.35, zw0), P(u1 - 0.35, zw0), P(u1 - 0.35, zw1 - 1.0), P(u0 + 0.35, zw1 - 1.0)], "atlas", cdir(rot, 0, -1), uvs=uvs("window", QUAD))
            g.polyn([P(u0, zw1 - 1.0), P(u1, zw1 - 1.0), P(u1, zw1), P(u0, zw1)], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            for u in (u0, u1):
                q = [P(u - 0.35, zw0), P(u + 0.35, zw0), P(u + 0.35, zw1 - 1.0), P(u - 0.35, zw1 - 1.0)]
                g.polyn([p + cdir(rot, 0, -0.08) for p in q], "red", cdir(rot, 0, -1))
    g.box(-B, B, pcy - B, pcy + B, zw0, zw1, "plaster", skip=("-z", "-x", "+x", "-y", "+y"))
    skirt(g, B, zw1 + 0.4 - 2.6, 3.4, 2.6, cy=pcy)
    zp = CENTRE_Z
    g.box(-10.5, 10.5, pcy - 10.5, pcy + 10.5, zw1, zp - 0.6, "marble", skip=("-z",))

    # the wings (the west one on columns over the service road)
    for W in WINGS:
        if W["pilotis"]:
            block(g, W["x0"], W["x1"], W["y0"], W["y1"], W["h"], z0=PIL["z"], faces=("-y", "+y"))
            g.polyn([(W["x0"], W["y0"], PIL["z"]), (W["x1"], W["y0"], PIL["z"]), (W["x1"], W["y1"], PIL["z"]), (W["x0"], W["y1"], PIL["z"])], "stone", (0, 0, -1))
            block(g, W["x0"], W["x1"], W["y0"], PIL["yb"], PIL["z"], eave=None, low=(PIL["z"], "glass"), faces=("-y", "+y"))
            n = 12
            for k in range(n + 1):
                x = -292.0 + (292.0 - 190.0) * k / n
                g.box(x - 0.45, x + 0.45, W["y1"] - 1.4, W["y1"] - 0.5, 0.0, PIL["z"], "stone", skip=("-z", "+z"))
        else:
            block(g, W["x0"], W["x1"], W["y0"], W["y1"], W["h"], low=(5.0, "glass"), faces=("-y", "+y"))

    # the 亭楼: a tower with a smaller gate over a low block to OSM's front line, and a pavilion on top
    for Tg in TING:
        x0, x1 = Tg["x0"], Tg["x1"]
        cx = (x0 + x1) / 2
        block(g, x0, x1, -37.5, TING_Y, TING_H, eave=(3.0, 2.8))
        block(g, x0, x1, TING_Y, Tg["yf"], TING_LOW, low=(5.0, "glass"), faces=("-x", "+x", "+y"))
        # the gate: a recessed portal in the front over the low block, glass at its back
        pw, pz0, pz1, dep = 7.5, TING_LOW + 0.3, 34.0, 3.0
        yf = TING_Y + 0.03
        g.polyn([(cx - pw - 1.4, yf, pz0), (cx + pw + 1.4, yf, pz0), (cx + pw + 1.4, yf, pz1 + 1.4), (cx - pw - 1.4, yf, pz1 + 1.4)], "stone", (0, 1, 0))
        g.polyn([(cx - pw, yf + 0.01, pz0), (cx + pw, yf + 0.01, pz0), (cx + pw, yf + 0.01, pz1), (cx - pw, yf + 0.01, pz1)], "glass", (0, 1, 0),
                uvs=[(0, pz0), (2 * pw, pz0), (2 * pw, pz1), (0, pz1)])
        g.box(cx - pw - 1.4, cx + pw + 1.4, TING_Y, TING_Y + 0.9, pz1, pz1 + 1.4, "stone", skip=("-y", "-z"))
        g.box(cx - pw - 1.4, cx - pw, TING_Y, TING_Y + 0.9, pz0, pz1, "stone", skip=("-y", "-z", "+z"))
        g.box(cx + pw, cx + pw + 1.4, TING_Y, TING_Y + 0.9, pz0, pz1, "stone", skip=("-y", "-z", "+z"))
        del dep
        g.box(cx - 8.2, cx + 8.2, -12.75 - 8.2, -12.75 + 8.2, TING_H + 0.3, TING_H + 1.6, "marble", skip=("-z",))

    # the annexes
    block(g, ANNEX[0]["x0"], ANNEX[0]["x1"], ANNEX[0]["y0"], ANNEX[0]["y1"], ANNEX_H, eave=None, faces=("-x", "-y", "+y"))
    block(g, ANNEX[1]["x0"], ANNEX[1]["x1"], ANNEX[1]["y0"], ANNEX[1]["y1"], ANNEX_H, eave=None, faces=("-x", "+x", "+y"))
    block(g, ANNEX[2]["x0"], ANNEX[2]["x1"], ANNEX[2]["y0"], ANNEX[2]["y1"], ANNEX_H, eave=None, faces=("+x", "-y", "+y"))

    # the waiting hall over the tracks, on columns; the south building
    Hh = HALL
    wall_box(g, Hh["x0"], Hh["x1"], Hh["y0"], Hh["y1"], Hh["z0"], Hh["h"], "glass", ("-x", "+x"))
    g.polyn([(Hh["x0"], Hh["y0"], Hh["z0"]), (Hh["x1"], Hh["y0"], Hh["z0"]), (Hh["x1"], Hh["y1"], Hh["z0"]), (Hh["x0"], Hh["y1"], Hh["z0"])], "stone", (0, 0, -1))
    eave_ring(g, Hh["x0"], Hh["x1"], Hh["y0"], Hh["y1"], Hh["h"] + 0.3, 1.8, 1.6)
    # a shallow barrel roof along the hall
    N = 10
    for i in range(N):
        xa, xb = Hh["x0"] + (Hh["x1"] - Hh["x0"]) * i / N, Hh["x0"] + (Hh["x1"] - Hh["x0"]) * (i + 1) / N
        za = Hh["h"] + 0.3 + 7.0 * math.sin(math.pi * i / N)
        zb2 = Hh["h"] + 0.3 + 7.0 * math.sin(math.pi * (i + 1) / N)
        g.polyn([(xa, Hh["y0"], za), (xb, Hh["y0"], zb2), (xb, Hh["y1"], zb2), (xa, Hh["y1"], za)], "roof", (0, 0, 1))
        for yy, s in ((Hh["y0"], -1), (Hh["y1"], 1)):
            g.polyn([(xa, yy, Hh["h"] + 0.3), (xb, yy, Hh["h"] + 0.3), (xb, yy, zb2), (xa, yy, za)], "glass", (0, s, 0),
                    uvs=[(xa, Hh["h"]), (xb, Hh["h"]), (xb, zb2), (xa, za)])
    hall_cols = []
    for x in (-72.0, -48.0, -24.0, 0.0, 24.0, 48.0, 72.0):
        for y in (-72.0, -108.0, -144.0, -180.0, -216.0, -246.0):
            g.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 0.0, Hh["z0"], "stone", skip=("-z", "+z"))
            hall_cols.append((x, y))
    S = SOUTH
    block(g, S["x0"], -S["cx"], S["y0"], S["y1"], S["h"], low=(5.0, "glass"), faces=("-x", "-y", "+y"))
    block(g, S["cx"], S["x1"], S["y0"], S["y1"], S["h"], low=(5.0, "glass"), faces=("+x", "-y", "+y"))
    block(g, -S["cx"], S["cx"], S["y0"], S["y1"], S["hc"], low=(5.0, "glass"), eave=(3.0, 2.8))

    g.build("Station", collection("站房", main), M, TILE)
    tris = g.tris()

    # 北京西站 in red over the gate, on the beam's front
    font = bpy.data.fonts.load(FONT)
    m = T(0, G["y1"] + 0.85, (G["zopen"] + 1.6 + G["ztop"] - 1.2) / 2) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    tris += sign(font, "北京西站", 5.6, m, "Sign", collection("站名", main), M["letters"], extrude=0.12)

    # the pavilions: the gate's, the four on the tall blocks, one on each 亭楼
    parts = collection("构件", main)
    mesh = {
        "col": mesh_of(column_geo(UNIT.BEAM[0], r=0.3), "PavColumn", M, TILE),
        "ucol": mesh_of(column_geo(UNIT.UBEAM[0] - UNIT.UP0 + 0.4, r=0.26), "PavUpperColumn", M, TILE),
        "bracket": mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE),
        "beast": mesh_of(beast_geo(glaze="#2f7a55", lite=True), "BeastMesh", M, TILE),
        "immortal": None,
        "post": mesh_of(post_geo(), "PostMesh", M, TILE),
        "panel": mesh_of(panel_geo(), "PanelMesh", M, TILE),
    }
    mesh["immortal"] = mesh["beast"]       # a figure under half a metre, 70 m up: the beast will do
    pg = Geo()
    S3 = lambda k: Matrix.Diagonal((k, k, k, 1))      # noqa: E731
    nb = pavilion(pg, parts, mesh, UNIT, T(0, pcy, zp) @ S3(CENTRE_K), "Gate")
    for i, (x, y) in enumerate(CORNERS):
        pg.box(x - 7.5, x + 7.5, y - 7.5, y + 7.5, TALL["h"] + 0.3, TALL["h"] + 1.5, "marble", skip=("-z",))
        nb += pavilion(pg, parts, mesh, UNIT, T(x, y, TALL["h"] + 2.1) @ S3(CORNER_K), f"Corner{i}")
    for i, Tg in enumerate(TING):
        cx = (Tg["x0"] + Tg["x1"]) / 2
        nb += pavilion(pg, parts, mesh, UNIT, T(cx, -12.75, TING_H + 2.2) @ S3(TING_K), f"Ting{i}")
    pg.build("Pavilions", collection("亭", main), M, TILE)
    tris += pg.tris()
    # a balustrade round the gate's platform
    z = G["ztop"] + 0.8
    X0, X1, Y0, Y1 = -hw - 0.3, hw + 0.3, G["y0"] - 0.3, G["y1"] + 0.3
    balustrade(parts, mesh, [(X0, Y0, z), (X1, Y0, z), (X1, Y1, z), (X0, Y1, z), (X0, Y0, z)], "GateRail", gap=1.9)

    # the far level
    far = Geo()
    far.box(MAIN["x0"], MAIN["x1"], y0, y1, 0.0, MAIN["h"], "windows", skip=("-z",))
    for sx in (-1, 1):
        a, b = sorted((sx * ow, sx * TALL["x"]))
        far.box(a, b, y0, y1, MAIN["h"], TALL["h"], "windows", skip=("-z",))
        a, b = sorted((sx * ow, sx * hw))
        far.box(a, b, G["y0"], G["y1"], 0.0, G["ztop"], "stone", skip=("-z",))
    far.box(-ow, ow, G["y0"], G["y1"], G["zopen"], G["ztop"], "stone")
    for W in WINGS:
        far.box(W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"], "windows", skip=("-z",))
    for Tg in TING:
        far.box(Tg["x0"], Tg["x1"], -37.5, TING_Y, 0.0, TING_H, "windows", skip=("-z",))
        far.box(Tg["x0"], Tg["x1"], TING_Y, Tg["yf"], 0.0, TING_LOW, "windows", skip=("-z",))
        pav_far(far, (Tg["x0"] + Tg["x1"]) / 2, -12.75, TING_H + 2.2, TING_K)
    for A in ANNEX:
        far.box(A["x0"], A["x1"], A["y0"], A["y1"], 0.0, ANNEX_H, "windows", skip=("-z",))
    far.box(Hh["x0"], Hh["x1"], Hh["y0"], Hh["y1"], Hh["z0"], Hh["h"] + 4.0, "glass")
    far.box(S["x0"], S["x1"], S["y0"], S["y1"], 0.0, S["h"], "windows", skip=("-z",))
    far.box(-S["cx"], S["cx"], S["y0"], S["y1"], S["h"], S["hc"], "windows", skip=("-z",))
    far.box(-B, B, pcy - B, pcy + B, G["ztop"], zw1, "red", skip=("-z",))
    pav_far(far, 0.0, pcy, zp, CENTRE_K)
    for x, y in CORNERS:
        pav_far(far, x, y, TALL["h"] + 2.1, CORNER_K)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders
    helpers = collection("碰撞体")
    for sx in (-1, 1):
        a, b = sorted((sx * ow, sx * hw))
        collider_box(helpers, "pierLow", a, b, G["ylow"], G["y1"], 0.0, G["zlow"])
        collider_box(helpers, "pier", a, b, G["y0"], G["y1"], G["zlow"], G["ztop"])
        a, b = sorted((sx * ow, sx * TALL["x"]))
        collider_box(helpers, "tall", a, b, y0, y1, 0.0, TALL["h"])
    collider_box(helpers, "beam", -ow, ow, G["y0"], G["y1"], G["zopen"], G["ztop"])
    collider_box(helpers, "core", -ow, ow, y0, y1, 0.0, CORE_H)
    collider_box(helpers, "mainW", MAIN["x0"], -TALL["x"], y0, y1, 0.0, MAIN["h"])
    collider_box(helpers, "mainE", TALL["x"], MAIN["x1"], y0, y1, 0.0, MAIN["h"])
    for W in WINGS:
        if W["pilotis"]:
            collider_box(helpers, "wingW", W["x0"], W["x1"], W["y0"], W["y1"], PIL["z"], W["h"])
            collider_box(helpers, "wingWback", W["x0"], W["x1"], W["y0"], PIL["yb"], 0.0, PIL["z"])
            for k in range(13):
                x = -292.0 + (292.0 - 190.0) * k / 12
                collider_box(helpers, "pilotis", x - 0.45, x + 0.45, W["y1"] - 1.4, W["y1"] - 0.5, 0.0, PIL["z"])
        else:
            collider_box(helpers, "wingE", W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"])
    for Tg in TING:
        collider_box(helpers, "ting", Tg["x0"], Tg["x1"], -37.5, TING_Y, 0.0, TING_H)
        collider_box(helpers, "tingLow", Tg["x0"], Tg["x1"], TING_Y, Tg["yf"], 0.0, TING_LOW)
    for A in ANNEX:
        collider_box(helpers, "annex", A["x0"], A["x1"], A["y0"], A["y1"], 0.0, ANNEX_H)
    collider_box(helpers, "hall", Hh["x0"], Hh["x1"], Hh["y0"], Hh["y1"], Hh["z0"], Hh["h"])
    for x, y in hall_cols:
        collider_box(helpers, "hallCol", x - 0.7, x + 0.7, y - 0.7, y + 0.7, 0.0, Hh["z0"])
    collider_box(helpers, "south", S["x0"], S["x1"], S["y0"], S["y1"], 0.0, S["h"])
    collider_box(helpers, "southC", -S["cx"], S["cx"], S["y0"], S["y1"], S["h"], S["hc"])

    # the footprint in pieces (OSM's steps), and the same ground kept clear of street trees and lamps
    pieces = [
        ("main", rect(MAIN["x0"], MAIN["x1"], y0 - 0.5, y1)),
        ("gate", rect(-hw, hw, y1, G["y1"])),
        ("wingW", rect(WINGS[0]["x0"], WINGS[0]["x1"], -37.5, WINGS[0]["y1"])),
        ("wingE", rect(WINGS[1]["x0"], WINGS[1]["x1"], -37.5, WINGS[1]["y1"])),
        ("tingW", rect(TING[0]["x0"], TING[0]["x1"], -37.5, TING[0]["yf"])),
        ("tingE", rect(TING[1]["x0"], TING[1]["x1"], -37.5, TING[1]["yf"])),
        ("annexW", rect(ANNEX[0]["x0"], ANNEX[0]["x1"], ANNEX[0]["y0"], ANNEX[0]["y1"])),
        ("annexWfront", rect(ANNEX[1]["x0"], ANNEX[1]["x1"], ANNEX[1]["y0"], ANNEX[1]["y1"])),
        ("annexE", rect(ANNEX[2]["x0"], ANNEX[2]["x1"], ANNEX[2]["y0"], ANNEX[2]["y1"])),
        ("hall", rect(Hh["x0"], Hh["x1"], Hh["y0"], Hh["y1"])),
        ("south", rect(S["x0"], S["x1"], S["y0"], S["y1"])),
    ]
    # the forecourt: machine-learnt blocks stood on it (the helical ramps' and the deck's shadows read as buildings)
    flat_marker(helpers, "forecourt", rect(MAIN["x0"], 168.0, y1, 72.0), "FOOTPRINT")
    for name, poly in pieces:
        flat_marker(helpers, name, poly, "FOOTPRINT")
        flat_marker(helpers, name + "Clear", poly, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "weststation", "北京西站", "Beijing West Railway Station"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, brackets=nb)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
