# The cars' wheels, modelled in Blender: an alloy (the sedan, hatch, SUV and MPV) and a steel wheel (the bus and
# the truck), each at one nominal size that vehicle/Bodies.ts scales to a spec's radius and width. A tyre is a
# lathe with a crowned tread, four circumferential grooves, rounded shoulders, a bulging sidewall with a raised
# lettering band and the bead; the alloy has a polished lip, a dark barrel, five twin spokes that dish in to the
# hub, lug nuts and a centre cap, and a brake disc behind; the steel wheel a dished disc with hand holes, a
# protruding hub with ten nuts.
#
#   blender -b -P scripts/blender/vehicles/wheel.py -- [--out .scratch/blender/wheels.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/wheels.glb src/vehicle/models/wheels.json --group
#
# Game body frame (+X out of the rim face, the axle along X, the wheel's centre at the origin); objects are named
# "<style>_<level>__<part>" (alloy_hi, alloy_lo, steel_hi, steel_lo), materials are the surfaces Bodies.ts maps.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import REPO, args, clear_file, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "wheels.glb")
G2B = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
MATS = dict(tyre=("#1a1a1b", 0.88, 0.0), wall=("#232324", 0.8, 0.0), alloy=("#c7cace", 0.26, 1.0), lip=("#e2e5e8", 0.12, 1.0),
            dark=("#2b2c2e", 0.55, 0.5), disc=("#55585c", 0.35, 0.85), cap=("#d9dcdf", 0.12, 1.0), steel=("#8e9297", 0.45, 0.7),
            nut=("#b4b8bc", 0.3, 0.9))
M = {}
ALLOY = dict(R=0.32, W=0.21, rim=0.205)
STEEL = dict(R=0.48, W=0.28, rim=0.29)


def mesh_obj(name, verts, faces, mats, sharp=40):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    names = list(dict.fromkeys(mats))
    for n in names:
        me.materials.append(M[n])
    for p, n in zip(me.polygons, mats):
        p.material_index = names.index(n)
        p.use_smooth = True
    me.validate()
    # every part is wound facing out by construction (lathe: normal = dx r - dr x along the profile)
    if sharp:
        me.set_sharp_from_angle(angle=math.radians(sharp))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = G2B
    return ob


def lathe(name, profile, seg, closed_ends=False):
    """Revolve [(r, x, material)] about the X axis; segment i runs from point i to i + 1 in that point's material."""
    verts, faces, mats = [], [], []
    n = len(profile)
    for k in range(seg):
        a = 2 * math.pi * k / seg
        c, s = math.cos(a), math.sin(a)
        for r, x, _ in profile:
            verts.append((x, r * c, r * s))
    for k in range(seg):
        k2 = (k + 1) % seg
        for i in range(n - 1):
            if profile[i][0] < 1e-6 and profile[i + 1][0] < 1e-6:
                continue
            faces.append((k * n + i, k2 * n + i, k2 * n + i + 1, k * n + i + 1))
            mats.append(profile[i][2])
    # merge the points on the axis
    return mesh_obj(name, verts, faces, mats)


def tyre_profile(R, W, rim, hi):
    """Inner bead -> inner sidewall -> tread with grooves -> outer sidewall (with the lettering band) -> outer bead."""
    w = W / 2
    side = R - rim
    pts = []

    def wall(sgn):
        # sidewall from the bead out to the shoulder, bulging, the outer one with a raised band
        out = []
        steps = [(0.0, 0.9), (0.3, 1.01), (0.62, 1.035), (0.9, 0.95)] if hi else [(0.0, 0.9), (0.8, 1.0)]
        for f, bulge in steps:
            r = rim + 0.004 + (side - 0.004) * f
            x = sgn * w * bulge
            if sgn > 0 and hi and 0.4 < f < 0.7:
                x += 0.002
            out.append((r, x, "wall" if f < 0.85 else "tyre"))
        return out

    inner = wall(-1)
    outer = list(reversed(wall(1)))
    # shoulders and tread
    tread = []
    sh = min(0.05, side * 0.35)
    for i in range(2 if hi else 0):
        a = (i + 1) / 3 * math.pi / 2
        tread.append((R - sh + math.sin(a) * sh, -(w - sh + math.cos(a) * sh) * 0.98, "tyre"))
    grooves = (-0.2, 0.2) if hi else ()
    xs = [-(w - sh) * 0.98]
    for g in grooves:
        xs += [g * W - 0.005, g * W - 0.004, g * W + 0.004, g * W + 0.005]
    xs.append((w - sh) * 0.98)
    for j, x in enumerate(xs):
        crown = 0.004 * (1 - (x / w) ** 2)
        depth = 0.009 if (1 <= j < len(xs) - 1 and (j - 1) % 4 in (1, 2)) else 0.0
        tread.append((R + crown - depth, x, "tyre"))
    for i in reversed(range(2 if hi else 0)):
        a = (i + 1) / 3 * math.pi / 2
        tread.append((R - sh + math.sin(a) * sh, (w - sh + math.cos(a) * sh) * 0.98, "tyre"))
    pts = inner + tread + outer
    return pts


