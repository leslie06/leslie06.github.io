# 天安门 Tiananmen, the Gate of Heavenly Peace, built in Blender and marked with the bcity_landmark
# add-on's conventions, ready to edit and export (sidebar N > B城 > 导出到游戏). It replaces the
# hand-coded model (city/landmarks/tiananmen.ts) that the kit assembled from boxes and textures.
#
#   blender -b -P scripts/blender/landmarks/tiananmen.py -- [--out art/landmarks/tiananmen.blend] [--export]
#   (or with the bpy module: python scripts/blender/landmarks/tiananmen.py -- ...)
#
# The slogans need a CJK font: Noto Serif SC Bold (SIL OFL), the one the flower basket uses, in .cache/fonts/
# (see flower_basket.py's header). It is only read here - the glyphs become geometry.
#
# It clears the open file first: run it in a new file. Frame: Blender +X east, +Y north (the palace),
# -Y south (the square, the front), metres, origin on the ground at the centre of the platform - the
# same anchor as the old model (39.907338 N, 116.391265 E), turned -1.84 deg like the city's axis.
#
# What is here, from the real figures where they are known (34.7 m to the top of the ridge ornaments,
# a 9 x 5 bay tower with a double-eaved 歇山 roof on a 13.4 m platform with five gateways) and from
# photographs for the rest:
#   - the roofs as surfaces with the tile rows in the geometry (the silhouette of the eave is scalloped),
#     concave slopes, corners that sweep out and up, hip, ridge and gable ridges, 正吻, nine beasts and an
#     immortal on every hip, the gables (山花) and barge boards; soffits painted with rafter ends;
#   - 212 bracket sets (斗拱) as one instanced mesh, columns, 和玺 painted beams, lattice doors and windows
#     (lit from inside at night), the painted corridor ceiling, eight lanterns, the national emblem;
#   - the platform: battered red walls on a marble 须弥座 base, five vaulted gateways right through it
#     with their doors folded back, the yellow-capped parapet, the portrait and the two slogans in relief;
#   - in front: the five 外金水桥 over the river with their balustrades (a car can drive over them), two
#     pairs of stone lions and two pairs of 华表; either side, the four reviewing stands (观礼台), which
#     OSM draws as buildings with no height and the city used to raise into 40 m blocks (each stand and the
#     forecourt is its own FOOTPRINT piece, so only the buildings under them go).
# Everything painted is one 2048 x 1024 atlas drawn here with numpy, with a night emission map.
# The stone lions are metaballs, decimated. 174k triangles in 21 draw calls; the far level 826 in 5.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, linear, material, save_and_export  # noqa: E402
from kit import (QUAD, Geo, T, Rz, balustrade, collider_box, collider_pts, coping, cyl, ell, flat_marker,  # noqa: E402
                 lathe, mesh_of, panel_geo, paving, place, post_geo, rect)
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, sweep, to_world, uv, uvs)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tiananmen.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

# --- the figures (metres; Blender frame: x east, y north, z up) --------------------------------------
PLAT = dict(hw=59.0, hd=19.4, h=13.4, batter=0.9, base=1.6, base_out=0.55, par_h=1.1, par_t=0.8)
# the five gateways line up with the five bridges (OSM puts both at 0, +-13.8, +-24.8 from the axis)
ARCHES = [(0.0, 5.3, 8.0), (-13.8, 4.4, 7.2), (13.8, 4.4, 7.2), (-24.8, 3.8, 6.2), (24.8, 3.8, 6.2)]  # x, width, crown
TOWER_BASE = dict(hw=31.0, hd=13.6, z0=13.4, z1=14.9)
# nine bays across (the middle one widest), five deep; the upper storey stands on the inner ring
XS = [-28.0, -23.0, -17.2, -11.2, -4.9, 4.9, 11.2, 17.2, 23.0, 28.0]
YS = [-10.6, -5.6, -2.0, 2.0, 5.6, 10.6]
OX, OY, IX, IY = 28.0, 10.6, 23.0, 5.6          # outer (檐柱) and inner (金柱) column rings
COL_TOP, COL_R = 21.2, 0.42
BEAM = (21.2, 21.95, 22.15, 23.05)               # 额枋 bottom, 平板枋 bottom, brackets, bracket top
UBEAM = (27.0, 27.75, 27.95, 28.85)              # the same on the upper storey
OVERHANG = 4.5
LOWER = dict(A=OX + OVERHANG, D=OY + OVERHANG, z=22.4, H=3.2, p=1.3, o=1.1, lift=1.0, Lc=9.0, Vc=5.0)
UPPER = dict(A=IX + OVERHANG, D=IY + OVERHANG, z=28.0, H=5.0, p=1.6, o=1.0, lift=0.95, Lc=8.0, Vc=4.5)
GABLE_X = IX - 1.5                               # the 山花 plane; the roof runs 0.8 m past it
TILE_PITCH, TILE_AMP = 0.46, 0.1
# the hall's spec for hall.py (roofs, rings, beams, brackets): all-yellow glazed tiles, no green edge
H = SimpleNamespace(XS=XS, YS=YS, OX=OX, OY=OY, IX=IX, IY=IY, BEAM=BEAM, UBEAM=UBEAM, OVERHANG=OVERHANG, LOWER=LOWER,
                    UPPER=UPPER, GABLE_X=GABLE_X, PITCH=TILE_PITCH, AMP=TILE_AMP, TRIM=0.0, RIDGE="tile")

