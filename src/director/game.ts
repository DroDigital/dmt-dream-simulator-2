/**
 * The deterministic game simulation. Headless: no rendering, no DOM, no wall clock.
 * Same run seed + same input frames => identical link log, notice log and state hash.
 */
import { BTN, EMPTY_FRAME, type InputFrame } from '../core/input.ts';
import { EventBus } from '../core/events.ts';
import { PCG32, hash, hashString } from '../core/rng.ts';
import { DT, DEG, breathBase, tuning } from '../core/tuning.ts';
import type { CharacterHandle } from '../core/physics.ts';
import { telemetry } from '../core/telemetry.ts';
import { generateLayout } from '../realms/layoutgen.ts';
import { DREAM_REALMS, META, REALM_DATA } from '../realms/registry.ts';
import { buildFlatLayout, FUTONS, ROOM_SLOTS } from '../realms/lantern-flat/flat.ts';
import type { Layout, Tag } from '../realms/types.ts';
import { rollDestination, rollGrammar, type Grammar } from '../gameplay/linking.ts';
import { makeBody, stepBody, type Body } from '../gameplay/movement.ts';
import { clampL, floatLimit, levelOf, noticeValue, type LucidityLevel } from '../gameplay/lucidity.ts';
import { createEcs, despawnVisit, inVisit, Lanternfolk, Pos, Touched, type EcsWorld } from '../entities/ecs.ts';
import { Visit } from './visit.ts';
import { blinkReveal, createVisitDirector, directVisit, populateVisit, stepLanternfolk, type Anomaly, type DirectorCtx, type VisitDirector } from './director.ts';
import { newHousehold, planNight, SOUVENIR, type Household, type NightPlan } from './household.ts';
import { push, type Vec2 } from './resonance.ts';

export type DreamerFigure = 'moth' | 'kite' | 'bell' | 'crane';
export const FIGURES: DreamerFigure[] = ['moth', 'kite', 'bell', 'crane'];
/** Locked accent colours (colour-blind-safe set). */
export const FIGURE_COLORS = ['#F2E6C9', '#FF5A6E', '#3FB8E8', '#F2C14E'];

export type DreamerState = 'flat' | 'lying' | 'dreaming' | 'linking' | 'awake';
export type TransitionKind = 'pour' | 'fold' | 'shatter' | 'bloom' | 'glyph' | 'iris' | 'instant' | 'wake' | 'sleep';

export interface GhostDoors { obj: number; doors: { realm: string; x: number; z: number; y: number }[]; t: number }
export interface Ring { options: { realm: string; x: number; y: number; z: number; look: number }[] }

export interface Dreamer {
  index: number;
  figure: DreamerFigure;
  color: string;
  state: DreamerState;
  visit: Visit;
  ch: CharacterHandle;
  body: Body;
  prev: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };
  prevButtons: number;
  arrivedTick: number;
  lieHold: number;
  transition: { kind: TransitionKind; t: number; dur: number; from: string; to: string } | null;
  links: string[];
  linkTicks: number[];
  lucidity: number;
  level: LucidityLevel;
  maxLucidity: number;
  kindCounts: Record<string, number>;
  lawNoticed: boolean;
  idleT: number;
  wokeReason: string | null;
  /** Notice dwell timers by anomaly id. */
  dwell: Map<number, number>;
  /** Aware: cached destinations per object (truthful tint). */
  pending: Map<number, { dest: string; second: string }>;
  tint: { obj: number; dest: string } | null;
  doors: GhostDoors | null;
  ring: Ring | null;
  blinkT: number;
  blinkHold: number;
  gazeObj: number;
  gazeT: number;
  stickyObj: number;
  stickyT: number;
  /** Carried souvenir id (data id) or null. */
  souvenir: string | null;
  souvenirsTonight: Set<string>;
  interact: { kind: 'object' | 'slot'; id: number } | null;
  quietT: number;
  quietDone: boolean;
  stillT: number;
  climbDone: boolean;
  spawnY: number;
  chart: Vec2;
  /** Last notice for the view (shimmer): anomaly + tick. */
  lastNotice: { x: number; y: number; z: number; tick: number; kind: string } | null;
}

export interface LinkRecord { tick: number; dreamer: number; from: string; to: string; linkIndex: number; object: string; mode: string }
export interface NoticeRecord { tick: number; dreamer: number; kind: string; label: string; value: number }

export interface GameEvents extends Record<string, unknown> {
  link: { dreamer: number; from: Visit; to: Visit; kind: TransitionKind; object: number; mode: string };
  wake: { dreamer: number; reason: string };
  nightStart: { night: number; realm: string; plan: NightPlan };
  nightEnd: { night: number; reason: string };
  visitCreated: { visit: Visit };
  visitDisposed: { visit: Visit };
  notice: { dreamer: number; kind: string; value: number; x: number; y: number; z: number };
  level: { dreamer: number; level: LucidityLevel; up: boolean };
  pickup: { dreamer: number; id: string };
  place: { dreamer: number; id: string; slot: string | null };
  doors: { dreamer: number; open: boolean };
  ring: { dreamer: number; open: boolean };
  blink: { dreamer: number };
  touchFolk: { dreamer: number; eid: number };
}

