# 北京天文馆 Beijing Planetarium (西直门外大街 138号, across the street from the zoo), built in Blender and marked
# with the bcity_landmark add-on's conventions. Two buildings:
#   A馆 (张开济, 1957): OSM way 78051135 (amenity=planetarium, building:levels=5 - a mis-tag): a symmetrical
#     front block facing 西直门外大街 - two-storey wings either side of a taller central block with a loggia of
#     six square pillars and 北京天文馆 over it - and behind it the 天象厅: a drum carrying the hemispherical
#     dome (the hall inside is 23.5 m across; zh.wikipedia).
#   B馆 (王弄极 / Nonchi Wang with 中国航天建筑设计研究院, 2004; five storeys above ground, 21,594 m2): OSM way
#     78051172 (named 北京天文馆), a 154 x 31 m block turned 10.4 degrees; its north side is the twisted
#     glass "fabric of space-time" - a dark blue glass curtain curving from a vertical wall at the street up over
#     the roof, sucked in by "worm holes" (funnels with a lit core) - and on the roof, from Google's imagery, a
#     glass sphere ringed by a dark band, the ring-walled 宇宙剧场 dome and the observatory dome.
# The glass is the kit's facade shader (material property `facade`), so Blender gives the form only.
#
#   blender -b -P scripts/blender/landmarks/planetarium.py -- [--out art/landmarks/planetarium.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (-5720, -3005) between the two
# buildings, heading 0; each building is built in its own frame and turned into place (A馆 1.5 degrees, B馆 10.42).
# Where things are: B馆 is OSM's rectangle as it is (it matches Google's imagery). A馆's shapes come from Google's
# imagery (the wings 94 x 20 m, the central block 27 m wide reaching 11 m further north, the drum 34 m across
# with the dome 26 m across inside it), placed between Google's dome (shifted the ~5 m Google's ground is north
# of OSM's streets) and OSM's drum circle: dome centre game (-5739, -3021). OSM's own A馆 outline is smaller.
# Doubtful: every height (none published: wings 12.4 m, central block 16.5, drum 11.6, dome top 24.6, B馆's roof
# 26 m from its five storeys and the length of its shadow), A馆's facade (pillars, windows) and colours, B馆's
# south and end walls (aluminium panels with ribbon windows - not seen), the glass curtain's exact shape and the
# worm holes' number and places, the roof pieces' heights.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_box, collider_pts, flat_marker, fwall, paving  # noqa: E402
from tower import sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "planetarium.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ = -5720.0, -3005.0


def G(x, z):
    """Game metres (+x east, +z south) to this frame."""
    return (x - GX, -(z - GZ))


A_C, A_ROT = G(-5739.0, -3021.0), math.radians(1.5)
B_C, B_ROT = G(-5694.0, -2988.6), math.radians(10.42)
MA = T(A_C[0], A_C[1], 0) @ Rz(A_ROT)
MB = T(B_C[0], B_C[1], 0) @ Rz(B_ROT)

# OSM's A馆 outline (way 78051135), game metres relative to (-5694, -2989)
A_OSM = [(-94.0, -56.2), (-61.1, -57.2), (-58.3, -61.7), (-39.6, -63.0), (-36.8, -57.9), (-1.5, -59.9), (-1.4, -44.0),
         (-32.3, -41.8), (-28.8, -29.0), (-33.6, -16.2), (-46.4, -10.8), (-60.0, -16.7), (-64.4, -28.8), (-60.8, -41.1),
         (-94.6, -40.2)]

# --- A馆 dimensions (its frame: origin the dome's centre, +Y north to the street) ------------------------------
PL = 0.9                                  # plinth
WX, WY0, WY1, WH = 47.0, 14.5, 34.5, 10.9  # wings: half width, south and north faces, top of the windowed wall
CX, CY1, CH = 13.5, 45.5, 16.5            # central block: half width, north face (the pillars' front), top
LOG = 4.2                                 # the loggia's depth
DR, DH = 17.0, 11.0                       # drum radius and wall height
DOME_R, DOME_Z = 13.0, 11.6               # dome radius and springing
STEPS = 4.0                               # the front steps' run

# --- B馆 (its frame: u along the block, east-north-east; w across, +w to the north-north-west glass) -----------
L2, W2, H = 153.7 / 2, 31.2 / 2, 26.0
NU, NT = 96, 20                           # the glass curtain's grid
# worm holes: (first u cell, first t cell, cells across), blocks must not overlap
HOLES = [(6, 3, 6), (17, 10, 5), (26, 2, 8), (38, 12, 6), (47, 4, 5), (55, 9, 9), (66, 2, 6), (74, 12, 5), (82, 5, 7), (90, 13, 4)]


