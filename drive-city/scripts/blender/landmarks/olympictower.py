# 北京奥林匹克塔 Beijing Olympic Tower (2014, 246.8 m), built in Blender and marked with the bcity_landmark
# add-on's conventions. OSM draws it as five discs on their heights (ways 962658730-734: the crowns at 246.8 /
# 231 / 216 / 201 / 186 m, each with min_height a metre under the top) and building parts for the shafts, the
# flares under the crowns and the main crown's drums (ways 1459392438-451), all in a 52 m circle at the north
# end of the central axis (景观大道), north of 科荟南路. The city drew them as five floating blocks.
#
#   blender -b -P scripts/blender/landmarks/olympictower.py -- [--out art/landmarks/olympictower.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the main crown's disc
# (game -828.05, -10878.2 = 40.006545 N, 116.387873 E), heading 0 (five circles have no axis).
#
# The figures, from OSM's parts: the main shaft 15.4 m across (a little wider at its foot here) to a flare
# from 226 m out to the lower drum (29.2 m, 236-241 m, glazed), the observation drum (41.9 m, 241-250 m,
# glazed, lit at night) with the thin 51.7 m brim at 246-246.8 m round its middle - the "blade of grass" -
# and the core drum (20.1 m) to 255 m. The four lesser towers: 9.9 m shafts, a 20.8 m flare over their top
# five metres and a 31.6 m disc, its lit rim a metre deep, at 231 (NE), 216 (SE), 201 (SW) and 186 m (NW).
# Two links at 178-181 and 214-216 m join the main shaft to the NE tower (OSM's 7 m parts there). The lesser
# crowns reach over the main shaft in OSM's plan; here a crown's edge is pulled back round it (it hugs the
# shaft). At the foot: a round glazed lobby pavilion (doubtful: the real base is mostly below ground, OSM's
# layer -1 way 930904788) on a granite plinth, a paved plaza round it. Red aviation lights on the top.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, collider_pts, flat_marker, paving  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "olympictower.blend")

TAU = 2 * math.pi
GX, GZ = -828.05, -10878.2
MAIN_R = 7.7
# the lesser towers: (x, y) from the main one's axis, top height
LESSER = [((12.35, 15.0), 231.0), ((12.15, -13.2), 216.0), ((-13.55, -12.25), 201.0), ((-12.3, 15.6), 186.0)]
LESSER_R = 4.95
CROWN_R = 15.8
PLINTH_R, PLINTH_H = 33.0, 0.45
LOBBY_R, LOBBY_H = 27.0, 6.5
PLAZA_R = 46.0


def main_profile():
    """The main tower's outer skin as (key, [(r, z), ...]) bands from the foot to the top."""
    return [
        ("shaft", [(MAIN_R * 1.12, LOBBY_H), (MAIN_R * 1.06, 80.0), (MAIN_R * 1.02, 160.0), (MAIN_R, 226.0)]),
        ("white", [(MAIN_R, 226.0), (8.6, 229.0), (10.05, 231.5), (12.3, 234.0), (14.6, 236.0)]),
        ("podglass", [(14.6, 236.0), (14.6, 241.0)]),
        ("white", [(14.6, 241.0), (20.95, 241.0)]),
        ("podglass", [(20.95, 241.0), (20.95, 245.6)]),
        ("white", [(20.95, 245.6), (23.6, 245.75), (25.85, 246.0)]),
        ("rim", [(25.85, 246.0), (25.85, 246.8)]),
        ("white", [(25.85, 246.8), (20.95, 246.8)]),
        ("podglass", [(20.95, 246.8), (20.95, 249.6)]),
        ("white", [(20.95, 249.6), (20.95, 250.0), (10.05, 250.0)]),
        ("white", [(10.05, 250.0), (10.05, 254.6)]),
        ("rim", [(10.05, 254.6), (10.05, 255.0)]),
        ("roof", [(10.05, 255.0), (0.0, 255.0)]),
    ]


def main_r(z):
    """The main tower's radius at height z (for pulling the lesser crowns back round it)."""
    best = 0.0
    for _, prof in main_profile():
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-6:
                best = max(best, r0 + (r1 - r0) * (z - z0) / (z1 - z0))
    return best


