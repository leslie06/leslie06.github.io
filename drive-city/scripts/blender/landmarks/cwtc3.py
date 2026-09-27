# 国贸三期A China World Trade Center Tower III (国贸大厦), built in Blender and marked with the bcity_landmark
# add-on's conventions. It replaces the kit-built cwtc3.ts.
#
#   blender -b -P scripts/blender/landmarks/cwtc3.py -- [--out art/landmarks/cwtc3.blend] [--export]
#
# The sign needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM way 116944490 (a
# 52.9 x 58.6 m rectangle on the city grid, heading 0; the one-way road along the south face is 10 m
# from it, kerb ~4.5 m).
#
# The figures: 330 m, 74 floors above a 12 m lobby. The plan is the rectangle with its corners
# chamfered, tapering gently (13% at the roof); silver-blue glass in close mullions (the kit's facade
# shader, see tower.py); plant floors every 16 storeys as recessed louvre bands; the skin carries on
# 18 m past the 312 m roof as an open crown of stainless fins, flaring, lit white at night, round the
# plant penthouse and the helipad. At the foot the glass lobby is set back 2 m behind stainless
# columns, the entrance on the south under a shallow canopy with the name.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, collider_box, cyl, flat_marker, rect  # noqa: E402
from tower import annulus, band, cap, edges, facade, fins, loft, perim, rrect, scale, sign, slab  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "cwtc3.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

HW, HD, CH = 26.4, 29.3, 5.2          # half extents at the lobby's top, corner chamfer
LOBBY, ROOF, TOP = 12.0, 312.0, 330.0
FLOOR = 4.2
BANDS = [LOBBY + FLOOR * k for k in (15, 31, 47, 63)]      # plant floors (louvred, one storey)
SET = 2.0                              # the lobby glass set back behind the columns
GLASS = dict(floorH=FLOOR, colW=1.25, glass="#7e98ae", frame="#dfe3e6", spandrel="#71879a", mull=0.14, slab=0.07, metal=0.9, rough=0.05, lit=0.3, seed=3)


def taper(z):
    return 1 - 0.13 * (min(max(z, 0.0), ROOF) / ROOF) ** 1.25


def outline(z, k=1.0, inset=0.0):
    s = taper(z) * k
    return rrect(HW * s - inset, HD * s - inset, max(0.5, CH * s - inset * 0.41), 1)


