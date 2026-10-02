# 北京展览馆 Beijing Exhibition Center (the Soviet Exhibition Hall, 1954), on the north side of 西直门外大街 by
# 北京动物园, built in Blender and marked with the bcity_landmark add-on's conventions (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/exhibitionhall.py -- [--out art/landmarks/exhibitionhall.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground on the building's axis at the front wall of the
# central hall, game (-5095.5, -3340), heading 0 (OSM way 72725678's edges run within 0.7 deg of the grid).
#
# The plan is OSM's outline (one way for the whole complex, 216 x 272 m, building:levels=5) squared and made
# symmetric, read with the published description (Wikipedia, 央广网): a 山-shaped Russian-classical main hall,
# the central hall in front under the tower, its two wings running east and west, reaching forward as two arms
# that close the entrance forecourt and back as two ranges that, with the central hall behind (the 工业馆) and the
# back range, enclose two inner courtyards (OSM draws the block solid; they are here). Behind it the industrial
# hall and the theatre (北展剧场) as OSM's narrower tail. The tower rises in stages - a square stage with arched
# openings and gilt pinnacles, a colonnaded square stage, an octagonal drum, the gilt bell and the gilt spire
# with its rings - to the red star (2.5 m, lit from inside since 1976) at 87 m. The portico (piers and six
# columns, an attic with 北京展览馆 in gilt), colonnades along the forecourt, cream-ochre stucco with white
# pilasters, frieze, cornice and parapet, a rusticated ground storey. Doubtful: the stages' exact proportions,
# whether the arms end in pedimented pavilions, the forecourt's colonnades (the sources speak of curved
# colonnades of 18 carved columns either side of the centre; they are straight here), the fountain's form.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import SIDES, Canvas, Geo, T, band, collider_box, collider_pts, cyl, flat_marker, fwall, lathe, mesh_of, paving, place, rect, side_line  # noqa: E402
from national_museum import facing, lettering  # noqa: E402
from zhengyangmen import steps_ramp  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "exhibitionhall.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

PL = 1.0          # the granite plinth
BAY = 6.0
# Parts: (name, x0, x1, y0, y1, height, exposed faces -> facade kind "wing" | "hall")
PARTS = [
    ("frontW", -103.5, -30.0, -2.4, 26.0, 16.0, dict(s="wing", w="wing", n="wing")),
    ("frontE", 30.0, 103.5, -2.4, 26.0, 16.0, dict(s="wing", e="wing", n="wing")),
    ("sideW", -103.5, -80.0, 26.0, 109.0, 16.0, dict(w="wing", e="wing", n="wing")),
    ("sideE", 80.0, 103.5, 26.0, 109.0, 16.0, dict(e="wing", w="wing", n="wing")),
    ("backW", -80.0, -30.0, 94.0, 109.0, 16.0, dict(s="wing", n="wing")),
    ("backE", 30.0, 80.0, 94.0, 109.0, 16.0, dict(s="wing", n="wing")),
    ("hall", -30.0, 30.0, -2.4, 40.0, 26.0, dict(s="hall", e="hall", w="hall", n="hall")),
    ("spine", -30.0, 30.0, 40.0, 109.0, 20.0, dict(e="wing", w="wing")),
    ("armW", -104.5, -79.5, -55.5, -2.4, 16.0, dict(w="wing", e="wing")),
    ("armE", 79.5, 104.5, -55.5, -2.4, 16.0, dict(w="wing", e="wing")),
    ("headW", -104.5, -67.0, -73.5, -55.5, 19.0, dict(s="wing", w="wing", e="wing", n="wing")),
    ("headE", 67.0, 104.5, -73.5, -55.5, 19.0, dict(s="wing", w="wing", e="wing", n="wing")),
    ("sideportW", -109.5, -103.5, 0.0, 27.0, 13.0, dict(w="wing", s="wing", n="wing")),
    ("sideportE", 103.5, 109.5, 0.0, 27.0, 13.0, dict(e="wing", s="wing", n="wing")),
    ("industry", -45.0, 45.0, 109.0, 140.0, 18.0, dict(e="wing", w="wing", n="wing")),
    ("theatre", -30.0, 30.0, 140.0, 186.0, 21.0, dict(e="wing", w="wing")),
    ("stage", -40.0, 40.0, 186.0, 199.6, 26.0, dict(e="wing", w="wing", n="wing", s="wing")),
]
PORTICO = dict(x=24.3, y0=-11.8, y1=-2.4, top=15.5, ent=17.5, attic=21.5, cols=(-15.0, -9.0, -3.0, 3.0, 9.0, 15.0), row=-10.2, r=0.8)
STEPS = dict(x=21.0, n=5, run=0.8)
GALLERY = dict(y=-6.4, x0=31.5, x1=75.5, wall_y=-2.4, arm_x=75.5, arm_wall=79.5, y_end=-51.5, top=9.0, ent=10.4, r=0.5)
TY = 14.0          # the tower's centre line
TOWER_A = dict(hw=10.0, z0=26.0, z1=39.0)
TOWER_B = dict(core=5.2, ring=7.0, z0=40.4, z1=48.4, ent=49.8, r=0.42)
DRUM = dict(r=4.8, z0=49.8, z1=55.8)
FOUNTAIN = dict(y=-40.0, r=11.0)


