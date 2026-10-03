# 国家会议中心 China National Convention Center (RMJM / BIAD, 2008: the Olympic press and broadcast centre, a
# convention centre since 2009), built in Blender and marked with the bcity_landmark add-on's conventions. OSM way
# 55884004 (amenity=events_venue, building:material=glass) is its outline: a 147 x 402 m block turned 2.32 degrees
# off north (the Olympic axis), on the west side of the park between 国家体育场北路 (south) and 大屯路 (north),
# 天辰东路 to the east and the 北辰 hotel and office podium against its west face. The centre of the block's box is
# game (-1172.55, -9992.3) = 39.9985913 N, 116.3838427 E. Its building:parts (1459448117-121, 1460560739,
# 1460578626) give the roof: 42 m at both ends with skillion roofs falling 7 m towards the middle, 35 m and 30-35
# m in the middle - one long concave curve (the National Indoor Stadium's description calls it 单曲面).
#
#   blender -b -P scripts/blender/landmarks/cncc.py -- [--out art/landmarks/cncc.blend] [--export]
#
# Frame: Blender +X east, +Y north (the long axis), metres, origin on the ground at the block's box centre.
#
# The published figures: 398 m long, 148 m wide, 42 m high, eight storeys above ground. Here: the glass block
# under one roof that sags from 42 m at the ends to 31 m in the middle; the roof's deep white canopy overhangs
# the east front (towards the park's axis) by 9-15 m, its edge waving in and out in plan and gently up and down,
# with a 3 m white fascia and a white slatted soffit; 4-5 m over the ends, a short eave on the west (the hotel
# podium abuts it). The walls are the kit's curtain-wall shader (a lit lobby storey, offices above), white
# vertical fins every 4.5 m on the east front and the ends, white floor bands at 12 and 24 m; three entrance
# canopies on slim columns along the east front (none where 规划四路's underpass runs under the building), and
# 国家会议中心 / CHINA NATIONAL CONVENTION CENTER over the middle one and on the south end. A paved forecourt to
# 天辰东路. Doubtful: the canopy's real wave (a wavy white roof edge as remembered from photographs, not
# measured); the entrances' positions; the 2008 roof is drawn without the rooftop plant.

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
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "cncc.blend")
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_FALLBACK = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = -1172.55, -9992.3, -2.32
X0, X1, Y0, Y1 = -73.8, 72.8, -201.1, 200.9     # the walls
HMID, HEND = 31.0, 42.0                          # the roof top at the middle and the ends
FASCIA = 3.0
OV_W, OV_S, OV_N = 2.5, 5.0, 4.5                 # overhangs: west, south, north
OV_E0, OV_E1 = 12.0, 3.2                         # east canopy: mean depth, wave amplitude
WAVE_L = 67.0                                    # the east edge's wave length along y
RY0, RY1 = Y0 - OV_S, Y1 + OV_N
NY = 96
FIN = 4.5
LOBBY_TOP = 6.5
BANDS = (12.0, 24.0)
# entrance canopies on the east front: (centre y, width)
CANOPIES = [(-125.0, 34.0), (-12.0, 44.0), (128.0, 34.0)]
CAN_Z, CAN_D = 6.8, 11.0
PLAZA = [rect(X1, X1 + 34.0, Y0 - 8.0, Y1 + 3.0), rect(X0 - 1.0, X1, Y0 - 9.0, Y0), rect(X0 + 10.0, X1, Y1, Y1 + 3.0)]


def h_top(y):
    t = y / ((Y1 - Y0) / 2)
    return HMID + (HEND - HMID) * t * t


def east_edge(y):
    """The east canopy's edge in plan: waving in and out along the front."""
    return X1 + OV_E0 + OV_E1 * math.sin(2 * math.pi * (y + 20.0) / WAVE_L)


def edge_lift(y):
    """The canopy edge rises a little where it reaches out furthest (the wave also reads in elevation)."""
    return 1.4 * math.sin(2 * math.pi * (y + 20.0) / WAVE_L)


def z_top(x, y):
    """The roof's top: flat across the block, the east canopy lifting with the wave towards its edge."""
    if x <= X1:
        return h_top(y)
    t = min(1.0, (x - X1) / (east_edge(y) - X1))
    return h_top(y) + edge_lift(y) * t * t


