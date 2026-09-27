# 中国国家博物馆 National Museum of China, on the east side of Tian'anmen Square facing the Great Hall,
# built in Blender and marked with the bcity_landmark add-on's conventions (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/national_museum.py -- [--out art/landmarks/nationalmuseum.blend] [--export]
#   (or with the bpy module: python scripts/blender/landmarks/national_museum.py -- ...)
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# It clears the open file first. Frame: Blender +X east, +Y north, metres, origin at the centre of the
# box round OSM's outline (relation 8607825; 39.9037096 N, 116.3954444 E), the building's axis 2.056 deg
# anticlockwise of north like the square's and the Great Hall's.
#
# The plan is OSM's building parts, cleaned to right angles, with their heights: the long wings (33 m),
# the cross-shaped central block (43 m) under the 2011 hall (46-48 m), the east block (31 m), the north
# and south entrance blocks (37 m), and on the west front the 39 m portico between two 43 m pylons with
# an open court behind it. The treatment - stone, bays of tall windows between pilasters, the yellow
# and green glazed cornice - is the Great Hall's, as the two were built as a pair in 1959; the museum is
# the open one of the two: two rows of square columns in the portico, a loggia of columns along the
# wings, the court and the glass wall of the entrance hall behind. The bronze canopy is the 2011 hall's.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import SIDES, Canvas, Geo, T, band, collider_box, flat_marker, fwall, mesh_of, paving, place, rect, side_line, tile_image  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "nationalmuseum.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

BAY, STOREY, PLINTH = 5.5, 5.5, 1.2
# Parts: (name, x0, x1, y0, y1, height, faces). A face is "win" (stone, windows, pilasters), "glass",
# "stone", or absent (it abuts another part). The cornice runs round the faces that are there.
PARTS = [
    ("north bar", -94.5, 56.0, 132.5, 158.0, 33.0, dict(w="win", n="win", e="win", s="win")),
    ("north arm", -85.0, -68.2, 55.5, 132.5, 33.0, dict(w="win", e="win", s="win")),
    ("south bar", -94.5, 56.0, -158.0, -132.5, 33.0, dict(w="win", s="win", e="win", n="win")),
    ("south arm", -85.0, -68.2, -132.5, -55.5, 33.0, dict(w="win", e="win", n="win")),
    ("north pylon", -95.3, -81.3, 42.6, 55.6, 43.0, dict(w="stone", n="stone", e="stone", s="stone")),
    ("south pylon", -95.3, -81.3, -55.6, -42.6, 43.0, dict(w="stone", n="stone", e="stone", s="stone")),
    ("north link", -81.3, -53.4, 42.6, 55.6, 27.0, dict(s="win", n="win")),
    ("south link", -81.3, -53.4, -55.6, -42.6, 27.0, dict(n="win", s="win")),
    ("central west", -53.4, -39.3, -49.5, 49.5, 43.0, dict(w="glass")),
    ("central bar", -39.3, 4.6, -132.5, 132.5, 43.0, dict(w="win", e="win")),
    ("central east", 4.6, 82.8, -55.3, 55.3, 43.0, dict(n="win", s="win", e="win")),
    ("east north", 4.6, 92.4, 55.3, 115.6, 31.0, dict(n="win", e="win", s="win")),
    ("east south", 4.6, 92.4, -115.6, -55.3, 31.0, dict(s="win", e="win", n="win")),
    ("east strip", 82.8, 87.0, -55.3, 55.3, 31.0, dict(e="win")),
    ("north entrance", -48.3, 6.5, 158.0, 162.0, 37.0, dict(n="glass", w="win", e="win")),
    ("south entrance", -48.3, 6.5, -162.0, -158.0, 37.0, dict(s="glass", w="win", e="win")),
]
LOGGIA = dict(x=-87.4, wall=-85.0, front=-88.0, y0=58.0, y1=130.0, top=29.6)   # the wings' columns, north; mirrored south
PORTICO = dict(x0=-92.9, x1=-84.1, y=44.2, rows=(-91.6, -86.2), cols=12, col=1.7, top=33.0, ent=38.0, h=39.0)
PODIUM = dict(x0=-100.0, x1=-53.4, y=44.2, h=1.2, steps=5, run=0.8)
ENTRANCE = dict(y=165.4, glass=162.0, x0=-45.5, x1=3.7, cols=6, col=1.6, top=31.5)   # north; mirrored south
CROWN = dict(x0=-45.6, x1=13.6, y0=-45.0, y1=42.3, h=46.5, over=2.2)
CROWN_TOP = [(-26.6, -2.0, -18.0, 21.0), (-39.6, -26.0, 23.0, 32.6), (-5.0, 9.6, 23.0, 32.6), (-39.6, -26.0, -32.6, -23.0), (-5.0, 9.6, -32.6, -23.0)]


