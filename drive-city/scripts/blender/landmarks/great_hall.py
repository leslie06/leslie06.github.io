# 人民大会堂 Great Hall of the People, built in Blender from its OSM outline and real dimensions, marked
# with the bcity_landmark add-on's conventions, ready to edit and export (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/great_hall.py -- [--out art/landmarks/greathall.blend] [--export]
#   (or with the bpy module: python scripts/blender/landmarks/great_hall.py -- ...)
#
# It clears the open file's objects, meshes, materials and images first: run it in a new file.
# Frame: Blender +X east (the square), +Y north, metres, origin at the centre of the OSM outline's box
# (39.9034544 N, 116.3872832 E), the building's axis 2.056 deg anticlockwise of north like the city's.
#
# Real figures: 356 x 206 m (OSM's outline 335 x 209), 46.5 m at the tallest, the east portico's twelve
# columns 25 m high. The rest - bay width, storey height, the cornice - is read off photographs.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, select, srgb  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "greathall.blend")

# --- the plan (building frame: x east, y north) ------------------------------------------------------
# The OSM outline (relation 8848388) in this frame, cleaned to right angles with the 3 m jogs at the
# corner pavilions dropped. East wings reach x 104, the central east front x 82 behind the portico,
# the auditorium block bulges west to x -104.5.
PLAN = [(-37.5, 64), (-37.5, 138), (-72, 138), (-72, 167.5), (104, 167.5), (104, 138.5), (78, 138.5), (78, 58),
        (82, 58), (82, -58), (78, -58), (78, -138.5), (104, -138.5), (104, -167.5), (-72, -167.5), (-72, -138),
        (-37.5, -138), (-37.5, -64), (-104.5, -64), (-104.5, 64)]
EAST_BLOCK = [(38, -58), (82, -58), (82, 58), (38, 58)]          # behind the portico, rises to the emblem
WEST_BLOCK = [(-104.5, -64), (-37.5, -64), (-37.5, 64), (-104.5, 64)]  # the Great Auditorium
H_BASE, H_WALL, H_FRIEZE, H_EAVE = 1.5, 29.5, 31.5, 33.5
H_EAST, H_WEST = 42.0, 44.5            # their walls; each gets its own cornice (+2 m), tallest 46.5
BAY, STOREY = 6.0, 6.0
PORTICO = dict(x0=82.0, x1=93.5, y=48.0, terrace=(82.0, 96.0, 50.0), top=4.5, col_x=89.0, cols=12, col_gap=8.0, col_r=1.1)
STAIRS = dict(x0=96.0, x1=108.0, y=40.0, steps=15)


def signed_area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def ccw(p):
    return p if signed_area(p) > 0 else p[::-1]


def offset(poly, d):
    """Miter offset of a CCW polygon, outward by d (right-angled plans: exact)."""
    out = []
    n = len(poly)
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        a, b = (p1 - p0).normalized(), (p2 - p1).normalized()
        na, nb = Vector((a.y, -a.x)), Vector((b.y, -b.x))
        m = na + nb
        k = 1 + na.dot(nb)
        out.append(tuple(p1 + m * (d / k)) if k > 1e-6 else tuple(p1 + na * d))
    return out


# --- textures (drawn with numpy, packed into the .blend) --------------------------------------------

