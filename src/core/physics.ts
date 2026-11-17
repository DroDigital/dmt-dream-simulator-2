/**
 * Thin wrapper around Rapier. Game code talks to `PhysicsWorld`, never to Rapier directly.
 * Each realm visit owns one world. Dreamers are kinematic capsules driven by a character controller;
 * linkables are sensor colliders reported through intersection queries.
 */
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init().then(() => undefined);
  return ready;
}

export interface CharacterHandle {
  readonly id: number;
  /** Feet position. */
  x: number; y: number; z: number;
  grounded: boolean;
}

export interface SensorInfo {
  /** Opaque key the game uses to identify what was touched (linkable id). */
  key: number;
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private chars = new Map<number, { body: RAPIER.RigidBody; collider: RAPIER.Collider; h: CharacterHandle }>();
  private sensorKey = new Map<number, number>();
  private nextChar = 1;
  private radius: number;
  private halfHeight: number;

  constructor(opts: { radius: number; height: number; stepHeight: number; maxSlopeDeg: number }) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;
    this.radius = opts.radius;
    this.halfHeight = Math.max(0.05, opts.height / 2 - opts.radius);
    const c = this.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setMaxSlopeClimbAngle((opts.maxSlopeDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle(((opts.maxSlopeDeg + 5) * Math.PI) / 180);
    c.enableAutostep(opts.stepHeight, 0.15, false);
    c.enableSnapToGround(0.4);
    c.setApplyImpulsesToDynamicBodies(false);
    c.setSlideEnabled(true);
    this.controller = c;
  }

  /** Static heightfield floor. heights are (n+1)^2 samples, index = xi*(n+1)+zi, spacing = size/n. */
  addHeightfield(n: number, heights: Float32Array, size: number): void {
    const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(size / 2, 0, size / 2);
    this.world.createCollider(desc);
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0): void {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
    if (rotY) desc.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    this.world.createCollider(desc);
  }

  addCylinder(cx: number, y0: number, cz: number, radius: number, height: number): void {
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, y0 + height / 2, cz));
  }

  addSensorCylinder(key: number, cx: number, y0: number, cz: number, radius: number, height: number): void {
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, y0 + height / 2, cz).setSensor(true)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED),
    );
    this.sensorKey.set(c.handle, key);
  }

  addSensorBox(key: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0): void {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setSensor(true)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);
    if (rotY) d.setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    const c = this.world.createCollider(d);
    this.sensorKey.set(c.handle, key);
  }

  addCharacter(x: number, y: number, z: number): CharacterHandle {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.halfHeight + this.radius, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius), body);
    const h: CharacterHandle = { id: this.nextChar++, x, y, z, grounded: true };
    this.chars.set(h.id, { body, collider, h });
    return h;
  }

  removeCharacter(h: CharacterHandle): void {
    const c = this.chars.get(h.id);
    if (!c) return;
    this.world.removeRigidBody(c.body);
    this.chars.delete(h.id);
  }

  teleport(h: CharacterHandle, x: number, y: number, z: number): void {
    const c = this.chars.get(h.id);
    if (!c) return;
    const t = { x, y: y + this.halfHeight + this.radius, z };
    c.body.setTranslation(t, true);
    c.body.setNextKinematicTranslation(t);
    h.x = x; h.y = y; h.z = z;
  }

  /** Move a character by a desired delta with collision + sliding + step-up. */
  move(h: CharacterHandle, dx: number, dy: number, dz: number): void {
    const c = this.chars.get(h.id);
    if (!c) return;
    this.controller.computeColliderMovement(c.collider, { x: dx, y: dy, z: dz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.controller.computedMovement();
    const p = c.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    c.body.setNextKinematicTranslation(next);
    c.body.setTranslation(next, false);
    h.grounded = this.controller.computedGrounded();
    h.x = next.x; h.y = next.y - this.halfHeight - this.radius; h.z = next.z;
  }

  /** Update the broad phase (call after moving characters, before sensor queries). */
  step(): void {
    this.world.step();
  }

  /** Sensor keys currently overlapping a character, sorted for determinism. */
  touching(h: CharacterHandle): number[] {
    const c = this.chars.get(h.id);
    if (!c) return [];
    const out: number[] = [];
    this.world.intersectionsWithShape(c.collider.translation(), c.collider.rotation(), c.collider.shape, (other) => {
      const k = this.sensorKey.get(other.handle);
      if (k !== undefined) out.push(k);
      return true;
    }, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return out.sort((a, b) => a - b);
  }

  /** Line of sight between two points (ignores sensors and characters). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const ray = new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len });
    const hit = this.world.castRay(ray, len - 0.05, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit === null;
  }

  /** Ground height below a point (or -Infinity). */
  groundAt(x: number, z: number, fromY = 200): number {
    const ray = new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 100, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit ? fromY - hit.timeOfImpact : -Infinity;
  }

  dispose(): void {
    this.world.free();
  }
}
