import { PCG32, hash } from '../core/rng.ts';
import type {
  Components, Floor, KitDef, Layout, LayoutMetrics, PlacedProp, RealmData, Spawn, Tag, TileDef,
} from './types.ts';
import { buildVariants, dirIndex, solveWfc, type Variant } from './wfc.ts';

/** Walkability sample resolution in metres. */
export const WALK_RES = 1;
export const MAX_STEP = 0.5;

export interface WalkGrid {
  size: number; // samples per side
  res: number;
  height: Float32Array;
  blocked: Uint8Array;
}

export interface LinkableObject {
  x: number;
  z: number;
  /** Distance from the object centre at which a dreamer touches it. */
  reach: number;
  tags: Tag[];
  source: 'tile' | 'prop';
  index: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  metrics: LayoutMetrics;
}

export interface GenerateResult {
  layout: Layout;
  validation: ValidationResult;
  attempts: number;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Rotate a local point (origin at cell centre) by quarter turns clockwise (N -> E). */
function rotPoint(x: number, z: number, rot: number): [number, number] {
  let a = x, b = z;
  for (let i = 0; i < rot; i++) { const t = a; a = -b; b = t; }
  return [a, b];
}

export function rotateRect(rect: readonly number[], rot: number, cell: number): [number, number, number, number] {
  const h = cell / 2;
  const [ax, az] = rotPoint(rect[0] - h, rect[1] - h, rot);
  const [bx, bz] = rotPoint(rect[2] - h, rect[3] - h, rot);
  return [Math.min(ax, bx) + h, Math.min(az, bz) + h, Math.max(ax, bx) + h, Math.max(az, bz) + h];
}

const LOW_ROT: Record<string, number> = { N: 0, E: 1, S: 2, W: 3 };

/** Floor height at local position (lx, lz in 0..cell) of a rotated tile. */
export function floorHeight(floor: Floor, rot: number, lx: number, lz: number, cell: number, levelH: number): number {
  if (floor.kind === 'flat') return floor.level * levelH;
  if (floor.kind === 'solid') return floor.level * levelH + floor.height;
  const low = (LOW_ROT[floor.low] + rot) % 4; // low side after rotation
  // t = 0 at the low edge, 1 at the opposite edge
  let t: number;
  if (low === 0) t = lz / cell; // low edge is north (z = 0)
  else if (low === 2) t = 1 - lz / cell;
  else if (low === 3) t = lx / cell; // low edge west (x = 0)
  else t = 1 - lx / cell;
  return (floor.from + (floor.to - floor.from) * t) * levelH;
}

// ---------------------------------------------------------------------------------------------
// Walkability
// ---------------------------------------------------------------------------------------------

export function buildWalkGrid(kit: KitDef, layout: Pick<Layout, 'variants' | 'cells' | 'props'>, includeProps = true): WalkGrid {
  const size = Math.round((kit.grid * kit.cell) / WALK_RES);
  const height = new Float32Array(size * size);
  const blocked = new Uint8Array(size * size);
  const tileById = new Map(kit.tiles.map((t) => [t.id, t]));
  for (let sz = 0; sz < size; sz++) {
    for (let sx = 0; sx < size; sx++) {
      const wx = (sx + 0.5) * WALK_RES;
      const wz = (sz + 0.5) * WALK_RES;
      const cx = Math.floor(wx / kit.cell), cz = Math.floor(wz / kit.cell);
      const v = layout.variants[layout.cells[cz * kit.grid + cx]];
      const tile = tileById.get(v.id)!;
      const lx = wx - cx * kit.cell, lz = wz - cz * kit.cell;
      const i = sz * size + sx;
      height[i] = floorHeight(tile.floor, v.rot, lx, lz, kit.cell, kit.levelHeight);
      if (tile.floor.kind === 'solid') blocked[i] = 1;
      for (const fp of tile.footprints ?? []) {
        const r = rotateRect(fp.rect, v.rot, kit.cell);
        if (lx >= r[0] && lx <= r[2] && lz >= r[1] && lz <= r[3]) blocked[i] = 1;
      }
    }
  }
  if (includeProps) {
    for (const p of layout.props) {
      if (p.radius <= 0) continue;
      const r = p.radius;
      const x0 = Math.max(0, Math.floor((p.x - r) / WALK_RES)), x1 = Math.min(size - 1, Math.floor((p.x + r) / WALK_RES));
      const z0 = Math.max(0, Math.floor((p.z - r) / WALK_RES)), z1 = Math.min(size - 1, Math.floor((p.z + r) / WALK_RES));
      for (let sz = z0; sz <= z1; sz++) for (let sx = x0; sx <= x1; sx++) {
        const dx = (sx + 0.5) * WALK_RES - p.x, dz = (sz + 0.5) * WALK_RES - p.z;
        if (dx * dx + dz * dz <= r * r) blocked[sz * size + sx] = 1;
      }
    }
  }
  return { size, res: WALK_RES, height, blocked };
}

/** 4-neighbour flood fill honouring max step height. Returns reached mask. */
export function floodFill(g: WalkGrid, startX: number, startZ: number): Uint8Array {
  const reached = new Uint8Array(g.size * g.size);
  const sx = Math.floor(startX / g.res), sz = Math.floor(startZ / g.res);
  if (sx < 0 || sz < 0 || sx >= g.size || sz >= g.size) return reached;
  const s = sz * g.size + sx;
  if (g.blocked[s]) return reached;
  const q = new Int32Array(g.size * g.size);
  let qh = 0, qt = 0;
  q[qt++] = s;
  reached[s] = 1;
  while (qh < qt) {
    const c = q[qh++];
    const cx = c % g.size, cz = (c / g.size) | 0;
    const h = g.height[c];
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 1 ? 1 : d === 3 ? -1 : 0);
      const nz = cz + (d === 2 ? 1 : d === 0 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= g.size || nz >= g.size) continue;
      const n = nz * g.size + nx;
      if (reached[n] || g.blocked[n]) continue;
      if (Math.abs(g.height[n] - h) > MAX_STEP) continue;
      reached[n] = 1;
      q[qt++] = n;
    }
  }
  return reached;
}

