# 全国农业展览馆 National Agricultural Exhibition Center (1959, one of the capital's Ten Great Buildings), on the
# east side of 东三环北路 at 农展桥, built in Blender with hall.py's atlas and brackets, round.py's roofs bent to an
# octagon, and station.py's glazed eaves, marked with the bcity_landmark add-on's conventions.
#
#   blender -b -P scripts/blender/landmarks/nongzhanguan.py -- [--out art/landmarks/nongzhanguan.blend] [--export]
#
# The lettering needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header).
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of OSM way 164587493 (1号馆, the
# main hall, 68 x 85 m), game (5225.65, -3466.35), heading -1.0 (the complex's edges run 0-1.2 deg off the grid).
# The front faces west, onto the forecourt and 东三环.
#
# Published: the main hall (综合馆) is five exhibition halls round an octagonal central hall, crowned by a pavilion
# of three eaves, green-glazed, octagonal, pyramidal (三重檐绿琉璃瓦八角攒尖); the main building 33 m high. Here:
# the five halls as two-storey ranges (cream stucco, windows in bays, a green-glazed eave round the outside, two
# courtyards inside) and a raised entrance block on the axis with a loggia of six square piers and the name on
# a red board; the octagonal hall as a drum rising from the ranges' roofs with tall windows and a cornice, then the
# three eaves - the first round the drum's top, the second and third over two storeys of red columns and lattice
# windows with painted beams and bracket sets - to the apex at 32 m and a gilt finial (34 m). The roofs are
# round.py's cones bent onto an octagon (corners swept up and out, hip ridges along them). Either side, OSM's
# halls 2 and 3 (L-shaped, 140 m long) as the same two-storey ranges with green eaves and an entrance porch; halls
# 4 and 5 behind them are left to the city. In front, the forecourt (OSM's car park): paving on the axis and round two
# lawns (the city's grass), a fountain on the axis.
# Doubtful: the ranges' storey heights and window rhythm, the entrance block and loggia (a guess at the 1959
# composition), the pavilion storeys' proportions, the green eave edges (all green here), halls 2 and 3's look,
# the forecourt's layout (OSM calls it a car park).

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import SIDES, Canvas, Geo, T, Rz, collider_box, collider_pts, cyl, flat_marker, fwall, lathe, mesh_of, paving, place, rect, side_line  # noqa: E402
from hall import bracket_geo, column_geo, paint_atlas, sweep  # noqa: E402
from round import finial, roof_r, round_eave, round_roof, round_storey  # noqa: E402
from station import skirt  # noqa: E402
from national_museum import facing, lettering  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "nongzhanguan.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

PL = 1.0                 # the granite base course
HR = 12.0                # the ranges' cornice
BAY = 4.5
A0 = math.pi / 8         # the octagons' vertices at A0 + k pi/4: flat faces to the four quarters
MX0, MX1, MY = -34.0, 34.0, 42.4      # the main hall's outline
RANGES = [               # (x0, x1, y0, y1) of the five halls round the octagon
    (-34.0, -18.0, -42.4, 42.4), (18.0, 34.0, -42.4, 42.4), (-18.0, 18.0, 27.0, 42.4), (-18.0, 18.0, -42.4, -27.0), (-18.0, 18.0, -14.0, 14.0)]
ENT = dict(x0=-38.0, x1=-18.0, hy=16.0, h=16.0, loggia=-34.0, lz=12.0, floor=1.2)
STEPS = dict(n=8, run=0.45, x=-38.6, hy=14.0)
DRUM = dict(r=15.0, top=18.5)
# the three eaves (round.py's roof spec) and the two storeys of the pavilion between them
EAVE1 = dict(r0=17.4, r1=10.0, z=19.0, H=2.2, p=1.3, lift=0.25, Vl=1.6)
ST2 = dict(r=10.2, z0=20.4, z1=23.4, beam=(23.4, 23.9, 24.2))
EAVE2 = dict(r0=12.8, r1=6.8, z=24.6, H=1.9, p=1.35, lift=0.25, Vl=1.4)
ST3 = dict(r=7.0, z0=25.4, z1=27.4, beam=(27.4, 27.85, 28.1))
EAVE3 = dict(r0=9.4, r1=0.0, z=28.3, H=3.7, p=1.7, lift=0.25, Vl=1.4)
CORNER = dict(lift=0.55, out=0.45, Vc=1.6)
# halls 2 and 3: (x0, x1, y0, y1, h) for the long arm and the hook, OSM's outlines squared in this frame
HALLS = {
    "hall3": [(-50.1, -22.4, -210.8, -65.7, HR), (-22.4, -4.25, -210.8, -185.0, 10.8)],
    "hall2": [(-47.0, -18.0, 72.0, 212.2, HR), (-18.0, 2.5, 183.1, 212.2, 10.8)],
}
COURT = dict(x0=-172.0, x1=-42.5, y0=-52.0, y1=65.0, fx=-118.0, fr=9.0)

CREAM = "#e5d8b6"
GREEN = "#2f7a55"


# --- textures ------------------------------------------------------------------------------------------

def wall_images(w=192, h=384):
    """One 4.5 m bay of a range from the base course to the cornice (1 to 12 m): two storeys of windows in white
    frames, a string course, a frieze under the cornice."""
    cv, glow = Canvas(w, h, CREAM), Canvas(w, h, "#000000")
    cv.noise(0.05, 3)
    z = PL + (h - cv.y) / h * (HR - PL)
    x = cv.x / w * BAY
    c = BAY / 2
    w1 = (np.abs(x - c) < 1.05) & (z > 2.0) & (z < 5.4)
    w2 = (np.abs(x - c) < 1.05) & (z > 7.0) & (z < 10.0)
    f1 = (np.abs(x - c) < 1.25) & (z > 1.8) & (z < 5.6) & ~w1
    f2 = (np.abs(x - c) < 1.25) & (z > 6.8) & (z < 10.2) & ~w2
    cv.put(f1 | f2, "#f1ebdb")
    cv.put((z > 6.0) & (z < 6.3), "#f1ebdb")
    cv.put((z > 10.9) & (z < 11.7), "#c9b48a")
    cv.put((z > 11.05) & (z < 11.55) & (np.mod(x, 0.75) < 0.38), "#2f6f52")      # a green glazed frieze of tiles
    win = w1 | w2
    glass = srgb("#2c3540") + (0.12 * ((z - 2) / 10))[..., None] * srgb("#7d90a3")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(x - c) < 0.03) | (np.abs(z - 4.2) < 0.03) | (np.abs(z - 8.9) < 0.03))
    cv.put(bars, "#e8e1d0")
    rng = np.random.default_rng(5)
    lit = win & ~bars
    glow.a[lit] = srgb("#ffc77f") * (0.25 + 0.3 * rng.random((h, w), np.float32)[lit][:, None])
    return image("NZ_Wall", np.flipud(cv.a).copy()), image("NZ_WallNight", np.flipud(glow.a).copy())