# --- textures ------------------------------------------------------------------------------------------

STUCCO = "#e3cc96"
TRIM = "#f0eadb"


def arch_mask(cv, cx, w, y_bot, y_spring, aspect):
    """An arched opening: half width w (fraction of the width), sill and spring heights (fractions from the top)."""
    x, y = cv.x / cv.w, cv.y / cv.h
    rect_ = (np.abs(x - cx) < w) & (y > y_spring) & (y < y_bot)
    head = ((x - cx) ** 2 + ((y - y_spring) * aspect) ** 2 < w * w) & (y <= y_spring)
    return rect_ | head


def wing_images(w=256, h=512):
    """One 6 m bay of a wing's wall (any height, v over the whole wall): a rusticated ground storey with an
    arched window, a white string course, the upper storey's window under a hood."""
    cv, glow = Canvas(w, h, STUCCO), Canvas(w, h, "#000000")
    cv.noise(0.06, 3)
    x, y = cv.x / w, cv.y / h                      # y down from the top of the wall
    aspect = h / w / 2.07                          # pixels are not square: 6 m across, ~12.4 m up
    ground = y > 0.5
    cv.put(ground & (np.mod(cv.y, h * 0.05) < 2.2), "#c9b07a")          # rustication joints
    cv.put((y > 0.47) & (y < 0.5), TRIM)                                 # string course
    gw = arch_mask(cv, 0.5, 0.2, 0.93, 0.66, aspect)
    gf = arch_mask(cv, 0.5, 0.245, 0.95, 0.66, aspect) & ~gw
    uw = (np.abs(x - 0.5) < 0.16) & (y > 0.17) & (y < 0.4)
    uf = (np.abs(x - 0.5) < 0.2) & (y > 0.14) & (y < 0.43) & ~uw
    hood = (np.abs(x - 0.5) < 0.24) & (y > 0.1) & (y < 0.135)
    cv.put(gf | uf | hood, TRIM)
    win = gw | uw
    glass = srgb("#2c3540") + (0.15 * (1 - y))[..., None] * srgb("#7d90a3")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(x - 0.5) < 0.006) | (np.abs(y - 0.8) < 0.004) | (np.abs(y - 0.28) < 0.004))
    cv.put(bars, "#e8e1d0")
    cv.put((y < 0.035), "#d8bf88")                                       # shadow under the frieze
    rng = np.random.default_rng(5)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffc77f") * (0.3 + 0.35 * rng.random((h, w), np.float32)[lit][:, None])
    return image("EX_Wing", np.flipud(cv.a).copy()), image("EX_WingNight", np.flipud(glow.a).copy())


def hall_images(w=256, h=512):
    """One 6 m bay of the central hall and the tower: a tall arched window in a white frame, a round window over it."""
    cv, glow = Canvas(w, h, STUCCO), Canvas(w, h, "#000000")
    cv.noise(0.06, 4)
    x, y = cv.x / w, cv.y / h
    aspect = h / w / 3.6
    cv.put((y > 0.88) & (np.mod(cv.y, h * 0.03) < 2.0), "#c9b07a")
    cv.put((y > 0.86) & (y < 0.88), TRIM)
    win = arch_mask(cv, 0.5, 0.21, 0.84, 0.3, aspect)
    fr = arch_mask(cv, 0.5, 0.26, 0.86, 0.3, aspect) & ~win
    occ = ((x - 0.5) ** 2 + ((y - 0.12) * aspect) ** 2) < 0.1 ** 2
    occf = ((x - 0.5) ** 2 + ((y - 0.12) * aspect) ** 2) < 0.135 ** 2
    cv.put(fr | (occf & ~occ), TRIM)
    win = win | occ
    glass = srgb("#2a333d") + (0.15 * (1 - y))[..., None] * srgb("#7d90a3")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(x - 0.5) < 0.006) | (np.mod(cv.y, h * 0.09) < 1.5))
    cv.put(bars, "#e8e1d0")
    rng = np.random.default_rng(6)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffcc88") * (0.35 + 0.3 * rng.random((h, w), np.float32)[lit][:, None])
    return image("EX_Hall", np.flipud(cv.a).copy()), image("EX_HallNight", np.flipud(glow.a).copy())


