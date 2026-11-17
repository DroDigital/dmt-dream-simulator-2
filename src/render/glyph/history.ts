/**
 * Per-cell history (§3.5): ping-pong render targets (also used on WebGPU; the storage-texture variant is
 * a drop-in later). Stores the held brightness + edge code, a hold counter and a flip counter.
 * A cell changes glyph only when |l - lastL| > hysteresis or the new choice persisted for holdFrames.
 * Photosensitivity (§6): a leaky bucket refuses a 4th dark<->bright flip within one second.
 */
import * as THREE from 'three/webgpu';
import { dataMaterial } from './datamat.ts';
import * as TSLNS from 'three/tsl';
import type { GlyphUniforms } from './uniforms.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { Fn, texture, uv, vec2, vec4, float, max, min, abs, floor, clamp, pow, select, length } = TSLNS as any;

/** Shader version of styles.remapBrightness. */
export const remapNode = (l: N, g: GlyphUniforms): N => {
  const x0: N = clamp(l.sub(g.black).div(max(g.white.sub(g.black), 1e-4)), 0, 1);
  const x1: N = pow(x0, g.gamma);
  const k: N = g.contrast.mul(3).add(1);
  const a: N = pow(x1, k), b: N = pow(float(1).sub(x1), k);
  const s: N = a.div(max(a.add(b), 1e-6));
  return select(g.invert.greaterThan(0.5), float(1).sub(s), s);
};

export function makeHistoryMaterial(cellsA: THREE.Texture, cellsB: THREE.Texture, g: GlyphUniforms) {
  const m = dataMaterial();
  const A: N = texture(cellsA), B: N = texture(cellsB);
  const prevTex: N = texture(cellsA); // re-pointed at the previous history target every frame
  m.colorNode = Fn(() => {
    const q: N = uv();
    const a: N = A.sample(q), b: N = B.sample(q);
    const l: N = remapNode(a.w, g);
    const prev: N = prevTex.sample(q);
    // edge hysteresis: enter above the threshold, leave below 70% of it; ignore one-bin direction wobble
    const wasEdge: N = prev.y.greaterThan(0.5);
    const leave: N = max(float(1).sub(g.hysteresis.mul(5)), 0.5);
    const on: N = select(wasEdge, b.x.greaterThan(g.edgeThreshold.mul(leave)), b.x.greaterThan(g.edgeThreshold));
    const bd: N = abs(b.y.add(1).sub(prev.y));
    const wobble: N = wasEdge.and(g.hysteresis.greaterThan(0)).and(bd.equal(1).or(bd.equal(3)));
    const edge: N = select(on, select(wobble, prev.y, b.y.add(1)), float(0));
    const heldL: N = prev.x, prevEdge: N = prev.y, hold: N = prev.z, flips: N = prev.w;
    const n: N = g.rampN;
    const heldIdx: N = floor(heldL.mul(n));
    // gaze settle: cells near the centre are calmer (hysteresis x2)
    const centre: N = length(q.sub(0.5).mul(vec2(g.aspect, 1))).lessThan(g.settleRadius);
    const hyst: N = g.hysteresis.mul(select(centre, g.settle.mul(g.gazeOn).add(1), float(1)));
    // Schmitt band: stay on the held glyph while l is within its bin widened by half the hysteresis
    const m: N = hyst;
    const inBand: N = l.greaterThan(heldIdx.div(n).sub(m)).and(l.lessThan(heldIdx.add(1).div(n).add(m)));
    const idx: N = select(inBand, heldIdx, floor(l.mul(n)));
    const cand: N = idx.add(edge.mul(16));
    const heldCode: N = heldIdx.add(prevEdge.mul(16));
    const changed: N = cand.notEqual(heldCode);
    // z packs the pending candidate and how many consecutive frames it has persisted: cand * 16 + count
    const pendCand: N = floor(hold.div(16));
    const pendCount: N = hold.sub(pendCand.mul(16));
    const count: N = select(changed, select(pendCand.equal(cand), min(pendCount.add(1), 15), float(1)), float(0));
    const big: N = abs(l.sub(heldL)).greaterThan(hyst);
    const flip: N = heldL.lessThan(0.25).and(l.greaterThan(0.75)).or(heldL.greaterThan(0.75).and(l.lessThan(0.25)));
    const accept0: N = changed.and(big.or(count.greaterThanEqual(g.holdFrames)));
    const accept: N = accept0.and(flip.and(flips.greaterThan(2.0)).not());
    const flips2: N = max(flips.sub(g.dt.mul(3)), 0).add(select(accept.and(flip), float(1), float(0)));
    const keep: N = vec4(heldL, prevEdge, select(changed, cand.mul(16).add(count), float(0)), flips2);
    const take: N = vec4(l, edge, 0, flips2);
    const fresh: N = vec4(l, edge, 0, 0);
    return select(g.reset.greaterThan(0.5), fresh, select(accept, take, keep));
  })();
  return { material: m, prev: prevTex };
}
