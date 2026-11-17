/**
 * The Director (§3.4, §3.12): keeps 3-6 live anomalies per visit, runs the event deck, motif sightings,
 * peripheral mutations and blink reveals, and drives Lanternfolk wandering.
 */
import { PCG32, hash } from '../core/rng.ts';
import { DT, tuning } from '../core/tuning.ts';
import { Actor, Lanternfolk, Motif, MOTIF_KINDS, Pos, Touched, Vel, Heading, Wander, inVisit, spawn, type EcsWorld } from '../entities/ecs.ts';
import { floodFill } from '../realms/layoutgen.ts';
import type { Visit, WorldObject } from './visit.ts';
import eventsJson from '../../data/events.json' with { type: 'json' };

export type AnomalyKind = 'motif' | 'law' | 'event' | 'blink' | 'peripheral' | 'geometry' | 'echo';

export interface Anomaly {
  id: number;
  kind: AnomalyKind;
  /** Object id in the visit, or -1. */
  obj: number;
  /** Entity id (moving target), or -1. */
  eid: number;
  x: number; y: number; z: number;
  born: number;
  until: number;
  /** Bitmask of dreamers who noticed it. */
  noticed: number;
  /** Bitmask of dreamers allowed to notice (blink reveals are personal). -1 = all. */
  visibleTo: number;
  /** Ticks before which it cannot be noticed (blink: eyes must reopen). */
  activeFrom: number;
  label: string;
}

export interface EventDef { id: string; text: string; realm: string; rarity: string; keywords: string[]; script: string; durationS: number; minNight: number }
export const EVENTS: EventDef[] = eventsJson.events as EventDef[];
const RARITY_W: Record<string, number> = { common: 1, uncommon: 0.45, rare: 0.15, '1-in-500': 0.002 };

export const SCRIPT_IDS = ['bus', 'rainbow', 'letters', 'vending', 'laundry', 'windows', 'cats', 'phone', 'chord', 'lean', 'kneel', 'dune', 'blink', 'turn', 'kite', 'moons', 'train', 'halo'];

export interface VisitDirector {
  rng: PCG32;
  anomalies: Anomaly[];
  nextId: number;
  mutationTicks: number[];
  /** Tick each anomaly-capable object was last in any dreamer's view. */
  lastSeen: Map<number, number>;
  motifSpawned: boolean;
  lawSpawned: boolean;
  eventEid: number;
  /** Event anomaly id -> dreamers who watched it from start (for the +15 s "watched to the end" bonus). */
  watchers: Map<number, number>;
  reachable: Uint8Array | null;
}

export function createVisitDirector(v: Visit): VisitDirector {
  return {
    rng: new PCG32(hash(v.seed, 0xd17), 0xd17), anomalies: [], nextId: 1, mutationTicks: [], lastSeen: new Map(),
    motifSpawned: false, lawSpawned: false, eventEid: -1, watchers: new Map(), reachable: null,
  };
}

/** Context the Director needs from the Game (avoids a circular class import). */
export interface DirectorCtx {
  tick: number;
  night: number;
  ecs: EcsWorld;
  laws: string[];
  motif: (typeof MOTIF_KINDS)[number];
  /** Live Resonance x (Still -4 .. Alive +4). */
  alive: number;
  /** Dreamers in this visit: index, eye position, forward vector. */
  viewers: { index: number; x: number; y: number; z: number; fx: number; fy: number; fz: number }[];
  eventCooldown: Map<string, number>;
  diaryKeywords: string[];
  timeScale: number;
  mutationMul?: number;
}

function addAnomaly(vd: VisitDirector, a: Omit<Anomaly, 'id' | 'noticed'>): Anomaly {
  const an: Anomaly = { ...a, id: vd.nextId++, noticed: 0 };
  vd.anomalies.push(an);
  return an;
}

