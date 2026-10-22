# 藤原豆腐店 (2026-10-21): the tofu shop from 头文字D, built in Blender and marked with the bcity_landmark add-on's
# conventions. Three rounds that day: after a photo of the film's shop (「我还想把照片上面的豆腐店做出来」「放在亮马桥，
# 照片原样的日式，招牌上面的店名」); after two photos of replica shops (「按照图片1:1还原」); and now the street after the
# day photo (「把街景做成下图的样式，右边没有房子，左边有」).
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
# apron where a car stands, as in the photo.
#
# The day photo, measured with the door (2.07 m) for scale, left to right (south to north):
#   - a low building painted in bands (green, navy with a yellow ruler and set square, blue, red), a strip of
#     artificial grass before it;
#   - a grey building, the shop in the right of its ground floor: on the left, pale grey panels with a white pilaster,
#     a dark band and a pale strip over them, vertical corrugated cladding above everything;
#   - the shop (4.2 m): the sign of four barrel-topped panels between aluminium ribs, its foot 2.4 m up - a yellow
#     one (とうふ 油あげ) and three white (手づく | りの店 over 藤原 | 豆腐 | 店); under it, between thin wooden strips, a
#     grey panel, a glazed door (the poster おいしい 豆腐は 国産大豆, the shop dark inside), a window (藤原豆腐店 down each
#     upper light, two small lights, a panel), a glass door with the Great Wave hung behind it (a short wave noren
#     below), a weathered timber post with a meter box;
#   - nothing to the right: the building ends at the post.
# Not from the photo: the backs and roofs, the depths (8 m and 5 m), the heights above the frame (6.5 m and 4 m).

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, flat_marker, rect  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tofushop.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = 5606.10, -4484.66, -4.82
KERB = 6.5
FX, BX = 2.5, -5.5             # the grey building's front and back
TOP = 6.5
# along the street (y), south to north
MY0, MY1 = -12.3, -5.16        # the painted building (4 m high, standing 0.3 m forward)
MX, MTOP = FX + 0.3, 4.0
GY0, GY1 = MY1, 0.85           # the grey building
TY0, TY1 = -3.28, 1.07         # the sign
SY0, SY1 = -3.2, 0.95          # the shop front, from the first wooden strip to the post's far side
# the sign: four panels standing out SD, an upright face S0..S1 and a rounded top of SR back to the wall
S0, S1, SD, SR = 2.4, 3.15, 0.38, 0.27
PANEL = (TY1 - TY0) / 4
XS = FX - 0.08                 # the shop's glazing
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

def panel_image():
    """Pale grey wall panels, 2 m a repeat: a joint every 1.2 m across, grain and run-down dirt."""
    cv = Canvas(256, 256, "#c9cccb")
    cv.noise(0.05, 31)
    rng = np.random.default_rng(32)
    for _ in range(10):
        x, w, L = rng.uniform(0, 256), rng.uniform(3, 10), rng.uniform(40, 180)
        m = (np.abs(cv.x - x) < w) & (cv.y < L)
        cv.a[m] *= (0.93 + 0.07 * (cv.y[m] / L))[..., None]
    cv.put(np.mod(cv.x, 153.6) < 1.5, "#8f9392")
    return image("TF_Panel", np.flipud(cv.a).copy())


def corrugated_image():
    """Vertical corrugated cladding, 2 m a repeat: a raised rib every 20 cm, lit from the left."""
    cv = Canvas(256, 256, "#c3c8c8")
    u = np.mod(cv.x, 25.6) / 25.6
    shade = np.where(u < 0.12, 1.12, np.where(u < 0.3, 0.86, np.where(u < 0.38, 0.72, 1.0)))
    cv.a *= shade[..., None]
    cv.noise(0.04, 41)
    return image("TF_Corrugated", np.flipud(cv.a).copy())


