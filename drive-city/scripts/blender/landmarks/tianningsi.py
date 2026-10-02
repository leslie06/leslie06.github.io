# 天宁寺塔 the Liao-dynasty pagoda of Tianning Temple outside 广安门, with the temple's halls round it, built in
# Blender and marked with the bcity_landmark add-on's conventions. OSM has the pagoda's octagon (way 532863319,
# height 57.8, roof:levels 13) and the temple's halls (ways 532863291-532865691) and precinct (way 532740640); the
# city drew the pagoda as a 58 m octagonal block of flats and the halls as small houses.
#
#   blender -b -P scripts/blender/landmarks/tianningsi.py -- [--out art/landmarks/tianningsi.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the pagoda's centre, game (-4934.4, 1680.0),
# heading -2.5 (the halls' edges; the octagon's run 3.4). OSM points are given in game metres relative to
# (-4936, 1680) as `near.mts` prints them and turned into this frame by `L`.
#
# The pagoda (zh.wikipedia 天宁寺塔 (北京), 中新网; proportions from photographs): a solid octagonal brick pagoda
# of the 密檐 kind, 57.8 m: a low terrace (OSM's octagon), two 须弥座 with carved 壶门 in their waists, the 平座
# with brick brackets and a balustrade, three tiers of upturned lotus petals; the first storey with brick false
# doors on the four cardinal faces and 直棂 windows on the diagonals, guardian figures either side and a
# half-round relief over each, round corner pillars; thirteen close-set eaves on brick brackets, the lowest
# widest, tapering with a convex curve (卷杀), glazed tile tops and corner ridges, a bell at every corner; on
# top two octagonal lotus seats and the pearl. Reliefs are painted into one atlas, not modelled.
# The halls: single-storey 硬山 (gabled) halls with red walls and grey roofs at OSM's outlines and heights
# (the side halls face the axis), 接引殿 and the bell and drum towers under hall.py 歇山 roofs (imported, not
# edited), and the precinct wall (red, a tiled coping) along OSM's boundary, its south side through the gate.
# Doubtful: the pagoda's widths (only the height is published here), the hall fronts.

import math
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, Rz, collider_box, collider_pts, coping, cyl, ell, flat_marker, mesh_of, paving, place  # noqa: E402
from hall import paint_atlas, plaster, ring_beams, roofs, sweep, uvs as huvs  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "tianningsi.blend")
HEADING = -2.5
C22 = math.cos(math.pi / 8)


def L(e, s):
    """Game metres relative to (-4936, 1680) (+x east, +z south) to this frame."""
    e -= 1.6
    n = -s
    a = math.radians(-HEADING)
    return (e * math.cos(a) + n * math.sin(a), -e * math.sin(a) + n * math.cos(a))


def rect_of(pts):
    q = [L(*p) for p in pts]
    xs, ys = [p[0] for p in q], [p[1] for p in q]
    return min(xs), max(xs), min(ys), max(ys)


# OSM outlines (relative to (-4936, 1680)), height, kind, front: S (-Y), N, E, W
HALLS = [
    ("三空门", [(-1.0, 95.1), (12.1, 94.7), (12.2, 101.0), (-0.8, 101.4)], 5.0, "gable", "S"),
    ("鼓楼", [(-18.4, 84.4), (-11.4, 84.1), (-11.1, 91.4), (-18.1, 91.7)], 8.0, "tower", "S"),
    ("钟楼", [(19.8, 83.0), (26.8, 82.6), (27.2, 89.9), (20.2, 90.3)], 8.0, "tower", "S"),
    ("药师殿", [(13.1, 23.0), (22.8, 22.7), (23.1, 34.7), (13.4, 34.9)], 5.0, "gable", "W"),
    ("弥陀殿", [(-19.5, 24.5), (-10.9, 24.0), (-10.2, 35.4), (-18.9, 36.0)], 5.0, "gable", "E"),
    ("接引殿", [(-8.8, 43.2), (15.2, 41.7), (16.2, 57.1), (-7.9, 58.5)], 8.0, "main", "S"),
    ("伽蓝殿", [(19.6, 70.1), (26.8, 69.8), (27.3, 81.2), (20.1, 81.6)], 5.0, "gable", "W"),
    ("祖师殿", [(-19.4, 72.6), (-11.8, 72.2), (-11.2, 82.3), (-18.8, 82.7)], 5.0, "gable", "E"),
    ("五观堂", [(19.2, 36.5), (25.2, 36.2), (26.7, 68.5), (20.7, 68.8)], 4.2, "gable", "W"),
    ("僧舍", [(-21.0, 37.5), (-14.6, 37.1), (-12.5, 71.4), (-18.9, 71.8)], 4.2, "gable", "E"),
    ("西配房", [(-4.9, 92.2), (-14.9, 92.5), (-14.6, 99.6), (-4.7, 99.3)], 4.6, "gable", "N"),
    ("东配房", [(15.5, 98.4), (15.3, 92.2), (24.3, 91.9), (24.5, 98.1)], 4.6, "gable", "N"),
]
# the precinct wall (OSM's boundary, the west side 0.6 m in, the south side along the gate's front)
WALL_PTS = [(-25.9, -52.7), (24.5, -54.5), (28.39, 100.6), (12.2, 100.6), "gate", (-1.0, 100.6), (-20.85, 100.6)]
PAGODA_R = 15.1                      # OSM's octagon: the terrace
FOOT_EXTRA = [[(-3.0, 15.0), (12.5, 15.0), (12.5, 28.0), (-3.0, 28.0)],          # learnt roofs over the court and behind the pagoda
              [(5.0, -35.5), (16.0, -35.5), (16.0, -22.0), (5.0, -22.0)]]

