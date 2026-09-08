import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * Acceptance test for: "I killed everyone and the next wave never started."
 *
 * The wave director's only clear condition is `aliveCount() === 0`, so a single soldier the level
 * has swallowed ends the run — the player clears everything they can find and the game sits in
 * `wave` phase forever with nothing left to shoot. Two ways that used to happen:
 *
 *   - he falls through the world. `Enemy.move` clamped y back to `bounds.min.y + 1`, which parks
 *     him a metre under the map, alive and unreachable, rather than killing him.
 *   - he is wedged in geometry he cannot walk out of. The AI's own `stuckTimer` cannot see this:
 *     it fires a detour at 0.9 s and zeroes the counter, so it never accumulates.
 *
 * And a third, which no watchdog can catch because nothing is wrong with the soldier at all: he
 * spawned in a far corner and never learned there is a fight. Sight and hearing are 70 m, the squad
 * radius is 55 m, and the map's corners are ~100 m apart, so he can legitimately patrol out the
 * whole wave — and the wave ends only when he dies. That one is fixed at the director: once a wave
 * stops deploying it points every survivor at the player (GameMode.huntPlayer).
 *
 * The test drives a real session (no `?shot=1` — that freezes the spawn director, which is half of
 * what is under test), holds one soldier under the map and one in a far corner, kills every other
 * soldier on sight, and asserts the wave still reaches its breather.
 *
 * Needs the dev server (`npx vite --port 5180`, usually already running — see CLAUDE.md).
 */

const ORIGIN = 'http://127.0.0.1:5180';
/** Simulated seconds the director gets to deploy wave 1 and declare it clear. */
const WINDOW = 60;

interface Probe {
  done: boolean;
  simTime: number;
  phase: string;
  /** True once the held soldier was written off, i.e. the backstop fired. */
  wedgedDied: boolean;
  /** Simulated time at which that happened. */
  wedgedDiedAt: number;
  /** Alive count on the last tick — the number the director actually gates on. */
  aliveAtEnd: number;
  spawned: number;
  /** The far-corner soldier was told about the player without ever seeing or hearing him. */
  stragglerAlerted: boolean;
  /** His AI state at that moment — 'idle'/'patrol' would mean he was told and ignored it. */
  stragglerState: string;
  stragglerDist: number;
  error?: string;
}

let browser: Browser | undefined;
let probe: Probe;

