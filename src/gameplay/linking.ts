/**
 * Link destination choice (§3.6).
 *   w_r = grammar[tag][r] * affinity(r, resonance) * novelty_r * guard_r
 */
import { PCG32, hash } from '../core/rng.ts';
import { ALL_TAGS, type Tag } from '../realms/types.ts';

export type Grammar = Record<Tag, Record<string, number>>;

/**
 * Roll the run's link grammar: each tag favours 2-3 realms sharing ~90% of its weight;
 * the remaining ~10% is spread over every other realm. Realms that carry the tag are favoured first.
 */
export function rollGrammar(runSeed: number, realms: { id: string; tags: string[] }[], favoured: [number, number] = [2, 3], share = 0.9): Grammar {
  const rng = new PCG32(hash(runSeed, 0x6a3), 0x67);
  const g = {} as Grammar;
  for (const tag of ALL_TAGS) {
    const n = Math.min(realms.length, favoured[0] + rng.int(favoured[1] - favoured[0] + 1));
    const carriers = rng.shuffle(realms.filter((r) => r.tags.includes(tag)).map((r) => r.id));
    const others = rng.shuffle(realms.filter((r) => !r.tags.includes(tag)).map((r) => r.id));
    const fav = [...carriers, ...others].slice(0, n);
    const row: Record<string, number> = {};
    const rest = realms.length - fav.length;
    // uneven split among favoured realms so the grammar has a clear first choice
    const raw = fav.map(() => 0.6 + rng.next());
    const sum = raw.reduce((a, b) => a + b, 0);
    for (const r of realms) row[r.id] = rest > 0 ? (1 - share) / rest : 0;
    fav.forEach((id, i) => { row[id] = (raw[i] / sum) * (rest > 0 ? share : 1); });
    g[tag] = row;
  }
  return g;
}

/** Affinity of a realm to the current Resonance position: a soft Gaussian over chart distance with a floor. */
export function affinity(realmChart: readonly [number, number], resonance: readonly [number, number]): number {
  const d2 = (realmChart[0] - resonance[0]) ** 2 + (realmChart[1] - resonance[1]) ** 2;
  return 0.25 + Math.exp(-d2 / (2 * 3 * 3));
}

export interface WeightContext {
  grammar: Grammar;
  tags: readonly Tag[];
  realms: { id: string; chart: readonly [number, number] }[];
  resonance: readonly [number, number];
  current: string;
  /** Destinations of the dreamer's recent links, newest last. */
  recentLinks: readonly string[];
  /** Realms seen in the last N nights (novelty). */
  recentNights: ReadonlySet<string>;
  noveltyBoost?: number;
  /** Extra multiplier per tag (window-sill souvenir doubles its tag). */
  tagBias?: Partial<Record<Tag, number>>;
}

export function destinationWeights(ctx: WeightContext): number[] {
  const tags = ctx.tags.length ? ctx.tags : ALL_TAGS;
  const last2 = ctx.recentLinks.slice(-2);
  return ctx.realms.map((r) => {
    let grammar = 0;
    for (const t of tags) grammar += (ctx.grammar[t]?.[r.id] ?? 0) * (ctx.tagBias?.[t] ?? 1);
    grammar /= tags.length;
    const novelty = ctx.recentNights.has(r.id) ? 1 : ctx.noveltyBoost ?? 1.5;
    const guard = r.id === ctx.current || (last2.length === 2 && last2[0] === r.id && last2[1] === r.id) ? 0 : 1;
    return grammar * affinity(r.chart, ctx.resonance) * novelty * guard;
  });
}

/** Roll a destination. Returns the realm id, plus the next-best for ghost doors. */
export function rollDestination(ctx: WeightContext, rng: PCG32): { dest: string; second: string } {
  const w = destinationWeights(ctx);
  let i = rng.weighted(w);
  if (i < 0) i = ctx.realms.findIndex((r) => r.id !== ctx.current);
  const dest = ctx.realms[i].id;
  let best = -1, bestW = -1;
  w.forEach((v, k) => { if (k !== i && v > bestW) { bestW = v; best = k; } });
  const second = best >= 0 && bestW > 0 ? ctx.realms[best].id : ctx.realms.find((r) => r.id !== dest && r.id !== ctx.current)?.id ?? dest;
  return { dest, second };
}
