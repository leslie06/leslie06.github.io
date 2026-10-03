# 银河SOHO Galaxy SOHO (Zaha Hadid Architects, 2009-2012) at 朝阳门, built in Blender and marked with the
# bcity_landmark add-on's conventions. OSM has the complex as relation 6096147 (building=commercial): one outer
# ring round the four fused domes with two inner rings (the round courtyards between them), and a second outer
# ring for a low building at the north-west corner; the site is way 1092618932 (landuse=retail). The city drew
# the whole thing as one flat-roofed 49 m office block.
#
#   blender -b -P scripts/blender/landmarks/galaxy_soho.py -- [--out art/landmarks/galaxysoho.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at game (2502, -1163) (the centre of OSM's
# outline's box), heading 0 (OSM's long edges run 1-2 degrees off north; the model is drawn straight in game
# metres from OSM's points, so no turn is needed).
#
# The figures (zaha-hadid.com, Wikipedia, e-architect): four dome-like volumes, 67 m, 15 storeys above ground
# (three of retail at the bottom, offices, bars and restaurants at the top), each round a glazed atrium open to
# the sky; the volumes fuse at the bottom and are joined by stretched bridges at several levels. Their skin is
# continuous horizontal white aluminium bands with recessed ribbon windows between them, each floor stepping in
# a little more towards the top, so the domes read as stacks of rounded plates.
#
# What is modelled:
# - the podium (floors 1-3) on OSM's outer ring (Chaikin-smoothed) with the two courtyards cut through it, in the
#   same band-and-ribbon skin, shop glass on the ground floor, a flat roof at 13.4 m;
# - four towers from the podium roof up: each base outline a superellipse fitted to OSM's ring and to satellite
#   imagery (Esri, .scratch/lm/galaxysoho/sat*.png), each floor's plate a blend of that outline towards its atrium
#   (s = smin + (1 - smin) sqrt(1 - t^2.6)), so the floors step in like a dome; every floor a rounded white band
#   over a ribbon of glass set 0.9 m back (the kit's facade shader: mullions, lit windows at night); the atrium's
#   walls banded the same way facing in, a glass roof over it at the podium's top, a flat white roof at the top;
# - links between neighbouring towers along curves: three wide two-storey ones fusing the domes just over the
#   podium, seven one-storey sky bridges higher up (band, glass ribbon, band in section);
# - the low north-west building (OSM's second ring) as three stepped floors with dark skylights on its roof;
# - a far level: the domes as smooth lofts whose bands and ribbons are drawn by the facade shader.
# Colliders: the podium's and the north-west building's walls as a trimesh, a convex hull per tower.
#
# Doubtful: the towers' heights (all four are published as 67 m; here the two western ones have 14 floors,
# 62.6 m, the two eastern 15), the base outlines (OSM's ring is the fused footprint; the split between towers is
# read off the satellite image, whose tall roofs lean ~10 m east, so the atria were moved back west by that);
# the atria's sizes; which towers the bridges join and at which floors; the north-west building (imagery shows a
# low white building with dark openings in its roof; its height and use are guesses). Not modelled: entrances,
# signs, the sunken plazas and the basement ramps.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GX, GZ = 2502.0, -1163.0
FH = 4.47                 # storey height: 67 m / 15
G = 1.95                  # the glass ribbon's height in each storey (the band takes the rest)
RECESS = 0.9              # how far the ribbon is set behind the band's face
PODIUM = 3                # podium storeys
SMIN = 0.22

