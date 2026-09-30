# 中国美术馆 National Art Museum of China (戴念慈, completed 1961-62, one of the Ten Great Buildings), on the north
# side of 五四大街, built in Blender and marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/art_museum.py -- [--out art/landmarks/artmuseum.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground on the building's axis, game (443.6, -1681.43),
# heading -0.46 (OSM way 131710744's edges). The plan is OSM's outline squared and made symmetric: the long main
# block (115 x 50 m), the two single-storey pavilions reaching forward to the square at its front corners, lower
# blocks at the back corners and the round hall on the axis behind. The elevation is from photographs (Wikimedia
# Commons, the front from 五四大街 and the square): cream stone faced walls; the ground floor an arcade of square
# columns under a yellow glazed skirt roof; a storey of windows; the third storey a colonnade under the long yellow
# eave; on the axis the entrance porch (four piers, 中国美术馆 on the board, a single 歇山) and over it the tower,
# the eaves of Dunhuang's 九层楼 pressed together: the main eave, two more close over it, the top storey, and a
# double-eaved 庑殿 with a gilt finial - seven eaves with the porch and the ground floor's. The corner pavilions
# are the 廊榭: open colonnades round a core under 歇山 roofs.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import QUAD, Canvas, Geo, T, collider_box, collider_pts, cyl, ell, fwall, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from hall import eave_edge, paint_atlas, roof_face, roof_z, roofs, soffit, sweep, uvs  # noqa: E402
from zhengyangmen import ceiling, steps_ramp  # noqa: E402
from national_museum import facing, lettering  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "artmuseum.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

POD = 1.2                                  # the podium the front stands on
# the main block: ground floor and the storey of windows
MX, MY0, MY1 = 57.5, -35.0, 15.0
Z2, Z2TOP = 10.0, 16.6                    # the second storey's wall, its cornice ledge to 17.2
ZR2 = 17.2                                # the second storey's roof (a terrace round the third)
# the ground floor's arcade across the front between the pavilions
ARC = dict(x=36.0, col=-38.0, eave=-39.8, z=8.6, H=1.4, top=7.6)
# the third storey: a colonnade round a recessed wall under the long eave
C3 = dict(x=48.0, y0=-34.5, y1=11.0, wall_x=45.5, wall_y0=-32.0, wall_y1=8.5, top=20.5, z=21.6, H=1.4, over=1.9, DL=4.2)
ZR3 = C3["z"] + C3["H"]                   # its flat roof, 23.0
# the tower: a stage over the porch, two more eaves pressed over the main one, the top storey and its roof
TY = -26.0                                 # the tower's centre line (y)
ST1 = dict(X=10.0, Y=9.0)
E2 = dict(z=24.0, H=1.1, over=1.8)         # rises to stage 2 (8.8 x 7.8)
ST2 = dict(X=8.8, Y=7.8)
E3 = dict(z=25.9, H=1.0, over=1.7)         # rises to the top storey (7.2 x 6.2)
TOP = dict(X=7.2, Y=6.2)
TOPROOF = SimpleNamespace(
    XS=[-7.2, -5.8, 5.8, 7.2], YS=[-6.2, -4.8, 4.8, 6.2], OX=7.2, OY=6.2, IX=5.8, IY=4.8,
    BEAM=(28.2, 28.6, 28.6, 28.75), UBEAM=(30.1, 30.5, 30.5, 30.78), OVERHANG=1.8,
    LOWER=dict(A=9.0, D=8.0, z=29.0, H=0.9, p=1.2, o=0.55, lift=0.55, Lc=3.2, Vc=1.8),
    UPPER=dict(A=7.6, D=6.6, z=30.9, H=2.9, p=1.8, o=0.6, lift=0.7, Lc=3.0, Vc=2.2),
    GABLE_X=0.0, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="wudian", ROWS=11, END_ROWS=9, LOWER_ROWS=4, WEN=0.55)
# the entrance porch (抱厦): four piers, a single-eaved 歇山 against the main block
PORCH = dict(xo=11.2, xi=4.0, y=-43.5, back=MY0, band=(9.0, 10.4))
PY = (PORCH["y"] + PORCH["back"]) / 2
PORCH_ROOF = SimpleNamespace(
    XS=[-11.2, -4.0, 4.0, 11.2], YS=[-4.25, 4.25], OX=11.2, OY=4.25, IX=11.19, IY=4.24,
    BEAM=(9.0, 10.4, 10.4, 10.5), UBEAM=(9.0, 10.4, 10.4, 10.5), OVERHANG=1.9, LOWER=None,
    UPPER=dict(A=13.1, D=6.15, z=10.8, H=3.4, p=1.6, o=0.55, lift=0.6, Lc=3.0, Vc=1.8),
    GABLE_X=7.8, PITCH=0.46, AMP=0.1, TRIM=0.0, RIDGE="tile", KIND="xieshan", ROWS=10, END_ROWS=5, WEN=0.6)
STEPS = dict(x=10.0, y0=-45.0, n=10)      # ten steps down to the square from the porch's floor
# the corner pavilions (east; the west mirrors it): columns round a core under a 歇山
PAV = dict(x0=36.0, x1=70.0, y0=-54.0, y1=-35.0, cx=53.0, cy=-44.5, OX=16.0, OY=9.0, core=(40.0, 66.0, -50.0, -35.0), top=7.4)
PAV_ROOF = SimpleNamespace(
    XS=[-16.0, 16.0], YS=[-9.0, 9.0], OX=16.0, OY=9.0, IX=15.99, IY=8.99,
    BEAM=(7.4, 8.4, 8.4, 8.45), UBEAM=(7.4, 8.4, 8.4, 8.45), OVERHANG=1.8, LOWER=None,
    UPPER=dict(A=17.8, D=10.8, z=8.6, H=3.6, p=1.7, o=0.6, lift=0.6, Lc=3.4, Vc=2.2),
    GABLE_X=9.5, PITCH=0.7, AMP=0.12, TRIM=0.0, RIDGE="tile", KIND="xieshan", ROWS=7, END_ROWS=4, WEN=0.7)
