# 北京城东南角楼 the south-east corner tower of the Ming inner city, built in Blender, marked with the
# bcity_landmark add-on's conventions. OSM has its outline (way 488647832) and nothing else, so the city drew an
# L-shaped block of flats there.
#
#   blender -b -P scripts/blender/landmarks/jiaolou.py -- [--out art/landmarks/jiaolou.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (2692.5, 966.6), heading -2.0. The plan is
# OSM's L squared in that frame: the corner platform (城台, 12 m, battered grey brick, battlements on its outer
# faces, a plain parapet on its inner ones) with an east arm (x 2.5..14.93, y -16.3..14.5) and a south arm
# (x -16.75..14.93, y -16.3..-3.9); on it the tower, 箭楼-like: two wings of grey brick with rows of arrow windows
# in white frames, a skirt roof, a brick upper storey and a 歇山 roof each, in grey tiles edged with green glaze.
# Each wing is built whole and then cut along the corner's diagonal (x + y = DIAG), so the two meet in a mitre:
# their roofs join in a hip at the outer corner and a valley at the inner one, their ridges at the corner's centre.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, save_and_export  # noqa: E402
from kit import Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, place  # noqa: E402
from hall import beasts_on, bracket_spots, ring_beams, roof_z, roofs, sweep  # noqa: E402
from zhengyangmen import TILE, arrow_window, hall_parts, make_materials  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "jiaolou.blend")

H_PLAT = 12.0
BATTER = 1.0
ARM_E = dict(x0=2.5, x1=14.93, y0=-3.9, y1=14.5)       # north of the south arm, which takes the corner square
ARM_S = dict(x0=-16.75, x1=14.93, y0=-16.3, y1=-3.9)
# the tower's wings: 8.8 m deep, standing 1.8 m in from the platform's outer faces
WD = 4.4
EX, SY = 8.7, -10.1                       # the east wing's centre line (x), the south wing's (y)
DIAG = EX + SY                            # the corner's diagonal: x + y = DIAG through the corner square's centre
YE1, XS0 = 12.5, -14.8                    # the wings' far ends: the east wing's north end, the south wing's west end
Z0 = H_PLAT
WING = SimpleNamespace(
    OX=0.0, OY=WD, IX=0.0, IY=WD - 1.3,   # OX / IX are set per wing
    BEAM=(Z0 + 8.6, Z0 + 9.2, Z0 + 9.2, Z0 + 10.0), UBEAM=(Z0 + 13.4, Z0 + 13.9, Z0 + 13.9, Z0 + 14.7), OVERHANG=2.2,
    LOWER=dict(A=0.0, D=WD + 2.4, z=Z0 + 9.8, H=2.0, p=1.2, o=0.7, lift=0.6, Lc=5.0, Vc=2.6),
    UPPER=dict(A=0.0, D=WD + 1.1, z=Z0 + 14.4, H=3.4, p=1.6, o=0.8, lift=0.8, Lc=5.5, Vc=3.2),
    GABLE_X=0.0, PITCH=0.42, AMP=0.09, TRIM=1.2, RIDGE="trim", ROWS=9, END_ROWS=5, LOWER_ROWS=5, BRACKET_GAP=1.6)
WIN_ROWS = [(Z0 + 2.4, False), (Z0 + 5.0, False), (Z0 + 7.6, False)]
WIN_UPPER = Z0 + 12.0


def wing_spec(half):
    """The spec of a wing `half` metres half-long (both wings share the depth and heights)."""
    h = SimpleNamespace(**vars(WING))
    h.OX, h.IX = half, half - 1.3
    h.XS, h.YS = [-half, -h.IX, h.IX, half], [-WD, -h.IY, h.IY, WD]       # the outer and inner rings' lines
    h.LOWER = dict(WING.LOWER, A=half + 2.4)
    h.UPPER = dict(WING.UPPER, A=h.IX + 1.1 + 0.0)
    h.GABLE_X = h.IX - 0.6
    return h


# ---- clipping a Geo by a half-plane ---------------------------------------------------------------------------

def clip(src, keep, drop_face=None):
    """A copy of Geo `src` with every face cut to where keep(p) >= 0 (keep is linear in p); faces for which
    drop_face(points, key) is true are left out."""
    out = Geo(colors=src.colors)
    for idx, uvs_, key, smooth in src.f:
        pts = [Vector(src.v[i]) for i in idx]
        if drop_face and drop_face(pts, key):
            continue
        uv = list(uvs_) if uvs_ else None
        res_p, res_uv = [], []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            da, db = keep(a), keep(b)
            if da >= 0:
                res_p.append(a)
                if uv:
                    res_uv.append(uv[i])
            if (da >= 0) != (db >= 0):
                t = da / (da - db)
                res_p.append(a.lerp(b, t))
                if uv:
                    ua, ub = uv[i], uv[(i + 1) % n]
                    res_uv.append((ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t))
        if len(res_p) >= 3:
            out.face([out.vert(p) for p in res_p], key, res_uv if uv else None, smooth)
    return out


