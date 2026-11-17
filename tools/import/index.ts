/**
 * Asset import: assets/raw/<pack>/ -> assets/built/<pack>/
 *   npm run import [-- --pack <name>] [--raw <dir>] [--out <dir>] [--manifest <file>]
 *
 * 1. weld + simplify meshes to triangle budgets (props 300-3000, hero <= 8000)
 * 2. textures -> 128 px, quantised to the realm's 32-colour palette with 4x4 Bayer dither;
 *    emissive maps kept at <= 512 px
 * 3. Meshopt geometry compression, KTX2 (UASTC colour / ETC1S emissive) textures
 * 4. sidecar JSON per mesh (tags, default components)
 * 5. licence + credit appended to assets/manifest.json
 * Fails if a pack has no LICENSE or its licence is not in the allowlist.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { NodeIO, type Document, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { hexToRgb } from '../lib/color.ts';

export const LICENSE_ALLOWLIST = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'OFL-1.1', 'royalty-free-commercial'] as const;
const BUDGET = { propMin: 300, propMax: 3000, hero: 8000 };
const TEX_SIZE = 128;
const EMISSIVE_SIZE = 512;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class ImportError extends Error {}

/** Detect the licence of a pack from its LICENSE file. Throws ImportError when missing or not allowed. */
export function detectLicense(packDir: string): { id: string; text: string } {
  const file = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'License.txt'].map((f) => join(packDir, f)).find((f) => existsSync(f));
  if (!file) throw new ImportError(`pack ${basename(packDir)}: no LICENSE file`);
  const text = readFileSync(file, 'utf8');
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.\-+]+)/.exec(text)?.[1];
  const lower = text.toLowerCase();
  // reject first: NC, SA, GPL, editorial
  if (/\b(nc|noncommercial|non-commercial)\b/i.test(spdx ?? '') || /non-?commercial/.test(lower)) throw new ImportError(`pack ${basename(packDir)}: non-commercial licence rejected`);
  if (/-SA\b/.test(spdx ?? '') || /sharealike|share-alike/.test(lower)) throw new ImportError(`pack ${basename(packDir)}: share-alike licence rejected`);
  if (/gpl/i.test(spdx ?? '') || /general public license/.test(lower)) throw new ImportError(`pack ${basename(packDir)}: GPL licence rejected`);
  if (/editorial/.test(lower)) throw new ImportError(`pack ${basename(packDir)}: editorial-only licence rejected`);
  let id = spdx;
  if (!id) {
    if (/cc0|creative commons zero|public domain dedication/.test(lower)) id = 'CC0-1.0';
    else if (/attribution 4\.0|cc-by-4\.0|cc by 4\.0/.test(lower)) id = 'CC-BY-4.0';
    else if (/attribution 3\.0|cc-by-3\.0|cc by 3\.0/.test(lower)) id = 'CC-BY-3.0';
    else if (/open font license|ofl/.test(lower)) id = 'OFL-1.1';
    else if (/royalty[- ]free/.test(lower) && /commercial/.test(lower)) id = 'royalty-free-commercial';
  }
  if (!id || !(LICENSE_ALLOWLIST as readonly string[]).includes(id)) throw new ImportError(`pack ${basename(packDir)}: licence ${id ?? 'unknown'} not in allowlist`);
  return { id, text };
}

const TAG_WORDS: Record<string, string[]> = {
  light: ['lamp', 'lantern', 'light', 'candle', 'bulb', 'neon'],
  glass: ['glass', 'window', 'mirror', 'bottle', 'crystal', 'prism'],
  paper: ['paper', 'book', 'box', 'futon', 'shoji', 'card', 'poster', 'crane'],
  machine: ['tv', 'computer', 'radio', 'phone', 'washer', 'fridge', 'vending', 'clock', 'fan', 'train', 'bike'],
  water: ['bath', 'sink', 'toilet', 'shower', 'pool', 'fountain', 'water'],
  flesh: ['plant', 'flower', 'coral', 'organ', 'heart'],
  glyph: ['sign', 'letter', 'glyph', 'text'],
};
export function guessTags(name: string): string[] {
  const n = name.toLowerCase();
  return Object.entries(TAG_WORDS).filter(([, words]) => words.some((w) => n.includes(w))).map(([t]) => t);
}

