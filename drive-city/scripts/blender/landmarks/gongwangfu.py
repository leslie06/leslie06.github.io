# 恭王府 Prince Gong's Mansion by 什刹海 (前海西街 17), built in Blender with the timber halls of hall.py and
# marked with the bcity_landmark add-on's conventions. Also the helper library of zhihuasi.py (the courtyard
# halls, walls, pavilions; copied and adapted from yonghegong.py, which is not imported).
#
#   blender -b -P scripts/blender/landmarks/gongwangfu.py -- [--out art/landmarks/gongwangfu.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin at game (-1490, -2990) (behind 嘉乐堂 on the middle axis),
# heading -6.8 (OSM's hall outlines lean 6-7.5 degrees: 银安殿, 一宫门, 多福轩, 葆光室, 嘉乐堂). OSM has the precinct
# (way 26514871), the garden (way 268548508), the pond 方塘水榭 (relation 3599662) and nine halls by name
# (头宫门倒座房, 一宫门, 二宫门, 银安殿, 嘉乐堂, 多福轩, 葆光室, 湖心亭, 怡神所 - the last one's 19 x 38 m outline
# is the 大戏楼's, and the gallery OSM calls 头宫门 stands on the garden's west side); the rest of the plan
# follows the machine-learnt roofs in the tiles and the published layout (恭王府博物馆): three axes of
# courtyards, the 后罩楼 (about 156 m, two storeys) across the north, the garden 萃锦园 behind it.
#
# The mansion: the middle axis (倒座房, the gate 一宫门, 二宫门, 银安殿 on a platform with its 月台 and side halls,
# 嘉乐堂) under green glazed tiles - a prince's rank - the main hall with its tile rows, brackets and beasts;
# the east axis (a front hall, 多福轩, 乐道堂) and the west axis (a front hall, 葆光室, 锡晋斋) and every side hall
# under grey tiles (textured roofs); red courtyard walls, a grey brick outer wall along 柳荫街 and 前海西街.
# The garden, modestly: the 西洋门 (the white marble Western-style arch) in its south wall, 飞来石 and 独乐峰,
# the bat-shaped 蝠池, 安善堂 with its side halls, the 滴翠岩 rockery with 绿天小隐 on top, the 蝠厅 with its
# angled wings, the 大戏楼 (three roofs, 勾连搭), the pond's revetment and 湖心亭 on its island, the west
# gallery, three small pavilions. The garden's trees stay: clear zones only where a building stands.
# Doubtful: the side halls' sizes (from the learnt roofs), 银安殿's roof (歇山 here), the gate's tiles.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, coping, cyl, ell, flat_marker, lathe, mesh_of,  # noqa: E402
                 paving, place, rect)
import hall  # noqa: E402
from hall import (beast_geo, beasts_on, bracket_geo, bracket_spots, paint_atlas, plaster, ring_beams,  # noqa: E402
                  ring_sides, roofs, to_world, uvs, wen)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "gongwangfu.blend")
PI2 = math.pi / 2
HEADING = -6.8
ANCHOR = (-1490.0, -2990.0)

# --- flat textured roofs (as yonghegong.py: hall.roof_face wrapped while FLAT is set) -----------------------
FLAT = {"on": False}
_roof_face = hall.roof_face
TEX_U, TEX_V = 3.68, 3.2


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


def tile_tex(name, col, rows=8):
    """Glazed tile rows seen from above: round tube tiles across, four courses up."""
    n = 256
    v, u = np.mgrid[0:n, 0:n] / n
    ph = (u * rows) % 1.0
    ridge = np.where(ph < 0.5, 0.78 + 0.34 * np.sqrt(np.clip(1 - ((ph - 0.25) / 0.25) ** 2, 0, 1)), 0.62 + 0.1 * np.sin(np.pi * (ph - 0.5) / 0.5))
    course = 1 - 0.18 * ((((v * 4) % 1) < 0.07) & (ph >= 0.5))
    rng = np.random.default_rng(5)
    a = srgb(col) * (ridge * course)[..., None] * (0.95 + 0.1 * rng.random((n, n, 1)))
    return image(name, a.astype(np.float32))


def brick_image(name, col, size=512, mortar="#b0aca2", seed=41):
    cv = Canvas(size, size, col)
    rng = np.random.default_rng(seed)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    c = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.9, 1.07, (40, 12))[row % 40, c % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.4) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.4), mortar)
    cv.noise(0.1, seed + 1)
    return image(name, np.flipud(cv.a).copy())


def rock_image(name, col="#8d877b", size=256):
    """Taihu-ish grey limestone: mottled, dark pits and veins (3 m per repeat)."""
    cv = Canvas(size, size, col)
    cv.noise(0.22, 31)
    X, Y = cv.x, cv.y
    vein = np.abs(np.sin(X * 0.05 + 2.2 * np.sin(Y * 0.031)) * np.cos(Y * 0.043 + 1.7 * np.sin(X * 0.027)))
    cv.a *= (0.82 + 0.18 * np.clip(vein * 3, 0, 1))[..., None]
    rng = np.random.default_rng(32)
    for _ in range(40):
        x, y, r = rng.uniform(0, size), rng.uniform(0, size), rng.uniform(1.5, 4)
        cv.a[((X - x) ** 2 + (Y - y) ** 2) < r * r] *= 0.72
    return image(name, np.flipud(cv.a).copy())