def z_soffit(x, y):
    return z_top(x, y) - FASCIA


# --- textures ------------------------------------------------------------------------------------------

def roof_image():
    cv = Canvas(256, 256, "#cfd1cf")
    cv.noise(0.05, 5)
    cv.put(np.mod(cv.y, 32) < 2.0, "#a9adab")
    return image("CNCC_Roof", np.flipud(cv.a).copy())


def soffit_image():
    cv = Canvas(128, 128, "#eef0ef")
    cv.put(np.mod(cv.y, 8) < 1.2, "#c3c7c6")
    cv.put(cv.x < 2, "#b8bcbb")
    return image("CNCC_Soffit", np.flipud(cv.a).copy())


def materials():
    base = dict(frame="#d8dcdd", mull=0.05, slab=0.08, metal=0.75, rough=0.08, warm="#ffd9a8", coolShare=0.3)
    return dict(
        glass=facade("CNCC_Glass", dict(base, floorH=4.4, colW=1.5, glass="#5b7685", spandrel="#cfd5d8", lit=0.5, seed=41)),
        lobby=facade("CNCC_Lobby", dict(base, floorH=6.5, colW=2.25, glass="#4a606d", spandrel="#d8dcdd", lit=0.8, seed=42)),
        roof=material("CNCC_Roof", "#cfd1cf", 0.6, metal=0.2, tex=roof_image(), props={"wet": "surface", "glow": "none"}),
        white=material("CNCC_White", "#eceeed", 0.4, metal=0.2, props={"wet": "surface", "glowStrength": 1.0}),
        soffit=material("CNCC_Soffit", "#eef0ef", 0.5, tex=soffit_image(), props={"wet": "none", "glowStrength": 0.8}),
        steel=material("CNCC_Steel", "#b5bbbe", 0.35, metal=0.8, props={"wet": "surface", "glowStrength": 0.6}),
        granite=material("CNCC_Granite", "#b9b7af", 0.7, props={"wet": "ground", "glowStrength": 0.4}),
        pave=material("CNCC_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        letters=material("CNCC_Letters", "#f4f6f7", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#dcecff", "glowStrength": 0.8}),
        dark=material("CNCC_Dark", "#3d4246", 0.6, props={"wet": "surface", "glow": "none"}),
    )


TILE = dict(granite=2.0, pave=4.0, white=3.0, steel=2.0, dark=2.0)


# --- geometry ------------------------------------------------------------------------------------------

def roof(g, ny=NY, nxi=6, nxe=4, detail=True):
    """The roof as a grid: columns across the block (west eave to the east wall) then out over the canopy to its
    waving edge; top, soffit and the fascia round the edge."""
    ys = [RY0 + (RY1 - RY0) * j / ny for j in range(ny + 1)]

    def xs_at(y):
        xi = [X0 - OV_W + (X1 - X0 + OV_W) * i / nxi for i in range(nxi + 1)]
        xe = [X1 + (east_edge(y) - X1) * i / nxe for i in range(1, nxe + 1)]
        return xi + xe

    cols = len(xs_at(0.0))
    top, bot, P = [], [], []
    for y in ys:
        xs = xs_at(y)
        P.append(xs)
        top.append([g.vert((x, y, z_top(x, y))) for x in xs])
        bot.append([g.vert((x, y, z_soffit(x, y))) for x in xs])
    for j in range(ny):
        for i in range(cols - 1):
            xa, xb = P[j][i], P[j][i + 1]
            uv = [(xa / 8, ys[j] / 8), (xb / 8, ys[j] / 8), (P[j + 1][i + 1] / 8, ys[j + 1] / 8), (P[j + 1][i] / 8, ys[j + 1] / 8)]
            g.face((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]), "roof", uv, smooth=True)
            uvb = [(xa / 4, ys[j] / 4), (P[j + 1][i] / 4, ys[j + 1] / 4), (P[j + 1][i + 1] / 4, ys[j + 1] / 4), (xb / 4, ys[j] / 4)]
            g.face((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]), "soffit", uvb, smooth=True)
    ring = [(0, i) for i in range(cols - 1)] + [(j, cols - 1) for j in range(ny)] + [(ny, i) for i in range(cols - 1, 0, -1)] + [(j, 0) for j in range(ny, 0, -1)]
    u = 0.0
    for k in range(len(ring)):
        (ja, ia), (jb, ib) = ring[k], ring[(k + 1) % len(ring)]
        a0, b0 = Vector(g.v[top[ja][ia]]), Vector(g.v[top[jb][ib]])
        L = (b0 - a0).length
        g.face((bot[ja][ia], bot[jb][ib], top[jb][ib], top[ja][ia]), "white", [(u, 0), (u + L / 3, 0), (u + L / 3, 1), (u, 1)],
               smooth=(ia == cols - 1 and ib == cols - 1))
        u += L / 3


