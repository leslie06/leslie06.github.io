import * as THREE from 'three';
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Crowd } from './Crowd';
import { Gait, JOINT_FLOATS, poseWorld, type Action } from './Animator';
import { ANKLE_H, BALL, HEEL, J, JOINT_COUNT, randomLook, type Look } from './Body';

/**
 * The crowd's CPU budget (120 people posed and written to the joint texture in < 1 ms) and the
 * gait's promise that planted feet do not slide.
 */
const report: string[] = [];
const lcg = (seed: number) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; };
const player: Look = { skin: new THREE.Color('#e2bd98'), shirt: new THREE.Color('#f0efea'), pants: new THREE.Color('#1b2536'), shoes: new THREE.Color('#1a1a1a'), hair: new THREE.Color('#141212') };

describe('crowd', () => {
  it('poses and uploads 120 people in under a millisecond', () => {
    const scene = new THREE.Scene();
    const crowd = new Crowd(scene, 120);
    const rnd = lcg(7);
    const gaits = Array.from({ length: 120 }, () => new Gait());
    const looks = Array.from({ length: 120 }, (_, i) => (i === 0 ? player : randomLook(rnd)));
    const seeds = gaits.map(() => rnd());
    const pos = Array.from({ length: 120 }, (_, i) => new THREE.Vector3((i % 11) * 3, 0, Math.floor(i / 11) * 3));
    const speeds = gaits.map((_, i) => [0, 1.2, 1.4, 1.6, 3.9, 6.4, 0][i % 7]);
    const acts: Action[] = gaits.map((_, i) => (i % 29 === 5 ? 'knocked' : i % 31 === 7 ? 'down' : i % 37 === 9 ? 'getup' : 'move'));
    let t = 0;
    const frame = () => {
      t += 1 / 60;
      crowd.begin();
      for (let i = 0; i < 120; i++) {
        gaits[i].update({ speed: speeds[i], action: acts[i], t: t % 0.9 }, 1 / 60, seeds[i]);
        crowd.add(pos[i], i * 0.3, gaits[i], looks[i]);
      }
    };
    for (let i = 0; i < 400; i++) frame();
    const N = 3000, t0 = performance.now();
    for (let i = 0; i < N; i++) frame();
    const ms = (performance.now() - t0) / N;
    report.push(`120 people, Gait.update + Crowd.add: ${ms.toFixed(3)} ms/frame (Node)`);
    expect(crowd.size).toBe(120);
    expect(ms).toBeLessThan(1);
  });

  for (const v of [1.3, 1.6, 3.9, 6.4]) {
    it(`planted feet stay put at ${v} m/s`, () => {
      const g = new Gait();
      g.bindLook(player);
      const W = new Float64Array(JOINT_COUNT * JOINT_FLOATS);
      const root = new THREE.Vector3();
      const dt = 1 / 120;
      const pt = (jA: number, dz: number, out: THREE.Vector3) => {
        const o = jA * 12, lx = 0, ly = -ANKLE_H, lz = dz;
        out.set(W[o] * lx + W[o + 1] * ly + W[o + 2] * lz + W[o + 3], W[o + 4] * lx + W[o + 5] * ly + W[o + 6] * lz + W[o + 7], W[o + 8] * lx + W[o + 9] * ly + W[o + 10] * lz + W[o + 11]);
      };
      const prev = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const cur = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let slide = 0, planted = 0, lowest = 9;
      for (let i = 0; i < 1200; i++) {
        g.update({ speed: v, action: 'move', t: 0 }, dt, 0.42);
        root.z += v * dt;
        poseWorld(root, 0, g.scale, g, W);
        pt(J.ankleL, -HEEL, cur[0]); pt(J.ankleL, BALL, cur[1]); pt(J.ankleR, -HEEL, cur[2]); pt(J.ankleR, BALL, cur[3]);
        if (i > 240) {
          // Each foot's pivot (its lower contact point) while it is on the ground.
          for (const k of [0, 2]) {
            const q = cur[k].y <= cur[k + 1].y ? k : k + 1;
            lowest = Math.min(lowest, cur[q].y);
            if (cur[q].y < 0.005 && prev[q].y < 0.005) { slide += Math.hypot(cur[q].x - prev[q].x, cur[q].z - prev[q].z) / dt; planted++; }
          }
        }
        for (let k = 0; k < 4; k++) prev[k].copy(cur[k]);
      }
      const avg = slide / Math.max(1, planted);
      report.push(`${v} m/s: contact points on the ground ${planted} samples, mean slide ${avg.toFixed(3)} m/s (${((avg / v) * 100).toFixed(1)}% of speed), lowest ${lowest.toFixed(3)} m`);
      expect(planted).toBeGreaterThan(100);
      expect(avg / v).toBeLessThan(0.03);
      expect(lowest).toBeGreaterThan(-0.02);
    });
  }

  it('writes the report', () => { fs.mkdirSync('.scratch', { recursive: true }); fs.writeFileSync('.scratch/crowd-report.txt', report.join('\n') + '\n'); });
});
