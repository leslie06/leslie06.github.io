# 藤原豆腐店 (2026-10-21/22): the tofu shop from 头文字D, built in Blender and marked with the bcity_landmark add-on's
# conventions. Rounds: after a photo of the film's shop (「我还想把照片上面的豆腐店做出来」「放在亮马桥，照片原样的日式，
# 招牌上面的店名」); after two photos of replica shops (「按照图片1:1还原」); the street after a day photo (「把街景做成下图
# 的样式，右边没有房子，左边有」); and now (2026-10-22, 「藤原豆腐店要做成我发你的这样，AE86摆在门口也要是这个样子」) after
# the film's own shop on a diorama card: a weathered two-storey concrete house overgrown with ivy, the dry cleaner's
# (ドライクリーニング 国際) tiled house to its left, a yard to its right, the AE86 at the kerb before them.
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/tofu_shop.py -- [--out art/landmarks/tofushop.blend] [--export]
#
# Needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header): it has the kana too.
#
# Site: the small two-way street east of 燕莎 at 亮马桥 (the residential link from (5610, -4558) to (5624, -4388),
# 7 m wide, small shops and street trees along it), on its west side in place of two learnt buildings (ids
# 8000000300011 and 8000000300014). The street runs 4.82 degrees west of north here, so the heading is -4.82.
# Frame: Blender +X east (towards the street), +Y north (along it), metres, origin on the ground 10 m west of the
# street's centre line, game (5606.10, -4484.66). The kerb is at x 6.5; the fronts at x 2.5 leave a 4 m concrete
# apron where the AE86 stands (parking/index.ts FIXED: local (4.1, -2.53), nose north).
#
# The card, measured at ~180 px a metre (the wooden door 1.83 m), left to right (south to north):
#   - the dry cleaner's: a hipped roof of grey tiles over two storeys; upstairs dark wooden windows behind a balcony
#     whose front is a weathered yellow board (〈第2寄居町〉 TEL.22-007…) on a dark canopy beam; a white sign standing
#     before it (ドライクリーニング in red, まいど ありがとう ございます, 国際 in blue); downstairs white walls, a garage
#     opening, a curtained window and a glazed door over a brick base, a grey pillar where it meets the shop;
#   - the shop: 4.3 m wide, 6.2 m to its flat roof, beige-grey stucco streaked and netted with vine stems, ivy over
#     the upstairs window and down the whole right-hand corner; upstairs a 2.1 m four-light window behind a railing,
#     a window air-conditioner beside it, a downpipe at the left edge; the sign (5.4 m, one yellow panel とうふ 油あげ and
#     three white ones 手づくりの店 over 藤原豆腐店) with its foot 2.4 m up, reaching over the neighbour's pillar;
#     under it a brick pier, the shop open 2 m wide and dark inside (a sliding glass door, crates), a post, a door
#     bay (a glazed transom over a dark noren with a white crest and a slatted wooden door), a red brick pier;
#   - a yard: a board fence set back, a low white wall painted with grass.
# Not from the card: the backs, the depths (8 m), the far ends of the two houses.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, cyl, ell, flat_marker, rect  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tofushop.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = 5606.10, -4484.66, -4.82
KERB = 6.5
FX, BX = 2.5, -5.5             # the fronts and the backs
# the shop, along the street (y, south to north)
SY0, SY1, STOP = -3.3, 1.0, 6.2
WY0, WY1, WZ0, WZ1 = -2.53, -0.47, 3.83, 4.83          # its upstairs window
OP0, OP1, OPH, OPD = -2.94, -0.94, 2.2, 1.2            # the open shop: from, to, height, depth
DB0, DB1, DBH = -0.83, 0.58, 1.83                      # the door bay and its transom's foot
# the dry cleaner's
LY0, LY1 = -12.3, SY0
LEAVE, LRIDGE, LOVER = 4.45, 6.0, 0.6                  # eaves, ridge, overhang
CAN0, CAN1, BAL1 = 1.94, 2.22, 3.12                    # the canopy beam, the balcony board's top
BALX = FX + 0.6
KY0, KY1, KZ0, KZ1 = -5.19, -4.44, 2.45, 4.64          # its standing sign
# the shop's sign: panel edges (the card's, uneven), an upright face S0..S1, a rounded top SR back to the wall
TYS = (-4.22, -2.92, -1.78, -0.42, 1.14)
TY0, TY1 = TYS[0], TYS[-1]
S0, S1, SD, SR = 2.4, 3.42, 0.5, 0.32
YARD = 5.2                                             # the yard's far end
# A Blender font curve of size 1 draws this font's kanji 0.327 m tall: scaled so a kanji is 0.88 em.
EM = 0.88 / 0.327

FRONT = (1, 0, 0)
UP = (0, 0, 1)
UV1 = [(0, 0), (1, 0), (1, 1), (0, 1)]


def plane(o, right, up):
    """Matrix for text: its x along `right`, y along `up`, +z out of the face."""
    r, u = Vector(right), Vector(up)
    n = r.cross(u)
    return Matrix(((r.x, u.x, n.x, o[0]), (r.y, u.y, n.y, o[1]), (r.z, u.z, n.z, o[2]), (0, 0, 0, 1)))


def text(font, body, em, m, mat, coll, name, extrude=0.012, align="CENTER", rot=0.0):
    """Lettering at a fixed em (so kana keep their sizes against kanji) on the plane of m, centred on its origin."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, em * EM, extrude
    cu.align_x, cu.align_y, cu.resolution_u = align, "CENTER", 2
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    # the font's centre line is not the glyphs': centre them on their own box (vertically), and lift off the face
    ys = [v.co.y for v in me.vertices]
    cy = (max(ys) + min(ys)) / 2
    R = Matrix.Rotation(rot, 4, "Z")
    for v in me.vertices:
        v.co = m @ (R @ Vector((v.co.x, v.co.y - cy, v.co.z + extrude)))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def column(font, chars, em, m, mat, coll, name, gap=1.04, extrude=0.012):
    """Upright lettering, top to bottom from m's origin."""
    n = 0
    for i, ch in enumerate(chars):
        mi = m @ Matrix.Translation((0, -i * em * gap, 0))
        n += text(font, ch, em, mi, mat, coll, f"{name}{i}", extrude=extrude)
    return n


