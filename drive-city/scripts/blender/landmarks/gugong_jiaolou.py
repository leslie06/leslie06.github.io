# 故宫角楼 the corner towers of the Forbidden City, built in Blender, marked with the bcity_landmark add-on's
# conventions. OSM has the four corner platforms (ways 156145604 西北, 156145763 西南, 156146468 东南, 156146621 东北:
# building=yes man_made=tower, ~29 m square) and the walls between them (drawn by the city); the city drew each platform
# as a plain block.
#
#   blender -b -P scripts/blender/landmarks/gugong_jiaolou.py -- [--out art/landmarks/gugongjiaolou.blend] [--export]
#   node scripts/landmarks/corners.mjs         (writes the other three corners' metas, sharing this glb)
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the platform's centre; modelled as the south-east
# tower (outer faces east and south: battlements there, a plain parapet on the inner faces), and turned by quarter turns
# for the other corners - the tower itself is symmetric. The platform: 28.5 m square, 10 m, grey brick. The tower:
# a cross of four 抱厦 wings on a marble base, red walls with lattice windows and doors, painted beams and brackets;
# each wing's single-eaved 歇山 in yellow glaze is built whole and cut to its quarter (|y| <= x for the east wing), so the
# four meet in valleys at the cross's inner corners; over the crossing a square upper storey under a 十字脊 - two 歇山
# roofs crossing, each cut to its two quarters, four gables - and the gilt 宝顶 where the ridges meet. ~26 m.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import QUAD, Geo, T, Rz, collider_box, cyl, ell, flat_marker, mesh_of, place  # noqa: E402
from hall import beast_geo, beasts_on, bracket_geo, bracket_spots, ring_beams, roofs, uvs  # noqa: E402
from zhengyangmen import TILE, make_materials  # noqa: E402
from jiaolou import clip  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "gugongjiaolou.blend")

P_HALF, P_H = 14.25, 10.0
Z0 = P_H + 0.9                            # the tower's floor: on a 0.9 m marble base
WH, REACH = 3.6, 8.4                      # a wing's half width, how far its end wall stands from the centre
YELLOW = "#c8912e"


def wing_spec():
    """The east wing, in a frame centred on its middle (x from 0 to REACH in the tower's frame)."""
    half = REACH / 2
    return SimpleNamespace(
        XS=[-half, -half + 0.01, half - 0.01, half], YS=[-WH, -WH + 0.01, WH - 0.01, WH], OX=half, OY=WH, IX=half - 0.01, IY=WH - 0.01,
        BEAM=(Z0 + 4.4, Z0 + 4.9, Z0 + 4.9, Z0 + 5.7), UBEAM=(Z0 + 4.4, Z0 + 4.9, Z0 + 4.9, Z0 + 5.7), OVERHANG=1.7, LOWER=None,
        UPPER=dict(A=half + 1.7, D=WH + 1.7, z=Z0 + 5.5, H=2.9, p=1.5, o=0.7, lift=0.7, Lc=3.4, Vc=2.2),
        GABLE_X=half - 0.5, PITCH=0.4, AMP=0.08, TRIM=0.0, RIDGE="tile", ROWS=8, END_ROWS=5, BRACKET_GAP=1.3, WEN=0.6)


def top_spec():
    """One of the two crossing 歇山 of the 十字脊, along x, over the upper storey (half WH)."""
    A = WH + 1.9
    return SimpleNamespace(
        XS=[-WH, -WH + 0.01, WH - 0.01, WH], YS=[-WH, -WH + 0.01, WH - 0.01, WH], OX=WH, OY=WH, IX=WH - 0.01, IY=WH - 0.01,
        BEAM=(Z0 + 8.9, Z0 + 9.4, Z0 + 9.4, Z0 + 10.2), UBEAM=(Z0 + 8.9, Z0 + 9.4, Z0 + 9.4, Z0 + 10.2), OVERHANG=1.9, LOWER=None,
        UPPER=dict(A=A, D=A, z=Z0 + 10.0, H=4.0, p=1.55, o=0.8, lift=0.8, Lc=3.8, Vc=2.6),
        GABLE_X=WH - 0.4, PITCH=0.4, AMP=0.08, TRIM=0.0, RIDGE="tile", ROWS=10, END_ROWS=6, BRACKET_GAP=1.3, WEN=0.7)


def quarter(k):
    """Half-planes (as keep functions) of the quarter round +x turned k quarter turns: |y'| <= x'."""
    c, s = math.cos(-k * math.pi / 2), math.sin(-k * math.pi / 2)
    local = lambda p: (p.x * c - p.y * s, p.x * s + p.y * c)          # noqa: E731
    return [lambda p: local(p)[0] - local(p)[1], lambda p: local(p)[0] + local(p)[1]]


