# 把 AI 生成、按零件拼好的车模型（glb）加工成游戏的车身（2026-10-19，用户用 AI 生成的超跑：赤骏 = 法拉利风格，
# 蛮牛 = 兰博基尼风格）：量出模型自己的四个轮子，转正、缩放平移到游戏车身的轮位（`--wheels zF,zR,r`，同 vehicle/Spec.ts），
# 删掉轮子、座椅和商标，每个零件的材质换成 Bodies.ts 调色板的名字（车漆 paintU 才能按车换颜色，大灯、尾灯夜里和刹车会亮），
# 补上车牌和轮罩，再分成两套：`hi`（玩家的车）和 `lo`（车流，细小零件不要、减面更多）。每种模型的零件名、材质名、朝向
# 不一样，各有一份配置（`PROFILES`，`--profile`，不给就按文件名猜）。输出的 glb 走 car.py 一样的导入和打包：
#
#   python scripts/blender/vehicles/ai_car.py -- art/vehicles/ferrari-ai.glb .scratch/blender/chijun.glb [--profile ferrari] [--wheels 1.40,-1.36,0.34]
#   node scripts/vehicles/import.mjs .scratch/blender/chijun.glb .scratch/chijun/chijun.json --group --simplify hi=0.5,lo=0.7
#   node scripts/vehicles/pack.mjs .scratch/chijun/chijun.json public/models/vehicles/coupe.bin
#
#   python scripts/blender/vehicles/ai_car.py -- art/vehicles/lamborghini-ai.glb .scratch/blender/manniu.glb
#   node scripts/vehicles/import.mjs .scratch/blender/manniu.glb .scratch/manniu/manniu.json --group
#   node scripts/vehicles/pack.mjs .scratch/manniu/manniu.json public/models/vehicles/super.bin
#
#   python scripts/blender/vehicles/ai_car.py -- art/vehicles/toyota_corolla_ae86_trueno.glb .scratch/blender/ae86.glb
#   node scripts/vehicles/import.mjs .scratch/blender/ae86.glb .scratch/ae86/ae86.json --group
#   node scripts/vehicles/pack.mjs .scratch/ae86/ae86.json public/models/vehicles/ae86.bin
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import args, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

argv = args()
SRC, OUT = argv[0], argv[1]
_base = os.path.basename(SRC)
PROFILE = argv[argv.index("--profile") + 1] if "--profile" in argv else ("lambo" if "lamborghini" in _base else "ae86" if "ae86" in _base else "ferrari")

# ---- 赤骏（ferrari-ai.glb：333 个按零件分开的物体，车头朝 +Y） ----
# 零件名开头 -> 处理：删掉的（轮子由游戏代码画、座椅头枕穿出车顶、法拉利的黄盾和马是商标；车头下面的薄板、车尾的黑色底座
# 和一排竖片在两头收圆以后像推土机的铲子，也不要）
DROP = ("tires_", "tire_", "black_outer_wheel_rim", "machined_outer_wheel_lip", "split_five_spoke", "spoke_glint", "wheel_lug_nut",
        "yellow_center_cap", "center_cap_dark_logo", "inner_disc_hub", "inner_black_hub_ring", "ventilated_steel_brake_rotor",
        "red_brembo_style_caliper", "bucket_seat", "sculpted_bucket_seat", "seat_", "shield_yellow", "side_shield_black_horse",
        "yellow_front_badge", "center_rear_number_plaque", "splitter_highlight", "rear_diffuser_vertical_fins",
        "front_carbon_splitter", "rear_black_diffuser_base", "world")
# 车流那套（lo）也不要的细小零件
DETAIL = ("engine_bay_vent_slats", "rear_black_mesh_stripes", "front_grille_vertical_mesh", "headlamp_led_pixel", "rear_diffuser_vertical_fins",
          "upper_glass_silver_glint", "side_beltline_shimmer", "hood_nostril_chrome_crease", "splitter_highlight", "dashboard",
          "three_spoke_steering_wheel", "flush_black_door_handle", "mirror_reflective_surface", "brushed_exhaust_ring", "side_window_lower_trim",
          "door_upper_creased_blade", "center_hood_v_crease", "red_rear_fin_outline", "black_roof_red_edge", "hood_aero_edge")
