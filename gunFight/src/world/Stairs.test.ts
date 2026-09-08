import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * Acceptance test for the bug "you cannot get to the second floor of any building".
 *
 * It drives a **real headless session** — the same `?shot=1` page `scripts/shot.mjs` uses, so the level is
 * built by the real generator against the real Rapier colliders — and moves the player only by holding
 * forward through `PlayerController.debugInput`, the module's own scripted-input seam, which merges into
 * the same `InputState` the keyboard produces. Nothing writes the player's position once a walk has
 * started: no teleporting, no noclip. Only the aim yaw is steered, which is what a mouse does.
 *
 * Needs the dev server (`npx vite --port 5180`, usually already running — see CLAUDE.md).
 *
 * The bug it pins down was in `stairRun`: every step was emitted as a collider box reaching all the way
 * down to the run's base, so the underside of a run was a flat slab where the mesh shows a sloped soffit.
 * In a U-stair the enclosure door sits under the *upper* run, so that slab was a ceiling 1.60 m above the
 * floor right in front of every stairwell door — below the 1.8 m capsule. Every interior route up was
 * sealed, in all four stairwells, on every floor.
 */

const ORIGIN = 'http://127.0.0.1:5180';

/** Floor-to-floor and the ground-floor datum, from world/Buildings.ts and the building definitions. */
const FH = 3.24, BASE = 0.15;

/**
 * The level's four U-stairwells as [name, x0, zNear, dir] — the arguments `Level` passes to `stairsU`,
 * mirrored by `Level.navSeeds()`. `x0` is the west edge of the 2.6 m well, `zNear` the edge holding the
 * enclosure door, `dir` the direction the first run climbs.
 */
const WELLS: [string, number, number, 1 | -1][] = [
  ['A (pharmacy, NW corner)', -22.65, -19.55, -1],
  ['E (garage, SE block)', 20.05, 17.55, 1],
  ['C (shelled block, NE)', 20.05, -19.55, -1],
  ['E2 (courtyard east wing)', -13.65, 27.55, 1],
];

interface WalkResult {
  startFeet: number; endFeet: number; maxFeet: number; minFeet: number;
  end: [number, number, number]; reached: number; of: number;
}

let browser: Browser | undefined;
let results: Record<string, { up: WalkResult; down: WalkResult }> = {};

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
  await page.goto(`${ORIGIN}/?shot=1&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 240_000 });

  results = await page.evaluate(([wells, fh, base]) => {
    const engine = window.__engine!;
    interface Walker {
      name: string;
      position: { x: number; y: number; z: number };
      yaw: number;
      teleport(p: { x: number; y: number; z: number }, yaw?: number, pitch?: number): void;
      debugInput: { moveY?: number } | null;
    }
    const player = engine.get<Walker>('player')!;
    engine.get<{ name: string; killAll?: () => void }>('enemies')?.killAll?.();

    /** Hold forward, steer the aim along `route`, tick the real engine at a fixed 60 Hz. */
    const walk = (start: [number, number, number], route: [number, number][], seconds: number) => {
      // Setup only: stand the player on the floor under test. Nothing writes position after this line.
      player.teleport({ x: start[0], y: start[1] + 0.9, z: start[2] }, 0, 0);
      engine.tick(1 / 60);
      const startFeet = player.position.y - 0.9;
      player.debugInput = { moveY: 1 };   // "W held down", through the normal input path
      let at = 0, maxFeet = -Infinity, minFeet = Infinity;
      for (let f = 0; f < Math.round(seconds * 60); f++) {
        const [tx, tz] = route[Math.min(at, route.length - 1)];
        const dx = tx - player.position.x, dz = tz - player.position.z;
        if (Math.hypot(dx, dz) < 0.5 && at < route.length - 1) at++;
        player.yaw = Math.atan2(-dx, -dz);   // look toward the next waypoint; a mouse turn, nothing more
        engine.tick(1 / 60);
        const feet = player.position.y - 0.9;
        if (feet > maxFeet) maxFeet = feet;
        if (feet < minFeet) minFeet = feet;
      }
      player.debugInput = null;
      return {
        startFeet, endFeet: player.position.y - 0.9, maxFeet, minFeet, reached: at, of: route.length - 1,
        end: [player.position.x, player.position.y - 0.9, player.position.z] as [number, number, number],
      };
    };

    const out: Record<string, { up: ReturnType<typeof walk>; down: ReturnType<typeof walk> }> = {};
    for (const [name, x0, zNear, dir] of wells) {
      // In the door, onto run 1, round the half-landing, up run 2, out through the door on the floor above.
      const up: [number, number][] = [
        [x0 + 1.95, zNear + dir * 0.35], [x0 + 0.65, zNear + dir * 0.85], [x0 + 0.65, zNear + dir * 2.75],
        [x0 + 1.30, zNear + dir * 3.55], [x0 + 1.95, zNear + dir * 2.75], [x0 + 1.95, zNear + dir * 0.35],
        [x0 + 1.95, zNear - dir * 1.05],
      ];
      const down: [number, number][] = [
        [x0 + 1.95, zNear + dir * 0.35], [x0 + 1.95, zNear + dir * 2.75], [x0 + 1.30, zNear + dir * 3.55],
        [x0 + 0.65, zNear + dir * 2.75], [x0 + 0.65, zNear + dir * 0.85], [x0 + 1.95, zNear - dir * 1.05],
      ];
      const doorstep: [number, number] = [x0 + 1.95, zNear - dir * 1.05];
      out[name] = {
        up: walk([doorstep[0], base, doorstep[1]], up, 13),
        down: walk([doorstep[0], base + fh, doorstep[1]], down, 13),
      };
    }
    return out;
  }, [WELLS, FH, BASE] as const);

  if (errors.length) throw new Error(`page errors during the walk: ${errors.join(' | ')}`);
  await page.close();
}, 400_000);

afterAll(async () => { await browser?.close(); });

describe('stairwells are walkable', () => {
  const floor1 = BASE + FH;

  for (const [name] of WELLS) {
    it(`${name}: holding forward from the ground floor reaches the first-floor slab`, () => {
      const r = results[name].up;
      expect(r.startFeet).toBeLessThan(BASE + 0.3);
      // the slab above is at BASE + FH = 3.39; standing on it puts the feet within a few cm of that
      expect(r.endFeet, `ended at ${JSON.stringify(r.end)} after waypoint ${r.reached}/${r.of}`).toBeGreaterThan(floor1 - 0.15);
      expect(r.maxFeet).toBeGreaterThan(floor1 - 0.15);
      expect(r.reached).toBe(r.of);            // walked the whole route rather than wedging somewhere
      expect(r.minFeet).toBeGreaterThan(-0.5); // and never dropped out of the level on the way
    });

    it(`${name}: holding forward from the first floor gets back down without falling through`, () => {
      const r = results[name].down;
      expect(r.startFeet).toBeGreaterThan(floor1 - 0.15);
      expect(r.endFeet, `ended at ${JSON.stringify(r.end)} after waypoint ${r.reached}/${r.of}`).toBeLessThan(BASE + 0.3);
      expect(r.reached).toBe(r.of);
      // falling through the stairs would show up as feet below the ground slab at some point
      expect(r.minFeet).toBeGreaterThan(BASE - 0.2);
      // and it has to be a walk down, not a drop off the landing
      expect(r.maxFeet).toBeLessThan(floor1 + 0.6);
    });
  }
});
