/**
 * Procedural kit meshes for every tile and prop `proc` name used by the realm kits.
 * Tiles are built centred on the cell (local -c/2..c/2); props centred on their foot point.
 * Variation `v` (0..3) lets near-repeats differ slightly (the suburb's houses).
 */
import type * as THREE from 'three/webgpu';
import { MeshBuilder, hex, mixc, shade, type RGBA } from './meshkit.ts';
import type { PropDef, TileDef } from '../realms/types.ts';
import { PROCS2 } from './kits2.ts';

type Ctx = { cell: number; lh: number; tile?: TileDef; prop?: PropDef; v: number };
type Proc = (b: MeshBuilder, c: Ctx) => void;

const C = {
  asphalt: hex('#3B3742'), asphaltHi: hex('#4A4552'), line: hex('#E8D9A8', 0.15), curb: hex('#9C8F86'),
  lawn: hex('#5E7A4E'), lawnHi: hex('#6F8B5A'), hedge: hex('#3F5E3A'),
  wallA: hex('#E8CBB0'), wallB: hex('#BFD3D8'), wallC: hex('#D9B8C9'), roof: hex('#7A3E48'), roofB: hex('#4F5D75'),
  window: hex('#FFC874', 0.85), windowDark: hex('#2A2E44', 0.05), door: hex('#6B4A3A'),
  stone: hex('#D8D2E6'), stoneDk: hex('#A9A3C2'), marble: hex('#F2EEF8'), glassA: hex('#7FD3FF', 0.7), glassB: hex('#FF9AD5', 0.7),
  glassC: hex('#FFE58A', 0.7), glassD: hex('#B79CFF', 0.7), gold: hex('#E8C27A', 0.2), flame: hex('#FFD27A', 1),
  sand: hex('#E8C27A'), sandHi: hex('#F2D59A'), sandDk: hex('#C9A25E'), ink: hex('#2B2138', 0.05), glyph: hex('#FFF1C4', 0.6),
  tatami: hex('#C9C08A'), plaster: hex('#EFE3D0'), wood: hex('#8C5E3C'), woodDk: hex('#5E3E2A'), paper: hex('#F6EBD8', 0.35),
  futon: hex('#D9C8FF'), red: hex('#E0484A'), redGlow: hex('#FF5A5A', 0.6), white: hex('#F4F0EA'), metal: hex('#8E96A3'), teal: hex('#3FB8AF'),
};
const GLASS = [C.glassA, C.glassB, C.glassC, C.glassD];

function floorBase(b: MeshBuilder, c: Ctx, top: RGBA, side: RGBA, level = 0): void {
  const h = c.cell / 2;
  const y = level * c.lh;
  b.box(-h, -0.3, -h, h, y, h, side, { top });
}

