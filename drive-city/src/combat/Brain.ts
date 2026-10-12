import { STRIKE, type Action, type StrikeAction } from '../character/Animator';

/**
 * One gang member in a fist fight (combat/), as pure logic: where it wants to be, which way it faces, what it is
 * doing, and when its punch lands. combat/index.ts moves the person (`Actor.puppet`) and resolves the hits.
 *
 * The rhythm is the one Arkham and Sleeping Dogs use so a crowd fight reads: everyone keeps a ring round the player
 * (2.4-3.4 m, drifting round it), and only the one holding the attack token closes in, winds up where the player
 * can see it (the counter window, `telegraph`), strikes and backs off. A hit stuns it (cutting a wind-up short), a
 * knock-down puts it on the ground until people/ has it up again, and at 0 health it stays down.
 */
export type BrainState = 'approach' | 'circle' | 'close' | 'windup' | 'strike' | 'recover' | 'flinch' | 'down' | 'ko';

/** How hard they are: health, how long the wind-up gives the player, how hard they hit. */
export interface Tough { hp: number; windup: number; dmg: number }
export const TOUGH: Tough = { hp: 70, windup: 0.6, dmg: 8 };

const RING_MIN = 2.4, RING_MAX = 3.4;
const RUN = 3.4, WALK = 1.5, SHUFFLE = 0.7, CLOSE = 2.6;
/** Within this of the player the strike is thrown; it lands if the player is still within REACH in front. */
const STRIKE_AT = 1.35, REACH = 1.75;
const STRIKES: readonly StrikeAction[] = ['jab', 'cross', 'hook'];

export interface BrainView {
  /** The player's feet. */
  px: number; pz: number;
  /** Other fighters (for spacing). */
  others: readonly { x: number; z: number }[];
  /** This one holds the attack token. */
  token: boolean;
}

