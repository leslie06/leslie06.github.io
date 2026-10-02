# 中国人民革命军事博物馆 Military Museum of the Chinese People's Revolution, on 复兴路 at 公主坟, built in
# Blender and marked with the bcity_landmark add-on's conventions (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/militarymuseum.py -- [--out art/landmarks/militarymuseum.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# It clears the open file first. Frame: Blender +X east, +Y north, metres, origin on the ground on the
# building's axis at game (-6806.3, 64.0), heading +0.4 (OSM's outline, relation 963097, leans 0.4 deg
# clockwise). The outline is the building as it is since the 2012-2017 rebuild (217.6 x 178.4 m): the
# 1959 south block kept and refaced as it was, new halls behind it and on both ends. OSM's notches put
# the front porch 7 m east of the axis that the rest of the outline (and 3D-GloBFP's tower) is symmetric
# about; the model is symmetric about that axis.
#
# What is modelled, from the published figures (94.7 m to the top, the centre seven storeys, the sides
# four, a 6 m gilt 八一 emblem on the round tower at the top) and the building's composition (three parts
# up, five across): the end pavilions projecting 22.5 m (27 m), the four-storey wings (24 m), the
# seven-storey centre (44 m) with the colonnaded porch over the broad front steps and the inscription
# 中国人民革命军事博物馆 in gilt on its entablature, the tower stepping back in three stages to the round
# drum, and the star on top - red with a gilt rim, 八一 in gilt on both faces. Cream stone, vertical
# window strips between pilasters, stone cornices and parapets. Heights are estimates where no figure
# was found (the wings and centre from 3D-GloBFP, which reads them 21-24 m and 38-47 m).

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import SIDES, Canvas, Geo, T, band, collider_box, cyl, flat_marker, fwall, lathe, mesh_of, paving, place, rect, side_line  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "militarymuseum.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

PLINTH = 1.5
FRONT = -66.4          # the wings' and the centre's south face
# Parts: (name, x0, x1, y0, y1, z0, h, faces, storeys, bay). Faces as in national_museum.py.
PARTS = [
    ("west wing", -80.8, -28.0, FRONT, -30.0, 0.0, 24.0, "s", 4, 4.5),
    ("east wing", 28.0, 80.8, FRONT, -30.0, 0.0, 24.0, "s", 4, 4.5),
    ("back", -108.8, 108.8, -30.0, 89.5, 0.0, 24.0, "ewn", 4, 4.5),
    ("west pavilion", -108.8, -80.8, -88.9, -30.0, 0.0, 27.0, "swe", 4, 4.0),
    ("east pavilion", 80.8, 108.8, -88.9, -30.0, 0.0, 27.0, "sew", 4, 4.0),
    ("centre", -28.0, 28.0, FRONT, -26.0, 0.0, 44.0, "sewn", 7, 4.0),
]
TY = -46.0             # the tower's axis
STAGES = [             # (half x, half y, z0, z1, storeys, bay)
    (13.0, 11.0, 44.0, 60.0, 3, 3.25),
    (9.5, 8.0, 60.0, 71.0, 2, 3.2),
    (6.5, 6.5, 71.0, 80.0, 2, 3.25),
]
DRUM = dict(r=5.0, z0=80.0, z1=85.5)
STAR = dict(z=91.7, R=3.0)            # its top point at 94.7
PORCH = dict(x=26.35, y0=-73.5, y1=FRONT, floor=1.8, top=17.0, h=20.5, cols=8, col=1.5)
STEPS = dict(y=-81.5, n=12)           # broad steps from the porch floor down to the plaza


# --- textures ------------------------------------------------------------------------------------------

def facade_images(size=512):
    """One bay by one storey: cream stone, a tall window over a bronze spandrel so the bays read as strips."""
    cv, glow = Canvas(size, size, "#d8cdb2"), Canvas(size, size, "#000000")
    cv.noise(0.07, 5)
    y, x = cv.y / size, cv.x / size          # y down from the top of the storey
    strip = np.abs(x - 0.5) < 0.24
    win = strip & (y > 0.04) & (y < 0.74)
    span = strip & (y >= 0.74) & (y < 0.96)
    frame = (np.abs(x - 0.5) < 0.27) & ~strip
    cv.put(frame, "#e6dcc6")
    glass = srgb("#28313a") + (0.14 * y)[..., None] * srgb("#8a9aab")
    cv.a[win] = glass[win]
    cv.put(span, "#5e4c36")
    cv.put(span & (np.abs(np.mod(x * 6, 1) - 0.5) < 0.04), "#7a6448")
    bars = win & ((np.abs(x - 0.5) < 0.006) | (np.abs(y - 0.3) < 0.007))
    cv.put(bars, "#9a8f7a")
    cv.put(np.mod(cv.y, size / 4) < 1.5, cv.a[2, 2] * 0.92)                       # coursing
    rng = np.random.default_rng(8)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffcf8a") * (0.25 + 0.35 * rng.random((size, size), np.float32)[lit][:, None])
    return image("MM_Facade", np.flipud(cv.a).copy()), image("MM_FacadeNight", np.flipud(glow.a).copy())


