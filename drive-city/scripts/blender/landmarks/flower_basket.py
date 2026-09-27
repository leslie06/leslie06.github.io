# 「祝福祖国」巨型花篮 - the National Day flower basket on Tian'anmen Square, as in the photographs:
# a red lacquer vessel with gold fret and ruyi-cloud bands, 祝福祖国 1949-2026 facing south and 欢度国庆
# facing north, a tray of fifteen kinds of flower and five fruits, a handle, and the red-and-yellow
# parterre round it. Built in Blender, marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/flower_basket.py -- [--out art/landmarks/flowerbasket.blend] [--font f.otf] [--export]
#   (or with the bpy module: python scripts/blender/landmarks/flower_basket.py -- ...)
#
# The lettering needs a CJK serif: Noto Serif SC Bold (SIL OFL), downloaded once to .cache/fonts/
#   curl -L -o .cache/fonts/NotoSerifSC-Bold.otf https://github.com/notofonts/noto-cjk/raw/main/Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf
# It is only read here - the glyphs become geometry, the game never loads the font.
#
# It clears the open file first: run it in a new file. Frame: Blender +X east, +Y north, metres,
# origin on the ground under the basket's axis; it stands on the square's axis between the flag and
# the Monument (39.9045181 N, 116.3913643 E), turned -2 deg like the square.
#
# Every flower kind is one mesh with vertex colours, placed many times as linked duplicates, so the game
# draws each kind as one instanced mesh.

import bisect
import math
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export, select, srgb  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "flowerbasket.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
SEED = 20261001

# --- the vessel: (radius, height, material of the band from here to the next point) ------------------
VESSEL = [
    (6.0, 0.0, "plinth"), (6.0, 0.35, "plinth"), (5.6, 0.45, "fret"), (5.6, 1.35, "gold"), (5.75, 1.45, "lacquer"),
    (6.6, 2.0, "lacquer"), (7.35, 3.0, "lacquer"), (7.7, 4.0, "lacquer"), (7.55, 5.0, "lacquer"), (7.0, 6.0, "lacquer"),
    (6.1, 6.8, "gold"), (5.55, 7.25, "gold"), (5.45, 7.4, "fret"), (5.45, 8.35, "gold"), (5.8, 8.5, "lacquer"),
    (6.2, 8.9, "lacquer"), (6.35, 9.25, "lacquer"), (9.0, 9.55, "lacquer"), (10.45, 9.85, "gold"), (10.65, 10.0, "cloud"),
    (10.65, 11.0, "gold"), (10.2, 11.1, None),
]
# the flowers' bed: flowers stand on this dome and spill over the tray's lip
MOUND = [(10.3, 10.9), (11.6, 12.0), (12.0, 13.5), (11.6, 15.2), (10.3, 16.9), (8.2, 18.4), (5.4, 19.5), (2.6, 20.2), (0.0, 20.4)]
POSTS_X, POST_BASE, POST_TOP, ARCH_TOP = 4.6, 15.0, 23.8, 25.6
BED_R, BED_Y = 24.0, 0.3     # the parterre is raised: at 0.12 the square's paving layers drew over it


def radius_at(z, prof=VESSEL):
    for (r0, z0, *_), (r1, z1, *_) in zip(prof, prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


# --- geometry buffer with per-vertex colour ---------------------------------------------------------

class Buf:
    def __init__(self):
        self.v, self.c, self.f = [], [], []

    def vert(self, p, col):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.c.append(col)
        return len(self.v) - 1

    def face(self, *idx):
        self.f.append(idx)

    def add(self, other, m=None):
        base = len(self.v)
        for p, col in zip(other.v, other.c):
            q = m @ Vector(p) if m is not None else p
            self.vert(q, col)
        for f in other.f:
            self.face(*[i + base for i in f])

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def mesh(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.validate()
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        flat = []
        for c in self.c[: len(me.vertices)]:
            flat += [c[0], c[1], c[2], 1.0]
        attr.data.foreach_set("color", flat)
        me.shade_smooth()
        me.materials.append(mat)
        return me


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, k):
    return tuple(min(1.0, x * k) for x in c)


def petal(b, L, W, tilt, phase, c0, c1, cup=0.4, curl=0.0, shape=1.0, r0=0.05, z0=0.0, nu=3, nv=4, ruffle=0.0, tint=1.0):
    """One petal: a curved grid from the flower's axis outward along `phase`, lifted `tilt` from flat."""
    ct, st, cp, sp = math.cos(tilt), math.sin(tilt), math.cos(phase), math.sin(phase)
    rows = []
    for j in range(nv + 1):
        v = 0.015 + 0.97 * j / nv
        w = W * math.sin(math.pi * v ** 0.85) ** shape
        row = []
        for i in range(nu + 1):
            u = -1 + 2 * i / nu
            x, y = u * w / 2, v * L
            z = cup * u * u * w * 0.5 + curl * v * v * L
            if ruffle:
                z += ruffle * 0.08 * W * math.sin(7 * u + 5 * v + phase * 3)
            y2, z2 = r0 + y * ct - z * st, y * st + z * ct + z0
            row.append(b.vert((x * cp - y2 * sp, x * sp + y2 * cp, z2), shade(mix(c0, c1, v), tint)))
        rows.append(row)
    for j in range(nv):
        for i in range(nu):
            b.face(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i])


