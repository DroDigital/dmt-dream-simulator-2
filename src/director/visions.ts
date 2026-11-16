/**
 * Visions (§3.12): real-time set pieces of 20-40 s, rolled on 1 in 40 links (1 in 25 from night 100).
 * The sim only times them; the view stages them (src/render/visions.ts).
 */
export interface VisionDef { id: string; name: string; durationS: number }

export const VISIONS: VisionDef[] = [
  { id: 'lantern-ascension', name: 'Lantern Ascension', durationS: 28 },
  { id: 'tide-of-doors', name: 'Tide of Doors', durationS: 32 },
];
