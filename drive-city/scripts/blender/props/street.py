# Street furniture close up (city/visual/FurnitureGeo.ts; the pools draw these near the camera and the old box
# versions beyond):
#   bike      a shared bike along +x (wheels at x +-0.52, r 0.33): a step-through frame, the front basket, mudguards,
#             chain cover, the smart lock and QR plate over the rear wheel, moulded wheels, saddle, bars, kickstand.
#             'frame' is white: the instance colour paints it the operator's colour.
#   bin       two sorting bins side by side (green recyclables at -x, grey other waste at +x): tapered bodies, lids
#             with a lip and a handle, a label on each front, foot pedals, wheels at the back
#   shelter   a bus shelter 7.4 m along +x, the road at +z: posts, an arched canopy with its lit soffit, a framed
#             glass back and end, the advertising lightbox, the route board, a slatted bench, the stop's name on top
#
#   blender -b -P scripts/blender/props/street.py -- [--out .scratch/blender/street.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/street.glb src/city/visual/street.json --group
#
# Game frame (+Y up); material names are the colours (and night glow) FurnitureGeo.ts looks up.

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, material  # noqa: E402
import roof  # noqa: E402
from roof import Part  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "street.glb")
M = roof.M
COLOURS = dict(frame="#ffffff", dark="#1b1c1d", tyre="#141414", hub="#8f9398", seat="#262626", lock="#3a3d40",
               qr="#e8e8e2", reflector="#b3261e", binGreen="#2f7b48", binGreenLid="#276a3d", binGrey="#6c7277",
               binGreyLid="#5a6065", label="#f2f2f2", steel="#8d9296", canopy="#d3d6d8", soffit="#f0efe9",
               glass="#34424a", ad="#86c2e6", adbox="#dedfd9", board="#1e5eaa", boardFace="#f2f2f2", bench="#9aa0a4")


def tube(p, pts, r, mat, sides=5):
    """A polyline tube through game points."""
    for a, b in zip(pts, pts[1:]):
        p.cyl(a, b, r, mat, sides=sides, caps=(False, False))


def arc(cx, cy, r, a0, a1, n, z=0.0):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n), z) for i in range(n + 1)]