# in front (y < 0): bridges (x, width, length, hump), their centre line crosses the river 63 m out
BRIDGES = [(0.0, 9.7, 41.0, 1.7), (-13.8, 7.7, 35.0, 1.35), (13.8, 7.7, 35.0, 1.35), (-24.8, 6.5, 34.0, 1.2), (24.8, 6.5, 34.0, 1.2)]
BRIDGE_Y = -63.0
HUABIAO = [(-21.0, -88.0), (21.0, -88.0), (-21.0, 48.0), (21.0, 48.0)]
LIONS = [(-7.6, -88.0, 1), (7.6, -88.0, -1), (-7.6, -27.5, 1), (7.6, -27.5, -1)]
# the reviewing stands (x0, x1, y_front, y_back), from OSM's four 观礼台 outlines in this frame
STANDS = [(-142.0, -48.0, -43.5, -30.5), (48.0, 142.0, -43.5, -30.5), (-240.0, -165.0, -36.0, -24.0), (165.0, 240.0, -36.0, -24.0)]

# --- small parts (each one mesh, linked many times: the game draws each as one instanced mesh) ---------

def lantern_geo(ceiling):
    """A great red lantern hanging from the corridor ceiling (origin at its centre)."""
    g = Geo()
    R, H = 0.95, 1.9
    prof = [(R * (0.5 + 0.5 * math.sin(math.pi * t)), -H / 2 + t * H) for t in [i / 10 for i in range(11)]]
    lathe(g, prof, 16, "lantern")
    cyl(g, 0, 0, -H / 2 - 0.16, -H / 2 + 0.04, R * 0.52, R * 0.52, 16, "gold", caps=(True, False))
    cyl(g, 0, 0, H / 2 - 0.04, H / 2 + 0.16, R * 0.52, R * 0.46, 16, "gold")
    cyl(g, 0, 0, -H / 2 - 1.0, -H / 2 - 0.16, 0.22, 0.07, 10, "lantern", caps=(True, False))
    cyl(g, 0, 0, H / 2 + 0.16, ceiling, 0.035, 0.035, 6, "red", smooth=False)
    return g


# --- the platform (城台) ----------------------------------------------------------------------------

def yf(z):
    """The battered south face's y at height z (the north face is at -yf(z))."""
    return -(PLAT["hd"] - PLAT["batter"] * z / PLAT["h"])


def xs_(z):
    return PLAT["hw"] - PLAT["batter"] * z / PLAT["h"]


def arch_outline(ax, w, crown, segs=14):
    r = w / 2
    spring = crown - r
    return spring, [(ax + r * math.cos(math.pi * (1 - i / segs)), spring + r * math.sin(math.pi * (1 - i / segs))) for i in range(segs + 1)]


