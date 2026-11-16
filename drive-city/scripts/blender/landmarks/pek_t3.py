# 北京首都国际机场 3 号航站楼 Beijing Capital International Airport Terminal 3 (Foster + Partners / NACO / Arup, 2008),
# built in Blender and marked with the bcity_landmark add-on's conventions. Three landmarks from one script:
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/pek_t3.py -- --part t3c [--out art/landmarks/t3c.blend] [--export]
#   (--part t3d, --part t3e the same; t3d and t3e are `partOf` t3c: one place on the map)
#
# OSM relation 8476282 (首都机场3号航站楼) has three outer rings: way 31030099 = T3C, the main building at the south (a
# Y: two arms sweeping south-west and south-east round the landside forecourt and two parallel piers running north
# with a 25-30 m slot between them); way 172559041 = T3D, the linear building in the middle; way 31030197 = T3E,
# the international building at the north (the same Y turned round: two piers from the south, the arms spreading
# north-west and north-east). The outlines below are those rings in game metres (+X east, +Z south).
#
# What is known (zh.wikipedia 北京首都国际机场3号航站楼, Foster's / Arup's project pages, archello): one continuous
# aerodynamic roof, a steel space frame on a few concrete mega-columns at 36 m centres, eaves cantilevered up to
# 40 m over the landside drop-off, 155 triangular skylights facing south-east (dragon scales), the outer steel
# columns painted 帝王红, the ceiling running through 16 tones from red to yellow; the roof's outside a warm metal
# (zh.wikipedia: 与故宫琉璃瓦相同的黄色; OSM roof:colour #c56f3e). T3C has five storeys over ground, T3D and T3E three.
# Heights are not published as such: T3C's roof is taken at 45 m over the check-in hall (the brief's figure; OSM's
# blocks were 38 m), the piers about 24 m, T3D 21 m, T3E's hall 37 m.
#
# Here: each building's plan is its OSM ring; the roof is a smooth height field over the ring pushed out 3.5 m
# (a pillow rising from the eaves to the middle of each pier, a long swell over T3C's check-in hall peaking 45 m
# about 70 m behind the glass and falling to the piers, a gentle wave along the axis), with a 2.5 m silver fascia
# round it, warm metal panels shading from copper-red over the halls to gold at the pier ends, and rows of
# triangular south-east-facing skylights (linked duplicates: instanced). The walls under it are the kit's
# curtain-wall shader, gate doors on the airside at jet-bridge height (the bridges come later). T3C's landside: OSM
# drew the canopy over the drop-off lanes into the ring, so the glass is pushed back to keep 8.5 m from every
# road's centre line (ground and the 6.5 m departure deck), the canopy (red-to-gold slatted soffit) reaching out
# over the lanes; a 6.5 m pavement between the inner departure lane and the glass (people walk from the car to
# the doors), an entrance every 36 m (lit sliding doors under a steel canopy, on the deck and on the ground), red raking columns from the ground at the glass up to the
# canopy, 北京首都国际机场 on the fascia over the middle. Nothing solid stands on a road.
# Doubtful: the exact roof profile and heights; the outside colour (photographs from the air read copper-gold,
# from the curb the fascia reads silver); the sign's place; T3D and T3E only roughly.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_pts, flat_marker, mesh_of, place  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.geometry import delaunay_2d_cdt  # noqa: E402

argv = args()
PART = argv[argv.index("--part") + 1] if "--part" in argv else "t3c"
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", f"{PART}.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

# --- OSM (relation 8476282's outer rings, game x, z) ----------------------------------------------------------

