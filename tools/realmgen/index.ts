/**
 * npm run realmgen -- --realm evening-suburb --count 100 [--seed 1] [--out tools/realmgen/out]
 * Generates layouts with the same code the game runs in its Web Worker, validates every one,
 * and writes layout JSON + a metrics summary.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateLayout } from '../../src/realms/layoutgen.ts';
import type { RealmData } from '../../src/realms/types.ts';
import { hash } from '../../src/core/rng.ts';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const root = resolve(import.meta.dirname, '../..');
const realmsDir = join(root, 'src/realms');
const realmArg = opt('realm', 'all');
const count = Number(opt('count', '10'));
const baseSeed = Number(opt('seed', '1'));
const outDir = resolve(root, opt('out', 'tools/realmgen/out'));
const writeLayouts = !args.includes('--metrics-only');

function loadRealm(name: string): RealmData {
  const read = (f: string) => JSON.parse(readFileSync(join(realmsDir, name, f), 'utf8'));
  return { kit: read('kit.json'), rules: read('rules.json'), fixed: read('fixed.json') };
}

const realms = realmArg === 'all'
  ? readdirSync(realmsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(realmsDir, d.name, 'kit.json'))).map((d) => d.name)
  : realmArg.split(',');

let failed = 0;
for (const realm of realms) {
  const data = loadRealm(realm);
  const dir = join(outDir, realm);
  mkdirSync(dir, { recursive: true });
  const rows: Record<string, number>[] = [];
  const t0 = performance.now();
  let totalAttempts = 0;
  for (let i = 0; i < count; i++) {
    const seed = hash(baseSeed, i);
    try {
      const { layout, attempts } = generateLayout(data, seed);
      totalAttempts += attempts;
      rows.push({ seed, attempts, ...layout.metrics });
      if (writeLayouts) writeFileSync(join(dir, `layout-${i}.json`), JSON.stringify(layout));
    } catch (e) {
      failed++;
      console.error(`FAIL ${(e as Error).message}`);
    }
  }
  const ms = performance.now() - t0;
  const stat = (k: string) => {
    const v = rows.map((r) => r[k]);
    const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length));
    return { mean: +mean.toFixed(2), sd: +sd.toFixed(2), cv: +(mean ? sd / mean : 0).toFixed(3), min: +Math.min(...v).toFixed(2), max: +Math.max(...v).toFixed(2) };
  };
  const summary = {
    realm, count, passed: rows.length, failed: count - rows.length, msPerLayout: +(ms / count).toFixed(1),
    meanAttempts: +(totalAttempts / Math.max(1, rows.length)).toFixed(2),
    walkableArea: stat('walkableArea'), linkableCount: stat('linkableCount'),
    meanDistToLinkable: stat('meanDistToLinkable'), maxDistToLinkable: stat('maxDistToLinkable'), heightVariance: stat('heightVariance'),
  };
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify({ summary, layouts: rows }, null, 1));
  console.log(`${realm}: ${summary.passed}/${count} valid, ${summary.msPerLayout} ms/layout, attempts ${summary.meanAttempts}, ` +
    `walkable ${summary.walkableArea.mean} m² (CV ${(summary.walkableArea.cv * 100).toFixed(1)}%), ` +
    `linkables ${summary.linkableCount.mean}, mean dist ${summary.meanDistToLinkable.mean} m, max dist ${summary.maxDistToLinkable.max} m`);
}
if (failed) {
  console.error(`${failed} layouts failed validation`);
  process.exit(1);
}
