# The police helicopter (police/Heli.ts), modelled in Blender: a light twin in the manner of an EC135 - a
# rounded fuselage with the wrap-round glazing of the cockpit and cabin, the engine cowling and its exhausts,
# a slim tail boom to a ducted tail rotor (fenestron) under the fin, a horizontal stabiliser with end plates,
# skids on two cross tubes, the searchlight pod under the nose, a step each side; white with a blue band and
# 警察 POLICE on the boom. The main rotor (four blades and the hub) and the fenestron's fan are their own
# groups, spun by the game.
#
#   blender -b -P scripts/blender/vehicles/heli.py -- [--out .scratch/blender/heli.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/heli.glb src/police/heli.json --group
#
# Written in the heli's own frame (+Z forward, +Y up, x across; the ground under the skids at y = 0) and turned
# into Blender's here. The figures match the old model so its placement code holds: the rotor hub at
# (0, 2.85, 0) with 5.2 m blades, the tail rotor at z = -6.05, the searchlight at (0, 0.35, 1.9).
# Objects are named '<group>__<part>': groups hull, rotor, fan; materials white, blue, glass, dark, grey.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "heli.glb")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
M = {}
G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
n_obj = [0]


def link(ob, m=None):
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = G2B @ (m or Matrix())
    return ob


def name(group, part):
    n_obj[0] += 1
    return f"{group}__{part}{n_obj[0]}"


def finish(bm, group, part, mat, smooth=True, subsurf=0, m=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name(group, part))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = link(bpy.data.objects.new(me.name, me), m)
    if subsurf:
        md = ob.modifiers.new("sub", "SUBSURF")
        md.levels = md.render_levels = subsurf
    return ob


def loft(group, part, sections, mat, subsurf=2, caps=True, m=None):
    """Through sections [(z, [(x, y), ...]), ...] of the same count (a ring round the body, counter-clockwise from +x)."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for x, y in ring] for z, ring in sections]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return finish(bm, group, part, mat, subsurf=subsurf, m=m)


def section(hw, hh, yc, k=0.55, n=12, flat_bottom=0.0):
    """A rounded cross-section: a superellipse of half width hw, half height hh round (0, yc)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = hw * math.copysign(abs(c) ** k, c)
        y = hh * math.copysign(abs(s) ** k, s)
        if s < 0:
            y *= 1 - flat_bottom
        pts.append((x, yc + y))
    return pts


def box(group, part, c, h, mat, rot=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * h[0], v.co.y * 2 * h[1], v.co.z * 2 * h[2]))
    ob = finish(bm, group, part, mat, smooth=False, m=Matrix.Translation(c) @ (rot or Matrix()))
    if bevel:
        md = ob.modifiers.new("bev", "BEVEL")
        md.width, md.segments = bevel, 2
    return ob