OSM_T3C = [(17980.0, -16395.0), (17981.4, -16412.6), (17982.0, -16430.2), (17982.0, -16454.0), (17980.3, -16477.9), (17975.8, -16516.9), (17963.6, -16614.2), (17953.9, -16697.4), (17942.8, -16793.5), (17929.0, -16904.0), (17923.4, -16954.7), (17923.7, -16957.0), (17925.5, -16958.0), (17952.8, -16947.2), (17970.3, -16940.7), (17972.7, -16939.0), (17973.5, -16937.3), (17974.0, -16934.5), (18025.4, -16516.1), (18050.3, -16520.2), (18004.3, -16946.5), (18046.8, -16982.7), (18053.2, -16929.7), (18064.8, -16833.5), (18077.9, -16724.4), (18088.0, -16640.1), (18099.5, -16544.7), (18104.0, -16507.1), (18110.7, -16469.3), (18115.2, -16449.6), (18118.8, -16433.7), (18129.7, -16401.6), (18140.3, -16376.5), (18147.5, -16363.1), (18162.1, -16335.7), (18185.8, -16300.5), (18192.0, -16293.3), (18218.4, -16262.4), (18245.2, -16236.6), (18270.8, -16213.6), (18298.1, -16194.6), (18327.1, -16176.7), (18354.5, -16162.2), (18390.1, -16144.4), (18455.1, -16115.1), (18478.3, -16104.7), (18480.8, -16102.8), (18481.9, -16101.3), (18482.6, -16099.2), (18485.2, -16076.9), (18488.2, -16050.4), (18486.8, -16049.5), (18485.0, -16049.9), (18447.7, -16062.8), (18414.1, -16073.9), (18382.2, -16082.7), (18352.6, -16089.5), (18316.0, -16096.3), (18266.7, -16103.1), (18241.8, -16105.6), (18218.3, -16106.5), (18157.2, -16108.1), (18101.6, -16106.1), (18044.8, -16098.0), (18019.2, -16092.9), (17991.4, -16086.6), (17928.2, -16068.8), (17853.1, -16040.2), (17798.3, -16007.2), (17781.3, -15997.5), (17761.9, -15985.5), (17731.8, -15966.3), (17719.2, -15957.0), (17713.8, -15954.1), (17712.2, -15955.4), (17706.2, -16004.3), (17706.1, -16008.1), (17707.7, -16010.9), (17710.3, -16013.1), (17720.3, -16021.0), (17774.6, -16062.9), (17817.7, -16097.3), (17829.9, -16108.0), (17838.0, -16115.3), (17865.3, -16143.7), (17879.5, -16161.3), (17892.2, -16178.9), (17905.3, -16198.1), (17921.0, -16223.3), (17938.0, -16255.1), (17947.2, -16274.8), (17955.6, -16294.4), (17961.7, -16311.8), (17967.2, -16330.1), (17974.1, -16359.5), (17977.8, -16379.0)]
OSM_T3D = [(17888.3, -17639.6), (17887.6, -17642.0), (17886.5, -17643.5), (17884.0, -17645.1), (17867.5, -17651.5), (17841.3, -17661.7), (17838.7, -17661.9), (17838.2, -17659.5), (17846.6, -17594.8), (17857.5, -17511.2), (17868.7, -17416.0), (17878.5, -17332.4), (17887.4, -17256.9), (17888.8, -17255.0), (17891.2, -17255.2), (17930.9, -17286.2), (17920.2, -17374.9), (17917.4, -17398.0), (17944.3, -17401.2), (17947.2, -17377.9), (17957.1, -17296.7), (17957.8, -17290.9), (17959.9, -17288.2), (17980.6, -17279.2), (18005.8, -17268.4), (18008.2, -17267.4), (18009.8, -17268.4), (18000.3, -17347.0), (17986.9, -17457.3), (17978.6, -17526.0), (17968.5, -17609.2), (17960.3, -17677.5), (17919.7, -17650.0), (17916.7, -17647.4), (17915.7, -17644.5), (17915.6, -17641.7), (17926.7, -17545.7), (17929.2, -17524.9), (17902.5, -17521.6), (17900.6, -17542.4)]
OSM_T3E = [(17924.6, -17973.9), (17923.3, -17971.4), (17921.1, -17971.6), (17896.4, -17983.1), (17875.2, -17993.0), (17831.7, -18409.5), (17802.8, -18406.2), (17846.5, -17991.6), (17806.9, -17957.6), (17804.4, -17957.4), (17803.1, -17959.7), (17799.3, -17994.5), (17794.9, -18034.6), (17789.8, -18076.2), (17779.8, -18158.2), (17772.9, -18214.4), (17764.5, -18283.0), (17754.1, -18380.2), (17742.0, -18460.3), (17741.6, -18462.2), (17735.7, -18488.2), (17721.9, -18529.7), (17708.0, -18562.6), (17694.1, -18589.5), (17679.4, -18614.2), (17657.4, -18643.9), (17654.3, -18648.1), (17636.0, -18669.1), (17614.0, -18690.5), (17591.2, -18711.3), (17575.8, -18723.1), (17541.0, -18746.2), (17491.5, -18770.8), (17486.0, -18773.1), (17409.7, -18805.6), (17373.8, -18820.9), (17367.2, -18824.5), (17365.0, -18829.0), (17359.1, -18878.0), (17358.7, -18880.9), (17358.4, -18883.6), (17363.2, -18882.0), (17397.0, -18867.6), (17460.6, -18840.6), (17525.0, -18813.2), (17589.2, -18786.0), (17652.5, -18759.1), (17682.9, -18747.2), (17713.2, -18738.2), (17740.5, -18735.8), (17764.9, -18736.5), (17789.8, -18739.8), (17812.5, -18746.2), (17845.9, -18761.7), (17935.3, -18824.3), (17938.5, -18826.6), (17993.0, -18867.6), (18049.5, -18910.0), (18103.9, -18950.9), (18137.3, -18975.9), (18144.3, -18923.4), (18143.8, -18918.8), (18140.2, -18915.2), (18051.8, -18848.5), (18018.0, -18821.9), (17989.4, -18795.9), (17986.8, -18793.7), (17965.1, -18770.2), (17940.8, -18735.7), (17916.4, -18696.0), (17896.6, -18655.7), (17881.0, -18613.7), (17872.9, -18576.2), (17866.4, -18534.4), (17865.7, -18517.7), (17865.0, -18501.0), (17865.0, -18480.0), (17866.7, -18459.1), (17872.1, -18408.7), (17884.3, -18311.8), (17894.1, -18229.4), (17905.6, -18132.5), (17918.7, -18023.2)]

# The landside lanes in front of T3C (public/city/network.json edge: (height, width, centre line)). 87005 and 86802
# are the inner departure lane on the 6.5 m deck; the rest run on the ground under and beside it.
ROADS = {
    87005: (6.5, 6, [(18215.5, -16118.8), (18191.8, -16120.3), (18164.4, -16120.6), (18135.4, -16119.6), (18107, -16117.4), (18080.3, -16113.8), (18053.1, -16109.1), (18001.8, -16098.4), (17955.1, -16082.5), (17911.2, -16059.3), (17874.7, -16030.5), (17865, -16023.6), (17853.2, -16014.9), (17844.9, -16008.7), (17835.6, -16001.5), (17829, -15996.1), (17823.1, -15990.8), (17819.4, -15987.1), (17816.1, -15981.9), (17813.8, -15977.4), (17811.2, -15972.6), (17807.2, -15967.1)]),
    86802: (6.5, 6, [(18421, -16026.9), (18414.7, -16032.3), (18411.2, -16035.4), (18407.1, -16039), (18403.1, -16042.7), (18396.5, -16048.8), (18392.9, -16051.5), (18388.8, -16054.4), (18375.7, -16064), (18356.3, -16075.1), (18335.5, -16084.8), (18279.4, -16107.9), (18251.3, -16114.3), (18215.5, -16118.8)]),
    87004: (6.5, 6, [(18390.1, -16044), (18350.1, -16064.8), (18312.8, -16078.5), (18279.3, -16087.6), (18242.1, -16094.4), (18203.4, -16099.9), (18162.2, -16101.8), (18117.9, -16100.3), (18069.5, -16094), (18029.3, -16085), (17994.6, -16074.5), (17962.8, -16063.1), (17932, -16049.5), (17906.8, -16036.3), (17884.6, -16022.2), (17869.1, -16009.9)]),
    87010: (0, 6, [(18227.7, -16123.6), (18207, -16125.8), (18187.5, -16126.6), (18171.8, -16127), (18160.6, -16127), (18140.9, -16126.6), (18121.5, -16125.5), (18102, -16123.7), (18082.2, -16121), (18055.5, -16116.3)]),
    87008: (0, 6, [(18055.5, -16116.3), (18029.6, -16110.9), (18020.5, -16108.7), (18011.5, -16106.2), (18000.5, -16103.6), (17983.9, -16098.9), (17971, -16094.2), (17955.3, -16088.8), (17940, -16082.5), (17903.3, -16067.5), (17850.3, -16032.2)]),
    87683: (0, 6, [(17850.3, -16032.2), (17829, -16017), (17814, -16006), (17797, -15989), (17779, -15968), (17765, -15945), (17755, -15917)]),
    88098: (0, 6, [(18244.7, -16121), (18227.7, -16123.6)]),
    87948: (0, 6, [(18266.2, -16117.5), (18248.1, -16120.4), (18244.7, -16121)]),
    87685: (0, 6, [(18328.9, -16101.6), (18303, -16110.1), (18288.1, -16113.6), (18266.2, -16117.5)]),
    86803: (0, 6, [(18394.5, -16025.1), (18365.6, -16061.1), (18331.4, -16078.7), (18297.7, -16089.3), (18265.3, -16096.9), (18245.2, -16099.5), (18209.7, -16104.2), (18175, -16106.2), (18141.6, -16106.7), (18099.8, -16103.9), (18060.6, -16097.8), (18025.8, -16089), (17984.3, -16076), (17952.6, -16065.2), (17917.3, -16048.4), (17883.6, -16016.3), (17869.3, -15997.5)]),
    86804: (0, 6, [(18420.7, -15992.3), (18400, -16025.8), (18386.3, -16045.7), (18364.3, -16074), (18356.7, -16081.8), (18345.3, -16091.5), (18328.9, -16101.6)]),
}
CLEARANCE = 8.5          # the glass keeps this far from every lane's centre line (3 m half lane + 5.5 m pavement)
DECK_Z = 6.5             # the departure lanes' deck
DECK_ROADS = (86802, 87005)   # the inner departure lane, east to west: the pavement runs from it to the glass