def materials(P="GW", glaze="#3f7d4c", glaze_tex="#438253", grey="#5f6163", grey_tex="#6a6d70", beam_glow=0.8):
    """The palette; `glaze` is the main halls' glazed tile (green here, black at 智化寺)."""
    atlas, night = paint_atlas(P, portrait=False, emblem=False)
    return dict(
        atlas=material(f"{P}_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": beam_glow}),
        plaster=material(f"{P}_Plaster", "#a8321f", 0.85, tex=plaster(name=f"{P}_PlasterTex", col="#a43a26"), props={"wet": "damp"}),
        marble=material(f"{P}_Stone", "#cfcabd", 0.6, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material(f"{P}_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 10}),
        tile=material(f"{P}_Glaze", glaze, 0.32, props={"wet": "surface", "glowStrength": 0.5}),
        ytex=material(f"{P}_GlazeRows", glaze, 0.35, tex=tile_tex(f"{P}_GlazeRowsTex", glaze_tex), props={"wet": "surface", "glowStrength": 0.5}),
        grey=material(f"{P}_GreyTile", grey, 0.55, props={"wet": "surface", "glowStrength": 0.5}),
        gtex=material(f"{P}_GreyRows", grey, 0.6, tex=tile_tex(f"{P}_GreyRowsTex", grey_tex), props={"wet": "surface", "glowStrength": 0.5}),
        red=material(f"{P}_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material(f"{P}_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        paint=material(f"{P}_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        brick=material(f"{P}_Brick", "#7f817d", 0.9, tex=brick_image(f"{P}_BrickTex", "#80827e"), props={"wet": "damp"}),
        white=material(f"{P}_Marble", "#e4e0d6", 0.5, props={"wet": "surface", "glowStrength": 0.7}),
        rock=material(f"{P}_Rock", "#8d877b", 0.9, tex=rock_image(f"{P}_RockTex"), props={"wet": "damp", "glowStrength": 0.4}),
        water=material(f"{P}_Water", "#26383a", 0.08, props={"wet": "surface", "glow": "none", "layer": 10}),
        board=material(f"{P}_Board", "#1d3f7a", 0.5, props={"wet": "damp"}),
    )


TILE = dict(plaster=4.0, marble=2.0, paving=4.0, tile=2.0, grey=2.0, red=2.0, gold=1.0, paint=1.0, brick=4.0, white=2.0, rock=3.0, water=4.0, board=2.0)
GREY = {"tile": "grey", "ytex": "gtex"}

# --- the scene's accumulators ----------------------------------------------------------------------------
G = Geo()                 # everything drawn, merged per material
FAR = Geo()               # the far level
COLS = []                 # (matrix, r, h) of column instances
BRK = []                  # bracket matrices
HIPS = []                 # (world hip line, beasts) for ridge beasts
COLL = []                 # ("box", x0, x1, y0, y1, z0, z1) | ("hull", pts) | ("walk", pts) | ("mesh", Geo)
BODIES = []               # local plan rects the walls stop at
CLEARS = []               # local polygons the city keeps clear of trees (only where something stands)


def reset():
    for acc in (COLS, BRK, HIPS, COLL, BODIES, CLEARS):
        acc.clear()
    G.v.clear(), G.c.clear(), G.f.clear()
    FAR.v.clear(), FAR.c.clear(), FAR.f.clear()


def L(gx, gz):
    """Game metres (+x east, +z south) to this frame."""
    e, n = gx - ANCHOR[0], -(gz - ANCHOR[1])
    a = math.radians(-HEADING)
    return (e * math.cos(a) + n * math.sin(a), -e * math.sin(a) + n * math.cos(a))


def M_of(cx, cy, ang):
    return T(cx, cy, 0) @ Rz(ang)


def axis_aligned(m):
    return abs(m[0][1]) < 1e-6 or abs(m[0][0]) < 1e-6


def cbox(m, x0, x1, y0, y1, z0, z1):
    ps = [m @ Vector((x, y, 0)) for x in (x0, x1) for y in (y0, y1)]
    if axis_aligned(m):
        COLL.append(("box", min(p.x for p in ps), max(p.x for p in ps), min(p.y for p in ps), max(p.y for p in ps), z0, z1))
    else:
        COLL.append(("hull", [(p.x, p.y, z) for p in ps for z in (z0, z1)]))


def body_rect(m, x0, x1, y0, y1, pad=0.4, clear=True):
    ps = [m @ Vector((x, y, 0)) for x in (x0, x1) for y in (y0, y1)]
    BODIES.append((min(p.x for p in ps) - pad, max(p.x for p in ps) + pad, min(p.y for p in ps) - pad, max(p.y for p in ps) + pad))
    if clear:
        q = [m @ Vector((x, y, 0)) for x, y in ((x0 - 1.5, y0 - 1.5), (x1 + 1.5, y0 - 1.5), (x1 + 1.5, y1 + 1.5), (x0 - 1.5, y1 + 1.5))]
        CLEARS.append([(p.x, p.y) for p in q])


def canon(r, facing):
    """A local eave rect and the way the hall faces -> (cx, cy, angle, half along the front, half deep)."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if facing in ("s", "n"):
        return cx, cy, (0 if facing == "s" else 2) * PI2, (x1 - x0) / 2, (y1 - y0) / 2
    return cx, cy, (1 if facing == "e" else 3) * PI2, (y1 - y0) / 2, (x1 - x0) / 2


def remap(g, keys):
    for i, (idx, u, k, sm) in enumerate(g.f):
        if k in keys:
            g.f[i] = (idx, u, keys[k], sm)


def column(m, x, y, z0, h, r):
    COLS.append((m @ T(x, y, z0), r, h))


# --- small pieces -----------------------------------------------------------------------------------------

def strip(g, a, b, z0, z1, reg, out, seg=4.0):
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


def facade(g, bx, by, z0, zw, storeys=1, zm=None, back=False, passages=(), door_bays=1, key_end="plaster", bay=3.6):
    """The walls of a simple hall in its frame (front -y): lattice doors and windows between red posts on the
    front (the upper storey's band over a plank on a two-storey 楼), plaster behind and at the ends;
    `passages` are x ranges left open through the building, lined and ceiled."""
    n = max(1, round(2 * bx / bay))
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
            reg = "door" if abs(i - mid) < door_bays / 2 + 0.01 and side < 0 else "window"
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


def yroof(g, L_, D, ze, H, gables=None, key="ytex", ends=0.45, p=1.4, rows=4, wen_k=0.42, y0=0.0):
    """A 硬山 roof along x: two faces from the eaves (y = y0 +- D, height ze) to the ridge (ze + H), running `ends`
    past the gable walls at x = +-L_; `gables` = (wall half depth, wall top) draws the gable walls' peaks."""
    X = L_ + ends
    nc = max(2, round(2 * X / 3.0))

    def z_at(v):
        return ze + H * (max(0.0, v) / D) ** p
    for s in (-1, 1):
        vs = [D * (j / rows) ** 1.1 for j in range(rows + 1)]
        grid = [[g.vert((-X + 2 * X * i / nc, y0 + s * (D - v), z_at(v))) for i in range(nc + 1)] for v in vs]
        for j in range(rows):
            for i in range(nc):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                if s > 0:
                    q = q[::-1]
                uvq = [(g.v[k][0] / TEX_U, (D - abs(g.v[k][1] - y0)) / TEX_V) for k in q]
                g.face(q, key, uvs=uvq, smooth=True)
        e0, e1 = Vector((-X, y0 + s * D, ze)), Vector((X, y0 + s * D, ze))
        g.polyn([e0, e1, e1 + Vector((0, 0, -0.3)), e0 + Vector((0, 0, -0.3))], "tile", (0, s, 0))
        if gables:
            wd, wt = gables
            g.polyn([(-X, y0 + s * D, ze - 0.3), (X, y0 + s * D, ze - 0.3), (X, y0 + s * wd, wt), (-X, y0 + s * wd, wt)], "atlas", (0, 0, -1),
                    uvs=uvs("rafters", ((0, 0), (1, 0), (1, 1), (0, 1))))
        for sx in (-1, 1):
            edge = [Vector((sx * X, y0 + s * (D - v), z_at(v))) for v in vs]
            for a, b in zip(edge, edge[1:]):
                g.polyn([a + Vector((0, 0, 0.12)), b + Vector((0, 0, 0.12)), b + Vector((0, 0, -0.25)), a + Vector((0, 0, -0.25))], "tile", (sx, 0, 0))
    zt = ze + H
    g.box(-X - 0.1, X + 0.1, y0 - 0.32, y0 + 0.32, zt - 0.25, zt + 0.5, "tile")
    if wen_k:
        for sx in (-1, 1):
            wg = Geo()
            wen(wg, sx * (X - 0.2), zt + 0.1, sx, key="tile", k=wen_k)
            g.add(wg, T(0, y0, 0))
    if gables:
        wd, wt = gables
        for sx in (-1, 1):
            vs = [D * (j / 6) for j in range(7)]
            prof = [(-(D - v), z_at(v) - 0.12) for v in vs if D - v <= wd] + [((D - v), z_at(v) - 0.12) for v in reversed(vs) if D - v <= wd and v < D - 1e-6]
            pts = [(-wd, wt)] + [(-wd, z_at(D - wd) - 0.12)] + prof + [(wd, z_at(D - wd) - 0.12), (wd, wt)]
            g.polyn([(sx * (L_ + 0.3), y0 + y, z) for y, z in pts], "plaster", (sx, 0, 0))
    return zt


def simple_hall_at(cx, cy, ang, hx, hy, zw, roof="ying", tone="y", ov=1.3, storeys=1, zm=None, z0=0.35, pas=(), back=False, Hk=0.5,
                   door_bays=1, key_end="plaster", clear=True, coll=True):
    """A side hall: base, facade, beam band, a 硬山 or (textured) 歇山 roof; (cx, cy, ang) places its frame
    (front -y), hx/hy are its eave half sizes, `pas` passages along the front in its own frame."""
    m = M_of(cx, cy, ang)
    g = Geo()
    by = hy - ov
    if roof == "ying":
        bx = hx - 0.75
        base(g, bx + 0.6, by, z0)
        facade(g, bx, by, z0, zw, storeys, zm, back, pas, door_bays, key_end=key_end)
        beam_band(g, bx, by, zw, zw + 0.5, sides="ns")
        for sx in (-1, 1):
            g.box(min(sx * bx, sx * (bx + 0.6)), max(sx * bx, sx * (bx + 0.6)), -by - 0.3, by + 0.3, z0, zw + 0.5, "plaster", skip=("-z", "+z"))
        D = hy
        H = Hk * D + 0.4
        yroof(g, bx + 0.3, D, zw + 0.4, H, gables=(by + 0.3, zw + 0.5), wen_k=min(0.42, 0.06 * D + 0.1))
        top = zw + 0.4 + H
        body = (-bx - 0.6, bx + 0.6, -by - 0.3, by + 0.3)
        segs = [(-bx - 0.6, bx + 0.6)]
        for a, b in sorted(pas):
            last = segs.pop()
            segs += [(last[0], a), (b, last[1])]
    else:
        bx = hx - ov
        base(g, bx, by, z0)
        facade(g, bx, by, z0, zw, storeys, zm, back, pas, door_bays, key_end=key_end)
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
        for a, b in sorted(pas):
            last = segs.pop()
            segs += [(last[0], a), (b, last[1])]
    if tone == "g":
        remap(g, GREY)
    G.add(g, m)
    if coll:
        for a, b in segs:
            cbox(m, a, b, body[2], body[3], 0.0, zw + 0.5)
        for a, b in pas:
            cbox(m, a, b, body[2], body[3], zw - 0.9, zw + 0.5)
    body_rect(m, *body, clear=clear)
    far_block(m, hx, hy, body, zw, top, tone)
    return m


def simple_hall(r, facing, zw, passages=(), **kw):
    """simple_hall_at from a local eave rect, the way it faces and passages as local ranges along the front."""
    cx, cy, ang, hx, hy = canon(r, facing)
    rot = round(ang / PI2) % 4
    pas = []
    for a, b in passages:
        if rot == 0:
            pas.append((a - cx, b - cx))
        elif rot == 2:
            pas.append((cx - b, cx - a))
        elif rot == 1:
            pas.append((a - cy, b - cy))
        else:
            pas.append((cy - b, cy - a))
    return simple_hall_at(cx, cy, ang, hx, hy, zw, pas=pas, **kw)


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
            if reg == "plaster":
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
    Lr = n * run
    for x in (x0 - 0.35, x1):
        g.box(x, x + 0.35, min(y_edge, y_edge + s * Lr), max(y_edge, y_edge + s * Lr), z0, z1 + 0.1, "marble", skip=("-z",))
    ye = y_edge + s * Lr
    return [(x0 - 0.35, y_edge, z1), (x1 + 0.35, y_edge, z1), (x0 - 0.35, ye, z0), (x1 + 0.35, ye, z0), (x0 - 0.35, y_edge, z0), (x1 + 0.35, y_edge, z0)]


def walk(m, pts):
    COLL.append(("walk", [tuple(m @ Vector(p)) for p in pts]))


def main_hall(r, h, base_z, colonnade, front_doors=3, back_doors=0, passage=False, beasts=5, front_steps=None, back_steps=None, col_r=0.42, tone="y"):
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
    if tone == "g":
        remap(g, GREY)
    G.add(g, m)
    for rp in ramps:
        walk(m, rp)
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
    zl = h.UPPER["z"]
    if h.LOWER:
        far_roof(f, h.LOWER["A"], h.LOWER["D"], h.LOWER["z"], h.LOWER["z"] + h.LOWER["H"], "grey" if tone == "g" else "tile")
    far_roof(f, h.UPPER["A"], h.UPPER["D"], zl, zl + h.UPPER["H"] + 0.6, "grey" if tone == "g" else "tile")
    FAR.add(f, m)
    return m


def tower_spec(half, ov, z_beam, z_up0, z_ubeam, inner):
    """A square two-storey pavilion (bell and drum towers) from its eave half size."""
    OX = half - ov
    IX = inner
    A2 = IX + ov * 1.15
    return SimpleNamespace(
        XS=[-OX, -IX, 0.0, IX, OX], YS=[-OX, -IX, 0.0, IX, OX], OX=OX, OY=OX, IX=IX, IY=IX,
        BEAM=(z_beam, z_beam + 0.55, z_beam + 0.7, z_beam + 1.3), UBEAM=(z_ubeam, z_ubeam + 0.5, z_ubeam + 0.65, z_ubeam + 1.25), OVERHANG=ov,
        LOWER=dict(A=half, D=half, z=z_beam + 0.95, H=z_up0 - 0.35 - (z_beam + 0.95), p=1.3, o=0.5, lift=0.5, Lc=3.5, Vc=2.0),
        UPPER=dict(A=A2, D=A2, z=z_ubeam + 0.9, H=0.62 * A2, p=1.5, o=0.55, lift=0.55, Lc=0.7 * A2, Vc=0.42 * A2),
        GABLE_X=max(0.8, A2 - 0.5 * A2 - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", ROWS=4, END_ROWS=3, LOWER_ROWS=3, BRACKET_GAP=1.5)


def tower(r, h, base_z, up0, doors_front=1, ground="window", ground_ends="plaster", upper_fill=("window", "window"), facing="s", doors_back=0,
          door="door", tone="y", brick_ground=False):
    """A two-storey pavilion on a double-eave spec with textured roofs: the ground storey walled on the outer ring
    (brick with an arched door on `brick_ground`), the skirt, the upper storey on the inner ring."""
    cx, cy, ang, hx, hy = canon(r, facing)
    m = M_of(cx, cy, ang)
    g = Geo()
    g.box(-h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5, 0.0, base_z, "marble", skip=("-z",))
    if brick_ground:
        g.box(-h.OX, h.OX, -h.OY, h.OY, base_z, h.BEAM[0], "brick", skip=("-z", "+z"))
        g.polyn([(-0.8, -h.OY - 0.02, base_z), (0.8, -h.OY - 0.02, base_z), (0.8, -h.OY - 0.02, base_z + 2.3), (-0.8, -h.OY - 0.02, base_z + 2.3)], "atlas", (0, -1, 0),
                uvs=uvs("gatedoor", QUAD))
    else:
        ring_walls(g, h, base_z, h.BEAM[0], True, front_doors=doors_front, back_doors=doors_back, fill=(ground, ground_ends), inset=0.0, door=door)
    ring_walls(g, h, up0, h.UBEAM[0], False, front_doors=0, fill=upper_fill)
    beam_band(g, h.OX, h.OY, h.BEAM[0], h.BEAM[3], off=0.05)
    beam_band(g, h.IX, h.IY, h.UBEAM[0], h.UBEAM[3], off=0.05)
    zs = h.LOWER["z"] + h.LOWER["H"]
    for rot2 in range(4):
        Dd, Uu = (h.IY, h.IX) if rot2 % 2 == 0 else (h.IX, h.IY)
        P = lambda u, z: to_world(rot2, Dd, u, -0.02, z)          # noqa: E731
        g.polyn([P(-Uu, zs - 0.3), P(Uu, zs - 0.3), P(Uu, up0), P(-Uu, up0)], "atlas", hall.cdir(rot2, 0, -1), uvs=uvs("plank", QUAD))
    FLAT["on"] = True
    roofs_k(h, g, max(0.4, min(0.8, h.UPPER["D"] / 7)))
    FLAT["on"] = False
    if tone == "g":
        remap(g, GREY)
    G.add(g, m)
    if not brick_ground:
        for x, y in ((h.OX, h.OY), (-h.OX, h.OY), (h.OX, -h.OY), (-h.OX, -h.OY)):
            column(m, x, y, base_z, h.BEAM[0] - base_z, 0.3)
    cbox(m, -h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5, 0.0, h.UBEAM[0])
    body_rect(m, -h.OX - 0.5, h.OX + 0.5, -h.OY - 0.5, h.OY + 0.5)
    key = "grey" if tone == "g" else "tile"
    f = Geo()
    f.box(-h.OX, h.OX, -h.OY, h.OY, 0.0, h.LOWER["z"] + 0.3, "plaster", skip=("-z",))
    far_roof(f, h.LOWER["A"], h.LOWER["D"], h.LOWER["z"], zs, key)
    f.box(-h.IX, h.IX, -h.IY, h.IY, zs, h.UPPER["z"] + 0.3, "plaster", skip=("-z",))
    far_roof(f, h.UPPER["A"], h.UPPER["D"], h.UPPER["z"], h.UPPER["z"] + h.UPPER["H"] + 0.5, key)
    FAR.add(f, m)
    return m


# --- walls ---------------------------------------------------------------------------------------------------

def wall_runs(poly, closed=False, step=1.0):
    """The parts of a polyline outside every building body, as (a, b) plan segments."""
    pts = [Vector(p) for p in poly] + ([Vector(poly[0])] if closed else [])
    runs = []
    for a, b in zip(pts, pts[1:]):
        Ln = (b - a).length
        n = max(1, round(Ln / step))
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


def walls(polys, zt=3.6, th=0.7, key="plaster", cop="gtex", plinth="marble"):
    """Walls along polylines (stopping at building bodies): a stone plinth, the wall, a tiled coping; hulls."""
    g = Geo()
    f = Geo()
    n = 0
    for poly, closed in polys:
        for a, b in wall_runs(poly, closed):
            d = (b - a)
            Ln = d.length
            if Ln < 0.5:
                continue
            u = d / Ln
            nrm = Vector((-u.y, u.x)) * (th / 2)
            c = [a - nrm, b - nrm, b + nrm, a + nrm]
            for i in range(4):
                p, q = c[i], c[(i + 1) % 4]
                mid = (p + q) / 2 - (a + b) / 2
                g.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, zt), (p.x, p.y, zt)], key, (mid.x, mid.y, 0))
                f.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, zt), (p.x, p.y, zt)], key, (mid.x, mid.y, 0))
            g.polyn([(p.x, p.y, zt) for p in c], "grey", (0, 0, 1))
            k = (th / 2 + 0.07) / (th / 2)
            cb = [a - nrm * k, b - nrm * k, b + nrm * k, a + nrm * k]
            for i in range(4):
                p, q = cb[i], cb[(i + 1) % 4]
                mid = (p + q) / 2 - (a + b) / 2
                g.polyn([(p.x, p.y, 0), (q.x, q.y, 0), (q.x, q.y, 0.45), (p.x, p.y, 0.45)], plinth, (mid.x, mid.y, 0))
            for i in range(4):
                p, q, p2, q2 = cb[i], cb[(i + 1) % 4], c[i], c[(i + 1) % 4]
                g.polyn([(p.x, p.y, 0.45), (q.x, q.y, 0.45), (q2.x, q2.y, 0.45), (p2.x, p2.y, 0.45)], plinth, (0, 0, 1))
            cg = Geo()
            coping(cg, (a.x, a.y), (b.x, b.y), th + 0.5, zt, rise=0.4, key="ytex")
            for i, (idx, _u, k_, sm) in enumerate(cg.f):          # tile rows across the coping, not along it
                uvl = []
                for vi in idx:
                    p = Vector(cg.v[vi][:2]) - a
                    uvl.append((p.dot(u) / TEX_U, (p.dot(Vector((-u.y, u.x))) + cg.v[vi][2]) / TEX_V))
                cg.f[i] = (idx, uvl, cop, sm)
            g.add(cg, Matrix.Identity(4))
            COLL.append(("hull", [(p.x, p.y, z) for p in c for z in (0.0, zt + 0.4)]))
            n += 1
    G.add(g, Matrix.Identity(4))
    FAR.add(f, Matrix.Identity(4))
    return n


