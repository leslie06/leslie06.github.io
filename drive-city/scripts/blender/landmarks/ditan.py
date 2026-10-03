# 地坛 方泽坛 the Altar of Earth in 地坛公园, built in Blender, marked with the bcity_landmark add-on's conventions.
# The city drew an empty lawn there with OSM's moat and wall lines as grey walls, and the 皇祇室 court as two
# hipped blocks. This file also holds the altar pieces ritan.py and yuetan.py share (materials, square tiers,
# straight flights with their walk-only ramps, enclosure walls with tiled copings, 棂星门 gates).
#
#   blender -b -P scripts/blender/landmarks/ditan.py -- [--out art/landmarks/ditan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the outer enclosure (OSM way
# 78050667, landuse=religious 地坛: a square of 132 m, game (1043.3, -4745.2)), heading -5.47 (its edges in the
# game's frame). The figures (北京日报 2026 on the 方泽坛壝; 维基百科 地坛):
#   方泽坛  two square tiers, the lower 35 m and 1.25 m high, the upper 20.5 m and 1.28 m, faced in yellow
#           glazed brick under a white marble coping, with marble balustrades; eight steps down each side of
#           each tier (the north ones, the main approach, wider); four stone seats on the lower tier, the
#           carved mountains (五岳 ...) east and west and the waves (四海 ...) beside them
#   方泽    the square moat round the lower tier (OSM's walls 377843166-168, ~37 m across), the flights crossing it
#   内壝    86 m square (OSM 377843169/170), 1.9 m, red with a yellow glazed coping
#   外壝    133 m (OSM's landuse square), 2.6 m, the same
#   棂星门  on each side of both walls: on the north 六柱三间 (three openings, each its own pair of white
#           marble posts), on the east, south and west 两柱一间; lattice doors standing open
#   皇祇室  south of the outer wall in its own walled court (OSM 384269689/690 and 377843163): a five-bay,
#           three-bay-deep 歇山 hall in yellow glaze facing north, a gatehouse in the north wall
# Not modelled: the 望灯杆 (no position for it in OSM), the 斋宫 and 神库 elsewhere in the park.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, collider_pts, coping, flat_marker, lathe, mesh_of, panel_geo, paving, place, post_geo  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, cdir, column_geo, paint_atlas, plaster,  # noqa: E402
                  ring_beams, ring_sides, roofs, to_world, uvs)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "ditan.blend")

YELLOW, GREEN = "#d9a02a", "#2e7d57"


# --- shared: textures and materials ----------------------------------------------------------------------

def glaze_image(name, col, size=256):
    """Glazed facing bricks in running bond: 0.5 x 0.25 m, 2 m a repeat, white lime joints, a sheen per brick."""
    cv = Canvas(size, size, col)
    rng = np.random.default_rng(31)
    bw, bh = size / 4, size / 8
    row = (cv.y // bh).astype(int)
    colx = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.9, 1.08, (8, 6))[row % 8, colx % 6][..., None]
    shade = 1 - 0.12 * np.clip((np.mod(cv.y, bh) / bh), 0, 1)[..., None]
    cv.a *= shade
    cv.put((np.mod(cv.y, bh) < 2.0) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 2.0), "#d8d2c2")
    return image(name, np.flipud(cv.a).copy())


