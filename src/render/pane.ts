/**
 * Per-pane render pipeline (§9.2):
 *  1. scene pass at 480x270 (scaled to the pane aspect) into an MRT target: colour, emissive, normal, depth
 *  2. (in materials) vertex snap + affine UVs
 *  3. palette quantise (32 colours) + 4x4 Bayer dither
 *  4. nearest-neighbour upscale to pane size (softened at low lucidity)
 *  5. full-res light layer: bloom from emissive, depth fog haze
 *  6. realm effects: glyph pass
 *  7. feedback trails (blend with last frame, zoomed + rotated)
 *  8. Resonance grade: quadrant tint blend + night hue rotation, lucidity saturation
 *  9. lens: chromatic fringe, vignette, grain
 * 10. transition compositor during links / sleep / wake, blink
 *
 * Each pane owns its post materials so pane uniforms are independent.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import { tuning } from '../core/tuning.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const {
  Fn, texture, uv, vec2, vec3, vec4, float, uniform, uniformArray, mix, max, min, clamp, smoothstep, floor, fract, sin, cos, dot, length, abs, step, screenCoordinate, Loop, If, int, luminance, pow, exp, select, mrt, output, normalView, packNormalToRGB,
} = TSLNS as any;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

const SCENE_MRT: N = mrt({ output, emissive: vec4(0, 0, 0, 1), normal: packNormalToRGB(normalView as N) });

export const TRANSITION_IDS: Record<string, number> = {
  none: 0, bloom: 1, glyph: 2, fold: 3, pour: 4, shatter: 5, iris: 6, instant: 7, sleep: 8, wake: 9,
};

function rt(w: number, h: number, opts: THREE.RenderTargetOptions & { nearest?: boolean } = {}): THREE.RenderTarget {
  const t = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, ...opts });
  const f = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  for (const tex of t.textures) { tex.minFilter = f; tex.magFilter = f; tex.generateMipmaps = false; }
  return t;
}

/** One-row glyph atlas (fill ramp) drawn with a monospace font onto a canvas. */
export function makeGlyphAtlas(ramp: string, font = 'VT323, monospace', cellPx = 32): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = cellPx * ramp.length;
  canvas.height = cellPx;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(cellPx * 1.05)}px ${font}`;
  for (let i = 0; i < ramp.length; i++) g.fillText(ramp[i], i * cellPx + cellPx / 2, cellPx / 2 + 1);
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class PanePipeline {
  w = 1;
  h = 1;
  lowW = 480;
  lowH = 270;
  /** Scale of the full-res light layer (75% for 2 panes, 50% for 4). */
  lightScale = 1;
  readonly sceneRT: THREE.RenderTarget;
  readonly loRT: THREE.RenderTarget;
  readonly bloomA: THREE.RenderTarget;
  readonly bloomB: THREE.RenderTarget;
  readonly out: [THREE.RenderTarget, THREE.RenderTarget];
  readonly snapRT: THREE.RenderTarget;
  private flip = 0;
  private quant: THREE.QuadMesh;
  private blurH: THREE.QuadMesh;
  private blurV: THREE.QuadMesh;
  private comp: THREE.QuadMesh;
  private copy: THREE.QuadMesh;
  private prevTex: N;
  private snapTex: N;
  private copySrc: N;

  /** Pane uniforms (§9.2). */
  readonly u = {
    lucidity: uniform(0),
    saturation: uniform(1),
    hue: uniform(0),
    tint: uniform(new THREE.Color('#ffffff')),
    tintAmt: uniform(0),
    bloom: uniform(0.8),
    trail: uniform(0.35),
    trailZoom: uniform(tuning.render.trailZoom),
    trailRot: uniform((tuning.render.trailRotDeg * Math.PI) / 180),
    fringe: uniform(0.6),
    vignette: uniform(0.35),
    grain: uniform(0.04),
    soften: uniform(0.5),
    dawn: uniform(0),
    warm: uniform(0),
    blink: uniform(0),
    transition: uniform(0),
    transT: uniform(0),
    time: uniform(0),
    glyph: uniform(0),
    glyphCell: uniform(8),
    glyphWind: uniform(0),
    invert: uniform(0),
    staticAmt: uniform(0),
    desat: uniform(0),
    lowpass: uniform(0),
    lowSize: uniform(new THREE.Vector2(480, 270)),
    size: uniform(new THREE.Vector2(1, 1)),
    accent: uniform(new THREE.Color('#ffffff')),
    motes: uniform(0),
    flash: uniform(0),
  };
  readonly palette = uniformArray(new Array(32).fill(0).map(() => new THREE.Color(1, 1, 1)), 'color');
  readonly glyphAtlas: THREE.Texture;

  private renderer: THREE.WebGPURenderer;

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
    this.sceneRT = rt(this.lowW, this.lowH, { count: 3, nearest: true, depthBuffer: true });
    this.sceneRT.textures[0].name = 'output';
    this.sceneRT.textures[1].name = 'emissive';
    this.sceneRT.textures[2].name = 'normal';
    this.sceneRT.depthTexture = new THREE.DepthTexture(this.lowW, this.lowH);
    this.loRT = rt(this.lowW, this.lowH, { nearest: true });
    this.bloomA = rt(this.lowW / 2, this.lowH / 2);
    this.bloomB = rt(this.lowW / 2, this.lowH / 2);
    this.out = [rt(4, 4), rt(4, 4)];
    this.snapRT = rt(4, 4);
    this.glyphAtlas = makeGlyphAtlas(' .:-=+*#%@');

    this.quant = new THREE.QuadMesh(this.makeQuantMaterial());
    this.blurH = new THREE.QuadMesh(this.makeBlur(this.sceneRT.textures[1], true, 1));
    this.blurV = new THREE.QuadMesh(this.makeBlur(this.bloomA.texture, false, 0));
    this.prevTex = texture(this.out[1].texture);
    this.snapTex = texture(this.snapRT.texture);
    this.comp = new THREE.QuadMesh(this.makeComposite());
    this.copySrc = texture(this.out[0].texture);
    const cm = new THREE.MeshBasicNodeMaterial();
    cm.colorNode = this.copySrc.sample(uv());
    this.copy = new THREE.QuadMesh(cm);
  }

  setPalette(hexes: string[]): void {
    const arr = (this.palette as N).array as THREE.Color[];
    for (let i = 0; i < 32; i++) arr[i].set(hexes[i % hexes.length]);
  }

  resize(w: number, h: number): void {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const aspect = w / h;
    this.lowH = tuning.render.lowH;
    this.lowW = Math.max(64, Math.round(this.lowH * aspect));
    this.sceneRT.setSize(this.lowW, this.lowH);
    this.loRT.setSize(this.lowW, this.lowH);
    const bw = Math.max(8, Math.round(this.lowW / 2)), bh = Math.max(8, Math.round(this.lowH / 2));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    const lw = Math.round(w * this.lightScale), lh = Math.round(h * this.lightScale);
    this.out[0].setSize(lw, lh);
    this.out[1].setSize(lw, lh);
    this.snapRT.setSize(lw, lh);
    (this.u.lowSize.value as THREE.Vector2).set(this.lowW, this.lowH);
    (this.u.size.value as THREE.Vector2).set(lw, lh);
  }

  /** Grid the vertex snap targets for this pane (240x135 at 16:9, scaled with aspect). */
  snapGrid(): [number, number] {
    const h = tuning.render.snapH;
    return [Math.round(h * (this.lowW / this.lowH)), h];
  }

  private makeQuantMaterial(): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const src: N = texture(this.sceneRT.textures[0]);
    const bayer = uniformArray(BAYER, 'float');
    const pal = this.palette as N;
    const u = this.u;
    m.colorNode = Fn(() => {
      const c: N = src.sample(uv()).rgb.toVar();
      const px: N = floor(screenCoordinate.xy as N);
      const bi: N = int(px.y.mod(4).mul(4).add(px.x.mod(4)));
      // dither spread shrinks as lucidity rises (cleaner image)
      const spread: N = mix(float(0.06), float(0.03), u.lucidity);
      const d: N = c.add((bayer as N).element(bi).mul(spread)).toVar();
      const best: N = vec3(0).toVar();
      const bestD: N = float(1e9).toVar();
      Loop(32, ({ i }: { i: N }) => {
        const p: N = pal.element(i);
        const e: N = d.sub(p);
        const dist: N = dot(e.mul(e), vec3(0.3, 0.59, 0.11));
        If(dist.lessThan(bestD), () => { bestD.assign(dist); best.assign(p); });
      });
      // keep some of the original hue so the image is chunky but not posterised to mush
      return vec4(mix(best, c, 0.3), 1);
    })();
    return m;
  }

  private makeBlur(tex: THREE.Texture, horizontal: boolean, brightPass: number): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const src: N = texture(tex);
    const u = this.u;
    m.colorNode = Fn(() => {
      const texel: N = vec2(1).div(horizontal ? u.lowSize : u.lowSize.mul(0.5));
      const dir: N = horizontal ? vec2(texel.x, 0) : vec2(0, texel.y);
      const w = [0.227, 0.194, 0.121, 0.054, 0.016];
      const acc: N = src.sample(uv()).rgb.mul(w[0]).toVar();
      for (let i = 1; i < 5; i++) {
        const o: N = dir.mul(i * 1.6);
        acc.addAssign(src.sample(uv().add(o)).rgb.mul(w[i]));
        acc.addAssign(src.sample(uv().sub(o)).rgb.mul(w[i]));
      }
      if (brightPass) return vec4(max(acc.sub(0.02), 0).mul(1.2), 1);
      return vec4(acc, 1);
    })();
    return m;
  }

  private makeComposite(): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial();
    const u = this.u;
    const lo: N = texture(this.loRT.texture);
    const bloom: N = texture(this.bloomB.texture);
    const depth: N = texture(this.sceneRT.depthTexture!);
    const atlas: N = texture(this.glyphAtlas);
    const prev = this.prevTex;
    const snap = this.snapTex;
    const RAMP_N = 10;

    const hash21 = (p: N): N => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
    const rot = (p: N, a: N): N => vec2(p.x.mul(cos(a)).sub(p.y.mul(sin(a))), p.x.mul(sin(a)).add(p.y.mul(cos(a))));

    const sampleLo = (q: N): N => {
      // nearest upscale, softened by a 4-tap half-texel average at low lucidity
      const t: N = vec2(0.5).div(u.lowSize);
      const sharp: N = lo.sample(q).rgb;
      const soft: N = lo.sample(q.add(t)).rgb.add(lo.sample(q.sub(t))).add(lo.sample(q.add(vec2(t.x, t.y.negate())))).add(lo.sample(q.add(vec2(t.x.negate(), t.y)))).mul(0.25);
      return mix(sharp, soft, u.soften.mul(0.6));
    };

    const scene = Fn(([q]: [N]) => {
      // chromatic fringe: offset red/blue radially
      const centred: N = q.sub(0.5);
      const fr: N = centred.mul(u.fringe.mul(0.004));
      const c: N = vec3(sampleLo(q.add(fr)).r, sampleLo(q).g, sampleLo(q.sub(fr)).b).toVar();
      c.addAssign(bloom.sample(q).rgb.mul(u.bloom));
      return c;
    });

    m.colorNode = Fn(() => {
      const q: N = uv();
      const col: N = scene(q).toVar();

      // ---- glyph pass (§9.2 step 6; expanded into the Glyph Suite at M2G) ----
      const gAmt: N = u.glyph;
      const cellPx: N = u.glyphCell;
      const px: N = q.mul(u.size);
      const windOff: N = vec2(u.time.mul(u.glyphWind).mul(14), 0);
      const cellId: N = floor(px.add(windOff).div(cellPx));
      const centre: N = cellId.add(0.5).mul(cellPx).sub(windOff).div(u.size);
      const src: N = scene(centre);
      const lum: N = clamp(pow(luminance(src), 0.55), 0, 0.999);
      const flick: N = hash21(cellId.add(floor(u.time.mul(u.glyphWind.mul(2))))).mul(u.glyphWind).mul(0.25);
      const idx: N = floor(clamp(lum.add(flick), 0, 0.999).mul(RAMP_N));
      const local: N = fract(px.add(windOff).div(cellPx));
      const gmask: N = atlas.sample(vec2(idx.add(local.x).div(RAMP_N), float(1).sub(local.y))).r;
      const glyphCol: N = src.mul(gmask).mul(1.5).add(src.mul(0.12));
      col.assign(mix(col, glyphCol, gAmt));

      // ---- feedback trails ----
      const pc: N = rot(q.sub(0.5), u.trailRot).mul(float(1).sub(u.trailZoom)).add(0.5);
      const p: N = prev.sample(pc).rgb;
      col.assign(mix(col, max(col, p.mul(0.85)), u.trail));

      // ---- grade: tint, hue rotation, saturation ----
      col.assign(mix(col, col.mul(u.tint).mul(1.25), u.tintAmt));
      const k: N = vec3(0.57735);
      const ca: N = cos(u.hue), sa: N = sin(u.hue);
      col.assign(col.mul(ca).add(k.cross(col).mul(sa)).add(k.mul(dot(k, col)).mul(float(1).sub(ca))));
      const l: N = luminance(col);
      col.assign(mix(vec3(l), col, u.saturation.mul(float(1).sub(u.desat))));

      // ---- dawn / warmth / low-breath ----
      col.assign(mix(col, col.mul(vec3(1.15, 1.02, 0.85)).add(vec3(0.08, 0.06, 0.03)), u.warm));
      col.assign(mix(col, vec3(1.0, 0.93, 0.85), u.dawn.mul(0.6)));

      // ---- Watcher static at the edges ----
      const edge: N = length(q.sub(0.5)).mul(1.6);
      const noise: N = hash21(floor(px.div(2)).add(floor(u.time.mul(30)).mul(17.13)));
      col.assign(mix(col, vec3(noise), u.staticAmt.mul(smoothstep(0.5, 1.0, edge)).mul(0.7)));
      col.assign(mix(col, vec3(1).sub(col).mul(0.8).add(vec3(noise).mul(0.2)), u.invert));

      // ---- lens: vignette + grain ----
      col.mulAssign(float(1).sub(u.vignette.mul(smoothstep(0.35, 0.95, length(q.sub(0.5).mul(vec2(1.0, 0.85)))))));
      col.addAssign(hash21(px.add(u.time.mul(61.7))).sub(0.5).mul(u.grain));

      // ---- transitions ----
      const tr: N = u.transition;
      const t: N = u.transT;
      const old: N = snap.sample(q).rgb;
      const n2: N = hash21(floor(px.div(u.glyphCell)));
      const r: N = length(q.sub(0.5).mul(vec2(u.size.x.div(u.size.y), 1)));
      // bloom-out: old frame brightens and melts away
      const mBloom: N = smoothstep(t.sub(0.25), t.add(0.05), float(1).sub(r.mul(0.9)).mul(0.5).add(t.mul(0.6)));
      const oldBloom: N = old.add(vec3(t.mul(1.6))).mul(float(1).add(t));
      // glyph dissolve: old frame turns to characters that vanish cell by cell
      const gl: N = atlas.sample(vec2(floor(luminance(old).mul(0.99).mul(RAMP_N)).add(fract(px.x.div(u.glyphCell))).div(RAMP_N), float(1).sub(fract(px.y.div(u.glyphCell))))).r;
      const oldGlyph: N = old.mul(gl).mul(1.6);
      const mGlyph: N = step(n2, t.mul(1.25).sub(0.1));
      // fold: paper folds over along a moving diagonal crease
      const crease: N = q.x.add(q.y.mul(0.6)).sub(t.mul(1.8)).add(0.2);
      const foldQ: N = vec2(q.x.sub(crease.mul(0.35)), q.y);
      const oldFold: N = snap.sample(foldQ).rgb.mul(float(0.8).add(crease.mul(0.5)));
      const mFold: N = step(crease, 0);
      // pour: old frame pours downward with a wavy edge
      const wave: N = sin(q.x.mul(18).add(t.mul(9))).mul(0.03);
      const oldPour: N = snap.sample(vec2(q.x, q.y.add(t.mul(t).mul(1.2)))).rgb;
      const mPour: N = step(float(1).sub(t.mul(1.3)).add(wave), q.y);
      // shatter: voronoi-ish cells fall away
      const sc: N = floor(q.mul(vec2(9, 6)));
      const mShatter: N = step(hash21(sc), t.mul(1.3).sub(0.15));
      const oldShatter: N = snap.sample(q.add(vec2(0, t.mul(t).mul(hash21(sc.add(3))).mul(0.6)))).rgb.mul(vec3(1.1, 1.1, 1.25));
      // iris
      const mIris: N = step(r, t.mul(1.2));
      // instant fade / sleep / wake
      const mFade: N = t;
      const isT = (id: number) => tr.equal(id);
      const mask: N = select(isT(1), mBloom, select(isT(2), mGlyph, select(isT(3), mFold, select(isT(4), mPour, select(isT(5), mShatter, select(isT(6), mIris, mFade))))));
      const oldC: N = select(isT(1), oldBloom, select(isT(2), oldGlyph, select(isT(3), oldFold, select(isT(4), oldPour, select(isT(5), oldShatter, old)))));
      const warmBlack: N = vec3(0.07, 0.045, 0.05);
      const sleepC: N = mix(warmBlack, col, smoothstep(0.3, 1.0, t));
      const motes: N = step(0.985, hash21(floor(px.div(3)).add(floor(t.mul(12)))));
      const wakeC: N = mix(vec3(1.0, 0.92, 0.8).add(vec3(motes)), col, smoothstep(0.2, 1.0, t));
      const transCol: N = select(isT(8), sleepC, select(isT(9), wakeC, mix(oldC, col, clamp(mask, 0, 1))));
      col.assign(select(tr.greaterThan(0.5), transCol, col));

      // dawn dissolve into motes in the last seconds
      col.assign(mix(col, vec3(1.0, 0.95, 0.88), u.motes.mul(step(0.6, hash21(floor(px.div(4)).add(floor(u.time.mul(8))))))));
      // blink: warm black
      col.assign(mix(col, warmBlack, u.blink));
      // photosensitivity guard: clamp overall brightness (flashes handled by easing upstream)
      col.assign(clamp(col, 0.008, 1.6));
      void depth; void exp; void pow; void min; void abs;
      return vec4(col, 1);
    })();
    return m;
  }

  /** Current composited output (after render()). */
  get output(): THREE.Texture {
    return this.out[this.flip].texture;
  }

  /** Copy the last output into the transition snapshot (call at the moment of a link). */
  snapshot(): void {
    this.copySrc.value = this.out[this.flip].texture;
    this.renderer.setRenderTarget(this.snapRT);
    this.copy.render(this.renderer);
    this.renderer.setRenderTarget(null);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    // 1. scene pass (MRT)
    r.setRenderTarget(this.sceneRT);
    r.setMRT(SCENE_MRT);
    r.render(scene, camera);
    // 3. quantise + dither (low res)
    r.setMRT(null);
    r.setRenderTarget(this.loRT);
    this.quant.render(r);
    // 5. bloom
    r.setRenderTarget(this.bloomA);
    this.blurH.render(r);
    r.setRenderTarget(this.bloomB);
    this.blurV.render(r);
    // 6-10. composite into the ping-pong output
    const next = 1 - this.flip;
    this.prevTex.value = this.out[this.flip].texture;
    r.setRenderTarget(this.out[next]);
    this.comp.render(r);
    this.flip = next;
    r.setRenderTarget(null);
  }

  dispose(): void {
    for (const t of [this.sceneRT, this.loRT, this.bloomA, this.bloomB, this.out[0], this.out[1], this.snapRT]) t.dispose();
  }
}
