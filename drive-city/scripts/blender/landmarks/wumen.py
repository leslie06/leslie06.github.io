# 故宫午门 Meridian Gate (五凤楼), built in Blender with the timber halls of hall.py and marked with the
# bcity_landmark add-on's conventions. It replaces the kit-built wumen.ts.
#
#   blender -b -P scripts/blender/landmarks/wumen.py -- [--out art/landmarks/wumen.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the old anchor (39.912119 N, 116.390993 E,
# heading -1.49, the palace's axis): the open side of the U faces south, to 端门 and Tiananmen.
#
# The plan is OSM way 638156366's, squared: a red platform 12 m high on a marble base, battered, its back
# 124.8 x 28.7 m across the axis with three vaulted gateways through it (0 and +-14 m), the wings 22.8 m wide
# reaching 80 m south (OSM's outline also takes in the grey stone ramps (马道) up to the back at either
# end: those are its own building parts, drawn by the city as before). On the back, on a marble terrace, the 9 x 5 bay main hall under a
# double-eaved 庑殿 roof (37.8 m); a square pavilion (阙亭) with double pyramidal 攒尖 roofs at each end of
# both wings; between them the thirteen-bay galleries (雁翅楼) under single 歇山 roofs, facing the court.
# All roofs yellow glazed tiles.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import (QUAD, Geo, T, Rz, balustrade, collider_box, coping, flat_marker, mesh_of, panel_geo, paving,  # noqa: E402
                 place, post_geo, rect)
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, to_world, uvs)
from tower import ccw, inset_poly  # noqa: E402

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "wumen.blend")

PH, BATTER, BASE = 12.0, 0.8, 1.5            # platform height, batter, marble base course
BACK = dict(x0=-62.4, x1=62.4, y0=26.7, y1=55.4)
WING = dict(x0=39.6, x1=62.4, y0=-53.0)       # east wing (the west mirrors it)
ARCHES = [(0.0, 5.8, 9.2), (-14.0, 4.8, 8.2), (14.0, 4.8, 8.2)]      # x, width, crown
OUTLINE = ccw([(-62.4, -53.0), (-39.6, -53.0), (-39.6, 26.7), (39.6, 26.7), (39.6, -53.0), (62.4, -53.0), (62.4, 55.4), (-62.4, 55.4)])
HALL_Y = (BACK["y0"] + BACK["y1"]) / 2

# the main hall: nine bays by five, double eaves, 庑殿
MAIN = SimpleNamespace(
    XS=[-30.0, -24.6, -18.4, -12.0, -5.3, 5.3, 12.0, 18.4, 24.6, 30.0], YS=[-11.0, -5.8, -2.1, 2.1, 5.8, 11.0],
    OX=30.0, OY=11.0, IX=24.6, IY=5.8, BEAM=(19.8, 20.55, 20.75, 21.65), UBEAM=(25.6, 26.35, 26.55, 27.45), OVERHANG=4.2,
    LOWER=dict(A=34.2, D=15.2, z=21.0, H=3.0, p=1.3, o=1.1, lift=1.0, Lc=9.0, Vc=5.0),
    UPPER=dict(A=28.8, D=10.0, z=26.6, H=8.0, p=1.6, o=1.0, lift=0.95, Lc=8.0, Vc=4.5),
    GABLE_X=23.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=10, LOWER_ROWS=6, BRACKET_GAP=1.6)
MAIN_BASE, MAIN_UP0 = PH + 1.0, 23.4
# the pavilions: three bays square, double 攒尖 eaves
PAV = SimpleNamespace(
    XS=[-7.2, -5.2, -1.8, 1.8, 5.2, 7.2], YS=[-7.2, -5.2, -1.8, 1.8, 5.2, 7.2], OX=7.2, OY=7.2, IX=5.2, IY=5.2,
    BEAM=(17.4, 18.05, 18.2, 19.0), UBEAM=(21.6, 22.2, 22.35, 23.1), OVERHANG=2.6,
    LOWER=dict(A=9.8, D=9.8, z=18.6, H=2.0, p=1.3, o=0.8, lift=0.7, Lc=5.0, Vc=3.0),
    UPPER=dict(A=8.0, D=8.0, z=22.7, H=6.8, p=1.6, o=0.8, lift=0.8, Lc=5.0, Vc=3.0),
    GABLE_X=4.0, PITCH=0.5, AMP=0.09, TRIM=0.0, RIDGE="tile", KIND="cuanjian", ROWS=6, LOWER_ROWS=4, BRACKET_GAP=2.6)