# 模型的材质 -> 游戏调色板（Bodies.ts 的 Surf 名）
MAT = dict(rosso_corsa="paintU", rosso_highlight="paintU", rosso_dark="paintL", glass="glass", glass_reflect="glass", glass_dark="glassDark",
           black_gloss="gloss", carbon="black", metal="satin", gunmetal="satin", led="head", red_led="tail", brake_red="brake",
           tire="rubber", tire_tread="rubber", seat="black", seat_black="black", yellow="amber", brake_disc="satin")
COLOURS = dict(paintU=("#c41e1e", 0.3, 0.0), paintL=("#c41e1e", 0.3, 0.0), glass=("#0a0f14", 0.05, 0.0), glassDark=("#07090b", 0.05, 0.0),
               black=("#111213", 0.5, 0.0), gloss=("#0a0b0c", 0.14, 0.2), satin=("#a9adb2", 0.32, 0.9), rubber=("#0d0d0e", 0.85, 0.0),
               head=("#e8ecf0", 0.08, 0.6), tail=("#a01010", 0.12, 0.1), brake=("#c01010", 0.15, 0.0), amber=("#e09020", 0.1, 0.2),
               plateF=("#2050c0", 0.35, 0.1), plateR=("#2050c0", 0.35, 0.1), liner=("#070708", 1.0, 0.0),
               seam=("#050505", 0.85, 0.0), reverse=("#c9cdd1", 0.1, 0.2), plateJ=("#f2f2ef", 0.35, 0.1), tofu=("#111111", 0.4, 0.0))
# 减面：大零件按比例（hi / lo），小于这么多三角面的不动
SMALL = 300

# ---- 蛮牛（lamborghini-ai.glb：62 个物体，「部件__材质」，车身、四个轮子、尾翼；车头朝 -X，3.4 万三角面里轮子占了大半） ----
MAT_LAMBO = dict(Verde_Nova_Pearl="paintU", Verde_Nova_Highlight="paintU", Verde_Nova_Shadow="paintL", Deep_Glass="glass",
                 Smoked_Reflective_Glass="glassDark", Exposed_Carbon="black", Satin_Dark_Carbon="black", Intake_Black="black",
                 DRL_Ice_White="head", DRL_Cool_Blue="head", Rear_LED_Red="tail", Diamond_Cut_Highlights="satin")


# The ends rounded off (2026-10-19, 「这个车前面和后面都太方了，像推土机一样」: the nose and the tail were each one upright
# wall 0.5 m tall): in the model's own frame, the last stretch of each end leans back the higher it is (a raked nose, a
# tail whose top comes forward), its corners drawn in, more at the top, and its top a little lower. Smooth in y from
# behind the end, so the wheel arches and the cabin stay as they are; every part on the end moves with its surface.
# Seen straight on, an end was still a wide rectangle: its outer corners are also rounded off (x drawn in by the fourth
# power of how far out they are) and its lower corners lifted, so the outline is a rounded trapezoid.
ENDS = (  # from y, to y (the tip), floor z, top z, rake, taper, corner round, corner lift, drop
    (1.75, 2.5, 0.15, 0.86, 0.38, 0.12, 0.2, 0.12, 0.07),
    (-1.8, -2.46, 0.15, 0.89, -0.28, 0.12, 0.24, 0.15, 0.05),
)