# the lower blocks at the back corners (east; mirrored) and the round hall on the axis
BACK = dict(x0=38.5, x1=69.0, y0=MY1, y1=30.8, h=13.0)
APSE = dict(y=MY1, r=18.0, h=12.0)
LONG_PITCH, LONG_AMP = 0.8, 0.12


# --- textures ------------------------------------------------------------------------------------------

def facade_images(size=512):
    """One bay of the stone faced walls: cream tiles, a tall window of six lights in a stone surround, lit at night."""
    cv, glow = Canvas(size, size, "#e1d5bb"), Canvas(size, size, "#000000")
    cv.noise(0.06, 3)
    y, x = cv.y / size, cv.x / size          # y down from the top of the storey
    cv.put(np.mod(cv.y, size / 8) < 1.6, cv.a[0, 0] * 0.93)                        # the tile courses
    cv.put((x < 0.07) | (x > 0.93), "#e9dfc9")                                    # the pilaster strips
    win = (np.abs(x - 0.5) < 0.3) & (y > 0.2) & (y < 0.76)
    frame = (np.abs(x - 0.5) < 0.33) & (y > 0.17) & (y < 0.79) & ~win
    cv.put(frame, "#efe7d4")
    glass = srgb("#27313a") + (0.14 * (y - 0.2))[..., None] * srgb("#9fb0c0")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(np.mod((x - 0.2) / 0.6 * 3, 1.0) - 0.5) > 0.47) | (np.abs(y - 0.4) < 0.006) | (np.abs(y - 0.62) < 0.006))
    cv.put(bars, "#b9ad93")
    cv.put((y > 0.8) & (y < 0.86) & (np.abs(x - 0.5) < 0.3), "#cfc2a4")          # the spandrel panel under it
    rng = np.random.default_rng(9)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffc986") * (0.3 + 0.3 * rng.random((size, size), np.float32)[lit][:, None])
    return image("AM_Facade", np.flipud(cv.a).copy()), image("AM_FacadeNight", np.flipud(glow.a).copy())


def glass_images(size=256):
    """A bay of glazing between stone pilasters (the tower, the arcade, the pavilions' cores), lit at night."""
    cv, glow = Canvas(size, size, "#233039"), Canvas(size, size, "#000000")
    y, x = cv.y / size, cv.x / size
    cv.a += (0.12 * (1 - y))[..., None] * srgb("#8ea3b5")
    bar = (np.mod(x * 4, 1.0) < 0.04) | (np.abs(y - 0.3) < 0.012) | (y > 0.975)
    cv.put(bar, "#6f6a5f")
    stone = (x < 0.09) | (x > 0.91)
    cv.put(stone, "#e3d8c1")
    glow.put(~bar & ~stone, (0.26, 0.19, 0.1))
    return image("AM_Glass", np.flipud(cv.a).copy()), image("AM_GlassNight", np.flipud(glow.a).copy())


# --- roofs ---------------------------------------------------------------------------------------------

def skirt(g, A, D, DL, z, H, p=1.4, o=0.45, lift=0.5, Lc=2.6, Vc=1.6, rows=4, pitch=0.46, amp=0.1, zb=None, span=None, lod=False):
    """A skirt roof (腰檐) round a rectangle centred on the origin: eave half sizes A x D, rising DL in plan and H
    to the wall inside (A - DL, D - DL), with its hips, the ridge where it meets the wall and the eave's underside."""
    R = dict(z=z, H=H, p=p, o=o, lift=lift, Lc=Lc, Vc=Vc)
    hips = []
    for rot in range(4):
        Af, De = (A, D) if rot % 2 == 0 else (D, A)
        rw = roof_face(g, R, DL, rot, Af, De, DL, rows=2 if lod else rows, waves=not lod, cols=8, pitch=pitch, amp=amp)
        if lod:
            continue
        eave_edge(g, rw[0])
        if span:
            soffit(g, R, DL, rot, Af, De, zb, span=span)
        hips.append([r[-1] for r in rw])
    if lod:
        return
    IX, IY, zw = A - DL, D - DL, z + H
    g.box(-IX - 0.45, IX + 0.45, -IY - 0.45, -IY + 0.05, zw - 0.2, zw + 0.3, "tile")
    g.box(-IX - 0.45, IX + 0.45, IY - 0.05, IY + 0.45, zw - 0.2, zw + 0.3, "tile")
    g.box(-IX - 0.45, -IX + 0.05, -IY, IY, zw - 0.2, zw + 0.3, "tile")
    g.box(IX - 0.05, IX + 0.45, -IY, IY, zw - 0.2, zw + 0.3, "tile")
    for line in hips:
        sweep(g, line, 0.5, 0.4, key="tile")


def soffit_z(z, H, DL, v, p=1.4):
    """The underside of a skirt at plan distance v in from its eave (0.3 under the tiles)."""
    return z + H * (v / DL) ** p - 0.3


