# 国家游泳中心「水立方」(冰立方 since the 2022 Winter Games) - National Aquatics Center (PTW / CSCEC / Arup,
# 2008), built in Blender, marked with the bcity_landmark add-on's conventions. OSM way 29201257 (height 40,
# building:colour #8caee3) on 天辰东路 in 奥林匹克公园, west of the central axis; the city drew it as a 40 m
# block. Its outline is a 181.5 x 179.9 m square turned 2.42 degrees off north (the Olympic axis), the centre
# of its box at game (-1143.95, -9211.48) = 39.9915785 N, 116.3841726 E. The north 48 m of it lies past the
# built tiles' edge (z -9258.4): the model stands there all the same, on the city's ground plane.
#
#   blender -b -P scripts/blender/landmarks/watercube.py -- [--out art/landmarks/watercube.blend] [--export]
#
# The real figures: a 177 x 177 m box, 31 m above the plaza (OSM's 40 counts the pool basement), the walls and
# roof a 3.6 m deep space frame cut from Weaire-Phelan foam, clad in ~3,000 pale blue ETFE cushions of every
# size (the largest ~9 m) - the steel is hidden, only the cushions' white edges read. Here: the box with a drawn
# bubble atlas (a power-diagram foam on a torus, 32 m a repeat: cushions tinted one by one, shaded as pillows by
# the distance to their edge, white seams, a normal map from the same pillows; at night each cushion glows blue,
# brightest in its middle, `emit: night`). The entrances are cut into the skin: the main one in the east face
# (towards the central axis and the Bird's Nest) 36 x 7 m, 4.5 m deep, and one in the south face, 20 x 6 m, each
# a recess lined with cushions and closed by a glazed front (the kit's curtain-wall shader, lit at night); over
# the east one 国家游泳中心 and NATIONAL AQUATICS CENTER, over the south one 冰立方 (STHeiti, lit at night).
# It stands on a 0.6 m granite plinth 6 m wide all round, four steps up to each entrance (walk-only ramps), on a
# paved plaza out to the streets (天辰西路 ~11 m west, 天辰东路 ~25 m east, the park's footway south; nothing is built north).
# Doubtful: which faces carry the entrances and lettering (east and south chosen); the plinth's height.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Geo, T, collider_box, flat_marker, paving, rect  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "watercube.blend")
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_FALLBACK = os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")

GX, GZ, HEADING = -1143.95, -9211.48, -2.42
HALF, H = 88.5, 31.0                # the box: 177 m square, 31 m high
PLINTH, PL_W = 0.6, 6.0             # plinth height and how far it runs out from the walls
PL = HALF + PL_W                    # the plinth's half size
STEP_N, STEP_D = 4, 0.42            # steps up to the plinth at each entrance
REP = 32.0                          # metres per bubble texture repeat
PLAZA = (-97.5, 110.0, -101.0, 104.0)  # paved out to the streets and the park footway (x0, x1, y0, y1)
# entrances: side, centre along the face (from the face's middle), width, height, depth
DOORS = [("e", 0.0, 36.0, 7.0, 4.5), ("s", 0.0, 20.0, 6.0, 4.5)]

# the four faces counter-clockwise: start corner, direction along, outward normal
FACES = {
    "s": (Vector((-HALF, -HALF)), Vector((1, 0)), Vector((0, -1))),
    "e": (Vector((HALF, -HALF)), Vector((0, 1)), Vector((1, 0))),
    "n": (Vector((HALF, HALF)), Vector((-1, 0)), Vector((0, 1))),
    "w": (Vector((-HALF, HALF)), Vector((0, -1)), Vector((-1, 0))),
}
ORDER = ["s", "e", "n", "w"]


# ---- textures ----------------------------------------------------------------------------------------------

