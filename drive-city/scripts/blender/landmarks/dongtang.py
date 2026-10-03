# 王府井天主堂 St Joseph's Church (东堂) on 王府井大街, built in Blender, marked with the bcity_landmark add-on's
# conventions. OSM has its outline (way 85902975, building=church) and the city drew it as an 11 m block.
#
#   blender -b -P scripts/blender/landmarks/dongtang.py -- [--out art/landmarks/dongtang.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground on the church's axis at game (715.0, -792.3),
# heading -1.2 (the outline's long walls). The church faces west onto its forecourt and 王府井大街: OSM's outline
# squared - the nave and aisles x -31.8..15 (21.1 m wide), the narrower chancel to x 28.6 and the apse to 32.6.
# The 1904 Romanesque church in grey brick with white stone trim: on the west front three towers with round domes
# (the middle one tallest, ~28 m to the cross), round-arched portals and windows, cornices; nine bays of tall
# round-arched windows between pilasters down each side under a grey gable roof; the forecourt paved with two lawns.
# Heights are estimates from photographs (no published figures): eaves 10 m, ridge 16.5 m, side towers 22 m and the
# middle one 28.5 m to the crosses.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, collider_pts, flat_marker, lathe, paving  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "dongtang.blend")

ORIGIN, HEADING = (715.0, -792.3), -1.2
W0, W1 = -31.8, 15.0          # the nave block: west front to the chancel
HW = 10.55                    # half width of nave and aisles
C1, CW = 28.6, 6.5            # the chancel's east end and half width
APSE = 4.0                    # the apse's depth past the chancel
EAVE, RIDGE = 10.0, 16.5      # nave eaves and ridge
CEAVE, CRIDGE = 8.5, 12.6     # chancel
FD = 4.6                      # depth of the west front (towers)
ST = (6.6, HW)                # side towers' y range (mirrored)
CT = 3.7                      # half width of the middle tower
BAYS = 9


def brick_image(size=512):
    """Grey brick in running bond (2 m a repeat), slightly mottled."""
    cv = Canvas(size, size, "#80817c")
    rng = np.random.default_rng(7)
    bw, bh = size / 8.0, size / 32.0
    row = (cv.y // bh).astype(int)
    col = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.86, 1.1, (40, 12))[row % 40, col % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.5) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.5), "#a3a39d")
    cv.noise(0.1, 3)
    return image("DT_Brick", np.flipud(cv.a).copy())


def roof_image(size=256):
    """Grey roof tiles: rows down the slope (1 m a repeat)."""
    cv = Canvas(size, size, "#56595b")
    ph = (cv.x / size * 5) % 1.0
    cv.a *= (0.8 + 0.25 * np.sin(np.pi * ph))[..., None]
    cv.put(np.mod(cv.y, size / 4) < 2.5, "#3d4042")
    cv.noise(0.08, 9)
    return image("DT_RoofTex", np.flipud(cv.a).copy())


