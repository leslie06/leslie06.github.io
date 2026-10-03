# 中华世纪坛 China Millennium Monument (2000), west of 军事博物馆 between 复兴路 and 玉渊潭, built in Blender and
# marked with the bcity_landmark add-on's conventions (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/shijitan.py -- [--out art/landmarks/shijitan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the round altar, game
# (-7027.3, -162.0), heading 0 (OSM way 127467616 - one outline for the altar, the strip of the bronze path and the
# fire plaza, layer=1 - runs within 0.2 deg of north-south; the city drew it as one long block).
#
# The figures (zh/en Wikipedia, 首都之窗): the altar 85 m across and 28 m high, the 坤 a truncated cone of granite
# (the 回廊 and the 世纪大厅 inside it), on it the 乾 - a disc 47 m across tilted 19.4 deg facing due south that turns
# once every few hours - and the 时空探针, a 27.6 m needle at 45 deg, its tip ~39 m up; 40 bronze statues of
# cultural figures on the ring round the disc. South of it the 青铜甬道, 3 m wide and 262 m long, bronze plates (one
# a year), a strip of running water either side, walks and lawns; at the south end the sunken 圣火广场 with the
# square fire platform and the 中华圣火. The ground cannot be cut, so the sunken plaza is a floor ringed by four
# steps up to a rim 1 m high and a grassed bank back down (the bank is solid; cars ride over it). 玉渊潭南路 runs
# under the axis in a 34 m tunnel the city cannot sink and the drop-off loop crosses it, both on the ground just south
# of the cone, so the path starts south of them and the stair is cut into the cone's south side. Doubtful: that
# stair (its width and run), the base's height (9 m, chosen so the disc's high edge is at 28 m), the relief band's height on the cone, the needle's azimuth (the disc turns; it is drawn rising to
# the north-north-east), where the statues stand.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_box, collider_pts, cyl, ell, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from zhengyangmen import steps_ramp  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "shijitan.blend")

R0, R1, H0 = 42.5, 40.5, 9.0          # the cone: radius at the ground, at the top platform; the platform's height
PAR = dict(r0=39.8, r1=40.5, h=1.1)    # the parapet round the platform
DISC = dict(R=23.5, t=1.8, tilt=19.4, z=20.2)   # the 乾: radius, thickness, tilt, its top's centre height
DRUM_R = 14.0
CURB = dict(r0=25.0, r1=25.6, h=0.5)
NEEDLE = dict(L=27.6, el=45.0, az=25.0)         # length, elevation, azimuth from north towards east
# The stair is cut into the cone's south side (a notch |x| < w from its foot to STAIR_TOP): 玉渊潭南路 and the
# drop-off loop cross the axis on the ground just south of the cone (OSM's tunnel there is too short for the city
# to sink), so nothing may stand south of the cone's foot.
STAIR = dict(w=9.0, rise=0.15, run=0.3)
STAIR_N = round(H0 / STAIR["rise"])
STAIR_LOW = -R0 - 0.5                            # the stair's foot (y)
STAIR_TOP = STAIR_LOW + STAIR_N * STAIR["run"]   # where it comes out on the platform
STATUES = dict(n=40, r=32.5, gap=40.0)          # the statues on the ring, a gap (deg) at the stair
PLAZA = dict(y=-391.0, floor=14.0, rim=18.5, bank=22.5, h=1.0, steps=4, gate=4.5)
PATH = dict(y1=-88.0, y0=PLAZA["y"] + PLAZA["bank"] - 1.0)   # the bronze path: from south of the roads to the plaza
STRIP = 16.5                          # the strip's half width (OSM's outline)
SEGS = 64


# --- textures ------------------------------------------------------------------------------------------

