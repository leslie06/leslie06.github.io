import { describe, expect, it } from 'vitest';
import { retry } from './Retry';

describe('retry', () => {
  const noWait = () => Promise.resolve();
  it('tries again after a failure and returns the first success', async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await retry('x', async () => { if (++n < 3) throw new Error('drop'); return 'ok'; }, 3, 100, (ms) => { waits.push(ms); return noWait(); });
    expect(r).toBe('ok');
    expect(n).toBe(3);
    expect(waits).toEqual([100, 200]);          // backing off
  });
  it('gives up after the last attempt with its error', async () => {
    let n = 0;
    await expect(retry('x', async () => { n++; throw new Error(`drop ${n}`); }, 3, 1, noWait)).rejects.toThrow('drop 3');
    expect(n).toBe(3);
  });
});
