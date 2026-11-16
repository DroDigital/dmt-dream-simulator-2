/**
 * The View: one camera + one PanePipeline per dreamer, realm scenes per visit, per-dreamer overlays
 * (hand-glow, Aware tint, notice shimmer, ghost doors, free-link ring, carried souvenir) on private
 * camera layers, dreamer figures, and the final split-screen composite through a RenderPipeline.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import type { Game, Dreamer } from '../director/game.ts';
import type { Visit } from '../director/visit.ts';
import { tuning } from '../core/tuning.ts';
import { PanePipeline, TRANSITION_IDS } from './pane.ts';
import { RealmView } from './realmview.ts';
import { U } from './lofi.ts';
import { Postcards } from './postcards.ts';
import { FlatExtras } from './flatview.ts';
import { doorMesh, figureMesh, glowShell, ringCard, souvenirMesh } from './entities.ts';
import { META } from '../realms/registry.ts';
import { ROOM_SLOTS } from '../realms/lantern-flat/flat.ts';
import { lutWeights } from '../director/resonance.ts';
import { windowPreview } from '../director/household.ts';
import palettes from '../../data/palettes.json' with { type: 'json' };
import { PRESET_IDS, preset, blendStyles, type GlyphStyle } from './glyph/styles.ts';
import { quadrantOf } from '../director/resonance.ts';
import { hash } from '../core/rng.ts';

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

const OVERLAY_LAYER = (i: number) => 1 + i;
const FIGURE_LAYER = (i: number) => 10 + i;
/** Mid colours of the four quadrant LUTs (Halo, Bloom, Hush, Undertow). */
const QUAD_TINT = [new THREE.Color('#FFE4E8'), new THREE.Color('#FFB46A'), new THREE.Color('#7FB0B8'), new THREE.Color('#C070FF')];

interface Overlays {
  group: THREE.Group;
  hand: THREE.Mesh;
  tint: THREE.Mesh;
  shimmer: THREE.Mesh;
  doors: THREE.Group | null;
  doorsKey: string;
  ring: THREE.Group | null;
  ringKey: string;
  carried: THREE.Object3D | null;
  carriedId: string | null;
  rain: THREE.InstancedMesh | null;
}

export interface PaneState {
  pipe: PanePipeline;
  camera: THREE.PerspectiveCamera;
  rect: PaneRect;
  lastVisit: number;
  ease: { lucidity: number; blink: number; fov: number; desat: number; invert: number; staticAmt: number };
  tex: N;
  ov: Overlays;
}

export class View {
  readonly renderer: THREE.WebGPURenderer;
  readonly panes: PaneState[] = [];
  readonly realmViews = new Map<number, RealmView>();
  readonly postcards = new Postcards();
  readonly flatExtras = new FlatExtras();
  private pipeline: THREE.RenderPipeline;
  private paneCount = -1;
  private time = 0;
  readonly backend: string;
  fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  gentle = false;
  /** Photo mode: the style shown in the frozen pane. */
  photoStyle: GlyphStyle | null = null;
  photoPane: PaneState | null = null;
  photoCamera: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  private figures = new Map<number, THREE.Object3D>();
  // ---- journal polaroid: best frame (contrast + saturation + motion), sampled at 1 Hz ----
  private polRT = new THREE.RenderTarget(192, 108, { depthBuffer: false });
  private polQuad: THREE.QuadMesh | null = null;
  private polTex: N = null;
  private polTimer = 0;
  private polPrev: Uint8Array | null = null;
  private polBusy = false;
  bestFrames: ({ px: Uint8Array; score: number } | null)[] = [null, null, null, null];
  private game: Game | null = null;

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
    this.game = game;
    game.events.on('link', (e) => { const p = this.panes[e.dreamer]; if (p) { p.pipe.snapshot(); p.pipe.glyph.needsReset = true; } });
    game.events.on('nightStart', () => {
      this.bestFrames = [null, null, null, null];
      this.polPrev = null;
      for (const p of this.panes) p.pipe.snapshot();
      this.postcards.build(this.renderer, game);
    });
    game.events.on('nightEnd', () => { for (const p of this.panes) p.pipe.snapshot(); });
    game.events.on('visitDisposed', (e) => this.dropVisit(e.visit));
    game.events.on('level', (e) => { const p = this.panes[e.dreamer]; if (p && e.up) p.ease.fov += 2; });
    const flat = this.realmView(game.flat);
    flat.scene.add(this.flatExtras.group);
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
      const i = this.panes.length;
      const pipe = new PanePipeline(this.renderer);
      const cam = new THREE.PerspectiveCamera(tuning.look.fov, 16 / 9, 0.08, 900);
      cam.rotation.order = 'YXZ';
      cam.layers.enableAll();
      cam.layers.disable(FIGURE_LAYER(i));
      for (let k = 0; k < 4; k++) if (k !== i) cam.layers.disable(OVERLAY_LAYER(k));
      const group = new THREE.Group();
      const hand = glowShell(), tint = glowShell(), shimmer = glowShell();
      for (const m of [hand, tint, shimmer]) { m.layers.set(OVERLAY_LAYER(i)); group.add(m); }
      this.panes.push({
        pipe, camera: cam, rect: { x: 0, y: 0, w: 1, h: 1 }, lastVisit: -1,
        ease: { lucidity: 0, blink: 0, fov: tuning.look.fov, desat: 0, invert: 0, staticAmt: 0 }, tex: texture(pipe.output),
        ov: { group, hand, tint, shimmer, doors: null, doorsKey: '', ring: null, ringKey: '', carried: null, carriedId: null, rain: null },
      });
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
      return select(left, t[0].sample(vec2(uvs.x.mul(2), uvs.y)), t[1].sample(vec2(uvs.x.sub(0.5).mul(2), uvs.y)));
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

