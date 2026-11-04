# 南锣鼓巷 (2026-11-03): the first hand-made district (docs/gta-plan.md §12, 「先做精华街区，要求街区精美，可以进入商店，让用户不
# 只是开车，还能下车活动」, the user chose 南锣鼓巷). Round 1 is the south stretch, from 地安门东大街 to 板厂 / 蓑衣胡同 (~145 m):
# one-storey shop fronts of grey brick under grey tiled roofs, red posts, painted beams, lattice windows, black-and-gold
# signboards, red lanterns under every eave, palace lamps, stone bollards that keep cars out; five shops you can walk
# into (src/district/ runs them): 老北京小吃, 锣鼓文创, 槐下茶事, 北平照相馆, 锣鼓游戏厅.
#
#   .scratch/bpyenv/bin/python scripts/blender/landmarks/nanluo.py -- [--out art/landmarks/nanluo.blend] [--export]
#
# Needs Noto Serif SC Bold in .cache/fonts/ (see flower_basket.py's header). Lettering is painted into the textures:
# each string is a Blender font curve turned into triangles and filled on a canvas (2x supersampled), no PIL needed.
#
# Site: OSM's 南锣鼓巷 (highway=pedestrian, not in the driving network) runs from the north pavement of 地安门东大街
# (game (-61.0, -2601.0)) 2.34 degrees east of north; 福祥胡同 opens on the west 68 m in, 板厂 / 蓑衣胡同 cross 147 m in.
# Frame: Blender +X east (across the lane), +Y north (along it), origin on the ground on the lane's centre line at the
# pavement's back edge. The shop fronts stand at x = +-HALF; the lane between them is paved by the model.
#
# Writes src/district/nanluo.layout.json beside the export: the enterable shops (their rooms, doors, counters, where the
# keeper stands, the photo chair, the dance pad), the lane's walking line and its mouths - all in this Blender frame.

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import REPO, args, clear_file, collection, ensure_addon, image, linear, material, save_and_export  # noqa: E402
from kit import Canvas, Geo, collider_box, cyl, ell, flat_marker, lathe, mesh_of, place, rect  # noqa: E402
from tofu_shop import dimmed, fbm, grime, image_rgba, normal_image, seg, vnoise, weathered  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

argv = args()
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, "art", "landmarks", "nanluo.blend")
FONT = argv[argv.index("--font") + 1] if "--font" in argv else os.path.join(REPO, ".cache", "fonts", "NotoSerifSC-Bold.otf")
LAYOUT = os.path.join(REPO, "src", "district", "nanluo.layout.json")

GX, GZ, HEADING = -61.0, -2601.0, 2.34
HALF = 3.8                    # the lane's half width, front to front
DEPTH = 7.0                   # the front row's depth
BACK0, BACK1 = 8.2, 12.0      # the back row's (courtyard houses behind; east of it a 6-storey block stays)
OVER = 0.75                   # the eaves' reach over the lane
# Round 2 (2026-11-03): the middle stretch on to 东棉花 / 雨儿胡同. The lane turns 2.49 degrees west at 板厂胡同 (OSM: due
# north from there), so the middle stretch is built in the south's frame turned about (0, BEND_Y) - every point here
# is in "lane" coordinates (x across, y along, unbent), `bent()` puts it in Blender's.
Y0, Y1 = 1.0, 144.5           # the south stretch's lots (地安门东大街 -> 板厂 / 蓑衣胡同, which cross at 147)
M0, M1 = 149.6, 218.2         # the middle stretch's (-> 东棉花 / 雨儿胡同, crossing at 221.2)
# Round 3 (2026-11-04): the north stretch on to 鼓楼东大街 (its carriageway 16 m wide at 808, the pavement's back at 796.5).
N0, N1 = 224.2, 796.5
STRETCHES = [(Y0, Y1), (M0, M1), (N0, N1)]
# Where the lane turns west, and by how much (OSM's centre line: 2.49 at 板厂胡同, 0.41 at 东棉花胡同, 1.14 more at 菊儿胡同).
BENDS = [(147.0, math.radians(2.49)), (221.2, math.radians(0.41)), (613.0, math.radians(1.14))]
BEND_Y, BEND = BENDS[0]
# Hutongs that cross the lane: roads in the driving network, so nothing stands in them (no lot, no bollard). 福祥胡同 on
# the west goes on east as 炒豆胡同 (round 1 had lots over that side). North of 东棉花胡同: 帽儿 / 北兵马司, 景阳, 沙井 / 前圆恩寺,
# 黑芝麻 / 后圆恩寺, 前鼓楼苑 / 菊儿 (each a road both sides); 小菊儿胡同 opens on the east only.
FUXIANG = (65.5, 70.5)
CROSSINGS = [FUXIANG, (Y1, M0), (M1, N0), (296.0, 303.0), (385.3, 392.3), (453.5, 460.5), (535.2, 541.2), (610.0, 616.0)]
CROSS_E = [(719.0, 725.0)]
# The landmarks the lane is cut into (each its own glb, LOD and draw calls): id -> lots from, to, and the lane point its
# origin sits at (the city's LOD switches by the distance to it).
# Each origin is in its part's middle and the far distance just over its half length: with the south part's origin at the
# mouth (270 m) and the north's at 260, the bar and the yard drew all three parts' detail (draw calls 570 -> 780 there,
# high quality). The game's lane frame is the mouth's (layout `frame`), whatever the parts' origins.
PARTS = {"nanluo": (0.0, 221.2, 110.0, 135), "nanluo_n1": (221.2, 457.0, 339.0, 140), "nanluo_n2": (457.0, 820.0, 628.0, 190)}
PART = "nanluo"
# Round 4 (2026-11-04): 后海's bar street, its own landmark `houhai` built by this script in its own frame - 后海南沿 from
# 银锭桥 westwards (OSM: dead straight for 230 m, the lake 3.8-4.7 m off its centre line to the north, the bars across it
# to the south), the bridge itself, the boats' pier. `LANE` is False while it builds: the lane's paving, bollards,
# lamps, lantern strings, courtyard and layout are the lane's only.
LANE = True
HH_FRAME = (-891.0, -3197.0, -76.9)       # the bridge's south end on the road, 后海南沿's heading
HH_HALF = 5.2                             # road 2.7 + pavement 2.5: the bars' fronts
HH_S = (10.0, 176.0)                      # the bars along it
HH_ALLEYS = [(92.0, 95.5)]
HH_PIER = (38.3, 40.7, 14.0)              # its sides along the road, how far out it goes
HH_BRIDGE = (14.25, -3.87)                # 银锭桥's north end from its south one (lane u, s): the road over the canal
PARTS["houhai"] = (0.0, 200.0, 88.0, 130)
BAR_SIGNS = ["银锭酒吧", "后海小院", "荷塘月色", "湖畔", "老船长", "蓝莲花", "鼓楼印象", "水岸", "月亮湾", "望海楼", "胡同深处",
             "晚风", "听涛", "九号院", "白塔", "醉后海", "乌篷", "柳岸", "银锭观山", "船坞", "夜色", "老槐树", "半山",
             "海上花", "西岸"]


def hh_shore(sv):
    """Where the water starts across 后海南沿 at `sv` (u, from the city's water polygon: 4.65 at the bridge, 3.75 137 m on)."""
    return 4.67 - 0.0067 * sv

# The shops you can go into: side, from, to (along the lane), what they are.
SHOPS = {
    "snack": ("e", 6.0, 11.5),
    "crafts": ("w", 12.0, 17.5),
    "tea": ("e", 30.0, 35.5),
    "photo": ("w", 38.0, 44.0),
    "arcade": ("e", 57.5, 65.0),
    # round 2
    "clothes": ("e", 152.5, 159.5),
    "barber": ("w", 157.0, 162.5),
    "bar": ("e", 175.5, 184.5),
    "grill": ("w", 186.0, 190.5),   # a stall open to the lane, not a room
    # round 3: the north stretch (the dumplings send out deliveries; the cat café has lost its cat)
    "noodle": ("w", 262.0, 268.0),
    "cats": ("e", 640.0, 647.5),
}
SHOP_SIGN = {"snack": "老北京小吃", "crafts": "锣鼓文创", "tea": "槐下茶事", "photo": "北平照相馆", "arcade": "锣鼓游戏厅",
             "clothes": "胡同衣帽间", "barber": "老剃头铺", "bar": "锣鼓小酒馆", "grill": "京味烤串", "noodle": "胡同饺子馆", "cats": "喵胡同猫咖"}
# The courtyard you can walk into (east): its gate's lot on the lane, and the yard's span behind the front row.
YARD_GATE = (199.0, 203.0)
YARD = (189.5, 215.0)
# The other boards along the lane (made-up names, no real shop's).
DECO_SIGNS = ["京韵茶馆", "吉祥酸奶", "老街布鞋", "剪纸坊", "兔儿爷坊", "小院书屋", "胡同小炒", "瑞丰绸缎", "如意客栈",
              "锣鼓咖啡", "糖葫芦", "胡同酒馆", "福禄斋", "老北京炸酱面", "鼓楼酱肉", "青砖小馆", "槐荫书坊", "云片糕",
              "铜锅涮肉", "北京布艺", "胡同手作", "京城扇庄", "醉花阴", "一壶茶", "南锣酒肆", "老唱片", "皮影坊",
              "胡同照相", "京八件", "绿豆糕", "豆汁焦圈", "宫廷糕点", "鼓楼书店", "布老虎", "京剧脸谱", "炒肝包子",
              "胡同里", "老北京布鞋", "风筝坊", "铜器铺"]
BANNERS = ["茶", "酒", "面", "糖葫芦", "酸奶", "烤串", "布鞋", "书", "糕点", "咖啡", "扇", "饺子"]

BENDM = Matrix.Translation((0, BEND_Y, 0)) @ Matrix.Rotation(BEND, 4, "Z") @ Matrix.Translation((0, -BEND_Y, 0))
IDM = Matrix.Identity(4)
# The part being built sits at its own origin: everything is moved by OFF (the lane point PARTS gives, unmoved).
OFF = IDM


def lane_m(y):
    """The frame a point at lane y is built in (without the part's offset): each bend south of it turns it on."""
    m = IDM
    for (by, a) in BENDS:
        if y > by:
            m = m @ Matrix.Translation((0, by, 0)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0, -by, 0))
    return m


def seg_m(y):
    """The frame a point at lane y is built in, in the part's own frame."""
    return OFF @ lane_m(y)


def in_part(y):
    p = PARTS[PART]
    return p[0] <= y < p[1]


def bent(x, y, z=0.0):
    """A lane point (x across, y along) in Blender's frame."""
    return seg_m(y) @ Vector((x, y, z))


def cbox(coll, name, x0, x1, y0, y1, z0, z1, m=None):
    """A collider box given in lane coordinates, turned with its stretch (a yawed box stays a box in the game)."""
    m = seg_m((y0 + y1) / 2) if m is None else m
    o = collider_box(coll, name, x0, x1, y0, y1, z0, z1)
    o.matrix_world = m @ o.matrix_world
    return o


FONT_DATA = None
# What the game reads (src/district/nanluo.layout.json), all the parts' together.
layout = {"shops": {}, "gates": []}


# --- lettering -------------------------------------------------------------------------------------------

