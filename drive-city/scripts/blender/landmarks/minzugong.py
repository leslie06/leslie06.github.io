# 民族文化宫 Cultural Palace of Nationalities (张镈, 1959, one of the Ten Great Buildings), on the north side of
# 复兴门内大街 (西长安街), built in Blender and marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/minzugong.py -- [--out art/landmarks/minzugong.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the middle of the entrance front, game
# (-2979.6, 238.0), heading +0.47 (OSM way 521039212's long edges lean 0.47 deg clockwise).
#
# The plan is OSM's outline (one way, building:levels=5, 180 x 105 m): the 山 shape the sources describe - the
# centre block with the entrance hall facing the avenue, the exhibition hall reaching north behind it (中央展览大厅
# 向北面伸展), the two lower ranges east and west, and at their ends the two wings reaching forward round the
# forecourt (东西两侧有翼楼环抱着中心广场); the west wing carries a lower annex on its north-west corner.
# The figures (zh Wikipedia, 北京市文物局): the tower 13 storeys and 67 m, the walls white (白色釉面砖), the eaves
# in peacock-blue glaze (檐顶以孔雀蓝琉璃瓦装饰), the top a square double-eaved 攒尖 pavilion (四方重檐攒尖顶亭阁),
# the doors of the central hall lettered 团结 and 进步; "亭台楼阁塔于一身" - so a small blue-roofed pavilion on each
# wing's ends. The tower stands on the centre block in two stages with a blue tiled pent eave at each setback;
# the heights of the stages, the ranges' (18 m) and the centre block's (24 m) are estimates, as are the wings'
# pavilions (count and size), the portal's form and where the gilt 民族文化宫 sits (here over the portal).

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, T, collider_box, cyl, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from hall import roofs  # noqa: E402
from national_museum import facing, lettering  # noqa: E402
from zhengyangmen import steps_ramp  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "minzugong.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

PL = 1.2           # the granite plinth
# Parts: (name, x0, x1, y0, y1, height, exposed sides, facade bay, storey)
PARTS = [
    ("centre", -27.3, 27.3, 0.0, 27.5, 24.0, "sewn", 4.0, 4.6),
    ("rangeW", -55.8, -27.3, 6.2, 27.7, 18.0, "sn", 3.8, 4.2),
    ("rangeE", 27.3, 54.6, 6.0, 26.4, 18.0, "sn", 3.8, 4.2),
    ("wingW", -84.0, -55.8, -33.4, 37.6, 18.0, "sewn", 3.8, 4.2),
    ("wingE", 54.6, 87.0, -31.8, 40.3, 18.0, "sewn", 3.8, 4.2),
    ("annexW", -92.4, -84.0, 10.0, 37.6, 14.0, "swn", 3.8, 4.2),
    ("hall", -14.4, 14.4, 27.5, 71.5, 15.0, "ewn", 4.5, 6.0),
]
EAVE = dict(ov=1.7, rise=1.1)          # the ranges' tiled eaves: overhang and fall
TY = 15.0                               # the tower's centre line
STAGES = [                              # (half x, half y, z0, z1, eave overhang)
    (11.0, 11.0, 24.0, 46.0, 1.9),
    (8.6, 8.6, 46.0, 52.0, 1.6),
]
PB = 52.4                               # the crowning pavilion's floor
TOP = SimpleNamespace(
    XS=[-6.2, -2.1, 2.1, 6.2], YS=[-6.2, -2.1, 2.1, 6.2], OX=6.2, OY=6.2, IX=4.4, IY=4.4,
    BEAM=(PB + 3.4, PB + 3.9, PB + 4.05, PB + 4.7), UBEAM=(PB + 7.0, PB + 7.5, PB + 7.65, PB + 8.3), OVERHANG=2.2,
    LOWER=dict(A=8.4, D=8.4, z=PB + 4.3, H=1.7, p=1.3, o=0.7, lift=0.6, Lc=4.5, Vc=2.6),
    UPPER=dict(A=6.8, D=6.8, z=PB + 7.9, H=4.4, p=1.6, o=0.7, lift=0.7, Lc=4.5, Vc=2.6),
    GABLE_X=3.0, PITCH=0.5, AMP=0.09, TRIM=0.0, RIDGE="tile", KIND="cuanjian", ROWS=6, LOWER_ROWS=4)