def foam(size, rep, seed=7):
    """A power diagram on a torus: cushion sites of mixed sizes thrown largest first; per pixel the nearest site,
    its index and the distance to the cell's nearest edge (metres). Rows run up the texture (v)."""
    rng = np.random.default_rng(seed)
    sites, rads = [], []
    cands = np.sort(rng.uniform(1.1, 4.2, 9000) ** 1.0)[::-1]
    for r in cands:
        p = rng.uniform(0, rep, 2)
        if sites:
            S = np.array(sites)
            d = np.abs(S - p)
            d = np.minimum(d, rep - d)
            dist = np.hypot(d[:, 0], d[:, 1])
            if np.any(dist < (np.array(rads) + r) * 0.82):
                continue
        sites.append(p)
        rads.append(r)
    S, R = np.array(sites), np.array(rads)
    n = len(S)
    # replicas of the sites near the tile's edges
    P, W, I = [], [], []
    for ox in (-rep, 0, rep):
        for oy in (-rep, 0, rep):
            Q = S + (ox, oy)
            keep = (Q[:, 0] > -9) & (Q[:, 0] < rep + 9) & (Q[:, 1] > -9) & (Q[:, 1] < rep + 9)
            P.append(Q[keep])
            W.append(R[keep])
            I.append(np.nonzero(keep)[0])
    P, W, I = np.concatenate(P), np.concatenate(W), np.concatenate(I)
    w = 0.55 * W ** 2                         # power weights: big sites get big cells
    ppm = size / rep
    u = (np.arange(size) + 0.5) / ppm
    cell = np.zeros((size, size), np.int32)
    edge = np.zeros((size, size), np.float32)
    rows = 16
    for r0 in range(0, size, rows):
        vy = u[r0:r0 + rows]
        X = np.broadcast_to(u[None, :], (len(vy), size))
        Y = np.broadcast_to(vy[:, None], (len(vy), size))
        f = (X[..., None] - P[:, 0]) ** 2 + (Y[..., None] - P[:, 1]) ** 2 - w
        i1 = np.argmin(f, axis=2)
        f1 = np.take_along_axis(f, i1[..., None], 2)[..., 0]
        np.put_along_axis(f, i1[..., None], np.inf, 2)
        i2 = np.argmin(f, axis=2)
        f2 = np.take_along_axis(f, i2[..., None], 2)[..., 0]
        sep = np.hypot(P[i1, 0] - P[i2, 0], P[i1, 1] - P[i2, 1])
        edge[r0:r0 + rows] = (f2 - f1) / (2 * np.maximum(sep, 1e-6))
        cell[r0:r0 + rows] = I[i1]
    return cell, edge, n


def bubble_images(size=1024):
    """Colour, normal and night maps of the ETFE cushions, one repeat REP metres square."""
    cell, edge, n = foam(size, REP)
    rng = np.random.default_rng(11)
    tint = rng.uniform(0.9, 1.07, n).astype(np.float32)
    hue = rng.uniform(-1, 1, n).astype(np.float32)
    seam, fold = 0.07, 0.22
    inr = np.zeros(n, np.float32)                     # each cushion's inradius: how far its middle is from a seam
    np.maximum.at(inr, cell.ravel(), edge.ravel())
    h = np.clip((edge - seam) / np.maximum(inr[cell] - seam, 0.2), 0, 1)
    pillow = np.sqrt(1 - (1 - h) ** 2)                # a round dome: 0 at the seam, 1 in a cushion's middle
    # the distance to the nearest seam has a ridge along each cushion's skeleton (pyramids): blur it on the torus
    ppm = size / REP
    k = np.fft.fftfreq(size)
    sig = 0.45 * ppm
    G = np.exp(-2 * (np.pi * sig) ** 2 * (k[:, None] ** 2 + k[None, :] ** 2))
    pillow = np.real(np.fft.ifft2(np.fft.fft2(pillow) * G)).astype(np.float32)
    pillow = np.clip(pillow * (edge > seam), 0, 1)
    base = srgb("#8db6dc")
    col = base[None, None, :] * (0.86 + 0.17 * pillow)[..., None] * tint[cell][..., None]
    col[..., 0] *= 1 + 0.05 * hue[cell]               # some cushions greener, some more violet
    col[..., 1] *= 1 + 0.02 * hue[cell]
    infold = (edge >= seam) & (edge < fold)
    col[infold] *= 0.93
    col[edge < seam] = srgb("#e9f1f5")
    noise = 1 + 0.035 * (rng.random((size, size)) - 0.5)
    col *= noise[..., None]
    # normals from the pillow height, wrapped so the tile repeats
    hgt = 0.16 * pillow * np.minimum(inr[cell], 2.5)
    du = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * ppm / 2
    dv = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * ppm / 2
    nrm = np.stack([-du, -dv, np.ones_like(du)], axis=2)
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    nrm = nrm * 0.5 + 0.5
    # night: each cushion lit blue from inside, brightest in the middle, seams dark
    glow = srgb("#0050ff")[None, None, :] * (0.3 + 0.25 * pillow)[..., None] * (0.85 + 0.3 * (tint[cell] - 0.9))[..., None]
    glow[edge < seam] *= 0.25
    return (image("WC_Bubbles", col.astype(np.float32)), image("WC_BubblesN", nrm.astype(np.float32)),
            image("WC_BubblesNight", glow.astype(np.float32)))


