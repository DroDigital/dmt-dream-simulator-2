/**
 * Glyph Lab (dev route /glyph-lab): a slowly turning statue in the Lantern Flat room with a scripted
 * camera pan, a Tweakpane panel with every GlyphStyle field, presets, shuffle, save-as-JSON, A/B split
 * and a frame-time readout. Also exposes deterministic test hooks used by the M2G Playwright tests.
 */
import * as THREE from 'three/webgpu';
import { Pane } from 'tweakpane';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { initPhysics } from '../core/physics.ts';
import { DataUtils } from 'three';
import { Visit } from '../director/visit.ts';
import { REALM_DATA } from '../realms/registry.ts';
import { buildFlatLayout } from '../realms/lantern-flat/flat.ts';
import { RealmView } from '../render/realmview.ts';
import { PanePipeline } from '../render/pane.ts';
import { MeshBuilder, hex } from '../render/meshkit.ts';
import { makeLofiMaterial, U } from '../render/lofi.ts';
import { loadGlyphFonts } from '../render/glyph/atlas.ts';
import { DEFAULT_STYLE, PRESET_IDS, preset, type GlyphStyle } from '../render/glyph/styles.ts';
import { PCG32 } from '../core/rng.ts';
import palettes from '../../data/palettes.json' with { type: 'json' };
import * as TSLNS from 'three/tsl';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { texture, screenUV } = TSLNS as any;

function statue(): THREE.Mesh {
  const b = new MeshBuilder();
  const stone = hex('#E8E0F0', 0.05), dark = hex('#9A90B0');
  b.cbox(0, 0, 0, 0.9, 1.0, 0.9, dark);
  b.cyl(0, 1.0, 0, 0.32, 0.42, 0.9, 10, stone);       // torso
  b.cyl(0, 1.9, 0, 0.12, 0.12, 0.18, 8, stone);       // neck
  b.sphere(0, 2.22, 0, 0.24, 12, stone);              // head
  b.cbox(0, 2.16, 0.23, 0.06, 0.12, 0.08, stone);     // nose
  b.push().translate(0.42, 1.75, 0).rotateZ(-0.5); b.cyl(0, -0.7, 0, 0.09, 0.11, 0.7, 6, stone); b.pop();
  b.push().translate(-0.42, 1.75, 0).rotateZ(0.9); b.cyl(0, -0.7, 0, 0.09, 0.11, 0.7, 6, stone); b.pop();
  b.panel(0, 1.4, 0.43, 0.5, 0.3, hex('#FFD9A0', 0.8));
  return new THREE.Mesh(b.toGeometry(), makeLofiMaterial({}));
}