def bike(ride=False):
    """The shared bike; `ride` is the one the player rides (vehicle/TwoWheelers.ts): no wheels (they spin, `bikeWheel`),
    the saddle and bars raised to where the rider's rig puts the pelvis and hands, crank and pedals."""
    p = Part("bikeRide" if ride else "bike")
    R = 0.33
    for x in (() if ride else (-0.52, 0.52)):
        # tyre: a tread band and two side walls; the moulded wheel: a disc each side and the hub
        wheel(p, (x, R, 0), R, 16)
    # frame: head tube, the step-through down tube curving to the bottom bracket, seat tube, stays
    head_top, head_bot = ((0.43, 1.0, 0), (0.46, 0.76, 0)) if ride else ((0.4, 0.9, 0), (0.44, 0.72, 0))
    bb = (-0.06, 0.3, 0)
    tube(p, [head_bot, (0.3, 0.52, 0), (0.12, 0.34, 0), bb], 0.032, "frame", 6)
    tube(p, [head_bot, head_top], 0.03, "frame", 6)
    seat_y = 1.06 if ride else 0.9     # saddle top: 0.755 m over the hubs on the ridden one, as the rider's rig wants
    tube(p, [bb, (-0.2, 0.82, 0)], 0.028, "frame", 6)
    for z in (-0.045, 0.045):
        tube(p, [(bb[0], bb[1], z * 0.5), (-0.52, R, z)], 0.014, "frame", 4)
        tube(p, [(-0.19, 0.78, z * 0.4), (-0.52, R, z)], 0.013, "frame", 4)
        tube(p, [head_bot, (0.52, R, z)], 0.016, "frame", 4)          # fork legs
    # mudguards over both wheels, the chain cover from the bracket to the rear hub
    for x, a0, a1 in ((-0.52, 0.35, 2.1), (0.52, 0.55, 2.4)):
        pts = arc(x, R, R + 0.045, a0, a1, 7)
        bm = p._bm("frame")
        ring = []
        for q in pts:
            ring.append((bm.verts.new((q[0], q[1], -0.03)), bm.verts.new((q[0], q[1], 0.03))))
        for (a0, a1), (b0, b1) in zip(ring, ring[1:]):
            bm.faces.new((a0, b0, b1, a1))
    p.box((-0.29, 0.33, 0.055), (0.26, 0.06, 0.012), "dark")
    # the rear rack with the smart lock box and the QR plate
    p.box((-0.5, 0.72, 0), (0.16, 0.012, 0.07), "dark")
    p.box((-0.56, 0.78, 0), (0.09, 0.055, 0.075), "lock")
    p.box((-0.655, 0.78, 0), (0.004, 0.045, 0.05), "qr")
    p.box((-0.66, 0.7, 0), (0.004, 0.025, 0.03), "reflector")
    # saddle and post, bars, stem, grips, the basket
    p.cyl((-0.2, 0.82, 0), (-0.22, seat_y, 0), 0.014, "hub", sides=5, caps=(False, False))
    p.box((-0.22, seat_y + 0.025, 0), (0.13, 0.03, 0.075), "seat")
    bar = (0.48, 1.06, 0) if ride else (0.36, 0.99, 0)
    p.cyl(head_top, bar, 0.016, "dark", sides=5, caps=(False, False))
    p.cyl((bar[0], bar[1], -0.29), (bar[0], bar[1], 0.29), 0.012, "dark", sides=5, caps=(True, True))
    for z in (-0.29, 0.29):
        p.cyl((bar[0], bar[1], z * 0.82), (bar[0], bar[1], z), 0.019, "seat", sides=6, caps=(False, True))
    # crank and pedals
    p.cyl((bb[0], bb[1], -0.07), (bb[0], bb[1], 0.07), 0.018, "hub", sides=6, caps=(True, True))
    p.disc((bb[0], bb[1], 0.072), 0.09, "hub", sides=10, normal=(0, 0, 1))
    for s_ in (-1, 1):
        a = (bb[0] + s_ * 0.02, bb[1] + s_ * 0.16, s_ * 0.09)
        p.cyl((bb[0], bb[1], s_ * 0.075), a, 0.01, "dark", sides=4, caps=(False, False))
        p.box((a[0], a[1], s_ * 0.13), (0.05, 0.012, 0.04), "dark")
    # basket: an open tapered box on the head tube
    bx, by = (0.68, 0.92) if ride else (0.63, 0.86)
    for s in (-1, 1):
        p.box((bx, by, s * 0.155), (0.15, 0.1, 0.008), "frame")
        p.box((bx + s * 0.155, by, 0), (0.008, 0.1, 0.155), "frame")
    p.box((bx, by - 0.1, 0), (0.15, 0.008, 0.155), "frame")
    p.cyl((head_bot[0] + 0.02, head_bot[1] + 0.08, 0), (bx - 0.15, by - 0.05, 0), 0.012, "dark", sides=4, caps=(False, False))
    if not ride:
        p.cyl((-0.1, 0.32, -0.05), (-0.18, 0.0, -0.16), 0.01, "dark", sides=4, caps=(False, False))   # kickstand
    return p


def bike_wheel():
    """The ridden bike's wheel at the origin, axle along z: the parked bikes' moulded wheel."""
    p = Part("bikeWheel")
    wheel(p, (0, 0, 0), 0.34, 20)
    return p


