/**
 * Lo-fi materials (§9.2 steps 2): clip-space vertex snap to a 240x135 grid, affine (screen-linear) UVs,
 * lucidity-driven vertex jitter, hemisphere + sun lighting, distance fog, and an emissive MRT output
 * that feeds the full-resolution light layer.
 *
 * Shared uniforms are per pane: the View writes them right before each pane's scene pass.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const {
  Fn, attribute, uniform, vec2, vec3, vec4, float, uv, varying, modelViewProjection, positionView, positionLocal, normalWorld, texture, mix, max, dot, smoothstep, sin, mrt, abs, clamp,
} = TSLNS as any;

export const U = {
  time: uniform(0),
  snapGrid: uniform(new THREE.Vector2(240, 135)),
  snapStrength: uniform(1),
  jitter: uniform(0.6),
  fogColor: uniform(new THREE.Color('#2a2440')),
  fogNear: uniform(25),
  fogFar: uniform(110),
  sky: uniform(new THREE.Color('#ffd0b0')),
  ground: uniform(new THREE.Color('#4a3a5a')),
  sunDir: uniform(new THREE.Vector3(0.4, 0.5, 0.3).normalize()),
  sunColor: uniform(new THREE.Color('#ffb080')),
  emissiveGain: uniform(1.4),
  /** Glyph/peripheral "veil": dims everything a little when blinking. */
  exposure: uniform(1),
  /** Highlight shimmer: world position + radius + colour of the latest notice. */
  shimmerPos: uniform(new THREE.Vector3(0, -999, 0)),
  shimmerColor: uniform(new THREE.Color('#ffffff')),
  shimmerT: uniform(0),
  /** Aware tint target: object rims in destination key colour. */
  tintPos: uniform(new THREE.Vector3(0, -999, 0)),
  tintRadius: uniform(0),
  tintColor: uniform(new THREE.Color('#ffffff')),
  /** Interact target hand-glow. */
  handPos: uniform(new THREE.Vector3(0, -999, 0)),
  handRadius: uniform(0),
  handColor: uniform(new THREE.Color('#ffffff')),
  /** World-space fold (paper night / origami vertex fold) strength. */
  fold: uniform(0),
};

/** Snapped + jittered clip position. */
export const snappedVertex: N = Fn(() => {
  const clip = (modelViewProjection as N).toVar();
  const ndc = clip.xy.div(clip.w);
  const g = U.snapGrid.mul(0.5);
  const snapped = ndc.mul(g).add(0.5).floor().div(g);
  const p = positionLocal as N;
  const wob = vec2(
    sin(U.time.mul(2.3).add(p.x.mul(5.1)).add(p.y.mul(3.7))),
    sin(U.time.mul(1.9).add(p.z.mul(4.3)).add(p.x.mul(2.9))),
  ).mul(U.jitter).div(g);
  const xy = mix(ndc, snapped, U.snapStrength).add(wob).mul(clip.w);
  return vec4(xy, clip.z, clip.w);
})();

// affine UV: interpolate uv*w and w perspective-correctly, divide per fragment
const vUvW: N = varying(vec3((uv() as N).mul((modelViewProjection as N).w), (modelViewProjection as N).w), 'vAffine');
export const affineUV: N = vUvW.xy.div(vUvW.z);

export interface LofiOptions {
  detail?: THREE.Texture | null;
  instanced?: boolean;
  transparent?: boolean;
  /** Extra emissive multiplier for the whole material. */
  glow?: number;
  /** Disable fog (sky, window views). */
  noFog?: boolean;
  doubleSide?: boolean;
}

/** Hidden-instance and tint attribute: rgb tint, a = extra emissive. */
export const ITINT = 'itint';

export function makeLofiMaterial(opts: LofiOptions = {}): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = opts.doubleSide === false ? THREE.FrontSide : THREE.DoubleSide;
  m.fog = false;
  m.transparent = !!opts.transparent;
  m.depthWrite = !opts.transparent;
  m.vertexNode = snappedVertex;

  const vcol: N = attribute('color', 'vec4');
  const tint: N = opts.instanced ? attribute(ITINT, 'vec4') : vec4(1, 1, 1, 0);
  const detail: N = opts.detail ? (texture(opts.detail, affineUV) as N).rgb : vec3(1);
  const base: N = vcol.rgb.mul(tint.rgb).mul(detail);
  const n: N = normalWorld;
  const hemi: N = mix(U.ground, U.sky, n.y.mul(0.5).add(0.5));
  const sun: N = U.sunColor.mul(max(dot(n, U.sunDir), 0));
  const lit: N = base.mul(hemi.mul(0.62).add(sun.mul(0.55))).mul(U.exposure);
  const emAmt: N = vcol.a.add(tint.a).mul(U.emissiveGain).mul(opts.glow ?? 1);
  const em: N = base.mul(emAmt).add(base.mul(0.02)); // nothing fully black
  // world-space highlight rings (shimmer on notice, Aware tint, interact hand-glow)
  const wp: N = (positionView as N);
  void wp;
  const dist: N = (positionView as N).length();
  const fog: N = opts.noFog ? float(0) : smoothstep(U.fogNear, U.fogFar, dist);
  const colour: N = mix(lit.add(em), U.fogColor, fog);
  m.colorNode = vec4(colour, opts.transparent ? clamp(vcol.a.add(0.35), 0.35, 0.9) : 1);
  m.mrtNode = mrt({ emissive: vec4(em.mul(float(1).sub(fog)), 1) }) as N;
  void abs;
  return m;
}

/** Highlight material variant: used by overlay meshes (hand-glow outline, shimmer, tint rim). */
export function makeGlowMaterial(color: THREE.ColorRepresentation, strength = 1): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const c = uniform(new THREE.Color(color));
  const s = uniform(strength);
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.side = THREE.BackSide;
  m.vertexNode = snappedVertex;
  m.colorNode = vec4((c as N).mul(s), s.mul(0.6));
  m.mrtNode = mrt({ emissive: vec4((c as N).mul(s), 1) }) as N;
  (m.userData as Record<string, unknown>).color = c;
  (m.userData as Record<string, unknown>).strength = s;
  return m;
}

/** Generate a 128 px detail texture (paper fibre / stone / sand / plaster), nearest filtered. */
export function makeDetailTexture(kind: 'paper' | 'stone' | 'sand' | 'tatami' | 'asphalt', seed = 1): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0.92 + rnd() * 0.12;
    if (kind === 'paper') v *= 0.96 + 0.06 * Math.sin(x * 0.9 + Math.sin(y * 0.13) * 4) * (rnd() > 0.7 ? 1 : 0.3);
    if (kind === 'stone') v *= (x % 32 < 1 || y % 32 < 1) ? 0.78 : 0.98 + 0.04 * Math.sin(x * 0.2 + y * 0.31);
    if (kind === 'sand') v *= 0.95 + 0.07 * Math.sin(x * 0.35 + Math.sin(y * 0.08) * 3);
    if (kind === 'tatami') v *= 0.93 + 0.08 * Math.sin(y * 1.6) * (x % 64 < 2 ? 0.2 : 1);
    if (kind === 'asphalt') v *= rnd() > 0.93 ? 1.15 : 0.95;
    // 8 levels so the texture itself looks quantised
    v = Math.round(v * 16) / 16;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.min(255, v * 248);
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
