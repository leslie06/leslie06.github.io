# 妙应寺 Miaoying Temple (白塔寺) on 阜成门内大街, with its Yuan-dynasty White Dagoba (1279, 50.9 m), built in Blender
# with the timber halls of hall.py and the courtyard pieces of gongwangfu.py (imported: halls, walls, towers,
# instances), the gate hall of zhihuasi.py, and the dagoba helpers of baita.py copied and adapted. Marked with the
# bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/miaoyingsi.py -- [--out art/landmarks/miaoyingsi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the temple's axis at game (-3453.5, -1640) (by 意珠心镜殿),
# heading -2.0 (the halls' edges in OSM lean 1-2.5 degrees; the gate is 2.5 m east of the dagoba's centre line).
# OSM has the precinct (way 33614641), its wall (1021040772) and the 塔院's walls (1021040789/790), the dagoba
# (1021040770: a 28 m circle at 50.9 m, which the city drew as a white cylinder) and every hall (1021040774-793,
# 1021068626-630: 山门, 钟楼, 鼓楼, 天王殿, 大雄宝殿 = 意珠心镜殿, 七佛宝殿, 法幢殿 and the side ranges), turned into
# this frame (`npx tsx .scratch/lm/miaoyingsi/local.mts -3453.5 -1640 -2 <ids>`). The west court (ways
# 1021068635-642, the offices) is left to the city.
#
# South to north: the 山门 (a brick gate hall with an arched doorway and splayed wing walls on the street), the
# bell and drum towers, 天王殿 (three bays) with its wing rooms and side halls, 意珠心镜殿 (five bays, a 月台),
# 七佛宝殿 (five bays, the largest), the side ranges along both sides (the long west range in two), then the
# 塔院: a 凸-shaped court raised 1.8 m ("约2米", wider at the north) behind its own red wall, steps up through its
# gate, 具六神通殿 in front of the dagoba, two small corner halls. The dagoba from published figures (塔基 9 m in
# three tiers - a square terrace and two 折角 (亚-plan) sumeru - 810 m2; the bowl 18.4 m across; thirteen rings; the
# bronze 华盖 9.7 m across with 36 hanging plates; a gilt bronze stupa on top, ~5 m): the square terrace (with steps
# up from the south, walkable), the two 亚 sumeru with their waists, a lotus throne and five rings (金刚圈), the
# bowl (塔身, broad at the shoulder), the 亚 neck, the 十三天 cone, the 华盖 with its fringe of plates and bells, and
# the finial stupa. Grey tiled halls (textured roofs on the side ranges), red walls with grey copings.
# Doubtful: the halls' roofs (歇山 here; 天王殿 may be 硬山) and heights (9-13 m), the tiles (grey; some may carry
# a green glazed edge), the 塔院's height and how its gate is built (an opening with steps here), the dagoba's tier
# heights between the published figures, the 36 plates' shape.

import math
import os
import sys
from types import SimpleNamespace  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import Geo, T, Rz, cyl, ell, flat_marker, lathe, rect  # noqa: E402
import gongwangfu as K  # noqa: E402
import zhihuasi as Z  # noqa: E402  (the brick gate hall)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "miaoyingsi.blend")
HEADING = -2.0
ANCHOR = (-3453.5, -1640.0)

STUPA = (-0.1, 78.4)       # the dagoba's centre (OSM's circle)
YARD = 1.8                 # the 塔院's floor over the street
# the 塔院 (凸): the south part between the side walls, the wider north part; edges under the walls
TAYUAN_S = (-14.8, 13.0, 41.4, 60.3)
TAYUAN_N = (-19.6, 20.2, 60.3, 100.0)
EAST = 23.0                # the east wall's line: the alley behind it (service, 4 m) runs at x 25.7