def drum_images(w=192, h=512):
    """Half a face of the octagonal hall's drum (5.74 m) from the base course to its cornice (1 to 18.5 m): a tall
    window with a round head in a white frame, a panel of green tiles over it."""
    cv, glow = Canvas(w, h, CREAM), Canvas(w, h, "#000000")
    cv.noise(0.05, 4)
    span = DRUM["top"] - PL
    z = PL + (h - cv.y) / h * span
    W = 2 * DRUM["r"] * math.sin(math.pi / 8) / 2
    x = cv.x / w * W
    c = W / 2
    win = (np.abs(x - c) < 1.4) & (z > 3.0) & (z < 14.0)
    win |= ((x - c) ** 2 + (z - 14.0) ** 2 < 1.4 ** 2)
    fr = ((np.abs(x - c) < 1.7) & (z > 2.7) & (z < 14.0)) | ((x - c) ** 2 + (z - 14.0) ** 2 < 1.7 ** 2)
    cv.put(fr & ~win, "#f1ebdb")
    glass = srgb("#2a333d") + (0.15 * ((z - 3) / 13))[..., None] * srgb("#7d90a3")
    cv.a[win] = glass[win]
    bars = win & ((np.abs(x - c) < 0.03) | (np.mod(z, 1.6) < 0.05))
    cv.put(bars, "#e8e1d0")
    cv.put((z > 16.4) & (z < 17.6) & (np.abs(x - c) < 2.0), GREEN)
    cv.put((z > 16.2) & (z < 17.8) & (np.abs(x - c) < 2.15) & ~((z > 16.4) & (z < 17.6) & (np.abs(x - c) < 2.0)), "#c9a44c")
    lit = win & ~bars
    glow.a[lit] = srgb("#ffcc88") * 0.5
    return image("NZ_Drum", np.flipud(cv.a).copy()), image("NZ_DrumNight", np.flipud(glow.a).copy())