def lesser_profile(h):
    return [
        ("shaft", [(LESSER_R * 1.15, LOBBY_H), (LESSER_R * 1.06, h * 0.5), (LESSER_R, h - 6.0)]),
        ("white", [(LESSER_R, h - 6.0), (5.6, h - 4.6), (7.2, h - 3.2), (9.4, h - 2.1), (11.6, h - 1.5), (CROWN_R, h - 1.0)]),
        ("rim", [(CROWN_R, h - 1.0), (CROWN_R, h)]),
        ("roof", [(CROWN_R, h), (0.0, h)]),
    ]


# --- textures ------------------------------------------------------------------------------------------

def panel_image():
    """The shafts' cladding: silver-white panels 1.5 m wide and 3 m tall, faint seams, a darker slot every 12 m."""
    cv = Canvas(128, 512, "#d9dcdd")
    cv.noise(0.04, 3)
    rng = np.random.default_rng(4)
    col = (cv.x // 64).astype(int)
    row = (cv.y // 128).astype(int)
    cv.a *= rng.uniform(0.95, 1.04, (4, 2))[row % 4, col % 2][..., None]
    cv.put((np.mod(cv.x, 64) < 1.5) | (np.mod(cv.y, 128) < 1.5), "#a9adb0")
    cv.put(cv.y < 6, "#7d8388")
    return image("OT_Panels", np.flipud(cv.a).copy())


def materials():
    lit = dict(glass="#3b4c58", frame="#d9dcdd", spandrel="#d9dcdd", mull=0.05, slab=0.1, metal=0.75, rough=0.08,
               lit=0.8, warm="#ffe2b8", coolShare=0.3)
    return dict(
        shaft=material("OT_Shaft", "#d9dcdd", 0.35, metal=0.55, tex=panel_image(), props={"wet": "surface", "glowStrength": 0.45}),
        white=material("OT_White", "#e8eaea", 0.3, metal=0.4, props={"wet": "surface", "glowStrength": 0.9}),
        podglass=facade("OT_PodGlass", dict(lit, floorH=4.6, colW=1.4, seed=21)),
        lobby=facade("OT_LobbyGlass", dict(lit, floorH=6.5, colW=1.8, lit=0.7, seed=22)),
        rim=material("OT_Rim", "#f3f6ff", 0.3, metal=0.3, props={"wet": "surface", "glow": "lamp", "glowColor": "#cfe0ff", "glowStrength": 2.5}),
        roof=material("OT_Roof", "#b4b7b8", 0.75, props={"wet": "ground", "glow": "none"}),
        granite=material("OT_Granite", "#b7b3aa", 0.75, props={"wet": "damp", "glowStrength": 0.5}),
        green=material("OT_Green", "#5f7a45", 0.95, props={"wet": "damp", "glow": "none"}),
        paving=material("OT_Paving", "#a7a397", 0.8, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 10}),
        red=material("OT_Red", "#b01810", 0.4, props={"wet": "none", "glow": "lamp", "glowColor": [1.0, 0.04, 0.02], "glowStrength": 9.0}),
    )


TILE = dict(paving=4.0, granite=3.0, roof=4.0, white=3.0, green=4.0)
FACADES = ("podglass", "lobby")


# --- geometry ------------------------------------------------------------------------------------------

def rev(g, prof, segs, key, cx=0.0, cy=0.0, us=3.0, vs=3.0, smooth=True, warp=None):
    """A surface of revolution through (r, z) points walked along the outer skin, bottom to top; facades get
    UVs in metres (u round the mid radius, v = z). `warp(x, y, z)` may move each vertex (in plan)."""
    rm = sum(r for r, _ in prof) / len(prof)
    circ = TAU * rm
    if key in FACADES:
        us, vs = 1.0, 1.0
    rings = []
    for r, z in prof:
        ring = []
        for i in range(segs):
            x, y = cx + r * math.cos(TAU * i / segs), cy + r * math.sin(TAU * i / segs)
            if warp:
                x, y = warp(x, y, z)
            ring.append(g.vert((x, y, z)))
        rings.append(ring)
    flat = all(abs(prof[j][1] - prof[0][1]) < 1e-6 for j in range(len(prof)))
    for j in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[j], prof[j + 1]
        for i in range(segs):
            k = (i + 1) % segs
            if flat:
                uv = None
            else:
                u0, u1 = circ * i / segs / us, circ * (i + 1) / segs / us
                uv = [(u0, z0 / vs), (u1, z0 / vs), (u1, z1 / vs), (u0, z1 / vs)]
            g.face((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]), key, uv, smooth and not flat)