def straight_eave(g, x0, x1, y_eave, y_wall, z, H, span, pitch=LONG_PITCH, amp=LONG_AMP, lod=False):
    """A lean-to of tiles from an eave along x (at y_eave, facing -y) up to a wall at y_wall, square ends."""
    DL = y_wall - y_eave
    A = (x1 - x0) / 2
    R = dict(z=z, H=H, p=1.4, o=0.0, lift=0.0, Lc=0.01, Vc=0.01)
    sub = Geo()
    rw = roof_face(sub, R, DL, 0, A, DL, DL, cap=A, rows=2 if lod else 4, waves=not lod, cols=4, pitch=pitch, amp=amp)
    if not lod:
        eave_edge(sub, rw[0])
        soffit(sub, R, DL, 0, A, DL, soffit_z(z, H, DL, span), cap=A, span=span)
        for s in (-1, 1):
            prof = [Vector((s * A, -DL + DL * t / 6, roof_z(R, DL, DL * t / 6))) for t in range(7)]
            sub.polyn(prof + [Vector((s * A, 0, z - 0.3)), Vector((s * A, -DL, z - 0.3))], "tile", (s, 0, 0))
    g.add(sub, T((x0 + x1) / 2, y_wall, 0))


def finial(g, z):
    """The gilt 宝顶 on the ridge."""
    cyl(g, 0, 0, z, z + 0.45, 0.6, 0.45, 12, "tile", caps=(False, True))
    cyl(g, 0, 0, z + 0.45, z + 0.8, 0.38, 0.38, 12, "gold", caps=(False, True))
    ell(g, (0, 0, z + 1.4), (0.45, 0.45, 0.65), "gold", nu=12, nv=7)
    cyl(g, 0, 0, z + 1.95, z + 2.5, 0.1, 0.03, 8, "gold", caps=(False, True))


# --- walls ---------------------------------------------------------------------------------------------

def walls(g, x0, x1, y0, y1, z0, z1, key, bay=3.6, storey=5.5, zref=None, sides="snew"):
    """The walls of a rectangle, UVs in bays and storeys."""
    zref = z0 if zref is None else zref
    P = {"s": ((x0, y0), (x1, y0), (0, -1)), "e": ((x1, y0), (x1, y1), (1, 0)), "n": ((x1, y1), (x0, y1), (0, 1)), "w": ((x0, y1), (x0, y0), (-1, 0))}
    for s in sides:
        a, b, out = P[s]
        fwall(g, Vector(a), Vector(b), z0, z1, key, out, bay=bay, storey=storey, zref=zref)


def band_ring(g, x0, x1, y0, y1, z0, z1, region="beam", sides="snew"):
    """A painted beam band round a rectangle (the atlas's 和玺 beam)."""
    P = {"s": ((x0, y0), (x1, y0), (0, -1)), "e": ((x1, y0), (x1, y1), (1, 0)), "n": ((x1, y1), (x0, y1), (0, 1)), "w": ((x0, y1), (x0, y0), (-1, 0))}
    for s in sides:
        (ax, ay), (bx, by), out = P[s]
        L = math.hypot(bx - ax, by - ay)
        n = max(1, round(L / 8.0))
        for i in range(n):
            pa = (ax + (bx - ax) * i / n, ay + (by - ay) * i / n)
            pb = (ax + (bx - ax) * (i + 1) / n, ay + (by - ay) * (i + 1) / n)
            g.polyn([(pa[0], pa[1], z0), (pb[0], pb[1], z0), (pb[0], pb[1], z1), (pa[0], pa[1], z1)], "atlas", (out[0], out[1], 0), uvs=uvs(region, QUAD))


def parapet(g, pts, z, h=0.95, t=0.3, key="stone"):
    """A solid stone parapet along a polyline of plan points."""
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        d = Vector((bx - ax, by - ay, 0)).normalized()
        n = Vector((-d.y, d.x, 0)) * (t / 2)
        a0, b0 = Vector((ax, ay, z)), Vector((bx, by, z))
        up = Vector((0, 0, h))
        g.poly([a0 - n, b0 - n, b0 - n + up, a0 - n + up], key)
        g.poly([b0 + n, a0 + n, a0 + n + up, b0 + n + up], key)
        g.poly([a0 - n + up, b0 - n + up, b0 + n + up, a0 + n + up], key)
        g.poly([a0 + n, a0 - n, a0 - n + up, a0 + n + up], key)
        g.poly([b0 - n, b0 + n, b0 + n + up, b0 - n + up], key)


def sq_column():
    """A square column one unit tall (scaled per use): shaft, a stepped base and capital."""
    g = Geo()
    g.box(-0.5, 0.5, -0.5, 0.5, 0.0, 1.0, "stone", skip=("-z", "+z"))
    g.box(-0.6, 0.6, -0.6, 0.6, 0.0, 0.04, "plinth", skip=("-z",))
    g.box(-0.58, 0.58, -0.58, 0.58, 0.95, 1.0, "stone", skip=("-z",))
    return g


def pier():
    """The porch's piers: a square shaft with a sunk panel up each face (scaled per use)."""
    g = Geo()
    g.box(-0.5, 0.5, -0.5, 0.5, 0.0, 1.0, "stone", skip=("-z",))
    for rot in range(4):
        m = Matrix.Rotation(rot * math.pi / 2, 4, "Z")
        g.add(_panel(), m)
    return g


def _panel():
    g = Geo()
    g.polyn([(-0.3, -0.505, 0.72), (0.3, -0.505, 0.72), (0.3, -0.505, 0.96), (-0.3, -0.505, 0.96)], "atlas", (0, -1, 0), uvs=uvs("beam", ((0.3, 0), (0.7, 0), (0.7, 1), (0.3, 1))))
    return g


# --- the building ----------------------------------------------------------------------------------

