# 真觉寺金刚宝座塔 (五塔寺, 1473) north of 长河 by 白石桥, now the 北京石刻艺术博物馆, built in Blender and marked
# with the bcity_landmark add-on's conventions. OSM has the precinct (way 352165031, place_of_worship), the
# pagoda's outline (way 352164878, man_made=tower tower:type=pagoda, 23.5 x 26.7 m: the platform with the paved
# terrace round it) and the base of the burnt 大雄宝殿 south of it (way 529767874, historic=ruins, height 7);
# the city drew the pagoda as a block of flats and the ruin as a 7 m block.
#
#   blender -b -P scripts/blender/landmarks/wutasi.py -- [--out art/landmarks/wutasi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM's pagoda outline, game
# (-6264.35, -3871.35), heading -6 (the outline's edges run 5.6-6.6 degrees off; the ruin's and the museum's too).
#
# The pagoda (zh.wikipedia 真觉寺金刚宝座): the 金刚宝座 platform 15.7 m east-west, 18.6 m north-south, 7.7 m
# high, brick inside and stone outside: a 须弥座 carved with lions, vajras and wheels, then five storeys of
# Buddha niches each under a short stone eave, a parapet on top; arched gates in the middle of the south and north
# faces (the stairs inside wind up to the top, 44 steps each side, not modelled: the gates are recesses); on top
# five square 密檐 pagodas of carved stone - the middle one 13 eaves, ~8 m, with a bronze finial, the four at the
# corners 11 eaves, ~7 m, stone finials - and over the stair head south of the middle pagoda the glazed 罩亭,
# square below and round above (琉璃仿木). The niches, the carvings and the gates' frames are textures with normal
# maps, not geometry. Round it a low paved terrace (OSM's outline).
# The precinct: the 大雄宝殿's base as a stone platform with its column bases and front steps (OSM's outline; the
# hall burnt down at the end of the Qing and only the 台基 is left), the two old stele either side of the axis
# between them, and a row of the museum's stele along the west side. The precinct's two ginkgos and the trees
# are the city's.
# Doubtful: the platform's storey heights and setbacks, the pagodas' widths and the 罩亭's size (photographs
# only), the terrace's height, where the central pagoda stands (centred here, the 罩亭 south of it), what covers
# the ruin today (imagery shows something light over part of it), the stele's places.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_pts, flat_marker, mesh_of, paving, place  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "wutasi.blend")
GX, GZ, HEADING = -6264.35, -3871.35, -6.0


def L(x, z):
    """Game metres to this frame."""
    e, n = x - GX, -(z - GZ)
    a = math.radians(-HEADING)
    return (e * math.cos(a) + n * math.sin(a), -e * math.sin(a) + n * math.cos(a))


# OSM outlines, game metres relative to (-6299, -3849)
PAGODA_OSM = [(21.6, -34.5), (45.0, -36.8), (47.7, -10.2), (24.3, -7.9)]
RUIN_OSM = [(21.3, 20.8), (52.4, 17.2), (50.3, -0.8), (19.2, 2.8)]

TER = 0.45                   # terrace height
HX, HY = 15.7 / 2, 18.6 / 2  # the platform's half sizes at its foot
SUM = 1.45                   # the sumeru's height
ST, NST = 1.12, 5            # storey height, number of storeys
SET = 0.1                    # each storey's setback
NB = 0.84                    # the niche band's height in a storey
DECK = TER + SUM + NST * ST  # the top
PAR = 0.55                   # parapet


def rects(hx, hy):
    return [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]


# --- textures --------------------------------------------------------------------------------------------------

def blur(h, r):
    k = np.exp(-0.5 * (np.arange(-2 * r, 2 * r + 1) / r) ** 2)
    k /= k.sum()
    h = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, h)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, h)