def D(u):
    """How far the glass curves in over the roof (m): wide at the east end, twisting along the block."""
    return 9.3 + 3.2 * (u / L2) + 1.7 * math.sin(2 * math.pi * u / 95.0 + 0.8)


def S(u, t):
    """The glass surface: a quarter ellipse from the vertical wall at the street (t 0) over onto the roof (t 1)."""
    th = t * math.pi / 2
    d = D(u)
    return Vector((u, W2 - d + d * math.cos(th), H * math.sin(th)))


def N(u, t):
    e = 1e-3
    du = S(u + e, t) - S(u - e, t)
    dt = S(u, min(1.0, t + e)) - S(u, max(0.0, t - e))
    n = du.cross(dt).normalized()
    return n if n.y + n.z > 0 else -n


def arc(u, t, steps=40):
    """Arc length up the curtain from the ground to t (m)."""
    s, p = 0.0, S(u, 0.0)
    for k in range(1, steps + 1):
        q = S(u, t * k / steps)
        s += (q - p).length
        p = q
    return s


def U(i):
    return -L2 + 2 * L2 * i / NU


# --- materials -----------------------------------------------------------------------------------------------

def wall_images():
    """One bay (4 m) by one storey (5 m) of A馆's front: cream render, a tall window with a stone surround."""
    cv = Canvas(256, 320, "#d6cfbc")
    cv.noise(0.06, 3)
    em = Canvas(256, 320, "#000000")
    cv.rect(52, 40, 204, 272, "#e6e0cf")            # surround
    cv.rect(64, 52, 192, 260, "#34404a")            # glass
    em.rect(64, 52, 192, 260, "#ffcf8f")
    for x in (126, 130):
        cv.rect(x - 3, 52, x + 3, 260, "#e3ddcc")
    cv.rect(64, 120, 192, 126, "#e3ddcc")
    em.rect(123, 52, 133, 260, "#000000")
    em.rect(64, 120, 192, 126, "#000000")
    cv.rect(40, 272, 216, 286, "#c9c1ac")           # sill
    cv.rect(0, 300, 256, 320, "#cbc3ae")            # floor band
    em.a *= 0.7
    return image("PL_WallTex", np.flipud(cv.a).copy()), image("PL_WallNight", np.flipud(em.a).copy())


def panel_images():
    """One bay (6 m) by one storey (5.2 m) of B馆's opaque walls: aluminium panels and a ribbon window."""
    cv = Canvas(256, 224, "#b3b8bc")
    cv.noise(0.05, 5)
    em = Canvas(256, 224, "#000000")
    cv.rect(0, 84, 256, 140, "#2b3640")
    em.rect(0, 84, 256, 140, "#d9e6f2")
    for k in range(2):
        x = k * 128
        cv.rect(x, 0, x + 2, 84, "#9a9fa3")
        cv.rect(x, 140, x + 2, 224, "#9a9fa3")
    for k in range(4):
        cv.rect(k * 64, 84, k * 64 + 3, 140, "#7f878d")
        em.rect(k * 64, 84, k * 64 + 3, 140, "#000000")
    cv.rect(0, 0, 256, 2, "#9a9fa3")
    em.a *= 0.6
    return image("PL_PanelTex", np.flipud(cv.a).copy()), image("PL_PanelNight", np.flipud(em.a).copy())


def dome_image():
    """A馆's dome: pale metal sheets, 32 gores, ribs every eighth of the way up (u once round, v to the top)."""
    cv = Canvas(1024, 256, "#c4c7c3")
    cv.noise(0.05, 9)
    for k in range(32):
        cv.rect(k * 32, 0, k * 32 + 2, 256, "#b0b3b0")
    for k in range(8):
        cv.rect(0, k * 32, 1024, k * 32 + 2, "#b6b9b5")
    return image("PL_DomeTex", np.flipud(cv.a).copy())


def flat_image(name, col):
    return image(name, np.full((4, 4, 3), np.asarray(Canvas(1, 1, col).a[0, 0])))


def facade_mat(name, spec):
    return material(name, "#8a9aa8", 0.1, metal=0.8, props={"facade": json.dumps(spec), "wet": "surface", "glow": "none"})


