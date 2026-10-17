import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import { shotMode } from '../debug/ShotMode';
import type { Actor, CameraApi, CombatApi, HudApi, PeopleApi, PlayerApi } from '../game/Contracts';
import { t } from '../core/I18n';
import { randomLook, type Look } from '../character/Body';
import { castModel, CAST_ON, hasModel } from '../character/Cast';
import { STRIKE, type StrikeAction } from '../character/Animator';
import { Brain, TOUGH, type Tough } from './Brain';
import { BLOCK, COMBO, COUNTER, Combo, FINISH, LUNGE, STAND_OFF, inReach, pickTarget, softened, timing } from './Moves';
import { CombatHud } from './Hud';

/**
 * Fist fights on foot (2026-10-12, 「徒步近战」, docs/gta-plan.md step 2; the design in docs/melee.md). Gang members
 * are scripted people (people/ `spawnActor`) that this system moves (`Actor.puppet`) by a `Brain` each: a ring
 * round the player, one at a time closing in, winding up (the counter window: a red mark over them), striking.
 * The player's attack (mouse, E, pad B) runs a combo - jab, cross, hook, kick - at whoever is nearest the way they
 * push, stepping in to reach; the counter (Q, right mouse, pad LB) catches one winding up with an uppercut that
 * always lands, or blocks. A blow stuns, the kick and the counter put them down, at no health they stay down.
 * One reeling (or at half health) with a car or a wall just behind him is kicked into it instead: the finisher
 * (环境处决, `FINISH`), out at once - a gold mark over him says so.
 * Knocking a gang member over is no crime (`Actor.fair`); people/ still lets cars knock them flying.
 */

interface Fighter {
  brain: Brain;
  actor: Actor;
  /** The brawl it belongs to. */
  brawl: Brawl;
  /** KO'd: seconds since (cleared away later, out of view). */
  koT: number;
  /** Seconds left stepping round something in the way, and which way round (+1 / -1, 0: not chosen). */
  detour: number; side: number;
}
interface Brawl {
  fighters: Fighter[];
  resolve: (r: 'won' | 'lost' | 'fled') => void;
  over: boolean;
  /** Seconds since everyone went down (the win is called a beat later). */
  wonT: number;
}
/** A blow the player threw, landing at `at` seconds into the move (`fin`: a finisher, into a car or a wall). */
interface Pending { f: Fighter; t: number; at: number; dmg: number; knock: boolean; counter: boolean; action: StrikeAction; fin: Finish | null }
/** What a fighter would be kicked into: the way from the player through him, the surface, and its body (a car's). */
interface Finish { dx: number; dz: number; kind: 'car' | 'wall'; dist: number; body: import('@dimforge/rapier3d-compat').RigidBody | null }

const GANG_TOP = ['#141416', '#1b1c1f', '#23201c', '#2a2d33', '#3a1414'];
const GANG_PANTS = ['#121214', '#1a1b1e', '#22252b'];
/** The gang's models (scripts/characters/cast.json), if built; else the crowd's body in black. */
const THUGS = ['thug1', 'thug2', 'thug3'];

