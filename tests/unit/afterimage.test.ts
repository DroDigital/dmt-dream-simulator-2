import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/physics.ts';
import { tuning } from '../../src/core/tuning.ts';
import { Game, type NightRecord } from '../../src/director/game.ts';
import { replayNight } from '../../src/director/afterimage.ts';
import { dailyDream, decodeDreamCode, encodeDreamCode } from '../../src/director/codes.ts';
import { AttentiveBot } from '../helpers/bot.ts';

beforeAll(async () => {
  await initPhysics();
  // short nights keep the test fast; every realm's breath is 75 s
  for (const k of Object.keys(tuning.breath.base)) (tuning.breath.base as Record<string, number>)[k] = 75;
});

describe('Afterimage determinism', () => {
  it('records 3 nights of scripted input; each replays to identical links, notices and final hash', () => {
    const game = new Game({ runSeed: 31337, players: 1 });
    const bot = new AttentiveBot(31337);
    const records: NightRecord[] = [];
    game.events.on('nightEnd', () => { queueMicrotask(() => {}); });
    let lastNight = game.night;
    for (let t = 0; t < 60 * 60 * 20 && records.length < 3; t++) {
      game.step([bot.frame(game)]);
      if (game.night !== lastNight) { lastNight = game.night; records.push(game.lastNight!); }
    }
    expect(records.length).toBe(3);
    for (const rec of records) {
      expect(rec.linkLog.length + rec.noticeLog.length).toBeGreaterThan(0);
      const again = replayNight(rec);
      expect(again.linkLog.map((l) => [l.to, l.mode, l.object])).toEqual(rec.linkLog.map((l) => [l.to, l.mode, l.object]));
      expect(again.linkLog.map((l) => l.tick - rec.snapshot.tick)).toEqual(rec.linkLog.map((l) => l.tick - rec.snapshot.tick));
      expect(again.noticeLog).toEqual(rec.noticeLog);
      expect(again.finalHash).toBe(rec.finalHash);
    }
  }, 900_000);
});

describe('dream codes', () => {
  it('round-trips seed, night and laws in 12 characters with a check character', () => {
    const c = { runSeed: 0xdeadbeef, night: 123, laws: ['feather', 'mirror', 'sticky'] };
    const code = encodeDreamCode(c);
    expect(code).toHaveLength(12);
    expect(decodeDreamCode(code)).toEqual({ ...c, runSeed: 0xdeadbeef >>> 0 });
    expect(decodeDreamCode(code.slice(0, 11) + (code[11] === '0' ? '1' : '0'))).toBeNull();
    expect(decodeDreamCode(code.toLowerCase())).not.toBeNull();
  });
  it('Daily Dream is stable for a date and differs between dates', () => {
    const a = dailyDream(new Date('2026-11-16T10:00:00Z')), b = dailyDream(new Date('2026-11-16T22:00:00Z')), c = dailyDream(new Date('2026-11-17T10:00:00Z'));
    expect(a).toEqual(b);
    expect(a.runSeed).not.toBe(c.runSeed);
    expect(a.night).toBeGreaterThanOrEqual(1);
    expect(a.night).toBeLessThanOrEqual(365);
  });
  it('a code night dreams with that seed and laws and does not advance the night count', () => {
    const g = new Game({ runSeed: 1, players: 1 });
    g.codeNight = { runSeed: 777, night: 42, laws: ['feather'] };
    g.startNight();
    expect(g.laws).toEqual(['feather']);
    g.endNight('lie_down');
    expect(g.night).toBe(1);
  });
});