# the precinct wall (OSM 1021040772; the east side pulled in off the alley), the 塔院's front walls (789/790, the
# gate between them), the front wall and the gate's splayed wings (771/773)
PRECINCT = [[(-25.5, 33.8), (-25.8, 46.9), (-24.0, 46.9), (-23.9, 53.1), (-23.7, 58.5), (-25.7, 58.6), (-25.3, 68.7), (-19.6, 68.5)],
            [(21.0, 60.3), (EAST, 60.0), (EAST, -101.9), (7.8, -101.7)]]
PRECINCT_N = [(-19.6, 68.5), (-19.6, 100.2), (20.2, 100.2), (20.2, 66.0), (21.1, 65.9), (21.0, 60.3)]     # round the raised 塔院
TAYUAN_W = [(-2.4, 41.4), (-14.8, 41.4), (-14.8, 60.3), (-19.6, 60.5), (-19.6, 68.5)]
TAYUAN_E = [(2.4, 41.4), (13.0, 41.4), (13.0, 60.3), (21.0, 60.3)]
FRONT_W = [(-5.4, -101.7), (-20.9, -101.9), (-21.0, -64.4), (-24.0, -62.1)]
WINGS = [[(-5.4, -101.6), (-9.4, -105.7)], [(7.8, -101.7), (10.9, -105.0)]]


# --- the dagoba (baita.py's helpers, copied) -------------------------------------------------------------------

def yazi(a, c):
    """折角: a square of half size a with each corner cut back in two steps of c/2."""
    q = [(a - c, -a), (a - c, -a + c / 2), (a - c / 2, -a + c / 2), (a - c / 2, -a + c), (a, -a + c)]
    out = []
    for k in range(4):
        for x, y in q:
            for _ in range(k):
                x, y = -y, x
            out.append((x, y))
    return out


def yazi_tier(g, a0, a1, z0, z1, key, c_frac=0.2, top=True):
    """A frustum of the 亚 plan from half size a0 at z0 to a1 at z1."""
    p0 = yazi(a0, a0 * c_frac)
    p1 = yazi(a1, a1 * c_frac)
    n = len(p0)
    for i in range(n):
        j = (i + 1) % n
        A, B = p0[i], p0[j]
        C, D = p1[j], p1[i]
        mx, my = (A[0] + B[0]) / 2, (A[1] + B[1]) / 2
        ex, ey = B[0] - A[0], B[1] - A[1]
        out = (ey, -ex, 0)
        if out[0] * mx + out[1] * my < 0:
            out = (-ey, ex, 0)
        g.polyn([(A[0], A[1], z0), (B[0], B[1], z0), (C[0], C[1], z1), (D[0], D[1], z1)], key, out)
    if top:
        g.polyn([(x, y, z1) for x, y in p1], key, (0, 0, 1))


def sumeru(g, a, z0, h, key="stupa", c_frac=0.18):
    """A 亚-plan 须弥座 of half size a and height h: foot, lower fillet, the recessed waist, upper fillet, top slab."""
    prof = [(1.0, 1.0, 0.0, 0.1), (0.985, 0.985, 0.1, 0.22), (0.985, 0.95, 0.22, 0.3), (0.94, 0.94, 0.3, 0.68),
            (0.95, 0.985, 0.68, 0.76), (0.985, 0.985, 0.76, 0.86), (1.0, 1.0, 0.86, 1.0)]
    for k0, k1, t0, t1 in prof:
        yazi_tier(g, a * k0, a * k1, z0 + h * t0, z0 + h * t1, key, c_frac, top=(t1 == 1.0))
    # the waist's carved panels, a shade darker, between the corner posts (on the four long faces)
    w = a * 0.94 + 0.03
    n = max(3, round(a * (1 - 2 * c_frac) / 1.6))
    span = a * (1 - 2 * c_frac) * 0.94
    for rot in range(4):
        for k in range(n):
            x = -span + 2 * span * (k + 0.5) / n
            q = []
            for px, py, pz in ((x - span / n * 0.8, -w, z0 + h * 0.36), (x + span / n * 0.8, -w, z0 + h * 0.36),
                               (x + span / n * 0.8, -w, z0 + h * 0.62), (x - span / n * 0.8, -w, z0 + h * 0.62)):
                for _ in range(rot):
                    px, py = -py, px
                q.append((px, py, pz))
            wx, wy = 0.0, -1.0
            for _ in range(rot):
                wx, wy = -wy, wx
            g.polyn(q, "panel", (wx, wy, 0))


