/**
 * Household state that persists between nights (and into saves): night count, run seed, the room,
 * chart dots, realm history. Also the night plan: how tonight is rolled from the household.
 */
import { PCG32, hash } from '../core/rng.ts';
import { tuning } from '../core/tuning.ts';
import { META, QUADRANT_START, resolveRealm } from '../realms/registry.ts';
import { ROOM_SLOTS, type RoomSlot } from '../realms/lantern-flat/flat.ts';
import type { Tag } from '../realms/types.ts';
import souvenirsJson from '../../data/souvenirs.json' with { type: 'json' };
import lawsJson from '../../data/laws.json' with { type: 'json' };
import { MOTIF_KINDS, type MotifKind } from '../entities/ecs.ts';
import { clampMove, depthOf, quadrantOf, type Dot, type Vec2 } from './resonance.ts';

export interface SouvenirDef {
  id: string; name: string; tag: Tag; influence: ('bright' | 'deep' | 'still' | 'alive')[]; motif: string | null; special: string | null; realms: string[];
}
export const SOUVENIRS: SouvenirDef[] = souvenirsJson.souvenirs as SouvenirDef[];
export const SOUVENIR = new Map(SOUVENIRS.map((s) => [s.id, s]));

export interface LawDef { id: string; name: string; journal: string; effects: Record<string, unknown>; weight: number; deep: boolean }
export const LAWS: LawDef[] = lawsJson.laws as LawDef[];
export const LAW = new Map(LAWS.map((l) => [l.id, l]));

export interface Household {
  runSeed: number;
  night: number;
  room: Record<string, string | null>;
  /** Souvenirs brought home but not placed (held in the morning). */
  box: string[];
  dots: Dot[];
  groupDots: Vec2[];
  lastStart: Vec2;
  nightHistory: string[][];
  /** Realms visited at least once this run (free-link ring). */
  runRealms: string[];
  lastPhoneRealm: string | null;
  /** Group souvenir pieces earned in co-op (constellation in the Flat). */
  constellation?: number;
  /** Atlas discoveries by category. */
  atlas?: Record<string, string[]>;
  /** The chart secret was traced: next night opens the 13th realm. */
  secretPending?: boolean;
  secretFound?: boolean;
  /** Finished a run: Endless mode unlocked. */
  endless?: boolean;
  runs?: number;
}

export function newHousehold(runSeed: number): Household {
  return {
    runSeed: runSeed >>> 0, night: 1,
    room: Object.fromEntries(ROOM_SLOTS.map((s) => [s.id, null])),
    box: [], dots: [], groupDots: [], lastStart: [0, 0], nightHistory: [], runRealms: [], lastPhoneRealm: null,
  };
}

const INFL: Record<string, Vec2> = { bright: [0, -1], deep: [0, 1], still: [-1, 0], alive: [1, 0] };

export function slotOf(id: string): RoomSlot | undefined {
  return ROOM_SLOTS.find((s) => s.id === id);
}

/** Influence of the room's souvenirs on tomorrow's start position (§3.9). */
export function roomInfluence(h: Household): Vec2 {
  let x = 0, y = 0;
  for (const [slotId, sid] of Object.entries(h.room)) {
    if (!sid) continue;
    const slot = slotOf(slotId);
    const def = SOUVENIR.get(sid);
    if (!slot || !def) continue;
    const k = slot.kind === 'shelf' ? 1 : slot.kind === 'floor' ? 0.25 : 0;
    for (const i of def.influence) { x += INFL[i][0] * k; y += INFL[i][1] * k; }
  }
  return [x, y];
}

export interface NightPlan {
  night: number;
  seed: number;
  startPos: Vec2;
  /** Start realm per dreamer (same for all unless divergent). */
  startRealms: string[];
  divergent: boolean;
  laws: string[];
  motif: MotifKind;
  hueDeg: number;
  accent: [number, number, number];
  /** Motif melody as scale degrees. */
  theme: number[];
  tagBias: Partial<Record<Tag, number>>;
  startLucidityBonus: number;
  deepBias: number;
}

function quadrantRealm(p: Vec2): string {
  const q = quadrantOf(p);
  return resolveRealm(QUADRANT_START[q] ?? 'tidal-stair');
}

