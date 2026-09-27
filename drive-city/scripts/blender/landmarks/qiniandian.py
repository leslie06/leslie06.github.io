# 天坛祈年殿 Hall of Prayer for Good Harvests, built in Blender with round.py (round roofs, storeys, marble
# tiers and flights) and hall.py's atlas, brackets and columns, marked with the bcity_landmark add-on's
# conventions. It replaces the kit-built qiniandian.ts.
#
#   blender -b -P scripts/blender/landmarks/qiniandian.py -- [--out art/landmarks/qiniandian.blend] [--export]
#
# Frame: Blender +X east, +Y north, metres, origin on the ground at the old anchor (39.882249 N, 116.406618 E,
# heading -2.2), the hall's centre.
#
# The figures: the 祈谷坛, three round tiers of white marble (91, 80 and 68 m across, 5.4 m in all) with
# balustrades and flights on the four axes, the wide ones north and south with the carved 御路 slab down the
# middle; a round marble 须弥座; the hall, 32 m across at its lowest eave: twelve bays of lattice doors
# between the outer columns, over them the painted beams and bracket sets, then two drums of lattice windows,
# each under its own eave, three eaves in all of deep blue glazed tiles, the tile rows in the geometry,
# closing up towards the top; the gilt finial, 40 m above the ground.

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, material, save_and_export, srgb  # noqa: E402
from kit import Geo, T, Rz, balustrade, collider_pts, cyl, flat_marker, mesh_of, panel_geo, paving, place, post_geo  # noqa: E402
from hall import bracket_geo, column_geo, paint_atlas  # noqa: E402
from round import finial, round_eave, round_flights, round_roof, round_storey, round_tiers, ring_pts  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "qiniandian.blend")

TIERS = [(45.5, 0.0, 1.8), (39.8, 1.8, 3.6), (34.2, 3.6, 5.4)]
FLIGHTS = {"S": (10.0, 2.8), "N": (10.0, 2.8), "E": (4.5, 0.0), "W": (4.5, 0.0)}
SUMERU = dict(r=17.6, z0=5.4, z1=6.25)
OFF = math.radians(15)                 # the columns: a bay's middle on every axis
# the storeys: wall radius, bays, bottom, top of the lattice, beams (额枋, 平板枋, bracket foot), bracket top
S1 = dict(r=12.1, z0=6.25, z1=12.8, beam=(12.8, 13.6, 13.8), top=14.8)
S2 = dict(r=9.0, z0=17.6, z1=20.9, beam=(20.9, 21.5, 21.7), top=22.6)
S3 = dict(r=6.4, z0=24.6, z1=27.4, beam=(27.4, 28.0, 28.2), top=29.1)
# the roofs: eave radius and height, top radius, rise, curve, the eave's lift
R1 = dict(r0=16.2, z=14.3, r1=9.3, H=4.2, p=1.35, lift=0.45, Vl=2.5)
R2 = dict(r0=12.6, z=21.9, r1=6.7, H=3.6, p=1.35, lift=0.4, Vl=2.2)
R3 = dict(r0=9.6, z=28.3, r1=0.0, H=7.6, p=1.5, lift=0.35, Vl=2.0)