def lotus(g, r0, r1, z0, z1, n=40, key="stupa"):
    """莲座: a round band of upturned petals - each a bulge in plan and section - from r0 at z0 out to r1 at z1."""
    rows, cols = 6, n * 4
    verts = []
    for j in range(rows + 1):
        t = j / rows
        z = z0 + (z1 - z0) * t
        base = r0 + (r1 - r0) * math.sin(t * math.pi / 2)
        row = []
        for i in range(cols):
            a = 2 * math.pi * i / cols
            ph = (i % 4) / 4.0
            petal = math.sin(math.pi * ph) ** 0.7                # each petal a swelling, the seam between them sunk
            tip = 1 - abs(2 * t - 1.3) if t > 0.15 else 0.0
            r = base + 0.32 * petal * max(0.0, tip) - 0.05 * (1 - petal)
            row.append(g.vert((r * math.cos(a), r * math.sin(a), z)))
        verts.append(row)
    for j in range(rows):
        for i in range(cols):
            k = (i + 1) % cols
            g.face((verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i]), key, smooth=True)
    ring = [Vector((r1 * math.cos(2 * math.pi * i / cols), r1 * math.sin(2 * math.pi * i / cols), z1)) for i in range(cols)]
    g.polyn([(p.x, p.y, z1) for p in ring], key, (0, 0, 1))


def plate_geo():
    """One of the 华盖's hanging plates: a pierced bronze tablet (a thin slab with a pointed foot) and its bell."""
    g = Geo()
    w, t = 0.32, 0.03
    pts = [(-w, 0.0), (w, 0.0), (w, -0.95), (0.0, -1.25), (-w, -0.95)]
    for s in (-1, 1):
        g.polyn([(x, s * t, z) for x, z in pts], "bronze", (0, s, 0))
    for (xa, za), (xb, zb) in zip(pts, pts[1:] + pts[:1]):
        g.polyn([(xa, -t, za), (xb, -t, zb), (xb, t, zb), (xa, t, za)], "bronze", (xa + xb, 0, za + zb + 0.6))
    ell(g, (0, 0, -1.45), (0.11, 0.11, 0.17), "bronze", nu=6, nv=3)
    return g