# --- textures ------------------------------------------------------------------------------------------

def facade_images(size=512):
    """One bay by one storey (5.5 x 5.5 m): warm stone, a tall window in a stone frame, lit at night."""
    cv, glow = Canvas(size, size, "#d6c7a5"), Canvas(size, size, "#000000")
    cv.noise(0.08, 3)
    y, x = cv.y / size, cv.x / size          # y down from the top of the storey
    win = (np.abs(x - 0.5) < 0.23) & (y > 0.1) & (y < 0.8)
    frame = (np.abs(x - 0.5) < 0.265) & (y > 0.075) & (y < 0.83) & ~win
    cv.put(frame, "#ece3cf")
    glass = srgb("#2b333b") + (0.12 * y)[..., None] * srgb("#8a9aab")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(x - 0.5) < 0.007) | (np.abs(y - 0.33) < 0.008) | (np.abs(y - 0.62) < 0.006))
    cv.put(bars, "#c0b59c")
    cv.put((y > 0.83) & (y < 0.9) & (np.abs(x - 0.5) < 0.2), "#c8b996")          # spandrel under it
    cv.put(np.mod(cv.y, size / 3) < 2, cv.a[0, 0] * 0.9)                          # coursing
    rng = np.random.default_rng(9)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffc27a") * (0.35 + 0.3 * rng.random((size, size), np.float32)[lit][:, None])
    return image("NM_Facade", np.flipud(cv.a).copy()), image("NM_FacadeNight", np.flipud(glow.a).copy())


def glass_images(size=256):
    """A 4 x 4 m module of the entrance hall's glass wall: bronze mullions, a transom, lit at night."""
    cv, glow = Canvas(size, size, "#262d33"), Canvas(size, size, "#000000")
    y = cv.y / size
    cv.a += (0.1 * (1 - y))[..., None] * srgb("#7f93a6")
    bar = (np.mod(cv.x, size / 2) < 5) | (np.mod(cv.y, size) < 6) | (np.abs(cv.y - size * 0.62) < 2.5)
    cv.put(bar, "#6e5a3f")
    glow.put(~bar, (0.24, 0.17, 0.08))
    return image("NM_Glass", np.flipud(cv.a).copy()), image("NM_GlassNight", np.flipud(glow.a).copy())


# --- walls and cornices --------------------------------------------------------------------------------

