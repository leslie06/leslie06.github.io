import type { Engine, System } from '../core/Engine';
import type { PlayerApi, VehicleApi } from '../game/Contracts';
import { SIDEWALK } from '../people/Pavement';
import type { Vehicle } from '../vehicle/Vehicle';
import type { TrafficApi } from './index';
import type { Link } from './LaneGraph';

/**
 * 路感（2026-11-10，docs/street-level-design.md A3，「没有开车的沉浸感」）。城市的地面碰撞体是一整块平板，路缘、桥缝都
 * 只是画出来的：正常开车时悬挂、镜头、手柄没有任何输入。这里给玩家开着的那辆车的车轮射线叠一层很小的路面高度
 * （`Vehicle.roadProfile`，别的车不算）：
 *   - 路面本身的起伏：5 米波长 ±4 毫米、0.9 米波长 ±1.5 毫米；胡同和步行街（砖地、老路面）细的那层大四倍。
 *   - 桥面伸缩缝：高架和立交的桥面上每 30 米一道 2 厘米高、30 厘米宽的棱，前后轴各过一次——「咯噔、咯噔」。
 *   - 路缘：车轮出了车行道（到了人行道上）抬高 4 厘米，上下马路牙子各有一下。
 * 车在哪条路上每秒查 10 次（最近的、高度对得上的路段），两次之间按那一小段直线算，不是每个车轮每步都查路网。
 * 过缝和上下路缘发 `road:bump`：镜头轻抖、手柄和手机震一下、一声闷响（player/CameraRig、audio/）。
 * 起伏很小（弹簧力变化约 5%），操控测试用的车没有这个钩子，不受影响。`?roadfeel=0` 关掉。
 */
const JOINT_EVERY = 30, JOINT_LEN = 0.3, JOINT_H = 0.022, KERB_H = 0.04;
const LANE_CLS = new Set(['service', 'living_street', 'pedestrian']);

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('roadfeel') === '0') return;
  const tr = engine.get<TrafficApi>('traffic');
  if (!tr) return;
  const g = tr.graph;
  // the stretch of road under the car: a point on it, its direction, the arc length there, and what kind of road it is
  const at = { ok: false, ax: 0, az: 0, dx: 1, dz: 0, s: 0, hw: 4, deck: false, kerb: false, fine: 0.0015, joint: JOINT_LEN };
  /** The biggest step (joint or kerb) a wheel stood on this physics step, and which. */
  let kick = 0, kickKind: 'joint' | 'kerb' = 'joint';
  const profile = (x: number, z: number): number => {
    let h = 0.004 * Math.sin(x * 1.1 + z * 0.7) * Math.sin(z * 1.3 - x * 0.5) + at.fine * Math.sin(x * 7.3 + z * 4.1) * Math.sin(z * 6.7 - x * 3.9);
    if (!at.ok) return h;
    const rx = x - at.ax, rz = z - at.az, along = at.s + rx * at.dx + rz * at.dz, lat = Math.abs(rx * at.dz - rz * at.dx);
    if (at.deck) {
      const ph = ((along % JOINT_EVERY) + JOINT_EVERY) % JOINT_EVERY;
      if (ph < at.joint) { const j = JOINT_H * Math.sin(Math.PI * ph / at.joint); h += j; if (j > kick) { kick = j; kickKind = 'joint'; } }
    } else if (at.kerb && lat > at.hw + 0.15 && lat < at.hw + 6) {
      h += KERB_H;
      if (KERB_H > kick) { kick = KERB_H; kickKind = 'kerb'; }
    }
    return h;
  };
  const locate = (car: Vehicle): void => {
    at.ok = false;
    let bd = Infinity, bl: Link | null = null;
    const x = car.pos.x, z = car.pos.z, y = car.pos.y;
    for (const id of g.near(x, z, 24)) {
      const l = g.links[id];
      for (let k = 1; k < l.cum.length; k++) {
        const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
        const L = Math.hypot(vx, vz) || 1, dx = vx / L, dz = vz / L;
        const u = Math.max(0, Math.min(L, (x - ax) * dx + (z - az) * dz));
        const s = l.cum[k - 1] + u, d = Math.hypot(x - ax - dx * u, z - az - dz * u);
        // a deck overhead (or the road under a deck) is not the road the car is on: heights apart count as distance
        const score = d + Math.abs(g.heightAt(l, s) + 0.5 - y) * 3;
        if (score < bd) { bd = score; bl = l; at.ax = ax; at.az = az; at.dx = dx; at.dz = dz; at.s = l.cum[k - 1]; }
      }
    }
    if (!bl || bd > 30) return;
    const l = bl;
    at.ok = true; at.hw = l.hw;
    at.deck = g.heightAt(l, at.s) > 0.5;
    at.kerb = !at.deck && !!SIDEWALK[l.cls];
    at.fine = LANE_CLS.has(l.cls) ? 0.006 : 0.0015;
    // a wheel is sampled 60 times a second: at speed the joint is stretched to a step and a half of travel, or it slips between two samples
    at.joint = Math.max(JOINT_LEN, car.speed / 60 * 1.6);
  };

  let owner: Vehicle | null = null, pollT = 0, was = 0;
  const sys: System = {
    name: 'roadfeel',
    fixedUpdate(dt) {
      const v = engine.get<VehicleApi>('vehicle');
      const car = v && v.occupied && engine.get<PlayerApi>('player')?.mode === 'driving' ? v.car : null;
      if (car !== owner) {
        if (owner) owner.roadProfile = null;
        owner = car; pollT = 0; at.ok = false;
        if (car) car.roadProfile = profile;
      }
      if (!car) return;
      pollT -= dt;
      if (pollT <= 0) { pollT = 0.1; locate(car); }
      // onto a joint or a kerb this step (not while standing on one)
      if (kick > 0.012 && was <= 0.012 && car.speed > 2) engine.events.emit('road:bump', { strength: Math.min(1, (kickKind === 'kerb' ? 0.35 : 0.2) + car.speed / 60), kind: kickKind });
      // a kerb is felt going up and coming down
      else if (kick <= 0.012 && was > 0.012 && kickKind === 'kerb' && car.speed > 2) engine.events.emit('road:bump', { strength: Math.min(1, 0.25 + car.speed / 80), kind: 'kerb' });
      was = kick; kick = 0;
    },
  };
  engine.add(sys);
}
