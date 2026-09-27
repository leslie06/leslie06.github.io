# 天安门 Tiananmen, the Gate of Heavenly Peace, built in Blender and marked with the bcity_landmark
# add-on's conventions, ready to edit and export (sidebar N > B城 > 导出到游戏). It replaces the
# hand-coded model (city/landmarks/tiananmen.ts) that the kit assembled from boxes and textures.
#
#   blender -b -P scripts/blender/landmarks/tiananmen.py -- [--out art/landmarks/tiananmen.blend] [--export]
#   (or with the bpy module: python scripts/blender/landmarks/tiananmen.py -- ...)
#
# The slogans need a CJK font: Noto Serif SC Bold (SIL OFL), the one the flower basket uses, in .cache/fonts/
# (see flower_basket.py's header). It is only read here - the glyphs become geometry.
#
# It clears the open file first: run it in a new file. Frame: Blender +X east, +Y north (the palace),
# -Y south (the square, the front), metres, origin on the ground at the centre of the platform - the
# same anchor as the old model (39.907338 N, 116.391265 E), turned -1.84 deg like the city's axis.
#
# What is here, from the real figures where they are known (34.7 m to the top of the ridge ornaments,
# a 9 x 5 bay tower with a double-eaved 歇山 roof on a 13.4 m platform with five gateways) and from
# photographs for the rest:
#   - the roofs as surfaces with the tile rows in the geometry (the silhouette of the eave is scalloped),
#     concave slopes, corners that sweep out and up, hip, ridge and gable ridges, 正吻, nine beasts and an
#     immortal on every hip, the gables (山花) and barge boards; soffits painted with rafter ends;
#   - 212 bracket sets (斗拱) as one instanced mesh, columns, 和玺 painted beams, lattice doors and windows
#     (lit from inside at night), the painted corridor ceiling, eight lanterns, the national emblem;
#   - the platform: battered red walls on a marble 须弥座 base, five vaulted gateways right through it
#     with their doors folded back, the yellow-capped parapet, the portrait and the two slogans in relief;
#   - in front: the five 外金水桥 over the river with their balustrades (a car can drive over them), two
#     pairs of stone lions and two pairs of 华表; either side, the four reviewing stands (观礼台), which
#     OSM draws as buildings with no height and the city used to raise into 40 m blocks (each stand and the
#     forecourt is its own FOOTPRINT piece, so only the buildings under them go).
# Everything painted is one 2048 x 1024 atlas drawn here with numpy, with a night emission map.
# The stone lions are metaballs, decimated. 174k triangles in 21 draw calls; the far level 826 in 5.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export, srgb  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tiananmen.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

# --- the figures (metres; Blender frame: x east, y north, z up) --------------------------------------
PLAT = dict(hw=59.0, hd=19.4, h=13.4, batter=0.9, base=1.6, base_out=0.55, par_h=1.1, par_t=0.8)
# the five gateways line up with the five bridges (OSM puts both at 0, +-13.8, +-24.8 from the axis)
ARCHES = [(0.0, 5.3, 8.0), (-13.8, 4.4, 7.2), (13.8, 4.4, 7.2), (-24.8, 3.8, 6.2), (24.8, 3.8, 6.2)]  # x, width, crown
TOWER_BASE = dict(hw=31.0, hd=13.6, z0=13.4, z1=14.9)
# nine bays across (the middle one widest), five deep; the upper storey stands on the inner ring
XS = [-28.0, -23.0, -17.2, -11.2, -4.9, 4.9, 11.2, 17.2, 23.0, 28.0]
YS = [-10.6, -5.6, -2.0, 2.0, 5.6, 10.6]
OX, OY, IX, IY = 28.0, 10.6, 23.0, 5.6          # outer (檐柱) and inner (金柱) column rings
COL_TOP, COL_R = 21.2, 0.42
BEAM = (21.2, 21.95, 22.15, 23.05)               # 额枋 bottom, 平板枋 bottom, brackets, bracket top
UBEAM = (27.0, 27.75, 27.95, 28.85)              # the same on the upper storey
OVERHANG = 4.5
LOWER = dict(A=OX + OVERHANG, D=OY + OVERHANG, z=22.4, H=3.2, p=1.3, o=1.1, lift=1.0, Lc=9.0, Vc=5.0)
UPPER = dict(A=IX + OVERHANG, D=IY + OVERHANG, z=28.0, H=5.0, p=1.6, o=1.0, lift=0.95, Lc=8.0, Vc=4.5)
GABLE_X = IX - 1.5                               # the 山花 plane; the roof runs 0.8 m past it
TILE_PITCH, TILE_AMP = 0.46, 0.1

# in front (y < 0): bridges (x, width, length, hump), their centre line crosses the river 63 m out
BRIDGES = [(0.0, 9.7, 41.0, 1.7), (-13.8, 7.7, 35.0, 1.35), (13.8, 7.7, 35.0, 1.35), (-24.8, 6.5, 34.0, 1.2), (24.8, 6.5, 34.0, 1.2)]
BRIDGE_Y = -63.0
HUABIAO = [(-21.0, -88.0), (21.0, -88.0), (-21.0, 48.0), (21.0, 48.0)]
LIONS = [(-7.6, -88.0, 1), (7.6, -88.0, -1), (-7.6, -27.5, 1), (7.6, -27.5, -1)]
# the reviewing stands (x0, x1, y_front, y_back), from OSM's four 观礼台 outlines in this frame
STANDS = [(-142.0, -48.0, -43.5, -30.5), (48.0, 142.0, -43.5, -30.5), (-240.0, -165.0, -36.0, -24.0), (165.0, 240.0, -36.0, -24.0)]

WHITE = (1.0, 1.0, 1.0)


# --- geometry buffer: faces with a material key, optional UVs (else planar by the dominant axis) -----

