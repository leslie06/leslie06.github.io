# The street trees' leaf sprites, rendered in Blender: for each species a sprig of modelled leaves - 国槐's
# pinnate leaves of small oval leaflets, the poplar's triangular leaves (some turned to show their silver
# backs), 侧柏's flat sprays of scale leaves, the ginkgo's fans on short spurs - lit by an even sky with a
# little sun, rendered straight down (orthographic, 1 x 1 m, transparent) with Cycles. scripts/trees/atlas.mjs
# packs them with the bark swatches and the trees' impostors into public/textures/trees/foliage.png.
#
#   blender -b -P scripts/blender/trees/leaves.py -- [--out .scratch/trees]

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "trees")
SIZE = 512


def srgb_to_lin(h):
    h = h.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def outline(shape, n=16):
    """A leaf blade's outline in its own frame: base at the origin, tip along +y, length 1."""
    pts = []
    for i in range(n + 1):
        t = i / n
        if shape == "oval":
            w = 0.36 * math.sin(math.pi * t) ** 0.9
        elif shape == "delta":           # poplar: broad base, pointed tip, a toothed edge
            w = 0.55 * (1 - t) ** 0.8 * min(1, t * 5) * (1 + 0.06 * math.sin(t * 40))
        elif shape == "scale":
            w = 0.18 * math.sin(math.pi * t)
        elif shape == "fan":             # ginkgo: a fan on a stalk
            a = -0.9 + 1.8 * t
            pts.append((0.9 * math.sin(a), 0.35 + 0.65 * math.cos(a) * (0.95 + 0.05 * math.sin(t * 30))))
            continue
        pts.append((w, t))
    if shape == "fan":
        return [(0.0, 0.0), (0.05, 0.35)] + pts[::-1] + [(-0.05, 0.35)]
    right = pts
    left = [(-x, y) for x, y in reversed(pts[1:-1])]
    return right + left


class Sprig:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Col")

    def blade(self, shape, at, direction, length, colour, lean=0.0, twist=0.0, curl=0.12):
        """One leaf: its outline placed at `at`, pointing along `direction` (in the xy plane), tilted."""
        pts = outline(shape)
        a = math.atan2(direction[1], direction[0]) - math.pi / 2
        m = Matrix.Translation(Vector(at)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(lean, 4, "X") @ Matrix.Rotation(twist, 4, "Y")
        vs = [self.bm.verts.new(m @ Vector((x * length, y * length, curl * length * (x * x * 4 + y * y * 0.5)))) for x, y in pts]
        f = self.bm.faces.new(vs)
        c = (*srgb_to_lin(colour), 1.0)
        for loop in f.loops:
            loop[self.col] = c
        return f

    def stem(self, a, b, r, colour):
        a, b = Vector(a), Vector(b)
        d = b - a
        side = d.cross(Vector((0, 0, 1))).normalized() * r
        vs = [self.bm.verts.new(p) for p in (a - side, a + side, b + side * 0.6, b - side * 0.6)]
        f = self.bm.faces.new(vs)
        c = (*srgb_to_lin(colour), 1.0)
        for loop in f.loops:
            loop[self.col] = c

    def object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.8
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def rng_colour(r, cols):
    return cols[r.randrange(len(cols))]


def huai(s, r):
    """国槐: pinnate leaves (a rachis, 9-13 oval leaflets in pairs and one at the tip) on a forked twig."""
    greens = ["#5a8c3b", "#679a44", "#4f7d34", "#72a54b", "#5d9140"]
    for k in range(30):
        a = r.uniform(0, 2 * math.pi)
        base = Vector((0.06 * math.cos(a), 0.06 * math.sin(a), 0))
        d = Vector((math.cos(a), math.sin(a), 0))
        L = r.uniform(0.3, 0.44)
        s.stem(base, base + d * L, 0.003, "#6d7d48")
        n = r.choice((4, 5, 6))
        side = Vector((-d.y, d.x, 0))
        for i in range(n):
            t = 0.15 + 0.8 * i / n
            p = base + d * (L * t)
            for sg in (-1, 1):
                dirn = (d * 0.35 + side * sg).normalized()
                s.blade("oval", tuple(p + Vector((0, 0, 0.01 * i + 0.002 * k))), dirn, r.uniform(0.05, 0.068), rng_colour(r, greens), lean=r.uniform(-0.3, 0.3), twist=sg * 0.3)
        s.blade("oval", tuple(base + d * L), tuple(d), 0.06, rng_colour(r, greens), lean=0.2)


def poplar(s, r):
    """杨树: triangular leaves on long stalks round a twig, a quarter turned to their silver backs."""
    tops, backs = ["#568a3a", "#62963f", "#4c7d33", "#6a9d46"], ["#adbc9c", "#b8c5a8", "#a2b392"]
    twigs = []
    for k in range(4):
        a = k * math.pi / 2 + r.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        s.stem(d * 0.02, d * 0.34, 0.005, "#7a7663")
        twigs.append(d)
    for k in range(110):
        d0 = twigs[k % 4]
        at = d0 * r.uniform(0.06, 0.32)
        a = r.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), 0))
        stalk = r.uniform(0.04, 0.08)
        s.stem(at, at + d * stalk, 0.002, "#6e7a4a")
        silver = r.random() < 0.25
        s.blade("delta", tuple(at + d * stalk + Vector((0, 0, r.uniform(0, 0.05)))), tuple(d), r.uniform(0.09, 0.13),
                rng_colour(r, backs if silver else tops), lean=r.uniform(-0.5, 0.5), twist=r.uniform(-0.6, 0.6), curl=0.08)


