/** Per-realm atmosphere: sky gradient, fog, hemisphere/sun light, emissive gain, detail texture. */
export interface Atmos {
  skyTop: string; skyHorizon: string; skyBottom: string;
  fog: string; fogNear: number; fogFar: number;
  sky: string; ground: string; sun: string; sunDir: [number, number, number];
  emissiveGain: number;
  /** Light layer strength (mundane realms keep it subtle). */
  bloom: number;
  detail: 'paper' | 'stone' | 'sand' | 'tatami' | 'asphalt';
  /** Sun disc / moons drawn in the sky. */
  sunDisc?: string;
  moons?: number;
  stars?: boolean;
  glyph?: boolean;
  quadrant: 'halo' | 'bloom' | 'hush' | 'undertow' | 'centre';
}

export const ATMOS: Record<string, Atmos> = {
  'evening-suburb': {
    skyTop: '#3A3570', skyHorizon: '#FF9E6A', skyBottom: '#5A3A5A', fog: '#C78A86', fogNear: 30, fogFar: 120,
    sky: '#B9A3C9', ground: '#5A4048', sun: '#FFB07A', sunDir: [-0.8, 0.18, -0.4], emissiveGain: 1.2, bloom: 0.45, detail: 'paper',
    sunDisc: '#FFD9A0', quadrant: 'bloom',
  },
  'prism-cathedral': {
    skyTop: '#C9B8F0', skyHorizon: '#FFE4D6', skyBottom: '#B9A8D8', fog: '#CDBFE0', fogNear: 20, fogFar: 95,
    sky: '#CFC4E4', ground: '#7A6F9A', sun: '#E8D4C0', sunDir: [0.3, 0.9, 0.2], emissiveGain: 1.0, bloom: 0.55, detail: 'stone',
    quadrant: 'halo',
  },
  'glyph-desert': {
    skyTop: '#140F24', skyHorizon: '#6B4A6E', skyBottom: '#2B2138', fog: '#5A4560', fogNear: 30, fogFar: 125,
    sky: '#B0A0D0', ground: '#C09A6A', sun: '#FFD08A', sunDir: [0.5, 0.35, -0.6], emissiveGain: 1.8, bloom: 0.9, detail: 'sand',
    moons: 1, stars: true, glyph: true, quadrant: 'hush',
  },
  'veiled-room': {
    skyTop: '#0A0614', skyHorizon: '#2A1A40', skyBottom: '#0A0614', fog: '#1A1028', fogNear: 6, fogFar: 30,
    sky: '#D9C8FF', ground: '#3A2A50', sun: '#FFE7A3', sunDir: [0.1, 1, 0.2], emissiveGain: 2.2, bloom: 1.1, detail: 'stone', quadrant: 'hush',
  },
  'chorus-room': {
    skyTop: '#FFF4E6', skyHorizon: '#FFC9DE', skyBottom: '#BDE7FF', fog: '#FFE4F0', fogNear: 8, fogFar: 40,
    sky: '#FFF4E6', ground: '#D9C8FF', sun: '#FFFFFF', sunDir: [0.2, 1, 0.3], emissiveGain: 1.6, bloom: 1.0, detail: 'stone', quadrant: 'halo',
  },
  vision: {
    skyTop: '#05030A', skyHorizon: '#140A20', skyBottom: '#05030A', fog: '#05030A', fogNear: 30, fogFar: 300,
    sky: '#3A2A50', ground: '#120E1A', sun: '#FFD9A0', sunDir: [0, 1, 0], emissiveGain: 2.4, bloom: 1.3, detail: 'stone', stars: true, quadrant: 'undertow',
  },
  'lantern-flat': {
    skyTop: '#1A1630', skyHorizon: '#3A2A50', skyBottom: '#1A1630', fog: '#2A2030', fogNear: 30, fogFar: 80,
    sky: '#FFD9A0', ground: '#6A4A3A', sun: '#FFB070', sunDir: [0.2, 0.8, 0.3], emissiveGain: 1.5, bloom: 0.8, detail: 'tatami',
    quadrant: 'centre',
  },
};
