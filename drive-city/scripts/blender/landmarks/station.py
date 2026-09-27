# 北京站 Beijing Railway Station (1959), built in Blender with hall.py's roofs and brackets and the kit's
# facade shader for its windows (tower.py), marked with the bcity_landmark add-on's conventions. It replaces
# the kit-built station.ts.
#
#   blender -b -P scripts/blender/landmarks/station.py -- [--out art/landmarks/station.blend] [--export]
#
# The sign needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north (the front faces the station square), metres, origin on the ground at the
# old anchor (39.902290 N, 116.421031 E, heading -1.19), the centre of OSM relation 7033336's box (227.6 x 92.8 m).
#
# The figures are the old model's: 222 m of cream stone and stucco on a granite plinth. The central hall
# (36 m wide, 29 m to its cornice, the shallow shell of its roof behind) comes forward of the wings with the
# great arched window, framed in stone, the red board with 北京站 over it; either side of it a clock tower
# (clocks to the front and outside), a balustrade round its top, a two-storey pavilion on it under double
# pyramidal (攒尖) roofs of green glaze edged in yellow, gilt finials, 44 m; the long wings, three storeys
# of tall windows over an arcade along the front, a stone cornice and a green-glazed eave with a yellow edge;
# at each end a corner block under a smaller pavilion of the same kind.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, flat_marker, mesh_of, panel_geo, place, post_geo, rect  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, eave_edge, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roof_face, roofs, sweep, to_world, uvs)
from tower import facade, sign  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "station.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

HW, YF, YB, PL = 111.0, 32.0, -40.0, 0.9       # wings' half length, front, back; the plinth
WING_H = 17.5
HALL = dict(hw=18.0, y0=-26.0, y1=43.0, h=29.0)
TOWER = dict(x=24.0, hw=4.6, y=41.0, h=29.0)
PAVB = dict(x0=95.0, x1=111.0, y0=29.0, y1=45.0, h=21.0)
ARCH = dict(aw=10.0, y0=4.5, y1=15.5)             # the great window: half width, sill, spring


def pav_spec(r_out, r_in, z0, col, s=1.0):
    """A two-storey pavilion with double 攒尖 roofs of green glaze edged in yellow, on a block top at z0."""
    bz = z0 + col
    lz = bz + 0.5 * s
    up0 = lz + 1.5 * s
    ub = up0 + 1.5 * s
    return SimpleNamespace(
        XS=[-r_out, -r_in, 0.0, r_in, r_out], YS=[-r_out, -r_in, 0.0, r_in, r_out], OX=r_out, OY=r_out, IX=r_in, IY=r_in,
        BEAM=(bz, bz + 0.5 * s, bz + 0.62 * s, bz + 1.1 * s), UBEAM=(ub, ub + 0.45 * s, ub + 0.55 * s, ub + 1.0 * s), OVERHANG=1.6 * s,
        LOWER=dict(A=r_out + 1.6 * s, D=r_out + 1.6 * s, z=bz + 0.8 * s, H=1.5 * s, p=1.3, o=0.5, lift=0.45, Lc=3.0, Vc=2.0),
        UPPER=dict(A=r_in + 1.5 * s, D=r_in + 1.5 * s, z=ub + 0.75 * s, H=4.2 * s, p=1.6, o=0.5, lift=0.5, Lc=3.0, Vc=2.0),
        GABLE_X=1.0, PITCH=0.36, AMP=0.07, TRIM=0.7 * s, RIDGE="trim", KIND="cuanjian", ROWS=5, LOWER_ROWS=3, BRACKET_GAP=1.6,
        Z0=z0, UP0=up0)


TOWER_PAV = pav_spec(3.8, 2.6, TOWER["h"] + 0.7, 3.5, 1.0)
CORNER_PAV = pav_spec(5.0, 3.4, PAVB["h"] + 0.8, 3.2, 1.1)


