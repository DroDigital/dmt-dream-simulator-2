/**
 * The deterministic game simulation. Headless: no rendering, no DOM, no wall clock.
 * Same run seed + same input frames => identical link log and state hash.
 */
import { BTN, EMPTY_FRAME, type InputFrame } from '../core/input.ts';
import { EventBus } from '../core/events.ts';
import { PCG32, hash, hashString } from '../core/rng.ts';
import { DT, breathBase, tuning } from '../core/tuning.ts';
import type { CharacterHandle } from '../core/physics.ts';
import { telemetry } from '../core/telemetry.ts';
import { generateLayout } from '../realms/layoutgen.ts';
import { DREAM_REALMS, META, REALM_DATA } from '../realms/registry.ts';
import { buildFlatLayout, FUTONS } from '../realms/lantern-flat/flat.ts';
import type { Layout, Tag } from '../realms/types.ts';
import { rollDestination, rollGrammar, type Grammar } from '../gameplay/linking.ts';
import { makeBody, stepBody, type Body } from '../gameplay/movement.ts';
import { Visit } from './visit.ts';

export type DreamerFigure = 'moth' | 'kite' | 'bell' | 'crane';
export const FIGURES: DreamerFigure[] = ['moth', 'kite', 'bell', 'crane'];

export type DreamerState = 'flat' | 'lying' | 'dreaming' | 'linking' | 'awake';
export type TransitionKind = 'pour' | 'fold' | 'shatter' | 'bloom' | 'glyph' | 'iris' | 'instant' | 'wake' | 'sleep';

export interface Dreamer {
  index: number;
  figure: DreamerFigure;
  state: DreamerState;
  visit: Visit;
  ch: CharacterHandle;
  body: Body;
  /** Previous tick snapshot for render interpolation. */
  prev: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };
  prevButtons: number;
  /** Ticks since arriving in the current visit (touch ignored < cooldown). */
  arrivedTick: number;
  lieHold: number;
  transition: { kind: TransitionKind; t: number; dur: number; from: string; to: string } | null;
  /** Realms this dreamer linked into tonight (newest last). */
  links: string[];
  lucidity: number;
  idleT: number;
  wokeReason: string | null;
}

export interface LinkRecord { tick: number; dreamer: number; from: string; to: string; linkIndex: number; object: string; mode: string }

export interface GameEvents extends Record<string, unknown> {
  link: { dreamer: number; from: Visit; to: Visit; kind: TransitionKind; object: number };
  wake: { dreamer: number; reason: string };
  nightStart: { night: number; realm: string };
  nightEnd: { night: number; reason: string };
  visitCreated: { visit: Visit };
  visitDisposed: { visit: Visit };
}

const TAG_TRANSITION: Record<Tag, TransitionKind> = {
  water: 'pour', paper: 'fold', glass: 'shatter', light: 'bloom', glyph: 'glyph', flesh: 'iris', machine: 'iris',
};

export interface GameOptions {
  runSeed: number;
  night?: number;
  players?: number;
  /** Forced start realm (M1 slice / tests). */
  startRealm?: string;
  instantTransitions?: boolean;
}

export class Game {
  readonly events = new EventBus<GameEvents>();
  tick = 0;
  runSeed: number;
  night: number;
  nightSeed = 0;
  mode: 'morning' | 'night' = 'morning';
  grammar: Grammar;
  flat: Visit;
  readonly visits = new Map<number, Visit>();
  readonly dreamers: Dreamer[] = [];
  breath = 0;
  breathCap = 0;
  breathStart = 0;
  nightTicks = 0;
  linkIndex = 0;
  readonly linkLog: LinkRecord[] = [];
  /** Realms visited tonight -> count. */
  readonly visitCounts = new Map<string, number>();
  /** Realms seen per past night (for novelty). */
  readonly nightHistory: string[][] = [];
  resonance: [number, number] = [0, 0];
  startRealmOverride: string | undefined;
  instant: boolean;
  private layoutCache = new Map<string, Layout>();
  /** Director RNG for the night (seeded from nightSeed). */
  rng: PCG32;