def build_front(g, cols):
    """Podium, the arcade, the porch, the steps."""
    xa = ARC["x"]
    # the podium in front of the arcade and under the porch, its front a stone face with a parapet
    g.box(-xa, xa, STEPS["y0"], MY0, 0.0, POD, "plinth", skip=("-z", "+z"))
    g.polyn([(-xa, STEPS["y0"], POD), (xa, STEPS["y0"], POD), (xa, MY0, POD), (-xa, MY0, POD)], "paving", (0, 0, 1))
    for s in (-1, 1):
        parapet(g, [(s * xa, STEPS["y0"] + 0.15), (s * (STEPS["x"] + 3.6), STEPS["y0"] + 0.15)], POD, h=0.85)
        # the cheek blocks either side of the flight
        x0, x1 = sorted((s * STEPS["x"], s * (STEPS["x"] + 3.4)))
        yl = STEPS["y0"] - STEPS["n"] * 0.6
        g.box(x0, x1, yl + 0.8, STEPS["y0"], 0.0, POD + 0.9, "plinth", skip=("-z",))
    # the flight
    rise = POD / STEPS["n"]
    for k in range(STEPS["n"]):
        y = STEPS["y0"] - (STEPS["n"] - k) * 0.6
        g.box(-STEPS["x"], STEPS["x"], y, y + 0.6, k * rise, (k + 1) * rise, "plinth", skip=("-z", "+y"))
    # the arcade: glazing behind, its ceiling, the painted band over the columns, the skirt roof over it
    zb = soffit_z(ARC["z"], ARC["H"], MY0 - ARC["eave"], ARC["col"] - ARC["eave"])
    for x0, x1 in ((-xa, -PORCH["xo"] - 1.2), (PORCH["xo"] + 1.2, xa)):
        fwall(g, Vector((x0, MY0)), Vector((x1, MY0)), POD, zb, "glass", (0, -1), bay=4.9, storey=zb - POD, zref=POD)
        g.polyn([(x0, ARC["col"], zb), (x1, ARC["col"], zb), (x1, MY0, zb), (x0, MY0, zb)], "stone", (0, 0, -1))
        band_ring(g, x0, x1, ARC["col"] - 0.4, ARC["col"] + 0.4, ARC["top"], zb, sides="sn")
        g.polyn([(x0, ARC["col"] - 0.4, ARC["top"]), (x1, ARC["col"] - 0.4, ARC["top"]), (x1, ARC["col"] + 0.4, ARC["top"]), (x0, ARC["col"] + 0.4, ARC["top"])], "stone", (0, 0, -1))
        straight_eave(g, x0, x1, ARC["eave"], MY0, ARC["z"], ARC["H"], ARC["col"] - ARC["eave"])
        n = max(1, round((x1 - x0) / 4.9))
        for i in range(n + 1):
            cols.append(("col", (x0 + (x1 - x0) * i / n, ARC["col"], POD), (1.1, 1.1, ARC["top"] - POD)))
    # the porch: the entrance wall with its doors, the piers, the band and the board, the ceiling, the roof
    P = PORCH
    fwall(g, Vector((-P["xo"] - 1.2, MY0 - 0.02)), Vector((P["xo"] + 1.2, MY0 - 0.02)), POD, P["band"][0], "glass", (0, -1), bay=3.0, storey=P["band"][0] - POD, zref=POD)
    for x0, x1, y0, y1 in ((-P["xo"], P["xo"], P["y"] - 0.45, P["y"] + 0.45), (-P["xo"] - 0.45, -P["xo"] + 0.45, P["y"], MY0), (P["xo"] - 0.45, P["xo"] + 0.45, P["y"], MY0)):
        band_ring(g, x0, x1, y0, y1, P["band"][0], P["band"][1])
        g.polyn([(x0, y0, P["band"][0]), (x1, y0, P["band"][0]), (x1, y1, P["band"][0]), (x0, y1, P["band"][0])], "stone", (0, 0, -1))
    ceiling(g, -P["xo"] + 0.45, P["xo"] - 0.45, P["y"] + 0.45, MY0, P["band"][1] - 0.02)
    # the name board over the middle bay
    bw, bz0, bz1, by = 6.2, 9.1, 10.3, P["y"] - 0.5
    g.box(-bw / 2 - 0.12, bw / 2 + 0.12, by - 0.1, by + 0.05, bz0 - 0.12, bz1 + 0.12, "gold", skip=("+y",))
    g.polyn([(-bw / 2, by - 0.11, bz0), (bw / 2, by - 0.11, bz0), (bw / 2, by - 0.11, bz1), (-bw / 2, by - 0.11, bz1)], "board", (0, -1, 0))
    for x, w in ((-P["xo"], 2.2), (-P["xi"], 1.5), (P["xi"], 1.5), (P["xo"], 2.2)):
        cols.append(("pier", (x, P["y"], POD), (w, w, P["band"][0] - POD)))
    pg = Geo()
    roofs(PORCH_ROOF, pg)
    g.add(pg, T(0, PY, 0))
    # the porch's floor runs out over the podium to the flight
    g.polyn([(-STEPS["x"], STEPS["y0"], POD + 0.01), (STEPS["x"], STEPS["y0"], POD + 0.01), (STEPS["x"], P["y"] + 0.6, POD + 0.01), (-STEPS["x"], P["y"] + 0.6, POD + 0.01)], "paving", (0, 0, 1))


