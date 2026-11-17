/** Aberration (original implementation; see NOTICE): RGB channels offset along the radial direction. */
import * as TSLNS from 'three/tsl';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { vec3 } = TSLNS as any;

export const aberration = (sample: (q: N) => N, q: N, amount: N, aspect: N): N => {
  const dir: N = q.sub(0.5);
  const r2: N = dir.mul(TSLNS.vec2(aspect, 1) as N).length();
  const off: N = dir.mul(amount.mul(0.018).mul(r2.add(0.25)));
  return vec3(sample(q.add(off)).r, sample(q).g, sample(q.sub(off)).b);
};