export async function install(engine: Engine): Promise<void> {
  const people = engine.get<PeopleApi>('people');
  const player = engine.get<PlayerApi>('player');
  if (!people?.spawnActor || !player) return;
  const rng = new Rng(4711);
  const rnd = () => rng.next();
  const fighters: Fighter[] = [];
  const brawls: Brawl[] = [];
  const combo = new Combo();
  let pending: Pending | null = null;
  let clock = 0;
  let engagedNow = false;
  const hud = new CombatHud(engine);
  // as the level (not a person): a chassis' filter leaves people out, so a PED ray would pass through every car
  const slamGroups = groups(CG.WORLD, CG.WORLD | CG.CAR);
  /** The one fighter a press would finish now (with what behind him), refreshed each fixed step. */
  let fin: { f: Fighter; s: Finish } | null = null;
  let finHinted = false;
  // Which thugs have a model: known once the cast list has come (not awaited here - the boot waited 9 s for this
  // 2 KB on a slow link, 2026-10-17); a fight before that dresses its thugs in the crowd's bodies.
  let thugModels: string[] = [];
  if (CAST_ON) void Promise.all(THUGS.map((id) => hasModel(id))).then((ok) => { thugModels = THUGS.filter((_, i) => ok[i]); });

  const gangLook = (): Look => {
    const l = randomLook(rnd);
    const C = (a: string[]) => new THREE.Color(a[Math.floor(rnd() * a.length)]);
    return { ...l, fem: 0, age: 0.25 + rnd() * 0.3, top: rnd() < 0.6 ? 'jacket' : 'tee', shirt: C(GANG_TOP), inner: C(GANG_TOP), sleeve: 0.53,
      bottom: 'trousers', hem: 0.8, pants: C(GANG_PANTS), hairStyle: rnd() < 0.6 ? 'buzz' : 'short', build: 0.35 + rnd() * 0.4, glasses: false, cap: null, mask: null, print: false } as Look;
  };

  const feet = () => player.foot;
  const standing = () => fighters.filter((f) => f.brain.standing);
  const near = (f: Fighter, r: number) => { const ft = feet(); return !!ft && Math.hypot(f.brain.x - ft.pos.x, f.brain.z - ft.pos.z) < r; };
  /** A car or a wall within FINISH.back behind `f`, seen from (px, pz), at waist and chest height (a bonnet is low). */
  const surfaceBehind = (f: Fighter, px: number, pz: number): Finish | null => {
    const dx = f.brain.x - px, dz = f.brain.z - pz, d = Math.hypot(dx, dz);
    if (d < 0.3) return null;
    const ux = dx / d, uz = dz / d, y = f.actor.pos.y;
    // straight back at waist and chest height, and a little either side (a post, a tree trunk)
    for (const [h, a] of [[0.75, 0], [1.15, 0], [1, 0.17], [1, -0.17]]) {
      const c = Math.cos(a), sn = Math.sin(a), rx = ux * c - uz * sn, rz = ux * sn + uz * c;
      const hit = engine.physics.raycast({ x: f.brain.x, y: y + h, z: f.brain.z }, { x: rx, y: 0, z: rz }, FINISH.back, slamGroups, true);
      if (!hit) continue;
      const car = hit.userData?.tag === 'car';
      // a wall leaning well off square (a kerb's edge, a slope) is no wall to slam into; a car's flanks curve in
      if (!car && Math.abs(hit.normal[1]) > 0.5) continue;
      return { dx: rx, dz: rz, kind: car ? 'car' : 'wall', dist: hit.distance, body: car ? hit.collider.parent() : null };
    }
    return null;
  };

  /** A blow on a fighter: stunned, put down (`knock`: thrown along (dx, dz)), or out. */
  const land = (f: Fighter, dmg: number, knock: boolean, dx: number, dz: number, power: number) => {
    const b = f.brain;
    const r = b.hit(dmg, knock);
    engine.events.emit('combat:hit', { x: b.x, z: b.z, power, blocked: false, toPlayer: false });
    const d = Math.hypot(dx, dz) || 1;
    if (r === 'ko' || knock) {
      f.actor.downFor = r === 'ko' ? 1e9 : 1.4 + rnd() * 0.9;
      f.actor.fall(dx / d * (r === 'ko' ? 4.2 : 3.4), dz / d * (r === 'ko' ? 4.2 : 3.4));
      if (r !== 'ko') b.knocked();
      if (r === 'ko') { f.koT = 0; engine.events.emit('combat:ko', { x: b.x, z: b.z }); }
    }
    if (!shotMode) engine.hitStop(r === 'ko' ? 160 : knock ? 110 : 55);
    engine.get<CameraApi>('camera')?.shake(r === 'ko' || knock ? 0.5 : 0.22);
  };

  /**
   * The finisher landing: out at once, kicked flying back into the car or the wall (people/ stops the body against it);
   * the crash - the car rocking, the clang, a long hit-stop and a heavy shake - when he gets there.
   */
  const slamInto = (f: Fighter, s: Finish) => {
    const b = f.brain;
    b.hit(FINISH.dmg, true);
    f.koT = 0;
    f.actor.downFor = 1e9;
    const speed = Math.max(3.2, Math.min(8, s.dist * 2.2 + 1));
    f.actor.fall(s.dx * speed, s.dz * speed);
    slams.push({ t: Math.max(0, (s.dist - 0.35) / speed), x: b.x + s.dx * s.dist, z: b.z + s.dz * s.dist, y: f.actor.pos.y + 1, s });
    engine.events.emit('combat:hit', { x: b.x, z: b.z, power: 1, blocked: false, toPlayer: false });
    engine.events.emit('combat:ko', { x: b.x, z: b.z });
    finishers++;
    if (!shotMode) engine.hitStop(120);
    engine.get<CameraApi>('camera')?.shake(0.4);
  };
  /** Finishers in flight: seconds to the crash, where it is. */
  const slams: { t: number; x: number; z: number; y: number; s: Finish }[] = [];
  const crash = (c: (typeof slams)[number]) => {
    const s = c.s;
    if (s.body && s.body.isDynamic()) {
      const m = s.body.mass();
      s.body.applyImpulseAtPoint({ x: s.dx * m * 0.45, y: m * 0.12, z: s.dz * m * 0.45 }, { x: c.x, y: c.y, z: c.z }, true);
    }
    engine.events.emit('combat:finisher', { x: c.x, z: c.z, kind: s.kind });
    if (!shotMode) engine.hitStop(300);
    engine.get<CameraApi>('camera')?.shake(0.9);
  };
  let finishers = 0;

  const api: CombatApi = {
    name: 'combat',
    get engaged() { return engagedNow; },
    get finishers() { return finishers; },

    attack() {
      const ft = feet();
      if (!ft || !engagedNow) return false;
      const st = standing();
      // the way the player pushes (camera-relative stick), else the way they face
      const inp = engine.input.state, cam = new THREE.Vector3();
      engine.camera.getWorldDirection(cam);
      const my = inp.forward - inp.back, mx = inp.steer;
      let dirX = Math.sin(ft.yaw), dirZ = Math.cos(ft.yaw);
      if (Math.hypot(mx, my) > 0.2) { const cy = Math.atan2(cam.x, cam.z), fx = Math.sin(cy), fz = Math.cos(cy); dirX = fx * my - fz * mx; dirZ = fz * my + fx * mx; }
      const i = pickTarget(ft.pos.x, ft.pos.z, dirX, dirZ, st.map((f) => f.brain));
      const picked = i >= 0 ? st[i] : null;
      // the one marked for a finisher, if the press goes his way (or nobody else is closer to it)
      const slam = fin && (picked === fin.f || !picked) ? fin : null;
      const k = combo.next(clock), m = slam ? { action: FINISH.action, dmg: FINISH.dmg, knock: true } : COMBO[k], tm = timing(m.action);
      const target = slam ? slam.f : picked;
      let yaw = Math.atan2(dirX, dirZ), lunge = 0;
      if (target) {
        const dx = target.brain.x - ft.pos.x, dz = target.brain.z - ft.pos.z, d = Math.hypot(dx, dz);
        yaw = Math.atan2(dx, dz); lunge = Math.max(0, Math.min(LUNGE, d - STAND_OFF));
      }
      if (!player.strike?.(m.action, tm.secs, yaw, lunge, tm.chainFrom)) return true;   // mid-move: swallowed, not a shove
      if (slam) combo.reset(); else combo.started(k, clock);
      engine.events.emit('combat:swing', { x: ft.pos.x, z: ft.pos.z, heavy: m.knock });
      pending = target ? { f: target, t: 0, at: tm.hit, dmg: m.dmg, knock: m.knock, counter: false, action: m.action, fin: slam?.s ?? null } : null;
      return true;
    },

    counter() {
      const ft = feet();
      if (!ft || !engagedNow) return false;
      // the nearest one winding up (or just swinging) within reach of a step
      let best: Fighter | null = null, bd = 3.4;
      for (const f of fighters) {
        if (!(f.brain.telegraph || (f.brain.state === 'strike' && f.brain.t < STRIKE[f.brain.strike].hit))) continue;
        const d = Math.hypot(f.brain.x - ft.pos.x, f.brain.z - ft.pos.z);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        const dx = best.brain.x - ft.pos.x, dz = best.brain.z - ft.pos.z, tm = timing(COUNTER.action);
        if (!player.strike?.(COUNTER.action, tm.secs, Math.atan2(dx, dz), Math.max(0, Math.min(LUNGE, bd - STAND_OFF)), 0)) return false;
        best.brain.countered();   // its blow will not land
        combo.reset();
        pending = { f: best, t: 0, at: tm.hit, dmg: COUNTER.dmg, knock: true, counter: true, action: COUNTER.action, fin: null };
        engine.events.emit('combat:counter', { x: best.brain.x, z: best.brain.z });
        engine.events.emit('combat:swing', { x: ft.pos.x, z: ft.pos.z, heavy: true });
        if (!shotMode) engine.hitStop(240);
        return true;
      }
      return !!player.strike?.('block', BLOCK.secs, ft.yaw, 0, 0.25);
    },

    brawl(x, z, n, opts) {
      let resolve: (r: 'won' | 'lost' | 'fled') => void = () => {};
      const done = new Promise<'won' | 'lost' | 'fled'>((r) => { resolve = r; });
      const b: Brawl = { fighters: [], resolve, over: false, wonT: 0 };
      const tough: Tough = { ...TOUGH, hp: TOUGH.hp * (opts?.tough ?? 1), dmg: TOUGH.dmg * Math.sqrt(opts?.tough ?? 1), windup: TOUGH.windup / Math.sqrt(opts?.tough ?? 1) };
      for (let i = 0; i < n; i++) {
        // spread round (x, z), each spot in the open (a ray from the middle reaches it)
        let sx = x, sz = z;
        for (let k = 0; k < 8; k++) {
          const a = (i / n) * Math.PI * 2 + rnd() * 0.8 + k * 0.7, r = 1.5 + rnd() * 2.5;
          const tx = x + Math.sin(a) * r, tz = z + Math.cos(a) * r;
          const hit = engine.physics.raycast({ x, y: 1, z }, { x: (tx - x) / r, y: 0, z: (tz - z) / r }, r + 0.5, slamGroups, true);
          if (!hit) { sx = tx; sz = tz; break; }
        }
        const look = gangLook();
        const actor = people.spawnActor!(sx, sz, { look, yaw: rnd() * 6.28, seed: rnd() });
        if (!actor) continue;
        actor.fair = true;
        const f: Fighter = { brain: new Brain(sx, sz, tough), actor, brawl: b, koT: -1, detour: 0, side: 0 };
        b.fighters.push(f); fighters.push(f);
        if (thugModels.length) {
          const id = thugModels[(fighters.length - 1) % thugModels.length];
          void castModel(engine, id, look).then((h) => { if (actor.alive) actor.model = h; else h.hide(); }).catch(() => {});
        }
      }
      brawls.push(b);
      const end = () => { if (!b.over) finish(b, 'fled'); };
      return { done, end, actors: b.fighters.map((f) => f.actor) };
    },

    fixedUpdate(dt) {
      for (let i = slams.length - 1; i >= 0; i--) if ((slams[i].t -= dt) <= 0) { crash(slams[i]); slams.splice(i, 1); }
      if (!fighters.length) { engagedNow = false; return; }
      clock += dt;
      const ft = feet();
      const px = ft ? ft.pos.x : player.position.x, pz = ft ? ft.pos.z : player.position.z;
      // the attack token: one at a time (two once four or more are up)
      const st = standing();
      const attackers = st.filter((f) => f.brain.attacking).length;
      const room = (st.length >= 4 ? 2 : 1) - attackers;
      let grant: Fighter | null = null;
      if (room > 0 && ft) {
        let bd = Infinity;
        for (const f of st) if (f.brain.ready) { const d = Math.hypot(f.brain.x - px, f.brain.z - pz) + rnd() * 1.5; if (d < bd) { bd = d; grant = f; } }
      }
      for (const f of fighters) {
        const b = f.brain, a = f.actor;
        if (!a.alive) continue;
        // people/ has it down (a blow, a car) or up again
        if (a.state === 'down') { b.x = a.pos.x; b.z = a.pos.z; if (b.standing && b.state !== 'down') b.knocked(); continue; }
        if (b.state === 'down') b.up();
        if (b.state === 'ko') { b.x = a.pos.x; b.z = a.pos.z; continue; }
        const ox = b.x, oz = b.z;
        const others = fighters.filter((o) => o !== f && o.brain.standing).map((o) => o.brain);
        const out = b.step({ px, pz, others, token: f === grant || b.attacking }, dt);
        // walls and cars: a step into one is not taken; blocked, a fighter steps sideways round it (across the line to
        // the player, one way, the other if that is blocked too) for a moment, so they work round a car rather than
        // stand behind it (a PED ray passes through cars: they walked through the SUVs)
        const mx = b.x - ox, mz = b.z - oz, ml = Math.hypot(mx, mz);
        if (ml > 1e-4) {
          const y = a.pos.y + 0.9, clear = (dx: number, dz: number, l: number) => !engine.physics.raycast({ x: ox, y, z: oz }, { x: dx / l, y: 0, z: dz / l }, l + 0.45, slamGroups, true);
          let go = f.detour <= 0 && clear(mx, mz, ml);
          if (!go) {
            b.x = ox; b.z = oz;
            if (f.detour <= 0) { f.detour = 0.9; f.side = f.side || (fighters.indexOf(f) % 2 ? 1 : -1); }
            const tx = px - ox, tz = pz - oz, tl = Math.hypot(tx, tz) || 1, sp = Math.max(ml, 1.6 * dt);
            for (let k = 0; k < 2; k++) {
              const sx = -tz / tl * f.side * sp, sz = tx / tl * f.side * sp;
              if (clear(sx, sz, sp)) { b.x = ox + sx; b.z = oz + sz; go = true; break; }
              f.side = -f.side;
            }
          }
          f.detour -= dt;
        }
        a.puppet?.({ x: b.x, z: b.z, yaw: b.yaw, speed: b.speed });
        a.act(b.action, { t: b.actionT });
        if (out.landed && ft && player.mode === 'onfoot') {
          const blocking = player.move?.action === 'block';
          const dmg = b.tough.dmg * (blocking ? BLOCK.through : 1) * (0.85 + rnd() * 0.3);
          player.hurt(dmg);
          if (!blocking) player.struck?.(b.x, b.z, false);
          engine.events.emit('combat:hit', { x: px, z: pz, power: blocking ? 0.3 : 0.7, blocked: blocking, toPlayer: true });
          engine.get<CameraApi>('camera')?.shake(blocking ? 0.12 : 0.35);
        }
      }
      // the player's blow lands when the fist is out, if they are still in reach and it was not cut short
      if (pending) {
        const p = pending;
        p.t += dt;
        if (player.move?.action !== p.action) pending = null;
        else if (p.t >= p.at) {
          pending = null;
          if (ft && p.f.brain.standing && inReach(ft.pos.x, ft.pos.z, ft.yaw, p.f.brain.x, p.f.brain.z, p.counter || p.fin ? 2.2 : undefined)) {
            if (p.fin) slamInto(p.f, p.fin);
            else land(p.f, p.dmg, p.knock, p.f.brain.x - ft.pos.x, p.f.brain.z - ft.pos.z, p.counter ? 1 : p.knock ? 0.85 : 0.5);
          }
        }
      }
      // the brawls: won (everyone out), lost (wasted), fled (60 m off)
      for (const b of brawls) {
        if (b.over) continue;
        if (b.fighters.every((f) => f.brain.state === 'ko' || !f.actor.alive)) { b.wonT += dt; if (b.wonT > 1.2) finish(b, 'won'); }
        else if (player.health <= 0) finish(b, 'lost');
        else if (b.fighters.every((f) => !f.actor.alive || f.brain.state === 'ko' || Math.hypot(f.brain.x - px, f.brain.z - pz) > 60)) finish(b, 'fled');
      }
      // the KO'd are cleared away once out of view or after a while
      const cam = engine.camera.position;
      for (let i = fighters.length - 1; i >= 0; i--) {
        const f = fighters[i];
        if (f.koT >= 0) f.koT += dt;
        const gone = !f.actor.alive || (f.brawl.over && (f.koT > 30 || Math.hypot(f.actor.pos.x - cam.x, f.actor.pos.z - cam.z) > 70));
        if (gone) { if (f.actor.alive) f.actor.release(f.brain.state === 'ko' ? 'vanish' : 'walk'); fighters.splice(i, 1); }
      }
      engagedNow = !!ft && fighters.some((f) => f.brain.standing && near(f, 14));
      // the finisher on offer: the nearest softened fighter within reach of a lunge with a surface behind him
      fin = null;
      if (engagedNow && ft && player.mode === 'onfoot') {
        let bd = 3.2;
        for (const f of fighters) {
          if (!f.brain.standing || f.actor.state !== 'script' || !softened(f.brain.state, f.brain.hp, f.brain.tough.hp)) continue;
          const d = Math.hypot(f.brain.x - px, f.brain.z - pz);
          if (d >= bd) continue;
          const s = surfaceBehind(f, px, pz);
          if (s) { bd = d; fin = { f, s }; }
        }
        if (fin && !finHinted) { finHinted = true; engine.get<HudApi>('hud')?.toast(t(document.body.classList.contains('dc-touch') ? 'combat.finHintTouch' : 'combat.finHint')); }
      }
    },

    update() {
      hud.draw(fighters.map((f) => ({ x: f.actor.pos.x, y: f.actor.pos.y, z: f.actor.pos.z, hp: f.brain.hp / f.brain.tough.hp, warn: f.brain.telegraph, fin: fin?.f === f ? fin.s.kind : null, standing: f.brain.standing && f.actor.state === 'script' })), engagedNow);
    },
  };

  const finish = (b: Brawl, r: 'won' | 'lost' | 'fled') => {
    b.over = true;
    for (const f of b.fighters) {
      if (!f.actor.alive) continue;
      if (f.brain.state !== 'ko') { f.actor.puppet?.(null); f.actor.act(null); f.actor.release(r === 'fled' ? 'walk' : 'flee'); }
    }
    b.resolve(r);
  };

  (api as CombatApi & { debug: object }).debug = {
    /** `n` gang members 6 m in front of the player. */
    brawl: (n = 3, tough = 1) => { const p = player.position, ft = player.foot, yaw = ft?.yaw ?? 0; return api.brawl(p.x + Math.sin(yaw) * 6, p.z + Math.cos(yaw) * 6, n, { tough }); },
    /** Each fighter: soft enough for a finisher, and what is behind him from the player (whatever his state). */
    slamCheck: () => { const ft = feet(); return fighters.map((f) => ({ soft: softened(f.brain.state, f.brain.hp, f.brain.tough.hp), d: ft ? +Math.hypot(f.brain.x - ft.pos.x, f.brain.z - ft.pos.z).toFixed(2) : -1, behind: ft ? surfaceBehind(f, ft.pos.x, ft.pos.z)?.kind ?? null : null })); },
    fighters: () => fighters.map((f) => ({ state: f.brain.state, hp: Math.round(f.brain.hp), x: +f.brain.x.toFixed(2), z: +f.brain.z.toFixed(2), actor: f.actor.state, model: !!f.actor.model, fin: fin?.f === f ? fin.s.kind : null })),
  };
  engine.add(api);
}