def build_pavilion(g, cols, s):
    """A corner pavilion: s = 1 east, -1 west."""
    Pv = PAV
    x0, x1 = sorted((s * Pv["x0"], s * Pv["x1"]))
    cx = s * Pv["cx"]
    # podium
    px0, px1 = x0 - 0.8 * (s < 0), x1 + 0.8 * (s > 0)
    g.box(px0, px1, Pv["y0"] - 0.8, Pv["y1"], 0.0, POD, "plinth", skip=("-z", "+z"))
    g.polyn([(px0, Pv["y0"] - 0.8, POD), (px1, Pv["y0"] - 0.8, POD), (px1, Pv["y1"], POD), (px0, Pv["y1"], POD)], "paving", (0, 0, 1))
    # the core: glazing in stone bays; beyond the main block it shows on the north too
    cx0, cx1 = sorted((s * Pv["core"][0], s * Pv["core"][1]))
    cy0, cy1 = Pv["core"][2], Pv["core"][3]
    walls(g, cx0, cx1, cy0, cy1, POD, 8.6, "glass", bay=4.3, storey=8.6 - POD)
    # the columns' ring: the band over them and the ceiling from them to the core
    ox0, ox1 = cx - Pv["OX"], cx + Pv["OX"]
    oy0, oy1 = Pv["cy"] - Pv["OY"], Pv["cy"] + Pv["OY"]
    zb = PAV_ROOF.UBEAM[3] + 0.08
    band_ring(g, ox0 - 0.4, ox1 + 0.4, oy0 - 0.4, oy1 + 0.4, Pv["top"], zb)
    for a0, a1, b0, b1 in ((ox0, ox1, oy0, cy0), (ox0, cx0, cy0, oy1), (cx1, ox1, cy0, oy1)):
        g.polyn([(a0, b0, zb), (a1, b0, zb), (a1, b1, zb), (a0, b1, zb)], "stone", (0, 0, -1))
    g.polyn([(ox0 - 0.4, oy0 - 0.4, Pv["top"]), (ox1 + 0.4, oy0 - 0.4, Pv["top"]), (ox1 + 0.4, oy1 + 0.4, Pv["top"]), (ox0 - 0.4, oy1 + 0.4, Pv["top"])], "stone", (0, 0, -1))
    nx, ny = 7, 4
    for i in range(nx + 1):
        for j in range(ny + 1):
            if 0 < i < nx and 0 < j < ny:
                continue
            x, y = ox0 + (ox1 - ox0) * i / nx, oy0 + (oy1 - oy0) * j / ny
            if y > MY0 - 1.0 and abs(x) < MX + 0.5:
                continue                      # inside the main block
            cols.append(("col", (x, y, POD), (0.9, 0.9, Pv["top"] - POD)))
    rg = Geo()
    roofs(PAV_ROOF, rg)
    g.add(rg, T(cx, Pv["cy"], 0))


def build_main(g, cols):
    """The main block, the third storey's colonnade and eave."""
    # the main block's walls: the front's second storey over the arcade; three storeys of windows round the sides and back
    fwall(g, Vector((-MX, MY0)), Vector((MX, MY0)), Z2, Z2TOP, "facade", (0, -1), bay=3.6, storey=Z2TOP - Z2, zref=Z2)
    for x0, x1 in ((-MX, -ARC["x"]), (ARC["x"], MX)):
        fwall(g, Vector((x0, MY0)), Vector((x1, MY0)), 0.0, Z2, "facade", (0, -1), bay=4.3, storey=Z2, zref=0.0)
    walls(g, -MX, MX, MY0, MY1, 0.0, Z2TOP, "facade", bay=3.6, storey=5.53, zref=0.0, sides="enw")
    # the cornice ledge and the terrace round the third storey, its parapet
    g.box(-MX - 0.5, MX + 0.5, MY0 - 0.5, MY1 + 0.5, Z2TOP, ZR2, "stone", skip=("+z",))
    g.polyn([(-MX - 0.5, MY0 - 0.5, ZR2), (MX + 0.5, MY0 - 0.5, ZR2), (MX + 0.5, MY1 + 0.5, ZR2), (-MX - 0.5, MY1 + 0.5, ZR2)], "roof", (0, 0, 1))
    e = 0.3
    parapet(g, [(-ST1["X"], MY0 - 0.35), (-MX - e, MY0 - 0.35), (-MX - e, MY1 + e), (MX + e, MY1 + e), (MX + e, MY0 - 0.35), (ST1["X"], MY0 - 0.35)], ZR2, h=0.9)
    # the third storey: the recessed wall, the colonnade's band and ceiling, the eave, the flat roof
    c = C3
    walls(g, -c["wall_x"], c["wall_x"], c["wall_y0"], c["wall_y1"], ZR2, ZR3, "facade", bay=3.0, storey=c["top"] - ZR2 + 0.8, zref=ZR2)
    cy = (c["y0"] + c["y1"]) / 2
    A, D = c["x"] + c["over"], (c["y1"] - c["y0"]) / 2 + c["over"]
    zb = soffit_z(c["z"], c["H"], c["DL"], c["over"])
    band_ring(g, -c["x"] - 0.35, c["x"] + 0.35, c["y0"] - 0.35, c["y1"] + 0.35, c["top"], zb)
    x0, x1, y0, y1 = -c["x"] - 0.35, c["x"] + 0.35, c["y0"] - 0.35, c["y1"] + 0.35
    g.polyn([(x0, y0, c["top"]), (x1, y0, c["top"]), (x1, y1, c["top"]), (x0, y1, c["top"])], "stone", (0, 0, -1))
    sub = Geo()
    skirt(sub, A, D, c["DL"], c["z"], c["H"], rows=3, pitch=LONG_PITCH, amp=LONG_AMP, zb=zb, span=c["over"])
    iy = D - c["DL"]
    ix = A - c["DL"]
    sub.polyn([(-ix, -iy, ZR3), (ix, -iy, ZR3), (ix, iy, ZR3), (-ix, iy, ZR3)], "roof", (0, 0, 1))
    g.add(sub, T(0, cy, 0))
    # the colonnade: slim square columns every ~3 m on all four sides
    nx, ny = 32, 15
    for i in range(nx + 1):
        for j in range(ny + 1):
            if 0 < i < nx and 0 < j < ny:
                continue
            x, y = -c["x"] + 2 * c["x"] * i / nx, c["y0"] + (c["y1"] - c["y0"]) * j / ny
            if abs(x) < ST1["X"] + 0.4 and y < TY + ST1["Y"]:
                continue                      # the tower's face
            cols.append(("col", (x, y, ZR2), (0.7, 0.7, c["top"] - ZR2)))


