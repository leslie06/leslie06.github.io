# 永定门, the south gate of the outer city on the central axis (rebuilt 2004-05 on the old site), and 燕墩,
# the square brick altar with the Qianlong stele 430 m south of it. Built with the timber hall of hall.py (roofs,
# brackets, beams, beasts; imported, not edited) and the gate platform of zhengyangmen.py, marked with the
# bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/yongdingmen.py -- [--export] [--only gate|yandun]
#
# Two files, each its own landmark: art/landmarks/yongdingmen.blend (id yongdingmen) and
# art/landmarks/yandun.blend (id yandun). The plaque needs Noto Serif SC Bold in .cache/fonts/.
#
# Frame: Blender +X east, +Y north, metres. 永定门's origin is the centre of the platform in OSM way 228041535
# (a cross: the platform 29.6 x 18.6 m and two wall stubs 17 x 10 m set back from both faces), game
# (-380.1, 4204.3), heading -2.3 (the outline's edges); 燕墩's is the centre of way 464738356, game
# (-414.0, 4630.4), heading 0.4.
#
# The figures (published for the 2005 rebuilding: platform 31.41 x 16.96 m, 8 m high; the tower 面阔连廊七间
# 24 m, 进深三间 10.8 m, 26.04 m to the ridge; 灰筒瓦绿剪边, 重檐歇山三滴水; one gateway ~5.2 m; 燕墩: 14.87 m
# square at the foot, 13.9 m at the top, 9 m high, an ~8 m square stele on a stone altar), the rest from photographs:
#   - the platform: grey brick over a white stone base course, battered, one vaulted gateway (the doors folded
#     back inside: it is walkable, and drivable though no road runs through), battlements to the south, a low
#     parapet to the north; either side a lower stub of the outer city wall, cut off square;
#   - the tower in three eaves: a ground storey of red columns round grey brick walls with a red door front and
#     back, its eave; the gallery (平坐) on a painted band with a red railing, the upper storey's red lattice
#     behind a row of columns, its eave; a short clerestory with the 永定門 plaque and the 歇山 over it;
#   - two white stone lions on pedestals before the north face.
#
# The tower is drawn at 1/S of its size with hall.py's figures (which are 正阳门's, 1.5 times larger) and
# scaled down by S, so its brackets, ridges, tiles and ridge dragons keep their proportions to the building.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import QUAD, Geo, T, Rz, collider_box, cyl, ell, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, eave_edge, paint_atlas,  # noqa: E402
                  plaster, ring_beams, ring_sides, roof_face, roofs, soffit, sweep, to_world, uvs)
from zhengyangmen import battlements, brick_image, ceiling, gate_platform  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
GREEN = "#2e7d57"
TILE = dict(floor=4.0, plaster=4.0, brick=4.0, stone=2.0, paving=4.0, tile=2.0, trim=2.0, marble=2.0, red=2.0, gold=1.0, paint=1.0, dark=1.0,
            board=1.0, atlas=1.0)

# --- 永定门 (real metres) ------------------------------------------------------------------------------------
GP = dict(hw=15.4, hd=9.0, h=8.0, batter=0.45, arch=(5.2, 5.9), base=1.0)
WING = dict(x0=14.9, x1=31.8, y0=-6.3, y1=4.2, h=5.2)          # the wall stubs east and west (mirrored)
Z0 = 8.45                                                      # the tower's stone base on the platform
S = 0.65                                                       # the tower's detail scale (see the header)
ZF = 14.6                                                      # the gallery floor
# the ground storey: 24 x 10.8 m on its eave columns, the brick walls on the inner ring
LOW = dict(XS=[-12.0, -9.6, -6.3, -3.0, 3.0, 6.3, 9.6, 12.0], YS=[-5.4, -3.0, 3.0, 5.4], OX=12.0, OY=5.4, IX=9.6, IY=3.0,
           BEAM=(11.9, 12.3, 12.42, 13.0))
