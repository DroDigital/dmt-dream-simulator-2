/**
 * Visions (§3.12): 20 real-time set pieces (20-40 s), rolled on 1 in 40 links (1 in 25 from night 100).
 * The sim only times them; the view stages them (src/render/visions.ts) by stage type + hue.
 */
import visionsJson from '../../data/visions.json' with { type: 'json' };

export interface VisionDef { id: string; name: string; stage: 'lanterns' | 'doors' | 'stars' | 'moon' | 'glyphstorm'; hue: number; durationS: number }

export const VISIONS: VisionDef[] = visionsJson.visions as VisionDef[];
