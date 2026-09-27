# 太和殿 Hall of Supreme Harmony with 中和殿 and 保和殿 on their shared 三台, built in Blender with hall.py and
# marked with the bcity_landmark add-on's conventions. It replaces the kit-built taihedian.ts.
#
#   blender -b -P scripts/blender/landmarks/taihedian.py -- [--out art/landmarks/taihedian.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the old anchor (39.915896 N, 116.390814 E,
# heading -1.52), the centre of 太和殿.
#
# The figures are the old model's (OSM's three halls fall where it put them): the 三台, three tiers of white
# marble in the 土 plan (132 x 206 m at the foot, each tier 2.71 m and set back 4.5 m, 8.1 m in all) with
# balustrades round every tier - a carved panel between square posts, the panels one textured strip (a
# post-and-panel balustrade instanced at this length would be 150k triangles) - and flights on the axes
# (the great one south with the carved 御路, north, east and west); 太和殿, 11 x 5 bays, double-eaved 庑殿
# with ten beasts on its upper hips, 35.8 m; 中和殿, square, five bays with a colonnade round it, one 攒尖
# under a gilt finial; 保和殿, 9 x 5 bays, double-eaved 歇山. Yellow glaze.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, to_world, uvs)
from tower import ccw, inset_poly, loft  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "taihedian.blend")

T1 = ccw([(-66.0, -50.0), (66.0, -50.0), (66.0, 36.0), (44.0, 36.0), (44.0, 94.0), (58.0, 94.0), (58.0, 156.0), (-58.0, 156.0),
          (-58.0, 94.0), (-44.0, 94.0), (-44.0, 36.0), (-66.0, 36.0)])
TH, STEP, RISE, RUN = 2.71, 4.5, 0.17, 0.28
TOP = 3 * TH
Y_ZH, Y_BH = 64.6, 123.5
BASE = TOP + 0.6              # the halls' floor, on a low sumeru each
# flights: (axis, width, 御路 width, position along the other axis, the tier edge's coordinate for tier 0)
FLIGHTS = [("S", 12.0, 3.6, 0.0, -50.0), ("N", 9.0, 3.0, 0.0, 156.0), ("E", 5.0, 0.0, -6.0, 66.0), ("W", 5.0, 0.0, -6.0, -66.0)]

TAIHE = SimpleNamespace(
    XS=[-30.0, -25.0, -20.0, -15.0, -10.0, -4.2, 4.2, 10.0, 15.0, 20.0, 25.0, 30.0], YS=[-16.6, -10.6, -4.6, 4.6, 10.6, 16.6],
    OX=30.0, OY=16.6, IX=25.0, IY=10.6, BEAM=(BASE + 8.0, BASE + 8.9, BASE + 9.1, BASE + 10.2), UBEAM=(23.0, 23.8, 24.0, 25.1), OVERHANG=4.4,
    LOWER=dict(A=34.4, D=21.0, z=BASE + 9.5, H=3.4, p=1.3, o=1.2, lift=1.1, Lc=9.0, Vc=5.0),
    UPPER=dict(A=29.4, D=15.0, z=24.4, H=8.2, p=1.6, o=1.1, lift=1.0, Lc=8.5, Vc=4.8),
    GABLE_X=23.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=8, LOWER_ROWS=5, BRACKET_GAP=1.6)
TAIHE_UP0 = 20.3
ZHONGHE = SimpleNamespace(
    XS=[-10.0, -6.2, -2.2, 2.2, 6.2, 10.0], YS=[-10.0, -6.2, -2.2, 2.2, 6.2, 10.0], OX=10.0, OY=10.0, IX=6.2, IY=6.2,
    BEAM=(BASE + 5.6, BASE + 6.2, BASE + 6.35, BASE + 7.15), UBEAM=(BASE + 5.6, BASE + 6.2, BASE + 6.35, BASE + 7.15), OVERHANG=3.0,
    LOWER=None, UPPER=dict(A=13.0, D=13.0, z=BASE + 6.65, H=7.4, p=1.6, o=0.9, lift=0.9, Lc=6.0, Vc=3.5),
    GABLE_X=3.0, PITCH=0.46, AMP=0.09, TRIM=0.0, RIDGE="tile", KIND="cuanjian", ROWS=8, BRACKET_GAP=1.8)
