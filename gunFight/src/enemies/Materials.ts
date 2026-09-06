/**
 * Shared materials per archetype. One material set = 7 draw calls per enemy (the SkinnedMesh has
 * 7 geometry groups) + 1 for the contact-shadow blob = 8. Textures are cached module-wide; the
 * cloth materials are cloned per tint index so squad members differ slightly in hue without
 * costing extra draw calls.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { ARCHETYPES, type ArchetypeDef } from './EnemyDefs';
import { blobTexture, camoTexture, clothNormal, eyeTexture, furnitureTexture, metalTextures, nylonTexture, ormTexture, skinTexture, weaveNormal } from './Textures';

/** Material slot order — must match SoldierModel group indices. */
export const SLOT = { CAMO: 0, GEAR: 1, RUBBER: 2, SKIN: 3, METAL: 4, FURNITURE: 5, EYE: 6 } as const;
export const SLOT_COUNT = 7;

/** Per-instance hue/value tints applied to the cloth (sRGB multipliers). */
const TINTS = [0xffffff, 0xf2ebdc, 0xe6ecf4, 0xf7e9d8];
export const TINT_COUNT = TINTS.length;

const cache = new Map<string, THREE.Material[]>();
let blobMat: THREE.MeshBasicMaterial | null = null;

export function materialsFor(engine: Engine, archetype: string, tint = 0): THREE.Material[] {
  const key = `${archetype}:${tint % TINT_COUNT}`;
  const hit = cache.get(key); if (hit) return hit;
  const def: ArchetypeDef = ARCHETYPES[archetype] ?? ARCHETYPES.rifleman;
  const size = engine.quality.textureRes >= 2048 ? 1024 : 512;
  const small = 512;
  const aniso = engine.assets.anisotropy;
  const cloth = clothNormal(size, aniso, 5, 26);
  const clothGear = clothNormal(small, aniso, 11, 10);
  const weaveFine = weaveNormal(small, 3, aniso, 9);
  /**
   * `value` is the axis that survives 15 m of haze — hue washes out, overall lightness does not —
   * but it has to move each soldier's MEAN value without crushing his internal range. A flat
   * multiplier on every slot does exactly the wrong thing: at the top it pushes cloth, webbing and
   * skin together into one pale mass (a wooden artist's mannequin whose segmentation shows as
   * jointed blocks), and at the bottom it collapses the torso into one flat colour with no pouch or
   * seam surviving. So the ladder is weighted per slot: cloth takes it in full, nylon gear takes
   * roughly half, rubber a fifth, and skin/metal none at all. A pale soldier therefore keeps
   * webbing and boots that sit clearly *below* his uniform, and a dark one keeps webbing that sits
   * clearly *above* it — internal contrast goes up at both ends rather than down. The camo palettes
   * already carry most of the mean spread (urban 0x5a5c5e vs desert 0xb7a27c), so `value` never has
   * to brighten past ~1.05 and nothing clips.
   */
  const val = def.value;
  const towardOne = (k: number) => 1 + (val - 1) * k;
  const tintColor = new THREE.Color(TINTS[tint % TINT_COUNT]).multiplyScalar(val);
  const gearVal = towardOne(0.45), rubberVal = towardOne(0.2);

  const camo = new THREE.MeshStandardMaterial({
    map: camoTexture(def.camo, size, aniso), normalMap: cloth, normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: ormTexture(small, 0.92, 0.09, 0, 21, aniso), roughness: 1, metalness: 0, color: tintColor, vertexColors: true,
  });
  const gear = new THREE.MeshStandardMaterial({
    map: nylonTexture(def.gearColor, small, aniso), normalMap: clothGear, normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: ormTexture(small, 0.7, 0.14, 0, 22, aniso), roughness: 1, metalness: 0,
    color: new THREE.Color(gearVal, gearVal, gearVal), vertexColors: true,
  });
  const rubber = new THREE.MeshStandardMaterial({
    map: nylonTexture(def.balaclavaColor, small, aniso), normalMap: weaveFine, normalScale: new THREE.Vector2(0.35, 0.35),
    // matte: at 0.62 the balaclava, boots and (worst of all) the short hair on bare-headed
    // archetypes picked up a lacquered highlight and read as moulded plastic
    roughnessMap: ormTexture(small, 0.86, 0.1, 0, 23, aniso), roughness: 1, metalness: 0,
    color: new THREE.Color(rubberVal, rubberVal, rubberVal), vertexColors: true,
  });
  const skin = new THREE.MeshStandardMaterial({
    map: skinTexture(def.skinColor, small, aniso), roughness: 0.58, metalness: 0, color: 0xffffff,
    // faint emissive stands in for subsurface bounce so the face doesn't vanish under the helmet brim
    emissive: new THREE.Color(def.skinColor).multiplyScalar(0.2),
    normalMap: weaveFine, normalScale: new THREE.Vector2(0.06, 0.06),
  });
  const [metalMap, metalOrm] = metalTextures(small, aniso);
  const metal = new THREE.MeshStandardMaterial({ map: metalMap, roughnessMap: metalOrm, metalnessMap: metalOrm, roughness: 1, metalness: 1, color: 0xffffff, envMapIntensity: 1.35 });
  const furniture = new THREE.MeshStandardMaterial({
    map: furnitureTexture(def.rifleFurniture, small, aniso), roughness: def.rifleFurniture === 'wood' ? 0.55 : 0.8, metalness: 0,
    normalMap: def.rifleFurniture === 'wood' ? null : weaveFine, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const eye = new THREE.MeshPhysicalMaterial({ map: eyeTexture(def.eyeColor, 128, aniso), roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.5 });
  const out = [camo, gear, rubber, skin, metal, furniture, eye];
  for (const m of out) m.side = THREE.FrontSide;
  cache.set(key, out);
  return out;
}

/** Contact-shadow blob under the body (shared). */
export function blobMaterial(): THREE.MeshBasicMaterial {
  if (blobMat) return blobMat;
  blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(128), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  blobMat.toneMapped = false;
  return blobMat;
}
