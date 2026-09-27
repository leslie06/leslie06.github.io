# Roof-top things of Beijing's buildings, low-poly, for the city's roofs (city/Buildings.ts `clutter` places them):
#   tank       a steel water tank on a frame of I-beams, with a ladder and a hatch
#   solar      a 太阳能热水器: a row of evacuated glass tubes on an angle-iron frame, the long tank along their top
#   ac         an AC condenser: a cabinet with the fan's round grille on top, fins down its back, on two rails
#   cooling    an office's cooling tower: a louvred box, the fan stack and its grille on top
#   dish       a satellite dish on a post, turned south
#   mast       an antenna mast: a lattice of three legs with cross bars and two dipoles
#   vent       an exhaust fan: a hooded box on a short duct
#
#   blender -b -P scripts/blender/props/roof.py -- [--out .scratch/blender/roof.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/roof.glb src/city/visual/roofprops.json --group
#
# Written in the game's frame (+Y up; each thing at the origin on the roof, its front towards -Z, which the
# placement turns to face south); material names are colours the game looks up (Buildings.ts ROOF_COLOURS).

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "roof.glb")
M = {}
G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


class Part:
    """Faces for one thing, per material; turned into one object per material named '<thing>__<material>'."""

    def __init__(self, name):
        self.name = name
        self.bm = {}

    def _bm(self, mat):
        return self.bm.setdefault(mat, bmesh.new())

    def box(self, c, h, mat, rot=0.0, skip=()):
        """A box at c with half sizes h (x, y, z), turned `rot` about y."""
        bm = self._bm(mat)
        ca, sa = math.cos(rot), math.sin(rot)
        P = lambda x, y, z: bm.verts.new((c[0] + x * ca + z * sa, c[1] + y, c[2] - x * sa + z * ca))   # noqa: E731
        v = [P(x, y, z) for y in (-h[1], h[1]) for z in (-h[2], h[2]) for x in (-h[0], h[0])]
        faces = {"-y": (0, 1, 3, 2), "+y": (4, 6, 7, 5), "-z": (0, 4, 5, 1), "+z": (2, 3, 7, 6), "-x": (0, 2, 6, 4), "+x": (1, 5, 7, 3)}
        for k, f in faces.items():
            if k not in skip:
                bm.faces.new([v[i] for i in f])

    def cyl(self, a, b, r, mat, sides=8, caps=(False, True), r2=None):
        bm = self._bm(mat)
        a, b = Vector(a), Vector(b)
        ax = (b - a).normalized()
        helper = Vector((1, 0, 0)) if abs(ax.y) > 0.9 else Vector((0, 1, 0))
        e1 = ax.cross(helper).normalized()
        e2 = ax.cross(e1).normalized()
        r2 = r if r2 is None else r2
        ra = [bm.verts.new(a + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * r) for i in range(sides)]
        rb = [bm.verts.new(b + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * r2) for i in range(sides)]
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        if caps[0]:
            bm.faces.new(ra[::-1])
        if caps[1] and r2 > 1e-4:
            bm.faces.new(rb)

    def disc(self, c, r, mat, sides=12, up=True, y_axis=True, normal=None):
        """A flat disc facing `normal` (default up)."""
        bm = self._bm(mat)
        n = Vector(normal or (0, 1 if up else -1, 0)).normalized()
        helper = Vector((1, 0, 0)) if abs(n.y) > 0.9 else Vector((0, 1, 0))
        e1 = n.cross(helper).normalized()
        e2 = n.cross(e1).normalized()
        vs = [bm.verts.new(Vector(c) + (e1 * math.cos(2 * math.pi * i / sides) + e2 * math.sin(2 * math.pi * i / sides)) * r) for i in range(sides)]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()

    def objects(self):
        for mat, bm in self.bm.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f"{self.name}__{mat}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(M[mat])
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(f"{self.name}__{mat}", me)
            ob.matrix_world = G2B
            bpy.context.scene.collection.objects.link(ob)


def tank():
    p = Part("tank")
    for x in (-0.9, 0.9):                       # the stand: two I-beams across, four short legs
        p.box((x, 0.5, 0), (0.08, 0.06, 1.2), "steel", skip=("-y",))
        for z in (-1.0, 1.0):
            p.box((x, 0.22, z), (0.07, 0.22, 0.07), "steel", skip=("-y", "+y"))
    p.cyl((0, 0.56, 0), (0, 2.5, 0), 1.15, "tank", sides=10, caps=(False, False))
    p.cyl((0, 2.5, 0), (0, 2.72, 0), 1.15, "tank", sides=10, caps=(False, True), r2=0.35)
    p.cyl((0, 1.35, 0), (0, 1.41, 0), 1.18, "steel", sides=10, caps=(False, False))    # a hoop
    for x in (-0.22, 0.22):                     # the ladder up its front
        p.box((x, 1.6, -1.2), (0.025, 1.05, 0.025), "steel", skip=("-y", "+y"))
    for k in range(4):
        p.box((0, 0.9 + 0.45 * k, -1.2), (0.22, 0.015, 0.015), "steel", skip=("-x", "+x"))
    p.cyl((0.8, 0.9, 0.5), (1.6, 0.9, 0.5), 0.06, "pipe", sides=4, caps=(False, False))
    p.cyl((1.6, 0.9, 0.5), (1.6, 0.0, 0.5), 0.06, "pipe", sides=4, caps=(False, False))
    return p