def relief_images(name, H, base, strength=5.0, dark=None):
    """Colour and normal map (Blender images, row 0 at the bottom) from a top-down height field in 0..1."""
    hb = np.flipud(H)
    dv, du = np.gradient(hb)
    n = np.stack([-du * strength, -dv * strength, np.ones_like(hb)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    ao = blur(hb, 4)
    col = srgb(base) * (0.62 + 0.42 * hb[..., None] - 0.12 * (1 - ao[..., None]))
    rng = np.random.default_rng(len(name))
    col *= (0.93 + 0.1 * rng.random(hb.shape))[..., None]
    if dark is not None:
        col *= np.flipud(dark)[..., None]
    return image(name + "_C", np.clip(col, 0, 1)), image(name + "_N", n * 0.5 + 0.5)


class Field:
    def __init__(self, w, h, base=0.5):
        self.y, self.x = np.mgrid[0:h, 0:w].astype(np.float32)
        self.H = np.full((h, w), base, np.float32)

    def dome(self, cx, cy, rx, ry, hgt):
        m = 1 - ((self.x - cx) / rx) ** 2 - ((self.y - cy) / ry) ** 2
        np.maximum(self.H, hgt * np.sqrt(np.clip(m, 0, 1)) + (self.H * 0), out=self.H, where=m > 0)

    def rect(self, x0, y0, x1, y1, hgt, mode="set"):
        m = (self.x >= x0) & (self.x < x1) & (self.y >= y0) & (self.y < y1)
        if mode == "set":
            self.H[m] = hgt
        else:
            self.H[m] = np.maximum(self.H[m], hgt)
        return m

    def arch(self, cx, w, y_top, y_bot):
        """A round-headed niche's mask: the half circle on top of a rectangle."""
        r = w / 2
        return ((np.abs(self.x - cx) <= r) & (self.y >= y_top + r) & (self.y <= y_bot)) | (np.hypot(self.x - cx, self.y - (y_top + r)) <= r)

    def buddha(self, cx, y_head, s, hgt):
        """A seated figure: halo, head, shoulders and crossed legs on a lotus seat."""
        self.dome(cx, y_head + s * 0.3, s * 0.95, s * 0.95, hgt * 0.55)
        self.dome(cx, y_head, s * 0.36, s * 0.42, hgt)
        self.dome(cx, y_head - s * 0.45, s * 0.13, s * 0.15, hgt * 0.95)
        body = (np.abs(self.x - cx) < s * (0.38 + 0.32 * np.clip((self.y - y_head - s * 0.4) / (s * 1.3), 0, 1))) & (self.y > y_head + s * 0.35) & (self.y < y_head + s * 1.7)
        self.H[body] = np.maximum(self.H[body], hgt * 0.92)
        self.dome(cx, y_head + s * 1.75, s * 1.0, s * 0.32, hgt * 0.9)
        seat = (np.abs(self.x - cx) < s * 0.95) & (self.y >= y_head + s * 1.95) & (self.y < y_head + s * 2.35)
        petals = 0.5 + 0.5 * np.cos((self.x - cx) / (s * 0.24) * math.pi)
        self.H[seat] = np.maximum(self.H[seat], (hgt * (0.55 + 0.25 * petals))[seat])


def niche_band():
    """One storey's band of niches: 2.4 m (four niches, pilasters between) by the band's height."""
    w, h = 512, 180
    F = Field(w, h, 0.55)
    dark = np.ones((h, w), np.float32)
    F.rect(0, 0, w, 10, 0.75)
    F.rect(0, h - 8, w, h, 0.7)
    for k in range(4):
        cx = (k + 0.5) * w / 4
        F.rect(k * w / 4 - 7, 10, k * w / 4 + 7, h - 8, 0.78)
        m = F.arch(cx, 84, 26, h - 18)
        F.H[m] = 0.12
        dark[m] = 0.86
        F.buddha(cx, 62, 22, 0.66)
        rim = F.arch(cx, 100, 18, h - 12) & ~m
        F.H[rim] = np.maximum(F.H[rim], 0.68)
    F.rect(0 - 1, 0, 8, h, 0.78)
    return relief_images("WT_Niche", blur(F.H, 1), "#c6c1b5", 4.0, dark)


def waist_band():
    """The sumeru's waist: panels with a wheel, a lion and crossed vajras in turn (3 m by 0.55 m)."""
    w, h = 512, 96
    F = Field(w, h, 0.5)
    for k in range(3):
        x0 = k * w / 3
        F.rect(x0, 0, x0 + 10, h, 0.75)
        cx, cy = x0 + w / 6, h / 2
        if k == 0:
            d = np.hypot(F.x - cx, F.y - cy)
            F.H[(d < 30) & (d > 24)] = 0.8
            ang = np.arctan2(F.y - cy, F.x - cx)
            F.H[(d < 24) & (np.abs(np.sin(ang * 4)) < 0.25)] = 0.75
            F.dome(cx, cy, 7, 7, 0.85)
        elif k == 1:
            F.dome(cx - 8, cy + 6, 34, 22, 0.8)
            F.dome(cx + 26, cy - 10, 15, 15, 0.85)
            F.dome(cx + 30, cy - 4, 18, 9, 0.75)
            for s in (-24, -6, 12):
                F.dome(cx + s, cy + 26, 6, 10, 0.7)
        else:
            for a in (0.0, math.pi / 2):
                c, s_ = math.cos(a), math.sin(a)
                rod = (np.abs((F.x - cx) * s_ - (F.y - cy) * c) < 4) & (np.abs((F.x - cx) * c + (F.y - cy) * s_) < 32)
                F.H[rod] = 0.8
                for e in (-1, 1):
                    F.dome(cx + c * 30 * e, cy + s_ * 30 * e, 8, 8, 0.85)
            F.dome(cx, cy, 9, 9, 0.9)
        for j in range(5):                                   # Sanskrit letters along the top rail
            F.dome(x0 + 24 + j * 30, 7, 5, 4, 0.7)
    F.rect(0, 0, w, 3, 0.8)
    return relief_images("WT_Waist", blur(F.H, 1), "#c2bdb1", 4.0)


def body_face():
    """A pagoda's first storey, one face: a niche with a seated Buddha, a standing figure either side."""
    w, h = 256, 256
    F = Field(w, h, 0.55)
    dark = np.ones((h, w), np.float32)
    F.rect(0, 0, w, 14, 0.8)
    F.rect(0, 0, 12, h, 0.8)
    F.rect(w - 12, 0, w, h, 0.8)
    m = F.arch(128, 110, 40, 230)
    F.H[m] = 0.15
    dark[m] = 0.7
    F.buddha(128, 92, 28, 0.62)
    for cx in (46, 210):
        F.dome(cx, 70, 10, 12, 0.75)
        body = (np.abs(F.x - cx) < 13 + 6 * (F.y - 82) / 150) & (F.y > 82) & (F.y < 232)
        F.H[body] = 0.72
    return relief_images("WT_Body", blur(F.H, 1), "#c8c3b7", 4.0, dark)


def gate_face():
    """The arched gate's frame (3.6 x 4.4 m): carved border, the plaque over the arch, scrolls in the spandrels."""
    w, h = 384, 470
    F = Field(w, h, 0.6)
    rng = np.random.default_rng(1473)
    F.rect(0, 0, w, 18, 0.85)
    F.rect(0, 0, 18, h, 0.85)
    F.rect(w - 18, 0, w, h, 0.85)
    border = ((F.x > 26) & (F.x < 46)) | ((F.x > w - 46) & (F.x < w - 26)) | ((F.y > 26) & (F.y < 46))
    scroll = 0.5 + 0.5 * np.sin(F.x * 0.25) * np.sin(F.y * 0.25)
    F.H[border] = (0.55 + 0.3 * scroll)[border]
    F.rect(132, 58, 252, 104, 0.82)                       # the plaque
    F.rect(140, 64, 244, 98, 0.45)
    for k in range(6):                                    # its six characters (敕建金刚宝座), as marks
        cx = 150 + k * 17
        for _ in range(5):
            F.rect(cx + rng.integers(-5, 4), 68 + rng.integers(0, 22), cx + rng.integers(1, 7), 70 + rng.integers(4, 26), 0.75, mode="max")
    for cx in (90, 294):                                  # spandrel scrolls
        for k in range(5):
            F.dome(cx + 18 * math.cos(k * 1.3), 160 + 18 * math.sin(k * 1.3), 12, 10, 0.8)
    return relief_images("WT_Gate", blur(F.H, 1), "#cac5b9", 4.0)


def eave_image():
    """Stone eave tops cut like tile rows (one row every 0.15 m across u, courses up v)."""
    size = 128
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.6 + 0.4 * np.cos(np.pi * ((u * 4) % 1.0 - 0.5)) ** 2
    arr = srgb("#bab5aa") * ridge[..., None]
    return image("WT_EaveTex", np.flipud(arr).copy())


def glaze_image(name, col, edge):
    """Glazed tile rows for the 罩亭's roofs, an edge band of the other colour at the eave (v 0)."""
    size = 128
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.62 + 0.38 * np.cos(np.pi * ((u * 4) % 1.0 - 0.5)) ** 2
    arr = srgb(col) * ridge[..., None]
    arr[v > 0.88] = srgb(edge) * ridge[v > 0.88][..., None]
    return image(name, arr)


def stone_image(name, col):
    cv = Canvas(256, 256, col)
    cv.noise(0.12, 11)
    rng = np.random.default_rng(12)
    rows = (cv.y // 32).astype(int)
    c = ((cv.x + (rows % 2) * 40) // 80).astype(int)
    cv.a *= rng.uniform(0.94, 1.05, (8, 5))[rows % 8, c % 5][..., None]
    cv.put((np.mod(cv.y, 32) < 1.2) | (np.mod(cv.x + (rows % 2) * 40, 80) < 1.2), "#9d978a")
    streak = blur(rng.random((256, 256)).astype(np.float32), 3)
    cv.a *= (0.92 + 0.12 * streak)[..., None]
    return image(name, np.flipud(cv.a).copy())


def make_materials():
    nc, nn = niche_band()
    wc, wn = waist_band()
    bc, bn = body_face()
    gc, gn = gate_face()
    damp = {"wet": "damp", "glow": "flood", "glowStrength": 0.55}
    return dict(
        niche=material("WT_Niche", "#ffffff", 0.85, tex=nc, normal_tex=nn, props=damp),
        waist=material("WT_Waist", "#ffffff", 0.85, tex=wc, normal_tex=wn, props=damp),
        body=material("WT_Body", "#ffffff", 0.85, tex=bc, normal_tex=bn, props=damp),
        gate=material("WT_Gate", "#ffffff", 0.85, tex=gc, normal_tex=gn, props=damp),
        stone=material("WT_Stone", "#ffffff", 0.85, tex=stone_image("WT_StoneTex", "#c6c1b5"), props=damp),
        eave=material("WT_Eave", "#ffffff", 0.75, tex=eave_image(), props={"wet": "surface", "glow": "flood", "glowStrength": 0.55}),
        glazeY=material("WT_GlazeY", "#ffffff", 0.35, tex=glaze_image("WT_GlazeYTex", "#d6a02a", "#3f7a4a"), props={"wet": "surface", "glowStrength": 0.6}),
        glazeG=material("WT_GlazeG", "#ffffff", 0.35, tex=glaze_image("WT_GlazeGTex", "#3d7a4c", "#d6a02a"), props={"wet": "surface", "glowStrength": 0.6}),
        wall=material("WT_Wall", "#c9a34a", 0.5, props={"wet": "surface"}),
        bronze=material("WT_Bronze", "#9a7a3c", 0.4, metal=0.85, props={"wet": "surface"}),
        dark=material("WT_Dark", "#1d1b19", 0.9, props={"wet": "damp"}),
        paving=material("WT_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground"}),
    )


TILE = dict(stone=2.4, paving=4.0, wall=2.0, bronze=1.0, dark=2.0)


# --- shapes --------------------------------------------------------------------------------------------------

def band(g, a0, b0, z0, a1, b1, z1, key, rep=None, v=(0.0, 1.0), sides=(0, 1, 2, 3), flip=False):
    """The four faces between the rectangle (a0, b0) at z0 and (a1, b1) at z1 (half sizes). UVs: u along the
    face in metres / rep, centred on the face's middle (a pattern stays symmetric); v from v[0] to v[1]."""
    c0, c1 = rects(a0, b0), rects(a1, b1)
    outs = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    for i in sides:
        j = (i + 1) % 4
        P = [(*c0[i], z0), (*c0[j], z0), (*c1[j], z1), (*c1[i], z1)]
        o = outs[i]
        if abs(z1 - z0) < 1e-6:
            want = (0, 0, 1 if (a0 > a1 or b0 > b1) else -1)
        else:
            want = (o[0], o[1], (max(a0, b0) - max(a1, b1)) / (z1 - z0) * 0.3)
        if flip:
            want = tuple(-c for c in want)
        uvs = None
        if rep:
            L0 = math.hypot(c0[j][0] - c0[i][0], c0[j][1] - c0[i][1])
            L1 = math.hypot(c1[j][0] - c1[i][0], c1[j][1] - c1[i][1])
            uvs = [(0.5 - L0 / 2 / rep, v[0]), (0.5 + L0 / 2 / rep, v[0]), (0.5 + L1 / 2 / rep, v[1]), (0.5 - L1 / 2 / rep, v[1])]
        g.polyn(P, key, want, uvs=uvs)


def cap(g, a, b, z, key, up=True):
    g.polyn([(*p, z) for p in rects(a, b)], key, (0, 0, 1 if up else -1))


def sloped_eave(g, w_wall, z, proj, t_front, rise, w_next, key_top="eave", key="stone", corbel=0.07):
    """A stone eave on a square (or rectangular via w=(a, b)) body: corbel, soffit, front edge, tiled top up to
    the next wall."""
    a, b = w_wall
    an, bn = w_next
    band(g, a, b, z, a + corbel, b + corbel, z + corbel, key)
    z1 = z + corbel
    band(g, a + corbel, b + corbel, z1, a + proj, b + proj, z1, key)            # soffit (faces down)
    band(g, a + proj, b + proj, z1, a + proj, b + proj, z1 + t_front, key)      # front edge
    # the top: rows run along the eave (u), courses up the slope (v)
    c0, c1 = rects(a + proj, b + proj), rects(an, bn)
    outs = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    zt0, zt1 = z1 + t_front, z1 + t_front + rise
    for i in range(4):
        j = (i + 1) % 4
        P = [(*c0[i], zt0), (*c0[j], zt0), (*c1[j], zt1), (*c1[i], zt1)]
        L0 = math.hypot(c0[j][0] - c0[i][0], c0[j][1] - c0[i][1])
        L1 = math.hypot(c1[j][0] - c1[i][0], c1[j][1] - c1[i][1])
        sl = math.hypot(proj, rise) / 0.6
        g.polyn(P, key_top, (outs[i][0], outs[i][1], 1.5), uvs=[(-L0 / 2 / 0.6, 0), (L0 / 2 / 0.6, 0), (L1 / 2 / 0.6, sl), (-L1 / 2 / 0.6, sl)])
    return zt1


def lathe_uv(g, prof, segs, key, smooth=True):
    rings = [[g.vert((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)] for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            k = (i + 1) % segs
            g.face((a[i], a[k], b[k], b[i]), key, smooth=smooth)


# --- the platform ------------------------------------------------------------------------------------------------

def storey_sizes():
    """(a, b) half sizes of each storey's niche band."""
    return [(HX - 0.3 - SET * k, HY - 0.3 - SET * k) for k in range(NST)]


def platform(g):
    z = TER
    # the sumeru: plinth, a cyma in, the lower rail, the carved waist, the upper rail
    band(g, HX + 0.12, HY + 0.12, z, HX + 0.12, HY + 0.12, z + 0.24, "stone")
    band(g, HX + 0.12, HY + 0.12, z + 0.24, HX - 0.05, HY - 0.05, z + 0.42, "stone")
    band(g, HX - 0.05, HY - 0.05, z + 0.42, HX - 0.05, HY - 0.05, z + 0.62, "stone")
    band(g, HX - 0.05, HY - 0.05, z + 0.62, HX - 0.2, HY - 0.2, z + 0.62, "stone")
    band(g, HX - 0.2, HY - 0.2, z + 0.62, HX - 0.2, HY - 0.2, z + 1.17, "waist", rep=3.0)
    band(g, HX - 0.2, HY - 0.2, z + 1.17, HX - 0.02, HY - 0.02, z + 1.17, "stone")
    band(g, HX - 0.02, HY - 0.02, z + 1.17, HX - 0.02, HY - 0.02, z + SUM, "stone")
    z += SUM
    S_ = storey_sizes()
    band(g, HX - 0.02, HY - 0.02, z, S_[0][0], S_[0][1], z, "stone")
    for k, (a, b) in enumerate(S_):
        band(g, a, b, z, a, b, z + NB, "niche", rep=2.4)
        nxt = S_[k + 1] if k + 1 < NST else (a - 0.05, b - 0.05)
        zt = sloped_eave(g, (a, b), z + NB, 0.3, 0.1, ST - NB - 0.17, nxt)
        z = zt
    # the parapet: a solid rail with a coping, the deck inside
    a, b = S_[-1][0] - 0.05, S_[-1][1] - 0.05
    band(g, a, b, z, a, b, z + PAR, "stone")
    band(g, a - 0.25, b - 0.25, z, a - 0.25, b - 0.25, z + PAR, "stone", flip=True)
    band(g, a + 0.04, b + 0.04, z + PAR, a + 0.04, b + 0.04, z + PAR + 0.1, "stone")
    band(g, a + 0.04, b + 0.04, z + PAR + 0.1, a - 0.29, b - 0.29, z + PAR + 0.1, "stone")
    band(g, a - 0.29, b - 0.29, z + PAR + 0.1, a - 0.29, b - 0.29, z + PAR, "stone", flip=True)
    cap(g, a - 0.25, b - 0.25, z + 0.02, "paving")
    return z, (a, b)


def gate(g, side, deck_ab):
    """An arched gate in the middle of the south (side -1) or north (+1) face: a carved frame standing proud of
    the storeys, the arch a dark recess."""
    fw, fh, out = 3.6, 4.4, 1.0               # proud of the storeys so the recess can be ~1 m deep
    y0 = side * (HY + 0.12 + out)
    aw, spring = 1.9, 2.55                   # arch width, springing above the terrace
    r = aw / 2
    z0 = TER
    # arch outline, left foot round to the right foot; frame outline matched by angle from the arch's centre
    ac = Vector((0, z0 + spring))
    arch, frame = [], []
    m = 18
    pts_a = [Vector((-r, z0))] + [ac + Vector((-r * math.cos(math.pi * k / m), r * math.sin(math.pi * k / m))) for k in range(m + 1)] + [Vector((r, z0))]
    for p in pts_a:
        d = p - ac
        if p.y <= ac.y + 1e-6:
            q = Vector((math.copysign(fw / 2, p.x), p.y))
        else:
            ang = math.atan2(d.y, d.x)
            # ray from the centre to the frame's top or sides
            tx = (fw / 2) / max(1e-6, abs(math.cos(ang)))
            ty = (z0 + fh - ac.y) / max(1e-6, math.sin(ang))
            t = min(tx, ty)
            q = ac + Vector((math.cos(ang), math.sin(ang))) * t
        arch.append(p)
        frame.append(q)
    # the frame's top corners must be in the outline: insert them where the matching jumps from side to top
    ring = []
    for i in range(len(arch) - 1):
        ring.append((arch[i], frame[i], arch[i + 1], frame[i + 1]))

    def uv(p):
        return ((p.x + fw / 2) / fw, (p.y - z0) / fh)

    def P(p, y):
        return (p.x, y, p.y)
    for a0, f0, a1, f1 in ring:
        quad = [a0, a1, f1, f0]
        g.polyn([P(q, y0) for q in quad], "gate", (0, side, 0), uvs=[uv(q) for q in quad])
        # a frame corner skipped between f0 and f1
        if abs(f0.x - f1.x) > 1e-3 and abs(f0.y - f1.y) > 1e-3:
            c = Vector((f0.x if abs(abs(f0.x) - fw / 2) < 1e-3 else f1.x, z0 + fh))
            g.polyn([P(f0, y0), P(c, y0), P(f1, y0)], "gate", (0, side, 0), uvs=[uv(f0), uv(c), uv(f1)])
    # frame sides and top (proud of the wall), and a little eave over it
    yb = side * (HY - 0.4)
    for sx in (-1, 1):
        g.polyn([(sx * fw / 2, yb, z0), (sx * fw / 2, y0, z0), (sx * fw / 2, y0, z0 + fh), (sx * fw / 2, yb, z0 + fh)], "stone", (sx, 0, 0))
    g.polyn([(-fw / 2, yb, z0 + fh), (fw / 2, yb, z0 + fh), (fw / 2, y0, z0 + fh), (-fw / 2, y0, z0 + fh)], "stone", (0, 0, 1))
    eg = Geo()
    sloped_eave(eg, (fw / 2 + 0.05, out / 2 + 0.05), 0.0, 0.25, 0.1, 0.3, (fw / 2 - 0.4, 0.02))
    g.add(eg, T(0, side * (HY + 0.12 + out / 2), z0 + fh))
    # the recess: the arch's soffit and sides, a dark back just in front of the sumeru
    yi = side * (HY + 0.15)
    for p, q in zip(arch, arch[1:]):
        c = (p + q) / 2
        g.polyn([P(p, y0), P(q, y0), P(q, yi), P(p, yi)], "dark", (-c.x, 0, ac.y - c.y if c.y > ac.y else 0.0))
    g.polyn([P(p, yi) for p in arch], "dark", (0, side, 0))
    # steps up to the threshold
    g.box(-1.3, 1.3, min(y0, y0 + side * 0.9), max(y0, y0 + side * 0.9), TER - 0.3, TER, "stone", skip=("-z",))


# --- the pagodas ---------------------------------------------------------------------------------------------------

def pagoda(n_eaves, height, w, bronze):
    """A square 密檐 pagoda on the deck: sumeru, the carved first storey, close-set eaves, a finial."""
    g = Geo()
    b = w / 2
    # sumeru
    band(g, b + 0.12, b + 0.12, 0.0, b + 0.12, b + 0.12, 0.18, "stone")
    band(g, b + 0.12, b + 0.12, 0.18, b, b, 0.3, "stone")
    band(g, b - 0.06, b - 0.06, 0.3, b - 0.06, b - 0.06, 0.7, "waist", rep=1.0)
    band(g, b, b, 0.3, b - 0.06, b - 0.06, 0.3, "stone")
    band(g, b - 0.06, b - 0.06, 0.7, b + 0.08, b + 0.08, 0.7, "stone")
    band(g, b + 0.08, b + 0.08, 0.7, b + 0.08, b + 0.08, 0.86, "stone")
    band(g, b + 0.08, b + 0.08, 0.86, b * 0.86, b * 0.86, 0.86, "stone")
    z = 0.86
    wb = b * 0.86
    hb = w * 0.42
    band(g, wb, wb, z, wb, wb, z + hb, "body", rep=2 * wb)
    z += hb
    fin = 1.25 if bronze else 1.05
    layer = (height - z - fin) / n_eaves
    walls = [wb * (0.97 - 0.3 * (k / (n_eaves - 1)) ** 1.3) for k in range(n_eaves + 1)]
    for k in range(n_eaves):
        ww = walls[k]
        proj = 0.28 * (1 - 0.35 * k / n_eaves) + 0.06
        corb = 0.05
        rise = layer - corb - 0.07 - 0.05
        band(g, ww, ww, z, ww, ww, z + 0.05, "stone")
        z += 0.05
        z = sloped_eave(g, (ww, ww), z, proj, 0.07, rise, (walls[k + 1], walls[k + 1]), corbel=corb)
    # finial: a plinth, the inverted bowl, rings and the jewel
    top = walls[-1]
    band(g, top, top, z, top, top, z + 0.12, "stone")
    z += 0.12
    key = "bronze" if bronze else "stone"
    prof = [(top * 0.85, z), (top * 0.95, z + 0.12), (top * 0.8, z + 0.32), (top * 0.35, z + 0.42)]
    lathe_uv(g, prof, 10, key)
    z += 0.42
    k_rings = 5 if bronze else 3
    r0 = top * 0.42
    for k in range(k_rings):
        zz = z + k * (fin * 0.55) / k_rings
        lathe_uv(g, [(r0 * (1 - 0.12 * k), zz), (r0 * (1 - 0.12 * k), zz + 0.05), (r0 * 0.4, zz + 0.07)], 10, key)
    z += fin * 0.55
    lathe_uv(g, [(0.0, z - 0.02), (0.12, z + 0.05), (0.14, z + 0.15), (0.07, z + 0.3), (0.0, height)], 8, key)
    lathe_uv(g, [(0.05, z - fin * 0.55), (0.05, z)], 6, key)
    return g


def zhaoting():
    """The glazed 罩亭 over the stair head: a square body with an arched door each side under a square glazed
    eave, a round drum and a round glazed roof, a finial."""
    g = Geo()
    a = 1.55
    band(g, a + 0.15, a + 0.15, 0.0, a + 0.15, a + 0.15, 0.2, "stone")
    cap(g, a + 0.15, a + 0.15, 0.2, "stone")
    band(g, a, a, 0.2, a, a, 2.3, "wall")
    for i, (ox, oy) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
        tx, ty = -oy, ox
        c = Vector((ox * (a + 0.01), oy * (a + 0.01), 0))
        t = Vector((tx, ty, 0))
        pts = [c - t * 0.55 + Vector((0, 0, 0.2))]
        for k in range(9):
            ang = math.pi * k / 8
            pts.append(c - t * 0.55 * math.cos(ang) + Vector((0, 0, 1.35 + 0.55 * math.sin(ang))))
        pts.append(c + t * 0.55 + Vector((0, 0, 0.2)))
        g.polyn(pts, "dark", (ox, oy, 0))
    band(g, a, a, 2.3, a + 0.12, a + 0.12, 2.42, "glazeG")
    zt = sloped_eave(g, (a, a), 2.42, 0.75, 0.12, 0.6, (1.1, 1.1), key_top="glazeG", key="glazeY")
    for k in range(4):                       # hip ridges
        ang = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(ang), math.sin(ang), 0)) * math.sqrt(2)
        p0 = d * (a + 0.75) + Vector((0, 0, 2.42 + 0.07 + 0.12))
        p1 = d * 1.1 + Vector((0, 0, zt))
        n = Vector((-d.y, d.x, 0)).normalized() * 0.07
        g.polyn([p0 - n, p1 - n, p1 + n, p0 + n], "glazeY", (0, 0, 1))
    r = 1.05
    lathe_uv(g, [(r, zt - 0.02), (r, zt + 0.55)], 20, "wall")
    lathe_uv(g, [(r, zt + 0.55), (r + 0.1, zt + 0.62)], 20, "glazeY")
    # the round roof: glazed rows (UV round and up the slope), a gilt ball
    segs, rows = 24, 5
    R0, H0 = 1.65, 1.25
    z0 = zt + 0.62
    for j in range(rows):
        t0, t1 = j / rows, (j + 1) / rows
        r0_, r1_ = R0 * (1 - t0) ** 1.15, R0 * (1 - t1) ** 1.15
        za, zb = z0 + H0 * t0 ** 0.8, z0 + H0 * t1 ** 0.8
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            P = [(r0_ * math.cos(a0), r0_ * math.sin(a0), za), (r0_ * math.cos(a1), r0_ * math.sin(a1), za),
                 (r1_ * math.cos(a1), r1_ * math.sin(a1), zb), (r1_ * math.cos(a0), r1_ * math.sin(a0), zb)]
            g.polyn(P, "glazeG", (math.cos(a0), math.sin(a0), 1.5), uvs=[(i, t0 * 2), (i + 1, t0 * 2), (i + 1, t1 * 2), (i, t1 * 2)], smooth=True)
    lathe_uv(g, [(R0, z0 - 0.05), (R0 + 0.02, z0)], segs, "glazeY")
    zz = z0 + H0
    lathe_uv(g, [(0.0, zz - 0.05), (0.2, zz + 0.05), (0.22, zz + 0.25), (0.1, zz + 0.45), (0.0, zz + 0.6)], 10, "bronze")
    return g, zz + 0.6


# --- the precinct ----------------------------------------------------------------------------------------------------

def stele(big):
    """A stele: (big) on a tortoise, a rounded head with dragons; (small) on a plain base."""
    g = Geo()
    if big:
        g.box(-0.9, 0.9, -1.9, 1.9, 0.0, 0.25, "stone", skip=("-z",))
        # the tortoise (赑屃): a shell stretched along y, its head out at the front
        g.add(lathe_uv_geo([(0.0, 0.25), (0.75, 0.3), (0.82, 0.55), (0.65, 0.85), (0.0, 0.95)], 12), Matrix.Diagonal((1.0, 2.0, 1.0, 1.0)))
        g.add(lathe_uv_geo([(0.0, 0.45), (0.28, 0.5), (0.26, 0.75), (0.0, 0.8)], 8), T(0, -1.75, 0))
        w, d, h0, h1 = 0.62, 0.2, 0.9, 3.9
    else:
        g.box(-0.5, 0.5, -0.3, 0.3, 0.0, 0.5, "stone", skip=("-z",))
        w, d, h0, h1 = 0.42, 0.13, 0.5, 2.2
    g.box(-w, w, -d, d, h0, h1, "stone", skip=("-z",))
    # rounded head
    hh = 0.55 if big else 0.32
    pts = []
    for k in range(9):
        ang = math.pi * k / 8
        pts.append((-(w + 0.04) * math.cos(ang), h1 + hh * math.sin(ang)))
    for sy in (-1, 1):
        g.polyn([(x, sy * (d + 0.03), z) for x, z in [(w + 0.04, h1)] + pts[1:-1] + [(-(w + 0.04), h1)]], "stone", (0, sy, 0))
    for p, q in zip(pts, pts[1:]):
        g.polyn([(p[0], -d - 0.03, p[1]), (q[0], -d - 0.03, q[1]), (q[0], d + 0.03, q[1]), (p[0], d + 0.03, p[1])], "stone",
                (-(p[0] + q[0]) / 2, 0, (p[1] + q[1]) / 2 - h1))
    return g


def lathe_uv_geo(prof, segs):
    g = Geo()
    lathe_uv(g, prof, segs, "stone")
    return g


def ruin(g):
    """The 大雄宝殿's base: a stone platform with a moulded edge, paving, the column bases, steps at the front."""
    pts = [L(-6299 + x, -3849 + z) for x, z in RUIN_OSM]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs) + 0.4, max(xs) - 0.4, min(ys) + 0.4, max(ys) - 0.4
    h = 1.3
    g.box(x0, x1, y0, y1, 0.0, h - 0.15, "stone", skip=("-z", "+z"))
    g.box(x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, h - 0.15, h, "stone", skip=("-z",))
    cx = (x0 + x1) / 2
    cols_x = [x0 + 2.2 + (x1 - x0 - 4.4) * k / 6 for k in range(7)]
    cols_y = [y0 + 2.2 + (y1 - y0 - 4.4) * k / 3 for k in range(4)]
    for x in cols_x:
        for y in cols_y:
            g.box(x - 0.45, x + 0.45, y - 0.45, y + 0.45, h, h + 0.12, "stone", skip=("-z",))
            g.add(lathe_uv_geo([(0.33, 0.0), (0.33, 0.1), (0.25, 0.16), (0.0, 0.17)], 10), T(x, y, h + 0.12))
    n = 5
    for k in range(n):
        yy = y0 - 2.6 + 2.6 * k / n
        g.box(cx - 3.5, cx + 3.5, yy, y0, 0.0, h * (k + 1) / (n + 1), "stone", skip=("-z",))
    return (x0, x1, y0, y1, h, cx)


# --- build ---------------------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    M = make_materials()
    main = collection("五塔寺")
    det = collection("塔", main)
    helpers = collection("碰撞体")

    g = Geo()
    # the terrace: OSM's outline, a step down all round
    tp = [L(-6299 + x, -3849 + z) for x, z in PAGODA_OSM]
    txs, tys = [p[0] for p in tp], [p[1] for p in tp]
    TX, TY = (max(txs) - min(txs)) / 2 - 0.4, (max(tys) - min(tys)) / 2 - 0.4
    band(g, TX, TY, 0.0, TX, TY, TER, "stone")
    cap(g, TX, TY, TER, "paving")
    deck, (da, db) = platform(g)
    for side in (-1, 1):
        gate(g, side, (da, db))
    # the corner pagodas' and the middle one's places on the deck, the 罩亭 south of the middle
    corner = [(sx * (da - 2.15), sy * (db - 2.15)) for sx in (-1, 1) for sy in (-1, 1)]
    mid = (0.0, 1.0)
    zt_pos = (0.0, -(db - 2.0))
    g.build("Platform", det, M, TILE)
    tris = g.tris()

    pc = pagoda(11, 7.0, 2.9, False)
    pm = pagoda(13, 8.2, 3.6, True)
    zg, zt_top = zhaoting()
    me_c = mesh_of(pc, "CornerPagoda", M, TILE)
    me_m = mesh_of(pm, "MiddlePagoda", M, TILE)
    me_z = mesh_of(zg, "Zhaoting", M, TILE)
    parts = collection("塔顶", main)
    for i, (x, y) in enumerate(corner):
        place(me_c, f"CornerPagoda.{i}", parts, T(x, y, deck))
    place(me_m, "MiddlePagoda", parts, T(*mid, deck))
    place(me_z, "Zhaoting", parts, T(*zt_pos, deck))
    tris += 4 * pc.tris() + pm.tris() + zg.tris()

    # the precinct: the ruin, two old stele either side of the axis, the museum's stele along the west
    pg = Geo()
    rx0, rx1, ry0, ry1, rh, rcx = ruin(pg)
    pg.build("Ruin", collection("寺", main), M, TILE)
    tris += pg.tris()
    big, small = stele(True), stele(False)
    me_b, me_s = mesh_of(big, "SteleBig", M, TILE), mesh_of(small, "Stele", M, TILE)
    st = collection("碑", main)
    bigs = [(-9.5, -(TY + 4.5)), (9.5, -(TY + 4.5))]
    for i, (x, y) in enumerate(bigs):
        place(me_b, f"SteleBig.{i}", st, T(x, y, 0))
    smalls = [(-(TX + 9.0), -12.0 + 4.0 * k) for k in range(7)]
    for i, (x, y) in enumerate(smalls):
        place(me_s, f"Stele.{i}", st, T(x, y, 0) @ Rz(math.pi / 2))
    tris += 2 * big.tris() + 7 * small.tris()

    # far level: terrace, the platform as a tapered block with the niches, five stepped spires, the ruin's slab
    f = Geo()
    band(f, TX, TY, 0.0, TX, TY, TER, "stone")
    cap(f, TX, TY, TER, "paving")
    band(f, HX, HY, TER, HX, HY, TER + SUM, "waist", rep=3.0)
    a0, b0 = storey_sizes()[0]
    band(f, a0, b0, TER + SUM, da, db, deck, "niche", rep=2.4, v=(0.0, NST * 1.0))
    band(f, da, db, deck, da, db, deck + PAR, "stone")
    cap(f, da, db, deck + PAR * 0.5, "paving")
    for (x, y), w, hgt in [(c, 2.9, 7.0) for c in corner] + [(mid, 3.6, 8.2)]:
        fg = Geo()
        band(fg, w / 2, w / 2, 0.0, w / 2, w / 2, 0.86 + w * 0.42, "body", rep=w)
        band(fg, w / 2 + 0.2, w / 2 + 0.2, 0.86 + w * 0.42, 0.25, 0.25, hgt - 0.9, "eave", rep=0.6, v=(0.0, 6.0))
        cap(fg, 0.25, 0.25, hgt - 0.9, "stone")
        fg.box(-0.08, 0.08, -0.08, 0.08, hgt - 0.9, hgt, "bronze" if w > 3 else "stone", skip=("-z",))
        f.add(fg, T(x, y, deck))
    zf = Geo()
    band(zf, 1.6, 1.6, 0.0, 1.6, 1.6, 2.4, "wall")
    band(zf, 2.3, 2.3, 2.4, 0.0, 0.0, zt_top - 0.6, "glazeG", rep=0.6, v=(0.0, 3.0))
    f.add(zf, T(*zt_pos, deck))
    f.box(rx0, rx1, ry0, ry1, 0.0, rh, "stone", skip=("-z",))
    f.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: terrace, platform (to the parapet), pagodas and 罩亭 on top, the ruin with walk-only steps, stele
    def hull(name, pts, role="COL"):
        collider_pts(helpers, name, pts, role=role)

    def boxp(x0, x1, y0, y1, z0, z1):
        return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    hull("terrace", boxp(-TX, TX, -TY, TY, 0.0, TER))
    hull("platform", boxp(-HX - 0.1, HX + 0.1, -HY - 0.1, HY + 0.1, TER, TER + SUM) + boxp(-da, da, -db, db, deck, deck + PAR))
    for side in (-1, 1):
        hull(f"gate{side}", boxp(-1.8, 1.8, side * HY, side * (HY + 1.12), TER, TER + 4.4))
    for i, (x, y) in enumerate(corner):
        hull(f"pagoda{i}", boxp(x - 1.5, x + 1.5, y - 1.5, y + 1.5, deck, deck + 6.0))
    hull("pagodaM", boxp(mid[0] - 1.9, mid[0] + 1.9, mid[1] - 1.9, mid[1] + 1.9, deck, deck + 7.0))
    hull("zhaoting", boxp(zt_pos[0] - 1.7, zt_pos[0] + 1.7, zt_pos[1] - 1.7, zt_pos[1] + 1.7, deck, deck + 3.0))
    for side in (-1, 1):                    # steps up onto the terrace on its north and south sides
        y_out, y_in = side * (TY + 1.0), side * TY
        hull(f"terrace_steps{side}", [(-1.4, y_out, 0.0), (1.4, y_out, 0.0), (-1.4, y_in, 0.0), (1.4, y_in, 0.0), (-1.4, y_in, TER), (1.4, y_in, TER)], role="WALK")
    hull("ruin", boxp(rx0 - 0.1, rx1 + 0.1, ry0 - 0.1, ry1 + 0.1, 0.0, rh))
    hull("ruin_steps", [(rcx - 3.5, ry0 - 2.6, 0.0), (rcx + 3.5, ry0 - 2.6, 0.0), (rcx - 3.5, ry0, 0.0), (rcx + 3.5, ry0, 0.0),
                        (rcx - 3.5, ry0, rh), (rcx + 3.5, ry0, rh)], role="WALK")
    for i, (x, y) in enumerate(bigs):
        hull(f"stele_big{i}", boxp(x - 0.9, x + 0.9, y - 1.9, y + 1.9, 0.0, 4.4))
    for i, (x, y) in enumerate(smalls):
        hull(f"stele{i}", boxp(x - 0.3, x + 0.3, y - 0.5, y + 0.5, 0.0, 2.5))
    # terrace steps (drawn): north and south, three treads
    sg = Geo()
    for side in (-1, 1):
        for k in range(3):
            y_a = side * (TY + 1.0 - k * 1.0 / 3)
            sg.box(-1.4, 1.4, min(y_a, side * TY), max(y_a, side * TY), 0.0, TER * (k + 1) / 4, "stone", skip=("-z",))
    sg.build("TerraceSteps", det, M, TILE)
    tris += sg.tris()

    flat_marker(helpers, "pagoda", [(p[0], p[1]) for p in tp], "FOOTPRINT")
    flat_marker(helpers, "ruin", [L(-6299 + x, -3849 + z) for x, z in RUIN_OSM], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "wutasi", "五塔寺金刚宝座塔", "Five Pagoda Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 450
    s.repo_path = REPO
    return dict(tris=tris, far=f.tris(), deck=deck, top=deck + 8.2)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
