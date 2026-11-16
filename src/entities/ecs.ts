/**
 * Entity data (bitecs). Components are plain SoA stores; systems live in their own modules.
 * Entities: Lanternfolk, motif sightings (kite, train, lantern woman), event actors, the Watcher.
 */
import { addComponent, addEntity, createWorld, query, removeEntity } from 'bitecs';

export const Pos = { x: [] as number[], y: [] as number[], z: [] as number[] };
export const Vel = { x: [] as number[], y: [] as number[], z: [] as number[] };
export const Heading = { yaw: [] as number[] };
/** Owning visit id. */
export const InVisit = { id: [] as number[] };
/** Wander parameters for procedural motion. */
export const Wander = { phase: [] as number[], speed: [] as number[], homeX: [] as number[], homeZ: [] as number[], radius: [] as number[] };
/** Bitmask of dreamers who have touched / greeted this entity. */
export const Touched = { mask: [] as number[] };
export const Lanternfolk = { hue: [] as number[], size: [] as number[] };
export const Motif = { kind: [] as number[], t: [] as number[], anomaly: [] as number[] };
/** A partner's silhouette appearing in this realm (co-op echo). */
export const Echo = { partner: [] as number[], anomaly: [] as number[] };
export const Actor = { script: [] as number[], t: [] as number[], dur: [] as number[], anomaly: [] as number[] };

export const MOTIF_KINDS = ['kite', 'phone', 'lantern-woman', 'train', 'moons'] as const;
export type MotifKind = (typeof MOTIF_KINDS)[number];

export function createEcs() {
  return createWorld();
}
export type EcsWorld = ReturnType<typeof createEcs>;

export function spawn(world: EcsWorld, visitId: number, x: number, y: number, z: number, ...components: object[]): number {
  const eid = addEntity(world);
  for (const c of [Pos, Vel, Heading, InVisit, Touched, ...components]) addComponent(world, eid, c);
  Pos.x[eid] = x; Pos.y[eid] = y; Pos.z[eid] = z;
  Vel.x[eid] = 0; Vel.y[eid] = 0; Vel.z[eid] = 0;
  Heading.yaw[eid] = 0;
  InVisit.id[eid] = visitId;
  Touched.mask[eid] = 0;
  return eid;
}

export function despawnVisit(world: EcsWorld, visitId: number): void {
  for (const eid of [...query(world, [InVisit])]) if (InVisit.id[eid] === visitId) removeEntity(world, eid);
}

export function inVisit(world: EcsWorld, visitId: number, comps: object[]): number[] {
  const out: number[] = [];
  for (const eid of query(world, [InVisit, ...comps])) if (InVisit.id[eid] === visitId) out.push(eid);
  return out.sort((a, b) => a - b);
}