const P: Record<string, Proc> = {
  // ------------------------------------------------------------ Evening Suburb tiles
  road(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, C.asphalt, { top: c.v % 2 ? C.asphaltHi : C.asphalt });
    const lines = String(c.tile?.mesh?.params?.lines ?? 's');
    if (lines === 's' || lines === 't' || lines === 'x') for (let z = -h; z < h; z += 1.6) b.box(-0.06, 0.005, z + 0.2, 0.06, 0.01, z + 0.9, C.line);
    if (lines !== 'x' && lines !== 'none') {
      // curbs on the "curb" edges: E and W for straights
      const curbE = lines === 's' || lines === 't' || lines === 'end';
      if (curbE) b.box(h - 0.35, 0, -h, h, 0.15, h, C.curb);
      if (lines === 's' || lines === 'l' || lines === 'end') b.box(-h, 0, -h, -h + 0.35, 0.15, h, C.curb);
      if (lines === 'l' || lines === 'end') b.box(-h, 0, h - 0.35, h, 0.15, h, C.curb);
    }
    if (lines === 'none') b.box(-h + 0.3, 0.005, -h + 0.3, h - 0.3, 0.01, h - 0.3, shade(C.asphaltHi, 1.1));
  },
  yard(b, c) {
    const raised = !!c.tile?.mesh?.params?.raised;
    floorBase(b, c, c.v % 2 ? C.lawnHi : C.lawn, C.curb, raised ? 1 : 0);
    const y = raised ? c.lh : 0;
    if (c.tile?.mesh?.params?.hedge) {
      const h = c.cell / 2;
      b.box(-h, y, -h, h, y + 0.9, -h + 0.5, C.hedge);
      b.box(-h, y, -h, -h + 0.5, y + 0.9, h, C.hedge);
    }
    if (c.v === 3) b.cyl(0.8, y, -0.6, 0.12, 0.05, 0.4, 5, hex('#E86A8A'));
  },
  house(b, c) {
    const style = Number(c.tile?.mesh?.params?.style ?? 0);
    const h = c.cell / 2;
    floorBase(b, c, C.lawn, C.curb);
    const wall = [C.wallA, C.wallB, C.wallC][style % 3];
    const roof = style === 1 ? C.roofB : C.roof;
    const w = 1.5, H = style === 1 ? 4.6 : 3.8;
    const nudge = (c.v - 1.5) * 0.06; // near-repeat: houses differ by a hair
    b.box(-w, 0, -w + nudge, w, H, w, wall);
    // gable roof
    const rh = 1.6 + nudge * 2;
    b.tri([-w - 0.2, H, w + 0.2], [w + 0.2, H, w + 0.2], [w + 0.2, H + rh, 0], roof, [0, 0], [1, 0], [1, 1]);
    b.tri([-w - 0.2, H, w + 0.2], [w + 0.2, H + rh, 0], [-w - 0.2, H + rh, 0], roof, [0, 0], [1, 1], [0, 1]);
    b.tri([w + 0.2, H, -w - 0.2], [-w - 0.2, H, -w - 0.2], [-w - 0.2, H + rh, 0], shade(roof, 0.8), [0, 0], [1, 0], [1, 1]);
    b.tri([w + 0.2, H, -w - 0.2], [-w - 0.2, H + rh, 0], [w + 0.2, H + rh, 0], shade(roof, 0.8), [0, 0], [1, 1], [0, 1]);
    b.tri([-w, H, w], [-w, H, -w], [-w, H + rh - 0.1, 0], shade(wall, 0.75), [0, 0], [1, 0], [0.5, 1]);
    b.tri([w, H, -w], [w, H, w], [w, H + rh - 0.1, 0], shade(wall, 0.85), [0, 0], [1, 0], [0.5, 1]);
    // door + windows on +z (rotated by instance)
    b.box(-0.35, 0, w, 0.35, 1.9, w + 0.04, C.door);
    const lit = (i: number) => ((c.v + i + style) % 3 === 0 ? C.windowDark : C.window);
    b.box(0.6, 1.2, w, 1.2, 1.9, w + 0.05, lit(0));
    b.box(-1.2, 1.2, w, -0.6, 1.9, w + 0.05, lit(1));
    b.box(-0.9, 2.6, w, -0.2, 3.3, w + 0.05, lit(2));
    b.box(0.2, 2.6, w, 0.9, 3.3, w + 0.05, lit(3));
    b.box(w, 1.4, -0.4, w + 0.05, 2.2, 0.4, lit(4));
    if (style === 2) { // the house that hums: aerial + glowing attic
      b.cyl(0.6, H + rh - 0.3, 0, 0.03, 0.03, 1.6, 4, C.metal);
      b.box(-0.3, H + 0.4, w + 0.15, 0.3, H + 0.9, w + 0.2, hex('#7AF0FF', 0.9));
    }
    void h;
  },
  steps(b, c) {
    const stone = !!c.tile?.mesh?.params?.stone;
    const col = stone ? C.marble : C.curb;
    const n = 6, h = c.cell / 2, H = c.lh;
    for (let i = 0; i < n; i++) {
      const z0 = h - (i * c.cell) / n, z1 = h - ((i + 1) * c.cell) / n;
      b.box(-h, -0.3, z1, h, ((i + 1) / n) * H, z0, col, { top: shade(col, 1.05) });
    }
  },
  hedge(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 2.6 + (c.v % 2) * 0.4, h, C.hedge, { top: shade(C.hedge, 1.2) });
  },
  // ------------------------------------------------------------ Prism Cathedral tiles
  tilefloor(b, c) {
    const raised = !!c.tile?.mesh?.params?.raised;
    const rainbow = !!c.tile?.mesh?.params?.rainbow;
    const h = c.cell / 2, y = raised ? c.lh : 0;
    b.box(-h, -0.3, -h, h, y, h, C.stoneDk, { top: (c.v % 2 ? C.marble : C.stone) });
    b.box(-h, y, -h, 0, y + 0.004, 0, shade(C.marble, 1.02));
    b.box(0, y, 0, h, y + 0.004, h, shade(C.marble, 1.02));
    if (rainbow) for (let i = 0; i < 4; i++) b.box(-h + 0.4 + i * 0.8, y + 0.006, -1.2, -h + 1.1 + i * 0.8, y + 0.01, 1.2, [...GLASS[(i + c.v) % 4].slice(0, 3), 0.45] as RGBA);
  },
  pillar(b, c) {
    P.tilefloor(b, c);
    b.cyl(0, 0, 0, 0.75, 0.75, 0.5, 8, C.stoneDk);
    b.cyl(0, 0.5, 0, 0.55, 0.5, 15, 8, C.stone);
    b.cyl(0, 15.5, 0, 0.6, 1.4, 1.2, 8, C.stoneDk);
    for (let i = 0; i < 4; i++) b.box(-0.08, 3 + i * 3, 0.5, 0.08, 4 + i * 3, 0.58, GLASS[(i + c.v) % 4]);
  },
  glasswall(b, c) {
    P.tilefloor(b, c);
    const h = c.cell / 2;
    b.box(-h, 0, -h, -h + 1.0, 18, h, C.stone);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const z0 = -h + 0.3 + j * 1.8;
      b.box(-h + 1.0, 2 + i * 3, z0, -h + 1.05, 4.6 + i * 3, z0 + 1.5, GLASS[(i + j + c.v) % 4]);
    }
  },
  pews(b, c) {
    P.tilefloor(b, c);
    for (const z of [-1.1, 0.7]) { b.box(-1.4, 0, z, 1.4, 0.45, z + 0.5, C.wood); b.box(-1.4, 0.45, z + 0.4, 1.4, 0.95, z + 0.5, C.woodDk); }
  },
  navewall(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 20, h, C.stoneDk, { top: C.stone });
    b.box(-0.6, 3, h, 0.6, 9, h + 0.05, GLASS[c.v % 4]);
    b.box(-0.6, 3, -h - 0.05, 0.6, 9, -h, GLASS[(c.v + 1) % 4]);
  },
  // ------------------------------------------------------------ Glyph Desert tiles
  sand(b, c) {
    const level = Number(c.tile?.mesh?.params?.level ?? 0);
    floorBase(b, c, c.v % 2 ? C.sandHi : C.sand, C.sandDk, level);
    const y = level * c.lh;
    for (let i = 0; i < 3; i++) b.box(-1.6 + i * 1.1, y, -0.2 + ((c.v + i) % 3) * 0.5, -1.0 + i * 1.1, y + 0.012, -0.1 + ((c.v + i) % 3) * 0.5, C.glyph);
  },
  sandramp(b, c) {
    const f = c.tile!.floor as { from: number; to: number };
    b.ramp(c.cell, f.from * c.lh, f.to * c.lh, C.sandHi, C.sandDk);
  },
  monolith(b, c) {
    P.sand(b, c);
    b.cbox(0, 0, 0, 1.2, 7, 1.2, C.ink);
    for (let i = 0; i < 10; i++) b.box(-0.45, 0.6 + i * 0.62, 0.6, 0.45 - ((i * 7 + c.v) % 4) * 0.12, 0.9 + i * 0.62, 0.62, C.glyph);
  },
  arch(b, c) {
    P.sand(b, c);
    b.box(-1.8, 0, -0.4, -1.0, 4, 0.4, C.sandDk);
    b.box(1.0, 0, -0.4, 1.8, 4, 0.4, C.sandDk);
    b.box(-1.8, 4, -0.4, 1.8, 4.7, 0.4, C.sandDk);
    for (let i = 0; i < 6; i++) b.box(-1.5 + i * 0.5, 4.2, 0.41, -1.25 + i * 0.5, 4.5, 0.43, C.glyph);
  },
  highdune(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 6 + (c.v % 3), h, C.sandDk, { top: C.sand });
  },
  // ------------------------------------------------------------ Lantern Flat tiles
  tatami(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, C.woodDk, { top: c.v % 2 ? C.tatami : shade(C.tatami, 0.95) });
    b.box(-h, 0, -0.02, h, 0.006, 0.02, C.woodDk);
  },
  flatwall(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 2.8, h, C.plaster, { top: C.wood });
    b.box(-h, 2.6, -h, h, 2.8, h, C.wood);
  },
  flatwindow(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0.9, h, C.plaster);
    b.box(-h, 2.4, -h, h, 2.8, h, C.wood);
    b.box(-h, 0.9, h - 0.25, h, 1.0, h + 0.15, C.wood); // sill
    b.box(-h, 0.9, -0.05, -h + 0.06, 2.4, 0.05, C.wood);
    b.box(-0.03, 0.9, -0.05, 0.03, 2.4, 0.05, C.wood);
  },
  // ------------------------------------------------------------ props
  vending(b, c) {
    const glow = [hex('#7AF0FF', 0.9), hex('#FF7AB6', 0.9), hex('#FFF27A', 0.9)][c.v % 3];
    b.cbox(0, 0, 0, 1.0, 1.9, 0.8, C.white);
    b.box(-0.42, 0.9, 0.4, 0.42, 1.75, 0.42, glow);
    for (let i = 0; i < 6; i++) b.box(-0.38 + (i % 3) * 0.27, 1.05 + Math.floor(i / 3) * 0.35, 0.42, -0.2 + (i % 3) * 0.27, 1.3 + Math.floor(i / 3) * 0.35, 0.45, [C.red, C.teal, hex('#FFB000')][i % 3]);
    b.box(-0.3, 0.2, 0.4, 0.3, 0.45, 0.45, C.ink);
  },
  bicycle(b) {
    b.push().rotateZ(Math.PI / 2);
    b.cyl(0.35, -0.7, 0, 0.33, 0.33, 0.05, 8, C.ink, { cap: false });
    b.cyl(0.35, 0.3, 0, 0.33, 0.33, 0.05, 8, C.ink, { cap: false });
    b.pop();
    b.box(-0.55, 0.35, -0.03, 0.55, 0.42, 0.03, C.red);
    b.box(-0.1, 0.4, -0.03, 0.0, 0.85, 0.03, C.red);
    b.box(0.4, 0.4, -0.03, 0.48, 0.95, 0.03, C.metal);
    b.box(0.3, 0.95, -0.25, 0.5, 1.0, 0.25, C.metal);
    b.box(-0.2, 0.85, -0.1, 0.1, 0.9, 0.1, C.ink);
  },
  laundry(b, c) {
    b.cyl(-1.4, 0, 0, 0.04, 0.04, 2.2, 4, C.metal);
    b.cyl(1.4, 0, 0, 0.04, 0.04, 2.2, 4, C.metal);
    b.box(-1.4, 2.0, -0.01, 1.4, 2.03, 0.01, C.white);
    const cl = [hex('#FFC9DE', 0.1), hex('#BDE7FF', 0.1), C.white, hex('#FFE7A3', 0.1)];
    for (let i = 0; i < 4; i++) b.panel(-1.0 + i * 0.65, 1.62, 0, 0.5, 0.75 - ((i + c.v) % 2) * 0.2, cl[(i + c.v) % 4]);
  },
  mailbox(b) {
    b.cbox(0, 0, 0, 0.1, 0.8, 0.1, C.woodDk);
    b.cbox(0, 0.8, 0, 0.35, 0.35, 0.5, C.red);
    b.box(0.17, 1.0, -0.05, 0.2, 1.2, 0, hex('#FFE7A3'));
  },
  lamp(b) {
    b.cyl(0, 0, 0, 0.12, 0.08, 4.3, 6, C.metal);
    b.box(-0.05, 4.2, 0, 0.05, 4.28, 0.9, C.metal);
    b.cbox(0, 3.95, 0.9, 0.35, 0.25, 0.35, hex('#FFE2A8', 1));
  },
  phonebooth(b) {
    b.cbox(0, 0, 0, 1.2, 0.2, 1.2, C.metal);
    for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) b.cbox(x, 0.2, z, 0.1, 2.0, 0.1, hex('#3FB86A'));
    b.cbox(0, 2.2, 0, 1.25, 0.25, 1.25, hex('#3FB86A'));
    b.box(-0.5, 0.4, -0.5, 0.5, 2.1, -0.48, hex('#BDE7FF', 0.25));
    b.cbox(0, 1.1, -0.35, 0.3, 0.45, 0.15, hex('#E8C27A'));
    b.cbox(0, 2.25, 0.63, 0.6, 0.15, 0.02, hex('#FFFFFF', 0.9));
  },
  cat(b, c) {
    const col = [C.ink, hex('#E8A060'), C.white][c.v % 3];
    b.cbox(0, 0.1, 0, 0.18, 0.18, 0.45, col);
    b.cbox(0, 0.22, 0.25, 0.16, 0.15, 0.15, col);
    b.tri([-0.07, 0.37, 0.28], [-0.02, 0.37, 0.28], [-0.05, 0.45, 0.27], col, [0, 0], [1, 0], [0, 1]);
    b.tri([0.02, 0.37, 0.28], [0.07, 0.37, 0.28], [0.05, 0.45, 0.27], col, [0, 0], [1, 0], [0, 1]);
    b.box(-0.02, 0.15, -0.5, 0.02, 0.4, -0.22, col);
    for (const x of [-0.06, 0.06]) for (const z of [-0.15, 0.15]) b.cbox(x, 0, z, 0.05, 0.12, 0.05, col);
  },
  crane(b) {
    const col = hex('#FF6A88', 0.35);
    b.tri([0, 0, -0.25], [0, 0, 0.25], [0, 0.18, 0], col, [0, 0], [1, 0], [0.5, 1]);
    b.tri([0, 0.06, 0], [-0.28, 0.12, 0.02], [0, 0.06, 0.1], shade(col, 0.9), [0, 0], [1, 0], [0.5, 1]);
    b.tri([0, 0.06, 0], [0.28, 0.12, 0.02], [0, 0.06, 0.1], shade(col, 0.8), [0, 0], [1, 0], [0.5, 1]);
    b.tri([0, 0.05, 0.22], [0, 0.25, 0.32], [0, 0.05, 0.27], col, [0, 0], [1, 0], [0.5, 1]);
  },
  bell(b) { b.cyl(0, 0, 0, 0.08, 0.04, 0.08, 8, hex('#E8C27A', 0.5)); b.cyl(0, 0.08, 0, 0.02, 0.02, 0.03, 4, C.metal); },
  watertower(b) {
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.cbox(x, 0, z, 0.2, 9, 0.2, C.metal);
    b.cyl(0, 9, 0, 1.9, 1.9, 3.2, 10, hex('#C9D6D2'));
    b.cyl(0, 12.2, 0, 1.95, 0.1, 1.2, 10, hex('#7A3E48'));
    b.box(-0.9, 10.2, 1.9, 0.9, 11, 1.95, hex('#FFB000', 0.7));
  },
  bench(b, c) {
    const stone = !!c.prop?.mesh?.params?.stone;
    const col = stone ? C.marble : C.wood;
    b.box(-0.8, 0.4, -0.25, 0.8, 0.48, 0.25, col);
    b.box(-0.75, 0, -0.2, -0.65, 0.4, 0.2, shade(col, 0.7));
    b.box(0.65, 0, -0.2, 0.75, 0.4, 0.2, shade(col, 0.7));
    if (!stone) b.box(-0.8, 0.48, -0.25, 0.8, 0.95, -0.18, col);
  },
  prism(b, c) {
    const col = GLASS[c.v % 4];
    b.cbox(0, 0, 0, 0.6, 0.25, 0.6, C.stoneDk);
    b.push().translate(0, 0.25, 0).rotateY(c.v * 0.5);
    b.cyl(0, 0, 0, 0.35, 0.0, 1.3, 3, col);
    b.pop();
  },
  candles(b, c) {
    b.cyl(0, 0, 0, 0.3, 0.06, 1.0, 6, C.gold);
    b.cyl(0, 1.0, 0, 0.32, 0.32, 0.06, 6, C.gold);
    for (let i = 0; i < 3 + (c.v % 3); i++) {
      const a = i * 2.1;
      b.cyl(Math.cos(a) * 0.18, 1.06, Math.sin(a) * 0.18, 0.04, 0.04, 0.2 + (i % 2) * 0.1, 4, C.white);
      b.cyl(Math.cos(a) * 0.18, 1.26 + (i % 2) * 0.1, Math.sin(a) * 0.18, 0.03, 0.0, 0.1, 4, C.flame);
    }
  },
  glassfigure(b, c) {
    const col = GLASS[(c.v + 2) % 4];
    b.cbox(0, 0, 0, 0.8, 0.3, 0.8, C.stoneDk);
    b.cyl(0, 0.3, 0, 0.35, 0.2, 1.2, 6, col);
    b.sphere(0, 1.75, 0, 0.22, 6, col);
    b.panel(0, 1.4, -0.15, 1.4, 0.7, [col[0], col[1], col[2], 0.9]);
  },
  font(b) {
    b.cyl(0, 0, 0, 0.4, 0.3, 0.6, 8, C.stone);
    b.cyl(0, 0.6, 0, 0.8, 0.8, 0.3, 8, C.marble);
    b.cyl(0, 0.85, 0, 0.7, 0.7, 0.03, 8, hex('#7FE0E8', 0.6));
  },
  bead(b) { b.sphere(0, 0.08, 0, 0.09, 6, hex('#7FD3FF', 0.8)); },
  candlestub(b) { b.cyl(0, 0, 0, 0.05, 0.05, 0.12, 6, C.white); b.cyl(0, 0.12, 0, 0.03, 0, 0.07, 4, C.flame); },
  greatprism(b) {
    b.cbox(0, 0, 0, 3.6, 0.6, 3.6, C.marble);
    b.cbox(0, 0.6, 0, 2.6, 0.4, 2.6, C.stone);
    b.push().translate(0, 1.0, 0);
    b.cyl(0, 0, 0, 1.4, 0.0, 5.0, 3, hex('#FFFFFF', 0.85));
    b.pop();
    for (let i = 0; i < 4; i++) b.box(-1.8 + i * 0.9, 0.61, 1.9, -1.1 + i * 0.9, 0.63, 4.5, [...GLASS[i].slice(0, 3), 0.8] as RGBA);
  },
  glyphstone(b, c) {
    b.push().rotateY(c.v * 0.7);
    b.cbox(0, 0, 0, 1.0, 1.4 - (c.v % 2) * 0.3, 0.5, C.sandDk, { top: C.sand });
    for (let i = 0; i < 3; i++) b.box(-0.35, 0.3 + i * 0.32, 0.25, 0.35 - i * 0.1, 0.48 + i * 0.32, 0.27, C.glyph);
    b.pop();
  },
  lettercactus(b, c) {
    const col = mixc(hex('#5E7A4E'), C.sand, 0.3);
    b.cbox(0, 0, 0, 0.35, 2.2 + (c.v % 2) * 0.4, 0.35, col);
    b.cbox(0.35, 0.9, 0, 0.35, 0.25, 0.25, col);
    b.cbox(0.45, 0.9, 0, 0.25, 0.9, 0.25, col);
    b.cbox(-0.3, 1.3, 0, 0.3, 0.22, 0.22, col);
    b.cbox(-0.38, 1.3, 0, 0.22, 0.6, 0.22, col);
    for (let i = 0; i < 5; i++) b.box(-0.1, 0.3 + i * 0.4, 0.18, 0.1, 0.4 + i * 0.4, 0.19, C.glyph);
  },
  windsign(b, c) {
    b.cyl(0, 0, 0, 0.06, 0.06, 3, 4, C.woodDk);
    b.panel(0.5, 2.6, 0, 1.0, 0.4, C.paper, 0);
    for (let i = 0; i < 4; i++) b.box(0.1 + i * 0.22, 2.5, 0.01, 0.25 + i * 0.22, 2.7, 0.02, (i + c.v) % 2 ? C.ink : C.glyph);
  },
  scroll(b) { b.push().rotateZ(Math.PI / 2); b.cyl(0, -0.15, 0, 0.05, 0.05, 0.3, 6, hex('#F6EBD8', 0.4)); b.pop(); },
  inkbottle(b) { b.cyl(0, 0, 0, 0.07, 0.07, 0.12, 6, hex('#3A2A5A', 0.3)); b.cyl(0, 0.12, 0, 0.03, 0.03, 0.06, 4, C.ink); },
  greattablet(b) {
    b.cbox(0, 0, 0, 4.2, 0.5, 2.4, C.sandDk);
    b.cbox(0, 0.5, 0, 3.4, 9, 1.2, C.ink);
    for (let r = 0; r < 14; r++) for (let k = 0; k < 6; k++) if ((r * 7 + k * 3) % 5) b.box(-1.4 + k * 0.48, 1.0 + r * 0.6, 0.6, -1.1 + k * 0.48, 1.35 + r * 0.6, 0.62, C.glyph);
    b.box(-0.5, 7.6, 0.6, 0.5, 8.4, 0.64, hex('#FFFFFF', 1));
  },
  tent(b) {
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.cyl(x, 0, z, 0.05, 0.05, 2.2, 4, C.woodDk);
    b.box(-1.4, 2.2, -1.4, 1.4, 2.3, 1.4, hex('#F6EBD8', 0.15));
    b.box(-0.8, 0, -0.6, 0.8, 0.05, 0.6, C.red);
  },
  futon(b, c) {
    b.box(-0.5, 0, -1.0, 0.5, 0.14, 1.0, C.white);
    b.box(-0.48, 0.14, -0.6, 0.48, 0.2, 1.0, [C.futon, hex('#FFC9DE'), hex('#BDE7FF'), hex('#FFE7A3')][c.v % 4]);
    b.box(-0.3, 0.14, -0.95, 0.3, 0.26, -0.65, C.white);
  },
  lantern(b) {
    b.cyl(0, 0.55, 0, 0.01, 0.01, 0.6, 3, C.woodDk);
    b.cyl(0, 0, 0, 0.16, 0.26, 0.28, 8, hex('#FFD9A0', 1));
    b.cyl(0, 0.28, 0, 0.26, 0.16, 0.28, 8, hex('#FFD9A0', 1));
  },
  shelf(b) {
    b.box(-0.8, 0, -0.18, 0.8, 1.9, -0.15, C.woodDk);
    for (let i = 0; i < 4; i++) b.box(-0.8, 0.05 + i * 0.6, -0.18, 0.8, 0.1 + i * 0.6, 0.2, C.wood);
    b.box(-0.8, 0, -0.18, -0.75, 1.9, 0.2, C.wood);
    b.box(0.75, 0, -0.18, 0.8, 1.9, 0.2, C.wood);
  },
  lowtable(b) {
    b.box(-0.6, 0.32, -0.45, 0.6, 0.38, 0.45, C.wood);
    for (const [x, z] of [[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]]) b.cbox(x, 0, z, 0.06, 0.32, 0.06, C.woodDk);
    b.cyl(0.2, 0.38, 0.1, 0.06, 0.05, 0.08, 6, C.white);
  },
  veilfloor(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, hex('#2A2440'), { top: c.v % 2 ? hex('#3A2C50', 0.15) : hex('#33284A', 0.1) });
  },
  veilwall(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 4, h, hex('#1F1A30', 0.05), { top: hex('#1F1A30') });
    b.box(-0.05, 0.6, h, 0.05, 3.4, h + 0.02, hex('#D9C8FF', 0.9));
  },
  voidfloor(b, c) {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, hex('#0E0A14', 0.02), { top: hex('#120E1A', 0.03) });
  },
  thresholddoor(b) {
    b.box(-1.0, 0, -0.15, -0.8, 3.2, 0.15, hex('#FFFFFF', 1));
    b.box(0.8, 0, -0.15, 1.0, 3.2, 0.15, hex('#FFFFFF', 1));
    b.box(-1.0, 3.0, -0.15, 1.0, 3.2, 0.15, hex('#FFFFFF', 1));
    b.box(-0.8, 0, -0.05, 0.8, 3.0, 0.05, hex('#FFFFFF', 1));
  },
  orrery(b) {
    b.cyl(0, 0, 0, 0.6, 0.4, 0.8, 10, hex('#3A2C50', 0.1));
    b.sphere(0, 1.6, 0, 0.35, 10, hex('#FFE7A3', 1));
    for (let i = 0; i < 9; i++) { const a = i * 0.7; b.sphere(Math.cos(a) * (0.6 + i * 0.1), 1.6 + Math.sin(i) * 0.3, Math.sin(a) * (0.6 + i * 0.1), 0.05 + (i % 3) * 0.03, 6, hex(['#BDE7FF', '#FFC9DE', '#D9C8FF'][i % 3], 0.9)); }
  },
  pedestal(b) {
    b.cyl(0, 0, 0, 0.3, 0.22, 1.0, 8, hex('#E8E0F0', 0.1));
    b.cyl(0, 1.0, 0, 0.32, 0.32, 0.05, 8, hex('#FFD9A0', 0.8));
  },
  ceiling(b) {
    b.box(0, 2.8, 0, 12, 3.0, 12, C.plaster, { bottom: true });
    for (let i = 1; i < 6; i++) { b.box(i * 2 - 0.05, 2.72, 2, i * 2 + 0.05, 2.8, 10, C.wood); b.box(2, 2.72, i * 2 - 0.05, 10, 2.8, i * 2 + 0.05, C.wood); }
  },
  clock(b) {
    b.cyl(0, 0, 0, 0.2, 0.2, 0.05, 10, C.wood);
    b.push().rotateX(Math.PI / 2);
    b.pop();
    b.box(-0.01, 0.05, -0.02, 0.01, 0.06, 0.12, C.ink);
  },
};

Object.assign(P, PROCS2);

const cache = new Map<string, THREE.BufferGeometry>();

/** Build (cached) geometry for a tile or prop. */
export function kitGeometry(proc: string, ctx: Ctx, key: string): THREE.BufferGeometry {
  const k = `${key}:${ctx.v}`;
  let g = cache.get(k);
  if (g) return g;
  const b = new MeshBuilder();
  const fn = P[proc] ?? ((bb: MeshBuilder) => bb.cbox(0, 0, 0, 0.6, 0.6, 0.6, hex('#FF00FF', 0.5)));
  fn(b, ctx);
  g = b.toGeometry();
  cache.set(k, g);
  return g;
}

export function hasProc(proc: string): boolean { return proc in P; }
