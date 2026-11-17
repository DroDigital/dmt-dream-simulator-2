/**
 * Fluted Glass, ported to TSL from @paper-design/shaders 0.0.82 (Apache-2.0, see NOTICE):
 * vertical lens strips with a refraction offset per strip, inner shadow and edge highlight, slight blur.
 * Reduced to the "lines" pattern with distortion shape 1.
 */
import * as TSLNS from 'three/tsl';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { fract, floor, pow, mix, smoothstep, vec2, vec3, float, abs, clamp, select } = TSLNS as any;

export const flutedGlass = (sample: (q: N) => N, q: N, amount: N, size: N): N => {
  const patternSize: N = mix(float(200), float(5), float(0.82)); // ~40 strips across
  const u: N = q.x.sub(0.5).mul(patternSize);
  const x: N = fract(u);
  // distortion shape 1 (from the original): -pow(1.5x, 3) + 0.5, faded at strip edges
  const aa: N = float(0.2);
  const fadeX: N = smoothstep(0, aa, x).mul(smoothstep(1, float(1).sub(aa), x));
  const dist: N = mix(float(0.5), pow(x.mul(1.5), 3).negate().add(0.5), fadeX).mul(amount.mul(3)).mul(0.5);
  const qx: N = floor(u).add(x.add(dist)).div(patternSize).add(0.5);
  const q2: N = vec2(mix(q.x, qx, select(amount.greaterThan(0.001), float(1), float(0))), q.y);
  const texel: N = vec2(0, 1).div(size.y);
  const blur: N = amount.mul(3);
  const img: N = sample(q2).add(sample(q2.add(texel.mul(blur)))).add(sample(q2.sub(texel.mul(blur)))).mul(1 / 3);
  const shadows: N = clamp(pow(x, 1.3).mul(amount).mul(amount), 0, 1);
  const hl: N = float(1).sub(smoothstep(0, 0.04, x).mul(smoothstep(1, 0.96, x))).mul(amount).mul(0.6);
  void abs;
  return img.mul(float(1).sub(shadows.mul(0.45))).add(vec3(hl));
};
