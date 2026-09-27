# Round halls and round marble terraces for the Temple of Heaven (qiniandian.py, huangqiongyu.py), next to
# hall.py's rectangular ones and sharing its atlas, brackets, columns and beasts.
#
#   round_roof      a conical glazed roof: concave (flat at the eave, steep near the top), the eave swept up,
#                   tile rows as geometry running down the slope (their count fixed at the eave, so they close
#                   up towards the top as on the real roofs), the scalloped eave edge and the rafters under it
#   round_storey    a ring of lattice doors or windows between columns, the painted beams over them
#   round_tiers     white marble drums, one on another, with a moulded lip, paving on top
#   round_flights   flights of steps on the four axes from each tier down to the one below (the carved
#                   御路 slab in the middle of the wide ones); returns their plans for the WALK_ ramps
# Blender frame: +X east, +Y north; angle 0 east, counter-clockwise.

import math

from mathutils import Vector

from hall import tile_wave, smooth01, uvs
from kit import QUAD, cyl


def roof_r(R, v):
    """Radius and height of the roof at distance v up the slope from the eave (v = 0 .. R['r0'] - R['r1'])."""
    top = R["r0"] - R["r1"]
    z = R["z"] + R["H"] * (max(0.0, v) / top) ** R["p"]
    z += R["lift"] * max(0.0, 1 - v / R["Vl"]) ** 2
    return R["r0"] - v, z


def round_roof(g, R, rows=10, key="tile", pitch=0.46, amp=0.1, trim=0.0, waves=True, spp=4, segs=None):
    """The roof between the eave (radius r0 at height z) and r1 (0: a point). Returns the top ring's height."""
    top = R["r0"] - R["r1"]
    N = segs or max(12, round(2 * math.pi * R["r0"] / pitch))
    M = N * (spp if waves else 1)
    vs = [top * (j / rows) ** 1.1 for j in range(rows + 1)]
    if 0 < trim < top:
        vs = sorted(set(vs) | {trim})
    if R["r1"] <= 1e-6:
        vs[-1] = top * 0.995            # stop just short of the apex: the finial covers it
    prev = None
    pv = 0.0
    for v in vs:
        r, z = roof_r(R, v)
        r2, z2 = roof_r(R, v + 0.05)
        slope = Vector((r2 - r, z2 - z)).normalized()          # (dr, dz) down to up the slope
        nrm = Vector((-slope.y, slope.x)) if slope.y > 0 else Vector((slope.y, -slope.x))
        if nrm.y < 0:
            nrm = -nrm                                           # (outward, up)
        fade = smooth01((top - v) / 0.8)
        ring = []
        for i in range(M):
            a = 2 * math.pi * i / M
            d = amp * tile_wave(a * R["r0"], 2 * math.pi * R["r0"] / N) * fade if waves else 0.0
            rr, zz = r + nrm.x * d, z + nrm.y * d
            ring.append(g.vert((rr * math.cos(a), rr * math.sin(a), zz)))
        if prev is not None:
            fk = "trim" if trim and pv < trim - 1e-6 else key
            for i in range(M):
                j = (i + 1) % M
                g.face((prev[i], prev[j], ring[j], ring[i]), fk, smooth=True)
        prev, pv = ring, v
    return roof_r(R, vs[-1])[1]


def round_eave(g, R, rw, zb, key="tile", drop=0.3, segs=48):
    """The eave's edge carried down, and the rafters (atlas) under it back to the wall at radius rw, height zb."""
    r0, z0 = roof_r(R, 0.0)
    for i in range(segs):
        a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
        p = lambda a, r, z: (r * math.cos(a), r * math.sin(a), z)          # noqa: E731
        g.polyn([p(a0, r0, z0), p(a1, r0, z0), p(a1, r0, z0 - drop), p(a0, r0, z0 - drop)], key, (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0))
        g.polyn([p(a0, r0 - 0.05, z0 - drop), p(a1, r0 - 0.05, z0 - drop), p(a1, rw, zb), p(a0, rw, zb)], "atlas", (0, 0, -1),
                uvs=uvs("rafters", ((0, 0), (1, 0), (1, 1), (0, 1))))


def round_storey(g, r, n, z0, z1, beam, fill, doors=None, off=0.0):
    """
    A ring of n bays between columns at radius r (columns at angles off + k 2pi/n): each bay a lattice panel
    (atlas `fill`, or `doors` for the bays whose index is in it), then the painted beam band (beam: (z of
    额枋 bottom, 平板枋 bottom, bracket foot)) round the outside and inside.
    """
    for k in range(n):
        a0, a1 = off + 2 * math.pi * k / n, off + 2 * math.pi * (k + 1) / n
        P = lambda a, rr, z: (rr * math.cos(a), rr * math.sin(a), z)       # noqa: E731
        mid = (a0 + a1) / 2
        reg = "door" if doors and k in doors else fill
        g.polyn([P(a0, r, z0), P(a1, r, z0), P(a1, r, z1), P(a0, r, z1)], "atlas", (math.cos(mid), math.sin(mid), 0), uvs=uvs(reg, QUAD))
        for rr, sgn in ((r + 0.28, 1), (r - 0.28, -1)):
            g.polyn([P(a0, rr, beam[0]), P(a1, rr, beam[0]), P(a1, rr, beam[1]), P(a0, rr, beam[1])], "atlas", (sgn * math.cos(mid), sgn * math.sin(mid), 0), uvs=uvs("beam", QUAD))
            g.polyn([P(a0, rr, beam[1]), P(a1, rr, beam[1]), P(a1, rr, beam[2]), P(a0, rr, beam[2])], "atlas", (sgn * math.cos(mid), sgn * math.sin(mid), 0), uvs=uvs("plank", QUAD))
        g.polyn([P(a0, r + 0.28, beam[0]), P(a1, r + 0.28, beam[0]), P(a1, r - 0.28, beam[0]), P(a0, r - 0.28, beam[0])], "atlas", (0, 0, -1), uvs=uvs("plank", QUAD))


