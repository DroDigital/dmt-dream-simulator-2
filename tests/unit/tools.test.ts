import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectLicense, ImportError, quantise, guessTags } from '../../tools/import/index.ts';
import { validateAll } from '../../tools/validate-data/index.ts';

const pack = (lic: string | null) => {
  const d = mkdtempSync(join(tmpdir(), 'pack-'));
  const p = join(d, 'p');
  mkdirSync(p);
  if (lic !== null) writeFileSync(join(p, 'LICENSE'), lic);
  return p;
};

describe('import licence gate', () => {
  it('accepts allowlisted licences', () => {
    expect(detectLicense(pack('SPDX-License-Identifier: CC0-1.0')).id).toBe('CC0-1.0');
    expect(detectLicense(pack('Creative Commons Attribution 4.0 International')).id).toBe('CC-BY-4.0');
    expect(detectLicense(pack('SIL Open Font License, Version 1.1')).id).toBe('OFL-1.1');
  });
  it('rejects missing, NC, SA, GPL and editorial', () => {
    expect(() => detectLicense(pack(null))).toThrow(ImportError);
    expect(() => detectLicense(pack('SPDX-License-Identifier: CC-BY-NC-4.0'))).toThrow(/non-commercial/);
    expect(() => detectLicense(pack('Attribution-ShareAlike 4.0'))).toThrow(/share-alike/);
    expect(() => detectLicense(pack('SPDX-License-Identifier: GPL-3.0'))).toThrow(/GPL/);
    expect(() => detectLicense(pack('For editorial use only'))).toThrow(/editorial/);
    expect(() => detectLicense(pack('All rights reserved'))).toThrow(/allowlist/);
  });
  it('quantises to palette colours only', () => {
    const px = new Uint8Array(16 * 16 * 4).map((_, i) => (i * 37) & 255);
    const pal: [number, number, number][] = [[10, 10, 10], [200, 100, 50], [240, 240, 230]];
    quantise(px, 16, 16, pal);
    for (let i = 0; i < px.length; i += 4) expect(pal.some((p) => p[0] === px[i] && p[1] === px[i + 1] && p[2] === px[i + 2])).toBe(true);
  });
  it('guesses tags from names', () => {
    expect(guessTags('floor-lamp')).toContain('light');
    expect(guessTags('bathtub')).toContain('water');
  });
});

describe('data schemas', () => {
  it('all data files validate', () => {
    const res = validateAll();
    const bad = res.filter((r) => !r.ok);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
});
