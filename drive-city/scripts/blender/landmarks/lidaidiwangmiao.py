# 历代帝王庙 Temple of Ancient Monarchs on 阜成门内大街 (1530), built in Blender with the timber halls of hall.py and the
# courtyard pieces of gongwangfu.py (imported: halls, walls, towers, columns, brackets, beasts), marked with the
# bcity_landmark add-on's conventions. 妙应寺 (miaoyingsi.py) is 350 m west on the same street.
#
#   blender -b -P scripts/blender/landmarks/lidaidiwangmiao.py -- [--out art/landmarks/lidaidiwangmiao.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the axis at game (-3106.3, -1626) (between 景德门 and the
# hall), heading -1.0 (the halls' edges in OSM lean ~1 degree). OSM has the precinct (way 30834653, 121 x 174 m) and
# every building by name (1021040722-760: 庙门, 钟楼, 景德门, the four 碑亭, 东西配殿, 景德崇圣殿 and its terrace,
# 祭器库, 神库, 神厨, 宰牲亭, the well pavilion, 关帝庙 and the west court's rooms) and the walls inside, turned into
# this frame (`npx tsx .scratch/lm/miaoyingsi/local.mts -3106.3 -1626 -1 <ids>`). The halls are put on the axis:
# OSM's gate, 景德门, 祭器库, stele pavilions and side halls are symmetric about it, its hall and terrace 1.5 m east.
#
# South to north: the 影壁 across the street (32.4 x 1.35 x 5.6 m, green glazed 硬山 coping), the two 下马碑 by the
# front wall; 庙门 (three bays, three arched doorways in a red body, 黑琉璃瓦绿剪边 歇山) between splayed wing walls;
# the bell tower; the cross wall with 景德门 (five bays, 歇山, black glaze with a green edge, walked through) and two
# side doorways; the main court: 景德崇圣殿 (9 x 5 bays, double-eaved 庑殿 in yellow glaze, ~21 m) on its marble
# terrace and 月台 with balustrades, a 御路 in the front flight; the four 碑亭 (yellow, double-eaved 歇山, one linked
# mesh, each with its stele); the east and west 配殿 (seven bays, 歇山, green glaze); 祭器库 behind (five bays, 歇山);
# the east court (神库, 神厨, 宰牲亭, the well pavilion) and the west court (关帝庙 and its rooms) behind their walls.
# Red walls with black-glazed copings. Sources: OSM; zh.wikipedia 历代帝王庙 (北京) (dimensions of the hall, 配殿,
# 影壁, roofs), baike (景德门 and 祭器库 单檐歇山, 碑亭 重檐歇山, 庙门 黑琉璃绿剪边).
# Left out: the 景德街牌楼 (they spanned the street and were taken down in 1954; the one rebuilt stands at the
# Capital Museum), the 燎炉. Doubtful: the 配殿's tiles (green here), 祭器库's and the bell tower's (black here),
# 宰牲亭's form, the terrace's height (1.8 m), the hall's column grid (OSM's outline is 47 x 26 m; the published
# 51 x 27 m would not fit OSM's terrace), the 下马碑's places, the coping colour.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, flat_marker, rect  # noqa: E402
import hall  # noqa: E402
from hall import ring_beams, roofs, to_world, uvs  # noqa: E402
import gongwangfu as K  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "lidaidiwangmiao.blend")
HEADING = -1.0
ANCHOR = (-3106.3, -1626.0)

TERR = 1.8                 # the hall's terrace and 月台
HALL_Y = 46.2              # the hall's centre
FRONT = -86.6              # the street wall's line (阜成门内大街's north carriageway ends at y -91.7)
STREET_S = -110.8          # the south carriageway's far edge (the 影壁 stands on the pavement beyond it)

# tones: (the detail's key map, the far level's)
TONES = {
    "y": ({}, {}),
    "b": ({"tile": "btile", "ytex": "btex", "trim": "green"}, {"tile": "btile", "grey": "btile"}),     # 黑琉璃瓦绿剪边 (tile rows)
    "bf": ({"ytex": "btex", "tile": "green"}, {"tile": "btile", "grey": "btile"}),                    # the same, textured roofs
    "j": ({"ytex": "jtex", "tile": "green"}, {"tile": "green", "grey": "green"}),                       # green glaze
    "g": ({"ytex": "gtex", "tile": "grey"}, {"tile": "grey"}),                                          # grey service halls
}


