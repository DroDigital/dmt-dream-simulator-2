/**
 * Meshes for entities (Lanternfolk, motif sightings, event actors), the four dreamer figures,
 * ghost doors, the free-link ring and souvenirs. All procedural, built with MeshBuilder.
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, hex, type RGBA } from './meshkit.ts';
import { makeLofiMaterial } from './lofi.ts';
import { kitGeometry } from './kits.ts';
import * as TSLNS from 'three/tsl';
/* eslint-disable @typescript-eslint/no-explicit-any */
const { texture, uv, vec4, mrt, uniform } = TSLNS as any;

/** Postcard material: shows a realm's postcard and feeds the light layer so it survives desaturation. */
export function postcardMaterial(tex: THREE.Texture | null, color: string): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide;
  const c = tex ? texture(tex, uv()).rgb : uniform(new THREE.Color(color));
  m.colorNode = vec4(c, 1);
  m.mrtNode = mrt({ emissive: vec4(c.mul(0.7), 1) });
  return m;
}

let plainMat: THREE.MeshBasicNodeMaterial | null = null;
export function plainMaterial(): THREE.MeshBasicNodeMaterial {
  if (!plainMat) plainMat = makeLofiMaterial({ instanced: false });
  return plainMat;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: (b: MeshBuilder) => void): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { const b = new MeshBuilder(); build(b); g = b.toGeometry(); geoCache.set(key, g); }
  return g;
}

function hueColor(h: number, e = 1): RGBA {
  const c = new THREE.Color().setHSL(h, 0.75, 0.68);
  return [c.r, c.g, c.b, e];
}

export function lanternfolkMesh(hue: number, size: number, tall = false): THREE.Object3D {
  const k = Math.round(hue * 12);
  const geo = cached(`folk:${k}:${tall}`, (b) => {
    const glow = hueColor(k / 12, 1);
    const paper = hueColor(k / 12, 0.55);
    const H = tall ? 2.3 : 1.0;
    b.cyl(0, 0.0, 0, 0.05, 0.05, H * 0.35, 4, hex('#3A2A2A')); // stalk legs
    b.cyl(0.12, 0.0, 0, 0.03, 0.03, H * 0.33, 4, hex('#3A2A2A'));
    b.cyl(0, H * 0.33, 0, 0.18, 0.3, H * 0.3, 8, paper);
    b.cyl(0, H * 0.63, 0, 0.3, 0.18, H * 0.3, 8, glow);
    b.cyl(0, H * 0.93, 0, 0.1, 0.1, 0.06, 6, hex('#3A2A2A'));
    // face: two dark slits
    b.box(-0.09, H * 0.7, 0.27, -0.04, H * 0.76, 0.3, hex('#2A1A2A'));
    b.box(0.04, H * 0.7, 0.27, 0.09, H * 0.76, 0.3, hex('#2A1A2A'));
  });
  const m = new THREE.Mesh(geo, plainMaterial());
  m.scale.setScalar(size);
  return m;
}

export function motifMesh(kind: string): THREE.Object3D {
  if (kind === 'kite') {
    return new THREE.Mesh(cached('kite', (b) => {
      const red = hex('#FF3D4A', 0.6);
      b.tri([0, 1.2, 0], [-0.8, 0, 0], [0, -1.4, 0], red, [0, 0], [1, 0], [0, 1]);
      b.tri([0, 1.2, 0], [0, -1.4, 0], [0.8, 0, 0], [0.85, 0.2, 0.25, 0.6], [0, 0], [1, 0], [0, 1]);
      for (let i = 0; i < 6; i++) b.panel(Math.sin(i) * 0.2, -1.6 - i * 0.45, 0, 0.18, 0.12, hex(i % 2 ? '#FFF27A' : '#FF3D4A', 0.6));
    }), plainMaterial());
  }
  if (kind === 'train') {
    return new THREE.Mesh(cached('train', (b) => {
      for (let c = 0; c < 6; c++) {
        b.box(-1.4, 0, c * 9, 1.4, 3, c * 9 + 8.4, hex('#2B3550'), { top: hex('#3A4A6A') });
        for (let w = 0; w < 5; w++) { b.box(1.41, 1.4, c * 9 + 0.6 + w * 1.6, 1.45, 2.4, c * 9 + 1.6 + w * 1.6, hex('#FFE7A3', 1)); b.box(-1.45, 1.4, c * 9 + 0.6 + w * 1.6, -1.41, 2.4, c * 9 + 1.6 + w * 1.6, hex('#FFE7A3', 1)); }
      }
    }), plainMaterial());
  }
  if (kind === 'moons') {
    const m = new THREE.Mesh(cached('moon', (b) => b.sphere(0, 0, 0, 9, 14, hex('#DDEBFF', 1))), plainMaterial());
    return m;
  }
  if (kind === 'lantern-woman') return lanternfolkMesh(0.03, 1, true);
  return new THREE.Object3D();
}