# --- walls, cornices, parapets -------------------------------------------------------------------------

def part(g, x0, x1, y0, y1, h, faces, pil):
    """Plinth, walls (UVs: one bay a repeat, v over the wall), frieze, cornice and parapet, the flat roof."""
    wall_top = h - 2.6
    for side, kind in faces.items():
        out = SIDES[side]
        a, b = side_line(x0, x1, y0, y1, side)
        pa, pb = side_line(x0, x1, y0, y1, side, 0.4)
        fwall(g, pa, pb, 0.0, PL, "plinth", out)
        g.polyn([(pa.x, pa.y, PL), (pb.x, pb.y, PL), (b.x, b.y, PL), (a.x, a.y, PL)], "plinth", (0, 0, 1))
        fwall(g, a, b, PL, wall_top, kind, out, bay=BAY, storey=wall_top - PL, zref=PL)
        fwall(g, a, b, wall_top, h - 1.6, "trim", out)
        L = (b - a).length
        n = max(1, round(L / BAY))
        yaw = math.atan2(out[1], out[0]) - math.pi / 2
        for k in range(n + 1):
            pil.append((a.lerp(b, k / n), yaw, wall_top))
    for side in faces:
        ox, oy = SIDES[side]
        band(g, x0, x1, y0, y1, side, 0.0, h - 1.6, 0.9, h - 1.6, "trim", faces)
        band(g, x0, x1, y0, y1, side, 0.9, h - 1.6, 0.9, h - 1.05, "trim", faces)
        band(g, x0, x1, y0, y1, side, 0.9, h - 1.05, 0.0, h - 0.9, "trim", faces)
        band(g, x0, x1, y0, y1, side, 0.0, h - 0.9, 0.0, h + 0.35, "trim", faces)
        band(g, x0, x1, y0, y1, side, 0.0, h + 0.35, -0.4, h + 0.35, "trim", faces)
        a, b = side_line(x0, x1, y0, y1, side, -0.4)
        g.polyn([(a.x, a.y, h - 0.9), (b.x, b.y, h - 0.9), (b.x, b.y, h + 0.35), (a.x, a.y, h + 0.35)], "trim", (-ox, -oy, 0))
    g.polyn([(x0, y0, h - 0.9), (x1, y0, h - 0.9), (x1, y1, h - 0.9), (x0, y1, h - 0.9)], "roof", (0, 0, 1))


def pediment(g, x0, x1, y, z, rise, depth, out):
    """A triangular pediment on a front at y (out -1: facing south), a gable roof running `depth` m back from it."""
    xm = (x0 + x1) / 2
    yb = y - out * depth
    g.polyn([(x0, y, z), (x1, y, z), (xm, y, z + rise)], "trim", (0, out, 0))
    g.polyn([(x0, yb, z), (x1, yb, z), (xm, yb, z + rise)], "trim", (0, -out, 0))
    for xa, sgn in ((x0, -1), (x1, 1)):
        g.polyn([(xa, y + out * 0.5, z), (xm, y + out * 0.5, z + rise + 0.3), (xm, yb, z + rise + 0.3), (xa, yb, z)], "roof", (sgn, 0, 1))
    g.box(x0 - 0.4, x1 + 0.4, min(y, y + out * 0.6), max(y, y + out * 0.6), z - 0.6, z, "trim", skip=("-z",))


# --- repeated parts --------------------------------------------------------------------------------------

def column_geo(r, h, segs=12):
    """A round classical column, r radius, h tall from its foot: square plinth, torus base, tapering shaft, capital, abacus."""
    g = Geo()
    g.box(-1.35 * r, 1.35 * r, -1.35 * r, 1.35 * r, 0.0, 0.45 * r, "trim", skip=("-z",))
    lathe(g, [(1.18 * r, 0.45 * r), (1.2 * r, 0.7 * r), (1.0 * r, 0.95 * r), (1.0 * r, 1.05 * r), (0.86 * r, h - 1.7 * r),
              (0.95 * r, h - 1.5 * r), (1.0 * r, h - 1.2 * r), (1.25 * r, h - 0.55 * r)], segs, "trim")
    g.box(-1.4 * r, 1.4 * r, -1.4 * r, 1.4 * r, h - 0.55 * r, h, "trim", skip=("-z",))
    return g


