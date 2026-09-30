# 鼓楼 and 钟楼, the Drum Tower and the Bell Tower at the north end of the central axis, 190 m apart with
# the 钟鼓楼文化广场 between them (the city draws the square). Built with the timber hall of hall.py (roofs,
# brackets, beams, beasts; imported, not edited) and marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/gulou_zhonglou.py -- [--export] [--only drum|bell]
#
# Two files, each its own landmark: art/landmarks/gulou.blend (id gulou) and art/landmarks/zhonglou.blend
# (id zhonglou), like zhengyangmen.py builds 正阳门 and 箭楼.
#
# Frame: Blender +X east, +Y north, metres; each origin is the centre of its tower's OSM outline, placed in
# game metres (way 267371087 鼓楼: centre (-668.2, -3397.45), 52.8 x 35.0 m, heading -1.3; way 425993664 钟楼:
# centre (-677.1, -3583.6), 32.8 x 35.0 m, heading -0.7).
#
# The figures (published: 鼓楼 46.7 m, a 5 x 3 bay hall with a corridor all round, 24 eave and 16 inner
# columns, 三重檐歇山 in grey tiles edged with green glaze, three arches north and south and one east and
# west joined by cross vaults, 25 drums; 钟楼 47.9 m, all brick and stone, the first level 15.74 m with an
# arch on each side and cross vaults, a white stone balustrade round the terrace, 重檐歇山 of dark tiles
# edged with green glaze), the rest proportioned from photographs:
#   - 鼓楼: a red-plastered masonry body (墩台) 17.6 m high on a stone base course, battered, the arches
#     through it; the 腰檐 (a skirt roof) round its top, the gallery (平坐) above it with a red railing, the
#     open corridor of 24 columns round the hall's lattice walls, four 擎檐柱 at the lower roof's corners,
#     the upper storey on the inner ring and the double-eaved 歇山 over it. The middle bay north and south
#     stands open onto the drums inside (the great drum on its stand and 24 smaller ones).
#   - 钟楼: a low stone plinth, the grey brick 墩台 (15.7 m, battered) with the cross vaults, a stone
#     cornice and the white balustrade round the terrace; the brick upper storey with an arched doorway and
#     two stone-latticed windows on each face, grey brick brackets, and the double-eaved 歇山.
#   - OSM draws two blocks against the Bell Tower's east and west faces (ways 425993666 / 425993668, no
#     tags; the city made them four storeys): they are taken in as low one-storey side halls.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, collider_pts, flat_marker, lathe, mesh_of, place,  # noqa: E402
                 panel_geo, post_geo, rect, cyl)
from hall import (ATLAS_H, ATLAS_W, REG, beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo,  # noqa: E402
                  eave_edge, paint_atlas, plaster, ring_beams, ring_sides, roof_face, roofs, soffit, sweep, to_world, uvs)
from zhengyangmen import brick_image, ceiling  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None
GREEN = "#2e7d57"

TILE = dict(plaster=4.0, brick=4.0, vault=4.0, stone=2.0, paving=4.0, tile=2.0, trim=2.0, marble=2.0, red=2.0, gold=1.0,
            paint=1.0, dark=1.0, hide=1.0, atlas=1.0, wood=2.0)