def hug(x, y, z):
    """Pull a lesser crown's vertex out of the main tower: no closer to its axis than its skin plus 0.5 m."""
    d = math.hypot(x, y)
    lim = main_r(z) + 0.5
    if d < lim and d > 1e-6:
        return x / d * lim, y / d * lim
    return x, y


def tower_geo(segs_main, segs_less, detail=True):
    g = Geo()
    for key, prof in main_profile():
        rev(g, prof, segs_main, key)
    for (cx, cy), h in LESSER:
        for key, prof in lesser_profile(h):
            rev(g, prof, segs_less, key, cx, cy, warp=hug)
    if detail:
        # the two links between the main shaft and the NE tower
        (nx, ny), _ = LESSER[0]
        d = math.hypot(nx, ny)
        ux, uy = nx / d, ny / d
        for z0, z1 in ((178.0, 181.0), (214.0, 216.0)):
            a, b = MAIN_R - 0.3, d - LESSER_R + 0.3
            w = 1.6
            pts = [(ux * a - uy * w, uy * a + ux * w), (ux * b - uy * w, uy * b + ux * w), (ux * b + uy * w, uy * b - ux * w), (ux * a + uy * w, uy * a - ux * w)]
            for zz, want in ((z0, -1), (z1, 1)):
                g.polyn([(*p, zz) for p in pts], "white", (0, 0, want))
            for i in range(4):
                p, q = pts[i], pts[(i + 1) % 4]
                mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
                key = "podglass" if i in (0, 2) else "white"
                L = math.hypot(q[0] - p[0], q[1] - p[1])
                g.polyn([(*p, z0), (*q, z0), (*q, z1), (*p, z1)], key, (mx - (ux * (a + b) / 2), my - (uy * (a + b) / 2), 0),
                        uvs=[(0, z0), (L, z0), (L, z1), (0, z1)])
    return g


