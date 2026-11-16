/**
 * Cells pass (§3.1, §3.5): runs at cell resolution. Output A = average cell colour (3x3 pre-blurred) + brightness.
 * Output B = edge strength, quantised edge direction bin, linear depth.
 * Edges: Sobel on linear depth and on normals from the scene MRT, plus a difference-of-Gaussians on luminance.
 */
import * as THREE from 'three/webgpu';
import { dataMaterial } from './datamat.ts';
import * as TSLNS from 'three/tsl';
import type { GlyphUniforms } from './uniforms.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { Fn, texture, uv, vec2, vec3, vec4, float, max, abs, atan, floor, mod, luminance, perspectiveDepthToViewZ, dot, If, Loop, select, mix } = TSLNS as any;

export interface CellSources { colour: THREE.Texture; depth: THREE.Texture; normal: THREE.Texture; palette: N }

export function makeCellsColourMaterial(src: CellSources, g: GlyphUniforms, sizeIndex: number): THREE.MeshBasicNodeMaterial {
  const m = dataMaterial();
  const col: N = texture(src.colour);
  m.colorNode = Fn(() => {
    const cellPx: N = sizeIndex === 0 ? g.cellSizes.x : sizeIndex === 1 ? g.cellSizes.y : g.cellSizes.z;
    const du: N = vec2(cellPx).div(g.size);
    const acc: N = vec3(0).toVar();
    for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) acc.addAssign(col.sample(uv().add(du.mul(vec2(ox, oy)).mul(0.33))).rgb);
    const c: N = acc.div(9).toVar();
    // palette colour mode snaps the cell colour to the realm's 32 colours here (once per cell)
    If(g.colourMode.equal(3), () => {
      const best: N = vec3(0).toVar();
      const bestD: N = float(1e9).toVar();
      Loop(32, ({ i }: { i: N }) => {
        const p: N = src.palette.element(i);
        const e: N = c.sub(p);
        const d: N = dot(e.mul(e), vec3(0.3, 0.59, 0.11));
        If(d.lessThan(bestD), () => { bestD.assign(d); best.assign(p); });
      });
      c.assign(best);
    });
    return vec4(c, luminance(c));
  })();
  return m;
}

export function makeCellsEdgeMaterial(src: CellSources, g: GlyphUniforms, sizeIndex: number): THREE.MeshBasicNodeMaterial {
  const m = dataMaterial();
  const col: N = texture(src.colour);
  const dep: N = texture(src.depth);
  const nor: N = texture(src.normal);
  m.colorNode = Fn(() => {
    const cellPx: N = sizeIndex === 0 ? g.cellSizes.x : sizeIndex === 1 ? g.cellSizes.y : g.cellSizes.z;
    const du: N = vec2(cellPx).div(g.size).mul(0.5);
    const lin = (q: N): N => perspectiveDepthToViewZ(dep.sample(q).x, g.camNear, g.camFar).negate();
    const nrm = (q: N): N => nor.sample(q).xyz.mul(2).sub(1);
    const lum = (q: N): N => luminance(col.sample(q).rgb);
    const c: N = uv();
    const o = (x: number, y: number): N => c.add(du.mul(vec2(x, y)));
    // depth edges: Laplacian of inverse depth (screen-linear on planes, so slanted floors do not fire);
    // direction from the Sobel gradient of inverse depth
    const w = (x: number, y: number): N => float(1).div(max(lin(o(x, y)), 0.01));
    const zc: N = max(lin(c), 0.01);
    const wc: N = float(1).div(zc);
    const W2 = (x: number, y: number): N => float(1).div(max(lin(c.add(du.mul(vec2(x, y)).mul(2))), 0.01));
    // keep the near-surface side only (negative Laplacian): the silhouette belongs to the closer object
    const lap: N = max(wc.mul(4).sub(W2(1, 0).add(W2(-1, 0)).add(W2(0, 1)).add(W2(0, -1))), 0).div(wc);
    const gxd: N = W2(1, -1).add(W2(1, 0).mul(2)).add(W2(1, 1)).sub(W2(-1, -1).add(W2(-1, 0).mul(2)).add(W2(-1, 1)));
    const gyd: N = W2(-1, 1).add(W2(0, 1).mul(2)).add(W2(1, 1)).sub(W2(-1, -1).add(W2(0, -1).mul(2)).add(W2(1, -1)));
    const depthE: N = lap.mul(1.2);
    // normals: magnitude of normal change across the cell
    const normalE: N = nrm(o(1, 0)).sub(nrm(o(-1, 0))).length().add(nrm(o(0, 1)).sub(nrm(o(0, -1))).length()).mul(0.5);
    // luminance Sobel (direction) + difference of Gaussians (strength)
    const l: N = (x: number, y: number) => lum(o(x, y));
    const gxl: N = l(1, -1).add(l(1, 0).mul(2)).add(l(1, 1)).sub(l(-1, -1).add(l(-1, 0).mul(2)).add(l(-1, 1)));
    const gyl: N = l(-1, 1).add(l(0, 1).mul(2)).add(l(1, 1)).sub(l(-1, -1).add(l(0, -1).mul(2)).add(l(1, -1)));
    const small: N = l(0, 0).mul(0.5).add(l(1, 0).add(l(-1, 0)).add(l(0, 1)).add(l(0, -1)).mul(0.125));
    const large: N = lum(c.add(du.mul(vec2(2.2, 0)))).add(lum(c.add(du.mul(vec2(-2.2, 0))))).add(lum(c.add(du.mul(vec2(0, 2.2))))).add(lum(c.add(du.mul(vec2(0, -2.2))))).mul(0.25);
    const dog: N = abs(small.sub(large)).mul(4);
    const dE: N = depthE.mul(g.edgeDepthWeight), nE: N = normalE.mul(g.edgeNormalWeight), lE: N = dog.mul(g.edgeLumaWeight);
    const strength: N = max(dE, max(nE, lE));
    const useDepth: N = dE.greaterThanEqual(max(nE, lE)).and(vec2(gxd, gyd).length().greaterThan(1e-4));
    const gx: N = select(useDepth, gxd, gxl), gy: N = select(useDepth, gyd, gyl);
    // edge direction = gradient + 90 deg, folded to [0, pi), 4 bins: _ / | \
    const a: N = mod(atan(gy, gx).add(Math.PI / 2).add(Math.PI * 4), Math.PI);
    const bin: N = mod(floor(a.div(Math.PI / 4).add(0.5)), 4);
    return vec4(strength, bin, zc, 1);
  })();
  void mix;
  return m;
}
