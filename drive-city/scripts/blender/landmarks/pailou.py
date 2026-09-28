# 正阳桥五牌楼 the five-bay memorial archway on 前门大街 south of 箭楼, built in Blender, marked with the bcity_landmark
# add-on's conventions. OSM has its outline (way 824117437, man_made=ceremonial_gate) and the city drew nothing.
#
#   blender -b -P scripts/blender/landmarks/pailou.py -- [--out art/landmarks/pailou.blend] [--export]
#
# Frame: Blender +X east along the archway, +Y north, metres, origin on the ground at the centre of the middle bay,
# game (-493.2, 1352.6), heading -1.8. 六柱五间五楼: six red columns in stone clamps (夹杆石) braced front and back by
# raking posts (戗柱), the bays 5.2 / 8.2 / 9.2 / 8.2 / 5.2 m (OSM's outline); over each bay painted beams (额枋) with a
# frieze panel between, a row of bracket sets and a small 庑殿 roof in grey tiles, the middle one highest; in the
# middle bay the blue board with 正陽橋 in gilt, read right to left.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, save_and_export  # noqa: E402
from kit import QUAD, Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, place  # noqa: E402
from hall import bracket_geo, column_geo, roofs, uvs  # noqa: E402
from zhengyangmen import TILE, make_materials  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "pailou.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

COLS = [-17.3, -12.1, -4.6, 4.6, 12.1, 17.3]            # the columns' x (bays 5.2, 7.5, 9.2, 7.5, 5.2)
# each bay: (x0, x1, beam bottom, roof eave height); the middle bay highest
BAYS = [(-17.3, -12.1, 5.2, 6.9), (-12.1, -4.6, 6.0, 7.8), (-4.6, 4.6, 6.9, 8.9), (4.6, 12.1, 6.0, 7.8), (12.1, 17.3, 5.2, 6.9)]
COL_R = 0.34


def bay_spec(x0, x1, zb, ze, main):
    """A bay's 楼: a one-bay 庑殿 roof on a bracket band over the beams."""
    half = (x1 - x0) / 2 + 0.3
    D = 0.55
    h = SimpleNamespace(
        XS=[-half, -half + 0.01, half - 0.01, half], YS=[-D, -D + 0.01, D - 0.01, D], OX=half, OY=D, IX=half - 0.01, IY=D - 0.01,
        BEAM=(zb, zb + 0.5, zb + 0.5, ze - 0.2), UBEAM=(zb, zb + 0.5, zb + 0.5, ze - 0.2), OVERHANG=1.2, LOWER=None,
        UPPER=dict(A=half + 1.1, D=D + 1.25, z=ze, H=2.3 if main else 1.9, p=1.5, o=0.45, lift=0.5, Lc=2.4, Vc=1.3),
        GABLE_X=half, PITCH=0.4, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=6, END_ROWS=4, BRACKET_GAP=0.9, WEN=0.42)
    return h