def blob(b, fn, nu=12, nv=8, m=None):
    """A closed surface from fn(u, v) -> (point, colour), u round (0..1), v from the bottom pole (0) to the top (1)."""
    base = len(b.v)
    bot = b.vert(*fn(0.0, 0.0))
    ring = []
    for j in range(1, nv):
        ring.append([b.vert(*fn(i / nu, j / nv)) for i in range(nu)])
    top = b.vert(*fn(0.0, 1.0))
    for i in range(nu):
        k = (i + 1) % nu
        b.face(bot, ring[0][k], ring[0][i])
        b.face(top, ring[-1][i], ring[-1][k])
        for j in range(nv - 2):
            b.face(ring[j][i], ring[j][k], ring[j + 1][k], ring[j + 1][i])
    if m is not None:
        for i in range(base, len(b.v)):
            b.v[i] = tuple(m @ Vector(b.v[i]))


def sphere_fn(r=1.0, sq=1.0, col=(1, 1, 1), grad=None, z0=0.0):
    def fn(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        p = (r * math.sin(ph) * math.cos(th), r * math.sin(ph) * math.sin(th), z0 - r * sq * math.cos(ph))
        return p, (grad(u, v) if grad else col)
    return fn


C = {k: linear(v) for k, v in dict(
    red="#b3131f", red_d="#5e0710", pink="#ef8fb1", pink_d="#b8406f", lav="#c8a2d8", lav_d="#8a5aa8",
    mag="#d0368a", mag_d="#7a1450", blush="#f6c6d4", blush_d="#d77f9f", lotus="#f2a0b8", lotus_d="#c9557d",
    gold="#f0b823", gold_d="#b36b08", cam="#e27bb8", cam_d="#a23a7a", white="#fbf7ee", white_d="#e9dfc4",
    dahlia="#c8102e", dahlia_d="#6d0715", sun="#f5c21b", sun_d="#c9860c", disc="#7a4a12", osm="#f7c948",
    lilac="#a77bd0", gyp="#fff4f6", gyp_p="#f3b6c8", stamen="#f2d24b", green="#3f7d3a", green_d="#1f4a22",
    bud="#6c9a3e", peach="#f7b27a", peach_r="#e8516a", apple="#e2323a", apple_y="#f4d35e", pome="#c0182a",
    pome_d="#7a0a16", persimmon="#f07d12", grape="#6a1535", grape_l="#9b2d52", stem="#5b3b1c").items()}


# --- the fifteen flowers, five fruits and two leaves (unit size: about 1 m radius) ---------------------

def rose(c, cd, rng, open_=1.0):
    b = Buf()
    rings = [(3, 0.30, 0.34, 82, 0.95, 0.0), (5, 0.45, 0.50, 72, 0.85, 0.0), (5, 0.60, 0.64, 60, 0.7, 0.0),
             (6, 0.76, 0.78, 46, 0.55, -0.05), (7, 0.92, 0.9, 28 + 8 * (1 - open_), 0.4, -0.12)]
    ph = rng.random() * 6.28
    for k, (n, L, W, tilt, cup, curl) in enumerate(rings):
        for i in range(n):
            ph += 2.39996
            petal(b, L, W, math.radians(tilt + rng.uniform(-5, 5)), ph, cd, mix(cd, c, 0.55 + 0.1 * k), cup=cup, curl=curl,
                  shape=0.7, r0=0.03 * k, z0=0.05 * (4 - k), tint=rng.uniform(0.92, 1.06))
    return b


def peony(c, cd, rng, stamens=False):
    b = Buf()
    ph = 0.0
    for k, (n, L, W, tilt) in enumerate([(6, 0.4, 0.5, 80), (8, 0.55, 0.62, 66), (9, 0.72, 0.78, 50), (9, 0.86, 0.9, 34), (10, 0.98, 1.0, 16)]):
        for i in range(n):
            ph += 2 * math.pi / n + rng.uniform(-0.15, 0.15)
            petal(b, L, W, math.radians(tilt + rng.uniform(-6, 6)), ph, cd, mix(cd, c, 0.7 + 0.06 * k), cup=0.45, curl=-0.05,
                  shape=0.6, r0=0.04 * k, z0=0.04 * (4 - k), ruffle=1.0, tint=rng.uniform(0.93, 1.05))
    if stamens:
        blob(b, sphere_fn(0.22, 0.5, C["stamen"], z0=0.3), nu=10, nv=5)
    return b


def lotus(rng):
    b = Buf()
    for k, (n, L, tilt) in enumerate([(8, 0.85, 72), (8, 0.95, 52), (8, 1.0, 30)]):
        for i in range(n):
            petal(b, L, 0.46, math.radians(tilt), (i + 0.5 * k) * math.pi / 4, C["white"], C["lotus_d"] if k == 2 else C["lotus"],
                  cup=0.75, curl=0.08, shape=1.7, r0=0.1, z0=0.02 * (2 - k), nv=5, tint=rng.uniform(0.94, 1.04))
    blob(b, sphere_fn(0.28, 0.35, C["bud"], z0=0.22), nu=12, nv=4)
    return b


def chrysanthemum(rng):
    b = Buf()
    for k, (n, L, tilt) in enumerate([(9, 0.35, 85), (12, 0.55, 68), (14, 0.75, 48), (16, 0.9, 28), (18, 1.0, 12)]):
        for i in range(n):
            petal(b, L, 0.15, math.radians(tilt + rng.uniform(-6, 6)), (i + rng.random() * 0.5) * 2 * math.pi / n, C["gold_d"], C["gold"],
                  cup=0.9, curl=0.28, shape=1.1, r0=0.02 * k, z0=0.03 * (4 - k), nu=2, nv=4, tint=rng.uniform(0.9, 1.08))
    return b


def camellia(rng):
    b = Buf()
    for k, (n, L, W, tilt) in enumerate([(6, 0.7, 0.8, 42), (7, 0.9, 0.9, 16)]):
        for i in range(n):
            petal(b, L, W, math.radians(tilt), (i + 0.5 * k) * 2 * math.pi / n, C["cam_d"], C["cam"], cup=0.35, shape=0.6, r0=0.08,
                  z0=0.06 * (1 - k), ruffle=0.5, tint=rng.uniform(0.94, 1.05))
    for i in range(14):
        a = i * 2.39996
        blob(b, sphere_fn(0.05, 1.0, C["stamen"], z0=0.25), nu=5, nv=3, m=Matrix.Translation((0.16 * math.cos(a) * (i % 3 + 1) / 3, 0.16 * math.sin(a) * (i % 3 + 1) / 3, 0)))
    return b


def blossom(rng):
    b = Buf()
    for i in range(5):
        petal(b, 0.8, 0.85, math.radians(14), i * 2 * math.pi / 5, C["white_d"], C["white"], cup=0.25, shape=0.55, r0=0.06, tint=rng.uniform(0.97, 1.03))
    blob(b, sphere_fn(0.18, 0.45, C["stamen"], z0=0.1), nu=10, nv=4)
    return b


def dahlia(rng):
    b = Buf()
    for k, (n, L, tilt) in enumerate([(8, 0.3, 88), (10, 0.48, 72), (12, 0.64, 56), (12, 0.8, 38), (14, 0.95, 18)]):
        for i in range(n):
            petal(b, L, 0.28, math.radians(tilt), (i + 0.5 * (k % 2)) * 2 * math.pi / n, C["dahlia_d"], C["dahlia"], cup=0.95,
                  shape=1.3, r0=0.02 * k, z0=0.04 * (4 - k), nu=2, nv=3, tint=rng.uniform(0.92, 1.06))
    return b


def golden(rng):
    b = Buf()
    for k, (n, L, tilt) in enumerate([(18, 0.72, 10), (14, 0.58, 26)]):
        for i in range(n):
            petal(b, L, 0.26, math.radians(tilt), (i + 0.5 * k) * 2 * math.pi / n, C["sun_d"], C["sun"], cup=0.4, shape=1.2, r0=0.38, nu=2, nv=3,
                  tint=rng.uniform(0.93, 1.05))
    blob(b, sphere_fn(0.42, 0.35, grad=lambda u, v: mix(C["disc"], C["gold_d"], abs(math.sin(u * 40)) * 0.5), z0=0.12), nu=16, nv=5)
    return b


def cluster(col, rng, florets=60, radius=0.9):
    """Osmanthus / lilac: a solid rounded head covered in tiny four-petal florets."""
    b = Buf()
    blob(b, sphere_fn(radius * 0.93, 0.7, shade(col, 0.6), z0=-0.35 * radius), nu=12, nv=6)
    for i in range(florets):
        t = (i + 0.5) / florets
        ph, el = i * 2.39996, math.acos(1 - t)                 # hemisphere, evenly
        n = Vector((math.sin(el) * math.cos(ph), math.sin(el) * math.sin(ph), math.cos(el)))
        f = Buf()
        for k in range(4):
            petal(f, 0.17, 0.16, math.radians(10), k * math.pi / 2, shade(col, 0.75), col, cup=0.2, shape=0.6, r0=0.01, nu=1, nv=1, tint=rng.uniform(0.9, 1.1))
        rot = n.to_track_quat("Z", "Y").to_matrix().to_4x4()
        b.add(f, Matrix.Translation(n * radius * rng.uniform(0.85, 1.0) - Vector((0, 0, 0.35 * radius))) @ rot)
    return b


def gypsophila(rng):
    b = Buf()
    blob(b, sphere_fn(0.62, 0.6, shade(C["gyp"], 0.7), z0=0.1), nu=10, nv=5)
    for i in range(40):
        a, rr = rng.random() * 6.283, math.sqrt(rng.random()) * 0.62
        p = Vector((rr * math.cos(a), rr * math.sin(a), 0.1 + 0.36 * math.sqrt(max(0.0, 1 - (rr / 0.62) ** 2)) + 0.02))
        col = C["gyp_p"] if rng.random() < 0.3 else C["gyp"]
        f = Buf()
        for k in range(5):
            petal(f, 0.08, 0.08, math.radians(20), k * 2 * math.pi / 5, col, col, cup=0.1, shape=0.6, r0=0.0, nu=1, nv=1)
        b.add(f, Matrix.Translation(p) @ Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, "X"))
    return b