function randomReachable(v: Visit, vd: VisitDirector, rng: PCG32, near?: { x: number; z: number; min: number; max: number }): { x: number; y: number; z: number } | null {
  const g = v.walk;
  if (!vd.reachable) {
    const s = v.layout.spawns[0];
    vd.reachable = floodFill(g, s.x, s.z);
  }
  for (let t = 0; t < 60; t++) {
    let i: number;
    if (near) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(near.min, near.max);
      const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
      if (x < 1 || z < 1 || x > v.size - 1 || z > v.size - 1) continue;
      i = Math.floor(z / g.res) * g.size + Math.floor(x / g.res);
    } else i = rng.int(g.size * g.size);
    if (!vd.reachable[i]) continue;
    return { x: ((i % g.size) + 0.5) * g.res, y: g.height[i], z: (Math.floor(i / g.size) + 0.5) * g.res };
  }
  return null;
}

/** Populate a fresh visit with Lanternfolk. */
export function populateVisit(v: Visit, vd: VisitDirector, ecs: EcsWorld, folkMul = 1): void {
  if (['lantern-flat', 'veiled-room', 'chorus-room', 'vision'].includes(v.realm)) return;
  const n = Math.round((v.realm === 'lantern-market' ? 14 : 4 + vd.rng.int(4)) * folkMul);
  for (let i = 0; i < n; i++) {
    const p = randomReachable(v, vd, vd.rng);
    if (!p) continue;
    const eid = spawn(ecs, v.id, p.x, p.y + 0.3, p.z, Lanternfolk, Wander);
    Lanternfolk.hue[eid] = vd.rng.next();
    Lanternfolk.size[eid] = 0.8 + vd.rng.next() * 0.5;
    Wander.phase[eid] = vd.rng.range(0, 100);
    Wander.speed[eid] = 0.35 + vd.rng.next() * 0.4;
    Wander.homeX[eid] = p.x; Wander.homeZ[eid] = p.z;
    Wander.radius[eid] = 6 + vd.rng.next() * 10;
  }
}

/** Lanternfolk procedural motion: smooth noise-steered wander around home, bobbing, facing travel. */
export function stepLanternfolk(v: Visit, ecs: EcsWorld, tick: number, timeScale: number): void {
  const dt = DT * timeScale;
  for (const eid of inVisit(ecs, v.id, [Lanternfolk, Wander])) {
    const t = tick * DT * 0.25 + Wander.phase[eid];
    const ang = Math.sin(t * 0.7) * 2.1 + Math.sin(t * 0.31 + 1.7) * 1.3 + Wander.phase[eid];
    let vx = Math.cos(ang) * Wander.speed[eid], vz = Math.sin(ang) * Wander.speed[eid];
    const hx = Wander.homeX[eid] - Pos.x[eid], hz = Wander.homeZ[eid] - Pos.z[eid];
    const hd = Math.hypot(hx, hz);
    if (hd > Wander.radius[eid]) { vx += (hx / hd) * 0.5; vz += (hz / hd) * 0.5; }
    Vel.x[eid] += (vx - Vel.x[eid]) * (1 - Math.exp(-dt * 1.5));
    Vel.z[eid] += (vz - Vel.z[eid]) * (1 - Math.exp(-dt * 1.5));
    const nx = Pos.x[eid] + Vel.x[eid] * dt, nz = Pos.z[eid] + Vel.z[eid] * dt;
    const g = v.walk;
    const i = Math.floor(Math.min(v.size - 0.5, Math.max(0.5, nz)) / g.res) * g.size + Math.floor(Math.min(v.size - 0.5, Math.max(0.5, nx)) / g.res);
    if (!g.blocked[i]) { Pos.x[eid] = nx; Pos.z[eid] = nz; Pos.y[eid] += (g.height[i] + 0.25 + Math.sin(t * 3) * 0.08 - Pos.y[eid]) * 0.1; }
    else { Vel.x[eid] *= -0.5; Vel.z[eid] *= -0.5; }
    if (Math.hypot(Vel.x[eid], Vel.z[eid]) > 0.05) Heading.yaw[eid] = Math.atan2(Vel.x[eid], -Vel.z[eid]);
  }
}

