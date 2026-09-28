# The stunt structures' looks (their colliders stay in the game code, where they were tuned):
#   ramp       a steel kicker 9 m long, 5 wide, 2 high (stunts/Jumps.ts RAMP): its foot at z = 0 rising along +z to the lip.
#              A plated deck with anti-slip bars and yellow chevrons, kerbs, an open truss down each side, the lip's end
#              wall in hazard stripes, flags, and a stack of tyres either side of the foot.
#   overpass   the unfinished flyover (Structures.ts OVERPASS: ramp 55, deck 15, h 6, w 8): its foot at z = 0. An asphalt
#              embankment between retaining walls of jointed concrete panels, New-Jersey barriers along both sides, the
#              deck as a slab over a box girder on two piers with crossheads, the broken end - chunks of concrete and
#              rusty rebar - and at the foot a 前方断桥 board, water barriers and blue site hoarding.
#   mound      the earth mound to land on (its front edge at z = 0; 2 m to the flat top, 12 m of top, 25 m down): lumpy
#              sides, the flat top kept flat (the car lands on the collider), stones.
#   carpark    the underground car park (Structures.ts UNDERGROUND, the top of the ramp at the origin, down along +z): the
#              ramp's walls with a coping and railings, a height-limit gantry and the 地下停车场 board at the top, the hall's
#              striped and numbered pillars, bay lines, the ceiling's pipes and lamp strips.
#   lantern    a red palace lantern (the hutong shortcuts' gates): ribbed, gilt caps, a tassel; its centre at the origin.
#
#   blender -b -P scripts/blender/props/stunts.py -- [--out .scratch/blender/stunts.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/stunts.glb src/stunts/models.json --group
#
# Game frame (+Y up); material names are what stunts/Props.ts colours (and lights at night).

import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, material  # noqa: E402
import roof  # noqa: E402
from roof import G2B, Part  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "stunts.glb")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
M = roof.M
COLOURS = dict(steel="#6c7176", steelDark="#3c3f43", deck="#2b2d30", yellow="#f2b705", black="#1a1a1a", red="#e8481f",
               white="#d8dadc", tyre="#161616", concrete="#b9b6ae", concreteDark="#8f8c86", asphalt="#3a3c3f", paint="#e8e6df",
               rebar="#7a4a30", dirt="#7d6a4f", dirtDark="#5f503b", stone="#8a8278", hoard="#2f6db5", orange="#e8641f",
               floor="#5d6a64", pipeRed="#b8322a", duct="#9aa0a4", light="#fff4dc", sign="#1d5fd1", lantern="#d8201c",
               gold="#e8b62a")
R = random.Random(7)


def quad(p, mat, a, b, c, d, t=0.01):
    """A quad as a thin closed plate (its back pushed `t` behind), so recomputing the normals turns it the right way:
    a lone face gets an arbitrary side, and half the retaining wall's panels came out lit from behind."""
    a, b, c, d = (Vector(v) for v in (a, b, c, d))
    n = (c - a).cross(d - b).normalized() * t
    bm = p._bm(mat)
    front = [bm.verts.new(v) for v in (a, b, c, d)]
    back = [bm.verts.new(v - n) for v in (a, b, c, d)]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((front[j], front[i], back[i], back[j]))


def slab_along(p, mat, x0, x1, y0a, y0b, z0, z1, t):
    """A slab from (z0, y0a) to (z1, y0b) spanning x0..x1, t thick, as a closed box (the top face follows the slope)."""
    bm = p._bm(mat)
    pts = [(x, y, z) for x in (x0, x1) for (y, z) in ((y0a, z0), (y0b, z1))]
    top = [bm.verts.new(v) for v in pts]
    bot = [bm.verts.new((v[0], v[1] - t, v[2])) for v in pts]
    # top: x0z0, x0z1, x1z0, x1z1
    for f in ((0, 2, 3, 1),):
        bm.faces.new([top[i] for i in f])
        bm.faces.new([bot[i] for i in reversed(f)])
    for i, j in ((0, 1), (1, 3), (3, 2), (2, 0)):
        bm.faces.new((top[i], top[j], bot[j], bot[i]))