# Per building: anchor (game x, z), the roof's shape and the far distance.
PARTS = {
    "t3c": dict(osm=OSM_T3C, g=(18080.0, -16300.0), zh="首都机场3号航站楼", en="Beijing Capital Airport Terminal 3",
                eave=16.5, rise=7.5, rw=26.0,
                hub=(-15.0, -55.0), knots=[(-160, 31.0), (-110, 34.5), (-40, 43.5), (15, 45.0), (95, 40.0), (175, 31.0), (250, 24.0), (400, 24.0)],
                hw=(150.0, 330.0), wave=1.2, far=1500, landside=True),
    "t3d": dict(osm=OSM_T3D, g=(17924.0, -17466.0), zh="首都机场3号航站楼D区", en="Beijing Capital Airport Terminal 3D",
                eave=14.5, rise=6.0, rw=22.0, hub=None, wave=0.8, far=1200, landside=False),
    "t3e": dict(osm=OSM_T3E, g=(17800.0, -18560.0), zh="首都机场3号航站楼E区", en="Beijing Capital Airport Terminal 3E",
                eave=15.5, rise=7.0, rw=24.0,
                hub=(10.0, 125.0), knots=[(-260, 22.0), (-150, 25.0), (-60, 33.0), (10, 37.0), (80, 34.0), (150, 26.0), (220, 22.0)],
                hw=(110.0, 280.0), wave=1.0, far=1500, landside=False),
}
P = PARTS[PART]
GX, GZ = P["g"]
EAVE_OUT = 3.5           # the roof's edge beyond the outline
FASCIA = 2.5
AXIS = math.radians(95.7)          # the piers' direction (north, 5.7 degrees west of it)
AX = (math.cos(AXIS), math.sin(AXIS))
SPAN = 36.0                        # the column grid


def local(pts):
    return [(x - GX, -(z - GZ)) for x, z in pts]


# --- 2D helpers ------------------------------------------------------------------------------------------------

def area(Pl):
    return 0.5 * sum(Pl[i][0] * Pl[(i + 1) % len(Pl)][1] - Pl[(i + 1) % len(Pl)][0] * Pl[i][1] for i in range(len(Pl)))


def ccw(Pl):
    return Pl if area(Pl) > 0 else Pl[::-1]


def dp(pts, tol):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return list(pts)
    a, b = np.array(pts[0]), np.array(pts[-1])
    d = b - a
    L = np.hypot(*d) or 1.0
    best, bi = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        dist = abs(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0])) / L if np.hypot(*d) > 0 else np.hypot(*(p - a))
        if dist > best:
            best, bi = dist, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return dp(pts[:bi + 1], tol)[:-1] + dp(pts[bi:], tol)


def simplify(Pl, tol):
    """Douglas-Peucker on a closed ring (split at the vertex furthest from the first)."""
    far = max(range(len(Pl)), key=lambda i: math.dist(Pl[0], Pl[i]))
    a = dp(Pl[:far + 1], tol)
    b = dp(Pl[far:] + [Pl[0]], tol)
    return a[:-1] + b[:-1]


def densify(Pl, step, closed=True):
    out = []
    n = len(Pl) if closed else len(Pl) - 1
    for i in range(n):
        a, b = Vector(Pl[i]), Vector(Pl[(i + 1) % len(Pl)])
        k = max(1, math.ceil((b - a).length / step))
        for j in range(k):
            p = a.lerp(b, j / k)
            out.append((p.x, p.y))
    if not closed:
        out.append(tuple(Pl[-1]))
    return out


def offset(Pl, d, limit=2.2):
    """A counter-clockwise ring pushed out by d (mitred, the mitre clamped)."""
    n = len(Pl)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(Pl[i - 1]), Vector(Pl[i]), Vector(Pl[(i + 1) % n])
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = Vector((e0.y, -e0.x)), Vector((e1.y, -e1.x))
        m = n0 + n1
        if m.length < 1e-6:
            m = n0
        m.normalize()
        k = d / max(m.dot(n0), 1.0 / limit)
        q = p1 + m * k
        out.append((q.x, q.y))
    return out


def pip(xs, ys, Pl):
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    inside = np.zeros(xs.shape, bool)
    for i in range(len(Pl)):
        (ax, ay), (bx, by) = Pl[i], Pl[(i + 1) % len(Pl)]
        if ay == by:
            continue
        cross = (ay > ys) != (by > ys)
        xint = (bx - ax) * (ys - ay) / (by - ay) + ax
        inside ^= cross & (xs < xint)
    return inside


