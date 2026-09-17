import type { Engine } from '../core/Engine';
import './Loading'; // side effect: takes over the boot screen's text at module evaluation
import { Hud } from './Hud';
import { registerUiPoses } from './poses';

export async function install(engine: Engine, container: HTMLElement): Promise<void> {
  const hud = new Hud(engine, container);
  engine.add(hud);
  registerUiPoses(engine, hud);
}

/** main.ts calls this once the first frames are on screen. */
export { hideLoading } from './Loading';
