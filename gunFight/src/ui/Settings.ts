/**
 * Player settings: persisted to localStorage, applied instantly to the engine.
 * Anything another module doesn't expose through Contracts is applied by duck typing and
 * documented here so the owning module can pick it up (see apply()).
 */
import type { Engine } from '../core/Engine';
import type { AudioApi, PlayerApi } from '../game/Contracts';
import type { QualityTier } from '../core/Quality';

export interface SettingsData {
  sensitivity: number;  // multiplier on Input.sensitivity default (0.25..3)
  invertY: boolean;
  fov: number;          // 60..110
  quality: QualityTier;
  master: number;       // 0..1
  sfx: number;          // 0..1
  music: number;        // 0..1
}

const KEY = 'gunfight.settings.v1';
const BASE_SENS = 0.0022;

export const DEFAULTS: SettingsData = { sensitivity: 1, invertY: false, fov: 80, quality: 'high', master: 1, sfx: 1, music: 0.7 };

export class Settings {
  data: SettingsData;
  private listeners = new Set<(d: SettingsData) => void>();
  private pollWrapped = false;

  constructor(private engine: Engine) {
    this.data = { ...DEFAULTS, quality: engine.quality.tier };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* private mode / disabled storage — run with defaults */ }
    this.data.quality = engine.quality.tier; // quality only changes via reload with ?quality=
  }

  get<K extends keyof SettingsData>(k: K): SettingsData[K] { return this.data[k]; }

  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]): void {
    if (this.data[k] === v) return;
    this.data[k] = v;
    this.save();
    this.apply();
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SettingsData) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  save(): void { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }

  /** Push every setting into the engine. Safe to call any time; modules may be missing early. */
  apply(): void {
    const e = this.engine;
    e.input.sensitivity = BASE_SENS * this.data.sensitivity;
    this.wrapPollForInvert();
    const audio = e.get<AudioApi & { setSfxVolume?(v: number): void; setMusicVolume?(v: number): void }>('audio');
    audio?.setMasterVolume(this.data.master);
    audio?.setSfxVolume?.(this.data.sfx);
    audio?.setMusicVolume?.(this.data.music);
    // FOV: PlayerApi has no base-FOV setter yet. Duck-type the ones the player module is likely to
    // expose; otherwise fall back to the camera (the player's own FOV damping will win if it runs).
    const player = e.get<PlayerApi & { setFov?(v: number): void; baseFov?: number }>('player');
    if (player?.setFov) player.setFov(this.data.fov);
    else if (player && 'baseFov' in player) player.baseFov = this.data.fov;
    else if (!player) { e.camera.fov = this.data.fov; e.camera.updateProjectionMatrix(); }
  }

  /** Invert-Y isn't in core/Input; flip lookDY after poll without touching core. */
  private wrapPollForInvert(): void {
    if (this.pollWrapped) return;
    this.pollWrapped = true;
    const input = this.engine.input;
    const orig = input.poll.bind(input);
    input.poll = () => { const s = orig(); if (this.data.invertY) s.lookDY = -s.lookDY; return s; };
  }

  /** Quality needs a reload (renderer/shadow maps are built at boot). */
  applyQualityAndReload(tier: QualityTier): void {
    this.data.quality = tier; this.save();
    const url = new URL(location.href);
    url.searchParams.set('quality', tier);
    location.href = url.toString();
  }
}