def granite_image(size=256):
    rng = np.random.default_rng(5)
    a = np.empty((size, size, 3), np.float32)
    a[:] = srgb("#b9b8b3")
    a *= (0.92 + 0.16 * rng.random((size, size, 1))).astype(np.float32)
    v = np.arange(size)
    a[(v % (size // 2)) < 2, :] *= 0.75             # a joint every 1 m (2 m a repeat)
    a[:, (v % (size // 2)) < 2] *= 0.75
    return image("WC_Granite", a)


def materials():
    col, nrm, night = bubble_images()
    glass_spec = dict(floorH=3.5, colW=2.0, glass="#4f6372", frame="#c9d0d4", spandrel="#c9d0d4", mull=0.05, slab=0.06,
                      metal=0.7, rough=0.08, lit=0.7, warm="#ffd9a8", coolShare=0.2, seed=29)
    return dict(
        etfe=material("WC_ETFE", "#8db6dc", 0.22, metal=0.3, tex=col, emit_tex=night, normal_tex=nrm, normal_strength=0.8,
                      props={"wet": "surface", "glow": "none", "emit": "night"}),
        granite=material("WC_Granite", "#b9b8b3", 0.7, tex=granite_image(), props={"wet": "ground", "glowStrength": 0.4}),
        pave=material("WC_Paving", "#b3afa6", 0.75, tex=paving(), props={"wet": "ground", "glow": "none", "layer": 8}),
        glass=material("WC_Glass", "#8a9aa8", 0.1, metal=0.7, props={"facade": json.dumps(glass_spec), "wet": "surface", "glow": "none"}),
        frame=material("WC_Frame", "#c9d0d4", 0.35, metal=0.8, props={"wet": "surface", "glow": "none"}),
        letters=material("WC_Letters", "#f4f7f9", 0.4, props={"wet": "surface", "glow": "lamp", "glowColor": "#dcecff", "glowStrength": 0.8}),
    )


TILE = dict(granite=2.0, pave=4.0, frame=2.0, etfe=REP)


# ---- the box -----------------------------------------------------------------------------------------------

def P3(p2, z):
    return (p2.x, p2.y, z)


def skin(g, key="etfe", z0=PLINTH):
    """The four walls, cut for the entrances and lined into their recesses, and the roof; UVs in REP repeats,
    running on round the corners so the foam does not break there."""
    doors = {s: (c, w, h, d) for s, c, w, h, d in DOORS}
    S = 2 * HALF
    for k, side in enumerate(ORDER):
        a, t, nrm = FACES[side]
        u0 = k * S

        def quad(s0, s1, za, zb, off=0.0, uoff=0.0):
            pa, pb = a + t * s0 - nrm * off, a + t * s1 - nrm * off
            uv = [((u0 + uoff + s0) / REP, za / REP), ((u0 + uoff + s1) / REP, za / REP),
                  ((u0 + uoff + s1) / REP, zb / REP), ((u0 + uoff + s0) / REP, zb / REP)]
            g.polyn([P3(pa, za), P3(pb, za), P3(pb, zb), P3(pa, zb)], key, (nrm.x, nrm.y, 0), uvs=uv)

        if side not in doors:
            quad(0.0, S, z0, H)
            continue
        c, w, h, d = doors[side]
        s0, s1, top = HALF + c - w / 2, HALF + c + w / 2, z0 + h
        quad(0.0, s0, z0, H)
        quad(s1, S, z0, H)
        quad(s0, s1, top, H)
        # the recess: its two sides, the soffit, the floor; the glazed front at the back
        for s, sgn in ((s0, 1), (s1, -1)):
            pa, pb = a + t * s, a + t * s - nrm * d
            g.polyn([P3(pa, z0), P3(pb, z0), P3(pb, top), P3(pa, top)], key, (t.x * sgn, t.y * sgn, 0),
                    uvs=[(0, z0 / REP), (d / REP, z0 / REP), (d / REP, top / REP), (0, top / REP)])
        ca, cb = a + t * s0, a + t * s1
        cc, cd = cb - nrm * d, ca - nrm * d
        g.polyn([P3(ca, top), P3(cb, top), P3(cc, top), P3(cd, top)], key, (0, 0, -1),
                uvs=[(s0 / REP, 0), (s1 / REP, 0), (s1 / REP, d / REP), (s0 / REP, d / REP)])
        g.polyn([P3(ca, z0), P3(cb, z0), P3(cc, z0), P3(cd, z0)], "granite", (0, 0, 1))
        g.polyn([P3(cd, z0), P3(cc, z0), P3(cc, top), P3(cd, top)], "glass", (nrm.x, nrm.y, 0),
                uvs=[(0, 0), (w, 0), (w, h), (0, h)])
        # the glazed front's frame: a head and two jambs
        for q0, q1 in ((cd, cd + t * 0.4), (cc - t * 0.4, cc)):
            lo, hi = Vector((min(q0.x, q1.x), min(q0.y, q1.y))), Vector((max(q0.x, q1.x), max(q0.y, q1.y)))
            o = nrm * 0.25
            g.box(min(lo.x, lo.x + o.x), max(hi.x, hi.x + o.x), min(lo.y, lo.y + o.y), max(hi.y, hi.y + o.y), z0, top, "frame", skip=("-z",))
        # glass doors' transoms every 6 m read through the facade shader; a canopy-less recess, as on the photos
    # the roof
    g.polyn([(-HALF, -HALF, H), (HALF, -HALF, H), (HALF, HALF, H), (-HALF, HALF, H)], key, (0, 0, 1),
            uvs=[(-HALF / REP, -HALF / REP), (HALF / REP, -HALF / REP), (HALF / REP, HALF / REP), (-HALF / REP, HALF / REP)])


def plinth(g):
    """The granite plinth: its top as a ring round the box, its outer faces, and the steps at each entrance."""
    z = PLINTH
    g.polyn([(-PL, -PL, z), (PL, -PL, z), (PL, -HALF, z), (-PL, -HALF, z)], "granite", (0, 0, 1))
    g.polyn([(-PL, HALF, z), (PL, HALF, z), (PL, PL, z), (-PL, PL, z)], "granite", (0, 0, 1))
    g.polyn([(-PL, -HALF, z), (-HALF, -HALF, z), (-HALF, HALF, z), (-PL, HALF, z)], "granite", (0, 0, 1))
    g.polyn([(HALF, -HALF, z), (PL, -HALF, z), (PL, HALF, z), (HALF, HALF, z)], "granite", (0, 0, 1))
    for side in ORDER:
        a, t, nrm = FACES[side]
        pa = a * (PL / HALF)
        pb = pa + t * (2 * PL)
        g.polyn([(pa.x, pa.y, 0.0), (pb.x, pb.y, 0.0), (pb.x, pb.y, z), (pa.x, pa.y, z)], "granite", (nrm.x, nrm.y, 0))
    for side, c, w, h, d in DOORS:
        a, t, nrm = FACES[side]
        mid = a * (PL / HALF) + t * (PL + c)
        sw = w / 2 + 3.0
        for i in range(STEP_N):
            zt = PLINTH * (STEP_N - i) / STEP_N
            off0, off1 = i * STEP_D, (i + 1) * STEP_D
            p0, p1 = mid + nrm * off0, mid + nrm * off1
            q = [p0 - t * sw, p0 + t * sw, p1 + t * sw, p1 - t * sw]
            xs, ys = [p.x for p in q], [p.y for p in q]
            g.box(min(xs), max(xs), min(ys), max(ys), 0.0, zt, "granite", skip=("-z",))


def plaza(g):
    x0, x1, y0, y1 = PLAZA
    z = 0.03
    for a, b, c, d in ((x0, x1, y0, -PL), (x0, x1, PL, y1), (x0, -PL, -PL, PL), (PL, x1, -PL, PL)):
        g.polyn([(a, c, z), (b, c, z), (b, d, z), (a, d, z)], "pave", (0, 0, 1))


def text_mesh(font, body, height, width, name, mat, coll, m, extrude=0.06):
    """Lettering `height` m tall (and `width` m long if given), on the XY plane of matrix m."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size, cu.extrude = body, font, 1.0, extrude
    cu.align_x, cu.align_y, cu.resolution_u = "CENTER", "CENTER", 2
    cu.space_character = 1.1
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


def facing(p, out):
    """Matrix putting a text's XY plane upright at p, reading left to right as seen from `out`."""
    yaw = math.atan2(out[1], out[0]) + math.pi / 2
    return T(*p) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")


def wedge(coll, name, side, c, w):
    """A walk-only ramp over an entrance's steps, from the plaza up to the plinth."""
    import bcity_landmark
    a, t, nrm = FACES[side]
    mid = a * (PL / HALF) + t * (PL + c)
    sw = w / 2 + 3.0
    run = STEP_N * STEP_D
    lo0, lo1 = mid + nrm * run - t * sw, mid + nrm * run + t * sw
    hi0, hi1 = mid - t * sw, mid + t * sw
    me = bpy.data.meshes.new(name)
    me.from_pydata([(*lo0, 0.0), (*lo1, 0.0), (*hi1, PLINTH), (*hi0, PLINTH), (*hi0, 0.0), (*hi1, 0.0)], [],
                   [(0, 1, 2, 3), (0, 4, 3), (1, 2, 5), (4, 5, 2, 3), (0, 1, 5, 4)])
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    bcity_landmark.rename(o, "WALK")


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("国家游泳中心")

    g = Geo()
    skin(g)
    plinth(g)
    plaza(g)
    g.build("WaterCube", collection("水立方", main), M, TILE)
    tris = g.tris()

    # lettering
    try:
        font = bpy.data.fonts.load(FONT)
    except Exception:
        font = bpy.data.fonts.load(FONT_FALLBACK)
    letters = collection("字", main)
    nl = 0
    _, ce, we, he, _ = DOORS[0]
    top_e = PLINTH + he
    nl += text_mesh(font, "国家游泳中心", 2.6, 24.0, "NameEast", M["letters"], letters, facing((HALF + 0.02, ce, top_e + 3.4), (1, 0)))
    nl += text_mesh(font, "NATIONAL AQUATICS CENTER", 0.9, 17.0, "NameEastEn", M["letters"], letters, facing((HALF + 0.02, ce, top_e + 1.4), (1, 0)))
    _, cs, ws, hs, _ = DOORS[1]
    nl += text_mesh(font, "冰立方", 3.2, None, "NameSouth", M["letters"], letters, facing((cs, -HALF - 0.02, PLINTH + hs + 3.9), (0, -1)))
    nl += text_mesh(font, "水立方", 1.6, None, "NameSouthSmall", M["letters"], letters, facing((cs, -HALF - 0.02, PLINTH + hs + 1.3), (0, -1)))

    # far level: the box, the plinth, the plaza
    far = Geo()
    far.box(-HALF, HALF, -HALF, HALF, PLINTH, H, "etfe", skip=("-z",))
    far.box(-PL, PL, -PL, PL, 0.0, PLINTH, "granite", skip=("-z",))
    plaza(far)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the plinth (people up its steps), the box round the entrance recesses
    helpers = collection("碰撞体")
    collider_box(helpers, "plinth", -PL, PL, -PL, PL, 0.0, PLINTH)
    (_, _, we, he, de), (_, _, ws, hs, ds) = DOORS
    collider_box(helpers, "core", -HALF, HALF - de, -HALF + ds, HALF, PLINTH, H)
    collider_box(helpers, "east_s", HALF - de, HALF, -HALF, -we / 2, PLINTH, H)
    collider_box(helpers, "east_n", HALF - de, HALF, we / 2, HALF, PLINTH, H)
    collider_box(helpers, "east_top", HALF - de, HALF, -we / 2, we / 2, PLINTH + he, H)
    collider_box(helpers, "south_w", -HALF, -ws / 2, -HALF, -HALF + ds, PLINTH, H)
    collider_box(helpers, "south_e", ws / 2, HALF, -HALF, -HALF + ds, PLINTH, H)
    collider_box(helpers, "south_top", -ws / 2, ws / 2, -HALF, -HALF + ds, PLINTH + hs, H)
    for side, c, w, h, d in DOORS:
        wedge(helpers, f"steps_{side}", side, c, w)
    run = STEP_N * STEP_D
    flat_marker(helpers, "watercube", rect(-PL - 0.5, PL + run + 0.5, -PL - run - 0.5, PL + 0.5), "FOOTPRINT")
    flat_marker(helpers, "watercube", rect(-PL - 0.5, PL + run + 1.0, -PL - run - 1.0, PL + 0.5), "CLEAR")
    # a machine-learnt 17 m sliver (Overture 8000000158193) stood on the west plaza, between the wall and 天辰西路
    flat_marker(helpers, "west_plaza", rect(-104.0, -PL - 0.5, 8.0, 34.0), "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "watercube", "国家游泳中心（水立方）", "National Aquatics Center (Water Cube)"
    s.coord_mode, s.game_x, s.game_z, s.heading = "GAME", GX, GZ, HEADING
    s.far_distance = 900
    s.repo_path = REPO
    return dict(tris=tris, letters=nl, far=far.tris())


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
