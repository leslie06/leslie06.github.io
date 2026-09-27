# B城地标导出 / B City Landmark - a Blender add-on for drive-city (b城追车).
#
# Marks objects with the naming conventions the game's glb loader reads (src/city/landmarks/glb/Glb.ts),
# builds colliders, stair ramps and the footprint, sets the material properties the game's night and
# rain looks read, checks the scene, and exports straight into the game through
# scripts/landmarks/import.mjs. Sidebar (N) > B城.
#
# Install: Blender 4.2+, Edit > Preferences > Get Extensions > (menu) Install from Disk... and pick the
# zip `npm run blender-addon` builds (scripts/blender/bcity_landmark.zip). Or open this file in the
# Scripting workspace and Run Script.

bl_info = {
    "name": "B城地标导出 (B City Landmark)",
    "author": "drive-city",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D 视图 > 侧栏 (N) > B城",
    "description": "把 Blender 模型按约定标记、生成碰撞体并一键导出为 b城追车 的地标",
    "category": "Import-Export",
}

import json
import math
import os
import re
import shutil
import subprocess
import webbrowser
from itertools import product

import bpy  # before bmesh: the bpy module only provides bmesh once bpy is loaded
import bmesh
from bpy.props import BoolProperty, CollectionProperty, EnumProperty, FloatProperty, FloatVectorProperty, IntProperty, PointerProperty, StringProperty
from mathutils import Matrix, Vector

# --- roles (keep in step with Glb.ts `RE` and scripts/landmarks/lib.mjs `ROLE`) -----------------------

SEP = r"(?:[_\-.\s\d]|$)"
ROLE_RE = [
    ("COLMESH", re.compile(r"^COLMESH" + SEP, re.I)),
    ("COL", re.compile(r"^COL" + SEP, re.I)),
    ("WALK", re.compile(r"^WALK" + SEP, re.I)),
    ("FOOTPRINT", re.compile(r"^FOOTPRINT" + SEP, re.I)),
    ("CLEAR", re.compile(r"^CLEAR" + SEP, re.I)),
]
LEVEL_RE = [("LOD1", re.compile(r"^LOD1" + SEP, re.I)), ("LOD0", re.compile(r"^LOD0" + SEP, re.I))]
PREFIX_RE = re.compile(r"^(?:COLMESH|COL|WALK|LOD0|LOD1|FOOTPRINT|CLEAR)(?:[_\-.\s]+|$)", re.I)
COLLIDERS = {"COL", "WALK", "COLMESH"}
MARKERS = COLLIDERS | {"FOOTPRINT", "CLEAR"}

ROLES = [
    ("VISIBLE", "可见", "清除标记：渲染，属于近景"),
    ("COL", "碰撞体", "COL_：车和人都挡，不渲染。只绕 Z 轴转的长方体变成盒子，其他取凸包"),
    ("WALK", "只挡人", "WALK_：楼梯坡道。人能走上去的坡车也能开上去，所以只挡人"),
    ("COLMESH", "凹形碰撞", "COLMESH_：按三角面生成，台基、下沉广场"),
    ("LOD1", "远景", "LOD1_：远处显示的简模（默认 800 m 外）"),
    ("LOD0", "仅近景", "LOD0_：只在近处显示"),
    ("FOOTPRINT", "占地", "FOOTPRINT：中心落在里面的 OSM 楼会被删掉"),
    ("CLEAR", "清空区", "CLEAR_：清掉行道树、路灯和街道家具（比如车道口）"),
]
ROLE_LABEL = {r[0]: r[1] for r in ROLES} | {"DETAIL": "近景"}
ROLE_COLOR = {
    "COL": (1.0, 0.25, 0.2, 1.0), "WALK": (0.25, 0.9, 0.35, 1.0), "COLMESH": (1.0, 0.6, 0.15, 1.0),
    "FOOTPRINT": (0.3, 0.55, 1.0, 1.0), "CLEAR": (1.0, 0.9, 0.2, 1.0),
}


def _collection_parents():
    parents = {}
    for c in bpy.data.collections:
        for ch in c.children:
            parents.setdefault(ch.name, []).append(c)
    return parents


def name_chain(obj):
    """Names from the object up through its parents, then its collections inward-out: the node chain the export writes."""
    names = []
    p = obj
    while p:
        names.append(p.name)
        top = p
        p = p.parent
    parents = _collection_parents()
    c = top.users_collection[0] if top.users_collection else None
    while c is not None:
        names.append(c.name)
        up = parents.get(c.name)
        c = up[0] if up else None
    return names


def role_of(obj):
    level = None
    for n in name_chain(obj):
        for role, rx in ROLE_RE:
            if rx.match(n):
                return role
        if level is None:
            for role, rx in LEVEL_RE:
                if rx.match(n):
                    level = role
    return level or "DETAIL"


