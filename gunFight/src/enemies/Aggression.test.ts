import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * Acceptance test for the bug a player reported as: "I don't know whether I've killed all the
 * enemies, I just stay in the game and the next wave never comes."
 *
 * What that looked like, measured: the squad closed to ~14 m, brushed `engage`, then ran back out
 * to ~27 m and parked. Over 25 seconds four soldiers fired four rounds between them, every one of
 * which missed by roughly the full distance to the player, and a player standing still in the open
 * stayed on 100 HP with nothing to shoot at and a wave that could not end.
 *
 * So this drives a **real session** — no `?shot=1`, because that deliberately freezes the spawn
 * director and this whole class of bug is invisible with the director frozen — starts wave 1, and
 * never touches the player: no input, no teleport, no aim. It then asserts the three things a
 * player would call "the squad is fighting me":
 *
 *   1. someone gets within 10 m,
 *   2. the squad collectively fires more than 20 rounds,
 *   3. the player takes damage.
 *
 * A squad that hides, retreats, or stands at 27 m shooting at nothing fails all three.
 *
 * The window is 25 seconds of *simulated* time (the enemies system's own fixed clock), so the
 * result does not depend on how fast the host renders. The player's health is topped back up after
 * every tick — the damage is recorded first — so a lethal squad cannot end the run early and turn
 * this into a test of lethality rather than of aggression.
 *
 * Needs the dev server (`npx vite --port 5180`, usually already running — see CLAUDE.md).
 */

const ORIGIN = 'http://127.0.0.1:5180';
/** Seconds of simulated time the squad gets to come and find a stationary player. */
const WINDOW = 25;

interface Probe {
  done: boolean;
  simTime: number;
  /** Closest any living enemy came to the player, metres. */
  minDist: number;
  /** Rounds the squad fired (enemy:fire events). */
  shots: number;
  /** Total damage the player took, summed before health was restored. */
  damage: number;
  /** Most enemies alive at once, so a broken spawn director cannot pass this quietly. */
  maxAlive: number;
  /** Distance to the nearest living enemy, sampled once a simulated second. */
  track: number[];
  states: Record<string, number>;
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
  // Vite's HMR client would reload the page mid-run if someone saved a file.
  await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){}});export function injectQuery(u){return u}export function updateStyle(){}export function removeStyle(){}' }));
  await page.goto(`${ORIGIN}/?quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { gunfight?: { get(n: string): unknown } }).gunfight?.get('game'), null, { timeout: 240_000 });

  await page.evaluate((seconds) => {
    interface Vec { x: number; y: number; z: number; distanceTo(o: Vec): number }
    interface Ent { alive: boolean; pos: Vec; brain: { state: string; alerted: boolean } }
    interface Enemies { enemies: Ent[]; fixedUpdate(dt: number): void; aliveCount(): number; world: { time: number } }
    interface Player { position: Vec; health: number; maxHealth: number }
    interface Eng { get<T>(n: string): T; events: { on(k: string, f: (e: unknown) => void): void } }
    const w = window as unknown as { gunfight: Eng; __aiProbe: Probe };
    const engine = w.gunfight;
    const sys = engine.get<Enemies>('enemies');
    const player = engine.get<Player>('player');
    const game = engine.get<{ start(): void }>('game');
    const p: Probe = { done: false, simTime: 0, minDist: Infinity, shots: 0, damage: 0, maxAlive: 0, track: [], states: {} };
    w.__aiProbe = p;
    engine.events.on('enemy:fire', () => { p.shots++; });

    const t0 = sys.world.time;
    let nextSample = 1;
    const tick = sys.fixedUpdate.bind(sys);
    sys.fixedUpdate = (dt: number): void => {
      tick(dt);
      if (p.done) return;
      p.simTime = sys.world.time - t0;
      let nearest = Infinity;
      for (const e of sys.enemies) {
        if (!e.alive) continue;
        nearest = Math.min(nearest, e.pos.distanceTo(player.position));
        p.states[e.brain.state] = (p.states[e.brain.state] ?? 0) + 1;
      }
      if (nearest < p.minDist) p.minDist = nearest;
      p.maxAlive = Math.max(p.maxAlive, sys.aliveCount());
      // Record the damage, then put the player back on his feet: this test is about whether the
      // squad comes and fights, not about how fast it can kill a man who never moves.
      if (player.health < player.maxHealth) { p.damage += player.maxHealth - player.health; player.health = player.maxHealth; }
      if (p.simTime >= nextSample) { p.track.push(Number(nearest.toFixed(1))); nextSample++; }
      if (p.simTime >= seconds) p.done = true;
    };
    game.start();
  }, WINDOW);

  await page.waitForFunction(() => (window as unknown as { __aiProbe: { done: boolean } }).__aiProbe.done, null, { timeout: 180_000 });
  probe = await page.evaluate(() => (window as unknown as { __aiProbe: Probe }).__aiProbe);
  if (errors.length) probe.error = errors.join('\n');
  await page.close();
}, 300_000);

afterAll(async () => { await browser?.close(); });

describe('wave 1, player standing still in the open', () => {
  it('spawns a squad', () => {
    expect(probe.error).toBeUndefined();
    expect(probe.simTime).toBeGreaterThanOrEqual(WINDOW - 0.1);
    expect(probe.maxAlive).toBeGreaterThanOrEqual(3);
  });

  it('closes to within 10 m', () => {
    // The reported bug: the squad reached 14 m, turned around and parked at 27 m for the rest of
    // the wave. `track` (nearest enemy, once a simulated second) is printed on failure.
    expect({ minDist: Number(probe.minDist.toFixed(1)), track: probe.track }).toMatchObject({ minDist: expect.any(Number) });
    expect(probe.minDist).toBeLessThanOrEqual(10);
  });

  it('actually fires at the player', () => {
    // Four rounds in 25 seconds was the measured behaviour. A silent or passive squad fails here.
    expect(probe.shots).toBeGreaterThan(20);
  });

  it('hurts the player', () => {
    // Shots that all miss by the full range to the target are not a fight: before the fix the
    // squad's aim point was a shared scratch vector that every helper overwrote, so every round
    // went into a wall and the player never lost a hit point.
    expect(probe.damage).toBeGreaterThan(0);
  });
});
