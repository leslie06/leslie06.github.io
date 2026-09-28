# A car body (not its wheels, which vehicle/Bodies.ts still builds), modelled in Blender. The shell is a
# subdivision-surface cage - half a lattice box (floor, side wall, the top from the shoulder over the glass and the
# roof to the centre line, and the two end caps), mirrored, subdivided and then worked on as a mesh: the window
# regions inset into a rubber frame, the wheel arches and the grille / intake pockets cut with booleans (the cutters'
# faces become the wheel wells and the pocket floors), and the lamps, seams, plates and badges laid on as decals -
# grids ray-cast onto the body from outside, so their outlines are crisp whatever the body's tessellation.
#
#   blender -b -P scripts/blender/vehicles/car.py -- [--type sedan] [--out .scratch/blender/sedan.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/sedan.glb src/vehicle/models/sedan.json --group
#
# Everything is written in the game's body frame (+X left, +Y up, +Z forward, y = 0 at the hub height) and every
# object carries the same matrix to Blender's frame. Objects are named "<group>__<part>": `hi` (the player's car,
# subdivision level 2), `lo` (traffic, level 1, fewer details), `doorLow` / `doorHigh` (the livery's door
# lettering strip, low for the taxi, high for the police). Material names are the Surf keys of Bodies.ts' palette.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

argv = args()
TYPE = argv[argv.index("--type") + 1] if "--type" in argv else "sedan"
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", f"{TYPE}.glb")
G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
M = {}
MATS = dict(
    paintU=("#e8c77a", 0.3, 0.0), paintL=("#1f5a3a", 0.3, 0.0), glass=("#0a0f14", 0.05, 0.0), glassDark=("#07090b", 0.05, 0.0),
    black=("#111213", 0.5, 0.0), gloss=("#0a0b0c", 0.14, 0.2), seam=("#050505", 0.85, 0.0), chrome=("#dcdfe2", 0.1, 1.0),
    satin=("#a9adb2", 0.32, 0.9), rubber=("#0d0d0e", 0.85, 0.0), under=("#0a0a0b", 0.95, 0.0), liner=("#070708", 1.0, 0.0),
    cladding=("#1b1c1e", 0.72, 0.0), grille=("#303236", 0.4, 0.35), intake=("#202124", 0.55, 0.2), plateF=("#2050c0", 0.35, 0.1),
    plateR=("#2050c0", 0.35, 0.1), head=("#e8ecf0", 0.08, 0.6), tail=("#a01010", 0.12, 0.1), reverse=("#e0e0e0", 0.1, 0.2),
    amber=("#e09020", 0.1, 0.2), brake=("#c01010", 0.15, 0.0), badge=("#c0c4c8", 0.15, 0.9), door=("#ffffff", 0.4, 0.0),
)


# ---- small maths -----------------------------------------------------------------------------------------------

def curve(pts):
    """Monotone cubic (Fritsch-Carlson) through (x, y) points sorted by x; flat beyond the ends (Mesher.curve)."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    n = len(pts)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9:
            t = 3 / math.sqrt(s)
            m[i], m[i + 1] = t * a * d[i], t * b * d[i]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while x > xs[i + 1]:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    return f


def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---- the body types ------------------------------------------------------------------------------------------

def sedan():
    zD, zRH, zH, zC = -1.62, -1.0, 0.18, 0.95
    return car(
        -2.30, 2.22, zD, zRH, zH, zC, [(-0.26, zC), (-1.0, -0.36), (-1.32, -1.06)], [(-0.36, -0.26), (-1.06, -1.0)],
        wheels=(1.3, -1.4), arch=0.36,
        zs=[-2.30, -2.27, -2.19, -2.02, -1.80, zD, -1.45, -1.32, -1.06, zRH, -0.70, -0.36, -0.26, -0.02, zH, 0.42, 0.68, zC, 1.18, 1.45, 1.72, 1.95, 2.10, 2.18, 2.22],
        W=curve([(-2.30, 0.79), (-2.27, 0.84), (-2.19, 0.868), (-2.0, 0.885), (-1.4, 0.9), (0, 0.905), (1.3, 0.9), (1.8, 0.886), (2.1, 0.866), (2.18, 0.842), (2.22, 0.80)]),
        SH=curve([(-2.30, 0.50), (-2.19, 0.55), (-1.9, 0.575), (-1.2, 0.58), (0, 0.56), (0.95, 0.53), (1.5, 0.49), (2.0, 0.42), (2.22, 0.35)]),
        BOT=curve([(-2.30, -0.07), (-2.19, -0.13), (-1.95, -0.165), (-1.7, -0.172), (1.6, -0.172), (1.95, -0.16), (2.16, -0.12), (2.22, -0.09)]),
        DECK=curve([(-2.30, 0.585), (-2.19, 0.64), (-2.0, 0.662), (-1.62, 0.672), (-0.9, 0.66), (0, 0.64), (0.95, 0.61), (1.4, 0.58), (1.9, 0.515), (2.15, 0.45), (2.22, 0.41)]),
        RAIL=curve([(zD, 0.672), (-1.45, 0.83), (-1.25, 0.97), (zRH, 1.055), (-0.6, 1.078), (-0.1, 1.078), (zH, 1.062), (0.42, 0.96), (0.68, 0.8), (zC, 0.61)]),
        RIN=curve([(zD, 0.075), (-1.35, 0.17), (zRH, 0.215), (-0.3, 0.225), (zH, 0.215), (0.6, 0.15), (zC, 0.075)]),
        CROWN=curve([(-2.30, 0.61), (-2.19, 0.672), (-2.0, 0.692), (-1.68, 0.705), (-1.5, 0.82), (-1.28, 1.0), (zRH, 1.108), (-0.6, 1.135), (-0.1, 1.137), (zH, 1.118), (0.42, 1.0), (0.68, 0.83), (zC, 0.65), (1.2, 0.625), (1.7, 0.568), (2.05, 0.49), (2.22, 0.425)]),
        SPLIT=curve([(-2.30, 0.30), (1.9, 0.30), (2.22, 0.24)]),
        mirrorZ=0.82, handles=(0.36, -0.74), handleY=0.47,
        seams=[  # (z, y) polylines on the side
            [(zC - 0.03, 0.605), (zC - 0.02, 0.3), (0.905, -0.06)],                  # front door, front edge
            [(-0.31, 0.64), (-0.31, -0.06)],                                          # B pillar: door to door
            [(-1.0, 0.655), (-1.02, 0.3), (-1.0, -0.06)],                              # rear door, rear edge
            [(0.905, -0.06), (-1.0, -0.06)],                                          # door bottoms
            [(1.8, 0.25), (1.81, 0.12), (1.77, -0.03)],                                # front bumper to wing
            [(-1.86, 0.5), (-1.88, 0.25), (-1.84, -0.04)],                             # rear bumper to quarter
        ],
        top_seams=[  # (x, z) polylines seen from above: the bonnet and the boot lid
            [(0.0, 1.02), (0.45, 1.01), (0.78, 0.98), (0.8, 1.4), (0.79, 1.95), (0.72, 2.12)],
            [(0.0, -1.68), (0.5, -1.68), (0.78, -1.66), (0.8, -2.0), (0.74, -2.2)],
        ],
        head=dict(zc=1.85, a0=0.26, a1=1.05, y0=lambda s: 0.272 + 0.028 * s, y1=lambda s: 0.405 - 0.018 * s * s),
        tail=dict(zc=-1.9, a0=0.22, a1=1.18, y0=lambda s: 0.43 + 0.02 * s, y1=lambda s: 0.56 - 0.01 * s),
        grille=[(0.0, 0.07), (0.36, 0.07), (0.44, 0.125), (0.46, 0.215), (0.42, 0.245), (0.0, 0.25)],
        intake=[(0.0, -0.13), (0.46, -0.13), (0.54, -0.105), (0.5, -0.08), (0.0, -0.08)],
        plateR=(0.13, 0.44, 0.14), plateF=(-0.07, 0.44, 0.14),
        door=(-0.2, 0.74),
    )


def car(zR, zF, zD, zRH, zH, zC, windows, blackouts, zs=None, **kw):
    """A body type's figures with the defaults filled in; the stations, unless given, are every window, pillar and
    screen edge, the ends' rounding and enough in between that no gap is over 0.28 m."""
    if zs is None:
        keys = {zR, zR + 0.03, zR + 0.11, zF - 0.12, zF - 0.04, zF, zD, zRH, zH, zC}
        for a, b in windows + blackouts:
            keys |= {a, b}
        zs = sorted({round(z, 4) for z in keys})
        out = [zs[0]]
        for z in zs[1:]:
            n = math.ceil((z - out[-1]) / 0.28)
            out += [out[-1] + (z - out[-1]) * i / n for i in range(1, n)] + [z]
        zs = out
    B = dict(zR=zR, zF=zF, zD=zD, zRH=zRH, zH=zH, zC=zC, windows=windows, blackouts=blackouts, zs=zs,
             char=0.43, belt=True, cladding=False, rails=False, spoiler=False, flare=0.028, archY=0.02, fin=True)
    B.update(kw)
    return B