def make_materials():
    wall, wall_n = wall_images()
    panel, panel_n = panel_images()
    return dict(
        wall=material("PL_Wall", "#ffffff", 0.85, tex=wall, emit_tex=wall_n, props={"wet": "damp", "emit": "night", "glow": "flood", "glowStrength": 0.5}),
        stone=material("PL_Stone", "#d6cfbc", 0.85, props={"wet": "damp", "glow": "flood", "glowStrength": 0.5}),
        dome=material("PL_Dome", "#ffffff", 0.4, metal=0.5, tex=dome_image(), props={"wet": "surface", "glow": "flood", "glowStrength": 0.6}),
        roof=material("PL_Roof", "#a29e94", 0.8, tex=paving(), props={"wet": "ground"}),
        lobby=facade_mat("PL_Lobby", dict(floorH=2.6, colW=1.3, glass="#36424c", frame="#6d6250", spandrel="#6d6250", mull=0.04, slab=0.03,
                                           metal=0.6, rough=0.1, lit=0.6, warm="#ffd59a", coolShare=0.0, seed=2)),
        letters=material("PL_Gilt", "#c9a052", 0.35, metal=0.9, props={"wet": "surface"}),
        panel=material("PL_Panel", "#ffffff", 0.45, metal=0.3, tex=panel, emit_tex=panel_n, props={"wet": "surface", "emit": "night", "glowStrength": 0.5}),
        alu=material("PL_Alu", "#b9bec2", 0.4, metal=0.5, props={"wet": "surface"}),
        glass=facade_mat("PL_Glass", dict(floorH=1.45, colW=1.6, glass="#21436a", frame="#4f6070", spandrel="#4f6070", mull=0.018, slab=0.022,
                                          metal=0.85, rough=0.05, lit=0.07, warm="#ffd9a8", cool="#cfe6ff", coolShare=0.6, seed=5)),
        sphere=facade_mat("PL_Sphere", dict(floorH=1.9, colW=1.9, glass="#5a83a8", frame="#c3cad0", spandrel="#c3cad0", mull=0.04, slab=0.04,
                                            metal=0.8, rough=0.05, lit=0.6, warm="#bfe0ff", coolShare=1.0, cool="#bfe0ff", seed=8)),
        hole=material("PL_Hole", "#0c1724", 0.3, metal=0.2, emit_tex=flat_image("PL_HoleGlow", "#5fa8ff"), props={"wet": "surface", "emit": "night", "glowStrength": 1.4}),
        metal=material("PL_Metal", "#c9ced2", 0.28, metal=0.85, props={"wet": "surface", "glow": "flood", "glowStrength": 0.5}),
        dark=material("PL_DarkMetal", "#3a4147", 0.4, metal=0.7, props={"wet": "surface"}),
    )


TILE = dict(stone=2.0, roof=4.0, alu=2.0, metal=2.0, dark=2.0, hole=2.0)


# --- shared shapes ---------------------------------------------------------------------------------------------

def dome(g, cx, cy, z0, r, segs, rings, key, phi_max=math.pi / 2, uv="unit", start=0.0):
    """A spherical cap from polar angle phi_max up to the top; uv 'unit' = once round and once up, 'm' = metres."""
    pts = []
    for j in range(rings + 1):
        ph = phi_max * (1 - j / rings)
        row = []
        for i in range(segs + 1):
            th = start + 2 * math.pi * i / segs
            p = (cx + r * math.sin(ph) * math.cos(th), cy + r * math.sin(ph) * math.sin(th), z0 + r * math.cos(ph))
            if uv == "unit":
                t = (i / segs, j / rings)
            else:
                t = (r * math.sin(phi_max) * 2 * math.pi * i / segs, r * (phi_max - ph))
            row.append((p, t))
        pts.append(row)
    for j in range(rings):
        for i in range(segs):
            a, b, c, d = pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]
            if j == rings - 1:
                g.face([g.vert(a[0]), g.vert(b[0]), g.vert(c[0])], key, [a[1], b[1], c[1]], smooth=True)
            else:
                g.face([g.vert(a[0]), g.vert(b[0]), g.vert(c[0]), g.vert(d[0])], key, [a[1], b[1], c[1], d[1]], smooth=True)


def ring_wall(g, cx, cy, r0, r1, z0, z1, segs, key, gap=None):
    """A thick round wall (inner r0, outer r1), optionally open over angles gap = (a0, a1)."""
    a0, a1 = (gap[1], gap[0] + 2 * math.pi) if gap else (0.0, 2 * math.pi)
    n = max(3, int(segs * (a1 - a0) / (2 * math.pi)))
    P = lambda r, a, z: (cx + r * math.cos(a), cy + r * math.sin(a), z)    # noqa: E731
    for k in range(n):
        a, b = a0 + (a1 - a0) * k / n, a0 + (a1 - a0) * (k + 1) / n
        out = (math.cos((a + b) / 2), math.sin((a + b) / 2), 0)
        g.polyn([P(r1, a, z0), P(r1, b, z0), P(r1, b, z1), P(r1, a, z1)], key, out, smooth=True)
        g.polyn([P(r0, a, z0), P(r0, b, z0), P(r0, b, z1), P(r0, a, z1)], key, (-out[0], -out[1], 0), smooth=True)
        g.polyn([P(r0, a, z1), P(r0, b, z1), P(r1, b, z1), P(r1, a, z1)], key, (0, 0, 1))
    if gap:
        for a, s in ((a0, -1), (a1, 1)):
            t = (-math.sin(a) * s, math.cos(a) * s, 0)
            g.polyn([P(r0, a, z0), P(r1, a, z0), P(r1, a, z1), P(r0, a, z1)], key, t)