# --- the octagon -----------------------------------------------------------------------------------------

def octify(g, start, R=None):
    """Bend everything built since vertex `start` (round, about the origin) onto the octagon with vertices at
    A0 + k pi/4 on the same circle; near the eave of roof R the corners sweep up and out."""
    c8 = math.cos(math.pi / 8)
    for i in range(start, len(g.v)):
        x, y, z = g.v[i]
        r = math.hypot(x, y)
        if r < 1e-6:
            continue
        a = math.atan2(y, x)
        d = (a - A0) % (math.pi / 4)
        dv = min(d, math.pi / 4 - d)                  # angle to the nearest vertex
        rn = r * c8 / math.cos(math.pi / 8 - dv)
        if R is not None:
            v = R["r0"] - r
            k = max(0.0, 1 - v / CORNER["Vc"]) ** 2 * (1 - dv / (math.pi / 8)) ** 6
            rn += CORNER["out"] * k
            z += CORNER["lift"] * k
        g.v[i] = (rn * math.cos(a), rn * math.sin(a), z)


def oct_pts(r, z=0.0):
    return [(r * math.cos(A0 + k * math.pi / 4), r * math.sin(A0 + k * math.pi / 4), z) for k in range(8)]


def hips(g, R):
    """The eight hip ridges of a bent roof, from the swept-up corner to its top."""
    top = R["r0"] - R["r1"]
    for k in range(8):
        a = A0 + k * math.pi / 4
        line = []
        for j in range(9):
            v = top * (j / 8) ** 1.1 * (0.99 if R["r1"] <= 0 else 1.0)
            r, z = roof_r(R, v)
            kk = max(0.0, 1 - v / CORNER["Vc"]) ** 2
            r += CORNER["out"] * kk
            z += CORNER["lift"] * kk + 0.05
            line.append(Vector((r * math.cos(a), r * math.sin(a), z)))
        sweep(g, line, 0.42, 0.32, key="ridge")


def oct_band(g, r_out, z0, z1, key, r_in=None):
    """An octagonal ring band: the outer faces, the soffit, the top (to r_in or a closed top)."""
    lo, hi = oct_pts(r_out, z0), oct_pts(r_out, z1)
    for k in range(8):
        j = (k + 1) % 8
        m = A0 + (k + 0.5) * math.pi / 4
        g.polyn([lo[k], lo[j], hi[j], hi[k]], key, (math.cos(m), math.sin(m), 0))
    g.polyn(lo, key, (0, 0, -1))
    if r_in is None:
        g.polyn(hi, key, (0, 0, 1))
    else:
        inn = oct_pts(r_in, z1)
        for k in range(8):
            j = (k + 1) % 8
            g.polyn([hi[k], hi[j], inn[j], inn[k]], key, (0, 0, 1))


def drum(g):
    """The octagonal hall's drum: two window bays a face, the base course, the cornice."""
    pts = oct_pts(DRUM["r"])
    for k in range(8):
        j = (k + 1) % 8
        m = A0 + (k + 0.5) * math.pi / 4
        a, b = pts[k], pts[j]
        g.polyn([(a[0], a[1], PL), (b[0], b[1], PL), (b[0], b[1], DRUM["top"]), (a[0], a[1], DRUM["top"])], "drum", (math.cos(m), math.sin(m), 0),
                uvs=[(0, 0), (2, 0), (2, 1), (0, 1)])
    oct_band(g, DRUM["r"] + 0.45, DRUM["top"] - 0.7, DRUM["top"], "stone", r_in=DRUM["r"] - 0.5)
    g.polyn(oct_pts(DRUM["r"] - 0.5, DRUM["top"] - 0.05), "roof", (0, 0, 1))


def bracket_ring(parts, mesh, r, z, tag, gap=1.25, scale=0.62):
    pts = oct_pts(r)
    n = 0
    for k in range(8):
        a, b = pts[k], pts[(k + 1) % 8]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        m = round(L / gap)
        phi = A0 + (k + 0.5) * math.pi / 4
        for j in range(m):
            t = j / m
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            yaw = phi + math.pi / 2 if j else A0 + k * math.pi / 4 + math.pi / 2
            place(mesh, f"{tag}.{n:03d}", parts, T(p[0], p[1], z) @ Rz(yaw) @ Matrix.Diagonal((scale, scale, scale, 1)))
            n += 1
    return n


