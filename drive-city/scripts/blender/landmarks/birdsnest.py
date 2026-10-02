# 国家体育场「鸟巢」Beijing National Stadium (Herzog & de Meuron, 2008), built in Blender, marked with the
# bcity_landmark add-on's conventions. OSM way 152301551 (leisure=stadium) and relation 563404 (building=stadium)
# give the outline - 304 x 331 m, centred on game (-621.9, -9193.25) - and the building:parts 1459376699-716 its
# saddle: 68.5 m along the east and west sides stepping down to 40-48 m at the north and south ends (the published
# figures: 333 x 296 m, 69.2 m high, 40.1 m at the low points, the roof opening 185.3 x 127.5 m). The track
# (relation 3511227) gives the axis: its straights run 1.4 degrees east of north, so the heading is -1.4.
# The city's tiles end at game z -9258.4: the north ~100 m of the stadium stands past the built area.
#
#   blender -b -P scripts/blender/landmarks/birdsnest.py -- [--out art/landmarks/birdsnest.blend] [--export]
#
# Frame: Blender +X east, +Y north (the long axis), metres, origin on the ground at the outline's centre.
# The envelope is one surface parametrised by the polar angle phi round the centre and s: s in [0, 1] runs up the
# facade (a Catmull-Rom profile scaled by the plan radius R0(phi), a squarish superellipse, and the saddle height
# H(phi)), s in [1, 2] across the roof from the shoulder to the opening (an ellipse). The steel ("nest") is box
# sections swept along paths on that surface, oriented by its normal (which is what makes them look twisted):
#   - 24 primary trusses: straight lines in plan tangent to the roof opening (the real roof's arrangement - they
#     form the opening's rim), carried over the shoulder and down the facade with the same sideways drift to the
#     ground, steepening as they go;
#   - secondary roof members: lines tangent to larger copies of the opening at random angles, likewise continued
#     down the facade;
#   - facade infill: diagonals both ways from the ground, and a few shallow ones (the stairs woven into the
#     facade).
# Behind the steel: the red concrete bowl (glows red at night), the translucent roof membrane over the ring with
# the open oval over the pitch, three tiers of red seats with two bands of boxes, the track and pitch, and the
# podium: a paved ring 0.9 m up, sloping gently down to the plaza (a COLMESH: cars drive up it). The far level is
# the same envelope, opaque, with the lattice drawn into its texture.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Canvas, Geo, collider_pts, flat_marker, paving  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "birdsnest.blend")

GX, GZ, HEADING = -621.9, -9193.25, -1.4
AO, BO, NO = 151.0, 165.0, 2.1         # the plan at its widest (E-W, N-S semi-axes) and the superellipse exponent
AI, BI = 63.8, 92.6                    # the roof opening's semi-axes
HMIN, HMAX = 40.1, 69.2                # the saddle: low at the north and south ends, high on the east and west sides
RSH = 0.968                            # the shoulder (where facade turns into roof), as a fraction of R0
PZ = 0.9                               # the podium's top
EAST_LIMIT = -447.0                    # game x the podium keeps west of (the 龙形水系 bank is at -432)
NPHI = 192                             # columns round the envelope (membrane, bowl, stands, podium)

# facade profile knots (radius fraction of R0, height fraction of H), s = 0 .. 1 evenly
PROF = [(0.955, 0.00), (0.972, 0.30), (0.990, 0.60), (1.000, 0.83), (0.993, 0.95), (RSH, 1.00)]

_R = -HEADING * math.pi / 180
_C, _S = math.cos(_R), math.sin(_R)


def to_local(gx, gz):
    dx, dz = gx - GX, gz - GZ
    return (dx * _C - dz * _S, -(dx * _S + dz * _C))


def to_game(x, y):
    lz = -y
    return (GX + x * _C + lz * _S, GZ - x * _S + lz * _C)


# ---- the envelope --------------------------------------------------------------------------------------------

def sup_r(phi, a, b, n):
    c, s = abs(math.cos(phi)), abs(math.sin(phi))
    return ((c / a) ** n + (s / b) ** n) ** (-1.0 / n)


def R0(phi):
    return sup_r(phi, AO, BO, NO)


def Ri(phi):
    return sup_r(phi, AI, BI, 2.0)


def H(phi):
    psi = math.atan2(math.sin(phi) / BO, math.cos(phi) / AO)
    return HMIN + (HMAX - HMIN) * math.cos(psi) ** 2