def beam(p, a, b, r, mat, square=True):
    """A bar from a to b: a square section (4 sides) or a 6-sided round one."""
    p.cyl(a, b, r, mat, sides=4 if square else 6, caps=(True, True))


def text(name, mat, s, size, m):
    """Lettering in Noto Serif SC as a mesh object named `name` (group__part), its glyphs in the XY plane, through m."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = s, bpy.data.fonts.load(FONT, check_existing=True), size, 0.01
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    ob = bpy.data.objects.new(name + "_c", cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    for v in me.vertices:
        v.co = m @ v.co
    me.materials.append(M[mat])
    o = bpy.data.objects.new(name, me)
    o.matrix_world = G2B
    bpy.context.scene.collection.objects.link(o)


# ---- the ramp --------------------------------------------------------------------------------------------------

def ramp():
    p = Part("ramp")
    L, H, W = 9.0, 2.0, 5.0
    hw = W / 2
    y = lambda z: H * z / L          # noqa: E731  (the deck's height at z)
    slab_along(p, "deck", -hw, hw, 0.04, H + 0.04, 0.0, L, 0.08)
    # anti-slip bars across the deck, chevrons, kerbs along the edges
    n = 16
    for k in range(1, n):
        z = L * k / n
        p.box((0, y(z) + 0.055, z), (hw - 0.25, 0.015, 0.025), "steelDark")
    # chevrons pointing up the ramp: flat yellow strips painted on the plate
    for k in range(4):
        z0 = 1.3 + k * 1.9
        for s in (-1, 1):
            tip, end = (0.0, z0 + 0.7), (s * (hw - 0.6), z0 - 0.5)
            wz = 0.32
            pts = [(tip[0], tip[1]), (end[0], end[1]), (end[0], end[1] + wz), (tip[0], tip[1] + wz)]
            q = [(x, y(z) + 0.066, z) for x, z in pts]
            quad(p, "yellow", *(q if s < 0 else q[::-1]))
    for s in (-1, 1):
        slab_along(p, "yellow", s * hw - 0.08, s * hw + 0.08, 0.2, H + 0.2, 0.0, L, 0.2)
    # the side trusses: chords, posts and diagonals
    for s in (-1, 1):
        x = s * (hw - 0.05)
        beam(p, (x, 0.05, 0.0), (x, 0.05, L), 0.05, "steel")
        zs = [0.0, 3.0, 6.0, L]
        for z in zs[1:]:
            beam(p, (x, 0.05, z), (x, y(z), z), 0.05, "steel")
        for za, zb in zip(zs, zs[1:]):
            beam(p, (x, 0.05, za), (x, y(zb), zb), 0.035, "steel")
    # cross members under the deck
    for z in (3.0, 6.0):
        beam(p, (-hw + 0.1, y(z) - 0.1, z), (hw - 0.1, y(z) - 0.1, z), 0.05, "steel")
    # the lip's end wall in hazard stripes, flags on it
    k = 10
    for i in range(k):
        x0 = -hw + W * i / k
        p.box((x0 + W / k / 2, H / 2, L - 0.04), (W / k / 2, H / 2, 0.04), "yellow" if i % 2 == 0 else "black")
    for s in (-1, 1):
        p.cyl((s * (hw + 0.12), H, L), (s * (hw + 0.12), H + 1.5, L), 0.03, "white", sides=5)
        p.box((s * (hw + 0.12), H + 1.25, L - 0.28), (0.01, 0.2, 0.26), "red")
    # tyre stacks either side of the foot
    for s in (-1, 1):
        for k in range(3):
            c = (s * (hw + 0.9), 0.14 + k * 0.28, 0.6)
            p.cyl((c[0], c[1] - 0.12, c[2]), (c[0], c[1] + 0.12, c[2]), 0.38, "tyre", sides=12, caps=(True, True))
    return p


# ---- the overpass ----------------------------------------------------------------------------------------------

def barrier(p, x, z0, z1, y0a, y0b, out):
    """A New-Jersey barrier along z (a trapezoid section, 0.8 m tall), its road face towards -out."""
    bm = p._bm("concrete")
    prof = [(0.0, 0.0), (0.0, 0.08), (0.06, 0.33), (0.2, 0.8), (0.35, 0.8), (0.35, 0.0)]
    rings = []
    for z, y0 in ((z0, y0a), (z1, y0b)):
        rings.append([bm.verts.new((x + out * (px - 0.35), y0 + py, z)) for px, py in prof])
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[1][::-1])


def overpass():
    p = Part("overpass")
    RMP, DECK, H, W = 55.0, 15.0, 6.0, 8.0
    hw, lip = W / 2, RMP + DECK
    y = lambda z: H * min(z, RMP) / RMP      # noqa: E731
    # the road up the embankment and along the deck, lane dashes up the middle
    slab_along(p, "asphalt", -hw, hw, 0.05, H + 0.05, 0.0, RMP, 0.1)
    p.box((0, H + 0.03, RMP + DECK / 2), (hw, 0.05, DECK / 2), "asphalt")
    for k in range(7):
        z = 6 + k * 9
        a, b = Vector((0, y(z) + 0.09, z)), Vector((0, y(z + 3) + 0.09, z + 3))
        p.cyl(a, b, 0.08, "paint", sides=4, caps=(False, False))
    # retaining walls: jointed panels (a darker joint every 3 m), a coping; barriers along the top
    for s in (-1, 1):
        x = s * hw
        n = int(RMP // 3)
        for k in range(n):
            za, zb = RMP * k / n, RMP * (k + 1) / n
            quad(p, "concrete", (x, 0.0, za), (x, 0.0, zb), (x, y(zb), zb), (x, y(za), za))
            p.cyl((x + s * 0.01, 0.0, zb), (x + s * 0.01, y(zb), zb), 0.025, "concreteDark", sides=4, caps=(False, False))
        barrier(p, s * hw, 0.0, RMP, 0.05, H + 0.05, s)
        barrier(p, s * hw, RMP, lip - 0.3, H + 0.05, H + 0.05, s)
    # the deck: a slab over a box girder, two piers with crossheads, the girder's underside dark
    p.box((0, H - 0.2, RMP + DECK / 2), (hw, 0.2, DECK / 2), "concrete")
    p.box((0, H - 1.0, RMP + DECK / 2), (hw - 1.3, 0.6, DECK / 2), "concreteDark")
    for z in (RMP + 3.0, lip - 2.5):
        p.box((0, H - 1.85, z), (hw - 0.4, 0.25, 0.7), "concrete")
        for s in (-1, 1):
            p.cyl((s * (hw - 1.6), 0.0, z), (s * (hw - 1.6), H - 2.1, z), 0.55, "concrete", sides=10, caps=(False, False))
    # the broken end: rough chunks hanging off the girder, rebar sticking out, a strip of torn barrier
    for i in range(9):
        x = -hw + 0.6 + i * (W - 1.2) / 8
        yy = H - 0.25 - (i % 3) * 0.35
        a = Vector((x, yy, lip - 0.2))
        b = a + Vector((R.uniform(-0.15, 0.15), R.uniform(-0.6, -0.2), R.uniform(0.9, 1.4)))
        p.cyl(a, b, 0.025, "rebar", sides=4, caps=(False, False))
    for i in range(6):
        c = (R.uniform(-hw + 1, hw - 1), H - R.uniform(0.9, 1.6), lip + R.uniform(-0.1, 0.3))
        p.box(c, (R.uniform(0.3, 0.6), R.uniform(0.2, 0.45), R.uniform(0.2, 0.4)), "concreteDark", rot=R.uniform(-0.6, 0.6))
    # at the foot: the 前方断桥 board on two posts, water barriers, blue hoarding along the walls' foot
    bx = hw + 1.8
    for dx in (-0.9, 0.9):
        p.cyl((bx + dx, 0.0, -2.0), (bx + dx, 2.3, -2.0), 0.05, "steel", sides=5)
    p.box((bx, 1.65, -2.03), (1.2, 0.55, 0.03), "yellow")
    text("overpass__sign", "black", "前方断桥", 0.42, Matrix.Translation((bx, 1.72, -2.07)) @ Matrix.Rotation(math.pi, 4, "Y"))
    text("overpass__sign2", "black", "ROAD CLOSED", 0.16, Matrix.Translation((bx, 1.33, -2.07)) @ Matrix.Rotation(math.pi, 4, "Y"))
    for k in range(4):
        x = hw + 1.0 + k * 1.3
        p.box((x, 0.4, 1.0), (0.6, 0.4, 0.25), "orange" if k % 2 == 0 else "white")
    for s in (-1, 1):
        for k in range(8):
            z = 4.0 + k * 2.1
            if y(z) > 1.8:
                break
            p.box((s * (hw + 0.6), 1.0, z), (0.03, 1.0, 1.0), "hoard" if k % 3 else "white")
    return p


def mound():
    """The landing mound: front edge at z = 0, 2 m to the flat top 3 m up, 12 m of top, 25 m down; 10 m wide."""
    p = Part("mound")
    W, TOP, FRONT, FLAT, LAND = 5.0, 3.0, 2.0, 12.0, 25.0
    zs = [0.0, 0.7, 1.4, FRONT] + [FRONT + FLAT * k / 6 for k in range(1, 7)] + [FRONT + FLAT + LAND * k / 8 for k in range(1, 9)]

    def h(z):
        if z <= FRONT:
            return TOP * z / FRONT
        if z <= FRONT + FLAT:
            return TOP
        return TOP * (1 - (z - FRONT - FLAT) / LAND)
    xs = [-W - 1.2, -W, -W + 1.5, -1.5, 1.5, W - 1.5, W, W + 1.2]
    bm = p._bm("dirt")
    grid = []
    for z in zs:
        row = []
        for x in xs:
            yy = h(z) if abs(x) <= W else 0.0
            flat_top = FRONT <= z <= FRONT + FLAT and abs(x) < W - 0.2
            if not flat_top and 0.0 < yy:
                yy += R.uniform(-0.07, 0.05)
            row.append(bm.verts.new((x + (R.uniform(-0.25, 0.25) if abs(x) > W - 0.1 else 0.0), max(0.0, yy - (0.04 if flat_top else 0.0)), z)))
        grid.append(row)
    for i in range(len(zs) - 1):
        for j in range(len(xs) - 1):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    # tyre ruts across the top, stones round the foot
    for s in (-1, 1):
        p.box((s * 0.8, TOP - 0.035, FRONT + FLAT / 2), (0.22, 0.01, FLAT / 2 - 0.3), "dirtDark")
    for k in range(10):
        z = R.uniform(0, FRONT + FLAT + LAND)
        s = R.choice((-1, 1))
        p.box((s * (W + R.uniform(0.3, 1.0)), 0.15, z), (R.uniform(0.2, 0.4), R.uniform(0.12, 0.25), R.uniform(0.2, 0.4)), "stone", rot=R.uniform(0, 3))
    return p


# ---- the underground car park -------------------------------------------------------------------------------------

def carpark():
    p = Part("carpark")
    RMP, RW, D, HALL, HW, SLAB = 36.0, 7.0, 5.0, 40.0, 30.0, 0.5
    rw, hw = RW / 2, HW / 2
    y = lambda z: -D * min(z, RMP) / RMP     # noqa: E731
    # the ramp: its deck, the walls either side from the deck to a railing's height above the street, a coping
    slab_along(p, "asphalt", -rw, rw, 0.0, -D, 0.0, RMP, 0.2)
    for k in range(8):
        z = 3 + k * 4.2
        p.cyl((-rw + 0.4, y(z) + 0.02, z), (rw - 0.4, y(z + 0.3) + 0.02, z + 0.3), 0.05, "yellow", sides=4, caps=(False, False))
    for s in (-1, 1):
        x = s * (rw + 0.2)
        p.box((x, (-D + 0.6) / 2, RMP / 2), (0.2, (D + 0.6) / 2, RMP / 2), "concrete")
        p.box((x, 0.65, RMP / 2), (0.28, 0.05, RMP / 2), "concreteDark")
        for k in range(13):
            z = RMP * k / 12
            p.cyl((x, 0.7, z), (x, 1.75, z), 0.03, "steel", sides=5)
        p.cyl((x, 1.75, 0.0), (x, 1.75, RMP), 0.04, "steel", sides=6)
        p.cyl((x, 1.2, 0.0), (x, 1.2, RMP), 0.025, "steel", sides=5)
        # a yellow-and-black band down each wall at the deck's edge
        n = 18
        for k in range(n):
            za, zb = RMP * k / n, RMP * (k + 1) / n
            quad(p, "yellow" if k % 2 == 0 else "black", (x - s * 0.201, y(za), za), (x - s * 0.201, y(zb), zb), (x - s * 0.201, y(zb) + 0.4, zb), (x - s * 0.201, y(za) + 0.4, za))
    # the height-limit gantry and the board over the top of the ramp
    for s in (-1, 1):
        p.cyl((s * (rw + 0.6), 0.0, -0.6), (s * (rw + 0.6), 3.6, -0.6), 0.1, "steel", sides=8)
    for k in range(8):
        x0 = -rw - 0.6 + (RW + 1.2) * k / 8
        p.box((x0 + (RW + 1.2) / 16, 2.55, -0.6), ((RW + 1.2) / 16, 0.12, 0.08), "yellow" if k % 2 == 0 else "black")
    p.box((0, 3.2, -0.62), (2.6, 0.45, 0.06), "sign")
    text("carpark__sign", "white", "地下停车场  P", 0.8, Matrix.Translation((0, 3.2, -0.69)) @ Matrix.Rotation(math.pi, 4, "Y"))
    text("carpark__limit", "black", "限高 2.2m", 0.13, Matrix.Translation((0, 2.55, -0.69)) @ Matrix.Rotation(math.pi, 4, "Y"))
    # the hall: floor, walls with a painted band, the portal beam, the ceiling
    p.box((0, -D - 0.1, RMP + HALL / 2), (hw, 0.1, HALL / 2), "floor")
    p.box((0, -SLAB - 0.05, RMP + HALL / 2), (hw, 0.05, HALL / 2), "concreteDark")
    for s in (-1, 1):
        p.box((s * (hw + 0.3), -D / 2, RMP + HALL / 2), (0.3, D / 2, HALL / 2), "concrete")
        p.box((s * (hw - 0.005), -D + 0.8, RMP + HALL / 2), (0.01, 0.3, HALL / 2), "sign")
        p.box((s * (rw + (hw - rw) / 2), -D / 2, RMP - 0.3), ((hw - rw) / 2, D / 2, 0.3), "concrete")
    p.box((0, -D / 2, RMP + HALL + 0.3), (hw, D / 2, 0.3), "concrete")
    p.box((0, -D + 0.8, RMP + HALL - 0.005), (hw, 0.3, 0.01), "sign")
    p.box((0, -SLAB - 0.3, RMP), (hw + 0.6, 0.18, 0.3), "concrete")
    for k in range(8):
        x0 = -rw + RW * k / 8
        p.box((x0 + RW / 16, -SLAB - 0.62, RMP - 0.35), (RW / 16, 0.12, 0.04), "yellow" if k % 2 == 0 else "black")
    # bays: white lines either side of the aisle, a yellow centre line, arrows
    for k in range(7):
        for s in (-1, 1):
            p.box((s * (hw - 2.9), -D + 0.012, RMP + 3 + k * 5.8), (2.7, 0.006, 0.06), "paint")
    p.box((0, -D + 0.012, RMP + HALL / 2), (0.08, 0.006, HALL / 2 - 2), "yellow")
    # pillars with a yellow-and-black foot and a number
    for n_, (px, pz) in enumerate([(px, RMP + k * 10) for px in (-7.5, 7.5) for k in (1, 2, 3)]):
        p.box((px, -D + (D - SLAB) / 2, pz), (0.4, (D - SLAB) / 2, 0.4), "concrete")
        for k in range(4):
            p.box((px, -D + 0.1 + 0.2 * k, pz), (0.41, 0.1, 0.41), "yellow" if k % 2 == 0 else "black")
        p.box((px, -D + 2.2, pz), (0.42, 0.3, 0.42), "sign")
        text(f"carpark__num{n_}", "white", f"B{n_ + 1:02d}", 0.42, Matrix.Translation((px, -D + 2.2, pz - 0.43)) @ Matrix.Rotation(math.pi, 4, "Y"))
    # the ceiling: lamp strips, a red sprinkler main and grey ducts
    for k in range(4):
        for s in (-1, 0, 1):
            p.box((s * 9, -SLAB - 0.14, RMP + 6 + k * 10), (0.12, 0.03, 1.5), "light")
    for x in (-11.0, 4.0):
        p.cyl((x, -SLAB - 0.3, RMP + 0.5), (x, -SLAB - 0.3, RMP + HALL - 0.5), 0.07, "pipeRed", sides=6)
    p.box((-3.0, -SLAB - 0.35, RMP + HALL / 2), (0.5, 0.25, HALL / 2 - 0.5), "duct")
    # the P sign on its post at the top of the ramp (replacing the old one)
    p.cyl((rw + 1.3, 0.0, -0.8), (rw + 1.3, 3.0, -0.8), 0.05, "steel", sides=6)
    p.box((rw + 1.3, 3.2, -0.8), (0.55, 0.55, 0.05), "sign")
    text("carpark__p", "white", "P", 0.8, Matrix.Translation((rw + 1.3, 3.2, -0.86)) @ Matrix.Rotation(math.pi, 4, "Y"))
    return p


# ---- the lantern -----------------------------------------------------------------------------------------------

def lantern():
    p = Part("lantern")
    bm = p._bm("lantern")
    n, rings = 12, 9
    grid = []
    for i in range(rings + 1):
        t = i / rings
        yy = -0.3 + 0.6 * t
        r = 0.27 * math.sin(math.pi * (0.12 + 0.76 * t)) + 0.02
        row = []
        for k in range(n):
            a = 2 * math.pi * k / n
            rr = r * (1.0 if k % 2 == 0 else 0.93)        # the ribs
            row.append(bm.verts.new((rr * math.cos(a), yy, rr * math.sin(a))))
        grid.append(row)
    for i in range(rings):
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((grid[i][k], grid[i][j], grid[i + 1][j], grid[i + 1][k]))
    for yy, sgn in ((0.3, 1), (-0.3, -1)):
        p.cyl((0, yy, 0), (0, yy + sgn * 0.07, 0), 0.15, "gold", sides=10, caps=(True, True))
    p.cyl((0, 0.37, 0), (0, 0.45, 0), 0.03, "gold", sides=6)
    for k in range(6):
        a = 2 * math.pi * k / 6
        p.cyl((0.03 * math.cos(a), -0.37, 0.03 * math.sin(a)), (0.05 * math.cos(a), -0.72, 0.05 * math.sin(a)), 0.012, "gold", sides=3, caps=(False, False))
    return p


def build():
    clear_file()
    for k, col in COLOURS.items():
        M[k] = material(k, col, 0.6)
    things = [ramp(), overpass(), mound(), carpark(), lantern()]
    for t in things:
        t.objects()
    return len(things)


if __name__ == "__main__":
    print("built", build(), "things")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB")
    print("exported", OUT)
