# 人民英雄纪念碑 Monument to the People's Heroes, in the middle of Tian'anmen Square, built in Blender and
# marked with the bcity_landmark add-on's conventions. It replaces the kit-built monument.ts.
#
#   blender -b -P scripts/blender/landmarks/monument.py -- [--out art/landmarks/monument.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north (Tiananmen: the face with 人民英雄永垂不朽), metres, origin on the ground
# at the old anchor (39.903197 N, 116.391425 E, heading -1.74, the centre of OSM's outline).
#
# The figures (37.94 m to the top): two terraces with white balustrades and steps on all four axes - the
# lower 海棠-shaped, 50.4 x 61.5 m (OSM's outline, 57.6 x 68.8, is the terrace with its steps); the large
# sumeru with the relief band in its waist (the ten reliefs of 1840-1949 - here crowds of figures in a
# normal map, no scene is reproduced), a smaller sumeru with the band of wreaths; the tapering granite
# shaft with a marble heart panel each side: 人民英雄永垂不朽 gilded on the north, the long inscription on the
# south in seven vertical columns; the cornice and a small hipped cap.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Geo, T, balustrade, collider_box, collider_pts, flat_marker, mesh_of, panel_geo, paving, post_geo, rect  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "monument.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

LOW = dict(hw=25.2, hd=30.75, z0=0.0, z1=1.35, notch=4.2)
UP = dict(hw=15.5, hd=18.5, z0=1.35, z1=2.8, notch=2.6)
STAIR_W = dict(n=12.0, s=12.0, e=8.0, w=8.0)
BIG = dict(hw=7.3, hd=5.2, h=4.1)          # the large sumeru, relief in its waist
SMALL = dict(hw=4.9, hd=3.5, h=2.6)        # the flowered sumeru
SHAFT = dict(hw0=2.45, hd0=1.75, hw1=2.2, hd1=1.55, top=35.0)
TOP = 37.94
NORTH = "人民英雄永垂不朽"
SOUTH = ("三年以来在人民解放战争和人民革命中牺牲的人民英雄们永垂不朽"
         "三十年以来在人民解放战争和人民革命中牺牲的人民英雄们永垂不朽"
         "由此上溯到一千八百四十年从那时起为了反对内外敌人争取民族独立和人民自由幸福在历次斗争中牺牲的人民英雄们永垂不朽")


def haitang(hw, hd, n):
    """The 海棠 plan: a rectangle with its corners notched square, counter-clockwise from the south-west."""
    return [(-hw + n, -hd), (hw - n, -hd), (hw - n, -hd + n), (hw, -hd + n), (hw, hd - n), (hw - n, hd - n), (hw - n, hd),
            (-hw + n, hd), (-hw + n, hd - n), (-hw, hd - n), (-hw, -hd + n), (-hw + n, -hd + n)]


def prism(g, poly, z0, z1, key, top=True):
    """Vertical walls round a counter-clockwise polygon, and its top."""
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % len(poly)]
        g.polyn([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], key, (by - ay, -(bx - ax), 0))
    if top:
        g.polyn([(x, y, z1) for x, y in poly], key, (0, 0, 1))


def moulded(g, hw, hd, prof, key, bands=None):
    """A rectangular sumeru from a profile [(inset, z), ...] bottom to top; `bands` names a key per step."""
    for k, ((i0, z0), (i1, z1)) in enumerate(zip(prof, prof[1:])):
        kk = (bands or {}).get(k, key)
        a0, b0 = (hw - i0, hd - i0), (hw - i1, hd - i1)
        c0 = [(-a0[0], -a0[1]), (a0[0], -a0[1]), (a0[0], a0[1]), (-a0[0], a0[1])]
        c1 = [(-b0[0], -b0[1]), (b0[0], -b0[1]), (b0[0], b0[1]), (-b0[0], b0[1])]
        for i in range(4):
            j = (i + 1) % 4
            p = [(*c0[i], z0), (*c0[j], z0), (*c1[j], z1), (*c1[i], z1)]
            out = ((c0[i][0] + c0[j][0]) / 2, (c0[i][1] + c0[j][1]) / 2, 0)
            L = math.hypot(c0[j][0] - c0[i][0], c0[j][1] - c0[i][1])
            if kk in ("relief", "wreath"):
                off = {0: 0.0, 1: 17.0, 2: 31.0, 3: 48.0}[i]            # each face a different stretch of the band
                uvs = [(off / 14.0, 0), ((off + L) / 14.0, 0), ((off + L) / 14.0, 1), (off / 14.0, 1)]
                g.polyn(p, kk, out, uvs=uvs)
            else:
                g.polyn(p, kk, out if abs(z1 - z0) > 1e-6 else (0, 0, 1 if i1 > i0 else -1))
    i, z = prof[-1]
    g.polyn([(-(hw - i), -(hd - i), z), (hw - i, -(hd - i), z), (hw - i, hd - i, z), (-(hw - i), hd - i, z)], key, (0, 0, 1))


