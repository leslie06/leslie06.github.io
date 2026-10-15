import { describe, expect, it } from 'vitest';
import { apply, DEVICE_KEYS, fingerprint, meaningful, serialise, snapshot, summary } from './CloudSave';

/** A localStorage stand-in. */
function store(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

describe('cloud saves', () => {
  it('takes the game keys, not the device ones or anyone else\'s', () => {
    const s = store({ 'drivecity.cash': '500', 'drivecity.campaign.v1': '{"done":["m1"]}', 'drivecity.quality.choice': 'high', 'drivecity.acct.v1': '{}', 'other.thing': 'x' });
    expect(snapshot(s)).toEqual({ 'drivecity.cash': '500', 'drivecity.campaign.v1': '{"done":["m1"]}' });
    expect(DEVICE_KEYS.has('drivecity.lang.v1')).toBe(true);
  });

  it('applying a save replaces the game keys and keeps the device ones', () => {
    const s = store({ 'drivecity.cash': '500', 'drivecity.jumps.v1': '[1]', 'drivecity.quality.choice': 'low', 'drivecity.acct.v1': '{"name":"a"}' });
    apply(s, { 'drivecity.cash': '9000', 'drivecity.garage.v1': '{}', 'drivecity.quality.choice': 'high' });
    expect(s.dump()).toEqual({ 'drivecity.cash': '9000', 'drivecity.garage.v1': '{}', 'drivecity.quality.choice': 'low', 'drivecity.acct.v1': '{"name":"a"}' });
  });

  it('serialises the same save the same whatever the key order, and fingerprints differ when it changes', () => {
    const a = serialise({ 'drivecity.b': '1', 'drivecity.a': '2' }), b = serialise({ 'drivecity.a': '2', 'drivecity.b': '1' });
    expect(a).toBe(b);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint(serialise({ 'drivecity.a': '3', 'drivecity.b': '1' })));
  });

  it('sums a save up, and a browser that has only driven about has nothing worth keeping', () => {
    const full = { 'drivecity.campaign.v1': '{"done":["m1","m2"]}', 'drivecity.cash': '1200', 'drivecity.garage.v1': '{"body":"suv"}' };
    expect(summary(full)).toMatchObject({ chapters: 2, cash: 1200, car: true });
    expect(meaningful(full)).toBe(true);
    expect(meaningful({ 'drivecity.pid': '"abc"', 'drivecity.jumps.v1': '[]', 'drivecity.intro.v1': '1' })).toBe(false);
    expect(meaningful({ 'drivecity.cash': '5' })).toBe(true);
    expect(summary({ 'drivecity.campaign.v1': 'not json' }).chapters).toBe(0);
  });
});
