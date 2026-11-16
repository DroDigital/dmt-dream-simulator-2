/** Hidden lucidity 0..100 per dreamer (§3.5). Never shown as a number. */
import { tuning } from '../core/tuning.ts';

export type LucidityLevel = 0 | 1 | 2 | 3;
export const LEVEL_NAMES = ['drowsy', 'aware', 'lucid', 'clear'] as const;

export function levelOf(l: number): LucidityLevel {
  const t = tuning.lucidity.levels;
  return l >= t[3] ? 3 : l >= t[2] ? 2 : l >= t[1] ? 1 : 0;
}

export interface LucidityState {
  lucidity: number;
  /** Notices of each kind tonight (diminishing returns 0.8^n). */
  kindCounts: Record<string, number>;
}

/** Value of a notice of `kind` given how many of that kind were already noticed tonight. */
export function noticeValue(base: number, previous: number): number {
  return base * Math.pow(tuning.notice.repeatFactor, previous);
}

/** Per-tick passive change. Returns the delta applied. */
export function lucidityTick(s: LucidityState, dt: number, idleS: number, watcherNear: boolean): number {
  const L = tuning.lucidity.loss;
  let d = 0;
  if (s.lucidity > 50) d -= L.decayAbove50 * dt;
  if (idleS > L.idleS) d -= L.idlePerS * dt;
  if (watcherNear) d -= L.watcherPerS * dt;
  s.lucidity = clampL(s.lucidity + d);
  return d;
}

export function clampL(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Float time limit at a lucidity level (§3.3 + §3.5). */
export function floatLimit(level: LucidityLevel): number {
  return level >= 3 ? Infinity : level >= 1 ? tuning.move.floatTimeAware : tuning.move.floatTime;
}