def plaque_text(g_coll, M, text, x, y, z, w, hgt, face, name):
    """Gilt characters on a board, reading along the board (right to left seen from the front)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, bpy.data.fonts.load(FONT, check_existing=True), 1.0, 0.04
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.15
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min((hgt - 0.3) / (max(ys) - min(ys)), (w - 0.5) / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    # the glyphs' XY plane stood upright facing `face` (-1 south, +1 north)
    m = T(x, y + face * 0.07, z) @ Rz(0.0 if face < 0 else math.pi) @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, v.co.z))
    me.materials.append(M["gold"])
    o = bpy.data.objects.new(name, me)
    g_coll.objects.link(o)


def build():
    clear_file()
    ensure_addon()
    M = make_materials("PL")
    main = collection("五牌楼")
    g = Geo()
    hips_all = []
    for i, (x0, x1, zb, ze) in enumerate(BAYS):
        mid = i == 2
        h = bay_spec(x0, x1, zb, ze, mid)
        bg = Geo()
        L = x1 - x0 - 2 * COL_R
        # beams: the big 额枋, the frieze panel (花板), the small 额枋, all painted; the board in the middle bay
        for za, zc, reg in ((zb - 0.55, zb, "beam"), (zb - 1.05, zb - 0.55, "plank"), (zb - 1.5, zb - 1.05, "beam")):
            for side in (-1, 1):
                bg.polyn([(-L / 2, side * 0.28, za), (L / 2, side * 0.28, za), (L / 2, side * 0.28, zc), (-L / 2, side * 0.28, zc)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
            bg.polyn([(-L / 2, -0.28, za), (L / 2, -0.28, za), (L / 2, 0.28, za), (-L / 2, 0.28, za)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
        # the bracket band's panel wall, and the plank over the beams
        bg.box(-L / 2 - COL_R, L / 2 + COL_R, -0.22, 0.22, zb, zb + 0.5, "plaster")
        bg.box(-L / 2 - COL_R - 0.1, L / 2 + COL_R + 0.1, -0.35, 0.35, zb + 0.5, zb + 0.62, "red")
        hips = roofs(h, bg)
        if mid:
            # the board: blue in a gilt frame between the beams, facing both ways
            bw, bh, bz = 3.4, 1.25, zb - 2.2
            for side in (-1, 1):
                bg.polyn([(-bw / 2, side * 0.3, bz - bh / 2), (bw / 2, side * 0.3, bz - bh / 2), (bw / 2, side * 0.3, bz + bh / 2), (-bw / 2, side * 0.3, bz + bh / 2)], "board", (0, side, 0))
            bg.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.33, 0.33, bz + bh / 2, bz + bh / 2 + 0.12, "gold")
            bg.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.33, 0.33, bz - bh / 2 - 0.12, bz - bh / 2, "gold")
            for sx in (-1, 1):
                bg.box(sx * bw / 2 - (0.12 if sx < 0 else 0), sx * bw / 2 + (0.12 if sx > 0 else 0), -0.33, 0.33, bz - bh / 2, bz + bh / 2, "gold")
            bg.box(-bw / 2, bw / 2, -0.3, 0.3, bz + bh / 2 + 0.12, zb - 1.5, "plaster")
        m = T((x0 + x1) / 2, 0, 0)
        g.add(bg, m)
        hips_all += [[m @ p for p in line] for line in hips]
    # the columns' stone clamps and the raking posts front and back
    for x in COLS:
        g.box(x - 0.55, x + 0.55, -0.55, 0.55, 0.0, 1.9, "stone", skip=("-z",))
        g.box(x - 0.62, x + 0.62, -0.62, 0.62, 1.9, 2.05, "stone", skip=("-z",))
        for side in (-1, 1):
            a, b = Vector((x, side * 0.2, 4.4)), Vector((x, side * 2.6, 0.0))
            d = (b - a).normalized()
            u = Vector((1, 0, 0))
            v = d.cross(u).normalized()
            r = 0.14
            ring = lambda c: [c + (u * math.cos(2 * math.pi * k / 6) + v * math.sin(2 * math.pi * k / 6)) * r for k in range(6)]   # noqa: E731
            A, B = ring(a), ring(b)
            for k in range(6):
                j = (k + 1) % 6
                g.poly([A[k], A[j], B[j], B[k]], "red", smooth=True)
            g.box(x - 0.3, x + 0.3, side * 2.6 - 0.3, side * 2.6 + 0.3, 0.0, 0.35, "stone", skip=("-z",))
    g.build("Archway", collection("牌楼", main), M, TILE)
    tris = g.tris()
    # the plaque's lettering, the columns and brackets as linked meshes
    parts = collection("构件", main)
    zb = BAYS[2][2]
    for side in (-1, 1):
        # 正陽橋 in the old characters, read right to left: the string runs left to right on the board
        plaque_text(parts, M, "橋陽正", 0.0, side * 0.3, zb - 2.2, 3.4, 1.25, side, f"Plaque{side:+d}")
    mesh = dict(bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE))
    k = 0
    for i, x in enumerate(COLS):
        zt = max(zb_ for x0, x1, zb_, ze in BAYS if x0 - 0.01 <= x <= x1 + 0.01)
        col = mesh_of(column_geo(zt + 0.5 - 2.05, r=COL_R), f"Column{i}", M, TILE)
        place(col, f"Column.{i}", parts, T(x, 0, 2.05))
    for x0, x1, zb_, ze in BAYS:
        n = max(2, round((x1 - x0) / 0.9))
        for j in range(n + 1):
            x = x0 + (x1 - x0) * j / n
            for side, yaw in ((-1, 0.0), (1, math.pi)):
                place(mesh["bracket"], f"Bracket.{k:03d}", parts, T(x, side * 0.25, zb_ + 0.5) @ Rz(yaw) @ Matrix.Diagonal((0.7, 0.7, 0.7, 1.0)))
                k += 1

    far = Geo()
    for x in COLS:
        far.box(x - 0.4, x + 0.4, -0.4, 0.4, 0.0, max(zb_ for x0, x1, zb_, ze in BAYS if x0 - 0.01 <= x <= x1 + 0.01), "red", skip=("-z",))
    for x0, x1, zb_, ze in BAYS:
        fb = Geo()
        fb.box(-(x1 - x0) / 2, (x1 - x0) / 2, -0.3, 0.3, zb_ - 1.5, zb_ + 0.5, "atlas", uvs={k_: uvs("beam", QUAD) for k_ in ("-y", "+y")})
        roofs(bay_spec(x0, x1, zb_, ze, x0 < 0 < x1), fb, lod=True)
        far.add(fb, T((x0 + x1) / 2, 0, 0))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    for x in COLS:
        collider_box(helpers, "clamp", x - 0.55, x + 0.55, -0.55, 0.55, 0.0, 9.0)
        for side in (-1, 1):
            collider_pts(helpers, "brace", [(x - 0.15, side * 0.3, 4.4), (x + 0.15, side * 0.3, 4.4), (x - 0.15, side * 2.6, 0.0), (x + 0.15, side * 2.6, 0.0),
                                            (x - 0.15, side * 0.3, 0.0), (x + 0.15, side * 0.3, 0.0)])
    for x in COLS:
        flat_marker(helpers, "post", [(x - 0.8, -2.9), (x + 0.8, -2.9), (x + 0.8, 2.9), (x - 0.8, 2.9)], "CLEAR")
    flat_marker(helpers, "archway", [(-18.5, -1.2), (18.5, -1.2), (18.5, 1.2), (-18.5, 1.2)], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "pailou", "正阳桥五牌楼", "Zhengyangqiao Archway"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -493.2, 1352.6, -1.8
    s.far_distance = 400
    s.repo_path = REPO
    return dict(tris=tris, brackets=k, hips=len(hips_all))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