PAV_BASE, PAV_UP0 = PH + 0.8, 20.3
PAV_AT = [(sx * 51.0, y) for sx in (-1, 1) for y in (HALL_Y, WING["y0"] + BATTER + 11.0)]
# the galleries: thirteen bays, one ring, single 歇山, built along x and turned to run north-south
GAL = SimpleNamespace(
    XS=[-28.6 + 4.4 * i for i in range(14)], YS=[-4.2, 4.2], OX=28.6, OY=4.2, IX=28.6, IY=4.2,
    BEAM=(16.9, 17.5, 17.65, 18.4), UBEAM=(16.9, 17.5, 17.65, 18.4), OVERHANG=1.9, LOWER=None,
    UPPER=dict(A=30.5, D=6.1, z=18.0, H=3.2, p=1.5, o=0.7, lift=0.6, Lc=5.0, Vc=3.0),
    GABLE_X=27.0, PITCH=0.5, AMP=0.09, TRIM=0.0, RIDGE="tile", ROWS=6, END_ROWS=4, BRACKET_GAP=3.3)
GAL_BASE = PH + 0.6
GAL_Y = (PAV_AT[0][1] - 9.6 + PAV_AT[1][1] + 9.6) / 2


def materials():
    atlas, night = paint_atlas("WM", portrait=False, emblem=False)
    return dict(
        atlas=material("WM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("WM_Plaster", "#a8321f", 0.85, tex=plaster(name="WM_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        marble=material("WM_Marble", "#e6e2d8", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("WM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
        tile=material("WM_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        red=material("WM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("WM_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("WM_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material("WM_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
    )


TILE = dict(plaster=4.0, marble=2.0, paving=4.0, tile=2.0, red=2.0, gold=1.0, paint=1.0, dark=1.0)


# --- the platform ------------------------------------------------------------------------------------

def arch_pts(xc, w, crown, segs=14):
    r = w / 2
    spring = crown - r
    return [(xc + r * math.cos(math.pi * (1 - i / segs)), spring + r * math.sin(math.pi * (1 - i / segs))) for i in range(segs + 1)]


def platform(g):
    """The U: a marble base course, battered red walls (open where the gateways go through), the paved top."""
    base = OUTLINE
    top = inset_poly(base, BATTER)
    out = inset_poly(base, -0.45)
    n = len(base)
    for i in range(n):
        a, b = Vector((*base[i], 0)), Vector((*base[(i + 1) % n], 0))
        at, bt = Vector((*top[i], 0)), Vector((*top[(i + 1) % n], 0))
        ao, bo = Vector((*out[i], 0)), Vector((*out[(i + 1) % n], 0))
        L = (b - a).length
        u = (b - a) / L
        nin = Vector((-u.y, u.x, 0))
        # gateways on this edge: the back's south face (y = y0) and its north face (y = y1)
        gates = []
        if abs(a.y - BACK["y0"]) < 1e-3 and abs(b.y - BACK["y0"]) < 1e-3:
            gates = sorted(((x - a.x) * u.x, w, c) for x, w, c in ARCHES)
        if abs(a.y - BACK["y1"]) < 1e-3 and abs(b.y - BACK["y1"]) < 1e-3:
            gates = sorted(((x - a.x) * u.x, w, c) for x, w, c in ARCHES)
        # the marble base course, stopped at the gateways
        segs, s0 = [], 0.0
        for s, w, c in gates:
            segs.append((s0, s - w / 2))
            s0 = s + w / 2
        segs.append((s0, L))
        up = Vector((0, 0, BASE))

        def outer(s):
            return ao if s <= 0 else (bo if s >= L else a + u * s - nin * 0.45)

        def wall(s):
            return a + u * min(max(s, 0.0), L)
        for p, q in segs:
            g.polyn([outer(p), outer(q), outer(q) + up, outer(p) + up], "marble", (-nin.x, -nin.y, 0))
            g.polyn([outer(p) + up, outer(q) + up, wall(q) + up, wall(p) + up], "marble", (0, 0, 1))
            if p > 0:
                g.polyn([outer(p), wall(p), wall(p) + up, outer(p) + up], "marble", (-u.x, -u.y, 0))
            if q < L:
                g.polyn([outer(q), wall(q), wall(q) + up, outer(q) + up], "marble", (u.x, u.y, 0))
        # the battered wall from the base course to the top: piers between the gateways, spandrels over them

        def P(s, z):
            t = (z - BASE) / (PH - BASE)
            ends_a = a.lerp(at, t)
            ends_b = b.lerp(bt, t)
            if s <= 0:
                return Vector((ends_a.x, ends_a.y, z))
            if s >= L:
                return Vector((ends_b.x, ends_b.y, z))
            p = a + u * s + nin * (BATTER * t)
            return Vector((p.x, p.y, z))
        want = (-nin.x, -nin.y, 0)
        s0 = 0.0
        for s, w, c in gates:
            g.polyn([P(s0, BASE), P(s - w / 2, BASE), P(s - w / 2, PH), P(s0, PH)], "plaster", want)
            # the gateway's jambs from the ground through the base course
            arc = arch_pts(s, w, c)
            g.polyn([P(x, z) for x, z in arc] + [P(s + w / 2, PH), P(s - w / 2, PH)], "plaster", want)
            g.polyn([P(s - w / 2, 0.0), P(s - w / 2, BASE), P(s - w / 2 - 0.01, BASE)], "plaster", want)
            s0 = s + w / 2
        g.polyn([P(s0, BASE), P(L, BASE), P(L, PH), P(s0, PH)], "plaster", want)
    # the paved top (the outline inset by the batter), a little parapet round it with a yellow coping
    g.polyn([(x, y, PH) for x, y in top], "paving", (0, 0, 1))
    par = inset_poly(top, 0.8)
    for i in range(len(top)):
        a, b = top[i], top[(i + 1) % len(top)]
        c, d = par[i], par[(i + 1) % len(top)]
        g.polyn([(a[0], a[1], PH), (b[0], b[1], PH), (b[0], b[1], PH + 1.1), (a[0], a[1], PH + 1.1)], "plaster", (b[1] - a[1], -(b[0] - a[0]), 0))
        g.polyn([(d[0], d[1], PH), (c[0], c[1], PH), (c[0], c[1], PH + 1.1), (d[0], d[1], PH + 1.1)], "plaster", (-(b[1] - a[1]), b[0] - a[0], 0))
        coping(g, ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2), ((b[0] + d[0]) / 2, (b[1] + d[1]) / 2), 1.2, PH + 1.1, key="tile")
    # the gateways right through the back: the vault, and the doors folded back a third of the way in
    for x, w, c in ARCHES:
        r = w / 2
        spring = c - r
        sec = [(x - r, 0.0)] + arch_pts(x, w, c) + [(x + r, 0.0)]
        ys = lambda z: BACK["y0"] + BATTER * max(0.0, z - BASE) / (PH - BASE)       # noqa: E731
        yn = lambda z: BACK["y1"] - BATTER * max(0.0, z - BASE) / (PH - BASE)       # noqa: E731
        for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            g.polyn([(x0, ys(z0), z0), (x1, ys(z1), z1), (x1, yn(z1), z1), (x0, yn(z0), z0)], "plaster",
                    (x - mx, 0, spring - mz if mz > spring else 0), smooth=z0 > spring - 1e-3 and z1 > spring - 1e-3)
        yd = BACK["y0"] + 9.0
        for sx in (-1, 1):
            xx = x + sx * (r - 0.07)
            g.polyn([(xx, yd, 0.02), (xx, yd + r, 0.02), (xx, yd + r, spring), (xx, yd, spring)], "atlas", (-sx, 0, 0), uvs=uvs("gatedoor", QUAD))


# --- the halls ----------------------------------------------------------------------------------------

def ceiling(g, x0, x1, y0, y1, z):
    nx, ny = max(1, round((x1 - x0) / 1.3)), max(1, round((y1 - y0) / 1.3))
    for i in range(nx):
        for j in range(ny):
            a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            b0, b1 = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
            g.polyn([(a0, b0, z), (a1, b0, z), (a1, b1, z), (a0, b1, z)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))


def terrace(g, hw, hd, z0, z1, steps=None):
    """A marble terrace under a hall, with a flight down the front (and back) when `steps` gives its width."""
    for za, zc, out in ((z0, z0 + 0.2, 0.25), (z0 + 0.2, z1 - 0.15, 0.0), (z1 - 0.15, z1, 0.2)):
        g.box(-hw - out, hw + out, -hd - out, hd + out, za, zc, "marble", skip=("-z", "+z"))
    g.polyn([(-hw - 0.2, -hd - 0.2, z1), (hw + 0.2, -hd - 0.2, z1), (hw + 0.2, hd + 0.2, z1), (-hw - 0.2, hd + 0.2, z1)], "paving", (0, 0, 1))
    if steps:
        n = max(2, round((z1 - z0) / 0.16))
        for s in (-1, 1):
            for k in range(n):
                y0, y1 = s * (hd + 0.2), s * (hd + 0.2 + (n - k) * 0.32)
                g.box(-steps / 2, steps / 2, min(y0, y1), max(y0, y1), z0, z0 + (k + 1) * (z1 - z0) / n, "marble", skip=("-z",))


def main_hall(g):
    H, z0 = MAIN, MAIN_BASE
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            front = rot in (0, 2)
            reg = ("door" if 2 <= i <= len(us) - 4 else "window") if front else None
            quad = [P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if reg:
                g.polyn(quad, "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            else:
                g.polyn(quad, "plaster", cdir(rot, 0, -1))
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)        # noqa: E731
            g.polyn([Q(us[i], H.BEAM[0]), Q(us[i + 1], H.BEAM[0]), Q(us[i + 1], H.BEAM[1]), Q(us[i], H.BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            g.polyn([P(us[i], MAIN_UP0), P(us[i + 1], MAIN_UP0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, g, True, *H.BEAM)
    ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        ceiling(g, x0, x1, y0, y1, H.BEAM[1])
    return roofs(H, g)


def pavilion(g):
    H, z0 = PAV, PAV_BASE
    for rot, D, us in ring_sides(H, False):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            reg = "door" if i == 1 else "window"
            g.polyn([P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            g.polyn([P(us[i], PAV_UP0), P(us[i + 1], PAV_UP0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, g, True, *H.BEAM)
    ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        ceiling(g, x0, x1, y0, y1, H.BEAM[1])
    return roofs(H, g)


def gallery(g):
    """In its own frame: along x, the court side to -y. Lattice on the court side, plaster behind and at the ends."""
    H, z0 = GAL, GAL_BASE
    for rot, D, us in ring_sides(H, True):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.35, z)          # noqa: E731
            quad = [P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if rot == 0:
                g.polyn(quad, "atlas", cdir(rot, 0, -1), uvs=uvs("door" if i % 4 == 2 else "window", QUAD))
            else:
                g.polyn(quad, "plaster", cdir(rot, 0, -1))
    ring_beams(H, g, True, *H.BEAM)
    return roofs(H, g)


def place_rings(H, parts, mesh, m, z0, col_top, up0, n0, outer_only=False):
    """Columns on both rings (the upper ones on the inner ring), brackets on both bands, under matrix m."""
    col = mesh[("col", H.__dict__.get("KIND", ""), col_top - z0)]
    n = n0
    for outer in ((True,) if outer_only else (True, False)):
        for rot, D, us in ring_sides(H, outer):
            for u in us[1:]:
                place(col, f"Column.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, z0)))
                if not outer and up0 is not None:
                    place(mesh[("ucol", up0, H.UBEAM[0])], f"UpperColumn.{n:04d}", parts, m @ T(*to_world(rot, D, u, 0, up0 - 0.6)))
                n += 1
    spots = bracket_spots(H, True, H.BEAM[2]) + ([] if outer_only else bracket_spots(H, False, H.UBEAM[2]))
    for i, (p, yaw) in enumerate(spots):
        place(mesh["bracket"], f"Bracket.{n0:04d}.{i:03d}", parts, m @ T(*p) @ Rz(yaw))
    return n, len(spots)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("午门")
    stats = {}
    g = Geo()
    platform(g)
    g.build("Platform", collection("城台", main), M, TILE)
    stats["platform"] = g.tris()

    # the halls, each built in its own frame and moved into place
    g = Geo()
    hips_all = []
    hg = Geo()
    terrace(hg, 33.0, 12.6, PH, MAIN_BASE, steps=6.0)
    hips = main_hall(hg)
    mh = T(0, HALL_Y, 0)
    g.add(hg, mh)
    hips_all += [([mh @ p for p in line], 7) for line in hips]
    pg = Geo()
    terrace(pg, 9.6, 9.6, PH, PAV_BASE)
    phips = pavilion(pg)
    for x, y in PAV_AT:
        m = T(x, y, 0)
        g.add(pg, m)
        hips_all += [([m @ p for p in line], 3) for line in phips]
    gg = Geo()
    terrace(gg, 30.5, 5.6, PH, GAL_BASE)
    ghips = gallery(gg)
    gal_m = []
    for sx in (-1, 1):
        # east wing: the court side (-y in its frame) turned to face west; the west wing mirrors it
        m = T(sx * 52.5, GAL_Y, 0) @ Rz(-sx * math.pi / 2)
        gal_m.append(m)
        g.add(gg, m)
        hips_all += [([m @ p for p in line], 3) for line in ghips]
    stats["main"], stats["pavilion"], stats["gallery"] = hg.tris(), pg.tris(), gg.tris()
    g.build("Halls", collection("殿", main), M, TILE)
    stats["halls"] = g.tris()

    parts = collection("构件", main)
    mesh = {
        ("col", "wudian", MAIN.BEAM[0] - MAIN_BASE): mesh_of(column_geo(MAIN.BEAM[0] - MAIN_BASE, r=0.5), "MainColumn", M, TILE),
        ("ucol", MAIN_UP0, MAIN.UBEAM[0]): mesh_of(column_geo(MAIN.UBEAM[0] - MAIN_UP0 + 0.6, r=0.44), "MainUpperColumn", M, TILE),
        ("col", "cuanjian", PAV.BEAM[0] - PAV_BASE): mesh_of(column_geo(PAV.BEAM[0] - PAV_BASE, r=0.4), "PavColumn", M, TILE),
        ("ucol", PAV_UP0, PAV.UBEAM[0]): mesh_of(column_geo(PAV.UBEAM[0] - PAV_UP0 + 0.6, r=0.34), "PavUpperColumn", M, TILE),
        ("col", "", GAL.BEAM[0] - GAL_BASE): mesh_of(column_geo(GAL.BEAM[0] - GAL_BASE, r=0.34), "GalColumn", M, TILE),
        "bracket": mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        "beast": mesh_of(beast_geo(), "BeastMesh", M, TILE),
        "immortal": mesh_of(beast_geo(True), "ImmortalMesh", M, TILE),
        "post": mesh_of(post_geo(), "PostMesh", M, TILE),
        "panel": mesh_of(panel_geo(), "PanelMesh", M, TILE),
    }
    n, nb = place_rings(MAIN, parts, mesh, T(0, HALL_Y, 0), MAIN_BASE, MAIN.BEAM[0], MAIN_UP0, 0)
    brackets = nb
    for x, y in PAV_AT:
        n, nb = place_rings(PAV, parts, mesh, T(x, y, 0), PAV_BASE, PAV.BEAM[0], PAV_UP0, n)
        brackets += nb
    for m in gal_m:
        n, nb = place_rings(GAL, parts, mesh, m, GAL_BASE, GAL.BEAM[0], None, n, outer_only=True)
        brackets += nb
    for i, (line, k) in enumerate(hips_all):
        beasts_on(line, parts, mesh, f"Beast{i}", n=k)
    # the main hall's terrace balustrade, open at its flights
    X, Y = 33.1, 12.7
    ring = [(-X, HALL_Y - Y, MAIN_BASE), (X, HALL_Y - Y, MAIN_BASE), (X, HALL_Y + Y, MAIN_BASE), (-X, HALL_Y + Y, MAIN_BASE), (-X, HALL_Y - Y, MAIN_BASE)]
    balustrade(parts, mesh, ring, "TerraceRail", gap=1.9, skip=[(-3.3, 3.3, HALL_Y - Y - 1, HALL_Y - Y + 1), (-3.3, 3.3, HALL_Y + Y - 1, HALL_Y + Y + 1)])
    stats["brackets"] = brackets

    # the far level: the platform as blocks, the halls as boxes under their roofs
    far = Geo()
    far_top = inset_poly(OUTLINE, BATTER)
    for i in range(len(OUTLINE)):
        a, b = OUTLINE[i], OUTLINE[(i + 1) % len(OUTLINE)]
        c, d = far_top[i], far_top[(i + 1) % len(OUTLINE)]
        far.polyn([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (d[0], d[1], PH), (c[0], c[1], PH)], "plaster", (b[1] - a[1], -(b[0] - a[0]), 0))
    far.polyn([(x, y, PH) for x, y in far_top], "paving", (0, 0, 1))
    fh = Geo()
    fh.box(-MAIN.OX, MAIN.OX, -MAIN.OY, MAIN.OY, PH, MAIN.LOWER["z"] + 0.4, "plaster", skip=("-z",))
    fh.box(-MAIN.IX, MAIN.IX, -MAIN.IY, MAIN.IY, MAIN.LOWER["z"], MAIN.UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(MAIN, fh, lod=True)
    far.add(fh, T(0, HALL_Y, 0))
    fp = Geo()
    fp.box(-PAV.OX, PAV.OX, -PAV.OY, PAV.OY, PH, PAV.LOWER["z"] + 0.3, "plaster", skip=("-z",))
    fp.box(-PAV.IX, PAV.IX, -PAV.IY, PAV.IY, PAV.LOWER["z"], PAV.UPPER["z"] + 0.4, "plaster", skip=("-z",))
    roofs(PAV, fp, lod=True)
    for x, y in PAV_AT:
        far.add(fp, T(x, y, 0))
    fg = Geo()
    fg.box(-GAL.OX, GAL.OX, -GAL.OY, GAL.OY, PH, GAL.UPPER["z"] + 0.3, "plaster", skip=("-z",))
    roofs(GAL, fg, lod=True)
    for m in gal_m:
        far.add(fg, m)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the back as piers and lintels round the three gateways, the wings, the low walls, the halls
    helpers = collection("碰撞体")
    x0 = BACK["x0"]
    for x, w, c in sorted(ARCHES):
        collider_box(helpers, "pier", x0, x - w / 2, BACK["y0"], BACK["y1"], 0.0, PH + 1.1)
        collider_box(helpers, "lintel", x - w / 2, x + w / 2, BACK["y0"], BACK["y1"], c, PH + 1.1)
        x0 = x + w / 2
    collider_box(helpers, "pier", x0, BACK["x1"], BACK["y0"], BACK["y1"], 0.0, PH + 1.1)
    for sx in (-1, 1):
        a, b = sorted((sx * WING["x0"], sx * WING["x1"]))
        collider_box(helpers, "wing", a, b, WING["y0"], BACK["y0"], 0.0, PH + 1.1)
    collider_box(helpers, "hall", -MAIN.OX, MAIN.OX, HALL_Y - MAIN.OY, HALL_Y + MAIN.OY, PH, 34.0)
    flat_marker(helpers, "wumen", rect(BACK["x0"] - 0.9, BACK["x1"] + 0.9, WING["y0"] - 0.6, BACK["y1"] + 0.6), "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "wumen", "故宫午门", "Meridian Gate"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.912119", "116.390993", -1.49
    s.far_distance = 400          # past 400 m the tile rows are under a pixel: the far level's smooth roofs
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
