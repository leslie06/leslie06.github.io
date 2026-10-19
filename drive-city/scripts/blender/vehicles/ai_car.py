# 把 AI 生成、按零件拼好的车模型（glb）加工成游戏的车身（2026-10-19，赤骏：用户用 AI 生成的法拉利风格超跑）：
# 量出模型自己的四个轮子，缩放平移到游戏车身的轮位（`--wheels zF,zR,r`，同 vehicle/Spec.ts），删掉轮子、座椅和商标，
# 每个零件的材质换成 Bodies.ts 调色板的名字（车漆 paintU 才能按车换颜色，led 是大灯、red_led 是尾灯，夜里和刹车会亮），
# 补上车牌，再减面成两套：`hi`（玩家的车）和 `lo`（车流，细小零件不要）。输出的 glb 走 car.py 一样的导入和打包：
#
#   python scripts/blender/vehicles/ai_car.py -- art/vehicles/ferrari-ai.glb .scratch/blender/chijun.glb [--wheels 1.40,-1.36,0.34]
#   node scripts/vehicles/import.mjs .scratch/blender/chijun.glb .scratch/chijun/chijun.json --group --simplify hi=0.5,lo=0.7
#   node scripts/vehicles/pack.mjs .scratch/chijun/chijun.json public/models/vehicles/coupe.bin
#
# 只认这类模型：Blender 坐标里车头朝 +Y、Z 朝上，零件名说明它是什么（轮胎叫 tires_*，座椅叫 *seat*……）。
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landmarks"))
from common import args, material  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = args()
SRC, OUT = argv[0], argv[1]
ZF, ZR, RADIUS = (float(v) for v in (argv[argv.index("--wheels") + 1] if "--wheels" in argv else "1.40,-1.36,0.34").split(","))

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
               plateF=("#2050c0", 0.35, 0.1), plateR=("#2050c0", 0.35, 0.1), liner=("#070708", 1.0, 0.0))
# 减面：大零件按比例（hi / lo），小于这么多三角面的不动
DECIMATE = dict(hi=0.45, lo=0.16)
SMALL = 300


def bbox(obs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in obs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
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

# the model's own wheels: where they stand and how big, before they go
tyres = [o for o in meshes if o.name.startswith("tires_")]
front = [o for o in tyres if "front" in o.name]
rear = [o for o in tyres if "rear" in o.name]
(flo, fhi), (rlo, rhi) = bbox(front), bbox(rear)
yF, yR = (flo.y + fhi.y) / 2, (rlo.y + rhi.y) / 2
hub = (flo.z + fhi.z + rlo.z + rhi.z) / 4
s = (ZF - ZR) / (yF - yR)
print(f"model wheels y {yF:.3f} / {yR:.3f}, hub {hub:.3f}, radius {(fhi.z - flo.z) / 2:.3f} / {(rhi.z - rlo.z) / 2:.3f}; scale {s:.4f}")

for o in list(bpy.data.objects):
    if o.name.startswith(DROP) or o.type != "MESH":
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# The ends rounded off (2026-10-19, 「这个车前面和后面都太方了，像推土机一样」: the nose and the tail were each one upright
# wall 0.5 m tall): in the model's own frame, the last stretch of each end leans back the higher it is (a raked nose, a
# tail whose top comes forward), its corners drawn in, more at the top, and its top a little lower. Smooth in y from
# behind the end, so the wheel arches and the cabin stay as they are; every part on the end moves with its surface.
def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
# Seen straight on, an end was still a wide rectangle: its outer corners are also rounded off (x drawn in by the fourth
# power of how far out they are) and its lower corners lifted, so the outline is a rounded trapezoid.
ENDS = (  # from y, to y (the tip), floor z, top z, rake, taper, corner round, corner lift, drop
    (1.75, 2.5, 0.15, 0.86, 0.38, 0.12, 0.2, 0.12, 0.07),
    (-1.8, -2.46, 0.15, 0.89, -0.28, 0.12, 0.24, 0.15, 0.05),
)
HALF_W = 0.98
def shape(co):
    x, y, z = co
    for y0, y1, z0, z1, rake, taper, rnd, lift, drop in ENDS:
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

# into place: the model's hub height to z 0, its axles onto the game's (Blender frame: +Y forward, +Z up)
for o in meshes:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
    for v in o.data.vertices:
        c = shape(v.co)
        v.co = Vector((c.x * s, (c.y - yR) * s + ZR, (c.z - hub) * s))
    o.data.update()
    for i, m in enumerate(o.data.materials):
        key = MAT.get(m.name[4:] if m else "", "black")
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
zr = 0.56 * s - hub * s
yb = surface(zr, False)
if yb is not None:
    meshes.append(plate("plateR", "plateR", -0.22, 0.22, zr - 0.07, zr + 0.07, yb - 0.03, -1))
zf = (0.4 - hub) * s
yf = surface(zf, True)
if yf is not None:
    meshes.append(plate("plateF", "plateF", -0.2, 0.2, zf - 0.055, zf + 0.055, yf + 0.008, 1))

# Wheel wells: the model has none (its own wheels filled the arches), so round the game's smaller wheels the sky showed
# through. Each wheel gets a black disc inboard and a half-cylinder over it, both seen from either side.
def liner(name, yc, side):
    me = bpy.data.meshes.new(name)
    r, n, x0, x1, floor = RADIUS + 0.09, 20, side * 0.6, side * 0.88, -RADIUS + 0.12
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
        if grp == "lo" and o.name.startswith(DETAIL):
            continue
        c = o.copy()
        c.data = o.data.copy()
        c.name = f"{grp}__{o.name}"
        bpy.context.scene.collection.objects.link(c)
        if tris(c) > SMALL:
            d = c.modifiers.new("dec", "DECIMATE")
            d.ratio = DECIMATE[grp]
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