# OSM relation 6096147, game metres (x east, z south)
OUTER = [(2446.5, -1229.8), (2453.2, -1229.3), (2462.9, -1226.7), (2468.2, -1221.4), (2473.8, -1217.9), (2476.4, -1217.7), (2482.4, -1220.9), (2490.5, -1228.9), (2494.5, -1236.4), (2495.9, -1243.4), (2494.1, -1252.6), (2496.2, -1261.9), (2499.4, -1269.9), (2507.4, -1279.8), (2512.7, -1284.0), (2524.5, -1285.9), (2538.4, -1280.9), (2548.7, -1273.6), (2558.4, -1262.3), (2564.6, -1252.3), (2568.0, -1243.6), (2572.1, -1234.4), (2573.0, -1218.3), (2571.9, -1191.1), (2574.6, -1115.3), (2576.3, -1083.4), (2573.6, -1067.6), (2570.6, -1053.9), (2566.0, -1046.1), (2559.9, -1042.3), (2551.1, -1039.7), (2543.0, -1038.6), (2535.5, -1040.7), (2528.9, -1043.9), (2523.0, -1050.0), (2515.9, -1058.1), (2502.4, -1063.8), (2486.6, -1065.0), (2471.7, -1067.7), (2459.6, -1071.7), (2449.9, -1076.8), (2442.8, -1085.7), (2435.8, -1097.7), (2430.8, -1108.4), (2430.6, -1116.5), (2430.8, -1124.5), (2434.0, -1132.6), (2436.4, -1139.7), (2437.5, -1152.7), (2436.4, -1162.2), (2431.9, -1172.2), (2428.9, -1184.9), (2427.8, -1196.3), (2427.8, -1207.4), (2430.8, -1218.1), (2435.6, -1226.4), (2440.8, -1229.1)]
HOLES = [
    [(2493.4, -1209.6), (2487.5, -1201.6), (2485.6, -1196.1), (2487.5, -1189.2), (2494.6, -1179.8), (2502.8, -1174.3), (2509.9, -1173.4), (2515.6, -1177.3), (2520.5, -1187.4), (2521.6, -1195.2), (2521.8, -1199.5), (2518.4, -1203.4), (2513.4, -1209.1), (2508.8, -1214.9), (2507.4, -1217.6), (2500.3, -1215.3)],
    [(2506.9, -1154.0), (2504.2, -1143.4), (2503.7, -1130.8), (2504.0, -1115.5), (2505.6, -1105.4), (2505.1, -1100.6), (2501.4, -1096.5), (2498.5, -1098.8), (2492.5, -1108.6), (2488.6, -1121.2), (2486.8, -1131.7), (2487.7, -1140.9), (2491.1, -1152.8), (2495.3, -1159.7), (2498.0, -1163.6), (2503.5, -1158.1)],
]
PAVILION = [(2434.4, -1236.2), (2442.7, -1238.1), (2450.5, -1239.2), (2457.7, -1238.4), (2461.3, -1237.8), (2463.6, -1239.8), (2464.4, -1242.8), (2464.1, -1254.8), (2468.8, -1269.5), (2472.2, -1277.9), (2471.1, -1280.1), (2468.3, -1284.0), (2461.3, -1286.5), (2448.3, -1287.6), (2443.2, -1285.4), (2439.1, -1282.3), (2435.2, -1275.6), (2432.4, -1263.4), (2431.6, -1251.7), (2431.8, -1240.9), (2431.8, -1237.3)]

# towers: centre (game), half-extents east / west / north / south, exponent, atrium centre (game) and half-extents,
# storeys
TOWERS = {
    "NE": dict(c=(2534.0, -1250.0), ext=(37.0, 39.5, 36.0, 36.0), n=2.3, eye=(2541.0, -1251.0), eext=(14.5, 14.5, 14.0, 14.0), floors=15),
    "SE": dict(c=(2541.0, -1124.0), ext=(33.0, 33.0, 82.0, 84.0), n=2.4, eye=(2547.0, -1124.0), eext=(14.0, 14.0, 29.0, 29.0), floors=15),
    "W": dict(c=(2458.0, -1193.0), ext=(28.0, 30.0, 35.0, 33.0), n=2.4, eye=(2464.0, -1193.0), eext=(11.0, 11.0, 12.0, 12.0), floors=14),
    "SW": dict(c=(2460.0, -1114.0), ext=(27.5, 29.5, 40.0, 44.0), n=2.4, eye=(2464.0, -1117.0), eext=(11.5, 11.5, 13.0, 13.0), floors=14),
}
M_RING = 56
# links: (tower, tower, first storey, sideways bulge, storeys, half width) - wide two-storey ones fusing the domes
# just over the podium, one-storey sky bridges higher up
BRIDGES = [("W", "SW", 3, 0.0, 2, 11.0), ("W", "NE", 3, 0.0, 2, 8.0), ("SW", "SE", 3, 0.0, 2, 8.0),
           ("W", "SW", 8, 5.0, 1, 4.2), ("SW", "SE", 7, -6.0, 1, 4.2), ("SW", "SE", 11, 4.0, 1, 4.2),
           ("W", "SE", 6, 5.0, 1, 4.2), ("W", "SE", 10, -5.0, 1, 4.2), ("W", "NE", 7, 6.0, 1, 4.2), ("W", "NE", 11, -4.0, 1, 4.2)]


