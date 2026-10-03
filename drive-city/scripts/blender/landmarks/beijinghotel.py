# 北京饭店 Beijing Hotel on 东长安街 at the foot of 王府井, built in Blender, marked with the bcity_landmark add-on's
# conventions. It reuses station.py's glazed eave (skirt), its pavilions and the kit's facade shader for windows.
#
#   blender -b -P scripts/blender/landmarks/beijinghotel.py -- [--out art/landmarks/beijinghotel.blend] [--export]
#
# Frame: Blender +X east along 长安街, +Y north, metres, origin on the ground at game (465, 145), heading -1.4 (the
# outlines' long edges). The plan is OSM's: way 33459001 (北京饭店, the comb-shaped 1974 tower) and the outlines the
# city had drawn as anonymous blocks west of it (236379912 the tower's podium, 236379913 the 1917 building's back
# range, 236379917 the rest of the frontage, 909380173 金色大厅). From west to east, as the hotel stands (Chinese
# Wikipedia: 西楼 C座 west of 中楼 B座, 东楼 A座 east of it):
#   - the east end of 贵宾楼 (1990; the rest of it is OSM's): ten storeys of beige stone under a green-glazed eave;
#   - 西楼 (1954, 戴念慈): eight storeys of water-brushed stone on a dark red stone base, a green-glazed eave round its
#     top and a pair of small double-roofed pavilions at each end; behind it a lower range with a tennis court on its
#     roof (seen from the air);
#   - 中楼 (1917, the French building, 7 storeys, 36 m): red brick with white stone string courses and pilasters, an
#     arcaded white stone ground floor (7.75 m), a heavy cornice and a slate mansard with arched dormers (the 1931
#     top); its front and back ranges with the lower 金色大厅 between them;
#   - 东楼 (1974, 20 storeys, ~80 m): the long slab with three wings to the north (the "山" plan), cream with close
#     vertical windows, a darker crown, on a glazed podium of the 2000s along the street.
# Heights: 中楼 36 m and 东楼 80 m published; 西楼 31 m and 贵宾楼 38 m from their storeys.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, collider_box, flat_marker, mesh_of, place, rect  # noqa: E402
from hall import beast_geo, bracket_geo, column_geo  # noqa: E402
import station as ST  # noqa: E402  (skirt, pavilion, pav_spec, wall_box, its materials)
from tower import facade  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "beijinghotel.blend")

ORIGIN, HEADING = (465.0, 145.0), -1.4
FRONT, BACK = -29.9, 34.0           # the frontage and the back of the west ranges
# plan, local metres
GB = (-155.1, -127.0)               # 贵宾楼's east end
XL = (-127.0, -60.0)                # 西楼 (1954)
LINK = (-60.0, -55.4)               # the joint between 西楼 and 中楼
ZL = (-55.4, 31.8)                  # 中楼 (1917)
ZL_FRONT_Y1, ZL_BACK_Y0 = -8.0, 14.9
DL = (31.8, 156.3)                  # 东楼 (1974)
DL_BAR = (-7.5, 13.9)
DL_WINGS = [((31.8, 56.4), 33.9), ((82.6, 108.0), 24.6), ((132.6, 156.3), 33.9)]
H = dict(gb=38.0, xl=31.0, xl_back=22.0, zl=29.0, zl_top=35.6, hall=18.0, dl=78.0, pod=12.0)


