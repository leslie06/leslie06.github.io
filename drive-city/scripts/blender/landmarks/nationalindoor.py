# 国家体育馆 National Indoor Stadium, "the folding fan" (Glöckner³ / BIAD, 2007; the north ice hall 2021), built
# in Blender and marked with the bcity_landmark add-on's conventions. OSM way 55883993 (leisure=stadium) is its
# outline - a 133 x 207 m block with a 100 x 42 m wing on its north end - turned 2.0 degrees off north (the
# Olympic axis); the centre of the block's box is game (-1163.6, -9602.45) = 39.9952903 N, 116.3839435 E. Its
# building:parts (1459384218-225, 1459384795) give the roof stepping 27 / 29 / 27 / 23 m from south to north and
# 14.5-20 m over the wing; the city drew them as glass blocks.
#
#   blender -b -P scripts/blender/landmarks/nationalindoor.py -- [--out art/landmarks/nationalindoor.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the block's box centre.
#
# The published figures: 42.47 m high; the main hall's steel roof 144 m north-south by 114 m east-west (a
# two-way cable-strung truss grid), the warm-up hall under the same roof to the north; the roof "由南向北的波浪式
# 造型", the folding fan; low-E glass and metal-panel curtain walls all round, photovoltaic panels on the roof
# and in part of the south glass. Here: the roof is one surface rising in waves from the south - a low eave over
# the south front, the crest (42.4 m) over the arena, a trough, a smaller second crest over the warm-up hall
# and down to the north eave - cambered a little to its east and west edges, overhanging the walls by 6 m on
# the long sides and 8 m to the south, with a 2.4 m silver fascia and a pale slatted soffit; on top, the
# standing seams run north-south like a fan's ribs, with PV bands. The walls are the kit's curtain-wall shader:
# a lit lobby storey, metal-panel spandrels above, dark PV glass in the south front's upper half; steel mullion
# fins every 8.6 m; 国家体育馆 / NATIONAL INDOOR STADIUM over the south entrance under a canopy. The north wing
# (the 2021 ice-hockey hall, "冰堡" glass) is an 18 m box of pale patterned glass. A 0.6 m granite plinth runs
# round both, steps (walk-only ramps) at the south and east entrances, a paved plaza out to the paths.
# Doubtful: the roof's exact wave (the OSM parts and the 42.47 m figure put the crest over the arena, south of
# the middle); where the entrances are; the wing's height.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, collider_box, collider_pts, flat_marker, paving, rect  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "nationalindoor.blend")
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_FALLBACK = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = -1163.6, -9602.45, -2.0
X0, X1, Y0, Y1 = -67.2, 65.7, -124.1, 82.6      # the main block's walls
WX0, WX1, WY1 = -55.7, 44.0, 124.9               # the north wing (from Y1 to WY1)
WING_H = 18.0
OV_EW, OV_S, OV_N = 6.0, 8.0, 4.0                # the roof's overhang
RX0, RX1, RY0, RY1 = X0 - OV_EW, X1 + OV_EW, Y0 - OV_S, Y1 + OV_N
FASCIA = 2.4
CAMBER = 1.3                                     # how much lower the roof's east and west edges are than its middle
PL, PLW = 0.6, 6.0                               # plinth height, its width round the walls
# the roof's wave along y (south to north): knots (y, height of the top at the middle), eased between
WAVE = [(RY0, 31.0), (-56.0, 42.4), (8.0, 34.4), (44.0, 36.6), (RY1, 27.2)]
NX, NY = 14, 60                                   # roof grid
FIN = 8.6                                         # mullion fin spacing on the long walls
# entrances: (side, centre along the wall, width) - steps up the plinth
DOORS = [("s", -0.75, 36.0), ("e", -40.0, 24.0)]
PLAZA = [rect(X0 - 22.0, X1 + 17.0, Y0 - 24.0, Y1 + 10.0), rect(WX0 - 7.0, WX1 + 6.0, Y1 + 10.0, WY1 + 7.0)]


def ease(t):
    return (1 - math.cos(math.pi * t)) / 2