def timber_image():
    """The weathered post: grey-brown wood, grain and checks down its length, 1 m a repeat."""
    cv = Canvas(128, 256, "#8f7d66")
    rng = np.random.default_rng(51)
    grain = 0.9 + 0.1 * np.sin(cv.x * 0.9 + 4 * np.sin(cv.y * 0.02 + cv.x * 0.05))
    cv.a *= grain[..., None]
    for _ in range(9):
        x, y0, L = rng.uniform(0, 128), rng.uniform(0, 256), rng.uniform(30, 160)
        cv.put((np.abs(cv.x - x) < 0.9) & (cv.y > y0) & (cv.y < y0 + L), "#4e4337")
    cv.noise(0.1, 52)
    return image("TF_Timber", np.flipud(cv.a).copy())


def concrete_image():
    """The apron: grey concrete, 4 m a repeat, a joint every 2 m and a few stains."""
    cv = Canvas(256, 256, "#a19e96")
    cv.noise(0.08, 71)
    rng = np.random.default_rng(72)
    for _ in range(6):
        cv.ellipse(rng.uniform(0, 256), rng.uniform(0, 256), rng.uniform(8, 30), rng.uniform(5, 20), cv.a.mean((0, 1)) * 0.9)
    cv.put((np.mod(cv.x, 128) < 1.5) | (np.mod(cv.y, 128) < 1.5), "#6f6c66")
    return image("TF_Concrete", np.flipud(cv.a).copy())


def wave_image():
    """The Great Wave, after a fashion: rows of deep blue curling crests with white claws on pale blue (one panel)."""
    cv = Canvas(256, 256, "#dfe8f2")
    rng = np.random.default_rng(61)
    for row in range(5):
        for col in range(4):
            cx = col * 72 + (row % 2) * 36 + rng.uniform(-8, 8)
            cy = 30 + row * 52 + rng.uniform(-6, 6)
            r = rng.uniform(26, 34)
            cv.ellipse(cx, cy, r, r * 0.85, "#2a5ba8")
            cv.ellipse(cx + r * 0.22, cy + r * 0.18, r * 0.62, r * 0.52, "#dfe8f2")
            cv.ellipse(cx + r * 0.3, cy + r * 0.26, r * 0.36, r * 0.3, "#5f8fcc")
            for k in range(6):                       # the claws of foam along the crest
                a = math.pi * (1.05 + 0.15 * k)
                cv.ellipse(cx + r * math.cos(a), cy + r * 0.85 * math.sin(a), 3.2, 3.2, "#f6f8fb")
    cv.poly([(150, 256), (178, 214), (206, 256)], "#f4f6f9")    # Fuji, small, far off
    cv.poly([(170, 230), (178, 214), (186, 230)], "#2a5ba8")
    return image("TF_Wave", np.flipud(cv.a).copy())


def mural_image():
    """The painted building's front, 7.1 x 4 m: green, navy with yellow rulers and set squares, blue, red."""
    W, H = 512, 288
    cv = Canvas(W, H, "#d82a5a")
    k = H / 4.0                                       # px per metre up the wall (row 0 is the top)
    band = lambda z0, z1, col: cv.rect(0, H - z1 * k, W, H - z0 * k, col)  # noqa: E731
    band(0.0, 0.5, "#5aa04a")
    band(0.5, 1.6, "#1d2140")
    band(1.6, 2.65, "#2c5fc4")
    band(3.55, 4.0, "#c9cccb")
    rng = np.random.default_rng(91)
    for _ in range(5):                                # a few squares of another red in the red
        x, y = rng.uniform(0, W - 60), H - rng.uniform(2.75, 3.4) * k
        cv.rect(x, y, x + rng.uniform(30, 70), y + rng.uniform(10, 20), "#c22050")
    yel = "#f2b51a"
    for x0 in (40, 300):                              # rulers: an outline with ticks
        y0, y1 = H - 1.5 * k, H - 0.62 * k
        cv.frame(x0, y0, x0 + 44, y1, 4, yel)
        for t in range(9):
            y = y0 + 6 + t * (y1 - y0 - 12) / 8
            cv.rect(x0, y, x0 + (22 if t % 2 else 14), y + 3, yel)
    for x0 in (150, 410):                             # set squares
        cv.poly([(x0, H - 0.62 * k), (x0 + 70, H - 0.62 * k), (x0, H - 1.5 * k)], yel)
        cv.poly([(x0 + 12, H - 0.62 * k - 10), (x0 + 42, H - 0.62 * k - 10), (x0 + 12, H - 1.5 * k + 34)], "#1d2140")
    cv.noise(0.04, 92)
    return image("TF_Mural", np.flipud(cv.a).copy())


