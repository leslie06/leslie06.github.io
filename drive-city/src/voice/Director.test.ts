import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Director, type Line, type Output, type Sprite } from './Director';

const sprite = JSON.parse(fs.readFileSync(new URL('../../assets/voice/dist/sprite.json', import.meta.url), 'utf8')) as Sprite;

/** An output that plays instantly and records what happened. */
function stub(ready = true) {
  const played: Line[] = [], stopped: Line[] = [];
  const out: Output = { ready: () => ready, play: (l) => { played.push(l); }, stop: (l) => { stopped.push(l); } };
  return { out, played, stopped };
}
const seq = (xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('voice Director', () => {
  it('picks a line of the trigger in the speaker\'s own voice', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = d.speaker('uncle', 'm', seed);
      const l = d.say(s, 'near_miss')!;
      expect(l.clip.trigger).toBe('near_miss');
      expect(l.clip.voiceIndex).toBe(s.voiceIndex);
      expect(l.clip.id.startsWith('uncle_')).toBe(true);
      d.ended(l);
    }
  });

  it('gives a woman the woman\'s voice where an archetype has both', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    const f = sprite.archetypes.office!.voiceSex.indexOf('f'), m = sprite.archetypes.office!.voiceSex.indexOf('m');
    for (let seed = 0; seed < 20; seed++) {
      expect(d.speaker('office', 'f', seed).voiceIndex).toBe(f);
      expect(d.speaker('office', 'm', seed).voiceIndex).toBe(m);
    }
  });

  it('keeps one rate per speaker inside the range, and jitters each line by at most rateJitter', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    const [lo, hi] = sprite.archetypes.courier!.rateRange, j = sprite.playback.rateJitter;
    const rates = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = d.speaker('courier', 'm', seed);
      expect(s.rate).toBeGreaterThanOrEqual(lo);
      expect(s.rate).toBeLessThanOrEqual(hi);
      expect(d.speaker('courier', 'm', seed).rate).toBe(s.rate);   // the same speaker, the same rate
      rates.add(s.rate);
      const l = d.say(s, 'idle')!;
      expect(Math.abs(l.rate / s.rate - 1)).toBeLessThanOrEqual(j + 1e-9);
      d.ended(l);
    }
    expect(rates.size).toBeGreaterThan(20);
  });

  it('never repeats one of the last noRepeatLastVariants recordings of a trigger', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    const n = sprite.playback.noRepeatLastVariants;
    const history: string[] = [];
    for (let i = 0; i < 200; i++) {
      d.now += 100;   // past every cooldown
      const s = d.speaker('driver', 'm', 7);
      const l = d.say(s, 'car_stolen')!;
      const k = `${l.clip.id}#${l.clip.variant}`;
      expect(history.slice(-n)).not.toContain(k);
      history.push(k);
      d.ended(l);
    }
    expect(new Set(history).size).toBeGreaterThan(n + 1);   // and it does go round them all
  });

  it('holds each speaker to the trigger\'s cooldown', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    const s = d.speaker('uncle', 'm', 3);
    const cd = sprite.triggers.idle.cooldownSec;
    d.ended(d.say(s, 'idle')!);
    d.now += cd - 0.5;
    expect(d.say(s, 'idle')).toBeNull();
    const other = d.speaker('uncle', 'm', 4);
    expect(d.say(other, 'idle')).not.toBeNull();   // it is per speaker
    d.now += 1;
    expect(d.say(s, 'idle')).not.toBeNull();
    // a cooldown of 0 never holds (being hit)
    const h1 = d.say(s, 'hit')!; d.ended(h1);
    expect(d.say(s, 'hit')).not.toBeNull();
  });

  it('cuts a speaker\'s own line for one of the same or higher priority, not for a lower one', () => {
    const { out, stopped } = stub();
    const d = new Director(sprite, out);
    const s = d.speaker('auntie', 'f', 1);
    const idle = d.say(s, 'idle')!;          // priority 0
    let done: boolean | null = null;
    const hit = d.say(s, 'hit', (c) => { done = c; })!;   // 4 cuts it
    expect(stopped).toContain(idle);
    expect(d.say(s, 'greet')).toBeNull();     // 0 under 4: dropped
    expect(d.say(s, 'near_miss')).toBeNull();
    d.ended(hit);
    expect(done).toBe(true);
    expect(d.speakers).toBe(0);
  });

  it('allows maxConcurrentSpeakers at once and cuts the lowest only for a higher priority', () => {
    const { out, stopped } = stub();
    const d = new Director(sprite, out);
    const max = sprite.playback.maxConcurrentSpeakers;
    const lines: Line[] = [];
    for (let i = 0; i < max; i++) lines.push(d.say(d.speaker('office', 'm', i), i === 0 ? 'idle' : 'near_miss')!);
    expect(d.speakers).toBe(max);
    // one more at the lowest's priority or under: dropped
    expect(d.say(d.speaker('office', 'f', 50), 'greet')).toBeNull();
    // near_miss (2) outranks the idle (0): that one goes
    expect(d.say(d.speaker('office', 'f', 51), 'near_miss')).not.toBeNull();
    expect(stopped).toContain(lines[0]);
    expect(d.speakers).toBe(max);
    // all three now at 2: another near_miss is dropped, a hit (4) gets in
    expect(d.say(d.speaker('office', 'm', 52), 'near_miss')).toBeNull();
    expect(d.say(d.speaker('office', 'm', 53), 'hit')).not.toBeNull();
    expect(d.speakers).toBe(max);
  });

  it('reports a cut line to its callback once, with false', () => {
    const { out } = stub();
    const d = new Director(sprite, out);
    const s = d.speaker('guard', 'm', 2);
    const calls: boolean[] = [];
    d.say(s, 'police_call', (c) => calls.push(c));
    d.silence(s);
    d.silence(s);
    expect(calls).toEqual([false]);
    const calls2: boolean[] = [];
    const l = d.say(s, 'police_call', (c) => calls2.push(c))!;
    d.ended(l); d.ended(l);
    expect(calls2).toEqual([true]);
  });

  it('says nothing while the audio is not ready, and cuts nobody for it', () => {
    const { out, stopped } = stub(false);
    const d = new Director(sprite, out, seq([0.5]));
    expect(d.say(d.speaker('tourist', 'f', 1), 'greet')).toBeNull();
    expect(stopped.length).toBe(0);
  });

  it('has lines for every trigger an archetype is written for', () => {
    for (const [arch, a] of Object.entries(sprite.archetypes)) {
      for (const c of a!.clips) expect(sprite.triggers[c.trigger], `${arch} ${c.id}`).toBeTruthy();
      expect(a!.voiceSex.length).toBeGreaterThan(0);
    }
  });
});