# --- garden pieces ---------------------------------------------------------------------------------------

def pavilion(cx, cy, hw, zb=0.5, H_body=3.0, tone="g", kind="cuanjian", hy=None):
    """A small open pavilion on four (or six) columns: a platform, a beam band, a textured 攒尖 (or 歇山) roof."""
    hy = hy or hw
    m = M_of(cx, cy, 0)
    g = Geo()
    g.box(-hw - 0.6, hw + 0.6, -hy - 0.6, hy + 0.6, 0.0, zb, "marble", skip=("-z",))
    zt = zb + H_body
    beam_band(g, hw, hy, zt - 0.45, zt, off=0.05)
    for sx in (-1, 1):                                       # the bench rails (美人靠) on the sides
        g.box(sx * hw - 0.08, sx * hw + 0.08, -hy, hy, zb + 0.4, zb + 0.55, "red")
    ov = 0.9
    A, D = hw + ov, hy + ov
    U = dict(A=A, D=D, z=zt + 0.25, H=0.8 * max(A, D) if kind == "cuanjian" else 0.6 * D, p=1.5, o=0.5, lift=0.5, Lc=0.7 * D, Vc=0.42 * D)
    h = SimpleNamespace(XS=[-hw, hw], YS=[-hy, hy], OX=hw, OY=hy, IX=hw, IY=hy, BEAM=(zt - 0.45, zt - 0.25, zt - 0.1, zt), UBEAM=(zt - 0.45, zt - 0.25, zt - 0.1, zt),
                        OVERHANG=ov, LOWER=None, UPPER=U, GABLE_X=max(0.4, A - 0.55 * D - 0.8), PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile",
                        ROWS=3, END_ROWS=3, KIND=kind)
    FLAT["on"] = True
    roofs_k(h, g, 0.35)
    FLAT["on"] = False
    if tone == "g":
        remap(g, GREY)
    G.add(g, m)
    for x, y in ((hw, hy), (-hw, hy), (hw, -hy), (-hw, -hy)):
        column(m, x, y, zb, zt - 0.45 - zb, 0.17)
        COLL.append(("box", cx + x - 0.2, cx + x + 0.2, cy + y - 0.2, cy + y + 0.2, 0.0, zt))
    COLL.append(("box", cx - hw - 0.6, cx + hw + 0.6, cy - hy - 0.6, cy + hy + 0.6, 0.0, zb))
    body_rect(m, -hw - 0.6, hw + 0.6, -hy - 0.6, hy + 0.6)
    f = Geo()
    f.box(-hw, hw, -hy, hy, 0.0, zt, "plaster", skip=("-z",))
    far_roof(f, A, D, U["z"], U["z"] + U["H"], "grey" if tone == "g" else "tile")
    FAR.add(f, m)
    return m


