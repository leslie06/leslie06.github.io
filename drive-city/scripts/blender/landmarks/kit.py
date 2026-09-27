# Shared building blocks for the landmark scripts in this folder: a geometry buffer that builds one
# object per call with material slots, UVs and optional vertex colours; a numpy painter for textures;
# small parts (baluster posts and panels, tiled copings); the add-on's markers (colliders, footprint,
# clear zones); rectangular walls and cornice bands. The landmark scripts share it; common.py has the
# file and material basics.

import math

import bpy  # before bmesh: the bpy module only provides bmesh once bpy is loaded
import bmesh
import numpy as np
from mathutils import Matrix, Vector

from common import image, srgb

WHITE = (1.0, 1.0, 1.0)


class Geo:
    def __init__(self, colors=False):
        self.v, self.c, self.f = [], [], []
        self.colors = colors

    def vert(self, p, col=WHITE):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.c.append(col)
        return len(self.v) - 1

    def face(self, idx, key, uvs=None, smooth=False):
        self.f.append((tuple(idx), uvs, key, smooth))

    def poly(self, pts, key, uvs=None, smooth=False, col=WHITE):
        self.face([self.vert(p, col) for p in pts], key, uvs, smooth)

    def polyn(self, pts, key, want, uvs=None, smooth=False, col=WHITE):
        """A polygon wound so its normal points along `want`."""
        pts = [Vector(p) for p in pts]
        n = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if n.dot(Vector(want)) < 0:
            pts = pts[::-1]
            uvs = uvs[::-1] if uvs else uvs
        self.poly(pts, key, uvs, smooth, col)

    def box(self, x0, x1, y0, y1, z0, z1, key, col=WHITE, skip=(), uvs=None):
        """Axis-aligned box; `skip` names faces to leave out ('-x', '+x', '-y', '+y', '-z', '+z')."""
        c = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        faces = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
        for k, f in faces.items():
            if k not in skip:
                self.poly([c[i] for i in f], key, (uvs or {}).get(k), col=col)

    def add(self, other, m):
        """Another buffer's faces, moved by matrix m."""
        base = len(self.v)
        for p, col in zip(other.v, other.c):
            self.vert(m @ Vector(p), col)
        for idx, uvs_, key, smooth in other.f:
            self.f.append((tuple(i + base for i in idx), uvs_, key, smooth))

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.f)

    def build(self, name, coll, M, tile=None):
        """One object; `M` maps keys to materials, `tile` keys to metres per UV unit for planar mapping."""
        tile = tile or {}
        keys = []
        for f in self.f:
            if f[2] not in keys:
                keys.append(f[2])
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        col = bm.verts.layers.float_color.new("Col") if self.colors else None
        bv = [bm.verts.new(p) for p in self.v]
        if col is not None:
            for v, c in zip(bv, self.c):
                v[col] = (*c, 1.0)
        for idx, uvs, key, smooth in self.f:
            if len(set(idx)) < 3:
                continue
            try:
                f = bm.faces.new([bv[i] for i in idx])
            except ValueError:      # the same face twice
                continue
            f.material_index = keys.index(key)
            f.smooth = smooth
            if uvs is None:
                f.normal_update()
                n = f.normal
                ax = max(range(3), key=lambda k: abs(n[k]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                s = tile.get(key, 2.0)
                uvs = [(bv[i].co[a] / s, bv[i].co[b] / s) for i in idx]
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for k in keys:
            me.materials.append(M[k])
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


def mesh_of(geo, name, M, tile=None):
    """A mesh datablock (for linked duplicates) from a Geo."""
    ob = geo.build(name, bpy.context.scene.collection, M, tile)
    me = ob.data
    bpy.data.objects.remove(ob)
    return me


def place(me, name, coll, m):
    o = bpy.data.objects.new(name, me)
    o.matrix_world = m
    coll.objects.link(o)
    return o


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(a):
    return Matrix.Rotation(a, 4, "Z")


class Canvas:
    def __init__(self, w, h, col="#000000"):
        self.w, self.h = w, h
        self.a = np.empty((h, w, 3), np.float32)
        self.a[:] = srgb(col)
        self.y, self.x = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5

    def c(self, col):
        return srgb(col) if isinstance(col, str) else np.asarray(col, np.float32)

    def put(self, mask, col):
        self.a[mask] = self.c(col)

    def rect(self, x0, y0, x1, y1, col):
        self.a[max(0, int(y0)):max(0, int(y1)), max(0, int(x0)):max(0, int(x1))] = self.c(col)

    def frame(self, x0, y0, x1, y1, t, col):
        self.rect(x0, y0, x1, y0 + t, col)
        self.rect(x0, y1 - t, x1, y1, col)
        self.rect(x0, y0, x0 + t, y1, col)
        self.rect(x1 - t, y0, x1, y1, col)

    def ellipse(self, cx, cy, rx, ry, col):
        self.put(((self.x - cx) / rx) ** 2 + ((self.y - cy) / ry) ** 2 <= 1, col)

    def ring(self, cx, cy, r0, r1, col):
        d = np.hypot(self.x - cx, self.y - cy)
        self.put((d >= r0) & (d <= r1), col)

    def poly_mask(self, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1 = max(0, int(min(xs))), min(self.w, int(max(xs)) + 2)
        y0, y1 = max(0, int(min(ys))), min(self.h, int(max(ys)) + 2)
        m = np.zeros((self.h, self.w), bool)
        if x1 <= x0 or y1 <= y0:
            return m
        X, Y = self.x[y0:y1, x0:x1], self.y[y0:y1, x0:x1]
        inside = np.zeros(X.shape, bool)
        n = len(pts)
        for i in range(n):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
            if ay == by:
                continue
            cross = (ay > Y) != (by > Y)
            xint = (bx - ax) * (Y - ay) / (by - ay) + ax
            inside ^= cross & (X < xint)
        m[y0:y1, x0:x1] = inside
        return m

    def poly(self, pts, col):
        self.put(self.poly_mask(pts), col)

    def line(self, x0, y0, x1, y1, w, col):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1.0
        t = np.clip(((self.x - x0) * dx + (self.y - y0) * dy) / L2, 0, 1)
        d = np.hypot(self.x - (x0 + t * dx), self.y - (y0 + t * dy))
        self.put(d <= w / 2, col)

    def star(self, cx, cy, r, col, rot=0.0):
        pts = []
        for i in range(10):
            a = -math.pi / 2 + rot + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.382
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.poly(pts, col)

    def noise(self, amt, seed, scale=1.0):
        rng = np.random.default_rng(seed)
        self.a *= (1 - amt / 2 + amt * rng.random((self.h, self.w, 1), np.float32)) ** scale


QUAD = ((0, 0), (1, 0), (1, 1), (0, 1))


def paving(size=512):
    """Grey stone flags with dark joints (4 m per repeat, a flag every metre, courses offset)."""
    cv = Canvas(size, size, "#a29e94")
    cv.noise(0.1, 21)
    q = size // 4
    rows = (cv.y // q).astype(int)
    joint = (np.mod(cv.y, q) < 2.5) | (np.mod(cv.x + (rows % 2) * q / 2, q) < 2.5)
    cv.put(joint, "#6f6b63")
    rng = np.random.default_rng(22)
    tint = rng.uniform(0.94, 1.05, (5, 9))
    cv.a *= tint[rows, (np.mod(cv.x + (rows % 2) * q / 2, size) // q).astype(int)][..., None]
    return image("TAM_Paving", np.flipud(cv.a).copy())


def cyl(g, x, y, z0, z1, r0, r1, segs, key, smooth=True, caps=(False, True), col=WHITE):
    ring0 = [Vector((x + r0 * math.cos(2 * math.pi * i / segs), y + r0 * math.sin(2 * math.pi * i / segs), z0)) for i in range(segs)]
    ring1 = [Vector((x + r1 * math.cos(2 * math.pi * i / segs), y + r1 * math.sin(2 * math.pi * i / segs), z1)) for i in range(segs)]
    a = [g.vert(p, col) for p in ring0]
    b = [g.vert(p, col) for p in ring1]
    for i in range(segs):
        k = (i + 1) % segs
        g.face((a[i], a[k], b[k], b[i]), key, smooth=smooth)
    if caps[0]:
        g.poly(ring0[::-1], key, col=col)
    if caps[1]:
        g.poly(ring1, key, col=col)


def lathe(g, prof, segs, key, x=0.0, y=0.0, col=WHITE, smooth=True):
    """Surface of revolution from (r, z) pairs, bottom to top."""
    rings = [[g.vert((x + r * math.cos(2 * math.pi * i / segs), y + r * math.sin(2 * math.pi * i / segs), z), col) for i in range(segs)] for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            k = (i + 1) % segs
            g.face((a[i], a[k], b[k], b[i]), key, smooth=smooth)


def ell(g, c, r, key, col=WHITE, nu=10, nv=6, m=None):
    """Ellipsoid at c with radii r (optionally through matrix m)."""
    def P(u, v):
        th, ph = 2 * math.pi * u, math.pi * v
        p = Vector((c[0] + r[0] * math.sin(ph) * math.cos(th), c[1] + r[1] * math.sin(ph) * math.sin(th), c[2] - r[2] * math.cos(ph)))
        return m @ p if m is not None else p
    bot, top = g.vert(P(0, 0), col), g.vert(P(0, 1), col)
    rings = [[g.vert(P(i / nu, j / nv), col) for i in range(nu)] for j in range(1, nv)]
    for i in range(nu):
        k = (i + 1) % nu
        g.face((bot, rings[0][k], rings[0][i]), key, smooth=True)
        g.face((top, rings[-1][i], rings[-1][k]), key, smooth=True)
        for j in range(nv - 2):
            g.face((rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]), key, smooth=True)


def post_geo():
    """A marble baluster post (望柱) with its round cap, 1.3 m."""
    g = Geo()
    g.box(-0.12, 0.12, -0.12, 0.12, 0.0, 1.0, "marble")
    lathe(g, [(0.14, 1.0), (0.1, 1.08), (0.14, 1.17), (0.06, 1.3), (0.0, 1.32)], 6, "marble")
    return g


def panel_geo():
    """A balustrade panel (栏板) one metre long along +X (scaled to fit), with its hand rail."""
    g = Geo()
    g.box(0.0, 1.0, -0.07, 0.07, 0.0, 0.1, "marble")
    g.box(0.0, 1.0, -0.05, 0.05, 0.1, 0.62, "marble")
    g.box(0.0, 1.0, -0.09, 0.09, 0.62, 0.72, "marble")
    g.box(0.0, 1.0, -0.06, 0.06, 0.72, 0.86, "marble")
    return g


def balustrade(coll, meshes, pts, tag, gap=1.9, skip=()):
    """Posts and panels along a polyline of ground points; `skip` boxes (x0, x1, y0, y1) leave openings."""
    posts, n = {}, 0
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
            pitch = math.atan2(d.z, math.hypot(d.x, d.y))
            for p in (p0, p1):
                posts.setdefault((round(p.x, 2), round(p.y, 2)), (p, yaw))
            m = T(*(p0 + d.normalized() * 0.12)) @ Rz(yaw) @ Matrix.Rotation(-pitch, 4, "Y") @ Matrix.Diagonal((d.length - 0.24, 1, 1, 1))
            place(meshes["panel"], f"{tag}.panel{n}", coll, m)
            n += 1
    for i, (p, yaw) in enumerate(posts.values()):
        place(meshes["post"], f"{tag}.post{i}", coll, T(*p) @ Rz(yaw))
    return n


def coping(g, a, b, wd, z, rise=0.35, key="tile"):
    """A little tiled gable roof along a wall top from a to b (plan points)."""
    a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x, 0)) * (wd / 2)
    ext = d * (wd / 2 - 0.15)
    a, b = a - ext, b + ext
    up = Vector((0, 0, rise))
    g.poly([a - n, b - n, b + up, a + up], key)
    g.poly([b + n, a + n, a + up, b + up], key)
    g.poly([a + n, a - n, a + up], key)
    g.poly([b - n, b + n, b + up], key)
    g.poly([a - n + Vector((0, 0, -0.12)), b - n + Vector((0, 0, -0.12)), b - n, a - n], key)
    g.poly([b + n + Vector((0, 0, -0.12)), a + n + Vector((0, 0, -0.12)), a + n, b + n], key)


def collider_box(coll, name, x0, x1, y0, y1, z0, z1, role="COL"):
    import bcity_landmark
    g = Geo()
    g.box(x0, x1, y0, y1, z0, z1, "x")
    o = g.build(name, coll, {"x": None})
    o.data.materials.clear()
    bcity_landmark.rename(o, role)
    return o


def collider_pts(coll, name, pts, role="COL"):
    """A hull collider from points (the game takes their convex hull)."""
    import bcity_landmark
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, role)
    return o


def flat_marker(coll, name, poly, role):
    import bcity_landmark
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x, y, 0.0) for x, y in poly], [], [tuple(range(len(poly)))])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, role)
    return o


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# --- rectangular blocks: walls with UVs in bays and storeys, cornice bands mitred round the corners ---