beforeAll(async () => {
  let alive = false;
  try { alive = (await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { alive = false; }
  if (!alive) throw new Error(`no dev server at ${ORIGIN} — start one with \`npx vite --port 5180\` and re-run`);

  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){}});export function injectQuery(u){return u}export function updateStyle(){}export function removeStyle(){}' }));
  await page.goto(`${ORIGIN}/?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { gunfight?: { get(n: string): unknown } }).gunfight?.get('game'), null, { timeout: 240_000 });

  await page.evaluate((seconds) => {
    interface Vec3 { x: number; y: number; z: number; clone(): Vec3; set(x: number, y: number, z: number): Vec3 }
    interface Ent { id: number; alive: boolean; pos: Vec3; brain: { alerted: boolean; state: string }; die(headshot: boolean, dir: Vec3, point: Vec3): void }
    interface Enemies { enemies: Ent[]; fixedUpdate(dt: number): void; aliveCount(): number; world: { time: number } }
    interface Player { health: number; maxHealth: number; position: Vec3 }
    interface Game { start(): void; phase: string }
    interface Eng { get<T>(n: string): T }
    const w = window as unknown as { gunfight: Eng; __wedgeProbe: Probe };
    const engine = w.gunfight;
    const sys = engine.get<Enemies>('enemies');
    const player = engine.get<Player>('player');
    const game = engine.get<Game>('game');
    const p: Probe = { done: false, simTime: 0, phase: '', wedgedDied: false, wedgedDiedAt: -1, aliveAtEnd: -1, spawned: 0, stragglerAlerted: false, stragglerState: '', stragglerDist: 0 };
    w.__wedgeProbe = p;

    const t0 = sys.world.time;
    let held: Ent | null = null;
    let straggler: Ent | null = null;
    const seen = new Set<number>();
    // Farthest corner from the player, so nothing but the director can reach him: out of squad
    // radius, and with a city between him and any sightline.
    const corner = { x: -34, z: -34 };
    const tick = sys.fixedUpdate.bind(sys);
    sys.fixedUpdate = (dt: number): void => {
      tick(dt);
      if (p.done) return;
      p.simTime = sys.world.time - t0;
      for (const e of sys.enemies) if (!seen.has(e.id)) { seen.add(e.id); p.spawned++; }
      // The first soldier to appear is the one the level "swallows": held under the map for the
      // whole run, exactly as a fall through the floor would leave him.
      if (!held) held = sys.enemies.find((e) => e.alive) ?? null;
      if (held) {
        if (held.alive) held.pos.y = -100;
        else if (!p.wedgedDied) { p.wedgedDied = true; p.wedgedDiedAt = p.simTime; }
      }
      if (!straggler) straggler = sys.enemies.find((e) => e.alive && e !== held) ?? null;
      if (straggler && straggler.alive && !p.stragglerAlerted) {
        // Pinned in the corner: he cannot walk anywhere, so the only way he becomes alerted is
        // being told. Nothing in this test fires a weapon, so `heard` never fires either.
        straggler.pos.set(corner.x, 0, corner.z);
        p.stragglerDist = Math.hypot(player.position.x - corner.x, player.position.z - corner.z);
        if (straggler.brain.alerted) { p.stragglerAlerted = true; p.stragglerState = straggler.brain.state; }
      }
      // Everyone else dies on sight, so the only things that can hold the wave open are the two
      // held soldiers. The straggler is released once he has proved the point.
      for (const e of sys.enemies) {
        if (!e.alive || e === held) continue;
        if (e === straggler && !p.stragglerAlerted) continue;
        e.die(false, e.pos.clone().set(0, 1, 0), e.pos.clone());
      }
      player.health = player.maxHealth;   // this is a test of the director, not of lethality
      p.phase = game.phase;
      p.aliveAtEnd = sys.aliveCount();
      if (game.phase === 'breather' || p.simTime >= seconds) p.done = true;
    };
    game.start();
  }, WINDOW);

  await page.waitForFunction(() => (window as unknown as { __wedgeProbe: { done: boolean } }).__wedgeProbe.done, null, { timeout: 240_000 });
  probe = await page.evaluate(() => (window as unknown as { __wedgeProbe: Probe }).__wedgeProbe);
  if (errors.length) probe.error = errors.join('\n');
  await page.close();
}, 300_000);

afterAll(async () => { await browser?.close(); });

describe('a soldier the level swallowed', () => {
  it('runs a real wave', () => {
    expect(probe.error).toBeUndefined();
    expect(probe.spawned).toBeGreaterThanOrEqual(3);
  });

  it('is written off instead of parked alive under the map', () => {
    expect({ wedgedDied: probe.wedgedDied, at: probe.wedgedDiedAt }).toMatchObject({ wedgedDied: true });
    // The pit case is immediate, not a 25 s wait: falling out of the world is unambiguous.
    expect(probe.wedgedDiedAt).toBeLessThan(5);
  });

  it('tells the far-corner soldier where the player is', () => {
    // Before the fix he patrols his corner for the whole wave: never sees, never hears, never
    // joins, and the wave cannot end because it ends only when he dies.
    expect({ alerted: probe.stragglerAlerted, state: probe.stragglerState, dist: Math.round(probe.stragglerDist) })
      .toMatchObject({ alerted: true });
    expect(['idle', 'patrol']).not.toContain(probe.stragglerState);
  });

  it('does not stop the wave from ending', () => {
    // The failure this test exists for: phase stuck on 'wave' with nothing left the player can reach.
    expect({ phase: probe.phase, alive: probe.aliveAtEnd, simTime: probe.simTime }).toMatchObject({ phase: 'breather' });
    expect(probe.aliveAtEnd).toBe(0);
  });
});