def pilaster_geo():
    g = Geo()
    g.box(-0.55, 0.55, 0.0, 0.32, 0.0, 1.0, "trim", skip=("-z", "+y"))
    return g


def pinnacle_geo():
    """A gilt pinnacle on a stone pedestal for the tower's corners (5.5 m)."""
    g = Geo()
    g.box(-0.9, 0.9, -0.9, 0.9, 0.0, 1.6, "trim", skip=("-z",))
    g.box(-1.05, 1.05, -1.05, 1.05, 1.6, 1.85, "trim", skip=("-z",))
    lathe(g, [(0.75, 1.85), (0.55, 2.4), (0.6, 2.7), (0.32, 3.1), (0.22, 4.6), (0.3, 4.8), (0.0, 5.5)], 8, "gold")
    return g


def star_geo(R=1.25, depth=0.35):
    """The five-pointed star facing south and north, bulged to a ridge, its centre at the origin (XZ plane)."""
    g = Geo()
    rim = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = R if i % 2 == 0 else R * 0.4
        rim.append(Vector((rr * math.cos(a), 0.0, rr * math.sin(a))))
    for s in (-1, 1):
        c = Vector((0.0, s * depth, 0.0))
        for i in range(10):
            p, q = rim[i], rim[(i + 1) % 10]
            g.polyn([c, p, q], "star", (0, s, 0))
    return g


