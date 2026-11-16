/** Glyph modes. Add a mode by adding an entry here and an atlas row; the pass switches on `row`. */
export interface GlyphMode { id: string; ramp: string; row: number; font?: string }

export const MODES: Record<string, GlyphMode> = {
  ascii: { id: 'ascii', ramp: ' .:-=+*#%@', row: 0 },
  braille: { id: 'braille', ramp: '⠀⠁⠃⠇⠏⠟⠿⡿⣿', row: 2, font: '"DejaVu Sans Mono", "Segoe UI Symbol", monospace' },
  blocks: { id: 'blocks', ramp: ' ░▒▓█', row: 3, font: '"DejaVu Sans Mono", monospace' },
};
export const MODE_IDS = Object.keys(MODES);
/** Edge glyph row: _ / | \ and + where directions meet. */
export const EDGE_RAMP = '_/|\\+';
export const EDGE_ROW = 1;
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 4;