def rock_spire(cx, cy, w, h, seed, lean=0.0, plinth=0.5):
    """A tall garden stone (飞来石, 独乐峰): a jittered seven-sided column that swells and pinches, on a plinth."""
    rng = np.random.default_rng(seed)
    g = Geo()
    if plinth:
        g.box(cx - w * 0.75, cx + w * 0.75, cy - w * 0.55, cy + w * 0.55, 0.0, plinth, "marble", skip=("-z",))
    n, rings = 7, 7
    prev = None
    pts = []
    for k in range(rings + 1):
        t = k / rings
        z = plinth + h * t
        r = w * 0.5 * (0.75 + 0.35 * math.sin(t * 5.1 + seed) + 0.25 * (1 - t)) * (0.45 if k == rings else 1.0)
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
            rr = r * rng.uniform(0.7, 1.15)
            ring.append(Vector((cx + lean * t * h + rr * math.cos(a), cy + rr * 0.7 * math.sin(a), z)))
        if prev:
            for i in range(n):
                j = (i + 1) % n
                g.poly([prev[i], prev[j], ring[j], ring[i]], "rock")
        prev = ring
        pts += ring
    g.poly(prev, "rock")
    G.add(g, Matrix.Identity(4))
    COLL.append(("hull", [tuple(p) for p in pts[:n]] + [(p.x, p.y, plinth + h * 0.5) for p in pts[:n]]))
    BODIES.append((cx - w, cx + w, cy - w, cy + w))
    CLEARS.append([(cx - w - 0.8, cy - w - 0.8), (cx + w + 0.8, cy - w - 0.8), (cx + w + 0.8, cy + w + 0.8), (cx - w - 0.8, cy + w + 0.8)])
    f = Geo()
    f.box(cx - w * 0.4, cx + w * 0.4, cy - w * 0.3, cy + w * 0.3, 0.0, plinth + h, "rock", skip=("-z",))
    FAR.add(f, Matrix.Identity(4))