def cyl_wall(g, cx, cy, r, z0, z1, segs, key, uv_bay=None, storey=5.0):
    for k in range(segs):
        a, b = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        pa = (cx + r * math.cos(a), cy + r * math.sin(a))
        pb = (cx + r * math.cos(b), cy + r * math.sin(b))
        uvs = None
        if uv_bay:
            uvs = [(k, z0 / storey), (k + 1, z0 / storey), (k + 1, z1 / storey), (k, z1 / storey)]
        g.polyn([(pa[0], pa[1], z0), (pb[0], pb[1], z0), (pb[0], pb[1], z1), (pa[0], pa[1], z1)], key,
                (math.cos((a + b) / 2), math.sin((a + b) / 2), 0), uvs=uvs, smooth=uv_bay is None)


def disc(g, cx, cy, r0, r1, z, segs, key, up=True):
    for k in range(segs):
        a, b = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        pts = [(cx + r1 * math.cos(a), cy + r1 * math.sin(a), z), (cx + r1 * math.cos(b), cy + r1 * math.sin(b), z)]
        if r0 > 0:
            pts += [(cx + r0 * math.cos(b), cy + r0 * math.sin(b), z), (cx + r0 * math.cos(a), cy + r0 * math.sin(a), z)]
        else:
            pts += [(cx, cy, z)]
        g.polyn(pts, key, (0, 0, 1 if up else -1))


def facing(p, out):
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(*p) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


# --- A馆 ------------------------------------------------------------------------------------------------------

PILLARS = [-12.35, -7.4, -2.47, 2.47, 7.4, 12.35]


def a_hall(g):
    V = Vector
    # plinth: under the wings and the central block, the front steps
    g.box(-WX - 0.6, WX + 0.6, WY0 - 0.6, WY1 + 0.6, 0.0, PL, "stone", skip=("-z",))
    g.box(-CX - 0.6, CX + 0.6, WY1 + 0.6, CY1 + 0.6, 0.0, PL, "stone", skip=("-z",))
    n = 4
    for k in range(n):
        y0 = CY1 + 0.6 + STEPS * (1 - (k + 1) / n)
        g.box(-10.5, 10.5, y0, y0 + STEPS / n + (0.0 if k == 0 else 0.0), 0.0, PL * (k + 1) / (n + 1), "stone", skip=("-z",))
    # wings: windowed walls (two storeys of 5 m), a cornice, an attic and the roof
    for x0, x1 in ((-WX, -CX), (CX, WX)):
        fwall(g, V((x1, WY1)), V((x0, WY1)), PL, WH, "wall", (0, 1), bay=4.0, storey=5.0, zref=PL)
    fwall(g, V((-WX, WY0)), V((WX, WY0)), PL, WH, "wall", (0, -1), bay=4.0, storey=5.0, zref=PL)
    fwall(g, V((-WX, WY1)), V((-WX, WY0)), PL, WH, "wall", (-1, 0), bay=4.0, storey=5.0, zref=PL)
    fwall(g, V((WX, WY0)), V((WX, WY1)), PL, WH, "wall", (1, 0), bay=4.0, storey=5.0, zref=PL)
    g.box(-WX - 0.45, WX + 0.45, WY0 - 0.45, WY1 + 0.45, WH, WH + 0.55, "stone")
    g.box(-WX, WX, WY0, WY1, WH + 0.55, WH + 1.5, "stone", skip=("-z", "+z"))
    g.poly([(-WX, WY0, WH + 1.5), (WX, WY0, WH + 1.5), (WX, WY1, WH + 1.5), (-WX, WY1, WH + 1.5)], "roof")
    # the central block: windowed sides, the loggia (glass wall behind six pillars), entablature and attic
    zt = 12.6
    ylg = CY1 - LOG
    for sx in (-1, 1):
        a, b = V((sx * CX, WY1)), V((sx * CX, ylg))
        if sx < 0:
            a, b = b, a
        fwall(g, a, b, PL, zt, "wall", (sx, 0), bay=4.0, storey=5.0, zref=PL)
        # the loggia's side returns
        g.polyn([(sx * CX, ylg, PL), (sx * CX, CY1, PL), (sx * CX, CY1, zt), (sx * CX, ylg, zt)], "stone", (sx, 0, 0))
        g.polyn([(sx * (CX - 1.2), ylg, PL), (sx * (CX - 1.2), CY1, PL), (sx * (CX - 1.2), CY1, zt), (sx * (CX - 1.2), ylg, zt)], "stone", (-sx, 0, 0))
        g.box(sx * (CX - 1.2), sx * CX, CY1 - 0.01, CY1 + 0.01, PL, zt, "stone")
    g.polyn([(-CX + 1.2, ylg, PL), (CX - 1.2, ylg, PL), (CX - 1.2, ylg, zt), (-CX + 1.2, ylg, zt)], "lobby", (0, 1, 0),
            uvs=[(0, 0), (2 * CX - 2.4, 0), (2 * CX - 2.4, zt - PL), (0, zt - PL)])
    for x in PILLARS:
        g.box(x - 0.65, x + 0.65, CY1 - 1.3, CY1, PL, zt, "stone", skip=("-z", "+z"))
        g.box(x - 0.8, x + 0.8, CY1 - 1.45, CY1 + 0.15, PL, PL + 0.5, "stone", skip=("-z",))
    g.box(-CX - 0.3, CX + 0.3, ylg, CY1 + 0.35, zt, zt + 2.2, "stone")                 # entablature
    g.box(-CX - 0.6, CX + 0.6, WY1 - 0.4, CY1 + 0.65, zt + 2.2, zt + 2.7, "stone")      # cornice
    g.box(-CX, CX, WY1, CY1, zt + 2.7, CH, "stone", skip=("-z", "+z"))
    g.poly([(-CX, WY1, CH), (CX, WY1, CH), (CX, CY1, CH), (-CX, CY1, CH)], "roof")
    g.box(-CX, CX, WY0 + 2.0, WY1, WH + 1.5, zt + 2.2, "stone", skip=("-z",))          # the block's back over the wings
    # the drum: pilasters round a plain wall, a cornice, the flat ring and the dome
    cyl_wall(g, 0, 0, DR, 0.0, DH, 48, "stone")
    for k in range(24):
        a = 2 * math.pi * (k + 0.5) / 24
        if math.sin(a) > 0.82:       # hidden by the front block
            continue
        m = Rz(a)
        g2 = Geo()
        g2.box(DR - 0.05, DR + 0.35, -0.45, 0.45, 0.0, DH, "stone", skip=("-z", "+z", "-x"))
        g.add(g2, m)
    cyl_wall(g, 0, 0, DR + 0.6, DH, DH + 0.6, 48, "stone")
    disc(g, 0, 0, DR - 0.5, DR + 0.6, DH, 48, "stone", up=False)
    disc(g, 0, 0, DOME_R + 0.4, DR + 0.6, DH + 0.6, 48, "roof")
    cyl_wall(g, 0, 0, DOME_R + 0.4, DH + 0.6, DOME_Z + 0.6, 48, "stone")
    disc(g, 0, 0, DOME_R, DOME_R + 0.4, DOME_Z + 0.6, 48, "stone")
    dome(g, 0, 0, DOME_Z + 0.6, DOME_R, 64, 14, "dome")
    disc(g, 0, 0, 0, 1.2, DOME_Z + 0.6 + DOME_R + 0.02, 12, "metal")