def build_tower(g):
    """The tower over the porch: glazed stage, two eaves pressed together, the top storey, the double 庑殿."""
    t = Geo()
    X1, Y1 = ST1["X"], ST1["Y"]
    # stage 1: glazing in five bays from the terrace up under E2
    DL2 = E2["over"] + (X1 - ST2["X"])
    z1 = soffit_z(E2["z"], E2["H"], DL2, E2["over"])
    walls(t, -X1, X1, -Y1, Y1, ZR2, C3["z"], "glass", bay=4.0, storey=C3["z"] - ZR2)
    walls(t, -X1, X1, -Y1, Y1, C3["z"], z1, "glass", bay=2.0, storey=z1 - C3["z"])
    skirt(t, X1 + E2["over"], Y1 + E2["over"], DL2, E2["z"], E2["H"], rows=4, zb=z1, span=E2["over"])
    # stage 2: a painted band under E3
    X2, Y2 = ST2["X"], ST2["Y"]
    DL3 = E3["over"] + (X2 - TOP["X"])
    z2 = soffit_z(E3["z"], E3["H"], DL3, E3["over"])
    for rot, (a, b, out) in enumerate((((-X2, -Y2), (X2, -Y2), (0, -1)), ((X2, -Y2), (X2, Y2), (1, 0)), ((X2, Y2), (-X2, Y2), (0, 1)), ((-X2, Y2), (-X2, -Y2), (-1, 0)))):
        t.polyn([(a[0], a[1], E2["z"] + E2["H"] - 0.2), (b[0], b[1], E2["z"] + E2["H"] - 0.2), (b[0], b[1], z2), (a[0], a[1], z2)], "atlas", (out[0], out[1], 0), uvs=uvs("plank", QUAD))
    skirt(t, X2 + E3["over"], Y2 + E3["over"], DL3, E3["z"], E3["H"], rows=4, zb=z2, span=E3["over"])
    # the top storey: windows all round, then the double-eaved roof and the finial
    X3, Y3 = TOP["X"], TOP["Y"]
    walls(t, -X3, X3, -Y3, Y3, E3["z"] + E3["H"] - 0.2, TOPROOF.BEAM[3], "glass", bay=2.4, storey=TOPROOF.BEAM[3] - E3["z"] - E3["H"] + 0.2)
    ui, uy = TOPROOF.IX, TOPROOF.IY
    for a, b, out in (((-ui, -uy), (ui, -uy), (0, -1)), ((ui, -uy), (ui, uy), (1, 0)), ((ui, uy), (-ui, uy), (0, 1)), ((-ui, uy), (-ui, -uy), (-1, 0))):
        t.polyn([(a[0], a[1], TOPROOF.LOWER["z"] + TOPROOF.LOWER["H"] - 0.2), (b[0], b[1], TOPROOF.LOWER["z"] + TOPROOF.LOWER["H"] - 0.2),
                 (b[0], b[1], TOPROOF.UBEAM[3]), (a[0], a[1], TOPROOF.UBEAM[3])], "atlas", (out[0], out[1], 0), uvs=uvs("plank", QUAD))
    roofs(TOPROOF, t)
    finial(t, TOPROOF.UPPER["z"] + TOPROOF.UPPER["H"] + 0.6)
    g.add(t, T(0, TY, 0))


