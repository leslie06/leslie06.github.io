# 中国科学技术馆 China Science and Technology Museum (new building, 2009), built in Blender and marked with the
# bcity_landmark add-on's conventions. OSM way 161298694 (building=yes; building:part 1460577256 says 20 m, the
# 球幕影院 part 924472174 a 40 m dome) in the Olympic area between 大屯北路 (south) and 科荟南路 (north), 北辰东路 to
# the east; the city drew it as a 20 m slab.
#
#   blender -b -P scripts/blender/landmarks/cstm.py -- [--out art/landmarks/cstm.blend] [--export]
#
# Needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header) for the name.
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the main block (162 x 163 m in
# OSM's outline turned onto its own axes), game (-430.61, -10660.83), heading -1.88 (the outline's edges).
#
# The real figures (published): 228 x 182 m over all, 45 m high, 102,300 m2, four storeys and a partial fifth; one
# big square volume made of interlocking "puzzle" blocks like a 鲁班锁 or a Rubik's cube; the blocks' front faces in
# continuous white corrugated metal laid at different angles (the shadows change with the sun), the exposed sides
# green reflective glass and stainless steel; the dome cinema (球幕影院) as a sphere at the south-west.
# Here: the main block as a relief of puzzle units on every face - a grid of 15 m columns between 6 m white corner
# piers, in rows of 10/12/12/11 m - units of one to three columns and one or two rows standing out 2 or 4.5 m or set
# 2.5 m in, fronted in white corrugated metal (the corrugation turned 0/90/+-45 degrees unit by unit) or dark glass,
# their sides in green glass (the kit's facade shader) and their tops and soffits in stainless; the ground storey a
# glazed lobby, the entrance recess in OSM's outline (south, 32 m wide, 6.5 m deep) under the overhanging units with
# 中国科学技术馆 over it, a platform and steps before it; two puzzle blocks rising through the roof; the low wings and
# the 41.6 m sphere at the south-west on OSM's circle; paving round it out to the streets.
# Doubtful: where the entrance is (south, from the recess in OSM's outline; it may be on the east); the unit pattern
# (a seeded arrangement, not the real one); the wings' heights; the sign's place and colour; OSM's 12 x 31 m notch at
# the north-west corner of the main block is not modelled (the ground storey runs over it).

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Geo, T, collider_box, collider_pts, flat_marker, lathe, paving, rect  # noqa: E402
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "cstm.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = -430.61, -10660.83, -1.88
H = 81.0                                      # the main block's half size
TOP = 45.0
ZS = [0.0, 10.0, 22.0, 34.0, TOP]             # unit rows
CORNER, COL = 6.0, 15.0                       # corner piers and unit columns: 6 + 10 x 15 + 6 = 162
US = [0.0] + [CORNER + COL * k for k in range(11)] + [2 * H]
NCOL = len(US) - 1                            # 12: the two corner piers and ten columns
ENTRY = (7, 8)                                # south face columns of the entrance recess (x 15..45)
ENTRY_D = -6.5
JOINT = 0.25                                  # the shadow joint round each unit's front
SPHERE = (-121.35, -53.25, 20.8)              # OSM's circle: centre and radius
SPHERE_TOP = 40.0
# the wings: (x0, x1, y0, y1, height)
WINGS = [(-140.75, -92.05, -86.95, -76.55, 8.0), (-100.55, -81.0, -86.95, -47.45, 14.0)]
# roof blocks rising through: (x0, x1, y0, y1, top)
ROOF_BLOCKS = [(21.0, 66.0, 21.0, 66.0, 50.5), (-66.0, -21.0, -51.0, -6.0, 48.5)]
PLAT = (4.0, 56.0, -93.5, -81.0, 1.2)         # the entrance platform (x0, x1, y0, y_face, height)

# the four faces counter-clockwise: start corner, direction along, outward normal
FACES = {
    "s": (Vector((-H, -H, 0)), Vector((1, 0, 0)), Vector((0, -1, 0))),
    "e": (Vector((H, -H, 0)), Vector((0, 1, 0)), Vector((1, 0, 0))),
    "n": (Vector((H, H, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0))),
    "w": (Vector((-H, H, 0)), Vector((0, -1, 0)), Vector((-1, 0, 0))),
}


def wave_image(size=256):
    """White corrugated metal: one tile is 2 m, the profile every 0.25 m, shaded as a sine across u."""
    y, x = (np.mgrid[0:size, 0:size] + 0.5) / size
    s = 0.86 + 0.14 * (0.5 + 0.5 * np.sin(x * 2 * math.pi * 8))
    a = np.empty((size, size, 3), np.float32)
    a[:] = np.array([0.93, 0.94, 0.93], np.float32)
    a *= s[..., None]
    rng = np.random.default_rng(5)
    a *= (0.985 + 0.03 * rng.random((size, 1, 1))).astype(np.float32)
    return image("CS_Wave", a)


def layout(face, seed):
    """The units of one face: off[col][row] (metres out from the face plane), unit[col][row] -> index, and the
    units' (c0, c1, r0, r1, offset, kind, angle)."""
    rng = random.Random(seed)
    off = [[0.0] * 4 for _ in range(NCOL)]
    uid = [[-1] * 4 for _ in range(NCOL)]
    units = []
    # the corner piers: white, flush, full height
    for c in (0, NCOL - 1):
        units.append((c, c + 1, 0, 4, 0.0, "pier", 90.0))
        for r in range(4):
            uid[c][r] = len(units) - 1
    # the ground storey: the lobby glass, flush (the entrance recess on the south)
    for c in range(1, NCOL - 1):
        d = ENTRY_D if face == "s" and c in ENTRY else 0.0
        units.append((c, c + 1, 0, 1, d, "lobby", 0.0))
        uid[c][0] = len(units) - 1
        off[c][0] = d
    # over the entrance a wide white unit standing out (the sign goes on it)
    if face == "s":
        units.append((ENTRY[0], ENTRY[-1] + 1, 1, 2, 1.5, "wave", 0.0))
        for c in ENTRY:
            uid[c][1] = len(units) - 1
            off[c][1] = 1.5
    offsets = [4.5, 2.0, -2.5, 0.0]
    for r in range(1, 4):
        for c in range(1, NCOL - 1):
            if uid[c][r] >= 0:
                continue
            w = rng.choice([1, 1, 2, 2, 3])
            h = rng.choice([1, 1, 2]) if r < 3 else 1
            free = 0
            while c + free <= NCOL - 2 and uid[c + free][r] < 0:
                free += 1
            w = max(1, min(w, free))
            h = max(1, min(h, 4 - r))
            if h == 2 and any(uid[cc][r + 1] >= 0 for cc in range(c, c + w)):
                h = 1
            left = off[c - 1][r]
            below = off[c][r - 1]
            cands = [d for d in offsets if d != left and d != below] or offsets
            d = rng.choice(cands)
            kind = "glass" if rng.random() < 0.3 else "wave"
            ang = rng.choice([0.0, 90.0, 45.0, -45.0])
            units.append((c, c + w, r, r + h, d, kind, ang))
            for cc in range(c, c + w):
                for rr in range(r, r + h):
                    uid[cc][rr] = len(units) - 1
                    off[cc][rr] = d
    return off, uid, units


def build_face(g, face, seed):
    a, t, n = FACES[face]
    up = Vector((0, 0, 1))
    off, uid, units = layout(face, seed)

    def P(u, d, z):
        return a + t * u + n * d + up * z

    # unit fronts
    for (c0, c1, r0, r1, d, kind, ang) in units:
        u0, u1, z0, z1 = US[c0], US[c1], ZS[r0], ZS[r1]
        if kind in ("wave", "glass"):
            # a shadow joint round the unit: its front inset JOINT, the ring behind it set back
            J, B = JOINT, 0.3
            outer = [P(u0, d - B, z0), P(u1, d - B, z0), P(u1, d - B, z1), P(u0, d - B, z1)]
            inner_b = [P(u0 + J, d - B, z0 + J), P(u1 - J, d - B, z0 + J), P(u1 - J, d - B, z1 - J), P(u0 + J, d - B, z1 - J)]
            inner_f = [P(u0 + J, d, z0 + J), P(u1 - J, d, z0 + J), P(u1 - J, d, z1 - J), P(u0 + J, d, z1 - J)]
            for k in range(4):
                k2 = (k + 1) % 4
                g.polyn([tuple(outer[k]), tuple(outer[k2]), tuple(inner_b[k2]), tuple(inner_b[k])], "joint", tuple(n))
                mid = (inner_f[k] + inner_f[k2]) / 2
                ctr = (inner_f[0] + inner_f[2]) / 2
                g.polyn([tuple(inner_b[k]), tuple(inner_b[k2]), tuple(inner_f[k2]), tuple(inner_f[k])], "joint", tuple(mid - ctr))
            u0, u1, z0, z1 = u0 + J, u1 - J, z0 + J, z1 - J
        pts = [P(u0, d, z0), P(u1, d, z0), P(u1, d, z1), P(u0, d, z1)]
        if kind in ("wave", "pier"):
            ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            uvs = [((u * ca - z * sa) / 2.0, (u * sa + z * ca) / 2.0) for u, z in ((u0, z0), (u1, z0), (u1, z1), (u0, z1))]
            key = "wave"
        else:
            uvs = [(u0, z0), (u1, z0), (u1, z1), (u0, z1)]
            key = "glass" if kind == "glass" else "lobby"
        g.polyn([tuple(p) for p in pts], key, tuple(n), uvs=uvs)
    # vertical reveals between columns
    for c in range(NCOL - 1):
        u = US[c + 1]
        for r in range(4):
            d1, d2 = off[c][r], off[c + 1][r]
            if abs(d1 - d2) < 1e-6:
                continue
            lo, hi = min(d1, d2), max(d1, d2)
            z0, z1 = ZS[r], ZS[r + 1]
            want = t if d1 > d2 else -t
            g.polyn([tuple(P(u, lo, z0)), tuple(P(u, hi, z0)), tuple(P(u, hi, z1)), tuple(P(u, lo, z1))], "reveal", tuple(want),
                    uvs=[(lo, z0), (hi, z0), (hi, z1), (lo, z1)])
    # horizontal reveals: between rows, the roof edge, and the ground under a recess
    for c in range(NCOL):
        u0, u1 = US[c], US[c + 1]
        for r in range(4):
            d_lo = off[c][r]
            d_up = off[c][r + 1] if r < 3 else 0.0
            z = ZS[r + 1]
            if abs(d_lo - d_up) < 1e-6:
                continue
            lo, hi = min(d_lo, d_up), max(d_lo, d_up)
            want = (0, 0, 1) if d_lo > d_up else (0, 0, -1)
            g.polyn([tuple(P(u0, lo, z)), tuple(P(u1, lo, z)), tuple(P(u1, hi, z)), tuple(P(u0, hi, z))], "steel", want)
    return off


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    M = dict(
        wave=material("CS_Wave", "#ffffff", 0.45, metal=0.15, tex=wave_image(), props={"wet": "surface", "glowStrength": 0.6}),
        glass=facade("CS_Glass", dict(floorH=6.0, colW=3.0, glass="#3d5552", frame="#c7cbca", spandrel="#55625f", mull=0.04, slab=0.05, metal=0.85, rough=0.06, lit=0.22, seed=21)),
        reveal=facade("CS_Reveal", dict(floorH=3.0, colW=1.5, glass="#5c8a7a", frame="#b7bcbd", mull=0.05, slab=0.05, metal=0.9, rough=0.05, lit=0.0, seed=22)),
        lobby=facade("CS_Lobby", dict(floorH=5.0, colW=2.5, glass="#566a70", frame="#cfd3d3", spandrel="#cfd3d3", mull=0.035, slab=0.03, metal=0.8, rough=0.05, lit=0.65, warm="#ffdcae", coolShare=0.2, seed=23)),
        joint=material("CS_Joint", "#3a3f3f", 0.6, metal=0.4, props={"wet": "none", "glow": "none"}),
        steel=material("CS_Steel", "#b9bdbf", 0.3, metal=0.9, props={"wet": "surface", "glowStrength": 0.4}),
        roof=material("CS_Roof", "#8b8d8c", 0.85, props={"wet": "ground", "glow": "none"}),
        dome=material("CS_Dome", "#e8eae9", 0.3, metal=0.35, props={"wet": "surface", "glowStrength": 0.5}),
        granite=material("CS_Granite", "#a29e96", 0.7, props={"wet": "ground", "glow": "none", "layer": 10}),
        pave=material("CS_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 9}),
        letters=material("CS_Letters", "#2f3a45", 0.3, metal=0.7, props={"wet": "surface", "glow": "lamp", "glowColor": [0.75, 0.88, 1.0], "glowStrength": 0.6}),
    )
    TILE = dict(steel=2.0, roof=4.0, granite=3.0, pave=4.0, dome=2.0)
    main = collection("中国科学技术馆")
    g = Geo()
    for i, face in enumerate(("s", "e", "n", "w")):
        build_face(g, face, 1701 + 37 * i)
    # the roof and the blocks rising through it
    g.polyn([(-H, -H, TOP), (H, -H, TOP), (H, H, TOP), (-H, H, TOP)], "roof", (0, 0, 1))
    for k, (x0, x1, y0, y1, z1) in enumerate(ROOF_BLOCKS):
        for (pa, pb, nn) in (((x0, y0), (x1, y0), (0, -1, 0)), ((x1, y0), (x1, y1), (1, 0, 0)), ((x1, y1), (x0, y1), (0, 1, 0)), ((x0, y1), (x0, y0), (-1, 0, 0))):
            L = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
            g.polyn([(*pa, TOP), (*pb, TOP), (*pb, z1), (*pa, z1)], "wave" if k == 0 else "glass", nn,
                    uvs=[(0, TOP / 2), (L / 2, TOP / 2), (L / 2, z1 / 2), (0, z1 / 2)] if k == 0 else [(0, TOP), (L, TOP), (L, z1), (0, z1)])
        g.polyn([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], "roof", (0, 0, 1))
    # plant on the roof
    for (x, y) in ((-45.0, 40.0), (-20.0, 55.0), (50.0, -45.0)):
        g.box(x - 5, x + 5, y - 3, y + 3, TOP, TOP + 2.5, "steel", skip=("-z",))
    # the entrance recess's ceiling is the soffit already; its floor and the platform before it
    x0, x1, y0, yf, ph = PLAT
    g.box(x0, x1, y0 + 2.4, yf + 6.5, 0.0, ph, "granite", skip=("-z",))
    for k in range(4):                      # four steps down to the plaza
        yy = y0 + 2.4 - 0.6 * (k + 1)
        g.box(x0, x1, yy, yy + 0.6, 0.0, ph * (4 - k) / 5, "granite", skip=("-z", "+y"))
    # the sign over the entrance
    font = bpy.data.fonts.load(FONT)
    xm = (US[ENTRY[0]] + US[ENTRY[-1] + 1]) / 2 - H
    m = T(xm, -H - 1.5 - 0.02, (ZS[1] + ZS[2]) / 2) @ Matrix.Rotation(math.pi / 2, 4, "X")
    letters = collection("招牌", main)
    nl = sign(font, "中国科学技术馆", 3.0, m, "Sign", letters, M["letters"], extrude=0.12)
    m2 = T(xm, -H - 1.5 - 0.02, ZS[1] + 2.2) @ Matrix.Rotation(math.pi / 2, 4, "X")
    nl += sign(font, "CHINA SCIENCE AND TECHNOLOGY MUSEUM", 0.9, m2, "SignEn", letters, M["letters"], extrude=0.06)

    # the wings and the sphere
    for (x0, x1, y0, y1, h) in WINGS:
        for (pa, pb, nn) in (((x0, y0), (x1, y0), (0, -1, 0)), ((x1, y0), (x1, y1), (1, 0, 0)), ((x1, y1), (x0, y1), (0, 1, 0)), ((x0, y1), (x0, y0), (-1, 0, 0))):
            L = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
            g.polyn([(*pa, 0.0), (*pb, 0.0), (*pb, 6.0), (*pa, 6.0)], "lobby", nn, uvs=[(0, 0), (L, 0), (L, 6), (0, 6)])
            g.polyn([(*pa, 6.0), (*pb, 6.0), (*pb, h), (*pa, h)], "wave", nn, uvs=[(0, 3), (L / 2, 3), (L / 2, h / 2), (0, h / 2)])
        g.polyn([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], "roof", (0, 0, 1))
    sx, sy, sr = SPHERE
    zc = SPHERE_TOP - sr
    prof = []
    a0 = math.asin(max(-1.0, -zc / sr))
    for k in range(17):
        a = a0 + (math.pi / 2 - a0) * k / 16
        prof.append((sr * math.cos(a), zc + sr * math.sin(a)))
    prof[-1] = (0.0, SPHERE_TOP)
    lathe(g, prof, 48, "dome", x=sx, y=sy)
    # a ring of panel joints round the sphere: a stainless band at the equator
    lathe(g, [(sr + 0.15, zc - 0.4), (sr + 0.15, zc + 0.4)], 48, "steel", x=sx, y=sy)

    # paving out to the streets (clear of the service roads: one north, a driveway east at y -17)
    E = 115.0
    for (x0, x1, y0, y1) in ((-146.0, E, -96.0, -H), (H, E, -H, -21.0), (H, E, -13.0, 87.0), (-108.0, H, H, 87.0), (-98.0, -H, -47.0, H)):
        g.polyn([(x0, y0, 0.03), (x1, y0, 0.03), (x1, y1, 0.03), (x0, y1, 0.03)], "pave", (0, 0, 1))
    g.build("Museum", collection("科技馆", main), M, TILE)
    tris = g.tris()

    # ---- far level: the block, the roof blocks, the wings, the sphere ----
    far = Geo()
    for (pa, pb, nn) in (((-H, -H), (H, -H), (0, -1, 0)), ((H, -H), (H, H), (1, 0, 0)), ((H, H), (-H, H), (0, 1, 0)), ((-H, H), (-H, -H), (-1, 0, 0))):
        L = 2 * H
        far.polyn([(*pa, 0.0), (*pb, 0.0), (*pb, 10.0), (*pa, 10.0)], "lobby", nn, uvs=[(0, 0), (L, 0), (L, 10), (0, 10)])
        far.polyn([(*pa, 10.0), (*pb, 10.0), (*pb, TOP), (*pa, TOP)], "wave", nn, uvs=[(0, 5), (L / 2, 5), (L / 2, TOP / 2), (0, TOP / 2)])
    far.polyn([(-H, -H, TOP), (H, -H, TOP), (H, H, TOP), (-H, H, TOP)], "roof", (0, 0, 1))
    for (x0, x1, y0, y1, z1) in ROOF_BLOCKS:
        far.box(x0, x1, y0, y1, TOP, z1, "wave", skip=("-z",))
    for (x0, x1, y0, y1, h) in WINGS:
        far.box(x0, x1, y0, y1, 0.0, h, "wave", skip=("-z",))
    lathe(far, prof[::2] + ([prof[-1]] if len(prof) % 2 == 0 else []), 20, "dome", x=sx, y=sy)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # ---- colliders ----
    helpers = collection("碰撞体")
    ex0, ex1 = US[ENTRY[0]] - H, US[ENTRY[-1] + 1] - H
    collider_box(helpers, "block_w", -H, ex0, -H, H, 0.0, TOP)
    collider_box(helpers, "block_e", ex1, H, -H, H, 0.0, TOP)
    collider_box(helpers, "block_mid", ex0, ex1, -H - ENTRY_D, H, 0.0, TOP)
    collider_box(helpers, "over_entry", ex0, ex1, -H - 1.5, -H - ENTRY_D, ZS[1], TOP)
    for k, (x0, x1, y0, y1, z1) in enumerate(ROOF_BLOCKS):
        collider_box(helpers, f"roofblock{k}", x0, x1, y0, y1, TOP, z1)
    for k, (x0, x1, y0, y1, h) in enumerate(WINGS):
        collider_box(helpers, f"wing{k}", x0, x1, y0, y1, 0.0, h)
    pts = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        for (r, z) in prof[::3] + [prof[-1]]:
            pts.append((sx + r * math.cos(a), sy + r * math.sin(a), z))
    collider_pts(helpers, "sphere", pts)
    # the platform: solid, with a walk-only ramp over its steps (a car stops at their foot)
    collider_box(helpers, "platform", PLAT[0], PLAT[1], PLAT[2] + 2.4, -H - ENTRY_D, 0.0, PLAT[4])
    ys = PLAT[2] + 2.4 - 2.4
    collider_pts(helpers, "steps", [(PLAT[0], ys, 0.0), (PLAT[1], ys, 0.0), (PLAT[0], PLAT[2] + 2.4, 0.0), (PLAT[1], PLAT[2] + 2.4, 0.0),
                                    (PLAT[0], PLAT[2] + 2.4, PLAT[4]), (PLAT[1], PLAT[2] + 2.4, PLAT[4])], role="WALK")

    flat_marker(helpers, "cstm_main", rect(-H - 0.5, H + 0.5, -H - 0.5, H + 0.5), "FOOTPRINT")
    flat_marker(helpers, "cstm_wings", rect(-141.5, -H + 0.5, -88.5, -47.0), "FOOTPRINT")
    flat_marker(helpers, "cstm_sphere", [(sx + (sr + 0.5) * math.cos(2 * math.pi * k / 24), sy + (sr + 0.5) * math.sin(2 * math.pi * k / 24)) for k in range(24)], "FOOTPRINT")
    flat_marker(helpers, "cstm_clear", rect(-146.0, E, -96.0, 87.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "cstm", "中国科学技术馆", "China Science and Technology Museum"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 800
    s.repo_path = REPO
    return dict(tris=tris, letters=nl, far=far.tris())


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