def part(g, x0, x1, y0, y1, h, faces, pil, cornice=None):
    """Plinth, walls, the green frieze and the glazed tile cornice, the flat roof; pilaster spots in `pil`."""
    cx0, cx1, cy0, cy1 = cornice or (x0, x1, y0, y1)
    for side, kind in faces.items():
        out = SIDES[side]
        a, b = side_line(x0, x1, y0, y1, side)
        pa, pb = side_line(x0, x1, y0, y1, side, 0.5)
        fwall(g, pa, pb, 0.0, PLINTH, "plinth", out)
        g.polyn([(pa.x, pa.y, PLINTH), (pb.x, pb.y, PLINTH), (b.x, b.y, PLINTH), (a.x, a.y, PLINTH)], "plinth", (0, 0, 1))
        top = h - 3.0
        if kind == "glass":
            fwall(g, a, b, PLINTH, top - 2.0, "glass", out, bay=4.0, storey=4.0)
            fwall(g, a, b, top - 2.0, top, "stone", out)
        else:
            fwall(g, a, b, PLINTH, top, "facade" if kind == "win" else "stone", out)
        if kind == "win":
            L = (b - a).length
            n = max(1, round(L / BAY))
            yaw = math.atan2(out[1], out[0]) - math.pi / 2
            for k in range(n + 1):
                p = a.lerp(b, k / n)
                pil.append((p, yaw, top))
    for side in faces:
        ca, cb = side_line(cx0, cx1, cy0, cy1, side)
        if cornice:
            fwall(g, ca, cb, h - 5.0, h - 3.0, "stone", SIDES[side])
        band(g, cx0, cx1, cy0, cy1, side, 0.35, h - 3.0, 0.35, h - 1.5, "frieze", faces)
        band(g, cx0, cx1, cy0, cy1, side, 0.0, h - 3.0, 0.35, h - 3.0, "stone", faces)
        band(g, cx0, cx1, cy0, cy1, side, 0.35, h - 1.5, 1.8, h - 1.5, "stone", faces)
        band(g, cx0, cx1, cy0, cy1, side, 1.8, h - 1.5, 0.25, h, "tiles", faces)
    g.polyn([(cx0 - 0.25, cy0 - 0.25, h), (cx1 + 0.25, cy0 - 0.25, h), (cx1 + 0.25, cy1 + 0.25, h), (cx0 - 0.25, cy1 + 0.25, h)], "roof", (0, 0, 1))


