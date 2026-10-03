# 凤凰国际传媒中心 Phoenix International Media Center (BIAD / 邵韦平, 2014), built in Blender and marked with the
# bcity_landmark add-on's conventions. At the south-west corner of 朝阳公园, OSM relation 3134678 (building=yes, no
# height): an outer ring of 22 points (118 x 119 m) round an inner ring of 16 (61 x 45 m, its centre 12 m south of
# the outer's) - the shell's foot outside and the open court it wraps. The city drew it as a flat ring block.
#
#   blender -b -P scripts/blender/landmarks/phoenix_center.py -- [--out art/landmarks/phoenixcenter.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the outer ring's box, game
# (5980.45, -2736.1), heading 0 (the outline is round).
#
# The real figures (published): 55 m high, 64,973 m2, a 12-storey office block and a 6-storey studio block inside one
# continuous steel shell "taken from the Moebius strip" that wraps the atria round them; 3,800 glass units, every one
# different; sky bridges, viewing platforms and a long escalator in the east and west atria.
# Here: the shell is a lofted tube round the ring - each section a rounded arch from the outer foot (OSM's outer ring,
# smoothed) over to the court's foot (the inner ring), 55 m high at the north end and 32 m at the south, its crest
# drifting from the outer to the inner side round the ring so the section seems to roll; white ribs wind round it,
# each running once round the ring while it climbs from the outer foot over the top and down into the court (the
# shell's "strip" lines); between them dark glass that is partly see-through, so the two blocks (curtain walls in the
# kit's facade shader, lit at night), the bridges and the escalators show inside. A paved round plaza (68 m) under it.
# Far level: the shell opaque with the ribs drawn in its texture.
# Doubtful: which end is high (north, where OSM's tube is 49 m deep, against 25 m on the south) and the south height;
# where the blocks stand (office north, studios south, the atria east and west - from the tube's depth, not a plan);
# the ribs' count, direction and hand; the entrances (two portals, south-west and west, guessed); the court's paving.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Geo, collider_pts, flat_marker, paving  # noqa: E402
from tower import cap, facade, loft  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "phoenixcenter.blend")

GX, GZ = 5980.45, -2736.1
# OSM relation 3134678 in game metres (x, z)
OUTER_G = [(5936.4, -2772.0), (5948.9, -2783.0), (5963.1, -2790.4), (5982.1, -2795.6), (5997.0, -2793.3), (6013.1, -2787.6),
           (6028.0, -2772.7), (6035.4, -2756.7), (6038.8, -2740.7), (6039.5, -2724.6), (6035.6, -2710.9), (6026.9, -2696.7),
           (6013.8, -2686.4), (6000.1, -2678.8), (5984.5, -2676.6), (5965.7, -2678.2), (5950.2, -2683.9), (5936.4, -2693.1),
           (5926.1, -2706.8), (5922.2, -2723.5), (5921.4, -2742.3), (5926.6, -2759.4)]
INNER_G = [(5954.2, -2740.7), (5963.8, -2745.7), (5977.1, -2746.4), (5991.5, -2744.3), (6002.9, -2738.4), (6007.3, -2732.6),
           (6009.1, -2722.3), (6006.3, -2712.9), (6001.2, -2707.1), (5994.5, -2703.4), (5980.0, -2701.3), (5963.8, -2703.3),
           (5956.5, -2707.5), (5950.6, -2713.2), (5947.7, -2721.4), (5949.1, -2733.5)]
OUTER = [(x - GX, -(z - GZ)) for x, z in OUTER_G]
INNER = [(x - GX, -(z - GZ)) for x, z in INNER_G]

HN, HS = 55.0, 32.0          # shell height at the north and south ends
Q = 0.58                     # section exponent: < 1 gives steep feet and a broad rounded crown
NTH, NT = 180, 36            # shell grid round the ring and over the section
NRIB, RIB_W, RIB_D = 30, 0.85, 0.6
PLAZA_R = 68.0
OFFICE = (38.0, 142.0)       # degrees round the ring (0 east, CCW): the office block (north)
STUDIO = (218.0, 322.0)      # the studio block (south)


def ray_radius(poly, th):
    """Distance from the origin to a star-shaped polygon along angle th."""
    d = (math.cos(th), math.sin(th))
    best = 0.0
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = bx - ax, by - ay
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-9:
            continue
        t = (ax * ey - ay * ex) / den
        s = (ax * d[1] - ay * d[0]) / den
        if t > 0 and -1e-6 <= s <= 1 + 1e-6:
            best = max(best, t)
    return best