def spaced(font, chars, em, step, o, mat, coll, name, extrude=0.012):
    """A row of characters `step` apart, centred on o, on a face looking +x."""
    n = 0
    for i, ch in enumerate(chars):
        y = o[1] + (i - (len(chars) - 1) / 2) * step
        n += text(font, ch, em, plane((o[0], y, o[2]), (0, 1, 0), UP), mat, coll, f"{name}{i}", extrude=extrude)
    return n


def glowing(name, color, rough, emit, props, tex=None):
    """A material with a constant emission (`emit: night` in props shows it only after dark)."""
    m = material(name, color, rough, tex=tex, props=props)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Emission Color"].default_value = (*linear(emit), 1.0)
    b.inputs["Emission Strength"].default_value = 1.0
    return m




# --- textures --------------------------------------------------------------------------------------------

def dot(cv, cx, cy, rx, ry, col):
    """An ellipse stamped on its own box (the canvas's ellipse() walks every pixel: too slow for thousands of leaves)."""
    x0, x1 = max(0, int(cx - rx)), min(cv.w, int(cx + rx) + 2)
    y0, y1 = max(0, int(cy - ry)), min(cv.h, int(cy + ry) + 2)
    if x0 >= x1 or y0 >= y1:
        return
    X, Y = cv.x[y0:y1, x0:x1], cv.y[y0:y1, x0:x1]
    sub = cv.a[y0:y1, x0:x1]
    sub[((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1] = cv.c(col)


def seg(cv, x0, y0, x1, y1, w, col):
    """A line stamped on its own box."""
    xa, xb = max(0, int(min(x0, x1) - w)), min(cv.w, int(max(x0, x1) + w) + 2)
    ya, yb = max(0, int(min(y0, y1) - w)), min(cv.h, int(max(y0, y1) + w) + 2)
    if xa >= xb or ya >= yb:
        return
    X, Y = cv.x[ya:yb, xa:xb], cv.y[ya:yb, xa:xb]
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy or 1.0
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    sub = cv.a[ya:yb, xa:xb]
    sub[np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy)) <= w / 2] = cv.c(col)


LEAVES = ("#24452a", "#2c5530", "#3b6e38", "#4f8a45", "#5c9650", "#33603a")


def leaves(cv, rng, n, box, size=(3, 7)):
    """Ivy: `n` leaves in a box (canvas px), dark ones first so the light ones sit on top."""
    x0, y0, x1, y1 = box
    pts = [(rng.uniform(x0, x1), rng.uniform(y0, y1), rng.integers(len(LEAVES))) for _ in range(n)]
    for x, y, k in sorted(pts, key=lambda p: p[2]):
        r = rng.uniform(*size)
        dot(cv, x, y, r, r * rng.uniform(0.7, 0.95), LEAVES[k])


def shopwall_image():
    """The shop's front, 4.3 x 6.2 m at 80 px a metre: beige-grey stucco, run-down streaks, a net of vine stems
    over the upper storey, ivy over the window and down the right-hand corner (as on the card)."""
    K = 80
    W, H = int((SY1 - SY0) * K), int(STOP * K)
    cv = Canvas(W, H, "#bdb7a7")
    cv.noise(0.07, 101)
    P = lambda y, z: ((y - SY0) * K, (STOP - z) * K)  # noqa: E731
    rng = np.random.default_rng(102)
    for _ in range(30):                                   # streaks from the parapet and under the sill
        x, w = rng.uniform(0, W), rng.uniform(2, 7)
        y0 = 0.0 if rng.random() < 0.6 else (STOP - WZ0) * K
        L = rng.uniform(40, 220)
        m = (np.abs(cv.x - x) < w) & (cv.y > y0) & (cv.y < y0 + L)
        cv.a[m] *= (0.86 + 0.12 * ((cv.y[m] - y0) / L))[..., None]
    for _ in range(90):                                   # vine stems, wandering, mostly upstairs
        x, y = rng.uniform(0, W), rng.uniform(0, (STOP - 2.3) * K)
        a = rng.uniform(0, 2 * math.pi)
        for _ in range(int(rng.integers(4, 11))):
            a += rng.normal(0, 0.7)
            L = rng.uniform(8, 24)
            x1, y1 = x + L * math.cos(a), y + L * math.sin(a)
            seg(cv, x, y, x1, y1, 1.2, "#5d574a")
            x, y = x1, y1
    box = lambda ya, yb, za, zb: (*P(ya, zb), *P(yb, za))  # noqa: E731
    leaves(cv, rng, 1400, box(-3.15, 0.45, 4.75, 5.6))     # the mat over the window
    leaves(cv, rng, 260, box(-2.7, -0.3, 4.55, 4.85), (2, 5))
    leaves(cv, rng, 1500, box(0.42, 1.0, 1.7, 6.2))        # the right-hand corner, top to the yard
    leaves(cv, rng, 300, box(-3.3, -2.75, 4.3, 5.9))       # a tongue down the left
    leaves(cv, rng, 260, box(-1.2, 1.0, 5.85, 6.2))        # along the parapet
    cv.noise(0.05, 103)
    return image("TF_ShopWall", np.flipud(cv.a).copy())


def ivy_image():
    """Ivy, 1 m a repeat: leaves on leaves."""
    cv = Canvas(128, 128, "#1f3d24")
    rng = np.random.default_rng(111)
    leaves(cv, rng, 700, (-6, -6, 134, 134), (3, 7))
    cv.noise(0.08, 112)
    return image("TF_Ivy", np.flipud(cv.a).copy())


def tiles_image():
    """Grey kawara, 1 m a repeat: courses every 25 cm down the slope (v), round channels every 25 cm along (u)."""
    cv = Canvas(128, 128, "#3c3f43")
    u = np.mod(cv.x, 32) / 32
    cv.a *= (0.78 + 0.34 * np.sin(u * math.pi))[..., None]
    v = np.mod(cv.y, 32)
    cv.a[v < 3] *= 0.55                                   # the shadow under each course's lip
    cv.a[(v >= 3) & (v < 6)] *= 1.18
    cv.noise(0.08, 121)
    return image("TF_Tiles", np.flipud(cv.a).copy())


def plaster_image():
    """The dry cleaner's white walls, 2 m a repeat: off-white, grimy low down and under the eaves."""
    cv = Canvas(128, 128, "#e3dfd4")
    cv.noise(0.06, 131)
    rng = np.random.default_rng(132)
    for _ in range(8):
        x, w, L = rng.uniform(0, 128), rng.uniform(2, 6), rng.uniform(20, 90)
        m = (np.abs(cv.x - x) < w) & (cv.y < L)
        cv.a[m] *= 0.93
    return image("TF_Plaster", np.flipud(cv.a).copy())