def helipad_image(size=512):
    cv = Canvas(size, size, "#4d5156")
    cv.noise(0.08, 5)
    c = size / 2
    cv.ring(c, c, size * 0.40, size * 0.44, "#e8e8e2")
    t = size * 0.05
    cv.rect(c - size * 0.16, c - size * 0.2, c - size * 0.16 + t, c + size * 0.2, "#e8e8e2")
    cv.rect(c + size * 0.16 - t, c - size * 0.2, c + size * 0.16, c + size * 0.2, "#e8e8e2")
    cv.rect(c - size * 0.16, c - t / 2, c + size * 0.16, c + t / 2, "#e8e8e2")
    return image("CW_Helipad", np.flipud(cv.a).copy())


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    M = dict(
        glass=facade("CW_Glass", GLASS),
        crown=facade("CW_Crown", dict(GLASS, colW=2.2, mull=0.16, slab=0.02, lit=0, crown={"from": ROOF + 2, "glow": 0.22}, side="double")),
        lobby=facade("CW_Lobby", dict(floorH=4.0, colW=1.5, glass="#5f7483", frame="#c9cdd0", spandrel="#c9cdd0", mull=0.04, slab=0.03, metal=0.85, rough=0.04, lit=0.75, warm="#ffd9a8", coolShare=0.0, seed=5)),
        louvre=facade("CW_Louvre", dict(floorH=0.3, colW=60.0, glass="#454c52", frame="#8e969c", mull=0.0, slab=0.35, metal=0.7, rough=0.35, lit=0, seed=2)),
        steel=material("CW_Steel", "#c3c8cc", 0.28, metal=1.0, props={"wet": "surface", "glow": "flood", "glowStrength": 0.5}),
        blade=material("CW_Blade", "#cdd2d6", 0.3, metal=1.0, props={"wet": "surface", "glow": "none"}),
        fin=material("CW_Fin", "#d6dadd", 0.3, metal=1.0, props={"wet": "surface", "glow": "lamp", "glowColor": [0.8, 0.9, 1.0], "glowStrength": 0.35}),
        soffit=material("CW_Soffit", "#d8d6d0", 0.5, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.9, 0.75], "glowStrength": 0.25}),
        roof=material("CW_Roof", "#5d6266", 0.85, props={"wet": "ground", "glow": "none"}),
        pad=material("CW_Helipad", "#4d5156", 0.8, tex=helipad_image(), props={"wet": "ground", "glow": "none"}),
        granite=material("CW_Granite", "#8f8b84", 0.7, props={"wet": "ground", "glow": "none", "layer": 10}),
        door=material("CW_Door", "#6d7a84", 0.05, metal=0.9, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.86, 0.66], "glowStrength": 0.08}),
        gold=material("CW_Gold", "#d9b25a", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.85, 0.55], "glowStrength": 0.8}),
    )
    TILE = dict(steel=2.0, roof=4.0, granite=3.0)
    main = collection("国贸三期")
    g = Geo()
    ref = perim(outline(LOBBY))

    # the lobby: glass set back behind the columns, the soffit of the tower over it, columns on the tower's line
    lob = rrect(HW - SET, HD - SET, CH - SET * 0.41, 1)
    loft(g, [(0.0, lob), (LOBBY, lob)], "lobby", smooth=False)
    annulus(g, LOBBY, outline(LOBBY), lob, "soffit", up=False)
    for a, b, n, L in edges(outline(LOBBY)):
        if L < 8:
            continue
        k = max(2, round(L / 9.0))
        for s in range(k + 1):
            t = s / k
            x, y = a[0] + (b[0] - a[0]) * t - n[0] * 0.45, a[1] + (b[1] - a[1]) * t - n[1] * 0.45
            g.box(x - 0.42, x + 0.42, y - 0.42, y + 0.42, 0.0, LOBBY, "steel", skip=("-z", "+z"))

    # the shaft: glass between the plant bands
    cuts = [LOBBY]
    for b in BANDS:
        cuts += [b, b + FLOOR]
    cuts.append(ROOF)
    for i in range(0, len(cuts), 2):
        z0, z1 = cuts[i], cuts[i + 1]
        n = max(1, math.ceil((z1 - z0) / 26.0))
        zs = [z0 + (z1 - z0) * j / n for j in range(n + 1)]
        loft(g, [(z, outline(z)) for z in zs], "glass", smooth=False, u_ref=ref)
        # the stainless fins, one every 2.2 m, standing 0.6 m proud of the glass
        for za, zb in zip(zs, zs[1:]):
            fins(g, outline(za), outline(zb), za, zb, 2.2, 0.6, 0.22, "blade")
    for b in BANDS:
        band(g, b, b + FLOOR, outline(b), outline(b + FLOOR), outline(b, inset=0.7), outline(b + FLOOR, inset=0.7), "louvre", u_ref=ref, skin="steel")

    # the crown: the skin goes on 18 m past the roof, flaring, open to the sky, fins outside it
    top = scale(outline(ROOF), 1.035)
    loft(g, [(ROOF, outline(ROOF)), (TOP, top)], "crown", smooth=False, u_ref=ref)
    annulus(g, TOP, scale(top, 1.012), top, "steel")
    fins(g, outline(ROOF), top, ROOF, TOP + 0.6, 2.2, 0.9, 0.3, "fin")
    cap(g, ROOF, scale(outline(ROOF), 0.99), "roof")
    # plant penthouse and the helipad deck on it
    ph = outline(ROOF, inset=6.0)
    loft(g, [(ROOF, ph), (ROOF + 5.5, ph)], "louvre", smooth=False)
    cap(g, ROOF + 5.5, ph, "roof")
    cyl(g, 0, 0, ROOF + 5.5, ROOF + 6.1, 11.5, 11.5, 40, "steel", caps=(False, False))
    pad = [(11.5 * math.cos(2 * math.pi * i / 40), 11.5 * math.sin(2 * math.pi * i / 40)) for i in range(40)]
    g.polyn([(x, y, ROOF + 6.1) for x, y in pad], "pad", (0, 0, 1), uvs=[(0.5 + x / 23, 0.5 + y / 23) for x, y in pad])

    # the entrance on the south: revolving doors, a shallow canopy over the pavement
    yf = -(HD - SET)
    for x in (-6.0, 0.0, 6.0):
        cyl(g, x, yf - 1.1, 0.0, 2.9, 1.3, 1.3, 20, "door", caps=(False, False))
        cyl(g, x, yf - 1.1, 2.9, 3.3, 1.4, 1.4, 20, "steel", caps=(False, True))
        for a in range(4):
            c, s_ = math.cos(a * math.pi / 2 + 0.4), math.sin(a * math.pi / 2 + 0.4)
            g.box(x + c * 1.25 - 0.05, x + c * 1.25 + 0.05, yf - 1.1 + s_ * 1.25 - 0.05, yf - 1.1 + s_ * 1.25 + 0.05, 0.0, 2.9, "steel", skip=("-z", "+z"))
    slab(g, -13.0, 13.0, -HD - 4.0, yf, 7.0, 7.5, "steel")
    g.polyn([(-12.8, -HD - 3.8, 6.99), (12.8, -HD - 3.8, 6.99), (12.8, yf, 6.99), (-12.8, yf, 6.99)], "soffit", (0, 0, -1))
    # a granite apron round the foot
    ap = rrect(HW + 1.5, HD + 1.5, CH + 0.6, 1)
    g.polyn([(x, y, 0.03) for x, y in ap], "granite", (0, 0, 1))
    g.build("Tower", collection("大厦", main), M, TILE)
    tris = g.tris()
    font = bpy.data.fonts.load(FONT)
    # the name along the canopy's front edge, facing south
    face_south = T(0, -HD - 4.02, 7.25) @ Matrix.Rotation(math.pi / 2, 4, "X")
    tris += sign(font, "国贸大厦", 0.36, face_south, "Sign", collection("招牌", main), M["gold"])

    # the far level: the same skin with a few rings, the crown and the roof
    far = Geo()
    far_rings = [(z, outline(z)) for z in (0.0, 100.0, 200.0, ROOF)]
    loft(far, far_rings, "glass", smooth=False, u_ref=ref)
    loft(far, [(ROOF, outline(ROOF)), (TOP, top)], "crown", smooth=False, u_ref=ref)
    cap(far, ROOF, outline(ROOF), "roof")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the lobby behind its columns, the tower above it (out of reach), the columns
    helpers = collection("碰撞体")
    collider_box(helpers, "lobby", -(HW - SET), HW - SET, -(HD - SET), HD - SET, 0.0, LOBBY)
    collider_box(helpers, "tower", -HW, HW, -HD, HD, LOBBY, ROOF)
    for a, b, n, L in edges(outline(LOBBY)):
        if L < 8:
            continue
        k = max(2, round(L / 9.0))
        for s in range(k + 1):
            t = s / k
            x, y = a[0] + (b[0] - a[0]) * t - n[0] * 0.45, a[1] + (b[1] - a[1]) * t - n[1] * 0.45
            collider_box(helpers, "column", x - 0.42, x + 0.42, y - 0.42, y + 0.42, 0.0, LOBBY)
    flat_marker(helpers, "cwtc3", rect(-HW - 1.0, HW + 1.0, -HD - 1.0, HD + 1.0), "FOOTPRINT")
    flat_marker(helpers, "cwtc3", rect(-HW - 1.5, HW + 1.5, -HD - 1.5, HD + 1.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "cwtc3", "国贸三期", "China World Trade Center III"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", LAT, LON, 0.0
    s.repo_path = REPO
    return dict(tris=tris)


# The centre of OSM way 116944490's box, in WGS84 (the old anchor was that box's centre too).
LAT, LON = "39.910975", "116.452365"

if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