def smooth_radius(poly, harmonics=7, n=720):
    ths = np.arange(n) * 2 * math.pi / n
    r = np.array([ray_radius(poly, t) for t in ths])
    F = np.fft.rfft(r)
    F[harmonics + 1:] = 0
    rs = np.fft.irfft(F, n)
    return lambda th: float(np.interp(th % (2 * math.pi), np.append(ths, 2 * math.pi), np.append(rs, rs[0])))


RO = smooth_radius(OUTER)
RI = smooth_radius(INNER)


def height(th):
    w = (1 + math.sin(th)) / 2
    return HS + (HN - HS) * w ** 1.25


def crest(th):
    """Where the crest stands across the tube, 0 the court's foot, 1 the outer foot: it drifts round the ring."""
    return 0.5 + 0.16 * math.sin(th - 0.7)


def S(th, t):
    """The shell: th round the ring, t over the section (0 the outer foot, pi the court's foot)."""
    ro, ri = RO(th), RI(th)
    rc = ri + crest(th) * (ro - ri)
    c, s = math.cos(t), max(0.0, math.sin(t))
    x = math.copysign(abs(c) ** Q, c)
    z = height(th) * s ** Q
    r = rc + x * (ro - rc) if x >= 0 else rc + x * (rc - ri)
    return Vector((r * math.cos(th), r * math.sin(th), z))


def _raw_normal(th, t):
    e = 1e-3
    t = min(max(t, 2e-3), math.pi - 2e-3)
    a = S(th + e, t) - S(th - e, t)
    b = S(th, t + e) - S(th, t - e)
    n = a.cross(b)
    n.normalize()
    return n


_p = S(0.3, 0.4)
NSIGN = 1.0 if _raw_normal(0.3, 0.4).dot(Vector((_p.x, _p.y, 0))) > 0 else -1.0


def normal(th, t):
    """The shell's outward normal (away from the tube's inside, on the court side too)."""
    return _raw_normal(th, t) * NSIGN


def shell_z(th, r):
    """The shell's height over radius r at angle th (0 outside the tube)."""
    ts = np.linspace(0, math.pi, 400)
    pts = [S(th, t) for t in ts]
    rr = [math.hypot(p.x, p.y) for p in pts]
    zz = [p.z for p in pts]
    best = 0.0
    for i in range(len(ts) - 1):
        a, b = rr[i], rr[i + 1]
        if (a - r) * (b - r) <= 0 and a != b:
            k = (r - a) / (b - a)
            best = max(best, zz[i] + (zz[i + 1] - zz[i]) * k)
    return best


def sector(a0, a1, din, dout, n=24):
    """An annular sector's plan, counter-clockwise: the outer arc then the inner arc back."""
    out, inn = [], []
    for k in range(n + 1):
        th = math.radians(a0 + (a1 - a0) * k / n)
        out.append((math.cos(th) * (RO(th) - dout), math.sin(th) * (RO(th) - dout)))
        inn.append((math.cos(th) * (RI(th) + din), math.sin(th) * (RI(th) + din)))
    return out + inn[::-1]


def fit_height(a0, a1, din, dout, storey, gap=2.5):
    lo = 1e9
    for k in range(9):
        th = math.radians(a0 + (a1 - a0) * k / 8)
        for r in (RO(th) - dout, RI(th) + din, (RO(th) - dout + RI(th) + din) / 2):
            lo = min(lo, shell_z(th, r))
    return storey * math.floor((lo - gap) / storey)


def stripes(size=256, n=1, w=0.11):
    """The far shell's texture: a white rib along u - v = integer on grey-blue glass (one rib per tile)."""
    y, x = (np.mgrid[0:size, 0:size] + 0.5) / size
    d = np.abs(((x - y) % 1.0) - 0.5)
    rib = d > 0.5 - w / 2
    a = np.empty((size, size, 3), np.float32)
    a[:] = np.array([0.46, 0.53, 0.58], np.float32)
    a[..., :] *= (0.92 + 0.12 * np.sin(y * 2 * math.pi * 6))[..., None]
    a[rib] = np.array([0.9, 0.91, 0.92], np.float32)
    return image("PH_FarStripes", a)