def Hin(phi):
    return 0.82 * H(phi) + 2.0


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


_K = [(2 * PROF[0][0] - PROF[1][0], 2 * PROF[0][1] - PROF[1][1])] + PROF + [(2 * PROF[-1][0] - PROF[-2][0], 2 * PROF[-1][1] - PROF[-2][1])]


def facade_frac(s):
    s = min(max(s, 0.0), 1.0)
    n = len(PROF) - 1
    x = s * n
    i = min(int(x), n - 1)
    t = x - i
    rf = _cr(_K[i][0], _K[i + 1][0], _K[i + 2][0], _K[i + 3][0], t)
    zf = _cr(_K[i][1], _K[i + 1][1], _K[i + 2][1], _K[i + 3][1], t)
    return rf, zf


def roof_rz(phi, w):
    rsh = RSH * R0(phi)
    h = H(phi)
    return rsh + (Ri(phi) - rsh) * w, h + (Hin(phi) - h) * max(w, 0.0) ** 1.15


def env(phi, s):
    """The envelope point at polar angle phi and profile parameter s (facade 0..1, roof 1..2)."""
    if s <= 1.0:
        rf, zf = facade_frac(s)
        r, z = rf * R0(phi), zf * H(phi)
    else:
        r, z = roof_rz(phi, s - 1.0)
    return Vector((r * math.cos(phi), r * math.sin(phi), z))


def env_normal(phi, s):
    e = 1e-3
    dp = env(phi + e, s) - env(phi - e, s)
    s0, s1 = max(s - e, 0.0), min(s + e, 2.0)
    if s0 < 1.0 < s1:      # keep the difference on one side of the shoulder
        s0, s1 = (s - 2 * e, s) if s <= 1.0 else (s, s + 2 * e)
    ds = env(phi, s1) - env(phi, s0)
    n = dp.cross(ds)
    return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))


def plan_to_s(x, y):
    """A plan point over the roof: (phi, s), or None outside the shoulder."""
    phi = math.atan2(y, x) % (2 * math.pi)
    r = math.hypot(x, y)
    rsh, ri = RSH * R0(phi), Ri(phi)
    w = (rsh - r) / (rsh - ri)
    return phi, 1.0 + w, w


# ground arc length round the facade foot, for the facade members' sideways drift
_PH = np.linspace(0, 2 * math.pi, 4097)
_PTS = np.array([[0.97 * R0(p) * math.cos(p), 0.97 * R0(p) * math.sin(p)] for p in _PH])
_U = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(_PTS, axis=0).T))])
LP = float(_U[-1])


def U_of(phi):
    return float(np.interp(phi % (2 * math.pi), _PH, _U))


def phi_of(u):
    return float(np.interp(u % LP, _U, _PH))


def Vf(phi):
    return 1.12 * H(phi) + 6.0


# ---- members -------------------------------------------------------------------------------------------------

class Member:
    def __init__(self, hw, d, c, kind):
        self.pts = []      # (phi, s)
        self.hw, self.d, self.c, self.kind = hw, d, c, kind


def roof_line(k, alpha, step=5.0):
    """A straight line in plan tangent to the opening scaled by k at its parameter angle alpha, both ways to the
    shoulder: [(phi, s)] from one shoulder to the other, and the plan direction at each end (pointing out)."""
    a, b = AI * k, BI * k
    t0 = Vector((a * math.cos(alpha), b * math.sin(alpha)))
    d = Vector((-a * math.sin(alpha), b * math.cos(alpha))).normalized()
    halves = []
    for sgn in (1, -1):
        dd = d * sgn
        out = []
        t = 0.0
        prev = None
        while True:
            p = t0 + dd * t
            phi, s, w = plan_to_s(p.x, p.y)
            if w < 0:
                # bisect to the shoulder
                lo, hi = t - step, t
                for _ in range(30):
                    m = (lo + hi) / 2
                    q = t0 + dd * m
                    if plan_to_s(q.x, q.y)[2] < 0:
                        hi = m
                    else:
                        lo = m
                q = t0 + dd * lo
                phi, s, w = plan_to_s(q.x, q.y)
                out.append((phi, 1.0))
                break
            if w <= 1.0 + 1e-6:
                out.append((phi, min(s, 2.0)))
            prev = p
            t += step
            if t > 600:
                break
        halves.append((out, dd))
    (h1, d1), (h2, d2) = halves
    path = h2[::-1] + h1[1:]
    return path, d2, d1


