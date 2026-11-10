import { describe, expect, it } from 'vitest';
import { NavVoice, navVoicePref, type NavView } from './NavVoice';
import type { CityClips } from './CityClips';
import type { Turn } from '../nav/Turns';

/** A fake audio context: time moves only when the test says so. */
function fakeCtx() {
  const node = () => ({ gain: { value: 1, setTargetAtTime() {} }, connect: (x: unknown) => x, start() {}, buffer: null });
  return { currentTime: 0, createGain: node, createBufferSource: node } as unknown as AudioContext & { currentTime: number };
}

function drive(turns: Turn[], speed: number, opts: { quiet?: boolean; until?: number; kind?: string } = {}) {
  const ctx = fakeCtx();
  const said: string[][] = [];
  const clips = { load: () => Promise.resolve(null) } as unknown as CityClips;
  const nv = new NavVoice(ctx, {} as AudioNode, clips, () => {});
  (nv as unknown as { say: (ids: (string | null)[]) => void }).say = (ids) => said.push(ids.filter((x): x is string => !!x));
  const gps = { s: 0, turns };
  const view: NavView = { target: { kind: opts.kind ?? 'waypoint', x: 100, z: 100 }, gps, routeLeft: 0 };
  const end = opts.until ?? turns[turns.length - 1].s;
  for (let t = 0; gps.s < end; t += 0.1) {
    (ctx as { currentTime: number }).currentTime = t;
    gps.s += speed * 0.1;
    nv.update(view, speed, true, !!opts.quiet);
  }
  return said;
}

describe('NavVoice', () => {
  navVoicePref.set('f');
  it('says the start, then each turn far and near, with the road and what follows', () => {
    const said = drive([{ s: 900, kind: 'R', road: '东三环' }, { s: 1000, kind: 'L', road: '' }, { s: 2400, kind: 'arrive', road: '' }], 14);
    expect(said[0]).toEqual(['nav.f.start']);
    // 14 m/s: the far prompt from ~560 m out, the nearest recorded distance; the near one 5 s out
    expect(said[1][0]).toBe('nav.f.far.500.R');
    expect(said[1][1]).toMatch(/^nav\.f\.road\./);
    expect(said[1][2]).toBe('nav.f.then.L');
    expect(said[2]).toEqual(['nav.f.near.R', 'nav.f.then.L']);
    // the left 100 m on: too close for a far prompt, only the near one, then the arrival
    expect(said[3]).toEqual(['nav.f.near.L']);
    expect(said.at(-2)?.[0]).toBe('nav.f.far.500.arrive');
    expect(said.at(-1)).toEqual(['nav.f.near.arrive']);
  });
  it('starts from a kilometre at speed', () => {
    const said = drive([{ s: 3000, kind: 'exit', road: '' }], 25);
    expect(said[1]).toEqual(['nav.f.far.1000.exit']);
  });
  it('keeps quiet about straight on onto a road it has no recording of', () => {
    const said = drive([{ s: 800, kind: 'S', road: '无名路' }, { s: 1600, kind: 'arrive', road: '' }], 14);
    expect(said.flat().some((id) => id.includes('.S'))).toBe(false);
  });
  it('only the near prompts while someone is talking', () => {
    const said = drive([{ s: 900, kind: 'R', road: '' }, { s: 2000, kind: 'arrive', road: '' }], 14, { quiet: true });
    expect(said.flat().some((id) => id.includes('.far.'))).toBe(false);
    expect(said.flat()).toContain('nav.f.near.R');
  });
  it('says nothing for the story start', () => {
    expect(drive([{ s: 900, kind: 'R', road: '' }], 14, { kind: 'story' })).toEqual([]);
  });
});