def build():
    clear_file()
    ensure_addon()
    M = dict(
        glass=material("PH_Glass", "#5d7180", 0.08, metal=0.55, props={"wet": "surface", "glow": "none"}),
        rib=material("PH_Rib", "#eef0f0", 0.4, metal=0.25, props={"wet": "surface", "glowStrength": 0.45}),
        office=facade("PH_Office", dict(floorH=4.2, colW=1.5, glass="#7e909c", frame="#d4d8db", spandrel="#bfc5c9", mull=0.07, slab=0.14, metal=0.6, rough=0.12, lit=0.38, seed=31)),
        studio=facade("PH_Studio", dict(floorH=5.4, colW=2.4, glass="#6f8290", frame="#c9ced2", spandrel="#a9b0b5", mull=0.05, slab=0.3, metal=0.5, rough=0.2, lit=0.25, seed=32)),
        roof=material("PH_Roof", "#8d9091", 0.85, props={"wet": "ground", "glow": "none"}),
        steel=material("PH_Steel", "#d9dcde", 0.35, metal=0.6, props={"wet": "surface", "glowStrength": 0.3}),
        stair=material("PH_Escalator", "#4c5257", 0.3, metal=0.8, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.92, 0.8], "glowStrength": 0.25}),
        door=material("PH_Door", "#41505a", 0.05, metal=0.8, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.85, 0.6], "glowStrength": 0.35}),
        pave=material("PH_Paving", "#b7b3ab", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 9}),
        far=material("PH_Far", "#c0c6ca", 0.35, metal=0.3, tex=stripes(), props={"wet": "surface", "glowStrength": 0.4}),
    )
    gm = M["glass"]
    b = gm.node_tree.nodes.get("Principled BSDF")
    b.inputs["Alpha"].default_value = 0.5
    try:
        gm.surface_render_method = "BLENDED"
    except Exception:
        gm.blend_method = "BLEND"
    gm.use_backface_culling = True
    TILE = dict(pave=4.0, roof=4.0, steel=2.0, stair=2.0)
    main = collection("凤凰中心")

    # ---- the shell: a smooth glass tube round the ring ----
    g = Geo()
    ths = [2 * math.pi * i / NTH for i in range(NTH)]
    ts = [math.pi * (1 - math.cos(math.pi * j / NT)) / 2 for j in range(NT + 1)]   # denser at the feet, where the section is steep
    ids = [[g.vert(S(th, t)) for t in ts] for th in ths]
    # orientation: the quad (th, t) -> (th+, t) -> (th+, t+) -> (th, t+) must face out at the outer foot
    p00, p10, p01 = S(ths[0], ts[1]), S(ths[1], ts[1]), S(ths[0], ts[2])
    flip = (p10 - p00).cross(p01 - p00).dot(Vector((p00.x, p00.y, 0))) < 0
    for i in range(NTH):
        k = (i + 1) % NTH
        for j in range(NT):
            q = [ids[i][j], ids[k][j], ids[k][j + 1], ids[i][j + 1]]
            g.face(q[::-1] if flip else q, "glass", smooth=True)

    # ---- the ribs: each once round the ring, from the outer foot over the crown into the court ----
    MR = 150
    for r in range(NRIB):
        th0 = 2 * math.pi * r / NRIB
        rows = []
        for m in range(MR + 1):
            s = (1 - math.cos(math.pi * m / MR)) / 2     # denser at the feet
            th, t = th0 + 2 * math.pi * s, math.pi * s
            p = S(th, t)
            n = normal(th, t)
            rows.append((p, n))
        corners = []
        for m, (p, n) in enumerate(rows):
            a = rows[max(0, m - 1)][0]
            c = rows[min(MR, m + 1)][0]
            tan = (c - a).normalized()
            side = n.cross(tan).normalized()
            cs = [p + side * (-RIB_W / 2) + n * (-0.15), p + side * (RIB_W / 2) + n * (-0.15), p + side * (RIB_W / 2) + n * RIB_D, p + side * (-RIB_W / 2) + n * RIB_D]
            corners.append([g.vert((c.x, c.y, max(0.0, c.z))) for c in cs])
        # winding: check one face against its intended outward direction
        p, n = rows[MR // 2]
        tan = (rows[MR // 2 + 1][0] - rows[MR // 2 - 1][0]).normalized()
        side = n.cross(tan).normalized()
        A, B = corners[MR // 2], corners[MR // 2 + 1]
        v = [Vector(g.v[i]) for i in (A[2], A[3], B[3], B[2])]
        rev = (v[1] - v[0]).cross(v[3] - v[0]).dot(n) < 0
        for m in range(MR):
            A, B = corners[m], corners[m + 1]
            for e in (1, 2, 3):          # the two sides and the top; the bottom is inside the glass
                f = [A[e], A[(e + 1) % 4], B[(e + 1) % 4], B[e]]
                # A[e] -> A[e+1] runs round the section; the top face (e = 2) must face +n
                g.face(f[::-1] if rev else f, "rib")
        # end caps (the feet)
        for A in (corners[0], corners[-1]):
            g.face(A, "rib")
            g.face(A[::-1], "rib")

    # ---- the blocks inside ----
    ofh = fit_height(*OFFICE, 4.0, 5.0, 4.2)
    sth = fit_height(*STUDIO, 3.0, 3.0, 5.4)
    for key, (a0, a1), din, dout, h in (("office", OFFICE, 4.0, 5.0, ofh), ("studio", STUDIO, 3.0, 3.0, sth)):
        plan = sector(a0, a1, din, dout)
        loft(g, [(0.0, plan), (h, plan)], key)
        cap(g, h, plan, "roof")
        # a plant room and a parapet on the roof
        th = math.radians((a0 + a1) / 2)
        rm = (RO(th) - dout + RI(th) + din) / 2
        cx, cy = rm * math.cos(th), rm * math.sin(th)
        g.box(cx - 6, cx + 6, cy - 4, cy + 4, h, h + 2.0, "steel", skip=("-z",))
    # the atria: a sky bridge and a long escalator each, east and west
    for side in (0.0, math.pi):
        a_lo = math.radians(STUDIO[1]) if side == 0 else math.radians(OFFICE[1])
        a_hi = math.radians(OFFICE[0]) + 2 * math.pi if side == 0 else math.radians(STUDIO[0])
        if side == 0:
            a_lo -= 2 * math.pi
            a_hi -= 2 * math.pi
        zb = min(ofh, sth) - 5.4
        n = 8
        pts = []
        for k in range(n + 1):
            th = a_lo + (a_hi - a_lo) * k / n
            rm = RI(th) + 0.45 * (RO(th) - RI(th))
            pts.append(Vector((rm * math.cos(th), rm * math.sin(th), zb)))
        for a, c in zip(pts, pts[1:]):
            d = (c - a)
            L = d.length
            d.normalize()
            w = Vector((-d.y, d.x, 0)) * 1.6
            q = [a - w, c - w, c + w, a + w]
            g.polyn([tuple(p) for p in q], "steel", (0, 0, 1))
            g.polyn([tuple(p - Vector((0, 0, 1.0))) for p in q], "steel", (0, 0, -1))
            for s_ in (-1, 1):
                e0, e1 = a + w * s_, c + w * s_
                g.polyn([tuple(e0 - Vector((0, 0, 1.0))), tuple(e1 - Vector((0, 0, 1.0))), tuple(e1 + Vector((0, 0, 1.1))), tuple(e0 + Vector((0, 0, 1.1)))],
                        "door", (w.x * s_, w.y * s_, 0))
        # the escalator: from the floor near the studio up to the bridge near the office
        th_a, th_b = a_lo + (a_hi - a_lo) * 0.12, a_lo + (a_hi - a_lo) * 0.62
        ra = RI(th_a) + 0.7 * (RO(th_a) - RI(th_a))
        rb = RI(th_b) + 0.7 * (RO(th_b) - RI(th_b))
        a = Vector((ra * math.cos(th_a), ra * math.sin(th_a), 1.0))
        c = Vector((rb * math.cos(th_b), rb * math.sin(th_b), zb - 0.5))
        d = (c - a).normalized()
        w = Vector((-d.y, d.x, 0)).normalized() * 1.3
        dn = Vector((0, 0, -1.0))
        corners = [a - w, c - w, c + w, a + w]
        g.polyn([tuple(p) for p in corners], "stair", d.cross(w).normalized() if d.cross(w).z > 0 else -d.cross(w).normalized())
        g.polyn([tuple(p + dn) for p in corners], "steel", (0, 0, -1))
        for s_ in (-1, 1):
            g.polyn([tuple(a + w * s_ + dn), tuple(c + w * s_ + dn), tuple(c + w * s_ + Vector((0, 0, 1.0))), tuple(a + w * s_ + Vector((0, 0, 1.0)))], "door", (w.x * s_, w.y * s_, 0))

    # ---- entrances: portals through the shell's foot ----
    for deg in (-118.0, 182.0):
        th = math.radians(deg)
        ro = RO(th)
        u = Vector((math.cos(th), math.sin(th), 0))
        v = Vector((-u.y, u.x, 0))
        o = u * (ro - 4.0)
        W, H, D = 6.0, 5.5, 7.0
        def P(a, b, z):
            return tuple(o + u * a + v * b + Vector((0, 0, z)))
        # frame: two jambs and the lintel, a canopy; the glass doors set back
        for b0, b1 in ((-W - 0.8, -W), (W, W + 0.8)):
            for (pa, pb, nn) in (((0, b0), (D, b0), -v), ((D, b0), (D, b1), u), ((D, b1), (0, b1), v)):
                g.polyn([P(pa[0], pa[1], 0), P(pb[0], pb[1], 0), P(pb[0], pb[1], H), P(pa[0], pa[1], H)], "steel", tuple(nn))
        for (pa, pb, nn) in (((0, -W - 0.8), (D + 1.5, -W - 0.8), -v), ((D + 1.5, W + 0.8), (0, W + 0.8), v), ((D + 1.5, -W - 0.8), (D + 1.5, W + 0.8), u)):
            g.polyn([P(pa[0], pa[1], H), P(pb[0], pb[1], H), P(pb[0], pb[1], H + 0.9), P(pa[0], pa[1], H + 0.9)], "steel", tuple(nn))
        g.polyn([P(0, -W - 0.8, H + 0.9), P(D + 1.5, -W - 0.8, H + 0.9), P(D + 1.5, W + 0.8, H + 0.9), P(0, W + 0.8, H + 0.9)], "steel", (0, 0, 1))
        g.polyn([P(0, -W, H), P(D + 1.5, -W, H), P(D + 1.5, W, H), P(0, W, H)], "door", (0, 0, -1))
        g.polyn([P(D - 2.0, -W, 0), P(D - 2.0, W, 0), P(D - 2.0, W, H), P(D - 2.0, -W, H)], "door", tuple(u))

    # ---- the plaza ----
    disc = [(PLAZA_R * math.cos(2 * math.pi * k / 72), PLAZA_R * math.sin(2 * math.pi * k / 72)) for k in range(72)]
    g.polyn([(x, y, 0.03) for x, y in disc], "pave", (0, 0, 1))
    g.build("Center", collection("凤凰中心", main), M, TILE)
    tris = g.tris()

    # ---- far level: the shell opaque with its ribs in the texture, the plaza ----
    far = Geo()
    FT, FS = 72, 12
    fths = [2 * math.pi * i / FT for i in range(FT)]
    fts = [math.pi * (1 - math.cos(math.pi * j / FS)) / 2 for j in range(FS + 1)]
    fid = [[far.vert(S(th, t)) for t in fts] for th in fths]
    for i in range(FT):
        k = (i + 1) % FT
        for j in range(FS):
            q = [fid[i][j], fid[k][j], fid[k][j + 1], fid[i][j + 1]]
            # u - v = integer on the ribs: u = NRIB th / 2pi, v = NRIB t / pi
            v0, v1 = NRIB * fts[j] / math.pi, NRIB * fts[j + 1] / math.pi
            uv = [(NRIB * i / FT, v0), (NRIB * (i + 1) / FT, v0), (NRIB * (i + 1) / FT, v1), (NRIB * i / FT, v1)]
            far.face(q[::-1] if flip else q, "far", uv[::-1] if flip else uv, smooth=True)
    far.polyn([(x, y, 0.03) for x, y in disc], "pave", (0, 0, 1))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # ---- colliders: the tube in 36 sectors, each the hull of its two sections; the portals ----
    helpers = collection("碰撞体")
    NS = 36
    for k in range(NS):
        pts = []
        for th in (2 * math.pi * k / NS, 2 * math.pi * (k + 1) / NS):
            for j in range(11):
                p = S(th, math.pi * j / 10)
                pts.append(tuple(p))
        collider_pts(helpers, f"shell{k}", pts)
    for deg in (-118.0, 182.0):
        th = math.radians(deg)
        u = Vector((math.cos(th), math.sin(th), 0))
        v = Vector((-u.y, u.x, 0))
        o = u * (RO(th) - 4.0)
        for b0, b1 in ((-6.8, -6.0), (6.0, 6.8)):
            pts = [tuple(o + u * a + v * bb + Vector((0, 0, z))) for a in (0.0, 7.0) for bb in (b0, b1) for z in (0.0, 5.5)]
            collider_pts(helpers, "jamb", pts)
        pts = [tuple(o + u * a + v * bb + Vector((0, 0, z))) for a in (0.0, 5.0) for bb in (-6.0, 6.0) for z in (0.0, 5.5)]
        collider_pts(helpers, "doors", pts)

    flat_marker(helpers, "phoenix", [(x * 1.01, y * 1.01) for x, y in OUTER], "FOOTPRINT")
    flat_marker(helpers, "phoenix", disc, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "phoenixcenter", "凤凰国际传媒中心", "Phoenix International Media Center"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, far=far.tris(), office=ofh, studio=sth)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