def leg(phi_e, dout, step=3.5):
    """From the shoulder at phi_e down the facade to the ground, drifting sideways as the roof line ran."""
    tx, ty = -math.sin(phi_e), math.cos(phi_e)
    # the plan curve's real tangent (the superellipse is not a circle)
    p0, p1 = env(phi_e - 1e-3, 0.0), env(phi_e + 1e-3, 0.0)
    T = Vector((p1.x - p0.x, p1.y - p0.y)).normalized()
    N = Vector((T.y, -T.x))
    dt, dr = dout.dot(T), max(dout.dot(N), 0.05)
    k = dt / dr
    k = math.copysign(min(max(abs(k), 0.6), 1.5), k)
    vf = Vf(phi_e)
    n = max(4, math.ceil(vf / step))
    ue = U_of(phi_e)
    out = []
    for i in range(n + 1):
        tau = i / n
        u = ue + k * vf * (tau - 0.15 * tau * tau)
        out.append((phi_of(u), 1.0 - tau))
    return out


def facade_line(u0, k, s0, s1, step=3.5):
    phi0 = phi_of(u0)
    vf = Vf(phi0)
    L = abs(s1 - s0) * vf * math.sqrt(1 + k * k)
    n = max(3, math.ceil(L / step))
    return [(phi_of(u0 + k * vf * (s0 + (s1 - s0) * i / n)), s0 + (s1 - s0) * i / n) for i in range(n + 1)]


def members():
    rng = np.random.default_rng(2008)
    out = []
    # the primary trusses: 24 tangents to the opening
    for i in range(24):
        alpha = 2 * math.pi * i / 24 + 0.04 * rng.standard_normal()
        path, dA, dB = roof_line(1.0, alpha, step=6.0)
        m = Member(0.85, 1.25, 0.55, "primary")
        la = leg(path[0][0], dA)
        lb = leg(path[-1][0], dB)
        m.pts = la[::-1] + path[1:-1] + lb
        out.append(m)
    # secondary roof members, tangent to larger copies of the opening
    for i in range(50):
        k = rng.uniform(1.06, 1.42)
        alpha = rng.uniform(0, 2 * math.pi)
        path, dA, dB = roof_line(k, alpha, step=6.0)
        if len(path) < 3:
            continue
        m = Member(0.6, 0.8, 0.35, "secondary")
        m.pts = leg(path[0][0], dA)[::-1] + path[1:-1] + leg(path[-1][0], dB)
        out.append(m)
    # facade infill: diagonals from the ground both ways, a few shallow ones (the stairs)
    for i in range(130):
        u0 = rng.uniform(0, LP)
        k = rng.choice([-1, 1]) * rng.uniform(0.5, 1.4)
        s0 = 0.0 if i % 2 == 0 else rng.uniform(0.05, 0.35)
        s1 = rng.uniform(0.6, 1.0)
        m = Member(0.42, 0.45, 0.15, "infill")
        m.pts = facade_line(u0, k, s0, s1)
        out.append(m)
    for i in range(16):
        u0 = rng.uniform(0, LP)
        k = rng.choice([-1, 1]) * rng.uniform(2.0, 3.0)
        s0 = rng.uniform(0.02, 0.12)
        m = Member(0.5, 0.55, 0.2, "stair")
        m.pts = facade_line(u0, k, s0, s0 + rng.uniform(0.3, 0.5), step=5.0)
        out.append(m)
    return out


def sweep(g, m, key):
    """A box section along the member's path, oriented by the envelope normal."""
    P = [env(phi, s) for phi, s in m.pts]
    Nn = [env_normal(phi, s) for phi, s in m.pts]
    # drop near-duplicate points (the shoulder joins)
    keep = [0]
    for i in range(1, len(P)):
        if (P[i] - P[keep[-1]]).length > 0.3:
            keep.append(i)
    P, Nn = [P[i] for i in keep], [Nn[i] for i in keep]
    if len(P) < 2:
        return
    rings = []
    for i in range(len(P)):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        n = (Nn[i] - t * Nn[i].dot(t))
        n = n.normalized() if n.length > 1e-6 else Vector((0, 0, 1))
        b = t.cross(n)
        c = P[i] + n * m.c
        ring = [c + b * m.hw + n * m.d, c - b * m.hw + n * m.d, c - b * m.hw - n * m.d, c + b * m.hw - n * m.d]
        rings.append([g.vert(p) for p in ring])
    for a, b in zip(rings, rings[1:]):
        for j in range(4):
            k = (j + 1) % 4
            g.face((a[j], a[k], b[k], b[j]), key)