# --- the relief atlas -------------------------------------------------------------------------------------------
RW, RH = 2048, 1024
RREG = dict(door=(0, 0, 512, 1024), window=(512, 0, 1024, 1024), waist1=(1024, 0, 2048, 128), waist2=(1024, 128, 2048, 256),
            brackets=(1024, 256, 2048, 384), rail=(1024, 384, 2048, 512), lotus=(1024, 512, 2048, 640), rafters=(1024, 640, 1536, 768),
            beam=(1536, 640, 2048, 768), pillar=(1024, 768, 1536, 1024))
STONE = "#8f8b83"
LIGHT = "#b9b5ab"
SHADE = "#5e5b55"


def ruv(region, fu, fv):
    x0, y0, x1, y1 = RREG[region]
    x0, y0, x1, y1 = x0 + 2, y0 + 2, x1 - 2, y1 - 2
    return ((x0 + fu * (x1 - x0)) / RW, 1 - (y1 - fv * (y1 - y0)) / RH)


def relief(cv, mask, lift=3):
    """A raised shape: lit body, a dark shadow below-right of it."""
    sh = np.roll(np.roll(mask, lift, axis=0), lift, axis=1) & ~mask
    cv.a[sh] *= 0.62
    cv.a[mask] = cv.a[mask] * 0.35 + cv.c(LIGHT) * 0.65


def figure(sub, cx, y0, y1, w):
    """A standing guardian (力士): head, shoulders, a flaring robe, an arm raised."""
    h = y1 - y0
    m = np.zeros(sub.a.shape[:2], bool)
    X, Y = sub.x, sub.y
    m |= ((X - cx) / (w * 0.18)) ** 2 + ((Y - (y0 + h * 0.07)) / (h * 0.07)) ** 2 <= 1
    body = (Y > y0 + h * 0.13) & (Y < y1) & (np.abs(X - cx) < w * (0.28 + 0.22 * (Y - y0) / h))
    m |= body
    m |= (np.abs(X - (cx + w * 0.42)) < w * 0.08) & (Y > y0 + h * 0.05) & (Y < y0 + h * 0.4)
    m |= ((X - cx) / (w * 0.5)) ** 2 + ((Y - (y0 + h * 0.22)) / (h * 0.06)) ** 2 <= 1
    relief(sub, m, 4)
    sub.a[(np.abs(X - cx) < 1.5) & (Y > y0 + h * 0.5) & (Y < y1)] *= 0.7


def lunette(sub, cx, cy, r):
    """The half-round relief over a door or window: a frame, a seated figure, clouds."""
    X, Y = sub.x, sub.y
    d = np.hypot(X - cx, Y - cy)
    half = Y <= cy
    sub.a[half & (d < r)] *= 0.8
    relief(sub, half & (d > r * 0.86) & (d < r), 3)
    relief(sub, (((X - cx) / (r * 0.22)) ** 2 + ((Y - (cy - r * 0.55)) / (r * 0.16)) ** 2 <= 1)
           | ((np.abs(X - cx) < r * (0.35 - 0.25 * (cy - Y) / r)) & (Y < cy) & (Y > cy - r * 0.45)), 3)
    for k in (-1, 1):
        relief(sub, ((X - cx - k * r * 0.6) / (r * 0.18)) ** 2 + ((Y - cy + r * 0.25) / (r * 0.1)) ** 2 <= 1, 2)


