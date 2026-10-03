# 牛街礼拜寺 Niujie Mosque on 牛街 (西城, 宣南), Beijing's oldest and largest mosque, in Blender with the timber
# halls of hall.py and the courtyard pieces of gongwangfu.py (imported: side halls, walls, pavilions, towers,
# instances), marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/niujie_mosque.py -- [--out art/landmarks/niujiemosque.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin at game (-3344, 2717.3) on the prayer hall's axis by its front,
# heading -1.8 (the precinct, OSM way 30784907, and its halls lean 1.7-2.9 degrees). OSM has the precinct
# (~120 x 100 m, wider to the north-east), the prayer hall (way 1318466345: 36 m long, 15 m wide, 20 m at its
# west end), the 邦克楼 (way 1343709213, 7 x 7.5 m), two halls east of it (1318466341/2), side and back halls;
# the machine-learnt roofs in the tiles give the lecture halls and the 望月楼 (a 5 m blob at the street front).
#
# The mosque sits east of 牛街 and faces west (坐东朝西): the prayer hall's 窑殿 must be at its west end, so the
# 望月楼 stands at the street gate right behind it, and you go in by the side gates and round to the court east
# of the hall. From the street east: the 望月楼 (two storeys, hexagonal, double-eaved 攒尖 in yellow glaze with a
# green edge) in the west wall between two side gates; the 礼拜殿 on a 0.9 m platform - three 勾连搭 roofs
# (two 歇山 and a 庑殿 behind, ridges running north-south) over a five-bay front with a veranda, the 窑殿 at the
# back under a hexagonal 攒尖 pavilion roof, flanked by two low 抱厦; a 月台 with steps before it; the 邦克楼
# (square, two storeys, double-eaved 歇山) on the axis in the court; the two 碑亭 north and south of it; the
# 对厅 (seven bays) and the hall behind it east of the court; the north and south 讲堂 (five bays, grey tiles,
# front veranda); the back and side halls round the precinct as OSM and the learnt roofs have them; grey
# brick walls with tiled copings. The large north-east block (way 1318466348) is left to the city.
#
# Sources: OSM; 维基百科 牛街礼拜寺 (坐东朝西; 望月楼 两层六角重檐攒尖 黄琉璃瓦绿剪边 about 10 m; 礼拜殿 three
# 勾连搭 roofs and a hexagonal pavilion, 39 m deep, 760 m2; 邦克楼 two-storey square 重檐歇山; north and south
# 碑亭; 讲堂 five bays grey tiles with a front veranda; 对厅 east of the 邦克楼); visitbeijing (the front two
# roofs 歇山, the back one 庑殿, 抱厦 on both sides). Doubtful: the prayer hall's tile colour (green glaze here,
# as the brief said; it may be grey with a green edge), the 窑殿 pavilion's height and single eave, the 邦克楼's
# grey tiles and height, the 碑亭's form and exact places, which back halls are old, the 望月楼's height
# (about 13 m to the finial here) and its plan size (OSM has no outline for it).

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import QUAD, Geo, cyl, ell, flat_marker, rect  # noqa: E402
import hall  # noqa: E402
from hall import cdir, ring_beams, roofs, sweep, to_world, uvs  # noqa: E402
import gongwangfu as K  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "niujiemosque.blend")
HEADING = -1.8
ANCHOR = (-3344.0, 2717.3)
PI2 = math.pi / 2
GREEN, GREEN_TEX = "#3f7d4c", "#438253"
YELLOW, YELLOW_TEX = "#d9a02a", "#e0ab36"


# --- polygonal (hexagonal) 攒尖 roofs -------------------------------------------------------------------

def corner(cx, cy, r, k, n, a0):
    a = a0 + 2 * math.pi * k / n
    return Vector((cx + r * math.cos(a), cy + r * math.sin(a), 0.0))


