/**
 * Living text (§3.7): wind, footstep ripples, gaze settle, drifting letters. Shader helpers + the CPU
 * side that turns dreamer footfalls into screen-space ripples and tracks gaze stillness.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import type { GlyphUniforms } from './uniforms.ts';
import { MAX_RIPPLES } from './uniforms.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { fract, sin, dot, vec2, floor, mix, float, abs, select, Loop } = TSLNS as any;

export const hash21 = (p: N): N => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
export const vnoise = (p: N): N => {
  const i: N = floor(p), f: N = fract(p);
  const u: N = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(hash21(i), hash21(i.add(vec2(1, 0))), u.x), mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), u.x), u.y);
};

/** Wind: glyph index offset within +-2 ramp steps by scrolling noise. */
export const windOffset = (cell: N, g: GlyphUniforms): N => {
  const n: N = vnoise(cell.mul(0.35).sub(g.windDir.mul(g.time.mul(g.windSpeed).mul(3))));
  return floor(n.sub(0.5).mul(4.99).mul(select(g.windSpeed.greaterThan(0.001), float(1), float(0))).add(0.5));
};

/** 1 when the cell lies on an expanding footstep ring (0 -> 6 cells over 0.6 s). */
export const rippleMask = (cellUV: N, cellPx: N, g: GlyphUniforms): N => {
  const hit: N = float(0).toVar();
  Loop(MAX_RIPPLES, ({ i }: { i: N }) => {
    const r: N = g.ripples.element(i);
    const age: N = g.time.sub(r.z);
    const d: N = cellUV.sub(r.xy).mul(g.size).div(cellPx).length();
    const rad: N = age.div(0.6).mul(6);
    const on: N = age.greaterThan(0).and(age.lessThan(0.6)).and(abs(d.sub(rad)).lessThan(1.1));
    hit.assign(select(on, float(1), hit));
  });
  return hit.mul(g.ripplesOn).mul(g.scramble);
};

/** CPU side: footfalls -> ripples; camera stillness -> gaze settle. */
export class LivingText {
  private last = new Map<number, { x: number; z: number }>();
  private slot = 0;
  private stillT = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  settle = 0;

  footsteps(dreamers: { index: number; x: number; y: number; z: number }[], camera: THREE.Camera, g: GlyphUniforms, time: number): void {
    const arr = (g.ripples as N).array as THREE.Vector4[];
    for (const d of dreamers) {
      const prev = this.last.get(d.index);
      if (!prev) { this.last.set(d.index, { x: d.x, z: d.z }); continue; }
      if (Math.hypot(d.x - prev.x, d.z - prev.z) < 0.75) continue;
      this.last.set(d.index, { x: d.x, z: d.z });
      const p = new THREE.Vector3(d.x, d.y + 0.02, d.z).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
      arr[this.slot % MAX_RIPPLES].set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, time, 1);
      this.slot++;
    }
  }

  gaze(yaw: number, pitch: number, dt: number): number {
    const v = (Math.abs(yaw - this.lastYaw) + Math.abs(pitch - this.lastPitch)) / Math.max(dt, 1e-3);
    this.lastYaw = yaw; this.lastPitch = pitch;
    this.stillT = v < 0.15 ? this.stillT + dt : 0;
    const target = this.stillT >= 0.5 ? 1 : 0;
    this.settle += (target - this.settle) * (1 - Math.exp(-dt * 3));
    return this.settle;
  }
}
