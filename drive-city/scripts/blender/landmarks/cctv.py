# 中央电视台总部大楼 CCTV Headquarters, built in Blender and marked with the bcity_landmark add-on's
# conventions. It replaces the kit-built cctv.ts.
#
#   blender -b -P scripts/blender/landmarks/cctv.py -- [--out art/landmarks/cctv.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the centre of the site (OSM relation
# 7820447's box, 158.7 x 168.4 m on the city grid, heading 0).
#
# The loop, 234 m (the kit's massing, from OSM): an L-shaped 48 m podium along the north and east joins two
# towers at the north-west and south-east corners; each leans 6 degrees in both directions towards the
# other and they meet 162 m up in an L-shaped overhang, 72 m deep, whose south-west corner cantilevers
# ~75 m over the plaza. Grey glass behind the structural diagrid, both drawn by the kit's facade shader
# (tower.py) - on the soffit of the overhang too, where the kit left a flat dark plate, with the three
# glass discs of the viewing platform near its tip. The ground floor of the podium is set back 2.5 m in
# lit glass behind the diagrid's legs; the plaza under the cantilever is paved; the roofs carry a
# parapet and plant.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, material, save_and_export  # noqa: E402
from kit import Geo, collider_box, collider_pts, cyl, flat_marker, rect  # noqa: E402
from tower import annulus, cap, ccw, facade, inset_poly, loft, perim, shift  # noqa: E402

import bpy  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "cctv.blend")

T, TOP, PODIUM, SH, GROUND = 162.0, 234.0, 48.0, 17.0, 8.0
PODIUM_POLY = ccw([(-79.0, 84.3), (79.3, 84.3), (79.3, -84.2), (26.0, -84.2), (26.0, 26.3), (-79.0, 26.3)])
A = rect(-79.0, -19.5, 26.3, 84.3)          # north-west tower's foot; leans +x, -y
B = rect(26.0, 79.3, -84.2, -23.9)          # south-east tower's foot; leans -x, +y
OVER = ccw([(-62.0, 67.3), (-2.5, 67.3), (-2.5, -6.9), (62.3, -6.9), (62.3, -67.2), (-62.0, -67.2)])
DIAG = dict(size=9, width=0.45, color="#2d3236", glow=0.05, slope=0.62)
GLASS = dict(floorH=4.5, colW=1.8, glass="#7f8a91", frame="#5d656a", spandrel="#6a7277", mull=0.05, slab=0.2, metal=0.72, rough=0.12, lit=0.3, seed=7, diagrid=DIAG)


def tower(g, foot, lean, key, z0, z1):
    """A leaning tower between heights z0 and z1: its foot rectangle sheared by `lean` per 162 m."""
    s0, s1 = z0 / T, z1 / T
    loft(g, [(z0, shift(ccw(foot), lean[0] * s0, lean[1] * s0)), (z1, shift(ccw(foot), lean[0] * s1, lean[1] * s1))], key, smooth=False)


