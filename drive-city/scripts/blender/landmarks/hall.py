# The timber hall of a Beijing gate or palace, shared by the landmark scripts in this folder: its
# roofs (double-eaved 歇山 with the tile rows in the geometry), bracket sets, painted beams, columns,
# ridge beasts, and the painted atlas (lattice doors and windows, 和玺 beams, rafters, ceiling, gable).
# Built for 天安门 (tiananmen.py) and reused for 正阳门 and 箭楼 (zhengyangmen.py) and 午门 (wumen.py).
#
# A hall is described by a spec `h` (any object with these attributes):
#   XS, YS            the outer ring's column lines across and deep (the corners included)
#   OX, OY, IX, IY    the outer (檐柱) and inner (金柱) rings' half sizes; the upper storey stands on the inner
#   BEAM, UBEAM       (额枋 bottom, 平板枋 bottom, bracket foot, bracket top) on the lower and upper storey
#   OVERHANG          eave overhang past the column line
#   LOWER, UPPER      the two roofs: A, D (eave half sizes), z (eave height), H (rise), p (curve), o, lift,
#                     Lc, Vc (the corner sweep: how far out and up, over what length along and up the slope);
#                     LOWER None for a single-eaved hall
#   GABLE_X           the 山花 plane; the front slope runs 0.8 m past it
#   PITCH, AMP        tile row pitch and height
#   TRIM, RIDGE       green-edged grey tiles: the eave's first TRIM metres and the ridges take the key "trim"
#                     (0 and "tile" for all-yellow glazed roofs)
#   ROWS, END_ROWS, LOWER_ROWS, BRACKET_GAP   optional: tile rows up the upper roof's long faces (14), its
#                     ends (6), the lower roof (8), and the spacing of bracket sets (1.3 m) - fewer for small halls
#   KIND              optional: "xieshan" (歇山, the default), "wudian" (庑殿: all four faces run up to the
#                     main ridge, 午门's hall) or "cuanjian" (攒尖: a square plan's four faces meet at a point
#                     under a gilt finial, 午门's pavilions)

import math

import numpy as np
from mathutils import Vector

from common import image, linear, srgb
from kit import QUAD, Canvas, Geo, cyl, ell, place, T, Rz  # noqa: F401  (QUAD for callers mapping atlas quads)


# --- the painted atlas ---------------------------------------------------------------------------------

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


def paint_atlas(prefix="TAM", portrait=True, emblem=True):
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

    # the portrait: a painted figure (no likeness is attempted) in a gilt frame (天安门 only)
    if portrait:
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

    # the national emblem, simplified: the gate in gold under five stars in a ring of wheat, the cogwheel (天安门 only)
    if emblem:
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

    return image(f"{prefix}_Atlas", np.flipud(cv.a).copy()), image(f"{prefix}_AtlasNight", np.flipud(glow.a).copy())


def plaster(size=512, name="TAM_Plaster", col="#ad3420"):
    """Vermilion lime plaster, weathered, faint vertical streaks (4 m per repeat)."""
    cv = Canvas(size, size, col)
    rng = np.random.default_rng(11)
    streak = 1 + 0.05 * np.sin(cv.x * 0.21 + 3 * np.sin(cv.x * 0.013)) * rng.random((1, size), np.float32)
    cv.a *= streak[..., None]
    cv.noise(0.08, 12)
    return image(name, np.flipud(cv.a).copy())


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


def tile_wave(u, pitch=0.46):
    """Tile rows across the slope: round tube tiles, the pan tiles sunk between them."""
    ph = (u / pitch) % 1.0
    return math.sqrt(max(0.0, 1 - ((ph - 0.25) / 0.25) ** 2)) if ph < 0.5 else -0.3 * math.sin(math.pi * (ph - 0.5) / 0.5)


