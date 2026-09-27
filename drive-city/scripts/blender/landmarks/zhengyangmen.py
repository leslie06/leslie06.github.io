# 正阳门 (前门): the gate tower and, 190 m south, its arrow tower (箭楼), the south end of Tian'anmen
# Square, built in Blender with the timber hall of hall.py (the roofs, brackets and beams of 天安门) and
# marked with the bcity_landmark add-on's conventions. They replace the kit-built zhengyangmen.ts.
#
#   blender -b -P scripts/blender/landmarks/zhengyangmen.py -- [--export] [--only gate|arrow]
#
# It builds two files one after the other, each its own landmark (ids zhengyangmen and jianlou, as before):
# art/landmarks/zhengyangmen.blend and art/landmarks/jianlou.blend. The plaque needs Noto Serif SC Bold in
# .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres. The gate tower's origin is the centre of its platform at the
# old anchor (39.899184 N, 116.391618 E, heading -1.41); the arrow tower's is the centre of its keep, 6 m
# south of the old anchor (39.8979161 N, 116.3916608 E, heading -1.45), so the hall code stays centred.
#
# The figures are the old model's (from photographs and published dimensions):
#   - the gate tower: a grey brick platform 100 x 31 m, 14.7 m, battered, one gateway, crenellated to the
#     south and a low parapet to the north; a seven by three bay tower in two storeys with a colonnade round
#     the ground floor, red walls below and lattice above, the 正阳门 plaque, a double-eaved 歇山 roof of grey
#     tiles edged in green glaze (灰筒瓦绿琉璃剪边) with green ridges and beasts; 42 m overall;
#   - the arrow tower: a 12 m platform with a white balustrade, a 58 x 19 m brick keep with rows of arrow
#     windows (the lower two under the white arched hoods of 1915), a skirt roof, an upper storey with one
#     row, the 歇山 roof over it; on the north a five-bay open 抱厦 under its own 歇山, and the 1915 stairs.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, collider_pts, coping, flat_marker, mesh_of,  # noqa: E402
                 panel_geo, paving, place, post_geo, rect)
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, to_world, uvs)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
GREEN = "#2e7d57"

# --- the gate tower ------------------------------------------------------------------------------------
GP = dict(hw=50.0, hd=15.7, h=14.7, batter=1.1, arch=(6.6, 9.6), base=1.2)
G_BASE = dict(hw=23.8, hd=13.8, z0=14.7, z1=15.6)
GATE = SimpleNamespace(
    XS=[-20.5, -17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5, 20.5], YS=[-10.5, -7.5, -2.5, 2.5, 7.5, 10.5],
    OX=20.5, OY=10.5, IX=17.5, IY=7.5, BEAM=(21.6, 22.35, 22.55, 23.45), UBEAM=(31.2, 31.95, 32.15, 33.05), OVERHANG=3.3,
    LOWER=dict(A=23.8, D=13.8, z=22.9, H=3.0, p=1.3, o=1.0, lift=0.9, Lc=7.5, Vc=4.2),
    UPPER=dict(A=20.8, D=10.8, z=32.6, H=6.2, p=1.6, o=0.95, lift=0.95, Lc=7.0, Vc=4.2),
    GABLE_X=16.0, PITCH=0.42, AMP=0.09, TRIM=1.4, RIDGE="trim")
G_COL_TOP, G_UPPER0 = 21.6, 25.3