# --- the building ----------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    wing, wing_n = wing_images()
    hall, hall_n = hall_images()
    M = dict(
        wing=material("EX_Wing", STUCCO, 0.8, tex=wing, emit_tex=wing_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.3}),
        hall=material("EX_Hall", STUCCO, 0.8, tex=hall, emit_tex=hall_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.4}),
        trim=material("EX_Trim", TRIM, 0.6, props={"wet": "damp", "glowStrength": 0.38}),
        plinth=material("EX_Plinth", "#9e988c", 0.8, props={"wet": "ground", "glowStrength": 0.3}),
        roof=material("EX_Roof", "#7d7f7a", 0.85, props={"wet": "ground", "glow": "none"}),
        gold=material("EX_Gold", "#e2b04a", 0.28, metal=1.0, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.72, 0.32], "glowStrength": 0.45}),
        star=material("EX_Star", "#c41a14", 0.35, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.08, 0.04], "glowStrength": 1.6}),
        paving=material("EX_Paving", "#a7a196", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5, "layer": 10}),
        water=material("EX_Water", "#4d6c76", 0.08, props={"wet": "none", "glow": "none", "layer": 11}),
        farwall=material("EX_FarWall", "#dcc895", 0.85, props={"wet": "damp", "glowStrength": 0.3}),
    )
    TILE = dict(trim=2.0, plinth=2.0, roof=8.0, paving=4.0, gold=2.0, water=8.0, farwall=8.0)
    main = collection("北京展览馆")
    g, pil = Geo(), []
    for name, x0, x1, y0, y1, h, faces in PARTS:
        part(g, x0, x1, y0, y1, h, faces, pil)
    # pediments over the arms' head pavilions, facing the street
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 67.0, sx * 104.5))
        pediment(g, x0 + 4.0, x1 - 4.0, -73.5, 19.35, 4.2, 6.0, -1)

    # the portico: floor and steps, two piers either end, the entablature, the attic and its cornice
    P = PORTICO
    g.box(-P["x"], P["x"], P["y0"], P["y1"], 0.0, PL, "plinth", skip=("-z", "+z"))
    g.polyn([(-P["x"], P["y0"], PL), (P["x"], P["y0"], PL), (P["x"], P["y1"], PL), (-P["x"], P["y1"], PL)], "paving", (0, 0, 1))
    S = STEPS
    rise = PL / S["n"]
    for k in range(S["n"]):
        ya = P["y0"] - (S["n"] - k) * S["run"]
        g.box(-S["x"], S["x"], ya, ya + S["run"], 0.0, (k + 1) * rise, "plinth", skip=("-z", "+y"))
    for sx in (-1, 1):
        xa, xb = sorted((sx * (P["x"] - 2.6), sx * P["x"]))
        g.box(xa, xb, P["y0"], P["y1"], PL, P["top"], "trim", skip=("-z",))
    g.box(-P["x"], P["x"], P["y0"], P["y1"], P["top"], P["ent"], "trim", skip=("+z",))
    g.box(-P["x"] + 0.6, P["x"] - 0.6, P["y0"] + 0.5, P["y1"], P["ent"], P["attic"], "trim", skip=("-z", "+z"))
    pf = dict(s=1, e=1, w=1)
    for side in ("s", "e", "w"):
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.0, P["attic"], 0.7, P["attic"], "trim", pf)
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.7, P["attic"], 0.7, P["attic"] + 0.6, "trim", pf)
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.7, P["attic"] + 0.6, 0.0, P["attic"] + 0.7, "trim", pf)
    g.polyn([(-P["x"], P["y0"], P["attic"] + 0.7), (P["x"], P["y0"], P["attic"] + 0.7), (P["x"], P["y1"], P["attic"] + 0.7), (-P["x"], P["y1"], P["attic"] + 0.7)], "roof", (0, 0, 1))
    # the attic's crest: a gilt wreath-like disc with the star, flanked by flag staffs
    g.box(-4.5, 4.5, P["y0"] + 0.8, P["y0"] + 2.2, P["attic"] + 0.7, P["attic"] + 2.2, "trim", skip=("-z",))

    # colonnades along the forecourt: the front's either side of the portico and the arms', an entablature and a terrace
    G = GALLERY
    for sx in (-1, 1):
        xa, xb = sorted((sx * 24.3, sx * G["arm_wall"]))
        g.box(xa, xb, G["y"] - 0.8, G["wall_y"], G["top"], G["ent"], "trim", skip=())
        xa, xb = sorted((sx * (G["arm_x"] - 0.8), sx * G["arm_wall"]))
        g.box(xa, xb, -55.5, G["y"] - 0.8, G["top"], G["ent"], "trim", skip=())
    # the forecourt's paving and the fountain
    for poly in (rect(-79.5, 79.5, -55.5, -2.4), rect(-67.0, 67.0, -73.5, -55.5)):
        g.polyn([(x, y, 0.03) for x, y in poly], "paving", (0, 0, 1))
    F = FOUNTAIN
    cyl(g, 0.0, F["y"], 0.0, 0.6, F["r"] + 0.5, F["r"] + 0.5, 32, "trim", smooth=False, caps=(False, False))
    cyl(g, 0.0, F["y"], 0.6, 0.6, F["r"] + 0.5, F["r"], 32, "trim", smooth=False, caps=(False, False))
    cyl(g, 0.0, F["y"], 0.6, 0.4, F["r"], F["r"], 32, "trim", smooth=False, caps=(False, False))
    ring = [(F["r"] * math.cos(2 * math.pi * i / 32), F["y"] + F["r"] * math.sin(2 * math.pi * i / 32), 0.4) for i in range(32)]
    g.polyn(ring, "water", (0, 0, 1))
    lathe(g, [(1.6, 0.4), (1.2, 1.0), (0.5, 1.4), (0.45, 2.4), (2.6, 2.7), (2.4, 3.0), (0.4, 3.1), (0.35, 4.0), (1.3, 4.2), (1.2, 4.45), (0.2, 4.5), (0.0, 5.2)],
          16, "trim", 0.0, F["y"])
    g.polyn([(2.35 * math.cos(2 * math.pi * i / 16), F["y"] + 2.35 * math.sin(2 * math.pi * i / 16), 2.95) for i in range(16)], "water", (0, 0, 1))

    # the tower: stage A on the hall's roof with arched openings, gilt pinnacles at its corners
    A, B, D = TOWER_A, TOWER_B, DRUM
    tw = dict(s=1, e=1, n=1, w=1)
    for side in ("s", "e", "n", "w"):
        a, b = side_line(-A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], side)
        fwall(g, a, b, A["z0"], A["z1"] - 1.2, "hall", SIDES[side], bay=A["hw"] * 2 / 3, storey=A["z1"] - 1.2 - A["z0"] + 2.0, zref=A["z0"] - 2.0)
        fwall(g, a, b, A["z1"] - 1.2, A["z1"], "trim", SIDES[side])
        band(g, -A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], side, 0.0, A["z1"], 0.8, A["z1"], "trim", tw)
        band(g, -A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], side, 0.8, A["z1"], 0.8, A["z1"] + 0.6, "trim", tw)
        band(g, -A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], side, 0.8, A["z1"] + 0.6, 0.0, A["z1"] + 0.7, "trim", tw)
    g.polyn([(-A["hw"], TY - A["hw"], A["z1"] + 0.7), (A["hw"], TY - A["hw"], A["z1"] + 0.7), (A["hw"], TY + A["hw"], A["z1"] + 0.7), (-A["hw"], TY + A["hw"], A["z1"] + 0.7)], "roof", (0, 0, 1))
    # stage B: a core with tall windows inside a square colonnade, its entablature and cornice
    for side in ("s", "e", "n", "w"):
        a, b = side_line(-B["core"], B["core"], TY - B["core"], TY + B["core"], side)
        fwall(g, a, b, B["z0"] - 0.7, B["z1"], "hall", SIDES[side], bay=B["core"] * 2 / 2, storey=B["z1"] - B["z0"] + 1.5, zref=B["z0"] - 1.3)
    g.box(-B["ring"] - 0.9, B["ring"] + 0.9, TY - B["ring"] - 0.9, TY + B["ring"] + 0.9, A["z1"] + 0.7, B["z0"], "trim", skip=("-z",))
    r0, r1 = B["ring"] + 0.7, B["core"]
    for z in (B["z1"],):
        # the entablature: a square frame from the colonnade to the core
        for (xa, xb, ya, yb) in ((-r0, r0, TY - r0, TY - r1), (-r0, r0, TY + r1, TY + r0), (-r0, -r1, TY - r1, TY + r1), (r1, r0, TY - r1, TY + r1)):
            g.box(xa, xb, ya, yb, z, B["ent"], "trim", skip=("+z",))
    bf = dict(s=1, e=1, n=1, w=1)
    for side in ("s", "e", "n", "w"):
        band(g, -r0, r0, TY - r0, TY + r0, side, 0.0, B["ent"], 0.6, B["ent"], "trim", bf)
        band(g, -r0, r0, TY - r0, TY + r0, side, 0.6, B["ent"], 0.6, B["ent"] + 0.5, "trim", bf)
        band(g, -r0, r0, TY - r0, TY + r0, side, 0.6, B["ent"] + 0.5, 0.0, B["ent"] + 0.6, "trim", bf)
    g.polyn([(-r0, TY - r0, B["ent"] + 0.6), (r0, TY - r0, B["ent"] + 0.6), (r0, TY + r0, B["ent"] + 0.6), (-r0, TY + r0, B["ent"] + 0.6)], "roof", (0, 0, 1))
    # the octagonal drum, its cornice, the gilt bell and the spire with its rings, the star
    z0 = B["ent"] + 0.6
    cyl(g, 0.0, TY, z0, z0 + 0.8, D["r"] + 0.6, D["r"] + 0.6, 8, "trim", smooth=False, caps=(False, True))
    # the drum's faces: give each its window (UV across one face, v up the drum)
    ring8 = [(D["r"] * math.cos(math.pi / 8 + i * math.pi / 4), D["r"] * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]
    zd0, zd1 = z0 + 0.8, z0 + 0.8 + (D["z1"] - D["z0"])
    for i in range(8):
        (ax, ay), (bx, by) = ring8[i], ring8[(i + 1) % 8]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        g.polyn([(ax, TY + ay, zd0), (bx, TY + by, zd0), (bx, TY + by, zd1), (ax, TY + ay, zd1)], "hall", (mx, my, 0),
                uvs=[(0, 0.05), (1, 0.05), (1, 0.95), (0, 0.95)])
    for i in range(8):
        ax, ay = ring8[i]
        nx, ny = ax / D["r"], ay / D["r"]
        p = Vector((ax * 1.03, TY + ay * 1.03))
        t = Vector((-ny, nx)) * 0.22
        n_ = Vector((nx, ny)) * 0.25
        q = [p - t, p + t, p + t + n_, p - t + n_]
        g.polyn([(v.x, v.y, zd0) for v in q], "trim", (0, 0, -1))
        for j in range(4):
            u, w = q[j], q[(j + 1) % 4]
            mid = (u + w) / 2 - p
            g.polyn([(u.x, u.y, zd0), (w.x, w.y, zd0), (w.x, w.y, zd1), (u.x, u.y, zd1)], "trim", (mid.x, mid.y, 0))
    cyl(g, 0.0, TY, zd1, zd1 + 0.7, D["r"] + 0.5, D["r"] + 0.5, 8, "trim", smooth=False, caps=(True, True))
    zb = zd1 + 0.7
    lathe(g, [(D["r"] - 0.2, zb), (D["r"] - 0.6, zb + 1.2), (3.2, zb + 2.4), (2.2, zb + 3.4), (1.5, zb + 3.9), (1.7, zb + 4.3),
              (1.25, zb + 4.6), (1.05, zb + 7.5), (1.3, zb + 7.8), (1.3, zb + 8.1), (0.85, zb + 8.4), (0.7, zb + 13.5),
              (0.92, zb + 13.8), (0.92, zb + 14.1), (0.55, zb + 14.4), (0.4, zb + 19.0), (0.55, zb + 19.3), (0.3, zb + 19.6),
              (0.12, 83.5), (0.32, 83.7), (0.12, 84.0), (0.08, 84.3)], 8, "gold", 0.0, TY)
    st = mesh_of(star_geo(), "Star", M, TILE)
    parts = collection("柱与饰", main)
    place(st, "Star", parts, T(0.0, TY, 85.6))

    body = collection("主体", main)
    g.build("Hall", body, M, TILE)
    tris = g.tris()

    # columns, pilasters, pinnacles
    big = mesh_of(column_geo(P["r"], P["top"] - PL), "PorticoColumn", M, TILE)
    gal = mesh_of(column_geo(G["r"], G["top"]), "GalleryColumn", M, TILE)
    tc = mesh_of(column_geo(B["r"], B["z1"] - B["z0"], 10), "TowerColumn", M, TILE)
    pl = mesh_of(pilaster_geo(), "Pilaster", M, TILE)
    pin = mesh_of(pinnacle_geo(), "Pinnacle", M, TILE)
    cols = []          # (x, y, r, z0, z1) for the colliders
    for x in P["cols"]:
        place(big, f"Portico.{len(cols):03d}", parts, T(x, P["row"], PL))
        cols.append((x, P["row"], P["r"] * 1.35, PL, P["top"]))
    n = 12
    for sx in (-1, 1):
        for i in range(n):
            x = sx * (G["x0"] + (G["x1"] - G["x0"]) * i / (n - 1))
            place(gal, f"Gallery.{len(cols):03d}", parts, T(x, G["y"], 0.0))
            cols.append((x, G["y"], G["r"] * 1.35, 0.0, G["top"]))
        for i in range(1, n):
            y = G["y"] + (G["y_end"] - G["y"]) * i / (n - 1)
            place(gal, f"Gallery.{len(cols):03d}", parts, T(sx * G["arm_x"], y, 0.0))
            cols.append((sx * G["arm_x"], y, G["r"] * 1.35, 0.0, G["top"]))
    k = 0
    for i in range(4):
        for j in range(4):
            if 0 < i < 3 and 0 < j < 3:
                continue
            x = -B["ring"] + 2 * B["ring"] * i / 3
            y = TY - B["ring"] + 2 * B["ring"] * j / 3
            place(tc, f"TowerCol.{k:03d}", parts, T(x, y, B["z0"]))
            k += 1
    for sx in (-1, 1):
        for sy in (-1, 1):
            place(pin, f"Pinnacle.{sx}{sy}", parts, T(sx * (A["hw"] - 0.6), TY + sy * (A["hw"] - 0.6), A["z1"] + 0.7))
    for sx in (-1, 1):
        place(pin, f"PorticoPin.{sx}", parts, T(sx * (P["x"] - 1.3), P["y0"] + 1.4, P["attic"] + 0.7) @ Matrix.Diagonal((0.8, 0.8, 0.8, 1)))
    for i, (p, yaw, top) in enumerate(pil):
        place(pl, f"Pilaster.{i:03d}", parts, T(p.x, p.y, PL) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((1, 1, top - PL, 1)))
    # the tower stage A's faces: pilasters at the bays
    for side in ("s", "e", "n", "w"):
        out = SIDES[side]
        a, b = side_line(-A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], side)
        yaw = math.atan2(out[1], out[0]) - math.pi / 2
        for k2 in range(4):
            p = a.lerp(b, k2 / 3)
            place(pl, f"TowerPil.{side}{k2}", parts, T(p.x, p.y, A["z0"]) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((1.2, 1.2, A["z1"] - 1.2 - A["z0"], 1)))

    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    lettering(font, "北京展览馆", 2.3, 17.0, "Name", M, letters, facing(0.0, P["y0"] + 0.48, (P["ent"] + P["attic"]) / 2, (0, -1)))

    # the far level: the parts as boxes, the portico, the tower's stages, the drum, the spire and the star
    far = Geo()
    for name, x0, x1, y0, y1, h, faces in PARTS:
        far.box(x0, x1, y0, y1, 0.0, h + 0.35, "farwall", skip=("-z", "+z"))
        far.polyn([(x0, y0, h + 0.35), (x1, y0, h + 0.35), (x1, y1, h + 0.35), (x0, y1, h + 0.35)], "roof", (0, 0, 1))
    far.box(-P["x"], P["x"], P["y0"], P["y1"], 0.0, P["attic"] + 0.7, "farwall", skip=("-z",))
    far.box(-A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], A["z0"], A["z1"] + 0.7, "farwall", skip=("-z",))
    far.box(-r0, r0, TY - r0, TY + r0, A["z1"] + 0.7, B["ent"] + 0.6, "farwall", skip=("-z",))
    cyl(far, 0.0, TY, z0, zb, D["r"] + 0.3, D["r"] + 0.3, 8, "farwall", smooth=False, caps=(False, True))
    lathe(far, [(D["r"] - 0.2, zb), (3.0, zb + 2.6), (1.4, zb + 4.2), (0.9, zb + 8.0), (0.55, zb + 14.0), (0.1, 84.3)], 6, "gold", 0.0, TY)
    far.add(star_geo(), T(0.0, TY, 85.6))
    lod = collection("LOD1", main)
    far.build("Massing", lod, M, TILE)

    # colliders: every part a box, the portico (floor, piers, columns), the steps for people, the colonnades,
    # the fountain, the tower; the footprint in pieces and the clear ground
    helpers = collection("碰撞体")
    for i, (name, x0, x1, y0, y1, h, faces) in enumerate(PARTS):
        collider_box(helpers, f"part{i}", x0, x1, y0, y1, 0.0, h)
    collider_box(helpers, "porticofloor", -P["x"], P["x"], P["y0"], P["y1"], 0.0, PL)
    for sx in (-1, 1):
        xa, xb = sorted((sx * (P["x"] - 2.6), sx * P["x"]))
        collider_box(helpers, f"pier{sx:+d}", xa, xb, P["y0"], P["y1"], PL, P["top"])
    collider_box(helpers, "entablature", -P["x"], P["x"], P["y0"], P["y1"], P["top"], P["attic"] + 0.7)
    steps_ramp(helpers, "steps", -S["x"], S["x"], P["y0"], P["y0"] - S["n"] * S["run"], PL)
    for i, (x, y, r, za, zb_) in enumerate(cols):
        collider_box(helpers, f"col{i:03d}", x - r, x + r, y - r, y + r, za, zb_)
    for sx in (-1, 1):
        xa, xb = sorted((sx * 24.3, sx * G["arm_wall"]))
        collider_box(helpers, f"gallery{sx:+d}", xa, xb, G["y"] - 0.8, G["wall_y"], G["top"], G["ent"])
        xa, xb = sorted((sx * (G["arm_x"] - 0.8), sx * G["arm_wall"]))
        collider_box(helpers, f"armgallery{sx:+d}", xa, xb, -55.5, G["y"] - 0.8, G["top"], G["ent"])
    fr = F["r"] + 0.5
    collider_pts(helpers, "fountain", [(fr * math.cos(2 * math.pi * i / 16), F["y"] + fr * math.sin(2 * math.pi * i / 16), z) for i in range(16) for z in (0.0, 0.6)])
    collider_box(helpers, "towerA", -A["hw"], A["hw"], TY - A["hw"], TY + A["hw"], A["z0"], A["z1"] + 0.7)
    collider_box(helpers, "towerB", -r0, r0, TY - r0, TY + r0, A["z1"] + 0.7, B["ent"] + 0.6)
    collider_box(helpers, "drum", -D["r"], D["r"], TY - D["r"], TY + D["r"], z0, zb + 4.0)
    collider_box(helpers, "spire", -0.8, 0.8, TY - 0.8, TY + 0.8, zb + 4.0, 86.8)
    for i, poly in enumerate((rect(-110.0, 110.0, -3.0, 110.0), rect(-25.0, 25.0, -16.5, -2.0), rect(-105.5, -66.0, -74.5, -2.0),
                              rect(66.0, 105.5, -76.0, -2.0), rect(-48.5, 43.5, 108.0, 200.5))):
        flat_marker(helpers, f"ex{i}", poly, "FOOTPRINT")
    flat_marker(helpers, "court", rect(-113.0, 113.0, -78.0, 113.0), "CLEAR")
    flat_marker(helpers, "back", rect(-51.0, 47.0, 108.0, 203.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "exhibitionhall", "北京展览馆", "Beijing Exhibition Center"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -5095.5, -3340.0, 0.0
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, pilasters=len(pil), columns=len(cols))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