def poly_roof(g, cx, cy, n, r0, z0, r1, z1, a0, key, ridge, rows=5, cols=4, p=1.45, lift=0.45, push=0.35, trim=0.0,
              trim_key="trim", wall_r=None, wall_z=None):
    """An n-sided roof from the eave (corner radius r0 at z0) up to r1 at z1 (r1 = 0: a point, 攒尖): concave, the
    corners swept up and out, tile rows from the texture (UVs in metres), the eave's edge and the rafters under
    it back to the wall (wall_r, wall_z), a ridge down every hip. Returns the hip lines."""
    chord = 2 * math.sin(math.pi / n)
    S = math.hypot((r0 - r1) * math.cos(math.pi / n), z1 - z0)
    ts = [(j / rows) ** 1.15 for j in range(rows + 1)]
    if r1 <= 1e-6:
        ts[-1] = 0.985
    tt = trim / S if trim else 0.0
    if 0 < tt < 1:
        ts = sorted(set(ts) | {tt})
    Lc = 0.45 * r0 * chord
    c = Vector((cx, cy, 0.0))
    hips = [[] for _ in range(n)]
    for k in range(n):
        A, B = corner(0, 0, 1, k, n, a0), corner(0, 0, 1, k + 1, n, a0)
        mid = (A + B) / 2
        prev = None
        pt = 0.0
        eave = None
        for t in ts:
            R = r0 + (r1 - r0) * t
            E = R * chord
            z = z0 + (z1 - z0) * t ** p
            row = []
            for i in range(cols + 1):
                u = i / cols
                q = A.lerp(B, u) * R
                d = min(u, 1 - u) * E
                kc = max(0.0, 1 - d / Lc) ** 2 * max(0.0, 1 - t / 0.6) ** 1.5
                rad = q.normalized() if q.length > 1e-6 else Vector((1, 0, 0))
                pos = c + q + rad * push * kc + Vector((0, 0, z + lift * kc))
                row.append((g.vert(pos), ((u - 0.5) * E / K.TEX_U, t * S / K.TEX_V)))
            if prev is not None:
                fk = trim_key if tt and pt < tt - 1e-6 else key
                for i in range(cols):
                    q4 = [prev[i], prev[i + 1], row[i + 1], row[i]]
                    pts = [Vector(g.v[v[0]]) for v in q4]
                    nrm = (pts[1] - pts[0]).cross(pts[3] - pts[0])
                    want = Vector((mid.x, mid.y, 1.0))
                    if nrm.dot(want) < 0:
                        q4 = q4[::-1]
                    g.face([v[0] for v in q4], fk, uvs=[v[1] for v in q4], smooth=True)
            else:
                eave = [Vector(g.v[v[0]]) for v in row]
            hips[k].append(Vector(g.v[row[0][0]]))
            prev, pt = row, t
        # the eave's edge carried down, and the rafters under it back to the wall
        for a, b in zip(eave, eave[1:]):
            g.polyn([a, b, b + Vector((0, 0, -0.3)), a + Vector((0, 0, -0.3))], trim_key if trim else key, (mid.x, mid.y, 0))
        if wall_r:
            wa, wb = c + A * wall_r + Vector((0, 0, wall_z)), c + B * wall_r + Vector((0, 0, wall_z))
            ea, eb = eave[0] + Vector((0, 0, -0.3)), eave[-1] + Vector((0, 0, -0.3))
            g.polyn([ea, eb, wb, wa], "atlas", (0, 0, -1), uvs=uvs("rafters", ((0, 0), (1, 0), (1, 1), (0, 1))))
    for line in hips:
        sweep(g, line, 0.42, 0.34, key=ridge)
    return hips


def hex_walls(g, cx, cy, r, z0, z1, regs, a0, inset=0.0):
    """Walls round an n-gon (n = len(regs)), each face an atlas region (or 'plaster' / 'brick')."""
    n = len(regs)
    c = Vector((cx, cy, 0.0))
    for k, reg in enumerate(regs):
        A, B = corner(0, 0, r, k, n, a0), corner(0, 0, r, k + 1, n, a0)
        out = (A + B) / 2
        a, b = c + A - out.normalized() * inset, c + B - out.normalized() * inset
        q = [(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)]
        if reg in ("plaster", "brick", "marble", "red"):
            g.polyn(q, reg, (out.x, out.y, 0))
        else:
            g.polyn(q, "atlas", (out.x, out.y, 0), uvs=uvs(reg, QUAD))


def hex_slab(g, cx, cy, r, z0, z1, key, n, a0):
    pts = [corner(cx, cy, r, k, n, a0) for k in range(n)]
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        out = (a + b) / 2 - Vector((cx, cy, 0))
        g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out.x, out.y, 0))
    g.polyn([(p.x, p.y, z1) for p in pts], key, (0, 0, 1))