# --- parts -----------------------------------------------------------------------------------------------

def window(g, x, ya, yb, za, zb, panes=2, frame="alu", glass="glass", t=0.05, out=1):
    """A frame of `panes` lights in the plane x (facing +x when out = 1)."""
    s = out * 0.012
    if glass:
        g.polyn([(x, ya, za), (x, yb, za), (x, yb, zb), (x, ya, zb)], glass, (out, 0, 0))
    for (a, b, c, d) in ((ya, yb, za, za + t), (ya, yb, zb - t, zb), (ya, ya + t, za, zb), (yb - t, yb, za, zb)):
        g.box(min(x, x + s * 3), max(x, x + s * 3), a, b, c, d, frame, skip=("-x" if out > 0 else "+x",))
    for k in range(1, panes):
        y = ya + (yb - ya) * k / panes
        g.box(min(x, x + s * 4), max(x, x + s * 4), y - t / 2, y + t / 2, za, zb, frame, skip=("-x" if out > 0 else "+x",))


def shell(g, x1, y0, y1, top, key, skip=()):
    """A block from BX to x1: its sides (but those in `skip`: "s", "n"), back, roof and parapet."""
    if "s" not in skip:
        g.polyn([(x1, y0, 0), (BX, y0, 0), (BX, y0, top), (x1, y0, top)], key, (0, -1, 0))
    if "n" not in skip:
        g.polyn([(x1, y1, 0), (BX, y1, 0), (BX, y1, top), (x1, y1, top)], key, (0, 1, 0))
    g.polyn([(BX, y0, 0), (BX, y1, 0), (BX, y1, top), (BX, y0, top)], key, (-1, 0, 0))
    wt, r = 0.2, top - 0.4
    for (xa, xb, a, b) in ((x1 - wt, x1 + 0.04, y0, y1), (BX - 0.04, BX + wt, y0, y1), (BX, x1, y0 - 0.02, y0 + wt), (BX, x1, y1 - wt, y1 + 0.02)):
        g.box(xa, xb, a, b, top, top + 0.06, "coping", skip=("-z",))
    g.polyn([(x1 - wt, y0 + wt, r), (BX + wt, y0 + wt, r), (BX + wt, y1 - wt, r), (x1 - wt, y1 - wt, r)], "roof", UP)
    for (pa, pb, nn) in (((x1 - wt, y0 + wt), (x1 - wt, y1 - wt), (-1, 0, 0)), ((BX + wt, y0 + wt), (BX + wt, y1 - wt), (1, 0, 0)),
                         ((BX + wt, y0 + wt), (x1 - wt, y0 + wt), (0, 1, 0)), ((BX + wt, y1 - wt), (x1 - wt, y1 - wt), (0, -1, 0))):
        g.polyn([(*pa, r), (*pb, r), (*pb, top), (*pa, top)], key, nn)