def materials():
    return dict(
        brick=material("DT_Brick", "#80817c", 0.88, tex=brick_image(), props={"wet": "damp", "glowStrength": 0.55}),
        trim=material("DT_Trim", "#e2ded3", 0.6, props={"wet": "damp", "glowStrength": 0.6}),
        roof=material("DT_Roof", "#56595b", 0.6, tex=roof_image(), props={"wet": "surface", "glowStrength": 0.4}),
        dome=material("DT_Dome", "#4f5658", 0.45, metal=0.4, props={"wet": "surface", "glowStrength": 0.5}),
        glass=material("DT_Glass", "#27323b", 0.25, metal=0.2, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.78, 0.45], "glowStrength": 0.35}),
        door=material("DT_Door", "#5a2b1c", 0.5, props={"wet": "damp", "glow": "none"}),
        gold=material("DT_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.4}),
        paving=material("DT_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5, "layer": 10}),
        lawn=material("DT_Lawn", "#5f7d3c", 0.95, props={"wet": "damp", "glow": "none", "layer": 10}),
        stone=material("DT_Stone", "#b9b4a8", 0.7, props={"wet": "damp", "glowStrength": 0.5}),
    )


TILE = dict(brick=2.0, trim=2.0, roof=1.0, dome=2.0, glass=2.0, door=2.0, gold=1.0, paving=4.0, lawn=4.0, stone=2.0)


def local(gx, gz):
    """Game metres -> this frame."""
    t = math.radians(-HEADING)
    dx, dz = gx - ORIGIN[0], gz - ORIGIN[1]
    return (dx * math.cos(t) - dz * math.sin(t), -(dx * math.sin(t) + dz * math.cos(t)))


# ---- small pieces on a wall ---------------------------------------------------------------------------------------
# A wall plane is given by a point, its along-direction `u` and its outward normal `n` (both unit, horizontal).

def arch_pts(w, h, segs=8):
    """A round-headed opening `w` wide whose springing is at h - w/2 and crown at h, as (s, z) from its foot."""
    r = w / 2
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(segs + 1):
        a = math.pi * i / segs
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def opening(g, o, u, n, s, z, w, h, key="glass", frame=0.22, depth=0.0):
    """A round-arched window or door at along-position s and sill z: the dark pane set back `depth`, its reveal and a
    white stone surround standing proud."""
    o, u, n = Vector(o), Vector(u), Vector(n)
    up = Vector((0, 0, 1))
    P = lambda a, b, d=0.0: o + u * (s + a) + up * (z + b) + n * d      # noqa: E731
    r = w / 2
    segs = 8
    ring = [(-r, 0.0)] + [(r * math.cos(math.pi - math.pi * i / segs), h - r + r * math.sin(math.pi - math.pi * i / segs)) for i in range(segs + 1)] + [(r, 0.0)]
    # the pane, just proud of the wall (the wall is not cut; a recessed pane would be hidden behind it)
    g.polyn([P(a, b, 0.02) for a, b in ring], key, tuple(n))
    # the surround: an arch band and the jambs, 4 cm proud
    R = r + frame
    for i in range(segs):
        a0, a1 = math.pi * i / segs, math.pi * (i + 1) / segs
        q = [(r * math.cos(a0), h - r + r * math.sin(a0)), (R * math.cos(a0), h - r + R * math.sin(a0)),
             (R * math.cos(a1), h - r + R * math.sin(a1)), (r * math.cos(a1), h - r + r * math.sin(a1))]
        g.polyn([P(a, b, 0.05) for a, b in q], "trim", tuple(n))
    for sx in (-1, 1):
        g.polyn([P(sx * r, -0.05, 0.05), P(sx * R, -0.05, 0.05), P(sx * R, h - r, 0.05), P(sx * r, h - r, 0.05)], "trim", tuple(n))
    g.polyn([P(-R - 0.1, -0.25, 0.08), P(R + 0.1, -0.25, 0.08), P(R + 0.1, 0.0, 0.08), P(-R - 0.1, 0.0, 0.08)], "trim", tuple(n))
    g.polyn([P(-R - 0.1, 0.0, 0.0), P(R + 0.1, 0.0, 0.0), P(R + 0.1, 0.0, 0.08), P(-R - 0.1, 0.0, 0.08)], "trim", (0, 0, 1))


def strip(g, o, u, n, s0, s1, z0, z1, proud, key="trim"):
    """A flat band on a wall (pilaster, string course), standing `proud` with its sides and top."""
    o, u, n = Vector(o), Vector(u), Vector(n)
    up = Vector((0, 0, 1))
    P = lambda s, z, d: o + u * s + up * z + n * d      # noqa: E731
    g.polyn([P(s0, z0, proud), P(s1, z0, proud), P(s1, z1, proud), P(s0, z1, proud)], key, tuple(n))
    g.polyn([P(s0, z1, 0), P(s1, z1, 0), P(s1, z1, proud), P(s0, z1, proud)], key, (0, 0, 1))
    g.polyn([P(s0, z0, 0), P(s0, z0, proud), P(s0, z1, proud), P(s0, z1, 0)], key, tuple(-u))
    g.polyn([P(s1, z0, proud), P(s1, z0, 0), P(s1, z1, 0), P(s1, z1, proud)], key, tuple(u))


def walls(g, x0, x1, y0, y1, z0, z1, key="brick", faces="wesn"):
    if "s" in faces:
        g.polyn([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], key, (0, -1, 0))
    if "n" in faces:
        g.polyn([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], key, (0, 1, 0))
    if "w" in faces:
        g.polyn([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], key, (-1, 0, 0))
    if "e" in faces:
        g.polyn([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], key, (1, 0, 0))


def cornice(g, x0, x1, y0, y1, z, faces="wesn", out=0.35, h=0.45):
    """A white cornice band round (part of) a block's top edge."""
    e = out
    for f in faces:
        if f == "s":
            g.box(x0 - e, x1 + e, y0 - e, y0, z - h, z, "trim", skip=("+y",))
        elif f == "n":
            g.box(x0 - e, x1 + e, y1, y1 + e, z - h, z, "trim", skip=("-y",))
        elif f == "w":
            g.box(x0 - e, x0, y0, y1, z - h, z, "trim", skip=("+x",))
        elif f == "e":
            g.box(x1, x1 + e, y0, y1, z - h, z, "trim", skip=("-x",))


def gable_roof(g, x0, x1, hw, eave, ridge, over=0.5, ends="e", key="roof", gable_key="brick"):
    """A gable roof along x over y +-hw: two slopes running `over` past the walls, gable walls at the named ends."""
    Y = hw + over
    ze = eave - over * (ridge - eave) / hw
    for s in (-1, 1):
        g.polyn([(x0, s * Y, ze), (x1, s * Y, ze), (x1, 0, ridge), (x0, 0, ridge)], key, (0, s, 1),
                uvs=[(x0, 0), (x1, 0), (x1, Y), (x0, Y)])
        g.polyn([(x0, s * Y, ze), (x1, s * Y, ze), (x1, s * Y, ze - 0.25), (x0, s * Y, ze - 0.25)], "trim", (0, s, 0))
        g.polyn([(x0, s * Y, ze - 0.25), (x1, s * Y, ze - 0.25), (x1, s * hw, eave - 0.25), (x0, s * hw, eave - 0.25)], "trim", (0, 0, -1))
    for e in ends:
        x, sx = (x1, 1) if e == "e" else (x0, -1)
        xw = x - sx * over
        g.polyn([(xw, -hw, eave), (xw, hw, eave), (xw, 0, ridge)], gable_key, (sx, 0, 0))
        g.polyn([(x, -Y, ze), (x, -Y, ze - 0.2), (x, 0, ridge - 0.2), (x, 0, ridge)], "trim", (sx, 0, 0))
        g.polyn([(x, Y, ze - 0.2), (x, Y, ze), (x, 0, ridge), (x, 0, ridge - 0.2)], "trim", (sx, 0, 0))
    g.box(x0, x1, -0.15, 0.15, ridge - 0.1, ridge + 0.12, "roof")


def dome(g, cx, cy, z, r, segs=16, key="dome", lantern=True):
    """A drum's round dome from z: a ribbed hemisphere with a small lantern and the cross; returns the top."""
    prof = [(r + 0.15, z), (r + 0.15, z + 0.25), (r, z + 0.25)]
    for i in range(1, 7):
        a = math.pi / 2 * i / 6
        prof.append((r * math.cos(a) * 1.0, z + 0.25 + r * 1.05 * math.sin(a)))
    lathe(g, prof[:-1] + [(0.0, prof[-1][1])], segs, key, x=cx, y=cy)
    top = z + 0.25 + r * 1.05
    if lantern:
        lr = max(0.25, r * 0.22)
        lathe(g, [(lr, top - 0.1), (lr, top + 0.7), (lr + 0.12, top + 0.75), (0.0, top + 1.1)], 8, key, x=cx, y=cy)
        top += 1.1
    # the cross
    g.box(cx - 0.06, cx + 0.06, cy - 0.06, cy + 0.06, top, top + 1.6, "gold")
    g.box(cx - 0.06, cx + 0.06, cy - 0.45, cy + 0.45, top + 0.95, top + 1.1, "gold")
    return top + 1.6


def drum(g, cx, cy, z0, z1, r, n=8, windows=True):
    """An octagonal drum with an arched opening on each face."""
    pts = [(cx + r * math.cos(2 * math.pi * (k + 0.5) / n), cy + r * math.sin(2 * math.pi * (k + 0.5) / n)) for k in range(n)]
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        mid = ((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy)
        g.polyn([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], "brick", (mid[0], mid[1], 0))
        if windows:
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L, 0)
            nn = Vector((mid[0], mid[1], 0)).normalized()
            opening(g, (a[0], a[1], 0), u, tuple(nn), L / 2, z0 + 0.5, min(0.9, L * 0.45), (z1 - z0) - 1.0, frame=0.12, depth=0.15)
    g.polyn([(x, y, z1) for x, y in pts], "trim", (0, 0, 1))
    # a white band at the top
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        o = 1.06
        A = (cx + (a[0] - cx) * o, cy + (a[1] - cy) * o)
        B = (cx + (b[0] - cx) * o, cy + (b[1] - cy) * o)
        mid = ((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy)
        g.polyn([(A[0], A[1], z1 - 0.35), (B[0], B[1], z1 - 0.35), (B[0], B[1], z1), (A[0], A[1], z1)], "trim", (mid[0], mid[1], 0))


def tower(g, x0, x1, y0, y1, h, dome_r, drum_h, faces):
    """A square tower body from the ground to h with white quoins and a cornice, an octagonal drum and the dome."""
    walls(g, x0, x1, y0, y1, 0.0, h, faces=faces)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for (x, y) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        g.box(x - 0.18, x + 0.18, y - 0.18, y + 0.18, 0.0, h, "trim", skip=("-z",))
    cornice(g, x0, x1, y0, y1, h, faces="wesn", out=0.3, h=0.5)
    g.polyn([(x0 - 0.3, y0 - 0.3, h), (x1 + 0.3, y0 - 0.3, h), (x1 + 0.3, y1 + 0.3, h), (x0 - 0.3, y1 + 0.3, h)], "trim", (0, 0, 1))
    dr = min(x1 - x0, y1 - y0) / 2 * 0.86
    drum(g, cx, cy, h, h + drum_h, dr)
    return dome(g, cx, cy, h + drum_h, dome_r)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("东堂")
    g = Geo()
    F = W0 + FD                 # the back of the west front; the nave runs on from here

    # ---- the nave and aisles: walls, pilasters, windows, cornice, the gable roof -----------------------------------
    walls(g, F, W1, -HW, HW, 0.0, EAVE, faces="sn")
    g.box(F, W1, -HW - 0.12, HW + 0.12, 0.0, 0.9, "stone", skip=("-z", "+z", "-x", "+x"))       # the plinth
    bay = (W1 - F) / BAYS
    for s in (-1, 1):
        o, u, n = (F, s * HW, 0.0), (1, 0, 0), (0, s, 0)
        for i in range(BAYS + 1):
            strip(g, o, u, n, i * bay - 0.35, i * bay + 0.35, 0.0, EAVE - 0.4, 0.25, key="trim" if i in (0, BAYS) else "brick")
        for i in range(BAYS):
            opening(g, o, u, n, (i + 0.5) * bay, 3.0, 1.7, 5.4)
            opening(g, o, u, n, (i + 0.5) * bay, 1.1, 1.0, 1.3, frame=0.12, depth=0.15)
        strip(g, o, u, n, 0.0, W1 - F, EAVE - 0.9, EAVE - 0.55, 0.12)
    cornice(g, F, W1, -HW, HW, EAVE, faces="sn")
    gable_roof(g, F, W1 + 0.5, HW, EAVE, RIDGE, ends="e")

    # ---- the chancel and apse --------------------------------------------------------------------------------------
    walls(g, W1, C1, -CW, CW, 0.0, CEAVE, faces="sn")
    walls(g, W1 - 0.1, W1 + 0.01, CW, HW, 0.0, EAVE, faces="e")
    walls(g, W1 - 0.1, W1 + 0.01, -HW, -CW, 0.0, EAVE, faces="e")
    for s in (-1, 1):
        o, u, n = (W1, s * CW, 0.0), (1, 0, 0), (0, s, 0)
        for i in range(3):
            opening(g, o, u, n, (i + 0.5) * (C1 - W1) / 3, 2.6, 1.4, 4.4)
    cornice(g, W1, C1, -CW, CW, CEAVE, faces="sn", out=0.3, h=0.4)
    gable_roof(g, W1, C1, CW, CEAVE, CRIDGE, over=0.4, ends="")
    # the apse: half an octagon against the chancel's east wall, a hipped half cone over it
    ap = [(C1, -CW)] + [(C1 + APSE * math.sin(math.pi * k / 4) * 0.95, -CW * math.cos(math.pi * k / 4)) for k in range(1, 4)] + [(C1, CW)]
    for a, b in zip(ap, ap[1:]):
        mid = ((a[0] + b[0]) / 2 - C1, (a[1] + b[1]) / 2)
        g.polyn([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], CEAVE), (a[0], a[1], CEAVE)], "brick", (mid[0], mid[1], 0))
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if 0.2 < abs(mid[1]) / max(1e-6, math.hypot(*mid)) < 0.99 or abs(mid[1]) < 0.5:
            nn = Vector((mid[0], mid[1], 0)).normalized()
            opening(g, (a[0], a[1], 0.0), ((b[0] - a[0]) / L, (b[1] - a[1]) / L, 0), tuple(nn), L / 2, 2.6, 1.2, 4.0, frame=0.15)
    apex = (C1, 0.0, CRIDGE)
    for a, b in zip(ap, ap[1:]):
        mid = ((a[0] + b[0]) / 2 - C1, (a[1] + b[1]) / 2)
        A = (C1 + (a[0] - C1) * 1.08, a[1] * 1.06, CEAVE - 0.2)
        B = (C1 + (b[0] - C1) * 1.08, b[1] * 1.06, CEAVE - 0.2)
        g.polyn([A, B, apex], "roof", (mid[0], mid[1], 1.2))
    g.polyn([(C1, CW + 0.4, CEAVE - 0.2), (C1, -CW - 0.4, CEAVE - 0.2), apex], "roof", (-1, 0, 0.2))

    # ---- the west front: three towers, the screen between them, portals and windows ----------------------------------
    x0, x1 = W0, F
    # side towers
    tops = []
    for s in (-1, 1):
        y0, y1 = sorted((s * ST[0], s * ST[1]))
        tops.append(tower(g, x0, x1, y0, y1, 16.4, 1.75, 2.4, faces="wesn"))
        # west face of the tower: a portal, a window, a small round-headed belfry window
        ow = (x0, y0, 0.0)
        opening(g, ow, (0, 1, 0), (-1, 0, 0), (y1 - y0) / 2, 0.45, 1.9, 4.2, key="door")
        opening(g, ow, (0, 1, 0), (-1, 0, 0), (y1 - y0) / 2, 7.0, 1.3, 3.0)
        opening(g, ow, (0, 1, 0), (-1, 0, 0), (y1 - y0) / 2, 12.0, 1.2, 2.8)
        strip(g, ow, (0, 1, 0), (-1, 0, 0), -0.2, (y1 - y0) + 0.2, 10.4, 10.8, 0.2)
        # the outer side faces (north and south): two windows each
        oside = (x0, s * HW, 0.0)
        opening(g, oside, (1, 0, 0), (0, s, 0), FD / 2, 7.0, 1.2, 3.0)
        opening(g, oside, (1, 0, 0), (0, s, 0), FD / 2, 12.0, 1.1, 2.6)
    # the screen between the towers: rises to a cornice at 12 m, a small gable over it each side of the middle tower
    for s in (-1, 1):
        y0, y1 = sorted((s * CT, s * ST[0]))
        walls(g, x0, x1, y0, y1, 0.0, 12.0, faces="w")
        g.polyn([(x0, y0, 12.0), (x0, y1, 12.0), (x1, y1, 12.0), (x1, y0, 12.0)], "trim", (0, 0, 1))
        cornice(g, x0, x1, y0, y1, 12.0, faces="w", out=0.3, h=0.45)
        ow = (x0, y0, 0.0)
        opening(g, ow, (0, 1, 0), (-1, 0, 0), (y1 - y0) / 2, 4.2, 1.4, 3.6)
        opening(g, ow, (0, 1, 0), (-1, 0, 0), (y1 - y0) / 2, 8.6, 1.0, 2.2)
    # the middle tower: the main portal, a rose, the belfry stage, the drum and the tallest dome
    hc = 21.0
    walls(g, x0, x1, -CT, CT, 0.0, hc, faces="w")
    walls(g, x0, x1, -CT, CT, 12.0, hc, faces="sne")
    for (x, y) in ((x0, -CT), (x0, CT), (x1, -CT), (x1, CT)):
        g.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, 0.0 if x == x0 else 12.0, hc, "trim", skip=("-z",))
    ow = (x0, -CT, 0.0)
    opening(g, ow, (0, 1, 0), (-1, 0, 0), CT, 0.45, 3.2, 6.6, key="door", frame=0.35)
    strip(g, ow, (0, 1, 0), (-1, 0, 0), -0.2, 2 * CT + 0.2, 7.6, 8.0, 0.25)
    strip(g, ow, (0, 1, 0), (-1, 0, 0), -0.2, 2 * CT + 0.2, 15.6, 16.0, 0.25)
    # the rose window: a dark disc in a white ring, with its tracery spokes
    rz, rr = 11.8, 1.6
    ring = [(x0 - 0.05, rr * math.cos(2 * math.pi * k / 16), rz + rr * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    ring2 = [(x0 - 0.08, (rr + 0.35) * math.cos(2 * math.pi * k / 16), rz + (rr + 0.35) * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    g.polyn(ring, "glass", (-1, 0, 0))
    for k in range(16):
        j = (k + 1) % 16
        g.polyn([ring[k], ring[j], ring2[j], ring2[k]], "trim", (-1, 0, 0))
    for k in range(4):
        a = math.pi * k / 4
        c, s_ = math.cos(a), math.sin(a)
        g.polyn([(x0 - 0.1, -rr * c - 0.06 * s_, rz - rr * s_ + 0.06 * c), (x0 - 0.1, rr * c - 0.06 * s_, rz + rr * s_ + 0.06 * c),
                 (x0 - 0.1, rr * c + 0.06 * s_, rz + rr * s_ - 0.06 * c), (x0 - 0.1, -rr * c + 0.06 * s_, rz - rr * s_ - 0.06 * c)], "trim", (-1, 0, 0))
    # belfry: arched openings on the free faces
    for face in ("w", "s", "n"):
        if face == "w":
            opening(g, (x0, -CT, 0.0), (0, 1, 0), (-1, 0, 0), CT - 1.3, 16.7, 1.2, 3.4)
            opening(g, (x0, -CT, 0.0), (0, 1, 0), (-1, 0, 0), CT + 1.3, 16.7, 1.2, 3.4)
        else:
            s = -1 if face == "s" else 1
            opening(g, (x0, s * CT, 0.0), (1, 0, 0), (0, s, 0), FD / 2, 16.7, 1.3, 3.4)
    cornice(g, x0, x1, -CT, CT, hc, faces="wsne", out=0.35, h=0.55)
    g.polyn([(x0 - 0.35, -CT - 0.35, hc), (x1 + 0.35, -CT - 0.35, hc), (x1 + 0.35, CT + 0.35, hc), (x0 - 0.35, CT + 0.35, hc)], "trim", (0, 0, 1))
    cx = (x0 + x1) / 2
    drum(g, cx, 0.0, hc, hc + 2.8, 2.05)
    tops.append(dome(g, cx, 0.0, hc + 2.8, 2.15, segs=20))
    # the towers' and screen's back faces above the nave roof
    walls(g, x0, x1, -HW, HW, EAVE, 12.0, faces="e")
    # the steps up to the portals: a landing 0.45 m up along the front
    g.box(W0 - 2.6, W0, -HW + 0.4, HW - 0.4, 0.0, 0.45, "stone", skip=("-z",))
    for k in range(3):
        g.box(W0 - 2.6 - (3 - k) * 0.35, W0 - 2.6, -HW + 0.4 - (3 - k) * 0.1, HW - 0.4 + (3 - k) * 0.1, 0.0, 0.15 * (k + 1) - 0.0, "stone", skip=("-z",))
    tris_church = g.tris()

    # ---- the forecourt: paving to the street, two lawns with a low kerb, a paved walk to the door ---------------------
    fx0 = local(638.5, -792.3)[0]
    g.polyn([(fx0, -24.0, 0.04), (W0, -24.0, 0.04), (W0, 22.0, 0.04), (fx0, 22.0, 0.04)], "paving", (0, 0, 1))
    for y0, y1 in ((-20.0, -5.5), (5.5, 18.0)):
        lx0, lx1 = fx0 + 9.0, W0 - 5.0
        g.box(lx0, lx1, y0, y1, 0.0, 0.18, "stone", skip=("-z", "+z"))
        g.polyn([(lx0, y0, 0.18), (lx1, y0, 0.18), (lx1, y1, 0.18), (lx0, y1, 0.18)], "lawn", (0, 0, 1))
    g.build("Church", collection("教堂", main), M, TILE)

    # ---- far level ------------------------------------------------------------------------------------------------------
    far = Geo()
    walls(far, F, W1, -HW, HW, 0.0, EAVE, faces="sn")
    far.polyn([(F, -HW - 0.5, EAVE - 0.3), (W1, -HW - 0.5, EAVE - 0.3), (W1, 0, RIDGE), (F, 0, RIDGE)], "roof", (0, -1, 1))
    far.polyn([(F, HW + 0.5, EAVE - 0.3), (W1, HW + 0.5, EAVE - 0.3), (W1, 0, RIDGE), (F, 0, RIDGE)], "roof", (0, 1, 1))
    far.polyn([(W1, -HW, EAVE), (W1, HW, EAVE), (W1, 0, RIDGE)], "brick", (1, 0, 0))
    walls(far, W1, C1 + APSE, -CW, CW, 0.0, CEAVE, faces="sne")
    far.polyn([(W1, -CW - 0.4, CEAVE - 0.2), (C1 + APSE, -CW - 0.4, CEAVE - 0.2), (C1 + APSE, 0, CRIDGE), (W1, 0, CRIDGE)], "roof", (0, -1, 1))
    far.polyn([(W1, CW + 0.4, CEAVE - 0.2), (C1 + APSE, CW + 0.4, CEAVE - 0.2), (C1 + APSE, 0, CRIDGE), (W1, 0, CRIDGE)], "roof", (0, 1, 1))
    for s in (-1, 1):
        y0, y1 = sorted((s * ST[0], s * ST[1]))
        far.box(x0, x1, y0, y1, 0.0, 18.8, "brick", skip=("-z",))
        lathe(far, [(1.8, 18.8), (1.5, 19.9), (0.8, 20.6), (0.0, 21.0)], 8, "dome", x=x0 + FD / 2, y=(y0 + y1) / 2)
        y0, y1 = sorted((s * CT, s * ST[0]))
        far.box(x0, x1, y0, y1, 0.0, 12.0, "brick", skip=("-z",))
    far.box(x0, x1, -CT, CT, 0.0, hc + 2.8, "brick", skip=("-z",))
    lathe(far, [(2.2, hc + 2.8), (1.9, hc + 4.0), (1.0, hc + 4.8), (0.0, hc + 5.3)], 8, "dome", x=cx, y=0.0)
    far.polyn([(fx0, -24.0, 0.04), (W0, -24.0, 0.04), (W0, 22.0, 0.04), (fx0, 22.0, 0.04)], "paving", (0, 0, 1))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # ---- colliders and markers --------------------------------------------------------------------------------------------
    helpers = collection("碰撞体")
    collider_box(helpers, "nave", W0, W1, -HW - 0.25, HW + 0.25, 0.0, RIDGE)
    collider_box(helpers, "chancel", W1, C1 + APSE, -CW - 0.2, CW + 0.2, 0.0, CRIDGE)
    collider_box(helpers, "landing", W0 - 2.6, W0, -HW + 0.4, HW - 0.4, 0.0, 0.45)
    xa = W0 - 2.6 - 1.05
    collider_pts(helpers, "steps", [(xa, -HW + 0.1, 0.0), (xa, HW - 0.1, 0.0), (W0 - 2.6, -HW + 0.1, 0.0), (W0 - 2.6, HW - 0.1, 0.0),
                                    (W0 - 2.6, -HW + 0.1, 0.45), (W0 - 2.6, HW - 0.1, 0.45)], role="WALK")
    for y0, y1 in ((-20.0, -5.5), (5.5, 18.0)):
        collider_box(helpers, "lawn", fx0 + 9.0, W0 - 5.0, y0, y1, 0.0, 0.18)
    flat_marker(helpers, "nave", [(W0 - 0.3, -HW - 0.3), (W1, -HW - 0.3), (W1, HW + 0.3), (W0 - 0.3, HW + 0.3)], "FOOTPRINT")
    flat_marker(helpers, "chancel", [(W1, -CW - 1.6), (C1 + APSE + 0.4, -CW - 1.6), (C1 + APSE + 0.4, CW + 1.6), (W1, CW + 1.6)], "FOOTPRINT")
    # the forecourt: OSM has no building there, the learnt set has three sheds under its trees
    flat_marker(helpers, "forecourt", [(fx0 + 6.0, -24.0), (W0 - 3.0, -24.0), (W0 - 3.0, 20.0), (fx0 + 6.0, 20.0)], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "dongtang", "王府井天主堂", "St. Joseph's Church (Wangfujing)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ORIGIN[0], ORIGIN[1], HEADING
    s.far_distance = 450
    s.repo_path = REPO
    return dict(church=tris_church, tris=g.tris(), far=far.tris(), tops=[round(t, 2) for t in tops])


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