def a_far(g):
    g.box(-WX, WX, WY0, WY1, 0.0, WH + 1.5, "wall", skip=("-z",))
    g.box(-CX, CX, WY1, CY1, 0.0, CH, "stone", skip=("-z",))
    cyl_wall(g, 0, 0, DR, 0.0, DH + 0.6, 16, "stone")
    disc(g, 0, 0, DOME_R, DR, DH + 0.6, 16, "roof")
    dome(g, 0, 0, DOME_Z + 0.6, DOME_R, 16, 4, "dome")


# --- B馆 ------------------------------------------------------------------------------------------------------

def in_hole(i, j):
    return any(i0 <= i < i0 + k and j0 <= j < j0 + k for i0, j0, k in HOLES)


def surf(fi, fj):
    """The curtain at fractional grid indices: point, normal, UV (metres along, metres up the curve)."""
    u, t = U(fi), fj / NT
    return S(u, t), N(u, t), (u + L2, arc(u, t))


def b_curtain(g):
    # the grid, leaving the worm holes' blocks out
    cache = {}

    def P(i, j):
        if (i, j) not in cache:
            cache[(i, j)] = surf(i, j)
        return cache[(i, j)]
    for i in range(NU):
        for j in range(NT):
            if in_hole(i, j):
                continue
            c = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]
            n = (c[0][1] + c[2][1]).normalized()
            g.polyn([q[0] for q in c], "glass", tuple(n), uvs=[q[2] for q in c], smooth=True)
    # each hole: the block's border ring blended to a circle, then the funnel down to a lit core
    for i0, j0, k in HOLES:
        ci, cj = i0 + k / 2, j0 + k / 2
        per = []
        for s in range(k):
            per.append((i0 + s, j0))
        for s in range(k):
            per.append((i0 + k, j0 + s))
        for s in range(k):
            per.append((i0 + k - s, j0 + k))
        for s in range(k):
            per.append((i0, j0 + k - s))
        ang = [math.atan2(pj - cj, pi_ - ci) for pi_, pj in per]
        r_out, r_core = 0.43 * k, 0.15 * k
        depth = 0.42 * k * (1.0 if (i0 * 7 + j0) % 3 else 0.75)
        rings = []
        for s in (0.0, 0.5, 1.0):
            rings.append([((1 - s) * pi_ + s * (ci + r_out * math.cos(a)), (1 - s) * pj + s * (cj + r_out * math.sin(a)), 0.0)
                          for (pi_, pj), a in zip(per, ang)])
        NL = 5
        for l in range(1, NL + 1):
            x = l / NL
            r = r_out - (r_out - r_core) * x
            rings.append([(ci + r * math.cos(a), cj + r * math.sin(a), depth * x ** 2.2) for a in ang])

        def pos(q):
            p, n, uv = surf(q[0], q[1])
            return p - n * q[2], n, uv
        R = [[pos(q) for q in ring] for ring in rings]
        m = len(per)
        for a, b in zip(R, R[1:]):
            for s in range(m):
                c = [a[s], a[(s + 1) % m], b[(s + 1) % m], b[s]]
                n = (c[0][1] + c[2][1]).normalized()
                g.polyn([q[0] for q in c], "glass", tuple(n), uvs=[q[2] for q in c], smooth=True)
        # the core: a short tube on along the normal, closed by a lit disc
        _, nc, _ = surf(ci, cj)
        core = [q[0] for q in R[-1]]
        mid = sum(core, Vector()) / m
        deep = [mid + (p - mid) * 0.8 - nc * 1.6 for p in core]
        for s in range(m):
            c = [core[s], core[(s + 1) % m], deep[(s + 1) % m], deep[s]]
            fc = sum(c, Vector()) / 4
            g.polyn(c, "hole", tuple(mid - nc * 0.8 - fc))
        g.polyn(deep, "hole", tuple(nc))


