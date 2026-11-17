/**
 * Hand-built special realms (no WFC):
 *  - veiled-room: the hidden room behind the Watcher's doorway (Veiled content, the best souvenirs)
 *  - chorus-room: the co-op room reached by a chorus link
 *  - vision: a dark void stage for Vision set pieces
 */
import type { Layout, PlacedProp, RealmData } from '../types.ts';
import kit from './kit.json' with { type: 'json' };
import rules from './rules.json' with { type: 'json' };
import fixed from './fixed.json' with { type: 'json' };

export const specialData = { kit, rules, fixed } as unknown as RealmData;
export const SPECIAL_REALMS = ['veiled-room', 'chorus-room', 'vision', 'threshold', 'the-thirteenth'] as const;
export type SpecialRealm = (typeof SPECIAL_REALMS)[number];

function room(realm: SpecialRealm, floorVariant: number, walls: boolean, props: PlacedProp[]): Layout {
  const G = 8;
  const cells: number[] = [];
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
    const edge = x === 0 || z === 0 || x === G - 1 || z === G - 1;
    cells.push(walls && edge ? 1 : floorVariant);
  }
  return {
    realm, seed: 0, attempt: 0, grid: G, cell: 2, levelHeight: 2,
    variants: [{ id: 'veil-floor', rot: 0 }, { id: 'veil-wall', rot: 0 }, { id: 'void-floor', rot: 0 }],
    cells, props,
    spawns: [{ x: 8, y: 0, z: 11, yaw: 0 }, { x: 6.5, y: 0, z: 11, yaw: 0 }, { x: 9.5, y: 0, z: 11, yaw: 0 }, { x: 8, y: 0, z: 12.5, yaw: 0 }],
    landmark: { x: 8, y: 0, z: 6 }, quiet: { x: 8, y: 0, z: 8 },
    metrics: { walkableArea: 144, linkableCount: 0, meanDistToLinkable: 0, maxDistToLinkable: 0, heightVariance: 0 },
  };
}

const p = (id: string, x: number, z: number, y = 0, extra: Partial<PlacedProp> = {}): PlacedProp => {
  const def = kit.props.find((d) => d.id === id)!;
  return { id, x, y: y + (('hover' in def ? (def as { hover?: number }).hover : 0) ?? 0), z, rot: 0, scale: 1, tags: def.tags as PlacedProp['tags'], components: { ...def.components }, radius: def.radius, height: def.height, ...extra };
};

export function buildSpecialLayout(realm: SpecialRealm): Layout {
  if (realm === 'veiled-room') {
    return room(realm, 0, true, [
      p('pedestal', 5, 6), p('pedestal', 8, 5), p('pedestal', 11, 6),
      p('moon-pebble', 5, 6), p('lantern-shard', 8, 5), p('vhs-tape', 11, 6),
    ]);
  }
  if (realm === 'chorus-room') return room(realm, 0, true, [p('chorus-bell', 8, 6)]);
  if (realm === 'threshold') return room(realm, 2, false, [p('threshold-door', 8, 4)]);
  if (realm === 'the-thirteenth') return room(realm, 0, true, [p('star-orrery', 8, 6), p('pedestal', 5, 7), p('pedestal', 11, 7), p('constellation-piece', 5, 7), p('constellation-piece', 11, 7)]);
  return room(realm, 2, false, []);
}