export function sampleIndex(g: WalkGrid, x: number, z: number): number {
  const sx = Math.min(g.size - 1, Math.max(0, Math.floor(x / g.res)));
  const sz = Math.min(g.size - 1, Math.max(0, Math.floor(z / g.res)));
  return sz * g.size + sx;
}

/** Any reached sample within `radius` of (x, z)? */
function reachedNear(g: WalkGrid, reached: Uint8Array, x: number, z: number, radius: number): boolean {
  const r = Math.ceil(radius / g.res);
  const cx = Math.floor(x / g.res), cz = Math.floor(z / g.res);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const sx = cx + dx, sz = cz + dz;
    if (sx < 0 || sz < 0 || sx >= g.size || sz >= g.size) continue;
    const px = (sx + 0.5) * g.res - x, pz = (sz + 0.5) * g.res - z;
    if (px * px + pz * pz > radius * radius) continue;
    if (reached[sz * g.size + sx]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Linkables
// ---------------------------------------------------------------------------------------------

export function collectLinkables(kit: KitDef, layout: Pick<Layout, 'variants' | 'cells' | 'props'>): LinkableObject[] {
  const out: LinkableObject[] = [];
  const tileById = new Map(kit.tiles.map((t) => [t.id, t]));
  for (let c = 0; c < layout.cells.length; c++) {
    const v = layout.variants[layout.cells[c]];
    const tile = tileById.get(v.id)!;
    if (!tile.components?.linkable) continue;
    const cx = c % kit.grid, cz = Math.floor(c / kit.grid);
    out.push({
      x: (cx + 0.5) * kit.cell,
      z: (cz + 0.5) * kit.cell,
      reach: kit.cell * 0.5 + 1.2,
      tags: tile.tags ?? [],
      source: 'tile',
      index: c,
    });
  }
  layout.props.forEach((p, i) => {
    if (!p.components.linkable) return;
    out.push({ x: p.x, z: p.z, reach: Math.max(p.radius, 0.3) + 1.0, tags: p.tags, source: 'prop', index: i });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation + metrics
// ---------------------------------------------------------------------------------------------

export function validateLayout(data: RealmData, layout: Layout): ValidationResult {
  const { kit } = data;
  const errors: string[] = [];
  const g = buildWalkGrid(kit, layout, true);
  const metrics: LayoutMetrics = { walkableArea: 0, linkableCount: 0, meanDistToLinkable: 0, maxDistToLinkable: 0, heightVariance: 0 };

  if (layout.spawns.length < 1) {
    errors.push('no spawn points');
    return { ok: false, errors, metrics };
  }

  // Spawn clearance: no geometry intersecting spawn points.
  for (const [i, s] of layout.spawns.entries()) {
    const idx = sampleIndex(g, s.x, s.z);
    if (g.blocked[idx]) errors.push(`spawn ${i} inside blocked geometry`);
    for (const p of layout.props) {
      if (p.radius <= 0) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < p.radius + 0.45) errors.push(`spawn ${i} intersects prop ${p.id}`);
    }
  }

  const reached = floodFill(g, layout.spawns[0].x, layout.spawns[0].z);
  for (const [i, s] of layout.spawns.entries()) {
    if (!reached[sampleIndex(g, s.x, s.z)]) errors.push(`spawn ${i} unreachable from spawn 0`);
  }
  if (!reachedNear(g, reached, layout.landmark.x, layout.landmark.z, 4)) errors.push('landmark unreachable');
  if (!reachedNear(g, reached, layout.quiet.x, layout.quiet.z, 2)) errors.push('quiet place unreachable');

  // Linkables reachable
  const links = collectLinkables(kit, layout).filter((l) => reachedNear(g, reached, l.x, l.z, l.reach));
  metrics.linkableCount = links.length;
  if (links.length < 40) errors.push(`only ${links.length} reachable linkables (< 40)`);
  for (const tag of kit.linkTags) {
    if (!links.some((l) => l.tags.includes(tag))) errors.push(`no reachable linkable with tag ${tag}`);
  }

  const reachableProps = layout.props.filter((p) => reachedNear(g, reached, p.x, p.z, Math.max(p.radius, 0.3) + 1.2));
  const anomalyTiles = countAnomalyTiles(kit, layout);
  const anomalies = reachableProps.filter((p) => p.components.anomaly).length + anomalyTiles;
  if (anomalies < 6) errors.push(`only ${anomalies} anomaly-capable objects (< 6)`);
  const carry = reachableProps.filter((p) => p.components.carryable).length;
  if (carry < 2) errors.push(`only ${carry} carryables (< 2)`);

  // Distance to nearest linkable over reachable samples (binned for speed).
  const bin = 8;
  const bins = Math.ceil((g.size * g.res) / bin);
  const binned: LinkableObject[][] = Array.from({ length: bins * bins }, () => []);
  for (const l of links) {
    const bx = Math.min(bins - 1, Math.max(0, Math.floor(l.x / bin)));
    const bz = Math.min(bins - 1, Math.max(0, Math.floor(l.z / bin)));
    binned[bz * bins + bx].push(l);
  }
  let area = 0, sumD = 0, maxD = 0, sumH = 0, sumH2 = 0;
  for (let sz = 0; sz < g.size; sz++) for (let sx = 0; sx < g.size; sx++) {
    const i = sz * g.size + sx;
    if (!reached[i]) continue;
    area++;
    const h = g.height[i];
    sumH += h; sumH2 += h * h;
    const x = (sx + 0.5) * g.res, z = (sz + 0.5) * g.res;
    const bx = Math.floor(x / bin), bz = Math.floor(z / bin);
    let best = Infinity;
    for (let ring = 0; ring < bins; ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const nx = bx + dx, nz = bz + dz;
        if (nx < 0 || nz < 0 || nx >= bins || nz >= bins) continue;
        for (const l of binned[nz * bins + nx]) {
          const d = Math.max(0, Math.hypot(l.x - x, l.z - z) - l.reach);
          if (d < best) best = d;
        }
      }
      // Any object in ring r+1 is at least r*bin away.
      if (best <= ring * bin) break;
    }
    sumD += best;
    if (best > maxD) maxD = best;
  }
  metrics.walkableArea = area * g.res * g.res;
  metrics.meanDistToLinkable = area ? sumD / area : 0;
  metrics.maxDistToLinkable = maxD;
  const meanH = area ? sumH / area : 0;
  metrics.heightVariance = area ? sumH2 / area - meanH * meanH : 0;
  if (maxD > 30) errors.push(`reachable area ${maxD.toFixed(1)} m from nearest linkable (> 30)`);

  return { ok: errors.length === 0, errors, metrics };
}

function countAnomalyTiles(kit: KitDef, layout: Layout): number {
  const byId = new Map(kit.tiles.map((t) => [t.id, t]));
  let n = 0;
  for (const c of layout.cells) if (byId.get(layout.variants[c].id)?.components?.anomaly) n++;
  return Math.min(n, 12);
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

function findVariant(variants: Variant[], id: string, rot = 0): number {
  let fallback = -1;
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].tile.id !== id) continue;
    if (variants[i].rot === rot) return i;
    if (fallback < 0) fallback = i;
  }
  if (fallback < 0) throw new Error(`fixed tile ${id} not in kit`);
  return fallback;
}

function tileOk(tile: TileDef): boolean {
  return tile.floor.kind !== 'solid';
}

/** Generate one layout attempt (no validation). Returns null if WFC contradicts. */
export function generateAttempt(data: RealmData, seed: number, attempt: number): Layout | null {
  const { kit, rules, fixed } = data;
  const rng = new PCG32(hash(seed, attempt), 0x5eed);
  const variants = buildVariants(kit);
  const weights = new Float64Array(variants.length);
  const jitter = new Map<string, number>();
  for (const [id, [lo, hi]] of Object.entries(rules.weightJitter ?? {})) jitter.set(id, rng.range(lo, hi));
  variants.forEach((v, i) => { weights[i] = v.weight * (jitter.get(v.tile.id) ?? 1); });

  const G = kit.grid;
  const fixedCells = new Map<number, number>();
  for (const fp of [fixed.landmark, fixed.quiet]) {
    const [fx, fz] = fp.cell;
    const r = fp.clear ?? 0;
    if (r > 0 && fp.clearTile) {
      const cv = findVariant(variants, fp.clearTile);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = fx + dx, z = fz + dz;
        if (x < 0 || z < 0 || x >= G || z >= G) continue;
        fixedCells.set(z * G + x, cv);
      }
    }
    fixedCells.set(fz * G + fx, findVariant(variants, fp.tile, fp.rot ?? 0));
  }

  // Seeded irregular extent: cells beyond it become the border tile.
  if (rules.border && rules.extent) {
    const bv = findVariant(variants, rules.border);
    const e = rng.range(rules.extent[0], rules.extent[1]);
    const p1 = rng.range(0, Math.PI * 2), p2 = rng.range(0, Math.PI * 2);
    const R = G / 2;
    const keep = [fixed.landmark.cell, fixed.quiet.cell];
    for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
      const dx = x + 0.5 - R, dz = z + 0.5 - R;
      const th = Math.atan2(dz, dx);
      const r = R * (e + 0.07 * Math.sin(3 * th + p1) + 0.04 * Math.sin(5 * th + p2));
      if (Math.hypot(dx, dz) <= r) continue;
      if (keep.some(([kx, kz]) => Math.abs(kx - x) <= 2 && Math.abs(kz - z) <= 2)) continue;
      const c = z * G + x;
      if (!fixedCells.has(c)) fixedCells.set(c, bv);
    }
  }

  const res = solveWfc(variants, rules, G, rng, weights, fixedCells);
  if (!res.ok) return null;

  const varTable: { id: string; rot: number }[] = variants.map((v) => ({ id: v.tile.id, rot: v.rot }));
  const cells = Array.from(res.cells);
  const cellAt = (x: number, z: number) => variants[cells[z * G + x]];

  const base = { variants: varTable, cells, props: [] as PlacedProp[] };
  const g0 = buildWalkGrid(kit, base, false);
  const heightAt = (x: number, z: number) => g0.height[sampleIndex(g0, x, z)];

  // ---- Poisson-disk prop scatter ----
  const props: PlacedProp[] = [];
  const centre = (fp: { cell: [number, number] }) => ({ x: (fp.cell[0] + 0.5) * kit.cell, z: (fp.cell[1] + 0.5) * kit.cell });
  const lm = centre(fixed.landmark);
  const qp = centre(fixed.quiet);
  const place = (id: string, x: number, z: number, rot: number) => {
    const def = kit.props.find((p) => p.id === id);
    if (!def) throw new Error(`prop ${id} not in kit`);
    const [s0, s1] = def.scale ?? [1, 1];
    const scale = s0 + (s1 - s0) * rng.next();
    props.push({
      id, x, z, y: heightAt(x, z) + (def.hover ?? 0), rot, scale,
      tags: def.tags, components: { ...def.components }, radius: def.radius * scale, height: def.height * scale,
    });
  };
  if (fixed.landmark.prop) place(fixed.landmark.prop, lm.x, lm.z, 0);
  if (fixed.quiet.prop) place(fixed.quiet.prop, qp.x, qp.z, 0);

  const eligibleCells = new Map<string, number[]>();
  for (const def of kit.props) {
    const list: number[] = [];
    for (let c = 0; c < cells.length; c++) {
      const v = variants[cells[c]];
      if (def.on.includes(v.tile.id) && v.tile.scatter !== false) list.push(c);
    }
    eligibleCells.set(def.id, list);
  }

  const blockedAt = (x: number, z: number) => g0.blocked[sampleIndex(g0, x, z)] === 1;
  for (const def of kit.props) {
    const list = eligibleCells.get(def.id)!;
    if (!list.length) continue;
    const area = list.length * kit.cell * kit.cell;
    const target = Math.max(def.components.carryable ? 3 : 0, Math.round((def.density * area) / 100));
    const rule = rules.density?.find((r) => r.prop === def.id);
    let placed = 0;
    const tries = target * 30 + 20;
    for (let t = 0; t < tries && placed < target; t++) {
      const c = list[rng.int(list.length)];
      const cx = c % G, cz = Math.floor(c / G);
      const x = (cx + 0.15 + rng.next() * 0.7) * kit.cell;
      const z = (cz + 0.15 + rng.next() * 0.7) * kit.cell;
      if (blockedAt(x, z)) continue;
      // keep the landmark / quiet place approach and spawn area open
      if (Math.hypot(x - lm.x, z - lm.z) < 3.5 || Math.hypot(x - qp.x, z - qp.z) < 2.5) continue;
      let ok = true;
      for (const p of props) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (p.id === def.id && d < def.spacing) { ok = false; break; }
        if (d < p.radius + def.radius + 0.9) { ok = false; break; }
      }
      if (!ok) continue;
      if (rule) {
        const near = props.some((p) => p.id === rule.near && Math.hypot(p.x - x, p.z - z) < rule.radius);
        if (!near && !rng.chance(1 / rule.boost)) continue;
      }
      place(def.id, x, z, rng.int(4) * (Math.PI / 2) + rng.range(-0.3, 0.3));
      placed++;
    }
  }

  // ---- Spawns: farthest-point sampling over reachable walkable samples ----
  const withProps = { variants: varTable, cells, props };
  const g = buildWalkGrid(kit, withProps, true);
  const startIdx = (() => {
    // start the flood from the walkable sample closest to the landmark
    let best = -1, bestD = Infinity;
    for (let i = 0; i < g.size * g.size; i++) {
      if (g.blocked[i]) continue;
      const x = ((i % g.size) + 0.5) * g.res, z = (Math.floor(i / g.size) + 0.5) * g.res;
      const d = Math.hypot(x - lm.x, z - lm.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  })();
  const spawns: Spawn[] = [];
  if (startIdx >= 0) {
    const sx = ((startIdx % g.size) + 0.5) * g.res, sz = (Math.floor(startIdx / g.size) + 0.5) * g.res;
    const reached = floodFill(g, sx, sz);
    const candidates: number[] = [];
    for (let i = 0; i < reached.length; i++) {
      if (!reached[i]) continue;
      const x = ((i % g.size) + 0.5) * g.res, z = (Math.floor(i / g.size) + 0.5) * g.res;
      const cx = Math.floor(x / kit.cell), cz = Math.floor(z / kit.cell);
      const v = cellAt(cx, cz);
      if (!v.tile.spawnable || !tileOk(v.tile)) continue;
      // clearance: all 8 neighbours reached and away from props
      let clear = true;
      for (let dz = -1; dz <= 1 && clear; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = i + dz * g.size + dx;
        if (n < 0 || n >= reached.length || !reached[n]) { clear = false; break; }
      }
      if (!clear) continue;
      if (props.some((p) => p.radius > 0 && Math.hypot(p.x - x, p.z - z) < p.radius + 1.2)) continue;
      candidates.push(i);
    }
    if (candidates.length) {
      // first spawn: random candidate within 40 m of the realm centre if possible
      const mid = (G * kit.cell) / 2;
      const central = candidates.filter((i) => {
        const x = ((i % g.size) + 0.5) * g.res, z = (Math.floor(i / g.size) + 0.5) * g.res;
        return Math.hypot(x - mid, z - mid) < 40;
      });
      const pool = central.length ? central : candidates;
      const chosen: number[] = [pool[rng.int(pool.length)]];
      while (chosen.length < rules.spawnCount) {
        // pick candidate 6..14 m from the first spawn so co-op dreamers start near each other
        const f = chosen[0];
        const fx = ((f % g.size) + 0.5) * g.res, fz = (Math.floor(f / g.size) + 0.5) * g.res;
        const ring = candidates.filter((i) => {
          const x = ((i % g.size) + 0.5) * g.res, z = (Math.floor(i / g.size) + 0.5) * g.res;
          const d = Math.hypot(x - fx, z - fz);
          return d > 3 && d < 14 && !chosen.some((c) => {
            const cx2 = ((c % g.size) + 0.5) * g.res, cz2 = (Math.floor(c / g.size) + 0.5) * g.res;
            return Math.hypot(x - cx2, z - cz2) < 2.5;
          });
        });
        if (!ring.length) break;
        chosen.push(ring[rng.int(ring.length)]);
      }
      for (const i of chosen) {
        const x = ((i % g.size) + 0.5) * g.res, z = (Math.floor(i / g.size) + 0.5) * g.res;
        spawns.push({ x, y: g.height[i], z, yaw: rng.range(0, Math.PI * 2) });
      }
    }
  }

  const layout: Layout = {
    realm: kit.realm, seed, attempt, grid: G, cell: kit.cell, levelHeight: kit.levelHeight,
    variants: varTable, cells, props, spawns,
    landmark: { x: lm.x, y: heightAt(lm.x, lm.z), z: lm.z },
    quiet: { x: qp.x, y: heightAt(qp.x, qp.z), z: qp.z },
    metrics: { walkableArea: 0, linkableCount: 0, meanDistToLinkable: 0, maxDistToLinkable: 0, heightVariance: 0 },
  };
  return layout;
}

/**
 * Generate a validated layout: regenerate up to `maxAttempts` times, then throw loudly.
 */
export function generateLayout(data: RealmData, seed: number, maxAttempts = 10): GenerateResult {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const layout = generateAttempt(data, seed, attempt);
    if (!layout) { lastErrors = ['wfc contradiction']; continue; }
    const validation = validateLayout(data, layout);
    layout.metrics = validation.metrics;
    if (validation.ok) return { layout, validation, attempts: attempt + 1 };
    lastErrors = validation.errors;
  }
  throw new Error(`realm ${data.kit.realm} seed ${seed}: no valid layout after ${maxAttempts} attempts: ${lastErrors.slice(0, 5).join('; ')}`);
}

export type { Components };
export { dirIndex };