def seg_dist(xs, ys, segs):
    """Distance from points to the nearest of segments [(a, b), ...]."""
    xs, ys = np.asarray(xs, float)[..., None], np.asarray(ys, float)[..., None]
    A = np.array([s[0] for s in segs], float)
    B = np.array([s[1] for s in segs], float)
    dx, dy = B[:, 0] - A[:, 0], B[:, 1] - A[:, 1]
    L2 = np.maximum(dx * dx + dy * dy, 1e-9)
    t = np.clip(((xs - A[:, 0]) * dx + (ys - A[:, 1]) * dy) / L2, 0, 1)
    return np.min(np.hypot(xs - (A[:, 0] + t * dx), ys - (A[:, 1] + t * dy)), axis=-1)


def ring_segs(Pl):
    return [(Pl[i], Pl[(i + 1) % len(Pl)]) for i in range(len(Pl))]


def cdt(outer, extra_edges=(), pts=()):
    """Triangles inside `outer` (a ring), honouring extra constraint polylines, with loose points inside."""
    verts = [Vector(p) for p in outer]
    edges = []
    for line in extra_edges:
        base = len(verts)
        verts += [Vector(p) for p in line]
        edges += [(base + i, base + (i + 1) % len(line)) for i in range(len(line))]
    verts += [Vector(p) for p in pts]
    vs, _, faces, _, _, _ = delaunay_2d_cdt(verts, edges, [list(range(len(outer)))], 1, 1e-4)
    return [(v.x, v.y) for v in vs], [f for f in faces if len(f) == 3]


def convex(poly, V, eps=1e-6):
    n = len(poly)
    for i in range(n):
        a, b, c = V[poly[i - 1]], V[poly[i]], V[poly[(i + 1) % n]]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -eps:
            return False
    return True


def convex_pieces(ring, max_extent=260.0):
    """A ring cut into convex pieces: triangulated, then triangles merged across shared edges while the union stays
    convex and not too long (Hertel-Mehlhorn)."""
    V, tris = cdt(ring)
    polys = []
    for t in tris:
        a, b, c = (V[i] for i in t)
        polys.append(list(t) if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0 else list(t[::-1]))

    def extent(poly):
        xs = [V[i][0] for i in poly]
        ys = [V[i][1] for i in poly]
        return max(max(xs) - min(xs), max(ys) - min(ys))

    changed = True
    while changed:
        changed = False
        owner = {}
        for i, p in enumerate(polys):
            if p is None:
                continue
            for k in range(len(p)):
                owner[(p[k], p[(k + 1) % len(p)])] = i
        # longest shared edges first: big clean pieces
        cand = sorted(((a, b) for (a, b) in owner if (b, a) in owner and owner[(a, b)] < owner[(b, a)]),
                      key=lambda e: -math.dist(V[e[0]], V[e[1]]))
        for a, b in cand:
            i, j = owner[(a, b)], owner[(b, a)]
            pi, pj = polys[i], polys[j]
            k = pi.index(b)
            ri = pi[k:] + pi[:k]          # b ... a
            k = pj.index(a)
            rj = pj[k:] + pj[:k]          # a ... b
            merged = ri + rj[1:-1]
            if convex(merged, V) and extent(merged) <= max_extent:
                polys[i], polys[j] = merged, None
                changed = True
                break
    return [[V[i] for i in p] for p in polys if p is not None]


# --- the buildings' plans --------------------------------------------------------------------------------------

def plans(tol):
    """(the outline as OSM drew it, the glass line, the roof's edge, which glass-line vertices face the landside)."""
    osm = ccw(simplify(local(P["osm"]), tol))
    wall = list(osm)
    if P["landside"]:
        wall = landside_wall(osm, tol)
    roof = ccw(offset(osm, EAVE_OUT))
    return osm, wall, roof


def road_segs(ids=None, z=None):
    segs = []
    for rid, (h, w, line) in ROADS.items():
        if ids is not None and rid not in ids:
            continue
        L = local(line)
        segs += [(L[i], L[i + 1]) for i in range(len(L) - 1)]
    return segs


def landside_wall(osm, tol):
    """T3C's ring with its landside pushed north (local +y) off the lanes until CLEARANCE from every centre line."""
    segs = road_segs()
    pts = densify(osm, 4.0)
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    push = np.zeros(len(pts))
    for i in range(len(pts)):
        if ys[i] > -110 or seg_dist([xs[i]], [ys[i]], segs)[0] >= CLEARANCE:
            continue
        lo, hi = 0.0, 60.0
        while hi - lo > 0.1:
            mid = (lo + hi) / 2
            if seg_dist([xs[i]], [ys[i] + mid], segs)[0] >= CLEARANCE:
                hi = mid
            else:
                lo = mid
        push[i] = hi + 0.3
    # smooth the push along the ring (never less than needed), so the glass runs in a clean curve
    n = len(push)
    sm = push.copy()
    for _ in range(6):
        sm = np.maximum(push, (np.roll(sm, 1) + 2 * sm + np.roll(sm, -1)) / 4)
    pts = [(x, y + s) for x, y, s in zip(xs, ys, sm)]
    return ccw(simplify(pts, tol * 0.5))


# --- the roof's height field -----------------------------------------------------------------------------------

def interp(knots, v):
    if v <= knots[0][0]:
        return knots[0][1]
    for (a, za), (b, zb) in zip(knots, knots[1:]):
        if v <= b:
            t = (v - a) / (b - a)
            t = t * t * (3 - 2 * t)
            return za + (zb - za) * t
    return knots[-1][1]


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Roof:
    def __init__(self, roof_ring):
        self.segs = ring_segs(roof_ring)
        self.ring = roof_ring
        xs = [p[0] for p in roof_ring]
        ys = [p[1] for p in roof_ring]
        h = P["hub"] or (0.0, 0.0)
        self.rmax = max(math.hypot(x - h[0], y - h[1]) for x, y in roof_ring)

    def z(self, xs, ys):
        xs, ys = np.asarray(xs, float), np.asarray(ys, float)
        d = seg_dist(xs, ys, self.segs) * np.where(pip(xs, ys, self.ring), 1.0, -1.0)
        s = xs * AX[0] + ys * AX[1]
        z = P["eave"] + P["rise"] * smoothstep(0.0, P["rw"], d) + 0.25 * np.minimum(d, 0)
        z = z + P["wave"] * np.sin(2 * math.pi * s / 260.0) * smoothstep(0.0, 12.0, d + 4)
        if P["hub"]:
            hx, hy = P["hub"]
            u, v = np.abs(xs - hx), ys - hy
            w = 1 - smoothstep(P["hw"][0], P["hw"][1], u)
            zh = np.vectorize(lambda vv: interp(P["knots"], vv))(v)
            # the swell is a smooth roof of its own: near its edges it still drops towards the eaves a little
            zh = zh - 3.0 * (1 - smoothstep(0.0, 14.0, d))
            z = z + w * np.maximum(zh - z, 0)
        return z

    def u(self, xs, ys):
        h = P["hub"] or (0.0, 0.0)
        r = np.hypot(np.asarray(xs) - h[0], np.asarray(ys) - h[1]) / self.rmax
        return np.clip(0.03 + 0.94 * r, 0.03, 0.97)


