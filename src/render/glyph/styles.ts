/**
 * GlyphStyle (M2G §4): every field is a uniform, so styles blend and animate without recompiling.
 * Pure helpers here mirror the shader math and are unit-tested.
 */
export type GlyphModeId = 'ascii' | 'braille' | 'blocks';
export type BackdropMode = 'blurred' | 'black' | 'original' | 'transparent';
export type ColourMode = 'full' | 'mono' | 'duotone' | 'palette' | 'phosphor';

export interface GlyphStyle {
  id?: string;
  mode: GlyphModeId;
  font: string; ramp: string; cellPx: number; depthCells: boolean;
  depthNear: number; depthFar: number; cellSizes: [number, number, number];
  edgeThreshold: number; edgeDepthWeight: number; edgeNormalWeight: number;
  edgeLumaWeight: number; edgeThickness: 1 | 2;
  backdropMode: BackdropMode;
  backdropStrength: number; backdropBlur: number;
  colourMode: ColourMode;
  colourSaturation: number; colourBoost: number;
  /** Key colours for mono / duotone (hex). Phosphor uses `phosphor`. */
  colourA?: string; colourB?: string; phosphor?: 'green' | 'amber';
  black: number; white: number; gamma: number; contrast: number;
  coverage: number; invert: boolean; shadowLift: boolean;
  hysteresis: number; holdFrames: number;
  wind: { speed: number; dir: [number, number] } | null;
  ripples: boolean; gazeSettle: boolean;
  paper: { aberration: number; flutedGlass: number };
  glyphOpacity: number;
  /** Optional scanlines (tv-static). */
  scanlines?: number;
  /** Drifting letters density (Glyph Desert sky). */
  drift?: number;
}

export const DEFAULT_STYLE: GlyphStyle = {
  mode: 'ascii', font: 'VT323', ramp: ' .:-=+*#%@', cellPx: 8, depthCells: true,
  depthNear: 6, depthFar: 40, cellSizes: [12, 8, 6],
  edgeThreshold: 0.35, edgeDepthWeight: 1, edgeNormalWeight: 0.8, edgeLumaWeight: 0.5, edgeThickness: 1,
  backdropMode: 'blurred', backdropStrength: 0.35, backdropBlur: 2,
  colourMode: 'full', colourSaturation: 1.1, colourBoost: 1.4,
  black: 0.03, white: 0.85, gamma: 0.8, contrast: 0.3,
  coverage: 1, invert: false, shadowLift: true,
  hysteresis: 0.06, holdFrames: 3,
  wind: null, ripples: true, gazeSettle: true,
  paper: { aberration: 0, flutedGlass: 0 },
  glyphOpacity: 1,
};

/** Brightness remap: l' = pow(clamp((l-black)/(white-black)), gamma), then an S-curve with contrast; optional invert. */
export function remapBrightness(l: number, s: Pick<GlyphStyle, 'black' | 'white' | 'gamma' | 'contrast' | 'invert'>): number {
  let x = Math.min(1, Math.max(0, (l - s.black) / Math.max(1e-4, s.white - s.black)));
  x = Math.pow(x, s.gamma);
  const k = 1 + s.contrast * 3;
  const a = Math.pow(x, k), b = Math.pow(1 - x, k);
  x = a + b > 0 ? a / (a + b) : x;
  return s.invert ? 1 - x : x;
}