def wing(half, m, keep, axis):
    """One wing in its own frame (along x), moved by m and cut to keep(p) >= 0 in the world; returns (geo, hips).
    `axis` is the wing's length in the world, for finding the gable at its corner end."""
    h = wing_spec(half)
    g = Geo()
    z0 = Z0
    g.box(-h.OX, h.OX, -h.OY, h.OY, z0, h.BEAM[0], "brick", skip=("-z", "+z"))
    g.box(-h.OX - 0.25, h.OX + 0.25, -h.OY - 0.25, h.OY + 0.25, z0, z0 + 0.8, "brick", skip=("-z",))
    ring_beams(h, g, True, *h.BEAM)
    zu = h.LOWER["z"] + h.LOWER["H"] - 0.4
    g.box(-h.IX, h.IX, -h.IY, h.IY, zu, h.UBEAM[0], "brick", skip=("-z", "+z"))
    ring_beams(h, g, False, *h.UBEAM)
    hips = roofs(h, g)
    world = Geo()
    world.add(g, m)
    # the gable, its barge boards and the end beams at the corner end would stand inside the other wing: drop them
    def gable(pts, key):
        if key not in ("atlas", "red") or min(keep(p) for p in pts) >= 0:
            return False
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        return n.length > 1e-9 and abs(n.normalized().dot(axis)) > 0.9
    cut = clip(world, keep, drop_face=gable)
    hips = [[m @ p for p in line] for line in hips]
    hips = [line for line in hips if all(keep(p) > 0.5 for p in line)]
    return cut, hips, h


def platform(g):
    """The L-shaped corner platform: two blocks battered on their outer faces, battlements outside, a plain
    parapet on the inner faces."""
    from observatory import battered, parapet
    h = H_PLAT
    te = battered(g, ARM_E["x0"], ARM_E["x1"], ARM_E["y0"], ARM_E["y1"], 0.0, h, "brick", "en", inset=BATTER)
    ts = battered(g, ARM_S["x0"], ARM_S["x1"], ARM_S["y0"], ARM_S["y1"], 0.0, h, "brick", "swe", inset=BATTER)
    for t in (te, ts):
        g.polyn([(t["w"], t["s"], h), (t["e"], t["s"], h), (t["e"], t["n"], h), (t["w"], t["n"], h)], "paving", (0, 0, 1))
    parapet(g, (ts["w"], ts["s"]), (ts["e"], ts["s"]), (0, -1), True, z=h)
    parapet(g, (ts["e"], ts["s"]), (te["e"], te["n"]), (1, 0), True, z=h)
    parapet(g, (te["e"], te["n"]), (te["w"], te["n"]), (0, 1), True, z=h)
    parapet(g, (ts["w"], ts["n"]), (ts["w"], ts["s"]), (-1, 0), True, z=h)
    parapet(g, (te["w"], te["n"]), (te["w"], ts["n"]), (-1, 0), False, z=h)
    parapet(g, (te["w"], ts["n"]), (ts["w"], ts["n"]), (0, 1), False, z=h)
    return te, ts


