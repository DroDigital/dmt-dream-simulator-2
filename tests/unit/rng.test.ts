import { describe, expect, it } from 'vitest';
import { PCG32, hash, hash32, hashString } from '../../src/core/rng.ts';

/** Reference PCG32 (XSH-RR) with BigInt. */
function refNext(state: bigint, inc: bigint): [number, bigint] {
  const M = 6364136223846793005n, MASK = (1n << 64n) - 1n;
  const old = state;
  const next = (old * M + inc) & MASK;
  const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
  const rot = Number(old >> 59n);
  return [((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0, next];
}

describe('PCG32', () => {
  it('matches the BigInt reference step for step', () => {
    const r = new PCG32(12345);
    const [sHi, sLo, iHi, iLo] = r.getState();
    let state = (BigInt(sHi) << 32n) | BigInt(sLo);
    const inc = (BigInt(iHi) << 32n) | BigInt(iLo);
    for (let i = 0; i < 1000; i++) {
      const [v, ns] = refNext(state, inc);
      state = ns;
      expect(r.nextU32()).toBe(v);
    }
  });
  it('is deterministic per seed and differs across seeds', () => {
    const a = new PCG32(7), b = new PCG32(7), c = new PCG32(8);
    const sa = Array.from({ length: 20 }, () => a.nextU32());
    const sb = Array.from({ length: 20 }, () => b.nextU32());
    const sc = Array.from({ length: 20 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it('produces roughly uniform floats in [0,1)', () => {
    const r = new PCG32(99);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); bins[Math.floor(v * 10)]++; }
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500);
  });
  it('state round-trips', () => {
    const r = new PCG32(3);
    r.next(); r.next();
    const s = r.getState();
    const x = [r.next(), r.next()];
    r.setState(s);
    expect([r.next(), r.next()]).toEqual(x);
  });
  it('weighted picks honour zero weights', () => {
    const r = new PCG32(1);
    for (let i = 0; i < 500; i++) expect(r.weighted([0, 1, 0, 2])).not.toBe(0);
    expect(r.weighted([0, 0])).toBe(-1);
  });
});

describe('hash', () => {
  it('is stable and order-sensitive', () => {
    expect(hash(1, 2)).toBe(hash(1, 2));
    expect(hash(1, 2)).not.toBe(hash(2, 1));
    expect(hash32(0)).toBe(hash32(0));
    expect(hashString('evening-suburb')).toBe(hashString('evening-suburb'));
    // known values (regression guard)
    expect(hash(0, 0)).toMatchInlineSnapshot(`3451288414`);
  });
  it('avalanches', () => {
    let diff = 0;
    for (let i = 0; i < 256; i++) diff += popcount(hash(i, 5) ^ hash(i + 1, 5));
    expect(diff / 256).toBeGreaterThan(12);
    expect(diff / 256).toBeLessThan(20);
  });
});
function popcount(x: number) { let c = 0; x >>>= 0; while (x) { c += x & 1; x >>>= 1; } return c; }