def rockery(cx, cy, a, b, H, seed, step=1.4, peaks=()):
    """An artificial hill of stone (假山): a heightfield over an ellipse, craggy, with a few peaks; it is also its
    own trimesh collider (people climb it; its steep faces stop them)."""
    rng = np.random.default_rng(seed)
    nx, ny = int(2 * a / step) + 3, int(2 * b / step) + 3
    xs = [cx - a - step + i * step for i in range(nx)]
    ys = [cy - b - step + j * step for j in range(ny)]
    Z = np.zeros((ny, nx))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            r2 = ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2
            if r2 >= 1:
                Z[j, i] = -0.15
                continue
            z = H * (1 - r2) ** 0.55
            for px, py, ph, pr in peaks:
                z += ph * math.exp(-((x - px) ** 2 + (y - py) ** 2) / (pr * pr))
            Z[j, i] = z * rng.uniform(0.8, 1.15) + rng.uniform(-0.25, 0.25)
    g = Geo()
    vid = {}
    for j in range(ny):
        for i in range(nx):
            vid[(i, j)] = g.vert((xs[i] + rng.uniform(-0.3, 0.3) * (Z[j, i] > 0), ys[j] + rng.uniform(-0.3, 0.3) * (Z[j, i] > 0), Z[j, i]))
    for j in range(ny - 1):
        for i in range(nx - 1):
            q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(Z[jj, ii] <= 0 for ii, jj in q):
                continue
            g.face([vid[q[0]], vid[q[1]], vid[q[2]]], "rock")
            g.face([vid[q[0]], vid[q[2]], vid[q[3]]], "rock")
    G.add(g, Matrix.Identity(4))
    COLL.append(("mesh", g))
    BODIES.append((cx - a, cx + a, cy - b, cy + b))
    CLEARS.append([(cx + (a + 1) * math.cos(2 * math.pi * k / 12), cy + (b + 1) * math.sin(2 * math.pi * k / 12)) for k in range(12)])
    f = Geo()
    rim = [(cx + a * math.cos(2 * math.pi * k / 8), cy + b * math.sin(2 * math.pi * k / 8), 0.0) for k in range(8)]
    top = (cx, cy, H * 0.9)
    for k in range(8):
        f.poly([rim[k], rim[(k + 1) % 8], top], "rock")
    FAR.add(f, Matrix.Identity(4))

    def height(x, y):
        i = min(nx - 2, max(0, int((x - xs[0]) / step)))
        j = min(ny - 2, max(0, int((y - ys[0]) / step)))
        return max(Z[j, i], Z[j, i + 1], Z[j + 1, i], Z[j + 1, i + 1])
    return height


def pond(poly, z=0.05, kerb=0.35, kerb_w=0.5, water=True):
    """Water at z (layer 10, over the city's ground) inside a stone kerb along `poly` (a closed ring)."""
    g = Geo()
    if water:
        g.polyn([(x, y, z) for x, y in poly], "water", (0, 0, 1))
        FAR.polyn([(x, y, z) for x, y in poly], "water", (0, 0, 1))
    n = len(poly)
    cxm = sum(p[0] for p in poly) / n
    cym = sum(p[1] for p in poly) / n
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        d = (b - a).normalized()
        out = Vector((d.y, -d.x))
        if out.dot((a + b) / 2 - Vector((cxm, cym))) < 0:
            out = -out
        ai, bi = a - out * 0.05, b - out * 0.05
        ao, bo = a + out * kerb_w, b + out * kerb_w
        g.polyn([(ai.x, ai.y, kerb), (bi.x, bi.y, kerb), (bo.x, bo.y, kerb), (ao.x, ao.y, kerb)], "marble", (0, 0, 1))
        g.polyn([(ai.x, ai.y, -0.05), (bi.x, bi.y, -0.05), (bi.x, bi.y, kerb), (ai.x, ai.y, kerb)], "marble", (-out.x, -out.y, 0))
        g.polyn([(ao.x, ao.y, 0.0), (bo.x, bo.y, 0.0), (bo.x, bo.y, kerb), (ao.x, ao.y, kerb)], "marble", (out.x, out.y, 0))
    G.add(g, Matrix.Identity(4))


def paved(poly, z=0.03):
    G.polyn([(x, y, z) for x, y in poly], "paving", (0, 0, 1))
    FAR.polyn([(x, y, z) for x, y in poly], "paving", (0, 0, 1))


def emit_colliders(helpers):
    import bcity_landmark
    nb = nh = nw = nm = 0
    for c in COLL:
        if c[0] == "box":
            collider_box(helpers, f"b{nb}", *c[1:])
            nb += 1
        elif c[0] == "hull":
            collider_pts(helpers, f"h{nh}", c[1])
            nh += 1
        elif c[0] == "walk":
            collider_pts(helpers, f"w{nw}", c[1], role="WALK")
            nw += 1
        else:
            o = c[1].build(f"m{nm}", helpers, {"rock": None})
            o.data.materials.clear()
            bcity_landmark.rename(o, "COLMESH")
            nm += 1
    return dict(boxes=nb, hulls=nh, ramps=nw, meshes=nm)


def instances(parts, M, glaze="#3f7d4c"):
    """Columns (a unit cylinder scaled per column, and its stone base), brackets and beasts as linked duplicates."""
    cg = Geo()
    cyl(cg, 0, 0, 0.0, 1.0, 1.0, 0.96, 10, "red", caps=(False, False))
    col_me = mesh_of(cg, "ColumnMesh", M, TILE)
    bg = Geo()
    cyl(bg, 0, 0, 0.0, 0.22, 1.45, 1.3, 8, "marble", caps=(False, True))
    base_me = mesh_of(bg, "ColumnBaseMesh", M, TILE)
    for i, (mm, r, hh) in enumerate(COLS):
        place(col_me, f"Column.{i:04d}", parts, mm @ T(0, 0, 0.18) @ Matrix.Diagonal((r, r, hh - 0.18, 1.0)))
        place(base_me, f"ColumnBase.{i:04d}", parts, mm @ Matrix.Diagonal((r, r, 1.0, 1.0)))
    if BRK:
        br = mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE)
        for i, mm in enumerate(BRK):
            place(br, f"Bracket.{i:04d}", parts, mm)
    if HIPS:
        beast = mesh_of(beast_geo(lite=True, glaze=glaze), "BeastMesh", M, TILE)
        meshes = dict(beast=beast, immortal=beast)
        for i, (line, n) in enumerate(HIPS):
            beasts_on(line, parts, meshes, f"Beast{i}", n=n)
    return dict(columns=len(COLS), brackets=len(BRK), hips=len(HIPS))


# =====================================================================================================
# 恭王府
# =====================================================================================================