def wall_strip(g, a, b, z0, key, out, steps):
    u = 0.0
    for k in range(steps):
        p = a.lerp(b, k / steps)
        q = a.lerp(b, (k + 1) / steps)
        L = (q - p).length
        zp, zq = z_soffit(p.x - 0.01 * out[0], p.y), z_soffit(q.x - 0.01 * out[0], q.y)
        g.polyn([(p.x, p.y, z0), (q.x, q.y, z0), (q.x, q.y, zq), (p.x, p.y, zp)], key, (out[0], out[1], 0),
                uvs=[(u, z0), (u + L, z0), (u + L, zq), (u, zp)])
        u += L


def flat_wall(g, a, b, z0, z1, key, out):
    L = (b - a).length
    g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out[0], out[1], 0),
            uvs=[(0, z0), (L, z0), (L, z1), (0, z1)])


SIDES = {"s": (Vector((X0, Y0)), Vector((X1, Y0)), (0, -1)), "e": (Vector((X1, Y0)), Vector((X1, Y1)), (1, 0)),
         "n": (Vector((X1, Y1)), Vector((X0, Y1)), (0, 1)), "w": (Vector((X0, Y1)), Vector((X0, Y0)), (-1, 0))}


def walls(g, detail=True):
    for side, (a, b, out) in SIDES.items():
        L = (b - a).length
        steps = max(1, round(L / (6.0 if detail else 40.0)))
        if side == "w":
            # against the podium: plain stone below 15 m, glass above
            flat_wall(g, a, b, 0.0, 15.0, "granite", out)
            wall_strip(g, a, b, 15.0, "glass", out, steps)
            continue
        flat_wall(g, a, b, 0.0, LOBBY_TOP, "lobby", out)
        wall_strip(g, a, b, LOBBY_TOP, "glass", out, steps)
        if detail:
            # white floor bands (slim ledges)
            o = Vector(out) * 0.7
            for z in (LOBBY_TOP,) + BANDS:
                pa, pb = a, b
                g.polyn([(pa.x, pa.y, z), (pb.x, pb.y, z), (pb.x + o.x, pb.y + o.y, z), (pa.x + o.x, pa.y + o.y, z)], "white", (0, 0, 1))
                g.polyn([(pa.x, pa.y, z - 0.5), (pb.x, pb.y, z - 0.5), (pb.x + o.x, pb.y + o.y, z - 0.5), (pa.x + o.x, pa.y + o.y, z - 0.5)], "white", (0, 0, -1))
                g.polyn([(pa.x + o.x, pa.y + o.y, z - 0.5), (pb.x + o.x, pb.y + o.y, z - 0.5), (pb.x + o.x, pb.y + o.y, z), (pa.x + o.x, pa.y + o.y, z)], "white", (out[0], out[1], 0))


def fins(g):
    """White vertical fins on the east front and the two ends, lobby top to soffit."""
    for side in ("s", "e", "n"):
        a, b, out = SIDES[side]
        L = (b - a).length
        n = int(L / FIN)
        d = (b - a).normalized()
        for i in range(1, n):
            p = a + d * (L * i / n)
            z1 = z_soffit(p.x - 0.01 * out[0], p.y)
            o = Vector(out)
            q0, q1 = p - d * 0.15, p + d * 0.15 + o * 0.9
            g.box(min(q0.x, q1.x), max(q0.x, q1.x), min(q0.y, q1.y), max(q0.y, q1.y), LOBBY_TOP, z1, "white", skip=("-z", "+z"))