def dagoba(lod=False):
    """白塔 at the origin (z = the street): terrace, two 亚 sumeru, lotus, rings, bowl, neck, 十三天, 华盖, finial."""
    g = Geo()
    z = YARD
    S = 48 if not lod else 16
    # the square terrace (方形台基), 14.2 m half, 1.6 m over the 塔院, with a low parapet and a step up from the south
    a0 = 14.2
    zt0 = z + 1.6
    g.box(-a0, a0, -a0, a0, 0.0, zt0 - 0.25, "stupa", skip=("-z", "+z"))
    g.box(-a0 - 0.15, a0 + 0.15, -a0 - 0.15, a0 + 0.15, zt0 - 0.25, zt0, "stupa", skip=("-z",))
    if not lod:
        for k, (xa, xb, ya, yb) in enumerate(((-a0, a0, -a0, -a0 + 0.35), (-a0, a0, a0 - 0.35, a0), (-a0, -a0 + 0.35, -a0 + 0.35, a0 - 0.35),
                                              (a0 - 0.35, a0, -a0 + 0.35, a0 - 0.35))):
            if k == 0:              # the opening where the steps come up
                g.box(xa, -2.9, ya, yb, zt0, zt0 + 0.8, "stupa", skip=("-z",))
                g.box(2.9, xb, ya, yb, zt0, zt0 + 0.8, "stupa", skip=("-z",))
            else:
                g.box(xa, xb, ya, yb, zt0, zt0 + 0.8, "stupa", skip=("-z",))
    # two 折角 sumeru
    s1, s2 = 12.4, 11.0
    za = zt0
    if lod:
        yazi_tier(g, s1, s1, za, za + 3.7, "stupa", 0.18)
        yazi_tier(g, s2, s2, za + 3.7, za + 7.4, "stupa", 0.18)
    else:
        sumeru(g, s1, za, 3.7)
        sumeru(g, s2, za + 3.7, 3.7)
    zl = za + 7.4                        # 10.8
    # the lotus throne and the five rings (金刚圈)
    if lod:
        lathe(g, [(9.8, zl), (10.3, zl + 1.4), (9.3, zl + 1.5), (9.0, zl + 2.6)], 16, "stupa")
    else:
        lathe(g, [(9.9, zl - 0.01), (9.6, zl + 0.1)], 48, "stupa")
        lotus(g, 9.6, 10.3, zl + 0.1, zl + 1.4)
        rings = []
        rz = zl + 1.4
        for k in range(5):
            r = 9.55 - 0.13 * k
            rings += [(r - 0.18, rz), (r, rz + 0.06), (r, rz + 0.18), (r - 0.18, rz + 0.24)]
            rz += 0.24
        lathe(g, [(10.3, zl + 1.4), (9.37, zl + 1.4)] + rings, 48, "stupa")
    zb = zl + 2.6                         # 13.4
    # the bowl (塔身): narrower at its foot, broad and high in the shoulder, 18.4 m across
    bowl = [(8.25, zb), (8.5, zb + 1.2), (8.8, zb + 3.2), (9.05, zb + 5.6), (9.2, zb + 7.6), (9.15, zb + 9.4), (8.85, zb + 10.9),
            (8.15, zb + 12.0), (7.0, zb + 12.9), (5.7, zb + 13.4), (5.2, zb + 13.6)]
    lathe(g, bowl, S, "stupa")
    if not lod:
        # the seven iron hoops round the bowl (铁箍), a little proud
        for k in range(7):
            zz = zb + 1.2 + k * 1.55
            for (r0, z0_), (r1, z1_) in zip(bowl, bowl[1:]):
                if z0_ <= zz <= z1_:
                    r = r0 + (r1 - r0) * (zz - z0_) / (z1_ - z0_) + 0.04
                    lathe(g, [(r, zz - 0.045), (r + 0.015, zz), (r, zz + 0.045)], S, "iron")
                    break
    zn = zb + 13.6                        # 27.0: the neck (塔脖子), a small 亚 sumeru
    if lod:
        yazi_tier(g, 6.0, 5.6, zn, zn + 2.8, "stupa", 0.22)
    else:
        lathe(g, [(5.3, zn - 0.2), (5.3, zn + 0.05)], 32, "stupa")
        for a0_, a1_, z0_, z1_ in ((6.0, 6.0, 0.0, 0.35), (5.8, 5.8, 0.35, 0.6), (5.55, 5.55, 0.6, 2.1), (5.8, 5.8, 2.1, 2.4), (6.05, 6.05, 2.4, 2.8)):
            yazi_tier(g, a0_, a1_, zn + z0_, zn + z1_, "stupa", c_frac=0.22)
    zs = zn + 2.8                          # 29.8: 十三天, a cone of thirteen rings
    sp = [(4.55, zs)]
    ring_h = 14.2 / 13
    for k in range(13):
        r = 4.45 - 1.9 * k / 12
        z0_ = zs + k * ring_h
        sp += [(r - 0.12, z0_ + 0.02), (r + 0.08, z0_ + 0.12), (r + 0.08, z0_ + 0.34), (r - 0.04, z0_ + 0.46)] if not lod else [(r, z0_)]
    sp.append((2.45, zs + 14.2))
    lathe(g, sp, 32 if not lod else 12, "stupa")
    zc = zs + 14.2                         # 44.0: the bronze 华盖, 9.7 m across
    lathe(g, [(2.45, zc), (2.6, zc - 0.05), (4.85, zc + 0.35), (4.9, zc + 0.65), (4.65, zc + 0.85), (3.4, zc + 1.15), (1.6, zc + 1.35), (0.01, zc + 1.4)],
          48 if not lod else 12, "bronze")
    zf = zc + 1.35                          # 45.35: the finial, a gilt bronze stupa
    lathe(g, [(1.25, zf), (1.25, zf + 0.35), (1.05, zf + 0.4), (1.05, zf + 0.75), (1.2, zf + 0.8)], 16, "gold")
    lathe(g, [(0.85, zf + 0.8), (1.0, zf + 1.3), (1.05, zf + 1.8), (0.9, zf + 2.25), (0.55, zf + 2.5)], 16 if not lod else 8, "gold")
    lathe(g, [(0.5, zf + 2.5), (0.42, zf + 3.6), (0.22, zf + 4.3)], 12 if not lod else 6, "gold")
    lathe(g, [(0.22, zf + 4.3), (0.6, zf + 4.45), (0.55, zf + 4.6), (0.15, zf + 4.7)], 12, "gold")
    ell(g, (0, 0, zf + 5.0), (0.24, 0.24, 0.32), "gold", nu=10 if not lod else 6, nv=6 if not lod else 3)
    cyl(g, 0, 0, zf + 5.25, 50.9, 0.06, 0.01, 6, "gold", caps=(False, True))
    return g, zc


