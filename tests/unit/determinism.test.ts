import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/physics.ts';
import { Game } from '../../src/director/game.ts';
import type { InputFrame } from '../../src/core/input.ts';
import { Bot } from '../helpers/bot.ts';

beforeAll(async () => { await initPhysics(); });

function record(seed: number, ticks: number) {
  const game = new Game({ runSeed: seed, players: 1 });
  const bot = new Bot(seed);
  const log: InputFrame[][] = [];
  for (let t = 0; t < ticks; t++) {
    const f = [bot.frame(game)];
    log.push(f);
    game.step(f);
  }
  return { game, log };
}

describe('determinism', () => {
  it('same seed + same inputs => identical link sequence and state hash', () => {
    const { game: a, log } = record(1234, 60 * 90);
    expect(a.linkLog.length).toBeGreaterThan(0);
    const b = new Game({ runSeed: 1234, players: 1 });
    for (const f of log) b.step(f);
    expect(b.linkLog).toEqual(a.linkLog);
    expect(b.noticeLog).toEqual(a.noticeLog);
    expect(b.stateHash()).toBe(a.stateHash());
  });
  it('different seeds diverge', () => {
    const a = record(1, 60 * 40).game, b = record(2, 60 * 40).game;
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('M1 night loop', () => {
  it('flat -> lie down -> evening suburb -> links -> breath runs out -> wake in flat', () => {
    const game = new Game({ runSeed: 77, players: 1 });
    const bot = new Bot(77);
    const seen = new Set<string>();
    let started = false, ended = false;
    game.events.on('nightStart', () => { started = true; });
    game.events.on('nightEnd', (e) => { ended = e.reason === 'breath'; });
    for (let t = 0; t < 60 * 60 * 25 && !ended; t++) {
      game.step([bot.frame(game)]);
      if (game.mode === 'night') seen.add(game.dreamers[0].visit.realm);
    }
    expect(started).toBe(true);
    expect(game.linkLog[0].from).toBe('evening-suburb');
    expect(ended).toBe(true);
    expect(game.mode).toBe('morning');
    expect(game.dreamers[0].visit.realm).toBe('lantern-flat');
    expect(game.night).toBe(2);
    expect([...seen].some((r) => r === 'prism-cathedral' || r === 'glyph-desert')).toBe(true);
    expect(game.noticeLog.length).toBeGreaterThan(0);
    console.log('notices', game.noticeLog.length, 'links', game.linkLog.length, 'maxLucidity', game.dreamers[0].maxLucidity.toFixed(1));
  });
});
