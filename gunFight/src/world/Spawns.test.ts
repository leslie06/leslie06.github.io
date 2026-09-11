import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * Acceptance test for: "I killed five of wave 1 and could never find the sixth."
 *
 * The wave director ends a wave only once every soldier it deployed is dead, so an enemy spawn point a
 * soldier cannot walk out of is a wave the player can never finish — and nothing on screen says why.
 * Wave 1 shipped with three of them:
 *
 *   - (-30, 11), the north wing's west room. Its only openings are a closed shop shutter and windows, and
 *     its ground-floor partition has no door, so the soldier paced a sealed room for good.
 *   - (13, 12), which the spawn raycast dropped onto the roof of the car parked in building E's garage.
 *     With 1.44 m of headroom he could not stand, sat wedged, and went only when the 25 s watchdog fired.
 *   - (24.5, -18), an east-alley pocket closed by the gate on one side and a dumpster on the other. Its
 *     one exit is a stairwell dog-leg into building C's rear room, which the nav graph had as an island,
 *     so a soldier who got in could not plan a way out.
 *
 * Judging "found" by floor and line of sight, rather than by map distance, turned up one more:
 * (-11.5, 17) on the courtyard east wing's first floor. That wing's stair room has no ground-floor door,
 * so a soldier up there can neither come down nor be seen from the street. The static checks also caught
 * the B and D spawns standing 2 cm from a partition, and the east half of A's second floor as a nav island.
 *
 * For every point in `level.enemySpawns` it checks the static preconditions (floor under it, room to
 * stand, a nav node on the player's component) and then does what the director does once a wave stops
 * deploying: spawn one soldier, re-task him onto the player every few seconds (GameMode.huntPlayer), and
 * step the real enemy AI against the real Rapier world until he is within 12 m on the player's floor or
 * has the player in sight. From two player positions, because the routes differ.
 *
 * Needs the dev server (`npx vite --port 5180`, usually already running — see CLAUDE.md).
 */

const ORIGIN = 'http://127.0.0.1:5180';
/** Simulated seconds a soldier gets. The slowest spawn today needs ~42 s from the street. */
const LIMIT = 60;
/** Seconds between re-taskings, as GameMode.huntPlayer does it (DIRECTOR.huntInterval). */
const HUNT = 4;
/** Where the player waits: landmarks from world/Level.ts. */
const POSTS = ['street', 'intersection'];
/** groups(CG.PLAYER, CG.WORLD) from core/Physics.ts: what the standing body collides with. */
const PLAYER_VS_WORLD = (0x0002 << 16) | 0x0001;
/**
 * Wave 1's only archetype and the baseline mover. Pinned because EnemySystem.spawn otherwise cycles
 * archetypes by id, which would make each spawn's result depend on the order the test visits them.
 */
const ARCHETYPE = 'grunt';

interface Walk { post: string; ok: boolean; how: string; t: number; end: number[] }
interface SpawnReport {
  i: number; at: number[];
  ground: number | null; fits: boolean;
  onPlayerComponent: boolean; navGap: number;
  walks: Walk[];
}

let browser: Browser | undefined;
let reports: SpawnReport[] = [];
let pageErrors: string[] = [];

beforeAll(async () => {
  let alive = false;
  try { alive = (await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { alive = false; }
  if (!alive) throw new Error(`no dev server at ${ORIGIN} — start one with \`npx vite --port 5180\` and re-run`);

  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  // Vite's HMR client would reload the page mid-run if someone saved a file.
  await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){}});export function injectQuery(u){return u}export function updateStyle(){}export function removeStyle(){}' }));
  await page.goto(`${ORIGIN}/?shot=1&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 240_000 });

  reports = await page.evaluate(async ([limit, hunt, posts, bodyFilter, archetype]) => {
    interface V3 { x: number; y: number; z: number; clone(): V3 }
    interface Soldier { id: number; alive: boolean; pos: V3; brain: { visible: boolean } }
    interface NavNode { p: [number, number, number]; comp?: number }
    interface Enemies { name: string; enemies: Soldier[]; world: { nav: NavNode[] }; spawn(p: V3, opts?: { archetype?: string }): number; killAll(): void; alertAll(p: V3): void; fixedUpdate(dt: number): void }
    interface Player { name: string; position: V3; health: number; maxHealth: number; alive: boolean; teleport(p: V3, yaw?: number, pitch?: number): void }
    interface Level { name: string; enemySpawns: V3[]; spawnPoints: V3[]; landmarks: Record<string, { position: V3; yaw: number }> }
    const engine = window.__engine!;
    const phys = engine.physics;
    const sys = engine.get<Enemies>('enemies')!, player = engine.get<Player>('player')!, level = engine.get<Level>('level')!;
    const FIX = phys.fixedDt;
    sys.killAll();
    sys.fixedUpdate(FIX);   // binds the level and builds the stitched graph the brains plan on

    // The standing body the nav graph is validated against (world/Nav.ts BODY, minus the autostep band).
    const R = 0.35 - 0.03, H = 1.8 - 0.42 - 0.03;
    const body = new phys.R.Capsule((H - 2 * R) / 2, R);
    const fits = (x: number, y: number, z: number): boolean => {
      let hit = false;
      phys.world.intersectionsWithShape({ x, y: y + 0.42 + H / 2, z }, { x: 0, y: 0, z: 0, w: 1 }, body, () => { hit = true; return false; }, undefined, bodyFilter);
      return !hit;
    };
    const nav = sys.world.nav;
    const nearest = (x: number, y: number, z: number): { comp: number | undefined; d: number } => {
      let best = -1, bd = Infinity;
      for (let k = 0; k < nav.length; k++) {
        const p = nav[k].p;
        const d = Math.hypot(p[0] - x, p[2] - z) + 4 * Math.abs(p[1] - y);
        if (d < bd) { bd = d; best = k; }
      }
      return { comp: best < 0 ? undefined : nav[best].comp, d: bd };
    };
    const ps = level.spawnPoints[0];
    const playerComp = nearest(ps.x, ps.y - 0.9, ps.z).comp;

    const out: SpawnReport[] = level.enemySpawns.map((s, i) => {
      // Dropped to the ground exactly the way EnemySystem.spawn drops him.
      const down = phys.raycast({ x: s.x, y: s.y + 1.5, z: s.z }, { x: 0, y: -1, z: 0 }, 6, 0xffff0001);
      const ground = down ? down.point[1] : null;
      const n = nearest(s.x, ground ?? s.y, s.z);
      return { i, at: [s.x, s.y, s.z], ground, fits: ground !== null && fits(s.x, ground, s.z), onPlayerComponent: n.comp === playerComp, navGap: +n.d.toFixed(2), walks: [] };
    });

    for (const post of posts) {
      const lm = level.landmarks[post];
      player.teleport(lm.position.clone(), lm.yaw, 0);
      for (let k = 0; k < 30; k++) engine.tick(1 / 60);   // settle on the ground and let the camera place his eye
      const feet = player.position.y - 0.9;
      for (const r of out) {
        sys.killAll();
        const id = sys.spawn(level.enemySpawns[r.i].clone(), { archetype });
        const e = sys.enemies.find((q) => q.id === id)!;
        let t = 0, next = 0, how = '';
        while (t < limit && !how) {
          if (t >= next) { sys.alertAll(player.position); next += hunt; }
          player.health = player.maxHealth; player.alive = true;   // a test of routes, not of lethality
          sys.fixedUpdate(FIX); phys.step(); t += FIX;
          if (!e.alive) { how = 'died'; break; }
          const d = Math.hypot(e.pos.x - player.position.x, e.pos.z - player.position.z);
          if (d < 12 && Math.abs(e.pos.y - feet) < 1.5) how = 'reached';
          else if (t > 3 && e.brain.visible) how = 'in sight';
          if (Math.round(t / FIX) % 300 === 0) await new Promise((res) => setTimeout(res, 0));
        }
        r.walks.push({ post, ok: how === 'reached' || how === 'in sight', how: how || 'timeout', t: +t.toFixed(1), end: [+e.pos.x.toFixed(1), +e.pos.y.toFixed(2), +e.pos.z.toFixed(1)] });
      }
    }
    sys.killAll();
    return out;
  }, [LIMIT, HUNT, POSTS, PLAYER_VS_WORLD, ARCHETYPE] as [number, number, string[], number, string]);
  await page.close();
}, 600_000);

afterAll(async () => { await browser?.close(); });

describe('every enemy spawn point', () => {
  it('is read from a level that ran cleanly', () => {
    expect(pageErrors).toEqual([]);
    expect(reports.length).toBeGreaterThan(0);
  });

  it('has floor under it and room to stand up', () => {
    // The car-roof spawn fails here: ground found, but 1.44 m under the garage ceiling.
    expect(reports.filter((r) => r.ground === null || !r.fits).map((r) => ({ i: r.i, at: r.at, ground: r.ground }))).toEqual([]);
  });

  it('is on the nav component the player spawns on', () => {
    // The sealed north-wing room, the east-wing upper floor, and the unseeded rear room of C and second
    // floor of A all fail here.
    expect(reports.filter((r) => !r.onPlayerComponent).map((r) => ({ i: r.i, at: r.at, navGap: r.navGap }))).toEqual([]);
  });

  it.each(POSTS)('lets a soldier walk out and find a player waiting at the %s', (post) => {
    const failed = reports.map((r) => ({ i: r.i, at: r.at, walk: r.walks.find((w) => w.post === post)! })).filter((r) => !r.walk.ok);
    expect(failed).toEqual([]);
  });
});
