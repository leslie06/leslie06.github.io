import type { Engine } from '../core/Engine';
import { Level } from './Level';

export async function install(engine: Engine): Promise<void> {
  const level = new Level(engine); engine.add(level);
  await level.build();
}
