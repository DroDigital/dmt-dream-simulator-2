/** npm run validate-data: validates data/*.json, data/glyph-styles/*.json and realm kits against data/schemas. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import Ajv from 'ajv';

const root = resolve(import.meta.dirname, '../..');
const schemaDir = join(root, 'data/schemas');

export function validateAll(): { file: string; ok: boolean; errors: string[] }[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schemas = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'))) {
    schemas.set(f.replace('.schema.json', ''), ajv.compile(JSON.parse(readFileSync(join(schemaDir, f), 'utf8'))));
  }
  const jobs: { file: string; schema: string }[] = [];
  for (const f of readdirSync(join(root, 'data')).filter((f) => f.endsWith('.json'))) jobs.push({ file: join(root, 'data', f), schema: basename(f, '.json') });
  const gs = join(root, 'data/glyph-styles');
  if (existsSync(gs)) for (const f of readdirSync(gs).filter((f) => f.endsWith('.json'))) jobs.push({ file: join(gs, f), schema: 'glyph-style' });
  const realms = join(root, 'src/realms');
  for (const d of readdirSync(realms, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const k of ['kit', 'rules', 'fixed']) {
      const f = join(realms, d.name, `${k}.json`);
      if (existsSync(f)) jobs.push({ file: f, schema: k });
    }
  }
  const results: { file: string; ok: boolean; errors: string[] }[] = [];
  for (const j of jobs) {
    const v = schemas.get(j.schema);
    const rel = j.file.slice(root.length + 1);
    if (!v) { results.push({ file: rel, ok: false, errors: [`no schema ${j.schema}.schema.json`] }); continue; }
    let data: unknown;
    try { data = JSON.parse(readFileSync(j.file, 'utf8')); } catch (e) { results.push({ file: rel, ok: false, errors: [(e as Error).message] }); continue; }
    const ok = v(data) as boolean;
    const errors = ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
    // cross-checks
    if (ok && j.schema === 'kit') {
      const kit = data as { tiles: { id: string }[]; props: { on: string[]; id: string }[] };
      const ids = new Set(kit.tiles.map((t) => t.id));
      for (const p of kit.props) for (const t of p.on) if (!ids.has(t)) errors.push(`prop ${p.id} references unknown tile ${t}`);
    }
    results.push({ file: rel, ok: errors.length === 0, errors });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = validateAll();
  for (const r of res) console.log(`${r.ok ? '✓' : '✗'} ${r.file}${r.ok ? '' : '\n    ' + r.errors.join('\n    ')}`);
  const bad = res.filter((r) => !r.ok).length;
  console.log(`${res.length - bad}/${res.length} data files valid`);
  if (bad) process.exit(1);
}
