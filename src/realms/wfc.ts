import { PCG32 } from '../core/rng.ts';
import type { Dir, KitDef, RulesDef, TileDef } from './types.ts';

export interface Variant {
  tile: TileDef;
  tileIndex: number;
  rot: number;
  sockets: [string, string, string, string];
  weight: number;
}

const OPP = [2, 3, 0, 1];
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];

export function dirIndex(d: Dir): number {
  return d === 'N' ? 0 : d === 'E' ? 1 : d === 'S' ? 2 : 3;
}

export function rotatedSockets(s: readonly string[], rot: number): [string, string, string, string] {
  const out: string[] = [];
  for (let d = 0; d < 4; d++) out.push(s[(d - rot + 4) % 4]);
  return out as [string, string, string, string];
}

export function buildVariants(kit: KitDef): Variant[] {
  const out: Variant[] = [];
  kit.tiles.forEach((tile, tileIndex) => {
    const n = tile.rotations ?? 1;
    const seen = new Set<string>();
    for (let r = 0; r < 4; r += 4 / n) {
      const sockets = rotatedSockets(tile.sockets, r);
      const key = sockets.join('|');
      // Rotations that change the floor (ramps) are distinct even with the same sockets.
      const fkey = tile.floor.kind === 'ramp' ? key + r : key;
      if (seen.has(fkey)) continue;
      seen.add(fkey);
      out.push({ tile, tileIndex, rot: r, sockets, weight: tile.weight });
    }
  });
  return out;
}

export function socketsCompatible(a: string, b: string, compat: Set<string>): boolean {
  return a === b || a === '*' || b === '*' || compat.has(a + '\u0000' + b);
}

export interface WfcResult {
  ok: boolean;
  cells: Int16Array;
}

/**
 * Seeded simple-tiled wave-function collapse on a square grid, using bitsets
 * (W 32-bit words per cell) for fast propagation.
 * `fixed` maps cell index -> variant index (pre-collapsed).
 */
export function solveWfc(
  variants: Variant[],
  rules: RulesDef,
  grid: number,
  rng: PCG32,
  weights: Float64Array,
  fixed: Map<number, number>,
): WfcResult {
  const V = variants.length;
  const W = Math.ceil(V / 32);
  const N = grid * grid;
  const compatSet = new Set<string>();
  for (const [a, b] of rules.compatible) {
    compatSet.add(a + '\u0000' + b);
    compatSet.add(b + '\u0000' + a);
  }
  // allowed[d][a*W + w]: bitset of b that may sit in direction d of a
  const allowed: Uint32Array[] = [];
  for (let d = 0; d < 4; d++) {
    const m = new Uint32Array(V * W);
    for (let a = 0; a < V; a++) {
      for (let b = 0; b < V; b++) {
        if (socketsCompatible(variants[a].sockets[d], variants[b].sockets[OPP[d]], compatSet)) {
          m[a * W + (b >>> 5)] |= 1 << (b & 31);
        }
      }
    }
    allowed.push(m);
  }
  const logw = new Float64Array(V);
  for (let k = 0; k < V; k++) logw[k] = weights[k] > 0 ? weights[k] * Math.log(weights[k]) : 0;

  const poss = new Uint32Array(N * W);
  const full = new Uint32Array(W);
  for (let k = 0; k < V; k++) full[k >>> 5] |= 1 << (k & 31);
  for (let c = 0; c < N; c++) for (let w = 0; w < W; w++) poss[c * W + w] = full[w];
  const collapsed = new Uint8Array(N);
  const cells = new Int16Array(N).fill(-1);
  const stack: number[] = [];
  const ent = new Float64Array(N);
  const noise = new Float64Array(N);
  for (let i = 0; i < N; i++) noise[i] = rng.next() * 0.1;
  const tmp = new Uint32Array(W);

  const popcount = (x: number) => {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  const countOf = (c: number) => {
    let n = 0;
    for (let w = 0; w < W; w++) n += popcount(poss[c * W + w]);
    return n;
  };
  const entropy = (c: number): number => {
    let sw = 0, swl = 0;
    for (let k = 0; k < V; k++) {
      if (!(poss[c * W + (k >>> 5)] & (1 << (k & 31)))) continue;
      if (weights[k] <= 0) continue;
      sw += weights[k];
      swl += logw[k];
    }
    return sw > 0 ? Math.log(sw) - swl / sw + noise[c] : noise[c];
  };
  const setOnly = (c: number, v: number) => {
    for (let w = 0; w < W; w++) poss[c * W + w] = 0;
    poss[c * W + (v >>> 5)] = 1 << (v & 31);
    collapsed[c] = 1;
    stack.push(c);
  };

  const propagate = (): boolean => {
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % grid, cz = (c / grid) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= grid || nz >= grid) continue;
        const n = nz * grid + nx;
        const al = allowed[d];
        tmp.fill(0);
        for (let w = 0; w < W; w++) {
          let bits = poss[c * W + w];
          while (bits) {
            const low = bits & -bits;
            const a = (w << 5) + (31 - Math.clz32(low));
            for (let w2 = 0; w2 < W; w2++) tmp[w2] |= al[a * W + w2];
            bits ^= low;
          }
        }
        let changed = false, empty = true;
        for (let w = 0; w < W; w++) {
          const before = poss[n * W + w];
          const after = (before & tmp[w]) >>> 0;
          if (after !== before) { poss[n * W + w] = after; changed = true; }
          if (after) empty = false;
        }
        if (empty) return false;
        if (changed) { ent[n] = entropy(n); stack.push(n); }
      }
    }
    return true;
  };

  for (let i = 0; i < N; i++) ent[i] = entropy(i);
  for (const [c, v] of fixed) setOnly(c, v);
  if (!propagate()) return { ok: false, cells };

  const w = new Float64Array(V);
  for (;;) {
    let best = -1;
    let bestE = Infinity;
    for (let c = 0; c < N; c++) {
      if (collapsed[c]) continue;
      if (countOf(c) <= 1) { collapsed[c] = 1; continue; }
      const e = ent[c];
      if (e < bestE) { bestE = e; best = c; }
    }
    if (best < 0) break;
    for (let k = 0; k < V; k++) {
      w[k] = poss[best * W + (k >>> 5)] & (1 << (k & 31)) ? Math.max(weights[k], 1e-6) : 0;
    }
    const pick = rng.weighted(w);
    if (pick < 0) return { ok: false, cells };
    setOnly(best, pick);
    if (!propagate()) return { ok: false, cells };
  }

  for (let c = 0; c < N; c++) {
    for (let k = 0; k < V; k++) if (poss[c * W + (k >>> 5)] & (1 << (k & 31))) { cells[c] = k; break; }
    if (cells[c] < 0) return { ok: false, cells };
  }
  return { ok: true, cells };
}