def toned(tone, fn, *a, **kw):
    """Run a builder, then re-key what it added to the detail and far buffers."""
    g0, f0 = len(K.G.f), len(K.FAR.f)
    out = fn(*a, **kw)
    gk, fk = TONES[tone]
    for buf, keys, i0 in ((K.G, gk, g0), (K.FAR, fk, f0)):
        for i in range(i0, len(buf.f)):
            idx, u, k, sm = buf.f[i]
            if k in keys:
                buf.f[i] = (idx, u, keys[k], sm)
    return out


def rail_image(w=512, h=128):
    """A marble balustrade panel, 2 m a repeat (taihedian.py's)."""
    cv = Canvas(w, h, "#ebe7dd")
    cv.noise(0.05, 3)
    dark = "#b9b3a6"
    cv.rect(0, h * 0.12, w, h * 0.16, dark)
    for i in range(2):
        x0 = i * w / 2
        cv.frame(x0 + 14, h * 0.24, x0 + w / 2 - 14, h * 0.86, 3, dark)
        cv.ellipse(x0 + w / 4, h * 0.45, w * 0.13, h * 0.13, "#d2ccc0")
        cv.rect(x0 + w / 4 - 6, h * 0.58, x0 + w / 4 + 6, h * 0.8, "#d6d0c4")
    return image("LD_Rail", np.flipud(cv.a).copy())