/** Drifter: a tall, slow, faceless silhouette. */
export function drifterMesh(tone: number): THREE.Object3D {
  return new THREE.Mesh(cached(`drifter:${Math.round(tone * 4)}`, (b) => {
    const c = hueColor(0.7 + tone * 0.2, 0.05);
    const body: RGBA = [c[0] * 0.25, c[1] * 0.25, c[2] * 0.3, 0.05];
    b.cyl(0, 0, 0, 0.32, 0.22, 1.8, 7, body);
    b.sphere(0, 2.05, 0, 0.2, 8, body, 1.2);
  }), plainMaterial());
}

/** Book-fish: a small open book that swims. */
export function bookFishMesh(hue: number): THREE.Object3D {
  return new THREE.Mesh(cached(`bookfish:${Math.round(hue * 6)}`, (b) => {
    const cover = hueColor(hue, 0.15);
    b.tri([0, 0, -0.2], [-0.25, 0.12, 0], [0, 0, 0.2], cover, [0, 0], [1, 0], [0, 1]);
    b.tri([0, 0, -0.2], [0, 0, 0.2], [0.25, 0.12, 0], cover, [0, 0], [1, 0], [0, 1]);
    b.tri([0, 0.01, -0.18], [-0.2, 0.1, 0], [0.2, 0.1, 0], hex('#F6EBD8', 0.4), [0, 0], [1, 0], [0, 1]);
  }), plainMaterial());
}

/** Moth of the Moth Choir. */
export function mothMesh(): THREE.Object3D {
  return new THREE.Mesh(cached('moth', (b) => {
    b.tri([0, 0, 0], [-0.12, 0.02, -0.06], [-0.1, 0.02, 0.08], hex('#F2E6C9', 0.6), [0, 0], [1, 0], [0, 1]);
    b.tri([0, 0, 0], [0.1, 0.02, 0.08], [0.12, 0.02, -0.06], hex('#F2E6C9', 0.6), [0, 0], [1, 0], [0, 1]);
  }), plainMaterial());
}

/** Event actor visuals by script name. */
export function actorMesh(script: string): THREE.Object3D {
  if (script === 'bus') {
    return new THREE.Mesh(cached('bus', (b) => {
      b.box(-1.25, 0.3, -5, 1.25, 3.2, 5, hex('#E8C27A'), { top: hex('#F4F0EA') });
      for (let w = 0; w < 6; w++) { b.box(1.26, 1.6, -4.4 + w * 1.5, 1.3, 2.6, -3.3 + w * 1.5, hex('#FFF4C4', 0.9)); b.box(-1.3, 1.6, -4.4 + w * 1.5, -1.26, 2.6, -3.3 + w * 1.5, hex('#FFF4C4', 0.9)); }
      b.box(-1.0, 1.8, 5, 1.0, 2.8, 5.05, hex('#FFF4C4', 0.9));
      b.box(-0.9, 0.8, 5, -0.5, 1.1, 5.05, hex('#FFFFFF', 1)); b.box(0.5, 0.8, 5, 0.9, 1.1, 5.05, hex('#FFFFFF', 1));
      b.push().rotateZ(Math.PI / 2);
      for (const z of [-3.5, 3.5]) { b.cyl(0.45, -1.35, z, 0.45, 0.45, 2.7, 8, hex('#1A1A22')); }
      b.pop();
    }), plainMaterial());
  }
  if (script === 'rainbow') {
    return new THREE.Mesh(cached('rainbow', (b) => {
      const cols = ['#FF5A6E', '#FFB000', '#FFF27A', '#5AE0A0', '#3FB8E8', '#7A5CFF'];
      cols.forEach((c, i) => b.box(-3, 0.02 + i * 0.001, -0.6 + i * 0.2, 3, 0.03 + i * 0.001, -0.4 + i * 0.2, hex(c, 0.9)));
    }), plainMaterial());
  }
  if (script === 'letters' || script === 'dune') {
    return new THREE.Mesh(cached('letters', (b) => {
      for (let i = 0; i < 40; i++) b.panel(Math.sin(i * 7.1) * 4, (i % 10) * 1.1, Math.cos(i * 3.3) * 4, 0.35, 0.5, hex('#FFF1C4', 1), i);
    }), plainMaterial());
  }
  // generic: a slowly turning halo of small lights above the spot
  return new THREE.Mesh(cached('halo', (b) => {
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.cbox(Math.cos(a) * 1.4, 2.4 + Math.sin(a * 3) * 0.1, Math.sin(a) * 1.4, 0.15, 0.15, 0.15, hex('#FFF4E6', 1)); }
  }), plainMaterial());
}

