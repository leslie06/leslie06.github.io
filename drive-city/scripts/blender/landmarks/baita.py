# 北海白塔 and 琼华岛: the White Dagoba on the island hill in 北海, built in Blender, marked with the bcity_landmark
# add-on's conventions. The city is a flat plane and drew 琼华岛 flat (OSM has the island as the inner ring of the
# lake, relation 5451458, and the buildings on it), with a 29 m block of flats where the 延楼 corridor runs.
#
#   blender -b -P scripts/blender/landmarks/baita.py -- [--out art/landmarks/baita.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the dagoba's centre, game (-1243.5, -1735.7),
# heading 0 (the temple's axis runs due north, as OSM's outlines do). What is modelled:
#   - the hill: a heightfield over the island's OSM shore (way 9487828), 30.5 m at the summit (the island hill is
#     32.8 m over the lake; the water is the city's ground), falling steeply to the north and in the temple's
#     terraces to the south, a flat promenade round the shore behind a stone revetment; wooded (my own trees:
#     the city's park trees would stand at y 0 inside the hill, so a CLEAR_ zone takes them) with rockwork;
#   - 永安寺 climbing the south slope on the axis: the forecourt and 山门, 法轮殿's court, a flight of 37 steps to
#     the landing with 引胜亭 and 涤蔼亭, 55 steps to 正觉殿 and the court of 普安殿 with its side halls, 70 steps
#     to 善因殿 (上圆下方: a square glazed hall under a round 攒尖, walls of glazed Buddha tiles) and two small
#     flights either side of it up to the dagoba's walled platform (OSM's steps, halls and walls give the plan);
#   - the White Dagoba (from published figures: 35.9 m, a 折角 sumeru 17 m square, three round tiers, the bulb
#     14 m across with the red 眼光门 on its south face, a neck sumeru, the 十三天 spire, the gilt 华盖 with bells,
#     the sun, moon and flaming pearl);
#   - every other building OSM has on the island, each on its own pad on the slope (悦心殿, 庆霄楼, 智珠殿,
#     阅古楼 as a two-storey ring, the halls to the west and east), and on the north shore the 延楼 - the
#     two-storey corridor along the water with its marble balustrade - and 漪澜堂 behind it;
#   - 永安桥 from the south shore (OSM way 178750479, with its kink), a humped stone bridge with three arches and
#     marble balustrades, and the 堆云 and 积翠 archways at its ends.

import math
import os
import random
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export, srgb  # noqa: E402
from kit import (QUAD, Canvas, Geo, T, Rz, balustrade, collider_box, collider_pts, cyl, ell, flat_marker, lathe,  # noqa: E402
                 mesh_of, panel_geo, place, post_geo)
from hall import bracket_geo, bracket_spots, eave_edge, roof_face, roofs, soffit, sweep, uvs  # noqa: E402
from round import round_eave, round_roof  # noqa: E402
from zhengyangmen import TILE as ZTILE, make_materials  # noqa: E402
from pailou import bay_spec, plaque_text  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector, geometry  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "baita.blend")

# ---- the island (OSM, local metres) ---------------------------------------------------------------------------------
SHORE = [(-139.7, 19.9), (-139.6, -16.5), (-134.2, -53.0), (-121.7, -118.8), (-94.6, -178.2), (-66.0, -193.6), (-45.9, -193.6),
         (-28.6, -182.5), (-8.2, -181.9), (-2.4, -188.8), (3.5, -188.5), (9.1, -183.3), (32.0, -183.9), (54.5, -191.1), (72.6, -182.9),
         (91.4, -164.3), (114.1, -83.9), (112.3, -38.0), (103.9, 30.9), (71.9, 91.2), (49.1, 111.3), (37.8, 116.6), (-3.9, 115.1),
         (-4.3, 118.6), (-10.6, 118.7), (-26.3, 118.1), (-42.5, 117.8), (-51.7, 117.0), (-51.0, 111.7), (-73.6, 108.6), (-91.9, 95.1),
         (-102.8, 75.1), (-109.5, 58.0), (-118.1, 45.5)]
YANLOU = [(-95.1, 73.8), (-93.1, 81.2), (-89.9, 87.3), (-81.3, 96.6), (-73.1, 103.4), (-67.9, 106.4), (-62.4, 107.7), (34.1, 111.2),
          (44.4, 107.1), (62.2, 93.1), (68.8, 83.0)]
YUEGU = [(-98.2, 30.7), (-101.9, 37.1), (-99.6, 49.7), (-92.7, 56.5), (-83.3, 58.4), (-72.1, 53.1), (-85.6, 25.2)]
BRIDGE = [(-12.6, -259.0), (-12.5, -256.3), (-11.7, -239.6), (0.0, -205.4), (0.0, -186.1), (0.0, -180.6)]

SHORE_Z = 0.6          # the promenade and the top of the revetment over the lake (the city's ground)
PEAK = 30.5            # the dagoba's platform
DECK_W = 8.0


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


def seg_dist(px, py, a, b):
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    L2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def poly_dist(px, py, pts, closed=True):
    n = len(pts)
    segs = range(n) if closed else range(n - 1)
    return min(seg_dist(px, py, pts[i], pts[(i + 1) % n]) for i in segs)