def roof_face(g, R, Dref, rot, A, Deave, top, cap=0.0, rows=10, waves=True, key="tile", cols=None, pitch=0.46, amp=0.1, trim=0.0):
    """One face of tiles. Returns the rows of world points (each row a list, eave first) for the ridges.
    With `trim`, the first `trim` metres up from the eave take the key "trim" (灰筒瓦绿琉璃剪边: a green edge)."""
    q = pitch / 4
    out = []
    prev = None
    vs = [top * (j / rows) ** 1.15 for j in range(rows + 1)]
    if 0 < trim < top:
        vs = sorted(set(vs) | {trim})           # a row exactly where the green edge ends
    pv = 0.0
    for v in vs:
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
                p += nz * (amp * tile_wave(u, pitch) * fade)
            row.append((u, g.vert(to_world(rot, Deave, p.x, p.y, p.z))))
        if prev is not None:
            fk = "trim" if trim and pv < trim - 1e-6 else key
            i = k = 0
            while i < len(prev) - 1 or k < len(row) - 1:
                if k == len(row) - 1 or (i < len(prev) - 1 and prev[i + 1][0] <= row[k + 1][0]):
                    g.face((prev[i][1], prev[i + 1][1], row[k][1]), fk, smooth=True)
                    i += 1
                else:
                    g.face((prev[i][1], row[k + 1][1], row[k][1]), fk, smooth=True)
                    k += 1
        out.append([Vector(g.v[idx]) for _, idx in row])
        prev, pv = row, v
    return out


def eave_edge(g, row0, drop=0.3, key="tile"):
    """The tile ends along the eave: the scalloped edge carried down as a strip."""
    for a, b in zip(row0, row0[1:]):
        d = Vector((0, 0, -drop))
        g.poly([a, a + d, b + d, b], key, smooth=True)


def soffit(g, R, Dref, rot, A, Deave, zb, cap=0.0, span=4.5, tile=2.4):
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


def wen(g, x, zt, facing, key="tile"):
    """正吻: the ridge-end dragon - jaws open round the ridge, a back of fins, the tail curling up and out."""
    prof = [(-0.95, 0.0), (0.6, 0.0), (0.7, 0.4), (0.72, 0.9), (0.8, 1.3), (0.98, 1.7), (1.1, 2.05), (1.0, 2.35), (0.75, 2.45),
            (0.5, 2.35), (0.42, 2.12), (0.55, 1.95), (0.4, 1.85), (0.2, 2.0), (0.05, 1.85), (-0.1, 2.02), (-0.25, 1.85),
            (-0.4, 1.95), (-0.5, 1.7), (-0.62, 1.45), (-0.85, 1.3), (-0.95, 1.05), (-0.6, 0.95), (-0.75, 0.6), (-0.95, 0.45)]
    t = 0.28
    front = [Vector((x + facing * px, -t, zt + pz)) for px, pz in prof]
    back = [Vector((x + facing * px, t, zt + pz)) for px, pz in prof]
    g.polyn(front, key, (0, -1, 0))
    g.polyn(back, key, (0, 1, 0))
    cx = sum(p.x for p in front) / len(front)
    for i in range(len(prof)):
        k = (i + 1) % len(prof)
        mid = (front[i] + front[k]) / 2
        g.polyn([front[i], front[k], back[k], back[i]], key, (mid.x - cx, 0, mid.z - (zt + 1.2)))
    # the curl of the tail, a boss on each side; the sword handle (剑把) stuck in its back
    for sy in (-1, 1):
        cyl_y(g, x + facing * 0.78, sy * t, zt + 2.15, 0.2, sy * 0.08, key)
    g.box(x + facing * 0.1 - 0.07, x + facing * 0.1 + 0.07, -0.09, 0.09, zt + 1.9, zt + 2.6, key)