def pavilion(g, parts, M, TILE):
    """The three eaves and the two storeys between them, the finial; columns and brackets as linked parts."""
    mesh = {
        "b": mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE),
        "c2": mesh_of(column_geo(ST2["z1"] - ST2["z0"] + 0.6, r=0.36), "Col2Mesh", M, TILE),
        "c3": mesh_of(column_geo(ST3["z1"] - ST3["z0"] + 0.5, r=0.3), "Col3Mesh", M, TILE),
    }
    for R, rw, zb in ((EAVE1, DRUM["r"], DRUM["top"]), (EAVE2, ST2["r"], ST2["beam"][2] + 0.5), (EAVE3, ST3["r"], ST3["beam"][2] + 0.5)):
        s = len(g.v)
        round_roof(g, R, rows=6 if R["r1"] > 0 else 9, key="tile", pitch=0.5, amp=0.09, spp=4)
        round_eave(g, R, rw, zb, key="tile", drop=0.28, segs=64)
        octify(g, s, R)
        hips(g, R)
    # the storeys: lattice windows between the columns, the painted beams; a door on the west face of each
    round_storey(g, ST2["r"], 8, ST2["z0"], ST2["z1"], ST2["beam"], "window", doors={3}, off=A0)
    round_storey(g, ST3["r"], 8, ST3["z0"], ST3["z1"], ST3["beam"], "window", off=A0)
    # ceilings closing each storey under the next roof
    g.polyn(oct_pts(ST2["r"] - 0.3, ST2["beam"][2] + 0.4), "roof", (0, 0, -1))
    g.polyn(oct_pts(ST3["r"] - 0.3, ST3["beam"][2] + 0.4), "roof", (0, 0, -1))
    finial(g, roof_r(EAVE3, (EAVE3["r0"] - EAVE3["r1"]) * 0.99)[1] - 0.1, 1.9, r=0.55, key="gold")
    n = 0
    for k, (x, y, _) in enumerate(oct_pts(ST2["r"])):
        place(mesh["c2"], f"Col2.{k}", parts, T(x, y, ST2["z0"] - 0.6))
        n += 1
    for k, (x, y, _) in enumerate(oct_pts(ST3["r"])):
        place(mesh["c3"], f"Col3.{k}", parts, T(x, y, ST3["z0"] - 0.5))
        n += 1
    n += bracket_ring(parts, mesh["b"], ST2["r"], ST2["beam"][2], "Br2")
    n += bracket_ring(parts, mesh["b"], ST3["r"], ST3["beam"][2], "Br3", gap=1.15, scale=0.55)
    return n


# --- the ranges ---------------------------------------------------------------------------------------------

def range_block(g, x0, x1, y0, y1, h, cornice=True):
    """A cream two-storey range: base course, windowed walls all round (where another range abuts, inside it),
    a stone cornice, a flat roof."""
    for side in ("s", "e", "n", "w"):
        out = SIDES[side]
        a, b = side_line(x0, x1, y0, y1, side)
        pa, pb = side_line(x0, x1, y0, y1, side, 0.25)
        fwall(g, pa, pb, 0.0, PL, "granite", out)
        g.polyn([(pa.x, pa.y, PL), (pb.x, pb.y, PL), (b.x, b.y, PL), (a.x, a.y, PL)], "granite", (0, 0, 1))
        fwall(g, a, b, PL, h, "wall", out, bay=BAY, storey=h - PL, zref=PL)
        if cornice:
            ca, cb = side_line(x0, x1, y0, y1, side, 0.5)
            ox, oy = out
            g.polyn([(ca.x, ca.y, h), (cb.x, cb.y, h), (cb.x, cb.y, h + 0.5), (ca.x, ca.y, h + 0.5)], "stone", (ox, oy, 0))
            g.polyn([(a.x, a.y, h), (b.x, b.y, h), (cb.x, cb.y, h), (ca.x, ca.y, h)], "stone", (0, 0, -1))
    g.polyn([(x0 - 0.5, y0 - 0.5, h + 0.5), (x1 + 0.5, y0 - 0.5, h + 0.5), (x1 + 0.5, y1 + 0.5, h + 0.5), (x0 - 0.5, y1 + 0.5, h + 0.5)], "roof", (0, 0, 1))


