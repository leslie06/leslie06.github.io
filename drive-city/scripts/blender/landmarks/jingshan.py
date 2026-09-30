# 景山: the hill north of the Forbidden City with its five pavilions, the park's south gate and 绮望楼, the park wall
# and the 寿皇殿 precinct to the north, built in Blender and marked with the bcity_landmark add-on's conventions. The
# city is a flat plane and drew 景山公园 as flat park with OSM's pavilions as little blocks on the ground.
#
#   blender -b -P scripts/blender/landmarks/jingshan.py -- [--out art/landmarks/jingshan.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the middle of 万春亭's summit terrace, game
# (-604.4, -1636.6), heading 0 (the buildings on the old axis are turned 1.5-1.9 degrees as OSM draws them). Sources:
# OSM (the park, way 29201967; the five pavilions 26390235, 189309369/72/73/74; the paths and steps on the hill; 绮望楼
# 26390236; the gates 26390237, 26390175, 26390246; 寿皇殿 26390117, 寿皇门 26390116, the side halls, stele pavilions,
# the precinct walls 654420566/71 and the south archway 584628614) and published figures: the middle peak 45.7 m over
# the street, 万春亭 17.4 m high, square, triple-eaved, yellow glaze edged in green, 20 outer and 12 inner columns;
# 观妙亭 and 辑芳亭 octagonal, double-eaved, green glaze edged in yellow; 周赏亭 and 富览亭 round, double-eaved,
# peacock-blue glaze edged in purple (the colour rising in rank towards the middle). What is modelled:
#   - the hill: a heightfield over an outline drawn inside OSM's foot paths - a ridge through the five peaks (44.5 m
#     under 万春亭, 32 m under the octagons, 21 m under the round ones), a concave profile out to the foot, blurred and
#     roughened; flat paved terraces on the peaks; OSM's paths and steps cut into it (the zig-zag up the north face,
#     the flights between the peaks) as part of the same mesh, which is also the collider (COLMESH_); wooded with my
#     own pines, cypresses and scholar trees (a CLEAR_ zone takes the city's park trees off the hill) and rockwork;
#   - the five pavilions on stone platforms with steps on the four axes (walk-only ramps), 万春亭 with a marble
#     balustrade;
#   - 绮望楼 (a two-storey 重檐歇山 hall in yellow glaze) at the south foot, 景山门 (five bays, three doorways) in the
#     south wall, the east and west gates, the park wall (red, yellow coping) round OSM's outline;
#   - north of the hill the 寿皇殿 precinct: the outer and inner walls, the brick gate with three arches, three archways
#     round the forecourt, 寿皇门, the two side halls, two octagonal stele pavilions, and 寿皇殿 (nine bays, 重檐庑殿)
#     with its two 耳殿 on a platform.

import math
import os
import random
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, linear, material, save_and_export, image  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, collider_box, collider_pts, coping, cyl, ell, flat_marker,  # noqa: E402
                 lathe, mesh_of, paving, place)
from hall import bracket_geo, bracket_spots, eave_edge, roofs, sweep, uvs, tile_wave, smooth01  # noqa: E402
from round import round_eave, round_roof  # noqa: E402
from zhengyangmen import TILE as ZTILE, make_materials, GREEN  # noqa: E402
import baita as B  # noqa: E402  (spec, trees, rocks, light balustrade parts, archway, noise)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, geometry  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "jingshan.blend")

# ---- plan (OSM, local metres) -----------------------------------------------------------------------------------------

# the hill's foot, drawn a few metres inside OSM's foot paths (counter-clockwise from the south-west)
OUTLINE = [(-168, -94), (-140, -96), (-100, -95), (-62, -96), (-32, -96), (-14, -88), (2, -80), (14, -70), (40, -71), (70, -86),
           (110, -90), (150, -87), (172, -79), (188, -65), (199, -46), (201, -19), (200, 8), (188, 28), (167, 27), (143, 23), (125, 24),
           (107, 29), (85, 41), (54, 57), (19, 74), (-5, 75), (-31, 71), (-48, 63), (-80, 43), (-110, 24), (-134, 10), (-155, 9),
           (-190, 19), (-198, 11), (-200, -2), (-202, -24), (-200, -47), (-196, -63), (-188, -78)]

PARK = [(213.7, -152.1), (206.0, 89.9), (205.9, 97.7), (205.8, 108.7), (206.1, 112.4), (204.3, 162.6), (203.2, 183.5), (202.4, 202.4),
        (199.7, 267.6), (195.7, 367.9), (154.7, 367.1), (55.6, 364.4), (-14.8, 362.6), (-82.8, 360.8), (-187.0, 356.8), (-232.3, 354.3),
        (-224.2, 184.1), (-223.6, 172.5), (-223.4, 162.1), (-221.9, 97.6), (-216.8, 93.1), (-216.6, 89.4), (-219.8, 89.3), (-219.6, 78.5),
        (-219.5, 69.6), (-216.6, 69.6), (-216.3, 66.1), (-220.9, 61.9), (-210.9, -158.5), (-207.1, -162.0), (-207.1, -171.6), (-10.3, -162.4),
        (-10.2, -167.2), (2.3, -166.8), (15.0, -166.3), (14.8, -161.2)]
OUTER_WALL = [(55.6, 364.4), (59.5, 212.9), (8.1, 211.5), (-11.3, 211.0), (-34.5, 210.4), (-45.1, 210.1), (-78.9, 209.3), (-79.0, 213.8),
              (-82.8, 360.8)]
INNER_WALL = [(44.0, 274.3), (43.4, 298.3), (42.1, 346.6), (30.5, 346.3), (30.6, 342.8), (11.3, 342.3), (11.3, 345.5), (-14.3, 344.8),
              (-39.5, 344.2), (-39.4, 340.1), (-59.1, 339.6), (-59.2, 342.8), (-69.3, 342.5), (-69.2, 336.7), (-68.8, 324.0), (-68.1, 295.4),
              (-67.5, 271.4), (-67.2, 259.4), (-24.9, 260.5), (1.5, 262.2), (44.3, 263.3),
              (44.0, 274.3)]

TILT_S = 1.9          # the south buildings' turn from the local axes (deg, counter-clockwise), from OSM's edges
TILT_N = 1.5          # the 寿皇殿 precinct's

# pavilions: name, x, y, peak height, shape
PAVILIONS = [("富览亭", -148.7, -43.0, 21.0, "round"), ("辑芳亭", -79.4, -21.9, 32.0, "oct"), ("万春亭", -1.5, 0.0, 44.5, "square"),
             ("观妙亭", 78.9, -17.0, 32.0, "oct"), ("周赏亭", 148.8, -26.9, 21.0, "round")]
SUMMIT = (-18.0, 15.0, -14.0, 13.6)          # the summit terrace (OSM's paved area round 万春亭)
SUMMIT_R = 7.0                               # its corners' radius
PAD_R = 8.8                                  # the terraces round the others (OSM's paved circles, 8.3 m)
RIDGE_ENDS = [(-188.0, -33.0), (191.0, -17.0)]
SADDLES = [15.0, 25.0, 25.0, 15.0]
EXP = 1.05                                  # the slope's profile: height ~ (1 - u)^EXP from the ridge to the foot


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def inside(x, y, poly):
    c = False
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c


def seg_proj(px, py, a, b):
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    L2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return t, math.hypot(px - ax - t * dx, py - ay - t * dy)


def poly_dist(px, py, pts, closed=True):
    n = len(pts)
    segs = range(n) if closed else range(n - 1)
    return min(seg_proj(px, py, pts[i], pts[(i + 1) % n])[1] for i in segs)


def resample(pts, step, closed=True):
    out = []
    n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        k = max(1, math.ceil((b - a).length / step))
        for j in range(k):
            out.append(tuple(a.lerp(b, j / k)))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


