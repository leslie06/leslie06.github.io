# 首都博物馆 Capital Museum (崔愷 / Jean-Marie Duthilleul, opened 2006), on the south side of 复兴门外大街 (长安街
# west), built in Blender and marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/capitalmuseum.py -- [--out art/landmarks/capitalmuseum.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM way 136998797 (168.7 x 89.7 m,
# the great roof's outline), heading +0.37 (its long edges).
#
# The figures (首都之窗, the museum's own page): 152 m east-west, ~66 m north-south, 41 m high. The elevation is from
# photographs (Wikimedia Commons, the north front from 长安街 and from both ends): a flat roof overhanging the box on
# every side, its soffit sloping up to a thin edge and lit by rows of louvred panels; under it the north front facing
# the avenue - a long grey stone wall (通长的石质幕墙, "the city wall") on a recessed glazed ground floor, the glass
# band of the top floors over it, and at the east end the full-height glass of the hall wrapping round the corner with
# a dark stone stair tower; the bronze drum of the oval hall (青铜, Western Zhou patterns) leaning north out of the
# stone wall, its tip ~10 m up, its rim standing over the roof; at the west end the square hall's elm (榆木) box; the
# office range along the south in stone with punched windows. Slender raking struts at the roof's corners.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, collider_box, collider_pts, flat_marker, paving, rect  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "capitalmuseum.blend")

RX, RY = 84.35, 44.85              # the roof's half extents (OSM's outline)
X0, X1, Y0, Y1 = -76.0, 76.0, -36.0, 30.0      # the box under it: 152 x 66 m
ROOF, EDGE, SOFF = 40.0, 38.7, 35.8            # roof top, the underside at its edge, the underside at the walls
STONE = dict(x0=-56.0, x1=36.0, z0=4.6, z1=25.0, base=27.2)   # the north stone wall over its recessed ground floor
GLASS_X = 36.0                     # the hall's glass from here to the east end
WOOD = dict(x0=-77.6, x1=-54.0, y0=-12.0, y1=31.4, h=31.0)    # the square hall's elm box at the west end
DARK = dict(x0=X1, x1=X1 + 4.2, y0=-8.0, y1=12.0, h=28.0)     # the stair tower against the east glass
DRUM = dict(x=22.0, y=16.5, a0=14.0, b0=11.0, a1=12.4, b1=9.6, lean=12.6, top=43.2, segs=48)


# --- textures ------------------------------------------------------------------------------------------