/** Stable per-cell hash in [0,1) (identical formula in the shader). */
export function coverageHash(cx: number, cy: number): number {
  const v = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Cell draws a glyph when its hash is below the coverage. */
export function cellCovered(cx: number, cy: number, coverage: number): boolean {
  return coverageHash(cx, cy) < coverage;
}

/**
 * Edge direction quantisation: gradient (gx, gy) in y-up screen space -> edge direction (gradient + 90°)
 * -> 4 bins: 0 '_' horizontal, 1 '/' rising, 2 '|' vertical, 3 '\' falling.
 */
export function edgeBin(gx: number, gy: number): number {
  let a = Math.atan2(gy, gx) + Math.PI / 2; // edge direction
  a = ((a % Math.PI) + Math.PI) % Math.PI;   // fold to [0, pi)
  return Math.round(a / (Math.PI / 4)) % 4;
}

const NUMERIC: (keyof GlyphStyle)[] = [
  'cellPx', 'depthNear', 'depthFar', 'edgeThreshold', 'edgeDepthWeight', 'edgeNormalWeight', 'edgeLumaWeight',
  'backdropStrength', 'backdropBlur', 'colourSaturation', 'colourBoost', 'black', 'white', 'gamma', 'contrast',
  'coverage', 'hysteresis', 'holdFrames', 'glyphOpacity', 'scanlines', 'drift',
];

/**
 * Interpolate numeric fields; discrete fields (mode, colour mode, backdrop) switch at t = 0.5.
 * The pass also crossfades the two modes' glyph masks with `modeMix = t` (render both, mix).
 */
export function blendStyles(a: GlyphStyle, b: GlyphStyle, t: number): GlyphStyle {
  const out = { ...(t < 0.5 ? a : b) } as GlyphStyle;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  for (const k of NUMERIC) {
    const x = a[k] as number | undefined, y = b[k] as number | undefined;
    if (typeof x === 'number' && typeof y === 'number') (out as unknown as Record<string, number>)[k] = lerp(x, y);
  }
  out.cellSizes = [0, 1, 2].map((i) => lerp(a.cellSizes[i], b.cellSizes[i])) as [number, number, number];
  out.paper = { aberration: lerp(a.paper.aberration, b.paper.aberration), flutedGlass: lerp(a.paper.flutedGlass, b.paper.flutedGlass) };
  if (a.wind || b.wind) {
    const wa = a.wind ?? { speed: 0, dir: b.wind!.dir }, wb = b.wind ?? { speed: 0, dir: a.wind!.dir };
    out.wind = { speed: lerp(wa.speed, wb.speed), dir: [lerp(wa.dir[0], wb.dir[0]), lerp(wa.dir[1], wb.dir[1])] };
  }
  return out;
}

/** Lucidity link (§4): calmer as lucidity rises: cell size -1 px per level, hysteresis x1.5, scrambles x0.5. */
export function lucidStyle(s: GlyphStyle, level: number): GlyphStyle {
  const k = Math.max(0, Math.min(3, level)) / 3;
  return {
    ...s,
    cellPx: Math.max(4, s.cellPx - level),
    cellSizes: s.cellSizes.map((c) => Math.max(4, c - level)) as [number, number, number],
    hysteresis: s.hysteresis * (1 + 0.5 * k),
  };
}

/** Gentle mode: ripples and scrambles off, wind halved, Paper aberration capped at 0.3. */
export function gentleStyle(s: GlyphStyle): GlyphStyle {
  return { ...s, ripples: false, wind: s.wind ? { ...s.wind, speed: s.wind.speed * 0.5 } : null, paper: { ...s.paper, aberration: Math.min(0.3, s.paper.aberration) } };
}

// ---- presets (data/glyph-styles/*.json) ----
const modules = import.meta.glob('../../../data/glyph-styles/*.json', { eager: true, import: 'default' }) as Record<string, Partial<GlyphStyle>>;
export const PRESETS: Record<string, GlyphStyle> = {};
for (const [path, p] of Object.entries(modules)) {
  const id = path.split('/').pop()!.replace('.json', '');
  PRESETS[id] = { ...DEFAULT_STYLE, ...p, id, paper: { ...DEFAULT_STYLE.paper, ...(p.paper ?? {}) } } as GlyphStyle;
}
export function preset(id: string): GlyphStyle {
  return PRESETS[id] ?? { ...DEFAULT_STYLE, id };
}
export const PRESET_IDS = () => Object.keys(PRESETS).sort();