def rot_pts(cx, cy, pts, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def rect_pts(cx, cy, w, d, deg, m=0.0):
    return rot_pts(cx, cy, [(-w / 2 - m, -d / 2 - m), (w / 2 + m, -d / 2 - m), (w / 2 + m, d / 2 + m), (-w / 2 - m, d / 2 + m)], deg)


def rekey(g, mp):
    g.f = [(idx, u, mp.get(k, k), sm) for idx, u, k, sm in g.f]
    return g


# OSM's paths and steps round the hill (highway=footway|steps|path; id, is steps, points), from the Overpass cache
OSM_PATHS = [
    (59167905, 1, [(-30.3, -101.3), (-28.6, -67.9), (-25.9, -63.8), (-14.5, -52.6)]),
    (59167910, 0, [(-198.8, 25.5), (-202.4, 14.7), (-212.5, -15.4), (-210.8, -77.7), (-198.0, -92.9), (-178.4, -108.4), (-33.2, -133.6), (-15.7, -137.4), (0.9, -136.4), (21.6, -132.7), (40.7, -127.8), (77.9, -118.4), (152.1, -95.9), (169.3, -87.7), (177.6, -82.5), (189.3, -69.4), (203.6, -48.2), (204.1, -19.1), (205.1, 8.2), (190.8, 33.0), (192.0, 72.1), (187.6, 93.2), (140.4, 103.4), (112.7, 109.4), (85.0, 115.4), (53.9, 61.0), (54.4, 47.6), (65.8, 33.0), (98.6, 14.8), (104.1, 11.7), (131.6, -3.3), (143.2, -15.2), (147.5, -15.0), (152.3, -15.2), (156.1, -17.0), (158.0, -18.6), (159.5, -21.1)]),
    (59167914, 0, [(-5.2, 79.2), (-7.7, 124.6), (-10.3, 164.8), (-10.6, 167.4), (-10.8, 178.8), (-11.1, 201.6), (-11.3, 211.0), (-12.0, 254.4)]),
    (59167924, 1, [(135.8, -21.2), (107.3, -21.1), (90.4, -16.6), (87.1, -16.5)]),
    (59168032, 0, [(-191.8, 79.6), (-198.8, 25.5), (-155.3, 12.9), (-149.5, 13.2), (-134.0, 13.8), (-80.5, 48.2), (-47.7, 68.1), (-40.1, 71.6), (-31.0, 75.8), (-5.2, 79.2), (19.0, 78.8), (53.9, 61.0), (85.7, 45.1), (107.8, 32.8)]),
    (59168041, 0, [(187.6, 93.2), (194.8, 97.2), (205.9, 97.7), (233.6, 97.0), (237.4, 97.0)]),
    (131567862, 0, [(90.1, 262.9), (93.7, 175.4), (95.2, 139.4), (85.0, 115.4), (49.9, 125.7), (-7.7, 124.6), (-45.0, 118.4), (-66.6, 114.8), (-80.0, 112.6), (-121.0, 98.5), (-191.8, 79.6), (-208.1, 78.4), (-219.6, 78.5)]),
    (190017481, 0, [(-191.8, 79.6), (-185.7, 97.1), (-160.7, 120.4), (-131.5, 145.4), (-123.7, 151.1), (-110.1, 161.0), (-96.0, 161.9), (-83.0, 162.9), (-72.1, 163.3), (-58.6, 160.1), (-44.8, 159.1)]),
    (190017482, 1, [(8.9, 0.4), (14.8, -1.6), (16.5, 0.4)]),
    (190017484, 0, [(-8.9, 8.3), (8.8, 8.4), (8.9, 0.4), (8.9, -8.3), (0.5, -8.4), (-8.8, -8.4), (-8.8, -0.2), (-8.9, 8.3)]),
    (190017485, 1, [(-156.7, -38.4), (-160.8, -38.1), (-165.6, -46.7), (-170.2, -53.2), (-174.7, -59.3)]),
    (190017486, 1, [(-174.7, -59.3), (-174.9, -86.1)]),
    (412742235, 1, [(107.8, 32.8), (117.8, 38.5), (131.1, 39.4), (145.9, 67.3), (165.5, 74.4), (187.6, 93.2)]),
    (523775848, 0, [(208.8, -117.5), (197.3, -118.4), (190.9, -118.8), (187.5, -112.7)]),
    (523775849, 0, [(77.9, -118.4), (82.1, -135.1), (89.0, -140.6), (97.9, -144.7), (111.7, -141.5), (125.4, -137.4), (152.4, -139.0), (171.4, -125.9), (187.5, -112.7), (169.3, -87.7)]),
    (584628584, 0, [(187.6, 93.2), (187.3, 112.8), (186.1, 155.5), (144.9, 156.0), (116.2, 156.3), (111.2, 156.4), (111.0, 174.7), (93.7, 175.4)]),
    (584628619, 0, [(-33.2, -133.6), (-52.8, -148.6), (-79.8, -150.5), (-108.7, -150.2), (-121.3, -137.6), (-145.8, -143.1), (-167.5, -142.4), (-183.3, -126.6), (-184.9, -112.7), (-178.4, -108.4)]),
    (584628623, 0, [(-14.5, -52.6), (2.0, -52.4)]),
    (584742939, 0, [(-76.3, -14.9), (-62.4, -14.0), (-47.3, -14.0), (-39.2, -12.5)]),
    (584742940, 0, [(-174.9, -86.1), (-193.6, -77.4), (-200.5, -65.0), (-203.5, -47.4), (-205.8, -24.0), (-203.5, -0.7), (-202.4, 14.7)]),
    (584742941, 0, [(-143.7, -36.6), (-134.4, -32.6), (-123.6, -27.1), (-114.5, -28.2), (-102.5, -24.6), (-91.3, -22.9), (-87.3, -19.7)]),
    (584742942, 0, [(-14.5, -52.6), (-25.8, -46.5), (-34.7, -41.0), (-55.8, -38.0), (-72.9, -36.2), (-77.2, -34.1), (-78.0, -30.8)]),
    (584742943, 0, [(2.0, -52.4), (11.3, -47.9), (28.7, -37.6), (31.7, -28.9), (26.7, -21.3), (28.5, -10.5)]),
    (584742944, 0, [(40.7, -127.8), (34.7, -75.1), (6.3, -77.4), (2.0, -52.4)]),
    (584742945, 1, [(-8.8, -0.2), (-17.9, -3.2), (-26.7, -6.5), (-39.2, -12.5)]),
    (654420585, 0, [(-45.1, 210.1), (-45.4, 203.7), (-45.4, 197.6), (-44.7, 178.1), (-44.8, 159.1), (-45.0, 118.4), (-45.0, 115.2), (-40.1, 71.6)]),
    (727013709, 1, [(-123.6, -27.1), (-126.8, -16.9), (-131.9, -12.5), (-141.3, -9.0), (-147.7, -0.1), (-149.5, 13.2)]),
    (727014064, 0, [(135.8, -21.2), (137.6, -21.2), (142.7, -21.3)]),
    (727014065, 1, [(204.1, -19.1), (189.0, -11.6), (179.7, -16.9), (173.0, -27.3), (165.8, -18.2)]),
    (727014068, 1, [(71.1, -14.2), (67.2, -11.4), (45.0, -4.6), (24.6, -1.9)]),
    (727014069, 0, [(16.5, 0.4), (24.6, -1.9)]),
    (727014070, 1, [(-5.2, 79.2), (4.0, 73.1), (-1.3, 62.8), (1.4, 58.2), (-6.3, 52.1), (-7.0, 43.7), (0.9, 41.0), (5.0, 35.5), (-2.0, 31.4), (-9.7, 30.0), (-1.7, 24.7), (-10.9, 23.5), (-18.7, 16.7), (-25.5, 4.1)]),
    (727014071, 0, [(-174.9, -86.1), (-178.4, -108.4)]),
    (984073419, 1, [(-25.8, -46.5), (-28.3, -38.2), (-22.6, -30.7), (-29.4, -26.6), (-30.8, -17.6)]),
    (984073420, 1, [(8.6, 23.1), (18.7, 16.3), (23.5, 7.8), (24.6, -1.9)]),
    (1414155049, 0, [(-66.6, 114.8), (-58.6, 85.2), (-47.7, 68.1)]),
    (1472605101, 0, [(-170.2, -53.2), (-167.8, -62.3), (-164.0, -69.9), (-169.5, -77.9), (-165.7, -81.4), (-166.1, -85.9), (-168.5, -90.8), (-164.7, -96.7), (-155.0, -98.0), (-145.2, -100.8), (-137.6, -98.4), (-131.3, -93.5), (-126.5, -93.2), (-112.6, -94.6), (-101.5, -94.9), (-91.4, -94.6), (-72.3, -97.3), (-60.5, -100.5), (-57.4, -101.2), (-30.6, -107.8)]),
    (1472605102, 0, [(-60.5, -100.5), (-60.2, -106.0), (-50.5, -109.1), (-47.3, -116.8), (-47.7, -123.0), (-42.1, -125.8), (-15.7, -137.4)]),
    (1524244742, 1, [(143.2, -15.2), (140.5, -16.8), (137.8, -19.2), (137.6, -21.2)]),
    (1559094381, 1, [(-1.7, 24.7), (8.6, 23.1)]),
    (1559094382, 1, [(-25.5, 4.1), (-26.7, -6.5)]),
    (1559094383, 1, [(-30.8, -17.6), (-26.7, -6.5)]),
    (1559094384, 0, [(28.5, -10.5), (24.6, -1.9)]),
    (1559094385, 1, [(-15.7, -137.4), (-31.5, -123.3), (-30.6, -107.8), (-30.3, -101.3)]),
    (1559094386, 1, [(165.8, -18.2), (159.5, -21.1), (155.9, -22.8)]),
    (1561969374, 0, [(107.8, 32.8), (125.4, 27.3), (142.8, 26.7), (167.4, 30.8), (190.8, 33.0)]),
    (1561969375, 1, [(98.6, 14.8), (101.9, 24.0), (107.8, 32.8)]),
]


# ---- the heightfield ------------------------------------------------------------------------------------------------

def ridge_line():
    """The ridge through the peaks, its arc length, and tables along it of its height and of its half thickness (the
    peaks are flat-topped: the terraces, 15 m for the summit and PAD_R for the others, then easing out over 12 m)."""
    pts = [RIDGE_ENDS[0]] + [(p[1], p[2]) for p in PAVILIONS] + [RIDGE_ENDS[1]]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    rad = [20.0 if p[0] == "万春亭" else PAD_R + 3.0 for p in PAVILIONS]
    ctrl = [(0.0, 2.0)]
    for i, p in enumerate(PAVILIONS):
        s = cum[i + 1]
        if i > 0:
            ctrl.append(((cum[i] + s) / 2, SADDLES[i - 1]))
        ctrl.append((s - rad[i] * 0.6, p[3]))
        ctrl.append((s + rad[i] * 0.6, p[3]))
    ctrl.append((cum[-1], 2.0))
    ss = np.linspace(0, cum[-1], 3000)
    hs = np.zeros_like(ss)
    for (s0, h0), (s1, h1) in zip(ctrl, ctrl[1:]):
        m = (ss >= s0) & (ss <= s1)
        t = (ss[m] - s0) / max(1e-6, s1 - s0)
        hs[m] = h0 + (h1 - h0) * (1 - np.cos(np.pi * t)) / 2
    rs = np.zeros_like(ss)
    for i, p in enumerate(PAVILIONS):
        d = np.abs(ss - cum[i + 1])
        e = np.clip((d - rad[i]) / 12.0, 0, 1)
        rs = np.maximum(rs, rad[i] * (1 - (3 * e * e - 2 * e ** 3)))
    return pts, cum, ss, hs, rs


def inside_np(X, Y, poly):
    c = np.zeros(X.shape, bool)
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[i - 1]
        cond = (ay > Y) != (by > Y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (bx - ax) * (Y - ay) / (by - ay) + ax
        c ^= cond & (X < xi)
    return c


def edge_dist_np(X, Y, poly):
    best = np.full(X.shape, 1e9)
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / L2, 0, 1)
        best = np.minimum(best, np.hypot(X - ax - t * dx, Y - ay - t * dy))
    return best


def ray_np(qx, qy, dx, dy, poly):
    best = np.full(qx.shape, 1e9)
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        with np.errstate(divide="ignore", invalid="ignore"):
            s = ((ax - qx) * ey - (ay - qy) * ex) / den
            t = ((ax - qx) * dy - (ay - qy) * dx) / den
        ok = (np.abs(den) > 1e-9) & (s > 0) & (t >= 0) & (t <= 1)
        best = np.where(ok, np.minimum(best, s), best)
    return best


class Field:
    """The hill without paths and terraces: the max over the ridge's segments of a profile falling from the ridge to
    the foot, blurred, masked to the outline."""

    def __init__(s, step=1.0):
        s.x0, s.y0, s.step = -216.0, -106.0, step
        xs = np.arange(s.x0, 218.0, step)
        ys = np.arange(s.y0, 88.0, step)
        X, Y = np.meshgrid(xs, ys)
        pts, cum, ss, hs, rs = ridge_line()
        H = np.zeros(X.shape)
        din = edge_dist_np(X, Y, OUTLINE)
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy)
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / (L * L), 0, 1)
            qx, qy = ax + t * dx, ay + t * dy
            d = np.hypot(X - qx, Y - qy)
            sa = cum[i] + t * L
            r = np.interp(sa, ss, rs)
            # how far from the ridge (past its flat top) towards the foot: 0 on the ridge, 1 on the outline
            e = np.maximum(d - r, 0.0)
            u = np.clip(e / np.maximum(e + din, 1e-3), 0, 1)
            hr = np.interp(sa, ss, hs)
            H = np.maximum(H, hr * (1 - u) ** EXP)
        ins = inside_np(X, Y, OUTLINE)
        H = np.where(ins, H, 0.0)
        # blur (sigma 2.5 m) to round the creases where the segments' profiles meet
        sig = 2.5 / step
        r = int(3 * sig)
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2)
        k /= k.sum()
        Hp = np.pad(H, r, mode="edge")
        Hp = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 1, Hp)
        Hp = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 0, Hp)
        H = Hp[r:-r, r:-r]
        m = np.clip(din / 5.0, 0, 1)
        H = np.where(ins, H * m * m * (3 - 2 * m), 0.0)
        s.H, s.din = H, np.where(ins, din, -din)

    def sample(s, x, y, A=None):
        A = s.H if A is None else A
        fx, fy = (x - s.x0) / s.step, (y - s.y0) / s.step
        i, j = int(math.floor(fx)), int(math.floor(fy))
        ny, nx = A.shape
        i, j = max(0, min(nx - 2, i)), max(0, min(ny - 2, j))
        tx, ty = min(1.0, max(0.0, fx - i)), min(1.0, max(0.0, fy - j))
        return (A[j, i] * (1 - tx) + A[j, i + 1] * tx) * (1 - ty) + (A[j + 1, i] * (1 - tx) + A[j + 1, i + 1] * tx) * ty


FIELD = None


def pad_dist(x, y):
    """Distance outside the nearest terrace (0 inside) and its height."""
    best, hb = 1e9, 0.0
    for name, px, py, h, _ in PAVILIONS:
        if name == "万春亭":
            # a rectangle with its corners rounded (radius SUMMIT_R)
            x0, x1, y0, y1 = SUMMIT
            r = SUMMIT_R
            d = math.hypot(max(0.0, x0 + r - x, x - x1 + r), max(0.0, y0 + r - y, y - y1 + r)) - r
            d = max(0.0, d)
        else:
            d = max(0.0, math.hypot(x - px, y - py) - PAD_R)
        if d < best:
            best, hb = d, h
    return best, hb


def nat(x, y):
    h = FIELD.sample(x, y)
    din = FIELD.sample(x, y, FIELD.din)
    if din <= 0:
        return 0.03
    d, hp = pad_dist(x, y)
    amp = 1.1 * smooth(2, 18, din) * smooth(1, 10, d)
    h += B.noise(x, y) * amp
    w = smooth(0.0, 9.0, d)
    h = hp * (1 - w) + h * w
    return max(0.03, h)


# ---- paths --------------------------------------------------------------------------------------------------------

def clip_paths():
    """OSM's paths on the hill, clipped to the outline, out of the terraces; each (steps, pts, half width)."""
    out = []
    for wid, steps, pts in OSM_PATHS:
        if wid == 190017484:          # the ring round 万春亭 is the summit terrace
            continue
        dense = resample(pts, 1.0, closed=False)
        run = []
        for p in dense + [None]:
            ok = p is not None and inside(p[0], p[1], OUTLINE) and poly_dist(p[0], p[1], OUTLINE) > 0.5 and pad_dist(p[0], p[1])[0] > 0.8
            if ok:
                run.append(p)
            else:
                if len(run) >= 4:
                    pts2 = run[::2] if run[::2][-1] == run[-1] else run[::2] + [run[-1]]
                    out.append((steps, pts2, 1.1 if steps else 1.4))
                run = []
    return out