# ---- textures -------------------------------------------------------------------------------------------------

def stroke(img, x0, y0, x1, y1, w, col):
    h, wd, _ = img.shape
    xa, xb = int(math.floor(min(x0, x1) - w)), int(math.ceil(max(x0, x1) + w)) + 1
    ya, yb = int(math.floor(min(y0, y1) - w)), int(math.ceil(max(y0, y1) + w)) + 1
    xa, ya, xb, yb = max(xa, 0), max(ya, 0), min(xb, wd), min(yb, h)
    if xb <= xa or yb <= ya:
        return
    Y, X = np.mgrid[ya:yb, xa:xb].astype(np.float32) + 0.5
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy or 1.0
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    d = np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy))
    a = np.clip(w / 2 + 0.5 - d, 0, 1)[..., None]
    win = img[ya:yb, xa:xb]
    win[:] = win * (1 - a) + col * a


def far_image(mems, W=2048, Hh=1024):
    """The envelope unrolled: u = phi / 2pi, v = s / 2 (row 0 at the ground). The facade's ground is the red
    bowl in shade seen through the steel, the roof's the pale membrane; the steel drawn over both."""
    img = np.empty((Hh, W, 3), np.float32)
    v = (np.arange(Hh) + 0.5) / Hh * 2.0
    fac = np.clip(1.0 - v, 0, 1)
    red = srgb("#7a2219")
    deep = srgb("#4e1a15")
    pale = srgb("#cfd0cb")
    for r in range(Hh):
        if v[r] < 0.96:
            t = min(1.0, v[r] / 0.9)
            img[r] = red * (1 - t) + deep * t
        else:
            img[r] = pale
    rng = np.random.default_rng(5)
    img *= (0.94 + 0.12 * rng.random((Hh, W, 1))).astype(np.float32)
    steel = srgb("#a7abad")
    night = np.zeros_like(img)
    night[v < 0.96] = srgb("#260300")
    for m in mems:
        px = [(phi / (2 * math.pi) * W, s / 2 * Hh) for phi, s in m.pts]
        w = max(2.0, m.hw * 2 * 3.2)
        for (x0, y0), (x1, y1) in zip(px, px[1:]):
            if abs(x1 - x0) > W / 2:
                if x1 < x0:
                    x1 += W
                else:
                    x0 += W
                stroke(img, x0 - W, y0, x1 - W, y1, w, steel)
                stroke(night, x0 - W, y0, x1 - W, y1, w, np.zeros(3, np.float32))
            stroke(img, x0, y0, x1, y1, w, steel)
            stroke(night, x0, y0, x1, y1, w, np.zeros(3, np.float32))
    return image("BN_Far", img), image("BN_FarNight", night)


def bowl_images(size=256):
    """The red concrete bowl: 8 m a repeat, panels every 2 m, a floor slab band; the night map lights it red."""
    cv = Canvas(size, size, "#8f2419")
    ppm = size / 8
    cv.put(np.mod(cv.x, 2 * ppm) < 1.5, "#7a1d15")
    slab = (cv.y > 6.9 * ppm) & (cv.y < 7.5 * ppm)
    cv.put(slab, "#6d1d16")
    cv.noise(0.08, 3)
    night = Canvas(size, size, "#2c0300")
    night.put(np.mod(night.x, 2 * ppm) < 1.5, "#200200")
    night.put((night.y > 6.3 * ppm) & (night.y < 6.9 * ppm), "#480601")
    night.put(slab, "#240401")
    return image("BN_Bowl", cv.a.copy()), image("BN_BowlNight", night.a.copy())


def seat_image(size=256):
    """Red seats in rows every 0.8 m up the slope, a grey aisle every 8 m (one repeat)."""
    cv = Canvas(size, size, "#b4271f")
    ppm = size / 8
    row = np.mod(cv.y, 0.8 * ppm)
    cv.put(row < 0.25 * ppm, "#5b1612")
    cv.put((row >= 0.25 * ppm) & (row < 0.35 * ppm), "#8a8680")
    cv.put(cv.x < 1.0 * ppm, "#8f8b84")
    cv.noise(0.1, 4)
    return image("BN_Seats", cv.a.copy())


