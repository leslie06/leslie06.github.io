import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Blip, CameraApi, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, Speaker, VehicleApi, WantedApi } from '../game/Contracts';
import type { ContactsApi } from '../contacts';
import type { DamageApi } from '../damage';
import { Marker } from '../missions/Marker';
import { nearestKerb } from '../people/Pavement';
import type { TrafficApi } from '../traffic';
import { css } from '../ui/theme';
import { ScriptCar } from './Cars';
import type { Step, StepCtx, StepResult } from './Runner';
import { Card, Letterbox } from './Screens';

css(`body.cmp-cine .hud>:not(.dlg),body.cmp-cine .touch,body.cmp-cine .phone{opacity:0!important;pointer-events:none!important;transition:opacity .3s}
body.cmp-cine .hud .dlg{bottom:calc(11vh + 12px);z-index:27}
body.cmp-cine.dc-touch .hud .dlg{top:auto;bottom:calc(11vh + 8px)}`);

export type V3 = [number, number, number];
/** A shot: the camera moves from `from` to `to` over `secs`, looking from `look` to `look2` (default: `look`). */
export interface Shot { from: V3; to?: V3; look: V3; look2?: V3; secs: number; fov?: number }
export interface Line { who: Speaker; text: string }

/** What the mission's steps reach for. One per campaign system. */
export class Env {
  readonly bars = new Letterbox();
  readonly card = new Card();
  readonly markers: Marker[];
  /** The mission's blips this frame (the steps push theirs; cleared each frame). */
  readonly blips: Blip[] = [];
  /** The cars the mission simulates (ScriptCar.fixed/post/draw each frame). */
  readonly cars = new Set<ScriptCar>();
  /** Cutscene camera, or null. */
  cine: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  constructor(readonly engine: Engine) { this.markers = [new Marker(engine.scene), new Marker(engine.scene)]; }
  get tr(): TrafficApi { return this.engine.get<TrafficApi>('traffic')!; }
  get nav(): NavApi { return this.engine.get<NavApi>('nav')!; }
  get pl(): PlayerApi { return this.engine.get<PlayerApi>('player')!; }
  get v(): VehicleApi { return this.engine.get<VehicleApi>('vehicle')!; }
  get people(): PeopleApi | undefined { return this.engine.get<PeopleApi>('people'); }
  get contacts(): ContactsApi | undefined { return this.engine.get<ContactsApi>('contacts'); }
  get dialogue(): DialogueApi | undefined { return this.engine.get<DialogueApi>('dialogue'); }
  get hud(): HudApi | undefined { return this.engine.get<HudApi>('hud'); }
  get wanted(): WantedApi | undefined { return this.engine.get<WantedApi>('wanted'); }
  get damage(): DamageApi | undefined { return this.engine.get<DamageApi>('damage'); }
  get cam(): CameraApi { return this.engine.get<CameraApi>('camera')!; }
  /** The objective line (MissionApi.story: street events, fares and jobs wait while it is set). */
  objective(text: string | null): void { const m = this.engine.get<MissionApi>('missions'); if (m) m.story = text; }

  /**
   * A car parked at the kerb nearest (x, z), `along` metres on along the road, facing the traffic on that side. With
   * `toward` it takes the side of a two-way road whose traffic heads that way (no U-turn to start the drive).
   */
  kerbPose(x: number, z: number, along = 0, toward?: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    const g = this.tr.graph, k = nearestKerb(g, x, z, 60, 0.5);
    if (!k) return null;
    const l = g.links[k.link], at = { x: 0, z: 0, dx: 0, dz: 0 };
    let side = k.side;
    if (toward && !l.oneway) {
      g.at(l, k.s, 0, at);
      // right of travel (side -1) drives along the link
      side = (toward.x - at.x) * at.dx + (toward.z - at.z) * at.dz >= 0 ? -1 : 1;
    }
    // on the right of travel (side -1) facing along the link, on the left facing against it
    const s = Math.max(4, Math.min(l.len - 4, k.s + along * (side < 0 ? 1 : -1)));
    g.at(l, s, side * Math.max(0.9, l.kerbR - 1.1), at);
    return { x: at.x, z: at.z, yaw: side < 0 ? Math.atan2(at.dx, at.dz) : Math.atan2(-at.dx, -at.dz) };
  }

  /** The player in `sc`'s driving seat at a pose (a retry from a checkpoint), their own car parked where it was. */
  putIn(sc: ScriptCar, x: number, z: number, yaw: number): void {
    const v = this.v;
    if (v.car !== sc.car) {
      sc.place(x, z, yaw);
      const prev = v.swapCar(sc.car, sc.look);
      if (prev.car !== sc.car) this.tr.parkCar(prev.car, prev.look);
    }
    v.reset({ x, y: sc.car.spec.wheelRadius + 0.2, z }, yaw);
    v.occupied = true; v.inputEnabled = true; v.autopilot = null;
  }

