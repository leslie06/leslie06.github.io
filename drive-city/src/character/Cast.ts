import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { RenderSystem } from '../render/RenderSystem';
import type { Look } from './Body';
import { loadClip, retarget, type ClipOpts, type Retargeted } from './Clips';
import { Hero, type ClipActions } from './hero/Hero';

/**
 * The realistic cast (2026-10-12, 「人物过于抽象」, docs/characters.md): characters built by MPFB from
 * scripts/characters/cast.json (scripts/blender/characters/mpfb_char.py, packed by scripts/characters/pack.mjs into
 * public/models/characters/). Which person has which model, and which animation clips they play for which action,
 * is data: public/models/characters/cast.json, fetched once. On with `?cast=1` while they are being tried (the
 * player as Chen Ye, the contacts that have a model).
 */
export const CAST_ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cast') === '1';

type ClipSpec = string | (ClipOpts & { file: string });
interface Entry { file: string; hairColor?: string; clips?: Record<string, ClipSpec>; actions?: ClipActions }
interface Manifest { clips?: Record<string, ClipSpec>; actions?: ClipActions; characters: Record<string, Entry> }
const BASE = typeof location !== 'undefined' ? `${import.meta.env.BASE_URL}models/characters/` : '';
let manifest: Promise<Manifest> | null = null;
const load = (): Promise<Manifest> => (manifest ??= fetch(`${BASE}cast.json`).then((r) => r.json() as Promise<Manifest>)
  .catch((e) => { manifest = null; throw e; }));

/** Whether `id` has a model (false until the manifest is in, or if it is not listed). */
export async function hasModel(id: string): Promise<boolean> { try { return id in (await load()).characters; } catch { return false; } }

/** Clips baked per model file and clip (every instance of a model shares them). */
const baked = new Map<string, Promise<Retargeted>>();

/** A new instance of `id`'s model, animated by its clips, added to the scene (each person needs their own skeleton). */
export async function castModel(engine: Engine, id: string, look: Look): Promise<Hero> {
  const m = await load(), e = m.characters[id];
  if (!e) throw new Error(`cast: no model for ${id}`);
  const h = await Hero.loadAuthored(`${BASE}${e.file}`, look, { hairColor: e.hairColor ? new THREE.Color(e.hairColor) : undefined });
  const clips = { ...m.clips, ...e.clips };
  const got: Record<string, Retargeted> = {};
  await Promise.all(Object.entries(clips).map(async ([name, spec]) => {
    const { file, ...opts } = typeof spec === 'string' ? { file: spec } : spec;
    const key = `${e.file}|${name}|${JSON.stringify(spec)}`;
    let p = baked.get(key);
    if (!p) {
      p = loadClip(`${BASE}${file}`).then((src) => retarget(src, h.rig(), name, opts));
      p.catch(() => baked.delete(key));
      baked.set(key, p);
    }
    try { got[name] = await p; } catch (err) { console.warn(`[cast] clip ${name} (${file})`, err); }
  }));
  // an action whose clip is missing falls back to the gait
  if (Object.keys(got).length) h.useClips(got, { ...m.actions, ...e.actions });
  engine.get<RenderSystem>('render')?.prepare(h.root);
  engine.scene.add(h.root);
  return h;
}