SIDES = {"w": (-1, 0), "e": (1, 0), "s": (0, -1), "n": (0, 1)}


def side_line(x0, x1, y0, y1, side, off=0.0):
    """The two ends of a side of the rectangle (counter-clockwise), pushed out by `off`."""
    if side == "s":
        return Vector((x0 - off, y0 - off)), Vector((x1 + off, y0 - off))
    if side == "e":
        return Vector((x1 + off, y0 - off)), Vector((x1 + off, y1 + off))
    if side == "n":
        return Vector((x1 + off, y1 + off)), Vector((x0 - off, y1 + off))
    return Vector((x0 - off, y1 + off)), Vector((x0 - off, y0 - off))


def fwall(g, a, b, z0, z1, key, out, bay=5.5, storey=5.5, zref=1.2):
    """A wall face from plan point a to b, UVs in bays and storeys from the plinth."""
    L = (b - a).length
    n = max(1, round(L / bay))
    g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, (out[0], out[1], 0),
            uvs=[(0, (z0 - zref) / storey), (n, (z0 - zref) / storey), (n, (z1 - zref) / storey), (0, (z1 - zref) / storey)])


def band(g, x0, x1, y0, y1, side, off_a, z_a, off_b, z_b, key, faces):
    """One side of a ring band from offset off_a at z_a to off_b at z_b, mitred where the next side is there too."""
    order = ["s", "e", "n", "w"]
    i = order.index(side)
    prev_on, next_on = order[i - 1] in faces, order[(i + 1) % 4] in faces
    a0, b0 = side_line(x0, x1, y0, y1, side, off_a)
    a1, b1 = side_line(x0, x1, y0, y1, side, off_b)
    d = (b0 - a0).normalized()
    # a side with no neighbour stops at the rectangle's own corner instead of the mitre
    if not prev_on:
        a0 = a0 + d * off_a
        a1 = a1 + d * off_b
    if not next_on:
        b0 = b0 - d * off_a
        b1 = b1 - d * off_b
    ox, oy = SIDES[side]
    want = (ox, oy, 0) if abs(z_b - z_a) > 1e-6 and abs(off_a - off_b) < 1e-6 else ((ox, oy, 1) if off_b < off_a else (0, 0, -1 if z_b <= z_a else 1))
    L = (b0 - a0).length
    g.polyn([(a0.x, a0.y, z_a), (b0.x, b0.y, z_a), (b1.x, b1.y, z_b), (a1.x, a1.y, z_b)], key, want,
            uvs=[(0, 0), (L / 0.8, 0), (L / 0.8, 1), (0, 1)])


def tile_image(name, size=128):
    """Glazed cornice tiles: ridges down the slope, one row every 0.8 m along the eave."""
    v, u = np.mgrid[0:size, 0:size] / size
    ridge = 0.78 + 0.22 * np.cos(2 * np.pi * u) ** 2
    course = 1 - 0.12 * (((v * 6) % 1) < 0.08)
    return image(name, srgb("#dca72b") * (ridge * course)[..., None])
