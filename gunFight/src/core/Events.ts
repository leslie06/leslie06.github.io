/** Typed event bus. Systems talk to each other through this, not by direct references. */
export interface GameEvents {
  'weapon:fire': { weaponId: string; origin: [number, number, number]; dir: [number, number, number] };
  'weapon:reload': { weaponId: string };
  'weapon:switch': { weaponId: string };
  'hit:surface': { point: [number, number, number]; normal: [number, number, number]; surface: SurfaceType; dir: [number, number, number] };
  'hit:enemy': { enemyId: number; point: [number, number, number]; normal: [number, number, number]; damage: number; headshot: boolean; killed: boolean };
  'player:damage': { amount: number; from: [number, number, number] };
  'player:death': Record<string, never>;
  'player:footstep': { surface: SurfaceType; speed: number };
  'player:land': { speed: number };
  'player:slide': { start: boolean };
  'enemy:spawn': { enemyId: number };
  'enemy:death': { enemyId: number; position: [number, number, number]; headshot: boolean };
  'enemy:fire': { enemyId: number; origin: [number, number, number]; dir: [number, number, number]; hitPlayer: boolean };
  'explosion': { position: [number, number, number]; radius: number };
  'game:wave': { wave: number };
  'game:kill': { streak: number; headshot: boolean; weaponId: string };
  'game:start': Record<string, never>;
  'game:over': { kills: number; wave: number };
  'ui:hitmarker': { headshot: boolean; kill: boolean };
}

export type SurfaceType = 'concrete' | 'metal' | 'wood' | 'dirt' | 'brick' | 'plaster' | 'glass' | 'sandbag' | 'flesh' | 'water';

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