def steps(g, side, width, z0, z1, edge, n=None, run=0.34):
    """A flight on one axis of a tier: from the tier's top down to z0, outward from `edge`."""
    n = n or max(3, round((z1 - z0) / 0.15))
    rise = (z1 - z0) / n
    for k in range(n):
        d0, d1 = edge + run * (n - k - 1), edge + run * (n - k)
        z = z0 + rise * (k + 1)
        if side in ("n", "s"):
            s = 1 if side == "n" else -1
            y0, y1 = sorted((s * d0, s * d1))
            g.box(-width / 2, width / 2, y0, y1, z0, z, "granite", skip=("-z",))
        else:
            s = 1 if side == "e" else -1
            x0, x1 = sorted((s * d0, s * d1))
            g.box(x0, x1, -width / 2, width / 2, z0, z, "granite", skip=("-z",))
    return run * n


# --- the relief and wreath bands: normal maps from height fields drawn with numpy -------------------------

def blur(h, r):
    k = np.exp(-0.5 * (np.arange(-2 * r, 2 * r + 1) / r) ** 2)
    k /= k.sum()
    h = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, h)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, h)


def normal_and_colour(h, name, base, strength=6.0):
    """Blender images (row 0 at the bottom) from a top-down height field in 0..1."""
    hb = np.flipud(h)
    dv, du = np.gradient(hb)
    n = np.stack([-du * strength, -dv * strength, np.ones_like(hb)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    col = srgb(base) * (0.72 + 0.34 * hb[..., None] - 0.18 * blur(hb, 3)[..., None] + 0.12 * hb[..., None] ** 2)
    return image(name + "_N", n * 0.5 + 0.5), image(name + "_C", col)


def relief_images(w=2048, h=256):
    """Crowds in low relief: figures standing, striding and bending, flags and rifles over them, framed."""
    rng = np.random.default_rng(1949)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    H = np.zeros((h, w), np.float32)

    def dome(cx, cy, rx, ry, hgt):
        m = 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2
        np.maximum(H, hgt * np.sqrt(np.clip(m, 0, 1)), out=H)

    def rod(x0, y0, x1, y1, r, hgt):
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
        np.maximum(H, hgt * np.sqrt(np.clip(1 - (d / r) ** 2, 0, 1)), out=H)

    for layer, (n, scale, hgt) in enumerate(((70, 0.8, 0.45), (60, 1.0, 0.75), (46, 1.12, 1.0))):
        for _ in range(n):
            cx = rng.uniform(0, w)
            s = scale * rng.uniform(0.9, 1.1)
            foot = h * (0.9 - 0.04 * (2 - layer))
            lean = rng.uniform(-0.35, 0.35)
            top = foot - 190 * s
            dome(cx + lean * 30, (foot + top) / 2 + 20 * s, 17 * s, 62 * s, hgt)          # body
            dome(cx + lean * 60, top + 18 * s, 12 * s, 14 * s, hgt)                       # head
            rod(cx - 8 * s, foot - 60 * s, cx - 12 * s + lean * 20, foot, 6 * s, hgt * 0.9)   # legs
            rod(cx + 8 * s, foot - 60 * s, cx + 14 * s + lean * 30, foot, 6 * s, hgt * 0.9)
            if rng.random() < 0.5:                                                          # an arm raised
                rod(cx + lean * 40, top + 50 * s, cx + lean * 40 + 30 * s, top - 10 * s, 5 * s, hgt)
            if rng.random() < 0.12:                                                         # a flag
                rod(cx, foot - 20, cx + 20, top - 60, 3, hgt * 0.8)
                fx, fy = cx + 20, top - 60
                m = (x > fx) & (x < fx + 90) & (y > fy) & (y < fy + 45 + 8 * np.sin((x - fx) / 12))
                H[m] = np.maximum(H[m], hgt * 0.55)
            elif rng.random() < 0.15:                                                       # a rifle
                rod(cx - 10, top + 90 * s, cx + 30, top - 30 * s, 2.5, hgt)
    H = blur(H, 2)
    H[:10, :] = H[-10:, :] = 1.0                                                            # the frame
    return normal_and_colour(np.clip(H, 0, 1), "MON_Relief", "#dcd6c8")


def wreath_images(w=1024, h=128):
    """The small sumeru's waist: a garland of peony, lotus and chrysanthemum rosettes between ribbons."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    H = np.zeros((h, w), np.float32)
    for i in range(16):
        cx, cy = (i + 0.5) * w / 16, h / 2
        r = np.hypot(x - cx, y - cy)
        a = np.arctan2(y - cy, x - cx)
        petals = 0.5 + 0.5 * np.cos(a * (5 + 3 * (i % 3)))
        np.maximum(H, np.clip(1 - r / (40 + 8 * petals), 0, 1) ** 0.6 * (0.6 + 0.4 * petals), out=H)
    band = 0.35 * (np.abs(y - h / 2 - 22 * np.sin(x / w * 2 * np.pi * 8)) < 7)
    np.maximum(H, band.astype(np.float32), out=H)
    H[:8, :] = H[-8:, :] = 0.9
    return normal_and_colour(blur(H, 1.5), "MON_Wreath", "#d8d2c3", strength=4.0)


# --- lettering ------------------------------------------------------------------------------------------

def column_text(font, chars, height, width, m, name, coll, mat, space=0.85):
    """One vertical column of characters, `height` m tall overall, placed by m (text plane = XY, +Z out)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = "\n".join(chars), font, 1.0, 0.0
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_line = space
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min(height / (max(ys) - min(ys)), width / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, 0.0))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def shaft_y(z, north):
    """The shaft's north (+) or south (-) face at height z, following the taper."""
    S = SHAFT
    t = (z - S["z0"]) / (S["top"] - S["z0"])
    d = S["hd0"] + (S["hd1"] - S["hd0"]) * t
    return d if north else -d


def face_matrix(x, z, off, north):
    """Text plane upright on the shaft's north or south face at (x, z), leaning with its taper."""
    S = SHAFT
    lean = math.atan2(S["hd0"] - S["hd1"], S["top"] - S["z0"])
    y = shaft_y(z, north) + (off if north else -off)
    # Rx(90 - lean) stands the text up (its +Y up the face) with its front (+Z) out and tilted up with the
    # taper; on the north face Rz(180) turns it round so it reads left to right from there too
    stand = Matrix.Rotation(math.pi / 2 - lean, 4, "X")
    return T(x, y, z) @ (Matrix.Rotation(math.pi, 4, "Z") @ stand if north else stand)


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    rn, rc = relief_images()
    wn, wc = wreath_images()
    M = dict(
        granite=material("MON_Granite", "#cfc8bb", 0.65, props={"wet": "damp", "glowStrength": 0.8}),
        marble=material("MON_Marble", "#ebe7de", 0.4, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("MON_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        relief=material("MON_Relief", "#dcd6c8", 0.6, tex=rc, normal_tex=rn, props={"wet": "damp", "glowStrength": 0.9}),
        wreath=material("MON_Wreath", "#d8d2c3", 0.6, tex=wc, normal_tex=wn, props={"wet": "damp", "glowStrength": 0.9}),
        gold=material("MON_Gold", "#e3b447", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.78, 0.4], "glowStrength": 0.6}),
    )
    TILE = dict(granite=2.0, marble=2.0, paving=4.0, gold=1.0)
    main = collection("纪念碑")
    g = Geo()
    # the two terraces
    for T_ in (LOW, UP):
        poly = haitang(T_["hw"], T_["hd"], T_["notch"])
        prism(g, poly, T_["z0"], T_["z1"] - 0.25, "granite", top=False)
        prism(g, [(x * (1 + 0.1 / T_["hw"]), y * (1 + 0.1 / T_["hd"])) for x, y in poly], T_["z1"] - 0.25, T_["z1"], "marble", top=False)
        g.polyn([(x, y, T_["z1"]) for x, y in haitang(T_["hw"] + 0.1, T_["hd"] + 0.1, T_["notch"])], "paving", (0, 0, 1))
        for side, w in STAIR_W.items():
            steps(g, side, w, T_["z0"], T_["z1"], T_["hd"] if side in ("n", "s") else T_["hw"])
    # the large sumeru: plinth, mouldings, the relief waist, mouldings, top
    z = UP["z1"]
    B = BIG
    prof = [(0.0, 0), (0.0, 0.35), (0.25, 0.55), (0.45, 0.75), (0.5, 1.0), (0.55, 1.1), (0.55, 3.0), (0.45, 3.2), (0.25, 3.45), (0.0, 3.75), (0.0, 4.1)]
    moulded(g, B["hw"], B["hd"], [(i, z + dz) for i, dz in prof], "granite", bands={5: "relief"})
    z += B["h"]
    S = SMALL
    prof = [(0.0, 0), (0.0, 0.25), (0.2, 0.45), (0.35, 0.6), (0.35, 1.9), (0.2, 2.1), (0.0, 2.35), (0.0, 2.6)]
    moulded(g, S["hw"], S["hd"], [(i, z + dz) for i, dz in prof], "granite", bands={3: "wreath"})
    z += S["h"]
    SHAFT["z0"] = z
    # the shaft, tapering, and its heart panels
    Q = SHAFT
    c0 = [(-Q["hw0"], -Q["hd0"]), (Q["hw0"], -Q["hd0"]), (Q["hw0"], Q["hd0"]), (-Q["hw0"], Q["hd0"])]
    c1 = [(-Q["hw1"], -Q["hd1"]), (Q["hw1"], -Q["hd1"]), (Q["hw1"], Q["hd1"]), (-Q["hw1"], Q["hd1"])]
    for i in range(4):
        j = (i + 1) % 4
        g.polyn([(*c0[i], z), (*c0[j], z), (*c1[j], SHAFT["top"]), (*c1[i], SHAFT["top"])], "granite", ((c0[i][0] + c0[j][0]) / 2, (c0[i][1] + c0[j][1]) / 2, 0))
    for north, (x0, x1, za, zb) in ((True, (-1.55, 1.55, 15.2, 33.4)), (False, (-2.0, 2.0, 16.8, 32.2))):
        f = 1 if north else -1
        g.polyn([(x0, shaft_y(za, north) + f * 0.01, za), (x1, shaft_y(za, north) + f * 0.01, za), (x1, shaft_y(zb, north) + f * 0.01, zb), (x0, shaft_y(zb, north) + f * 0.01, zb)], "marble", (0, f, 0))
    # the cornice and the small hipped cap
    zt = SHAFT["top"]
    g.box(-2.6, 2.6, -1.95, 1.95, zt, zt + 0.4, "granite")
    g.box(-2.9, 2.9, -2.25, 2.25, zt + 0.4, zt + 0.62, "granite")
    e = [(-2.95, -2.3), (2.95, -2.3), (2.95, 2.3), (-2.95, 2.3)]
    r = [(-1.2, 0.0), (1.2, 0.0)]
    ze, zr = zt + 0.62, TOP - 0.25
    g.polyn([(*e[0], ze), (*e[1], ze), (r[1][0], 0, zr), (r[0][0], 0, zr)], "granite", (0, -1, 1))
    g.polyn([(*e[2], ze), (*e[3], ze), (r[0][0], 0, zr), (r[1][0], 0, zr)], "granite", (0, 1, 1))
    g.polyn([(*e[1], ze), (*e[2], ze), (r[1][0], 0, zr)], "granite", (1, 0, 1))
    g.polyn([(*e[3], ze), (*e[0], ze), (r[0][0], 0, zr)], "granite", (-1, 0, 1))
    g.box(-1.35, 1.35, -0.18, 0.18, zr - 0.1, TOP, "granite")
    g.build("Monument", collection("碑", main), M, TILE)
    tris = g.tris()

    # balustrades on both terraces, open at the stairs
    parts = collection("栏杆", main)
    mesh = dict(post=mesh_of(post_geo(), "PostMesh", M, TILE), panel=mesh_of(panel_geo(), "PanelMesh", M, TILE))
    for k, T_ in enumerate((LOW, UP)):
        ring = haitang(T_["hw"] - 0.3, T_["hd"] - 0.3, T_["notch"])
        pts = [(x, y, T_["z1"]) for x, y in ring] + [(ring[0][0], ring[0][1], T_["z1"])]
        skip = [(-STAIR_W["n"] / 2 - 0.3, STAIR_W["n"] / 2 + 0.3, T_["hd"] - 1.5, T_["hd"] + 1), (-STAIR_W["s"] / 2 - 0.3, STAIR_W["s"] / 2 + 0.3, -T_["hd"] - 1, -T_["hd"] + 1.5),
                (T_["hw"] - 1.5, T_["hw"] + 1, -STAIR_W["e"] / 2 - 0.3, STAIR_W["e"] / 2 + 0.3), (-T_["hw"] - 1, -T_["hw"] + 1.5, -STAIR_W["w"] / 2 - 0.3, STAIR_W["w"] / 2 + 0.3)]
        balustrade(parts, mesh, pts, f"Rail{k}", gap=1.9, skip=skip)

    # the inscriptions
    font = bpy.data.fonts.load(FONT)
    letters = collection("碑文", main)
    ntri = column_text(font, NORTH, 17.4, 2.8, face_matrix(0.0, 24.3, 0.03, True), "North", letters, M["gold"], space=0.52)
    cols = 7
    per = math.ceil(len(SOUTH) / cols)
    for c in range(cols):
        chars = SOUTH[c * per:(c + 1) * per]
        x = 1.5 - 3.0 * c / (cols - 1)           # right to left, as seen from the south (+X is east, on the viewer's right)
        zc = 31.4 - 13.8 / 2 * len(chars) / per
        ntri += column_text(font, chars, 13.8 * len(chars) / per, 0.42, face_matrix(x, zc, 0.03, False), f"South{c}", letters, M["gold"])

    # the far level
    far = Geo()
    for T_ in (LOW, UP):
        prism(far, haitang(T_["hw"], T_["hd"], T_["notch"]), T_["z0"], T_["z1"], "granite")
    far.box(-BIG["hw"], BIG["hw"], -BIG["hd"], BIG["hd"], UP["z1"], UP["z1"] + BIG["h"], "granite", skip=("-z",))
    far.box(-SMALL["hw"], SMALL["hw"], -SMALL["hd"], SMALL["hd"], UP["z1"] + BIG["h"], SHAFT["z0"], "granite", skip=("-z",))
    for i in range(4):
        j = (i + 1) % 4
        far.polyn([(*c0[i], SHAFT["z0"]), (*c0[j], SHAFT["z0"]), (*c1[j], TOP), (*c1[i], TOP)], "granite", ((c0[i][0] + c0[j][0]) / 2, (c0[i][1] + c0[j][1]) / 2, 0))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: each tier as a cross of two boxes (the 海棠 notches stay open), the stairs as ramps for
    # people, the sumerus and the shaft
    helpers = collection("碰撞体")
    for k, T_ in enumerate((LOW, UP)):
        hw, hd, n = T_["hw"], T_["hd"], T_["notch"]
        collider_box(helpers, f"tier{k}a", -hw, hw, -hd + n, hd - n, 0.0, T_["z1"])
        collider_box(helpers, f"tier{k}b", -hw + n, hw - n, -hd, hd, 0.0, T_["z1"])
        for side, w in STAIR_W.items():
            run = 0.34 * max(3, round((T_["z1"] - T_["z0"]) / 0.15))
            edge = hd if side in ("n", "s") else hw
            s = 1 if side in ("n", "e") else -1
            a, b = s * edge, s * (edge + run)
            if side in ("n", "s"):
                pts = [(x, a, T_["z1"]) for x in (-w / 2, w / 2)] + [(x, b, T_["z0"]) for x in (-w / 2, w / 2)] + [(x, a, T_["z0"]) for x in (-w / 2, w / 2)]
            else:
                pts = [(a, y, T_["z1"]) for y in (-w / 2, w / 2)] + [(b, y, T_["z0"]) for y in (-w / 2, w / 2)] + [(a, y, T_["z0"]) for y in (-w / 2, w / 2)]
            collider_pts(helpers, f"steps{k}{side}", pts, role="WALK")
    collider_box(helpers, "big", -BIG["hw"], BIG["hw"], -BIG["hd"], BIG["hd"], 0.0, UP["z1"] + BIG["h"])
    collider_box(helpers, "small", -SMALL["hw"], SMALL["hw"], -SMALL["hd"], SMALL["hd"], 0.0, SHAFT["z0"])
    collider_box(helpers, "shaft", -SHAFT["hw0"], SHAFT["hw0"], -SHAFT["hd0"], SHAFT["hd0"], 0.0, TOP)
    ext = 0.34 * max(3, round(1.35 / 0.15))
    flat_marker(helpers, "monument", rect(-LOW["hw"] - ext - 0.5, LOW["hw"] + ext + 0.5, -LOW["hd"] - ext - 0.5, LOW["hd"] + ext + 0.5), "FOOTPRINT")
    flat_marker(helpers, "monument", rect(-LOW["hw"] - ext - 2.5, LOW["hw"] + ext + 2.5, -LOW["hd"] - ext - 2.5, LOW["hd"] + ext + 2.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "monument", "人民英雄纪念碑", "Monument to the People's Heroes"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.903197", "116.391425", -1.74
    s.repo_path = REPO
    return dict(tris=tris, letters=ntri)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