def lettering(font, text, height, width, name, M, coll, m):
    """Gilt lettering standing `height` m tall and `width` m long, placed by matrix m (text in its XY plane)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, font, 1.0, 0.1
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.15
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    kx, ky, cy = width / (max(xs) - min(xs)), height / (max(ys) - min(ys)), (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z))
    me.materials.append(M["gold"])
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
    g.box(-0.5, 0.5, -0.5, 0.5, 0.0, 1.0, "column", skip=("-z",))
    g.box(-0.62, 0.62, -0.62, 0.62, 0.0, 0.035, "column", skip=("-z",))
    g.box(-0.6, 0.6, -0.6, 0.6, 0.965, 1.0, "column")
    return g


def pilaster():
    g = Geo()
    g.box(-0.55, 0.55, 0.0, 0.45, 0.0, 1.0, "stone", skip=("-z", "+y"))
    return g


# --- the building ----------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    fac, fac_night = facade_images()
    gl, gl_night = glass_images()
    M = dict(
        facade=material("NM_Facade", "#d6c7a5", 0.75, tex=fac, emit_tex=fac_night, props={"wet": "damp", "emit": "night"}),
        stone=material("NM_Stone", "#d9cbab", 0.7, props={"wet": "damp"}),
        column=material("NM_Column", "#e4d8bd", 0.6, props={"wet": "damp"}),
        plinth=material("NM_Plinth", "#a99d86", 0.8, props={"wet": "ground"}),
        frieze=material("NM_Frieze", "#2f6b5c", 0.35, props={"wet": "surface"}),
        tiles=material("NM_Tiles", "#dca72b", 0.3, tex=tile_image("NM_Tiles"), props={"wet": "surface"}),
        roof=material("NM_Roof", "#8c8a84", 0.9, props={"wet": "ground", "glow": "none"}),
        glass=material("NM_Glass", "#262d33", 0.2, metal=0.3, tex=gl, emit_tex=gl_night, props={"wet": "surface", "emit": "night", "glowStrength": 0.4}),
        bronze=material("NM_Bronze", "#7a6243", 0.4, metal=0.7, props={"wet": "surface", "glowStrength": 0.6}),
        gold=material("NM_Gold", "#e3b447", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.5}),
        paving=material("NM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
    )
    TILE = dict(stone=2.0, column=2.0, plinth=2.0, roof=8.0, bronze=2.0, paving=4.0)
    main = collection("国家博物馆")
    g, pil = Geo(), []
    for name, x0, x1, y0, y1, h, faces in PARTS:
        cornice = None
        if name.endswith("arm"):
            cornice = (LOGGIA["front"], x1, y0, y1)        # the loggia's front carries the arm's cornice
        part(g, x0, x1, y0, y1, h, faces, pil, cornice)
    # the pylons' low pyramids
    for sy in (-1, 1):
        x0, x1, y0, y1 = -95.3, -81.3, 42.6 * sy, 55.6 * sy
        y0, y1 = min(y0, y1), max(y0, y1)
        apex = Vector(((x0 + x1) / 2, (y0 + y1) / 2, 45.2))
        c = [Vector((x0 - 0.25, y0 - 0.25, 43)), Vector((x1 + 0.25, y0 - 0.25, 43)), Vector((x1 + 0.25, y1 + 0.25, 43)), Vector((x0 - 0.25, y1 + 0.25, 43))]
        for i in range(4):
            g.poly([c[i], c[(i + 1) % 4], apex], "tiles", uvs=[(0, 0), (8, 0), (4, 1)])
    # a tall window slot recessed in each face of the pylons
    for sy in (-1, 1):
        x0, x1, y0, y1 = -95.3, -81.3, min(42.6 * sy, 55.6 * sy), max(42.6 * sy, 55.6 * sy)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        for side in ("w", "n", "s", "e"):
            ox, oy = SIDES[side]
            px = x0 - 0.02 if side == "w" else (x1 + 0.02 if side == "e" else None)
            py = y0 - 0.02 if side == "s" else (y1 + 0.02 if side == "n" else None)
            for zb, zt in ((8.0, 22.0), (24.0, 36.0)):
                if px is not None:
                    g.polyn([(px, cy - 1.4, zb), (px, cy + 1.4, zb), (px, cy + 1.4, zt), (px, cy - 1.4, zt)], "glass", (ox, oy, 0),
                            uvs=[(0, 0), (0.7, 0), (0.7, (zt - zb) / 4), (0, (zt - zb) / 4)])
                else:
                    g.polyn([(cx - 1.4, py, zb), (cx + 1.4, py, zb), (cx + 1.4, py, zt), (cx - 1.4, py, zt)], "glass", (ox, oy, 0),
                            uvs=[(0, 0), (0.7, 0), (0.7, (zt - zb) / 4), (0, (zt - zb) / 4)])
    # the loggias along the wings: a soffit over the columns, the cornice already runs along their front
    for sy in (-1, 1):
        ya, yb = sorted((LOGGIA["y0"] * sy - 2.5 * sy, LOGGIA["y1"] * sy + 2.5 * sy))
        g.polyn([(LOGGIA["front"], ya, LOGGIA["top"]), (LOGGIA["wall"], ya, LOGGIA["top"]), (LOGGIA["wall"], yb, LOGGIA["top"]), (LOGGIA["front"], yb, LOGGIA["top"])], "stone", (0, 0, -1))
        g.box(LOGGIA["front"], LOGGIA["wall"], ya, yb, LOGGIA["top"], 30.0, "stone", skip=("+z",))
        g.polyn([(LOGGIA["front"] - 0.5, ya, 0.0), (LOGGIA["front"] - 0.5, yb, 0.0), (LOGGIA["front"] - 0.5, yb, PLINTH), (LOGGIA["front"] - 0.5, ya, PLINTH)], "plinth", (-1, 0, 0))
        g.polyn([(LOGGIA["front"] - 0.5, ya, PLINTH), (LOGGIA["wall"], ya, PLINTH), (LOGGIA["wall"], yb, PLINTH), (LOGGIA["front"] - 0.5, yb, PLINTH)], "paving", (0, 0, 1))
    # the west podium: steps up from the square, the portico, the court behind it
    P, D = PORTICO, PODIUM
    rise, n = D["h"] / D["steps"], D["steps"]
    for k in range(n):
        xa = D["x0"] + k * D["run"]
        g.box(xa, D["x1"], -D["y"], D["y"], k * rise, (k + 1) * rise, "plinth", skip=("-z",) + (("+z",) if k < n - 1 else ()))
        g.polyn([(xa, -D["y"], (k + 1) * rise), (xa + D["run"], -D["y"], (k + 1) * rise), (xa + D["run"], D["y"], (k + 1) * rise), (xa, D["y"], (k + 1) * rise)], "paving", (0, 0, 1))
    xs = D["x0"] + n * D["run"]
    g.polyn([(xs, -D["y"], D["h"] + 0.01), (D["x1"], -D["y"], D["h"] + 0.01), (D["x1"], D["y"], D["h"] + 0.01), (xs, D["y"], D["h"] + 0.01)], "paving", (0, 0, 1))
    g.box(P["x0"] - 0.4, P["x1"], -P["y"], P["y"], P["top"], P["ent"], "stone", skip=("+z",))
    faces = dict(w=1, n=1, e=1, s=1)
    for side in faces:
        band(g, P["x0"] - 0.4, P["x1"], -P["y"], P["y"], side, 0.35, P["ent"], 0.35, P["ent"] + 0.6, "frieze", faces)
        band(g, P["x0"] - 0.4, P["x1"], -P["y"], P["y"], side, 0.35, P["ent"] + 0.6, 1.9, P["ent"] + 0.6, "stone", faces)
        band(g, P["x0"] - 0.4, P["x1"], -P["y"], P["y"], side, 1.9, P["ent"] + 0.6, 0.25, P["h"], "tiles", faces)
    g.polyn([(P["x0"] - 0.65, -P["y"] - 0.25, P["h"]), (P["x1"] + 0.25, -P["y"] - 0.25, P["h"]), (P["x1"] + 0.25, P["y"] + 0.25, P["h"]), (P["x0"] - 0.65, P["y"] + 0.25, P["h"])], "roof", (0, 0, 1))
    # the crown: the 2011 hall rising over the central block, ringed by a deep bronze canopy
    C = CROWN
    for side in ("s", "e", "n", "w"):
        a, b = side_line(C["x0"], C["x1"], C["y0"], C["y1"], side)
        fwall(g, a, b, 43.0, C["h"] - 1.2, "bronze", SIDES[side], bay=3.0, storey=3.0)
        band(g, C["x0"], C["x1"], C["y0"], C["y1"], side, C["over"], C["h"] - 1.2, C["over"], C["h"], "bronze", faces)
        band(g, C["x0"], C["x1"], C["y0"], C["y1"], side, 0.0, C["h"] - 1.2, C["over"], C["h"] - 1.2, "bronze", faces)
    g.polyn([(C["x0"] - C["over"], C["y0"] - C["over"], C["h"]), (C["x1"] + C["over"], C["y0"] - C["over"], C["h"]),
             (C["x1"] + C["over"], C["y1"] + C["over"], C["h"]), (C["x0"] - C["over"], C["y1"] + C["over"], C["h"])], "roof", (0, 0, 1))
    for x0, x1, y0, y1 in CROWN_TOP:
        g.box(x0, x1, y0, y1, C["h"], 48.5, "glass", skip=("-z",))
        g.box(x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, 48.5, 48.9, "bronze", skip=("-z",))
    # the entrance porticos north and south: a glass wall recessed behind six square columns
    E = ENTRANCE
    for sy in (-1, 1):
        y0, y1 = sorted((E["glass"] * sy, E["y"] * sy))
        g.polyn([(E["x0"] - 2.8, y0, E["top"]), (E["x1"] + 2.8, y0, E["top"]), (E["x1"] + 2.8, y1, E["top"]), (E["x0"] - 2.8, y1, E["top"])], "stone", (0, 0, -1))
        g.box(E["x0"] - 2.8, E["x1"] + 2.8, y0, y1, E["top"], 34.0, "stone", skip=("+z",))
        ends = [(E["x0"] - 2.8, E["x0"] - 2.2), (E["x1"] + 2.2, E["x1"] + 2.8)]
        for xa, xb in ends:
            g.box(xa, xb, y0, y1, 0.0, E["top"], "stone", skip=("-z",))
        for side in ("n",) if sy > 0 else ("s",):
            faces_e = {side: 1}
            band(g, E["x0"] - 2.8, E["x1"] + 2.8, y0, y1, side, 0.35, 34.0, 0.35, 35.5, "frieze", faces_e)
            band(g, E["x0"] - 2.8, E["x1"] + 2.8, y0, y1, side, 0.35, 35.5, 1.8, 35.5, "stone", faces_e)
            band(g, E["x0"] - 2.8, E["x1"] + 2.8, y0, y1, side, 1.8, 35.5, 0.25, 37.0, "tiles", faces_e)
        # the portico's floor between the glass and the steps
        fy0, fy1 = sorted((E["glass"] * sy, (E["y"] + 0.6) * sy))
        g.box(E["x0"] - 3.2, E["x1"] + 3.2, fy0, fy1, 0.0, PLINTH, "plinth", skip=("-z", "+z"))
        g.polyn([(E["x0"] - 3.2, fy0, PLINTH), (E["x1"] + 3.2, fy0, PLINTH), (E["x1"] + 3.2, fy1, PLINTH), (E["x0"] - 3.2, fy1, PLINTH)], "paving", (0, 0, 1))
        for k in range(4):
            yk = sy * (E["y"] + 0.6 + k * 0.7)
            ya, yb = sorted((yk, yk + sy * 0.7))
            g.box(E["x0"] - 3.2, E["x1"] + 3.2, ya, yb, 0.0, PLINTH * (4 - k) / 4, "plinth", skip=("-z",))
    front = collection("主体", main)
    g.build("Museum", front, M, TILE)
    tris = g.tris()

    # the columns, pilasters and lettering
    parts = collection("柱", main)
    col = mesh_of(sq_column(), "SquareColumn", M, TILE)
    pl = mesh_of(pilaster(), "Pilaster", M, TILE)
    n = 0
    for i in range(P["cols"]):
        y = -40.0 + 80.0 * i / (P["cols"] - 1)
        for x in P["rows"]:
            place(col, f"Portico.{n:03d}", parts, T(x, y, D["h"]) @ Matrix.Diagonal((P["col"], P["col"], P["top"] - D["h"], 1)))
            n += 1
    for sy in (-1, 1):
        k = round((LOGGIA["y1"] - LOGGIA["y0"]) / BAY)
        for i in range(k + 1):
            y = sy * (LOGGIA["y0"] + (LOGGIA["y1"] - LOGGIA["y0"]) * i / k)
            place(col, f"Loggia.{n:03d}", parts, T(LOGGIA["x"], y, PLINTH) @ Matrix.Diagonal((1.3, 1.3, LOGGIA["top"] - PLINTH, 1)))
            n += 1
        for i in range(E["cols"]):
            x = E["x0"] + (E["x1"] - E["x0"]) * i / (E["cols"] - 1)
            place(col, f"Entrance.{n:03d}", parts, T(x, sy * (E["y"] - 0.9), PLINTH) @ Matrix.Diagonal((E["col"], E["col"], E["top"] - PLINTH, 1)))
            n += 1
    for i, (p, yaw, top) in enumerate(pil):
        place(pl, f"Pilaster.{i:03d}", parts, T(p.x, p.y, PLINTH) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((1, 1, top - PLINTH, 1)))
    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    lettering(font, "中国国家博物馆", 2.4, 30.0, "NameWest", M, letters, facing(P["x0"] - 0.52, 0.0, (P["top"] + P["ent"]) / 2, (-1, 0)))
    lettering(font, "中国国家博物馆", 1.8, 22.0, "NameNorth", M, letters, facing((E["x0"] + E["x1"]) / 2, E["y"] + 0.12, 32.75, (0, 1)))

    # the far level: the parts as boxes in the facade material
    far = Geo()
    for name, x0, x1, y0, y1, h, faces in PARTS:
        far.box(x0, x1, y0, y1, 0.0, h, "stone", skip=("-z",))
    far.box(P["x0"] - 0.4, P["x1"], -P["y"], P["y"], 0.0, P["h"], "stone", skip=("-z",))
    far.box(C["x0"] - C["over"], C["x1"] + C["over"], C["y0"] - C["over"], C["y1"] + C["over"], 43.0, C["h"], "bronze", skip=("-z",))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: every part a box, the podium (up its steps on foot), the columns; footprint and clear ground
    import bcity_landmark
    helpers = collection("碰撞体")
    for i, (name, x0, x1, y0, y1, h, faces) in enumerate(PARTS):
        collider_box(helpers, f"part{i}", x0, x1, y0, y1, 0.0, h)
    collider_box(helpers, "podium", xs, D["x1"], -D["y"], D["y"], 0.0, D["h"])
    collider_box(helpers, "entablature", P["x0"] - 0.4, P["x1"], -P["y"], P["y"], P["top"], P["h"])
    me = bpy.data.meshes.new("steps")
    me.from_pydata([(D["x0"], -D["y"], 0), (xs, -D["y"], D["h"]), (xs, D["y"], D["h"]), (D["x0"], D["y"], 0), (xs, -D["y"], 0), (xs, D["y"], 0)],
                   [], [(0, 1, 2, 3), (0, 4, 1), (3, 2, 5), (0, 3, 5, 4), (4, 5, 2, 1)])
    o = bpy.data.objects.new("steps", me)
    helpers.objects.link(o)
    bcity_landmark.rename(o, "WALK")
    # the entrances: their floor solid, the steps a ramp for people; the loggias' raised floor
    for sy in (-1, 1):
        fy0, fy1 = sorted((E["glass"] * sy, (E["y"] + 0.6) * sy))
        collider_box(helpers, f"entrancefloor{sy:+d}", E["x0"] - 3.2, E["x1"] + 3.2, fy0, fy1, 0.0, PLINTH)
        y0, y1 = (E["y"] + 0.6) * sy, (E["y"] + 0.6 + 2.8) * sy
        me = bpy.data.meshes.new(f"entrancesteps{sy:+d}")
        xa, xb = E["x0"] - 3.2, E["x1"] + 3.2
        me.from_pydata([(xa, y0, PLINTH), (xb, y0, PLINTH), (xb, y1, 0), (xa, y1, 0), (xa, y0, 0), (xb, y0, 0)], [],
                       [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
        o = bpy.data.objects.new(f"entrancesteps{sy:+d}", me)
        helpers.objects.link(o)
        bcity_landmark.rename(o, "WALK")
        ya, yb = sorted((LOGGIA["y0"] * sy - 2.5 * sy, LOGGIA["y1"] * sy + 2.5 * sy))
        collider_box(helpers, f"loggiafloor{sy:+d}", LOGGIA["front"] - 0.5, LOGGIA["wall"], ya, yb, 0.0, PLINTH)
    for o in list(parts.objects):
        if o.name.startswith(("Portico", "Loggia", "Entrance")):
            c = o.matrix_world.translation
            s = o.matrix_world.to_scale()
            collider_box(helpers, "c" + o.name.replace(".", ""), c.x - s.x / 2, c.x + s.x / 2, c.y - s.y / 2, c.y + s.y / 2, c.z, c.z + s.z)
    flat_marker(helpers, "museum", rect(-100.5, 93.0, -166.5, 166.5), "FOOTPRINT")
    flat_marker(helpers, "museum", rect(-103.5, 96.0, -169.5, 169.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "nationalmuseum", "中国国家博物馆", "National Museum of China"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.9037096", "116.3954444", -2.056
    s.repo_path = REPO
    return dict(tris=tris, columns=n, pilasters=len(pil))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