def platform(g):
    hw, hd, h = PLAT["hw"], PLAT["hd"], PLAT["h"]
    zb = PLAT["base"]
    arches = sorted(ARCHES)
    spans = [(ax - w / 2, ax + w / 2) for ax, w, _ in arches]
    # the marble 须弥座 base, interrupted by the gateways front and back
    for z0, z1, out in ((0.0, 0.35, 0.55), (0.35, 0.5, 0.42), (0.5, 1.25, 0.25), (1.25, 1.4, 0.42), (1.4, zb, 0.55)):
        edges = [-(hw + out)] + [e for s in spans for e in s] + [hw + out]
        for x0, x1 in zip(edges[0::2], edges[1::2]):
            g.box(x0, x1, -(hd + out), -(hd - 0.4), z0, z1, "marble")
            g.box(x0, x1, hd - 0.4, hd + out, z0, z1, "marble")
        for sx in (-1, 1):
            g.box(min(sx * (hw - 0.4), sx * (hw + out)), max(sx * (hw - 0.4), sx * (hw + out)), -(hd + out), hd + out, z0, z1, "marble")
    # the walls: piers and the spandrels over the arches, front (south) and back
    for side in (-1, 1):
        Y = (lambda z: yf(z)) if side < 0 else (lambda z: -yf(z))
        want = (0, side, 0)
        prev = -xs_(zb)
        for (ax, w, crown), (a0, a1) in zip(arches, spans):
            g.polyn([(prev, Y(zb), zb), (a0, Y(zb), zb), (a0, Y(h), h), (-xs_(h) if prev < -hw + 1 else prev, Y(h), h)], "plaster", want)
            spring, arc = arch_outline(ax, w, crown)
            pts = [(x, Y(z), z) for x, z in arc] + [(a1, Y(h), h), (a0, Y(h), h)]
            g.polyn(pts, "plaster", want)
            prev = a1
        g.polyn([(prev, Y(zb), zb), (xs_(zb), Y(zb), zb), (xs_(h), Y(h), h), (prev, Y(h), h)], "plaster", want)
    for sx in (-1, 1):
        g.polyn([(sx * xs_(zb), yf(zb), zb), (sx * xs_(zb), -yf(zb), zb), (sx * xs_(h), -yf(h), h), (sx * xs_(h), yf(h), h)], "plaster", (sx, 0, 0))
    g.polyn([(-xs_(h), yf(h), h), (xs_(h), yf(h), h), (xs_(h), -yf(h), h), (-xs_(h), -yf(h), h)], "stone", (0, 0, 1))
    # the gateways: a vault right through, the doors folded back against the walls a third of the way in
    for ax, w, crown in arches:
        spring, arc = arch_outline(ax, w, crown)
        sec = [(ax - w / 2, 0.0)] + arc + [(ax + w / 2, 0.0)]
        for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            inward = (ax - mx, 0, spring - mz if mz > spring else 0)
            g.polyn([(x0, yf(z0), z0), (x1, yf(z1), z1), (x1, -yf(z1), z1), (x0, -yf(z0), z0)], "plaster", inward, smooth=z0 > spring - 1e-3 and z1 > spring - 1e-3)
        yd = -hd * 0.35
        for sx in (-1, 1):
            x = ax + sx * (w / 2 - 0.07)
            g.polyn([(x, yd, 0.02), (x, yd + w / 2, 0.02), (x, yd + w / 2, spring), (x, yd, spring)], "atlas", (-sx, 0, 0),
                    uvs=uvs("gatedoor", QUAD))
    # the parapet (宇墙) round the top, capped with yellow tiles
    t, ph = PLAT["par_t"], PLAT["par_h"]
    X, Yt = xs_(h), -yf(h)
    runs = [((-X, -Yt + t / 2), (X, -Yt + t / 2)), ((-X, Yt - t / 2), (X, Yt - t / 2)),
            ((-X + t / 2, -Yt + t), (-X + t / 2, Yt - t)), ((X - t / 2, -Yt + t), (X - t / 2, Yt - t))]
    for (x0, y0), (x1, y1) in runs:
        g.box(min(x0, x1) - (t / 2 if x0 == x1 else 0), max(x0, x1) + (t / 2 if x0 == x1 else 0),
              min(y0, y1) - (t / 2 if y0 == y1 else 0), max(y0, y1) + (t / 2 if y0 == y1 else 0), h, h + ph, "plaster")
        coping(g, (x0, y0), (x1, y1), t + 0.3, h + ph)
    # the portrait over the middle gateway, in its frame, leaning with the wall
    x0, x1, z0, z1 = -2.85, 2.85, 8.45, 13.05
    g.polyn([(x0, yf(z0) - 0.22, z0), (x1, yf(z0) - 0.22, z0), (x1, yf(z1) - 0.22, z1), (x0, yf(z1) - 0.22, z1)], "atlas", (0, -1, 0),
            uvs=uvs("portrait", QUAD))
    for (ax_, az), (bx, bz) in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0))):
        g.poly([(ax_, yf(az) - 0.22, az), (bx, yf(bz) - 0.22, bz), (bx, yf(bz), bz), (ax_, yf(az), az)], "red")


# --- the tower (城楼) ---------------------------------------------------------------------------------