def quad(g, x, ya, yb, za, zb, key, uvs=None):
    """A rectangle in the plane x, facing +x."""
    g.polyn([(x, ya, za), (x, yb, za), (x, yb, zb), (x, ya, zb)], key, FRONT, uvs=uvs)


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    none = {"glow": "none"}
    lamp = lambda col, k: {"wet": "surface", "glow": "lamp", "glowColor": col, "glowStrength": k}  # noqa: E731
    M = dict(
        panel=material("TF_Panel", "#ffffff", 0.85, tex=panel_image(), props={"wet": "damp", **none}),
        corr=material("TF_Corrugated", "#ffffff", 0.45, metal=0.5, tex=corrugated_image(), props={"wet": "surface", **none}),
        band=material("TF_Band", "#3b3f42", 0.7, props={"wet": "damp", **none}),
        timber=material("TF_Timber", "#ffffff", 0.9, tex=timber_image(), props={"wet": "damp", **none}),
        mural=material("TF_Mural", "#ffffff", 0.7, tex=mural_image(), props={"wet": "damp", **none}),
        turf=material("TF_Turf", "#4f8f3c", 0.95, props={"wet": "ground", "layer": 10, **none}),
        concrete=material("TF_Concrete", "#ffffff", 0.9, tex=concrete_image(), props={"wet": "ground", "layer": 9, **none}),
        coping=material("TF_Coping", "#9a958b", 0.8, props={"wet": "damp", **none}),
        alu=material("TF_Alu", "#c7cbcb", 0.35, metal=0.75, props={"wet": "surface", **none}),
        wood=material("TF_Wood", "#8a6a48", 0.75, props={"wet": "damp", **none}),
        dark=material("TF_Dark", "#1e1f20", 0.8, props={"wet": "damp", **none}),
        paint=material("TF_White", "#ececea", 0.6, props={"wet": "surface", **none}),
        # the shop dark inside by day (ceiling lights), lit after dark; the wave cloth lit from behind
        shopglass=glowing("TF_ShopGlass", "#2c3134", 0.08, "#9a8f78", {"wet": "surface", "emit": "night", **none}),
        wave=glowing("TF_Wave", "#ffffff", 0.8, "#3a4a60", {"wet": "surface", "emit": "night", **none}, tex=wave_image()),
        light=material("TF_Light", "#f4f1e8", 0.4, props=lamp([1.0, 0.97, 0.9], 0.8)),
        # the sign: lit boxes (the white ones weathered to a grey by day)
        signw=material("TF_SignWhite", "#dcdbd5", 0.5, props=lamp([1.0, 0.98, 0.94], 0.45)),
        yellow=material("TF_SignYellow", "#f2b532", 0.5, props=lamp([1.0, 0.8, 0.25], 0.4)),
        ink=material("TF_Ink", "#151413", 0.5, props={"wet": "surface", **none}),
        red=material("TF_Red", "#c0262a", 0.6, props={"wet": "surface", **none}),
    )
    # a few keys share a material (one draw call each in the game)
    for a, b in (("roof", "concrete"), ("frost", "paint"), ("meter", "alu")):
        M[a] = M[b]
    TILE = dict(panel=2.0, corr=2.0, timber=1.0, concrete=4.0, coping=1.0, band=2.0)
    main = collection("藤原豆腐店")
    g = Geo()
    font = bpy.data.fonts.load(FONT)
    lt = collection("招牌字", main)
    nl = 0

    # ================= the grey building =================
    shell(g, FX, GY0, GY1, TOP, "corr", skip=("s",))
    g.polyn([(FX, GY0, MTOP), (BX, GY0, MTOP), (BX, GY0, TOP), (FX, GY0, TOP)], "corr", (0, -1, 0))   # over the painted one
    # left of the shop: panels, a white pilaster, the dark band, the pale strip, cladding above
    quad(g, FX, GY0, SY0, 0.0, 2.29, "panel")
    g.box(FX, FX + 0.05, -5.06, -4.82, 0.0, 2.29, "paint", skip=("-x",))
    quad(g, FX, GY0, SY0, 2.29, 2.84, "band")
    quad(g, FX, GY0, SY0, 2.84, 3.18, "panel")
    for z0, z1 in ((2.88, 3.12), (3.22, 3.4)):                                # two hinge plates on the pale strip
        g.box(FX, FX + 0.04, GY0 + 0.1, GY0 + 0.16, z0, z1, "alu")
    quad(g, FX, GY0, SY0, 3.18, TOP, "corr")
    # over the shop: cladding from the sign's foot up
    quad(g, FX, SY0, GY1, S0 - 0.07, TOP, "corr")
    # ---- the shop front, left to right ----
    g.box(XS, FX + 0.02, -3.2, -3.14, 0.0, S0 - 0.07, "wood")                 # a wooden strip
    quad(g, FX - 0.01, -3.14, -2.86, 0.0, S0 - 0.07, "panel")
    g.box(XS, FX + 0.02, -2.86, -2.81, 0.0, S0 - 0.07, "wood")
    # the door: a wide fixed frame on its left, the glass leaf, the poster
    quad(g, XS, -2.81, -2.56, 0.0, 2.07, "panel")
    D0, D1 = -2.56, -1.9
    window(g, XS, D0, D1, 0.02, 2.07, panes=1, glass="shopglass", t=0.05)
    g.box(XS, XS + 0.05, D1 - 0.1, D1 - 0.07, 0.95, 1.2, "alu")
    for y in (D0 + 0.18, D1 - 0.2):                                          # the ceiling lights inside
        quad(g, XS + 0.001, y - 0.035, y + 0.035, 1.97, 1.99, "light")
    px, pz, yc = XS + 0.004, 1.72, (D0 + D1) / 2
    quad(g, px, yc - 0.3, yc + 0.3, pz - 0.48, pz + 0.09, "dark")
    for r, row in enumerate(("おいしい", "豆腐は", "国産大豆")):
        z = pz - r * 0.19
        for i, ch in enumerate(row):
            y = yc + (i - (len(row) - 1) / 2) * 0.145
            quad(g, px + 0.002, y - 0.066, y + 0.066, z - 0.078, z + 0.078, "paint")
            nl += text(font, ch, 0.11, plane((px + 0.003, y, z), (0, 1, 0), UP), M["red" if r == 1 and i < 2 else "ink"], lt, f"Poster{r}{i}", extrude=0.002)
    g.box(XS, XS + 0.04, D1, -1.82, 0.0, 2.07, "alu")
    # the window: two upper lights with the name down each, two small ones, a panel
    W0, W1 = -1.76, -0.6
    quad(g, XS, -1.82, W0, 0.0, 2.07, "alu")
    quad(g, XS, W0, W1, 0.0, 1.0, "panel")
    window(g, XS, W0, W1, 1.0, 1.28, panes=2, glass="shopglass", frame="paint", t=0.05)
    window(g, XS, W0, W1, 1.28, 2.07, panes=2, glass="shopglass", frame="paint", t=0.06)
    for k in range(2):
        y = W0 + (W1 - W0) * (k + 0.5) / 2
        nl += column(font, "藤原豆腐店", 0.12, plane((XS + 0.001, y, 1.92), (0, 1, 0), UP), M["frost"], lt, f"Win{k}", gap=1.12, extrude=0.002)
    g.box(XS, XS + 0.04, W1, -0.55, 0.0, 2.07, "alu")
    # the glass door with the Great Wave hung behind it, a short wave noren, dark below
    V0, V1 = -0.55, 0.33
    quad(g, XS - 0.03, V0, V1, 1.17, 2.07, "wave", uvs=UV1)
    quad(g, XS - 0.03, V0, V1, 0.93, 1.06, "wave", uvs=[(0, 0.3), (1, 0.3), (1, 0.45), (0, 0.45)])
    quad(g, XS - 0.03, V0, V1, 0.02, 0.93, "shopglass")
    quad(g, XS - 0.03, V0, V1, 1.06, 1.17, "dark")
    for (y, nn) in ((V0, (0, 1, 0)), (V1, (0, -1, 0))):
        g.polyn([(XS, y, 0.0), (XS - 0.03, y, 0.0), (XS - 0.03, y, 2.07), (XS, y, 2.07)], "alu", nn)
    window(g, XS, V0, V1, 0.02, 2.07, panes=1, glass=None, frame="paint", t=0.06)
    g.box(XS, XS + 0.05, V0, V1, 1.08, 1.15, "paint")
    g.box(XS, XS + 0.04, V1, 0.47, 0.0, 2.07, "alu")
    # over the openings, under the sign
    g.box(XS, FX + 0.02, -2.81, 0.47, 2.07, S0 - 0.07, "panel")
    # the weathered post and its meter box
    g.box(FX - 0.12, FX + 0.12, 0.47, SY1, 0.0, S0 - 0.07, "timber")
    g.box(FX + 0.12, FX + 0.2, 0.62, 0.8, 1.38, 1.6, "meter")
    g.box(FX + 0.2, FX + 0.205, 0.65, 0.77, 1.42, 1.56, "dark")

    # ---- the sign: four barrel-topped panels between aluminium ribs ----
    prof = [(FX, S0), (FX + SD, S0), (FX + SD, S1)]
    for k in range(1, 9):
        a = math.pi / 2 * k / 8
        prof.append((FX + SD * math.cos(a), S1 + SR * math.sin(a)))
    segs = list(zip(prof, prof[1:]))
    for k in range(4):
        a, b = TY0 + PANEL * k, TY0 + PANEL * (k + 1)
        key = "yellow" if k == 0 else "signw"
        for (pa, pb) in segs:
            d = (pb[0] - pa[0], pb[1] - pa[1])
            g.polyn([(pa[0], a, pa[1]), (pa[0], b, pa[1]), (pb[0], b, pb[1]), (pb[0], a, pb[1])], key, (d[1], 0, -d[0]))
    for y, nn in ((TY0, (0, -1, 0)), (TY1, (0, 1, 0))):
        g.polyn([(x, y, z) for x, z in prof], "alu", nn)
    e, rw = 0.018, 0.022
    for k in range(5):
        y = TY0 + PANEL * k
        for (pa, pb) in segs[1:]:
            d = Vector((pb[0] - pa[0], pb[1] - pa[1]))
            n = Vector((d.y, -d.x)).normalized() * e
            qa, qb = (pa[0] + n.x, pa[1] + n.y), (pb[0] + n.x, pb[1] + n.y)
            g.polyn([(qa[0], y - rw, qa[1]), (qa[0], y + rw, qa[1]), (qb[0], y + rw, qb[1]), (qb[0], y - rw, qb[1])], "alu", (n.x, 0, n.y))
            for s in (-1, 1):
                g.polyn([(pa[0], y + s * rw, pa[1]), (qa[0], y + s * rw, qa[1]), (qb[0], y + s * rw, qb[1]), (pb[0], y + s * rw, pb[1])], "alu", (0, s, 0))
    # its foot: an aluminium edge, turned out past the right end (the photo's right)
    g.box(FX, FX + SD + 0.035, TY0 - 0.03, TY1 + 0.03, S0 - 0.07, S0, "alu")
    g.box(FX + SD, FX + SD + 0.04, TY0 - 0.03, TY1 + 0.03, S0 - 0.1, S0 - 0.07, "alu")
    g.box(FX, FX + SD + 0.035, TY1 + 0.03, TY1 + 0.2, S0 - 0.05, S0 - 0.02, "alu")
    # its lettering (measured off the photo: steps along the rows, heights of the two lines)
    sx = FX + SD
    nl += text(font, "とうふ", 0.24, plane((sx, TY0 + PANEL / 2, 3.0), (0, 1, 0), UP), M["ink"], lt, "Y1")
    nl += text(font, "油あげ", 0.24, plane((sx, TY0 + PANEL / 2, 2.71), (0, 1, 0), UP), M["ink"], lt, "Y2")
    nl += spaced(font, "手づく", 0.17, 0.27, (sx, TY0 + PANEL * 1.5, 3.04), M["ink"], lt, "T1")
    nl += spaced(font, "りの店", 0.17, 0.27, (sx, TY0 + PANEL * 2.5 - 0.04, 3.04), M["ink"], lt, "T2")
    nl += spaced(font, "藤原", 0.3, 0.43, (sx, TY0 + PANEL * 1.5, 2.7), M["ink"], lt, "B1")
    nl += spaced(font, "豆腐", 0.3, 0.43, (sx, TY0 + PANEL * 2.5 - 0.02, 2.7), M["ink"], lt, "B2")
    nl += spaced(font, "店", 0.3, 0.43, (sx, TY0 + PANEL * 3.5 - 0.22, 2.7), M["ink"], lt, "B3")

    # ================= the painted building, the grass before it =================
    shell(g, MX, MY0, MY1, MTOP, "mural", skip=("s", "n"))
    Lm = MY1 - MY0
    g.polyn([(MX, MY0, 0), (MX, MY1, 0), (MX, MY1, MTOP), (MX, MY0, MTOP)], "mural", FRONT, uvs=UV1)
    side = (MX - BX) / Lm
    g.polyn([(MX, MY0, 0), (BX, MY0, 0), (BX, MY0, MTOP), (MX, MY0, MTOP)], "mural", (0, -1, 0), uvs=[(side, 0), (0, 0), (0, 1), (side, 1)])
    g.polyn([(MX, MY1, 0), (FX, MY1, 0), (FX, MY1, MTOP), (MX, MY1, MTOP)], "mural", (0, 1, 0), uvs=[(0.97, 0), (1, 0), (1, 1), (0.97, 1)])
    g.polyn([(MX, MY0, 0.035), (MX + 0.9, MY0, 0.035), (MX + 0.9, MY1, 0.035), (MX, MY1, 0.035)], "turf", UP)

    # ================= the apron =================
    g.polyn([(FX, MY0 - 0.7, 0.025), (KERB - 0.1, MY0 - 0.7, 0.025), (KERB - 0.1, 8.0, 0.025), (FX, 8.0, 0.025)], "concrete", UP)
    g.build("Shop", collection("豆腐店", main), M, TILE)
    tris = g.tris()

    # ---- far level: the two blocks and the sign ----
    far = Geo()
    far.box(BX, FX, GY0, GY1, 0.0, TOP, "corr", skip=("-z",))
    far.box(BX, MX, MY0, MY1, 0.0, MTOP, "mural", skip=("-z",), uvs={"+x": UV1})
    far.box(FX, FX + SD, TY0, TY0 + PANEL, S0, S1 + SR * 0.6, "yellow", skip=("-x",))
    far.box(FX, FX + SD, TY0 + PANEL, TY1, S0, S1 + SR * 0.6, "signw", skip=("-x",))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # ---- colliders ----
    helpers = collection("碰撞体")
    collider_box(helpers, "building", BX, FX + 0.02, GY0, GY1, 0.0, TOP)
    collider_box(helpers, "post", FX, FX + 0.2, 0.47, SY1, 0.0, S0)
    collider_box(helpers, "painted", BX, MX, MY0, MY1, 0.0, MTOP)

    flat_marker(helpers, "tofushop_main", rect(BX - 0.1, MX + 0.1, MY0 - 0.1, GY1 + 0.15), "FOOTPRINT")
    flat_marker(helpers, "tofushop_clear", rect(-6.0, KERB - 0.1, MY0 - 0.8, 8.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "tofushop", "藤原豆腐店", "Fujiwara Tofu Shop"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 260
    s.repo_path = REPO
    return dict(tris=tris, letters=nl, far=far.tris())


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
