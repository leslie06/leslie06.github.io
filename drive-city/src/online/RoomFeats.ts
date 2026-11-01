import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, HudApi, NavApi } from '../game/Contracts';
import type { MultiplayerApi } from './Multiplayer';

/**
 * 特技和漂移比拼 (2026-11-01, the room's 5th idea): what the player pulls off - a drift's score (`drift:end`), a street
 * combo banked (`stunt:bank`), a flight off a stunt ramp or overpass (`stunt:jump`) - against the room. A drift or a
 * combo is sent only when it beats the room's best of its kind (so a room is not a stream of toasts); a flight always
 * is, and the ramp flashes on the others' map for CHALLENGE s with the distance: 「来破纪录」. Beating someone else's
 * distance on the same ramp says so. The bests last as long as the room (and only what this game has seen).
 */
export type FeatKind = 'drift' | 'combo' | 'jump';
export interface FeatBest { kind: FeatKind; name: string; v: number }
export interface FeatApi extends System {
  /** The room's best of each kind, as heard here. */
  readonly bests: readonly FeatBest[];
}

/** Less than this is not worth telling anyone (points; metres for a jump). */
const MIN: Record<FeatKind, number> = { drift: 400, combo: 300, jump: 10 };
const CHALLENGE = 60;

export function install(engine: Engine): FeatApi | null {
  const mp = engine.get<MultiplayerApi>('mp');
  if (!mp) return null;
  const toast = (s: string, secs = 4) => engine.get<HudApi>('hud')?.toast(s, secs);
  const nameOf = (id: number) => (id === mp.me?.id ? mp.me.name : mp.peers.find((p) => p.id === id)?.name ?? '?');
  const bests = new Map<FeatKind, { id: number; v: number }>();
  /** Each ramp's longest flight in the room. */
  const ramps = new Map<number, { id: number; v: number }>();
  /** Ramps a friend just flew: on the map until `until` (game seconds). */
  const marks: { x: number; z: number; label: string; until: number }[] = [];
  let clock = 0;
  const fmtV = (kind: FeatKind, v: number) => (kind === 'jump' ? t('feat.metres', { m: Math.round(v) }) : t('feat.points', { n: Math.round(v).toLocaleString() }));
  const kindName = (kind: FeatKind) => t(`feat.${kind}` as 'feat.drift');

  /** A feat (ours or a friend's): the room's best, the ramp's record, what to tell. */
  const heard = (id: number, kind: FeatKind, v: number, ramp: number, x: number, z: number) => {
    const mine = id === mp.me?.id;
    const best = bests.get(kind);
    const record = !best || v > best.v;
    if (record) bests.set(kind, { id, v });
    if (kind === 'jump') {
      const r = ramps.get(ramp);
      const beat = r && r.id !== id && v > r.v ? r : null;
      if (!r || v > r.v) ramps.set(ramp, { id, v });
      if (!mine) marks.push({ x, z, label: t('feat.mark', { name: nameOf(id), m: Math.round(v) }), until: clock + CHALLENGE });
      if (beat) toast(t(mine ? 'feat.youBeat' : 'feat.beat', { name: nameOf(id), who: nameOf(beat.id), m: Math.round(v) }));
      else if (!mine) toast(t('feat.jumped', { name: nameOf(id), m: Math.round(v) }));
      else if (record && best) toast(t('feat.youRecord', { kind: kindName(kind), v: fmtV(kind, v) }));
      return;
    }
    if (!record) return;
    toast(mine ? t('feat.youRecord', { kind: kindName(kind), v: fmtV(kind, v) }) : t('feat.record', { name: nameOf(id), kind: kindName(kind), v: fmtV(kind, v) }));
  };

  /** Ours: told to the room when it is worth it. */
  const ours = (kind: FeatKind, v: number, ramp = -1, x = 0, z = 0) => {
    if (mp.status !== 'in' || !mp.me || v < MIN[kind] || !mp.peers.length) return;
    const best = bests.get(kind);
    if (kind !== 'jump' && best && v <= best.v) return;
    mp.send('feat', { kind, v: Math.round(v * 10) / 10, ramp, x: Math.round(x), z: Math.round(z) });
    heard(mp.me.id, kind, v, ramp, x, z);
  };
  engine.events.on('drift:end', ({ score, crashed }) => { if (!crashed) ours('drift', score); });
  engine.events.on('stunt:bank', ({ points, lost }) => { if (!lost) ours('combo', points); });
  engine.events.on('stunt:jump', ({ ramp, x, z, dist }) => ours('jump', dist, ramp, x, z));

  mp.onEvent((from, m) => {
    if (m.k !== 'feat') return;
    const kind = m.kind as FeatKind, v = Number(m.v), ramp = Number(m.ramp), x = Number(m.x), z = Number(m.z);
    if (!(kind in MIN) || !Number.isFinite(v) || v < 0 || v > 1e7 || !Number.isFinite(x) || !Number.isFinite(z)) return;
    heard(from, kind, v, Number.isFinite(ramp) ? ramp : -1, x, z);
  });

  const blips: Blip[] = [];
  let blipsOn = false;
  const api: FeatApi = {
    name: 'feats',
    get bests() { return (['drift', 'combo', 'jump'] as FeatKind[]).flatMap((k) => { const b = bests.get(k); return b ? [{ kind: k, name: nameOf(b.id), v: b.v }] : []; }); },
    update(dt) {
      clock += dt;
      if (mp.status !== 'in') { if (bests.size) { bests.clear(); ramps.clear(); marks.length = 0; } return; }
      for (let i = marks.length - 1; i >= 0; i--) if (marks[i].until < clock) marks.splice(i, 1);
      const nav = engine.get<NavApi>('nav');
      if (nav && !blipsOn) {
        blipsOn = true;
        nav.addBlips(() => { blips.length = 0; for (const m of marks) blips.push({ kind: 'jump', x: m.x, z: m.z, flash: true, label: m.label }); return blips; });
      }
    },
  };
  engine.add(api);
  return api;
}
