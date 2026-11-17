/**
 * Glyph atlas built at load from a canvas: row 0 = fill ramp, row 1 = edge glyphs,
 * row 2+ = alternate sets (braille, blocks). Font: VT323 (OFL) by default.
 */
import * as THREE from 'three/webgpu';
import { ATLAS_COLS, ATLAS_ROWS, EDGE_RAMP, MODES } from './modes/index.ts';

export async function loadGlyphFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try { await document.fonts.load('32px VT323'); } catch { /* fall back to monospace */ }
}

export function makeGlyphSuiteAtlas(asciiRamp = MODES.ascii.ramp, cellPx = 32): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = cellPx * ATLAS_COLS;
  canvas.height = cellPx * ATLAS_ROWS;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rows: { chars: string; font: string }[] = [
    { chars: asciiRamp, font: 'VT323, monospace' },
    { chars: EDGE_RAMP, font: 'VT323, monospace' },
    { chars: MODES.braille.ramp, font: MODES.braille.font! },
    { chars: MODES.blocks.ramp, font: MODES.blocks.font! },
  ];
  rows.forEach((r, row) => {
    g.font = `${Math.round(cellPx * (row === 0 || row === 1 ? 1.1 : 0.95))}px ${r.font}`;
    [...r.chars].forEach((ch, i) => {
      if (row === 3) {
        // blocks drawn as solid shade fills so they tile perfectly
        const k = i / Math.max(1, [...r.chars].length - 1);
        if (k > 0) { g.globalAlpha = k; g.fillRect(i * cellPx, row * cellPx, cellPx, cellPx); g.globalAlpha = 1; }
        return;
      }
      // edge glyphs are drawn centred in their cell (an underscore would otherwise sit below it)
      const dy = row === 1 && ch === '_' ? -cellPx * 0.3 : 1;
      g.fillText(ch, i * cellPx + cellPx / 2, row * cellPx + cellPx / 2 + dy);
    });
  });
  const t = new THREE.CanvasTexture(canvas);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  return t;
}