def base_geo(segs):
    b = Geo()
    # plaza, plinth, lobby
    rev(b, [(PLAZA_R, 0.03), (PLINTH_R, 0.03)], segs, "paving")
    rev(b, [(PLINTH_R, 0.0), (PLINTH_R, PLINTH_H), (LOBBY_R + 0.0, PLINTH_H)], segs, "granite", smooth=False)
    rev(b, [(LOBBY_R, PLINTH_H), (LOBBY_R, LOBBY_H - 1.1)], segs, "lobby")
    rev(b, [(LOBBY_R, LOBBY_H - 1.1), (LOBBY_R + 0.9, LOBBY_H - 0.6), (LOBBY_R + 0.9, LOBBY_H), (LOBBY_R - 0.6, LOBBY_H)], segs, "white", smooth=False)
    rev(b, [(LOBBY_R - 0.6, LOBBY_H), (LOBBY_R - 0.6, LOBBY_H + 0.5), (LOBBY_R - 1.4, LOBBY_H + 0.5)], segs, "white", smooth=False)
    rev(b, [(LOBBY_R - 1.4, LOBBY_H + 0.35), (2.0, LOBBY_H + 0.35)], segs, "green")
    return b


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("北京奥林匹克塔")
    det = collection("塔", main)

    t = tower_geo(48, 32)
    t.build("Towers", det, M, TILE)
    b = base_geo(64)
    # an entrance canopy on the south, toward the axis
    b.box(-8.0, 8.0, -LOBBY_R - 5.0, -LOBBY_R + 0.5, LOBBY_H - 2.4, LOBBY_H - 1.8, "white")
    for x in (-7.4, 7.4):
        b.box(x - 0.2, x + 0.2, -LOBBY_R - 4.6, -LOBBY_R - 4.2, PLINTH_H, LOBBY_H - 2.4, "white")
    b.build("Base", det, M, TILE)
    L = Geo()
    lamps = [(0.0, 0.0, 255.0)]
    for i in range(4):
        a = TAU * (i + 0.5) / 4
        lamps.append((9.6 * math.cos(a), 9.6 * math.sin(a), 255.0))
        lamps.append((25.4 * math.cos(a), 25.4 * math.sin(a), 246.8))
    for (cx, cy), h in LESSER:
        lamps.append((cx, cy, h))
    for x, y, z in lamps:
        L.box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, z, z + 0.6, "red", skip=("-z",))
    L.build("Lights", det, M, TILE)
    tris = t.tris() + b.tris() + L.tris()

    # far level: the same silhouette with fewer sides
    far = collection("LOD1", main)
    ft = tower_geo(16, 10, detail=False)
    fb = Geo()
    rev(fb, [(PLAZA_R, 0.03), (PLINTH_R, 0.03)], 16, "paving")
    rev(fb, [(PLINTH_R, 0.0), (PLINTH_R, PLINTH_H), (LOBBY_R, PLINTH_H), (LOBBY_R, LOBBY_H), (2.0, LOBBY_H)], 16, "lobby", smooth=False)
    fl = Geo()
    for x, y, z in lamps[:1] + lamps[-4:]:
        fl.box(x - 0.6, x + 0.6, y - 0.6, y + 0.6, z, z + 1.0, "red", skip=("-z",))
    ft.build("FarTowers", far, M, TILE)
    fb.build("FarBase", far, M, TILE)
    fl.build("FarLights", far, M, TILE)
    far_tris = ft.tris() + fb.tris() + fl.tris()

    # colliders: the plinth, the lobby, each shaft, each crown
    helpers = collection("碰撞体")

    def ring_pts(r, z0, z1, cx=0.0, cy=0.0, n=16):
        return [(cx + r * math.cos(TAU * i / n), cy + r * math.sin(TAU * i / n), z) for z in (z0, z1) for i in range(n)]

    collider_pts(helpers, "plinth", ring_pts(PLINTH_R, 0.0, PLINTH_H, n=24))
    collider_pts(helpers, "lobby", ring_pts(LOBBY_R + 0.9, PLINTH_H, LOBBY_H + 0.5, n=24))
    collider_pts(helpers, "shaft", ring_pts(MAIN_R * 1.12, LOBBY_H, 120.0) + ring_pts(MAIN_R, 226.0, 226.0))
    collider_pts(helpers, "crown", [p for _, prof in main_profile() for r, z in prof for p in ring_pts(r, z, z)])
    for (cx, cy), h in LESSER:
        collider_pts(helpers, "lshaft", ring_pts(LESSER_R * 1.15, LOBBY_H, LOBBY_H, cx, cy, 12) + ring_pts(LESSER_R, h - 6.0, h - 6.0, cx, cy, 12))
    # walk-only ramps up the plinth's edge on the four axes (0.45 m: one step and a half)
    for ang in (0.0, TAU / 4, TAU / 2, 3 * TAU / 4):
        c, s = math.cos(ang), math.sin(ang)
        pts = []
        for along, z in ((PLINTH_R + 1.2, 0.0), (PLINTH_R - 0.6, PLINTH_H), (PLINTH_R - 0.6, 0.0)):
            for w in (-4.0, 4.0):
                pts.append((c * along - s * w, s * along + c * w, z))
        collider_pts(helpers, "steps", pts, role="WALK")
    circle = [((PLINTH_R + 1.5) * math.cos(TAU * i / 32), (PLINTH_R + 1.5) * math.sin(TAU * i / 32)) for i in range(32)]
    flat_marker(helpers, "olympictower", circle, "FOOTPRINT")
    flat_marker(helpers, "olympictower", [(PLAZA_R * math.cos(TAU * i / 32), PLAZA_R * math.sin(TAU * i / 32)) for i in range(32)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "olympictower", "北京奥林匹克塔", "Beijing Olympic Tower"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = 1200
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
