/** Realm registry: data for every realm with a kit, plus metadata from data/realms.json. */
import realmsJson from '../../data/realms.json' with { type: 'json' };
import type { RealmData } from './types.ts';
import esKit from './evening-suburb/kit.json' with { type: 'json' };
import esRules from './evening-suburb/rules.json' with { type: 'json' };
import esFixed from './evening-suburb/fixed.json' with { type: 'json' };
import pcKit from './prism-cathedral/kit.json' with { type: 'json' };
import pcRules from './prism-cathedral/rules.json' with { type: 'json' };
import pcFixed from './prism-cathedral/fixed.json' with { type: 'json' };
import gdKit from './glyph-desert/kit.json' with { type: 'json' };
import gdRules from './glyph-desert/rules.json' with { type: 'json' };
import gdFixed from './glyph-desert/fixed.json' with { type: 'json' };
import { flatData } from './lantern-flat/flat.ts';
import { specialData, SPECIAL_REALMS } from './special/special.ts';

export interface RealmMeta {
  id: string; index: number; name: string; quadrant: string; chart: [number, number]; tags: string[]; key: string; implemented: boolean;
}
export const REALM_META: RealmMeta[] = realmsJson.realms as RealmMeta[];
export const META = new Map(REALM_META.map((r) => [r.id, r]));

export const REALM_DATA: Record<string, RealmData> = {
  'evening-suburb': { kit: esKit, rules: esRules, fixed: esFixed } as unknown as RealmData,
  'prism-cathedral': { kit: pcKit, rules: pcRules, fixed: pcFixed } as unknown as RealmData,
  'glyph-desert': { kit: gdKit, rules: gdRules, fixed: gdFixed } as unknown as RealmData,
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