def hatch():
    zD, zRH, zH, zC = -1.86, -1.55, -0.12, 0.72
    return car(
        -1.93, 1.98, zD, zRH, zH, zC, [(-0.33, zC), (-1.12, -0.415), (-1.5, -1.16)], [(-0.415, -0.33), (-1.16, -1.12)],
        wheels=(1.23, -1.32), arch=0.355, char=0.41, belt=False, spoiler=True,
        W=curve([(-1.93, 0.78), (-1.90, 0.825), (-1.82, 0.848), (-1.3, 0.873), (0, 0.88), (1.2, 0.875), (1.6, 0.865), (1.86, 0.845), (1.94, 0.82), (1.98, 0.78)]),
        SH=curve([(-1.93, 0.5), (-1.82, 0.56), (-1.3, 0.565), (-0.6, 0.548), (0.7, 0.518), (1.2, 0.492), (1.7, 0.445), (1.98, 0.36)]),
        BOT=curve([(-1.93, -0.08), (-1.82, -0.14), (-1.6, -0.165), (1.4, -0.165), (1.75, -0.155), (1.92, -0.12), (1.98, -0.09)]),
        DECK=curve([(-1.93, 0.62), (-1.82, 0.655), (-1.6, 0.662), (-1.2, 0.662), (0, 0.632), (0.72, 0.6), (1.1, 0.572), (1.6, 0.515), (1.98, 0.42)]),
        RAIL=curve([(zD, 0.662), (-1.78, 0.84), (-1.65, 1.0), (zRH, 1.075), (-1.2, 1.088), (-0.6, 1.092), (zH - 0.1, 1.086), (zH, 1.072), (zH + 0.25, 0.945), (zC - 0.25, 0.752), (zC, 0.6)]),
        RIN=curve([(zD, 0.075), (zRH, 0.2), (-0.6, 0.21), (zH, 0.2), (zC, 0.075)]),
        CROWN=curve([(-1.93, 0.64), (zD, 0.69), (-1.76, 0.9), (-1.62, 1.08), (zRH, 1.13), (-0.8, 1.148), (zH, 1.14), (zH + 0.2, 1.065), (zC - 0.15, 0.72), (zC + 0.05, 0.618), (1.4, 0.555), (1.98, 0.445)]),
        SPLIT=curve([(-1.93, 0.3), (1.7, 0.28), (1.98, 0.22)]),
        mirrorZ=0.64, handles=(0.25, -0.8), handleY=0.47,
        seams=[[(0.79, 0.6), (0.79, 0.3), (0.77, -0.055)], [(-0.372, 0.64), (-0.372, -0.055)], [(-1.08, 0.65), (-1.1, 0.3), (-1.08, -0.055)],
               [(0.77, -0.055), (-1.08, -0.055)], [(1.62, 0.25), (1.63, 0.1), (1.6, -0.03)], [(-1.62, 0.44), (-1.64, 0.2), (-1.6, -0.04)]],
        top_seams=[[(0.0, 0.8), (0.45, 0.79), (0.76, 0.77), (0.78, 1.2), (0.77, 1.72), (0.7, 1.88)]],
        head=dict(zc=1.6, a0=0.26, a1=1.05, y0=lambda s: 0.255 + 0.03 * s, y1=lambda s: 0.385 - 0.015 * s * s),
        tail=dict(zc=-1.55, a0=0.22, a1=1.18, y0=lambda s: 0.44 + 0.02 * s, y1=lambda s: 0.556 - 0.01 * s),
        grille=[(0.0, 0.06), (0.32, 0.06), (0.4, 0.11), (0.42, 0.2), (0.38, 0.23), (0.0, 0.235)],
        intake=[(0.0, -0.13), (0.42, -0.13), (0.5, -0.105), (0.46, -0.08), (0.0, -0.08)],
        plateR=(0.16, 0.44, 0.14), plateF=(-0.08, 0.44, 0.14), door=(-0.3, 0.65),
    )