def base_name(name):
    while True:
        m = PREFIX_RE.match(name)
        if not m or m.end() == 0:
            return name or "obj"
        name = name[m.end():]


def style(obj, role):
    if role in MARKERS:
        obj.display_type = "WIRE"
        obj.hide_render = True
        obj.color = ROLE_COLOR[role]
    else:
        obj.display_type = "TEXTURED"
        obj.hide_render = False


def rename(obj, role):
    base = base_name(obj.name)
    obj.name = base if role == "VISIBLE" else f"{role}_{base}"
    style(obj, role)


def helper_collection(context, name="碰撞体"):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    if coll.name not in context.scene.collection.children:
        context.scene.collection.children.link(coll)
    return coll


def new_object(context, name, verts, faces, matrix, role):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = matrix
    helper_collection(context).objects.link(ob)
    style(ob, role)
    return ob


def local_bounds(obj):
    pts = [Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def world_points(obj, depsgraph):
    oe = obj.evaluated_get(depsgraph)
    me = oe.to_mesh()
    try:
        m = oe.matrix_world
        return [m @ v.co for v in me.vertices], sum(len(p.vertices) - 2 for p in me.polygons)
    finally:
        oe.to_mesh_clear()


def hull2(pts):
    p = sorted(set((round(x, 3), round(y, 3)) for x, y in pts))
    if len(p) < 3:
        return p
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
            hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]


def exported_objects(context):
    """Meshes the export writes: everything in the scene's view layer (hidden ones too, the exporter keeps them)."""
    return [o for o in context.scene.objects if o.type == "MESH" and o.name in context.view_layer.objects]


# --- settings ----------------------------------------------------------------------------------------

def _config_path():
    return os.path.join(bpy.utils.user_resource("CONFIG", path="bcity_landmark", create=True), "config.json")