def h_mid(y):
    """The roof top's height on its middle line at y."""
    if y <= WAVE[0][0]:
        return WAVE[0][1]
    for (ya, ha), (yb, hb) in zip(WAVE, WAVE[1:]):
        if y <= yb:
            return ha + (hb - ha) * ease((y - ya) / (yb - ya))
    return WAVE[-1][1]


def h_top(x, y):
    xm = (RX1 - RX0) / 2
    xc = (RX1 + RX0) / 2
    return h_mid(y) - CAMBER * ((x - xc) / xm) ** 2


def h_soffit(x, y):
    return h_top(x, y) - FASCIA


# --- textures ------------------------------------------------------------------------------------------

def roof_image():
    """The roof's top: silver standing seams running north-south every 0.5 m (u across), and a band of dark
    PV panels; 8 m a repeat across (u), 8 m along (v)."""
    cv = Canvas(256, 256, "#c3c6c6")
    cv.noise(0.05, 5)
    cv.put(np.mod(cv.x, 16) < 2.2, "#9ea2a3")
    cv.put(np.mod(cv.x, 16) > 14.5, "#d8dada")
    return image("NIS_RoofSeams", np.flipud(cv.a).copy())


def pv_image():
    cv = Canvas(256, 256, "#2c3a52")
    cv.noise(0.06, 6)
    cv.put((np.mod(cv.x, 32) < 2) | (np.mod(cv.y, 52) < 2), "#b8bec4")
    return image("NIS_PV", np.flipud(cv.a).copy())


def soffit_image():
    """The soffit: pale aluminium slats every 0.25 m across, a joint every 4 m."""
    cv = Canvas(128, 128, "#d9dcdc")
    cv.put(np.mod(cv.x, 8) < 1.4, "#a8adaf")
    cv.put(cv.y < 2, "#9da1a3")
    return image("NIS_Soffit", np.flipud(cv.a).copy())