def b_block(g):
    # the south wall and the ends (their north edge follows the curtain), aluminium with ribbon windows
    g.polyn([(-L2, -W2, 0), (L2, -W2, 0), (L2, -W2, H), (-L2, -W2, H)], "panel", (0, -1, 0),
            uvs=[(0, 0), (2 * L2 / 6.0, 0), (2 * L2 / 6.0, H / 5.2), (0, H / 5.2)])
    for su in (-1, 1):
        u = su * L2
        prof = [S(u, j / NT) for j in range(NT + 1)]
        pts = [Vector((u, -W2, 0))] + prof + [Vector((u, -W2, H))]
        g.polyn(pts, "panel", (su, 0, 0), uvs=[((p.y + W2) / 6.0, p.z / 5.2) for p in pts])
    # roof (strips to the curtain's top edge) and a parapet round the south and the ends
    for i in range(NU):
        ua, ub = U(i), U(i + 1)
        g.polyn([(ua, -W2, H), (ub, -W2, H), (ub, W2 - D(ub), H), (ua, W2 - D(ua), H)], "roof", (0, 0, 1))
    g.box(-L2, L2, -W2, -W2 + 0.35, H, H + 1.1, "alu", skip=("-z",))
    for su in (-1, 1):
        x0, x1 = (su * L2 - 0.35, su * L2) if su > 0 else (su * L2, su * L2 + 0.35)
        g.box(x0, x1, -W2 + 0.35, W2 - D(su * L2), H, H + 1.1, "alu", skip=("-z",))
    # a plinth course and a canopy over the entrance at the west end of the curtain
    g.box(-L2 - 0.15, L2 + 0.15, -W2 - 0.15, -W2, 0.0, 0.6, "stone", skip=("-z",))
    g.box(-L2 + 4, -L2 + 26, W2, W2 + 4.5, 4.6, 4.9, "alu")
    for x in (-L2 + 5, -L2 + 25):
        g.box(x - 0.15, x + 0.15, W2 + 4.0, W2 + 4.3, 0.0, 4.6, "alu", skip=("-z", "+z"))


ROOF = dict(sphere=-24.4, theatre=4.6, observatory=53.3)


