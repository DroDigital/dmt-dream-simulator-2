/**
 * Compose pass (full res): picks a cell size per pixel by depth band (Bayer-dithered boundaries),
 * reads the cell history, applies living text, coverage, colour mode, backdrop, and samples the atlas.
 * Two modes are composed and mixed by `modeMix` so styles can crossfade.
 */
import * as THREE from 'three/webgpu';
import { dataMaterial } from './datamat.ts';
import * as TSLNS from 'three/tsl';
import type { GlyphUniforms } from './uniforms.ts';
import { ATLAS_COLS, ATLAS_ROWS, EDGE_ROW } from './modes/index.ts';
import { hash21, rippleMask, windOffset } from './living.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { Fn, texture, uv, vec2, vec3, vec4, float, floor, fract, max, min, clamp, mix, select, luminance, sin, uniformArray, int, smoothstep } = TSLNS as any;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);

export interface ComposeSources {
  scene: THREE.Texture;
  backdrop: THREE.Texture;
  cellsA: THREE.Texture[];
  cellsB: THREE.Texture[];
}

export function makeComposeMaterial(src: ComposeSources, g: GlyphUniforms, atlas: THREE.Texture) {
  const m = dataMaterial();
  const scene: N = texture(src.scene);
  const back: N = texture(src.backdrop);
  const A: N[] = src.cellsA.map((t) => texture(t));
  const B: N[] = src.cellsB.map((t) => texture(t));
  const H: N[] = src.cellsA.map((t) => texture(t)); // re-pointed to history each frame
  const at: N = texture(atlas);
  const bayer = uniformArray(BAYER, 'float');

  const glyphAt = (k: number, px: N) => {
    const cellPx: N = k === 0 ? g.cellSizes.x : k === 1 ? g.cellSizes.y : g.cellSizes.z;
    const cell: N = floor(px.div(cellPx));
    const cUV: N = cell.add(0.5).mul(cellPx).div(g.size);
    const local: N = fract(px.div(cellPx));
    return { cellPx, cell, cUV, local, h: H[k].sample(cUV), a: A[k].sample(cUV) };
  };

  const atlasMask = (row: N, col: N, local: N): N =>
    at.sample(vec2(col.add(local.x).div(ATLAS_COLS), row.add(float(1).sub(local.y)).div(ATLAS_ROWS))).r;

  m.colorNode = Fn(() => {
    const q: N = uv();
    const px: N = q.mul(g.size);
    // ---- depth band with dithered boundaries ----
    const mid: N = B[1].sample(q).z;
    const pxi: N = floor(px);
    const bi: N = int(pxi.y.mod(4).mul(4).add(pxi.x.mod(4)));
    const dz: N = mid.mul((bayer as N).element(bi).sub(0.5).mul(0.35).add(1));
    const band0: N = select(g.depthCells.lessThan(0.5), float(1), select(dz.lessThan(g.depthNear), float(0), select(dz.lessThan(g.depthFar), float(1), float(2))));
    const band: N = select(g.debug.greaterThan(0.5).and(g.debug.lessThan(3.5)), g.debug.sub(1), band0);
    const s0 = glyphAt(0, px), s1 = glyphAt(1, px), s2 = glyphAt(2, px);
    const pick = (a: N, b: N, c: N): N => select(band.lessThan(0.5), a, select(band.lessThan(1.5), b, c));
    const h: N = pick(s0.h, s1.h, s2.h);
    const ac: N = pick(s0.a, s1.a, s2.a);
    const cell: N = pick(s0.cell, s1.cell, s2.cell);
    const cUV: N = pick(s0.cUV, s1.cUV, s2.cUV);
    const local: N = pick(s0.local, s1.local, s2.local);
    const cellPx: N = pick(s0.cellPx, s1.cellPx, s2.cellPx);
    const heldL: N = h.x;
    const edgeCode: N = h.y.toVar();
    // edge thickness 2: borrow a neighbour's edge
    const nb: N = H[1].sample(cUV.add(vec2(cellPx, 0).div(g.size))).y;
    edgeCode.assign(select(edgeCode.lessThan(0.5).and(g.edgeThickness.greaterThan(1.5)), nb, edgeCode));

    // ---- living text ----
    const scramble: N = rippleMask(cUV, cellPx, g);
    const wind: N = windOffset(cell, g);
    const centre: N = q.sub(0.5).mul(vec2(g.aspect, 1)).length().lessThan(g.settleRadius);
    const settleK: N = select(centre, g.settle.mul(g.gazeOn), float(0));
    const lc: N = clamp(heldL.sub(0.5).mul(settleK.mul(0.6).add(1)).add(0.5), 0, 0.999);

    const glyphIdx = (n: N): N => {
      const base: N = floor(lc.mul(n));
      const lifted: N = select(g.shadowLift.greaterThan(0.5).and(lc.greaterThan(0.02)), max(base, 1), base);
      const windy: N = clamp(lifted.add(wind), 0, n.sub(1));
      const scr: N = floor(hash21(cell.add(floor(g.time.mul(20)))).mul(n));
      return select(scramble.greaterThan(0.5), scr, windy);
    };
    const edgeOn: N = edgeCode.greaterThan(0.5).and(scramble.lessThan(0.5));
    const maskFor = (row: N, n: N): N => select(edgeOn, atlasMask(float(EDGE_ROW), edgeCode.sub(1), local), atlasMask(row, glyphIdx(n), local));
    const maskA: N = maskFor(g.row, g.rampN);
    const maskB: N = maskFor(g.rowB, g.rampNB);
    const maskM: N = mix(maskA, maskB, g.modeMix).toVar();

    // ---- drifting letters in the far sky ----
    const sky: N = h.y.lessThan(0.5).and(B[1].sample(q).z.greaterThan(g.depthFar.mul(3)));
    const colN: N = floor(px.x.div(g.cellSizes.y));
    const speed: N = hash21(vec2(colN, 7)).mul(0.6).add(0.3);
    const fall: N = floor(px.y.div(g.cellSizes.y).add(g.time.mul(speed).mul(2)));
    const letterOn: N = sky.and(hash21(vec2(colN, fall)).lessThan(g.drift.mul(0.05)));
    const letterMask: N = atlasMask(float(0), floor(hash21(vec2(fall, colN)).mul(6).add(4)), fract(px.div(g.cellSizes.y)));
    maskM.assign(select(letterOn, max(maskM, letterMask), maskM));

    // ---- coverage ----
    const covered: N = hash21(cell).lessThan(g.coverage);
    const mask: N = select(covered.or(letterOn), maskM, float(0)).mul(g.opacity);

    // ---- colour modes ----
    const cc: N = ac.xyz;
    const sat: N = mix(vec3(luminance(cc)), cc, g.colourSaturation);
    const full: N = sat.mul(g.colourBoost);
    const mono: N = g.colA.mul(lc.mul(0.8).add(0.2)).mul(g.colourBoost);
    const duo: N = mix(g.colB, g.colA, lc).mul(g.colourBoost.mul(0.8));
    const pal: N = cc.mul(g.colourBoost);
    const phos: N = g.phosphorCol.mul(lc.mul(1.2).add(0.15));
    const cm: N = g.colourMode;
    const glyphCol: N = select(cm.lessThan(0.5), full, select(cm.lessThan(1.5), mono, select(cm.lessThan(2.5), duo, select(cm.lessThan(3.5), pal, phos))));
    const glyphColL: N = select(letterOn, vec3(1.0, 0.95, 0.8), glyphCol);

    // ---- backdrop ----
    const bm: N = g.backdropMode;
    const blurred: N = back.sample(q).rgb;
    const original: N = scene.sample(q).rgb;
    const backdrop: N = select(bm.lessThan(0.5), blurred, select(bm.lessThan(1.5), vec3(0), select(bm.lessThan(2.5), original, vec3(0)))).mul(g.backdropStrength);
    const glow: N = select(cm.greaterThan(3.5), g.phosphorCol.mul(0.06), vec3(0));
    let out: N = mix(backdrop.add(glow), glyphColL, clamp(mask, 0, 1));
    // scanlines (tv-static)
    out = out.mul(float(1).sub(g.scanlines.mul(0.45).mul(sin(px.y.mul(Math.PI)).mul(0.5).add(0.5))));
    const alpha: N = select(bm.greaterThan(2.5), clamp(mask, 0, 1), float(1));
    void min; void smoothstep;
    const dbg: N = select(g.debug.greaterThan(4.5), vec3(heldL), ac.xyz);
    return select(g.debug.greaterThan(3.5), vec4(dbg, 1), vec4(out, alpha));
  })();
  return { material: m, history: H };
}