/** Dreamer figure: Moth, Kite, Bell, Crane. A simple body + procedural accessory + emissive outline colour. */
export function figureMesh(figure: string, color: string): THREE.Object3D {
  const geo = cached(`fig:${figure}`, (b) => {
    const acc = hex(color, 0.9);
    const body = hex('#E8E0F0', 0.12);
    const dark = hex('#2A2438', 0.05);
    b.cyl(0, 0, 0, 0.12, 0.12, 0.8, 6, dark); // legs
    if (figure === 'bell') b.cyl(0, 0.35, 0, 0.55, 0.18, 1.0, 10, body);
    else b.cyl(0, 0.8, 0, 0.26, 0.22, 0.6, 8, body);
    if (figure === 'moth') { b.cyl(0, 0.3, 0, 0.42, 0.28, 1.0, 8, hex('#F2E6C9', 0.15)); b.sphere(0, 1.6, 0, 0.2, 8, body); b.panel(-0.05, 1.82, 0, 0.02, 0.3, acc, 0.4); b.panel(0.05, 1.82, 0, 0.02, 0.3, acc, -0.4); }
    if (figure === 'kite') { b.push().translate(0, 1.62, 0).rotateZ(Math.PI / 4); b.cbox(0, -0.18, 0, 0.3, 0.3, 0.2, acc); b.pop(); for (let i = 0; i < 5; i++) b.panel(0, 1.4 - i * 0.22, -0.3 - i * 0.12, 0.1, 0.16, acc); }
    if (figure === 'bell') { b.sphere(0, 1.55, 0, 0.18, 8, body); b.cyl(0, 0.35, 0, 0.58, 0.58, 0.05, 10, acc); }
    if (figure === 'crane') {
      b.sphere(0, 1.6, 0, 0.18, 8, body);
      b.tri([0, 1.6, 0.18], [0, 1.66, 0.55], [0, 1.54, 0.2], acc, [0, 0], [1, 0], [0, 1]);
      b.tri([-0.2, 1.1, -0.15], [0.2, 1.1, -0.15], [0, 0.3, -0.45], hex('#F6EBD8', 0.3), [0, 0], [1, 0], [0, 1]);
    }
    // emissive outline ring at chest height in the accent colour
    b.cyl(0, 1.15, 0, 0.3, 0.3, 0.05, 8, acc, { cap: false });
  });
  return new THREE.Mesh(geo, plainMaterial());
}

/** Ghost door frame; the postcard texture is applied to the inner panel. */
export function doorMesh(postcard: THREE.Texture | null, color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cached(`doorframe:${color}`, (b) => {
    const c = hex(color, 1);
    b.box(-0.75, 0, -0.06, -0.62, 2.3, 0.06, c);
    b.box(0.62, 0, -0.06, 0.75, 2.3, 0.06, c);
    b.box(-0.75, 2.2, -0.06, 0.75, 2.35, 0.06, c);
  }), plainMaterial()));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 2.2), postcardMaterial(postcard, color));
  panel.position.set(0, 1.1, 0);
  g.add(panel);
  return g;
}

/** Floating postcard tile for the free-link ring. */
export function ringCard(postcard: THREE.Texture | null, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.56), postcardMaterial(postcard, color));
}

/** Souvenir mesh by souvenir id (reuses the kit prop builders where one exists). */
export function souvenirMesh(id: string): THREE.Object3D {
  const procs: Record<string, string> = { 'paper-crane': 'crane', 'bike-bell': 'bell', 'glass-bead': 'bead', 'candle-stub': 'candlestub', 'sand-scroll': 'scroll', 'ink-bottle': 'inkbottle' };
  const proc = procs[id];
  const geo = proc
    ? kitGeometry(proc, { cell: 4, lh: 2, v: 0 }, `souvenir/${id}`)
    : cached(`souv:${id}`, (b) => b.sphere(0, 0.1, 0, 0.1, 6, hex('#FFE7A3', 0.8)));
  return new THREE.Mesh(geo, plainMaterial());
}

/** A backside-scaled glow shell for highlighting an object (hand-glow, tint rim, shimmer). */
export function glowShell(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const col = uniform(new THREE.Color(0xffffff));
  const amt = uniform(0.5);
  m.colorNode = vec4(col.mul(amt), amt);
  m.mrtNode = mrt({ emissive: vec4(col.mul(amt).mul(0.8), 1) });
  m.userData.col = col;
  m.userData.amt = amt;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}
