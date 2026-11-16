# 首都机场 2 号航站楼 (T2, 1999) and its neighbour, the T2 西区卫星厅 (the 1980 Terminal 1), built in Blender and marked
# with the bcity_landmark add-on's conventions (2026-11-16, docs/airport-design.md §5.1).
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/pek_t2.py -- [--which t2|t1] [--out art/landmarks/<id>.blend] [--export]
#
# Sources: OSM way 172936036 (T2) and way 148725075 (T1, old_name 1号航站楼) in .cache/osm/chunk-hc0-0.json; the
# roads round them from public/city/network.json (the departure viaducts are bridges at 6.5 m); photographs on
# Wikimedia Commons (Category:Beijing Capital International Airport Terminal 2 / Terminal 1: the 2024 aerial of T1
# and T2, the landside kerb by day and by night, the apron views, the 2008 aerial of T1).
#
# T2 (heading -6.9: the outline's long edges run 6.9 degrees west of north; origin game (16300, -18930)): an H in
# plan. The main hall (local x -70..55, y -171..171) under one blue-grey metal roof whose section rises from the
# landside eave (20.5 m, a silver tube along the edge) in a convex sweep to a crest at 32 m over the airside third,
# then drops steeply as a dark band with small windows (the red 北京 stands on it, facing the apron) to a lower
# curved roof over the gate lounges (17 m at the east wall). Glass walls, white bands. Landside: the departure
# kerb at 6.5 m (the viaduct, way 105145946, runs 13 m off the wall; the model fills the kerb between wall and
# viaduct as a deck on slim piers, the arrivals road and footway below stay clear) under twelve barrel-vault
# canopies whose scalloped edge is the terminal's landmark (bays of 25.4 m, springing 13.5 m, crown 18.5 m, on
# steel tree columns standing on the kerb). Two piers (y 305..374 and -376..-305, 50 m wide bodies) of white
# corrugated walls with glazed bands under a long grey barrel roof, linked to the hall by lower necks, and a lower
# block on the hall's north-east. Nothing solid stands on a road: the walls follow the OSM outline, the kerb's
# piers stand between the footway and the arrivals road, the canopies are 7 m over the viaduct.
#
# T1 (heading -7.09, origin game (15765, -19045)): the old terminal as renovated in 2004: a 195 x 113 m block of
# glass and white pilasters with a deep white cornice and the red 北京 on the roof over the landside (south) front
# where the departure viaduct passes 1.7 m from the wall, a raised centre, terracotta roofs; from its north side two
# diagonal corridors to the two round satellite halls (r 26 m, glass at apron level, a white drum, a smaller drum
# on top) and a low link between them.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, T, collider_box, collider_pts, cyl, flat_marker, mesh_of, paving, place, rect  # noqa: E402
from tower import facade  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
WHICH = argv[argv.index("--which") + 1] if "--which" in argv else "t2"
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", f"{WHICH}.blend")
FONT = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
FONT_FALLBACK = "/System/Library/Fonts/STHeiti Medium.ttc"


# --- shared helpers ------------------------------------------------------------------------------------

def ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]


def prism_walls(g, poly, bands, u0=0.0):
    """Walls round a polygon in horizontal bands [(z0, z1, key)], UVs in metres (u along the wall, v up)."""
    poly = ccw(poly)
    u = u0
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        d = b - a
        L = d.length
        if L < 1e-3:
            continue
        out = (d.y / L, -d.x / L, 0.0)
        for z0, z1, key in bands:
            g.polyn([(a.x, a.y, z0), (b.x, b.y, z0), (b.x, b.y, z1), (a.x, a.y, z1)], key, out,
                    uvs=[(u, z0), (u + L, z0), (u + L, z1), (u, z1)])
        u += L
    return u


def flat_roof(g, poly, z, key, down=False):
    poly = ccw(poly)
    g.polyn([(x, y, z) for x, y in poly], key, (0, 0, -1 if down else 1))