def hollyhock(rng):
    """The tall green spire of buds at the top, pink flowers opening at its foot."""
    b = Buf()
    blob(b, lambda u, v: ((0.07 * math.cos(6.283 * u) if 0 < v < 1 else 0, 0.07 * math.sin(6.283 * u) if 0 < v < 1 else 0, 3.6 * v), C["green_d"]), nu=6, nv=2)
    for i in range(22):
        h = 0.4 + i * 0.145
        r = 0.2 * (1 - i / 26)
        a = i * 2.39996
        m = Matrix.Translation((0.12 * math.cos(a), 0.12 * math.sin(a), h))
        blob(b, sphere_fn(r, 1.3, mix(C["bud"], C["green"], i / 22)), nu=6, nv=4, m=m)
    for i in range(3):
        f = blossom(rng)
        for j, col in enumerate(f.c):
            f.c[j] = mix(col, C["pink"], 0.8)
        a = i * 2.1
        b.add(f, Matrix.Translation((0.25 * math.cos(a), 0.25 * math.sin(a), 0.3 + 0.35 * i)) @ Matrix.Rotation(1.2, 4, Vector((-math.sin(a), math.cos(a), 0))) @ Matrix.Scale(0.35, 4))
    return b


def peach():
    def fn(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        crease = 1 - 0.07 * math.exp(-((math.cos(th) - 1) ** 2) * 8)
        r = crease * (1 + 0.18 * max(0, v - 0.7) ** 2 * 6)
        p = (r * math.sin(ph) * math.cos(th), r * math.sin(ph) * math.sin(th), -math.cos(ph) * (1 + 0.25 * max(0, v - 0.75)))
        return p, mix(C["peach"], C["peach_r"], max(0, math.sin(th)) * 0.8 * math.sin(ph))
    b = Buf()
    blob(b, fn, nu=16, nv=10)
    return b


def apple():
    def fn(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        dimple = 1 - 0.25 * math.exp(-((v - 1) ** 2) * 60) - 0.15 * math.exp(-(v ** 2) * 60)
        p = (math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), -0.9 * math.cos(ph) * dimple)
        return p, mix(C["apple"], C["apple_y"], max(0, -math.sin(th + 0.6)) * 0.7)
    b = Buf()
    blob(b, fn, nu=16, nv=10)
    blob(b, sphere_fn(0.05, 4.0, C["stem"], z0=0.95), nu=5, nv=3)
    return b


def pomegranate():
    b = Buf()
    blob(b, sphere_fn(1.0, 0.95, grad=lambda u, v: mix(C["pome_d"], C["pome"], 0.5 + 0.5 * math.sin(6.283 * u + 1))), nu=16, nv=10)
    for i in range(6):
        petal(b, 0.32, 0.18, math.radians(70), i * math.pi / 3, C["pome_d"], C["pome"], cup=0.6, shape=1.4, r0=0.12, z0=0.92, nu=2, nv=2)
    return b


def persimmon():
    def fn(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        lobe = 1 - 0.05 * abs(math.cos(2 * th))
        return (lobe * math.sin(ph) * math.cos(th), lobe * math.sin(ph) * math.sin(th), -0.72 * math.cos(ph)), C["persimmon"]
    b = Buf()
    blob(b, fn, nu=16, nv=9)
    for i in range(4):
        petal(b, 0.45, 0.32, math.radians(12), i * math.pi / 2 + 0.4, C["green_d"], C["green"], cup=0.3, shape=1.0, r0=0.0, z0=0.7, nu=2, nv=2)
    return b


def grapes(rng):
    """A bunch hanging along -Z from its stalk at the origin."""
    b = Buf()
    for i in range(26):
        t = i / 26
        h = -0.2 - 2.2 * t
        rr = 0.62 * (1 - t) + 0.12
        a = i * 2.39996
        col = mix(C["grape"], C["grape_l"], rng.random() * 0.6)
        blob(b, sphere_fn(0.3, 1.1, col), nu=6, nv=4, m=Matrix.Translation((rr * math.cos(a), rr * math.sin(a), h)))
    return b


def leaf(W, L):
    b = Buf()
    petal(b, L, W, math.radians(18), 0.0, C["green_d"], C["green"], cup=-0.35, curl=-0.2, shape=1.25, r0=0.0, nu=2, nv=4)
    return b


# --- textures for the gold bands --------------------------------------------------------------------

def fret_image(w=256, h=64):
    """回纹: a gold key meander on red, one key per band height, gold rules above and below."""
    key = ["11111110", "10000010", "10111010", "10101010", "10100010", "10111110", "10000000", "11111111"][::-1]
    img = np.tile(srgb("#8f1414"), (h, w, 1)).astype(np.float32)
    gold = srgb("#e8b64a")
    v = np.arange(h)[:, None] / h
    u = np.arange(w)[None, :] / w
    rule = (v < 0.08) | (v > 0.92)
    inner = (v > 0.14) & (v < 0.86)
    cell_v = ((v - 0.14) / 0.72 * 8).astype(int).clip(0, 7)
    cell_u = ((u * 4 % 1) * 8).astype(int).clip(0, 7)       # four keys across the tile
    k = np.array([[c == "1" for c in row] for row in key])
    on = rule | (inner & k[cell_v, cell_u])
    img[on] = gold
    return image("FB_fret", img)


def cloud_image(w=256, h=128):
    """如意云纹: gold ruyi-cloud scrolls (a trefoil of rings with curling tails) on red, gold rules."""
    img = np.tile(srgb("#9a1616"), (h, w, 1)).astype(np.float32)
    gold = srgb("#eab94d")
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x, y = x / h, y / h                     # square units: the tile is 2 x 1
    on = (y < 0.07) | (y > 0.93)
    for cx in (0.5, 1.5):
        for (dx, dy, r) in ((0, 0.12, 0.2), (-0.21, -0.05, 0.13), (0.21, -0.05, 0.13)):
            d = np.hypot(x - cx - dx, y - 0.5 - dy)
            on |= np.abs(d - r) < 0.035
        # the tails: an S running to the next scroll
        tx = x - cx - 0.5
        on |= (np.abs(y - 0.5 + 0.18 * np.sin(tx / 0.5 * np.pi)) < 0.03) & (np.abs(tx) < 0.28)
    img[on] = gold
    return image("FB_cloud", img)


def filler_image(size=512):
    """What shows between the big heads: a crowd of tiny flowers in the arrangement's colours on dark leaves."""
    rng = np.random.default_rng(11)
    img = np.tile(srgb("#2c4a24"), (size, size, 1)).astype(np.float32) * (0.75 + 0.4 * rng.random((size, size, 1)).astype(np.float32))
    cols = [srgb(c) for c in ("#b3131f", "#d0368a", "#a77bd0", "#f7c948", "#ef8fb1", "#fbf7ee", "#7a1450")]
    y, x = np.mgrid[0:size, 0:size]
    for _ in range(300):          # the tile spans 5 m: five-petal blooms of 16-36 cm across, leaves between
        cx, cy, r = rng.integers(0, size), rng.integers(0, size), rng.uniform(8, 18)
        dx, dy = ((x - cx + size / 2) % size) - size / 2, ((y - cy + size / 2) % size) - size / 2
        d, th = np.hypot(dx, dy), np.arctan2(dy, dx) + rng.uniform(0, 6.283)
        edge = r * (0.72 + 0.28 * np.cos(5 * th))
        m = d < edge
        img[m] = cols[rng.integers(0, len(cols))] * (0.7 + 0.4 * (1 - d[m] / r))[:, None]
        img[d < r * 0.22] = srgb("#f2d24b")
    return image("FB_filler", img)


def bed_image(size=1024):
    """The parterre seen from above: red salvia, marigold scallops and lobes, a green border."""
    rng = np.random.default_rng(3)
    y, x = (np.mgrid[0:size, 0:size].astype(np.float32) / size - 0.5) * 2 * (BED_R + 0.4)
    r, phi = np.hypot(x, y), np.arctan2(y, x)
    red, yellow, green = srgb("#c8141e"), srgb("#f2c230"), srgb("#3c7a2e")
    img = np.tile(red, (size, size, 1)).astype(np.float32)
    yel = np.abs(r - (12.6 + 0.9 * np.cos(12 * phi))) < 0.75
    for k in range(8):
        a = k * np.pi / 4 + np.pi / 8
        cx, cy = 19.0 * np.cos(a), 19.0 * np.sin(a)
        dx, dy = x - cx, y - cy
        rr = np.hypot(dx * np.cos(a) + dy * np.sin(a), (-dx * np.sin(a) + dy * np.cos(a)) * 1.5)
        yel |= np.abs(rr - 2.6) < 0.5
    yel |= np.abs(r - 16.2) < 0.45
    img[yel] = yellow
    img[r > BED_R - 0.9] = green
    speck = 0.78 + 0.35 * rng.random((size, size, 1)).astype(np.float32)
    return image("FB_bed", img * speck)


# --- building ---------------------------------------------------------------------------------------

def lathe(prof, mats, segs, name, coll, uv_period=None):
    """A surface of revolution: each band takes the material its lower point names."""
    import bmesh
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    slots = []
    for (r0, z0, key), (r1, z1, *_) in zip(prof, prof[1:]):
        if key is None:
            continue
        if key not in slots:
            slots.append(key)
        rings = []
        for (r, z) in ((r0, z0), (r1, z1)):
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
        reps = max(1, round(2 * math.pi * max(r0, r1) / (uv_period or {}).get(key, 2.0)))
        for i in range(segs):
            k = (i + 1) % segs
            f = bm.faces.new((rings[0][i], rings[0][k], rings[1][k], rings[1][i]))
            f.material_index = slots.index(key)
            f.smooth = True
            for loop, uv in zip(f.loops, ((i / segs * reps, 0), ((i + 1) / segs * reps, 0), ((i + 1) / segs * reps, 1), (i / segs * reps, 1))):
                loop[uvl].uv = uv
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for k in slots:
        me.materials.append(mats[k])
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def text_mesh(font, body, height, name):
    """Lettering whose glyphs stand `height` m tall (a CJK font's em is not its glyph height)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = font
    cu.size = 1.0
    cu.extrude = 0.07
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.resolution_u = 3
    cu.space_character = 1.08
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    ys = [v.co.y for v in me.vertices]
    k = height / (max(ys) - min(ys))
    for v in me.vertices:
        v.co.x *= k
        v.co.y *= k
    # A long straight stroke has vertices only at its ends; bent onto the pot, its middle would run as a
    # chord straight through the bulge (国's left stroke vanished into the lacquer). Halve every edge
    # longer than 40 cm until none is, so each stroke follows the curve.
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    for _ in range(6):
        long_edges = [e for e in bm.edges if e.calc_length() > 0.4]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    return me


def wrap_text(me, zc, facing):
    """Bend flat lettering (x across, y up, z out) onto the pot at height zc, facing -Y (south) or +Y (north)."""
    s = -1 if facing == "south" else 1
    for v in me.vertices:
        x, y, z = v.co
        h = zc + y
        R = radius_at(h) + 0.1 + (z + 0.07)
        th = x / radius_at(h)
        v.co = (-s * R * math.sin(th), s * R * math.cos(th), h)
    me.update()


class Mound:
    """Area-uniform points on the flowers' dome, dart-throwing placement and a gap-filling pass."""

    def __init__(self, rng):
        self.rng = rng
        self.table, acc = [], 0.0
        for (r0, z0), (r1, z1) in zip(MOUND, MOUND[1:]):
            L = math.hypot(r1 - r0, z1 - z0)
            n = Vector((z1 - z0, -(r1 - r0))).normalized()
            for k in range(20):
                t = (k + 0.5) / 20
                r, z = r0 + (r1 - r0) * t, z0 + (z1 - z0) * t
                acc += r * L / 20
                self.table.append((acc, r, z, n))
        self.acc = acc
        self.cum = [row[0] for row in self.table]

    def sample(self):
        _, r, z, n = self.table[min(len(self.table) - 1, bisect.bisect_left(self.cum, self.rng.random() * self.acc))]
        ph = self.rng.random() * 2 * math.pi
        return Vector((r * math.cos(ph), r * math.sin(ph), z)), Vector((n.x * math.cos(ph), n.x * math.sin(ph), n.y))

    def place(self, kinds, placed):
        """Largest kinds first; `pack` < 1 lets neighbours overlap, as a crammed arrangement does."""
        for kind, count, rad, pack in kinds:
            n_ok = 0
            for _ in range(count * 80):
                if n_ok >= count:
                    break
                p, nrm = self.sample()
                r = rad * self.rng.uniform(0.85, 1.12)
                if all((p - q).length >= (r + rq) * min(pack, pk) for (_, q, _, rq, pk) in placed):
                    placed.append((kind, p, nrm, r, pack))
                    n_ok += 1
        return placed

    def fill(self, fillers, placed, gap=0.1, tries=9000):
        """Wherever the dome still shows, a filler sized to the hole."""
        weights = [w for _, w, _, _ in fillers]
        added = 0
        for _ in range(tries):
            p, nrm = self.sample()
            hole = min((p - q).length - rq for (_, q, _, rq, _) in placed)
            if hole > gap:
                kind, _, rmin, rmax = self.rng.choices(fillers, weights)[0]
                placed.append((kind, p, nrm, max(rmin, min(rmax, hole + 0.3)), 0.6))
                added += 1
        return added


def frame(pos, nrm, spin, tilt_rng):
    z = (nrm + Vector((tilt_rng.uniform(-0.18, 0.18), tilt_rng.uniform(-0.18, 0.18), tilt_rng.uniform(0, 0.25)))).normalized()
    q = z.to_track_quat("Z", "Y")
    return Matrix.Translation(pos) @ q.to_matrix().to_4x4() @ Matrix.Rotation(spin, 4, "Z")


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see the header of this script)")
    rng = random.Random(SEED)
    M = dict(
        lacquer=material("FB_Lacquer", "#8c1217", 0.3, props={"wet": "surface", "glowStrength": 0.8}),
        plinth=material("FB_Plinth", "#6e1012", 0.5, props={"wet": "surface"}),
        gold=material("FB_Gold", "#e6b44c", 0.28, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.72, 0.3], "glowStrength": 0.25}),
        fret=material("FB_Fret", "#8f1414", 0.35, tex=fret_image(), props={"wet": "surface"}),
        cloud=material("FB_Cloud", "#9a1616", 0.35, tex=cloud_image(), props={"wet": "surface"}),
        petal=material("FB_Petal", "#ffffff", 0.62, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        fruit=material("FB_Fruit", "#ffffff", 0.38, vertex_colors=True, props={"wet": "surface", "glowStrength": 0.7}),
        leaf=material("FB_Leaf", "#ffffff", 0.5, vertex_colors=True, props={"wet": "surface", "glowStrength": 0.6}),
        core=material("FB_Core", "#3b1612", 1.0, tex=filler_image(), props={"wet": "damp", "glowStrength": 0.5}),
        bed=material("FB_Bed", "#c8141e", 0.9, tex=bed_image(), props={"wet": "damp", "glowStrength": 0.5, "layer": 10}),
        curb=material("FB_Curb", "#cfc7b6", 0.7, props={"wet": "ground", "layer": 10}),
        far=material("FB_Far", "#ffffff", 0.6, vertex_colors=True),
    )
    main = collection("花篮")

    # the vessel, its lettering and the handle
    lathe(VESSEL, M, 96, "Vessel", main, uv_period={"fret": 0.95, "cloud": 2.0})
    font = bpy.data.fonts.load(FONT)
    for body, size, zc, facing in (("祝福祖国", 2.9, 4.45, "south"), ("1949-2026", 0.75, 2.35, "south"), ("欢度国庆", 2.9, 4.45, "north")):
        me = text_mesh(font, body, size, f"Text {body}")
        wrap_text(me, zc, facing)
        me.materials.clear()
        me.materials.append(M["gold"])
        ob = bpy.data.objects.new(f"Text {body}", me)
        main.objects.link(ob)
    lathe([(0.0, MOUND[0][1] - 0.2, "core")] + [(r * 0.97, z, "core") for r, z in MOUND[:-1]] + [(0.0, MOUND[-1][1] - 0.2, None)], M, 48, "Core", main,
          uv_period={"core": 5.0})
    handle = Buf()
    red, gold = linear("#8c1217"), linear("#e6b44c")
    for sx in (-1, 1):
        x = sx * POSTS_X
        for (z0, z1, col) in ((POST_BASE, POST_TOP - 0.6, red), (POST_TOP - 0.6, POST_TOP, gold), (POST_BASE + 4.0, POST_BASE + 4.4, gold)):
            box_into(handle, x - 0.42, x + 0.42, -0.42, 0.42, z0, z1, col)
    n = 18
    for i in range(n):
        a0, a1 = i / n, (i + 1) / n
        x0, x1 = -POSTS_X + 2 * POSTS_X * a0, -POSTS_X + 2 * POSTS_X * a1
        z0 = POST_TOP + (ARCH_TOP - POST_TOP) * math.sin(math.pi * a0)
        z1 = POST_TOP + (ARCH_TOP - POST_TOP) * math.sin(math.pi * a1)
        box_into(handle, min(x0, x1) - 0.02, max(x0, x1) + 0.02, -0.38, 0.38, min(z0, z1) - 0.35, max(z0, z1) + 0.35, red if i % 6 else gold)
    hobj = bpy.data.objects.new("Handle", handle.mesh("Handle", M["far"]))
    main.objects.link(hobj)

    # the flowers: each kind one mesh, linked wherever it grows
    kinds = {
        "rose_red": (lambda r: rose(C["red"], C["red_d"], r), "petal"),
        "rose_pink": (lambda r: rose(C["pink"], C["pink_d"], r), "petal"),
        "rose_lav": (lambda r: rose(C["lav"], C["lav_d"], r), "petal"),
        "peony": (lambda r: peony(C["mag"], C["mag_d"], r), "petal"),
        "peony_blush": (lambda r: peony(C["blush"], C["blush_d"], r, stamens=True), "petal"),
        "lotus": (lotus, "petal"),
        "chrysanthemum": (chrysanthemum, "petal"),
        "camellia": (camellia, "petal"),
        "blossom": (blossom, "petal"),
        "dahlia": (dahlia, "petal"),
        "golden": (golden, "petal"),
        "osmanthus": (lambda r: cluster(C["osm"], r), "petal"),
        "lilac": (lambda r: cluster(C["lilac"], r, florets=40, radius=0.8), "petal"),
        "gypsophila": (gypsophila, "petal"),
        "hollyhock": (hollyhock, "petal"),
        "peach": (lambda r: peach(), "fruit"),
        "apple": (lambda r: apple(), "fruit"),
        "pomegranate": (lambda r: pomegranate(), "fruit"),
        "persimmon": (lambda r: persimmon(), "fruit"),
        "grapes": (grapes, "fruit"),
        "leaf_broad": (lambda r: leaf(0.62, 1.3), "leaf"),
        "leaf_narrow": (lambda r: leaf(0.36, 1.15), "leaf"),
    }
    meshes, tris = {}, {}
    for k, (fn, mat) in kinds.items():
        buf = fn(random.Random(zlib.crc32(k.encode()) + SEED))   # stable per kind (str hash is salted per run)
        meshes[k] = buf.mesh(k, M[mat])
        tris[k] = buf.tris()
    # (kind, count, radius m, packing: < 1 lets neighbours overlap a little, as a crammed arrangement does)
    layout = [
        ("rose_red", 10, 2.0, 0.72), ("peony", 7, 1.95, 0.72), ("peach", 5, 1.5, 0.8), ("lotus", 4, 1.75, 0.72),
        ("chrysanthemum", 6, 1.7, 0.72), ("peony_blush", 7, 1.75, 0.72), ("rose_lav", 9, 1.55, 0.72), ("apple", 4, 1.4, 0.8),
        ("pomegranate", 3, 1.4, 0.8), ("persimmon", 4, 1.3, 0.8), ("golden", 6, 1.45, 0.72), ("camellia", 8, 1.35, 0.72),
        ("rose_pink", 12, 1.25, 0.72), ("dahlia", 9, 1.2, 0.72), ("osmanthus", 11, 1.2, 0.7), ("lilac", 9, 1.1, 0.7),
        ("blossom", 12, 0.9, 0.7), ("gypsophila", 8, 0.9, 0.6),
    ]
    mound = Mound(rng)
    placed = mound.place(layout, [])
    filled = mound.fill([("rose_pink", 3, 0.75, 1.2), ("osmanthus", 3, 0.75, 1.15), ("camellia", 2, 0.8, 1.2), ("blossom", 2, 0.7, 1.0),
                         ("dahlia", 2, 0.75, 1.15), ("lilac", 2, 0.7, 1.1), ("rose_red", 1, 0.9, 1.3)], placed, gap=0.2, tries=4000)
    leaves = mound.place([("leaf_broad", 30, 0.8, 0.5), ("leaf_narrow", 24, 0.7, 0.5)], list(placed))[len(placed):]
    flowers = collection("花", main)
    counts = {}
    FRUIT = {"peach", "apple", "pomegranate", "persimmon"}
    for kind, pos, nrm, r, _ in placed + leaves:
        # heads stand proud of the dome so the mass reads as heaped flowers, fruit half out of it
        lift = 0.6 * r if kind in FRUIT else (-0.1 * r if kind.startswith("leaf") else 0.22 * r)
        # drawn a little larger than they were spaced: neighbours crowd into each other, as in a real arrangement
        m = frame(pos + nrm * lift, nrm, rng.random() * 6.283, rng) @ Matrix.Scale(r * (1.0 if kind in FRUIT else 1.18), 4)
        if kind.startswith("leaf"):
            # a leaf lies along the surface, tucked under the flowers, pointing outward-down
            m = frame(pos + nrm * lift, nrm, rng.random() * 6.283, rng) @ Matrix.Rotation(-0.9, 4, "X") @ Matrix.Scale(r, 4)
        o = bpy.data.objects.new(f"{kind}.{counts.get(kind, 0):03d}", meshes[kind])
        o.matrix_world = m
        flowers.objects.link(o)
        counts[kind] = counts.get(kind, 0) + 1
    for i, (ph, s) in enumerate(((math.radians(-35), 1.0), (math.radians(150), 0.9), (math.radians(245), 1.05))):
        o = bpy.data.objects.new(f"grapes.{i:03d}", meshes["grapes"])
        o.matrix_world = Matrix.Translation((10.75 * math.cos(ph), 10.75 * math.sin(ph), 11.9)) @ Matrix.Rotation(ph, 4, "Z") @ Matrix.Rotation(0.25, 4, "Y") @ Matrix.Scale(s, 4)
        flowers.objects.link(o)
        counts["grapes"] = counts.get("grapes", 0) + 1
    for i, (x, y, z, s) in enumerate(((1.6, 1.2, 17.2, 1.0), (-2.1, -1.0, 17.1, 0.85))):
        o = bpy.data.objects.new(f"hollyhock.{i:03d}", meshes["hollyhock"])
        o.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Scale(s, 4)
        flowers.objects.link(o)
        counts["hollyhock"] = counts.get("hollyhock", 0) + 1

    # the parterre: a disc of flowers round the foot, a stone curb
    import bmesh
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    segs = 96
    inner = [bm.verts.new((6.05 * math.cos(2 * math.pi * i / segs), 6.05 * math.sin(2 * math.pi * i / segs), BED_Y)) for i in range(segs)]
    outer = [bm.verts.new((BED_R * math.cos(2 * math.pi * i / segs), BED_R * math.sin(2 * math.pi * i / segs), BED_Y)) for i in range(segs)]
    span = 2 * (BED_R + 0.4)
    for i in range(segs):
        k = (i + 1) % segs
        f = bm.faces.new((inner[i], outer[i], outer[k], inner[k]))
        if f.normal.z < 0:
            f.normal_flip()
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / span + 0.5, loop.vert.co.y / span + 0.5)
    me = bpy.data.meshes.new("Bed")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M["bed"])
    main.objects.link(bpy.data.objects.new("Bed", me))
    lathe([(BED_R, 0.0, "curb"), (BED_R, BED_Y + 0.15, "curb"), (BED_R + 0.4, BED_Y + 0.15, "curb"), (BED_R + 0.4, 0.0, None)], M, 96, "Curb", main)

    # far level (past 300 m): one vertex-coloured mesh - the vessel, the flowers' colours on the dome, the bed
    far = Buf()
    lac = linear("#8c1217")
    prof = [(r, z) for r, z, _ in VESSEL]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        col = gold if abs(z0 - 10.0) < 1.2 or abs(z0 - 7.8) < 0.5 else lac
        ring_into(far, r0, z0, r1, z1, 24, col)
    near = [(p, KIND_COLOR.get(k, C["red"])) for k, p, _, _, _ in placed]
    for (r0, z0), (r1, z1) in zip(MOUND, MOUND[1:]):
        ring_into(far, r0 + 0.4, z0, r1 + 0.4, z1, 24, None, lambda p: min(near, key=lambda q: (q[0] - p).length)[1])
    ring_into(far, 6.0, BED_Y, BED_R, BED_Y, 24, linear("#c8141e"))
    lod = collection("LOD1")
    lod.objects.link(bpy.data.objects.new("Far", far.mesh("Far", M["far"])))

    # colliders: the pot, and the tray with its flowers from 9.3 m up (so there is room under the tray's rim)
    helpers = collection("碰撞体")
    for name, pts in (("COL_pot", [(r, z) for r, z, _ in VESSEL if z <= 9.3]),
                      ("COL_tray", [(r, z) for r, z, _ in VESSEL if z >= 9.25] + [(r + 0.5, z) for r, z in MOUND])):
        hb = Buf()
        rings = []
        for r, z in pts:
            rings.append([hb.vert((r * math.cos(2 * math.pi * i / 16), r * math.sin(2 * math.pi * i / 16), z), (1, 1, 1)) for i in range(16)])
        for a, b in zip(rings, rings[1:]):
            for i in range(16):
                hb.face(a[i], a[(i + 1) % 16], b[(i + 1) % 16], b[i])
        o = bpy.data.objects.new(name, hb.mesh(name, M["far"]))
        o.data.materials.clear()
        helpers.objects.link(o)
        select([o])
        bpy.ops.bcity.mark(role="COL")
    # the parterre: its flowers' top and the curb, so a car stops at the curb and a person steps up onto the bed
    bed = Buf()
    ring_into(bed, 6.0, BED_Y, BED_R, BED_Y, 48, None)
    ring_into(bed, BED_R, BED_Y, BED_R, BED_Y + 0.15, 48, None)
    ring_into(bed, BED_R, BED_Y + 0.15, BED_R + 0.4, BED_Y + 0.15, 48, None)
    ring_into(bed, BED_R + 0.4, BED_Y + 0.15, BED_R + 0.4, 0.0, 48, None)
    o = bpy.data.objects.new("COLMESH_bed", bed.mesh("COLMESH_bed", M["far"]))
    o.data.materials.clear()
    helpers.objects.link(o)
    select([o])
    bpy.ops.bcity.mark(role="COLMESH")
    # footprint and clear zone: the parterre's circle
    for name, R, role in (("FOOTPRINT", BED_R + 0.5, "FOOTPRINT"), ("CLEAR_bed", BED_R + 2.0, "CLEAR")):
        pts = [(R * math.cos(2 * math.pi * i / 24), R * math.sin(2 * math.pi * i / 24), 0) for i in range(24)]
        me = bpy.data.meshes.new(name)
        me.from_pydata(pts, [], [tuple(range(24))])
        o = bpy.data.objects.new(name, me)
        helpers.objects.link(o)
        select([o])
        bpy.ops.bcity.mark(role=role)

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "flowerbasket", "「祝福祖国」花篮", "National Day Flower Basket"
    s.coord_mode, s.lat, s.lon, s.heading, s.far_distance = "LATLON", "39.9045181", "116.3913643", -2.0, 300
    s.repo_path = REPO
    total = sum(tris[k] * c for k, c in counts.items())
    return dict(kinds=len(counts), heads=sum(counts.values()), filled=filled, flower_tris=total, per_kind={k: (c, tris[k]) for k, c in sorted(counts.items())})