def L(p):
    """Game (x, z) to the model's (x, y)."""
    return (p[0] - GX, -(p[1] - GZ))


def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def ccw(pts):
    return pts if area(pts) > 0 else pts[::-1]


def chaikin(pts, it=2):
    for _ in range(it):
        out = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        pts = out
    return pts


def resample(pts, n):
    """n points evenly along the closed ring."""
    seg = [math.hypot(pts[(i + 1) % len(pts)][0] - pts[i][0], pts[(i + 1) % len(pts)][1] - pts[i][1]) for i in range(len(pts))]
    tot = sum(seg)
    out, i, acc = [], 0, 0.0
    for k in range(n):
        d = tot * k / n
        while acc + seg[i] < d:
            acc += seg[i]
            i += 1
        t = (d - acc) / seg[i] if seg[i] else 0.0
        a, b = pts[i], pts[(i + 1) % len(pts)]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def smooth_ring(game_pts, n):
    return resample(ccw(chaikin([L(p) for p in game_pts], 3)), n)


def offset(ring, d):
    """Each vertex moved `d` along the ring's outward normal (counter-clockwise ring), mitred, clamped."""
    n = len(ring)
    out = []
    for i in range(n):
        a, p, b = ring[i - 1], ring[i], ring[(i + 1) % n]
        e0 = (p[0] - a[0], p[1] - a[1])
        e1 = (b[0] - p[0], b[1] - p[1])
        l0, l1 = math.hypot(*e0) or 1.0, math.hypot(*e1) or 1.0
        n0 = (e0[1] / l0, -e0[0] / l0)
        n1 = (e1[1] / l1, -e1[0] / l1)
        nx, ny = n0[0] + n1[0], n0[1] + n1[1]
        ln = math.hypot(nx, ny) or 1.0
        nx, ny = nx / ln, ny / ln
        k = 1.0 / max(0.5, nx * n0[0] + ny * n0[1])
        out.append((p[0] + nx * d * k, p[1] + ny * d * k))
    return out


def superellipse(c, ext, n, m=M_RING):
    cx, cy = L(c)
    E, W, N, S = ext
    out = []
    for i in range(m):
        t = 2 * math.pi * i / m
        co, si = math.cos(t), math.sin(t)
        x = (E if co >= 0 else W) * math.copysign(abs(co) ** (2 / n), co)
        y = (N if si >= 0 else S) * math.copysign(abs(si) ** (2 / n), si)
        out.append((cx + x, cy + y))
    return out


def shrink(t):
    """The plate's share of the way from the atrium out to the base outline at height fraction t."""
    return SMIN + (1 - SMIN) * math.sqrt(max(0.0, 1 - t ** 2.6))


def tower_rings(name):
    T = TOWERS[name]
    base = superellipse(T["c"], T["ext"], T["n"])
    eye = superellipse(T["eye"], T["eext"], 2.2)
    nf = T["floors"]

    def ring(s):
        return [(e[0] + (b[0] - e[0]) * s, e[1] + (b[1] - e[1]) * s) for b, e in zip(base, eye)]
    plates = [ring(shrink((j + 1) / nf)) if j >= PODIUM else ring(1.0) for j in range(nf)]
    return base, eye, plates


