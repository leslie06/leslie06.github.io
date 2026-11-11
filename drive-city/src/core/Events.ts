/** Typed event bus. Systems talk to each other through this, not by direct references. */
export interface GameEvents {
  /** Chassis hit something. `strength` is the unexplained change in velocity over one step, m/s. */
  'vehicle:impact': { strength: number; point: [number, number, number] };
  /** All four wheels touched down after at least `airTime` seconds off the ground. */
  'vehicle:land': { airTime: number; speed: number };
  /** The player's car over something in the road (traffic/RoadFeel.ts): a deck's joint, a kerb. `strength` 0..1. */
  'road:bump': { strength: number; kind: 'joint' | 'kerb' };
  'vehicle:reset': Record<string, never>;
  'vehicle:shift': { gear: number };
  /** A drift ended; `score` is what it banked (0 when it ended in a crash). */
  'drift:end': { score: number; crashed: boolean };
  /** A car knocked a pedestrian over (or the player shoulder-charged one). */
  'people:hit': { x: number; z: number; speed: number; byPlayer: boolean; fair?: boolean };
  /** The player got in (`carjacked`: took a traffic car) or out of a car. */
  'player:mode': { mode: 'driving' | 'onfoot'; carjacked: boolean };
  /** F on something on offer while on foot (a shop, somebody to talk to, a bag): `label` is the prompt it showed. */
  'player:use': { label: string };
  /** Something bought over a shop counter in the street (street/): the sign's trade, what, and the price paid. */
  'street:buy': { trade: string; item: string; price: number };
  /** A ride on the underground (travel/Metro.ts): the stations' names and how many stops. */
  'metro:ride': { from: string; to: string; stops: number };
  /** Someone on the pavement shouted at the player (a bubble over their head). */
  'people:shout': { x: number; z: number; text: string; follow?: { readonly x: number; readonly y: number; readonly z: number } | null; name?: string; secs?: number };
  /**
   * Someone says `text` out loud (audio/Babble.ts gives it a voice): at (x, z), or in the player's
   * car when x is NaN (a passenger). `id` lets a new line from the same speaker cut the old one off.
   */
  'npc:voice': { text: string; voice: { pitch: number; rate: number; bright: number; fem?: number; age?: number; character?: string }; x: number; z: number; id?: string };
  /** A story chapter was done (story/): whose it was (laok, xiaoyu, daliu, wang). */
  'story:done': { chapter: string; who: string };
  /** A main-story chapter passed (campaign/), with its medal. */
  'campaign:passed': { id: string; medal: string };
  /** The next chapter's giver called: `go` is 「现在过去」. */
  'campaign:call': { id: string; go: boolean };
  /** A hailer is getting into the taxi (missions/): which one (`MissionApi.hailers`). */
  'taxi:board': { id: number };
  /** A taxi fare was paid (missions/). */
  'taxi:fare': { pay: number; kind: string };
  /** A street event's race against the red saloon ended (events/). */
  'challenge:result': { won: boolean };
  /** A traffic officer blew the whistle (life/). */
  'life:whistle': { x: number; z: number };
  /** A new face for the journal (人物志): `id` (npc/Journal.ts), its name, how many met of how many. */
  'npc:met': { id: string; name: string; n: number; of: number };
  /** A witness finished phoning the police about the player. */
  'people:report': { x: number; z: number };
  /** The player's car knocked a bin, a shared bike or a railing flying (city/Knock.ts). */
  'prop:hit': { kind: 'bin' | 'bike' | 'rail'; x: number; y: number; z: number; speed: number };
  /** A blow landed in a fist fight (combat/): `power` 0..1, `blocked` taken on the forearms, `toPlayer` the player was hit. */
  'combat:hit': { x: number; z: number; power: number; blocked: boolean; toPlayer: boolean };
  /** A fist or foot swung (the whoosh), whether it lands or not. */
  'combat:swing': { x: number; z: number; heavy: boolean };
  /** A gang member down for good. */
  'combat:ko': { x: number; z: number };
  /** A finisher: a fighter kicked into a car or a wall at (x, z), the point of impact. */
  'combat:finisher': { x: number; z: number; kind: 'car' | 'wall' };
  /** A counter: the player caught one winding up. */
  'combat:counter': { x: number; z: number };
  /** A move that scores in the street combo (stunts/): a near miss, a drift, a jump... `points` before the multiplier. */
  'stunt:event': { kind: 'near' | 'drift' | 'air' | 'oncoming' | 'redlight' | 'smash' | 'evade' | 'shortcut' | 'takedown'; points: number };
  /** A stunt ramp or overpass flown (stunts/Jumps.ts): which (`ramp`), from where, how far (m). */
  'stunt:jump': { ramp: number; x: number; z: number; dist: number; over: boolean };
  /** The combo ended: banked as `cash`, or `lost` in a crash (cash 0). */
  'stunt:bank': { points: number; cash: number; lost: boolean };
  /** A 兔儿爷 collectible was picked up (collect/). */
  'collect:found': { x: number; z: number; found: number; total: number };
  /** A landmark checked in (checkin/): the first visit to it. */
  'checkin': { id: string; x: number; z: number; found: number; total: number };
  /** The landmark asked for (CheckinApi.want: the day's, daily/) reached, checked in before or not. */
  'checkin:visit': { id: string };
  /** 南锣鼓巷 (district/): something bought at a counter, the studio's camera going off, a go on the dance machine. */
  'district:buy': { shop: string; item: string; price: number };
  'player:dress': { wear: import('../game/Contracts').Wear };
  'district:photo': Record<string, never>;
  'district:dance': { hits: number; of: number; prize: number };
  /** Round 3: a cat mewing at (x, z) (the café's lost cat, the café's own), a racket broken up, a delivery handed over. */
  'district:meow': { x: number; z: number };
  /** A 快速前往 (travel/) to (x, z): checkin/ holds the landmarks round it until the player has left. */
  'travel:jump': { x: number; z: number; id: string };
  /** 产业 (estate/): bought, improved, takings collected, the 东厢房 rented, a raid begun and over, a night's sleep. */
  'estate:bought': { id: string };
  'estate:upgraded': { id: string; up: string };
  'estate:collected': { id: string; n: number };
  'estate:safehouse': Record<string, never>;
  'estate:raid': { id: string };
  'estate:raidOver': { id: string; won: boolean };
  'estate:slept': { hours: number; wake: number };
  'district:racket': { shop: string; result: 'won' | 'lost' | 'fled' | 'paid' };
  'district:delivered': { pay: number; late: boolean };
  /** The police got the player (police/), just before the respawn: fines and the impound hang off it. */
  'wanted:busted': { level: number };
  /** A traffic car blew its horn at (x, z). */
  /** A bus pulled in at its stop (`arrive`) or pulled out, near the camera (audio/: the announcement). */
  'traffic:bus': { x: number; z: number; arrive: boolean };
  'traffic:horn': { x: number; z: number; /** The car honking (voice/: its driver may shout too). */ car?: { readonly pos: { readonly x: number; readonly y: number; readonly z: number } } };
  /** A police car was wrecked (police/); `nearPlayer`: the player was right there (a takedown). */
  'police:wrecked': { x: number; z: number; nearPlayer: boolean };
  /** The wanted level changed (`up`: it rose). */
  'wanted:level': { level: number; up: boolean };
  /** The police lost the player (not a bust): the stars they had. */
  'wanted:escaped': { level: number };
  /** 送豆腐 (missions/Tofu.ts): the tofu up at the top, with the water left in the cup (0..1). */
  'tofu:delivered': { water: number };
  /** A short job (missions/Jobs.ts) finished, paid. */
  'job:done': { kind: string };
  /** This player set a course's record (online/Leaderboard.ts): the board, the time (ms). */
  'rec:broken': { board: string; ms: number };
  /** 每日任务 (daily/): one done (its tier), and all three (the stamp it put on the card). */
  'daily:done': { id: string; tier: number };
  'daily:full': { stamp: number };
  /** A street race was finished (races/): which start line, the place, seconds from the green light. */
  'race:finish': { race: number; place: number; time: number };
  /** A time trial (trials/): started, a checkpoint passed, finished (medal -1 none, 0 bronze .. 2 gold). */
  'trial:start': { id: string };
  'trial:checkpoint': { id: string; i: number; of: number };
  'trial:finish': { id: string; time: number; medal: number; best: boolean };
  /** A Crazy-Taxi shift ended (missions/): what it earned. */
  'taxi:shift': { earned: number; fares: number };
  /** A text message arrived on the player's phone (story/). */
  'phone:sms': { from: string };
  'game:start': Record<string, never>;
  'game:pause': { paused: boolean };
  /** 省电档开了（core/Engine.ts 的 `lite`）：交通、行人、小地图跟着减量。 */
  'quality:lite': { on: boolean };
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
