import type { Engine } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { HudApi } from '../game/Contracts';

const KEY = 'drivecity.npc.v1';

/**
 * Who's Who (人物志): every kind of person met - the street encounters and the taxi passengers - each
 * counted once (and how often since), saved in `drivecity.npc.v1`. The pause screen shows how many.
 */
export const ENTRIES: [string, TKey][] = [
  ['enc.thief', 'npc.j.thief'], ['enc.scam', 'npc.j.scam'], ['enc.rage', 'npc.j.rage'], ['enc.pregnant', 'npc.j.pregnant'],
  ['enc.courier', 'npc.j.courier'], ['enc.daijia', 'npc.j.daijia'], ['enc.tail', 'npc.j.tail'], ['enc.foreigner', 'npc.j.foreigner'],
  ['pax.rush', 'pax.name.rush'], ['pax.queasy', 'pax.name.queasy'], ['pax.chatty', 'pax.name.chatty'],
  ['pax.streamer', 'pax.name.streamer'], ['pax.drunk', 'pax.name.drunk'], ['pax.mystery', 'pax.name.mystery'],
  // street life (life/)
  ['life.dance', 'life.who.auntie'], ['life.taichi', 'life.who.master'], ['life.chess', 'life.who.chess'], ['life.birds', 'life.who.birds'],
  ['life.jianbing', 'life.who.jianbing'], ['life.bbq', 'life.who.bbq'], ['life.busker', 'life.who.busker'], ['life.erhu', 'life.who.erhu'],
  ['life.tour', 'life.who.guide'], ['life.police', 'life.who.police'], ['life.sweeper', 'life.who.sweeper'],
  // the contacts, met in person (contacts/)
  ['con.laok', 'who.laok'], ['con.xiaoyu', 'who.xiaoyu'], ['con.daliu', 'who.daliu'], ['con.wang', 'who.wang'],
  ['con.laozhang', 'con.who.laozhang'], ['con.liujie', 'con.who.liujie'], ['con.feilong', 'con.who.feilong'],
];

export class Journal {
  private met: Record<string, number> = {};
  constructor(private engine: Engine) {
    try { this.met = JSON.parse(localStorage.getItem(KEY) ?? '{}')?.met ?? {}; } catch { /* private mode */ }
  }
  get count(): number { return ENTRIES.filter(([id]) => this.met[id]).length; }
  get total(): number { return ENTRIES.length; }
  has(id: string): boolean { return !!this.met[id]; }
  /** Met one: the first time, a toast and `npc:met`. */
  meet(id: string): void {
    const first = !this.met[id];
    this.met[id] = (this.met[id] ?? 0) + 1;
    try { localStorage.setItem(KEY, JSON.stringify({ met: this.met })); } catch { /* ignore */ }
    if (!first) return;
    const e = ENTRIES.find(([k]) => k === id);
    if (!e) return;
    const name = t(e[1]), n = this.count, of = this.total;
    this.engine.events.emit('npc:met', { id, name, n, of });
    setTimeout(() => this.engine.get<HudApi>('hud')?.toast(t('npc.met', { name, n, of })), 2600);
  }
}

const journals = new WeakMap<Engine, Journal>();
/** The one journal (missions/ and npc/ both write to it). */
export function journalOf(engine: Engine): Journal {
  let j = journals.get(engine);
  if (!j) { j = new Journal(engine); journals.set(engine, j); }
  return j;
}