def clock_image(size=256):
    cv = Canvas(size, size, "#e9e4d4")
    c = size / 2
    cv.ring(c, c, c * 0.9, c, "#c9a44c")
    for i in range(12):
        a = i / 12 * 2 * math.pi
        x, y = c + math.sin(a) * c * 0.74, c - math.cos(a) * c * 0.74
        cv.line(x - math.sin(a) * 10, y + math.cos(a) * 10, x + math.sin(a) * 10, y - math.cos(a) * 10, 7, "#1a1a1a")
    cv.line(c, c, c + math.sin(-0.9) * c * 0.45, c - math.cos(-0.9) * c * 0.45, 9, "#1a1a1a")
    cv.line(c, c, c + math.sin(1.05) * c * 0.7, c - math.cos(1.05) * c * 0.7, 6, "#1a1a1a")
    return image("ST_Clock", np.flipud(cv.a).copy())


def stone_image(size=512):
    """Cream stone in coursed blocks, 4 m a repeat."""
    cv = Canvas(size, size, "#ddd0ae")
    cv.noise(0.07, 41)
    q = size / 8
    rows = (cv.y // (q * 0.5)).astype(int)
    joint = (np.mod(cv.y, q * 0.5) < 1.5) | (np.mod(cv.x + (rows % 2) * q / 2, q) < 1.5)
    cv.put(joint, "#b9ab88")
    return image("ST_Stone", np.flipud(cv.a).copy())


def materials():
    atlas, night = paint_atlas("ST", portrait=False, emblem=False)
    return dict(
        atlas=material("ST_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("ST_Plaster", "#e2d4b0", 0.85, tex=plaster(name="ST_PlasterTex", col="#e2d4b0"), props={"wet": "damp", "glowStrength": 0.6}),
        stone=material("ST_Stone", "#ddd0ae", 0.75, tex=stone_image(), props={"wet": "damp", "glowStrength": 0.6}),
        granite=material("ST_Granite", "#9c968b", 0.75, props={"wet": "ground", "glowStrength": 0.5}),
        windows=facade("ST_Windows", dict(floorH=5.4, colW=3.6, glass="#39464f", frame="#dccdaa", spandrel="#d4c49f", mull=0.2, slab=0.32, metal=0.6, rough=0.12, lit=0.55, coolShare=0.15, seed=21)),
        hallglass=facade("ST_HallGlass", dict(floorH=2.2, colW=1.4, glass="#46545e", frame="#cfc09c", mull=0.08, slab=0.08, metal=0.7, rough=0.1, lit=0.9, coolShare=0.0, seed=22)),
        tile=material("ST_Tile", "#2f7a55", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("ST_Trim", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        roof=material("ST_Roof", "#77736b", 0.8, props={"wet": "ground", "glow": "none"}),
        red=material("ST_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        board=material("ST_Board", "#9e1c16", 0.45, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.25, 0.15], "glowStrength": 0.25}),
        gold=material("ST_Gold", "#e0b04a", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.8}),
        clock=material("ST_Clock", "#e9e4d4", 0.4, tex=clock_image(), props={"glow": "lamp", "glowColor": [1.0, 0.96, 0.86], "glowStrength": 0.9}),
        paint=material("ST_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        marble=material("ST_Marble", "#ebe6da", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
    )


TILE = dict(plaster=4.0, stone=4.0, granite=3.0, tile=2.0, trim=2.0, roof=4.0, red=2.0, gold=1.0, paint=1.0, marble=2.0, board=1.0)


def wall_box(g, x0, x1, y0, y1, z0, z1, key, faces=("-x", "+x", "-y", "+y"), uvk=1.0):
    """The sides of a block in `key`, UVs in metres (for the facade shader: u along the wall, v height)."""
    P = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    names = ["-y", "+x", "+y", "-x"]
    u = 0.0
    for i in range(4):
        a, b = P[i], P[(i + 1) % 4]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if names[i] in faces:
            g.polyn([(*a, z0), (*b, z0), (*b, z1), (*a, z1)], key, (b[1] - a[1], -(b[0] - a[0]), 0),
                    uvs=[(u * uvk, z0 * uvk), ((u + L) * uvk, z0 * uvk), ((u + L) * uvk, z1 * uvk), (u * uvk, z1 * uvk)])
        u += L


def skirt(g, hw, hd, z, out, rise, cx=0.0, cy=0.0):
    """A glazed eave round a block's top (green, the first metre yellow), its hips; returns nothing."""
    R = dict(z=z, H=rise, p=1.3, o=0.35, lift=0.3, Lc=3.0, Vc=1.5)
    top = out + 0.6
    hips = []
    sub = Geo()
    for rot in range(4):
        A, De = (hw + out, hd + out) if rot % 2 == 0 else (hd + out, hw + out)
        rows = roof_face(sub, R, top, rot, A, De, top, rows=2, waves=True, key="tile", pitch=0.6, amp=0.09, trim=0.9)
        eave_edge(sub, rows[0], key="trim")
        if rot % 2 == 1:
            hips.append([r[0] for r in rows])
            hips.append([r[-1] for r in rows])
    for line in hips:
        sweep(sub, line, 0.4, 0.3, key="trim")
    g.add(sub, T(cx, cy, 0))


def block(g, x0, x1, y0, y1, h, cornice=True):
    """A cream block: the facade shader's windows above a stone base course, a cornice, a flat roof."""
    wall_box(g, x0, x1, y0, y1, PL + 1.2, h, "windows")
    g.box(x0 - 0.25, x1 + 0.25, y0 - 0.25, y1 + 0.25, PL, PL + 1.2, "stone", skip=("-z",))
    e = 0.7 if cornice else 0.0
    if cornice:
        g.box(x0 - e, x1 + e, y0 - e, y1 + e, h, h + 0.8, "stone", skip=("-z", "+z"))
        g.polyn([(x0 - e, y0 - e, h), (x1 + e, y0 - e, h), (x1 + e, y1 + e, h), (x0 - e, y1 + e, h)], "stone", (0, 0, -1))
        g.box(x0 - 0.35, x1 + 0.35, y0 - 0.35, y1 + 0.35, h - 0.35, h, "stone", skip=("-z", "+z"))
    # the flat roof covers the cornice (a separate top face there would fight it)
    g.polyn([(x0 - e, y0 - e, h + 0.8), (x1 + e, y0 - e, h + 0.8), (x1 + e, y1 + e, h + 0.8), (x0 - e, y1 + e, h + 0.8)], "roof", (0, 0, 1))


def pavilion(g, parts, mesh, H, cx, cy, n0):
    """A pavilion at (cx, cy) on a block top: its walls, beams, ceilings and roofs, the linked columns and brackets."""
    pg = Geo()
    z0 = H.Z0
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            pg.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("window", QUAD))
            pg.polyn([P(us[i], H.UP0), P(us[i + 1], H.UP0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, pg, True, *H.BEAM)
    ring_beams(H, pg, False, *H.UBEAM)
    pg.polyn([(-H.OX, -H.OY, H.BEAM[1]), (H.OX, -H.OY, H.BEAM[1]), (H.OX, H.OY, H.BEAM[1]), (-H.OX, H.OY, H.BEAM[1])], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    hips = roofs(H, pg)
    m = T(cx, cy, 0)
    g.add(pg, m)
    n = n0
    col = mesh[("col", H.BEAM[0] - z0)]
    ucol = mesh[("ucol", H.UBEAM[0] - H.UP0)]
    for outer in (True, False):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(col, f"Column.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(ucol, f"UpperColumn.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, H.UP0 - 0.4)))
                n += 1
    spots = bracket_spots(H, True, H.BEAM[2]) + bracket_spots(H, False, H.UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{n0:04d}.{i:03d}", parts, m @ T(*p) @ Rz(yaw) @ Matrix.Diagonal((0.7, 0.7, 0.7, 1)))
    for i, line in enumerate(hips):
        beasts_on([m @ p for p in line], parts, mesh, f"Beast{n0}.{i}", n=2)
    return n


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    M = materials()
    main = collection("北京站")
    g = Geo()
    # the granite plinth under everything, the steps across the hall's front
    g.box(-HW - 1.0, HW + 1.0, YB - 1.0, PAVB["y1"] + 1.0, 0.0, PL, "granite", skip=("-z",))
    for i in range(4):
        y = HALL["y1"] + 1.0 + i * 0.42
        g.box(-24.0, 24.0, y, y + 0.42, 0.0, PL - i * 0.22, "granite", skip=("-z",))
    # the wings, with the arcade along their front
    for sx in (-1, 1):
        x0, x1 = sorted((sx * HALL["hw"], sx * PAVB["x0"]))
        block(g, x0, x1, YB, YF, WING_H)
        skirt(g, (x1 - x0) / 2 + 0.7, (YF - YB) / 2 + 0.7, WING_H + 0.5, 2.0, 1.6, cx=(x0 + x1) / 2, cy=(YF + YB) / 2)
        n = int((x1 - x0 - 4) // 5.2)
        pad = (x1 - x0 - n * 5.2) / 2
        for k in range(n + 1):
            x = x0 + pad + k * 5.2
            g.box(x - 0.6, x + 0.6, YF + 0.6, YF + 2.2, PL, 6.2, "stone", skip=("-z",))
        g.box(x0 + pad - 0.8, x0 + pad + n * 5.2 + 0.8, YF + 0.2, YF + 2.4, 6.2, 7.0, "stone")
        g.polyn([(x0 + pad, YF, 6.19), (x0 + pad + n * 5.2, YF, 6.19), (x0 + pad + n * 5.2, YF + 2.2, 6.19), (x0 + pad, YF + 2.2, 6.19)], "plaster", (0, 0, -1))
    # the corner blocks
    for sx in (-1, 1):
        x0, x1 = sorted((sx * PAVB["x0"], sx * PAVB["x1"]))
        block(g, x0, x1, PAVB["y0"], PAVB["y1"], PAVB["h"])
        wall_box(g, x0, x1, YB, PAVB["y0"], PL + 1.2, WING_H, "windows", faces=("+x", "-x", "-y") if sx > 0 else ("-x", "+x", "-y"))
    # the central hall: stone walls, the great window, the board, a cornice with a glazed eave, the shell roof
    h, hw, y0, y1 = HALL["h"], HALL["hw"], HALL["y0"], HALL["y1"]
    wall_box(g, -hw, hw, y0, y1, PL, h, "stone", faces=("-x", "+x", "-y"))
    A = ARCH
    arc = [(A["aw"] * math.cos(math.pi * i / 16), A["y1"] + A["aw"] * math.sin(math.pi * i / 16)) for i in range(17)]
    win = [(A["aw"], A["y0"])] + arc + [(-A["aw"], A["y0"])]
    front = [(-hw, PL), (hw, PL), (hw, h), (-hw, h)]
    # the front wall round the window: the part below the sill, either side, and over the arch
    g.polyn([(x, y1, z) for x, z in [(-hw, PL), (hw, PL), (hw, A["y0"]), (-hw, A["y0"])]], "stone", (0, 1, 0))
    g.polyn([(x, y1, z) for x, z in [(A["aw"], A["y0"]), (hw, A["y0"]), (hw, h), (A["aw"], A["y1"])]], "stone", (0, 1, 0))
    g.polyn([(x, y1, z) for x, z in [(-hw, A["y0"]), (-A["aw"], A["y0"]), (-A["aw"], A["y1"]), (-hw, h)]], "stone", (0, 1, 0))
    g.polyn([(x, y1, z) for x, z in arc + [(-hw, h), (hw, h)]], "stone", (0, 1, 0))
    del front
    # the glazing 0.8 m in, its reveal, and a stone surround standing proud
    gy = y1 - 0.8
    g.polyn([(x, gy, z) for x, z in win], "hallglass", (0, 1, 0), uvs=[(x + A["aw"], z) for x, z in win])
    for (xa, za), (xb, zb) in zip(win, win[1:]):
        g.polyn([(xa, gy, za), (xb, gy, zb), (xb, y1, zb), (xa, y1, za)], "stone", (-(xa + xb) / 2, 0, A["y1"] - (za + zb) / 2 if (za + zb) / 2 > A["y1"] else 0))
    for sx in (-1, 1):
        g.box(sx * (A["aw"] + 0.4) - 1.2, sx * (A["aw"] + 0.4) + 1.2, y1, y1 + 1.2, PL, A["y1"] + 2.0, "stone")
    g.box(-A["aw"] - 1.6, A["aw"] + 1.6, y1, y1 + 1.4, PL, A["y0"], "stone")
    ring = [((A["aw"] + 1.6) * math.cos(math.pi * i / 16), A["y1"] + (A["aw"] + 1.6) * math.sin(math.pi * i / 16)) for i in range(17)]
    inner = [((A["aw"] + 0.1) * math.cos(math.pi * i / 16), A["y1"] + (A["aw"] + 0.1) * math.sin(math.pi * i / 16)) for i in range(17)]
    for (a, b), (c, d) in zip(zip(ring, ring[1:]), zip(inner, inner[1:])):
        g.polyn([(a[0], y1 + 0.9, a[1]), (b[0], y1 + 0.9, b[1]), (d[0], y1 + 0.9, d[1]), (c[0], y1 + 0.9, c[1])], "stone", (0, 1, 0))
        g.poly([(a[0], y1, a[1]), (b[0], y1, b[1]), (b[0], y1 + 0.9, b[1]), (a[0], y1 + 0.9, a[1])], "stone")
    # the red board with 北京站 in gilt, and the cornice
    bz = 26.1
    g.box(-7.2, 7.2, y1, y1 + 0.35, bz - 0.2, bz + 3.0, "gold")
    g.polyn([(-6.8, y1 + 0.36, bz), (6.8, y1 + 0.36, bz), (6.8, y1 + 0.36, bz + 2.6), (-6.8, y1 + 0.36, bz + 2.6)], "board", (0, 1, 0))
    g.box(-hw - 0.8, hw + 0.8, y0 - 0.8, y1 + 0.8, h, h + 0.9, "stone", skip=("-z",))
    skirt(g, hw + 0.8, (y1 - y0) / 2 + 0.8, h + 0.6, 1.8, 1.4, cy=(y0 + y1) / 2)
    # the shell (扁壳): a shallow dome over the hall, grey
    cyh = (y0 + y1) / 2
    hd = (y1 - y0) / 2
    N = 14
    grid = [[(-(hw - 1) + 2 * (hw - 1) * i / N, cyh - (hd - 1) + 2 * (hd - 1) * j / N) for i in range(N + 1)] for j in range(N + 1)]
    zz = lambda x, y: h + 1.8 + 6.5 * (1 - (abs(x) / (hw - 1)) ** 2.2) * (1 - (abs(y - cyh) / (hd - 1)) ** 2.2)   # noqa: E731
    ids = [[g.vert((x, y, zz(x, y))) for x, y in row] for row in grid]
    for j in range(N):
        for i in range(N):
            g.face((ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]), "roof", smooth=True)
    # the clock towers: stone shafts, clocks to the front and the outside, a balustraded top
    for sx in (-1, 1):
        cx, t = sx * TOWER["x"], TOWER
        wall_box(g, cx - t["hw"], cx + t["hw"], t["y"] - t["hw"], t["y"] + t["hw"], PL, t["h"], "stone")
        g.box(cx - t["hw"] - 0.6, cx + t["hw"] + 0.6, t["y"] - t["hw"] - 0.6, t["y"] + t["hw"] + 0.6, t["h"], t["h"] + 0.7, "stone", skip=("-z",))
        r, zc = 2.1, 24.4
        clock = [(r * math.cos(2 * math.pi * i / 28), r * math.sin(2 * math.pi * i / 28)) for i in range(28)]
        g.polyn([(cx + x, t["y"] + t["hw"] + 0.06, zc + z) for x, z in clock], "clock", (0, 1, 0), uvs=[(0.5 - x / (2 * r), 0.5 + z / (2 * r)) for x, z in clock])
        g.polyn([(cx + sx * (t["hw"] + 0.06), t["y"] + y, zc + z) for y, z in clock], "clock", (sx, 0, 0), uvs=[(0.5 + sx * y / (2 * r), 0.5 + z / (2 * r)) for y, z in clock])
        for k in range(28):
            a0, a1 = 2 * math.pi * k / 28, 2 * math.pi * (k + 1) / 28
            for R0, R1 in ((r, r + 0.3),):
                pts = [(R0 * math.cos(a0), R0 * math.sin(a0)), (R0 * math.cos(a1), R0 * math.sin(a1)), (R1 * math.cos(a1), R1 * math.sin(a1)), (R1 * math.cos(a0), R1 * math.sin(a0))]
                g.polyn([(cx + x, t["y"] + t["hw"] + 0.1, zc + z) for x, z in pts], "gold", (0, 1, 0))
                g.polyn([(cx + sx * (t["hw"] + 0.1), t["y"] + y, zc + z) for y, z in pts], "gold", (sx, 0, 0))
    g.build("Station", collection("站房", main), M, TILE)
    tris = g.tris()
    font = bpy.data.fonts.load(FONT)
    m = T(0, y1 + 0.42, bz + 1.3) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    tris += sign(font, "北京站", 1.9, m, "Sign", collection("站名", main), M["gold"], extrude=0.08)

    # the pavilions: two on the clock towers, one on each corner block
    parts = collection("构件", main)
    mesh = {
        ("col", TOWER_PAV.BEAM[0] - TOWER_PAV.Z0): mesh_of(column_geo(TOWER_PAV.BEAM[0] - TOWER_PAV.Z0, r=0.28), "TowerColumn", M, TILE),
        ("ucol", TOWER_PAV.UBEAM[0] - TOWER_PAV.UP0): mesh_of(column_geo(TOWER_PAV.UBEAM[0] - TOWER_PAV.UP0 + 0.4, r=0.24), "TowerUpperColumn", M, TILE),
        ("col", CORNER_PAV.BEAM[0] - CORNER_PAV.Z0): mesh_of(column_geo(CORNER_PAV.BEAM[0] - CORNER_PAV.Z0, r=0.3), "CornerColumn", M, TILE),
        ("ucol", CORNER_PAV.UBEAM[0] - CORNER_PAV.UP0): mesh_of(column_geo(CORNER_PAV.UBEAM[0] - CORNER_PAV.UP0 + 0.4, r=0.26), "CornerUpperColumn", M, TILE),
        "bracket": mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        "beast": mesh_of(beast_geo(glaze="#2f7a55"), "BeastMesh", M, TILE),
        "immortal": mesh_of(beast_geo(True, glaze="#2f7a55"), "ImmortalMesh", M, TILE),
        "post": mesh_of(post_geo(), "PostMesh", M, TILE),
        "panel": mesh_of(panel_geo(), "PanelMesh", M, TILE),
    }
    pg = Geo()
    n = 0
    for sx in (-1, 1):
        n = pavilion(pg, parts, mesh, TOWER_PAV, sx * TOWER["x"], TOWER["y"], n)
        n = pavilion(pg, parts, mesh, CORNER_PAV, sx * (PAVB["x0"] + PAVB["x1"]) / 2, (PAVB["y0"] + PAVB["y1"]) / 2, n)
        cx, t = sx * TOWER["x"], TOWER
        X0, X1, Y0, Y1 = cx - t["hw"] - 0.3, cx + t["hw"] + 0.3, t["y"] - t["hw"] - 0.3, t["y"] + t["hw"] + 0.3
        z = t["h"] + 0.7
        balustrade(parts, mesh, [(X0, Y0, z), (X1, Y0, z), (X1, Y1, z), (X0, Y1, z), (X0, Y0, z)], f"TowerRail{sx:+d}", gap=1.5)
    pg.build("Pavilions", collection("亭", main), M, TILE)
    tris += pg.tris()

    # the far level
    far = Geo()
    for sx in (-1, 1):
        x0, x1 = sorted((sx * HALL["hw"], sx * HW))
        wall_box(far, x0, x1, YB, YF, 0.0, WING_H + 0.8, "windows")
        far.polyn([(x0, YB, WING_H + 0.8), (x1, YB, WING_H + 0.8), (x1, YF, WING_H + 0.8), (x0, YF, WING_H + 0.8)], "tile", (0, 0, 1))
        a, b = sorted((sx * PAVB["x0"], sx * PAVB["x1"]))
        wall_box(far, a, b, YF, PAVB["y1"], 0.0, PAVB["h"], "windows")
        far.polyn([(a, YF, PAVB["h"]), (b, YF, PAVB["h"]), (b, PAVB["y1"], PAVB["h"]), (a, PAVB["y1"], PAVB["h"])], "tile", (0, 0, 1))
        cx, t = sx * TOWER["x"], TOWER
        far.box(cx - t["hw"], cx + t["hw"], t["y"] - t["hw"], t["y"] + t["hw"], 0.0, t["h"] + 4.0, "stone", skip=("-z",))
        pts = [(cx - t["hw"] - 1.5, t["y"] - t["hw"] - 1.5), (cx + t["hw"] + 1.5, t["y"] - t["hw"] - 1.5), (cx + t["hw"] + 1.5, t["y"] + t["hw"] + 1.5), (cx - t["hw"] - 1.5, t["y"] + t["hw"] + 1.5)]
        for i in range(4):
            a_, b_ = pts[i], pts[(i + 1) % 4]
            far.polyn([(*a_, t["h"] + 4.0), (*b_, t["h"] + 4.0), (cx, t["y"], 44.0)], "tile", ((a_[0] + b_[0]) / 2 - cx, (a_[1] + b_[1]) / 2 - t["y"], 1))
    far.box(-HALL["hw"], HALL["hw"], HALL["y0"], HALL["y1"], 0.0, HALL["h"] + 1.0, "stone", skip=("-z",))
    far.polyn([(-A["aw"], HALL["y1"] + 0.02, A["y0"]), (A["aw"], HALL["y1"] + 0.02, A["y0"]), (A["aw"], HALL["y1"] + 0.02, A["y1"] + A["aw"]), (-A["aw"], HALL["y1"] + 0.02, A["y1"] + A["aw"])], "hallglass", (0, 1, 0))
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the wings and corner blocks, the hall, the towers
    helpers = collection("碰撞体")
    collider_box(helpers, "wings", -HW, HW, YB, YF, 0.0, WING_H)
    collider_box(helpers, "arcadeW", -PAVB["x0"], -HALL["hw"], YF, YF + 2.2, 6.2, 7.0)
    collider_box(helpers, "arcadeE", HALL["hw"], PAVB["x0"], YF, YF + 2.2, 6.2, 7.0)
    collider_box(helpers, "hall", -HALL["hw"], HALL["hw"], HALL["y0"], HALL["y1"], 0.0, HALL["h"])
    for sx in (-1, 1):
        a, b = sorted((sx * PAVB["x0"], sx * PAVB["x1"]))
        collider_box(helpers, "corner", a, b, YF, PAVB["y1"], 0.0, PAVB["h"])
        cx, t = sx * TOWER["x"], TOWER
        collider_box(helpers, "tower", cx - t["hw"], cx + t["hw"], t["y"] - t["hw"], t["y"] + t["hw"], 0.0, t["h"])
    flat_marker(helpers, "station", rect(-HW - 1.0, HW + 1.0, YB - 5.0, PAVB["y1"] + 1.0), "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "station", "北京站", "Beijing Railway Station"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.902290", "116.421031", -1.19
    s.repo_path = REPO
    return dict(tris=tris, parts=n)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