def suv():
    zD, zRH, zH, zC = -2.2, -1.95, 0.1, 0.93
    return car(
        -2.27, 2.22, zD, zRH, zH, zC, [(-0.3, zC), (-1.2, -0.39), (-1.9, -1.26)], [(-0.39, -0.3), (-1.26, -1.2)],
        wheels=(1.36, -1.36), arch=0.41, archY=0.025, flare=0.034, char=0.5, cladding=True, rails=True,
        W=curve([(-2.27, 0.82), (-2.24, 0.865), (-2.16, 0.89), (-1.36, 0.925), (0, 0.93), (1.36, 0.925), (1.8, 0.912), (2.1, 0.895), (2.18, 0.87), (2.22, 0.83)]),
        SH=curve([(-2.27, 0.6), (-2.16, 0.65), (-1.4, 0.66), (0, 0.635), (0.9, 0.622), (1.4, 0.6), (1.9, 0.555), (2.22, 0.47)]),
        BOT=curve([(-2.27, -0.04), (-2.16, -0.1), (-1.9, -0.13), (1.8, -0.13), (2.1, -0.1), (2.22, -0.06)]),
        DECK=curve([(-2.27, 0.7), (-2.16, 0.735), (-1.4, 0.752), (0, 0.725), (0.93, 0.702), (1.36, 0.68), (1.8, 0.635), (2.22, 0.54)]),
        RAIL=curve([(zD, 0.75), (-2.13, 0.95), (-2.03, 1.18), (zRH, 1.262), (-1.5, 1.285), (-0.5, 1.29), (zH - 0.1, 1.285), (zH, 1.27), (zH + 0.25, 1.12), (zC - 0.3, 0.9), (zC, 0.702)]),
        RIN=curve([(zD, 0.08), (zRH, 0.17), (-0.5, 0.175), (zH, 0.17), (zC, 0.08)]),
        CROWN=curve([(-2.27, 0.78), (zD, 0.82), (-2.1, 1.15), (zRH, 1.328), (-1.0, 1.345), (zH, 1.34), (zH + 0.2, 1.25), (zC - 0.15, 0.84), (zC + 0.05, 0.73), (1.6, 0.66), (2.22, 0.57)]),
        SPLIT=curve([(-2.27, 0.38), (1.8, 0.36), (2.22, 0.3)]),
        mirrorZ=0.84, handles=(0.45, -0.85), handleY=0.58,
        seams=[[(0.88, 0.7), (0.88, 0.36), (0.86, -0.02)], [(-0.345, 0.74), (-0.345, -0.02)], [(-1.23, 0.75), (-1.25, 0.36), (-1.23, -0.02)],
               [(0.86, -0.02), (-1.23, -0.02)], [(1.84, 0.36), (1.85, 0.2), (1.82, 0.0)], [(-2.0, 0.52), (-2.02, 0.3), (-1.98, 0.0)]],
        top_seams=[[(0.0, 1.0), (0.5, 0.99), (0.82, 0.97), (0.84, 1.5), (0.83, 2.0), (0.76, 2.14)]],
        head=dict(zc=1.85, a0=0.26, a1=1.05, y0=lambda s: 0.372 + 0.03 * s, y1=lambda s: 0.5 - 0.015 * s * s),
        tail=dict(zc=-1.9, a0=0.22, a1=1.18, y0=lambda s: 0.52 + 0.02 * s, y1=lambda s: 0.635 - 0.01 * s),
        grille=[(0.0, 0.13), (0.4, 0.13), (0.48, 0.19), (0.5, 0.3), (0.46, 0.34), (0.0, 0.35)],
        intake=[(0.0, -0.1), (0.5, -0.1), (0.58, -0.07), (0.54, -0.035), (0.0, -0.035)],
        plateR=(0.26, 0.44, 0.14), plateF=(-0.015, 0.44, 0.14), door=(-0.25, 0.8),
    )


def mpv():
    zD, zRH, zH, zC = -2.6, -2.45, 0.1, 1.02
    return car(
        -2.64, 2.42, zD, zRH, zH, zC, [(-0.14, zC), (-1.35, -0.24), (-2.35, -1.45)], [(-0.24, -0.14), (-1.45, -1.35)],
        wheels=(1.5, -1.59), arch=0.385, char=0.45,
        W=curve([(-2.64, 0.84), (-2.61, 0.885), (-2.53, 0.91), (-1.6, 0.94), (0, 0.942), (1.5, 0.935), (2.0, 0.925), (2.3, 0.9), (2.38, 0.875), (2.42, 0.83)]),
        SH=curve([(-2.64, 0.56), (-2.53, 0.61), (-1.6, 0.622), (0, 0.605), (1.0, 0.588), (1.5, 0.56), (2.0, 0.515), (2.42, 0.43)]),
        BOT=curve([(-2.64, -0.06), (-2.53, -0.12), (-2.3, -0.15), (2.0, -0.15), (2.3, -0.13), (2.42, -0.09)]),
        DECK=curve([(-2.64, 0.66), (-2.53, 0.695), (-1.6, 0.704), (0, 0.684), (1.02, 0.656), (1.5, 0.63), (2.0, 0.575), (2.42, 0.48)]),
        RAIL=curve([(zD, 0.704), (-2.56, 0.95), (-2.5, 1.25), (zRH, 1.378), (-1.5, 1.408), (-0.5, 1.415), (zH - 0.1, 1.41), (zH, 1.392), (zH + 0.3, 1.2), (zC - 0.35, 0.92), (zC, 0.656)]),
        RIN=curve([(zD, 0.08), (zRH, 0.15), (-0.5, 0.155), (zH, 0.16), (zC, 0.08)]),
        CROWN=curve([(-2.64, 0.76), (zD, 0.8), (-2.55, 1.2), (zRH, 1.448), (-1.0, 1.465), (zH, 1.46), (zH + 0.25, 1.33), (zC - 0.2, 0.86), (zC + 0.05, 0.7), (1.8, 0.63), (2.42, 0.53)]),
        SPLIT=curve([(-2.64, 0.32), (2.0, 0.3), (2.42, 0.25)]),
        mirrorZ=0.92, handles=(0.55, -0.32), handleY=0.52,
        seams=[[(0.98, 0.66), (0.98, 0.3), (0.96, -0.05)], [(-0.19, 0.69), (-0.19, -0.05)], [(-1.4, 0.7), (-1.42, 0.3), (-1.4, -0.05)],
               [(0.96, -0.05), (-1.4, -0.05)], [(2.05, 0.3), (2.06, 0.15), (2.02, -0.03)], [(-2.36, 0.46), (-2.38, 0.25), (-2.34, -0.03)]],
        top_seams=[[(0.0, 1.09), (0.5, 1.08), (0.85, 1.06), (0.87, 1.6), (0.86, 2.2), (0.8, 2.34)]],
        head=dict(zc=2.05, a0=0.26, a1=1.05, y0=lambda s: 0.322 + 0.03 * s, y1=lambda s: 0.45 - 0.015 * s * s),
        tail=dict(zc=-2.25, a0=0.22, a1=1.18, y0=lambda s: 0.46 + 0.02 * s, y1=lambda s: 0.6 - 0.01 * s),
        grille=[(0.0, 0.09), (0.4, 0.09), (0.48, 0.15), (0.5, 0.26), (0.46, 0.3), (0.0, 0.305)],
        intake=[(0.0, -0.12), (0.5, -0.12), (0.58, -0.09), (0.54, -0.06), (0.0, -0.06)],
        plateR=(0.22, 0.44, 0.14), plateF=(-0.05, 0.44, 0.14), door=(-0.1, 0.9),
    )