def brick_image(name, col="#80837f", size=512):
    """Square floor bricks (方砖), 0.5 m, 4 m a repeat, set straight with fine joints."""
    cv = Canvas(size, size, col)
    rng = np.random.default_rng(13)
    q = size / 8
    cv.a *= rng.uniform(0.9, 1.07, (8, 8))[(cv.y // q).astype(int) % 8, (cv.x // q).astype(int) % 8][..., None]
    cv.noise(0.06, 14)
    cv.put((np.mod(cv.y, q) < 2.0) | (np.mod(cv.x, q) < 2.0), "#5f615f")
    return image(name, np.flipud(cv.a).copy())


def lattice_image(name, size=128):
    """A 棂星门 door leaf: a red frame round vertical red bars over the dark behind (1 x 2 units)."""
    cv = Canvas(size, size * 2, "#1d0d0b")
    m = (np.mod(cv.x, size / 9) < size / 22)
    cv.put(m, "#9a231a")
    cv.rect(0, 0, size, 10, "#8c1f17")
    cv.rect(0, size * 2 - 10, size, size * 2, "#8c1f17")
    cv.rect(0, 0, 8, size * 2, "#8c1f17")
    cv.rect(size - 8, 0, size, size * 2, "#8c1f17")
    cv.rect(0, size * 1.45, size, size * 1.45 + 14, "#8c1f17")
    cv.rect(0, size * 1.45 + 14, size, size * 2 - 10, "#7f1c15")
    cv.noise(0.06, 3)
    return image(name, np.flipud(cv.a).copy())


def make_materials(prefix, roof=YELLOW, face="#d9a02a", face_tex=True, wall_col="#a8321f"):
    """The altars' materials. `roof` the glazed tiles of copings and roofs, `face` the tier faces' glaze."""
    atlas, night = paint_atlas(prefix, portrait=False, emblem=False)
    return dict(
        atlas=material(f"{prefix}_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material(f"{prefix}_Plaster", wall_col, 0.85, tex=plaster(name=f"{prefix}_PlasterTex", col=wall_col), props={"wet": "damp", "glowStrength": 0.7}),
        tile=material(f"{prefix}_Tile", roof, 0.3, props={"wet": "surface", "glowStrength": 0.55}),
        glaze=material(f"{prefix}_Glaze", face, 0.3, tex=glaze_image(f"{prefix}_GlazeTex", face) if face_tex else None, props={"wet": "surface", "glowStrength": 0.55}),
        marble=material(f"{prefix}_Marble", "#e9e5dc", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        stone=material(f"{prefix}_Stone", "#bdb8ad", 0.75, props={"wet": "damp", "glowStrength": 0.5}),
        paving=material(f"{prefix}_Paving", "#b3aea3", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        ground=material(f"{prefix}_Ground", "#a9a59b", 0.85, tex=brick_image(f"{prefix}_GroundTex", "#9d9c96"), props={"wet": "ground", "glowStrength": 0.5, "layer": 9}),
        water=material(f"{prefix}_Water", "#26383d", 0.04, metal=0.15, props={"wet": "none", "glow": "none", "layer": 10}),
        red=material(f"{prefix}_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        door=material(f"{prefix}_Lattice", "#9a231a", 0.5, tex=lattice_image(f"{prefix}_LatticeTex"), props={"wet": "damp"}),
        gold=material(f"{prefix}_Gold", "#e0b04a", 0.25, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.5}),
        paint=material(f"{prefix}_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        dark=material(f"{prefix}_Dark", "#1c1d1f", 0.9, props={"wet": "none", "glow": "none"}),
    )


TILE = dict(atlas=1.0, plaster=4.0, tile=2.0, glaze=2.0, marble=2.0, stone=2.0, paving=4.0, ground=4.0, water=8.0, red=2.0, door=1.0, gold=1.0, paint=1.0, dark=1.0)


# --- shared: tiers and flights ---------------------------------------------------------------------------

def tier(g, a, z0, z1, face="glaze", top="paving"):
    """A square tier of half size a: a marble base course, the faced walls, a marble coping, the paved top."""
    g.box(-a - 0.08, a + 0.08, -a - 0.08, a + 0.08, z0, z0 + 0.3, "marble", skip=("-z", "+z"))
    g.box(-a, a, -a, a, z0 + 0.3, z1 - 0.22, face, skip=("-z", "+z"))
    g.box(-a - 0.15, a + 0.15, -a - 0.15, a + 0.15, z1 - 0.22, z1, "marble", skip=("-z", "+z"))
    for z, r, up in ((z0 + 0.3, a + 0.08, True), (z1 - 0.22, a + 0.15, False)):
        # the ledges: base course top and coping underside, as rings
        for s in range(4):
            m = Rz(s * math.pi / 2)
            inner = a
            q = [m @ Vector(p) for p in ((-r, -r, z), (r, -r, z), (inner, -inner, z), (-inner, -inner, z))]
            g.polyn([tuple(p) for p in q], "marble", (0, 0, 1) if up else (0, 0, -1))
    g.polyn([(-a - 0.15, -a - 0.15, z1), (a + 0.15, -a - 0.15, z1), (a + 0.15, a + 0.15, z1), (-a - 0.15, a + 0.15, z1)], top, (0, 0, 1))


def flight(g, w, n, z_top, z_bot, m, ramps, run=0.3, key="marble", stringer=0.45):
    """
    A straight flight of n steps in its own frame (across x, down and out towards -y from the edge at y = 0,
    where the level z_top is), moved by matrix m; side stringers (垂带) in marble. Appends the walk-only ramp's
    points (world) to `ramps`. Returns its run.
    """
    f = Geo()
    L = run * n
    for k in range(n):
        y0, y1 = -run * (n - k - 1), -run * (n - k)          # outward distance [y1, y0] (negative)
        z = z_bot + (z_top - z_bot) * (k + 1) / n
        f.polyn([(-w / 2, y1, z), (w / 2, y1, z), (w / 2, y0, z), (-w / 2, y0, z)], key, (0, 0, 1))
        zb = z_bot if k == 0 else z_bot + (z_top - z_bot) * k / n
        f.polyn([(-w / 2, y1, zb), (w / 2, y1, zb), (w / 2, y1, z), (-w / 2, y1, z)], key, (0, -1, 0))
    for sx in (-1, 1):
        xa, xb = sorted((sx * w / 2, sx * (w / 2 + stringer)))
        P = lambda x, y, z: (x, y, z)        # noqa: E731
        top0, top1 = z_top + 0.12, z_bot + 0.12
        f.polyn([P(xa, 0, z_bot), P(xa, -L, z_bot), P(xa, -L, top1), P(xa, 0, top0)], key, (-1, 0, 0))
        f.polyn([P(xb, 0, z_bot), P(xb, -L, z_bot), P(xb, -L, top1), P(xb, 0, top0)], key, (1, 0, 0))
        f.polyn([P(xa, 0, top0), P(xb, 0, top0), P(xb, -L, top1), P(xa, -L, top1)], key, (0, -0.3, 1))
        f.polyn([P(xa, -L, z_bot), P(xb, -L, z_bot), P(xb, -L, top1), P(xa, -L, top1)], key, (0, -1, 0))
    g.add(f, m)
    hw = w / 2 + stringer
    ramps.append([m @ Vector(p) for p in ((-hw, 0, z_top), (hw, 0, z_top), (-hw, -L, z_bot), (hw, -L, z_bot), (-hw, 0, z_bot), (hw, 0, z_bot))])
    return L


SIDE_M = {"S": Rz(0.0), "E": Rz(math.pi / 2), "N": Rz(math.pi), "W": Rz(-math.pi / 2)}


def flights_round(g, a, z_top, z_bot, n, widths, ramps, run=0.3):
    """Flights on the four axes of a square tier of half size a: widths {side: w}."""
    out = {}
    for side, w in widths.items():
        m = SIDE_M[side] @ T(0, -a - 0.15, 0)
        out[side] = flight(g, w, n, z_top, z_bot, m, ramps, run)
    return out


def square_rail(coll, mesh, a, z, gaps, tag):
    """A marble balustrade round a square of half size a at height z, open at the flights: gaps {side: width}."""
    pts = [(-a, -a, z), (a, -a, z), (a, a, z), (-a, a, z), (-a, -a, z)]
    skip = []
    for side, w in gaps.items():
        h = w / 2 + 0.5
        skip.append({"S": (-h, h, -a - 1, -a + 1), "N": (-h, h, a - 1, a + 1), "E": (a - 1, a + 1, -h, h), "W": (-a - 1, -a + 1, -h, h)}[side])
    return balustrade(coll, mesh, pts, tag, gap=1.8, skip=skip)


# --- shared: walls and gates -----------------------------------------------------------------------------

def wall_piece(g, a, b, h, t, cap="tile", body="plaster"):
    """A straight wall from plan point a to b, `h` to the top of the body, `t` thick, a tiled coping on it."""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
    d = (b - a)
    L = d.length
    if L < 0.05:
        return
    d /= L
    n = Vector((-d.y, d.x, 0)) * (t / 2)
    for sgn in (1, -1):
        p, q = a + n * sgn, b + n * sgn
        g.polyn([(p.x, p.y, 0.0), (q.x, q.y, 0.0), (q.x, q.y, h), (p.x, p.y, h)], body, (n.x * sgn, n.y * sgn, 0))
    for p, sgn in ((a, -1), (b, 1)):
        g.polyn([(p.x + n.x, p.y + n.y, 0.0), (p.x - n.x, p.y - n.y, 0.0), (p.x - n.x, p.y - n.y, h), (p.x + n.x, p.y + n.y, h)], body, (d.x * sgn, d.y * sgn, 0))
    g.polyn([(a.x + n.x, a.y + n.y, h), (b.x + n.x, b.y + n.y, h), (b.x - n.x, b.y - n.y, h), (a.x - n.x, a.y - n.y, h)], body, (0, 0, 1))
    coping(g, (a.x, a.y), (b.x, b.y), t + 0.45, h, rise=0.32 + 0.1 * t, key=cap)


def square_wall(g, half, h, t, gaps, cols, tag, cap="tile", cx=0.0, cy=0.0):
    """
    A square enclosure wall of half size `half` round (cx, cy): gaps {side: [(offset along the side, width)]}.
    Appends a collider box per piece to `cols` as (x0, x1, y0, y1, h).
    """
    corners = {"S": ((-half, -half), (half, -half)), "E": ((half, -half), (half, half)),
               "N": ((half, half), (-half, half)), "W": ((-half, half), (-half, -half))}
    for side, (p, q) in corners.items():
        p, q = Vector(p), Vector(q)
        d = (q - p).normalized()
        L = (q - p).length
        # extend each run by half the thickness at its start so the corners close
        cuts = [(-t / 2, None)]
        for off, w in sorted(gaps.get(side, [])):
            s = L / 2 + off
            cuts.append((s - w / 2, s + w / 2))
        cuts.append((L + t / 2, None))
        s0 = -t / 2
        for c in cuts[1:]:
            s1 = c[0]
            if s1 - s0 > 0.05:
                a, b = p + d * s0, p + d * s1
                wall_piece(g, (a.x + cx, a.y + cy), (b.x + cx, b.y + cy), h, t, cap)
                x0, x1 = sorted((a.x, b.x))
                y0, y1 = sorted((a.y, b.y))
                if abs(d.x) > 0.5:
                    y0, y1 = a.y - t / 2, a.y + t / 2
                else:
                    x0, x1 = a.x - t / 2, a.x + t / 2
                cols.append((x0 + cx, x1 + cx, y0 + cy, y1 + cy, h + 0.4))
            if c[1] is not None:
                s0 = c[1]


def flame_pts(w=1.3, h=1.15, n=9):
    """The 火焰牌 over a 棂星门's lintel: a pointed flame outline (x across, z up), bottom first."""
    out = [(-w / 2, 0.0), (w / 2, 0.0)]
    for i in range(n + 1):
        t = i / n
        x = (w / 2) * (1 - t) ** 1.2 * (1 + 0.08 * math.sin(t * 9))
        out.append((x, 0.25 + (h - 0.25) * t))
    for i in range(n - 1, -1, -1):
        t = i / n
        x = (w / 2) * (1 - t) ** 1.2 * (1 + 0.08 * math.sin(t * 9 + 1.5))
        out.append((-x, 0.25 + (h - 0.25) * t))
    return out


def lingxing(w, t, hl, cap_h=0.9):
    """
    One opening of a 棂星门 in its own frame: the wall along x at y = 0 (t thick), the inside to +y; two white
    marble posts (with a cloud cap) either side of an opening w wide, the lintel at hl, the 火焰牌 over it, the
    lattice door leaves standing open against the inside. Returns (Geo, half width incl. posts, top).
    """
    g = Geo()
    pw = 0.62
    dp = t / 2 + 0.25
    ph = hl + 0.95
    for sx in (-1, 1):
        x0, x1 = sorted((sx * w / 2, sx * (w / 2 + pw)))
        g.box(x0 - 0.06, x1 + 0.06, -dp - 0.06, dp + 0.06, 0.0, 0.35, "marble", skip=("-z",))
        g.box(x0, x1, -dp, dp, 0.35, ph, "marble", skip=("-z",))
        xc = (x0 + x1) / 2
        g.box(xc - 0.4, xc + 0.4, -dp - 0.08, dp + 0.08, ph, ph + 0.16, "marble", skip=("-z",))
        lathe(g, [(0.36, ph + 0.16), (0.42, ph + 0.35), (0.3, ph + 0.55), (0.34, ph + 0.68), (0.14, ph + cap_h - 0.05), (0.0, ph + cap_h)], 8, "marble", x=xc, y=0.0)
        # the door leaf, open, against the inside face of the post
        lw = w / 2
        xl = sx * (w / 2 - 0.06)
        for side in (-1, 1):
            g.polyn([(xl + side * 0.03, dp, 0.05), (xl + side * 0.03, dp + lw, 0.05), (xl + side * 0.03, dp + lw, hl - 0.15), (xl + side * 0.03, dp, hl - 0.15)], "door", (side, 0, 0),
                    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)] if side > 0 else [(1, 0), (0, 0), (0, 1), (1, 1)])
    # the lintel, a frieze board and the 火焰牌 standing on it
    g.box(-w / 2, w / 2, -dp + 0.12, dp - 0.12, hl, hl + 0.42, "marble")
    fl = flame_pts(min(1.4, w * 0.45), 1.1)
    for side in (-1, 1):
        g.polyn([(x, side * 0.12, hl + 0.42 + z) for x, z in fl], "marble", (0, side, 0))
    for i in range(len(fl)):
        (x0, z0), (x1, z1) = fl[i], fl[(i + 1) % len(fl)]
        g.polyn([(x0, -0.12, hl + 0.42 + z0), (x1, -0.12, hl + 0.42 + z1), (x1, 0.12, hl + 0.42 + z1), (x0, 0.12, hl + 0.42 + z0)], "marble",
                ((z1 - z0), 0, -(x1 - x0)) if abs(z1 - z0) + abs(x1 - x0) > 1e-6 else (0, 0, 1))
    return g, w / 2 + pw, ph + cap_h


def gate_set(g, cols, m, n, w, t, hl, pitch=None):
    """n 棂星门 openings side by side (pitch apart) in a wall, moved by m; their posts as colliders (world boxes
    via a hull of points). Returns the gaps [(offset, width)] the wall leaves for them."""
    pitch = pitch or (w + 1.24 + 1.8)
    gaps = []
    for k in range(n):
        x = (k - (n - 1) / 2) * pitch
        lg, hw, top = lingxing(w, t, hl)
        g.add(lg, m @ T(x, 0, 0))
        gaps.append((x, 2 * hw - 0.02))
        for sx in (-1, 1):
            x0, x1 = sorted((x + sx * w / 2, x + sx * (hw)))
            cols.append(("pts", [m @ Vector((xx, yy, zz)) for xx in (x0, x1) for yy in (-t / 2 - 0.25, t / 2 + 0.25) for zz in (0.0, hl + 0.9)]))
    return gaps


def add_colliders(coll, cols, tag):
    for i, c in enumerate(cols):
        if c[0] == "pts":
            collider_pts(coll, f"{tag}{i}", [tuple(p) for p in c[1]])
        else:
            x0, x1, y0, y1, h = c
            collider_box(coll, f"{tag}{i}", x0, x1, y0, y1, 0.0, h)


# --- 地坛 ------------------------------------------------------------------------------------------------

LOWER = (17.5, 0.0, 1.25)          # half size, bottom, top
UPPER = (10.25, 1.25, 2.53)
FLIGHT_W = dict(N=7.0, S=5.0, E=5.0, W=5.0)
MOAT = (LOWER[0], 19.4, 19.85)     # water from the tier face to 19.4, the kerb to 19.85
INNER = dict(half=42.5, h=1.5, t=0.63, gw=3.0, hl=3.0)
OUTER = dict(half=66.1, h=2.2, t=0.76, gw=3.4, hl=3.4)
COURT = dict(cx=-1.0, x0=-19.2, x1=17.2, y0=-107.5, y1=-76.0, h=2.9, t=0.6, gate=6.6)
HALL_Y = -101.2
HALL = SimpleNamespace(
    XS=[-9.6, -5.8, -2.0, 2.0, 5.8, 9.6], YS=[-4.3, -1.45, 1.45, 4.3], OX=9.6, OY=4.3, IX=5.8, IY=1.45,
    BEAM=(5.5, 6.0, 6.1, 6.75), UBEAM=(5.5, 6.0, 6.1, 6.75), OVERHANG=1.4, LOWER=None,
    UPPER=dict(A=11.0, D=5.7, z=6.5, H=3.5, p=1.5, o=0.5, lift=0.5, Lc=3.8, Vc=2.4),
    GABLE_X=8.3, PITCH=0.44, AMP=0.08, TRIM=0.0, RIDGE="tile", ROWS=8, END_ROWS=5, BRACKET_GAP=1.6)
HALL_BASE = 1.0
GATEHOUSE = SimpleNamespace(
    XS=[-3.3, -3.29, 3.29, 3.3], YS=[-1.1, -1.09, 1.09, 1.1], OX=3.3, OY=1.1, IX=3.29, IY=1.09,
    BEAM=(3.6, 4.0, 4.0, 4.3), UBEAM=(3.6, 4.0, 4.0, 4.3), OVERHANG=1.1, LOWER=None,
    UPPER=dict(A=4.4, D=2.3, z=4.25, H=1.9, p=1.5, o=0.4, lift=0.45, Lc=2.2, Vc=1.3),
    GABLE_X=3.0, PITCH=0.42, AMP=0.08, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=5, END_ROWS=4, BRACKET_GAP=1.0, WEN=0.5)


def stone_seat(g, x, y, mountains):
    """The stone seats on the lower tier: a block carved with mountains (岳, 镇) or with waves (海, 渎)."""
    g.box(x - 1.3, x + 1.3, y - 0.8, y + 0.8, LOWER[2], LOWER[2] + 0.5, "stone", skip=("-z",))
    z = LOWER[2] + 0.5
    if mountains:
        for dx, hh in ((-0.75, 0.55), (0.0, 0.8), (0.75, 0.55)):
            c = (x + dx, y, z + hh)
            base = [(x + dx - 0.42, y - 0.55, z), (x + dx + 0.42, y - 0.55, z), (x + dx + 0.42, y + 0.55, z), (x + dx - 0.42, y + 0.55, z)]
            for i in range(4):
                a, b = base[i], base[(i + 1) % 4]
                mx, my = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
                g.polyn([a, b, c], "stone", (mx, my, 0.4))
    else:
        for k in range(4):
            yy = y - 0.6 + 0.4 * k
            g.box(x - 1.15, x + 1.15, yy - 0.12, yy + 0.12, z, z + 0.12, "stone", skip=("-z",))


def gatehouse(g):
    """The 皇祇室 court's gate in its own frame (the opening along x, the court to +y): red piers, the painted
    beam, a small 庑殿 roof in yellow glaze; the studded leaves stand open."""
    H = GATEHOUSE
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 1.5, sx * H.OX))
        g.box(x0, x1, -H.OY, H.OY, 0.0, H.BEAM[0], "plaster", skip=("-z",))
        g.box(x0 - 0.05, x1 + 0.05, -H.OY - 0.05, H.OY + 0.05, 0.0, 0.5, "stone", skip=("-z",))
        g.polyn([(sx * 1.48, 0.4, 0.05), (sx * 1.48, 1.9, 0.05), (sx * 1.48, 1.9, 3.3), (sx * 1.48, 0.4, 3.3)], "atlas", (-sx, 0, 0), uvs=uvs("gatedoor", QUAD))
    for side in (-1, 1):
        g.polyn([(-H.OX, side * H.OY, H.BEAM[0]), (H.OX, side * H.OY, H.BEAM[0]), (H.OX, side * H.OY, H.BEAM[1]), (-H.OX, side * H.OY, H.BEAM[1])], "atlas", (0, side, 0), uvs=uvs("beam", QUAD))
        g.polyn([(-H.OX, side * H.OY, H.BEAM[1]), (H.OX, side * H.OY, H.BEAM[1]), (H.OX, side * H.OY, H.BEAM[3] + 0.05), (-H.OX, side * H.OY, H.BEAM[3] + 0.05)], "atlas", (0, side, 0), uvs=uvs("plank", QUAD))
    for sx in (-1, 1):
        g.polyn([(sx * H.OX, -H.OY, H.BEAM[0]), (sx * H.OX, H.OY, H.BEAM[0]), (sx * H.OX, H.OY, H.BEAM[3] + 0.05), (sx * H.OX, -H.OY, H.BEAM[3] + 0.05)], "plaster", (sx, 0, 0))
    g.polyn([(-1.5, -H.OY, H.BEAM[0]), (1.5, -H.OY, H.BEAM[0]), (1.5, H.OY, H.BEAM[0]), (-1.5, H.OY, H.BEAM[0])], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    g.box(-1.5, 1.5, -H.OY, H.OY, 0.0, 0.18, "stone", skip=("-z",))
    return roofs(H, g)


def hall(g):
    """皇祇室 in its own frame (front, the doors, to -y): the marble base, five bays of lattice in front (the
    middle one doors), plaster round the back and ends, the beams, the 歇山 roof."""
    H, z0 = HALL, HALL_BASE
    g.box(-H.OX - 1.5, H.OX + 1.5, -H.OY - 1.5, H.OY + 1.5, 0.0, z0, "marble", skip=("-z",))
    for rot, D, us in ring_sides(H, True):
        for i in range(len(us) - 1):
            P = lambda u, z: to_world(rot, D, u, 0.3, z)          # noqa: E731
            quad = [P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], H.BEAM[0]), P(us[i], H.BEAM[0])]
            if rot == 0:
                g.polyn(quad, "atlas", cdir(rot, 0, -1), uvs=uvs("door" if i == 2 else "window", QUAD))
            else:
                g.polyn(quad, "plaster", cdir(rot, 0, -1))
    ring_beams(H, g, True, *H.BEAM)
    return roofs(H, g)


def build():
    clear_file()
    ensure_addon()
    M = make_materials("DT")
    main = collection("方泽坛")
    g = Geo()
    ramps, cols = [], []

    # the altar: two tiers, eight steps down each side of each
    tier(g, LOWER[0], LOWER[1], LOWER[2])
    tier(g, UPPER[0], UPPER[1], UPPER[2])
    flights_round(g, UPPER[0], UPPER[2], UPPER[1], 8, FLIGHT_W, ramps, run=0.3)
    flights_round(g, LOWER[0], LOWER[2], LOWER[1], 8, {k: v + 1.0 for k, v in FLIGHT_W.items()}, ramps, run=0.3)
    for sx in (-1, 1):
        stone_seat(g, sx * 14.2, 4.2, True)
        stone_seat(g, sx * 14.2, -4.2, False)

    # the moat: dark water between the tier and a marble kerb, the flights crossing it
    a, b, c = MOAT
    gaps = {s: FLIGHT_W[s] + 1.0 + 2 * 0.45 for s in FLIGHT_W}
    for s in range(4):
        m = Rz(s * math.pi / 2)
        hw = gaps["SENW"[s]] / 2
        # this side's water strip (y -b..-a) and kerb (y -c..-b), each taking the corner to its left, split by the flight
        for x0, x1 in ((-b, -hw), (hw, a)):
            q = [m @ Vector(p) for p in ((x0, -b, 0.04), (x1, -b, 0.04), (x1, -a, 0.04), (x0, -a, 0.04))]
            g.polyn([tuple(p) for p in q], "water", (0, 0, 1))
        for x0, x1 in ((-c, -hw), (hw, b)):
            kb = Geo()
            kb.box(x0, x1, -c, -b, 0.0, 0.45, "marble", skip=("-z",))
            g.add(kb, m)
            q = [m @ Vector(p) for p in ((x0, -c, 0), (x1, -b, 0))]
            cols.append((min(p.x for p in q), max(p.x for p in q), min(p.y for p in q), max(p.y for p in q), 0.45))
    # the inner precinct paved, out to the inner wall
    hi = INNER["half"] - INNER["t"] / 2
    ring = [(-c, -c), (c, -c), (c, c), (-c, c)]
    outer = [(-hi, -hi), (hi, -hi), (hi, hi), (-hi, hi)]
    for i in range(4):
        p, q = ring[i], ring[(i + 1) % 4]
        P, Q = outer[i], outer[(i + 1) % 4]
        g.polyn([(P[0], P[1], 0.03), (Q[0], Q[1], 0.03), (q[0], q[1], 0.03), (p[0], p[1], 0.03)], "ground", (0, 0, 1))

    # the two enclosure walls and their 棂星门
    for W, tag in ((INNER, "inner"), (OUTER, "outer")):
        hs = W["half"]
        gaps = {}
        for side, m in SIDE_M.items():
            n = 3 if side == "N" else 1
            gaps[side] = gate_set(g, cols, m @ T(0, -hs, 0), n, W["gw"], W["t"], W["hl"])
        square_wall(g, hs, W["h"], W["t"], gaps, cols, tag)
    # the court of 皇祇室: its wall, the gatehouse, the hall
    C = COURT
    cw = (C["x1"] - C["x0"]) / 2
    ch = (C["y1"] - C["y0"]) / 2
    ccx, ccy = (C["x0"] + C["x1"]) / 2, (C["y0"] + C["y1"]) / 2
    square_wall_rect(g, ccx, ccy, cw, ch, C["h"], C["t"], C["gate"], cols)
    gh = Geo()
    ships_g = gatehouse(gh)
    mg = T(ccx, C["y1"], 0) @ Rz(math.pi)
    g.add(gh, mg)
    hg = Geo()
    ships_h = hall(hg)
    mh = T(ccx, HALL_Y, 0) @ Rz(math.pi)
    g.add(hg, mh)
    hr = []
    flight(g, 5.0, 5, HALL_BASE, 0.0, mh @ T(0, -HALL.OY - 1.5, 0), hr, run=0.32)
    g.polyn([(ccx - 1.6, C["y1"] - 1, 0.03), (ccx + 1.6, C["y1"] - 1, 0.03), (ccx + 1.6, HALL_Y + HALL.OY + 1.5 + 1.6, 0.03), (ccx - 1.6, HALL_Y + HALL.OY + 1.5 + 1.6, 0.03)], "ground", (0, 0, 1))
    g.build("Altar", collection("坛", main), M, TILE)
    tris = g.tris()

    # the linked parts: balustrades, columns, brackets, beasts
    parts = collection("构件", main)
    mesh = dict(
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
        column=mesh_of(column_geo(HALL.BEAM[0] - HALL_BASE, r=0.3), "Column", M, TILE),
        bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE),
        beast=mesh_of(beast_geo(glaze=YELLOW, lite=True), "BeastMesh", M, TILE),
        immortal=mesh_of(beast_geo(True, glaze=YELLOW), "ImmortalMesh", M, TILE),
    )
    square_rail(parts, mesh, UPPER[0] - 0.25, UPPER[2], FLIGHT_W, "RailU")
    square_rail(parts, mesh, LOWER[0] - 0.25, LOWER[2], {k: v + 1.0 for k, v in FLIGHT_W.items()}, "RailL")
    k = 0
    for rot, D, us in ring_sides(HALL, True):
        for u in us[1:]:
            place(mesh["column"], f"Column.{k:02d}", parts, mh @ T(*to_world(rot, D, u, 0, HALL_BASE)))
            k += 1
    for i, (p, yaw) in enumerate(bracket_spots(HALL, True, HALL.BEAM[2])):
        place(mesh["bracket"], f"Bracket.{i:03d}", parts, mh @ T(*p) @ Rz(yaw))
    for i, line in enumerate(ships_h):
        beasts_on([mh @ p for p in line], parts, mesh, f"Beast{i}", n=4)
    for i, line in enumerate(ships_g):
        beasts_on([mg @ p for p in line], parts, mesh, f"GBeast{i}", n=2)

    # the far level
    far = Geo()
    far.box(-LOWER[0], LOWER[0], -LOWER[0], LOWER[0], 0.0, LOWER[2], "glaze", skip=("-z",))
    far.box(-UPPER[0], UPPER[0], -UPPER[0], UPPER[0], LOWER[2], UPPER[2], "glaze", skip=("-z",))
    for W in (INNER, OUTER):
        hs, t = W["half"], W["t"]
        for s in range(4):
            fw = Geo()
            fw.box(-hs, hs, -hs - t / 2, -hs + t / 2, 0.0, W["h"] + 0.4, "plaster", skip=("-z",))
            far.add(fw, Rz(s * math.pi / 2))
    for (x0, x1, y0, y1) in ((C["x0"], C["x1"], C["y0"], C["y0"] + C["t"]), (C["x0"], C["x1"], C["y1"] - C["t"], C["y1"]),
                             (C["x0"], C["x0"] + C["t"], C["y0"], C["y1"]), (C["x1"] - C["t"], C["x1"], C["y0"], C["y1"])):
        far.box(x0, x1, y0, y1, 0.0, C["h"] + 0.4, "plaster", skip=("-z",))
    fh = Geo()
    fh.box(-HALL.OX, HALL.OX, -HALL.OY, HALL.OY, 0.0, HALL.UPPER["z"] + 0.3, "plaster", skip=("-z",))
    roofs(HALL, fh, lod=True)
    far.add(fh, mh)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders
    helpers = collection("碰撞体")
    collider_box(helpers, "lower", -LOWER[0], LOWER[0], -LOWER[0], LOWER[0], 0.0, LOWER[2])
    collider_box(helpers, "upper", -UPPER[0], UPPER[0], -UPPER[0], UPPER[0], 0.0, UPPER[2])
    for sx in (-1, 1):
        for sy in (-1, 1):
            collider_box(helpers, "seat", sx * 14.2 - 1.3, sx * 14.2 + 1.3, sy * 4.2 - 0.8, sy * 4.2 + 0.8, 0.0, LOWER[2] + 1.2)
    for i, pts in enumerate(ramps + hr):
        collider_pts(helpers, f"flight{i}", [tuple(p) for p in pts], role="WALK")
    add_colliders(helpers, cols, "wall")
    # the hall: its base and body; the gatehouse's piers
    hb = [mh @ Vector((x, y, 0)) for x in (-HALL.OX - 1.5, HALL.OX + 1.5) for y in (-HALL.OY - 1.5, HALL.OY + 1.5)]
    collider_box(helpers, "hallbase", min(p.x for p in hb), max(p.x for p in hb), min(p.y for p in hb), max(p.y for p in hb), 0.0, HALL_BASE)
    collider_box(helpers, "hall", ccx - HALL.OX - 0.3, ccx + HALL.OX + 0.3, HALL_Y - HALL.OY - 0.3, HALL_Y + HALL.OY + 0.3, 0.0, 10.0)
    for sx in (-1, 1):
        x0, x1 = sorted((ccx + sx * 1.5, ccx + sx * GATEHOUSE.OX))
        collider_box(helpers, "gatepier", x0, x1, C["y1"] - GATEHOUSE.OY, C["y1"] + GATEHOUSE.OY, 0.0, 5.0)

    # what the model replaces: the altar's enclosure (OSM's moat and wall lines) and the 皇祇室 court
    o = OUTER["half"] + 0.8
    flat_marker(helpers, "precinct", [(-o, -o), (o, -o), (o, o), (-o, o)], "FOOTPRINT")
    flat_marker(helpers, "court", [(C["x0"] - 0.6, C["y0"] - 0.6), (C["x1"] + 0.6, C["y0"] - 0.6), (C["x1"] + 0.6, C["y1"] + 1.4), (C["x0"] - 0.6, C["y1"] + 1.4)], "FOOTPRINT")
    # the altar precinct is paved: no trees inside the inner wall; none in the hall
    i = INNER["half"] - 0.5
    flat_marker(helpers, "precinct_clear", [(-i, -i), (i, -i), (i, i), (-i, i)], "CLEAR")
    flat_marker(helpers, "hall_clear", [(ccx - 12.5, HALL_Y - 6.0), (ccx + 12.5, HALL_Y - 6.0), (ccx + 12.5, HALL_Y + 9.0), (ccx - 12.5, HALL_Y + 9.0)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "ditan", "地坛方泽坛", "Temple of Earth"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 1043.3, -4745.2, -5.47
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris)


def square_wall_rect(g, cx, cy, hx, hy, h, t, gate, cols):
    """A rectangular court wall round (cx, cy), half sizes hx, hy, the gate's opening in the middle of the north side."""
    pts = [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]
    runs = [(pts[0], pts[1]), (pts[1], pts[2]), (pts[3], pts[0]),
            (pts[2], (cx + gate / 2, cy + hy)), ((cx - gate / 2, cy + hy), pts[3])]
    for a, b in runs:
        a2, b2 = Vector(a), Vector(b)
        d = (b2 - a2).normalized()
        a2 -= d * (t / 2 if a in pts else 0)
        b2 += d * (t / 2 if b in pts else 0)
        wall_piece(g, a2, b2, h, t, "tile")
        if abs(d.x) > 0.5:
            cols.append((min(a2.x, b2.x), max(a2.x, b2.x), a2.y - t / 2, a2.y + t / 2, h + 0.4))
        else:
            cols.append((a2.x - t / 2, a2.x + t / 2, min(a2.y, b2.y), max(a2.y, b2.y), h + 0.4))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
