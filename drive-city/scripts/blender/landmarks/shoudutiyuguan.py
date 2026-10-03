# 首都体育馆 Capital Indoor Stadium (1968; renewed for the 2022 Winter Olympics, "修旧如旧"), on 中关村南大街 by
# 白石桥, built in Blender and marked with the bcity_landmark add-on's conventions (sidebar N > B城 > 导出到游戏).
#
#   blender -b -P scripts/blender/landmarks/shoudutiyuguan.py -- [--out art/landmarks/shoudutiyuguan.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM way 77083638 (a 126 x 114 m
# quadrilateral, the arena with its entrance porches), game (-6525.0, -3341.1), heading 6.6 (its edges run 6.6 deg
# off the grid, the east end further south).
#
# Published figures: 122.2 m east-west, 107 m north-south, 28 m high, 40,000 m2. The look kept through the 2020
# renovation: cream walls, dark glass, the facade "full of vertical lines" - here solid stone corner piers 7 m
# wide framing on each face a field of slender cream fins every 1.8 m in front of dark glass, a stone fascia
# 3.9 m deep round the top, a ground storey of doors and windows under a string course. The spectators' main
# entrance on the south (a terrace and its flight of steps, kept from 1968, under a broad canopy, 首都体育馆 on
# the fascia over it), the VIP entrance on the north (smaller), a flat roof with the space frame's low raised
# centre behind the fascia. The plaza round it is paved out to the service road.
# Doubtful: the fins' spacing and depth, the corner piers, the canopies' form, the lettering's colour (red here)
# and place; the 2022 additions (training halls, the new glass entrance) are not modelled - OSM has none of them.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import SIDES, Canvas, Geo, collider_box, cyl, flat_marker, fwall, paving, rect, side_line  # noqa: E402
from national_museum import facing, lettering  # noqa: E402
from zhengyangmen import steps_ramp  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "shoudutiyuguan.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

HX, HY = 61.1, 53.5           # half sizes of the wall line
PL = 0.9                      # granite base course
Z_STR, Z_FIELD, Z_BAND, H = 6.0, 6.5, 24.5, 28.4
PROUD = 0.8                   # corner piers and fascia stand this far in front of the wall line
CP = 7.0                      # corner pier width on each face
FIN_GAP, FIN_W, FIN_D = 1.8, 0.42, 0.7
BAY_BASE = 3.6
ENT_S = dict(x=34.0, depth=6.0, z=1.2, n=8, run=0.45, canopy=(36.0, 7.0, 6.6, 7.6))   # half width, terrace depth, height
ENT_N = dict(x=16.0, depth=4.5, z=1.2, n=8, run=0.45, canopy=(18.0, 5.5, 6.6, 7.4))
PLAZA = (-76.0, 76.0, -78.0, 84.0)

CREAM = "#e2d7bd"


# --- textures ------------------------------------------------------------------------------------------

def field_images(w=64, h=512):
    """One fin bay (1.8 m) of the field, 18 m tall: dark glass, slim cream spandrels at the floors, a mullion."""
    cv, glow = Canvas(w, h, "#2a3239"), Canvas(w, h, "#000000")
    z = (h - cv.y) / h * (Z_BAND - Z_FIELD)
    x = cv.x / w
    cv.a += (0.06 * (z / (Z_BAND - Z_FIELD)))[..., None] * srgb("#8fa3b5")      # sky reflected higher up
    span = np.zeros(cv.a.shape[:2], bool)
    for zs in (0.0, 4.6, 9.2, 13.8):
        span |= (z > zs) & (z < zs + 0.55)
    cv.put(span, "#cfc3a6")
    cv.put((np.abs(x - 0.5) < 0.025) & ~span, "#56606a")
    cv.put(z > (Z_BAND - Z_FIELD) - 0.3, "#b9ad92")
    rng = np.random.default_rng(3)
    lit = ~span & (np.abs(x - 0.5) > 0.03)
    glow.a[lit] = srgb("#ffd9a0") * (0.12 + 0.2 * rng.random())
    return image("SD_Field", np.flipud(cv.a).copy()), image("SD_FieldNight", np.flipud(glow.a).copy())