def facade_images(size=512):
    """One bay by one storey (6 x 6 m): granite, a tall window with a stone frame, mullion and transom."""
    rng = np.random.default_rng(7)
    v, u = np.mgrid[0:size, 0:size] / size          # v up (row 0 is the bottom in Blender images)
    stone = srgb("#d9cfbc") * (0.94 + 0.06 * rng.random((size, size, 1), np.float32))
    stone -= 0.05 * (np.abs(((v * 3) % 1) - 0.5) < 0.004)[..., None]       # coursing joints every 2 m
    col = stone.copy()
    glow = np.zeros_like(col)
    win = (np.abs(u - 0.5) < 0.24) & (v > 0.17) & (v < 0.86)
    frame = (np.abs(u - 0.5) < 0.27) & (v > 0.15) & (v < 0.88) & ~win
    col[frame] = srgb("#efe8d8")
    glass = srgb("#27313b") + (0.10 * (1 - v))[..., None] * srgb("#7d8fa3")
    col[win] = glass[win]
    bars = win & ((np.abs(u - 0.5) < 0.008) | (np.abs(v - 0.64) < 0.008) | (np.abs(u - 0.38) < 0.005) | (np.abs(u - 0.62) < 0.005))
    col[bars] = srgb("#bfb6a4")
    col[(v > 0.86) & (v < 0.9) & (np.abs(u - 0.5) < 0.3)] = srgb("#cbbfa8")   # lintel
    lit = win & ~bars
    glow[lit] = srgb("#ffc27a") * (0.55 + 0.25 * rng.random((size, size), np.float32)[lit][:, None])
    return image("GH_facade", col), image("GH_facade_night", glow)