# ---- AE86（toyota_corolla_ae86_trueno.glb，Sketchfab：28 个物体，名字都是 Object_N，一个物体一种材质；车头朝 -Y，
# 引擎盖是黑色碳纤维盖，翻灯是翻起来的） ----
# 2026-10-22，用户「头文字的AE86长这样，尽量还原」（电影剧照：熊猫配色，白色引擎盖，翻灯合着，两边车门都有「藤原とうふ店（自家用）」）
AE86_XC = 0.035                                                             # 模型的中线不在 x 0（车身 -1.81..1.88）
AE86_TYRES = {"Object_15", "Object_19", "Object_23", "Object_27"}            # 轮胎（量轮位用），前轮是 y < 0 的两个
AE86_WHEELS = {f"Object_{n}" for n in (14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28)}
MAT_AE86 = {"Material.001": "paintU", "Material.002": "gloss", "Material.005": "reverse", "Material.006": "tail", "Material.007": "amber",
            "Material.010": "black", "Material.011": "glass", "Material.012": "head", "Material.013": "seam", "Material.014": "tail",
            "Material.034": "black", "fpostersmallwall_textureproduct750x1000": "plateJ", "tofu_shop.002": "tofu",
            "HOOD": "paintU", "REV": "reverse"}


def pieces(bm):
    """Connected pieces of a bmesh (by shared vertices), as lists of faces."""
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        piece, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            piece.append(f)
            for v in f.verts:
                for g in v.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        out.append(piece)
    return out


def src_mat(name):
    m = bpy.data.materials.get("src_" + name)
    return m or bpy.data.materials.new("src_" + name)


def fit_uv(o, faces=None, flip_v=False):
    """The model's UVs point into its own textures; the game's atlas graphics take 0..1 over the part (`flip_v`: the
    model's texture is stored upside down, its lettering would read upside down in the atlas's)."""
    uv = o.data.uv_layers[0].data
    loops = [li for p in o.data.polygons if faces is None or p.index in faces for li in p.loop_indices]
    us, vs = [uv[li].uv[0] for li in loops], [uv[li].uv[1] for li in loops]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for li in loops:
        v = (uv[li].uv[1] - v0) / max(1e-6, v1 - v0)
        uv[li].uv = ((uv[li].uv[0] - u0) / max(1e-6, u1 - u0), 1 - v if flip_v else v)


