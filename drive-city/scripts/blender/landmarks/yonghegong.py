# 雍和宫 Yonghe Lama Temple, north of the 2nd Ring on 雍和宫大街, built in Blender with the timber halls of hall.py
# and marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/yonghegong.py -- [--out art/landmarks/yonghegong.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the temple's axis at game (1146.3, -4100.0), heading -1.0
# (the axis leans 1 degree west of north, as the halls' edges in OSM do). Everything is placed from OSM (way
# 24825312, the complex, and the ~50 building ways inside it) turned into this frame (`.scratch/lm/yonghegong/`):
# OSM traces the halls from the air, so a building's outline is its roof's eaves and the columns stand inside it.
#
# South to north: the forecourt with the 影壁 and three 牌楼 (the north one 三间四柱九楼 with 寰海尊亲 / 群生仁寿,
# the east and west 七楼 across the lane that runs through the square); the 辇道 between red walls; 昭泰门 (a
# glazed gate in the wall, three arched doorways); the Drum and Bell Towers and the octagonal stele pavilions;
# 雍和门 (天王殿: five bays, single-eaved 歇山, walked through); the square stele pavilion; 雍和宫 (the main hall:
# seven bays with a colonnade, on a platform with a 月台); 永佑殿 (five bays); 法轮殿 (seven bays, 抱厦 front and
# back, five small pavilions on the roof each carrying a gilt stupa, 一大四小); 万福阁 (three storeys, skirt roofs,
# a 歇山 top at 25 m) with its two-storey side pavilions 延绥阁 and 永康阁 joined to it by covered bridges; the
# 绥成殿 and its 顺山楼 closing the north. The side halls along the courts are simpler: 硬山 roofs with a painted
# tile texture instead of tile rows (yellow glaze, grey on the service buildings), 歇山 for the larger ones.
# Red walls with yellow copings enclose the courts (colliders); the courts are paved and walkable.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, coping, cyl, flat_marker, lathe, mesh_of,  # noqa: E402
                 paving, place, rect)
import hall  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, eave_edge, paint_atlas, plaster, ring_beams,  # noqa: E402
                  ring_sides, roof_face, roofs, soffit, sweep, to_world, uv, uvs, wen)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "yonghegong.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
PI2 = math.pi / 2

# --- flat textured roofs -----------------------------------------------------------------------------------
# hall.roofs() builds its faces through hall.roof_face; while FLAT is set, this wrapper builds them without the
# tile rows (a few rows and columns) under the key "ytex", whose material paints the rows, with UVs in the
# face's own frame (u along the eave, v up the slope). hall.py itself is not changed.
FLAT = {"on": False}
_roof_face = hall.roof_face
TEX_U, TEX_V = 3.68, 3.2          # metres per texture repeat: eight tile rows across, four courses up


def _flat_face(g, R, Dref, rot, A, Deave, top, cap=0.0, rows=10, waves=True, key="tile", cols=None, pitch=0.46, amp=0.1, trim=0.0):
    if not FLAT["on"]:
        return _roof_face(g, R, Dref, rot, A, Deave, top, cap=cap, rows=rows, waves=waves, key=key, cols=cols, pitch=pitch, amp=amp, trim=trim)
    f0 = len(g.f)
    out = _roof_face(g, R, Dref, rot, A, Deave, top, cap=cap, rows=min(rows, 4), waves=False, key="ytex",
                     cols=max(2, min(cols or 8, round(2 * max(A, cap) / 3.0))), pitch=pitch, amp=amp, trim=0.0)
    for i in range(f0, len(g.f)):
        idx, _, k, sm = g.f[i]
        uvl = []
        for vi in idx:
            x, y, _z = g.v[vi]
            for _ in range(rot):
                x, y = y, -x
            uvl.append((x / TEX_U, (y + Deave) / TEX_V))
        g.f[i] = (idx, uvl, k, sm)
    return out


hall.roof_face = _flat_face

# hall.roofs() draws a 歇山's ridge-end dragons (正吻) at full size whatever the roof; WEN_K scales them for the small ones.
WEN_K = {"k": 1.0}
_wen = hall.wen


def _scaled_wen(g, x, zt, facing, key="tile", k=None):
    return _wen(g, x, zt, facing, key=key, k=WEN_K["k"] if k is None else k)


hall.wen = _scaled_wen


def roofs_k(h, g, k):
    WEN_K["k"] = k
    out = roofs(h, g)
    WEN_K["k"] = 1.0
    return out


def tile_tex(name, col):
    """Glazed tile rows seen from above: eight rows of round tube tiles across, four courses up."""
    n = 256
    v, u = np.mgrid[0:n, 0:n] / n
    ph = (u * 8) % 1.0
    ridge = np.where(ph < 0.5, 0.78 + 0.34 * np.sqrt(np.clip(1 - ((ph - 0.25) / 0.25) ** 2, 0, 1)), 0.62 + 0.1 * np.sin(np.pi * (ph - 0.5) / 0.5))
    course = 1 - 0.18 * ((((v * 4) % 1) < 0.07) & (ph >= 0.5))
    rng = np.random.default_rng(5)
    a = srgb(col) * (ridge * course)[..., None] * (0.95 + 0.1 * rng.random((n, n, 1)))
    return image(name, a.astype(np.float32))


