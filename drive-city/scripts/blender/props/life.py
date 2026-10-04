# Street life's things (life/, P2 of the NPC plan), low-poly, game frame (+Y up, each at the origin on the ground):
#   stool      a 马扎: two crossed frames under a canvas seat 0.36 m up
#   chess      a folding table with a 象棋 board (the grid, the river) and pieces, top 0.55 m up
#   cart       a 煎饼果子 tricycle cart: steel body, the round griddle, a striped awning on poles, a sign that glows at night;
#              the cook stands at +z behind it, customers at -z
#   grill      a 烤串 trough on legs, glowing coals, a row of skewers
#   lantern    a red lantern on a pole (glows at night)
#   speaker    the 广场舞 speaker on its trolley: cabinet, grille, a lit panel, wheels, handle
#   cage       a bird cage: base, bamboo bars, domed top, the hook, a cloth over half of it
#   table      a plastic folding table with four beer bottles (the night stall's)
#   broom      hand prop, the grip at the origin: a bamboo pole down -y to a fanned brush
#   flag       hand prop, the grip at the origin: a pole up +y to a tour guide's pennant
#   guitar     the busker's guitar, its middle at the origin, the face to +z, the neck along +x
#   erhu       the 二胡: the drum at the origin, the neck up +y; `bow` its bow along +x
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/props/life.py -- [--out .scratch/blender/life.glb]
#   node scripts/vehicles/import.mjs .scratch/blender/life.glb src/life/props.json --group

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
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, ".scratch", "blender", "life.glb")
M = roof.M
COLOURS = dict(steel="#9aa0a5", steelDark="#4a4f54", wood="#9b6b3e", woodDark="#6b4526", canvas="#2f4f7a", board="#e2c48c",
               ink="#2a1a10", red="#c4231c", black="#16161a", white="#eceae4", iron="#232325", awningRed="#c8261e",
               awningWhite="#f1efe8", sign="#d22a1c", signText="#f6d65a", coal="#ff6a1c", skewer="#c9a26a", meat="#8c3b22",
               lantern="#d8201c", gold="#e2b13c", speaker="#1c1d20", grille="#3a3c40", panel="#38d0ff", tyre="#141414",
               bamboo="#c9a764", cloth="#2d5d8c", plastic="#2e6fb5", bottle="#2f7a3a", label="#e8d9a8", brush="#a8874a",
               pole="#c8ccd0", flagRed="#e2301f", flagYellow="#f2c21a", guitarBody="#b9772f", guitarFace="#e8b46a",
               fret="#3a2a1c", string="#d8d8d8", erhuDrum="#2a1612", erhuPole="#3b2418", horse="#d9c8a0")


def tube(p, pts, r, mat, sides=5):
    for a, b in zip(pts, pts[1:]):
        p.cyl(a, b, r, mat, sides=sides, caps=(False, False))


def stool():
    p = Part("stool")
    for s in (-1, 1):   # two crossed frames, one each side
        z = 0.12 * s
        tube(p, [(-0.15, 0.0, z), (0.15, 0.36, z)], 0.012, "wood", 5)
        tube(p, [(0.15, 0.0, z), (-0.15, 0.36, z)], 0.012, "wood", 5)
    for x in (-0.15, 0.15):
        p.cyl((x, 0.36, -0.13), (x, 0.36, 0.13), 0.013, "wood", sides=5, caps=(True, True))
        p.cyl((x, 0.02, -0.13), (x, 0.02, 0.13), 0.011, "wood", sides=5, caps=(True, True))
    p.box((0, 0.355, 0), (0.15, 0.006, 0.12), "canvas")
    return p


def chess():
    p = Part("chess")
    p.box((0, 0.54, 0), (0.36, 0.015, 0.36), "wood")
    for x in (-0.3, 0.3):
        for z in (-0.3, 0.3):
            p.box((x, 0.27, z), (0.015, 0.27, 0.015), "steelDark", skip=("-y", "+y"))
    p.box((0, 0.557, 0), (0.25, 0.003, 0.28), "board")
    for i in range(9):       # files
        x = -0.22 + 0.055 * i
        p.box((x, 0.561, 0), (0.002, 0.001, 0.25), "ink", skip=("-y", "-x", "+x", "-z", "+z"))
    for j in range(10):      # ranks, the river between the 5th and 6th
        z = -0.25 + 0.0555 * j
        p.box((0, 0.561, z), (0.22, 0.001, 0.002), "ink", skip=("-y", "-x", "+x", "-z", "+z"))
    spots = [(-4, -4.5), (-2, -4.5), (0, -4.5), (2, -3.5), (4, -4.5), (-3, -1.5), (1, -1.5), (3, -2.5),
             (-4, 4.5), (-1, 4.5), (0, 3.5), (2, 4.5), (4, 4.5), (-2, 1.5), (0, 1.5), (3, 2.5)]
    for k, (fx, fz) in enumerate(spots):
        x, z = fx * 0.055, fz * 0.0555
        p.cyl((x, 0.558, z), (x, 0.572, z), 0.022, "red" if k < 8 else "black", sides=8, caps=(False, True))
    return p


