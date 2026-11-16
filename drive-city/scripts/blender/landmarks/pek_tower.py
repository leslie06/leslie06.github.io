# 首都机场塔台 Beijing Capital Airport control tower (2026-11-16, airport batch 2), built in Blender and marked with
# the bcity_landmark add-on's conventions.
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/pek_tower.py -- [--out art/landmarks/pektower.blend] [--export]
#
# OSM: way 1279565754 (aeroway=tower, building=yes, height=98.3, freestanding; Commons "Beijing Capital International
# Airport BCIA Control Tower.jpg"), a 23 m circle north of T3E between the second and third runways. The city drew it
# as a 98 m station prism.
#
# The figures: OSM's height (98.3 m) and footing; a 2002 report on the new tower (封顶 at 99 m: 外观与中央电视塔
# 相似, 平面呈正八边形, 清水混凝土); the brief's 细腰的塔身, 顶上一圈倾斜的玻璃 (the cab glass leaning out), antennas and
# a radome on the roof, red aviation lights at night. Not measured off drawings: the storey heights, the waist (4.8 m
# against 7.2 m at the foot), the cab (82.6-90 m) and the equipment floors under it are proportions from photographs
# remembered, not surveyed.
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM's circle (40.0802590,
# 116.6069025; game 17874.78, -19083.39), heading 0. The octagon's flat faces look north, south, east and west.
#
# Parts, bottom to top: the octagonal two-storey podium (r 12, 9 m: a glazed ground floor with doors on the south,
# a band of windows); the fair-faced concrete shaft (formwork lines, a slot of stair windows up its south face)
# narrowing to the waist at 50 m and flaring out to carry the head; the equipment floors (74-82 m, ribbon windows);
# the catwalk slab; the cab - eight panes leaning out 13 degrees between thin mullions (the kit's facade shader,
# lit at night); the overhanging roof and its soffit; the roof drum, the radome and a lattice mast to 98.3 m. Red
# aviation lights (glow lamp) round the roof, at the flare, the waist and on the mast.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_pts, flat_marker  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "pektower.blend")

TAU = 2 * math.pi
TOP = 98.3
POD_R, POD_H = 12.0, 9.0
# the shaft's octagon circumradius by height (the waist at 50 m, the flare carrying the head)
SHAFT = [(POD_H, 7.2), (20.0, 6.4), (35.0, 5.3), (50.0, 4.8), (62.0, 5.3), (69.0, 6.3), (74.0, 9.0)]
EQ0, EQ1, EQ_R = 74.0, 82.0, 9.0          # equipment floors
DECK_R = 10.4                              # catwalk slab under the cab
CAB0, CAB1, CAB_R0, CAB_R1 = 82.6, 90.0, 9.1, 10.8
ROOF0, ROOF1, ROOF_R = 90.0, 91.2, 11.3
DRUM_R, DRUM1 = 4.6, 93.6


def oct_ring(r, n=8):
    """A regular polygon (circumradius r), flat faces on the axes for n = 8."""
    return [(r * math.cos(math.pi / n + TAU * i / n), r * math.sin(math.pi / n + TAU * i / n)) for i in range(n)]


def oct16(r):
    """The octagon with its facets' midpoints: the cab's mullions (every half facet) then run along edges."""
    o = oct_ring(r)
    out = []
    for i in range(8):
        a, b = o[i], o[(i + 1) % 8]
        out += [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)]
    return out


def skin(g, rings, key, us=1.0, vs=1.0, smooth=False, inward=False):
    """Faces between closed rings [(z, pts)] of the same count; u metres along the ring (scaled to the first
    ring's perimeter, so columns taper), v metres up the slant; both divided by us / vs for textures."""
    m = len(rings[0][1])

    def per(pts):
        return sum(math.hypot(pts[(i + 1) % m][0] - pts[i][0], pts[(i + 1) % m][1] - pts[i][1]) for i in range(m))

    ref = per(rings[0][1])
    ids = [[g.vert((x, y, z)) for (x, y) in pts] for z, pts in rings]
    us_ = []
    for z, pts in rings:
        k = ref / per(pts)
        u, row = 0.0, [0.0]
        for i in range(1, m + 1):
            a, b = pts[i - 1], pts[i % m]
            u += math.hypot(b[0] - a[0], b[1] - a[1]) * k
            row.append(u)
        us_.append(row)
    v = [0.0]
    for j in range(1, len(rings)):
        (z0, p0), (z1, p1) = rings[j - 1], rings[j]
        dr = math.hypot(p1[0][0] - p0[0][0], p1[0][1] - p0[0][1])
        v.append(v[-1] + math.hypot(dr, z1 - z0))
    v = [x + rings[0][0] for x in v]
    for j in range(len(rings) - 1):
        for i in range(m):
            a, b = ids[j][i], ids[j][(i + 1) % m]
            c, d = ids[j + 1][(i + 1) % m], ids[j + 1][i]
            uv = [(us_[j][i] / us, v[j] / vs), (us_[j][i + 1] / us, v[j] / vs), (us_[j + 1][i + 1] / us, v[j + 1] / vs), (us_[j + 1][i] / us, v[j + 1] / vs)]
            if inward:
                g.face([d, c, b, a], key, uv[::-1], smooth)
            else:
                g.face([a, b, c, d], key, uv, smooth)