def base_images(w=128, h=192):
    """One 3.6 m bay of the ground storey (0.9 to 6.0 m): cream stone in courses round a glazed opening."""
    cv, glow = Canvas(w, h, CREAM), Canvas(w, h, "#000000")
    cv.noise(0.05, 4)
    z = (h - cv.y) / h * (Z_STR - PL)
    x = cv.x / w * BAY_BASE
    cv.a[np.mod(z, 0.6) < 0.03] *= 0.88
    op = (np.abs(x - BAY_BASE / 2) < 1.25) & (z > 0.25) & (z < 3.9)
    fr = (np.abs(x - BAY_BASE / 2) < 1.38) & (z > 0.15) & (z < 4.0) & ~op
    cv.put(fr, "#8a8a84")
    cv.put(op, "#27303a")
    cv.put(op & ((np.abs(x - BAY_BASE / 2) < 0.03) | (np.abs(z - 2.7) < 0.03)), "#8a8a84")
    glow.a[op] = srgb("#ffcf8c") * 0.55
    return image("SD_Base", np.flipud(cv.a).copy()), image("SD_BaseNight", np.flipud(glow.a).copy())


def stone_image(size=256):
    """Cream stone cladding, 4 m a repeat: big slabs with fine joints."""
    cv = Canvas(size, size, CREAM)
    cv.noise(0.05, 7)
    q = size / 4
    rows = (cv.y // (q * 0.75)).astype(int)
    joint = (np.mod(cv.y, q * 0.75) < 1.2) | (np.mod(cv.x + (rows % 2) * q / 2, q) < 1.2)
    cv.put(joint, "#c3b89f")
    return image("SD_Stone", np.flipud(cv.a).copy())


def far_image(w=32, h=256):
    """The whole wall in one picture for the far level (u: one fin bay, v: 0 to 28.4 m)."""
    cv = Canvas(w, h, CREAM)
    z = (h - cv.y) / h * H
    x = cv.x / w
    cv.put((z > Z_FIELD) & (z < Z_BAND) & (np.abs(x - 0.5) < 0.32), "#36404a")
    cv.put((z > 1.2) & (z < 4.9) & (np.abs(x - 0.5) < 0.3), "#2d353d")
    cv.put(z < PL, "#9c968b")
    return image("SD_Far", np.flipud(cv.a).copy())


# --- the building --------------------------------------------------------------------------------------

def face_span(side):
    """(a, b) of a side's wall line counter-clockwise, its length, and its outward normal."""
    a, b = side_line(-HX, HX, -HY, HY, side)
    return a, b, (b - a).length, SIDES[side]


def build_walls(g, fins):
    for side in ("s", "e", "n", "w"):
        a, b, L, out = face_span(side)
        d = (b - a) / L
        # the granite base course and the stone string course all round
        pa, pb = side_line(-HX, HX, -HY, HY, side, 0.2)
        fwall(g, pa, pb, 0.0, PL, "granite", out)
        g.polyn([(pa.x, pa.y, PL), (pb.x, pb.y, PL), (b.x, b.y, PL), (a.x, a.y, PL)], "granite", (0, 0, 1))
        # ground storey between the corner piers, the field above
        fa, fb = a + d * CP, b - d * CP
        fwall(g, fa, fb, PL, Z_STR, "base", out, bay=BAY_BASE, storey=Z_STR - PL, zref=PL)
        fwall(g, fa, fb, Z_FIELD, Z_BAND, "field", out, bay=FIN_GAP, storey=Z_BAND - Z_FIELD, zref=Z_FIELD)
        # the string course: a stone band 0.5 m tall standing 0.3 m proud
        ox, oy = out
        p = lambda v, off: (v.x + ox * off, v.y + oy * off)      # noqa: E731
        q = [p(fa, 0.0), p(fb, 0.0), p(fb, 0.3), p(fa, 0.3)]
        g.polyn([(q[0][0], q[0][1], Z_STR), (q[1][0], q[1][1], Z_STR), (q[2][0], q[2][1], Z_STR), (q[3][0], q[3][1], Z_STR)], "stone", (0, 0, -1))
        g.polyn([(q[3][0], q[3][1], Z_STR), (q[2][0], q[2][1], Z_STR), (q[2][0], q[2][1], Z_FIELD), (q[3][0], q[3][1], Z_FIELD)], "stone", (ox, oy, 0))
        g.polyn([(q[0][0], q[0][1], Z_FIELD), (q[1][0], q[1][1], Z_FIELD), (q[2][0], q[2][1], Z_FIELD), (q[3][0], q[3][1], Z_FIELD)], "stone", (0, 0, 1))
        # the fins: one at each bay line of the field
        n = max(1, round((L - 2 * CP) / FIN_GAP))
        for k in range(1, n):
            c = fa.lerp(fb, k / n)
            fins.append((c.x, c.y, out))
    # corner piers: a box at each corner, CP along each face, standing PROUD out
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * (HX + PROUD), sx * (HX - CP)))
            y0, y1 = sorted((sy * (HY + PROUD), sy * (HY - CP)))
            g.box(x0, x1, y0, y1, PL, Z_BAND, "stone", skip=("-z", "+z"))
    # the fascia round the top: a ring of four boxes PROUD out and 1.6 m deep, the flat roof inside it
    X, Y, t = HX + PROUD, HY + PROUD, 1.6
    for (x0, x1, y0, y1) in ((-X, X, -Y, -Y + t), (-X, X, Y - t, Y), (-X, -X + t, -Y + t, Y - t), (X - t, X, -Y + t, Y - t)):
        g.box(x0, x1, y0, y1, Z_BAND, H, "stone")
    g.box(-X - 0.25, X + 0.25, -Y - 0.25, -Y + 0.4, H, H + 0.3, "stone", skip=("-z",))
    g.box(-X - 0.25, X + 0.25, Y - 0.4, Y + 0.25, H, H + 0.3, "stone", skip=("-z",))
    g.box(-X - 0.25, -X + 0.4, -Y + 0.4, Y - 0.4, H, H + 0.3, "stone", skip=("-z",))
    g.box(X - 0.4, X + 0.25, -Y + 0.4, Y - 0.4, H, H + 0.3, "stone", skip=("-z",))
    zr = H - 0.9
    g.polyn([(-X + t, -Y + t, zr), (X - t, -Y + t, zr), (X - t, Y - t, zr), (-X + t, Y - t, zr)], "roof", (0, 0, 1))
    # the space frame's low raised centre: a hipped metal roof, flat on top, a ridge of roof lights
    a0, b0, a1, b1, z1 = 54.0, 46.0, 44.0, 36.0, zr + 2.2
    lo = [(-a0, -b0), (a0, -b0), (a0, b0), (-a0, b0)]
    hi = [(-a1, -b1), (a1, -b1), (a1, b1), (-a1, b1)]
    for i in range(4):
        j = (i + 1) % 4
        mx, my = (lo[i][0] + lo[j][0]) / 2, (lo[i][1] + lo[j][1]) / 2
        g.polyn([(*lo[i], zr), (*lo[j], zr), (*hi[j], z1), (*hi[i], z1)], "metal", (mx, my, 25))
    g.polyn([(*p, z1) for p in hi], "metal", (0, 0, 1))
    for k in range(-3, 4):
        g.box(k * 11.0 - 3.0, k * 11.0 + 3.0, -30.0, 30.0, z1, z1 + 0.7, "glass", skip=("-z",))
    # plant on the roof
    for (cx, cy) in ((-50.0, 44.0), (-50.0, -44.0), (50.0, 44.0), (50.0, -44.0)):
        g.box(cx - 2.5, cx + 2.5, cy - 1.6, cy + 1.6, zr, zr + 1.8, "metal", skip=("-z",))


