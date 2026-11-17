/** Realm registry: data for every realm with a kit, plus metadata from data/realms.json. */
import realmsJson from '../../data/realms.json' with { type: 'json' };
import type { RealmData } from './types.ts';
import { flatData } from './lantern-flat/flat.ts';
import { specialData, SPECIAL_REALMS } from './special/special.ts';

export interface RealmMeta {
  id: string; index: number; name: string; quadrant: string; chart: [number, number]; tags: string[]; key: string; implemented: boolean;
}
export const REALM_META: RealmMeta[] = realmsJson.realms as RealmMeta[];
export const META = new Map(REALM_META.map((r) => [r.id, r]));

// every realm folder with kit/rules/fixed JSON is a dream realm
const kits = import.meta.glob('./*/kit.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const ruless = import.meta.glob('./*/rules.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixeds = import.meta.glob('./*/fixed.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const NON_DREAM = new Set(['lantern-flat', 'special']);
const dreamData: Record<string, RealmData> = {};
for (const path of Object.keys(kits).sort()) {
  const realm = path.split('/')[1];
  if (NON_DREAM.has(realm)) continue;
  dreamData[realm] = { kit: kits[path], rules: ruless[path.replace('kit.json', 'rules.json')], fixed: fixeds[path.replace('kit.json', 'fixed.json')] } as RealmData;
}

export const REALM_DATA: Record<string, RealmData> = {
  ...dreamData,
  'lantern-flat': flatData,
  ...Object.fromEntries(SPECIAL_REALMS.map((r) => [r, specialData])),
};

/** Realms a dream can link into (have kits). The Flat is not a destination. */
export const DREAM_REALMS: string[] = Object.keys(REALM_DATA).filter((r) => r !== 'lantern-flat' && !(SPECIAL_REALMS as readonly string[]).includes(r));
export { SPECIAL_REALMS };

export const QUADRANT_START = realmsJson.quadrantStart as Record<string, string>;
export const SLICE_FALLBACK = realmsJson.sliceFallback as Record<string, string>;

export function resolveRealm(id: string): string {
  if (REALM_DATA[id]) return id;
  return SLICE_FALLBACK[id] ?? DREAM_REALMS[0];
}
