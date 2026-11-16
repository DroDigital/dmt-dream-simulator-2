import tuningJson from '../../data/tuning.json' with { type: 'json' };

export type Tuning = typeof tuningJson;
/** Live tuning object. Mutated in place by the dev Tweakpane panel (hot reload). */
export const tuning: Tuning = structuredClone(tuningJson);

export const DT = 1 / tuning.sim.hz;
export const DEG = Math.PI / 180;

export function breathBase(realm: string): number {
  const b = tuning.breath.base as Record<string, number>;
  return b[realm] ?? b.default;
}
