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
import { Actor, Heading, Lanternfolk, Motif, MOTIF_KINDS, Pos, Vel, inVisit, type EcsWorld } from '../entities/ecs.ts';
const Vel_x = (e: number) => Vel.x[e];
const Vel_z = (e: number) => Vel.z[e];
import { SCRIPT_IDS } from '../director/director.ts';
import { actorMesh, bookFishMesh, drifterMesh, figureMesh, lanternfolkMesh, motifMesh, mothMesh, souvenirMesh } from './entities.ts';
import { BookFish, Drifter, Moth } from '../entities/creatures.ts';
import { Echo } from '../entities/ecs.ts';
import { watcherMesh } from './watcherview.ts';
import { VisionStage } from './visions.ts';
import { VISIONS } from '../director/visions.ts';
import type { Watcher } from '../entities/watcher.ts';
import { FIGURES, FIGURE_COLORS } from '../director/game.ts';

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
  skyU!: { top: N; hor: N; bot: N };
  /** Dynamic objects (entities, carried souvenirs) attach here. */
  readonly dynamic = new THREE.Group();
  drawCalls = 0;
  triangles = 0;
  private entityMeshes = new Map<number, THREE.Object3D>();
  private lastVariant = new Map<number, string>();
  private dynamicObjs = new Map<number, THREE.Object3D>();
  private watcherObj: THREE.Object3D | null = null;
  vision: VisionStage | null = null;

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
    this.skyU = { top, hor, bot };
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

  objectGeometry(id: number): THREE.BufferGeometry | null {
    return this.objRefs.get(id)?.mesh.geometry ?? null;
  }

  /** Pull object + entity state from the sim (call once per frame before rendering any pane). */
  /** Watchers law: figures turn to face this point. */
  faceTarget: { x: number; z: number } | null = null;

  sync(ecs: EcsWorld, time: number): void {
    const v = this.visit;
    for (const o of v.objects) {
      if (o.src === -1) {
        // dynamic (dropped souvenir)
        let m = this.dynamicObjs.get(o.id);
        if (!m) { m = souvenirMesh(o.defId); this.dynamicObjs.set(o.id, m); this.dynamic.add(m); }
        m.visible = !o.hidden && o.carriedBy < 0;
        m.position.set(o.x, o.y + Math.sin(time * 1.5 + o.id) * 0.04, o.z);
        m.rotation.y = time * 0.5;
        continue;
      }
      const ringing = o.variant === 1 && !!o.components.phone;
      const key = `${o.variant}|${o.hidden}|${o.carriedBy}`;
      if (!ringing && this.lastVariant.get(o.id) === key) continue;
      this.lastVariant.set(o.id, key);
      const r = this.objRefs.get(o.id);
      if (!r) continue;
      let tint: [number, number, number, number] = [1, 1, 1, 0];
      if (ringing) tint = [1.3, 1.3, 1.0, 0.4 + 0.4 * Math.max(0, Math.sin(time * 18)) * (Math.sin(time * 2) > 0 ? 1 : 0)];
      else if (o.variant === 1) tint = [1.5, 0.55, 0.6, 0.25];
      else if (o.variant === 2) tint = [0.55, 1.25, 1.5, 0.25];
      else if (o.variant === 3) tint = [1.35, 1.25, 0.4, 0.35];
      const hidden = o.hidden || o.carriedBy >= 0;
      const mat = hidden ? new THREE.Matrix4().makeScale(0, 0, 0)
        : o.variant === 4 ? r.matrix.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI)) : r.matrix;
      r.mesh.setMatrixAt(r.index, mat);
      r.mesh.instanceMatrix.needsUpdate = true;
      const attr = r.mesh.geometry.getAttribute(ITINT) as THREE.InstancedBufferAttribute;
      attr.setXYZW(r.index, tint[0], tint[1], tint[2], tint[3]);
      attr.needsUpdate = true;
    }
    // entities
    const seen = new Set<number>();
    for (const eid of inVisit(ecs, v.id, [Lanternfolk])) {
      seen.add(eid);
      let m = this.entityMeshes.get(eid);
      if (!m) { m = lanternfolkMesh(Lanternfolk.hue[eid], Lanternfolk.size[eid]); this.entityMeshes.set(eid, m); this.dynamic.add(m); }
      m.position.set(Pos.x[eid], Pos.y[eid], Pos.z[eid]);
      m.rotation.y = this.faceTarget ? Math.atan2(this.faceTarget.x - Pos.x[eid], this.faceTarget.z - Pos.z[eid]) : -Heading.yaw[eid];
    }
    for (const eid of inVisit(ecs, v.id, [Motif])) {
      seen.add(eid);
      const kind = MOTIF_KINDS[Motif.kind[eid]];
      let m = this.entityMeshes.get(eid);
      if (!m) { m = motifMesh(kind); this.entityMeshes.set(eid, m); this.dynamic.add(m); }
      m.position.set(Pos.x[eid], Pos.y[eid], Pos.z[eid]);
      if (kind === 'kite') { m.rotation.set(0.3 * Math.sin(time), time * 0.2, 0.2 * Math.sin(time * 1.3)); }
      if (kind === 'train') m.rotation.y = Math.atan2(Vel_x(eid), Vel_z(eid));
    }
    for (const eid of inVisit(ecs, v.id, [Actor])) {
      seen.add(eid);
      const script = SCRIPT_IDS[Actor.script[eid]] ?? 'halo';
      let m = this.entityMeshes.get(eid);
      if (!m) { m = actorMesh(script); this.entityMeshes.set(eid, m); this.dynamic.add(m); }
      const t = Actor.t[eid], dur = Actor.dur[eid];
      const k = Math.min(1, t / dur);
      m.visible = t < dur;
      const yaw = Heading.yaw[eid];
      const dx = Math.cos(yaw), dz = Math.sin(yaw);
      if (script === 'bus') {
        // drive in, stop with doors open, nobody gets off, drive away
        const p = k < 0.3 ? (k / 0.3) ** 0.5 * 30 - 30 : k < 0.7 ? 0 : ((k - 0.7) / 0.3) ** 2 * 40;
        m.position.set(Pos.x[eid] + dx * p, Pos.y[eid], Pos.z[eid] + dz * p);
        m.rotation.y = Math.atan2(dx, dz);
      } else if (script === 'rainbow') {
        m.position.set(Pos.x[eid] + dx * (k - 0.5) * 16, Pos.y[eid], Pos.z[eid] + dz * (k - 0.5) * 16);
        m.rotation.y = Math.atan2(dx, dz) + Math.sin(time * 0.5) * 0.3;
      } else if (script === 'letters' || script === 'dune') {
        m.position.set(Pos.x[eid], Pos.y[eid] + 12 - ((t * 1.2) % 12), Pos.z[eid]);
        m.rotation.y = time * 0.2;
      } else {
        m.position.set(Pos.x[eid], Pos.y[eid] + Math.sin(time * 2) * 0.2, Pos.z[eid]);
        m.rotation.y = time;
        m.scale.setScalar(Math.sin(Math.PI * k));
      }
    }
    const creature = (comp: object, make: (e: number) => THREE.Object3D, flap = 0) => {
      for (const eid of inVisit(ecs, v.id, [comp])) {
        seen.add(eid);
        let m = this.entityMeshes.get(eid);
        if (!m) { m = make(eid); this.entityMeshes.set(eid, m); this.dynamic.add(m); }
        m.position.set(Pos.x[eid], Pos.y[eid], Pos.z[eid]);
        m.rotation.set(0, -Heading.yaw[eid], flap ? Math.sin(time * flap + eid) * 0.4 : 0);
        if (this.faceTarget && comp === Drifter) m.rotation.y = Math.atan2(this.faceTarget.x - Pos.x[eid], this.faceTarget.z - Pos.z[eid]);
      }
    };
    creature(Drifter, (e) => drifterMesh(Drifter.tone[e]));
    creature(BookFish, (e) => bookFishMesh(BookFish.hue[e]), 9);
    creature(Moth, () => mothMesh(), 30);
    for (const eid of inVisit(ecs, v.id, [Echo])) {
      seen.add(eid);
      let m = this.entityMeshes.get(eid);
      if (!m) { const k = Echo.partner[eid]; m = figureMesh(FIGURES[k], FIGURE_COLORS[k]); this.entityMeshes.set(eid, m); this.dynamic.add(m); }
      m.position.set(Pos.x[eid], Pos.y[eid], Pos.z[eid]);
      m.visible = Math.sin(time * 7 + eid) > -0.6; // an echo flickers like a reflection
      m.rotation.y = time * 0.15;
    }
    for (const [eid, m] of this.entityMeshes) if (!seen.has(eid)) { this.dynamic.remove(m); this.entityMeshes.delete(eid); }
  }

  syncWatcher(w: Watcher | undefined, time: number): void {
    if (!w || w.state === 'gone') { if (this.watcherObj) this.watcherObj.visible = false; return; }
    if (!this.watcherObj) { this.watcherObj = watcherMesh(); this.dynamic.add(this.watcherObj); }
    const o = this.watcherObj;
    o.visible = true;
    o.position.set(w.x, w.y + Math.abs(Math.sin(time * 3.4)) * 0.03, w.z);
    o.rotation.y = Math.atan2(w.dirX, w.dirZ);
    o.scale.setScalar(1.0);
  }

  syncVision(id: string | null, t: number, x: number, y: number, z: number): void {
    if (!id) { if (this.vision) this.vision.group.visible = false; return; }
    if (!this.vision) { this.vision = new VisionStage(); this.scene.add(this.vision.group); }
    this.vision.group.visible = true;
    const def = VISIONS.find((x) => x.id === id) ?? VISIONS[0];
    this.vision.update(def.stage, def.hue, t, x, y, z);
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