  /** The player standing at (x, z) facing `yaw`, out of any car. */
  putOnFoot(x: number, z: number, yaw: number): void {
    if (this.pl.mode === 'driving') this.pl.getOut();
    this.pl.setRiding(null, { x, y: 0.2, z, yaw });
  }

  get playerCar(): THREE.Vector3 { return this.v.car.pos; }
}

const lerp = (a: V3, b: V3, k: number): THREE.Vector3 => new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
const smooth = (k: number) => k * k * (3 - 2 * k);
const readSecs = (s: string) => Math.max(2.4, Math.min(7, 1 + s.length * 0.17));

/**
 * A cutscene: the shots in turn under letterbox bars while the lines are said; the player cannot drive and the HUD but
 * the dialogue box is hidden. Space, Enter or a tap skips it. `setup` places people and cars before the first frame.
 */
export function cutscene<S>(env: Env, o: { id: string; checkpoint?: boolean; setup?(ctx: StepCtx<S>): void; shots(ctx: StepCtx<S>): Shot[]; lines(ctx: StepCtx<S>): Line[]; restore?(ctx: StepCtx<S>): void }): Step<S> {
  let shots: Shot[] = [], total = 0, skipped = false, started = false;
  return {
    id: o.id, checkpoint: o.checkpoint, restore: o.restore,
    enter(ctx) {
      skipped = false; started = false;
      o.setup?.(ctx);
      shots = o.shots(ctx); total = shots.reduce((a, s) => a + s.secs, 0);
      const v = env.v; v.inputEnabled = false;
      env.objective(null);
      document.body.classList.add('cmp-cine');
      env.bars.show(true);
      const d = env.dialogue; d?.clear(3);
      for (const l of o.lines(ctx)) d?.say(l.who, l.text, { prio: 4, secs: readSecs(l.text) });
      env.cine = (cam) => {
        let t = ctx.t, i = 0;
        while (i < shots.length - 1 && t > shots[i].secs) { t -= shots[i].secs; i++; }
        const s = shots[i], k = smooth(Math.min(1, t / s.secs));
        cam.position.copy(lerp(s.from, s.to ?? s.from, k));
        cam.lookAt(lerp(s.look, s.look2 ?? s.look, k));
        const f = s.fov ?? 50; if (cam.fov !== f) { cam.fov = f; cam.updateProjectionMatrix(); }
      };
      env.cam.override = (cam, dt) => env.cine?.(cam, dt);
      const skip = (e: Event) => {
        if (e instanceof KeyboardEvent && e.code !== 'Space' && e.code !== 'Enter') return;
        if (!started) return;   // not the key or tap that started it
        e.preventDefault(); skipped = true;
      };
      addEventListener('keydown', skip, true); addEventListener('pointerdown', skip, true);
      ctx.step.defer(() => { removeEventListener('keydown', skip, true); removeEventListener('pointerdown', skip, true); });
      ctx.step.defer(() => {
        env.cine = null; env.cam.override = null; env.cam.snap();
        env.bars.show(false); document.body.classList.remove('cmp-cine');
        env.dialogue?.clear(4);
        const cam = env.engine.camera; if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
        env.v.inputEnabled = true;
      });
    },
    update(ctx) {
      if (ctx.t > 0.4) started = true;
      return skipped || (ctx.t >= total && !env.dialogue?.busy) || ctx.t > total + 40 ? 'done' : 'run';
    },
  };
}

/** Lines said while the player drives (in the dialogue box, voiced); `wait` holds the next step until they are said. */
export function talk<S>(env: Env, id: string, lines: (ctx: StepCtx<S>) => Line[], wait = false): Step<S> {
  return {
    id,
    enter(ctx) { for (const l of lines(ctx)) env.dialogue?.say(l.who, l.text, { prio: 3, secs: readSecs(l.text) }); },
    update(ctx) { return !wait || (ctx.t > 0.5 && !env.dialogue?.busy) ? 'done' : 'run'; },
  };
}

/** Wait `secs`, or until `until` says so. */
export function wait<S>(id: string, secs: number, until?: (ctx: StepCtx<S>) => boolean): Step<S> {
  return { id, update: (ctx) => ctx.t >= secs || !!until?.(ctx) ? 'done' : 'run' };
}

/** Run some code once. */
export function call<S>(id: string, fn: (ctx: StepCtx<S>) => void): Step<S> {
  return { id, enter: fn, update: () => 'done' };
}

/** Get into the mission car: it glows, F takes it. */
export function getIn<S>(env: Env, o: { id: string; car: () => ScriptCar; line: string; checkpoint?: boolean; restore?(ctx: StepCtx<S>): void }): Step<S> {
  return {
    id: o.id, checkpoint: o.checkpoint, restore: o.restore,
    enter(ctx) {
      const sc = o.car(); sc.takeable = true;
      env.objective(o.line);
      ctx.step.defer(() => { env.markers[0].hide(); });
    },
    update() {
      const sc = o.car(), c = sc.car.pos;
      env.blips.push({ kind: 'car', x: c.x, z: c.z, heading: Math.atan2(sc.car.fwd.x, sc.car.fwd.z), flash: true });
      if (env.v.car === sc.car && env.pl.mode === 'driving') return 'done';
      env.markers[0].show(c.x, c.z, '#ffc21f', 0.75);
      return 'run';
    },
  };
}