function inView(ctx: DirectorCtx, x: number, y: number, z: number, cosCone: number, maxDist: number): boolean {
  for (const w of ctx.viewers) {
    const dx = x - w.x, dy = y - w.y, dz = z - w.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) continue;
    if (d < 1.5) return true;
    if ((dx * w.fx + dy * w.fy + dz * w.fz) / d > cosCone) return true;
  }
  return false;
}

const cos50 = Math.cos((50 * Math.PI) / 180);

/** Director tick for one visit. Call every simulation step. */
export function directVisit(v: Visit, vd: VisitDirector, ctx: DirectorCtx): Anomaly[] {
  const spawned: Anomaly[] = [];
  const { tick } = ctx;
  // visibility bookkeeping (every 10 ticks)
  if (tick % 10 === 0) {
    for (const o of v.objects) {
      if (!o.components.anomaly) continue;
      if (!vd.lastSeen.has(o.id)) vd.lastSeen.set(o.id, tick);
      if (inView(ctx, o.x, o.cy, o.z, cos50, 90)) vd.lastSeen.set(o.id, tick);
    }
  }
  // move entity-attached anomaly targets
  for (const a of vd.anomalies) if (a.eid >= 0) { a.x = Pos.x[a.eid]; a.y = Pos.y[a.eid]; a.z = Pos.z[a.eid]; }
  stepActors(v, vd, ctx);
  // expire
  const viewersMask = ctx.viewers.reduce((m, w) => m | (1 << w.index), 0);
  vd.anomalies = vd.anomalies.filter((a) => tick < a.until && !(viewersMask && (a.noticed & viewersMask) === viewersMask && a.kind !== 'event'));

  if (tick % 30 !== 0 || ctx.viewers.length === 0) return spawned;
  const live = vd.anomalies.length;
  const alive = Math.max(-1, Math.min(1, ctx.alive / 4));
  const target = Math.round(tuning.director.anomaliesMin + (tuning.director.anomaliesMax - tuning.director.anomaliesMin) * (alive * 0.5 + 0.5));
  if (live >= target) return spawned;
  const rng = vd.rng;
  // weighted choice of what to spawn
  const opts: [string, number][] = [
    ['motif', vd.motifSpawned ? 0 : 2.5],
    ['event', vd.eventEid < 0 ? 1.6 : 0],
    ['peripheral', 3],
    ['law', ctx.laws.includes('glass-night') && !vd.lawSpawned ? 3 : 0],
  ];
  const k = rng.weighted(opts.map((o) => o[1]));
  if (k < 0) return spawned;
  const what = opts[k][0];
  const w0 = ctx.viewers[rng.int(ctx.viewers.length)];
  if (what === 'motif') { const a = spawnMotif(v, vd, ctx, w0); if (a) spawned.push(a); }
  else if (what === 'event') { const a = spawnEvent(v, vd, ctx, w0); if (a) spawned.push(a); }
  else if (what === 'law') {
    const glass = v.objects.filter((o) => o.tags.includes('glass') && !o.hidden);
    if (glass.length) {
      vd.lawSpawned = true;
      // every glass object counts, but the law notice is once per night (handled by the dreamer)
      for (const o of glass.slice(0, 12)) spawned.push(addAnomaly(vd, { kind: 'law', obj: o.id, eid: -1, x: o.x, y: o.cy, z: o.z, born: tick, until: tick + 60 * 600, visibleTo: -1, activeFrom: tick, label: 'glass-night' }));
    }
  } else {
    const a = peripheralMutation(v, vd, ctx);
    if (a) spawned.push(a);
  }
  return spawned;
}