def cut(g, keeps, drop=None):
    for i, k in enumerate(keeps):
        g = clip(g, k, drop_face=drop if i == 0 else None)
    return g


def wing_walls(g, h):
    """The wing's red walls with lattice windows, a door in the middle of its end, from the floor to the beams."""
    z0, z1 = Z0, h.BEAM[0]
    x_end = REACH
    # the end wall: three bays, the door in the middle
    bays = [-WH, -WH / 3, WH / 3, WH]
    for i in range(3):
        a, b = bays[i], bays[i + 1]
        g.polyn([(x_end, a, z0), (x_end, b, z0), (x_end, b, z1), (x_end, a, z1)], "atlas", (1, 0, 0), uvs=uvs("door" if i == 1 else "window", QUAD))
    # the side walls: bays of windows from the centre out
    n = 3
    for side in (-1, 1):
        for i in range(n):
            a, b = REACH * i / n, REACH * (i + 1) / n
            g.polyn([(a, side * WH, z0), (b, side * WH, z0), (b, side * WH, z1), (a, side * WH, z1)], "atlas", (0, side, 0), uvs=uvs("window", QUAD))


def cross_base(g, z0, z1, half, reach, key):
    """A cross-shaped solid (the tower's marble base), its arms `half` wide either side and `reach` from the centre."""
    pts = []
    for k in range(4):
        c, s = math.cos(k * math.pi / 2), math.sin(k * math.pi / 2)
        for lx, ly in ((half, -half), (reach, -half), (reach, half)):
            pts.append((lx * c - ly * s, lx * s + ly * c))
    g.polyn([(x, y, z1) for x, y in pts], key, (0, 0, 1))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        e = Vector((b[0] - a[0], b[1] - a[1], 0))
        n = Vector((e.y, -e.x, 0))
        if n.dot(Vector((mx, my, 0))) < 0:
            n = -n
        g.polyn([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key, tuple(n))


def build():
    clear_file()
    ensure_addon()
    M = make_materials("GJ")
    M["tile"] = material("GJ_Tile", YELLOW, 0.3, props={"wet": "surface", "glowStrength": 0.5})
    M["trim"] = M["tile"]
    M["cap"] = M["stone"]
    main = collection("故宫角楼")
    g = Geo()
    # the corner platform: grey brick, battlements on the outer faces (east, south), a plain parapet inside
    from observatory import battered, parapet
    t = battered(g, -P_HALF, P_HALF, -P_HALF, P_HALF, 0.0, P_H, "brick", "es", inset=0.5, base=0.8)
    g.polyn([(t["w"], t["s"], P_H), (t["e"], t["s"], P_H), (t["e"], t["n"], P_H), (t["w"], t["n"], P_H)], "paving", (0, 0, 1))
    parapet(g, (t["w"], t["s"]), (t["e"], t["s"]), (0, -1), True, z=P_H)
    parapet(g, (t["e"], t["s"]), (t["e"], t["n"]), (1, 0), True, z=P_H)
    parapet(g, (t["e"], t["n"]), (t["w"], t["n"]), (0, 1), False, z=P_H)
    parapet(g, (t["w"], t["n"]), (t["w"], t["s"]), (-1, 0), False, z=P_H)
    cross_base(g, P_H, Z0, WH + 1.0, REACH + 1.0, "marble")
    # the four wings, each cut to its quarter
    h = wing_spec()
    wg = Geo()
    wing_walls(wg, h)
    local = Geo()
    ring_beams(h, local, True, *h.BEAM)
    hips = roofs(h, local)
    wg.add(local, T(REACH / 2, 0, 0))
    hips = [[T(REACH / 2, 0, 0) @ p for p in line] for line in hips]
    all_hips = []
    for k in range(4):
        m = Rz(k * math.pi / 2)
        turned = Geo()
        turned.add(wg, m)
        keeps = quarter(k)
        g.add(cut(turned, keeps), Matrix.Identity(4))
        for line in hips:
            pts = [m @ p for p in line]
            if all(kk(p) > 0.3 for p in pts for kk in keeps):
                all_hips.append(pts)
    # the upper storey over the crossing, and the 十字脊: two 歇山 crossing, each kept on its two quarters
    ht = top_spec()
    up = Geo()
    up.box(-WH, WH, -WH, WH, h.BEAM[1], ht.BEAM[0], "plaster", skip=("-z", "+z"))
    for side in range(4):
        m = Rz(side * math.pi / 2)
        q = Geo()
        for i in range(2):
            a, b = -WH + WH * i, WH * i
            q.polyn([(WH + 0.02, a, ht.BEAM[0] - 2.6), (WH + 0.02, b, ht.BEAM[0] - 2.6), (WH + 0.02, b, ht.BEAM[0]), (WH + 0.02, a, ht.BEAM[0])], "atlas", (1, 0, 0), uvs=uvs("window", QUAD))
        up.add(q, m)
    ring_beams(ht, up, True, *ht.BEAM)
    g.add(up, Matrix.Identity(4))
    tg = Geo()
    thips = roofs(ht, tg)
    for k in range(2):
        m = Rz(k * math.pi / 2)
        turned = Geo()
        turned.add(tg, m)
        for q_ in (k, k + 2):
            keeps = quarter(q_)
            g.add(cut(turned, keeps), Matrix.Identity(4))
            for line in thips:
                pts = [m @ p for p in line]
                if all(kk(p) > 0.3 for p in pts for kk in keeps):
                    all_hips.append(pts)
    # the gilt 宝顶 on the crossing
    ztop = ht.UPPER["z"] + ht.UPPER["H"]
    cyl(g, 0, 0, ztop - 0.2, ztop + 0.45, 0.8, 0.62, 16, "tile", caps=(False, True))
    cyl(g, 0, 0, ztop + 0.45, ztop + 0.8, 0.45, 0.45, 16, "gold", caps=(False, True))
    ell(g, (0, 0, ztop + 1.5), (0.5, 0.5, 0.75), "gold", nu=14, nv=8)
    cyl(g, 0, 0, ztop + 2.1, ztop + 2.6, 0.12, 0.04, 8, "gold", caps=(False, True))
    g.build("CornerTower", collection("角楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE), beast=mesh_of(beast_geo(glaze=YELLOW, lite=True), "BeastMesh", M, TILE),
                immortal=mesh_of(beast_geo(True, glaze=YELLOW, lite=True), "ImmortalMesh", M, TILE))
    n = 0
    for k in range(4):
        m = Rz(k * math.pi / 2)
        keeps = quarter(k)
        for p, yaw in bracket_spots(h, True, h.BEAM[2]):
            q = m @ (T(REACH / 2, 0, 0) @ p)
            if all(kk(q) > 0.4 for kk in keeps):
                place(mesh["bracket"], f"Bracket.{n:03d}", parts, T(*q) @ Rz(yaw + k * math.pi / 2))
                n += 1
    for p, yaw in bracket_spots(ht, True, ht.BEAM[2]):
        place(mesh["bracket"], f"Bracket.{n:03d}", parts, T(*p) @ Rz(yaw))
        n += 1
    for i, line in enumerate(all_hips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=4)

    far = Geo()
    far.box(-P_HALF, P_HALF, -P_HALF, P_HALF, 0.0, P_H + 1.2, "brick", skip=("-z",))
    for k in range(2):
        m = Rz(k * math.pi / 2)
        fw = Geo()
        fw.box(-REACH, REACH, -WH, WH, P_H, h.BEAM[3], "plaster", skip=("-z",))
        far.add(fw, m)
        fr = Geo()
        roofs(SimpleNamespace(**dict(vars(h), OX=REACH, IX=REACH - 0.01, XS=[-REACH, -REACH + 0.01, REACH - 0.01, REACH],
                                     UPPER=dict(h.UPPER, A=REACH + 1.7), GABLE_X=REACH - 0.5)), fr, lod=True)
        far.add(fr, m)
    far.box(-WH, WH, -WH, WH, h.BEAM[3], ht.BEAM[3], "plaster", skip=("-z",))
    ftop = Geo()
    roofs(ht, ftop, lod=True)
    far.add(ftop, Matrix.Identity(4))
    far.add(ftop, Rz(math.pi / 2))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    collider_box(helpers, "platform", -P_HALF, P_HALF, -P_HALF, P_HALF, 0.0, P_H)
    collider_box(helpers, "towerX", -REACH, REACH, -WH, WH, P_H, ztop)
    collider_box(helpers, "towerY", -WH, WH, -REACH, REACH, P_H, ztop)
    flat_marker(helpers, "platform", [(-P_HALF - 0.3, -P_HALF - 0.3), (P_HALF + 0.3, -P_HALF - 0.3), (P_HALF + 0.3, P_HALF + 0.3), (-P_HALF - 0.3, P_HALF + 0.3)], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "gugongjiaolou", "故宫东南角楼", "Forbidden City Southeast Corner Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -199.85, -425.35, -1.7
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, brackets=n, hips=len(all_hips))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