def centroid(r):
    return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))


def bezier(a, c, b, t):
    return tuple((1 - t) ** 2 * a[k] + 2 * (1 - t) * t * c[k] + t * t * b[k] for k in range(2))


def bridge_path(a_name, b_name, j, bulge, samples=14):
    ra = tower_rings(a_name)[2][j]
    rb = tower_rings(b_name)[2][j]
    ca, cb = centroid(ra), centroid(rb)
    pa = min(ra, key=lambda p: math.hypot(p[0] - cb[0], p[1] - cb[1]))
    pb = min(rb, key=lambda p: math.hypot(p[0] - ca[0], p[1] - ca[1]))

    def inward(p, c, d=3.0):
        L_ = math.hypot(c[0] - p[0], c[1] - p[1])
        return (p[0] + (c[0] - p[0]) / L_ * d, p[1] + (c[1] - p[1]) / L_ * d)
    pa, pb = inward(pa, ca), inward(pb, cb)
    mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
    dx, dy = pb[0] - pa[0], pb[1] - pa[1]
    ln = math.hypot(dx, dy)
    ctrl = (mx - dy / ln * bulge, my + dx / ln * bulge)
    return [bezier(pa, ctrl, pb, k / samples) for k in range(samples + 1)]


# ---------------------------------------------------------------- Blender from here on