function spawnMotif(v: Visit, vd: VisitDirector, ctx: DirectorCtx, w: DirectorCtx['viewers'][number]): Anomaly | null {
  vd.motifSpawned = true;
  const tick = ctx.tick;
  const rng = vd.rng;
  const kind = ctx.motif;
  const ahead = (d: number, h: number) => ({ x: w.x + w.fx * d + rng.range(-8, 8), y: w.y + h, z: w.z + w.fz * d + rng.range(-8, 8) });
  if (kind === 'phone') {
    const phones = v.objects.filter((o) => o.components.phone || (o.tags.includes('machine') && o.kind === 'prop'));
    if (phones.length) {
      const o = phones[rng.int(phones.length)];
      o.variant = 1; // ringing
      return addAnomaly(vd, { kind: 'motif', obj: o.id, eid: -1, x: o.x, y: o.cy, z: o.z, born: tick, until: tick + 60 * 90, visibleTo: -1, activeFrom: tick, label: 'phone' });
    }
  }
  let p = ahead(30, 14);
  if (kind === 'lantern-woman') {
    const q = randomReachable(v, vd, rng, { x: w.x + w.fx * 18, z: w.z + w.fz * 18, min: 0, max: 10 });
    if (q) p = { x: q.x, y: q.y + 0.2, z: q.z };
  }
  if (kind === 'train') p = { x: w.x - w.fz * 80 + w.fx * 50, y: w.y + 28, z: w.z + w.fx * 80 + w.fz * 50 };
  if (kind === 'moons') p = { x: w.x - 0.5 * 300, y: w.y + 0.45 * 300, z: w.z - 0.6 * 300 };
  const eid = spawn(ctx.ecs, v.id, p.x, p.y, p.z, Motif);
  Motif.kind[eid] = MOTIF_KINDS.indexOf(kind);
  Motif.t[eid] = 0;
  if (kind === 'train') { Vel.x[eid] = w.fz * 9; Vel.z[eid] = -w.fx * 9; }
  const a = addAnomaly(vd, { kind: 'motif', obj: -1, eid, x: p.x, y: p.y, z: p.z, born: tick, until: tick + 60 * (kind === 'train' ? 22 : 120), visibleTo: -1, activeFrom: tick, label: kind });
  Motif.anomaly[eid] = a.id;
  return a;
}

function spawnEvent(v: Visit, vd: VisitDirector, ctx: DirectorCtx, w: DirectorCtx['viewers'][number]): Anomaly | null {
  const rng = vd.rng;
  const deck = EVENTS.filter((e) => (e.realm === v.realm || e.realm === '*') && e.minNight <= ctx.night && (ctx.eventCooldown.get(e.id) ?? -999) <= ctx.night - tuning.director.eventCooldownNights);
  if (!deck.length) return null;
  const weights = deck.map((e) => (RARITY_W[e.rarity] ?? 0.5) * (e.keywords.some((k) => ctx.diaryKeywords.includes(k)) ? 2 : 1) * (e.realm === v.realm ? 1.5 : 1));
  const e = deck[rng.weighted(weights)];
  ctx.eventCooldown.set(e.id, ctx.night);
  const q = randomReachable(v, vd, rng, { x: w.x + w.fx * 14, z: w.z + w.fz * 14, min: 2, max: 8 }) ?? { x: w.x + w.fx * 10, y: w.y - 1.5, z: w.z + w.fz * 10 };
  const eid = spawn(ctx.ecs, v.id, q.x, q.y, q.z, Actor);
  Actor.script[eid] = Math.max(0, SCRIPT_IDS.indexOf(e.script));
  Actor.t[eid] = 0;
  Actor.dur[eid] = e.durationS;
  Heading.yaw[eid] = Math.atan2(-w.fz, w.fx); // across the dreamer's view
  vd.eventEid = eid;
  const a = addAnomaly(vd, { kind: 'event', obj: -1, eid, x: q.x, y: q.y + 1.2, z: q.z, born: ctx.tick, until: ctx.tick + Math.round(e.durationS * 60), visibleTo: -1, activeFrom: ctx.tick, label: e.id });
  Actor.anomaly[eid] = a.id;
  return a;
}