# --- textures and materials ------------------------------------------------------------------------------------

def gradient(c0, c1, c2, w):
    t = np.linspace(0, 1, w)[None, :, None]
    a, b, c = (np.array(linear(x)) ** (1 / 2.2) for x in (c0, c1, c2))
    return np.where(t < 0.5, a + (b - a) * (t / 0.5), b + (c - b) * ((t - 0.5) / 0.5))


def roof_image():
    w, h = 256, 64
    g = np.repeat(gradient("#a4603f", "#b38654", "#bfa268", w), h, axis=0).astype(np.float32)
    rng = np.random.default_rng(7)
    g *= (0.95 + 0.1 * rng.random((h, w, 1))).astype(np.float32)
    y = np.arange(h)[:, None, None]
    g[np.repeat((y % 8 == 0), w, axis=1)[..., 0]] *= 0.78       # standing seams across the axis, every 3 m
    return image("PEK_Roof", np.flipud(g).copy())


def soffit_image():
    w, h = 256, 32
    g = np.repeat(gradient("#c4552f", "#d98a42", "#e2b456", w), h, axis=0).astype(np.float32)
    y = np.arange(h)[:, None, None]
    g[np.repeat((y % 2 == 0), w, axis=1)[..., 0]] *= 0.8        # the slats
    return image("PEK_Soffit", np.flipud(g).copy())


def materials():
    glass = dict(floorH=3.6, colW=2.0, glass="#6a8c99", frame="#aab2b8", spandrel="#aab2b8", mull=0.022, slab=0.025,
                 metal=0.75, rough=0.06, lit=0.55, warm="#ffe0b0", coolShare=0.15, seed=83)
    sky = material("PEK_Skylight", "#7d98a8", 0.12, metal=0.8, props={"wet": "surface", "glow": "none", "emit": "night"})
    b = sky.node_tree.nodes.get("Principled BSDF")
    b.inputs["Emission Color"].default_value = (*linear("#ffd9a0"), 1.0)
    b.inputs["Emission Strength"].default_value = 0.6
    porch = material("PEK_Porch", "#33454f", 0.06, metal=0.8, props={"wet": "surface", "glow": "none", "emit": "night"})
    b = porch.node_tree.nodes.get("Principled BSDF")
    b.inputs["Emission Color"].default_value = (*linear("#ffe6bf"), 1.0)
    b.inputs["Emission Strength"].default_value = 1.2
    from kit import paving
    return dict(
        glass=facade("PEK_Glass", glass),
        roof=material("PEK_Roof", "#b8834c", 0.42, metal=0.55, tex=roof_image(), props={"wet": "surface", "glow": "none"}),
        soffit=material("PEK_Soffit", "#d8763a", 0.6, tex=soffit_image(), props={"wet": "none", "glowStrength": 0.55}),
        fascia=material("PEK_Fascia", "#c9cdd0", 0.32, metal=0.65, props={"wet": "surface", "glowStrength": 0.5}),
        sky=sky,
        red=material("PEK_Red", "#a8322a", 0.45, metal=0.35, props={"wet": "surface", "glowStrength": 0.7}),
        steel=material("PEK_Steel", "#9aa2a8", 0.35, metal=0.7, props={"wet": "surface", "glowStrength": 0.4}),
        dark=material("PEK_Dark", "#2e3439", 0.5, metal=0.3, props={"wet": "surface", "glow": "none"}),
        porch=porch,
        deck=material("PEK_Deck", "#aaa69d", 0.75, tex=paving(), props={"wet": "ground", "glow": "none"}),
        letters=material("PEK_Letters", "#c81e1e", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#ff4a3a", "glowStrength": 0.7}),
    )


TILE = dict(deck=4.0, steel=2.0, dark=2.0, red=2.0, fascia=3.0)


# --- geometry --------------------------------------------------------------------------------------------------

def roof_geo(g, R, osm, wall, roof, grid, edge_step, detail=True):
    """The roof as one smooth surface: top, the soffit where it is outside the glass, and the fascia."""
    ring = densify(roof, edge_step)
    wl = densify(wall, edge_step)
    x0, x1 = min(p[0] for p in ring), max(p[0] for p in ring)
    y0, y1 = min(p[1] for p in ring), max(p[1] for p in ring)
    gx, gy = np.meshgrid(np.arange(x0 + grid / 2, x1, grid), np.arange(y0 + grid / 2, y1, grid))
    gx, gy = gx.ravel(), gy.ravel()
    keep = pip(gx, gy, roof) & (seg_dist(gx, gy, ring_segs(roof)) > grid * 0.4) & (seg_dist(gx, gy, ring_segs(wall)) > grid * 0.4)
    V, tris = cdt(ring, [wl], list(zip(gx[keep], gy[keep])))
    vx = np.array([v[0] for v in V])
    vy = np.array([v[1] for v in V])
    vz = R.z(vx, vy)
    vu = R.u(vx, vy)
    s = (vx * AX[0] + vy * AX[1]) / 24.0
    top = [g.vert((x, y, z)) for x, y, z in zip(vx, vy, vz)]
    bot = [g.vert((x, y, z - FASCIA)) for x, y, z in zip(vx, vy, vz)]
    for t in tris:
        a, b, c = t
        if (V[b][0] - V[a][0]) * (V[c][1] - V[a][1]) - (V[b][1] - V[a][1]) * (V[c][0] - V[a][0]) < 0:
            a, c = c, a
        uv = [(vu[i], s[i]) for i in (a, b, c)]
        g.face((top[a], top[b], top[c]), "roof", uv, smooth=True)
        cx, cy = (V[a][0] + V[b][0] + V[c][0]) / 3, (V[a][1] + V[b][1] + V[c][1]) / 3
        if not pip([cx], [cy], wall)[0]:
            uvs = [(vu[i], s[i] * 3.0) for i in (a, c, b)]
            g.face((bot[a], bot[c], bot[b]), "soffit", uvs, smooth=True)
    # the fascia round the edge (the ring's vertices are the first ones of V, in order)
    n = len(ring)
    rx = np.array([p[0] for p in ring])[:, None]
    ry = np.array([p[1] for p in ring])[:, None]
    idx = list(np.argmin((vx[None, :] - rx) ** 2 + (vy[None, :] - ry) ** 2, axis=1))
    u = 0.0
    for i in range(n):
        a, b = idx[i], idx[(i + 1) % n]
        L = math.dist(V[a], V[b])
        g.face((bot[a], bot[b], top[b], top[a]), "fascia", [(u, 0), (u + L / 3, 0), (u + L / 3, 1), (u, 1)])
        u += L / 3
    return V, vz


def wall_geo(g, R, wall, step):
    """Curtain wall from the ground to the soffit along the glass line."""
    wl = densify(wall, step)
    xs = np.array([p[0] for p in wl])
    ys = np.array([p[1] for p in wl])
    zs = R.z(xs, ys) - FASCIA
    n = len(wl)
    u = 0.0
    for i in range(n):
        j = (i + 1) % n
        L = math.dist(wl[i], wl[j])
        a, b = wl[i], wl[j]
        g.poly([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], zs[j]), (a[0], a[1], zs[i])], "glass",
               [(u, 0.0), (u + L, 0.0), (u + L, zs[j]), (u, zs[i])])
        u += L
    return zs