def disc(g, z, pts, key, up=True):
    g.polyn([(x, y, z) for x, y in pts], key, (0, 0, 1 if up else -1))


def annulus(g, z, outer, inner, key, up=True):
    m = len(outer)
    for i in range(m):
        j = (i + 1) % m
        g.polyn([(*outer[i], z), (*outer[j], z), (*inner[j], z), (*inner[i], z)], key, (0, 0, 1 if up else -1))


def concrete_image():
    """Fair-faced concrete, 8 m a repeat: formwork panels 2.4 x 1.2 m with tie holes, faint streaks."""
    cv = Canvas(256, 256, "#c9c6bf")
    cv.noise(0.05, 3)
    rng = np.random.default_rng(11)
    cv.a *= np.repeat(rng.uniform(0.96, 1.03, 64), 4)[None, :, None]
    py = 256 / 8 * 1.2                    # 1.2 m courses
    px = 256 / 8 * 2.4
    cv.put(np.mod(cv.y, py) < 1.2, "#aeaaa2")
    cv.put(np.mod(cv.x + (np.floor(cv.y / py) % 2) * px / 2, px) < 1.0, "#b8b4ac")
    for yy in np.arange(py / 4, 256, py / 2):
        for xx in np.arange(px / 6, 256, px / 3):
            cv.ellipse(xx, yy, 0.9, 0.9, "#9a968e")
    return image("PT_Concrete", np.flipud(cv.a).copy())


def materials():
    cab = dict(floorH=7.4, colW=3.48, glass="#2f4650", frame="#d9dcdc", spandrel="#d9dcdc", mull=0.025, slab=0.02,
               metal=0.85, rough=0.05, lit=0.85, warm="#cfe8ff", cool="#9fd0ff", coolShare=0.7, seed=31)
    eq = dict(floorH=4.0, colW=1.6, glass="#3b4c56", frame="#cfd0cd", spandrel="#cfd0cd", mull=0.05, slab=0.42,
              metal=0.6, rough=0.15, lit=0.55, warm="#ffe1b0", coolShare=0.3, seed=32)
    pod = dict(floorH=4.5, colW=1.8, glass="#405a66", frame="#c8c9c6", spandrel="#c8c9c6", mull=0.04, slab=0.2,
               metal=0.7, rough=0.08, lit=0.7, warm="#ffd9a8", coolShare=0.1, seed=33)
    return dict(
        concrete=material("PT_Concrete", "#c9c6bf", 0.85, tex=concrete_image(), props={"wet": "damp", "glowStrength": 0.7}),
        white=material("PT_White", "#e4e5e2", 0.5, metal=0.2, props={"wet": "surface", "glowStrength": 0.6}),
        steel=material("PT_Steel", "#8d9296", 0.4, metal=0.8, props={"wet": "surface", "glow": "none"}),
        dark=material("PT_Dark", "#33373a", 0.6, metal=0.3, props={"wet": "surface", "glow": "none"}),
        roof=material("PT_Roof", "#7a7c7b", 0.85, props={"wet": "ground", "glow": "none"}),
        cab=facade("PT_Cab", cab),
        eq=facade("PT_Equip", eq),
        pod=facade("PT_Podium", pod),
        slot=facade("PT_Slot", dict(eq, floorH=3.0, colW=1.2, slab=0.5, mull=0.12, lit=0.6, seed=34)),
        red=material("PT_Red", "#b01810", 0.4, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.04, 0.02], "glowStrength": 9.0}),
    )