def glyph_tris(body):
    """The triangles of `body` set in the font (size 1, centred), as 2D point lists."""
    global FONT_DATA
    if FONT_DATA is None:
        FONT_DATA = bpy.data.fonts.load(FONT)
    cu = bpy.data.curves.new("t", "FONT")
    cu.body, cu.font, cu.size = body, FONT_DATA, 1.0
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    ob = bpy.data.objects.new("t", cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    tris = [[(v.co.x, v.co.y) for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.meshes.remove(me)
    return tris


def text_cover(body, w, h, vertical=False, fill=0.86):
    """Coverage (h, w) of `body` fitted into a w x h box (canvas rows, row 0 at the top), 2x supersampled."""
    W, H = w * 2, h * 2
    cv = Canvas(W, H)
    m = np.zeros((H, W), bool)
    chars = list(body) if vertical else [body]
    n = len(chars)
    for i, ch in enumerate(chars):
        tris = glyph_tris(ch)
        if not tris:
            continue
        xs = [p[0] for t in tris for p in t]
        ys = [p[1] for t in tris for p in t]
        bw, bh = max(xs) - min(xs), max(ys) - min(ys)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        if vertical:
            cell = H / n
            s = min(W * fill / bw, cell * fill / bh)
            ox, oy = W / 2, cell * (i + 0.5)
        else:
            s = min(W * fill / bw, H * fill / bh)
            ox, oy = W / 2, H / 2
        for t in tris:
            m |= cv.poly_mask([(ox + (x - cx) * s, oy - (y - cy) * s) for x, y in t])
    return m.reshape(h, 2, w, 2).mean(axis=(1, 3)).astype(np.float32)


def ink(cv, cover, x0, y0, col):
    """Paint `col` through a coverage mask placed at (x0, y0)."""
    h, w = cover.shape
    sub = cv.a[y0:y0 + h, x0:x0 + w]
    a = cover[..., None]
    sub[:] = sub * (1 - a) + cv.c(col) * a


# --- textures --------------------------------------------------------------------------------------------

def paving_image():
    """The lane: grey granite flags in courses across it, 4 m a repeat at 128 px a metre, worn and stained."""
    S = 512
    cv = Canvas(S, S, "#8e8b84")
    rng = np.random.default_rng(301)
    hgt = np.zeros((S, S), np.float32)
    row_h = 0.5 * 128
    rows = (cv.y // row_h).astype(int)
    offs = rng.uniform(0, 128, 16)
    lens = rng.uniform(0.55, 1.1, 16) * 128
    col = ((cv.x + offs[rows % 16]) // lens[rows % 16]).astype(int)
    tint = rng.uniform(0.86, 1.1, (16, 12))
    cv.a *= tint[rows % 16, col % 12][..., None]
    joint = (np.mod(cv.y, row_h) < 2.2) | (np.mod(cv.x + offs[rows % 16], lens[rows % 16]) < 2.2)
    hgt[joint] = -1.0
    weathered(cv, hgt, rng, 0.14)
    cv.put(joint, "#55524d")
    # dark wet-looking blotches and chewing gum spots, as on any busy lane
    for _ in range(40):
        x, y, r = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(1.5, 4)
        cv.a[((cv.x - x) ** 2 + (cv.y - y) ** 2) < r * r] *= 0.72
    return image("NL_Paving", np.flipud(cv.a).copy()), normal_image("NL_Paving_N", hgt, 2.2)


def brick_image():
    """Grey 青砖, 1 m a repeat (256 px): 24 x 5.3 cm bricks, stretcher bond, pale lime joints, sooty and patched."""
    S = 256
    cv = Canvas(S, S, "#6f7270")
    rng = np.random.default_rng(311)
    bh, bw = 256 / 18.5, 256 / 4.0
    rows = (cv.y // bh).astype(int)
    cols = ((cv.x + (rows % 2) * bw / 2) // bw).astype(int)
    tint = rng.uniform(0.8, 1.14, (19, 5))
    cv.a *= tint[rows % 19, cols % 5][..., None]
    blue = rng.random((19, 5)) < 0.15
    cv.a[blue[rows % 19, cols % 5]] *= np.array([0.92, 0.96, 1.04], np.float32)
    mortar = (np.mod(cv.y, bh) < 1.8) | (np.mod(cv.x + (rows % 2) * bw / 2, bw) < 1.8)
    hgt = np.where(mortar, -1.0, 0.0).astype(np.float32)
    weathered(cv, hgt, rng, 0.1)
    cv.put(mortar, "#a5a49c")
    cv.a[mortar] *= (0.85 + 0.25 * rng.random(int(mortar.sum())))[..., None]
    grime(cv, hgt, rng, 8, [0.0], (40, 220), (3, 9), 0.8)
    return image("NL_Brick", np.flipud(cv.a).copy()), normal_image("NL_Brick_N", hgt, 2.4)


def tiles_image():
    """筒瓦 roof: round cover tiles in rows down the slope (u across, 22 cm a row; v down it, 30 cm a course), 1 m a
    repeat at 256 px; dark grey, the hollows darker, a little moss."""
    S = 256
    cv = Canvas(S, S, "#55585a")
    rng = np.random.default_rng(321)
    pitch = S / 4.5
    u = np.mod(cv.x, pitch) / pitch
    ridge = np.clip(1 - ((u - 0.5) / 0.32) ** 2, 0, 1)
    course = np.mod(cv.y, S / 3.3) / (S / 3.3)
    step = np.where(course < 0.12, 0.85, 1.0)
    hgt = (ridge ** 0.5 * 1.6 + (course < 0.08) * -0.3).astype(np.float32)
    cv.a *= (0.55 + 0.5 * ridge ** 0.6)[..., None] * step[..., None]
    weathered(cv, hgt, rng, 0.14, moss=0.35)
    return image("NL_Tiles", np.flipud(cv.a).copy()), normal_image("NL_Tiles_N", hgt, 3.0)


def lacquer_image():
    """Red lacquered timber (posts, frames): oxblood red, the grain faintly through, worn paler at the edges."""
    cv = Canvas(128, 256, "#7c2a20")
    rng = np.random.default_rng(331)
    g = fbm(256, 128, 30, rng, 3)
    cv.a *= (0.9 + 0.1 * np.sin(cv.x * 0.15 + g * 5))[..., None]
    hgt = (0.2 * np.sin(cv.x * 0.15 + g * 5)).astype(np.float32)
    weathered(cv, hgt, rng, 0.1)
    return image("NL_Lacquer", np.flipud(cv.a).copy()), normal_image("NL_Lacquer_N", hgt, 1.2)


def wood_image():
    """Dark brown door and lattice timber, grained."""
    cv = Canvas(128, 256, "#4d3324")
    rng = np.random.default_rng(341)
    g = fbm(256, 128, 24, rng, 3)
    cv.a *= (0.88 + 0.14 * np.sin(cv.x * 0.5 + g * 7))[..., None]
    hgt = (0.25 * np.sin(cv.x * 0.5 + g * 7)).astype(np.float32)
    weathered(cv, hgt, rng, 0.08)
    return image("NL_Wood", np.flipud(cv.a).copy()), normal_image("NL_Wood_N", hgt, 1.5)


def beam_image():
    """The painted beam (额枋): a simplified 旋子彩画 - blue and green panels, gold outlines, a rosette at each panel's
    end - 1.5 m along it (u) by its height (v), 384 x 96 px."""
    W, H = 384, 96
    cv = Canvas(W, H, "#1f4f6e")
    rng = np.random.default_rng(351)
    cv.rect(0, 0, W, 8, "#3a2a1e")
    cv.rect(0, H - 8, W, H, "#3a2a1e")
    # three panels: green ends, a blue middle
    cv.rect(0, 8, 96, H - 8, "#2e6b4f")
    cv.rect(W - 96, 8, W, H - 8, "#2e6b4f")
    gold = "#c9a548"
    for x in (96, W - 96):
        cv.rect(x - 3, 8, x + 3, H - 8, gold)
        cv.poly([(x - 18, 8), (x, H / 2), (x - 18, H - 8), (x - 22, H - 8), (x - 4, H / 2), (x - 22, 8)], gold)
        cv.poly([(x + 18, 8), (x, H / 2), (x + 18, H - 8), (x + 22, H - 8), (x + 4, H / 2), (x + 22, 8)], gold)
    for cx in (48, W - 48):
        cv.ring(cx, H / 2, 18, 24, gold)
        cv.ring(cx, H / 2, 6, 10, "#d8d2c0")
        for k in range(8):
            a = k * math.pi / 4
            cv.ellipse(cx + 14 * math.cos(a), H / 2 + 14 * math.sin(a), 4, 4, "#d8d2c0")
    cv.frame(100, 14, W - 100, H - 14, 3, gold)
    cv.frame(0, 8, W, H - 8, 2, gold)
    cv.noise(0.12, 352)
    hgt = np.zeros((H, W), np.float32)
    weathered(cv, hgt, rng, 0.1)
    return image("NL_Beam", np.flipud(cv.a).copy())


def lattice_image():
    """步步锦 lattice for the windows, cut out: dark timber bars on transparent, 1 x 1 m at 256 px."""
    S = 256
    a = np.zeros((S, S), np.float32)
    y, x = np.mgrid[0:S, 0:S] + 0.5
    t = 5.0

    def bar(x0, y0, x1, y1):
        a[int(y0):int(y1), int(x0):int(x1)] = 1

    bar(0, 0, S, t)
    bar(0, S - t, S, S)
    bar(0, 0, t, S)
    bar(S - t, 0, S, S)
    # nested steps: each quarter has a frame of short bars stepping in
    for q0 in (0, S / 2):
        for r0 in (0, S / 2):
            for k, inset in enumerate((18, 40)):
                x0, y0, x1, y1 = q0 + inset, r0 + inset, q0 + S / 2 - inset, r0 + S / 2 - inset
                bar(x0, y0, x1, y0 + t)
                bar(x0, y1 - t, x1, y1)
                bar(x0, y0, x0 + t, y1)
                bar(x1 - t, y0, x1, y1)
            bar(q0 + S / 4 - t / 2, r0, q0 + S / 4 + t / 2, r0 + 18)
            bar(q0 + S / 4 - t / 2, r0 + S / 2 - 18, q0 + S / 4 + t / 2, r0 + S / 2)
            bar(q0, r0 + S / 4 - t / 2, q0 + 18, r0 + S / 4 + t / 2)
            bar(q0 + S / 2 - 18, r0 + S / 4 - t / 2, q0 + S / 2, r0 + S / 4 + t / 2)
    bar(S / 2 - t / 2, 0, S / 2 + t / 2, S)
    bar(0, S / 2 - t / 2, S, S / 2 + t / 2)
    rgba = np.zeros((S, S, 4), np.float32)
    rgba[..., :3] = srgb3("#3a2618")
    rgba[..., 3] = a
    return image_rgba("NL_Lattice", rgba)


def srgb3(hexs):
    h = hexs.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


SIGN_STYLES = [
    ("#121212", "#d4af55", "#a9883c"),   # black lacquer, gold
    ("#1d3b2c", "#d4af55", "#a9883c"),   # dark green, gold
    ("#5b1d16", "#e2c066", "#b99447"),   # red, gold
    ("#6b4a2d", "#1c1a16", "#3b2a1b"),   # plain wood, black
    ("#efe9da", "#a3261c", "#7b6c58"),   # white lightbox, red
]


def sign_atlas(names):
    """The signboards: 512 x 128 cells (4:1), four across, row-major from the top; returns the image and each name's
    cell (col, row). Lacquer with a bevelled border and the name in gold (or the style's ink)."""
    W, H, CW, CH = 2048, 2048, 512, 128
    cv = Canvas(W, H, "#202020")
    rng = np.random.default_rng(361)
    cells = {}
    for i, name in enumerate(names):
        c, r = i % 4, i // 4
        x0, y0 = c * CW, r * CH
        bg, fg, rim = SIGN_STYLES[(i * 7 + 3) % len(SIGN_STYLES)] if name not in SHOP_SIGN.values() else SIGN_STYLES[0 if name != "槐下茶事" else 1]
        cv.rect(x0, y0, x0 + CW, y0 + CH, bg)
        g = vnoise(CH, CW, 20, rng)
        cv.a[y0:y0 + CH, x0:x0 + CW] *= (0.9 + 0.18 * g)[..., None]
        cv.frame(x0 + 4, y0 + 4, x0 + CW - 4, y0 + CH - 4, 7, rim)
        cv.frame(x0 + 15, y0 + 15, x0 + CW - 15, y0 + CH - 15, 2, rim)
        cov = text_cover(name, CW - 60, CH - 34, fill=0.9 if len(name) > 3 else 0.82)
        ink(cv, cov, x0 + 30, y0 + 17, fg)
        cells[name] = (c, r)
    cv.noise(0.05, 362)
    return image("NL_Signs", np.flipud(cv.a).copy()), cells


def banner_atlas(words):
    """幌子: cloth banners 128 x 512 px (0.45 x 1.6 m), eight across, two rows; the word upright on red, yellow or
    indigo cloth with a dark fringe."""
    W, H, CW, CH = 1024, 1024, 128, 512
    cv = Canvas(W, H, "#8a1d16")
    cells = {}
    cloths = [("#a5241a", "#f2d27a"), ("#c99a2e", "#5a1a12"), ("#1f3350", "#f0ead6")]
    rng = np.random.default_rng(371)
    for i, wd in enumerate(words):
        c, r = i % 8, i // 8
        x0, y0 = c * CW, r * CH
        bg, fg = cloths[i % 3]
        cv.rect(x0, y0, x0 + CW, y0 + CH, bg)
        cv.a[y0:y0 + CH, x0:x0 + CW] *= (0.92 + 0.12 * fbm(CH, CW, 40, rng, 2))[..., None]
        cv.rect(x0, y0, x0 + CW, y0 + 26, "#2b1a12")
        for k in range(10):
            xs = x0 + 6 + k * 12
            cv.rect(xs, y0 + CH - 44, xs + 6, y0 + CH, fg)
        cov = text_cover(wd, CW - 28, CH - 120, vertical=True, fill=0.8)
        ink(cv, cov, x0 + 14, y0 + 40, fg)
        cells[wd] = (c, r)
    return image("NL_Banners", np.flipud(cv.a).copy()), cells


def couplet_image():
    """A gate's spring couplets and its 福: red paper, gold-black characters, 256 x 1024 (two strips and a square)."""
    cv = Canvas(256, 1024, "#b3261d")
    rng = np.random.default_rng(381)
    cv.a *= (0.92 + 0.1 * fbm(1024, 256, 30, rng, 2))[..., None]
    left, right = "门迎百福", "户纳千祥"
    for i, txt in enumerate((left, right)):
        cov = text_cover(txt, 96, 700, vertical=True, fill=0.78)
        ink(cv, cov, 16 + i * 128, 20, "#1a1410")
    cv.rect(0, 740, 256, 1024, "#c22a1f")
    cov = text_cover("福", 240, 260, fill=0.8)
    ink(cv, cov, 8, 752, "#1a1410")
    cv.rect(124, 0, 132, 730, "#8a1a14")
    return image("NL_Couplets", np.flipud(cv.a).copy())


def plate_image(numbers):
    """Blue house-number plates (门牌): 「南锣鼓巷 N 号」, 256 x 128 cells, four across."""
    W, H = 1024, 128 * ((len(numbers) + 3) // 4)
    cv = Canvas(W, H, "#1d4a8c")
    cells = {}
    for i, n in enumerate(numbers):
        c, r = i % 4, i // 4
        x0, y0 = c * 256, r * 128
        cv.rect(x0, y0, x0 + 256, y0 + 128, "#1d4a8c")
        cv.frame(x0 + 6, y0 + 6, x0 + 250, y0 + 122, 4, "#e9eef5")
        ink(cv, text_cover("南锣鼓巷", 200, 40), x0 + 28, y0 + 14, "#e9eef5")
        ink(cv, text_cover(f"{n}号", 150, 52), x0 + 53, y0 + 60, "#e9eef5")
        cells[n] = (c, r)
    return image("NL_Plates", np.flipud(cv.a).copy()), cells, H


def stele_image(title="南锣鼓巷", small="元代 · 北京最古老的街区之一", name="NL_Stele"):
    """The stone at the lane's south mouth: grey granite, 「南锣鼓巷」 cut in and filled red, a line of small print."""
    W, H = 512, 256
    cv = Canvas(W, H, "#7f7d78")
    rng = np.random.default_rng(391)
    hgt = np.zeros((H, W), np.float32)
    weathered(cv, hgt, rng, 0.16)
    cv.a *= (0.92 + 0.12 * vnoise(H, W, 3, rng))[..., None]
    cov = text_cover(title, 440, 140, fill=0.9)
    ink(cv, cov, 36, 30, "#9c1f17")
    hgt[30:170, 36:476] -= cov * 1.4
    cov2 = text_cover(small, 360, 34, fill=0.9)
    ink(cv, cov2, 76, 190, "#3a3834")
    return image(name, np.flipud(cv.a).copy()), normal_image(name + "_N", hgt, 2.0)


def backdrop_atlas():
    """What the deco shops show through their glass: six 512 x 256 scenes (shelves of goods, a counter, a lamp), drawn
    already dim - the street's light is not inside."""
    W, H = 1024, 768
    cv = Canvas(W, H, "#3a2e24")
    rng = np.random.default_rng(401)
    palettes = [
        ["#b3261d", "#d6b04a", "#e9e1cc", "#2e5a3c"],    # crafts
        ["#5a3b22", "#8b6a3c", "#c9a86a", "#3d2a1c"],    # tea and cakes
        ["#2f3f5c", "#c7c2b2", "#8c3a2e", "#5b6b48"],    # cloth and shoes
        ["#e8dcc0", "#a1452c", "#d6c39a", "#46301f"],    # books
        ["#6b2a22", "#c38a3c", "#e7d3a2", "#2a2420"],    # food
        ["#273038", "#a7b0b6", "#c8423a", "#e6c770"],    # bar
    ]
    for i, pal in enumerate(palettes):
        c, r = i % 2, i // 2
        x0, y0 = c * 512, r * 256
        cv.rect(x0, y0, x0 + 512, y0 + 256, "#4a3b2e")
        # back wall gradient lit from above
        grad = np.linspace(1.15, 0.6, 256, dtype=np.float32)[:, None, None]
        cv.a[y0:y0 + 256, x0:x0 + 512] *= grad
        for k, sy in enumerate((40, 100, 160)):
            cv.rect(x0 + 20, y0 + sy + 46, x0 + 492, y0 + sy + 54, "#2b1f16")
            x = x0 + 26
            while x < x0 + 486:
                w = int(rng.integers(10, 34))
                h = int(rng.integers(18, 44))
                col = pal[int(rng.integers(len(pal)))]
                cv.rect(x, y0 + sy + 46 - h, x + w, y0 + sy + 46, col)
                cv.a[y0 + sy + 46 - h:y0 + sy + 46, x:x + w] *= rng.uniform(0.75, 1.1)
                x += w + int(rng.integers(2, 8))
        cv.rect(x0, y0 + 214, x0 + 512, y0 + 256, "#2a2019")
        cv.rect(x0 + 300, y0 + 180, x0 + 470, y0 + 256, "#5a3d26")
        cv.ellipse(x0 + 256, y0 + 10, 120, 30, "#f1d9a0")
    cv.noise(0.06, 402)
    return image("NL_Backdrops", np.flipud(cv.a).copy())


# jackets, then trousers, then hats (src/district/Shops.ts sells these colours)
GARMENTS = ["#25262a", "#3e4a32", "#5a1e22", "#1e2840", "#8a7552", "#cfc8b8", "#1c1c1f", "#7c6a4a", "#55585c", "#24314a",
            "#b3221c", "#b8a47a", "#c8902a", "#d9bf7a"]
# Flat colours that would each be a material (a draw call): one 8 x 4 palette texture instead, every face of a part at
# one cell's middle. The garments first, then the rest by name.
PALETTE = GARMENTS + ["#5a1216", "#7a3018", "#d8d4cc", "#e8e4da", "#3a5a8a", "#b8483a"]
PAL = {**{f"cloth{i}": i for i in range(len(GARMENTS))}, "curtain": 14, "meat": 15, "tilewhite": 16, "laundry0": 17, "laundry1": 18, "laundry2": 19}


def palette_image():
    cv = Canvas(64, 32, "#808080")
    for i, c in enumerate(PALETTE):
        cv.rect((i % 8) * 8, (i // 8) * 8, (i % 8) * 8 + 8, (i // 8) * 8 + 8, c)
    return image("NL_Palette", np.flipud(cv.a).copy())


def pal_uv(key):
    """The UV of a palette colour's cell middle (v up)."""
    i = PAL[key]
    return ((i % 8) * 8 + 4) / 64, 1 - ((i // 8) * 8 + 4) / 32


def awning_image():
    """The grill stall's awning: red and white stripes with a scalloped hem, 256 x 128."""
    cv = Canvas(256, 128, "#f1efe8")
    for k in range(8):
        if k % 2 == 0:
            cv.rect(k * 32, 0, k * 32 + 32, 128, "#c8261e")
    for k in range(8):
        cv.ellipse(k * 32 + 16, 120, 16, 10, "#c8261e" if k % 2 == 0 else "#f1efe8")
    cv.noise(0.05, 431)
    return image("NL_Awning", np.flipud(cv.a).copy())


def goods_atlas():
    """The shops' insides, 2048 x 2048 (cells named below): menu boards, the photo studio's painted backdrop and its
    portraits, arcade screens, the dance pad, posters, the crafts shelves' backs. Drawn dim (interiors), see `dimmed`."""
    W = H = 2048
    cv = Canvas(W, H, "#30261e")
    rng = np.random.default_rng(411)
    cells = {}

    def cell(name, x0, y0, x1, y1):
        cells[name] = (x0 / W, 1 - y1 / H, x1 / W, 1 - y0 / H)   # u0, v0, u1, v1 (v up)

    # menu boards 512 x 256: dark board, cream text in lines
    menus = {
        "menu_snack": ["冰糖葫芦  ¥10", "驴打滚    ¥15", "炸酱面    ¥28"],
        "menu_tea": ["桂花奶茶  ¥18", "槐花冰饮  ¥22", "老北京酸梅汤 ¥12"],
        "menu_arcade": ["跳舞机  一局 ¥10", "破纪录有奖"],
        "menu_photo": ["老照片  一张 ¥30", "民国布景 · 当场取相"],
        "menu_crafts": ["兔儿爷  ¥60", "胡同地图  ¥40"],
        # round 2
        "menu_clothes": ["帽子 · 墨镜 · 外套 · 裤子", "试穿不要钱"],
        "menu_barber": ["染发  ¥50", "洗头按摩  ¥30", "修面  ¥20"],
        "menu_bar": ["橘子汽水  ¥8", "炸花生米  ¥15", "点歌  ¥20"],
        "menu_grill": ["羊肉串  ¥15", "烤馒头片  ¥8", "大腰子  ¥25"],
        # round 3
        "menu_noodle": ["猪肉大葱饺子  ¥22", "卤煮火烧  ¥30", "小米粥  ¥6", "外卖 · 胡同里送"],
        "menu_cats": ["拿铁  ¥25", "猫爪蛋糕  ¥30", "撸猫不要钱"],
    }
    for i, (name, lines) in enumerate(menus.items()):
        # two rows at the top, the rest along the bottom (the backdrop and portraits are in between)
        x0, y0 = ((i % 4) * 512, (i // 4) * 256) if i < 8 else (((i - 8) % 4) * 512, 1664 + ((i - 8) // 4) * 256)
        cv.rect(x0, y0, x0 + 512, y0 + 256, "#1b1712")
        cv.frame(x0 + 6, y0 + 6, x0 + 506, y0 + 250, 6, "#8c6a3a")
        lh = 220 // len(lines)
        for k, ln in enumerate(lines):
            ink(cv, text_cover(ln, 460, lh - 14, fill=0.92), x0 + 26, y0 + 18 + k * lh, "#efe4c8")
        cell(name, x0, y0, x0 + 512, y0 + 256)
    # the photo studio's painted backdrop, 1024 x 512: a sepia court of halls under clouds, with a drawn balustrade
    x0, y0 = 0, 512
    bw, bh = 1024, 512
    sky = np.linspace(0.95, 0.75, bh, dtype=np.float32)[:, None]
    cv.a[y0:y0 + bh, x0:x0 + bw] = (np.array([0.78, 0.68, 0.52], np.float32) * sky[..., None]) * (0.92 + 0.1 * fbm(bh, bw, 60, rng, 3))[..., None]
    for k in range(7):
        cx, cy = rng.uniform(80, 940), rng.uniform(40, 170)
        cv.ellipse(x0 + cx, y0 + cy, rng.uniform(60, 120), rng.uniform(14, 26), "#d8cbb0")
    hall = "#5b4532"
    for (hx, hw, hy) in ((512, 420, 250), (180, 230, 300), (840, 230, 300)):
        cv.poly([(x0 + hx - hw / 2 - 30, y0 + hy), (x0 + hx + hw / 2 + 30, y0 + hy), (x0 + hx + hw / 2 - 20, y0 + hy - 60), (x0 + hx - hw / 2 + 20, y0 + hy - 60)], hall)
        cv.rect(x0 + hx - hw / 2, y0 + hy, x0 + hx + hw / 2, y0 + hy + 110, "#6e5440")
        for c in range(int(hw // 40)):
            cv.rect(x0 + hx - hw / 2 + 10 + c * 40, y0 + hy + 10, x0 + hx - hw / 2 + 22 + c * 40, y0 + hy + 110, "#4a3626")
    cv.rect(x0, y0 + 420, x0 + bw, y0 + bh, "#8a785e")
    for c in range(26):
        cv.rect(x0 + c * 40, y0 + 400, x0 + c * 40 + 10, y0 + 440, "#d2c4a6")
    cv.rect(x0, y0 + 396, x0 + bw, y0 + 406, "#d2c4a6")
    cell("backdrop", x0, y0, x0 + bw, y0 + bh)
    # framed portraits 128 x 160, sepia faces (an oval and shoulders)
    for k in range(8):
        px, py = 1024 + (k % 4) * 128, 512 + (k // 4) * 160
        cv.rect(px, py, px + 128, py + 160, "#2a1d14")
        cv.rect(px + 10, py + 10, px + 118, py + 150, "#b9a27c")
        cv.ellipse(px + 64, py + 64, 22, 28, "#6a523a")
        cv.ellipse(px + 64, py + 140, 46, 36, "#4e3b2a")
        cell(f"portrait{k}", px, py, px + 128, py + 160)
    # arcade screens 256 x 192: bright blocks and a score line
    for k in range(6):
        px, py = (k % 4) * 256, 1024 + (k // 4) * 192
        hue = [("#1b2a6b", "#ffcf3a", "#ff3a8c"), ("#0e3a2a", "#53ff9b", "#ffffff"), ("#3a0e3a", "#ff5ad1", "#5ad1ff")][k % 3]
        cv.rect(px, py, px + 256, py + 192, hue[0])
        for b in range(12):
            bx, by = rng.uniform(10, 220), rng.uniform(30, 160)
            cv.rect(px + bx, py + by, px + bx + rng.uniform(10, 30), py + by + rng.uniform(8, 20), hue[1 + b % 2])
        cv.rect(px, py, px + 256, py + 20, "#000000")
        cell(f"screen{k}", px, py, px + 256, py + 192)
    # the dance machine's screen with arrows, 256 x 192
    px, py = 1024, 1216
    cv.rect(px, py, px + 256, py + 192, "#120a2a")
    for k, (ax, ay) in enumerate(((40, 60), (100, 30), (160, 60), (220, 90))):
        cv.poly([(px + ax, py + ay), (px + ax + 22, py + ay + 22), (px + ax - 22, py + ay + 22)], ["#ff4fa3", "#4fd2ff", "#ffe14f", "#7dff4f"][k])
    cell("dancescreen", px, py, px + 256, py + 192)
    # the dance pad 256 x 256: a 3 x 3 steel grid with four arrows lit
    px, py = 1280, 1216
    cv.rect(px, py, px + 256, py + 256, "#2a2c30")
    for i in range(3):
        for j in range(3):
            cv.rect(px + 6 + i * 83, py + 6 + j * 83, px + 83 + i * 83, py + 83 + j * 83, "#3c3f45")
    arrows = {(1, 0): (0, -1, "#4fd2ff"), (0, 1): (-1, 0, "#ff4fa3"), (2, 1): (1, 0, "#ffe14f"), (1, 2): (0, 1, "#7dff4f")}
    for (i, j), (dx, dy, col) in arrows.items():
        cx, cy = px + 44 + i * 83, py + 44 + j * 83
        tip = (cx + dx * 28, cy + dy * 28)
        l = (cx - dy * 24 - dx * 10, cy + dx * 24 - dy * 10)
        r = (cx + dy * 24 - dx * 10, cy - dx * 24 - dy * 10)
        cv.poly([tip, l, r], col)
        cv.rect(cx - 7 - dx * 18 + (0 if dx else 0), cy - 7 - dy * 18, cx + 7 - dx * 18, cy + 7 - dy * 18, col)
    cell("dancepad", px, py, px + 256, py + 256)
    # posters 192 x 256: a 兔儿爷 shape, a lantern, a temple
    for k in range(3):
        px, py = 1536 + (k % 2) * 256, 1024 + (k // 2) * 256
        cv.rect(px, py, px + 192, py + 256, ["#b3261d", "#e7d7b0", "#1f3350"][k])
        cv.ellipse(px + 96, py + 110, 50, 60, ["#f1e4c6", "#b3261d", "#d6b04a"][k])
        cv.ellipse(px + 96, py + 50, 20, 30, ["#f1e4c6", "#b3261d", "#d6b04a"][k])
        ink(cv, text_cover(["兔儿爷", "灯", "胡同"][k], 160, 50), px + 16, py + 196, ["#f2d27a", "#5a1a12", "#f0ead6"][k])
        cell(f"poster{k}", px, py, px + 192, py + 256)
    # straw for the 糖葫芦 bundle 256 x 256
    px, py = 0, 1408
    cv.rect(px, py, px + 256, py + 256, "#b8954e")
    for k in range(260):
        x = rng.uniform(0, 256)
        seg(cv, px + x, py, px + x + rng.uniform(-6, 6), py + 256, 1.6, ["#8d6c30", "#d4b46a", "#a3803e"][k % 3])
    cell("straw", px, py, px + 256, py + 256)
    # the bar's back shelf, 512 x 256: three boards of bottles, lit from below
    px, py = 1536, 512
    cv.rect(px, py, px + 512, py + 256, "#1e1612")
    for k, sy in enumerate((70, 150, 230)):
        cv.rect(px, py + sy, px + 512, py + sy + 10, "#5a3b22")
        x = px + 10
        while x < px + 500:
            bw = int(rng.integers(14, 24))
            bh = int(rng.integers(36, 62))
            col = ["#2f6b3a", "#6b3a1c", "#c8b890", "#8c1c1c", "#2a4a6b", "#d8a040"][int(rng.integers(6))]
            cv.rect(x, py + sy - bh + 14, x + bw, py + sy, col)
            cv.rect(x + bw // 3, py + sy - bh, x + bw - bw // 3, py + sy - bh + 14, col)
            cv.rect(x + 2, py + sy - bh // 2, x + bw - 2, py + sy - bh // 2 + 10, "#e8dcb8")
            x += bw + int(rng.integers(3, 9))
    cell("bottles", px, py, px + 512, py + 256)
    # the barber's pole: red, white and blue spiralling, 64 x 256 (wraps round the cylinder)
    px, py = 1536, 768
    for y in range(256):
        for x in range(64):
            k = int(((x + y * 0.75) // 16) % 4)
            cv.a[py + y, px + x] = srgb3(["#c4231c", "#f2efe8", "#1d3f8c", "#f2efe8"][k])
    cell("pole", px, py, px + 64, py + 256)
    # the bar's poster of tonight's singer: a figure with a guitar under a spotlight, 192 x 256
    px, py = 1600, 768
    cv.rect(px, py, px + 192, py + 256, "#1a1430")
    cv.ellipse(px + 96, py + 70, 70, 60, "#3a3060")
    cv.ellipse(px + 96, py + 80, 18, 22, "#e8c8a0")
    cv.rect(px + 72, py + 102, px + 120, py + 180, "#c8423a")
    cv.ellipse(px + 110, py + 160, 30, 22, "#c98a3a")
    ink(cv, text_cover("今晚驻唱", 160, 44), px + 16, py + 196, "#f2d27a")
    cell("singer", px, py, px + 192, py + 256)
    # a 象棋 board, 256 x 256: buff paper, the river, the grid
    px, py = 1792, 768
    cv.rect(px, py, px + 256, py + 256, "#d8b878")
    for i in range(9):
        cv.rect(px + 16 + i * 28, py + 16, px + 18 + i * 28, py + 240, "#5a3018")
    for j in range(10):
        cv.rect(px + 16, py + 16 + j * 25, px + 242, py + 18 + j * 25, "#5a3018")
    cv.rect(px + 18, py + 117, px + 240, py + 139, "#d8b878")
    for k in range(14):
        cx, cy = px + 16 + int(rng.integers(9)) * 28, py + 16 + int(rng.integers(10)) * 25
        cv.ellipse(cx, cy, 11, 11, "#e8d0a0")
        cv.ellipse(cx, cy, 7, 7, "#a3261c" if k % 2 else "#1a1410")
    cell("chess", px, py, px + 256, py + 256)
    # round 3: the cat café's poster (a cat's head and 「撸猫」), 192 x 256, and its paw-print wall stencil, 256 x 256
    px, py = 1536, 1664
    cv.rect(px, py, px + 192, py + 256, "#f0d9a8")
    cv.ellipse(px + 96, py + 100, 58, 50, "#d88a3a")
    for s in (-1, 1):
        cv.poly([(px + 96 + s * 52, py + 72), (px + 96 + s * 30, py + 30), (px + 96 + s * 16, py + 64)], "#d88a3a")
        cv.ellipse(px + 96 + s * 22, py + 96, 8, 10, "#2a1a10")
    cv.ellipse(px + 96, py + 116, 6, 4, "#c4523a")
    ink(cv, text_cover("撸猫", 150, 52), px + 21, py + 186, "#5a2a12")
    cell("catposter", px, py, px + 192, py + 256)
    px, py = 1792, 1664
    cv.rect(px, py, px + 256, py + 256, "#e8dcc4")
    for k in range(5):
        cx, cy = px + 40 + k * 44, py + 210 - k * 40
        cv.ellipse(cx, cy, 14, 12, "#a87a4a")
        for j in range(4):
            cv.ellipse(cx - 14 + j * 9.5, cy - 16 - (j in (1, 2)) * 4, 4.5, 5, "#a87a4a")
    cell("paws", px, py, px + 256, py + 256)
    cv.noise(0.04, 412)
    return image("NL_Goods", np.flipud(cv.a).copy()), cells


# --- the frame of a lot ----------------------------------------------------------------------------------

class Lot:
    """A lot on one side of the lane in its own frame: `a` along the front (0..w, rising to the right of someone in the
    lane looking at it), `d` into it from the front (the lane is at d < 0), z up. Both sides are proper turns of
    each other, so windings and normals carry over."""

    def __init__(self, side, y0, y1, m=None):
        self.side, self.y0, self.y1, self.w = side, y0, y1, y1 - y0
        if side == "w":
            self.o, self.ea, self.ed = Vector((-HALF, y0, 0)), Vector((0, 1, 0)), Vector((-1, 0, 0))
        else:
            self.o, self.ea, self.ed = Vector((HALF, y1, 0)), Vector((0, -1, 0)), Vector((1, 0, 0))
        # the stretch's frame (the middle stretch is turned at the bend); `xy` stays in lane coordinates
        self.m = seg_m((y0 + y1) / 2) if m is None else m
        self.r = self.m.to_3x3()

    def lane(self, a, d, z=0.0):
        return self.o + self.ea * a + self.ed * d + Vector((0, 0, z))

    def P(self, a, d, z):
        return self.m @ self.lane(a, d, z)

    def N(self, na, nd, nz):
        v = self.r @ (self.ea * na + self.ed * nd + Vector((0, 0, nz)))
        return (v.x, v.y, v.z)

    def M(self, a, d, z, yaw=0.0, s=1.0):
        """Matrix for a part modelled with x along a, y along d (into the lot), z up."""
        p = self.lane(a, d, z)
        ca, sa = math.cos(yaw), math.sin(yaw)
        ex = self.ea * ca + self.ed * sa
        ey = -self.ea * sa + self.ed * ca
        return self.m @ Matrix(((ex.x * s, ey.x * s, 0, p.x), (ex.y * s, ey.y * s, 0, p.y), (0, 0, s, p.z), (0, 0, 0, 1)))

    def quad(self, g, pts, key, n, uvs=None):
        g.polyn([self.P(*p) for p in pts], key, self.N(*n), uvs=uvs)

    def front(self, g, a0, a1, z0, z1, key, d=0.0, uvs=None, n=(0, -1, 0)):
        """A rectangle facing the lane at depth d."""
        self.quad(g, [(a0, d, z0), (a1, d, z0), (a1, d, z1), (a0, d, z1)], key, n, uvs)

    def box(self, g, a0, a1, d0, d1, z0, z1, key, skip=(), uvs=None):
        c = {
            "-a": [(a0, d0, z0), (a0, d1, z0), (a0, d1, z1), (a0, d0, z1)], "+a": [(a1, d0, z0), (a1, d1, z0), (a1, d1, z1), (a1, d0, z1)],
            "-d": [(a0, d0, z0), (a1, d0, z0), (a1, d0, z1), (a0, d0, z1)], "+d": [(a0, d1, z0), (a1, d1, z0), (a1, d1, z1), (a0, d1, z1)],
            "-z": [(a0, d0, z0), (a1, d0, z0), (a1, d1, z0), (a0, d1, z0)], "+z": [(a0, d0, z1), (a1, d0, z1), (a1, d1, z1), (a0, d1, z1)],
        }
        nrm = {"-a": (-1, 0, 0), "+a": (1, 0, 0), "-d": (0, -1, 0), "+d": (0, 1, 0), "-z": (0, 0, -1), "+z": (0, 0, 1)}
        for k, pts in c.items():
            if k not in skip:
                self.quad(g, pts, key, nrm[k], (uvs or {}).get(k))

    def col(self, coll, name, a0, a1, d0, d1, z0, z1):
        """A collider box in this frame (lots are axis-aligned in lane coordinates; the stretch's turn is a yaw)."""
        ps = [self.lane(a0, d0, z0), self.lane(a1, d1, z1)]
        cbox(coll, name, min(p.x for p in ps), max(p.x for p in ps), min(p.y for p in ps), max(p.y for p in ps), z0, z1, self.m)

    def xy(self, a, d):
        """A point for the layout, in lane coordinates (the game turns it with the stretch)."""
        p = self.lane(a, d, 0)
        return [round(p.x, 3), round(p.y, 3)]


# --- parts (linked duplicates: six or more become one InstancedMesh in the game) ---------------------------

def lantern_geo():
    """A red silk lantern (宫灯 shape is too fussy for a lane: the round 红灯笼): 0.34 m, gold caps, a tassel, the cord."""
    g = Geo()
    ell(g, (0, 0, 0), (0.19, 0.19, 0.17), "lantern", nu=12, nv=8)
    cyl(g, 0, 0, 0.15, 0.2, 0.085, 0.085, 10, "gold", caps=(False, True))
    cyl(g, 0, 0, -0.2, -0.15, 0.085, 0.085, 10, "gold", caps=(True, False))
    cyl(g, 0, 0, -0.42, -0.2, 0.012, 0.05, 6, "tassel", caps=(True, False))
    cyl(g, 0, 0, 0.2, 0.75, 0.006, 0.006, 4, "iron", caps=(False, False))
    return g


def bollard_geo():
    """A granite bollard 0.42 x 0.42 x 0.55 m with a chamfered top."""
    g = Geo()
    g.box(-0.21, 0.21, -0.21, 0.21, 0.0, 0.48, "granite")
    g.poly([(-0.21, -0.21, 0.48), (0.21, -0.21, 0.48), (0.16, -0.16, 0.56), (-0.16, -0.16, 0.56)], "granite")
    g.poly([(0.21, -0.21, 0.48), (0.21, 0.21, 0.48), (0.16, 0.16, 0.56), (0.16, -0.16, 0.56)], "granite")
    g.poly([(0.21, 0.21, 0.48), (-0.21, 0.21, 0.48), (-0.16, 0.16, 0.56), (0.16, 0.16, 0.56)], "granite")
    g.poly([(-0.21, 0.21, 0.48), (-0.21, -0.21, 0.48), (-0.16, -0.16, 0.56), (-0.16, 0.16, 0.56)], "granite")
    g.poly([(-0.16, -0.16, 0.56), (0.16, -0.16, 0.56), (0.16, 0.16, 0.56), (-0.16, 0.16, 0.56)], "granite")
    return g


def palace_lamp_geo():
    """A palace-style street lamp: a dark green iron post 3.3 m on a stone foot, a six-sided glass lantern on top."""
    g = Geo()
    g.box(-0.2, 0.2, -0.2, 0.2, 0.0, 0.35, "granite")
    cyl(g, 0, 0, 0.35, 2.7, 0.07, 0.055, 8, "lampiron", caps=(False, False))
    cyl(g, 0, 0, 2.7, 2.78, 0.16, 0.16, 6, "lampiron")
    cyl(g, 0, 0, 2.78, 3.25, 0.2, 0.24, 6, "lampglass", caps=(False, False))
    for k in range(6):
        a = k * math.pi / 3
        x, y = 0.22 * math.cos(a), 0.22 * math.sin(a)
        g.box(x - 0.015, x + 0.015, y - 0.015, y + 0.015, 2.78, 3.25, "lampiron")
    cyl(g, 0, 0, 3.25, 3.32, 0.3, 0.3, 6, "lampiron")
    lathe(g, [(0.3, 3.32), (0.18, 3.45), (0.05, 3.55), (0.0, 3.62)], 6, "lampiron")
    return g


def bike_geo():
    """A parked town bike seen side-on along x: two wheels, the frame, a basket."""
    g = Geo()
    for wx in (-0.52, 0.52):
        n = 14
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            for r0, r1 in ((0.3, 0.34),):
                p = [(wx + r0 * math.cos(a0), 0, 0.34 + r0 * math.sin(a0)), (wx + r1 * math.cos(a0), 0, 0.34 + r1 * math.sin(a0)),
                     (wx + r1 * math.cos(a1), 0, 0.34 + r1 * math.sin(a1)), (wx + r0 * math.cos(a1), 0, 0.34 + r0 * math.sin(a1))]
                g.poly(p, "tyre")
                g.poly(p[::-1], "tyre")
    tubes = [((-0.52, 0.34), (0.0, 0.36)), ((0.0, 0.36), (-0.12, 0.85)), ((-0.12, 0.85), (0.4, 0.85)), ((0.0, 0.36), (0.4, 0.85)),
             ((0.52, 0.34), (0.4, 0.85)), ((0.4, 0.85), (0.44, 1.0)), ((-0.52, 0.34), (-0.12, 0.85))]
    for (x0, z0), (x1, z1) in tubes:
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz)
        nx, nz = -dz / L * 0.018, dx / L * 0.018
        for s in (-0.018, 0.018):
            g.poly([(x0 + nx, s, z0 + nz), (x1 + nx, s, z1 + nz), (x1 - nx, s, z1 - nz), (x0 - nx, s, z0 - nz)], "frame")
        g.poly([(x0 + nx, -0.018, z0 + nz), (x1 + nx, -0.018, z1 + nz), (x1 + nx, 0.018, z1 + nz), (x0 + nx, 0.018, z0 + nz)], "frame")
    g.box(-0.2, -0.05, -0.08, 0.08, 0.86, 0.92, "tyre")
    g.box(0.36, 0.5, -0.28, 0.28, 0.99, 1.02, "frame")
    g.box(0.46, 0.72, -0.15, 0.15, 0.78, 1.0, "basket")
    return g


def pot_geo():
    """A glazed flower pot with a clipped shrub."""
    g = Geo()
    lathe(g, [(0.18, 0.0), (0.26, 0.4), (0.28, 0.44), (0.0, 0.44)], 10, "pot")
    ell(g, (0, 0, 0.7), (0.3, 0.3, 0.32), "shrub", nu=8, nv=6)
    return g


def stool_geo():
    g = Geo()
    cyl(g, 0, 0, 0.42, 0.46, 0.17, 0.17, 10, "wood")
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        x, y = 0.12 * math.cos(a), 0.12 * math.sin(a)
        g.box(x - 0.02, x + 0.02, y - 0.02, y + 0.02, 0.0, 0.42, "wood")
    return g


def haws_geo():
    """One 冰糖葫芦 stick: five glazed red haws on a bamboo skewer."""
    g = Geo()
    cyl(g, 0, 0, 0.0, 0.42, 0.005, 0.005, 4, "bamboo", caps=(False, False))
    for k in range(5):
        ell(g, (0, 0, 0.12 + k * 0.058), (0.026, 0.026, 0.024), "haw", nu=6, nv=4)
    return g


def rabbit_geo():
    """A little 兔儿爷 figure for the crafts shelves: a red robe cone, a white face, two long ears, a gold helmet."""
    g = Geo()
    lathe(g, [(0.06, 0.0), (0.055, 0.1), (0.035, 0.16), (0.0, 0.17)], 8, "robe")
    ell(g, (0, 0, 0.2), (0.03, 0.03, 0.035), "face", nu=8, nv=5)
    for s in (-1, 1):
        ell(g, (s * 0.014, 0, 0.27), (0.008, 0.006, 0.04), "face", nu=5, nv=4)
    cyl(g, 0, 0, 0.225, 0.24, 0.032, 0.02, 8, "gold")
    return g


def cup_geo():
    g = Geo()
    lathe(g, [(0.035, 0.0), (0.045, 0.13), (0.0, 0.13)], 8, "cup")
    cyl(g, 0, 0, 0.13, 0.145, 0.046, 0.046, 8, "lid")
    return g


# --- the build -------------------------------------------------------------------------------------------

def crossings(side):
    """The hutongs opening on `side` of the lane."""
    return CROSSINGS + (CROSS_E if side == "e" else [])


def houhai_lots():
    """后海南沿's bars, on its south side only: two storeys mostly, glass and timber fronts, a board each."""
    rng = np.random.default_rng(701)
    lots, y = [], HH_S[0]
    for (a0, a1) in HH_ALLEYS + [(HH_S[1], HH_S[1])]:
        while a0 - y > 0.01:
            span = a0 - y
            wd = span if span < 7.6 else float(rng.choice([4.8, 5.4, 6.0, 6.6, 7.2]))
            if 0 < span - wd < 4.0:
                wd = span / 2 if span > 8 else span
            r = rng.random()
            kind = "modern" if r < 0.5 else "wood" if r < 0.85 else "brick"
            storeys = 2 if kind in ("wood", "modern") and rng.random() < 0.7 else 1
            lots.append(dict(side="w", y0=y, y1=y + wd, kind=kind, storeys=storeys, seed=int(rng.integers(1 << 30))))
            y += wd
        y = a1
    for i, lt in enumerate(lots):
        lt["sign"] = BAR_SIGNS[i % len(BAR_SIGNS)]
        if lt["kind"] in ("wood", "modern") and i % 3 == 1:
            lt["banner"] = ["酒", "茶", "咖啡"][i % 3]
    return lots


def lot_plan():
    """Every lot on both sides of every stretch: (side, y0, y1, kind, storeys, sign, banner, seed)."""
    rng = np.random.default_rng(501)
    lots = []
    for (s0, s1) in STRETCHES:
        for side in ("w", "e"):
            fixed = [(y0, y1, k) for k, (sd, y0, y1) in SHOPS.items() if sd == side and s0 <= y0 < s1]
            fixed += [(c0, c1, "gap") for (c0, c1) in crossings(side) if s0 < c0 < s1]
            if side == "e" and s0 <= YARD_GATE[0] < s1:
                fixed.append((YARD_GATE[0], YARD_GATE[1], "yard"))
            fixed.sort()
            y = s0
            for (f0, f1, k) in fixed + [(s1, s1, None)]:
                # fill y..f0 with lots 3.6-6.6 m wide
                span = f0 - y
                widths = []
                while span > 0.01:
                    if span < 7.2:
                        widths.append(span)
                        break
                    wd = float(rng.choice([3.6, 4.2, 4.8, 5.4, 6.0, 6.6]))
                    if span - wd < 3.4:
                        wd = span / 2 if span > 7.0 else span
                    widths.append(wd)
                    span -= wd
                for wd in widths:
                    r = rng.random()
                    kind = "wood" if r < 0.42 else "modern" if r < 0.62 else "brick" if r < 0.8 else "gate"
                    storeys = 2 if kind in ("wood", "modern") and rng.random() < 0.3 else 1
                    lots.append(dict(side=side, y0=y, y1=y + wd, kind=kind, storeys=storeys, seed=int(rng.integers(1 << 30))))
                    y += wd
                if k is None:
                    break
                if k == "yard":
                    lots.append(dict(side=side, y0=f0, y1=f1, kind="yard", storeys=1, seed=int(rng.integers(1 << 30))))
                elif k != "gap":
                    lots.append(dict(side=side, y0=f0, y1=f1, kind="shop", shop=k, storeys=1, seed=int(rng.integers(1 << 30))))
                y = f1
    # the corner lots on 地安门东大街 and 鼓楼东大街 are two storeys, faced on both streets
    for lt in lots:
        end = "s" if abs(lt["y0"] - Y0) < 1e-6 else "n" if abs(lt["y1"] - N1) < 1e-6 else None
        if end and lt["kind"] != "shop":
            lt["storeys"] = 2
            lt["kind"] = "wood"
            lt["corner"] = end
    # house numbers up each side, as the plates by the gates show them: odd on the east, even on the west
    for side, first in (("e", 1), ("w", 2)):
        for k, lt in enumerate(sorted((q for q in lots if q["side"] == side), key=lambda q: q["y0"])):
            lt["no"] = str(first + 2 * k)
    # boards: shops their own, the rest from the list (a gate has a house number instead)
    di = 0
    for lt in lots:
        if lt["kind"] == "shop":
            lt["sign"] = SHOP_SIGN[lt["shop"]]
        elif lt["kind"] not in ("gate", "yard"):
            lt["sign"] = DECO_SIGNS[di % len(DECO_SIGNS)]
            di += 1
    bi = 0
    for i, lt in enumerate(lots):
        if lt["kind"] in ("wood", "modern") and i % 3 == 1:
            lt["banner"] = BANNERS[bi % len(BANNERS)]
            bi += 1
    return lots


def build():
    global FONT_DATA
    clear_file()
    FONT_DATA = None
    ensure_addon()
    main = collection("南锣鼓巷")
    detail = collection("LOD0", main)
    parts = collection("parts", detail)
    helpers = collection("碰撞体")

    # ---- materials ----
    pav, pav_n = paving_image()
    brk, brk_n = brick_image()
    til, til_n = tiles_image()
    lac, lac_n = lacquer_image()
    wod, wod_n = wood_image()
    lots = lot_plan() if LANE else houhai_lots()
    names = list(SHOP_SIGN.values()) + [lt["sign"] for lt in lots if lt.get("sign") and lt["sign"] not in SHOP_SIGN.values()]
    if not LANE:
        names.append("游船码头")
    names = list(dict.fromkeys(names))
    signs, sign_cells = sign_atlas(names)
    banners, banner_cells = banner_atlas(BANNERS)
    numbers = [lt["no"] for lt in lots if lt["kind"] in ("gate", "yard") and in_part(lt["y0"])] or ["1"]
    plates, plate_cells, plate_h = plate_image(numbers)
    stele, stele_n = stele_image() if LANE else stele_image("银锭桥", "银锭观山 · 燕京小八景之一", "NL_SteleYD")
    goods, gcell = goods_atlas()
    goods_dim = dimmed(goods, "NL_GoodsDim", (0.85, 0.82, 0.78))
    goods_e = dimmed(goods, "NL_GoodsE", (0.3, 0.27, 0.24))
    pal_img = palette_image()
    backd = backdrop_atlas()
    brk_in = dimmed(brk, "NL_BrickIn", (0.55, 0.52, 0.48))
    wod_in = dimmed(wod, "NL_WoodIn", (0.75, 0.68, 0.62))
    pav_in = dimmed(pav, "NL_FloorIn", (0.62, 0.58, 0.52))

    def lit(name, color, rough, emit, props, tex=None, emit_tex=None, normal=None):
        m = material(name, color, rough, tex=tex, emit_tex=emit_tex, props=props, normal_tex=normal)
        b = m.node_tree.nodes.get("Principled BSDF")
        if emit_tex is None:
            b.inputs["Emission Color"].default_value = (*linear(emit), 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
        return m

    def inlit(name, color, rough=0.85):
        """A flat colour indoors: a little light of its own, like the dimmed pictures (nothing else lights a room)."""
        c = srgb3(color)
        e = "#%02x%02x%02x" % tuple(int(v * 255 * 0.16) for v in c)
        return lit(name, color, rough, e, {"glow": "none", "wet": "none"})

    flood = lambda s: {"glow": "flood", "glowStrength": s}  # noqa: E731
    M = {
        "paving": material("NL_paving", "#ffffff", 0.85, tex=pav, normal_tex=pav_n, props={"wet": "ground", "glow": "none", "layer": 8}),
        "brick": material("NL_brick", "#ffffff", 0.9, tex=brk, normal_tex=brk_n, props=flood(0.45)),
        "tiles": material("NL_tiles", "#ffffff", 0.75, tex=til, normal_tex=til_n, props=flood(0.25)),
        "ridge": material("NL_ridge", "#4b4e50", 0.8, props=flood(0.2)),
        "lacquer": material("NL_lacquer", "#ffffff", 0.5, tex=lac, normal_tex=lac_n, props=flood(0.5)),
        "wood": material("NL_wood", "#ffffff", 0.7, tex=wod, normal_tex=wod_n, props=flood(0.4)),
        "beam": material("NL_beam", "#ffffff", 0.6, tex=beam_image(), props=flood(0.5)),
        "lattice": material("NL_lattice", "#ffffff", 0.7, tex=lattice_image(), props={"cutout": 1, "glow": "flood", "glowStrength": 0.4}),
        "glass": material("NL_glass", "#2a2620", 0.08, props={"glassy": 0.38, "glow": "none"}),
        "sign": lit("NL_sign", "#ffffff", 0.45, "#000000", {"emit": "night", "glow": "none"}, tex=signs, emit_tex=signs),
        "banner": material("NL_banner", "#ffffff", 0.85, tex=banners, props=flood(0.5)),
        "couplet": material("NL_couplet", "#ffffff", 0.8, tex=couplet_image(), props=flood(0.5)),
        "plate": material("NL_plate", "#ffffff", 0.4, tex=plates, props=flood(0.5)),
        "reddoor": material("NL_reddoor", "#8e2219", 0.45, props=flood(0.5)),
        "granite": material("NL_granite", "#8f8c86", 0.85, props=flood(0.35)),
        "stele": material("NL_stele", "#ffffff", 0.8, tex=stele, normal_tex=stele_n, props=flood(0.6)),
        "plaster": material("NL_plaster", "#c9c3b5", 0.9, props=flood(0.4)),
        # kept low: the night's exposure lifts it several times, and a bright red tone-maps to pink
        "lantern": lit("NL_lantern", "#b8201a", 0.55, "#4a0703", {"emit": "night", "glow": "lamp", "glowColor": "#e0301c", "glowStrength": 0.12}),
        "gold": material("NL_gold", "#c49a3c", 0.35, 0.8, props={"glow": "none"}),
        "tassel": material("NL_tassel", "#e0b84a", 0.8, props={"glow": "none"}),
        "iron": material("NL_iron", "#2a2a2a", 0.6, 0.5, props={"glow": "none"}),
        "lampiron": material("NL_lampiron", "#1f2b24", 0.55, 0.4, props={"glow": "none"}),
        "lampglass": lit("NL_lampglass", "#e8dcc0", 0.3, "#ffd79a", {"emit": "night", "glow": "lamp", "glowColor": "#ffd28a", "glowStrength": 1.8}),
        "tyre": material("NL_tyre", "#1a1a1a", 0.8, props={"glow": "none"}),
        "frame": material("NL_frame", "#22303c", 0.4, 0.6, props={"glow": "none"}),
        "basket": material("NL_basket", "#7a6040", 0.8, props={"glow": "none"}),
        "pot": material("NL_pot", "#3b4f63", 0.3, props={"glow": "none"}),
        "shrub": material("NL_shrub", "#3a5a32", 0.85, props={"glow": "none"}),
        "steel": material("NL_steel", "#1d1f22", 0.4, 0.6, props=flood(0.3)),
        "lightbox": lit("NL_lightbox", "#ffffff", 0.4, "#000000", {"emit": "night", "glow": "none"}, tex=signs, emit_tex=signs),
        # the insides: dimmed pictures with a little light of their own (the room's lamps; nothing else lights them)
        "backdrop": lit("NL_backdrop", "#ffffff", 0.8, "#000000", {"glow": "none", "wet": "none"}, tex=backd, emit_tex=dimmed(backd, "NL_BackdropE", (0.35, 0.3, 0.24))),
        "inwall": lit("NL_inwall", "#d8d0c0", 0.9, "#2a2218", {"glow": "none", "wet": "none"}),
        "inbrick": lit("NL_inbrick", "#ffffff", 0.9, "#1c1712", {"glow": "none", "wet": "none"}, tex=brk_in),
        "infloor": lit("NL_infloor", "#ffffff", 0.7, "#140f0b", {"glow": "none", "wet": "none"}, tex=pav_in),
        "inwood": lit("NL_inwood", "#ffffff", 0.6, "#1a120c", {"glow": "none", "wet": "none"}, tex=wod_in),
        "ceiling": lit("NL_ceiling", "#a89a84", 0.9, "#221a12", {"glow": "none", "wet": "none"}),
        "goods": lit("NL_goods", "#ffffff", 0.6, "#000000", {"glow": "none", "wet": "none"}, tex=goods_dim, emit_tex=goods_e),
        "screen": lit("NL_screen", "#000000", 0.2, "#000000", {"glow": "none", "wet": "none"}, tex=goods, emit_tex=goods),
        "tube": lit("NL_tube", "#fff6e0", 0.3, "#fff1d0", {"glow": "none", "wet": "none"}),
        "neon": lit("NL_neon", "#ff3a9c", 0.3, "#ff3a9c", {"glow": "none", "wet": "none"}),
        "neon2": lit("NL_neon2", "#3ac8ff", 0.3, "#3ac8ff", {"glow": "none", "wet": "none"}),
        "cabinet": material("NL_cabinet", "#1c1c28", 0.4, 0.3, props={"glow": "none", "wet": "none"}),
        "counterglass": material("NL_counterglass", "#d8e4e8", 0.05, props={"glassy": 0.25, "glow": "none", "wet": "none"}),
        "haw": material("NL_haw", "#c4161c", 0.15, props={"glow": "none", "wet": "none"}),
        "bamboo": material("NL_bamboo", "#d8c08a", 0.6, props={"glow": "none", "wet": "none"}),
        "robe": material("NL_robe", "#c4261c", 0.4, props={"glow": "none", "wet": "none"}),
        "face": material("NL_face", "#f1e9da", 0.4, props={"glow": "none", "wet": "none"}),
        "cup": material("NL_cup", "#f2efe8", 0.3, props={"glow": "none", "wet": "none"}),
        "lid": material("NL_lid", "#c98a3a", 0.4, props={"glow": "none", "wet": "none"}),
        "cushion": material("NL_cushion", "#7a2a20", 0.8, props={"glow": "none", "wet": "none"}),
        "chrome": material("NL_chrome", "#b8bcc0", 0.2, 1.0, props={"glow": "none", "wet": "none"}),
        # round 2
        "mirror": material("NL_mirror", "#d0d6da", 0.03, 1.0, props={"glow": "none", "wet": "none"}),
        "pole": lit("NL_pole", "#ffffff", 0.3, "#000000", {"emit": "night", "glow": "none"}, tex=goods, emit_tex=goods_e),
        "coal": lit("NL_coal", "#3a1206", 0.9, "#ff4a10", {"glow": "lamp", "glowColor": "#ff6a20", "glowStrength": 0.5}),
        "awning": material("NL_awning", "#ffffff", 0.8, tex=awning_image(), props=flood(0.45)),
        "spot": lit("NL_spot", "#fff0d0", 0.3, "#ffd8a0", {"glow": "none", "wet": "none"}),
        "palette": lit("NL_palette", "#ffffff", 0.85, "#000000", {"glow": "none", "wet": "none"}, tex=pal_img, emit_tex=dimmed(pal_img, "NL_PaletteE", (0.16, 0.16, 0.16))),
    }
    M["rack"], M["steps"] = M["chrome"], M["granite"]
    TILE = {"paving": 4.0, "brick": 1.0, "tiles": 1.0, "lacquer": 1.0, "wood": 1.0, "plaster": 2.0, "granite": 1.0,
            "inbrick": 1.0, "infloor": 4.0, "inwood": 1.0, "inwall": 2.0, "ridge": 1.0, "steel": 1.0}

    g = Geo()            # everything unique, one object (merged per material in the game anyway)
    far = Geo()          # the far level: masses and roofs
    meshes = {
        "lantern": mesh_of(lantern_geo(), "lantern", M), "bollard": mesh_of(bollard_geo(), "bollard", M),
        "lamp": mesh_of(palace_lamp_geo(), "palacelamp", M), "bike": mesh_of(bike_geo(), "bike", M),
        "pot": mesh_of(pot_geo(), "pot", M), "stool": mesh_of(stool_geo(), "stool", M, TILE),
        "haws": mesh_of(haws_geo(), "haws", M), "rabbit": mesh_of(rabbit_geo(), "rabbit", M), "cup": mesh_of(cup_geo(), "cup", M),
    }
    counts = {k: 0 for k in meshes}

    def put(kind, m):
        place(meshes[kind], f"{kind}{counts[kind]}", parts, m)
        counts[kind] += 1

    def T(x, y, z, yaw=0.0):
        return Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Z")

    def atlas_uv(cell, cols, rows):
        c, r = cell
        u0, u1 = c / cols, (c + 1) / cols
        v1, v0 = 1 - r / rows, 1 - (r + 1) / rows
        return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]

    def sub_uv(u0, v0, u1, v1):
        return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]

    rng = np.random.default_rng(601)
    lamps_at, lantern_n = [], 0

    # ---- the lane's paving: up to each crossing hutong (a road: the city draws it) ----
    def pave(y0, y1):
        m = seg_m((y0 + y1) / 2)
        pts = [m @ Vector(p) for p in ((-HALF, y0, 0.03), (HALF, y0, 0.03), (HALF, y1, 0.03), (-HALF, y1, 0.03))]
        uv = [(-HALF / 4, y0 / 4), (HALF / 4, y0 / 4), (HALF / 4, y1 / 4), (-HALF / 4, y1 / 4)]
        for G in (g, far):
            G.polyn(pts, "paving", (0, 0, 1), uvs=uv)

    for (s0, s1) in (STRETCHES if LANE else []):
        y = s0 - (2.0 if s0 == Y0 else 0.1)
        for (c0, c1) in sorted(c for c in CROSSINGS if s0 < c[0] < s1) + [(s1 + 0.1, s1 + 0.1)]:
            if in_part((y + c0) / 2):
                pave(y, c0)
            y = c1

    # ---- each lot ----
    for li, lt in enumerate(lots):
        if not in_part(lt["y0"]):
            continue
        L = Lot(lt["side"], lt["y0"], lt["y1"])
        w = L.w
        lr = np.random.default_rng(lt["seed"])
        two = lt["storeys"] == 2
        EZ = (6.3 if two else 3.35) + float(lr.uniform(-0.12, 0.18))     # eave
        RZ = EZ + 1.9 + float(lr.uniform(-0.15, 0.15))                    # ridge
        BZ = 3.2                                                          # ground floor beam top
        kind = lt["kind"]
        shop = lt.get("shop")
        dep = DEPTH

        # roof: front and back slopes from the eaves (over the lane by OVER) to the ridge in the middle
        rd = dep / 2
        front_pts = [(0, -OVER, EZ - 0.18), (w, -OVER, EZ - 0.18), (w, rd, RZ), (0, rd, RZ)]
        back_pts = [(w, dep + OVER, EZ - 0.18), (0, dep + OVER, EZ - 0.18), (0, rd, RZ), (w, rd, RZ)]
        slope = math.hypot(rd + OVER, RZ - EZ + 0.18)
        roof_uv = [(0, 0), (w, 0), (w, slope), (0, slope)]
        for G in (g, far):
            L.quad(G, front_pts, "tiles", (0, -1, 1.6), roof_uv)
            L.quad(G, back_pts, "tiles", (0, 1, 1.6), roof_uv)
        # ridge, eave fascia (the drip tiles' row), soffit
        L.box(g, -0.05, w + 0.05, rd - 0.16, rd + 0.16, RZ - 0.05, RZ + 0.28, "ridge", skip=("-z",))
        for s in (0, 1):
            L.box(g, -0.08 if s == 0 else w - 0.25, 0.25 if s == 0 else w + 0.08, rd - 0.18, rd + 0.18, RZ + 0.2, RZ + 0.42, "ridge", skip=("-z",))
        L.box(g, 0, w, -OVER - 0.04, -OVER + 0.06, EZ - 0.34, EZ - 0.16, "ridge", skip=("+d",))
        L.quad(g, [(0, -OVER, EZ - 0.34), (w, -OVER, EZ - 0.34), (w, 0, EZ - 0.2), (0, 0, EZ - 0.2)], "wood", (0, 0, -1))
        # gable walls at both ends (shared with the neighbours; the outer ones are what shows at the hutong mouths)
        for a, na in ((0.0, -1), (w, 1)):
            L.quad(g, [(a, 0, 0), (a, dep, 0), (a, dep, EZ - 0.2), (a, rd, RZ), (a, 0, EZ - 0.2)], "brick", (na, 0, 0))
            L.quad(far, [(a, 0, 0), (a, dep, 0), (a, dep, EZ - 0.2), (a, rd, RZ), (a, 0, EZ - 0.2)], "brick", (na, 0, 0))
        # back wall to the courtyard (the yard's gate has its passage through it)
        if kind == "yard":
            pg0, pg1 = w / 2 - 0.7, w / 2 + 0.7
            for (b0, b1, c0, c1) in ((0, pg0, 0, EZ - 0.2), (pg1, w, 0, EZ - 0.2), (pg0, pg1, 2.55, EZ - 0.2)):
                L.quad(g, [(b0, dep, c0), (b1, dep, c0), (b1, dep, c1), (b0, dep, c1)], "brick", (0, 1, 0))
        else:
            L.quad(g, [(0, dep, 0), (w, dep, 0), (w, dep, EZ - 0.2), (0, dep, EZ - 0.2)], "brick", (0, 1, 0))
        L.quad(far, [(0, dep, 0), (w, dep, 0), (w, dep, EZ - 0.2), (0, dep, EZ - 0.2)], "brick", (0, 1, 0))
        # the far level's front: one brick face with the sign
        L.front(far, 0, w, 0, EZ - 0.2, "brick")

        # the corner lots' face to 地安门东大街 (its a-end at the south) or 鼓楼东大街 (the north)
        if lt.get("corner"):
            west = lt["side"] == "w"
            if lt["corner"] == "s":
                south_a, nrm = (0.0, -1) if west else (w, 1)
            else:
                south_a, nrm = (w, 1) if west else (0.0, -1)
            for (d0, d1) in ((1.2, 2.8), (4.2, 5.8)):
                for (z0, z1) in ((0.9, 2.4), (3.9, 5.4)):
                    e = nrm * 0.02
                    L.quad(g, [(south_a + e, d0, z0), (south_a + e, d1, z0), (south_a + e, d1, z1), (south_a + e, d0, z1)], "glass", (nrm, 0, 0))
                    L.quad(g, [(south_a + 2 * e, d0, z0), (south_a + 2 * e, d1, z0), (south_a + 2 * e, d1, z1), (south_a + 2 * e, d0, z1)], "lattice", (nrm, 0, 0),
                           [(0, 0), (1, 0), (1, 1.4), (0, 1.4)])
            L.box(g, south_a - 0.06 if nrm < 0 else south_a - 0.02, south_a + 0.02 if nrm < 0 else south_a + 0.06, 0, dep, 3.15, 3.5, "beam",
                  uvs={("-a" if nrm < 0 else "+a"): [(0, 0), (dep / 1.5, 0), (dep / 1.5, 1), (0, 1)]})

        # ---- the front ----
        posts = [0.14, w - 0.14]
        if w > 5.0:
            posts.insert(1, w / 2)
        door = (w / 2 - 0.85, w / 2 + 0.85)
        if shop:
            door = (w / 2 - 0.85, w / 2 + 0.85)

        def lattice_window(a0, a1, z0, z1, glass=True):
            if glass:
                L.front(g, a0, a1, z0, z1, "glass", d=0.06)
            L.front(g, a0, a1, z0, z1, "lattice", d=0.0, uvs=[(0, 0), ((a1 - a0) / 1.1, 0), ((a1 - a0) / 1.1, (z1 - z0) / 1.1), (0, (z1 - z0) / 1.1)])
            for (b0, b1, c0, c1) in ((a0 - 0.05, a1 + 0.05, z0 - 0.06, z0), (a0 - 0.05, a1 + 0.05, z1, z1 + 0.06), (a0 - 0.06, a0, z0, z1), (a1, a1 + 0.06, z0, z1)):
                L.box(g, b0, b1, -0.05, 0.03, c0, c1, "wood", skip=("+d",))

        def shallow_inside(a0, a1, z0, z1, variant):
            """A lit room 1.4 m deep behind the glass of a shop you cannot enter."""
            D = 1.4
            c, r = variant % 2, variant // 2
            uv = sub_uv(c * 0.5, 1 - (r + 1) / 3, (c + 1) * 0.5, 1 - r / 3)
            L.front(g, a0, a1, z0, z1, "backdrop", d=D, uvs=uv)
            L.quad(g, [(a0, 0.1, z0), (a1, 0.1, z0), (a1, D, z0), (a0, D, z0)], "infloor", (0, 0, 1))
            L.quad(g, [(a0, 0.1, z1), (a0, D, z1), (a1, D, z1), (a1, 0.1, z1)], "ceiling", (0, 0, -1))
            L.quad(g, [(a0, 0.1, z0), (a0, D, z0), (a0, D, z1), (a0, 0.1, z1)], "inwall", (1, 0, 0))
            L.quad(g, [(a1, 0.1, z0), (a1, 0.1, z1), (a1, D, z1), (a1, D, z0)], "inwall", (-1, 0, 0))

        if kind == "brick":
            win = (w * 0.2, w * 0.2 + 1.3)
            dr = (w * 0.62, w * 0.62 + 0.95)
            # wall around a window and a door
            holes = [(win[0], win[1], 1.0, 2.2), (dr[0], dr[1], 0.0, 2.15)]
            ys = sorted({0.0, w, *[v for h in holes for v in h[:2]]})
            for a0, a1 in zip(ys, ys[1:]):
                gaps = sorted((h[2], h[3]) for h in holes if h[0] <= a0 + 1e-4 and h[1] >= a1 - 1e-4)
                z = 0.0
                for za, zb in gaps + [(EZ - 0.2, EZ - 0.2)]:
                    if za - z > 1e-4:
                        L.front(g, a0, a1, z, za, "brick")
                    z = max(z, zb)
            lattice_window(win[0], win[1], 1.0, 2.2)
            L.front(g, win[0], win[1], 1.0, 2.2, "backdrop", d=0.3, uvs=sub_uv(0.5, 0, 1, 1 / 3))
            L.front(g, dr[0], dr[1], 0.0, 2.15, "wood", d=0.12)
            for (b0, b1, c0, c1) in ((dr[0] - 0.08, dr[1] + 0.08, 2.15, 2.25), (dr[0] - 0.08, dr[0], 0, 2.15), (dr[1], dr[1] + 0.08, 0, 2.15)):
                L.box(g, b0, b1, -0.06, 0.12, c0, c1, "lacquer", skip=("+d",))
            # a brick cornice under the eave
            L.box(g, 0, w, -0.12, 0.0, EZ - 0.5, EZ - 0.3, "brick", skip=("+d",))
        elif kind in ("gate", "yard"):
            gw, gd = 1.4, 0.75
            g0, g1 = w / 2 - gw / 2, w / 2 + gw / 2
            for (a0, a1) in ((0, g0), (g1, w)):
                L.front(g, a0, a1, 0, EZ - 0.2, "brick")
            L.front(g, g0, g1, 2.55, EZ - 0.2, "brick")
            # the recess: brick sides, a red double door at its back, 门簪 over it, couplets, 门墩 at its mouth
            L.quad(g, [(g0, 0, 0), (g0, gd, 0), (g0, gd, 2.55), (g0, 0, 2.55)], "brick", (1, 0, 0))
            L.quad(g, [(g1, 0, 0), (g1, 0, 2.55), (g1, gd, 2.55), (g1, gd, 0)], "brick", (-1, 0, 0))
            L.quad(g, [(g0, 0, 2.55), (g1, 0, 2.55), (g1, gd, 2.55), (g0, gd, 2.55)], "wood", (0, 0, -1))
            L.quad(g, [(g0, 0.03, 0.03), (g1, 0.03, 0.03), (g1, gd, 0.03), (g0, gd, 0.03)], "granite", (0, 0, 1))
            if kind == "yard":
                # the doors stand open against the passage's sides; the passage runs through to the yard
                for (a, n) in ((g0 + 0.06, 1), (g1 - 0.06, -1)):
                    L.quad(g, [(a, gd, 0.12), (a, gd + 0.62, 0.12), (a, gd + 0.62, 2.35), (a, gd, 2.35)] if n > 0 else
                           [(a, gd, 0.12), (a, gd, 2.35), (a, gd + 0.62, 2.35), (a, gd + 0.62, 0.12)], "reddoor", (n, 0, 0))
                L.quad(g, [(g0, gd, 0.035), (g1, gd, 0.035), (g1, dep, 0.035), (g0, dep, 0.035)], "granite", (0, 0, 1))
                L.quad(g, [(g0, gd, 0), (g0, dep, 0), (g0, dep, 2.55), (g0, gd, 2.55)], "brick", (1, 0, 0))
                L.quad(g, [(g1, gd, 0), (g1, gd, 2.55), (g1, dep, 2.55), (g1, dep, 0)], "brick", (-1, 0, 0))
                L.quad(g, [(g0, gd, 2.55), (g1, gd, 2.55), (g1, dep, 2.55), (g0, dep, 2.55)], "wood", (0, 0, -1))
            else:
                L.front(g, g0 + 0.05, w / 2 - 0.01, 0.12, 2.35, "reddoor", d=gd)
                L.front(g, w / 2 + 0.01, g1 - 0.05, 0.12, 2.35, "reddoor", d=gd)
            L.front(g, g0 + 0.12, g0 + 0.32, 0.6, 2.1, "couplet", d=gd - 0.01, uvs=sub_uv(0, 0.29, 0.5, 1))
            L.front(g, g1 - 0.32, g1 - 0.12, 0.6, 2.1, "couplet", d=gd - 0.01, uvs=sub_uv(0.5, 0.29, 1, 1))
            L.front(g, w / 2 - 0.2, w / 2 + 0.2, 1.3, 1.7, "couplet", d=gd - 0.01, uvs=sub_uv(0, 0, 1, 0.27))
            L.box(g, g0, g1, gd - 0.12, gd, 2.35, 2.55, "lacquer", skip=("+d",))
            for k in range(4):
                a = g0 + 0.25 + k * (gw - 0.5) / 3
                L.box(g, a - 0.05, a + 0.05, gd - 0.24, gd - 0.12, 2.4, 2.5, "gold")
            for a in (g0 + 0.2, g1 - 0.2):
                L.box(g, a - 0.14, a + 0.14, -0.15, 0.25, 0.0, 0.42, "granite")
                cg = Geo()
                cyl(cg, 0, 0, -0.1, 0.1, 0.2, 0.2, 12, "granite", caps=(True, True))
                g.add(cg, L.M(a, 0.05, 0.62) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
            # the house number beside the gate
            c, r = plate_cells[lt["no"]]
            rows = plate_h // 128
            L.front(g, g1 + 0.2, g1 + 0.6, 1.9, 2.1, "plate", d=-0.01, uvs=atlas_uv((c, r), 4, rows))
            L.box(g, 0, w, -0.12, 0.0, EZ - 0.5, EZ - 0.3, "brick", skip=("+d",))
        elif shop == "grill":
            # a stall open to the lane: a counter with the grill on it under a striped awning, a little room behind
            SD = 3.2
            L.front(g, 0, 0.2, 0, BZ, "brick")
            L.front(g, w - 0.2, w, 0, BZ, "brick")
            L.front(g, 0, w, 2.6, BZ - 0.32, "wood", d=0.04)
            L.box(g, 0, w, -0.14, 0.04, BZ - 0.32, BZ, "beam", skip=("+d",), uvs={"-d": [(0, 0), (w / 1.5, 0), (w / 1.5, 1), (0, 1)]})
            L.front(g, 0, w, BZ, EZ - 0.2, "wood")
            L.box(g, 0.3, w - 0.3, 0.05, 0.65, 0, 0.9, "wood", skip=("-z",))
            L.box(g, 0.25, w - 0.25, 0.0, 0.7, 0.9, 0.95, "steel")
            L.box(g, 0.55, w - 1.1, 0.12, 0.5, 0.95, 1.08, "iron", skip=("-z", "+z"))
            L.quad(g, [(0.55, 0.12, 1.06), (w - 1.1, 0.12, 1.06), (w - 1.1, 0.5, 1.06), (0.55, 0.5, 1.06)], "coal", (0, 0, 1))
            for k in range(int((w - 1.85) / 0.17)):
                a = 0.68 + k * 0.17
                L.box(g, a - 0.006, a + 0.006, 0.02, 0.6, 1.1, 1.112, "bamboo")
                for j in range(4):
                    dd = 0.18 + j * 0.075
                    L.box(g, a - 0.016, a + 0.016, dd - 0.025, dd + 0.025, 1.09, 1.13, "meat")
            # a tray of skewers waiting at the counter's end
            L.box(g, w - 1.0, w - 0.4, 0.1, 0.55, 0.95, 0.99, "steel")
            for k in range(8):
                L.box(g, w - 0.95 + k * 0.07, w - 0.93 + k * 0.07, 0.12, 0.52, 0.99, 1.02, "meat")
            # the awning
            L.quad(g, [(0, -1.15, 2.3), (w, -1.15, 2.3), (w, 0.02, 2.62), (0, 0.02, 2.62)], "awning", (0, -0.4, 1), [(0, 0), (w / 1.2, 0), (w / 1.2, 1), (0, 1)])
            L.quad(g, [(0, 0.02, 2.6), (w, 0.02, 2.6), (w, -1.15, 2.28), (0, -1.15, 2.28)], "awning", (0, 0.4, -1), [(0, 0), (w / 1.2, 0), (w / 1.2, 1), (0, 1)])
            L.front(g, 0, w, 2.05, 2.3, "awning", d=-1.15, uvs=[(0, 0), (w / 1.2, 0), (w / 1.2, 1), (0, 1)])
            for a in (0.1, w - 0.1):
                L.box(g, a - 0.025, a + 0.025, -1.15, -1.1, 0, 2.3, "iron")
            # the little room: floor, ceiling, walls, the menu, a lamp
            L.quad(g, [(0.2, 0.0, 0.035), (w - 0.2, 0.0, 0.035), (w - 0.2, SD, 0.035), (0.2, SD, 0.035)], "infloor", (0, 0, 1))
            L.quad(g, [(0.2, 0.0, 2.6), (0.2, SD, 2.6), (w - 0.2, SD, 2.6), (w - 0.2, 0.0, 2.6)], "ceiling", (0, 0, -1))
            L.quad(g, [(0.2, 0.0, 0), (0.2, SD, 0), (0.2, SD, 2.6), (0.2, 0.0, 2.6)], "inbrick", (1, 0, 0))
            L.quad(g, [(w - 0.2, 0.0, 0), (w - 0.2, 0.0, 2.6), (w - 0.2, SD, 2.6), (w - 0.2, SD, 0)], "inbrick", (-1, 0, 0))
            L.front(g, 0.2, w - 0.2, 0, 2.6, "backdrop", d=SD, uvs=sub_uv(0, 0, 0.5, 1 / 3))
            L.front(g, w / 2 - 0.85, w / 2 + 0.85, 1.55, 2.4, "goods", d=SD - 0.02, uvs=sub_uv(*gcell["menu_grill"]))
            L.box(g, w / 2 - 0.6, w / 2 + 0.6, 1.6, 1.68, 2.54, 2.59, "tube")
        else:
            # timber fronts: wood, modern, shop, and the upper storey of the two-storey ones
            bays = []
            pa = [0.0] + posts + [w]
            edges = sorted(set([p for p in posts]))
            cuts = [0.0] + edges + [w]
            for a0, a1 in zip(cuts, cuts[1:]):
                bays.append((a0 + (0.12 if a0 > 0 else 0.26), a1 - (0.12 if a1 < w else 0.26)))
            if kind == "modern":
                # a black steel shopfront: plate glass, a lightbox over it, a glass door in the middle
                L.front(g, 0, 0.26, 0, BZ, "steel")
                L.front(g, w - 0.26, w, 0, BZ, "steel")
                L.front(g, 0.26, w - 0.26, 0, 0.3, "steel")
                L.front(g, 0.26, w - 0.26, 0.3, 2.55, "glass", d=0.04)
                for a in [0.26 + k * (w - 0.52) / 3 for k in range(4)]:
                    L.box(g, a - 0.03, a + 0.03, -0.04, 0.04, 0.3, 2.55, "steel", skip=("+d",))
                L.box(g, 0.2, w - 0.2, -0.04, 0.04, 2.5, 2.58, "steel", skip=("+d",))
                shallow_inside(0.26, w - 0.26, 0.04, 2.55, lt["seed"] % 6)
                L.front(g, 0, w, 2.58, EZ - 0.2, "wood")
            else:
                # posts, sills, lattice windows, the door bay
                for p in posts:
                    cg = Geo()
                    cyl(cg, 0, 0, 0.0, BZ - 0.32, 0.12, 0.12, 10, "lacquer", caps=(False, False))
                    cyl(cg, 0, 0, 0.0, 0.18, 0.18, 0.15, 10, "granite", caps=(False, True))
                    g.add(cg, L.M(p, -0.08, 0))
                    L.front(g, p - 0.13, p + 0.13, 0, BZ, "lacquer", d=0.0)
                for bi, (a0, a1) in enumerate(bays):
                    is_door = a0 <= w / 2 <= a1
                    if is_door:
                        d0, d1 = (door if shop else (max(a0, w / 2 - 0.8), min(a1, w / 2 + 0.8)))
                        if a0 < d0:
                            L.front(g, a0, d0, 0, 0.8, "brick")
                            lattice_window(a0 + 0.06, d0 - 0.06, 0.86, 2.35)
                            if not shop:
                                shallow_inside(a0, d0, 0.04, 2.35, (lt["seed"] + bi) % 6)
                        if d1 < a1:
                            L.front(g, d1, a1, 0, 0.8, "brick")
                            lattice_window(d1 + 0.06, a1 - 0.06, 0.86, 2.35)
                            if not shop:
                                shallow_inside(d1, a1, 0.04, 2.35, (lt["seed"] + bi + 1) % 6)
                        # the transom over the door and its frame
                        lattice_window(d0, d1, 2.42, BZ - 0.36)
                        for (b0, b1) in ((d0 - 0.07, d0), (d1, d1 + 0.07)):
                            L.box(g, b0, b1, -0.06, 0.1, 0, 2.42, "lacquer", skip=("+d",))
                        L.box(g, d0 - 0.07, d1 + 0.07, -0.06, 0.1, 2.36, 2.42, "lacquer", skip=("+d",))
                        if not shop:
                            # closed lattice doors (隔扇) with glass, a lit room behind
                            for k in range(2):
                                e0 = d0 + k * (d1 - d0) / 2 + 0.02
                                e1 = d0 + (k + 1) * (d1 - d0) / 2 - 0.02
                                L.front(g, e0, e1, 0.05, 0.9, "wood", d=0.02)
                                lattice_window(e0 + 0.06, e1 - 0.06, 0.96, 2.3)
                            shallow_inside(d0, d1, 0.04, 2.35, (lt["seed"] + 2) % 6)
                        else:
                            # the open doorway's sill and reveals
                            L.quad(g, [(d0, -0.05, 0.035), (d1, -0.05, 0.035), (d1, 0.15, 0.035), (d0, 0.15, 0.035)], "granite", (0, 0, 1))
                    else:
                        L.front(g, a0, a1, 0, 0.8, "brick")
                        L.box(g, a0, a1, -0.06, 0.04, 0.8, 0.86, "wood", skip=("+d",))
                        lattice_window(a0 + 0.06, a1 - 0.06, 0.86, 2.35)
                        if not shop:
                            shallow_inside(a0, a1, 0.04, 2.35, (lt["seed"] + bi) % 6)
                    # the strip under the beam
                    L.front(g, a0, a1, 2.35 if not is_door else BZ - 0.36, BZ - 0.32, "wood", d=0.04)
                    lattice_window(a0 + 0.06, a1 - 0.06, 2.42, BZ - 0.36, glass=False) if not is_door else None
                # the posts' wall ends at the lot's edges
                L.front(g, 0, 0.26, 0, BZ, "brick")
                L.front(g, w - 0.26, w, 0, BZ, "brick")
            # the painted beam over the ground floor, and above it to the eave
            L.box(g, 0, w, -0.14, 0.04, BZ - 0.32, BZ, "beam", skip=("+d",),
                  uvs={"-d": [(0, 0), (w / 1.5, 0), (w / 1.5, 1), (0, 1)]})
            if not two:
                L.front(g, 0, w, BZ, EZ - 0.2, "wood")
            else:
                # a balcony over the ground floor, an upper storey of lattice windows behind it
                L.box(g, 0, w, -0.7, 0.0, BZ, BZ + 0.14, "wood")
                L.front(g, 0, w, BZ, EZ - 0.2, "plaster")
                for (a0, a1) in bays:
                    lattice_window(a0 + 0.1, a1 - 0.1, BZ + 0.6, EZ - 0.75)
                    L.front(g, a0 + 0.1, a1 - 0.1, BZ + 0.6, EZ - 0.75, "backdrop", d=0.5, uvs=sub_uv(0, 2 / 3, 0.5, 1))
                for p in posts + [0.05, w - 0.05]:
                    L.box(g, p - 0.07, p + 0.07, -0.68, -0.54, BZ + 0.14, EZ - 0.3, "lacquer")
                L.box(g, 0, w, -0.7, -0.62, BZ + 0.14, BZ + 0.95, "lattice", uvs={"-d": [(0, 0), (w / 0.8, 0), (w / 0.8, 1), (0, 1)]})
                L.box(g, 0, w, -0.72, -0.6, BZ + 0.95, BZ + 1.02, "lacquer")
                L.box(g, 0, w, -0.72, -0.5, EZ - 0.5, EZ - 0.3, "beam", skip=("+d",), uvs={"-d": [(0, 0), (w / 1.5, 0), (w / 1.5, 1), (0, 1)]})
                # the balcony's underside lanterns are the ground floor's
            # the signboard over the door (a lightbox on a modern front)
            if lt.get("sign"):
                name = lt["sign"]
                c, r = sign_cells[name]
                sw = min(2.6, w - 0.9)
                sh = sw / 4
                z0 = BZ - 0.3 - sh * 0.2 if kind != "modern" else 2.62
                key = "lightbox" if kind == "modern" else "sign"
                L.box(g, w / 2 - sw / 2 - 0.04, w / 2 + sw / 2 + 0.04, -0.24, -0.15, z0 - 0.04, z0 + sh + 0.04, "wood" if key == "sign" else "steel", skip=("+d",))
                L.front(g, w / 2 - sw / 2, w / 2 + sw / 2, z0, z0 + sh, key, d=-0.245, uvs=atlas_uv((c, r), 4, 16))
            # a cloth banner on a bracket at the left post
            if lt.get("banner"):
                c, r = banner_cells[lt["banner"]]
                a = posts[0] + 0.05
                uv = atlas_uv((c, r), 8, 2)
                for s in (1, -1):
                    L.quad(g, [(a + 0.005 * s, -0.3, 1.25), (a + 0.005 * s, -0.75, 1.25), (a + 0.005 * s, -0.75, 2.85), (a + 0.005 * s, -0.3, 2.85)], "banner", (s, 0, 0), uv)
                L.box(g, a - 0.02, a + 0.02, -0.85, -0.1, 2.85, 2.9, "iron")

        # lanterns under the eave, one at each post (or a pair on a narrow brick front)
        la = posts if kind not in ("brick", "gate", "yard") else [w * 0.25, w * 0.75]
        for a in la:
            put("lantern", L.M(a, -0.5, EZ - 1.05))
            lantern_n += 1

        # colliders: the whole mass for a front you cannot enter; the yard's gate round its passage
        if kind == "yard":
            L.col(helpers, f"lot{li}a", 0, w / 2 - 0.7, 0, dep, 0, EZ)
            L.col(helpers, f"lot{li}b", w / 2 + 0.7, w, 0, dep, 0, EZ)
            L.col(helpers, f"lot{li}c", w / 2 - 0.7, w / 2 + 0.7, 0, dep, 2.55, EZ)
        elif not shop:
            L.col(helpers, f"lot{li}", 0, w, 0, dep, 0, EZ)
        lt["EZ"], lt["L"] = EZ, L

    # ---- the back row: courtyard houses behind (seen over the front roofs and from the air) ----
    def back_runs(side):
        """The stretches of the back row: between the crossings, and on the east round the courtyard."""
        cuts = crossings(side) + ([YARD] if side == "e" else [])
        for (s0, s1) in STRETCHES:
            y = s0 + 0.5
            for (c0, c1) in sorted(c for c in cuts if c[1] > s0 and c[0] < s1) + [(s1, s1)]:
                if c0 - y > 3:
                    yield y, min(c0, s1)
                y = max(y, c1 + 0.5)

    back = [(side, a, b) for side in ("w", "e") for (a, b) in back_runs(side)] if LANE else [("w", HH_S[0] + 0.5, HH_S[1] - 0.5)]
    rng_n = np.random.default_rng(611)      # the north's own (the south's houses stay as they were)
    for side, r0, r1 in back:
        R = rng if r0 < N0 else rng_n
        y = r0
        while y < r1 - 3:
            wd = float(R.uniform(7, 12))
            y1 = min(r1, y + wd)
            if r1 - y1 < 3:
                y1 = r1
            L = Lot(side, y, y1)
            EZ, RZ = 3.0 + float(R.uniform(-0.2, 0.2)), 4.7 + float(R.uniform(-0.2, 0.2))
            if not in_part(y):
                y = y1 + float(R.uniform(0.5, 2.5))
                continue
            d0, d1 = BACK0, BACK1
            md = (d0 + d1) / 2
            w = L.w
            uv = [(0, 0), (w, 0), (w, 3.5), (0, 3.5)]
            for G in (g, far):
                L.quad(G, [(0, d0 - 0.5, EZ), (w, d0 - 0.5, EZ), (w, md, RZ), (0, md, RZ)], "tiles", (0, -1, 1.6), uv)
                L.quad(G, [(w, d1 + 0.5, EZ), (0, d1 + 0.5, EZ), (0, md, RZ), (w, md, RZ)], "tiles", (0, 1, 1.6), uv)
                for a, na in ((0.0, -1), (w, 1)):
                    L.quad(G, [(a, d0, 0), (a, d1, 0), (a, d1, EZ), (a, md, RZ), (a, d0, EZ)], "brick", (na, 0, 0))
                L.front(G, 0, w, 0, EZ, "brick", d=d0)
                L.quad(G, [(0, d1, 0), (w, d1, 0), (w, d1, EZ), (0, d1, EZ)], "brick", (0, 1, 0))
            L.box(g, -0.05, w + 0.05, md - 0.14, md + 0.14, RZ - 0.05, RZ + 0.22, "ridge", skip=("-z",))
            for k in range(max(1, int(w // 3.2))):
                a = (k + 0.5) * w / max(1, int(w // 3.2))
                L.front(g, a - 0.55, a + 0.55, 0.9, 2.2, "lattice", d=d0 - 0.01, uvs=[(0, 0), (1, 0), (1, 1.2), (0, 1.2)])
            L.col(helpers, f"back{side}{int(y)}", 0, w, d0, d1, 0, EZ)
            y = y1 + float(R.uniform(0.5, 2.5))

    # ---- the mouths' stones, the bollards ----
    def stele(x, y, yaw, name):
        sg = Geo()
        sg.box(-1.05, 1.05, -0.3, 0.3, 0.0, 0.35, "granite")
        # granite all round, the lettering on its face only (the box's other faces had it too: 「南」 on the side)
        sg.box(-0.9, 0.9, -0.2, 0.2, 0.35, 1.45, "granite", skip=("-y",))
        sg.polyn([(-0.9, -0.2, 0.35), (0.9, -0.2, 0.35), (0.9, -0.2, 1.45), (-0.9, -0.2, 1.45)], "stele", (0, -1, 0), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        sg.box(-0.95, 0.95, -0.24, 0.24, 1.45, 1.55, "granite")
        g.add(sg, seg_m(y) @ T(x, y, 0, yaw))
        cbox(helpers, name, x - 1.0, x + 1.0, y - 0.6, y + 0.6, 0, 1.6)

    if LANE and in_part(2.6):
        stele(2.3, 2.6, math.radians(-25), "stele")
    if LANE and in_part(N1 - 2.0):
        # the north mouth's, facing 鼓楼东大街
        stele(-2.3, N1 - 2.0, math.radians(180 + 25), "stele_n")
    # bollards across the lane at the mouths and either side of each crossing hutong, never in the hutong itself
    # (a road cars use: round 1 had three across 福祥胡同 and a row in 板厂胡同's eastbound lane)
    rows = [0.4, N1 - 0.4] + [y for (c0, c1) in CROSSINGS for y in (c0 - 0.5, c1 + 0.5)]
    rows = sorted({round(y, 2) for y in rows if Y0 - 1 < y < N1 + 1 and not any(c0 < y < c1 for c0, c1 in CROSSINGS)})
    bollards = [(x, y) for y in rows for x in (-3.0, -1.5, 0.0, 1.5, 3.0) if LANE and in_part(y)]
    for i, (x, y) in enumerate(bollards):
        put("bollard", seg_m(y) @ T(x, y, 0))
        cbox(helpers, f"bollard{i}", x - 0.21, x + 0.21, y - 0.21, y + 0.21, 0, 0.56)

    # ---- palace lamps, bikes, pots, the trees' places ----
    shop_spans = [(s, y0 - 0.5, y1 + 0.5) for s, y0, y1 in SHOPS.values()]
    free = lambda side, y: not any(s == side and y0 <= y <= y1 for s, y0, y1 in shop_spans)  # noqa: E731
    clear_of = lambda y, r: not any(c0 - r < y < c1 + r for c0, c1 in CROSSINGS + CROSS_E)  # noqa: E731
    lamp_ys = [9.0, 27.0, 45.0, 63.0, 81.0, 99.0, 117.0, 135.0, 154.0, 172.0, 190.0, 208.0]
    lamp_ys += [y for y in (232.0 + 18.0 * i for i in range(32)) if y < N1 - 4 and clear_of(y, 2.0)]
    for k, y in enumerate(lamp_ys):
        x = 3.15 if k % 2 == 0 else -3.15
        lamps_at.append([x, y])
        if not LANE or not in_part(y):
            continue
        put("lamp", seg_m(y) @ T(x, y, 0))
        cbox(helpers, f"lamp{k}", x - 0.2, x + 0.2, y - 0.2, y + 0.2, 0, 3.3)
    bk = 0
    for lt in lots:
        if "L" not in lt or not in_part(lt["y0"]):
            continue
        if lt["kind"] in ("wood", "modern", "brick") and lt["seed"] % 4 == 0 and free(lt["side"], (lt["y0"] + lt["y1"]) / 2):
            L = lt["L"]
            put("bike", L.M(0.9 + (lt["seed"] % 3) * 0.3, -0.55, 0, yaw=0.12))
            bk += 1
        if lt["kind"] in ("wood", "gate") and lt["seed"] % 3 == 1:
            L = lt["L"]
            put("pot", L.M(0.45, -0.35, 0))
            put("pot", L.M(L.w - 0.45, -0.35, 0))
    # strings of small lanterns across the lane, eave to eave, sagging a little
    strings = [y for y in [12.0 + 11.5 * i for i in range(12)] + [155.0 + 11.5 * i for i in range(6)]
               if (y < Y1 - 4 or M0 + 3 < y < M1 - 3) and not any(c0 - 1.5 < y < c1 + 1.5 for c0, c1 in CROSSINGS)]
    strings += [y for y in (229.0 + 11.5 * i for i in range(50)) if y < N1 - 4 and clear_of(y, 1.5)]
    for k, y in enumerate(strings):
        if not LANE or not in_part(y):
            continue
        m = seg_m(y)
        sgeo = Geo()
        z0, sag, n = 3.15, 0.35, 6
        pts = [(-HALF + 0.2 + (2 * HALF - 0.4) * i / 10, y, z0 - sag * (1 - ((i / 10) * 2 - 1) ** 2)) for i in range(11)]
        for (x0, _, za), (x1, _, zb) in zip(pts, pts[1:]):
            sgeo.poly([(x0, y - 0.006, za), (x1, y - 0.006, zb), (x1, y + 0.006, zb), (x0, y + 0.006, za)], "iron")
            sgeo.poly([(x0, y, za + 0.008), (x1, y, zb + 0.008), (x1, y, zb - 0.008), (x0, y, za - 0.008)], "iron")
        g.add(sgeo, m)
        for i in range(n):
            u = (i + 0.5) / n
            x = -HALF + 0.2 + (2 * HALF - 0.4) * u
            z = z0 - sag * (1 - (u * 2 - 1) ** 2)
            put("lantern", m @ T(x, y, z - 0.75 * 0.62) @ Matrix.Diagonal((0.62, 0.62, 0.62, 1)))
            lantern_n += 1
    trees = []
    tree_at = [(-2.75, 18.0), (2.75, 36.5), (-2.75, 54.0), (2.75, 74.0), (-2.75, 90.0), (2.75, 108.0), (-2.75, 126.0),
               (-2.75, 152.5), (2.75, 168.0), (-2.75, 180.0), (2.75, 196.0), (-2.75, 211.0)]
    tree_at += [(2.75 if i % 2 else -2.75, y) for i, y in enumerate(240.5 + 17.5 * j for j in range(32)) if y < N1 - 6 and clear_of(y, 3.0)]
    for k, (x, y) in enumerate(tree_at):
        if not LANE or not in_part(y) or not free("w" if x < 0 else "e", y):
            continue
        p = bent(x, y)
        trees.append([p.x, p.y, 0, 0.85])

    # ---- the shops' insides ----
    def table(L, sid, ta, td):
        tg = Geo()
        cyl(tg, 0, 0, 0.72, 0.76, 0.42, 0.42, 14, "inwood")
        cyl(tg, 0, 0, 0.0, 0.72, 0.05, 0.05, 6, "iron")
        g.add(tg, L.M(ta, td, 0))
        L.col(helpers, f"{sid}_t{int(ta * 10)}_{int(td * 10)}", ta - 0.42, ta + 0.42, td - 0.42, td + 0.42, 0, 0.76)

    def hat_geo(kind, key):
        """A hat on the wall, crown along +z: a cap with a peak, a bucket hat, a beanie, a straw hat."""
        hg = Geo()
        if kind == 0:
            lathe(hg, [(0.1, 0.0), (0.098, 0.05), (0.08, 0.1), (0.0, 0.115)], 10, key)
            hg.box(-0.07, 0.07, 0.08, 0.17, 0.0, 0.012, key)
        elif kind == 1:
            lathe(hg, [(0.16, 0.0), (0.105, 0.025), (0.095, 0.1), (0.0, 0.11)], 10, key)
        elif kind == 2:
            lathe(hg, [(0.1, 0.0), (0.104, 0.04), (0.096, 0.06), (0.08, 0.12), (0.0, 0.14)], 10, key)
        else:
            lathe(hg, [(0.22, 0.0), (0.21, 0.012), (0.105, 0.02), (0.095, 0.1), (0.0, 0.105)], 12, key)
        return hg

    def new_interior(lt, L, w, sid, info, a_in0, a_in1, d_in, d_back, CZ):
        """The round-2 shops: the clothes shop's racks, hats and mirror; the barber's chair and mirror; the bar's stage."""
        if sid == "clothes":
            # jackets on a rail along the left wall, trousers folded on shelves on the right, hats on the back wall
            ra = a_in0 + 0.36
            L.box(g, ra - 0.015, ra + 0.015, 1.35, 5.25, 1.6, 1.63, "rack")
            for dd in (1.35, 5.25):
                L.box(g, ra - 0.015, ra + 0.015, dd - 0.015, dd + 0.015, 0, 1.6, "rack")
            for k in range(11):
                dd = 1.55 + k * 0.34
                L.box(g, a_in0 + 0.12, a_in0 + 0.6, dd - 0.03, dd + 0.03, 0.78, 1.55, f"cloth{k % 6}")
                L.box(g, ra - 0.01, ra + 0.01, dd - 0.01, dd + 0.01, 1.55, 1.62, "rack")
            L.col(helpers, f"{sid}_rack", a_in0, a_in0 + 0.65, 1.3, 5.3, 0, 1.9)
            sa0 = a_in1 - 0.48
            for z in (0.45, 0.95, 1.45, 1.95):
                L.box(g, sa0, a_in1, 1.35, 4.45, z - 0.03, z, "inwood")
                if z < 1.9:
                    for k in range(5):
                        dd = 1.55 + k * 0.58
                        for j in range(3):
                            L.box(g, sa0 + 0.06, a_in1 - 0.06, dd, dd + 0.4, z + j * 0.07, z + j * 0.07 + 0.065, f"cloth{6 + (k + j + int(z * 2)) % 4}")
            for dd in (1.35, 4.45):
                L.box(g, sa0, a_in1, dd - 0.03, dd, 0, 2.0, "inwood")
            L.col(helpers, f"{sid}_shelf", sa0, a_in1, 1.32, 4.48, 0, 2.0)
            for r in range(3):
                for c in range(6):
                    a = 2.6 + c * 0.44
                    put_hat = hat_geo((r + c) % 4, f"cloth{10 + (r * 2 + c) % 4}")
                    g.add(put_hat, L.M(a, d_back - 0.02, 1.35 + r * 0.42) @ Matrix.Rotation(math.pi / 2, 4, "X"))
                    L.box(g, a - 0.01, a + 0.01, d_back - 0.06, d_back, 1.52 + r * 0.42, 1.54 + r * 0.42, "rack")
            # the counter in the back-left corner, a fitting room in the back-right
            L.box(g, 0.5, 2.2, 5.2, 5.75, 0, 0.95, "inwood", skip=("-z",))
            L.box(g, 0.46, 2.24, 5.15, 5.8, 0.95, 1.0, "inwood")
            L.col(helpers, f"{sid}_counter", 0.46, 2.24, 5.15, 5.8, 0, 1.0)
            L.box(g, 5.4, a_in1, 5.2, 5.25, 0.05, 2.3, "curtain", skip=())
            L.box(g, 5.38, 5.42, 5.2, d_back, 0, 2.4, "inwood")
            L.box(g, 5.38, a_in1, 5.18, 5.22, 2.3, 2.4, "rack")
            L.col(helpers, f"{sid}_fit", 5.38, a_in1, 5.18, d_back, 0, 2.4)
            L.front(g, 0.5, 2.1, 1.95, 2.75, "goods", d=d_back - 0.01, uvs=sub_uv(*gcell["menu_clothes"]))
            # the mirror, freestanding, facing in: the panel's camera looks back from it at the one trying things on
            ma, md = 4.6, 1.0
            L.box(g, ma - 0.42, ma + 0.42, md - 0.06, md + 0.04, 0.05, 2.0, "inwood")
            L.quad(g, [(ma - 0.36, md + 0.045, 0.12), (ma - 0.36, md + 0.045, 1.94), (ma + 0.36, md + 0.045, 1.94), (ma + 0.36, md + 0.045, 0.12)][::-1], "mirror", (0, 1, 0))
            for s_ in (-1, 1):
                L.box(g, ma + s_ * 0.35 - 0.03, ma + s_ * 0.35 + 0.03, md - 0.35, md + 0.3, 0, 0.05, "inwood")
            L.col(helpers, f"{sid}_mirror", ma - 0.45, ma + 0.45, md - 0.38, md + 0.32, 0, 2.0)
            info["stand"] = L.xy(ma, 3.0)
            info["mirror"] = L.xy(ma, md + 0.2)
            info["counter"] = L.xy(ma, 3.05)
            info["keeper"] = L.xy(1.35, 6.25)
            info["keeperFace"] = L.xy(1.35, 0)
        elif sid == "barber":
            # the chair before a mirror on the left wall, a bench on the right, a basin at the back
            ca, cd = 1.65, 3.0
            L.quad(g, [(a_in0 + 0.02, cd - 0.6, 0.95), (a_in0 + 0.02, cd + 0.6, 0.95), (a_in0 + 0.02, cd + 0.6, 2.05), (a_in0 + 0.02, cd - 0.6, 2.05)], "mirror", (1, 0, 0))
            L.box(g, a_in0, a_in0 + 0.05, cd - 0.66, cd + 0.66, 0.89, 0.95, "inwood")
            L.box(g, a_in0, a_in0 + 0.05, cd - 0.66, cd + 0.66, 2.05, 2.11, "inwood")
            L.box(g, a_in0, a_in0 + 0.3, cd - 0.8, cd + 0.8, 0.82, 0.86, "inwood")
            for k in range(5):
                put("cup", L.M(a_in0 + 0.15, cd - 0.6 + k * 0.3, 0.86))
            L.col(helpers, f"{sid}_shelf", a_in0, a_in0 + 0.32, cd - 0.82, cd + 0.82, 0, 0.9)
            # the chair: chrome foot and column, red leather seat, back and headrest, chrome arms, a footrest
            cg = Geo()
            cyl(cg, 0, 0, 0.0, 0.06, 0.28, 0.28, 12, "chrome")
            cyl(cg, 0, 0, 0.06, 0.36, 0.06, 0.06, 8, "chrome")
            cg.box(-0.27, 0.27, -0.26, 0.26, 0.36, 0.52, "cushion")
            cg.box(0.2, 0.3, -0.25, 0.25, 0.52, 1.18, "cushion")
            cg.box(0.22, 0.3, -0.12, 0.12, 1.2, 1.38, "cushion")
            cg.box(0.25, 0.27, -0.02, 0.02, 1.15, 1.22, "chrome")
            for s_ in (-1, 1):
                cg.box(-0.25, 0.2, s_ * 0.27 - 0.03, s_ * 0.27 + 0.03, 0.66, 0.7, "chrome")
                cg.box(-0.02, 0.02, s_ * 0.27 - 0.02, s_ * 0.27 + 0.02, 0.52, 0.68, "chrome")
            cg.box(-0.5, -0.3, -0.18, 0.18, 0.12, 0.15, "chrome")
            cg.box(-0.32, -0.28, -0.02, 0.02, 0.12, 0.38, "chrome")
            g.add(cg, L.M(ca, cd, 0))
            L.col(helpers, f"{sid}_chair", ca - 0.5, ca + 0.32, cd - 0.32, cd + 0.32, 0, 0.55)
            L.box(g, a_in1 - 0.45, a_in1, 1.2, 3.6, 0, 0.45, "inwood")
            L.box(g, a_in1 - 0.06, a_in1, 1.2, 3.6, 0.45, 0.95, "inwood")
            L.col(helpers, f"{sid}_bench", a_in1 - 0.45, a_in1, 1.2, 3.6, 0, 0.5)
            L.box(g, a_in0, 1.05, 5.9, d_back, 0, 0.85, "inwood", skip=("-z",))
            L.box(g, a_in0 + 0.12, 0.93, 6.0, d_back - 0.08, 0.85, 0.9, "chrome")
            L.col(helpers, f"{sid}_basin", a_in0, 1.05, 5.9, d_back, 0, 0.9)
            L.front(g, 2.5, 4.3, 1.75, 2.65, "goods", d=d_back - 0.01, uvs=sub_uv(*gcell["menu_barber"]))
            for (b0, b1, b2) in ((a_in0 + 0.6, 1.0, "poster1"),):
                pu = gcell[b2]
                L.quad(g, [(a_in1 - 0.01, 4.2, 1.2), (a_in1 - 0.01, 4.2, 2.2), (a_in1 - 0.01, 4.95, 2.2), (a_in1 - 0.01, 4.95, 1.2)], "goods", (-1, 0, 0), uvs=sub_uv(*pu))
            # the barber's pole by the door, out on the front
            pa = 0.32
            n = 12
            pts = []
            for i in range(n + 1):
                ang = 2 * math.pi * i / n
                pts.append((pa + 0.07 * math.cos(ang), -0.22 + 0.07 * math.sin(ang)))
            u0, v0, u1, v1 = gcell["pole"]
            for i in range(n):
                (xa, ya), (xb, yb) = pts[i], pts[i + 1]
                ua, ub = u0 + (u1 - u0) * i / n, u0 + (u1 - u0) * (i + 1) / n
                L.quad(g, [(xa, ya, 1.25), (xb, yb, 1.25), (xb, yb, 2.05), (xa, ya, 2.05)], "pole", (math.cos(2 * math.pi * (i + 0.5) / n), math.sin(2 * math.pi * (i + 0.5) / n), 0),
                       [(ua, v0), (ub, v0), (ub, v1), (ua, v1)])
            pc = Geo()
            cyl(pc, 0, 0, 0, 0.08, 0.085, 0.085, 12, "chrome")
            g.add(pc, L.M(pa, -0.22, 1.17))
            g.add(pc, L.M(pa, -0.22, 2.05))
            L.box(g, pa - 0.02, pa + 0.02, -0.22, 0.0, 1.6, 1.64, "chrome")
            info["chair"] = L.xy(ca, cd)
            info["chairFace"] = L.xy(a_in0, cd)
            info["camera"] = L.xy(a_in0 + 0.3, cd)
            info["counter"] = L.xy(2.45, 2.3)
            info["keeper"] = L.xy(ca + 0.7, cd + 0.55)
            info["keeperFace"] = L.xy(ca, cd)
        elif sid == "bar":
            # the stage in the back-left corner: a rug, a curtain, a stool, the mic, an amp, a spotlight
            sa, sd = 1.9, 5.65
            L.quad(g, [(0.4, 4.4, 0.045), (3.4, 4.4, 0.045), (3.4, d_back, 0.045), (0.4, d_back, 0.045)], "curtain", (0, 0, 1))
            L.front(g, 0.4, 3.4, 0.05, 2.9, "curtain", d=d_back - 0.03)
            put("stool", L.M(sa, sd, 0))
            mg = Geo()
            cyl(mg, 0, 0, 0.0, 0.02, 0.14, 0.14, 10, "chrome")
            cyl(mg, 0, 0, 0.02, 1.12, 0.012, 0.012, 6, "chrome")
            ell(mg, (0, 0, 1.16), (0.03, 0.03, 0.05), "cabinet", nu=6, nv=4)
            g.add(mg, L.M(sa, sd - 0.62, 0))
            L.box(g, 2.8, 3.3, 6.1, 6.5, 0, 0.55, "cabinet")
            L.col(helpers, f"{sid}_amp", 2.8, 3.3, 6.1, 6.5, 0, 0.55)
            L.box(g, sa - 0.25, sa + 0.25, sd - 0.25, sd + 0.25, CZ - 0.08, CZ - 0.02, "spot")
            pu = gcell["singer"]
            L.quad(g, [(a_in0 + 0.01, 3.3, 1.2), (a_in0 + 0.01, 4.05, 1.2), (a_in0 + 0.01, 4.05, 2.2), (a_in0 + 0.01, 3.3, 2.2)], "goods", (1, 0, 0), uvs=sub_uv(*pu))
            # the bar along the right wall, bottles on the wall behind it, three stools before it
            L.box(g, 6.6, 7.2, 1.2, 5.2, 0, 1.0, "inwood", skip=("-z",))
            L.box(g, 6.52, 7.28, 1.15, 5.25, 1.0, 1.06, "inwood")
            L.col(helpers, f"{sid}_counter", 6.52, 7.28, 1.15, 5.25, 0, 1.06)
            L.quad(g, [(a_in1 - 0.01, 1.2, 1.1), (a_in1 - 0.01, 1.2, 2.45), (a_in1 - 0.01, 5.2, 2.45), (a_in1 - 0.01, 5.2, 1.1)], "goods", (-1, 0, 0), uvs=sub_uv(*gcell["bottles"]))
            L.box(g, a_in1 - 0.32, a_in1, 1.2, 5.2, 0, 1.0, "inwood")
            L.col(helpers, f"{sid}_back", a_in1 - 0.32, a_in1, 1.2, 5.2, 0, 2.45)
            for k in range(3):
                hg = Geo()
                cyl(hg, 0, 0, 0.74, 0.8, 0.2, 0.2, 10, "cushion")
                cyl(hg, 0, 0, 0.0, 0.74, 0.03, 0.03, 6, "chrome")
                cyl(hg, 0, 0, 0.0, 0.03, 0.2, 0.2, 10, "chrome")
                g.add(hg, L.M(6.15, 2.0 + k * 1.2, 0))
            L.front(g, 4.6, 6.4, 1.8, 2.7, "goods", d=d_back - 0.01, uvs=sub_uv(*gcell["menu_bar"]))
            for k in range(3):
                put("lantern", L.M(3.0 + k * 1.6, 2.6, CZ - 0.75))
            # tables, each with two stools, the seats facing the stage
            seats = []
            for (ta, td) in ((1.5, 2.2), (3.4, 3.3), (5.0, 4.9)):
                table(L, sid, ta, td)
                for s_ in (-1, 1):
                    put("stool", L.M(ta + s_ * 0.66, td, 0))
                    seats.append(L.xy(ta + s_ * 0.66, td))
            info["seats"] = seats
            info["stage"] = L.xy(sa, sd)
            info["stageFace"] = L.xy(sa, 0)
            info["mic"] = L.xy(sa, sd - 0.62)
            info["counter"] = L.xy(5.95, 3.2)
            info["keeper"] = L.xy(7.85, 3.2)
            info["keeperFace"] = L.xy(5.5, 3.2)

    for lt in lots:
        if lt["kind"] != "shop" or "L" not in lt or not in_part(lt["y0"]):
            continue
        L, w, sid = lt["L"], lt["L"].w, lt["shop"]
        if sid == "grill":
            # the stall: its colliders, the vendor behind the grill, F from the lane in front
            EZ_, SD = lt["EZ"], 3.2
            L.col(helpers, "grill_counter", 0.25, w - 0.25, 0, 0.7, 0, 1.12)
            L.col(helpers, "grill_sl", 0, 0.2, 0, DEPTH, 0, EZ_)
            L.col(helpers, "grill_sr", w - 0.2, w, 0, DEPTH, 0, EZ_)
            L.col(helpers, "grill_bk", 0, w, SD, DEPTH, 0, EZ_)
            L.col(helpers, "grill_roof", 0, w, 0, DEPTH, 2.6, EZ_)
            for a in (0.1, w - 0.1):
                L.col(helpers, f"grill_post{int(a * 10)}", a - 0.05, a + 0.05, -1.17, -1.08, 0, 2.3)
            layout["shops"][sid] = {"side": lt["side"], "y0": lt["y0"], "y1": lt["y1"], "stall": True, "door": L.xy(w / 2, -0.8),
                                    "counter": L.xy(w / 2 - 0.3, -0.75), "keeper": L.xy(w / 2 - 0.3, 1.2), "keeperFace": L.xy(w / 2 - 0.3, -3),
                                    "smoke": L.xy(w / 2 - 0.3, 0.3)}
            continue
        d_in, d_back = 0.16, DEPTH - 0.22
        a_in0, a_in1 = 0.22, w - 0.22
        CZ = 3.0
        d0, d1 = w / 2 - 0.85, w / 2 + 0.85
        floor_key = "inwood" if sid in ("tea", "photo", "crafts", "clothes", "bar", "cats") else "infloor"
        L.quad(g, [(a_in0, d_in, 0.035), (a_in1, d_in, 0.035), (a_in1, d_back, 0.035), (a_in0, d_back, 0.035)], floor_key, (0, 0, 1),
               uvs=[(0, 0), ((a_in1 - a_in0) / 1.5, 0), ((a_in1 - a_in0) / 1.5, (d_back - d_in) / 1.5), (0, (d_back - d_in) / 1.5)] if floor_key == "inwood" else None)
        L.quad(g, [(a_in0, d_in, CZ), (a_in0, d_back, CZ), (a_in1, d_back, CZ), (a_in1, d_in, CZ)], "ceiling", (0, 0, -1))
        wall_key = "inbrick" if sid in ("snack", "arcade", "bar", "noodle") else "tilewhite" if sid == "barber" else "inwall"
        L.quad(g, [(a_in0, d_in, 0), (a_in0, d_back, 0), (a_in0, d_back, CZ), (a_in0, d_in, CZ)], wall_key, (1, 0, 0))
        L.quad(g, [(a_in1, d_in, 0), (a_in1, d_in, CZ), (a_in1, d_back, CZ), (a_in1, d_back, 0)], wall_key, (-1, 0, 0))
        L.front(g, a_in0, a_in1, 0, CZ, wall_key, d=d_back, n=(0, -1, 0))
        # the front wall's inside face, round the door and windows
        for (b0, b1, c0, c1) in ((a_in0, d0, 0, 0.8), (d1, a_in1, 0, 0.8), (a_in0, a_in1, 2.35, CZ)):
            L.front(g, b0, b1, c0, c1, wall_key, d=d_in, n=(0, 1, 0))
        # ceiling lights: two tubes or pendant lanterns
        for k in range(2):
            dd = 1.8 + k * 2.4
            L.box(g, w / 2 - 0.6, w / 2 + 0.6, dd - 0.04, dd + 0.04, CZ - 0.06, CZ - 0.01, "tube")
        # walls: the front's colliders round the door, the sides, the back, the roof slab
        L.col(helpers, f"{sid}_fl", 0, d0 - 0.07, 0, 0.16, 0, CZ + 0.4)
        L.col(helpers, f"{sid}_fr", d1 + 0.07, w, 0, 0.16, 0, CZ + 0.4)
        L.col(helpers, f"{sid}_ft", d0 - 0.07, d1 + 0.07, 0, 0.16, 2.42, CZ + 0.4)
        L.col(helpers, f"{sid}_sl", 0, a_in0, 0, DEPTH, 0, lt["EZ"])
        L.col(helpers, f"{sid}_sr", a_in1, w, 0, DEPTH, 0, lt["EZ"])
        L.col(helpers, f"{sid}_bk", 0, w, d_back, DEPTH, 0, lt["EZ"])
        L.col(helpers, f"{sid}_roof", 0, w, 0, DEPTH, CZ, lt["EZ"])
        info = {"side": lt["side"], "y0": lt["y0"], "y1": lt["y1"], "door": L.xy(w / 2, -0.3), "inside": L.xy(w / 2, 1.0),
                "room": [L.xy(a_in0 + 0.3, d_in + 0.3), L.xy(a_in1 - 0.3, d_back - 0.3)], "yawIn": 0}
        # the yaw (radians, about +Z in Blender; the game converts) that faces into the shop from the door
        info["inward"] = [round(L.ed.x, 3), round(L.ed.y, 3)]
        if sid in ("clothes", "barber", "bar"):
            new_interior(lt, L, w, sid, info, a_in0, a_in1, d_in, d_back, CZ)
            layout["shops"][sid] = info
            continue

        cb0, cb1 = DEPTH - 2.5, DEPTH - 1.9        # the counter's depth
        if sid == "photo":
            cb0, cb1 = 1.2, 1.8
        if sid == "arcade":
            cb0, cb1 = 0.9, 1.5
        counter_a = (a_in0 + 0.6, a_in1 - 0.6)
        if sid in ("photo", "arcade"):
            counter_a = (a_in0, a_in0 + 1.3)
        if sid == "cats":
            counter_a = (a_in1 - 2.7, a_in1 - 0.5)
        ca0, ca1 = counter_a
        L.box(g, ca0, ca1, cb0, cb1, 0, 0.95, "inwood", skip=("-z",))
        L.box(g, ca0 - 0.04, ca1 + 0.04, cb0 - 0.05, cb1 + 0.05, 0.95, 1.0, "inwood", skip=())
        L.col(helpers, f"{sid}_counter", ca0, ca1, cb0, cb1, 0, 1.0)
        if sid in ("photo", "arcade"):
            info["counter"] = L.xy(ca1 + 0.45, (cb0 + cb1) / 2)
            info["keeper"] = L.xy((ca0 + ca1) / 2 - 0.2, cb1 + 0.45) if sid == "photo" else L.xy(a_in0 + 0.4, (cb0 + cb1) / 2 + 0.9)
            info["keeperFace"] = L.xy(w / 2, (cb0 + cb1) / 2)
        else:
            info["counter"] = L.xy((ca0 + ca1) / 2, cb0 - 0.55)
            info["keeper"] = L.xy((ca0 + ca1) / 2, cb1 + 0.5)
            info["keeperFace"] = L.xy((ca0 + ca1) / 2, 0)

        # menu board (or the studio's price list) on the back wall
        mu = gcell[f"menu_{sid}"]
        if sid in ("photo", "arcade"):
            L.quad(g, [(a_in0 + 0.01, cb0 + 0.1, 1.6), (a_in0 + 0.01, cb0 + 1.3, 1.6), (a_in0 + 0.01, cb0 + 1.3, 2.2), (a_in0 + 0.01, cb0 + 0.1, 2.2)], "goods", (1, 0, 0),
                   uvs=sub_uv(*mu))
        else:
            L.front(g, w / 2 - 0.9, w / 2 + 0.9, 1.75, 2.65, "goods", d=d_back - 0.01, uvs=sub_uv(*mu))

        if sid == "snack":
            # a glass case on the counter with the haws, a straw bundle of 糖葫芦, a steamer stack, two tables
            L.box(g, ca0 + 0.2, ca0 + 1.6, cb0 + 0.05, cb1 - 0.05, 1.0, 1.45, "counterglass", skip=("-z",))
            sb = Geo()
            cyl(sb, 0, 0, 0, 0.75, 0.13, 0.11, 10, "bamboo")
            sm = L.M(ca1 - 0.35, (cb0 + cb1) / 2, 1.0)
            g.add(sb, sm)
            for k in range(14):
                ang = k * 2 * math.pi / 14
                put("haws", sm @ Matrix.Translation((0.11 * math.cos(ang), 0.11 * math.sin(ang), 0.45)) @ Matrix.Rotation(0.35, 4, Vector((-math.sin(ang), math.cos(ang), 0))))
            for k in range(8):
                put("haws", L.M(ca0 + 0.35 + k * 0.14, (cb0 + cb1) / 2, 1.02) @ Matrix.Rotation(math.pi / 2 - 0.1, 4, "X") @ Matrix.Translation((0, 0, -0.2)))
            st = Geo()
            for k in range(3):
                cyl(st, 0, 0, k * 0.12, k * 0.12 + 0.11, 0.24, 0.24, 12, "bamboo")
            g.add(st, L.M(w / 2 + 0.3, (cb0 + cb1) / 2, 1.0))
            for (ta, td) in ((a_in0 + 0.9, 1.5), (a_in1 - 0.9, 2.8)):
                tg = Geo()
                cyl(tg, 0, 0, 0.72, 0.76, 0.42, 0.42, 14, "inwood")
                cyl(tg, 0, 0, 0.0, 0.72, 0.05, 0.05, 6, "iron")
                g.add(tg, L.M(ta, td, 0))
                L.col(helpers, f"{sid}_t{int(td * 10)}", ta - 0.42, ta + 0.42, td - 0.42, td + 0.42, 0, 0.76)
                for s in (-1, 1):
                    put("stool", L.M(ta + s * 0.62, td, 0))
            # the poster on the side wall
            pu = gcell["poster1"]
            L.quad(g, [(a_in0 + 0.01, 2.0, 1.2), (a_in0 + 0.01, 2.75, 1.2), (a_in0 + 0.01, 2.75, 2.2), (a_in0 + 0.01, 2.0, 2.2)], "goods", (1, 0, 0), uvs=sub_uv(*pu))
        elif sid == "crafts":
            # shelves along both side walls with 兔儿爷 on them, a poster, the counter at the back
            for (a_w, na) in ((a_in0, 1), (a_in1, -1)):
                a0s, a1s = (a_w, a_w + 0.42) if na > 0 else (a_w - 0.42, a_w)
                for z in (0.5, 1.0, 1.5, 2.0):
                    L.box(g, a0s, a1s, 0.9, 4.0, z - 0.03, z, "inwood")
                    for k in range(8):
                        put("rabbit", L.M((a0s + a1s) / 2, 1.1 + k * 0.38, z, yaw=math.pi / 2 * na) @ Matrix.Diagonal((1.0 + (k % 3) * 0.25,) * 3 + (1,)))
                L.box(g, a0s, a1s, 0.88, 0.92, 0, 2.3, "inwood")
                L.box(g, a0s, a1s, 3.98, 4.02, 0, 2.3, "inwood")
                L.col(helpers, f"{sid}_shelf{na}", a0s, a1s, 0.88, 4.02, 0, 2.3)
            pu = gcell["poster0"]
            L.front(g, a_in1 - 1.0, a_in1 - 0.3, 1.3, 2.25, "goods", d=d_back - 0.01, uvs=sub_uv(*pu))
            pu = gcell["poster2"]
            L.front(g, a_in0 + 0.3, a_in0 + 1.0, 1.3, 2.25, "goods", d=d_back - 0.01, uvs=sub_uv(*pu))
        elif sid == "tea":
            # cups on the counter, two high stools before it, a plant in each front corner, pendant lanterns
            for k in range(9):
                put("cup", L.M(ca0 + 0.3 + k * 0.33, (cb0 + cb1) / 2 + 0.1, 1.0))
            for s in (-0.8, 0.8):
                hg = Geo()
                cyl(hg, 0, 0, 0.74, 0.8, 0.2, 0.2, 10, "cushion")
                cyl(hg, 0, 0, 0.0, 0.74, 0.03, 0.03, 6, "chrome")
                cyl(hg, 0, 0, 0.0, 0.03, 0.2, 0.2, 10, "chrome")
                g.add(hg, L.M(w / 2 + s, cb0 - 0.45, 0))
            for a in (a_in0 + 0.4, a_in1 - 0.4):
                put("pot", L.M(a, d_in + 0.45, 0))
            for k in range(3):
                put("lantern", L.M(w / 2 - 1.2 + k * 1.2, 2.2, CZ - 0.75))
            pu = gcell["poster1"]
            L.quad(g, [(a_in1 - 0.01, 1.5, 1.2), (a_in1 - 0.01, 1.5, 2.2), (a_in1 - 0.01, 2.25, 2.2), (a_in1 - 0.01, 2.25, 1.2)], "goods", (-1, 0, 0), uvs=sub_uv(*pu))
        elif sid == "photo":
            # the painted backdrop across the back wall, a carved armchair before it, the camera on its tripod
            bu = gcell["backdrop"]
            L.front(g, a_in0 + 0.2, a_in1 - 0.2, 0.05, 2.75, "goods", d=d_back - 0.02, uvs=sub_uv(*bu))
            ch = Geo()
            ch.box(-0.32, 0.32, -0.28, 0.28, 0.42, 0.5, "inwood")
            ch.box(-0.32, 0.32, 0.22, 0.3, 0.5, 1.15, "inwood")
            for (x, y) in ((-0.28, -0.24), (0.28, -0.24), (-0.28, 0.24), (0.28, 0.24)):
                ch.box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0, 0.42, "inwood")
            for x in (-0.32, 0.29):
                ch.box(x, x + 0.03, -0.28, 0.28, 0.5, 0.75, "inwood")
            chair_d = d_back - 0.9
            g.add(ch, L.M(w / 2, chair_d, 0))
            L.col(helpers, f"{sid}_chair", w / 2 - 0.32, w / 2 + 0.32, chair_d - 0.28, chair_d + 0.3, 0, 0.5)
            info["chair"] = L.xy(w / 2, chair_d - 0.05)
            info["camera"] = L.xy(w / 2, 1.9)
            cam = Geo()
            for k in range(3):
                ang = k * 2 * math.pi / 3
                cam.poly([(0, 0, 1.3), (0.35 * math.cos(ang), 0.35 * math.sin(ang), 0), (0.35 * math.cos(ang) + 0.02, 0.35 * math.sin(ang), 0), (0.02, 0, 1.3)], "inwood")
                cam.poly([(0.02, 0, 1.3), (0.35 * math.cos(ang) + 0.02, 0.35 * math.sin(ang), 0), (0.35 * math.cos(ang), 0.35 * math.sin(ang), 0), (0, 0, 1.3)], "inwood")
            cam.box(-0.18, 0.18, -0.25, 0.2, 1.3, 1.62, "cabinet")
            cam.box(-0.12, 0.12, 0.2, 0.42, 1.36, 1.56, "cabinet")
            cyl(cam, 0, 0.42, 1.46, 1.46, 0.06, 0.06, 8, "chrome")
            g.add(cam, L.M(w / 2, 1.6, 0, yaw=0))
            L.col(helpers, f"{sid}_camera", w / 2 - 0.3, w / 2 + 0.3, 1.3, 1.9, 0, 1.6)
            for k in range(4):
                pu = gcell[f"portrait{k}"]
                dd = 2.4 + k * 0.85
                L.quad(g, [(a_in1 - 0.01, dd, 1.5), (a_in1 - 0.01, dd, 2.2), (a_in1 - 0.01, dd + 0.55, 2.2), (a_in1 - 0.01, dd + 0.55, 1.5)], "goods", (-1, 0, 0), uvs=sub_uv(*pu))
            for k in range(2):
                pu = gcell[f"portrait{k + 4}"]
                dd = 3.2 + k * 1.1
                L.quad(g, [(a_in0 + 0.01, dd, 1.5), (a_in0 + 0.01, dd + 0.55, 1.5), (a_in0 + 0.01, dd + 0.55, 2.2), (a_in0 + 0.01, dd, 2.2)], "goods", (1, 0, 0), uvs=sub_uv(*pu))
            # a softbox
            L.box(g, a_in1 - 0.9, a_in1 - 0.3, chair_d - 1.2, chair_d - 1.1, 1.4, 2.1, "tube")
            L.box(g, a_in1 - 0.62, a_in1 - 0.58, chair_d - 1.15, chair_d - 1.1, 0, 1.4, "iron")
        elif sid == "arcade":
            # cabinets along both walls, the dance machine at the back, neon round the ceiling
            for (a_w, na) in ((a_in0, 1), (a_in1, -1)):
                for k in range(3 if na < 0 else 2):
                    dd = (2.0 if na > 0 else 1.0) + k * 1.05
                    a0c, a1c = (a_w, a_w + 0.8) if na > 0 else (a_w - 0.8, a_w)
                    L.box(g, a0c, a1c, dd, dd + 0.85, 0, 1.85, "cabinet")
                    su = gcell[f"screen{(k + (0 if na > 0 else 3)) % 6}"]
                    face = a1c + 0.005 if na > 0 else a0c - 0.005
                    pts = [(face, dd + 0.08, 1.0), (face, dd + 0.77, 1.0), (face, dd + 0.77, 1.6), (face, dd + 0.08, 1.6)]
                    L.quad(g, pts if na > 0 else pts[::-1], "screen", (na, 0, 0), uvs=sub_uv(*su) if na > 0 else sub_uv(*su)[::-1])
                    L.col(helpers, f"{sid}_cab{na}{k}", a0c, a1c, dd, dd + 0.85, 0, 1.85)
            pad_d = d_back - 1.6
            pu = gcell["dancepad"]
            L.quad(g, [(w / 2 - 0.65, pad_d - 0.65, 0.05), (w / 2 + 0.65, pad_d - 0.65, 0.05), (w / 2 + 0.65, pad_d + 0.65, 0.05), (w / 2 - 0.65, pad_d + 0.65, 0.05)], "screen", (0, 0, 1), uvs=sub_uv(*pu))
            L.box(g, w / 2 - 0.75, w / 2 + 0.75, pad_d + 0.75, d_back, 0, 2.3, "cabinet", skip=("+d",))
            su = gcell["dancescreen"]
            L.front(g, w / 2 - 0.6, w / 2 + 0.6, 1.3, 2.1, "screen", d=pad_d + 0.74, uvs=sub_uv(*su))
            L.box(g, w / 2 - 0.75, w / 2 + 0.75, pad_d + 0.62, pad_d + 0.75, 2.15, 2.3, "neon")
            L.col(helpers, f"{sid}_dance", w / 2 - 0.75, w / 2 + 0.75, pad_d + 0.75, d_back, 0, 2.3)
            info["pad"] = L.xy(w / 2, pad_d)
            info["padFace"] = L.xy(w / 2, d_back)
            for (b0, b1, key) in ((a_in0, a_in0 + 0.05, "neon"), (a_in1 - 0.05, a_in1, "neon2")):
                L.box(g, b0, b1, d_in + 0.2, d_back - 0.2, CZ - 0.12, CZ - 0.06, key)
            pu = gcell["poster0"]
            L.front(g, d1 + 0.15, a_in1 - 0.15, 0.9, 2.1, "screen", d=0.1, uvs=sub_uv(*pu))
        elif sid == "noodle":
            # steamers and a tray of dumplings on the counter, takeaway bags waiting by the door, three tables
            st = Geo()
            for k in range(4):
                cyl(st, 0, 0, k * 0.12, k * 0.12 + 0.11, 0.24, 0.24, 12, "bamboo")
            g.add(st, L.M(ca0 + 0.45, (cb0 + cb1) / 2, 1.0))
            g.add(st, L.M(ca0 + 1.0, (cb0 + cb1) / 2, 1.0))
            L.box(g, ca1 - 1.1, ca1 - 0.3, cb0 + 0.1, cb1 - 0.1, 1.0, 1.03, "steel")
            for k in range(12):
                L.box(g, ca1 - 1.05 + (k % 6) * 0.13, ca1 - 0.97 + (k % 6) * 0.13, cb0 + 0.18 + (k // 6) * 0.2, cb0 + 0.3 + (k // 6) * 0.2, 1.03, 1.07, "cup")
            # the bags for the deliveries: white boxes in red bags on a shelf by the door
            sa0 = a_in1 - 0.5
            L.box(g, sa0, a_in1, 0.4, 1.4, 0.7, 0.74, "inwood")
            L.col(helpers, f"{sid}_shelf", sa0, a_in1, 0.4, 1.4, 0, 0.74)
            for k in range(3):
                L.box(g, sa0 + 0.06, a_in1 - 0.06, 0.48 + k * 0.32, 0.72 + k * 0.32, 0.74, 1.02, "curtain")
            for (ta, td) in ((a_in0 + 1.0, 1.5), (a_in0 + 1.0, 3.2), (a_in1 - 1.3, 2.9)):
                table(L, sid, ta, td)
                for s_ in (-1, 1):
                    put("stool", L.M(ta + s_ * 0.62, td, 0))
            pu = gcell["poster2"]
            L.quad(g, [(a_in0 + 0.01, 2.2, 1.2), (a_in0 + 0.01, 2.95, 1.2), (a_in0 + 0.01, 2.95, 2.2), (a_in0 + 0.01, 2.2, 2.2)], "goods", (1, 0, 0), uvs=sub_uv(*pu))
            for k in range(3):
                put("lantern", L.M(w / 2 - 1.4 + k * 1.4, 2.4, CZ - 0.75))
            info["bags"] = L.xy((sa0 + a_in1) / 2, 0.9)
        elif sid == "cats":
            # a cat tree by the left wall, beds on the floor, sills under the front windows, a table with two stools to
            # sit at with the cats; the spots they curl up on go to the layout (the game puts the cats there)
            tx, td_ = a_in0 + 0.55, 1.5
            for (zz, oa, od) in ((0.55, 0.0, 0.0), (1.15, 0.05, 0.9), (1.75, 0.0, 0.1)):
                L.box(g, tx - 0.3 + oa, tx + 0.3 + oa, td_ - 0.3 + od, td_ + 0.3 + od, zz - 0.05, zz, "cushion")
            for (oa, od, top) in ((0.0, 0.0, 1.75), (0.05, 0.9, 1.15)):
                cyl(cg := Geo(), 0, 0, 0.0, top, 0.06, 0.06, 8, "basket", caps=(False, False))
                g.add(cg, L.M(tx + oa, td_ + od, 0))
            L.box(g, tx - 0.35, tx + 0.35, td_ - 0.35, td_ + 0.35 + 0.9, 0.0, 0.06, "basket")
            L.col(helpers, f"{sid}_tree", tx - 0.35, tx + 0.35, td_ - 0.35, td_ + 0.35 + 0.9, 0, 1.75)
            for (ba, bd) in ((a_in1 - 0.7, 3.3), (a_in0 + 0.7, 4.6)):
                bg = Geo()
                cyl(bg, 0, 0, 0.0, 0.12, 0.34, 0.3, 12, "cushion")
                g.add(bg, L.M(ba, bd, 0))
            for (s0, s1) in ((a_in0 + 0.1, d0 - 0.1), (d1 + 0.1, a_in1 - 0.1)):
                L.box(g, s0, s1, d_in, d_in + 0.32, 0.76, 0.82, "inwood")
            ta, tdd = w / 2 + 0.2, 2.6
            table(L, sid, ta, tdd)
            seats = []
            for s_ in (-1, 1):
                put("stool", L.M(ta + s_ * 0.66, tdd, 0))
                seats.append(L.xy(ta + s_ * 0.66, tdd))
            info["seats"], info["seatFace"] = seats, L.xy(ta, tdd)
            pu = gcell["catposter"]
            L.quad(g, [(a_in1 - 0.01, 1.2, 1.25), (a_in1 - 0.01, 1.2, 2.25), (a_in1 - 0.01, 1.95, 2.25), (a_in1 - 0.01, 1.95, 1.25)], "goods", (-1, 0, 0), uvs=sub_uv(*pu))
            pu = gcell["paws"]
            L.quad(g, [(a_in0 + 0.01, 3.0, 0.9), (a_in0 + 0.01, 4.4, 0.9), (a_in0 + 0.01, 4.4, 2.3), (a_in0 + 0.01, 3.0, 2.3)], "goods", (1, 0, 0), uvs=sub_uv(*pu))
            for k in range(3):
                put("lantern", L.M(w / 2 - 1.6 + k * 1.6, 3.4, CZ - 0.75))
            # where the cats are: [u, s, height, yaw towards (lane coordinates)]
            spot = lambda a, d, z, fa, fd: [*L.xy(a, d), round(z, 3), *L.xy(fa, fd)]  # noqa: E731
            info["cats"] = [spot(tx, td_ + 0.1, 1.75, w / 2, 3.0), spot(tx + 0.05, td_ + 0.9, 1.15, w / 2, 2.0), spot(a_in1 - 0.7, 3.3, 0.12, w / 2, 3.0),
                            spot(a_in0 + 0.7, 4.6, 0.12, w / 2, 2.0), spot(d1 + 0.6, d_in + 0.18, 0.82, d1 + 0.6, -2.0), spot(ca0 + 0.3, (cb0 + cb1) / 2, 1.0, w / 2, 1.0)]
        layout["shops"][sid] = info

    # ---- the courtyard behind the gate (east, middle stretch): a 四合院 you can walk into ----
    if LANE and in_part(YARD[0]):
        Y = Lot("e", YARD[0], YARD[1])      # a from the north end (y 215) southwards, d eastwards from the fronts

        def sub(o, ea, ed, w):
            """A frame for one of the yard's houses: o its front's left end, ea along the front, ed into it (lane vectors)."""
            F = Lot("e", YARD[0], YARD[1], m=Y.m)
            F.o, F.ea, F.ed, F.w = Vector((o[0], o[1], 0)), Vector((ea[0], ea[1], 0)), Vector((ed[0], ed[1], 0)), w
            return F

        def house(F, name, dep, EZ, RZ):
            """A yard house: a porch of red posts, lattice windows and a closed door, a gabled tiled roof, brick behind."""
            w, rd = F.w, dep / 2
            for G in (g, far):
                F.quad(G, [(0, -0.95, EZ - 0.18), (w, -0.95, EZ - 0.18), (w, rd, RZ), (0, rd, RZ)], "tiles", (0, -1, 1.6), [(0, 0), (w, 0), (w, 3), (0, 3)])
                F.quad(G, [(w, dep + 0.5, EZ - 0.18), (0, dep + 0.5, EZ - 0.18), (0, rd, RZ), (w, rd, RZ)], "tiles", (0, 1, 1.6), [(0, 0), (w, 0), (w, 3), (0, 3)])
                for a, na in ((0.0, -1), (w, 1)):
                    F.quad(G, [(a, -0.6, 0), (a, dep, 0), (a, dep, EZ - 0.2), (a, rd, RZ), (a, -0.6, EZ - 0.2)], "brick", (na, 0, 0))
                F.quad(G, [(0, dep, 0), (w, dep, 0), (w, dep, EZ - 0.2), (0, dep, EZ - 0.2)], "brick", (0, 1, 0))
            F.front(far, 0, w, 0, EZ - 0.2, "brick")
            F.box(g, -0.05, w + 0.05, rd - 0.16, rd + 0.16, RZ - 0.05, RZ + 0.28, "ridge", skip=("-z",))
            F.quad(g, [(0, -0.95, EZ - 0.34), (w, -0.95, EZ - 0.34), (w, 0, EZ - 0.2), (0, 0, EZ - 0.2)], "wood", (0, 0, -1))
            F.quad(g, [(0, -0.9, 0.1), (w, -0.9, 0.1), (w, 0.0, 0.1), (0, 0.0, 0.1)], "steps", (0, 0, 1))
            F.front(g, 0, w, 0, 0.1, "steps", d=-0.9)
            nb = max(3, int(w // 3.2))
            posts = [w * k / nb for k in range(nb + 1)]
            for p in posts:
                cg = Geo()
                cyl(cg, 0, 0, 0.1, EZ - 0.35, 0.11, 0.11, 10, "lacquer", caps=(False, False))
                g.add(cg, F.M(min(max(p, 0.15), w - 0.15), -0.6, 0))
                F.col(helpers, f"{name}_p{int(p * 10)}", min(max(p, 0.15), w - 0.15) - 0.12, min(max(p, 0.15), w - 0.15) + 0.12, -0.72, -0.48, 0, EZ - 0.3)
            F.box(g, 0, w, -0.7, -0.5, EZ - 0.75, EZ - 0.35, "beam", skip=("+d",), uvs={"-d": [(0, 0), (w / 1.5, 0), (w / 1.5, 1), (0, 1)]})
            mid = nb // 2
            for k in range(nb):
                a0, a1 = posts[k] + 0.15, posts[k + 1] - 0.15
                if k == mid:
                    # the door: two leaves of lattice over panels, closed
                    for j in range(2):
                        e0, e1 = a0 + j * (a1 - a0) / 2 + 0.02, a0 + (j + 1) * (a1 - a0) / 2 - 0.02
                        F.front(g, e0, e1, 0.1, 1.0, "wood", d=0.0)
                        F.front(g, e0, e1, 1.0, EZ - 0.8, "lattice", d=0.0, uvs=[(0, 0), ((e1 - e0) / 1.1, 0), ((e1 - e0) / 1.1, 2), (0, 2)])
                        F.front(g, e0, e1, 1.0, EZ - 0.8, "backdrop", d=0.6, uvs=sub_uv(0.5, 2 / 3, 1, 1))
                else:
                    F.front(g, a0, a1, 0.1, 0.9, "brick")
                    F.front(g, a0, a1, 0.9, EZ - 0.8, "lattice", d=0.0, uvs=[(0, 0), ((a1 - a0) / 1.1, 0), ((a1 - a0) / 1.1, 2), (0, 2)])
                    F.front(g, a0, a1, 0.9, EZ - 0.8, "glass", d=0.05)
                F.front(g, posts[k] - 0.15 if k else 0, a0, 0.1, EZ - 0.8, "lacquer")
                F.front(g, a1, posts[k + 1] + 0.15 if k < nb - 1 else w, 0.1, EZ - 0.8, "lacquer")
            F.front(g, 0, w, EZ - 0.8, EZ - 0.2, "wood")
            F.col(helpers, f"{name}", 0, w, 0, dep, 0, EZ)
            for a in (w * 0.3, w * 0.7):
                put("lantern", F.M(a, -0.75, EZ - 1.2))

        X0 = HALF + DEPTH                    # the front row's back walls
        north = sub((X0, YARD[1] - 5.2), (1, 0), (0, 1), 12.9)
        house(north, "yard_n", 5.2, 3.7, 5.6)
        south = sub((X0 + 12.9, YARD[0] + 4.9), (-1, 0), (0, -1), 12.9)
        house(south, "yard_s", 4.9, 3.3, 5.0)
        east = sub((X0 + 13.4, YARD[1] - 6.0), (0, -1), (1, 0), 14.0)
        house(east, "yard_e", 4.6, 3.3, 5.0)
        # the west side: the front row's back walls dressed as the 西厢房's front (posts under their eave, lattice windows),
        # open where the passage from the gate comes through
        pass_y = ((YARD_GATE[0] + YARD_GATE[1]) / 2 - 0.7, (YARD_GATE[0] + YARD_GATE[1]) / 2 + 0.7)
        wy0, wy1 = YARD[0] + 4.9 + 0.4, YARD[1] - 5.2 - 0.4
        west = sub((X0, wy0), (0, 1), (-1, 0), wy1 - wy0)
        ww, wz = west.w, 2.95
        gap = (pass_y[0] - wy0, pass_y[1] - wy0)
        cuts = sorted({0.0, ww, gap[0], gap[1], *[ww * k / 4 for k in range(1, 4)]})
        cuts = [c for c in cuts if not (gap[0] < c < gap[1])]
        for a0, a1 in zip(cuts, cuts[1:]):
            if a0 >= gap[0] - 1e-6 and a1 <= gap[1] + 1e-6:
                west.box(g, a0 - 0.04, a1 + 0.04, -0.12, 0.0, 2.55, 2.75, "lacquer", skip=("+d",))
                continue
            west.front(g, a0 + 0.05, a1 - 0.05, 0.0, 0.85, "brick", d=-0.02)
            west.front(g, a0 + 0.15, a1 - 0.15, 0.85, 2.45, "lattice", d=-0.03, uvs=[(0, 0), ((a1 - a0 - 0.3) / 1.1, 0), ((a1 - a0 - 0.3) / 1.1, 1.5), (0, 1.5)])
            west.front(g, a0 + 0.15, a1 - 0.15, 0.85, 2.45, "glass", d=-0.01)
            west.front(g, a0 + 0.05, a1 - 0.05, 2.45, wz - 0.25, "wood", d=-0.02)
        for c in cuts:
            cg = Geo()
            cyl(cg, 0, 0, 0.1, wz, 0.1, 0.1, 10, "lacquer", caps=(False, False))
            a = min(max(c, 0.12), ww - 0.12)
            g.add(cg, west.M(a, -0.6, 0))
            west.col(helpers, f"yard_w{int(c * 10)}", a - 0.11, a + 0.11, -0.71, -0.49, 0, wz)
        west.box(g, 0, ww, -0.7, -0.5, wz - 0.35, wz, "beam", skip=("+d",), uvs={"-d": [(0, 0), (ww / 1.5, 0), (ww / 1.5, 1), (0, 1)]})
        west.quad(g, [(0, -0.8, 0.08), (ww, -0.8, 0.08), (ww, 0.0, 0.08), (0, 0.0, 0.08)], "steps", (0, 0, 1))
        # the corners: a brick mass with a flat tiled top each, so the yard is closed
        for (a0, a1) in ((0.0, 6.0), (19.6, YARD[1] - YARD[0])):
            Y.box(g, a0, a1, 7.0 + 12.9, 7.0 + 18.0, 0, 3.0, "brick", skip=("-z",))
            Y.box(far, a0, a1, 7.0 + 12.9, 7.0 + 18.0, 0, 3.0, "brick", skip=("-z",))
            Y.col(helpers, f"yard_c{int(a0)}", a0, a1, 7.0 + 12.9, 7.0 + 18.0, 0, 3.0)
        # the ground: grey paving, a stone path from the gate
        ga = YARD[1] - (YARD_GATE[0] + YARD_GATE[1]) / 2      # the gate's middle, as a
        Y.quad(g, [(5.15, 7.0, 0.03), (20.7, 7.0, 0.03), (20.7, 20.45, 0.03), (5.15, 20.45, 0.03)], "paving", (0, 0, 1),
               [(0, 0), (15.55 / 4, 0), (15.55 / 4, 13.45 / 4), (0, 13.45 / 4)])
        Y.quad(g, [(ga - 0.6, 7.0, 0.04), (ga + 0.6, 7.0, 0.04), (ga + 0.6, 19.5, 0.04), (ga - 0.6, 19.5, 0.04)], "granite", (0, 0, 1))
        Y.quad(g, [(6.0, 13.0, 0.041), (19.6, 13.0, 0.041), (19.6, 14.2, 0.041), (6.0, 14.2, 0.041)], "granite", (0, 0, 1))
        # the screen wall facing the gate (you go round it)
        Y.box(g, ga - 1.4, ga + 1.4, 8.3, 8.62, 0, 2.6, "brick", skip=("-z",))
        Y.box(g, ga - 1.5, ga + 1.5, 8.22, 8.7, 2.6, 2.8, "tiles")
        Y.quad(g, [(ga - 0.35, 8.29, 1.2), (ga + 0.35, 8.29, 1.2), (ga + 0.35, 8.29, 1.9), (ga - 0.35, 8.29, 1.9)], "couplet", (0, -1, 0), sub_uv(0, 0, 1, 0.27))
        Y.col(helpers, "yard_screen", ga - 1.5, ga + 1.5, 8.22, 8.7, 0, 2.8)
        # the stone table with its 象棋 board and four drum stools; the old man sits at the one facing the gate
        ta, td = 9.2, 11.6
        tg = Geo()
        cyl(tg, 0, 0, 0.0, 0.7, 0.22, 0.3, 10, "granite")
        cyl(tg, 0, 0, 0.7, 0.78, 0.5, 0.5, 14, "granite")
        g.add(tg, Y.M(ta, td, 0))
        Y.quad(g, [(ta - 0.3, td - 0.3, 0.785), (ta + 0.3, td - 0.3, 0.785), (ta + 0.3, td + 0.3, 0.785), (ta - 0.3, td + 0.3, 0.785)], "goods", (0, 0, 1), sub_uv(*gcell["chess"]))
        Y.col(helpers, "yard_table", ta - 0.5, ta + 0.5, td - 0.5, td + 0.5, 0, 0.78)
        for (oa, od) in ((0, 0.72), (0, -0.72), (0.72, 0), (-0.72, 0)):
            sg2 = Geo()
            cyl(sg2, 0, 0, 0.0, 0.42, 0.17, 0.17, 10, "granite")
            g.add(sg2, Y.M(ta + oa, td + od, 0))
        # a bird cage on a stand by him, two pots of pomegranate, bikes against the south house, washing on a line
        cg = Geo()
        cyl(cg, 0, 0, 0.0, 1.55, 0.025, 0.025, 6, "inwood")
        cg.box(-0.02, 0.32, -0.02, 0.02, 1.52, 1.56, "inwood")
        cyl(cg, 0.3, 0, 1.0, 1.36, 0.14, 0.14, 12, "bamboo", caps=(True, False))
        lathe(cg, [(0.14, 1.36), (0.08, 1.44), (0.0, 1.47)], 12, "bamboo", x=0.3)
        cyl(cg, 0.3, 0, 1.47, 1.52, 0.006, 0.006, 4, "iron")
        g.add(cg, Y.M(ta + 1.3, td + 1.1, 0))
        for (pa_, pd_) in ((6.7, 9.6), (6.7, 17.8)):
            put("pot", Y.M(pa_, pd_, 0))
            Y.col(helpers, f"yard_pot{int(pd_)}", pa_ - 0.3, pa_ + 0.3, pd_ - 0.3, pd_ + 0.3, 0, 0.9)
        for k in range(2):
            put("bike", Y.M(19.3, 15.4 + k * 1.4, 0, yaw=math.pi / 2 + 0.1))
        la_ = 17.4
        Y.box(g, la_ - 0.01, la_ + 0.01, 9.8, 17.2, 1.95, 1.965, "iron")
        for k, dd in enumerate((10.6, 11.9, 13.3, 14.6, 15.9)):
            key = f"laundry{k % 3}"
            hw = 0.28 if k % 2 == 0 else 0.22
            for sgn in (1, -1):
                Y.quad(g, [(la_ + 0.004 * sgn, dd - hw, 1.25 if k % 2 else 1.35), (la_ + 0.004 * sgn, dd + hw, 1.25 if k % 2 else 1.35),
                           (la_ + 0.004 * sgn, dd + hw, 1.95), (la_ + 0.004 * sgn, dd - hw, 1.95)], key, (sgn, 0, 0))
        for dd in (9.8, 17.2):
            Y.box(g, la_ - 0.03, la_ + 0.03, dd - 0.03, dd + 0.03, 0, 2.0, "iron")
        # the jujube in the middle (the city plants it with the lane's 国槐)
        tp = Y.P(13.0, 15.5, 0)
        trees.append([tp.x, tp.y, 0, 0.8])
        layout["yard"] = {"gate": Y.xy(ga, -0.6), "inside": Y.xy(ga, 9.6), "area": [Y.xy(5.2, 7.0), Y.xy(20.6, 20.4)],
                          "passage": [Y.xy(ga - 0.7, 0.0), Y.xy(ga + 0.7, 7.0)],
                          "elder": Y.xy(ta, td + 0.72), "elderFace": Y.xy(ta, td), "cage": Y.xy(ta + 1.6, td + 1.1)}

    # ---- 后海: the white stone railing along the water, willows, the boats' pier, 银锭桥, the bars' tables ----
    if not LANE:
        M["marble"] = material("NL_marble", "#dcd6c8", 0.55, props=flood(0.5))
        pg = Geo()
        pg.box(-0.09, 0.09, -0.09, 0.09, 0.0, 0.78, "marble")
        pg.box(-0.12, 0.12, -0.12, 0.12, 0.78, 0.9, "marble")
        meshes["post"] = mesh_of(pg, "post", M)
        counts["post"] = 0
        hh = {"seats": [], "music": [], "boats": []}
        P0, P1, PU = HH_PIER

        def add_box(x0, x1, y0, y1, z0, z1, key, m=None):
            bg = Geo()
            bg.box(x0, x1, y0, y1, z0, z1, key)
            g.add(bg, OFF if m is None else m)

        # the railing: a post every 2 m on the water's edge, a rail and a panel between, open at the pier
        sv, k = 6.0, 0
        while sv < HH_S[1] - 0.1:
            nv = min(HH_S[1], sv + 2.0)
            at_pier = P0 - 0.4 < (sv + nv) / 2 < P1 + 0.4
            u0 = hh_shore(sv) - 0.14
            if not (P0 - 0.4 < sv < P1 + 0.4):
                put("post", OFF @ T(u0, sv, 0))
            if not at_pier:
                um = hh_shore((sv + nv) / 2) - 0.14
                add_box(um - 0.05, um + 0.05, sv + 0.1, nv - 0.1, 0.62, 0.72, "marble")
                add_box(um - 0.03, um + 0.03, sv + 0.1, nv - 0.1, 0.2, 0.6, "marble")
            sv = nv
            k += 1
        for k, (a0, a1) in enumerate(((6.0, P0 - 0.4), (P1 + 0.4, HH_S[1]))):
            for j in range(int((a1 - a0) // 10) + 1):
                b0, b1 = a0 + j * 10, min(a1, a0 + (j + 1) * 10)
                if b1 - b0 > 0.5:
                    um = hh_shore((b0 + b1) / 2) - 0.14
                    cbox(helpers, f"hh_rail{k}_{j}", um - 0.12, um + 0.12, b0, b1, 0, 0.9)
        # willows (the city's 国槐 stand in for them) between the road and the railing
        for sv in [8.0 + 12.0 * i for i in range(14)]:
            if sv < HH_S[1] and not (P0 - 3 < sv < P1 + 3):
                p = bent(hh_shore(sv) - 0.9, sv)
                trees.append([p.x, p.y, 0, 0.8])
        # the pier: planks on posts, a low rail each side, the board at its root; the boats moor along it
        root = hh_shore((P0 + P1) / 2) - 0.35
        add_box(root, PU, P0, P1, 0.08, 0.2, "wood")
        cbox(helpers, "hh_pier", root, PU, P0, P1, 0, 0.2)
        for uu in [root + 0.3 + 2.4 * i for i in range(int((PU - root) // 2.4) + 1)]:
            for ss in (P0 + 0.1, P1 - 0.1):
                cg = Geo()
                cyl(cg, 0, 0, -0.8, 0.62, 0.07, 0.07, 8, "wood", caps=(False, True))
                g.add(cg, OFF @ T(uu, ss, 0))
        for ss in (P0 + 0.1, P1 - 0.1):
            add_box(root + 0.3, PU - 0.1, ss - 0.03, ss + 0.03, 0.55, 0.6, "wood")
        for ss in (P0 + 0.12, P1 - 0.12):
            add_box(root - 0.04, root + 0.04, ss - 0.04, ss + 0.04, 0.0, 2.5, "lampiron")
        cc, rr = sign_cells["游船码头"]
        add_box(root - 0.04, root + 0.02, P0 + 0.08, P1 - 0.08, 1.88, 2.5, "wood")
        sq = Geo()
        # read from the road (facing +u, the left of the board is +s): the text runs from P1 to P0
        sq.polyn([(root - 0.045, P1 - 0.12, 1.9), (root - 0.045, P0 + 0.12, 1.9), (root - 0.045, P0 + 0.12, 2.48), (root - 0.045, P1 - 0.12, 2.48)], "sign", (-1, 0, 0),
                 uvs=atlas_uv((cc, rr), 4, 16))
        g.add(sq, OFF)
        for side, ss in ((-1, P0 - 1.15), (1, P1 + 1.15)):
            for j in range(3):
                hh["boats"].append([round(root + 2.4 + 2.6 * j, 3), round(ss, 3), 1, 0])
        hh["dock"] = {"counter": [round(root + 0.9, 3), round((P0 + P1) / 2, 3)], "pier": [[round(root, 3), P0], [PU, P1]]}
        # 银锭桥: the road's deck over the canal, stone walls down to the water, white balustrades; flat (cars cross it)
        ang = math.atan2(HH_BRIDGE[1], HH_BRIDGE[0])
        MB = OFF @ Matrix.Rotation(ang, 4, "Z")
        add_box(0.6, 9.6, -3.75, 3.75, -0.05, 0.06, "granite", MB)
        dq = Geo()
        dq.polyn([(0.6, -3.7, 0.075), (9.6, -3.7, 0.075), (9.6, 3.7, 0.075), (0.6, 3.7, 0.075)], "paving", (0, 0, 1), uvs=[(0, 0), (2.25, 0), (2.25, 1.85), (0, 1.85)])
        g.add(dq, MB)
        for sd in (-1, 1):
            y0, y1 = (-3.95, -3.75) if sd < 0 else (3.75, 3.95)
            add_box(0.8, 9.4, y0, y1, -0.7, 0.45, "granite", MB)
            yc = (y0 + y1) / 2
            for j in range(9):
                bxp = 1.0 + j * 1.025
                put("post", MB @ T(bxp, yc, 0.45))
                if j < 8:
                    add_box(bxp + 0.12, bxp + 0.905, yc - 0.05, yc + 0.05, 1.07, 1.17, "marble", MB)
                    add_box(bxp + 0.12, bxp + 0.905, yc - 0.03, yc + 0.03, 0.6, 1.02, "marble", MB)
            add_box(0.55, 0.95, yc - 0.2, yc + 0.2, 0.0, 1.45, "marble", MB)
            add_box(9.25, 9.65, yc - 0.2, yc + 0.2, 0.0, 1.45, "marble", MB)
            cbox(helpers, f"hh_bridge{sd}", 0.55, 9.65, y0 - 0.05, y1 + 0.05, 0, 1.4, m=MB)
        stele(3.45, 8.4, math.radians(-90), "hh_stele")
        # the pavement before the bars paved to their fronts (the city's stops short of them here and there: grass showed)
        for G in (g, far):
            G.polyn([OFF @ Vector(p) for p in ((-HH_HALF - 0.02, HH_S[0], 0.03), (-2.75, HH_S[0], 0.03), (-2.75, HH_S[1], 0.03), (-HH_HALF - 0.02, HH_S[1], 0.03))],
                    "paving", (0, 0, 1), uvs=[(-HH_HALF / 4, HH_S[0] / 4), (-2.75 / 4, HH_S[0] / 4), (-2.75 / 4, HH_S[1] / 4), (-HH_HALF / 4, HH_S[1] / 4)])
        # the bars' tables on the pavement: a round table, two stools, a big umbrella; every other bar
        built = [lt for lt in lots if "L" in lt]
        for i, lt in enumerate(built):
            mid = (lt["y0"] + lt["y1"]) / 2
            if i % 4 == 1:
                hh["music"].append([-HH_HALF - 0.4, round(mid, 3)])
            if lt["kind"] == "brick" or i % 2:
                continue
            tu = -HH_HALF + 1.1
            tg = Geo()
            cyl(tg, 0, 0, 0.72, 0.76, 0.4, 0.4, 14, "inwood")
            cyl(tg, 0, 0, 0.0, 0.72, 0.04, 0.04, 6, "iron")
            cyl(tg, 0, 0, 0.76, 2.25, 0.022, 0.022, 6, "iron", caps=(False, False))
            lathe(tg, [(1.15, 2.02), (0.9, 2.12), (0.0, 2.38)], 12, "laundry2" if i % 4 == 0 else "laundry0")
            g.add(tg, OFF @ T(tu, mid, 0))
            cbox(helpers, f"hh_table{i}", tu - 0.4, tu + 0.4, mid - 0.4, mid + 0.4, 0, 0.76)
            for sd in (-1, 1):
                put("stool", OFF @ T(tu, mid + sd * 0.66, 0))
                hh["seats"].append([round(tu, 3), round(mid + sd * 0.66, 3), round(tu, 3), round(mid, 3)])
            # a neon strip along a glass front's head now and then
            if lt["kind"] == "modern":
                lt["L"].box(g, 0.3, lt["L"].w - 0.3, -0.07, -0.03, 2.6, 2.66, "neon" if i % 4 == 0 else "neon2")
        hh.update({"frame": {"gx": GX, "gz": GZ, "heading": HEADING}, "half": HH_HALF, "bars": list(HH_S), "shore": [4.67, -0.0067],
                   "bridge": [[0.0, 0.0], list(HH_BRIDGE)]})
        layout["houhai"] = hh

    # ---- far level, colliders, markers ----
    # the flat colours onto the palette
    g.f = [(idx, [pal_uv(k)] * len(idx), "palette", sm) if k in PAL else (idx, uv, k, sm) for idx, uv, k, sm in g.f]
    far.build("Massing", collection("LOD1", main), M, TILE)
    tris = g.tris()
    g.build("Lane", detail, M, TILE)

    # footprints (the OSM houses under the rows go) and clear zones (no city trees, lamps or benches in the lane), each
    # stretch's turned with it; nothing over the crossing hutongs
    def marker(name, x0, x1, y0, y1, role):
        m = seg_m((y0 + y1) / 2)
        flat_marker(helpers, name, [tuple((m @ Vector((x, y, 0))).xy) for x, y in rect(x0, x1, y0, y1)], role)

    for (s0, s1) in (STRETCHES if LANE else []):
        def runs_of(cs):
            runs, y = [], s0 - 0.2
            for (c0, c1) in sorted(c for c in cs if s0 < c[0] < s1) + [(s1 + 0.2, s1 + 0.2)]:
                runs.append((y, c0))
                y = c1
            return [r for r in runs if in_part((r[0] + r[1]) / 2)]
        for side in ("w", "e"):
            sx = -1 if side == "w" else 1
            x_in, x_out = sx * (HALF + 0.05), sx * (HALF + BACK1 + 0.1)
            for i, (r0, r1) in enumerate(runs_of(crossings(side))):
                marker(f"nanluo_{side}{int(s0)}_{i}", min(x_in, x_out), max(x_in, x_out), r0, r1, "FOOTPRINT")
        for i, (r0, r1) in enumerate(runs_of(CROSSINGS)):
            marker(f"nanluo_lane{int(s0)}_{i}", -HALF - 0.1, HALF + 0.1, r0 - (1.0 if r0 < 1 else 0), r1, "CLEAR")
    if LANE and in_part(YARD[0]):
        marker("nanluo_yard", HALF + DEPTH, HALF + DEPTH + 18.2, YARD[0], YARD[1], "FOOTPRINT")
        marker("nanluo_yardclear", HALF + DEPTH, HALF + DEPTH + 13.4, YARD[0] + 4.9, YARD[1] - 5.2, "CLEAR")

    if not LANE:
        marker("hh_bars", -(HH_HALF + BACK1 + 0.1), -(HH_HALF + 0.05), HH_S[0], HH_S[1], "FOOTPRINT")
        marker("hh_pave", -(HH_HALF + 0.05), -2.95, HH_S[0] - 1.0, HH_S[1], "CLEAR")
        marker("hh_shore", 2.95, 5.0, 4.0, HH_S[1], "CLEAR")
        marker("hh_bridge", -1.0, 15.0, -5.0, 3.0, "CLEAR")
    # the gates a delivery can go to (the plate's number by each)
    for lt in lots:
        if LANE and lt["kind"] == "gate" and "L" in lt:
            layout["gates"].append({"no": lt["no"], "side": lt["side"], "door": lt["L"].xy(lt["L"].w / 2, -0.45), "in": lt["L"].xy(lt["L"].w / 2, 0.5)})
    if LANE:
        layout["lamps"] = lamps_at
        layout["lane"] = {"half": HALF, "stretches": [list(st) for st in STRETCHES], "bends": [[by, round(math.degrees(a), 4)] for by, a in BENDS],
                          "crossings": CROSSINGS, "crossingsE": CROSS_E, "parts": {k: [v[0], v[1]] for k, v in PARTS.items() if k != "houhai"}}
        layout["mouths"] = {"south": [0.0, -0.5], "fuxiang": [-HALF - 2.0, sum(FUXIANG) / 2], "chaodou": [HALF + 2.0, sum(FUXIANG) / 2],
                            "banchang": [0.0, (Y1 + M0) / 2], "dongmianhua": [0.0, M1 + 2.5], "north": [0.0, N1 + 0.5]}
        layout["frame"] = {"gx": GX, "gz": GZ, "heading": HEADING}

    p = PARTS[PART]
    o = lane_m(p[2]) @ Vector((0, p[2], 0))
    h = math.radians(HEADING)
    s = bpy.context.scene.bcity
    s.lm_id = PART
    s.name_zh, s.name_en = {"nanluo": ("南锣鼓巷", "Nanluoguxiang"), "houhai": ("后海", "Houhai")}.get(PART, ("南锣鼓巷北段", "Nanluoguxiang North"))
    s.coord_mode, s.heading = "GAME", HEADING
    s.game_x, s.game_z = GX + o.x * math.cos(h) + o.y * math.sin(h), GZ + o.x * math.sin(h) - o.y * math.cos(h)
    s.far_distance = p[3]
    s.max_texture = "2048"
    s.repo_path = REPO
    return dict(part=PART, tris=tris, far=far.tris(), lots=sum(1 for lt in lots if "L" in lt), lanterns=lantern_n, parts=counts, trees=trees)


def write_trees(part, trees):
    """The 国槐 along the lane go into the meta the export wrote (the city plants them at boot): [x, z, species, scale]
    in the game's local frame, where z is Blender's -y. import.mjs keeps them on a re-import."""
    path = os.path.join(REPO, "src", "city", "landmarks", "glb", f"{part}.meta.json")
    if not os.path.exists(path):
        return
    with open(path) as f:
        text = f.read()
    meta = json.loads(text)
    meta["trees"] = [v for x, y, sp, sc in trees for v in (round(x, 2), round(-y, 2), sp, sc)]
    if part.startswith("nanluo_"):
        meta["partOf"] = "nanluo"     # one place on the map and one check-in, the south one's
    out = json.dumps(meta, ensure_ascii=False, indent=2)
    import re
    out = re.sub(r"\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]", r"[\1, \2]", out)
    out = re.sub(r'("trees": )\[[^\]]*\]', lambda m: m.group(1) + json.dumps(meta["trees"]), out)
    with open(path, "w") as f:
        f.write(out + "\n")
    print("trees", len(trees), "->", path)


if __name__ == "__main__":
    # every part in one run (the layout is all of them): --part ID builds and exports that one only
    only = argv[argv.index("--part") + 1] if "--part" in argv else None
    lane_frame = (GX, GZ, HEADING, BENDS, HALF)
    for PART in PARTS:
        p = PARTS[PART]
        # 后海 is its own place: its own frame, no bends, its own front line
        LANE = PART != "houhai"
        GX, GZ, HEADING, BENDS, HALF = lane_frame if LANE else (*HH_FRAME, [], HH_HALF)
        OFF = Matrix.Translation(-(lane_m(p[2]) @ Vector((0, p[2], 0))))
        info = build()
        if only and PART != only:
            continue
        trees = info.pop("trees")
        print("built", info)
        out = OUT if PART == "nanluo" else OUT.replace("nanluo.blend", f"{PART}.blend")
        # (the lane's frame back for the layout written below)
        save_and_export(out, argv)
        if "--export" in argv:
            write_trees(PART, trees)
    os.makedirs(os.path.dirname(LAYOUT), exist_ok=True)
    with open(LAYOUT, "w") as f:
        json.dump(layout, f, ensure_ascii=False, indent=1)
        f.write("\n")
