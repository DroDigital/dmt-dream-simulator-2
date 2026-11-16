import { beforeAll, describe, expect, it } from 'vitest';
import { PCG32 } from '../../src/core/rng.ts';
import { tuning } from '../../src/core/tuning.ts';
import { initPhysics } from '../../src/core/physics.ts';
import { affinity, destinationWeights, rollDestination, rollGrammar } from '../../src/gameplay/linking.ts';
import { levelOf, lucidityTick, noticeValue } from '../../src/gameplay/lucidity.ts';
import { clampChart, clampMove, lutWeights, matchSecret, push, quadrantOf } from '../../src/director/resonance.ts';
import { newHousehold, planNight, roomInfluence } from '../../src/director/household.ts';
import { Game } from '../../src/director/game.ts';
import secret from '../../data/secret.json' with { type: 'json' };

const REALMS = [
  { id: 'a', tags: ['glass', 'light'], chart: [-2, -2] as [number, number] },
  { id: 'b', tags: ['paper'], chart: [2, -2] as [number, number] },
  { id: 'c', tags: ['glyph'], chart: [0, 3] as [number, number] },
  { id: 'd', tags: ['water'], chart: [0, 0] as [number, number] },
];

describe('link grammar + destination weights', () => {
  it('grammar: each tag favours 2-3 realms with ~90% of the weight, fixed per run seed', () => {
    const g = rollGrammar(5, REALMS);
    for (const row of Object.values(g)) {
      const w = Object.values(row).sort((x, y) => y - x);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      expect(w[0] + w[1] + (w[2] > 0.1 ? w[2] : 0)).toBeGreaterThan(0.85);
    }
    expect(rollGrammar(5, REALMS)).toEqual(g);
    expect(rollGrammar(6, REALMS)).not.toEqual(g);
  });
  it('guards: current realm and a third consecutive repeat are excluded', () => {
    const grammar = rollGrammar(1, REALMS);
    const base = { grammar, tags: ['glass' as const], realms: REALMS, resonance: [0, 0] as [number, number], recentNights: new Set<string>() };
    const w = destinationWeights({ ...base, current: 'a', recentLinks: [] });
    expect(w[0]).toBe(0);
    const w2 = destinationWeights({ ...base, current: 'a', recentLinks: ['b', 'b'] });
    expect(w2[1]).toBe(0);
    expect(w2[2] + w2[3]).toBeGreaterThan(0);
  });
  it('novelty boosts unseen realms 1.5x', () => {
    const grammar = rollGrammar(1, REALMS);
    const base = { grammar, tags: ['paper' as const], realms: REALMS, resonance: [0, 0] as [number, number], current: 'a', recentLinks: [] };
    const seen = destinationWeights({ ...base, recentNights: new Set(['b', 'c', 'd']) });
    const unseen = destinationWeights({ ...base, recentNights: new Set() });
    expect(unseen[1] / seen[1]).toBeCloseTo(1.5, 5);
  });
  it('affinity prefers realms near the resonance position', () => {
    expect(affinity([-2, -2], [-2, -2])).toBeGreaterThan(affinity([2, 3], [-2, -2]));
  });
  it('roll never returns the current realm and gives a distinct second', () => {
    const grammar = rollGrammar(3, REALMS);
    const rng = new PCG32(9);
    for (let i = 0; i < 200; i++) {
      const r = rollDestination({ grammar, tags: ['light'], realms: REALMS, resonance: [0, 0], current: 'd', recentLinks: [], recentNights: new Set() }, rng);
      expect(r.dest).not.toBe('d');
      expect(r.second).not.toBe(r.dest);
    }
  });
});