def build():
    from common import REPO, clear_file, collection, ensure_addon, material
    from kit import Geo, collider_pts, flat_marker
    from tower import facade
    import bpy
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon

    clear_file()
    ensure_addon()
    import bcity_landmark

    GLASS = dict(floorH=G, colW=1.5, glass="#4a5866", frame="#3a4148", spandrel="#3a4148", mull=0.035, slab=0.03, metal=0.85, rough=0.08, lit=0.32, warm="#ffd7a0", coolShare=0.45, seed=21)
    M = dict(
        band=material("GS_Band", "#ecebe6", 0.32, metal=0.15, props={"wet": "surface", "glow": "none"}),
        glass=facade("GS_Glass", GLASS),
        shop=facade("GS_Shop", dict(GLASS, floorH=FH, colW=2.2, glass="#56697a", slab=0.0, mull=0.03, lit=0.75, coolShare=0.0, seed=5)),
        roof=material("GS_Roof", "#d6d6d2", 0.6, props={"wet": "ground", "glow": "none"}),
        sky=material("GS_Skylight", "#3c4a56", 0.08, metal=0.7, props={"wet": "surface", "glow": "none"}),
        far=facade("GS_Far", dict(floorH=FH, colW=200.0, glass="#45525e", frame="#ecebe6", spandrel="#ecebe6", mull=0.0, slab=0.56, metal=0.3, rough=0.25, lit=0.25, warm="#ffd7a0", seed=3)),
    )
    TILE = dict(band=4.0, roof=4.0, sky=4.0)
    main = collection("银河SOHO")

    def loftv(g, rings, key, vfun=lambda z: z, inward=False, smooth=True):
        """A skin through rings [(z, pts)] with u = metres along the first ring and v = vfun(z)."""
        m = len(rings[0][1])
        ids = [[g.vert((x, y, z)) for (x, y) in pts] for z, pts in rings]
        us = []
        for z, pts in rings:
            u, row = 0.0, [0.0]
            for i in range(1, m + 1):
                a, b = pts[i - 1], pts[i % m]
                u += math.hypot(b[0] - a[0], b[1] - a[1])
                row.append(u)
            us.append(row)
        for j in range(len(rings) - 1):
            v0, v1 = vfun(rings[j][0]), vfun(rings[j + 1][0])
            for i in range(m):
                a, b = ids[j][i], ids[j][(i + 1) % m]
                c, d = ids[j + 1][(i + 1) % m], ids[j + 1][i]
                uv = [(us[j][i], v0), (us[j][i + 1], v0), (us[j + 1][i + 1], v1), (us[j + 1][i], v1)]
                if inward:
                    g.face([d, c, b, a], key, uv[::-1], smooth)
                else:
                    g.face([a, b, c, d], key, uv, smooth)

    def annulus(g, z, outer, inner, key, up=True):
        m = len(outer)
        for i in range(m):
            k = (i + 1) % m
            g.polyn([(*outer[i], z), (*outer[k], z), (*inner[k], z), (*inner[i], z)], key, (0, 0, 1 if up else -1))

    def fill(g, z, loops, key, up=True):
        """A flat polygon with holes at height z."""
        vs = [Vector((x, y, z)) for lp in loops for (x, y) in lp]
        ids = [g.vert(v) for v in vs]
        for tri in tessellate_polygon([[Vector((x, y, z)) for (x, y) in lp] for lp in loops]):
            a, b, c = (vs[i] for i in tri)
            n = (b - a).cross(c - a)
            t = [ids[i] for i in tri]
            if (n.z > 0) != up:
                t = t[::-1]
            g.face(t, key)

    def ribbon_v(j):
        return lambda z: j * G + (z - j * FH)

    def floor_out(g, j, ring, nxt, glass_key="glass", glass_h=G, recess=RECESS):
        """One storey of the outer skin: a ribbon of glass set back, a rounded band; the ledge up to the next storey."""
        z0, z1 = j * FH, (j + 1) * FH
        zg = z0 + glass_h
        rin = offset(ring, -recess)
        loftv(g, [(z0, rin), (zg, rin)], glass_key, ribbon_v(j) if glass_key == "glass" else (lambda z: z), smooth=False)
        annulus(g, zg, ring, rin, "band", up=False)
        nose = offset(ring, -0.3)
        loftv(g, [(zg, nose), ((zg + z1) / 2, ring), (z1, nose)], "band")
        if nxt is not None:
            annulus(g, z1, nose, offset(nxt, -recess), "band", up=True)

    def floor_in(g, j, eye):
        """One storey of a courtyard or atrium wall (the ring counter-clockwise, the wall facing in): the ribbon
        set back, the band flush - seen from the street only where a courtyard opens, so no rounded nose."""
        z0, z1 = j * FH, (j + 1) * FH
        zg = z0 + G
        rout = offset(eye, RECESS * 0.6)
        loftv(g, [(z0, rout), (zg, rout)], "glass", ribbon_v(j), inward=True, smooth=False)
        annulus(g, zg, rout, eye, "band", up=False)
        loftv(g, [(zg, eye), (z1, eye)], "band", inward=True)
        annulus(g, z1, rout, eye, "band", up=True)

    stats = {}
    g = Geo()
    # the podium: OSM's outer ring and the two courtyards, three storeys
    outer = smooth_ring(OUTER, 220)
    holes = [smooth_ring(h, 40) for h in HOLES]
    top = PODIUM * FH
    for j in range(PODIUM):
        floor_out(g, j, outer, outer if j < PODIUM - 1 else None, "shop" if j == 0 else "glass", glass_h=3.0 if j == 0 else G, recess=1.6 if j == 0 else RECESS)
        for h in holes:
            floor_in(g, j, h)
    nose = offset(outer, -0.3)
    fill(g, top, [nose] + [offset(h, 0.3)[::-1] for h in holes], "roof")
    # the north-west building: three storeys stepping in, a flat roof with dark skylights
    pav = smooth_ring(PAVILION, 72)
    pav_rings = [offset(pav, -1.2 * j) for j in range(PODIUM)]
    for j in range(PODIUM):
        floor_out(g, j, pav_rings[j], pav_rings[j + 1] if j < PODIUM - 1 else None, "shop" if j == 0 else "glass", glass_h=3.0 if j == 0 else G, recess=1.6 if j == 0 else RECESS)
    pr = offset(pav_rings[-1], -0.3)
    fill(g, top, [pr], "roof")
    pc = centroid(pav)
    for k, (dx, dy, rx, ry, a) in enumerate(((-6.0, 10.0, 9.0, 3.2, 0.6), (5.0, 2.0, 7.5, 3.0, -0.9), (-4.0, -12.0, 8.0, 3.4, 0.3))):
        ell = [(pc[0] + dx + rx * math.cos(t) * math.cos(a) - ry * math.sin(t) * math.sin(a), pc[1] + dy + rx * math.cos(t) * math.sin(a) + ry * math.sin(t) * math.cos(a))
               for t in (2 * math.pi * i / 20 for i in range(20))]
        fill(g, top + 0.06, [ell], "sky")
    stats["podium"] = g.tris()

    # the towers, from the podium's roof up
    for name, T in TOWERS.items():
        base, eye, plates = tower_rings(name)
        nf = T["floors"]
        for j in range(PODIUM, nf):
            floor_out(g, j, plates[j], plates[j + 1] if j + 1 < nf else None)
            floor_in(g, j, eye)
        H = nf * FH
        annulus(g, H, offset(plates[-1], -0.3), offset(eye, 0.3), "roof")
        # the atrium's glass roof over the shops
        fill(g, top + 0.05, [offset(eye, RECESS)], "sky")
    stats["towers"] = g.tris() - stats["podium"]

    # sky bridges along a curve between two towers: k storeys of band and glass in section, w wide
    def section(k, w):
        right = [(w - 0.6, -1.3, "band"), (w, -0.6, "band")]
        for i in range(k):
            z = i * FH
            right += [(w - 0.5, z, "glass"), (w - 0.5, z + G, "band"), (w, z + G + 0.4, "band"), (w, z + FH - 0.4, "band")]
        right.append((w - 0.6, k * FH, "band"))
        # the left side runs back down: each point keys the segment that starts at it
        left = []
        rev = right[::-1]
        for i, (s_, h, _) in enumerate(rev):
            key = rev[i + 1][2] if i + 1 < len(rev) else "band"
            left.append((-s_, h, key))
        return right + left

    for a, b, j, bulge, k, w in BRIDGES:
        sec = section(k, w)
        path = bridge_path(a, b, j, bulge)
        z0 = j * FH
        rows = []
        for kk, p in enumerate(path):
            q0, q1 = path[max(0, kk - 1)], path[min(len(path) - 1, kk + 1)]
            dx, dy = q1[0] - q0[0], q1[1] - q0[1]
            ln = math.hypot(dx, dy)
            sx, sy = dy / ln, -dx / ln          # to the right of the path
            rows.append([g.vert((p[0] + sx * s_, p[1] + sy * s_, z0 + h)) for s_, h, _ in sec])
        u = [0.0]
        for kk in range(1, len(path)):
            u.append(u[-1] + math.hypot(path[kk][0] - path[kk - 1][0], path[kk][1] - path[kk - 1][1]))

        def vg(h):
            i = int(math.floor(h / FH + 1e-6))
            return (j + i) * G + (h - i * FH)
        n = len(sec)
        for kk in range(len(path) - 1):
            for i in range(n - 1):
                key = sec[i][2]
                uv = None
                if key == "glass":
                    va, vb = vg(sec[i][1]), vg(sec[i + 1][1]) if sec[i + 1][1] > sec[i][1] else vg(sec[i][1] - 1e-4)
                    if sec[i + 1][1] < sec[i][1]:
                        va, vb = vg(sec[i][1] - 1e-4), vg(sec[i + 1][1])
                    uv = [(u[kk], va), (u[kk + 1], va), (u[kk + 1], vb), (u[kk], vb)]
                g.face([rows[kk][i], rows[kk + 1][i], rows[kk + 1][i + 1], rows[kk][i + 1]], key, uv, smooth=(key == "band"))
            # the bottom, from the last point back to the first
            g.face([rows[kk][n - 1], rows[kk + 1][n - 1], rows[kk + 1][0], rows[kk][0]], "band", None, smooth=True)
    stats["bridges"] = g.tris() - stats["podium"] - stats["towers"]
    g.build("GalaxySOHO", collection("银河SOHO主体", main), M, TILE)
    stats["tris"] = g.tris()

    # the far level: smooth domes with the bands drawn by the facade shader
    far = Geo()
    fv = lambda z: z + 0.56 * FH - 0.0  # noqa: E731
    o64 = smooth_ring(OUTER, 96)
    h64 = [smooth_ring(h, 16) for h in HOLES]
    loftv(far, [(0.0, o64), (top, o64)], "far", fv, smooth=False)
    for h in h64:
        loftv(far, [(0.0, h), (top, h)], "far", fv, inward=True, smooth=False)
    fill(far, top, [o64] + [h[::-1] for h in h64], "roof")
    pv = smooth_ring(PAVILION, 20)
    loftv(far, [(0.0, pv), (top, offset(pv, -2.4))], "far", fv, smooth=False)
    fill(far, top, [offset(pv, -2.4)], "roof")
    for name, T in TOWERS.items():
        base, eye, plates = tower_rings(name)
        nf = T["floors"]
        sub = lambda r: r[::2]  # noqa: E731
        js = list(range(PODIUM, nf, 2)) + ([nf - 1] if (nf - 1 - PODIUM) % 2 else [])
        rings = [(top, sub(plates[PODIUM]))] + [((j + 1) * FH, sub(offset(plates[j], -0.3))) for j in js]
        loftv(far, rings, "far", fv)
        annulus(far, nf * FH, sub(offset(plates[-1], -0.3)), sub(eye), "roof")
        loftv(far, [(top, sub(eye)), (nf * FH, sub(eye))], "far", fv, inward=True, smooth=False)
        fill(far, top + 0.05, [sub(eye)], "sky")
    far.build("Massing", collection("LOD1", main), M, TILE)
    stats["far"] = far.tris()

    # colliders: the podium's and the north-west building's walls as a trimesh, a hull per tower
    helpers = collection("碰撞体")
    gc = Geo()
    co = offset(smooth_ring(OUTER, 120), -0.2)
    loftv(gc, [(0.0, co), (top, co)], "x", smooth=False)
    for h in HOLES:
        hr = offset(smooth_ring(h, 24), 0.2)
        loftv(gc, [(0.0, hr), (top, hr)], "x", inward=True, smooth=False)
    pc_ = offset(smooth_ring(PAVILION, 32), -0.2)
    loftv(gc, [(0.0, pc_), (top, pc_)], "x", smooth=False)
    fill(gc, top, [co] + [offset(smooth_ring(h, 24), 0.2)[::-1] for h in HOLES], "x")
    fill(gc, top, [pc_], "x")
    cm = gc.build("walls", helpers, {"x": None})
    cm.data.materials.clear()
    bcity_landmark.rename(cm, "COLMESH")
    for name, T in TOWERS.items():
        base, eye, plates = tower_rings(name)
        pts = []
        for j in range(PODIUM, T["floors"], 2):
            pts += [(x, y, (j + 1) * FH) for x, y in offset(plates[j], -0.5)[::2]]
        pts += [(x, y, top - 1.0) for x, y in offset(plates[PODIUM], -0.5)[::2]]
        collider_pts(helpers, f"tower{name}", pts)

    # footprint: OSM's two outer rings (each its own hull); clear zones a little wider
    flat_marker(helpers, "main", offset(smooth_ring(OUTER, 96), 0.8), "FOOTPRINT")
    flat_marker(helpers, "pavilion", offset(smooth_ring(PAVILION, 32), 0.8), "FOOTPRINT")
    flat_marker(helpers, "main", offset(smooth_ring(OUTER, 96), 2.5), "CLEAR")
    flat_marker(helpers, "pavilion", offset(smooth_ring(PAVILION, 32), 2.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "galaxysoho", "银河SOHO", "Galaxy SOHO"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = 800
    s.repo_path = REPO
    return stats


if __name__ == "__main__":
    from common import REPO, args, save_and_export
    argv = args()
    OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "galaxysoho.blend")
    print("built", build())
    save_and_export(OUT, argv)