def relief_atlas():
    cv = Canvas(RW, RH, STONE)
    cv.noise(0.1, 7)

    def sub(name):
        x0, y0, x1, y1 = RREG[name]
        s = Canvas(x1 - x0, y1 - y0, STONE)
        s.a[:] = cv.a[y0:y1, x0:x1]
        return s

    def paste(name, s):
        x0, y0, x1, y1 = RREG[name]
        cv.a[y0:y1, x0:x1] = s.a

    # the cardinal faces: a false door (two leaves of studs under a round arch), guardians, a lunette above
    for name in ("door", "window"):
        s = sub(name)
        X, Y = s.x, s.y
        s.frame(0, 0, 512, 1024, 10, SHADE)
        if name == "door":
            x0, x1, y0, y1 = 166, 346, 470, 990
            s.rect(x0 - 16, y0, x1 + 16, y1, LIGHT)
            s.ellipse(256, y0, (x1 - x0) / 2 + 16, 70, LIGHT)
            s.rect(x0, y0, x1, y1, "#5b3f33")
            s.ellipse(256, y0, (x1 - x0) / 2, 56, "#5b3f33")
            s.rect(254, y0 - 40, 258, y1, "#3a2820")
            for i in range(7):
                for j in range(3):
                    for side in (-1, 1):
                        s.ellipse(256 + side * (28 + j * 26), y0 + 40 + i * 64, 6, 6, "#b49a72")
            lunette(s, 256, 380, 120)
        else:
            x0, x1, y0, y1 = 150, 362, 520, 820
            s.rect(x0 - 18, y0 - 18, x1 + 18, y1 + 18, LIGHT)
            s.rect(x0, y0, x1, y1, "#2f2c29")
            for i in range(9):
                bx = x0 + 10 + i * (x1 - x0 - 20) / 8
                s.rect(bx - 7, y0, bx + 7, y1, "#a9a49a")
                s.rect(bx + 7, y0, bx + 10, y1, "#4a4640")
            s.rect(x0 - 30, y1 + 18, x1 + 30, y1 + 40, LIGHT)
            lunette(s, 256, 430, 120)
        figure(s, 70, 520, 990, 90)
        figure(s, 442, 520, 990, 90)
        s.rect(0, 0, 512, 60, "#8b877f")
        s.noise(0.06, 3 if name == "door" else 4)
        paste(name, s)
    # the sumerus' waists: cusped 壶门 niches with a lion or a dancer in each, small posts between
    for name, n in (("waist1", 6), ("waist2", 5)):
        s = sub(name)
        X, Y = s.x, s.y
        s.a *= 0.9
        w = 1024 / n
        for i in range(n):
            cx = (i + 0.5) * w
            s.rect(i * w, 0, i * w + 8, 128, LIGHT)
            arch = (np.abs(X - cx) < w * 0.36) & (Y > 28 + 26 * (1 - np.sqrt(np.clip(1 - ((X - cx) / (w * 0.36)) ** 2, 0, 1)))) & (Y < 120)
            s.a[arch] *= 0.55
            body = (((X - cx) / (w * 0.2)) ** 2 + ((Y - 92) / 24) ** 2 <= 1) | (((X - cx - w * 0.12) / (w * 0.09)) ** 2 + ((Y - 64) / 14) ** 2 <= 1)
            relief(s, body & arch, 2)
        s.rect(0, 0, 1024, 10, "#8b877f")
        s.rect(0, 118, 1024, 128, "#8b877f")
        paste(name, s)
    # brick brackets: blocks and arms in rows, three sets to a face
    s = sub("brackets")
    s.a *= 0.75
    for i in range(6):
        cx = (i + 0.5) * 1024 / 6
        for k, (hw, y0, y1) in enumerate(((22, 92, 128), (70, 66, 92), (40, 40, 66), (100, 14, 40))):
            s.rect(cx - hw, y0, cx + hw, y1 - 3, LIGHT if k % 2 == 0 else "#aaa69c")
            s.rect(cx - hw, y1 - 3, cx + hw, y1, SHADE)
    s.rect(0, 0, 1024, 14, "#8b877f")
    paste("brackets", s)
    # the 平座's balustrade: posts and panels with a lattice of crosses
    s = sub("rail")
    X, Y = s.x, s.y
    for i in range(9):
        s.rect(i * 128, 0, i * 128 + 16, 128, LIGHT)
    lat = ((np.mod(X + Y, 28) < 5) | (np.mod(X - Y, 28) < 5)) & (Y > 26) & (Y < 104)
    s.a[lat] *= 1.18
    s.rect(0, 0, 1024, 18, LIGHT)
    s.rect(0, 104, 1024, 112, SHADE)
    paste("rail", s)
    # lotus petals, pointed, in a row (16 to a face), the petal's midrib darker
    s = sub("lotus")
    X, Y = s.x, s.y
    s.a *= 0.7
    w = 1024 / 16
    ph = np.mod(X, w) - w / 2
    petal = (np.abs(ph) < w * 0.47 * np.sqrt(np.clip(Y / 128, 0, 1)) * (1.2 - Y / 160)) & (Y > 4)
    relief(s, petal, 3)
    s.a[(np.abs(ph) < 2) & (Y > 30)] *= 0.85
    paste("lotus", s)
    # rafters under the eaves, a beam band
    s = sub("rafters")
    s.a[:] = s.c("#3c3a36")
    for i in range(16):
        s.rect(i * 32 + 4, 0, i * 32 + 24, 128, "#6f6b63")
    paste("rafters", s)
    s = sub("beam")
    s.a *= 0.92
    s.rect(0, 0, 512, 12, LIGHT)
    s.rect(0, 116, 512, 128, SHADE)
    for i in range(8):
        s.rect(i * 64 + 20, 40, i * 64 + 44, 88, "#8b877f")
    paste("beam", s)
    s = sub("pillar")
    X, Y = s.x, s.y
    coil = np.sin(Y / 256 * 2 * math.pi * 3 + X / 512 * 2 * math.pi) > 0.6
    relief(s, coil & (np.mod(X, 512) > 0), 3)
    paste("pillar", s)
    return image("TNS_Relief", np.flipud(cv.a).copy())


