/**
 * Writes a small CC0 test pack into assets/raw/ (procedural furniture GLBs + a paper texture),
 * standing in for the Kenney Furniture Kit + a Poly Haven texture when those can't be downloaded.
 * Drop real packs into assets/raw/<pack>/ with their LICENSE file and `npm run import` treats them the same.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { PCG32 } from '../../src/core/rng.ts';

const root = resolve(import.meta.dirname, '../..');
const io = new NodeIO();

type Tri = number[];
function box(out: { p: number[]; n: number[]; uv: number[] }, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, seg = 1) {
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const quad: Tri[] = [];
      for (const [a, b] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]) {
        const s = a / seg - 0.5, t = b / seg - 0.5;
        quad.push([
          cx + (n[0] * 0.5 + u[0] * s + v[0] * t) * sx,
          cy + (n[1] * 0.5 + u[1] * s + v[1] * t) * sy,
          cz + (n[2] * 0.5 + u[2] * s + v[2] * t) * sz,
          a / seg, b / seg,
        ]);
      }
      for (const k of [0, 1, 2, 0, 2, 3]) {
        out.p.push(quad[k][0], quad[k][1], quad[k][2]);
        out.n.push(n[0], n[1], n[2]);
        out.uv.push(quad[k][3], quad[k][4]);
      }
    }
  }
}
function sphere(out: { p: number[]; n: number[]; uv: number[] }, cx: number, cy: number, cz: number, r: number, w: number, h: number) {
  const pt = (i: number, j: number) => {
    const th = (i / w) * Math.PI * 2, ph = (j / h) * Math.PI;
    const n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    return { p: [cx + n[0] * r, cy + n[1] * r, cz + n[2] * r], n, uv: [i / w, j / h] };
  };
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
    for (const k of [0, 2, 1, 0, 3, 2]) { out.p.push(...q[k].p); out.n.push(...q[k].n); out.uv.push(...q[k].uv); }
  }
}

async function texturePng(size: number, seed: number, kind: 'paper' | 'wood' | 'glow'): Promise<Uint8Array> {
  const rng = new PCG32(seed);
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const n = rng.next();
    let r: number, g: number, b: number;
    if (kind === 'paper') { const f = 225 + n * 25 - (Math.sin(x * 0.7 + y * 0.05) > 0.97 ? 30 : 0); r = f; g = f - 6; b = f - 18; }
    else if (kind === 'wood') { const s = Math.sin(y * 0.15 + Math.sin(x * 0.05) * 3) * 0.5 + 0.5; r = 120 + s * 60 + n * 20; g = 70 + s * 40 + n * 10; b = 40 + s * 20; }
    else { const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2); const v = Math.max(0, 1 - d) * 255; r = v; g = v * 0.8; b = v * 0.4; }
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return new Uint8Array(await sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
}

async function mesh(name: string, build: (o: { p: number[]; n: number[]; uv: number[] }) => void, opts: { tex?: Uint8Array; emissive?: Uint8Array; color: [number, number, number] }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const o = { p: [] as number[], n: [] as number[], uv: [] as number[] };
  build(o);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(o.p)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(o.n)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(o.uv)).setBuffer(buffer));
  const mat = doc.createMaterial(name).setBaseColorFactor([...opts.color, 1]).setRoughnessFactor(0.9);
  if (opts.tex) mat.setBaseColorTexture(doc.createTexture(name + '-albedo').setImage(opts.tex).setMimeType('image/png'));
  if (opts.emissive) mat.setEmissiveTexture(doc.createTexture(name + '-emissive').setImage(opts.emissive).setMimeType('image/png')).setEmissiveFactor([1, 1, 1]);
  prim.setMaterial(mat);
  doc.createScene().addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return io.writeBinary(doc);
}

const furniture = join(root, 'assets/raw/test-furniture-kit');
const paper = join(root, 'assets/raw/test-paper-texture');
mkdirSync(furniture, { recursive: true });
mkdirSync(paper, { recursive: true });
const CC0 = 'SPDX-License-Identifier: CC0-1.0\n\nCreative Commons Zero v1.0 Universal. Generated procedurally for DMT: Dream Simulator tests.\nAuthor: DMT tools (procedural)\n';
writeFileSync(join(furniture, 'LICENSE'), CC0);
writeFileSync(join(paper, 'LICENSE'), CC0);

const wood = await texturePng(512, 1, 'wood');
writeFileSync(join(furniture, 'table.glb'), await mesh('table', (o) => {
  box(o, 0, 0.72, 0, 1.4, 0.06, 0.8, 4);
  for (const [x, z] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) box(o, x, 0.36, z, 0.06, 0.72, 0.06, 2);
}, { tex: wood, color: [1, 1, 1] }));
writeFileSync(join(furniture, 'chair.glb'), await mesh('chair', (o) => {
  box(o, 0, 0.45, 0, 0.45, 0.05, 0.45, 6); box(o, 0, 0.85, -0.2, 0.45, 0.75, 0.05, 6);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(o, x, 0.22, z, 0.04, 0.45, 0.04, 3);
}, { tex: wood, color: [0.9, 0.85, 0.8] }));
writeFileSync(join(furniture, 'paper-lantern.glb'), await mesh('paper-lantern', (o) => sphere(o, 0, 0.3, 0, 0.3, 48, 32), { tex: await texturePng(256, 2, 'paper'), emissive: await texturePng(1024, 3, 'glow'), color: [1, 0.9, 0.8] }));
writeFileSync(join(furniture, 'futon.glb'), await mesh('futon', (o) => { box(o, 0, 0.08, 0, 1.0, 0.16, 2.0, 10); box(o, 0, 0.2, -0.8, 0.6, 0.1, 0.3, 6); }, { color: [0.85, 0.82, 0.9] }));
writeFileSync(join(furniture, 'hero-globe.glb'), await mesh('hero-globe', (o) => { sphere(o, 0, 1, 0, 1, 128, 80); box(o, 0, 0.05, 0, 0.6, 0.1, 0.6, 2); }, { color: [0.4, 0.6, 0.9] }));
writeFileSync(join(furniture, 'import.json'), JSON.stringify({ palette: 'halo', hero: ['hero-*'], tags: { 'paper-lantern': ['light', 'paper'], futon: ['paper'] } }, null, 1));
writeFileSync(join(paper, 'paper-fibre.png'), await texturePng(1024, 7, 'paper'));
writeFileSync(join(paper, 'import.json'), JSON.stringify({ palette: 'halo' }, null, 1));
console.log('test pack written to assets/raw/test-furniture-kit and assets/raw/test-paper-texture');
