/**
 * Seeded randomness. Every random number in the game flows from here.
 * PCG32 (XSH-RR, 64-bit state) implemented with BigInt-free 32-bit limbs so it is
 * fast and bit-exact everywhere. Never use Math.random in game code.
 */

const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;

/** 32-bit integer hash (lowbias32). */
export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Combine two values into one 32-bit seed. Order matters: hash(a,b) != hash(b,a). */
export function hash(a: number, b: number): number {
  const h = hash32((a >>> 0) ^ 0x9e3779b9);
  return hash32(h ^ Math.imul((b >>> 0) + 0x632be5ab, 0x85ebca6b));
}

/** Hash a string to 32 bits (FNV-1a then avalanche). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h);
}

export class PCG32 {
  // 64-bit state and increment as hi/lo 32-bit halves
  private sHi = 0;
  private sLo = 0;
  private iHi = 0;
  private iLo = 0;

  constructor(seed: number, stream = 0x14057b7e) {
    this.reseed(seed, stream);
  }

  reseed(seed: number, stream = 0x14057b7e): void {
    // inc = (stream << 1) | 1
    this.iHi = (stream >>> 31) >>> 0;
    this.iLo = ((stream << 1) | 1) >>> 0;
    this.iHi = (this.iHi ^ hash32(stream)) >>> 0;
    this.sHi = 0;
    this.sLo = 0;
    this.step();
    // state += seed (expanded to 64 bits)
    this.add64(hash32(seed ^ 0xa5a5a5a5), seed >>> 0);
    this.step();
  }

  private add64(hi: number, lo: number): void {
    const l = (this.sLo + lo) >>> 0;
    const carry = l < this.sLo ? 1 : 0;
    this.sLo = l;
    this.sHi = (this.sHi + hi + carry) >>> 0;
  }

  private step(): void {
    // state = state * MUL + inc  (mod 2^64)
    const aLo = this.sLo, aHi = this.sHi;
    // 32x32 -> 64 of aLo*MUL_LO using 16-bit pieces
    const a0 = aLo & 0xffff, a1 = aLo >>> 16;
    const b0 = MUL_LO & 0xffff, b1 = MUL_LO >>> 16;
    const p00 = a0 * b0;
    const p01 = a0 * b1;
    const p10 = a1 * b0;
    const p11 = a1 * b1;
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    const lo = ((mid << 16) | (p00 & 0xffff)) >>> 0;
    const hi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
    const newHi = (hi + Math.imul(aLo, MUL_HI) + Math.imul(aHi, MUL_LO)) >>> 0;
    this.sLo = lo;
    this.sHi = newHi;
    this.add64(this.iHi, this.iLo);
  }

  /** Next uniformly distributed uint32. */
  nextU32(): number {
    const oldHi = this.sHi, oldLo = this.sLo;
    this.step();
    // xorshifted = ((old >> 18) ^ old) >> 27   (take low 32 bits)
    const shHi = oldHi >>> 18;
    const shLo = ((oldLo >>> 18) | (oldHi << 14)) >>> 0;
    const xHi = (shHi ^ oldHi) >>> 0;
    const xLo = (shLo ^ oldLo) >>> 0;
    const xorshifted = ((xLo >>> 27) | (xHi << 5)) >>> 0;
    const rot = oldHi >>> 27;
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Pick an index by weights. Returns -1 if all weights are zero. */
  weighted(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = Math.max(0, weights[i]);
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Snapshot for save/restore (Afterimage). */
  getState(): [number, number, number, number] {
    return [this.sHi, this.sLo, this.iHi, this.iLo];
  }

  setState(s: readonly number[]): void {
    this.sHi = s[0] >>> 0; this.sLo = s[1] >>> 0; this.iHi = s[2] >>> 0; this.iLo = s[3] >>> 0;
  }
}
