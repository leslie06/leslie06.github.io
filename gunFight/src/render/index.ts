import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { Sky, type TimeOfDayName } from './Sky';
import { Lighting } from './Lighting';
import { PostFx } from './PostFx';
import { registerRenderPoses } from './Poses';

export { PostFx } from './PostFx';
export { Sky } from './Sky';
export { Lighting } from './Lighting';

/**
 * Rendering setup: sun + cascaded shadows + hemisphere bounce + enclosure probe (Lighting), HDRI sky/IBL/fog
 * (Sky), post chain (PostFx). Takes over `engine.renderFrame`. Called before the level is built; returns
 * once the HDRI is ready.
 *
 * Interior API for the world module: `engine.get<Lighting>('lighting').setInteriorVolumes([...Box3])`
 * (or `addInteriorVolume(box)`) marks room interiors; without volumes a physics probe at the camera is used.
 */
export async function install(engine: Engine): Promise<void> {
  const lighting = new Lighting(engine); engine.add(lighting);
  const sky = new Sky(engine); engine.add(sky);
  sky.onChange.push((s) => {
    lighting.setSun(s.sunDir, s.sunColor, s.sunIntensity);
    lighting.setAmbient(s.ambient.sky, s.ambient.ground, s.ambient.intensity, s.envIntensity, s.ambient.bounce, s.ambient.bounceStrength);
  });
  const postfx = engine.quality.postFx ? new PostFx(engine, sky) : null;
  if (postfx) engine.add(postfx);

  const r = engine.renderer;
  const fallback = () => {
    // Direct path (no composer): used on bypass and when postFx is off. Tone mapping moves back to the renderer.
    // NB: postprocessing's composer runs with autoClear=false and clears through its own passes;
    // leave the flag the way we found it or the next composer frame wipes the world under the weapon.
    const prevAutoClear = r.autoClear;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.autoClear = true;
    r.render(engine.scene, engine.camera);
    r.autoClear = false; r.clearDepth();
    r.render(engine.viewmodelScene, engine.viewmodelCamera);
    r.autoClear = prevAutoClear;
  };
  engine.renderFrame = (dt) => {
    lighting.beforeRender();
    sky.beforeRender();
    if (postfx && !postfx.bypass) { postfx.setIndoor(lighting.indoor); r.toneMapping = THREE.NoToneMapping; postfx.render(dt); }
    else fallback();
  };

  registerRenderPoses(engine, sky, postfx);
  const tod = (new URLSearchParams(location.search).get('tod') as TimeOfDayName | null) ?? 'day';
  await sky.load(tod === 'dusk' ? 'dusk' : 'day');
}