def hex_far(f, cx, cy, n, a0, rw, zw, re, ze, zt, key, wall="plaster"):
    hex_slab(f, cx, cy, rw, 0.0, zw, wall, n, a0)
    pts = [corner(cx, cy, re, k, n, a0) for k in range(n)]
    for k in range(n):
        a, b = pts[k], pts[(k + 1) % n]
        out = (a + b) / 2 - Vector((cx, cy, 0))
        f.polyn([(a.x, a.y, ze), (b.x, b.y, ze), (cx, cy, zt)], key, (out.x, out.y, 1))


def hull_hex(cx, cy, r, z0, z1, n, a0):
    K.COLL.append(("hull", [tuple(corner(cx, cy, r, k, n, a0) + Vector((0, 0, z))) for k in range(n) for z in (z0, z1)]))


def gold_finial(g, cx, cy, z, s=1.0):
    cyl(g, cx, cy, z - 0.25, z + 0.25, 0.55 * s, 0.45 * s, 12, "trim", caps=(False, True))
    cyl(g, cx, cy, z + 0.25, z + 0.55, 0.38 * s, 0.38 * s, 12, "gold", caps=(False, True))
    ell(g, (cx, cy, z + 1.05 * s), (0.42 * s, 0.42 * s, 0.6 * s), "gold", nu=12, nv=7)
    cyl(g, cx, cy, z + 1.55 * s, z + 2.0 * s, 0.1 * s, 0.03, 8, "gold", caps=(False, True))


# --- 望月楼 -------------------------------------------------------------------------------------------------

def wangyuelou(cx, cy):
    """Two storeys, hexagonal, a corner column at every vertex: lattice windows round the ground storey with doors
    to the street and the court, a skirt roof, the upper storey set in under the main 攒尖 roof; yellow glaze
    with a green edge and green hips, a gilt finial."""
    n, a0 = 6, math.pi / 6               # vertices north and south, flats east and west (to the street and the court)
    g = Geo()
    zb, rb = 0.75, 4.6                   # the stone base
    hex_slab(g, cx, cy, rb, 0.0, zb, "marble", n, a0)
    r1, z1 = 3.35, 4.3                   # ground storey: corner radius, wall top
    regs = ["window", "window", "door", "window", "window", "door"]       # face k faces 60 + 60k degrees: 2 west, 5 east
    hex_walls(g, cx, cy, r1, zb, z1, regs, a0)
    hex_walls(g, cx, cy, r1 + 0.08, z1, z1 + 0.6, ["beam"] * n, a0)
    r2, z2a, z2b = 2.45, 5.35, 7.75      # upper storey
    hex_walls(g, cx, cy, r2 + 0.15, z2a - 0.45, z2a + 0.35, ["plank"] * n, a0)
    hex_walls(g, cx, cy, r2, z2a + 0.35, z2b, ["band"] * n, a0)
    hex_walls(g, cx, cy, r2 + 0.08, z2b, z2b + 0.55, ["beam"] * n, a0)
    # the upper storey's railing round the skirt roof's top
    poly_roof(g, cx, cy, n, r1 + 1.25, z1 + 0.45, r2 + 0.1, z2a - 0.1, a0, "ytex2", "trim", rows=3, cols=4, p=1.2,
              lift=0.35, push=0.25, trim=0.4, wall_r=r1 + 0.1, wall_z=z1 + 0.6)
    poly_roof(g, cx, cy, n, r2 + 1.45, z2b + 0.4, 0.0, z2b + 4.0, a0, "ytex2", "trim", rows=5, cols=4, p=1.5,
              lift=0.45, push=0.3, trim=0.45, wall_r=r2 + 0.1, wall_z=z2b + 0.55)
    gold_finial(g, cx, cy, z2b + 3.85, 0.8)
    K.G.add(g, K.M_of(0, 0, 0))
    for k in range(n):
        p = corner(cx, cy, r1 + 0.02, k, n, a0)
        K.column(K.M_of(0, 0, 0), p.x, p.y, zb, z1 - zb, 0.24)
    hull_hex(cx, cy, rb, 0.0, zb, n, a0)
    hull_hex(cx, cy, r1 + 0.25, zb, z2b + 0.6, n, a0)
    K.BODIES.append((cx - rb - 0.3, cx + rb + 0.3, cy - rb - 0.3, cy + rb + 0.3))
    K.CLEARS.append([(cx - rb - 1.5, cy - rb - 1.5), (cx + rb + 1.5, cy - rb - 1.5), (cx + rb + 1.5, cy + rb + 1.5), (cx - rb - 1.5, cy + rb + 1.5)])
    f = Geo()
    hex_slab(f, cx, cy, rb, 0.0, zb, "marble", n, a0)
    hex_far(f, cx, cy, n, a0, r1, z1 + 0.6, r1 + 1.25, z1 + 0.45, z2a, "yel")
    hex_far(f, cx, cy, n, a0, r2, z2b + 0.5, r2 + 1.45, z2b + 0.4, z2b + 4.0, "yel")
    K.FAR.add(f, K.M_of(0, 0, 0))
    return z2b + 4.0 + 1.6


