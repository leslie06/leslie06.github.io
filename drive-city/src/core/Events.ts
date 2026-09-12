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