def door_images(size=256):
    """A 4 x 4 m module of the porch's back wall: bronze doors under a glazed transom, lit at night."""
    cv, glow = Canvas(size, size, "#cfc3a6"), Canvas(size, size, "#000000")
    y, x = cv.y / size, cv.x / size
    door = (np.abs(x - 0.5) < 0.36) & (y > 0.3)
    trans = (np.abs(x - 0.5) < 0.36) & (y > 0.06) & (y < 0.26)
    cv.put(door, "#4f3f2c")
    cv.put(door & ((np.abs(x - 0.5) < 0.01) | (np.mod(y * 8, 1) < 0.05)), "#7d6647")
    cv.put(trans, "#2b333b")
    glow.put(trans, (0.3, 0.21, 0.1))
    return image("MM_Doors", np.flipud(cv.a).copy()), image("MM_DoorsNight", np.flipud(glow.a).copy())


# --- walls and cornices --------------------------------------------------------------------------------

def part(g, x0, x1, y0, y1, z0, h, faces, storeys, bay, pil, plinth=True, corn=0.9):
    """Walls (a plinth at the foot), a frieze, the cornice and parapet, the flat roof; pilaster spots in `pil`."""
    faces = {s: 1 for s in faces}
    top = h - 3.6
    zb = PLINTH if plinth else z0
    storey = (top - zb) / storeys
    for side in faces:
        out = SIDES[side]
        a, b = side_line(x0, x1, y0, y1, side)
        if plinth:
            pa, pb = side_line(x0, x1, y0, y1, side, 0.35)
            fwall(g, pa, pb, 0.0, PLINTH, "base", out, bay=2.0, storey=2.0)
            g.polyn([(pa.x, pa.y, PLINTH), (pb.x, pb.y, PLINTH), (b.x, b.y, PLINTH), (a.x, a.y, PLINTH)], "base", (0, 0, 1))
        fwall(g, a, b, zb, top, "facade", out, bay=bay, storey=storey, zref=zb)
        fwall(g, a, b, top, h - 2.4, "stone", out)
        L = (b - a).length
        n = max(1, round(L / bay))
        yaw = math.atan2(out[1], out[0]) - math.pi / 2
        for k in range(n + 1):
            pil.append((a.lerp(b, k / n), yaw, zb, top))
    for side in faces:
        band(g, x0, x1, y0, y1, side, 0.0, h - 2.4, corn, h - 2.4, "stone", faces)
        band(g, x0, x1, y0, y1, side, corn, h - 2.4, corn, h - 1.6, "stone", faces)
        band(g, x0, x1, y0, y1, side, corn, h - 1.6, 0.3, h - 1.6, "stone", faces)
        band(g, x0, x1, y0, y1, side, 0.3, h - 1.6, 0.3, h, "stone", faces)
        band(g, x0, x1, y0, y1, side, 0.3, top, 0.3, top + 0.35, "stone", faces)     # string course under the frieze
        band(g, x0, x1, y0, y1, side, 0.0, top, 0.3, top, "stone", faces)
        band(g, x0, x1, y0, y1, side, 0.3, top + 0.35, 0.0, top + 0.35, "stone", faces)
    g.polyn([(x0 - 0.3, y0 - 0.3, h), (x1 + 0.3, y0 - 0.3, h), (x1 + 0.3, y1 + 0.3, h), (x0 - 0.3, y1 + 0.3, h)], "roof", (0, 0, 1))