def relief_image(w=256, h=512):
    """The 御路 slab: clouds and a dragon's coils in low relief, as a normal map and a colour."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    H = np.zeros((h, w), np.float32)
    for k in range(9):
        cy = (k + 0.5) * h / 9
        cx = w / 2 + 50 * math.sin(k * 1.7)
        r = np.hypot(x - cx, y - cy)
        a = np.arctan2(y - cy, x - cx)
        H = np.maximum(H, np.clip(1 - r / 46, 0, 1) * (0.55 + 0.45 * np.sin(a * 3 + r / 6)))
    coil = np.abs(x - (w / 2 + 70 * np.sin(y / 60))) < 16
    H = np.maximum(H, coil * 0.8)
    H[:, :10] = H[:, -10:] = 1.0
    dv, du = np.gradient(np.flipud(H))
    n = np.stack([-du * 4, -dv * 4, np.ones_like(H)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    col = srgb("#ece8de") * (0.82 + 0.2 * np.flipud(H)[..., None])
    return image("QN_ReliefN", n * 0.5 + 0.5), image("QN_ReliefC", col)


def materials():
    atlas, night = paint_atlas("QN", portrait=False, emblem=False)
    rn, rc = relief_image()
    return dict(
        atlas=material("QN_Atlas", "#ffffff", 0.55, tex=atlas, emit_tex=night, props={"wet": "damp", "emit": "night", "glowStrength": 0.8}),
        marble=material("QN_Marble", "#e9e5dc", 0.45, props={"wet": "surface", "glowStrength": 0.45}),
        paving=material("QN_Paving", "#b3aea3", 0.8, tex=paving(), props={"wet": "ground", "glowStrength": 0.5}),
        relief=material("QN_Relief", "#ece8de", 0.5, tex=rc, normal_tex=rn, props={"wet": "damp", "glowStrength": 0.5}),
        tile=material("QN_Tile", "#23418f", 0.3, props={"wet": "surface", "glowStrength": 0.5}),
        red=material("QN_Lacquer", "#8f1c16", 0.4, props={"wet": "surface"}),
        gold=material("QN_Gold", "#e0b04a", 0.25, metal=1.0, props={"glow": "lamp", "glowColor": [1.0, 0.8, 0.45], "glowStrength": 0.5}),
        paint=material("QN_Paint", "#ffffff", 0.55, vertex_colors=True, props={"wet": "damp", "glowStrength": 0.7}),
    )


TILE = dict(marble=2.0, paving=4.0, tile=2.0, red=2.0, gold=1.0, paint=1.0)


def build():
    clear_file()
    ensure_addon()
    M = materials()
    main = collection("祈年殿")
    g = Geo()
    # the 祈谷坛 and its flights, the 须弥座
    round_tiers(g, TIERS)
    ramps = round_flights(g, TIERS, FLIGHTS)
    su = SUMERU
    for za, zc, rr in ((su["z0"], su["z0"] + 0.15, su["r"] + 0.25), (su["z0"] + 0.15, su["z1"] - 0.15, su["r"]), (su["z1"] - 0.15, su["z1"], su["r"] + 0.2)):
        cyl(g, 0, 0, za, zc, rr, rr, 80, "marble", caps=(False, False))
        g.polyn([(rr * math.cos(2 * math.pi * i / 80), rr * math.sin(2 * math.pi * i / 80), zc) for i in range(80)], "marble" if zc < su["z1"] else "paving", (0, 0, 1))
    for side in ("S", "N"):
        s = -1 if side == "S" else 1
        for k in range(3):
            y0, y1 = s * (su["r"] - 0.3), s * (su["r"] + 0.4 + (3 - k) * 0.34)
            g.box(-3.5, 3.5, min(y0, y1), max(y0, y1), su["z0"], su["z0"] + (k + 1) * 0.28, "marble")
    # the hall: three storeys, three eaves
    round_storey(g, S1["r"], 12, S1["z0"], S1["z1"], S1["beam"], "door", off=OFF)
    round_storey(g, S2["r"], 12, S2["z0"], S2["z1"], S2["beam"], "window", off=OFF)
    round_storey(g, S3["r"], 12, S3["z0"], S3["z1"], S3["beam"], "window", off=OFF)
    for R, S in ((R1, S1), (R2, S2), (R3, S3)):
        round_roof(g, R, rows=8 if R is R1 else 7 if R is R2 else 12, pitch=0.5, amp=0.1, spp=3)
        round_eave(g, R, S["r"] + 0.5, S["top"] + 0.05)
    # a wall ring behind each upper roof's top edge (the drum rises out of the roof below)
    for R, S in ((R1, S2), (R2, S3)):
        cyl(g, 0, 0, R["z"] + R["H"] - 0.4, S["z0"], S["r"], S["r"], 48, "red", caps=(False, False))
    finial(g, R3["z"] + R3["H"] - 0.1, 3.6)
    g.build("Hall", collection("殿", main), M, TILE)
    tris = g.tris()

    # the linked parts: columns on the outer ring, brackets round every storey, the balustrades
    parts = collection("构件", main)
    mesh = dict(
        column=mesh_of(column_geo(S1["beam"][0] - S1["z0"], r=0.5), "Column", M, TILE),
        bracket=mesh_of(bracket_geo(), "BracketMesh", M, TILE),
        post=mesh_of(post_geo(), "PostMesh", M, TILE),
        panel=mesh_of(panel_geo(), "PanelMesh", M, TILE),
    )
    for k in range(12):
        a = OFF + 2 * math.pi * k / 12
        place(mesh["column"], f"Column.{k:02d}", parts, T((S1["r"] + 0.2) * math.cos(a), (S1["r"] + 0.2) * math.sin(a), S1["z0"]))
    nb = 0
    for S in (S1, S2, S3):
        n = round(2 * math.pi * S["r"] / 1.35)
        for k in range(n):
            a = 2 * math.pi * (k + 0.5) / n
            place(mesh["bracket"], f"Bracket.{nb:03d}", parts, T(S["r"] * math.cos(a), S["r"] * math.sin(a), S["beam"][2]) @ Rz(a + math.pi / 2))
            nb += 1
    for k, (r, z0, z1) in enumerate(TIERS):
        skip = []
        for side, (w, _) in FLIGHTS.items():
            h = w / 2 + 0.6
            skip.append({"S": (-h, h, -r - 2, -r + 3), "N": (-h, h, r - 3, r + 2), "E": (r - 3, r + 2, -h, h), "W": (-r - 2, -r + 3, -h, h)}[side])
        balustrade(parts, mesh, ring_pts(r - 0.35, z1, 120 + 24 * (2 - k)), f"Rail{k}", gap=1.7, skip=skip)

    # the far level
    far = Geo()
    for r, z0, z1 in TIERS:
        cyl(far, 0, 0, z0, z1, r, r, 32, "marble", caps=(False, True))
    cyl(far, 0, 0, SUMERU["z0"], SUMERU["z1"], SUMERU["r"], SUMERU["r"], 24, "marble", caps=(False, True))
    for S in (S1, S2, S3):
        cyl(far, 0, 0, S["z0"], S["top"], S["r"], S["r"], 16, "red", caps=(False, False))
    for R in (R1, R2, R3):
        round_roof(far, R, rows=3, waves=False, segs=16)
    far.build("Massing", collection("LOD1", main), M, TILE)

    # colliders: each tier (and the 须弥座) a many-sided prism, the flights walk-only ramps, the hall a drum
    helpers = collection("碰撞体")
    prism = lambda r, z1, n=32: [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n) for z in (0.0, z1)]   # noqa: E731
    for k, (r, z0, z1) in enumerate(TIERS):
        collider_pts(helpers, f"tier{k}", prism(r, z1))
    collider_pts(helpers, "sumeru", prism(SUMERU["r"], SUMERU["z1"], 24))
    collider_pts(helpers, "hall", prism(S1["r"] + 0.6, 34.0, 16))
    for i, (side, w, r_top, r_foot, z_top, z_foot, (c, s)) in enumerate(ramps):
        P = lambda along, x, z: (c * along - s * x, s * along + c * x, z)       # noqa: E731
        pts = [P(r_top, -w / 2, z_top), P(r_top, w / 2, z_top), P(r_foot, -w / 2, z_foot), P(r_foot, w / 2, z_foot), P(r_top, -w / 2, z_foot), P(r_top, w / 2, z_foot)]
        collider_pts(helpers, f"flight{i}", pts, role="WALK")
    fp = [(46.3 * math.cos(2 * math.pi * i / 32), 46.3 * math.sin(2 * math.pi * i / 32)) for i in range(32)]
    flat_marker(helpers, "qiniandian", fp, "FOOTPRINT")

    s = bpy.context.scene.bcity
    s.lm_id, s.name_zh, s.name_en = "qiniandian", "天坛祈年殿", "Hall of Prayer for Good Harvests"
    s.coord_mode, s.lat, s.lon, s.heading = "LATLON", "39.882249", "116.406618", -2.2
    s.repo_path = REPO
    return dict(tris=tris, brackets=nb)


if __name__ == "__main__":
    print("built", build())
    save_and_export(OUT, argv)