PAVZ = 18.6                             # the wings' pavilions stand on the roof
PAV = SimpleNamespace(
    XS=[-3.6, 3.6], YS=[-3.6, 3.6], OX=3.6, OY=3.6, IX=3.6, IY=3.6,
    BEAM=(PAVZ + 3.0, PAVZ + 3.4, PAVZ + 3.5, PAVZ + 4.0), UBEAM=(PAVZ + 3.0, PAVZ + 3.4, PAVZ + 3.5, PAVZ + 4.0), OVERHANG=1.8,
    LOWER=None, UPPER=dict(A=5.4, D=5.4, z=PAVZ + 3.7, H=3.4, p=1.6, o=0.5, lift=0.5, Lc=3.0, Vc=2.0),
    GABLE_X=2.0, PITCH=0.5, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="cuanjian", ROWS=5)
PAV_AT = [(-69.9, -26.0), (70.8, -24.5), (-69.9, 30.0), (70.8, 33.0)]
PORTAL = dict(x=9.0, y0=-2.6, h=15.0, doors=(-5.0, 0.0, 5.0), dw=3.4, dh=8.0)
STEPS = dict(x=13.0, n=6, run=0.55)


# --- textures ------------------------------------------------------------------------------------------

def facade_images(name, size=512, win_w=0.5, win_top=0.12, win_bot=0.74, seed=4, panel_col="#d3d6d2", panel_end=0.95):
    """One bay by one storey of white glazed tile: a tall window in a white surround over a panel; lit at night."""
    cv, glow = Canvas(size, size, "#e9e7df"), Canvas(size, size, "#000000")
    cv.noise(0.05, seed)
    y, x = cv.y / size, cv.x / size          # y down from the top of the storey
    cv.put((np.mod(cv.y, size / 16) < 1.2) | (np.mod(cv.x, size / 8) < 1.2), "#d9d6cc")        # tile joints
    frame = (np.abs(x - 0.5) < win_w / 2 + 0.05) & (y > win_top - 0.04) & (y < win_bot + 0.04)
    win = (np.abs(x - 0.5) < win_w / 2) & (y > win_top) & (y < win_bot)
    panel = (np.abs(x - 0.5) < win_w / 2) & (y > win_bot + 0.04) & (y < panel_end)
    cv.put(frame, "#f6f5f0")
    glass = srgb("#2a3540") + (0.16 * y)[..., None] * srgb("#8fa2b2")
    cv.a[win] = glass[win]
    cv.put(panel, panel_col)
    cv.put(panel & (np.abs(np.mod((x - 0.5) * 10, 1) - 0.5) < 0.12) & (np.abs(y - (win_bot + 0.5 * (0.95 - win_bot) + 0.03)) < 0.04), "#5f9ea8")
    bars = win & ((np.abs(x - 0.5) < 0.008) | (np.abs(y - (win_top + 0.32 * (win_bot - win_top))) < 0.006))
    cv.put(bars, "#eceae3")
    rng = np.random.default_rng(seed)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffd59a") * (0.2 + 0.4 * (rng.random((size, size), np.float32)[lit][:, None] > 0.45))
    return image(name, np.flipud(cv.a).copy()), image(name + "Night", np.flipud(glow.a).copy())


def tile_image(name, col="#1b88a0", size=128):
    """Glazed tiles: tube rows down the slope (one every UV unit across), courses up it."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.72 + 0.28 * np.cos(np.pi * u) ** 2
    course = 1 - 0.14 * (((v * 4) % 1) < 0.08)
    return image(name, srgb(col) * (ridge * course)[..., None])


def core_images(size=256):
    """The pavilions' glazed rooms (3 m a repeat): tall panes in white frames over a low panel; lit at night."""
    cv, glow = Canvas(size, size, "#eeece5"), Canvas(size, size, "#000000")
    y, x = cv.y / size, cv.x / size
    pane = (np.abs(np.mod(x * 2, 1) - 0.5) < 0.4) & (np.mod(y * 1, 1) > 0.06) & (np.mod(y * 1, 1) < 0.72)
    glass = srgb("#34424c") + (0.2 * y)[..., None] * srgb("#90a6b5")
    cv.a[pane] = glass[pane]
    cv.put(pane & (np.abs(np.mod(x * 2, 1) - 0.5) < 0.012), "#e6e3da")
    cv.put((y > 0.76) & (y < 0.96) & (np.abs(np.mod(x * 2, 1) - 0.5) < 0.4), "#5f9ea8")
    glow.put(pane, (0.32, 0.23, 0.12))
    return image("MZ_Core", np.flipud(cv.a).copy()), image("MZ_CoreNight", np.flipud(glow.a).copy())