def fascia_images(size=128):
    cv = Canvas(size, size, "#2b3036")
    ppm = size / 4
    cv.put(np.mod(cv.x, 2 * ppm) < 2, "#6d7176")
    cv.put(cv.y < 0.3 * ppm, "#7a7e82")
    cv.put(cv.y > 3.6 * ppm, "#7a7e82")
    night = Canvas(size, size, "#000000")
    night.put((cv.y >= 0.3 * ppm) & (cv.y <= 3.6 * ppm) & (np.mod(cv.x, 2 * ppm) >= 2), "#ffd29a")
    return image("BN_Fascia", cv.a.copy()), image("BN_FasciaNight", night.a.copy())


def grass_image(size=256):
    cv = Canvas(size, size, "#4f8a3a")
    cv.put(np.mod(cv.y, size / 2) < size / 4, "#5a9844")
    cv.noise(0.1, 6)
    return image("BN_Grass", cv.a.copy())


def track_image(size=64):
    """One lane (1.22 m) across v, a white line at its edge."""
    cv = Canvas(size, size, "#b5452f")
    cv.put(cv.y < 2.5, "#e9e6df")
    cv.noise(0.08, 7)
    return image("BN_Track", cv.a.copy())


def materials(far_imgs):
    far_img, far_night = far_imgs
    bowl, bowl_n = bowl_images()
    fas, fas_n = fascia_images()
    M = dict(
        steel=material("BN_Steel", "#a1a6a9", 0.45, metal=0.45, props={"wet": "surface", "glowStrength": 0.15}),
        bowl=material("BN_Bowl", "#a52a1e", 0.8, tex=bowl, emit_tex=bowl_n,
                      props={"wet": "none", "emit": "night", "glow": "none"}),
        membrane=material("BN_Membrane", "#e6e5df", 0.55, props={"wet": "surface", "glow": "flood", "glowStrength": 0.3}),
        seats=material("BN_Seats", "#b4271f", 0.8, tex=seat_image(), props={"wet": "damp", "glow": "none"}),
        fascia=material("BN_Fascia", "#2b3036", 0.25, metal=0.3, tex=fas, emit_tex=fas_n, props={"wet": "surface", "glow": "none", "emit": "night"}),
        grass=material("BN_Grass", "#4f8a3a", 0.95, tex=grass_image(), props={"wet": "damp", "glow": "none", "layer": 10}),
        track=material("BN_Track", "#b5452f", 0.85, tex=track_image(), props={"wet": "ground", "glow": "none", "layer": 10}),
        apron=material("BN_Apron", "#a8432f", 0.85, props={"wet": "ground", "glow": "none", "layer": 9}),
        pave=material("BN_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        soffit=material("BN_Soffit", "#cfcdc6", 0.7, props={"wet": "none", "glow": "lamp", "glowColor": "#ff7a5c", "glowStrength": 0.12}),
        far=material("BN_FarShell", "#8a8a88", 0.6, metal=0.2, tex=far_img, emit_tex=far_night, props={"wet": "surface", "glowStrength": 0.15, "emit": "night"}),
    )
    mem = M["membrane"]
    b = mem.node_tree.nodes.get("Principled BSDF")
    b.inputs["Alpha"].default_value = 0.8
    try:
        mem.surface_render_method = "BLENDED"
    except Exception:
        mem.blend_method = "BLEND"
    return M


# ---- surfaces ------------------------------------------------------------------------------------------------

PHIS = [2 * math.pi * i / NPHI for i in range(NPHI)]


def grid(g, rows, key, uv=None, want_out=True):
    """Quads between consecutive rings of points; rows[j][i] is ring j at column i (closed round)."""
    n = len(rows[0])
    idx = [[g.vert(p) for p in r] for r in rows]
    for j in range(len(rows) - 1):
        for i in range(n):
            k = (i + 1) % n
            q = (idx[j][i], idx[j][k], idx[j + 1][k], idx[j + 1][i])
            uvs = None
            if uv:
                uvs = [uv(j, i, False), uv(j, k, k == 0), uv(j + 1, k, k == 0), uv(j + 1, i, False)]
            g.face(q, key, uvs)


def membrane(g):
    ss = [0.96, 0.985] + [1.0 + 0.1 * i for i in range(11)]
    rows = []
    for s in ss:
        r = []
        for phi in PHIS:
            p = env(phi, s) - env_normal(phi, s) * 0.2
            r.append(p)
        rows.append(r)
    grid(g, rows, "membrane", uv=lambda j, i, wrap: ((NPHI if wrap else i) * 0.25, ss[j] * 4))


def Rb(phi):
    return 0.955 * R0(phi) - 16.0


def wall_top(phi):
    rb = Rb(phi)
    rsh, ri = RSH * R0(phi), Ri(phi)
    w = (rsh - rb) / (rsh - ri)
    return roof_rz(phi, w)[1] - 1.2


def bowl_top(phi):
    return min(Ht(phi) + 9.0, wall_top(phi))


def bowl(g):
    """The red bowl's outer wall to a little over the top of the stands, and the pale soffit from its top out
    and up under the roof to the facade's shoulder (what shows through the upper facade)."""
    bot = [Vector((Rb(p) * math.cos(p), Rb(p) * math.sin(p), 0.5)) for p in PHIS]
    top = [Vector((Rb(p) * math.cos(p), Rb(p) * math.sin(p), bowl_top(p))) for p in PHIS]
    us = [0.0]
    for i in range(NPHI):
        us.append(us[-1] + (bot[(i + 1) % NPHI] - bot[i]).length)
    rows = [bot, top]
    grid(g, rows, "bowl", uv=lambda j, i, wrap: ((us[NPHI] if wrap else us[i]) / 8, (rows[j][i].z - 0.5) / 8))
    mid, edge = [], []
    for p in PHIS:
        q = env(p, 0.94) - env_normal(p, 0.94) * 2.5
        t = Vector((Rb(p) * math.cos(p), Rb(p) * math.sin(p), bowl_top(p)))
        mid.append(t.lerp(q, 0.5) + Vector((0, 0, 3.0)))
        edge.append(q)
    rows2 = [top, mid, edge]
    grid(g, rows2, "soffit", uv=lambda j, i, wrap: ((us[NPHI] if wrap else us[i]) / 8, j * 2.0))


def Rs0(phi):
    return sup_r(phi, 57.0, 101.0, 2.6)


def Ht(phi):
    return 0.6 * H(phi) + 2.0


STAND = [  # (radial fraction from Rs0 to Rb, height as (fraction of Ht, + metres), material of the strip below)
    (0.0, 0.0, 0.0, None),
    (0.0, 0.0, PZ, "fascia"),
    (0.33, 0.30, 0.0, "seats"),
    (0.33, 0.30, 3.2, "fascia"),
    (0.65, 0.62, 0.0, "seats"),
    (0.65, 0.62, 3.2, "fascia"),
    (1.0, 1.0, 0.0, "seats"),
]


def stand_pt(phi, f, hf, hm):
    r0, r1 = Rs0(phi), Rb(phi)
    r = r0 + (r1 - r0) * f
    return Vector((r * math.cos(phi), r * math.sin(phi), max(hf * Ht(phi) + hm, 0.05 if hf == 0 and hm == 0 else 0.0)))


def stands(g, phis=PHIS, simple=False):
    prof = STAND if not simple else [(0.0, 0.0, 0.0, None), (0.0, 0.0, PZ, "fascia"), (1.0, 1.0, 0.0, "seats")]
    rows = [[stand_pt(p, f, hf, hm) for p in phis] for f, hf, hm, _ in prof]
    n = len(phis)
    # arc length round each ring for u, length up the slope for v
    for j in range(len(rows) - 1):
        key = prof[j + 1][3]
        a, b = rows[j], rows[j + 1]
        ua = [0.0]
        for i in range(n):
            ua.append(ua[-1] + (a[(i + 1) % n] - a[i]).length)
        ia = [g.vert(p) for p in a]
        ib = [g.vert(p) for p in b]
        for i in range(n):
            k = (i + 1) % n
            uk = ua[n] if k == 0 else ua[k]
            if key == "fascia":
                uvs = [(ua[i] / 4, 0), (uk / 4, 0), (uk / 4, (b[k] - a[k]).length / 4), (ua[i] / 4, (b[i] - a[i]).length / 4)]
            else:
                uvs = [(ua[i] / 8, 0), (uk / 8, 0), (uk / 8, (b[k] - a[k]).length / 8), (ua[i] / 8, (b[i] - a[i]).length / 8)]
            g.face((ia[i], ia[k], ib[k], ib[i]), key, uvs)


# the track: a 400 m oval along Y (inner radius 36.5, straights 84.39 m), eight 1.22 m lanes
TR, TL, LANES = 36.5, 42.195, 8


def oval_r(phi, r):
    c, s = abs(math.cos(phi)), abs(math.sin(phi))
    if c > 1e-9 and r * s / c <= TL:
        return r / c
    return s * TL + math.sqrt(max(s * s * TL * TL - TL * TL + r * r, 0.0))


def oval_pts(r, n=160):
    """Points round the oval at offset radius r, evenly by arc length, with the arc length."""
    pts = []
    per = 2 * math.pi * r + 4 * TL
    for i in range(n):
        d = per * i / n
        if d < 2 * TL:          # east straight, going north
            pts.append(Vector((r, -TL + d)))
        elif d < 2 * TL + math.pi * r:
            a = (d - 2 * TL) / r
            pts.append(Vector((r * math.cos(a), TL + r * math.sin(a))))
        elif d < 4 * TL + math.pi * r:
            pts.append(Vector((-r, TL - (d - 2 * TL - math.pi * r))))
        else:
            a = math.pi + (d - 4 * TL - math.pi * r) / r
            pts.append(Vector((r * math.cos(a), -TL + r * math.sin(a))))
    return pts, per


def field(g, far=False):
    z = 0.05
    n = 160 if not far else 48
    inner, _ = oval_pts(TR, n)
    g.polyn([(p.x, p.y, z) for p in inner], "grass", (0, 0, 1), uvs=[(p.x / 12, p.y / 12) for p in inner])
    outer_r = TR + LANES * 1.22
    if not far:
        outer, per = oval_pts(outer_r, n)
        ia = [g.vert((p.x, p.y, z)) for p in inner]
        ib = [g.vert((p.x, p.y, z)) for p in outer]
        for i in range(n):
            k = (i + 1) % n
            u0, u1 = i / n * per / 4, (i + 1) / n * per / 4
            g.face((ia[i], ia[k], ib[k], ib[i]), "track", [(u0, 0), (u1, 0), (u1, LANES), (u0, LANES)])
    # the apron from the track to the stands' foot, by rays from the centre
    m = 96 if not far else 48
    r_in = outer_r if not far else TR
    a = [Vector((oval_r(2 * math.pi * i / m, r_in) * math.cos(2 * math.pi * i / m), oval_r(2 * math.pi * i / m, r_in) * math.sin(2 * math.pi * i / m), z - 0.01)) for i in range(m)]
    b = [Vector((Rs0(2 * math.pi * i / m) * math.cos(2 * math.pi * i / m), Rs0(2 * math.pi * i / m) * math.sin(2 * math.pi * i / m), z - 0.01)) for i in range(m)]
    for i in range(m):
        k = (i + 1) % m
        g.polyn([a[i], a[k], b[k], b[i]], "apron", (0, 0, 1))


def podium_rings(phis):
    """Per ray: the bowl wall, the flat podium's edge and the slope's foot."""
    out = []
    for p in phis:
        r0 = R0(p)
        den = math.cos(p) * _C - math.sin(p) * _S
        rmax = (EAST_LIMIT - GX) / den if den > 1e-6 else 1e9
        foot = min(r0 + 32.0, rmax)
        edge = min(r0 + 12.0, foot - 9.0)
        out.append((Rb(p) - 0.5, edge, foot))
    return out


def podium(g, col=None):
    rings = podium_rings(PHIS)
    rows = [
        [Vector((r[0] * math.cos(p), r[0] * math.sin(p), PZ)) for p, r in zip(PHIS, rings)],
        [Vector((r[1] * math.cos(p), r[1] * math.sin(p), PZ)) for p, r in zip(PHIS, rings)],
        [Vector((r[2] * math.cos(p), r[2] * math.sin(p), 0.02)) for p, r in zip(PHIS, rings)],
    ]
    for j in range(2):
        for i in range(NPHI):
            k = (i + 1) % NPHI
            q = [rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]]
            g.polyn(q, "pave", (0, 0, 1), uvs=[(p.x / 4, p.y / 4) for p in q])
            if col is not None:
                col.polyn(q, "x", (0, 0, 1))
    return rows


