import { describe, expect, it } from 'vitest';
import { loadAirfield } from './Data';
import { Flights } from './Flights';
import { occupied, stands } from './Parked';
import { dims } from './Plane';

/** 首都机场的飞机（2026-11-16，第二批）：在真的 airfield.json 上跑。 */
describe('airport planes', async () => {
  const d = await loadAirfield();
  const st = stands(d);
  const fl = new Flights(d);

  it('park on hundreds of stands, never two in one place', () => {
    expect(st.length).toBeGreaterThan(300);
    // 同一个钟点停着的飞机，机身中点之间至少隔半个翼展（机位挑机型时按间距挑过）
    for (const hour of [3, 14]) {
      const on = st.filter((_, i) => occupied(i, hour));
      expect(on.length).toBeGreaterThan(st.length * 0.4);
      let bad = 0;
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
        const a = on[i], b = on[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < Math.min(dims(a.kind).span, dims(b.kind).span) * 0.45) bad++;
      }
      expect(bad).toBeLessThan(on.length * 0.02);
    }
  });

  it('keep the parked ones off the runways', () => {
    for (const s of st) for (const r of fl.rws) {
      const a = (s.x - r.sx) * r.ux + (s.z - r.sz) * r.uz, o = Math.abs((s.x - r.sx) * -r.uz + (s.z - r.sz) * r.ux);
      expect(a > 0 && a < r.len && o < r.w / 2 + 10, `stand at ${s.x.toFixed(0)},${s.z.toFixed(0)} on ${r.ref}`).toBe(false);
    }
  });

  it('land over the airport expressway at a few hundred feet', () => {
    // 36L（最西那条）的进近在跑道头以南约 3 公里处横穿机场高速
    const west = fl.rws[0];
    let low = Infinity;
    for (let t = 0; t < 400; t += 0.5) for (const f of fl.poses(t, 14, 0, 0, () => false)) {
      if (!f.arr || f.ground) continue;
      const back = -((f.x - west.sx) * west.ux + (f.z - west.sz) * west.uz);
      if (Math.abs(back - 3000) < 40 && Math.abs((f.x - west.sx) * -west.uz + (f.z - west.sz) * west.ux) < 30) low = Math.min(low, f.y);
    }
    expect(low).toBeGreaterThan(140);
    expect(low).toBeLessThan(200);
  });

  it('move smoothly, take off and land on the runway', () => {
    const prev = new Map<number, { x: number; y: number; z: number }>();
    let lifted = 0, landed = 0;
    for (let t = 0; t < 900; t += 0.25) {
      for (const f of fl.poses(t, 14, 0, 0, () => false)) {
        const p = prev.get(f.id);
        if (p) expect(Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z), `flight ${f.id} at ${t}`).toBeLessThan(0.25 * 100);
        if (p && p.y < 0.5 && f.y > 0.5 && !f.arr) lifted++;
        if (p && p.y > 0.5 && f.y < 0.5 && f.arr) landed++;
        prev.set(f.id, { x: f.x, y: f.y, z: f.z });
      }
    }
    expect(lifted).toBeGreaterThan(3);
    expect(landed).toBeGreaterThan(3);
  });

  it('go around when someone is on the runway', () => {
    const f2 = new Flights(d);
    // 第 0 圈落地（西跑道，t0 = 0）：进近到一半，跑道上有人
    // 不复飞的话 t = 150 时离瞄准点 1200 米、高 63 米；复飞了应该在爬升
    let at150 = 0;
    for (let t = 0; t <= 150; t += 0.5) {
      const a = f2.poses(t, 14, 0, 0, (rw) => rw === f2.rws[0] && t > 100).find((p) => p.id === 1e6);
      if (a && t === 150) at150 = a.y;
    }
    expect(at150).toBeGreaterThan(150);
  });

  it('taxi to stands and back out without two planes on top of each other (two hours)', () => {
    // 第三批：一圈一圈排下来，地上的飞机（滑行、等待、停机位）中心之间不小于两架各自「半个身子」的 0.7 倍；
    // 一个机位同一时间只停一架；两边的机位、三条跑道都用上
    const f3 = new Flights(d);
    const R = (k: 0 | 1 | 2) => Math.max(dims(k).span, dims(k).len) * 0.36;
    let worst = Infinity, at = '';
    const standAt = new Map<number, Set<number>>();
    const used = new Set<number>(), deps = new Set<string>();
    let moving = 0, maxMoving = 0;
    for (let t = 0; t < 7200; t += 1) {
      const ps = f3.poses(t, 14, 0, 0, () => false);
      const g = ps.filter((p) => p.ground);
      moving = g.filter((p) => !p.parked).length; maxMoving = Math.max(maxMoving, moving);
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const r = Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z) / (R(g[i].kind) + R(g[j].kind));
        if (r < worst) { worst = r; at = `t=${t} ${g[i].id}/${g[j].id}`; }
      }
      if (t % 30 === 0) for (const pl of f3.planned) if (pl.stand >= 0 && t >= pl.from && t < pl.to) {
        used.add(pl.stand);
        const s = standAt.get(t) ?? standAt.set(t, new Set()).get(t)!;
        expect(s.has(pl.stand), `stand ${pl.stand} twice at ${t}`).toBe(false);
        s.add(pl.stand);
      }
      for (const p of ps) if (!p.ground && !p.arr && p.y < 50) deps.add(`${Math.round(p.x / 500)}`);
    }
    expect(worst, at).toBeGreaterThan(0.7);
    expect(used.size).toBeGreaterThan(30);
    expect(maxMoving).toBeLessThan(24);
    // 起飞的从中跑道和东跑道都有
    expect(deps.size).toBeGreaterThan(1);
  });

  it('wait for a car in the way, then carry on', () => {
    const f4 = new Flights(d);
    // 找一架在滑行的飞机，在它前面 40 米停一辆车，停 90 秒
    let car: { x: number; z: number; r: number } | null = null, id = -1, t = 900;
    for (; t < 1500 && id < 0; t += 1) {
      for (const p of f4.poses(t, 14, 0, 0, () => false)) {
        if (!p.ground || p.parked || p.push || Math.hypot(p.vx, p.vz) < 6 || Math.hypot(p.vx, p.vz) > 12) continue;
        const D = dims(p.kind);
        car = { x: p.x + Math.sin(p.yaw) * (D.len / 2 + 30), z: p.z + Math.cos(p.yaw) * (D.len / 2 + 30), r: 2.4 };
        id = p.id;
        break;
      }
    }
    expect(id).toBeGreaterThan(0);
    let first: { x: number; z: number } | null = null, last: { x: number; z: number } | null = null;
    for (let k = 0; k < 90 * 4; k++) {
      const p = f4.poses(t + k / 4, 14, 0, 0, () => false, car).find((q) => q.id === id)!;
      if (k === 40) first = { x: p.x, z: p.z };
      last = { x: p.x, z: p.z };
    }
    // 停住了（车前 60 米内）
    expect(Math.hypot(last!.x - first!.x, last!.z - first!.z)).toBeLessThan(1);
    expect(Math.hypot(last!.x - car!.x, last!.z - car!.z)).toBeGreaterThan(5);
    // 车走了：接着滑（可能没几步就到了跑道头的等待点，所以只要求挪了 10 米）
    let moved = 0;
    for (let k = 0; k < 60 * 4; k++) {
      const p = f4.poses(t + 90 + k / 4, 14, 0, 0, () => false, null).find((q) => q.id === id);
      if (p) moved = Math.hypot(p.x - last!.x, p.z - last!.z);
    }
    expect(moved).toBeGreaterThan(10);
  });
});
