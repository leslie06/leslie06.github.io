"""
Animation clips for the realistic cast (docs/characters.md): each Mixamo FBX (downloaded "Without Skin", in place,
30 fps) in a folder becomes a glb holding only its skeleton and one animation named after the file - what
character/Clips.ts loads and retargets onto a character's own rig at runtime. Blender's FBX importer and glTF
exporter do the conversion; nothing is retargeted here.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/characters/anims.py -- \
    --src assets/anims/mixamo --out .scratch/anims/out
then `node scripts/characters/pack-anims.mjs .scratch/anims/out public/models/anims`.
"""
import bpy, sys, os, glob, argparse

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args(argv)
os.makedirs(a.out, exist_ok=True)

for f in sorted(glob.glob(os.path.join(os.path.abspath(a.src), "*.fbx"))):
    name = os.path.splitext(os.path.basename(f))[0]
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    bpy.ops.import_scene.fbx(filepath=f, automatic_bone_orientation=False)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.name = "Armature"
    act = arm.animation_data.action
    act.name = name
    fr = act.frame_range
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = int(fr[0]), int(fr[1])
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(os.path.abspath(a.out), name + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True,
                              export_frame_step=1, export_optimize_animation_size=True, export_skins=True)
    print(f"[anims] {name}: frames {fr[0]:.0f}-{fr[1]:.0f} -> {out}")
