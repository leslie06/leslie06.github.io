# 国家大剧院 National Centre for the Performing Arts (Paul Andreu, 2007), built in Blender, marked with the
# bcity_landmark add-on's conventions. OSM way 4974233 (height 46.68, roof:shape=dome) stands in the lake of
# relation 10039183 (natural=water, water=reflecting_pool) west of 人民大会堂, south of 西长安街; the city drew
# it as a 47 m drum of office windows.
#
#   blender -b -P scripts/blender/landmarks/ncpa.py -- [--out art/landmarks/ncpa.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (-1197.4, 610.8) - the centre of the OSM
# outline's box - heading -2.0 (the square's axis; the outline alone fits anything from -1 to -3, and with -2 the
# north entrance court lies on the model's axis). The real figures: the shell a semi-ellipsoid 212.2 x 143.64 m in
# plan, 46.285 m high (OSM says 46.68; its outline is ~10 m larger each way, traced at the water line), 18,000
# titanium panels in rows with a glass curtain (1,200 panes) running north-south over the crown, narrow at the top
# and opening like a stage curtain towards the water; the lake (35,500 m2, OSM's outline) all round it, water over a
# granite coping; the entry is an 80 m corridor under the water from a sunken court on the north (OSM's `steps`
# loop by 西长安街). The ground cannot be cut, so the court is drawn flat: its steps and floor painted, a glass
# balustrade round it, the corridor's lit doors at its south end.
# Round the lake: a granite promenade and a ring of lawn (clipped to the streets on either side), the north plaza
# and the path in from 西长安街's pavement. Flat things carry `layer` (city/Materials.ts: the city's water is 4.5,
# roads 5, paint 7) so the city's own water and park polygons underneath never show through.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_pts, flat_marker, mesh_of, paving, place  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "ncpa.blend")

GX, GZ, HEADING = -1197.4, 610.8, -2.0
A, B, H = 106.1, 71.82, 46.285          # the shell's semi-axes and height
W_TOP, W_BASE, W_POW = 12.0, 52.0, 1.8  # the glass band's half width at the crown and at the water, and its flare
FRAME = 0.9                             # the stainless edge between titanium and glass
PHI0 = -0.04                            # the shell runs on under the water
WATER, COPE, COPE_W = 0.2, 0.4, 0.7     # water surface, coping top and width
PAVE_Y, PAVE_W, LAWN_W = 0.03, 8.0, 15.0
TI = 8.0                                # metres per titanium texture repeat
SITE_X = (-1330.5, -1064.0)             # game x between 石碑胡同's footway and 人大会堂西路's pavement
COURT = dict(x=1.0, y=206.4, rx=51.0, ry=20.5)   # the sunken entry court (OSM's steps loop), local
PATH = (-12.0, 14.0, 224.0, 245.5)      # from the court to 西长安街's pavement
PLAZA = (-62.0, 62.0, 138.0, 196.0)     # between the lake and the court

# the lake's shore (relation 10039183's outer ring), game metres
LAKE_GAME = [
    (-1285.2, 467.4), (-1291.8, 468.2), (-1297.0, 469.8), (-1302.6, 472.7), (-1308.8, 478.1), (-1312.1, 483.5),
    (-1314.6, 488.4), (-1315.9, 493.9), (-1317.1, 501.0), (-1319.4, 514.0), (-1322.1, 535.8), (-1323.5, 549.5),
    (-1324.3, 563.8), (-1325.4, 582.3), (-1325.6, 599.2), (-1324.9, 624.3), (-1323.9, 641.9), (-1322.3, 653.7),
    (-1319.4, 666.1), (-1312.3, 690.9), (-1308.7, 700.2), (-1304.8, 706.0), (-1300.8, 710.4), (-1294.7, 714.3),
    (-1289.7, 716.1), (-1281.2, 717.8), (-1270.1, 719.3), (-1257.0, 720.5), (-1245.7, 721.4), (-1235.0, 721.8),
    (-1230.2, 721.9), (-1216.9, 722.2), (-1200.9, 722.4), (-1182.8, 722.0), (-1161.3, 720.2), (-1156.6, 719.6),
    (-1136.7, 716.9), (-1123.3, 714.4), (-1107.4, 710.7), (-1100.2, 708.7), (-1094.8, 706.8), (-1089.0, 703.2),
    (-1085.9, 700.0), (-1082.5, 695.6), (-1081.2, 692.3), (-1077.8, 683.5), (-1075.7, 675.3), (-1072.5, 661.7),
    (-1071.4, 652.7), (-1070.2, 638.8), (-1069.7, 631.1), (-1069.7, 614.4), (-1070.3, 601.8), (-1072.2, 575.9),
    (-1074.4, 552.0), (-1076.3, 537.7), (-1081.4, 512.8), (-1086.2, 489.9), (-1088.1, 482.5), (-1089.6, 478.6),
    (-1092.0, 474.3), (-1094.4, 470.7), (-1097.3, 467.7), (-1102.0, 464.4), (-1106.2, 462.7), (-1111.7, 461.5),
    (-1124.4, 460.4), (-1131.5, 460.3), (-1177.9, 459.7), (-1188.2, 459.7), (-1215.8, 460.9), (-1241.1, 462.7),
    (-1270.7, 465.5),
]