def ae86_edit(meshes):
    """
    In the model's own frame (front -Y, metres x ~2.3). The film's car, not this one's tuned look:
    - the pop-up lamps go down: the raised pods and their lenses go, and a lid in the body colour closes each bay, its
      top continuing the hood and the fender's top, its front edge black like the lip below it;
    - the hood and the fenders' tops are white (the model's carbon hood is black, 「车前盖是黑色的，而且有点厚重」);
    - 藤原とうふ店 on both doors (the model has it on one), the plates and lamps with their UVs over 0..1 for the atlas.
    """
    by = {o.name: o for o in meshes}
    body, lens = by["Object_5"], by["Object_8"]
    ax = lambda x: abs(x - AE86_XC)
    # the pods: the housings, their caps and backs and sides (black), and the front lenses
    def drop_pieces(o, test):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        gone = []
        for piece in pieces(bm):
            vs = [v.co for f in piece for v in f.verts]
            lo = Vector([min(v[i] for v in vs) for i in range(3)])
            hi = Vector([max(v[i] for v in vs) for i in range(3)])
            if test(lo, hi):
                gone += piece
                if os.environ.get("AE86_DEBUG"):
                    print("  piece", len(piece), [round(c, 2) for c in (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z)])
        bmesh.ops.delete(bm, geom=gone, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        print("ae86: dropped", len(gone), "faces of", o.name)
    inbay = lambda lo, hi: (lo.x - AE86_XC) * (hi.x - AE86_XC) > 0 and min(ax(lo.x), ax(hi.x)) > 0.82 and max(ax(lo.x), ax(hi.x)) < 1.47
    pod = lambda lo, hi: inbay(lo, hi) and hi.y < -3.7 and (lo.z > 0.4 and lo.y > -4.25 or hi.z > 0.75)
    walls = lambda lo, hi: hi.x - lo.x < 0.03 and 0.82 < ax(lo.x) < 1.47 and hi.y < -3.7 and hi.z > 0.75
    # the lamps' buckets in the bays: their rims stand above a closed lid
    bucket = lambda lo, hi: inbay(lo, hi) and lo.y > -4.35 and hi.y < -3.75 and lo.z > 0.25 and hi.z < 0.72
    drop_pieces(body, lambda lo, hi: pod(lo, hi) or walls(lo, hi) or bucket(lo, hi))
    drop_pieces(lens, lambda lo, hi: hi.y < 0)

    # the hood and the fenders' tops: upward faces ahead of the screen
    hood = src_mat("HOOD")
    body.data.materials.append(hood)
    hi_idx = len(body.data.materials) - 1
    n = 0
    for p in body.data.polygons:
        c = p.center
        if p.normal.z > 0.3 and c.y < -1.62 and c.z > 0.45 and ax(c.x) < 1.6:
            p.material_index = hi_idx
            n += 1
    print("ae86: hood faces", n)

    # the lids: top from the fender's front edge (behind the bay) falling as the hood does, front face down to the lip
    tb = bmesh.new()
    tb.from_mesh(body.data)
    tree = BVHTree.FromBMesh(tb)
    def down(x, y):
        hit = tree.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)))
        return hit[0].z if hit[0] is not None else None
    YB, YF, X0, X1, ZLIP = -3.79, -4.25, 0.835, 1.445, 0.31
    hz = lambda y: down(AE86_XC + 0.77, y)
    nx, ny = 5, 4
    verts, faces, mats = [], [], []
    for side in (1, -1):
        b = len(verts)
        for j in range(ny + 1):
            y = YB + (YF - YB) * j / ny
            for i in range(nx + 1):
                x = X0 + (X1 - X0) * i / nx
                zb = down(AE86_XC + x * side, YB + 0.03) or hz(YB)
                verts.append((AE86_XC + x * side, y, zb + (hz(y) - hz(YB)) + 0.006))
        for j in range(ny):
            for i in range(nx):
                a = b + j * (nx + 1) + i
                q = [a, a + 1, a + nx + 2, a + nx + 1]
                faces.append(q if side < 0 else q[::-1])
                mats.append(0)
        # front face: the top's front row down to the lip
        f0 = b + ny * (nx + 1)
        lb = len(verts)
        for i in range(nx + 1):
            x, y, z = verts[f0 + i]
            verts.append((x, y - 0.004, ZLIP))
        for i in range(nx):
            q = [f0 + i, f0 + i + 1, lb + i + 1, lb + i]
            faces.append(q if side > 0 else q[::-1])
            mats.append(1)
    me = bpy.data.meshes.new("lids")
    me.from_pydata(verts, [], faces)
    me.materials.append(hood)
    me.materials.append(src_mat("Material.002"))
    for p, m in zip(me.polygons, mats):
        p.material_index = m
    me.uv_layers.new()
    lids = bpy.data.objects.new("lids", me)
    bpy.context.scene.collection.objects.link(lids)

    # the lettering on the other door too: mirrored, its faces turned and its u flipped so it reads
    src = by["Object_38"]
    me = src.data.copy()
    for v in me.vertices:
        v.co.x = 2 * AE86_XC - v.co.x
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces), flip_multires=False)
    uvl = bm.loops.layers.uv.active
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv.x = 1 - l[uvl].uv.x
    bm.to_mesh(me)
    bm.free()
    door2 = bpy.data.objects.new("Object_38_mirror", me)
    bpy.context.scene.collection.objects.link(door2)

    # UVs over 0..1 for the atlas graphics: the plates, the lamps
    for name in ("Object_7", "Object_10", "Object_6"):
        fit_uv(by[name])
    for name in ("Object_30", "Object_33", "Object_38"):
        fit_uv(by[name], flip_v=True)
    fit_uv(door2, flip_v=True)
    # the tail lamps' inner sections are the reversing lamps, the outer ones red
    o = by["Object_12"]
    o.data.materials.append(src_mat("REV"))
    for p in o.data.polygons:
        if ax(p.center.x) < 1.0:
            p.material_index = 1
    fit_uv(o)
    return [lids, door2]