# its eave, from the eave up to the gallery's edge (run `top`)
EAVE1 = dict(z=12.45, H=1.4, p=1.3, o=0.55, lift=0.45, Lc=3.5, Vc=1.8, A=14.3, D=7.7, top=2.35, span=2.3)
GX, GY = EAVE1["A"] - EAVE1["top"], EAVE1["D"] - EAVE1["top"]            # the gallery's edge (11.95, 5.35)
# the upper storey (spec for hall.roofs): the gallery columns outside, the lattice walls on the inner ring
UP = dict(XS=[-11.4, -9.6, -6.3, -3.0, 3.0, 6.3, 9.6, 11.4], YS=[-4.8, -3.0, 3.0, 4.8], OX=11.4, OY=4.8, IX=9.6, IY=3.0,
          BEAM=(17.9, 18.3, 18.42, 19.0), UBEAM=(20.3, 20.7, 20.82, 21.4), OVERHANG=1.5,
          LOWER=dict(A=12.9, D=6.3, z=18.45, H=1.6, p=1.3, o=0.5, lift=0.45, Lc=3.5, Vc=2.2),
          UPPER=dict(A=11.1, D=4.5, z=20.85, H=3.5, p=1.6, o=0.6, lift=0.6, Lc=4.0, Vc=2.8),
          XP=9.1, PITCH=0.33, AMP=0.06, TRIM=0.6)
LIONS = [(-8.6, 12.4), (8.6, 12.4)]


def big(v):
    """Real metres to the tower's drawing units (1/S)."""
    if isinstance(v, (list, tuple)):
        return type(v)(big(x) for x in v)
    if isinstance(v, dict):
        return {k: (x if k == "p" else big(x)) for k, x in v.items()}
    return v / S


def spec(d):
    ns = SimpleNamespace(**{k: big(v) for k, v in d.items() if k not in ("XP",)})
    if "XP" in d:
        ns.GABLE_X = big(d["XP"]) - 0.8          # hall.roofs puts the front slope's end 0.8 past the gable
    ns.RIDGE, ns.ROWS, ns.END_ROWS, ns.LOWER_ROWS, ns.BRACKET_GAP = "tile", 10, 4, 5, 1.35     # grey ridges (photographs)
    return ns


