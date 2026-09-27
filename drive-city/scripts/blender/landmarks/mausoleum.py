# 毛主席纪念堂 Chairman Mao Memorial Hall, on the axis of Tian'anmen Square between the Monument and
# 正阳门, built in Blender and marked with the bcity_landmark add-on's conventions (N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/mausoleum.py -- [--out art/landmarks/mausoleum.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# It clears the open file first. Frame: Blender +X east, +Y north (the Monument, Tiananmen), metres,
# origin at the centre of OSM's colonnade (its building parts 637908757-760 and the 44 column parts;
# 39.9010986 N, 116.3915493 E), turned -1.85 deg so the rows of columns run square.
#
# From OSM's parts and the published figures: a square hall on a two-tier terrace of red granite with
# white marble balustrades, 44 square granite columns round it (12 a side, the middle bay wider for the
# doors), two eaves of yellow glazed tile (at the top of the colonnade and round the roof), the core
# behind the columns with tall windows, the inscription over the north doors, and the four sculpture
# groups at the foot of the terrace, north and south. The groups are massing only: standing figures
# as blended metaballs, a flag on the north pair - no likeness of anyone is attempted.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, linear, material, save_and_export  # noqa: E402
from kit import (SIDES, Geo, T, balustrade, band, collider_box, flat_marker, fwall, mesh_of, panel_geo, paving,  # noqa: E402
                 place, post_geo, rect, side_line, tile_image)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "mausoleum.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

TIERS = [(50.0, 0.0, 1.6), (44.0, 1.6, 3.2)]            # half size, bottom, top
STEPS = [(12.0, 3.6), (10.0, 3.6)]                     # half width and run of each tier's steps, north and south
COLS = [4.45, 11.35, 18.05, 24.75, 31.0, 37.65]         # column centres either side of the axis (OSM)
COL, COL_TOP = 2.0, 23.2
CORE = 29.5                                            # the hall behind the colonnade
LOWER = dict(out=40.7, z=COL_TOP, fascia=0.5, rise=2.4, back=1.3)   # the eave over the colonnade
UPPER = dict(out=33.1, z=31.6, fascia=0.5, rise=2.2, back=1.2)      # the eave round the roof
TOP = dict(half=25.0, rise=1.1)
GROUPS = [(-30.0, 60.0, True), (30.0, 60.0, True), (-30.0, -60.0, False), (30.0, -60.0, False)]   # x, y, carries a flag


def sq_column():
    g = Geo()
    g.box(-0.5, 0.5, -0.5, 0.5, 0.0, 1.0, "granite", skip=("-z",))
    g.box(-0.6, 0.6, -0.6, 0.6, 0.0, 0.03, "granite", skip=("-z",))
    g.box(-0.58, 0.58, -0.58, 0.58, 0.97, 1.0, "granite")
    return g


def eave(g, E, faces):
    """A modern eave of glazed tile round the core: soffit, a stone fascia, the tiled slope, the flat roof behind."""
    off = E["out"] - CORE
    z0, z1, z2 = E["z"], E["z"] + E["fascia"], E["z"] + E["fascia"] + E["rise"]
    for side in faces:
        band(g, -CORE, CORE, -CORE, CORE, side, 0.0, z0, off, z0, "soffit", faces)
        band(g, -CORE, CORE, -CORE, CORE, side, off, z0, off, z1, "granite", faces)
        band(g, -CORE, CORE, -CORE, CORE, side, off + 0.2, z1, off - E["back"], z2, "tiles", faces)
        band(g, -CORE, CORE, -CORE, CORE, side, off - E["back"], z2, 0.0, z2, "roof", faces)
    return z2