def build():
    clear_file()
    ensure_addon()
    M = dict(
        glass=facade("CV_Glass", GLASS),
        soffit=facade("CV_Soffit", dict(GLASS, lit=0.12, seed=13)),
        lobby=facade("CV_Lobby", dict(floorH=4.0, colW=2.0, glass="#5d6c77", frame="#3e454a", spandrel="#3e454a", mull=0.04, slab=0.03, metal=0.8, rough=0.05, lit=0.75, warm="#ffd9a8", coolShare=0.2, seed=3)),
        louvre=facade("CV_Louvre", dict(floorH=0.35, colW=40.0, glass="#454b50", frame="#7d858b", mull=0.0, slab=0.35, metal=0.6, rough=0.4, lit=0, seed=6)),
        steel=material("CV_Steel", "#3b4247", 0.35, metal=0.9, props={"wet": "surface", "glow": "none"}),
        leg=material("CV_Leg", "#2f353a", 0.4, metal=0.8, props={"wet": "surface", "glow": "none"}),
        roof=material("CV_Roof", "#62666a", 0.85, props={"wet": "ground", "glow": "none"}),
        deck=material("CV_Deck", "#a7c2d6", 0.05, metal=0.6, props={"wet": "none", "glow": "lamp", "glowColor": [0.75, 0.88, 1.0], "glowStrength": 1.2}),
        granite=material("CV_Granite", "#98948c", 0.7, props={"wet": "ground", "glow": "none", "layer": 10}),
    )
    TILE = dict(steel=2.0, roof=4.0, granite=3.0, leg=2.0)
    main = collection("央视大楼")
    g = Geo()
    ref = perim(PODIUM_POLY)

    # the podium: lit glass set back at the ground, the diagrid skin above, the roof
    lob = inset_poly(PODIUM_POLY, 2.5)
    loft(g, [(0.0, lob), (GROUND, lob)], "lobby", smooth=False)
    annulus(g, GROUND, PODIUM_POLY, lob, "steel", up=False)
    loft(g, [(GROUND, PODIUM_POLY), (PODIUM, PODIUM_POLY)], "glass", smooth=False, u_ref=ref)
    cap(g, PODIUM, PODIUM_POLY, "roof")
    # the diagrid's legs where it meets the ground: a raking strut every 9 m along the podium's face
    for i in range(len(PODIUM_POLY)):
        a, b = PODIUM_POLY[i], PODIUM_POLY[(i + 1) % len(PODIUM_POLY)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = uy, -ux                                  # outward for counter-clockwise
        k = max(1, int(L // 9.0))
        for j in range(k + 1):
            t = j * L / k
            px, py = a[0] + ux * t - nx * 0.35, a[1] + uy * t - ny * 0.35
            for sgn in (-1, 1):
                if (j == 0 and sgn < 0) or (j == k and sgn > 0):
                    continue
                # a strut from the foot to GROUND high, 4.5 m along the face: the diagrid comes down to the ground
                qx, qy = px + ux * sgn * 4.5 * GROUND / 9.0, py + uy * sgn * 4.5 * GROUND / 9.0
                w = 0.35
                g.polyn([(px - ux * w + nx * 0.3, py - uy * w + ny * 0.3, 0.0), (px + ux * w + nx * 0.3, py + uy * w + ny * 0.3, 0.0),
                         (qx + ux * w + nx * 0.3, qy + uy * w + ny * 0.3, GROUND), (qx - ux * w + nx * 0.3, qy - uy * w + ny * 0.3, GROUND)], "leg", (nx, ny, 0))

    # the two towers from the podium's roof (their feet are inside it) up to the overhang
    tower(g, A, (SH, -SH), "glass", PODIUM, T)
    tower(g, B, (-SH, SH), "glass", PODIUM, T)

    # the overhang: its walls, the soffit with the diagrid under it, the roof, parapet and plant
    loft(g, [(T, OVER), (TOP, OVER)], "glass", smooth=False)
    g.polyn([(x, y, T) for x, y in OVER], "soffit", (0, 0, -1), uvs=[(x + 80.0, y + 80.0) for x, y in OVER])
    cap(g, TOP - 0.2, OVER, "roof")
    par = inset_poly(OVER, 0.6)
    loft(g, [(TOP - 0.2, par), (TOP + 1.2, par)], "steel", smooth=False, inward=True)
    annulus(g, TOP + 1.2, OVER, par, "steel")
    loft(g, [(TOP, OVER), (TOP + 1.2, OVER)], "steel", smooth=False)
    for (x0, x1, y0, y1) in ((-50.0, -20.0, 30.0, 55.0), (20.0, 50.0, -55.0, -30.0), (-45.0, -25.0, -50.0, -30.0)):
        loft(g, [(TOP - 0.2, rect(x0, x1, y0, y1)), (TOP + 4.5, rect(x0, x1, y0, y1))], "louvre", smooth=False)
        cap(g, TOP + 4.5, rect(x0, x1, y0, y1), "roof")
    for (x0, x1, y0, y1) in ((-60.0, -30.0, 60.0, 80.0), (40.0, 70.0, 0.0, 30.0)):
        loft(g, [(PODIUM, rect(x0, x1, y0, y1)), (PODIUM + 4.0, rect(x0, x1, y0, y1))], "louvre", smooth=False)
        cap(g, PODIUM + 4.0, rect(x0, x1, y0, y1), "roof")
    # the viewing platform's glass discs in the soffit near the cantilever's tip
    for (x, y) in ((-44.0, -50.0), (-34.0, -44.0), (-48.0, -38.0)):
        cyl(g, x, y, T - 0.25, T - 0.02, 2.6, 2.6, 28, "deck", caps=(True, False))

    # the plaza under the cantilever
    pl = rect(-79.0, 26.0, -84.2, 26.3)
    g.polyn([(x, y, 0.03) for x, y in pl], "granite", (0, 0, 1))
    g.build("Tower", collection("大楼", main), M, TILE)
    tris = g.tris()

    # the far level: the same massing without the details
    far = Geo()
    loft(far, [(0.0, PODIUM_POLY), (PODIUM, PODIUM_POLY)], "glass", smooth=False, u_ref=ref)
    cap(far, PODIUM, PODIUM_POLY, "roof")
    tower(far, A, (SH, -SH), "glass", PODIUM, T)
    tower(far, B, (-SH, SH), "glass", PODIUM, T)
    loft(far, [(T, OVER), (TOP, OVER)], "glass", smooth=False)
    far.polyn([(x, y, T) for x, y in OVER], "soffit", (0, 0, -1), uvs=[(x + 80.0, y + 80.0) for x, y in OVER])
    cap(far, TOP, OVER, "roof")
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: the podium behind its glass line at the ground, the towers and the overhang out of reach
    helpers = collection("碰撞体")
    collider_box(helpers, "podiumN", -79.0 + 2.5, 79.3 - 2.5, 26.3 + 2.5, 84.3 - 2.5, 0.0, PODIUM)
    collider_box(helpers, "podiumE", 26.0 + 2.5, 79.3 - 2.5, -84.2 + 2.5, 84.3 - 2.5, 0.0, PODIUM)
    for foot, lean in ((A, (SH, -SH)), (B, (-SH, SH))):
        pts = [(x, y, 0.0) for x, y in foot] + [(x + lean[0], y + lean[1], T) for x, y in foot]
        collider_pts(helpers, "tower", pts)
    collider_box(helpers, "overW", -62.0, -2.5, -67.2, 67.3, T, TOP)
    collider_box(helpers, "overS", -2.5, 62.3, -67.2, -6.9, T, TOP)
    flat_marker(helpers, "cctv", rect(-79.6, 79.6, -84.5, 84.5), "FOOTPRINT")
    flat_marker(helpers, "cctv", rect(-79.6, 79.6, -84.5, 84.5), "CLEAR")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "cctv", "中央电视台总部大楼", "CCTV Headquarters"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.913812", "116.457966", 0.0
    s.far_distance = 1000
    s.repo_path = REPO
    return dict(tris=tris)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
