import type { Engine } from '../core/Engine';
import { Rng } from '../core/Rng';
import type { RenderApi } from '../game/Contracts';

/**
 * Beijing weather: mostly dry, and now and then a shower that builds over ~25 s, rains for a few
 * minutes and clears. Drives RenderApi.rain. Off in shot mode and with ?rain=N (fixed weather).
 */
export async function install(engine: Engine): Promise<void> {
  const r = engine.get<RenderApi>('render');
  const q = new URLSearchParams(location.search);
  if (!r || q.has('rain') || q.has('shot')) return;
  const rng = new Rng((Date.now() & 0xffff) + 1);
  let target = 0, next = 240 + rng.next() * 360;   // the first chance of a shower after 4-10 min
  engine.add({
    name: 'weather',
    update(dt) {
      if (engine.paused) return;
      next -= dt;
      if (next <= 0) {
        if (target > 0) { target = 0; next = 420 + rng.next() * 600; }
        else if (rng.next() < 0.45) { target = 0.35 + rng.next() * 0.6; next = 150 + rng.next() * 240; }
        else next = 300 + rng.next() * 300;
      }
      r.rain += (target - r.rain) * Math.min(1, dt / 25);
    },
  });
}
