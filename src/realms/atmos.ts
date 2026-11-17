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
  'cloud-orchard': {
    skyTop: '#9FC8FF', skyHorizon: '#FFE4F0', skyBottom: '#FFF4E6', fog: '#F2E4F4', fogNear: 25, fogFar: 120,
    sky: '#FFF4F0', ground: '#C9B8E0', sun: '#FFE7C8', sunDir: [0.4, 0.8, 0.2], emissiveGain: 1.2, bloom: 0.8, detail: 'paper', sunDisc: '#FFF4E6', quadrant: 'halo',
  },
  'lantern-market': {
    skyTop: '#0E0820', skyHorizon: '#3A1A40', skyBottom: '#120A20', fog: '#2A1430', fogNear: 18, fogFar: 90,
    sky: '#8A5A7A', ground: '#3A2030', sun: '#FFB000', sunDir: [0.2, 0.6, 0.4], emissiveGain: 2.0, bloom: 1.3, detail: 'paper', stars: true, quadrant: 'bloom',
  },
  'tidal-stair': {
    skyTop: '#0E1A3A', skyHorizon: '#3A6A8A', skyBottom: '#19B0C0', fog: '#5A8AA0', fogNear: 35, fogFar: 150,
    sky: '#BDE7FF', ground: '#5AE0E8', sun: '#FFF4E6', sunDir: [-0.4, 0.4, -0.6], emissiveGain: 1.5, bloom: 1.0, detail: 'stone', moons: 2, stars: true, quadrant: 'centre',
  },
  'origami-metro': {
    skyTop: '#1A1A2E', skyHorizon: '#5A4A6A', skyBottom: '#2A2438', fog: '#4A4058', fogNear: 25, fogFar: 110,
    sky: '#E8DCC4', ground: '#5A5048', sun: '#FFE7A3', sunDir: [0.5, 0.5, 0.3], emissiveGain: 1.4, bloom: 0.7, detail: 'paper', quadrant: 'bloom',
  },
  'drowned-library': {
    skyTop: '#06141C', skyHorizon: '#1F4A54', skyBottom: '#0E1A24', fog: '#1F3E48', fogNear: 10, fogFar: 70,
    sky: '#8FB8B0', ground: '#2E5E6E', sun: '#C9F0D2', sunDir: [0.1, 1, 0.2], emissiveGain: 1.6, bloom: 0.9, detail: 'paper', quadrant: 'hush',
  },
  'static-field': {
    skyTop: '#2A2E44', skyHorizon: '#C98A6A', skyBottom: '#4A4A50', fog: '#7A7078', fogNear: 25, fogFar: 120,
    sky: '#C9D6D2', ground: '#4A5A3A', sun: '#E8C27A', sunDir: [-0.7, 0.2, -0.5], emissiveGain: 1.6, bloom: 0.8, detail: 'asphalt', sunDisc: '#E8C27A', quadrant: 'hush',
  },
  'fractal-reef': {
    skyTop: '#05030E', skyHorizon: '#1A0A30', skyBottom: '#0A0614', fog: '#140A28', fogNear: 12, fogFar: 85,
    sky: '#6B1FFF', ground: '#19F0FF', sun: '#FF2E9A', sunDir: [0.2, 1, 0.1], emissiveGain: 2.2, bloom: 1.3, detail: 'sand', stars: true, quadrant: 'undertow',
  },
  'the-veins': {
    skyTop: '#1A0410', skyHorizon: '#4A0A2A', skyBottom: '#14020A', fog: '#3A0A20', fogNear: 10, fogFar: 70,
    sky: '#FF6A9A', ground: '#4A1A3A', sun: '#FFB06A', sunDir: [0.3, 0.8, 0.3], emissiveGain: 2.0, bloom: 1.1, detail: 'stone', quadrant: 'undertow',
  },
  'night-school': {
    skyTop: '#0A0E1A', skyHorizon: '#1E2A3A', skyBottom: '#0A0E1A', fog: '#1A2230', fogNear: 15, fogFar: 80,
    sky: '#9AA6B0', ground: '#3A4440', sun: '#C9D6D2', sunDir: [0.2, 0.9, 0.3], emissiveGain: 1.0, bloom: 0.35, detail: 'asphalt', stars: true, quadrant: 'hush',
  },
  threshold: {
    skyTop: '#FFFFFF', skyHorizon: '#FFF4E6', skyBottom: '#F6F1EA', fog: '#FFFFFF', fogNear: 20, fogFar: 160,
    sky: '#FFFFFF', ground: '#F6F1EA', sun: '#FFFFFF', sunDir: [0, 1, 0], emissiveGain: 2.5, bloom: 1.5, detail: 'stone', quadrant: 'halo',
  },
  'the-thirteenth': {
    skyTop: '#05030A', skyHorizon: '#1A1030', skyBottom: '#05030A', fog: '#0A0614', fogNear: 8, fogFar: 40,
    sky: '#D9C8FF', ground: '#2A1A40', sun: '#FFE7A3', sunDir: [0, 1, 0], emissiveGain: 2.4, bloom: 1.2, detail: 'stone', stars: true, quadrant: 'hush',
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