def relief_image(w=128, h=256):
    """The 御路 slab: clouds and a dragon's coils as shading."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    H = np.zeros((h, w), np.float32)
    for k in range(7):
        cy, cx = (k + 0.5) * h / 7, w / 2 + 28 * math.sin(k * 1.3)
        r = np.hypot(x - cx, y - cy)
        H = np.maximum(H, np.clip(1 - r / 22, 0, 1) * (0.6 + 0.4 * np.sin(np.arctan2(y - cy, x - cx) * 3 + r / 4)))
    H[:, :6] = H[:, -6:] = 1.0
    return image("LD_Relief", np.array([0.93, 0.91, 0.87], np.float32) * (0.8 + 0.22 * np.flipud(H)[..., None]))


# --- pieces -------------------------------------------------------------------------------------------------------

def balustrade(g, pts, z, skip=(), closed=False):
    """A marble balustrade along a polyline at height z: textured panel strips between square posts (as taihedian)."""
    P = list(pts) + ([pts[0]] if closed else [])
    for a, b in zip(P, P[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / 2.0))
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = uy, -ux
        for j in range(n):
            p0 = (a[0] + ux * L * j / n, a[1] + uy * L * j / n)
            p1 = (a[0] + ux * L * (j + 1) / n, a[1] + uy * L * (j + 1) / n)
            mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            if any(x0 <= mid[0] <= x1 and y0 <= mid[1] <= y1 for x0, x1, y0, y1 in skip):
                continue
            for sgn in (1, -1):
                q0 = (p0[0] + nx * 0.08 * sgn, p0[1] + ny * 0.08 * sgn)
                q1 = (p1[0] + nx * 0.08 * sgn, p1[1] + ny * 0.08 * sgn)
                g.polyn([(*q0, z), (*q1, z), (*q1, z + 1.0), (*q0, z + 1.0)], "rail", (nx * sgn, ny * sgn, 0), uvs=[(0, 0), (0.5, 0), (0.5, 1), (0, 1)])
            g.polyn([(p0[0] + nx * 0.09, p0[1] + ny * 0.09, z + 1.0), (p1[0] + nx * 0.09, p1[1] + ny * 0.09, z + 1.0),
                     (p1[0] - nx * 0.09, p1[1] - ny * 0.09, z + 1.0), (p0[0] - nx * 0.09, p0[1] - ny * 0.09, z + 1.0)], "marble", (0, 0, 1))
            for p in (p0, p1):
                g.box(p[0] - 0.13, p[0] + 0.13, p[1] - 0.13, p[1] + 0.13, z, z + 1.3, "marble", skip=("-z",))


def arched_block(g, x0, x1, y0, y1, z0, zt, arches, key="plaster", frame="marble", segs=10):
    """A block along x from z0 to zt pierced front to back by arched openings [(xc, w, crown)] (yonghegong.py's)."""
    arches = sorted(arches)

    def arc(xc, w, c):
        r = w / 2
        return [(xc - r * math.cos(math.pi * k / segs), z0 + c - r + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    for y, s in ((y0, -1), (y1, 1)):
        xa = x0
        for xc, w, c in arches:
            g.polyn([(xa, y, z0), (xc - w / 2, y, z0), (xc - w / 2, y, zt), (xa, y, zt)], key, (0, s, 0))
            pts = arc(xc, w, c)
            g.polyn([(x, y, z) for x, z in pts] + [(xc + w / 2, y, zt), (xc - w / 2, y, zt)], key, (0, s, 0))
            xa = xc + w / 2
        g.polyn([(xa, y, z0), (x1, y, z0), (x1, y, zt), (xa, y, zt)], key, (0, s, 0))
        for xc, w, c in arches:                    # a stone frame round each arch, its jambs down to the floor
            po, pi = arc(xc, w + 0.6, c + 0.3), arc(xc, w, c)
            yy = y + s * 0.05
            for k in range(len(po) - 1):
                g.polyn([(pi[k][0], yy, pi[k][1]), (pi[k + 1][0], yy, pi[k + 1][1]), (po[k + 1][0], yy, po[k + 1][1]), (po[k][0], yy, po[k][1])], frame, (0, s, 0))
            for xj in (xc - w / 2 - 0.3, xc + w / 2):
                g.polyn([(xj, yy, z0), (xj + 0.3, yy, z0), (xj + 0.3, yy, z0 + c - w / 2), (xj, yy, z0 + c - w / 2)], frame, (0, s, 0))
    for xc, w, c in arches:
        sec = [(xc - w / 2, z0)] + arc(xc, w, c) + [(xc + w / 2, z0)]
        for (xa_, za), (xb_, zb) in zip(sec, sec[1:]):
            mx, mz = (xa_ + xb_) / 2, (za + zb) / 2
            g.polyn([(xa_, y0, za), (xb_, y0, zb), (xb_, y1, zb), (xa_, y1, za)], key, (xc - mx, 0, (z0 + c - w / 2) - mz if mz > z0 + c - w / 2 else 0))
        # the doors folded back inside each opening
        for sx in (-1, 1):
            xd = xc + sx * (w / 2 - 0.06)
            g.polyn([(xd, -0.35, z0), (xd, 0.35, z0), (xd, 0.35, z0 + c - w / 2), (xd, -0.35, z0 + c - w / 2)], "red", (-sx, 0, 0))
    for x, s in ((x0, -1), (x1, 1)):
        g.polyn([(x, y0, z0), (x, y1, z0), (x, y1, zt), (x, y0, zt)], key, (s, 0, 0))


def miaomen():
    """庙门: three arched doorways through a red body on a stone plinth, a painted beam band, a 歇山 roof (black
    glaze, green edge)."""
    cx, cy = 0.0, -78.15
    hx, hy, ov = 7.3, 5.25, 1.3
    bx, by = hx - ov, hy - ov
    z0, zw = 0.45, 5.6
    arches = [(0.0, 2.6, 4.1), (-3.6, 1.9, 3.3), (3.6, 1.9, 3.3)]
    g = Geo()
    g.box(-bx - 0.5, bx + 0.5, -by - 0.5, by + 0.5, 0.0, z0, "marble", skip=("-z",))
    arched_block(g, -bx, bx, -by, by, z0, zw, arches)
    K.beam_band(g, bx, by, zw, zw + 0.6)
    U = dict(A=hx, D=hy, z=zw + 0.4, H=0.66 * hy, p=1.5, o=0.55, lift=0.55, Lc=0.7 * hy, Vc=0.42 * hy)
    h = SimpleNamespace(XS=[-bx, bx], YS=[-by, by], OX=bx, OY=by, IX=bx, IY=by, BEAM=(zw, zw + 0.3, zw + 0.45, zw + 0.6), UBEAM=(zw, zw + 0.3, zw + 0.45, zw + 0.6),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, hx - 0.55 * hy - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3)
    K.FLAT["on"] = True
    K.roofs_k(h, g, 0.5)
    K.FLAT["on"] = False
    m = T(cx, cy, 0)
    K.G.add(g, m)
    x = -bx
    for xc, w, c in sorted(arches):
        K.COLL.append(("box", cx + x, cx + xc - w / 2, cy - by, cy + by, 0.0, zw + 0.6))
        K.COLL.append(("box", cx + xc - w / 2, cx + xc + w / 2, cy - by, cy + by, z0 + c, zw + 0.6))
        x = xc + w / 2
    K.COLL.append(("box", cx + x, cx + bx, cy - by, cy + by, 0.0, zw + 0.6))
    K.body_rect(m, -bx - 0.5, bx + 0.5, -by - 0.5, by + 0.5)
    K.far_block(m, hx, hy, (-bx, bx, -by, by), zw, U["z"] + U["H"])


def jingdemen():
    """景德门: five bays, three deep, single-eaved 歇山 with tile rows, the middle bay open; on a low platform with
    a flight front and back."""
    xs = [-10.6, -7.1, -3.3, 3.3, 7.1, 10.6]
    h = K.spec(10.6, 5.9, xs, K.lin(5.9, 3), 0.9 + 5.2, 2.1, rows=7, end_rows=4, Hk=0.6, gap=1.6)
    h.TRIM, h.RIDGE = 1.3, "trim"
    K.main_hall((-12.7, 12.7, -32.2, -16.3), h, 0.9, False, front_doors=1, back_doors=1, passage=True, beasts=5,
                front_steps=6.6, back_steps=6.6, col_r=0.42)


def bell_tower():
    r = (21.2, 32.0, -74.3, -63.0)
    half = min(r[1] - r[0], r[3] - r[2]) / 2
    K.tower(r, K.tower_spec(half, 1.3, 4.6, 6.8, 9.0, 2.4), 0.5, 6.8, doors_front=1, ground="plaster", ground_ends="plaster", door="gatedoor",
            upper_fill=("window", "window"), facing="w")


def screen_wall(cx, cy, hw=16.2, hd=0.68):
    """The 影壁 across the street: a stone plinth, a red wall with a green-glazed centre panel and corner pieces, a
    painted frieze and a 硬山-like coping in green glaze."""
    g = Geo()
    g.box(-hw - 0.3, hw + 0.3, -hd - 0.25, hd + 0.25, 0.0, 1.0, "marble", skip=("-z",))
    g.box(-hw, hw, -hd, hd, 1.0, 4.6, "plaster", skip=("-z", "+z"))
    for s in (-1, 1):
        y = s * (hd + 0.03)
        g.polyn([(-3.2, y, 1.9), (3.2, y, 1.9), (3.2, y, 3.9), (-3.2, y, 3.9)], "green", (0, s, 0))
        for x0 in (-hw + 0.3, hw - 1.8):
            for z0_ in (1.3, 3.6):
                g.polyn([(x0, y, z0_), (x0 + 1.5, y, z0_), (x0 + 1.5, y, z0_ + 0.6), (x0, y, z0_ + 0.6)], "green", (0, s, 0))
        K.strip(g, (-hw, y + s * 0.05), (hw, y + s * 0.05), 4.2, 4.6, "beam", (0, s, 0))
    zw = 4.6
    U = dict(A=hw + 0.6, D=hd + 0.6, z=zw, H=0.9, p=1.4, o=0.25, lift=0.25, Lc=1.0, Vc=0.5)
    h = SimpleNamespace(XS=[-hw, hw], YS=[-hd, hd], OX=hw, OY=hd, IX=hw, IY=hd, BEAM=(4.2, 4.4, 4.5, 4.6), UBEAM=(4.2, 4.4, 4.5, 4.6),
                        OVERHANG=0.6, LOWER=None, UPPER=U, GABLE_X=hw - 0.4, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=3, END_ROWS=2, KIND="wudian", WEN=0.5)
    K.FLAT["on"] = True
    roofs(h, g)
    K.FLAT["on"] = False
    m = T(cx, cy, 0)
    K.G.add(g, m)
    K.COLL.append(("box", cx - hw - 0.3, cx + hw + 0.3, cy - hd - 0.25, cy + hd + 0.25, 0.0, 5.6))
    K.CLEARS.append(rect(cx - hw - 2.0, cx + hw + 2.0, cy - hd - 1.5, cy + hd + 1.5))
    f = Geo()
    f.box(-hw, hw, -hd, hd, 0.0, 5.5, "plaster", skip=("-z",))
    K.FAR.add(f, m)


def xiamabei(cx, cy):
    """下马碑: a stone stele on a plinth by the front wall."""
    g = Geo()
    g.box(-0.75, 0.75, -0.42, 0.42, 0.0, 0.5, "marble", skip=("-z",))
    g.box(-0.55, 0.55, -0.17, 0.17, 0.5, 2.9, "stele", skip=("-z",))
    g.box(-0.62, 0.62, -0.22, 0.22, 2.9, 3.25, "stele", skip=("-z",))
    K.G.add(g, T(cx, cy, 0))
    K.COLL.append(("box", cx - 0.75, cx + 0.75, cy - 0.42, cy + 0.42, 0.0, 3.25))


# --- the main court ----------------------------------------------------------------------------------------------

HALL = SimpleNamespace(
    XS=[-21.5, -17.5, -12.9, -8.1, -2.9, 2.9, 8.1, 12.9, 17.5, 21.5], YS=[-10.5, -6.3, -2.1, 2.1, 6.3, 10.5],
    OX=21.5, OY=10.5, IX=17.5, IY=6.3, BEAM=(TERR + 6.6, TERR + 7.35, TERR + 7.55, TERR + 8.5), UBEAM=(14.4, 15.1, 15.25, 16.1), OVERHANG=3.1,
    LOWER=dict(A=24.6, D=13.6, z=TERR + 8.15, H=2.4, p=1.3, o=1.0, lift=0.9, Lc=7.0, Vc=4.0),
    UPPER=dict(A=20.5, D=9.3, z=15.8, H=5.0, p=1.6, o=0.95, lift=0.9, Lc=6.5, Vc=3.8),
    GABLE_X=12.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=8, LOWER_ROWS=5, BRACKET_GAP=1.6)
HALL_UP0 = TERR + 8.15 + 2.4 + 0.5       # the upper band's sill over the lower roof


def chongsheng():
    """景德崇圣殿: 9 x 5 bays, double-eaved 庑殿 in yellow glaze; doors in the five middle bays front, three back;
    lattice windows in the rest; columns, brackets on both eaves, beasts on the hips."""
    h = HALL
    m = T(0, HALL_Y, 0)
    g = Geo()
    K.ring_walls(g, h, TERR, h.BEAM[0], True, front_doors=5, back_doors=3, inset=0.0)
    ring_beams(h, g, True, *h.BEAM)
    ring_beams(h, g, False, *h.UBEAM)
    zs = h.LOWER["z"] + h.LOWER["H"]
    for rot in range(4):                     # the band over the lower roof: plank, then the painted band
        Dd, Uu = (h.IY, h.IX) if rot % 2 == 0 else (h.IX, h.IY)
        P = lambda u, z: to_world(rot, Dd, u, -0.02, z)          # noqa: E731
        g.polyn([P(-Uu, zs - 0.3), P(Uu, zs - 0.3), P(Uu, HALL_UP0), P(-Uu, HALL_UP0)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("plank", QUAD))
        g.polyn([P(-Uu, HALL_UP0), P(Uu, HALL_UP0), P(Uu, h.UBEAM[0]), P(-Uu, h.UBEAM[0])], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    for x0, x1, y0, y1 in ((-h.OX, h.OX, -h.OY, -h.IY), (-h.OX, h.OX, h.IY, h.OY), (h.IX, h.OX, -h.IY, h.IY), (-h.OX, -h.IX, -h.IY, h.IY)):
        K.ceiling(g, x0, x1, y0, y1, h.BEAM[1])
    K.columns_on(h, m, True, TERR, h.BEAM[0], 0.52)
    K.columns_on(h, m, False, HALL_UP0 - 0.4, h.UBEAM[0], 0.46)
    K.brackets_on(h, m, True, h.BEAM[2])
    K.brackets_on(h, m, False, h.UBEAM[2])
    hips = roofs(h, g)
    for i, line in enumerate(hips):
        K.HIPS.append(([m @ p for p in line], 9 if i >= len(hips) - 4 else 5))
    K.G.add(g, m)
    K.cbox(m, -h.OX, h.OX, -h.OY, h.OY, TERR, h.LOWER["z"] + 0.6)
    K.cbox(m, -h.IX, h.IX, -h.IY, h.IY, h.LOWER["z"], h.UPPER["z"])
    f = Geo()
    f.box(-h.OX, h.OX, -h.OY, h.OY, TERR, h.LOWER["z"] + 0.4, "plaster", skip=("-z",))
    K.far_roof(f, h.LOWER["A"], h.LOWER["D"], h.LOWER["z"], zs, "tile")
    f.box(-h.IX, h.IX, -h.IY, h.IY, zs - 0.3, h.UPPER["z"] + 0.4, "plaster", skip=("-z",))
    K.far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.7, "tile")
    K.FAR.add(f, m)


TERRACE = (-26.8, 26.8, 31.8, 60.9)      # the hall's terrace (OSM 1021040728)
YUETAI = (-13.4, 13.4, 16.2, 31.8)       # the 月台 in front of it
FLIGHT = (-6.6, 6.6)                      # the front flight, the 御路 between -1.6 and 1.6


def terrace():
    """The terrace and 月台: marble faces with a moulded lip, paved tops, balustrades round both (open at the
    flight and where the hall stands), the front flight with its 御路."""
    g = Geo()
    f = Geo()
    for x0, x1, y0, y1 in (TERRACE, YUETAI):
        g.box(x0, x1, y0, y1, 0.0, TERR - 0.25, "marble", skip=("-z", "+z"))
        g.box(x0 - 0.12, x1 + 0.12, y0 - 0.12, y1 + 0.12, TERR - 0.25, TERR, "marble", skip=("-z",))
        f.box(x0, x1, y0, y1, 0.0, TERR, "marble", skip=("-z",))
        K.COLL.append(("box", x0, x1, y0, y1, 0.0, TERR))
    # paving on top (layer 10 slabs a hair over the stone)
    for x0, x1, y0, y1 in (TERRACE, YUETAI):
        g.polyn([(x0, y0, TERR + 0.01), (x1, y0, TERR + 0.01), (x1, y1, TERR + 0.01), (x0, y1, TERR + 0.01)], "paving", (0, 0, 1))
    # the 月台's balustrade, 0.35 m in from its edge, open at the flight
    balustrade(g, [(YUETAI[0] + 0.35, TERRACE[2]), (YUETAI[0] + 0.35, YUETAI[2] + 0.35), (YUETAI[1] - 0.35, YUETAI[2] + 0.35),
                   (YUETAI[1] - 0.35, TERRACE[2])], TERR, skip=((FLIGHT[0] - 0.4, FLIGHT[1] + 0.4, YUETAI[2] - 1.0, YUETAI[2] + 1.0),))
    # the front flight: steps either side of the 御路
    n = round(TERR / 0.15)
    run = 0.34
    L = n * run
    ramps = []
    for xa, xb in ((FLIGHT[0], -1.6), (1.6, FLIGHT[1])):
        ramps.append(K.steps(g, xa, xb, YUETAI[2], -1, 0.0, TERR, rise=TERR / n, run=run))
    y0 = YUETAI[2]
    g.polyn([(-1.6, y0, TERR), (1.6, y0, TERR), (1.6, y0 - L, 0.02), (-1.6, y0 - L, 0.02)], "relief", (0, -0.4, 1), uvs=[(0, 1), (1, 1), (1, 0), (0, 0)])
    for x in (-1.6, 1.6):
        g.polyn([(x, y0, 0.0), (x, y0, TERR), (x, y0 - L, 0.0)], "marble", (-x, 0, 0))
    K.G.add(g, Matrix.Identity(4))
    K.FAR.add(f, Matrix.Identity(4))
    K.walk(Matrix.Identity(4), [(FLIGHT[0] - 0.35, y0, TERR), (FLIGHT[1] + 0.35, y0, TERR), (FLIGHT[0] - 0.35, y0 - L, 0.0),
                                (FLIGHT[1] + 0.35, y0 - L, 0.0), (FLIGHT[0] - 0.35, y0, 0.0), (FLIGHT[1] + 0.35, y0, 0.0)])
    K.BODIES.append((TERRACE[0] - 0.5, TERRACE[1] + 0.5, TERRACE[2] - 0.5, TERRACE[3] + 0.5))
    K.BODIES.append((YUETAI[0] - 0.5, YUETAI[1] + 0.5, YUETAI[2] - L - 0.5, YUETAI[3]))
    K.CLEARS.append(rect(TERRACE[0] - 1.5, TERRACE[1] + 1.5, TERRACE[2], TERRACE[3] + 1.5))
    K.CLEARS.append(rect(YUETAI[0] - 1.5, YUETAI[1] + 1.5, YUETAI[2] - L - 1.0, YUETAI[3]))


# --- stele pavilions (碑亭): one double-eaved pavilion built once and linked four times ---------------------------

STELES = [(26.8, 23.3), (-26.8, 23.3), (40.2, 39.5), (-40.2, 39.5)]
PAV_HALF = 5.65


def stele_pavilion(M, parts):
    g0, f0 = K.G, K.FAR
    nc, nl, nb, ncl = len(K.COLS), len(K.COLL), len(K.BODIES), len(K.CLEARS)
    K.G, K.FAR = Geo(), Geo()
    try:
        r = (-PAV_HALF, PAV_HALF, -PAV_HALF, PAV_HALF)
        # a 重檐 pavilion, not a two-storey one: the lower roof climbs to a short painted band under the upper eave
        K.tower(r, K.tower_spec(PAV_HALF, 1.45, 4.4, 7.4, 8.3, 2.5), 0.6, 7.4, doors_front=1, doors_back=1, ground="plaster",
                ground_ends="plaster", door="gatedoor", upper_fill=("band", "band"))
        g, f = K.G, K.FAR
    finally:
        K.G, K.FAR = g0, f0
    cols, coll = K.COLS[nc:], K.COLL[nl:]
    del K.COLS[nc:], K.COLL[nl:], K.BODIES[nb:], K.CLEARS[ncl:]
    # the stele inside, seen through the doors: a tortoise (赑屃) and the slab under its dragon head
    g.box(-1.0, 1.0, -0.6, 0.6, 0.6, 1.3, "stele")
    g.box(-0.75, 0.75, -0.2, 0.2, 1.3, 4.6, "stele")
    g.box(-0.82, 0.82, -0.25, 0.25, 4.6, 5.3, "stele")
    me = K.mesh_of(g, "StelePavilionMesh", M, K.TILE)
    for i, (x, y) in enumerate(STELES):
        K.place(me, f"StelePavilion.{i}", parts, T(x, y, 0))
        for mm, rr, hh in cols:
            K.COLS.append((T(x, y, 0) @ mm, rr, hh))
        for c in coll:
            if c[0] == "box":
                K.COLL.append(("box", c[1] + x, c[2] + x, c[3] + y, c[4] + y, c[5], c[6]))
            else:
                K.COLL.append((c[0], [(p[0] + x, p[1] + y, p[2]) for p in c[1]]))
        K.FAR.add(f, T(x, y, 0))
        K.body_rect(T(x, y, 0), -PAV_HALF + 1.0, PAV_HALF - 1.0, -PAV_HALF + 1.0, PAV_HALF - 1.0)


# --- the plan --------------------------------------------------------------------------------------------------------

# the precinct (OSM 30834653): the street front with the gate set back between splayed wings
OUTER = [(-7.4, -83.3), (-11.0, FRONT), (-60.2, FRONT), (-60.2, 87.0), (60.6, 87.0), (60.6, FRONT), (13.2, FRONT), (7.1, -83.3)]
CROSS = [[(-60.2, -24.4), (-23.4, -24.4)], [(-18.4, -24.4), (-12.9, -24.4)], [(12.4, -24.4), (18.4, -24.4)], [(23.4, -24.4), (60.6, -24.4)]]
EAST_YARD = [[(31.6, -24.4), (31.6, -49.3)], [(31.6, -54.7), (31.6, FRONT)]]
WEST_YARD = [[(-60.2, -47.9), (-40.0, -47.9)], [(-37.2, -47.9), (-31.7, -47.9), (-31.7, -24.4)],
             [(-60.2, -55.3), (-40.0, -55.3)], [(-37.2, -55.3), (-32.0, -55.3), (-32.0, FRONT)]]


def lidaidiwangmiao(M, parts):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # ---- the street: the 影壁 across it, the 下马碑 ----------------------------------------------------------------
    toned("j", screen_wall, 0.0, STREET_S - 5.8)
    for x in (-24.0, 24.0):
        xiamabei(x, FRONT - 1.4)
    # ---- the front court -----------------------------------------------------------------------------------------
    toned("bf", miaomen)
    toned("bf", bell_tower)
    mark("front")
    # east court: 神库, 神厨, 宰牲亭, the well pavilion (grey)
    toned("g", K.simple_hall, (32.2, 48.3, -39.0, -28.1), "s", 4.0, z0=0.45)                          # 神库
    toned("g", K.simple_hall, (47.1, 59.3, -60.3, -44.4), "w", 4.0, z0=0.45)                          # 神厨
    toned("g", K.simple_hall, (45.9, 57.1, -74.3, -63.0), "w", 4.4, z0=0.5, roof="xie", ov=1.4, door_bays=1, Hk=0.6)   # 宰牲亭
    toned("g", K.pavilion, 39.65, -74.05, 1.7, zb=0.4, H_body=2.6, kind="cuanjian")                    # 井亭
    # west court: 关帝庙 and the rooms (grey)
    toned("g", K.simple_hall, (-44.5, -31.7, -33.7, -24.9), "s", 4.0, z0=0.5, roof="xie", ov=1.2, door_bays=1, Hk=0.55)   # 关帝庙
    toned("g", K.simple_hall, (-55.8, -44.6, -31.4, -24.9), "s", 3.4)
    toned("g", K.simple_hall, (-49.3, -43.1, -47.4, -35.2), "w", 3.4)
    toned("g", K.simple_hall, (-58.6, -53.2, -47.4, -35.2), "e", 3.4)
    toned("g", K.simple_hall, (-56.5, -45.3, -62.7, -55.9), "n", 3.4)                                  # 典守房
    toned("g", K.simple_hall, (-58.7, -52.1, -84.0, -64.1), "e", 3.4)
    toned("g", K.simple_hall, (-47.8, -40.5, -78.5, -64.2), "w", 3.4)
    mark("courts")
    # ---- 景德门 in the cross wall ------------------------------------------------------------------------------------
    toned("b", jingdemen)
    mark("jingdemen")
    # ---- the main court ----------------------------------------------------------------------------------------------
    terrace()
    chongsheng()
    mark("chongsheng")
    stele_pavilion(M, parts)
    toned("j", K.simple_hall, (35.6, 51.5, -9.8, 22.5), "w", 5.0, z0=0.9, roof="xie", ov=1.6, door_bays=3, Hk=0.55)    # 东配殿
    toned("j", K.simple_hall, (-51.5, -35.6, -9.7, 22.7), "e", 5.0, z0=0.9, roof="xie", ov=1.6, door_bays=3, Hk=0.55)  # 西配殿
    mark("peidian")
    # ---- 祭器库 --------------------------------------------------------------------------------------------------------
    h = K.spec(11.2, 5.6, [-11.2, -7.0, -2.4, 2.4, 7.0, 11.2], K.lin(5.6, 2), 0.7 + 4.8, 2.0, rows=6, end_rows=3, Hk=0.6, gap=1.6)
    h.TRIM, h.RIDGE = 1.2, "trim"
    toned("b", K.main_hall, (-13.2, 13.2, 69.4, 84.7), h, 0.7, False, front_doors=3, back_doors=0, beasts=5, front_steps=4.0, col_r=0.4)
    mark("jiqiku")
    # ---- walls and paving --------------------------------------------------------------------------------------------
    stats["walls"] = K.walls([(OUTER, False)], zt=4.6, th=0.9, cop="btex")
    stats["walls"] += K.walls([(c, False) for c in CROSS + EAST_YARD + WEST_YARD], zt=3.8, th=0.7, cop="btex")
    mark("walls")
    for poly in (rect(-59.6, 60.0, -24.0, 86.4), rect(-31.4, 31.2, -86.0, -24.8), rect(31.9, 60.0, -86.0, -24.8),
                 rect(-59.6, -32.4, -86.0, -24.8), rect(-11.0, 13.2, -91.0, -86.0)):
        K.paved(poly)
    return stats


def footprints(helpers):
    """The precinct out to OSM's line, and the 影壁's piece across the street."""
    flat_marker(helpers, "precinct", rect(-61.4, 61.6, -88.0, 88.4), "FOOTPRINT")
    flat_marker(helpers, "yingbi", rect(-17.4, 17.4, STREET_S - 7.4, STREET_S - 4.2), "FOOTPRINT")


def materials():
    M = K.materials("LD", glaze="#d9a02a", glaze_tex="#dca72b", beam_glow=0.8)
    M.update(
        btile=material("LD_BlackGlaze", "#2a2c2f", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        btex=material("LD_BlackRows", "#2a2c2f", 0.33, tex=K.tile_tex("LD_BlackRowsTex", "#383b40"), props={"wet": "surface", "glowStrength": 0.5}),
        green=material("LD_GreenGlaze", "#3f7d4c", 0.32, props={"wet": "surface", "glowStrength": 0.5}),
        jtex=material("LD_GreenRows", "#3f7d4c", 0.35, tex=K.tile_tex("LD_GreenRowsTex", "#438253"), props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("LD_GreenEdge", "#3f7d4c", 0.32, props={"wet": "surface", "glowStrength": 0.5}),
        stele=material("LD_Stele", "#b9b5aa", 0.7, props={"wet": "damp", "glowStrength": 0.45}),
        rail=material("LD_RailPanel", "#ebe7dd", 0.5, tex=rail_image(), props={"wet": "surface", "glowStrength": 0.45}),
        relief=material("LD_Relief", "#ece8de", 0.55, tex=relief_image(), props={"wet": "damp", "glowStrength": 0.45}),
    )
    return M


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = materials()
    K.TILE.update(btile=2.0, green=2.0, trim=2.0, stele=2.0)
    main = collection("历代帝王庙")
    parts = collection("构件", main)
    stats = lidaidiwangmiao(M, parts)
    K.G.build("Temple", collection("庙", main), M, K.TILE)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze="#d9a02a"))
    K.FAR.build("Massing", collection("LOD1", main), M, K.TILE)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    footprints(helpers)
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "lidaidiwangmiao", "历代帝王庙", "Temple of Ancient Monarchs"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 450
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
