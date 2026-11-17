import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/physics.ts';
import { tuning } from '../../src/core/tuning.ts';
import { SOUVENIRS, LAWS } from '../../src/director/household.ts';
import { EVENTS } from '../../src/director/director.ts';
import { VISIONS } from '../../src/director/visions.ts';
import { DREAM_REALMS, REALM_DATA } from '../../src/realms/registry.ts';
import { generateLayout, validateLayout } from '../../src/realms/layoutgen.ts';
import { rollDestination, rollGrammar } from '../../src/gameplay/linking.ts';
import { META } from '../../src/realms/registry.ts';
import { PCG32, hash } from '../../src/core/rng.ts';
import { Game } from '../../src/director/game.ts';
import { Bot } from '../helpers/bot.ts';
import sets from '../../data/sets.json' with { type: 'json' };
import diary from '../../data/diary.json' with { type: 'json' };
import { atlasTotal } from '../../src/ui/atlas.ts';

describe('M4 content', () => {
  it('ships the content counts from the brief', () => {
    expect(DREAM_REALMS.length).toBe(12);
    expect(SOUVENIRS.length).toBeGreaterThanOrEqual(120);
    expect(sets.sets.length).toBe(12);
    const ids = new Set(SOUVENIRS.map((s) => s.id));
    for (const s of sets.sets) for (const m of s.members) expect(ids.has(m), `${s.id}:${m}`).toBe(true);
    expect(LAWS.length).toBe(40);
    expect(EVENTS.length).toBeGreaterThanOrEqual(200);
    expect(VISIONS.length).toBe(20);
    expect(diary.fragments.length).toBe(365);
    expect(atlasTotal()).toBeGreaterThan(550);
  });
  it('every realm generates valid layouts', () => {
    for (const r of DREAM_REALMS) for (const seed of [1, 2]) {
      const { layout } = generateLayout(REALM_DATA[r], hash(seed, 77));
      expect(validateLayout(REALM_DATA[r], layout).ok, r).toBe(true);
    }
  });
  it('every realm is reachable by links over 100 run seeds', () => {
    const seen = new Set<string>();
    const realms = DREAM_REALMS.map((id) => ({ id, chart: META.get(id)!.chart }));
    for (let s = 0; s < 100; s++) {
      const grammar = rollGrammar(s, DREAM_REALMS.map((id) => ({ id, tags: META.get(id)!.tags })));
      const rng = new PCG32(s);
      let cur = 'tidal-stair';
      for (let k = 0; k < 30; k++) {
        const tags = [(['water', 'light', 'paper', 'glass', 'flesh', 'glyph', 'machine'] as const)[rng.int(7)]];
        cur = rollDestination({ grammar, tags: [...tags], realms, resonance: [rng.range(-4, 4), rng.range(-4, 4)], current: cur, recentLinks: [], recentNights: new Set() }, rng).dest;
        seen.add(cur);
      }
    }
    expect([...seen].sort()).toEqual([...DREAM_REALMS].sort());
  });
});

describe('bot playtest', () => {
  beforeAll(async () => {
    await initPhysics();
    for (const k of Object.keys(tuning.breath.base)) (tuning.breath.base as Record<string, number>)[k] = 40;
  });
  it('20 nights at accelerated time: no crash, every night ends', () => {
    const g = new Game({ runSeed: 2024, players: 1 });
    const bot = new Bot(2024);
    let ended = 0;
    g.events.on('nightEnd', () => { ended++; });
    for (let t = 0; t < 60 * 60 * 90 && ended < 20; t++) g.step([bot.frame(g)]);
    expect(ended).toBe(20);
    expect(g.night).toBe(21);
  }, 900_000);
});
