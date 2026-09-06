import type { Engine } from '../core/Engine';
import { hideLoading } from './Loading'; // side effect: shows the boot screen at module evaluation
import { Hud } from './Hud';
import { registerUiPoses } from './poses';
import { shotMode } from '../debug/ShotMode';

export async function install(engine: Engine, container: HTMLElement): Promise<void> {
  const hud = new Hud(engine, container);
  engine.add(hud);
  registerUiPoses(engine, hud);
  hideLoading(shotMode);
}