class Geo:
    def __init__(self, colors=False):
        self.v, self.c, self.f = [], [], []
        self.colors = colors

    def vert(self, p, col=WHITE):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.c.append(col)
        return len(self.v) - 1

    def face(self, idx, key, uvs=None, smooth=False):
        self.f.append((tuple(idx), uvs, key, smooth))

    def poly(self, pts, key, uvs=None, smooth=False, col=WHITE):
        self.face([self.vert(p, col) for p in pts], key, uvs, smooth)

    def polyn(self, pts, key, want, uvs=None, smooth=False, col=WHITE):
        """A polygon wound so its normal points along `want`."""
        pts = [Vector(p) for p in pts]
        n = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if n.dot(Vector(want)) < 0:
            pts = pts[::-1]
            uvs = uvs[::-1] if uvs else uvs
        self.poly(pts, key, uvs, smooth, col)

    def box(self, x0, x1, y0, y1, z0, z1, key, col=WHITE, skip=(), uvs=None):
        """Axis-aligned box; `skip` names faces to leave out ('-x', '+x', '-y', '+y', '-z', '+z')."""
        c = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        faces = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
        for k, f in faces.items():
            if k not in skip:
                self.poly([c[i] for i in f], key, (uvs or {}).get(k), col=col)

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.f)

    def build(self, name, coll, M, tile=None):
        """One object; `M` maps keys to materials, `tile` keys to metres per UV unit for planar mapping."""
        tile = tile or {}
        keys = []
        for f in self.f:
            if f[2] not in keys:
                keys.append(f[2])
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        col = bm.verts.layers.float_color.new("Col") if self.colors else None
        bv = [bm.verts.new(p) for p in self.v]
        if col is not None:
            for v, c in zip(bv, self.c):
                v[col] = (*c, 1.0)
        for idx, uvs, key, smooth in self.f:
            if len(set(idx)) < 3:
                continue
            try:
                f = bm.faces.new([bv[i] for i in idx])
            except ValueError:      # the same face twice
                continue
            f.material_index = keys.index(key)
            f.smooth = smooth
            if uvs is None:
                f.normal_update()
                n = f.normal
                ax = max(range(3), key=lambda k: abs(n[k]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                s = tile.get(key, 2.0)
                uvs = [(bv[i].co[a] / s, bv[i].co[b] / s) for i in idx]
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for k in keys:
            me.materials.append(M[k])
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


def mesh_of(geo, name, M, tile=None):
    """A mesh datablock (for linked duplicates) from a Geo."""
    ob = geo.build(name, bpy.context.scene.collection, M, tile)
    me = ob.data
    bpy.data.objects.remove(ob)
    return me


def place(me, name, coll, m):
    o = bpy.data.objects.new(name, me)
    o.matrix_world = m
    coll.objects.link(o)
    return o


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(a):
    return Matrix.Rotation(a, 4, "Z")


# --- painting with numpy (drawn top-down: row 0 is the top; flipped into Blender's order at the end) --

class Canvas:
    def __init__(self, w, h, col="#000000"):
        self.w, self.h = w, h
        self.a = np.empty((h, w, 3), np.float32)
        self.a[:] = srgb(col)
        self.y, self.x = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5

    def c(self, col):
        return srgb(col) if isinstance(col, str) else np.asarray(col, np.float32)

    def put(self, mask, col):
        self.a[mask] = self.c(col)

    def rect(self, x0, y0, x1, y1, col):
        self.a[max(0, int(y0)):max(0, int(y1)), max(0, int(x0)):max(0, int(x1))] = self.c(col)

    def frame(self, x0, y0, x1, y1, t, col):
        self.rect(x0, y0, x1, y0 + t, col)
        self.rect(x0, y1 - t, x1, y1, col)
        self.rect(x0, y0, x0 + t, y1, col)
        self.rect(x1 - t, y0, x1, y1, col)

    def ellipse(self, cx, cy, rx, ry, col):
        self.put(((self.x - cx) / rx) ** 2 + ((self.y - cy) / ry) ** 2 <= 1, col)

    def ring(self, cx, cy, r0, r1, col):
        d = np.hypot(self.x - cx, self.y - cy)
        self.put((d >= r0) & (d <= r1), col)

    def poly_mask(self, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1 = max(0, int(min(xs))), min(self.w, int(max(xs)) + 2)
        y0, y1 = max(0, int(min(ys))), min(self.h, int(max(ys)) + 2)
        m = np.zeros((self.h, self.w), bool)
        if x1 <= x0 or y1 <= y0:
            return m
        X, Y = self.x[y0:y1, x0:x1], self.y[y0:y1, x0:x1]
        inside = np.zeros(X.shape, bool)
        n = len(pts)
        for i in range(n):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
            if ay == by:
                continue
            cross = (ay > Y) != (by > Y)
            xint = (bx - ax) * (Y - ay) / (by - ay) + ax
            inside ^= cross & (X < xint)
        m[y0:y1, x0:x1] = inside
        return m

    def poly(self, pts, col):
        self.put(self.poly_mask(pts), col)

    def line(self, x0, y0, x1, y1, w, col):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1.0
        t = np.clip(((self.x - x0) * dx + (self.y - y0) * dy) / L2, 0, 1)
        d = np.hypot(self.x - (x0 + t * dx), self.y - (y0 + t * dy))
        self.put(d <= w / 2, col)

    def star(self, cx, cy, r, col, rot=0.0):
        pts = []
        for i in range(10):
            a = -math.pi / 2 + rot + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.382
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.poly(pts, col)

    def noise(self, amt, seed, scale=1.0):
        rng = np.random.default_rng(seed)
        self.a *= (1 - amt / 2 + amt * rng.random((self.h, self.w, 1), np.float32)) ** scale


def lattice(cv, x0, y0, x1, y1, back, bar, s=22.0, w=3.2):
    """三交六椀菱花: three families of bars (level and +-60 deg) over a dark backing."""
    cv.rect(x0, y0, x1, y1, back)
    X, Y = cv.x, cv.y
    box = (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1)
    hit = np.zeros(X.shape, bool)
    for a in (0.0, math.pi / 3, -math.pi / 3):
        d = np.mod(-X * math.sin(a) + Y * math.cos(a), s)
        hit |= (d < w / 2) | (d > s - w / 2)
    cv.put(box & hit, bar)
    return box & ~hit       # the holes: paper lit from inside at night


def leaves(cv, glow, x0, y0, x1, y1, n, sill=None):
    """n 隔扇 leaves side by side: frame, lattice (格心), and below it the panels (or a sill wall)."""
    red, gold = "#861b15", "#c99a45"
    lw = (x1 - x0) / n
    top = y0 + (y1 - y0) * 0.08
    lat_end = y0 + (y1 - y0) * (0.62 if sill is None else 0.94)
    holes = lattice(cv, x0 + 4, y0 + 4, x1 - 4, top - 3, "#2c0f0b", gold, s=16, w=2.6)   # the transom
    for i in range(n):
        a, b = x0 + i * lw, x0 + (i + 1) * lw
        cv.frame(a, top, b, y1, 7, red)
        holes |= lattice(cv, a + 9, top + 9, b - 9, lat_end, "#2c0f0b", gold)
        cv.frame(a + 9, top + 9, b - 9, lat_end, 2, gold)
        if sill is None:
            p0 = lat_end + 8
            cv.rect(a + 7, lat_end, b - 7, y1 - 7, red)
            cv.frame(a + 12, p0, b - 12, p0 + (y1 - p0) * 0.18, 2, gold)
            q0 = p0 + (y1 - p0) * 0.26
            cv.frame(a + 12, q0, b - 12, y1 - 16, 2, gold)
            cv.ellipse((a + b) / 2, (q0 + y1 - 16) / 2, lw * 0.22, (y1 - 16 - q0) * 0.3, gold)
    if sill is not None:
        cv.rect(x0, lat_end + 4, x1, y1, sill)
    cv.frame(x0, y0, x1, y1, 4, gold)
    glow.put(holes, (0.3, 0.19, 0.08))       # paper lit from inside: a warm glow, not a lamp


# atlas regions, in pixels from the top-left of a 2048 x 1024 image
ATLAS_W, ATLAS_H = 2048, 1024
REG = dict(
    door=(0, 0, 512, 512), window=(512, 0, 1024, 512), gatedoor=(1024, 0, 1280, 512), portrait=(1280, 0, 1792, 416),
    rafters=(1792, 0, 2048, 256), ceiling=(1792, 256, 2048, 512), emblem=(0, 512, 512, 1024), band=(512, 512, 1024, 768),
    gable=(512, 768, 1024, 1024), beam=(1024, 512, 2048, 640), plank=(1024, 640, 2048, 704), stand=(1024, 704, 1536, 960),
)


def uv(region, fu, fv):
    """Region-local (fu across, fv up, both 0..1) to atlas UV (v up), 3 px in from the region's edge."""
    x0, y0, x1, y1 = REG[region]
    x0, y0, x1, y1 = x0 + 3, y0 + 3, x1 - 3, y1 - 3
    return ((x0 + fu * (x1 - x0)) / ATLAS_W, 1 - (y1 - fv * (y1 - y0)) / ATLAS_H)


def uvs(region, pairs):
    return [uv(region, a, b) for a, b in pairs]


QUAD = ((0, 0), (1, 0), (1, 1), (0, 1))


def paint_atlas():
    cv, glow = Canvas(ATLAS_W, ATLAS_H, "#7a1a14"), Canvas(ATLAS_W, ATLAS_H, "#000000")

    def sub(name):
        x0, y0, x1, y1 = REG[name]
        return Canvas(x1 - x0, y1 - y0, "#000000"), Canvas(x1 - x0, y1 - y0, "#000000")

    def paste(name, c, g):
        x0, y0, x1, y1 = REG[name]
        cv.a[y0:y1, x0:x1] = c.a
        glow.a[y0:y1, x0:x1] = g.a

    # doors: four leaves; windows: four leaves over a red sill wall; the upper storey's band: eight
    c, g = sub("door")
    leaves(c, g, 0, 0, 512, 512, 4)
    paste("door", c, g)
    c, g = sub("window")
    leaves(c, g, 0, 0, 512, 512, 4, sill="#a3301f")
    paste("window", c, g)
    c, g = sub("band")
    leaves(c, g, 0, 0, 512, 256, 8, sill="#a3301f")
    paste("band", c, g)

    # a gateway's door leaf: red, nine rows of nine gilt studs, the ring knocker
    c, g = sub("gatedoor")
    c.a[:] = srgb("#98201a")
    c.noise(0.08, 3)
    for i in range(9):
        for j in range(9):
            c.ellipse(34 + j * 23.5, 40 + i * 50, 8.5, 8.5, "#d8a83f")
            c.ellipse(32 + j * 23.5, 38 + i * 50, 3, 3, "#f3d88a")
    c.ring(128, 262, 18, 27, "#d8a83f")
    c.frame(0, 0, 256, 512, 6, "#5e120e")
    paste("gatedoor", c, g)

    # the portrait: a painted figure (no likeness is attempted) in a gilt frame
    c, g = sub("portrait")
    w, h = 512, 416
    c.a[:] = srgb("#4a3a22")
    c.rect(14, 14, w - 14, h - 14, "#b08a3c")
    grad = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    c.a[24:h - 24, 24:w - 24] = (srgb("#aeb8bb") * (1 - grad[24:h - 24]) + srgb("#8d989d") * grad[24:h - 24])
    c.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.44, "#4d5751")
    c.poly([(w * 0.43, h * 0.62), (w / 2, h * 0.8), (w * 0.57, h * 0.62)], "#3e4742")
    c.ellipse(w / 2, h * 0.43, w * 0.115, h * 0.19, "#d6a68a")
    c.ellipse(w / 2 + 6, h * 0.47, w * 0.08, h * 0.13, "#c9967a")
    c.ellipse(w / 2, h * 0.3, w * 0.12, h * 0.085, "#2a2522")
    g.a[:] = c.a * 0.35
    paste("portrait", c, g)

    # painted rafters under the eave: fv 0 is the eave, flying-rafter ends then round rafter ends
    c, g = sub("rafters")
    c.a[:] = srgb("#10261c")
    for k in range(8):
        x = 4 + k * 32
        c.rect(x, 0, x + 22, 256, "#21523b")
        c.rect(x, 256 - 30, x + 22, 256 - 6, "#2d7a54")
        c.frame(x + 3, 256 - 27, x + 19, 256 - 9, 2, "#d7a846")
        c.ellipse(x + 11, 256 - 50, 11, 11, "#1d4d92")
        c.ring(x + 11, 256 - 50, 4, 7, "#f2efe6")
    paste("rafters", c, g)

    # the corridor ceiling (天花): green grid, dark panels, a gilt roundel in each
    c, g = sub("ceiling")
    c.a[:] = srgb("#2c6a4e")
    c.rect(16, 16, 240, 240, "#1a3b4a")
    c.frame(16, 16, 240, 240, 3, "#d2a441")
    c.ring(128, 128, 30, 44, "#2c6a4e")
    c.ellipse(128, 128, 30, 30, "#d2a441")
    c.ellipse(128, 128, 9, 9, "#b3261c")
    paste("ceiling", c, g)

    # the national emblem, simplified: the gate in gold under five stars in a ring of wheat, the cogwheel
    c, g = sub("emblem")
    R = 256
    c.a[:] = srgb("#c3261a")
    c.ring(R, R, 200, 256, "#d8a53a")
    for k in range(44):
        a = k / 44 * 2 * math.pi
        c.line(R + 214 * math.cos(a), R + 214 * math.sin(a), R + 246 * math.cos(a + 0.09), R + 246 * math.sin(a + 0.09), 5, "#a8761c")
    gold = "#f2c14e"
    c.star(R, 118, 46, gold)
    for a in (150, 118, 62, 30):         # four small stars in an arc under the big one, each pointing at it
        x, y = R + 84 * math.cos(math.radians(a)), 118 + 84 * math.sin(math.radians(a))
        c.star(x, y, 15, gold, rot=math.atan2(118 - y, R - x) + math.pi / 2)
    c.rect(150, 322, 362, 360, gold)
    for x, ww in ((256, 16), (220, 11), (292, 11)):
        c.poly([(x - ww / 2, 360), (x - ww / 2, 342), (x, 334), (x + ww / 2, 342), (x + ww / 2, 360)], "#c3261a")
    c.rect(176, 290, 336, 322, gold)
    c.poly([(152, 292), (360, 292), (330, 276), (182, 276)], gold)
    c.rect(200, 262, 312, 276, gold)
    c.poly([(186, 264), (326, 264), (300, 244), (212, 244)], gold)
    c.rect(214, 238, 298, 244, gold)
    c.ellipse(R, 410, 30, 30, gold)
    for k in range(12):
        a = k / 12 * 2 * math.pi
        c.ellipse(R + 34 * math.cos(a), 410 + 34 * math.sin(a), 6, 6, gold)
    c.ellipse(R, 410, 12, 12, "#c3261a")
    c.poly([(120, 380), (220, 402), (292, 402), (392, 380), (400, 396), (292, 420), (220, 420), (112, 396)], "#b21e16")
    g.a[:] = c.a * 0.5
    paste("emblem", c, g)

    # 和玺彩画 on a beam, one bay: blue and green, gold outlines, the long 枋心 panel in the middle
    c, g = sub("beam")
    W, H = 1024, 128
    blue, green, gold = "#1d4a8c", "#256e53", "#d9a93a"
    c.a[:] = srgb(green)
    for x0 in (0, W - 40):
        c.rect(x0, 0, x0 + 40, H, blue)
        c.rect(x0 + 17, 0, x0 + 23, H, gold)
    for s in (1, -1):
        cx = 40 if s == 1 else W - 40
        for k in range(3):
            tip = cx + s * (80 + 70 * k)
            c.line(cx + s * 70 * k, 4, tip, H / 2, 6, gold)
            c.line(tip, H / 2, cx + s * 70 * k, H - 4, 6, gold)
        c.poly([(cx + s * 140, 8), (cx + s * 210, H / 2), (cx + s * 140, H - 8), (cx + s * 70, H / 2)], blue)
    fx0, fx1 = 300, W - 300
    c.poly([(fx0, H / 2), (fx0 + 40, 10), (fx1 - 40, 10), (fx1, H / 2), (fx1 - 40, H - 10), (fx0 + 40, H - 10)], gold)
    c.poly([(fx0 + 8, H / 2), (fx0 + 44, 17), (fx1 - 44, 17), (fx1 - 8, H / 2), (fx1 - 44, H - 17), (fx0 + 44, H - 17)], blue)
    xs = np.linspace(fx0 + 60, fx1 - 60, 200)
    ys = H / 2 + 26 * np.sin((xs - fx0) / 38)
    for i in range(len(xs) - 1):
        c.line(xs[i], ys[i], xs[i + 1], ys[i + 1], 7, gold)
    for x in (fx0 + 120, W / 2, fx1 - 120):
        c.ellipse(x, H / 2 - 4, 9, 9, "#f3d27a")
    c.rect(0, 0, W, 4, gold)
    c.rect(0, H - 4, W, H, gold)
    paste("beam", c, g)

    # 平板枋 / 垫板: blue with a run of gilt dots
    c, g = sub("plank")
    c.a[:] = srgb("#1d4a8c")
    for k in range(16):
        c.ellipse(32 + k * 64, 32, 14, 10, "#d9a93a")
        c.ellipse(32 + k * 64, 32, 6, 4, "#2a6f55")
    c.rect(0, 0, 1024, 4, "#d9a93a")
    c.rect(0, 60, 1024, 64, "#d9a93a")
    paste("plank", c, g)

    # the gable (山花): vermilion with a gilt 绶带 bow; the triangle's apex is the top centre
    c, g = sub("gable")
    W, H = 512, 256
    c.a[:] = srgb("#9a2218")
    c.noise(0.06, 5)
    c.line(0, H, W / 2, 0, 10, "#d9a93a")
    c.line(W / 2, 0, W, H, 10, "#d9a93a")
    c.ellipse(W / 2, H * 0.58, 34, 34, "#d9a93a")
    c.ellipse(W / 2, H * 0.58, 22, 22, "#9a2218")
    for s in (1, -1):
        xs = np.linspace(0, 150, 60)
        for i in range(len(xs) - 1):
            c.line(W / 2 + s * (30 + xs[i]), H * 0.58 + 22 * math.sin(xs[i] / 22), W / 2 + s * (30 + xs[i + 1]), H * 0.58 + 22 * math.sin(xs[i + 1] / 22), 9, "#d9a93a")
    paste("gable", c, g)

    # the reviewing stands' front: vermilion wall, a white band of balusters under the coping
    c, g = sub("stand")
    c.a[:] = srgb("#a8321f")
    c.noise(0.07, 9)
    c.rect(0, 0, 512, 40, "#e7e2d6")
    for k in range(16):
        c.rect(8 + k * 32, 8, 20 + k * 32, 36, "#b9b3a6")
    paste("stand", c, g)

    return image("TAM_Atlas", np.flipud(cv.a).copy()), image("TAM_AtlasNight", np.flipud(glow.a).copy())


def plaster(size=512):
    """Vermilion lime plaster, weathered, faint vertical streaks (4 m per repeat)."""
    cv = Canvas(size, size, "#ad3420")
    rng = np.random.default_rng(11)
    streak = 1 + 0.05 * np.sin(cv.x * 0.21 + 3 * np.sin(cv.x * 0.013)) * rng.random((1, size), np.float32)
    cv.a *= streak[..., None]
    cv.noise(0.08, 12)
    return image("TAM_Plaster", np.flipud(cv.a).copy())


def paving(size=512):
    """Grey stone flags with dark joints (4 m per repeat, a flag every metre, courses offset)."""
    cv = Canvas(size, size, "#a29e94")
    cv.noise(0.1, 21)
    q = size // 4
    rows = (cv.y // q).astype(int)
    joint = (np.mod(cv.y, q) < 2.5) | (np.mod(cv.x + (rows % 2) * q / 2, q) < 2.5)
    cv.put(joint, "#6f6b63")
    rng = np.random.default_rng(22)
    tint = rng.uniform(0.94, 1.05, (5, 9))
    cv.a *= tint[rows, (np.mod(cv.x + (rows % 2) * q / 2, size) // q).astype(int)][..., None]
    return image("TAM_Paving", np.flipud(cv.a).copy())


# --- roofs --------------------------------------------------------------------------------------------
# A roof face is built in a canonical frame: the eave runs along u (-A..A) at plan distance v = 0, the
# face climbs inward to v = top, and its half-width is w(v) = max(A - v, cap): 45-degree hips, and on a
# 歇山 the front slope runs on past the hips to the gable (cap). Height is a concave curve of v alone
# (steep near the ridge, flat at the eave), the same on every face of a roof, so the faces meet on the
# hips. Near a corner the eave sweeps out and up; the push is the same on both faces at the hip.
# rot turns the frame: 0 = the south face (eave at y = -Deave), 1 east, 2 north, 3 west.

def to_world(rot, Deave, u, v, z):
    x, y = u, -Deave + v
    for _ in range(rot):
        x, y = -y, x
    return Vector((x, y, z))


def roof_z(R, Dref, v):
    return R["z"] + R["H"] * (max(0.0, v) / Dref) ** R["p"]


def roof_point(R, Dref, A, cap, u, v):
    """Canonical (u, v, z) of the surface, corner sweep included."""
    w = max(A - v, cap)
    g = max(0.0, w - abs(u))
    k = max(0.0, 1 - g / R["Lc"]) ** 2 * max(0.0, 1 - v / R["Vc"]) ** 1.5
    s = 1.0 if u >= 0 else -1.0
    return u + s * R["o"] * k, v - R["o"] * k, roof_z(R, Dref, v) + R["lift"] * k


def smooth01(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def tile_wave(u):
    """Tile rows across the slope: round tube tiles, the pan tiles sunk between them."""
    ph = (u / TILE_PITCH) % 1.0
    return math.sqrt(max(0.0, 1 - ((ph - 0.25) / 0.25) ** 2)) if ph < 0.5 else -0.3 * math.sin(math.pi * (ph - 0.5) / 0.5)


def roof_face(g, R, Dref, rot, A, Deave, top, cap=0.0, rows=10, waves=True, key="tile", cols=None):
    """One face of tiles. Returns the rows of world points (each row a list, eave first) for the ridges."""
    q = TILE_PITCH / 4
    out = []
    prev = None
    for j in range(rows + 1):
        v = top * (j / rows) ** 1.15
        w = max(A - v, cap)
        if waves:
            k0, k1 = math.ceil(-w / q - 0.125 + 1e-3), math.floor(w / q - 0.125 - 1e-3)
            us = [-w] + [(k + 0.125) * q for k in range(k0, k1 + 1)] + [w]
        else:
            n = cols or 8
            us = [-w + 2 * w * i / n for i in range(n + 1)]
        dzdv = R["H"] * R["p"] * (max(v, 1e-3) / Dref) ** (R["p"] - 1) / Dref
        nz = Vector((0.0, -dzdv, 1.0)).normalized()
        row = []
        for u in us:
            cu, cv, cz = roof_point(R, Dref, A, cap, u, v)
            p = Vector((cu, cv, cz))
            if waves:
                fade = smooth01((w - abs(u)) / 0.6) * smooth01((top - v) / 0.7)
                p += nz * (TILE_AMP * tile_wave(u) * fade)
            row.append((u, g.vert(to_world(rot, Deave, p.x, p.y, p.z))))
        if prev is not None:
            i = k = 0
            while i < len(prev) - 1 or k < len(row) - 1:
                if k == len(row) - 1 or (i < len(prev) - 1 and prev[i + 1][0] <= row[k + 1][0]):
                    g.face((prev[i][1], prev[i + 1][1], row[k][1]), key, smooth=True)
                    i += 1
                else:
                    g.face((prev[i][1], row[k + 1][1], row[k][1]), key, smooth=True)
                    k += 1
        out.append([Vector(g.v[idx]) for _, idx in row])
        prev = row
    return out


def eave_edge(g, row0, drop=0.3, key="tile"):
    """The tile ends along the eave: the scalloped edge carried down as a strip."""
    for a, b in zip(row0, row0[1:]):
        d = Vector((0, 0, -drop))
        g.poly([a, a + d, b + d, b], key, smooth=True)


def soffit(g, R, Dref, rot, A, Deave, zb, cap=0.0, span=OVERHANG, tile=2.4):
    """Underside of the eave from the eave (0.3 m under the tile edge) up to zb over the column line."""
    rows = []
    for v in (0.0, span / 2, span):
        w = max(A - v, cap)
        n = max(2, round(2 * max(A, cap) / tile))
        # at least 0.28 m under the tiles all the way up, or the rafters show through the pans
        thick = max(0.28, 0.3 + (roof_z(R, Dref, span) - zb - 0.3) * (v / span))
        row = []
        for i in range(n + 1):
            u = -w + 2 * w * i / n
            cu, cv, cz = roof_point(R, Dref, A, cap, u, v)
            row.append(to_world(rot, Deave, cu, cv, cz - thick))
        rows.append(row)
    for j, (r0, r1) in enumerate(zip(rows, rows[1:])):
        for i in range(len(r0) - 1):
            g.polyn([r0[i], r0[i + 1], r1[i + 1], r1[i]], "atlas", (0, 0, -1),
                    uvs=uvs("rafters", ((0, j / 2), (1, j / 2), (1, (j + 1) / 2), (0, (j + 1) / 2))))


def sweep(g, pts, wd, ht, key="tile", sink=0.15, cap_ends=True):
    """A ridge along a polyline: a trapezoid section standing ht over the line, sunk `sink` into the tiles."""
    if len(pts) < 2:
        return
    secs = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(up)
        side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
        n = side.cross(t).normalized()
        if n.z < 0:
            n = -n
        secs.append([p + side * (-wd / 2) - n * sink, p + side * (-wd / 2 * 0.8) + n * ht, p + side * (wd / 2 * 0.8) + n * ht, p + side * (wd / 2) - n * sink])
    for a, b in zip(secs, secs[1:]):
        for k in range(3):
            g.poly([a[k], b[k], b[k + 1], a[k + 1]], key)
    if cap_ends:
        g.poly(secs[0][::-1], key)
        g.poly(secs[-1], key)


def wen(g, x, zt, facing):
    """正吻: the ridge-end dragon - jaws open round the ridge, a back of fins, the tail curling up and out."""
    prof = [(-0.95, 0.0), (0.6, 0.0), (0.7, 0.4), (0.72, 0.9), (0.8, 1.3), (0.98, 1.7), (1.1, 2.05), (1.0, 2.35), (0.75, 2.45),
            (0.5, 2.35), (0.42, 2.12), (0.55, 1.95), (0.4, 1.85), (0.2, 2.0), (0.05, 1.85), (-0.1, 2.02), (-0.25, 1.85),
            (-0.4, 1.95), (-0.5, 1.7), (-0.62, 1.45), (-0.85, 1.3), (-0.95, 1.05), (-0.6, 0.95), (-0.75, 0.6), (-0.95, 0.45)]
    t = 0.28
    front = [Vector((x + facing * px, -t, zt + pz)) for px, pz in prof]
    back = [Vector((x + facing * px, t, zt + pz)) for px, pz in prof]
    g.polyn(front, "tile", (0, -1, 0))
    g.polyn(back, "tile", (0, 1, 0))
    cx = sum(p.x for p in front) / len(front)
    for i in range(len(prof)):
        k = (i + 1) % len(prof)
        mid = (front[i] + front[k]) / 2
        g.polyn([front[i], front[k], back[k], back[i]], "tile", (mid.x - cx, 0, mid.z - (zt + 1.2)))
    # the curl of the tail, a boss on each side; the sword handle (剑把) stuck in its back
    for sy in (-1, 1):
        cyl_y(g, x + facing * 0.78, sy * t, zt + 2.15, 0.2, sy * 0.08, "tile")
    g.box(x + facing * 0.1 - 0.07, x + facing * 0.1 + 0.07, -0.09, 0.09, zt + 1.9, zt + 2.6, "tile")


def cyl_y(g, x, y, z, r, dy, key, segs=10):
    """A short disc along Y from y to y + dy."""
    a = [Vector((x + r * math.cos(2 * math.pi * i / segs), y, z + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)]
    b = [p + Vector((0, dy, 0)) for p in a]
    g.polyn(b, key, (0, 1 if dy > 0 else -1, 0))
    for i in range(segs):
        k = (i + 1) % segs
        g.poly([a[i], a[k], b[k], b[i]], key, smooth=True)


def beasts_on(line, coll, meshes, tag):
    """仙人走兽 down a hip: the immortal at the corner, nine beasts behind him, on the ridge's top."""
    lo, hi = line[0], line[-1]
    d = Vector((lo.x - hi.x, lo.y - hi.y, 0))
    yaw = math.atan2(d.x, -d.y) if d.length > 1e-6 else 0.0
    # arc length along the line from the corner
    acc = [0.0]
    for a, b in zip(line, line[1:]):
        acc.append(acc[-1] + (b - a).length)

    def at(s):
        for i in range(len(line) - 1):
            if acc[i + 1] >= s:
                t = (s - acc[i]) / max(1e-6, acc[i + 1] - acc[i])
                return line[i].lerp(line[i + 1], t)
        return line[-1]
    out = []
    for k in range(10):
        p = at(0.75 + 0.48 * k) + Vector((0, 0, 0.3))
        out.append(place(meshes["immortal" if k == 0 else "beast"], f"{tag}.{k}", coll, T(*p) @ Rz(yaw)))
    return out


# --- small parts (each one mesh, linked many times: the game draws each as one instanced mesh) ---------

def cyl(g, x, y, z0, z1, r0, r1, segs, key, smooth=True, caps=(False, True), col=WHITE):
    ring0 = [Vector((x + r0 * math.cos(2 * math.pi * i / segs), y + r0 * math.sin(2 * math.pi * i / segs), z0)) for i in range(segs)]
    ring1 = [Vector((x + r1 * math.cos(2 * math.pi * i / segs), y + r1 * math.sin(2 * math.pi * i / segs), z1)) for i in range(segs)]
    a = [g.vert(p, col) for p in ring0]
    b = [g.vert(p, col) for p in ring1]
    for i in range(segs):
        k = (i + 1) % segs
        g.face((a[i], a[k], b[k], b[i]), key, smooth=smooth)
    if caps[0]:
        g.poly(ring0[::-1], key, col=col)
    if caps[1]:
        g.poly(ring1, key, col=col)


def lathe(g, prof, segs, key, x=0.0, y=0.0, col=WHITE, smooth=True):
    """Surface of revolution from (r, z) pairs, bottom to top."""
    rings = [[g.vert((x + r * math.cos(2 * math.pi * i / segs), y + r * math.sin(2 * math.pi * i / segs), z), col) for i in range(segs)] for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            k = (i + 1) % segs
            g.face((a[i], a[k], b[k], b[i]), key, smooth=smooth)


def ell(g, c, r, key, col=WHITE, nu=10, nv=6, m=None):
    """Ellipsoid at c with radii r (optionally through matrix m)."""
    def P(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        p = Vector((c[0] + r[0] * math.sin(ph) * math.cos(th), c[1] + r[1] * math.sin(ph) * math.sin(th), c[2] - r[2] * math.cos(ph)))
        return m @ p if m is not None else p
    bot, top = g.vert(P(0, 0), col), g.vert(P(0, 1), col)
    rings = [[g.vert(P(i / nu, j / nv), col) for i in range(nu)] for j in range(1, nv)]
    for i in range(nu):
        k = (i + 1) % nu
        g.face((bot, rings[0][k], rings[0][i]), key, smooth=True)
        g.face((top, rings[-1][i], rings[-1][k]), key, smooth=True)
        for j in range(nv - 2):
            g.face((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]), key, smooth=True)


def column_geo(h):
    g = Geo()
    cyl(g, 0, 0, 0.0, 0.22, 0.64, 0.6, 16, "marble", caps=(False, True))
    cyl(g, 0, 0, 0.22, h, COL_R, COL_R * 0.95, 16, "red", caps=(False, False))
    return g


def bracket_geo():
    """斗拱, projecting to -Y from the beam: block, crossed arms in two tiers, the beak (昂), gilt edges."""
    g = Geo(colors=True)
    blue, green, dark = linear("#1d4a8c"), linear("#256e53"), linear("#173a2c")
    g.box(-0.24, 0.24, -0.24, 0.24, 0.0, 0.2, "paint", green)
    g.box(-0.62, 0.62, -0.09, 0.09, 0.2, 0.38, "paint", blue)
    g.box(-0.09, 0.09, -0.58, 0.28, 0.2, 0.38, "paint", green)
    for x, y in ((-0.62, 0.0), (0.62, 0.0), (0.0, -0.58)):
        g.box(x - 0.1, x + 0.1, y - 0.1, y + 0.1, 0.38, 0.5, "paint", green)
    g.box(-0.86, 0.86, -0.09, 0.09, 0.5, 0.68, "paint", blue)
    g.box(-0.5, 0.5, -0.67, -0.49, 0.5, 0.68, "paint", blue)
    g.box(-0.09, 0.09, -1.02, 0.3, 0.68, 0.88, "paint", green)
    # the beak: a sloping bar from inside the stack down to a point out front
    a = [(-0.09, 0.25, 0.5), (0.09, 0.25, 0.5), (0.09, 0.25, 0.68), (-0.09, 0.25, 0.68)]
    b = [(-0.07, -1.12, 0.36), (0.07, -1.12, 0.36), (0.07, -1.1, 0.5), (-0.07, -1.1, 0.5)]
    for i in range(4):
        k = (i + 1) % 4
        g.poly([a[i], a[k], b[k], b[i]], "paint", col=dark if i == 0 else green)
    g.poly(b[::-1], "paint", col=dark)
    for x in (-0.86, 0.86):
        g.box(x - 0.1, x + 0.1, -0.1, 0.1, 0.68, 0.8, "paint", green)
    return g


def beast_geo(immortal=False):
    """A ridge beast (走兽) sitting on the ridge facing -Y, or the immortal on his hen (仙人)."""
    g = Geo(colors=True)
    yel, grn, dk = linear("#d9a02a"), linear("#3c7a3a"), linear("#8a5a12")
    g.box(-0.1, 0.1, -0.14, 0.14, 0.0, 0.06, "paint", yel)
    if immortal:
        ell(g, (0, 0.02, 0.16), (0.1, 0.16, 0.09), "paint", yel, 8, 5)       # the hen
        ell(g, (0, -0.14, 0.22), (0.05, 0.05, 0.05), "paint", yel, 6, 4)
        cyl(g, 0, 0.02, 0.2, 0.42, 0.07, 0.05, 8, "paint", col=grn)          # the rider
        ell(g, (0, 0.02, 0.47), (0.055, 0.055, 0.06), "paint", yel, 8, 5)
    else:
        ell(g, (0, 0.03, 0.16), (0.075, 0.1, 0.11), "paint", yel, 8, 5)
        ell(g, (0, -0.08, 0.3), (0.065, 0.07, 0.065), "paint", yel, 8, 5)
        ell(g, (0, -0.15, 0.28), (0.035, 0.05, 0.03), "paint", dk, 6, 4)
        g.box(-0.015, 0.015, -0.04, 0.02, 0.34, 0.42, "paint", yel)
    return g


def lantern_geo(ceiling):
    """A great red lantern hanging from the corridor ceiling (origin at its centre)."""
    g = Geo()
    R, H = 0.95, 1.9
    prof = [(R * (0.5 + 0.5 * math.sin(math.pi * t)), -H / 2 + t * H) for t in [i / 10 for i in range(11)]]
    lathe(g, prof, 16, "lantern")
    cyl(g, 0, 0, -H / 2 - 0.16, -H / 2 + 0.04, R * 0.52, R * 0.52, 16, "gold", caps=(True, False))
    cyl(g, 0, 0, H / 2 - 0.04, H / 2 + 0.16, R * 0.52, R * 0.46, 16, "gold")
    cyl(g, 0, 0, -H / 2 - 1.0, -H / 2 - 0.16, 0.22, 0.07, 10, "lantern", caps=(True, False))
    cyl(g, 0, 0, H / 2 + 0.16, ceiling, 0.035, 0.035, 6, "red", smooth=False)
    return g


def post_geo():
    """A marble baluster post (望柱) with its round cap, 1.3 m."""
    g = Geo()
    g.box(-0.12, 0.12, -0.12, 0.12, 0.0, 1.0, "marble")
    lathe(g, [(0.14, 1.0), (0.1, 1.08), (0.14, 1.17), (0.06, 1.3), (0.0, 1.32)], 6, "marble")
    return g


def panel_geo():
    """A balustrade panel (栏板) one metre long along +X (scaled to fit), with its hand rail."""
    g = Geo()
    g.box(0.0, 1.0, -0.07, 0.07, 0.0, 0.1, "marble")
    g.box(0.0, 1.0, -0.05, 0.05, 0.1, 0.62, "marble")
    g.box(0.0, 1.0, -0.09, 0.09, 0.62, 0.72, "marble")
    g.box(0.0, 1.0, -0.06, 0.06, 0.72, 0.86, "marble")
    return g


def balustrade(coll, meshes, pts, tag, gap=1.9, skip=()):
    """Posts and panels along a polyline of ground points; `skip` boxes (x0, x1, y0, y1) leave openings."""
    posts, n = {}, 0
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        k = max(1, round((b - a).length / gap))
        for i in range(k):
            p0, p1 = a.lerp(b, i / k), a.lerp(b, (i + 1) / k)
            mid = (p0 + p1) / 2
            if any(x0 <= mid.x <= x1 and y0 <= mid.y <= y1 for x0, x1, y0, y1 in skip):
                continue
            d = p1 - p0
            yaw = math.atan2(d.y, d.x)
            pitch = math.atan2(d.z, math.hypot(d.x, d.y))
            for p in (p0, p1):
                posts.setdefault((round(p.x, 2), round(p.y, 2)), (p, yaw))
            m = T(*(p0 + d.normalized() * 0.12)) @ Rz(yaw) @ Matrix.Rotation(-pitch, 4, "Y") @ Matrix.Diagonal((d.length - 0.24, 1, 1, 1))
            place(meshes["panel"], f"{tag}.panel{n}", coll, m)
            n += 1
    for i, (p, yaw) in enumerate(posts.values()):
        place(meshes["post"], f"{tag}.post{i}", coll, T(*p) @ Rz(yaw))
    return n


# --- the platform (城台) ----------------------------------------------------------------------------

def yf(z):
    """The battered south face's y at height z (the north face is at -yf(z))."""
    return -(PLAT["hd"] - PLAT["batter"] * z / PLAT["h"])


def xs_(z):
    return PLAT["hw"] - PLAT["batter"] * z / PLAT["h"]


def arch_outline(ax, w, crown, segs=14):
    r = w / 2
    spring = crown - r
    return spring, [(ax + r * math.cos(math.pi * (1 - i / segs)), spring + r * math.sin(math.pi * (1 - i / segs))) for i in range(segs + 1)]


def platform(g):
    hw, hd, h = PLAT["hw"], PLAT["hd"], PLAT["h"]
    zb = PLAT["base"]
    arches = sorted(ARCHES)
    spans = [(ax - w / 2, ax + w / 2) for ax, w, _ in arches]
    # the marble 须弥座 base, interrupted by the gateways front and back
    for z0, z1, out in ((0.0, 0.35, 0.55), (0.35, 0.5, 0.42), (0.5, 1.25, 0.25), (1.25, 1.4, 0.42), (1.4, zb, 0.55)):
        edges = [-(hw + out)] + [e for s in spans for e in s] + [hw + out]
        for x0, x1 in zip(edges[0::2], edges[1::2]):
            g.box(x0, x1, -(hd + out), -(hd - 0.4), z0, z1, "marble")
            g.box(x0, x1, hd - 0.4, hd + out, z0, z1, "marble")
        for sx in (-1, 1):
            g.box(min(sx * (hw - 0.4), sx * (hw + out)), max(sx * (hw - 0.4), sx * (hw + out)), -(hd + out), hd + out, z0, z1, "marble")
    # the walls: piers and the spandrels over the arches, front (south) and back
    for side in (-1, 1):
        Y = (lambda z: yf(z)) if side < 0 else (lambda z: -yf(z))
        want = (0, side, 0)
        prev = -xs_(zb)
        for (ax, w, crown), (a0, a1) in zip(arches, spans):
            g.polyn([(prev, Y(zb), zb), (a0, Y(zb), zb), (a0, Y(h), h), (-xs_(h) if prev < -hw + 1 else prev, Y(h), h)], "plaster", want)
            spring, arc = arch_outline(ax, w, crown)
            pts = [(x, Y(z), z) for x, z in arc] + [(a1, Y(h), h), (a0, Y(h), h)]
            g.polyn(pts, "plaster", want)
            prev = a1
        g.polyn([(prev, Y(zb), zb), (xs_(zb), Y(zb), zb), (xs_(h), Y(h), h), (prev, Y(h), h)], "plaster", want)
    for sx in (-1, 1):
        g.polyn([(sx * xs_(zb), yf(zb), zb), (sx * xs_(zb), -yf(zb), zb), (sx * xs_(h), -yf(h), h), (sx * xs_(h), yf(h), h)], "plaster", (sx, 0, 0))
    g.polyn([(-xs_(h), yf(h), h), (xs_(h), yf(h), h), (xs_(h), -yf(h), h), (-xs_(h), -yf(h), h)], "stone", (0, 0, 1))
    # the gateways: a vault right through, the doors folded back against the walls a third of the way in
    for ax, w, crown in arches:
        spring, arc = arch_outline(ax, w, crown)
        sec = [(ax - w / 2, 0.0)] + arc + [(ax + w / 2, 0.0)]
        for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            inward = (ax - mx, 0, spring - mz if mz > spring else 0)
            g.polyn([(x0, yf(z0), z0), (x1, yf(z1), z1), (x1, -yf(z1), z1), (x0, -yf(z0), z0)], "plaster", inward, smooth=z0 > spring - 1e-3 and z1 > spring - 1e-3)
        yd = -hd * 0.35
        for sx in (-1, 1):
            x = ax + sx * (w / 2 - 0.07)
            g.polyn([(x, yd, 0.02), (x, yd + w / 2, 0.02), (x, yd + w / 2, spring), (x, yd, spring)], "atlas", (-sx, 0, 0),
                    uvs=uvs("gatedoor", QUAD))
    # the parapet (宇墙) round the top, capped with yellow tiles
    t, ph = PLAT["par_t"], PLAT["par_h"]
    X, Yt = xs_(h), -yf(h)
    runs = [((-X, -Yt + t / 2), (X, -Yt + t / 2)), ((-X, Yt - t / 2), (X, Yt - t / 2)),
            ((-X + t / 2, -Yt + t), (-X + t / 2, Yt - t)), ((X - t / 2, -Yt + t), (X - t / 2, Yt - t))]
    for (x0, y0), (x1, y1) in runs:
        g.box(min(x0, x1) - (t / 2 if x0 == x1 else 0), max(x0, x1) + (t / 2 if x0 == x1 else 0),
              min(y0, y1) - (t / 2 if y0 == y1 else 0), max(y0, y1) + (t / 2 if y0 == y1 else 0), h, h + ph, "plaster")
        coping(g, (x0, y0), (x1, y1), t + 0.3, h + ph)
    # the portrait over the middle gateway, in its frame, leaning with the wall
    x0, x1, z0, z1 = -2.85, 2.85, 8.45, 13.05
    g.polyn([(x0, yf(z0) - 0.22, z0), (x1, yf(z0) - 0.22, z0), (x1, yf(z1) - 0.22, z1), (x0, yf(z1) - 0.22, z1)], "atlas", (0, -1, 0),
            uvs=uvs("portrait", QUAD))
    for (ax_, az), (bx, bz) in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
        g.poly([(ax_, yf(az) - 0.22, az), (bx, yf(bz) - 0.22, bz), (bx, yf(bz), bz), (ax_, yf(az), az)], "red")


def coping(g, a, b, wd, z, rise=0.35, key="tile"):
    """A little tiled gable roof along a wall top from a to b (plan points)."""
    a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x, 0)) * (wd / 2)
    ext = d * (wd / 2 - 0.15)
    a, b = a - ext, b + ext
    up = Vector((0, 0, rise))
    g.poly([a - n, b - n, b + up, a + up], key)
    g.poly([b + n, a + n, a + up, b + up], key)
    g.poly([a + n, a - n, a + up], key)
    g.poly([b - n, b + n, b + up], key)
    g.poly([a - n + Vector((0, 0, -0.12)), b - n + Vector((0, 0, -0.12)), b - n, a - n], key)
    g.poly([b + n + Vector((0, 0, -0.12)), a + n + Vector((0, 0, -0.12)), a + n, b + n], key)


# --- the tower (城楼) ---------------------------------------------------------------------------------

def cdir(rot, du, dv, dz=0.0):
    return to_world(rot, 0, du, dv, dz) - to_world(rot, 0, 0, 0, 0)


def ring_sides(outer=True):
    """The four sides of a column ring: (rot, D, the columns' u positions along the side)."""
    if outer:
        return [(0, OY, XS), (1, OX, YS), (2, OY, XS), (3, OX, YS)]
    return [(0, IY, XS[1:-1]), (1, IX, YS[1:-1]), (2, IY, XS[1:-1]), (3, IX, YS[1:-1])]


def ring_beams(g, outer, z0, z1, z2, z3, thick=0.5):
    """额枋 (painted), 平板枋, the panel wall between the brackets, and the 挑檐枋 out at their tips."""
    for rot, D, us in ring_sides(outer):
        for i in range(len(us) - 1):
            u0 = us[i] - (thick / 2 if i == 0 else 0)
            u1 = us[i + 1] + (thick / 2 if i == len(us) - 2 else 0)
            for v0, v1, za, zc, reg in ((-thick / 2, thick / 2, z0, z1, "beam"), (-0.31, 0.31, z1, z2, "plank")):
                P = lambda u, v, z: to_world(rot, D, u, v, z)
                g.polyn([P(u0, v0, za), P(u1, v0, za), P(u1, v0, zc), P(u0, v0, zc)], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
                g.polyn([P(u1, v1, za), P(u0, v1, za), P(u0, v1, zc), P(u1, v1, zc)], "atlas", cdir(rot, 0, 1), uvs=uvs(reg, QUAD))
                g.polyn([P(u0, v0, za), P(u1, v0, za), P(u1, v1, za), P(u0, v1, za)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
            P = lambda u, v, z: to_world(rot, D, u, v, z)
            g.polyn([P(u0, 0, z2), P(u1, 0, z2), P(u1, 0, z3 + 0.1), P(u0, 0, z3 + 0.1)], "plaster", cdir(rot, 0, -1))
            g.polyn([P(u0, -1.06, z3 - 0.26), P(u1 + (1.06 if i == len(us) - 2 else 0), -1.06, z3 - 0.26),
                     P(u1 + (1.06 if i == len(us) - 2 else 0), -1.06, z3 + 0.02), P(u0, -1.06, z3 + 0.02)], "atlas", cdir(rot, 0, -1), uvs=uvs("plank", QUAD))


def bracket_spots(outer, z):
    """(position, yaw) of every bracket set on a ring: on the columns, between them, and on the corners."""
    out = []
    for rot, D, us in ring_sides(outer):
        yaw = rot * math.pi / 2
        for i in range(len(us) - 1):
            k = max(1, round((us[i + 1] - us[i]) / 1.3))
            for j in range(k):
                if i == 0 and j == 0:
                    continue
                u = us[i] + (us[i + 1] - us[i]) * j / k
                out.append((to_world(rot, D, u, 0, z), yaw))
        out.append((to_world(rot, D, us[-1], 0, z), yaw + math.pi / 4))
    return out


def tower(g):
    tb = TOWER_BASE
    z0 = tb["z1"]
    # the marble terrace it stands on, with steps down front and back
    for za, zc, out in ((tb["z0"], 13.7, 0.35), (13.7, 13.85, 0.2), (13.85, 14.5, 0.0), (14.5, 14.65, 0.2), (14.65, z0, 0.35)):
        g.box(-tb["hw"] - out, tb["hw"] + out, -tb["hd"] - out, tb["hd"] + out, za, zc, "marble", skip=("-z", "+z"))
    g.polyn([(-tb["hw"] - 0.35, -tb["hd"] - 0.35, z0), (tb["hw"] + 0.35, -tb["hd"] - 0.35, z0), (tb["hw"] + 0.35, tb["hd"] + 0.35, z0),
             (-tb["hw"] - 0.35, tb["hd"] + 0.35, z0)], "stone", (0, 0, 1))
    for s in (-1, 1):
        for k in range(3):
            y0, y1 = s * (tb["hd"] + 0.35), s * (tb["hd"] + 0.35 + (3 - k) * 0.45)
            g.box(-4.9, 4.9, min(y0, y1), max(y0, y1), tb["z0"], tb["z0"] + (k + 1) * 0.5, "marble")
    # the ground floor behind the colonnade: doors in the middle bays, windows over a sill wall at the ends
    for rot, D, us in ring_sides(False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)
            front = rot in (0, 2)
            reg = ("door" if 1 <= i <= len(us) - 3 else "window") if front else None
            if reg:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], BEAM[0]), P(us[i], BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            else:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], BEAM[0]), P(us[i], BEAM[0])], "plaster", cdir(rot, 0, -1))
            # the painted beam over them, seen from the corridor
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)
            g.polyn([Q(us[i], BEAM[0]), Q(us[i + 1], BEAM[0]), Q(us[i + 1], BEAM[1]), Q(us[i], BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            # the upper storey's band of windows, above the lower roof
            g.polyn([P(us[i], 24.9), P(us[i + 1], 24.9), P(us[i + 1], UBEAM[0]), P(us[i], UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(g, True, *BEAM)
    ring_beams(g, False, *UBEAM)
    # the corridor ceiling (天花)
    zc = BEAM[1]
    for x0, x1, y0, y1 in ((-OX, OX, -OY, -IY), (-OX, OX, IY, OY), (IX, OX, -IY, IY), (-OX, -IX, -IY, IY)):
        nx, ny = max(1, round((x1 - x0) / 1.3)), max(1, round((y1 - y0) / 1.3))
        for i in range(nx):
            for j in range(ny):
                a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
                b0, b1 = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
                g.polyn([(a0, b0, zc), (a1, b0, zc), (a1, b1, zc), (a0, b1, zc)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    # the national emblem between the eaves
    R, c = 1.3, Vector((0, -(IY + 0.55), 26.75))
    ring = [Vector((c.x + R * math.cos(2 * math.pi * i / 36), c.y, c.z + R * math.sin(2 * math.pi * i / 36))) for i in range(36)]
    g.polyn(ring, "atlas", (0, -1, 0), uvs=[uv("emblem", 0.5 + 0.5 * math.cos(2 * math.pi * i / 36), 0.5 + 0.5 * math.sin(2 * math.pi * i / 36)) for i in range(36)])
    outer = [Vector((c.x + 1.46 * math.cos(2 * math.pi * i / 36), c.y, c.z + 1.46 * math.sin(2 * math.pi * i / 36))) for i in range(36)]
    for i in range(36):
        k = (i + 1) % 36
        g.polyn([ring[i] + Vector((0, -0.12, 0)), ring[k] + Vector((0, -0.12, 0)), outer[k] + Vector((0, -0.12, 0)), outer[i] + Vector((0, -0.12, 0))], "gold", (0, -1, 0))
        g.poly([outer[i] + Vector((0, -0.12, 0)), outer[k] + Vector((0, -0.12, 0)), outer[k] + Vector((0, 0.1, 0)), outer[i] + Vector((0, 0.1, 0))], "gold", smooth=True)


def roofs(g, lod=False):
    """Both roofs: the lower skirt (腰檐) round the upper storey and the 歇山 over it. Returns the hip lines."""
    hips = []
    # the lower roof: four faces from the eave up to the upper storey's wall
    RL, DL = LOWER, LOWER["D"] - IY
    for rot in range(4):
        A, De = (LOWER["A"], LOWER["D"]) if rot % 2 == 0 else (LOWER["D"], LOWER["A"])
        rows = roof_face(g, RL, DL, rot, A, De, DL, rows=4 if lod else 8, waves=not lod, cols=10)
        if lod:
            continue
        eave_edge(g, rows[0])
        soffit(g, RL, DL, rot, A, De, BEAM[3] + 0.08)
        hips.append([r[-1] for r in rows])
    # the upper roof: front and back run to the ridge and on past the hips to the gables; the ends stop at the gable foot
    RU, DU = UPPER, UPPER["D"]
    XP = GABLE_X + 0.8
    for rot in range(4):
        if rot % 2 == 0:
            rows = roof_face(g, RU, DU, rot, UPPER["A"], UPPER["D"], UPPER["D"], cap=XP, rows=6 if lod else 14, waves=not lod, cols=12)
        else:
            rows = roof_face(g, RU, DU, rot, UPPER["D"], UPPER["A"], UPPER["A"] - XP, rows=3 if lod else 6, waves=not lod, cols=6)
            if not lod:
                hips.append([r[0] for r in rows])
                hips.append([r[-1] for r in rows])
        if lod:
            continue
        eave_edge(g, rows[0])
        if rot % 2 == 0:
            soffit(g, RU, DU, rot, UPPER["A"], UPPER["D"], UBEAM[3] + 0.08, cap=XP)
        else:
            soffit(g, RU, DU, rot, UPPER["D"], UPPER["A"], UBEAM[3] + 0.08)
    ztop = RU["z"] + RU["H"]
    zg = roof_z(RU, DU, UPPER["A"] - XP)
    half = UPPER["D"] - (UPPER["A"] - XP)
    g.box(-XP - 0.3, XP + 0.3, -0.42, 0.42, ztop - 0.3, ztop + 0.75, "tile")
    g.box(-XP - 0.3, XP + 0.3, -0.5, 0.5, ztop + 0.5, ztop + 0.62, "tile")
    for sx in (-1, 1):
        # the gable (山花) under the overhang, the barge boards along its edges, the ridge at its foot
        vs = [UPPER["A"] - XP + (UPPER["D"] - UPPER["A"] + XP) * i / 10 for i in range(11)]
        top = [(-UPPER["D"] + v, max(zg + 0.25, roof_z(RU, DU, v) - 0.3)) for v in vs]
        pts = [(y, z) for y, z in top] + [(-y, z) for y, z in reversed(top[:-1])]
        zt = max(z for _, z in pts)
        g.polyn([(sx * GABLE_X, y, z) for y, z in [(-half, zg)] + pts + [(half, zg)]], "atlas", (sx, 0, 0),
                uvs=[uv("gable", (y + half) / (2 * half), (z - zg) / (zt - zg)) for y, z in [(-half, zg)] + pts + [(half, zg)]])
        if lod:
            continue
        g.box(min(sx * (GABLE_X - 0.15), sx * (XP + 0.2)), max(sx * (GABLE_X - 0.15), sx * (XP + 0.2)), -half, half, zg - 0.15, zg + 0.42, "tile")
        for sy in (-1, 1):
            edge = [Vector((sx * XP, sy * (UPPER["D"] - v), roof_z(RU, DU, v))) for v in vs]
            for a, b in zip(edge, edge[1:]):
                g.polyn([a + Vector((sx * 0.04, 0, 0.02)), b + Vector((sx * 0.04, 0, 0.02)), b + Vector((sx * 0.04, 0, -0.75)), a + Vector((sx * 0.04, 0, -0.75))], "red", (sx, 0, 0))
            sweep(g, edge, 0.5, 0.55)
        wen(g, sx * (XP - 0.45), ztop - 0.25, sx)
    if lod:
        return hips
    # the ridge round the lower roof where it meets the wall (围脊)
    zw = RL["z"] + RL["H"]
    g.box(-IX - 0.45, IX + 0.45, -IY - 0.45, -IY + 0.05, zw - 0.2, zw + 0.35, "tile")
    g.box(-IX - 0.45, IX + 0.45, IY - 0.05, IY + 0.45, zw - 0.2, zw + 0.35, "tile")
    g.box(-IX - 0.45, -IX + 0.05, -IY, IY, zw - 0.2, zw + 0.35, "tile")
    g.box(IX - 0.05, IX + 0.45, -IY, IY, zw - 0.2, zw + 0.35, "tile")
    for line in hips:
        sweep(g, line, 0.55, 0.45)
        lo = line[0]
        out = Vector((lo.x, lo.y, 0)).normalized()
        c = lo + out * 0.25 + Vector((0, 0, -0.2))
        g.box(c.x - 0.2, c.x + 0.2, c.y - 0.2, c.y + 0.2, c.z - 0.2, c.z + 0.2, "tile")
    return hips


# --- in front, and either side ----------------------------------------------------------------------

def stands(g):
    """观礼台: a low front wall, tiers of stone seats rising to a tall back wall, cross walls every ~24 m."""
    for x0, x1, y0, y1 in STANDS:
        zf, zback = 2.4, 7.2
        # front wall with its white balustrade band, capped
        n = max(1, round((x1 - x0) / 8))
        for i in range(n):
            a, b = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            g.polyn([(a, y0, 0), (b, y0, 0), (b, y0, zf), (a, y0, zf)], "atlas", (0, -1, 0), uvs=uvs("stand", QUAD))
        g.box(x0, x1, y0, y0 + 0.6, 0, zf, "plaster", skip=("-y", "-z"))
        coping(g, (x0, y0 + 0.3), (x1, y0 + 0.3), 0.9, zf)
        # the tiers
        steps, ya, yb = 8, y0 + 0.6, y1 - 0.8
        for k in range(steps):
            s0, s1 = ya + (yb - ya) * k / steps, ya + (yb - ya) * (k + 1) / steps
            z = 1.2 + (zback - 1.6 - 1.2) * (k + 1) / steps
            g.polyn([(x0, s0, z), (x1, s0, z), (x1, s1, z), (x0, s1, z)], "stone", (0, 0, 1))
            zprev = 1.2 + (zback - 1.6 - 1.2) * k / steps
            g.polyn([(x0, s0, zprev), (x1, s0, zprev), (x1, s0, z), (x0, s0, z)], "stone", (0, -1, 0))
        g.polyn([(x0, ya, 0.0), (x1, ya, 0.0), (x1, ya, 1.2), (x0, ya, 1.2)], "plaster", (0, -1, 0))
        # back wall, capped
        g.box(x0, x1, y1 - 0.8, y1, 0, zback, "plaster", skip=("-z",))
        coping(g, (x0, y1 - 0.4), (x1, y1 - 0.4), 1.1, zback)
        # ends and cross walls: sloping, a metre over the seats
        m = max(1, round((x1 - x0) / 24))
        for i in range(m + 1):
            x = x0 + (x1 - x0) * i / m
            xa, xb = (x, x + 0.6) if i == 0 else ((x - 0.6, x) if i == m else (x - 0.3, x + 0.3))
            prof = [(y0, 0), (y1, 0), (y1, zback + 0.3), (y0 + 0.3, zf + 0.4)]
            for xx, sgn in ((xa, -1), (xb, 1)):
                g.polyn([(xx, y, z) for y, z in prof], "plaster", (sgn, 0, 0))
            for (ya_, za), (yb_, zb_) in zip(prof, prof[1:] + prof[:1]):
                if za == 0 and zb_ == 0:
                    continue
                g.poly([(xa, ya_, za), (xb, ya_, za), (xb, yb_, zb_), (xa, yb_, zb_)], "plaster")
            top = [(y0 + 0.3, zf + 0.4), (y1, zback + 0.3)]
            a, b = Vector(((xa + xb) / 2, top[0][0], top[0][1])), Vector(((xa + xb) / 2, top[1][0], top[1][1]))
            sweep(g, [a, b], 0.95, 0.3, key="tile", sink=0.02)


def bridge_z(s, L, hump):
    return hump * (0.5 - 0.5 * math.cos(2 * math.pi * s / L))


def bridges(g, coll, meshes):
    """外金水桥: five humped marble bridges over the river, deck of stone flags, balustrades both sides."""
    decks = []
    for bx, W, L, hump in BRIDGES:
        ys = [BRIDGE_Y + L / 2 - L * i / 24 for i in range(25)]
        zs = [bridge_z(L * i / 24, L, hump) + 0.04 for i in range(25)]
        xl, xr = bx - W / 2, bx + W / 2
        for i in range(24):
            g.polyn([(xl + 0.3, ys[i], zs[i]), (xr - 0.3, ys[i], zs[i]), (xr - 0.3, ys[i + 1], zs[i + 1]), (xl + 0.3, ys[i + 1], zs[i + 1])], "deck", (0, 0, 1))
            for x, sx in ((xl, -1), (xr, 1)):
                g.polyn([(x, ys[i], 0), (x, ys[i + 1], 0), (x, ys[i + 1], zs[i + 1] + 0.1), (x, ys[i], zs[i] + 0.1)], "marble", (sx, 0, 0))
                xi = x - sx * 0.3
                g.polyn([(x, ys[i], zs[i] + 0.1), (x, ys[i + 1], zs[i + 1] + 0.1), (xi, ys[i + 1], zs[i + 1] + 0.1), (xi, ys[i], zs[i] + 0.1)], "marble", (0, 0, 1))
        for x in (xl + 0.15, xr - 0.15):
            pts = [(x, ys[i], zs[i] + 0.1) for i in range(0, 25, 2)]
            balustrade(coll, meshes, pts, f"bridge{bx:+.0f}{'L' if x < bx else 'R'}", gap=1.95)
        decks.append((bx, W, L, hump, ys, zs))
    return decks


def huabiao(g, x, y, facing):
    """华表: octagonal marble column wound by a dragon, the cloud board, the dew plate and its beast, on a fenced base."""
    lathe(g, [(1.5, 0.0), (1.5, 0.3), (1.25, 0.45), (1.08, 0.52), (1.08, 1.3), (1.25, 1.4), (1.42, 1.58), (1.42, 1.8), (0.0, 1.81)], 8, "marble", x, y, smooth=False)
    lathe(g, [(0.5, 1.8), (0.5, 8.0)], 8, "marble", x, y, smooth=False)
    # the dragon: a scaled tube spiralling up the shaft
    turns, n = 2.6, 120
    path = [Vector((x + 0.52 * math.cos(2 * math.pi * turns * t + 0.6), y + 0.52 * math.sin(2 * math.pi * turns * t + 0.6), 2.2 + 5.0 * t)) for t in [i / n for i in range(n + 1)]]
    rings = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, n)] - path[max(i - 1, 0)]).normalized()
        out = Vector((p.x - x, p.y - y, 0)).normalized()
        b = t.cross(out).normalized()
        r = 0.15 * (0.55 + 0.45 * math.sin(math.pi * i / n)) * (1 + 0.15 * math.sin(i * 1.7))
        rings.append([g.vert(p + (out * math.cos(a) + b * math.sin(a)) * r) for a in [2 * math.pi * k / 6 for k in range(6)]])
    for a, b in zip(rings, rings[1:]):
        for k in range(6):
            g.face((a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]), "marble", smooth=True)
    ell(g, (x, y + facing * 0.62, 7.25), (0.26, 0.2, 0.2), "marble", nu=8, nv=5)
    # the cloud board (云板) across the top of the shaft
    cloud = [(-1.3, 0.0), (-1.05, -0.28), (-0.6, -0.22), (-0.3, -0.4), (0.3, -0.4), (0.6, -0.22), (1.05, -0.28), (1.3, 0.0),
             (1.12, 0.3), (0.7, 0.24), (0.35, 0.42), (-0.35, 0.42), (-0.7, 0.24), (-1.12, 0.3)]
    for dy, sgn in ((-0.08, -1), (0.08, 1)):
        g.polyn([(x + cx, y + dy, 7.55 + cz) for cx, cz in cloud], "marble", (0, sgn, 0))
    for (ax_, az), (bx, bz) in zip(cloud, cloud[1:] + cloud[:1]):
        g.poly([(x + ax_, y - 0.08, 7.55 + az), (x + bx, y - 0.08, 7.55 + bz), (x + bx, y + 0.08, 7.55 + bz), (x + ax_, y + 0.08, 7.55 + az)], "marble")
    # the dew plate (承露盘) on a lotus, and the 犼 crouching on it facing out
    lathe(g, [(0.5, 8.0), (0.62, 8.12), (0.78, 8.3), (0.82, 8.42), (0.82, 8.52), (0.0, 8.53)], 12, "marble", x, y)
    ell(g, (x, y, 8.8), (0.22, 0.34, 0.26), "marble", nu=8, nv=5)
    ell(g, (x, y + facing * 0.3, 9.12), (0.17, 0.17, 0.17), "marble", nu=8, nv=5)
    ell(g, (x, y - facing * 0.2, 8.72), (0.2, 0.16, 0.22), "marble", nu=8, nv=5)
    for sx in (-1, 1):
        cyl(g, x + sx * 0.15, y + facing * 0.25, 8.52, 8.9, 0.06, 0.06, 6, "marble")
        g.box(x + sx * 0.12 - 0.03, x + sx * 0.12 + 0.03, y + facing * 0.25 - 0.03, y + facing * 0.25 + 0.03, 9.25, 9.42, "marble")


def lion_mesh(name, male):
    """A seated stone lion (about 2.4 m) from metaballs, facing -Y: squat, big head, a shell of curls
    round the back of it, thick forelegs; the male's paw on a ball, the female's on a cub. Decimated."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = mb.render_resolution = 0.045
    mb.threshold = 0.32          # low: the parts blend into one body instead of beads

    def el(kind, co, r, size=None, rot=None):
        e = mb.elements.new(type=kind)
        e.co, e.radius = co, r
        if size:
            e.size_x, e.size_y, e.size_z = size
        if rot is not None:
            e.rotation = rot
        return e
    el("ELLIPSOID", (0, 0.3, 0.5), 0.62, (0.9, 1.0, 0.8))                      # haunches
    el("ELLIPSOID", (0, -0.12, 1.0), 0.6, (0.95, 0.75, 1.1))                   # chest, upright
    el("BALL", (0, 0.02, 1.72), 0.66)                                          # mane
    el("BALL", (0, -0.26, 1.76), 0.52)                                         # head, over the chest
    el("ELLIPSOID", (0, -0.62, 1.62), 0.34, (1.0, 0.6, 0.62))                  # muzzle and jaw
    el("ELLIPSOID", (0, -0.56, 1.42), 0.26, (0.9, 0.7, 0.5))
    for sx in (-1, 1):
        el("BALL", (sx * 0.23, -0.66, 1.88), 0.17)                              # bulging eyes
        el("ELLIPSOID", (sx * 0.3, -0.42, 0.62), 0.28, (0.7, 0.75, 1.6))        # forelegs, straight down
        el("ELLIPSOID", (sx * 0.47, 0.35, 0.28), 0.38, (0.75, 1.1, 0.8))        # hind legs
    # curls: many small ones sunk into the mane behind and over the head
    for i in range(7):
        for j in range(7):
            th = math.radians(-80 + 26.6 * i)
            ph = math.radians(-10 + 20 * j)
            d = Vector((math.sin(th) * math.cos(ph), math.cos(th) * math.cos(ph) * 0.85 + 0.15, math.sin(ph)))
            el("BALL", tuple(Vector((0, 0.02, 1.72)) + d * 0.6), 0.21)
    el("BALL", (0, 0.66, 0.85), 0.3)                                           # tail
    if male:
        el("BALL", (0.34, -0.68, 0.3), 0.3)                                    # the embroidered ball, his right paw on it
        el("ELLIPSOID", (0.32, -0.66, 0.62), 0.22, (1.0, 1.2, 0.7))
        el("ELLIPSOID", (-0.3, -0.52, 0.16), 0.3, (1.0, 1.3, 0.7))
    else:
        el("ELLIPSOID", (0.3, -0.52, 0.16), 0.3, (1.0, 1.3, 0.7))
        el("BALL", (-0.36, -0.66, 0.26), 0.24)                                 # the cub under her left paw
        el("BALL", (-0.4, -0.84, 0.44), 0.16)
        el("ELLIPSOID", (-0.32, -0.62, 0.58), 0.2, (1.0, 1.2, 0.7))
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    tmp = bpy.data.objects.new(name + "_d", me)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new("dec", "DECIMATE")
    mod.ratio = 0.22
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(me)
    out.shade_smooth()
    stone = linear("#bdb8ad")
    attr = out.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", [c for _ in out.vertices for c in (*stone, 1.0)])
    return out


def slogan(font, text, x, zc, width, M, coll, name):
    """A slogan in relief on the battered wall: glyphs 1.8 m tall, stretched to `width`."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, font, 1.0, 0.08
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.12
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    ky, kx = 1.8 / (max(ys) - min(ys)), width / (max(xs) - min(xs))
    cy = (max(ys) + min(ys)) / 2
    tilt = math.atan2(PLAT["batter"], PLAT["h"])
    m = T(x, yf(zc) - 0.12, zc) @ Matrix.Rotation(-tilt, 4, "X") @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z))
    me.materials.append(M["letters"])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


# --- the far level, colliders, markers ----------------------------------------------------------------

def far_level(g):
    """Past 800 m: the platform, the terrace, the tower as a block under both roofs, the stands."""
    h = PLAT["h"]
    for side in (-1, 1):
        Y = (lambda z: yf(z)) if side < 0 else (lambda z: -yf(z))
        g.polyn([(-xs_(0), Y(0), 0), (xs_(0), Y(0), 0), (xs_(h), Y(h), h), (-xs_(h), Y(h), h)], "plaster", (0, side, 0))
    for sx in (-1, 1):
        g.polyn([(sx * xs_(0), yf(0), 0), (sx * xs_(0), -yf(0), 0), (sx * xs_(h), -yf(h), h), (sx * xs_(h), yf(h), h)], "plaster", (sx, 0, 0))
    g.box(-xs_(h), xs_(h), yf(h), -yf(h), h, h + PLAT["par_h"], "plaster", skip=("-z",))
    tb = TOWER_BASE
    g.box(-tb["hw"], tb["hw"], -tb["hd"], tb["hd"], tb["z0"], tb["z1"], "marble", skip=("-z",))
    g.box(-OX, OX, -OY, OY, tb["z1"], LOWER["z"] + 0.4, "plaster", skip=("-z",))
    g.box(-IX, IX, -IY, IY, LOWER["z"], UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(g, lod=True)
    for x0, x1, y0, y1 in STANDS:
        prof = [(y0, 0), (y1, 0), (y1, 7.2), (y0, 2.4)]
        for x, sx in ((x0, -1), (x1, 1)):
            g.polyn([(x, y, z) for y, z in prof], "plaster", (sx, 0, 0))
        g.polyn([(x0, y0, 0), (x1, y0, 0), (x1, y0, 2.4), (x0, y0, 2.4)], "plaster", (0, -1, 0))
        g.polyn([(x0, y0, 2.4), (x1, y0, 2.4), (x1, y1, 7.2), (x0, y1, 7.2)], "stone", (0, 0, 1))


def collider_box(coll, name, x0, x1, y0, y1, z0, z1, role="COL"):
    import bcity_landmark
    g = Geo()
    g.box(x0, x1, y0, y1, z0, z1, "x")
    o = g.build(name, coll, {"x": None})
    o.data.materials.clear()
    bcity_landmark.rename(o, role)
    return o


def collider_pts(coll, name, pts, role="COL"):
    """A hull collider from points (the game takes their convex hull)."""
    import bcity_landmark
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, role)
    return o


def flat_marker(coll, name, poly, role):
    import bcity_landmark
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, y, 0.0) for x, y in poly], [], [tuple(range(len(poly)))])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, role)
    return o


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def colliders(coll, decks):
    hw, hd, h = PLAT["hw"], PLAT["hd"], PLAT["h"]
    top = h + PLAT["par_h"]
    # the platform as piers and lintels, so the five gateways stay open to drive through
    x0 = -hw
    for i, (ax, w, crown) in enumerate(sorted(ARCHES)):
        collider_box(coll, f"pier{i}", x0, ax - w / 2, -hd, hd, 0, top)
        collider_box(coll, f"lintel{i}", ax - w / 2, ax + w / 2, -hd, hd, crown, top)
        x0 = ax + w / 2
    collider_box(coll, "pier5", x0, hw, -hd, hd, 0, top)
    tb = TOWER_BASE
    collider_box(coll, "tower", -tb["hw"], tb["hw"], -tb["hd"], tb["hd"], tb["z0"], 34.0)
    for i, (x0_, x1, y0, y1) in enumerate(STANDS):
        collider_pts(coll, f"stand{i}", [(x, y0, 0) for x in (x0_, x1)] + [(x, y1, 0) for x in (x0_, x1)] +
                     [(x, y0, 2.8) for x in (x0_, x1)] + [(x, y1, 7.5) for x in (x0_, x1)])
    # bridges: the deck as triangles (a car drives over the hump), each balustrade a thin hull
    import bcity_landmark
    for bx, W, L, hump, ys, zs in decks:
        me = bpy.data.meshes.new(f"deck{bx:+.0f}")
        verts, faces = [], []
        for y, z in zip(ys, zs):
            verts += [(bx - W / 2, y, z), (bx + W / 2, y, z)]
        for i in range(len(ys) - 1):
            faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new(f"deck{bx:+.0f}", me)
        coll.objects.link(o)
        bcity_landmark.rename(o, "COLMESH")
        for sx in (-1, 1):
            x = bx + sx * (W / 2 - 0.15)
            for part in range(3):
                seg = range(part * 8, part * 8 + 9)
                pts = []
                for i in seg:
                    pts += [(x - 0.14, ys[i], 0), (x + 0.14, ys[i], 0), (x - 0.14, ys[i], zs[i] + 1.2), (x + 0.14, ys[i], zs[i] + 1.2)]
                collider_pts(coll, f"rail{bx:+.0f}{sx:+d}{part}", pts)
    for i, (x, y) in enumerate(HUABIAO):
        collider_box(coll, f"huabiao{i}", x - 1.5, x + 1.5, y - 1.5, y + 1.5, 0, 1.8)
        collider_box(coll, f"huabiaoshaft{i}", x - 0.55, x + 0.55, y - 0.55, y + 0.55, 1.8, 9.4)
    for i, (x, y, _) in enumerate(LIONS):
        collider_box(coll, f"lion{i}", x - 0.85, x + 0.85, y - 1.4, y + 1.4, 0, 4.1)


def build():
    clear_file()
    for mb in list(bpy.data.metaballs):
        bpy.data.metaballs.remove(mb)
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    atlas, atlas_night = paint_atlas()
    pav = paving()
    M = dict(
        atlas=material("TAM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=atlas_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("TAM_Plaster", "#ad3420", 0.85, tex=plaster(), props={"wet": "damp"}),
        stone=material("TAM_Paving", "#a29e94", 0.8, tex=pav, props={"wet": "ground", "glowStrength": 0.6}),
        deck=material("TAM_Deck", "#a29e94", 0.8, tex=pav, props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        marble=material("TAM_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        tile=material("TAM_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        red=material("TAM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("TAM_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("TAM_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        lantern=material("TAM_Lantern", "#c9161b", 0.55, props={"glow": "lamp", "glowColor": [1.0, 0.1, 0.03], "glowStrength": 0.45}),
        letters=material("TAM_Letters", "#f4f0e6", 0.5, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.95, 0.85], "glowStrength": 0.3}),
    )
    TILE = dict(plaster=4.0, stone=4.0, deck=4.0, marble=2.0, tile=2.0, red=2.0, gold=1.0, paint=1.0, lantern=1.0)
    main = collection("天安门")
    stats = {}

    g = Geo()
    platform(g)
    g.build("Platform", collection("城台", main), M, TILE)
    stats["platform"] = g.tris()

    g = Geo()
    tower(g)
    g.build("Tower", collection("城楼", main), M, TILE)
    stats["tower"] = g.tris()

    g = Geo()
    hips = roofs(g)
    g.build("Roofs", collection("屋顶", main), M, TILE)
    stats["roofs"] = g.tris()

    # the linked parts: columns, brackets, beasts, lanterns, balustrades
    parts = collection("构件", main)
    mesh = dict(
        column=mesh_of(column_geo(COL_TOP - TOWER_BASE["z1"]), "ColumnMesh", M, TILE),
        ucolumn=mesh_of(column_geo(UBEAM[0] - 24.6), "UpperColumnMesh", M, TILE),
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True), "ImmortalMesh", M, TILE),
        lantern=mesh_of(lantern_geo(BEAM[1] - 18.7), "LanternMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )
    z0 = TOWER_BASE["z1"]
    n = 0
    for outer in (True, False):
        for rot, D, us in ring_sides(outer):
            for u in us[1:]:
                place(mesh["column"], f"Column.{n:03d}", parts, T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(mesh["ucolumn"], f"UpperColumn.{n:03d}", parts, T(*to_world(rot, D, u, 0, 24.6)))
                n += 1
    spots = bracket_spots(True, BEAM[2]) + bracket_spots(False, UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips):
        beasts_on(line, parts, mesh, f"Beast{i}")
    for i in range(len(XS) - 1):
        if i != 4:
            place(mesh["lantern"], f"Lantern.{i}", parts, T((XS[i] + XS[i + 1]) / 2, -(OY + IY) / 2, 18.7))
    tb = TOWER_BASE
    X, Y = tb["hw"] + 0.1, tb["hd"] + 0.1
    ring = [(-X, -Y, z0), (X, -Y, z0), (X, Y, z0), (-X, Y, z0), (-X, -Y, z0)]
    balustrade(parts, mesh, ring, "TerraceRail", gap=1.8, skip=[(-5.0, 5.0, -Y - 1, -Y + 1), (-5.0, 5.0, Y - 1, Y + 1)])
    stats["brackets"] = len(spots)

    # the slogans
    font = bpy.data.fonts.load(FONT)
    letters = collection("标语", main)
    slogan(font, "中华人民共和国万岁", -17.3, 10.95, 22.0, M, letters, "SloganWest")
    slogan(font, "世界人民大团结万岁", 17.3, 10.95, 22.0, M, letters, "SloganEast")

    # in front and either side
    front = collection("金水桥 观礼台", main)
    g = Geo()
    stands(g)
    decks = bridges(g, parts, mesh)
    for x, y in HUABIAO:
        huabiao(g, x, y, -1 if y < 0 else 1)
    for x, y, _ in LIONS:
        for za, zc, out in ((0.0, 0.3, 0.12), (0.3, 1.1, 0.0), (1.1, 1.4, 0.1), (1.4, 1.55, 0.0)):
            g.box(x - 0.75 - out, x + 0.75 + out, y - 1.3 - out, y + 1.3 + out, za, zc, "marble", skip=("-z",))
    g.build("Front", front, M, TILE)
    stats["front"] = g.tris()
    lions = collection("石狮", main)
    for i, (x, y, side) in enumerate(LIONS):
        me = lion_mesh(f"Lion{i}", male=side > 0)
        me.materials.append(M["paint"])
        m = T(x, y, 1.55) @ Matrix.Diagonal((side, 1, 1, 1))     # the pair mirror each other
        o = bpy.data.objects.new(f"Lion.{i}", me)
        o.matrix_world = m
        lions.objects.link(o)
        stats[f"lion{i}"] = len(me.polygons)

    # the far level
    g = Geo()
    far_level(g)
    g.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = g.tris()

    # colliders, footprint (the gate and each stand: OSM draws them as buildings), clear ground
    helpers = collection("碰撞体")
    colliders(helpers, decks)
    flat_marker(helpers, "platform", rect(-PLAT["hw"] - 0.6, PLAT["hw"] + 0.6, -PLAT["hd"] - 0.6, PLAT["hd"] + 0.6), "FOOTPRINT")
    # the forecourt between the wall and the stands: OSM has two 6 m huts there, in front of the gateways
    flat_marker(helpers, "forecourt", rect(-47.0, 47.0, -30.0, -PLAT["hd"]), "FOOTPRINT")
    for i, (x0, x1, y0, y1) in enumerate(STANDS):
        flat_marker(helpers, f"stand{i}", rect(x0 - 1, x1 + 1, y0 - 1, y1 + 1), "FOOTPRINT")
        flat_marker(helpers, f"stand{i}", rect(x0 - 2, x1 + 2, y0 - 2, y1 + 1), "CLEAR")
    flat_marker(helpers, "bridges", rect(-33, 33, -93, -21), "CLEAR")
    for i, (x, y) in enumerate(HUABIAO[2:]):
        flat_marker(helpers, f"huabiao{i}", rect(x - 3, x + 3, y - 3, y + 3), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "tiananmen", "天安门", "Tiananmen"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.907338", "116.391265", -1.84
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
