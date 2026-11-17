/** Data types shared by the realm generator (tools/realmgen), the in-game loader and the validator. */

export type Tag = 'water' | 'light' | 'paper' | 'glass' | 'flesh' | 'glyph' | 'machine';
export const ALL_TAGS: readonly Tag[] = ['water', 'light', 'paper', 'glass', 'flesh', 'glyph', 'machine'];

/** Mesh descriptor: either a procedural builder name with params, or an imported GLB from assets/built. */
export interface MeshRef {
  proc?: string;
  glb?: string;
  params?: Record<string, number | string | boolean>;
}

export type Floor =
  | { kind: 'flat'; level: number }
  /** Ramp rising from level `from` at side `low` to level `to` at the opposite side. */
  | { kind: 'ramp'; from: number; to: number; low: Dir }
  /** Not walkable at all (a building, a pillar block, deep water). `height` in metres for colliders. */
  | { kind: 'solid'; level: number; height: number };

export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export interface Components {
  linkable?: boolean;
  anomaly?: boolean;
  carryable?: boolean;
  veiled?: boolean;
  chorus?: boolean;
  phone?: boolean;
  lanternfolk?: boolean;
}

export interface TileDef {
  id: string;
  weight: number;
  /** Sockets in N, E, S, W order. Two edges may touch if their sockets are equal or listed in rules.compatible. */
  sockets: [string, string, string, string];
  /** Generate rotated variants: 1 (none), 2 (0/90) or 4 (all). */
  rotations?: 1 | 2 | 4;
  floor: Floor;
  /** Blocked footprint inside the cell in local metres [x0, z0, x1, z1] (0..cell), with height. */
  footprints?: { rect: [number, number, number, number]; height: number }[];
  tags?: Tag[];
  components?: Components;
  mesh?: MeshRef;
  /** Spawn points may be placed on this tile. */
  spawnable?: boolean;
  /** Props may be scattered on this tile. */
  scatter?: boolean;
}

export interface PropDef {
  id: string;
  tags: Tag[];
  components: Components;
  /** Collision radius (m) and height (m). radius 0 = not solid. */
  radius: number;
  height: number;
  /** Poisson-disk minimum spacing (m). */
  spacing: number;
  /** Expected count per 100 m² of eligible floor. */
  density: number;
  /** Tile ids this prop may sit on. */
  on: string[];
  mesh?: MeshRef;
  /** Hover height above the floor (floating stalls, lanterns). */
  hover?: number;
  scale?: [number, number];
}

export interface KitDef {
  realm: string;
  /** Grid cells along each axis. Realm size = grid * cell. */
  grid: number;
  cell: number;
  levelHeight: number;
  linkTags: Tag[];
  tiles: TileDef[];
  props: PropDef[];
}

export interface DensityRule {
  /** Prop id whose density is boosted. */
  prop: string;
  /** Boost when within `radius` of any placed prop with this id. */
  near: string;
  radius: number;
  boost: number;
}

export interface RulesDef {
  realm: string;
  compatible: [string, string][];
  /** Per-layout weight multiplier range for tiles, giving seed-to-seed variation. */
  weightJitter?: Record<string, [number, number]>;
  density?: DensityRule[];
  /** Solid wildcard-socket tile filling cells beyond the realm's seeded irregular extent. */
  border?: string;
  /** Range of the realm's walkable extent as a fraction of half the grid (seed-to-seed variation). */
  extent?: [number, number];
  spawnCount: number;
}

export interface FixedPlacement {
  tile: string;
  cell: [number, number];
  rot?: number;
  /** Neighbours within this many cells are forced to `clearTile`. */
  clear?: number;
  clearTile?: string;
  prop?: string;
}

export interface FixedDef {
  realm: string;
  landmark: FixedPlacement;
  quiet: FixedPlacement;
}

export interface PlacedProp {
  id: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  tags: Tag[];
  components: Components;
  radius: number;
  height: number;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface LayoutMetrics {
  walkableArea: number;
  linkableCount: number;
  meanDistToLinkable: number;
  maxDistToLinkable: number;
  heightVariance: number;
}

export interface Layout {
  realm: string;
  seed: number;
  attempt: number;
  grid: number;
  cell: number;
  levelHeight: number;
  /** Variant table: tile id + rotation (quarter turns clockwise). */
  variants: { id: string; rot: number }[];
  /** Variant index per cell, row-major (z * grid + x). */
  cells: number[];
  props: PlacedProp[];
  spawns: Spawn[];
  landmark: { x: number; y: number; z: number };
  quiet: { x: number; y: number; z: number };
  metrics: LayoutMetrics;
}

export interface RealmData {
  kit: KitDef;
  rules: RulesDef;
  fixed: FixedDef;
}