def build():
    clear_file()
    ensure_addon()
    M = make_materials("JLJ")
    M["cap"] = M["stone"]           # the parapets' copings (observatory.parapet)
    main = collection("东南角楼")
    g = Geo()
    te, ts = platform(g)
    # the wings: the east one along y (its frame turned a quarter), the south one along x
    # each runs from its far end to the other wing's outer face, through the corner square
    e_half, e_mid = (YE1 - (SY - WD)) / 2, (YE1 + SY - WD) / 2
    s_half, s_mid = ((EX + WD) - XS0) / 2, (XS0 + EX + WD) / 2
    me = T(EX, e_mid, 0) @ Rz(math.pi / 2)
    ms = T(s_mid, SY, 0)
    keep_e = lambda p: (p.x + p.y) - DIAG          # noqa: E731
    keep_s = lambda p: DIAG - (p.x + p.y)          # noqa: E731
    ge, hips_e, he = wing(e_half, me, keep_e, Vector((0, 1, 0)))
    gs, hips_s, hs = wing(s_half, ms, keep_s, Vector((1, 0, 0)))
    g.add(ge, Matrix.Identity(4))
    g.add(gs, Matrix.Identity(4))
    # the hips where the wings meet: from the corner's centre down to the outer corner, a valley to the inner one
    hips_corner = []
    for R, D, zc in ((he.UPPER, he.UPPER["D"], None), (he.LOWER, he.LOWER["D"], None)):
        line = []
        for i in range(9):
            s_ = D * i / 8
            if R is he.LOWER and s_ < he.IY + 0.4:
                continue
            v = D - s_
            line.append(Vector((EX + s_, SY - s_, roof_z(R, D - (he.IY if R is he.LOWER else 0.0), v - (0.0 if R is he.UPPER else 0.0)) + 0.05)))
        if len(line) > 1:
            sweep(g, line, 0.55, 0.45, key="trim")
            hips_corner.append(line)
    g.build("CornerTower", collection("角楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = hall_parts(M)
    k = 0
    for h, m, keep in ((he, me, keep_e), (hs, ms, keep_s)):
        for i, (p, yaw) in enumerate(bracket_spots(h, True, h.BEAM[2]) + bracket_spots(h, False, h.UBEAM[2])):
            q = m @ p
            if keep(q) > 0.6:
                place(mesh["bracket"], f"Bracket.{k:03d}", parts, T(*q) @ Rz(yaw + (math.pi / 2 if m is me else 0.0)))
                k += 1
    for i, line in enumerate(hips_e + hips_s + hips_corner[:1]):
        beasts_on(line, parts, mesh, f"Beast{i}", n=5)
    # the arrow windows: four rows on the outer faces and the wings' far ends, two on the inner faces
    win = mesh_of(arrow_window(False), "Window", M, TILE)
    n = 0

    def row_along(a, b, z, out, step=3.0):
        nonlocal n
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        cnt = max(1, int(L // step))
        yaw = math.atan2(out[1], out[0]) - math.pi / 2 + math.pi
        for i in range(cnt):
            p = a.lerp(b, (i + 0.5) / cnt)
            place(win, f"Win.{n:03d}", parts, T(p.x + out[0] * 0.02, p.y + out[1] * 0.02, z) @ Rz(yaw))
            n += 1

    oe, ie = EX + WD, EX - WD                 # the east wing's outer (east) and inner (west) faces
    os_, is_ = SY - WD, SY + WD                # the south wing's outer (south) and inner (north) faces
    ye1, xs0 = YE1, XS0
    for z, _ in WIN_ROWS:
        row_along((oe, os_ + 1.2, 0), (oe, ye1 - 1.2, 0), z, (1, 0))
        row_along((xs0 + 1.2, os_, 0), (oe - 1.2, os_, 0), z, (0, -1))
        row_along((EX - WD + 1.0, ye1, 0), (EX + WD - 1.0, ye1, 0), z, (0, 1), step=2.6)
        row_along((xs0, SY - WD + 1.0, 0), (xs0, SY + WD - 1.0, 0), z, (-1, 0), step=2.6)
    for z in (WIN_ROWS[1][0], WIN_ROWS[2][0]):
        row_along((ie, is_ + 1.2, 0), (ie, ye1 - 1.2, 0), z, (-1, 0))
        row_along((xs0 + 1.2, is_, 0), (ie - 1.2, is_, 0), z, (0, 1))
    iy = he.IY
    row_along((EX + iy, SY - iy + 1.0, 0), (EX + iy, ye1 - 1.3 - 1.0, 0), WIN_UPPER, (1, 0), step=3.2)
    row_along((xs0 + 1.3 + 1.0, SY - iy, 0), (EX + iy - 1.0, SY - iy, 0), WIN_UPPER, (0, -1), step=3.2)

    # far level: the platform, the wings as blocks, their roofs as smooth faces
    far = Geo()
    for A in (ARM_E, ARM_S):
        far.box(A["x0"], A["x1"], A["y0"], A["y1"], 0.0, H_PLAT + 1.0, "brick", skip=("-z",))
    for h, m, keep in ((he, me, keep_e), (hs, ms, keep_s)):
        fg = Geo()
        fg.box(-h.OX, h.OX, -h.OY, h.OY, Z0, h.LOWER["z"] + 0.3, "brick", skip=("-z",))
        fg.box(-h.IX, h.IX, -h.IY, h.IY, h.LOWER["z"], h.UPPER["z"] + 0.5, "brick", skip=("-z",))
        roofs(h, fg, lod=True)
        w_ = Geo()
        w_.add(fg, m)
        far.add(clip(w_, keep), Matrix.Identity(4))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    for A in (ARM_E, ARM_S):
        collider_box(helpers, "platform", A["x0"], A["x1"], A["y0"], A["y1"], 0.0, H_PLAT)
    collider_box(helpers, "wingE", EX - WD, EX + WD, SY - WD, ye1, H_PLAT, WING.UPPER["z"] + 3.0)
    collider_box(helpers, "wingS", xs0, EX + WD, SY - WD, SY + WD, H_PLAT, WING.UPPER["z"] + 3.0)
    # one footprint over the L (its hull takes the inner corner too: nothing else stands there), so OSM's L goes
    flat_marker(helpers, "tower", [(ARM_S["x0"], ARM_S["y0"]), (ARM_S["x1"], ARM_S["y0"]), (ARM_E["x1"], ARM_E["y1"]),
                                   (ARM_E["x0"], ARM_E["y1"]), (ARM_E["x0"], ARM_S["y1"]), (ARM_S["x0"], ARM_S["y1"])], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "jiaolou", "北京城东南角楼", "Southeast Corner Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 2692.5, 966.6, -2.0
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, brackets=k, windows=n)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