export async function bootGlyphLab(canvas: HTMLCanvasElement, ui: HTMLElement): Promise<void> {
  await initPhysics();
  await loadGlyphFonts();
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: params.has('webgl') });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const testScene = params.get('test');
  const flatVisit = new Visit(REALM_DATA['lantern-flat'], buildFlatLayout(), 0, 0);
  const rv = new RealmView(flatVisit);
  const scene = testScene === 'cube' ? new THREE.Scene() : rv.scene;
  const stat = statue();
  stat.position.set(6, 0, 5.5);
  if (testScene === 'cube') {
    // lit cube against a flat background (edge test)
    const b = new MeshBuilder();
    b.cbox(0, -1, 0, 2, 2, 2, hex('#C8A070'));
    const cube = new THREE.Mesh(b.toGeometry(), makeLofiMaterial({}));
    cube.name = 'cube';
    scene.add(cube);
    const bg = new MeshBuilder();
    bg.box(-60, -40, -40, 60, 40, -39.5, hex('#2A2440'));
    scene.add(new THREE.Mesh(bg.toGeometry(), makeLofiMaterial({})));
  } else {
    scene.add(stat);
    // imported hero mesh from the asset pipeline, if built
    try {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync('/assets/built/test-furniture-kit/hero-globe.glb');
      const m = gltf.scene;
      m.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = makeLofiMaterial({}); });
      m.scale.setScalar(0.5); m.position.set(8.3, 0.4, 4.2);
      scene.add(m);
    } catch { /* not built: run npm run import */ }
  }

  const pipe = new PanePipeline(renderer);
  pipe.setPalette(palettes.quadrants.halo);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.08, 900);
  camera.rotation.order = 'YXZ';
  const rp = new THREE.RenderPipeline(renderer);
  const outTex: N = texture(pipe.output);
  rp.outputNode = outTex.sample(screenUV);

  let style: GlyphStyle = structuredClone(preset(params.get('preset') ?? 'desert-day'));
  const state = { preset: style.id ?? 'desert-day', ab: false, frameMs: 0, pan: true, time: 0 };
  const applyCamera = (t: number) => {
    if (testScene === 'cube') { camera.position.set(0, 0, 6); camera.rotation.set(0, 0, 0); return; }
    camera.position.set(4.2 + Math.sin(t * 0.05) * 0.4, 1.45, 8.6);
    camera.rotation.set(-0.05, (state.pan ? Math.sin(t * 0.12) * 0.35 : 0) + 0.25, 0);
  };

  /** Deterministic frame: fixed time step, no wall clock. */
  const frame = (t: number) => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    pipe.resize(size.x, size.y);
    camera.aspect = size.x / size.y;
    applyCamera(t);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    stat.rotation.y = t * 0.3;
    rv.applyAtmos();
    U.time.value = t;
    const [gw, gh] = pipe.snapGrid();
    (U.snapGrid.value as THREE.Vector2).set(gw, gh);
    U.snapStrength.value = 1; U.jitter.value = 1; // in-game Drowsy settings: the flicker source the history must tame
    const u = pipe.u;
    u.time.value = t; u.lucidity.value = 0; u.saturation.value = 1; u.soften.value = 0.5;
    u.trail.value = 0; u.fringe.value = 0; u.grain.value = 0; u.vignette.value = 0.2; u.bloom.value = 0.6;
    u.glyph.value = 1; u.abSplit.value = state.ab ? 1 : 0; u.transition.value = 0;
    pipe.glyph.applyStyle(style, 0, false);
    pipe.render(scene, camera);
    outTex.value = pipe.output;
    renderer.setRenderTarget(null);
    rp.render();
  };

  const shuffleRng = new PCG32(0x5afe);
  // ---- Tweakpane ----
  if (!params.has('nopanel')) {
    const pane: N = new Pane({ title: 'Glyph Lab', container: ui.appendChild(Object.assign(document.createElement('div'), { style: 'position:absolute;right:8px;top:8px;width:300px;pointer-events:auto;max-height:96vh;overflow:auto' })) });
    const opts = Object.fromEntries(PRESET_IDS().map((id) => [id, id]));
    pane.addBinding(state, 'preset', { options: opts }).on('change', (e: N) => { style = structuredClone(preset(e.value)); pane.refresh(); });
    pane.addButton({ title: 'shuffle' }).on('click', () => { const ids = PRESET_IDS(); state.preset = ids[shuffleRng.int(ids.length)]; style = structuredClone(preset(state.preset)); pane.refresh(); });
    pane.addButton({ title: 'save preset as JSON' }).on('click', () => {
      const { id: _id, ...rest } = style;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 1)], { type: 'application/json' }));
      a.download = `${state.preset}-custom.json`;
      a.click();
    });
    pane.addBinding(state, 'ab', { label: 'A/B split' });
    pane.addBinding(state, 'pan', { label: 'camera pan' });
    pane.addBinding(state, 'frameMs', { readonly: true, label: 'frame ms', view: 'graph', min: 0, max: 50 });
    const proxy = new Proxy({}, {
      get: (_t, k: string) => (style as unknown as Record<string, unknown>)[k],
      set: (_t, k: string, v) => { (style as unknown as Record<string, unknown>)[k] = v; return true; },
    }) as GlyphStyle;
    const f: N = pane.addFolder({ title: 'style' });
    f.addBinding(proxy, 'mode', { options: { ascii: 'ascii', braille: 'braille', blocks: 'blocks' } });
    for (const k of ['cellPx', 'depthNear', 'depthFar', 'edgeThreshold', 'edgeDepthWeight', 'edgeNormalWeight', 'edgeLumaWeight', 'backdropStrength', 'backdropBlur',
      'colourSaturation', 'colourBoost', 'black', 'white', 'gamma', 'contrast', 'coverage', 'hysteresis', 'holdFrames', 'glyphOpacity'] as const) {
      const ranges: Record<string, [number, number]> = { cellPx: [4, 24], depthNear: [0, 30], depthFar: [5, 120], holdFrames: [0, 20], backdropBlur: [0, 8], colourBoost: [0, 3], colourSaturation: [0, 2], gamma: [0.2, 3], contrast: [0, 2] };
      const [min, max] = ranges[k] ?? [0, 1];
      f.addBinding(proxy, k, { min, max });
    }
    f.addBinding(proxy, 'depthCells');
    f.addBinding(proxy, 'edgeThickness', { options: { '1': 1, '2': 2 } });
    f.addBinding(proxy, 'backdropMode', { options: { blurred: 'blurred', black: 'black', original: 'original', transparent: 'transparent' } });
    f.addBinding(proxy, 'colourMode', { options: { full: 'full', mono: 'mono', duotone: 'duotone', palette: 'palette', phosphor: 'phosphor' } });
    f.addBinding(proxy, 'invert'); f.addBinding(proxy, 'shadowLift'); f.addBinding(proxy, 'ripples'); f.addBinding(proxy, 'gazeSettle');
    const paper: N = f.addFolder({ title: 'paper' });
    paper.addBinding(style.paper, 'aberration', { min: 0, max: 1 });
    paper.addBinding(style.paper, 'flutedGlass', { min: 0, max: 1 });
  }

  // ---- loop ----
  let last = performance.now();
  let running = !params.has('manual');
  const tick = () => {
    if (!running) return;
    const now = performance.now();
    state.frameMs = now - last;
    last = now;
    state.time += 1 / 60;
    frame(state.time);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---- test hooks ----
  const readHistory = async (): Promise<{ w: number; h: number; data: Float32Array }> => {
    const rt = pipe.glyph.historyTarget();
    const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, rt.width, rt.height) as unknown as ArrayLike<number>;
    const data = new Float32Array(raw.length);
    const isHalf = raw instanceof Uint16Array;
    for (let i = 0; i < raw.length; i++) data[i] = isHalf ? DataUtils.fromHalfFloat(raw[i]) : raw[i];
    return { w: rt.width, h: rt.height, data };
  };
  (window as unknown as Record<string, unknown>).__lab = {
    stop() { running = false; },
    setPreset(id: string, overrides: Partial<GlyphStyle> = {}) { style = { ...structuredClone(preset(id)), ...overrides }; },
    frame(t: number) { frame(t); },
    readHistory,
    /** Render n frames of the slow pan; returns per-frame glyph change rate and the worst per-cell flip rate. */
    async stability(n: number, overrides: Partial<GlyphStyle> = {}) {
      style = { ...structuredClone(preset('desert-day')), ...overrides, wind: null, ripples: false, gazeSettle: false, drift: 0 };
      running = false;
      let prev: Float32Array | null = null;
      let changes = 0, cells = 0;
      const flipTimes: number[][] = [];
      let maxFlipsPerSec = 0;
      const N = style.mode === 'ascii' ? [...style.ramp].length : 10;
      for (let f = 0; f < n; f++) {
        frame(10 + f / 60);
        const { data } = await readHistory();
        const count = data.length / 4;
        if (prev) {
          for (let c = 0; c < count; c++) {
            const code = Math.floor(data[c * 4] * N) + 32 * data[c * 4 + 1];
            const pcode = Math.floor(prev[c * 4] * N) + 32 * prev[c * 4 + 1];
            if (code !== pcode) changes++;
            const wasDark = prev[c * 4] < 0.25, wasBright = prev[c * 4] > 0.75;
            const isDark = data[c * 4] < 0.25, isBright = data[c * 4] > 0.75;
            if ((wasDark && isBright) || (wasBright && isDark)) {
              (flipTimes[c] ??= []).push(f / 60);
              const recent = flipTimes[c].filter((t) => f / 60 - t < 1).length;
              maxFlipsPerSec = Math.max(maxFlipsPerSec, recent);
            }
          }
          cells += count;
        }
        prev = data;
      }
      return { changeRate: changes / Math.max(1, cells), maxFlipsPerSec };
    },
    /** Edge test: share of silhouette cells whose edge glyph matches the cube silhouette direction (within one bin). */
    async edgeTest() {
      style = { ...structuredClone(preset('desert-day')), wind: null, ripples: false, depthCells: false, cellPx: 8, drift: 0 };
      running = false;
      for (let i = 0; i < 4; i++) frame(i / 60);
      const { w, h, data } = await readHistory();
      // project the cube (2 m at 6 m distance) to cell coords
      const cube = scene.getObjectByName('cube')!;
      const box = new THREE.Box3().setFromObject(cube);
      const corners = [new THREE.Vector3(box.min.x, box.min.y, box.max.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z)].map((v) => v.project(camera));
      const x0 = (corners[0].x * 0.5 + 0.5) * w, x1 = (corners[1].x * 0.5 + 0.5) * w;
      const y0 = (corners[0].y * 0.5 + 0.5) * h, y1 = (corners[1].y * 0.5 + 0.5) * h;
      let total = 0, ok = 0;
      const at = (cx: number, cy: number) => data[(cy * w + cx) * 4 + 1]; // edge code (0 none, bin+1)
      const near = (cx: number, cy: number, want: number) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const c = at(Math.min(w - 1, Math.max(0, cx + dx)), Math.min(h - 1, Math.max(0, cy + dy)));
          if (c > 0.5) { const bin = Math.round(c - 1); const d = Math.min(Math.abs(bin - want), 4 - Math.abs(bin - want)); if (d <= 1 && (bin === want || d === 1)) return bin === want ? 2 : 1; }
        }
        return 0;
      };
      // vertical silhouette edges -> bin 2 '|', horizontal -> bin 0 '_'
      for (let cy = Math.ceil(y0) + 1; cy < Math.floor(y1) - 1; cy++) for (const cx of [Math.round(x0), Math.round(x1) - 1]) { total++; if (near(cx, cy, 2)) ok++; }
      for (let cx = Math.ceil(x0) + 1; cx < Math.floor(x1) - 1; cx++) for (const cy of [Math.round(y0), Math.round(y1) - 1]) { total++; if (near(cx, cy, 0)) ok++; }
      return { total, ok, share: ok / Math.max(1, total), rect: [x0, y0, x1, y1], grid: [w, h] };
    },
    shotPresets: () => PRESET_IDS(),
    rng: new PCG32(1),
    defaults: DEFAULT_STYLE,
  };
}
