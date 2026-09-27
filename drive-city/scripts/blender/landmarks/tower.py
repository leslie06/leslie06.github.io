# Shared pieces for the glass towers of the CBD (cwtc3.py, citic.py, cctv.py): outlines, lofted skins
# with their UVs in metres, recessed plant-floor bands, fins, canopies and the curtain-wall material.
#
# The glass itself is not modelled or painted: a material with a `facade` custom property (a JSON
# FacadeSpec, city/landmarks/kit/facade.ts) becomes the kit's curtain wall in the game, drawn in the
# shader from the UVs - u metres along the wall, v metres up - with floor slabs, mullions, per-pane
# tint, lit windows at night, diagrid, belt floors and a lit crown, and fading to its average with
# distance. Blender gives the form: the taper, corners, bands, crown, lobby and canopies.

import json
import math

from common import material
from kit import Geo  # noqa: F401  (re-exported for the tower scripts)


def facade(name, spec, **props):
    """A curtain-wall material: the game draws it with the kit's facade shader from `spec`."""
    return material(name, "#8a9aa8", 0.1, metal=0.8, props={"facade": json.dumps(spec), "wet": "surface", "glow": "none", **props})


def rrect(hw, hd, r, segs, cx=0.0, cy=0.0):
    """Rounded rectangle (segs = 1: chamfered), counter-clockwise seen from above, from the east side's south end."""
    r = min(r, hw, hd)
    out = []
    for (x, y, a0) in ((hw - r, -(hd - r), -math.pi / 2), (hw - r, hd - r, 0.0), (-(hw - r), hd - r, math.pi / 2), (-(hw - r), -(hd - r), math.pi)):
        for k in range(segs + 1):
            a = a0 + (k / segs) * (math.pi / 2)
            out.append((cx + x + math.cos(a) * r, cy + y + math.sin(a) * r))
    return out


def perim(pts):
    return sum(math.hypot(pts[(i + 1) % len(pts)][0] - pts[i][0], pts[(i + 1) % len(pts)][1] - pts[i][1]) for i in range(len(pts)))


def loft(g, rings, key, smooth=True, u_ref=None, inward=False):
    """
    A skin through closed rings [(z, [(x, y), ...]), ...] (same count each, counter-clockwise): shared
    vertices so smooth faces shade round, u = metres along the ring scaled to `u_ref` (the first
    ring's perimeter: columns taper with the tower), v = z. `inward` faces it in (a soffit, a court).
    """
    m = len(rings[0][1])
    ref = u_ref or perim(rings[0][1])
    ids = [[g.vert((x, y, z)) for (x, y) in pts] for z, pts in rings]
    us = []
    for z, pts in rings:
        k = ref / perim(pts)
        u, row = 0.0, [0.0]
        for i in range(1, m + 1):
            a, b = pts[i - 1], pts[i % m]
            u += math.hypot(b[0] - a[0], b[1] - a[1]) * k
            row.append(u)
        us.append(row)
    for j in range(len(rings) - 1):
        z0, z1 = rings[j][0], rings[j + 1][0]
        for i in range(m):
            a, b = ids[j][i], ids[j][(i + 1) % m]
            c, d = ids[j + 1][(i + 1) % m], ids[j + 1][i]
            uv = [(us[j][i], z0), (us[j][i + 1], z0), (us[j + 1][i + 1], z1), (us[j + 1][i], z1)]
            if inward:
                g.face([d, c, b, a], key, uv[::-1], smooth)
            else:
                g.face([a, b, c, d], key, uv, smooth)


def cap(g, z, pts, key, up=True):
    g.polyn([(x, y, z) for x, y in pts], key, (0, 0, 1 if up else -1))


def annulus(g, z, outer, inner, key, up=True):
    """The flat ring between two outlines of the same count at height z."""
    m = len(outer)
    for i in range(m):
        j = (i + 1) % m
        g.polyn([(*outer[i], z), (*outer[j], z), (*inner[j], z), (*inner[i], z)], key, (0, 0, 1 if up else -1))


def band(g, z0, z1, outer0, outer1, inner0, inner1, key, u_ref=None, skin="glass"):
    """A recessed band (plant floor, louvres) between two skins: returns top and bottom, the recessed face."""
    annulus(g, z0, outer0, inner0, skin, up=True)
    loft(g, [(z0, inner0), (z1, inner1)], key, u_ref=u_ref)
    annulus(g, z1, outer1, inner1, skin, up=False)


