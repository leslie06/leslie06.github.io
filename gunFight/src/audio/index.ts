import type { Engine } from '../core/Engine';
import { AudioEngine } from './AudioEngine';

export { AudioEngine } from './AudioEngine';
export { SOUNDS, SOUND_IDS } from './SoundDefs';

/**
 * Entry point for the audio module. Everything is synthesized with Web Audio at runtime (no files).
 * The AudioContext starts suspended; ui/ calls engine.get<AudioApi>('audio').unlock() inside the
 * pointer-lock click, and AudioEngine also self-registers a one-time gesture listener as a fallback.
 */
export async function install(engine: Engine): Promise<void> {
  engine.add(new AudioEngine(engine));
}