def b_roof(g, detail=True):
    segs = 40 if detail else 12
    # the glass sphere hall, ringed by a dark band on struts
    us = ROOF["sphere"]
    zc, r = H - 1.5, 11.0
    phi = math.acos((H - zc) / r)
    dome(g, us, 1.1, zc, r, segs, 10 if detail else 3, "sphere", phi_max=phi, uv="m")
    if detail:
        tilt = Matrix.Rotation(math.radians(14), 4, "X") @ Matrix.Rotation(math.radians(20), 4, "Z")
        band = Geo()
        disc(band, 0, 0, 12.0, 13.6, 0.0, 48, "dark", up=True)
        disc(band, 0, 0, 12.0, 13.6, -0.25, 48, "dark", up=False)
        for k in range(48):
            a, b = 2 * math.pi * k / 48, 2 * math.pi * (k + 1) / 48
            band.polyn([(13.6 * math.cos(a), 13.6 * math.sin(a), -0.25), (13.6 * math.cos(b), 13.6 * math.sin(b), -0.25),
                        (13.6 * math.cos(b), 13.6 * math.sin(b), 0.0), (13.6 * math.cos(a), 13.6 * math.sin(a), 0.0)], "dark",
                       (math.cos(a), math.sin(a), 0))
        g.add(band, T(us, 1.1, H + 4.0) @ tilt)
        st = Geo()                      # six struts from the sphere out to the band
        st.box(8.6, 12.1, -0.12, 0.12, -0.2, 0.05, "dark")
        for k in range(6):
            g.add(st, T(us, 1.1, H + 4.0) @ tilt @ Rz(2 * math.pi * k / 6))
        cyl_wall(g, us, 1.1, 11.6, H, H + 0.5, 40, "alu")
        disc(g, us, 1.1, r * math.sin(phi) - 0.05, 11.6, H + 0.5, 40, "alu")
    # the 宇宙剧场: a ring wall open to the north, the silver dome inside
    ut = ROOF["theatre"]
    if detail:
        ring_wall(g, ut, 0.5, 11.8, 12.6, H, H + 5.0, 64, "alu", gap=(math.radians(50), math.radians(130)))
    else:
        cyl_wall(g, ut, 0.5, 12.6, H, H + 5.0, 12, "alu")
    cyl_wall(g, ut, 0.5, 7.6, H, H + 1.2, segs, "alu")
    dome(g, ut, 0.5, H + 1.2, 7.6, segs, 8 if detail else 3, "metal")
    # the observatory: a lower ring and a dome with its slit
    uo = ROOF["observatory"]
    if detail:
        ring_wall(g, uo, -0.3, 8.0, 8.6, H, H + 3.0, 48, "alu", gap=(math.radians(-40), math.radians(40)))
    cyl_wall(g, uo, -0.3, 4.9, H, H + 2.4, segs, "alu")
    dome(g, uo, -0.3, H + 2.4, 4.9, segs, 7 if detail else 3, "metal")
    if detail:
        sl = Geo()
        for k in range(6):
            a0, a1 = math.radians(k * 14), math.radians((k + 1) * 14)
            pa = Vector((0, -4.93 * math.cos(a0), H + 2.4 + 4.93 * math.sin(a0)))
            pb = Vector((0, -4.93 * math.cos(a1), H + 2.4 + 4.93 * math.sin(a1)))
            sl.polyn([pa + Vector((-0.6, 0, 0)), pa + Vector((0.6, 0, 0)), pb + Vector((0.6, 0, 0)), pb + Vector((-0.6, 0, 0))], "dark",
                     (0, -math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)))
        g.add(sl, T(uo, -0.3, 0))


def b_far(g):
    g.polyn([(-L2, -W2, 0), (L2, -W2, 0), (L2, -W2, H), (-L2, -W2, H)], "panel", (0, -1, 0),
            uvs=[(0, 0), (2 * L2 / 6.0, 0), (2 * L2 / 6.0, H / 5.2), (0, H / 5.2)])
    n, m = 12, 4
    for su in (-1, 1):
        u = su * L2
        pts = [Vector((u, -W2, 0))] + [S(u, j / m) for j in range(m + 1)] + [Vector((u, -W2, H))]
        g.polyn(pts, "panel", (su, 0, 0), uvs=[((p.y + W2) / 6.0, p.z / 5.2) for p in pts])
    for i in range(n):
        ua, ub = -L2 + 2 * L2 * i / n, -L2 + 2 * L2 * (i + 1) / n
        g.polyn([(ua, -W2, H), (ub, -W2, H), (ub, W2 - D(ub), H), (ua, W2 - D(ua), H)], "roof", (0, 0, 1))
        for j in range(m):
            c = [S(ua, j / m), S(ub, j / m), S(ub, (j + 1) / m), S(ua, (j + 1) / m)]
            g.polyn(c, "glass", tuple(N((ua + ub) / 2, (j + 0.5) / m)), uvs=[(p.x + L2, arc(p.x, t)) for p, t in zip(c, (j / m, j / m, (j + 1) / m, (j + 1) / m))])
    b_roof(g, detail=False)