def stupa_parts(parts, M):
    """The 华盖's 36 hanging plates and bells, linked duplicates round its rim."""
    me = K.mesh_of(plate_geo(), "PlateMesh", M, K.TILE)
    _, zc = dagoba(lod=True)
    for k in range(36):
        a = 2 * math.pi * (k + 0.5) / 36
        p = (STUPA[0] + 4.7 * math.cos(a), STUPA[1] + 4.7 * math.sin(a), zc + 0.32)
        K.place(me, f"Plate.{k:02d}", parts, T(*p) @ Rz(a - math.pi / 2))


def stupa():
    g, zc = dagoba()
    K.G.add(g, T(STUPA[0], STUPA[1], 0))
    f, _ = dagoba(lod=True)
    K.FAR.add(f, T(STUPA[0], STUPA[1], 0))
    cx, cy = STUPA
    a0 = 14.2
    # steps from the 塔院 up to the terrace on the south (walkable; a car never gets up here)
    sg = Geo()
    ramp = K.steps(sg, cx - 2.6, cx + 2.6, cy - a0, -1, YARD, YARD + 1.6)
    remap = {"marble": "stupa"}
    sg.f = [(i, u, remap.get(k, k), s) for i, u, k, s in sg.f]
    K.G.add(sg, Matrix.Identity(4))
    K.walk(Matrix.Identity(4), ramp)
    COL = K.COLL
    COL.append(("box", cx - a0, cx + a0, cy - a0, cy + a0, 0.0, YARD + 1.6))
    # the parapet round the terrace (open at the steps)
    for x0, x1, y0, y1 in ((cx - a0, cx - 2.9, cy - a0, cy - a0 + 0.35), (cx + 2.9, cx + a0, cy - a0, cy - a0 + 0.35), (cx - a0, cx + a0, cy + a0 - 0.35, cy + a0),
                           (cx - a0, cx - a0 + 0.35, cy - a0, cy + a0), (cx + a0 - 0.35, cx + a0, cy - a0, cy + a0)):
        COL.append(("box", x0, x1, y0, y1, YARD + 1.6, YARD + 2.4))
    za = YARD + 1.6
    COL.append(("box", cx - 12.4, cx + 12.4, cy - 12.4, cy + 12.4, za, za + 7.4))
    ring = [(cx + 9.2 * math.cos(2 * math.pi * i / 12), cy + 9.2 * math.sin(2 * math.pi * i / 12)) for i in range(12)]
    COL.append(("hull", [(x, y, z) for x, y in ring for z in (za + 7.4, za + 7.4 + 15.0)]))
    COL.append(("hull", [(cx + 4.6 * math.cos(2 * math.pi * i / 8), cy + 4.6 * math.sin(2 * math.pi * i / 8), za + 17.0) for i in range(8)]
                + [(cx + 2.4 * math.cos(2 * math.pi * i / 8), cy + 2.4 * math.sin(2 * math.pi * i / 8), zc) for i in range(8)]))
    K.BODIES.append((cx - a0 - 0.5, cx + a0 + 0.5, cy - a0 - 0.5, cy + a0 + 0.5))
    return zc