def pinnacle(g, x, y, z, s):
    """A stepped stone pinnacle on a parapet corner, s metres square."""
    g.box(x - s / 2, x + s / 2, y - s / 2, y + s / 2, z, z + 1.6 * s, "stone", skip=("-z",))
    g.box(x - s * 0.38, x + s * 0.38, y - s * 0.38, y + s * 0.38, z + 1.6 * s, z + 2.2 * s, "stone", skip=("-z",))
    apex = (x, y, z + 3.4 * s)
    r = s * 0.3
    c = [(x - r, y - r, z + 2.2 * s), (x + r, y - r, z + 2.2 * s), (x + r, y + r, z + 2.2 * s), (x - r, y + r, z + 2.2 * s)]
    for i in range(4):
        g.poly([c[i], c[(i + 1) % 4], apex], "stone")


def lettering(font, text, height, width, name, M, coll, m, key="gold", depth=0.1):
    """Lettering standing `height` m tall and `width` m long, placed by matrix m (text in its XY plane)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, font, 1.0, depth
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.15
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    kx, ky, cx, cy = width / (max(xs) - min(xs)), height / (max(ys) - min(ys)), (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector(((v.co.x - cx) * kx, (v.co.y - cy) * ky, v.co.z))
    me.materials.append(M[key])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def facing(x, y, z, out):
    """Matrix putting a text's XY plane upright at (x, y, z), reading left to right as seen from `out`."""
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(x, y, z) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def sq_column():
    """A square column one unit tall (scaled per use): shaft, a stepped base and capital."""
    g = Geo()
    g.box(-0.5, 0.5, -0.5, 0.5, 0.0, 1.0, "stone", skip=("-z",))
    g.box(-0.62, 0.62, -0.62, 0.62, 0.0, 0.04, "base", skip=("-z",))
    g.box(-0.62, 0.62, -0.62, 0.62, 0.955, 1.0, "stone")
    return g


def pilaster():
    g = Geo()
    g.box(-0.45, 0.45, 0.0, 0.4, 0.0, 1.0, "stone", skip=("-z", "+y"))
    return g