class PathSet:
    def __init__(s, paths):
        s.paths = []
        for steps, pts, hw in paths:
            acc = [0.0]
            for a, b in zip(pts, pts[1:]):
                acc.append(acc[-1] + math.dist(a, b))
            zs = [nat(x, y) for x, y in pts]
            # smooth the centreline's heights along it (the noise would otherwise make it bump)
            zz = list(zs)
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            s.paths.append(SimpleNamespace(steps=steps, pts=pts, acc=acc, z=zz, hw=hw, box=(min(xs) - hw - 2, max(xs) + hw + 2, min(ys) - hw - 2, max(ys) + hw + 2)))

    def near(s, x, y):
        """(path, arc length, lateral distance, height) of the nearest centreline within its band + 0.01, else None."""
        best = None
        for p in s.paths:
            x0, x1, y0, y1 = p.box
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            for i in range(len(p.pts) - 1):
                t, d = seg_proj(x, y, p.pts[i], p.pts[i + 1])
                if d <= p.hw + 0.01 and (best is None or d < best[2]):
                    L = p.acc[i + 1] - p.acc[i]
                    best = (p, p.acc[i] + t * L, d, p.z[i] + (p.z[i + 1] - p.z[i]) * t, i, t)
        return best


def terrain(x, y, paths=None):
    """The ground, with the paths cut level across into it: each path within a metre of the point pulls the ground to its
    centreline's height, weighted by closeness (a hard switch to the nearest path's height made steps where two paths
    meet)."""
    h = nat(x, y)
    if paths is None:
        return h
    acc, wsum = 0.0, 0.0
    for p in paths.paths:
        x0, x1, y0, y1 = p.box
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        # every segment within reach pulls, so the two legs of a hairpin blend instead of switching
        for i in range(len(p.pts) - 1):
            t, d = seg_proj(x, y, p.pts[i], p.pts[i + 1])
            w = smooth(p.hw + 2.5, p.hw - 0.3, d)
            if w > 0:
                acc += w * (p.z[i] + (p.z[i + 1] - p.z[i]) * t - h)
                wsum += w
    if wsum > 0:
        # two thirds of the way to level: a full cut left banks too steep to walk off the path
        h += 0.65 * acc / max(1.0, wsum)
    return h


# ---- materials ----------------------------------------------------------------------------------------------------

def stairs_image(size=256):
    """Stone steps seen from above along the flight: three treads per repeat, the riser's shadow, worn kerbs."""
    cv = Canvas(size, size, "#a8a499")
    cv.noise(0.1, 17)
    q = size / 3
    for k in range(3):
        y = k * q
        cv.rect(0, y, size, y + q * 0.18, "#6f6b62")
        cv.rect(0, y + q * 0.18, size, y + q * 0.26, "#c4c0b4")
    cv.rect(0, 0, size * 0.07, size, "#8a867c")
    cv.rect(size * 0.93, 0, size, size, "#8a867c")
    return image("JS_Stairs", np.flipud(cv.a).copy())


def materials():
    M = make_materials("JS")
    GL = {"wet": "surface", "glowStrength": 0.5}
    M.update(
        earth=material("JS_Earth", "#ffffff", 0.95, vertex_colors=True, props={"wet": "damp", "glow": "none", "layer": 6}),
        foliage=material("JS_Foliage", "#ffffff", 0.85, vertex_colors=True, props={"wet": "damp", "glow": "none"}),
        path=material("JS_Path", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.6, "layer": 6}),
        stairs=material("JS_StairsMat", "#ffffff", 0.8, tex=stairs_image(), props={"wet": "ground", "glowStrength": 0.6, "layer": 6}),
        yellow=material("JS_Yellow", "#d9a02a", 0.32, props=GL),
        green=material("JS_Green", GREEN, 0.32, props=GL),
        blue=material("JS_Blue", "#1d6f8f", 0.3, props=GL),
        purple=material("JS_Purple", "#5b3568", 0.32, props=GL),
    )
    return M


TILE = dict(ZTILE, earth=1.0, foliage=1.0, path=4.0, stairs=1.0, yellow=2.0, green=2.0, blue=2.0, purple=2.0)
COLOURS = {"square": ("yellow", "green"), "oct": ("green", "yellow"), "round": ("blue", "purple")}


# ---- the terrain mesh -----------------------------------------------------------------------------------------------

def earth_colour(x, y, slope, tree_d):
    k = 0.5 + 0.5 * math.sin(x * 0.31 + math.sin(y * 0.23) * 2.0) * math.cos(y * 0.27 - x * 0.05)
    grass = Vector(linear("#5f7a3e")).lerp(Vector(linear("#72834c")), k)
    wood = Vector(linear("#3d4a2c")).lerp(Vector(linear("#4b5334")), k)
    c = grass.lerp(wood, smooth(9.0, 3.0, tree_d))
    c = c.lerp(Vector(linear("#8a8579")), smooth(1.1, 1.5, slope))
    return tuple(c)