BAOHE = SimpleNamespace(
    XS=[-23.5, -18.7, -13.9, -9.1, -4.4, 4.4, 9.1, 13.9, 18.7, 23.5], YS=[-11.5, -7.3, -3.2, 3.2, 7.3, 11.5],
    OX=23.5, OY=11.5, IX=18.7, IY=7.3, BEAM=(BASE + 6.2, BASE + 7.0, BASE + 7.2, BASE + 8.2), UBEAM=(20.4, 21.1, 21.3, 22.3), OVERHANG=3.8,
    LOWER=dict(A=27.3, D=15.3, z=BASE + 7.6, H=3.0, p=1.3, o=1.0, lift=0.9, Lc=8.0, Vc=4.5),
    UPPER=dict(A=22.5, D=11.1, z=21.8, H=6.0, p=1.6, o=1.0, lift=0.95, Lc=7.5, Vc=4.2),
    GABLE_X=17.2, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=8, END_ROWS=4, LOWER_ROWS=5, BRACKET_GAP=1.7)
BAOHE_UP0 = 18.2


def rail_image(w=512, h=128):
    """A marble balustrade panel, 2 m a repeat: frame, a pierced vase-and-cloud (寻杖) opening, a dado."""
    cv = Canvas(w, h, "#ebe7dd")
    cv.noise(0.05, 3)
    dark = "#b9b3a6"
    cv.rect(0, h * 0.12, w, h * 0.16, dark)            # the rail's shadow line
    for i in range(2):
        x0 = i * w / 2
        cv.frame(x0 + 14, h * 0.24, x0 + w / 2 - 14, h * 0.86, 3, dark)
        cv.ellipse(x0 + w / 4, h * 0.45, w * 0.13, h * 0.13, "#d2ccc0")
        cv.rect(x0 + w / 4 - 6, h * 0.58, x0 + w / 4 + 6, h * 0.8, "#d6d0c4")
    return image("TH_Rail", np.flipud(cv.a).copy())