PROFILES = dict(
    ferrari=dict(
        forward="+y", wheels="1.40,-1.36,0.34",
        tyre=lambda n: n.startswith("tires_"), front=lambda n: "front" in n,
        drop=lambda n: n.startswith(DROP), detail=lambda n: n.startswith(DETAIL), mat=MAT,
        ends=ENDS, half_w=0.98, decimate=dict(hi=0.45, lo=0.16),
        plate_r=0.56, plate_f=0.4, plate_size=(0.44, 0.14), well=(0.6, 0.88), trim=None),
    lambo=dict(
        # the wheels and the hood's gold bull (a trademark) go
        forward="-x", wheels="1.38,-1.32,0.36",
        tyre=lambda n: "_Wheel__Performance_Tire" in n, front=lambda n: n.startswith("Front_"),
        drop=lambda n: "_Wheel__" in n or "Emblem" in n or n == "world", detail=lambda n: False, mat=MAT_LAMBO,
        ends=(), half_w=1.0, decimate=dict(hi=1.0, lo=0.6),
        plate_r=0.548, plate_f=0.3, plate_size=(0.3, 0.095), well=(0.72, 1.0),
        # the parts are merged by material, so the low blades at the ends (a splitter out in front, a toothed diffuser
        # behind: 「像推土机一样」 on 赤骏) go by place: black faces under 0.22 m, ahead of the nose's start or behind the tail's
        trim=lambda c, mat: mat == "black" and c.z < 0.22 and (c.y > 1.95 or c.y < -1.8)),
    # AE86: a wheelbase of 2.40 m and the model's own 0.72 m half track; the plates are the model's (群馬55 お13-954)
    ae86=dict(
        forward="-y", wheels="1.26,-1.14,0.29",
        tyre=lambda n: n in AE86_TYRES, front=lambda n: n in ("Object_23", "Object_27"),
        drop=lambda n: n in AE86_WHEELS, detail=lambda n: n in ("Object_11", "Object_39", "Object_31", "Object_34"), mat=MAT_AE86,
        ends=(), half_w=0.8, decimate=dict(hi=1.0, lo=0.55),
        plate_r=None, plate_f=None, plate_size=(0.3, 0.15), well=(0.5, 0.78), trim=None, edit=ae86_edit, xc=AE86_XC),
)
P = PROFILES[PROFILE]
ZF, ZR, RADIUS = (float(v) for v in (argv[argv.index("--wheels") + 1] if "--wheels" in argv else P["wheels"]).split(","))


def bbox(obs):
    """From the vertices: an object's cached bound_box is stale once its mesh has been edited (turned, moved)."""
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in obs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
    return lo, hi


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def plate(name, mat, x0, x1, z0, z1, y, facing):
    """A plate quad with 0..1 UVs (the plate texture), standing at y, facing +Y (front) or -Y (back)."""
    me = bpy.data.meshes.new(name)
    vs = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    f = (0, 1, 2, 3) if facing < 0 else (3, 2, 1, 0)
    me.from_pydata(vs, [], [f])
    uv = me.uv_layers.new()
    for li, (u, v) in zip(me.polygons[0].loop_indices, [(0, 0), (1, 0), (1, 1), (0, 1)] if facing < 0 else [(1, 1), (0, 1), (0, 0), (1, 0)]):
        uv.data[li].uv = (u, v)
    me.materials.append(M[mat])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
# the model's own materials out of the way of the palette's names (its "glass" would push ours to "glass.001")
for m in list(bpy.data.materials):
    m.name = "src_" + m.name
M = {k: material(k, *v) for k, v in COLOURS.items()}
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# every mesh in the world frame, turned so the car faces +Y (Blender's +X is then its right)
for o in meshes:
    # (the AE86's parts hang under scaled empties: unparented, or the export puts the parents' scale on again)
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world.identity()
    o.data.update()
if P.get("edit"):
    meshes += P["edit"](meshes)