BODIES = dict(sedan=sedan, hatch=hatch, suv=suv, mpv=mpv)


# ---- the cage ------------------------------------------------------------------------------------------------

NC = 8   # top columns, centre line (0) to the shoulder (7); the floor has as many, so the end caps are grids
NR = 7   # side rows, the floor corner (0) to the shoulder (6)


def in_green(B, z):
    return B["zD"] < z < B["zC"]


def section(B, z):
    """The ring at station z: floor (centre -> corner), side (rows 1..5), top (shoulder -> centre); (x, y) pairs."""
    W, SH, BOT = B["W"](z), B["SH"](z), B["BOT"](z)
    yD, crown = B["DECK"](z), B["CROWN"](z)
    split = min(B["SPLIT"](z), SH - 0.14)
    char = min(B["char"], SH - 0.065)
    # fender flares: the wall swells round each arch
    fl = 0.0
    for zw in B["wheels"]:
        t = abs(z - zw) / (B["arch"] + 0.28)
        if t < 1:
            fl += B["flare"] * (1 - t * t) ** 2
    # the rocker, a concave lower door, the swage at the colour split, the crease of the character line, the shoulder
    rows = [(W - 0.11, BOT), (W - 0.045 + fl * 0.5, BOT + 0.035), (W - 0.014 + fl, BOT + 0.1), (W - 0.02 + fl, split - 0.13),
            (W - 0.006 + fl, split), (W + 0.01 + fl * 0.4, char), (W - 0.04, SH)]
    floor = [(rows[0][0] * f, BOT) for f in (0.0, 0.18, 0.36, 0.52, 0.66, 0.78, 0.89)] + [rows[0]]
    # top: shoulder roll, the deck edge (the glass base in the greenhouse), the rail (glass top), the roof edge,
    # then the crown to the centre line
    xD = W - 0.065
    top = [(W - 0.032, SH), (W - 0.05, lerp(SH, yD, 0.72))]
    if in_green(B, z):
        yR = max(B["RAIL"](z), yD + 0.004)
        xR = W - B["RIN"](z)
        g = smooth(0.0, 0.12, yR - yD)
        top += [(xD, yD), (xR, yR), (xR - 0.035 - 0.02 * g, yR + 0.028 * g)]
    else:
        top += [(xD, yD), (xD - 0.07, yD + 0.012), (xD - 0.17, yD + 0.026)]
    x3, y3 = top[-1]
    for f in (0.62, 0.3, 0.0):
        top.append((x3 * f, crown - (crown - y3) * f * f))
    return floor, rows[1:6], top   # top: shoulder (index 7 of the column numbering) ... centre (0)


def zlean(B, y, end):
    """How far a point at height y on the end ring sits back from the station: the nose and tail lean in at the top."""
    if end > 0:
        return curve([(-0.2, 0.05), (-0.05, 0.0), (0.2, 0.0), (0.34, 0.015), (0.44, 0.05)])(y)
    return curve([(-0.2, 0.06), (-0.08, 0.0), (0.16, -0.012), (0.3, 0.0), (0.45, 0.02), (0.62, 0.09)])(y)