# --- the arrow tower (origin at the keep's centre) -----------------------------------------------------
AP = dict(hw=31.0, hd=18.2, h=12.0, batter=1.4, arch=(6.2, 9.0), base=0.0, cy=6.0)   # platform centre 6 m north
KEEP = dict(hw=29.0, hd=9.4, top=26.6)
ARROW = SimpleNamespace(
    XS=[-29.0, -27.4, 27.4, 29.0], YS=[-9.4, -7.8, 7.8, 9.4], OX=29.0, OY=9.4, IX=27.4, IY=7.8,
    BEAM=(25.9, 26.6, 26.6, 27.5), UBEAM=(32.6, 33.2, 33.2, 34.1), OVERHANG=2.7,
    LOWER=dict(A=31.6, D=12.0, z=27.2, H=2.6, p=1.2, o=0.8, lift=0.7, Lc=6.0, Vc=3.0),
    UPPER=dict(A=30.2, D=10.6, z=33.7, H=5.2, p=1.6, o=0.95, lift=0.95, Lc=7.0, Vc=4.0),
    GABLE_X=25.9, PITCH=0.42, AMP=0.09, TRIM=1.4, RIDGE="trim")
# the 抱厦: five open bays against the keep's north face, under a single-eaved 歇山 (centred on BAOSHA_Y)
BAOSHA_Y = 15.8
BAOSHA = SimpleNamespace(
    XS=[x * 0.97 for x in (-21.0, -12.6, -4.2, 4.2, 12.6, 21.0)], YS=[-6.2, -0.2, 6.2], OX=20.37, OY=6.2, IX=20.37, IY=6.2,
    BEAM=(19.2, 19.95, 20.15, 21.05), UBEAM=(19.2, 19.95, 20.15, 21.05), OVERHANG=2.7, LOWER=None,
    UPPER=dict(A=23.1, D=8.9, z=20.6, H=4.2, p=1.5, o=0.8, lift=0.8, Lc=6.0, Vc=3.5),
    GABLE_X=17.0, PITCH=0.42, AMP=0.09, TRIM=1.4, RIDGE="trim")
WIN_S = [-25.2 + i * 4.2 for i in range(13)]
WIN_E = [6.5, 1.8, -2.9, -7.2]
WIN_ROWS = [(15.4, True), (19.6, True), (23.8, False)]


def brick_image(name="ZYM_Brick", size=512):
    """Grey city-wall brick, 4 m a repeat: 0.48 x 0.12 m bricks in running bond, each a slightly different grey."""
    cv = Canvas(size, size, "#7b7e80")
    rng = np.random.default_rng(31)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    col = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    tint = rng.uniform(0.86, 1.08, (40, 12))
    cv.a *= tint[row % 40, col % 12][..., None]
    joint = (np.mod(cv.y, bh) < 1.6) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.6)
    cv.put(joint, "#a3a5a2")
    cv.noise(0.06, 32)
    return image(name, np.flipud(cv.a).copy())