def main_hall(g, cols):
    for x0, x1, y0, y1 in RANGES:
        range_block(g, x0, x1, y0, y1, HR)
    # the glazed eave round the outside of the five halls
    skirt(g, (MX1 - MX0) / 2 + 0.5, MY + 0.5, HR + 0.5, 1.9, 1.5)
    drum(g)
    # the entrance block: the loggia below (glass doors behind six square piers), the board, its own eave
    E = ENT
    hy = E["hy"]
    g.box(E["x0"], E["x1"], -hy, hy, E["lz"], E["h"], "stone", skip=("+z",))
    g.polyn([(E["x0"], -hy, E["lz"]), (E["loggia"], -hy, E["lz"]), (E["loggia"], hy, E["lz"]), (E["x0"], hy, E["lz"])], "stone", (0, 0, -1))
    g.box(E["x0"] - 0.6, E["x1"], -hy - 0.6, hy + 0.6, E["h"], E["h"] + 0.5, "stone", skip=("-z", "+z"))
    g.polyn([(E["x0"] - 0.6, -hy - 0.6, E["h"] + 0.5), (E["x1"], -hy - 0.6, E["h"] + 0.5), (E["x1"], hy + 0.6, E["h"] + 0.5), (E["x0"] - 0.6, hy + 0.6, E["h"] + 0.5)], "roof", (0, 0, 1))
    for sy in (-1, 1):
        y0, y1 = sorted((sy * hy, sy * (hy - 1.6)))
        g.box(E["x0"], E["loggia"], y0, y1, E["floor"], E["lz"], "stone", skip=("-z", "+z"))
    # its side walls above the ranges' roofs
    for sy in (-1, 1):
        g.polyn([(E["x0"], sy * hy, HR), (E["x1"], sy * hy, HR), (E["x1"], sy * hy, E["lz"]), (E["x0"], sy * hy, E["lz"])], "stone", (0, sy, 0))
    g.polyn([(E["x1"], -hy, HR), (E["x1"], hy, HR), (E["x1"], hy, E["h"]), (E["x1"], -hy, E["h"])], "stone", (1, 0, 0))
    skirt(g, (E["x1"] - E["x0"]) / 2 + 0.6, hy + 0.6, E["h"] + 0.5, 1.6, 1.3, cx=(E["x0"] + E["x1"]) / 2)
    g.polyn([(E["x0"] - 0.62, -hy * 0.42, 12.7), (E["x0"] - 0.62, hy * 0.42, 12.7), (E["x0"] - 0.62, hy * 0.42, 15.4), (E["x0"] - 0.62, -hy * 0.42, 15.4)], "board", (-1, 0, 0))
    g.box(E["x0"] - 0.6, E["x0"], -hy * 0.42 - 0.2, hy * 0.42 + 0.2, 12.5, 15.6, "gold", skip=("-x",))
    # the loggia floor and its steps
    g.box(E["x0"] - 0.6, E["loggia"], -hy, hy, 0.0, E["floor"], "granite", skip=("-z", "+z"))
    g.polyn([(E["x0"] - 0.6, -hy, E["floor"]), (E["loggia"], -hy, E["floor"]), (E["loggia"], hy, E["floor"]), (E["x0"] - 0.6, hy, E["floor"])], "paving", (0, 0, 1))
    S = STEPS
    rise = E["floor"] / S["n"]
    for k in range(S["n"]):
        xa = S["x"] - (S["n"] - k) * S["run"]
        g.box(xa, xa + S["run"], -S["hy"], S["hy"], 0.0, (k + 1) * rise, "granite", skip=("-z", "+x"))
    # the six piers between the loggia's end walls
    gap = (2 * (hy - 1.6) - 6 * 1.4) / 7
    for i in range(6):
        y = -(hy - 1.6) + gap * (i + 1) + 1.4 * i + 0.7
        g.box(E["x0"] + 0.1, E["x0"] + 1.5, y - 0.7, y + 0.7, E["floor"], E["lz"], "stone", skip=("-z", "+z"))
        cols.append((E["x0"] + 0.8, y, 0.7))
    for sy in (-1, 1):
        cols.append((E["x0"] + 0.8, sy * (hy - 0.8), 0.8))