def make_materials(prefix):
    atlas, night = paint_atlas(prefix, portrait=False, emblem=False)
    return dict(
        atlas=material(f"{prefix}_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material(f"{prefix}_Plaster", "#a8321f", 0.85, tex=plaster(name=f"{prefix}_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        brick=material(f"{prefix}_Brick", "#7b7e80", 0.9, tex=brick_image(f"{prefix}_BrickTex"), props={"wet": "damp", "glowStrength": 0.8}),
        stone=material(f"{prefix}_Stone", "#d6d2c8", 0.7, props={"wet": "damp", "glowStrength": 0.6}),
        paving=material(f"{prefix}_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
        tile=material(f"{prefix}_Tile", "#5d6164", 0.6, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material(f"{prefix}_Trim", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.6}),
        marble=material(f"{prefix}_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        red=material(f"{prefix}_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material(f"{prefix}_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material(f"{prefix}_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material(f"{prefix}_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
        board=material(f"{prefix}_Board", "#1d3f7a", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
        # the gateway's floor: ground level, so it takes a layer over the city's ground (see flowerbasket)
        floor=material(f"{prefix}_Floor", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
    )


def plaque(g, font, text, x, y, z, M, coll, name, face=-1, w=1.1, h=1.6):
    """The name board: blue, a gilt frame, gilt characters reading down. `face` -1 south, +1 north."""
    f = face
    g.polyn([(x - w / 2, y, z - h / 2), (x + w / 2, y, z - h / 2), (x + w / 2, y, z + h / 2), (x - w / 2, y, z + h / 2)], "board", (0, f, 0))
    ya, yb = sorted((y + f * 0.06, y - f * 0.08))
    t = 0.1
    for za, zb in ((z - h / 2 - t, z - h / 2), (z + h / 2, z + h / 2 + t)):
        g.box(x - w / 2 - t, x + w / 2 + t, ya, yb, za, zb, "gold")
    for sx in (-1, 1):
        g.box(x + sx * (w / 2) - t * (sx < 0), x + sx * (w / 2) + t * (sx > 0), ya, yb, z - h / 2, z + h / 2, "gold")
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = "\n".join(text), font, 1.0, 0.04
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_line = 0.82
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min((h - 0.3) / (max(ys) - min(ys)), (w - 0.25) / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    m = T(x, y + f * 0.07, z) @ Matrix.Rotation(0.0 if f < 0 else math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, v.co.z))
    me.materials.append(M["gold"])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)


def rail_parts(M):
    """A timber railing: square posts and a panel of rails and balusters (one metre along +X, scaled to fit)."""
    p = Geo()
    p.box(-0.07, 0.07, -0.07, 0.07, 0.0, 1.05, "red")
    q = Geo()
    q.box(0.0, 1.0, -0.05, 0.05, 0.86, 0.95, "red")
    q.box(0.0, 1.0, -0.04, 0.04, 0.08, 0.15, "red")
    for i in range(4):
        x = 0.125 + i * 0.25
        q.box(x - 0.022, x + 0.022, -0.022, 0.022, 0.15, 0.86, "red", skip=("-z", "+z"))
    return dict(post=mesh_of(p, "RailPostMesh", M, TILE), panel=mesh_of(q, "RailPanelMesh", M, TILE))


def rail_ring(coll, meshes, x, y, z, tag, gap=1.5):
    """Railing panels and posts round a rectangle (kit.balustrade without its pitch, so no Euler flips)."""
    pts = [(-x, -y), (x, -y), (x, y), (-x, y), (-x, -y)]
    posts, n = {}, 0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        a, b = Vector((ax, ay, z)), Vector((bx, by, z))
        k = max(1, round((b - a).length / gap))
        for i in range(k):
            p0, p1 = a.lerp(b, i / k), a.lerp(b, (i + 1) / k)
            d = p1 - p0
            yaw = math.atan2(d.y, d.x)
            for p in (p0, p1):
                posts.setdefault((round(p.x, 2), round(p.y, 2)), p)
            place(meshes["panel"], f"{tag}.panel{n}", coll, T(*(p0 + d.normalized() * 0.07)) @ Rz(yaw) @ Matrix.Diagonal((d.length - 0.14, 1, 1, 1)))
            n += 1
    for i, p in enumerate(posts.values()):
        place(meshes["post"], f"{tag}.post{i}", coll, T(*p))


def lion_geo():
    """A seated stone lion on a sumeru pedestal, facing -Y: 1.3 m pedestal, the lion 2.1 m more."""
    g = Geo()
    g.box(-1.1, 1.1, -0.75, 0.75, 0.0, 0.3, "marble")
    g.box(-0.95, 0.95, -0.62, 0.62, 0.3, 0.95, "marble", skip=("-z",))
    g.box(-1.08, 1.08, -0.74, 0.74, 0.95, 1.3, "marble", skip=("-z",))
    z = 1.3
    ell(g, (0, 0.2, z + 0.5), (0.5, 0.55, 0.55), "marble", nu=10, nv=6)          # the haunches
    ell(g, (0, -0.05, z + 1.0), (0.46, 0.42, 0.62), "marble", nu=10, nv=6)       # the chest
    ell(g, (0, -0.2, z + 1.6), (0.48, 0.42, 0.42), "marble", nu=10, nv=6)        # the mane
    ell(g, (0, -0.52, z + 1.55), (0.3, 0.22, 0.26), "marble", nu=8, nv=5)        # the face
    for sx in (-1, 1):
        g.box(sx * 0.25 - 0.12, sx * 0.25 + 0.12, -0.55, -0.3, z, z + 0.95, "marble")    # the forelegs
        g.box(sx * 0.25 - 0.16, sx * 0.25 + 0.16, -0.62, -0.28, z, z + 0.14, "marble")   # the paws
        ell(g, (sx * 0.34, -0.36, z + 1.9), (0.1, 0.08, 0.1), "marble", nu=6, nv=4)       # the ears
    ell(g, (-0.55, -0.4, z + 0.25), (0.28, 0.28, 0.22), "marble", nu=8, nv=5)     # the ball under a paw
    return g


def build_gate():
    clear_file()
    ensure_addon()
    M = make_materials("YDM")
    main = collection("永定门")
    g = Geo()
    X, YF, YB = gate_platform(g, GP)
    h = GP["h"]
    r = GP["arch"][0] / 2
    g.polyn([(-r, -GP["hd"] - 2.0, 0.02), (r, -GP["hd"] - 2.0, 0.02), (r, GP["hd"] + 2.0, 0.02), (-r, GP["hd"] + 2.0, 0.02)], "floor", (0, 0, 1))
    # parapets: battlements to the south (outside the city), a low wall with a stone cap to the north
    battlements(g, -X, X, YF + 0.45, h)
    g.box(-X, X, YB - 0.7, YB, h, h + 1.0, "brick", skip=("-z",))
    g.box(-X - 0.05, X + 0.05, YB - 0.78, YB + 0.08, h + 1.0, h + 1.12, "stone", skip=("-z",))
    for sx in (-1, 1):
        g.box(min(sx * (X - 0.8), sx * X), max(sx * (X - 0.8), sx * X), YF + 0.9, YB - 0.7, h, h + 1.0, "brick", skip=("-z",))
    # the wall stubs: a white base course, brick, battlements south, a capped parapet north, cut off square
    W = WING
    for sx in (-1, 1):
        x0, x1 = sorted((sx * W["x0"], sx * W["x1"]))
        xo = sx * W["x1"]
        g.box(min(x0, xo + sx * 0.1), max(x1, xo + sx * 0.1), W["y0"] - 0.1, W["y1"] + 0.1, 0.0, 1.0, "stone", skip=("-z",))
        g.box(x0, x1, W["y0"], W["y1"], 1.0, W["h"], "brick", skip=("-z", "+z"))
        g.polyn([(x0, W["y0"], W["h"]), (x1, W["y0"], W["h"]), (x1, W["y1"], W["h"]), (x0, W["y1"], W["h"])], "paving", (0, 0, 1))
        a, b = (x0, x1 - 0.6) if sx < 0 else (x0 + 0.6, x1)
        battlements(g, min(a, b), max(a, b), W["y0"] + 0.4, W["h"], t=0.8, h=1.8, merlon=1.9, gap=0.7)
        g.box(x0, x1, W["y1"] - 0.6, W["y1"], W["h"], W["h"] + 1.0, "brick", skip=("-z",))
        g.box(x0, x1, W["y1"] - 0.66, W["y1"] + 0.06, W["h"] + 1.0, W["h"] + 1.1, "stone", skip=("-z",))
        g.box(min(xo, xo - sx * 0.6), max(xo, xo - sx * 0.6), W["y0"] + 0.8, W["y1"] - 0.6, W["h"], W["h"] + 1.0, "brick", skip=("-z",))
    # the tower's stone base on the platform
    g.box(-12.9, 12.9, -6.3, 6.3, h, Z0, "stone", skip=("-z", "+z"))
    g.polyn([(-12.9, -6.3, Z0), (12.9, -6.3, Z0), (12.9, 6.3, Z0), (-12.9, 6.3, Z0)], "paving", (0, 0, 1))

    # --- the tower, in drawing units ---
    L, H, E = spec(LOW), spec(UP), big(EAVE1)
    t = Geo()
    z0, zf = big(Z0), big(ZF)
    # the ground storey: brick walls on the inner ring, a red door in the middle bay front and back
    dw, dh = big(1.45), big(3.3)
    for rot, D, us in ring_sides(L, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            want = cdir(rot, 0, -1)
            if rot in (0, 2) and i == (len(us) - 2) // 2:
                a, b = us[i], us[i + 1]
                t.polyn([P(a, z0), P(-dw, z0), P(-dw, L.BEAM[0]), P(a, L.BEAM[0])], "brick", want)
                t.polyn([P(dw, z0), P(b, z0), P(b, L.BEAM[0]), P(dw, L.BEAM[0])], "brick", want)
                t.polyn([P(-dw, z0 + dh), P(dw, z0 + dh), P(dw, L.BEAM[0]), P(-dw, L.BEAM[0])], "brick", want)
                for u0, u1 in ((-dw, 0.0), (0.0, dw)):
                    t.polyn([P(u0, z0), P(u1, z0), P(u1, z0 + dh), P(u0, z0 + dh)], "atlas", want, uvs=uvs("gatedoor", QUAD))
            else:
                t.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], L.BEAM[0]), P(us[i], L.BEAM[0])], "brick", want)
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)        # noqa: E731
            t.polyn([Q(us[i], L.BEAM[0]), Q(us[i + 1], L.BEAM[0]), Q(us[i + 1], L.BEAM[1]), Q(us[i], L.BEAM[1])], "atlas", want, uvs=uvs("beam", QUAD))
    ring_beams(L, t, True, *L.BEAM)
    for x0, x1, y0, y1 in ((-L.OX, L.OX, -L.OY, -L.IY), (-L.OX, L.OX, L.IY, L.OY), (L.IX, L.OX, -L.IY, L.IY), (-L.OX, -L.IX, -L.IY, L.IY)):
        ceiling(t, x0, x1, y0, y1, L.BEAM[1])
    # its eave, up to the gallery's edge
    ehips = []
    for rot in range(4):
        A, De = (E["A"], E["D"]) if rot % 2 == 0 else (E["D"], E["A"])
        rows = roof_face(t, E, E["top"], rot, A, De, E["top"], rows=4, cols=10, pitch=H.PITCH, amp=H.AMP, trim=H.TRIM)
        eave_edge(t, rows[0], key="tile")
        soffit(t, E, E["top"], rot, A, De, L.BEAM[3] + 0.08, span=E["span"])
        ehips.append([r[-1] for r in rows])
    for line in ehips:
        sweep(t, line, 0.5, 0.4, key="tile")
    # the gallery: a painted band and a red board round its edge, the floor
    gx, gy = big(GX), big(GY)
    for rot, D, us in ((0, gy, (-gx, gx)), (1, gx, (-gy, gy)), (2, gy, (-gx, gx)), (3, gx, (-gy, gy))):
        P = lambda u, z: to_world(rot, D, u, -0.02, z)     # noqa: E731
        zb = E["z"] + E["H"] - 0.15
        t.polyn([P(us[0], zb), P(us[1], zb), P(us[1], zf - 0.45), P(us[0], zf - 0.45)], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
        t.polyn([P(us[0], zf - 0.45), P(us[1], zf - 0.45), P(us[1], zf + 0.02), P(us[0], zf + 0.02)], "red", cdir(rot, 0, -1))
    t.polyn([(-gx, -gy, zf), (gx, -gy, zf), (gx, gy, zf), (-gx, gy, zf)], "paving", (0, 0, 1))
    # the upper storey: lattice on the inner ring (lattice doors in the middle bays), plaster above the eave
    for rot, D, us in ring_sides(H, False):
        nb = len(us) - 1
        for i in range(nb):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            reg = "door" if rot in (0, 2) and 0 < i < nb - 1 else "window"
            t.polyn([P(us[i], zf), P(us[i + 1], zf), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            t.polyn([P(us[i], H.BEAM[0]), P(us[i + 1], H.BEAM[0]), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "plaster", cdir(rot, 0, -1))
    ring_beams(H, t, True, *H.BEAM)
    ring_beams(H, t, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        ceiling(t, x0, x1, y0, y1, H.BEAM[1])
    hips = roofs(H, t)
    Sm = Matrix.Diagonal((S, S, S, 1.0))
    g.add(t, Sm)
    g.build("Gate", collection("城台与城楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze="#6b6f71"), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze="#6b6f71"), "ImmortalMesh", M, TILE),
    )
    col = mesh_of(column_geo(L.BEAM[0] - z0, r=0.5), "ColumnMesh", M, TILE)
    gcol = mesh_of(column_geo(H.BEAM[0] - zf, r=0.46), "GalleryColumnMesh", M, TILE)
    n = 0
    for rot, D, us in ring_sides(L, True):
        for u in us[1:]:
            place(col, f"Column.{n:03d}", parts, Sm @ T(*to_world(rot, D, u, 0, z0)))
            n += 1
    for rot, D, us in ring_sides(L, False):
        for u in us[1:]:
            place(col, f"Column.{n:03d}", parts, Sm @ T(*to_world(rot, D, u, 0.05, z0)))
            n += 1
    for rot, D, us in ring_sides(H, True):
        for u in us[1:]:
            place(gcol, f"GalleryColumn.{n:03d}", parts, Sm @ T(*to_world(rot, D, u, 0, zf)))
            n += 1
    spots = bracket_spots(L, True, L.BEAM[2]) + bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, Sm @ T(*p) @ Rz(yaw))
    k = 0
    for line, nb in [(ln, 4) for ln in ehips] + [(ln, 5) for ln in hips]:
        for o in beasts_on([Sm @ p for p in line], parts, mesh, f"Beast{k}", n=nb):
            o.matrix_world = o.matrix_world @ Matrix.Diagonal((0.8, 0.8, 0.8, 1.0))
        k += 1
    rail_ring(parts, rail_parts(M), GX - 0.15, GY - 0.15, ZF, "Rail")
    font = bpy.data.fonts.load(FONT)
    g2 = Geo()
    for f in (-1, 1):       # hung in front of the clerestory's brackets, between the two eaves
        plaque(g2, font, "永定門", 0.0, f * (UP["IY"] + 0.85), 20.22, M, collection("匾", main), f"Plaque{'N' if f > 0 else 'S'}", face=f,
               w=0.85, h=1.15)
    lion = mesh_of(lion_geo(), "LionMesh", M, TILE)
    for i, (x, y) in enumerate(LIONS):
        place(lion, f"Lion{i}", parts, T(x, y, 0.0) @ Rz(math.pi))       # facing north, out of the gate
    g2.build("PlaqueBoard", collection("匾", main), M, TILE)

    far = Geo()
    far.box(-GP["hw"], GP["hw"], -GP["hd"], GP["hd"], 0.0, h + 1.0, "brick", skip=("-z",))
    for sx in (-1, 1):
        x0, x1 = sorted((sx * W["x0"], sx * W["x1"]))
        far.box(x0, x1, W["y0"], W["y1"], 0.0, W["h"] + 1.0, "brick", skip=("-z",))
    ft = Geo()
    ft.box(-L.OX, L.OX, -L.OY, L.OY, z0, E["z"], "plaster", skip=("-z", "+z"))
    for rot in range(4):
        A, De = (E["A"], E["D"]) if rot % 2 == 0 else (E["D"], E["A"])
        roof_face(ft, E, E["top"], rot, A, De, E["top"], rows=2, waves=False, cols=4, trim=0.0)
    ft.box(-H.IX, H.IX, -H.IY, H.IY, zf, H.UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(H, ft, lod=True)
    far.add(ft, Sm)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    w, crown = GP["arch"]
    top = h + 1.9
    collider_box(helpers, "pierW", -GP["hw"], -w / 2, -GP["hd"], GP["hd"], 0.0, top)
    collider_box(helpers, "pierE", w / 2, GP["hw"], -GP["hd"], GP["hd"], 0.0, top)
    collider_box(helpers, "lintel", -w / 2, w / 2, -GP["hd"], GP["hd"], crown, top)
    collider_box(helpers, "tower", -EAVE1["A"], EAVE1["A"], -EAVE1["D"], EAVE1["D"], h, 25.0)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (GP["hw"] - 0.5), sx * W["x1"]))
        collider_box(helpers, f"wing{sx:+d}", x0, x1, W["y0"] - 0.1, W["y1"] + 0.1, 0.0, W["h"] + 1.8)
    for i, (x, y) in enumerate(LIONS):
        collider_box(helpers, f"lion{i}", x - 1.1, x + 1.1, y - 0.75, y + 0.75, 0.0, 3.2)
    flat_marker(helpers, "gate", rect(-GP["hw"] - 0.5, GP["hw"] + 0.5, -GP["hd"] - 0.6, GP["hd"] + 0.6), "FOOTPRINT")
    flat_marker(helpers, "wingW", rect(-W["x1"] - 0.8, -GP["hw"] + 0.2, W["y0"] - 0.4, W["y1"] + 0.5), "FOOTPRINT")
    flat_marker(helpers, "wingE", rect(GP["hw"] - 0.2, W["x1"] + 0.3, W["y0"] - 0.4, W["y1"] + 0.5), "FOOTPRINT")
    # no street furniture in the gateway's approaches or round the lions
    flat_marker(helpers, "approach", rect(-11.0, 11.0, -GP["hd"] - 5.0, LIONS[0][1] + 2.5), "CLEAR")
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "yongdingmen", "永定门", "Yongdingmen"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -380.1, 4204.3, -2.3
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots))


# --- 燕墩 ---------------------------------------------------------------------------------------------------
YD = dict(hw=7.43, top=6.95, h=9.0, base=0.8)


def build_yandun():
    clear_file()
    ensure_addon()
    M = dict(
        brick=material("YD_Brick", "#7b7e80", 0.9, tex=brick_image("YD_BrickTex"), props={"wet": "damp", "glowStrength": 0.8}),
        stone=material("YD_Stone", "#bdb8ad", 0.75, props={"wet": "damp", "glowStrength": 0.6}),
        paving=material("YD_Paving", "#a29e94", 0.8, props={"wet": "ground", "glowStrength": 0.6}),
        dark=material("YD_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
    )
    main = collection("燕墩")
    g = Geo()
    hw, ht, h, zb = YD["hw"], YD["top"], YD["h"], YD["base"]
    X = lambda z: hw - (hw - ht) * z / h      # noqa: E731
    # the stone base course, the battered brick body, a stone cornice, the parapet with its cap
    g.box(-hw - 0.08, hw + 0.08, -hw - 0.08, hw + 0.08, 0.0, zb, "stone", skip=("-z", "+z"))
    for rot in range(4):
        P = lambda u, z: to_world(rot, X(z), u, 0.0, z)            # noqa: E731
        g.polyn([P(-X(zb), zb), P(X(zb), zb), P(X(h), h), P(-X(h), h)], "brick", cdir(rot, 0, -1))
    c = ht + 0.12
    g.box(-c, c, -c, c, h, h + 0.28, "stone", skip=("-z", "+z"))
    p = ht
    for rot in range(4):
        a = to_world(rot, p, -p, 0, 0)
        b = to_world(rot, p - 0.55, p - 0.55, 0, 0)
        g.box(min(a.x, b.x), max(a.x, b.x), min(a.y, b.y), max(a.y, b.y), h + 0.28, h + 1.0, "brick", skip=("-z",))
    for rot in range(4):
        a = to_world(rot, p + 0.03, -p - 0.03, 0, 0)
        b = to_world(rot, p - 0.58, p - 0.58, 0, 0)
        g.box(min(a.x, b.x), max(a.x, b.x), min(a.y, b.y), max(a.y, b.y), h + 1.0, h + 1.12, "stone", skip=("-z",))
    g.polyn([(-c, -c, h + 0.28), (c, -c, h + 0.28), (c, c, h + 0.28), (-c, c, h + 0.28)], "paving", (0, 0, 1))
    # the stone doors at the north-west corner (the stair inside), an arched opening in a stone frame
    yn = X(zb) + 0.02
    xd, wd, hd = -4.6, 1.3, 2.4
    arc = [(xd + wd / 2 * math.cos(math.pi * i / 8), zb + hd - wd / 2 + wd / 2 * math.sin(math.pi * i / 8)) for i in range(9)]
    g.polyn([(xd - wd / 2, yn, 0.0), (xd + wd / 2, yn, 0.0)] + [(x, yn, z) for x, z in arc], "dark", (0, 1, 0))
    g.box(xd - wd / 2 - 0.25, xd + wd / 2 + 0.25, yn - 0.02, yn + 0.12, zb + hd - 0.1, zb + hd + 0.25, "stone")
    for sx in (-1, 1):
        g.box(xd + sx * (wd / 2 + 0.12) - 0.13, xd + sx * (wd / 2 + 0.12) + 0.13, yn - 0.02, yn + 0.1, 0.0, zb + hd - 0.1, "stone")
    # the altar and the stele: a sumeru base, the square shaft with a carved border, cornice, eave and hipped cap
    zt = h + 0.28
    g.box(-1.9, 1.9, -1.9, 1.9, zt, zt + 0.9, "stone", skip=("-z",))
    g.box(-2.05, 2.05, -2.05, 2.05, zt + 0.9, zt + 1.05, "stone", skip=("-z",))
    z = zt + 1.05
    for a, dz in ((1.25, 0.3), (1.1, 0.2), (0.95, 0.55), (1.12, 0.2), (1.2, 0.25)):
        g.box(-a, a, -a, a, z, z + dz, "stone", skip=("-z",))
        z += dz
    s0, s1 = z, z + 5.0
    g.box(-0.72, 0.72, -0.72, 0.72, s0, s1, "stone", skip=("-z", "+z"))
    for rot in range(4):
        for u in (-0.62, 0.62):
            a = to_world(rot, 0.72, u - 0.05, -0.04, 0)
            b = to_world(rot, 0.72, u + 0.05, 0.0, 0)
            g.box(min(a.x, b.x), max(a.x, b.x), min(a.y, b.y), max(a.y, b.y), s0 + 0.1, s1 - 0.1, "stone", skip=("-z", "+z"))
    z = s1
    for a, dz in ((0.8, 0.2), (0.95, 0.35), (1.1, 0.2)):
        g.box(-a, a, -a, a, z, z + dz, "stone", skip=("-z",))
        z += dz
    top = z + 0.9
    for rot in range(4):
        P = lambda u, v, zz: to_world(rot, 1.1, u, v, zz)          # noqa: E731
        g.polyn([P(-1.1, 0, z), P(1.1, 0, z), P(0, 1.1, top)], "stone", tuple(cdir(rot, 0, -1) + Vector((0, 0, 1))))
    cyl(g, 0, 0, top - 0.1, top + 0.25, 0.2, 0.12, 8, "stone")
    ell(g, (0, 0, top + 0.38), (0.16, 0.16, 0.18), "stone", nu=8, nv=4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            ell(g, (sx * 0.75, sy * 0.75, z - 0.05), (0.22, 0.22, 0.2), "stone", nu=6, nv=4)       # the corner dragons
    g.build("Yandun", collection("燕墩", main), M, TILE)
    tris = g.tris()

    far = Geo()
    far.box(-hw, hw, -hw, hw, 0.0, h + 1.0, "brick", skip=("-z",))
    far.box(-1.9, 1.9, -1.9, 1.9, zt, zt + 1.05, "stone", skip=("-z",))
    far.box(-1.1, 1.1, -1.1, 1.1, zt + 1.05, s0, "stone", skip=("-z",))
    far.box(-0.72, 0.72, -0.72, 0.72, s0, top, "stone", skip=("-z",))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    collider_box(helpers, "body", -hw + 0.24, hw - 0.24, -hw + 0.24, hw - 0.24, 0.0, h + 1.0)
    collider_box(helpers, "stele", -1.9, 1.9, -1.9, 1.9, zt, top)
    flat_marker(helpers, "yandun", rect(-hw - 0.4, hw + 0.4, -hw - 0.4, hw + 0.4), "FOOTPRINT")
    flat_marker(helpers, "round", rect(-hw - 2.5, hw + 2.5, -hw - 2.5, hw + 2.5), "CLEAR")     # no tree growing into it
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "yandun", "燕墩", "Yandun"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -414.0, 4630.4, 0.4
    s.far_distance = 400
    s.repo_path = REPO
    return dict(tris=tris, top=top)


if __name__ == "__main__":
    if ONLY in (None, "gate"):
        print("gate", build_gate())
        save_and_export(os.path.join(REPO, "art", "landmarks", "yongdingmen.blend"), argv)
    if ONLY in (None, "yandun"):
        print("yandun", build_yandun())
        save_and_export(os.path.join(REPO, "art", "landmarks", "yandun.blend"), argv)
