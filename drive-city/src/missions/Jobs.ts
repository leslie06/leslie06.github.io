import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, NavApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import { nearestKerb, type Kerb } from '../people/Pavement';
import type { TrafficApi } from '../traffic';
import type { Vehicle } from '../vehicle/Vehicle';
import { Marker } from './Marker';
import { pickAddress, type Stop } from './Address';

/**
 * Short jobs with a Beijing flavour, GTA style: drive into a glowing marker and a 2-4 minute job
 * starts. Three of them stand within a couple of hundred metres of the spawn, so a phone session
 * of five minutes holds a whole one:
 *
 *   外卖限时  three deliveries in a row, each on a clock; a crash spills the food and costs money.
 *   胡同追车  a car bolts through the side streets ignoring the lights; ram it or box it to a stop.
 *   绕开二环  a loop of checkpoints round the block against the clock: find the short way.
 *
 * The fares (index.ts) stand aside while a job runs, and take over again when it ends.
 */
export interface Place { x: number; z: number; zh: string; en: string; kerb?: Kerb | null }
export interface JobDeps { places: Place[]; resolve(p: Place): Kerb | null; addCash(n: number): void; toast(s: string): void; rnd(): number }

type Kind = 'delivery' | 'chase' | 'trial';
interface Post { kind: Kind; x: number; z: number; marker: Marker; cooldown: number }

