import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAttempt, generateLayout, validateLayout } from '../../src/realms/layoutgen.ts';
import type { RealmData } from '../../src/realms/types.ts';

const load = (r: string): RealmData => {
  const d = join(import.meta.dirname, '../../src/realms', r);
  const j = (f: string) => JSON.parse(readFileSync(join(d, f), 'utf8'));
  return { kit: j('kit.json'), rules: j('rules.json'), fixed: j('fixed.json') };
};

describe('realm layout generator', () => {
  for (const realm of ['evening-suburb', 'prism-cathedral', 'glyph-desert']) {
    it(`${realm}: generates valid deterministic layouts`, () => {
      const data = load(realm);
      const a = generateLayout(data, 42).layout;
      const b = generateLayout(data, 42).layout;
      expect(a.cells).toEqual(b.cells);
      expect(a.props.length).toBe(b.props.length);
      expect(validateLayout(data, a).ok).toBe(true);
      const c = generateLayout(data, 43).layout;
      expect(c.cells).not.toEqual(a.cells);
    });
  }

  it('validator rejects a known-bad layout (walled-in spawn, no carryables)', () => {
    const data = load('evening-suburb');
    const good = generateLayout(data, 7).layout;
    expect(validateLayout(data, good).ok).toBe(true);
    const bad = structuredClone(good);
    // remove carryables, drop a spawn onto a house, move another onto a solid prop
    bad.props = bad.props.filter((p) => !p.components.carryable);
    const houseVariant = bad.variants.findIndex((v) => v.id === 'house-a');
    const s = bad.spawns[1];
    const cx = Math.floor(s.x / bad.cell), cz = Math.floor(s.z / bad.cell);
    bad.cells[cz * bad.grid + cx] = houseVariant;
    s.x = (cx + 0.5) * bad.cell; s.z = (cz + 0.5) * bad.cell;
    const res = validateLayout(data, bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('carryables'))).toBe(true);
    expect(res.errors.some((e) => e.includes('spawn 1'))).toBe(true);
  });

  it('validator rejects a layout with too few linkables', () => {
    const data = load('glyph-desert');
    const good = generateLayout(data, 9).layout;
    const bad = structuredClone(good);
    bad.props = bad.props.filter((p) => !p.components.linkable || p.id === 'great-tablet');
    const sand = bad.variants.findIndex((v) => v.id === 'sand');
    bad.cells = bad.cells.map((c) => (['monolith', 'ruin', 'high-dune'].includes(bad.variants[c].id) ? sand : c));
    const res = validateLayout(data, bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('linkables'))).toBe(true);
  });

  it('attempts are seeded by (seed, attempt)', () => {
    const data = load('prism-cathedral');
    const a = generateAttempt(data, 5, 0)!, b = generateAttempt(data, 5, 1)!;
    expect(a.cells).not.toEqual(b.cells);
  });
});