def skylight_geo():
    """One triangular skylight: a 7 m triangle on the roof, its south-east edge lifted 1.3 m into a glazed face."""
    g = Geo()
    A, B, C = Vector((-3.5, -2.2, 0)), Vector((3.5, -2.2, 0)), Vector((0, 3.8, 0))
    up = Vector((0, 0, 1.3))
    A1, B1 = A + up, B + up
    g.poly([A, B, B1, A1], "sky")
    g.poly([A1, B1, C], "sky")
    g.poly([A, A1, C], "fascia")
    g.poly([B, C, B1], "fascia")
    return g


def skylights(coll, R, wall, mesh):
    """Rows of skylights over the roof, away from its edges; each sits on the roof, tilted with it, facing SE."""
    xs0 = [p[0] for p in wall]
    ys0 = [p[1] for p in wall]
    segs = ring_segs(wall)
    n = 0
    ex, ey = AX
    nx, ny = ey, -ex                    # across the axis (eastish)
    rng = np.random.default_rng(5)
    span_a, span_c = 18.0, 13.5
    smin = min(x * ex + y * ey for x, y in wall)
    smax = max(x * ex + y * ey for x, y in wall)
    tmin = min(x * nx + y * ny for x, y in wall)
    tmax = max(x * nx + y * ny for x, y in wall)
    pts = []
    for i, s in enumerate(np.arange(smin, smax, span_a)):
        for t in np.arange(tmin + (span_c / 2 if i % 2 else 0), tmax, span_c):
            pts.append((s * ex + t * nx, s * ey + t * ny))
    px = np.array([p[0] for p in pts])
    py = np.array([p[1] for p in pts])
    ok = pip(px, py, wall) & (seg_dist(px, py, segs) > 9.0)
    yaw = math.atan2(-1.0, 1.0) + math.pi / 2       # the glazed edge's outward normal points south-east
    for x, y in zip(px[ok], py[ok]):
        z = float(R.z([x], [y])[0])
        zx = float(R.z([x + 2], [y])[0] - R.z([x - 2], [y])[0]) / 4
        zy = float(R.z([x], [y + 2])[0] - R.z([x], [y - 2])[0]) / 4
        nrm = Vector((-zx, -zy, 1)).normalized()
        q = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix().to_4x4()
        m = Matrix.Translation((x, y, z - 0.15)) @ q @ Matrix.Rotation(yaw, 4, "Z")
        place(mesh, f"Skylight{n}", coll, m)
        n += 1
    return n


def gate_geo():
    """A gate's door on the airside at jet-bridge height: a steel frame round a dark door, 0.5 m proud."""
    g = Geo()
    g.box(-2.6, 2.6, 0.0, 0.5, 3.8, 4.1, "steel")
    g.box(-2.6, 2.6, 0.0, 0.5, 7.6, 7.9, "steel")
    g.box(-2.6, -2.3, 0.0, 0.5, 4.1, 7.6, "steel")
    g.box(2.3, 2.6, 0.0, 0.5, 4.1, 7.6, "steel")
    g.box(-2.3, 2.3, 0.0, 0.25, 4.1, 7.6, "dark", skip=("-y",))
    return g