def cypress(s, r):
    """侧柏: flat vertical sprays - a branching frond of tight scale leaves."""
    greens = ["#4f7a4a", "#5b8753", "#466e42", "#63905a"]

    def frond(at, d, L, depth):
        at, d = Vector(at), Vector(d).normalized()
        side = Vector((-d.y, d.x, 0))
        n = int(L / 0.018)
        for i in range(n):
            p = at + d * (L * i / n)
            for sg in (-1, 1):
                s.blade("scale", tuple(p + Vector((0, 0, 0.004 * depth))), tuple((d + side * sg * 0.7).normalized()), 0.028 * (1 - 0.5 * i / n) + 0.01,
                        rng_colour(r, greens), curl=0.0)
            if depth < 2 and i % 5 == 2:
                for sg in (-1, 1):
                    frond(p, d + side * sg * 0.9, L * 0.45, depth + 1)
    for k in range(9):
        a = k * 2 * math.pi / 9 + r.uniform(-0.3, 0.3)
        frond((0, 0, 0.01 * k), (math.cos(a), math.sin(a), 0), r.uniform(0.32, 0.42), 0)


def ginkgo(s, r):
    """银杏: fans in bunches of four or five on short spurs along two twigs."""
    greens = ["#86ad42", "#94ba4b", "#7aa13a", "#a2c255", "#b0c65a"]
    for tw in range(3):
        a0 = tw * math.pi / 3 + r.uniform(-0.2, 0.2)
        d = Vector((math.cos(a0), math.sin(a0), 0))
        s.stem(-d * 0.42, d * 0.42, 0.007, "#5e5040")
        for k in range(16):
            p = d * r.uniform(-0.38, 0.38)
            for j in range(r.choice((4, 5))):
                a = r.uniform(0, 2 * math.pi)
                dd = Vector((math.cos(a), math.sin(a), 0))
                stalk = r.uniform(0.03, 0.06)
                s.stem(p, p + dd * stalk, 0.0018, "#7a8a4a")
                s.blade("fan", tuple(p + dd * stalk + Vector((0, 0, r.uniform(0, 0.05)))), tuple(dd), r.uniform(0.07, 0.09), rng_colour(r, greens),
                        lean=r.uniform(-0.4, 0.4), twist=r.uniform(-0.4, 0.4), curl=0.05)


SPECIES = [("huai", huai), ("poplar", poplar), ("cypress", cypress), ("ginkgo", ginkgo)]


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.05
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 1.2
    sun.rotation_euler = (0.5, -0.4, 0)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.0
    cam.location = (0, 0, 3)
    sc.collection.objects.link(cam)
    sc.camera = cam


def main():
    os.makedirs(OUT, exist_ok=True)
    for i, (name, fn) in enumerate(SPECIES):
        setup()
        s = Sprig()
        fn(s, random.Random(40 + i))
        s.object(name)
        bpy.context.scene.render.filepath = os.path.join(OUT, f"leaf_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name)


if __name__ == "__main__":
    main()