def make_materials(prefix, bell=False):
    atlas, night = paint_atlas(prefix, portrait=False, emblem=False)
    if bell:
        grey_atlas(atlas)
    M = dict(
        atlas=material(f"{prefix}_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        brick=material(f"{prefix}_Brick", "#7b7e80", 0.9, tex=brick_image(f"{prefix}_BrickTex"), props={"wet": "damp", "glowStrength": 0.8}),
        stone=material(f"{prefix}_Stone", "#b3aea4", 0.75, props={"wet": "damp", "glowStrength": 0.7}),
        paving=material(f"{prefix}_Paving", "#a29e94", 0.8, props={"wet": "ground", "glowStrength": 0.6}),
        tile=material(f"{prefix}_Tile", "#55595c" if bell else "#5d6164", 0.6, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material(f"{prefix}_Trim", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.6}),
        marble=material(f"{prefix}_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        gold=material(f"{prefix}_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material(f"{prefix}_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material(f"{prefix}_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
    )
    if bell:
        M["red"] = M["stone"]                     # the barge boards of a brick building are stone
        M["vault"] = M["brick"]
        M["plaster"] = material(f"{prefix}_Plaster", "#8e3222", 0.85, props={"wet": "damp"})     # the side halls' doors
    else:
        M["plaster"] = material(f"{prefix}_Plaster", "#a8321f", 0.85, tex=plaster(name=f"{prefix}_PlasterTex", col="#a8321f"), props={"wet": "damp", "glowStrength": 0.7})
        M["red"] = material(f"{prefix}_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"})
        M["vault"] = M["brick"]
        M["hide"] = material(f"{prefix}_Hide", "#d8c7a0", 0.6, props={"wet": "none"})
    return M


def grey_atlas(im):
    """The Bell Tower is brick and stone throughout: its rafters and gables are grey, not painted."""
    arr = np.array(im.pixels[:], dtype=np.float32).reshape(ATLAS_H, ATLAS_W, 4)

    def paste(name, cv):
        x0, y0, x1, y1 = REG[name]
        arr[ATLAS_H - y1:ATLAS_H - y0, x0:x1, :3] = np.flipud(cv.a)

    x0, y0, x1, y1 = REG["rafters"]
    c = Canvas(x1 - x0, y1 - y0, "#4a4c4d")
    for k in range(8):
        x = 4 + k * 32
        c.rect(x, 0, x + 22, 256, "#6c6f70")
        c.rect(x, 256 - 30, x + 22, 256 - 6, "#8a8c8b")
    c.noise(0.06, 4)
    paste("rafters", c)
    x0, y0, x1, y1 = REG["gable"]
    c = Canvas(x1 - x0, y1 - y0, "#76797a")
    rows = (c.y // 8).astype(int)
    joint = (np.mod(c.y, 8) < 1.2) | (np.mod(c.x + (rows % 2) * 16, 32) < 1.2)
    c.put(joint, "#9a9c99")
    c.line(0, 256, 256, 0, 10, "#a9a79f")
    c.line(256, 0, 512, 256, 10, "#a9a79f")
    c.noise(0.05, 5)
    paste("gable", c)
    im.pixels.foreach_set(arr.ravel())
    im.pack()


# --- a masonry block pierced by vaulted passages ------------------------------------------------------------
# B: hw, hd (half sizes at the foot), h, bat (how far each face leans in over h), ns = [(x centre, width, crown)]
# (passages running north-south, right through), ew = [(y centre, width, crown)] (east-west, crossing them;
# their crown no higher than the springing of the north-south vaults, so they open as arches in those walls).

def arc_pts(c, r, spring, n=14):
    return [(c + r * math.cos(math.pi * (1 - i / n)), spring + r * math.sin(math.pi * (1 - i / n))) for i in range(n + 1)]


def pierced_block(g, B, wall, base=None, zb=0.0, top="paving"):
    hw, hd, h, bat = B["hw"], B["hd"], B["h"], B["bat"]
    X = lambda z: hw - bat * z / h      # noqa: E731
    Y = lambda z: hd - bat * z / h      # noqa: E731
    bands = [(0.0, zb, base), (zb, h, wall)] if base else [(0.0, h, wall)]

    def face(P, ext, opens, want):
        cuts = sorted(opens)
        lefts = [None] + [c + w / 2 for c, w, _ in cuts]
        rights = [c - w / 2 for c, w, _ in cuts] + [None]
        for a, b in zip(lefts, rights):
            for z0, z1, key in bands:
                ua0, ua1 = (-ext(z0), -ext(z1)) if a is None else (a, a)
                ub0, ub1 = (ext(z0), ext(z1)) if b is None else (b, b)
                g.polyn([P(ua0, z0), P(ub0, z0), P(ub1, z1), P(ua1, z1)], key, want)
        for c, w, cr in cuts:
            r = w / 2
            g.polyn([P(u, z) for u, z in arc_pts(c, r, cr - r)] + [P(c + r, h), P(c - r, h)], wall, want)

    face(lambda u, z: Vector((u, -Y(z), z)), X, B["ns"], (0, -1, 0))
    face(lambda u, z: Vector((u, Y(z), z)), X, B["ns"], (0, 1, 0))
    face(lambda u, z: Vector((X(z), u, z)), Y, B["ew"], (1, 0, 0))
    face(lambda u, z: Vector((-X(z), u, z)), Y, B["ew"], (-1, 0, 0))
    g.polyn([(-X(h), -Y(h), h), (X(h), -Y(h), h), (X(h), Y(h), h), (-X(h), Y(h), h)], top, (0, 0, 1))

    # the north-south passages: side walls (with the east-west arches in them) and the barrel vault
    for xc, w, cr in B["ns"]:
        r = w / 2
        s = cr - r
        for sx in (-1, 1):
            x = xc + sx * r
            want = (-sx, 0, 0)
            bnd = [lambda z: -Y(z)]
            for yc, w2, cr2 in sorted(B["ew"]):
                r2 = w2 / 2
                bnd += [lambda z, a=yc - r2: a, lambda z, a=yc + r2: a]
                g.polyn([(x, y, z) for y, z in arc_pts(yc, r2, cr2 - r2)] + [(x, yc + r2, s), (x, yc - r2, s)], "vault", want)
            bnd.append(lambda z: Y(z))
            for a, b in zip(bnd[::2], bnd[1::2]):
                g.polyn([(x, a(0), 0.0), (x, b(0), 0.0), (x, b(s), s), (x, a(s), s)], "vault", want)
        sec = arc_pts(xc, r, s)
        for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            g.polyn([(x0, -Y(z0), z0), (x1, -Y(z1), z1), (x1, Y(z1), z1), (x0, Y(z0), z0)], "vault", (xc - mx, 0, s - mz), smooth=True)

    # the east-west passages, in pieces between the north-south ones
    for yc, w2, cr2 in B["ew"]:
        r2 = w2 / 2
        s2 = cr2 - r2
        bounds = [lambda z: -X(z)]
        for xc, w, _ in sorted(B["ns"]):
            bounds += [lambda z, a=xc - w / 2: a, lambda z, a=xc + w / 2: a]
        bounds.append(lambda z: X(z))
        for a, b in zip(bounds[::2], bounds[1::2]):
            for sy in (-1, 1):
                y = yc + sy * r2
                g.polyn([(a(0), y, 0.0), (b(0), y, 0.0), (b(s2), y, s2), (a(s2), y, s2)], "vault", (0, -sy, 0))
            sec = arc_pts(yc, r2, s2)
            for (y0, z0), (y1, z1) in zip(sec, sec[1:]):
                my, mz = (y0 + y1) / 2, (z0 + z1) / 2
                g.polyn([(a(z0), y0, z0), (a(z1), y1, z1), (b(z1), y1, z1), (b(z0), y0, z0)], "vault", (0, yc - my, s2 - mz), smooth=True)
    return X(h), Y(h)


def block_colliders(coll, B, tag):
    """Boxes for the solid masonry, leaving every passage open (the batter ignored: the boxes are the foot less
    half the lean)."""
    hw, hd, h = B["hw"] - B["bat"] / 2, B["hd"] - B["bat"] / 2, B["h"]

    def solid(lo, hi, cuts):
        out, a = [], lo
        for c, w, _ in sorted(cuts):
            out.append((a, c - w / 2))
            a = c + w / 2
        out.append((a, hi))
        return out
    xs, ys = solid(-hw, hw, B["ns"]), solid(-hd, hd, B["ew"])
    n = 0
    for x0, x1 in xs:
        for y0, y1 in ys:
            collider_box(coll, f"{tag}{n}", x0, x1, y0, y1, 0.0, h)
            n += 1
        for yc, w2, cr2 in B["ew"]:
            collider_box(coll, f"{tag}{n}", x0, x1, yc - w2 / 2, yc + w2 / 2, cr2, h)
            n += 1
    for xc, w, cr in B["ns"]:
        collider_box(coll, f"{tag}{n}", xc - w / 2, xc + w / 2, -hd, hd, cr, h)
        n += 1
    return n


def rail_parts(M, key="red"):
    """A timber railing: square posts and a panel of rails and balusters (one metre along +X, scaled to fit)."""
    p = Geo()
    p.box(-0.08, 0.08, -0.08, 0.08, 0.0, 1.15, key)
    q = Geo()
    q.box(0.0, 1.0, -0.05, 0.05, 0.95, 1.05, key)
    q.box(0.0, 1.0, -0.04, 0.04, 0.08, 0.16, key)
    for i in range(4):
        x = 0.125 + i * 0.25
        q.box(x - 0.025, x + 0.025, -0.025, 0.025, 0.16, 0.95, key, skip=("-z", "+z"))
    return dict(post=mesh_of(p, "RailPostMesh", M, TILE), panel=mesh_of(q, "RailPanelMesh", M, TILE))


def ring(x, y, z):
    return [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z), (-x, -y, z)]


# --- 鼓楼 ---------------------------------------------------------------------------------------------------

D_BLOCK = dict(hw=26.4, hd=17.5, h=17.6, bat=0.5,
               ns=[(-14.5, 5.6, 9.2), (0.0, 7.0, 11.0), (14.5, 5.6, 9.2)], ew=[(0.0, 5.0, 6.4)])
D_BASE = 1.6                       # the stone base course under the red plaster
ZF = 20.0                          # the gallery floor (平坐)
WAIST = dict(z=17.9, H=ZF - 17.9, p=1.3, o=0.8, lift=0.6, Lc=5.0, Vc=2.5, A=27.25, D=18.35, top=3.9, span=1.35)
GX, GY = WAIST["A"] - WAIST["top"], WAIST["D"] - WAIST["top"]      # the gallery's edge (23.35, 14.45)
DRUM = SimpleNamespace(
    XS=[-21.4, -17.4, -10.4, -3.6, 3.6, 10.4, 17.4, 21.4], YS=[-12.4, -8.8, -3.0, 3.0, 8.8, 12.4],
    OX=21.4, OY=12.4, IX=17.4, IY=8.8, BEAM=(26.4, 27.15, 27.35, 28.25), UBEAM=(34.8, 35.55, 35.75, 36.65), OVERHANG=3.3,
    LOWER=dict(A=24.7, D=15.7, z=27.75, H=3.0, p=1.3, o=1.0, lift=0.9, Lc=7.5, Vc=4.2),
    UPPER=dict(A=20.7, D=12.1, z=36.2, H=8.0, p=1.6, o=0.95, lift=0.95, Lc=7.0, Vc=4.2),
    GABLE_X=15.9, PITCH=0.42, AMP=0.09, TRIM=1.4, RIDGE="trim")
D_UPPER0 = 30.2


def drum_geo():
    """A drum lying with its heads north and south: a lacquered barrel with gilt stud rings, the hide heads, and
    its stand (a cradle on four legs). Diameter 1.34 m, 1.1 m long; the axis 1.25 m up."""
    g = Geo()
    d = Geo()
    lathe(d, [(0.6, -0.55), (0.645, -0.35), (0.67, -0.12), (0.672, 0.0), (0.67, 0.12), (0.645, 0.35), (0.6, 0.55)], 16, "red")
    for zz in (-0.55, 0.55):
        pts = [(0.6 * math.cos(2 * math.pi * i / 16), 0.6 * math.sin(2 * math.pi * i / 16), zz) for i in range(16)]
        d.polyn(pts, "hide", (0, 0, 1 if zz > 0 else -1))
        cyl(d, 0, 0, zz - (0.05 if zz > 0 else -0.05), zz, 0.615, 0.615, 16, "gold", caps=(False, False))
    g.add(d, T(0, 0, 1.25) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.box(sx * 0.45 - 0.05, sx * 0.45 + 0.05, sy * 0.35 - 0.05, sy * 0.35 + 0.05, 0.0, 0.85, "red")
    g.box(-0.62, 0.62, -0.42, 0.42, 0.62, 0.72, "red")
    return g


def build_drum():
    clear_file()
    ensure_addon()
    M = make_materials("GL")
    main = collection("鼓楼")
    H, B, W = DRUM, D_BLOCK, WAIST
    g = Geo()
    pierced_block(g, B, "plaster", base="stone", zb=D_BASE)

    # the 腰檐: a skirt roof round the masonry's top, from its eave up to the gallery floor
    whips = []
    for rot in range(4):
        A, De = (W["A"], W["D"]) if rot % 2 == 0 else (W["D"], W["A"])
        rows = roof_face(g, W, W["top"], rot, A, De, W["top"], rows=4, cols=10, pitch=H.PITCH, amp=H.AMP, trim=H.TRIM)
        eave_edge(g, rows[0], key="trim")
        soffit(g, W, W["top"], rot, A, De, B["h"] - 0.05, span=W["span"])
        whips.append([r[-1] for r in rows])
    for line in whips:
        sweep(g, line, 0.45, 0.35, key="trim")
    # the gallery floor and its edge board
    g.polyn([(-GX, -GY, ZF), (GX, -GY, ZF), (GX, GY, ZF), (-GX, GY, ZF)], "paving", (0, 0, 1))
    for rot, D, us in ((0, GY, (-GX, GX)), (1, GX, (-GY, GY)), (2, GY, (-GX, GX)), (3, GX, (-GY, GY))):
        P = lambda u, z: to_world(rot, D, u, -0.02, z)     # noqa: E731
        g.polyn([P(us[0], ZF - 0.32), P(us[1], ZF - 0.32), P(us[1], ZF + 0.02), P(us[0], ZF + 0.02)], "red", cdir(rot, 0, -1))

    # the hall: lattice walls on the inner ring (the middle bay north and south open), the corridor outside it
    z0 = ZF
    opened = []
    for rot, D, us in ring_sides(H, False):
        nb = len(us) - 1
        for i in range(nb):
            P = lambda u, z, v=0.05: to_world(rot, D, u, v, z)      # noqa: E731
            mid = i == nb // 2
            if rot in (0, 2) and mid:
                opened.append((rot, D, us[i], us[i + 1]))
            else:
                reg = "door" if (rot in (0, 2) and 0 < i < nb - 1) or (rot in (1, 3) and mid) else "window"
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
                # the inside face of the wall
                g.polyn([P(us[i], z0, 0.3), P(us[i + 1], z0, 0.3), P(us[i + 1], H.BEAM[1], 0.3), P(us[i], H.BEAM[1], 0.3)], "plaster", cdir(rot, 0, 1))
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)        # noqa: E731
            g.polyn([Q(us[i], H.BEAM[0]), Q(us[i + 1], H.BEAM[0]), Q(us[i + 1], H.BEAM[1]), Q(us[i], H.BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            # the upper storey: lattice all round
            g.polyn([P(us[i], D_UPPER0), P(us[i + 1], D_UPPER0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("window", QUAD))
    for rot, D, u0, u1 in opened:
        # the open bay's reveals and head, into the plastered hall
        P = lambda u, v, z: to_world(rot, D, u, v, z)             # noqa: E731
        for u, s in ((u0, 1), (u1, -1)):
            g.polyn([P(u, 0.05, z0), P(u, 0.3, z0), P(u, 0.3, H.BEAM[0]), P(u, 0.05, H.BEAM[0])], "plaster", cdir(rot, s, 0))
        g.polyn([P(u0, -0.25, H.BEAM[0]), P(u1, -0.25, H.BEAM[0]), P(u1, 0.3, H.BEAM[0]), P(u0, 0.3, H.BEAM[0])], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
        g.polyn([P(u0, 0.3, H.BEAM[0]), P(u1, 0.3, H.BEAM[0]), P(u1, 0.3, H.BEAM[1]), P(u0, 0.3, H.BEAM[1])], "plaster", cdir(rot, 0, 1))
    ceiling(g, -H.IX + 0.3, H.IX - 0.3, -H.IY + 0.3, H.IY - 0.3, H.BEAM[1])
    ring_beams(H, g, True, *H.BEAM)
    ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        ceiling(g, x0, x1, y0, y1, H.BEAM[1])
    hips = roofs(H, g)
    g.build("DrumTower", collection("鼓楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = dict(
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze=GREEN), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze=GREEN), "ImmortalMesh", M, TILE),
    )
    col = mesh_of(column_geo(H.BEAM[0] - z0), "ColumnMesh", M, TILE)
    ucol = mesh_of(column_geo(H.UBEAM[0] - D_UPPER0 + 0.6, r=0.38), "UpperColumnMesh", M, TILE)
    n = 0
    for outer in (True, False):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(col, f"Column.{n:03d}", parts, T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(ucol, f"UpperColumn.{n:03d}", parts, T(*to_world(rot, D, u, 0, D_UPPER0 - 0.6)))
                n += 1
    # the 擎檐柱: four slender posts under the lower roof's corners
    post = Geo()
    cyl(post, 0, 0, 0.0, H.LOWER["z"] - 0.35 - z0, 0.2, 0.18, 10, "red", caps=(False, True))
    post_me = mesh_of(post, "CornerPostMesh", M, TILE)
    for sx in (-1, 1):
        for sy in (-1, 1):
            place(post_me, f"CornerPost{sx:+d}{sy:+d}", parts, T(sx * (H.OX + 1.6), sy * (H.OY + 1.6), z0))
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=7)
    rails = rail_parts(M)
    balustrade(parts, rails, ring(GX - 0.2, GY - 0.2, ZF), "Rail", gap=1.8)
    # the drums: the great drum in the middle, 24 smaller ones in rows either side
    drum = mesh_of(drum_geo(), "DrumMesh", M, TILE)
    place(drum, "GreatDrum", parts, T(0, 0, z0) @ Matrix.Diagonal((1.75, 1.75, 1.75, 1.0)))
    k = 0
    for sx in (-1, 1):
        for x in (5.5, 8.5, 11.5, 14.5):
            for y in (-4.6, 0.0, 4.6):
                place(drum, f"Drum.{k:02d}", parts, T(sx * x, y, z0))
                k += 1

    far = Geo()
    far.box(-B["hw"], B["hw"], -B["hd"], B["hd"], 0.0, B["h"], "plaster", skip=("-z",))
    for rot in range(4):
        A, De = (W["A"], W["D"]) if rot % 2 == 0 else (W["D"], W["A"])
        roof_face(far, W, W["top"], rot, A, De, W["top"], rows=2, waves=False, cols=4, trim=0.0)
    far.box(-H.IX, H.IX, -H.IY, H.IY, ZF, H.UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(H, far, lod=True)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    block_colliders(helpers, B, "block")
    collider_box(helpers, "hall", -GX, GX, -GY, GY, B["h"], 44.0)
    flat_marker(helpers, "drum", rect(-B["hw"] - 0.6, B["hw"] + 0.6, -B["hd"] - 0.6, B["hd"] + 0.6), "FOOTPRINT")
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "gulou", "鼓楼", "Drum Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -668.2, -3397.45, -1.3
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots), drums=k + 1)


# --- 钟楼 ---------------------------------------------------------------------------------------------------

PLINTH = dict(hw=16.4, hd=17.5, h=0.6)
Z_BLOCK = dict(hw=15.0, hd=16.1, h=15.7, bat=1.0, ns=[(0.0, 5.6, 9.0)], ew=[(0.0, 5.0, 6.2)])
BELL = SimpleNamespace(
    XS=[-10.4, -8.2, 8.2, 10.4], YS=[-11.0, -8.8, 8.8, 11.0], OX=10.4, OY=11.0, IX=8.2, IY=8.8,
    BEAM=(26.0, 26.6, 26.7, 27.5), UBEAM=(35.0, 35.6, 35.7, 36.5), OVERHANG=2.6,
    LOWER=dict(A=13.0, D=13.6, z=26.95, H=2.8, p=1.3, o=0.9, lift=0.8, Lc=6.0, Vc=3.5),
    UPPER=dict(A=11.1, D=11.7, z=36.0, H=9.0, p=1.6, o=0.95, lift=0.95, Lc=6.5, Vc=4.0),
    GABLE_X=6.3, PITCH=0.42, AMP=0.09, TRIM=1.4, RIDGE="trim", BRACKET_GAP=1.4)
Z_UPPER0 = 29.2
# the side halls on OSM's two blocks against the tower (game offsets from the tower's centre, +z south)
SIDE_HALLS = [[(16.2, -11.9), (39.4, -12.2), (39.6, 5.1), (16.4, 5.3)],
              [(-38.9, -11.1), (-16.5, -11.4), (-16.3, 6.5), (-38.7, 6.7)]]
Z_HEADING = -0.7


def local(dx, dz, heading):
    """A game offset (east, south) from the origin in the model's frame (+Y at `heading`, clockwise from north)."""
    h = math.radians(heading)
    e, n = dx, -dz
    return (e * math.cos(h) - n * math.sin(h), e * math.sin(h) + n * math.cos(h))


def grey_bracket():
    """A brick bracket set (the Bell Tower's are masonry): block, crossed arms, the beak, all grey."""
    g = Geo(colors=True)
    a, b = (0.43, 0.44, 0.44), (0.34, 0.35, 0.35)
    g.box(-0.24, 0.24, -0.24, 0.24, 0.0, 0.3, "paint", a, skip=("+y", "-z"))
    g.box(-0.8, 0.8, -0.09, 0.09, 0.3, 0.6, "paint", b, skip=("+y", "-z"))
    g.box(-0.09, 0.09, -0.95, 0.25, 0.3, 0.8, "paint", a, skip=("+y", "-z"))
    g.box(-0.5, 0.5, -0.67, -0.49, 0.6, 0.8, "paint", b, skip=("-z",))
    return g


def arch_door(w=3.4, crown=6.6):
    """An arched doorway on a wall facing -Y: the dark opening, a stone arch ring and jambs standing proud."""
    g = Geo()
    r = w / 2
    s = crown - r
    arc = arc_pts(0.0, r, s, 12)
    g.polyn([(-r, -0.02, 0.0), (r, -0.02, 0.0)] + [(x, -0.02, z) for x, z in arc[::-1]], "dark", (0, -1, 0))
    out = arc_pts(0.0, r + 0.45, s, 12)
    for (x0, z0), (x1, z1), (a0, c0), (a1, c1) in zip(arc, arc[1:], out, out[1:]):
        g.polyn([(x0, -0.12, z0), (x1, -0.12, z1), (a1, -0.12, c1), (a0, -0.12, c0)], "stone", (0, -1, 0))
        g.polyn([(x0, -0.12, z0), (x1, -0.12, z1), (x1, 0.0, z1), (x0, 0.0, z0)], "stone", (0, 0, -1))
    for sx in (-1, 1):
        g.box(min(sx * r, sx * (r + 0.45)), max(sx * r, sx * (r + 0.45)), -0.12, 0.0, 0.0, s, "stone", skip=("+y", "-z", "+z"))
    return g


def stone_window(w=2.1, hgt=2.7):
    """A window of carved stone lattice in a stone frame, on a wall facing -Y (centred on its middle)."""
    g = Geo()
    g.polyn([(-w / 2, -0.02, -hgt / 2), (w / 2, -0.02, -hgt / 2), (w / 2, -0.02, hgt / 2), (-w / 2, -0.02, hgt / 2)], "dark", (0, -1, 0))
    f = 0.3
    for x0, x1, z0, z1 in ((-w / 2 - f, w / 2 + f, -hgt / 2 - f, -hgt / 2), (-w / 2 - f, w / 2 + f, hgt / 2, hgt / 2 + f),
                           (-w / 2 - f, -w / 2, -hgt / 2, hgt / 2), (w / 2, w / 2 + f, -hgt / 2, hgt / 2)):
        g.box(x0, x1, -0.14, 0.0, z0, z1, "stone", skip=("+y",))
    for i in range(1, 5):
        x = -w / 2 + w * i / 5
        g.box(x - 0.05, x + 0.05, -0.08, 0.0, -hgt / 2, hgt / 2, "stone", skip=("+y", "-z", "+z"))
    for i in range(1, 6):
        z = -hgt / 2 + hgt * i / 6
        g.box(-w / 2, w / 2, -0.08, 0.0, z - 0.05, z + 0.05, "stone", skip=("+y", "-x", "+x"))
    return g


def side_hall(g, poly, key_wall="brick"):
    """A one-storey side hall on a four-cornered plan: grey brick walls, a hard-gable roof of grey tiles along the
    long side, a red door and two windows on each long face."""
    pts = [Vector((x, y, 0)) for x, y in poly]
    e0, e1 = pts[1] - pts[0], pts[3] - pts[0]
    if e0.length < e1.length:
        pts = pts[1:] + pts[:1]
        e0, e1 = pts[1] - pts[0], pts[3] - pts[0]
    c = sum(pts, Vector()) / 4
    L, Wd = e0.length, e1.length
    ax, ay = e0.normalized(), e1.normalized()
    P = lambda u, v, z: c + ax * u + ay * v + Vector((0, 0, z))    # noqa: E731
    hl, hw, wall, rise, eave = L / 2 - 0.3, Wd / 2 - 0.3, 4.2, 3.8, 0.7
    for (u0, v0), (u1, v1), want in (((-hl, -hw), (hl, -hw), -ay), ((hl, hw), (-hl, hw), ay)):
        g.polyn([P(u0, v0, 0), P(u1, v1, 0), P(u1, v1, wall), P(u0, v0, wall)], key_wall, tuple(want))
    for su in (-1, 1):
        g.polyn([P(su * hl, -hw, 0), P(su * hl, hw, 0), P(su * hl, hw, wall), P(su * hl, 0, wall + rise), P(su * hl, -hw, wall)], key_wall, tuple(ax * su))
    for sv in (-1, 1):
        a, b = P(-hl - 0.4, sv * (hw + eave), wall - 0.35), P(hl + 0.4, sv * (hw + eave), wall - 0.35)
        top_a, top_b = P(-hl - 0.4, 0, wall + rise + 0.15), P(hl + 0.4, 0, wall + rise + 0.15)
        dz = Vector((0, 0, 0.22))
        up = tuple(ay * sv + Vector((0, 0, 1.5)))
        g.polyn([a, b, top_b, top_a], "tile", up)
        g.polyn([a - dz, b - dz, top_b - dz, top_a - dz], "tile", tuple(-Vector(up)))
        g.polyn([a, b, b - dz, a - dz], "tile", tuple(ay * sv))
        for p0, p1, su in ((a, top_a, -1), (b, top_b, 1)):
            g.polyn([p0, p1, p1 - dz, p0 - dz], "tile", tuple(ax * su))
        for x in (-hl * 0.55, 0.0, hl * 0.55):
            d = ay * sv * 0.03
            wd, ht, reg = (1.4, 2.5, "plaster") if x == 0.0 else (1.6, 1.3, "dark")
            z0 = 0.0 if x == 0.0 else 1.3
            g.polyn([P(x - wd / 2, sv * hw, z0) + d, P(x + wd / 2, sv * hw, z0) + d, P(x + wd / 2, sv * hw, z0 + ht) + d, P(x - wd / 2, sv * hw, z0 + ht) + d], reg, tuple(ay * sv))
    ridge = [P(-hl - 0.4, 0, wall + rise + 0.1), P(hl + 0.4, 0, wall + rise + 0.1)]
    sweep(g, ridge, 0.4, 0.35, key="tile")
    return c, ax, ay, hl, hw, wall + rise


def build_bell():
    clear_file()
    ensure_addon()
    M = make_materials("ZL", bell=True)
    main = collection("钟楼")
    H, B, PL = BELL, Z_BLOCK, PLINTH
    g = Geo()
    X, Y = pierced_block(g, B, "brick")
    h = B["h"]
    # the plinth: a stone step round the tower's foot, broken at each passage
    r_ns, r_ew = B["ns"][0][1] / 2, B["ew"][0][1] / 2
    for sy in (-1, 1):
        y0, y1 = sorted((sy * PL["hd"], sy * (B["hd"] - 0.05)))
        for x0, x1 in ((-PL["hw"], -r_ns), (r_ns, PL["hw"])):
            g.box(x0, x1, y0, y1, 0.0, PL["h"], "stone", skip=("-z",))
    for sx in (-1, 1):
        x0, x1 = sorted((sx * PL["hw"], sx * (B["hw"] - 0.05)))
        for y0, y1 in ((-B["hd"], -r_ew), (r_ew, B["hd"])):
            g.box(x0, x1, y0, y1, 0.0, PL["h"], "stone", skip=("-z",))
    # the stone cornice round the terrace and the white balustrade on it
    for x0, x1, y0, y1 in ((-X - 0.25, X + 0.25, -Y - 0.25, -Y + 0.3), (-X - 0.25, X + 0.25, Y - 0.3, Y + 0.25),
                           (-X - 0.25, -X + 0.3, -Y + 0.3, Y - 0.3), (X - 0.3, X + 0.25, -Y + 0.3, Y - 0.3)):
        g.box(x0, x1, y0, y1, h - 0.5, h + 0.02, "stone",)
    # the upper storey: brick walls, stone bands at the bracket foot, a band of brick between the brackets
    g.box(-H.OX, H.OX, -H.OY, H.OY, h, H.BEAM[0], "brick", skip=("-z", "+z"))
    g.box(-H.OX - 0.12, H.OX + 0.12, -H.OY - 0.12, H.OY + 0.12, H.BEAM[0], H.BEAM[1], "stone", skip=("-z",))
    g.box(-H.OX + 0.1, H.OX - 0.1, -H.OY + 0.1, H.OY - 0.1, H.BEAM[1], H.BEAM[3] + 0.1, "brick", skip=("-z", "+z"))
    g.box(-H.OX - 0.35, H.OX + 0.35, -H.OY - 0.35, H.OY + 0.35, h, h + 0.45, "stone", skip=("-z",))
    g.box(-H.IX, H.IX, -H.IY, H.IY, Z_UPPER0, H.UBEAM[0], "brick", skip=("-z", "+z"))
    g.box(-H.IX - 0.12, H.IX + 0.12, -H.IY - 0.12, H.IY + 0.12, H.UBEAM[0], H.UBEAM[1], "stone", skip=("-z",))
    g.box(-H.IX + 0.1, H.IX - 0.1, -H.IY + 0.1, H.IY - 0.1, H.UBEAM[1], H.UBEAM[3] + 0.1, "brick", skip=("-z", "+z"))
    door, win = arch_door(), stone_window()
    for rot, D in ((0, H.OY), (1, H.OX), (2, H.OY), (3, H.OX)):
        m = Rz(rot * math.pi / 2)
        g.add(door, m @ T(0, -D, h + 0.45))
        for u in (-5.6, 5.6):
            g.add(win, m @ T(u, -D, h + 4.6))
        g.add(stone_window(1.4, 1.6), m @ T(0, -(H.IY if rot % 2 == 0 else H.IX), Z_UPPER0 + 3.0))
    hips = roofs(H, g)
    g.build("BellTower", collection("钟楼", main), M, TILE)
    tris = g.tris()

    # the side halls on OSM's blocks against the east and west faces
    sg = Geo()
    halls = []
    for poly in SIDE_HALLS:
        halls.append(side_hall(sg, [local(x, z, Z_HEADING) for x, z in poly]))
    sg.build("SideHalls", collection("配房", main), M, TILE)

    parts = collection("构件", main)
    mesh = dict(
        bracket=mesh_of(grey_bracket(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze=GREEN, lite=True), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze=GREEN), "ImmortalMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=5)
    balustrade(parts, mesh, ring(X - 0.2, Y - 0.2, h + 0.02), "Rail", gap=1.9)

    far = Geo()
    far.box(-PL["hw"], PL["hw"], -PL["hd"], PL["hd"], 0.0, PL["h"], "stone", skip=("-z",))
    far.box(-B["hw"], B["hw"], -B["hd"], B["hd"], PL["h"], h, "brick", skip=("-z",))
    far.box(-H.OX, H.OX, -H.OY, H.OY, h, H.LOWER["z"] + 0.4, "brick", skip=("-z",))
    far.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "brick", skip=("-z",))
    roofs(H, far, lod=True)
    for c, ax, ay, hl, hw, top in halls:
        pts = [c + ax * su * hl + ay * sv * hw for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        up = Vector((0, 0, 4.2))
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            far.polyn([a, b, b + up, a + up], "brick", tuple((a + b) / 2 - c))
        rid = [c + ax * su * hl + Vector((0, 0, top)) for su in (-1, 1)]
        for sv in (-1, 1):
            ea, eb = c - ax * hl + ay * sv * hw + up, c + ax * hl + ay * sv * hw + up
            far.polyn([ea, eb, rid[1], rid[0]], "tile", tuple(ay * sv + Vector((0, 0, 1.5))))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    block_colliders(helpers, B, "block")
    ns, ew = B["ns"][0], B["ew"][0]
    for x0, x1, y0, y1 in ((-PL["hw"], ns[0] - ns[1] / 2, -PL["hd"], -B["hd"]), (ns[0] + ns[1] / 2, PL["hw"], -PL["hd"], -B["hd"]),
                           (-PL["hw"], ns[0] - ns[1] / 2, B["hd"], PL["hd"]), (ns[0] + ns[1] / 2, PL["hw"], B["hd"], PL["hd"]),
                           (-PL["hw"], -B["hw"], -B["hd"], ew[0] - ew[1] / 2), (-PL["hw"], -B["hw"], ew[0] + ew[1] / 2, B["hd"]),
                           (B["hw"], PL["hw"], -B["hd"], ew[0] - ew[1] / 2), (B["hw"], PL["hw"], ew[0] + ew[1] / 2, B["hd"])):
        collider_box(helpers, "plinth", x0, x1, y0, y1, 0.0, PL["h"])
    collider_box(helpers, "hall", -H.OX - 0.5, H.OX + 0.5, -H.OY - 0.5, H.OY + 0.5, h, 45.0)
    for k, (c, ax, ay, hl, hw, top) in enumerate(halls):
        pts = [c + ax * su * hl + ay * sv * hw + Vector((0, 0, z)) for su in (-1, 1) for sv in (-1, 1) for z in (0.0, 4.2)]
        collider_pts(helpers, f"sidehall{k}", [tuple(p) for p in pts])
    flat_marker(helpers, "bell", rect(-PL["hw"] - 0.6, PL["hw"] + 0.6, -PL["hd"] - 0.6, PL["hd"] + 0.6), "FOOTPRINT")
    for k, poly in enumerate(SIDE_HALLS):
        flat_marker(helpers, f"side{k}", [local(x, z, Z_HEADING) for x, z in poly], "FOOTPRINT")
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "zhonglou", "钟楼", "Bell Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -677.1, -3583.575, Z_HEADING
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots))


if __name__ == "__main__":
    if ONLY in (None, "drum"):
        print("drum", build_drum())
        save_and_export(os.path.join(REPO, "art", "landmarks", "gulou.blend"), argv)
    if ONLY in (None, "bell"):
        print("bell", build_bell())
        save_and_export(os.path.join(REPO, "art", "landmarks", "zhonglou.blend"), argv)
