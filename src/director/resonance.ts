/** Resonance chart (§3.8): x = Still(-4) .. Alive(+4), y = Bright(-4) .. Deep(+4). */
import { tuning } from '../core/tuning.ts';

export type Vec2 = [number, number];
export type Quadrant = 'halo' | 'bloom' | 'hush' | 'undertow' | 'centre';

export function clampChart(p: Vec2): Vec2 {
  const { min, max } = tuning.resonance;
  return [Math.max(min, Math.min(max, p[0])), Math.max(min, Math.min(max, p[1]))];
}

export function push(p: Vec2, d: readonly number[], scale = 1): Vec2 {
  return clampChart([p[0] + d[0] * scale, p[1] + d[1] * scale]);
}

export function quadrantOf(p: Vec2): Quadrant {
  const [x, y] = p;
  if (Math.abs(x) < 1 && Math.abs(y) < 1) return 'centre';
  if (y <= 0) return x <= 0 ? 'halo' : 'bloom';
  return x <= 0 ? 'hush' : 'undertow';
}

/** depth 0 at full Bright, 1 at full Deep. */
export function depthOf(p: Vec2): number {
  return (p[1] + 4) / 8;
}

/** Bilinear weights of the four quadrant LUTs at a chart position: [halo, bloom, hush, undertow]. */
export function lutWeights(p: Vec2): [number, number, number, number] {
  const u = (p[0] + 4) / 8, v = (p[1] + 4) / 8;
  return [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
}

/** Move `from` toward `to` by at most `maxCells` (Chebyshev). */
export function clampMove(from: Vec2, to: Vec2, maxCells: number): Vec2 {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m <= maxCells) return clampChart(to);
  return clampChart([from[0] + (dx / m) * maxCells, from[1] + (dy / m) * maxCells]);
}

export interface Dot { night: number; dreamer: number; x: number; y: number }

/** Data-driven chart-secret matcher (pattern in data/secret.json). */
export interface SecretStep { quadrant?: Quadrant; cell?: Vec2; radius?: number }
export function matchSecret(groupDots: Vec2[], steps: SecretStep[]): boolean {
  if (groupDots.length < steps.length) return false;
  const tail = groupDots.slice(-steps.length);
  return steps.every((s, i) => {
    const p = tail[i];
    if (s.quadrant) return quadrantOf(p) === s.quadrant;
    if (s.cell) return Math.max(Math.abs(Math.round(p[0]) - s.cell[0]), Math.abs(Math.round(p[1]) - s.cell[1])) <= (s.radius ?? 0);
    return false;
  });
}