def granite_image(size=512):
    """The cone's granite (8 m round by 4 m up a repeat): courses 1 m high, blocks 2 m long, offset."""
    cv = Canvas(size, size, "#bdb5a8")
    cv.noise(0.08, 3)
    q = size / 4
    rows = (cv.y // q).astype(int)
    rng = np.random.default_rng(7)
    tint = rng.uniform(0.94, 1.05, (5, 9))
    cols = (np.mod(cv.x + (rows % 2) * q / 2, size) // (size / 4)).astype(int)
    cv.a *= tint[rows, cols][..., None]
    cv.put(np.mod(cv.y, q) < 2.0, "#8f887d")
    cv.put(np.mod(cv.x + (rows % 2) * q / 2, size / 4) < 2.0, "#958e83")
    return image("SJT_Granite", np.flipud(cv.a).copy())


def relief_image(w=1024, h=256):
    """The relief band round the cone (32 m round by 2.4 m a repeat): crowds of figures in low relief, as light and shade."""
    cv = Canvas(w, h, "#b3ab9d")
    rng = np.random.default_rng(12)
    shade = np.zeros((h, w), np.float32)
    for _ in range(260):
        cx, cy = rng.uniform(0, w), rng.uniform(h * 0.25, h * 0.85)
        rx, ry = rng.uniform(6, 14), rng.uniform(30, 70)
        for dx in (-w, 0, w):
            d = (cv.x - cx - dx) / rx, (cv.y - cy) / ry
            m = d[0] ** 2 + d[1] ** 2
            shade += np.where(m < 1, (1 - m) * np.sign(d[0]) * 0.4, 0.0)
            hm = ((cv.x - cx - dx) / (rx * 0.6)) ** 2 + ((cv.y - (cy - ry * 1.1)) / (rx * 0.6)) ** 2
            shade += np.where(hm < 1, (1 - hm) * np.sign(cv.x - cx - dx) * 0.35, 0.0)
    cv.a *= (1 - 0.35 * np.clip(shade, -1, 1))[..., None]
    cv.put((cv.y < 10) | (cv.y > h - 10), "#c4bdb0")
    cv.put((np.abs(cv.y - 10) < 2) | (np.abs(cv.y - (h - 10)) < 2), "#8a8377")
    return image("SJT_Relief", np.flipud(cv.a).copy())


def dial_image(size=1024):
    """The disc's top as a dial: dark granite, rings, hour lines, the ticks round the rim; UV (0..1) over the disc."""
    cv = Canvas(size, size, "#46484a")
    cv.noise(0.06, 9)
    c = size / 2
    X, Y = cv.x - c, cv.y - c
    r = np.hypot(X, Y) / c
    a = np.arctan2(Y, X)
    cv.put((r > 0.9) & (r <= 1.0), "#6a6b69")
    cv.put(np.abs(r - 0.9) < 0.006, "#b2ab9c")
    cv.put(np.abs(r - 0.6) < 0.005, "#a39d90")
    cv.put(np.abs(r - 0.3) < 0.005, "#a39d90")
    hours = np.abs(np.mod(a / (2 * np.pi) * 24 + 0.5, 1) - 0.5) * 2 * np.pi / 24 * r * c < 1.6
    cv.put(hours & (r > 0.3) & (r < 0.9), "#9e988b")
    ticks = np.abs(np.mod(a / (2 * np.pi) * 96 + 0.5, 1) - 0.5) * 2 * np.pi / 96 * r * c < 1.4
    cv.put(ticks & (r > 0.92) & (r < 0.97), "#c4bca8")
    cv.put(r < 0.12, "#7a6040")
    cv.put(np.abs(r - 0.12) < 0.004, "#c9a45c")
    return image("SJT_Dial", np.flipud(cv.a).copy())


def plaque_image(size=256):
    """The bronze path (3 m wide, 3 m a repeat): rows of plates, each with lines of inscription."""
    cv = Canvas(size, size, "#7d6040")
    cv.noise(0.12, 14)
    y, x = cv.y / size, cv.x / size
    row = np.mod(y * 6, 1)
    cv.put(row < 0.035, "#4d3a24")
    cv.put((x < 0.03) | (x > 0.97), "#5a452c")
    rng = np.random.default_rng(15)
    glyph = (rng.random((size, size)) > 0.55) & (np.mod(cv.x, 6) < 3.5) & (np.abs(np.mod(y * 18, 1) - 0.5) < 0.2) & (x > 0.12) & (x < 0.88)
    cv.put(glyph & (row > 0.15) & (row < 0.85), "#55412a")
    cv.a *= (1.0 + 0.08 * np.sin(cv.y * 0.9))[..., None]
    return image("SJT_Plaque", np.flipud(cv.a).copy())


def lawn_image(size=256):
    cv = Canvas(size, size, "#62803f")
    u, v = cv.x / size * 2 * math.pi, cv.y / size * 2 * math.pi
    cv.a *= (1 + 0.04 * np.sin(u + 2 * np.sin(v)) + 0.03 * np.sin(2 * v + np.sin(3 * u) + 1.3))[..., None]
    cv.noise(0.22, 42)
    return image("SJT_Lawn", np.flipud(cv.a).copy())


# --- pieces --------------------------------------------------------------------------------------------

def ring(r, z, n=SEGS, a0=0.0):
    return [Vector((r * math.cos(a0 + 2 * math.pi * i / n), r * math.sin(a0 + 2 * math.pi * i / n), z)) for i in range(n)]


def band(g, r0, z0, r1, z1, key, su=8.0, sv=4.0, n=SEGS, skip=None, inward=False):
    """A surface of revolution between two rings, UVs: u round in metres / su, v up in metres / sv."""
    A, B = ring(r0, z0, n), ring(r1, z1, n)
    rm = (r0 + r1) / 2
    for i in range(n):
        k = (i + 1) % n
        am = 2 * math.pi * (i + 0.5) / n
        if skip and skip(am):
            continue
        u0, u1 = rm * 2 * math.pi * i / n / su, rm * 2 * math.pi * (i + 1) / n / su
        out = Vector((math.cos(am), math.sin(am), 0)) * (-1 if inward else 1)
        want = out + Vector((0, 0, (r0 - r1) / max(1e-3, z1 - z0) if z1 != z0 else (1 if r1 < r0 else -1)))
        emit(g, [A[i], A[k], B[k], B[i]], key, tuple(want), uvs=[(u0, z0 / sv), (u1, z0 / sv), (u1, z1 / sv), (u0, z1 / sv)])


def annulus(g, r0, r1, z, key, n=SEGS, skip=None, down=False):
    A, B = ring(r0, z, n), ring(r1, z, n)
    for i in range(n):
        k = (i + 1) % n
        if skip and skip(2 * math.pi * (i + 0.5) / n):
            continue
        emit(g, [A[i], A[k], B[k], B[i]], key, (0, 0, -1 if down else 1))


def at_stair(a, r):
    """Is the ring's angle a (at radius r) in the stair's opening on the south?"""
    return math.sin(a) < 0 and abs(r * math.cos(a)) < STAIR["w"] + 0.8


def clip(pts, uvs, nx, ny, b):
    """The part of a polygon (3-D points, optional UVs) where nx * x + ny * y <= b."""
    out, ouv = [], []
    n = len(pts)
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        dp, dq = nx * p.x + ny * p.y - b, nx * q.x + ny * q.y - b
        if dp <= 0:
            out.append(p)
            if uvs:
                ouv.append(uvs[i])
        if (dp < 0 < dq) or (dq < 0 < dp):
            t = dp / (dp - dq)
            out.append(p.lerp(q, t))
            if uvs:
                a, c = uvs[i], uvs[(i + 1) % n]
                ouv.append((a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t))
    return out, (ouv if uvs else None)


def outside_notch(pts, uvs=None):
    """A polygon split into its parts outside the stair's notch (|x| < w, y < STAIR_TOP)."""
    pts = [Vector(p) for p in pts]
    W = STAIR["w"]
    if min(p.y for p in pts) >= STAIR_TOP - 1e-6 or min(p.x for p in pts) >= W - 1e-6 or max(p.x for p in pts) <= -W + 1e-6:
        return [(pts, uvs)]
    parts = [clip(pts, uvs, 1, 0, -W), clip(pts, uvs, -1, 0, -W)]
    a = clip(*clip(pts, uvs, -1, 0, W), 1, 0, W)
    parts.append(clip(*a, 0, -1, -STAIR_TOP))
    return [(p, u) for p, u in parts if len(p) >= 3]


def emit(g, pts, key, want, uvs=None):
    for p, u in outside_notch(pts, uvs):
        g.polyn(p, key, want, uvs=u)


def disc_matrix():
    return T(0.0, 0.0, DISC["z"]) @ Matrix.Rotation(math.radians(DISC["tilt"]), 4, "X")


def disc(g, n=SEGS, lod=False):
    """The tilted disc: the dial on top, the bronze edge, the underside."""
    M = disc_matrix()
    R, t = DISC["R"], DISC["t"]
    top = [M @ Vector((R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), 0.0)) for i in range(n)]
    bot = [M @ Vector((R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), -t)) for i in range(n)]
    up = M.to_3x3() @ Vector((0, 0, 1))
    if lod:
        g.polyn(top, "dark", tuple(up))
    else:
        c = g.vert(M @ Vector((0, 0, 0.0)))
        ring_i = [g.vert(p) for p in top]
        for i in range(n):
            k = (i + 1) % n
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * k / n
            g.face((c, ring_i[i], ring_i[k]), "dial", uvs=[(0.5, 0.5), (0.5 + 0.5 * math.cos(a0), 0.5 + 0.5 * math.sin(a0)), (0.5 + 0.5 * math.cos(a1), 0.5 + 0.5 * math.sin(a1))])
    g.polyn(bot, "bronze", tuple(-up))
    for i in range(n):
        k = (i + 1) % n
        am = 2 * math.pi * (i + 0.5) / n
        out = M.to_3x3() @ Vector((math.cos(am), math.sin(am), 0))
        g.polyn([bot[i], bot[k], top[k], top[i]], "bronze", tuple(out), uvs=[(i / 4, 0), ((i + 1) / 4, 0), ((i + 1) / 4, 1), (i / 4, 1)])
    if not lod:
        # a raised bronze lip round the dial
        lip_in = [M @ Vector(((R - 0.5) * math.cos(2 * math.pi * i / n), (R - 0.5) * math.sin(2 * math.pi * i / n), 0.25)) for i in range(n)]
        lip_out = [M @ Vector((R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n), 0.25)) for i in range(n)]
        lip_in0 = [M @ Vector(((R - 0.5) * math.cos(2 * math.pi * i / n), (R - 0.5) * math.sin(2 * math.pi * i / n), 0.0)) for i in range(n)]
        for i in range(n):
            k = (i + 1) % n
            g.polyn([lip_in[i], lip_in[k], lip_out[k], lip_out[i]], "bronze", tuple(up))
            g.polyn([top[i], top[k], lip_out[k], lip_out[i]], "bronze", tuple(M.to_3x3() @ Vector((math.cos(2 * math.pi * (i + 0.5) / n), math.sin(2 * math.pi * (i + 0.5) / n), 0))))
            am = 2 * math.pi * (i + 0.5) / n
            g.polyn([lip_in0[i], lip_in0[k], lip_in[k], lip_in[i]], "bronze", tuple(M.to_3x3() @ Vector((-math.cos(am), -math.sin(am), 0))))


