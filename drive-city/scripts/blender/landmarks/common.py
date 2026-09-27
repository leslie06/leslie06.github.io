# Shared helpers for the landmark build scripts in this folder (great_hall.py, flower_basket.py).
# Each script runs in Blender (`blender -b -P <script> -- ...`) or with the bpy module.

import os
import sys

import bpy  # before bmesh: the bpy module only provides bmesh once bpy is loaded
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def srgb(hexs):
    h = hexs.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def linear(hexs):
    """A colour as linear RGB (what Blender's colour inputs and float colour attributes hold)."""
    return tuple(float(c) for c in srgb(hexs) ** 2.2)


def image(name, arr):
    """A packed PNG image from an (h, w, 3) sRGB array; row 0 is the bottom, as in Blender."""
    h, w, _ = arr.shape
    im = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([np.clip(arr, 0, 1), np.ones((h, w, 1))], axis=2).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel())
    im.file_format = "PNG"
    im.pack()
    return im


def material(name, color, rough=0.7, metal=0.0, tex=None, emit_tex=None, vertex_colors=False, props=None, normal_tex=None, normal_strength=1.0):
    """A Principled material the glTF export understands; `props` become custom properties (glTF extras)."""
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*linear(color), 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    elif vertex_colors:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    if emit_tex is not None:
        e = nt.nodes.new("ShaderNodeTexImage")
        e.image = emit_tex
        nt.links.new(e.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.0
    if normal_tex is not None:
        normal_tex.colorspace_settings.name = "Non-Color"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = normal_tex
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    for k, v in (props or {}).items():
        m[k] = v
    return m


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def clear_file():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.fonts):
        for x in list(coll):
            coll.remove(x)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def select(objs):
    vl = bpy.context.view_layer
    vl.update()   # objects linked since the last update are not in the view layer's list yet
    for o in vl.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = objs[0]


def ensure_addon():
    if hasattr(bpy.types.Scene, "bcity"):
        return
    sys.path.insert(0, os.path.join(REPO, "scripts", "blender"))
    import bcity_landmark
    bcity_landmark.register()


def save_and_export(out, argv):
    """Save the .blend, and with --export check and run the add-on's 导出到游戏."""
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out))
    backup = os.path.abspath(out) + "1"
    if os.path.exists(backup):
        os.remove(backup)
    print("saved", out)
    if "--export" in argv:
        bpy.ops.bcity.check()
        for it in bpy.context.scene.bcity_issues:
            print(" ", it.level, it.text)
        try:
            bpy.ops.bcity.export(dry=False)
        finally:
            log = bpy.data.texts.get("B城导入日志")
            print(log.as_string() if log else "(no import log)")
