import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, PRESETS, blendStyles, cellCovered, coverageHash, edgeBin, gentleStyle, lucidStyle, remapBrightness } from '../../src/render/glyph/styles.ts';

describe('glyph suite math', () => {
  it('brightness remap: clamps, applies gamma and an S-curve, inverts', () => {
    const s = { black: 0.1, white: 0.9, gamma: 1, contrast: 0, invert: false };
    expect(remapBrightness(0.05, s)).toBe(0);
    expect(remapBrightness(0.95, s)).toBe(1);
    expect(remapBrightness(0.5, s)).toBeCloseTo(0.5);
    const c = { ...s, contrast: 1 };
    expect(remapBrightness(0.7, c)).toBeGreaterThan(remapBrightness(0.7, s)); // S-curve pushes highs up
    expect(remapBrightness(0.3, c)).toBeLessThan(remapBrightness(0.3, s));
    expect(remapBrightness(0.3, { ...s, invert: true })).toBeCloseTo(1 - remapBrightness(0.3, s));
    expect(remapBrightness(0.5, { ...s, gamma: 2 })).toBeCloseTo(0.25);
  });
  it('coverage hash is stable per cell and respects the coverage share', () => {
    expect(coverageHash(12, 34)).toBe(coverageHash(12, 34));
    let on = 0;
    for (let x = 0; x < 100; x++) for (let y = 0; y < 100; y++) if (cellCovered(x, y, 0.3)) on++;
    expect(on / 10000).toBeGreaterThan(0.25);
    expect(on / 10000).toBeLessThan(0.35);
    for (let x = 0; x < 50; x++) expect(cellCovered(x, 7, 1)).toBe(true);
  });
  it('edge direction quantisation: gradient -> edge glyph bin', () => {
    expect(edgeBin(1, 0)).toBe(2);   // horizontal gradient -> vertical edge |
    expect(edgeBin(0, 1)).toBe(0);   // vertical gradient -> horizontal edge _
    expect(edgeBin(-1, 1)).toBe(1);  // gradient up-left -> edge rising /
    expect(edgeBin(1, 1)).toBe(3);   // gradient up-right -> edge falling \
    expect(edgeBin(-1, 0)).toBe(2);  // sign does not matter
  });
  it('blendStyles interpolates numbers and switches discrete fields at 0.5', () => {
    const a = { ...DEFAULT_STYLE, cellPx: 8, coverage: 1, mode: 'ascii' as const };
    const b = { ...DEFAULT_STYLE, cellPx: 12, coverage: 0, mode: 'blocks' as const };
    const m = blendStyles(a, b, 0.25);
    expect(m.cellPx).toBeCloseTo(9);
    expect(m.coverage).toBeCloseTo(0.75);
    expect(m.mode).toBe('ascii');
    expect(blendStyles(a, b, 0.75).mode).toBe('blocks');
    expect(blendStyles(a, b, 1).cellPx).toBe(12);
  });
  it('lucidity calms and gentle mode softens', () => {
    const l = lucidStyle(DEFAULT_STYLE, 3);
    expect(l.cellPx).toBe(DEFAULT_STYLE.cellPx - 3);
    expect(l.hysteresis).toBeCloseTo(DEFAULT_STYLE.hysteresis * 1.5);
    const g = gentleStyle({ ...DEFAULT_STYLE, ripples: true, wind: { speed: 1, dir: [1, 0] }, paper: { aberration: 0.9, flutedGlass: 0 } });
    expect(g.ripples).toBe(false);
    expect(g.wind!.speed).toBe(0.5);
    expect(g.paper.aberration).toBe(0.3);
  });
  it('ships at least 16 presets including the named ones', () => {
    const ids = Object.keys(PRESETS);
    expect(ids.length).toBeGreaterThanOrEqual(16);
    for (const id of ['desert-day', 'desert-night', 'tv-static', 'journal-print']) expect(ids).toContain(id);
    expect(ids.filter((x) => x.startsWith('glyph-night-')).length).toBe(8);
    expect(ids.filter((x) => x.startsWith('photo-')).length).toBeGreaterThan(0);
  });
});
