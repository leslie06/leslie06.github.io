/** Typed event bus. Systems talk to each other through this, not by direct references. */
export interface GameEvents {
  /** Chassis hit something. `strength` is the unexplained change in velocity over one step, m/s. */
  'vehicle:impact': { strength: number; point: [number, number, number] };
  /** All four wheels touched down after at least `airTime` seconds off the ground. */
  'vehicle:land': { airTime: number; speed: number };
  'vehicle:reset': Record<string, never>;
  'vehicle:shift': { gear: number };
  /** A drift ended; `score` is what it banked (0 when it ended in a crash). */
  'drift:end': { score: number; crashed: boolean };
  /** A car knocked a pedestrian over (or the player shoulder-charged one). */
  'people:hit': { x: number; z: number; speed: number; byPlayer: boolean };
  /** The player got in (`carjacked`: took a traffic car) or out of a car. */
  'player:mode': { mode: 'driving' | 'onfoot'; carjacked: boolean };
  /** Someone on the pavement shouted at the player (a bubble over their head). */
  'people:shout': { x: number; z: number; text: string };
  /** A witness finished phoning the police about the player. */
  'people:report': { x: number; z: number };
  /** The player's car knocked a bin, a shared bike or a railing flying (city/Knock.ts). */
  'prop:hit': { kind: 'bin' | 'bike' | 'rail'; x: number; y: number; z: number; speed: number };
  /** A move that scores in the street combo (stunts/): a near miss, a drift, a jump... `points` before the multiplier. */
  'stunt:event': { kind: 'near' | 'drift' | 'air' | 'oncoming' | 'redlight' | 'smash' | 'evade' | 'shortcut'; points: number };
  /** The combo ended: banked as `cash`, or `lost` in a crash (cash 0). */
  'stunt:bank': { points: number; cash: number; lost: boolean };
  /** A 兔儿爷 collectible was picked up (collect/). */
  'collect:found': { x: number; z: number; found: number; total: number };
  /** The police got the player (police/), just before the respawn: fines and the impound hang off it. */
  'wanted:busted': { level: number };
  /** A traffic car blew its horn at (x, z). */
  'traffic:horn': { x: number; z: number };
  /** The wanted level changed (`up`: it rose). */
  'wanted:level': { level: number; up: boolean };
  /** A street race was finished (races/): which start line, the place, seconds from the green light. */
  'race:finish': { race: number; place: number; time: number };
  /** A Crazy-Taxi shift ended (missions/): what it earned. */
  'taxi:shift': { earned: number; fares: number };
  /** A text message arrived on the player's phone (story/). */
  'phone:sms': { from: string };
  'game:start': Record<string, never>;
  'game:pause': { paused: boolean };
  /** The GPU dropped the WebGL context (driver reset / out of memory). Nothing renders after this. */
  'renderer:contextlost': Record<string, never>;
  'renderer:contextrestored': Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(`[events] handler for ${type} threw`, e); }
    }
  }
}
