# 北京工人体育场 Workers' Stadium (1959; demolished and rebuilt 2020-2023 keeping the old form), built in Blender,
# marked with the bcity_landmark add-on's conventions. OSM has the stadium as way 191693413 (leisure=stadium) and
# relation 16751184 (building=stadium, the same ring round the pitch, way 1158727173, as its hole); the city drew it
# as one 35 m block of flats over the whole oval.
#
#   blender -b -P scripts/blender/landmarks/gongti.py -- [--out art/landmarks/gongti.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (3708.5, -2300.0), heading -1.0: the
# centre and axis of the superellipse |x/105|^2.2 + |y/137.5|^2.2 = 1 fitted to OSM's outline (rms 0.7 m) - 210 x
# 275 m, the long axis north-south. The real figures: the new roof canopy spans 205 x 273 m and rises 46 m at most;
# the rebuild raised the cornice so the canopy cannot be seen within 60 m of the stadium (published by the builders);
# the hole in OSM's ring, 79 x 117 m, is the pitch with its margins (no running track since the rebuild).
# What is modelled:
# - the facade: ~180 tall cream stone piers round the whole oval in front of a recessed wall (doors on the ground
#   floor, four storeys of windows above - the facade shader), an entablature, cornice and parapet at 34 m with a
#   ring of flagpoles; four axis gates as taller pylon blocks with 工人体育场 on them and the lobby glass in the
#   opening;
# - inside: the bowl as a lower tier, a band of glazed boxes and an upper tier (seat rows painted), LED boards
#   round the pitch, the pitch with its markings and goals;
# - the canopy: a light membrane on radial ribs from behind the parapet (33.4 m) up to 45.5 m and down to its
#   inner edge (41.6 m) over the front rows, with a lit strip under the inner ring;
# - outside: the paved walk under the colonnade, the 护城河 (the new water ring round the stadium) with copings
#   and eight bridges, the gate posts (大门门柱) at the four axis bridges. The plaza beyond is the city's.
# Doubtful: the piers' count and depth, the storey heights, the seat colours (green), the gates' design and
# where exactly the lettering is; the moat's width (squeezed inside the service road OSM draws ~12 m out).

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_pts, flat_marker, mesh_of, paving, place  # noqa: E402
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "gongti.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = 3708.5, -2300.0, -1.0
A0, B0, NE = 105.0, 137.5, 2.2          # the facade line (pier faces): superellipse semi-axes and exponent
AI, BI, NI = 40.0, 59.0, 6.0            # the bowl's front edge round the pitch (a rounded rectangle)
N = 192                                 # samples round the oval
BAY_T = 4.3                             # pier spacing target (metres along the facade line)
WALL = -1.2                             # the recessed wall behind the piers
Z_BASE, Z_ENT, Z_PAR = 6.5, 28.0, 34.0  # top of the door storey, of the piers, of the parapet
DECK = 32.6                             # the roof deck behind the parapet, where the upper tier ends
BACK = 8.0                              # the bowl's back edge: 8 m inside the facade line
GATE_HW, GATE_OUT, GATE_IN, GATE_H = 13.0, 2.5, -7.0, 37.0
OPEN_HW, OPEN_H = 6.0, 10.0             # the gate opening
MOAT = (4.5, 5.0, 7.5, 8.0, 9.2)        # walk to; inner coping to; water to; outer coping to; outer paving to
COPE_H = 0.5
BRIDGES = [(0.0, 8.0), (90.0, 8.0), (180.0, 8.0), (270.0, 8.0)] + [(a, 4.5) for a in (52.6, 127.4, 232.6, 307.4)]
TH = [2 * math.pi * k / N for k in range(N)]
# the north forecourt between the ring road and 工体北路 (game x0, x1, z0, z1): three small machine-learnt blocks
# (pre-rebuild imagery) stood on the axis right in front of the north gate
FORECOURT = (3680.0, 3718.0, -2510.0, -2476.0)

_R = -HEADING * math.pi / 180
_C, _S = math.cos(_R), math.sin(_R)


def to_local(gx, gz):
    """Game (x, z) to the model's (X east, Y north), the inverse of city/index.ts toWorld."""
    dx, dz = gx - GX, gz - GZ
    return (dx * _C - dz * _S, -(dx * _S + dz * _C))


def rpol(a, b, n, th):
    return ((abs(math.cos(th)) / a) ** n + (abs(math.sin(th)) / b) ** n) ** (-1.0 / n)


def F(d, th, n=NE):
    """The facade line pushed out by d (in for d < 0), at polar angle th."""
    r = rpol(A0 + d, B0 + d, n, th)
    return (r * math.cos(th), r * math.sin(th))


def S(s, th):
    """The bowl: s = 0 its front edge round the pitch, 1 its back edge (BACK in from the facade); past 1 on out
    to the facade line at s = 1.25."""
    if s > 1.0:
        return F(-BACK + (s - 1.0) / 0.25 * BACK, th)
    a = AI + (A0 - BACK - AI) * s
    b = BI + (B0 - BACK - BI) * s
    n = NI + (NE - NI) * s
    r = rpol(a, b, n, th)
    return (r * math.cos(th), r * math.sin(th))