def gates(coll, wall, mesh, landside):
    n = 0
    for i in range(len(wall)):
        a, b = Vector(wall[i]), Vector(wall[(i + 1) % len(wall)])
        d = b - a
        L = d.length
        if L < 34:
            continue
        d.normalize()
        out = Vector((d.y, -d.x))
        mid = (a + b) / 2
        if landside and out.y < -0.3 and mid.y < -60:
            continue
        k = int((L - 24) // 42) + 1
        for j in range(k):
            p = a + d * (12 + (L - 24) * (j + 0.5) / k)
            yaw = math.atan2(out.y, out.x) - math.pi / 2
            place(mesh, f"Gate{n}", coll, Matrix.Translation((p.x, p.y, 0.0)) @ Matrix.Rotation(yaw, 4, "Z"))
            n += 1
    return n


# --- T3C's landside: the departure pavement, porches, raking columns, the name -----------------------------------

def deck_line():
    """The inner departure lane's inner edge, east to west, pushed 2.9 m off its centre line towards the glass."""
    line = []
    for rid in DECK_ROADS:
        L = local(ROADS[rid][2])
        line += L if not line else L[1:]
    line = densify(line, 6.0, closed=False)
    out = []
    for i, p in enumerate(line):
        a = Vector(line[max(0, i - 1)])
        b = Vector(line[min(len(line) - 1, i + 1)])
        d = (b - a).normalized()
        n = Vector((-d.y, d.x))              # left of east-to-west travel: north, the glass's side
        if n.y < 0:
            n = -n
        out.append((Vector(p) + n * 2.9, n))
    return out


def ray_hit(o, d, Pl):
    best = None
    for (ax, ay), (bx, by) in ring_segs(Pl):
        e = Vector((bx - ax, by - ay))
        den = d.x * e.y - d.y * e.x
        if abs(den) < 1e-9:
            continue
        w = Vector((ax - o.x, ay - o.y))
        t = (w.x * e.y - w.y * e.x) / den
        s = (w.x * d.y - w.y * d.x) / den
        if t > 0 and 0 <= s <= 1 and (best is None or t < best):
            best = t
    return best


def deck(g, wall, helpers, clear):
    """The pavement on the departure deck from the lane to the glass (x local -205 .. 255)."""
    rows = []
    for p, n in deck_line():
        if not (-215 <= p.x <= 255):
            continue
        t = ray_hit(p, n, wall)
        if t is None or t > 30:
            continue
        rows.append((p, p + n * (t + 0.4)))
    zt, zb = DECK_Z + 0.02, DECK_Z - 0.75
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        g.polyn([(a0.x, a0.y, zt), (b0.x, b0.y, zt), (b1.x, b1.y, zt), (a1.x, a1.y, zt)], "deck", (0, 0, 1))
        g.polyn([(a0.x, a0.y, zb), (b0.x, b0.y, zb), (b1.x, b1.y, zb), (a1.x, a1.y, zb)], "steel", (0, 0, -1))
        g.polyn([(a0.x, a0.y, zb), (b0.x, b0.y, zb), (b0.x, b0.y, zt), (a0.x, a0.y, zt)], "steel", ((a0 - a1).x, (a0 - a1).y, 0))
    for k in range(0, len(rows) - 1, 2):
        sel = rows[k:k + 3]
        pts = [(q.x, q.y, z) for r in sel for q in r for z in (zb, zt)]
        collider_pts(helpers, "deck", pts)
        clear.append([(q.x, q.y) for r in sel for q in r])
    # rails at the two open ends
    for (a0, a1) in (rows[0], rows[-1]):
        d = (a1 - a0)
        L = d.length
        d.normalize()
        o = Vector((-d.y, d.x)) * 0.05
        g.polyn([(a0.x - o.x, a0.y - o.y, zt), (a1.x - o.x, a1.y - o.y, zt), (a1.x - o.x, a1.y - o.y, zt + 1.1), (a0.x - o.x, a0.y - o.y, zt + 1.1)], "steel", (o.x, o.y, 0))
        g.polyn([(a0.x + o.x, a0.y + o.y, zt), (a1.x + o.x, a1.y + o.y, zt), (a1.x + o.x, a1.y + o.y, zt + 1.1), (a0.x + o.x, a0.y + o.y, zt + 1.1)], "steel", (-o.x, -o.y, 0))
        collider_pts(helpers, "rail", [(q.x + s * o.x * 2, q.y + s * o.y * 2, z) for q in (a0, a1) for s in (-1, 1) for z in (zt, zt + 1.1)])
    return rows


def frontage(R, wall, rows):
    """Points along the glass behind the pavement, every SPAN metres, with the outward normal (towards the lanes)."""
    line = [r[1] for r in rows]
    L = [0.0]
    for a, b in zip(line, line[1:]):
        L.append(L[-1] + (b - a).length)
    out = []
    s = SPAN / 2
    while s < L[-1]:
        k = max(i for i in range(len(L)) if L[i] <= s)
        k = min(k, len(line) - 2)
        t = (s - L[k]) / max(L[k + 1] - L[k], 1e-6)
        p = line[k].lerp(line[k + 1], t)
        d = (line[k + 1] - line[k]).normalized()
        n = Vector((-d.y, d.x))
        if n.y > 0:
            n = -n
        out.append((p - n * 0.4, n, d))
        s += SPAN
    return out


def porches(g, R, wall, rows, helpers):
    """Entrances in the glass, one per bay, on the pavement (departures) and under it (arrivals): a lit band of
    sliding doors in steel frames, a thin steel canopy over them."""
    n = 0
    for p, out, d in frontage(R, wall, rows):
        for z0, w2 in ((DECK_Z + 0.02, 5.0), (0.0, 4.0)):
            z1 = z0 + 3.4
            a, b = p - d * w2 + out * 0.42, p + d * w2 + out * 0.42
            g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], "porch", (out.x, out.y, 0))
            for k in range(int(w2 * 2 / 1.8) + 1):
                q = a.lerp(b, k / int(w2 * 2 / 1.8)) + out * 0.04
                e0, e1 = q - d * 0.07, q + d * 0.07
                g.polyn([(e0.x, e0.y, z0), (e1.x, e1.y, z0), (e1.x, e1.y, z1), (e0.x, e0.y, z1)], "steel", (out.x, out.y, 0))
            c0, c1 = z1 + 0.6, z1 + 0.85
            aa, bb = p - d * (w2 + 0.8) + out * 0.4, p + d * (w2 + 0.8) + out * 0.4
            a3, b3 = aa + out * 2.4, bb + out * 2.4
            for (q0, q1, nn) in ((a3, b3, out), (aa, a3, -d), (b3, bb, d)):
                g.polyn([(q0.x, q0.y, c0), (q1.x, q1.y, c0), (q1.x, q1.y, c1), (q0.x, q0.y, c1)], "steel", (nn.x, nn.y, 0))
            g.polyn([(aa.x, aa.y, c1), (bb.x, bb.y, c1), (b3.x, b3.y, c1), (a3.x, a3.y, c1)], "steel", (0, 0, 1))
            g.polyn([(aa.x, aa.y, c0), (bb.x, bb.y, c0), (b3.x, b3.y, c0), (a3.x, a3.y, c0)], "steel", (0, 0, -1))
        n += 1
    return n


