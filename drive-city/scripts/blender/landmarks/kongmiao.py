# 北京孔庙和国子监 Confucius Temple and the Imperial Academy, side by side on 国子监街 (孔庙 east, 国子监 west: 左庙右学),
# built in Blender with the timber halls of hall.py and yonghegong.py's helpers, and marked with the bcity_landmark
# add-on's conventions. One landmark, id `kongmiao`.
#
#   blender -b -P scripts/blender/landmarks/kongmiao.py -- [--out art/landmarks/kongmiao.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin at game (880, -4000), heading -0.8 (the halls' outlines in OSM
# lean ~1 degree west of north, the precinct walls ~0.4). Everything is placed from OSM turned into this frame
# (`npx tsx .scratch/lm/lm_local.mts 880 -4000 300 -0.8 .scratch/lm/kongmiao/osm.json`): 孔庙 way 24825402 and
# 国子监 way 30784273 (the precincts), 先师门 1271745599, 大成门 227782228, 大成殿 227782229, 崇圣祠 1271745598,
# the eleven stele pavilions 3714632xx, the L-shaped ranges of side halls 371463316/317/318 and 1271745600,
# 太学门 727050377, the 六堂 727050378 / 371463288, 辟雍 227782231 with its round moat (727050467-470, four
# quarters with land bridges between), the bell and drum pavilions 727049979/80, 彝伦堂's range 371463307.
# 国子监街 (residential, 7 m carriageway) runs along the front at y -77.
#
# Not in OSM, from descriptions: 集贤门 on the street in line with 太学门; the glazed 琉璃牌坊 (三间四柱七楼, yellow
# roofs on green brackets, 圜桥教泽 / 学海节观) between 太学门 and 辟雍; the 198 进士题名碑 in 孔庙's first court;
# the two 国子监 牌楼 (一间二柱三楼, painted, 国子监 on the board) across 国子监街 "near the academy, one each side"
# (east of 孔庙 and west of 国子监: the exact spots are a guess) - the posts on the pavements, the bay open to drive
# through, colliders on the posts only. Doubtful: the tile colours of the side ranges (grey / green here), 辟雍 and
# 大成殿's heights (~21 and ~25 m), 彝伦堂's form (single-eaved 歇山 here).

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, cyl, flat_marker, mesh_of, paving, place, rect  # noqa: E402
import hall  # noqa: E402
from hall import beast_geo, beasts_on, bracket_geo, cdir, paint_atlas, plaster, ring_beams, ring_sides, roofs, to_world, uvs  # noqa: E402
import yonghegong as Y  # noqa: E402  (its accumulators G/FAR/COLS/BRK/HIPS/COLL/BODIES and hall builders)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "kongmiao.blend")

KX = 38.5            # 孔庙's axis
GX = -73.6           # 国子监's axis
FRONT = -70.3        # the street wall's centre line (国子监街's north pavement ends at -71.3, its trees stand at -71.1..-71.5)
STREET = -77.05      # 国子监街's centre line

# tones: the flat roofs come out as ytex (rows) / tile (ridges, verges, eave edges)
TONES = {
    "y": ({}, {}),
    "g": ({"ytex": "gtex", "tile": "grey"}, {"tile": "grey"}),             # plain grey service halls
    "gg": ({"ytex": "gtex", "tile": "green", "trim": "green"}, {"tile": "grey"}),   # 灰瓦绿剪边 (国子监)
    "j": ({"ytex": "jtex", "tile": "green"}, {"tile": "green"}),             # green glaze (the 庑)
}


def tile_tex(name, col):
    return Y.tile_tex(name, col)


def rail_image(w=512, h=128):
    """A marble balustrade panel, 2 m a repeat (taihedian.py's)."""
    cv = Canvas(w, h, "#ebe7dd")
    cv.noise(0.05, 3)
    dark = "#b9b3a6"
    cv.rect(0, h * 0.12, w, h * 0.16, dark)
    for i in range(2):
        x0 = i * w / 2
        cv.frame(x0 + 14, h * 0.24, x0 + w / 2 - 14, h * 0.86, 3, dark)
        cv.ellipse(x0 + w / 4, h * 0.45, w * 0.13, h * 0.13, "#d2ccc0")
        cv.rect(x0 + w / 4 - 6, h * 0.58, x0 + w / 4 + 6, h * 0.8, "#d6d0c4")
    return image("KM_Rail", np.flipud(cv.a).copy())