def wheel(p, c, R, sides):
    """A shared bike's wheel: a tyre with its walls, the dark moulded wheel's rim, three flat spokes and the hub."""
    cx, cy, cz = c
    ring = lambda r, z: [(cx + r * math.cos(2 * math.pi * i / sides), cy + r * math.sin(2 * math.pi * i / sides), cz + z) for i in range(sides)]
    bt = p._bm("tyre")
    rows = [[bt.verts.new(q) for q in ring(r, z)] for r, z in ((R - 0.04, -0.02), (R, -0.02), (R, 0.02), (R - 0.04, 0.02))]
    for a, b in zip(rows, rows[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bt.faces.new((a[i], a[j], b[j], b[i]))
    br = p._bm("dark")
    rim = [[br.verts.new(q) for q in ring(r, z)] for r, z in ((R - 0.075, -0.012), (R - 0.04, -0.018), (R - 0.04, 0.018), (R - 0.075, 0.012))]
    for a, b in zip(rim, rim[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            br.faces.new((a[i], a[j], b[j], b[i]))
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        e = (math.cos(a), math.sin(a))
        p.box((cx + e[0] * (R - 0.04) / 2, cy + e[1] * (R - 0.04) / 2, cz), ((R - 0.07) / 2, 0.022, 0.01), "dark", rot=0.0) if False else None
        # a flat spoke from the hub to the rim, 4.5 cm wide
        bs = p._bm("dark")
        n = (-e[1], e[0])
        pts = []
        for r in (0.03, R - 0.07):
            for w in (-0.022, 0.022):
                for z in (-0.01, 0.01):
                    pts.append(bs.verts.new((cx + e[0] * r + n[0] * w, cy + e[1] * r + n[1] * w, cz + z)))
        q = lambda i0, i1, i2, i3: bs.faces.new((pts[i0], pts[i1], pts[i2], pts[i3]))
        q(0, 4, 5, 1); q(2, 3, 7, 6); q(0, 2, 6, 4); q(1, 5, 7, 3)
    p.cyl((cx, cy, cz - 0.05), (cx, cy, cz + 0.05), 0.035, "hub", sides=8, caps=(True, True))


def bin_pair():
    p = Part("bin")
    for x, body, lid in ((-0.28, "binGreen", "binGreenLid"), (0.28, "binGrey", "binGreyLid")):
        # a tapered body: a loft of chamfered rectangles
        bm = p._bm(body)
        rings = []
        for y, w, d in ((0.03, 0.225, 0.19), (0.8, 0.25, 0.21)):
            ring = []
            for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                c = 0.03
                ring += [bm.verts.new((x + sx * w, y, sz * (d - c))), bm.verts.new((x + sx * (w - c), y, sz * d))]
            # order the eight corners round the rectangle
            ring = [ring[1], ring[2], ring[3], ring[4], ring[5], ring[6], ring[7], ring[0]]
            rings.append(ring)
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
        bm.faces.new(rings[0][::-1])
        # the lid: a slab with a front lip and a handle
        p.box((x, 0.83, 0), (0.27, 0.03, 0.23), lid)
        p.box((x, 0.8, 0.225), (0.25, 0.03, 0.012), lid)
        p.box((x, 0.875, -0.12), (0.12, 0.015, 0.025), lid)
        # the label on the front, a coloured band across its top, the pedal, the wheels at the back
        p.box((x, 0.56, 0.2125), (0.13, 0.12, 0.004), "label")
        p.box((x, 0.66, 0.214), (0.13, 0.025, 0.004), lid)
        p.box((x, 0.06, 0.24), (0.08, 0.015, 0.05), "dark")
        for sx in (-1, 1):
            p.cyl((x + sx * 0.2, 0.06, -0.19), (x + sx * 0.23, 0.06, -0.19), 0.06, "dark", sides=8, caps=(True, True))
    return p


def shelter():
    p = Part("shelter")
    # posts, and the arched canopy over them: a curved roof, its fascia, the lit soffit
    for x in (-3.3, 0, 3.3):
        p.cyl((x, 0, -0.7), (x, 2.58, -0.7), 0.06, "steel", sides=8, caps=(False, False))
        p.cyl((x, 2.5, -0.7), (x, 2.6, 0.9), 0.035, "steel", sides=6, caps=(False, False))   # a raked arm to the front
    n = 6
    zs = [lerp(-0.9, 1.1, i / n) for i in range(n + 1)]
    ys = [2.62 + 0.12 * math.sin(math.pi * i / n) for i in range(n + 1)]
    arch_slab(p, "canopy", -3.7, 3.7, [y + 0.03 for y in ys], zs, 0.06)
    arch_slab(p, "soffit", -3.62, 3.62, [y - 0.004 for y in ys[1:-1]], zs[1:-1], 0.004)
    for z, y in ((zs[0], ys[0]), (zs[-1], ys[-1])):
        p.box((0, y + 0.02, z), (3.72, 0.06, 0.02), "canopy")
    for x in (-3.72, 3.72):
        p.box((x, max(ys) - 0.02, 0.1), (0.02, 0.09, 1.0), "canopy")
    # the back: glass panels in frames between the posts; an end panel at -x
    for x0, x1 in ((-3.25, -0.05), (0.05, 2.95)):
        c = (x0 + x1) / 2
        p.box((c, 1.3, -0.72), ((x1 - x0) / 2, 0.92, 0.012), "glass")
        for y in (0.36, 2.24):
            p.box((c, y, -0.72), ((x1 - x0) / 2, 0.025, 0.025), "steel")
    p.box((-3.3, 1.3, -0.3), (0.012, 0.92, 0.38), "glass")
    # the advertising lightbox at +x, the route board on its post at -x
    p.box((3.75, 1.28, -0.55), (0.65, 0.975, 0.15), "adbox")
    p.box((3.75, 1.3, -0.395), (0.55, 0.85, 0.008), "ad")
    p.box((3.75, 1.3, -0.705), (0.55, 0.85, 0.008), "ad")
    p.box((-2.5, 1.55, -0.66), (0.425, 0.65, 0.035), "board")
    p.box((-2.5, 1.5, -0.62), (0.35, 0.45, 0.01), "boardFace")
    # the bench: slats on two legs
    for k in range(3):
        p.box((-0.4, 0.46, -0.6 + 0.13 * k), (1.4, 0.02, 0.05), "bench")
    for x in (-1.6, 0.8):
        p.box((x, 0.23, -0.45), (0.03, 0.225, 0.15), "steel")
    # the stop's name along the canopy's front
    p.box((-0.8, 2.94, 1.02), (1.3, 0.16, 0.025), "board")
    p.box((-0.8, 2.94, 1.046), (1.2, 0.11, 0.002), "boardFace")
    return p


def arch_slab(p, mat, x0, x1, ys, zs, t):
    """A closed slab along x following the profile (ys, zs), `t` thick (a closed shell, so its faces orient outwards)."""
    bm = p._bm(mat)
    top = [(bm.verts.new((x0, y + t / 2, z)), bm.verts.new((x1, y + t / 2, z))) for y, z in zip(ys, zs)]
    bot = [(bm.verts.new((x0, y - t / 2, z)), bm.verts.new((x1, y - t / 2, z))) for y, z in zip(ys, zs)]
    for k in range(len(ys) - 1):
        bm.faces.new((top[k][0], top[k + 1][0], top[k + 1][1], top[k][1]))
        bm.faces.new((bot[k][0], bot[k][1], bot[k + 1][1], bot[k + 1][0]))
    for side in (0, 1):
        ring = [top[k][side] for k in range(len(ys))] + [bot[k][side] for k in reversed(range(len(ys)))]
        bm.faces.new(ring if side else ring[::-1])
    for k in (0, len(ys) - 1):
        bm.faces.new((top[k][0], top[k][1], bot[k][1], bot[k][0]))


def lerp(a, b, t):
    return a + (b - a) * t


def build():
    clear_file()
    for k, col in COLOURS.items():
        M[k] = material(k, col, 0.6)
    things = [bike(), bike(ride=True), bike_wheel(), bin_pair(), shelter()]
    for t in things:
        t.objects()
    return len(things)


if __name__ == "__main__":
    print("built", build(), "things")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB")
    print("exported", OUT)