def granite_image(size=256):
    rng = np.random.default_rng(5)
    a = np.empty((size, size, 3), np.float32)
    a[:] = (0.73, 0.72, 0.69)
    a *= (0.92 + 0.16 * rng.random((size, size, 1))).astype(np.float32)
    v = np.arange(size)
    a[(v % (size // 2)) < 2, :] *= 0.75
    a[:, (v % (size // 2)) < 2] *= 0.75
    return image("NIS_Granite", a)


def materials():
    base = dict(frame="#c9cfd3", mull=0.05, slab=0.08, metal=0.75, rough=0.08, warm="#ffd9a8", coolShare=0.25)
    return dict(
        glass=facade("NIS_Glass", dict(base, floorH=4.5, colW=1.5, glass="#56707f", spandrel="#b9c1c6", lit=0.45, seed=31)),
        lobby=facade("NIS_Lobby", dict(base, floorH=6.0, colW=2.15, glass="#4d6270", spandrel="#c9cfd3", lit=0.75, seed=32)),
        pv=facade("NIS_PVGlass", dict(base, floorH=3.0, colW=1.5, glass="#26344a", frame="#8f98a0", spandrel="#26344a", lit=0.2, seed=33)),
        ice=facade("NIS_IceGlass", dict(base, floorH=3.6, colW=1.2, glass="#9db7c4", frame="#e3eaee", spandrel="#cfdde4", lit=0.5, coolShare=0.9, seed=34)),
        roof=material("NIS_Roof", "#c3c6c6", 0.4, metal=0.6, tex=roof_image(), props={"wet": "surface", "glow": "none"}),
        pvroof=material("NIS_PVRoof", "#2c3a52", 0.25, metal=0.5, tex=pv_image(), props={"wet": "surface", "glow": "none"}),
        fascia=material("NIS_Fascia", "#d4d8da", 0.3, metal=0.75, props={"wet": "surface", "glowStrength": 1.0}),
        soffit=material("NIS_Soffit", "#d9dcdc", 0.5, metal=0.3, tex=soffit_image(), props={"wet": "none", "glowStrength": 0.7}),
        steel=material("NIS_Steel", "#aeb4b8", 0.35, metal=0.8, props={"wet": "surface", "glowStrength": 0.6}),
        flat=material("NIS_FlatRoof", "#9a9c9b", 0.85, props={"wet": "ground", "glow": "none"}),
        granite=material("NIS_Granite", "#bab8b0", 0.7, tex=granite_image(), props={"wet": "ground", "glowStrength": 0.4}),
        pave=material("NIS_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        letters=material("NIS_Letters", "#f2f4f5", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#dcecff", "glowStrength": 0.8}),
    )


TILE = dict(granite=2.0, pave=4.0, fascia=3.0, steel=2.0, flat=4.0)
FACADE_KEYS = ("glass", "lobby", "pv", "ice")


# --- geometry ------------------------------------------------------------------------------------------

def roof(g, nx=NX, ny=NY, detail=True):
    """The roof top, the fascia round its edge and the soffit under it."""
    xs = [RX0 + (RX1 - RX0) * i / nx for i in range(nx + 1)]
    ys = [RY0 + (RY1 - RY0) * j / ny for j in range(ny + 1)]
    top = [[g.vert((x, y, h_top(x, y))) for x in xs] for y in ys]
    bot = [[g.vert((x, y, h_soffit(x, y))) for x in xs] for y in ys]
    # PV bands on the top: two strips across the roof's south-facing slopes
    pv_rows = set()
    if detail:
        for j in range(ny):
            ym = (ys[j] + ys[j + 1]) / 2
            if -110 < ym < -66 or 14 < ym < 36:
                pv_rows.add(j)
    for j in range(ny):
        for i in range(nx):
            key = "pvroof" if (j in pv_rows and 2 <= i < nx - 2) else "roof"
            uv = [(xs[i] / 8, ys[j] / 8), (xs[i + 1] / 8, ys[j] / 8), (xs[i + 1] / 8, ys[j + 1] / 8), (xs[i] / 8, ys[j + 1] / 8)]
            g.face((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]), key, uv, smooth=True)
            uvb = [(xs[i] / 4, ys[j] / 4), (xs[i] / 4, ys[j + 1] / 4), (xs[i + 1] / 4, ys[j + 1] / 4), (xs[i + 1] / 4, ys[j] / 4)]
            g.face((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]), "soffit", uvb, smooth=True)
    # fascia round the edge (outward)
    ring = [(0, i) for i in range(nx)] + [(j, nx) for j in range(ny)] + [(ny, i) for i in range(nx, 0, -1)] + [(j, 0) for j in range(ny, 0, -1)]
    for k in range(len(ring)):
        (ja, ia), (jb, ib) = ring[k], ring[(k + 1) % len(ring)]
        a0, b0 = Vector(g.v[top[ja][ia]]), Vector(g.v[top[jb][ib]])
        L = (b0 - a0).length
        g.face((bot[ja][ia], bot[jb][ib], top[jb][ib], top[ja][ia]), "fascia",
               [(0, 0), (L / 3, 0), (L / 3, FASCIA / 3), (0, FASCIA / 3)])


def wall_strip(g, a, b, z0, key, out, steps):
    """A curtain wall from plan point a to b, from z0 up to the soffit, in `steps` pieces; UVs in metres."""
    u = 0.0
    for k in range(steps):
        p = a.lerp(b, k / steps)
        q = a.lerp(b, (k + 1) / steps)
        L = (q - p).length
        zp, zq = h_soffit(p.x, p.y), h_soffit(q.x, q.y)
        g.polyn([(p.x, p.y, z0), (q.x, q.y, z0), (q.x, q.y, zq), (p.x, p.y, zp)], key, (out[0], out[1], 0),
                uvs=[(u, z0), (u + L, z0), (u + L, zq), (u, zp)])
        u += L


def flat_wall(g, a, b, z0, z1, key, out):
    L = (b - a).length
    g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out[0], out[1], 0),
            uvs=[(0, z0), (L, z0), (L, z1), (0, z1)])


LOBBY_TOP = PL + 6.0


def walls(g, detail=True):
    corners = {"s": (Vector((X0, Y0)), Vector((X1, Y0)), (0, -1)), "e": (Vector((X1, Y0)), Vector((X1, Y1)), (1, 0)),
               "n": (Vector((X1, Y1)), Vector((X0, Y1)), (0, 1)), "w": (Vector((X0, Y1)), Vector((X0, Y0)), (-1, 0))}
    for side, (a, b, out) in corners.items():
        steps = max(1, round((b - a).length / (8.6 if detail else 30.0)))
        if side == "n":
            # the wing covers the middle of the north wall up to its roof
            for p, q in ((a, Vector((WX1, Y1))), (Vector((WX0, Y1)), b)):
                flat_wall(g, p, q, PL, LOBBY_TOP, "lobby", out)
                wall_strip(g, p, q, LOBBY_TOP, "glass", out, max(1, steps // 4))
            wall_strip(g, Vector((WX1, Y1)), Vector((WX0, Y1)), WING_H, "glass", out, max(1, steps // 2))
            continue
        flat_wall(g, a, b, PL, LOBBY_TOP, "lobby", out)
        if side == "s" and detail:
            # the south front: metal-panel glass to 14 m, the PV glass above
            mid = PL + 13.5
            flat_wall(g, a, b, LOBBY_TOP, mid, "glass", out)
            wall_strip(g, a, b, mid, "pv", out, steps)
        else:
            wall_strip(g, a, b, LOBBY_TOP, "glass", out, steps)
    # a soffit band over the lobby storey (a slim ledge), the plinth's top under the walls is the plinth
    if detail:
        for side, (a, b, out) in corners.items():
            o = Vector(out) * 0.9
            g.polyn([(a.x, a.y, LOBBY_TOP), (b.x, b.y, LOBBY_TOP), (b.x + o.x, b.y + o.y, LOBBY_TOP), (a.x + o.x, a.y + o.y, LOBBY_TOP)], "steel", (0, 0, 1))
            g.polyn([(a.x, a.y, LOBBY_TOP - 0.35), (b.x, b.y, LOBBY_TOP - 0.35), (b.x + o.x, b.y + o.y, LOBBY_TOP - 0.35), (a.x + o.x, a.y + o.y, LOBBY_TOP - 0.35)], "steel", (0, 0, -1))
            g.polyn([(a.x + o.x, a.y + o.y, LOBBY_TOP - 0.35), (b.x + o.x, b.y + o.y, LOBBY_TOP - 0.35), (b.x + o.x, b.y + o.y, LOBBY_TOP), (a.x + o.x, a.y + o.y, LOBBY_TOP)], "steel", (out[0], out[1], 0))


def fins(g):
    """Steel mullion fins on the long walls and the south front, plinth to soffit, and the roof's columns."""
    n = int((Y1 - Y0) / FIN)
    for i in range(n + 1):
        y = Y0 + (Y1 - Y0) * i / n
        for x, sgn in ((X0, -1), (X1, 1)):
            z1 = h_soffit(x + sgn * 0.6, y)
            if sgn > 0:
                g.box(x, x + 1.2, y - 0.2, y + 0.2, PL, z1, "steel", skip=("-z", "+z", "-x"))
            else:
                g.box(x - 1.2, x, y - 0.2, y + 0.2, PL, z1, "steel", skip=("-z", "+z", "+x"))
    n = int((X1 - X0) / FIN)
    for i in range(1, n):
        x = X0 + (X1 - X0) * i / n
        z1 = h_soffit(x, Y0 - 0.6)
        g.box(x - 0.2, x + 0.2, Y0 - 1.2, Y0, PL, z1, "steel", skip=("-z", "+z", "+y"))


def plinth(g):
    """The granite plinth round the block and wing (its top and outer faces) and the entrance steps."""
    pts = [(X0 - PLW, Y0 - PLW), (X1 + PLW, Y0 - PLW), (X1 + PLW, Y1 + PLW), (WX1 + PLW, Y1 + PLW), (WX1 + PLW, WY1 + PLW),
           (WX0 - PLW, WY1 + PLW), (WX0 - PLW, Y1 + PLW), (X0 - PLW, Y1 + PLW)]
    g.polyn([(x, y, PL) for x, y in pts], "granite", (0, 0, 1))
    for k in range(len(pts)):
        (ax, ay), (bx, by) = pts[k], pts[(k + 1) % len(pts)]
        g.polyn([(ax, ay, 0.0), (bx, by, 0.0), (bx, by, PL), (ax, ay, PL)], "granite", (by - ay, -(bx - ax), 0))
    for side, c, w in DOORS:
        for i in range(1, 4):
            zt = PL * (4 - i) / 4
            d0, d1 = PLW - 0.1, PLW + i * 0.42
            if side == "s":
                g.box(c - w / 2, c + w / 2, Y0 - d1, Y0 - d0, 0.0, zt, "granite", skip=("-z",))
            else:
                g.box(X1 + d0, X1 + d1, c - w / 2, c + w / 2, 0.0, zt, "granite", skip=("-z",))


def plaza(g):
    for poly in PLAZA:
        g.polyn([(x, y, 0.03) for x, y in poly], "pave", (0, 0, 1))


def wing(g, detail=True):
    a = [Vector((WX0, Y1)), Vector((WX1, Y1)), Vector((WX1, WY1)), Vector((WX0, WY1))]
    for k, out in ((1, (1, 0)), (2, (0, 1)), (3, (-1, 0))):
        p, q = a[k], a[(k + 1) % 4]
        flat_wall(g, p, q, PL, WING_H, "ice", out)
    g.polyn([(WX0, Y1, WING_H), (WX1, Y1, WING_H), (WX1, WY1, WING_H), (WX0, WY1, WING_H)], "flat", (0, 0, 1))
    if detail:
        # a parapet ring
        for x0, x1, y0, y1 in ((WX0, WX1, WY1 - 0.4, WY1), (WX0, WX0 + 0.4, Y1, WY1), (WX1 - 0.4, WX1, Y1, WY1)):
            g.box(x0, x1, y0, y1, WING_H, WING_H + 1.1, "fascia", skip=("-z",))


def canopy(g):
    """The south entrance canopy on four slim columns."""
    c, w = DOORS[0][1], DOORS[0][2]
    y0, y1, z = Y0 - 7.0, Y0, PL + 5.2
    g.box(c - w / 2, c + w / 2, y0, y1, z, z + 0.7, "fascia")
    for x in (c - w / 2 + 1.5, c - w / 6, c + w / 6, c + w / 2 - 1.5):
        g.box(x - 0.2, x + 0.2, y0 + 0.6, y0 + 1.0, PL, z, "steel", skip=("-z", "+z"))


def text_mesh(font, body, height, width, name, mat, coll, m, extrude=0.06):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, 1.0, extrude
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_character = 1.1
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    ky = height / (max(ys) - min(ys))
    kx = width / (max(xs) - min(xs)) if width else ky
    cy = (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z + extrude))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def facing(p, out):
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(*p) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("国家体育馆")
    det = collection("馆", main)

    g = Geo()
    roof(g)
    walls(g)
    fins(g)
    wing(g)
    canopy(g)
    g.build("Hall", det, M, TILE)
    b = Geo()
    plinth(b)
    plaza(b)
    b.build("Plinth", det, M, TILE)
    tris = g.tris() + b.tris()

    try:
        font = bpy.data.fonts.load(FONT)
    except Exception:
        font = bpy.data.fonts.load(FONT_FALLBACK)
    letters = collection("字", main)
    c = DOORS[0][1]
    tris += text_mesh(font, "国家体育馆", 3.0, 22.0, "NameSouth", M["letters"], letters, facing((c, Y0 - 1.25, PL + 9.0), (0, -1)))
    tris += text_mesh(font, "NATIONAL INDOOR STADIUM", 0.9, 19.0, "NameSouthEn", M["letters"], letters, facing((c, Y0 - 1.25, PL + 11.6), (0, -1)))

    # far level
    far = collection("LOD1", main)
    f = Geo()
    roof(f, 6, 16, detail=False)
    walls(f, detail=False)
    wing(f, detail=False)
    pts = [(X0 - PLW, Y0 - PLW), (X1 + PLW, Y0 - PLW), (X1 + PLW, WY1 + PLW), (X0 - PLW, WY1 + PLW)]
    f.polyn([(x, y, PL) for x, y in pts], "granite", (0, 0, 1))
    plaza(f)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    # colliders: plinth, the hall in slices under the roof, the roof slab, the wing, canopy columns
    helpers = collection("碰撞体")
    collider_box(helpers, "plinth", X0 - PLW, X1 + PLW, Y0 - PLW, Y1 + PLW, 0.0, PL)
    collider_box(helpers, "plinth_n", WX0 - PLW, WX1 + PLW, Y1, WY1 + PLW, 0.0, PL)
    n = 8
    for k in range(n):
        ya, yb = Y0 + (Y1 - Y0) * k / n, Y0 + (Y1 - Y0) * (k + 1) / n
        pts = [(x, y, PL) for x in (X0, X1) for y in (ya, yb)]
        pts += [(x, y, h_soffit(x, y)) for x in (X0, X1) for y in (ya, yb)]
        pts += [(0.0, y, h_soffit(0.0, y)) for y in (ya, (ya + yb) / 2, yb)]
        collider_pts(helpers, "hall", pts)
    n = 12
    for k in range(n):
        ya, yb = RY0 + (RY1 - RY0) * k / n, RY0 + (RY1 - RY0) * (k + 1) / n
        pts = [(x, y, z) for x in (RX0, (RX0 + RX1) / 2, RX1) for y in (ya, yb) for z in (h_soffit(x, y), h_top(x, y))]
        collider_pts(helpers, "roof", pts)
    collider_box(helpers, "wing", WX0, WX1, Y1, WY1, PL, WING_H)
    cc, cw = DOORS[0][1], DOORS[0][2]
    for x in (cc - cw / 2 + 1.5, cc - cw / 6, cc + cw / 6, cc + cw / 2 - 1.5):
        collider_box(helpers, "col", x - 0.2, x + 0.2, Y0 - 6.4, Y0 - 6.0, PL, PL + 5.2)
    import bcity_landmark
    for side, c, w in DOORS:
        run = 3 * 0.42 + 0.3
        if side == "s":
            lo = [(c - w / 2, Y0 - PLW - run, 0.0), (c + w / 2, Y0 - PLW - run, 0.0)]
            hi = [(c - w / 2, Y0 - PLW + 0.3, PL), (c + w / 2, Y0 - PLW + 0.3, PL), (c - w / 2, Y0 - PLW + 0.3, 0.0), (c + w / 2, Y0 - PLW + 0.3, 0.0)]
        else:
            lo = [(X1 + PLW + run, c - w / 2, 0.0), (X1 + PLW + run, c + w / 2, 0.0)]
            hi = [(X1 + PLW - 0.3, c - w / 2, PL), (X1 + PLW - 0.3, c + w / 2, PL), (X1 + PLW - 0.3, c - w / 2, 0.0), (X1 + PLW - 0.3, c + w / 2, 0.0)]
        collider_pts(helpers, f"steps_{side}", lo + hi, role="WALK")
    fp = [(X0 - PLW - 0.5, Y0 - PLW - 2.0), (X1 + PLW + 2.0, Y0 - PLW - 2.0), (X1 + PLW + 2.0, Y1 + PLW), (X0 - PLW - 0.5, Y1 + PLW)]
    flat_marker(helpers, "nationalindoor", fp, "FOOTPRINT")
    flat_marker(helpers, "nationalindoor_wing", rect(WX0 - PLW, WX1 + PLW, Y1 + PLW - 0.1, WY1 + PLW + 0.5), "FOOTPRINT")
    flat_marker(helpers, "nationalindoor", rect(RX0 - 1.0, RX1 + 2.0, RY0 - 2.0, Y1 + PLW), "CLEAR")
    flat_marker(helpers, "nationalindoor_wing", rect(WX0 - PLW, WX1 + PLW, Y1 + PLW - 0.1, WY1 + PLW + 0.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "nationalindoor", "国家体育馆", "National Indoor Stadium"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