# --- 礼拜殿 ---------------------------------------------------------------------------------------------------

def section_spec(OX, OY, zb, ov, kind, rows):
    h = K.spec(OX, OY, K.lin(OX, 5), K.lin(OY, 2), zb, ov, kind=kind, rows=rows, end_rows=4, gap=1.6, Hk=0.6, big=False)
    return h


def prayer_hall():
    """Three 勾连搭 sections (歇山, 歇山, 庑殿; ridges north-south) over one long body on a platform, the 窑殿's
    hexagonal pavilion behind them with a low 抱厦 either side, a 月台 and steps before the front."""
    zb0 = 0.9                                   # platform
    OX = 6.4                                    # half width (north-south) at the columns
    ov = 1.3
    front = -7.6                                # the front column line
    wall_front = -9.4                           # the front wall behind the veranda
    valleys = [front, -14.5, -22.0, -29.6]
    kinds = ["xieshan", "xieshan", "wudian"]
    zcol = zb0 + 4.5                            # the beam's foot over the columns
    hx = -35.2                                  # the 窑殿's centre
    # platform under the whole hall, the wide back included, and the 月台
    K.platform((-42.6, -6.8, -OX - 0.9, OX + 0.9), zb0)
    K.platform((-42.6, -29.0, -10.4, 10.2), zb0)
    K.platform((-6.8, -3.6, -6.0, 6.0), zb0)
    gs = Geo()
    ramp = K.steps(gs, -3.0, 3.0, 0.0, -1, 0.0, zb0)             # in a frame whose -y is east
    ms = K.M_of(-3.6, 0.0, PI2)
    K.G.add(gs, ms)
    K.walk(ms, ramp)
    K.BODIES.append((-43.0, -1.5, -10.8, 10.6))
    K.CLEARS.append(rect(-44.0, -1.0, -12.0, 12.0))
    for s in range(3):
        x_front, x_back = valleys[s], valleys[s + 1]
        cx = (x_front + x_back) / 2
        OY = (x_front - x_back) / 2
        h = section_spec(OX, OY, zcol, ov, kinds[s], rows=7 if s == 0 else 6)
        h.TRIM, h.RIDGE = 0.0, "tile"
        m = K.M_of(cx, 0.0, PI2)                # the spec's front (-y) faces east
        g = Geo()
        hips = roofs(h, g)
        sides = "ew" + ("s" if s == 0 else "")
        K.beam_band(g, h.OX, h.OY, h.BEAM[0], h.BEAM[3] - 0.2, sides=sides, off=0.05)
        K.G.add(g, m)
        for line in hips:
            K.HIPS.append(([m @ p for p in line], 4))
        if s == 0:
            K.brackets_on(h, m, True, h.BEAM[2], 0.8)
        f = Geo()
        K.far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.5, "tile")
        K.FAR.add(f, m)
        top = h.UPPER["z"]
    # the body's walls: lattice doors across the front behind the veranda, windows down the sides, the veranda's ceiling
    g = Geo()
    zt = zcol
    nb = 5
    ys = K.lin(OX, nb)
    for i in range(nb):
        reg = "door" if i in (1, 2, 3) else "window"
        g.polyn([(wall_front, ys[i], zb0), (wall_front, ys[i + 1], zb0), (wall_front, ys[i + 1], zt), (wall_front, ys[i], zt)], "atlas", (1, 0, 0), uvs=uvs(reg, QUAD))
    K.ceiling(g, wall_front, front, -OX, OX, zt)
    for sy in (-1, 1):
        xs = [wall_front + (-31.2 - wall_front) * i / 6 for i in range(7)]
        for i in range(6):
            q = [(xs[i], sy * OX, zb0), (xs[i + 1], sy * OX, zb0), (xs[i + 1], sy * OX, zt), (xs[i], sy * OX, zt)]
            if i % 2 == 0:
                g.polyn(q, "atlas", (0, sy, 0), uvs=uvs("window", QUAD))
            else:
                g.polyn(q, "plaster", (0, sy, 0))
        g.polyn([(front, sy * OX, zb0), (wall_front, sy * OX, zb0), (wall_front, sy * OX, zt), (front, sy * OX, zt)], "plaster", (0, sy, 0))
    for y in ys:                                  # the front columns
        K.column(K.M_of(0, 0, 0), front, y, zb0, zt - zb0, 0.3)
    K.G.add(g, K.M_of(0, 0, 0))
    K.cbox(K.M_of(0, 0, 0), -31.2, wall_front, -OX, OX, 0.0, top)
    for y in ys:
        K.COLL.append(("box", front - 0.3, front + 0.3, y - 0.3, y + 0.3, 0.0, zt))
    f = Geo()
    f.box(valleys[3] - 2.0, front, -OX, OX, 0.0, zt + 0.5, "plaster", skip=("-z",))
    K.FAR.add(f, K.M_of(0, 0, 0))
    # the 窑殿: a hexagonal drum (flats east and west) under a 攒尖 pavilion roof, rising over the back
    n, a0 = 6, math.pi / 6
    rw = 4.7
    zw = 7.9
    g = Geo()
    regs = ["window", "window", "plaster", "window", "window", "plaster"]       # 2 west (the qibla), 5 east (inside the hall)
    hex_walls(g, hx, 0.0, rw, zb0, zw, regs, a0)
    hex_walls(g, hx, 0.0, rw + 0.08, zw, zw + 0.6, ["beam"] * n, a0)
    poly_roof(g, hx, 0.0, n, rw + 1.5, zw + 0.45, 0.0, zw + 4.2, a0, "ytex", "tile", rows=5, cols=4, p=1.5,
              wall_r=rw + 0.1, wall_z=zw + 0.6)
    gold_finial(g, hx, 0.0, zw + 4.05, 0.85)
    K.G.add(g, K.M_of(0, 0, 0))
    hull_hex(hx, 0.0, rw, 0.0, zw + 0.6, n, a0)
    f = Geo()
    hex_far(f, hx, 0.0, n, a0, rw, zw + 0.6, rw + 1.5, zw + 0.45, zw + 4.2, "tile")
    K.FAR.add(f, K.M_of(0, 0, 0))
    # the 抱厦 either side of it: low 歇山 halls facing north and south, roofs ridged east-west
    for sy in (-1, 1):
        K.simple_hall_at(hx + 0.4, sy * 7.6, 0 if sy < 0 else 2 * PI2, 5.9, 2.9, zb0 + 3.6, roof="xie", ov=1.0, z0=zb0,
                         door_bays=0, Hk=0.55, clear=False)
    return zw + 4.2 + 2.0


