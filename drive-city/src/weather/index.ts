import type { Engine } from '../core/Engine';
import { Rng } from '../core/Rng';
import type { RenderApi } from '../game/Contracts';
import { seasonAt } from '../render/Season';

/**
 * Beijing weather: mostly dry, and now and then a shower that builds over ~25 s, rains for a few
 * minutes and clears. Drives RenderApi.rain. Off in shot mode and with ?rain=N (fixed weather).
 *
 * 下雪（2026-11-10，docs/beijing-immersion-design.md D1）：按北京的日子，11 月下旬到 3 月上旬的「阵雨」有一定概率是雪
 * （12 月到 2 月一定是），下雪改的是 `snow`，雪下一分钟屋顶草地就白了（render/ 的 `snowCover`），停了慢慢化。
 * 这段日子里开局还有三成概率「昨晚下过雪」：一开始就是白的。`?snow=N` / `?snowcover=N` 固定天气时这里不管。
 */
export function snowChance(day: number): number {
  // 0 = 1 Jan; the first snow is ~late November, the last ~early March
  if (day >= 335 || day <= 59) return 1;
  if (day >= 325) return (day - 325) / 10;
  if (day <= 70) return (70 - day) / 11;
  return 0;
}

export async function install(engine: Engine): Promise<void> {
  const r = engine.get<RenderApi>('render');
  const q = new URLSearchParams(location.search);
  if (!r || q.has('rain') || q.has('shot') || q.has('snow') || q.has('snowcover')) return;
  const rng = new Rng((Date.now() & 0xffff) + 1);
  const cold = snowChance(seasonAt().day);
  // snowed overnight: white from the start (render/ melts it over the session unless it snows again)
  if (cold > 0 && rng.next() < 0.3 * cold) r.snowCover = 1;
  let target = 0, snowing = false, next = 240 + rng.next() * 360;   // the first chance of a shower after 4-10 min
  engine.add({
    name: 'weather',
    update(dt) {
      if (engine.paused) return;
      next -= dt;
      if (next <= 0) {
        if (target > 0) { target = 0; next = 420 + rng.next() * 600; }
        else if (rng.next() < 0.45) { target = 0.35 + rng.next() * 0.6; snowing = rng.next() < cold; next = (snowing ? 240 : 150) + rng.next() * 240; }
        else next = 300 + rng.next() * 300;
      }
      const k = Math.min(1, dt / 25);
      if (snowing) { r.snow = (r.snow ?? 0) + (target - (r.snow ?? 0)) * k; r.rain += (0 - r.rain) * k; }
      else { r.rain += (target - r.rain) * k; if (r.snow) r.snow += (0 - r.snow) * k; }
    },
  });
}