def door_images(size=256):
    """A bronze door leaf pair with studs under a lit transom (3.4 x 8 m)."""
    cv, glow = Canvas(size, size, "#6a4d2c"), Canvas(size, size, "#000000")
    y, x = cv.y / size, cv.x / size
    cv.put(np.abs(x - 0.5) < 0.012, "#3b2a17")
    stud = (np.abs(np.mod(x * 9, 1) - 0.5) < 0.16) & (np.abs(np.mod(y * 20, 1) - 0.5) < 0.16) & (y > 0.22) & (y < 0.96) & (np.abs(x - 0.5) > 0.05)
    cv.put(stud, "#b48a45")
    trans = y < 0.18
    cv.put(trans, "#2b333b")
    cv.put(trans & (np.mod(x * 6, 1) < 0.05), "#c9c3b2")
    glow.put(trans, (0.35, 0.25, 0.12))
    return image("MZ_Doors", np.flipud(cv.a).copy()), image("MZ_DoorsNight", np.flipud(glow.a).copy())


# --- pieces --------------------------------------------------------------------------------------------

def side_pts(x0, x1, y0, y1, side):
    """The two ends of a side (counter-clockwise) and its outward direction."""
    return {"s": ((x0, y0), (x1, y0), (0, -1)), "e": ((x1, y0), (x1, y1), (1, 0)),
            "n": ((x1, y1), (x0, y1), (0, 1)), "w": ((x0, y1), (x0, y0), (-1, 0))}[side]