def mansard_tile(size=256):
    """Slate scales for the mansard: rows of round-ended slates, dark blue-grey."""
    cv = Canvas(size, size, "#4b5258")
    rows = 8
    rh = size / rows
    row = (cv.y // rh).astype(int)
    u = (cv.x / (size / 6) + (row % 2) * 0.5) % 1.0
    v = (cv.y % rh) / rh
    edge = (np.abs(u - 0.5) * 2) ** 2 + (1 - v) ** 2 * 0.9 > 0.95
    cv.put(edge & (v > 0.45), "#3a4045")
    cv.noise(0.1, 4)
    return image("BH_Slate", np.flipud(cv.a).copy())


def court_image(size=256):
    """A tennis court on the 西楼's back range roof: green inside a red surround, white lines."""
    cv = Canvas(size, size // 2, "#9b4a3a")
    cv.rect(size * 0.18, size * 0.08, size * 0.82, size * 0.42, "#3f7a5a")
    for x in (0.18, 0.5, 0.82):
        cv.rect(size * x - 1, size * 0.08, size * x + 1, size * 0.42, "#e8e8e0")
    for y in (0.08, 0.42, 0.125, 0.375):
        cv.rect(size * 0.18, size * y - 1, size * 0.82, size * y + 1, "#e8e8e0")
    cv.rect(size * 0.34, size * 0.25 - 1, size * 0.66, size * 0.25 + 1, "#e8e8e0")
    return image("BH_Court", np.flipud(cv.a).copy())


def materials():
    M = ST.materials()
    M.update(
        brick=facade("BH_BrickWindows", dict(floorH=3.55, colW=2.7, glass="#2f3a42", frame="#86483a", spandrel="#7f4235", mull=0.3,
                                             slab=0.42, metal=0.4, rough=0.15, lit=0.5, coolShare=0.1, seed=31)),
        xlwin=facade("BH_StoneWindows", dict(floorH=3.5, colW=3.3, glass="#34404a", frame="#d2c9b4", spandrel="#c9bea6", mull=0.27,
                                             slab=0.38, metal=0.4, rough=0.15, lit=0.5, coolShare=0.15, seed=32)),
        gbwin=facade("BH_GuestWindows", dict(floorH=3.6, colW=3.0, glass="#33404a", frame="#dccdae", spandrel="#d2c2a0", mull=0.25,
                                             slab=0.36, metal=0.45, rough=0.15, lit=0.5, coolShare=0.2, seed=33)),
        dlwin=facade("BH_TowerWindows", dict(floorH=3.75, colW=1.9, glass="#36424d", frame="#ddd3bd", spandrel="#cdc2aa", mull=0.3,
                                             slab=0.34, metal=0.5, rough=0.12, lit=0.45, coolShare=0.35, seed=34,
                                             bands=dict(every=200.0, h=0.0, color="#b9ad93"))),
        podglass=facade("BH_PodiumGlass", dict(floorH=4.0, colW=2.4, glass="#4a5d69", frame="#c9ccc9", mull=0.06, slab=0.1, metal=0.75,
                                               rough=0.08, lit=0.8, coolShare=0.0, seed=35)),
        arcade=facade("BH_Arcade", dict(floorH=7.0, colW=5.4, glass="#2a333a", frame="#e3ddcf", mull=0.22, slab=0.12, metal=0.4,
                                        rough=0.15, lit=0.85, coolShare=0.0, seed=36)),
        white=material("BH_White", "#e6e1d5", 0.6, props={"wet": "damp", "glowStrength": 0.6}),
        redstone=material("BH_RedStone", "#6b3a33", 0.7, props={"wet": "damp", "glowStrength": 0.5}),
        slate=material("BH_Slate", "#4b5258", 0.55, tex=mansard_tile(), props={"wet": "surface", "glowStrength": 0.4}),
        flat=material("BH_FlatRoof", "#8a867d", 0.85, props={"wet": "ground", "glow": "none"}),
        court=material("BH_Court", "#3f7a5a", 0.8, tex=court_image(), props={"wet": "ground", "glow": "none"}),
        crown=material("BH_Crown", "#a99d84", 0.6, props={"wet": "damp", "glowStrength": 0.5}),
        dark=material("BH_Dark", "#2a3036", 0.4, metal=0.3, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.8, 0.5], "glowStrength": 0.25}),
    )
    return M


TILE = dict(ST.TILE, white=2.0, redstone=2.0, slate=1.0, flat=4.0, court=1.0, crown=2.0, dark=2.0)
WALL = ST.wall_box


def flat_top(g, x0, x1, y0, y1, z, key="flat"):
    g.polyn([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], key, (0, 0, 1))