def tayuan():
    """The raised 凸 court: brick retaining faces, a stone coping, paved top; steps up through the gate."""
    g = Geo()
    f = Geo()
    for x0, x1, y0, y1 in (TAYUAN_S, TAYUAN_N):
        g.box(x0, x1, y0, y1, 0.0, YARD - 0.2, "brick", skip=("-z", "+z"))
        g.box(x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, YARD - 0.2, YARD, "marble", skip=("-z", "+z"))
        g.polyn([(x0 - 0.1, y0 - 0.1, YARD), (x1 + 0.1, y0 - 0.1, YARD), (x1 + 0.1, y1 + 0.1, YARD), (x0 - 0.1, y1 + 0.1, YARD)], "paving", (0, 0, 1))
        f.box(x0, x1, y0, y1, 0.0, YARD, "brick", skip=("-z",))
        K.COLL.append(("box", x0, x1, y0, y1, 0.0, YARD))
    ramp = K.steps(g, -2.2, 2.2, TAYUAN_S[2], -1, 0.0, YARD)
    K.G.add(g, Matrix.Identity(4))
    K.FAR.add(f, Matrix.Identity(4))
    K.walk(Matrix.Identity(4), ramp)
    K.CLEARS.append(rect(TAYUAN_S[0] - 1, TAYUAN_S[1] + 1, TAYUAN_S[2] - 4.5, TAYUAN_S[3]))
    K.CLEARS.append(rect(TAYUAN_N[0] - 1, TAYUAN_N[1] + 1, TAYUAN_N[2] - 0.5, TAYUAN_N[3] + 1))


def yuetai(x0, x1, y0, y1, z, steps_w):
    """A 月台 in front of a hall: a stone platform with steps down the front."""
    g = Geo()
    g.box(x0, x1, y0, y1, 0.0, z, "marble", skip=("-z",))
    ramp = K.steps(g, -steps_w / 2, steps_w / 2, y0, -1, 0.0, z)
    K.G.add(g, Matrix.Identity(4))
    K.walk(Matrix.Identity(4), ramp)
    K.COLL.append(("box", x0, x1, y0, y1, 0.0, z))
    K.BODIES.append((x0, x1, y0, y1))
    f = Geo()
    f.box(x0, x1, y0, y1, 0.0, z, "marble", skip=("-z",))
    K.FAR.add(f, Matrix.Identity(4))