def cart():
    p = Part("cart")
    p.box((0, 0.62, 0), (0.72, 0.36, 0.42), "steel")                 # the body
    p.box((0, 0.99, 0), (0.75, 0.015, 0.45), "steelDark")             # the counter
    p.cyl((0.2, 1.005, 0.05), (0.2, 1.03, 0.05), 0.3, "iron", sides=16, caps=(False, True))   # the griddle
    p.box((-0.45, 1.06, 0.05), (0.2, 0.05, 0.25), "white")            # the batter tub and the eggs' tray
    for x in (-0.68, 0.68):                                           # awning poles and the striped canopy
        for z in (-0.4, 0.4):
            p.cyl((x, 1.0, z), (x, 2.0, z), 0.018, "steelDark", sides=5)
    for k in range(6):
        p.box((-0.75 + 0.25 * k + 0.125, 2.03, 0), (0.125, 0.025, 0.55), "awningRed" if k % 2 == 0 else "awningWhite")
    p.box((0, 0.66, -0.425), (0.6, 0.18, 0.006), "sign")              # the sign on the customers' side
    p.box((0, 0.66, -0.43), (0.42, 0.07, 0.003), "signText")
    for x in (-0.55, 0.55):                                           # wheels
        p.cyl((x, 0.2, -0.47), (x, 0.2, -0.43), 0.2, "tyre", sides=12, caps=(True, True))
        p.cyl((x, 0.2, 0.43), (x, 0.2, 0.47), 0.2, "tyre", sides=12, caps=(True, True))
    return p


def grill():
    p = Part("grill")
    p.box((0, 0.72, 0), (0.55, 0.08, 0.13), "steelDark", skip=("+y",))
    p.box((0, 0.79, 0), (0.52, 0.004, 0.11), "coal")
    for x in (-0.5, 0.5):
        for z in (-0.1, 0.1):
            p.box((x, 0.32, z), (0.015, 0.32, 0.015), "steelDark", skip=("-y", "+y"))
    for k in range(9):
        x = -0.42 + 0.105 * k
        p.box((x, 0.83, 0), (0.004, 0.004, 0.2), "skewer")
        for m in (-0.05, 0.0, 0.05):
            p.box((x, 0.83, m), (0.012, 0.012, 0.016), "meat")
    return p


def lantern():
    p = Part("lantern")
    p.cyl((0, 0, 0), (0, 2.2, 0), 0.025, "steelDark", sides=5)
    p.cyl((0, 2.2, 0), (0.35, 2.2, 0), 0.015, "steelDark", sides=4)
    p.cyl((0.35, 1.72, 0), (0.35, 1.76, 0), 0.08, "gold", sides=8, caps=(True, True))
    p.cyl((0.35, 1.76, 0), (0.35, 1.86, 0), 0.08, "lantern", sides=10, caps=(False, False), r2=0.17)
    p.cyl((0.35, 1.86, 0), (0.35, 2.02, 0), 0.17, "lantern", sides=10, caps=(False, False), r2=0.17)
    p.cyl((0.35, 2.02, 0), (0.35, 2.12, 0), 0.17, "lantern", sides=10, caps=(False, False), r2=0.08)
    p.cyl((0.35, 2.12, 0), (0.35, 2.16, 0), 0.08, "gold", sides=8, caps=(True, True))
    p.cyl((0.35, 1.72, 0), (0.35, 1.58, 0), 0.012, "gold", sides=4)     # the tassel
    return p


def speaker():
    p = Part("speaker")
    p.box((0, 0.48, 0), (0.22, 0.32, 0.17), "speaker")
    p.disc((0, 0.42, -0.172), 0.14, "grille", sides=12, normal=(0, 0, -1))
    p.disc((0, 0.67, -0.172), 0.05, "grille", sides=8, normal=(0, 0, -1))
    p.box((0, 0.76, -0.171), (0.12, 0.02, 0.001), "panel", skip=("+z",))
    p.cyl((-0.15, 0.8, 0.15), (-0.15, 1.05, 0.15), 0.012, "steelDark", sides=4)
    p.cyl((0.15, 0.8, 0.15), (0.15, 1.05, 0.15), 0.012, "steelDark", sides=4)
    p.cyl((-0.15, 1.05, 0.15), (0.15, 1.05, 0.15), 0.015, "steelDark", sides=4)
    for x in (-0.18, 0.18):
        p.cyl((x, 0.08, 0.12), (x + 0.05 * (1 if x > 0 else -1), 0.08, 0.12), 0.08, "tyre", sides=10, caps=(True, True))
    return p


def cage():
    p = Part("cage")
    p.cyl((0, 0, 0), (0, 0.04, 0), 0.17, "bamboo", sides=12, caps=(True, True))
    n = 16
    for i in range(n):
        a = 2 * math.pi * i / n
        x, z = 0.16 * math.cos(a), 0.16 * math.sin(a)
        tube(p, [(x, 0.04, z), (x, 0.36, z), (x * 0.4, 0.45, z * 0.4)], 0.004, "bamboo", 3)
    p.cyl((0, 0.2, 0), (0, 0.21, 0), 0.165, "bamboo", sides=12, caps=(False, False))
    p.cyl((0, 0.45, 0), (0, 0.5, 0), 0.03, "bamboo", sides=6)
    p.cyl((0, 0.5, 0), (0, 0.56, 0), 0.025, "steelDark", sides=6, caps=(False, False))
    # the cloth over the back half
    p.cyl((0, 0.18, 0), (0, 0.4, 0), 0.172, "cloth", sides=12, caps=(False, False), r2=0.12)
    return p