def brick_image():
    """Red brick, 1 m a repeat (128 px): 21 x 6 cm bricks, stretcher bond, grey mortar."""
    cv = Canvas(128, 128, "#8f4a36")
    rng = np.random.default_rng(141)
    rows = (cv.y // 8).astype(int)
    cols = ((cv.x + (rows % 2) * 13.5) // 27).astype(int)
    tint = rng.uniform(0.8, 1.15, (17, 7))
    cv.a *= tint[rows % 17, cols % 7][..., None]
    cv.put((np.mod(cv.y, 8) < 1.2) | (np.mod(cv.x + (rows % 2) * 13.5, 27) < 1.2), "#8a857b")
    cv.noise(0.08, 142)
    return image("TF_Brick", np.flipud(cv.a).copy())


def slats_image():
    """The slatted wooden door, 1 m a repeat: brown boards 10 cm wide, darker joints, grain."""
    cv = Canvas(128, 128, "#7a5236")
    rng = np.random.default_rng(151)
    col = (cv.x // 12.8).astype(int)
    cv.a *= rng.uniform(0.85, 1.12, 10)[col % 10][..., None]
    cv.a *= (0.93 + 0.07 * np.sin(cv.y * 0.6 + col * 2.1))[..., None]
    cv.put(np.mod(cv.x, 12.8) < 1.3, "#3e2a1d")
    cv.noise(0.08, 152)
    return image("TF_Slats", np.flipud(cv.a).copy())


def fence_image():
    """The yard's board fence, 2 m a repeat: weathered dark boards, 18 cm, a gap between."""
    cv = Canvas(128, 128, "#5a4636")
    rng = np.random.default_rng(161)
    col = (cv.x // 11.5).astype(int)
    cv.a *= rng.uniform(0.8, 1.15, 12)[col % 12][..., None]
    cv.put(np.mod(cv.x, 11.5) < 1.2, "#231b14")
    cv.put((np.abs(cv.y - 20) < 1.5) | (np.abs(cv.y - 100) < 1.5), "#3a2d22")
    cv.noise(0.1, 162)
    return image("TF_Fence", np.flipud(cv.a).copy())


def noren_image():
    """The noren in the door bay: dark indigo, split down the middle, a white crest high up."""
    cv = Canvas(128, 192, "#262a38")
    cv.noise(0.08, 171)
    cv.rect(62, 0, 66, 192, "#15171f")
    cx, cy = 64, 64
    cv.ring(cx, cy, 25, 31, "#e8e6df")
    for (a, b, c, d) in ((48, 52, 80, 57), (60, 48, 68, 84), (48, 70, 80, 76)):  # a crest of bars inside the ring
        cv.rect(a, b, c, d, "#e8e6df")
    cv.ring(cx + 8, cy + 14, 9, 12, "#e8e6df")
    return image("TF_Noren", np.flipud(cv.a).copy())


def yardwall_image():
    """The low wall in the yard: white, painted along its foot with blades of grass (one panel, 1.8 x 0.75 m)."""
    cv = Canvas(256, 112, "#e8eae5")
    cv.noise(0.05, 181)
    rng = np.random.default_rng(182)
    for _ in range(90):
        x = rng.uniform(0, 256)
        h, lean = rng.uniform(20, 70), rng.uniform(-14, 14)
        seg(cv, x, 112, x + lean, 112 - h, rng.uniform(1.5, 3), rng.choice(["#4a5a4c", "#6b7a64", "#38463a"]))
    return image("TF_YardWall", np.flipud(cv.a).copy())


def board_image():
    """The balcony's yellow board, 2 m a repeat: faded yellow, rust run down from its top rail."""
    cv = Canvas(128, 64, "#d6c472")
    cv.noise(0.07, 191)
    rng = np.random.default_rng(192)
    for _ in range(14):
        x, L = rng.uniform(0, 128), rng.uniform(8, 34)
        cv.put((np.abs(cv.x - x) < rng.uniform(1, 2.2)) & (cv.y < L), "#8d6a3c")
    return image("TF_Board", np.flipud(cv.a).copy())


def curtain_image():
    """Curtains behind the glass, 1 m a repeat: pale folds."""
    cv = Canvas(64, 64, "#cfc8b8")
    cv.a *= (0.82 + 0.18 * np.sin(cv.x * 0.8) ** 2)[..., None]
    cv.noise(0.04, 201)
    return image("TF_Curtain", np.flipud(cv.a).copy())


def concrete_image():
    """The apron: grey concrete, 4 m a repeat, a joint every 2 m and a few stains."""
    cv = Canvas(256, 256, "#a19e96")
    cv.noise(0.08, 71)
    rng = np.random.default_rng(72)
    for _ in range(6):
        cv.ellipse(rng.uniform(0, 256), rng.uniform(0, 256), rng.uniform(8, 30), rng.uniform(5, 20), cv.a.mean((0, 1)) * 0.9)
    cv.put((np.mod(cv.x, 128) < 1.5) | (np.mod(cv.y, 128) < 1.5), "#6f6c66")
    return image("TF_Concrete", np.flipud(cv.a).copy())


# --- parts -----------------------------------------------------------------------------------------------

def window(g, x, ya, yb, za, zb, panes=2, frame="alu", glass="glass", t=0.05, out=1, bars=()):
    """A frame of `panes` lights in the plane x (facing +x when out = 1), and transoms at the heights `bars`."""
    s = out * 0.012
    if glass:
        g.polyn([(x, ya, za), (x, yb, za), (x, yb, zb), (x, ya, zb)], glass, (out, 0, 0))
    sk = ("-x" if out > 0 else "+x",)
    for (a, b, c, d) in ((ya, yb, za, za + t), (ya, yb, zb - t, zb), (ya, ya + t, za, zb), (yb - t, yb, za, zb)):
        g.box(min(x, x + s * 3), max(x, x + s * 3), a, b, c, d, frame, skip=sk)
    for k in range(1, panes):
        y = ya + (yb - ya) * k / panes
        g.box(min(x, x + s * 4), max(x, x + s * 4), y - t / 2, y + t / 2, za, zb, frame, skip=sk)
    for z in bars:
        g.box(min(x, x + s * 4), max(x, x + s * 4), ya, yb, z - t / 2, z + t / 2, frame, skip=sk)


def quad(g, x, ya, yb, za, zb, key, uvs=None):
    """A rectangle in the plane x, facing +x."""
    g.polyn([(x, ya, za), (x, yb, za), (x, yb, zb), (x, ya, zb)], key, FRONT, uvs=uvs)


def holed(g, x, y0, y1, z0, z1, holes, key, uv=None):
    """A wall in the plane x (facing +x) from y0..y1, z0..z1, less the rectangles `holes` (ya, yb, za, zb): cut
    into strips at every hole's edges. `uv(y, z)` maps a point to its texture coordinates (else planar)."""
    ys = sorted({y0, y1, *[min(max(v, y0), y1) for h in holes for v in h[:2]]})
    for ya, yb in zip(ys, ys[1:]):
        if yb - ya < 1e-4:
            continue
        gaps = sorted((h[2], h[3]) for h in holes if h[0] <= ya + 1e-4 and h[1] >= yb - 1e-4)
        z = z0
        for za, zb in gaps + [(z1, z1)]:
            za, zb = max(za, z0), min(zb, z1)
            if za - z > 1e-4:
                uvs = [uv(ya, z), uv(yb, z), uv(yb, za), uv(ya, za)] if uv else None
                g.polyn([(x, ya, z), (x, yb, z), (x, yb, za), (x, ya, za)], key, FRONT, uvs=uvs)
            z = max(z, zb)


def reveal(g, x0, x1, ya, yb, za, zb, key):
    """The four sides of an opening cut from the plane x1 back to x0 (facing into the opening)."""
    g.polyn([(x0, ya, za), (x1, ya, za), (x1, ya, zb), (x0, ya, zb)], key, (0, 1, 0))
    g.polyn([(x0, yb, za), (x1, yb, za), (x1, yb, zb), (x0, yb, zb)], key, (0, -1, 0))
    g.polyn([(x0, ya, za), (x1, ya, za), (x1, yb, za), (x0, yb, za)], key, UP)
    g.polyn([(x0, ya, zb), (x1, ya, zb), (x1, yb, zb), (x0, yb, zb)], key, (0, 0, -1))


def blob(g, c, r, key="ivy"):
    """A clump of ivy: a low ellipsoid."""
    ell(g, c, r, key, nu=6, nv=4)


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    none = {"glow": "none"}
    lamp = lambda col, k: {"wet": "surface", "glow": "lamp", "glowColor": col, "glowStrength": k}  # noqa: E731
    damp = {"wet": "damp", **none}
    M = dict(
        wall=material("TF_ShopWall", "#ffffff", 0.9, tex=shopwall_image(), props=damp),
        stucco=material("TF_Stucco", "#b4ae9e", 0.9, props=damp),
        ivy=material("TF_Ivy", "#ffffff", 0.8, tex=ivy_image(), props={"wet": "surface", **none}),
        plaster=material("TF_Plaster", "#ffffff", 0.85, tex=plaster_image(), props=damp),
        tiles=material("TF_Tiles", "#ffffff", 0.96, tex=tiles_image(), props={"wet": "surface", **none}),
        darkwood=material("TF_DarkWood", "#3a2c22", 0.75, props=damp),
        board=material("TF_Board", "#ffffff", 0.7, tex=board_image(), props=damp),
        brick=material("TF_Brick", "#ffffff", 0.9, tex=brick_image(), props=damp),
        slats=material("TF_Slats", "#ffffff", 0.8, tex=slats_image(), props=damp),
        noren=material("TF_Noren", "#ffffff", 0.95, tex=noren_image(), props=damp),
        fence=material("TF_Fence", "#ffffff", 0.9, tex=fence_image(), props=damp),
        yardwall=material("TF_YardWall", "#ffffff", 0.8, tex=yardwall_image(), props=damp),
        concrete=material("TF_Concrete", "#ffffff", 0.9, tex=concrete_image(), props={"wet": "ground", "layer": 9, **none}),
        alu=material("TF_Alu", "#c7cbcb", 0.35, metal=0.75, props={"wet": "surface", **none}),
        wood=material("TF_Wood", "#8a6a48", 0.75, props=damp),
        dark=material("TF_Dark", "#1b1c1d", 0.85, props=damp),
        paint=material("TF_White", "#e8e8e4", 0.55, props={"wet": "surface", **none}),
        ink=material("TF_Ink", "#151413", 0.5, props={"wet": "surface", **none}),
        red=material("TF_Red", "#c4232b", 0.5, props={"wet": "surface", **none}),
        blue=material("TF_Blue", "#1d3f93", 0.5, props={"wet": "surface", **none}),
        # dark by day, lit after dark: the shop's glass, the curtained windows
        glass=material("TF_Glass", "#56636c", 0.12, metal=0.3, props={"wet": "surface", **none}),
        shopglass=glowing("TF_ShopGlass", "#2a2f32", 0.08, "#9a8f78", {"wet": "surface", "emit": "night", **none}),
        curtain=glowing("TF_Curtain", "#ffffff", 0.7, "#6e604a", {"wet": "surface", "emit": "night", **none}, tex=curtain_image()),
        light=material("TF_Light", "#f4f1e8", 0.4, props=lamp([1.0, 0.97, 0.9], 0.8)),
        # the signs: lit boxes, the white ones weathered to a grey by day
        signw=material("TF_SignWhite", "#dedcd5", 0.5, props=lamp([1.0, 0.98, 0.94], 0.45)),
        yellow=material("TF_SignYellow", "#e9c64a", 0.5, props=lamp([1.0, 0.85, 0.3], 0.4)),
    )
    for a, b in (("coping", "stucco"), ("roof", "concrete"), ("pipe", "paint"), ("meter", "alu"), ("crate", "wood")):
        M[a] = M[b]
    TILE = dict(concrete=4.0, plaster=2.0, brick=1.0, slats=1.0, fence=2.0, board=2.0, ivy=1.0, stucco=2.0, coping=1.0)
    main = collection("藤原豆腐店")
    g = Geo()
    font = bpy.data.fonts.load(FONT)
    lt = collection("招牌字", main)
    nl = 0
    rng = np.random.default_rng(7)

    # ================= the shop =================
    # its box: the south side (above the neighbour's roof) and the back in stucco, the north side under ivy
    g.polyn([(FX, SY0, 0), (BX, SY0, 0), (BX, SY0, STOP), (FX, SY0, STOP)], "stucco", (0, -1, 0))
    g.polyn([(FX, SY1, 0), (BX, SY1, 0), (BX, SY1, STOP), (FX, SY1, STOP)], "ivy", (0, 1, 0))
    g.polyn([(BX, SY0, 0), (BX, SY1, 0), (BX, SY1, STOP), (BX, SY0, STOP)], "stucco", (-1, 0, 0))
    wt, r = 0.18, STOP - 0.35
    for (xa, xb, a, b) in ((FX - wt, FX + 0.04, SY0, SY1), (BX - 0.04, BX + wt, SY0, SY1), (BX, FX, SY0 - 0.02, SY0 + wt), (BX, FX, SY1 - wt, SY1 + 0.02)):
        g.box(xa, xb, a, b, STOP, STOP + 0.06, "coping", skip=("-z",))
    g.polyn([(FX - wt, SY0 + wt, r), (BX + wt, SY0 + wt, r), (BX + wt, SY1 - wt, r), (FX - wt, SY1 - wt, r)], "roof", UP)
    for (pa, pb, nn) in (((FX - wt, SY0 + wt), (FX - wt, SY1 - wt), (-1, 0, 0)), ((BX + wt, SY0 + wt), (BX + wt, SY1 - wt), (1, 0, 0)),
                         ((BX + wt, SY0 + wt), (FX - wt, SY0 + wt), (0, 1, 0)), ((BX + wt, SY1 - wt), (FX - wt, SY1 - wt), (0, -1, 0))):
        g.polyn([(*pa, r), (*pb, r), (*pb, STOP), (*pa, STOP)], "coping", nn)
    # the front, in the card's texture: everything but the window, the open shop and the door bay
    suv = lambda y, z: ((y - SY0) / (SY1 - SY0), z / STOP)  # noqa: E731
    holed(g, FX, SY0, SY1, 0.0, STOP, [(WY0, WY1, WZ0, WZ1), (OP0, OP1, 0.0, OPH), (OP1, DB1, 0.0, 2.4), (SY0, OP0, 0.0, OPH), (DB1, SY1, 0.0, DBH)], "wall", suv)
    # upstairs: the window set back 8 cm (curtains behind the glass), its railing, the air-conditioner
    reveal(g, FX - 0.08, FX, WY0, WY1, WZ0, WZ1, "stucco")
    window(g, FX - 0.08, WY0, WY1, WZ0, WZ1, panes=4, frame="alu", glass="curtain", t=0.045, bars=(WZ1 - 0.24,))
    g.box(FX, FX + 0.07, WY0 - 0.06, WY1 + 0.06, WZ0 - 0.06, WZ0, "stucco", skip=("-x",))           # the sill
    RX, R0, R1, RZ0, RZ1 = FX + 0.3, WY0 - 0.14, WY1 + 0.08, 3.74, 4.3
    for z in (RZ0, RZ1 - 0.03, RZ0 + 0.18):
        g.box(RX - 0.015, RX + 0.015, R0, R1, z, z + 0.03, "paint")
    n = int((R1 - R0) / 0.12)
    for k in range(n + 1):
        y = R0 + (R1 - R0) * k / n
        g.box(RX - 0.008, RX + 0.008, y - 0.008, y + 0.008, RZ0, RZ1, "paint", skip=("-z", "+z"))
    for y in (R0, R1):
        g.box(FX, RX, y - 0.012, y + 0.012, RZ0, RZ0 + 0.03, "paint")
        g.box(FX, RX, y - 0.012, y + 0.012, RZ1 - 0.03, RZ1, "paint")
    g.box(FX, FX + 0.32, -0.5, 0.0, 3.94, 4.89, "paint", skip=("-x",))                               # the window unit
    quad(g, FX + 0.321, -0.44, -0.06, 4.0, 4.7, "dark")
    for k in range(5):
        z = 4.06 + k * 0.13
        g.box(FX + 0.321, FX + 0.34, -0.44, -0.06, z, z + 0.025, "paint")
    cyl(g, FX + 0.07, SY0 + 0.1, 0.0, STOP - 0.1, 0.045, 0.045, 6, "pipe", caps=(False, False))     # the downpipe
    # downstairs, left to right: a brick pier
    g.box(FX - 0.01, FX + 0.06, SY0, OP0, 0.0, OPH, "brick", skip=("-x",))
    # the open shop: dark inside, a sliding glass door, crates, a tube on the ceiling
    xb = FX - OPD
    reveal(g, xb, FX, OP0, OP1, 0.0, OPH, "dark")
    g.polyn([(xb, OP0, 0.02), (FX, OP0, 0.02), (FX, OP1, 0.02), (xb, OP1, 0.02)], "concrete", UP)
    quad(g, xb, OP0, OP1, 0.0, OPH, "dark")
    window(g, FX - 0.12, -1.62, OP1, 0.02, 2.05, panes=1, frame="paint", glass="shopglass", t=0.05, bars=(0.9,))
    g.box(FX - 0.12, FX - 0.06, OP0, OP0 + 0.05, 0.0, OPH, "paint")
    for (ya, yb, za, zb, xa) in ((-1.6, -1.05, 0.0, 0.34, FX - 0.85), (-1.58, -1.08, 0.34, 0.68, FX - 0.85), (-2.35, -1.85, 0.0, 0.34, FX - 1.0)):
        g.box(xa, xa + 0.42, ya, yb, za, zb, "crate")
    g.polyn([(FX - 0.85, -2.5, OPH - 0.02), (FX - 0.75, -2.5, OPH - 0.02), (FX - 0.75, -1.3, OPH - 0.02), (FX - 0.85, -1.3, OPH - 0.02)], "light", (0, 0, -1))
    # the header over the open shop and the door bay, the post between them
    g.box(FX - 0.02, FX + 0.07, OP0, DB1, OPH, 2.4, "darkwood", skip=("-x",))
    g.box(FX - 0.1, FX + 0.04, OP1, DB0, 0.0, OPH, "darkwood")
    g.box(FX + 0.04, FX + 0.05, OP1 + 0.01, DB0 - 0.01, 1.42, 1.7, "paint")
    # the door bay, 15 cm in: a glazed transom; a noren with its crest, dark behind; a slatted wooden door
    xd = FX - 0.15
    reveal(g, xd, FX, DB0, DB1, 0.0, OPH, "darkwood")
    window(g, xd + 0.01, DB0, DB1, DBH, OPH, panes=3, frame="darkwood", glass="shopglass", t=0.04)
    g.box(xd, FX, DB0, DB1, DBH - 0.05, DBH, "darkwood", skip=("+x",))
    NM = -0.19
    reveal(g, xd - 0.9, xd, DB0, NM, 0.0, DBH - 0.05, "dark")
    quad(g, xd - 0.9, DB0, NM, 0.0, DBH - 0.05, "dark")
    quad(g, xd + 0.02, DB0 + 0.02, NM - 0.02, 0.92, DBH - 0.06, "noren", uvs=UV1)
    g.box(xd + 0.02, xd + 0.04, DB0, NM, DBH - 0.08, DBH - 0.05, "alu")
    quad(g, xd, NM, DB1, 0.0, DBH - 0.05, "slats")
    g.box(xd, xd + 0.04, NM, NM + 0.04, 0.0, DBH - 0.05, "darkwood")
    cyl(g, xd + 0.08, 0.38, 0.22, 0.52, 0.045, 0.045, 6, "paint")                                    # a white bottle on the door
    # the red brick pier on the right
    g.box(FX - 0.01, FX + 0.07, DB1, SY1, 0.0, DBH, "brick", skip=("-x",))
    # the sign's bracket at its right end: a quarter curve of bar from the pier up to its foot
    for k in range(4):
        a0, a1 = math.pi / 2 * k / 4, math.pi / 2 * (k + 1) / 4
        p0 = (FX + 0.45 * (1 - math.cos(a0)), 2.0 + 0.4 * math.sin(a0))
        p1 = (FX + 0.45 * (1 - math.cos(a1)), 2.0 + 0.4 * math.sin(a1))
        g.box(min(p0[0], p1[0]) - 0.012, max(p0[0], p1[0]) + 0.012, 0.86, 0.89, min(p0[1], p1[1]) - 0.012, max(p0[1], p1[1]) + 0.012, "alu")
    # ivy in the round: down the right-hand corner and round it, a mat over the window, a tongue on the left
    for z in np.arange(1.85, STOP + 0.05, 0.3):
        j = rng.uniform(-0.06, 0.06, 4)
        blob(g, (FX + 0.05, SY1 - 0.2 + j[0], z + j[1]), (0.12, 0.3, 0.24))
        blob(g, (FX - 0.4 + j[2], SY1 + 0.05, z + j[3]), (0.42, 0.11, 0.24))
        if z > 3.0:
            blob(g, (FX - 1.3 + j[2], SY1 + 0.05, z - 0.1), (0.5, 0.1, 0.26))
    for y in np.arange(-3.0, 0.45, 0.3):
        blob(g, (FX + 0.05, y + rng.uniform(-0.05, 0.05), 5.18 + rng.uniform(-0.08, 0.08)), (0.1, 0.27, 0.3))
        if rng.random() < 0.6:
            blob(g, (FX + 0.04, y + 0.12, 4.86 + rng.uniform(-0.06, 0.04)), (0.07, 0.13, 0.17))
    for z in (5.0, 5.35, 5.7):
        blob(g, (FX + 0.05, SY0 + 0.3 + rng.uniform(-0.05, 0.05), z), (0.09, 0.2, 0.22))

    # ---- the sign: four barrel-topped panels between aluminium ribs ----
    prof = [(FX, S0), (FX + SD, S0), (FX + SD, S1)]
    for k in range(1, 9):
        a = math.pi / 2 * k / 8
        prof.append((FX + SD * math.cos(a), S1 + SR * math.sin(a)))
    segs = list(zip(prof, prof[1:]))
    for k in range(4):
        a, b = TYS[k], TYS[k + 1]
        key = "yellow" if k == 0 else "signw"
        for (pa, pb) in segs:
            d = (pb[0] - pa[0], pb[1] - pa[1])
            g.polyn([(pa[0], a, pa[1]), (pa[0], b, pa[1]), (pb[0], b, pb[1]), (pb[0], a, pb[1])], key, (d[1], 0, -d[0]))
    for y, nn in ((TY0, (0, -1, 0)), (TY1, (0, 1, 0))):
        g.polyn([(x, y, z) for x, z in prof], "alu", nn)
    e, rw = 0.018, 0.022
    for y in TYS:
        for (pa, pb) in segs[1:]:
            d = Vector((pb[0] - pa[0], pb[1] - pa[1]))
            nv = Vector((d.y, -d.x)).normalized() * e
            qa, qb = (pa[0] + nv.x, pa[1] + nv.y), (pb[0] + nv.x, pb[1] + nv.y)
            g.polyn([(qa[0], y - rw, qa[1]), (qa[0], y + rw, qa[1]), (qb[0], y + rw, qb[1]), (qb[0], y - rw, qb[1])], "alu", (nv.x, 0, nv.y))
            for s in (-1, 1):
                g.polyn([(pa[0], y + s * rw, pa[1]), (qa[0], y + s * rw, qa[1]), (qb[0], y + s * rw, qb[1]), (pb[0], y + s * rw, pb[1])], "alu", (0, s, 0))
    g.box(FX, FX + SD + 0.035, TY0 - 0.03, TY1 + 0.03, S0 - 0.07, S0, "alu")
    g.box(FX + SD, FX + SD + 0.04, TY0 - 0.03, TY1 + 0.03, S0 - 0.1, S0 - 0.07, "alu")
    # its lettering, placed off the card
    sx = FX + SD
    yc = (TYS[0] + TYS[1]) / 2
    nl += text(font, "とうふ", 0.27, plane((sx, yc, 3.1), (0, 1, 0), UP), M["ink"], lt, "Y1")
    nl += text(font, "油あげ", 0.27, plane((sx, yc, 2.79), (0, 1, 0), UP), M["ink"], lt, "Y2")
    nl += spaced(font, "手づくりの店", 0.21, 0.27, (sx, -1.84, 3.27), M["ink"], lt, "T")
    for i, (ch, y) in enumerate(zip("藤原豆腐店", (-2.68, -2.18, -1.46, -0.92, -0.13))):
        nl += text(font, ch, 0.38, plane((sx, y, 2.79), (0, 1, 0), UP), M["ink"], lt, f"B{i}")

    # ================= the dry cleaner's =================
    LW = LY0 - 0.5                                    # its eaves' far end
    g.polyn([(FX, LY0, 0), (BX, LY0, 0), (BX, LY0, LEAVE), (FX, LY0, LEAVE)], "plaster", (0, -1, 0))
    g.polyn([(BX, LY0, 0), (BX, LY1, 0), (BX, LY1, LEAVE), (BX, LY0, LEAVE)], "plaster", (-1, 0, 0))
    # downstairs: a curtained window, a garage opening, a window and a glazed door over a brick base
    GA0, GA1 = -7.5, -5.94
    low = [(-10.0, -8.6, 0.75, 1.55), (-10.3, -8.3, 0.0, 0.6), (GA0, GA1, 0.0, 1.75), (-5.78, -4.83, 0.64, 1.5), (GA1, -4.69, 0.0, 0.6), (-4.69, -3.89, 0.0, 1.8), (-3.89, LY1, 0.0, CAN0)]
    holed(g, FX, LY0, LY1, 0.0, CAN0, low, "plaster")
    for (ya, yb) in ((-10.3, -8.3), (GA1, -4.69)):
        quad(g, FX + 0.03, ya, yb, 0.0, 0.6, "brick")
        g.box(FX, FX + 0.06, ya, yb, 0.6, 0.64, "paint", skip=("-x",))
    for (ya, yb, za, zb) in ((-10.0, -8.6, 0.75, 1.55), (-5.78, -4.83, 0.64, 1.5)):
        reveal(g, FX - 0.06, FX, ya, yb, za, zb, "paint")
        window(g, FX - 0.06, ya, yb, za, zb, panes=2, frame="alu", glass="curtain", t=0.04)
    reveal(g, FX - 2.5, FX, GA0, GA1, 0.0, 1.75, "dark")
    quad(g, FX - 2.5, GA0, GA1, 0.0, 1.75, "dark")
    g.polyn([(FX - 2.5, GA0, 0.02), (FX, GA0, 0.02), (FX, GA1, 0.02), (FX - 2.5, GA1, 0.02)], "concrete", UP)
    reveal(g, FX - 0.08, FX, -4.69, -3.89, 0.0, 1.8, "paint")
    window(g, FX - 0.08, -4.69, -3.89, 0.0, 1.8, panes=2, frame="alu", glass="shopglass", t=0.045, bars=(0.95,))
    g.box(FX, FX + 0.05, -3.89, -3.72, 0.0, CAN0, "paint", skip=("-x",))                 # a white pilaster
    g.box(FX, FX + 0.1, -3.72, LY1, 0.0, CAN0, "stucco", skip=("-x",))                   # the grey pillar by the shop
    # the canopy beam, the balcony and its yellow board, white rails above and below
    g.box(FX, BALX + 0.05, LY0, LY1, CAN0, CAN1, "darkwood")
    BE = -4.35                                        # the board ends short of the shop's sign
    g.box(BALX, BALX + 0.04, LY0 + 0.15, BE, CAN1, BAL1, "board", skip=("-z", "+z"))
    for y in (LY0 + 0.15, BE):
        g.polyn([(FX, y, CAN1), (BALX, y, CAN1), (BALX, y, BAL1), (FX, y, BAL1)], "board", (0, -1 if y < -6 else 1, 0))
    g.box(BALX - 0.03, BALX + 0.06, LY0 + 0.12, BE + 0.03, BAL1, BAL1 + 0.07, "paint")
    g.box(BALX + 0.04, BALX + 0.05, LY0 + 0.15, BE, CAN1, CAN1 + 0.09, "paint")
    nl += text(font, "〈第2寄居町〉", 0.15, plane((BALX + 0.04, -7.45, 2.5), (0, 1, 0), UP), M["ink"], lt, "Bd1", extrude=0.004)
    nl += text(font, "TEL.22-0077", 0.19, plane((BALX + 0.04, -5.9, 2.52), (0, 1, 0), UP), M["ink"], lt, "Bd2", extrude=0.004)
    # upstairs: dark wooden windows behind the balcony, plaster between
    up = [(-11.6, -8.3, 3.17, 4.0), (-6.9, -3.5, 3.17, 4.0)]
    holed(g, FX, LY0, LY1, CAN1, LEAVE, up, "plaster")
    for (ya, yb, za, zb) in up:
        reveal(g, FX - 0.06, FX, ya, yb, za, zb, "darkwood")
        window(g, FX - 0.06, ya, yb, za, zb, panes=6, frame="darkwood", glass="glass", t=0.05, bars=(3.78,))
    g.polyn([(FX, LY0, CAN1 + 0.01), (BALX, LY0, CAN1 + 0.01), (BALX, LY1, CAN1 + 0.01), (FX, LY1, CAN1 + 0.01)], "darkwood", UP)
    # its standing sign, on a post behind it and two arms to the board
    g.box(BALX + 0.08, BALX + 0.26, KY0, KY1, KZ0, KZ1, "signw")
    g.box(BALX - 0.02, BALX + 0.08, -4.84, -4.78, BAL1, KZ1 - 0.1, "darkwood")
    for z in (2.6, 2.95):
        g.box(BALX + 0.04, BALX + 0.08, -4.84, -4.78, z, z + 0.05, "alu")
    kx = BALX + 0.26
    for (ya, yb, za, zb) in ((-4.97, -4.95, 3.22, 4.58), (-4.49, -4.47, 3.22, 4.58), (-4.97, -4.47, 4.56, 4.58), (-4.97, -4.47, 3.22, 3.24)):
        g.box(kx, kx + 0.006, ya, yb, za, zb, "red", skip=("-x",))
    nl += column(font, "ドライクリーニング", 0.14, plane((kx, -4.72, 4.47), (0, 1, 0), UP), M["red"], lt, "Kd", gap=1.08, extrude=0.006)
    nl += column(font, "まいど", 0.085, plane((kx, -5.08, 4.45), (0, 1, 0), UP), M["ink"], lt, "Km", gap=1.15, extrude=0.004)
    nl += column(font, "ありがとう", 0.085, plane((kx, -5.08, 4.1), (0, 1, 0), UP), M["ink"], lt, "Ka", gap=1.15, extrude=0.004)
    nl += column(font, "ございます", 0.085, plane((kx, -5.08, 3.52), (0, 1, 0), UP), M["ink"], lt, "Kg", gap=1.15, extrude=0.004)
    nl += column(font, "国際", 0.3, plane((kx, -4.8, 2.98), (0, 1, 0), UP), M["blue"], lt, "Kk", gap=1.05, extrude=0.008)
    # the roof: hipped at the far end, against the shop's wall at this one; fascia and soffit under the eaves
    XE, XB, XM = FX + LOVER, BX - 0.5, (FX + LOVER + BX - 0.5) / 2
    YH = LW + (XE - XM)
    Ls = math.hypot(XE - XM, LRIDGE - LEAVE)
    g.polyn([(XE, LW, LEAVE), (XE, LY1, LEAVE), (XM, LY1, LRIDGE), (XM, YH, LRIDGE)], "tiles", (0.3, 0, 1), uvs=[(LW, 0), (LY1, 0), (LY1, Ls), (YH, Ls)])
    g.polyn([(XB, LW, LEAVE), (XB, LY1, LEAVE), (XM, LY1, LRIDGE), (XM, YH, LRIDGE)], "tiles", (-0.3, 0, 1), uvs=[(LW, 0), (LY1, 0), (LY1, Ls), (YH, Ls)])
    g.polyn([(XE, LW, LEAVE), (XB, LW, LEAVE), (XM, YH, LRIDGE)], "tiles", (0, -0.3, 1), uvs=[(XE, 0), (XB, 0), (XM, Ls)])
    g.polyn([(XE, LY1, LEAVE), (XB, LY1, LEAVE), (XM, LY1, LRIDGE)], "darkwood", (0, 1, 0))
    g.box(XM - 0.13, XM + 0.13, YH - 0.1, LY1, LRIDGE - 0.04, LRIDGE + 0.14, "dark")
    g.box(XE - 0.05, XE, LW, LY1, LEAVE - 0.14, LEAVE, "darkwood")
    g.box(XB, XE, LW, LW + 0.05, LEAVE - 0.14, LEAVE, "darkwood")
    g.polyn([(FX, LW, LEAVE - 0.14), (XE, LW, LEAVE - 0.14), (XE, LY1, LEAVE - 0.14), (FX, LY1, LEAVE - 0.14)], "darkwood", (0, 0, -1))
    g.polyn([(XB, LW, LEAVE - 0.14), (XE, LW, LEAVE - 0.14), (XE, LY0, LEAVE - 0.14), (XB, LY0, LEAVE - 0.14)], "darkwood", (0, 0, -1))

    # ================= the yard: a board fence set back, a low white wall, a bush =================
    FXF = FX - 1.4
    g.box(FXF - 0.05, FXF, SY1, YARD, 0.0, 1.9, "fence")
    g.box(BX, FXF, YARD - 0.05, YARD, 0.0, 1.9, "fence")
    g.box(FX - 0.5, FX - 0.36, 1.6, 3.4, 0.0, 0.75, "stucco", skip=("+x",))
    quad(g, FX - 0.36, 1.6, 3.4, 0.0, 0.75, "yardwall", uvs=UV1)
    g.polyn([(FXF, SY1, 0.025), (FX, SY1, 0.025), (FX, YARD, 0.025), (FXF, YARD, 0.025)], "concrete", UP)
    for (c, rr) in (((FXF + 0.35, 3.9, 0.45), (0.35, 0.5, 0.45)), ((FXF + 0.3, 4.6, 0.6), (0.3, 0.45, 0.6)), ((FX - 0.7, 1.25, 0.35), (0.3, 0.3, 0.35))):
        blob(g, c, rr)

    # ================= the apron =================
    g.polyn([(FX, LY0 - 0.7, 0.025), (KERB - 0.1, LY0 - 0.7, 0.025), (KERB - 0.1, 8.0, 0.025), (FX, 8.0, 0.025)], "concrete", UP)
    g.build("Shop", collection("豆腐店", main), M, TILE)
    tris = g.tris()

    # ---- far level: the two houses, the roof, the signs ----
    far = Geo()
    far.box(BX, FX, SY0, SY1, 0.0, STOP, "stucco", skip=("-z", "+x"))
    quad(far, FX, SY0, SY1, 0.0, STOP, "wall", uvs=UV1)
    far.box(BX, FX, LY0, LY1, 0.0, LEAVE, "plaster", skip=("-z",))
    far.polyn([(XE, LW, LEAVE), (XE, LY1, LEAVE), (XM, LY1, LRIDGE), (XM, YH, LRIDGE)], "tiles", (0.3, 0, 1), uvs=[(LW, 0), (LY1, 0), (LY1, Ls), (YH, Ls)])
    far.polyn([(XB, LW, LEAVE), (XB, LY1, LEAVE), (XM, LY1, LRIDGE), (XM, YH, LRIDGE)], "tiles", (-0.3, 0, 1), uvs=[(LW, 0), (LY1, 0), (LY1, Ls), (YH, Ls)])
    far.box(FX, BALX, LY0, LY1, CAN0, BAL1, "board", skip=("-x",))
    far.box(FX, FX + SD, TYS[0], TYS[1], S0, S1 + SR * 0.6, "yellow", skip=("-x",))
    far.box(FX, FX + SD, TYS[1], TY1, S0, S1 + SR * 0.6, "signw", skip=("-x",))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # ---- colliders ----
    helpers = collection("碰撞体")
    collider_box(helpers, "shop", BX, FX - OPD, SY0, SY1, 0.0, STOP)
    collider_box(helpers, "pier", FX - OPD, FX + 0.07, SY0, OP0, 0.0, STOP)
    collider_box(helpers, "doors", FX - OPD, FX + 0.07, OP1, SY1, 0.0, STOP)
    collider_box(helpers, "over", FX - OPD, FX, OP0, OP1, OPH, STOP)
    collider_box(helpers, "house", BX, FX + 0.1, LY0, LY1, 0.0, LEAVE)
    collider_box(helpers, "balcony", FX, BALX + 0.06, LY0, LY1, CAN0, BAL1 + 0.07)
    collider_box(helpers, "fence", FXF - 0.05, FXF, SY1, YARD, 0.0, 1.9)
    collider_box(helpers, "yardwall", FX - 0.5, FX - 0.36, 1.6, 3.4, 0.0, 0.75)

    flat_marker(helpers, "tofushop_main", rect(BX - 0.1, FX + 0.4, LY0 - 0.1, SY1 + 0.15), "FOOTPRINT")
    flat_marker(helpers, "tofushop_clear", rect(-6.0, KERB - 0.1, LY0 - 0.8, 8.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "tofushop", "藤原豆腐店", "Fujiwara Tofu Shop"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 260
    s.repo_path = REPO
    return dict(tris=tris, letters=nl, far=far.tris())


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