def load_config():
    try:
        with open(_config_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(**kw):
    cfg = load_config()
    cfg.update({k: v for k, v in kw.items() if v})
    try:
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def is_repo(path):
    return bool(path) and os.path.isfile(os.path.join(path, "scripts", "landmarks", "import.mjs"))


def resolve_repo(s):
    """The drive-city folder: the setting, the last one used, or a folder above the .blend."""
    for cand in (bpy.path.abspath(s.repo_path) if s.repo_path else "", load_config().get("repo_path", "")):
        if is_repo(cand):
            return os.path.normpath(cand)
    d = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ""
    while d and os.path.dirname(d) != d:
        if is_repo(d):
            return d
        if is_repo(os.path.join(d, "drive-city")):
            return os.path.join(d, "drive-city")
        d = os.path.dirname(d)
    return ""


def resolve_node(s):
    cands = [bpy.path.abspath(s.node_path) if s.node_path else "", load_config().get("node_path", ""), shutil.which("node") or ""]
    home = os.path.expanduser("~")
    cands += ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", os.path.join(home, ".volta", "bin", "node")]
    nvm = os.path.join(home, ".nvm", "versions", "node")
    if os.path.isdir(nvm):
        def ver(v):
            try:
                return tuple(int(x) for x in v.lstrip("v").split("."))
            except ValueError:
                return (0,)
        cands += [os.path.join(nvm, v, "bin", "node") for v in sorted(os.listdir(nvm), key=ver, reverse=True)]
    if os.name == "nt":
        cands += [r"C:\Program Files\nodejs\node.exe"]
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return ""


class BCityIssue(bpy.types.PropertyGroup):
    level: StringProperty()
    text: StringProperty()


class BCitySettings(bpy.types.PropertyGroup):
    lm_id: StringProperty(name="ID", description="小写字母、数字、- 和 _；决定文件名，比如 drumtower")
    name_zh: StringProperty(name="中文名", description="地图和 GPS 搜索里显示的名字")
    name_en: StringProperty(name="英文名")
    coord_mode: EnumProperty(name="位置", items=[("LATLON", "经纬度", "WGS84，从地图上取点"), ("GAME", "游戏坐标", "游戏里的 x、z 米（+X 东，+Z 南）")], default="LATLON")
    # strings, not floats: a Blender float is 32-bit, which rounds a latitude to about half a metre
    lat: StringProperty(name="纬度", description="比如 39.9405")
    lon: StringProperty(name="经度", description="比如 116.3902")
    game_x: FloatProperty(name="x", precision=1)
    game_z: FloatProperty(name="z", precision=1)
    heading: FloatProperty(name="朝向", description="模型 Blender +Y 轴指向的方位，从正北顺时针的度数", default=0.0, precision=1)
    far_distance: IntProperty(name="远景距离", description="多远换成远景 (m)，0 = 默认 800", default=0, min=0, max=5000)
    max_texture: EnumProperty(name="贴图上限", items=[(v, v, "") for v in ("512", "1024", "2048", "4096")], default="2048")
    repo_path: StringProperty(name="drive-city 目录", subtype="DIR_PATH", description="游戏项目目录（含 scripts/landmarks/import.mjs）；留空自动查找")
    node_path: StringProperty(name="Node", subtype="FILE_PATH", description="node 可执行文件；留空自动查找（需要 22.18+）")
    open_preview: BoolProperty(name="导出后打开预览", default=False, description="开发服务器 (npx vite --port 5195) 要在运行")


# --- material properties (plain custom properties on the material: the glTF export writes them as extras) --

WET = [("surface", "光滑表面", "玻璃、琉璃、油漆：雨天一层水膜（默认）"), ("ground", "地面", "平顶和地面会积水"), ("damp", "粗糙", "石材、砖、布：雨天颜色变深"), ("none", "不受雨影响", "")]
GLOW = [("flood", "泛光", "夜里被泛光灯照亮，和其他地标一样（默认）"), ("lamp", "自发光", "灯笼、灯箱：夜里自己亮"), ("none", "无", "夜里不额外照亮")]
FLOOD_LINEAR = (1.0, 0.62, 0.30)
LAMP_LINEAR = (1.0, 0.90, 0.72)


def _str_enum(key, items, default):
    ids = [i[0] for i in items]

    def get(self):
        v = self.get(key)
        return ids.index(v) if v in ids else ids.index(default)

    def set(self, i):
        if ids[i] == default:
            if key in self:
                del self[key]
        else:
            self[key] = ids[i]

    return get, set


_wet_get, _wet_set = _str_enum("wet", WET, "surface")
_glow_get, _glow_set = _str_enum("glow", GLOW, "flood")


def _emit_get(self):
    return self.get("emit") == "night"


def _emit_set(self, v):
    if v:
        self["emit"] = "night"
    elif "emit" in self:
        del self["emit"]


def _gs_get(self):
    v = self.get("glowStrength")
    return float(v) if isinstance(v, (int, float)) else 1.0


def _gs_set(self, v):
    if abs(v - 1.0) < 1e-6:
        if "glowStrength" in self:
            del self["glowStrength"]
    else:
        self["glowStrength"] = float(v)


def _gc_get(self):
    v = self.get("glowColor")
    if v is not None and len(v) >= 3:
        return tuple(float(x) for x in v[:3])
    return LAMP_LINEAR if self.get("glow") == "lamp" else FLOOD_LINEAR


def _gc_set(self, v):
    self["glowColor"] = [float(x) for x in v[:3]]


# --- operators ---------------------------------------------------------------------------------------

class BCITY_OT_mark(bpy.types.Operator):
    bl_idname = "bcity.mark"
    bl_label = "标记"
    bl_description = "给选中物体加上前缀"
    bl_options = {"REGISTER", "UNDO"}
    role: EnumProperty(items=ROLES)

    @classmethod
    def description(cls, context, props):
        return dict((r[0], r[2]) for r in ROLES)[props.role]

    def execute(self, context):
        objs = context.selected_objects
        if not objs:
            self.report({"WARNING"}, "没有选中物体")
            return {"CANCELLED"}
        for o in objs:
            rename(o, self.role)
        self.report({"INFO"}, f"{len(objs)} 个物体 → {ROLE_LABEL[self.role]}")
        return {"FINISHED"}


def _selected_meshes(context):
    return [o for o in context.selected_objects if o.type == "MESH" and role_of(o) not in MARKERS]


CUBE_FACES = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


class BCITY_OT_box_collider(bpy.types.Operator):
    bl_idname = "bcity.box_collider"
    bl_label = "包围盒碰撞体"
    bl_description = "给每个选中物体生成一个贴合它局部包围盒的 COL_ 盒子（物体只绕 Z 轴旋转时，游戏里就是盒子碰撞，最省）"
    bl_options = {"REGISTER", "UNDO"}
    walk_only: BoolProperty(name="只挡人 (WALK_)", default=False)

    def execute(self, context):
        src = _selected_meshes(context)
        if not src:
            self.report({"WARNING"}, "先选中要生成碰撞体的模型")
            return {"CANCELLED"}
        role = "WALK" if self.walk_only else "COL"
        for o in src:
            mn, mx = local_bounds(o)
            verts = [Vector((mx.x if i else mn.x, mx.y if j else mn.y, mx.z if k else mn.z)) for i, j, k in product((0, 1), repeat=3)]
            new_object(context, f"{role}_{base_name(o.name)}", verts, CUBE_FACES, o.matrix_world.copy(), role)
        self.report({"INFO"}, f"生成 {len(src)} 个碰撞盒")
        return {"FINISHED"}


class BCITY_OT_hull_collider(bpy.types.Operator):
    bl_idname = "bcity.hull_collider"
    bl_label = "凸包碰撞体"
    bl_description = "给每个选中物体生成它的凸包 COL_（形状不规则但整体凸的东西：塔、亭子顶）"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        src = _selected_meshes(context)
        if not src:
            self.report({"WARNING"}, "先选中要生成碰撞体的模型")
            return {"CANCELLED"}
        dg = context.evaluated_depsgraph_get()
        for o in src:
            oe = o.evaluated_get(dg)
            me = oe.to_mesh()
            coords = [v.co.copy() for v in me.vertices]
            oe.to_mesh_clear()
            if len(coords) < 4:
                continue
            bm = bmesh.new()
            for c in coords:
                bm.verts.new(c)
            ret = bmesh.ops.convex_hull(bm, input=bm.verts[:])
            drop = [e for e in ret["geom_interior"] + ret["geom_unused"] if isinstance(e, bmesh.types.BMVert)]
            if drop:
                bmesh.ops.delete(bm, geom=drop, context="VERTS")
            name = f"COL_{base_name(o.name)}"
            hull = bpy.data.meshes.new(name)
            bm.to_mesh(hull)
            bm.free()
            ob = bpy.data.objects.new(name, hull)
            ob.matrix_world = o.matrix_world.copy()
            helper_collection(context).objects.link(ob)
            style(ob, "COL")
        self.report({"INFO"}, f"生成 {len(src)} 个凸包")
        return {"FINISHED"}


class BCITY_OT_ramp(bpy.types.Operator):
    bl_idname = "bcity.ramp"
    bl_label = "楼梯坡道"
    bl_description = "按选中楼梯的包围盒生成一个楔形坡道碰撞体。台阶做成一格格盒子人是走不上去的（能站不能走），必须垫一个坡"
    bl_options = {"REGISTER", "UNDO"}
    rise: EnumProperty(name="向哪边升高", items=[("+Y", "+Y", ""), ("-Y", "-Y", ""), ("+X", "+X", ""), ("-X", "-X", "")], default="+Y", description="楼梯在物体局部坐标里往哪个方向变高")
    walk_only: BoolProperty(name="只挡人 (WALK_)", default=True, description="关掉的话车也能开上去")

    def execute(self, context):
        src = _selected_meshes(context)
        if not src:
            self.report({"WARNING"}, "先选中楼梯")
            return {"CANCELLED"}
        role = "WALK" if self.walk_only else "COL"
        axis = 1 if self.rise[1] == "Y" else 0
        up = self.rise[0] == "+"
        steep = 0.0
        for o in src:
            mn, mx = local_bounds(o)
            lo_v, hi_v = (mn[axis], mx[axis]) if up else (mx[axis], mn[axis])
            other = 1 - axis

            def P(u, v, z):
                p = [0.0, 0.0, z]
                p[other], p[axis] = u, v
                return Vector(p)

            u0, u1 = mn[other], mx[other]
            verts = [P(u0, lo_v, mn.z), P(u1, lo_v, mn.z), P(u0, hi_v, mn.z), P(u1, hi_v, mn.z), P(u0, hi_v, mx.z), P(u1, hi_v, mx.z)]
            faces = [(0, 2, 3, 1), (0, 1, 5, 4), (2, 4, 5, 3), (0, 4, 2), (1, 3, 5)]
            ob = new_object(context, f"{role}_{base_name(o.name)}_ramp", verts, faces, o.matrix_world.copy(), role)
            # the slope in the world, for the warning
            w = [ob.matrix_world @ v for v in (verts[0], verts[2], verts[4])]
            run, rise = (w[1] - w[0]).length, (w[2] - w[1]).length
            if run > 1e-6:
                steep = max(steep, math.degrees(math.atan2(rise, run)))
        if steep > 50:
            self.report({"WARNING"}, f"坡度 {steep:.0f}°，超过人物能走的 50°：换个升高方向，或把楼梯拉长")
        else:
            self.report({"INFO"}, f"生成坡道，最陡 {steep:.0f}°")
        return {"FINISHED"}


class BCITY_OT_footprint(bpy.types.Operator):
    bl_idname = "bcity.footprint"
    bl_label = "生成占地"
    bl_description = "用所有可见模型的俯视凸包生成 FOOTPRINT（可以再手动编辑）。中心落在里面的 OSM 楼会被删掉"
    bl_options = {"REGISTER", "UNDO"}
    margin: FloatProperty(name="外扩 (m)", default=0.5, min=0.0, max=20.0)

    def execute(self, context):
        dg = context.evaluated_depsgraph_get()
        pts = []
        for o in exported_objects(context):
            if role_of(o) in ("DETAIL", "LOD0", "LOD1"):
                pts += [(p.x, p.y) for p in world_points(o, dg)[0]]
        if len(pts) < 3:
            self.report({"WARNING"}, "场景里没有可见模型")
            return {"CANCELLED"}
        h = hull2(pts)
        cx, cy = sum(p[0] for p in h) / len(h), sum(p[1] for p in h) / len(h)
        grown = []
        for x, y in h:
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 or 1.0
            grown.append((x + (x - cx) / d * self.margin, y + (y - cy) / d * self.margin, 0.0))
        for o in [o for o in context.scene.objects if role_of(o) == "FOOTPRINT"]:
            bpy.data.objects.remove(o, do_unlink=True)
        new_object(context, "FOOTPRINT", grown, [tuple(range(len(grown)))], Matrix.Identity(4), "FOOTPRINT")
        self.report({"INFO"}, f"占地 {len(grown)} 个点")
        return {"FINISHED"}


class BCITY_OT_clear_zone(bpy.types.Operator):
    bl_idname = "bcity.clear_zone"
    bl_label = "加清空区"
    bl_description = "在 3D 游标处加一块 CLEAR_ 区域（6×15 m，可缩放），比如车道穿过人行道的地方"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        c = context.scene.cursor.location
        verts = [(-3, -7.5, 0), (3, -7.5, 0), (3, 7.5, 0), (-3, 7.5, 0)]
        new_object(context, "CLEAR_zone", verts, [(0, 1, 2, 3)], Matrix.Translation((c.x, c.y, 0.0)), "CLEAR")
        return {"FINISHED"}


class BCITY_OT_toggle_helpers(bpy.types.Operator):
    bl_idname = "bcity.toggle_helpers"
    bl_label = "显示/隐藏碰撞体"
    bl_description = "在视图里隐藏或显示所有碰撞体、占地和清空区（隐藏的照样会导出）"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        helpers = [o for o in context.view_layer.objects if role_of(o) in MARKERS]
        hide = any(not o.hide_get() for o in helpers)
        for o in helpers:
            o.hide_set(hide)
        return {"FINISHED"}


class BCITY_OT_reset_glow_color(bpy.types.Operator):
    bl_idname = "bcity.reset_glow_color"
    bl_label = "默认颜色"
    bl_description = "恢复默认的夜间光色"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        mat = context.object.active_material if context.object else None
        if mat and "glowColor" in mat:
            del mat["glowColor"]
        return {"FINISHED"}


def check_scene(context):
    """[(level, text)]: level ERROR stops the export, WARN and INFO are advice."""
    s = context.scene.bcity
    out = []
    E = lambda t: out.append(("ERROR", t))
    W = lambda t: out.append(("WARN", t))
    I = lambda t: out.append(("INFO", t))
    if not re.match(r"^[a-z][a-z0-9_-]*$", s.lm_id or ""):
        E("ID 要填：小写字母开头，只用小写字母、数字、- 和 _")
    if s.coord_mode == "LATLON":
        try:
            lat, lon = float(s.lat), float(s.lon)
            if not (39.7 < lat < 40.1 and 116.2 < lon < 116.6):
                W(f"{lat}, {lon} 不在北京城区，确定吗？")
        except ValueError:
            E("经纬度要填数字（或切到游戏坐标）")
    repo = resolve_repo(s)
    if not repo:
        E("找不到 drive-city 目录：在「设置」里指定（含 scripts/landmarks/import.mjs 的那个）")
    node = resolve_node(s)
    if not node:
        E("找不到 node：在「设置」里指定 node 的路径")
    else:
        try:
            v = subprocess.run([node, "-v"], capture_output=True, text=True, timeout=10).stdout.strip().lstrip("v")
            major, minor = (int(x) for x in v.split(".")[:2])
            if (major, minor) < (22, 18) or (major == 23 and minor < 6):
                E(f"node {v} 太旧，导入脚本直接运行 .ts，需要 22.18 以上")
        except Exception as e:
            E(f"node 运行不了：{e}")
    us = context.scene.unit_settings
    if abs(us.scale_length - 1.0) > 1e-6:
        W(f"场景单位缩放是 {us.scale_length}，导出不会换算：请按 1 单位 = 1 米建模")
    dg = context.evaluated_depsgraph_get()
    tris = {"DETAIL": 0, "LOD1": 0}
    counts = {}
    zmin, zmax = float("inf"), float("-inf")
    xs, ys = [], []
    shared = {}
    for o in exported_objects(context):
        role = role_of(o)
        counts[role] = counts.get(role, 0) + 1
        if role in MARKERS:
            continue
        pts, n = world_points(o, dg)
        tris["LOD1" if role == "LOD1" else "DETAIL"] += n
        shared[o.data.name] = shared.get(o.data.name, 0) + 1
        if role != "LOD1":
            for p in pts:
                zmin, zmax = min(zmin, p.z), max(zmax, p.z)
                xs.append(p.x)
                ys.append(p.y)
    if not xs:
        E("没有可见的近景模型")
        return out
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span > 2000 or zmax > 800:
        W(f"模型很大（{span:.0f} m 宽，{zmax:.0f} m 高）：单位是米吗？")
    if span < 1:
        W(f"模型很小（{span:.2f} m）：单位是米吗？")
    if abs(zmin) > 0.5:
        W(f"最低点在 z = {zmin:.2f} m：原点应在地面上（把模型移到最低点 ≈ 0）")
    ncol = sum(counts.get(r, 0) for r in COLLIDERS)
    if not ncol:
        W("没有碰撞体：车和人会直接穿过去（选中模型 → 包围盒/凸包碰撞体）")
    if not counts.get("LOD1"):
        I("没有远景 (LOD1_)：远处直接画近景模型")
    elif tris["LOD1"] > tris["DETAIL"] / 3:
        W(f"远景 {tris['LOD1']} 个三角形，超过近景的 1/3，起不到减负作用")
    if tris["DETAIL"] > 300000:
        W(f"近景 {tris['DETAIL']} 个三角形，偏多（现有地标 5-85k）")
    if not counts.get("FOOTPRINT"):
        I("没有 FOOTPRINT：用可见模型的凸包当占地")
    inst = [k for k, v in shared.items() if v >= 6]
    if inst:
        I(f"{len(inst)} 个网格被关联复制 6 次以上，游戏里会画成实例（很省）")
    maxtex = int(s.max_texture)
    big = [im.name for im in bpy.data.images if im.users and im.size[0] and max(im.size[:]) > maxtex]
    if big:
        I(f"{len(big)} 张贴图超过 {maxtex}px，导入时会缩小")
    for m in bpy.data.materials:
        if not m.users or not getattr(m, "use_nodes", True) or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                t = n.inputs.get("Transmission Weight") or n.inputs.get("Transmission")
                if t is not None and not t.is_linked and t.default_value > 0:
                    W(f"材质「{m.name}」用了透射 (Transmission)，在游戏里很贵；玻璃改用 Alpha 透明")
    I(f"近景 {tris['DETAIL']} 三角形，碰撞体 {ncol} 个，高 {zmax:.1f} m")
    return out


def _store_issues(context, issues):
    coll = context.scene.bcity_issues
    coll.clear()
    for level, text in issues:
        it = coll.add()
        it.level, it.text = level, text


class BCITY_OT_check(bpy.types.Operator):
    bl_idname = "bcity.check"
    bl_label = "检查"
    bl_description = "检查设置和模型（单位、原点、碰撞体、面数、贴图、材质）"

    def execute(self, context):
        issues = check_scene(context)
        _store_issues(context, issues)
        errs = sum(1 for l, _ in issues if l == "ERROR")
        warns = sum(1 for l, _ in issues if l == "WARN")
        # not ERROR: a check that found problems still ran (ERROR would raise when called from a script)
        self.report({"WARNING" if errs or warns else "INFO"}, f"{errs} 个错误，{warns} 个警告（见面板）")
        return {"FINISHED"}


def export_kwargs(filepath):
    want = dict(
        filepath=filepath, export_format="GLB", export_extras=True, export_apply=True, export_yup=True,
        export_hierarchy_full_collections=True, export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False, export_materials="EXPORT", export_image_format="AUTO",
        use_selection=False, use_visible=False, use_active_scene=True, check_existing=False,
    )
    have = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    return {k: v for k, v in want.items() if k in have}, "export_hierarchy_full_collections" in have


class BCITY_OT_export(bpy.types.Operator):
    bl_idname = "bcity.export"
    bl_label = "导出到游戏"
    bl_description = "导出 glb 并运行游戏的导入脚本：写入 public/models/landmarks/ 和 src/city/landmarks/glb/，游戏里就有了"
    dry: BoolProperty(name="只检查", default=False, description="导出后只让导入脚本检查，不写入游戏")

    def execute(self, context):
        s = context.scene.bcity
        issues = check_scene(context)
        _store_issues(context, issues)
        errors = [t for l, t in issues if l == "ERROR"]
        if errors:
            self.report({"ERROR"}, errors[0])
            return {"CANCELLED"}
        repo, node = resolve_repo(s), resolve_node(s)
        save_config(repo_path=repo, node_path=node)
        out_dir = os.path.join(repo, ".scratch", "blender")
        os.makedirs(out_dir, exist_ok=True)
        glb = os.path.join(out_dir, f"{s.lm_id}.glb")
        kwargs, collections_ok = export_kwargs(glb)
        res = bpy.ops.export_scene.gltf(**kwargs)
        if "FINISHED" not in res or not os.path.isfile(glb):
            self.report({"ERROR"}, "glTF 导出失败，见系统控制台")
            return {"CANCELLED"}
        cmd = [node, os.path.join("scripts", "landmarks", "import.mjs"), glb, "--id", s.lm_id, "--tex", s.max_texture, "--heading", f"{s.heading:g}"]
        if s.name_zh:
            cmd += ["--zh", s.name_zh]
        if s.name_en:
            cmd += ["--en", s.name_en]
        if s.coord_mode == "LATLON":
            cmd += ["--lat", s.lat.strip(), "--lon", s.lon.strip()]
        else:
            cmd += ["--at", f"{s.game_x:.2f},{s.game_z:.2f}"]
        if s.far_distance:
            cmd += ["--far", str(s.far_distance)]
        if self.dry:
            cmd.append("--dry")
        try:
            run = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=600)
        except Exception as e:
            self.report({"ERROR"}, f"导入脚本运行失败：{e}")
            return {"CANCELLED"}
        log = (run.stdout or "") + (("\n" + run.stderr) if run.stderr else "")
        text = bpy.data.texts.get("B城导入日志") or bpy.data.texts.new("B城导入日志")
        text.clear()
        text.write("$ " + " ".join(cmd) + "\n" + log)
        # the script's own warnings (⚠ lines) join the panel's list
        extra = [("WARN", line.strip().lstrip("⚠").strip()) for line in log.splitlines() if "⚠" in line]
        if extra:
            _store_issues(context, [(i.level, i.text) for i in context.scene.bcity_issues] + extra)
        if not collections_ok:
            self.report({"WARNING"}, "这个版本的导出器不支持把集合写成节点：用集合名做标记不会生效，请给物体本身加前缀")
        if run.returncode != 0:
            self.report({"ERROR"}, "导入失败，详情见文本编辑器里的「B城导入日志」")
            return {"CANCELLED"}
        if self.dry:
            self.report({"INFO"}, "检查完成，详情见「B城导入日志」")
        else:
            self.report({"INFO"}, f"已导入 {s.lm_id}：重启或刷新游戏页面就能看到")
            if s.open_preview:
                webbrowser.open(f"http://127.0.0.1:5195/landmarks.html?id={s.lm_id}")
        return {"FINISHED"}


