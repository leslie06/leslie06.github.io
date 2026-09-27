# 兔儿爷, the clay Rabbit God of Beijing's Mid-Autumn fairs, for the collectibles (collect/index.ts): on a gold
# lotus seat, a red robe under gilt armour and shoulder plates, a white rabbit's face with blushed cheeks and
# long ears lined in pink, a gilt helmet with a red plume, the pestle (药杵) in his right hand, and the four
# pennants (靠旗) of an opera general fanned out on his back. 0.95 m, about 1.5k triangles.
#
#   blender -b -P scripts/blender/props/rabbit.py -- [--out .scratch/blender/rabbit.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/rabbit.glb src/collect/rabbit.json
#
# Written in the game's frame for the figure (+Y up, the face towards +Z, x across) and turned into
# Blender's here; the material names are what collect/index.ts colours and lights.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "rabbit.glb")
M = {}
G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def P(x, y, z):
    return Vector((-x, z, y))


def obj(name, bm, mat, m=Matrix(), smooth=True, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = G2B @ m
    if subsurf:
        md = ob.modifiers.new("sub", "SUBSURF")
        md.levels = md.render_levels = subsurf
    return ob


def lathe(name, prof, mat, segs=16, at=(0, 0, 0)):
    """A surface of revolution about the figure's up axis: prof [(radius, height), ...] bottom to top."""
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * i / segs), y, r * math.sin(2 * math.pi * i / segs))) for i in range(segs)] for r, y in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], b[i], b[j], a[j]))
    for ring, up in ((rings[0], False), (rings[-1], True)):
        if prof[0 if not up else -1][0] > 1e-3:
            f = bm.faces.new(ring if up else ring[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, mat, Matrix.Translation(at))


def ell(name, c, r, mat, rot=Matrix(), u=12, v=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    for vert in bm.verts:
        vert.co = Vector((vert.co.x * r[0], vert.co.y * r[1], vert.co.z * r[2]))
    return obj(name, bm, mat, Matrix.Translation(c) @ rot)


def cyl(name, a, b, r, mat, segs=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=d.length)
    # create_cone builds along z: stand it along d
    return obj(name, bm, mat, Matrix.Translation((a + b) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4())


def flag(name, tip, out, mat):
    """A pennant: a triangle hanging from the pole's top, streaming outward (out = +1 or -1 in x), given a thickness."""
    tip = Vector(tip)
    bm = bmesh.new()
    a = bm.verts.new(tip)
    b = bm.verts.new(tip - Vector((0, 0.16, 0)))
    c = bm.verts.new(tip + Vector((0.12 * out, -0.05, -0.05)))
    bm.faces.new((a, b, c))
    ob = obj(name, bm, mat, smooth=False)
    md = ob.modifiers.new("thick", "SOLIDIFY")
    md.thickness = 0.008
    return ob


def build():
    clear_file()
    for k, col in dict(base="#d9a520", lotus="#3c8a4a", robe="#c8231d", gold="#e8b62a", face="#f6f1e6", blush="#f08aa0",
                       mouth="#e04a6a", eyes="#1a1a1a", wood="#6b4a2a", plume="#d81e1e", flag1="#2c6fd6", flag2="#2a9d5a",
                       flag3="#e2b13c", flag4="#c8231d").items():
        M[k] = material(k, col, 0.5)
    lathe("Seat", [(0.0, 0.0), (0.2, 0.0), (0.23, 0.03), (0.22, 0.07), (0.17, 0.09), (0.0, 0.09)], "base", 20)
    for i in range(10):
        a = 2 * math.pi * i / 10
        ell(f"Petal{i}", (0.2 * math.cos(a), 0.06, 0.2 * math.sin(a)), (0.05, 0.03, 0.02), "lotus", Matrix.Rotation(-a + math.pi / 2, 4, "Y"), 8, 5)
    lathe("Robe", [(0.19, 0.08), (0.2, 0.14), (0.17, 0.24), (0.13, 0.32), (0.11, 0.36)], "robe", 16)
    lathe("Armour", [(0.115, 0.34), (0.13, 0.4), (0.14, 0.47), (0.12, 0.52), (0.07, 0.54)], "gold", 16)
    lathe("Belt", [(0.12, 0.35), (0.125, 0.37), (0.12, 0.39)], "robe", 16)
    for s in (1, -1):
        ell(f"Shoulder{s}", (s * 0.13, 0.49, 0.0), (0.07, 0.035, 0.07), "gold", Matrix.Rotation(s * 0.4, 4, "Z"), 10, 6)
        cyl(f"Arm{s}", (s * 0.15, 0.47, 0.0), (s * 0.13, 0.38, 0.08), 0.035, "robe", 8)
        ell(f"Hand{s}", (s * 0.12, 0.37, 0.1), (0.03, 0.03, 0.03), "face", Matrix(), 8, 5)
    cyl("Pestle", (-0.12, 0.27, 0.1), (-0.12, 0.6, 0.12), 0.018, "wood", 8)
    ell("PestleHead", (-0.12, 0.62, 0.12), (0.03, 0.04, 0.03), "wood", Matrix(), 8, 5)
    # the head
    ell("Head", (0.0, 0.63, 0.0), (0.12, 0.13, 0.12), "face", Matrix(), 16, 10)
    ell("Muzzle", (0.0, 0.6, 0.095), (0.055, 0.04, 0.04), "face", Matrix(), 10, 6)
    ell("Nose", (0.0, 0.615, 0.132), (0.016, 0.012, 0.01), "mouth", Matrix(), 6, 4)
    ell("Mouth", (0.0, 0.585, 0.128), (0.02, 0.006, 0.008), "mouth", Matrix(), 6, 4)
    for s in (1, -1):
        ell(f"Eye{s}", (s * 0.045, 0.655, 0.1), (0.012, 0.016, 0.008), "eyes", Matrix(), 6, 4)
        ell(f"Cheek{s}", (s * 0.07, 0.6, 0.085), (0.025, 0.018, 0.008), "blush", Matrix.Rotation(s * 0.5, 4, "Y"), 8, 4)
        rot = Matrix.Rotation(-s * 0.22, 4, "Z")
        ell(f"Ear{s}", (s * 0.055, 0.86, -0.01), (0.035, 0.16, 0.025), "face", rot, 10, 8)
        ell(f"EarIn{s}", (s * 0.055, 0.86, 0.008), (0.02, 0.13, 0.012), "blush", rot, 8, 6)
    # the helmet and plume
    lathe("Helmet", [(0.125, 0.69), (0.115, 0.74), (0.08, 0.77), (0.03, 0.79), (0.0, 0.8)], "gold", 16)
    ell("Plume", (0.0, 0.82, 0.0), (0.03, 0.03, 0.03), "plume", Matrix(), 8, 5)
    # the four pennants on the back
    for i, (x, col) in enumerate(((-0.14, "flag1"), (-0.05, "flag2"), (0.05, "flag3"), (0.14, "flag4"))):
        root, tip = (x * 0.4, 0.42, -0.12), (x, 0.98 - abs(x) * 0.5, -0.2)
        cyl(f"Pole{i}", root, tip, 0.008, "wood", 5)
        flag(f"Flag{i}", tip, 1 if x > 0 else -1, col)
    return len(bpy.data.objects)


if __name__ == "__main__":
    print("built", build(), "objects")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True)
    print("exported", OUT)