def cyl_y(g, x, y, z, r, dy, key, segs=10):
    """A short disc along Y from y to y + dy."""
    a = [Vector((x + r * math.cos(2 * math.pi * i / segs), y, z + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)]
    b = [p + Vector((0, dy, 0)) for p in a]
    g.polyn(b, key, (0, 1 if dy > 0 else -1, 0))
    for i in range(segs):
        k = (i + 1) % segs
        g.poly([a[i], a[k], b[k], b[i]], key, smooth=True)


def beasts_on(line, coll, meshes, tag, n=10):
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
    for k in range(n):
        p = at(0.75 + 0.48 * k) + Vector((0, 0, 0.3))
        out.append(place(meshes["immortal" if k == 0 else "beast"], f"{tag}.{k}", coll, T(*p) @ Rz(yaw)))
    return out


def column_geo(h, r=0.42):
    g = Geo()
    cyl(g, 0, 0, 0.0, 0.22, 0.64, 0.6, 16, "marble", caps=(False, True))
    cyl(g, 0, 0, 0.22, h, r, r * 0.95, 16, "red", caps=(False, False))
    return g


def bracket_geo(lite=False):
    """斗拱, projecting to -Y from the beam: block, crossed arms in two tiers, the beak (昂), gilt edges.
    `lite`: block, one crossed tier and the beak (for halls with hundreds of sets)."""
    g = Geo(colors=True)
    if lite:
        blue, green, dark = linear("#1d4a8c"), linear("#256e53"), linear("#173a2c")
        g.box(-0.24, 0.24, -0.24, 0.24, 0.0, 0.3, "paint", green, skip=("+y", "-z"))
        g.box(-0.8, 0.8, -0.09, 0.09, 0.3, 0.6, "paint", blue, skip=("+y", "-z"))
        g.box(-0.09, 0.09, -1.0, 0.25, 0.3, 0.88, "paint", green, skip=("+y", "-z"))
        g.box(-0.5, 0.5, -0.67, -0.49, 0.6, 0.8, "paint", blue, skip=("-z",))
        return g
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


def beast_geo(immortal=False, glaze="#d9a02a", lite=False):
    """A ridge beast (走兽) sitting on the ridge facing -Y, or the immortal on his hen (仙人). `lite`: fewer facets."""
    g = Geo(colors=True)
    if lite and not immortal:
        yel, dk = linear(glaze), linear("#8a5a12")
        ell(g, (0, 0.03, 0.14), (0.075, 0.1, 0.12), "paint", yel, 6, 3)
        ell(g, (0, -0.08, 0.3), (0.065, 0.07, 0.065), "paint", yel, 6, 3)
        ell(g, (0, -0.15, 0.28), (0.035, 0.05, 0.03), "paint", dk, 4, 2)
        return g
    yel, grn, dk = linear(glaze), linear("#3c7a3a"), linear("#8a5a12")
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


def cdir(rot, du, dv, dz=0.0):
    return to_world(rot, 0, du, dv, dz) - to_world(rot, 0, 0, 0, 0)


def ring_sides(h, outer=True):
    """The four sides of a column ring: (rot, D, the columns' u positions along the side)."""
    if outer:
        return [(0, h.OY, h.XS), (1, h.OX, h.YS), (2, h.OY, h.XS), (3, h.OX, h.YS)]
    return [(0, h.IY, h.XS[1:-1]), (1, h.IX, h.YS[1:-1]), (2, h.IY, h.XS[1:-1]), (3, h.IX, h.YS[1:-1])]


def ring_beams(h, g, outer, z0, z1, z2, z3, thick=0.5):
    """额枋 (painted), 平板枋, the panel wall between the brackets, and the 挑檐枋 out at their tips."""
    for rot, D, us in ring_sides(h, outer):
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


def bracket_spots(h, outer, z):
    """(position, yaw) of every bracket set on a ring: on the columns, between them, and on the corners."""
    out = []
    for rot, D, us in ring_sides(h, outer):
        yaw = rot * math.pi / 2
        for i in range(len(us) - 1):
            k = max(1, round((us[i + 1] - us[i]) / getattr(h, "BRACKET_GAP", 1.3)))
            for j in range(k):
                if i == 0 and j == 0:
                    continue
                u = us[i] + (us[i + 1] - us[i]) * j / k
                out.append((to_world(rot, D, u, 0, z), yaw))
        out.append((to_world(rot, D, us[-1], 0, z), yaw + math.pi / 4))
    return out


def roofs_hip(h, g, hips, RL, lod):
    """The upper roof of a 庑殿 (four faces to the main ridge) or 攒尖 (four faces to a point), and its ridges."""
    RU, DU = h.UPPER, h.UPPER["D"]
    A, D = h.UPPER["A"], h.UPPER["D"]
    pyramid = h.KIND == "cuanjian"
    for rot in range(4):
        Af, De = (A, D) if rot % 2 == 0 else (D, A)
        top = DU - 0.02
        long_face = rot % 2 == 0 and not pyramid
        rows = roof_face(g, RU, DU, rot, Af, De, top, rows=(6 if long_face else 5) if lod else getattr(h, "ROWS", 14), waves=not lod,
                         cols=12 if long_face else 6, pitch=h.PITCH, amp=h.AMP, trim=h.TRIM)
        if rot % 2 == 1:
            hips.append([r[0] for r in rows])
            hips.append([r[-1] for r in rows])
        if lod:
            continue
        eave_edge(g, rows[0], key=h.RIDGE if h.TRIM else "tile")
        soffit(g, RU, DU, rot, Af, De, h.UBEAM[3] + 0.08, span=h.OVERHANG)
    ztop = RU["z"] + RU["H"]
    if pyramid:
        # the gilt finial (宝顶) on a round seat
        cyl(g, 0, 0, ztop - 0.3, ztop + 0.3, 0.75, 0.6, 16, h.RIDGE, caps=(False, True))
        cyl(g, 0, 0, ztop + 0.3, ztop + 0.7, 0.5, 0.5, 16, "gold", caps=(False, True))
        ell(g, (0, 0, ztop + 1.45), (0.55, 0.55, 0.8), "gold", nu=14, nv=8)
        cyl(g, 0, 0, ztop + 2.1, ztop + 2.6, 0.12, 0.04, 8, "gold", caps=(False, True))
    else:
        XR = A - D
        g.box(-XR - 0.3, XR + 0.3, -0.42, 0.42, ztop - 0.3, ztop + 0.75, h.RIDGE)
        g.box(-XR - 0.3, XR + 0.3, -0.5, 0.5, ztop + 0.5, ztop + 0.62, h.RIDGE)
        if not lod:
            for sx in (-1, 1):
                wen(g, sx * (XR + 0.1), ztop - 0.25, sx, key=h.RIDGE)
    if lod:
        return hips
    zw = RL["z"] + RL["H"] if RL else -100.0
    if RL:
        g.box(-h.IX - 0.45, h.IX + 0.45, -h.IY - 0.45, -h.IY + 0.05, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(-h.IX - 0.45, h.IX + 0.45, h.IY - 0.05, h.IY + 0.45, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(-h.IX - 0.45, -h.IX + 0.05, -h.IY, h.IY, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(h.IX - 0.05, h.IX + 0.45, -h.IY, h.IY, zw - 0.2, zw + 0.35, h.RIDGE)
    for line in hips:
        sweep(g, line, 0.55, 0.45, key=h.RIDGE)
        lo = line[0]
        out = Vector((lo.x, lo.y, 0)).normalized()
        c = lo + out * 0.25 + Vector((0, 0, -0.2))
        g.box(c.x - 0.2, c.x + 0.2, c.y - 0.2, c.y + 0.2, c.z - 0.2, c.z + 0.2, h.RIDGE)
    return hips


def roofs(h, g, lod=False):
    """Both roofs: the lower skirt (腰檐) round the upper storey and the 歇山 over it. Returns the hip lines."""
    hips = []
    # the lower roof: four faces from the eave up to the upper storey's wall (none on a single-eaved hall)
    RL, DL = h.LOWER, (h.LOWER["D"] - h.IY if h.LOWER else 0.0)
    for rot in range(4 if h.LOWER else 0):
        A, De = (h.LOWER["A"], h.LOWER["D"]) if rot % 2 == 0 else (h.LOWER["D"], h.LOWER["A"])
        rows = roof_face(g, RL, DL, rot, A, De, DL, rows=4 if lod else getattr(h, "LOWER_ROWS", 8), waves=not lod, cols=10, pitch=h.PITCH, amp=h.AMP, trim=h.TRIM)
        if lod:
            continue
        eave_edge(g, rows[0], key=h.RIDGE if h.TRIM else "tile")
        soffit(g, RL, DL, rot, A, De, h.BEAM[3] + 0.08, span=h.OVERHANG)
        hips.append([r[-1] for r in rows])
    kind = getattr(h, "KIND", "xieshan")
    if kind != "xieshan":
        return roofs_hip(h, g, hips, RL, lod)
    # the upper roof: front and back run to the ridge and on past the hips to the gables; the ends stop at the gable foot
    RU, DU = h.UPPER, h.UPPER["D"]
    XP = h.GABLE_X + 0.8
    for rot in range(4):
        if rot % 2 == 0:
            rows = roof_face(g, RU, DU, rot, h.UPPER["A"], h.UPPER["D"], h.UPPER["D"], cap=XP, rows=6 if lod else getattr(h, "ROWS", 14), waves=not lod, cols=12, pitch=h.PITCH, amp=h.AMP, trim=h.TRIM)
        else:
            rows = roof_face(g, RU, DU, rot, h.UPPER["D"], h.UPPER["A"], h.UPPER["A"] - XP, rows=3 if lod else getattr(h, "END_ROWS", 6), waves=not lod, cols=6, pitch=h.PITCH, amp=h.AMP, trim=h.TRIM)
            if not lod:
                hips.append([r[0] for r in rows])
                hips.append([r[-1] for r in rows])
        if lod:
            continue
        eave_edge(g, rows[0], key=h.RIDGE if h.TRIM else "tile")
        if rot % 2 == 0:
            soffit(g, RU, DU, rot, h.UPPER["A"], h.UPPER["D"], h.UBEAM[3] + 0.08, cap=XP, span=h.OVERHANG)
        else:
            soffit(g, RU, DU, rot, h.UPPER["D"], h.UPPER["A"], h.UBEAM[3] + 0.08, span=h.OVERHANG)
    ztop = RU["z"] + RU["H"]
    zg = roof_z(RU, DU, h.UPPER["A"] - XP)
    half = h.UPPER["D"] - (h.UPPER["A"] - XP)
    g.box(-XP - 0.3, XP + 0.3, -0.42, 0.42, ztop - 0.3, ztop + 0.75, h.RIDGE)
    g.box(-XP - 0.3, XP + 0.3, -0.5, 0.5, ztop + 0.5, ztop + 0.62, h.RIDGE)
    for sx in (-1, 1):
        # the gable (山花) under the overhang, the barge boards along its edges, the ridge at its foot
        vs = [h.UPPER["A"] - XP + (h.UPPER["D"] - h.UPPER["A"] + XP) * i / 10 for i in range(11)]
        top = [(-h.UPPER["D"] + v, max(zg + 0.25, roof_z(RU, DU, v) - 0.3)) for v in vs]
        pts = [(y, z) for y, z in top] + [(-y, z) for y, z in reversed(top[:-1])]
        zt = max(z for _, z in pts)
        g.polyn([(sx * h.GABLE_X, y, z) for y, z in [(-half, zg)] + pts + [(half, zg)]], "atlas", (sx, 0, 0),
                uvs=[uv("gable", (y + half) / (2 * half), (z - zg) / (zt - zg)) for y, z in [(-half, zg)] + pts + [(half, zg)]])
        if lod:
            continue
        g.box(min(sx * (h.GABLE_X - 0.15), sx * (XP + 0.2)), max(sx * (h.GABLE_X - 0.15), sx * (XP + 0.2)), -half, half, zg - 0.15, zg + 0.42, h.RIDGE)
        for sy in (-1, 1):
            edge = [Vector((sx * XP, sy * (h.UPPER["D"] - v), roof_z(RU, DU, v))) for v in vs]
            for a, b in zip(edge, edge[1:]):
                g.polyn([a + Vector((sx * 0.04, 0, 0.02)), b + Vector((sx * 0.04, 0, 0.02)), b + Vector((sx * 0.04, 0, -0.75)), a + Vector((sx * 0.04, 0, -0.75))], "red", (sx, 0, 0))
            sweep(g, edge, 0.5, 0.55, key=h.RIDGE)
        wen(g, sx * (XP - 0.45), ztop - 0.25, sx, key=h.RIDGE)
    if lod:
        return hips
    # the ridge round the lower roof where it meets the wall (围脊)
    zw = RL["z"] + RL["H"] if RL else -100.0
    if RL:
        g.box(-h.IX - 0.45, h.IX + 0.45, -h.IY - 0.45, -h.IY + 0.05, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(-h.IX - 0.45, h.IX + 0.45, h.IY - 0.05, h.IY + 0.45, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(-h.IX - 0.45, -h.IX + 0.05, -h.IY, h.IY, zw - 0.2, zw + 0.35, h.RIDGE)
        g.box(h.IX - 0.05, h.IX + 0.45, -h.IY, h.IY, zw - 0.2, zw + 0.35, h.RIDGE)
    for line in hips:
        sweep(g, line, 0.55, 0.45, key=h.RIDGE)
        lo = line[0]
        out = Vector((lo.x, lo.y, 0)).normalized()
        c = lo + out * 0.25 + Vector((0, 0, -0.2))
        g.box(c.x - 0.2, c.x + 0.2, c.y - 0.2, c.y + 0.2, c.z - 0.2, c.z + 0.2, h.RIDGE)
    return hips