def build_cage(B):
    """Half the body as a quad cage (x >= 0) with a material per face; returns the mesh."""
    zs = B["zs"]
    K = len(zs)
    verts, faces, fmat = [], [], []
    rings = []
    for k, z in enumerate(zs):
        floor, side, top = section(B, z)
        ring2 = floor + side + top   # 8 + 5 + 8 = 21 points
        end = 1 if k == K - 1 else (-1 if k == 0 else 0)
        near = 1 if k == K - 2 else (-1 if k == 1 else 0)
        pts = []
        for (x, y) in ring2:
            zz = z
            if end:
                zz = z - end * zlean(B, y, end)
            elif near:
                zz = z - near * 0.4 * zlean(B, y, near)
            pts.append((x, y, zz))
        rings.append(len(verts))
        verts += pts
    L = 21

    def ring_mat(k, i):
        """Material of the quad between stations k, k+1 and ring points i, i+1."""
        z0, z1 = zs[k], zs[k + 1]
        zm = (z0 + z1) / 2
        if i < 7:
            return "under"
        if i < 13:   # side wall bands: 7 (rocker underside) .. 12 (char line to shoulder)
            band = i - 7   # 0 r0-r1, 1 r1-r2, 2 r2-r3, 3 r3-r4 (split), 4 r4-r5, 5 r5-r6
            if B["cladding"] and band < 3:
                return "cladding"
            return "paintL" if band < 4 else "paintU"
        c = 20 - i   # top band between column c and c-1 (c = 7 shoulder ... 1)
        if c >= 6:
            return "paintU"
        if c == 5:   # c5-c4: side glass between the deck edge and the rail
            if not (in_green(B, z0) or in_green(B, z1)) or z0 < B["zD"] - 1e-6 or z1 > B["zC"] + 1e-6:
                return "paintU"
            for a, b in B["blackouts"]:
                if z0 >= a - 1e-6 and z1 <= b + 1e-6:
                    return "gloss"
            for a, b in B["windows"]:
                if z0 >= a - 1e-6 and z1 <= b + 1e-6:
                    return "glass"
            return "paintU"
        if c == 4:
            return "paintU"
        # c <= 3: the middle of the top
        if B["zH"] - 1e-6 <= z0 and z1 <= B["zC"] + 1e-6:
            return "glass"
        if B["zD"] - 1e-6 <= z0 and z1 <= B["zRH"] + 1e-6:
            return "glassDark"
        return "paintU"

    for k in range(K - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(L - 1):
            faces.append((a + i, b + i, b + i + 1, a + i + 1))
            fmat.append(ring_mat(k, i))

    # end caps: an 8 x 7 grid (columns centre -> side, rows floor -> top) by a Coons patch of the ring
    for end in (1, -1):
        k = K - 1 if end > 0 else 0
        base = rings[k]
        R = [Vector(verts[base + i]) for i in range(L)]
        F = R[0:8]                           # floor, centre -> corner
        S = [R[7]] + R[8:13] + [R[13]]       # side rows 0..6 (corner .. shoulder)
        T = list(reversed(R[13:21]))         # top, centre -> shoulder
        C = [Vector((0.0, lerp(F[0].y, T[0].y, j / 6), lerp(F[0].z, T[0].z, j / 6))) for j in range(NR)]
        # centre line heights follow the side rows' spacing
        for j in range(1, NR - 1):
            t = (S[j].y - S[0].y) / (S[6].y - S[0].y)
            C[j] = Vector((0.0, lerp(F[0].y, T[0].y, t), S[j].z + (lerp(F[0].z, T[0].z, t) - lerp(S[0].z, S[6].z, t))))
        grid = {}
        for i in range(NC):
            for j in range(NR):
                if j == 0:
                    grid[i, j] = base + i
                elif j == NR - 1:
                    grid[i, j] = base + 20 - i
                elif i == NC - 1:
                    grid[i, j] = base + 7 + j
                else:
                    s = i / (NC - 1)
                    tt = (S[j].y - S[0].y) / (S[6].y - S[0].y)
                    p = (F[i] * (1 - tt) + T[i] * tt) + (C[j] * (1 - s) + S[j] * s) \
                        - ((F[0] * (1 - s) + F[7] * s) * (1 - tt) + (T[0] * (1 - s) + T[7] * s) * tt)
                    # the fascia bulges out a little between the corners
                    p.z += end * 0.015 * math.sin(math.pi * tt) * (1 - s * s)
                    grid[i, j] = len(verts)
                    verts.append(tuple(p))
        for i in range(NC - 1):
            for j in range(NR - 1):
                q = (grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1])
                faces.append(q if end > 0 else tuple(reversed(q)))
                y = (verts[q[0]][1] + verts[q[2]][1]) / 2
                split = min(B["SPLIT"](B["zF"] if end > 0 else B["zR"]), B["SH"](B["zF"] if end > 0 else B["zR"]) - 0.14)
                low = "cladding" if B["cladding"] else "black"
                fmat.append(low if j == 0 or ((end < 0 or B["cladding"]) and j == 1) else ("paintL" if y < split else "paintU"))
    return verts, faces, fmat


# ---- Blender plumbing ----------------------------------------------------------------------------------------

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = G2B
    return ob


def obj_from(name, verts, faces, mats, uvs=None, smooth_shade=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    names = sorted(set(mats), key=list(MATS).index)
    for n in names:
        me.materials.append(M[n])
    for p, n in zip(me.polygons, mats):
        p.material_index = names.index(n)
        p.use_smooth = smooth_shade
    if uvs is not None:
        lay = me.uv_layers.new(name="UVMap")
        for p in me.polygons:
            for li, vi in zip(p.loop_indices, p.vertices):
                lay.data[li].uv = uvs[vi]
    else:
        me.uv_layers.new(name="UVMap")
    me.validate()
    return link(bpy.data.objects.new(name, me))


def bake(ob):
    """Apply every modifier (a fresh mesh from the evaluated object)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def mat_index(ob, name):
    mats = ob.data.materials
    for i, m in enumerate(mats):
        if m.name == name:
            return i
    mats.append(M[name])
    return len(mats) - 1


def remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


# ---- body operations ----------------------------------------------------------------------------------------

def crease(ob, B):
    """Edge creases on the cage: the character line and the shoulder along the sides, the bonnet and boot edges,
    the rear bumper's top edge across the tail - the lines a real body is drawn with."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    cl = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
    bm.verts.ensure_lookup_table()
    K = len(B["zs"])
    ring = lambda k, i: k * 21 + i
    want = {12: 0.75, 15: 0.45, 11: 0.35}   # ring point -> crease: char line, deck edge (glass base), colour split
    lines = {}
    for k in range(K - 1):
        for i, w in want.items():
            lines[frozenset((ring(k, i), ring(k + 1, i)))] = w
    for e in bm.edges:
        key = frozenset((e.verts[0].index, e.verts[1].index))
        if key in lines:
            e[cl] = lines[key]
    # the end rings: the nose's and tail's corners and the bonnet's leading edge drawn crisper
    for k, w_side, w_top in ((K - 1, 0.45, 0.65), (0, 0.4, 0.5)):
        for i in range(7, 20):
            e = bm.edges.get((bm.verts[ring(k, i)], bm.verts[ring(k, i + 1)]))
            if e is not None:
                e[cl] = max(e[cl], w_side if i < 13 else w_top)
    # across the end caps: the rows at the colour split carry the bumper's top edge
    for e in bm.edges:
        a, b = e.verts
        if a.index >= K * 21 and b.index >= K * 21 and abs(a.co.y - b.co.y) < 0.02 and abs(a.co.x - b.co.x) > 0.01:
            y = (a.co.y + b.co.y) / 2
            if abs(y - B["SPLIT"](B["zR"])) < 0.02 and a.co.z < 0:
                e[cl] = 0.6
    bm.to_mesh(ob.data)
    bm.free()


def inset_glass(ob, B):
    """Inset each window region into a black rubber frame, the glass set back from the paint."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gi = {mat_index(ob, "glass"), mat_index(ob, "glassDark")}
    black = mat_index(ob, "black")
    faces = [f for f in bm.faces if f.material_index in gi]
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=0.016, depth=-0.012, use_even_offset=True, use_boundary=True)
    for f in res["faces"]:
        f.material_index = black
    bm.to_mesh(ob.data)
    bm.free()


def boolean(ob, cutters):
    col = bpy.data.collections.new("cutters")
    bpy.context.scene.collection.children.link(col)
    for c in cutters:
        for u in list(c.users_collection):
            u.objects.unlink(c)
        col.objects.link(c)
    md = ob.modifiers.new("cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.solver = "EXACT"
    md.operand_type = "COLLECTION"
    md.collection = col
    if hasattr(md, "material_mode"):
        md.material_mode = "TRANSFER"
    bake(ob)
    for c in list(col.objects):
        remove(c)
    bpy.data.collections.remove(col)


def arch_cutter(B, zw, seg):
    r, yc = B["arch"], B["archY"]
    verts, faces = [], []
    for s in (1.4, -1.4):
        for k in range(seg):
            a = 2 * math.pi * k / seg
            verts.append((s, yc + r * math.sin(a), zw + r * math.cos(a)))
    for k in range(seg):
        j = (k + 1) % seg
        faces.append((k, j, seg + j, seg + k))
    faces.append(tuple(range(seg))[::-1])
    faces.append(tuple(range(seg, 2 * seg)))
    ob = obj_from("arch", verts, faces, ["liner"] * len(faces))
    fix_normals(ob)
    return ob


def prism_cutter(name, outline, z_front, z_back, floor_mat, wall_mat, end):
    """A prism along z over a centre-line-symmetric outline [(x >= 0, y)], mirrored; the floor at z_back gets UVs 0..1
    (u from the outer edge, 0, to the centre, 1 - the atlas' grille and intake run that way), the walls `wall_mat`."""
    half = [(x, y) for x, y in outline]
    ring = half + [(-x, y) for x, y in reversed(half) if x > 1e-6]
    # a clean ring: drop the duplicated centre points
    pts = []
    for p in ring:
        if not pts or (abs(pts[-1][0] - p[0]) > 1e-6 or abs(pts[-1][1] - p[1]) > 1e-6):
            pts.append(p)
    n = len(pts)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    xm, y0, y1 = max(xs), min(ys), max(ys)
    verts = [(x, y, z_front) for x, y in pts] + [(x, y, z_back) for x, y in pts]
    faces, mats, uvs = [], [], {}
    for k in range(n):
        j = (k + 1) % n
        faces.append((k, j, n + j, n + k))
        mats.append(wall_mat)
    faces.append(tuple(range(n)))
    mats.append(wall_mat)
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))
    mats.append(floor_mat)
    uv = [(0.5, 0.5)] * (2 * n)
    for k, (x, y) in enumerate(pts):
        uv[n + k] = (1 - abs(x) / xm, (y - y0) / (y1 - y0))
    ob = obj_from(name, verts, faces, mats, uvs=uv)
    fix_normals(ob)
    return ob


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