def edges(pts):
    """The ring's edges as (a, b, outward unit normal, length)."""
    out = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-6:
            continue
        out.append((a, b, ((b[1] - a[1]) / L, -(b[0] - a[0]) / L), L))
    return out


def fins(g, ring0, ring1, z0, z1, gap, depth, thick, key, min_edge=4.0):
    """
    Vertical fins standing out from a skin between two rings (the same outline at z0 and z1, which may
    differ in size): one every `gap` metres along each straight edge longer than `min_edge`.
    """
    for (a0, b0, n0, L0), (a1, b1, n1, L1) in zip(edges(ring0), edges(ring1)):
        if L0 < min_edge:
            continue
        k = max(1, int(L0 // gap))
        for s in range(1, k):
            t = s / k
            p0 = (a0[0] + (b0[0] - a0[0]) * t, a0[1] + (b0[1] - a0[1]) * t)
            p1 = (a1[0] + (b1[0] - a1[0]) * t, a1[1] + (b1[1] - a1[1]) * t)
            tx0, ty0 = (b0[0] - a0[0]) / L0 * thick / 2, (b0[1] - a0[1]) / L0 * thick / 2
            tx1, ty1 = (b1[0] - a1[0]) / L1 * thick / 2, (b1[1] - a1[1]) / L1 * thick / 2
            q = lambda p, n, tx, ty, d, z, sgn: (p[0] + n[0] * d + tx * sgn, p[1] + n[1] * d + ty * sgn, z)
            # the two sides and the outer edge (the inner edge sits on the glass)
            for sgn in (-1, 1):
                g.polyn([q(p0, n0, tx0, ty0, 0, z0, sgn), q(p0, n0, tx0, ty0, depth, z0, sgn), q(p1, n1, tx1, ty1, depth, z1, sgn), q(p1, n1, tx1, ty1, 0, z1, sgn)],
                        key, ((b0[0] - a0[0]) * sgn, (b0[1] - a0[1]) * sgn, 0))
            g.polyn([q(p0, n0, tx0, ty0, depth, z0, -1), q(p0, n0, tx0, ty0, depth, z0, 1), q(p1, n1, tx1, ty1, depth, z1, 1), q(p1, n1, tx1, ty1, depth, z1, -1)],
                    key, (n0[0], n0[1], 0))
            g.polyn([q(p1, n1, tx1, ty1, 0, z1, -1), q(p1, n1, tx1, ty1, 0, z1, 1), q(p1, n1, tx1, ty1, depth, z1, 1), q(p1, n1, tx1, ty1, depth, z1, -1)], key, (0, 0, 1))


def scale(pts, k, cx=0.0, cy=0.0):
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def slab(g, x0, x1, y0, y1, z0, z1, key, edge_key=None):
    """A thin horizontal plate (canopy, soffit): top and bottom in `key`, the edges in `edge_key`."""
    g.box(x0, x1, y0, y1, z0, z1, key, skip=("-x", "+x", "-y", "+y"))
    e = edge_key or key
    g.box(x0, x1, y0, y1, z0, z1, e, skip=("-z", "+z"))


def sign(font, body, height, m, name, coll, mat, extrude=0.04):
    """Lettering `height` m tall (glyph height, not the font's em) on the plane of matrix m (text XY, +Z out)."""
    import bpy
    from mathutils import Vector
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, 1.0, extrude
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    ys = [v.co.y for v in me.vertices]
    k = height / (max(ys) - min(ys))
    cy = (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * k, (v.co.y - cy) * k, v.co.z * k))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def ccw(pts):
    return pts if area(pts) > 0 else pts[::-1]


def inset_poly(pts, d):
    """A counter-clockwise polygon's edges moved `d` inward and re-intersected (concave corners too)."""
    n = len(pts)
    lines = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L          # left of the edge: inside for CCW
        lines.append(((a[0] + nx * d, a[1] + ny * d), (b[0] - a[0], b[1] - a[1])))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        if abs(den) < 1e-9:
            out.append(q)
            continue
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


def shift(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]