def far_shell(g):
    nphi = 96
    ss = [i / 8 for i in range(9)] + [1.0 + i / 5 for i in range(1, 6)]
    phis = [2 * math.pi * i / nphi for i in range(nphi)]
    rows = [[env(p, s) for p in phis] for s in ss]
    grid(g, rows, "far", uv=lambda j, i, wrap: ((nphi if wrap else i) / nphi, ss[j] / 2))
    return phis


# ---- build ---------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    mems = members()
    M = materials(far_image(mems))
    main = collection("国家体育场")

    gs = Geo()
    counts = {}
    for m in mems:
        sweep(gs, m, "steel")
        counts[m.kind] = counts.get(m.kind, 0) + 1
    gs.build("Nest", collection("钢结构", main), M)
    tris_steel = gs.tris()

    g = Geo()
    membrane(g)
    bowl(g)
    stands(g)
    field(g)
    col = Geo()
    podium(g, col)
    g.build("Bowl", collection("看台与屋面", main), M)
    tris_rest = g.tris()

    # far level
    far = Geo()
    phis = far_shell(far)
    stands(far, phis, simple=True)
    field(far, far=True)
    rings = podium_rings(phis)
    for i in range(len(phis)):
        k = (i + 1) % len(phis)
        for (r0, z0), (r1, z1) in (((0, PZ), (1, PZ)), ((1, PZ), (2, 0.02))):
            q = [Vector((rings[i][r0] * math.cos(phis[i]), rings[i][r0] * math.sin(phis[i]), z0)),
                 Vector((rings[k][r0] * math.cos(phis[k]), rings[k][r0] * math.sin(phis[k]), z0)),
                 Vector((rings[k][r1] * math.cos(phis[k]), rings[k][r1] * math.sin(phis[k]), z1)),
                 Vector((rings[i][r1] * math.cos(phis[i]), rings[i][r1] * math.sin(phis[i]), z1))]
            far.polyn(q, "pave", (0, 0, 1), uvs=[(p.x / 4, p.y / 4) for p in q])
    far.build("Massing", collection("LOD1", main), M)

    # colliders
    import bcity_landmark
    helpers = collection("碰撞体")
    co = col.build("podium", helpers, {"x": None})
    co.data.materials.clear()
    bcity_landmark.rename(co, "COLMESH")
    nseg = 56
    for i in range(nseg):
        pa, pb = 2 * math.pi * i / nseg, 2 * math.pi * (i + 1) / nseg + 0.004
        pts = []
        for p in (pa, (pa + pb) / 2, pb):
            for s, dr in ((0.0, -2.0), (0.0, 1.2), (0.22, -2.0), (0.22, 1.2)):
                q = env(p, s)
                r = math.hypot(q.x, q.y) + dr
                pts.append((r * math.cos(p), r * math.sin(p), q.z if s > 0 else -0.5))
        collider_pts(helpers, f"facade{i}", pts)
    # footprint: the outline (a metre over), and the eight small OSM buildings round it that the podium covers;
    # clear: the podium (street trees, lamps and the canopy's trees off it)
    flat_marker(helpers, "stadium", [(R0(p) * 1.01 * math.cos(p), R0(p) * 1.01 * math.sin(p)) for p in PHIS[::4]], "FOOTPRINT")
    small = {
        1457191350: (-793, -779, -9234, -9205), 1457191351: (-790, -773, -9175, -9146), 1457191352: (-759, -740, -9087, -9061),
        1457191353: (-694, -668, -9023, -9005), 1457191354: (-556, -532, -9034, -9015), 1457191355: (-489, -472, -9125, -9098),
        1457191359: (-479, -463, -9261, -9232), 1457191360: (-472, -457, -9172, -9143),
    }
    for wid, (x0, x1, z0, z1) in small.items():
        flat_marker(helpers, f"osm{wid}", [to_local(x, z) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))], "FOOTPRINT")
    flat_marker(helpers, "podium", [(r[2] * math.cos(p), r[2] * math.sin(p)) for p, r in zip(PHIS[::3], podium_rings(PHIS[::3]))], "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "birdsnest", "国家体育场（鸟巢）", "Beijing National Stadium (Bird's Nest)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 800
    s.repo_path = REPO
    return dict(members=counts, steel=tris_steel, rest=tris_rest, far=far.tris(), LP=round(LP, 1))


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