def group_mesh(name, flag, seed):
    """A sculpture group: nine standing figures blended into one mass, one with a flag. Decimated."""
    import random
    rng = random.Random(seed)
    # (figures stand along X, facing -Y; the pedestal turns them to face out from the hall)
    mb = bpy.data.metaballs.new(name)
    mb.resolution = mb.render_resolution = 0.14
    mb.threshold = 0.35
    up = Matrix.Rotation(math.pi / 2, 4, "Y").to_quaternion()
    # two ranks of stocky figures, close enough to read as one carved mass
    for rank, (n, y0, scale) in enumerate(((10, -0.8, 1.0), (9, 0.8, 1.08))):
        for i in range(n):
            x = -6.4 + 12.8 * (i + 0.5 * rank) / (n - 1 + 0.5 * rank) + rng.uniform(-0.2, 0.2)
            y = y0 + rng.uniform(-0.25, 0.25)
            h = rng.uniform(5.6, 6.4) * scale
            # a column of overlapping balls from the feet to the shoulders, then the head
            for k in range(7):
                t = k / 6
                e = mb.elements.new(type="BALL")
                e.co, e.radius = (x, y, 0.45 + t * (h * 0.72 - 0.45)), 0.72 + 0.3 * t
            e = mb.elements.new(type="BALL")
            e.co, e.radius = (x, y - 0.1, h * 0.88), 0.55
            if rng.random() < 0.35:                                    # a raised arm, from the shoulder
                e = mb.elements.new(type="CAPSULE")
                e.co, e.radius, e.rotation = (x + 0.55, y - 0.15, h * 0.86), 0.3, up
                e.size_x = 0.75
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    tmp = bpy.data.objects.new(name + "_d", me)
    bpy.context.scene.collection.objects.link(tmp)
    tmp.modifiers.new("dec", "DECIMATE").ratio = 0.08       # massing seen from the square: 6k triangles a group
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(me)
    out.shade_smooth()
    if flag:
        # the flag: a pole and a cloth, added to the mesh
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(out)
        x0 = 1.2
        for (a, b) in (((x0 - 0.06, -0.06), (x0 + 0.06, 0.06)),):
            bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(((a[0] + b[0]) / 2, 0, 4.4)) @ Matrix.Diagonal((0.12, 0.12, 8.8, 1)))
        cloth = [bm.verts.new(p) for p in ((x0, 0, 8.6), (x0 + 3.6, 0.5, 8.1), (x0 + 3.4, 0.2, 6.3), (x0, 0, 6.6))]
        bm.faces.new(cloth)
        bm.to_mesh(out)
        bm.free()
    return out