def fin_geo(g, fins):
    for x, y, out in fins:
        ox, oy = out
        tx, ty = -oy, ox
        c0 = (x - tx * FIN_W / 2, y - ty * FIN_W / 2)
        c1 = (x + tx * FIN_W / 2, y + ty * FIN_W / 2)
        pts = [c0, c1, (c1[0] + ox * FIN_D, c1[1] + oy * FIN_D), (c0[0] + ox * FIN_D, c0[1] + oy * FIN_D)]
        # three sides (the back is against the glass) and the bottom
        for (a, b) in ((pts[1], pts[2]), (pts[2], pts[3]), (pts[3], pts[0])):
            mx, my = (a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y
            g.polyn([(*a, Z_FIELD), (*b, Z_FIELD), (*b, Z_BAND), (*a, Z_BAND)], "stone", (mx, my, 0))
        g.polyn([(*p, Z_FIELD) for p in pts], "stone", (0, 0, -1))


def entrance(g, E, sgn, cols):
    """A terrace across the middle of the south (sgn -1) or north (+1) face, its flight, the canopy on posts."""
    y_wall = sgn * HY
    y_ter = sgn * (HY + E["depth"])
    rise = E["z"] / E["n"]
    ya, yb = sorted((y_wall, y_ter))
    g.box(-E["x"], E["x"], ya, yb, 0.0, E["z"], "granite", skip=("-z", "+z"))
    g.polyn([(-E["x"], ya, E["z"]), (E["x"], ya, E["z"]), (E["x"], yb, E["z"]), (-E["x"], yb, E["z"])], "paving", (0, 0, 1))
    for k in range(E["n"]):
        y0 = y_ter + sgn * (E["n"] - 1 - k) * E["run"]
        y1 = y0 + sgn * E["run"]
        a, b = sorted((y0, y1))
        g.box(-E["x"] + 2.0, E["x"] - 2.0, a, b, 0.0, (k + 1) * rise, "granite", skip=("-z",))
    hw, dep, z0, z1 = E["canopy"]
    c0, c1 = sorted((y_wall, sgn * (HY + dep)))
    g.box(-hw, hw, c0, c1, z0, z1, "stone")
    n = 7 if E is ENT_S else 4
    yc = sgn * (HY + dep - 0.8)
    for i in range(n + 1):
        x = -hw + 1.2 + (2 * hw - 2.4) * i / n
        cyl(g, x, yc, E["z"], z0, 0.28, 0.28, 10, "metal", caps=(False, False))
        cols.append((x, yc, E["z"], z0))


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    field, field_n = field_images()
    base, base_n = base_images()
    M = dict(
        field=material("SD_Field", "#2a3239", 0.25, tex=field, emit_tex=field_n, props={"wet": "surface", "emit": "night", "glowStrength": 0.2}),
        base=material("SD_Base", CREAM, 0.8, tex=base, emit_tex=base_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.35}),
        stone=material("SD_Stone", CREAM, 0.75, tex=stone_image(), props={"wet": "damp", "glowStrength": 0.2}),
        granite=material("SD_Granite", "#8f8a82", 0.75, props={"wet": "ground", "glowStrength": 0.3}),
        paving=material("SD_Paving", "#a7a196", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.4, "layer": 10}),
        roof=material("SD_Roof", "#77766f", 0.85, props={"wet": "ground", "glow": "none"}),
        metal=material("SD_Metal", "#9aa0a3", 0.45, metal=0.7, props={"wet": "surface", "glow": "none"}),
        glass=material("SD_RoofLight", "#46545e", 0.15, metal=0.6, props={"wet": "surface", "glow": "none"}),
        gold=material("SD_Letters", "#b81f17", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.2, 0.12], "glowStrength": 0.9}),
        far=material("SD_Far", CREAM, 0.8, tex=far_image(), props={"wet": "damp", "glowStrength": 0.3}),
    )
    TILE = dict(stone=4.0, granite=2.0, paving=4.0, roof=8.0, metal=4.0, glass=4.0)
    main = collection("首都体育馆")
    g, fins, cols = Geo(), [], []
    build_walls(g, fins)
    fin_geo(g, fins)
    entrance(g, ENT_S, -1, cols)
    entrance(g, ENT_N, 1, cols)
    # the plaza, paved out to the service road round it
    x0, x1, y0, y1 = PLAZA
    g.polyn([(x0, y0, 0.03), (x1, y0, 0.03), (x1, y1, 0.03), (x0, y1, 0.03)], "paving", (0, 0, 1))
    body = collection("主体", main)
    g.build("Stadium", body, M, TILE)
    tris = g.tris()

    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    zt = (Z_BAND + H) / 2
    lettering(font, "首都体育馆", 2.4, 19.0, "Name", M, letters, facing(0.0, -HY - PROUD - 0.06, zt, (0, -1)))

    # the far level: the box in one picture, the fascia, the roof
    far = Geo()
    for side in ("s", "e", "n", "w"):
        a, b, L, out = face_span(side)
        pa, pb = side_line(-HX, HX, -HY, HY, side, PROUD * 0.5)
        fwall(far, pa, pb, 0.0, H, "far", out, bay=FIN_GAP * 2, storey=H, zref=0.0)
    X, Y = HX + PROUD * 0.5, HY + PROUD * 0.5
    far.polyn([(-X, -Y, H), (X, -Y, H), (X, Y, H), (-X, Y, H)], "roof", (0, 0, 1))
    far.box(-44.0, 44.0, -36.0, 36.0, H, H + 1.2, "metal", skip=("-z",))
    lod = collection("LOD1", main)
    far.build("Massing", lod, M, TILE)

    # colliders: the arena (with its fins and piers), the terraces and canopies, their posts, the steps for people
    helpers = collection("碰撞体")
    collider_box(helpers, "arena", -HX - PROUD, HX + PROUD, -HY - PROUD, HY + PROUD, 0.0, H)
    for tag, E, sgn in (("S", ENT_S, -1), ("N", ENT_N, 1)):
        a, b = sorted((sgn * HY, sgn * (HY + E["depth"])))
        collider_box(helpers, f"terrace{tag}", -E["x"], E["x"], a, b, 0.0, E["z"])
        hw, dep, z0, z1 = E["canopy"]
        c0, c1 = sorted((sgn * HY, sgn * (HY + dep)))
        collider_box(helpers, f"canopy{tag}", -hw, hw, c0, c1, z0, z1)
        y_ter = sgn * (HY + E["depth"])
        steps_ramp(helpers, f"steps{tag}", -E["x"] + 2.0, E["x"] - 2.0, y_ter, y_ter + sgn * E["n"] * E["run"], E["z"])
    for i, (x, y, za, zb) in enumerate(cols):
        collider_box(helpers, f"post{i:02d}", x - 0.3, x + 0.3, y - 0.3, y + 0.3, za, zb)
    flat_marker(helpers, "arena", rect(-HX - 2.5, HX + 2.5, -HY - 4.5, HY + 4.5), "FOOTPRINT")
    flat_marker(helpers, "ring", rect(-HX - 10.0, HX + 10.0, -HY - 13.0, HY + 12.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "shoudutiyuguan", "首都体育馆", "Capital Indoor Stadium"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -6525.0, -3341.1, 6.6
    s.far_distance = 800
    s.repo_path = REPO
    return dict(tris=tris, fins=len(fins), posts=len(cols))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