class Surface:
    """Ray casts onto the finished body shell (game frame)."""

    def __init__(self, ob):
        self.bm = bmesh.new()
        self.bm.from_mesh(ob.data)
        self.tree = BVHTree.FromBMesh(self.bm)

    def hit(self, p, d):
        d = Vector(d).normalized()
        o = Vector(p) - d * 3.0
        loc, nor, _, _ = self.tree.ray_cast(o, d, 6.0)
        return (loc, nor) if loc is not None else (None, None)


def decal(surf, name, mat, nu, nv, place, uvf, offset=0.003, bulge=0.0, flip=False):
    """A grid (nu x nv) laid on the body: place(s, t) -> (origin, direction) of a ray from outside; uvf(s, t) -> uv."""
    verts, uvs, faces = [], [], []
    hits = {}
    for i in range(nu + 1):
        for j in range(nv + 1):
            o, d = place(i / nu, j / nv)
            loc, nor = surf.hit(o, d)
            if loc is not None:
                hits[i, j] = (loc, nor)
    for i in range(nu + 1):
        for j in range(nv + 1):
            s, t = i / nu, j / nv
            if (i, j) in hits:
                loc, nor = hits[i, j]
            else:
                # a ray that missed the body (over an opening) takes the nearest one that did not
                near = min(hits, key=lambda k: abs(k[0] - i) * 4 + abs(k[1] - j), default=None)
                if near is None:
                    o, d = place(s, t)
                    loc, nor = Vector(o), -Vector(d)
                else:
                    loc, nor = hits[near]
            off = offset + bulge * math.sin(math.pi * s) * math.sin(math.pi * t)
            verts.append(loc + nor * off)
            uvs.append(uvf(s, t))
    for i in range(nu):
        for j in range(nv):
            a, b = i * (nv + 1) + j, (i + 1) * (nv + 1) + j
            q = (a, b, b + 1, a + 1)
            faces.append(tuple(reversed(q)) if flip else q)
    ob = obj_from(name, verts, faces, [mat] * len(faces), uvs=uvs)
    orient_out(ob, surf)
    return ob


def orient_out(ob, surf):
    """Turn every face of a decal to face the same way as the body under it."""
    me = ob.data
    flips = 0
    for p in me.polygons:
        c = p.center
        loc, nor, _, _ = surf.tree.find_nearest(c)
        if nor is not None and p.normal.dot(nor) < 0:
            flips += 1
    if flips > len(me.polygons) / 2:
        bm = bmesh.new()
        bm.from_mesh(me)
        for f in bm.faces:
            f.normal_flip()
        bm.to_mesh(me)
        bm.free()


def strip(surf, name, mat, pts, width, dirf, offset=0.0015, n=None):
    """A thin band along a polyline of ray origins on the body (dirf(p) -> ray direction), `width` wide."""
    # resample the polyline evenly
    P = [Vector(p) for p in pts]
    L = [0.0]
    for a, b in zip(P, P[1:]):
        L.append(L[-1] + (b - a).length)
    n = n or max(2, int(L[-1] / 0.05))
    samples = []
    for i in range(n + 1):
        s = L[-1] * i / n
        k = 0
        while k < len(P) - 2 and L[k + 1] < s:
            k += 1
        t = (s - L[k]) / max(1e-9, L[k + 1] - L[k])
        samples.append(P[k].lerp(P[k + 1], t))
    verts, faces = [], []
    for i, p in enumerate(samples):
        d = Vector(dirf(p))
        loc, nor = surf.hit(p, d)
        if loc is None:
            continue
        tan = (samples[min(i + 1, n)] - samples[max(i - 1, 0)]).normalized()
        side = tan.cross(nor).normalized() * (width / 2)
        verts += [loc + nor * offset - side, loc + nor * offset + side]
    for i in range(len(verts) // 2 - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    ob = obj_from(name, verts, faces, [mat] * len(faces))
    orient_out(ob, surf)
    return ob


def rbox(name, c, size, mat, bevel=0.01, seg=2, rot=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=seg, affect="EDGES", profile=0.5)
    R = Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[2], 4, "Z")
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(c)) @ R, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    for p in me.polygons:
        p.use_smooth = True
    return link(bpy.data.objects.new(name, me))


# ---- the build ---------------------------------------------------------------------------------------------