def side_hall(g, name, parts):
    arm, hook = HALLS[name]
    ax0, ax1, ay0, ay1, ah = arm
    hx0, hx1, hy0, hy1, hh = hook
    range_block(g, ax0, ax1, min(ay0, ay1), max(ay0, ay1), ah)
    range_block(g, hx0, hx1, min(hy0, hy1), max(hy0, hy1), hh)
    for x0, x1, y0, y1, h in (arm, hook):
        y0, y1 = sorted((y0, y1))
        skirt(g, (x1 - x0) / 2 + 0.5, (y1 - y0) / 2 + 0.5, h + 0.5, 1.6, 1.3, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2)
    # an entrance porch in the middle of the west front, under its own eave
    ym = (ay0 + ay1) / 2
    px0, px1 = ax0 - 4.5, ax0
    g.box(px0, px1, ym - 7.0, ym + 7.0, 6.8, 7.8, "stone", skip=())
    for sy in (-1, 1):
        g.box(px0, px0 + 1.0, ym + sy * 6.0 - 0.5, ym + sy * 6.0 + 0.5, 0.0, 6.8, "stone", skip=("-z", "+z"))
    skirt(g, 2.25 + 0.4, 7.4, 8.0, 1.1, 0.9, cx=(px0 + px1) / 2, cy=ym)
    return (px0, px1, ym)


# --- the forecourt ------------------------------------------------------------------------------------------

def court(g):
    C = COURT
    # paving on the axis, an apron along the halls' fronts and a frame round the two lawns (the city's grass)
    x0, x1, y0, y1, xa = C["x0"], C["x1"], C["y0"], C["y1"], -62.0
    pieces = [(x0, x1, -14.0, 14.0), (xa, x1, 14.0, y1), (xa, x1, y0, -14.0), (x0, x0 + 8.0, 14.0, y1), (x0, x0 + 8.0, y0, -14.0),
              (x0 + 8.0, xa, y1 - 6.0, y1), (x0 + 8.0, xa, y0, y0 + 6.0)]
    for a, b, c, d in pieces:
        g.polyn([(a, c, 0.03), (b, c, 0.03), (b, d, 0.03), (a, d, 0.03)], "paving", (0, 0, 1))
    fx, r = C["fx"], C["fr"]
    cyl(g, fx, 0.0, 0.0, 0.55, r + 0.5, r + 0.5, 32, "stone", smooth=False, caps=(False, False))
    g.polyn([((r + 0.5) * math.cos(2 * math.pi * i / 32) + fx, (r + 0.5) * math.sin(2 * math.pi * i / 32), 0.55) for i in range(32)], "stone", (0, 0, 1))
    g.polyn([(r * math.cos(2 * math.pi * i / 32) + fx, r * math.sin(2 * math.pi * i / 32), 0.56) for i in range(32)], "water", (0, 0, 1))
    lathe(g, [(1.8, 0.56), (1.3, 1.0), (0.45, 1.3), (0.4, 2.2), (2.4, 2.5), (2.2, 2.8), (0.35, 2.9), (0.3, 3.8), (1.1, 4.0), (1.0, 4.2), (0.15, 4.3), (0.0, 4.9)],
          16, "stone", fx, 0.0)
    g.polyn([(2.15 * math.cos(2 * math.pi * i / 16) + fx, 2.15 * math.sin(2 * math.pi * i / 16), 2.75) for i in range(16)], "water", (0, 0, 1))