def text_mesh(font, body, height, name, mat, coll, m, extrude=0.25, spacing=1.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, 1.0, extrude
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_character = spacing
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    ys = [v.co.y for v in me.vertices]
    k = height / (max(ys) - min(ys))
    cy = (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = m @ Vector((v.co.x * k, (v.co.y - cy) * k, v.co.z + extrude))
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return len(me.polygons)


def facing(p, out):
    """A matrix standing text up at p, its face towards the horizontal direction `out`."""
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(*p) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def load_font():
    try:
        return bpy.data.fonts.load(FONT)
    except Exception:
        return bpy.data.fonts.load(FONT_FALLBACK)


def tube(g, a, b, r, segs, key):
    """A closed prism of `segs` sides from point a to point b (struts, branches)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    s = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(s).normalized()
    v = d.cross(u)
    ra = [g.vert(a + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    rb = [g.vert(b + (u * math.cos(2 * math.pi * i / segs) + v * math.sin(2 * math.pi * i / segs)) * r) for i in range(segs)]
    for i in range(segs):
        k = (i + 1) % segs
        g.face((ra[i], ra[k], rb[k], rb[i]), key, smooth=True)


# --- textures ------------------------------------------------------------------------------------------

def seamed(name, size, base, seam, every_px, rib=None, rib_px=0, noise=0.04, seed=1):
    cv = Canvas(size, size, base)
    cv.noise(noise, seed)
    cv.put(np.mod(cv.x, every_px) < 1.6, seam)
    if rib:
        cv.put(cv.x < rib_px, rib)
    return image(name, np.flipud(cv.a).copy())


def roof_band_image():
    """The steep airside face of T2's roof: dark metal with two rows of small square windows (8 m a repeat)."""
    cv = Canvas(256, 256, "#3e4a57")
    cv.noise(0.05, 7)
    cv.put(np.mod(cv.x, 16) < 1.2, "#34404b")
    for cx in (32, 160):
        for cy in (70, 170):
            cv.rect(cx - 12, cy - 12, cx + 12, cy + 12, "#c9d3da")
            cv.frame(cx - 12, cy - 12, cx + 12, cy + 12, 3, "#e6eaec")
    return image("PEK2_RoofBand", np.flipud(cv.a).copy())


def corrugated(name):
    cv = Canvas(128, 128, "#e3e6e6")
    cv.noise(0.03, 3)
    shade = 0.93 + 0.07 * np.cos(cv.x / 128 * 2 * math.pi * 16)
    cv.a *= shade[..., None]
    return image(name, np.flipud(cv.a).copy())


def canopy_under_image():
    """The underside of a kerb canopy bay: white steel ribs on light glazing (one image per 4 x 4 m)."""
    cv = Canvas(256, 256, "#dfe6ea")
    cv.noise(0.03, 5)
    cv.put(np.mod(cv.x, 64) < 5, "#f4f6f7")
    cv.put(np.mod(cv.y, 128) < 7, "#f7f8f8")
    cv.put((np.mod(cv.x, 64) > 30) & (np.mod(cv.x, 64) < 33), "#c4ccd2")
    return image("PEK2_CanopyUnder", np.flipud(cv.a).copy())


def terracotta():
    cv = Canvas(256, 256, "#a35a43")
    cv.noise(0.08, 11)
    cv.put(np.mod(cv.x, 64) < 2, "#87493a")
    cv.put(np.mod(cv.y, 64) < 2, "#87493a")
    return image("PEK1_Roof", np.flipud(cv.a).copy())


def gravel():
    cv = Canvas(128, 128, "#b6b9b8")
    cv.noise(0.12, 13)
    return image("PEK_RoofFlat", np.flipud(cv.a).copy())


def t2_materials():
    gl = dict(frame="#dfe4e6", mull=0.05, slab=0.07, metal=0.7, rough=0.1, warm="#ffdcae", coolShare=0.35)
    return dict(
        glass=facade("PEK2_Glass", dict(gl, floorH=4.6, colW=2.3, glass="#557f8c", spandrel="#cad3d6", lit=0.55, seed=21)),
        lobby=facade("PEK2_Lobby", dict(gl, floorH=5.7, colW=2.6, glass="#47646f", spandrel="#d6dbdc", lit=0.8, seed=22)),
        band=facade("PEK2_Band", dict(gl, floorH=3.6, colW=1.9, glass="#4e7581", spandrel="#d8dddd", lit=0.6, seed=23)),
        roof=material("PEK2_Roof", "#7c93ab", 0.45, metal=0.45, tex=seamed("PEK2_RoofTex", 512, "#7890a8", "#647c94", 16, "#a9bacb", 6, seed=2),
                      props={"wet": "surface", "glow": "none"}),
        roofband=material("PEK2_RoofBand", "#3e4a57", 0.4, metal=0.4, tex=roof_band_image(), props={"wet": "surface", "glow": "none"}),
        soffit=material("PEK2_Soffit", "#dfe3e5", 0.55, props={"wet": "none", "glowStrength": 0.6}),
        tube=material("PEK2_Tube", "#c4ccd3", 0.3, metal=0.75, props={"wet": "surface", "glowStrength": 0.7}),
        white=material("PEK2_White", "#e7e9e9", 0.5, metal=0.1, props={"wet": "surface", "glowStrength": 0.8}),
        wall=material("PEK2_Wall", "#e3e6e6", 0.55, metal=0.15, tex=corrugated("PEK2_WallTex"), props={"wet": "surface", "glowStrength": 0.6}),
        pierroof=material("PEK2_PierRoof", "#c3c9ce", 0.45, metal=0.4, tex=seamed("PEK2_PierRoofTex", 256, "#c2c8cd", "#a8b0b7", 16, seed=3),
                          props={"wet": "surface", "glow": "none"}),
        flat=material("PEK2_Flat", "#b6b9b8", 0.8, tex=gravel(), props={"wet": "surface", "glow": "none"}),
        canopy=material("PEK2_Canopy", "#b9c2ca", 0.35, metal=0.6, tex=seamed("PEK2_CanopyTex", 128, "#bcc4cc", "#a3acb5", 16, seed=4),
                        props={"wet": "surface", "glow": "none"}),
        under=material("PEK2_CanopyUnder", "#dfe6ea", 0.5, tex=canopy_under_image(),
                       props={"wet": "none", "glow": "lamp", "glowColor": "#ffe2b8", "glowStrength": 0.35}),
        steel=material("PEK2_Steel", "#d9dee2", 0.35, metal=0.6, props={"wet": "surface", "glowStrength": 0.6}),
        concrete=material("PEK2_Concrete", "#b8b6b0", 0.8, props={"wet": "surface", "glow": "none"}),
        pave=material("PEK2_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none"}),
        dark=material("PEK2_Doors", "#26323a", 0.15, metal=0.5, props={"wet": "surface", "glow": "lamp", "glowColor": "#ffd9a0", "glowStrength": 0.25}),
        sign=material("PEK2_Sign", "#1d4f98", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#cfe0ff", "glowStrength": 0.5}),
        red=material("PEK_Red", "#c8202a", 0.45, props={"wet": "surface", "glow": "lamp", "glowColor": "#ff4a3a", "glowStrength": 0.9}),
    )


TILE = dict(pave=4.0, white=3.0, steel=2.0, concrete=4.0, flat=16.0, dark=2.0, sign=2.0, soffit=4.0)


# ======================================================================================================
# T2
# ======================================================================================================

T2_GX, T2_GZ, T2_HEADING = 16300.0, -18930.0, -6.9
XW, XWG, XE = -70.0, -64.5, 55.0           # west (landside) wall above the kerb, arrivals wall below, east wall
HY = 171.0                                 # the hall's half length
RX0, RX1, RY = -75.0, 57.0, 174.0          # the roof's extent (front eave, east eave, ends)
XC, XD = 25.0, 33.0                        # crest, foot of the steep airside band
Z_EAVE, Z_CREST, Z_LOW, Z_EAST = 20.5, 32.0, 22.0, 17.0
ROOF_T = 1.2
KERB = 6.6                                 # departure kerb top (the viaduct's deck is at 6.5)
SLAB_B = 5.7
DECK_Y0, DECK_Y1 = -165.0, 140.0
VIA_IN = -80.3                             # the viaduct's inner edge (centre line x -82.8..-84.5, 6 m wide)
CAN_X0, CAN_X1 = XW, -92.0                 # canopy from the wall out over the viaduct
NB = 12
BAY = (DECK_Y1 - DECK_Y0) / NB
Z_SPRING, RISE = 13.5, 5.0
TREE_X = -76.0
PIER_X = -73.0

NECK_N = rect(-19.0, 54.2, 168.0, 306.0)
NECK_S = rect(-25.0, 55.5, -306.0, -168.0)
NE_BOX = [(50.0, 132.6), (172.4, 133.4), (172.5, 199.4), (137.4, 234.4), (81.0, 234.0), (81.5, 154.4), (50.0, 154.8)]
PIER_N = [(-33.5, 305.1), (-114.3, 303.5), (-133.4, 323.9), (-133.1, 354.7), (-115.6, 374.0), (-66.7, 374.5), (-66.5, 356.1),
          (142.8, 356.0), (142.8, 372.1), (192.7, 372.4), (209.0, 355.8), (208.6, 325.6), (191.6, 305.2), (60.9, 305.1)]
PIER_S = [(60.7, -305.1), (192.1, -309.3), (208.9, -326.5), (209.3, -356.3), (188.2, -376.6), (141.1, -375.9), (140.3, -358.7),
          (-70.1, -360.8), (-71.0, -373.6), (-116.4, -373.7), (-135.5, -356.2), (-135.0, -325.4), (-117.5, -307.6), (-34.4, -307.4)]
# convex pieces of the piers (colliders, footprints): body and the two end blocks
PIER_N_PARTS = [
    [(-114.3, 303.5), (191.6, 305.2), (208.6, 325.6), (209.0, 355.8), (-133.1, 355.8), (-133.4, 323.9)],
    [(-133.1, 355.8), (-66.5, 355.8), (-66.7, 374.5), (-115.6, 374.0)],
    [(142.8, 355.8), (209.0, 355.8), (192.7, 372.4), (142.8, 372.1)],
]
PIER_S_PARTS = [
    [(-117.5, -307.6), (60.7, -305.1), (192.1, -309.3), (208.9, -326.5), (209.3, -358.0), (-135.5, -358.0), (-135.0, -325.4)],
    [(-135.5, -358.0), (-70.3, -358.0), (-71.0, -373.6), (-116.4, -373.7)],
    [(140.3, -358.0), (209.3, -358.0), (188.2, -376.6), (141.1, -375.9)],
]
PIER_Z = 10.5
BARRELS = [(-112.0, 186.0, 305.8, 355.5), (-115.0, 188.0, -357.6, -309.8)]   # x0, x1, y0, y1
BARREL_RISE = 7.5
NECK_Z, NE_Z = 15.0, 13.0


def zr(x):
    """T2's main roof: its top surface along the section (x west to east)."""
    if x <= XC:
        return Z_EAVE + (Z_CREST - Z_EAVE) * math.sin(0.5 * math.pi * (x - RX0) / (XC - RX0))
    if x <= XD:
        return Z_CREST - (Z_CREST - Z_LOW) * (x - XC) / (XD - XC)
    return Z_EAST + (Z_LOW - Z_EAST) * math.cos(0.5 * math.pi * (x - XD) / (RX1 - XD))


def profile(n_rise=16, n_low=6):
    xs = [RX0 + (XC - RX0) * i / n_rise for i in range(n_rise + 1)]
    xs += [XC + (XD - XC) * 0.5, XD]
    xs += [XD + (RX1 - XD) * i / n_low for i in range(1, n_low + 1)]
    for x in (XW, XE):
        if all(abs(x - q) > 0.2 for q in xs):
            xs.append(x)
    return sorted(xs)


def vault(y):
    """The kerb canopy's height at y (a row of segmental vaults, springing at the bay lines)."""
    t = ((y - DECK_Y0) / BAY) % 1.0
    return Z_SPRING + RISE * math.sin(math.pi * t)


def hall_roof(g, xs):
    top = [(x, zr(x)) for x in xs]
    # top: one strip per profile segment along the whole length; the steep band is its own material
    s = 0.0
    for (xa, za), (xb, zb) in zip(top, top[1:]):
        L = math.hypot(xb - xa, zb - za)
        key = "roofband" if xa >= XC - 1e-6 and xb <= XD + 1e-6 else "roof"
        sc = 16.0 if key == "roof" else 8.0
        g.polyn([(xa, -RY, za), (xb, -RY, zb), (xb, RY, zb), (xa, RY, za)], key, (-(zb - za), 0, xb - xa),
                uvs=[(-RY / sc, s / sc), (-RY / sc, (s + L) / sc), (RY / sc, (s + L) / sc), (RY / sc, s / sc)], smooth=key == "roof")
        s += L
    # soffit and ends
    for (xa, za), (xb, zb) in zip(top, top[1:]):
        if xa >= XW and xb <= XE:
            continue
        g.polyn([(xa, -RY, za - ROOF_T), (xb, -RY, zb - ROOF_T), (xb, RY, zb - ROOF_T), (xa, RY, za - ROOF_T)], "soffit", (0, 0, -1))
    for y, sgn in ((-RY, -1), (RY, 1)):
        for (xa, za), (xb, zb) in zip(top, top[1:]):
            g.polyn([(xa, y, za - ROOF_T), (xb, y, zb - ROOF_T), (xb, y, zb), (xa, y, za)], "white", (0, sgn, 0))
    xa, xb = RX1, RX1
    g.polyn([(RX1, -RY, zr(RX1) - ROOF_T), (RX1, RY, zr(RX1) - ROOF_T), (RX1, RY, zr(RX1)), (RX1, -RY, zr(RX1))], "white", (1, 0, 0))
    # the silver tube along the landside eave
    segs = 14
    ring = [(RX0 + 1.35 * math.cos(2 * math.pi * i / segs), Z_EAVE - 0.35 + 1.35 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    a = [g.vert((x, -RY - 0.6, z)) for x, z in ring]
    b = [g.vert((x, RY + 0.6, z)) for x, z in ring]
    for i in range(segs):
        k = (i + 1) % segs
        g.face((a[i], b[i], b[k], a[k]), "tube", smooth=True)
    g.poly([(x, -RY - 0.6, z) for x, z in ring], "tube")
    g.poly([(x, RY + 0.6, z) for x, z in ring][::-1], "tube")


def hall_walls(g, xs, detail=True):
    soff = lambda x: zr(x) - ROOF_T  # noqa: E731
    # landside: glass above the kerb, the arrivals wall set back below it
    g.polyn([(XW, -HY, KERB), (XW, HY, KERB), (XW, HY, soff(XW)), (XW, -HY, soff(XW))], "glass", (-1, 0, 0),
            uvs=[(0, KERB), (2 * HY, KERB), (2 * HY, soff(XW)), (0, soff(XW))])
    g.polyn([(XWG, -HY, 0.0), (XWG, HY, 0.0), (XWG, HY, SLAB_B), (XWG, -HY, SLAB_B)], "lobby", (-1, 0, 0),
            uvs=[(0, 0), (2 * HY, 0), (2 * HY, SLAB_B), (0, SLAB_B)])
    # airside: glass lounges between white bands
    for z0, z1, key in ((0.0, 0.8, "white"), (0.8, 4.4, "band"), (4.4, 6.2, "white"), (6.2, soff(XE) - 0.6, "glass"), (soff(XE) - 0.6, soff(XE), "white")):
        g.polyn([(XE, -HY, z0), (XE, HY, z0), (XE, HY, z1), (XE, -HY, z1)], key, (1, 0, 0), uvs=[(0, z0), (2 * HY, z0), (2 * HY, z1), (0, z1)])
    # the two ends under the roof's section: white below 8 m, glass above
    for y, sgn in ((-HY, -1), (HY, 1)):
        pts = [x for x in xs if XW <= x <= XE]
        for xa, xb in zip(pts, pts[1:]):
            g.polyn([(xa, y, 8.0), (xb, y, 8.0), (xb, y, soff(xb)), (xa, y, soff(xa))], "glass", (0, sgn, 0),
                    uvs=[(xa, 8.0), (xb, 8.0), (xb, soff(xb)), (xa, soff(xa))])
        g.polyn([(XWG, y, 0.0), (XE, y, 0.0), (XE, y, 8.0), (XWG, y, 8.0)], "white", (0, sgn, 0))
        g.polyn([(XW, y, KERB), (XWG, y, KERB), (XWG, y, 8.0), (XW, y, 8.0)], "white", (0, sgn, 0))
    # the departure floor's slab edge over the arrivals wall and the kerb deck
    g.box(XW, XWG, -HY, HY, SLAB_B, KERB, "concrete", skip=("+z", "+x", "-x", "-y", "+y"))
    g.box(VIA_IN, XW, DECK_Y0, DECK_Y1, SLAB_B, KERB, "concrete", skip=("+z", "+x"))
    g.polyn([(VIA_IN, DECK_Y0, KERB), (XW, DECK_Y0, KERB), (XW, DECK_Y1, KERB), (VIA_IN, DECK_Y1, KERB)], "pave", (0, 0, 1))
    for y0, y1 in ((-HY, DECK_Y0), (DECK_Y1, HY)):
        g.box(XW - 0.2, XW, y0, y1, SLAB_B, KERB, "concrete", skip=("+z", "-z", "+x"))


def canopy(g, detail=True):
    nseg = 10 if detail else 3
    for b in range(NB):
        ya = DECK_Y0 + BAY * b
        ys = [ya + BAY * i / nseg for i in range(nseg + 1)]
        zs = [Z_SPRING + RISE * math.sin(math.pi * i / nseg) for i in range(nseg + 1)]
        for i in range(nseg):
            y0, y1, z0, z1 = ys[i], ys[i + 1], zs[i], zs[i + 1]
            g.polyn([(CAN_X0, y0, z0 + 0.35), (CAN_X1, y0, z0 + 0.35), (CAN_X1, y1, z1 + 0.35), (CAN_X0, y1, z1 + 0.35)], "canopy", (0, -(z1 - z0), y1 - y0),
                    uvs=[(CAN_X0 / 8, y0 / 8), (CAN_X1 / 8, y0 / 8), (CAN_X1 / 8, y1 / 8), (CAN_X0 / 8, y1 / 8)], smooth=True)
            g.polyn([(CAN_X0, y0, z0), (CAN_X1, y0, z0), (CAN_X1, y1, z1), (CAN_X0, y1, z1)], "under", (0, z1 - z0, -(y1 - y0)),
                    uvs=[(CAN_X0 / 4, y0 / 4), (CAN_X1 / 4, y0 / 4), (CAN_X1 / 4, y1 / 4), (CAN_X0 / 4, y1 / 4)], smooth=True)
            # the scalloped white rim on the road side
            g.polyn([(CAN_X1, y0, z0 - 0.45), (CAN_X1, y1, z1 - 0.45), (CAN_X1, y1, z1 + 0.35), (CAN_X1, y0, z0 + 0.35)], "white", (-1, 0, 0))
            g.polyn([(CAN_X1, y0, z0 - 0.45), (CAN_X1 + 0.6, y0, z0 - 0.45), (CAN_X1 + 0.6, y1, z1 - 0.45), (CAN_X1, y1, z1 - 0.45)], "white", (0, 0, -1))
            g.polyn([(CAN_X1 + 0.6, y0, z0 - 0.45), (CAN_X1 + 0.6, y1, z1 - 0.45), (CAN_X1 + 0.6, y1, z1), (CAN_X1 + 0.6, y0, z0)], "white", (1, 0, 0))
        # bay line: a white arch beam across the canopy (the valley between two vaults)
        if detail:
            g.box(CAN_X1, CAN_X0, ya - 0.3, ya + 0.3, Z_SPRING - 0.7, Z_SPRING + 0.4, "white", skip=("+x",))
    if detail:
        g.box(CAN_X1, CAN_X0, DECK_Y1 - 0.3, DECK_Y1 + 0.3, Z_SPRING - 0.7, Z_SPRING + 0.4, "white", skip=("+x",))


def tree_column_geo():
    """A steel tree column on the kerb: a trunk and four branches up to the canopy's bay line, local to its foot."""
    g = Geo()
    top = (0.0, 0.0, 11.8 - KERB)
    tube(g, (0, 0, 0), top, 0.42, 8, "steel")
    g.box(-0.7, 0.7, -0.7, 0.7, 0.0, 0.35, "steel")
    for x, dy in ((CAN_X0 + 1.0, 0.0), (CAN_X1 + 3.0, 0.0), (TREE_X - 4.0, -5.5), (TREE_X - 4.0, 5.5), (TREE_X + 3.0, -4.0), (TREE_X + 3.0, 4.0)):
        y = DECK_Y0 + dy if dy >= 0 else DECK_Y0 + BAY + dy
        z = vault(y) - 0.2 if dy else Z_SPRING - 0.7
        tube(g, top, (x - TREE_X, dy, z - KERB), 0.2, 6, "steel")
    return g


def kerb_pier_geo():
    g = Geo()
    g.box(-0.4, 0.4, -0.4, 0.4, 0.0, SLAB_B, "concrete", skip=("-z", "+z"))
    return g


def door_geo():
    """A departure entrance in the glass wall: a white portal, dark glazed doors and a blue sign over them."""
    g = Geo()
    g.box(-0.5, 0.0, -3.6, 3.6, 0.0, 4.2, "white", skip=("-z", "+x"))
    g.box(-0.55, -0.45, -3.2, 3.2, 0.0, 3.6, "dark", skip=("-z", "+x"))
    g.box(-0.75, -0.5, -2.4, 2.4, 4.5, 5.3, "sign", skip=("+x",))
    return g


def pier(g, poly, barrel, detail=True):
    bands = ((0.0, 0.6, "white"), (0.6, 4.0, "band"), (4.0, 5.4, "wall"), (5.4, 8.4, "band"), (8.4, PIER_Z, "wall")) if detail else \
            ((0.0, PIER_Z, "wall"),)
    prism_walls(g, poly, bands)
    flat_roof(g, poly, PIER_Z, "flat")
    x0, x1, y0, y1 = barrel
    hw, yc = (y1 - y0) / 2, (y1 + y0) / 2
    R = (hw * hw + BARREL_RISE * BARREL_RISE) / (2 * BARREL_RISE)
    n = 12 if detail else 4
    ys = [y0 + (y1 - y0) * i / n for i in range(n + 1)]
    zs = [PIER_Z + math.sqrt(max(0.0, R * R - (y - yc) ** 2)) - (R - BARREL_RISE) for y in ys]
    s = 0.0
    for i in range(n):
        L = math.hypot(ys[i + 1] - ys[i], zs[i + 1] - zs[i])
        g.polyn([(x0, ys[i], zs[i]), (x1, ys[i], zs[i]), (x1, ys[i + 1], zs[i + 1]), (x0, ys[i + 1], zs[i + 1])], "pierroof",
                (0, -(zs[i + 1] - zs[i]), ys[i + 1] - ys[i]), uvs=[(x0 / 8, s / 8), (x1 / 8, s / 8), (x1 / 8, (s + L) / 8), (x0 / 8, (s + L) / 8)], smooth=True)
        s += L
    # glazed gables (the barrel's ends) with a white rim
    for x, sgn in ((x0, -1), (x1, 1)):
        pts = [(x, y, z) for y, z in zip(ys, zs)]
        g.polyn(pts, "band" if detail else "wall", (sgn, 0, 0), uvs=[(y, z) for _, y, z in pts])
        if detail:
            for i in range(n):
                g.polyn([(x, ys[i], zs[i]), (x, ys[i + 1], zs[i + 1]), (x + sgn * 0.5, ys[i + 1], zs[i + 1] + 0.1), (x + sgn * 0.5, ys[i], zs[i] + 0.1)], "white", (0, 0, 1))


def low_block(g, poly, z, detail=True):
    bands = ((0.0, 0.6, "white"), (0.6, 4.0, "band"), (4.0, 5.6, "wall"), (5.6, z - 2.2, "band"), (z - 2.2, z, "wall")) if detail else ((0.0, z, "wall"),)
    prism_walls(g, poly, bands)
    flat_roof(g, poly, z, "flat")


def build_t2():
    clear_file()
    ensure_addon()
    M = t2_materials()
    main = collection("首都机场2号航站楼")
    det = collection("航站楼", main)
    xs = profile()

    g = Geo()
    hall_roof(g, xs)
    hall_walls(g, xs)
    canopy(g)
    pier(g, PIER_N, BARRELS[0])
    pier(g, PIER_S, BARRELS[1])
    low_block(g, NECK_N, NECK_Z)
    low_block(g, NECK_S, NECK_Z)
    low_block(g, NE_BOX, NE_Z)
    g.build("T2", det, M, TILE)
    tris = g.tris()

    parts = collection("构件", main)
    ys = [DECK_Y0 + BAY * k for k in range(NB + 1)]
    me = mesh_of(tree_column_geo(), "TreeColumn", M, TILE)
    for k, y in enumerate(ys):
        place(me, f"TreeColumn.{k:02d}", parts, T(TREE_X, y, KERB))
    tris += tree_column_geo().tris() * len(ys)
    me = mesh_of(kerb_pier_geo(), "KerbPier", M, TILE)
    for k, y in enumerate(ys):
        place(me, f"KerbPier.{k:02d}", parts, T(PIER_X, y, 0.0))
    me = mesh_of(door_geo(), "Door", M, TILE)
    for k in range(NB):
        place(me, f"Door.{k:02d}", parts, T(XW, DECK_Y0 + BAY * (k + 0.5), KERB))
    tris += door_geo().tris() * NB

    font = load_font()
    letters = collection("字", main)
    # 北京 in red on the steep airside band, facing the apron
    zb = 0.5 * (Z_CREST + Z_LOW)
    xb = 0.5 * (XC + XD) + 1.2
    for ch, y in (("北", -92.0), ("京", -20.0)):
        tris += text_mesh(font, ch, 8.0, f"Beijing_{ch}", M["red"], letters, facing((xb, y, zb + 1.5), (1, 0)), extrude=0.4)
    # the terminal's name over the kerb, on the eave tube's face
    tris += text_mesh(font, "2号航站楼  TERMINAL 2", 1.5, "NameWest", M["white"], letters, facing((XW - 0.6, -10.0, 11.2), (-1, 0)), extrude=0.08)

    far = collection("LOD1", main)
    f = Geo()
    fx = profile(5, 2)
    hall_roof(f, fx)
    f.polyn([(XW, -HY, 0.0), (XW, HY, 0.0), (XW, HY, zr(XW) - ROOF_T), (XW, -HY, zr(XW) - ROOF_T)], "glass", (-1, 0, 0),
            uvs=[(0, 0), (2 * HY, 0), (2 * HY, zr(XW)), (0, zr(XW))])
    f.polyn([(XE, -HY, 0.0), (XE, HY, 0.0), (XE, HY, zr(XE) - ROOF_T), (XE, -HY, zr(XE) - ROOF_T)], "glass", (1, 0, 0),
            uvs=[(0, 0), (2 * HY, 0), (2 * HY, zr(XE)), (0, zr(XE))])
    for y, sgn in ((-HY, -1), (HY, 1)):
        pts = [x for x in fx if XW <= x <= XE]
        f.polyn([(XE, y, 0.0), (XW, y, 0.0)] + [(x, y, zr(x) - ROOF_T) for x in pts], "glass", (0, sgn, 0),
                uvs=[(XE, 0), (XW, 0)] + [(x, zr(x)) for x in pts])
    canopy(f, detail=False)
    pier(f, PIER_N, BARRELS[0], detail=False)
    pier(f, PIER_S, BARRELS[1], detail=False)
    low_block(f, NECK_N, NECK_Z, detail=False)
    low_block(f, NECK_S, NECK_Z, detail=False)
    low_block(f, NE_BOX, NE_Z, detail=False)
    f.build("Far", far, M, TILE)
    far_tris = f.tris()

    helpers = collection("碰撞体")
    collider_box(helpers, "arrivals", XWG, XE, -HY, HY, 0.0, KERB)
    collider_box(helpers, "hall", XW, XE, -HY, HY, KERB, 19.5)
    pts = [(x, y, zr(x)) for x in profile(6, 3) for y in (-RY, RY)] + [(x, y, 18.0) for x in (RX0, RX1) for y in (-RY, RY)]
    collider_pts(helpers, "roof", pts)
    collider_box(helpers, "kerb", VIA_IN, XW, DECK_Y0, DECK_Y1, SLAB_B, KERB)
    for k, y in enumerate(ys):
        collider_box(helpers, f"kpier{k}", PIER_X - 0.4, PIER_X + 0.4, y - 0.4, y + 0.4, 0.0, SLAB_B)
        collider_box(helpers, f"tree{k}", TREE_X - 0.45, TREE_X + 0.45, y - 0.45, y + 0.45, KERB, 11.5)
    for nm, poly, z in (("neck_n", NECK_N, NECK_Z), ("neck_s", NECK_S, NECK_Z)):
        x0, x1 = min(p[0] for p in poly), max(p[0] for p in poly)
        y0, y1 = min(p[1] for p in poly), max(p[1] for p in poly)
        collider_box(helpers, nm, x0, x1, y0, y1, 0.0, z)
    collider_pts(helpers, "ne_box", [(x, y, z) for x, y in [(81.0, 133.0)] + NE_BOX[1:5] for z in (0.0, NE_Z)])
    collider_pts(helpers, "ne_box2", [(x, y, z) for x, y in [NE_BOX[0], (81.5, 133.0), (81.5, 154.6), NE_BOX[6]] for z in (0.0, NE_Z)])
    for nm, parts_, barrel in (("pier_n", PIER_N_PARTS, BARRELS[0]), ("pier_s", PIER_S_PARTS, BARRELS[1])):
        for i, poly in enumerate(parts_):
            collider_pts(helpers, f"{nm}{i}", [(x, y, z) for x, y in poly for z in (0.0, PIER_Z)])
        x0, x1, y0, y1 = barrel
        collider_pts(helpers, f"{nm}_roof", [(x, y, z) for x in (x0, x1) for y, z in ((y0, PIER_Z), (y1, PIER_Z), ((y0 + y1) / 2, PIER_Z + BARREL_RISE))])

    for nm, poly in (("hall", rect(XW, XE, -HY, HY)), ("neck_n", NECK_N), ("neck_s", NECK_S), ("ne_box", NE_BOX)):
        flat_marker(helpers, nm, poly, "FOOTPRINT")
    for nm, parts_ in (("pier_n", PIER_N_PARTS), ("pier_s", PIER_S_PARTS)):
        for i, poly in enumerate(parts_):
            flat_marker(helpers, f"{nm}{i}", poly, "FOOTPRINT")
    # trees, lamps and street furniture off the kerb deck, from under the canopies and from the building
    flat_marker(helpers, "kerb", rect(CAN_X1 - 1.0, XWG, DECK_Y0 - 3.0, DECK_Y1 + 3.0), "CLEAR")
    flat_marker(helpers, "hall", rect(XW, XE + 2.0, -RY, RY), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "t2", "首都机场2号航站楼", "Beijing Capital Airport Terminal 2"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", T2_GX, T2_GZ, T2_HEADING
    s.far_distance = 1200
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris)


# ======================================================================================================
# T1 (T2 西区卫星厅)
# ======================================================================================================

T1_GX, T1_GZ, T1_HEADING = 15765.0, -19045.0, -7.09
B0X, B1X, B0Y, B1Y = -101.0, 94.2, -45.8, 66.7      # the main block
T1_Z = 17.0                                         # its eave (the white cornice from 13.2 m)
RAISE = rect(-62.0, 54.0, -22.0, 48.0)
RAISE_Z = 21.5
LINK = [(-59.6, 66.0), (47.4, 66.0), (42.8, 75.6), (42.9, 95.9), (-53.7, 96.7), (-53.9, 76.2)]
COR_W = [(-91.5, 66.0), (-59.3, 66.0), (-109.0, 144.5), (-122.5, 134.0), (-120.0, 111.2)]
COR_E = [(47.7, 66.0), (82.1, 70.3), (109.7, 109.1), (115.5, 131.0), (102.0, 141.0)]
SATS = [(-130.5, 158.3), (120.3, 155.6)]
SAT_R, SAT_Z, SAT_R2, SAT_Z2 = 26.0, 9.5, 15.0, 14.0
LOW_Z = 9.0


def t1_materials():
    gl = dict(frame="#e4e6e6", mull=0.05, slab=0.07, metal=0.7, rough=0.1, warm="#ffdcae", coolShare=0.35)
    return dict(
        glass=facade("PEK1_Glass", dict(gl, floorH=6.5, colW=2.1, glass="#4b7491", spandrel="#d9dddf", lit=0.55, seed=31)),
        band=facade("PEK1_Band", dict(gl, floorH=3.6, colW=1.8, glass="#4e7385", spandrel="#d8dddd", lit=0.6, seed=32)),
        white=material("PEK1_White", "#e9ebea", 0.5, metal=0.1, props={"wet": "surface", "glowStrength": 0.8}),
        cornice=material("PEK1_Cornice", "#eef0ef", 0.4, metal=0.2, tex=seamed("PEK1_CorniceTex", 128, "#eef0ef", "#cfd4d4", 32, seed=6),
                         props={"wet": "surface", "glowStrength": 0.9}),
        roof=material("PEK1_Roof", "#a35a43", 0.75, tex=terracotta(), props={"wet": "surface", "glow": "none"}),
        canopy=material("PEK1_Canopy", "#f0f1f1", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#ffe2b8", "glowStrength": 0.3}),
        steel=material("PEK1_Steel", "#c9ced2", 0.35, metal=0.6, props={"wet": "surface", "glowStrength": 0.6}),
        red=material("PEK_Red", "#c8202a", 0.45, props={"wet": "surface", "glow": "lamp", "glowColor": "#ff4a3a", "glowStrength": 0.9}),
    )


T1_TILE = dict(white=3.0, steel=2.0, canopy=3.0, roof=16.0)


def pilasters(g, a, b, z0, z1, every, out):
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    t = d / L
    o = Vector(out) * 0.6
    n = int(L / every)
    for i in range(1, n):
        p = a + t * (L * i / n)
        q0, q1 = p - t * 0.45, p + t * 0.45
        pts = [(q0.x, q0.y), (q1.x, q1.y), (q1.x + o.x, q1.y + o.y), (q0.x + o.x, q0.y + o.y)]
        for i2 in range(4):
            u, v = pts[i2], pts[(i2 + 1) % 4]
            if i2 == 0:
                continue
            e = Vector((v[0] - u[0], v[1] - u[1]))
            g.polyn([(u[0], u[1], z0), (v[0], v[1], z0), (v[0], v[1], z1), (u[0], u[1], z1)], "white", (e.y, -e.x, 0))


def cornice(g, poly, z0, z1, lean):
    """A white sloped cornice band round a rectangle: its top `lean` m further out than its foot."""
    poly = ccw(poly)
    n = len(poly)
    cx, cy = sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n
    def outp(p, k):
        d = Vector((p[0] - cx, p[1] - cy))
        return (p[0] + math.copysign(k, d.x), p[1] + math.copysign(k, d.y))
    u = 0.0
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        a1, b1 = outp(a, lean), outp(b, lean)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        d = (b[0] - a[0], b[1] - a[1])
        g.polyn([(a[0], a[1], z0), (b[0], b[1], z0), (b1[0], b1[1], z1), (a1[0], a1[1], z1)], "cornice", (d[1], -d[0], 0.3),
                uvs=[(u / 4, 0), ((u + L) / 4, 0), ((u + L + lean) / 4, 1), ((u - lean) / 4, 1)])
        g.polyn([(a1[0], a1[1], z1), (b1[0], b1[1], z1), (b[0], b[1], z1), (a[0], a[1], z1)], "white", (0, 0, 1))
        u += L


def drum(g, x, y, r, z0, z1, bands, segs):
    ring = [(x + r * math.cos(2 * math.pi * i / segs), y + r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    prism_walls(g, ring, bands)
    return ring


def build_t1():
    clear_file()
    ensure_addon()
    M = t1_materials()
    main = collection("首都机场T2西区卫星厅")
    det = collection("航站楼", main)

    def body(g, detail):
        blk = rect(B0X, B1X, B0Y, B1Y)
        if detail:
            prism_walls(g, blk, ((0.0, 0.7, "white"), (0.7, 13.2, "glass")))
            cornice(g, blk, 13.2, T1_Z, 0.9)
            for (a, b, out) in (((B0X, B0Y), (B1X, B0Y), (0, -1)), ((B1X, B1Y), (B0X, B1Y), (0, 1)), ((B1X, B0Y), (B1X, B1Y), (1, 0)), ((B0X, B1Y), (B0X, B0Y), (-1, 0))):
                pilasters(g, a, b, 0.0, 13.2, 8.6, out)
            # the departure canopy over the kerb (the viaduct passes 1.7 m off the wall): white, 5 m over the deck
            g.box(-70.0, 70.0, B0Y - 1.6, B0Y, 11.6, 12.2, "canopy")
            for x in (-60.0, -30.0, 0.0, 30.0, 60.0):
                tube(g, (x, B0Y - 0.05, 15.5), (x, B0Y - 1.5, 12.2), 0.08, 4, "steel")
        else:
            prism_walls(g, blk, ((0.0, T1_Z, "glass"),))
        flat_roof(g, rect(B0X - (0.9 if detail else 0), B1X + (0.9 if detail else 0), B0Y - (0.9 if detail else 0), B1Y + (0.9 if detail else 0)), T1_Z, "roof")
        prism_walls(g, RAISE, ((T1_Z, RAISE_Z - 1.2, "band"), (RAISE_Z - 1.2, RAISE_Z, "white")) if detail else ((T1_Z, RAISE_Z, "white"),))
        flat_roof(g, RAISE, RAISE_Z, "roof")
        for poly, z in ((LINK, LOW_Z + 1.0), (COR_W, LOW_Z), (COR_E, LOW_Z)):
            prism_walls(g, poly, ((0.0, 0.6, "white"), (0.6, 3.8, "band"), (3.8, 5.0, "white"), (5.0, z - 1.4, "band"), (z - 1.4, z, "white")) if detail else ((0.0, z, "white"),))
            flat_roof(g, poly, z, "roof")
        segs = 32 if detail else 12
        for x, y in SATS:
            ring = drum(g, x, y, SAT_R, 0.0, SAT_Z, ((0.0, 0.6, "white"), (0.6, 4.6, "band"), (4.6, SAT_Z, "white")) if detail else ((0.0, SAT_Z, "white"),), segs)
            flat_roof(g, ring, SAT_Z, "roof")
            ring2 = drum(g, x, y, SAT_R2, SAT_Z, SAT_Z2, ((SAT_Z, SAT_Z + 1.2, "white"), (SAT_Z + 1.2, SAT_Z2 - 1.0, "band"), (SAT_Z2 - 1.0, SAT_Z2, "white")) if detail else ((SAT_Z, SAT_Z2, "white"),), segs)
            flat_roof(g, ring2, SAT_Z2, "roof")
            if detail:
                cyl(g, x, y, SAT_Z2, SAT_Z2 + 2.2, 5.0, 5.0, 16, "white")

    g = Geo()
    body(g, True)
    g.build("T1", det, M, T1_TILE)
    tris = g.tris()

    font = load_font()
    letters = collection("字", main)
    for ch, x in (("北", -12.0), ("京", 20.0)):
        tris += text_mesh(font, ch, 5.0, f"Beijing_{ch}", M["red"], letters, facing((x, B0Y + 2.0, T1_Z + 2.7), (0, -1)), extrude=0.3)

    far = collection("LOD1", main)
    f = Geo()
    body(f, False)
    f.build("Far", far, M, T1_TILE)
    far_tris = f.tris()

    helpers = collection("碰撞体")
    collider_box(helpers, "block", B0X, B1X, B0Y, B1Y, 0.0, T1_Z)
    collider_box(helpers, "raise", RAISE[0][0], RAISE[1][0], RAISE[0][1], RAISE[2][1], T1_Z, RAISE_Z)
    collider_pts(helpers, "link", [(x, y, z) for x, y in LINK for z in (0.0, LOW_Z + 1.0)])
    collider_pts(helpers, "cor_w", [(x, y, z) for x, y in COR_W for z in (0.0, LOW_Z)])
    collider_pts(helpers, "cor_e", [(x, y, z) for x, y in COR_E for z in (0.0, LOW_Z)])
    for i, (x, y) in enumerate(SATS):
        collider_pts(helpers, f"sat{i}", [(x + SAT_R * math.cos(2 * math.pi * k / 16), y + SAT_R * math.sin(2 * math.pi * k / 16), z) for k in range(16) for z in (0.0, SAT_Z)])
        collider_pts(helpers, f"sat{i}top", [(x + SAT_R2 * math.cos(2 * math.pi * k / 12), y + SAT_R2 * math.sin(2 * math.pi * k / 12), z) for k in range(12) for z in (SAT_Z, SAT_Z2)])
    for nm, poly in (("block", rect(B0X, B1X, B0Y, B1Y)), ("link", LINK), ("cor_w", COR_W), ("cor_e", COR_E)):
        flat_marker(helpers, nm, poly, "FOOTPRINT")
    for i, (x, y) in enumerate(SATS):
        flat_marker(helpers, f"sat{i}", [(x + (SAT_R + 0.5) * math.cos(2 * math.pi * k / 16), y + (SAT_R + 0.5) * math.sin(2 * math.pi * k / 16)) for k in range(16)], "FOOTPRINT")
    flat_marker(helpers, "block", rect(B0X, B1X + 1.0, B0Y, B1Y + 1.0), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "t1", "首都机场T2西区卫星厅（原1号航站楼）", "Capital Airport T2 West Satellite (former Terminal 1)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", T1_GX, T1_GZ, T1_HEADING
    s.far_distance = 800
    s.repo_path = REPO
    return dict(tris=tris, far=far_tris)


if __name__ == "__main__":
    print("built", build_t2() if WHICH == "t2" else build_t1())
    save_and_export(OUT, argv)