def miaoyingsi(M):
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    # ---- the front court ----------------------------------------------------------------------------------------
    Z.shanmen((-5.4, 7.8, -103.0, -96.4))                                                        # 山门 (off the axis, as OSM)
    K.simple_hall((-21.0, -9.4, -102.0, -96.4), "s", 3.4, tone="g", z0=0.3)                       # rooms either side of the gate
    K.simple_hall((12.1, 19.1, -101.9, -97.0), "s", 3.4, tone="g", z0=0.3)
    for r in ((12.9, 19.6, -80.7, -74.3), (-18.1, -11.4, -81.0, -74.6)):                          # 钟楼, 鼓楼
        half = min(r[1] - r[0], r[3] - r[2]) / 2
        K.tower(r, K.tower_spec(half, 1.0, 4.0, 6.1, 8.6, 1.9), 0.45, 6.1, brick_ground=True, upper_fill=("window", "window"), tone="g")
    K.simple_hall((18.7, EAST - 0.2, -71.2, -62.0), "w", 3.6, tone="g")
    mark("front")
    # ---- 天王殿 and its wings ---------------------------------------------------------------------------------------
    K.main_hall((-6.6, 7.2, -62.7, -52.6), K.spec(5.4, 3.6, K.lin(5.4, 3), K.lin(3.6, 2), 0.8 + 4.5, 1.5, rows=6, end_rows=3, Hk=0.6, gap=1.6, big=False),
                0.8, False, front_doors=1, back_doors=1, beasts=3, front_steps=3.0, back_steps=3.0, col_r=0.34, tone="g")
    K.simple_hall((7.6, 18.0, -61.0, -54.0), "s", 3.4, tone="g")
    K.simple_hall((-17.0, -7.0, -61.7, -54.5), "s", 3.4, tone="g")
    K.simple_hall((18.1, EAST - 0.2, -61.4, -37.4), "w", 3.8, tone="g")
    K.simple_hall((-24.2, -17.1, -61.8, -38.4), "e", 3.8, tone="g")
    K.simple_hall((-24.4, -16.6, -38.2, -26.2), "e", 4.0, tone="g", roof="xie", ov=1.2, Hk=0.55)  # (west side hall)
    K.simple_hall((15.8, EAST - 0.2, -37.3, -25.0), "w", 4.0, tone="g", roof="xie", ov=1.2, Hk=0.55)   # 法幢殿
    mark("tianwang")
    # ---- 意珠心镜殿 with its 月台 -------------------------------------------------------------------------------------
    yuetai(-7.5, 6.5, -23.4, -17.8, 0.9, 4.0)
    K.main_hall((-12.2, 10.6, -18.2, -2.3), K.spec(9.7, 6.2, [-9.7, -6.1, -2.1, 2.1, 6.1, 9.7], K.lin(6.2, 3), 1.0 + 5.1, 1.7, rows=7, end_rows=4, Hk=0.6, gap=1.6),
                1.0, False, front_doors=3, back_doors=1, beasts=5, back_steps=3.0, col_r=0.4, tone="g")
    mark("yizhu")
    # ---- 七佛宝殿 ------------------------------------------------------------------------------------------------------
    K.main_hall((-14.3, 13.7, 14.9, 33.7), K.spec(12.2, 7.6, [-12.2, -7.6, -2.6, 2.6, 7.6, 12.2], K.lin(7.6, 4), 1.1 + 5.6, 1.8, rows=7, end_rows=4, Hk=0.6, gap=1.7),
                1.1, False, front_doors=3, back_doors=1, beasts=5, front_steps=4.0, back_steps=3.0, col_r=0.44, tone="g")
    mark("qifo")
    # ---- the side ranges ------------------------------------------------------------------------------------------
    K.simple_hall((17.6, EAST - 0.2, -25.0, -10.4), "w", 3.8, tone="g")
    K.simple_hall((17.7, EAST - 0.2, -10.0, 6.8), "w", 3.8, tone="g")
    K.simple_hall((17.5, EAST - 0.2, 9.6, 38.8), "w", 4.0, tone="g")
    K.simple_hall((17.5, EAST - 0.2, 39.2, 48.2), "w", 3.6, tone="g")
    K.simple_hall((-25.4, -18.0, -26.0, 10.3), "e", 4.0, tone="g")
    K.simple_hall((-25.4, -18.0, 10.7, 46.9), "e", 4.0, tone="g")
    K.simple_hall((13.6, EAST - 0.2, 52.4, 58.2), "s", 3.4, tone="g")
    K.simple_hall((-23.9, -14.6, 52.8, 59.2), "s", 3.4, tone="g")
    mark("ranges")
    # ---- the 塔院 --------------------------------------------------------------------------------------------------
    tayuan()
    K.main_hall((-8.3, 7.9, 46.8, 58.0), K.spec(6.3, 3.9, K.lin(6.3, 3), K.lin(3.9, 2), YARD + 0.5 + 4.4, 1.6, rows=6, end_rows=3, Hk=0.6, gap=1.6, big=False),
                YARD + 0.5, False, front_doors=1, back_doors=1, beasts=3, col_r=0.34, tone="g")              # 具六神通殿
    K.simple_hall((-19.4, -14.3, 60.8, 66.2), "e", YARD + 3.2, tone="g", z0=YARD + 0.3)
    K.simple_hall((14.5, 19.9, 60.4, 66.1), "w", YARD + 3.2, tone="g", z0=YARD + 0.3)
    mark("tayuan")
    stats["huagai"] = stupa()
    mark("stupa")
    # ---- walls and paving ------------------------------------------------------------------------------------------
    stats["walls"] = K.walls([(p, False) for p in PRECINCT] + [(FRONT_W, False)] + [(w, False) for w in WINGS], zt=4.0, th=0.7, cop="gtex")
    stats["walls"] += K.walls([(PRECINCT_N, False)], zt=YARD + 3.2, th=0.7, cop="gtex")
    stats["walls"] += K.walls([(TAYUAN_W, False), (TAYUAN_E, False)], zt=YARD + 3.0, th=0.6, cop="gtex")
    mark("walls")
    for poly in (rect(-20.6, EAST - 0.4, -101.4, -62.0), rect(-23.6, EAST - 0.4, -62.0, -37.0), rect(-25.1, EAST - 0.4, -37.0, 41.2),
                 rect(-23.4, EAST - 0.4, 41.2, 60.3), rect(-6.0, 9.0, -110.5, -101.4)):
        K.paved(poly)
    return stats


