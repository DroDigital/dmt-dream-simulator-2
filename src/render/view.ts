/**
 * The View: one camera + one PanePipeline per dreamer, realm scenes per visit, and the final
 * split-screen composite to the canvas through a RenderPipeline (1 full, 2 side by side, 3-4 quarters).
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import type { Game, Dreamer } from '../director/game.ts';
import type { Visit } from '../director/visit.ts';
import { tuning, DEG } from '../core/tuning.ts';
import { PanePipeline, TRANSITION_IDS } from './pane.ts';
import { RealmView } from './realmview.ts';
import { U } from './lofi.ts';
import palettes from '../../data/palettes.json' with { type: 'json' };

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { texture, screenUV, vec2, vec4, select } = TSLNS as any;

export interface PaneRect { x: number; y: number; w: number; h: number }

export function paneLayout(n: number, W: number, H: number): PaneRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }];
  const q = [{ x: 0, y: 0, w: W / 2, h: H / 2 }, { x: W / 2, y: 0, w: W / 2, h: H / 2 }, { x: 0, y: H / 2, w: W / 2, h: H / 2 }, { x: W / 2, y: H / 2, w: W / 2, h: H / 2 }];
  return q.slice(0, n);
}

export interface PaneState {
  pipe: PanePipeline;
  camera: THREE.PerspectiveCamera;
  rect: PaneRect;
  lastVisit: number;
  /** Eased display values. */
  ease: { lucidity: number; blink: number; fov: number };
  tex: N;
}

export class View {
  readonly renderer: THREE.WebGPURenderer;
  readonly panes: PaneState[] = [];
  readonly realmViews = new Map<number, RealmView>();
  private pipeline: THREE.RenderPipeline;
  private paneCount = -1;
  private time = 0;
  readonly backend: string;
  fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  gentle = false;

  private constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.backend = (renderer.backend as N).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  static async create(canvas: HTMLCanvasElement, forceWebGL = false): Promise<View> {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance' });
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return new View(renderer);
  }

  attach(game: Game): void {
    game.events.on('link', (e) => {
      const p = this.panes[e.dreamer];
      if (p) p.pipe.snapshot();
    });
    game.events.on('nightStart', () => { for (const p of this.panes) p.pipe.snapshot(); });
    game.events.on('nightEnd', () => { for (const p of this.panes) p.pipe.snapshot(); });
    game.events.on('visitDisposed', (e) => this.dropVisit(e.visit));
  }

  realmView(v: Visit): RealmView {
    let rv = this.realmViews.get(v.id);
    if (!rv) { rv = new RealmView(v); this.realmViews.set(v.id, rv); }
    return rv;
  }

  private dropVisit(v: Visit): void {
    const rv = this.realmViews.get(v.id);
    if (rv) { rv.dispose(); this.realmViews.delete(v.id); }
  }

  private ensurePanes(n: number): void {
    while (this.panes.length < n) {
      const pipe = new PanePipeline(this.renderer);
      const cam = new THREE.PerspectiveCamera(tuning.look.fov, 16 / 9, 0.08, 600);
      cam.rotation.order = 'YXZ';
      this.panes.push({ pipe, camera: cam, rect: { x: 0, y: 0, w: 1, h: 1 }, lastVisit: -1, ease: { lucidity: 0, blink: 0, fov: tuning.look.fov }, tex: texture(pipe.output) });
    }
    while (this.panes.length > n) this.panes.pop()!.pipe.dispose();
    if (n !== this.paneCount) {
      this.paneCount = n;
      this.pipeline.outputNode = this.buildComposite(n);
      this.pipeline.needsUpdate = true;
    }
  }

  private buildComposite(n: number): N {
    const uvs: N = screenUV;
    const t = this.panes.map((p) => p.tex);
    if (n === 1) return t[0].sample(uvs);
    if (n === 2) {
      const left = uvs.x.lessThan(0.5);
      const a = t[0].sample(vec2(uvs.x.mul(2), uvs.y));
      const b = t[1].sample(vec2(uvs.x.sub(0.5).mul(2), uvs.y));
      return select(left, a, b);
    }
    const lx = uvs.x.lessThan(0.5), ty = uvs.y.lessThan(0.5);
    const local = vec2(uvs.x.mod(0.5).mul(2), uvs.y.mod(0.5).mul(2));
    const s = (i: number) => (t[i] ? t[i].sample(local) : vec4(0.05, 0.04, 0.05, 1));
    return select(ty, select(lx, s(0), s(1)), select(lx, s(2), s(3)));
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  render(game: Game, alpha: number, frameDt: number): void {
    this.time += frameDt;
    if (frameDt > 0) { this.fpsAcc += frameDt; this.fpsN++; if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; } }
    const n = Math.max(1, game.dreamers.length);
    this.ensurePanes(n);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rects = paneLayout(n, size.x, size.y);
    const lightScale = n === 1 ? 1 : n === 2 ? tuning.render.lightScale2p : tuning.render.lightScale4p;
    U.time.value = this.time;

    game.dreamers.forEach((d, i) => {
      const p = this.panes[i];
      p.rect = rects[i];
      p.pipe.lightScale = lightScale;
      p.pipe.resize(rects[i].w, rects[i].h);
      this.renderPane(game, d, p, alpha, frameDt);
      p.tex.value = p.pipe.output;
    });
    this.renderer.setRenderTarget(null);
    this.pipeline.render();
  }