def star_pts(R, cx=0.0, cz=0.0):
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        r = R if i % 2 == 0 else R * 0.382
        pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def star_prism(g, pts, y0, y1, face, side):
    """A star in the XZ plane between y0 (south) and y1 (north): faces `face`, the edges `side`."""
    c = Vector((sum(p[0] for p in pts) / len(pts), 0, sum(p[1] for p in pts) / len(pts)))
    for y, want in ((y0, -1), (y1, 1)):
        ring = [Vector((p[0], y, p[1])) for p in pts]
        cc = Vector((c.x, y, c.z))
        for i in range(len(ring)):
            g.polyn([cc, ring[i], ring[(i + 1) % len(ring)]], face, (0, want, 0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        mid = Vector(((a[0] + b[0]) / 2 - c.x, 0, (a[1] + b[1]) / 2 - c.z))
        g.polyn([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], side, tuple(mid.normalized()))


# --- the building ----------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    fac, fac_night = facade_images()
    door, door_night = door_images()
    M = dict(
        facade=material("MM_Facade", "#d8cdb2", 0.75, tex=fac, emit_tex=fac_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.55}),
        stone=material("MM_Stone", "#dcd1b6", 0.7, props={"wet": "damp", "glowStrength": 0.55}),
        base=material("MM_Base", "#9d9584", 0.8, props={"wet": "ground", "glowStrength": 0.5}),
        roof=material("MM_Roof", "#8a8781", 0.9, props={"wet": "ground", "glow": "none"}),
        doors=material("MM_Doors", "#cfc3a6", 0.6, tex=door, emit_tex=door_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.4}),
        dark=material("MM_Dark", "#2c3238", 0.25, metal=0.3, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.8, 0.5], "glowStrength": 0.25}),
        gold=material("MM_Gold", "#e6b545", 0.28, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.78, 0.4], "glowStrength": 0.6}),
        red=material("MM_Red", "#b8241c", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.25, 0.15], "glowStrength": 0.5}),
        paving=material("MM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.4}),
    )
    TILE = dict(stone=2.0, base=2.0, roof=8.0, dark=2.0, gold=2.0, red=2.0, paving=4.0)
    main = collection("军事博物馆")
    g, pil = Geo(), []
    for name, x0, x1, y0, y1, z0, h, faces, storeys, bay in PARTS:
        part(g, x0, x1, y0, y1, z0, h, faces, storeys, bay, pil)
    # pinnacles on the pavilions' and the centre's corners
    for sx in (-1, 1):
        for x, y in ((108.8, -88.9), (80.8, -88.9)):
            pinnacle(g, sx * x, y, 27.0, 1.1)
        pinnacle(g, sx * 28.0, FRONT, 44.0, 1.3)
        pinnacle(g, sx * 28.0, -26.0, 44.0, 1.3)

    # the tower: three stages stepping back, pinnacles on each corner, the round drum
    for i, (hx, hy, z0, z1, storeys, bay) in enumerate(STAGES):
        part(g, -hx, hx, TY - hy, TY + hy, z0, z1, "sewn", storeys, bay, pil, plinth=False, corn=0.6)
        for sx in (-1, 1):
            for sy in (-1, 1):
                pinnacle(g, sx * hx, TY + sy * hy, z1, 0.9 - 0.15 * i)
    D = DRUM
    cyl(g, 0.0, TY, D["z0"], D["z1"], D["r"], D["r"], 16, "dark", caps=(False, False))
    lathe(g, [(D["r"] + 0.6, D["z0"]), (D["r"] + 0.6, D["z0"] + 0.6), (D["r"] + 0.3, D["z0"] + 0.6)], 16, "stone", y=TY)
    lathe(g, [(D["r"] + 0.2, D["z1"]), (D["r"] + 0.7, D["z1"] + 0.5), (D["r"] + 0.7, D["z1"] + 1.0), (D["r"] - 0.4, D["z1"] + 1.0),
              (2.0, D["z1"] + 1.6), (1.4, D["z1"] + 1.6), (0.0, D["z1"] + 1.6)], 16, "stone", y=TY)
    # ribs between the drum's windows (boxes turned round the axis)
    for i in range(16):
        a = 2 * math.pi * (i + 0.5) / 16
        rib = Geo()
        rib.box(-0.1, 0.55, -0.62, 0.62, D["z0"] + 0.6, D["z1"], "stone", skip=("-z", "+z"))
        g.add(rib, T(0.0, TY, 0.0) @ Matrix.Rotation(a, 4, "Z") @ T(D["r"] - 0.1, 0.0, 0.0))

    # on the back halls' roof: two glazed lanterns over the halls and plant housings
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 40.0, sx * 72.0))
        g.box(x0, x1, -8.0, 70.0, 24.0, 25.6, "stone", skip=("-z", "+z"))
        for k in range(8):
            ya = -8.0 + k * 9.75
            xa, xb = x0 + 0.6, x1 - 0.6
            g.polyn([(xa, ya, 25.6), (xb, ya, 25.6), ((xa + xb) / 2, ya + 4.875, 27.4)], "dark", (0, -1, 0.5))
            g.polyn([(xb, ya + 9.75, 25.6), (xa, ya + 9.75, 25.6), ((xa + xb) / 2, ya + 4.875, 27.4)], "dark", (0, 1, 0.5))
            g.polyn([(xa, ya, 25.6), ((xa + xb) / 2, ya + 4.875, 27.4), (xa, ya + 9.75, 25.6)], "dark", (-1, 0, 0.5))
            g.polyn([(xb, ya, 25.6), (xb, ya + 9.75, 25.6), ((xa + xb) / 2, ya + 4.875, 27.4)], "dark", (1, 0, 0.5))
        g.polyn([(x0, -8.0, 25.6), (x1, -8.0, 25.6), (x1, 70.0, 25.6), (x0, 70.0, 25.6)], "roof", (0, 0, 1))
    for x0, x1, y0, y1, hh in ((-14.0, 14.0, 20.0, 48.0, 3.5), (-96.0, -84.0, 50.0, 76.0, 2.6), (84.0, 96.0, 50.0, 76.0, 2.6), (-20.0, 20.0, 66.0, 78.0, 2.2)):
        g.box(x0, x1, y0, y1, 24.0, 24.0 + hh, "stone", skip=("-z",))

    # the star: a gilt neck from the drum, the red star with its gilt rim, 八一 on both faces
    S = STAR
    zc = S["z"]
    low = zc - S["R"] * 0.809
    cyl(g, 0.0, TY, D["z1"] + 1.6, D["z1"] + 2.1, 1.3, 1.1, 12, "gold", caps=(False, True))
    cyl(g, 0.0, TY, D["z1"] + 2.1, low + 0.6, 0.55, 0.45, 10, "gold", caps=(False, True))
    star_prism(g, [(x, z) for x, z in star_pts(S["R"], 0.0, zc)], TY - 0.25, TY + 0.25, "gold", "gold")
    star_prism(g, [(x, z) for x, z in star_pts(S["R"] * 0.84, 0.0, zc)], TY - 0.33, TY + 0.33, "red", "gold")

    # the porch: floor, back wall with doors, soffit and entablature
    P = PORCH
    g.box(-P["x"], P["x"], P["y0"], P["y1"], 0.0, P["floor"], "base", skip=("-z", "+z"))
    g.polyn([(-P["x"], P["y0"], P["floor"]), (P["x"], P["y0"], P["floor"]), (P["x"], P["y1"], P["floor"]), (-P["x"], P["y1"], P["floor"])], "paving", (0, 0, 1))
    g.polyn([(-P["x"], P["y1"] - 0.05, P["floor"]), (P["x"], P["y1"] - 0.05, P["floor"]), (P["x"], P["y1"] - 0.05, P["floor"] + 6.0), (-P["x"], P["y1"] - 0.05, P["floor"] + 6.0)],
            "doors", (0, -1, 0), uvs=[(0, 0), (13, 0), (13, 1.5), (0, 1.5)])
    g.box(-P["x"], P["x"], P["y0"], P["y1"], P["top"], P["h"], "stone", skip=("+y",))
    for sx in (-1, 1):   # end piers, solid, framing the colonnade
        g.box(sx * P["x"] - (2.6 if sx > 0 else 0), sx * P["x"] + (0 if sx > 0 else 2.6), P["y0"], P["y1"], P["floor"], P["top"], "stone", skip=("-z", "+y"))
    faces = dict(s=1, e=1, w=1)
    for side in faces:
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.0, P["h"], 0.6, P["h"], "stone", faces)
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.6, P["h"], 0.6, P["h"] + 0.5, "stone", faces)
        band(g, -P["x"], P["x"], P["y0"], P["y1"], side, 0.6, P["h"] + 0.5, 0.0, P["h"] + 0.5, "stone", faces)
    g.polyn([(-P["x"], P["y0"], P["h"] + 0.5), (P["x"], P["y0"], P["h"] + 0.5), (P["x"], P["y1"], P["h"] + 0.5), (-P["x"], P["y1"], P["h"] + 0.5)], "roof", (0, 0, 1))
    # the broad steps down to the plaza, the ones alongside down from the plinth
    rise, n = P["floor"] / STEPS["n"], STEPS["n"]
    run = (P["y0"] - STEPS["y"]) / n
    sw = P["x"] + 2.0
    for k in range(n):
        ya = STEPS["y"] + k * run
        g.box(-sw, sw, ya, P["y0"], k * rise, (k + 1) * rise, "base", skip=("-z", "+z", "+y"))
        g.polyn([(-sw, ya, (k + 1) * rise), (sw, ya, (k + 1) * rise), (sw, ya + run, (k + 1) * rise), (-sw, ya + run, (k + 1) * rise)], "paving", (0, 0, 1))
    for sx in (-1, 1):   # the cheek walls either side of the flight
        x0, x1 = sorted((sx * sw, sx * (sw + 1.4)))
        g.box(x0, x1, STEPS["y"], P["y0"], 0.0, P["floor"] + 0.5, "base", skip=("-z",))
    front = collection("主体", main)
    g.build("Museum", front, M, TILE)
    tris = g.tris()

    # the columns, pilasters and lettering
    parts = collection("柱", main)
    col = mesh_of(sq_column(), "SquareColumn", M, TILE)
    pl = mesh_of(pilaster(), "Pilaster", M, TILE)
    ncol = 0
    span = 2 * (P["x"] - 2.6) - 2.0
    for i in range(P["cols"]):
        x = -span / 2 + span * i / (P["cols"] - 1)
        place(col, f"Porch.{i:03d}", parts, T(x, P["y0"] + 1.4, P["floor"]) @ Matrix.Diagonal((P["col"], P["col"], P["top"] - P["floor"], 1)))
        ncol += 1
    for i, (p, yaw, z0, top) in enumerate(pil):
        place(pl, f"Pilaster.{i:03d}", parts, T(p.x, p.y, z0) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((1, 1, top - z0, 1)))
    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    lettering(font, "中国人民革命军事博物馆", 1.9, 34.0, "Name", M, letters, facing(0.0, P["y0"] - 0.06, (P["top"] + P["h"]) / 2, (0, -1)))
    for want, y in ((-1, TY - 0.33), (1, TY + 0.33)):
        lettering(font, "八一", 1.5, 2.6, f"Bayi{want:+d}", M, letters, facing(0.0, y + 0.03 * want, zc - 0.15, (0, want)), depth=0.04)

    # the far level: the parts as boxes, the porch, the tower stages, the drum and the star
    far = Geo()
    for name, x0, x1, y0, y1, z0, h, faces, storeys, bay in PARTS:
        far.box(x0, x1, y0, y1, 0.0, h, "stone", skip=("-z",))
    far.box(-P["x"], P["x"], P["y0"], P["y1"], 0.0, P["h"] + 0.5, "stone", skip=("-z",))
    for hx, hy, z0, z1, storeys, bay in STAGES:
        far.box(-hx, hx, TY - hy, TY + hy, z0, z1, "stone", skip=("-z",))
    cyl(far, 0.0, TY, D["z0"], D["z1"] + 1.6, D["r"], D["r"] - 0.4, 8, "stone", smooth=False)
    cyl(far, 0.0, TY, D["z1"] + 1.6, low + 0.6, 0.6, 0.45, 6, "gold", smooth=False)
    star_prism(far, star_pts(S["R"], 0.0, zc), TY - 0.3, TY + 0.3, "gold", "gold")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: every part a box, the porch's floor, end piers, columns and entablature, the steps a ramp
    import bcity_landmark
    helpers = collection("碰撞体")
    for i, (name, x0, x1, y0, y1, z0, h, faces, storeys, bay) in enumerate(PARTS):
        collider_box(helpers, f"part{i}", x0, x1, y0, y1, 0.0, h)
    for i, (hx, hy, z0, z1, storeys, bay) in enumerate(STAGES):
        collider_box(helpers, f"stage{i}", -hx, hx, TY - hy, TY + hy, z0, z1)
    collider_box(helpers, "porchfloor", -P["x"], P["x"], P["y0"], P["y1"], 0.0, P["floor"])
    collider_box(helpers, "entablature", -P["x"], P["x"], P["y0"], P["y1"], P["top"], P["h"] + 0.5)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * P["x"], sx * (P["x"] - 2.6)))
        collider_box(helpers, f"pier{sx:+d}", x0, x1, P["y0"], P["y1"], 0.0, P["top"])
        x0, x1 = sorted((sx * sw, sx * (sw + 1.4)))
        collider_box(helpers, f"cheek{sx:+d}", x0, x1, STEPS["y"], P["y0"], 0.0, P["floor"] + 0.5)
    for o in list(parts.objects):
        if o.name.startswith("Porch"):
            c, s = o.matrix_world.translation, o.matrix_world.to_scale()
            collider_box(helpers, "c" + o.name.replace(".", ""), c.x - s.x / 2, c.x + s.x / 2, c.y - s.y / 2, c.y + s.y / 2, c.z, c.z + s.z)
    y0, y1, h = STEPS["y"], P["y0"], P["floor"]
    me = bpy.data.meshes.new("steps")
    me.from_pydata([(-sw, y0, 0), (sw, y0, 0), (sw, y1, h), (-sw, y1, h), (-sw, y1, 0), (sw, y1, 0)], [],
                   [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
    o = bpy.data.objects.new("steps", me)
    helpers.objects.link(o)
    bcity_landmark.rename(o, "WALK")
    # the footprint as the real plan's pieces (the building and the forecourt in front of the porch),
    # clear ground round it
    flat_marker(helpers, "main", rect(-109.3, 109.3, FRONT - 0.5, 90.0), "FOOTPRINT")
    flat_marker(helpers, "westpav", rect(-109.3, -80.3, -89.4, FRONT), "FOOTPRINT")
    flat_marker(helpers, "eastpav", rect(80.3, 109.3, -89.4, FRONT), "FOOTPRINT")
    flat_marker(helpers, "forecourt", rect(-100.0, 100.0, -188.0, FRONT), "FOOTPRINT")
    flat_marker(helpers, "building", [(-111.0, -91.0), (111.0, -91.0), (111.0, 92.0), (-111.0, 92.0)], "CLEAR")
    flat_marker(helpers, "steps", rect(-sw - 4.0, sw + 4.0, STEPS["y"] - 6.0, FRONT), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "militarymuseum", "中国人民革命军事博物馆", "Military Museum of the Chinese People's Revolution"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -6806.3, 64.0, 0.4
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, columns=ncol, pilasters=len(pil))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