def spoke_loft(name, ang, rs, hw, xf, xb, mat):
    """One spoke: rectangular sections at radii rs (half width hw(t), front xf(t), back xb(t)), angle ang(t)."""
    verts, faces = [], []
    n = len(rs)
    for i, r in enumerate(rs):
        t = i / (n - 1)
        a, h = ang(t), hw(t)
        c, s = math.cos(a), math.sin(a)
        # tangent direction (-s, c) in the (y, z) plane
        for dx, dt in ((xf(t), -h), (xf(t), h), (xb(t), h * 0.8), (xb(t), -h * 0.8)):
            y, z = r * c - s * dt, r * s + c * dt
            verts.append((dx, y, z))
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(4):
            j = (k + 1) % 4
            faces.append((a + k, b + k, b + j, a + j))
    return verts, faces, [mat] * len(faces)


def merge(name, parts, sharp=40):
    V, F, Mt = [], [], []
    for v, f, m in parts:
        o = len(V)
        V += v
        F += [tuple(i + o for i in q) for q in f]
        Mt += m
    return mesh_obj(name, V, F, Mt, sharp)


def cylinder_x(x0, x1, r, seg, y=0.0, z=0.0, mat="dark", caps=True, cap_back=False):
    verts, faces = [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        verts += [(x0, y + r * math.cos(a), z + r * math.sin(a)), (x1, y + r * math.cos(a), z + r * math.sin(a))]
    for k in range(seg):
        j = (k + 1) % seg
        faces.append((2 * k, 2 * j, 2 * j + 1, 2 * k + 1))
    if caps:
        faces.append(tuple(2 * k + 1 for k in range(seg)))
    if cap_back:
        faces.append(tuple(2 * k for k in reversed(range(seg))))
    return verts, faces, [mat] * len(faces)


def disc_x(x, r0, r1, seg, mat, dish=0.0):
    """A flat ring (or disc, r0 = 0) facing +X at x; `dish` moves the inner edge back."""
    verts, faces = [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        verts += [(x - dish, r0 * math.cos(a), r0 * math.sin(a)), (x, r1 * math.cos(a), r1 * math.sin(a))]
    for k in range(seg):
        j = (k + 1) % seg
        faces.append((2 * k, 2 * k + 1, 2 * j + 1, 2 * j))
    return verts, faces, [mat] * len(faces)


def alloy(grp, hi):
    R, W, rim = ALLOY["R"], ALLOY["W"], ALLOY["rim"]
    seg = 32 if hi else 12
    w = W / 2
    lathe(f"{grp}__tyre", tyre_profile(R, W, rim, hi), seg)
    # the rim: outer lip (polished), barrel (dark, seen from outside through the spokes), inner flange
    if hi:
        lathe(f"{grp}__rim", [(rim - 0.012, w * 0.78, "lip"), (rim + 0.004, w * 0.86, "lip"), (rim + 0.013, w * 0.92, "lip"),
                              (rim + 0.01, w * 0.98, "lip"), (rim - 0.004, w * 0.97, "alloy"), (rim - 0.013, w * 0.9, "dark"),
                              (rim - 0.013, -w * 0.85, "dark"), (rim + 0.008, -w * 0.9, "dark")], seg)
    else:
        lathe(f"{grp}__rim", [(rim + 0.012, w * 0.95, "lip"), (rim - 0.008, w * 0.95, "alloy"), (rim - 0.013, w * 0.9, "dark"), (rim - 0.013, -w * 0.85, "dark")], seg)
    parts = []
    # brake disc and hat, the back of the wheel closed
    if hi:
        parts.append(cylinder_x(-0.035, -0.012, 0.16, 32, mat="disc"))
        parts.append(cylinder_x(-0.012, 0.03, 0.075, 20, mat="dark"))
    else:
        parts.append(disc_x(-0.012, 0.075, 0.16, 8, "disc"))
    parts.append(disc_x(-w * 0.6, 0.0, rim - 0.012, 24 if hi else 8, "dark"))
    # five twin spokes, dished in to the hub
    hub, face = 0.062, w * 0.74
    rs = [hub - 0.004, hub + 0.02, 0.1, 0.14, rim - 0.03, rim - 0.008] if hi else [hub, rim - 0.008]
    for k in range(5):
        base = 2 * math.pi * k / 5
        for d in ((-1, 1) if hi else (0,)):
            parts.append(spoke_loft("spoke", lambda t, base=base, d=d: base + d * (0.05 + 0.045 * t),
                                    rs, lambda t: lerp(0.019 if d == 0 else 0.016, 0.013, t), lambda t: face - 0.028 * (1 - t) ** 1.5,
                                    lambda t: face - 0.028 * (1 - t) ** 1.5 - lerp(0.03, 0.018, t), "alloy"))
    # hub face, lug nuts, centre cap
    parts.append(disc_x(face - 0.028, 0.0, hub + 0.004, 24 if hi else 8, "alloy"))
    if hi:
        for k in range(5):
            a = 2 * math.pi * (k + 0.5) / 5
            parts.append(cylinder_x(face - 0.03, face - 0.016, 0.0095, 6, y=0.043 * math.cos(a), z=0.043 * math.sin(a), mat="nut"))
    parts.append(cylinder_x(face - 0.03, face - 0.022, 0.026, 20, mat="cap") if hi else disc_x(face - 0.024, 0.0, 0.026, 8, "cap"))
    merge(f"{grp}__face", parts)


def steel(grp, hi):
    R, W, rim = STEEL["R"], STEEL["W"], STEEL["rim"]
    seg = 32 if hi else 12
    w = W / 2
    lathe(f"{grp}__tyre", tyre_profile(R, W, rim, hi), seg)
    if hi:
        lathe(f"{grp}__rim", [(rim - 0.015, w * 0.8, "steel"), (rim + 0.01, w * 0.9, "steel"), (rim + 0.012, w * 0.97, "steel"),
                              (rim - 0.006, w * 0.96, "steel"), (rim - 0.016, w * 0.88, "dark"), (rim - 0.016, -w * 0.88, "dark"),
                              (rim + 0.01, -w * 0.92, "dark")], seg)
    else:
        lathe(f"{grp}__rim", [(rim + 0.012, w * 0.96, "steel"), (rim - 0.016, w * 0.9, "dark"), (rim - 0.016, -w * 0.88, "dark")], seg)
    parts = []
    # the dished disc: flat ring near the rim, a cone in to the hub, with hand holes
    parts.append(disc_x(w * 0.62, 0.2, rim - 0.015, seg, "steel", dish=-0.012))
    parts.append(disc_x(w * 0.62 + 0.012, 0.11, 0.2, seg, "steel", dish=-0.03))
    for k in range(8 if hi else 0):
        a = 2 * math.pi * (k + 0.5) / 8
        y, z = 0.235 * math.cos(a), 0.235 * math.sin(a)
        v, f, m = disc_x(w * 0.62 + 0.002, 0.0, 0.034, 12, "dark")
        parts.append(([(x, yy + y, zz + z) for x, yy, zz in v], f, m))
    # the hub: a drum proud of the disc, ten nuts, a domed cap
    parts.append(cylinder_x(w * 0.62 + 0.04, w * 0.62 + 0.095, 0.1, 24 if hi else 8, mat="steel"))
    if hi:
        for k in range(10):
            a = 2 * math.pi * k / 10
            parts.append(cylinder_x(w * 0.62 + 0.04, w * 0.62 + 0.058, 0.014, 6, y=0.145 * math.cos(a), z=0.145 * math.sin(a), mat="nut"))
    parts.append(cylinder_x(w * 0.62 + 0.095, w * 0.62 + 0.125, 0.06, 16, mat="cap") if hi else disc_x(w * 0.62 + 0.1, 0.0, 0.06, 8, "cap"))
    parts.append(disc_x(-w * 0.5, 0.0, rim - 0.016, 16 if hi else 8, "dark"))
    merge(f"{grp}__face", parts)


def lerp(a, b, t):
    return a + (b - a) * t


def build():
    clear_file()
    for k, (col, rough, metal) in MATS.items():
        M[k] = material(k, col, rough, metal)
    alloy("alloy_hi", True)
    alloy("alloy_lo", False)
    steel("steel_hi", True)
    steel("steel_lo", False)
    return len(bpy.data.objects)


def export():
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, use_selection=False)
    print("exported", OUT)


if __name__ == "__main__":
    print("built", build(), "objects")
    export()