def build_level(B, grp, level):
    hi = grp == "hi"
    verts, faces, fmat = build_cage(B)
    body = obj_from(f"{grp}__body", verts, faces, fmat)
    fix_normals(body)
    crease(body, B)
    mm = body.modifiers.new("mirror", "MIRROR")
    mm.use_axis[0] = True
    mm.use_clip = True
    mm.use_mirror_merge = True
    mm.merge_threshold = 0.001
    sd = body.modifiers.new("sub", "SUBSURF")
    sd.levels = sd.render_levels = level
    sd.boundary_smooth = "PRESERVE_CORNERS"
    bake(body)
    fix_normals(body)
    inset_glass(body, B)
    # wheel arches, the grille and the lower intake: the cutters' faces become the wells and the pocket floors
    zF, zR = B["zF"], B["zR"]
    cut = [arch_cutter(B, zw, 40 if hi else 20) for zw in B["wheels"]]
    cut.append(prism_cutter("grille", B["grille"], zF + 0.5, zF - 0.075, "grille", "black", 1))
    cut.append(prism_cutter("intake", B["intake"], zF + 0.5, zF - 0.08, "intake", "black", 1))
    boolean(body, cut)
    # the floor was only there to close the shell for the booleans: a flat underside takes its place
    bm = bmesh.new()
    bm.from_mesh(body.data)
    under = mat_index(body, "under")
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == under], context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    for p in body.data.polygons:
        p.use_smooth = True
    body.data.set_sharp_from_angle(angle=math.radians(38))
    surf = Surface(body)
    parts = [body]

    # lamps: grids in (angle round a point on the centre line, height), cast from outside inwards
    def around(zc, rear):
        def place(a, y, side):
            d = Vector((side * math.sin(a), 0.0, (-1 if rear else 1) * math.cos(a)))
            return Vector((0.0, y, zc)) + d * 2.5, -d
        return place

    nu, nv = (26, 5) if hi else (10, 2)
    for side in (1, -1):
        h = B["head"]
        pl = around(h["zc"], False)
        # head: u = 0 at the outer end
        parts.append(decal(surf, f"{grp}__head{side}", "head", nu, nv,
                           lambda s, t, h=h, pl=pl, side=side: pl(lerp(h["a0"], h["a1"], s), lerp(h["y0"](s), h["y1"](s), t), side),
                           lambda s, t: (1 - s, t), offset=0.003, bulge=0.008))
        tl = B["tail"]
        pr = around(tl["zc"], True)
        # tail: u = 0 at the inner end, 1 wrapping onto the side
        parts.append(decal(surf, f"{grp}__tail{side}", "tail", nu, nv,
                           lambda s, t, tl=tl, pr=pr, side=side: pr(lerp(tl["a0"], tl["a1"], s), lerp(tl["y0"](s), tl["y1"](s), t), side),
                           lambda s, t: (s, t), offset=0.003, bulge=0.006))
        # red reflectors at the corners of the rear bumper
        parts.append(decal(surf, f"{grp}__refl{side}", "tail", 2, 1,
                           lambda s, t, side=side: (Vector((side * lerp(0.6, 0.74, s), lerp(-0.03, 0.0, t), zR - 2.0)), Vector((0, 0, 1))),
                           lambda s, t: (0.35 + 0.3 * s, 0.4 + 0.2 * t), offset=0.002))
        # reverse lamps low on the bumper, amber repeaters on the front wings
        parts.append(decal(surf, f"{grp}__rev{side}", "reverse", 2, 1,
                           lambda s, t, side=side: (Vector((side * lerp(0.3, 0.44, s), lerp(-0.035, -0.005, t), zR - 2.0)), Vector((0, 0, 1))),
                           lambda s, t: (s, t), offset=0.002))
        parts.append(decal(surf, f"{grp}__amb{side}", "amber", 2, 1,
                           lambda s, t, side=side: (Vector((side * 2.0, B["char"] - 0.07 + 0.03 * t, B["wheels"][0] + lerp(0.32, 0.42, s))), Vector((-side, 0, 0))),
                           lambda s, t: (s, t), offset=0.002))
    if B["cladding"]:
        # black plastic round the arches, laid on like the lamps
        for zw in B["wheels"]:
            for side in (1, -1):
                r0, r1 = B["arch"] + 0.004, B["arch"] + 0.08
                def pl(s, t, zw=zw, side=side):
                    a = -0.25 + (math.pi + 0.5) * s
                    rr = lerp(r0, r1, t)
                    return Vector((side * 2.0, B["archY"] + math.sin(a) * rr, zw + math.cos(a) * rr)), Vector((-side, 0, 0))
                parts.append(decal(surf, f"{grp}__archtrim", "cladding", 28 if hi else 12, 1, pl, lambda s, t: (s, t), offset=0.006))
    # the high brake lamp at the top of the rear screen (cast from behind), plates, the boot badge
    rh = B["zRH"]
    yb = B["CROWN"](rh) - 0.035
    parts.append(decal(surf, f"{grp}__brake", "brake", 4, 1,
                       lambda s, t: (Vector((lerp(0.26, -0.26, s), yb - 0.035 * (1 - t), zR - 2.0)), Vector((0, 0, 1))),
                       lambda s, t: (s, t), offset=0.004))
    px, pw, ph = B["plateF"]
    parts.append(decal(surf, f"{grp}__plateF", "plateF", 2, 1,
                       lambda s, t: (Vector((lerp(-pw / 2, pw / 2, s), lerp(px, px + ph, t), zF + 2.0)), Vector((0, 0, -1))),
                       lambda s, t: (s, t), offset=0.012))
    px, pw, ph = B["plateR"]
    parts.append(decal(surf, f"{grp}__plateR", "plateR", 2, 1,
                       lambda s, t: (Vector((lerp(pw / 2, -pw / 2, s), lerp(px, px + ph, t), zR - 2.0)), Vector((0, 0, 1))),
                       lambda s, t: (s, t), offset=0.006))
    parts.append(decal(surf, f"{grp}__badge", "badge", 2, 1,
                       lambda s, t: (Vector((lerp(0.07, -0.07, s), lerp(0.47, 0.52, t), zR - 2.0)), Vector((0, 0, 1))),
                       lambda s, t: (s, t), offset=0.004))
    # a black lower lip under the front bumper and a diffuser band at the back
    if hi:
        for side in (1, -1):
            for pts in B["seams"]:
                parts.append(strip(surf, f"{grp}__seam", "seam", [(side * 2.0, y, z) for z, y in pts], 0.006, lambda p, side=side: (-side, 0, 0)))
        for pts in B["top_seams"]:
            for side in (1, -1):
                parts.append(strip(surf, f"{grp}__tseam", "seam", [(side * x, 2.0, z) for x, z in pts], 0.006, lambda p: (0, -1, 0)))
    # chrome along the base of the side glass
    for side in ((1, -1) if B["belt"] else ()):
        z0, z1 = min(w[0] for w in B["windows"]) + 0.02, max(w[1] for w in B["windows"]) - 0.03
        zs = [lerp(z0, z1, i / 8) for i in range(9)]
        parts.append(strip(surf, f"{grp}__belt", "chrome", [(side * 2.0, B["DECK"](z) - 0.018, z) for z in zs], 0.014, lambda p, side=side: (-side, 0, 0), offset=0.002))
    # mirrors: a body-coloured housing on a black foot, the glass facing back
    for side in (1, -1):
        z = B["mirrorZ"]
        y = B["DECK"](z) + 0.05
        loc, nor = surf.hit((side * 2.0, y, z), (-side, 0, 0))
        if loc is None:
            continue
        c = loc + Vector((side * 0.14, 0.05, -0.03))
        parts.append(rbox(f"{grp}__mirror", c, (0.2, 0.11, 0.09), "paintU", bevel=0.035 if hi else 0.02, seg=3 if hi else 1, rot=(0, side * 0.08, 0)))
        parts.append(rbox(f"{grp}__mglass", c + Vector((side * 0.004, 0, -0.047)), (0.17, 0.085, 0.004), "glassDark", bevel=0.0, rot=(0, side * 0.08, 0)))
        parts.append(rbox(f"{grp}__mfoot", loc + Vector((side * 0.05, 0.02, -0.01)), (0.1, 0.035, 0.08), "black", bevel=0.01 if hi else 0.0, seg=1))
    if hi:
        # door handles, wipers, the exhaust, the aerial
        for side in (1, -1):
            for z in B["handles"]:
                loc, nor = surf.hit((side * 2.0, B["handleY"], z), (-side, 0, 0))
                if loc is not None:
                    parts.append(rbox(f"{grp}__handle", loc + nor * 0.012, (0.03, 0.028, 0.15), "chrome", bevel=0.012, seg=2))
        zc = B["zC"]
        for x, ln, yaw in ((0.28, 0.62, 0.12), (-0.3, 0.55, -0.12)):
            loc, _ = surf.hit((x, 2.0, zc - 0.05), (0, -1, 0))
            if loc is not None:
                parts.append(rbox(f"{grp}__wiper", loc + Vector((0, 0.012, 0)), (ln, 0.012, 0.018), "black", bevel=0.0, rot=(0, yaw, 0)))
        loc, _ = surf.hit((0, 2.0, B["zRH"] + 0.12), (0, -1, 0))
        if loc is not None:
            parts.append(rbox(f"{grp}__fin", loc + Vector((0, 0.03, 0)), (0.07, 0.06, 0.18), "black", bevel=0.025, seg=2))
    # the underside: a flat tray between the wheel wells
    yb = B["BOT"](0.0) + 0.006
    zw = sorted(B["wheels"])
    r = B["arch"]
    xs = B["W"](0.0) - 0.12
    uv, uf = [], []
    for a, b, w in ((zR + 0.15, zw[0] - r, xs), (zw[0] - r, zw[0] + r, 0.5), (zw[0] + r, zw[1] - r, xs), (zw[1] - r, zw[1] + r, 0.5), (zw[1] + r, zF - 0.15, xs)):
        n = len(uv)
        uv += [(w, yb, a), (-w, yb, a), (-w, yb, b), (w, yb, b)]
        uf.append((n + 3, n + 2, n + 1, n))
    parts.append(obj_from(f"{grp}__floor", uv, uf, ["under"] * len(uf)))
    if B["rails"]:
        # roof rails: satin bars on black feet along the roof's edges
        for side in (1, -1):
            z0, z1 = B["zRH"] + 0.1, B["zH"] - 0.08
            pts = []
            for i in range(7):
                z = lerp(z0, z1, i / 6)
                x = B["W"](z) - B["RIN"](z) - 0.07
                loc, _ = surf.hit((side * x, 2.0, z), (0, -1, 0))
                if loc is not None:
                    pts.append(loc)
            for a_, b_ in zip(pts, pts[1:]):
                c = (a_ + b_) / 2 + Vector((0, 0.045, 0))
                ln = (b_ - a_).length + 0.01
                parts.append(rbox(f"{grp}__rail", c, (0.035, 0.03, ln), "satin", bevel=0.01 if hi else 0.0, seg=1, rot=(math.atan2(a_.y - b_.y, b_.z - a_.z), 0, 0)))
            for q in (pts[0], pts[-1]):
                parts.append(rbox(f"{grp}__railfoot", q + Vector((0, 0.022, 0)), (0.05, 0.05, 0.09), "black", bevel=0.0))
    if B["spoiler"]:
        loc, _ = surf.hit((0, 2.0, B["zRH"] + 0.02), (0, -1, 0))
        if loc is not None:
            w = 2 * (B["W"](B["zRH"]) - B["RIN"](B["zRH"])) - 0.12
            parts.append(rbox(f"{grp}__spoiler", loc + Vector((0, -0.004, -0.06)), (w, 0.03, 0.15), "paintU", bevel=0.01 if hi else 0.0, seg=1, rot=(0.1, 0, 0)))
    parts.append(rbox(f"{grp}__exhaust", (-0.52, B["BOT"](zR + 0.05) + 0.04, zR + 0.03), (0.1, 0.05, 0.12), "satin", bevel=0.02, seg=2 if hi else 1))
    return parts, surf


def build_door(B, surf):
    """The livery's door lettering: a strip conforming to the doors, low (taxi) and high (police)."""
    z0, z1 = B["door"]
    split = B["SPLIT"](0.0)
    for grp, y0 in (("doorLow", (split - 0.07) / 2 - 0.035), ("doorHigh", split + 0.03)):
        for side in (1, -1):
            # +X (left) side reads front to back: u = 0 at the front
            decal(surf, f"{grp}__{side}", "door", 16, 4,
                  lambda s, t, side=side, y0=y0: (Vector((side * 2.0, lerp(y0, y0 + 0.14, t), lerp(z1, z0, s) if side > 0 else lerp(z0, z1, s))), Vector((-side, 0, 0))),
                  lambda s, t: (s, t), offset=0.004)


def build():
    clear_file()
    for k, (col, rough, metal) in MATS.items():
        M[k] = material(k, col, rough, metal)
    B = BODIES[TYPE]()
    _, surf = build_level(B, "hi", 2)
    build_door(B, surf)
    build_level(B, "lo", 1)
    return len(bpy.data.objects)


def export():
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, use_selection=False)
    print("exported", OUT)


if __name__ == "__main__":
    print("built", build(), "objects")
    export()