    // sync every resident realm once per frame
    const active = new Set(game.dreamers.map((d) => d.visit.id));
    for (const v of game.visits.values()) if (active.has(v.id)) {
      const rv = this.realmView(v);
      const watcherLaw = game.mode === 'night' && game.hasLaw('watchers');
      const someone = game.dreamers.find((d) => d.visit === v);
      rv.faceTarget = watcherLaw && someone ? { x: someone.body.x, z: someone.body.z } : null;
      rv.sync(game.ecs, this.time);
      rv.syncWatcher(game.watchers.get(v.id), this.time);
      const viewer = game.dreamers.find((d) => d.visit === v && d.vision);
      rv.syncVision(viewer?.vision?.id ?? null, viewer?.vision?.t ?? 0, viewer?.body.x ?? 0, viewer?.body.y ?? 0, viewer?.body.z ?? 0);
    }
    if (active.has(game.flat.id)) {
      this.flatExtras.sync(game.household, this.time);
      const flat = this.realmView(game.flat);
      (flat.skyU.hor.value as THREE.Color).set(windowPreview(game.household));
    }
    this.syncFigures(game, alpha);

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
    if (game.mode === 'night') { this.polTimer += frameDt; if (this.polTimer >= 1) { this.polTimer = 0; this.samplePolaroids(game); } }
  }

  private samplePolaroids(game: Game): void {
    if (this.polBusy) return;
    if (!this.polQuad) {
      this.polTex = texture(this.panes[0].pipe.output);
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = this.polTex.sample((TSLNS as N).uv());
      this.polQuad = new THREE.QuadMesh(m);
    }
    const i = game.tick % game.dreamers.length; // rotate between dreamers
    const d = game.dreamers[i];
    if (!d || d.state !== 'dreaming' || d.transition || !this.panes[i]) return;
    this.polTex.value = this.panes[i].pipe.output;
    this.renderer.setRenderTarget(this.polRT);
    this.polQuad.render(this.renderer);
    this.renderer.setRenderTarget(null);
    this.polBusy = true;
    this.renderer.readRenderTargetPixelsAsync(this.polRT, 0, 0, 192, 108).then((raw) => {
      this.polBusy = false;
      const px = new Uint8Array(raw as ArrayLike<number> as Uint8Array);
      let sum = 0, sum2 = 0, sat = 0, motion = 0;
      const n = px.length / 4;
      for (let k = 0; k < px.length; k += 4) {
        const r = px[k], g = px[k + 1], b = px[k + 2];
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        sum += l; sum2 += l * l;
        sat += Math.max(r, g, b) - Math.min(r, g, b);
        if (this.polPrev) motion += Math.abs(l - (0.3 * this.polPrev[k] + 0.59 * this.polPrev[k + 1] + 0.11 * this.polPrev[k + 2]));
      }
      const mean = sum / n;
      const score = Math.sqrt(Math.max(0, sum2 / n - mean * mean)) / 64 + sat / n / 128 + (this.polPrev ? motion / n / 32 : 0);
      this.polPrev = px;
      const cur = this.bestFrames[i];
      if (!cur || score > cur.score) this.bestFrames[i] = { px, score };
    }).catch(() => { this.polBusy = false; });
  }

  private syncFigures(game: Game, alpha: number): void {
    for (const d of game.dreamers) {
      let f = this.figures.get(d.index);
      if (!f) {
        f = figureMesh(d.figure, d.color);
        f.traverse((o) => o.layers.set(FIGURE_LAYER(d.index)));
        this.figures.set(d.index, f);
      }
      const rv = this.realmView(d.visit);
      if (f.parent !== rv.scene) rv.scene.add(f);
      f.visible = d.state !== 'awake';
      const lerp = (a: number, b: number) => a + (b - a) * alpha;
      f.position.set(lerp(d.prev.x, d.body.x), lerp(d.prev.y, d.body.y) + (d.state === 'lying' ? -0.6 : 0), lerp(d.prev.z, d.body.z));
      f.rotation.set(d.state === 'lying' ? -Math.PI / 2 : 0, -d.body.yaw + Math.PI, 0);
      f.scale.setScalar(game.mode === 'night' ? game.scale() : 1);
    }
  }

  private updateOverlays(game: Game, d: Dreamer, p: PaneState, rv: RealmView): void {
    const ov = p.ov;
    if (ov.group.parent !== rv.scene) rv.scene.add(ov.group);
    const setShell = (m: THREE.Mesh, objId: number, color: string, amt: number, grow: number) => {
      const geo = objId >= 0 ? rv.objectGeometry(objId) : null;
      const mat = objId >= 0 ? rv.objectMatrix(objId) : null;
      if (!geo || !mat) { m.visible = false; return; }
      m.geometry = geo;
      m.matrix.copy(mat).multiply(new THREE.Matrix4().makeScale(grow, grow, grow));
      m.matrixWorldNeedsUpdate = true;
      (m.material as N).userData.col.value.set(color);
      (m.material as N).userData.amt.value = amt;
      m.visible = true;
    };
    // hand-glow on the interact target
    if (d.interact?.kind === 'object') {
      const o = d.visit.objects[d.interact.id];
      if (o && o.src >= 0) setShell(ov.hand, o.id, d.color, 0.35 + 0.15 * Math.sin(this.time * 4), 1.12);
      else ov.hand.visible = false;
    } else if (d.interact?.kind === 'slot' && game.mode === 'morning') {
      ov.hand.visible = false;
      const slot = ROOM_SLOTS[d.interact.id];
      ov.shimmer.visible = false;
      this.slotMarker(ov, slot, d.color);
    } else ov.hand.visible = false;
    // Aware tint: rim in the destination's key colour (truthful)
    if (d.tint) setShell(ov.tint, d.tint.obj, META.get(d.tint.dest)?.key ?? '#ffffff', 0.28 + 0.08 * Math.sin(this.time * 2.5), 1.06);
    else ov.tint.visible = false;
    // notice shimmer: brief expanding shell at the noticed spot (on the nearest object if any)
    const ln = d.lastNotice;
    const age = ln ? (game.tick - ln.tick) / 60 : 99;
    if (ln && age < 0.9) {
      const obj = d.visit.objects.find((o) => Math.abs(o.x - ln.x) < 0.01 && Math.abs(o.z - ln.z) < 0.01 && o.src >= 0);
      if (obj) setShell(ov.shimmer, obj.id, d.color, (1 - age / 0.9) * 0.8, 1.04 + age * 0.25);
      else ov.shimmer.visible = false;
    } else ov.shimmer.visible = false;

    // ghost doors
    const dk = d.doors ? d.doors.doors.map((x) => x.realm + x.x.toFixed(2)).join('|') : '';
    if (dk !== ov.doorsKey) {
      if (ov.doors) { ov.group.remove(ov.doors); ov.doors = null; }
      ov.doorsKey = dk;
      if (d.doors) {
        ov.doors = new THREE.Group();
        for (const door of d.doors.doors) {
          const m = doorMesh(this.postcards.get(door.realm), META.get(door.realm)?.key ?? '#ffffff');
          m.position.set(door.x, door.y, door.z);
          m.rotation.y = -d.body.yaw;
          m.traverse((o) => o.layers.set(OVERLAY_LAYER(d.index)));
          ov.doors.add(m);
        }
        ov.group.add(ov.doors);
      }
    }
    if (ov.doors && d.doors) {
      const rise = Math.min(1, d.doors.t / 0.5);
      ov.doors.children.forEach((c, i) => { c.position.y = d.doors!.doors[i].y - 2.4 * (1 - rise * (2 - rise)); });
    }
    // free-link ring
    const rk = d.ring ? d.ring.options.map((o) => o.realm).join('|') : '';
    if (rk !== ov.ringKey) {
      if (ov.ring) { ov.group.remove(ov.ring); ov.ring = null; }
      ov.ringKey = rk;
      if (d.ring) {
        ov.ring = new THREE.Group();
        for (const o of d.ring.options) {
          const card = ringCard(this.postcards.get(o.realm), META.get(o.realm)?.key ?? '#fff');
          card.position.set(o.x, o.y, o.z);
          card.lookAt(d.body.x, o.y, d.body.z);
          card.layers.set(OVERLAY_LAYER(d.index));
          ov.ring.add(card);
        }
        ov.group.add(ov.ring);
      }
    }
    if (ov.ring && d.ring) ov.ring.children.forEach((c, i) => { const look = d.ring!.options[i].look; c.scale.setScalar(1 + look * 0.4); c.position.y = d.ring!.options[i].y + Math.sin(this.time * 1.5 + i) * 0.05; });

    // Indoor rain (Dream Law): streaks falling around the dreamer, even under roofs
    const raining = game.mode === 'night' && game.hasLaw('indoor-rain');
    if (raining && !ov.rain) {
      const g = new THREE.BoxGeometry(0.012, 0.5, 0.012);
      ov.rain = new THREE.InstancedMesh(g, new THREE.MeshBasicNodeMaterial({ color: 0xbde7ff, transparent: true, opacity: 0.55 }), 600);
      ov.rain.frustumCulled = false;
      ov.rain.layers.set(OVERLAY_LAYER(d.index));
      ov.group.add(ov.rain);
    }
    if (ov.rain) {
      ov.rain.visible = raining;
      if (raining) {
        const m = new THREE.Matrix4();
        for (let i = 0; i < ov.rain.count; i++) {
          const a = i * 2.399, r = 1 + (i % 37) * 0.33;
          const y = 8 - ((this.time * 9 + i * 0.731) % 10);
          m.makeTranslation(d.body.x + Math.cos(a) * r, d.body.y + y, d.body.z + Math.sin(a) * r);
          ov.rain.setMatrixAt(i, m);
        }
        ov.rain.instanceMatrix.needsUpdate = true;
      }
    }
    // carried souvenir floats lower-right of view
    if (d.souvenir !== ov.carriedId) {
      if (ov.carried) ov.group.remove(ov.carried);
      ov.carried = d.souvenir ? souvenirMesh(d.souvenir) : null;
      ov.carriedId = d.souvenir;
      if (ov.carried) { ov.carried.traverse((o) => o.layers.set(OVERLAY_LAYER(d.index))); ov.group.add(ov.carried); }
    }
    if (ov.carried) {
      const cam = p.camera;
      const off = new THREE.Vector3(0.32, -0.28 + Math.sin(this.time * 1.7) * 0.015, -0.7).applyQuaternion(cam.quaternion);
      ov.carried.position.copy(cam.position).add(off);
      ov.carried.quaternion.copy(cam.quaternion);
      ov.carried.rotateY(this.time * 0.4);
      ov.carried.scale.setScalar(0.9);
    }
  }

  private slotMarkerMesh: THREE.Mesh | null = null;
  private slotMarker(ov: Overlays, slot: { x: number; y: number; z: number }, color: string): void {
    if (!this.slotMarkerMesh) {
      const g = new THREE.TorusGeometry(0.16, 0.012, 4, 20);
      this.slotMarkerMesh = new THREE.Mesh(g, new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity: 0.8 }));
    }
    const m = this.slotMarkerMesh;
    if (m.parent !== ov.group) ov.group.add(m);
    m.position.set(slot.x, slot.y + 0.02, slot.z);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(1 + 0.1 * Math.sin(this.time * 4));
    m.visible = true;
  }

  private renderPane(game: Game, d: Dreamer, p: PaneState, alpha: number, frameDt: number): void {
    const rv = this.realmView(d.visit);
    const cam = p.camera;
    const b = d.body, pr = d.prev;
    const lerp = (a: number, c: number) => a + (c - a) * alpha;
    const scale = game.mode === 'night' ? game.scale() : 1;
    const eye = tuning.move.eyeHeight * scale * (d.state === 'lying' ? 0.2 : 1);
    cam.position.set(lerp(pr.x, b.x), lerp(pr.y, b.y) + eye, lerp(pr.z, b.z));
    cam.rotation.set(lerp(pr.pitch, b.pitch), -lerp(pr.yaw, b.yaw), lerp(pr.roll, b.roll));
    if (this.photoCamera && this.photoPane === p) { cam.position.copy(this.photoCamera.pos); cam.rotation.set(this.photoCamera.pitch, -this.photoCamera.yaw, 0); }
    cam.near = 0.08 * scale;
    cam.aspect = p.rect.w / p.rect.h;
    const k = 1 - Math.exp(-frameDt * 2);
    p.ease.lucidity += (d.lucidity / 100 - p.ease.lucidity) * k;
    p.ease.fov += (tuning.look.fov - p.ease.fov) * (1 - Math.exp(-frameDt * 3));
    cam.fov = p.ease.fov;
    cam.updateProjectionMatrix();
    if (game.mode === 'night' && game.hasLaw('mirror')) cam.projectionMatrix.elements[0] *= -1;
    if (this.slotMarkerMesh) this.slotMarkerMesh.visible = false;
    this.updateOverlays(game, d, p, rv);
    cam.updateMatrixWorld();

    const pipe = p.pipe;
    const u = pipe.u;
    const luc = p.ease.lucidity;
    const tr = d.transition;
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
    u.trail.value = this.gentle ? 0.04 : 0.2 + 0.18 * (1 - luc);
    u.fringe.value = this.gentle ? 0.1 : 0.7;
    u.grain.value = this.gentle ? 0.02 : 0.045;
    // ---- Glyph Suite: Glyph Desert (desert-* by quadrant), Glyph night (seeded preset), glyph link, photo mode ----
    let style: GlyphStyle | null = null;
    let amount = 0;
    const night = game.mode === 'night';
    if (atmos.glyph) {
      const q = quadrantOf(game.resonance);
      style = preset(q === 'hush' || q === 'undertow' ? 'desert-night' : 'desert-day');
      amount = 1;
    } else if (night && game.hasLaw('glyph-night')) {
      const ids = PRESET_IDS().filter((x) => x.startsWith('glyph-night-'));
      style = preset(ids[hash(game.nightSeed, 0x91) % ids.length]);
      amount = 1;
    }
    if (tr && tr.kind === 'glyph') {
      // the departing realm is shown glyph-dissolving by the transition; the arriving one resolves out of characters
      const t = Math.min(1, tr.t / tr.dur);
      const resolve = 1 - Math.max(0, (t - 0.45) / 0.55);
      if (!style) style = preset('desert-day');
      amount = Math.max(amount, resolve);
    }
    if (this.photoStyle && this.photoPane === p) { style = this.photoStyle; amount = 1; }
    if (style) {
      const prevStyle = (p as N).lastStyle as GlyphStyle | undefined;
      const blendT = (p as N).styleBlend ?? 1;
      const s0 = prevStyle && prevStyle.id !== style.id && blendT < 1 ? blendStyles(prevStyle, style, blendT) : style;
      pipe.glyph.applyStyle(s0, d.level, this.gentle, prevStyle && blendT < 1 ? style : null, blendT);
      if (!prevStyle || prevStyle.id !== style.id) { (p as N).styleBlend = prevStyle ? 0 : 1; (p as N).lastStyle = style; }
      (p as N).styleBlend = Math.min(1, ((p as N).styleBlend ?? 1) + frameDt / 0.6);
      // footstep ripples from every dreamer in this realm
      const walkers = game.dreamers.filter((x) => x.visit === d.visit && x.state === 'dreaming').map((x) => ({ index: x.index, x: x.body.x, y: x.body.y, z: x.body.z }));
      pipe.glyph.living.footsteps(walkers, cam, pipe.glyph.g, this.time);
    }
    u.glyph.value = amount;
    // Resonance grade: blend of the 4 quadrant LUT tints + night hue rotation
    if (game.mode === 'night') {
      const w = lutWeights(game.resonance);
      const c = new THREE.Color(0, 0, 0);
      QUAD_TINT.forEach((q, i) => c.add(q.clone().multiplyScalar(w[i])));
      (u.tint.value as THREE.Color).copy(c);
      u.tintAmt.value = 0.22;
      u.hue.value = ((game.plan?.hueDeg ?? 0) * Math.PI) / 180;
    } else { u.tintAmt.value = 0.05; u.hue.value = 0; }
    // ghost doors: world desaturates except doors
    p.ease.desat += ((d.doors ? 0.9 : 0) - p.ease.desat) * (1 - Math.exp(-frameDt * 6));
    u.desat.value = p.ease.desat;
    // blink: warm black, 0.12 s in / 0.2 s out
    const shut = d.blinkT > 0 ? 1 : 0;
    const rate = shut ? 1 / tuning.blink.inS : 1 / tuning.blink.outS;
    p.ease.blink += Math.sign(shut - p.ease.blink) * Math.min(Math.abs(shut - p.ease.blink), rate * frameDt);
    u.blink.value = p.ease.blink;
    // breath cues: dawn brightening below 25%, warmth in the last 30 s, motes in the last 5 s
    if (game.mode === 'night' && d.state !== 'awake') {
      const frac = game.breath / Math.max(1, game.breathStart);
      u.dawn.value = Math.max(0, (tuning.breath.dawnAt - frac) / tuning.breath.dawnAt) * 0.5;
      u.warm.value = game.breath < tuning.breath.thinAtS ? 1 - game.breath / tuning.breath.thinAtS : 0;
      u.motes.value = game.breath < tuning.breath.dissolveAtS ? (1 - game.breath / tuning.breath.dissolveAtS) * 0.6 : 0;
    } else { u.dawn.value = 0; u.warm.value = 0; u.motes.value = 0; }
    // the Watcher: static at the edges when near, invert + static for 0.5 s on contact (no flicker)
    const wd = game.mode === 'night' ? game.watcherNear(d) : Infinity;
    const nearAmt = Math.max(0, Math.min(1, (tuning.watcher.nearM - wd) / tuning.watcher.nearM));
    p.ease.staticAmt += (nearAmt - p.ease.staticAmt) * (1 - Math.exp(-frameDt * 3));
    u.staticAmt.value = p.ease.staticAmt * (this.gentle ? 0.4 : 1);
    if (d.wokeReason === 'watcher' && p.ease.invert === 0) p.ease.invert = 0.5;
    if (d.wokeReason !== 'watcher') p.ease.invert = 0;
    const inv = p.ease.invert > 0 ? Math.max(0, p.ease.invert) : 0;
    u.invert.value = inv > 0 ? 1 : 0;
    if (p.ease.invert > 0) p.ease.invert = Math.max(-1, p.ease.invert - frameDt);
    if (nearAmt > 0) cam.rotation.z += (1 * Math.PI / 180) * nearAmt;
    // sleeping window: an early waker watches a partner who is still dreaming
    const watching = d.state === 'awake' && game.mode === 'night' ? game.dreamers.find((o) => o.state !== 'awake' && o !== d) : undefined;
    pipe.setInset(watching ? this.panes[watching.index]?.pipe.output ?? null : null);
    // transitions
    if (tr) {
      u.transition.value = TRANSITION_IDS[tr.kind] ?? 7;
      const t = Math.min(1, tr.t / tr.dur);
      u.transT.value = t * t * (3 - 2 * t);
    } else u.transition.value = 0;
    if (d.state === 'awake' && game.mode === 'night') { u.transition.value = 8; u.transT.value = 0.35; }

    pipe.render(rv.scene, cam);
  }

  stats(): { drawCalls: number; triangles: number } {
    const info = this.renderer.info.render as N;
    return { drawCalls: info.drawCalls ?? info.calls ?? 0, triangles: info.triangles ?? 0 };
  }
}
