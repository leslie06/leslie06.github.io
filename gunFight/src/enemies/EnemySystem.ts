/**
 * EnemiesApi implementation: owns every Enemy, the shared world view the brains read, hearing
 * (weapon:fire), squad cover claims, and the nav graph conversion.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { AudioApi, BodyPart, EnemiesApi, EnemyDifficulty, EnemyInfo, FxApi, LevelApi, PlayerApi } from '../game/Contracts';
import { Rng } from '../core/Rng';
import { Enemy } from './Enemy';
import { archetypeOf, ARCHETYPE_ORDER, DIFFICULTY } from './EnemyDefs';
import type { EnemyWorld } from './AI';
import { labelComponents, type NavNode } from './Nav';

export class EnemySystem implements EnemiesApi {
  name = 'enemies';
  enemies: Enemy[] = [];
  private nextId = 1;
  readonly world: EnemyWorld;
  private infos: EnemyInfo[] = [];
  /** ms spent in fixedUpdate + update last frame (perf probe for the harness) */
  lastTickMs = 0;

  constructor(private engine: Engine) {
    this.world = {
      engine, player: undefined, level: undefined, fx: undefined, audio: undefined,
      nav: [], coverNodes: [], bounds: new THREE.Box3(new THREE.Vector3(-60, -5, -60), new THREE.Vector3(60, 40, 60)),
      time: 0, difficulty: { ...DIFFICULTY }, claims: new Map(), enemies: this.enemies, heard: null, lastCallout: -100, rng: new Rng(4242),
    };
    engine.events.on('weapon:fire', (e) => { this.world.heard = { pos: new THREE.Vector3(e.origin[0], e.origin[1], e.origin[2]), time: this.world.time }; });
    engine.events.on('explosion', (e) => { this.world.heard = { pos: new THREE.Vector3(e.position[0], e.position[1], e.position[2]), time: this.world.time }; });
  }

  /** Late-bind other modules (they install after us) and convert the nav graph. */
  private refreshWorld(): void {
    const w = this.world;
    if (!w.player) w.player = this.engine.get<PlayerApi>('player');
    if (!w.fx) w.fx = this.engine.get<FxApi>('fx');
    if (!w.audio) w.audio = this.engine.get<AudioApi>('audio');
    const level = this.engine.get<LevelApi>('level');
    if (level && (level !== w.level || level.navPoints.length !== w.nav.length)) {
      w.level = level;
      w.nav = level.navPoints.map<NavNode>((n) => ({ p: [n.position.x, n.position.y, n.position.z], links: n.links }));
      labelComponents(w.nav);
      w.coverNodes = level.navPoints.filter((n) => n.cover).map((n) => n.position.clone());
      if (level.bounds) w.bounds.copy(level.bounds);
    }
  }

  fixedUpdate(dt: number): void {
    const t0 = performance.now();
    this.refreshWorld();
    this.world.time += dt;
    for (const e of this.enemies) e.fixedUpdate(dt);
    // remove finished ragdolls
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].removeMe) { this.enemies[i].dispose(); this.enemies.splice(i, 1); }
    this.lastTickMs = performance.now() - t0;
  }

  update(dt: number, alpha: number): void {
    const t0 = performance.now();
    for (const e of this.enemies) e.update(dt, alpha);
    this.lastTickMs += performance.now() - t0;
  }

  // ---------------- EnemiesApi ----------------
  list(): EnemyInfo[] {
    this.infos.length = 0;
    for (const e of this.enemies) this.infos.push({ id: e.id, position: e.pos, health: e.health, alive: e.alive, head: e.headPos, state: e.brain.state });
    return this.infos;
  }

  get(id: number): Enemy | undefined { return this.enemies.find((e) => e.id === id); }

  applyDamage(enemyId: number, amount: number, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, part: BodyPart, weaponId: string): number {
    const e = this.get(enemyId);
    if (!e) return 0;
    void weaponId;
    return e.applyDamage(amount, point, normal, dir, part);
  }

  spawn(position: THREE.Vector3, opts?: { archetype?: string }): number {
    this.refreshWorld();
    const id = this.nextId++;
    const arch = archetypeOf(opts?.archetype ?? ARCHETYPE_ORDER[(id - 1) % ARCHETYPE_ORDER.length]);
    const pos = position.clone();
    // drop to the ground: raycast down from the spawn point
    const hit = this.engine.physics.raycast({ x: pos.x, y: pos.y + 1.5, z: pos.z }, { x: 0, y: -1, z: 0 }, 6, 0xffff0001);
    if (hit) pos.y = hit.point[1];
    const e = new Enemy(this.engine, id, arch, pos, this.world);
    this.enemies.push(e);
    this.engine.events.emit('enemy:spawn', { enemyId: id });
    return id;
  }

  killAll(): void {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.world.claims.clear();
  }

  aliveCount(): number { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  applyExplosion(center: THREE.Vector3, radius: number, damage: number): void {
    for (const e of this.enemies) e.applyExplosion(center, radius, damage);
  }

  setDifficulty(d: EnemyDifficulty | number): void {
    const w = this.world.difficulty;
    if (typeof d === 'number') { w.accuracy = d; w.damage = 0.5 + 0.5 * d; w.reaction = 1 / Math.max(0.25, d); w.aggression = d; return; }
    w.accuracy = d.accuracy; w.damage = d.damage; w.reaction = d.reaction; w.aggression = d.aggression;
  }

  dispose(): void { this.killAll(); }
}
