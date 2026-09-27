# 中国尊 / 中信大厦 CITIC Tower, built in Blender and marked with the bcity_landmark add-on's conventions.
# It replaces the kit-built citic.ts.
#
#   blender -b -P scripts/blender/landmarks/citic.py -- [--out art/landmarks/citic.blend] [--export]
#
# The sign needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM way 599547918
# (80.7 x 77.2 m on the city grid, heading 0). A multi-storey car park (way 1022407217) abuts the south
# face, so the entrances are on the other three sides.
#
# The figures: 528 m, 108 floors, the profile of a 尊 ritual vessel - 80 x 77 m at the foot, drawing in to
# a 54 m waist at 72% of the height and flaring back to 69 x 60 m at the top, the corners rounded over
# the mega-columns. Silver glass in the kit's facade shader (tower.py) with LED lines up the mullions at
# night; eight zones split by recessed louvred plant floors; the skin carries on 20 m past the roof as
# an open crown lit white. At the foot a tall lobby behind the glass, and on the north, east and west a
# cantilevered canopy over revolving doors; the name on the north canopy.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import Geo, T, collider_box, cyl, flat_marker, rect  # noqa: E402
from tower import annulus, band, cap, facade, loft, perim, rrect, scale, sign, slab  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "citic.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

ROOF, TOP, WAIST = 508.0, 528.0, 0.72
BASE = (80.0, 77.0)            # at the foot, x and y
HEAD = (69.0, 60.0)            # at the top
NECK = 54.0                    # the waist
LOBBY = 20.0
BANDS = [63.5 * k for k in range(1, 8)]          # plant floors, 5.5 m each: eight zones
BAND_H = 5.5
GLASS = dict(floorH=4.8, colW=1.6, glass="#8a9dae", frame="#c9cfd4", spandrel="#8f9aa3", mull=0.09, slab=0.1, metal=0.88, rough=0.06, lit=0.26, seed=11, finGlow=0.05)


def width(z, base, top):
    t = min(1.0, max(0.0, z / TOP))
    if t <= WAIST:
        return NECK + (base - NECK) * (1 - t / WAIST) ** 1.75
    u = (t - WAIST) / (1 - WAIST)
    return NECK + (top - NECK) * u * u