  constructor(opts: GameOptions) {
    this.runSeed = opts.runSeed >>> 0;
    this.night = opts.night ?? 1;
    this.startRealmOverride = opts.startRealm;
    this.instant = opts.instantTransitions ?? false;
    this.grammar = rollGrammar(this.runSeed, DREAM_REALMS.map((id) => ({ id, tags: META.get(id)?.tags ?? [] })), tuning.link.grammarFavoured as [number, number], tuning.link.grammarFavouredShare);
    this.rng = new PCG32(hash(this.runSeed, 0xf1a7));
    this.flat = new Visit(REALM_DATA['lantern-flat'], buildFlatLayout(), 0, 0);
    this.visits.set(this.flat.id, this.flat);
    for (let i = 0; i < (opts.players ?? 1); i++) this.addDreamer();
  }

  // ------------------------------------------------------------------ dreamers

  addDreamer(): Dreamer | null {
    if (this.dreamers.length >= 4) return null;
    const index = this.dreamers.length;
    const sp = this.flat.layout.spawns[index];
    const ch = this.flat.physics.addCharacter(sp.x, sp.y, sp.z);
    const body = makeBody(sp.x, sp.y, sp.z, sp.yaw);
    const d: Dreamer = {
      index, figure: FIGURES[index], state: this.mode === 'night' ? 'awake' : 'flat', visit: this.flat, ch, body,
      prev: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, roll: 0 }, prevButtons: 0,
      arrivedTick: this.tick, lieHold: 0, transition: null, links: [], lucidity: 0, idleT: 0, wokeReason: null,
    };
    this.dreamers.push(d);
    return d;
  }

  private placeDreamer(d: Dreamer, visit: Visit, spawnIndex: number): void {
    d.visit.physics.removeCharacter(d.ch);
    const sp = visit.layout.spawns[spawnIndex % visit.layout.spawns.length];
    d.visit = visit;
    d.ch = visit.physics.addCharacter(sp.x, sp.y, sp.z);
    d.body = makeBody(sp.x, sp.y, sp.z, sp.yaw);
    d.prev = { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, roll: 0 };
    d.arrivedTick = this.tick;
  }

  // ------------------------------------------------------------------ layouts / visits

  layoutFor(realm: string, seed: number): Layout {
    const key = `${realm}:${seed}`;
    let l = this.layoutCache.get(key);
    if (!l) {
      l = generateLayout(REALM_DATA[realm], seed).layout;
      this.layoutCache.set(key, l);
      if (this.layoutCache.size > 16) this.layoutCache.delete(this.layoutCache.keys().next().value!);
    }
    return l;
  }

  /** Insert a layout generated elsewhere (Web Worker prewarm). Must equal what layoutFor would compute. */
  provideLayout(realm: string, seed: number, layout: Layout): void {
    this.layoutCache.set(`${realm}:${seed}`, layout);
  }

  visitSeed(linkIndex: number): number {
    return hash(this.nightSeed, linkIndex);
  }

  private createVisit(realm: string): Visit {
    const seed = this.visitSeed(this.linkIndex);
    const v = new Visit(REALM_DATA[realm], this.layoutFor(realm, seed), seed, this.tick);
    this.linkIndex++;
    this.visits.set(v.id, v);
    this.visitCounts.set(realm, (this.visitCounts.get(realm) ?? 0) + 1);
    this.events.emit('visitCreated', { visit: v });
    return v;
  }

  private disposeEmptyVisits(): void {
    for (const v of this.visits.values()) {
      if (v === this.flat) continue;
      const occupied = this.dreamers.some((d) => d.visit === v);
      if (occupied) { v.emptySince = -1; continue; }
      if (v.emptySince < 0) v.emptySince = this.tick;
      if (this.tick - v.emptySince > tuning.link.followWindowS * 60 || this.mode === 'morning') {
        this.visits.delete(v.id);
        this.events.emit('visitDisposed', { visit: v });
        v.dispose();
      }
    }
  }

  // ------------------------------------------------------------------ night flow

  startNight(): void {
    this.nightSeed = hash(this.runSeed, this.night);
    this.rng = new PCG32(this.nightSeed, 0xd1ec);
    this.mode = 'night';
    this.linkIndex = 0;
    this.nightTicks = 0;
    this.visitCounts.clear();
    const start = this.startRealmOverride ?? 'evening-suburb';
    const v = this.createVisit(start);
    this.breathStart = breathBase(start);
    this.breath = this.breathStart;
    this.breathCap = this.breathStart * tuning.breath.capMul;
    this.dreamers.forEach((d, i) => {
      this.placeDreamer(d, v, i);
      d.state = 'dreaming';
      d.links = [start];
      d.lucidity = Math.round(d.lucidity * tuning.lucidity.carryOver);
      d.transition = { kind: 'sleep', t: 0, dur: 1.2, from: 'lantern-flat', to: start };
      d.wokeReason = null;
    });
    this.events.emit('nightStart', { night: this.night, realm: start });
    telemetry.track('night_start', { night: this.night, players: this.dreamers.length, startRealm: start, laws: [] });
  }

  endNight(reason: string): void {
    if (this.mode !== 'night') return;
    const durationS = this.nightTicks * DT;
    this.events.emit('nightEnd', { night: this.night, reason });
    telemetry.track('night_end', { night: this.night, reason, durationS, maxLucidity: this.dreamers.map((d) => d.lucidity) });
    this.nightHistory.push([...this.visitCounts.keys()]);
    this.mode = 'morning';
    this.night++;
    this.dreamers.forEach((d, i) => {
      this.placeDreamer(d, this.flat, i);
      const f = FUTONS[i];
      this.flat.physics.teleport(d.ch, f.x, 0, f.z - 1.2);
      d.body.x = f.x; d.body.z = f.z - 1.2; d.body.y = 0;
      d.prev.x = d.body.x; d.prev.z = d.body.z; d.prev.y = 0;
      d.state = 'flat';
      d.transition = { kind: 'wake', t: 0, dur: 1.5, from: d.links[d.links.length - 1] ?? '', to: 'lantern-flat' };
      d.lieHold = 0;
    });
    this.disposeEmptyVisits();
  }

  private wakeDreamer(d: Dreamer, reason: string): void {
    if (d.state === 'awake') return;
    d.state = 'awake';
    d.wokeReason = reason;
    this.events.emit('wake', { dreamer: d.index, reason });
    if (this.dreamers.every((x) => x.state === 'awake')) this.endNight(reason);
  }

  // ------------------------------------------------------------------ linking

  private recentNightRealms(): Set<string> {
    const s = new Set<string>();
    for (const n of this.nightHistory.slice(-tuning.link.noveltyNights)) for (const r of n) s.add(r);
    return s;
  }

  rollFor(d: Dreamer, objectId: number): { dest: string; second: string } {
    const obj = d.visit.objects[objectId];
    const rng = new PCG32(hash(this.visitSeed(this.linkIndex), hash(d.index, objectId)), 0x1ab);
    return rollDestination({
      grammar: this.grammar, tags: obj.tags, current: d.visit.realm, recentLinks: d.links,
      realms: DREAM_REALMS.map((id) => ({ id, chart: META.get(id)!.chart })),
      resonance: this.resonance, recentNights: this.recentNightRealms(), noveltyBoost: tuning.link.noveltyBoost,
    }, rng);
  }

  linkDreamer(d: Dreamer, objectId: number, dest: string, mode: string): void {
    const from = d.visit;
    const obj = from.objects[objectId];
    const firstTonight = !this.visitCounts.has(dest);
    const to = this.createVisit(dest);
    const count = this.visitCounts.get(dest)!;
    if (firstTonight) this.addBreath(tuning.breath.firstVisit);
    if (count === 3) this.addBreath(tuning.breath.thirdVisit);
    const kind: TransitionKind = this.instant ? 'instant' : TAG_TRANSITION[obj.tags[0] ?? 'light'] ?? 'bloom';
    this.linkLog.push({ tick: this.tick, dreamer: d.index, from: from.realm, to: dest, linkIndex: this.linkIndex - 1, object: obj.defId, mode });
    telemetry.track('link', { from: from.realm, to: dest, mode, lucidityLevel: 0 });
    this.placeDreamer(d, to, d.index);
    d.links.push(dest);
    d.state = 'linking';
    d.transition = { kind, t: 0, dur: kind === 'instant' ? tuning.link.instantS : tuning.link.transitionS, from: from.realm, to: dest };
    this.events.emit('link', { dreamer: d.index, from, to, kind, object: objectId });
  }

  addBreath(s: number): void {
    this.breath = Math.min(this.breathCap, this.breath + s);
  }

  // ------------------------------------------------------------------ tick

  step(inputs: readonly InputFrame[]): void {
    this.tick++;
    const dt = DT;
    for (const d of this.dreamers) {
      d.prev.x = d.body.x; d.prev.y = d.body.y; d.prev.z = d.body.z;
      d.prev.yaw = d.body.yaw; d.prev.pitch = d.body.pitch; d.prev.roll = d.body.roll;
    }
    if (this.mode === 'night') this.nightTicks++;

    let anyIdle = false;
    for (const d of this.dreamers) {
      const input = inputs[d.index] ?? EMPTY_FRAME;
      if (d.transition) {
        d.transition.t += dt;
        if (d.transition.t >= d.transition.dur) {
          d.transition = null;
          if (d.state === 'linking') { d.state = 'dreaming'; d.arrivedTick = this.tick; }
        }
      }
      const frozen = d.state === 'linking' || d.state === 'lying' || (d.transition !== null && d.transition.kind === 'sleep');
      if (d.state !== 'awake') {
        stepBody(d.body, input, d.prevButtons, dt, d.visit.physics, d.ch, { frozen });
        d.visit.physics.step();
      }
      const active = Math.abs(input.mx) + Math.abs(input.mz) > 0.05 || Math.abs(input.lx) + Math.abs(input.ly) > 0.002;
      d.idleT = active ? 0 : d.idleT + dt;
      if (d.idleT > tuning.lucidity.loss.idleS && d.state === 'dreaming') anyIdle = true;

      // lie down (hold)
      if (input.buttons & BTN.LIE) d.lieHold += dt; else d.lieHold = 0;

      if (this.mode === 'morning') {
        if (d.state === 'flat' && d.lieHold >= tuning.lieDownS) {
          d.state = 'lying';
          const f = FUTONS[d.index];
          this.flat.physics.teleport(d.ch, f.x, 0, f.z);
          d.body.x = f.x; d.body.z = f.z;
        }
        if (d.state === 'lying' && d.lieHold === 0 && (input.buttons & (BTN.INTERACT | BTN.START))) d.state = 'flat';
      } else if (d.state === 'dreaming') {
        if (d.lieHold >= tuning.lieDownS) { this.wakeDreamer(d, 'lie_down'); continue; }
        // touch -> link
        const sinceArrive = (this.tick - d.arrivedTick) * dt;
        if (sinceArrive >= tuning.touch.cooldownS) {
          const touching = d.visit.physics.touching(d.ch);
          for (const id of touching) {
            const obj = d.visit.objects[id];
            if (!obj || obj.hidden || !obj.components.linkable) continue;
            const { dest } = this.rollFor(d, id);
            this.linkDreamer(d, id, dest, 'touch');
            break;
          }
        }
      }
      d.prevButtons = input.buttons;
    }

    if (this.mode === 'morning') {
      if (this.dreamers.length > 0 && this.dreamers.every((d) => d.state === 'lying')) this.startNight();
    } else {
      this.breath -= dt * (anyIdle ? tuning.breath.idleDrain : 1);
      const hardCap = tuning.breath.hardCapS;
      if (this.breath <= 0) this.endNight('breath');
      else if (this.nightTicks * dt >= hardCap) this.endNight('breath');
    }
    this.disposeEmptyVisits();
  }

  /** Stable hash of the sim state (determinism tests). */
  stateHash(): number {
    let h = hash(this.tick, this.night);
    h = hash(h, Math.round(this.breath * 1000));
    h = hash(h, this.linkIndex);
    for (const d of this.dreamers) {
      h = hash(h, hashString(d.visit.realm));
      h = hash(h, Math.round(d.body.x * 1000));
      h = hash(h, Math.round(d.body.y * 1000));
      h = hash(h, Math.round(d.body.z * 1000));
      h = hash(h, Math.round(d.body.yaw * 1e5));
      h = hash(h, Math.round(d.lucidity * 1000));
    }
    for (const l of this.linkLog) h = hash(h, hash(l.tick, hashString(l.to)));
    return h >>> 0;
  }
}