def xiyangmen(cx, cy):
    """西洋门: the garden's white marble gate in the Western manner - a round arch between paired pilasters,
    an entablature, a scrolled parapet rising to the middle, a carved panel over the arch; set in the wall."""
    g = Geo()
    W, D, Hm = 4.8, 0.9, 6.2           # half width, half depth, entablature top
    aw, ah = 1.8, 3.6                  # the arch's half width and springing height
    seg = 12
    arc = [(aw * math.cos(math.pi * k / seg), ah + aw * math.sin(math.pi * k / seg)) for k in range(seg + 1)]   # right to left
    for sy in (-1, 1):
        y = sy * D
        # the face round the arch: the two piers, then the spandrel strips between the arch and the top
        g.polyn([(-W, y, 0), (-aw, y, 0), (-aw, y, ah), (-W, y, ah)], "white", (0, sy, 0))
        g.polyn([(aw, y, 0), (W, y, 0), (W, y, ah), (aw, y, ah)], "white", (0, sy, 0))
        for (x0, z0), (x1, z1) in zip(arc, arc[1:]):
            g.polyn([(x0, y, z0), (x1, y, z1), (x1, y, Hm - 0.8), (x0, y, Hm - 0.8)], "white", (0, sy, 0))
        g.polyn([(-W, y, ah), (-aw, y, ah), (-aw, y, Hm - 0.8), (-W, y, Hm - 0.8)], "white", (0, sy, 0))
        g.polyn([(aw, y, ah), (W, y, ah), (W, y, Hm - 0.8), (aw, y, Hm - 0.8)], "white", (0, sy, 0))
        # pilasters: two each side of the arch, with bases and capitals
        for px in (-4.1, -2.7, 2.7, 4.1):
            g.box(px - 0.32, px + 0.32, y + (0 if sy > 0 else -0.18), y + (0.18 if sy > 0 else 0), 0.45, Hm - 0.95, "white")
            g.box(px - 0.42, px + 0.42, y + (0 if sy > 0 else -0.26), y + (0.26 if sy > 0 else 0), 0.0, 0.45, "white")
            g.box(px - 0.45, px + 0.45, y + (0 if sy > 0 else -0.3), y + (0.3 if sy > 0 else 0), Hm - 0.95, Hm - 0.7, "white")
        # the keystone and the archivolt
        g.box(-0.3, 0.3, y + (0 if sy > 0 else -0.12), y + (0.12 if sy > 0 else 0), ah + aw - 0.15, ah + aw + 0.5, "white")
        # the panel over the arch (静含太古 / 秀挹恒春), a grey stone slab
        g.box(-1.3, 1.3, y + (0 if sy > 0 else -0.06), y + (0.06 if sy > 0 else 0), ah + aw + 0.6, Hm - 0.95, "marble")
    # the soffit of the arch, the jambs
    for (x0, z0), (x1, z1) in zip(arc, arc[1:]):
        g.polyn([(x0, -D, z0), (x1, -D, z1), (x1, D, z1), (x0, D, z0)], "white", (-(x0 + x1) / 2, 0, -((z0 + z1) / 2 - ah)))
    for sx in (-1, 1):
        g.polyn([(sx * aw, -D, 0), (sx * aw, D, 0), (sx * aw, D, ah), (sx * aw, -D, ah)], "white", (-sx, 0, 0))
        g.polyn([(sx * W, -D, 0), (sx * W, D, 0), (sx * W, D, Hm), (sx * W, -D, Hm)], "white", (sx, 0, 0))
    # the entablature (a band proud of both faces) and the cornice
    g.box(-W - 0.25, W + 0.25, -D - 0.3, D + 0.3, Hm - 0.8, Hm - 0.2, "white", skip=("-z",))
    g.box(-W - 0.45, W + 0.45, -D - 0.45, D + 0.45, Hm - 0.2, Hm, "white")
    g.polyn([(-W - 0.25, -D - 0.3, Hm - 0.8), (W + 0.25, -D - 0.3, Hm - 0.8), (W + 0.25, D + 0.3, Hm - 0.8), (-W - 0.25, D + 0.3, Hm - 0.8)], "white", (0, 0, -1))
    # the parapet: a stepped attic, a scrolled crest rising to the middle, urns on the ends
    prof = [(-W, Hm), (-W, Hm + 0.7), (-2.6, Hm + 0.7), (-2.2, Hm + 1.1), (-1.6, Hm + 1.6), (-0.9, Hm + 2.0), (0.0, Hm + 2.25),
            (0.9, Hm + 2.0), (1.6, Hm + 1.6), (2.2, Hm + 1.1), (2.6, Hm + 0.7), (W, Hm + 0.7), (W, Hm)]
    for sy in (-1, 1):
        g.polyn([(x, sy * 0.6, z) for x, z in prof], "white", (0, sy, 0))
    for (x0, z0), (x1, z1) in zip(prof, prof[1:]):
        g.polyn([(x0, -0.6, z0), (x1, -0.6, z1), (x1, 0.6, z1), (x0, 0.6, z0)], "white", (-(z1 - z0), 0, (x1 - x0)))
    for x in (-W + 0.35, W - 0.35):
        lathe(g, [(0.0, Hm + 0.7), (0.28, Hm + 0.7), (0.3, Hm + 0.85), (0.16, Hm + 0.95), (0.3, Hm + 1.25), (0.22, Hm + 1.45), (0.06, Hm + 1.55), (0.0, Hm + 1.7)], 8, "white", x=x, y=0.0)
    lathe(g, [(0.0, Hm + 2.2), (0.2, Hm + 2.25), (0.12, Hm + 2.45), (0.22, Hm + 2.65), (0.0, Hm + 2.95)], 8, "white", x=0.0, y=0.0)
    G.add(g, T(cx, cy, 0))
    COLL.append(("box", cx - W, cx - aw, cy - D, cy + D, 0.0, Hm))
    COLL.append(("box", cx + aw, cx + W, cy - D, cy + D, 0.0, Hm))
    COLL.append(("box", cx - aw, cx + aw, cy - D, cy + D, ah + aw * 0.7, Hm + 0.7))
    BODIES.append((cx - W - 0.2, cx + W + 0.2, cy - D - 0.5, cy + D + 0.5))
    CLEARS.append(rect(cx - W - 1.5, cx + W + 1.5, cy - 2.5, cy + 2.5))
    f = Geo()
    f.box(-W, W, -D, D, 0.0, Hm + 0.7, "white", skip=("-z",))
    FAR.add(f, T(cx, cy, 0))


def bat_pond(cx, cy, s=1.0):
    """蝠池: a pond shaped like a bat with spread wings (a 福 pun), in a stone kerb."""
    pts = []
    n = 40
    for k in range(n):
        t = 2 * math.pi * k / n
        c, si = math.cos(t), math.sin(t)
        x = 9.0 * c * (1 + 0.15 * c * c)
        y = 4.2 * si * (0.55 + 0.45 * abs(c) ** 0.7)
        if si < 0:                                           # scalloped trailing edges of the wings
            y -= 0.9 * abs(math.sin(3 * t)) * abs(c)
        if si > 0 and abs(c) < 0.25:                         # the head
            y += 1.6 * (1 - abs(c) / 0.25)
        pts.append((cx + s * x, cy + s * y))
    pond(pts, z=0.06, kerb=0.4)
    BODIES.append((cx - 10.5 * s, cx + 10.5 * s, cy - 6 * s, cy + 6.5 * s))


def opera_house(r):
    """大戏楼: a big hall under three roofs side by side (勾连搭), ridges east-west; grey tiles."""
    x0, x1, y0, y1 = r
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    m = M_of(cx, cy, 0)
    g = Geo()
    bx, by = hx - 0.8, hy - 0.8
    z0, zw = 0.45, 7.2
    base(g, bx, by, z0, pad=0.5)
    # walls: lattice on the long sides (east and west), plaster on the ends with a door south
    for sx in (-1, 1):
        n = max(1, round(2 * by / 3.6))
        for i in range(n):
            a, b = -by + 2 * by * i / n, -by + 2 * by * (i + 1) / n
            g.polyn([(sx * bx, a, z0), (sx * bx, b, z0), (sx * bx, b, zw), (sx * bx, a, zw)], "atlas", (sx, 0, 0), uvs=uvs("window" if i % 3 else "door", QUAD))
            g.box(sx * bx - 0.15, sx * bx + 0.15, a - 0.15, a + 0.15, z0, zw, "red", skip=("-z", "+z"))
    for sy in (-1, 1):
        g.polyn([(-bx, sy * by, z0), (bx, sy * by, z0), (bx, sy * by, zw), (-bx, sy * by, zw)], "plaster", (0, sy, 0))
    g.polyn([(-1.6, -by - 0.02, z0), (1.6, -by - 0.02, z0), (1.6, -by - 0.02, z0 + 3.2), (-1.6, -by - 0.02, z0 + 3.2)], "atlas", (0, -1, 0), uvs=uvs("door", QUAD))
    beam_band(g, bx, by, zw, zw + 0.5)
    # three roofs along y, each a 硬山 running east-west
    D = hy / 3
    for k in range(3):
        yc = -hy + D * (2 * k + 1)
        yroof(g, bx + 0.3, D, zw + 0.4, 0.55 * D + 0.4, key="ytex", wen_k=0.35, y0=yc)
    for sx in (-1, 1):                                       # the three gables each end
        for k in range(3):
            yc = -hy + D * (2 * k + 1)
            prof = [(yc - D + 0.3, zw + 0.5), (yc, zw + 0.4 + 0.55 * D + 0.25), (yc + D - 0.3, zw + 0.5)]
            g.polyn([(sx * (bx + 0.05), y, z) for y, z in prof], "plaster", (sx, 0, 0))
    remap(g, GREY)
    G.add(g, m)
    cbox(m, -bx - 0.5, bx + 0.5, -by - 0.5, by + 0.5, 0.0, zw + 0.5)
    body_rect(m, -bx - 0.5, bx + 0.5, -by - 0.5, by + 0.5)
    f = Geo()
    f.box(-bx, bx, -by, by, 0.0, zw + 0.5, "plaster", skip=("-z",))
    for k in range(3):
        yc = -hy + D * (2 * k + 1)
        f.polyn([(-hx, yc - D, zw + 0.4), (hx, yc - D, zw + 0.4), (hx, yc, zw + 0.4 + 0.55 * D + 0.4), (-hx, yc, zw + 0.4 + 0.55 * D + 0.4)], "grey", (0, -1, 1))
        f.polyn([(hx, yc + D, zw + 0.4), (-hx, yc + D, zw + 0.4), (-hx, yc, zw + 0.4 + 0.55 * D + 0.4), (hx, yc, zw + 0.4 + 0.55 * D + 0.4)], "grey", (0, 1, 1))
    FAR.add(f, m)


