/**
 * Builds the three.js scene for one Visit: instanced tiles and props (one draw call per kit piece
 * variant), a sky dome, and per-object handles so the Director's anomalies can recolour / hide things.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import type { Visit, WorldObject } from '../director/visit.ts';
import { hash32 } from '../core/rng.ts';
import { kitGeometry } from './kits.ts';
import { ITINT, makeDetailTexture, makeLofiMaterial, U } from './lofi.ts';
import { ATMOS, type Atmos } from '../realms/atmos.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const {
  Fn, vec3, vec4, mix, smoothstep, positionLocal, uniform, mrt, float, max, pow, dot, normalize, sin, fract, floor,
} = TSLNS as any;

interface InstanceRef { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; tint: [number, number, number, number] }

const detailCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.MeshBasicNodeMaterial>();

function materialFor(atmos: Atmos): THREE.MeshBasicNodeMaterial {
  let m = matCache.get(atmos.detail);
  if (!m) {
    let tex = detailCache.get(atmos.detail);
    if (!tex) { tex = makeDetailTexture(atmos.detail, atmos.detail.length); detailCache.set(atmos.detail, tex); }
    m = makeLofiMaterial({ detail: tex, instanced: true });
    matCache.set(atmos.detail, m);
  }
  return m;
}

export class RealmView {
  readonly scene = new THREE.Scene();
  readonly atmos: Atmos;
  readonly visit: Visit;
  private objRefs = new Map<number, InstanceRef>();
  private dirty = new Set<THREE.InstancedMesh>();
  readonly sky: THREE.Mesh;
  /** Dynamic objects (entities, carried souvenirs) attach here. */
  readonly dynamic = new THREE.Group();
  drawCalls = 0;
  triangles = 0;

  constructor(visit: Visit) {
    this.visit = visit;
    this.atmos = ATMOS[visit.realm] ?? ATMOS['evening-suburb'];
    this.sky = this.buildSky();
    this.scene.add(this.sky);
    this.buildInstances();
    this.scene.add(this.dynamic);
  }

  private buildSky(): THREE.Mesh {
    const a = this.atmos;
    const top = uniform(new THREE.Color(a.skyTop)), hor = uniform(new THREE.Color(a.skyHorizon)), bot = uniform(new THREE.Color(a.skyBottom));
    const sunCol = uniform(new THREE.Color(a.sunDisc ?? a.sun));
    const sunDir = uniform(new THREE.Vector3(...a.sunDir).normalize());
    const stars = a.stars ? 1 : 0;
    const moons = a.moons ?? 0;
    const m = new THREE.MeshBasicNodeMaterial();
    m.side = THREE.BackSide;
    m.depthWrite = false;
    m.fog = false;
    const col: N = Fn(() => {
      const d: N = normalize(positionLocal as N);
      const y: N = d.y;
      const up: N = mix(hor, top, smoothstep(0.0, 0.6, y));
      const c: N = mix(bot, up, smoothstep(-0.25, 0.05, y)).toVar();
      const sd: N = max(dot(d, sunDir), 0);
      c.addAssign(sunCol.mul(pow(sd, 400).mul(a.sunDisc ? 1.5 : 0)).add(sunCol.mul(pow(sd, 8).mul(0.25))));
      if (moons > 0) {
        const md: N = max(dot(d, normalize(vec3(-0.5, 0.45, -0.6))), 0);
        c.addAssign(vec3(1.0, 0.95, 0.85).mul(smoothstep(0.9985, 0.999, md)));
        if (moons > 1) c.addAssign(vec3(0.85, 0.95, 1.0).mul(smoothstep(0.9993, 0.9996, max(dot(d, normalize(vec3(-0.35, 0.5, -0.65))), 0))));
      }
      if (stars) {
        const cell: N = floor(d.mul(180));
        const h: N = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
        c.addAssign(vec3(1).mul(smoothstep(0.996, 1.0, h)).mul(smoothstep(0.0, 0.3, y)));
      }
      return c;
    })();
    m.colorNode = vec4(col, 1);
    m.mrtNode = mrt({ emissive: vec4(col.mul(float(0.25)), 1) }) as N;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }

  private buildInstances(): void {
    const { visit } = this;
    const { layout, kit } = visit;
    const mat = materialFor(this.atmos);
    const tiles = new Map(kit.tiles.map((t) => [t.id, t]));
    const props = new Map(kit.props.map((p) => [p.id, p]));
    type Entry = { geo: THREE.BufferGeometry; items: { m: THREE.Matrix4; obj: number; tint: [number, number, number, number] }[] };
    const groups = new Map<string, Entry>();
    const add = (key: string, geo: THREE.BufferGeometry, m: THREE.Matrix4, obj: number) => {
      let e = groups.get(key);
      if (!e) { e = { geo, items: [] }; groups.set(key, e); }
      e.items.push({ m, obj, tint: [1, 1, 1, 0] });
    };
    const tileObj = new Map<number, number>();
    const propObj = new Map<number, number>();
    for (const o of visit.objects) (o.kind === 'tile' ? tileObj : propObj).set(o.src, o.id);

    for (let c = 0; c < layout.cells.length; c++) {
      const v = layout.variants[layout.cells[c]];
      const t = tiles.get(v.id)!;
      const cx = c % layout.grid, cz = Math.floor(c / layout.grid);
      const varn = hash32(c * 7 + visit.seed) % 4;
      const proc = t.mesh?.proc ?? 'yard';
      const geo = kitGeometry(proc, { cell: layout.cell, lh: layout.levelHeight, tile: t, v: varn }, `${layout.realm}/${t.id}`);
      const m = new THREE.Matrix4().makeRotationY(-v.rot * Math.PI / 2).setPosition((cx + 0.5) * layout.cell, 0, (cz + 0.5) * layout.cell);
      add(`t:${t.id}:${varn}`, geo, m, tileObj.get(c) ?? -1);
    }
    layout.props.forEach((p, i) => {
      const def = props.get(p.id);
      const varn = hash32(i * 13 + visit.seed) % 4;
      const geo = kitGeometry(def?.mesh?.proc ?? p.id, { cell: layout.cell, lh: layout.levelHeight, prop: def, v: varn }, `${layout.realm}/${p.id}`);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
        new THREE.Vector3(p.scale, p.scale, p.scale),
      );
      add(`p:${p.id}:${varn}`, geo, m, propObj.get(i) ?? -1);
    });

    for (const [key, e] of groups) {
      const geo = e.geo.clone();
      const tintArr = new Float32Array(e.items.length * 4);
      e.items.forEach((it, i) => tintArr.set(it.tint, i * 4));
      geo.setAttribute(ITINT, new THREE.InstancedBufferAttribute(tintArr, 4));
      const mesh = new THREE.InstancedMesh(geo, mat, e.items.length);
      mesh.name = key;
      e.items.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        if (it.obj >= 0) this.objRefs.set(it.obj, { mesh, index: i, matrix: it.m.clone(), tint: it.tint });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.drawCalls++;
      this.triangles += (geo.attributes.position.count / 3) * e.items.length;
    }
  }

  /** Apply object state (hidden / variant / tint) from the sim. */
  syncObject(o: WorldObject, tint?: [number, number, number, number]): void {
    const r = this.objRefs.get(o.id);
    if (!r) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    r.mesh.setMatrixAt(r.index, o.hidden || o.carriedBy >= 0 ? zero : r.matrix);
    r.mesh.instanceMatrix.needsUpdate = true;
    if (tint) {
      const attr = r.mesh.geometry.getAttribute(ITINT) as THREE.InstancedBufferAttribute;
      attr.setXYZW(r.index, tint[0], tint[1], tint[2], tint[3]);
      attr.needsUpdate = true;
    }
    this.dirty.add(r.mesh);
  }

  objectMatrix(id: number): THREE.Matrix4 | null {
    return this.objRefs.get(id)?.matrix ?? null;
  }

  /** Write this realm's atmosphere into the shared material uniforms (call before each pane render). */
  applyAtmos(): void {
    const a = this.atmos;
    (U.fogColor.value as THREE.Color).set(a.fog);
    U.fogNear.value = a.fogNear;
    U.fogFar.value = a.fogFar;
    (U.sky.value as THREE.Color).set(a.sky);
    (U.ground.value as THREE.Color).set(a.ground);
    (U.sunColor.value as THREE.Color).set(a.sun);
    (U.sunDir.value as THREE.Vector3).set(...a.sunDir).normalize();
    U.emissiveGain.value = a.emissiveGain;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
  }
}