def underside_z(x, y):
    """Height of the disc's underside plane over plan point (x, y)."""
    M = disc_matrix()
    n = M.to_3x3() @ Vector((0, 0, 1))
    c = M @ Vector((0, 0, -DISC["t"]))
    return c.z - (n.x * (x - c.x) + n.y * (y - c.y)) / n.z


def needle(g, sides=8, lod=False):
    """The 时空探针: a tapering steel needle from the dial's centre, with a bronze collar."""
    M = disc_matrix()
    base = M @ Vector((0, 0, 0.0))
    el, az = math.radians(NEEDLE["el"]), math.radians(NEEDLE["az"])
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(d).normalized()
    start = base - d * 1.5
    L = NEEDLE["L"] + 1.5
    rings = []
    for t, r in ((0.0, 0.75), (0.08, 0.6), (1.0, 0.04)):
        p = start + d * (L * t)
        rings.append([p + (side * math.cos(2 * math.pi * i / sides) + up * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for i in range(sides):
            k = (i + 1) % sides
            g.poly([A[i], A[k], B[k], B[i]], "steel", smooth=True)
    g.poly(rings[0][::-1], "steel")
    if not lod:
        cyl(g, base.x, base.y, base.z - 0.3, base.z + 0.5, 1.6, 1.3, 16, "bronze", caps=(False, True))
    return base + d * NEEDLE["L"]


def stair(g):
    """The flight cut into the cone's south side: treads and risers, the notch's walls, a parapet along each side."""
    W = STAIR["w"]
    rise, run, n = STAIR["rise"], STAIR["run"], STAIR_N
    for k in range(n):
        ya = STAIR_LOW + k * run
        z0, z1 = k * rise, (k + 1) * rise
        g.polyn([(-W, ya, z0), (W, ya, z0), (W, ya, z1), (-W, ya, z1)], "stone", (0, -1, 0))
        g.polyn([(-W, ya, z1), (W, ya, z1), (W, ya + run, z1), (-W, ya + run, z1)], "pave", (0, 0, 1))
    h = PAR["h"]
    y0, yH = -math.sqrt(R0 ** 2 - W ** 2), -math.sqrt(R1 ** 2 - W ** 2)
    for sx in (-1, 1):
        x, xo = sx * W, sx * (W + 0.6)
        g.polyn([(x, y0, 0.0), (x, yH, H0), (x, yH, H0 + h), (x, STAIR_TOP, H0 + h), (x, STAIR_TOP, 0.0)], "granite", (-sx, 0, 0))
        g.polyn([(xo, yH, H0), (xo, STAIR_TOP, H0), (xo, STAIR_TOP, H0 + h), (xo, yH, H0 + h)], "stone", (sx, 0, 0))
        xa, xb = sorted((x - sx * 0.1, xo + sx * 0.15))
        g.box(xa, xb, yH - 0.15, STAIR_TOP, H0 + h, H0 + h + 0.2, "stone")
        g.polyn([(x, STAIR_TOP, H0), (xo, STAIR_TOP, H0), (xo, STAIR_TOP, H0 + h), (x, STAIR_TOP, H0 + h)], "stone", (0, 1, 0))


def statue_geo():
    """A statue on its pedestal: a granite block and a bronze figure in a long robe (one unit = 1 m)."""
    g = Geo()
    g.box(-0.55, 0.55, -0.55, 0.55, 0.0, 1.1, "stone", skip=("-z",))
    g.box(-0.62, 0.62, -0.62, 0.62, 1.1, 1.2, "stone", skip=())
    cyl(g, 0.0, 0.0, 1.2, 2.55, 0.42, 0.27, 8, "bronze", caps=(False, False))
    cyl(g, 0.0, 0.0, 2.55, 2.7, 0.27, 0.3, 8, "bronze", caps=(False, False))
    cyl(g, 0.0, 0.0, 2.7, 2.78, 0.3, 0.12, 8, "bronze", caps=(False, True))
    ell(g, (0.0, 0.02, 2.95), (0.13, 0.15, 0.18), "bronze", nu=8, nv=5)
    g.box(-0.2, 0.2, 0.2, 0.42, 1.9, 2.15, "bronze", skip=("-z",))      # the hands, a scroll
    return g


def tree_geo():
    g = Geo()
    cyl(g, 0.0, 0.0, 0.0, 2.6, 0.2, 0.15, 6, "bark", caps=(False, False))
    ell(g, (0.0, 0.0, 4.6), (2.3, 2.3, 2.5), "leaf", nu=10, nv=6)
    return g


def plaza(g, lod=False):
    """The fire plaza: the floor, four steps up to the rim, the bank down outside it, gaps on the axis."""
    P = PLAZA
    yc = P["y"]
    n = 72 if not lod else 24
    gap = lambda a: abs(math.cos(a)) * (P["rim"]) < P["gate"] + 0.2   # noqa: E731
    floor = [Vector((p.x, p.y + yc, 0.05)) for p in ring(P["floor"], 0.0, n)]
    g.polyn(floor, "pave", (0, 0, 1))
    rs = [P["floor"] + (P["rim"] - P["floor"]) * k / P["steps"] for k in range(P["steps"] + 1)]
    for k in range(P["steps"]):
        z0, z1 = P["h"] * k / P["steps"] + 0.05, P["h"] * (k + 1) / P["steps"]
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            if gap((a0 + a1) / 2):
                continue
            pa = [Vector((rs[k] * math.cos(a), yc + rs[k] * math.sin(a), 0)) for a in (a0, a1)]
            pb = [Vector((rs[k + 1] * math.cos(a), yc + rs[k + 1] * math.sin(a), 0)) for a in (a0, a1)]
            inward = (-math.cos((a0 + a1) / 2), -math.sin((a0 + a1) / 2), 0)
            if not lod:
                g.polyn([pa[0] + Vector((0, 0, z0)), pa[1] + Vector((0, 0, z0)), pa[1] + Vector((0, 0, z1)), pa[0] + Vector((0, 0, z1))], "stone", inward)
                g.polyn([pa[0] + Vector((0, 0, z1)), pa[1] + Vector((0, 0, z1)), pb[1] + Vector((0, 0, z1)), pb[0] + Vector((0, 0, z1))], "pave", (0, 0, 1))
            elif k == 0:
                g.polyn([pa[0] + Vector((0, 0, 0.05)), pa[1] + Vector((0, 0, 0.05)), Vector((rs[-1] * math.cos(a1), yc + rs[-1] * math.sin(a1), P["h"])),
                         Vector((rs[-1] * math.cos(a0), yc + rs[-1] * math.sin(a0), P["h"]))], "pave", (0, 0, 1))
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        if gap((a0 + a1) / 2):
            continue
        q = [Vector((r * math.cos(a), yc + r * math.sin(a), z)) for r, z, a in ((P["rim"], P["h"], a0), (P["rim"], P["h"], a1), (P["bank"], 0.03, a1), (P["bank"], 0.03, a0))]
        g.polyn(q, "lawn", (0, 0, 1))
        if not lod:
            # the ends of the steps and the bank at the gaps
            for a, nb in ((a0, gap(a0 - 2 * math.pi / n)), (a1, gap(a1 + 2 * math.pi / n))):
                if not nb:
                    continue
                prof = [(P["floor"], 0.05)] + [(rs[k], P["h"] * (k + 1) / P["steps"]) for k in range(P["steps"])] + [(P["rim"], P["h"]), (P["bank"], 0.03)]
                pts = [Vector((r * math.cos(a), yc + r * math.sin(a), z)) for r, z in prof] + [Vector((P["floor"] * math.cos(a), yc + P["floor"] * math.sin(a), 0.03))]
                tang = Vector((-math.sin(a), math.cos(a), 0))
                g.polyn(pts, "stone", tuple(tang * (1 if a == a0 else -1) * -1))


def fire(g):
    """The square fire platform at the plaza's centre: a stepped granite base, the pedestal, the bronze bowl and the flame."""
    yc = PLAZA["y"]
    g.box(-3.0, 3.0, yc - 3.0, yc + 3.0, 0.0, 0.3, "stone", skip=("-z",))
    g.box(-1.5, 1.5, yc - 1.5, yc + 1.5, 0.3, 1.5, "stone", skip=("-z",))
    g.box(-1.7, 1.7, yc - 1.7, yc + 1.7, 1.5, 1.7, "stone", skip=("-z",))
    cyl(g, 0.0, yc, 1.7, 2.1, 0.5, 0.45, 12, "bronze", caps=(False, False))
    from kit import lathe
    lathe(g, [(0.45, 2.1), (0.95, 2.45), (1.15, 2.85), (1.05, 2.9)], 16, "bronze", 0.0, yc)
    cyl(g, 0.0, yc, 2.6, 2.75, 1.0, 1.0, 16, "flame", caps=(False, True))
    lathe(g, [(0.85, 2.7), (0.7, 3.4), (0.35, 4.1), (0.0, 4.6)], 12, "flame", 0.0, yc)


def ground(g, lod=False):
    """The strip: the bronze path between two runs of water, granite walks, lawns, the walks along the lawns."""
    y0, y1 = PATH["y0"], PATH["y1"]
    ys = PATH["y1"]
    if lod:
        g.polyn([(-STRIP, PATH["y0"], 0.03), (STRIP, PATH["y0"], 0.03), (STRIP, ys, 0.03), (-STRIP, ys, 0.03)], "lawn", (0, 0, 1))
        g.polyn([(-5.0, PATH["y0"], 0.05), (5.0, PATH["y0"], 0.05), (5.0, y1, 0.05), (-5.0, y1, 0.05)], "pave", (0, 0, 1))
        return
    L = y1 - y0
    g.polyn([(-1.5, y0, 0.07), (1.5, y0, 0.07), (1.5, y1, 0.07), (-1.5, y1, 0.07)], "plaque", (0, 0, 1),
            uvs=[(0, 0), (1, 0), (1, L / 3.0), (0, L / 3.0)])
    for sx in (-1, 1):
        def strip(a, b, z, key, ya=y0, yb=y1):
            xa, xb = sorted((sx * a, sx * b))
            g.polyn([(xa, ya, z), (xb, ya, z), (xb, yb, z), (xa, yb, z)], key, (0, 0, 1))
        strip(1.5, 1.75, 0.09, "stone")
        strip(1.75, 2.45, 0.04, "water")
        strip(2.45, 2.7, 0.09, "stone")
        strip(2.7, 5.0, 0.06, "pave")
        strip(5.0, 9.0, 0.03, "lawn", ya=y0 - 4.0, yb=ys)
        strip(9.0, 11.5, 0.05, "pave", ya=y0 - 8.0, yb=ys)
        strip(11.5, STRIP, 0.03, "lawn", ya=y0 - 12.0, yb=ys)
        # the stone edges of the water as little kerbs
        for x in (1.75, 2.45):
            g.polyn([(sx * x, y0, 0.04), (sx * x, y1, 0.04), (sx * x, y1, 0.09), (sx * x, y0, 0.09)], "stone", (sx * (1 if x == 2.45 else -1) * -1, 0, 0))


def tree_spots():
    out = []
    for sx in (-1, 1):
        y = PATH["y1"] - 6.0
        while y > PATH["y0"] + 2.0:
            out.append((sx * 13.8, y))
            y -= 10.0
    return out


# --- the monument ----------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    M = dict(
        granite=material("SJT_Granite", "#bdb5a8", 0.7, tex=granite_image(), props={"wet": "damp", "glowStrength": 0.5}),
        relief=material("SJT_Relief", "#b3ab9d", 0.75, tex=relief_image(), props={"wet": "damp", "glowStrength": 0.6}),
        stone=material("SJT_Stone", "#c2bbae", 0.65, props={"wet": "damp", "glowStrength": 0.5}),
        dial=material("SJT_Dial", "#46484a", 0.45, tex=dial_image(), props={"wet": "surface", "glow": "none"}),
        dark=material("SJT_Dark", "#4a4b4b", 0.5, props={"wet": "surface", "glow": "none"}),
        bronze=material("SJT_Bronze", "#7a5a34", 0.42, metal=0.85, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.75, 0.45], "glowStrength": 0.15}),
        steel=material("SJT_Steel", "#d3d7da", 0.22, metal=1.0, props={"wet": "surface", "glow": "lamp", "glowColor": [0.85, 0.9, 1.0], "glowStrength": 0.25}),
        plaque=material("SJT_Plaque", "#7d6040", 0.4, metal=0.85, tex=plaque_image(), props={"wet": "ground", "glow": "none", "layer": 10}),
        water=material("SJT_Water", "#26383d", 0.04, metal=0.15, props={"wet": "none", "glow": "none", "layer": 10}),
        pave=material("SJT_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        lawn=material("SJT_Lawn", "#62803f", 0.95, tex=lawn_image(), props={"wet": "damp", "glow": "none", "layer": 6}),
        flame=material("SJT_Flame", "#ffa030", 0.5, props={"glow": "lamp", "glowColor": [1.0, 0.55, 0.15], "glowStrength": 2.0, "wet": "none"}),
        bark=material("SJT_Bark", "#4f4234", 0.9, props={"wet": "damp", "glow": "none"}),
        leaf=material("SJT_Leaf", "#4d6b33", 0.85, props={"wet": "damp", "glow": "none"}),
    )
    TILE = dict(granite=6.0, stone=2.0, pave=4.0, lawn=6.0, water=2.0, bronze=2.0, dark=4.0, steel=2.0)
    main = collection("中华世纪坛")
    g = Geo()

    # the cone: a darker plinth course, granite, the relief band, granite to the platform; the parapet over it
    k = (R0 - R1) / H0
    rz = lambda z: R0 - k * z   # noqa: E731
    for z0, z1, key in ((0.0, 0.8, "stone"), (0.8, 5.4, "granite"), (5.4, 7.8, "relief"), (7.8, H0, "granite")):
        band(g, rz(z0), z0, rz(z1), z1, key, su=(32.0 if key == "relief" else 8.0), sv=(2.4 if key == "relief" else 4.0))
    band(g, PAR["r1"], H0, PAR["r1"], H0 + PAR["h"], "granite")
    band(g, PAR["r0"], H0, PAR["r0"], H0 + PAR["h"], "stone", inward=True)
    annulus(g, PAR["r0"] - 0.1, PAR["r1"] + 0.15, H0 + PAR["h"], "stone")
    # the platform: paving from the drum out to the parapet; the curb round the disc's well
    annulus(g, DRUM_R, PAR["r0"], H0, "pave")
    skip_curb = lambda a: at_stair(a, CURB["r1"])   # noqa: E731
    band(g, CURB["r1"], H0, CURB["r1"], H0 + CURB["h"], "stone", skip=skip_curb)
    band(g, CURB["r0"], H0, CURB["r0"], H0 + CURB["h"], "stone", inward=True, skip=skip_curb)
    annulus(g, CURB["r0"], CURB["r1"], H0 + CURB["h"], "stone", skip=skip_curb)
    # the drum under the disc, cut by the disc's underside
    n = 48
    lo = ring(DRUM_R, H0, n)
    hi = [Vector((p.x, p.y, underside_z(p.x, p.y) + 0.05)) for p in lo]
    for i in range(n):
        kk = (i + 1) % n
        am = 2 * math.pi * (i + 0.5) / n
        g.polyn([lo[i], lo[kk], hi[kk], hi[i]], "granite", (math.cos(am), math.sin(am), 0), uvs=[(i / 3, 0), ((i + 1) / 3, 0), ((i + 1) / 3, 1.5), (i / 3, 1.5)])
    disc(g)
    tip = needle(g)
    stair(g)
    ground(g)
    plaza(g)
    fire(g)
    body = collection("坛体", main)
    g.build("Monument", body, M, TILE)
    tris = g.tris()

    parts = collection("雕像与树", main)
    st = mesh_of(statue_geo(), "Statue", M, TILE)
    span = 360.0 - STATUES["gap"]
    spots = []
    for i in range(STATUES["n"]):
        a = math.radians(-90.0 + STATUES["gap"] / 2 + span * (i + 0.5) / STATUES["n"])
        x, y = STATUES["r"] * math.cos(a), STATUES["r"] * math.sin(a)
        spots.append((x, y))
        place(st, f"Statue.{i:03d}", parts, T(x, y, H0) @ Rz(a - math.pi / 2))   # facing out from the disc
    tr = mesh_of(tree_geo(), "Tree", M, TILE)
    trees = tree_spots()
    for i, (x, y) in enumerate(trees):
        s = 0.9 + 0.2 * ((i * 37) % 7) / 6
        place(tr, f"Tree.{i:03d}", parts, T(x, y, 0.0) @ Rz(i * 1.3) @ Matrix.Diagonal((s, s, s, 1)))

    # the far level: the cone, the platform, the disc, the needle, the stair as a wedge, the strip and the plaza
    far = Geo()
    nf = 24
    A0, A1 = ring(R0, 0.0, nf), ring(R1, H0 + PAR["h"], nf)
    for i in range(nf):
        kk = (i + 1) % nf
        am = 2 * math.pi * (i + 0.5) / nf
        far.polyn([A0[i], A0[kk], A1[kk], A1[i]], "granite", (math.cos(am), math.sin(am), 0.2))
    far.polyn(A1, "stone", (0, 0, 1))
    disc(far, n=24, lod=True)
    needle(far, sides=4, lod=True)
    ground(far, lod=True)
    plaza(far, lod=True)
    far.box(-1.5, 1.5, PLAZA["y"] - 1.5, PLAZA["y"] + 1.5, 0.0, 2.8, "stone", skip=("-z",))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders
    helpers = collection("碰撞体")
    # the cone in three convex pieces round the stair's notch: west, east, and north of the stair's top
    W = STAIR["w"]
    cand = [p for z in (0.0, H0) for p in ring(R0 if z == 0.0 else R1, z, 128)]
    for z, r in ((0.0, R0), (H0, R1)):
        for sx in (-1, 1):
            for sy in (-1, 1):
                cand.append(Vector((sx * W, sy * math.sqrt(r * r - W * W), z)))
            cand.append(Vector((sx * math.sqrt(r * r - STAIR_TOP ** 2), STAIR_TOP, z)))
        cand += [Vector((sx * W, STAIR_TOP, z)) for sx in (-1, 1)]
    e = 1e-4
    collider_pts(helpers, "coneW", [tuple(p) for p in cand if p.x <= -W + e])
    collider_pts(helpers, "coneE", [tuple(p) for p in cand if p.x >= W - e])
    collider_pts(helpers, "coneN", [tuple(p) for p in cand if abs(p.x) <= W + e and p.y >= STAIR_TOP - e])
    np_ = 40
    for i in range(np_):                 # the parapet, in short straight pieces, trimmed at the notch
        a0, a1 = 2 * math.pi * i / np_, 2 * math.pi * (i + 1) / np_
        ok = [a for a in np.linspace(a0, a1, 9) if math.sin(a) > 0 or abs(PAR["r1"] * math.cos(a)) >= W + 0.6]
        if len(ok) < 2:
            continue
        aa, bb = min(ok), max(ok)
        pts = [(r * math.cos(a), r * math.sin(a), z) for r in (PAR["r0"], PAR["r1"]) for a in (aa, bb) for z in (H0, H0 + PAR["h"])]
        collider_pts(helpers, f"parapet{i:02d}", pts)
    yH = -math.sqrt(R1 ** 2 - W ** 2)
    for sx in (-1, 1):
        xa, xb = sorted((sx * W, sx * (W + 0.6)))
        collider_box(helpers, f"notchpar{sx:+d}", xa, xb, yH, STAIR_TOP, H0, H0 + PAR["h"])
    M_ = disc_matrix()
    collider_pts(helpers, "disc", [tuple(M_ @ Vector((DISC["R"] * math.cos(2 * math.pi * i / 24), DISC["R"] * math.sin(2 * math.pi * i / 24), z))) for i in range(24) for z in (0.25, -DISC["t"])])
    collider_pts(helpers, "drum", [(p.x, p.y, z) for p in ring(DRUM_R, 0.0, 16) for z in (H0, underside_z(p.x, p.y) + 0.1)])
    for i, (x, y) in enumerate(spots):
        collider_box(helpers, f"statue{i:02d}", x - 0.6, x + 0.6, y - 0.6, y + 0.6, H0, H0 + 2.9)
    steps_ramp(helpers, "stair", -STAIR["w"], STAIR["w"], STAIR_TOP, STAIR_LOW, H0)
    P = PLAZA
    ns = 20
    for i in range(ns):
        a0, a1 = 2 * math.pi * i / ns, 2 * math.pi * (i + 1) / ns
        am = (a0 + a1) / 2
        if abs(math.cos(am)) * P["rim"] < P["gate"] + 2.0:
            # pieces next to the gaps: trimmed to the gap's edge
            pass
        aa, bb = a0, a1
        # trim the sector to the open gaps on the axis (x = +-gate)
        ok = [a for a in np.linspace(a0, a1, 7) if abs(math.cos(a)) * P["rim"] >= P["gate"] + 0.2]
        if len(ok) < 2:
            continue
        aa, bb = min(ok), max(ok)
        pts = []
        for a in (aa, bb):
            for r, z in ((P["floor"], 0.0), (P["rim"], P["h"]), (P["bank"], 0.0)):
                pts.append((r * math.cos(a), P["y"] + r * math.sin(a), z))
        collider_pts(helpers, f"bank{i:02d}", pts)
    collider_box(helpers, "fire", -1.7, 1.7, P["y"] - 1.7, P["y"] + 1.7, 0.0, 2.9)
    for i, (x, y) in enumerate(trees):
        collider_box(helpers, f"trunk{i:02d}", x - 0.25, x + 0.25, y - 0.25, y + 0.25, 0.0, 2.6)

    # footprint: the altar's circle, the strip, the plaza (the one OSM outline in three pieces); clear ground round them
    circ = [(44.0 * math.cos(2 * math.pi * i / 32), 44.0 * math.sin(2 * math.pi * i / 32)) for i in range(32)]
    flat_marker(helpers, "altar", circ, "FOOTPRINT")
    flat_marker(helpers, "strip", rect(-STRIP, STRIP, PLAZA["y"] + 18.0, PATH["y1"]), "FOOTPRINT")
    pl = [(23.5 * math.cos(2 * math.pi * i / 24), PLAZA["y"] + 23.5 * math.sin(2 * math.pi * i / 24)) for i in range(24)]
    flat_marker(helpers, "plaza", pl, "FOOTPRINT")
    flat_marker(helpers, "altar", [(46.0 * math.cos(2 * math.pi * i / 32), 46.0 * math.sin(2 * math.pi * i / 32)) for i in range(32)], "CLEAR")
    flat_marker(helpers, "strip", rect(-STRIP - 1.0, STRIP + 1.0, PLAZA["y"] + 10.0, PATH["y1"]), "CLEAR")
    flat_marker(helpers, "plaza", [(24.5 * math.cos(2 * math.pi * i / 24), PLAZA["y"] + 24.5 * math.sin(2 * math.pi * i / 24)) for i in range(24)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "shijitan", "中华世纪坛", "China Millennium Monument"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -7027.3, -162.0, 0.0
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, tip=tuple(round(c, 1) for c in tip), stair_low=STAIR_LOW, statues=len(spots), trees=len(trees))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