def solar():
    p = Part("solar")
    t = math.radians(42)                         # the tubes' tilt: low end to the south (-z)
    L = 1.8
    dz, dy = math.cos(t) * L, math.sin(t) * L
    low, high = Vector((0, 0.35, -dz / 2)), Vector((0, 0.35 + dy, dz / 2))
    n = 10
    for i in range(n):
        x = -1.05 + 2.1 * i / (n - 1)
        p.cyl(low + Vector((x, 0, 0)), high + Vector((x, 0, 0)), 0.055, "glass", sides=3, caps=(False, False))
    p.cyl(high + Vector((-1.2, 0.12, 0.12)), high + Vector((1.2, 0.12, 0.12)), 0.2, "white", sides=8, caps=(True, True))
    p.box((0, 0.3, -dz / 2), (1.15, 0.03, 0.05), "steel")          # the foot rail
    for x in (-1.1, 1.1):                                            # frame: legs and a diagonal each side
        p.box((x, (0.35 + dy) / 2, dz / 2 + 0.05), (0.025, (0.35 + dy) / 2, 0.025), "steel", skip=("-y", "+y"))
        p.cyl((x, 0.3, -dz / 2), (x, 0.3 + dy, dz / 2), 0.02, "steel", sides=3, caps=(False, False))
    return p


def ac():
    p = Part("ac")
    p.box((0, 0.44, 0), (0.45, 0.36, 0.3), "white", skip=("-y",))
    p.disc((0, 0.805, 0), 0.26, "grille", sides=8)
    p.box((0, 0.44, 0.301), (0.4, 0.3, 0.001), "grille", skip=("-z", "-x", "+x", "-y", "+y"))   # the fins at the back
    p.box((0, 0.44, -0.301), (0.12, 0.08, 0.001), "badge", skip=("+z", "-x", "+x", "-y", "+y"))
    for x in (-0.35, 0.35):
        p.box((x, 0.04, 0), (0.03, 0.04, 0.4), "steel", skip=("-y", "-z", "+z"))
    return p


def cooling():
    p = Part("cooling")
    p.box((0, 1.2, 0), (1.6, 1.2, 1.6), "louvre", skip=("+y", "-y"))
    p.box((0, 2.45, 0), (1.65, 0.06, 1.65), "white")
    p.cyl((0, 2.5, 0), (0, 3.2, 0), 1.2, "white", sides=16, caps=(False, False), r2=1.1)
    p.disc((0, 3.15, 0), 1.08, "grille", sides=16)
    for x in (-1.3, 1.3):
        p.box((x, 0.08, 0), (0.1, 0.08, 1.7), "steel")
    p.cyl((1.6, 0.6, 0.8), (2.4, 0.6, 0.8), 0.15, "pipe", sides=6)
    p.cyl((1.6, 0.9, -0.8), (2.4, 0.9, -0.8), 0.15, "pipe", sides=6)
    return p


def dish():
    p = Part("dish")
    p.box((0, 0.05, 0), (0.25, 0.05, 0.25), "steel")
    p.cyl((0, 0.1, 0), (0, 1.0, 0), 0.04, "steel", sides=6)
    # the dish: a shallow cone facing south and up (towards -z, 35 degrees)
    a = math.radians(35)
    n = Vector((0, math.sin(a), -math.cos(a)))
    c = Vector((0, 1.05, 0))
    p.cyl(c + n * 0.14, c - n * 0.02, 0.5, "white", sides=12, caps=(False, False), r2=0.08)
    p.disc(c + n * 0.14, 0.5, "white", sides=12, normal=tuple(n))
    p.cyl(c + n * 0.1, c + n * 0.55, 0.012, "steel", sides=4)
    p.box(tuple(c + n * 0.58), (0.05, 0.05, 0.05), "grille")
    return p


def mast():
    p = Part("mast")
    H = 4.5
    legs = [(0.18 * math.cos(2 * math.pi * k / 3), 0.18 * math.sin(2 * math.pi * k / 3)) for k in range(3)]
    for x, z in legs:
        p.cyl((x, 0, z), (x * 0.4, H, z * 0.4), 0.02, "steel", sides=4, caps=(False, False))
    for k in range(3):
        y = 0.8 + k * 1.3
        s = 1 - 0.6 * y / H
        for i in range(3):
            (x0, z0), (x1, z1) = legs[i], legs[(i + 1) % 3]
            p.cyl((x0 * s, y, z0 * s), (x1 * s, y, z1 * s), 0.01, "steel", sides=3, caps=(False, False))
    for y, w in ((H - 0.5, 0.9), (H - 1.3, 0.6)):
        p.cyl((-w, y, 0), (w, y, 0), 0.018, "steel", sides=4)
    p.box((0, H + 0.05, 0), (0.04, 0.05, 0.04), "red")
    return p


def vent():
    p = Part("vent")
    p.cyl((0, 0, 0), (0, 0.5, 0), 0.2, "steel", sides=8)
    p.box((0, 0.7, 0), (0.35, 0.2, 0.35), "white")
    p.box((0, 0.93, 0), (0.42, 0.03, 0.42), "white")
    p.box((0, 0.65, -0.355), (0.28, 0.12, 0.005), "grille")
    return p


COLOURS = dict(steel="#8a8d8f", tank="#a9c3d1", pipe="#6e6f6c", glass="#1d2a36", white="#e2e3de",
               grille="#34383b", badge="#9aa3a8", louvre="#a7aaa4", red="#c0302a")


def build():
    clear_file()
    for k, col in COLOURS.items():
        M[k] = material(k, col, 0.6)
    things = [tank(), solar(), ac(), cooling(), dish(), mast(), vent()]
    for t in things:
        t.objects()
    return len(things)


if __name__ == "__main__":
    print("built", build(), "things")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB")
    print("exported", OUT)
