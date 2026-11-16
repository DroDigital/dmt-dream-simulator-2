/**
 * Vision set pieces (§3.12), staged in the dark 'vision' realm while the sim times them.
 * Five stage types, each tinted by the Vision's hue:
 *  - lanterns: hundreds of paper lanterns rise around the dreamer and gather into a ring
 *  - doors: a white sea; doors rise from it and open one by one
 *  - stars: a slow rain of falling stars streaking past
 *  - moon: a giant moon rises, crosses overhead and sets
 *  - glyphstorm: characters swirl up in a widening spiral
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, hex } from './meshkit.ts';
import { makeLofiMaterial, ITINT } from './lofi.ts';
import { PCG32 } from '../core/rng.ts';

type Stage = 'lanterns' | 'doors' | 'stars' | 'moon' | 'glyphstorm';

function instanced(b: MeshBuilder, n: number): THREE.InstancedMesh {
  const g = b.toGeometry();
  g.setAttribute(ITINT, new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(1), 4));
  const m = new THREE.InstancedMesh(g, makeLofiMaterial({ instanced: true }), n);
  m.frustumCulled = false;
  return m;
}

export class VisionStage {
  readonly group = new THREE.Group();
  private parts: Record<Stage, THREE.Object3D[]>;
  private lanterns: THREE.InstancedMesh;
  private doors: THREE.InstancedMesh;
  private stars: THREE.InstancedMesh;
  private glyphs: THREE.InstancedMesh;
  private moon: THREE.Mesh;
  private sea: THREE.Mesh;
  private seeds: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private p = new THREE.Vector3();
  private lastHue = -1;

  constructor() {
    const rng = new PCG32(0x1a77);
    const lb = new MeshBuilder();
    lb.cyl(0, 0, 0, 0.14, 0.22, 0.22, 6, hex('#FFC874', 1));
    lb.cyl(0, 0.22, 0, 0.22, 0.14, 0.22, 6, hex('#FFD9A0', 1));
    this.lanterns = instanced(lb, 480);
    this.seeds = new Float32Array(480 * 4);
    for (let i = 0; i < 480; i++) this.seeds.set([rng.range(0, Math.PI * 2), rng.range(4, 40), rng.range(0, 1), rng.range(0.6, 1.4)], i * 4);
    const db = new MeshBuilder();
    db.box(-0.75, 0, -0.06, -0.62, 2.4, 0.06, hex('#F6EFE4', 0.8));
    db.box(0.62, 0, -0.06, 0.75, 2.4, 0.06, hex('#F6EFE4', 0.8));
    db.box(-0.75, 2.3, -0.06, 0.75, 2.45, 0.06, hex('#F6EFE4', 0.8));
    db.box(-0.62, 0, -0.02, 0.62, 2.3, 0.02, hex('#FFFFFF', 1));
    this.doors = instanced(db, 24);
    const sb = new MeshBuilder();
    sb.box(-0.05, 0, -0.05, 0.05, 3.5, 0.05, hex('#FFFFFF', 1));
    this.stars = instanced(sb, 220);
    const gb = new MeshBuilder();
    gb.panel(0, 0, 0, 0.3, 0.45, hex('#FFF1C4', 1));
    this.glyphs = instanced(gb, 360);
    const mb = new MeshBuilder();
    mb.sphere(0, 0, 0, 18, 18, hex('#F4F0FF', 1));
    this.moon = new THREE.Mesh(mb.toGeometry(), makeLofiMaterial({ noFog: true }));
    const seaB = new MeshBuilder();
    seaB.box(-200, -0.4, -200, 200, -0.05, 200, hex('#F6F1EA', 0.55));
    this.sea = new THREE.Mesh(seaB.toGeometry(), makeLofiMaterial({}));
    this.parts = { lanterns: [this.lanterns], doors: [this.doors, this.sea], stars: [this.stars], moon: [this.moon], glyphstorm: [this.glyphs] };
    this.group.add(this.lanterns, this.doors, this.sea, this.stars, this.glyphs, this.moon);
  }

  private tint(mesh: THREE.InstancedMesh, hue: number, spread: number, emissive: number): void {
    const a = mesh.geometry.getAttribute(ITINT) as THREE.InstancedBufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) { c.setHSL((hue + (i % 7) * spread) % 1, 0.85, 0.7); a.setXYZW(i, c.r * 1.2, c.g * 1.2, c.b * 1.2, emissive); }
    a.needsUpdate = true;
  }

  update(stage: Stage, hue: number, t: number, cx: number, cy: number, cz: number): void {
    for (const [k, objs] of Object.entries(this.parts)) for (const o of objs) o.visible = k === stage;
    if (hue !== this.lastHue) {
      this.lastHue = hue;
      this.tint(this.lanterns, hue, 0.02, 0.4); this.tint(this.doors, hue, 1 / 24, 0.6); this.tint(this.stars, hue, 0.03, 0.8); this.tint(this.glyphs, hue, 0.05, 0.8);
    }
    const { m, q, sc, p } = this;
    if (stage === 'lanterns') {
      for (let i = 0; i < this.lanterns.count; i++) {
        const [a0, r0, h0, sp] = this.seeds.subarray(i * 4, i * 4 + 4);
        const rise = Math.max(0, t * 0.9 * sp - h0 * 6);
        const gather = Math.min(1, Math.max(0, (t - 14) / 10));
        const a = a0 + t * 0.08 * sp;
        const r = r0 * (1 - gather) + 12 * gather;
        const y = Math.min(rise, 30 + h0 * 6) * (1 - gather) + (14 + Math.sin(a * 3) * 0.6) * gather;
        p.set(cx + Math.cos(a) * r, cy - 2 + y, cz + Math.sin(a) * r);
        sc.setScalar(rise > 0 ? 1 : 0.0001);
        this.lanterns.setMatrixAt(i, m.compose(p, q.identity(), sc));
      }
      this.lanterns.instanceMatrix.needsUpdate = true;
    } else if (stage === 'doors') {
      this.sea.position.set(cx, cy, cz);
      for (let i = 0; i < this.doors.count; i++) {
        const a = (i / this.doors.count) * Math.PI * 2;
        const r = 8 + (i % 3) * 5;
        const start = i * 1.1;
        const k = Math.min(1, Math.max(0, (t - start) / 2.5));
        p.set(cx + Math.cos(a) * r, cy - 2.6 * (1 - k * (2 - k)), cz + Math.sin(a) * r);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a - Math.PI / 2 + (t > start + 3 ? Math.min(1.4, (t - start - 3) * 0.6) : 0));
        sc.setScalar(k > 0 ? 1 : 0.0001);
        this.doors.setMatrixAt(i, m.compose(p, q, sc));
      }
      this.doors.instanceMatrix.needsUpdate = true;
    } else if (stage === 'stars') {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
      for (let i = 0; i < this.stars.count; i++) {
        const [a0, r0, h0, sp] = this.seeds.subarray(i * 4, i * 4 + 4);
        const fall = (t * 6 * sp + h0 * 60) % 60;
        p.set(cx + Math.cos(a0) * r0 + fall * 0.5, cy + 50 - fall, cz + Math.sin(a0) * r0);
        sc.setScalar(Math.min(1, t / 2));
        this.stars.setMatrixAt(i, m.compose(p, q, sc));
      }
      this.stars.instanceMatrix.needsUpdate = true;
    } else if (stage === 'moon') {
      const a = -0.3 + t * 0.06;
      this.moon.position.set(cx + Math.cos(a) * 120, cy - 20 + Math.sin(a) * 110, cz - 60);
      this.moon.scale.setScalar(1 + Math.sin(Math.min(Math.PI, t * 0.1)) * 0.6);
    } else if (stage === 'glyphstorm') {
      for (let i = 0; i < this.glyphs.count; i++) {
        const [a0, r0, h0, sp] = this.seeds.subarray(i * 4, i * 4 + 4);
        const a = a0 + t * 0.6 * sp;
        const r = 2 + (r0 * 0.4) * Math.min(1, t / 10);
        p.set(cx + Math.cos(a) * r, cy + ((t * 1.5 * sp + h0 * 20) % 20), cz + Math.sin(a) * r);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        sc.setScalar(1);
        this.glyphs.setMatrixAt(i, m.compose(p, q, sc));
      }
      this.glyphs.instanceMatrix.needsUpdate = true;
    }
  }
}