# --- build ------------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    M = make_materials()
    main = collection("北京天文馆")
    det = collection("馆", main)

    ga = Geo()
    a_hall(ga)
    gb = Geo()
    b_curtain(gb)
    b_block(gb)
    b_roof(gb)
    g = Geo()
    g.add(ga, MA)
    g.add(gb, MB)
    TILE_ALL = dict(TILE)
    g.build("Planetarium", det, M, TILE_ALL)
    tris = g.tris()

    font = bpy.data.fonts.load(FONT)
    letters = collection("字", main)
    tris += sign(font, "北京天文馆", 1.25, MA @ facing((0.0, CY1 + 0.37, 12.6 + 1.1), (0, 1)), "NameA", letters, M["letters"])

    far = Geo()
    fa, fb = Geo(), Geo()
    a_far(fa)
    b_far(fb)
    far.add(fa, MA)
    far.add(fb, MB)
    far.build("Massing", collection("LOD1", main), M, TILE_ALL)

    # colliders
    helpers = collection("碰撞体")

    def hull(name, pts, m, role="COL"):
        collider_pts(helpers, name, [m @ Vector(p) for p in pts], role=role)

    def boxpts(x0, x1, y0, y1, z0, z1):
        return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    hull("a_plinth", boxpts(-WX - 0.6, WX + 0.6, WY0 - 0.6, WY1 + 0.6, 0, PL), MA)
    hull("a_plinth2", boxpts(-CX - 0.6, CX + 0.6, WY1 + 0.6, CY1 + 0.6, 0, PL), MA)
    hull("a_wings", boxpts(-WX, WX, WY0, WY1, PL, WH + 1.5), MA)
    hull("a_centre", boxpts(-CX, CX, WY1, CY1 - LOG, PL, CH), MA)
    for x in PILLARS:
        hull(f"a_pillar{x:.0f}", boxpts(x - 0.65, x + 0.65, CY1 - 1.3, CY1, PL, 12.6), MA)
    for sx in (-1, 1):
        hull(f"a_return{sx}", boxpts(min(sx * CX, sx * (CX - 1.2)), max(sx * CX, sx * (CX - 1.2)), CY1 - LOG, CY1, PL, 12.6), MA)
    ring = [(DR * math.cos(2 * math.pi * k / 16), DR * math.sin(2 * math.pi * k / 16), z) for k in range(16) for z in (0.0, DH + 0.6)]
    hull("a_drum", ring, MA)
    hull("a_dome", [(DOME_R * math.cos(2 * math.pi * k / 16), DOME_R * math.sin(2 * math.pi * k / 16), DOME_Z + 0.6) for k in range(16)]
         + [(0, 0, DOME_Z + 0.6 + DOME_R)], MA)
    hull("a_steps", [(-10.5, CY1 + 0.6 + STEPS, 0.0), (10.5, CY1 + 0.6 + STEPS, 0.0), (-10.5, CY1 + 0.6, 0.0), (10.5, CY1 + 0.6, 0.0),
                     (-10.5, CY1 + 0.6, PL), (10.5, CY1 + 0.6, PL)], MA, role="WALK")
    body = [(-L2, -W2, 0), (L2, -W2, 0), (-L2, -W2, H), (L2, -W2, H)]
    for i in range(0, NU + 1, 6):
        for j in range(0, NT + 1, 2):
            p = S(U(i), j / NT)
            body.append((p.x, p.y, p.z))
    hull("b_body", body, MB)
    hull("b_plinth", boxpts(-L2 - 0.15, L2 + 0.15, -W2 - 0.15, -W2, 0, 0.6), MB)

    # footprints: A馆 (the model and OSM's outline), B馆 (OSM's rectangle)
    pa = [MA @ Vector(p) for p in [(-WX - 0.8, WY0 - 0.8, 0), (WX + 0.8, WY0 - 0.8, 0), (WX + 0.8, WY1 + 0.8, 0), (CX + 0.8, CY1 + 0.8 + STEPS, 0),
                                   (-CX - 0.8, CY1 + 0.8 + STEPS, 0), (-WX - 0.8, WY1 + 0.8, 0)]]
    pa += [MA @ Vector((DR * math.cos(a), DR * math.sin(a), 0)) for a in np.linspace(math.pi, 2 * math.pi, 9)]
    pa += [Vector((*G(-5694 + x, -2989 + z), 0)) for x, z in A_OSM]
    flat_marker(helpers, "a_foot", hull2d([(p.x, p.y) for p in pa]), "FOOTPRINT")
    fb_ = [MB @ Vector((x, y, 0)) for x, y in ((-L2 - 0.6, -W2 - 0.6), (L2 + 0.6, -W2 - 0.6), (L2 + 0.6, W2 + 0.6), (-L2 - 0.6, W2 + 0.6))]
    flat_marker(helpers, "b_foot", [(p.x, p.y) for p in fb_], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "planetarium", "北京天文馆", "Beijing Planetarium"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, far=far.tris())


def hull2d(pts):
    pts = sorted(set((round(x, 3), round(y, 3)) for x, y in pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
