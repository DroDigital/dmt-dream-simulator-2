/** Per-pane Glyph Suite uniforms (every GlyphStyle field is a uniform). */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
/* eslint-disable @typescript-eslint/no-explicit-any */
const { uniform, uniformArray } = TSLNS as any;

export const MAX_RIPPLES = 8;

export function makeGlyphUniforms() {
  return {
    mode: uniform(0), modeB: uniform(0), modeMix: uniform(0),
    rampN: uniform(10), rampNB: uniform(10), row: uniform(0), rowB: uniform(0),
    cellSizes: uniform(new THREE.Vector3(12, 8, 6)), depthCells: uniform(1), depthNear: uniform(6), depthFar: uniform(40),
    camNear: uniform(0.08), camFar: uniform(900),
    edgeThreshold: uniform(0.35), edgeDepthWeight: uniform(1), edgeNormalWeight: uniform(0.8), edgeLumaWeight: uniform(0.5), edgeThickness: uniform(1),
    backdropMode: uniform(0), backdropStrength: uniform(0.35), backdropBlur: uniform(2),
    colourMode: uniform(0), colourSaturation: uniform(1.1), colourBoost: uniform(1.4),
    colA: uniform(new THREE.Color('#F6EFE4')), colB: uniform(new THREE.Color('#120E16')), phosphorCol: uniform(new THREE.Color('#7CFF6A')),
    black: uniform(0.03), white: uniform(0.85), gamma: uniform(0.8), contrast: uniform(0.3),
    coverage: uniform(1), invert: uniform(0), shadowLift: uniform(1),
    hysteresis: uniform(0.06), holdFrames: uniform(3), reset: uniform(1), dt: uniform(1 / 60),
    windSpeed: uniform(0), windDir: uniform(new THREE.Vector2(1, 0)), ripplesOn: uniform(1),
    ripples: uniformArray(new Array(MAX_RIPPLES).fill(0).map(() => new THREE.Vector4(0, 0, -99, 0)), 'vec4'),
    settle: uniform(0), settleRadius: uniform(0.06), scramble: uniform(1), gazeOn: uniform(1),
    aberration: uniform(0), fluted: uniform(0),
    opacity: uniform(1), scanlines: uniform(0), drift: uniform(0), time: uniform(0),
    size: uniform(new THREE.Vector2(1, 1)), aspect: uniform(16 / 9),
    /** Debug: 0 off, 1/2/3 force band 0/1/2, 4 show cell colour, 5 show history brightness. */
    debug: uniform(0),
  };
}
export type GlyphUniforms = ReturnType<typeof makeGlyphUniforms>;

export const BACKDROP_IDS = { blurred: 0, black: 1, original: 2, transparent: 3 } as const;
export const COLOUR_IDS = { full: 0, mono: 1, duotone: 2, palette: 3, phosphor: 4 } as const;
