import type { Engine, System } from '../core/Engine';
import { lang, t } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, VehicleApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { Marker } from '../missions/Marker';
import { COURSES, walkCourse, type Course } from './Courses';

/** A checkpoint every CP metres; the course must be driven through each in turn. */
const CP = 500;
/** Medals by average speed over the course, km/h: bronze, silver, gold; and what each pays the first time it is won. */
const MEDAL_KMH = [45, 65, 85];
const MEDAL_PAY = [300, 500, 1000];
/** Off the line this far (m) for OFF_T seconds abandons the run; so does three times the bronze time. */
const OFF = 60, OFF_T = 3;
/** Start gates drawn within this many metres; their blips on the radar within RADAR (the map shows all). */
const GATE_DRAW = 700, RADAR = 450;
const KEY = 'drivecity.trials.v1';
const COLOR = '#5fd1ff', FINISH = '#7dff8a';

interface Save { best: number; splits: number[]; medal: number }
interface Run { c: number; t: number; next: number; maxS: number; off: number; hint: number; splits: number[] }
interface Line { course: Course; p: Float32Array; cum: Float32Array; len: number; cps: number[]; hw: number }

export interface TrialApi extends System {
  readonly active: boolean;
  readonly total: number;
  readonly medals: number;
  debug: { lines(): { id: string; len: number; start: [number, number]; dir: [number, number]; end: [number, number]; pts: number[]; runup: [number, number, number, number] }[]; state(): { course: string; t: number; next: number; of: number } | null; reset(): void };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const CSS = `
.dc-trial{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:30;pointer-events:none;min-width:220px;padding:8px 16px 9px;border-radius:10px;
  background:rgba(9,11,13,.66);color:#f4f1e8;font:600 13px system-ui,sans-serif;text-align:center;border-top:3px solid ${COLOR}}
.dc-trial[hidden]{display:none}
.dc-trial .n{font-size:12px;color:#9fdcf2;letter-spacing:1px}
.dc-trial .t{font:800 30px/1.1 ui-monospace,Menlo,monospace;letter-spacing:1px}
.dc-trial .s{font-size:12px;color:#cfcac0}
.dc-trial .d.ahead{color:#62cf6b}.dc-trial .d.behind{color:#ff6b5e}
.dc-touch .dc-trial{top:44px;min-width:170px}.dc-touch .dc-trial .t{font-size:22px}
`;

/**
 * 计时赛 (2026-10-03): time trials along the city's famous roads (COURSES: 长安街, the 2nd, 3rd and 4th rings, 京通快速路),
 * each one way along the road itself (`walkCourse`). Drive through a course's start gate the right way and the clock
 * runs - a rolling start, traffic and lights as they are; checkpoints every CP m have to be passed in turn (the next
 * one and the finish glow), the panel shows the time, the checkpoint and the split against the best run. At the
 * finish: the time, a medal by average speed (MEDAL_KMH), the medals' pay the first time each is won, the best time
 * and its splits saved in `drivecity.trials.v1`. Getting out, a wreck, OFF m off the line for OFF_T s or three times
 * the bronze time abandons it. Start gates are `trial` blips.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph;
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const lines: Line[] = [];
  for (const def of COURSES) {
    const course = walkCourse(g, def);
    if (!course) { console.warn('[trials] course not found', def.id); continue; }
    // the centre line of the carriageway, a point every 6 m
    const pts: number[] = [];
    let hw = 0;
    course.links.forEach((id, k) => {
      const l = g.links[id];
      hw = Math.max(hw, l.hw);
      for (let s = k === 0 ? course.s0 : 0; s < l.len; s += 6) { g.at(l, s, l.oneway ? 0 : g.laneOffset(l, 0), at); pts.push(at.x, at.z); }
    });
    const p = Float32Array.from(pts), cum = new Float32Array(p.length / 2);
    for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    // trimmed to the course's length (the last link runs past the end)
    let n = cum.length;
    while (n > 2 && cum[n - 1] > course.len) n--;
    const len = cum[n - 1], cps: number[] = [];
    for (let s = CP; s < len - CP / 2; s += CP) cps.push(s);
    cps.push(len);
    lines.push({ course, p: p.slice(0, n * 2), cum: cum.slice(0, n), len, cps, hw: Math.min(hw, 9) });
  }
  if (!lines.length) return;

  let saved: Record<string, Save> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Save>; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignore */ } };

  // --- markers and the panel ------------------------------------------------------------------------------
  const gates = lines.map(() => new Marker(engine.scene));
  const nextMark = new Marker(engine.scene), finishMark = new Marker(engine.scene);
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div'); panel.className = 'dc-trial'; panel.hidden = true;
  const pName = document.createElement('div'); pName.className = 'n';
  const pTime = document.createElement('div'); pTime.className = 't';
  const pSub = document.createElement('div'); pSub.className = 's';
  const pCp = document.createElement('span'), pDelta = document.createElement('span'); pDelta.className = 'd';
  pSub.append(pCp, pDelta);
  panel.append(pName, pTime, pSub);
  document.body.appendChild(panel);

  /** Arc length along a line nearest (x, z), searched round point `hint`, and the distance off it. */
  const along = (ln: Line, x: number, z: number, hint: number, span = 30) => {
    let bi = hint, bd = Infinity;
    const n = ln.cum.length;
    for (let i = Math.max(0, hint - span); i < Math.min(n, hint + span); i++) {
      const d = (ln.p[i * 2] - x) ** 2 + (ln.p[i * 2 + 1] - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return { s: ln.cum[bi], i: bi, d: Math.sqrt(bd) };
  };
  const pointAt = (ln: Line, s: number): [number, number] => {
    let i = 1;
    while (i < ln.cum.length - 1 && ln.cum[i] < s) i++;
    const u = Math.max(0, Math.min(1, (s - ln.cum[i - 1]) / (ln.cum[i] - ln.cum[i - 1] || 1)));
    return [ln.p[i * 2 - 2] + (ln.p[i * 2] - ln.p[i * 2 - 2]) * u, ln.p[i * 2 - 1] + (ln.p[i * 2 + 1] - ln.p[i * 2 - 1]) * u];
  };

  /** Where to put a car to drive into a course's gate: 50 m back along its first link, [x, y, z, yaw] (probes). */
  const runup = (ln: Line): [number, number, number, number] => {
    const l = g.links[ln.course.links[0]], s = Math.max(0, ln.course.s0 - 50);
    g.at(l, s, l.oneway ? 0 : g.laneOffset(l, 0), at);
    return [at.x, g.heightAt(l, s), at.z, Math.atan2(at.dx, at.dz)];
  };
  let run: Run | null = null;
  let clock = 0, cool = 0;
  const lastSide = lines.map(() => 0);
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const nameOf = (ln: Line) => (lang() === 'zh' ? ln.course.def.zh : ln.course.def.en);
  const medalOf = (ln: Line, time: number) => { let m = -1; MEDAL_KMH.forEach((k, i) => { if (ln.len / time * 3.6 >= k) m = i; }); return m; };

  const showMarks = () => {
    if (!run) { nextMark.hide(); finishMark.hide(); return; }
    const ln = lines[run.c];
    const [nx, nz] = pointAt(ln, ln.cps[run.next]);
    if (run.next < ln.cps.length - 1) { nextMark.show(nx, nz, COLOR, 1.8); const [fx, fz] = pointAt(ln, ln.len); finishMark.show(fx, fz, FINISH, 2.2); }
    else { nextMark.hide(); finishMark.show(nx, nz, FINISH, 2.2); }
  };
  const end = (msg: string) => { toast(msg); run = null; panel.hidden = true; showMarks(); engine.get<NavApi>('nav')?.clearTarget('mission'); cool = 5; };
  const begin = (c: number) => {
    run = { c, t: 0, next: 0, maxS: 0, off: 0, hint: 0, splits: [] };
    const ln = lines[c];
    pName.textContent = `${t('trial.name')} · ${nameOf(ln)} · ${(ln.len / 1000).toFixed(1)} km`;
    panel.hidden = false;
    toast(t('trial.go', { name: nameOf(ln) }));
    const [fx, fz] = pointAt(ln, ln.len);
    engine.get<NavApi>('nav')?.setTarget({ x: fx, z: fz, kind: 'mission', label: nameOf(ln) });
    showMarks();
    engine.events.emit('trial:start', { id: ln.course.def.id });
  };

  const blips: Blip[] = [];
  let blipsOn = false;
  const api: TrialApi = {
    name: 'trials',
    get active() { return !!run; },
    total: lines.length,
    get medals() { return Object.values(saved).reduce((a, s) => a + (s.medal + 1), 0); },
    debug: {
      lines: () => lines.map((ln) => ({ id: ln.course.def.id, len: ln.len, start: [ln.p[0], ln.p[1]] as [number, number], dir: [ln.p[2] - ln.p[0], ln.p[3] - ln.p[1]] as [number, number], end: pointAt(ln, ln.len), pts: Array.from(ln.p), runup: runup(ln) })),
      state: () => (run ? { course: lines[run.c].course.def.id, t: run.t, next: run.next, of: lines[run.c].cps.length } : null),
      reset: () => { saved = {}; save(); },
    },
    fixedUpdate(dt) {
      clock += dt;
      cool = Math.max(0, cool - dt);
      const v = engine.get<VehicleApi>('vehicle');
      const driving = pl.mode === 'driving' && !!v?.occupied;
      if (run) {
        const ln = lines[run.c];
        if (!driving) { end(t('trial.out')); return; }
        run.t += dt;
        const car = v!.car;
        const a = along(ln, car.pos.x, car.pos.z, run.hint);
        run.hint = a.i;
        run.off = a.d > OFF ? run.off + dt : 0;
        if (run.off > OFF_T) { end(t('trial.lost')); return; }
        if (run.t > ln.len / (MEDAL_KMH[0] / 3.6) * 3) { end(t('trial.slow')); return; }
        run.maxS = Math.max(run.maxS, a.s);
        // through the next checkpoint: past its arc length, near the line
        if (a.s >= ln.cps[run.next] - 4 && a.d < ln.hw + 12) {
          run.splits.push(run.t);
          const best = saved[ln.course.def.id];
          const ref = best?.splits[run.next];
          if (ref !== undefined) { const dl = run.t - ref; pDelta.textContent = `  ${dl < 0 ? '−' : '+'}${Math.abs(dl).toFixed(1)}`; pDelta.className = `d ${dl < 0 ? 'ahead' : 'behind'}`; }
          run.next++;
          engine.events.emit('trial:checkpoint', { id: ln.course.def.id, i: run.next, of: ln.cps.length });
          if (run.next >= ln.cps.length) {
            const time = run.t, medal = medalOf(ln, time), id = ln.course.def.id;
            const prev = saved[id];
            let pay = 0;
            for (let m = (prev?.medal ?? -1) + 1; m <= medal; m++) pay += MEDAL_PAY[m];
            const isBest = !prev || time < prev.best;
            saved[id] = { best: isBest ? time : prev.best, splits: isBest ? run.splits.slice() : prev.splits, medal: Math.max(medal, prev?.medal ?? -1) };
            save();
            if (pay) engine.get<MissionApi>('missions')?.addCash(pay);
            const medalName = medal >= 0 ? t(`trial.medal${medal}` as 'trial.medal0') : t('trial.noMedal');
            engine.events.emit('trial:finish', { id, time, medal, best: isBest });
            end(t('trial.done', { name: nameOf(ln), time: fmt(time), medal: medalName, best: fmt(saved[id].best) }) + (pay ? ` · +¥${pay}` : '') + (isBest && prev ? ` · ${t('trial.newBest')}` : ''));
            return;
          }
          showMarks();
        }
        return;
      }
      // Idle: through a start gate, going the right way, in a car and moving.
      if (!driving || cool > 0) return;
      const car = v!.car;
      for (let c = 0; c < lines.length; c++) {
        const ln = lines[c], sx = ln.p[0], sz = ln.p[1];
        const dx = car.pos.x - sx, dz = car.pos.z - sz;
        if (Math.abs(dx) > 40 || Math.abs(dz) > 40) { lastSide[c] = 0; continue; }
        const L = Math.hypot(ln.p[2] - sx, ln.p[3] - sz) || 1, ux = (ln.p[2] - sx) / L, uz = (ln.p[3] - sz) / L;
        const fwd = dx * ux + dz * uz, lat = Math.abs(-dx * uz + dz * ux);
        const side = fwd >= 0 ? 1 : -1;
        const crossed = lastSide[c] === -1 && side === 1 && lat < ln.hw + 4 && car.vel.x * ux + car.vel.z * uz > 3;
        lastSide[c] = side;
        if (crossed) { begin(c); return; }
      }
    },
    update(dt) {
      const cam = engine.camera.position;
      lines.forEach((ln, c) => {
        if (run || Math.abs(ln.p[0] - cam.x) > GATE_DRAW || Math.abs(ln.p[1] - cam.z) > GATE_DRAW) gates[c].hide();
        else gates[c].show(ln.p[0], ln.p[1], COLOR, Math.max(1.5, (ln.hw + 1) / 2.1));
        gates[c].update(dt);
      });
      nextMark.update(dt); finishMark.update(dt);
      if (run) {
        pTime.textContent = fmt(run.t);
        pCp.textContent = t('trial.cp', { i: run.next, n: lines[run.c].cps.length });
      }
      const nav = engine.get<NavApi>('nav');
      if (nav && !blipsOn) {
        blipsOn = true;
        nav.addBlips(() => {
          blips.length = 0;
          if (run) return blips;
          const p = pl.position;
          for (const ln of lines) if (nav.mapOpen || Math.hypot(ln.p[0] - p.x, ln.p[1] - p.z) < RADAR) blips.push({ kind: 'trial', x: ln.p[0], z: ln.p[1], label: nameOf(ln) });
          return blips;
        });
      }
    },
  };
  engine.add(api);
}
