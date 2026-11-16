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
    // 第一班落地（西跑道，t0 = 0）：进近到一半，跑道上有人
    // 不复飞的话 t = 150 时离瞄准点 1200 米、高 63 米；复飞了应该在爬升
    let at150 = 0;
    for (let t = 0; t <= 150; t += 0.5) {
      const a = f2.poses(t, 14, 0, 0, (rw) => rw === f2.rws[0] && t > 100).find((p) => p.id === 0);
      if (a && t === 150) at150 = a.y;
    }
    expect(at150).toBeGreaterThan(150);
  });
});