for o in meshes:
    if P["forward"] == "-x":
        for v in o.data.vertices:
            v.co = Vector((v.co.y, -v.co.x, v.co.z))
    elif P["forward"] == "-y":
        for v in o.data.vertices:
            v.co = Vector((-v.co.x, -v.co.y, v.co.z))
    o.data.update()

# the model's own wheels: where they stand and how big, before they go
tyres = [o for o in meshes if P["tyre"](o.name)]
front = [o for o in tyres if P["front"](o.name)]
rear = [o for o in tyres if not P["front"](o.name)]
(flo, fhi), (rlo, rhi) = bbox(front), bbox(rear)
yF, yR = (flo.y + fhi.y) / 2, (rlo.y + rhi.y) / 2
hub = (flo.z + fhi.z + rlo.z + rhi.z) / 4
s = (ZF - ZR) / (yF - yR)
print(f"model wheels y {yF:.3f} / {yR:.3f}, hub {hub:.3f}, radius {(fhi.z - flo.z) / 2:.3f} / {(rhi.z - rlo.z) / 2:.3f}; scale {s:.4f}")

for o in list(bpy.data.objects):
    if o.type != "MESH" or P["drop"](o.name):
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]


def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


HALF_W = P["half_w"]
def shape(co):
    x, y, z = co
    for y0, y1, z0, z1, rake, taper, rnd, lift, drop in P["ends"]:
        t = smooth(y0, y1, y)
        if t <= 0:
            continue
        h = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        e = min(1.0, abs(x) / HALF_W) ** 4
        y -= rake * t * h ** 1.2
        z += lift * t * e * (1 - h) - drop * t * h
        x *= 1 - taper * t * t * (0.4 + 0.6 * h)
        x -= math.copysign(rnd * t ** 1.5 * e, x)
    return Vector((x, y, z))

# blades and the like the profile cuts away by place (in the model's frame, before anything moves)
if P["trim"]:
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        mats = [P["mat"].get(m.name[4:] if m else "", "black") for m in o.data.materials]
        gone = [f for f in bm.faces if P["trim"](f.calc_center_median(), mats[f.material_index] if mats else "black")]
        if gone:
            bmesh.ops.delete(bm, geom=gone, context="FACES")
            print("trimmed", len(gone), "faces off", o.name)
        bm.to_mesh(o.data)
        bm.free()

# into place: the model's hub height to z 0, its axles onto the game's (Blender frame: +Y forward, +Z up)
for o in meshes:
    for v in o.data.vertices:
        c = shape(v.co)
        v.co = Vector((c.x * s, (c.y - yR) * s + ZR, (c.z - hub) * s))
        if P.get("xc"):  # the model's centre line onto x 0 (turned with the model: -y flips x)
            v.co.x += P["xc"] * s * (1 if P["forward"] == "-y" else -1)
    o.data.update()
    for i, m in enumerate(o.data.materials):
        key = P["mat"].get(m.name[4:] if m else "", "black")
        o.data.materials[i] = M[key]

# Facing out. The model's materials are all double-sided and its big panels single open sheets, wound either way; the game
# draws front faces only (2026-10-19: the side glass was gone and the body could be seen through). Each connected piece is
# made consistent, then flipped as a whole if it faces in on the whole: the faces' normals against the way out from the
# car's core (a line along it at the middle of its height). Small open pieces (lips, fins, the wing, the mirror arms) are
# seen from both sides: they get their faces twice, once each way (`TWO`).
zc = 0.12
TWO = set()
for o in meshes:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        piece, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        score = 0.0
        for f in piece:
            c = f.calc_center_median()
            out = Vector((c.x, 0.0, c.z - zc))
            if out.length < 1e-6:
                continue
            score += f.normal.dot(out.normalized()) * f.calc_area()
        if score < 0:
            for f in piece:
                f.normal_flip()
    if any(e.is_boundary for e in bm.edges) and sum(len(f.verts) - 2 for f in bm.faces) <= 1200:
        TWO.add(o.name)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()