def build():
    clear_file()
    for mb in list(bpy.data.metaballs):
        bpy.data.metaballs.remove(mb)
    ensure_addon()
    import bcity_landmark
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    pav = paving()
    M = dict(
        granite=material("MM_Granite", "#d8d3c6", 0.6, props={"wet": "damp"}),
        soffit=material("MM_Soffit", "#e6e1d6", 0.7, props={"wet": "none", "glowStrength": 1.2}),
        red=material("MM_RedGranite", "#8d3b2f", 0.5, props={"wet": "surface"}),
        marble=material("MM_Marble", "#ebe7de", 0.45, props={"wet": "surface", "glowStrength": 0.5}),
        paving=material("MM_Paving", "#a29e94", 0.8, tex=pav, props={"wet": "ground", "glowStrength": 0.6}),
        tiles=material("MM_Tiles", "#dca72b", 0.3, tex=tile_image("MM_Tiles"), props={"wet": "surface"}),
        roof=material("MM_Roof", "#8c8a84", 0.9, props={"wet": "ground", "glow": "none"}),
        glass=material("MM_Glass", "#2a3138", 0.2, metal=0.3, props={"wet": "surface", "glow": "none"}),
        bronze=material("MM_Bronze", "#5e4a32", 0.4, metal=0.7, props={"wet": "surface", "glowStrength": 0.5}),
        gold=material("MM_Gold", "#e3b447", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.5}),
        stone=material("MM_Stone", "#bdb8ad", 0.8, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.6}),
    )
    TILE = dict(granite=2.0, soffit=2.0, red=2.0, marble=2.0, paving=4.0, roof=8.0, bronze=1.0, glass=1.0)
    main = collection("纪念堂")
    g = Geo()
    faces = dict(s=1, e=1, n=1, w=1)
    # the terrace: two tiers of red granite, paved, with steps up the middle north and south
    for (h, z0, z1), (sw, run) in zip(TIERS, STEPS):
        g.box(-h, h, -h, h, z0, z1, "red", skip=("-z", "+z"))
        g.box(-h - 0.1, h + 0.1, -h - 0.1, h + 0.1, z1 - 0.25, z1, "marble", skip=("-z", "+z"))
        g.polyn([(-h, -h, z1), (h, -h, z1), (h, h, z1), (-h, h, z1)], "paving", (0, 0, 1))
        n = 8
        for sy in (-1, 1):
            for k in range(n):
                ya, yb = sorted((sy * h, sy * (h + run * (n - k) / n)))
                g.box(-sw, sw, ya, yb, z0, z0 + (z1 - z0) * (k + 1) / n, "granite", skip=("-z",))
    # the core: stone walls, a tall window in each bay, the north and south doors
    Z0, Z1 = TIERS[-1][2], UPPER["z"]
    for side in ("s", "e", "n", "w"):
        a, b = side_line(-CORE, CORE, -CORE, CORE, side)
        fwall(g, a, b, Z0, Z1, "granite", SIDES[side], bay=4.0, storey=4.0, zref=Z0)
        ox, oy = SIDES[side]
        d = (b - a).normalized()
        centres = sorted([-c for c in COLS] + COLS)
        for i in range(len(centres) - 1):
            m = (centres[i] + centres[i + 1]) / 2
            if abs(m) > CORE - 2:
                continue
            p = Vector((0, 0)) + d * m + Vector((ox, oy)) * (CORE + 0.03)
            door = side in ("n", "s") and abs(m) < 1
            w = 3.6 if door else 2.4
            zb, zt = (Z0, Z0 + 9.5) if door else (Z0 + 3.0, COL_TOP - 2.0)
            q0, q1 = p - d * (w / 2), p + d * (w / 2)
            g.polyn([(q0.x, q0.y, zb), (q1.x, q1.y, zb), (q1.x, q1.y, zt), (q0.x, q0.y, zt)], "bronze" if door else "glass", (ox, oy, 0))
            if door:
                # the white marble panel for the inscription over the door
                r0, r1 = p - d * 3.4 + Vector((ox, oy)) * 0.05, p + d * 3.4 + Vector((ox, oy)) * 0.05
                g.polyn([(r0.x, r0.y, Z0 + 11.0), (r1.x, r1.y, Z0 + 11.0), (r1.x, r1.y, Z0 + 15.5), (r0.x, r0.y, Z0 + 15.5)], "marble", (ox, oy, 0))
    # both eaves, and the low roof on top
    zl = eave(g, LOWER, faces)
    for side in ("s", "e", "n", "w"):
        a, b = side_line(-CORE, CORE, -CORE, CORE, side)
        fwall(g, a, b, zl, UPPER["z"], "granite", SIDES[side], bay=4.0, storey=4.0, zref=zl)
    zu = eave(g, UPPER, faces)
    H, R = TOP["half"], TOP["rise"]
    ring = [Vector((-CORE, -CORE, zu)), Vector((CORE, -CORE, zu)), Vector((CORE, CORE, zu)), Vector((-CORE, CORE, zu))]
    top = [Vector((-H, -H, zu + R)), Vector((H, -H, zu + R)), Vector((H, H, zu + R)), Vector((-H, H, zu + R))]
    for i in range(4):
        k = (i + 1) % 4
        g.polyn([ring[i], ring[k], top[k], top[i]], "roof", (0, 0, 1))
    g.polyn(top, "roof", (0, 0, 1))
    # the sculpture groups' pedestals
    for x, y, _ in GROUPS:
        g.box(x - 8.5, x + 8.5, y - 2.8, y + 2.8, 0.0, 2.2, "red", skip=("-z",))
        g.box(x - 8.8, x + 8.8, y - 3.1, y + 3.1, 2.2, 2.45, "granite", skip=("-z",))
    g.build("Hall", collection("主体", main), M, TILE)
    tris = g.tris()

    # columns, balustrades, lettering, sculptures
    parts = collection("柱与栏杆", main)
    col = mesh_of(sq_column(), "Column", M, TILE)
    meshes = dict(post=mesh_of(post_geo(), "PostMesh", {"marble": M["marble"]}), panel=mesh_of(panel_geo(), "PanelMesh", {"marble": M["marble"]}))
    spots = set()
    for c in COLS:
        for s in (-1, 1):
            for e in (-COLS[-1], COLS[-1]):
                spots.add((round(s * c, 2), e))
                spots.add((e, round(s * c, 2)))
    for i, (x, y) in enumerate(sorted(spots)):
        place(col, f"Column.{i:03d}", parts, T(x, y, Z0) @ Matrix.Diagonal((COL, COL, COL_TOP - Z0, 1)))
    for (h, z0, z1), (sw, run) in zip(TIERS, STEPS):
        e = h - 0.25
        ring = [(-e, -e, z1), (e, -e, z1), (e, e, z1), (-e, e, z1), (-e, -e, z1)]
        balustrade(parts, meshes, ring, f"Rail{int(h)}", gap=2.0, skip=[(-sw - 0.5, sw + 0.5, -h - 1, -h + 1), (-sw - 0.5, sw + 0.5, h - 1, h + 1)])
    font = bpy.data.fonts.load(FONT)
    cu = bpy.data.curves.new("Inscription", "FONT")
    cu.body, cu.font, cu.size, cu.extrude = "毛主席纪念堂", font, 1.0, 0.06
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.1
    ob = bpy.data.objects.new("Inscription", cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    kx, ky, cy = 6.4 / (max(xs) - min(xs)), 1.3 / (max(ys) - min(ys)), (max(ys) + min(ys)) / 2     # between the middle columns
    m = T(0, CORE + 0.14, Z0 + 13.25) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z))
    me.materials.append(M["gold"])
    letters = bpy.data.objects.new("Inscription", me)
    collection("题字", main).objects.link(letters)
    sculpt = collection("雕塑", main)
    stone = linear("#bdb8ad")
    for i, (x, y, flag) in enumerate(GROUPS):
        me = group_mesh(f"Group{i}", flag, 7 + i)
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", [c for _ in me.vertices for c in (*stone, 1.0)])
        me.materials.append(M["stone"])
        o = bpy.data.objects.new(f"Group.{i}", me)
        o.matrix_world = T(x, y, 2.45) @ Matrix.Rotation(math.pi if y > 0 else 0.0, 4, "Z")   # facing out, away from the hall
        sculpt.objects.link(o)

    # the far level
    far = Geo()
    for h, z0, z1 in TIERS:
        far.box(-h, h, -h, h, z0, z1, "red", skip=("-z",))
    far.box(-LOWER["out"], LOWER["out"], -LOWER["out"], LOWER["out"], COL_TOP, zl, "tiles", skip=())
    far.box(-CORE, CORE, -CORE, CORE, Z0, UPPER["z"], "granite", skip=("-z",))
    far.box(-UPPER["out"], UPPER["out"], -UPPER["out"], UPPER["out"], UPPER["z"], zu, "tiles")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the tiers (steps a ramp for people), the core, the columns, the groups
    helpers = collection("碰撞体")
    for (h, z0, z1), (sw, run) in zip(TIERS, STEPS):
        collider_box(helpers, f"tier{int(h)}", -h, h, -h, h, 0.0, z1)
        for sy in (-1, 1):
            y0, y1 = sy * h, sy * (h + run)
            me = bpy.data.meshes.new("steps")
            me.from_pydata([(-sw, y0, z1), (sw, y0, z1), (sw, y1, z0), (-sw, y1, z0), (-sw, y0, z0), (sw, y0, z0)], [],
                           [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
            o = bpy.data.objects.new(f"steps{int(h)}{sy:+d}", me)
            helpers.objects.link(o)
            bcity_landmark.rename(o, "WALK")
    collider_box(helpers, "core", -CORE, CORE, -CORE, CORE, 0.0, zu + TOP["rise"])
    collider_box(helpers, "lowereave", -LOWER["out"], LOWER["out"], -LOWER["out"], LOWER["out"], COL_TOP, zl)
    for i, (x, y) in enumerate(sorted(spots)):
        collider_box(helpers, f"col{i}", x - COL / 2, x + COL / 2, y - COL / 2, y + COL / 2, Z0, COL_TOP)
    for i, (x, y, _) in enumerate(GROUPS):
        collider_box(helpers, f"group{i}", x - 8.8, x + 8.8, y - 3.1, y + 3.1, 0.0, 8.5)
    flat_marker(helpers, "hall", rect(-54.0, 54.0, -54.0, 54.0), "FOOTPRINT")
    flat_marker(helpers, "hall", rect(-57.0, 57.0, -66.0, 66.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "mausoleum", "毛主席纪念堂", "Chairman Mao Memorial Hall"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.9010986", "116.3915493", -1.85
    s.repo_path = REPO
    return dict(tris=tris, columns=len(spots))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