def stripes(name, col, size=128, rows=4):
    """Tile rows along v (a tube every quarter of the image across u)."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.62 + 0.38 * np.cos(np.pi * ((u * rows) % 1.0 - 0.5)) ** 2
    course = 1 - 0.12 * (((v * 4) % 1) < 0.06)
    return image(name, np.flipud(np.asarray(Canvas(1, 1, col).a[0, 0])[None, None, :] * (ridge * course)[..., None]).copy())


def brick_image(name, col, size=512):
    cv = Canvas(size, size, col)
    rng = np.random.default_rng(41)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    c = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.9, 1.07, (40, 12))[row % 40, c % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.4) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.4), "#b0aca2")
    cv.noise(0.1, 42)
    return image(name, np.flipud(cv.a).copy())


def make_materials():
    atlas, night = paint_atlas("TNS", portrait=False, emblem=False)
    return dict(
        relief=material("TNS_Relief", "#ffffff", 0.85, tex=relief_atlas(), props={"wet": "damp", "glow": "flood", "glowStrength": 0.6}),
        pstone=material("TNS_Stone", STONE, 0.9, tex=brick_image("TNS_StoneTex", STONE), props={"wet": "damp", "glow": "flood", "glowStrength": 0.6}),
        eave=material("TNS_EaveTile", "#4e5c55", 0.45, tex=stripes("TNS_EaveTex", "#56655c"), props={"wet": "surface", "glowStrength": 0.4}),
        rooftile=material("TNS_RoofTile", "#5d6164", 0.6, tex=stripes("TNS_RoofTex", "#62676a"), props={"wet": "surface", "glowStrength": 0.4}),
        tile=material("TNS_Tile", "#5d6164", 0.6, props={"wet": "surface", "glowStrength": 0.4}),
        atlas=material("TNS_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.7}),
        plaster=material("TNS_Plaster", "#a8321f", 0.85, tex=plaster(name="TNS_PlasterTex", col="#a43a26"), props={"wet": "damp"}),
        red=material("TNS_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        brick=material("TNS_Brick", "#7f817d", 0.9, tex=brick_image("TNS_BrickTex", "#7f817d"), props={"wet": "damp"}),
        stone=material("TNS_Base", "#b4afa4", 0.75, props={"wet": "damp"}),
        paving=material("TNS_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        bronze=material("TNS_Bronze", "#3f4a40", 0.5, metal=0.7, props={"wet": "surface"}),
    )


TILE = dict(pstone=4.0, brick=4.0, plaster=4.0, stone=2.0, paving=4.0, tile=2.0, rooftile=1.2, red=2.0, bronze=1.0, eave=1.2)


# --- octagons --------------------------------------------------------------------------------------------------

def oct_pt(a, i, z, t=0.0):
    """Point t (0..1) along side i of the octagon with apothem a (faces to the cardinal and diagonal directions)."""
    r = a / C22
    a0, a1 = math.radians(-22.5 + 45 * i), math.radians(22.5 + 45 * i)
    p0 = Vector((r * math.cos(a0), r * math.sin(a0), z))
    p1 = Vector((r * math.cos(a1), r * math.sin(a1), z))
    return p0.lerp(p1, t)


def side_out(i):
    return (math.cos(math.radians(45 * i)), math.sin(math.radians(45 * i)), 0.0)


def oband(g, a0, z0, a1, z1, key, region=None, regions=None, smooth=False, inward=False):
    """The eight faces between octagon (a0, z0) and (a1, z1); `region` maps each face to a relief region."""
    for i in range(8):
        P = [oct_pt(a0, i, z0), oct_pt(a0, i, z0, 1), oct_pt(a1, i, z1, 1), oct_pt(a1, i, z1)]
        reg = regions[i % len(regions)] if regions else region
        n = Vector(side_out(i))
        n.z = (a0 - a1) / max(1e-6, abs(z1 - z0)) if abs(z1 - z0) > 1e-6 else (1.0 if a0 > a1 else -1.0)
        if abs(z1 - z0) < 1e-6:
            n = Vector((0, 0, 1 if a0 > a1 else -1))
        elif inward:
            n = -n
        # a trapezoid in UV like the face itself (the narrower edge mapped to the middle of the region), or the
        # two triangles shear the picture
        k0, k1 = (min(1.0, a0 / a1), 1.0) if a1 >= a0 else (1.0, a1 / a0)
        uv = [ruv(reg, (1 - k0) / 2, 0), ruv(reg, (1 + k0) / 2, 0), ruv(reg, (1 + k1) / 2, 1), ruv(reg, (1 - k1) / 2, 1)] if reg else None
        g.polyn(P, key, tuple(n), uvs=uv, smooth=smooth)


def ocap(g, a, z, key, up=True):
    g.polyn([oct_pt(a, i, z) for i in range(8)], key, (0, 0, 1 if up else -1))


def eave(g, w, zb, hb, e, lift, w_next, z_top, bells, sub=4, wall_key="pstone"):
    """One eave: the brick bracket band corbelled out from apothem w at zb over hb, the soffit out to the eave e,
    the tile edge, the tiled top climbing back to the next storey's wall (w_next, z_top); the corners swept up by
    `lift`. Returns the corner points for ridges and bells."""
    oband(g, w, zb, w + 0.5, zb + hb, "relief", "brackets")
    zs = zb + hb
    ts = [k / sub for k in range(sub + 1)]
    lifted = lambda t: lift * (2 * abs(t - 0.5)) ** 2.2      # noqa: E731
    corners = []
    for i in range(8):
        n = Vector(side_out(i))
        inner = [oct_pt(w + 0.5, i, zs, t) for t in ts]
        outer = [oct_pt(e, i, zs - 0.05, t) + Vector((0, 0, lifted(t))) for t in ts]
        edge = [p + Vector((0, 0, 0.32)) for p in outer]
        top = [oct_pt(w_next, i, z_top, t) for t in ts]
        side = 2 * e * math.tan(math.pi / 8)
        for k in range(sub):
            g.polyn([inner[k], inner[k + 1], outer[k + 1], outer[k]], "relief", (0, 0, -1),
                    uvs=[ruv("rafters", ts[k], 0), ruv("rafters", ts[k + 1], 0), ruv("rafters", ts[k + 1], 1), ruv("rafters", ts[k], 1)])
            g.polyn([outer[k], outer[k + 1], edge[k + 1], edge[k]], "eave", tuple(n),
                    uvs=[(ts[k] * side / 1.2, 0), (ts[k + 1] * side / 1.2, 0), (ts[k + 1] * side / 1.2, 0.27), (ts[k] * side / 1.2, 0.27)])
            sl = (e - w_next) / 1.2
            g.polyn([edge[k], edge[k + 1], top[k + 1], top[k]], "eave", (n.x, n.y, 1.5),
                    uvs=[(ts[k] * side / 1.2, 0), (ts[k + 1] * side / 1.2, 0), (ts[k + 1] * side / 1.2, sl), (ts[k] * side / 1.2, sl)])
        corners.append((edge[0], top[0]))
    for a, b in corners:
        sweep(g, [a + Vector((0, 0, 0.02)), a.lerp(b, 0.5) + Vector((0, 0, 0.06)), b], 0.26, 0.2, key="eave")
        bells.append(a + (a - Vector((0, 0, a.z))).normalized() * -0.1 + Vector((0, 0, -0.35)))
    return corners


# --- the pagoda --------------------------------------------------------------------------------------------------

def pagoda(g, bells):
    a0 = PAGODA_R * C22
    # the terrace
    oband(g, a0, 0.0, a0, 1.0, "stone")
    ocap(g, a0, 1.0, "paving")
    for i in (0, 2, 4, 6):                                   # steps on the cardinal faces
        n = Vector(side_out(i))
        t = Vector((-n.y, n.x, 0))
        for k in range(6):
            d0, d1, z = a0 + 2.1 - k * 0.35, a0 + 2.1 - (k + 1) * 0.35 + 0.02, (k + 1) / 6
            c0, c1 = n * d0, n * d1
            pts = [c0 - t * 2.2, c0 + t * 2.2, c1 + t * 2.2, c1 - t * 2.2]
            lo = [p + Vector((0, 0, 0.0)) for p in pts]
            hi = [p + Vector((0, 0, z)) for p in pts]
            g.polyn(hi, "stone", (0, 0, 1))
            g.polyn([lo[0], lo[1], hi[1], hi[0]], "stone", tuple(n))
            g.polyn([lo[1], lo[2], hi[2], hi[1]], "stone", tuple(t))
            g.polyn([lo[3], lo[0], hi[0], hi[3]], "stone", tuple(-t))
    # two sumerus: (apothem, z) profiles, the waist carved
    prof1 = [(10.6, 1.0), (10.6, 1.35), (10.25, 1.55), (9.95, 1.72)]
    for (aa, za), (ab, zb) in zip(prof1, prof1[1:]):
        oband(g, aa, za, ab, zb, "pstone")
    ocap(g, 10.6, 1.0, "pstone")
    oband(g, 9.6, 1.72, 9.6, 3.0, "relief", "waist1")
    ocap(g, 9.95, 1.72, "pstone")
    for (aa, za), (ab, zb) in zip([(9.95, 3.0), (10.3, 3.18), (10.6, 3.42), (10.6, 3.8)], [(10.3, 3.18), (10.6, 3.42), (10.6, 3.8), (10.0, 3.8)]):
        oband(g, aa, za, ab, zb, "pstone")
    g_ = [(10.0, 3.8), (10.0, 4.05), (9.7, 4.22)]
    for (aa, za), (ab, zb) in zip(g_, g_[1:]):
        oband(g, aa, za, ab, zb, "pstone")
    ocap(g, 9.7, 4.22, "pstone", up=True)
    oband(g, 9.3, 4.22, 9.3, 5.62, "relief", "waist2")
    oband(g, 9.3, 5.62, 9.7, 5.62, "pstone")
    for (aa, za), (ab, zb) in zip([(9.7, 5.62), (10.0, 5.85)], [(10.0, 5.85), (10.0, 6.4)]):
        oband(g, aa, za, ab, zb, "pstone")
    # the 平座: brackets corbelled out, the deck, the balustrade
    oband(g, 9.6, 6.4, 10.4, 7.25, "relief", "brackets")
    ocap(g, 10.0, 6.4, "pstone")
    oband(g, 10.6, 7.25, 10.6, 7.45, "pstone")
    oband(g, 10.4, 7.25, 10.6, 7.25, "pstone")
    ocap(g, 10.6, 7.45, "paving")
    oband(g, 10.45, 7.45, 10.45, 8.3, "relief", "rail")
    oband(g, 10.3, 7.45, 10.3, 8.3, "relief", "rail", inward=True)
    oband(g, 10.45, 8.3, 10.3, 8.3, "pstone")
    # three tiers of upturned lotus petals
    for k, (ab, at, z0, z1) in enumerate(((8.4, 9.4, 7.45, 8.4), (7.9, 8.9, 8.4, 9.3), (7.3, 8.3, 9.3, 10.2))):
        oband(g, ab, z0, at, z1, "relief", "lotus")
        oband(g, at, z1, ab - 0.5 if k < 2 else 6.3, z1, "pstone")
    # the first storey: false doors on the cardinal faces, windows on the diagonals, round corner pillars
    zb0, zb1 = 10.2, 18.0
    oband(g, 6.3, zb0, 6.3, zb1, "relief", regions=["door", "window"])
    for i in range(8):
        p = oct_pt(6.3, i, 0.0)
        cyl(g, p.x, p.y, zb0, zb1, 0.45, 0.45, 10, "pstone", caps=(False, False))
        cyl(g, p.x, p.y, zb0, zb0 + 0.35, 0.58, 0.5, 10, "pstone", caps=(False, True))
    oband(g, 6.5, zb1, 6.5, zb1 + 0.6, "relief", "beam")
    ocap(g, 6.5, zb1, "pstone", up=False)
    # thirteen eaves
    tiers = []
    W = [6.05 - 1.75 * ((i) / 11) ** 1.5 for i in range(12)]          # walls of storeys 2..13
    E = [8.95] + [W[i] + 2.25 - 0.45 * (i / 11) for i in range(12)]   # eaves 1..13
    HB = [0.95] + [0.6 - 0.15 * (i / 11) for i in range(12)]
    z = zb1 + 0.6
    walls = [6.3] + W
    for n in range(13):
        w = walls[n]
        if n > 0:
            oband(g, w, z, w, z + 0.55, "pstone")
            z += 0.55
        w_next = walls[n + 1] if n < 12 else 1.4
        zs = z + HB[n]
        rise = (E[n] - w_next) * (0.42 if n == 0 else (0.36 if n < 12 else 0.9))
        z_top = zs + 0.27 + rise
        eave(g, w, z, HB[n], E[n], 0.42 if n == 0 else 0.3 - 0.1 * n / 12, w_next, z_top, bells)
        tiers.append((w, z, HB[n], E[n], z_top))
        z = z_top
    # the finial: a plinth, two lotus seats, the pearl
    oband(g, 1.4, z, 1.4, z + 0.55, "pstone")
    z += 0.55
    for ab, at, h in ((1.0, 2.0, 1.1), (0.8, 1.55, 0.95)):
        oband(g, 1.2, z, ab, z + 0.15, "pstone")
        oband(g, ab, z + 0.15, at, z + h, "relief", "lotus")
        oband(g, at, z + h, 0.85, z + h, "pstone")
        z += h
        oband(g, 0.85, z, 0.75, z + 0.35, "pstone")
        z += 0.35
    rp = min(1.6, (57.8 - z - 0.8) / 1.95)
    ell(g, (0, 0, z + rp * 0.95), (rp, rp, rp), "pstone", nu=16, nv=10)
    cyl(g, 0, 0, z + rp * 1.85, 57.8, 0.3, 0.03, 8, "pstone", caps=(False, False))
    return tiers, z


# --- halls ---------------------------------------------------------------------------------------------------

def gable_hall(L_, D, ze, H, z0=0.45):
    """A 硬山 hall in its own frame: ridge along x, front to -y; red walls, a lattice front, brick gable ends,
    a grey roof of tile rows (texture) with a ridge and two end ornaments."""
    g = Geo()
    hx, hy = L_ / 2, D / 2
    g.box(-hx - 0.35, hx + 0.35, -hy - 0.45, hy + 0.35, 0.0, z0, "stone", skip=("-z",))
    # walls: the back plastered, the front in bays of lattice between red posts, the ends brick to the roof
    g.polyn([(-hx, hy, z0), (hx, hy, z0), (hx, hy, ze), (-hx, hy, ze)], "plaster", (0, 1, 0))
    nb = max(3, int(round(L_ / 3.4)) | 1)
    yf = -hy + 0.25
    for i in range(nb):
        x0, x1 = -hx + 2 * hx * i / nb, -hx + 2 * hx * (i + 1) / nb
        reg = "door" if i == nb // 2 else "window"
        g.polyn([(x0, yf, z0), (x1, yf, z0), (x1, yf, ze - 0.55), (x0, yf, ze - 0.55)], "atlas", (0, -1, 0), uvs=huvs(reg, ((0, 0), (1, 0), (1, 1), (0, 1))))
        g.box(x0 - 0.15, x0 + 0.15, yf - 0.15, yf + 0.15, z0, ze - 0.55, "red", skip=("-z", "+z"))
    g.box(hx - 0.15, hx + 0.15, yf - 0.15, yf + 0.15, z0, ze - 0.55, "red", skip=("-z", "+z"))
    for yy, want in ((yf - 0.02, -1), (hy + 0.02, 1)):
        g.polyn([(-hx, yy, ze - 0.55), (hx, yy, ze - 0.55), (hx, yy, ze), (-hx, yy, ze)], "atlas", (0, want, 0), uvs=huvs("beam", ((0, 0), (1, 0), (1, 1), (0, 1))))
    # the roof: a concave slope each side from the eave (0.9 m out) to the ridge
    De = hy + 0.9
    rows = 5
    prof = [(De * k / rows, ze - 0.1 + H * (k / rows) ** 1.6) for k in range(rows + 1)]
    xe = hx + 0.38
    for sy in (-1, 1):
        pts = [(sy * (De - v), z) for v, z in prof]
        acc = 0.0
        for (ya, za), (yb, zb) in zip(pts, pts[1:]):
            dl = math.hypot(yb - ya, zb - za)
            g.polyn([(-xe, ya, za), (xe, ya, za), (xe, yb, zb), (-xe, yb, zb)], "rooftile", (0, sy * 0.5, 1),
                    uvs=[(-xe / 1.2, acc / 1.2), (xe / 1.2, acc / 1.2), (xe / 1.2, (acc + dl) / 1.2), (-xe / 1.2, (acc + dl) / 1.2)])
            if abs(ya) > hy - 0.3:
                g.polyn([(-xe, ya, za - 0.25), (xe, ya, za - 0.25), (xe, yb, zb - 0.25), (-xe, yb, zb - 0.25)], "atlas", (0, 0, -1),
                        uvs=huvs("rafters", ((0, 0), (1, 0), (1, 1), (0, 1))))
            acc += dl
        ya, za = pts[0]
        g.polyn([(-xe, ya, za - 0.25), (xe, ya, za - 0.25), (xe, ya, za), (-xe, ya, za)], "tile", (0, sy, 0))
        for sx in (-1, 1):                                      # the verge
            for (y_a, z_a), (y_b, z_b) in zip(pts, pts[1:]):
                g.polyn([(sx * xe, y_a, z_a - 0.25), (sx * xe, y_b, z_b - 0.25), (sx * xe, y_b, z_b + 0.05), (sx * xe, y_a, z_a + 0.05)], "tile", (sx, 0, 0))
    zt = ze - 0.1 + H
    zr = lambda y: ze - 0.1 + H * ((De - abs(y)) / De) ** 1.6 - 0.2          # noqa: E731  (under the tiles)
    # the gable ends: brick from the base up under the roof
    ys = [(hy + 0.05) * (1 - 2 * k / 10) for k in range(11)]
    for sx in (-1, 1):
        pts = [(-hy - 0.05, z0), (hy + 0.05, z0)] + [(y, zr(y)) for y in ys]
        g.polyn([(sx * (hx + 0.05), y, z) for y, z in pts], "brick", (sx, 0, 0))
    # the ridge and its end ornaments
    g.box(-xe - 0.1, xe + 0.1, -0.22, 0.22, zt - 0.15, zt + 0.42, "tile")
    for sx in (-1, 1):
        g.box(sx * (xe - 0.1) - 0.25, sx * (xe - 0.1) + 0.25, -0.15, 0.15, zt + 0.42, zt + 1.0, "tile")
    return g


def hall_spec(OX, OY, ze, H, gable_in):
    return SimpleNamespace(
        XS=[-OX, OX], YS=[-OY, OY], OX=OX, OY=OY, IX=OX, IY=OY,
        BEAM=(ze - 0.7, ze - 0.2, ze - 0.2, ze), UBEAM=(ze - 0.7, ze - 0.2, ze - 0.2, ze), OVERHANG=1.2, LOWER=None,
        UPPER=dict(A=OX + 1.3, D=OY + 1.3, z=ze - 0.1, H=H, p=1.5, o=0.5, lift=0.5, Lc=3.5, Vc=2.0),
        GABLE_X=OX + 1.3 - gable_in - 0.8, PITCH=0.46, AMP=0.09, TRIM=0.0, RIDGE="tile", ROWS=7, END_ROWS=3)


def xieshan_hall(OX, OY, ze, H, front_bays, z0=0.45):
    """A hall under a single-eaved 歇山 (hall.py's roofs): red walls, a lattice front, painted beams."""
    g = Geo()
    h = hall_spec(OX, OY, ze, H, gable_in=min(OY + 1.3, 2.4))
    g.box(-OX - 0.5, OX + 0.5, -OY - 0.6, OY + 0.5, 0.0, z0, "stone", skip=("-z",))
    g.box(-OX, OX, -OY, OY, z0, h.BEAM[0], "plaster", skip=("-z", "+z", "-y"))
    for i in range(front_bays):
        x0, x1 = -OX + 2 * OX * i / front_bays, -OX + 2 * OX * (i + 1) / front_bays
        reg = "door" if i == front_bays // 2 else "window"
        g.polyn([(x0, -OY, z0), (x1, -OY, z0), (x1, -OY, h.BEAM[0]), (x0, -OY, h.BEAM[0])], "atlas", (0, -1, 0), uvs=huvs(reg, ((0, 0), (1, 0), (1, 1), (0, 1))))
        g.box(x0 - 0.18, x0 + 0.18, -OY - 0.2, -OY + 0.1, z0, h.BEAM[0], "red", skip=("-z", "+z"))
    g.box(OX - 0.18, OX + 0.18, -OY - 0.2, -OY + 0.1, z0, h.BEAM[0], "red", skip=("-z", "+z"))
    ring_beams(h, g, True, *h.BEAM)
    roofs(h, g)
    return g


def tower_hall(OX, OY):
    """鼓楼 / 钟楼: a brick lower storey with an arched door, a lattice upper storey, a 歇山 roof (8 m)."""
    g = Geo()
    g.box(-OX - 0.3, OX + 0.3, -OY - 0.3, OY + 0.3, 0.0, 0.45, "stone", skip=("-z",))
    g.box(-OX, OX, -OY, OY, 0.45, 3.6, "brick", skip=("-z",))
    g.polyn([(-0.8, -OY - 0.02, 0.45), (0.8, -OY - 0.02, 0.45), (0.8, -OY - 0.02, 2.6), (-0.8, -OY - 0.02, 2.6)], "atlas", (0, -1, 0),
            uvs=huvs("gatedoor", ((0, 0), (1, 0), (1, 1), (0, 1))))
    ix, iy = OX - 0.6, OY - 0.6
    h = hall_spec(ix, iy, 6.25, 1.75, gable_in=1.3)
    for rot_pts, want in (([(-ix, -iy), (ix, -iy)], (0, -1, 0)), ([(ix, -iy), (ix, iy)], (1, 0, 0)), ([(ix, iy), (-ix, iy)], (0, 1, 0)), ([(-ix, iy), (-ix, -iy)], (-1, 0, 0))):
        (xa, ya), (xb, yb) = rot_pts
        g.polyn([(xa, ya, 3.6), (xb, yb, 3.6), (xb, yb, h.BEAM[0]), (xa, ya, h.BEAM[0])], "atlas", want, uvs=huvs("band", ((0, 0), (1, 0), (1, 1), (0, 1))))
    g.box(-OX - 0.1, OX + 0.1, -OY - 0.1, OY + 0.1, 3.6, 3.85, "tile")
    ring_beams(h, g, True, *h.BEAM)
    roofs(h, g)
    return g


def far_hall(g, L_, D, ze, H):
    hx, hy = L_ / 2, D / 2
    g.box(-hx, hx, -hy, hy, 0.0, ze, "plaster", skip=("-z",))
    De = hy + 0.8
    for sy in (-1, 1):
        g.polyn([(-hx - 0.3, sy * De, ze - 0.1), (hx + 0.3, sy * De, ze - 0.1), (hx + 0.3, 0, ze + H), (-hx - 0.3, 0, ze + H)], "tile", (0, sy, 1))
    for sx in (-1, 1):
        g.polyn([(sx * hx, -hy, ze), (sx * hx, hy, ze), (sx * hx, 0, ze + H - 0.2)], "brick", (sx, 0, 0))


FRONT_ROT = dict(S=0.0, N=math.pi, E=math.pi / 2, W=-math.pi / 2)


def build():
    clear_file()
    ensure_addon()
    M = make_materials()
    main = collection("天宁寺")
    g = Geo()
    bells = []
    tiers, ztop = pagoda(g, bells)
    g.build("Pagoda", collection("塔", main), M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    bg = Geo()
    cyl(bg, 0, 0, -0.32, 0.0, 0.17, 0.1, 8, "bronze", caps=(True, True))
    bg.box(-0.02, 0.02, -0.02, 0.02, 0.0, 0.12, "bronze")
    bell = mesh_of(bg, "BellMesh", M, TILE)
    for i, p in enumerate(bells):
        place(bell, f"Bell.{i:03d}", parts, T(*p))

    # the temple: halls, the bell and drum towers, the wall
    hg = Geo()
    far = Geo()
    helpers = collection("碰撞体")
    for name, pts, ht, kind, front in HALLS:
        x0, x1, y0, y1 = rect_of(pts)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        rot = FRONT_ROT[front]
        along_x = front in ("S", "N")
        L_, D = (x1 - x0, y1 - y0) if along_x else (y1 - y0, x1 - x0)
        m = T(cx, cy, 0) @ Rz(rot)
        if kind == "main":
            ze = 4.2
            hall = xieshan_hall(L_ / 2 - 0.9, D / 2 - 0.9, ze, ht - ze - 0.3, 5)
        elif kind == "tower":
            hall = tower_hall(L_ / 2 - 0.3, D / 2 - 0.3)
        else:
            ze = ht * 0.55 + 0.3
            hall = gable_hall(L_ - 0.8, D - 0.8, ze, ht - ze - 0.1)
        hg.add(hall, m)
        fg = Geo()
        far_hall(fg, L_ - 0.6, D - 0.6, ht * 0.62, ht * 0.38)
        far.add(fg, m)
        collider_box(helpers, f"hall_{name}", x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, 0.0, ht * 0.7)
        flat_marker(helpers, f"hall_{name}", [(x0 - 0.3, y0 - 0.3), (x1 + 0.3, y0 - 0.3), (x1 + 0.3, y1 + 0.3), (x0 - 0.3, y1 + 0.3)], "FOOTPRINT")
    # the precinct wall: red, 3.2 m, a tiled coping; the south side runs into the gate
    runs, cur = [], []
    for p in WALL_PTS + [WALL_PTS[0]]:
        if p == "gate":
            runs.append(cur)
            cur = []
            continue
        cur.append(L(*p))
    runs.append(cur)
    for run in runs:
        for a, b in zip(run, run[1:]):
            a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
            d = (b - a).normalized()
            nrm = Vector((-d.y, d.x, 0)) * 0.32
            q = [a - nrm, b - nrm, b + nrm, a + nrm]
            for (p0, p1), want in (((q[0], q[1]), -nrm), ((q[2], q[3]), nrm)):
                hg.polyn([p0, p1, p1 + Vector((0, 0, 3.0)), p0 + Vector((0, 0, 3.0))], "plaster", tuple(want))
            for p0, p1, want in ((q[3], q[0], -d), (q[1], q[2], d)):
                hg.polyn([p0, p1, p1 + Vector((0, 0, 3.0)), p0 + Vector((0, 0, 3.0))], "plaster", tuple(want))
            coping(hg, (a.x, a.y), (b.x, b.y), 1.0, 3.0, rise=0.35, key="tile")
            far.polyn([a, b, b + Vector((0, 0, 3.2)), a + Vector((0, 0, 3.2))], "plaster", tuple(-nrm))
            far.polyn([a, b, b + Vector((0, 0, 3.2)), a + Vector((0, 0, 3.2))], "plaster", tuple(nrm))
            collider_pts(helpers, "wall", [a - nrm, b - nrm, b + nrm, a + nrm, a - nrm + Vector((0, 0, 3.2)), b - nrm + Vector((0, 0, 3.2)),
                                           b + nrm + Vector((0, 0, 3.2)), a + nrm + Vector((0, 0, 3.2))])
    hg.build("Temple", collection("寺", main), M, TILE)
    tris_h = hg.tris()

    # far level: the pagoda as stacked octagons, the halls as boxes under two slopes
    a0 = PAGODA_R * C22
    oband(far, a0, 0.0, a0, 1.0, "stone")
    ocap(far, a0, 1.0, "paving")
    oband(far, 10.6, 1.0, 10.6, 7.4, "pstone")
    ocap(far, 10.6, 7.4, "pstone")
    oband(far, 9.0, 7.4, 8.3, 10.2, "pstone")
    oband(far, 6.4, 10.2, 6.4, 18.6, "relief", regions=["door", "window"])
    for k, (w, z, hb, e, z_top) in enumerate(tiers):
        if k:
            oband(far, w, z - 0.55, w, z, "pstone")
        oband(far, w, z, e, z + hb, "pstone")
        oband(far, e, z + hb, e, z + hb + 0.3, "eave")
        oband(far, e, z + hb + 0.3, tiers[k + 1][0] if k < 12 else 1.4, z_top, "eave")
    oband(far, 1.4, tiers[-1][4], 0.3, 57.8, "pstone")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the terrace (with walk-only ramps over its steps), the sumerus, the body, the halls
    def oct_hull(name, a, z0, z1, role="COL"):
        collider_pts(helpers, name, [oct_pt(a, i, z) for i in range(8) for z in (z0, z1)], role=role)
    oct_hull("terrace", a0, 0.0, 1.0)
    oct_hull("sumeru", 10.6, 1.0, 10.2)
    oct_hull("body", 6.9, 10.2, 50.0)
    for i in (0, 2, 4, 6):
        n = Vector(side_out(i))
        t = Vector((-n.y, n.x, 0))
        lo, hi = n * (a0 + 2.15), n * (a0 - 0.05)
        collider_pts(helpers, f"steps{i}", [lo - t * 2.2, lo + t * 2.2, hi - t * 2.2 + Vector((0, 0, 1.0)), hi + t * 2.2 + Vector((0, 0, 1.0)),
                                            hi - t * 2.2, hi + t * 2.2], role="WALK")
    flat_marker(helpers, "pagoda", [(oct_pt(PAGODA_R * C22 + 2.2, i, 0).x, oct_pt(PAGODA_R * C22 + 2.2, i, 0).y) for i in range(8)], "FOOTPRINT")
    for k, poly in enumerate(FOOT_EXTRA):
        flat_marker(helpers, f"learnt{k}", [L(*p) for p in poly], "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "tianningsi", "天宁寺塔", "Tianning Temple Pagoda"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", -4934.4, 1680.0, HEADING
    s.far_distance = 700
    s.repo_path = REPO
    return dict(pagoda_tris=tris, temple_tris=tris_h, bells=len(bells), top=ztop)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