const COLOR: Record<Kind, string> = { delivery: '#ff8a3d', chase: '#ff4d4d', trial: '#5fd1ff' };
const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export class Jobs {
  private posts: Post[] = [];
  private readonly target: Marker;
  private active: Kind | null = null;
  private t = 0; private limit = 0;
  // delivery
  private stops: Stop[] = []; private idx = 0; private spillT = 0; private spent = 0; private earned = 0;
  // chase
  private runner: { car: Vehicle; release(): void } | null = null;
  private hits = 0; private stillT = 0; private hitT = 0; private aimT = 0;
  // trial
  private par = 0;
  private hintT = 0;
  private readonly blips: Blip[] = [];
  objective: string | null = null;

  constructor(private engine: Engine, private deps: JobDeps) {
    this.target = new Marker(engine.scene);
    const w = engine.get<WorldApi>('world')!;
    // The posts stand on side streets within a few hundred metres of the spawn, well apart. The
    // spawn itself is on 建国门外大街, where every destination is a 2 km detour round the one-ways;
    // the jobs live in the grid of two-way streets beside it.
    const taken: Stop[] = [];
    for (const kind of ['delivery', 'chase', 'trial'] as Kind[]) {
      const k = this.pickKerb(w.spawn.x, w.spawn.z, 120, 420, taken, 150, false) ?? (() => { const kb = nearestKerb(engine.get<TrafficApi>('traffic')!.graph, w.spawn.x, w.spawn.z, 300, 1.2); return kb ? { x: kb.x, z: kb.z, label: '' } : null; })();
      if (!k) continue;
      taken.push(k);
      const marker = new Marker(engine.scene);
      marker.show(k.x, k.z, COLOR[kind]);
      this.posts.push({ kind, x: k.x, z: k.z, marker, cooldown: 0 });
    }
    engine.events.on('vehicle:impact', ({ strength }) => this.impact(strength));
    engine.events.on('vehicle:reset', () => { if (this.active) this.end(t('job.abort')); });
  }

  get busy(): boolean { return this.active !== null; }
  /** Probes and poses: the posts, and starting one without driving into it. */
  get postList(): { kind: Kind; x: number; z: number; ready: boolean }[] { return this.posts.map((p) => ({ kind: p.kind, x: p.x, z: p.z, ready: p.cooldown <= 0 })); }
  startKind(kind: Kind): boolean { const p = this.posts.find((q) => q.kind === kind); if (!p || this.active) return false; this.start(p); return this.active === kind; }
  get kind(): Kind | null { return this.active; }
  name(kind: Kind): string { return t(`job.${kind}` as 'job.delivery'); }
  /** For the minimap: the posts you can start, the target of the job that is running. */
  provideBlips(): Blip[] {
    this.blips.length = 0;
    for (const p of this.posts) if (p.cooldown <= 0 && !this.active) this.blips.push({ kind: 'target', x: p.x, z: p.z, label: this.name(p.kind) });
    if (this.active === 'chase' && this.runner) { const c = this.runner.car; this.blips.push({ kind: 'car', x: c.pos.x, z: c.pos.z, heading: Math.atan2(c.fwd.x, c.fwd.z), flash: true }); }
    return this.blips;
  }

  private nav(): NavApi | undefined { return this.engine.get<NavApi>('nav'); }
  private player(): PlayerApi { return this.engine.get<PlayerApi>('player')!; }
  private car(): Vehicle { return this.engine.get<VehicleApi>('vehicle')!.car; }

  /**
   * An address on a two-way street a drive of `minR`-`maxR` metres from (x, z): a random kerb on a
   * random named street nearby whose road route fits, at least `apart` metres from every `avoid`.
   * Chained stop to stop, this keeps a job inside the dense grid instead of on the ring roads.
   */
  private pickKerb(x: number, z: number, minR: number, maxR: number, avoid: Stop[], apart = 120, byRoad = true): Stop | null {
    return pickAddress(this.engine.get<TrafficApi>('traffic')!.graph, this.nav(), this.deps.rnd, x, z, minR, maxR, avoid, apart, byRoad);
  }

  private routeLen(x: number, z: number): number {
    const c = this.car();
    return this.nav()?.route(c.pos.x, c.pos.z, NaN, x, z)?.len ?? Math.hypot(x - c.pos.x, z - c.pos.z) * 1.4;
  }

  private aim(s: Stop | null): void {
    if (!s) { this.nav()?.clearTarget('mission'); this.target.hide(); return; }
    this.nav()?.setTarget({ x: s.x, z: s.z, kind: 'mission', label: s.label });
    this.target.show(s.x, s.z, COLOR[this.active ?? 'delivery']);
  }

  private start(post: Post): void {
    const c = this.car();
    if (post.kind === 'delivery') {
      const list: Stop[] = [];
      let px = c.pos.x, pz = c.pos.z;
      for (let i = 0; i < 3; i++) { const k = this.pickKerb(px, pz, 300, 900, list); if (!k) break; list.push(k); px = k.x; pz = k.z; }
      if (list.length < 3) { this.deps.toast(t('job.nowhere')); post.cooldown = 30; return; }
      this.stops = list; this.idx = 0; this.spent = 0; this.earned = 0;
      this.active = 'delivery';
      this.nextStop();
    } else if (post.kind === 'chase') {
      const tr = this.engine.get<TrafficApi>('traffic')!;
      const r = tr.spawnRunner(c.pos.x, c.pos.z, c.fwd.x, c.fwd.z);
      if (!r) { this.deps.toast(t('job.nowhere')); post.cooldown = 30; return; }
      this.runner = r; this.hits = 0; this.stillT = 0; this.aimT = 0;
      this.active = 'chase'; this.t = 0; this.limit = 150;
      this.aim({ x: r.car.pos.x, z: r.car.pos.z, label: t('job.chaseTarget') });
      this.target.hide();
    } else {
      // Four checkpoints chained through the side streets, then back here.
      const ring: Stop[] = [];
      let qx = c.pos.x, qz = c.pos.z;
      for (let i = 0; i < 4; i++) { const k = this.pickKerb(qx, qz, 200, 700, [...ring, { x: post.x, z: post.z, label: '' }], 140); if (!k) break; ring.push(k); qx = k.x; qz = k.z; }
      if (ring.length < 3) { this.deps.toast(t('job.nowhere')); post.cooldown = 30; return; }
      this.stops = [...ring, { x: post.x, z: post.z, label: t('job.finish') }]; this.idx = 0;
      let len = 0, px = c.pos.x, pz = c.pos.z;
      for (const s of this.stops) { len += this.nav()?.route(px, pz, NaN, s.x, s.z)?.len ?? Math.hypot(s.x - px, s.z - pz) * 1.4; px = s.x; pz = s.z; }
      this.par = len / 8 + 30;
      this.active = 'trial'; this.t = 0; this.limit = this.par * 2;
      this.aim(this.stops[0]);
    }
    post.cooldown = 999;
    this.deps.toast(t('job.go', { name: this.name(post.kind) }));
  }

  private nextStop(): void {
    const s = this.stops[this.idx];
    // Generous: a phone player in traffic averages 25-30 km/h, and the clock is the fun, not the fail.
    this.t = 0; this.limit = this.routeLen(s.x, s.z) / 7 + 40;
    this.aim(s);
  }

  private end(msg: string | null): void {
    if (msg) this.deps.toast(msg);
    if (this.runner) { this.runner.release(); this.runner = null; }
    this.active = null; this.objective = null;
    this.aim(null);
    for (const p of this.posts) if (p.cooldown > 100) p.cooldown = 45;
  }

  private impact(strength: number): void {
    if (!this.active || this.player().mode !== 'driving') return;
    if (this.active === 'delivery' && strength >= 5 && this.spillT <= 0) {
      this.spillT = 5; this.spent += 10; this.deps.addCash(-10); this.deps.toast(t('job.spilled'));
    } else if (this.active === 'chase' && this.runner && this.hitT <= 0) {
      const c = this.car(), r = this.runner.car;
      if (Math.hypot(c.pos.x - r.pos.x, c.pos.z - r.pos.z) < 6.5 && strength >= 3) { this.hits++; this.hitT = 0.6; this.deps.toast(t('job.chaseHit', { n: this.hits })); }
    }
  }

  fixedUpdate(dt: number): void {
    this.spillT -= dt; this.hitT -= dt; this.hintT -= dt;
    for (const p of this.posts) { if (p.cooldown > 0 && p.cooldown < 100) p.cooldown -= dt; p.marker.update(dt); }
    this.target.update(dt);
    const pl = this.player(), pos = pl.position, c = this.car();
    if (!this.active) {
      // Drive (or walk) into a post to start it.
      for (const p of this.posts) {
        if (p.cooldown > 0) continue;
        const d = Math.hypot(pos.x - p.x, pos.z - p.z);
        if (d < 30 && this.hintT <= 0) { this.hintT = 12; this.deps.toast(t('job.hint', { name: this.name(p.kind) })); }
        if (d < 4.5 && (pl.mode !== 'driving' || c.speed < 6)) { this.start(p); break; }
      }
      return;
    }
    this.t += dt;
    const left = this.limit - this.t;
    if (this.active === 'delivery') {
      const s = this.stops[this.idx];
      this.objective = t('job.deliverTo', { place: s.label, i: this.idx + 1, n: this.stops.length, time: fmt(left) });
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d < 7 && c.speed < 6) {
        const pay = 60 + Math.round(Math.max(0, left) * 0.5);
        this.earned += pay; this.deps.addCash(pay); this.deps.toast(t('job.delivered', { n: pay }));
        if (++this.idx >= this.stops.length) { const bonus = 80; this.deps.addCash(bonus); this.end(t('job.done', { n: this.earned + bonus })); }
        else this.nextStop();
      } else if (left <= 0) this.end(t('job.late'));
    } else if (this.active === 'chase') {
      const r = this.runner!.car;
      const d = Math.hypot(c.pos.x - r.pos.x, c.pos.z - r.pos.z);
      this.objective = t('job.chaseGo', { time: fmt(left), hits: this.hits });
      this.stillT = d < 8 && r.speed < 2.5 && pl.mode === 'driving' ? this.stillT + dt : 0;
      if ((this.aimT -= dt) <= 0) { this.aimT = 0.5; this.nav()?.setTarget({ x: r.pos.x, z: r.pos.z, kind: 'mission', label: t('job.chaseTarget') }); }
      if (this.stillT > 1.5 || this.hits >= 3) { this.deps.addCash(300); this.end(t('job.chaseWin', { n: 300 })); }
      else if (left <= 0 || (this.t > 30 && d > 800)) this.end(t('job.chaseLost'));
    } else {
      const s = this.stops[this.idx];
      this.objective = t('job.checkpoint', { i: this.idx + 1, n: this.stops.length, time: fmt(this.t), par: fmt(this.par) });
      if (Math.hypot(pos.x - s.x, pos.z - s.z) < 11) {
        if (++this.idx >= this.stops.length) {
          const under = this.par - this.t;
          const pay = under > 0 ? 200 + Math.round(under) : 80;
          this.deps.addCash(pay);
          this.end(t(under > 0 ? 'job.trialWin' : 'job.trialSlow', { time: fmt(this.t), n: pay }));
        } else this.aim(this.stops[this.idx]);
      } else if (this.t > this.limit) this.end(t('job.late'));
    }
  }
}
