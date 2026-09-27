# The motorcycle's body (not its wheels, which vehicle/TwoWheelers.ts still builds), modelled in Blender: a
# naked sports bike - a pillowed tank and radiator shrouds, the seat and an upswept tail, an aluminium twin-spar
# frame, an inline four with finned cylinders, four headers into a collector and an upswept silencer, the
# swingarm, the rear shock's spring, upside-down forks, clamps, bars and mirrors, an angular headlamp under a
# flyscreen, mudguards, the chain, pegs, indicators, tail lamp and plate.
#
#   blender -b -P scripts/blender/vehicles/moto.py -- [--out .scratch/blender/moto.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/moto.glb src/vehicle/models/moto.json
#
# Coordinates are written in the game's body frame (+X left, +Y up, +Z forward, y = 0 at the hub height, the
# wheels at z +-0.72 of radius 0.32; the rider's pelvis at (0, 0.6, -0.18)) and turned into Blender's here.
# Material names are the surfaces TwoWheelers.ts maps them to: paintU (the upper paint tone), paintL, black,
# satin, chrome, engine, seat, spring, plate, head, tail, amber.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "moto.glb")
ZF, ZR, R = 0.72, -0.72, 0.32
M = {}


def P(x, y, z):
    """Game body frame (x left, y up, z forward) to Blender (x right, y forward, z up)."""
    return Vector((-x, z, y))


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh(name, verts, faces, mat, subsurf=0, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([P(*v) for v in verts], [], faces)
    me.materials.append(M[mat])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = link(bpy.data.objects.new(name, me))
    if subsurf:
        md = ob.modifiers.new("sub", "SUBSURF")
        md.levels = md.render_levels = subsurf
    return ob


def cage(name, sections, mat, subsurf=2, cap=True):
    """A loft through rectangular sections [(z, half width bottom, half width top, y bottom, y top), ...]."""
    verts, faces = [], []
    for z, wb, wt, yb, yt in sections:
        verts += [(wb, yb, z), (-wb, yb, z), (-wt, yt, z), (wt, yt, z)]
    for k in range(len(sections) - 1):
        a, b = 4 * k, 4 * (k + 1)
        for i in range(4):
            j = (i + 1) % 4
            faces.append((a + i, a + j, b + j, b + i))
    if cap:
        faces.append((0, 1, 2, 3)[::-1])
        n = 4 * (len(sections) - 1)
        faces.append((n, n + 1, n + 2, n + 3))
    ob = mesh(name, verts, faces, mat, subsurf)
    # outward normals whatever the section order
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def rbox(name, c, size, mat, bevel=0.015, rx=0.0, ry=0.0):
    """A box with rounded edges at game point c, size (x, y, z), pitched rx about x (nose up +)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    # built in game axes, then rotated and moved; the object's matrix maps game to Blender
    ob = link(bpy.data.objects.new(name, me))
    rot = Matrix.Rotation(-rx, 4, "X") @ Matrix.Rotation(ry, 4, "Y")
    G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    ob.matrix_world = Matrix.Translation(P(*c)) @ G2B @ rot
    me.materials.append(M[mat])
    if bevel:
        md = ob.modifiers.new("bev", "BEVEL")
        md.width, md.segments = bevel, 2
    for p in me.polygons:
        p.use_smooth = True
    return ob


def tube(name, pts, r, mat, res=6, caps=True, poly=False):
    """A round tube along game points (a smooth NURBS through them, or straight between them with `poly`)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = r, max(1, res // 4), caps
    cu.resolution_u = 4
    poly = poly or len(pts) == 2
    sp = cu.splines.new("POLY" if poly else "NURBS")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        v = P(*q)
        p.co = (v.x, v.y, v.z, 1.0)
    if not poly:
        sp.use_endpoint_u = True
        sp.order_u = min(4, len(pts))
    cu.materials.append(M[mat])
    ob = link(bpy.data.objects.new(name, cu))
    return ob


def cylinder(name, a, b, r, mat, verts=16, caps=True):
    """A cylinder from game point a to b."""
    va, vb = P(*a), P(*b)
    d = vb - va
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=verts, radius1=r, radius2=r, depth=d.length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    ob = link(bpy.data.objects.new(name, me))
    ob.matrix_world = Matrix.Translation((va + vb) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    for p in me.polygons:
        p.use_smooth = len(p.vertices) == 4
    return ob


def arc_strip(name, cz, r, a0, a1, w, mat, n=10, t=0.012):
    """A mudguard: a strip of width w over the wheel at (0, 0, cz), from angle a0 to a1 (0 = forward, pi/2 = up)."""
    verts, faces = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        y, z = r * math.sin(a), cz + r * math.cos(a)
        y2, z2 = (r + t) * math.sin(a), cz + (r + t) * math.cos(a)
        verts += [(w / 2, y, z), (-w / 2, y, z), (-w / 2, y2, z2), (w / 2, y2, z2)]
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(4):
            j = (k + 1) % 4
            faces.append((a + k, a + j, b + j, b + k))
    return mesh(name, verts, faces, mat)


def helix(name, a, b, r, turns, wire, mat):
    va, vb = Vector(a), Vector(b)
    ax = (vb - va)
    n = int(turns * 10)
    u = ax.normalized()
    side = u.cross(Vector((1, 0, 0))).normalized()
    up = u.cross(side)
    pts = []
    for i in range(n + 1):
        t = i / n
        ang = 2 * math.pi * turns * t
        p = va + ax * t + (side * math.cos(ang) + up * math.sin(ang)) * r
        pts.append(tuple(p))
    return tube(name, pts, wire, mat, res=4, poly=True)


def build():
    clear_file()
    for k, (col, rough, metal) in dict(paintU=("#c0392b", 0.3, 0.0), paintL=("#2c3e50", 0.34, 0.0), black=("#141516", 0.6, 0.0),
                                       satin=("#8d9196", 0.35, 0.85), chrome=("#d5d8db", 0.12, 1.0), engine=("#2c2e31", 0.5, 0.6),
                                       seat=("#1d1d1f", 0.85, 0.0), spring=("#b8322a", 0.4, 0.3), plate=("#e0c23a", 0.5, 0.0),
                                       head=("#f4f4f0", 0.08, 0.6), tail=("#c81e1e", 0.12, 0.1), amber=("#f0a020", 0.2, 0.1)).items():
        M[k] = material(k, col, rough, metal)
    # tank and shrouds
    cage("Tank", [(-0.13, 0.11, 0.12, 0.46, 0.63), (0.04, 0.19, 0.17, 0.41, 0.74), (0.22, 0.2, 0.16, 0.44, 0.77), (0.37, 0.13, 0.1, 0.52, 0.74)], "paintU")
    for s in (1, -1):
        mesh(f"Shroud{s}", [(s * 0.16, 0.32, 0.18), (s * 0.2, 0.32, 0.42), (s * 0.19, 0.6, 0.38), (s * 0.16, 0.62, 0.18),
                            (s * 0.13, 0.32, 0.18), (s * 0.15, 0.32, 0.42), (s * 0.14, 0.6, 0.38), (s * 0.12, 0.62, 0.18)],
             [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], "paintU", subsurf=1)
    # seat and tail
    cage("Seat", [(-0.12, 0.12, 0.10, 0.5, 0.57), (-0.4, 0.13, 0.11, 0.5, 0.57), (-0.66, 0.09, 0.07, 0.54, 0.62)], "seat")
    cage("Tail", [(-0.5, 0.12, 0.1, 0.46, 0.58), (-0.75, 0.1, 0.08, 0.52, 0.66), (-1.0, 0.05, 0.04, 0.6, 0.72)], "paintL")
    rbox("TailLamp", (0, 0.655, -1.0), (0.1, 0.035, 0.03), "tail", bevel=0.008)
    tube("PlateArm", [(0, 0.58, -0.93), (0, 0.45, -1.02), (0, 0.36, -1.06)], 0.012, "black")
    rbox("Plate", (0, 0.34, -1.08), (0.2, 0.12, 0.012), "plate", bevel=0.004, rx=0.25)
    for s in (1, -1):
        cylinder(f"IndR{s}", (s * 0.06, 0.45, -1.0), (s * 0.14, 0.45, -1.0), 0.008, "black", 6)
        rbox(f"IndRL{s}", (s * 0.15, 0.45, -1.0), (0.03, 0.022, 0.04), "amber", bevel=0.006)
    # frame: aluminium twin spars, the steering head, the subframe
    for s in (1, -1):
        tube(f"Spar{s}", [(s * 0.08, 0.71, 0.4), (s * 0.13, 0.56, 0.18), (s * 0.12, 0.38, -0.1), (s * 0.09, 0.25, -0.3)], 0.032, "satin", res=8)
        tube(f"Sub{s}", [(s * 0.08, 0.45, -0.22), (s * 0.08, 0.52, -0.5), (s * 0.06, 0.57, -0.78)], 0.013, "black")
    cylinder("Head", (0, 0.62, 0.45), (0, 0.8, 0.37), 0.045, "satin")
    # the engine: crankcase, the finned cylinders leaning forward, head cover, side covers, radiator
    rbox("Crankcase", (0, 0.07, 0.02), (0.4, 0.26, 0.46), "engine", bevel=0.04)
    for i in range(6):
        rbox(f"Fin{i}", (0, 0.24 + 0.034 * i, 0.1 + 0.016 * i), (0.4 - 0.004 * i, 0.012, 0.25), "engine", bevel=0.003, rx=-0.45)
    rbox("Barrel", (0, 0.31, 0.13), (0.34, 0.22, 0.17), "engine", bevel=0.02, rx=-0.45)
    rbox("HeadCover", (0, 0.46, 0.19), (0.34, 0.07, 0.18), "satin", bevel=0.025, rx=-0.45)
    cylinder("Clutch", (0.2, 0.06, -0.04), (0.235, 0.06, -0.04), 0.12, "satin", 24)
    cylinder("Alternator", (-0.2, 0.1, 0.12), (-0.232, 0.1, 0.12), 0.09, "satin", 20)
    rbox("Radiator", (0, 0.37, 0.39), (0.36, 0.3, 0.05), "black", bevel=0.01, rx=-0.28)
    rbox("RadFrame", (0, 0.37, 0.41), (0.38, 0.32, 0.02), "satin", bevel=0.006, rx=-0.28)
    # exhaust: four headers into a collector under the engine, the link and an upswept silencer on the right
    for x in (0.1, 0.035, -0.035, -0.1):
        tube(f"Header{x}", [(x, 0.3, 0.26), (x, 0.14, 0.36), (x * 0.7, -0.08, 0.26), (x * 0.3, -0.17, 0.02), (-0.03, -0.18, -0.14)], 0.019, "chrome", res=6)
    tube("Link", [(-0.03, -0.18, -0.14), (-0.1, -0.12, -0.36), (-0.15, 0.0, -0.5)], 0.03, "satin", res=6)
    cylinder("Silencer", (-0.15, -0.02, -0.48), (-0.19, 0.2, -0.9), 0.068, "satin", 20)
    cylinder("SilencerCap", (-0.19, 0.2, -0.9), (-0.195, 0.215, -0.925), 0.05, "chrome", 16)
    # swingarm, the shock and its spring, the chain and sprocket
    for s in (1, -1):
        mesh(f"Swingarm{s}", [(s * 0.13, 0.19, -0.28), (s * 0.13, 0.27, -0.28), (s * 0.13, 0.03, -0.74), (s * 0.13, -0.02, -0.74),
                              (s * 0.09, 0.19, -0.28), (s * 0.09, 0.27, -0.28), (s * 0.1, 0.03, -0.74), (s * 0.1, -0.02, -0.74)],
             [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], "satin", smooth=False)
    cylinder("Pivot", (0.14, 0.23, -0.28), (-0.14, 0.23, -0.28), 0.03, "satin", 12)
    cylinder("Shock", (0, 0.16, -0.36), (0, 0.5, -0.5), 0.025, "satin", 10)
    helix("Spring", tuple(P(0, 0.2, -0.38)), tuple(P(0, 0.44, -0.48)), 0.042, 6, 0.008, "spring")
    cylinder("Sprocket", (0.115, 0.0, -0.72), (0.125, 0.0, -0.72), 0.1, "satin", 20)
    for y0, y1 in ((0.085, 0.1), (-0.085, -0.1)):
        tube(f"Chain{y0}", [(0.12, y0, 0.0), (0.12, y1, -0.72)], 0.008, "black", res=4)
    # front: upside-down forks, clamps, bars, grips, levers, mirrors, instruments, headlamp, flyscreen
    k = math.tan(math.radians(25))
    for s in (1, -1):
        cylinder(f"Stanchion{s}", (s * 0.1, 0.0, ZF), (s * 0.1, 0.42, ZF - 0.42 * k), 0.022, "chrome", 12)
        cylinder(f"ForkTube{s}", (s * 0.1, 0.38, ZF - 0.38 * k), (s * 0.1, 0.84, ZF - 0.84 * k), 0.034, "black", 14)
        rbox(f"Caliper{s}", (s * 0.1, 0.04, ZF - 0.12), (0.05, 0.12, 0.07), "satin", bevel=0.01)
        cylinder(f"Peg{s}", (s * 0.14, 0.05, -0.22), (s * 0.22, 0.05, -0.22), 0.014, "satin", 8)
        rbox(f"Rearset{s}", (s * 0.15, 0.1, -0.25), (0.015, 0.12, 0.08), "black", bevel=0.004)
        tube(f"MirrorStalk{s}", [(s * 0.25, 0.9, 0.36), (s * 0.3, 0.98, 0.37), (s * 0.33, 1.03, 0.36)], 0.006, "black", res=4)
        rbox(f"Mirror{s}", (s * 0.34, 1.04, 0.36), (0.11, 0.06, 0.015), "black", bevel=0.01)
        cylinder(f"Grip{s}", (s * 0.26, 0.885, 0.38), (s * 0.37, 0.885, 0.37), 0.018, "black", 10)
        tube(f"Lever{s}", [(s * 0.2, 0.9, 0.42), (s * 0.3, 0.9, 0.45)], 0.006, "satin", res=4)
        cylinder(f"IndFS{s}", (s * 0.1, 0.66, 0.6), (s * 0.18, 0.66, 0.6), 0.008, "black", 6)
        rbox(f"IndF{s}", (s * 0.19, 0.66, 0.6), (0.03, 0.022, 0.04), "amber", bevel=0.006)
    rbox("TopClamp", (0, 0.83, ZF - 0.83 * k), (0.3, 0.035, 0.1), "satin", bevel=0.01)
    rbox("BottomClamp", (0, 0.62, ZF - 0.62 * k), (0.28, 0.04, 0.09), "satin", bevel=0.01)
    tube("Bar", [(0.27, 0.885, 0.38), (0.12, 0.875, 0.39), (0.0, 0.87, 0.38), (-0.12, 0.875, 0.39), (-0.27, 0.885, 0.38)], 0.012, "black", res=6)
    rbox("Dash", (0, 0.88, 0.43), (0.15, 0.05, 0.09), "black", bevel=0.01, rx=-0.6)
    rbox("Headlamp", (0, 0.66, 0.6), (0.22, 0.17, 0.12), "black", bevel=0.03, rx=0.15)
    rbox("Lens", (0, 0.655, 0.665), (0.17, 0.11, 0.01), "head", bevel=0.01, rx=0.15)
    cage("Screen", [(0.6, 0.1, 0.07, 0.74, 0.75), (0.54, 0.09, 0.06, 0.83, 0.84)], "paintU", subsurf=1)
    arc_strip("FrontGuard", ZF, R + 0.04, 0.45, 2.05, 0.13, "paintU")
    arc_strip("Hugger", ZR, R + 0.03, 1.35, 2.4, 0.12, "black")
    return len(bpy.data.objects)


def export():
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, use_selection=False)
    print("exported", OUT)


if __name__ == "__main__":
    print("built", build(), "objects")
    export()
