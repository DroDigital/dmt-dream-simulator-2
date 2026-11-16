/**
 * Vision set pieces (§3.12): staged in the dark 'vision' realm while the sim times them.
 *  - Lantern Ascension: hundreds of paper lanterns rise around the dreamer and gather into a ring
 *  - Tide of Doors: a white sea; doors rise from it and open one by one, each a different light
 */
import * as THREE from 'three/webgpu';
import { MeshBuilder, hex } from './meshkit.ts';
import { makeLofiMaterial, ITINT } from './lofi.ts';
import { PCG32 } from '../core/rng.ts';

export class VisionStage {
  readonly group = new THREE.Group();
  private lanterns: THREE.InstancedMesh;
  private doors: THREE.InstancedMesh;
  private sea: THREE.Mesh;
  private seeds: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor() {
    const mat = makeLofiMaterial({ instanced: true });
    const lb = new MeshBuilder();
    lb.cyl(0, 0, 0, 0.14, 0.22, 0.22, 6, hex('#FFC874', 1));
    lb.cyl(0, 0.22, 0, 0.22, 0.14, 0.22, 6, hex('#FFD9A0', 1));
    const N = 480;
    const lg = lb.toGeometry();
    lg.setAttribute(ITINT, new THREE.InstancedBufferAttribute(new Float32Array(N * 4).fill(1), 4));
    this.lanterns = new THREE.InstancedMesh(lg, mat, N);
    this.lanterns.frustumCulled = false;
    const rng = new PCG32(0x1a77);
    this.seeds = new Float32Array(N * 4);
    const tint = lg.getAttribute(ITINT) as THREE.InstancedBufferAttribute;
    for (let i = 0; i < N; i++) {
      this.seeds.set([rng.range(0, Math.PI * 2), rng.range(4, 40), rng.range(0, 1), rng.range(0.6, 1.4)], i * 4);
      const c = new THREE.Color().setHSL(0.05 + rng.next() * 0.1, 0.9, 0.7);
      tint.setXYZW(i, c.r * 1.2, c.g * 1.2, c.b * 1.2, 0.4);
    }
    const db = new MeshBuilder();
    db.box(-0.75, 0, -0.06, -0.62, 2.4, 0.06, hex('#F6EFE4', 0.8));
    db.box(0.62, 0, -0.06, 0.75, 2.4, 0.06, hex('#F6EFE4', 0.8));
    db.box(-0.75, 2.3, -0.06, 0.75, 2.45, 0.06, hex('#F6EFE4', 0.8));
    db.box(-0.62, 0, -0.02, 0.62, 2.3, 0.02, hex('#FFFFFF', 1));
    const D = 24;
    const dg = db.toGeometry();
    const dt = new Float32Array(D * 4);
    for (let i = 0; i < D; i++) { const c = new THREE.Color().setHSL(i / D, 0.8, 0.7); dt.set([c.r, c.g, c.b, 0.6], i * 4); }
    dg.setAttribute(ITINT, new THREE.InstancedBufferAttribute(dt, 4));
    this.doors = new THREE.InstancedMesh(dg, mat, D);
    this.doors.frustumCulled = false;
    const seaB = new MeshBuilder();
    seaB.box(-200, -0.4, -200, 200, -0.05, 200, hex('#F6F1EA', 0.55));
    this.sea = new THREE.Mesh(seaB.toGeometry(), makeLofiMaterial({}));
    this.group.add(this.lanterns, this.doors, this.sea);
  }

  update(id: string, t: number, cx: number, cy: number, cz: number): void {
    this.lanterns.visible = id === 'lantern-ascension';
    this.doors.visible = this.sea.visible = id === 'tide-of-doors';
    if (id === 'lantern-ascension') {
      const N = this.lanterns.count;
      for (let i = 0; i < N; i++) {
        const [a0, r0, h0, sp] = this.seeds.subarray(i * 4, i * 4 + 4);
        const rise = Math.max(0, t * 0.9 * sp - h0 * 6);
        const gather = Math.min(1, Math.max(0, (t - 14) / 10));
        const a = a0 + t * 0.08 * sp;
        const r = r0 * (1 - gather) + 12 * gather;
        const y = Math.min(rise, 30 + h0 * 6) * (1 - gather) + (14 + Math.sin(a * 3) * 0.6) * gather;
        this.p.set(cx + Math.cos(a) * r, cy - 2 + y, cz + Math.sin(a) * r);
        this.sc.setScalar(rise > 0 ? 1 : 0.0001);
        this.m.compose(this.p, this.q.identity(), this.sc);
        this.lanterns.setMatrixAt(i, this.m);
      }
      this.lanterns.instanceMatrix.needsUpdate = true;
    } else if (id === 'tide-of-doors') {
      this.sea.position.set(cx, cy, cz);
      const D = this.doors.count;
      for (let i = 0; i < D; i++) {
        const a = (i / D) * Math.PI * 2;
        const r = 8 + (i % 3) * 5;
        const start = i * 1.1;
        const k = Math.min(1, Math.max(0, (t - start) / 2.5));
        const y = cy - 2.6 * (1 - k * (2 - k));
        this.p.set(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a - Math.PI / 2 + (t > start + 3 ? Math.min(1.4, (t - start - 3) * 0.6) : 0));
        this.sc.setScalar(k > 0 ? 1 : 0.0001);
        this.m.compose(this.p, this.q, this.sc);
        this.doors.setMatrixAt(i, this.m);
      }
      this.doors.instanceMatrix.needsUpdate = true;
    }
  }
}
