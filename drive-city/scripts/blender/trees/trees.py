# The four street trees, grown in Blender: a trunk and scaffold branches that fork and taper out to the edge
# of the species' crown, leaf cards hung at the branch tips (each card one of leaves.py's sprigs), in two
# levels - near (thin twigs, many cards) and mid (the scaffold, fewer bigger cards) - and the impostor, the
# near tree rendered from the side with the atlas, for the far level. Exported for scripts/vehicles/import.mjs
# (--group), which writes src/city/visual/trees.json.
#
#   blender -b -P scripts/blender/trees/leaves.py            (the sprigs)
#   node scripts/trees/atlas.mjs --no-impostors .scratch/trees/atlas-leaves.png
#   blender -b -P scripts/blender/trees/trees.py             (trees, impostor renders, .scratch/trees/trees.glb)
#   node scripts/trees/atlas.mjs                             (public/textures/trees/foliage.png)
#   node scripts/vehicles/import.mjs .scratch/trees/trees.glb src/city/visual/trees.json --group
#
# Frame: the game's (+Y up, x and z across), turned into Blender's here. The crown envelopes are the old
# model's (city/visual/Foliage.ts SPECIES) so a tree still stands where it fits between the street's lamps.

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
DIR = os.path.join(REPO, ".scratch", "trees")
ATLAS = os.path.join(DIR, "atlas-leaves.png")
W, H = 2048, 1024


def leaf_uv(s):
    """The species' sprite cell in the atlas (u0, v0, u1, v1), inset a little."""
    return (512 * s + 6) / W, 1 - (512 - 6) / H, (512 * (s + 1) - 6) / W, 1 - 6 / H


def bark_uv(s):
    return 1800 / W, 1 - (512 + 128 * (s + 1) - 4) / H, 2040 / W, 1 - (512 + 128 * s + 4) / H


# crown envelopes and trunk figures (the old model's)
SPECIES = [
    dict(name="huai", trunkH=3.0, trunkR=0.25, centre=(0, 5.6, 0), rx=3.4, ry=2.5, top=8.1, form="round", scaffolds=4, cards=(150, 60), size=(1.8, 2.6)),
    dict(name="poplar", trunkH=4.0, trunkR=0.22, centre=(0, 9.4, 0), rx=2.3, ry=5.8, top=15.0, form="column", scaffolds=14, cards=(165, 66), size=(1.5, 2.2)),
    dict(name="cypress", trunkH=1.4, trunkR=0.27, centre=(0, 5.0, 0), rx=2.3, ry=4.4, top=9.6, form="cone", scaffolds=10, cards=(165, 66), size=(1.45, 2.1)),
    dict(name="ginkgo", trunkH=3.4, trunkR=0.23, centre=(0, 7.2, 0), rx=2.6, ry=4.0, top=11.2, form="tiered", scaffolds=12, cards=(150, 60), size=(1.65, 2.4)),
]


VARIANTS = 3      # per species: the game picks one per tree in the vertex shader (BlenderTrees.ts)


def B(p):
    """Game (x, y up, z) to Blender (x, y, z up)."""
    return Vector((-p[0], p[2], p[1]))


class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def tube(self, a, b, r0, r1, sides, uvq):
        a, b = Vector(a), Vector(b)
        ax = (b - a).normalized()
        helper = Vector((1, 0, 0)) if abs(ax.y) > 0.9 else Vector((0, 1, 0))
        e1 = ax.cross(helper).normalized()
        e2 = ax.cross(e1).normalized()
        ra = [self.bm.verts.new(B(a + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * r0)) for i in range(sides)]
        rb = [self.bm.verts.new(B(b + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * r1)) for i in range(sides)]
        for i in range(sides):
            j = (i + 1) % sides
            f = self.bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
            u0 = uvq[0] + (uvq[2] - uvq[0]) * i / sides
            u1 = uvq[0] + (uvq[2] - uvq[0]) * (i + 1) / sides
            for loop, uv in zip(f.loops, ((u0, uvq[1]), (u1, uvq[1]), (u1, uvq[3]), (u0, uvq[3]))):
                loop[self.uv].uv = uv
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[-sides:])

    def card(self, p, n, size, roll, uvq):
        n = Vector(n).normalized()
        helper = Vector((1, 0, 0)) if abs(n.y) > 0.9 else Vector((0, 1, 0))
        t1 = n.cross(helper).normalized()
        t2 = n.cross(t1).normalized()
        c, s = math.cos(roll), math.sin(roll)
        a = (t1 * c + t2 * s) * (size / 2)
        b = (t1 * -s + t2 * c) * (size / 2)
        p = Vector(p)
        vs = [self.bm.verts.new(B(q)) for q in (p - a - b, p + a - b, p + a + b, p - a + b)]
        f = self.bm.faces.new(vs)
        for loop, uv in zip(f.loops, ((uvq[0], uvq[1]), (uvq[2], uvq[1]), (uvq[2], uvq[3]), (uvq[0], uvq[3]))):
            loop[self.uv].uv = uv

    def object(self, name, mat):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def inside(sp, p, k=1.0):
    """Whether p lies inside the species' crown envelope scaled by k."""
    c = Vector(sp["centre"])
    if sp["form"] == "cone":
        h = (p.y - 1.2) / (sp["top"] - 1.2)
        if h < 0 or h > 1:
            return False
        rad = (sp["rx"] * (1 - h) ** 0.85 + 0.25) * k
        return math.hypot(p.x, p.z) < rad
    d = Vector(((p.x - c.x) / sp["rx"], (p.y - c.y) / sp["ry"], (p.z - c.z) / sp["rx"]))
    return d.length < k