def stone_images(size=512):
    """The north wall: grey stone in long courses, a grid of small square openings (4 x 4 m a repeat)."""
    cv, glow = Canvas(size, size, "#8f8e89"), Canvas(size, size, "#000000")
    cv.noise(0.07, 4)
    q = size / 8
    rows = (cv.y // q).astype(int)
    cv.a *= (0.95 + 0.06 * np.sin(rows * 2.3 + (cv.x // (size / 2)) * 1.7))[..., None]
    cv.put(np.mod(cv.y, q) < 1.6, "#6f6e6a")
    cv.put(np.mod(cv.x + (rows % 2) * size / 4, size / 2) < 1.6, "#77766f")
    hole = (np.abs(np.mod(cv.x + (rows % 2) * size / 8, size / 4) - size / 8) < size / 40) & (np.abs(np.mod(cv.y, q) - q / 2) < size / 40)
    cv.put(hole, "#3b3d40")
    glow.put(hole & (rows % 3 == 1), (0.25, 0.18, 0.09))
    return image("CM_Stone", np.flipud(cv.a).copy()), image("CM_StoneNight", np.flipud(glow.a).copy())


def office_images(size=256):
    """The office range and the west end: stone with a punched window, one per 3.6 m bay and 4.2 m storey."""
    cv, glow = Canvas(size, size, "#9a978f"), Canvas(size, size, "#000000")
    cv.noise(0.06, 6)
    y, x = cv.y / size, cv.x / size
    cv.put(np.mod(cv.y, size / 3) < 1.5, "#7c7a74")
    win = (np.abs(x - 0.5) < 0.22) & (y > 0.32) & (y < 0.72)
    cv.put(win, "#2c3238")
    cv.put(win & (np.abs(x - 0.5) < 0.008), "#5b5e60")
    rng = np.random.default_rng(3)
    glow.a[win] = srgb("#ffd49a") * (0.25 + 0.35 * (rng.random((size, size), np.float32)[win][:, None] > 0.5))
    return image("CM_Office", np.flipud(cv.a).copy()), image("CM_OfficeNight", np.flipud(glow.a).copy())


def bronze_image(w=1024, h=512):
    """The drum's bronze skin (10 x 43 m a repeat round it): riveted plates, patina, a band of 饕餮 meanders at the top."""
    cv = Canvas(w, h, "#5d7366")
    cv.noise(0.1, 8)
    y, x = cv.y / h, cv.x / w                       # y from the top
    rng = np.random.default_rng(11)
    cols = (x * 8).astype(int)
    rows = (y * 20).astype(int)
    tint = rng.uniform(0.93, 1.07, (21, 9))
    cv.a *= tint[rows, cols][..., None]
    cv.put((np.mod(x * 8, 1) < 0.006) | (np.mod(y * 20, 1) < 0.012), "#465a50")
    band = (y > 0.03) & (y < 0.1)
    u, v = np.mod(x * 24, 1), (y - 0.03) / 0.07
    mean = band & ((np.abs(u - 0.5) > 0.38) | (np.abs(v - 0.5) > 0.38) | ((np.abs(u - 0.5) < 0.22) & (np.abs(v - 0.5) < 0.22) & ~((np.abs(u - 0.5) < 0.08) & (np.abs(v - 0.5) < 0.08))))
    cv.put(band, "#3c5247")
    cv.put(mean, "#6f8a72")
    cv.put((y < 0.02) | ((y > 0.1) & (y < 0.115)), "#7a6a45")
    return image("CM_Bronze", np.flipud(cv.a).copy())


def wood_images(size=256):
    """The square hall's elm cladding: warm boards, a strip window (lit at night)."""
    cv, glow = Canvas(size, size, "#b8875c"), Canvas(size, size, "#000000")
    rng = np.random.default_rng(5)
    rows = (cv.y // (size / 32)).astype(int)
    cv.a *= rng.uniform(0.93, 1.06, (33, 1))[rows][..., 0][..., None] * (0.98 + 0.03 * np.sin(cv.x * 0.11 + rows * 1.3))[..., None]
    cv.put(np.mod(cv.y, size / 32) < 0.8, "#94693f")
    win = (cv.y > size * 0.40) & (cv.y < size * 0.62) & (np.abs(cv.x / size - 0.5) < 0.40)
    cv.put(win, "#2c3236")
    cv.put(win & (np.mod(cv.x, size / 6) < 2), "#8b8d8a")
    glow.put(win & ~(np.mod(cv.x, size / 6) < 2), (0.3, 0.22, 0.12))
    return image("CM_Wood", np.flipud(cv.a).copy()), image("CM_WoodNight", np.flipud(glow.a).copy())


def soffit_images(size=512):
    """The roof's underside (12 m along by 9 m in a repeat): metal panels, a louvred light panel, lit at night."""
    cv, glow = Canvas(size, size, "#9fa3a7"), Canvas(size, size, "#000000")
    cv.noise(0.05, 2)
    y, x = cv.y / size, cv.x / size              # x along the edge, y in from the edge
    cv.put(np.mod(cv.x, size / 8) < 1.5, "#82868a")
    panel = (np.abs(x - 0.5) < 0.4) & (y > 0.08) & (y < 0.36)
    cv.put(panel, "#e6e8e9")
    cv.put(panel & (np.mod(cv.y, size / 64) < 2.5), "#9a9da0")
    glow.put(panel, (0.55, 0.5, 0.42))
    return image("CM_Soffit", np.flipud(cv.a).copy()), image("CM_SoffitNight", np.flipud(glow.a).copy())


# --- pieces --------------------------------------------------------------------------------------------

def wall(g, a, b, z0, z1, key, out, su=1.0, sv=1.0, zref=0.0):
    """A vertical face from plan point a to b; UVs: u along the wall (metres / su), v height (metres / sv)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ua, ub = a.dot(d) / su, b.dot(d) / su
    g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out[0], out[1], 0),
            uvs=[(ua, (z0 - zref) / sv), (ub, (z0 - zref) / sv), (ub, (z1 - zref) / sv), (ua, (z1 - zref) / sv)])


def box_walls(g, x0, x1, y0, y1, z0, z1, key, sides="snew", su=1.0, sv=1.0, zref=0.0):
    P = {"s": ((x0, y0), (x1, y0), (0, -1)), "e": ((x1, y0), (x1, y1), (1, 0)), "n": ((x1, y1), (x0, y1), (0, 1)), "w": ((x0, y1), (x0, y0), (-1, 0))}
    for s in sides:
        a, b, out = P[s]
        wall(g, a, b, z0, z1, key, out, su, sv, zref)


def drum_ring(z):
    t = z / DRUM["top"]
    cx, cy = DRUM["x"], DRUM["y"] + DRUM["lean"] * t
    a = DRUM["a0"] + (DRUM["a1"] - DRUM["a0"]) * t
    b = DRUM["b0"] + (DRUM["b1"] - DRUM["b0"]) * t
    n = DRUM["segs"]
    return [(cx + a * math.cos(2 * math.pi * i / n), cy + b * math.sin(2 * math.pi * i / n), z) for i in range(n)]


def perim(pts):
    return sum((Vector(pts[(i + 1) % len(pts)]) - Vector(pts[i])).length for i in range(len(pts)))


def drum(g, zs, key="bronze", segs=None):
    """The leaning oval drum: an elliptic frustum, UVs in metres round it (10 m a repeat) and up it (43 m)."""
    if segs:
        DRUM["segs"], keep = segs, DRUM["segs"]
    rings = [drum_ring(z) for z in zs]
    n = len(rings[0])
    ids = [[g.vert(p) for p in r] for r in rings]
    for j in range(len(rings) - 1):
        L0, L1 = perim(rings[j]), perim(rings[j + 1])
        for i in range(n):
            k = i + 1
            uv = [(L0 * i / n / 10, zs[j] / DRUM["top"]), (L0 * k / n / 10, zs[j] / DRUM["top"]),
                  (L1 * k / n / 10, zs[j + 1] / DRUM["top"]), (L1 * i / n / 10, zs[j + 1] / DRUM["top"])]
            g.face([ids[j][i], ids[j][k % n], ids[j + 1][k % n], ids[j + 1][i]], key, uv, smooth=True)
    top = rings[-1]
    if segs:
        DRUM["segs"] = keep
    return top


def roof(g, lod=False):
    """The great roof: flat top, a thin metal edge, the soffit sloping up to it from the walls."""
    o = [(-RX, -RY), (RX, -RY), (RX, RY), (-RX, RY)]
    i = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)]
    g.polyn([(x, y, ROOF) for x, y in o], "roof", (0, 0, 1))
    for k in range(4):
        a, b = Vector(o[k]), Vector(o[(k + 1) % 4])
        d = (b - a).normalized()
        out = (d.y, -d.x)
        wall(g, a, b, EDGE, ROOF, "metal", out)
        if lod:
            continue
        # a low upstand round the top
        ia, ib = a + Vector((-out[0], -out[1])) * 0.35, b + Vector((-out[0], -out[1])) * 0.35
        wall(g, a, b, ROOF, ROOF + 0.45, "metal", out)
        wall(g, ib, ia, ROOF, ROOF + 0.45, "metal", (-out[0], -out[1]))
        g.polyn([(a.x, a.y, ROOF + 0.45), (b.x, b.y, ROOF + 0.45), (ib.x, ib.y, ROOF + 0.45), (ia.x, ia.y, ROOF + 0.45)], "metal", (0, 0, 1))
        # the soffit: u along the edge (12 m a repeat), v in from the edge (9 m)
        ca, cb = Vector(i[k]), Vector(i[(k + 1) % 4])
        dep = abs((ca - a).dot(Vector(out)))
        ua, ub = a.dot(d) / 12, b.dot(d) / 12
        uca, ucb = ca.dot(d) / 12, cb.dot(d) / 12
        g.polyn([(a.x, a.y, EDGE), (b.x, b.y, EDGE), (cb.x, cb.y, SOFF), (ca.x, ca.y, SOFF)], "soffit", (0, 0, -1),
                uvs=[(ua, 0), (ub, 0), (ucb, dep / 9), (uca, dep / 9)])
    if lod:
        g.polyn([(x, y, EDGE) for x, y in o], "metal", (0, 0, -1))


def build_box(g, cols):
    """The walls under the roof."""
    S = STONE
    # north: the stone wall on its recessed glazed ground floor, the glass band over it, the hall's glass at the east end
    wall(g, (X1, Y1), (GLASS_X, Y1), 0.0, SOFF, "glass", (0, 1))
    wall(g, (S["x1"], Y1), (S["x0"], Y1), S["z0"], S["z1"], "stone", (0, 1), su=4.0, sv=4.0)
    wall(g, (S["x1"], Y1 - 0.4), (S["x0"], Y1 - 0.4), S["z1"], SOFF, "glass", (0, 1))
    g.polyn([(S["x0"], Y1 - 0.4, S["z1"]), (S["x1"], Y1 - 0.4, S["z1"]), (S["x1"], Y1, S["z1"]), (S["x0"], Y1, S["z1"])], "metal", (0, 0, 1))
    wall(g, (S["x1"], S["base"]), (S["x0"], S["base"]), 0.0, S["z0"], "lobby", (0, 1))
    g.polyn([(S["x0"], S["base"], S["z0"]), (S["x1"], S["base"], S["z0"]), (S["x1"], Y1, S["z0"]), (S["x0"], Y1, S["z0"])], "metal", (0, 0, -1))
    for x in (S["x0"], S["x1"]):
        s = 1 if x == S["x0"] else -1
        wall(g, (x, S["base"]), (x, Y1), 0.0, S["z0"], "darkstone", (s, 0))
    # the stone wall's ends: returns of its thickness
    k = 0
    x = S["x0"] + 4.0
    while x < S["x1"] - 2.0:
        cols.append((x, (S["base"] + Y1) / 2, 0.45, S["z0"]))
        x += 8.0
        k += 1
    # west: stone with windows behind the elm box, glass band over it
    wall(g, (X0, Y1), (X0, Y0), 0.0, 30.0, "office", (-1, 0), su=3.6, sv=4.2)
    wall(g, (X0, Y1), (X0, Y0), 30.0, SOFF, "glass", (-1, 0))
    # south: the office range
    wall(g, (X0, Y0), (X1, Y0), 0.0, 30.0, "office", (0, -1), su=3.6, sv=4.2)
    wall(g, (X0, Y0), (X1, Y0), 30.0, SOFF, "glass", (0, -1))
    # east: glass full height round the corner
    wall(g, (X1, Y0), (X1, Y1), 0.0, SOFF, "glass", (1, 0))
    # the elm box and the dark stair tower
    W = WOOD
    box_walls(g, W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"], "wood", sides="snw", su=14.4, sv=W["h"] / 3)
    wall(g, (W["x1"], W["y1"]), (W["x1"], Y1), 0.0, W["h"], "wood", (1, 0), su=14.4, sv=W["h"] / 3)
    g.polyn([(W["x0"], W["y0"], W["h"]), (W["x1"], W["y0"], W["h"]), (W["x1"], W["y1"], W["h"]), (W["x0"], W["y1"], W["h"])], "roof", (0, 0, 1))
    D = DARK
    box_walls(g, D["x0"], D["x1"], D["y0"], D["y1"], 0.0, D["h"], "darkstone", sides="sen", su=2.0, sv=2.0)
    g.polyn([(D["x0"], D["y0"], D["h"]), (D["x1"], D["y0"], D["h"]), (D["x1"], D["y1"], D["h"]), (D["x0"], D["y1"], D["h"])], "roof", (0, 0, 1))


def struts():
    """The raking struts under the roof's corners: (foot, head) pairs."""
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            foot = Vector((sx * (X1 + 3.0), sy * (abs(Y1 if sy > 0 else Y0) + 2.5), 0.0))
            head = Vector((sx * (RX - 2.5), sy * (RY - 2.5), EDGE - 0.4))
            out.append((foot, head))
    return out


def rod(g, a, b, r, key, segs=8):
    d = (b - a).normalized()
    u = d.cross(Vector((0, 0, 1)))
    if u.length < 1e-3:
        u = Vector((1, 0, 0))
    u.normalize()
    v = d.cross(u)
    ra = [g.vert(a + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    rb = [g.vert(b + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    for i in range(segs):
        k = (i + 1) % segs
        g.face([ra[i], ra[k], rb[k], rb[i]], key, smooth=True)


def build():
    clear_file()
    ensure_addon()
    st, st_n = stone_images()
    of, of_n = office_images()
    wd, wd_n = wood_images()
    so, so_n = soffit_images()
    glass = dict(floorH=4.5, colW=1.5, glass="#6f8697", frame="#c8ccd0", spandrel="#8a949c", mull=0.05, slab=0.035, metal=0.8, rough=0.06, lit=0.55, warm="#ffd9a8", seed=7)
    M = dict(
        stone=material("CM_Stone", "#8f8e89", 0.8, tex=st, emit_tex=st_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        office=material("CM_Office", "#9a978f", 0.8, tex=of, emit_tex=of_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        darkstone=material("CM_DarkStone", "#4a4a49", 0.75, props={"wet": "damp", "glowStrength": 0.5}),
        wood=material("CM_Wood", "#b07a4a", 0.6, tex=wd, emit_tex=wd_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.6}),
        glass=material("CM_Glass", "#6f8697", 0.1, metal=0.8, props={"facade": __import__("json").dumps(glass), "wet": "surface", "glow": "none"}),
        lobby=material("CM_Lobby", "#5f7483", 0.1, metal=0.8, props={"facade": __import__("json").dumps(dict(glass, floorH=4.6, colW=2.0, glass="#56697a", lit=0.85, seed=9)), "wet": "surface", "glow": "none"}),
        bronze=material("CM_Bronze", "#5d7366", 0.5, metal=0.3, tex=bronze_image(), props={"wet": "surface", "glowStrength": 0.7}),
        metal=material("CM_Metal", "#b9bdc0", 0.35, metal=0.8, props={"wet": "surface", "glow": "none"}),
        soffit=material("CM_Soffit", "#9fa3a7", 0.55, metal=0.3, tex=so, emit_tex=so_n, props={"wet": "none", "glow": "none", "emit": "night"}),
        roof=material("CM_Roof", "#7d7f80", 0.9, props={"wet": "ground", "glow": "none"}),
        paving=material("CM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5, "layer": 10}),
        steel=material("CM_Steel", "#c5c8ca", 0.3, metal=1.0, props={"wet": "surface", "glow": "none"}),
    )
    TILE = dict(darkstone=2.0, metal=3.0, roof=6.0, paving=4.0, steel=1.0)
    main = collection("首都博物馆")
    g, cols = Geo(), []
    build_box(g, cols)
    roof(g)
    # the drum: bronze from the ground (inside, hidden) through the roof to its rim, a dark top inside the rim
    top = drum(g, [0.0, 8.0, 16.0, 24.0, 32.0, 40.0, DRUM["top"]])
    c = Vector((DRUM["x"], DRUM["y"] + DRUM["lean"], DRUM["top"]))
    inner = [c + (Vector(p) - c) * 0.93 for p in top]
    n = len(top)
    for i in range(n):
        k = (i + 1) % n
        g.poly([top[i], top[k], inner[k], inner[i]], "metal")
    g.poly([Vector((p.x, p.y, p.z - 0.6)) for p in inner], "roof")
    for i in range(n):
        k = (i + 1) % n
        g.poly([inner[i], inner[k], Vector((inner[k].x, inner[k].y, inner[k].z - 0.6)), Vector((inner[i].x, inner[i].y, inner[i].z - 0.6))], "bronze")
    # columns of the ground floor and the struts
    for x, y, r, h in cols:
        g.box(x - r, x + r, y - r, y + r, 0.0, h, "steel", skip=("-z", "+z"))
    for a, b in struts():
        rod(g, a, b, 0.35, "steel")
    # paving under the roof outside the walls (the plaza runs on to the avenue)
    for x0, x1, y0, y1 in ((-RX, RX, Y1, RY), (-RX, RX, -RY, Y0), (-RX, X0, Y0, Y1), (X1, RX, Y0, Y1)):
        g.polyn([(x0, y0, 0.03), (x1, y0, 0.03), (x1, y1, 0.03), (x0, y1, 0.03)], "paving", (0, 0, 1))
    g.build("CapitalMuseum", collection("主体", main), M, TILE)
    tris = g.tris()

    # the far level
    far = Geo()
    far.box(X0, X1, Y0, Y1, 0.0, SOFF, "office", skip=("-z", "+z"))
    roof(far, lod=True)
    drum(far, [16.0, DRUM["top"]], segs=16)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the box, the stone wall's front over the recessed floor, the elm box, the stair tower, columns, struts,
    # the roof slab and the drum
    helpers = collection("碰撞体")
    S = STONE
    collider_box(helpers, "box", X0, X1, Y0, S["base"], 0.0, SOFF)
    collider_box(helpers, "stone", S["x0"], S["x1"], S["base"], Y1, S["z0"], SOFF)
    collider_box(helpers, "hallglass", S["x1"], X1, S["base"], Y1, 0.0, SOFF)
    collider_box(helpers, "westend", X0, S["x0"], S["base"], Y1, 0.0, SOFF)
    collider_box(helpers, "elm", WOOD["x0"], WOOD["x1"], WOOD["y0"], WOOD["y1"], 0.0, WOOD["h"])
    collider_box(helpers, "stairtower", DARK["x0"], DARK["x1"], DARK["y0"], DARK["y1"], 0.0, DARK["h"])
    collider_box(helpers, "roof", -RX, RX, -RY, RY, SOFF, ROOF)
    for i, (x, y, r, h) in enumerate(cols):
        collider_box(helpers, f"col{i}", x - r, x + r, y - r, y + r, 0.0, h)
    for i, (a, b) in enumerate(struts()):
        pts = [tuple(p + Vector((dx, dy, 0))) for p in (a, b) for dx in (-0.35, 0.35) for dy in (-0.35, 0.35)]
        collider_pts(helpers, f"strut{i}", pts)
    collider_pts(helpers, "drum", [p for z in (0.0, DRUM["top"]) for p in drum_ring(z)])
    flat_marker(helpers, "museum", rect(-RX, RX, -RY, RY), "FOOTPRINT")
    # the forecourt to the avenue: open paving (the learnt footprints put a block on it)
    flat_marker(helpers, "forecourt", rect(-RX, RX, RY, 86.0), "FOOTPRINT")
    flat_marker(helpers, "museum", rect(-RX - 1.5, RX + 1.5, -RY - 1.5, RY + 1.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "capitalmuseum", "首都博物馆", "Capital Museum"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.9050194", "116.3358769", 0.37
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