def round_tiers(g, tiers, segs=96, key="marble", top_key="paving"):
    """tiers: [(radius, z0, z1), ...] bottom up. Each a drum with a lip at its top, paved to its edge."""
    for r, z0, z1 in tiers:
        cyl(g, 0, 0, z0, z1 - 0.25, r, r, segs, key, smooth=True, caps=(False, False))
        cyl(g, 0, 0, z1 - 0.25, z1, r + 0.12, r + 0.12, segs, key, smooth=True, caps=(False, False))
        g.polyn([((r + 0.12) * math.cos(2 * math.pi * i / segs), (r + 0.12) * math.sin(2 * math.pi * i / segs), z1 - 0.25) for i in range(segs)], key, (0, 0, -1))
        g.polyn([((r + 0.12) * math.cos(2 * math.pi * i / segs), (r + 0.12) * math.sin(2 * math.pi * i / segs), z1) for i in range(segs)], top_key, (0, 0, 1))


AXES = {"E": 0.0, "N": math.pi / 2, "W": math.pi, "S": 3 * math.pi / 2}


def round_flights(g, tiers, sides, rise=0.15, run=0.34, key="marble"):
    """
    Steps on the axes from each tier's top down to the level below: sides {axis: (width, 御路 width or 0)}.
    Returns [(axis, width, r_top, r_foot, z_top, z_foot), ...] for the walk-only ramps.
    """
    out = []
    for r, z0, z1 in tiers:
        n = max(3, round((z1 - z0) / rise))
        L = run * n
        for side, (w, yulu) in sides.items():
            a = AXES[side]
            c, s = math.cos(a), math.sin(a)
            # in the flight's own frame: x across, y outward from the tier's edge (chord at the centre line)
            edge = math.sqrt(max(0.0, r * r - (w / 2) ** 2))

            def W(x, y, z):
                return (c * (edge + y) - s * x, s * (edge + y) + c * x, z)
            for k in range(n):
                y0, y1 = run * (n - k - 1), run * (n - k)
                z = z0 + (z1 - z0) * (k + 1) / n
                xs = [(-w / 2, -yulu / 2), (yulu / 2, w / 2)] if yulu else [(-w / 2, w / 2)]
                for xa, xb in xs:
                    pts = [W(xa, y0, z), W(xb, y0, z), W(xb, y1, z), W(xa, y1, z)]
                    g.polyn(pts, key, (0, 0, 1))
                    g.polyn([W(xa, y1, z), W(xb, y1, z), W(xb, y1, z0 if k == 0 else z0 + (z1 - z0) * k / n), W(xa, y1, z0 if k == 0 else z0 + (z1 - z0) * k / n)], key, (c, s, 0))
            # the side walls (垂带) and, on the wide flights, the carved slab down the middle
            for sx in (-1, 1):
                xa, xb = sorted((sx * w / 2, sx * (w / 2 + 0.5)))
                # the stringer's two sides: local -x is world (s, -c), local +x is (-s, c)
                g.polyn([W(xa, 0, z1 + 0.1), W(xa, L, z0 + 0.1), W(xa, L, z0), W(xa, 0, z0)], key, (s, -c, 0))
                g.polyn([W(xb, 0, z1 + 0.1), W(xb, L, z0 + 0.1), W(xb, L, z0), W(xb, 0, z0)], key, (-s, c, 0))
                g.polyn([W(xa, 0, z1 + 0.1), W(xb, 0, z1 + 0.1), W(xb, L, z0 + 0.1), W(xa, L, z0 + 0.1)], key, (c * 0.3, s * 0.3, 1))
                g.polyn([W(xa, L, z0 + 0.1), W(xb, L, z0 + 0.1), W(xb, L, z0), W(xa, L, z0)], key, (c, s, 0))
            if yulu:
                g.polyn([W(-yulu / 2, 0, z1 + 0.02), W(yulu / 2, 0, z1 + 0.02), W(yulu / 2, L, z0 + 0.02), W(-yulu / 2, L, z0 + 0.02)], "relief", (c * 0.3, s * 0.3, 1),
                        uvs=[(0, 1), (1, 1), (1, 0), (0, 0)])
            out.append((side, w + 1.0, edge, edge + L, z1, z0, (c, s)))
    return out


def ring_pts(r, z, segs=96):
    """Points round a circle at height z (closed), for balustrades."""
    return [(r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z) for i in range(segs + 1)]


def finial(g, z, h, r=0.6, key="gold"):
    """A gilt finial (宝顶): a seat, a round body, a slender tip."""
    cyl(g, 0, 0, z - 0.3, z + 0.2, r * 1.5, r * 1.2, 16, key, caps=(False, True))
    cyl(g, 0, 0, z + 0.2, z + 0.5, r * 0.8, r * 0.8, 16, key, caps=(False, True))
    from kit import ell
    ell(g, (0, 0, z + 0.5 + h * 0.3), (r, r, h * 0.3), key, nu=16, nv=8)
    cyl(g, 0, 0, z + 0.5 + h * 0.55, z + 0.5 + h * 0.75, r * 0.45, r * 0.3, 12, key, caps=(False, True))
    ell(g, (0, 0, z + 0.5 + h * 0.85), (r * 0.45, r * 0.45, h * 0.12), key, nu=12, nv=6)
    cyl(g, 0, 0, z + 0.5 + h * 0.95, z + h + 0.5, r * 0.12, 0.02, 8, key, caps=(False, True))