# plates where the model has room: the rear on the black fascia between the lamps, the front on the nose's centre
dg = bpy.context.evaluated_depsgraph_get()
lo, hi = bbox(meshes)
def surface(z, from_front):
    y0 = hi.y + 1 if from_front else lo.y - 1
    ok, loc, *_ = bpy.context.scene.ray_cast(dg, Vector((0, y0, z)), Vector((0, -1 if from_front else 1, 0)))
    return loc.y if ok else None
zr = ((P["plate_r"] or 0) - hub) * s
yb = surface(zr, False) if P["plate_r"] else None
if yb is not None:
    pw, ph = P["plate_size"]
    meshes.append(plate("plateR", "plateR", -pw / 2, pw / 2, zr - ph / 2, zr + ph / 2, yb - 0.03, -1))
zf = ((P["plate_f"] or 0) - hub) * s
yf = surface(zf, True) if P["plate_f"] else None
if yf is not None:
    meshes.append(plate("plateF", "plateF", -0.2, 0.2, zf - 0.055, zf + 0.055, yf + 0.008, 1))

# Wheel wells: the model has none (its own wheels filled the arches), so round the game's smaller wheels the sky showed
# through. Each wheel gets a black disc inboard and a half-cylinder over it, both seen from either side.
def liner(name, yc, side):
    me = bpy.data.meshes.new(name)
    r, n, x0, x1, floor = RADIUS + 0.09, 20, side * P["well"][0], side * P["well"][1], -RADIUS + 0.12
    ring = [(yc + r * math.cos(math.pi * 2 * k / n), max(floor, r * math.sin(math.pi * 2 * k / n))) for k in range(n)]
    vs = [(x0, y, z) for y, z in ring]
    faces = [list(range(n))]
    top = [(yc + r * math.cos(math.pi * k / 10), r * math.sin(math.pi * k / 10)) for k in range(11)]
    b = len(vs)
    vs += [(x0, y, z) for y, z in top] + [(x1, y, z) for y, z in top]
    faces += [[b + k, b + k + 1, b + 12 + k, b + 11 + k] for k in range(10)]
    me.from_pydata(vs, [], faces)
    me.materials.append(M["liner"])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    TWO.add(name)
    return ob
for yc in (ZF, ZR):
    for side in (1, -1):
        meshes.append(liner(f"well_{yc}_{side}", yc, side))

# two sets: hi (all of it, the big parts thinned) and lo (no small details, thinned harder)
for grp in ("hi", "lo"):
    n = 0
    for o in meshes:
        if grp == "lo" and P["detail"](o.name):
            continue
        c = o.copy()
        c.data = o.data.copy()
        c.name = f"{grp}__{o.name}"
        bpy.context.scene.collection.objects.link(c)
        if tris(c) > SMALL and P["decimate"][grp] < 1:
            d = c.modifiers.new("dec", "DECIMATE")
            d.ratio = P["decimate"][grp]
            d.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = c
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(c.evaluated_get(dg))
            c.modifiers.clear()
            c.data = me
        if o.name in TWO:
            bm = bmesh.new()
            bm.from_mesh(c.data)
            back = bmesh.ops.duplicate(bm, geom=list(bm.faces))["geom"]
            bmesh.ops.reverse_faces(bm, faces=[g for g in back if isinstance(g, bmesh.types.BMFace)])
            bm.to_mesh(c.data)
            bm.free()
        for p in c.data.polygons:
            p.use_smooth = True
        c.data.set_sharp_from_angle(angle=math.radians(35))
        n += tris(c)
    print(grp, n, "triangles")
for o in meshes:
    bpy.data.objects.remove(o)

lo, hi = bbox([o for o in bpy.data.objects if o.name.startswith("hi__")])
print(f"body: {hi.y - lo.y:.2f} m long, {hi.x - lo.x:.2f} wide, {hi.z - lo.z:.2f} from its lowest point to the roof; ground at z {-RADIUS:.2f}")
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format="GLB", export_apply=True, use_selection=False)
print("exported", OUT)