def outline(z, inset=0.0):
    wx, wy = width(z, BASE[0], HEAD[0]), width(z, BASE[1], HEAD[1])
    return rrect(wx / 2 - inset, wy / 2 - inset, max(1.0, 8.5 * wx / 78 - inset), 5)


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    M = dict(
        glass=facade("CT_Glass", GLASS),
        crown=facade("CT_Crown", dict(GLASS, colW=2.4, mull=0.14, slab=0.02, lit=0, finGlow=0, crown={"from": ROOF - 12, "glow": 0.22}, side="double")),
        lobby=facade("CT_Lobby", dict(floorH=5.0, colW=2.0, glass="#62788a", frame="#d0d4d7", spandrel="#d0d4d7", mull=0.035, slab=0.025, metal=0.85, rough=0.04, lit=0.7, warm="#ffd9a8", coolShare=0.0, seed=9)),
        louvre=facade("CT_Louvre", dict(floorH=0.35, colW=80.0, glass="#4a5157", frame="#9aa2a8", mull=0.0, slab=0.35, metal=0.7, rough=0.35, lit=0, seed=4)),
        steel=material("CT_Steel", "#c6cbcf", 0.28, metal=1.0, props={"wet": "surface", "glow": "none"}),
        soffit=material("CT_Soffit", "#dcd9d2", 0.5, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.9, 0.75], "glowStrength": 0.25}),
        roof=material("CT_Roof", "#5a5f63", 0.85, props={"wet": "ground", "glow": "none"}),
        granite=material("CT_Granite", "#8c8880", 0.7, props={"wet": "ground", "glow": "none", "layer": 10}),
        door=material("CT_Door", "#6d7a84", 0.05, metal=0.9, props={"wet": "surface", "glow": "none"}),
        gold=material("CT_Gold", "#d9b25a", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.85, 0.55], "glowStrength": 0.8}),
    )
    TILE = dict(steel=2.0, roof=4.0, granite=3.0)
    main = collection("中国尊")
    g = Geo()
    ref = perim(outline(0.0))

    # the lobby: the skin's lowest 20 m in tall glass
    loft(g, [(0.0, outline(0.0)), (LOBBY, outline(LOBBY))], "lobby", u_ref=ref)
    # the shaft between the plant floors: smooth rings every ~12 m follow the curve
    cuts = [LOBBY]
    for b in BANDS:
        cuts += [b, b + BAND_H]
    cuts.append(ROOF)
    for i in range(0, len(cuts), 2):
        z0, z1 = cuts[i], cuts[i + 1]
        n = max(1, math.ceil((z1 - z0) / 12.0))
        loft(g, [(z0 + (z1 - z0) * j / n, outline(z0 + (z1 - z0) * j / n)) for j in range(n + 1)], "glass", u_ref=ref)
    for b in BANDS:
        band(g, b, b + BAND_H, outline(b), outline(b + BAND_H), outline(b, inset=0.8), outline(b + BAND_H, inset=0.8), "louvre", u_ref=ref, skin="steel")
    # the crown: open to the sky, the roof and a plant penthouse inside it
    loft(g, [(ROOF, outline(ROOF)), (TOP, outline(TOP))], "crown", u_ref=ref)
    annulus(g, TOP, scale(outline(TOP), 1.01), outline(TOP), "steel")
    cap(g, ROOF, scale(outline(ROOF), 0.99), "roof")
    ph = outline(ROOF, inset=8.0)
    loft(g, [(ROOF, ph), (ROOF + 8.0, ph)], "louvre")
    cap(g, ROOF + 8.0, ph, "roof")

    # entrances on the north, east and west: a cantilevered canopy, revolving doors, a lit soffit
    ents = {"n": (0.0, 1.0), "e": (1.0, 0.0), "w": (-1.0, 0.0)}
    for side, (dx, dy) in ents.items():
        face = (BASE[1] / 2 if dy else BASE[0] / 2) - 0.6
        half, depth, z = 16.0, 9.0, 11.0
        if dy:
            x0, x1, y0, y1 = -half, half, *sorted((dy * face, dy * (face + depth)))
        else:
            x0, x1 = sorted((dx * face, dx * (face + depth)))
            y0, y1 = -half, half
        slab(g, x0, x1, y0, y1, z, z + 0.9, "steel")
        g.polyn([(x0, y0, z - 0.01), (x1, y0, z - 0.01), (x1, y1, z - 0.01), (x0, y1, z - 0.01)], "soffit", (0, 0, -1))
        for k in (-6.0, 0.0, 6.0):
            cx, cy = (k, dy * (face + 1.2)) if dy else (dx * (face + 1.2), k)
            cyl(g, cx, cy, 0.0, 3.0, 1.4, 1.4, 20, "door", caps=(False, False))
            cyl(g, cx, cy, 3.0, 3.4, 1.5, 1.5, 20, "steel", caps=(False, True))
    # a granite apron round the foot (not under the car park on the south)
    ap = rrect(BASE[0] / 2 + 6.0, BASE[1] / 2 + 6.0, 12.0, 5)
    g.polyn([(x, max(y, -BASE[1] / 2), 0.03) for x, y in ap], "granite", (0, 0, 1))
    g.build("Tower", collection("大厦", main), M, TILE)
    tris = g.tris()
    font = bpy.data.fonts.load(FONT)
    north = BASE[1] / 2 - 0.6 + 9.0
    m = T(0, north + 0.02, 11.45) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    tris += sign(font, "中信大厦", 0.55, m, "Sign", collection("招牌", main), M["gold"])

    # the far level
    far = Geo()
    loft(far, [(z, outline(z)) for z in [0.0, 60.0, 130.0, 200.0, 270.0, 330.0, 380.0, 430.0, 470.0, ROOF]], "glass", u_ref=ref)
    loft(far, [(ROOF, outline(ROOF)), (TOP, outline(TOP))], "crown", u_ref=ref)
    cap(far, ROOF, outline(ROOF), "roof")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the wide foot, then the waist, out of reach above
    helpers = collection("碰撞体")
    collider_box(helpers, "foot", -BASE[0] / 2 + 1.0, BASE[0] / 2 - 1.0, -BASE[1] / 2 + 1.0, BASE[1] / 2 - 1.0, 0.0, 80.0)
    collider_box(helpers, "shaft", -29.0, 29.0, -29.0, 29.0, 80.0, ROOF)
    for side, (dx, dy) in ents.items():
        face = (BASE[1] / 2 if dy else BASE[0] / 2) - 0.6
        for k in (-6.0, 0.0, 6.0):
            cx, cy = (k, dy * (face + 1.2)) if dy else (dx * (face + 1.2), k)
            collider_box(helpers, "door", cx - 1.4, cx + 1.4, cy - 1.4, cy + 1.4, 0.0, 3.0)
    flat_marker(helpers, "citic", rect(-BASE[0] / 2 - 1.0, BASE[0] / 2 + 1.0, -BASE[1] / 2 - 0.5, BASE[1] / 2 + 1.0), "FOOTPRINT")
    flat_marker(helpers, "citic", rect(-BASE[0] / 2 - 6.0, BASE[0] / 2 + 6.0, -BASE[1] / 2, BASE[1] / 2 + 6.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "citic", "中国尊", "CITIC Tower"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.911501", "116.460236", 0.0
    s.far_distance = 1200
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
