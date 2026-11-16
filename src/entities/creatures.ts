/**
 * Creatures (M4 entities): Drifters (slow wandering silhouettes), Book-fish (a boids flock in the
 * Drowned Library and the Fractal Reef) and the Moth Choir (moths orbiting light sources).
 * Deterministic: all randomness comes from the visit seed.
 */
import { PCG32, hash } from '../core/rng.ts';
import { DT } from '../core/tuning.ts';
import { Heading, InVisit, Pos, Vel, Wander, inVisit, spawn, type EcsWorld } from './ecs.ts';
import type { Visit } from '../director/visit.ts';

export const Drifter = { tone: [] as number[] };
export const BookFish = { flock: [] as number[], hue: [] as number[] };
export const Moth = { target: [] as number[], phase: [] as number[], radius: [] as number[] };

export function populateCreatures(v: Visit, ecs: EcsWorld, folkMul = 1): void {
  if (['lantern-flat', 'veiled-room', 'chorus-room', 'vision'].includes(v.realm)) return;
  const rng = new PCG32(hash(v.seed, 0xc4ea), 0xc4ea);
  const g = v.walk;
  const spot = (): { x: number; y: number; z: number } | null => {
    for (let t = 0; t < 40; t++) {
      const i = rng.int(g.size * g.size);
      if (g.blocked[i]) continue;
      return { x: ((i % g.size) + 0.5) * g.res, y: g.height[i], z: (Math.floor(i / g.size) + 0.5) * g.res };
    }
    return null;
  };
  // drifters: 1-3 per realm
  const nd = Math.round((1 + rng.int(3)) * folkMul);
  for (let i = 0; i < nd; i++) {
    const p = spot(); if (!p) continue;
    const e = spawn(ecs, v.id, p.x, p.y, p.z, Drifter, Wander);
    Drifter.tone[e] = rng.next();
    Wander.phase[e] = rng.range(0, 100); Wander.speed[e] = 0.25 + rng.next() * 0.2;
    Wander.homeX[e] = p.x; Wander.homeZ[e] = p.z; Wander.radius[e] = 20;
  }
  // book-fish flocks
  if (v.realm === 'drowned-library' || v.realm === 'fractal-reef') {
    for (let f = 0; f < 2; f++) {
      const c = spot(); if (!c) continue;
      for (let i = 0; i < 18; i++) {
        const e = spawn(ecs, v.id, c.x + rng.range(-2, 2), c.y + 1.5 + rng.range(0, 2), c.z + rng.range(-2, 2), BookFish, Wander);
        BookFish.flock[e] = f; BookFish.hue[e] = rng.next();
        Vel.x[e] = rng.range(-1, 1); Vel.y[e] = 0; Vel.z[e] = rng.range(-1, 1);
        Wander.homeX[e] = c.x; Wander.homeZ[e] = c.z; Wander.radius[e] = 12;
      }
    }
  }
  // moth choir around light sources
  const lights = v.objects.filter((o) => o.tags.includes('light') && o.kind === 'prop');
  const nm = Math.min(lights.length, 4);
  for (let k = 0; k < nm; k++) {
    const o = lights[rng.int(lights.length)];
    for (let i = 0; i < 6; i++) {
      const e = spawn(ecs, v.id, o.x, o.y + o.height, o.z, Moth);
      Moth.target[e] = o.id; Moth.phase[e] = rng.range(0, Math.PI * 2); Moth.radius[e] = 0.4 + rng.next() * 0.5;
    }
  }
}