def materials():
    atlas, night = paint_atlas("YH", portrait=False, emblem=False)
    return dict(
        atlas=material("YH_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        plaster=material("YH_Plaster", "#a8321f", 0.85, tex=plaster(name="YH_PlasterTex", col="#a8321f"), props={"wet": "damp"}),
        marble=material("YH_Stone", "#d9d4c8", 0.55, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("YH_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        tile=material("YH_Tile", "#d9a02a", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        ytex=material("YH_TileRows", "#d9a02a", 0.35, tex=tile_tex("YH_TileRowsTex", "#dca52c"), props={"wet": "surface", "glowStrength": 0.55}),
        grey=material("YH_GreyTile", "#5f6163", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
        gtex=material("YH_GreyRows", "#5f6163", 0.55, tex=tile_tex("YH_GreyRowsTex", "#6a6d70"), props={"wet": "surface", "glowStrength": 0.5}),
        red=material("YH_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("YH_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material("YH_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        green=material("YH_Glaze", "#2e7d57", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        board=material("YH_Board", "#1d3f7a", 0.5, props={"wet": "damp"}),
        bronze=material("YH_Bronze", "#4a3d2a", 0.45, metal=0.8, props={"wet": "surface", "glow": "none"}),
    )


TILE = dict(plaster=4.0, marble=2.0, paving=4.0, tile=2.0, grey=2.0, red=2.0, gold=1.0, paint=1.0, green=2.0, board=2.0, bronze=1.0)
GREY = {"tile": "grey", "ytex": "gtex"}

# --- the scene's accumulators ----------------------------------------------------------------------------
G = Geo()                 # everything drawn, merged per material
FAR = Geo()               # the far level
COLS = []                 # (matrix, r, h) of column instances
BRK = []                  # bracket matrices
HIPS = []                 # (world hip line, beasts) for ridge beasts
COLL = []                 # ("box", x0, x1, y0, y1, z0, z1) or ("hull", pts) or ("walk", pts)
BODIES = []               # local plan rects the walls stop at


def M_of(cx, cy, rot):
    return T(cx, cy, 0) @ Rz(rot * PI2)


def to_local(m, x0, x1, y0, y1):
    ps = [m @ Vector((x, y, 0)) for x in (x0, x1) for y in (y0, y1)]
    return (min(p.x for p in ps), max(p.x for p in ps), min(p.y for p in ps), max(p.y for p in ps))


def cbox(m, x0, x1, y0, y1, z0, z1):
    a = to_local(m, x0, x1, y0, y1)
    COLL.append(("box", *a, z0, z1))


def body_rect(m, x0, x1, y0, y1, pad=0.4):
    a = to_local(m, x0, x1, y0, y1)
    BODIES.append((a[0] - pad, a[1] + pad, a[2] - pad, a[3] + pad))


def canon(r, facing):
    """A local eave rect and the way the hall faces -> (cx, cy, rot, half along the front, half deep)."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if facing in ("s", "n"):
        return cx, cy, (0 if facing == "s" else 2), (x1 - x0) / 2, (y1 - y0) / 2
    return cx, cy, (1 if facing == "e" else 3), (y1 - y0) / 2, (x1 - x0) / 2


def remap(g, keys):
    for i, (idx, u, k, sm) in enumerate(g.f):
        if k in keys:
            g.f[i] = (idx, u, keys[k], sm)


def column(m, x, y, z0, h, r):
    COLS.append((m @ T(x, y, z0), r, h))


# --- small pieces -----------------------------------------------------------------------------------------

def strip(g, a, b, z0, z1, reg, out, seg=4.0):
    """An atlas band from plan point a to b (canonical), split into pieces about `seg` long."""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
    n = max(1, round((b - a).length / seg))
    for i in range(n):
        p, q = a.lerp(b, i / n), a.lerp(b, (i + 1) / n)
        g.polyn([(p.x, p.y, z0), (q.x, q.y, z0), (q.x, q.y, z1), (p.x, p.y, z1)], "atlas", out, uvs=uvs(reg, QUAD))


def beam_band(g, bx, by, z0, z1, sides="nsew", off=0.1):
    x, y = bx + off, by + off
    if "s" in sides:
        strip(g, (-x, -y), (x, -y), z0, z1, "beam", (0, -1, 0))
    if "n" in sides:
        strip(g, (x, y), (-x, y), z0, z1, "beam", (0, 1, 0))
    if "e" in sides:
        strip(g, (x, -y), (x, y), z0, z1, "beam", (1, 0, 0))
    if "w" in sides:
        strip(g, (-x, y), (-x, -y), z0, z1, "beam", (-1, 0, 0))
    g.polyn([(-x, -y, z0), (x, -y, z0), (x, y, z0), (-x, y, z0)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))


def facade(g, bx, by, z0, zw, storeys=1, zm=None, back=False, passages=(), door_bays=1, key_end="plaster"):
    """The walls of a simple hall in its frame (front -y): lattice doors and windows between red posts on the
    front (the upper storey's band of windows over a plank on a two-storey 楼), plaster behind and at the ends;
    `passages` are x ranges left open through the building, lined and ceiled."""
    n = max(1, round(2 * bx / 3.6))
    us = [-bx + 2 * bx * i / n for i in range(n + 1)]
    mid = (n - 1) / 2
    top = zm if storeys == 2 else zw

    def pieces(u0, u1):
        out = [(u0, u1)]
        for a, b in passages:
            nxt = []
            for p, q in out:
                if b <= p or a >= q:
                    nxt.append((p, q))
                    continue
                if a > p:
                    nxt.append((p, a))
                if b < q:
                    nxt.append((b, q))
            out = nxt
        return [(p, q) for p, q in out if q - p > 0.05]
    for side in ((-1, 1) if back else (-1,)):
        y = side * by
        for i in range(n):
            reg = "door" if abs(i - mid) < door_bays / 2 + 0.01 else "window"
            for u0, u1 in pieces(us[i], us[i + 1]):
                g.polyn([(u0, y, z0), (u1, y, z0), (u1, y, top), (u0, y, top)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
                if storeys == 2:
                    g.polyn([(u0, y, zm), (u1, y, zm), (u1, y, zm + 0.45), (u0, y, zm + 0.45)], "atlas", (0, side, 0), uvs=uvs("plank", QUAD))
                    g.polyn([(u0, y, zm + 0.45), (u1, y, zm + 0.45), (u1, y, zw), (u0, y, zw)], "atlas", (0, side, 0), uvs=uvs("band", QUAD))
        for u in us:
            if any(a - 0.2 < u < b + 0.2 for a, b in passages):
                continue
            g.box(u - 0.18, u + 0.18, y - 0.12 if side < 0 else y - 0.02, y + 0.02 if side < 0 else y + 0.12, z0, zw, "red", skip=("-z", "+z"))
    if not back:
        # the back: plaster, open at the passages
        cuts = sorted(passages)
        xs = [-bx]
        for a, b in cuts:
            xs += [a, b]
        xs.append(bx)
        for i in range(0, len(xs), 2):
            g.polyn([(xs[i], by, z0), (xs[i + 1], by, z0), (xs[i + 1], by, zw), (xs[i], by, zw)], "plaster", (0, 1, 0))
    for sx in (-1, 1):
        g.polyn([(sx * bx, -by, z0), (sx * bx, by, z0), (sx * bx, by, zw), (sx * bx, -by, zw)], key_end, (sx, 0, 0))
    for a, b in passages:
        for x, s in ((a, 1), (b, -1)):
            g.polyn([(x, -by, z0), (x, by, z0), (x, by, zw - 0.9), (x, -by, zw - 0.9)], "plaster", (s, 0, 0))
        g.polyn([(a, -by, zw - 0.9), (b, -by, zw - 0.9), (b, by, zw - 0.9), (a, by, zw - 0.9)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
        g.polyn([(a, -by, zw - 0.9), (b, -by, zw - 0.9), (b, -by, zw), (a, -by, zw)], "plaster", (0, -1, 0))
        g.polyn([(a, by, zw - 0.9), (b, by, zw - 0.9), (b, by, zw), (a, by, zw)], "plaster", (0, 1, 0))


def base(g, bx, by, z0, pad=0.45):
    if z0 > 0:
        g.box(-bx - pad, bx + pad, -by - pad, by + pad, 0.0, z0, "marble", skip=("-z",))


def yroof(g, L, D, ze, H, gables=None, key="ytex", ends=0.45, p=1.4, rows=4, wen_k=0.42):
    """A 硬山 roof along x: two faces from the eaves (y = +-D, height ze) to the ridge (ze + H), running `ends`
    past the gable walls at x = +-L; `gables` = (wall half depth, wall top) draws the gable walls' peaks."""
    X = L + ends
    nc = max(2, round(2 * X / 3.0))

    def z_at(v):
        return ze + H * (max(0.0, v) / D) ** p
    for s in (-1, 1):
        vs = [D * (j / rows) ** 1.1 for j in range(rows + 1)]
        grid = [[g.vert((-X + 2 * X * i / nc, s * (D - v), z_at(v))) for i in range(nc + 1)] for v in vs]
        for j in range(rows):
            for i in range(nc):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                if s > 0:
                    q = q[::-1]
                uvq = [(g.v[k][0] / TEX_U, (D - abs(g.v[k][1])) / TEX_V) for k in q]
                g.face(q, key, uvs=uvq, smooth=True)
        # the eave's edge and the rafters under it back to the wall
        e0, e1 = Vector((-X, s * D, ze)), Vector((X, s * D, ze))
        g.polyn([e0, e1, e1 + Vector((0, 0, -0.3)), e0 + Vector((0, 0, -0.3))], "tile", (0, s, 0))
        if gables:
            wd, wt = gables
            g.polyn([(-X, s * D, ze - 0.3), (X, s * D, ze - 0.3), (X, s * wd, wt), (-X, s * wd, wt)], "atlas", (0, 0, -1),
                    uvs=uvs("rafters", ((0, 0), (1, 0), (1, 1), (0, 1))))
        # the verges down each end
        for sx in (-1, 1):
            edge = [Vector((sx * X, s * (D - v), z_at(v))) for v in vs]
            for a, b in zip(edge, edge[1:]):
                g.polyn([a + Vector((0, 0, 0.12)), b + Vector((0, 0, 0.12)), b + Vector((0, 0, -0.25)), a + Vector((0, 0, -0.25))], "tile", (sx, 0, 0))
    zt = ze + H
    g.box(-X - 0.1, X + 0.1, -0.32, 0.32, zt - 0.25, zt + 0.5, "tile")
    if wen_k:
        for sx in (-1, 1):
            wen(g, sx * (X - 0.2), zt + 0.1, sx, key="tile", k=wen_k)
    if gables:
        wd, wt = gables
        for sx in (-1, 1):
            vs = [D * (j / 6) for j in range(7)]
            prof = [(s * (D - v), z_at(v) - 0.12) for s in (-1,) for v in vs if D - v <= wd] + [(s * (D - v), z_at(v) - 0.12) for s in (1,) for v in reversed(vs) if D - v <= wd and v < D - 1e-6]
            pts = [(-wd, wt)] + [(-wd, z_at(D - wd) - 0.12)] + prof + [(wd, z_at(D - wd) - 0.12), (wd, wt)]
            g.polyn([(sx * (L + 0.3), y, z) for y, z in pts], "plaster", (sx, 0, 0))
    return zt


def simple_hall(r, facing, zw, roof="ying", tone="y", ov=1.3, storeys=1, zm=None, z0=0.35, passages=(), back=False, Hk=0.5, door_bays=1):
    """A side hall from its OSM eave rect: base, facade, beam band, a 硬山 or (textured) 歇山 roof."""
    cx, cy, rot, hx, hy = canon(r, facing)
    m = M_of(cx, cy, rot)
    g = Geo()
    by = hy - ov
    if roof == "ying":
        bx = hx - 0.75
        pas = []
        for a, b in passages:          # local ranges along the front -> canonical x
            if rot == 0:
                pas.append((a - cx, b - cx))
            elif rot == 2:
                pas.append((cx - b, cx - a))
            elif rot == 1:
                pas.append((a - cy, b - cy))
            else:
                pas.append((cy - b, cy - a))
        base(g, bx + 0.6, by, z0)
        facade(g, bx, by, z0, zw, storeys, zm, back, pas, door_bays)
        beam_band(g, bx, by, zw, zw + 0.5, sides="ns")
        for sx in (-1, 1):          # the gable walls (山墙), standing proud front and back
            g.box(min(sx * bx, sx * (bx + 0.6)), max(sx * bx, sx * (bx + 0.6)), -by - 0.3, by + 0.3, z0, zw + 0.5, "plaster", skip=("-z", "+z"))
        D = hy
        H = Hk * D + 0.4
        yroof(g, bx + 0.3, D, zw + 0.4, H, gables=(by + 0.3, zw + 0.5))
        top = zw + 0.4 + H
        body = (-bx - 0.6, bx + 0.6, -by - 0.3, by + 0.3)
        segs = [(-bx - 0.6, bx + 0.6)]
        for a, b in sorted(pas):
            last = segs.pop()
            segs += [(last[0], a), (b, last[1])]
    else:
        bx = hx - ov
        base(g, bx, by, z0)
        facade(g, bx, by, z0, zw, storeys, zm, back, (), door_bays)
        beam_band(g, bx, by, zw, zw + 0.55)
        D = hy
        A = hx
        U = dict(A=A, D=D, z=zw + 0.35, H=(Hk + 0.08) * D, p=1.5, o=min(0.8, 0.1 * D + 0.2), lift=min(0.8, 0.1 * D + 0.2), Lc=0.7 * D, Vc=0.42 * D)
        h = SimpleNamespace(XS=[-bx, bx], YS=[-by, by], OX=bx, OY=by, IX=bx, IY=by, BEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55), UBEAM=(zw, zw + 0.3, zw + 0.4, zw + 0.55),
                            OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.55 * D - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3)
        FLAT["on"] = True
        roofs_k(h, g, max(0.4, min(0.8, D / 8)))
        FLAT["on"] = False
        top = U["z"] + U["H"]
        body = (-bx, bx, -by, by)
        segs = [(-bx, bx)]
    if tone == "g":
        remap(g, GREY)
    G.add(g, m)
    for a, b in segs:
        cbox(m, a, b, body[2], body[3], 0.0, zw + 0.5)
    body_rect(m, *body)
    far_block(m, hx, hy, body, zw, top, tone)
    return m


def far_block(m, hx, hy, body, zw, top, tone="y"):
    f = Geo()
    f.box(body[0], body[1], body[2], body[3], 0.0, zw + 0.5, "plaster", skip=("-z",))
    far_roof(f, hx, hy, zw + 0.4, top, "grey" if tone == "g" else "tile")
    FAR.add(f, m)


def far_roof(f, A, D, ze, zt, key):
    r = max(0.0, A - D)
    f.polyn([(-A, -D, ze), (A, -D, ze), (r, 0, zt), (-r, 0, zt)], key, (0, -1, 1))
    f.polyn([(A, D, ze), (-A, D, ze), (-r, 0, zt), (r, 0, zt)], key, (0, 1, 1))
    f.polyn([(A, -D, ze), (A, D, ze), (r, 0, zt)], key, (1, 0, 1))
    f.polyn([(-A, D, ze), (-A, -D, ze), (-r, 0, zt)], key, (-1, 0, 1))


# --- the main halls (tile rows, brackets, columns, beasts) ------------------------------------------------

def spec(OX, OY, xs, ys, zb, ov, kind="xieshan", rows=7, end_rows=4, gap=1.8, Hk=0.58, big=True):
    k = 1.0 if big else 0.8
    BEAM = (zb, zb + 0.75 * k, zb + 0.95 * k, zb + 1.8 * k)
    A, D = OX + ov, OY + ov
    U = dict(A=A, D=D, z=BEAM[3] - 0.3, H=Hk * D, p=1.5, o=min(1.0, 0.1 * D + 0.2), lift=min(0.95, 0.1 * D + 0.2), Lc=0.7 * D, Vc=0.42 * D)
    return SimpleNamespace(XS=list(xs), YS=list(ys), OX=OX, OY=OY, IX=abs(xs[1]), IY=abs(ys[1]), BEAM=BEAM, UBEAM=BEAM, OVERHANG=ov,
                           LOWER=None, UPPER=U, GABLE_X=max(0.6, A - 0.5 * D - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND=kind,
                           ROWS=rows, END_ROWS=end_rows, LOWER_ROWS=4, BRACKET_GAP=gap)


def lin(a, n):
    return [-a + 2 * a * i / n for i in range(n + 1)]


def ceiling(g, x0, x1, y0, y1, z):
    nx, ny = max(1, round((x1 - x0) / 1.6)), max(1, round((y1 - y0) / 1.6))
    for i in range(nx):
        for j in range(ny):
            a0, a1 = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            b0, b1 = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
            g.polyn([(a0, b0, z), (a1, b0, z), (a1, b1, z), (a0, b1, z)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))


def ring_walls(g, h, z0, z1, outer, front_doors=3, back_doors=0, fill=("window", "plaster"), passage=False, inset=0.06, skip=(), door="door"):
    """Panels between the columns of a ring: doors in the middle bays of the front (and back), lattice windows in
    the rest of the long sides, plaster (or `fill[1]`) at the ends. `passage` leaves the middle bay open."""
    for rot, D, us in ring_sides(h, outer):
        if rot in skip:
            continue
        nb = len(us) - 1
        for i in range(nb):
            P = lambda u, z: to_world(rot, D, u, inset, z)          # noqa: E731
            q = [P(us[i], z0), P(us[i + 1], z0), P(us[i + 1], z1), P(us[i], z1)]
            mid = abs(i - (nb - 1) / 2)
            if passage and rot in (0, 2) and mid < 0.5:
                continue
            if rot == 0:
                reg = door if mid < front_doors / 2 else fill[0]
            elif rot == 2:
                reg = door if mid < back_doors / 2 else fill[0]
            else:
                reg = fill[1]
            if reg in ("plaster",):
                g.polyn(q, "plaster", hall.cdir(rot, 0, -1))
            else:
                g.polyn(q, "atlas", hall.cdir(rot, 0, -1), uvs=uvs(reg, QUAD))


def brackets_on(h, m, outer, z, scale=1.0):
    for p, yaw in bracket_spots(h, outer, z):
        BRK.append(m @ T(*p) @ Rz(yaw) @ Matrix.Diagonal((scale, scale, scale, 1.0)))


def columns_on(h, m, outer, z0, z1, r):
    for rot, D, us in ring_sides(h, outer):
        for u in us[1:]:
            p = to_world(rot, D, u, 0, z0)
            column(m, p.x, p.y, z0, z1 - z0, r)


def steps(g, x0, x1, y_edge, s, z0, z1, rise=0.15, run=0.32):
    """A flight on a platform's edge at y_edge going down to -y (s = -1) or +y (s = 1); returns the WALK ramp."""
    n = max(2, round((z1 - z0) / rise))
    for k in range(n):
        ya, yb = y_edge, y_edge + s * (n - k) * run
        g.box(x0, x1, min(ya, yb), max(ya, yb), z0, z0 + (z1 - z0) * (k + 1) / n, "marble", skip=("-z",))
    L = n * run
    for x in (x0 - 0.35, x1):
        g.box(x, x + 0.35, min(y_edge, y_edge + s * L), max(y_edge, y_edge + s * L), z0, z1 + 0.1, "marble", skip=("-z",))
    ye = y_edge + s * L
    return [(x0 - 0.35, y_edge, z1), (x1 + 0.35, y_edge, z1), (x0 - 0.35, ye, z0), (x1 + 0.35, ye, z0), (x0 - 0.35, y_edge, z0), (x1 + 0.35, y_edge, z0)]


def walk(m, pts):
    COLL.append(("walk", [tuple(m @ Vector(p)) for p in pts]))


def main_hall(name, r, h, base_z, colonnade, front_doors=3, back_doors=0, passage=False, beasts=5, front_steps=None, back_steps=None, col_r=0.42):
    """A hall on a ring spec with tile rows: platform, walls (on the inner ring behind a colonnade, or on the
    columns), beams, ceilings, the roof; columns and brackets as instances; beasts on the hips."""
    cx, cy = (r[0] + r[1]) / 2, (r[2] + r[3]) / 2
    m = M_of(cx, cy, 0)
    g = Geo()
    px, py = h.OX + 0.9, h.OY + 0.9
    if base_z > 0:
        g.box(-px, px, -py, py, 0.0, base_z, "marble", skip=("-z",))
    if colonnade:
        ring_walls(g, h, base_z, h.BEAM[0], False, front_doors, back_doors, passage=passage)
        for x0, x1, y0, y1 in ((-h.OX, h.OX, -h.OY, -h.IY), (-h.OX, h.OX, h.IY, h.OY), (h.IX, h.OX, -h.IY, h.IY), (-h.OX, -h.IX, -h.IY, h.IY)):
            ceiling(g, x0, x1, y0, y1, h.BEAM[1])
        g.polyn([(-h.IX, -h.IY, h.BEAM[0]), (h.IX, -h.IY, h.BEAM[0]), (h.IX, -h.IY, h.BEAM[3]), (-h.IX, -h.IY, h.BEAM[3])], "plaster", (0, -1, 0))
        columns_on(h, m, False, base_z, h.BEAM[0], col_r)
    else:
        ring_walls(g, h, base_z, h.BEAM[0], True, front_doors, back_doors, passage=passage)
    ring_beams(h, g, True, *h.BEAM)
    columns_on(h, m, True, base_z, h.BEAM[0], col_r)
    if passage:
        w = abs(h.XS[len(h.XS) // 2] - h.XS[len(h.XS) // 2 - 1]) / 2
        for x, s in ((-w, 1), (w, -1)):
            g.polyn([(x, -h.OY, base_z), (x, h.OY, base_z), (x, h.OY, h.BEAM[0]), (x, -h.OY, h.BEAM[0])], "plaster", (s, 0, 0))
        ceiling(g, -w, w, -h.OY, h.OY, h.BEAM[0])
    brackets_on(h, m, True, h.BEAM[2])
    hips = roofs(h, g)
    for line in hips:
        HIPS.append(([m @ p for p in line], beasts))
    ramps = []
    if front_steps:
        ramps.append(steps(g, -front_steps / 2, front_steps / 2, -py, -1, 0.0, base_z))
    if back_steps:
        ramps.append(steps(g, -back_steps / 2, back_steps / 2, py, 1, 0.0, base_z))
    G.add(g, m)
    for rp in ramps:
        walk(m, rp)
    # colliders: the platform, the body (split round the passage)
    if base_z > 0:
        cbox(m, -px, px, -py, py, 0.0, base_z)
    wx, wy = (h.IX, h.IY) if colonnade else (h.OX, h.OY)
    ztop = h.UPPER["z"]
    if passage:
        w = abs(h.XS[len(h.XS) // 2] - h.XS[len(h.XS) // 2 - 1]) / 2
        cbox(m, -wx, -w, -wy, wy, 0.0, ztop)
        cbox(m, w, wx, -wy, wy, 0.0, ztop)
        cbox(m, -w, w, -wy, wy, h.BEAM[0], ztop)
    else:
        cbox(m, -wx, wx, -wy, wy, 0.0, ztop)
    body_rect(m, -px, px, -py, py)
    f = Geo()
    f.box(-h.OX, h.OX, -h.OY, h.OY, 0.0, h.UPPER["z"] + 0.4, "plaster", skip=("-z",))
    far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.6, "tile")
    FAR.add(f, m)
    return m


# --- 法轮殿's roof pavilions and their gilt stupas ---------------------------------------------------------

def stupa(g, s, z):
    """A Tibetan stupa (a gilt 喇嘛塔), `s` metres tall: stepped base, the dome, the harmika, thirteen rings up the
    spire, the canopy, the jewel."""
    prof = [(0.4, 0.0), (0.4, 0.07), (0.34, 0.07), (0.34, 0.13), (0.29, 0.13), (0.29, 0.19), (0.24, 0.2), (0.29, 0.26), (0.31, 0.33),
            (0.29, 0.41), (0.22, 0.47), (0.13, 0.5), (0.14, 0.5), (0.14, 0.55), (0.17, 0.55), (0.17, 0.58), (0.1, 0.58)]
    for k in range(7):
        t = k / 7
        r = 0.1 - 0.055 * t
        z0 = 0.58 + 0.26 * t
        prof += [(r + 0.018, z0 + 0.012), (r, z0 + 0.03)]
    prof += [(0.045, 0.85), (0.13, 0.86), (0.13, 0.875), (0.04, 0.89), (0.05, 0.92), (0.04, 0.95), (0.015, 0.99), (0.0, 1.0)]
    prof = [(a * s, z + b * s) for a, b in prof]
    g.poly([(prof[0][0] * math.cos(2 * math.pi * i / 12), prof[0][0] * math.sin(2 * math.pi * i / 12), z) for i in range(12)][::-1], "gold")
    lathe(g, prof, 12, "gold")


def roof_pavilion(g, x, y, zb, hw, H_body, stupa_h):
    """A little square pavilion standing out of the roof: red lattice walls, a beam band, its own textured 歇山,
    the stupa on its ridge."""
    zt = zb + H_body
    for rot in range(4):
        P = lambda u, z: to_world(rot, hw, u, 0, z) + Vector((x, y, 0))      # noqa: E731
        g.polyn([P(-hw, zb), P(hw, zb), P(hw, zt), P(-hw, zt)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("window", QUAD))
        g.polyn([P(-hw - 0.1, zt), P(hw + 0.1, zt), P(hw + 0.1, zt + 0.4), P(-hw - 0.1, zt + 0.4)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("beam", QUAD))
    pg = Geo()
    ov = 0.9
    A = hw + ov
    U = dict(A=A, D=A, z=zt + 0.3, H=0.75 * A, p=1.5, o=0.45, lift=0.45, Lc=0.7 * A, Vc=0.42 * A)
    h = SimpleNamespace(XS=[-hw, hw], YS=[-hw, hw], OX=hw, OY=hw, IX=hw, IY=hw, BEAM=(zt, zt + 0.2, zt + 0.3, zt + 0.4), UBEAM=(zt, zt + 0.2, zt + 0.3, zt + 0.4),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.4, A - 0.55 * A - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile",
                        ROWS=3, END_ROWS=3, KIND="cuanjian")
    FLAT["on"] = True
    roofs(h, pg)
    FLAT["on"] = False
    pg.f = [f for f in pg.f if f[2] != "gold"]        # 攒尖's gilt finial: the stupa stands on its seat instead
    sg = Geo()
    stupa(sg, stupa_h, U["z"] + U["H"] + 0.2)
    pg.add(sg, Matrix.Identity(4))
    g.add(pg, T(x, y, 0))
    return U["z"] + U["H"] + 0.2 + stupa_h


# --- 万福阁 --------------------------------------------------------------------------------------------------

def skirt(g, R, IX, IY, zb, ov, rows=4):
    """A skirt roof (腰檐) from its eave up to a wall ring at +-IX, +-IY: four faces with tile rows, the eave edge,
    rafters, the ridge where it meets the wall. Returns the hips."""
    DL = R["D"] - IY
    hips = []
    for rot in range(4):
        A, De = (R["A"], R["D"]) if rot % 2 == 0 else (R["D"], R["A"])
        rs = roof_face(g, R, DL, rot, A, De, DL, rows=rows, waves=True, cols=10)
        eave_edge(g, rs[0])
        soffit(g, R, DL, rot, A, De, zb, span=ov)
        hips.append([r_[-1] for r_ in rs])
    zw = R["z"] + R["H"]
    g.box(-IX - 0.45, IX + 0.45, -IY - 0.45, -IY + 0.05, zw - 0.2, zw + 0.35, "tile")
    g.box(-IX - 0.45, IX + 0.45, IY - 0.05, IY + 0.45, zw - 0.2, zw + 0.35, "tile")
    g.box(-IX - 0.45, -IX + 0.05, -IY, IY, zw - 0.2, zw + 0.35, "tile")
    g.box(IX - 0.05, IX + 0.45, -IY, IY, zw - 0.2, zw + 0.35, "tile")
    for line in hips:
        sweep(g, line, 0.5, 0.4, key="tile")
    return hips


WFG_RECT = (-15.2, 16.3, 174.7, 199.7)
WFG_BASE = 1.0
RING_A = SimpleNamespace(XS=lin(13.45, 7), YS=lin(10.2, 5), OX=13.45, OY=10.2, IX=11.5, IY=8.3, BRACKET_GAP=1.9)
BEAM_A = (6.4, 7.1, 7.3, 8.0)
SKIRT_A = dict(A=15.75, D=12.5, z=7.7, H=1.6, p=1.3, o=0.9, lift=0.8, Lc=7.0, Vc=3.5)
FLOOR2 = 9.4
WFG = SimpleNamespace(
    XS=[-11.5, -10.0, -6.0, -2.0, 2.0, 6.0, 10.0, 11.5], YS=[-8.3, -6.8, -2.3, 2.3, 6.8, 8.3], OX=11.5, OY=8.3, IX=10.0, IY=6.8,
    BEAM=(12.6, 13.2, 13.35, 14.05), UBEAM=(18.4, 19.0, 19.15, 19.85), OVERHANG=2.0,
    LOWER=dict(A=13.5, D=10.3, z=13.75, H=1.6, p=1.3, o=0.8, lift=0.7, Lc=6.5, Vc=3.0),
    UPPER=dict(A=12.2, D=9.0, z=19.5, H=4.9, p=1.55, o=0.95, lift=0.9, Lc=6.5, Vc=3.8),
    GABLE_X=7.1, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=6, END_ROWS=3, LOWER_ROWS=3, BRACKET_GAP=1.9)
UP3 = 15.6
# the side pavilions: two storeys, double eaves, the upper floor level with 万福阁's balcony
PAVI = SimpleNamespace(
    XS=[-4.4, -3.0, 0.0, 3.0, 4.4], YS=[-4.25, -2.85, 0.0, 2.85, 4.25], OX=4.4, OY=4.25, IX=3.0, IY=2.85,
    BEAM=(6.6, 7.1, 7.25, 7.9), UBEAM=(12.6, 13.1, 13.25, 13.9), OVERHANG=1.6,
    LOWER=dict(A=6.0, D=5.85, z=7.5, H=1.5, p=1.3, o=0.5, lift=0.5, Lc=3.5, Vc=2.0),
    UPPER=dict(A=4.8, D=4.65, z=13.5, H=2.9, p=1.5, o=0.55, lift=0.55, Lc=3.3, Vc=2.0),
    GABLE_X=1.7, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3, LOWER_ROWS=3, BRACKET_GAP=1.5)
PAV_AT = [((-30.6, -18.6, 179.8, 191.5), "延绥阁"), ((18.6, 30.8, 180.4, 192.0), "永康阁")]


def wanfuge():
    r = WFG_RECT
    cx, cy = (r[0] + r[1]) / 2, (r[2] + r[3]) / 2
    m = M_of(cx, cy, 0)
    g = Geo()
    A, W = RING_A, WFG
    g.box(-A.OX - 0.9, A.OX + 0.9, -A.OY - 0.9, A.OY + 0.9, 0.0, WFG_BASE, "marble", skip=("-z",))
    # ground storey: walls on ring B's line behind the colonnade
    hB = SimpleNamespace(XS=W.XS, YS=W.YS, OX=W.OX, OY=W.OY, IX=W.IX, IY=W.IY)
    ring_walls(g, hB, WFG_BASE, BEAM_A[0], True, front_doors=3, inset=0.0)
    ring_beams(A, g, True, *BEAM_A)
    for x0, x1, y0, y1 in ((-A.OX, A.OX, -A.OY, -W.OY), (-A.OX, A.OX, W.OY, A.OY), (W.OX, A.OX, -W.OY, W.OY), (-A.OX, -W.OX, -W.OY, W.OY)):
        ceiling(g, x0, x1, y0, y1, BEAM_A[1])
    columns_on(A, m, True, WFG_BASE, BEAM_A[0], 0.45)
    brackets_on(A, m, True, BEAM_A[2])
    hips = skirt(g, SKIRT_A, W.OX, W.OY, BEAM_A[3] + 0.08, 2.3, rows=3)
    # the balcony (平座) of the second storey: a floor out to ring B, a rail, the storey's walls on ring C
    ob, ib = (W.OX + 0.3, W.OY + 0.3), (W.IX, W.IY)
    for (x0, x1, y0, y1) in ((-ob[0], ob[0], -ob[1], -ib[1]), (-ob[0], ob[0], ib[1], ob[1]), (ib[0], ob[0], -ib[1], ib[1]), (-ob[0], -ib[0], -ib[1], ib[1])):
        g.polyn([(x0, y0, FLOOR2), (x1, y0, FLOOR2), (x1, y1, FLOOR2), (x0, y1, FLOOR2)], "red", (0, 0, 1))
    for rot in range(4):
        Dd, Uu = (ob[1], ob[0]) if rot % 2 == 0 else (ob[0], ob[1])
        P = lambda u, z: to_world(rot, Dd, u, 0, z)          # noqa: E731
        g.polyn([P(-Uu, FLOOR2 - 0.5), P(Uu, FLOOR2 - 0.5), P(Uu, FLOOR2), P(-Uu, FLOOR2)], "atlas", hall.cdir(rot, 0, -1), uvs=uvs("plank", QUAD))
        g.polyn([P(-Uu, FLOOR2 + 0.95), P(Uu, FLOOR2 + 0.95), P(Uu, FLOOR2 + 1.05), P(-Uu, FLOOR2 + 1.05)], "red", hall.cdir(rot, 0, -1))
        n = max(2, round(2 * Uu / 1.2))
        for k in range(n + 1):
            p = P(-Uu + 2 * Uu * k / n, FLOOR2)
            g.box(p.x - 0.06, p.x + 0.06, p.y - 0.06, p.y + 0.06, FLOOR2, FLOOR2 + 1.0, "red", skip=("-z",))
    ring_walls(g, W, FLOOR2, W.BEAM[0], False, front_doors=3, fill=("window", "window"))
    ring_walls(g, W, UP3, W.UBEAM[0], False, front_doors=1, fill=("window", "window"))
    ring_beams(W, g, True, *W.BEAM)
    ring_beams(W, g, False, *W.UBEAM)
    for x0, x1, y0, y1 in ((-W.OX, W.OX, -W.OY, -W.IY), (-W.OX, W.OX, W.IY, W.OY), (W.IX, W.OX, -W.IY, W.IY), (-W.OX, -W.IX, -W.IY, W.IY)):
        ceiling(g, x0, x1, y0, y1, W.BEAM[1])
    columns_on(W, m, True, FLOOR2, W.BEAM[0], 0.34)
    columns_on(W, m, False, UP3 - 0.6, W.UBEAM[0], 0.38)
    brackets_on(W, m, True, W.BEAM[2], 0.85)
    brackets_on(W, m, False, W.UBEAM[2], 0.9)
    hips += roofs(W, g)
    for line in hips:
        HIPS.append(([m @ p for p in line], 5))
    ramp = steps(g, -4.0, 4.0, -A.OY - 0.9, -1, 0.0, WFG_BASE)
    G.add(g, m)
    walk(m, ramp)
    cbox(m, -A.OX - 0.9, A.OX + 0.9, -A.OY - 0.9, A.OY + 0.9, 0.0, WFG_BASE)
    cbox(m, -W.OX, W.OX, -W.OY, W.OY, 0.0, W.UPPER["z"])
    body_rect(m, -A.OX - 0.9, A.OX + 0.9, -A.OY - 0.9, A.OY + 0.9)
    f = Geo()
    f.box(-A.OX, A.OX, -A.OY, A.OY, 0.0, 8.0, "plaster", skip=("-z",))
    far_roof(f, SKIRT_A["A"], SKIRT_A["D"], SKIRT_A["z"], 9.3, "tile")
    f.box(-W.OX, W.OX, -W.OY, W.OY, 9.3, 14.0, "plaster", skip=("-z",))
    far_roof(f, W.LOWER["A"], W.LOWER["D"], W.LOWER["z"], 15.3, "tile")
    f.box(-W.IX, W.IX, -W.IY, W.IY, 15.3, 19.9, "plaster", skip=("-z",))
    far_roof(f, W.UPPER["A"], W.UPPER["D"], W.UPPER["z"], W.UPPER["z"] + W.UPPER["H"] + 0.6, "tile")
    FAR.add(f, m)

    # the side pavilions, and the covered bridges from their upper storeys to 万福阁's second
    for r2, _name in PAV_AT:
        pm = tower(r2, PAVI, 0.6, 9.4, doors_front=1)
        pcx = (r2[0] + r2[1]) / 2
        pcy = (r2[2] + r2[3]) / 2
        side = -1 if pcx < 0 else 1
        xa = pcx - side * PAVI.IX            # the pavilion's upper wall
        xb = cx + side * W.IX                 # 万福阁's ring C
        yc = pcy + (0.1 if side < 0 else -0.2)
        bridge(xa, xb, yc)
        del pm


def bridge(xa, xb, yc, hw=1.5, z0=FLOOR2):
    x0, x1 = sorted((xa, xb))
    g = Geo()
    L = (x1 - x0) / 2
    g.box(-L, L, -hw - 0.1, hw + 0.1, z0 - 0.45, z0, "red")
    for s in (-1, 1):
        y = s * hw
        n = max(2, round(2 * L / 2.4))
        for i in range(n):
            u0, u1 = -L + 2 * L * i / n, -L + 2 * L * (i + 1) / n
            g.polyn([(u0, y, z0), (u1, y, z0), (u1, y, z0 + 2.1), (u0, y, z0 + 2.1)], "atlas", (0, s, 0), uvs=uvs("band", QUAD))
        for i in range(n + 1):
            u = -L + 2 * L * i / n
            g.box(u - 0.14, u + 0.14, y - 0.14, y + 0.14, z0, z0 + 2.5, "red", skip=("-z",))
        strip(g, (-L, y + s * 0.02), (L, y + s * 0.02), z0 + 2.1, z0 + 2.55, "beam", (0, s, 0), seg=3.0)
    g.polyn([(-L, -hw, z0 + 2.3), (L, -hw, z0 + 2.3), (L, hw, z0 + 2.3), (-L, hw, z0 + 2.3)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))
    yroof(g, L, hw + 0.9, z0 + 2.45, 1.0, gables=None, ends=-0.05, wen_k=0)
    m = T((x0 + x1) / 2, yc, 0)
    G.add(g, m)
    f = Geo()
    f.box(-L, L, -hw, hw, z0 - 0.45, z0 + 2.5, "plaster")
    far_roof(f, L, hw + 0.9, z0 + 2.45, z0 + 3.4, "tile")
    FAR.add(f, m)


def tower(r, h, base_z, up0, doors_front=1, ground="window", ground_ends="plaster", upper_fill=("window", "window"), facing="s", doors_back=0, door="door"):
    """A two-storey pavilion on a double-eave spec with textured roofs: the ground storey walled on the outer ring,
    the skirt, the upper storey on the inner ring."""
    cx, cy, rot, hx, hy = canon(r, facing)
    m = M_of(cx, cy, rot)
    g = Geo()
    g.box(-h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5, 0.0, base_z, "marble", skip=("-z",))
    ring_walls(g, h, base_z, h.BEAM[0], True, front_doors=doors_front, back_doors=doors_back, fill=(ground, ground_ends), inset=0.0, door=door)
    ring_walls(g, h, up0, h.UBEAM[0], False, front_doors=0, fill=upper_fill)
    beam_band(g, h.OX, h.OY, h.BEAM[0], h.BEAM[3], off=0.05)
    beam_band(g, h.IX, h.IY, h.UBEAM[0], h.UBEAM[3], off=0.05)
    # the band between the skirt's top and the upper storey's sill
    zs = h.LOWER["z"] + h.LOWER["H"]
    for rot2 in range(4):
        Dd, Uu = (h.IY, h.IX) if rot2 % 2 == 0 else (h.IX, h.IY)
        P = lambda u, z: to_world(rot2, Dd, u, -0.02, z)          # noqa: E731
        g.polyn([P(-Uu, zs - 0.3), P(Uu, zs - 0.3), P(Uu, up0), P(-Uu, up0)], "atlas", hall.cdir(rot2, 0, -1), uvs=uvs("plank", QUAD))
    FLAT["on"] = True
    roofs_k(h, g, max(0.4, min(0.8, h.UPPER["D"] / 7)))
    FLAT["on"] = False
    G.add(g, m)
    for x, y in ((h.OX, h.OY), (-h.OX, h.OY), (h.OX, -h.OY), (-h.OX, -h.OY)):
        column(m, x, y, base_z, h.BEAM[0] - base_z, 0.3)
    cbox(m, -h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5, 0.0, h.UBEAM[0])
    body_rect(m, -h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5)
    f = Geo()
    f.box(-h.OX, h.OX, -h.OY, h.OY, 0.0, h.LOWER["z"] + 0.3, "plaster", skip=("-z",))
    far_roof(f, h.LOWER["A"], h.LOWER["D"], h.LOWER["z"], zs, "tile")
    f.box(-h.IX, h.IX, -h.IY, h.IY, zs, h.UPPER["z"] + 0.3, "plaster", skip=("-z",))
    far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.5, "tile")
    FAR.add(f, m)
    return m


def tower_spec(half, ov, z_beam, z_up0, z_ubeam, inner):
    """A square two-storey pavilion (bell and drum towers, the stele pavilion) from its eave half size."""
    OX = half - ov
    IX = inner
    A2 = IX + ov * 1.15
    return SimpleNamespace(
        XS=[-OX, -IX, 0.0, IX, OX], YS=[-OX, -IX, 0.0, IX, OX], OX=OX, OY=OX, IX=IX, IY=IX,
        BEAM=(z_beam, z_beam + 0.55, z_beam + 0.7, z_beam + 1.3), UBEAM=(z_ubeam, z_ubeam + 0.5, z_ubeam + 0.65, z_ubeam + 1.25), OVERHANG=ov,
        LOWER=dict(A=half, D=half, z=z_beam + 0.95, H=z_up0 - 0.35 - (z_beam + 0.95), p=1.3, o=0.5, lift=0.5, Lc=3.5, Vc=2.0),
        UPPER=dict(A=A2, D=A2, z=z_ubeam + 0.9, H=0.62 * A2, p=1.5, o=0.55, lift=0.55, Lc=0.7 * A2, Vc=0.42 * A2),
        GABLE_X=max(0.8, A2 - 0.5 * A2 - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3, LOWER_ROWS=3, BRACKET_GAP=1.5)


# --- octagonal stele pavilions ----------------------------------------------------------------------------

def octagon(cx, cy, R_eave=5.0):
    g = Geo()
    rb, z0, zw = 3.3, 0.4, 4.6
    ang = [math.pi / 8 + k * math.pi / 4 for k in range(8)]
    ring = lambda r, z: [Vector((r * math.cos(a), r * math.sin(a), z)) for a in ang]       # noqa: E731
    lathe_base = ring(rb + 0.5, 0.0), ring(rb + 0.5, z0)
    for i in range(8):
        j = (i + 1) % 8
        a0, a1 = lathe_base[0][i], lathe_base[0][j]
        b0, b1 = lathe_base[1][i], lathe_base[1][j]
        mid = (a0 + a1) / 2
        g.polyn([a0, a1, b1, b0], "marble", (mid.x, mid.y, 0))
    g.polyn(lathe_base[1], "marble", (0, 0, 1))
    w0, w1, bb = ring(rb, z0), ring(rb, zw), ring(rb + 0.08, zw + 0.55)
    for i in range(8):
        j = (i + 1) % 8
        mid = (w0[i] + w0[j]) / 2
        door = i % 2 == 1                  # the faces on the four axes
        if door:
            g.polyn([w0[i], w0[j], w1[j], w1[i]], "atlas", (mid.x, mid.y, 0), uvs=uvs("gatedoor", QUAD))
        else:
            g.polyn([w0[i], w0[j], w1[j], w1[i]], "plaster", (mid.x, mid.y, 0))
        g.polyn([w1[i] + Vector((mid.x, mid.y, 0)).normalized() * 0.08, w1[j] + Vector((mid.x, mid.y, 0)).normalized() * 0.08, bb[j], bb[i]],
                "atlas", (mid.x, mid.y, 0), uvs=uvs("beam", QUAD))
    # the roof: eight faces to the apex, the corners swept up, tile texture; hips and the finial
    ze, H = zw + 0.95, 3.6
    rows, cols = 4, 3
    grid = []
    for j in range(rows + 1):
        t = j / rows
        z = ze + H * t ** 1.5
        rr = R_eave * (1 - t)
        row = []
        for i in range(8):
            for c in range(cols):
                f = c / cols
                a = ang[i] + (ang[(i + 1) % 8] - ang[i] + (2 * math.pi if i == 7 else 0)) * f
                # a point on the octagon's edge between corners i and i + 1
                p0 = Vector((math.cos(ang[i]), math.sin(ang[i]))) * rr
                p1 = Vector((math.cos(ang[(i + 1) % 8]), math.sin(ang[(i + 1) % 8]))) * rr
                p = p0.lerp(p1, f)
                lift = 0.55 * (abs(f - 0.5) * 2) ** 2 * (1 - t) ** 2
                row.append(g.vert((p.x * (1 + 0.08 * lift), p.y * (1 + 0.08 * lift), z + lift)))
                del a
        grid.append(row)
    N = 8 * cols
    for j in range(rows):
        for i in range(N):
            k = (i + 1) % N
            q = [grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]]
            cw = 2 * R_eave * math.sin(math.pi / 8) / cols
            uvq = [(i * cw / TEX_U, j * 1.3 / TEX_V), ((i + 1) * cw / TEX_U, j * 1.3 / TEX_V), ((i + 1) * cw / TEX_U, (j + 1) * 1.3 / TEX_V), (i * cw / TEX_U, (j + 1) * 1.3 / TEX_V)]
            g.face(q, "ytex", uvs=uvq, smooth=True)
    for i in range(N):
        k = (i + 1) % N
        a, b = Vector(g.v[grid[0][i]]), Vector(g.v[grid[0][k]])
        g.poly([a, a + Vector((0, 0, -0.28)), b + Vector((0, 0, -0.28)), b], "tile")
        g.poly([a + Vector((0, 0, -0.28)), Vector((a.x, a.y, 0)).normalized() * (rb + 0.1) + Vector((0, 0, zw + 0.55)),
                Vector((b.x, b.y, 0)).normalized() * (rb + 0.1) + Vector((0, 0, zw + 0.55)), b + Vector((0, 0, -0.28))], "atlas",
               uvs=uvs("rafters", ((0, 0), (0, 1), (1, 1), (1, 0))))
    for i in range(8):
        line = [Vector(g.v[grid[j][i * cols]]) for j in range(rows + 1)]
        sweep(g, line, 0.35, 0.3, key="tile")
    from round import finial
    finial(g, ze + H - 0.1, 1.6, r=0.35)
    m = T(cx, cy, 0)
    G.add(g, m)
    COLL.append(("hull", [tuple(m @ p) for p in ring(rb + 0.5, 0.0) + ring(rb, zw)]))
    BODIES.append((cx - rb - 0.8, cx + rb + 0.8, cy - rb - 0.8, cy + rb + 0.8))
    f = Geo()
    ra, rt = ring(rb, 0.0), ring(rb, zw + 0.5)
    ee = ring(R_eave, ze)
    for i in range(8):
        j = (i + 1) % 8
        mid = (ra[i] + ra[j]) / 2
        f.polyn([ra[i], ra[j], rt[j], rt[i]], "plaster", (mid.x, mid.y, 0))
        f.polyn([ee[i], ee[j], Vector((0, 0, ze + H))], "tile", (mid.x, mid.y, 1))
    FAR.add(f, m)


# --- gate, screen wall, archways, walls ---------------------------------------------------------------------

def arched_block(g, x0, x1, y0, y1, zt, arches, key="plaster", segs=10):
    """A block along x pierced front to back by arched openings [(xc, w, crown)]."""
    arches = sorted(arches)

    def arc(xc, w, c):
        r = w / 2
        return [(xc - r * math.cos(math.pi * k / segs), c - r + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    for y, s in ((y0, -1), (y1, 1)):
        xa = x0
        for xc, w, c in arches:
            g.polyn([(xa, y, 0), (xc - w / 2, y, 0), (xc - w / 2, y, zt), (xa, y, zt)], key, (0, s, 0))
            pts = arc(xc, w, c)
            g.polyn([(x, y, z) for x, z in pts] + [(xc + w / 2, y, zt), (xc - w / 2, y, zt)], key, (0, s, 0))
            xa = xc + w / 2
        g.polyn([(xa, y, 0), (x1, y, 0), (x1, y, zt), (xa, y, zt)], key, (0, s, 0))
        # a glazed frame round each arch
        for xc, w, c in arches:
            po, pi = arc(xc, w + 0.6, c + 0.3), arc(xc, w, c)
            yy = y + s * 0.05
            for k in range(len(po) - 1):
                g.polyn([(pi[k][0], yy, pi[k][1]), (pi[k + 1][0], yy, pi[k + 1][1]), (po[k + 1][0], yy, po[k + 1][1]), (po[k][0], yy, po[k][1])], "green", (0, s, 0))
    for xc, w, c in arches:
        sec = [(xc - w / 2, 0.0)] + arc(xc, w, c) + [(xc + w / 2, 0.0)]
        for (xa_, za), (xb_, zb) in zip(sec, sec[1:]):
            mx, mz = (xa_ + xb_) / 2, (za + zb) / 2
            g.polyn([(xa_, y0, za), (xb_, y0, zb), (xb_, y1, zb), (xa_, y1, za)], key, (xc - mx, 0, (c - w / 2) - mz if mz > c - w / 2 else 0))
    for x, s in ((x0, -1), (x1, 1)):
        g.polyn([(x, y0, 0), (x, y1, 0), (x, y1, zt), (x, y0, zt)], key, (s, 0, 0))


def zhaotaimen():
    """昭泰门: a glazed gate in the wall, three arched doorways, a green-glazed frame, a painted cornice and a
    yellow 歇山 roof."""
    cx, cy = 0.0, -21.5
    g = Geo()
    hw, hd, zt = 5.6, 1.1, 5.4
    arches = [(0.0, 3.2, 4.4), (-3.55, 1.9, 3.3), (3.55, 1.9, 3.3)]
    arched_block(g, -hw, hw, -hd, hd, zt, arches)
    g.box(-hw - 0.2, hw + 0.2, -hd - 0.2, hd + 0.2, zt, zt + 0.35, "green")
    beam_band(g, hw, hd, zt + 0.35, zt + 0.9, off=0.15)
    h = SimpleNamespace(XS=[-hw, hw], YS=[-hd, hd], OX=hw, OY=hd, IX=hw, IY=hd, BEAM=(zt, zt + 0.5, zt + 0.7, zt + 0.95), UBEAM=(zt, zt + 0.5, zt + 0.7, zt + 0.95),
                        OVERHANG=1.2, LOWER=None, UPPER=dict(A=hw + 1.2, D=hd + 1.2, z=zt + 1.15, H=1.6, p=1.4, o=0.4, lift=0.4, Lc=2.0, Vc=1.1),
                        GABLE_X=hw - 0.4, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=3, END_ROWS=2, KIND="xieshan")
    FLAT["on"] = True
    roofs_k(h, g, 0.45)
    FLAT["on"] = False
    m = T(cx, cy, 0)
    G.add(g, m)
    x = -hw
    for xc, w, c in sorted(arches):
        COLL.append(("box", cx + x, cx + xc - w / 2, cy - hd, cy + hd, 0.0, zt + 1.0))
        COLL.append(("box", cx + xc - w / 2, cx + xc + w / 2, cy - hd, cy + hd, c, zt + 1.0))
        x = xc + w / 2
    COLL.append(("box", cx + x, cx + hw, cy - hd, cy + hd, 0.0, zt + 1.0))
    BODIES.append((cx - hw - 0.3, cx + hw + 0.3, cy - hd - 0.5, cy + hd + 0.5))
    f = Geo()
    f.box(-hw, hw, -hd, hd, 0.0, zt + 0.9, "plaster", skip=("-z",))
    far_roof(f, hw + 1.2, hd + 1.2, zt + 1.15, zt + 2.8, "tile")
    FAR.add(f, m)


def screen_wall(cx, cy, hw=13.0, hd=0.7):
    """The 影壁 closing the forecourt's south: a stone plinth, a red wall with a glazed panel, a tiled coping."""
    g = Geo()
    g.box(-hw - 0.3, hw + 0.3, -hd - 0.25, hd + 0.25, 0.0, 1.0, "marble", skip=("-z",))
    g.box(-hw, hw, -hd, hd, 1.0, 5.3, "plaster", skip=("-z", "+z"))
    for s in (-1, 1):
        y = s * (hd + 0.03)
        g.polyn([(-3.5, y, 2.0), (3.5, y, 2.0), (3.5, y, 4.4), (-3.5, y, 4.4)], "green", (0, s, 0))
        g.polyn([(-4.0, y, 1.7), (4.0, y, 1.7), (4.0, y, 2.0), (-4.0, y, 2.0)], "tile", (0, s, 0))
        g.polyn([(-4.0, y, 4.4), (4.0, y, 4.4), (4.0, y, 4.7), (-4.0, y, 4.7)], "tile", (0, s, 0))
        for x in (-4.0, 3.7):
            g.polyn([(x, y, 2.0), (x + 0.3, y, 2.0), (x + 0.3, y, 4.4), (x, y, 4.4)], "tile", (0, s, 0))
        strip(g, (-hw, y + s * 0.05), (hw, y + s * 0.05), 4.8, 5.3, "beam", (0, s, 0))
    h = SimpleNamespace(XS=[-hw, hw], YS=[-hd, hd], OX=hw, OY=hd, IX=hw, IY=hd, BEAM=(4.8, 5.1, 5.2, 5.4), UBEAM=(4.8, 5.1, 5.2, 5.4),
                        OVERHANG=0.7, LOWER=None, UPPER=dict(A=hw + 0.7, D=hd + 0.7, z=5.3, H=1.0, p=1.4, o=0.3, lift=0.3, Lc=1.2, Vc=0.6),
                        GABLE_X=hw - 0.5, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=3, END_ROWS=2, KIND="wudian", WEN=0.5)
    FLAT["on"] = True
    roofs(h, g)
    FLAT["on"] = False
    m = T(cx, cy, 0)
    G.add(g, m)
    COLL.append(("box", cx - hw - 0.3, cx + hw + 0.3, cy - hd - 0.25, cy + hd + 0.25, 0.0, 6.0))
    f = Geo()
    f.box(-hw, hw, -hd, hd, 0.0, 6.2, "plaster", skip=("-z",))
    FAR.add(f, m)


def plaque_text(coll, M, text, x, y, z, w, hgt, face, name):
    """Gilt characters on a board, the board's plane facing `face` (-1 south, +1 north), in the archway's frame."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = text, bpy.data.fonts.load(FONT, check_existing=True), 1.0, 0.04
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 3
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


def pailou(cx, cy, rot, cols, roofs_def, M, parts, plaques=None, tag="P", braces=True):
    """A 牌楼 in its frame (along x, faces +-y): columns in stone clamps with raking braces, the beams and
    frieze under each bay, a small 庑殿 (textured) over each roof segment on a bracket band, the gilt-edged board."""
    g = Geo()
    m = M_of(cx, cy, rot)
    COL_R = 0.32
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
        # the frieze wall under the brackets, the plank over it
        bg.box(-L / 2, L / 2, -0.2, 0.2, zb - (1.5 if main else 0.7), zb + 0.5, "plaster", skip=("-z",))
        for za, zc, reg in (((zb - 0.55, zb, "beam"), (zb - 1.05, zb - 0.55, "plank"), (zb - 1.5, zb - 1.05, "beam")) if main else ((zb - 0.5, zb, "beam"),)):
            for side in (-1, 1):
                bg.polyn([(-L / 2, side * 0.27, za), (L / 2, side * 0.27, za), (L / 2, side * 0.27, zc), (-L / 2, side * 0.27, zc)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
            bg.polyn([(-L / 2, -0.27, za), (L / 2, -0.27, za), (L / 2, 0.27, za), (-L / 2, 0.27, za)], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))
        bg.box(-L / 2 - 0.1, L / 2 + 0.1, -0.33, 0.33, zb + 0.5, zb + 0.62, "red")
        FLAT["on"] = True
        roofs(h, bg)
        FLAT["on"] = False
        mm = T((x0 + x1) / 2, 0, 0)
        g.add(bg, mm)
        n = max(2, round(L / 1.1))
        for j in range(n + 1):
            x = x0 + L * j / n
            for side, yaw in ((-1, 0.0), (1, math.pi)):
                BRK.append(m @ T(x, side * 0.22, zb + 0.5) @ Rz(yaw) @ Matrix.Diagonal((0.55, 0.55, 0.55, 1.0)))
    # the board, between the middle bay's beams
    mid = [s for s in roofs_def if s[4]][0]
    zb = mid[2]
    bw, bh, bz = 2.8, 1.1, zb - 2.2
    for side in (-1, 1):
        g.polyn([(-bw / 2, side * 0.3, bz - bh / 2), (bw / 2, side * 0.3, bz - bh / 2), (bw / 2, side * 0.3, bz + bh / 2), (-bw / 2, side * 0.3, bz + bh / 2)], "board", (0, side, 0))
    g.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.32, 0.32, bz + bh / 2, zb - 1.5, "gold")
    g.box(-bw / 2 - 0.12, bw / 2 + 0.12, -0.32, 0.32, bz - bh / 2 - 0.12, bz - bh / 2, "gold")
    for sx in (-1, 1):
        g.box(sx * bw / 2 - (0.12 if sx < 0 else 0), sx * bw / 2 + (0.12 if sx > 0 else 0), -0.32, 0.32, bz - bh / 2, bz + bh / 2, "gold")
    # the columns' clamps and braces
    for x in cols:
        g.box(x - 0.5, x + 0.5, -0.5, 0.5, 0.0, 1.8, "marble", skip=("-z",))
        g.box(x - 0.56, x + 0.56, -0.56, 0.56, 1.8, 1.95, "marble", skip=("-z",))
        for side in ((-1, 1) if braces else ()):
            a, b = Vector((x, side * 0.2, 4.2)), Vector((x, side * 2.4, 0.0))
            d = (b - a).normalized()
            u = Vector((1, 0, 0))
            v = d.cross(u).normalized()
            ring_ = lambda c: [c + (u * math.cos(2 * math.pi * k / 6) + v * math.sin(2 * math.pi * k / 6)) * 0.13 for k in range(6)]   # noqa: E731
            A_, B_ = ring_(a), ring_(b)
            for k in range(6):
                j = (k + 1) % 6
                g.poly([A_[k], A_[j], B_[j], B_[k]], "red", smooth=True)
            g.box(x - 0.28, x + 0.28, side * 2.4 - 0.28, side * 2.4 + 0.28, 0.0, 0.32, "marble", skip=("-z",))
        top = max(zb_ for x0, x1, zb_, ze, mn in roofs_def if x0 - 0.3 <= x <= x1 + 0.3)
        column(m, x, 0.0, 1.95, top + 0.5 - 1.95, COL_R)
        COLL.append(("hull", [tuple(m @ Vector(p)) for p in ((x - 0.5, -0.5, 0), (x + 0.5, -0.5, 0), (x + 0.5, 0.5, 0), (x - 0.5, 0.5, 0),
                                                              (x - 0.5, -0.5, 9), (x + 0.5, -0.5, 9), (x + 0.5, 0.5, 9), (x - 0.5, 0.5, 9))]))
        for side in ((-1, 1) if braces else ()):
            COLL.append(("hull", [tuple(m @ Vector(p)) for p in ((x - 0.15, side * 0.3, 4.2), (x + 0.15, side * 0.3, 4.2), (x - 0.15, side * 2.4, 0.0),
                                                                  (x + 0.15, side * 2.4, 0.0), (x - 0.15, side * 0.3, 0.0), (x + 0.15, side * 0.3, 0.0))]))
    G.add(g, m)
    if plaques:
        for side, text in plaques:
            me, k, tx, ty = plaque_text(parts, M, text, 0.0, 0.0, bz, bw, bh, side, f"{tag}Plaque{side:+d}")
            mm = m @ T(0.0, side * 0.33, bz) @ Rz(0.0 if side < 0 else math.pi) @ Matrix.Rotation(PI2, 4, "X")
            for v in me.vertices:
                v.co = mm @ Vector(((v.co.x - tx) * k, (v.co.y - ty) * k, v.co.z))
            me.materials.append(M["gold"])
            o = bpy.data.objects.new(f"{tag}Plaque{side:+d}", me)
            parts.objects.link(o)
    f = Geo()
    for x in cols:
        f.box(x - 0.35, x + 0.35, -0.35, 0.35, 0.0, 6.0, "red", skip=("-z",))
    for x0, x1, zb_, ze, main in roofs_def:
        fb = Geo()
        fb.box(-(x1 - x0) / 2, (x1 - x0) / 2, -0.3, 0.3, zb_ - 1.0, zb_ + 0.5, "plaster")
        far_roof(fb, (x1 - x0) / 2 + 1.2, 1.55, ze, ze + (1.9 if main else 1.5), "tile")
        f.add(fb, T((x0 + x1) / 2, 0, 0))
    FAR.add(f, m)


def pailou_roofs(cols, big):
    """七楼 over four columns: 明楼 over the middle bay (highest), 次楼 over the side bays, 夹楼 over the inner columns
    and 边楼 over the outer ones (lowest); 九楼 (`big`) adds two small 夹楼 inside the middle bay beside a narrower 明楼."""
    a, b = abs(cols[1]), abs(cols[0])
    z = 7.4 if big else 6.8
    out = []
    if big:
        out += [(-a + 1.1, a - 1.1, z + 2.0, z + 3.1, True), (-a + 0.3, -a + 1.1, z + 1.2, z + 2.1, False), (a - 1.1, a - 0.3, z + 1.2, z + 2.1, False)]
    else:
        out += [(-a + 0.4, a - 0.4, z + 1.7, z + 2.9, True)]
    out += [(-a - 0.5, -a + (0.3 if big else 0.4), z + 0.3, z + 1.2, False), (a - (0.3 if big else 0.4), a + 0.5, z + 0.3, z + 1.2, False)]
    out += [(-b + 0.45, -a - 0.5, z + 0.9, z + 1.9, False), (a + 0.5, b - 0.45, z + 0.9, z + 1.9, False)]
    out += [(-b - 0.8, -b + 0.45, z, z + 0.9, False), (b - 0.45, b + 0.8, z, z + 0.9, False)]
    return out


def wall_runs(poly, closed=False, step=1.0):
    """The parts of a polyline outside every building body, as (a, b) plan segments."""
    pts = [Vector(p) for p in poly] + ([Vector(poly[0])] if closed else [])
    runs = []
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length
        n = max(1, round(L / step))
        cur = None
        for i in range(n):
            p, q = a.lerp(b, i / n), a.lerp(b, (i + 1) / n)
            mid = (p + q) / 2
            inside = any(x0 <= mid.x <= x1 and y0 <= mid.y <= y1 for x0, x1, y0, y1 in BODIES)
            if inside:
                if cur:
                    runs.append(cur)
                cur = None
            else:
                cur = [cur[0], q] if cur else [p, q]
        if cur:
            runs.append(cur)
    return runs


def walls(polys, zt=3.8, th=0.8):
    g = Geo()
    f = Geo()
    n = 0
    for poly, closed in polys:
        for a, b in wall_runs(poly, closed):
            d = (b - a)
            L = d.length
            if L < 0.5:
                continue
            u = d / L
            nrm = Vector((-u.y, u.x)) * (th / 2)
            c = [a - nrm, b - nrm, b + nrm, a + nrm]
            for i in range(4):
                p, q = c[i], c[(i + 1) % 4]
                mid = (p + q) / 2 - (a + b) / 2
                g.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, zt), (p.x, p.y, zt)], "plaster", (mid.x, mid.y, 0))
                f.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, zt), (p.x, p.y, zt)], "plaster", (mid.x, mid.y, 0))
            g.polyn([(p.x, p.y, zt) for p in c], "tile", (0, 0, 1))
            k = (th / 2 + 0.07) / (th / 2)
            cb = [a - nrm * k, b - nrm * k, b + nrm * k, a + nrm * k]
            for i in range(4):
                p, q = cb[i], cb[(i + 1) % 4]
                mid = (p + q) / 2 - (a + b) / 2
                g.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, 0.45), (p.x, p.y, 0.45)], "marble", (mid.x, mid.y, 0))
            for i in range(4):
                p, q, p2, q2 = cb[i], cb[(i + 1) % 4], c[i], c[(i + 1) % 4]
                mid = (p + q) / 2 - (a + b) / 2
                g.polyn([(p.x, p.y, 0.45), (q.x, q.y, 0.45), (q2.x, q2.y, 0.45), (p2.x, p2.y, 0.45)], "marble", (0, 0, 1))
            coping(g, (a.x, a.y), (b.x, b.y), th + 0.5, zt, rise=0.45, key="ytex")
            COLL.append(("hull", [(p.x, p.y, z) for p in c for z in (0.0, zt + 0.4)]))
            n += 1
    G.add(g, Matrix.Identity(4))
    FAR.add(f, Matrix.Identity(4))
    return n


# --- the plan --------------------------------------------------------------------------------------------------
# local rects from OSM (x0, x1, y0, y1): see the header. Main compound outline (the part north of the gate wall):
OUTLINE = [(-45.5, -21.2), (-45.6, 2.4), (-45.7, 31.0), (-45.8, 37.9), (-38.7, 37.9), (-38.6, 54.8), (-38.5, 85.1), (-38.5, 99.8),
           (-38.7, 200.3), (-38.7, 215.5), (-14.9, 215.5), (15.6, 215.3), (37.5, 215.2), (37.4, 206.9), (37.3, 179.4), (37.2, 142.4),
           (36.3, 99.0), (33.0, 79.0), (33.0, 54.8), (46.7, 54.6), (46.7, 30.4), (47.0, 2.5), (47.0, -20.6)]
# (the east wall between 54.8 and 142.4 is pulled back 1-4 m off OSM's line: the alley east of it, 5 m wide, would
# otherwise have its west edge inside the wall, and cars swing wide round its corner at y 70)
WALLS = [
    (OUTLINE, True),
    ([(-18.9, -21.0), (-19.4, -55.4), (-19.1, -179.0), (-6.9, -179.0)], False),          # 辇道 west
    ([(18.2, -20.9), (18.3, -54.1), (19.9, -179.0), (7.9, -178.8)], False),             # 辇道 east
    ([(-38.2, 31.0), (-19.2, 30.6)], False), ([(-16.0, 30.6), (-12.8, 30.5)], False),    # 雍和门's line
    ([(12.8, 30.3), (14.3, 30.3)], False), ([(18.0, 30.3), (33.0, 30.5), (33.0, 54.8)], False),
]

SIDE_HALLS = [
    # rect, facing, wall top, kwargs
    ((-31.3, -19.3, 43.6, 72.1), "e", 5.0, dict()),                                  # 讲经殿
    ((18.5, 31.8, 44.2, 72.8), "w", 5.0, dict()),                                    # 密宗殿
    ((21.4, 31.8, 72.6, 103.3), "w", 5.0, dict()),                                   # 药师殿
    ((-30.2, -22.4, 73.1, 84.5), "e", 3.8, dict()),                                  # 法物流通处
    ((-31.0, -21.2, 85.9, 104.0), "e", 4.6, dict()),                                 # 时轮殿
    ((-31.8, -19.5, 120.2, 141.2), "e", 4.8, dict()),                                # 西配殿
    ((19.1, 30.2, 121.3, 142.1), "w", 4.8, dict()),                                  # 东配殿
    ((-37.4, -18.2, 143.0, 161.2), "e", 7.2, dict(roof="xie", ov=1.8, storeys=2, zm=3.9, z0=0.4)),     # 戒台楼
    ((17.5, 37.4, 142.2, 161.5), "w", 7.2, dict(roof="xie", ov=1.8, storeys=2, zm=3.9, z0=0.4)),       # 班禅楼
    ((-37.6, -29.2, 161.1, 177.6), "e", 7.6, dict(storeys=2, zm=3.9)),              # 雅木达嘎楼
    ((29.0, 37.4, 161.4, 179.4), "w", 7.6, dict(storeys=2, zm=3.9)),                # 昭佛楼
    ((-38.7, -14.9, 206.9, 215.5), "s", 7.4, dict(storeys=2, zm=3.8)),              # 西顺山楼
    ((15.5, 37.5, 206.9, 215.3), "s", 7.4, dict(storeys=2, zm=3.8)),                # 东顺山楼
    ((-15.0, 15.6, 205.7, 215.5), "s", 8.6, dict(storeys=2, zm=4.4, z0=0.45, door_bays=3, Hk=0.55)),    # 绥成殿
    ((-31.2, -12.8, 32.9, 40.2), "s", 3.9, dict(passages=[(-18.7, -16.3)])),         # 雍和门's west wing
    ((12.8, 30.5, 32.9, 40.2), "s", 3.9, dict(passages=[(15.0, 17.4)])),             # east wing
    ((-30.6, -12.0, 108.1, 116.8), "s", 3.9, dict(passages=[(-17.4, -15.0)])),       # 永佑殿's west wing
    ((10.9, 30.2, 108.5, 116.8), "s", 3.9, dict(passages=[(15.6, 18.0)])),           # east wing
    # service buildings, grey tiles
    ((-45.7, -31.2, 31.1, 37.8), "s", 3.4, dict(tone="g", ov=1.0)),
    ((-38.6, -31.2, 37.8, 50.8), "e", 3.4, dict(tone="g", ov=1.0)),
    ((-45.8, -38.6, 37.9, 54.8), "e", 3.4, dict(tone="g", ov=1.0)),
    ((-38.7, -31.7, 50.8, 85.1), "e", 3.4, dict(tone="g", ov=1.0)),
    ((-38.5, -31.0, 88.0, 99.8), "e", 3.4, dict(tone="g", ov=1.0)),
    ((37.0, 46.7, 30.4, 54.8), "w", 3.4, dict(tone="g", ov=1.0)),
    ((31.8, 37.3, 79.0, 99.4), "e", 3.6, dict(ov=1.0)),                               # 药师殿's back
    ((-19.4, -9.9, -55.5, -26.1), "e", 3.6, dict(tone="g", ov=1.0)),                 # 法物流通处 on the 辇道
    ((10.9, 18.3, -54.1, -25.1), "w", 3.6, dict(tone="g", ov=1.0)),
    ((17.2, 36.2, -190.0, -183.8), "s", 3.4, dict(tone="g", ov=1.0)),
    ((12.3, 18.8, -176.1, -160.2), "w", 3.4, dict(tone="g", ov=1.0)),
]

# the main halls' eave rects
YHM = (-12.9, 12.8, 25.6, 41.6)          # 雍和门
YHG = (-17.4, 17.6, 75.2, 94.4)          # 雍和宫
YYD = (-12.0, 11.0, 105.1, 118.8)        # 永佑殿
FLD = (-18.3, 17.6, 143.1, 161.3)        # 法轮殿's main body


def falundian(parts):
    r = FLD
    cx, cy = (r[0] + r[1]) / 2, (r[2] + r[3]) / 2
    h = spec(15.55, 6.7, lin(15.55, 7), [-6.7, -2.2, 2.2, 6.7], 1.2 + 6.6, 2.4, rows=6, end_rows=3, gap=1.9, Hk=0.6)
    m = main_hall("法轮殿", r, h, 1.2, False, front_doors=5, back_doors=5, beasts=5)
    # the 抱厦 front and back: five bays, lower, their roofs tucked under the main eave
    for side, (x0, x1, yeave), depth in ((-1, (-13.8, 12.3, 136.7), 7.2), (1, (-13.1, 13.8, 165.8), 5.3)):
        bcx = (x0 + x1) / 2 - cx
        OXb = (x1 - x0) / 2 - 1.6
        OYb = depth / 2
        bcy = side * (h.OY + OYb)
        hb = spec(OXb, OYb, lin(OXb, 5), [-OYb, OYb], 1.2 + 3.9, 1.6, big=False, Hk=0.45, gap=1.9)
        hb.IX, hb.IY = OXb, OYb
        hb.UPPER["H"] = min(hb.UPPER["H"], (h.UPPER["z"] - 0.35) - hb.UPPER["z"])
        g = Geo()
        g.box(-OXb - 0.9, OXb + 0.9, -OYb - 0.9, OYb + 0.9, 0.0, 1.2, "marble", skip=("-z",))
        ring_walls(g, hb, 1.2, hb.BEAM[0], True, front_doors=5, back_doors=0, skip=(2,))
        ring_beams(hb, g, True, *hb.BEAM)
        FLAT["on"] = True
        roofs_k(hb, g, 0.7)
        FLAT["on"] = False
        ramp = steps(g, -3.0, 3.0, -OYb - 0.9, -1, 0.0, 1.2)
        mb = m @ T(bcx, bcy, 0) @ Rz(0 if side < 0 else math.pi)
        G.add(g, mb)
        walk(mb, ramp)
        columns_on(hb, mb, True, 1.2, hb.BEAM[0], 0.36)
        brackets_on(hb, mb, True, hb.BEAM[2], 0.8)
        cbox(mb, -OXb - 0.9, OXb + 0.9, -OYb - 0.9, OYb + 0.9, 0.0, 1.2)
        cbox(mb, -OXb, OXb, -OYb, OYb, 0.0, hb.UPPER["z"])
        body_rect(mb, -OXb - 0.9, OXb + 0.9, -OYb - 0.9, OYb + 0.9)
        f = Geo()
        f.box(-OXb, OXb, -OYb, OYb, 0.0, hb.UPPER["z"], "plaster", skip=("-z",))
        far_roof(f, hb.UPPER["A"], hb.UPPER["D"], hb.UPPER["z"], hb.UPPER["z"] + hb.UPPER["H"], "tile")
        FAR.add(f, mb)
    # 一大四小: the big pavilion on the middle of the ridge, two small ones on the ridge east and west, two on the slopes
    g = Geo()
    U = h.UPPER
    ztop = U["z"] + U["H"]

    def roof_z(v):
        return U["z"] + U["H"] * (max(0.0, v) / U["D"]) ** U["p"]
    tops = [roof_pavilion(g, 0.0, 0.0, ztop - 0.6, 2.2, 2.4, 3.6)]
    for x in (-9.5, 9.5):
        tops.append(roof_pavilion(g, x, 0.0, ztop - 0.6, 1.4, 1.6, 2.4))
    for y in (-4.0, 4.0):
        tops.append(roof_pavilion(g, 0.0, y, roof_z(U["D"] - abs(y) - 1.4) - 0.1, 1.4, 1.6, 2.4))
    G.add(g, m)
    f = Geo()
    f.box(-2.2, 2.2, -2.2, 2.2, ztop - 0.6, ztop + 3.5, "plaster")
    f.box(-0.4, 0.4, -0.4, 0.4, ztop + 3.5, tops[0], "gold")
    FAR.add(f, m)
    return max(tops)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("雍和宫")
    parts = collection("构件", main)
    stats = {}

    tri = [0]

    def mark(k):
        stats["t_" + k] = G.tris() - tri[0]
        tri[0] = G.tris()
    # the main axis, south to north
    zhaotaimen()
    for r in ((18.7, 31.4, -15.9, -4.5), (-32.5, -20.0, -16.4, -4.2)):          # 钟楼, 鼓楼
        half = min(r[1] - r[0], r[3] - r[2]) / 2
        tower(r, tower_spec(half, 1.6, 5.4, 8.2, 11.2, 2.7), 0.5, 8.2, doors_front=2, ground="plaster", ground_ends="plaster", door="gatedoor")
    mark("gate_towers")
    octagon(-26.9, 19.4)
    octagon(26.35, 19.8)
    mark("octagons")
    main_hall("雍和门", YHM, spec(10.65, 5.8, lin(10.65, 5), lin(5.8, 3), 0.6 + 5.6, 2.2, rows=7, end_rows=4, Hk=0.58),
              0.6, False, front_doors=3, back_doors=3, passage=True, beasts=5, front_steps=4.0, back_steps=4.0)
    mark("yonghemen")
    tower((-6.0, 5.4, 52.0, 61.7), tower_spec(4.85, 1.4, 5.0, 7.5, 9.6, 2.3), 0.5, 7.5, doors_front=2, doors_back=2, ground="plaster", ground_ends="plaster", door="gatedoor")
    # 雍和宫: seven bays with a colonnade on a 1.2 m platform, the 月台 in front
    hy = spec(14.9, 7.0, lin(14.9, 7), lin(7.0, 5), 1.2 + 6.2, 2.6, rows=7, end_rows=4, Hk=0.6, gap=1.8)
    m = main_hall("雍和宫", YHG, hy, 1.2, True, front_doors=3, back_doors=1, beasts=7)
    mark("yonghegong")
    g = Geo()
    ya, yb = -hy.OY - 0.9 - 8.0, -hy.OY - 0.9
    g.box(-10.0, 10.0, ya, yb, 0.0, 1.0, "marble", skip=("-z",))
    g.box(-10.15, 10.15, ya - 0.15, yb, 0.85, 1.0, "marble", skip=("-z",))
    ramp = steps(g, -3.0, 3.0, ya - 0.15, -1, 0.0, 1.0)
    G.add(g, m)
    walk(m, ramp)
    cbox(m, -10.15, 10.15, ya - 0.15, yb, 0.0, 1.0)
    body_rect(m, -10.15, 10.15, ya - 0.15, yb)
    # a bronze incense burner (香炉) in the court
    g = Geo()
    lathe(g, [(0.0, 0.0), (0.9, 0.0), (0.9, 0.5), (0.5, 0.6), (0.9, 1.0), (1.1, 1.5), (1.0, 1.9), (0.8, 2.0), (0.6, 2.3), (0.8, 2.6), (0.3, 3.3), (0.0, 3.6)], 10, "bronze")
    G.add(g, T(0.0, 64.2, 0))
    COLL.append(("box", -0.9, 0.9, 63.3, 65.1, 0.0, 3.0))
    main_hall("永佑殿", YYD, spec(9.5, 4.85, lin(9.5, 5), lin(4.85, 3), 0.8 + 5.4, 2.0, rows=7, end_rows=4, Hk=0.6),
              0.8, False, front_doors=3, back_doors=1, beasts=5, front_steps=4.0)
    mark("misc")
    stats["stupa_top"] = falundian(parts)
    mark("falundian")
    wanfuge()
    mark("wanfuge")
    for r, facing, zw, kw in SIDE_HALLS:
        simple_hall(r, facing, zw, **kw)
    mark("side_halls")

    # the forecourt: the screen wall, the three archways
    screen_wall(0.0, -221.9)
    pailou(0.5, -178.7, 0, [-7.0, -2.9, 2.9, 7.0], pailou_roofs([-7.0, -2.9, 2.9, 7.0], True), M, parts,
           plaques=[(-1, "親尊海寰"), (1, "壽仁生群")], tag="N")
    # the side archways stand over the parking lane through the square, clear of 雍和宫大街's carriageway (west)
    # and 戏楼胡同 (east), with the lane's 5 m through the middle bay
    # (an 8 m middle bay and no raking braces: the lane turns in off 戏楼胡同 and doglegs north just either side)
    side = [-8.5, -4.5, 4.5, 8.5]
    pailou(-34.0, -206.0, 1, side, pailou_roofs(side, False), M, parts, tag="W", braces=False)
    pailou(27.0, -205.3, 1, side, pailou_roofs(side, False), M, parts, tag="E", braces=False)
    BODIES.append((-8.0, 8.0, -181.5, -176.0))

    mark("forecourt")
    stats["walls"] = walls(WALLS)
    mark("walls")

    # paving: the courts, the 辇道, the forecourt
    for poly in (rect(-45.3, 46.5, -20.8, 54.6), rect(-38.4, 37.1, 54.6, 215.0), rect(-18.8, 17.9, -178.6, -21.4),
                 [(-38.0, -222.6), (35.6, -222.6), (35.6, -190.2), (33.0, -179.2), (-6.0, -179.2), (-17.1, -190.6), (-38.0, -192.4)]):
        G.polyn([(x, y, 0.03) for x, y in poly], "paving", (0, 0, 1))
        FAR.polyn([(x, y, 0.03) for x, y in poly], "paving", (0, 0, 1))

    G.build("Temple", collection("殿", main), M, TILE)
    stats["tris"] = G.tris()

    # instances: columns (a unit cylinder scaled per column, and its stone base), brackets, beasts
    cg = Geo()
    cyl(cg, 0, 0, 0.0, 1.0, 1.0, 0.96, 10, "red", caps=(False, False))
    col_me = mesh_of(cg, "ColumnMesh", M, TILE)
    bg = Geo()
    cyl(bg, 0, 0, 0.0, 0.22, 1.45, 1.3, 8, "marble", caps=(False, True))
    base_me = mesh_of(bg, "ColumnBaseMesh", M, TILE)
    for i, (mm, r, hh) in enumerate(COLS):
        place(col_me, f"Column.{i:04d}", parts, mm @ T(0, 0, 0.18) @ Matrix.Diagonal((r, r, hh - 0.18, 1.0)))
        place(base_me, f"ColumnBase.{i:04d}", parts, mm @ Matrix.Diagonal((r, r, 1.0, 1.0)))
    br = mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE)
    for i, mm in enumerate(BRK):
        place(br, f"Bracket.{i:04d}", parts, mm)
    beast = mesh_of(beast_geo(lite=True), "BeastMesh", M, TILE)
    meshes = dict(beast=beast, immortal=beast)
    for i, (line, n) in enumerate(HIPS):
        beasts_on(line, parts, meshes, f"Beast{i}", n=n)
    stats.update(columns=len(COLS), brackets=len(BRK), hips=len(HIPS))

    FAR.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = FAR.tris()

    helpers = collection("碰撞体")
    nb = nh = nw = 0
    for c in COLL:
        if c[0] == "box":
            collider_box(helpers, f"b{nb}", *c[1:])
            nb += 1
        elif c[0] == "hull":
            collider_pts(helpers, f"h{nh}", c[1])
            nh += 1
        else:
            collider_pts(helpers, f"w{nw}", c[1], role="WALK")
            nw += 1
    stats.update(boxes=nb, hulls=nh, ramps=nw)
    # footprints: the main compound, the 辇道 and the forecourt, each kept off the hutong round it
    flat_marker(helpers, "gatecourt", rect(-45.6, 46.9, -21.0, 54.7), "FOOTPRINT")
    flat_marker(helpers, "courts", rect(-38.7, 36.6, 54.7, 215.5), "FOOTPRINT")
    flat_marker(helpers, "niandao", rect(-19.3, 19.5, -179.0, -21.0), "FOOTPRINT")
    # no footprint over the square itself: it holds no buildings, and its parking lane and 戏楼胡同 run through it
    flat_marker(helpers, "squareNE", rect(-6.5, 36.0, -189.5, -178.3), "FOOTPRINT")
    for i, poly in enumerate((rect(-46.5, 47.5, -22.0, 54.7), rect(-39.5, 36.6, 54.7, 216.5), rect(-19.8, 20.2, -179.5, -21.0), rect(-38.0, 35.6, -222.6, -191.8))):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "yonghegong", "雍和宫", "Yonghe Lama Temple"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 1146.3, -4100.0, -1.0
    s.far_distance = 450
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