def shell(sp, r):
    """A point in the outer part of the crown (60-100% of the way out)."""
    c = Vector(sp["centre"])
    if sp["form"] == "cone":
        h = r.random() ** 0.8
        rad = (sp["rx"] * (1 - h) ** 0.85 + 0.25) * (0.55 + 0.45 * math.sqrt(r.random()))
        a = r.uniform(0, 2 * math.pi)
        return Vector((math.cos(a) * rad, 1.2 + (sp["top"] - 1.2) * h, math.sin(a) * rad))
    u, a = r.uniform(-1, 1), r.uniform(0, 2 * math.pi)
    w = math.sqrt(1 - u * u)
    t = 0.6 + 0.4 * math.sqrt(r.random())
    return Vector((c.x + w * math.cos(a) * sp["rx"] * t, c.y + u * sp["ry"] * t, c.z + w * math.sin(a) * sp["rx"] * t))


def grow(sp, r):
    """The skeleton: a list of segments (a, b, r0, r1, depth) and the tips (point, outward direction)."""
    segs, tips = [], []
    c = Vector(sp["centre"])
    base = Vector((0, 0, 0))
    lean = Vector((r.uniform(-0.12, 0.12), 0, r.uniform(-0.12, 0.12)))
    form = sp["form"]
    if form in ("column", "tiered", "cone"):
        # a leader to near the top, the scaffold branches along it
        top = Vector((lean.x * 3, sp["top"] - (1.2 if form != "cone" else 0.6), lean.z * 3))
        n = 6
        prev = base
        for i in range(1, n + 1):
            q = base.lerp(top, i / n)
            r0 = sp["trunkR"] * (1 - 0.8 * (i - 1) / n)
            segs.append((prev, q, r0, sp["trunkR"] * (1 - 0.8 * i / n), 0))
            prev = q
        y0 = sp["trunkH"]
        for k in range(sp["scaffolds"]):
            t = k / max(1, sp["scaffolds"] - 1)
            y = y0 + (sp["top"] - 1.5 - y0) * t
            at = base.lerp(top, (y - base.y) / (top.y - base.y))
            a = k * 2.4 + r.uniform(-0.4, 0.4)
            up = {"column": 0.9, "tiered": 0.55, "cone": 0.35}[form]
            reach = {"column": 1.6, "tiered": 2.4 * (1 - 0.6 * t), "cone": 2.1 * (1 - 0.8 * t) + 0.3}[form]
            d = Vector((math.cos(a), up, math.sin(a))).normalized()
            branch(sp, r, at, d, reach, sp["trunkR"] * 0.35 * (1 - 0.5 * t), 1, segs, tips)
    else:
        # a round crown: a trunk forking at trunkH into scaffolds that spread up and out
        fork = Vector((lean.x * sp["trunkH"], sp["trunkH"], lean.z * sp["trunkH"]))
        segs.append((base, fork, sp["trunkR"], sp["trunkR"] * 0.72, 0))
        for k in range(sp["scaffolds"]):
            a = k * 2 * math.pi / sp["scaffolds"] + r.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), 1.1, math.sin(a))).normalized()
            branch(sp, r, fork, d, 2.2, sp["trunkR"] * 0.55, 1, segs, tips)
    return segs, tips


def branch(sp, r, at, d, length, rad, depth, segs, tips):
    end = at + d * length
    # keep within the crown: shorten until the tip is inside
    k = 1.0
    while not inside(sp, end, 1.0) and k > 0.3:
        k -= 0.1
        end = at + d * length * k
    segs.append((at, end, rad, rad * 0.6, depth))
    if depth >= 3 or rad < 0.03:
        tips.append((end, d))
        return
    n = 2 if depth < 2 else 3
    for i in range(n):
        a = r.uniform(0, 2 * math.pi)
        side = Vector((math.cos(a), 0, math.sin(a)))
        nd = (d + side * 0.8 + Vector((0, 0.25, 0))).normalized()
        branch(sp, r, end, nd, length * 0.62, rad * 0.6, depth + 1, segs, tips)
    tips.append((end, d))


