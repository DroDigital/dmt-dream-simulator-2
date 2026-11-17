/**
 * Glyph Suite (M2G): a per-pane post-process at the "realm effects" stage (§9.2 step 6).
 * cells (brightness + edges at cell res, 3 sizes) -> history (hysteresis, hold, flip limit)
 * -> blurred backdrop (quarter res) -> compose (full res glyph layer).
 * The composite then samples the glyph layer through the Paper effects (aberration, fluted glass).
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import { makeGlyphUniforms, BACKDROP_IDS, COLOUR_IDS, type GlyphUniforms } from './uniforms.ts';
import { makeCellsColourMaterial, makeCellsEdgeMaterial } from './cells.ts';
import { makeHistoryMaterial } from './history.ts';
import { makeComposeMaterial } from './compose.ts';
import { makeGlyphSuiteAtlas } from './atlas.ts';
import { MODES } from './modes/index.ts';
import { DEFAULT_STYLE, gentleStyle, lucidStyle, type GlyphStyle } from './styles.ts';
import { LivingText } from './living.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { Fn, texture, uv, vec2, vec4 } = TSLNS as any;

function rt(w: number, h: number, nearest = true): THREE.RenderTarget {
  const t = new THREE.RenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, depthBuffer: false });
  const f = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.texture.minFilter = f; t.texture.magFilter = f; t.texture.generateMipmaps = false;
  return t;
}

export interface GlyphInputs { colour: THREE.Texture; depth: THREE.Texture; normal: THREE.Texture; palette: N }

export class GlyphSuite {
  readonly g: GlyphUniforms = makeGlyphUniforms();
  readonly living = new LivingText();
  style: GlyphStyle = DEFAULT_STYLE;
  private renderer: THREE.WebGPURenderer;
  private cellsA: THREE.RenderTarget[] = [];
  private cellsB: THREE.RenderTarget[] = [];
  private hist: [THREE.RenderTarget, THREE.RenderTarget][] = [];
  private flip = 0;
  private qColour: THREE.QuadMesh[] = [];
  private qEdge: THREE.QuadMesh[] = [];
  private qHist: { quad: THREE.QuadMesh; prev: N }[] = [];
  private backA: THREE.RenderTarget;
  private backB: THREE.RenderTarget;
  private qBackH: THREE.QuadMesh;
  private qBackV: THREE.QuadMesh;
  private compose: { quad: THREE.QuadMesh; history: N[] };
  readonly out: THREE.RenderTarget;
  private atlas: THREE.CanvasTexture;
  private atlasRamp = '';
  private w = 1;
  private h = 1;
  private cellPx: number[] = [0, 0, 0];
  needsReset = true;
  /** Optional second style for crossfades (mode mixing). */
  private styleB: GlyphStyle | null = null;

  constructor(renderer: THREE.WebGPURenderer, src: GlyphInputs) {
    this.renderer = renderer;
    this.atlas = makeGlyphSuiteAtlas();
    this.atlasRamp = MODES.ascii.ramp;
    for (let k = 0; k < 3; k++) {
      this.cellsA.push(rt(4, 4));
      this.cellsB.push(rt(4, 4));
      this.hist.push([rt(4, 4), rt(4, 4)]);
      this.qColour.push(new THREE.QuadMesh(makeCellsColourMaterial(src, this.g, k)));
      this.qEdge.push(new THREE.QuadMesh(makeCellsEdgeMaterial(src, this.g, k)));
      const h = makeHistoryMaterial(this.cellsA[k].texture, this.cellsB[k].texture, this.g);
      this.qHist.push({ quad: new THREE.QuadMesh(h.material), prev: h.prev });
    }
    this.backA = rt(4, 4, false);
    this.backB = rt(4, 4, false);
    this.qBackH = new THREE.QuadMesh(this.blurMat(src.colour, true));
    this.qBackV = new THREE.QuadMesh(this.blurMat(this.backA.texture, false));
    this.out = rt(4, 4, false);
    const c = makeComposeMaterial({ scene: src.colour, backdrop: this.backB.texture, cellsA: this.cellsA.map((r) => r.texture), cellsB: this.cellsB.map((r) => r.texture) }, this.g, this.atlas);
    this.compose = { quad: new THREE.QuadMesh(c.material), history: c.history };
  }

  private blurMat(tex: THREE.Texture, horizontal: boolean): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const s: N = texture(tex);
    const g = this.g;
    m.colorNode = Fn(() => {
      const step: N = g.backdropBlur.mul(g.cellSizes.y).div(g.size).mul(0.35);
      const dir: N = horizontal ? vec2(step.x, 0) : vec2(0, step.y);
      const w = [0.28, 0.22, 0.12, 0.05];
      const acc: N = s.sample(uv()).rgb.mul(w[0]).toVar();
      for (let i = 1; i < 4; i++) { acc.addAssign(s.sample(uv().add(dir.mul(i))).rgb.mul(w[i])); acc.addAssign(s.sample(uv().sub(dir.mul(i))).rgb.mul(w[i])); }
      return vec4(acc.div(0.98), 1);
    })();
    return m;
  }

  get output(): THREE.Texture { return this.out.texture; }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.out.setSize(w, h);
    this.backA.setSize(Math.max(8, w >> 2), Math.max(8, h >> 2));
    this.backB.setSize(Math.max(8, w >> 2), Math.max(8, h >> 2));
    (this.g.size.value as THREE.Vector2).set(w, h);
    this.g.aspect.value = w / h;
    this.cellPx = [0, 0, 0];
    this.needsReset = true;
  }

  /** Apply a style (with lucidity calming, gentle mode) to the uniforms. */
  applyStyle(style: GlyphStyle, level = 0, gentle = false, b: GlyphStyle | null = null, mix = 0): void {
    let s = lucidStyle(style, level);
    if (gentle) s = gentleStyle(s);
    this.style = s;
    this.styleB = b;
    const g = this.g;
    const mode = MODES[s.mode] ?? MODES.ascii;
    const modeB = b ? MODES[b.mode] ?? MODES.ascii : mode;
    if (s.ramp !== this.atlasRamp && s.mode === 'ascii') {
      this.atlas.dispose();
      const at = makeGlyphSuiteAtlas(s.ramp);
      this.atlas.image = at.image;
      this.atlas.needsUpdate = true;
      this.atlasRamp = s.ramp;
    }
    g.row.value = mode.row; g.rowB.value = modeB.row;
    g.rampN.value = s.mode === 'ascii' ? [...s.ramp].length : [...mode.ramp].length;
    g.rampNB.value = [...modeB.ramp].length;
    g.modeMix.value = b ? mix : 0;
    const sizes = s.depthCells ? s.cellSizes : [s.cellPx, s.cellPx, s.cellPx];
    (g.cellSizes.value as THREE.Vector3).set(sizes[0], sizes[1], sizes[2]);
    g.depthCells.value = s.depthCells ? 1 : 0;
    g.depthNear.value = s.depthNear; g.depthFar.value = s.depthFar;
    g.edgeThreshold.value = s.edgeThreshold; g.edgeDepthWeight.value = s.edgeDepthWeight; g.edgeNormalWeight.value = s.edgeNormalWeight;
    g.edgeLumaWeight.value = s.edgeLumaWeight; g.edgeThickness.value = s.edgeThickness;
    g.backdropMode.value = BACKDROP_IDS[s.backdropMode]; g.backdropStrength.value = s.backdropStrength; g.backdropBlur.value = s.backdropBlur;
    g.colourMode.value = COLOUR_IDS[s.colourMode]; g.colourSaturation.value = s.colourSaturation; g.colourBoost.value = s.colourBoost;
    if (s.colourA) (g.colA.value as THREE.Color).set(s.colourA);
    if (s.colourB) (g.colB.value as THREE.Color).set(s.colourB);
    (g.phosphorCol.value as THREE.Color).set(s.phosphor === 'amber' ? '#FFB347' : '#7CFF6A');
    g.black.value = s.black; g.white.value = s.white; g.gamma.value = s.gamma; g.contrast.value = s.contrast;
    g.coverage.value = s.coverage; g.invert.value = s.invert ? 1 : 0; g.shadowLift.value = s.shadowLift ? 1 : 0;
    g.hysteresis.value = s.hysteresis; g.holdFrames.value = s.holdFrames;
    g.windSpeed.value = s.wind?.speed ?? 0;
    if (s.wind) (g.windDir.value as THREE.Vector2).set(s.wind.dir[0], s.wind.dir[1]).normalize();
    g.ripplesOn.value = s.ripples ? 1 : 0;
    g.gazeOn.value = s.gazeSettle ? 1 : 0;
    g.scramble.value = gentle ? 0 : 1 - 0.5 * (Math.min(3, level) / 3);
    g.aberration.value = s.paper.aberration; g.fluted.value = s.paper.flutedGlass;
    g.opacity.value = s.glyphOpacity; g.scanlines.value = s.scanlines ?? 0; g.drift.value = s.drift ?? 0;
  }

  private ensureCells(): void {
    const v = this.g.cellSizes.value as THREE.Vector3;
    const want = [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
    for (let k = 0; k < 3; k++) {
      if (want[k] === this.cellPx[k]) continue;
      this.cellPx[k] = want[k];
      const cw = Math.ceil(this.w / Math.max(2, want[k])), ch = Math.ceil(this.h / Math.max(2, want[k]));
      this.cellsA[k].setSize(cw, ch); this.cellsB[k].setSize(cw, ch);
      this.hist[k][0].setSize(cw, ch); this.hist[k][1].setSize(cw, ch);
      this.needsReset = true;
    }
  }

  render(camera: THREE.PerspectiveCamera, time: number, dt: number): void {
    const r = this.renderer;
    const g = this.g;
    this.ensureCells();
    g.time.value = time;
    g.dt.value = dt;
    g.camNear.value = camera.near; g.camFar.value = camera.far;
    g.settleRadius.value = (6 / camera.fov) * 0.5;
    g.settle.value = this.living.gaze(camera.rotation.y, camera.rotation.x, dt);
    g.reset.value = this.needsReset ? 1 : 0;
    this.needsReset = false;
    r.setMRT(null);
    const next = 1 - this.flip;
    for (let k = 0; k < 3; k++) {
      if (k !== 1 && !this.style.depthCells) continue;
      r.setRenderTarget(this.cellsA[k]); this.qColour[k].render(r);
      r.setRenderTarget(this.cellsB[k]); this.qEdge[k].render(r);
      this.qHist[k].prev.value = this.hist[k][this.flip].texture;
      r.setRenderTarget(this.hist[k][next]); this.qHist[k].quad.render(r);
      this.compose.history[k].value = this.hist[k][next].texture;
    }
    if (!this.style.depthCells) for (const k of [0, 2]) this.compose.history[k].value = this.hist[1][next].texture;
    this.flip = next;
    if (this.style.backdropMode === 'blurred') {
      r.setRenderTarget(this.backA); this.qBackH.render(r);
      r.setRenderTarget(this.backB); this.qBackV.render(r);
    }
    r.setRenderTarget(this.out);
    this.compose.quad.render(r);
    r.setRenderTarget(null);
  }

  /** Read back the current history of the middle cell size (tests: stability, flips, edges). */
  historyTarget(): THREE.RenderTarget { return this.hist[1][this.flip]; }
  edgeTarget(): THREE.RenderTarget { return this.cellsB[1]; }
}
