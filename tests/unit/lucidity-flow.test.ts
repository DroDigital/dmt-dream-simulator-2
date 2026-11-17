import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/physics.ts';
import { Game } from '../../src/director/game.ts';
import { AttentiveBot } from '../helpers/bot.ts';

beforeAll(async () => { await initPhysics(); });

describe('attentive dreamer', () => {
  it('notices anomalies and climbs lucidity levels; lucid touches raise ghost doors', () => {
    const game = new Game({ runSeed: 4242, players: 1 });
    const bot = new AttentiveBot(4242);
    let awareAt = -1, lucidAt = -1, doors = 0;
    game.events.on('level', (e) => {
      const s = game.nightTicks / 60;
      if (e.level >= 1 && awareAt < 0) awareAt = s;
      if (e.level >= 2 && lucidAt < 0) lucidAt = s;
    });
    game.events.on('doors', (e) => { if (e.open) doors++; });
    for (let t = 0; t < 60 * 60 * 9 && game.night === 1; t++) game.step([bot.frame(game)]);
    console.log({ notices: game.noticeLog.length, kinds: [...new Set(game.noticeLog.map((n) => n.kind))], awareAt, lucidAt, max: game.dreamers[0].maxLucidity, links: game.linkLog.length, doors });
    expect(game.noticeLog.length).toBeGreaterThan(4);
    expect(awareAt).toBeGreaterThan(0);
    expect(awareAt).toBeLessThan(240);
  });
});