  private renderPane(game: Game, d: Dreamer, p: PaneState, alpha: number, frameDt: number): void {
    const rv = this.realmView(d.visit);
    const cam = p.camera;
    const b = d.body, pr = d.prev;
    const lerp = (a: number, c: number) => a + (c - a) * alpha;
    const eye = tuning.move.eyeHeight;
    cam.position.set(lerp(pr.x, b.x), lerp(pr.y, b.y) + eye, lerp(pr.z, b.z));
    cam.rotation.set(lerp(pr.pitch, b.pitch), -lerp(pr.yaw, b.yaw), lerp(pr.roll, b.roll));
    cam.aspect = p.rect.w / p.rect.h;
    const k = 1 - Math.exp(-frameDt * 2);
    p.ease.lucidity += (d.lucidity / 100 - p.ease.lucidity) * k;
    const targetFov = tuning.look.fov;
    p.ease.fov += (targetFov - p.ease.fov) * (1 - Math.exp(-frameDt * 4));
    cam.fov = p.ease.fov;
    cam.updateProjectionMatrix();

    const pipe = p.pipe;
    const u = pipe.u;
    const luc = p.ease.lucidity;
    const atmos = rv.atmos;
    if (p.lastVisit !== d.visit.id) {
      p.lastVisit = d.visit.id;
      pipe.setPalette((palettes.quadrants as Record<string, string[]>)[atmos.quadrant === 'centre' ? 'halo' : atmos.quadrant] ?? palettes.quadrants.halo);
    }
    rv.applyAtmos();
    const [gw, gh] = pipe.snapGrid();
    (U.snapGrid.value as THREE.Vector2).set(gw, gh);
    U.snapStrength.value = 1 - 0.5 * luc;
    U.jitter.value = (1 - luc) * 0.9 + 0.1;

    u.time.value = this.time;
    u.lucidity.value = luc;
    u.saturation.value = 0.72 + 0.55 * luc;
    u.soften.value = 1 - luc;
    u.bloom.value = atmos.bloom * tuning.render.bloomStrength;
    u.trail.value = this.gentle ? 0.05 : 0.22 + 0.18 * (1 - luc);
    u.fringe.value = this.gentle ? 0.1 : 0.7;
    u.glyph.value = atmos.glyph ? 1 : 0;
    u.glyphWind.value = atmos.glyph ? 1 : 0;
    // breath cues: dawn brightening below 25%, warmth in the last 30 s, motes in the last 5 s
    if (game.mode === 'night' && d.state !== 'awake') {
      const frac = game.breath / Math.max(1, game.breathStart);
      u.dawn.value = Math.max(0, (tuning.breath.dawnAt - frac) / tuning.breath.dawnAt) * 0.5;
      u.warm.value = game.breath < tuning.breath.thinAtS ? 1 - game.breath / tuning.breath.thinAtS : 0;
      u.motes.value = game.breath < tuning.breath.dissolveAtS ? (1 - game.breath / tuning.breath.dissolveAtS) * 0.6 : 0;
    } else { u.dawn.value = 0; u.warm.value = 0; u.motes.value = 0; }
    // transitions
    const tr = d.transition;
    if (tr) {
      u.transition.value = TRANSITION_IDS[tr.kind] ?? 7;
      const t = Math.min(1, tr.t / tr.dur);
      u.transT.value = t * t * (3 - 2 * t);
    } else u.transition.value = 0;

    pipe.render(rv.scene, cam);
  }

  stats(): { drawCalls: number; triangles: number } {
    const info = this.renderer.info.render as N;
    return { drawCalls: info.drawCalls ?? info.calls ?? 0, triangles: info.triangles ?? 0 };
  }
}

export { DEG };