def platform(r, z, key="marble", coll=True):
    x0, x1, y0, y1 = r
    G.box(x0, x1, y0, y1, 0.0, z, key, skip=("-z",))
    FAR.box(x0, x1, y0, y1, 0.0, z, key, skip=("-z",))
    if coll:
        COLL.append(("box", x0, x1, y0, y1, 0.0, z))


# --- the plan (local metres; see the header) ---------------------------------------------------------------
AXIS = -7.0
# the outer wall: 前海西街 along the south, the east lane, the garden's north on 大翔凤胡同, 柳荫街 down the west
# (kept 2 m or more off each carriageway's edge)
OUTER = [(-40.0, -152.0), (66.0, -152.0), (66.0, 184.0), (-123.4, 184.0), (-123.0, 175.8), (-120.5, 150.0), (-117.2, 124.2),
         (-109.5, 93.0), (-103.0, 61.7), (-96.3, 30.5), (-56.6, -122.6), (-52.0, -136.0)]
GATE_S = (AXIS - 2.8, AXIS + 2.8)        # the opening in the south wall on the axis


def west_x(y):
    """The outer wall's x on the west side at y (south of the garden)."""
    return -56.6 + (-96.3 + 56.6) * (y + 122.6) / (30.5 + 122.6)


def gongwangfu():
    stats = {}
    tri = [0]

    def mark(k):
        stats["t_" + k] = G.tris() - tri[0]
        tri[0] = G.tris()

    # ---- the middle axis (green glazed) -------------------------------------------------------------------
    simple_hall((-17.2, 5.6, -125.2, -114.8), "n", 3.6, tone="g", passages=[(-6.3, -2.2)])               # 倒座房 (the ticket hall)
    simple_hall((-22.3, 10.1, -96.4, -87.6), "s", 4.4, roof="xie", ov=1.5, passages=[(AXIS - 1.9, AXIS + 1.9)], door_bays=3, Hk=0.55)   # 一宫门
    simple_hall((-15.6, -2.1, -75.9, -65.8), "s", 4.2, roof="xie", ov=1.4, passages=[(AXIS - 1.7, AXIS + 1.7)], back=True, Hk=0.55)      # 二宫门
    simple_hall((-26.0, -20.0, -63.0, -49.5), "e", 3.8, ov=1.0)                                          # 银安殿's west side hall
    simple_hall((6.0, 12.0, -63.0, -49.5), "w", 3.8, ov=1.0)                                             # east side hall
    mark("gates")
    # 银安殿: five bays with a colonnade on a 1.1 m platform, its 月台 in front
    YAD = (-18.2, 3.8, -46.8, -28.3)
    hy = spec(9.0, 7.25, lin(9.0, 5), [-7.25, -5.45, 0.0, 5.45, 7.25], 1.1 + 5.2, 2.0, rows=7, end_rows=4, Hk=0.6, gap=1.8)
    m = main_hall(YAD, hy, 1.1, True, front_doors=3, back_doors=1, beasts=5)
    g = Geo()
    ya, yb = -hy.OY - 0.9 - 6.5, -hy.OY - 0.9
    g.box(-8.0, 8.0, ya, yb, 0.0, 0.95, "marble", skip=("-z",))
    g.box(-8.15, 8.15, ya - 0.15, yb, 0.82, 0.95, "marble", skip=("-z",))
    ramp = steps(g, -2.5, 2.5, ya - 0.15, -1, 0.0, 0.95)
    G.add(g, m)
    walk(m, ramp)
    cbox(m, -8.15, 8.15, ya - 0.15, yb, 0.0, 0.95)
    body_rect(m, -8.15, 8.15, ya - 0.15, yb)
    mark("yinandian")
    simple_hall((-19.6, 4.9, -7.3, 14.0), "s", 4.6, roof="xie", ov=1.8, door_bays=3, Hk=0.55, z0=0.6)    # 嘉乐堂
    simple_hall((-26.0, -20.0, -24.0, -11.0), "e", 3.6, ov=1.0, tone="g")                                # its side halls
    simple_hall((6.0, 12.0, -24.0, -11.0), "w", 3.6, ov=1.0, tone="g")
    mark("jialetang")

    # ---- the east axis (grey) -------------------------------------------------------------------------
    simple_hall((22.0, 54.0, -86.0, -76.0), "s", 3.8, tone="g", passages=[(36.0, 40.0)])                 # the front hall
    simple_hall((20.1, 56.3, -41.0, -22.2), "s", 4.4, roof="xie", ov=1.7, tone="g", door_bays=3, Hk=0.55, z0=0.5)   # 多福轩
    simple_hall((17.0, 23.0, -60.0, -45.0), "e", 3.6, ov=1.0, tone="g")
    simple_hall((52.0, 58.0, -60.0, -45.0), "w", 3.6, ov=1.0, tone="g")
    simple_hall((20.0, 56.0, 1.0, 14.0), "s", 4.2, tone="g", door_bays=3, z0=0.5)                         # 乐道堂
    simple_hall((17.0, 23.0, -18.0, -4.0), "e", 3.6, ov=1.0, tone="g")
    simple_hall((52.0, 58.0, -18.0, -4.0), "w", 3.6, ov=1.0, tone="g")
    mark("east")
    # ---- the west axis (grey) -------------------------------------------------------------------------
    simple_hall((-62.0, -34.0, -92.0, -80.0), "s", 3.8, tone="g", passages=[(-50.0, -46.0)])             # the front hall
    simple_hall((-66.1, -29.4, -39.2, -25.7), "s", 4.2, roof="xie", ov=1.5, tone="g", door_bays=3, Hk=0.55, z0=0.5)  # 葆光室
    simple_hall((-66.0, -60.5, -62.0, -46.0), "e", 3.6, ov=1.0, tone="g")
    simple_hall((-35.0, -29.5, -62.0, -46.0), "w", 3.6, ov=1.0, tone="g")
    simple_hall((-64.0, -31.0, 0.0, 14.0), "s", 4.4, roof="xie", ov=1.6, tone="g", door_bays=3, Hk=0.55, z0=0.6)    # 锡晋斋
    simple_hall((-71.0, -65.0, -20.0, -5.0), "e", 3.6, ov=1.0, tone="g")
    simple_hall((-35.0, -29.5, -20.0, -5.0), "w", 3.6, ov=1.0, tone="g")
    mark("west")
    # ---- 后罩楼: two storeys, 154 m across the north, a passage on the axis -------------------------------
    simple_hall((-90.0, 64.0, 20.0, 31.0), "s", 7.4, storeys=2, zm=3.9, back=True, tone="g", passages=[(AXIS - 2.0, AXIS + 2.0)], Hk=0.55, z0=0.45)
    mark("houzhaolou")

    # ---- the garden -----------------------------------------------------------------------------------------
    xiyangmen(AXIS, 41.0)
    rock_spire(AXIS, 48.5, 3.0, 4.2, 7, lean=0.1)                         # 飞来石
    rock_spire(AXIS, 57.0, 2.2, 5.2, 11, plinth=0.6)                      # 独乐峰
    bat_pond(AXIS, 69.0)
    simple_hall((-19.0, 5.0, 96.0, 108.0), "s", 4.2, roof="xie", ov=1.6, tone="g", door_bays=3, Hk=0.55, z0=0.6)   # 安善堂
    simple_hall((-36.0, -28.0, 82.0, 96.0), "e", 3.6, ov=1.1, tone="g")                                  # 明道斋
    simple_hall((14.0, 22.0, 82.0, 96.0), "w", 3.6, ov=1.1, tone="g")                                    # 棣华轩
    height = rockery(AXIS + 1.0, 127.0, 20.0, 11.0, 5.2, 21, peaks=((AXIS - 9.0, 124.0, 1.6, 3.0), (AXIS + 10.0, 129.0, 1.2, 3.0)))   # 滴翠岩
    zt = height(AXIS - 1.0, 128.5)
    simple_hall_at(AXIS - 1.0, 128.5, 0.0, 4.6, 3.0, zt + 3.4, roof="xie", ov=0.9, tone="g", z0=zt + 0.45, Hk=0.55)   # 绿天小隐 on top
    simple_hall((-16.0, 2.0, 147.0, 158.0), "s", 4.2, roof="xie", ov=1.5, tone="g", door_bays=3, Hk=0.55, z0=0.5)   # 蝠厅's middle
    for sx, x_in in ((-1, -16.5), (1, 1.5)):                                                              # its wings, swept back
        simple_hall_at(x_in + sx * 5.2 * math.cos(0.6), 152.5 + 5.2 * math.sin(0.6), sx * 0.6, 5.2, 3.2, 3.6, ov=1.0, tone="g")
    opera_house((18.7, 38.0, 110.3, 148.2))                                                              # 大戏楼
    simple_hall((44.0, 62.0, 88.0, 100.0), "w", 3.8, tone="g", door_bays=3)                              # 怡神所
    # the pond 方塘水榭: OSM's water is the city's; its revetment, the island and 湖心亭 on it
    pond([(-70.3, 72.5), (-39.7, 72.6), (-39.6, 121.9), (-70.3, 121.8)], water=False)
    platform((-62.3, -46.8, 94.9, 105.4), 0.6)
    simple_hall((-61.6, -47.5, 95.6, 104.7), "s", 3.4, roof="xie", ov=1.1, tone="g", door_bays=3, z0=0.75, Hk=0.6)   # 湖心亭
    # the west gallery (OSM's 头宫门 there): along the street, facing into the garden
    gp = [L(-1610.1, -3106.4), L(-1603.2, -3108.1), L(-1591.8, -3062.6), L(-1598.7, -3060.9)]
    gc = Vector(((gp[0][0] + gp[2][0]) / 2, (gp[0][1] + gp[2][1]) / 2))
    along = Vector(gp[2]) - Vector(gp[1])
    ang = math.atan2(along.y, along.x)                      # its x along the street, so its front (-y) faces east
    simple_hall_at(gc.x, gc.y, ang, along.length / 2, (Vector(gp[1]) - Vector(gp[0])).length / 2, 3.4, ov=1.0, tone="g")
    pavilion(-80.0, 152.0, 2.2)                            # 流杯亭
    pavilion(46.0, 165.0, 2.0)
    pavilion(-36.0, 172.0, 1.8, kind="xieshan", hy=1.6)
    mark("garden")

    # ---- walls -------------------------------------------------------------------------------------------
    # the south side has the gate on the axis: split the closed ring there
    south = [(GATE_S[1], -152.0), (66.0, -152.0), (66.0, 184.0), (-123.4, 184.0), (-123.0, 175.8), (-120.5, 150.0), (-117.2, 124.2),
             (-109.5, 93.0), (-103.0, 61.7), (-96.3, 30.5), (-56.6, -122.6), (-52.0, -136.0), (-40.0, -152.0), (GATE_S[0], -152.0)]
    n_outer = walls([(south, False)], zt=4.6, th=0.8, key="brick", plinth="brick")
    # the gate piers either side of the opening
    for x in GATE_S:
        G.box(x - 0.6, x + 0.6, -152.6, -151.4, 0.0, 5.2, "brick", skip=("-z",))
        G.box(x - 0.75, x + 0.75, -152.75, -151.25, 5.2, 5.5, "grey")
        COLL.append(("box", x - 0.6, x + 0.6, -152.6, -151.4, 0.0, 5.5))
    inner = [
        ([(-28.0, -92.0), (-28.0, 19.5)], False),                     # between the middle and the west axis
        ([(14.5, -92.0), (14.5, 19.5)], False),                       # between the middle and the east axis
        ([(14.5, -81.0), (66.0, -81.0)], False),                      # the east axis' front, through its front hall
        ([(west_x(-86.0), -86.0), (-28.0, -86.0)], False),            # the west axis' front
        ([(-28.0, -92.0), (14.5, -92.0)], False),                     # 一宫门's line
        ([(-28.0, -70.8), (14.5, -70.8)], False),                     # 二宫门's line
        ([(14.5, -68.0), (35.5, -68.0)], False), ([(40.5, -68.0), (66.0, -68.0)], False),      # the east axis, a gate gap
        ([(west_x(-68.0), -68.0), (-50.5, -68.0)], False), ([(-45.5, -68.0), (-28.0, -68.0)], False),
        ([(west_x(41.0) + 0.4, 41.0), (AXIS - 5.0, 41.0)], False), ([(AXIS + 5.0, 41.0), (66.0, 41.0)], False),   # the garden's south wall
    ]
    n_inner = walls(inner, zt=3.8, th=0.7)
    stats["walls"] = n_outer + n_inner
    mark("walls")

    # ---- paving: the mansion's courts, the garden's two forecourts ---------------------------------------
    mansion = [(-40.0, -151.6), (65.6, -151.6), (65.6, 40.6), (west_x(40.6) + 0.4, 40.6), (-56.2, -122.6), (-51.6, -136.0)]
    paved(mansion)
    paved(rect(-22.0, 8.0, 41.4, 56.0))
    paved(rect(-30.0, 16.0, 79.0, 95.5))
    return stats