def columns(g, R, wall, rows, helpers):
    """Red raking columns between the porches: from the ground at the glass out to the canopy's soffit."""
    n = 0
    for p, out, d in frontage(R, wall, rows):
        base = p + d * (SPAN / 2) + out * 0.9
        top = base + out * 9.0
        zt = float(R.z([top.x], [top.y])[0]) - FASCIA
        segs = 8
        r0, r1 = 0.55, 0.85
        ring0, ring1 = [], []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring0.append(g.vert((base.x + r0 * math.cos(a), base.y + r0 * math.sin(a), 0.0)))
            ring1.append(g.vert((top.x + r1 * math.cos(a), top.y + r1 * math.sin(a), zt + 0.3)))
        for k in range(segs):
            j = (k + 1) % segs
            g.face((ring0[k], ring0[j], ring1[j], ring1[k]), "red", smooth=True)
        # a person on the pavement meets the column where it passes through it
        f = (DECK_Z + 3.0) / zt
        c0 = base.lerp(top, (DECK_Z - 1.0) / zt)
        c1 = base.lerp(top, f)
        collider_pts(helpers, "column", [(c.x + r * math.cos(2 * math.pi * k / 6), c.y + r * math.sin(2 * math.pi * k / 6), z)
                                         for c, z in ((c0, DECK_Z - 1.0), (c1, DECK_Z + 3.0)) for k in range(6) for r in (0.7,)])
        collider_pts(helpers, "columnfoot", [(base.x + 0.7 * math.cos(2 * math.pi * k / 6), base.y + 0.7 * math.sin(2 * math.pi * k / 6), z)
                                             for k in range(6) for z in (0.0, 4.0)] +
                     [(base.lerp(top, 4.0 / zt).x, base.lerp(top, 4.0 / zt).y, 4.0)])
        n += 1
    return n


def text_mesh(font, body, height, width, name, mat, coll, m, extrude=0.08):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, 1.0, extrude
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_character = 1.15
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    ky = height / (max(ys) - min(ys))
    kx = width / (max(xs) - min(xs)) if width else ky
    cy = (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * kx, (v.co.y - cy) * ky, v.co.z + extrude))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def name_sign(R, roof, M, coll):
    """北京首都国际机场 on the canopy's fascia over the middle of the frontage (facing the forecourt)."""
    x = 40.0
    best = None
    for (ax, ay), (bx, by) in ring_segs(roof):
        if (ax - x) * (bx - x) <= 0 and ax != bx:
            t = (x - ax) / (bx - ax)
            y = ay + t * (by - ay)
            if best is None or y < best[1]:
                best = (x, y, Vector((bx - ax, by - ay)).normalized())
    x, y, d = best
    if d.x < 0:
        d = -d
    out = Vector((d.y, -d.x))
    if out.y > 0:
        out = -out
    z = float(R.z([x], [y])[0]) - FASCIA / 2
    try:
        font = bpy.data.fonts.load(FONT)
    except Exception:
        font = bpy.data.fonts.load("/System/Library/Fonts/STHeiti Medium.ttc")
    yaw = math.atan2(out.y, out.x) + math.pi / 2
    m = Matrix.Translation((x + out.x * 0.25, y + out.y * 0.25, z + 0.35)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    n = text_mesh(font, "北京首都国际机场", 1.5, 26.0, "Name", M["letters"], coll, m)
    m2 = Matrix.Translation((x + out.x * 0.25, y + out.y * 0.25, z - 0.85)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")
    n += text_mesh(font, "BEIJING CAPITAL INTERNATIONAL AIRPORT  T3", 0.5, 22.0, "NameEn", M["dark"], coll, m2, extrude=0.05)
    return n


# --- build -----------------------------------------------------------------------------------------------------

def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection(P["zh"])
    det = collection("楼", main)

    osm, wall, roof = plans(1.2)
    R = Roof(roof)
    g = Geo()
    roof_geo(g, R, osm, wall, roof, 12.0 if PART == "t3c" else 16.0, 7.0)
    wall_geo(g, R, wall, 6.0)
    helpers = collection("碰撞体")
    clear = []
    rows = None
    if P["landside"]:
        rows = deck(g, wall, helpers, clear)
        porches(g, R, wall, rows, helpers)
        columns(g, R, wall, rows, helpers)
    g.build("Terminal", det, M, TILE)
    tris = g.tris()

    inst = collection("天窗和登机口", main)
    sk = mesh_of(skylight_geo(), "SkylightMesh", M, TILE)
    nsky = skylights(inst, R, wall, sk)
    gm = mesh_of(gate_geo(), "GateMesh", M, TILE)
    ngate = gates(inst, wall, gm, P["landside"])
    tris += nsky * 4 + ngate * 34

    if P["landside"]:
        letters = collection("字", main)
        tris += name_sign(R, roof, M, letters)

    far = collection("LOD1", main)
    fo, fw, fr = plans(5.0)
    if P["landside"]:
        fw = wall     # keep the glass line (it is what the canopy is measured from)
    RF = Roof(fr)
    f = Geo()
    roof_geo(f, RF, fo, simplify(fw, 4.0), fr, 45.0, 30.0)
    wall_geo(f, RF, simplify(fw, 4.0), 60.0)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    # colliders: the glass line cut into convex pieces, each up to its soffit
    for k, piece in enumerate(convex_pieces(wall)):
        xs = np.array([p[0] for p in piece])
        ys = np.array([p[1] for p in piece])
        zs = R.z(xs, ys) - FASCIA - 0.3
        collider_pts(helpers, f"hall{k}", [(x, y, 0.0) for x, y in piece] + [(x, y, z) for x, y, z in zip(xs, ys, zs)])
    # footprint: OSM's own ring (the city drops its block and any learnt ones under it), in convex pieces
    fp = convex_pieces(ccw(simplify(local(P["osm"]), 1.0)), 400.0)
    fp.sort(key=lambda p: -abs(area(p)))
    for k, piece in enumerate(fp):
        flat_marker(helpers, f"{PART}{k}", piece, "FOOTPRINT")
    for k, piece in enumerate(convex_pieces(roof, 400.0)):
        flat_marker(helpers, f"{PART}_roof{k}", piece, "CLEAR")
    for k, piece in enumerate(clear):
        flat_marker(helpers, f"{PART}_deck{k}", piece, "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = PART, P["zh"], P["en"]
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, 0.0
    s.far_distance = P["far"]
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris, skylights=nsky, gates=ngate, wall=len(wall), roof=len(roof))


def write_part_of():
    """t3d and t3e are parts of t3c: one place on the map, one taxi destination (LandmarkDef.partOf)."""
    if PART == "t3c" or "--export" not in argv:
        return
    path = os.path.join(REPO, "src", "city", "landmarks", "glb", f"{PART}.meta.json")
    with open(path) as fh:
        meta = json.load(fh)
    meta["partOf"] = "t3c"
    out = json.dumps(meta, ensure_ascii=False, indent=2)
    import re
    out = re.sub(r"\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]", r"[\1, \2]", out)
    with open(path, "w") as fh:
        fh.write(out + "\n")
    print("partOf t3c ->", path)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
    write_part_of()