const TAG_TRANSITION: Record<Tag, TransitionKind> = {
  water: 'pour', paper: 'fold', glass: 'shatter', light: 'bloom', glyph: 'glyph', flesh: 'iris', machine: 'iris',
};

const KIND_BASE: Record<string, number> = {
  motif: tuning.lucidity.gain.motif, law: tuning.lucidity.gain.law, event: tuning.lucidity.gain.event,
  blink: tuning.lucidity.gain.blink, peripheral: tuning.lucidity.gain.peripheral, geometry: tuning.lucidity.gain.geometry, echo: tuning.lucidity.gain.echo,
};

export interface GameOptions {
  runSeed: number;
  night?: number;
  players?: number;
  /** Forced start realm (tests, capture). */
  startRealm?: string;
  instantTransitions?: boolean;
  /** Drift mode (§9.4): no lucidity powers or steering. */
  drift?: boolean;
  household?: Household;
}

export class Game {
  readonly events = new EventBus<GameEvents>();
  tick = 0;
  household: Household;
  plan: NightPlan | null = null;
  mode: 'morning' | 'night' = 'morning';
  grammar: Grammar;
  flat: Visit;
  readonly visits = new Map<number, Visit>();
  readonly directors = new Map<number, VisitDirector>();
  readonly dreamers: Dreamer[] = [];
  readonly ecs: EcsWorld = createEcs();
  breath = 0;
  breathCap = 0;
  breathStart = 0;
  nightTicks = 0;
  linkIndex = 0;
  readonly linkLog: LinkRecord[] = [];
  readonly noticeLog: NoticeRecord[] = [];
  readonly visitCounts = new Map<string, number>();
  resonance: Vec2 = [0, 0];
  startRealmOverride: string | undefined;
  instant: boolean;
  drift: boolean;
  /** Event cooldowns: event id -> night last drawn. */
  eventCooldown = new Map<string, number>();
  diaryKeywords: string[] = [];
  private layoutCache = new Map<string, Layout>();
  /** Forced ghost-door pair for capture mode: [first, second]. */
  forcedDoors: [string, string] | null = null;

  constructor(opts: GameOptions) {
    this.household = opts.household ?? newHousehold(opts.runSeed);
    if (opts.night) this.household.night = opts.night;
    this.startRealmOverride = opts.startRealm;
    this.instant = opts.instantTransitions ?? false;
    this.drift = opts.drift ?? false;
    this.grammar = rollGrammar(this.household.runSeed, DREAM_REALMS.map((id) => ({ id, tags: META.get(id)?.tags ?? [] })), tuning.link.grammarFavoured as [number, number], tuning.link.grammarFavouredShare);
    this.flat = new Visit(REALM_DATA['lantern-flat'], buildFlatLayout(), 0, 0);
    this.visits.set(this.flat.id, this.flat);
    for (let i = 0; i < (opts.players ?? 1); i++) this.addDreamer();
  }

  get runSeed(): number { return this.household.runSeed; }
  get night(): number { return this.household.night; }
  get nightSeed(): number { return this.plan?.seed ?? 0; }
  get laws(): string[] { return this.plan?.laws ?? []; }
  hasLaw(id: string): boolean { return this.laws.includes(id); }

  // ------------------------------------------------------------------ dreamers