def footprints_gwf(helpers):
    """Convex pieces: the mansion (with the forecourt), the garden in two; out to OSM's precinct line, so the
    generated compound walls along it go too (the model's own wall stands a few metres inside, off the lanes)."""
    flat_marker(helpers, "mansion", [(-30.0, -160.5), (71.0, -161.5), (71.0, 40.0), (-97.0, 40.0), (-56.9, -122.6), (-52.4, -136.2), (-42.0, -151.0)], "FOOTPRINT")
    flat_marker(helpers, "gardenS", [(-97.0, 40.0), (71.0, 40.0), (78.0, 50.0), (78.0, 110.0), (-111.5, 110.0), (-104.2, 61.7)], "FOOTPRINT")
    flat_marker(helpers, "gardenN", [(-111.5, 110.0), (78.0, 110.0), (77.0, 187.6), (-124.0, 187.6), (-121.0, 150.0), (-117.8, 124.2)], "FOOTPRINT")


def build():
    clear_file()
    ensure_addon()
    reset()
    M = materials("GW")
    main = collection("恭王府")
    parts = collection("构件", main)
    stats = gongwangfu()
    G.build("Mansion", collection("府", main), M, TILE)
    stats["tris"] = G.tris()
    stats.update(instances(parts, M, glaze="#3f7d4c"))
    FAR.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = FAR.tris()
    helpers = collection("碰撞体")
    stats.update(emit_colliders(helpers))
    footprints_gwf(helpers)
    for i, poly in enumerate(CLEARS):
        flat_marker(helpers, f"clear{i}", poly, "CLEAR")
    stats["clears"] = len(CLEARS)
    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "gongwangfu", "恭王府", "Prince Gong's Mansion"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", ANCHOR[0], ANCHOR[1], HEADING
    s.far_distance = 450
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