def make_materials(prefix):
    atlas, night = paint_atlas(prefix, portrait=False, emblem=False)
    return dict(
        atlas=material(f"{prefix}_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material(f"{prefix}_Plaster", "#a8321f", 0.85, tex=plaster(name=f"{prefix}_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        brick=material(f"{prefix}_Brick", "#7b7e80", 0.9, tex=brick_image(f"{prefix}_BrickTex"), props={"wet": "damp", "glowStrength": 0.8}),
        stone=material(f"{prefix}_Stone", "#b9b4aa", 0.75, props={"wet": "damp"}),
        paving=material(f"{prefix}_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
        tile=material(f"{prefix}_Tile", "#5d6164", 0.6, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material(f"{prefix}_Trim", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.6}),
        marble=material(f"{prefix}_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        red=material(f"{prefix}_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material(f"{prefix}_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material(f"{prefix}_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material(f"{prefix}_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
        board=material(f"{prefix}_Board", "#1d3f7a", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
    )


TILE = dict(plaster=4.0, brick=4.0, stone=2.0, paving=4.0, tile=2.0, trim=2.0, marble=2.0, red=2.0, gold=1.0, paint=1.0, dark=1.0, board=1.0)


# --- the platform ------------------------------------------------------------------------------------

def gate_platform(g, P, cy=0.0):
    """A battered brick platform with one vaulted gateway through it, a stone base course, the paved top."""
    hw, hd, h, bat = P["hw"], P["hd"], P["h"], P["batter"]
    w, crown = P["arch"]
    zb = P["base"]
    yf = lambda z: cy - (hd - bat * z / h)          # noqa: E731  (the south face)
    yb = lambda z: cy + (hd - bat * z / h)          # noqa: E731
    xs = lambda z: hw - bat * z / h                 # noqa: E731
    r = w / 2
    spring = crown - r
    arc = [(r * math.cos(math.pi * (1 - i / 14)), spring + r * math.sin(math.pi * (1 - i / 14))) for i in range(15)]
    if zb:
        for x0, x1 in ((-hw - 0.3, -r), (r, hw + 0.3)):
            g.box(x0, x1, cy - hd - 0.3, cy - hd + 0.4, 0.0, zb, "stone", skip=("-z",))
            g.box(x0, x1, cy + hd - 0.4, cy + hd + 0.3, 0.0, zb, "stone", skip=("-z",))
        for sx in (-1, 1):
            g.box(min(sx * (hw - 0.4), sx * (hw + 0.3)), max(sx * (hw - 0.4), sx * (hw + 0.3)), cy - hd - 0.3, cy + hd + 0.3, 0.0, zb, "stone", skip=("-z",))
    for Y, side in ((yf, -1), (yb, 1)):
        want = (0, side, 0)
        g.polyn([(-xs(zb), Y(zb), zb), (-r, Y(zb), zb), (-r, Y(h), h), (-xs(h), Y(h), h)], "brick", want)
        g.polyn([(r, Y(zb), zb), (xs(zb), Y(zb), zb), (xs(h), Y(h), h), (r, Y(h), h)], "brick", want)
        g.polyn([(x, Y(z), z) for x, z in arc] + [(r, Y(h), h), (-r, Y(h), h)], "brick", want)
        if zb:
            g.polyn([(-r, Y(0), 0.0), (-r, Y(zb), zb), (-r - 0.01, Y(zb), zb)], "brick", want)
    for sx in (-1, 1):
        g.polyn([(sx * xs(zb), yf(zb), zb), (sx * xs(zb), yb(zb), zb), (sx * xs(h), yb(h), h), (sx * xs(h), yf(h), h)], "brick", (sx, 0, 0))
    g.polyn([(-xs(h), yf(h), h), (xs(h), yf(h), h), (xs(h), yb(h), h), (-xs(h), yb(h), h)], "paving", (0, 0, 1))
    sec = [(-r, 0.0)] + arc + [(r, 0.0)]
    for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        g.polyn([(x0, yf(z0), z0), (x1, yf(z1), z1), (x1, yb(z1), z1), (x0, yb(z0), z0)], "brick", (-mx, 0, spring - mz if mz > spring else 0),
                smooth=z0 > spring - 1e-3 and z1 > spring - 1e-3)
    yd = cy - hd * 0.3
    for sx in (-1, 1):
        x = sx * (r - 0.07)
        g.polyn([(x, yd, 0.02), (x, yd + r, 0.02), (x, yd + r, spring), (x, yd, spring)], "atlas", (-sx, 0, 0), uvs=uvs("gatedoor", QUAD))
    return xs(h), yf(h), yb(h)


def battlements(g, x0, x1, y, z, t=0.9, h=1.9, merlon=2.2, gap=0.8, key="brick"):
    """A crenellated parapet along y from x0 to x1: a 1 m wall with merlons on it."""
    g.box(x0, x1, y - t / 2, y + t / 2, z, z + 1.0, key, skip=("-z",))
    n = int((x1 - x0) // (merlon + gap))
    pad = (x1 - x0 - n * (merlon + gap) + gap) / 2
    for i in range(n):
        a = x0 + pad + i * (merlon + gap)
        g.box(a, a + merlon, y - t / 2, y + t / 2, z + 1.0, z + h, key, skip=("-z",))


def plaque(g, font, text, x, y, z, M, coll, name, face=-1):
    """The gate's name board: blue, a gilt frame, gilt characters reading down. `face` -1 south, +1 north."""
    w, h = 1.7, 3.6
    f = face
    g.polyn([(x - w / 2, y, z - h / 2), (x + w / 2, y, z - h / 2), (x + w / 2, y, z + h / 2), (x - w / 2, y, z + h / 2)], "board", (0, f, 0))
    ya, yb = sorted((y + f * 0.08, y - f * 0.12))
    for za, zb in ((z - h / 2 - 0.15, z - h / 2), (z + h / 2, z + h / 2 + 0.15)):
        g.box(x - w / 2 - 0.15, x + w / 2 + 0.15, ya, yb, za, zb, "gold")
    for sx in (-1, 1):
        g.box(x + sx * (w / 2) - 0.15 * (sx < 0), x + sx * (w / 2) + 0.15 * (sx > 0), ya, yb, z - h / 2, z + h / 2, "gold")
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = "\n".join(text), font, 1.0, 0.05
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_line = 0.82                     # the characters close together, filling the board
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min((h - 0.5) / (max(ys) - min(ys)), (w - 0.3) / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    # the text's XY plane stood upright facing out (its +Z towards the viewer), reading left to right
    m = T(x, y + f * 0.1, z) @ Matrix.Rotation(0.0 if f < 0 else math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, v.co.z))
    me.materials.append(M["gold"])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)


def hall_parts(M):
    return dict(
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze=GREEN), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze=GREEN), "ImmortalMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )


def ceiling(g, x0, x1, y0, y1, z):
    nx, ny = max(1, round((x1 - x0) / 1.3)), max(1, round((y1 - y0) / 1.3))
    for i in range(nx):
        for j in range(ny):
            a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            b0, b1 = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
            g.polyn([(a0, b0, z), (a1, b0, z), (a1, b1, z), (a0, b1, z)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))


def steps_ramp(coll, name, x0, x1, y_top, y_low, z_top, z_low=0.0):
    """A walk-only ramp over a flight of steps (people climb it, cars do not)."""
    import bcity_landmark
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y_top, z_top), (x1, y_top, z_top), (x1, y_low, z_low), (x0, y_low, z_low), (x0, y_top, z_low), (x1, y_top, z_low)], [],
                   [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, "WALK")


# --- the gate tower -------------------------------------------------------------------------------------

def build_gate():
    clear_file()
    ensure_addon()
    M = make_materials("ZYM")
    main = collection("正阳门")
    H = GATE
    g = Geo()
    X, YF, YB = gate_platform(g, GP)
    # parapets: battlements to the south (outside the city), a low wall with a tiled coping to the north
    battlements(g, -X, X, YF + 0.45, GP["h"])
    g.box(-X, X, YB - 0.9, YB, GP["h"], GP["h"] + 1.1, "brick", skip=("-z",))
    coping(g, (-X, YB - 0.45), (X, YB - 0.45), 1.2, GP["h"] + 1.1, key="trim")
    for sx in (-1, 1):
        g.box(min(sx * (X - 0.9), sx * X), max(sx * (X - 0.9), sx * X), YF + 0.9, YB - 0.9, GP["h"], GP["h"] + 1.1, "brick", skip=("-z",))
    b = G_BASE
    g.box(-b["hw"], b["hw"], -b["hd"], b["hd"], b["z0"], b["z1"], "brick", skip=("-z", "+z"))
    g.polyn([(-b["hw"], -b["hd"], b["z1"]), (b["hw"], -b["hd"], b["z1"]), (b["hw"], b["hd"], b["z1"]), (-b["hw"], b["hd"], b["z1"])], "paving", (0, 0, 1))
    # the ground floor behind the colonnade: red walls, a door in the middle bay front and back
    z0 = b["z1"]
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            front = rot in (0, 2) and i == (len(us) - 2) // 2
            if front:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("door", QUAD))
            else:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "plaster", cdir(rot, 0, -1))
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)        # noqa: E731
            g.polyn([Q(us[i], H.BEAM[0]), Q(us[i + 1], H.BEAM[0]), Q(us[i + 1], H.BEAM[1]), Q(us[i], H.BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            # the upper storey: lattice all round
            g.polyn([P(us[i], G_UPPER0), P(us[i + 1], G_UPPER0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("window", QUAD))
    ring_beams(H, g, True, *H.BEAM)
    ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        ceiling(g, x0, x1, y0, y1, H.BEAM[1])
    hips = roofs(H, g)
    g.build("GateTower", collection("城楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = hall_parts(M)
    col = mesh_of(column_geo(G_COL_TOP - z0), "ColumnMesh", M, TILE)
    ucol = mesh_of(column_geo(H.UBEAM[0] - G_UPPER0 + 0.6, r=0.38), "UpperColumnMesh", M, TILE)
    n = 0
    for outer in (True, False):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(col, f"Column.{n:03d}", parts, T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(ucol, f"UpperColumn.{n:03d}", parts, T(*to_world(rot, D, u, 0, G_UPPER0 - 0.6)))
                n += 1
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=8)
    font = bpy.data.fonts.load(FONT)
    g2 = Geo()
    for f in (-1, 1):       # on both faces: the square sees the north one, 前门大街 the south
        plaque(g2, font, "正阳门", 0.0, f * (H.IY + 0.62), (G_UPPER0 + H.UBEAM[0]) / 2 + 0.6, M, collection("匾", main), f"Plaque{'N' if f > 0 else 'S'}", face=f)
    g2.build("PlaqueBoard", collection("匾", main), M, TILE)

    far = Geo()
    far.box(-GP["hw"], GP["hw"], -GP["hd"], GP["hd"], 0.0, GP["h"], "brick", skip=("-z",))
    far.box(-H.OX, H.OX, -H.OY, H.OY, z0, H.LOWER["z"] + 0.4, "plaster", skip=("-z",))
    far.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(H, far, lod=True)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    w, crown = GP["arch"]
    top = GP["h"] + 1.9
    collider_box(helpers, "pierW", -GP["hw"], -w / 2, -GP["hd"], GP["hd"], 0.0, top)
    collider_box(helpers, "pierE", w / 2, GP["hw"], -GP["hd"], GP["hd"], 0.0, top)
    collider_box(helpers, "lintel", -w / 2, w / 2, -GP["hd"], GP["hd"], crown, top)
    collider_box(helpers, "tower", -b["hw"], b["hw"], -b["hd"], b["hd"], b["z0"], 40.0)
    flat_marker(helpers, "gate", rect(-GP["hw"] - 0.6, GP["hw"] + 0.6, -GP["hd"] - 0.6, GP["hd"] + 0.6), "FOOTPRINT")
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "zhengyangmen", "正阳门城楼", "Zhengyangmen Gate Tower"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.899184", "116.391618", -1.41
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots))


# --- the arrow tower ------------------------------------------------------------------------------------

def arrow_window(hood):
    """An arrow window: a dark opening in a white frame with a sill, and on the 1915 rows an arched hood."""
    g = Geo()
    g.polyn([(-0.55, 0.0, -0.6), (0.55, 0.0, -0.6), (0.55, 0.0, 0.6), (-0.55, 0.0, 0.6)], "dark", (0, -1, 0))
    g.box(-0.75, 0.75, -0.2, 0.02, -0.8, -0.64, "marble")
    for sx in (-1, 1):
        g.box(sx * 0.66 - 0.08, sx * 0.66 + 0.08, -0.14, 0.02, -0.64, 0.66, "marble", skip=("+y",))
    if hood:
        pts = [(0.95 * math.cos(math.pi * i / 10), 0.66 + 0.4 * math.sin(math.pi * i / 10)) for i in range(11)]
        inner = [(0.72 * math.cos(math.pi * i / 10), 0.66 + 0.22 * math.sin(math.pi * i / 10)) for i in range(11)]
        for (a, b), (c, d) in zip(zip(pts, pts[1:]), zip(inner, inner[1:])):
            g.polyn([(a[0], -0.16, a[1]), (b[0], -0.16, b[1]), (d[0], -0.16, d[1]), (c[0], -0.16, c[1])], "marble", (0, -1, 0))
            g.poly([(a[0], -0.16, a[1]), (b[0], -0.16, b[1]), (b[0], 0.02, b[1]), (a[0], 0.02, a[1])], "marble")
    else:
        g.box(-0.75, 0.75, -0.14, 0.02, 0.66, 0.8, "marble", skip=("+y",))
    return g


def build_arrow():
    clear_file()
    ensure_addon()
    M = make_materials("JL")
    main = collection("箭楼")
    H, K = ARROW, KEEP
    g = Geo()
    X, YF, YB = gate_platform(g, AP, cy=AP["cy"])
    zt = AP["h"]
    # the keep: brick from the platform to the bracket band, a plinth course at its foot
    g.box(-K["hw"], K["hw"], -K["hd"], K["hd"], zt, H.BEAM[0], "brick", skip=("-z", "+z"))
    g.box(-K["hw"] - 0.25, K["hw"] + 0.25, -K["hd"] - 0.25, K["hd"] + 0.25, zt, zt + 0.8, "brick", skip=("-z",))
    ring_beams(H, g, True, *H.BEAM)
    # the upper storey: brick again, inset, to the upper bracket band
    zu = H.LOWER["z"] + H.LOWER["H"] - 0.4
    g.box(-H.IX, H.IX, -H.IY, H.IY, zu, H.UBEAM[0], "brick", skip=("-z", "+z"))
    ring_beams(H, g, False, *H.UBEAM)
    hips = roofs(H, g)
    # the 抱厦: five open bays under its own roof, against the keep's north face
    B = BAOSHA
    gb = Geo()
    ring_beams(B, gb, True, *B.BEAM)
    ceiling(gb, -B.OX, B.OX, -B.OY, B.OY, B.BEAM[1])
    bhips = roofs(B, gb)
    mb = T(0, BAOSHA_Y, 0)
    g.add(gb, mb)
    bhips = [[mb @ p for p in line] for line in bhips]
    # the 1915 stairs up the north face, one flight each side, balustraded on the outside
    ys0 = YB + 0.3
    for sx in (-1, 1):
        n, run, wd = 34, 16.0, 2.6
        for i in range(n):
            xa, xb = sorted((sx * (6.0 + i * run / n), sx * (6.0 + (i + 1) * run / n)))
            g.box(xa, xb, ys0, ys0 + wd, 0.0, (i + 1) * zt / n, "stone", skip=("-z",))
    # the platform's white balustrade
    g.build("ArrowTower", collection("箭楼", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    mesh = hall_parts(M)
    ring = [(-X + 0.4, YF + 0.4, zt), (X - 0.4, YF + 0.4, zt), (X - 0.4, YB - 0.4, zt), (-X + 0.4, YB - 0.4, zt), (-X + 0.4, YF + 0.4, zt)]
    balustrade(parts, mesh, ring, "Rail", gap=1.9, skip=[(-K["hw"] - 1, K["hw"] + 1, -K["hd"] - 1.5, BAOSHA_Y + B.OY + 1.0)])
    for sx in (-1, 1):
        pts = [(sx * 6.0, YB + 0.3 + 2.45, 0.0), (sx * 22.0, YB + 0.3 + 2.45, zt)]
        balustrade(parts, mesh, pts, f"StairRail{sx:+d}", gap=2.0)
    col = mesh_of(column_geo(B.BEAM[0] - zt, r=0.4), "ColumnMesh", M, TILE)
    n = 0
    for rot, D, us in ring_sides(B, True):
        for u in us[1:]:
            p = to_world(rot, D, u, 0, zt) + Vector((0, BAOSHA_Y, 0))
            if p.y < K["hd"] + 0.5:
                continue                      # the keep's wall stands there
            place(col, f"Column.{n:03d}", parts, T(*p))
            n += 1
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    spots += [(p + Vector((0, BAOSHA_Y, 0)), yaw) for p, yaw in bracket_spots(B, True, B.BEAM[2])]
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips + bhips):
        beasts_on(line, parts, mesh, f"Beast{i}", n=6 if i >= len(hips) else 8)
    wins = dict(hood=mesh_of(arrow_window(True), "WindowHood", M, TILE), plain=mesh_of(arrow_window(False), "Window", M, TILE))
    k = 0
    for z, hood in WIN_ROWS + [(zu + 1.9, False)]:
        upper = z > zu
        sx_ = H.IX / K["hw"] if upper else 1.0
        hw, hd = (H.IX, H.IY) if upper else (K["hw"], K["hd"])
        me = wins["hood" if hood else "plain"]
        for x in WIN_S:
            place(me, f"Win.{k:03d}", parts, T(x * sx_, -hd - 0.02, z))
            k += 1
        for sx in (-1, 1):
            for y in (WIN_E if not upper else [5.4, 1.8, -1.8, -5.4]):
                place(me, f"Win.{k:03d}", parts, T(sx * (hw + 0.02), y, z) @ Rz(sx * math.pi / 2))
                k += 1

    far = Geo()
    far.box(-AP["hw"], AP["hw"], AP["cy"] - AP["hd"], AP["cy"] + AP["hd"], 0.0, zt, "brick", skip=("-z",))
    far.box(-K["hw"], K["hw"], -K["hd"], K["hd"], zt, H.LOWER["z"] + 0.4, "brick", skip=("-z",))
    far.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "brick", skip=("-z",))
    roofs(H, far, lod=True)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    w, crown = AP["arch"]
    cy, hd = AP["cy"], AP["hd"]
    collider_box(helpers, "pierW", -AP["hw"], -w / 2, cy - hd, cy + hd, 0.0, zt)
    collider_box(helpers, "pierE", w / 2, AP["hw"], cy - hd, cy + hd, 0.0, zt)
    collider_box(helpers, "lintel", -w / 2, w / 2, cy - hd, cy + hd, crown, zt)
    collider_box(helpers, "keep", -K["hw"], K["hw"], -K["hd"], K["hd"], zt, 38.0)
    collider_box(helpers, "baosha", -B.OX - 0.5, B.OX + 0.5, K["hd"], BAOSHA_Y + B.OY + 0.5, B.BEAM[0], 25.0)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 6.0, sx * 22.0))
        me_pts = [(sx * 6.0, ys0, 0.0), (sx * 6.0, ys0 + 2.6, 0.0), (sx * 22.0, ys0, zt), (sx * 22.0, ys0 + 2.6, zt), (sx * 22.0, ys0, 0.0), (sx * 22.0, ys0 + 2.6, 0.0)]
        collider_pts(helpers, f"stairs{sx:+d}", me_pts, role="WALK")
    flat_marker(helpers, "arrow", rect(-AP["hw"] - 0.6, AP["hw"] + 0.6, cy - hd - 0.6, ys0 + 3.2), "FOOTPRINT")
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "jianlou", "正阳门箭楼", "Zhengyangmen Arrow Tower"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.8979161", "116.3916608", -1.45
    s.repo_path = REPO
    return dict(tris=tris, brackets=len(spots), windows=k)


if __name__ == "__main__":
    if ONLY in (None, "gate"):
        print("gate", build_gate())
        save_and_export(os.path.join(REPO, "art", "landmarks", "zhengyangmen.blend"), argv)
    if ONLY in (None, "arrow"):
        print("arrow", build_arrow())
        save_and_export(os.path.join(REPO, "art", "landmarks", "jianlou.blend"), argv)