  addDreamer(): Dreamer | null {
    if (this.dreamers.length >= 4 || this.mode === 'night') return null;
    const index = this.dreamers.length;
    const sp = this.flat.layout.spawns[index];
    const ch = this.flat.physics.addCharacter(sp.x, sp.y, sp.z);
    const d: Dreamer = {
      index, figure: FIGURES[index], color: FIGURE_COLORS[index], state: 'flat', visit: this.flat, ch, body: makeBody(sp.x, sp.y, sp.z, sp.yaw),
      prev: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, roll: 0 }, prevButtons: 0,
      arrivedTick: this.tick, lieHold: 0, transition: null, links: [], linkTicks: [], lucidity: 0, level: 0, maxLucidity: 0, kindCounts: {}, lawNoticed: false,
      idleT: 0, wokeReason: null, dwell: new Map(), pending: new Map(), tint: null, doors: null, ring: null, blinkT: 0, blinkHold: 0,
      gazeObj: -1, gazeT: 0, stickyObj: -1, stickyT: 0, souvenir: null, souvenirsTonight: new Set(), interact: null,
      quietT: 0, quietDone: false, stillT: 0, climbDone: false, spawnY: 0, chart: [0, 0], lastNotice: null,
    };
    this.dreamers.push(d);
    return d;
  }

  /** Leave (hold Start in the Flat). Only the last dreamer can leave to keep indices stable. */
  removeLastDreamer(): void {
    if (this.dreamers.length <= 1 || this.mode !== 'morning') return;
    const d = this.dreamers.pop()!;
    d.visit.physics.removeCharacter(d.ch);
  }

  private placeDreamer(d: Dreamer, visit: Visit, spawnIndex: number): void {
    d.visit.physics.removeCharacter(d.ch);
    const sp = visit.layout.spawns[spawnIndex % visit.layout.spawns.length];
    d.visit = visit;
    d.ch = visit.physics.addCharacter(sp.x, sp.y, sp.z);
    d.body = makeBody(sp.x, sp.y, sp.z, sp.yaw);
    d.prev = { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, roll: 0 };
    d.arrivedTick = this.tick;
    d.spawnY = sp.y;
    d.dwell.clear();
    d.pending.clear();
    d.tint = null; d.doors = null; d.ring = null; d.interact = null;
    d.quietT = 0; d.quietDone = false; d.climbDone = false; d.gazeObj = -1; d.gazeT = 0; d.stickyObj = -1;
  }

  // ------------------------------------------------------------------ layouts / visits

  layoutFor(realm: string, seed: number): Layout {
    const key = `${realm}:${seed}`;
    let l = this.layoutCache.get(key);
    if (!l) {
      l = generateLayout(REALM_DATA[realm], seed).layout;
      this.layoutCache.set(key, l);
      if (this.layoutCache.size > 24) this.layoutCache.delete(this.layoutCache.keys().next().value!);
    }
    return l;
  }

  /** Insert a layout generated elsewhere (Web Worker prewarm). Identical to what layoutFor computes. */
  provideLayout(realm: string, seed: number, layout: Layout): void {
    this.layoutCache.set(`${realm}:${seed}`, layout);
  }
  hasLayout(realm: string, seed: number): boolean { return this.layoutCache.has(`${realm}:${seed}`); }

  visitSeed(linkIndex: number): number {
    return hash(this.nightSeed, linkIndex);
  }

  private createVisit(realm: string): Visit {
    const seed = this.visitSeed(this.linkIndex);
    const v = new Visit(REALM_DATA[realm], this.layoutFor(realm, seed), seed, this.tick);
    this.linkIndex++;
    this.visits.set(v.id, v);
    const vd = createVisitDirector(v);
    this.directors.set(v.id, vd);
    populateVisit(v, vd, this.ecs);
    this.visitCounts.set(realm, (this.visitCounts.get(realm) ?? 0) + 1);
    if (!this.household.runRealms.includes(realm)) this.household.runRealms.push(realm);
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
        this.directors.delete(v.id);
        despawnVisit(this.ecs, v.id);
        this.events.emit('visitDisposed', { visit: v });
        v.dispose();
      }
    }
  }

  // ------------------------------------------------------------------ night flow

  startNight(): void {
    const plan = planNight(this.household, this.dreamers.length, this.startRealmOverride);
    this.plan = plan;
    this.mode = 'night';
    this.linkIndex = 0;
    this.nightTicks = 0;
    this.visitCounts.clear();
    const created = new Map<string, Visit>();
    let breathBaseS = 0;
    this.dreamers.forEach((d, i) => {
      const realm = plan.startRealms[i];
      let v = created.get(realm);
      if (!v) { v = this.createVisit(realm); created.set(realm, v); }
      this.placeDreamer(d, v, i);
      breathBaseS = Math.max(breathBaseS, breathBase(realm));
      d.state = 'dreaming';
      d.links = [realm];
      d.linkTicks = [];
      d.lucidity = clampL(Math.round(d.lucidity * tuning.lucidity.carryOver) + plan.startLucidityBonus);
      d.level = levelOf(d.lucidity);
      d.maxLucidity = d.lucidity;
      d.kindCounts = {};
      d.lawNoticed = false;
      d.souvenirsTonight.clear();
      d.chart = [...plan.startPos];
      d.transition = { kind: 'sleep', t: 0, dur: 1.2, from: 'lantern-flat', to: realm };
      d.wokeReason = null;
    });
    const long = this.hasLaw('long-night') ? 2 : 1;
    this.breathStart = breathBaseS * long;
    this.breath = this.breathStart;
    this.breathCap = this.breathStart * tuning.breath.capMul;
    this.resonance = [...plan.startPos];
    this.events.emit('nightStart', { night: this.night, realm: plan.startRealms[0], plan });
    telemetry.track('night_start', { night: this.night, players: this.dreamers.length, startRealm: plan.startRealms[0], laws: plan.laws });
  }

  endNight(reason: string): void {
    if (this.mode !== 'night') return;
    const h = this.household;
    const durationS = this.nightTicks * DT;
    this.events.emit('nightEnd', { night: this.night, reason });
    telemetry.track('night_end', { night: this.night, reason, durationS, maxLucidity: this.dreamers.map((d) => d.maxLucidity) });
    // wake in the realm you started in: Still +1
    for (const d of this.dreamers) if (d.visit.realm === d.links[0] && d.visit !== this.flat) d.chart = push(d.chart, tuning.resonance.push.wakeStart);
    // chart dots
    let gx = 0, gy = 0;
    for (const d of this.dreamers) { h.dots.push({ night: h.night, dreamer: d.index, x: d.chart[0], y: d.chart[1] }); gx += d.chart[0]; gy += d.chart[1]; }
    h.groupDots.push([gx / this.dreamers.length, gy / this.dreamers.length]);
    h.dots = h.dots.filter((x) => h.night - x.night < tuning.resonance.dotFadeNights);
    h.lastStart = this.plan?.startPos ?? [0, 0];
    h.nightHistory.push([...this.visitCounts.keys()]);
    if (h.nightHistory.length > 400) h.nightHistory.shift();
    this.mode = 'morning';
    h.night++;
    this.dreamers.forEach((d, i) => {
      this.placeDreamer(d, this.flat, i);
      const f = FUTONS[i];
      this.flat.physics.teleport(d.ch, f.x, 0, f.z - 1.2);
      d.body.x = f.x; d.body.z = f.z - 1.2; d.body.y = 0;
      d.prev.x = d.body.x; d.prev.z = d.body.z; d.prev.y = 0;
      d.state = 'flat';
      d.transition = { kind: 'wake', t: 0, dur: 1.5, from: d.links[d.links.length - 1] ?? '', to: 'lantern-flat' };
      d.lieHold = 0;
      // souvenirs held at waking come home (stay in hand for placing)
    });
    this.disposeEmptyVisits();
  }

  wakeDreamer(d: Dreamer, reason: string): void {
    if (d.state === 'awake') return;
    d.state = 'awake';
    d.wokeReason = reason;
    d.doors = null; d.ring = null;
    this.events.emit('wake', { dreamer: d.index, reason });
    if (this.dreamers.every((x) => x.state === 'awake')) this.endNight(reason);
  }

  // ------------------------------------------------------------------ lucidity

  gainLucidity(d: Dreamer, amount: number): number {
    const before = d.lucidity;
    d.lucidity = clampL(d.lucidity + amount);
    this.updateLevel(d);
    return d.lucidity - before;
  }

  private updateLevel(d: Dreamer): void {
    d.maxLucidity = Math.max(d.maxLucidity, d.lucidity);
    const lv = this.drift ? 0 : levelOf(d.lucidity);
    if (lv !== d.level) {
      const up = lv > d.level;
      d.level = lv;
      this.events.emit('level', { dreamer: d.index, level: lv, up });
      if (up) telemetry.track('lucidity_level', { level: lv });
    }
  }

  private notice(d: Dreamer, a: Anomaly): void {
    a.noticed |= 1 << d.index;
    let kind = a.kind as string;
    if (kind === 'law') {
      if (d.lawNoticed) return;
      d.lawNoticed = true;
    }
    const n = d.kindCounts[kind] ?? 0;
    d.kindCounts[kind] = n + 1;
    const value = noticeValue(KIND_BASE[kind] ?? 5, n);
    const gained = this.gainLucidity(d, value);
    this.addBreath(gained);
    d.lastNotice = { x: a.x, y: a.y, z: a.z, tick: this.tick, kind };
    this.noticeLog.push({ tick: this.tick, dreamer: d.index, kind, label: a.label, value: Math.round(value * 100) / 100 });
    this.events.emit('notice', { dreamer: d.index, kind, value, x: a.x, y: a.y, z: a.z });
    telemetry.track('notice', { kind, value });
    // co-op shared notices
    for (const o of this.dreamers) {
      if (o === d || o.state !== 'dreaming') continue;
      const share = o.visit === d.visit ? tuning.lucidity.gain.sharedSameRealm : tuning.lucidity.gain.sharedOtherRealm;
      this.gainLucidity(o, value * share);
    }
    if (kind === 'event') {
      const vd = this.directors.get(d.visit.id);
      vd?.watchers.set(a.id, (vd.watchers.get(a.id) ?? 0) | (1 << d.index));
    }
  }

  // ------------------------------------------------------------------ linking

  private recentNightRealms(): Set<string> {
    const s = new Set<string>();
    for (const n of this.household.nightHistory.slice(-tuning.link.noveltyNights)) for (const r of n) s.add(r);
    return s;
  }

  rollFor(d: Dreamer, objectId: number): { dest: string; second: string } {
    const obj = d.visit.objects[objectId];
    const rng = new PCG32(hash(this.visitSeed(this.linkIndex), hash(d.index, objectId)), 0x1ab);
    const firstLink = d.links.length <= 1;
    return rollDestination({
      grammar: this.grammar, tags: obj.tags, current: d.visit.realm, recentLinks: d.links,
      realms: DREAM_REALMS.map((id) => ({ id, chart: META.get(id)!.chart })),
      resonance: this.resonance, recentNights: this.recentNightRealms(), noveltyBoost: tuning.link.noveltyBoost,
      tagBias: { ...(firstLink ? this.plan?.tagBias : {}), ...(this.hasLaw('glass-night') ? { glass: 2 } : {}), ...(this.hasLaw('paper-night') ? { paper: 2 } : {}) },
    }, rng);
  }

  linkDreamer(d: Dreamer, objectId: number, dest: string, mode: string): void {
    const from = d.visit;
    const obj = objectId >= 0 ? from.objects[objectId] : null;
    const leftBefore = (this.visitCounts.get(dest) ?? 0) >= 2;
    const firstTonight = !this.visitCounts.has(dest);
    const to = this.createVisit(dest);
    const count = this.visitCounts.get(dest)!;
    if (firstTonight) this.addBreath(tuning.breath.firstVisit);
    if (count === 3) this.addBreath(tuning.breath.thirdVisit);
    if (leftBefore) this.gainLucidity(d, -tuning.lucidity.loss.revisit);
    const tag: Tag = obj?.tags[0] ?? 'light';
    const kind: TransitionKind = this.instant ? 'instant' : TAG_TRANSITION[tag] ?? 'bloom';
    this.linkLog.push({ tick: this.tick, dreamer: d.index, from: from.realm, to: dest, linkIndex: this.linkIndex - 1, object: obj?.defId ?? mode, mode });
    telemetry.track('link', { from: from.realm, to: dest, mode, lucidityLevel: d.level });
    // 5 links within 60 s: Alive +2
    d.linkTicks.push(this.tick);
    d.linkTicks = d.linkTicks.filter((t) => this.tick - t < tuning.resonance.push.linkBurstS * 60);
    if (d.linkTicks.length >= tuning.resonance.push.linkBurstN) { d.chart = push(d.chart, tuning.resonance.push.linkBurst); d.linkTicks = []; }
    this.placeDreamer(d, to, d.index);
    d.links.push(dest);
    d.state = 'linking';
    d.transition = { kind, t: 0, dur: kind === 'instant' ? tuning.link.instantS : tuning.link.transitionS, from: from.realm, to: dest };
    this.events.emit('link', { dreamer: d.index, from, to, kind, object: objectId, mode });
  }

  addBreath(s: number): void {
    if (this.mode !== 'night') return;
    this.breath = Math.min(this.breathCap, this.breath + s);
  }

  // ------------------------------------------------------------------ helpers

  forward(d: Dreamer): [number, number, number] {
    const cp = Math.cos(d.body.pitch);
    return [Math.sin(d.body.yaw) * cp, Math.sin(d.body.pitch), -Math.cos(d.body.yaw) * cp];
  }

  eye(d: Dreamer): [number, number, number] {
    return [d.body.x, d.body.y + tuning.move.eyeHeight * this.scale(), d.body.z];
  }

  scale(): number {
    return this.hasLaw('giant') ? 10 : this.hasLaw('tiny') ? 0.1 : 1;
  }

  /** Angle (radians) between view centre and a point, plus distance. */
  aim(d: Dreamer, x: number, y: number, z: number): { angle: number; dist: number } {
    const [ex, ey, ez] = this.eye(d);
    const [fx, fy, fz] = this.forward(d);
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const dist = Math.hypot(dx, dy, dz) || 1e-6;
    const c = Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / dist));
    return { angle: Math.acos(c), dist };
  }

  private los(d: Dreamer, x: number, y: number, z: number): boolean {
    const [ex, ey, ez] = this.eye(d);
    // stop a little short of the target so its own collider does not block
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const len = Math.hypot(dx, dy, dz);
    const k = Math.max(0, (len - 1.0) / len);
    return d.visit.physics.lineOfSight(ex, ey, ez, ex + dx * k, ey + dy * k, ez + dz * k);
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
      const pressed = input.buttons & ~d.prevButtons;
      if (d.transition) {
        d.transition.t += dt;
        if (d.transition.t >= d.transition.dur) {
          d.transition = null;
          if (d.state === 'linking') { d.state = 'dreaming'; d.arrivedTick = this.tick; }
        }
      }
      const frozen = d.state === 'linking' || d.state === 'lying' || (d.transition !== null && d.transition.kind === 'sleep');
      if (d.state !== 'awake') {
        const res = stepBody(d.body, input, d.prevButtons, dt, d.visit.physics, d.ch, {
          frozen,
          scale: this.mode === 'night' ? this.scale() : 1,
          gravityMul: this.mode === 'night' && this.hasLaw('feather') ? 0.3 : 1,
          mirror: this.mode === 'night' && this.hasLaw('mirror'),
          floatLimit: floatLimit(d.level),
          lookScale: d.doors ? 0.5 : 1,
        });
        d.visit.physics.step();
        if (res.fell && d.state === 'dreaming') {
          this.gainLucidity(d, -tuning.lucidity.loss.fall);
          d.chart = push(d.chart, tuning.resonance.push.fall);
        }
      }
      const active = Math.abs(input.mx) + Math.abs(input.mz) > 0.05 || Math.abs(input.lx) + Math.abs(input.ly) > 0.002;
      d.idleT = active ? 0 : d.idleT + dt;
      if (d.idleT > tuning.lucidity.loss.idleS && d.state === 'dreaming') anyIdle = true;
      if (input.buttons & BTN.LIE) d.lieHold += dt; else d.lieHold = 0;

      if (this.mode === 'morning') this.morningDreamer(d, input, pressed);
      else if (d.state === 'dreaming') this.dreamingDreamer(d, input, pressed);
      d.prevButtons = input.buttons;
    }

    if (this.mode === 'morning') {
      if (this.dreamers.length > 0 && this.dreamers.every((d) => d.state === 'lying')) this.startNight();
    } else {
      this.directors.forEach((vd, id) => {
        const v = this.visits.get(id);
        if (!v || v === this.flat) return;
        this.directVisitTick(v, vd);
      });
      // live Resonance = mean of dreamers' chart positions
      let x = 0, y = 0;
      for (const d of this.dreamers) { x += d.chart[0]; y += d.chart[1]; }
      this.resonance = [x / this.dreamers.length, y / this.dreamers.length];
      this.breath -= dt * (anyIdle ? tuning.breath.idleDrain : 1);
      const hardCap = this.hasLaw('long-night') ? tuning.breath.hardCapLongS : tuning.breath.hardCapS;
      if (this.breath <= 0) this.endNight('breath');
      else if (this.nightTicks * dt >= hardCap) this.endNight('breath');
    }
    this.disposeEmptyVisits();
  }

  private directVisitTick(v: Visit, vd: VisitDirector): void {
    const viewers = this.dreamers.filter((d) => d.visit === v && d.state !== 'awake').map((d) => {
      const [x, y, z] = this.eye(d);
      const [fx, fy, fz] = this.forward(d);
      return { index: d.index, x, y, z, fx, fy, fz };
    });
    const slow = this.dreamers.some((d) => d.visit === v && d.doors) ? tuning.link.ghostDoorSlow : 1;
    const ctx: DirectorCtx = {
      tick: this.tick, night: this.night, ecs: this.ecs, laws: this.laws, motif: this.plan?.motif ?? 'kite',
      alive: this.resonance[0], viewers, eventCooldown: this.eventCooldown, diaryKeywords: this.diaryKeywords, timeScale: slow,
    };
    // "watched to the end" bonus for events about to expire
    for (const a of vd.anomalies) if (a.kind === 'event' && a.until === this.tick + 1 && (vd.watchers.get(a.id) ?? 0)) this.addBreath(tuning.breath.eventWatched);
    directVisit(v, vd, ctx);
    stepLanternfolk(v, this.ecs, this.tick, slow);
  }

  // ------------------------------------------------------------------ morning (Lantern Flat)

  private morningDreamer(d: Dreamer, input: InputFrame, pressed: number): void {
    const h = this.household;
    if (d.state === 'flat' && d.lieHold >= tuning.lieDownS) {
      d.state = 'lying';
      const f = FUTONS[d.index];
      this.flat.physics.teleport(d.ch, f.x, 0, f.z);
      d.body.x = f.x; d.body.z = f.z;
      return;
    }
    if (d.state === 'lying') {
      if (d.lieHold === 0 && (pressed & (BTN.INTERACT | BTN.START))) d.state = 'flat';
      return;
    }
    // interact target: room slots (place / take back)
    let best = -1, bestScore = Infinity;
    ROOM_SLOTS.forEach((s, i) => {
      const occupied = !!h.room[s.id];
      if (!d.souvenir && !occupied) return;
      if (d.souvenir && occupied) return;
      const { angle, dist } = this.aim(d, s.x, s.y, s.z);
      const score = angle / (tuning.interact.angleDeg * DEG) + dist / tuning.interact.distM;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    d.interact = best >= 0 && bestScore < tuning.interact.maxScore ? { kind: 'slot', id: best } : null;
    if ((pressed & BTN.INTERACT) && d.interact) {
      const slot = ROOM_SLOTS[d.interact.id];
      if (d.souvenir) {
        h.room[slot.id] = d.souvenir;
        h.box = h.box.filter((x) => x !== d.souvenir);
        this.events.emit('place', { dreamer: d.index, id: d.souvenir, slot: slot.id });
        telemetry.track('souvenir_placed', { id: d.souvenir, slot: slot.id });
        d.souvenir = null;
      } else {
        d.souvenir = h.room[slot.id];
        h.room[slot.id] = null;
        this.events.emit('pickup', { dreamer: d.index, id: d.souvenir! });
      }
    }
  }

  // ------------------------------------------------------------------ dreaming

  private dreamingDreamer(d: Dreamer, input: InputFrame, pressed: number): void {
    const dt = DT;
    if (d.lieHold >= tuning.lieDownS) { this.wakeDreamer(d, 'lie_down'); return; }
    const v = d.visit;
    const vd = this.directors.get(v.id);
    const [ex, ey, ez] = this.eye(d);

    // ---- passive lucidity ----
    const L = tuning.lucidity.loss;
    let dl = 0;
    if (d.lucidity > 50) dl -= L.decayAbove50 * dt;
    if (d.idleT > L.idleS) dl -= L.idlePerS * dt;
    if (dl) { d.lucidity = clampL(d.lucidity + dl); this.updateLevel(d); }

    // ---- quiet place: 20 s within 2.5 m -> +5 once per visit ----
    if (!d.quietDone) {
      const q = v.layout.quiet;
      if (Math.hypot(d.body.x - q.x, d.body.z - q.z) < 2.5) {
        d.quietT += dt;
        if (d.quietT >= tuning.lucidity.gain.quietPlaceS) { d.quietDone = true; this.gainLucidity(d, tuning.lucidity.gain.quietPlace); }
      } else d.quietT = 0;
    }
    // ---- Resonance pushes: still, climb ----
    const moving = Math.hypot(d.body.vx, d.body.vz) > 0.2;
    d.stillT = moving ? 0 : d.stillT + dt;
    if (d.stillT >= tuning.resonance.push.stillS) { d.stillT = 0; d.chart = push(d.chart, tuning.resonance.push.still); }
    if (!d.climbDone && d.body.y - d.spawnY > tuning.resonance.push.climbM) { d.climbDone = true; d.chart = push(d.chart, tuning.resonance.push.climb); }

    // ---- Lanternfolk touch: +3 lucidity, Bright +1 ----
    for (const eid of inVisit(this.ecs, v.id, [Lanternfolk])) {
      if (Touched.mask[eid] & (1 << d.index)) continue;
      if (Math.hypot(Pos.x[eid] - d.body.x, Pos.z[eid] - d.body.z) < 1.0 && Math.abs(Pos.y[eid] - d.body.y) < 2) {
        Touched.mask[eid] |= 1 << d.index;
        this.gainLucidity(d, tuning.lucidity.gain.lanternfolk);
        d.chart = push(d.chart, tuning.resonance.push.lanternfolk);
        this.events.emit('touchFolk', { dreamer: d.index, eid });
      }
    }

    // ---- blink ----
    if (pressed & BTN.BLINK) {
      d.blinkT = tuning.blink.shutS;
      this.events.emit('blink', { dreamer: d.index });
      if (vd) {
        const [fx, fy, fz] = this.forward(d);
        blinkReveal(v, vd, this.tick, { index: d.index, x: ex, y: ey, z: ez, fx, fy, fz }, d.index, this.tick + Math.round(tuning.blink.shutS * 60));
      }
    }
    if (input.buttons & BTN.BLINK) { d.blinkHold += dt; d.blinkT = Math.max(d.blinkT, 0.05); } else d.blinkHold = 0;
    d.blinkT = Math.max(0, d.blinkT - dt);
    const eyesOpen = d.blinkT <= 0;

    // ---- noticing ----
    if (vd && eyesOpen) {
      for (const a of vd.anomalies) {
        if (a.noticed & (1 << d.index)) continue;
        if (a.visibleTo !== -1 && !(a.visibleTo & (1 << d.index))) continue;
        if (this.tick < a.activeFrom) continue;
        if (a.kind === 'law' && d.lawNoticed) continue;
        const wide = a.kind === 'peripheral' || a.kind === 'blink';
        const cone = (wide ? 15 : a.kind === 'event' ? 10 : tuning.notice.coneDeg) * DEG;
        const need = wide ? 0.35 : a.kind === 'event' ? tuning.notice.eventDwellS : tuning.notice.dwellS;
        const { angle, dist } = this.aim(d, a.x, a.y, a.z);
        const far = a.kind === 'motif' ? 400 : 70;
        let t = d.dwell.get(a.id) ?? 0;
        if (angle < cone && dist < far && (a.kind === 'motif' && dist > 60 ? true : this.los(d, a.x, a.y, a.z))) t += dt;
        else t = Math.max(0, t - dt * 2);
        if (t >= need) { this.notice(d, a); d.dwell.delete(a.id); }
        else d.dwell.set(a.id, t);
      }
    }

    // ---- interact target: carryables ----
    let best = -1, bestScore = Infinity;
    for (const o of v.objects) {
      if (!o.components.carryable || o.hidden || o.carriedBy >= 0) continue;
      const { angle, dist } = this.aim(d, o.x, o.cy, o.z);
      if (dist > 6) continue;
      const score = angle / (tuning.interact.angleDeg * DEG) + dist / tuning.interact.distM;
      if (score < bestScore) { bestScore = score; best = o.id; }
    }
    if (best >= 0 && bestScore < tuning.interact.maxScore && this.los(d, v.objects[best].x, v.objects[best].cy, v.objects[best].z)) d.interact = { kind: 'object', id: best };
    else d.interact = null;
    if (pressed & BTN.INTERACT) {
      if (!d.souvenir && d.interact) {
        const o = v.objects[d.interact.id];
        o.carriedBy = d.index;
        d.souvenir = o.defId;
        if (!d.souvenirsTonight.has(o.defId)) { d.souvenirsTonight.add(o.defId); this.addBreath(tuning.breath.souvenir); }
        this.events.emit('pickup', { dreamer: d.index, id: o.defId });
        telemetry.track('souvenir_pickup', { id: o.defId });
        d.interact = null;
      } else if (d.souvenir) {
        // put it down in this realm, 1 m ahead
        const [fx, , fz] = this.forward(d);
        const id = d.souvenir;
        const def = SOUVENIR.get(id);
        v.objects.push({
          id: v.objects.length, kind: 'prop', defId: id, src: -1, x: d.body.x + fx, y: d.body.y + 0.9, z: d.body.z + fz, cy: d.body.y + 0.95,
          radius: 0, height: 0.2, rot: 0, tags: def ? [def.tag] : [], components: { carryable: true }, hidden: false, variant: 0, carriedBy: -1,
        });
        d.souvenir = null;
        this.events.emit('place', { dreamer: d.index, id, slot: null });
      }
    }

    const level = d.level;
    // ---- ghost doors (Lucid) ----
    if (d.doors) {
      d.doors.t += dt;
      // gentle recoil off the touched object during the first 0.3 s
      if (d.doors.t < 0.3) {
        const [fx, , fz] = this.forward(d);
        const fl = Math.hypot(fx, fz) || 1;
        v.physics.move(d.ch, (-fx / fl) * 4 * dt, -0.02, (-fz / fl) * 4 * dt);
        d.body.x = d.ch.x; d.body.y = d.ch.y; d.body.z = d.ch.z;
      }
      for (const door of d.doors.doors) {
        if (Math.hypot(d.body.x - door.x, d.body.z - door.z) < 0.9) {
          const obj = d.doors.obj;
          d.doors = null;
          this.events.emit('doors', { dreamer: d.index, open: false });
          this.linkDreamer(d, obj, door.realm, 'door');
          return;
        }
      }
      if (d.doors.t >= tuning.link.ghostDoorWindowS) {
        const { obj, doors } = d.doors;
        d.doors = null;
        this.events.emit('doors', { dreamer: d.index, open: false });
        this.linkDreamer(d, obj, doors[0].realm, 'door');
        return;
      }
      return; // nothing else while the doors are up
    }

    // ---- free-link ring (Clear): hold Blink 1.5 s ----
    if (!this.drift && level >= 3 && d.blinkHold >= tuning.blink.ringHoldS && !d.ring) {
      const opts = this.household.runRealms.filter((r) => r !== v.realm).slice(0, tuning.link.ringMax);
      if (opts.length) {
        d.ring = { options: opts.map((realm, i) => {
          const a = d.body.yaw + ((i - (opts.length - 1) / 2) * Math.PI) / Math.max(4, opts.length);
          return { realm, x: d.body.x + Math.sin(a) * 3, y: ey, z: d.body.z - Math.cos(a) * 3, look: 0 };
        }) };
        this.events.emit('ring', { dreamer: d.index, open: true });
      }
    }
    if (d.ring) {
      if (!(d.prevButtons & BTN.BLINK) && !(input.buttons & BTN.BLINK) && d.blinkHold === 0) {
        // released: look still works for a moment? close the ring
        d.ring = null;
        this.events.emit('ring', { dreamer: d.index, open: false });
      } else {
        for (const o of d.ring.options) {
          const { angle } = this.aim(d, o.x, o.y, o.z);
          o.look = angle < 8 * DEG ? o.look + dt : 0;
          if (o.look >= tuning.link.ringLookS) {
            d.ring = null;
            this.events.emit('ring', { dreamer: d.index, open: false });
            this.gainLucidity(d, -tuning.lucidity.ringCost);
            this.linkDreamer(d, -1, o.realm, 'ring');
            return;
          }
        }
      }
    }

    // ---- Aware: target + truthful tint ----
    let target = -1, tScore = Infinity;
    if (!this.drift && level >= 1) {
      for (const id of v.linkables) {
        const o = v.objects[id];
        if (o.hidden) continue;
        const { angle, dist } = this.aim(d, o.x, o.cy, o.z);
        if (dist > 14 || angle > 18 * DEG) continue;
        const s = angle / (12 * DEG) + dist / 6;
        if (s < tScore) { tScore = s; target = id; }
      }
      if (target >= 0) {
        let p = d.pending.get(target);
        if (!p) { p = this.rollFor(d, target); d.pending.set(target, p); }
        d.tint = { obj: target, dest: p.dest };
      } else d.tint = null;
    } else d.tint = null;

    // ---- gaze links (night >= 10): hold a linkable at centre 3 s ----
    if (this.night >= tuning.gaze.unlockNight) {
      let g = -1;
      for (const id of v.linkables) {
        const o = v.objects[id];
        if (o.hidden) continue;
        const { angle, dist } = this.aim(d, o.x, o.cy, o.z);
        if (angle < tuning.notice.coneDeg * DEG && dist < 25) { g = id; break; }
      }
      if (g >= 0 && g === d.gazeObj) d.gazeT += dt; else { d.gazeObj = g; d.gazeT = 0; }
      if (g >= 0 && d.gazeT >= tuning.gaze.dwellS && this.los(d, v.objects[g].x, v.objects[g].cy, v.objects[g].z)) {
        const dest = d.pending.get(g)?.dest ?? this.rollFor(d, g).dest;
        this.linkDreamer(d, g, dest, 'gaze');
        return;
      }
    }

    // ---- touch -> link ----
    const sinceArrive = (this.tick - d.arrivedTick) * dt;
    if (sinceArrive < tuning.touch.cooldownS) return;
    const touching = v.physics.touching(d.ch).filter((id) => v.objects[id] && !v.objects[id].hidden && v.objects[id].components.linkable);
    if (!touching.length) { d.stickyObj = -1; d.stickyT = 0; return; }
    const id = touching[0];
    if (this.hasLaw('sticky')) {
      if (d.stickyObj === id) d.stickyT += dt; else { d.stickyObj = id; d.stickyT = 0; }
      if (d.stickyT < tuning.touch.stickyS) return;
    }
    const roll = d.pending.get(id) ?? this.rollFor(d, id);
    if (!this.drift && level >= 2) {
      // ghost doors rise 2 m ahead showing the rolled realm and the next-best
      const pair = this.forcedDoors ?? [roll.dest, roll.second];
      const [fx, , fz] = this.forward(d);
      const fl = Math.hypot(fx, fz) || 1;
      const nx = fx / fl, nz = fz / fl;
      const ahead = tuning.link.ghostDoorDist;
      d.doors = {
        obj: id, t: 0,
        // origin = where the recoil leaves the dreamer; doors rise 2 m ahead of it, flanking the object
        doors: pair.map((realm, i) => {
          const ox = d.body.x - nx * 1.2, oz = d.body.z - nz * 1.2;
          const side = i === 0 ? -1.5 : 1.5;
          return { realm, x: ox + nx * ahead - nz * side, y: d.body.y, z: oz + nz * ahead + nx * side };
        }),
      };
      // step back off the object so the doors are reachable
      this.events.emit('doors', { dreamer: d.index, open: true });
      return;
    }
    this.linkDreamer(d, id, roll.dest, 'touch');
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
      h = hash(h, hashString(d.souvenir ?? '-'));
    }
    for (const l of this.linkLog) h = hash(h, hash(l.tick, hashString(l.to)));
    for (const n of this.noticeLog) h = hash(h, hash(n.tick, hashString(n.kind)));
    return h >>> 0;
  }
}
