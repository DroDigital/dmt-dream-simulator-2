/**
 * The Watcher (§3.10): a 2.4 m figure in a long coat whose body is a hole. He walks in one straight line
 * at 1.1 m/s, never turns and never chases. States: Absent -> Walking -> Near -> Contact | Followed | Gone.
 *  - Near (<= 10 m): music low-pass closes, lucidity -2/s, static at the screen edges
 *  - Contact (<= 0.8 m): that dreamer wakes now, loses their souvenir, tonight's Afterimage is erased
 *  - Followed: stay 3-8 m behind him for 30 s without contact -> he walks through a wall that becomes a
 *    doorway into a hidden room (Veiled content), then Gone
 *  - Shield (co-op): a dreamer between him and another within 1.5 m makes him stop 2 s, then walk the long way round
 */
import { PCG32, hash } from '../core/rng.ts';
import { DT, tuning } from '../core/tuning.ts';
import { floodFill } from '../realms/layoutgen.ts';
import type { Visit } from '../director/visit.ts';

export type WatcherState = 'walking' | 'near' | 'contact' | 'followed' | 'gone';

export interface Watcher {
  visitId: number;
  x: number; y: number; z: number;
  dirX: number; dirZ: number;
  state: WatcherState;
  /** Seconds a dreamer has been following (per dreamer). */
  follow: number[];
  stopT: number;
  /** Detour after a shield: remaining metres to walk sideways, and the sideways direction. */
  detour: number;
  detourX: number; detourZ: number;
  doorway: { x: number; z: number } | null;
  t: number;
  /** Dreamers who were near him (Deep +2 once). */
  met: number;
}

export interface WatcherDreamer { index: number; x: number; z: number; lucidity: number; awake: boolean }

/** Spawn chance per visit: 0.02 + 0.06 x depth, at most once per night, never in the first 60 s. */
export function watcherChance(depth: number): number {
  return tuning.watcher.baseChance + tuning.watcher.depthChance * depth;
}

export function spawnWatcher(v: Visit, dreamers: WatcherDreamer[], seed: number): Watcher | null {
  if (!dreamers.length) return null;
  const rng = new PCG32(hash(seed, 0x3a7c), 0x3a7c);
  // target the most lucid dreamer: spawn on their side of the realm, walking past them
  const target = dreamers.reduce((a, b) => (b.lucidity > a.lucidity ? b : a));
  const g = v.walk;
  const sp = v.layout.spawns[0];
  const reach = floodFill(g, sp.x, sp.z);
  for (let t = 0; t < 40; t++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(22, 34);
    const x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r;
    if (x < 2 || z < 2 || x > v.size - 2 || z > v.size - 2) continue;
    const i = Math.floor(z / g.res) * g.size + Math.floor(x / g.res);
    if (!reach[i]) continue;
    // heading toward a point a few metres beside the target, so he passes close but never chases
    const px = target.x + rng.range(-3, 3), pz = target.z + rng.range(-3, 3);
    const l = Math.hypot(px - x, pz - z) || 1;
    return {
      visitId: v.id, x, y: g.height[i], z, dirX: (px - x) / l, dirZ: (pz - z) / l, state: 'walking', follow: [0, 0, 0, 0],
      stopT: 0, detour: 0, detourX: 0, detourZ: 0, doorway: null, t: 0, met: 0,
    };
  }
  return null;
}

export interface WatcherResult {
  contact: number[];
  near: number[];
  firstMet: number[];
  doorway: { x: number; z: number } | null;
  gone: boolean;
}

/** Advance the Watcher one tick. Pure with respect to its inputs (deterministic). */
export function stepWatcher(w: Watcher, v: Visit, dreamers: WatcherDreamer[], timeScale = 1): WatcherResult {
  const res: WatcherResult = { contact: [], near: [], firstMet: [], doorway: null, gone: false };
  if (w.state === 'gone') return res;
  const dt = DT * timeScale;
  w.t += dt;
  const W = tuning.watcher;

  // shield: someone standing between him and another dreamer, within 1.5 m of the line
  if (w.stopT <= 0 && w.detour <= 0) {
    for (const s of dreamers) for (const o of dreamers) {
      if (s === o || s.awake || o.awake) continue;
      const dox = o.x - w.x, doz = o.z - w.z;
      const L = Math.hypot(dox, doz);
      if (L > 12 || L < 0.5) continue;
      const t = ((s.x - w.x) * dox + (s.z - w.z) * doz) / (L * L);
      if (t <= 0 || t >= 1) continue;
      const px = w.x + dox * t, pz = w.z + doz * t;
      if (Math.hypot(s.x - px, s.z - pz) < W.shieldM && Math.hypot(s.x - w.x, s.z - w.z) < 4) {
        w.stopT = W.shieldStopS;
        w.detour = 8;
        w.detourX = -w.dirZ; w.detourZ = w.dirX;
      }
    }
  }
  if (w.stopT > 0) w.stopT -= dt;
  else {
    const dx = w.detour > 0 ? w.detourX : w.dirX;
    const dz = w.detour > 0 ? w.detourZ : w.dirZ;
    w.x += dx * W.speed * dt;
    w.z += dz * W.speed * dt;
    if (w.detour > 0) w.detour -= W.speed * dt;
  }
  const g = v.walk;
  const i = Math.floor(Math.min(v.size - 0.5, Math.max(0.5, w.z)) / g.res) * g.size + Math.floor(Math.min(v.size - 0.5, Math.max(0.5, w.x)) / g.res);
  w.y += (g.height[i] - w.y) * 0.2;

  let anyNear = false;
  for (const d of dreamers) {
    if (d.awake) continue;
    const dist = Math.hypot(d.x - w.x, d.z - w.z);
    if (dist <= W.contactM) { res.contact.push(d.index); continue; }
    if (dist <= W.nearM) {
      anyNear = true;
      res.near.push(d.index);
      if (!(w.met & (1 << d.index))) { w.met |= 1 << d.index; res.firstMet.push(d.index); }
    }
    // following: behind him (negative along his heading) at 3-8 m
    const along = (d.x - w.x) * w.dirX + (d.z - w.z) * w.dirZ;
    const side = Math.abs((d.x - w.x) * -w.dirZ + (d.z - w.z) * w.dirX);
    if (along < -W.followMin && along > -W.followMax && side < 3) w.follow[d.index] += dt;
    else w.follow[d.index] = Math.max(0, w.follow[d.index] - dt * 0.5);
    if (w.follow[d.index] >= W.followS && w.state !== 'followed') {
      w.state = 'followed';
      w.doorway = { x: w.x + w.dirX * 2, z: w.z + w.dirZ * 2 };
      res.doorway = w.doorway;
    }
  }
  if (res.contact.length) w.state = 'contact';
  else if (w.state !== 'followed') w.state = anyNear ? 'near' : 'walking';
  // leaves the realm, or vanishes into his doorway
  if (w.x < -5 || w.z < -5 || w.x > v.size + 5 || w.z > v.size + 5 || (w.state === 'followed' && w.t > 0 && w.doorway && Math.hypot(w.x - w.doorway.x, w.z - w.doorway.z) < 0.3)) {
    w.state = 'gone';
    res.gone = true;
  }
  return res;
}