export function planNight(h: Household, players: number, overrideStart?: string): NightPlan {
  const seed = hash(h.runSeed, h.night);
  const rng = new PCG32(seed, 0x91a7);
  const lastGroup = h.groupDots[h.groupDots.length - 1] ?? [0, 0];
  const infl = roomInfluence(h);
  const startPos = clampMove(h.lastStart, [lastGroup[0] + infl[0], lastGroup[1] + infl[1]], tuning.resonance.maxMove);

  // divergent: last night's individual dots far apart
  const last = h.dots.filter((d) => d.night === h.night - 1);
  let divergent = false;
  if (last.length > 1) {
    let maxD = 0;
    for (const a of last) for (const b of last) maxD = Math.max(maxD, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    divergent = maxD > tuning.resonance.divergentDist;
  }
  // sill souvenir: tag bias x2 on tomorrow's first link and start realm
  const sill = h.room['sill'] ? SOUVENIR.get(h.room['sill']!) : undefined;
  const tagBias: Partial<Record<Tag, number>> = sill ? { [sill.tag]: 2 } : {};
  let start = overrideStart ?? quadrantRealm(startPos);
  if (!overrideStart && sill) {
    // the sill nudges the start toward a realm carrying its tag
    const withTag = [...META.values()].filter((m) => m.implemented && m.tags.includes(sill.tag) && m.id !== 'lantern-flat');
    if (withTag.length && rng.chance(0.5)) start = rng.pick(withTag).id;
  }
  const startRealms: string[] = [];
  for (let i = 0; i < players; i++) {
    if (divergent && !overrideStart) {
      const d = last.find((x) => x.dreamer === i);
      startRealms.push(d ? quadrantRealm([d.x, d.y]) : start);
    } else startRealms.push(start);
  }

  // laws: 0-2, more on Deep nights; the first night is lawless
  const depth = depthOf(startPos);
  const under = h.room['under'];
  const deepBias = under ? 2 : 1;
  let lawCount = 0;
  if (h.night > 1) {
    const r = rng.next();
    const p1 = 0.35 + depth * 0.2, p2 = 0.08 + depth * 0.17;
    lawCount = r < p2 ? 2 : r < p2 + p1 ? 1 : 0;
  }
  const laws: string[] = [];
  const pool = LAWS.slice();
  for (let i = 0; i < lawCount && pool.length; i++) {
    const w = pool.map((l) => l.weight * (l.deep ? (0.5 + depth) * deepBias : 1));
    const k = rng.weighted(w);
    laws.push(pool[k].id);
    pool.splice(k, 1);
    // exclusive pairs
    if (pool.length) for (const ex of [['giant', 'tiny']]) if (ex.includes(laws[laws.length - 1])) for (const e of ex) { const j = pool.findIndex((l) => l.id === e); if (j >= 0) pool.splice(j, 1); }
  }

  // motif: the wall hook's motif appears twice as often
  const hook = h.room['hook'] ? SOUVENIR.get(h.room['hook']!)?.motif : null;
  const motifW = MOTIF_KINDS.map((m) => (hook && hook.includes(m.split('-')[0]) ? 2 : 1));
  let motif = MOTIF_KINDS[rng.weighted(motifW)];
  for (const id of laws) { const m = (LAW.get(id)?.effects as Record<string, unknown> | undefined)?.motif; if (typeof m === 'string' && (MOTIF_KINDS as readonly string[]).includes(m)) motif = m as MotifKind; }
  const hueDeg = rng.range(-25, 25);
  // OKLCH-ish accent: random hue at high chroma, converted crudely to RGB
  const ah = rng.range(0, Math.PI * 2);
  const accent: [number, number, number] = [0.6 + 0.4 * Math.cos(ah), 0.6 + 0.4 * Math.cos(ah - 2.09), 0.6 + 0.4 * Math.cos(ah + 2.09)];
  const themeLen = 4 + rng.int(3);
  const theme: number[] = [];
  for (let i = 0; i < themeLen; i++) theme.push(rng.int(8));
  const bedside = h.room['bedside'] ? tuning.lucidity.bedsideBonus : 0;
  return { night: h.night, seed, startPos, startRealms, divergent, laws, motif, hueDeg, accent, theme, tagBias, startLucidityBonus: bedside, deepBias };
}

/** Window preview: the key colour of tomorrow's likely start realm. */
export function windowPreview(h: Household): string {
  const plan = planNight(h, 1);
  return META.get(plan.startRealms[0])?.key ?? '#FFD9A0';
}