function stepActors(v: Visit, vd: VisitDirector, ctx: DirectorCtx): void {
  const dt = DT * ctx.timeScale;
  for (const eid of inVisit(ctx.ecs, v.id, [Motif])) {
    Motif.t[eid] += dt;
    const kind = MOTIF_KINDS[Motif.kind[eid]];
    if (kind === 'kite') { Pos.x[eid] += Math.cos(Motif.t[eid] * 0.4) * dt * 3; Pos.z[eid] += Math.sin(Motif.t[eid] * 0.33) * dt * 3; Pos.y[eid] += Math.sin(Motif.t[eid] * 1.3) * dt * 0.8; }
    if (kind === 'train') { Pos.x[eid] += Vel.x[eid] * dt; Pos.z[eid] += Vel.z[eid] * dt; }
  }
  for (const eid of inVisit(ctx.ecs, v.id, [Actor])) {
    Actor.t[eid] += dt;
    if (Actor.t[eid] > Actor.dur[eid] + 1) {
      if (vd.eventEid === eid) vd.eventEid = -1;
      Actor.t[eid] = Actor.dur[eid] + 1;
    }
  }
}

/** Peripheral mutation (§3.12): an object out of every view for >= 8 s swaps, recolours, vanishes or turns. */
function peripheralMutation(v: Visit, vd: VisitDirector, ctx: DirectorCtx): Anomaly | null {
  const tick = ctx.tick;
  vd.mutationTicks = vd.mutationTicks.filter((t) => tick - t < 3600);
  const mm = ctx.mutationMul ?? 1;
  if (mm <= 0 || vd.mutationTicks.length >= tuning.director.mutationsPerMin * mm) return null;
  const minUnseen = tuning.director.mutationOutOfViewS * 60;
  const cands = v.objects.filter((o) => o.components.anomaly && !o.hidden && o.carriedBy < 0 && o.variant === 0 && tick - (vd.lastSeen.get(o.id) ?? tick) >= minUnseen
    && ctx.viewers.some((w) => Math.hypot(o.x - w.x, o.z - w.z) < 45));
  if (!cands.length) return null;
  const o = cands[vd.rng.int(cands.length)];
  mutate(o, vd.rng);
  vd.mutationTicks.push(tick);
  return addAnomaly(vd, { kind: 'peripheral', obj: o.id, eid: -1, x: o.x, y: o.cy, z: o.z, born: tick, until: tick + 60 * tuning.notice.peripheralWindowS, visibleTo: -1, activeFrom: tick, label: 'mutation' });
}

/** Mutations: 1-3 recolour, 4 turn around, 5 vanish (props only). */
export function mutate(o: WorldObject, rng: PCG32): void {
  const r = rng.next();
  if (o.kind === 'prop' && r < 0.25) { o.hidden = true; o.variant = 5; }
  else if (r < 0.45) o.variant = 4;
  else o.variant = 1 + rng.int(3);
}

/** Blink reveal: while eyes are shut, change an object in front of the dreamer. */
export function blinkReveal(v: Visit, vd: VisitDirector, tick: number, w: DirectorCtx['viewers'][number], dreamerIndex: number, openAt: number): Anomaly | null {
  const cos25 = Math.cos((25 * Math.PI) / 180);
  const cands = v.objects.filter((o) => {
    if (!o.components.anomaly || o.hidden || o.variant !== 0 || o.carriedBy >= 0) return false;
    const dx = o.x - w.x, dy = o.cy - w.y, dz = o.z - w.z;
    const d = Math.hypot(dx, dy, dz);
    return d > 2 && d < 30 && (dx * w.fx + dy * w.fy + dz * w.fz) / d > cos25;
  });
  if (!cands.length) return null;
  const o = cands[vd.rng.int(cands.length)];
  mutate(o, vd.rng);
  return addAnomaly(vd, { kind: 'blink', obj: o.id, eid: -1, x: o.x, y: o.cy, z: o.z, born: tick, until: tick + 60 * 20, visibleTo: 1 << dreamerIndex, activeFrom: openAt, label: 'blink' });
}

export { Touched };