def footprints(helpers):
    """Convex pieces out to the precinct line (the city's generated walls along it go too); the west court is not
    in them (its offices stay the city's)."""
    flat_marker(helpers, "front", rect(-21.6, 24.4, -106.0, -62.6), "FOOTPRINT")
    flat_marker(helpers, "tianwang", rect(-25.0, 24.6, -62.6, -37.0), "FOOTPRINT")
    flat_marker(helpers, "middle", rect(-26.4, 24.6, -37.0, 41.2), "FOOTPRINT")
    flat_marker(helpers, "tayuanS", rect(-26.0, 24.8, 41.2, 60.3), "FOOTPRINT")
    flat_marker(helpers, "tayuanN", rect(-21.0, 21.6, 60.3, 101.2), "FOOTPRINT")
    flat_marker(helpers, "westjog", rect(-26.0, -21.0, 60.3, 69.2), "FOOTPRINT")


def materials():
    M = K.materials("MY", glaze="#5f6163", glaze_tex="#6a6d70", beam_glow=0.75)
    M.update(
        stupa=material("MY_Stupa", "#f1efe8", 0.85, props={"wet": "damp", "glowStrength": 0.55}),
        panel=material("MY_StupaPanel", "#d9d6cc", 0.85, props={"wet": "damp", "glowStrength": 0.5}),
        iron=material("MY_Iron", "#c9c6bc", 0.8, props={"wet": "damp", "glowStrength": 0.4}),
        bronze=material("MY_Bronze", "#8c6a3a", 0.42, metal=0.9, props={"wet": "surface", "glowStrength": 0.5}),
    )
    return M


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = materials()
    K.TILE.update(stupa=2.0, panel=1.0, iron=2.0, bronze=1.0)
    main = collection("妙应寺")
    parts = collection("构件", main)
    stats = miaoyingsi(M)
    K.G.build("Temple", collection("寺", main), M, K.TILE)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze="#5f6163"))
    stupa_parts(parts, M)
    K.FAR.build("Massing", collection("LOD1", main), M, K.TILE)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    footprints(helpers)
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "miaoyingsi", "妙应寺白塔", "Miaoying Temple (White Dagoba)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 500
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