_R = -HEADING * math.pi / 180
_C, _S = math.cos(_R), math.sin(_R)


def to_local(gx, gz):
    """Game (x, z) to the model's (X east, Y north), the inverse of city/index.ts toWorld."""
    dx, dz = gx - GX, gz - GZ
    return (dx * _C - dz * _S, -(dx * _S + dz * _C))


def to_game(x, y):
    lz = -y
    return (GX + x * _C + lz * _S, GZ - x * _S + lz * _C)


# ---- textures ----------------------------------------------------------------------------------------------

def titanium_images(size=512):
    """Titanium panels in rows, 8 m a repeat: 2 x 1 m panels, courses offset, fine dark joints, a few
    per cent of tint; and the night map - a sparse field of small warm points (the shell's star lights)."""
    cv = Canvas(size, size, "#c4c6c5")
    ppm = size / TI
    rows = (cv.y // ppm).astype(int)
    colw = 2 * ppm
    cols = ((cv.x + (rows % 2) * colw / 2) // colw).astype(int)
    rng = np.random.default_rng(31)
    cv.a *= rng.uniform(0.955, 1.04, (9, 5))[rows % 9, cols % 5][..., None]
    # a faint brushed grain along the rows
    cv.a *= (0.985 + 0.03 * rng.random((1, size, 1))).astype(np.float32)
    joint = (np.mod(cv.y, ppm) < 1.6) | (np.mod(cv.x + (rows % 2) * colw / 2, colw) < 1.6)
    cv.a[joint] *= 0.7
    night = Canvas(size, size, "#000000")
    for _ in range(7):
        x, y = rng.uniform(0, size, 2)
        night.ellipse(x, y, 3.2, 3.2, "#ffe2b0")
    return image("NC_Titanium", np.flipud(cv.a).copy()), image("NC_TitaniumNight", np.flipud(night.a).copy())


def lawn_image(size=256):
    cv = Canvas(size, size, "#6c8a50")
    rng = np.random.default_rng(41)
    # soft blotches (whole periods of sines, so the tile repeats seamlessly)
    u, v = cv.x / size * 2 * math.pi, cv.y / size * 2 * math.pi
    cv.a *= (1 + 0.035 * np.sin(u + 2 * np.sin(v)) + 0.03 * np.sin(2 * v + np.sin(3 * u) + 1.3))[..., None]
    cv.noise(0.22, 42)
    # mowing stripes
    cv.a *= (1.0 + 0.035 * np.sign(np.sin(cv.y / size * 2 * math.pi * 2)))[..., None]
    return image("NC_Lawn", np.flipud(cv.a).copy())


def court_images(w=1024, h=512):
    """The sunken entry court seen from above, its bounding box: flights of steps round the rim (lighter
    treads, darker nosing lines, darkening as they go down), the floor of granite flags, a ramp down the
    north axis, the corridor's glazed doors at the south end (and those doors lit at night)."""
    rx, ry = COURT["rx"], COURT["ry"]
    cv = Canvas(w, h, "#bdb8ae")
    sx, sy = w / (2 * rx), h / (2 * ry)
    X, Y = (cv.x - w / 2) / sx, (cv.y - h / 2) / sy        # metres, +Y down the image = north (flipped below)
    e = np.sqrt((X / rx) ** 2 + (Y / ry) ** 2)
    band = 7.0                                            # the steps' plan depth
    depth = (1 - e) * min(rx, ry)                         # roughly metres in from the rim
    steps = (depth > 0) & (depth < band)
    tread = np.mod(depth, 0.5)
    shade = 1.0 - 0.28 * np.clip(depth / band, 0, 1)
    cv.a[steps] *= shade[steps][..., None]
    cv.a[steps & (tread < 0.09)] = srgb_("#77736b")
    floor = depth >= band
    fx, fy = np.mod(X, 1.2), np.mod(Y, 1.2)
    cv.a[floor] = srgb_("#8f8b83")
    cv.a[floor & ((fx < 0.05) | (fy < 0.05))] = srgb_("#6e6a63")
    # the ramp down the north axis: image rows with Y < 0 are north once flipped
    ramp = (np.abs(X - 0.0) < 3.2) & (Y < 0) & (depth < band + 0.5)
    cv.a[ramp] = srgb_("#a7a39a")
    cv.a[ramp & (np.abs(np.abs(X) - 3.2) < 0.12)] = srgb_("#55524c")
    # the corridor doors: a dark glazed front across the south end of the floor
    door = (np.abs(X) < 9.0) & (Y > ry - band - 2.2) & (Y < ry - band + 0.3)
    cv.a[door] = srgb_("#2c2926")
    mull = door & (np.mod(X + 9.0, 1.8) < 0.12)
    cv.a[mull] = srgb_("#7b7f82")
    night = Canvas(w, h, "#000000")
    night.a[door & ~mull] = srgb_("#ffcf8e")
    return (image("NC_Court", np.flipud(cv.a).copy()), image("NC_CourtNight", np.flipud(night.a).copy()))


def srgb_(h):
    from common import srgb
    return srgb(h)


def materials():
    ti, ti_night = titanium_images()
    court, court_night = court_images()
    glass_spec = dict(floorH=2.1, colW=2.6, glass="#48525b", frame="#9aa1a6", spandrel="#9aa1a6", mull=0.035, slab=0.045,
                      metal=0.75, rough=0.06, lit=0.45, warm="#ffc88a", coolShare=0.0, seed=17,
                      crown=dict(**{"from": -20.0}, glow=0.4, color="#ffc080"))
    return dict(
        ti=material("NC_Titanium", "#c4c6c5", 0.42, metal=0.55, tex=ti, emit_tex=ti_night,
                    props={"wet": "surface", "emit": "night", "glow": "flood", "glowStrength": 0.35}),
        frame=material("NC_Frame", "#7c8286", 0.3, metal=0.85, props={"wet": "surface", "glow": "none"}),
        glass=material("NC_Glass", "#8a9aa8", 0.1, metal=0.8, props={"facade": json.dumps(glass_spec), "wet": "surface", "glow": "none"}),
        water=material("NC_Water", "#26383d", 0.04, metal=0.15, props={"wet": "none", "glow": "none", "layer": 10}),
        coping=material("NC_Coping", "#bdb8ae", 0.6, props={"wet": "ground", "glow": "none", "layer": 10}),
        pave=material("NC_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        lawn=material("NC_Lawn", "#6c8a50", 0.95, tex=lawn_image(), props={"wet": "damp", "glow": "none", "layer": 6}),
        court=material("NC_Court", "#bdb8ae", 0.7, tex=court, emit_tex=court_night,
                       props={"wet": "ground", "glow": "none", "emit": "night", "layer": 9}),
        railglass=material("NC_RailGlass", "#a9bcc2", 0.08, metal=0.3, props={"wet": "surface", "glow": "none"}),
        steel=material("NC_Steel", "#5f6468", 0.35, metal=0.85, props={"wet": "surface", "glow": "none"}),
        lamp=material("NC_Lamp", "#fff1d6", 0.4, props={"glow": "lamp", "glowColor": "#ffd9a0", "glowStrength": 1.2}),
    )


TILE = dict(pave=4.0, lawn=6.0, coping=2.0, steel=2.0, railglass=2.0, lamp=1.0, water=10.0, frame=2.0)


# ---- the shell ---------------------------------------------------------------------------------------------

def band_half(t):
    return W_TOP + (W_BASE - W_TOP) * (1 - max(0.0, min(1.0, t))) ** W_POW


def shell(g, rows, nt, ng, a_=A, b_=B, h_=H):
    """The semi-ellipsoid, ring by ring from under the water to the crown. Every ring has the same columns:
    in each quadrant `nt` of titanium from the east/west point to the glass edge, one of stainless frame,
    `ng` of glass to the north/south point, so the band's edge is a clean line of vertices."""
    q1_mat = ["ti"] * nt + ["frame"] + ["glass"] * ng
    ring_mat = q1_mat + q1_mat[::-1] + q1_mat + q1_mat[::-1]
    rings, pts = [], []
    for i in range(rows):
        phi = PHI0 + (math.pi / 2 - PHI0) * i / rows
        a, b, z = a_ * math.cos(phi), b_ * math.cos(phi), h_ * math.sin(phi)
        w = band_half(max(z, 0.0) / h_)
        te = math.acos(min(1.0, w / a))
        ds = math.sqrt((a * math.sin(te)) ** 2 + (b * math.cos(te)) ** 2)
        dt = min(te, FRAME / max(ds, 1e-6))
        q1 = [(te - dt) * k / nt for k in range(nt + 1)] + [te] + [te + (math.pi / 2 - te) * k / ng for k in range(1, ng + 1)]
        full = q1[:-1] + [math.pi - x for x in q1[::-1]][:-1] + [math.pi + x for x in q1][:-1] + [2 * math.pi - x for x in q1[::-1]][:-1]
        ring = [Vector((a * math.cos(th), b * math.sin(th), z)) for th in full]
        pts.append(ring)
    apex = Vector((0.0, 0.0, h_))
    n = len(pts[0])
    # u: arc along each ring, rescaled to whole texture repeats; v: arc up each column
    us = []
    for ring in pts:
        s = [0.0]
        for j in range(n):
            s.append(s[-1] + (ring[(j + 1) % n] - ring[j]).length)
        k = max(1, round(s[-1] / TI))
        us.append([x * k * TI / max(s[-1], 1e-6) for x in s])
    vs = [[0.0] * n]
    for i in range(1, rows):
        vs.append([vs[-1][j] + (pts[i][j] - pts[i - 1][j]).length for j in range(n)])
    idx = [[g.vert(p) for p in ring] for ring in pts]
    top = g.vert(apex)
    vtop = [vs[-1][j] + (apex - pts[-1][j]).length for j in range(n)]

    def uv(key, u, v):
        return (u / TI, v / TI) if key == "ti" else (u, v)

    for i in range(rows):
        for j in range(n):
            key = ring_mat[j]
            j1 = (j + 1) % n
            u0, u1 = us[i][j], us[i][j + 1]
            if i < rows - 1:
                w0, w1 = us[i + 1][j], us[i + 1][j + 1]
                q = [idx[i][j], idx[i][j1], idx[i + 1][j1], idx[i + 1][j]]
                uvs = [uv(key, u0, vs[i][j]), uv(key, u1, vs[i][j1]), uv(key, w1, vs[i + 1][j1]), uv(key, w0, vs[i + 1][j])]
                g.face(q, key, uvs, smooth=True)
            else:
                um = (u0 + u1) / 2
                g.face([idx[i][j], idx[i][j1], top], key, [uv(key, u0, vs[i][j]), uv(key, u1, vs[i][j1]), uv(key, um, vtop[j])], smooth=True)
    return pts


def clean(ob):
    """Merge the vertices the collapsed titanium columns leave near the crown, drop the zero-area faces."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-3)
    bm.to_mesh(ob.data)
    bm.free()


# ---- the lake and the ground round it ----------------------------------------------------------------------

def resample(pts, step):
    """A closed ring resampled every ~`step` metres, smoothed a little, counter-clockwise."""
    P = [Vector((x, y)) for x, y in pts]
    area = sum(P[i].x * P[(i + 1) % len(P)].y - P[(i + 1) % len(P)].x * P[i].y for i in range(len(P)))
    if area < 0:
        P = P[::-1]
    L = [0.0]
    for i in range(len(P)):
        L.append(L[-1] + (P[(i + 1) % len(P)] - P[i]).length)
    n = max(8, round(L[-1] / step))
    out, k = [], 0
    for m in range(n):
        s = L[-1] * m / n
        while L[k + 1] < s:
            k += 1
        t = (s - L[k]) / max(L[k + 1] - L[k], 1e-9)
        out.append(P[k].lerp(P[(k + 1) % len(P)], t))
    for _ in range(3):
        out = [(out[i - 1] + out[i] * 2 + out[(i + 1) % n]) / 4 for i in range(n)]
    return out


def normals(ring):
    n = len(ring)
    out = []
    for i in range(n):
        d = (ring[(i + 1) % n] - ring[i - 1]).normalized()
        out.append(Vector((d.y, -d.x)))
    return out


def clip_site(p):
    gx, gz = to_game(p.x, p.y)
    gx = min(max(gx, SITE_X[0]), SITE_X[1])
    return Vector(to_local(gx, gz))


def ring_strip(g, ring, nrm, off0, off1, z, key, want=(0, 0, 1), skip=None, clip=True):
    n = len(ring)
    inner = [ring[i] + nrm[i] * off0 for i in range(n)]
    outer = [ring[i] + nrm[i] * off1 for i in range(n)]
    if clip:
        inner, outer = [clip_site(p) for p in inner], [clip_site(p) for p in outer]
    for i in range(n):
        k = (i + 1) % n
        if skip and (skip(ring[i], nrm[i]) or skip(ring[k], nrm[k])):
            continue
        q = [inner[i], inner[k], outer[k], outer[i]]
        if (q[2] - q[1]).length < 0.05 and (q[3] - q[0]).length < 0.05:
            continue
        g.polyn([(p.x, p.y, z) for p in q], key, want)


def lake_water(g, lake, a_, b_, n=144):
    """The water from the shell's water line to the shore: rays from the centre, shore point and ellipse point."""
    def shore(alpha):
        d = Vector((math.cos(alpha), math.sin(alpha)))
        best = None
        for i in range(len(lake)):
            p, q = lake[i], lake[(i + 1) % len(lake)]
            e = q - p
            den = d.x * e.y - d.y * e.x
            if abs(den) < 1e-9:
                continue
            t = (p.x * e.y - p.y * e.x) / den
            s = (p.x * d.y - p.y * d.x) / den
            if t > 0 and -1e-6 <= s <= 1 + 1e-6 and (best is None or t < best):
                best = t
        return d * best
    for m in range(n):
        a0, a1 = 2 * math.pi * m / n, 2 * math.pi * (m + 1) / n
        pts = []
        for al in (a0, a1):
            r = 1 / math.sqrt((math.cos(al) / a_) ** 2 + (math.sin(al) / b_) ** 2)
            pts.append(Vector((math.cos(al), math.sin(al))) * r)
        s0, s1 = shore(a0), shore(a1)
        g.polyn([(pts[0].x, pts[0].y, WATER), (pts[1].x, pts[1].y, WATER), (s1.x + 0.0, s1.y, WATER), (s0.x, s0.y, WATER)], "water", (0, 0, 1))


def ellipse_pts(rx, ry, n, cx=0.0, cy=0.0):
    return [Vector((cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n))) for k in range(n)]


def box_obj(coll, name, center, half, yaw, role="COL"):
    """A yaw-only box collider (the game reads it as a box)."""
    import bcity_landmark
    g = Geo()
    g.box(-half[0], half[0], -half[1], half[1], -half[2], half[2], "x")
    o = g.build(name, coll, {"x": None})
    o.data.materials.clear()
    o.matrix_world = Matrix.Translation(center) @ Matrix.Rotation(yaw, 4, "Z")
    bcity_landmark.rename(o, role)
    return o


def seg_colliders(coll, name, pts, closed, width, z0, z1, max_len=12.0, skip=None):
    n = len(pts)
    segs = [(pts[i], pts[(i + 1) % n]) for i in range(n if closed else n - 1)]
    # join short pieces into runs up to max_len (straight enough on these gentle curves)
    runs, cur = [], None
    for a, b in segs:
        if skip and skip((a + b) / 2):
            if cur:
                runs.append(cur)
            cur = None
            continue
        if cur and (b - cur[0]).length <= max_len:
            cur = (cur[0], b)
        else:
            if cur:
                runs.append(cur)
            cur = (a, b)
    if cur:
        runs.append(cur)
    for a, b in runs:
        d = b - a
        mid = (a + b) / 2
        box_obj(coll, name, (mid.x, mid.y, (z0 + z1) / 2), (d.length / 2 + 0.35, width / 2, (z1 - z0) / 2), math.atan2(d.y, d.x))
    return len(runs)


def rail_geo(g, pts, skip, h=1.1):
    """A glass balustrade: steel posts every segment, a steel handrail, glass panels between (both faces)."""
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        if skip((a + b) / 2):
            continue
        d = (b - a)
        L = d.length
        t = d / L
        nn = Vector((-t.y, t.x)) * 0.03
        g.box(a.x - 0.05, a.x + 0.05, a.y - 0.05, a.y + 0.05, 0.0, h, "steel")
        q = [(a.x + nn.x, a.y + nn.y, 0.1), (b.x + nn.x, b.y + nn.y, 0.1), (b.x + nn.x, b.y + nn.y, h - 0.08), (a.x + nn.x, a.y + nn.y, h - 0.08)]
        g.polyn(q, "railglass", (-t.y, t.x, 0))
        g.polyn([(p[0] - 2 * nn.x, p[1] - 2 * nn.y, p[2]) for p in q], "railglass", (t.y, -t.x, 0))
        r0, r1 = Vector((-t.y, t.x)) * 0.05, Vector((t.y, -t.x)) * 0.05
        g.polyn([(a.x + r0.x, a.y + r0.y, h), (b.x + r0.x, b.y + r0.y, h), (b.x + r1.x, b.y + r1.y, h), (a.x + r1.x, a.y + r1.y, h)], "steel", (0, 0, 1))
        g.polyn([(a.x + r0.x, a.y + r0.y, h - 0.08), (b.x + r0.x, b.y + r0.y, h - 0.08), (b.x + r0.x, b.y + r0.y, h), (a.x + r0.x, a.y + r0.y, h)], "steel", (-t.y, t.x, 0))
        g.polyn([(a.x + r1.x, a.y + r1.y, h - 0.08), (b.x + r1.x, b.y + r1.y, h - 0.08), (b.x + r1.x, b.y + r1.y, h), (a.x + r1.x, a.y + r1.y, h)], "steel", (t.y, -t.x, 0))


def court_geo(g):
    c = COURT
    pts = ellipse_pts(c["rx"], c["ry"], 64, c["x"], c["y"])
    uvs = [((p.x - c["x"] + c["rx"]) / (2 * c["rx"]), (p.y - c["y"] + c["ry"]) / (2 * c["ry"])) for p in pts]
    g.poly([(p.x, p.y, 0.05) for p in pts], "court", uvs)


def rect_poly(g, x0, x1, y0, y1, z, key):
    g.polyn([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], key, (0, 0, 1))


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("国家大剧院")
    lake = resample([to_local(x, z) for x, z in LAKE_GAME], 4.0)
    nrm = normals(lake)

    # the shell
    gs = Geo()
    shell(gs, 44, 30, 12)
    ob = gs.build("Shell", collection("壳体", main), M, TILE)
    clean(ob)
    tris_shell = sum(len(p.vertices) - 2 for p in ob.data.polygons)

    # the lake, its coping, the promenade, the lawn, the north plaza, the court and its balustrade
    g = Geo()
    lake_water(g, lake, A * 0.995, B * 0.995)
    ring_strip(g, lake, nrm, -COPE_W / 2, COPE_W / 2, COPE, "coping", clip=False)
    inner = [lake[i] - nrm[i] * (COPE_W / 2) for i in range(len(lake))]
    outer = [lake[i] + nrm[i] * (COPE_W / 2) for i in range(len(lake))]
    for i in range(len(lake)):
        k = (i + 1) % len(lake)
        g.polyn([(inner[i].x, inner[i].y, 0.0), (inner[k].x, inner[k].y, 0.0), (inner[k].x, inner[k].y, COPE), (inner[i].x, inner[i].y, COPE)], "coping", (-nrm[i].x, -nrm[i].y, 0))
        g.polyn([(outer[i].x, outer[i].y, 0.0), (outer[k].x, outer[k].y, 0.0), (outer[k].x, outer[k].y, COPE), (outer[i].x, outer[i].y, COPE)], "coping", (nrm[i].x, nrm[i].y, 0))
    ring_strip(g, lake, nrm, COPE_W / 2 - 0.05, PAVE_W, PAVE_Y, "pave")

    def north(p, n):
        return n.y > 0.35 and abs(p.x) < PLAZA[1]

    ring_strip(g, lake, nrm, PAVE_W - 0.05, PAVE_W + LAWN_W, PAVE_Y - 0.01, "lawn", skip=north)
    rect_poly(g, *PLAZA, PAVE_Y, "pave")
    rect_poly(g, *PATH, PAVE_Y, "pave")
    court_geo(g)
    c = COURT
    rail = ellipse_pts(c["rx"] + 0.3, c["ry"] + 0.3, 48, c["x"], c["y"])

    def rail_gap(p):
        # open to the north, where the steps come up from the path, and where the ramp meets the rim
        return p.y > c["y"] and abs(p.x - c["x"]) < 16

    rail_geo(g, rail, rail_gap)
    ground = g.build("Lake", collection("湖面与广场", main), M, TILE)
    tris_ground = g.tris()

    # bollard lights on the coping, linked duplicates (two InstancedMeshes)
    gb, gh = Geo(), Geo()
    gb.box(-0.09, 0.09, -0.09, 0.09, 0.0, 0.55, "steel")
    gh.box(-0.1, 0.1, -0.1, 0.1, 0.55, 0.67, "lamp", skip=("-z",))
    me_b, me_h = mesh_of(gb, "bollard", M, TILE), mesh_of(gh, "bollard_head", M, TILE)
    lights = collection("岸灯", main)
    L = sum((lake[(i + 1) % len(lake)] - lake[i]).length for i in range(len(lake)))
    nl = round(L / 16)
    step = len(lake) / nl
    for k in range(nl):
        p = lake[int(k * step) % len(lake)]
        m = Matrix.Translation((p.x, p.y, COPE))
        place(me_b, f"bollard{k}", lights, m)
        place(me_h, f"bollard_head{k}", lights, m)

    # far level: a coarser shell, the water and the promenade
    far = Geo()
    shell(far, 12, 6, 4)
    lake_far = resample([to_local(x, z) for x, z in LAKE_GAME], 12.0)
    lake_water(far, lake_far, A * 0.99, B * 0.99, n=64)
    ring_strip(far, lake_far, normals(lake_far), -COPE_W / 2, PAVE_W, PAVE_Y, "pave")
    fo = far.build("Massing", collection("LOD1", main), M, TILE)
    clean(fo)

    # colliders
    helpers = collection("碰撞体")
    hull = []
    for i in range(7):
        phi = (math.pi / 2) * i / 6
        z = H * math.sin(phi)
        for k in range(20 if i < 6 else 1):
            th = 2 * math.pi * k / 20
            hull.append((A * math.cos(phi) * math.cos(th), B * math.cos(phi) * math.sin(th), z))
    for k in range(20):
        th = 2 * math.pi * k / 20
        hull.append((A * math.cos(th), B * math.sin(th), -0.5))
    collider_pts(helpers, "shell", hull)
    n_cope = seg_colliders(helpers, "coping", lake, True, 0.9, -0.2, 1.0, max_len=8.5)
    n_rail = seg_colliders(helpers, "rail", rail, True, 0.3, 0.0, 1.1, max_len=5.0, skip=rail_gap)
    # footprint: the shell with a margin over OSM's outline (222 x 154 m), the court and path (a machine-learnt
    # block stood in the court); clear: the lake, the promenade, the plaza, the court and the path
    flat_marker(helpers, "shell", [(p.x, p.y) for p in ellipse_pts(114.0, 80.0, 48)], "FOOTPRINT")
    flat_marker(helpers, "court", [(PATH[0] - 44, 184.0), (PATH[1] + 44, 184.0), (PATH[1] + 44, PATH[3]), (PATH[0] - 44, PATH[3])], "FOOTPRINT")
    flat_marker(helpers, "lake", [(p.x, p.y) for p in [clip_site(lake[i] + nrm[i] * PAVE_W) for i in range(len(lake))]], "CLEAR")
    flat_marker(helpers, "north", [(PLAZA[0], PLAZA[2]), (PLAZA[1], PLAZA[2]), (PLAZA[1], PATH[3]), (PLAZA[0], PATH[3])], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "ncpa", "国家大剧院", "National Centre for the Performing Arts"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 1200
    s.repo_path = REPO
    return dict(shell=tris_shell, ground=tris_ground, far=far.tris(), coping_boxes=n_cope, rail_boxes=n_rail, lights=nl)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