function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(name);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Quantise RGBA pixels in place to the palette with a 4x4 Bayer dither. */
export function quantise(data: Uint8Array, width: number, height: number, palette: [number, number, number][], spread = 24): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * spread;
    const r = data[i] + t, g = data[i + 1] + t, b = data[i + 2] + t;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (d < bestD) { bestD = d; best = k; }
    }
    data[i] = palette[best][0]; data[i + 1] = palette[best][1]; data[i + 2] = palette[best][2];
  }
}

async function processImage(bytes: Uint8Array, size: number, palette: [number, number, number][] | null): Promise<{ png: Uint8Array; w: number; h: number }> {
  const img = sharp(bytes).ensureAlpha();
  const meta = await img.metadata();
  const target = Math.min(size, meta.width ?? size, meta.height ?? size);
  const { data, info } = await img.resize(target, target, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const px = new Uint8Array(data);
  if (palette) quantise(px, info.width, info.height, palette);
  const png = new Uint8Array(await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
  return { png, w: info.width, h: info.height };
}

async function toKtx2(png: Uint8Array, uastc: boolean): Promise<Uint8Array> {
  return encodeToKTX2(png, {
    isUASTC: uastc,
    generateMipmap: true,
    qualityLevel: 128,
    imageDecoder: async (buffer: Uint8Array) => {
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(data), width: info.width, height: info.height };
    },
  } as Parameters<typeof encodeToKTX2>[1]);
}

function triangleCount(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return Math.round(n);
}

export interface PackConfig {
  palette?: string;
  hero?: string[];
  tags?: Record<string, string[]>;
  components?: Record<string, Record<string, boolean>>;
  author?: string;
  source?: string;
}

export interface ImportSummary {
  pack: string;
  license: string;
  meshes: { name: string; trisIn: number; trisOut: number; hero: boolean }[];
  textures: { name: string; size: number }[];
}

export async function importPack(packDir: string, outRoot: string, palettes: Record<string, string[]>): Promise<ImportSummary> {
  const pack = basename(packDir);
  const license = detectLicense(packDir);
  const cfgPath = join(packDir, 'import.json');
  const cfg: PackConfig = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const palette = (palettes[cfg.palette ?? 'halo'] ?? palettes.halo).map(hexToRgb);
  const outDir = join(outRoot, pack);
  mkdirSync(outDir, { recursive: true });
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  });
  const summary: ImportSummary = { pack, license: license.id, meshes: [], textures: [] };
  const files = walk(packDir);

  for (const file of files.filter((f) => /\.(glb|gltf)$/i.test(f))) {
    const name = basename(file, extname(file));
    const doc = await io.read(file);
    const hero = (cfg.hero ?? []).some((p) => globMatch(p, name));
    const trisIn = triangleCount(doc);
    const budget = hero ? BUDGET.hero : BUDGET.propMax;
    await doc.transform(dedup(), weld());
    const afterWeld = triangleCount(doc);
    if (afterWeld > budget) {
      // simplify towards the budget, never below the prop minimum
      const ratio = Math.max(BUDGET.propMin / afterWeld, budget / afterWeld);
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.05 }));
      if (triangleCount(doc) > budget) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: ratio * 0.9, error: 0.5, lockBorder: false }));
    }
    const trisOut = triangleCount(doc);

    // textures
    const emissive = new Set<Texture>();
    for (const m of doc.getRoot().listMaterials()) { const t = m.getEmissiveTexture(); if (t) emissive.add(t); }
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img) continue;
      const isEm = emissive.has(tex);
      const { png } = await processImage(img, isEm ? EMISSIVE_SIZE : TEX_SIZE, isEm ? null : palette);
      tex.setImage(await toKtx2(png, !isEm)).setMimeType('image/ktx2');
    }
    if (doc.getRoot().listTextures().length) doc.createExtension(KHRTextureBasisu).setRequired(true);
    await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const out = join(outDir, `${name}.glb`);
    await io.write(out, doc);

    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    const tags = cfg.tags?.[name] ?? guessTags(name);
    const sidecar = {
      name, pack, source: relative(packDir, file), glb: `${name}.glb`, license: license.id,
      triangles: { in: trisIn, out: trisOut, budget }, hero,
      bounds: { min: b.min, max: b.max },
      tags,
      components: cfg.components?.[name] ?? { linkable: true, anomaly: tags.length > 0 },
    };
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(sidecar, null, 1));
    summary.meshes.push({ name, trisIn, trisOut, hero });
  }

  for (const file of files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f))) {
    const name = basename(file, extname(file));
    const isEm = /emissive|emission|glow/i.test(name);
    const { png, w } = await processImage(new Uint8Array(readFileSync(file)), isEm ? EMISSIVE_SIZE : TEX_SIZE, isEm ? null : palette);
    writeFileSync(join(outDir, `${name}.ktx2`), await toKtx2(png, !isEm));
    writeFileSync(join(outDir, `${name}.preview.png`), png);
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ name, pack, source: relative(packDir, file), ktx2: `${name}.ktx2`, size: w, license: license.id, palette: cfg.palette ?? 'halo' }, null, 1));
    summary.textures.push({ name, size: w });
  }
  return summary;
}

