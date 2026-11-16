import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/physics.ts';
import { Visit } from '../../src/director/visit.ts';
import { REALM_DATA } from '../../src/realms/registry.ts';
import { generateLayout } from '../../src/realms/layoutgen.ts';
import { stepWatcher, watcherChance, type Watcher } from '../../src/entities/watcher.ts';
import { tuning } from '../../src/core/tuning.ts';
import { Game } from '../../src/director/game.ts';
import { Bot } from '../helpers/bot.ts';

let visit: Visit;
beforeAll(async () => {
  await initPhysics();
  visit = new Visit(REALM_DATA['glyph-desert'], generateLayout(REALM_DATA['glyph-desert'], 5).layout, 5, 0);
});

const mk = (x: number, z: number, dirX = 1, dirZ = 0): Watcher => ({
  visitId: visit.id, x, y: 0, z, dirX, dirZ, state: 'walking', follow: [0, 0, 0, 0], stopT: 0, detour: 0, detourX: 0, detourZ: 0, doorway: null, t: 0, met: 0,
});

describe('Watcher', () => {
  it('spawn chance rises with depth', () => {
    expect(watcherChance(0)).toBeCloseTo(0.02);
    expect(watcherChance(1)).toBeCloseTo(0.08);
  });
  it('walks straight at 1.1 m/s and never turns', () => {
    const w = mk(50, 50);
    for (let i = 0; i < 60; i++) stepWatcher(w, visit, []);
    expect(w.x).toBeCloseTo(50 + tuning.watcher.speed, 2);
    expect(w.z).toBeCloseTo(50, 5);
  });
  it('Walking -> Near -> Contact', () => {
    const w = mk(50, 50);
    const d = { index: 0, x: 62, z: 50, lucidity: 40, awake: false };
    stepWatcher(w, visit, [d]);
    expect(w.state).toBe('walking');
    let r = stepWatcher(w, visit, [{ ...d, x: 58 }]);
    expect(w.state).toBe('near');
    expect(r.firstMet).toEqual([0]);
    r = stepWatcher(w, visit, [{ ...d, x: w.x + 0.5 }]);
    expect(r.contact).toEqual([0]);
    expect(w.state).toBe('contact');
  });
  it('Followed: 30 s at 3-8 m behind opens a doorway, then Gone', () => {
    const w = mk(40, 50);
    let doorway = null;
    for (let i = 0; i < 60 * 31 && !doorway; i++) doorway = stepWatcher(w, visit, [{ index: 1, x: w.x - 5, z: w.z, lucidity: 50, awake: false }]).doorway;
    expect(doorway).not.toBeNull();
    expect(w.state).toBe('followed');
    let gone = false;
    for (let i = 0; i < 60 * 5 && !gone; i++) gone = stepWatcher(w, visit, []).gone;
    expect(gone).toBe(true);
  });
  it('Shield: a dreamer between him and another stops him for 2 s, then he walks the long way round', () => {
    const w = mk(50, 50);
    const shield = { index: 0, x: 52.5, z: 50.3, lucidity: 30, awake: false };
    const other = { index: 1, x: 58, z: 50, lucidity: 30, awake: false };
    stepWatcher(w, visit, [shield, other]);
    expect(w.stopT).toBeGreaterThan(1.9);
    const x0 = w.x;
    for (let i = 0; i < 100; i++) stepWatcher(w, visit, [shield, other]);
    expect(w.x).toBeCloseTo(x0, 5); // stopped
    for (let i = 0; i < 120; i++) stepWatcher(w, visit, [shield, other]);
    expect(Math.abs(w.z - 50)).toBeGreaterThan(1); // detouring sideways
  });
});

describe('co-op', () => {
  it('4 dreamers run a full night with bots without crashing and the night ends', () => {
    const g = new Game({ runSeed: 99, players: 4 });
    const bots = [0, 1, 2, 3].map((i) => new Bot(99 + i, i));
    let ended = false;
    g.events.on('nightEnd', () => { ended = true; });
    for (let t = 0; t < 60 * 60 * 25 && !ended; t++) g.step(g.dreamers.map((_, i) => bots[i].frame(g)));
    expect(ended).toBe(true);
    expect(g.household.dots.length).toBe(4);
    expect(g.household.groupDots.length).toBe(1);
  }, 900_000);
  it('forced Vision plays then continues to the rolled realm', () => {
    const g = new Game({ runSeed: 7, players: 1 });
    g.startNight();
    const d = g.dreamers[0];
    g.forceVision = 'tide-of-doors';
    const id = d.visit.linkables[0];
    g.linkDreamer(d, id, 'glyph-desert', 'touch');
    expect(d.visit.realm).toBe('vision');
    expect(d.vision?.id).toBe('tide-of-doors');
    for (let i = 0; i < 60 * 33; i++) g.step([{ mx: 0, mz: 0, lx: 0.001, ly: 0, buttons: 0 }]);
    expect(d.visit.realm).toBe('glyph-desert');
  });
});