def ledge(g, x0, x1, y0, y1, z, h, out, key="white", faces="sewn"):
    """A band standing `out` proud round (some sides of) a block at height z..z+h, with its top and underside."""
    for f in faces:
        if f == "s":
            g.box(x0 - out, x1 + out, y0 - out, y0, z, z + h, key, skip=("+y",))
        elif f == "n":
            g.box(x0 - out, x1 + out, y1, y1 + out, z, z + h, key, skip=("-y",))
        elif f == "w":
            g.box(x0 - out, x0, y0, y1, z, z + h, key, skip=("+x",))
        elif f == "e":
            g.box(x1, x1 + out, y0, y1, z, z + h, key, skip=("-x",))


def pilasters(g, x0, x1, y, side, z0, z1, every, w=0.7, out=0.18, key="white"):
    """Flat pilaster strips along a wall at y (side -1 front, +1 back), every `every` metres, ends included."""
    n = max(1, round((x1 - x0) / every))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        a, b = max(x0, x - w / 2), min(x1, x + w / 2)
        if side < 0:
            g.box(a, b, y - out, y, z0, z1, key, skip=("+y", "-z"))
        else:
            g.box(a, b, y, y + out, z0, z1, key, skip=("-y", "-z"))


def mansard(g, x0, x1, y0, y1, z0, z1, inset, key="slate", faces="sewn"):
    """A mansard: the named sides slope in by `inset` from z0 to z1 (others rise straight), a flat roof on top."""
    d = {f: (inset if f in faces else 0.0) for f in "sewn"}
    lo = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    hi = [(x0 + d["w"], y0 + d["s"]), (x1 - d["e"], y0 + d["s"]), (x1 - d["e"], y1 - d["n"]), (x0 + d["w"], y1 - d["n"])]
    outs = ((0, -1), (1, 0), (0, 1), (-1, 0))
    for i in range(4):
        j = (i + 1) % 4
        a, b, c, e = lo[i], lo[j], hi[j], hi[i]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        s = math.hypot(inset, z1 - z0)
        g.polyn([(*a, z0), (*b, z0), (*c, z1), (*e, z1)], key, (outs[i][0], outs[i][1], 0.6),
                uvs=[(0, 0), (L / 3, 0), (L / 3, s / 1.0), (0, s / 1.0)])
    g.polyn([(*hi[0], z1), (*hi[1], z1), (*hi[2], z1), (*hi[3], z1)], "flat", (0, 0, 1))
    return hi


def dormer_geo():
    """An arched dormer for the mansard, 1.6 m wide, facing -y, its foot at the origin."""
    g = Geo()
    w, d, h = 0.8, 1.2, 2.0
    g.box(-w, w, -0.2, d, 0.0, h, "white", skip=("-z",))
    arc = [(-0.5, 0.25)] + [(0.5 * math.cos(math.pi - math.pi * i / 8), 1.35 + 0.5 * math.sin(math.pi - math.pi * i / 8)) for i in range(9)] + [(0.5, 0.25)]
    g.polyn([(x, -0.22, z) for x, z in arc], "dark", (0, -1, 0))
    # a little pediment roof
    g.polyn([(-w - 0.12, -0.32, h), (w + 0.12, -0.32, h), (w + 0.12, d, h), (-w - 0.12, d, h)], "slate", (0, 0, 1))
    g.polyn([(-w - 0.12, -0.32, h), (w + 0.12, -0.32, h), (0.0, -0.32, h + 0.55)], "white", (0, -1, 0))
    g.polyn([(-w - 0.12, -0.32, h), (0.0, -0.32, h + 0.55), (0.0, d, h + 0.55), (-w - 0.12, d, h)], "slate", (-1, 0, 1))
    g.polyn([(w + 0.12, -0.32, h), (w + 0.12, d, h), (0.0, d, h + 0.55), (0.0, -0.32, h + 0.55)], "slate", (1, 0, 1))
    return g