export interface Manifest {
  $comment: string;
  packs: { pack: string; license: string; author: string; source: string; credit: string; files: string[] }[];
}

export function appendManifest(manifestPath: string, s: ImportSummary, cfg: PackConfig): void {
  const m: Manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { $comment: 'Generated by tools/import. The in-game credits screen is built from this file.', packs: [] };
  m.packs = m.packs.filter((p) => p.pack !== s.pack);
  const author = cfg.author ?? 'unknown';
  m.packs.push({
    pack: s.pack, license: s.license, author, source: cfg.source ?? 'local',
    credit: `${s.pack} by ${author} (${s.license})`,
    files: [...s.meshes.map((x) => `${x.name}.glb`), ...s.textures.map((x) => `${x.name}.ktx2`)],
  });
  m.packs.sort((a, b) => a.pack.localeCompare(b.pack));
  writeFileSync(manifestPath, JSON.stringify(m, null, 1) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const root = resolve(import.meta.dirname, '../..');
  const rawDir = resolve(root, opt('raw', 'assets/raw'));
  const outDir = resolve(root, opt('out', 'assets/built'));
  const manifest = resolve(root, opt('manifest', 'assets/manifest.json'));
  const only = opt('pack', '');
  const palettes = JSON.parse(readFileSync(join(root, 'data/palettes.json'), 'utf8')).quadrants;
  const packs = readdirSync(rawDir).filter((d) => statSync(join(rawDir, d)).isDirectory() && (!only || d === only));
  if (!packs.length) { console.error(`no packs in ${rawDir}`); process.exit(1); }
  let failed = 0;
  for (const p of packs) {
    const dir = join(rawDir, p);
    try {
      const cfgPath = join(dir, 'import.json');
      const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
      const s = await importPack(dir, outDir, palettes);
      appendManifest(manifest, s, cfg);
      console.log(`✓ ${p} [${s.license}] meshes: ${s.meshes.map((m) => `${m.name} ${m.trisIn}→${m.trisOut}${m.hero ? ' (hero)' : ''}`).join(', ') || '-'}; textures: ${s.textures.map((t) => `${t.name} ${t.size}px`).join(', ') || '-'}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${p}: ${(e as Error).message}`);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
