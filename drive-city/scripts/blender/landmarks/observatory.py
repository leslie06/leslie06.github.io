# 北京古观象台 Beijing Ancient Observatory, built in Blender, marked with the bcity_landmark add-on's conventions.
# OSM tags it building=ruins (way 412429961), and the city drew it as a twelve-storey block of flats.
#
#   blender -b -P scripts/blender/landmarks/observatory.py -- [--out art/landmarks/observatory.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (2639, 293), heading -1.3 (the outline's
# edges). The plan is OSM's, squared in that frame: the observatory platform (x -15.95..1.85, y -10.84..11.76) against
# the stretch of the Ming inner city wall it stands on (x 1.85..16.55, y -19.7..18.7). The platform: grey brick,
# battered, a stone base course, 14 m to the terrace, battlements; the wall: 11.5 m, battlements on its outer (east)
# face and a plain parapet inside. A 马道 ramp of steps climbs the platform's west face from the south. On the
# terrace the eight Qing bronze instruments on stone plinths: the celestial globe, the equatorial, ecliptic and
# altazimuth armillaries, the azimuth theodolite, the quadrant, the sextant and the great armillary sphere
# (玑衡抚辰仪) - rings, arcs, posts and legs in patinated bronze.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, collider_pts, ell, flat_marker, paving  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "observatory.blend")

PLAT = dict(x0=-15.95, x1=1.85, y0=-10.84, y1=11.76, h=14.0)
WALL = dict(x0=1.85, x1=16.55, y0=-19.7, y1=18.7, h=11.5)
BATTER = 0.8          # how far the walls lean in over their height
BASE = 1.0            # the stone base course
RAMP = dict(w=3.2, y0=-10.84, y1=8.8)      # the 马道: along the platform's west face, rising northwards
PARA = dict(t=0.55, low=1.0, high=1.85, merlon=1.35, gap=0.5)