def build_back(g):
    """The lower blocks at the back corners and the round hall on the axis."""
    for s in (-1, 1):
        x0, x1 = sorted((s * BACK["x0"], s * BACK["x1"]))
        B = BACK
        walls(g, x0, x1, B["y0"], B["y1"], 0.0, B["h"] - 1.5, "facade", bay=3.6, storey=(B["h"] - 1.5) / 2, sides="enw")
        a, b = (MX, x1) if s > 0 else (x0, -MX)
        fwall(g, Vector((a, B["y0"])), Vector((b, B["y0"])), 0.0, B["h"] - 1.5, "facade", (0, -1), bay=3.6, storey=(B["h"] - 1.5) / 2, zref=0.0)
        cornice_box(g, x0, x1, B["y0"], B["y1"], B["h"])
    # the round hall: facets of wall, a tiled cornice round it, a flat roof
    n = 16
    r, h, yc = APSE["r"], APSE["h"], APSE["y"]
    pts = [(r * math.cos(math.pi * i / n), yc + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        mx, my = (ax + bx) / 2, (ay + by) / 2 - yc
        fwall(g, Vector((bx, by)), Vector((ax, ay)), 0.0, h - 1.5, "facade", (mx, my), bay=3.4, storey=(h - 1.5) / 2, zref=0.0)
        o = Vector((mx, my, 0)).normalized()
        a0, b0 = Vector((ax, ay, h - 1.5)), Vector((bx, by, h - 1.5))
        oa = Vector((ax, ay - yc, 0)).normalized() * 1.4
        ob = Vector((bx, by - yc, 0)).normalized() * 1.4
        g.polyn([a0 + oa + Vector((0, 0, -0.25)), b0 + ob + Vector((0, 0, -0.25)), b0 + Vector((0, 0, 1.5)), a0 + Vector((0, 0, 1.5))], "tile", (o.x, o.y, 1))
        g.polyn([a0, b0, b0 + ob + Vector((0, 0, -0.25)), a0 + oa + Vector((0, 0, -0.25))], "stone", (0, 0, -1))
    g.polyn([(x, y, h) for x, y in pts], "roof", (0, 0, 1))


def cornice_box(g, x0, x1, y0, y1, h):
    """A flat roof edged by a tiled cornice sloping out and down (the back blocks)."""
    c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    o = [(x0 - 1.4, y0 - 1.4), (x1 + 1.4, y0 - 1.4), (x1 + 1.4, y1 + 1.4), (x0 - 1.4, y1 + 1.4)]
    zc = h - 1.5
    for i in range(4):
        j = (i + 1) % 4
        mid = ((c[i][0] + c[j][0]) / 2 - (x0 + x1) / 2, (c[i][1] + c[j][1]) / 2 - (y0 + y1) / 2)
        g.polyn([(o[i][0], o[i][1], zc - 0.25), (o[j][0], o[j][1], zc - 0.25), (c[j][0], c[j][1], h), (c[i][0], c[i][1], h)], "tile", (mid[0], mid[1], 5))
        g.polyn([(o[i][0], o[i][1], zc - 0.25), (o[j][0], o[j][1], zc - 0.25), (c[j][0], c[j][1], zc), (c[i][0], c[i][1], zc)], "stone", (0, 0, -1))
    g.polyn([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], "roof", (0, 0, 1))


def build_far():
    """The far level: the masses, the roofs without tile rows."""
    f = Geo()
    f.box(-ARC["x"], ARC["x"], STEPS["y0"], MY0, 0.0, POD, "plinth", skip=("-z",))
    f.box(-MX, MX, MY0, MY1, 0.0, ZR2, "facade", skip=("-z",))
    f.box(-C3["wall_x"], C3["wall_x"], C3["wall_y0"], C3["wall_y1"], ZR2, ZR3, "facade", skip=("-z",))
    sub = Geo()
    A, D = C3["x"] + C3["over"], (C3["y1"] - C3["y0"]) / 2 + C3["over"]
    skirt(sub, A, D, C3["DL"], C3["z"], C3["H"], lod=True)
    f.add(sub, T(0, (C3["y0"] + C3["y1"]) / 2, 0))
    t = Geo()
    t.box(-ST1["X"], ST1["X"], -ST1["Y"], ST1["Y"], ZR2, E2["z"], "glass", skip=("-z",))
    skirt(t, ST1["X"] + E2["over"], ST1["Y"] + E2["over"], E2["over"] + ST1["X"] - ST2["X"], E2["z"], E2["H"], lod=True)
    t.box(-ST2["X"], ST2["X"], -ST2["Y"], ST2["Y"], E2["z"], E3["z"], "stone", skip=("-z",))
    skirt(t, ST2["X"] + E3["over"], ST2["Y"] + E3["over"], E3["over"] + ST2["X"] - TOP["X"], E3["z"], E3["H"], lod=True)
    t.box(-TOP["X"], TOP["X"], -TOP["Y"], TOP["Y"], E3["z"], TOPROOF.LOWER["z"], "glass", skip=("-z",))
    t.box(-TOPROOF.IX, TOPROOF.IX, -TOPROOF.IY, TOPROOF.IY, TOPROOF.LOWER["z"], TOPROOF.UPPER["z"], "stone", skip=("-z",))
    roofs(TOPROOF, t, lod=True)
    f.add(t, T(0, TY, 0))
    pg = Geo()
    pg.box(-PORCH["xo"], PORCH["xo"], -4.25, 4.25, POD, PORCH["band"][1], "stone", skip=("-z",))
    roofs(PORCH_ROOF, pg, lod=True)
    f.add(pg, T(0, PY, 0))
    for s in (-1, 1):
        x0, x1 = sorted((s * PAV["x0"], s * PAV["x1"]))
        f.box(x0 + 1, x1 - 1, PAV["y0"] + 1, PAV["y1"], 0.0, PAV["top"] + 1.0, "glass", skip=("-z",))
        rg = Geo()
        roofs(PAV_ROOF, rg, lod=True)
        f.add(rg, T(s * PAV["cx"], PAV["cy"], 0))
        bx0, bx1 = sorted((s * BACK["x0"], s * BACK["x1"]))
        f.box(bx0, bx1, BACK["y0"], BACK["y1"], 0.0, BACK["h"], "facade", skip=("-z",))
        straight = Geo()
        straight_eave(straight, -ARC["x"] if s < 0 else PORCH["xo"] + 1.2, -PORCH["xo"] - 1.2 if s < 0 else ARC["x"], ARC["eave"], MY0, ARC["z"], ARC["H"], 1.8, lod=True)
        f.add(straight, Matrix.Identity(4))
    n = 8
    pts = [(APSE["r"] * math.cos(math.pi * i / n), APSE["y"] + APSE["r"] * math.sin(math.pi * i / n)) for i in range(n + 1)]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        f.polyn([(bx, by, 0), (ax, ay, 0), (ax, ay, APSE["h"]), (bx, by, APSE["h"])], "facade", ((ax + bx) / 2, (ay + by) / 2 - APSE["y"], 0))
    f.polyn([(x, y, APSE["h"]) for x, y in pts], "roof", (0, 0, 1))
    return f


def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    fac, fac_night = facade_images()
    gl, gl_night = glass_images()
    atlas, atlas_night = paint_atlas("AM", portrait=False, emblem=False)
    M = dict(
        facade=material("AM_Facade", "#e1d5bb", 0.75, tex=fac, emit_tex=fac_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.55}),
        glass=material("AM_Glass", "#233039", 0.25, metal=0.2, tex=gl, emit_tex=gl_night, props={"wet": "surface", "emit": "night", "glowStrength": 0.5}),
        stone=material("AM_Stone", "#e4d9c2", 0.7, props={"wet": "damp", "glowStrength": 0.55}),
        plinth=material("AM_Plinth", "#b7ad99", 0.8, props={"wet": "ground", "glowStrength": 0.6}),
        paving=material("AM_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6}),
        tile=material("AM_Tile", "#d58a2c", 0.32, props={"wet": "surface", "glowStrength": 0.55}),
        roof=material("AM_Roof", "#8c8a84", 0.9, props={"wet": "ground", "glow": "none"}),
        atlas=material("AM_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=atlas_night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        gold=material("AM_Gold", "#d9aa45", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.75, 0.35], "glowStrength": 0.35}),
        board=material("AM_Board", "#efe8d8", 0.5, props={"wet": "surface", "glowStrength": 0.5}),
        red=material("AM_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
    )
    TILE = dict(stone=2.0, plinth=2.0, paving=4.0, tile=2.0, roof=8.0, gold=1.0, board=1.0, red=2.0)
    main = collection("中国美术馆")
    g, cols = Geo(), []
    build_front(g, cols)
    for s in (-1, 1):
        build_pavilion(g, cols, s)
    build_main(g, cols)
    build_tower(g)
    build_back(g)
    g.build("ArtMuseum", collection("主体", main), M, TILE)
    tris = g.tris()

    # the columns and piers as linked duplicates, the lettering
    parts = collection("柱", main)
    meshes = dict(col=mesh_of(sq_column(), "SquareColumn", M, TILE), pier=mesh_of(pier(), "Pier", M, TILE))
    for i, (kind, (x, y, z), (sx, sy, sz)) in enumerate(cols):
        place(meshes[kind], f"{kind.capitalize()}umn.{i:03d}" if kind == "col" else f"Pier.{i:03d}", parts, T(x, y, z) @ Matrix.Diagonal((sx, sy, sz, 1)))
    font = bpy.data.fonts.load(FONT)
    lettering(font, "中国美术馆", 0.8, 4.9, "Name", M, collection("题字", main), facing(0.0, PORCH["y"] - 0.62, 9.7, (0, -1)))

    far = build_far()
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: podium, pavilions, the blocks, the columns; the flight a ramp for people
    helpers = collection("碰撞体")
    collider_box(helpers, "podium", -ARC["x"], ARC["x"], STEPS["y0"], MY0, 0.0, POD)
    collider_box(helpers, "main", -MX, MX, MY0, MY1, 0.0, ZR2)
    collider_box(helpers, "third", -C3["wall_x"], C3["wall_x"], C3["wall_y0"], C3["wall_y1"], ZR2, ZR3)
    collider_box(helpers, "tower", -ST1["X"], ST1["X"], TY - ST1["Y"], TY + ST1["Y"], ZR2, E2["z"] + E2["H"])
    collider_box(helpers, "towertop", -TOP["X"], TOP["X"], TY - TOP["Y"], TY + TOP["Y"], E2["z"] + E2["H"], TOPROOF.UPPER["z"] + 1.5)
    for s in (-1, 1):
        x0, x1 = sorted((s * PAV["x0"], s * PAV["x1"]))
        collider_box(helpers, f"pavfloor{s:+d}", x0 - 0.8 * (s < 0), x1 + 0.8 * (s > 0), PAV["y0"] - 0.8, PAV["y1"], 0.0, POD)
        cx0, cx1 = sorted((s * PAV["core"][0], s * PAV["core"][1]))
        collider_box(helpers, f"pavcore{s:+d}", cx0, cx1, PAV["core"][2], PAV["core"][3], POD, 9.5)
        bx0, bx1 = sorted((s * BACK["x0"], s * BACK["x1"]))
        collider_box(helpers, f"back{s:+d}", bx0, bx1, BACK["y0"], BACK["y1"], 0.0, BACK["h"])
        x0, x1 = sorted((s * STEPS["x"], s * (STEPS["x"] + 3.4)))
        collider_box(helpers, f"cheek{s:+d}", x0, x1, STEPS["y0"] - STEPS["n"] * 0.6 + 0.8, STEPS["y0"], 0.0, POD + 0.9)
    n = 8
    apse = [(APSE["r"] * math.cos(math.pi * i / n), APSE["y"] + APSE["r"] * math.sin(math.pi * i / n), z) for i in range(n + 1) for z in (0.0, APSE["h"])]
    collider_pts(helpers, "apse", apse)
    for o in list(parts.objects):
        c = o.matrix_world.translation
        sc = o.matrix_world.to_scale()
        if c.z > POD + 0.5:
            continue                          # the third storey's colonnade: nobody walks there
        collider_box(helpers, "c" + o.name.replace(".", ""), c.x - sc.x / 2, c.x + sc.x / 2, c.y - sc.y / 2, c.y + sc.y / 2, c.z, c.z + sc.z)
    steps_ramp(helpers, "steps", -STEPS["x"], STEPS["x"], STEPS["y0"], STEPS["y0"] - STEPS["n"] * 0.6, POD)
    # the footprint in pieces round OSM's outline (the court between the pavilions is the square's)
    flat_marker(helpers, "front", rect(-71.0, 71.0, -55.0, -34.0), "FOOTPRINT")
    flat_marker(helpers, "main", rect(-63.5, 58.5, -35.0, 18.0), "FOOTPRINT")
    flat_marker(helpers, "northwest", rect(-71.0, -37.5, 14.0, 31.5), "FOOTPRINT")
    flat_marker(helpers, "northeast", rect(35.5, 70.0, 11.0, 32.5), "FOOTPRINT")
    flat_marker(helpers, "apse", [(19.0 * math.cos(math.pi * i / 12), APSE["y"] + 19.0 * math.sin(math.pi * i / 12)) for i in range(13)], "FOOTPRINT")
    flat_marker(helpers, "grounds", rect(-73.0, 73.0, -58.0, 35.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "artmuseum", "中国美术馆", "National Art Museum of China"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 443.6, -1681.43, -0.46
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, columns=len(cols))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