def walls(g, x0, x1, y0, y1, z0, z1, sides, key, bay, storey, zref):
    for sd in sides:
        a, b, out = side_pts(x0, x1, y0, y1, sd)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / bay))
        v0, v1 = (z0 - zref) / storey, (z1 - zref) / storey
        g.polyn([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key, (out[0], out[1], 0),
                uvs=[(0, v0), (n, v0), (n, v1), (0, v1)])


def pent(g, x0, x1, y0, y1, h, sides, ov, rise, lift=0.35):
    """The glazed eave round the top of a block: on each side in `sides` a tiled slope from the wall (h + 0.25)
    down and out to the edge, hipped where the next side has one too, square-cut where it does not; the
    fascia, the soffit, and the blue ridge along the wall's top."""
    order = "senw"
    zr, ze = h + 0.25, h + 0.25 - rise
    for sd in sides:
        (ax, ay), (bx, by), out = side_pts(x0, x1, y0, y1, sd)
        i = order.index(sd)
        ha, hb = order[i - 1] in sides, order[(i + 1) % 4] in sides
        d = Vector((bx - ax, by - ay, 0)).normalized()
        o = Vector((out[0], out[1], 0)) * ov
        A, B = Vector((ax, ay, zr)), Vector((bx, by, zr))
        Ea = Vector((ax, ay, ze)) + o - d * (ov if ha else 0) + Vector((0, 0, lift if ha else 0))
        Eb = Vector((bx, by, ze)) + o + d * (ov if hb else 0) + Vector((0, 0, lift if hb else 0))
        L = (B - A).length + 2 * ov
        g.polyn([Ea, Eb, B, A], "tile", (out[0], out[1], 2.0),
                uvs=[(-(ov if ha else 0) / 0.5, 0), ((B - A).length / 0.5 + (ov if hb else 0) / 0.5, 0), ((B - A).length / 0.5, 1), (0, 1)])
        dn = Vector((0, 0, -0.32))
        g.polyn([Ea + dn, Eb + dn, Eb, Ea], "trim", (out[0], out[1], 0))
        Wa, Wb = Vector((ax, ay, ze - 0.55)), Vector((bx, by, ze - 0.55))
        g.polyn([Ea + dn, Eb + dn, Wb, Wa], "soffit", (0, 0, -1))
        # the ridge on the wall's top (a squat tiled cap)
        g.polyn([A, B, B + Vector((0, 0, 0.35)), A + Vector((0, 0, 0.35))], "tile", (out[0], out[1], 0), uvs=[(0, 0), (L / 0.5, 0), (L / 0.5, 0.3), (0, 0.3)])
    g.polyn([(x0, y0, h + 0.6), (x1, y0, h + 0.6), (x1, y1, h + 0.6), (x0, y1, h + 0.6)], "roof", (0, 0, 1))
    for sd in "senw":
        (ax, ay), (bx, by), out = side_pts(x0, x1, y0, y1, sd)
        g.polyn([(ax, ay, h + 0.6), (bx, by, h + 0.6), (bx, by, h), (ax, ay, h)], "tile", (out[0], out[1], 0))


def plinth(g, x0, x1, y0, y1, sides):
    for sd in sides:
        (ax, ay), (bx, by), out = side_pts(x0, x1, y0, y1, sd)
        o = (out[0] * 0.35, out[1] * 0.35)
        g.polyn([(ax + o[0], ay + o[1], 0.0), (bx + o[0], by + o[1], 0.0), (bx + o[0], by + o[1], PL), (ax + o[0], ay + o[1], PL)], "base", (out[0], out[1], 0))
        g.polyn([(ax + o[0], ay + o[1], PL), (bx + o[0], by + o[1], PL), (bx, by, PL), (ax, ay, PL)], "base", (0, 0, 1))


def piers(g, x0, x1, y0, y1, z0, z1, w=1.4, d=0.35):
    """White corner piers up a block's four corners (the tower's verticals)."""
    for cx, sx in ((x0, -1), (x1, 1)):
        for cy, sy in ((y0, -1), (y1, 1)):
            xa, xb = sorted((cx - sx * (w - d), cx + sx * d))
            ya, yb = sorted((cy - sy * (w - d), cy + sy * d))
            g.box(xa, xb, ya, yb, z0, z1, "white", skip=("-z", "+z"))


def pavilion_top(lod=False):
    """The crowning pavilion: a white colonnade round a glazed core, the upper storey, double blue 攒尖 roofs."""
    h = TOP
    g = Geo()
    if not lod:
        g.box(-h.OX - 0.6, h.OX + 0.6, -h.OY - 0.6, h.OY + 0.6, PB - 0.4, PB, "white")
        g.box(-h.IX, h.IX, -h.IY, h.IY, PB, h.BEAM[3], "core", skip=("-z", "+z"))
        for x in h.XS:
            for y in h.YS:
                if abs(x) == h.OX or abs(y) == h.OY:
                    cyl(g, x, y, PB, h.BEAM[0], 0.32, 0.3, 10, "white", caps=(False, False))
        for z0, z1, key in ((h.BEAM[0], h.BEAM[3], "beam"),):
            g.box(-h.OX - 0.3, h.OX + 0.3, -h.OY - 0.3, h.OY + 0.3, z0, z1, key)
        g.box(-h.IX, h.IX, -h.IY, h.IY, h.LOWER["z"] + h.LOWER["H"] - 0.3, h.UBEAM[0], "core", skip=("-z", "+z"))
        g.box(-h.IX - 0.25, h.IX + 0.25, -h.IY - 0.25, h.IY + 0.25, h.UBEAM[0], h.UBEAM[3], "beam")
    roofs(h, g, lod=lod)
    return g


def pavilion_wing(lod=False):
    """A wing's pavilion: four white columns round a little glazed room under a single blue 攒尖 roof."""
    h = PAV
    g = Geo()
    if not lod:
        g.box(-h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5, PAVZ - 0.6, PAVZ, "white", skip=("-z",))
        g.box(-2.6, 2.6, -2.6, 2.6, PAVZ, h.BEAM[0], "core", skip=("-z", "+z"))
        for x in h.XS:
            for y in h.YS:
                cyl(g, x, y, PAVZ, h.BEAM[0], 0.3, 0.28, 8, "white", caps=(False, False))
        g.box(-h.OX - 0.25, h.OX + 0.25, -h.OY - 0.25, h.OY + 0.25, h.BEAM[0], h.BEAM[3], "beam")
    roofs(h, g, lod=lod)
    return g


def far_pyramid(g, cx, cy, A, z, H, key="tile"):
    c = [(cx - A, cy - A), (cx + A, cy - A), (cx + A, cy + A), (cx - A, cy + A)]
    apex = (cx, cy, z + H)
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        g.poly([(a[0], a[1], z), (b[0], b[1], z), apex], key)


# --- the building ----------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    wall, wall_n = facade_images("MZ_Wall")
    tw, tw_n = facade_images("MZ_Tower", win_w=0.4, win_top=0.0, win_bot=0.74, seed=6, panel_col="#7fb0b3", panel_end=1.0)
    core, core_n = core_images()
    door, door_n = door_images()
    M = dict(
        wall=material("MZ_Wall", "#e9e7df", 0.6, tex=wall, emit_tex=wall_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        tower=material("MZ_Tower", "#e9e7df", 0.6, tex=tw, emit_tex=tw_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.7}),
        white=material("MZ_White", "#efede6", 0.55, props={"wet": "damp", "glowStrength": 0.6}),
        base=material("MZ_Base", "#a8a59d", 0.75, props={"wet": "ground", "glowStrength": 0.4}),
        tile=material("MZ_Tile", "#1b88a0", 0.3, tex=tile_image("MZ_TileTex"), props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("MZ_Trim", "#16707f", 0.35, props={"wet": "surface", "glowStrength": 0.4}),
        soffit=material("MZ_Soffit", "#3f7f78", 0.6, props={"wet": "none", "glowStrength": 0.5}),
        atlas=material("MZ_Rafters", "#3d7a74", 0.6, props={"wet": "none", "glowStrength": 0.5}),
        beam=material("MZ_Beam", "#2f6e74", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
        core=material("MZ_Core", "#cfd3d0", 0.4, tex=core, emit_tex=core_n, props={"wet": "surface", "emit": "night", "glowStrength": 0.5}),
        roof=material("MZ_Roof", "#8c8a84", 0.9, props={"wet": "ground", "glow": "none"}),
        gold=material("MZ_Gold", "#e3b346", 0.28, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.78, 0.4], "glowStrength": 0.6}),
        doors=material("MZ_Doors", "#6a4d2c", 0.5, metal=0.6, tex=door, emit_tex=door_n, props={"wet": "surface", "emit": "night", "glowStrength": 0.4}),
        paving=material("MZ_Paving", "#a9a59c", 0.8, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
    )
    TILE = dict(white=2.0, base=2.0, roof=8.0, trim=2.0, soffit=2.0, atlas=2.0, beam=2.0, core=3.0, gold=2.0, paving=4.0)
    main = collection("民族文化宫")
    g = Geo()
    stats = {}

    # the blocks: plinth, white tiled walls, the blue eave and the flat roof behind it
    for name, x0, x1, y0, y1, h, sides, bay, storey in PARTS:
        plinth(g, x0, x1, y0, y1, sides)
        walls(g, x0, x1, y0, y1, PL, h, sides, "wall", bay, storey, PL)
        pent(g, x0, x1, y0, y1, h, sides, EAVE["ov"], EAVE["rise"])
    # the centre block's sides above the ranges, the forecourt sides of the wings are in `sides` already

    # the tower: the shaft with its corner piers, the setback, the eaves at each
    for i, (hx, hy, z0, z1, ov) in enumerate(STAGES):
        walls(g, -hx, hx, TY - hy, TY + hy, z0, z1, "senw", "tower", 2.75, 3.65, z0)
        piers(g, -hx, hx, TY - hy, TY + hy, z0, z1 - 0.6)
        pent(g, -hx, hx, TY - hy, TY + hy, z1, "senw", ov, 1.3 + 0.2 * i, lift=0.5)
    # the portal: a white frame standing forward of the centre block, three bronze doors, the gilt name over it
    P = PORTAL
    g.box(-P["x"], P["x"], P["y0"], 0.0, 0.0, PL, "base", skip=("-z",))
    g.box(-P["x"], P["x"], P["y0"], P["y0"] + 0.8, P["dh"] + PL + 0.5, P["h"], "white", skip=("+y",))
    for sx in (-1, 1):
        g.box(sx * P["x"] - (1.8 if sx > 0 else 0), sx * P["x"] + (0 if sx > 0 else 1.8), P["y0"], 0.0, PL, P["h"], "white", skip=("+y",))
    for k, x in enumerate(P["doors"]):
        g.polyn([(x - P["dw"] / 2, -0.05, PL), (x + P["dw"] / 2, -0.05, PL), (x + P["dw"] / 2, -0.05, PL + P["dh"]), (x - P["dw"] / 2, -0.05, PL + P["dh"])],
                "doors", (0, -1, 0), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        if k < len(P["doors"]) - 1:     # the piers between the doors
            xm = (x + P["doors"][k + 1]) / 2
            g.box(xm - 0.7, xm + 0.7, P["y0"] + 0.4, 0.0, PL, P["dh"] + PL + 0.5, "white", skip=("+y", "-z"))
    g.polyn([(-P["x"] + 1.8, -0.05, PL), (P["x"] - 1.8, -0.05, PL), (P["x"] - 1.8, P["y0"] + 0.8, PL), (-P["x"] + 1.8, P["y0"] + 0.8, PL)], "paving", (0, 0, 1))
    g.polyn([(-P["x"] + 1.8, P["y0"] + 0.8, P["dh"] + PL + 0.5), (P["x"] - 1.8, P["y0"] + 0.8, P["dh"] + PL + 0.5), (P["x"] - 1.8, 0.0, P["dh"] + PL + 0.5), (-P["x"] + 1.8, 0.0, P["dh"] + PL + 0.5)], "soffit", (0, 0, -1))
    pent(g, -P["x"], P["x"], P["y0"], 0.0, P["h"], "sew", 1.2, 0.8)
    # the steps up to the portal and the forecourt's paving
    S = STEPS
    rise = PL / S["n"]
    for k in range(S["n"]):
        ya = P["y0"] - (S["n"] - k) * S["run"]
        g.box(-S["x"], S["x"], ya, P["y0"], k * rise, (k + 1) * rise, "base", skip=("-z", "+y"))
    g.polyn([(-54.0, -31.0, 0.03), (53.0, -31.0, 0.03), (53.0, 5.5, 0.03), (-54.0, 5.5, 0.03)], "paving", (0, 0, 1))
    body = collection("主体", main)
    g.build("Palace", body, M, TILE)
    stats["body"] = g.tris()

    # the crowning pavilion and the wings' pavilions (one mesh linked four times)
    tp = pavilion_top()
    top_ob = tp.build("Crown", body, M, TILE)
    top_ob.location = (0.0, TY, 0.0)
    stats["crown"] = tp.tris()
    parts = collection("亭", main)
    pw = mesh_of(pavilion_wing(), "WingPavilion", M, TILE)
    stats["pavilion"] = pavilion_wing().tris()
    for i, (x, y) in enumerate(PAV_AT):
        place(pw, f"Pavilion.{i}", parts, T(x, y, 0.0))

    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    lettering(font, "民族文化宫", 2.2, 13.0, "Name", M, letters, facing(0.0, P["y0"] - 0.06, (P["dh"] + PL + 0.5 + P["h"]) / 2 + 0.2, (0, -1)))
    for x, text in ((P["doors"][0], "团结"), (P["doors"][2], "进步")):
        lettering(font, text, 0.7, 1.7, f"Door{text}", M, letters, facing(x, -0.12, PL + P["dh"] * 0.62, (0, -1)))

    # the far level: the blocks, the tower's stages, the roofs as pyramids
    far = Geo()
    for name, x0, x1, y0, y1, h, sides, bay, storey in PARTS:
        far.box(x0, x1, y0, y1, 0.0, h, "white", skip=("-z", "+z"))
        far.polyn([(x0 - 1.2, y0 - 1.2, h - 0.6), (x1 + 1.2, y0 - 1.2, h - 0.6), (x1 + 1.2, y1 + 1.2, h - 0.6), (x0 - 1.2, y1 + 1.2, h - 0.6)], "tile", (0, 0, 1))
    for hx, hy, z0, z1, ov in STAGES:
        far.box(-hx, hx, TY - hy, TY + hy, z0, z1, "white", skip=("-z", "+z"))
        far.polyn([(-hx - ov, TY - hy - ov, z1 - 0.6), (hx + ov, TY - hy - ov, z1 - 0.6), (hx + ov, TY + hy + ov, z1 - 0.6), (-hx - ov, TY + hy + ov, z1 - 0.6)], "tile", (0, 0, 1))
    far.box(-TOP.IX, TOP.IX, TY - TOP.IY, TY + TOP.IY, PB, TOP.UBEAM[3], "white", skip=("-z",))
    far_pyramid(far, 0.0, TY, TOP.LOWER["A"], TOP.LOWER["z"], 2.6)
    far_pyramid(far, 0.0, TY, TOP.UPPER["A"], TOP.UPPER["z"], TOP.UPPER["H"])
    cyl(far, 0.0, TY, TOP.UPPER["z"] + TOP.UPPER["H"] - 0.2, TOP.UPPER["z"] + TOP.UPPER["H"] + 2.4, 0.5, 0.1, 6, "gold", smooth=False)
    for x, y in PAV_AT:
        far.box(x - 3.6, x + 3.6, y - 3.6, y + 3.6, PAVZ, PAV.UPPER["z"], "white", skip=("-z",))
        far_pyramid(far, x, y, PAV.UPPER["A"], PAV.UPPER["z"], PAV.UPPER["H"])
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: every block, the tower's stages, the portal's frame and piers, the steps for people
    helpers = collection("碰撞体")
    for i, (name, x0, x1, y0, y1, h, sides, bay, storey) in enumerate(PARTS):
        collider_box(helpers, f"part{i}", x0, x1, y0, y1, 0.0, h + 0.6)
    for i, (hx, hy, z0, z1, ov) in enumerate(STAGES):
        collider_box(helpers, f"stage{i}", -hx, hx, TY - hy, TY + hy, z0, z1 + 0.6)
    collider_box(helpers, "crown", -TOP.IX, TOP.IX, TY - TOP.IY, TY + TOP.IY, PB, TOP.UPPER["z"] + 2.0)
    collider_box(helpers, "portalfloor", -P["x"], P["x"], P["y0"], 0.0, 0.0, PL)
    collider_box(helpers, "portallintel", -P["x"], P["x"], P["y0"], 0.0, P["dh"] + PL + 0.5, P["h"])
    for sx in (-1, 1):
        xa, xb = sorted((sx * P["x"], sx * (P["x"] - 1.8)))
        collider_box(helpers, f"portalpier{sx:+d}", xa, xb, P["y0"], 0.0, 0.0, P["h"])
    for k in range(len(P["doors"]) - 1):
        xm = (P["doors"][k] + P["doors"][k + 1]) / 2
        collider_box(helpers, f"doorpier{k}", xm - 0.7, xm + 0.7, P["y0"] + 0.4, 0.0, 0.0, P["dh"] + PL + 0.5)
    steps_ramp(helpers, "steps", -S["x"], S["x"], P["y0"], P["y0"] - S["n"] * S["run"], PL)
    # the footprint as the plan's pieces (each block its own, so nothing round it is taken), clear ground round them
    for name, x0, x1, y0, y1, h, sides, bay, storey in PARTS:
        flat_marker(helpers, name, rect(x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5), "FOOTPRINT")
    flat_marker(helpers, "forecourt", rect(-55.0, 54.0, -32.0, 0.0), "FOOTPRINT")
    flat_marker(helpers, "front", rect(-93.0, 88.0, -35.0, 42.0), "CLEAR")
    flat_marker(helpers, "hall", rect(-16.0, 16.0, 40.0, 73.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "minzugong", "民族文化宫", "Cultural Palace of Nationalities"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -2979.6, 238.0, 0.47
    s.far_distance = 800
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