def ray_shore(th):
    dx, dy = math.cos(th), math.sin(th)
    best = 1e9
    n = len(SHORE)
    for i in range(n):
        (ax, ay), (bx, by) = SHORE[i], SHORE[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-9:
            continue
        s = (ax * ey - ay * ex) / den
        t = (ax * dy - ay * dx) / den
        if s > 0 and 0 <= t <= 1:
            best = min(best, s)
    return best


RN = 1440
RS = [ray_shore(2 * math.pi * i / RN) for i in range(RN)]


def shore_r(th):
    f = (th % (2 * math.pi)) / (2 * math.pi) * RN
    i = int(f)
    t = f - i
    return RS[i % RN] * (1 - t) + RS[(i + 1) % RN] * t


# the south slope follows the temple's terraces: height along the axis, by y
PROFILE = [(-200, 0.6), (-181, 0.6), (-165, 0.9), (-150, 1.4), (-126, 1.8), (-108, 6.6), (-98, 7.6), (-86, 13.6), (-44, 16.5),
           (-20, 25.8), (-11, 29.2), (0, 30.5), (10, 30.5)]
NOISE = [(62, 1.0, 0.3, 1.1), (37, 0.75, 2.1, 0.4), (21, 0.5, 4.0, 2.5), (12, 0.28, 1.3, 5.1), (6.5, 0.14, 3.3, 0.7)]


def profile(y):
    for (y0, z0), (y1, z1) in zip(PROFILE, PROFILE[1:]):
        if y <= y1:
            return z0 + (z1 - z0) * max(0.0, (y - y0) / (y1 - y0))
    return PROFILE[-1][1]


def noise(x, y):
    s = 0.0
    for L, a, ang, ph in NOISE:
        k = 2 * math.pi / L
        s += a * math.sin(k * (x * math.cos(ang) + y * math.sin(ang)) + ph) * math.cos(k * 0.7 * (x * math.sin(ang) - y * math.cos(ang)) + ph * 1.7)
    return s


def radial_u(x, y):
    r = math.hypot(x, y)
    return r / shore_r(math.atan2(y, x)) if r > 1e-6 else 0.0


def nat(x, y):
    """The hill without its terraces: a concave cone over the shore, flat promenade round the edge."""
    u = radial_u(x, y)
    up = min(1.0, max(0.0, u - 0.12) / 0.88)
    g = (1 - up) ** 2.2 * (1 - smooth(0.80, 0.93, u))
    h = SHORE_Z + (PEAK - SHORE_Z) * g
    w = math.exp(-(x / 34.0) ** 2) * smooth(12, -4, y)
    h = h * (1 - w) + profile(y) * w
    amp = 1.9 * math.sin(math.pi * min(u, 1.0)) ** 0.8 * (1 - smooth(0.8, 0.93, u)) * (1 - 0.75 * w)
    h += noise(x, y) * amp
    # the summit: the ground rises to just under the dagoba's platform, so it stands on the hilltop, not on a tower
    dx, dy = max(0.0, abs(x) - 15.5), max(0.0, -10.5 - y, y - 20.5)
    h = max(h, PEAK - 0.9 - 0.42 * math.hypot(dx, dy) - 0.004 * (dx * dx + dy * dy))
    return max(SHORE_Z, h)


# ---- terraces, flights and building pads ---------------------------------------------------------------------------

class F:
    """A rectangle cut into or built out of the hill: a level terrace, or a flight rising along +Y from z0 to z1."""
    def __init__(s, name, x0, x1, y0, y1, z0, z1=None, parapet=False, pad=False):
        s.name, s.x0, s.x1, s.y0, s.y1, s.z0 = name, x0, x1, y0, y1, z0
        s.z1 = z0 if z1 is None else z1
        s.flight = z1 is not None
        s.parapet, s.pad = parapet, pad

    def contains(s, x, y, m=0.0):
        return s.x0 - m <= x <= s.x1 + m and s.y0 - m <= y <= s.y1 + m

    def surf(s, x, y):
        if not s.flight:
            return s.z0
        return s.z0 + (s.z1 - s.z0) * min(1.0, max(0.0, (y - s.y0) / (s.y1 - s.y0)))


FEATS = [
    F("court", -20, 20, -181, -163, 0.9),
    F("stepsT1", -4, 4, -165, -163, 0.9, 1.5),
    F("T1", -24, 24, -163, -124, 1.5, parapet=True),
    F("flightA", -2.6, 2.6, -124, -109, 1.5, 7.0),
    F("landing", -16, 16, -109, -97, 7.0, parapet=True),
    F("flightB", -2.6, 2.6, -97, -85.0, 7.0, 15.0),
    F("T3", -20, 20, -85.0, -43.5, 15.0, parapet=True),
    F("flightC", -2.6, 2.6, -43.5, -20.0, 15.0, 26.5),
    F("T4", -9.5, 9.5, -20.0, -10.5, 26.5, parapet=True),
    F("flightDE", 5.9, 8.9, -18.2, -10.5, 26.5, 30.5),
    F("flightDW", -8.9, -5.9, -18.2, -10.5, 26.5, 30.5),
    F("T5", -15.5, 15.5, -10.5, 20.5, PEAK, parapet=True),
    F("northcourt", -58, 24, 78, 101, 0.9),
]
TEMPLE = list(FEATS)

# (name, x, y, length, depth, yaw of the front (deg; 0 faces south), style, eave height over the floor)
BUILDINGS = [
    ("山门", 0.0, -157.7, 10.2, 5.8, 0, "hall", 4.2),
    ("法轮殿", 0.0, -133.4, 15.6, 10.9, 0, "main", 5.4),
    ("正觉殿", 0.0, -78.1, 9.9, 6.9, 0, "hall", 4.6),
    ("普安殿", 0.0, -50.4, 18.1, 10.0, 0, "main", 5.4),
    ("圣果殿", 12.7, -62.8, 11.4, 7.4, -90, "plain", 4.0),
    ("宗镜殿", -13.4, -62.9, 11.0, 7.4, 90, "plain", 4.0),
    ("西配房", -14.3, -74.6, 12.5, 5.6, 90, "plain", 3.5),
    ("西耳房", -8.7, -78.4, 5.6, 4.9, 0, "plain", 3.2),
    ("东配房", 13.0, -74.5, 12.1, 5.4, -90, "plain", 3.5),
    ("东耳房", 7.1, -78.2, 6.4, 4.6, 0, "plain", 3.2),
    ("西厢", -12.9, -49.5, 8.0, 7.1, 90, "plain", 3.4),
    ("东厢", 12.3, -49.1, 8.1, 7.3, -90, "plain", 3.4),
    ("钟楼", -17.0, -148.0, 5.4, 5.4, 90, "plain", 5.6),
    ("鼓楼", 17.0, -148.0, 5.4, 5.4, -90, "plain", 5.6),
    ("小殿西", -18.5, -88.5, 5.5, 4.1, 0, "plain", 3.2),
    ("小殿东", 19.0, -88.5, 5.6, 4.2, 0, "plain", 3.2),
    ("塔北殿", -1.1, 29.0, 18.9, 4.7, 180, "plain", 3.6),
    ("庆霄楼", -61.7, -29.5, 21.6, 10.9, 1.9, "tower", 4.2),
    ("悦心殿", -61.6, -57.2, 19.1, 11.0, 2.7, "main", 5.2),
    ("西殿一", -89.6, -6.7, 10.8, 9.8, 91.6, "plain", 3.8),
    ("西殿二", -118.6, -40.7, 10.8, 9.8, 91.6, "plain", 3.8),
    ("西殿三", -125.3, -5.5, 10.9, 9.8, 92.1, "plain", 3.8),
    ("西殿四", -102.6, -3.6, 10.8, 9.9, 91.6, "plain", 3.8),
    ("南岸西", -51.2, -182.6, 18.9, 7.7, 0.9, "plain", 3.6),
    ("南岸东", 54.6, -181.9, 17.8, 6.7, 1.6, "plain", 3.6),
    ("南岸一", -48.4, -148.5, 13.5, 5.9, -15.5, "plain", 3.4),
    ("南岸二", -68.7, -143.3, 11.8, 4.7, -14.3, "plain", 3.2),
    ("东岸一", 79.6, -154.8, 15.7, 8.3, 84.5, "plain", 3.6),
    ("东岸二", 91.3, -138.8, 15.0, 6.9, 71.3, "plain", 3.4),
    ("接待室", -28.3, -65.6, 16.3, 7.0, 1.1, "plain", 3.6),
    ("静憩轩", -28.8, -50.2, 12.3, 8.8, 1.4, "plain", 3.8),
    ("东院", 27.2, -65.0, 16.1, 7.9, 0.4, "plain", 3.6),
    ("东亭殿", 57.6, -59.9, 8.3, 8.3, 90, "plain", 3.6),
    ("东坡房", 79.4, 3.2, 13.7, 4.0, 91.3, "plain", 3.2),
    ("智珠殿", 64.3, 1.9, 11.1, 8.7, 94.1, "hall", 4.4),
    ("北坡殿", 30.6, 48.8, 25.0, 10.8, 176.8, "plain", 3.8),
    ("漪澜堂", -12.0, 90.0, 24.0, 11.0, 180, "main", 5.4),
    ("码头", -33.3, 114.2, 32.0, 5.0, 181.3, "plain", 3.2),
]
PAVILIONS = [("涤蔼亭", -12.6, -102.9, 2.9), ("引胜亭", 10.4, -102.1, 2.9), ("六角亭", -34.9, -86.5, 3.3)]
SHANYIN = (0.0, -14.3)


def corners(cx, cy, w, d, yaw_deg, m=0.0):
    a = math.radians(yaw_deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        u, v = sx * (w / 2 + m), sy * (d / 2 + m)
        out.append((cx + u * ca - v * sa, cy + u * sa + v * ca))
    return out


def aabb(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), max(xs), min(ys), max(ys)


def on_temple(x, y):
    for f in TEMPLE:
        if not f.flight and f.contains(x, y):
            return f
    return None


def add_pads():
    """Every building off the temple's terraces stands on a pad cut into the slope at its centre's height."""
    floors = {}
    for b in BUILDINGS:
        name, cx, cy, w, d, yaw = b[:6]
        f = on_temple(cx, cy)
        if f:
            floors[name] = f.z0
            continue
        x0, x1, y0, y1 = aabb(corners(cx, cy, w, d, yaw, 0.9))
        z = round(nat(cx, cy) + 0.3, 2)
        FEATS.append(F("pad " + name, x0, x1, y0, y1, z, pad=True))
        floors[name] = z
    for name, cx, cy, r in PAVILIONS:
        f = on_temple(cx, cy)
        if f:
            floors[name] = f.z0
            continue
        z = round(nat(cx, cy) + 0.3, 2)
        FEATS.append(F("pad " + name, cx - r - 1.0, cx + r + 1.0, cy - r - 1.0, cy + r + 1.0, z, pad=True))
        floors[name] = z
    # 阅古楼's court
    x0, x1, y0, y1 = aabb(YUEGU)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    z = round(max(nat(x, y) for x, y in YUEGU) + 0.2, 2)
    FEATS.append(F("pad 阅古楼", x0 - 0.8, x1 + 0.8, y0 - 0.8, y1 + 0.8, z, pad=True))
    floors["阅古楼"] = z
    return floors


def terrain(x, y):
    h = nat(x, y)
    for f in FEATS:
        if f.contains(x, y):
            h = min(h, f.surf(x, y) - 0.3)
    return h


def neighbour(x, y, me):
    """What is beside a feature's edge: another feature's surface (the highest), or the hill."""
    best = None
    for f in FEATS:
        if f is not me and f.contains(x, y):
            v = f.surf(x, y)
            best = v if best is None else max(best, v)
    return ("feat", best) if best is not None else ("nat", terrain(x, y))


# ---- materials -------------------------------------------------------------------------------------------------------

def door_image(w=256, h=384):
    """眼光门: the flame-arched niche on the bulb's south face, red with a blue field and the gilt emblem."""
    cv = Canvas(w, h, "#f3f2ec")
    cx = w / 2

    def arch(inset):
        pts = []
        top = 20 + inset
        for i in range(21):
            t = i / 20
            a = math.pi * t
            x = cx - (w * 0.42 - inset) * math.cos(a)
            y = h * 0.42 - (h * 0.30 - inset) * math.sin(a) ** 0.8
            pts.append((x, y))
        pts.insert(10, (cx, top))
        return [(cx - (w * 0.42 - inset), h - 12 - inset)] + pts + [(cx + (w * 0.42 - inset), h - 12 - inset)]
    cv.poly(arch(0), "#a3261c")
    cv.poly(arch(14), "#d8a83f")
    cv.poly(arch(22), "#1d3f7a")
    # the emblem (十相自在): a stack of gilt glyph strokes in a lotus
    for i, (yy, ww) in enumerate(((150, 60), (185, 46), (215, 66), (250, 50), (285, 72))):
        cv.rect(cx - ww / 2, yy, cx + ww / 2, yy + 18, "#e4b544" if i % 2 == 0 else "#c9392b")
    cv.ellipse(cx, 118, 20, 20, "#e4b544")
    cv.ellipse(cx, 118, 9, 9, "#c9392b")
    cv.poly([(cx - 70, 330), (cx + 70, 330), (cx + 40, 312), (cx, 300), (cx - 40, 312)], "#2e7d57")
    return image("BT_Door", np.flipud(cv.a).copy())


def glaze_image(size=256):
    """善因殿's walls: glazed tiles, each a niche with a small seated Buddha, in yellow, green and blue (2 m a repeat)."""
    cv = Canvas(size, size, "#2e6e4e")
    n = 6
    c = size / n
    cols = ["#d8a42c", "#2e7d57", "#2a4f8f"]
    for i in range(n):
        for j in range(n):
            x0, y0 = j * c, i * c
            cv.rect(x0 + 1, y0 + 1, x0 + c - 1, y0 + c - 1, cols[(i + j) % 3])
            cv.ellipse(x0 + c / 2, y0 + c * 0.52, c * 0.3, c * 0.36, "#1b3526")
            cv.ellipse(x0 + c / 2, y0 + c * 0.64, c * 0.2, c * 0.16, "#e9c35a")
            cv.ellipse(x0 + c / 2, y0 + c * 0.36, c * 0.09, c * 0.09, "#e9c35a")
    cv.noise(0.08, 5)
    return image("BT_Glaze", np.flipud(cv.a).copy())


def yellow_tile_image(size=128):
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.8 + 0.2 * np.cos(2 * np.pi * u * 2) ** 2
    course = 1 - 0.1 * (((v * 5) % 1) < 0.08)
    return image("BT_Yellow", srgb("#d9a52c") * (ridge * course)[..., None])


def materials():
    M = make_materials("BT")
    M.update(
        earth=material("BT_Earth", "#ffffff", 0.95, vertex_colors=True, props={"wet": "damp", "glow": "none", "layer": 6}),
        foliage=material("BT_Foliage", "#ffffff", 0.85, vertex_colors=True, props={"wet": "damp", "glow": "none"}),
        white=material("BT_White", "#f3f2ec", 0.8, props={"wet": "damp", "glowStrength": 0.55}),
        door=material("BT_DoorMat", "#ffffff", 0.6, tex=door_image(), props={"wet": "damp", "glowStrength": 0.55}),
        glaze=material("BT_GlazeMat", "#ffffff", 0.35, tex=glaze_image(), props={"wet": "surface", "glowStrength": 0.6}),
        yellow=material("BT_YellowMat", "#ffffff", 0.35, tex=yellow_tile_image(), props={"wet": "surface", "glowStrength": 0.5}),
    )
    return M


TILE = dict(ZTILE, earth=1.0, foliage=1.0, white=2.0, door=1.0, glaze=2.0, yellow=1.2)


# ---- the terrain -----------------------------------------------------------------------------------------------------

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


def rect_ring(f, off, step):
    x0, x1, y0, y1 = f.x0 - off, f.x1 + off, f.y0 - off, f.y1 + off
    return resample([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], step)


def earth_colour(x, y, h, slope, tree_d, u):
    """Grass, darker forest floor under the trees, grey rock on the steep, paving on the promenade."""
    k = 0.5 + 0.5 * math.sin(x * 0.31 + math.sin(y * 0.23) * 2.0) * math.cos(y * 0.27 - x * 0.05)
    grass = Vector(linear("#617a40")).lerp(Vector(linear("#75844f")), k)
    wood = Vector(linear("#3f4c2e")).lerp(Vector(linear("#4f5636")), k)
    c = grass.lerp(wood, smooth(9.0, 3.0, tree_d))
    c = c.lerp(Vector(linear("#8b877c")), smooth(0.55, 0.9, slope))
    c = c.lerp(Vector(linear("#a09c92")), smooth(0.9, 0.95, u))
    return tuple(c)


def build_terrain(step, trees, detail=True):
    pts = []
    shore = resample(SHORE, step)
    pts += shore
    edges = []
    n0 = len(shore)
    edges += [(i, (i + 1) % n0) for i in range(n0)]
    if detail:
        for f in FEATS:
            for off in (-0.15, 0.15):
                ring = [p for p in rect_ring(f, off, min(step, 1.6))]
                base = len(pts)
                pts += ring
                edges += [(base + i, base + (i + 1) % len(ring)) for i in range(len(ring))]
    x0, x1, y0, y1 = aabb(SHORE)
    gx = x0
    while gx <= x1:
        gy = y0
        while gy <= y1:
            if inside(gx, gy, SHORE) and poly_dist(gx, gy, SHORE) > step * 0.45 and \
                    (not detail or all(not (f.contains(gx, gy, 0.6) and not f.contains(gx, gy, -0.6)) for f in FEATS)):
                pts.append((gx, gy))
            gy += step
        gx += step
    vs, es, fs, *_ = geometry.delaunay_2d_cdt([Vector(p) for p in pts], edges, [list(range(n0))], 0, 1e-4, True)
    tri_ok = []
    for f in fs:
        a, b, c = (vs[i] for i in f)
        cx, cy = (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3
        if inside(cx, cy, SHORE):
            area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
            tri_ok.append(tuple(f) if area > 0 else (f[0], f[2], f[1]))
    g = Geo(colors=True)
    idx = {}
    tree_xy = [(t[1], t[2]) for t in trees]
    grid = {}
    for tx, ty in tree_xy:
        grid.setdefault((int(tx // 10), int(ty // 10)), []).append((tx, ty))

    def tree_d(x, y):
        best = 99.0
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for tx, ty in grid.get((int(x // 10) + i, int(y // 10) + j), ()):
                    best = min(best, math.hypot(tx - x, ty - y))
        return best
    for f in tri_ok:
        for i in f:
            if i in idx:
                continue
            x, y = vs[i].x, vs[i].y
            h = terrain(x, y)
            if poly_dist(x, y, SHORE) < 0.05:
                h = SHORE_Z
            e = 0.8
            sl = math.hypot(terrain(x + e, y) - terrain(x - e, y), terrain(x, y + e) - terrain(x, y - e)) / (2 * e)
            idx[i] = g.vert((x, y, h), earth_colour(x, y, h, sl, tree_d(x, y), radial_u(x, y)))
    for f in tri_ok:
        g.face([idx[i] for i in f], "earth", smooth=True)
    # the stone revetment round the shore
    ring = resample(SHORE, 3.0)
    stone = linear("#9c968a")
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        g.poly([(b[0], b[1], -0.4), (a[0], a[1], -0.4), (a[0], a[1], SHORE_Z), (b[0], b[1], SHORE_Z)], "earth", col=stone)
    return g


# ---- terrace walls, tops, flights, parapets --------------------------------------------------------------------------

def feature_geo(g, f, cols, buildings_rects, lod=False):
    """The walls round a feature (outward where the ground beside is lower, inward where the hill is higher), its
    paved top or steps, and parapets along the high edges. Returns parapet boxes for the colliders."""
    x0, x1, y0, y1 = f.x0, f.x1, f.y0, f.y1
    sides = [((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)), ((x1, y1), (x0, y1), (0, 1)), ((x0, y1), (x0, y0), (-1, 0))]
    para = []
    lowest = f.z0
    for a, b, (ox, oy) in sides:
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, math.ceil(L / (4.0 if lod else 1.0)))
        samples = []
        for i in range(n + 1):
            t = i / n
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            s = f.surf(x - ox * 0.01, y - oy * 0.01)
            kind, hn = neighbour(x + ox * 0.35, y + oy * 0.35, f)
            samples.append((x, y, s, kind, hn))
            lowest = min(lowest, hn if kind == "nat" else s)
        run = []
        for (xa, ya, sa, ka, ha), (xb, yb, sb, kb, hb) in zip(samples, samples[1:]):
            want = (ox, oy, 0)
            # outward: down to the ground or the lower feature beside
            ba = (ha - 0.5 if ka == "nat" else ha - 0.1) if ha < sa else sa
            bb = (hb - 0.5 if kb == "nat" else hb - 0.1) if hb < sb else sb
            if ba < sa - 0.02 or bb < sb - 0.02:
                g.polyn([(xa, ya, min(ba, sa)), (xb, yb, min(bb, sb)), (xb, yb, sb), (xa, ya, sa)], "brick", want)
            # inward: a retaining wall where the hill stands higher than the feature
            if ka == "nat" and kb == "nat" and not lod:
                ta, tb = max(sa, ha + 0.2), max(sb, hb + 0.2)
                if ta > sa + 0.02 or tb > sb + 0.02:
                    g.polyn([(xa, ya, sa), (xb, yb, sb), (xb, yb, tb), (xa, ya, ta)], "brick", (-ox, -oy, 0))
            # parapet where the drop is high and nothing (a flight, a hall) meets the edge
            mx, my = (xa + xb) / 2, (ya + yb) / 2
            hmid = (ha + hb) / 2
            drop = (sa + sb) / 2 - hmid
            blocked = any(x0_ - 0.3 <= mx <= x1_ + 0.3 and y0_ - 0.3 <= my <= y1_ + 0.3 for x0_, x1_, y0_, y1_ in buildings_rects)
            want_p = f.parapet and not f.flight and (drop > 1.2 or f.name == "T5") and not blocked and not (ka == "feat" and abs(sa - ha) < 0.8)
            if want_p:
                run.append((xa, ya, xb, yb))
            elif run:
                para.append((run[0][0], run[0][1], run[-1][2], run[-1][3], (ox, oy), f.z0))
                run = []
        if run:
            para.append((run[0][0], run[0][1], run[-1][2], run[-1][3], (ox, oy), f.z0))
    if not f.flight:
        g.polyn([(x0, y0, f.z0), (x1, y0, f.z0), (x1, y1, f.z0), (x0, y1, f.z0)], "paving", (0, 0, 1))
    else:
        rise = f.z1 - f.z0
        n = max(2, round(rise / (0.3 if lod else 0.16)))
        run_ = (y1 - y0) / n
        for k in range(n):
            ya, yb = y0 + k * run_, y0 + (k + 1) * run_
            za, zb = f.z0 + rise * k / n, f.z0 + rise * (k + 1) / n
            g.polyn([(x0, ya, za), (x1, ya, za), (x1, ya, zb), (x0, ya, zb)], "stone", (0, -1, 0))
            g.polyn([(x0, ya, zb), (x1, ya, zb), (x1, yb, zb), (x0, yb, zb)], "stone", (0, 0, 1))
        if not lod:
            # cheek walls a hand's height over the steps, both sides
            for xc, sgn in ((x0, -1), (x1, 1)):
                xa_, xb_ = (xc - 0.35, xc) if sgn < 0 else (xc, xc + 0.35)
                g.polyn([(xa_, y0, f.z0 - 0.2), (xa_, y1, f.z1 - 0.2), (xa_, y1, f.z1 + 0.55), (xa_, y0, f.z0 + 0.55)], "stone", (-1, 0, 0))
                g.polyn([(xb_, y0, f.z0 - 0.2), (xb_, y1, f.z1 - 0.2), (xb_, y1, f.z1 + 0.55), (xb_, y0, f.z0 + 0.55)], "stone", (1, 0, 0))
                g.polyn([(xa_, y0, f.z0 + 0.55), (xb_, y0, f.z0 + 0.55), (xb_, y1, f.z1 + 0.55), (xa_, y1, f.z1 + 0.55)], "stone", (0, -0.3, 1))
    boxes = []
    for ax, ay, bx, by, (ox, oy), z in para:
        t = 0.45
        if ox == 0:
            xa, xb = min(ax, bx), max(ax, bx)
            ya, yb = (ay - t, ay) if oy > 0 else (ay, ay + t)
        else:
            ya, yb = min(ay, by), max(ay, by)
            xa, xb = (ax - t, ax) if ox > 0 else (ax, ax + t)
        if not lod:
            g.box(xa, xb, ya, yb, z, z + 0.95, "brick", skip=("-z",))
            g.box(xa - 0.06, xb + 0.06, ya - 0.06, yb + 0.06, z + 0.95, z + 1.08, "stone", skip=("-z",))
        boxes.append((xa, xb, ya, yb, z, z + 1.1))
    return boxes, lowest


# ---- halls -------------------------------------------------------------------------------------------------------------

def spec(w, d, ze, kind="xieshan", trim=True, rows=8, lower=None, inner=None):
    """A hall.py spec for a single-eaved hall (or with `lower`, the upper roof of a 楼 over the inner ring)."""
    iw, idp = inner if inner else (w, d)
    ov = 1.1 + 0.06 * idp
    A, D = iw / 2 + ov, idp / 2 + ov
    R = dict(A=A, D=D, z=ze - 0.3, H=0.52 * D + 0.4, p=1.45, o=min(0.9, 0.1 * D + 0.25), lift=min(0.9, 0.1 * D + 0.25),
             Lc=min(7.0, 0.45 * D + 0.8), Vc=min(4.2, 0.4 * D + 0.5))
    return SimpleNamespace(
        XS=[-w / 2, w / 2], YS=[-d / 2, d / 2], OX=w / 2, OY=d / 2, IX=iw / 2, IY=idp / 2,
        BEAM=lower["beam"] if lower else (ze - 1.0, ze - 0.6, ze - 0.6, ze), UBEAM=(ze - 1.0, ze - 0.6, ze - 0.6, ze),
        OVERHANG=ov, LOWER=lower["roof"] if lower else None, UPPER=R, GABLE_X=max(0.6, A - 0.55 * D - 0.8),
        PITCH=0.6, AMP=0.1, TRIM=1.0 if trim else 0.0, RIDGE="trim" if trim else "tile", KIND=kind,
        ROWS=rows, END_ROWS=3, LOWER_ROWS=4, BRACKET_GAP=1.4, WEN=min(1.0, 0.1 * D + 0.3))


def plain_roof(h, g, key="tile"):
    """A 庑殿 (hip) roof with smooth faces - no tile rows - for the lesser halls: faces, eave edge, rafters, ridges."""
    R = h.UPPER
    A, D = R["A"], R["D"]
    hips = []
    for rot in range(4):
        Af, De = (A, D) if rot % 2 == 0 else (D, A)
        rows = roof_face(g, R, D, rot, Af, De, D - 0.02, rows=4, waves=False, cols=8 if rot % 2 == 0 else 4, key=key)
        eave_edge(g, rows[0], key=key)
        soffit(g, R, D, rot, Af, De, h.UBEAM[3] + 0.08, span=h.OVERHANG)
        if rot % 2 == 1:
            hips.append([r[0] for r in rows])
            hips.append([r[-1] for r in rows])
    ztop = R["z"] + R["H"]
    XR = max(0.0, A - D)
    g.box(-XR - 0.25, XR + 0.25, -0.3, 0.3, ztop - 0.25, ztop + 0.45, key)
    for line in hips:
        sweep(g, line, 0.38, 0.3, key=key)
    return hips


GATES = {"山门", "正觉殿", "普安殿"}      # halls the path runs through: an open doorway front and back
PLINTH = 0.35                            # a step a person takes without stairs (OnFoot autosteps 0.4)


def gate_half(w):
    nb = max(3, int(w / 3.3) | 1)
    return min(1.3, w / nb / 2 - 0.25)


def hall_body(g, w, d, z0, ze, front=True, gate=False):
    """Red walls, the front in lattice doors and windows between red columns, the painted beam under the eave."""
    zt = z0 + ze
    nb = max(3, int(w / 3.3) | 1)
    xs = [-w / 2 + w * i / nb for i in range(nb + 1)]
    for i in range(nb):
        a, b = xs[i], xs[i + 1]
        reg = "door" if i == nb // 2 and front else "window"
        if gate and i == nb // 2:
            hw = gate_half(w)
            for sy in (-1, 1):
                g.polyn([(-hw, sy * (d / 2 + 0.02), z0), (hw, sy * (d / 2 + 0.02), z0), (hw, sy * (d / 2 + 0.02), z0 + 3.0), (-hw, sy * (d / 2 + 0.02), z0 + 3.0)],
                        "dark", (0, sy, 0))
        g.polyn([(a, -d / 2, z0), (b, -d / 2, z0), (b, -d / 2, zt - 0.7), (a, -d / 2, zt - 0.7)], "atlas", (0, -1, 0), uvs=uvs(reg, QUAD))
        g.polyn([(a, -d / 2 - 0.06, zt - 0.7), (b, -d / 2 - 0.06, zt - 0.7), (b, -d / 2 - 0.06, zt), (a, -d / 2 - 0.06, zt)], "atlas", (0, -1, 0), uvs=uvs("beam", QUAD))
        g.polyn([(a, d / 2 + 0.06, zt - 0.7), (b, d / 2 + 0.06, zt - 0.7), (b, d / 2 + 0.06, zt), (a, d / 2 + 0.06, zt)], "atlas", (0, 1, 0), uvs=uvs("beam", QUAD))
    g.polyn([(-w / 2, d / 2, z0), (w / 2, d / 2, z0), (w / 2, d / 2, zt - 0.7), (-w / 2, d / 2, zt - 0.7)], "plaster", (0, 1, 0))
    for sx in (-1, 1):
        g.polyn([(sx * w / 2, -d / 2, z0), (sx * w / 2, d / 2, z0), (sx * w / 2, d / 2, zt), (sx * w / 2, -d / 2, zt)], "plaster", (sx, 0, 0))
        g.polyn([(sx * (w / 2 + 0.06), -d / 2, zt - 0.7), (sx * (w / 2 + 0.06), d / 2, zt - 0.7), (sx * (w / 2 + 0.06), d / 2, zt), (sx * (w / 2 + 0.06), -d / 2, zt)],
                "atlas", (sx, 0, 0), uvs=uvs("beam", QUAD))
    for x in xs:
        for sy in (-1, 1):
            cyl(g, x, sy * (d / 2 + 0.1), z0, zt - 0.7, 0.2, 0.19, 8, "red", caps=(False, False))
    g.polyn([(-w / 2, -d / 2, zt), (w / 2, -d / 2, zt), (w / 2, d / 2, zt), (-w / 2, d / 2, zt)], "plaster", (0, 0, -1))


def make_hall(b, floor, meshes, parts, lod=False):
    """A hall in its own frame (long axis x, front -y) and its placement matrix; brackets placed as linked meshes."""
    name, cx, cy, w, d, yaw, style, ze = b
    if w < d:
        w, d, yaw = d, w, yaw + 90
    g = Geo()
    zb = floor
    g.box(-w / 2 - 0.6, w / 2 + 0.6, -d / 2 - 0.6, d / 2 + 0.6, zb - 0.7, zb + PLINTH, "stone", skip=("-z",))
    z0 = zb + PLINTH
    m = T(cx, cy, 0) @ Rz(math.radians(yaw))
    trim = style != "plain"
    if style == "tower":
        z1, z2 = z0 + ze, z0 + ze + 4.6
        iw, idp = w - 2.6, d - 2.6
        low = dict(roof=dict(A=w / 2 + 1.5, D=d / 2 + 1.5, z=z1 - 0.3, H=1.6, p=1.2, o=0.5, lift=0.5, Lc=3.5, Vc=1.8),
                   beam=(z1 - 1.0, z1 - 0.6, z1 - 0.6, z1))
        h = spec(w, d, z2, trim=True, rows=5, lower=low, inner=(iw, idp))
        if lod:
            g.box(-w / 2, w / 2, -d / 2, d / 2, z0, z1, "plaster", skip=("-z",))
            g.box(-iw / 2, iw / 2, -idp / 2, idp / 2, z1, z2, "plaster", skip=("-z",))
            roofs(h, g, lod=True)
            return g, m, (w, d, yaw, z2 + h.UPPER["H"])
        hall_body(g, w, d, z0, ze)
        zu = z1 - 0.3 + 1.6
        nb = max(3, int(iw / 3.3) | 1)
        for i in range(nb):
            a, bb = -iw / 2 + iw * i / nb, -iw / 2 + iw * (i + 1) / nb
            for sy in (-1, 1):
                q = [(a, sy * idp / 2, zu), (bb, sy * idp / 2, zu), (bb, sy * idp / 2, z2 - 0.7), (a, sy * idp / 2, z2 - 0.7)]
                g.polyn(q, "atlas", (0, sy, 0), uvs=uvs("window", QUAD))
                g.polyn([(a, sy * (idp / 2 + 0.06), z2 - 0.7), (bb, sy * (idp / 2 + 0.06), z2 - 0.7), (bb, sy * (idp / 2 + 0.06), z2), (a, sy * (idp / 2 + 0.06), z2)],
                        "atlas", (0, sy, 0), uvs=uvs("beam", QUAD))
        for sx in (-1, 1):
            g.polyn([(sx * iw / 2, -idp / 2, zu), (sx * iw / 2, idp / 2, zu), (sx * iw / 2, idp / 2, z2), (sx * iw / 2, -idp / 2, z2)], "plaster", (sx, 0, 0))
        roofs(h, g)
        return g, m, (w, d, yaw, z2 + h.UPPER["H"])
    kind = "xieshan" if style in ("main", "hall") else "wudian"
    h = spec(w, d, z0 + ze, kind=kind, trim=trim, rows=5 if style == "main" else 4)
    if lod:
        g.box(-w / 2, w / 2, -d / 2, d / 2, z0, z0 + ze, "plaster", skip=("-z",))
        if style == "plain":
            hip_simple(g, h)
        else:
            roofs(h, g, lod=True)
        return g, m, (w, d, yaw, z0 + ze + h.UPPER["H"])
    hall_body(g, w, d, z0, ze, gate=name in GATES)
    if style == "plain":
        plain_roof(h, g)
    else:
        roofs(h, g)
    if style == "main":
        for p, yw in bracket_spots(h, True, z0 + ze - 0.62):
            place(meshes["bracket"], f"{name}.bracket", parts, m @ T(*p) @ Rz(yw) @ Matrix.Diagonal((0.72, 0.72, 0.72, 1.0)))
    return g, m, (w, d, yaw, z0 + ze + h.UPPER["H"])


def hip_simple(g, h, key="tile"):
    R = h.UPPER
    A, D, z, H = R["A"], R["D"], R["z"], R["H"]
    XR = max(0.0, A - D)
    top = z + H
    g.polyn([(-A, -D, z), (A, -D, z), (XR, 0, top), (-XR, 0, top)], key, (0, -1, 1))
    g.polyn([(A, D, z), (-A, D, z), (-XR, 0, top), (XR, 0, top)], key, (0, 1, 1))
    g.polyn([(A, -D, z), (A, D, z), (XR, 0, top)], key, (1, 0, 1))
    g.polyn([(-A, D, z), (-A, -D, z), (-XR, 0, top)], key, (-1, 0, 1))


def pavilion(g, cx, cy, r, z0, lod=False):
    """A round pavilion (亭): a stone base, eight red columns, a round 攒尖 roof and a gilt finial."""
    cyl(g, cx, cy, z0 - 0.6, z0 + PLINTH, r + 0.5, r + 0.5, 16, "stone", caps=(False, True))
    z0 += PLINTH
    zt = z0 + 3.2
    sub = Geo()
    R = dict(r0=r + 1.1, r1=0.0, z=zt, H=2.6 + 0.2 * r, p=1.6, lift=0.35, Vl=1.2)
    if lod:
        lathe(sub, [(r + 1.1, zt), (0.3, zt + R["H"]), (0.0, zt + R["H"] + 0.1)], 8, "tile")
    else:
        for k in range(8):
            a = 2 * math.pi * k / 8
            cyl(sub, r * math.cos(a), r * math.sin(a), z0, zt, 0.17, 0.16, 8, "red", caps=(False, False))
        for k in range(16):
            a0, a1 = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
            p = lambda a, z: (r * math.cos(a), r * math.sin(a), z)     # noqa: E731
            sub.polyn([p(a0, zt - 0.6), p(a1, zt - 0.6), p(a1, zt + 0.05), p(a0, zt - 0.6 + 0.65)], "atlas", (math.cos(a0 + 0.2), math.sin(a0 + 0.2), 0),
                      uvs=uvs("beam", ((0, 0), (0.25, 0), (0.25, 1), (0, 1))))
        top = round_roof(sub, R, rows=5, key="tile", pitch=0.4, amp=0.07, trim=0.7, waves=True, spp=2)
        round_eave(sub, R, r, zt, key="trim", segs=24)
        cyl(sub, 0, 0, top - 0.1, top + 0.3, 0.35, 0.3, 10, "trim")
        ell(sub, (0, 0, top + 0.65), (0.3, 0.3, 0.42), "gold", nu=10, nv=6)
    g.add(sub, T(cx, cy, 0))


# ---- the dagoba --------------------------------------------------------------------------------------------------------

def yazi(a, c):
    """折角: a square of half size a with each corner cut back in two steps of c/2."""
    q = [(a - c, -a), (a - c, -a + c / 2), (a - c / 2, -a + c / 2), (a - c / 2, -a + c), (a, -a + c)]
    out = []
    for k in range(4):
        for x, y in q:
            for _ in range(k):
                x, y = -y, x
            out.append((x, y))
    return out


def yazi_tier(g, a0, a1, z0, z1, key, c_frac=0.2, top=True):
    """A frustum of the 亚 plan from half size a0 at z0 to a1 at z1."""
    p0 = yazi(a0, a0 * c_frac)
    p1 = yazi(a1, a1 * c_frac)
    n = len(p0)
    for i in range(n):
        j = (i + 1) % n
        A, B = p0[i], p0[j]
        C, D = p1[j], p1[i]
        mx, my = (A[0] + B[0]) / 2, (A[1] + B[1]) / 2
        ex, ey = B[0] - A[0], B[1] - A[1]
        out = (ey, -ex, 0)
        if out[0] * mx + out[1] * my < 0:
            out = (-ey, ex, 0)
        g.polyn([(A[0], A[1], z0), (B[0], B[1], z0), (C[0], C[1], z1), (D[0], D[1], z1)], key, out)
    if top:
        g.polyn([(x, y, z1) for x, y in p1], key, (0, 0, 1))


def dagoba(z, lod=False):
    """白塔 on its platform at height z: sumeru, round tiers, bulb with the 眼光门, neck sumeru, 十三天, 华盖, finial."""
    g = Geo()
    S = 48 if not lod else 16
    if lod:
        yazi_tier(g, 8.7, 8.4, z, z + 5.0, "white")
    else:
        for a0, a1, z0, z1 in ((8.7, 8.7, 0.0, 0.45), (8.5, 8.5, 0.45, 0.95), (8.35, 8.0, 0.95, 1.35), (7.8, 7.8, 1.35, 3.6),
                               (8.0, 8.35, 3.6, 4.0), (8.5, 8.5, 4.0, 4.5), (8.7, 8.7, 4.5, 5.0)):
            yazi_tier(g, a0, a1, z + z0, z + z1, "white")
        # the waist's carved panels, a shade darker, between the corner posts
        for rot in range(4):
            for k in range(-3, 4):
                x = k * 1.9
                p = [(x - 0.75, -7.83, z + 1.7), (x + 0.75, -7.83, z + 1.7), (x + 0.75, -7.83, z + 3.25), (x - 0.75, -7.83, z + 3.25)]
                q = []
                for px, py, pz in p:
                    for _ in range(rot):
                        px, py = -py, px
                    q.append((px, py, pz))
                wx, wy = 0.0, -1.0
                for _ in range(rot):
                    wx, wy = -wy, wx
                g.polyn(q, "stone", (wx, wy, 0))
    zt = z + 5.0
    prof = [(7.9, zt), (7.9, zt + 0.5), (7.6, zt + 0.5), (7.6, zt + 1.0), (7.3, zt + 1.0), (7.3, zt + 1.5), (7.05, zt + 1.55),
            (7.3, zt + 1.85), (7.1, zt + 2.2)]
    # the bulb (塔肚): shoulders broad and high, 14 m across
    bz = zt + 2.2
    bulb = [(6.3, bz), (6.7, bz + 1.0), (6.92, bz + 2.6), (7.0, bz + 4.6), (6.95, bz + 6.2), (6.7, bz + 7.6), (6.1, bz + 8.9),
            (5.1, bz + 10.0), (3.9, bz + 10.7), (3.2, bz + 11.0)]
    lathe(g, [(r, zz) for r, zz in prof], 32 if not lod else 12, "white")
    lathe(g, bulb, S, "white")
    top_b = bz + 11.0
    if not lod:
        # 眼光门: a patch of the bulb's south face, a few cm proud, textured
        a_c, half_w = -math.pi / 2, 2.35
        z_lo, z_hi = bz + 2.0, bz + 9.0
        nu, nv = 8, 10

        def r_at(zz):
            for (r0, z0_), (r1, z1_) in zip(bulb, bulb[1:]):
                if zz <= z1_:
                    return r0 + (r1 - r0) * (zz - z0_) / (z1_ - z0_)
            return bulb[-1][0]
        rows = []
        for j in range(nv + 1):
            zz = z_lo + (z_hi - z_lo) * j / nv
            r = r_at(zz) + 0.035
            da = half_w / r
            row = []
            for i in range(nu + 1):
                a = a_c - da + 2 * da * i / nu
                row.append(g.vert((r * math.cos(a), r * math.sin(a), zz)))
            rows.append(row)
        for j in range(nv):
            for i in range(nu):
                g.face((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]), "door",
                       uvs=[(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)], smooth=True)
    # the neck's sumeru (塔颈座)
    nz = top_b
    for a0, a1, z0, z1 in ((3.95, 3.95, 0.0, 0.35), (3.6, 3.6, 0.35, 1.2), (3.95, 3.95, 1.2, 1.6)):
        yazi_tier(g, a0, a1, nz + z0, nz + z1, "white", c_frac=0.22)
    # 十三天: thirteen rings tapering up
    sz = nz + 1.6
    ring_h = 8.6 / 13
    sp = []
    for k in range(13):
        r = 2.85 - 0.95 * k / 12
        z0 = sz + k * ring_h
        sp += [(r - 0.08, z0), (r + 0.1, z0 + 0.08), (r + 0.1, z0 + 0.22), (r, z0 + 0.3)] if not lod else [(r, z0)]
    sp.append((1.8, sz + 8.6))
    lathe(g, sp, 24 if not lod else 10, "white")
    cz = sz + 8.6
    # 华盖: the gilt canopy with bells round its rim, then 天盘, 宝顶, the moon and sun and the flaming pearl
    lathe(g, [(1.8, cz), (3.5, cz + 0.35), (3.7, cz + 0.55), (3.6, cz + 0.75), (2.0, cz + 1.1), (1.2, cz + 1.25), (0.01, cz + 1.3)], 32 if not lod else 12, "gold")
    if not lod:
        for k in range(20):
            a = 2 * math.pi * k / 20
            ell(g, (3.55 * math.cos(a), 3.55 * math.sin(a), cz + 0.05), (0.12, 0.12, 0.22), "gold", nu=6, nv=3)
    fz = cz + 1.2
    lathe(g, [(0.55, fz), (0.55, fz + 0.6), (1.4, fz + 0.65), (1.4, fz + 0.9), (0.7, fz + 0.95), (0.95, fz + 1.4), (0.8, fz + 1.9),
              (0.3, fz + 2.2), (0.3, fz + 2.5), (0.01, fz + 2.55)], 16 if not lod else 8, "gold")
    if not lod:
        mz = fz + 2.9
        # the crescent moon (a flat arc opening upward) and the sun's disc over it, facing south and north
        for k in range(10):
            a0, a1 = math.pi * (1.1 + 0.08 * k), math.pi * (1.1 + 0.08 * (k + 1))
            q = [(0.75 * math.cos(a0), mz + 0.75 * math.sin(a0)), (0.75 * math.cos(a1), mz + 0.75 * math.sin(a1)),
                 (0.5 * math.cos(a1), mz + 0.1 + 0.5 * math.sin(a1)), (0.5 * math.cos(a0), mz + 0.1 + 0.5 * math.sin(a0))]
            for sy in (-1, 1):
                g.polyn([(x, sy * 0.06, zz) for x, zz in q], "gold", (0, sy, 0))
        cyl_y_disc(g, 0, mz + 0.75, 0.5, 0.12, "gold")
    ell(g, (0, 0, fz + 4.1), (0.38, 0.38, 0.55), "gold", nu=10 if not lod else 6, nv=6 if not lod else 3)
    cyl(g, 0, 0, fz + 4.55, z + 35.9, 0.18, 0.02, 8, "gold", caps=(False, True))
    return g


def cyl_y_disc(g, x, z, r, t, key, segs=14):
    a = [Vector((x + r * math.cos(2 * math.pi * i / segs), -t / 2, z + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)]
    b = [p + Vector((0, t, 0)) for p in a]
    g.polyn(a, key, (0, -1, 0))
    g.polyn(b, key, (0, 1, 0))
    for i in range(segs):
        k = (i + 1) % segs
        g.poly([a[i], a[k], b[k], b[i]], key, smooth=True)


def shanyin(z, lod=False):
    """善因殿: on a marble base, square walls of glazed Buddha tiles, a square lower eave, a round drum and a round
    攒尖 of yellow glaze edged in green, the gilt finial."""
    g = Geo()
    g.box(-3.3, 3.3, -3.3, 3.3, z - 0.3, z + 0.8, "marble", skip=("-z",))
    z0 = z + 0.8
    zw = z0 + 3.3
    if lod:
        g.box(-2.5, 2.5, -2.5, 2.5, z0, zw, "glaze", skip=("-z",))
        lathe(g, [(3.7, zw), (2.0, zw + 1.1), (2.0, zw + 2.3), (3.0, zw + 2.3), (0.01, zw + 5.2)], 8, "yellow")
        return g
    g.box(-2.5, 2.5, -2.5, 2.5, z0, zw, "glaze", skip=("-z",))
    g.polyn([(-0.8, -2.53, z0), (0.8, -2.53, z0), (0.8, -2.53, z0 + 2.5), (-0.8, -2.53, z0 + 2.5)], "atlas", (0, -1, 0), uvs=uvs("gatedoor", QUAD))
    RL = dict(A=3.8, D=3.8, z=zw - 0.1, H=1.0, p=1.2, o=0.3, lift=0.3, Lc=1.6, Vc=1.0)
    DL = 3.8 - 2.0
    for rot in range(4):
        rows = roof_face(g, RL, DL, rot, 3.8, 3.8, DL, rows=4, waves=True, pitch=0.3, amp=0.05, key="yellow", trim=0.5)
        eave_edge(g, rows[0], key="trim")
        soffit(g, RL, DL, rot, 3.8, 3.8, zw + 0.05, span=1.2)
        sweep(g, [r[-1] for r in rows], 0.25, 0.2, key="trim")
    zd = zw - 0.1 + 1.0
    cyl(g, 0, 0, zd - 0.2, zd + 1.3, 2.0, 2.0, 24, "glaze", caps=(False, False))
    R = dict(r0=2.9, r1=0.0, z=zd + 1.4, H=2.4, p=1.5, lift=0.25, Vl=1.0)
    top = round_roof(g, R, rows=6, key="yellow", pitch=0.3, amp=0.05, trim=0.45, waves=True, spp=2)
    round_eave(g, R, 2.0, zd + 1.3, key="trim", segs=32)
    cyl(g, 0, 0, top - 0.1, top + 0.3, 0.4, 0.35, 12, "trim")
    ell(g, (0, 0, top + 0.75), (0.35, 0.35, 0.5), "gold", nu=10, nv=6)
    return g


# ---- the long buildings along a line: 延楼 and 阅古楼 -------------------------------------------------------------------

def offset_line(pts, dist, closed, ref):
    """The polyline pushed `dist` towards `ref` (mitred)."""
    n = len(pts)
    out = []
    for i in range(n):
        ns = []
        for j in ((i - 1, i), (i, i + 1)):
            a, b = j
            if not closed and (a < 0 or b >= n):
                continue
            pa, pb = Vector(pts[a % n]), Vector(pts[b % n])
            d = (pb - pa).normalized()
            nrm = Vector((-d.y, d.x))
            mid = (pa + pb) / 2
            if (Vector(ref) - mid).dot(nrm) < 0:
                nrm = -nrm
            ns.append(nrm)
        m = (ns[0] + ns[-1]).normalized()
        k = 1.0 / max(0.4, m.dot(ns[0]))
        out.append(tuple(Vector(pts[i]) + m * dist * k))
    return out


def band_building(g, pts, width, z0, ze, closed, ref, lod=False, storeys=2):
    """A corridor of rooms along a line: the outer face (towards the water) open in red columns below and lattice above,
    a plastered back wall, a gable roof along it, end walls. Returns (a, b) segment pairs for the colliders."""
    inner = offset_line(pts, width, closed, ref)
    out_e = offset_line(pts, -0.9, closed, ref)
    in_e = offset_line(pts, width + 0.9, closed, ref)
    ridge = offset_line(pts, width / 2, closed, ref)
    zr = z0 + ze + 0.4 + 0.45 * (width / 2 + 0.9)
    n = len(pts)
    segs = range(n) if closed else range(n - 1)
    zmid = z0 + 3.4
    for i in segs:
        j = (i + 1) % n
        a, b = Vector(pts[i]), Vector(pts[j])
        ai, bi = Vector(inner[i]), Vector(inner[j])
        L = (b - a).length
        if L < 0.1:
            continue
        mid = (a + b) / 2
        d = (b - a).normalized()
        nrm = Vector((-d.y, d.x))
        if (Vector(ref) - mid).dot(nrm) < 0:
            nrm = -nrm
        outw = (-nrm.x, -nrm.y, 0)
        # plinth, back wall, floor slab edge
        g.polyn([(a.x, a.y, z0 - 0.8), (b.x, b.y, z0 - 0.8), (b.x, b.y, z0), (a.x, a.y, z0)], "stone", outw)
        g.polyn([(ai.x, ai.y, z0 - 0.8), (bi.x, bi.y, z0 - 0.8), (bi.x, bi.y, z0 + ze), (ai.x, ai.y, z0 + ze)], "plaster", (nrm.x, nrm.y, 0))
        g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (bi.x, bi.y, z0), (ai.x, ai.y, z0)], "paving", (0, 0, 1))
        nb = max(1, round(L / 3.4))
        for k in range(nb):
            p0, p1 = a.lerp(b, k / nb), a.lerp(b, (k + 1) / nb)
            q0, q1 = p0 + nrm * 1.6, p1 + nrm * 1.6          # the rooms stand back behind the colonnade
            if not lod:
                cyl(g, p0.x, p0.y, z0, z0 + ze - 0.6, 0.18, 0.17, 8, "red", caps=(False, False))
                g.polyn([(q0.x, q0.y, z0), (q1.x, q1.y, z0), (q1.x, q1.y, zmid - 0.4), (q0.x, q0.y, zmid - 0.4)], "atlas", outw,
                        uvs=uvs("window", QUAD))
                g.polyn([(p0.x, p0.y, zmid - 0.4), (p1.x, p1.y, zmid - 0.4), (p1.x, p1.y, zmid + 0.2), (p0.x, p0.y, zmid + 0.2)], "atlas", outw,
                        uvs=uvs("beam", QUAD))
                g.polyn([(p0.x, p0.y, zmid - 0.4), (p1.x, p1.y, zmid - 0.4), (q1.x, q1.y, zmid - 0.4), (q0.x, q0.y, zmid - 0.4)], "atlas", (0, 0, -1),
                        uvs=uvs("ceiling", QUAD))
            if storeys == 2:
                g.polyn([(p0.x, p0.y, zmid + 0.2), (p1.x, p1.y, zmid + 0.2), (p1.x, p1.y, z0 + ze - 0.6), (p0.x, p0.y, z0 + ze - 0.6)], "atlas", outw,
                        uvs=uvs("band", QUAD) if not lod else uvs("window", QUAD))
            g.polyn([(p0.x, p0.y, z0 + ze - 0.6), (p1.x, p1.y, z0 + ze - 0.6), (p1.x, p1.y, z0 + ze), (p0.x, p0.y, z0 + ze)], "atlas", outw,
                    uvs=uvs("beam", QUAD))
        if lod:
            g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, zmid), (a.x, a.y, zmid)], "atlas", outw, uvs=uvs("window", QUAD))
        # roof: two slopes from the eaves to the ridge, soffits under the eaves
        oa, ob = Vector(out_e[i]), Vector(out_e[j])
        ia, ib = Vector(in_e[i]), Vector(in_e[j])
        ra, rb = Vector(ridge[i]), Vector(ridge[j])
        ze_ = z0 + ze + 0.2
        g.polyn([(oa.x, oa.y, ze_), (ob.x, ob.y, ze_), (rb.x, rb.y, zr), (ra.x, ra.y, zr)], "tile", (outw[0], outw[1], 1.5))
        g.polyn([(ib.x, ib.y, ze_), (ia.x, ia.y, ze_), (ra.x, ra.y, zr), (rb.x, rb.y, zr)], "tile", (nrm.x, nrm.y, 1.5))
        g.polyn([(oa.x, oa.y, ze_ - 0.25), (ob.x, ob.y, ze_ - 0.25), (ob.x, ob.y, ze_), (oa.x, oa.y, ze_)], "tile", outw)
        g.polyn([(ib.x, ib.y, ze_ - 0.25), (ia.x, ia.y, ze_ - 0.25), (ia.x, ia.y, ze_), (ib.x, ib.y, ze_)], "tile", (nrm.x, nrm.y, 0))
        if not lod:
            g.polyn([(oa.x, oa.y, ze_ - 0.25), (ob.x, ob.y, ze_ - 0.25), (b.x, b.y, z0 + ze), (a.x, a.y, z0 + ze)], "atlas", (0, 0, -1),
                    uvs=uvs("rafters", QUAD))
            g.polyn([(ib.x, ib.y, ze_ - 0.25), (ia.x, ia.y, ze_ - 0.25), (ai.x, ai.y, z0 + ze), (bi.x, bi.y, z0 + ze)], "atlas", (0, 0, -1),
                    uvs=uvs("rafters", QUAD))
            # the ridge
            g.polyn([(ra.x, ra.y, zr - 0.1), (rb.x, rb.y, zr - 0.1), (rb.x, rb.y, zr + 0.35), (ra.x, ra.y, zr + 0.35)], "tile", outw)
            g.polyn([(rb.x, rb.y, zr - 0.1), (ra.x, ra.y, zr - 0.1), (ra.x, ra.y, zr + 0.35), (rb.x, rb.y, zr + 0.35)], "tile", (nrm.x, nrm.y, 0))
    if not closed:
        for i, k in ((0, 1), (n - 1, n - 2)):
            a, ai = Vector(pts[i]), Vector(inner[i])
            oa, ia, ra = Vector(out_e[i]), Vector(in_e[i]), Vector(ridge[i])
            d = (Vector(pts[i]) - Vector(pts[k])).normalized()
            want = (d.x, d.y, 0)
            g.polyn([(a.x, a.y, z0 - 0.8), (ai.x, ai.y, z0 - 0.8), (ai.x, ai.y, z0 + ze), (a.x, a.y, z0 + ze)], "plaster", want)
            g.polyn([(oa.x, oa.y, z0 + ze + 0.2), (ia.x, ia.y, z0 + ze + 0.2), (ra.x, ra.y, zr)], "plaster", want)
    return [(pts[i], pts[(i + 1) % n], inner[i], inner[(i + 1) % n]) for i in segs]


# ---- the bridge and its archways -------------------------------------------------------------------------------------

def bridge_path(step=1.5):
    pts = resample(BRIDGE, step, closed=False)
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.dist(a, b))
    L = acc[-1]
    z = []
    for s in acc:
        t = s / L
        base = 0.08 + (0.9 - 0.08) * smooth(0.0, 1.0, t)
        z.append(base + 1.5 * math.sin(math.pi * min(1.0, max(0.0, (s - 2.7) / (L - 8.2)))) ** 1.4)
    return pts, acc, z


def bridge(g, lod=False):
    """永安桥: a humped stone deck with parapet kerbs, sides down into the water, three arches on the long span."""
    pts, acc, z = bridge_path(1.5 if not lod else 4.0)
    L = acc[-1]
    left = offset_line(pts, DECK_W / 2, False, (1000.0, 0.0))   # east side
    right = offset_line(pts, -DECK_W / 2, False, (1000.0, 0.0))
    for i in range(len(pts) - 1):
        la, lb, ra, rb = Vector(left[i]), Vector(left[i + 1]), Vector(right[i]), Vector(right[i + 1])
        za, zb = z[i], z[i + 1]
        g.polyn([(ra.x, ra.y, za), (la.x, la.y, za), (lb.x, lb.y, zb), (rb.x, rb.y, zb)], "paving", (0, 0, 1))
        for (pa, pb), sgn in (((la, lb), 1), ((ra, rb), -1)):
            d = (pb - pa).normalized()
            out = Vector((d.y, -d.x)) * sgn
            if out.x * sgn < 0:
                out = -out
            g.polyn([(pa.x, pa.y, -0.4), (pb.x, pb.y, -0.4), (pb.x, pb.y, zb), (pa.x, pa.y, za)], "stone", (out.x, out.y, 0))
    # the ends' abutments
    for i, k in ((0, 1), (len(pts) - 1, len(pts) - 2)):
        la, ra = Vector(left[i]), Vector(right[i])
        d = (Vector(pts[i]) - Vector(pts[k])).normalized()
        g.polyn([(la.x, la.y, -0.4), (ra.x, ra.y, -0.4), (ra.x, ra.y, z[i]), (la.x, la.y, z[i])], "stone", (d.x, d.y, 0))
    if lod:
        return pts, acc, z, left, right
    # arches on the long diagonal span: dark openings a hair proud of both faces, a lighter ring round each
    i0 = next(i for i, s in enumerate(acc) if s > 21)
    i1 = next(i for i, s in enumerate(acc) if s > 54)
    A, B = Vector(pts[i0]), Vector(pts[i1])
    d = (B - A).normalized()
    nrm = Vector((d.y, -d.x))
    for sc, span, crown in ((0.22, 5.0, 1.1), (0.5, 6.6, 1.55), (0.78, 5.0, 1.1)):
        c = A.lerp(B, sc)
        for side in (-1, 1):
            off = nrm * side * (DECK_W / 2 + 0.03)
            ring, hole = [], []
            for k in range(13):
                a = math.pi * k / 12
                p = c + d * (span / 2 * math.cos(a)) + off
                hole.append((p.x, p.y, -0.35 + (crown + 0.35) * math.sin(a)))
                p2 = c + d * ((span / 2 + 0.45) * math.cos(a)) + off * 1.002
                ring.append((p2.x, p2.y, -0.35 + (crown + 0.8) * math.sin(a)))
            g.polyn(hole, "dark", (off.x, off.y, 0))
            for k in range(12):
                g.polyn([ring[k], ring[k + 1], hole[k + 1], hole[k]], "marble", (off.x, off.y, 0))
    return pts, acc, z, left, right


def archway(g, parts, M, meshes, cx, cy, yaw, text, tag):
    """A 三间四柱三楼 archway: four red columns in stone clamps, painted beams, three small 庑殿 roofs, the plaque."""
    cols = [-6.4, -2.4, 2.4, 6.4]
    bays = [(-6.4, -2.4, 5.0, 6.4), (-2.4, 2.4, 5.9, 7.5), (2.4, 6.4, 5.0, 6.4)]
    m = T(cx, cy, 0) @ Rz(yaw)
    sub = Geo()
    for i, (x0, x1, zb, ze) in enumerate(bays):
        h = bay_spec(x0, x1, zb, ze, i == 1)
        h.ROWS, h.END_ROWS = 5, 3
        bg = Geo()
        Lb = x1 - x0 - 0.6
        for za, zc, reg in ((zb - 0.55, zb, "beam"), (zb - 1.05, zb - 0.55, "plank"), (zb - 1.5, zb - 1.05, "beam")):
            for side in (-1, 1):
                bg.polyn([(-Lb / 2, side * 0.28, za), (Lb / 2, side * 0.28, za), (Lb / 2, side * 0.28, zc), (-Lb / 2, side * 0.28, zc)], "atlas", (0, side, 0), uvs=uvs(reg, QUAD))
        bg.box(-Lb / 2 - 0.3, Lb / 2 + 0.3, -0.22, 0.22, zb, zb + 0.5, "plaster")
        roofs(h, bg)
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


# ---- trees and rocks ---------------------------------------------------------------------------------------------------

def blob(g, c, r, col, rng, nu=8, nv=4, jit=0.18, shade=0.55):
    verts = {}

    def P(i, j):
        th, ph = 2 * math.pi * i / nu, math.pi * j / nv
        k = 1 + jit * (rng.random() - 0.5) * 2 if 0 < j < nv else 1.0
        p = Vector((c[0] + r[0] * math.sin(ph) * math.cos(th) * k, c[1] + r[1] * math.sin(ph) * math.sin(th) * k, c[2] - r[2] * math.cos(ph) * k))
        f = (shade + (1 - shade) * (1 - math.cos(ph)) / 2) * (0.84 + 0.3 * rng.random())
        return g.vert(p, tuple(x * f for x in col))
    bot, top = P(0, 0), P(0, nv)
    rings = [[P(i, j) for i in range(nu)] for j in range(1, nv)]
    for i in range(nu):
        k = (i + 1) % nu
        g.face((bot, rings[0][k], rings[0][i]), "foliage", smooth=True)
        g.face((top, rings[-1][i], rings[-1][k]), "foliage", smooth=True)
        for j in range(nv - 2):
            g.face((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]), "foliage", smooth=True)


def trunk(g, h, r, col):
    cyl(g, 0, 0, -0.5, h, r, r * 0.7, 6, "foliage", caps=(False, False), col=col)


def tree_geos():
    rng = random.Random(3)
    bark = linear("#4a3b2e")
    out = {}
    for v in range(2):
        # 油松: a leaning trunk, flat clouds of needles in tiers
        g = Geo(colors=True)
        trunk(g, 7.5, 0.28, bark)
        pine = [linear("#2a3c2a"), linear("#324530"), linear("#283a2c")]
        for k, (z, rr, ox) in enumerate(((4.4, 3.0, 0.6), (6.1, 2.5, -0.8), (7.7, 1.8, 0.3))):
            a = rng.random() * 6.28
            blob(g, (ox * math.cos(a), ox * math.sin(a), z), (rr * (1.1 + 0.2 * v), rr, 0.8), pine[k % 3], rng, nu=7, nv=3)
        out[f"pine{v}"] = g
        # 侧柏 / 圆柏: a tall dark cone of scale leaves
        g = Geo(colors=True)
        trunk(g, 2.5, 0.25, bark)
        cyp = linear("#27372a") if v == 0 else linear("#2e3f2c")
        blob(g, (0, 0, 5.2), (2.1, 2.1, 4.4), cyp, rng, nu=7, nv=4, jit=0.12)
        blob(g, (0.3, -0.2, 8.7), (1.1, 1.1, 1.8), cyp, rng, nu=5, nv=3)
        out[f"cypress{v}"] = g
        # 国槐 / 柳: a broad crown of three lumps
        g = Geo(colors=True)
        trunk(g, 4.0, 0.3, bark)
        leaf = linear("#3f5530") if v == 0 else linear("#4a5e36")
        for dx, dy, dz, rr in ((0, 0, 6.2, 3.4), (1.8, 1.0, 5.2, 2.6), (-1.6, -1.2, 5.4, 2.7)):
            blob(g, (dx, dy, dz), (rr, rr, rr * 0.8), leaf, rng, nu=7, nv=3)
        out[f"broad{v}"] = g
    far = Geo(colors=True)
    blob(far, (0, 0, 5.5), (3.2, 3.2, 3.6), linear("#34482e"), rng, nu=5, nv=2, jit=0.0)
    return out, far


def rock_geos():
    rng = random.Random(9)
    out = []
    for v in range(3):
        g = Geo(colors=True)
        col = linear(("#8e8a80", "#7d796f", "#9a958a")[v])
        blob(g, (0, 0, 0.4), (1.3, 0.9, 0.9), col, rng, nu=6, nv=3, jit=0.35, shade=0.7)
        blob(g, (0.6, 0.4, 0.9), (0.7, 0.6, 0.6), col, rng, nu=5, nv=3, jit=0.35, shade=0.7)
        out.append(g)
    return out


def place_trees(block_rects, bridge_pts):
    rng = random.Random(21)
    trees = []
    step = 8.0
    x0, x1, y0, y1 = aabb(SHORE)
    x = x0
    while x <= x1:
        y = y0
        while y <= y1:
            px, py = x + (rng.random() - 0.5) * step * 0.9, y + (rng.random() - 0.5) * step * 0.9
            y += step
            if not inside(px, py, SHORE) or poly_dist(px, py, SHORE) < 3.5:
                continue
            u = radial_u(px, py)
            if u < 0.1:
                continue
            if any(f.contains(px, py, 2.2) for f in FEATS):
                continue
            if any(a <= px <= b and c <= py <= d for a, b, c, d in block_rects):
                continue
            if poly_dist(px, py, YANLOU, closed=False) < 8.5 or poly_dist(px, py, YUEGU) < 3.0:
                continue
            if rng.random() > (0.88 if u < 0.85 else 0.45):
                continue
            r = rng.random()
            if u < 0.6:
                kind = "pine" if r < 0.45 else "cypress" if r < 0.8 else "broad"
            else:
                kind = "broad" if r < 0.55 else "pine" if r < 0.85 else "cypress"
            trees.append((f"{kind}{rng.randrange(2)}", px, py, 1.0 + 0.55 * rng.random(), rng.random() * 6.283))
        x += step
    # willows' and scholar trees along the south shore either side of the bridge's landing
    return trees


def place_rocks(block_rects, trees):
    rng = random.Random(33)
    rocks = []
    tries = 0
    while len(rocks) < 130 and tries < 5000:
        tries += 1
        px, py = rng.uniform(-135, 110), rng.uniform(-185, 115)
        if not inside(px, py, SHORE) or poly_dist(px, py, SHORE) < 4:
            continue
        u = radial_u(px, py)
        if u < 0.12 or u > 0.88:
            continue
        if py < 20 and rng.random() < 0.6:          # most of the rockwork is on the north slope
            continue
        if any(f.contains(px, py, 1.2) for f in FEATS) or any(a <= px <= b and c <= py <= d for a, b, c, d in block_rects):
            continue
        if poly_dist(px, py, YANLOU, closed=False) < 7:
            continue
        rocks.append((rng.randrange(3), px, py, 0.7 + 1.0 * rng.random(), rng.random() * 6.283))
    return rocks


# ---- the build ---------------------------------------------------------------------------------------------------------

def light_post():
    """A marble baluster post with a pointed cap, lighter than kit.post_geo (hundreds of them here)."""
    g = Geo()
    g.box(-0.11, 0.11, -0.11, 0.11, 0.0, 1.05, "marble", skip=("-z", "+z"))
    for a, b in (((-0.13, -0.13), (0.13, -0.13)), ((0.13, -0.13), (0.13, 0.13)), ((0.13, 0.13), (-0.13, 0.13)), ((-0.13, 0.13), (-0.13, -0.13))):
        g.poly([(a[0], a[1], 1.05), (b[0], b[1], 1.05), (0.0, 0.0, 1.3)], "marble")
    return g


def light_panel():
    """A balustrade panel one metre along +X (scaled to fit): the slab and its hand rail."""
    g = Geo()
    g.box(0.0, 1.0, -0.06, 0.06, 0.0, 0.62, "marble", skip=("-x", "+x", "-z"))
    g.box(0.0, 1.0, -0.08, 0.08, 0.62, 0.84, "marble", skip=("-x", "+x", "-z"))
    return g


def collider_obox(coll, name, cx, cy, hx, hy, z0, z1, yaw, role="COL"):
    import bcity_landmark
    g = Geo()
    g.box(-hx, hx, -hy, hy, z0, z1, "x")
    o = g.build(name, coll, {"x": None})
    o.data.materials.clear()
    o.matrix_world = T(cx, cy, 0) @ Rz(yaw)
    bcity_landmark.rename(o, role)
    return o


def ramp(coll, name, f):
    """A walk-only ramp over a flight of steps."""
    # carried on flat a metre past the top, so the climb never meets the terrace's edge as a step
    collider_pts(coll, name, [(f.x0, f.y0, f.z0 - 0.05), (f.x1, f.y0, f.z0 - 0.05), (f.x0, f.y1, f.z1), (f.x1, f.y1, f.z1),
                              (f.x0, f.y1 + 1.0, f.z1), (f.x1, f.y1 + 1.0, f.z1), (f.x0, f.y1 + 1.0, f.z1 - 0.5), (f.x1, f.y1 + 1.0, f.z1 - 0.5),
                              (f.x0, f.y1, f.z0 - 0.4), (f.x1, f.y1, f.z0 - 0.4), (f.x0, f.y0, f.z0 - 0.4), (f.x1, f.y0, f.z0 - 0.4)], role="WALK")


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("琼华岛")
    parts = collection("构件", main)
    helpers = collection("碰撞体")
    floors = add_pads()
    meshes = dict(bracket=mesh_of(bracket_geo(lite=True), "BracketMesh", M, TILE), post=mesh_of(light_post(), "PostMesh", M, TILE),
                  panel=mesh_of(light_panel(), "PanelMesh", M, TILE))

    # buildings (their footprints keep the trees and rocks off)
    brects = []
    for b in BUILDINGS:
        name, cx, cy, w, d, yaw = b[:6]
        brects.append(aabb(corners(cx, cy, w, d, yaw, 1.2)))
    for name, cx, cy, r in PAVILIONS:
        brects.append((cx - r - 1.2, cx + r + 1.2, cy - r - 1.2, cy + r + 1.2))
    brects.append((-4.0, 4.0, -18.0, -10.6))
    yl = aabb(YUEGU)
    brects.append((yl[0] - 1.0, yl[1] + 1.0, yl[2] - 1.0, yl[3] + 1.0))

    bpts, _, _ = bridge_path()
    trees = place_trees(brects, bpts)
    rocks = place_rocks(brects, trees)

    # the hill (and its collider: the same triangles)
    hill = build_terrain(3.0, trees)
    hill.build("Hill", collection("山", main), M, TILE)
    hc = hill.build("hill", helpers, {"earth": None})
    hc.data.materials.clear()
    import bcity_landmark
    bcity_landmark.rename(hc, "COLMESH")
    tris = dict(hill=hill.tris())

    # terraces, flights, pads
    g = Geo()
    para_all = []
    feat_low = {}
    for f in FEATS:
        boxes, low = feature_geo(g, f, None, brects)
        para_all += boxes
        feat_low[f.name] = low
    tris["terraces"] = g.tris()

    # halls
    hall_info = {}
    for b in BUILDINGS:
        hg, m, info = make_hall(b, floors[b[0]], meshes, parts)
        if os.environ.get("TRIS"):
            print("  hall", b[0], hg.tris())
        g.add(hg, m)
        hall_info[b[0]] = (m, info)
    for name, cx, cy, r in PAVILIONS:
        pavilion(g, cx, cy, r, floors[name])
    tris["halls"] = g.tris() - tris["terraces"]

    # the dagoba and 善因殿
    dg = dagoba(PEAK)
    g.add(dg, Matrix.Identity(4))
    sg = shanyin(26.5)
    g.add(sg, T(SHANYIN[0], SHANYIN[1], 0))
    tris["dagoba"] = dg.tris()
    tris["shanyin"] = sg.tris()

    # 延楼 and 阅古楼, the north court's balustrade along the water
    yl_segs = band_building(g, YANLOU, 5.5, 0.85, 6.6, False, (0.0, 0.0))
    yg_segs = band_building(g, YUEGU, 6.0, floors["阅古楼"] + 0.3, 6.4, True, ((yl[0] + yl[1]) / 2, (yl[2] + yl[3]) / 2))
    rail = [p for p in offset_line(resample(YANLOU, 6.0, closed=False), -3.6, False, (0.0, 0.0)) if inside(p[0], p[1], SHORE) and poly_dist(p[0], p[1], SHORE) > 0.8]
    nrail = balustrade(parts, meshes, [(x, y, SHORE_Z) for x, y in rail], "yanlou_rail", gap=2.0)

    # the bridge, its balustrades and archways
    bpts, bacc, bz, bl, br = bridge(g)
    npanel = 0
    for sgn in (1, -1):
        side = offset_line(bpts, sgn * (DECK_W / 2 - 0.3), False, (1000.0, 0.0))
        line = [(p[0], p[1], zz) for p, zz in zip(side, bz)]
        npanel += balustrade(parts, meshes, line[1:-1], f"bridge_rail{sgn:+d}", gap=2.0)
    arch_n = archway(g, parts, M, meshes, 0.0, -175.5, 0.0, "云堆", "duiyun")
    arch_s = archway(g, parts, M, meshes, -12.6, -259.2, math.radians(2.7), "翠积", "jicui")
    tris["all"] = g.tris()
    g.build("Island", collection("岛", main), M, TILE)

    # trees and rocks as linked meshes
    tg, tfar = tree_geos()
    tmesh = {k: mesh_of(v, f"Tree_{k}", M, TILE) for k, v in tg.items()}
    tcoll = collection("树", main)
    ub = Geo()
    ub.box(-1, 1, -1, 1, -1, 1, "x")
    unit_box = ub.build("unitbox", helpers, {"x": None}).data
    unit_box.materials.clear()
    bpy.data.objects.remove(helpers.objects["unitbox"])
    import bcity_landmark
    for i, (k, x, y, s, a) in enumerate(trees):
        z = terrain(x, y) - 0.15
        place(tmesh[k], f"tree.{i:03d}", tcoll, T(x, y, z) @ Rz(a) @ Matrix.Diagonal((s, s, s, 1.0)))
        o = bpy.data.objects.new("trunk", unit_box)
        helpers.objects.link(o)
        o.matrix_world = T(x, y, z) @ Matrix.Diagonal((0.3, 0.3, 1.5, 1.0)) @ T(0, 0, 1)
        bcity_landmark.rename(o, "COL")
    rmesh = [mesh_of(v, f"Rock{k}", M, TILE) for k, v in enumerate(rock_geos())]
    for i, (k, x, y, s, a) in enumerate(rocks):
        z = terrain(x, y) - 0.35 * s
        place(rmesh[k], f"rock.{i:03d}", tcoll, T(x, y, z) @ Rz(a) @ Matrix.Diagonal((s, s, s * 0.8, 1.0)))

    # ---- far level
    far = build_terrain(8.0, trees, detail=False)
    for f in FEATS:
        if not f.pad or (f.x1 - f.x0) * (f.y1 - f.y0) > 150:
            feature_geo(far, f, None, [], lod=True)
    for b in BUILDINGS:
        hg, m, _ = make_hall(b, floors[b[0]], meshes, parts, lod=True)
        far.add(hg, m)
    for name, cx, cy, r in PAVILIONS:
        pavilion(far, cx, cy, r, floors[name], lod=True)
    far.add(dagoba(PEAK, lod=True), Matrix.Identity(4))
    far.add(shanyin(26.5, lod=True), T(SHANYIN[0], SHANYIN[1], 0))
    band_building(far, YANLOU, 5.5, 0.85, 6.6, False, (0.0, 0.0), lod=True)
    band_building(far, YUEGU, 6.0, floors["阅古楼"] + 0.3, 6.4, True, ((yl[0] + yl[1]) / 2, (yl[2] + yl[3]) / 2), lod=True)
    bridge(far, lod=True)
    fcoll = collection("LOD1", main)
    far.build("Massing", fcoll, M, TILE)
    fmesh = mesh_of(tfar, "TreeFar", M, TILE)
    for i, (k, x, y, s, a) in enumerate(trees):
        if k.startswith("cypress"):
            m_ = Matrix.Diagonal((s * 0.7, s * 0.7, s * 1.1, 1.0))
        else:
            m_ = Matrix.Diagonal((s, s, s * 0.85, 1.0))
        place(fmesh, f"treefar.{i:03d}", fcoll, T(x, y, terrain(x, y) - 0.2) @ Rz(a) @ m_)
    tris["far"] = far.tris()

    # ---- colliders
    for f in FEATS:
        if f.flight:
            ramp(helpers, "flight", f)
        else:
            low = feat_low[f.name]
            collider_box(helpers, "terrace", f.x0, f.x1, f.y0, f.y1, min(low, f.z0 - 0.5) - 0.5, f.z0 - 0.04)
    for xa, xb, ya, yb, z0, z1 in para_all:
        collider_box(helpers, "parapet", xa, xb, ya, yb, z0, z1)
    for b in BUILDINGS:
        m, (w, d, yaw, ztop) = hall_info[b[0]]
        c = m @ Vector((0, 0, 0))
        fl = floors[b[0]]
        top = fl + PLINTH + b[7] + (5.0 if b[6] == "tower" else 0.5)
        if b[0] in GATES:
            hw = gate_half(w)
            for sx in (-1, 1):
                cc = m @ Vector((sx * (hw + (w / 2 + 0.3 - hw) / 2), 0, 0))
                collider_obox(helpers, "hall", cc.x, cc.y, (w / 2 + 0.3 - hw) / 2, d / 2 + 0.3, fl - 0.7, top, math.radians(yaw))
            collider_obox(helpers, "hallfloor", c.x, c.y, hw, d / 2 + 0.6, fl - 0.7, fl + PLINTH, math.radians(yaw))
            collider_obox(helpers, "lintel", c.x, c.y, hw, d / 2 + 0.3, fl + PLINTH + 3.0, top, math.radians(yaw))
            # boxes are standable, not walkable: a walk-only wedge up onto the plinth, front and back
            for sy in (-1, 1):
                y0_, y1_ = sy * (d / 2 + 1.75), sy * (d / 2 + 0.55)
                pts = [(x_, y_, z_) for x_ in (-hw, hw) for y_, z_ in ((y0_, fl - 0.05), (y1_, fl + PLINTH), (y1_, fl - 0.3))]
                collider_pts(helpers, "gatestep", [tuple(m @ Vector(p_)) for p_ in pts], role="WALK")
        else:
            collider_obox(helpers, "hall", c.x, c.y, w / 2 + 0.3, d / 2 + 0.3, fl - 0.7, top, math.radians(yaw))
    for name, cx, cy, r in PAVILIONS:
        collider_box(helpers, "pavilion", cx - r - 0.5, cx + r + 0.5, cy - r - 0.5, cy + r + 0.5, floors[name] - 0.6, floors[name] + PLINTH)
        for k in range(8):
            a = 2 * math.pi * k / 8
            collider_box(helpers, "post", cx + r * math.cos(a) - 0.2, cx + r * math.cos(a) + 0.2, cy + r * math.sin(a) - 0.2, cy + r * math.sin(a) + 0.2,
                         floors[name] + PLINTH, floors[name] + 3.6)
    collider_box(helpers, "sumeru", -8.7, 8.7, -8.7, 8.7, PEAK, PEAK + 5.0)
    bulb_pts = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        for r, zz in ((7.6, PEAK + 5.0), (7.0, PEAK + 11.8), (6.3, PEAK + 16.0), (3.3, PEAK + 18.2)):
            bulb_pts.append((r * math.cos(a), r * math.sin(a), zz))
    collider_pts(helpers, "bulb", bulb_pts)
    collider_pts(helpers, "spire", [(r * math.cos(2 * math.pi * k / 8), r * math.sin(2 * math.pi * k / 8), zz)
                                    for k in range(8) for r, zz in ((3.9, PEAK + 18.2), (2.9, PEAK + 19.8), (1.8, PEAK + 28.4))])
    collider_box(helpers, "shanyin", SHANYIN[0] - 3.3, SHANYIN[0] + 3.3, SHANYIN[1] - 3.3, SHANYIN[1] + 3.3, 26.5 - 0.3, 26.5 + 5.5)
    for segs, z0, ze in ((yl_segs, 0.85, 6.6), (yg_segs, floors["阅古楼"] + 0.3, 6.4)):
        for a, b, ai, bi in segs:
            a, b, ai, bi = Vector(a), Vector(b), Vector(ai), Vector(bi)
            c = (a + b + ai + bi) / 4
            L = (b - a).length
            if L < 0.5:
                continue
            yaw = math.atan2(b.y - a.y, b.x - a.x)
            wd = ((ai + bi) / 2 - (a + b) / 2).length
            collider_obox(helpers, "range", c.x, c.y, L / 2, wd / 2, z0 - 0.8, z0 + ze, yaw)
    # the bridge: its deck as a trimesh (people and cars drive over it), the parapets as thin hulls
    bc = Geo()
    bridge(bc, lod=True)
    o = bc.build("bridge", helpers, {k: None for k in ("paving", "stone")})
    o.data.materials.clear()
    bcity_landmark.rename(o, "COLMESH")
    for side in (bl, br):
        for k in range(0, len(side) - 1, 4):
            k1 = min(len(side) - 1, k + 4)
            pts = []
            for q in range(k, k1 + 1):
                pts += [(side[q][0], side[q][1], bz[q]), (side[q][0], side[q][1], bz[q] + 1.1)]
            pts += [(p[0] + 0.01, p[1] + 0.01, p[2]) for p in pts[:2]]
            collider_pts(helpers, "rail", pts)
    for c in arch_n + arch_s:
        collider_box(helpers, "archcol", c.x - 0.5, c.x + 0.5, c.y - 0.5, c.y + 0.5, 0.0, 7.0)

    # footprint, clear zones
    flat_marker(helpers, "island", SHORE, "FOOTPRINT")
    bl2 = offset_line(bpts, DECK_W / 2 + 2, False, (1000.0, 0.0))
    br2 = offset_line(bpts, -DECK_W / 2 - 2, False, (1000.0, 0.0))
    flat_marker(helpers, "bridge", bl2 + br2[::-1], "FOOTPRINT")
    flat_marker(helpers, "island", SHORE, "CLEAR")
    flat_marker(helpers, "landing", [(-24, -268), (0, -268), (0, -236), (-24, -236)], "CLEAR")
    flat_marker(helpers, "span", [(-9, -240), (9, -240), (9, -186), (-9, -186)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "baita", "北海白塔", "White Dagoba, Beihai"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -1243.5, -1735.7, 0.0
    s.far_distance = 450
    s.repo_path = REPO
    tris.update(trees=len(trees), rocks=len(rocks), rail=nrail, bridge_rail=npanel)
    return tris


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