class BCITY_OT_preview(bpy.types.Operator):
    bl_idname = "bcity.preview"
    bl_label = "打开预览"
    bl_description = "在浏览器打开游戏的地标预览页（开发服务器 npx vite --port 5195 要在运行）"

    def execute(self, context):
        webbrowser.open(f"http://127.0.0.1:5195/landmarks.html?id={context.scene.bcity.lm_id}")
        return {"FINISHED"}


# --- panels ------------------------------------------------------------------------------------------

class _Panel:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "B城"


class BCITY_PT_landmark(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_landmark"
    bl_label = "地标"

    def draw(self, context):
        s = context.scene.bcity
        col = self.layout.column(align=True)
        col.prop(s, "lm_id")
        col.prop(s, "name_zh")
        col.prop(s, "name_en")
        self.layout.prop(s, "coord_mode", expand=True)
        col = self.layout.column(align=True)
        if s.coord_mode == "LATLON":
            col.prop(s, "lat")
            col.prop(s, "lon")
        else:
            row = col.row(align=True)
            row.prop(s, "game_x")
            row.prop(s, "game_z")
        col.prop(s, "heading")
        self.layout.label(text="Blender +X = 东，+Y = 北，1 单位 = 1 米，原点在地面", icon="INFO")


class BCITY_PT_settings(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_settings"
    bl_label = "设置"
    bl_parent_id = "BCITY_PT_landmark"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        s = context.scene.bcity
        col = self.layout.column()
        col.prop(s, "far_distance")
        col.prop(s, "max_texture")
        col.prop(s, "repo_path")
        repo = resolve_repo(s)
        col.label(text=repo or "（没找到）", icon="CHECKMARK" if repo else "ERROR")
        col.prop(s, "node_path")
        node = resolve_node(s)
        col.label(text=node or "（没找到）", icon="CHECKMARK" if node else "ERROR")


class BCITY_PT_mark(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_mark"
    bl_label = "标记选中物体"

    def draw(self, context):
        o = context.object
        if o is not None:
            self.layout.label(text=f"{o.name}：{ROLE_LABEL[role_of(o)]}", icon="OBJECT_DATA")
        grid = self.layout.grid_flow(columns=2, align=True)
        for rid, label, _ in ROLES:
            grid.operator("bcity.mark", text=label).role = rid
        self.layout.label(text="集合名 COL / LOD1 等也算标记", icon="OUTLINER_COLLECTION")


class BCITY_PT_build(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_build"
    bl_label = "生成辅助物体"

    def draw(self, context):
        col = self.layout.column(align=True)
        col.operator("bcity.box_collider", icon="MESH_CUBE")
        col.operator("bcity.hull_collider", icon="MESH_ICOSPHERE")
        col.operator("bcity.ramp", icon="IPO_LINEAR")
        col = self.layout.column(align=True)
        col.operator("bcity.footprint", icon="MOD_OUTLINE")
        col.operator("bcity.clear_zone", icon="MESH_PLANE")
        self.layout.operator("bcity.toggle_helpers", icon="HIDE_OFF")


class BCITY_PT_material(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_material"
    bl_label = "材质（夜晚与雨天）"

    @classmethod
    def poll(cls, context):
        return context.object is not None and context.object.active_material is not None

    def draw(self, context):
        mat = context.object.active_material
        self.layout.label(text=mat.name, icon="MATERIAL")
        col = self.layout.column()
        col.prop(mat, "bcity_wet")
        col.prop(mat, "bcity_glow")
        if mat.bcity_glow != "none":
            row = col.row(align=True)
            row.prop(mat, "bcity_glow_color")
            row.operator("bcity.reset_glow_color", text="", icon="LOOP_BACK")
            col.prop(mat, "bcity_glow_strength")
        col.prop(mat, "bcity_emit_night")


class BCITY_PT_export(_Panel, bpy.types.Panel):
    bl_idname = "BCITY_PT_export"
    bl_label = "检查与导出"

    def draw(self, context):
        s = context.scene.bcity
        row = self.layout.row(align=True)
        row.operator("bcity.check", icon="VIEWZOOM")
        row.operator("bcity.export", text="只检查", icon="FILE_TICK").dry = True
        big = self.layout.row()
        big.scale_y = 1.5
        big.operator("bcity.export", icon="EXPORT").dry = False
        row = self.layout.row(align=True)
        row.operator("bcity.preview", icon="URL")
        row.prop(s, "open_preview", text="导出后打开")
        icons = {"ERROR": "ERROR", "WARN": "INFO", "INFO": "DOT"}
        box = None
        for it in context.scene.bcity_issues:
            box = box or self.layout.box()
            box.label(text=it.text, icon=icons.get(it.level, "DOT"))


CLASSES = (
    BCityIssue, BCitySettings,
    BCITY_OT_mark, BCITY_OT_box_collider, BCITY_OT_hull_collider, BCITY_OT_ramp, BCITY_OT_footprint, BCITY_OT_clear_zone,
    BCITY_OT_toggle_helpers, BCITY_OT_reset_glow_color, BCITY_OT_check, BCITY_OT_export, BCITY_OT_preview,
    BCITY_PT_landmark, BCITY_PT_settings, BCITY_PT_mark, BCITY_PT_build, BCITY_PT_material, BCITY_PT_export,
)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.bcity = PointerProperty(type=BCitySettings)
    bpy.types.Scene.bcity_issues = CollectionProperty(type=BCityIssue)
    bpy.types.Material.bcity_wet = EnumProperty(name="雨天", items=WET, get=_wet_get, set=_wet_set)
    bpy.types.Material.bcity_glow = EnumProperty(name="夜间", items=GLOW, get=_glow_get, set=_glow_set)
    bpy.types.Material.bcity_glow_color = FloatVectorProperty(name="光色", subtype="COLOR", size=3, min=0.0, max=1.0, get=_gc_get, set=_gc_set)
    bpy.types.Material.bcity_glow_strength = FloatProperty(name="夜间强度", description="泛光或自发光的强弱（1 = 默认）；浅色大墙面嫌亮就调低", min=0.0, soft_max=3.0, get=_gs_get, set=_gs_set)
    bpy.types.Material.bcity_emit_night = BoolProperty(name="自发光只在夜里亮", description="材质的 Emission 白天不显示（亮着的窗户）", get=_emit_get, set=_emit_set)


def unregister():
    for attr in ("bcity_wet", "bcity_glow", "bcity_glow_color", "bcity_glow_strength", "bcity_emit_night"):
        if hasattr(bpy.types.Material, attr):
            delattr(bpy.types.Material, attr)
    del bpy.types.Scene.bcity_issues
    del bpy.types.Scene.bcity
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