# --- the building ----------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    if not os.path.isfile(FONT):
        raise SystemExit(f"font not found: {FONT}\n(download it: see flower_basket.py's header)")
    atlas, night = paint_atlas("NZ", portrait=False, emblem=False)
    wall, wall_n = wall_images()
    drum_t, drum_n = drum_images()
    M = dict(
        atlas=material("NZ_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        wall=material("NZ_Wall", CREAM, 0.8, tex=wall, emit_tex=wall_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.35}),
        drum=material("NZ_Drum", CREAM, 0.8, tex=drum_t, emit_tex=drum_n, props={"wet": "damp", "emit": "night", "glowStrength": 0.45}),
        stone=material("NZ_Stone", "#e9dfc4", 0.7, props={"wet": "damp", "glowStrength": 0.4}),
        granite=material("NZ_Granite", "#9c968b", 0.75, props={"wet": "ground", "glowStrength": 0.3}),
        tile=material("NZ_Tile", GREEN, 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        trim=material("NZ_TileEdge", "#3a8a60", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        ridge=material("NZ_Ridge", "#2a6e4c", 0.32, props={"wet": "surface", "glowStrength": 0.5}),
        roof=material("NZ_Roof", "#7a766d", 0.85, props={"wet": "ground", "glow": "none"}),
        red=material("NZ_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        board=material("NZ_Board", "#9e1c16", 0.45, props={"wet": "surface", "glow": "lamp", "glowColor": [1.0, 0.25, 0.15], "glowStrength": 0.25}),
        gold=material("NZ_Gold", "#e0b04a", 0.3, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.8}),
        paint=material("NZ_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
        marble=material("NZ_Marble", "#ebe6da", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("NZ_Paving", "#a7a196", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.45, "layer": 10}),
        water=material("NZ_Water", "#4d6c76", 0.08, props={"wet": "none", "glow": "none", "layer": 11}),
        far=material("NZ_Far", CREAM, 0.85, props={"wet": "damp", "glowStrength": 0.3}),
    )
    TILE = dict(stone=4.0, granite=2.0, tile=2.0, trim=2.0, ridge=2.0, roof=6.0, red=2.0, gold=1.0, paint=1.0, marble=2.0, board=1.0,
                paving=4.0, water=8.0, far=8.0)
    main = collection("全国农业展览馆")
    parts = collection("构件", main)
    g, cols = Geo(), []
    main_hall(g, cols)
    porches = [side_hall(g, name, parts) for name in HALLS]
    court(g)
    g.build("Halls", collection("展馆", main), M, TILE)
    tris = g.tris()
    pg = Geo(colors=False)
    n = pavilion(pg, parts, M, TILE)
    pg.build("Pavilion", collection("八角亭", main), M, TILE)
    tris += pg.tris()

    font = bpy.data.fonts.load(FONT)
    letters = collection("题字", main)
    lettering(font, "全国农业展览馆", 1.7, 11.2, "Name", M, letters, facing(ENT["x0"] - 0.68, 0.0, 14.05, (-1, 0)))

    # the far level: the ranges and halls as blocks with green eaves, the drum, the three roofs as cones
    far = Geo()

    def fblock(x0, x1, y0, y1, h, out=1.5, rise=1.3):
        far.box(x0, x1, y0, y1, 0.0, h, "far", skip=("-z", "+z"))
        lo = [(x0 - out, y0 - out), (x1 + out, y0 - out), (x1 + out, y1 + out), (x0 - out, y1 + out)]
        hi = [(x0 + 0.6, y0 + 0.6), (x1 - 0.6, y0 + 0.6), (x1 - 0.6, y1 - 0.6), (x0 + 0.6, y1 - 0.6)]
        for i in range(4):
            j = (i + 1) % 4
            mx, my = (lo[i][0] + lo[j][0]) / 2 - (x0 + x1) / 2, (lo[i][1] + lo[j][1]) / 2 - (y0 + y1) / 2
            far.polyn([(*lo[i], h + 0.3), (*lo[j], h + 0.3), (*hi[j], h + 0.3 + rise), (*hi[i], h + 0.3 + rise)], "tile", (mx, my, 10))
        far.polyn([(*p, h + 0.3 + rise) for p in hi], "roof", (0, 0, 1))
    fblock(MX0, MX1, -MY, MY, HR)
    fblock(ENT["x0"], ENT["x1"], -ENT["hy"], ENT["hy"], ENT["h"])
    for name in HALLS:
        for x0, x1, y0, y1, h in HALLS[name]:
            y0, y1 = sorted((y0, y1))
            fblock(x0, x1, y0, y1, h)
    for r, z0, z1 in ((DRUM["r"], 0.0, DRUM["top"]), (ST2["r"] * 0.95, DRUM["top"], ST2["beam"][2] + 0.5), (ST3["r"] * 0.95, EAVE2["z"], ST3["beam"][2] + 0.5)):
        a, b = oct_pts(r, z0), oct_pts(r, z1)
        for k in range(8):
            j = (k + 1) % 8
            m = A0 + (k + 0.5) * math.pi / 4
            far.polyn([a[k], a[j], b[j], b[k]], "far", (math.cos(m), math.sin(m), 0))
    for R in (EAVE1, EAVE2, EAVE3):
        r1, z1 = roof_r(R, R["r0"] - R["r1"])
        lo, hi = oct_pts(R["r0"], R["z"]), oct_pts(max(r1, 0.05), z1)
        for k in range(8):
            j = (k + 1) % 8
            m = A0 + (k + 0.5) * math.pi / 4
            far.polyn([lo[k], lo[j], hi[j], hi[k]], "tile", (math.cos(m), math.sin(m), 1.5))
    lathe(far, [(0.8, roof_r(EAVE3, EAVE3["r0"] * 0.99)[1] - 0.1), (0.55, 33.0), (0.05, 34.2)], 6, "gold")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: every range and hall a box, the entrance block, the piers, the loggia floor, the steps for
    # people, the drum and pavilion, the porches' posts, the fountain; the footprint in pieces; clear ground
    helpers = collection("碰撞体")
    for i, (x0, x1, y0, y1) in enumerate(RANGES):
        collider_box(helpers, f"range{i}", x0, x1, y0, y1, 0.0, HR + 0.5)
    collider_box(helpers, "entrance", ENT["x0"], ENT["x1"], -ENT["hy"], ENT["hy"], ENT["lz"], ENT["h"] + 0.5)
    collider_box(helpers, "loggia", ENT["x0"] - 0.6, ENT["loggia"], -ENT["hy"], ENT["hy"], 0.0, ENT["floor"])
    collider_box(helpers, "entback", ENT["loggia"], ENT["x1"], -ENT["hy"], ENT["hy"], 0.0, ENT["lz"])
    for i, (x, y, r) in enumerate(cols):
        collider_box(helpers, f"pier{i}", x - r, x + r, y - r, y + r, ENT["floor"], ENT["lz"])
    S = STEPS
    x_low = S["x"] - S["n"] * S["run"]
    import bcity_landmark
    me = bpy.data.meshes.new("steps")
    hy, zt = S["hy"], ENT["floor"]
    me.from_pydata([(S["x"], -hy, zt), (S["x"], hy, zt), (x_low, hy, 0.0), (x_low, -hy, 0.0), (S["x"], -hy, 0.0), (S["x"], hy, 0.0)], [],
                   [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
    o = bpy.data.objects.new("steps", me)
    helpers.objects.link(o)
    bcity_landmark.rename(o, "WALK")
    r8 = DRUM["r"]
    collider_pts(helpers, "drum", [(x, y, z) for x, y, _ in oct_pts(r8) for z in (0.0, DRUM["top"])])
    collider_pts(helpers, "pavilion", [(x, y, z) for x, y, _ in oct_pts(ST2["r"]) for z in (DRUM["top"], 33.0)])
    for name in HALLS:
        for j, (x0, x1, y0, y1, h) in enumerate(HALLS[name]):
            y0, y1 = sorted((y0, y1))
            collider_box(helpers, f"{name}.{j}", x0, x1, y0, y1, 0.0, h + 0.5)
    for k, (px0, px1, ym) in enumerate(porches):
        for sy in (-1, 1):
            collider_box(helpers, f"porchpost{k}{sy:+d}", px0, px0 + 1.0, ym + sy * 6.0 - 0.5, ym + sy * 6.0 + 0.5, 0.0, 6.8)
        collider_box(helpers, f"porchroof{k}", px0, px1, ym - 7.0, ym + 7.0, 6.8, 7.8)
    fr = COURT["fr"] + 0.5
    collider_pts(helpers, "fountain", [(COURT["fx"] + fr * math.cos(2 * math.pi * i / 16), fr * math.sin(2 * math.pi * i / 16), z) for i in range(16) for z in (0.0, 0.55)])
    flat_marker(helpers, "main", rect(-43.5, 35.5, -44.0, 44.0), "FOOTPRINT")
    for name in HALLS:
        for j, (x0, x1, y0, y1, h) in enumerate(HALLS[name]):
            y0, y1 = sorted((y0, y1))
            flat_marker(helpers, f"{name}.{j}", rect(x0 - (5.5 if j == 0 else 1.0), x1 + 1.0, y0 - 1.0, y1 + 1.0), "FOOTPRINT")
    flat_marker(helpers, "court", rect(COURT["x0"], 37.0, COURT["y0"], COURT["y1"]), "CLEAR")
    flat_marker(helpers, "around", rect(-46.0, 38.0, -48.0, 48.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "nongzhanguan", "全国农业展览馆", "National Agricultural Exhibition Center"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 5225.65, -3466.35, -1.0
    s.far_distance = 700
    s.repo_path = REPO
    return dict(tris=tris, parts=n)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