def table():
    p = Part("table")
    p.box((0, 0.6, 0), (0.4, 0.015, 0.4), "plastic")
    for x in (-0.35, 0.35):
        for z in (-0.35, 0.35):
            p.box((x, 0.3, z), (0.015, 0.3, 0.015), "plastic", skip=("-y", "+y"))
    for k, (x, z) in enumerate([(-0.15, -0.12), (0.12, -0.18), (0.18, 0.1), (-0.08, 0.16)]):
        p.cyl((x, 0.615, z), (x, 0.8, z), 0.032, "bottle", sides=8, caps=(False, False))
        p.cyl((x, 0.8, z), (x, 0.88, z), 0.032, "bottle", sides=8, caps=(False, True), r2=0.012)
        p.cyl((x, 0.66, z), (x, 0.73, z), 0.0335, "label", sides=8, caps=(False, False))
    return p


def broom():
    p = Part("broom")
    p.cyl((0, 0.3, 0), (0, -0.9, 0), 0.016, "bamboo", sides=5, caps=(True, False))
    bm = p._bm("brush")      # a fan of twigs: a flat wedge, wide at the ground end
    v = [bm.verts.new(c) for c in [(-0.04, -0.9, -0.03), (0.04, -0.9, -0.03), (0.04, -0.9, 0.03), (-0.04, -0.9, 0.03),
                                   (-0.32, -1.35, -0.06), (0.32, -1.35, -0.06), (0.32, -1.35, 0.06), (-0.32, -1.35, 0.06)]]
    for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
        bm.faces.new([v[i] for i in f])
    return p


def flag():
    p = Part("flag")
    p.cyl((0, -0.15, 0), (0, 1.35, 0), 0.01, "pole", sides=5, caps=(True, True))
    bm = p._bm("flagRed")
    v = [bm.verts.new(c) for c in [(0, 1.33, 0), (0, 1.03, 0), (0.42, 1.2, 0)]]
    bm.faces.new(v)
    bm2 = p._bm("flagYellow")
    v2 = [bm2.verts.new(c) for c in [(0.0, 1.21, 0.002), (0.0, 1.13, 0.002), (0.16, 1.18, 0.002)]]
    bm2.faces.new(v2)
    return p


def guitar():
    p = Part("guitar")
    p.cyl((-0.1, 0, -0.05), (-0.1, 0, 0.05), 0.19, "guitarBody", sides=14, caps=(True, False))
    p.cyl((0.13, 0, -0.05), (0.13, 0, 0.05), 0.15, "guitarBody", sides=14, caps=(True, False))
    p.disc((-0.1, 0, 0.051), 0.185, "guitarFace", sides=14, normal=(0, 0, 1))
    p.disc((0.13, 0, 0.051), 0.145, "guitarFace", sides=14, normal=(0, 0, 1))
    p.disc((0.0, 0, 0.053), 0.045, "fret", sides=10, normal=(0, 0, 1))
    p.box((0.52, 0, 0.03), (0.25, 0.025, 0.012), "fret")
    p.box((0.82, 0, 0.025), (0.07, 0.04, 0.012), "fret")
    p.box((0.3, 0, 0.055), (0.52, 0.012, 0.002), "string", skip=("-z",))
    return p


def erhu():
    p = Part("erhu")
    p.cyl((0, 0, -0.06), (0, 0, 0.07), 0.052, "erhuDrum", sides=6, caps=(True, True))
    p.cyl((0, -0.05, 0.0), (0, 0.8, 0.0), 0.012, "erhuPole", sides=5, caps=(True, True))
    for y in (0.66, 0.72):
        p.cyl((-0.06, y, 0), (0.06, y, 0), 0.008, "erhuPole", sides=4, caps=(True, True))
    p.box((0, 0.04, 0.07), (0.006, 0.012, 0.004), "horse")
    p.cyl((0, 0.05, 0.06), (0, 0.7, 0.012), 0.0015, "string", sides=3)
    return p


def bow():
    p = Part("bow")
    p.cyl((0, 0, 0), (0.75, 0, 0), 0.006, "bamboo", sides=4, caps=(True, True))
    p.cyl((0.02, -0.02, 0), (0.73, -0.02, 0), 0.003, "horse", sides=3)
    return p


def build():
    clear_file()
    for k, col in COLOURS.items():
        M[k] = material(k, col, 0.6)
    things = [stool(), chess(), cart(), grill(), lantern(), speaker(), cage(), table(), broom(), flag(), guitar(), erhu(), bow()]
    for t in things:
        t.objects()
    return len(things)


if __name__ == "__main__":
    print("built", build(), "things")
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB")
    print("exported", OUT)