def canopies(g):
    for yc, w in CANOPIES:
        y0, y1 = yc - w / 2, yc + w / 2
        x1 = X1 + CAN_D
        g.box(X1, x1, y0, y1, CAN_Z, CAN_Z + 0.8, "white")
        g.box(x1 - 0.05, x1 + 0.05, y0, y1, CAN_Z + 0.05, CAN_Z + 0.75, "letters")
        for y in (y0 + 2.0, yc - w / 6, yc + w / 6, y1 - 2.0):
            g.box(x1 - 1.5, x1 - 1.1, y - 0.2, y + 0.2, 0.0, CAN_Z, "steel", skip=("-z", "+z"))
        # glazed doors under it: a dark recess band
        g.box(X1 + 0.02, X1 + 0.25, y0 + 3.0, y1 - 3.0, 0.15, 3.6, "dark", skip=("-z",))


def plaza(g):
    for poly in PLAZA:
        g.polyn([(x, y, 0.03) for x, y in poly], "pave", (0, 0, 1))


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
    main = collection("国家会议中心")
    det = collection("馆", main)

    g = Geo()
    roof(g)
    walls(g)
    fins(g)
    canopies(g)
    plaza(g)
    g.build("Centre", det, M, TILE)
    tris = g.tris()

    try:
        font = bpy.data.fonts.load(FONT)
    except Exception:
        font = bpy.data.fonts.load(FONT_FALLBACK)
    letters = collection("字", main)
    yc = CANOPIES[1][0]
    tris += text_mesh(font, "国家会议中心", 2.6, 24.0, "NameEast", M["letters"], letters, facing((X1 + 1.0, yc, BANDS[0] - 2.6), (1, 0)))
    tris += text_mesh(font, "CHINA NATIONAL CONVENTION CENTER", 0.8, 22.0, "NameEastEn", M["letters"], letters, facing((X1 + 1.0, yc, BANDS[0] - 4.7), (1, 0)))
    tris += text_mesh(font, "国家会议中心", 3.2, 30.0, "NameSouth", M["letters"], letters, facing((0.0, Y0 - 1.0, BANDS[1] + 4.0), (0, -1)))

    far = collection("LOD1", main)
    f = Geo()
    roof(f, 24, 2, 2, detail=False)
    walls(f, detail=False)
    plaza(f)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    helpers = collection("碰撞体")
    n = 12
    for k in range(n):
        ya, yb = Y0 + (Y1 - Y0) * k / n, Y0 + (Y1 - Y0) * (k + 1) / n
        pts = [(x, y, z) for x in (X0, X1 + 0.9) for y in (ya, yb) for z in (0.0, z_soffit(x - 1.0, y))]
        collider_pts(helpers, "hall", pts)
    n = 16
    for k in range(n):
        ya, yb = RY0 + (RY1 - RY0) * k / n, RY0 + (RY1 - RY0) * (k + 1) / n
        pts = []
        for y in (ya, (ya + yb) / 2, yb):
            for x in (X0 - OV_W, X1, east_edge(y)):
                pts += [(x, y, z_soffit(x, y)), (x, y, z_top(x, y))]
        collider_pts(helpers, "roof", pts)
    for yc, w in CANOPIES:
        y0, y1 = yc - w / 2, yc + w / 2
        x1 = X1 + CAN_D
        for y in (y0 + 2.0, yc - w / 6, yc + w / 6, y1 - 2.0):
            collider_box(helpers, "col", x1 - 1.5, x1 - 1.1, y - 0.2, y + 0.2, 0.0, CAN_Z)
    flat_marker(helpers, "cncc", rect(X0 - 0.3, X1 + 1.0, Y0 - 1.0, Y1 + 1.0), "FOOTPRINT")
    # the forecourt: machine-learnt 9-41 m blocks (Overture 8000000158309/312/313) stood on it, roofs of the
    # entrance canopies and the underpass's ramps traced as buildings; stops short of OSM's metro entrance at y 156
    flat_marker(helpers, "cncc_forecourt", rect(X1 + 1.0, X1 + 33.0, Y0 - 1.0, 150.0), "FOOTPRINT")
    clear = [(X0 - OV_W, RY0)] + [(east_edge(RY0 + (RY1 - RY0) * j / 40) + 0.5, RY0 + (RY1 - RY0) * j / 40) for j in range(41)] + [(X0 - OV_W, RY1)]
    flat_marker(helpers, "cncc", clear, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "cncc", "国家会议中心", "China National Convention Center"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