def zhonglou(g, dormers):
    """中楼 (1917): front and back ranges in red brick over a white arcaded ground floor, cornice and mansard; the
    lower 金色大厅 between them."""
    x0, x1 = ZL
    zt, zm = H["zl"], H["zl_top"]
    for y0, y1, front in ((FRONT, ZL_FRONT_Y1, True), (ZL_BACK_Y0, BACK, False)):
        faces = ("-y", "+x", "-x") if front else ("+y", "+x", "-x", "-y")
        WALL(g, x0, x1, y0, y1, 7.75, zt, "brick", faces=faces)
        WALL(g, x0, x1, y0, y1, 0.0, 7.75, "arcade", faces=faces)
        if not front:
            WALL(g, x0, x1, y0, y1, 0.0, 7.75, "arcade", faces=("-y",))
        ledge(g, x0, x1, y0, y1, 7.4, 0.55, 0.35, faces="sewn" if not front else "sew")
        ledge(g, x0, x1, y0, y1, 18.3, 0.35, 0.2, faces="sewn" if not front else "sew")
        ledge(g, x0, x1, y0, y1, zt - 0.2, 1.0, 0.85, faces="sewn")
        y = y0 if front else y1
        pilasters(g, x0, x1, y, -1 if front else 1, 7.75, zt - 0.2, 10.8)
        for xe, sx in ((x0, -1), (x1, 1)):     # quoins on the corners
            for k in range(int((zt - 8) // 1.2)):
                z = 8.0 + k * 1.2
                L = 1.0 if k % 2 == 0 else 0.6
                for yy, sy in ((y0, -1), (y1, 1)):
                    g.box(xe - (0.2 if sx > 0 else L), xe + (L if sx > 0 else 0.2), yy - 0.2 if sy < 0 else yy - 0.4, yy + 0.4 if sy > 0 else yy + 0.2, z, z + 0.55, "white", skip=("-z",))
        hi = mansard(g, x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, zt + 0.8, zm, 2.2)
        # dormers along the street (and back) faces of the mansard
        n = int((x1 - x0) // 5.4)
        pad = (x1 - x0 - (n - 1) * 5.4) / 2
        for k in range(n):
            x = x0 + pad + k * 5.4
            if front:
                dormers.append(T(x, y0 + 0.5, zt + 1.3))
            else:
                dormers.append(T(x, y1 - 0.5, zt + 1.3) @ Matrix.Rotation(math.pi, 4, "Z"))
        # chimney stacks on the ridge line
        for x in (x0 + 8, x1 - 8):
            g.box(x - 0.8, x + 0.8, (y0 + y1) / 2 - 0.5, (y0 + y1) / 2 + 0.5, zm, zm + 2.2, "brick", skip=("-z",))
    # the middle: 金色大厅, lower, plain brick over the arcade's height
    WALL(g, x0 + 3.0, x1 - 3.0, ZL_FRONT_Y1, ZL_BACK_Y0, 0.0, H["hall"], "brick", faces=("+x", "-x"))
    flat_top(g, x0 + 3.0, x1 - 3.0, ZL_FRONT_Y1, ZL_BACK_Y0, H["hall"])
    # a canopy over the main door in the middle of the front
    cx = (x0 + x1) / 2
    g.box(cx - 6.0, cx + 6.0, FRONT - 4.5, FRONT, 5.2, 5.8, "white")
    for x in (cx - 5.6, cx + 5.6):
        g.box(x - 0.25, x + 0.25, FRONT - 4.3, FRONT - 3.8, 0.0, 5.2, "white", skip=("-z",))
    return hi


def xilou(g):
    """西楼 (1954): stone over a dark red base, a green-glazed eave; the lower back range; 贵宾楼's east end."""
    x0, x1 = XL
    y1 = -5.0
    WALL(g, x0, x1, FRONT, y1, 4.6, H["xl"], "xlwin", faces=("-y", "+y"))
    WALL(g, x0, x1, FRONT, y1, 0.0, 4.6, "redstone", faces=("-y",))
    WALL(g, x0, x1, FRONT, y1, 0.0, 4.6, "xlwin", faces=("+y",))
    ledge(g, x0, x1, FRONT, y1, 4.4, 0.5, 0.3, key="white", faces="s")
    ledge(g, x0, x1, FRONT, y1, H["xl"] - 0.4, 0.9, 0.6, key="white", faces="sewn")
    flat_top(g, x0 - 0.6, x1 + 0.6, FRONT - 0.6, y1 + 0.6, H["xl"] + 0.5)
    ST.skirt(g, (x1 - x0) / 2 + 0.6, (y1 - FRONT) / 2 + 0.6, H["xl"] + 0.4, 1.8, 1.3, cx=(x0 + x1) / 2, cy=(FRONT + y1) / 2)
    # the entrance: a stone porch with four piers in the middle of the front
    cx = (x0 + x1) / 2
    g.box(cx - 8.0, cx + 8.0, FRONT - 5.0, FRONT, 6.0, 7.0, "white")
    for x in (cx - 7.6, cx - 2.6, cx + 2.6, cx + 7.6):
        g.box(x - 0.4, x + 0.4, FRONT - 4.8, FRONT - 4.0, 0.0, 6.0, "white", skip=("-z",))
    pilasters(g, x0, x1, FRONT, -1, 4.9, H["xl"] - 0.4, 13.4, w=1.0, out=0.3, key="white")
    # the back range (and 西楼's ends above it)
    WALL(g, x0, LINK[1], y1, BACK, 0.0, H["xl_back"], "xlwin", faces=("+y",))
    flat_top(g, x0, LINK[1], y1, BACK, H["xl_back"])
    g.polyn([(x0 + 6.0, y1 + 6.0, H["xl_back"] + 0.02), (x0 + 50.0, y1 + 6.0, H["xl_back"] + 0.02), (x0 + 50.0, BACK - 6.0, H["xl_back"] + 0.02), (x0 + 6.0, BACK - 6.0, H["xl_back"] + 0.02)],
            "court", (0, 0, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # the link between 西楼 and 中楼
    WALL(g, LINK[0], LINK[1], FRONT + 2.0, y1, 0.0, H["xl"] - 3.0, "xlwin", faces=("-y",))
    flat_top(g, LINK[0], LINK[1], FRONT + 2.0, y1, H["xl"] - 3.0)
    # 贵宾楼's east end
    a, b = GB
    WALL(g, a, b, FRONT, BACK, 1.2, H["gb"], "gbwin", faces=("-y", "+y", "-x"))
    WALL(g, a, b, FRONT, BACK, 0.0, 1.2, "redstone", faces=("-y", "+y", "-x"))
    ledge(g, a, b, FRONT, BACK, H["gb"] - 0.4, 0.9, 0.6, key="white", faces="sewn")
    flat_top(g, a - 0.6, b + 0.6, FRONT - 0.6, BACK + 0.6, H["gb"] + 0.5)
    ST.skirt(g, (b - a) / 2 + 0.6, (BACK - FRONT) / 2 + 0.6, H["gb"] + 0.4, 1.8, 1.3, cx=(a + b) / 2, cy=(FRONT + BACK) / 2)


def donglou(g):
    """东楼 (1974): the slab and its three north wings, a darker two-storey crown, the glazed podium in front."""
    x0, x1 = DL
    y0, y1 = DL_BAR
    zt = H["dl"]
    WALL(g, x0, x1, y0, y1, H["pod"], zt - 7.5, "dlwin", faces=("-y",))
    WALL(g, x0, x1, y0, y1, 0.0, zt - 7.5, "dlwin", faces=("+x", "-x"))
    WALL(g, x0, x1, y0, y1, zt - 7.5, zt, "crown", faces=("-y", "+x", "-x"))
    # the north face of the bar between the wings (and over the lower middle wing), the wings themselves
    for a, b, za in ((56.4, 82.6, 0.0), (108.0, 132.6, 0.0), (82.6, 108.0, zt - 11.0)):
        WALL(g, a, b, y0, y1, za, zt - 7.5, "dlwin", faces=("+y",))
        WALL(g, a, b, y0, y1, zt - 7.5, zt, "crown", faces=("+y",))
    for (a, b), yn in DL_WINGS:
        hh = zt if yn > 30 else zt - 11.0
        faces = ("+y", "-x", "+x")
        WALL(g, a, b, y1, yn, 0.0, hh - 7.5, "dlwin", faces=faces)
        WALL(g, a, b, y1, yn, hh - 7.5, hh, "crown", faces=faces)
        flat_top(g, a, b, y1, yn, hh)
        ledge(g, a, b, y1, yn, hh - 0.2, 0.7, 0.4, key="white", faces="new")
    flat_top(g, x0, x1, y0, y1, zt)
    ledge(g, x0, x1, y0, y1, zt - 0.2, 0.7, 0.4, key="white", faces="sew")
    # vertical fins every 7.6 m on the street face, the plant room on the roof
    n = int((x1 - x0) // 7.6)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        g.box(x - 0.3, x + 0.3, y0 - 0.5, y0, H["pod"], zt - 7.5, "white", skip=("+y", "-z"))
    g.box((x0 + x1) / 2 - 14, (x0 + x1) / 2 + 14, y0 + 4, y1 - 4, zt, zt + 4.5, "crown", skip=("-z",))
    flat_top(g, (x0 + x1) / 2 - 14, (x0 + x1) / 2 + 14, y0 + 4, y1 - 4, zt + 4.5)
    # the podium: glass along the street, its entrance bay coming forward
    WALL(g, x0, x1, FRONT, y0, 0.0, H["pod"], "podglass", faces=("-y", "+x", "-x"))
    flat_top(g, x0, x1, FRONT, y0, H["pod"])
    ledge(g, x0, x1, FRONT, y0, H["pod"] - 0.3, 0.8, 0.5, key="white", faces="sew")
    WALL(g, 79.8, 108.9, -34.6, FRONT, 0.0, 9.0, "podglass", faces=("-y", "+x", "-x"))
    flat_top(g, 79.8, 108.9, -34.6, FRONT, 9.0)
    g.box(76.0, 112.6, -40.0, -34.6, 7.6, 8.4, "white")
    for x in (77.0, 111.6):
        g.box(x - 0.3, x + 0.3, -39.6, -39.0, 0.0, 7.6, "white", skip=("-z",))


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("北京饭店")
    g = Geo()
    dormers = []
    zhonglou(g, dormers)
    xilou(g)
    donglou(g)
    # the forecourt's kerb line: a low granite step along the whole frontage
    g.box(GB[0], DL[1], FRONT - 1.2, FRONT, 0.0, 0.15, "granite", skip=("-z",))
    g.build("Hotel", collection("楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    dm = mesh_of(dormer_geo(), "DormerMesh", M, TILE)
    for i, m in enumerate(dormers):
        place(dm, f"Dormer.{i:03d}", parts, m)
    # the 西楼's four pavilions: small double-roofed ones on the ends of its roof
    pav = ST.pav_spec(2.9, 2.0, H["xl"] + 0.5, 2.6, 0.72)
    mesh = {
        ("col", pav.BEAM[0] - pav.Z0): mesh_of(column_geo(pav.BEAM[0] - pav.Z0, r=0.22), "PavColumn", M, TILE),
        ("ucol", pav.UBEAM[0] - pav.UP0): mesh_of(column_geo(pav.UBEAM[0] - pav.UP0 + 0.4, r=0.19), "PavUpperColumn", M, TILE),
        "bracket": mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE),
        "beast": mesh_of(beast_geo(glaze="#2f7a55", lite=True), "BeastMesh", M, TILE),
        "immortal": mesh_of(beast_geo(True, glaze="#2f7a55", lite=True), "ImmortalMesh", M, TILE),
    }
    pg = Geo()
    n = 0
    for x in (XL[0] + 4.5, XL[1] - 4.5):
        for y in (FRONT + 4.2, -9.2):
            pg.box(x - 3.4, x + 3.4, y - 3.4, y + 3.4, H["xl"] + 0.5, pav.Z0 + 0.3, "stone", skip=("-z",))
            n = ST.pavilion(pg, parts, mesh, pav, x, y, n)
    pg.build("Pavilions", collection("亭", main), M, TILE)
    tris += pg.tris()

    # far level: the blocks and their roofs
    far = Geo()
    for (a, b), y0, y1, h, key in ((GB, FRONT, BACK, H["gb"] + 1.5, "gbwin"), (XL, FRONT, -5.0, H["xl"] + 1.5, "xlwin"),
                                    ((XL[0], LINK[1]), -5.0, BACK, H["xl_back"], "xlwin"), (LINK, FRONT + 2.0, -5.0, H["xl"] - 3.0, "xlwin"),
                                    (ZL, FRONT, ZL_FRONT_Y1, H["zl_top"], "brick"), (ZL, ZL_BACK_Y0, BACK, H["zl_top"], "brick"),
                                    ((ZL[0] + 3, ZL[1] - 3), ZL_FRONT_Y1, ZL_BACK_Y0, H["hall"], "brick"),
                                    (DL, DL_BAR[0], DL_BAR[1], H["dl"], "dlwin"), (DL, FRONT, DL_BAR[0], H["pod"], "podglass")):
        WALL(far, a, b, y0, y1, 0.0, h, key)
        flat_top(far, a, b, y0, y1, h, key="slate" if key == "brick" else ("tile" if key in ("xlwin", "gbwin") and h > 30 else "flat"))
    for (a, b), yn in DL_WINGS:
        hh = H["dl"] if yn > 30 else H["dl"] - 11.0
        WALL(far, a, b, DL_BAR[1], yn, 0.0, hh, "dlwin", faces=("+y", "-x", "+x"))
        flat_top(far, a, b, DL_BAR[1], yn, hh)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    collider_box(helpers, "guest", GB[0], GB[1], FRONT, BACK, 0.0, H["gb"])
    collider_box(helpers, "xilou", XL[0], XL[1], FRONT, -5.0, 0.0, H["xl"])
    collider_box(helpers, "xilouBack", XL[0], LINK[1], -5.0, BACK, 0.0, H["xl_back"])
    collider_box(helpers, "link", LINK[0], LINK[1], FRONT + 2.0, -5.0, 0.0, H["xl"] - 3.0)
    collider_box(helpers, "zlFront", ZL[0], ZL[1], FRONT, ZL_FRONT_Y1, 0.0, H["zl_top"])
    collider_box(helpers, "zlBack", ZL[0], ZL[1], ZL_BACK_Y0, BACK, 0.0, H["zl_top"])
    collider_box(helpers, "hall", ZL[0], ZL[1], ZL_FRONT_Y1, ZL_BACK_Y0, 0.0, H["hall"])
    collider_box(helpers, "dlBar", DL[0], DL[1], DL_BAR[0], DL_BAR[1], 0.0, H["dl"])
    for (a, b), yn in DL_WINGS:
        collider_box(helpers, "dlWing", a, b, DL_BAR[1], yn, 0.0, H["dl"] if yn > 30 else H["dl"] - 11.0)
    collider_box(helpers, "podium", DL[0], DL[1], FRONT, DL_BAR[0], 0.0, H["pod"])
    collider_box(helpers, "entrance", 79.8, 108.9, -34.6, FRONT, 0.0, 9.0)
    cx = (XL[0] + XL[1]) / 2
    for x in (cx - 7.6, cx - 2.6, cx + 2.6, cx + 7.6):
        collider_box(helpers, "porchPier", x - 0.4, x + 0.4, FRONT - 4.8, FRONT - 4.0, 0.0, 6.0)
    cz = (ZL[0] + ZL[1]) / 2
    for x in (cz - 5.6, cz + 5.6):
        collider_box(helpers, "canopyPier", x - 0.25, x + 0.25, FRONT - 4.3, FRONT - 3.8, 0.0, 5.2)
    for x in (77.0, 111.6):
        collider_box(helpers, "canopyPost", x - 0.3, x + 0.3, -39.6, -39.0, 0.0, 7.6)
    flat_marker(helpers, "west", rect(GB[0], ZL[1], FRONT - 0.5, BACK + 0.3), "FOOTPRINT")
    flat_marker(helpers, "east", rect(DL[0], DL[1] + 0.3, -34.8, 34.2), "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "beijinghotel", "北京饭店", "Beijing Hotel"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ORIGIN[0], ORIGIN[1], HEADING
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, dormers=len(dormers), pavilion_parts=n, far=far.tris())


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