def cyl(group, part, a, b, r, mat, sides=10, r2=None, caps=True):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    return finish(bm, group, part, mat, m=Matrix.Translation((a + b) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4())


def tube(group, part, pts, r, mat, res=6):
    cu = bpy.data.curves.new(name(group, part), "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = r, 1, True
    cu.resolution_u = 4
    sp = cu.splines.new("NURBS" if len(pts) > 2 else "POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1.0)
    if len(pts) > 2:
        sp.use_endpoint_u = True
        sp.order_u = min(4, len(pts))
    cu.materials.append(M[mat])
    return link(bpy.data.objects.new(cu.name, cu))


def fuselage():
    # The body from the nose (z 2.55) to where the boom leaves it (z -2.0): cabin floor at y 0.62.
    body = [
        (2.55, section(0.12, 0.12, 1.2, 0.8)),
        (2.35, section(0.48, 0.5, 1.2, 0.7)),
        (1.9, section(0.72, 0.72, 1.35, 0.6, flat_bottom=0.1)),
        (1.1, section(0.8, 0.8, 1.45, 0.45, flat_bottom=0.2)),
        (0.0, section(0.8, 0.85, 1.5, 0.42, flat_bottom=0.2)),
        (-1.0, section(0.76, 0.8, 1.52, 0.45, flat_bottom=0.15)),
        (-1.7, section(0.52, 0.62, 1.66, 0.55)),
        (-2.3, section(0.28, 0.34, 1.8, 0.7)),
    ]
    loft("hull", "body", body, "white")
    # glazing: the cockpit bubble over the nose and the cabin windows (thin shells just outside the body)
    glass = [
        (2.42, section(0.36, 0.36, 1.38, 0.7)),
        (2.1, section(0.66, 0.64, 1.48, 0.6)),
        (1.5, section(0.81, 0.72, 1.62, 0.5)),
        (0.9, section(0.83, 0.62, 1.78, 0.5)),
    ]
    # keep only the upper half of each ring (above the waist): a canopy, not a tube
    canopy = [(z, [p for p in ring if p[1] > ring[0][1] - 0.02]) for z, ring in glass]
    bm = bmesh.new()
    rows = [[bm.verts.new((x, y, z)) for x, y in ring] for z, ring in canopy]
    for a, b in zip(rows, rows[1:]):
        for i in range(min(len(a), len(b)) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    finish(bm, "hull", "canopy", "glass", subsurf=1)
    for s in (1, -1):
        # cabin side windows and the sliding door's outline
        box("hull", "window", (s * 0.8, 1.72, 0.2), (0.02, 0.24, 0.42), "glass")
        box("hull", "window", (s * 0.78, 1.72, -0.75), (0.02, 0.22, 0.3), "glass")
        box("hull", "stripe", (s * 0.81, 1.08, 0.3), (0.012, 0.09, 1.55), "blue")
        box("hull", "stripe", (s * 0.8, 0.88, 0.3), (0.012, 0.035, 1.55), "blue")
        box("hull", "step", (s * 0.7, 0.55, 0.4), (0.12, 0.02, 0.35), "dark")
    # engine cowling and the exhausts, the mast fairing
    loft("hull", "cowl", [(0.9, section(0.35, 0.12, 2.3, 0.5)), (0.4, section(0.55, 0.3, 2.4, 0.45)), (-1.2, section(0.52, 0.3, 2.4, 0.45)),
                          (-2.1, section(0.2, 0.15, 2.25, 0.6))], "white", subsurf=1)
    for s in (1, -1):
        cyl("hull", "exhaust", (s * 0.3, 2.45, -1.5), (s * 0.34, 2.5, -2.05), 0.13, "grey", sides=10, r2=0.15)
        box("hull", "intake", (s * 0.5, 2.42, -0.1), (0.04, 0.1, 0.35), "dark")
    cyl("hull", "mast", (0, 2.55, 0), (0, 2.8, 0), 0.22, "grey", sides=12, r2=0.14)


def tail():
    # the boom, tapering from the body to the fin
    boom = [(z, section(r, r, y, 0.5, 10)) for z, r, y in ((-2.1, 0.3, 1.78), (-3.5, 0.2, 1.84), (-5.2, 0.15, 1.9), (-5.7, 0.16, 1.92))]
    loft("hull", "boom", boom, "white", subsurf=1)
    for s in (1, -1):
        box("hull", "boomband", (s * 0.19, 1.84, -3.6), (0.012, 0.05, 1.3), "blue")
    # the fenestron: a thick disc of fin round the fan, the fin above it, stabiliser and its end plates
    bm = bmesh.new()
    for x0 in (-0.11, 0.11):              # the shroud's two faces: an annulus round the duct, in the yz plane
        ang = [2 * math.pi * i / 20 for i in range(20)]
        vo = [bm.verts.new((x0, 2.25 + math.sin(a) * 0.56, -6.05 + math.cos(a) * 0.56)) for a in ang]
        vi = [bm.verts.new((x0, 2.25 + math.sin(a) * 0.38, -6.05 + math.cos(a) * 0.38)) for a in ang]
        for i in range(20):
            j = (i + 1) % 20
            bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
    finish(bm, "hull", "shroud", "white", smooth=False)
    cyl("hull", "duct", (-0.11, 2.25, -6.05), (0.11, 2.25, -6.05), 0.38, "dark", sides=20, caps=False)
    cyl("hull", "rim", (-0.11, 2.25, -6.05), (0.11, 2.25, -6.05), 0.56, "white", sides=20, caps=False)
    fin = [(-5.75, [(0.08, 2.6), (-0.08, 2.6), (-0.06, 3.1), (0.06, 3.1)]), (-6.55, [(0.05, 2.7), (-0.05, 2.7), (-0.04, 3.3), (0.04, 3.3)])]
    loft("hull", "fin", fin, "blue", subsurf=0)
    box("hull", "stab", (0, 1.95, -5.0), (0.8, 0.03, 0.24), "white")
    for s in (1, -1):
        box("hull", "endplate", (s * 0.82, 2.0, -5.0), (0.015, 0.17, 0.24), "blue")


def skids():
    for s in (1, -1):
        tube("hull", "skid", [(s * 0.95, 0.12, 1.8), (s * 0.95, 0.05, 1.5), (s * 0.95, 0.05, -1.4), (s * 0.95, 0.08, -1.6)], 0.06, "grey")
    for z in (0.9, -0.8):
        tube("hull", "cross", [(-0.95, 0.07, z), (-0.8, 0.5, z), (0.8, 0.5, z), (0.95, 0.07, z)], 0.05, "grey")


def searchlight():
    cyl("hull", "podarm", (0, 0.78, 1.9), (0, 0.45, 1.9), 0.05, "grey", sides=6)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.2)
    finish(bm, "hull", "pod", "dark", m=Matrix.Translation((0, 0.35, 1.9)))
    cyl("hull", "lens", (0, 0.35, 2.0), (0, 0.33, 2.13), 0.17, "glass", sides=12)


def lettering():
    """警察 POLICE on each side of the boom, and on the cabin's belly band."""
    if not os.path.isfile(FONT):
        print("no font; the lettering is left out")
        return
    font = bpy.data.fonts.load(FONT)
    for s in (1, -1):
        for text, at, h in (("警察", (s * 0.305, 1.77, -2.6), 0.26), ("POLICE", (s * 0.205, 1.84, -3.85), 0.13)):
            cu = bpy.data.curves.new("txt", "FONT")
            cu.body, cu.font, cu.size, cu.extrude = text, font, 1.0, 0.0
            cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
            ob = bpy.data.objects.new("txt", cu)
            bpy.context.scene.collection.objects.link(ob)
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            bpy.data.objects.remove(ob)
            ys = [v.co.y for v in me.vertices]
            k = h / (max(ys) - min(ys))
            # the text's plane (normal +Z) turned to face out of its side, reading left to right from there:
            # on the +x side it runs towards the tail, on the -x side towards the nose
            yaw = math.pi / 2 if s > 0 else -math.pi / 2
            m = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Diagonal((k, k, k, 1))
            for v in me.vertices:
                v.co = Vector((v.co.x, v.co.y - (max(ys) + min(ys)) / 2, v.co.z))
            me.materials.append(M["blue"])
            o = bpy.data.objects.new(name("hull", "text"), me)
            link(o, m)


def rotor():
    # four blades with a little twist, the hub and its scissors
    for k in range(4):
        a = k * math.pi / 2
        bm = bmesh.new()
        n = 6
        rows = []
        for i in range(n + 1):
            r = 0.35 + (5.2 - 0.35) * i / n
            tw = math.radians(8 * (1 - i / n))
            c = 0.16 if i < n else 0.12
            # a thin section: leading edge, top, trailing edge, bottom, the chord twisted a little
            ct, st = math.cos(tw), math.sin(tw)
            sec = [(c, 0.0), (0.0, 0.025), (-c, 0.0), (0.0, -0.025)]
            rows.append([bm.verts.new((r, z * st + y * ct, z * ct - y * st)) for z, y in sec])
        for ra, rb in zip(rows, rows[1:]):
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        bm.faces.new(rows[-1])
        finish(bm, "rotor", "blade", "dark", smooth=False, m=Matrix.Translation((0, 2.85, 0)) @ Matrix.Rotation(a, 4, "Y"))
    cyl("rotor", "hub", (0, 2.78, 0), (0, 2.95, 0), 0.3, "grey", sides=12)
    cyl("rotor", "cap", (0, 2.95, 0), (0, 3.05, 0), 0.18, "grey", sides=10, r2=0.08)


def fan():
    # the fenestron's fan, spun about x at the duct's centre
    for k in range(8):
        a = 2 * math.pi * k / 8
        box("fan", "blade", (0, 2.25 + math.sin(a) * 0.19, -6.05 + math.cos(a) * 0.19), (0.01, 0.16, 0.04), "grey",
            rot=Matrix.Rotation(-a, 4, "X"))
    cyl("fan", "hub", (-0.08, 2.25, -6.05), (0.08, 2.25, -6.05), 0.09, "dark", sides=10)


def build():
    clear_file()
    for k, (col, rough, metal) in dict(white=("#f2f3f1", 0.35, 0.2), blue=("#1c47a8", 0.35, 0.2), glass=("#0d1a24", 0.08, 0.6),
                                       dark=("#1b1d20", 0.6, 0.1), grey=("#8a8e92", 0.4, 0.6)).items():
        M[k] = material(k, col, rough, metal)
    fuselage()
    tail()
    skids()
    searchlight()
    lettering()
    rotor()
    fan()
    return len(bpy.data.objects)


if __name__ == "__main__":
    print("built", build(), "objects")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True)
    print("exported", OUT)
