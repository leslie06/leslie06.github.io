import { lang } from '../core/I18n';
import type { NavApi } from '../game/Contracts';
import type { LaneGraph } from '../traffic/LaneGraph';

/** Streets a job or a fare may send you down: two-way, named, and not the ring roads. */
export const STREETS = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);

export interface Stop { x: number; z: number; label: string }

/**
 * An address on a two-way street a drive of `minR`-`maxR` metres from (x, z): a random kerb on a
 * random named street nearby whose road route fits, at least `apart` metres from every `avoid`
 * ("恒惠西路42号"). Every candidate street is tried in a random order: the one-ways make most of them
 * a long way round by road, and 60 random draws out of a thousand links found none of the few that
 * fit. Heading NaN: either way along the road, since a driver may turn round for a stop.
 */
export function pickAddress(g: LaneGraph, nav: NavApi | undefined, rnd: () => number, x: number, z: number, minR: number, maxR: number,
  avoid: Stop[] = [], apart = 120, byRoad = true): Stop | null {
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const ids = g.near(x, z, maxR).sort(() => rnd() - 0.5);
  for (const id of ids) {
    const l = g.links[id];
    if (l.oneway || !l.name || l.len < 30 || !STREETS.has(l.cls) || l.hmax > 0.3) continue;
    const s = 10 + rnd() * (l.len - 20);
    g.at(l, s, -(l.hw + 0.8), tmp);
    const d = Math.hypot(tmp.x - x, tmp.z - z);
    if (d > maxR || d < minR * 0.4) continue;
    if (avoid.some((a) => Math.hypot(a.x - tmp.x, a.z - tmp.z) < apart)) continue;
    if (byRoad) { const len = nav?.route(x, z, NaN, tmp.x, tmp.z)?.len ?? d * 1.4; if (len < minR || len > maxR) continue; }
    else if (d < minR) continue;
    const no = 2 + Math.floor(rnd() * 60) * 2;
    return { x: tmp.x, z: tmp.z, label: lang() === 'zh' ? `${l.name}${no}号` : `${no} ${l.name}` };
  }
  return null;
}