/** What a step produced: a punch landing this step at the player (combat/ checks reach and blocks). */
export interface BrainOut { landed: boolean }

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export class Brain {
  state: BrainState = 'approach';
  /** Seconds in the state. */
  t = 0;
  hp: number;
  /** Feet and facing (combat/ reads them back from the person while it is down). */
  x: number; z: number; yaw = 0;
  /** Speed it is moving at (the gait's). */
  speed = 0;
  /** Seconds before it may take the token again. */
  cool: number;
  /** The strike it throws next. */
  strike: StrikeAction = 'cross';
  private side = rnd() < 0.5 ? 1 : -1;
  private sideT = 1.5 + rnd() * 2;
  private ring = RING_MIN + rnd() * (RING_MAX - RING_MIN);
  private windupFor: number;

  constructor(x: number, z: number, readonly tough: Tough = TOUGH) {
    this.x = x; this.z = z; this.hp = tough.hp;
    this.cool = 0.6 + rnd() * 1.8;
    this.windupFor = tough.windup;
  }

  /** On its feet and in the fight (not stunned, down or out). */
  get standing(): boolean { return this.state !== 'down' && this.state !== 'ko'; }
  /** Wants the token (ready to attack). */
  get ready(): boolean { return this.cool <= 0 && (this.state === 'circle' || this.state === 'approach'); }
  /** Winding up: the counter window. */
  get telegraph(): boolean { return this.state === 'windup'; }
  /** Holds the token while closing, winding up, striking or backing off. */
  get attacking(): boolean { return this.state === 'close' || this.state === 'windup' || this.state === 'strike' || this.state === 'recover'; }

  /** The pose for people/ (null: the ordinary walk or run). */
  get action(): Action | null {
    switch (this.state) {
      case 'approach': return this.speed > 2.5 ? null : 'guard';
      case 'strike': return this.strike;
      case 'flinch': return 'flinch';
      case 'windup': case 'circle': case 'close': case 'recover': return 'guard';
      default: return null;
    }
  }
  /** Its clock for the pose (a strike plays from 0). */
  get actionT(): number { return this.state === 'strike' || this.state === 'flinch' ? this.t : 1; }

  private go(s: BrainState): void { this.state = s; this.t = 0; }

  /**
   * Hit for `dmg`: stunned, or out at 0 health. Returns 'ko' when this hit finished it. Winding up or striking it
   * shrugs off a plain blow (the damage, no stun): only a counter or a knock-down stops an attack, so mashing the
   * attack key is no answer to the red mark.
   */
  hit(dmg: number, stops = false): 'flinch' | 'armored' | 'ko' {
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) { this.go('ko'); return 'ko'; }
    if (!stops && (this.state === 'windup' || this.state === 'strike')) return 'armored';
    if (this.state !== 'down') this.go('flinch');
    return 'flinch';
  }
  /** Knocked down (a finisher, a counter, a car): lying until `up()`. */
  knocked(): void { if (this.state !== 'ko') this.go('down'); }
  /** Back on its feet. */
  up(): void { if (this.state === 'down') { this.go('circle'); this.cool = 0.8 + rnd(); } }

  /** One fixed step: the move it wants (x, z, yaw, speed set), and whether a punch lands now. */
  step(v: BrainView, dt: number): BrainOut {
    this.t += dt;
    this.cool -= dt;
    const out: BrainOut = { landed: false };
    if (this.state === 'down' || this.state === 'ko') { this.speed = 0; return out; }
    const dx = v.px - this.x, dz = v.pz - this.z, d = Math.hypot(dx, dz) || 1e-3;
    const toward = Math.atan2(dx, dz);
    let vx = 0, vz = 0;
    switch (this.state) {
      case 'approach': {
        // in to the ring at a run, then circle
        const want = d - this.ring, sp = want > 4 ? RUN : WALK;
        if (want > 0.3) { vx = dx / d * sp; vz = dz / d * sp; } else this.go('circle');
        this.yaw = toward;
        break;
      }
      case 'circle': {
        this.sideT -= dt;
        if (this.sideT < 0) { this.side = -this.side; this.sideT = 1.5 + rnd() * 2.5; this.ring = RING_MIN + rnd() * (RING_MAX - RING_MIN); }
        const radial = Math.max(-1, Math.min(1, (d - this.ring) * 1.5));
        vx = dx / d * radial * WALK + (dz / d) * this.side * SHUFFLE;
        vz = dz / d * radial * WALK - (dx / d) * this.side * SHUFFLE;
        this.yaw = toward;
        if (d > RING_MAX + 3) this.go('approach');
        else if (v.token && this.cool <= 0) { this.go('close'); this.strike = STRIKES[Math.floor(rnd() * STRIKES.length)]; }
        break;
      }
      case 'close':
        this.yaw = toward;
        if (d > STRIKE_AT) { vx = dx / d * CLOSE; vz = dz / d * CLOSE; }
        else { this.go('windup'); this.windupFor = this.tough.windup * (0.85 + rnd() * 0.35); }
        if (this.t > 3) this.backOff();
        break;
      case 'windup':
        // standing its ground, turning with the player: the counter window
        this.yaw = toward;
        if (this.t >= this.windupFor) this.go('strike');
        break;
      case 'strike': {
        const s = STRIKE[this.strike];
        if (this.t - dt < s.hit && this.t >= s.hit) out.landed = d < REACH;
        if (this.t < s.hit) { vx = dx / d * 0.8; vz = dz / d * 0.8; }
        if (this.t >= s.dur) this.go('recover');
        break;
      }
      case 'recover':
        vx = -dx / d * WALK; vz = -dz / d * WALK;
        this.yaw = toward;
        if (this.t > 0.55 || d > this.ring) this.backOff();
        break;
      case 'flinch':
        this.yaw = toward;
        if (this.t > 0.45) this.backOff();
        break;
    }
    // keep apart from the others (and off the player)
    for (const o of v.others) {
      const ox = this.x - o.x, oz = this.z - o.z, od = Math.hypot(ox, oz);
      if (od > 1e-3 && od < 1.2) { vx += ox / od * (1.2 - od) * 4; vz += oz / od * (1.2 - od) * 4; }
    }
    if (d < 0.9) { vx -= dx / d * (0.9 - d) * 5; vz -= dz / d * (0.9 - d) * 5; }
    this.x += vx * dt; this.z += vz * dt;
    this.speed = Math.hypot(vx, vz);
    return out;
  }

  /** Done attacking: back to the ring, a while before the next go. */
  backOff(): void { this.go('circle'); this.cool = 1.4 + rnd() * 1.8; }

  /** Countered while winding up (or striking): it eats the player's counter. */
  countered(): void { this.go('flinch'); }

  /** Seed the shared random (tests). */
  static seed(n: number): void { seed = Math.max(1, Math.floor(n)); }
}
