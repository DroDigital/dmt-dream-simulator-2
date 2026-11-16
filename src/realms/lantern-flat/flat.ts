/** The Lantern Flat is hand-authored (no WFC): a small 7th-floor apartment, 8 x 8 m inside. */
import type { Layout, PlacedProp, RealmData } from '../types.ts';
import kit from './kit.json' with { type: 'json' };
import rules from './rules.json' with { type: 'json' };
import fixed from './fixed.json' with { type: 'json' };

export const flatData = { kit, rules, fixed } as unknown as RealmData;

/** Room slots (§3.9). Positions are souvenir anchor points. */
export interface RoomSlot { id: string; kind: 'sill' | 'shelf' | 'bedside' | 'floor' | 'hook' | 'under'; x: number; y: number; z: number }
export const ROOM_SLOTS: RoomSlot[] = [
  { id: 'sill', kind: 'sill', x: 6, y: 1.05, z: 2.35 },
  { id: 'shelf-0', kind: 'shelf', x: 2.45, y: 1.25, z: 4.6 },
  { id: 'shelf-1', kind: 'shelf', x: 2.45, y: 1.25, z: 6.0 },
  { id: 'shelf-2', kind: 'shelf', x: 2.45, y: 1.75, z: 5.3 },
  { id: 'bedside', kind: 'bedside', x: 4.9, y: 0.25, z: 9.0 },
  { id: 'floor-0', kind: 'floor', x: 7.0, y: 0.05, z: 6.5 },
  { id: 'floor-1', kind: 'floor', x: 5.2, y: 0.05, z: 5.6 },
  { id: 'hook', kind: 'hook', x: 9.55, y: 1.9, z: 6.0 },
  { id: 'under', kind: 'under', x: 6.5, y: 0.02, z: 8.9 },
];

/** Futon centres (one per player). Lying down = standing on your futon and holding Lie down. */
export const FUTONS = [
  { x: 3.6, z: 8.8 }, { x: 5.6, z: 8.8 }, { x: 7.4, z: 8.8 }, { x: 8.9, z: 7.0 },
];

export function buildFlatLayout(): Layout {
  const G = 6;
  const cells: number[] = [];
  // variants: 0 tatami, 1 wall, 2 window
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
    const edge = x === 0 || z === 0 || x === G - 1 || z === G - 1;
    cells.push(!edge ? 0 : z === 0 && x >= 2 && x <= 3 ? 2 : 1);
  }
  const prop = (id: string, x: number, y: number, z: number, rot = 0, radius = 0, height = 0.3): PlacedProp => ({
    id, x, y, z, rot, scale: 1, tags: [], components: {}, radius, height,
  });
  const props: PlacedProp[] = [
    ...FUTONS.map((f, i) => prop('futon', f.x, 0, f.z, i === 3 ? Math.PI / 2 : 0)),
    prop('paper-lantern', 4.2, 2.2, 4.2), prop('paper-lantern', 7.8, 2.25, 4.6), prop('paper-lantern', 6.0, 2.15, 7.6),
    prop('shelf', 2.3, 0, 5.3, Math.PI / 2),
    prop('low-table', 6.2, 0, 5.4, 0, 0.55, 0.4),
    prop('clock', 9.6, 2.1, 4.0, -Math.PI / 2),
    prop('ceiling', 0, 0, 0),
  ];
  return {
    realm: 'lantern-flat', seed: 0, attempt: 0, grid: G, cell: 2, levelHeight: 2,
    variants: [{ id: 'tatami', rot: 0 }, { id: 'wall', rot: 0 }, { id: 'window', rot: 0 }],
    cells, props,
    spawns: [{ x: 5, y: 0, z: 5.5, yaw: Math.PI }, { x: 6.5, y: 0, z: 6.5, yaw: Math.PI }, { x: 4, y: 0, z: 6.8, yaw: Math.PI }, { x: 7.8, y: 0, z: 5.5, yaw: Math.PI }],
    landmark: { x: 5, y: 0, z: 5 }, quiet: { x: 7, y: 0, z: 7 },
    metrics: { walkableArea: 64, linkableCount: 0, meanDistToLinkable: 0, maxDistToLinkable: 0, heightVariance: 0 },
  };
}