def brick_image(size=512):
    """Old grey city-wall brick in running bond, weathered, 4 m a repeat."""
    cv = Canvas(size, size, "#7d7f7a")
    rng = np.random.default_rng(11)
    bw, bh = size / 8.33, size / 33.3
    row = (cv.y // bh).astype(int)
    col = ((cv.x + (row % 2) * bw / 2) // bw).astype(int)
    cv.a *= rng.uniform(0.82, 1.1, (40, 12))[row % 40, col % 12][..., None]
    cv.put((np.mod(cv.y, bh) < 1.6) | (np.mod(cv.x + (row % 2) * bw / 2, bw) < 1.6), "#9a9c96")
    cv.noise(0.12, 5)
    return image("OBS_Brick", np.flipud(cv.a).copy())


def materials():
    return dict(
        brick=material("OBS_Brick", "#7d7f7a", 0.9, tex=brick_image(), props={"wet": "damp", "glowStrength": 0.6}),
        stone=material("OBS_Stone", "#a19d93", 0.75, props={"wet": "damp", "glowStrength": 0.6}),
        paving=material("OBS_Paving", "#a29e94", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        bronze=material("OBS_Bronze", "#34403a", 0.5, metal=0.75, props={"wet": "surface", "glowStrength": 0.5}),
        cap=material("OBS_Cap", "#5c5e5b", 0.7, props={"wet": "damp"}),
    )


TILE = dict(brick=4.0, stone=2.0, paving=4.0, bronze=1.0, cap=2.0)


# ---- walls -------------------------------------------------------------------------------------------------

def battered(g, x0, x1, y0, y1, z0, z1, key, faces, inset=BATTER, base=BASE):
    """A block whose named faces ('w', 'e', 's', 'n') lean in by `inset` over its height, on a stone base course
    standing 12 cm proud; returns the top's edges."""
    zb = z0 + base
    sign = dict(w=1, e=-1, s=1, n=-1)

    def edges(d):
        e = dict(w=x0, e=x1, s=y0, n=y1)
        for f in faces:
            e[f] += sign[f] * d
        return e

    def ring(e, z):
        return [(e["w"], e["s"], z), (e["e"], e["s"], z), (e["e"], e["n"], z), (e["w"], e["n"], z)]

    outs = ((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0))

    def band(ea, za, eb, zb_, k):
        a, b = ring(ea, za), ring(eb, zb_)
        for i, want in enumerate(outs):
            j = (i + 1) % 4
            g.polyn([a[i], a[j], b[j], b[i]], k, want)

    proud, foot, top = edges(-0.12), edges(0.0), edges(inset)
    band(proud, z0, proud, zb, "stone")
    a, b = ring(proud, zb), ring(foot, zb)
    for i in range(4):
        j = (i + 1) % 4
        g.polyn([a[i], a[j], b[j], b[i]], "stone", (0, 0, 1))
    band(foot, zb, top, z1, key)
    return top


def parapet(g, a, b, out, battlements, key="brick", z=0.0, t=PARA["t"]):
    """A parapet along a..b (plan points) on a wall top at z, its outer face towards `out` (unit plan vector);
    battlements: merlons with crenels between, else a plain 女墙."""
    a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
    d = (b - a)
    L = d.length
    d.normalize()
    o = Vector((out[0], out[1], 0))
    inner = -o * t
    def slab(s0, s1, z0, z1):
        p0, p1 = a + d * s0, a + d * s1
        P = [p0, p1, p1 + inner, p0 + inner]
        lo = [p + Vector((0, 0, z0)) for p in P]
        hi = [p + Vector((0, 0, z1)) for p in P]
        g.polyn([lo[0], lo[1], hi[1], hi[0]], key, tuple(o))
        g.polyn([lo[2], lo[3], hi[3], hi[2]], key, tuple(-o))
        g.polyn([lo[1], lo[2], hi[2], hi[1]], key, tuple(d))
        g.polyn([lo[3], lo[0], hi[0], hi[3]], key, tuple(-d))
        g.polyn(hi, "cap", (0, 0, 1))
    if not battlements:
        slab(0.0, L, 0.0, PARA["low"])
        return
    slab(0.0, L, 0.0, PARA["low"])
    step = PARA["merlon"] + PARA["gap"]
    n = max(1, int((L + PARA["gap"]) // step))
    pad = (L - (n * step - PARA["gap"])) / 2
    for i in range(n):
        s0 = pad + i * step
        slab(s0, s0 + PARA["merlon"], PARA["low"], PARA["high"])


# ---- the instruments ---------------------------------------------------------------------------------------------

def frame(normal):
    """Two unit vectors spanning the plane perpendicular to `normal`."""
    n = Vector(normal).normalized()
    h = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
    u = n.cross(h).normalized()
    return u, n.cross(u).normalized()


def torus(g, c, R, r, normal, a0=0.0, a1=2 * math.pi, seg=36, sides=6, key="bronze", square=False):
    """A ring (or an arc of one) of radius R round centre c in the plane normal to `normal`, tube radius r."""
    u, v = frame(normal)
    n = Vector(normal).normalized()
    c = Vector(c)
    closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
    count = seg if closed else seg + 1
    rings = []
    for i in range(count):
        a = a0 + (a1 - a0) * i / seg
        radial = u * math.cos(a) + v * math.sin(a)
        centre = c + radial * R
        ring = []
        for k in range(sides):
            b = 2 * math.pi * k / sides + (math.pi / 4 if square else 0.0)
            ring.append(g.vert(centre + (radial * math.cos(b) + n * math.sin(b)) * r))
        rings.append(ring)
    for i in range(count if closed else count - 1):
        A, B = rings[i], rings[(i + 1) % count]
        for k in range(sides):
            m = (k + 1) % sides
            g.face((A[k], B[k], B[m], A[m]), key, smooth=not square)


def rod(g, a, b, r, key="bronze", sides=6):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u, v = frame(d)
    A = [g.vert(a + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)]
    B = [g.vert(b + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r) for k in range(sides)]
    for k in range(sides):
        m = (k + 1) % sides
        g.face((A[k], A[m], B[m], B[k]), key, smooth=True)


def legs(g, z, R, n=4, spread=1.25, r=0.05, rot=math.pi / 4):
    """n legs from a ring of radius R at height z splaying down to the plinth, with a cross of floor bars."""
    feet = []
    for k in range(n):
        a = rot + 2 * math.pi * k / n
        top = (R * math.cos(a), R * math.sin(a), z)
        foot = (R * spread * math.cos(a), R * spread * math.sin(a), 0.0)
        rod(g, foot, top, r)
        feet.append(foot)
    for k in range(n // 2):
        rod(g, feet[k], feet[k + n // 2], r * 0.9)


LAT = math.radians(39.9)


def globe():
    """天体仪: the celestial globe inside its horizon ring and meridian, on four legs."""
    g = Geo()
    ell(g, (0, 0, 1.75), (0.95, 0.95, 0.95), "bronze", nu=18, nv=10)
    torus(g, (0, 0, 1.75), 1.12, 0.06, (0, 0, 1), square=True)
    torus(g, (0, 0, 1.75), 1.02, 0.04, (1, 0, 0), a0=-0.3, a1=math.pi + 0.3)
    legs(g, 1.75, 1.12)
    return g


def armillary(tilts, R=1.2, z=2.2):
    """An armillary: a vertical meridian ring and rings tilted about the east-west axis, on a post with a dragon's
    coil, and a polar axis rod."""
    g = Geo()
    torus(g, (0, 0, z), R, 0.05, (1, 0, 0), square=True)
    for k, t in enumerate(tilts):
        rr = R - 0.08 * (k + 1)
        torus(g, (0, 0, z), rr, 0.04, (0, -math.sin(t), math.cos(t)), square=True)
    pole = Vector((0, math.cos(LAT), math.sin(LAT)))
    rod(g, Vector((0, 0, z)) - pole * R, Vector((0, 0, z)) + pole * R, 0.025)
    rod(g, (0, 0, 0), (0, 0, z - R), 0.14, sides=8)
    ell(g, (0, 0.05, z - R - 0.35), (0.26, 0.2, 0.42), "bronze", nu=10, nv=6)      # the dragon coiled on the post
    for k in range(4):
        a = math.pi / 4 + math.pi / 2 * k
        rod(g, (0.8 * math.cos(a), 0.8 * math.sin(a), 0.0), (0.1 * math.cos(a), 0.1 * math.sin(a), 0.5), 0.05)
    return g


def azimuth():
    """地平经仪: a horizontal circle on four legs, a post at its centre carrying the sighting arm."""
    g = Geo()
    torus(g, (0, 0, 1.3), 1.3, 0.06, (0, 0, 1), square=True)
    legs(g, 1.3, 1.3, spread=1.15)
    rod(g, (0, 0, 0.2), (0, 0, 3.1), 0.06)
    rod(g, (-1.3, 0, 1.36), (1.3, 0, 1.36), 0.035)
    rod(g, (0, 0, 3.0), (-1.2, 0, 1.4), 0.025)
    rod(g, (0, 0, 3.0), (1.2, 0, 1.4), 0.025)
    ell(g, (0, 0, 3.15), (0.12, 0.12, 0.15), "bronze", nu=8, nv=5)
    return g


def quadrant():
    """象限仪: a quarter circle in a vertical plane, hanging from a post that turns it round the sky."""
    g = Geo()
    R, c = 1.9, Vector((0, 0, 3.0))
    torus(g, c, R, 0.06, (0, 1, 0), a0=-math.pi / 2, a1=0.0, seg=18, square=True)
    rod(g, c, c + Vector((R, 0, 0)), 0.05)
    rod(g, c, c + Vector((0, 0, -R)), 0.05)
    rod(g, c + Vector((0, 0, -R * 0.55)), c + Vector((R * 0.55, 0, 0)), 0.035)
    rod(g, (0, 0, 0), (0, 0, 3.3), 0.08, sides=8)
    ell(g, (0, 0, 3.35), (0.14, 0.14, 0.14), "bronze", nu=8, nv=5)
    for k in range(4):
        a = math.pi / 4 + math.pi / 2 * k
        rod(g, (0.9 * math.cos(a), 0.9 * math.sin(a), 0.0), (0.05 * math.cos(a), 0.05 * math.sin(a), 0.9), 0.05)
    return g


def sextant():
    """纪限仪: a 60-degree arc at the end of a long arm, on a ball joint atop a post and three splayed legs."""
    g = Geo()
    apex, R = Vector((0, 0, 2.0)), 1.8
    tilt = math.radians(35)
    down = Vector((math.cos(tilt), 0, -math.sin(tilt)))
    normal = Vector((0, 1, 0))
    u, v = frame(normal)
    # the arc: centred on the apex, spanning 60 degrees about the arm
    base = math.atan2(down.dot(v), down.dot(u))
    torus(g, apex, R, 0.05, normal, a0=base - math.pi / 6, a1=base + math.pi / 6, seg=12, square=True)
    for s in (-1, 1):
        a = base + s * math.pi / 6
        rod(g, apex, apex + (u * math.cos(a) + v * math.sin(a)) * R, 0.035)
    rod(g, apex, apex + down * R, 0.05)
    ell(g, apex, (0.13, 0.13, 0.13), "bronze", nu=8, nv=5)
    rod(g, (0, 0, 0.4), apex, 0.08, sides=8)
    for k in range(3):
        a = 2 * math.pi * k / 3
        rod(g, (0.95 * math.cos(a), 0.95 * math.sin(a), 0.0), (0.06 * math.cos(a), 0.06 * math.sin(a), 0.7), 0.05)
    return g


def altazimuth():
    """地平经纬仪: a vertical circle turning on a horizontal one, four legs, a crossbar arch over the top."""
    g = Geo()
    torus(g, (0, 0, 1.2), 1.2, 0.055, (0, 0, 1), square=True)
    legs(g, 1.2, 1.2, spread=1.2)
    torus(g, (0, 0, 2.2), 0.95, 0.045, (0, 1, 0), square=True)
    rod(g, (0, 0, 1.2), (0, 0, 3.4), 0.05)
    torus(g, (0, 0, 1.2), 1.2, 0.04, (1, 0, 0), a0=0.0, a1=math.pi, seg=18, square=True)
    return g


def great_armillary():
    """玑衡抚辰仪: the great armillary sphere, rings within rings on a frame of two arched legs."""
    g = Geo()
    z, R = 2.7, 1.6
    torus(g, (0, 0, z), R, 0.07, (1, 0, 0), square=True)
    torus(g, (0, 0, z), R + 0.12, 0.06, (0, 0, 1), square=True)
    torus(g, (0, 0, z), R - 0.1, 0.05, (0, -math.sin(math.pi / 2 - LAT), math.cos(math.pi / 2 - LAT)), square=True)
    torus(g, (0, 0, z), R - 0.2, 0.045, (0, -math.sin(math.pi / 2 - LAT + 0.41), math.cos(math.pi / 2 - LAT + 0.41)), square=True)
    pole = Vector((0, math.cos(LAT), math.sin(LAT)))
    rod(g, Vector((0, 0, z)) - pole * (R + 0.2), Vector((0, 0, z)) + pole * (R + 0.2), 0.035)
    for s in (-1, 1):
        # an arched leg each side (east and west) from the floor up to the horizon ring
        torus(g, (s * 1.0, 0, 0.0), 1.9, 0.07, (0, 1, 0), a0=math.pi / 2 - 0.1 if s < 0 else 0.1, a1=math.pi - 0.3 if s < 0 else math.pi / 2 + 0.1, seg=10, square=True)
    for k in range(4):
        a = math.pi / 4 + math.pi / 2 * k
        rod(g, (1.9 * math.cos(a), 1.9 * math.sin(a), 0.0), ((R + 0.12) * math.cos(a), (R + 0.12) * math.sin(a), z), 0.05)
    rod(g, (-1.9, -1.9, 0.0), (1.9, 1.9, 0.0), 0.06)
    rod(g, (-1.9, 1.9, 0.0), (1.9, -1.9, 0.0), 0.06)
    return g


# (maker, x, y, plinth half size): two rows along the terrace, the great armillary at its north end
INSTRUMENTS = [
    (globe, -11.8, -6.2, 1.5), (lambda: armillary([math.pi / 2 - LAT]), -5.8, -6.4, 1.3), (azimuth, -1.6, -6.4, 1.5),
    (quadrant, -12.0, 0.6, 1.1), (lambda: armillary([math.pi / 2 - LAT, math.pi / 2 - LAT + 0.41]), -5.8, 0.4, 1.3), (sextant, -1.8, 0.6, 1.1),
    (altazimuth, -11.6, 7.0, 1.4), (great_armillary, -4.6, 7.2, 2.1),
]


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("古观象台")
    g = Geo()
    P, W, h = PLAT, WALL, PLAT["h"]
    # the wall stretch: battered on its outer (east) face and its cut ends, the platform against its west face
    wt = battered(g, W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"], "brick", "esn")
    g.polyn([(wt["w"], wt["s"], W["h"]), (wt["e"], wt["s"], W["h"]), (wt["e"], wt["n"], W["h"]), (wt["w"], wt["n"], W["h"])], "paving", (0, 0, 1))
    # the platform: battered on its three free faces, the wall's west face below and beside it
    pt = battered(g, P["x0"], P["x1"], P["y0"], P["y1"], 0.0, h, "brick", "wsn")
    g.polyn([(pt["w"], pt["s"], h), (pt["e"], pt["s"], h), (pt["e"], pt["n"], h), (pt["w"], pt["n"], h)], "paving", (0, 0, 1))
    # the platform's east face above the wall walk, and the wall's west face beside the platform
    g.polyn([(P["x1"], pt["s"], W["h"]), (P["x1"], pt["n"], W["h"]), (P["x1"], pt["n"], h), (P["x1"], pt["s"], h)], "brick", (1, 0, 0))
    for ya, yb in ((W["y0"] + BATTER, P["y0"]), (P["y1"], W["y1"] - BATTER)):
        g.polyn([(W["x0"], ya, 0.0), (W["x0"], yb, 0.0), (W["x0"], yb, W["h"]), (W["x0"], ya, W["h"])], "brick", (-1, 0, 0))
    # parapets: battlements on the outer faces, a plain 女墙 on the wall's inner side, an opening where the ramp arrives
    ry1 = RAMP["y1"]
    parapet(g, (pt["w"], pt["s"]), (pt["e"], pt["s"]), (0, -1), True, z=h)
    parapet(g, (pt["e"], pt["n"]), (pt["w"], pt["n"]), (0, 1), True, z=h)
    parapet(g, (pt["w"], pt["n"]), (pt["w"], ry1 + 3.0), (-1, 0), True, z=h)
    parapet(g, (pt["w"], ry1 - 0.2), (pt["w"], pt["s"]), (-1, 0), True, z=h)
    parapet(g, (pt["e"] - PARA["t"], pt["s"]), (pt["e"] - PARA["t"], pt["n"]), (1, 0), False, z=h)
    parapet(g, (wt["e"], wt["s"]), (wt["e"], wt["n"]), (1, 0), True, z=W["h"])
    parapet(g, (wt["w"] + PARA["t"], wt["n"]), (wt["w"] + PARA["t"], P["y1"] + 0.3), (-1, 0), False, z=W["h"])
    parapet(g, (wt["w"] + PARA["t"], P["y0"] - 0.3), (wt["w"] + PARA["t"], wt["s"]), (-1, 0), False, z=W["h"])
    parapet(g, (wt["w"], wt["n"]), (wt["e"], wt["n"]), (0, 1), False, z=W["h"])
    parapet(g, (wt["e"], wt["s"]), (wt["w"], wt["s"]), (0, -1), False, z=W["h"])
    # the 马道: a stepped ramp along the platform's west face, rising northwards to the terrace
    x1 = P["x0"] + 0.02
    x0 = x1 - RAMP["w"]
    y0, y1 = RAMP["y0"], ry1
    n = int(round(h / 0.3))
    run = (y1 - y0) / n
    for k in range(n):
        ya, yb, zt = y0 + k * run, y0 + (k + 1) * run, (k + 1) * h / n
        g.box(x0, x1 + k / n * BATTER, ya, yb + 0.02, zt - h / n, zt, "stone", skip=("-z", "-y", "+y", "+x") if k else ("-z", "+x"))
        g.polyn([(x0, ya, zt - h / n), (x1 + k / n * BATTER, ya, zt - h / n), (x1 + k / n * BATTER, ya, zt), (x0, ya, zt)], "stone", (0, -1, 0))
    # the ramp's side wall (brick, under the steps down to the ground) and its parapet
    g.polyn([(x0, y0, 0.0), (x0, y1, 0.0), (x0, y1, h), (x0, y0, 0.0)], "brick", (-1, 0, 0))
    g.box(x0, pt["w"], y1, y1 + 3.0, 0.0, h, "brick", skip=("-z", "+x"))           # the landing
    rail = []
    for k in range(n + 1):
        rail.append((x0 + 0.02, y0 + k * run, k * h / n))
    for a, b in zip(rail, rail[1:]):
        za, zb = a[2], b[2]
        q = [(x0 - 0.02, a[1], za), (x0 - 0.02, b[1], zb), (x0 - 0.02, b[1], zb + 1.0), (x0 - 0.02, a[1], za + 1.0)]
        g.polyn(q, "brick", (-1, 0, 0))
        g.polyn([(x0 + 0.4, a[1], za), (x0 + 0.4, b[1], zb), (x0 + 0.4, b[1], zb + 1.0), (x0 + 0.4, a[1], za + 1.0)], "brick", (1, 0, 0))
        g.polyn([(x0 - 0.02, a[1], za + 1.0), (x0 - 0.02, b[1], zb + 1.0), (x0 + 0.4, b[1], zb + 1.0), (x0 + 0.4, a[1], za + 1.0)], "cap", (0, 0, 1))
    parapet(g, (x0, y1 + 3.0), (x0, y1), (-1, 0), True, z=h)
    parapet(g, (pt["w"], y1 + 3.0), (x0, y1 + 3.0), (0, 1), True, z=h)
    # the instruments on their plinths
    tris_instr = 0
    for make, x, y, s in INSTRUMENTS:
        g.box(x - s, x + s, y - s, y + s, h, h + 0.45, "stone", skip=("-z",))
        ig = make()
        tris_instr += ig.tris()
        g.add(ig, Matrix.Translation((x, y, h + 0.45)))
    g.build("Observatory", collection("台", main), M, TILE)
    tris = g.tris()

    # far level: the two masses, the parapets as bands, the instruments as a few rings
    far = Geo()
    battered(far, W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"] + 1.4, "brick", "esn", base=0.001)
    battered(far, P["x0"], P["x1"], P["y0"], P["y1"], 0.0, h + 1.4, "brick", "wsn", base=0.001)
    far.polyn([(wt["w"], wt["s"], W["h"] + 1.4), (wt["e"], wt["s"], W["h"] + 1.4), (wt["e"], wt["n"], W["h"] + 1.4), (wt["w"], wt["n"], W["h"] + 1.4)], "paving", (0, 0, 1))
    far.polyn([(pt["w"], pt["s"], h + 1.4), (pt["e"], pt["s"], h + 1.4), (pt["e"], pt["n"], h + 1.4), (pt["w"], pt["n"], h + 1.4)], "paving", (0, 0, 1))
    far.polyn([(x0, y0, 0.0), (x0, y1, h), (x1, y1, h), (x1, y0, 0.0)], "stone", (0, -1, 1))
    for make, x, y, s in INSTRUMENTS:
        torus(far, (x, y, h + 2.4), s * 0.8, 0.08, (1, 0, 0), seg=8, sides=3)
    far.build("Massing", collection("LOD1", main), M, TILE)

    helpers = collection("碰撞体")
    collider_box(helpers, "platform", P["x0"], P["x1"], P["y0"], P["y1"], 0.0, h)
    collider_box(helpers, "wall", W["x0"], W["x1"], W["y0"], W["y1"], 0.0, W["h"])
    # parapets people cannot fall over
    t = PARA["t"]
    for x0_, x1_, y0_, y1_, z_ in ((pt["w"], pt["e"], pt["s"], pt["s"] + t, h), (pt["w"], pt["e"], pt["n"] - t, pt["n"], h),
                                   (pt["w"], pt["w"] + t, pt["s"], ry1 - 0.2, h), (pt["w"], pt["w"] + t, ry1 + 3.0, pt["n"], h),
                                   (pt["e"] - t, pt["e"], pt["s"], pt["n"], h),
                                   (wt["e"] - t, wt["e"], wt["s"], wt["n"], W["h"]), (wt["w"], wt["e"], wt["n"] - t, wt["n"], W["h"]),
                                   (wt["w"], wt["e"], wt["s"], wt["s"] + t, W["h"]), (wt["w"], wt["w"] + t, wt["s"], wt["n"], W["h"])):
        collider_box(helpers, "parapet", x0_, x1_, y0_, y1_, z_, z_ + 1.2)
    collider_pts(helpers, "ramp", [(x0, y0, 0.0), (x1, y0, 0.0), (x0, y1, h), (x1, y1, h), (x0, y1, 0.0), (x1, y1, 0.0)], role="WALK")
    collider_box(helpers, "landing", x0, pt["w"], y1, y1 + 3.0, 0.0, h)
    collider_box(helpers, "ramprail", x0 - 0.02, x0 + 0.4, y0, y1 + 3.0, 0.0, h + 1.0)
    for make, x, y, s in INSTRUMENTS:
        collider_box(helpers, "instrument", x - s, x + s, y - s, y + s, h, h + 3.2)
    flat_marker(helpers, "platform", [(P["x0"], P["y0"]), (P["x1"], P["y0"]), (P["x1"], P["y1"]), (P["x0"], P["y1"])], "FOOTPRINT")
    flat_marker(helpers, "wall", [(W["x0"], W["y0"]), (W["x1"], W["y0"]), (W["x1"], W["y1"]), (W["x0"], W["y1"])], "FOOTPRINT")
    flat_marker(helpers, "ramp", [(x0 - 3.0, y0 - 3.0), (P["x0"], y0 - 3.0), (P["x0"], y1 + 5.0), (x0 - 3.0, y1 + 5.0)], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "observatory", "北京古观象台", "Beijing Ancient Observatory"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", 2639.0, 293.0, -1.3
    s.far_distance = 500
    s.repo_path = REPO
    return dict(tris=tris, instruments=tris_instr)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