def materials():
    atlas, night = paint_atlas("KM", portrait=False, emblem=False)
    return dict(
        atlas=material("KM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("KM_Plaster", "#a8321f", 0.85, tex=plaster(name="KM_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        marble=material("KM_Stone", "#dcd7cb", 0.55, props={"wet": "surface", "glowStrength": 0.45}),
        stele=material("KM_Stele", "#8c8a84", 0.6, props={"wet": "surface", "glowStrength": 0.4}),
        rail=material("KM_RailPanel", "#ebe7dd", 0.5, tex=rail_image(), props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("KM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        tile=material("KM_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        ytex=material("KM_TileRows", "#d9a02a", 0.35, tex=tile_tex("KM_TileRowsTex", "#dca52c"), props={"wet": "surface", "glowStrength": 0.55}),
        grey=material("KM_GreyTile", "#5f6163", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
        gtex=material("KM_GreyRows", "#5f6163", 0.55, tex=tile_tex("KM_GreyRowsTex", "#666a6d"), props={"wet": "surface", "glowStrength": 0.5}),
        green=material("KM_Glaze", "#2e7d57", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        jtex=material("KM_GreenRows", "#2e7d57", 0.35, tex=tile_tex("KM_GreenRowsTex", "#2f8058"), props={"wet": "surface", "glowStrength": 0.5}),
        red=material("KM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("KM_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("KM_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        board=material("KM_Board", "#1d3f7a", 0.5, props={"wet": "damp"}),
    )


TILE = dict(plaster=4.0, marble=2.0, stele=1.0, paving=4.0, tile=2.0, grey=2.0, red=2.0, gold=1.0, paint=1.0, green=2.0, board=2.0)


# --- capturing what yonghegong's builders draw, to recolour it -------------------------------------------------

def captured(fn, *a, tone="y", flat=False, wen=None, **kw):
    """Run one of yonghegong's builders into fresh buffers, recolour them by `tone`, add them to the scene's."""
    g0, f0 = Y.G, Y.FAR
    Y.G, Y.FAR = Geo(), Geo()
    Y.FLAT["on"] = flat
    if wen is not None:
        Y.WEN_K["k"] = wen
    try:
        out = fn(*a, **kw)
    finally:
        Y.FLAT["on"] = False
        Y.WEN_K["k"] = 1.0
        g, f = Y.G, Y.FAR
        Y.G, Y.FAR = g0, f0
    keys, fkeys = TONES[tone]
    Y.remap(g, keys)
    Y.remap(f, fkeys)
    g0.add(g, Matrix.Identity(4))
    f0.add(f, Matrix.Identity(4))
    return out


def side(r, facing, zw, tone="g", **kw):
    """A side hall (yonghegong's simple_hall) from its eave rect, in a tone."""
    return captured(Y.simple_hall, r, facing, zw, tone=tone, **kw)


def gate(name, cx, cy, OX, OY, nx, ny, base_z, zb, ov, tone="y", flat=True, beasts=3, wen=0.5, front_steps=4.0, back_steps=4.0, Hk=0.58, rows=6,
         passage=True, front_doors=3, back_doors=3):
    """A single-eaved 歇山 gate or hall on its platform (yonghegong's main_hall), in a tone."""
    trim = tone == "gg" and not flat
    h = Y.spec(OX, OY, Y.lin(OX, nx), Y.lin(OY, ny), zb, ov, rows=rows, end_rows=4, Hk=Hk, big=True)
    h.UPPER["z"] += 0.35          # clear of the 挑檐枋 and the bracket tips under a short overhang
    if trim:
        h.TRIM, h.RIDGE = 0.7, "trim"
    r = (cx - 1, cx + 1, cy - 1, cy + 1)
    nb = len(Y.HIPS)
    m = captured(Y.main_hall, name, r, h, base_z, False, tone=tone, flat=flat, wen=wen, front_doors=front_doors, back_doors=back_doors,
                 passage=passage, beasts=beasts, front_steps=front_steps, back_steps=back_steps)
    if tone != "y":
        for i in range(nb, len(Y.HIPS)):
            Y.HIPS[i] = (Y.HIPS[i][0], 0)
    return h, m


# --- double-eaved halls: 大成殿 (庑殿) and 辟雍 (攒尖) --------------------------------------------------------------

def double_hall(cx, cy, H, base, up0, doors_all=False, front_doors=5, beasts=(7, 5)):
    """Walls on the inner ring behind a colonnade, the beams, the upper storey's band, both roofs with tile rows,
    columns and brackets as instances; returns the matrix."""
    m = T(cx, cy, 0)
    g = Geo()
    for rot, D, us in ring_sides(H, False):
        nb = len(us) - 1
        for i in range(nb):
            P = lambda u, z: to_world(rot, D, u, 0.05, z)          # noqa: E731
            mid = abs(i - (nb - 1) / 2)
            if doors_all:
                reg = "door" if mid < 0.6 else "window"
            elif rot == 0:
                reg = "door" if mid < front_doors / 2 else "window"
            elif rot == 2:
                reg = "door" if mid < 0.6 else "window"
            else:
                reg = None
            q = [P(us[i], base), P(us[i + 1], base), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if reg:
                g.polyn(q, "atlas", cdir(rot, 0, -1), uvs=uvs(reg, QUAD))
            else:
                g.polyn(q, "plaster", cdir(rot, 0, -1))
            Q = lambda u, z: to_world(rot, D, u, -0.25, z)         # noqa: E731
            g.polyn([Q(us[i], H.BEAM[0]), Q(us[i + 1], H.BEAM[0]), Q(us[i + 1], H.BEAM[1]), Q(us[i], H.BEAM[1])], "atlas", cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
            g.polyn([P(us[i], H.BEAM[1]), P(us[i + 1], H.BEAM[1]), P(us[i + 1], up0), P(us[i], up0)], "plaster", cdir(rot, 0, -1))
            g.polyn([P(us[i], up0), P(us[i + 1], up0), P(us[i + 1], H.UBEAM[0]), P(us[i], H.UBEAM[0])], "atlas", cdir(rot, 0, -1), uvs=uvs("band", QUAD))
    ring_beams(H, g, True, *H.BEAM)
    ring_beams(H, g, False, *H.UBEAM)
    for x0, x1, y0, y1 in ((-H.OX, H.OX, -H.OY, -H.IY), (-H.OX, H.OX, H.IY, H.OY), (H.IX, H.OX, -H.IY, H.IY), (-H.OX, -H.IX, -H.IY, H.IY)):
        Y.ceiling(g, x0, x1, y0, y1, H.BEAM[1])
    hips = roofs(H, g)
    nl = len(hips)
    for i, line in enumerate(hips):
        Y.HIPS.append(([m @ p for p in line], beasts[0] if i >= nl - 4 else beasts[1]))
    Y.columns_on(H, m, True, base, H.BEAM[0], 0.42)
    Y.columns_on(H, m, False, base, H.UBEAM[0], 0.46)
    Y.brackets_on(H, m, True, H.BEAM[2])
    Y.brackets_on(H, m, False, H.UBEAM[2])
    Y.G.add(g, m)
    Y.cbox(m, -H.IX, H.IX, -H.IY, H.IY, 0.0, H.UPPER["z"])
    f = Geo()
    f.box(-H.OX, H.OX, -H.OY, H.OY, base, H.LOWER["z"] + 0.4, "plaster", skip=("-z",))
    f.box(-H.IX, H.IX, -H.IY, H.IY, H.LOWER["z"], H.UPPER["z"] + 0.6, "plaster", skip=("-z",))
    roofs(H, f, lod=True)
    Y.FAR.add(f, m)
    return m


# 大成殿: nine bays by five, double-eaved 庑殿, on a 1.8 m marble platform with the 月台 in front
DC = (KX, 83.2)
DC_BASE = 1.8
DACHENG = SimpleNamespace(
    XS=Y.lin(20.0, 9), YS=Y.lin(12.3, 5), OX=20.0, OY=12.3, IX=20.0 - 40.0 / 9, IY=12.3 - 24.6 / 5,
    BEAM=(8.2, 8.9, 9.05, 9.9), UBEAM=(14.8, 15.45, 15.6, 16.45), OVERHANG=3.6,
    LOWER=dict(A=23.6, D=15.9, z=9.5, H=2.8, p=1.3, o=1.0, lift=0.9, Lc=7.0, Vc=4.0),
    UPPER=dict(A=20.0 - 40.0 / 9 + 3.3, D=12.3 - 24.6 / 5 + 3.3, z=16.15, H=7.8, p=1.6, o=1.0, lift=0.95, Lc=7.0, Vc=4.0),
    GABLE_X=10.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=7, LOWER_ROWS=4, BRACKET_GAP=1.7, WEN=0.75)
DC_UP0 = 11.4

# 辟雍: square, five bays round a three-bay hall, double-eaved 攒尖, gilt finial, on an island in a round moat
BY = (-72.9, 79.8)
BY_BASE = 1.0
BIYONG = SimpleNamespace(
    XS=[-10.4, -7.0, -2.4, 2.4, 7.0, 10.4], YS=[-10.4, -7.0, -2.4, 2.4, 7.0, 10.4], OX=10.4, OY=10.4, IX=7.0, IY=7.0,
    BEAM=(5.8, 6.4, 6.55, 7.3), UBEAM=(10.6, 11.15, 11.3, 12.0), OVERHANG=3.2,
    LOWER=dict(A=13.6, D=13.6, z=6.95, H=2.3, p=1.3, o=0.9, lift=0.8, Lc=5.5, Vc=3.0),
    UPPER=dict(A=9.9, D=9.9, z=11.7, H=6.2, p=1.6, o=0.8, lift=0.8, Lc=5.0, Vc=3.0),
    GABLE_X=3.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="cuanjian", ROWS=7, LOWER_ROWS=4, BRACKET_GAP=1.6)
BY_UP0 = 8.8
MOAT_C = (-72.9, 80.4)
MOAT_R = 30.7
ISLAND = (-91.0, -54.8, 62.6, 97.0)
BRIDGE_X = (-76.6, -68.8)     # the north and south land bridges between the moat's quarters
BRIDGE_Y = (77.2, 84.0)       # east and west


# --- balustrades: a textured panel strip between square posts (taihedian.py's), colliders by the run ---------

def rail_run(g, pts, z=0.0, hgt=1.05, coll_every=4, closed=False):
    """A balustrade along a polyline of plan points; a hull collider over every few panels."""
    pts = list(pts) + ([pts[0]] if closed else [])
    segs = []
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / 2.0))
        for j in range(n):
            segs.append(((a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n), (a[0] + (b[0] - a[0]) * (j + 1) / n, a[1] + (b[1] - a[1]) * (j + 1) / n)))
    for p0, p1 in segs:
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        ux, uy = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
        nx, ny = uy, -ux
        for sgn in (1, -1):
            q0 = (p0[0] + nx * 0.09 * sgn, p0[1] + ny * 0.09 * sgn)
            q1 = (p1[0] + nx * 0.09 * sgn, p1[1] + ny * 0.09 * sgn)
            g.polyn([(*q0, z), (*q1, z), (*q1, z + hgt), (*q0, z + hgt)], "rail", (nx * sgn, ny * sgn, 0), uvs=[(0, 0), (0.5 * L / 2, 0), (0.5 * L / 2, 1), (0, 1)])
        g.polyn([(p0[0] + nx * 0.1, p0[1] + ny * 0.1, z + hgt), (p1[0] + nx * 0.1, p1[1] + ny * 0.1, z + hgt),
                 (p1[0] - nx * 0.1, p1[1] - ny * 0.1, z + hgt), (p0[0] - nx * 0.1, p0[1] - ny * 0.1, z + hgt)], "marble", (0, 0, 1))
        g.box(p0[0] - 0.14, p0[0] + 0.14, p0[1] - 0.14, p0[1] + 0.14, z, z + hgt + 0.3, "marble", skip=("-z",))
    if segs:
        q = segs[-1][1]
        g.box(q[0] - 0.14, q[0] + 0.14, q[1] - 0.14, q[1] + 0.14, z, z + hgt + 0.3, "marble", skip=("-z",))
    for i in range(0, len(segs), coll_every):
        chunk = segs[i:i + coll_every]
        ps = [chunk[0][0]] + [s[1] for s in chunk]
        hull = []
        for x, y in ps:
            for dx, dy in ((0.15, 0.15), (-0.15, 0.15), (0.15, -0.15), (-0.15, -0.15)):
                hull += [(x + dx, y + dy, 0.0), (x + dx, y + dy, z + hgt + 0.2)]
        Y.COLL.append(("hull", hull))


def arc(c, r, a0, a1, n):
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def biyong():
    """辟雍: the island and its balustrade, the moat's outer balustrade, the four bridges, the hall on its platform."""
    g = Geo()
    cx, cy = BY
    H = BIYONG
    pw = H.OX + 1.3
    # the hall's platform with a flight on every side
    g.box(cx - pw, cx + pw, cy - pw, cy + pw, 0.0, BY_BASE, "marble", skip=("-z",))
    for rot in range(4):
        s = Geo()
        ramp = Y.steps(s, -2.6, 2.6, -pw, -1, 0.0, BY_BASE)
        mm = T(cx, cy, 0) @ Rz(rot * math.pi / 2)
        g.add(s, mm)
        Y.walk(mm, ramp)
    Y.COLL.append(("box", cx - pw, cx + pw, cy - pw, cy + pw, 0.0, BY_BASE))
    # the island's edge: a marble kerb and a balustrade, open at the bridges
    x0, x1, y0, y1 = ISLAND
    bx0, bx1 = BRIDGE_X[0] + 0.1, BRIDGE_X[1] - 0.1
    by0, by1 = BRIDGE_Y[0] + 0.1, BRIDGE_Y[1] - 0.1
    runs = [[(x0, y0), (bx0, y0)], [(bx1, y0), (x1, y0)], [(x1, y0), (x1, by0)], [(x1, by1), (x1, y1)],
            [(x1, y1), (bx1, y1)], [(bx0, y1), (x0, y1)], [(x0, y1), (x0, by1)], [(x0, by0), (x0, y0)]]
    for r_ in runs:
        rail_run(g, r_, z=0.0)
    # the outer ring, open at the bridges, and the bridges' own rails out to it
    c, R = MOAT_C, MOAT_R + 0.2
    half_ns = math.asin((BRIDGE_X[1] - BRIDGE_X[0]) / 2 / R)
    half_ew = math.asin((BRIDGE_Y[1] - BRIDGE_Y[0]) / 2 / R)
    for a0, a1 in ((half_ew, math.pi / 2 - half_ns), (math.pi / 2 + half_ns, math.pi - half_ew), (math.pi + half_ew, 1.5 * math.pi - half_ns),
                   (1.5 * math.pi + half_ns, 2 * math.pi - half_ew)):
        rail_run(g, arc(c, R, a0, a1, 12), z=0.0)

    def ring_y(x, sgn):
        return c[1] + sgn * math.sqrt(R * R - (x - c[0]) ** 2)

    def ring_x(y, sgn):
        return c[0] + sgn * math.sqrt(R * R - (y - c[1]) ** 2)
    for x in BRIDGE_X:
        rail_run(g, [(x, y1), (x, ring_y(x, 1))])
        rail_run(g, [(x, ring_y(x, -1)), (x, y0)])
    for y in BRIDGE_Y:
        rail_run(g, [(x1, y), (ring_x(y, 1), y)])
        rail_run(g, [(ring_x(y, -1), y), (x0, y)])
    # the bridges' decks: a marble pavement a little proud of the paving
    for p in (rect(BRIDGE_X[0], BRIDGE_X[1], y1, ring_y(sum(BRIDGE_X) / 2, 1) + 0.4), rect(BRIDGE_X[0], BRIDGE_X[1], ring_y(sum(BRIDGE_X) / 2, -1) - 0.4, y0),
              rect(x1, ring_x(sum(BRIDGE_Y) / 2, 1) + 0.4, BRIDGE_Y[0], BRIDGE_Y[1]), rect(ring_x(sum(BRIDGE_Y) / 2, -1) - 0.4, x0, BRIDGE_Y[0], BRIDGE_Y[1])):
        g.polyn([(x, y, 0.06) for x, y in p], "marble", (0, 0, 1))
    Y.G.add(g, Matrix.Identity(4))
    Y.BODIES.append((cx - pw - 0.4, cx + pw + 0.4, cy - pw - 3, cy + pw + 3))
    m = double_hall(cx, cy, H, BY_BASE, BY_UP0, doors_all=True, beasts=(5, 3))
    f = Geo()
    f.polyn([(x, y, 0.03) for x, y in rect(*ISLAND)], "paving", (0, 0, 1))
    Y.FAR.add(f, Matrix.Identity(4))
    return m


# --- 大成殿's platform and 月台 --------------------------------------------------------------------------------

def dacheng():
    cx, cy = DC
    H = DACHENG
    g = Geo()
    px, py = H.OX + 2.0, H.OY + 2.0
    zb = DC_BASE
    yt0 = cy - py - 13.0          # the 月台's front edge
    tx = 13.0
    g.box(cx - px, cx + px, cy - py, cy + py, 0.0, zb, "marble", skip=("-z",))
    g.box(cx - px - 0.15, cx + px + 0.15, cy - py - 0.15, cy + py + 0.15, zb - 0.18, zb, "marble", skip=("-z",))
    g.box(cx - tx, cx + tx, yt0, cy - py, 0.0, zb - 0.15, "marble", skip=("-z",))
    g.box(cx - tx - 0.15, cx + tx + 0.15, yt0 - 0.15, cy - py, zb - 0.33, zb - 0.15, "marble", skip=("-z",))
    zt = zb - 0.15
    # balustrades round the 月台 (open at the three flights) and along the platform's edge either side of it
    fw = 3.6
    rail_run(g, [(cx - tx + 0.3, cy - py), (cx - tx + 0.3, yt0 + 0.3), (cx - fw - 0.5, yt0 + 0.3)], z=zt)
    rail_run(g, [(cx + fw + 0.5, yt0 + 0.3), (cx + tx - 0.3, yt0 + 0.3), (cx + tx - 0.3, cy - py)], z=zt)
    rail_run(g, [(cx - px + 0.3, cy - py + 0.3), (cx - tx, cy - py + 0.3)], z=zb)
    rail_run(g, [(cx + tx, cy - py + 0.3), (cx + px - 0.3, cy - py + 0.3)], z=zb)
    rail_run(g, [(cx - px + 0.3, cy - py + 0.3), (cx - px + 0.3, cy + py - 0.3), (cx + px - 0.3, cy + py - 0.3), (cx + px - 0.3, cy - py + 0.3)], z=zb)
    s = Geo()
    ramp = Y.steps(s, -fw, fw, yt0 - 0.15, -1, 0.0, zt)
    g.add(s, T(cx, 0, 0))
    Y.walk(T(cx, 0, 0), ramp)
    # a step up from the 月台 to the platform, the width of the middle bays
    g.box(cx - 7.0, cx + 7.0, cy - py - 0.6, cy - py, zt, zt + 0.08, "marble")
    Y.G.add(g, Matrix.Identity(4))
    Y.COLL.append(("box", cx - px, cx + px, cy - py, cy + py, 0.0, zb))
    Y.COLL.append(("box", cx - tx, cx + tx, yt0, cy - py, 0.0, zt))
    Y.BODIES.append((cx - px - 0.4, cx + px + 0.4, yt0 - 2.0, cy + py + 0.4))
    m = double_hall(cx, cy, H, zb, DC_UP0, front_doors=5, beasts=(9, 7))
    f = Geo()
    f.box(cx - px, cx + px, cy - py, cy + py, 0.0, zb, "marble", skip=("-z",))
    f.box(cx - tx, cx + tx, yt0, cy - py, 0.0, zt, "marble", skip=("-z",))
    Y.FAR.add(f, Matrix.Identity(4))
    return m


# --- stele pavilions (碑亭): one double-eaved pavilion, linked everywhere --------------------------------------

STELE_PAVILIONS = [(13.7, 7.2), (13.8, 23.5), (12.9, 43.2), (0.1, 23.7), (-0.1, 43.4),
                   (61.0, 4.2), (60.9, 24.0), (60.6, 41.6), (74.0, 4.0), (73.6, 23.8), (73.0, 41.4),
                   (-101.2, 27.2), (-49.7, 26.1)]
PAV_HALF = 5.0


def pavilion_mesh(M):
    """One 碑亭 at the origin: yonghegong's square two-tier pavilion (gate doors front and back, plaster sides),
    drawn into its own buffers; returns the mesh, its far block, columns, colliders."""
    g0, f0 = Y.G, Y.FAR
    nc, nl, nb = len(Y.COLS), len(Y.COLL), len(Y.BODIES)
    Y.G, Y.FAR = Geo(), Geo()
    try:
        r = (-PAV_HALF, PAV_HALF, -PAV_HALF, PAV_HALF)
        Y.tower(r, Y.tower_spec(PAV_HALF, 1.4, 4.6, 6.7, 8.4, 2.3), 0.5, 6.7, doors_front=1, doors_back=1, ground="plaster", ground_ends="plaster", door="gatedoor")
        g, f = Y.G, Y.FAR
    finally:
        Y.G, Y.FAR = g0, f0
    cols = Y.COLS[nc:]
    coll = Y.COLL[nl:]
    del Y.COLS[nc:], Y.COLL[nl:], Y.BODIES[nb:]
    # the stele inside, seen through the doors: a tortoise base and the slab
    g.box(-0.9, 0.9, -0.5, 0.5, 0.5, 1.2, "stele")
    g.box(-0.7, 0.7, -0.18, 0.18, 1.2, 4.2, "stele")
    return mesh_of(g, "StelePavilionMesh", M, TILE), f, cols, coll


# --- 琉璃牌坊 ---------------------------------------------------------------------------------------------------

def plaque_text(coll, M, text, x, y, z, w, hgt, face, name):
    """yonghegong's plaque_text with a coarser curve (the boards are 1 m high: 3 segments a curve was 1.3k
    triangles a character)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, bpy.data.fonts.load(Y.FONT, check_existing=True), 1.0, 0.04
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 1
    cu.space_character = 1.15
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    k = min((hgt - 0.3) / (max(ys) - min(ys)), (w - 0.5) / (max(xs) - min(xs)))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return me, k, cx, cy


Y.plaque_text = plaque_text


def plaque(parts, M, m, text, z, w, hgt, side, name):
    """Gilt characters on a board in the frame m (the board's plane facing -y for side -1, +y for 1)."""
    me, k, tx, ty = Y.plaque_text(parts, M, text, 0.0, 0.0, z, w, hgt, side, name)
    mm = m @ T(0.0, side * 0.33, z) @ Rz(0.0 if side < 0 else math.pi) @ Matrix.Rotation(math.pi / 2, 4, "X")
    for v in me.vertices:
        v.co = mm @ Vector(((v.co.x - tx) * k, (v.co.y - ty) * k, v.co.z))
    me.materials.append(M["gold"])
    o = bpy.data.objects.new(name, me)
    parts.objects.link(o)


def glazed_arch(cx, cy, M, parts):
    """三间四柱七楼: a red body pierced by three arches with green-glazed frames on a marble plinth course, a frieze of
    green glaze with brackets, seven small yellow 庑殿 roofs; the boards 圜桥教泽 (south) and 学海节观 (north)."""
    g = Geo()
    m = T(cx, cy, 0)
    hw, hd, zt = 8.6, 1.0, 6.0
    arches = [(0.0, 3.6, 5.0), (-5.3, 2.4, 3.9), (5.3, 2.4, 3.9)]
    Y.arched_block(g, -hw, hw, -hd, hd, zt, arches)
    # a marble base course on each pier
    edges = [-hw - 0.1] + [e for xc, w, c in sorted(arches) for e in (xc - w / 2, xc + w / 2)] + [hw + 0.1]
    for xa, xb in zip(edges[0::2], edges[1::2]):
        g.box(xa, xb, -hd - 0.1, hd + 0.1, 0.0, 0.7, "marble", skip=("-z",))
    g.box(-hw - 0.15, hw + 0.15, -hd - 0.15, hd + 0.15, zt, zt + 0.3, "green")
    cols = [-7.4, -3.0, 3.0, 7.4]
    roofs_def = Y.pailou_roofs(cols, False)
    for x0, x1, zb, ze, main in roofs_def:
        half = (x1 - x0) / 2 + 0.25
        D = 0.5
        h = SimpleNamespace(
            XS=[-half, -half + 0.01, half - 0.01, half], YS=[-D, -D + 0.01, D - 0.01, D], OX=half, OY=D, IX=half - 0.01, IY=D - 0.01,
            BEAM=(zb, zb + 0.5, zb + 0.5, ze - 0.2), UBEAM=(zb, zb + 0.5, zb + 0.5, ze - 0.2), OVERHANG=1.0, LOWER=None,
            UPPER=dict(A=half + 0.6, D=D + 0.9, z=ze, H=1.7 if main else 1.3, p=1.5, o=0.35, lift=0.4, Lc=1.8, Vc=1.0),
            GABLE_X=half, PITCH=0.4, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=3, END_ROWS=3, WEN=0.36)
        bg = Geo()
        L = x1 - x0
        bg.box(-L / 2, L / 2, -0.45, 0.45, zt + 0.3, zb + 0.5, "green", skip=("-z",))
        bg.box(-L / 2 - 0.1, L / 2 + 0.1, -0.55, 0.55, zb + 0.4, zb + 0.55, "green")
        Y.FLAT["on"] = True
        roofs(h, bg)
        Y.FLAT["on"] = False
        g.add(bg, T((x0 + x1) / 2, 0, 0))
        n = max(2, round(L / 1.0))
        for j in range(n + 1):
            x = x0 + L * j / n
            for s, yaw in ((-1, 0.0), (1, math.pi)):
                Y.BRK.append(m @ T(x, s * 0.42, zb + 0.55) @ Rz(yaw) @ Matrix.Diagonal((0.5, 0.5, 0.5, 1.0)))
    main = [s for s in roofs_def if s[4]][0]
    bz, bw, bh = (zt + 0.3 + main[2]) / 2 + 0.2, 2.6, 1.0
    for s in (-1, 1):
        g.polyn([(-bw / 2, s * 0.47, bz - bh / 2), (bw / 2, s * 0.47, bz - bh / 2), (bw / 2, s * 0.47, bz + bh / 2), (-bw / 2, s * 0.47, bz + bh / 2)], "board", (0, s, 0))
        g.box(-bw / 2 - 0.1, bw / 2 + 0.1, s * 0.46 - 0.04, s * 0.46 + 0.04, bz - bh / 2 - 0.1, bz - bh / 2, "gold")
        g.box(-bw / 2 - 0.1, bw / 2 + 0.1, s * 0.46 - 0.04, s * 0.46 + 0.04, bz + bh / 2, bz + bh / 2 + 0.1, "gold")
    Y.G.add(g, m)
    plaque(parts, M, m @ T(0, -0.16, 0), "澤教橋圜", bz, bw, bh, -1, "GlazedPlaqueS")
    plaque(parts, M, m @ T(0, 0.16, 0), "觀節海學", bz, bw, bh, 1, "GlazedPlaqueN")
    xa = -hw
    for xc, w, c in sorted(arches):
        Y.COLL.append(("box", cx + xa, cx + xc - w / 2, cy - hd - 0.1, cy + hd + 0.1, 0.0, zt + 1.5))
        Y.COLL.append(("box", cx + xc - w / 2, cx + xc + w / 2, cy - hd, cy + hd, c, zt + 1.5))
        xa = xc + w / 2
    Y.COLL.append(("box", cx + xa, cx + hw, cy - hd - 0.1, cy + hd + 0.1, 0.0, zt + 1.5))
    Y.BODIES.append((cx - hw - 0.3, cx + hw + 0.3, cy - hd - 0.5, cy + hd + 0.5))
    f = Geo()
    f.box(-hw, hw, -hd, hd, 0.0, zt + 0.3, "plaster", skip=("-z",))
    for x0, x1, zb, ze, main_ in roofs_def:
        fb = Geo()
        fb.box(-(x1 - x0) / 2, (x1 - x0) / 2, -0.45, 0.45, zt, zb + 0.5, "green")
        Y.far_roof(fb, (x1 - x0) / 2 + 0.8, 1.4, ze, ze + (1.7 if main_ else 1.3), "tile")
        f.add(fb, T((x0 + x1) / 2, 0, 0))
    Y.FAR.add(f, m)


# --- 进士题名碑: 198 steles in rows either side of the first court's path ----------------------------------------

def stele_mesh(M):
    g = Geo()
    g.box(-0.55, 0.55, -0.32, 0.32, 0.0, 0.42, "marble", skip=("-z",))
    g.box(-0.42, 0.42, -0.12, 0.12, 0.42, 2.25, "stele", skip=("-z",))
    g.box(-0.46, 0.46, -0.15, 0.15, 2.25, 2.55, "stele", skip=("-z",))
    return mesh_of(g, "SteleMesh", M, TILE)


STELE_ROWS = [(-55.5 + 4.6 * k) for k in range(5)]
STELE_X = [(6.0, 32.0), (45.0, 71.0)]


# --- the plan ------------------------------------------------------------------------------------------------

# 孔庙's side ranges (rect, facing, wall top, tone)
KONG_SIDE = [
    ((-20.6, 29.0, -69.6, -64.6), "n", 3.6, "g"),           # the front range west of 先师门
    ((48.0, 96.2, -69.6, -64.6), "n", 3.6, "g"),            # east of it
    ((-20.6, -12.0, -64.0, -22.6), "e", 3.6, "g"),          # the first court's west range
    ((88.8, 96.2, -64.0, -22.8), "w", 3.6, "g"),            # east range
    ((-20.6, 21.0, -21.8, -12.9), "s", 4.0, "j"),           # either side of 大成门
    ((55.4, 96.2, -22.1, -12.2), "s", 4.0, "j"),
    ((-20.6, -9.0, -11.0, 78.0), "e", 4.6, "j"),            # 西庑
    ((84.6, 96.2, -11.0, 78.0), "w", 4.6, "j"),             # 东庑
    ((-20.6, 10.5, 79.4, 90.0), "s", 4.0, "j"),             # the ranges either side of 大成殿
    ((66.2, 96.2, 79.4, 89.8), "s", 4.0, "j"),
    ((15.0, 23.0, 122.0, 139.0), "e", 3.8, "j"),            # 崇圣祠's side halls
    ((58.0, 66.0, 122.0, 139.0), "w", 3.8, "j"),
    ((-20.6, -8.0, 100.0, 150.0), "e", 3.6, "g"),           # service ranges (神厨, 神库 ...)
    ((84.0, 96.2, 100.0, 150.0), "w", 3.6, "g"),
]
# 国子监's side ranges
GUO_SIDE = [
    ((-109.0, -84.6, -23.0, -13.2), "n", 3.8, "gg"),        # either side of 太学门
    ((-63.6, -39.8, -23.3, -12.5), "n", 3.8, "gg"),
    ((-121.0, -109.4, -12.5, 146.0), "e", 4.0, "gg"),       # 六堂 west
    ((-39.6, -29.7, -12.0, 147.0), "w", 4.0, "gg"),         # 六堂 east
    ((-105.8, -91.8, 139.0, 148.2), "s", 3.8, "gg"),        # either side of 彝伦堂
    ((-55.4, -45.5, 139.0, 148.2), "s", 3.8, "gg"),
]
KONG_WALLS = [
    ([(-21.0, FRONT), (96.6, FRONT), (96.6, 155.8), (-21.0, 155.8)], True),
    ([(10.0, 116.2), (67.0, 116.2)], False), ([(10.0, 116.2), (10.0, 155.8)], False), ([(67.0, 116.2), (67.0, 155.8)], False),
]
GUO_WALLS = [
    ([(-121.05, FRONT), (-29.3, FRONT), (-29.3, 227.2), (-121.05, 227.2)], True),
    ([(-29.3, FRONT), (-21.0, FRONT)], False),
]
# the 国子监 牌楼 across 国子监街: x on the street, centre line there
STREET_PAILOU = [(110.5, -77.0), (-128.5, -77.15)]
CITY_BLDG = (-121.5, -94.0, 179.5, 228.0)   # OSM way 688189227 in 国子监's north court, left to the city


def street_pailou(x, y, M, parts, tag):
    """一间二柱三楼 across the street: posts on the pavements 4.6 m either side of the centre line, no braces."""
    cols = [-4.6, 4.6]
    roofs_def = [(-4.6, 4.6, 7.8, 8.9, True), (-6.2, -4.6, 7.0, 7.9, False), (4.6, 6.2, 7.0, 7.9, False)]
    Y.pailou(x, y, 1, cols, roofs_def, M, parts, plaques=[(-1, "監子國"), (1, "監子國")], tag=tag, braces=False)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("孔庙国子监")
    parts = collection("构件", main)
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = Y.G.tris() - tri[0]
        tri[0] = Y.G.tris()

    # --- 孔庙, south to north
    gate("先师门", KX, -66.0, 5.8, 3.2, 3, 3, 0.6, 5.2, 1.8, tone="y", flat=True, beasts=3, front_steps=4.0, back_steps=4.0, rows=6)
    gate("大成门", KX, -17.7, 11.3, 6.1, 5, 3, 1.0, 6.4, 2.4, tone="y", flat=False, beasts=5, wen=0.7, front_steps=5.0, back_steps=5.0, rows=7)
    # the ten stone drums (石鼓) on the terrace in front of 大成门
    g = Geo()
    for sx in (-1, 1):
        for k in range(5):
            x, y = KX + sx * (3.6 + 1.25 * k), -17.7 - 6.1 - 0.45
            Y.lathe(g, [(0.0, 1.0), (0.36, 1.0), (0.42, 1.25), (0.44, 1.5), (0.4, 1.75), (0.0, 1.78)], 10, "stele", x=x, y=y)
    Y.G.add(g, Matrix.Identity(4))
    mark("kong_gates")
    dacheng()
    mark("dacheng")
    gate("崇圣门", 37.2, 116.2, 6.0, 1.4, 3, 1, 0.45, 4.4, 1.2, tone="y", flat=True, beasts=0, wen=0.45, front_steps=0, back_steps=0, Hk=0.55)
    gate("崇圣祠", 40.5, 148.0, 10.4, 4.6, 5, 3, 0.9, 6.0, 1.6, tone="y", flat=True, beasts=3, wen=0.6, front_steps=4.0, back_steps=0, passage=False,
         front_doors=3, back_doors=0)
    for r, facing, zw, tone in KONG_SIDE:
        side(r, facing, zw, tone=tone, ov=1.0 if tone == "g" else 1.3)
    # the two small pavilions on the first court's west side (井亭, 致斋所's gate)
    for r in ((-8.9, 0.7, -48.0, -38.9), (-7.7, 0.8, -63.3, -55.8)):
        side(r, "e", 3.4, tone="y", roof="xie", ov=1.2)
    mark("kong_side")

    # --- 国子监
    gate("集贤门", GX, -66.2, 5.6, 3.0, 3, 3, 0.5, 4.8, 1.6, tone="gg", flat=True, beasts=0, wen=0.45, front_steps=3.0, back_steps=3.0)
    gate("太学门", -74.0, -17.6, 7.5, 3.7, 3, 3, 0.6, 5.4, 1.8, tone="gg", flat=True, beasts=0, wen=0.55, front_steps=4.0, back_steps=4.0)
    for r in ((-104.9, -96.9, -6.6, 1.0), (-53.4, -45.4, -8.6, -1.0)):           # 钟亭, 鼓亭
        side(r, "s" if r[0] < -60 else "s", 3.4, tone="gg", roof="xie", ov=1.2)
    glazed_arch(GX, 6.2, M, parts)
    mark("guo_front")
    biyong()
    mark("biyong")
    # 彝伦堂 on its 月台
    g = Geo()
    g.box(GX - 10.5, GX + 10.5, 126.4, 138.2, 0.0, 0.9, "marble", skip=("-z",))
    s = Geo()
    ramp = Y.steps(s, -3.0, 3.0, 126.4, -1, 0.0, 0.9)
    g.add(s, T(GX, 0, 0))
    Y.walk(T(GX, 0, 0), ramp)
    Y.G.add(g, Matrix.Identity(4))
    Y.COLL.append(("box", GX - 10.5, GX + 10.5, 126.4, 138.2, 0.0, 0.9))
    Y.BODIES.append((GX - 11, GX + 11, 124.0, 138.5))
    gate("彝伦堂", GX, 143.5, 15.2, 4.6, 7, 3, 0.9, 6.0, 1.8, tone="gg", flat=True, beasts=0, wen=0.6, front_steps=0, back_steps=0, passage=False,
         front_doors=3, back_doors=1)
    for r, facing, zw, tone in GUO_SIDE:
        side(r, facing, zw, tone=tone, ov=1.2)
    mark("guo_halls")

    # --- the street's archways
    for i, (x, y) in enumerate(STREET_PAILOU):
        street_pailou(x, y, M, parts, f"S{i}")
    mark("street_pailou")

    # --- walls (stopping at every building), the city building inside 国子监's north court left standing
    Y.BODIES.append(CITY_BLDG)
    Y.BODIES.append((KX - 6.0, KX + 6.0, -72.0, -69.0))          # the street wall stops at the gates
    Y.BODIES.append((GX - 5.8, GX + 5.8, -72.0, -69.0))
    stats["walls"] = Y.walls(KONG_WALLS, zt=4.2) + Y.walls(GUO_WALLS, zt=4.2)
    mark("walls")

    # --- paving: 孔庙, the strip between, 国子监 round the moat (corners cut to the ring), the island, the bridges
    c, R = MOAT_C, MOAT_R + 0.35
    bx0, bx1, by0, by1 = c[0] - R - 0.2, c[0] + R + 0.2, c[1] - R - 0.2, c[1] + R + 0.2
    polys = [rect(-20.6, 96.2, -69.9, 155.4), rect(-29.3, -21.0, -69.9, 155.4),
             rect(-120.6, -29.7, -69.9, by0), rect(-120.6, -29.7, by1, 155.4), rect(-120.6, bx0, by0, by1), rect(bx1, -29.7, by0, by1), rect(*ISLAND)]
    for (kx, ky), a0 in (((bx0, by0), math.pi), ((bx1, by0), 1.5 * math.pi), ((bx1, by1), 0.0), ((bx0, by1), 0.5 * math.pi)):
        pts = arc(c, R, a0, a0 + math.pi / 2, 12)
        e0 = (c[0] + (R + 0.2) * math.cos(a0), c[1] + (R + 0.2) * math.sin(a0))
        e1 = (c[0] + (R + 0.2) * math.cos(a0 + math.pi / 2), c[1] + (R + 0.2) * math.sin(a0 + math.pi / 2))
        polys.append([e0] + pts + [e1, (kx, ky)])
    polys += [rect(BRIDGE_X[0], BRIDGE_X[1], ISLAND[3], by1), rect(BRIDGE_X[0], BRIDGE_X[1], by0, ISLAND[2]),
              rect(ISLAND[1], bx1, BRIDGE_Y[0], BRIDGE_Y[1]), rect(bx0, ISLAND[0], BRIDGE_Y[0], BRIDGE_Y[1])]
    for poly in polys:
        Y.G.polyn([(x, y, 0.03) for x, y in poly], "paving", (0, 0, 1))
        Y.FAR.polyn([(x, y, 0.03) for x, y in poly], "paving", (0, 0, 1))

    Y.G.build("Temple", collection("殿", main), M, TILE)
    stats["tris"] = Y.G.tris()

    # --- instances: stele pavilions, steles, columns, brackets, beasts
    pav, pav_far, pav_cols, pav_coll = pavilion_mesh(M)
    for i, (x, y) in enumerate(STELE_PAVILIONS):
        mm = T(x, y, 0)
        place(pav, f"StelePavilion.{i:02d}", parts, mm)
        Y.FAR.add(pav_far, mm)
        for cm, r, hh in pav_cols:
            Y.COLS.append((mm @ cm, r, hh))
        for cc in pav_coll:
            if cc[0] == "box":
                Y.COLL.append(("box", cc[1] + x, cc[2] + x, cc[3] + y, cc[4] + y, cc[5], cc[6]))
            else:
                Y.COLL.append((cc[0], [(p[0] + x, p[1] + y, p[2]) for p in cc[1]]))
        Y.BODIES.append((x - PAV_HALF, x + PAV_HALF, y - PAV_HALF, y + PAV_HALF))
    st = stele_mesh(M)
    n = 0
    for xa, xb in STELE_X:
        for y in STELE_ROWS:
            k = 20
            for j in range(k):
                place(st, f"Stele.{n:03d}", parts, T(xa + (xb - xa) * (j + 0.5) / k, y, 0))
                n += 1
            Y.COLL.append(("box", xa, xb, y - 0.32, y + 0.32, 0.0, 2.5))
    stats["steles"] = n

    cg = Geo()
    cyl(cg, 0, 0, 0.0, 1.0, 1.0, 0.96, 10, "red", caps=(False, False))
    col_me = mesh_of(cg, "ColumnMesh", M, TILE)
    bg = Geo()
    cyl(bg, 0, 0, 0.0, 0.22, 1.45, 1.3, 8, "marble", caps=(False, True))
    base_me = mesh_of(bg, "ColumnBaseMesh", M, TILE)
    for i, (mm, r, hh) in enumerate(Y.COLS):
        place(col_me, f"Column.{i:04d}", parts, mm @ T(0, 0, 0.18) @ Matrix.Diagonal((r, r, hh - 0.18, 1.0)))
        place(base_me, f"ColumnBase.{i:04d}", parts, mm @ Matrix.Diagonal((r, r, 1.0, 1.0)))
    br = mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE)
    for i, mm in enumerate(Y.BRK):
        place(br, f"Bracket.{i:04d}", parts, mm)
    beast = mesh_of(beast_geo(lite=True), "BeastMesh", M, TILE)
    meshes = dict(beast=beast, immortal=beast)
    for i, (line, nb) in enumerate(Y.HIPS):
        if nb:
            beasts_on(line, parts, meshes, f"Beast{i}", n=nb)
    stats.update(columns=len(Y.COLS), brackets=len(Y.BRK), hips=len(Y.HIPS))

    Y.FAR.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = Y.FAR.tris()

    helpers = collection("碰撞体")
    nb = nh = nw = 0
    for cc in Y.COLL:
        if cc[0] == "box":
            collider_box(helpers, f"b{nb}", *cc[1:])
            nb += 1
        elif cc[0] == "hull":
            collider_pts(helpers, f"h{nh}", cc[1])
            nh += 1
        else:
            collider_pts(helpers, f"w{nw}", cc[1], role="WALK")
            nw += 1
    stats.update(boxes=nb, hulls=nh, ramps=nw)
    # footprints: the two precincts and the strip between them up to 彝伦堂, 孔庙's north end (国子监's north court
    # keeps the city's building in it)
    flat_marker(helpers, "precincts", rect(-121.5, 97.1, -72.4, 150.0), "FOOTPRINT")
    flat_marker(helpers, "kongNorth", rect(-21.4, 97.1, 150.0, 156.3), "FOOTPRINT")
    # clear zones: every building and wall (the courts keep the city's old trees), the archways' posts on the street
    k = 0
    for b in Y.BODIES:
        if b == CITY_BLDG:
            continue
        x0, x1, y0, y1 = b
        flat_marker(helpers, f"clear{k}", rect(x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5), "CLEAR")
        k += 1
    for poly, closed in KONG_WALLS + GUO_WALLS:
        pts = poly + ([poly[0]] if closed else [])
        for a, b in zip(pts, pts[1:]):
            flat_marker(helpers, f"clear{k}", rect(min(a[0], b[0]) - 0.6, max(a[0], b[0]) + 0.6, min(a[1], b[1]) - 0.6, max(a[1], b[1]) + 0.6), "CLEAR")
            k += 1
    for x, y in STREET_PAILOU:
        for s in (-1, 1):
            flat_marker(helpers, f"clear{k}", rect(x - 1.6, x + 1.6, y + s * 4.6 - 1.2, y + s * 4.6 + 1.2), "CLEAR")
            k += 1
    for xa, xb in STELE_X:
        flat_marker(helpers, f"clear{k}", rect(xa - 0.8, xb + 0.8, STELE_ROWS[0] - 1.0, STELE_ROWS[-1] + 1.0), "CLEAR")
        k += 1
    flat_marker(helpers, f"clear{k}", rect(MOAT_C[0] - MOAT_R - 1.5, MOAT_C[0] + MOAT_R + 1.5, MOAT_C[1] - MOAT_R - 1.5, MOAT_C[1] + MOAT_R + 1.5), "CLEAR")
    stats["clear"] = k + 1

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "kongmiao", "孔庙和国子监", "Confucius Temple and Imperial Academy"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 880.0, -4000.0, -0.8
    s.far_distance = 450
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