def tower(g):
    tb = TOWER_BASE
    z0 = tb["z1"]
    # the marble terrace it stands on, with steps down front and back
    for za, zc, out in ((tb["z0"], 13.7, 0.35), (13.7, 13.85, 0.2), (13.85, 14.5, 0.0), (14.5, 14.65, 0.2), (14.65, z0, 0.35)):
        g.box(-tb["hw"] - out, tb["hw"] + out, -tb["hd"] - out, tb["hd"] + out, za, zc, "marble", skip=("-z", "+z"))
    g.polyn([(-tb["hw"] - 0.35, -tb["hd"] - 0.35, z0), (tb["hw"] + 0.35, -tb["hd"] - 0.35, z0), (tb["hw"] + 0.35, tb["hd"] + 0.35, z0),
             (-tb["hw"] - 0.35, tb["hd"] + 0.35, z0)], "stone", (0, 0, 1))
    for s in (-1, 1):
        for k in range(3):
            y0, y1 = s * (tb["hd"] + 0.35), s * (tb["hd"] + 0.35 + (3 - k) * 0.45)
            g.box(-4.9, 4.9, min(y0, y1), max(y0, y1), tb["z0"], tb["z0"] + (k + 1) * 0.5, "marble")
    # the ground floor behind the colonnade: doors in the middle bays, windows over a sill wall at the ends
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)
            front = rot in (0, 2)
            reg = ("door" if 1 <= i <= len(us) - 3 else "window") if front else None
            if reg:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], BEAM[0]), P(us[i], BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            else:
                g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], BEAM[0]), P(us[i], BEAM[0])], "plaster", cdir(rot, 0, -1))
            # the painted beam over them, seen from the corridor
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)
            g.polyn([Q(us[i], BEAM[0]), Q(us[i + 1], BEAM[0]), Q(us[i + 1], BEAM[1]), Q(us[i], BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            # the upper storey's band of windows, above the lower roof
            g.polyn([P(us[i], 24.9), P(us[i + 1], 24.9), P(us[i + 1], UBEAM[0]), P(us[i], UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, g, True, *BEAM)
    ring_beams(H, g, False, *UBEAM)
    # the corridor ceiling (天花)
    zc = BEAM[1]
    for x0, x1, y0, y1 in ((-OX, OX, -OY, -IY), (-OX, OX, IY, OY), (IX, OX, -IY, IY), (-OX, -IX, -IY, IY)):
        nx, ny = max(1, round((x1 - x0) / 1.3)), max(1, round((y1 - y0) / 1.3))
        for i in range(nx):
            for j in range(ny):
                a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
                b0, b1 = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
                g.polyn([(a0, b0, zc), (a1, b0, zc), (a1, b1, zc), (a0, b1, zc)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    # the national emblem between the eaves
    R, c = 1.3, Vector((0, -(IY + 0.55), 26.75))
    ring = [Vector((c.x + R * math.cos(2 * math.pi * i / 36), c.y, c.z + R * math.sin(2 * math.pi * i / 36))) for i in range(36)]
    g.polyn(ring, "atlas", (0, -1, 0), uvs=[uv("emblem", 0.5 + 0.5 * math.cos(2 * math.pi * i / 36), 0.5 + 0.5 * math.sin(2 * math.pi * i / 36)) for i in range(36)])
    outer = [Vector((c.x + 1.46 * math.cos(2 * math.pi * i / 36), c.y, c.z + 1.46 * math.sin(2 * math.pi * i / 36))) for i in range(36)]
    for i in range(36):
        k = (i + 1) % 36
        g.polyn([ring[i] + Vector((0, -0.12, 0)), ring[k] + Vector((0, -0.12, 0)), outer[k] + Vector((0, -0.12, 0)), outer[i] + Vector((0, -0.12, 0))], "gold", (0, -1, 0))
        g.poly([outer[i] + Vector((0, -0.12, 0)), outer[k] + Vector((0, -0.12, 0)), outer[k] + Vector((0, 0.1, 0)), outer[i] + Vector((0, 0.1, 0))], "gold", smooth=True)


# --- in front, and either side ----------------------------------------------------------------------

def stands(g):
    """观礼台: a low front wall, tiers of stone seats rising to a tall back wall, cross walls every ~24 m."""
    for x0, x1, y0, y1 in STANDS:
        zf, zback = 2.4, 7.2
        # front wall with its white balustrade band, capped
        n = max(1, round((x1 - x0) / 8))
        for i in range(n):
            a, b = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            g.polyn([(a, y0, 0), (b, y0, 0), (b, y0, zf), (a, y0, zf)], "atlas", (0, -1, 0), uvs=uvs("stand", QUAD))
        g.box(x0, x1, y0, y0 + 0.6, 0, zf, "plaster", skip=("-y", "-z"))
        coping(g, (x0, y0 + 0.3), (x1, y0 + 0.3), 0.9, zf)
        # the tiers
        steps, ya, yb = 8, y0 + 0.6, y1 - 0.8
        for k in range(steps):
            s0, s1 = ya + (yb - ya) * k / steps, ya + (yb - ya) * (k + 1) / steps
            z = 1.2 + (zback - 1.6 - 1.2) * (k + 1) / steps
            g.polyn([(x0, s0, z), (x1, s0, z), (x1, s1, z), (x0, s1, z)], "stone", (0, 0, 1))
            zprev = 1.2 + (zback - 1.6 - 1.2) * k / steps
            g.polyn([(x0, s0, zprev), (x1, s0, zprev), (x1, s0, z), (x0, s0, z)], "stone", (0, -1, 0))
        g.polyn([(x0, ya, 0.0), (x1, ya, 0.0), (x1, ya, 1.2), (x0, ya, 1.2)], "plaster", (0, -1, 0))
        # back wall, capped
        g.box(x0, x1, y1 - 0.8, y1, 0, zback, "plaster", skip=("-z",))
        coping(g, (x0, y1 - 0.4), (x1, y1 - 0.4), 1.1, zback)
        # ends and cross walls: sloping, a metre over the seats
        m = max(1, round((x1 - x0) / 24))
        for i in range(m + 1):
            x = x0 + (x1 - x0) * i / m
            xa, xb = (x, x + 0.6) if i == 0 else ((x - 0.6, x) if i == m else (x - 0.3, x + 0.3))
            prof = [(y0, 0), (y1, 0), (y1, zback + 0.3), (y0 + 0.3, zf + 0.4)]
            for xx, sgn in ((xa, -1), (xb, 1)):
                g.polyn([(xx, y, z) for y, z in prof], "plaster", (sgn, 0, 0))
            for (ya_, za), (yb_, zb_) in zip(prof, prof[1:] + prof[:1]):
                if za == 0 and zb_ == 0:
                    continue
                g.poly([(xa, ya_, za), (xb, ya_, za), (xb, yb_, zb_), (xa, yb_, zb_)], "plaster")
            top = [(y0 + 0.3, zf + 0.4), (y1, zback + 0.3)]
            a, b = Vector(((xa + xb) / 2, top[0][0], top[0][1])), Vector(((xa + xb) / 2, top[1][0], top[1][1]))
            sweep(g, [a, b], 0.95, 0.3, key="tile", sink=0.02)


def bridge_z(s, L, hump):
    return hump * (0.5 - 0.5 * math.cos(2 * math.pi * s / L))


def bridges(g, coll, meshes):
    """外金水桥: five humped marble bridges over the river, deck of stone flags, balustrades both sides."""
    decks = []
    for bx, W, L, hump in BRIDGES:
        ys = [BRIDGE_Y + L / 2 - L * i / 24 for i in range(25)]
        zs = [bridge_z(L * i / 24, L, hump) + 0.04 for i in range(25)]
        xl, xr = bx - W / 2, bx + W / 2
        for i in range(24):
            g.polyn([(xl + 0.3, ys[i], zs[i]), (xr - 0.3, ys[i], zs[i]), (xr - 0.3, ys[i + 1], zs[i + 1]), (xl + 0.3, ys[i + 1], zs[i + 1])], "deck", (0, 0, 1))
            for x, sx in ((xl, -1), (xr, 1)):
                g.polyn([(x, ys[i], 0), (x, ys[i + 1], 0), (x, ys[i + 1], zs[i + 1] + 0.1), (x, ys[i], zs[i] + 0.1)], "marble", (sx, 0, 0))
                xi = x - sx * 0.3
                g.polyn([(x, ys[i], zs[i] + 0.1), (x, ys[i + 1], zs[i + 1] + 0.1), (xi, ys[i + 1], zs[i + 1] + 0.1), (xi, ys[i], zs[i] + 0.1)], "marble", (0, 0, 1))
        for x in (xl + 0.15, xr - 0.15):
            pts = [(x, ys[i], zs[i] + 0.1) for i in range(0, 25, 2)]
            balustrade(coll, meshes, pts, f"bridge{bx:+.0f}{'L' if x < bx else 'R'}", gap=1.95)
        decks.append((bx, W, L, hump, ys, zs))
    return decks


def huabiao(g, x, y, facing):
    """华表: octagonal marble column wound by a dragon, the cloud board, the dew plate and its beast, on a fenced base."""
    lathe(g, [(1.5, 0.0), (1.5, 0.3), (1.25, 0.45), (1.08, 0.52), (1.08, 1.3), (1.25, 1.4), (1.42, 1.58), (1.42, 1.8), (0.0, 1.81)], 8, "marble", x, y, smooth=False)
    lathe(g, [(0.5, 1.8), (0.5, 8.0)], 8, "marble", x, y, smooth=False)
    # the dragon: a scaled tube spiralling up the shaft
    turns, n = 2.6, 120
    path = [Vector((x + 0.52 * math.cos(2 * math.pi * turns * t + 0.6), y + 0.52 * math.sin(2 * math.pi * turns * t + 0.6), 2.2 + 5.0 * t)) for t in [i / n for i in range(n + 1)]]
    rings = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, n)] - path[max(i - 1, 0)]).normalized()
        out = Vector((p.x - x, p.y - y, 0)).normalized()
        b = t.cross(out).normalized()
        r = 0.15 * (0.55 + 0.45 * math.sin(math.pi * i / n)) * (1 + 0.15 * math.sin(i * 1.7))
        rings.append([g.vert(p + (out * math.cos(a) + b * math.sin(a)) * r) for a in [2 * math.pi * k / 6 for k in range(6)]])
    for a, b in zip(rings, rings[1:]):
        for k in range(6):
            g.face((a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]), "marble", smooth=True)
    ell(g, (x, y + facing * 0.62, 7.25), (0.26, 0.2, 0.2), "marble", nu=8, nv=5)
    # the cloud board (云板) across the top of the shaft
    cloud = [(-1.3, 0.0), (-1.05, -0.28), (-0.6, -0.22), (-0.3, -0.4), (0.3, -0.4), (0.6, -0.22), (1.05, -0.28), (1.3, 0.0),
             (1.12, 0.3), (0.7, 0.24), (0.35, 0.42), (-0.35, 0.42), (-0.7, 0.24), (-1.12, 0.3)]
    for dy, sgn in ((-0.08, -1), (0.08, 1)):
        g.polyn([(x + cx, y + dy, 7.55 + cz) for cx, cz in cloud], "marble", (0, sgn, 0))
    for (ax_, az), (bx, bz) in zip(cloud, cloud[1:] + cloud[:1]):
        g.poly([(x + ax_, y - 0.08, 7.55 + az), (x + bx, y - 0.08, 7.55 + bz), (x + bx, y + 0.08, 7.55 + bz), (x + ax_, y + 0.08, 7.55 + az)], "marble")
    # the dew plate (承露盘) on a lotus, and the 犼 crouching on it facing out
    lathe(g, [(0.5, 8.0), (0.62, 8.12), (0.78, 8.3), (0.82, 8.42), (0.82, 8.52), (0.0, 8.53)], 12, "marble", x, y)
    ell(g, (x, y, 8.8), (0.22, 0.34, 0.26), "marble", nu=8, nv=5)
    ell(g, (x, y + facing * 0.3, 9.12), (0.17, 0.17, 0.17), "marble", nu=8, nv=5)
    ell(g, (x, y - facing * 0.2, 8.72), (0.2, 0.16, 0.22), "marble", nu=8, nv=5)
    for sx in (-1, 1):
        cyl(g, x + sx * 0.15, y + facing * 0.25, 8.52, 8.9, 0.06, 0.06, 6, "marble")
        g.box(x + sx * 0.12 - 0.03, x + sx * 0.12 + 0.03, y + facing * 0.25 - 0.03, y + facing * 0.25 + 0.03, 9.25, 9.42, "marble")


def lion_mesh(name, male):
    """A seated stone lion (about 2.4 m) from metaballs, facing -Y: squat, big head, a shell of curls
    round the back of it, thick forelegs; the male's paw on a ball, the female's on a cub. Decimated."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = mb.render_resolution = 0.045
    mb.threshold = 0.32          # low: the parts blend into one body instead of beads

    def el(kind, co, r, size=None, rot=None):
        e = mb.elements.new(type=kind)
        e.co, e.radius = co, r
        if size:
            e.size_x, e.size_y, e.size_z = size
        if rot is not None:
            e.rotation = rot
        return e
    el("ELLIPSOID", (0, 0.3, 0.5), 0.62, (0.9, 1.0, 0.8))                      # haunches
    el("ELLIPSOID", (0, -0.12, 1.0), 0.6, (0.95, 0.75, 1.1))                   # chest, upright
    el("BALL", (0, 0.02, 1.72), 0.66)                                          # mane
    el("BALL", (0, -0.26, 1.76), 0.52)                                         # head, over the chest
    el("ELLIPSOID", (0, -0.62, 1.62), 0.34, (1.0, 0.6, 0.62))                  # muzzle and jaw
    el("ELLIPSOID", (0, -0.56, 1.42), 0.26, (0.9, 0.7, 0.5))
    for sx in (-1, 1):
        el("BALL", (sx * 0.23, -0.66, 1.88), 0.17)                              # bulging eyes
        el("ELLIPSOID", (sx * 0.3, -0.42, 0.62), 0.28, (0.7, 0.75, 1.6))        # forelegs, straight down
        el("ELLIPSOID", (sx * 0.47, 0.35, 0.28), 0.38, (0.75, 1.1, 0.8))        # hind legs
    # curls: many small ones sunk into the mane behind and over the head
    for i in range(7):
        for j in range(7):
            th = math.radians(-80 + 26.6 * i)
            ph = math.radians(-10 + 20 * j)
            d = Vector((math.sin(th) * math.cos(ph), math.cos(th) * math.cos(ph) * 0.85 + 0.15, math.sin(ph)))
            el("BALL", tuple(Vector((0, 0.02, 1.72)) + d * 0.6), 0.21)
    el("BALL", (0, 0.66, 0.85), 0.3)                                           # tail
    if male:
        el("BALL", (0.34, -0.68, 0.3), 0.3)                                    # the embroidered ball, his right paw on it
        el("ELLIPSOID", (0.32, -0.66, 0.62), 0.22, (1.0, 1.2, 0.7))
        el("ELLIPSOID", (-0.3, -0.52, 0.16), 0.3, (1.0, 1.3, 0.7))
    else:
        el("ELLIPSOID", (0.3, -0.52, 0.16), 0.3, (1.0, 1.3, 0.7))
        el("BALL", (-0.36, -0.66, 0.26), 0.24)                                 # the cub under her left paw
        el("BALL", (-0.4, -0.84, 0.44), 0.16)
        el("ELLIPSOID", (-0.32, -0.62, 0.58), 0.2, (1.0, 1.2, 0.7))
    ob = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    tmp = bpy.data.objects.new(name + "_d", me)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new("dec", "DECIMATE")
    mod.ratio = 0.22
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(me)
    out.shade_smooth()
    stone = linear("#bdb8ad")
    attr = out.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", [c for _ in out.vertices for c in (*stone, 1.0)])
    return out


def slogan(font, text, x, zc, width, M, coll, name):
    """A slogan in relief on the battered wall: glyphs 1.8 m tall, stretched to `width`."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, font, 1.0, 0.08
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
    cu.space_character = 1.12
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    ky, kx = 1.8 / (max(ys) - min(ys)), width / (max(xs) - min(xs))
    cy = (max(ys) + min(ys)) / 2
    tilt = math.atan2(PLAT["batter"], PLAT["h"])
    m = T(x, yf(zc) - 0.12, zc) @ Matrix.Rotation(-tilt, 4, "X") @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z))
    me.materials.append(M["letters"])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


# --- the far level, colliders, markers ----------------------------------------------------------------

def far_level(g):
    """Past 800 m: the platform, the terrace, the tower as a block under both roofs, the stands."""
    h = PLAT["h"]
    for side in (-1, 1):
        Y = (lambda z: yf(z)) if side < 0 else (lambda z: -yf(z))
        g.polyn([(-xs_(0), Y(0), 0), (xs_(0), Y(0), 0), (xs_(h), Y(h), h), (-xs_(h), Y(h), h)], "plaster", (0, side, 0))
    for sx in (-1, 1):
        g.polyn([(sx * xs_(0), yf(0), 0), (sx * xs_(0), -yf(0), 0), (sx * xs_(h), -yf(h), h), (sx * xs_(h), yf(h), h)], "plaster", (sx, 0, 0))
    g.box(-xs_(h), xs_(h), yf(h), -yf(h), h, h + PLAT["par_h"], "plaster", skip=("-z",))
    tb = TOWER_BASE
    g.box(-tb["hw"], tb["hw"], -tb["hd"], tb["hd"], tb["z0"], tb["z1"], "marble", skip=("-z",))
    g.box(-OX, OX, -OY, OY, tb["z1"], LOWER["z"] + 0.4, "plaster", skip=("-z",))
    g.box(-IX, IX, -IY, IY, LOWER["z"], UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(H, g, lod=True)
    for x0, x1, y0, y1 in STANDS:
        prof = [(y0, 0), (y1, 0), (y1, 7.2), (y0, 2.4)]
        for x, sx in ((x0, -1), (x1, 1)):
            g.polyn([(x, y, z) for y, z in prof], "plaster", (sx, 0, 0))
        g.polyn([(x0, y0, 0), (x1, y0, 0), (x1, y0, 2.4), (x0, y0, 2.4)], "plaster", (0, -1, 0))
        g.polyn([(x0, y0, 2.4), (x1, y0, 2.4), (x1, y1, 7.2), (x0, y1, 7.2)], "stone", (0, 0, 1))


def colliders(coll, decks):
    hw, hd, h = PLAT["hw"], PLAT["hd"], PLAT["h"]
    top = h + PLAT["par_h"]
    # the platform as piers and lintels, so the five gateways stay open to drive through
    x0 = -hw
    for i, (ax, w, crown) in enumerate(sorted(ARCHES)):
        collider_box(coll, f"pier{i}", x0, ax - w / 2, -hd, hd, 0, top)
        collider_box(coll, f"lintel{i}", ax - w / 2, ax + w / 2, -hd, hd, crown, top)
        x0 = ax + w / 2
    collider_box(coll, "pier5", x0, hw, -hd, hd, 0, top)
    tb = TOWER_BASE
    collider_box(coll, "tower", -tb["hw"], tb["hw"], -tb["hd"], tb["hd"], tb["z0"], 34.0)
    for i, (x0_, x1, y0, y1) in enumerate(STANDS):
        collider_pts(coll, f"stand{i}", [(x, y0, 0) for x in (x0_, x1)] + [(x, y1, 0) for x in (x0_, x1)] +
                     [(x, y0, 2.8) for x in (x0_, x1)] + [(x, y1, 7.5) for x in (x0_, x1)])
    # bridges: the deck as triangles (a car drives over the hump), each balustrade a thin hull
    import bcity_landmark
    for bx, W, L, hump, ys, zs in decks:
        me = bpy.data.meshes.new(f"deck{bx:+.0f}")
        verts, faces = [], []
        for y, z in zip(ys, zs):
            verts += [(bx - W / 2, y, z), (bx + W / 2, y, z)]
        for i in range(len(ys) - 1):
            faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new(f"deck{bx:+.0f}", me)
        coll.objects.link(o)
        bcity_landmark.rename(o, "COLMESH")
        for sx in (-1, 1):
            x = bx + sx * (W / 2 - 0.15)
            for part in range(3):
                seg = range(part * 8, part * 8 + 9)
                pts = []
                for i in seg:
                    pts += [(x - 0.14, ys[i], 0), (x + 0.14, ys[i], 0), (x - 0.14, ys[i], zs[i] + 1.2), (x + 0.14, ys[i], zs[i] + 1.2)]
                collider_pts(coll, f"rail{bx:+.0f}{sx:+d}{part}", pts)
    for i, (x, y) in enumerate(HUABIAO):
        collider_box(coll, f"huabiao{i}", x - 1.5, x + 1.5, y - 1.5, y + 1.5, 0, 1.8)
        collider_box(coll, f"huabiaoshaft{i}", x - 0.55, x + 0.55, y - 0.55, y + 0.55, 1.8, 9.4)
    for i, (x, y, _) in enumerate(LIONS):
        collider_box(coll, f"lion{i}", x - 0.85, x + 0.85, y - 1.4, y + 1.4, 0, 4.1)


def build():
    clear_file()
    for mb in list(bpy.data.metaballs):
        bpy.data.metaballs.remove(mb)
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    atlas, atlas_night = paint_atlas()
    pav = paving()
    M = dict(
        atlas=material("TAM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=atlas_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("TAM_Plaster", "#ad3420", 0.85, tex=plaster(), props={"wet": "damp"}),
        stone=material("TAM_Paving", "#a29e94", 0.8, tex=pav, props={"wet": "ground", "glowStrength": 0.6}),
        deck=material("TAM_Deck", "#a29e94", 0.8, tex=pav, props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        marble=material("TAM_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        tile=material("TAM_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        red=material("TAM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("TAM_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("TAM_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        lantern=material("TAM_Lantern", "#c9161b", 0.55, props={"glow": "lamp", "glowColor": [1.0, 0.1, 0.03], "glowStrength": 0.45}),
        letters=material("TAM_Letters", "#f4f0e6", 0.5, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.95, 0.85], "glowStrength": 0.3}),
    )
    TILE = dict(plaster=4.0, stone=4.0, deck=4.0, marble=2.0, tile=2.0, red=2.0, gold=1.0, paint=1.0, lantern=1.0)
    main = collection("天安门")
    stats = {}

    g = Geo()
    platform(g)
    g.build("Platform", collection("城台", main), M, TILE)
    stats["platform"] = g.tris()

    g = Geo()
    tower(g)
    g.build("Tower", collection("城楼", main), M, TILE)
    stats["tower"] = g.tris()

    g = Geo()
    hips = roofs(H, g)
    g.build("Roofs", collection("屋顶", main), M, TILE)
    stats["roofs"] = g.tris()

    # the linked parts: columns, brackets, beasts, lanterns, balustrades
    parts = collection("构件", main)
    mesh = dict(
        column=mesh_of(column_geo(COL_TOP - TOWER_BASE["z1"]), "ColumnMesh", M, TILE),
        ucolumn=mesh_of(column_geo(UBEAM[0] - 24.6), "UpperColumnMesh", M, TILE),
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True), "ImmortalMesh", M, TILE),
        lantern=mesh_of(lantern_geo(BEAM[1] - 18.7), "LanternMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )
    z0 = TOWER_BASE["z1"]
    n = 0
    for outer in (True, False):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(mesh["column"], f"Column.{n:03d}", parts, T(*to_world(rot, D, u, 0, z0)))
                if not outer:
                    place(mesh["ucolumn"], f"UpperColumn.{n:03d}", parts, T(*to_world(rot, D, u, 0, 24.6)))
                n += 1
    spots = bracket_spots(H, True, BEAM[2]) + bracket_spots(H, False, UBEAM[2])
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, T(*p) @ Rz(yaw))
    for i, line in enumerate(hips):
        beasts_on(line, parts, mesh, f"Beast{i}")
    for i in range(len(XS) - 1):
        if i != 4:
            place(mesh["lantern"], f"Lantern.{i}", parts, T((XS[i] + XS[i + 1]) / 2, -(OY + IY) / 2, 18.7))
    tb = TOWER_BASE
    X, Y = tb["hw"] + 0.1, tb["hd"] + 0.1
    ring = [(-X, -Y, z0), (X, -Y, z0), (X, Y, z0), (-X, Y, z0), (-X, -Y, z0)]
    balustrade(parts, mesh, ring, "TerraceRail", gap=1.8, skip=[(-5.0, 5.0, -Y - 1, -Y + 1), (-5.0, 5.0, Y - 1, Y + 1)])
    stats["brackets"] = len(spots)

    # the slogans
    font = bpy.data.fonts.load(FONT)
    letters = collection("标语", main)
    slogan(font, "中华人民共和国万岁", -17.3, 10.95, 22.0, M, letters, "SloganWest")
    slogan(font, "世界人民大团结万岁", 17.3, 10.95, 22.0, M, letters, "SloganEast")

    # in front and either side
    front = collection("金水桥 观礼台", main)
    g = Geo()
    stands(g)
    decks = bridges(g, parts, mesh)
    for x, y in HUABIAO:
        huabiao(g, x, y, -1 if y < 0 else 1)
    for x, y, _ in LIONS:
        for za, zc, out in ((0.0, 0.3, 0.12), (0.3, 1.1, 0.0), (1.1, 1.4, 0.1), (1.4, 1.55, 0.0)):
            g.box(x - 0.75 - out, x + 0.75 + out, y - 1.3 - out, y + 1.3 + out, za, zc, "marble", skip=("-z",))
    g.build("Front", front, M, TILE)
    stats["front"] = g.tris()
    lions = collection("石狮", main)
    for i, (x, y, side) in enumerate(LIONS):
        me = lion_mesh(f"Lion{i}", male=side > 0)
        me.materials.append(M["paint"])
        m = T(x, y, 1.55) @ Matrix.Diagonal((side, 1, 1, 1))     # the pair mirror each other
        o = bpy.data.objects.new(f"Lion.{i}", me)
        o.matrix_world = m
        lions.objects.link(o)
        stats[f"lion{i}"] = len(me.polygons)

    # the far level
    g = Geo()
    far_level(g)
    g.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = g.tris()

    # colliders, footprint (the gate and each stand: OSM draws them as buildings), clear ground
    helpers = collection("碰撞体")
    colliders(helpers, decks)
    flat_marker(helpers, "platform", rect(-PLAT["hw"] - 0.6, PLAT["hw"] + 0.6, -PLAT["hd"] - 0.6, PLAT["hd"] + 0.6), "FOOTPRINT")
    # the forecourt between the wall and the stands: OSM has two 6 m huts there, in front of the gateways
    flat_marker(helpers, "forecourt", rect(-47.0, 47.0, -30.0, -PLAT["hd"]), "FOOTPRINT")
    for i, (x0, x1, y0, y1) in enumerate(STANDS):
        flat_marker(helpers, f"stand{i}", rect(x0 - 1, x1 + 1, y0 - 1, y1 + 1), "FOOTPRINT")
        flat_marker(helpers, f"stand{i}", rect(x0 - 2, x1 + 2, y0 - 2, y1 + 1), "CLEAR")
    flat_marker(helpers, "bridges", rect(-33, 33, -93, -21), "CLEAR")
    for i, (x, y) in enumerate(HUABIAO[2:]):
        flat_marker(helpers, f"huabiao{i}", rect(x - 3, x + 3, y - 3, y + 3), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "tiananmen", "天安门", "Tiananmen"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.907338", "116.391265", -1.84
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