def arc(ths, d=0.0):
    """Cumulative arc length of the facade line at the given angles (closed: one more value at the end)."""
    pts = [F(d, t) for t in ths]
    u = [0.0]
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        u.append(u[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return u


U = arc(TH)
PERIM = U[-1]
NBAY = round(PERIM / BAY_T)
BAY = PERIM / NBAY


# ---- textures ----------------------------------------------------------------------------------------------

def base_images():
    """One bay of the door storey (BAY wide, 6.5 m): cream stone in courses, a glazed door pair and transom
    between the piers; and its night map (the doors lit)."""
    w, h = 128, 192
    ppm_x, ppm_y = w / BAY, h / Z_BASE
    cv = Canvas(w, h, "#ddd2b8")
    cv.noise(0.06, 3)
    z = (h - cv.y) / ppm_y
    cv.a[np.mod(z, 0.55) < 0.035] *= 0.86
    x = cv.x / ppm_x
    cx = BAY / 2
    door = (np.abs(x - cx) < 1.25) & (z < 4.4)
    tran = (np.abs(x - cx) < 1.25) & (z > 4.6) & (z < 5.5)
    surround = (np.abs(x - cx) < 1.55) & (z < 5.8) & ~door & ~tran
    cv.a[surround] = srgb("#c9bd9f")
    cv.a[door | tran] = srgb("#2b3237")
    cv.a[(door | tran) & ((np.abs(x - cx) < 0.05) | (np.abs(np.abs(x - cx) - 1.2) < 0.06))] = srgb("#8c8576")
    cv.a[(np.abs(x - cx) < 1.25) & (z >= 4.4) & (z <= 4.6)] = srgb("#8c8576")
    night = Canvas(w, h, "#000000")
    night.a[door | tran] = srgb("#c99a5c")
    return image("GT_Base", np.flipud(cv.a).copy()), image("GT_BaseNight", np.flipud(night.a).copy())


def seat_image():
    """12 m of stand (one aisle) by four rows of 0.8 m: green seats on light treads, dark risers, the aisle steps."""
    w, h = 256, 128
    cv = Canvas(w, h, "#2f6a4b")
    rng = np.random.default_rng(5)
    cv.a *= rng.uniform(0.9, 1.08, (h // 32 + 1, w // 10 + 1))[(cv.y // 32).astype(int), (cv.x // 10).astype(int)][..., None]
    row = np.mod(cv.y, 32)
    cv.a[row < 9] = srgb("#8a8780")                      # riser
    cv.a[(row >= 9) & (row < 13)] = srgb("#b3afa6")      # tread nosing
    seatgap = (np.mod(cv.x, 10) < 1.5) & (row >= 13)
    cv.a[seatgap] *= 0.72
    aisle = np.abs(cv.x - w / 2) < 13
    cv.a[aisle] = srgb("#a9a59d")
    cv.a[aisle & (row < 4)] = srgb("#77746e")
    return image("GT_Seats", np.flipud(cv.a).copy())


def board_images():
    """The LED boards round the pitch: panels of colour with lettering bars (day and night)."""
    w, h = 512, 32
    cv = Canvas(w, h, "#15191f")
    rng = np.random.default_rng(9)
    cols = ["#c8102e", "#0b5ea8", "#f2f2f2", "#1d8a46", "#f0b400", "#101010", "#e05a00", "#4a2a8a"]
    x = 0
    while x < w:
        L = int(rng.integers(40, 90))
        c = cols[int(rng.integers(0, len(cols)))]
        cv.rect(x + 1, 3, min(w, x + L) - 1, h - 3, c)
        lc = "#ffffff" if c not in ("#f2f2f2", "#f0b400") else "#1a1a1a"
        cv.rect(x + 8, 12, min(w, x + L) - 8, 20, lc)
        x += L
    night = cv.a * 0.8
    return image("GT_Boards", np.flipud(cv.a).copy()), image("GT_BoardsNight", np.flipud(night).copy())


def membrane_images():
    """The canopy, 9 x 9 m a repeat: top - the translucent membrane between dark ribs; under - lighter panels
    between the steel ribs and purlins."""
    w = 256
    top = Canvas(w, w, "#e6e8e3")
    top.noise(0.04, 13)
    top.a[(top.x < 6) | (top.x > w - 2)] = srgb("#8f9496")
    top.a[np.abs(top.y - w / 2) < 1.5] *= 0.9
    under = Canvas(w, w, "#d5d7d2")
    under.noise(0.05, 14)
    under.a[(under.x < 10) | (under.x > w - 3)] = srgb("#6b7175")
    under.a[np.mod(under.y, w / 3) < 3] = srgb("#80868a")
    return image("GT_Membrane", np.flipud(top.a).copy()), image("GT_Under", np.flipud(under.a).copy())


def pitch_image():
    """The pitch and its margins over the bowl's front edge box (2 AI x 2 BI): mown stripes and the markings."""
    ppm = 6.4
    w, h = int(2 * AI * ppm), int(2 * BI * ppm)
    cv = Canvas(w, h, "#4f8a3a")
    X, Y = cv.x / ppm - AI, (h - cv.y) / ppm - BI
    stripe = (np.floor((Y + 52.5) / 5.25).astype(int) % 2) == 0
    cv.a[stripe] *= 1.1
    cv.noise(0.06, 17)
    lw = 0.32
    hl, hw = 52.5, 34.0
    L = np.zeros(X.shape, bool)

    def rect_line(x0, x1, y0, y1):
        nonlocal L
        inside = (X >= x0 - lw / 2) & (X <= x1 + lw / 2) & (Y >= y0 - lw / 2) & (Y <= y1 + lw / 2)
        inner = (X > x0 + lw / 2) & (X < x1 - lw / 2) & (Y > y0 + lw / 2) & (Y < y1 - lw / 2)
        L |= inside & ~inner

    rect_line(-hw, hw, -hl, hl)
    L |= (np.abs(Y) < lw / 2) & (np.abs(X) <= hw)
    R = np.hypot(X, Y)
    L |= np.abs(R - 9.15) < lw / 2
    L |= R < 0.35
    for sgn in (-1, 1):
        rect_line(-20.16, 20.16, hl - 16.5, hl) if sgn > 0 else rect_line(-20.16, 20.16, -hl, -hl + 16.5)
        rect_line(-9.16, 9.16, hl - 5.5, hl) if sgn > 0 else rect_line(-9.16, 9.16, -hl, -hl + 5.5)
        py = sgn * (hl - 11.0)
        Rp = np.hypot(X, Y - py)
        L |= (Rp < 0.3)
        L |= (np.abs(Rp - 9.15) < lw / 2) & (np.abs(Y) < hl - 16.5)
        for cx in (-hw, hw):
            L |= (np.abs(np.hypot(X - cx, Y - sgn * hl) - 1.0) < lw / 2) & (np.abs(X) <= hw) & (np.abs(Y) <= hl)
    cv.a[L] = srgb("#eef0ea")
    return image("GT_Pitch", np.flipud(cv.a).copy())


def far_images():
    """The facade from afar, four bays a repeat, the whole height (0-31.8 m) once: piers, the door storey, the
    windows between the piers, the entablature; and its night map."""
    w, h = 256, 256
    cv = Canvas(w, h, "#d9cdb2")
    bay_px = w / 4
    xb = np.mod(cv.x, bay_px) / bay_px * BAY
    z = (h - cv.y) / h * 31.8
    pier = (xb < 0.55) | (xb > BAY - 0.55)
    gap = ~pier
    win = gap & (z > Z_BASE) & (z < Z_ENT) & (np.mod(z - Z_BASE, 5.375) > 0.9)
    door = gap & (np.abs(xb - BAY / 2) < 1.25) & (z < 4.4)
    cv.a[gap & (z < Z_ENT)] = srgb("#b6aa8f")
    cv.a[win] = srgb("#46525b")
    cv.a[door] = srgb("#2b3237")
    cv.a[pier & (z < 1.0)] = srgb("#9b9890")
    night = Canvas(w, h, "#000000")
    rng = np.random.default_rng(23)
    lit = rng.random((8, 4)) < 0.5
    fl = np.clip(((z - Z_BASE) // 5.375).astype(int), 0, 7)
    bi = (cv.x // bay_px).astype(int) % 4
    night.a[win & lit[fl, bi]] = srgb("#b98d55")
    night.a[door] = srgb("#c99a5c")
    return image("GT_Far", np.flipud(cv.a).copy()), image("GT_FarNight", np.flipud(night.a).copy())


def materials():
    base, base_n = base_images()
    boards, boards_n = board_images()
    mem, under = membrane_images()
    far, far_n = far_images()
    win = dict(floorH=5.375, colW=BAY / 2, glass="#3b4650", frame="#e3d9c1", spandrel="#ddd1b6", mull=0.07, slab=0.17,
               metal=0.5, rough=0.15, lit=0.5, warm="#ffd29a", coolShare=0.1, seed=7)
    suites = dict(floorH=4.6, colW=2.4, glass="#2a333c", frame="#8d939a", spandrel="#8d939a", mull=0.04, slab=0.12,
                  metal=0.6, rough=0.1, lit=0.75, warm="#ffd7a6", coolShare=0.2, seed=8)
    return dict(
        stone=material("GT_Stone", "#e2d8bf", 0.75, props={"wet": "damp", "glow": "flood", "glowStrength": 0.55}),
        granite=material("GT_Granite", "#99968e", 0.7, props={"wet": "damp", "glow": "flood", "glowStrength": 0.4}),
        base=material("GT_BaseWall", "#ddd2b8", 0.7, tex=base, emit_tex=base_n, props={"wet": "damp", "glow": "flood", "glowStrength": 0.5, "emit": "night"}),
        windows=facade("GT_Windows", win),
        suites=facade("GT_Suites", suites),
        concrete=material("GT_Concrete", "#a9a59e", 0.85, props={"wet": "damp", "glow": "none"}),
        seats=material("GT_Seats", "#2f6a4b", 0.6, tex=seat_image(), props={"wet": "surface", "glow": "none"}),
        boards=material("GT_Boards", "#15191f", 0.4, tex=boards, emit_tex=boards_n, props={"wet": "surface", "glow": "none", "emit": "night"}),
        membrane=material("GT_Membrane", "#e6e8e3", 0.45, tex=mem, props={"wet": "surface", "glow": "flood", "glowStrength": 0.3}),
        under=material("GT_CanopyUnder", "#d5d7d2", 0.6, tex=under, props={"wet": "none", "glow": "none"}),
        steel=material("GT_Steel", "#6c7378", 0.35, metal=0.8, props={"wet": "surface", "glow": "none"}),
        lamp=material("GT_Lamp", "#fff6e6", 0.4, props={"glow": "lamp", "glowColor": "#fff0d8", "glowStrength": 1.6}),
        pitch=material("GT_Pitch", "#4f8a3a", 0.9, tex=pitch_image(), props={"wet": "damp", "glow": "none", "layer": 10}),
        pave=material("GT_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        coping=material("GT_Coping", "#c4bfb3", 0.7, props={"wet": "damp", "glow": "none"}),
        water=material("GT_Water", "#1d3035", 0.04, metal=0.15, props={"wet": "none", "glow": "none", "layer": 10}),
        red=material("GT_Red", "#b3211b", 0.45, props={"wet": "surface", "glow": "flood", "glowStrength": 0.6}),
        far=material("GT_Far", "#d9cdb2", 0.75, tex=far, emit_tex=far_n, props={"wet": "damp", "glow": "flood", "glowStrength": 0.5, "emit": "night"}),
    )


TILE = dict(coping=2.0, stone=3.0, granite=2.0, concrete=4.0, steel=2.0, lamp=1.0, pave=4.0, water=10.0, red=1.0)


# ---- sweeps round the oval ---------------------------------------------------------------------------------

def sweep(g, P0, P1, key, u, v0, v1, want, smooth=True):
    """A closed strip between two rings of the same count (2-D plan points with a z each: (x, y, z)); `u` has one
    more value than the rings (the seam), `v0`/`v1` are scalars or lists; `want` = (radial, up) says which way it
    faces (checked on the first quad)."""
    n = len(P0)
    a = [g.vert(P0[i % n]) for i in range(n + 1)]
    b = [g.vert(P1[i % n]) for i in range(n + 1)]
    V0 = v0 if isinstance(v0, list) else [v0] * n
    V1 = v1 if isinstance(v1, list) else [v1] * n
    p0, p1, q0 = Vector(P0[0]), Vector(P0[1]), Vector(P1[0])
    nrm = (p1 - p0).cross(q0 - p0)
    rad = Vector((p0.x, p0.y, 0)).normalized()
    w = rad * want[0] + Vector((0, 0, want[1]))
    if nrm.length < 1e-9:
        nrm = (Vector(P1[1]) - q0).cross(q0 - p0)
    flip = nrm.dot(w) < 0
    for i in range(n):
        q = [a[i], a[i + 1], b[i + 1], b[i]]
        uv = [(u[i], V0[i % n]), (u[i + 1], V0[(i + 1) % n]), (u[i + 1], V1[(i + 1) % n]), (u[i], V1[i % n])]
        if flip:
            q.reverse()
            uv.reverse()
        g.face(q, key, uv, smooth)


def ringF(d, z, ths=TH):
    return [(*F(d, t), z) for t in ths]


def ringS(s, z, ths=TH):
    if callable(z):
        return [(*S(s, t), z(s)) for t in ths]
    return [(*S(s, t), z) for t in ths]


def facade_profile(g, ths=TH, uu=None):
    """The facade's skin, round the whole oval (the gates stand over it)."""
    uu = uu or U
    um = [x for x in uu]                     # metres along the facade line (facade shader)
    ub = [x / BAY for x in uu]               # bays (the door texture)
    us = [x / TILE["stone"] for x in uu]
    sweep(g, ringF(WALL, 0.0, ths), ringF(WALL, Z_BASE, ths), "base", ub, 0.0, 1.0, (1, 0))
    sweep(g, ringF(WALL, Z_BASE, ths), ringF(WALL, Z_ENT, ths), "windows", um, 0.0, Z_ENT - Z_BASE, (1, 0))
    sweep(g, ringF(WALL, Z_ENT, ths), ringF(0.25, Z_ENT, ths), "stone", us, 0.0, 0.5, (0, -1))
    sweep(g, ringF(0.25, Z_ENT, ths), ringF(0.25, 31.0, ths), "stone", us, Z_ENT / 3, 31.0 / 3, (1, 0))
    sweep(g, ringF(0.25, 31.0, ths), ringF(1.0, 31.0, ths), "stone", us, 0.0, 0.25, (0, -1))
    sweep(g, ringF(1.0, 31.0, ths), ringF(1.0, 31.8, ths), "stone", us, 0.0, 0.27, (1, 0))
    sweep(g, ringF(1.0, 31.8, ths), ringF(0.1, 32.0, ths), "stone", us, 0.0, 0.3, (0.2, 1))
    sweep(g, ringF(0.1, 32.0, ths), ringF(0.1, Z_PAR, ths), "stone", us, 32.0 / 3, Z_PAR / 3, (1, 0))
    sweep(g, ringF(0.1, Z_PAR, ths), ringF(-0.5, Z_PAR, ths), "stone", us, 0.0, 0.2, (0, 1))
    sweep(g, ringF(-0.5, Z_PAR, ths), ringF(-0.5, DECK, ths), "concrete", us, 0.0, 0.5, (-1, 0))
    sweep(g, ringF(-0.5, DECK, ths), ringF(-BACK, DECK, ths), "concrete", us, 0.0, 2.0, (0, 1))


def stands(g):
    """The bowl from the pitch to the roof deck: boards, lower tier, the boxes, upper tier."""
    ua = [x / 12.0 for x in U]
    uc = [x / TILE["concrete"] for x in U]
    um = U

    def slope_v(s0, z0, s1, z1):
        out = []
        for t in TH:
            p0, p1 = S(s0, t), S(s1, t)
            out.append(math.hypot(math.hypot(p1[0] - p0[0], p1[1] - p0[1]), z1 - z0) / 3.2)
        return out

    sweep(g, ringS(0.0, 0.0), ringS(0.0, 1.3), "boards", [x / 64.0 for x in U], 0.0, 1.0, (-1, 0))
    sweep(g, ringS(0.0, 1.3), ringS(0.30, 12.0), "seats", ua, 0.0, slope_v(0.0, 1.3, 0.30, 12.0), (-0.5, 1))
    sweep(g, ringS(0.30, 12.0), ringS(0.30, 12.9), "concrete", uc, 0.0, 0.25, (-1, 0))
    sweep(g, ringS(0.30, 12.9), ringS(0.315, 12.9), "concrete", uc, 0.0, 0.25, (0, 1))
    sweep(g, ringS(0.315, 12.9), ringS(0.315, 16.6), "suites", [x * 0.6 for x in um], 0.0, 3.7, (-1, 0))
    sweep(g, ringS(0.315, 16.6), ringS(0.30, 16.6), "concrete", uc, 0.0, 0.25, (0, -1))
    sweep(g, ringS(0.30, 16.6), ringS(0.30, 17.6), "concrete", uc, 0.0, 0.25, (-1, 0))
    sweep(g, ringS(0.30, 17.6), ringS(1.0, DECK), "seats", ua, 0.0, slope_v(0.30, 17.6, 1.0, DECK), (-0.5, 1))


CANOPY = [(1.2, 33.4), (0.95, 39.0), (0.7, 45.5), (0.4, 44.6), (0.2, 43.2), (0.04, 41.6)]
THICK = 0.7


def canopy(g, ths=TH, uu=None, profile=CANOPY, under=True):
    uu = uu or U
    ur = [x / 9.0 for x in uu]
    for (s0, z0), (s1, z1) in zip(profile, profile[1:]):
        sweep(g, ringS(s0, z0, ths), ringS(s1, z1, ths), "membrane", ur, s0 * 60 / 9, s1 * 60 / 9, (0, 1))
        if under:
            sweep(g, ringS(s0, z0 - THICK, ths), ringS(s1, z1 - THICK, ths), "under", ur, s0 * 60 / 9, s1 * 60 / 9, (0, -1))
    s_in, z_in = profile[-1]
    uc = [x / 2.0 for x in uu]
    sweep(g, ringS(s_in, z_in, ths), ringS(s_in, z_in - 1.6, ths), "steel", uc, 0.0, 0.8, (-1, 0))
    if under:
        sweep(g, ringS(s_in, z_in - 1.6, ths), ringS(s_in + 0.012, z_in - 1.6, ths), "lamp", uc, 0.0, 0.1, (0, -1))
        sweep(g, ringS(s_in + 0.012, z_in - 1.6, ths), ringS(s_in + 0.012, z_in - THICK, ths), "steel", uc, 0.0, 0.5, (1, 0))
        s_out, z_out = profile[0]
        sweep(g, ringS(s_out, z_out, ths), ringS(s_out, z_out - THICK, ths), "under", ur, 0.0, 0.1, (1, 0))


def pitch(g):
    pts = [S(0.0, t) for t in TH]
    g.polyn([(x, y, 0.06) for x, y in pts], "pitch", (0, 0, 1),
            uvs=[((x + AI) / (2 * AI), (y + BI) / (2 * BI)) for x, y in pts])


def goal_geo(g, y, sgn):
    w, h, p = 3.66, 2.44, 0.06
    for x in (-w, w):
        g.box(x - p, x + p, y - p, y + p, 0.06, h + p, "membrane")
    g.box(-w - p, w + p, y - p, y + p, h - p, h + p, "membrane")
    yb = y + sgn * 2.0
    for x in (-w, w):
        g.box(x - 0.03, x + 0.03, min(y, yb), max(y, yb), 0.06, 0.12, "membrane")
        g.box(x - 0.03, x + 0.03, min(y, yb), max(y, yb), h - 0.03, h + 0.03, "membrane")
    g.box(-w, w, yb - 0.03, yb + 0.03, h - 0.03, h + 0.03, "membrane")


# ---- the moat and the walk ---------------------------------------------------------------------------------

def bridge_of(p):
    """The bridge (angle, half width) whose deck a plan point lies on, or None."""
    for ang, hw in BRIDGES:
        a = math.radians(ang)
        d = (math.cos(a), math.sin(a))
        along = p[0] * d[0] + p[1] * d[1]
        lat = -p[0] * d[1] + p[1] * d[0]
        if along > 0 and abs(lat) < hw:
            return (ang, hw)
    return None


def moat_thetas(n=360):
    """Angles round the oval with one exactly at each bridge edge (at the water's middle)."""
    ths = set(2 * math.pi * k / n for k in range(n))
    dmid = (MOAT[1] + MOAT[2]) / 2
    for ang, hw in BRIDGES:
        a = math.radians(ang)
        for sgn in (-1, 1):
            # solve lateral(F(dmid, th)) = sgn * hw near a
            lo, hi = a, a + sgn * 0.5
            for _ in range(50):
                m = (lo + hi) / 2
                p = F(dmid, m)
                lat = -p[0] * math.sin(a) + p[1] * math.cos(a)
                if abs(lat) < hw:
                    lo = m
                else:
                    hi = m
            ths.add(((lo + hi) / 2) % (2 * math.pi))
    return sorted(ths)


def moat(g, gc, ths):
    """Paving under the colonnade and out to the moat, the moat's copings (also the collider), water, the bridges
    with their parapets, the outer strip of paving."""
    n = len(ths)
    uu = arc(ths)
    up = [x / 4.0 for x in uu]
    sweep(g, ringF(WALL - 0.1, 0.03, ths), ringF(MOAT[0], 0.03, ths), "pave", up, 0.0, (MOAT[0] - WALL) / 4.0, (0, 1))
    sweep(g, ringF(MOAT[3], 0.03, ths), ringF(MOAT[4], 0.03, ths), "pave", up, 0.0, (MOAT[4] - MOAT[3]) / 4.0, (0, 1))
    dmid = (MOAT[1] + MOAT[2]) / 2

    def quad(target, d0, z0, d1, z1, i, key, want):
        t0, t1 = ths[i], ths[(i + 1) % n]
        p = [(*F(d0, t0), z0), (*F(d0, t1), z0), (*F(d1, t1), z1), (*F(d1, t0), z1)]
        rad = Vector((p[0][0], p[0][1], 0)).normalized()
        target.polyn(p, key, tuple(rad * want[0] + Vector((0, 0, want[1]))))

    for i in range(n):
        tm = (ths[i] + ((ths[(i + 1) % n] - ths[i]) % (2 * math.pi)) / 2)
        if bridge_of(F(dmid, tm)):
            continue
        quad(g, MOAT[1], 0.04, MOAT[2], 0.04, i, "water", (0, 1))
        for c0, c1 in ((MOAT[0], MOAT[1]), (MOAT[2], MOAT[3])):
            for target, key in ((g, "coping"), (gc, "x")):
                quad(target, c0, COPE_H, c1, COPE_H, i, key, (0, 1))
                quad(target, c0, 0.0, c0, COPE_H, i, key, (-1, 0))
                quad(target, c1, 0.0, c1, COPE_H, i, key, (1, 0))
    # bridges: a deck over the water, a parapet each side (copings' ends sit against them)
    for ang, hw in BRIDGES:
        a = math.radians(ang)
        d, t = Vector((math.cos(a), math.sin(a))), Vector((-math.sin(a), math.cos(a)))
        r0 = rpol(A0 + MOAT[0] - 0.3, B0 + MOAT[0] - 0.3, NE, a)
        r1 = rpol(A0 + MOAT[3] + 0.3, B0 + MOAT[3] + 0.3, NE, a)
        c = [d * r0 + t * -hw, d * r1 + t * -hw, d * r1 + t * hw, d * r0 + t * hw]
        g.polyn([(p.x, p.y, 0.1) for p in c], "pave", (0, 0, 1))
        for sgn in (-1, 1):
            m = Matrix.Translation((*(d * (r0 + r1) / 2 + t * sgn * (hw + 0.2)), 0)) @ Rz(a)
            pg = Geo()
            pg.box(-(r1 - r0) / 2, (r1 - r0) / 2, -0.2, 0.2, 0.0, 0.85, "coping", skip=("-z",))
            g.add(pg, m)
            cg = Geo()
            cg.box(-(r1 - r0) / 2, (r1 - r0) / 2, -0.2, 0.2, 0.0, 0.85, "x", skip=("-z",))
            gc.add(cg, m)


# ---- parts ---------------------------------------------------------------------------------------------------

def pier_geo():
    """A pier, local +X out of the facade (its face on the facade line), +Y along it: granite base, stone shaft
    with a shallow capital."""
    g = Geo()
    g.box(-1.5, 0.2, -0.62, 0.62, 0.0, 1.0, "granite", skip=("-z", "-x"))
    g.box(-1.5, 0.05, -0.48, 0.48, 1.0, Z_ENT - 0.7, "stone", skip=("-z", "-x"))
    g.box(-1.5, 0.15, -0.56, 0.56, Z_ENT - 0.7, Z_ENT, "stone", skip=("-x", "+z"))
    return g


def flag_geo():
    g = Geo()
    s = 6
    for k in range(s):
        a0, a1 = 2 * math.pi * k / s, 2 * math.pi * (k + 1) / s
        g.poly([(0.07 * math.cos(a0), 0.07 * math.sin(a0), 0.0), (0.07 * math.cos(a1), 0.07 * math.sin(a1), 0.0),
                (0.05 * math.cos(a1), 0.05 * math.sin(a1), 8.0), (0.05 * math.cos(a0), 0.05 * math.sin(a0), 8.0)], "steel")
    g.box(-0.1, 0.1, -0.1, 0.1, 8.0, 8.2, "steel", skip=("-z",))
    g.poly([(0.0, 0.08, 6.6), (0.0, 1.9, 6.6), (0.0, 1.9, 7.8), (0.0, 0.08, 7.8)], "red")
    return g


def gatepost_geo():
    g = Geo()
    g.box(-1.0, 1.0, -1.0, 1.0, 0.0, 1.0, "granite", skip=("-z",))
    g.box(-0.75, 0.75, -0.75, 0.75, 1.0, 7.6, "stone", skip=("-z",))
    g.box(-0.95, 0.95, -0.95, 0.95, 7.6, 8.1, "stone", skip=())
    g.box(-0.6, 0.6, -0.6, 0.6, 8.1, 8.5, "stone", skip=("-z",))
    g.box(-0.3, 0.3, -0.3, 0.3, 8.5, 9.3, "lamp", skip=("-z",))
    return g


def gate_geo(g):
    """An axis gate in its frame: +X out (front face at GATE_OUT from the facade line), +Y along the facade."""
    o, i, hw = GATE_OUT, GATE_IN, GATE_HW
    for sgn in (-1, 1):
        y0, y1 = sorted((sgn * OPEN_HW, sgn * hw))
        g.box(i, o, y0, y1, 0.0, GATE_H, "stone", skip=("-z", "+z"))
        # pilasters: the outer ones full height, the inner ones (by the opening) stop under the lettering
        yi = (y0 + 0.9, y0 + 1.7) if sgn > 0 else (y1 - 1.7, y1 - 0.9)
        yo = (y1 - 1.7, y1 - 0.9) if sgn > 0 else (y0 + 0.9, y0 + 1.7)
        g.box(o, o + 0.45, yi[0], yi[1], 0.0, 24.6, "stone", skip=("-z", "-x"))
        g.box(o, o + 0.45, yo[0], yo[1], 0.0, GATE_H - 2.0, "stone", skip=("-z", "-x"))
        g.box(o - 0.05, o + 0.6, y0 - 0.05, y1 + 0.05, 0.0, 1.0, "granite", skip=("-z",))
    g.box(i, o, -OPEN_HW, OPEN_HW, OPEN_H, GATE_H, "stone", skip=("-y", "+y", "+z"))
    # the lobby glass in the opening and a glazed panel above it
    g.polyn([(-0.6, -OPEN_HW, 0.0), (-0.6, OPEN_HW, 0.0), (-0.6, OPEN_HW, OPEN_H), (-0.6, -OPEN_HW, OPEN_H)], "windows", (1, 0, 0),
            uvs=[(0, 0), (12, 0), (12, OPEN_H), (0, OPEN_H)])
    g.polyn([(o + 0.02, -5.5, 13.0), (o + 0.02, 5.5, 13.0), (o + 0.02, 5.5, 24.0), (o + 0.02, -5.5, 24.0)], "windows", (1, 0, 0),
            uvs=[(0, 0), (11, 0), (11, 11), (0, 11)])
    # cornice and roof
    g.box(i, o + 0.7, -hw - 0.7, hw + 0.7, GATE_H - 2.0, GATE_H - 1.2, "stone")
    g.box(i, o + 0.2, -hw - 0.2, hw + 0.2, GATE_H - 1.2, GATE_H, "stone", skip=("-z",))


def gate_frame(ang):
    a = math.radians(ang)
    r = rpol(A0, B0, NE, a)
    return Matrix.Translation((r * math.cos(a), r * math.sin(a), 0.0)) @ Rz(a)


def facing(x, y, z, out):
    """Matrix putting a text's XY plane upright at (x, y, z), reading left to right as seen from `out`."""
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(x, y, z) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def theta_at(s_arc):
    """The angle where the facade line's arc length reaches s_arc (on the N samples, linearly)."""
    s_arc %= PERIM
    k = max(0, min(N - 1, int(np.searchsorted(U, s_arc, side="right")) - 1))
    t = (s_arc - U[k]) / max(U[k + 1] - U[k], 1e-9)
    return TH[k] + t * (2 * math.pi / N)


def in_gate(p, margin=1.4):
    for ang in (0.0, 90.0, 180.0, 270.0):
        a = math.radians(ang)
        along = p[0] * math.cos(a) + p[1] * math.sin(a)
        lat = -p[0] * math.sin(a) + p[1] * math.cos(a)
        if along > 0 and abs(lat) < GATE_HW + margin:
            return True
    return False


def normal_at(th):
    p0, p1 = F(0.0, th - 1e-4), F(0.0, th + 1e-4)
    tx, ty = p1[0] - p0[0], p1[1] - p0[1]
    return math.atan2(-tx, ty)       # the outward normal's angle (the ring runs counter-clockwise)


def box_obj(coll, name, center, half, yaw, role="COL"):
    """A yaw-only box collider (the game reads it as a box)."""
    import bcity_landmark
    g = Geo()
    g.box(-half[0], half[0], -half[1], half[1], -half[2], half[2], "x")
    o = g.build(name, coll, {"x": None})
    o.data.materials.clear()
    o.matrix_world = Matrix.Translation(center) @ Matrix.Rotation(yaw, 4, "Z")
    bcity_landmark.rename(o, role)
    return o


def tris_of(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


# ---- build ---------------------------------------------------------------------------------------------------

def build():
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    clear_file()
    ensure_addon()
    import bcity_landmark
    M = materials()
    main = collection("工人体育场")
    stats = {}

    # the facade skin, the bowl, the canopy, the pitch and goals
    g = Geo()
    facade_profile(g)
    stats["facade"] = g.tris()
    stands(g)
    pitch(g)
    goal_geo(g, 52.5, 1)
    goal_geo(g, -52.5, -1)
    stats["bowl"] = g.tris() - stats["facade"]
    body = g.build("Stadium", collection("体育场", main), M, TILE)
    gcan = Geo()
    canopy(gcan)
    stats["canopy"] = gcan.tris()
    gcan.build("Canopy", collection("罩棚", main), M, TILE)

    # the gates and their lettering
    gg = Geo()
    gate_geo(gg)
    font = bpy.data.fonts.load(FONT)
    letters = collection("字", main)
    gates = collection("大门", main)
    gtris = 0
    for ang in (0.0, 90.0, 180.0, 270.0):
        G = Geo()
        G.add(gg, gate_frame(ang))
        G.build(f"Gate{int(ang)}", gates, M, TILE)
        gtris += G.tris()
        a = math.radians(ang)
        out = (math.cos(a), math.sin(a))
        r = rpol(A0, B0, NE, a) + GATE_OUT + 0.03
        gtris += sign(font, "工人体育场", 3.0, facing(out[0] * r, out[1] * r, 28.6, out), f"Name{int(ang)}", letters, M["red"], extrude=0.03)
    stats["gates"] = gtris

    # the moat (and its collider), the walk
    gm, gc = Geo(), Geo()
    moat(gm, gc, moat_thetas())
    stats["moat"] = gm.tris()
    gm.build("Moat", collection("护城河", main), M, TILE)

    # piers, flagpoles, gate posts: linked duplicates
    me_pier = mesh_of(pier_geo(), "pier", M, TILE)
    me_flag = mesh_of(flag_geo(), "flagpole", M, TILE)
    me_post = mesh_of(gatepost_geo(), "gatepost", M, TILE)
    piers, flags, posts = collection("柱廊", main), collection("旗杆", main), collection("门柱", main)
    npier = nflag = 0
    for k in range(NBAY):
        th = theta_at(k * BAY)
        p = F(0.0, th)
        if in_gate(p):
            continue
        yaw = normal_at(th)
        place(me_pier, f"pier{k}", piers, T(p[0], p[1], 0.0) @ Rz(yaw))
        npier += 1
        if k % 4 == 2:
            q = F(-0.2, th)
            place(me_flag, f"flag{k}", flags, T(q[0], q[1], Z_PAR) @ Rz(yaw))
            nflag += 1
    for ang, hw in BRIDGES[:4]:
        a = math.radians(ang)
        d, t = Vector((math.cos(a), math.sin(a))), Vector((-math.sin(a), math.cos(a)))
        r = rpol(A0 + 8.6, B0 + 8.6, NE, a)
        for sgn in (-1, 1):
            c = d * r + t * sgn * (hw + 1.3)
            place(me_post, f"post{int(ang)}_{sgn}", posts, T(c.x, c.y, 0.0) @ Rz(a))
    stats.update(piers=npier, flags=nflag)

    # far level: the facade as a painted ring, cornice, the canopy's top, the bowl, the pitch, the gates, the moat
    NF = 64
    thf = [2 * math.pi * k / NF for k in range(NF)]
    uf = arc(thf)
    far = Geo()
    sweep(far, ringF(0.0, 0.0, thf), ringF(0.0, 31.8, thf), "far", [x / (4 * BAY) for x in uf], 0.0, 1.0, (1, 0))
    us = [x / 3.0 for x in uf]
    sweep(far, ringF(0.0, 31.8, thf), ringF(0.4, 31.8, thf), "stone", us, 0.0, 0.2, (0, -1))
    sweep(far, ringF(0.4, 31.8, thf), ringF(0.4, Z_PAR, thf), "stone", us, 0.0, 0.7, (1, 0))
    sweep(far, ringF(0.4, Z_PAR, thf), ringF(-1.0, Z_PAR, thf), "stone", us, 0.0, 0.3, (0, 1))
    canopy(far, thf, uf, [(1.2, 33.4), (0.7, 45.5), (0.04, 41.6)], under=False)
    sweep(far, [(*S(0.0, t), 1.3) for t in thf], [(*S(1.0, t), DECK) for t in thf], "seats", [x / 12.0 for x in uf], 0.0, 12.0, (-0.5, 1))
    pts = [S(0.0, t) for t in thf]
    far.polyn([(x, y, 0.06) for x, y in pts], "pitch", (0, 0, 1), uvs=[((x + AI) / (2 * AI), (y + BI) / (2 * BI)) for x, y in pts])
    for ang in (0.0, 90.0, 180.0, 270.0):
        fg = Geo()
        fg.box(GATE_IN, GATE_OUT, -GATE_HW, GATE_HW, 0.0, GATE_H, "stone", skip=("-z",))
        far.add(fg, gate_frame(ang))
    sweep(far, ringF(WALL, 0.03, thf), ringF(MOAT[1], 0.03, thf), "pave", [x / 4 for x in uf], 0.0, 1.0, (0, 1))
    sweep(far, ringF(MOAT[1], 0.04, thf), ringF(MOAT[2], 0.04, thf), "water", [x / 10 for x in uf], 0.0, 0.3, (0, 1))
    sweep(far, ringF(MOAT[2], 0.03, thf), ringF(MOAT[4], 0.03, thf), "pave", [x / 4 for x in uf], 0.0, 0.5, (0, 1))
    far.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = far.tris()

    # colliders: the stadium as one hull (convex: the superellipse's exponent is over 2), a box per gate and per
    # gate post, the moat's copings and the bridges' parapets as a trimesh
    helpers = collection("碰撞体")
    hull = []
    for k in range(64):
        th = 2 * math.pi * k / 64
        x, y = F(0.2, th)
        hull += [(x, y, -0.5), (x, y, Z_PAR)]
    collider_pts(helpers, "stadium", hull)
    for ang in (0.0, 90.0, 180.0, 270.0):
        a = math.radians(ang)
        r = rpol(A0, B0, NE, a) + (GATE_OUT + GATE_IN) / 2
        box_obj(helpers, f"gate{int(ang)}", (r * math.cos(a), r * math.sin(a), GATE_H / 2),
                ((GATE_OUT + 0.7 - GATE_IN) / 2, GATE_HW + 0.7, GATE_H / 2), a)
    for ang, hw in BRIDGES[:4]:
        a = math.radians(ang)
        d, t = Vector((math.cos(a), math.sin(a))), Vector((-math.sin(a), math.cos(a)))
        r = rpol(A0 + 8.6, B0 + 8.6, NE, a)
        for sgn in (-1, 1):
            c = d * r + t * sgn * (hw + 1.3)
            box_obj(helpers, f"post{int(ang)}_{sgn}", (c.x, c.y, 4.6), (1.0, 1.0, 4.7), a)
    co = gc.build("moat", helpers, {"x": None})
    co.data.materials.clear()
    bcity_landmark.rename(co, "COLMESH")

    # footprint: the oval with the gates (OSM's ring and the relation's block); clear: out to the outer paving
    flat_marker(helpers, "stadium", [F(3.0, 2 * math.pi * k / 96) for k in range(96)], "FOOTPRINT")
    fx0, fx1, fz0, fz1 = FORECOURT
    flat_marker(helpers, "forecourt", [to_local(fx0, fz0), to_local(fx1, fz0), to_local(fx1, fz1), to_local(fx0, fz1)], "FOOTPRINT")
    flat_marker(helpers, "plaza", [F(MOAT[4] + 0.3, 2 * math.pi * k / 96) for k in range(96)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "gongti", "工人体育场", "Workers' Stadium"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 700
    s.max_texture = "1024"
    s.repo_path = REPO
    stats.update(perimeter=round(PERIM, 1), bays=NBAY, bay=round(BAY, 3))
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
