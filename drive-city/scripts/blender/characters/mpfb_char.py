"""
Realistic characters from MakeHuman's MPFB (2026-10-12, 「人物过于抽象」, docs/characters.md): each character is a
spec in scripts/characters/cast.json - phenotype (gender, age, weight, muscle, height, proportions, race), face and
body targets, skin, hair, eyebrows, eyelashes, eyes, clothes - built by MPFB with the UE-named `game_engine` rig the
player's animation (character/hero/Hero.ts) already maps, and exported as a glb (skinned, no morph targets, the
body under the clothes deleted by the clothes' own delete groups).

MPFB 2.0.18 (GPL add-on; the base mesh, targets and the CC0 makehuman_system_assets pack: everything it outputs is
CC0) lives in a Blender config of its own, so the user's Blender is untouched:
  BLENDER_USER_RESOURCES=.cache/mpfb/user /Applications/Blender.app/Contents/MacOS/Blender -b \
    -P scripts/blender/characters/mpfb_char.py -- --cast scripts/characters/cast.json --id chenye --out .scratch/chars/chenye.glb
(see docs/characters.md for installing MPFB and the asset pack there).
"""
import bpy, sys, json, os, argparse, addon_utils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--cast", required=True)
ap.add_argument("--id", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--blend", default="")
a = ap.parse_args(argv)

MOD = "bl_ext.user_default.mpfb"
if not addon_utils.check(MOD)[1]:
    addon_utils.enable(MOD, default_set=True)
import importlib
HumanService = importlib.import_module(MOD + ".services.humanservice").HumanService
TargetService = importlib.import_module(MOD + ".services.targetservice").TargetService

spec = next(c for c in json.load(open(a.cast))["cast"] if c["id"] == a.id)

# empty scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

info = HumanService._create_default_human_info_dict() if hasattr(HumanService, "_create_default_human_info_dict") else {}
info.update({
    "name": spec["id"],
    "phenotype": spec["phenotype"],
    "rig": "game_engine",
    "eyes": spec.get("eyes", "low-poly/low-poly.mhclo"),   # one layer: the high-poly eye's cornea shell drew the eye black once opaque
    "eyebrows": spec.get("eyebrows", "eyebrow006/eyebrow006.mhclo"),
    "eyelashes": spec.get("eyelashes", "eyelashes02/eyelashes02.mhclo"),
    "teeth": spec.get("teeth", ""),   # a closed mouth: no teeth (7k triangles)
    "tongue": "",
    "hair": spec.get("hair", ""),
    "proxy": spec.get("proxy", ""),
    "clothes": spec.get("clothes", []),
    # "lr-x" is both "l-x" and "r-x"
    "targets": [{"target": n, "value": v} for t, v in spec.get("targets", {}).items() for n in ([t[1:].replace("r-", "l-", 1), "r-" + t[3:]] if t.startswith("lr-") else [t])],
    "skin_mhmat": spec["skin"],
    # plain principled materials with image textures: what the glTF exporter understands
    "skin_material_type": "GAMEENGINE",
    "eyes_material_type": "MAKESKIN",
    "clothes_material_type": "GAMEENGINE",
})
settings = HumanService.get_default_deserialization_settings()
settings.update({"subdiv_levels": 0, "material_instances": "NEVER", "override_skin_model": "PRESET"})
basemesh = HumanService.deserialize_from_dict(info, settings)

# shape keys (the phenotype and targets) folded into the mesh: the game needs no morphs
print("[mpfb_char] objects:", [(o.name, o.type) for o in bpy.data.objects])
for o in bpy.data.objects:
    if o.type == "MESH" and o.data.shape_keys:
        bpy.context.view_layer.objects.active = o
        o.shape_key_add(name="__mix", from_mix=True)
        keys = o.data.shape_keys.key_blocks
        for k in list(keys):
            if k.name != "__mix":
                o.shape_key_remove(k)
        o.shape_key_remove(o.data.shape_keys.key_blocks["__mix"])

# hair colour override (a grey for 老K): tint the hair material's base colour
tint = spec.get("hairTint")
if tint:
    for o in bpy.data.objects:
        if o.type == "MESH" and (os.path.basename(spec.get("hair", "")).split(".")[0].lower() in o.name.lower() or "hair" in o.name.lower()):
            for slot in o.material_slots:
                m = slot.material
                if m and m.use_nodes:
                    for n in m.node_tree.nodes:
                        if n.type == "BSDF_PRINCIPLED":
                            n.inputs["Base Color"].default_value = (*tint, 1.0) if not n.inputs["Base Color"].is_linked else n.inputs["Base Color"].default_value
                            if n.inputs["Base Color"].is_linked:
                                mix = m.node_tree.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1.0
                                src = n.inputs["Base Color"].links[0].from_socket
                                m.node_tree.links.new(src, mix.inputs[6]); mix.inputs[7].default_value = (*tint, 1.0)
                                m.node_tree.links.new(mix.outputs[2], n.inputs["Base Color"])

if a.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.blend))

os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.out), export_format="GLB", use_selection=False,
                          export_apply=True, export_morph=False, export_skins=True, export_animations=False,
                          export_yup=True, export_image_format="AUTO")
tris = 0
for o in bpy.data.objects:
    if o.type == "MESH":
        me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
print(f"[mpfb_char] {a.id}: {tris} triangles, {sum(1 for o in bpy.data.objects if o.type == 'MESH')} meshes -> {a.out}")