# --- the plan -------------------------------------------------------------------------------------------------

# the precinct wall (local metres): the street front pulled in to the 望月楼's line, the north-east block left out
WALL = [(-55.0, -35.5), (-55.0, 27.0), (13.8, 27.0), (13.8, 24.0), (59.2, 24.0), (59.2, -45.5), (12.3, -45.5), (12.3, -35.5)]


def niujie():
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = K.G.tris() - tri[0]
        tri[0] = K.G.tris()

    stats["top_wyl"] = wangyuelou(-55.0, 0.0)
    mark("wangyuelou")
    stats["top_hall"] = prayer_hall()
    mark("prayer_hall")
    bk = K.tower((1.0, 8.3, -2.6, 4.8), K.tower_spec(3.85, 1.0, 4.1, 6.2, 8.6, 1.9), 0.5, 6.2, doors_front=1, doors_back=1,
                 facing="e", tone="g", ground="window", ground_ends="window")
    mark("bangkelou")
    for sy in (-1, 1):                                   # 碑亭: a stele under a small 歇山 on four columns
        cy = sy * 12.4 + 1.1
        K.pavilion(4.6, cy, 1.9, zb=0.45, H_body=3.1, tone="g", kind="xieshan")
        K.G.box(4.0, 5.2, cy - 0.32, cy + 0.32, 0.45, 0.95, "marble")
        K.G.box(4.15, 5.05, cy - 0.17, cy + 0.17, 0.95, 2.8, "white")
        K.COLL.append(("box", 4.0, 5.2, cy - 0.32, cy + 0.32, 0.0, 2.8))
    mark("steles")
    # the side gates either side of the 望月楼, with a passage through
    for sy in (-1, 1):
        K.simple_hall_at(-55.0, sy * 9.0, 3 * PI2, 2.2, 2.6, 3.6, roof="ying", tone="g", ov=1.0, z0=0.3, pas=((-1.0, 1.0),), door_bays=0)
    # halls round the court (local eave rects; grey tiles)
    K.simple_hall((9.5, 18.8, -13.1, 11.5), "w", 4.6, roof="xie", ov=1.2, door_bays=3, Hk=0.55, z0=0.6, tone="g")          # 对厅
    K.simple_hall((20.3, 28.4, -8.2, 9.4), "w", 4.2, ov=1.0, door_bays=3, tone="g")
    K.simple_hall((-20.0, 2.5, 16.6, 23.6), "s", 4.2, ov=1.2, door_bays=1, tone="g")          # 北讲堂
    K.simple_hall((-13.8, 2.7, -26.7, -19.2), "n", 4.2, ov=1.2, door_bays=1, tone="g")        # 南讲堂
    mark("court_halls")
    K.simple_hall((-52.0, -33.5, 12.6, 22.5), "s", 4.0, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((-52.0, -43.5, -33.0, -16.5), "e", 3.8, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((-40.4, -19.1, -35.8, -26.5), "n", 3.8, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((-8.9, 17.8, -35.8, -28.0), "n", 3.8, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((31.2, 46.8, 10.0, 18.8), "s", 3.8, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((31.6, 47.0, -20.2, -11.2), "n", 3.8, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((23.7, 43.8, -44.9, -38.5), "n", 3.6, ov=1.0, door_bays=1, tone="g")
    K.simple_hall((50.1, 58.8, -44.9, 16.2), "w", 4.2, ov=1.0, door_bays=3, tone="g")
    mark("back_halls")
    stats["walls"] = K.walls([(WALL, True)], zt=3.4, th=0.6, key="brick", cop="gtex")
    mark("walls")
    for poly in (rect(-54.6, 12.0, -35.2, 26.6), rect(12.0, 49.8, -45.2, 23.7), rect(-59.5, -55.3, -12.0, 12.0)):
        K.paved(poly)
    return stats


def build():
    clear_file()
    ensure_addon()
    K.reset()
    K.HEADING, K.ANCHOR = HEADING, ANCHOR
    M = K.materials("NJ", glaze=GREEN, glaze_tex=GREEN_TEX, beam_glow=0.75)
    M["trim"] = material("NJ_GreenEdge", GREEN, 0.32, props={"wet": "surface", "glowStrength": 0.5})
    M["yel"] = material("NJ_Yellow", YELLOW, 0.32, props={"wet": "surface", "glowStrength": 0.5})
    M["ytex2"] = material("NJ_YellowRows", YELLOW, 0.35, tex=K.tile_tex("NJ_YellowRowsTex", YELLOW_TEX), props={"wet": "surface", "glowStrength": 0.5})
    tile = dict(K.TILE, trim=2.0, yel=2.0)
    main = collection("牛街礼拜寺")
    parts = collection("构件", main)
    stats = niujie()
    K.G.build("Mosque", collection("寺", main), M, tile)
    stats["tris"] = K.G.tris()
    stats.update(K.instances(parts, M, glaze=GREEN))
    K.FAR.build("Massing", collection("LOD1", main), M, tile)
    stats["far"] = K.FAR.tris()
    helpers = collection("碰撞体")
    stats.update(K.emit_colliders(helpers))
    # footprints: the precinct's west part out to the street, and its east part south of the north-east block
    flat_marker(helpers, "west", rect(-60.5, 13.0, -37.0, 28.6), "FOOTPRINT")
    flat_marker(helpers, "east", rect(13.0, 60.6, -46.8, 24.2), "FOOTPRINT")
    for i, poly in enumerate(K.CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(K.CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "niujiemosque", "牛街礼拜寺", "Niujie Mosque"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 350
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