def relief_images(w=256, h=512):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    H = np.zeros((h, w), np.float32)
    for k in range(12):
        cy, cx = (k + 0.5) * h / 12, w / 2 + 55 * math.sin(k * 1.3)
        r = np.hypot(x - cx, y - cy)
        H = np.maximum(H, np.clip(1 - r / 40, 0, 1) * (0.6 + 0.4 * np.sin(np.arctan2(y - cy, x - cx) * 3 + r / 5)))
    H = np.maximum(H, (np.abs(x - (w / 2 + 75 * np.sin(y / 55))) < 15) * 0.8)
    H[:, :10] = H[:, -10:] = 1.0
    dv, du = np.gradient(np.flipud(H))
    n = np.stack([-du * 4, -dv * 4, np.ones_like(H)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return image("TH_ReliefN", n * 0.5 + 0.5), image("TH_ReliefC", srgb("#ece8de") * (0.82 + 0.2 * np.flipud(H)[..., None]))


def materials():
    atlas, night = paint_atlas("TH", portrait=False, emblem=False)
    rn, rc = relief_images()
    return dict(
        atlas=material("TH_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("TH_Plaster", "#a8321f", 0.85, tex=plaster(name="TH_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        marble=material("TH_Marble", "#e9e5dc", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        rail=material("TH_RailPanel", "#ebe7dd", 0.5, tex=rail_image(), props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("TH_Paving", "#b3aea3", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        relief=material("TH_Relief", "#ece8de", 0.5, tex=rc, normal_tex=rn, props={"wet": "damp", "glowStrength": 0.5}),
        tile=material("TH_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        red=material("TH_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("TH_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("TH_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
    )


TILE = dict(plaster=4.0, marble=2.0, paving=4.0, tile=2.0, red=2.0, gold=1.0, paint=1.0)


def in_flight(x, y, k, pad=0.8):
    """Whether (x, y) on tier k's edge falls in a flight's opening."""
    d = k * STEP
    for side, w, _, c, e in FLIGHTS:
        if side in ("S", "N"):
            edge = e + (d if side == "S" else -d)
            if abs(x - c) < w / 2 + pad and abs(y - edge) < 2.0:
                return True
        else:
            edge = e + (-d if side == "E" else d)
            if abs(y - c) < w / 2 + pad and abs(x - edge) < 2.0:
                return True
    return False


def terrace(g):
    """The three tiers: a moulded marble face, the paved top, the balustrade round the edge (panels a textured
    strip, posts boxes), open where the flights come up."""
    for k in range(3):
        poly = inset_poly(T1, k * STEP)
        z0, z1 = k * TH, (k + 1) * TH
        lip = inset_poly(poly, -0.18)
        loft(g, [(z0, poly), (z1 - 0.3, poly)], "marble", smooth=False)
        loft(g, [(z1 - 0.3, lip), (z1, lip)], "marble", smooth=False)
        g.polyn([(x, y, z1 - 0.3) for x, y in lip], "marble", (0, 0, -1))
        g.polyn([(x, y, z1) for x, y in lip], "paving", (0, 0, 1))
        rail = inset_poly(poly, 0.4)
        for i in range(len(rail)):
            a, b = rail[i], rail[(i + 1) % len(rail)]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, round(L / 2.0))
            ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            nx, ny = uy, -ux
            for j in range(n):
                p0 = (a[0] + ux * L * j / n, a[1] + uy * L * j / n)
                p1 = (a[0] + ux * L * (j + 1) / n, a[1] + uy * L * (j + 1) / n)
                mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                if in_flight(mid[0], mid[1], k):
                    continue
                for sgn in (1, -1):
                    q0 = (p0[0] + nx * 0.09 * sgn, p0[1] + ny * 0.09 * sgn)
                    q1 = (p1[0] + nx * 0.09 * sgn, p1[1] + ny * 0.09 * sgn)
                    g.polyn([(*q0, z1), (*q1, z1), (*q1, z1 + 1.05), (*q0, z1 + 1.05)], "rail", (nx * sgn, ny * sgn, 0), uvs=[(0, 0), (0.5, 0), (0.5, 1), (0, 1)])
                g.polyn([(p0[0] + nx * 0.1, p0[1] + ny * 0.1, z1 + 1.05), (p1[0] + nx * 0.1, p1[1] + ny * 0.1, z1 + 1.05),
                         (p1[0] - nx * 0.1, p1[1] - ny * 0.1, z1 + 1.05), (p0[0] - nx * 0.1, p0[1] - ny * 0.1, z1 + 1.05)], "marble", (0, 0, 1))
                for p in (p0, p1):
                    g.box(p[0] - 0.14, p[0] + 0.14, p[1] - 0.14, p[1] + 0.14, z1, z1 + 1.35, "marble", skip=("-z",))


def flights(g, coll_ramps):
    """Flights from each tier down to the level below; returns the ramp hulls' points."""
    ramps = []
    for k in range(3):
        d = k * STEP
        z0, z1 = k * TH, (k + 1) * TH
        n = round(TH / RISE)
        L = RUN * n
        for side, w, yulu, c, e in FLIGHTS:
            if side == "S":
                edge, out, along = e + d, (0, -1), lambda a, x: (c + x, a)
            elif side == "N":
                edge, out, along = e - d, (0, 1), lambda a, x: (c + x, a)
            elif side == "E":
                edge, out, along = e - d, (1, 0), lambda a, x: (a, c + x)
            else:
                edge, out, along = e + d, (-1, 0), lambda a, x: (a, c + x)
            s = out[0] + out[1]                     # +1 or -1 along the axis
            P = lambda t, x, z: (*along(edge + s * t, x), z)       # noqa: E731
            for i in range(n):
                t0, t1 = RUN * (n - i - 1), RUN * (n - i)
                z = z0 + TH * (i + 1) / n
                zb = z0 + TH * i / n
                for xa, xb in ([(-w / 2, -yulu / 2), (yulu / 2, w / 2)] if yulu else [(-w / 2, w / 2)]):
                    g.polyn([P(t0, xa, z), P(t0, xb, z), P(t1, xb, z), P(t1, xa, z)], "marble", (0, 0, 1))
                    g.polyn([P(t1, xa, zb), P(t1, xb, zb), P(t1, xb, z), P(t1, xa, z)], "marble", (out[0], out[1], 0))
            for sx in (-1, 1):
                xa, xb = sorted((sx * w / 2, sx * (w / 2 + 0.5)))
                for x, nrm in ((xa, -1), (xb, 1)):
                    side_n = (0 if out[0] else nrm, nrm if out[0] else 0, 0)
                    g.polyn([P(0, x, z1 + 0.1), P(L, x, z0 + 0.1), P(L, x, z0), P(0, x, z0)], "marble", side_n)
                g.polyn([P(0, xa, z1 + 0.1), P(0, xb, z1 + 0.1), P(L, xb, z0 + 0.1), P(L, xa, z0 + 0.1)], "marble", (out[0] * 0.3, out[1] * 0.3, 1))
            if yulu:
                g.polyn([P(0, -yulu / 2, z1 + 0.02), P(0, yulu / 2, z1 + 0.02), P(L, yulu / 2, z0 + 0.02), P(L, -yulu / 2, z0 + 0.02)], "relief", (out[0] * 0.3, out[1] * 0.3, 1),
                        uvs=[(0, 1), (1, 1), (1, 0), (0, 0)])
            hw = w / 2 + 0.5
            ramps.append([P(0, -hw, z1), P(0, hw, z1), P(L, -hw, z0), P(L, hw, z0), P(0, -hw, z0), P(0, hw, z0)])
    return ramps


def sumeru(g, hw, hd, cy):
    for za, zc, o in ((TOP, TOP + 0.15, 0.25), (TOP + 0.15, BASE - 0.15, 0.0), (BASE - 0.15, BASE, 0.2)):
        g.box(-hw - o, hw + o, cy - hd - o, cy + hd + o, za, zc, "marble", skip=("-z", "+z"))
    g.polyn([(-hw - 0.2, cy - hd - 0.2, BASE), (hw + 0.2, cy - hd - 0.2, BASE), (hw + 0.2, cy + hd + 0.2, BASE), (-hw - 0.2, cy + hd + 0.2, BASE)], "paving", (0, 0, 1))
    for s in (-1, 1):
        for k in range(3):
            y0, y1 = cy + s * (hd + 0.2), cy + s * (hd + 0.2 + (3 - k) * 0.32)
            g.box(-4.0, 4.0, min(y0, y1), max(y0, y1), TOP, TOP + (k + 1) * 0.2, "marble")


def hall_walls(g, H, up0, doors_mid=3):
    """Walls on the inner ring: doors in the middle bays front and back, lattice windows, plaster at the ends."""
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            front = rot in (0, 2)
            mid = abs(i - (len(us) - 2) / 2) <= doors_mid / 2
            reg = ("door" if mid else "window") if front else None
            q = [P(us[i], BASE), P(us[i + 1], BASE), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if reg:
                g.polyn(q, "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            else:
                g.polyn(q, "plaster", cdir(rot, 0, -1))
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)         # noqa: E731
            g.polyn([Q(us[i], H.BEAM[0]), Q(us[i + 1], H.BEAM[0]), Q(us[i + 1], H.BEAM[1]), Q(us[i], H.BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            if up0 is not None:
                g.polyn([P(us[i], up0), P(us[i + 1], up0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, g, True, *H.BEAM)
    if up0 is not None:
        ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        g.polyn([(x0, y0, H.BEAM[1]), (x1, y0, H.BEAM[1]), (x1, y1, H.BEAM[1]), (x0, y1, H.BEAM[1])], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    return roofs(H, g)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("三大殿")
    g = Geo()
    terrace(g)
    ramps = flights(g, None)
    sumeru(g, 33.6, 19.6, 0.0)
    sumeru(g, 13.5, 13.5, Y_ZH)
    sumeru(g, 27.0, 14.0, Y_BH)
    g.build("Terrace", collection("三台", main), M, TILE)
    tris = g.tris()

    halls = []
    h = Geo()
    halls.append((TAIHE, TAIHE_UP0, 0.0, hall_walls(h, TAIHE, TAIHE_UP0, 5), 10))
    hz = Geo()
    halls.append((ZHONGHE, None, Y_ZH, hall_walls(hz, ZHONGHE, None, 1), 5))
    hb = Geo()
    halls.append((BAOHE, BAOHE_UP0, Y_BH, hall_walls(hb, BAOHE, BAOHE_UP0, 3), 9))
    hg = Geo()
    hg.add(h, T(0, 0, 0))
    hg.add(hz, T(0, Y_ZH, 0))
    hg.add(hb, T(0, Y_BH, 0))
    # 中和殿's finial
    from round import finial
    fg = Geo()
    finial(fg, ZHONGHE.UPPER["z"] + ZHONGHE.UPPER["H"] + 0.1, 2.6, r=0.55)
    hg.add(fg, T(0, Y_ZH, 0))
    hg.build("Halls", collection("殿", main), M, TILE)
    tris += hg.tris()

    parts = collection("构件", main)
    mesh = dict(
        bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(lite=True), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True), "ImmortalMesh", M, TILE),
    )
    n = 0
    nb = 0
    for H, up0, cy, hips, beasts in halls:
        m = T(0, cy, 0)
        col = mesh_of(column_geo(H.BEAM[0] - BASE, r=0.5), f"Column{n}", M, TILE)
        ucol = mesh_of(column_geo(H.UBEAM[0] - up0 + 0.6, r=0.44), f"UpperColumn{n}", M, TILE) if up0 else None
        for outer in (True, False):
            for rot, D, us in ring_sides(H, outer):
                for u in us[1:]:
                    place(col, f"Column.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, BASE)))
                    if not outer and ucol:
                        place(ucol, f"UpperColumn.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, up0 - 0.6)))
                    n += 1
        spots = bracket_spots(H, True, H.BEAM[2]) + (bracket_spots(H, False, H.UBEAM[2]) if up0 else [])
        for i, (p, yaw) in enumerate(spots):
            place(mesh["bracket"], f"Bracket.{nb:04d}", parts, m @ T(*p) @ Rz(yaw))
            nb += 1
        nl = len(hips)
        for i, line in enumerate(hips):
            upper = i >= nl - 4
            beasts_on([m @ p for p in line], parts, mesh, f"Beast{cy:.0f}.{i}", n=beasts if upper else max(3, beasts - 3))

    far = Geo()
    for k in range(3):
        poly = inset_poly(T1, k * STEP)
        loft(far, [(k * TH, poly), ((k + 1) * TH, poly)], "marble", smooth=False)
        far.polyn([(x, y, (k + 1) * TH) for x, y in poly], "paving", (0, 0, 1))
    for H, up0, cy, hips, _ in halls:
        fh = Geo()
        fh.box(-H.OX, H.OX, -H.OY, H.OY, TOP, (H.LOWER or H.UPPER)["z"] + 0.4, "plaster", skip=("-z",))
        if H.LOWER:
            fh.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "plaster", skip=("-z",))
        roofs(H, fh, lod=True)
        far.add(fh, T(0, cy, 0))
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    for k in range(3):
        d, z1 = k * STEP, (k + 1) * TH
        collider_box(helpers, f"south{k}", -66 + d, 66 - d, -50 + d, 36 - d, 0.0, z1)
        collider_box(helpers, f"neck{k}", -44 + d, 44 - d, 36 - d, 94 + d, 0.0, z1)
        collider_box(helpers, f"north{k}", -58 + d, 58 - d, 94 + d, 156 - d, 0.0, z1)
    for i, pts in enumerate(ramps):
        collider_pts(helpers, f"flight{i}", pts, role="WALK")
    collider_box(helpers, "taihe", -TAIHE.OX, TAIHE.OX, -TAIHE.OY, TAIHE.OY, TOP, 32.0)
    collider_box(helpers, "zhonghe", -ZHONGHE.OX, ZHONGHE.OX, Y_ZH - ZHONGHE.OY, Y_ZH + ZHONGHE.OY, TOP, 22.0)
    collider_box(helpers, "baohe", -BAOHE.OX, BAOHE.OX, Y_BH - BAOHE.OY, Y_BH + BAOHE.OY, TOP, 27.0)
    flat_marker(helpers, "taihedian", inset_poly(T1, 1.0), "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "taihedian", "太和殿", "Hall of Supreme Harmony"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.915896", "116.390814", -1.52
    s.far_distance = 450
    s.repo_path = REPO
    return dict(tris=tris, brackets=nb)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
