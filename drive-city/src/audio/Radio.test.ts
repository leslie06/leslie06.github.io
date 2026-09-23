import { describe, expect, it } from 'vitest';
import { arrange, type Song } from './Radio';

const song: Song = { title: 't', bpm: 92, root: 45, seed: 11, trap: false };
const trap: Song = { title: 't', bpm: 142, root: 41, seed: 23, trap: true };

describe('the radio\'s beats', () => {
  it('composes the same track from the same seed', () => {
    expect(arrange(song)).toEqual(arrange(song));
    expect(arrange(song)).not.toEqual(arrange({ ...song, seed: 12 }));
  });

  it('keeps a beat: kick on the one, a backbeat, hats, and a hook with notes in it', () => {
    for (const s of [song, trap]) {
      const a = arrange(s);
      expect(a.kick[0]).toBe(true);
      expect(a.kick[16]).toBe(true);
      // Boom-bap snares on two and four; trap on three (half time).
      if (s.trap) expect(a.snare[8] && a.snare[24]).toBe(true);
      else expect(a.snare[4] && a.snare[12] && a.snare[20] && a.snare[28]).toBe(true);
      expect(a.hat.filter((h) => h > 0).length).toBeGreaterThan(8);
      expect(a.hook.filter((n) => n >= 0).length).toBeGreaterThan(4);
      expect(a.bass[0]).toBe(true);
    }
  });
});