/** Drive to a point: GPS, the corona, within `r` and (with `stop`) slower than 3 m/s. `fail` checks every frame. */
export function drive<S>(env: Env, o: {
  id: string; checkpoint?: boolean; restore?(ctx: StepCtx<S>): void;
  to(ctx: StepCtx<S>): { x: number; z: number }; line: string; label?: string; r?: number; stop?: boolean; corona?: boolean;
  enter?(ctx: StepCtx<S>): void; tick?(ctx: StepCtx<S>, dt: number): StepResult | void;
}): Step<S> {
  let to = { x: 0, z: 0 };
  return {
    id: o.id, checkpoint: o.checkpoint, restore: o.restore,
    enter(ctx) {
      to = o.to(ctx);
      env.objective(o.line);
      env.nav.setTarget({ x: to.x, z: to.z, kind: 'mission', label: o.label ?? o.line });
      ctx.step.defer(() => { env.nav.clearTarget('mission'); env.markers[1].hide(); });
      o.enter?.(ctx);
    },
    update(ctx, dt) {
      const r = o.tick?.(ctx, dt);
      if (r && r !== 'run') return r;
      env.blips.push({ kind: 'target', x: to.x, z: to.z });
      const near = Math.hypot(env.pl.position.x - to.x, env.pl.position.z - to.z);
      if (o.corona !== false && near < 250) env.markers[1].show(to.x, to.z, '#ffc21f', (o.r ?? 6) / 2.1); else env.markers[1].hide();
      const slow = !o.stop || (env.pl.mode === 'driving' ? env.v.car.speed < 3 : true);
      return near < (o.r ?? 6) && slow ? 'done' : 'run';
    },
  };
}

/** Enemy cars coming at the player until all are wrecked, or none within `lose` m for `hold` s. */
export class Gang {
  readonly cars: ScriptCar[] = [];
  lostFor = 0;
  constructor(private env: Env) {}
  /** Put up to `n` cars on the road 100-190 m behind the player; returns how many it placed. */
  spawn(make: () => ScriptCar, n: number, top = 30): number {
    const env = this.env, g = env.tr.graph, P = env.pl.position, car = env.v.car;
    const fx = car.fwd.x, fz = car.fwd.z, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let placed = 0;
    const ids = g.near(P.x, P.z, 200);
    for (let attempt = 0; attempt < 400 && placed < n; attempt++) {
      const l = g.links[ids[Math.floor(Math.random() * ids.length)]];
      if (!l || l.len < 20 || l.hmax > 0.3 || ['service', 'living_street', 'footway'].includes(l.cls)) continue;
      const s = 5 + Math.random() * (l.len - 10);
      g.at(l, s, g.laneOffset(l, 0), at);
      const dx = at.x - P.x, dz = at.z - P.z, d = Math.hypot(dx, dz);
      if (d < 100 || d > 190 || (dx * fx + dz * fz) / d > -0.2) continue;
      if (this.cars.some((c) => c.on && Math.hypot(c.car.pos.x - at.x, c.car.pos.z - at.z) < 12)) continue;
      const sc = make();
      sc.place(at.x, at.z, Math.atan2(at.dx, at.dz));
      sc.chase(env.nav, () => { const c = env.v.car; return { x: c.pos.x, z: c.pos.z, vx: c.vel.x, vz: c.vel.z }; }, { ram: true, top });
      sc.car.setMoving(12);
      this.cars.push(sc); env.cars.add(sc);
      placed++;
    }
    this.lostFor = 0;
    return placed;
  }
  /** Each frame: blips; 'done' once every car is wrecked or the player is clear of them for `hold` s. */
  update(dt: number, lose = 220, hold = 6): 'run' | 'done' {
    const env = this.env, P = env.pl.position;
    let alive = 0, near = 0;
    for (const c of this.cars) {
      if (!c.on) continue;
      if (c.wreck >= 0) continue;
      alive++;
      const d = Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z);
      if (d < lose) near++;
      env.blips.push({ kind: 'suspect', x: c.car.pos.x, z: c.car.pos.z, heading: Math.atan2(c.car.fwd.x, c.car.fwd.z), flash: true });
    }
    this.lostFor = near ? 0 : this.lostFor + dt;
    return !alive || this.lostFor >= hold ? 'done' : 'run';
  }
  get wrecked(): number { return this.cars.filter((c) => c.wreck >= 0).length; }
  remove(): void { for (const c of this.cars) { c.remove(); this.env.cars.delete(c); } this.cars.length = 0; }
}