def tile_image(size=128):
    """Glazed roof tiles: ridges down the slope (u along the eave, one tile per 0.8 m)."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.78 + 0.22 * np.cos(2 * np.pi * u) ** 2
    course = 1 - 0.12 * (((v * 6) % 1) < 0.08)
    return image("GH_tiles", srgb("#dca72b") * (ridge * course)[..., None])


# --- mesh building -----------------------------------------------------------------------------------

class Builder:
    """Collects faces with per-face UVs and material slots, then makes one object."""

    def __init__(self):
        self.faces = []   # (verts, uvs, slot, want_normal or None)
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def face(self, verts, uvs, mat, want=None):
        self.faces.append(([Vector(v) for v in verts], uvs, self.slot(mat), want))

    def walls(self, poly, z0, z1, mat, bay=BAY, storey=STOREY, off=0.0):
        p = offset(poly, off) if off else poly
        for i in range(len(p)):
            a, b = Vector((*p[i], 0)), Vector((*p[(i + 1) % len(p)], 0))
            L = (b - a).length
            n = max(1, round(L / bay))
            d = (b - a).normalized()
            out = Vector((d.y, -d.x, 0))
            self.face([a + Vector((0, 0, z0)), b + Vector((0, 0, z0)), b + Vector((0, 0, z1)), a + Vector((0, 0, z1))],
                      [(0, z0 / storey), (n, z0 / storey), (n, z1 / storey), (0, z1 / storey)], mat, out)

    def cap(self, poly, z, mat, down=False, scale=8.0):
        vs = [(x, y, z) for x, y in poly]
        self.face(vs, [(x / scale, y / scale) for x, y in poly], mat, Vector((0, 0, -1 if down else 1)))

    def band(self, poly, off_a, z_a, off_b, z_b, mat, pitch=0.8):
        """A ring from offset off_a at z_a to off_b at z_b (a sloped eave, a soffit, a fascia)."""
        pa, pb = offset(poly, off_a), offset(poly, off_b)
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            L = (Vector(pa[j]) - Vector(pa[i])).length
            d = Vector(poly[j]) - Vector(poly[i])
            out = Vector((d.y, -d.x, 0)).normalized()
            want = out if abs(z_b - z_a) > 1e-6 else Vector((0, 0, 1 if off_b < off_a else -1))
            if off_a > off_b and z_b > z_a:
                want = (out + Vector((0, 0, 1))).normalized()
            self.face([(*pa[i], z_a), (*pa[j], z_a), (*pb[j], z_b), (*pb[i], z_b)],
                      [(0, 0), (L / pitch, 0), (L / pitch, 1), (0, 1)], mat, want)

    def box(self, x0, x1, y0, y1, z0, z1, mat, scale=2.0):
        c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        self.walls(c, z0, z1, mat, bay=scale, storey=scale)
        self.cap(c, z1, mat, scale=scale)
        self.cap(c[::-1], z0, mat, down=True, scale=scale)

    def build(self, name, coll):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        for verts, uvs, slot, want in self.faces:
            bv = [bm.verts.new(v) for v in verts]
            f = bm.faces.new(bv)
            f.material_index = slot
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
            f.normal_update()
            if want is not None and f.normal.dot(want) < 0:
                f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


def box_mesh(name, sx, sy, sz, mat, z0=0.0):
    b = Builder()
    b.box(-sx / 2, sx / 2, -sy / 2, sy / 2, z0, z0 + sz, mat)
    me = b.build(name, bpy.context.scene.collection)
    data = me.data
    bpy.data.objects.remove(me)
    return data


# --- the building ------------------------------------------------------------------------------------

def build():
    clear_file()
    scene = bpy.context.scene
    ensure_addon()

    fac, fac_night = facade_images()
    tiles = tile_image()
    M = dict(
        facade=material("GH_Facade", "#d9cfbc", 0.75, tex=fac, emit_tex=fac_night, props={"wet": "damp", "emit": "night"}),
        stone=material("GH_Stone", "#dcd3c1", 0.7, props={"wet": "damp"}),
        plinth=material("GH_Plinth", "#a99f8e", 0.8, props={"wet": "ground"}),
        marble=material("GH_Marble", "#e9e5dc", 0.35, props={"wet": "surface"}),
        frieze=material("GH_Frieze", "#2f6b5c", 0.35, props={"wet": "surface"}),
        tiles=material("GH_Tiles", "#dca72b", 0.3, tex=tiles, props={"wet": "surface"}),
        roof=material("GH_Roof", "#8c8a84", 0.9, props={"wet": "ground", "glow": "none"}),
        red=material("GH_Red", "#b3241c", 0.45, props={"glow": "lamp", "glowColor": [1.0, 0.25, 0.12], "glowStrength": 0.3}),
        gold=material("GH_Gold", "#e3b447", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.5}),
        pole=material("GH_Pole", "#c9ccd0", 0.3, metal=1.0, props={"glow": "none"}),
    )
    plan, east, west = ccw(PLAN), ccw(EAST_BLOCK), ccw(WEST_BLOCK)
    main = collection("大会堂")

    # the body: plinth, walls, frieze, the yellow-tiled eave, the flat roof
    b = Builder()
    b.walls(plan, 0, H_BASE, M["plinth"], off=0.6)
    b.band(plan, 0.6, H_BASE, 0.0, H_BASE, M["plinth"])
    b.walls(plan, H_BASE, H_WALL, M["facade"])
    b.walls(plan, H_WALL, H_FRIEZE, M["frieze"], off=0.35, bay=2, storey=2)
    b.band(plan, 0.0, H_WALL, 0.35, H_WALL, M["stone"])
    b.band(plan, 0.35, H_FRIEZE, 1.9, H_FRIEZE, M["stone"])
    b.band(plan, 1.9, H_FRIEZE, 0.25, H_EAVE, M["tiles"])
    b.cap(offset(plan, 0.25), H_EAVE, M["roof"])
    # the two blocks that rise above it, each with its own cornice
    for blk, top in ((east, H_EAST), (west, H_WEST)):
        b.walls(blk, H_EAVE, top, M["facade"])
        b.walls(blk, top, top + 0.8, M["frieze"], off=0.3, bay=2, storey=2)
        b.band(blk, 0.0, top, 0.3, top, M["stone"])
        b.band(blk, 0.3, top + 0.8, 1.6, top + 0.8, M["stone"])
        b.band(blk, 1.6, top + 0.8, 0.2, top + 2.0, M["tiles"])
        b.cap(offset(blk, 0.2), top + 2.0, M["roof"])
    body = b.build("Body", main)

    # pilasters: one mesh, linked on every bay line of the body (the game draws them as one instanced mesh)
    pil = box_mesh("PilasterMesh", 1.5, 0.7, H_WALL - H_BASE, M["stone"], z0=H_BASE)
    pils = collection("壁柱", main)
    n_pil = 0
    for i in range(len(plan)):
        a, c = Vector(plan[i]), Vector(plan[(i + 1) % len(plan)])
        L = (c - a).length
        if L < 5:
            continue
        n = max(1, round(L / BAY))
        d = (c - a).normalized()
        out = Vector((d.y, -d.x))
        yaw = math.atan2(d.y, d.x)
        for k in range(n + 1):
            p = a + d * (L * k / n) + out * 0.35
            o = bpy.data.objects.new(f"Pilaster.{n_pil:03d}", pil)
            o.matrix_world = Matrix.Translation((p.x, p.y, 0)) @ Matrix.Rotation(yaw, 4, "Z")
            pils.objects.link(o)
            n_pil += 1

    # the east portico: terrace, twelve columns, the entablature and its eave, the emblem, the stairs
    P = PORTICO
    b = Builder()
    tx0, tx1, ty = P["terrace"]
    b.box(tx0, tx1, -ty, ty, 0, P["top"], M["plinth"])
    ent = ccw([(P["x0"], -P["y"]), (P["x1"], -P["y"]), (P["x1"], P["y"]), (P["x0"], P["y"])])
    b.walls(ent, H_WALL, H_FRIEZE + 1.0, M["stone"], bay=4, storey=4)
    b.cap(ent[::-1], H_WALL, M["stone"], down=True)
    b.walls(ent, H_FRIEZE + 1.0, H_FRIEZE + 2.0, M["frieze"], off=0.3, bay=2, storey=2)
    b.band(ent, 0.0, H_FRIEZE + 1.0, 0.3, H_FRIEZE + 1.0, M["stone"])
    b.band(ent, 0.3, H_FRIEZE + 2.0, 1.8, H_FRIEZE + 2.0, M["stone"])
    b.band(ent, 1.8, H_FRIEZE + 2.0, 0.2, H_EAVE + 2.0, M["tiles"])
    b.cap(offset(ent, 0.2), H_EAVE + 2.0, M["roof"])
    portico = b.build("Portico", main)

    S = STAIRS
    b = Builder()
    rise = P["top"] / S["steps"]
    run = (S["x1"] - S["x0"]) / S["steps"]
    for k in range(S["steps"]):
        b.box(S["x0"], S["x1"] - k * run, -S["y"], S["y"], k * rise, (k + 1) * rise, M["plinth"], scale=1.0)
    stairs = b.build("Stairs", main)

    col_me = bpy.data.meshes.new("ColumnMesh")
    bm = bmesh.new()
    h = H_WALL - P["top"]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=P["col_r"], radius2=P["col_r"] * 0.92, depth=h - 2.4,
                          matrix=Matrix.Translation((0, 0, P["top"] + 1.2 + (h - 2.4) / 2)))
    for z0, z1, r in ((P["top"], P["top"] + 1.2, P["col_r"] * 1.35), (H_WALL - 1.2, H_WALL, P["col_r"] * 1.3)):
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, (z0 + z1) / 2)) @ Matrix.Diagonal((2 * r, 2 * r, z1 - z0, 1)))
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            loop[uv].uv = (math.atan2(loop.vert.co.y, loop.vert.co.x) / math.pi, loop.vert.co.z / 4)
    bm.to_mesh(col_me)
    bm.free()
    col_me.materials.append(M["marble"])
    cols = collection("门廊柱", main)
    columns = []
    for i in range(P["cols"]):
        o = bpy.data.objects.new(f"Column.{i:03d}", col_me)
        o.location = (P["col_x"], (i - (P["cols"] - 1) / 2) * P["col_gap"], 0)
        cols.objects.link(o)
        columns.append(o)

    # 国徽 on the attic above the portico roof, facing the square (a red disc in a gold ring); the flag on the east block
    em = bmesh.new()
    bmesh.ops.create_cone(em, cap_ends=True, segments=40, radius1=3.2, radius2=3.2, depth=0.5)
    emblem_me = bpy.data.meshes.new("EmblemDisc")
    em.to_mesh(emblem_me)
    em.free()
    emblem_me.materials.append(M["red"])
    disc = bpy.data.objects.new("Emblem", emblem_me)
    disc.matrix_world = Matrix.Translation((82.3, 0, 38.8)) @ Matrix.Rotation(math.pi / 2, 4, "Y")   # local +Z faces east
    main.objects.link(disc)
    rb = bmesh.new()
    bmesh.ops.create_circle(rb, segments=40, radius=3.4)
    inner = bmesh.ops.extrude_edge_only(rb, edges=rb.edges[:])
    for v in (e for e in inner["geom"] if isinstance(e, bmesh.types.BMVert)):
        v.co *= 2.95 / 3.4
    for v in rb.verts:
        v.co.z = 0.3
    ring = bpy.data.meshes.new("EmblemRing")
    rb.to_mesh(ring)
    rb.free()
    ring.materials.append(M["gold"])
    gold = bpy.data.objects.new("EmblemRing", ring)
    gold.matrix_world = disc.matrix_world.copy()
    main.objects.link(gold)
    b = Builder()
    b.box(60 - 0.12, 60 + 0.12, -0.12, 0.12, H_EAST + 2.0, H_EAST + 16.0, M["pole"], scale=1.0)
    pole = b.build("Flagpole", main)
    b = Builder()
    b.face([(60, 0, H_EAST + 15.8), (60, 0, H_EAST + 13.0), (60, -4.2, H_EAST + 13.0), (60, -4.2, H_EAST + 15.8)],
           [(0, 1), (0, 0), (1, 0), (1, 1)], M["red"])
    flag = b.build("Flag", main)

    # far level: the massing in the same facade material (one draw call past 800 m)
    lod = collection("LOD1")
    b = Builder()
    b.walls(plan, 0, H_EAVE, M["facade"])
    b.cap(plan, H_EAVE, M["facade"])
    for blk, top in ((east, H_EAST + 2), (west, H_WEST + 2)):
        b.walls(blk, H_EAVE, top, M["facade"])
        b.cap(blk, top, M["facade"])
    b.walls(ccw([(tx0, -ty), (tx1, -ty), (tx1, ty), (tx0, ty)]), 0, P["top"], M["facade"])
    b.build("Massing", lod)

    # colliders: the plan cut into rectangles, the blocks, the terrace and portico roof; columns and the
    # stair ramp through the add-on's own buttons
    helpers = collection("碰撞体")
    rects = [(-37.5, 78, -138, 138, H_EAVE), (-72, 104, 138, 167.5, H_EAVE), (-72, 104, -167.5, -138, H_EAVE),
             (-104.5, -37.5, -64, 64, H_WEST + 2), (78, 82, -58, 58, H_EAVE), (38, 82, -58, 58, H_EAST + 2),
             (tx0, tx1, -ty, ty, P["top"]), (P["x0"], P["x1"], -P["y"], P["y"], H_EAVE + 2)]
    for i, (x0, x1, y0, y1, top) in enumerate(rects):
        b = Builder()
        z0 = H_WALL if i == len(rects) - 1 else 0.0
        b.box(x0, x1, y0, y1, z0, top, M["roof"])
        o = b.build(f"COL_block{i}", helpers)
        o.data.materials.clear()
    select(columns)
    bpy.ops.bcity.box_collider()
    select([stairs])
    bpy.ops.bcity.ramp(rise="-X")
    for o in helpers.objects:
        select([o])
        bpy.ops.bcity.mark(role="COL" if not o.name.startswith("WALK") else "WALK")
    # footprint from what is drawn, and the same ground kept clear of street trees and lamps
    bpy.ops.bcity.footprint(margin=1.0)
    fp = next(o for o in bpy.data.objects if o.name.startswith("FOOTPRINT"))
    zone = fp.copy()
    zone.data = fp.data.copy()
    zone.name = "CLEAR_site"
    fp.users_collection[0].objects.link(zone)
    # grow the clear zone 3 m past the footprint
    pts = [v.co for v in zone.data.vertices]
    cx, cy = sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts)
    for v in zone.data.vertices:
        d = Vector((v.co.x - cx, v.co.y - cy, 0))
        v.co += d.normalized() * 3.0
    select([zone])
    bpy.ops.bcity.mark(role="CLEAR")

    s = scene.bcity
    s.lm_id, s.name_zh, s.name_en = "greathall", "人民大会堂", "Great Hall of the People"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.9034544", "116.3872832", -2.056
    s.repo_path = REPO
    return dict(pilasters=n_pil, columns=len(columns))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