def build_terrain(step, trees, paths=None):
    detail = paths is not None
    pts, edges = [], []
    ring = resample(OUTLINE, 2.5 if detail else 6.0)
    pts += ring
    n0 = len(ring)
    edges += [(i, (i + 1) % n0) for i in range(n0)]

    def add_line(line, closed):
        base = len(pts)
        pts.extend(line)
        m = len(line)
        edges.extend((base + i, base + (i + 1) % m) for i in range(m if closed else m - 1))
    cons = []           # constrained lines, for keeping the grid points off them
    if detail:
        x0, x1, y0, y1 = SUMMIT
        R_ = SUMMIT_R
        cs = [(x1 - R_, y0 + R_, -90), (x1 - R_, y1 - R_, 0), (x0 + R_, y1 - R_, 90), (x0 + R_, y0 + R_, 180)]
        r = []
        for cx_, cy_, a0 in cs:
            for i in range(7):
                a = math.radians(a0 + 90 * i / 6)
                r.append((cx_ + R_ * math.cos(a), cy_ + R_ * math.sin(a)))
        r = resample(r, 1.5)
        add_line(r, True)
        cons.append((r, True, bbox(r)))
        for name, px, py, h, _ in PAVILIONS:
            if name != "万春亭":
                c = [(px + PAD_R * math.cos(2 * math.pi * i / 48), py + PAD_R * math.sin(2 * math.pi * i / 48)) for i in range(48)]
                add_line(c, True)
                cons.append((c, True, bbox(c)))
        for p in paths.paths:
            for sgn in (-1, 1):
                side = offset_line(p.pts, sgn * p.hw)
                side = [q for q in side]
                add_line(side, False)
                cons.append((side, False, bbox(side)))
    xs0, xs1 = min(p[0] for p in OUTLINE), max(p[0] for p in OUTLINE)
    ys0, ys1 = min(p[1] for p in OUTLINE), max(p[1] for p in OUTLINE)
    gx = xs0
    while gx <= xs1:
        gy = ys0
        while gy <= ys1:
            if inside(gx, gy, OUTLINE) and poly_dist(gx, gy, OUTLINE) > step * 0.45:
                ok = True
                if detail:
                    for line, closed, (bx0, bx1, by0, by1) in cons:
                        if bx0 - 1 <= gx <= bx1 + 1 and by0 - 1 <= gy <= by1 + 1 and poly_dist(gx, gy, line, closed) < 0.7:
                            ok = False
                            break
                if ok:
                    pts.append((gx, gy))
            gy += step
        gx += step
    vs, es, fs, *_ = geometry.delaunay_2d_cdt([Vector(p) for p in pts], edges, [list(range(n0))], 0, 1e-4, True)
    tri = []
    for f in fs:
        a, b, c = (vs[i] for i in f)
        cx, cy = (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3
        if inside(cx, cy, OUTLINE):
            area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
            if abs(area) < 1e-6:
                continue
            tri.append(tuple(f) if area > 0 else (f[0], f[2], f[1]))
    grid = {}
    for t in trees:
        grid.setdefault((int(t[1] // 10), int(t[2] // 10)), []).append((t[1], t[2]))

    def tree_d(x, y):
        best = 99.0
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for tx, ty in grid.get((int(x // 10) + i, int(y // 10) + j), ()):
                    best = min(best, math.hypot(tx - x, ty - y))
        return best
    g = Geo(colors=True)
    idx, H = {}, {}
    for f in tri:
        for i in f:
            if i in idx:
                continue
            x, y = vs[i].x, vs[i].y
            h = terrain(x, y, paths)
            if poly_dist(x, y, OUTLINE) < 0.05:
                h = 0.03
            e = 1.0
            sl = math.hypot(nat(x + e, y) - nat(x - e, y), nat(x, y + e) - nat(x, y - e)) / (2 * e)
            H[i] = h
            idx[i] = g.vert((x, y, h), earth_colour(x, y, sl, tree_d(x, y)))
    for f in tri:
        a, b, c = (vs[i] for i in f)
        cx, cy = (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3
        key, uv_ = "earth", None
        if detail:
            if pad_dist(cx, cy)[0] <= 0.0:
                key = "path"
            else:
                hit = paths.near(cx, cy)
                if hit and hit[2] < hit[0].hw - 0.02:
                    p = hit[0]
                    slope = abs(p.z[min(hit[4] + 1, len(p.z) - 1)] - p.z[hit[4]]) / max(0.5, p.acc[min(hit[4] + 1, len(p.acc) - 1)] - p.acc[hit[4]])
                    if p.steps or slope > 0.12:
                        key = "stairs"
                        uv_ = []
                        for i in f:
                            x, y = vs[i].x, vs[i].y
                            lat = 0.0
                            best = None
                            for k in range(len(p.pts) - 1):
                                t, d = seg_proj(x, y, p.pts[k], p.pts[k + 1])
                                if best is None or d < best[0]:
                                    ax, ay = p.pts[k]
                                    bx, by = p.pts[k + 1]
                                    side = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
                                    best = (d, math.copysign(d, side))
                            lat = best[1]
                            uv_.append((0.5 + lat / (2 * p.hw), H[i] / 0.45))
                    else:
                        key = "path"
        g.face([idx[i] for i in f], key, uvs=uv_, smooth=(key == "earth"))
    return g


def bbox(pts):
    return min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)


def offset_line(pts, dist):
    """A polyline pushed `dist` to its left (mitred)."""
    n = len(pts)
    out = []
    for i in range(n):
        ns = []
        for a, b in ((i - 1, i), (i, i + 1)):
            if a < 0 or b >= n:
                continue
            d = (Vector(pts[b]) - Vector(pts[a])).normalized()
            ns.append(Vector((-d.y, d.x)))
        m = (ns[0] + ns[-1])
        m = m.normalized() if m.length > 1e-6 else ns[0]
        k = 1.0 / max(0.5, m.dot(ns[0]))
        out.append(tuple(Vector(pts[i]) + m * dist * k))
    return out


# ---- pavilion roofs: polygonal (square, octagonal) and round ---------------------------------------------------------

def face_world(k, n, a0, u, v, z):
    th = 2 * math.pi * k / n
    x, y = u, -a0 + v
    c, s = math.cos(th), math.sin(th)
    return Vector((x * c - y * s, x * s + y * c, z))


def poly_point(R, n, u, v):
    ta = math.tan(math.pi / n)
    w = (R["a"] - v) * ta
    gd = max(0.0, w - abs(u))
    k = max(0.0, 1 - gd / R["Lc"]) ** 2 * max(0.0, 1 - v / R["Vc"]) ** 1.5
    sg = 1.0 if u >= 0 else -1.0
    z = R["z"] + R["H"] * (max(0.0, v) / R["top"]) ** R["p"] + R["lift"] * k
    return u + sg * R["o"] * ta * k, v - R["o"] * k, z


def poly_face(g, R, n, k, rows=6, waves=True, pitch=0.4, amp=0.08, trim=0.0, cols=6):
    """One face of an n-sided roof (hall.roof_face with the hips at 180/n degrees): tile rows as geometry."""
    ta = math.tan(math.pi / n)
    top = R["top"]
    q = pitch / 4
    vs = [top * (j / rows) ** 1.15 for j in range(rows + 1)]
    if 0 < trim < top:
        vs = sorted(set(vs) | {trim})
    out, prev, pv = [], None, 0.0
    for v in vs:
        w = max(0.02, (R["a"] - v) * ta)
        if waves:
            k0, k1 = math.ceil(-w / q - 0.125 + 1e-3), math.floor(w / q - 0.125 - 1e-3)
            us = [-w] + [(kk + 0.125) * q for kk in range(k0, k1 + 1)] + [w]
        else:
            us = [-w + 2 * w * i / cols for i in range(cols + 1)]
        dzdv = R["H"] * R["p"] * (max(v, 1e-3) / top) ** (R["p"] - 1) / top
        nz = Vector((0.0, -dzdv, 1.0)).normalized()
        row = []
        for u in us:
            cu, cv, cz = poly_point(R, n, u, v)
            p = Vector((cu, cv, cz))
            if waves:
                fade = smooth01((w - abs(u)) / 0.5) * smooth01((top - v) / 0.5)
                p += nz * (amp * tile_wave(u, pitch) * fade)
            row.append((u, g.vert(face_world(k, n, R["a"], p.x, p.y, p.z))))
        if prev is not None:
            fk = "trim" if trim and pv < trim - 1e-6 else "tile"
            i = j = 0
            while i < len(prev) - 1 or j < len(row) - 1:
                if j == len(row) - 1 or (i < len(prev) - 1 and prev[i + 1][0] <= row[j + 1][0]):
                    g.face((prev[i][1], prev[i + 1][1], row[j][1]), fk, smooth=True)
                    i += 1
                else:
                    g.face((prev[i][1], row[j + 1][1], row[j][1]), fk, smooth=True)
                    j += 1
        out.append([Vector(g.v[ix]) for _, ix in row])
        prev, pv = row, v
    return out


def poly_roof(g, R, n, ac, zb, lod=False, rows=6, trim=0.9, pitch=0.4):
    """A whole n-sided roof: faces, eave edges, soffits back to the column line (apothem ac, height zb), hip ridges."""
    ta = math.tan(math.pi / n)
    for k in range(n):
        rs = poly_face(g, R, n, k, rows=3 if lod else rows, waves=not lod, trim=0.0 if lod else trim, pitch=pitch)
        if lod:
            continue
        eave_edge(g, rs[0], drop=0.25, key="trim")
        # the soffit: from under the eave to the beam over the column line
        m = 6
        outer, inner = [], []
        for i in range(m + 1):
            f = -1 + 2 * i / m
            cu, cv, cz = poly_point(R, n, f * R["a"] * ta * 0.999, 0.0)
            outer.append(face_world(k, n, R["a"], cu, cv, cz - 0.3))
            inner.append(face_world(k, n, R["a"], f * ac * ta, R["a"] - ac, zb))
        for i in range(m):
            g.polyn([outer[i], outer[i + 1], inner[i + 1], inner[i]], "atlas", (0, 0, -1), uvs=uvs("rafters", QUAD))
        sweep(g, [r[-1] for r in rs], 0.36, 0.3, key="trim")
        c = rs[0][-1]
        out = Vector((c.x, c.y, 0)).normalized()
        e = c + out * 0.15 + Vector((0, 0, -0.1))
        g.box(e.x - 0.14, e.x + 0.14, e.y - 0.14, e.y + 0.14, e.z - 0.14, e.z + 0.14, "trim")
    return R["z"] + R["H"]


def ngon(n, a, phase=0.0):
    """Vertices of an n-gon of apothem a whose face 0 faces -Y."""
    r = a / math.cos(math.pi / n)
    return [(r * math.cos(-math.pi / 2 + 2 * math.pi * (k + 0.5) / n + phase), r * math.sin(-math.pi / 2 + 2 * math.pi * (k + 0.5) / n + phase)) for k in range(n)]


def prism(g, poly, z0, z1, key, top=True, top_key=None):
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        g.polyn([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], key, (mx, my, 0))
    if top:
        g.polyn([(x, y, z1) for x, y in poly], top_key or key, (0, 0, 1))


def finial(g, z, s=1.0):
    cyl(g, 0, 0, z - 0.3, z + 0.3 * s, 0.55 * s, 0.45 * s, 16, "trim", caps=(False, True))
    cyl(g, 0, 0, z + 0.3 * s, z + 0.6 * s, 0.4 * s, 0.4 * s, 16, "gold", caps=(False, True))
    ell(g, (0, 0, z + 1.15 * s), (0.45 * s, 0.45 * s, 0.62 * s), "gold", nu=14, nv=8)
    cyl(g, 0, 0, z + 1.7 * s, z + 2.1 * s, 0.1 * s, 0.03, 8, "gold", caps=(False, True))


# ---- pavilion bodies --------------------------------------------------------------------------------------------------

class Shape:
    """Column rings and wall faces for a square (with intermediate columns), octagonal or round pavilion."""

    def __init__(s, kind):
        s.kind = kind
        s.n = {"square": 4, "oct": 8, "round": 16}[kind]

    def columns(s, a, per_side=None):
        if s.kind == "square":
            xs = per_side
            out = []
            for k in range(4):
                for u in xs[:-1]:
                    out.append(tuple(face_world(k, 4, a, u, 0.0, 0.0))[:2])
            return out
        if s.kind == "oct":
            return ngon(8, a)
        r = a
        return [(r * math.cos(-math.pi / 2 + 2 * math.pi * (k + 0.5) / 8), r * math.sin(-math.pi / 2 + 2 * math.pi * (k + 0.5) / 8)) for k in range(8)]

    def ring(s, a):
        """The wall line: a polygon through the column centres."""
        if s.kind == "round":
            return [(a * math.cos(-math.pi / 2 + 2 * math.pi * (k + 0.5) / 16), a * math.sin(-math.pi / 2 + 2 * math.pi * (k + 0.5) / 16)) for k in range(16)]
        return ngon(s.n, a)


def ring_faces(g, cols, z0, z1, region, off=0.0, both=False, doors=None):
    """Panels (atlas region) between consecutive columns from z0 to z1, facing out (and in with `both`)."""
    n = len(cols)
    for i in range(n):
        a, b = Vector(cols[i]), Vector(cols[(i + 1) % n])
        mid = (a + b) / 2
        out = mid.normalized() if mid.length > 1e-6 else Vector((0, -1))
        a2, b2 = a + out * off, b + out * off
        reg = "door" if doors and i in doors else region
        g.polyn([(a2.x, a2.y, z0), (b2.x, b2.y, z0), (b2.x, b2.y, z1), (a2.x, a2.y, z1)], "atlas", (out.x, out.y, 0), uvs=uvs(reg, QUAD))
        if both:
            a3, b3 = a - out * off, b - out * off
            g.polyn([(b3.x, b3.y, z0), (a3.x, a3.y, z0), (a3.x, a3.y, z1), (b3.x, b3.y, z1)], "atlas", (-out.x, -out.y, 0), uvs=uvs(reg, QUAD))


def ceiling_ring(g, outer, inner, z):
    n = len(outer)
    m = len(inner)
    # pair each outer segment with the inner ring by angle: both rings are drawn as polygons of equal count here
    for i in range(n):
        a, b = outer[i], outer[(i + 1) % n]
        c, d = inner[i * m // n], inner[((i + 1) * m // n) % m]
        g.polyn([(a[0], a[1], z), (b[0], b[1], z), (d[0], d[1], z), (c[0], c[1], z)], "atlas", (0, 0, -1), uvs=uvs("ceiling", QUAD))


def bracket_ring(parts, meshes, tag, m, poly, z, scale, gap=1.1):
    n = len(poly)
    cnt = 0
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        mid = (a + b) / 2
        phi = math.atan2(mid.y, mid.x)
        L = (b - a).length
        k = max(1, round(L / gap))
        for j in range(k):
            p = a.lerp(b, (j + 0.5) / k)
            place(meshes["bracket"], f"{tag}.br{cnt}", parts, m @ T(p.x, p.y, z) @ Rz(phi + math.pi / 2) @ Matrix.Diagonal((scale, scale, scale, 1.0)))
            cnt += 1
    return cnt


# pavilion levels (heights over the floor): outer column top, eave apothem / radius, eave height, the next wall's
# apothem, the rise of the skirt; the last level is the crowning roof
SPECS = {
    "square": dict(P=1.0, base=8.0, outer=6.0, XS_out=[-6.0, -3.6, -1.2, 1.2, 3.6, 6.0], inner=3.6, XS_in=[-3.6, -1.2, 1.2, 3.6],
                   levels=[(3.4, 7.8, 4.4, 3.6, 2.0), (7.6, 5.3, 8.7, 2.7, 1.5), (11.0, 4.3, 12.1, 0.0, 3.0)], fin=1.1, br=0.7),
    "oct": dict(P=0.7, base=6.4, outer=4.1, inner=2.6, levels=[(3.0, 5.5, 3.9, 2.6, 1.5), (6.6, 4.0, 7.5, 0.0, 2.8)], fin=0.95, br=0.6),
    "round": dict(P=0.6, base=5.4, outer=3.8, inner=2.3, levels=[(2.9, 5.1, 3.8, 2.3, 1.35), (6.3, 3.6, 7.2, 0.0, 2.6)], fin=0.9, br=0.55),
}


def rail_geo(g, pts, gap=1.9, skip=()):
    """kit.balustrade baked into the buffer (a few dozen posts: not worth an instanced draw call and its shadows)."""
    post, panel = B.light_post(), B.light_panel()
    posts = {}
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        k = max(1, round((b - a).length / gap))
        for i in range(k):
            p0, p1 = a.lerp(b, i / k), a.lerp(b, (i + 1) / k)
            mid = (p0 + p1) / 2
            if any(x0 <= mid.x <= x1 and y0 <= mid.y <= y1 for x0, x1, y0, y1 in skip):
                continue
            d = p1 - p0
            yaw = math.atan2(d.y, d.x)
            for p in (p0, p1):
                posts.setdefault((round(p.x, 2), round(p.y, 2)), (p, yaw))
            g.add(panel, T(*(p0 + d.normalized() * 0.12)) @ Rz(yaw) @ Matrix.Diagonal((d.length - 0.24, 1, 1, 1)))
    for p, yaw in posts.values():
        g.add(post, T(*p) @ Rz(yaw))


def pav_colliders(helpers, S, cx, cy, zg, sp, sh):
    """Platform, columns, the closed core, the steps' ramps; returns the flights' plans for the tree and path checks."""
    P = sp["P"]
    base = sh.ring(sp["base"]) if sh.kind != "square" else ngon(4, sp["base"])
    collider_pts(helpers, "platform", [(cx + x, cy + y, zg - 0.4) for x, y in base] + [(cx + x, cy + y, zg + P) for x, y in base])
    top = sp["levels"][-1]
    core = sh.ring(sp["inner"]) if sh.kind != "square" else ngon(4, sp["inner"])
    collider_pts(helpers, "core", [(cx + x, cy + y, zg + P) for x, y in core] + [(cx + x, cy + y, zg + P + top[2]) for x, y in core])
    cols = sh.columns(sp["outer"], sp.get("XS_out"))
    for x, y in cols:
        collider_box(helpers, "column", cx + x - 0.22, cx + x + 0.22, cy + y - 0.22, cy + y + 0.22, zg + P, zg + P + sp["levels"][0][0])


def flight(g, helpers, cx, cy, phi, width, z0, z1, a_edge, rise=0.15, run=0.32, key="stone", tag="steps"):
    """A flight from the platform edge (apothem a_edge out along direction phi) down to z0, with its walk-only ramp."""
    n = max(2, math.ceil((z1 - z0) / rise))
    L = n * run
    sub = Geo()
    for k in range(n):
        y0, y1 = k * run, (k + 1) * run
        z = z1 - (z1 - z0) * (k + 1) / n
        zt = z1 - (z1 - z0) * k / n
        sub.polyn([(-width / 2, y0, zt), (width / 2, y0, zt), (width / 2, y1, zt), (-width / 2, y1, zt)], key, (0, 0, 1))
        sub.polyn([(-width / 2, y1, z), (width / 2, y1, z), (width / 2, y1, zt), (-width / 2, y1, zt)], key, (0, 1, 0))
    for sx in (-1, 1):
        xa, xb = sorted((sx * width / 2, sx * (width / 2 + 0.4)))
        prof = [(0, z1 + 0.12), (L, z0 + 0.12), (L, z0 - 0.3), (0, z0 - 0.3)]
        sub.polyn([(xa, y, z) for y, z in prof], key, (-1, 0, 0))
        sub.polyn([(xb, y, z) for y, z in prof], key, (1, 0, 0))
        sub.polyn([(xa, 0, z1 + 0.12), (xb, 0, z1 + 0.12), (xb, L, z0 + 0.12), (xa, L, z0 + 0.12)], key, (0, 0.3, 1))
        sub.polyn([(xa, L, z0 - 0.3), (xb, L, z0 - 0.3), (xb, L, z0 + 0.12), (xa, L, z0 + 0.12)], key, (0, 1, 0))
    m = T(cx + a_edge * math.cos(phi), cy + a_edge * math.sin(phi), 0) @ Rz(phi - math.pi / 2)
    g.add(sub, m)
    if helpers is not None:
        w = width / 2 + 0.4
        pts = [(x, y, z) for x in (-w, w) for y, z in ((-1.0, z1), (0.0, z1), (L, z0 - 0.05), (L, z0 - 0.4), (-1.0, z1 - 0.5), (0.0, z0 - 0.4))]
        collider_pts(helpers, tag, [tuple(m @ Vector(p)) for p in pts], role="WALK")
    return L


def pavilion(g, parts, meshes, helpers, name, cx, cy, zg, kind, lod=False):
    sp = SPECS[kind]
    sh = Shape(kind)
    tile, trim = COLOURS[kind]
    P = sp["P"]
    sub = Geo()
    # the platform (须弥座): marble for 万春亭, stone for the others
    base = ngon(4, sp["base"]) if kind == "square" else sh.ring(sp["base"])
    bkey = "marble" if kind == "square" else "stone"
    prism(sub, base, -0.4, P, bkey, top=True, top_key="paving")
    if not lod:
        lip = ngon(4, sp["base"] + 0.1) if kind == "square" else sh.ring(sp["base"] + 0.1)
        prism(sub, lip, P - 0.18, P, bkey, top=False)
    zf = P
    cols_out = sh.columns(sp["outer"], sp.get("XS_out"))
    cols_in = sh.columns(sp["inner"], sp.get("XS_in"))
    ring_out = ngon(4, sp["outer"]) if kind == "square" else sh.ring(sp["outer"])
    ring_in = ngon(4, sp["inner"]) if kind == "square" else sh.ring(sp["inner"])
    levels = sp["levels"]
    m = T(cx, cy, zg)
    roof = Geo()
    if lod:
        prism(sub, ring_in, zf, zf + levels[-1][0], "plaster", top=False)
    else:
        top_col = levels[0][0]
        for x, y in cols_out:
            cyl(sub, x, y, zf, zf + top_col, 0.2, 0.19, 8, "red", caps=(False, False))
        zin = levels[1][0] if len(levels) > 1 else top_col
        for x, y in cols_in:
            cyl(sub, x, y, zf, zf + zin, 0.22, 0.21, 8, "red", caps=(False, False))
        # the core: lattice doors and windows between the inner columns, doors on the four axes
        doors = {1, 3, 5, 7} if kind != "square" else {1, 4, 7, 10}
        ring_faces(sub, cols_in, zf, zf + top_col - 0.6, "window", off=0.0, doors=doors)
        # beams over the outer columns, the ceiling of the colonnade
        ring_faces(sub, cols_out, zf + top_col - 0.55, zf + top_col, "beam", off=0.12, both=True)
        ring_faces(sub, cols_out, zf + top_col, zf + top_col + 0.2, "plank", off=0.0)
        ceiling_ring(sub, ring_out, ring_in, zf + top_col)
        ring_faces(sub, cols_in, zf + top_col - 0.6, zf + top_col, "beam", off=0.0)
    zprev = None
    for li, (zc, ae, ze, aw, rise) in enumerate(levels):
        ring_c = ring_out if li == 0 else (ring_in if li == 1 else (ngon(4, levels[li - 1][3]) if kind == "square" else sh.ring(levels[li - 1][3])))
        a_col = sp["outer"] if li == 0 else (sp["inner"] if li == 1 else levels[li - 1][3])
        if li > 0 and not lod:
            # the wall of this storey from the skirt below up to the beams, the beams, the bracket band's backing
            wall = ring_c
            ring_faces(sub, wall, zprev, zf + zc - 0.55, "band", off=0.0)
            ring_faces(sub, wall, zf + zc - 0.55, zf + zc, "beam", off=0.03)
            ring_faces(sub, wall, zf + zc, zf + zc + 0.2, "plank", off=0.0)
        if li > 0 and lod:
            ring_faces(sub, ring_c, zprev - 0.3, zf + zc + 0.4, "beam", off=0.0)
        if not lod:
            prism(sub, [(x * 0.97, y * 0.97) for x, y in ring_c], zf + zc + 0.2, zf + ze - 0.25, "plaster", top=False)
            bracket_ring(parts, meshes, f"{name}.l{li}", m, ring_c, zf + zc + 0.15, sp["br"], gap=1.3 if kind == "square" else 1.15)
        last = li == len(levels) - 1
        zb = zf + zc + 0.5
        if kind == "round":
            R = dict(r0=ae, r1=(aw if not last else 0.0), z=zf + ze, H=rise, p=1.5 if last else 1.3, lift=0.3, Vl=1.0)
            if lod:
                prof = [(ae, zf + ze), ((ae + (aw if not last else 0.0)) / 2 + 0.2, zf + ze + rise * 0.45), (aw if not last else 0.05, zf + ze + rise)]
                lathe(roof, prof, 12, "tile")
                ztop = zf + ze + rise
            else:
                ztop = round_roof(roof, R, rows=5 if last else 3, key="tile", pitch=0.48, amp=0.07, trim=0.8, waves=True, spp=2)
                round_eave(roof, R, a_col, zb, key="trim", drop=0.25, segs=32)
        else:
            n = sh.n
            top = (ae - aw) if not last else ae - 0.03
            R = dict(a=ae, z=zf + ze, H=rise, top=top, p=1.45 if last else 1.25, o=0.35, lift=0.35, Lc=min(2.2, 0.5 * ae * math.tan(math.pi / n) + 0.3), Vc=1.3)
            ztop = poly_roof(roof, R, n, a_col, zb, lod=lod, rows=6 if last else 3, pitch=0.48)
        if not last:
            # the ridge round the skirt's top where it meets the next storey's wall (围脊)
            wr = ngon(4, aw + 0.25) if kind == "square" else sh.ring(aw + 0.25)
            prism(roof, wr, ztop - 0.15, ztop + 0.25, "trim")
            zprev = ztop
        else:
            finial(roof, ztop, sp["fin"])
    rekey(roof, {"tile": tile, "trim": trim})
    sub.add(roof, Matrix.Identity(4))
    g.add(sub, m)
    return zg + P


# ---- rectangular halls ------------------------------------------------------------------------------------------------

def hall_body(g, w, d, z0, ze, gates=(), front=True):
    """Red walls, the front in lattice doors and windows between red columns (doorways right through in `gates`), the
    painted beam under the eave (baita.hall_body with several doorways)."""
    zt = z0 + ze
    nb = max(3, int(w / 3.3) | 1)
    xs = [-w / 2 + w * i / nb for i in range(nb + 1)]
    for i in range(nb):
        a, b = xs[i], xs[i + 1]
        if i in gates:
            hw = min(1.6, (b - a) / 2 - 0.3)
            cx = (a + b) / 2
            for sy in (-1, 1):
                yy = sy * (d / 2 + 0.02)
                g.polyn([(cx - hw, yy, z0), (cx + hw, yy, z0), (cx + hw, yy, z0 + 3.4), (cx - hw, yy, z0 + 3.4)], "dark", (0, sy, 0))
                g.polyn([(a, yy, z0 + 3.4), (b, yy, z0 + 3.4), (b, yy, zt - 0.7), (a, yy, zt - 0.7)], "plaster", (0, sy, 0))
                for x0, x1 in ((a, cx - hw), (cx + hw, b)):
                    g.polyn([(x0, yy, z0), (x1, yy, z0), (x1, yy, z0 + 3.4), (x0, yy, z0 + 3.4)], "plaster", (0, sy, 0))
        else:
            reg = "door" if i == nb // 2 and front else "window"
            g.polyn([(a, -d / 2, z0), (b, -d / 2, z0), (b, -d / 2, zt - 0.7), (a, -d / 2, zt - 0.7)], "atlas", (0, -1, 0), uvs=uvs(reg, QUAD))
            g.polyn([(a, d / 2, z0), (b, d / 2, z0), (b, d / 2, zt - 0.7), (a, d / 2, zt - 0.7)], "plaster", (0, 1, 0))
        g.polyn([(a, -d / 2 - 0.06, zt - 0.7), (b, -d / 2 - 0.06, zt - 0.7), (b, -d / 2 - 0.06, zt), (a, -d / 2 - 0.06, zt)], "atlas", (0, -1, 0), uvs=uvs("beam", QUAD))
        g.polyn([(a, d / 2 + 0.06, zt - 0.7), (b, d / 2 + 0.06, zt - 0.7), (b, d / 2 + 0.06, zt), (a, d / 2 + 0.06, zt)], "atlas", (0, 1, 0), uvs=uvs("beam", QUAD))
    for sx in (-1, 1):
        g.polyn([(sx * w / 2, -d / 2, z0), (sx * w / 2, d / 2, z0), (sx * w / 2, d / 2, zt), (sx * w / 2, -d / 2, zt)], "plaster", (sx, 0, 0))
        g.polyn([(sx * (w / 2 + 0.06), -d / 2, zt - 0.7), (sx * (w / 2 + 0.06), d / 2, zt - 0.7), (sx * (w / 2 + 0.06), d / 2, zt), (sx * (w / 2 + 0.06), -d / 2, zt)],
                "atlas", (sx, 0, 0), uvs=uvs("beam", QUAD))
    for x in xs:
        for sy in (-1, 1):
            cyl(g, x, sy * (d / 2 + 0.1), z0, zt - 0.7, 0.22, 0.21, 8, "red", caps=(False, False))
    g.polyn([(-w / 2, -d / 2, zt), (w / 2, -d / 2, zt), (w / 2, d / 2, zt), (-w / 2, d / 2, zt)], "plaster", (0, 0, -1))
    return xs


def hall(g, parts, meshes, name, cx, cy, yaw_deg, w, d, floor, ze, kind="xieshan", key="yellow", trim=None, gates=(), double=None,
         brackets=True, lod=False, rows=5, pitch=0.7):
    """A hall in its own frame (long axis x, front -y) placed at (cx, cy) turned yaw_deg; `double` = the upper storey's
    height for a 重檐 hall (a skirt roof round an upper storey on the inner ring). Returns the placement matrix."""
    m = T(cx, cy, 0) @ Rz(math.radians(yaw_deg))
    sub = Geo()
    roof = Geo()
    tk = trim is not None
    if double:
        z1, z2 = floor + ze, floor + ze + double
        iw, idp = w - 2 * min(2.6, 0.12 * d + 1.0), d - 2 * min(2.6, 0.12 * d + 1.0)
        ov = 1.4 + 0.035 * d
        low = dict(roof=dict(A=w / 2 + ov, D=d / 2 + ov, z=z1 - 0.3, H=min(2.6, 0.2 * d + 0.4), p=1.2, o=0.5, lift=0.5, Lc=3.5, Vc=1.8),
                   beam=(z1 - 1.0, z1 - 0.6, z1 - 0.6, z1))
        h = B.spec(w, d, z2, kind=kind, trim=tk, rows=rows, lower=low, inner=(iw, idp))
        h.PITCH, h.BRACKET_GAP = pitch, 1.8
        if lod:
            sub.box(-w / 2, w / 2, -d / 2, d / 2, floor, z1, "plaster", skip=("-z",))
            sub.box(-iw / 2, iw / 2, -idp / 2, idp / 2, z1, z2, "plaster", skip=("-z",))
            roofs(h, roof, lod=True)
        else:
            hall_body(sub, w, d, floor, ze, gates)
            zu = z1 - 0.3 + low["roof"]["H"]
            nb = max(3, int(iw / 3.3) | 1)
            for i in range(nb):
                a, bb = -iw / 2 + iw * i / nb, -iw / 2 + iw * (i + 1) / nb
                for sy in (-1, 1):
                    sub.polyn([(a, sy * idp / 2, zu), (bb, sy * idp / 2, zu), (bb, sy * idp / 2, z2 - 0.7), (a, sy * idp / 2, z2 - 0.7)], "atlas", (0, sy, 0),
                              uvs=uvs("band", QUAD))
                    sub.polyn([(a, sy * (idp / 2 + 0.06), z2 - 0.7), (bb, sy * (idp / 2 + 0.06), z2 - 0.7), (bb, sy * (idp / 2 + 0.06), z2),
                               (a, sy * (idp / 2 + 0.06), z2)], "atlas", (0, sy, 0), uvs=uvs("beam", QUAD))
            for sx in (-1, 1):
                sub.polyn([(sx * iw / 2, -idp / 2, zu), (sx * iw / 2, idp / 2, zu), (sx * iw / 2, idp / 2, z2), (sx * iw / 2, -idp / 2, z2)], "plaster", (sx, 0, 0))
            roofs(h, roof)
            if brackets:
                for p, yw in bracket_spots(h, True, z1 - 0.62):
                    place(meshes["bracket"], f"{name}.brl", parts, m @ T(*p) @ Rz(yw) @ Matrix.Diagonal((0.72, 0.72, 0.72, 1.0)))
                hin = SimpleNamespace(XS=[-h.IX, h.IX], YS=[-h.IY, h.IY], OX=h.IX, OY=h.IY, BRACKET_GAP=h.BRACKET_GAP)
                for p, yw in bracket_spots(hin, True, z2 - 0.62):
                    place(meshes["bracket"], f"{name}.bru", parts, m @ T(*p) @ Rz(yw) @ Matrix.Diagonal((0.72, 0.72, 0.72, 1.0)))
        ztop = z2 + h.UPPER["H"]
    else:
        h = B.spec(w, d, floor + ze, kind=kind, trim=tk, rows=rows)
        h.PITCH, h.BRACKET_GAP = pitch, 1.8
        if lod:
            sub.box(-w / 2, w / 2, -d / 2, d / 2, floor, floor + ze, "plaster", skip=("-z",))
            roofs(h, roof, lod=True)
        else:
            hall_body(sub, w, d, floor, ze, gates)
            roofs(h, roof)
            if brackets:
                for p, yw in bracket_spots(h, True, floor + ze - 0.62):
                    place(meshes["bracket"], f"{name}.br", parts, m @ T(*p) @ Rz(yw) @ Matrix.Diagonal((0.72, 0.72, 0.72, 1.0)))
        ztop = floor + ze + h.UPPER["H"]
    rekey(roof, {"tile": key, "trim": trim or key})
    sub.add(roof, Matrix.Identity(4))
    if os.environ.get("TRIS"):
        print("  hall", name, "body", sub.tris() - roof.tris(), "roof", roof.tris())
    g.add(sub, m)
    return m, ztop, h


def hall_colliders(helpers, m, w, d, floor, ztop, gates=(), ground=0.0):
    """The body as boxes, doorways left open (with the lintel over them)."""
    yaw = math.atan2(m[1][0], m[0][0])
    nb = max(3, int(w / 3.3) | 1)
    xs = [-w / 2 + w * i / nb for i in range(nb + 1)]
    spans, x = [], -w / 2 - 0.3
    for i in sorted(gates):
        a, b = xs[i], xs[i + 1]
        hw = min(1.6, (b - a) / 2 - 0.3)
        c = (a + b) / 2
        spans.append((x, c - hw))
        x = c + hw
        lc = m @ Vector((c, 0, 0))
        B.collider_obox(helpers, "lintel", lc.x, lc.y, hw, d / 2 + 0.3, floor + 3.4, ztop, yaw)
    spans.append((x, w / 2 + 0.3))
    for x0, x1 in spans:
        if x1 - x0 < 0.05:
            continue
        c = m @ Vector(((x0 + x1) / 2, 0, 0))
        B.collider_obox(helpers, "hall", c.x, c.y, (x1 - x0) / 2, d / 2 + 0.3, ground - 0.3, ztop, yaw)


def platform(g, helpers, m, w, d, z0, z1, key="stone", steps=(), top_key="paving"):
    """A stone platform w x d in the frame m from z0 to z1, flights (side, offset along the side, width) with ramps."""
    sub = Geo()
    sub.box(-w / 2, w / 2, -d / 2, d / 2, z0, z1, key, skip=("-z", "+z"))
    sub.polyn([(-w / 2, -d / 2, z1), (w / 2, -d / 2, z1), (w / 2, d / 2, z1), (-w / 2, d / 2, z1)], top_key, (0, 0, 1))
    sub.box(-w / 2 - 0.08, w / 2 + 0.08, -d / 2 - 0.08, d / 2 + 0.08, z1 - 0.2, z1, key, skip=("-z", "+z"))
    g.add(sub, m)
    yaw = math.atan2(m[1][0], m[0][0])
    c = m @ Vector((0, 0, 0))
    B.collider_obox(helpers, "platform", c.x, c.y, w / 2, d / 2, z0 - 0.3, z1 - 0.03, yaw)
    for side, off, wd in steps:
        # side: 0 south (-y), 1 east, 2 north, 3 west
        phi_l = (-math.pi / 2, 0.0, math.pi / 2, math.pi)[side]
        edge = (d / 2, w / 2, d / 2, w / 2)[side]
        along = Vector((-math.sin(phi_l), math.cos(phi_l))) * off
        pc = m @ Vector((along.x, along.y, 0))
        flight(g, helpers, pc.x, pc.y, phi_l + yaw, wd, z0, z1, edge)


# ---- walls ------------------------------------------------------------------------------------------------------------

def wall(g, helpers, line, closed, h, t, gaps, piece=3.0, coping_key="yellow", key="plaster", far=False):
    """A red wall with a stone foot and a tiled coping along a polyline, left out wherever a piece's middle falls in one
    of the `gaps` polygons; one collider box per run."""
    n = len(line)
    segs = range(n) if closed else range(n - 1)
    runs = 0
    for i in segs:
        a, b = Vector(line[i]), Vector(line[(i + 1) % n])
        L = (b - a).length
        if L < 0.2:
            continue
        k = max(1, math.ceil(L / piece))
        keep = []
        for j in range(k):
            mid = a.lerp(b, (j + 0.5) / k)
            keep.append(not any(inside(mid.x, mid.y, gp) for gp in gaps))
        j = 0
        while j < k:
            if not keep[j]:
                j += 1
                continue
            j0 = j
            while j < k and keep[j]:
                j += 1
            s0, s1 = j0 / k, j / k
            p0, p1 = a.lerp(b, s0), a.lerp(b, s1)
            d = (p1 - p0).normalized()
            # carry the run half a thickness past a corner so the next segment's wall meets it
            if s0 == 0.0:
                p0 = p0 - d * t / 2
            if s1 == 1.0:
                p1 = p1 + d * t / 2
            nrm = Vector((-d.y, d.x)) * (t / 2)
            q = [p0 - nrm, p1 - nrm, p1 + nrm, p0 + nrm]
            sub = [(q[0], q[1], (-nrm.x, -nrm.y)), (q[2], q[3], (nrm.x, nrm.y))]
            for u, v, o in sub:
                g.polyn([(u.x, u.y, 0.0), (v.x, v.y, 0.0), (v.x, v.y, h), (u.x, u.y, h)], key, (o[0], o[1], 0))
                if not far:
                    e = Vector((o[0], o[1])).normalized() * 0.08
                    g.polyn([(u.x + e.x, u.y + e.y, 0.0), (v.x + e.x, v.y + e.y, 0.0), (v.x + e.x, v.y + e.y, 0.55), (u.x + e.x, u.y + e.y, 0.55)], "stone", (o[0], o[1], 0))
            for u, v, o in ((q[1], q[2], d), (q[3], q[0], -d)):
                g.polyn([(u.x, u.y, 0.0), (v.x, v.y, 0.0), (v.x, v.y, h), (u.x, u.y, h)], key, (o[0], o[1], 0))
            coping(g, (p0.x, p0.y), (p1.x, p1.y), t + 0.5, h, rise=0.45, key=coping_key)
            if helpers is not None:
                c = (p0 + p1) / 2
                B.collider_obox(helpers, "wall", c.x, c.y, (p1 - p0).length / 2, t / 2, -0.3, h + 0.4, math.atan2(d.y, d.x))
            runs += 1
    return runs


def brick_gate(g, helpers, cx, cy, yaw_deg, lod=False):
    """寿皇殿's outer gate: a red block with three arched doorways and a yellow 庑殿 roof over it."""
    m = T(cx, cy, 0) @ Rz(math.radians(yaw_deg))
    sub = Geo()
    W, D, Hh = 26.0, 3.4, 6.4
    opens = [(-8.0, 3.2, 3.9), (0.0, 4.0, 4.6), (8.0, 3.2, 3.9)]      # centre, width, crown
    xs = [-W / 2]
    for c, w_, cr in opens:
        xs += [c - w_ / 2, c + w_ / 2]
    xs.append(W / 2)
    piers = [(xs[i], xs[i + 1]) for i in range(0, len(xs), 2)]
    for x0, x1 in piers:
        sub.box(x0, x1, -D / 2, D / 2, 0.0, Hh, "plaster", skip=("-z", "+z"))
    for c, w_, cr in opens:
        r = w_ / 2
        spring = cr - r
        sub.box(c - r, c + r, -D / 2, D / 2, cr, Hh, "plaster", skip=("-z", "+z", "-x", "+x"))
        for sy in (-1, 1):
            yy = sy * (D / 2 + 0.01)
            # the spandrels either side of the arch, the white arch ring
            for side in (-1, 1):
                arc = [(c + side * r * math.cos(math.pi / 2 * i / 6), yy, spring + r * math.sin(math.pi / 2 * i / 6)) for i in range(7)]
                sub.polyn(arc + [(c + side * r, yy, cr)], "plaster", (0, sy, 0))
            ring_o = [(c + (r + 0.35) * math.cos(math.pi * i / 12), yy * 1.001, spring + (r + 0.35) * math.sin(math.pi * i / 12)) for i in range(13)]
            ring_i = [(c + r * math.cos(math.pi * i / 12), yy * 1.001, spring + r * math.sin(math.pi * i / 12)) for i in range(13)]
            for i in range(12):
                sub.polyn([ring_o[i], ring_o[i + 1], ring_i[i + 1], ring_i[i]], "marble", (0, sy, 0))
        # the vault's soffit
        vault = [(c + r * math.cos(math.pi * i / 12), spring + r * math.sin(math.pi * i / 12)) for i in range(13)]
        for i in range(12):
            (xa, za), (xb, zb) = vault[i], vault[i + 1]
            sub.polyn([(xa, -D / 2, za), (xb, -D / 2, zb), (xb, D / 2, zb), (xa, D / 2, za)], "plaster", (c - (xa + xb) / 2, 0, spring - (za + zb) / 2))
    sub.box(-W / 2 - 0.2, W / 2 + 0.2, -D / 2 - 0.2, D / 2 + 0.2, Hh - 0.3, Hh, "stone", skip=("-z",))
    h = B.spec(W, D, Hh + 0.4, kind="wudian", trim=False, rows=4)
    h.PITCH = 0.9
    roof = Geo()
    roofs(h, roof, lod=lod)
    rekey(roof, {"tile": "yellow", "trim": "yellow"})
    sub.add(roof, Matrix.Identity(4))
    g.add(sub, m)
    if helpers is not None:
        yaw = math.radians(yaw_deg)
        for x0, x1 in piers:
            c = m @ Vector(((x0 + x1) / 2, 0, 0))
            B.collider_obox(helpers, "gatepier", c.x, c.y, (x1 - x0) / 2, D / 2, -0.3, Hh + 2.0, yaw)
        for c_, w_, cr in opens:
            c = m @ Vector((c_, 0, 0))
            B.collider_obox(helpers, "gatelintel", c.x, c.y, w_ / 2, D / 2, cr - 0.4, Hh + 2.0, yaw)
    return m


# ---- trees and rocks ----------------------------------------------------------------------------------------------

def place_trees(paths, blocked):
    rng = random.Random(21)
    trees = []
    step = 8.0
    x0, x1 = min(p[0] for p in OUTLINE), max(p[0] for p in OUTLINE)
    y0, y1 = min(p[1] for p in OUTLINE), max(p[1] for p in OUTLINE)
    x = x0
    while x <= x1:
        y = y0
        while y <= y1:
            px, py = x + (rng.random() - 0.5) * step * 0.9, y + (rng.random() - 0.5) * step * 0.9
            y += step
            kind_r, keep_r, _var, s_r, a_r = rng.random(), rng.random(), rng.randrange(2), rng.random(), rng.random()
            if not inside(px, py, OUTLINE) or poly_dist(px, py, OUTLINE) < 3.0:
                continue
            if pad_dist(px, py)[0] < 3.0:
                continue
            if any(q[0] - q[2] <= px <= q[0] + q[2] and q[1] - q[2] <= py <= q[1] + q[2] for q in blocked):
                continue
            near = False
            for p in paths.paths:
                bx0, bx1, by0, by1 = p.box
                if bx0 - 2 <= px <= bx1 + 2 and by0 - 2 <= py <= by1 + 2 and poly_dist(px, py, p.pts, closed=False) < p.hw + 2.2:
                    near = True
                    break
            if near or keep_r > 0.86:
                continue
            h = nat(px, py)
            if h > 30 or kind_r < 0.45:
                kind = "pine"
            elif kind_r < 0.78:
                kind = "cypress"
            else:
                kind = "broad"
            trees.append((f"{kind}0", px, py, 1.0 + 0.5 * s_r, a_r * 6.283))     # one variant a kind: fewer draw calls
        x += step
    return trees


def place_rocks(paths, trees):
    rng = random.Random(33)
    rocks = []
    tries = 0
    while len(rocks) < 45 and tries < 4000:
        tries += 1
        px, py = rng.uniform(-195, 195), rng.uniform(-90, 70)
        if not inside(px, py, OUTLINE) or poly_dist(px, py, OUTLINE) < 5 or pad_dist(px, py)[0] < 2.5:
            continue
        if paths.near(px, py) is not None or any(poly_dist(px, py, p.pts, closed=False) < p.hw + 1.2 for p in paths.paths):
            continue
        rocks.append((rng.randrange(3), px, py, 0.6 + 0.9 * rng.random(), rng.random() * 6.283))
    return rocks


# ---- the build --------------------------------------------------------------------------------------------------------

# the buildings off the hill: (name, x, y, w, d, yaw, floor height, eave height over the floor)
QIWANG = ("绮望楼", -0.2, -101.1, 17.4, 7.8, TILT_S, 1.1, 4.4)
GATE_S = ("景山门", 2.2, -162.1, 21.4, 6.0, TILT_S, 0.45, 5.2)
GATE_E = ("东门", 203.5, 99.2, 15.4, 7.6, 90.0 + 0.5, 0.45, 4.6)
GATE_W = ("西门", -217.0, 79.5, 16.2, 7.8, -90.0 + 0.7, 0.45, 4.6)
SHOUHUANG_GATE = ("寿皇门", -11.7, 261.6, 22.4, 10.5, TILT_N, 1.2, 5.4)
SHOUHUANG = ("寿皇殿", -13.6, 332.0, 45.4, 20.8, TILT_N, 1.8, 7.0)
ERDIAN = [("西耳殿", -49.0, 332.6, 17.0, 12.6, TILT_N, 1.8, 5.0), ("东耳殿", 21.2, 333.8, 16.8, 12.6, TILT_N, 1.8, 5.0)]
PEIDIAN = [("西配殿", -61.2, 283.6, 21.0, 10.2, 90.0 + TILT_N, 0.9, 4.6), ("东配殿", 36.8, 286.1, 21.0, 10.6, -90.0 + TILT_N, 0.9, 4.6)]
STELE = [("西碑亭", -50.8, 309.3), ("东碑亭", 23.3, 311.7)]
ARCHWAYS = [(-10.6, 166.1, TILT_N, "绍闻祗遹"), (9.3, 189.0, 90.0 + TILT_N, "显承无斁"), (-33.9, 189.0, -90.0 + TILT_N, "世德作求")]
BRICK_GATE = (-11.0, 211.0, TILT_N)
FORECOURT = [(-34.5, 210.4), (-33.2, 178.2), (-33.1, 175.9), (-19.1, 167.2), (-10.6, 167.4), (-2.2, 167.3), (9.5, 172.9), (9.1, 185.2), (8.5, 201.7),
             (8.1, 211.5)]              # OSM's paved area 584628611
COURT_Z = 0.12


def mid_gates(w, k):
    nb = max(3, int(w / 3.3) | 1)
    return tuple(range(nb // 2 - k // 2, nb // 2 + k // 2 + 1))


def rect_of(b, m=0.0):
    name, x, y, w, d, yaw = b[:6]
    return rect_pts(x, y, w, d, yaw, m)


def build():
    global FIELD
    clear_file()
    ensure_addon()
    import bcity_landmark
    M = materials()
    main = collection("景山")
    parts = collection("构件", main)
    helpers = collection("碰撞体")
    meshes = dict(bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE), post=mesh_of(B.light_post(), "PostMesh", M, TILE),
                  panel=mesh_of(B.light_panel(), "PanelMesh", M, TILE))
    tris = {}
    FIELD = Field(1.0)
    if os.environ.get("STATS"):
        sl = []
        for y in range(-95, 76, 2):
            for x in range(-200, 201, 2):
                if inside(x, y, OUTLINE):
                    sl.append((math.hypot(nat(x + 0.5, y) - nat(x - 0.5, y), nat(x, y + 0.5) - nat(x, y - 0.5)), x, y))
        steep = sorted(sl, reverse=True)
        print("steepest", [(round(v, 2), x, y, round(pad_dist(x, y)[0], 1), round(FIELD.sample(x, y, FIELD.din), 1)) for v, x, y in steep[:25:2]])
        sl = sorted(v for v, _, _ in sl)
        print("slopes: n", len(sl), "p50 %.2f p90 %.2f p99 %.2f max %.2f  >1.0: %d  >1.19: %d" % (sl[len(sl) // 2], sl[int(len(sl) * 0.9)], sl[int(len(sl) * 0.99)], sl[-1],
              sum(1 for v in sl if v > 1.0), sum(1 for v in sl if v > 1.19)))
        print("peaks", [(p[0], round(nat(p[1], p[2]), 2)) for p in PAVILIONS])
    paths = PathSet(clip_paths())
    tris["paths"] = len(paths.paths)


    # the hill
    blocked = []
    trees = place_trees(paths, blocked)
    rocks = place_rocks(paths, trees)
    hill = build_terrain(3.0, trees, paths)
    hill.build("Hill", collection("山", main), M, TILE)
    hc = hill.build("hill", helpers, {k: None for k in ("earth", "path", "stairs")})
    hc.data.materials.clear()
    bcity_landmark.rename(hc, "COLMESH")
    tris["hill"] = hill.tris()

    g = Geo()
    # the pavilions, their flights, 万春亭's balustrade
    for name, px, py, h, kind in PAVILIONS:
        sp = SPECS[kind]
        pavilion(g, parts, meshes, helpers, name, px, py, h, kind)
        pav_colliders(helpers, None, px, py, h, sp, Shape(kind))
        a_edge = sp["base"] * (0.981 if kind == "round" else 1.0)
        for k in range(4):
            phi = -math.pi / 2 + k * math.pi / 2
            flight(g, helpers, px, py, phi, 3.2 if kind == "square" else 2.2, h, h + sp["P"], a_edge - 0.02, key="marble" if kind == "square" else "stone")
        if kind == "square":
            b = sp["base"] - 0.25
            sq = [(px - b, py - b), (px + b, py - b), (px + b, py + b), (px - b, py + b), (px - b, py - b)]
            z = h + sp["P"]
            skip = [(px - 2.0, px + 2.0, py - b - 1, py + b + 1), (px - b - 1, px + b + 1, py - 2.0, py + 2.0)]
            rail_geo(g, [(x, y, z) for x, y in sq], gap=1.6, skip=skip)
            for (ax, ay), (bx, by) in zip(sq, sq[1:]):
                for s0, s1 in ((0.0, 0.5 - 2.1 / (2 * b)), (0.5 + 2.1 / (2 * b), 1.0)):
                    x0, x1 = sorted((ax + (bx - ax) * s0, ax + (bx - ax) * s1))
                    y0, y1 = sorted((ay + (by - ay) * s0, ay + (by - ay) * s1))
                    collider_box(helpers, "rail", x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, z, z + 1.1)
    tris["pavilions"] = g.tris()

    # 绮望楼 on its platform with a flight to the south; the gates; the park wall
    name, x, y, w, d, yaw, fl, ze = QIWANG
    m, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", double=4.2)
    platform(g, helpers, m, w + 3.6, d + 3.4, 0.0, fl, steps=[(0, 0.0, 4.0)])
    hall_colliders(helpers, m, w, d, fl, ztop, ground=fl)
    gate_rects = []
    for gb, ng in ((GATE_S, 3), (GATE_E, 1), (GATE_W, 1)):
        name, x, y, w, d, yaw, fl, ze = gb
        gates = mid_gates(w, ng)
        m, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", gates=gates, rows=5 if gb is GATE_S else 4,
                          brackets=gb is GATE_S, pitch=0.7 if gb is GATE_S else 1.0)
        platform(g, helpers, m, w + 1.6, d + 1.6, 0.0, fl, steps=[])
        hall_colliders(helpers, m, w, d, fl, ztop, gates=gates, ground=fl)
        # a walk-only wedge up onto the plinth through each doorway, front and back
        nb = max(3, int(w / 3.3) | 1)
        xs = [-w / 2 + w * i / nb for i in range(nb + 1)]
        for i in gates:
            c = (xs[i] + xs[i + 1]) / 2
            hw = min(1.6, (xs[i + 1] - xs[i]) / 2 - 0.3)
            for sy in (-1, 1):
                y0_, y1_ = sy * (d / 2 + 0.8 + 1.4), sy * (d / 2 + 0.8)
                pts = [(x_, y_, z_) for x_ in (c - hw, c + hw) for y_, z_ in ((y0_, -0.05), (y1_, fl), (y1_, -0.3))]
                collider_pts(helpers, "gatestep", [tuple(m @ Vector(p_)) for p_ in pts], role="WALK")
        gate_rects.append(rect_of(gb, 2.5))
    # the park wall: open at the gates and where the service road comes in on the north
    service_gap = [(148.0, 360.0), (161.0, 360.0), (161.0, 375.0), (148.0, 375.0)]
    tk = g.tris()
    nw = wall(g, helpers, PARK, True, 4.6, 1.1, gate_rects + [service_gap])
    if os.environ.get("TRIS"):
        print("  park wall", g.tris() - tk)
    tris["south"] = g.tris() - tris["pavilions"]

    # 寿皇殿: platform, hall, 耳殿, gate, side halls, stele pavilions, walls, the brick gate and the archways
    t0 = g.tris()
    name, x, y, w, d, yaw, fl, ze = SHOUHUANG
    m_sh, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="wudian", key="yellow", double=4.8, rows=7, pitch=0.75)
    platform(g, helpers, m_sh, w + 4.6, d + 4.0, 0.0, fl, steps=[])
    hall_colliders(helpers, m_sh, w, d, fl, ztop, ground=fl)
    # the 月台 in front: a lower terrace with three flights
    yt = T(0, -(d + 4.0) / 2 - 6.0, 0)
    platform(g, helpers, m_sh @ yt, 30.0, 12.0, 0.0, fl - 0.15, steps=[(0, 0.0, 6.0), (1, 0.0, 3.5), (3, 0.0, 3.5)])
    for eb in ERDIAN:
        name, x, y, w, d, yaw, fl, ze = eb
        m, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", rows=4, brackets=False, pitch=1.0)
        platform(g, helpers, m, w + 2.0, d + 2.0, 0.0, fl, steps=[(0, 0.0, 3.0)])
        hall_colliders(helpers, m, w, d, fl, ztop, ground=fl)
    name, x, y, w, d, yaw, fl, ze = SHOUHUANG_GATE
    gates = mid_gates(w, 3)
    m, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", gates=gates, rows=5)
    platform(g, helpers, m, w + 2.4, d + 2.4, 0.0, fl, steps=[(0, 0.0, 12.0), (2, 0.0, 12.0)])
    hall_colliders(helpers, m, w, d, fl, ztop, gates=gates, ground=fl)
    for pb in PEIDIAN:
        name, x, y, w, d, yaw, fl, ze = pb
        m, ztop, _ = hall(g, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", rows=4, brackets=False, pitch=1.0)
        platform(g, helpers, m, w + 2.0, d + 2.0, 0.0, fl, steps=[(0, 0.0, 3.0)])
        hall_colliders(helpers, m, w, d, fl, ztop, ground=fl)
    tk = g.tris()
    for name, x, y in STELE:
        stele_pavilion(g, parts, meshes, helpers, name, x, y)
    if os.environ.get("TRIS"):
        print("  stele", g.tris() - tk)
    tk = g.tris()
    brick_gate(g, helpers, *BRICK_GATE)
    if os.environ.get("TRIS"):
        print("  brick gate", g.tris() - tk)
    tk = g.tris()
    for i, (x, y, yaw, text) in enumerate(ARCHWAYS):
        cols = archway(g, parts, M, x, y, math.radians(yaw), text, f"arch{i}")
        for c in cols:
            collider_box(helpers, "archcol", c.x - 0.5, c.x + 0.5, c.y - 0.5, c.y + 0.5, 0.0, 7.0)
    if os.environ.get("TRIS"):
        print("  archways", g.tris() - tk)
    bld_gaps = [rect_of(b, 1.2) for b in [SHOUHUANG, SHOUHUANG_GATE] + ERDIAN]
    bg_gap = [rect_pts(BRICK_GATE[0], BRICK_GATE[1], 26.4, 4.0, BRICK_GATE[2])]
    nw += wall(g, helpers, OUTER_WALL, False, 4.2, 1.0, bg_gap)
    nw += wall(g, helpers, INNER_WALL, False, 4.0, 0.9, bld_gaps)
    # the paved courts: inside the inner wall, and the forecourt with the archways
    for poly in (INNER_WALL[:-1], FORECOURT):
        g.polyn([(x, y, COURT_Z) for x, y in poly], "path", (0, 0, 1))
        collider_pts(helpers, "court", [(x, y, -0.3) for x, y in poly] + [(x, y, COURT_Z - 0.02) for x, y in poly])
    tris["shouhuang"] = g.tris() - t0
    tris["all"] = g.tris()
    g.build("Buildings", collection("建筑", main), M, TILE)

    # plaques
    plaque(parts, M, "景山门", GATE_S, 2.6)
    plaque(parts, M, "寿皇殿", SHOUHUANG, 3.2)

    # trees and rocks as linked meshes, a trunk collider each
    tg, tfar = B.tree_geos()
    tmesh = {k: mesh_of(v, f"Tree_{k}", M, TILE) for k, v in tg.items()}
    tcoll = collection("树", main)
    ub = Geo()
    ub.box(-1, 1, -1, 1, -1, 1, "x")
    unit_box = ub.build("unitbox", helpers, {"x": None}).data
    unit_box.materials.clear()
    bpy.data.objects.remove(helpers.objects["unitbox"])
    for i, (k, x, y, s, a) in enumerate(trees):
        z = nat(x, y) - 0.15
        place(tmesh[k], f"tree.{i:03d}", tcoll, T(x, y, z) @ Rz(a) @ Matrix.Diagonal((s, s, s, 1.0)))
        o = bpy.data.objects.new("trunk", unit_box)
        helpers.objects.link(o)
        o.matrix_world = T(x, y, z) @ Matrix.Diagonal((0.3, 0.3, 1.5, 1.0)) @ T(0, 0, 1)
        bcity_landmark.rename(o, "COL")
    # the rocks baked in the ground's material (vertex coloured): they share its draw call
    rg = [rekey(v, {"foliage": "earth"}) for v in B.rock_geos()]
    rocks_g = Geo(colors=True)
    for i, (k, x, y, s, a) in enumerate(rocks):
        z = nat(x, y) - 0.35 * s
        rocks_g.add(rg[k], T(x, y, z) @ Rz(a) @ Matrix.Diagonal((s, s, s * 0.8, 1.0)))
    rocks_g.build("Rocks", tcoll, M, TILE)

    # ---- far level
    far = build_terrain(9.0, trees)
    for name, px, py, h, kind in PAVILIONS:
        pavilion(far, parts, meshes, None, name, px, py, h, kind, lod=True)
    for gb in (QIWANG,):
        name, x, y, w, d, yaw, fl, ze = gb
        hall(far, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", double=4.2, lod=True)
    for gb in (GATE_S, GATE_E, GATE_W, SHOUHUANG_GATE) + tuple(ERDIAN) + tuple(PEIDIAN):
        name, x, y, w, d, yaw, fl, ze = gb
        hall(far, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="xieshan", key="yellow", lod=True)
    name, x, y, w, d, yaw, fl, ze = SHOUHUANG
    hall(far, parts, meshes, name, x, y, yaw, w, d, fl, ze, kind="wudian", key="yellow", double=4.8, lod=True)
    wall(far, None, PARK, True, 4.6, 1.1, gate_rects + [service_gap], piece=6.0, far=True)
    wall(far, None, OUTER_WALL, False, 4.2, 1.0, bg_gap, piece=6.0, far=True)
    wall(far, None, INNER_WALL, False, 4.0, 0.9, bld_gaps, piece=6.0, far=True)
    fcoll = collection("LOD1", main)
    far.build("Massing", fcoll, M, TILE)
    fmesh = mesh_of(tfar, "TreeFar", M, TILE)
    for i, (k, x, y, s, a) in enumerate(trees):
        m_ = Matrix.Diagonal((s * 0.7, s * 0.7, s * 1.1, 1.0)) if k.startswith("cypress") else Matrix.Diagonal((s, s, s * 0.85, 1.0))
        place(fmesh, f"treefar.{i:03d}", fcoll, T(x, y, nat(x, y) - 0.2) @ Rz(a) @ m_)
    tris["far"] = far.tris()

    # footprints: the hill, and each building replaced; clear zones: the hill, the buildings' plots, the walls' line
    flat_marker(helpers, "hill", OUTLINE, "FOOTPRINT")
    for b in [QIWANG, GATE_S, GATE_E, GATE_W, SHOUHUANG, SHOUHUANG_GATE] + ERDIAN + PEIDIAN:
        flat_marker(helpers, b[0], rect_of(b, 1.5), "FOOTPRINT")
    for name, x, y in STELE:
        flat_marker(helpers, name, rect_pts(x, y, 11.5, 12.0, 0.0), "FOOTPRINT")
    flat_marker(helpers, "archway_s", rect_pts(ARCHWAYS[0][0], ARCHWAYS[0][1], 18.0, 4.0, ARCHWAYS[0][2]), "FOOTPRINT")
    flat_marker(helpers, "hill", OUTLINE, "CLEAR")
    flat_marker(helpers, "qiwang_court", rect_pts(-0.2, -103.0, 26.0, 20.0, TILT_S), "CLEAR")
    flat_marker(helpers, "inner_court", [p for p in INNER_WALL[:-1]], "CLEAR")
    flat_marker(helpers, "forecourt", FORECOURT, "CLEAR")
    for b in [GATE_S, GATE_E, GATE_W] + PEIDIAN:
        flat_marker(helpers, b[0], rect_of(b, 3.0), "CLEAR")
    for line, closed in ((PARK, True), (OUTER_WALL, False)):
        n = len(line)
        for i in range(n if closed else n - 1):
            a, b = Vector(line[i]), Vector(line[(i + 1) % n])
            if (b - a).length < 0.5:
                continue
            d = (b - a).normalized()
            nrm = Vector((-d.y, d.x)) * 2.0
            a2, b2 = a - d * 1.5, b + d * 1.5
            flat_marker(helpers, "wallstrip", [tuple(a2 - nrm), tuple(b2 - nrm), tuple(b2 + nrm), tuple(a2 + nrm)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "jingshan", "景山", "Jingshan"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -604.4, -1636.6, 0.0
    s.far_distance = 600
    s.repo_path = REPO
    tris.update(trees=len(trees), rocks=len(rocks), wall_runs=nw)
    return tris


def archway(g, parts, M, cx, cy, yaw, text, tag):
    """A 三间四柱三楼 archway (baita.archway with coarser tile rows): four red columns in stone clamps, painted beams,
    three small 庑殿 roofs, the plaque. Returns the columns' world positions."""
    from pailou import bay_spec, plaque_text
    cols = [-6.4, -2.4, 2.4, 6.4]
    bays = [(-6.4, -2.4, 5.0, 6.4), (-2.4, 2.4, 5.9, 7.5), (2.4, 6.4, 5.0, 6.4)]
    m = T(cx, cy, 0) @ Rz(yaw)
    sub = Geo()
    for i, (x0, x1, zb, ze) in enumerate(bays):
        h = bay_spec(x0, x1, zb, ze, i == 1)
        h.ROWS, h.END_ROWS, h.PITCH = 4, 3, 0.9
        bg = Geo()
        Lb = x1 - x0 - 0.6
        for za, zc, reg in ((zb - 0.55, zb, "beam"), (zb - 1.05, zb - 0.55, "plank"), (zb - 1.5, zb - 1.05, "beam")):
            for side in (-1, 1):
                bg.polyn([(-Lb / 2, side * 0.28, za), (Lb / 2, side * 0.28, za), (Lb / 2, side * 0.28, zc), (-Lb / 2, side * 0.28, zc)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
        bg.box(-Lb / 2 - 0.3, Lb / 2 + 0.3, -0.22, 0.22, zb, zb + 0.5, "plaster")
        rf = Geo()
        roofs(h, rf)
        rekey(rf, {"tile": "yellow", "trim": "yellow"})
        bg.add(rf, Matrix.Identity(4))
        if i == 1:
            for side in (-1, 1):
                bg.polyn([(-1.3, side * 0.3, zb - 2.6), (1.3, side * 0.3, zb - 2.6), (1.3, side * 0.3, zb - 1.6), (-1.3, side * 0.3, zb - 1.6)], "board", (0, side, 0))
            bg.box(-1.42, 1.42, -0.29, 0.29, zb - 2.72, zb - 1.5, "gold")
        sub.add(bg, T((x0 + x1) / 2, 0, 0))
    for x in cols:
        sub.box(x - 0.5, x + 0.5, -0.5, 0.5, 0.0, 1.6, "stone", skip=("-z",))
        cyl(sub, x, 0, 1.6, 6.3, 0.3, 0.28, 10, "red", caps=(False, True))
    g.add(sub, m)
    for side in (-1, 1):
        mz = bays[1][2] - 2.1
        tmp = collection(f"{tag}{side}", parts)
        plaque_text(tmp, M, text, 0.0, side * 0.3, mz, 2.6, 1.0, side, f"{tag}.plaque{side:+d}")
        for o in tmp.objects:
            o.matrix_world = m @ o.matrix_world
    return [(m @ Vector((x, 0, 0))) for x in cols]


def stele_pavilion(g, parts, meshes, helpers, name, cx, cy):
    """碑亭: an octagonal double-eaved pavilion in yellow glaze, walled in red with a door on each axis, on a platform."""
    sub = Geo()
    kind = "oct"
    sh = Shape(kind)
    base = sh.ring(5.4)
    prism(sub, base, -0.3, 0.9, "stone", top=True, top_key="paving")
    ring = sh.ring(3.9)
    prism(sub, ring, 0.9, 4.3, "plaster", top=False)
    for k in range(0, 8, 2):
        a, b = Vector(ring[k]), Vector(ring[(k + 1) % 8])
        mid = (a + b) / 2
        out = mid.normalized()
        tng = (b - a).normalized()
        p0, p1 = mid - tng * 0.9 + out * 0.02, mid + tng * 0.9 + out * 0.02
        sub.polyn([(p0.x, p0.y, 0.9), (p1.x, p1.y, 0.9), (p1.x, p1.y, 3.3), (p0.x, p0.y, 3.3)], "atlas", (out.x, out.y, 0), uvs=uvs("gatedoor", QUAD))
    ring_faces(sub, ring, 3.75, 4.3, "beam", off=0.05)
    roof = Geo()
    R1 = dict(a=5.3, z=5.2, H=1.4, top=5.3 - 2.5, p=1.25, o=0.35, lift=0.35, Lc=1.8, Vc=1.3)
    z1 = poly_roof(roof, R1, 8, 3.6, 4.6, rows=3, pitch=0.8)
    wr = sh.ring(2.75)
    prism(roof, wr, z1 - 0.15, z1 + 0.25, "trim")
    ring2 = sh.ring(2.5)
    prism(sub, ring2, z1 - 0.2, z1 + 1.6, "plaster", top=False)
    ring_faces(sub, ring2, z1 + 1.0, z1 + 1.6, "beam", off=0.05)
    R2 = dict(a=3.8, z=z1 + 2.2, H=2.5, top=3.77, p=1.45, o=0.35, lift=0.35, Lc=1.4, Vc=1.2)
    zt = poly_roof(roof, R2, 8, 2.5, z1 + 1.9, rows=4, pitch=0.8)
    finial(roof, zt, 0.8)
    rekey(roof, {"tile": "yellow", "trim": "yellow"})
    sub.add(roof, Matrix.Identity(4))
    m = T(cx, cy, 0)
    g.add(sub, m)
    bracket_ring(parts, meshes, name, m, ring, 4.35, 0.55, gap=1.4)
    collider_pts(helpers, "stele", [(cx + x, cy + y, -0.3) for x, y in base] + [(cx + x, cy + y, 0.87) for x, y in base])
    collider_pts(helpers, "stele", [(cx + x, cy + y, 0.9) for x, y in ring] + [(cx + x, cy + y, 5.0) for x, y in ring])
    for k in range(4):
        flight(g, helpers, cx, cy, -math.pi / 2 + k * math.pi / 2, 2.0, 0.0, 0.9, 5.38)


def plaque(parts, M, text, b, width):
    """A blue board with gilt characters on the hall's front under the eave."""
    from pailou import plaque_text
    name, x, y, w, d, yaw, fl, ze = b
    m = T(x, y, 0) @ Rz(math.radians(yaw))
    g = Geo()
    z = fl + ze - 0.9
    g.box(-width / 2, width / 2, -d / 2 - 0.35, -d / 2 - 0.1, z - 0.6, z + 0.6, "board")
    g.box(-width / 2 - 0.1, width / 2 + 0.1, -d / 2 - 0.32, -d / 2 - 0.12, z - 0.7, z + 0.7, "gold", skip=("-y",))
    tmp = collection(f"plaque_{name}", parts)
    plaque_text(tmp, M, text, 0.0, -d / 2 - 0.36, z, width, 1.2, -1, f"{name}.plaque")
    for o in tmp.objects:
        o.matrix_world = m @ o.matrix_world
    o = g.build(f"{name}_board", tmp, M, TILE)
    o.matrix_world = m


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