KIND_COLOR = {k: C[c] for k, c in dict(
    rose_red="red", rose_pink="pink", rose_lav="lav", peony="mag", peony_blush="blush", lotus="lotus", chrysanthemum="gold",
    camellia="cam", blossom="white", dahlia="dahlia", golden="sun", osmanthus="osm", lilac="lilac", gypsophila="gyp",
    peach="peach", apple="apple", pomegranate="pome", persimmon="persimmon").items()}


def box_into(b, x0, x1, y0, y1, z0, z1, col):
    v = [b.vert((x, y, z), col) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        b.face(*[v[i] for i in f])


def ring_into(b, r0, z0, r1, z1, segs, col, col_fn=None):
    a = [b.vert((r0 * math.cos(2 * math.pi * i / segs), r0 * math.sin(2 * math.pi * i / segs), z0), col or (1, 1, 1)) for i in range(segs)]
    c = [b.vert((r1 * math.cos(2 * math.pi * i / segs), r1 * math.sin(2 * math.pi * i / segs), z1), col or (1, 1, 1)) for i in range(segs)]
    if col_fn:
        for i in a + c:
            b.c[i] = col_fn(Vector(b.v[i]))
    for i in range(segs):
        k = (i + 1) % segs
        b.face(a[i], a[k], c[k], c[i])


if __name__ == "__main__":
    info = build()
    print("built", {k: v for k, v in info.items() if k != "per_kind"})
    for k, (c, t) in info["per_kind"].items():
        print(f"  {k:14s} x{c:3d}  {t:5d} tris each")
    save_and_export(OUT, argv)