describe('lucidity', () => {
  it('levels at 25/50/75', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(levelOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it('notice diminishing returns 0.8^n', () => {
    expect(noticeValue(12, 0)).toBe(12);
    expect(noticeValue(12, 1)).toBeCloseTo(9.6);
    expect(noticeValue(12, 3)).toBeCloseTo(12 * 0.512);
  });
  it('decays above 50, drains when idle and near the Watcher', () => {
    const s = { lucidity: 60, kindCounts: {} };
    lucidityTick(s, 1, 0, false);
    expect(s.lucidity).toBeCloseTo(59.5);
    lucidityTick(s, 1, 31, false);
    expect(s.lucidity).toBeCloseTo(58);
    lucidityTick(s, 1, 0, true);
    expect(s.lucidity).toBeCloseTo(55.5);
    const low = { lucidity: 40, kindCounts: {} };
    lucidityTick(low, 1, 0, false);
    expect(low.lucidity).toBe(40);
  });
});

describe('resonance', () => {
  it('pushes and clamps to -4..4', () => {
    expect(push([0, 0], tuning.resonance.push.lanternfolk)).toEqual([0, -1]);
    expect(push([3.5, 3.9], [2, 2])).toEqual([4, 4]);
    expect(clampChart([-9, 9])).toEqual([-4, 4]);
  });
  it('quadrants and LUT weights', () => {
    expect(quadrantOf([-3, -3])).toBe('halo');
    expect(quadrantOf([3, -3])).toBe('bloom');
    expect(quadrantOf([-3, 3])).toBe('hush');
    expect(quadrantOf([3, 3])).toBe('undertow');
    expect(quadrantOf([0.5, -0.5])).toBe('centre');
    const w = lutWeights([0, 0]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(lutWeights([-4, -4])[0]).toBeCloseTo(1);
  });
  it('next start position moves at most 2 cells', () => {
    expect(clampMove([0, 0], [4, 1], 2)).toEqual([2, 0.5]);
    expect(clampMove([0, 0], [1, -1], 2)).toEqual([1, -1]);
  });
  it('chart secret matcher', () => {
    const steps = secret.pattern.steps as never[];
    expect(matchSecret([[-3, -3], [3, -3], [3, 3], [-3, 3], [0, 0]], steps)).toBe(true);
    expect(matchSecret([[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]], steps)).toBe(false);
  });
});

describe('souvenirs + room', () => {
  it('shelf influence adds vectors, floor counts a quarter', () => {
    const h = newHousehold(1);
    h.room['shelf-0'] = 'red-kite';       // bright + alive
    h.room['shelf-1'] = 'moon-pebble';    // deep + still
    h.room['floor-0'] = 'sand-scroll';    // deep + still (x0.25)
    const [x, y] = roomInfluence(h);
    expect(x).toBeCloseTo(-0.25);
    expect(y).toBeCloseTo(0.25);
  });
  it('bedside gives +5 starting lucidity; sill biases the first link tag', () => {
    const h = newHousehold(1);
    h.room['bedside'] = 'glass-bead';
    h.room['sill'] = 'paper-crane';
    const plan = planNight(h, 1);
    expect(plan.startLucidityBonus).toBe(5);
    expect(plan.tagBias.paper).toBe(2);
  });
  it('first night starts in the centre (Tidal Stair -> slice fallback)', () => {
    const plan = planNight(newHousehold(1), 1);
    expect(plan.startRealms[0]).toBe('evening-suburb');
    expect(plan.laws).toEqual([]);
  });
});

describe('breath', () => {
  beforeAll(async () => { await initPhysics(); });
  it('starts at the start realm base, gains +45 s on a first visit, caps at 2x base, drains 1 s/s', () => {
    const g = new Game({ runSeed: 3, players: 1 });
    g.startNight();
    const base = tuning.breath.base['evening-suburb'];
    expect(g.breath).toBe(base);
    expect(g.breathCap).toBe(base * 2);
    for (let i = 0; i < 60; i++) g.step([{ mx: 0, mz: 0, lx: 0.001, ly: 0, buttons: 0 }]);
    expect(g.breath).toBeCloseTo(base - 1, 1);
    g.addBreath(10000);
    expect(g.breath).toBe(base * 2);
  });
});