export function stepCreatures(v: Visit, ecs: EcsWorld, tick: number, timeScale = 1): void {
  const dt = DT * timeScale;
  const g = v.walk;
  for (const e of inVisit(ecs, v.id, [Drifter])) {
    const t = tick * DT * 0.12 + Wander.phase[e];
    const a = Math.sin(t * 0.5) * 2 + Wander.phase[e];
    const nx = Pos.x[e] + Math.cos(a) * Wander.speed[e] * dt, nz = Pos.z[e] + Math.sin(a) * Wander.speed[e] * dt;
    const i = Math.floor(Math.min(v.size - 0.5, Math.max(0.5, nz)) / g.res) * g.size + Math.floor(Math.min(v.size - 0.5, Math.max(0.5, nx)) / g.res);
    if (!g.blocked[i]) { Pos.x[e] = nx; Pos.z[e] = nz; Pos.y[e] += (g.height[i] - Pos.y[e]) * 0.1; }
    Heading.yaw[e] = Math.atan2(Math.cos(a), -Math.sin(a));
  }
  const fish = inVisit(ecs, v.id, [BookFish]);
  for (const e of fish) {
    let cx = 0, cy = 0, cz = 0, ax = 0, ay = 0, az = 0, sx = 0, sy = 0, sz = 0, n = 0;
    for (const o of fish) {
      if (o === e || BookFish.flock[o] !== BookFish.flock[e]) continue;
      const dx = Pos.x[o] - Pos.x[e], dy = Pos.y[o] - Pos.y[e], dz = Pos.z[o] - Pos.z[e];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 16) continue;
      n++; cx += dx; cy += dy; cz += dz; ax += Vel.x[o]; ay += Vel.y[o]; az += Vel.z[o];
      if (d2 < 0.6) { sx -= dx; sy -= dy; sz -= dz; }
    }
    if (n) {
      Vel.x[e] += (cx / n * 0.6 + (ax / n - Vel.x[e]) * 0.5 + sx * 1.5) * dt;
      Vel.y[e] += (cy / n * 0.6 + (ay / n - Vel.y[e]) * 0.5 + sy * 1.5) * dt;
      Vel.z[e] += (cz / n * 0.6 + (az / n - Vel.z[e]) * 0.5 + sz * 1.5) * dt;
    }
    // stay near home, between 1 and 5 m above the floor
    const hx = Wander.homeX[e] - Pos.x[e], hz = Wander.homeZ[e] - Pos.z[e];
    if (hx * hx + hz * hz > Wander.radius[e] ** 2) { Vel.x[e] += hx * 0.05 * dt * 10; Vel.z[e] += hz * 0.05 * dt * 10; }
    const i = Math.floor(Math.min(v.size - 0.5, Math.max(0.5, Pos.z[e])) / g.res) * g.size + Math.floor(Math.min(v.size - 0.5, Math.max(0.5, Pos.x[e])) / g.res);
    const floor = g.height[i];
    if (Pos.y[e] < floor + 1) Vel.y[e] += 2 * dt; if (Pos.y[e] > floor + 5) Vel.y[e] -= 2 * dt;
    const sp = Math.hypot(Vel.x[e], Vel.y[e], Vel.z[e]) || 1;
    const k = Math.min(2.2, Math.max(0.8, sp)) / sp;
    Vel.x[e] *= k; Vel.y[e] *= k; Vel.z[e] *= k;
    Pos.x[e] += Vel.x[e] * dt; Pos.y[e] += Vel.y[e] * dt; Pos.z[e] += Vel.z[e] * dt;
    Heading.yaw[e] = Math.atan2(Vel.x[e], -Vel.z[e]);
  }
  for (const e of inVisit(ecs, v.id, [Moth])) {
    const o = v.objects[Moth.target[e]];
    if (!o) continue;
    Moth.phase[e] += dt * (2.2 + Moth.radius[e]);
    const ph = Moth.phase[e];
    Pos.x[e] = o.x + Math.cos(ph) * Moth.radius[e];
    Pos.z[e] = o.z + Math.sin(ph * 1.07) * Moth.radius[e];
    Pos.y[e] = o.y + o.height + 0.2 + Math.sin(ph * 2.3) * 0.25;
    Heading.yaw[e] = ph;
  }
  void InVisit;
}