TILE = dict(roof=4.0, dark=2.0, steel=2.0, white=3.0)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("塔台")
    helpers = collection("碰撞体")
    g = Geo()

    # ---- the podium: glazed ground floor, a window band, a flat roof with a parapet
    pr = oct_ring(POD_R)
    skin(g, [(0.0, pr), (4.6, pr)], "pod")
    g_band = oct_ring(POD_R + 0.25)
    skin(g, [(4.6, g_band), (5.2, g_band)], "white")
    annulus(g, 4.6, g_band, pr, "white", up=False)
    annulus(g, 5.2, g_band, oct_ring(POD_R), "white")
    skin(g, [(5.2, pr), (POD_H - 0.9, pr)], "pod")
    skin(g, [(POD_H - 0.9, pr), (POD_H, pr)], "white")
    inner = oct_ring(POD_R - 0.35)
    annulus(g, POD_H, pr, inner, "white")
    skin(g, [(POD_H - 0.5, inner), (POD_H, inner)], "white", inward=True)
    annulus(g, POD_H - 0.5, inner, oct_ring(SHAFT[0][1]), "roof")
    # the entrance on the south face: a canopy and a dark door recess
    fy = -POD_R * math.cos(math.pi / 8)
    g.box(-4.2, 4.2, fy - 4.0, fy, 3.6, 4.0, "white")
    g.box(-2.6, 2.6, fy - 0.02, fy + 0.05, 0.0, 3.0, "dark", skip=("-z", "+z", "+y"))
    for x in (-3.9, 3.9):
        g.box(x - 0.15, x + 0.15, fy - 3.8, fy - 3.5, 0.0, 3.6, "steel", skip=("-z",))

    # ---- the shaft: octagonal fair-faced concrete, waisted
    rings = [(z, oct_ring(r)) for z, r in SHAFT]
    skin(g, rings, "concrete", us=8.0, vs=8.0)
    # a slot of stair windows up the south face, standing 0.12 m proud
    for (z0, r0), (z1, r1) in zip(SHAFT[:-2], SHAFT[1:-1]):
        a0, a1 = r0 * math.cos(math.pi / 8) + 0.12, r1 * math.cos(math.pi / 8) + 0.12
        w = 0.7
        g.poly([(-w, -a0, z0 + 0.5), (w, -a0, z0 + 0.5), (w, -a1, z1 - 0.5), (-w, -a1, z1 - 0.5)], "slot",
               [(0, z0 + 0.5), (2 * w, z0 + 0.5), (2 * w, z1 - 0.5), (0, z1 - 0.5)])

    # ---- the head: equipment floors, the catwalk, the cab leaning out, the roof
    er = oct_ring(EQ_R)
    annulus(g, EQ0, er, oct_ring(SHAFT[-1][1]), "white", up=False) if EQ_R > SHAFT[-1][1] else None
    skin(g, [(EQ0, er), (EQ1, er)], "eq")
    dr = oct_ring(DECK_R)
    skin(g, [(EQ1, dr), (CAB0, dr)], "white")
    annulus(g, EQ1, dr, er, "white", up=False)
    annulus(g, CAB0, dr, oct_ring(CAB_R0), "roof")
    # catwalk railing: a top rail ring and posts at the corners (linked through the Geo, cheap)
    rr = oct_ring(DECK_R - 0.1)
    skin(g, [(CAB0 + 1.0, rr), (CAB0 + 1.08, rr)], "steel")
    for x, y in rr:
        g.box(x - 0.04, x + 0.04, y - 0.04, y + 0.04, CAB0, CAB0 + 1.05, "steel", skip=("-z",))
    # the cab: eight panes leaning out
    # (a vertex at every mullion: across a trapezoid's two triangles the shader's lines would kink)
    skin(g, [(CAB0 + (CAB1 - CAB0) * t, oct16(CAB_R0 + (CAB_R1 - CAB_R0) * t)) for t in (0.0, 1.0)], "cab")
    # the roof: soffit, fascia, top, the drum, the radome on its pedestal, the lattice mast
    ro = oct_ring(ROOF_R)
    annulus(g, ROOF0, ro, oct_ring(CAB_R1), "white", up=False)
    skin(g, [(ROOF0, ro), (ROOF1, ro)], "white")
    annulus(g, ROOF1, ro, oct_ring(DRUM_R), "roof")
    dm = oct_ring(DRUM_R)
    skin(g, [(ROOF1, dm), (DRUM1, dm)], "white")
    disc(g, DRUM1, dm, "roof")
    # radome: a sphere on a short column, east of centre
    rx, ry, rz, rad = 1.6, -0.8, DRUM1 + 2.2, 1.55
    nu, nv = 12, 7
    ids = []
    for j in range(nv + 1):
        th = math.pi * j / nv
        ids.append([g.vert((rx + rad * math.sin(th) * math.cos(TAU * i / nu), ry + rad * math.sin(th) * math.sin(TAU * i / nu), rz - rad * math.cos(th))) for i in range(nu)])
    for j in range(nv):
        for i in range(nu):
            k = (i + 1) % nu
            g.face([ids[j][i], ids[j][k], ids[j + 1][k], ids[j + 1][i]], "white", None, True)
    g.box(rx - 0.4, rx + 0.4, ry - 0.4, ry + 0.4, DRUM1, rz - rad + 0.1, "steel", skip=("-z",))
    # the mast: a three-legged lattice, legs and a few rungs
    mx, my = -1.6, 1.2
    legs = [(mx + 0.45 * math.cos(TAU * i / 3), my + 0.45 * math.sin(TAU * i / 3)) for i in range(3)]
    for lx, ly in legs:
        g.box(lx - 0.05, lx + 0.05, ly - 0.05, ly + 0.05, DRUM1, TOP - 0.4, "steel", skip=("-z",))
    for z in np.arange(DRUM1 + 0.6, TOP - 0.4, 0.9):
        for i in range(3):
            (ax, ay), (bx, by) = legs[i], legs[(i + 1) % 3]
            g.poly([(ax, ay, z), (bx, by, z), (bx, by, z + 0.06), (ax, ay, z + 0.06)], "steel")
    g.box(mx - 0.08, mx + 0.08, my - 0.08, my + 0.08, TOP - 0.4, TOP - 0.25, "steel")
    # small antennas round the roof edge
    for i in range(0, 8, 2):
        a = math.pi / 8 + TAU * i / 8
        x, y = (ROOF_R - 1.4) * math.cos(a), (ROOF_R - 1.4) * math.sin(a)
        g.box(x - 0.05, x + 0.05, y - 0.05, y + 0.05, ROOF1, ROOF1 + 2.6, "steel", skip=("-z",))

    # ---- aviation lights
    L = Geo()
    lamps = [(mx, my, TOP - 0.25)]
    for z, r in ((ROOF1, ROOF_R - 0.3), (EQ0 - 0.6, SHAFT[-1][1] * 0.93), (50.0, 4.8 * 0.95), (POD_H, POD_R - 0.4)):
        for i in range(1, 8, 2):
            a = math.pi / 8 + TAU * i / 8
            lamps.append((r * math.cos(a), r * math.sin(a), z))
    for x, y, z in lamps:
        L.box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, z, z + 0.6, "red")

    det = collection("塔", main)
    g.build("Tower", det, M, TILE)
    L.build("Lights", det, M, TILE)
    tris = g.tris() + L.tris()

    # ---- far level: octagons only
    f = Geo()
    skin(f, [(0.0, pr), (POD_H, pr)], "pod")
    annulus(f, POD_H, pr, oct_ring(SHAFT[0][1]), "roof")
    skin(f, [(z, oct_ring(r)) for z, r in SHAFT[::2] + [SHAFT[-1]]], "concrete", us=8.0, vs=8.0)
    skin(f, [(EQ0, er), (EQ1, er)], "eq")
    skin(f, [(EQ1, dr), (CAB0, dr)], "white")
    annulus(f, EQ1, dr, er, "white", up=False)
    skin(f, [(CAB0, oct_ring(CAB_R0)), (CAB1, oct_ring(CAB_R1))], "cab")
    annulus(f, ROOF0, ro, oct_ring(CAB_R1), "white", up=False)
    skin(f, [(ROOF0, ro), (ROOF1, ro)], "white")
    disc(f, ROOF1, ro, "roof")
    f.box(mx - 0.3, mx + 0.3, my - 0.3, my + 0.3, ROOF1, TOP - 0.4, "steel", skip=("-z",))
    for x, y, z in lamps[:1] + lamps[1:5]:
        f.box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, z, z + 0.8, "red", skip=("-z",))
    far = collection("LOD1", main)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    # ---- colliders: the podium, the shaft in three frustums, the head
    def prism(name, z0, r0, z1, r1):
        collider_pts(helpers, name, [(x, y, z0) for x, y in oct_ring(r0)] + [(x, y, z1) for x, y in oct_ring(r1)])

    prism("podium", 0.0, POD_R, POD_H, POD_R)
    for (z0, r0), (z1, r1) in ((SHAFT[0], SHAFT[2]), (SHAFT[2], SHAFT[4]), (SHAFT[4], SHAFT[6])):
        prism("shaft", z0, r0, z1, r1)
    prism("head", EQ0, DECK_R, ROOF1, ROOF_R)
    collider_pts(helpers, "canopy", [(x, y, z) for x in (-4.2, 4.2) for y in (fy - 4.0, fy) for z in (3.6, 4.0)])

    fp = oct_ring(POD_R + 1.0, 16)
    flat_marker(helpers, "tower", fp, "FOOTPRINT")
    flat_marker(helpers, "tower", oct_ring(POD_R + 5.5, 16), "CLEAR")

    sc = bpy.context.scene.bcity
    sc.lm_id, sc.name_zh, sc.name_en = "pektower", "首都机场塔台", "Capital Airport Control Tower"
    sc.coord_mode, sc.lat, sc.lon, sc.heading = "LATLON", "40.0802590", "116.6069025", 0.0
    sc.far_distance = 900
    sc.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