def build_level(sp, s, lod, segs, tips, r, mats, tag=""):
    bark, leaf = Mesh(), Mesh()
    buv, luv = bark_uv(s), leaf_uv(s)
    for a, b, r0, r1, depth in segs:
        if lod == "mid" and depth > 1:
            continue
        sides = (7 if depth == 0 else 5 if depth == 1 else 3) if lod == "near" else (5 if depth == 0 else 3)
        bark.tube(a, b, max(0.015, r0), max(0.01, r1), sides, buv)
    c = Vector(sp["centre"])
    n_cards, size = (sp["cards"][0], sp["size"][0]) if lod == "near" else (sp["cards"][1], sp["size"][1])
    for i in range(n_cards):
        if i % 5 < 3:
            q = shell(sp, r)                      # over the crown's outer shell: a full crown, not clumps
        else:
            p, d = tips[i % len(tips)]
            q = p + Vector((r.uniform(-1, 1), r.uniform(-0.6, 0.8), r.uniform(-1, 1))) * 0.5
            if not inside(sp, q, 1.08):
                q = p
        out = Vector(((q.x - c.x) / sp["rx"], (q.y - c.y) / sp["ry"] * 0.8, (q.z - c.z) / sp["rx"]))
        if out.length < 1e-3:
            out = Vector((0, 1, 0))
        nrm = out.normalized() + Vector((r.uniform(-0.5, 0.5), r.uniform(-0.3, 0.6), r.uniform(-0.5, 0.5)))
        leaf.card(q, nrm, size * r.uniform(0.8, 1.2), r.uniform(0, 2 * math.pi), luv)
    ob_b = bark.object(f"{sp['name']}_{lod}{tag}__bark", mats["bark"])
    ob_l = leaf.object(f"{sp['name']}_{lod}{tag}__leaf", mats["leaf"])
    return ob_b, ob_l


def atlas_material(name, img, alpha):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        try:
            m.blend_method = "CLIP"
        except Exception:
            pass
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def render_impostor(sp, objs):
    """The near tree seen from the side (orthographic, transparent), 448 x 512, for the far level."""
    sc = bpy.context.scene
    for o in sc.objects:
        o.hide_render = o not in objs and o.type == "MESH"
    xs, ys = [], []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(abs(w.x))
            xs.append(abs(w.y))
            ys.append(w.z)
    half = max(xs) + 0.2
    top = max(ys) + 0.3
    # the cell is 448 x 512: frame the whole height, and wider if the crown needs it; the ground at the bottom edge
    frame = max(top, 2 * half * 512 / 448)
    cam = sc.camera
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = frame
    cam.location = (0, -30, frame / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = 448, 512
    sc.render.filepath = os.path.join(DIR, f"imp_{sp['name']}.png")
    bpy.ops.render.render(write_still=True)
    return dict(height=round(frame, 3), width=round(frame * 448 / 512, 3))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 32
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.0
    sun.rotation_euler = (0.9, 0.2, -0.6)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    img = bpy.data.images.load(ATLAS)
    mats = dict(bark=atlas_material("bark", img, False), leaf=atlas_material("leaf", img, True))
    meta = {}
    for s, base in enumerate(SPECIES):
        for v in range(VARIANTS):
            # each variant its own skeleton and a crown a little wider or taller, leaning its own way
            sp = dict(base, rx=base["rx"] * (1.0, 1.12, 0.9)[v], ry=base["ry"] * (1.0, 0.9, 1.1)[v],
                      centre=(base["centre"][0], base["centre"][1] * (1.0, 0.96, 1.04)[v], base["centre"][2]))
            r = random.Random(700 + s * 31 + v * 1009)
            segs, tips = grow(sp, r)
            near = build_level(sp, s, "near", segs, tips, random.Random(900 + s + v * 97), mats, f"_v{v}")
            build_level(sp, s, "mid", segs, tips, random.Random(950 + s + v * 97), mats, f"_v{v}")
            if v == 0:
                meta[sp["name"]] = render_impostor(sp, near)
            print("tree", sp["name"], v, len(segs), "segments", len(tips), "tips")
    for o in sc.objects:
        o.hide_render = False
    with open(os.path.join(DIR, "impostors.json"), "w") as f:
        json.dump(meta, f)
    for o in list(sc.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.ops.export_scene.gltf(filepath=os.path.join(DIR, "trees.glb"), export_format="GLB")
    print("exported trees.glb")


if __name__ == "__main__":
    main()
