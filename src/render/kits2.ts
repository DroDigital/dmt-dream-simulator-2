/**
 * Kit meshes for the remaining realms (M4). Built from a few parametric builders (floors, lanes, blocks,
 * walls) plus signature pieces per realm. Registered into the shared proc table in kits.ts.
 */
import { MeshBuilder, hex, mixc, shade, type RGBA } from './meshkit.ts';
import type { PropDef, TileDef } from '../realms/types.ts';

type Ctx = { cell: number; lh: number; tile?: TileDef; prop?: PropDef; v: number };
type Proc = (b: MeshBuilder, c: Ctx) => void;

const lvl = (c: Ctx) => Number(c.tile?.mesh?.params?.level ?? (c.tile?.floor.kind === 'flat' ? c.tile.floor.level : 0));

/** Ground tile with an optional sprinkle of detail. */
function ground(top: RGBA, alt: RGBA, side: RGBA, detail?: (b: MeshBuilder, c: Ctx, y: number) => void): Proc {
  return (b, c) => {
    const h = c.cell / 2, y = lvl(c) * c.lh;
    b.box(-h, -0.3, -h, h, y, h, side, { top: c.v % 2 ? alt : top });
    detail?.(b, c, y);
  };
}
function ramp(top: RGBA, side: RGBA, steps = 0): Proc {
  return (b, c) => {
    const f = c.tile!.floor as { from: number; to: number };
    if (!steps) { b.ramp(c.cell, f.from * c.lh, f.to * c.lh, top, side); return; }
    const h = c.cell / 2;
    for (let i = 0; i < steps; i++) {
      const z0 = h - (i * c.cell) / steps, z1 = h - ((i + 1) * c.cell) / steps;
      b.box(-h, -0.3, z1, h, f.from * c.lh + ((i + 1) / steps) * (f.to - f.from) * c.lh, z0, side, { top });
    }
  };
}
/** Lane tile (street / corridor / rail / tube) with kerbs on its "edge" sides. */
function lane(top: RGBA, kerb: RGBA, line: RGBA | null, kerbH = 0.15): Proc {
  return (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, shade(top, 0.9), { top });
    const lines = String(c.tile?.mesh?.params?.lines ?? 's');
    if (line && (lines === 's' || lines === 't' || lines === 'x')) for (let z = -h; z < h; z += 1.6) b.box(-0.06, 0.005, z + 0.2, 0.06, 0.01, z + 0.9, line);
    if (lines !== 'x' && lines !== 'none') {
      if (lines === 's' || lines === 't' || lines === 'end') b.box(h - 0.3, 0, -h, h, kerbH, h, kerb);
      if (lines === 's' || lines === 'l' || lines === 'end') b.box(-h, 0, -h, -h + 0.3, kerbH, h, kerb);
      if (lines === 'l' || lines === 'end') b.box(-h, 0, h - 0.3, h, kerbH, h, kerb);
    }
  };
}
/** Solid border wall. */
function wall(body: RGBA, top: RGBA, height: number, accent?: RGBA): Proc {
  return (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, height + (c.v % 3) * 0.4, h, body, { top });
    if (accent) b.box(-0.4, height * 0.4, h, 0.4, height * 0.7, h + 0.03, accent);
  };
}
/** Block on a yard: base + body with windows/doors on +z. */
function block(yard: RGBA, body: RGBA, roof: RGBA, height: number, win: RGBA, door: RGBA): Proc {
  return (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, shade(yard, 0.9), { top: yard });
    const w = 1.55;
    b.box(-w, 0, -w, w, height, w, body, { top: roof });
    b.box(-0.4, 0, w, 0.4, 2.1, w + 0.04, door);
    for (let i = 0; i < Math.floor(height / 1.6); i++) for (const x of [-1.0, 0.6]) if ((i + c.v + (x > 0 ? 1 : 0)) % 3) b.box(x, 1.0 + i * 1.6, w, x + 0.5, 1.6 + i * 1.6, w + 0.05, win);
  };
}

const PAL = {
  cloud: hex('#F6F1FA', 0.12), cloudB: hex('#FFE4F0', 0.12), cloudSide: hex('#D9C8FF', 0.1), trunk: hex('#C9A7D9'), leaf: hex('#FFC9DE', 0.25),
  plank: hex('#6B4A3A'), plankB: hex('#7A5644'), kerbW: hex('#3A2A2A'), stallRed: hex('#E0484A', 0.1), lanternGlow: hex('#FFB000', 1), paperW: hex('#F6EBD8', 0.4),
  white: hex('#F4F2EE', 0.08), whiteB: hex('#E6E4EE', 0.08), sea: hex('#5AE0E8', 0.9), seaDeep: hex('#19B0C0', 0.6), moon: hex('#FFF4E6', 1),
  paper: hex('#F2E6D0', 0.05), paperB: hex('#E8DCC4', 0.05), ink: hex('#2B2138', 0.05), rail: hex('#8E96A3'), sleeper: hex('#5E3E2A'),
  flood: hex('#2E5E6E', 0.15), floodB: hex('#3A6E7E', 0.2), book: hex('#8C5E3C'), bookB: hex('#4F5D75'), bookC: hex('#7A3E48'), green: hex('#8FB8B0', 0.4),
  meadow: hex('#5E6E4A'), meadowB: hex('#6A7A52'), tv: hex('#3A3A44'), screen: hex('#C9D6D2', 0.95), dusk: hex('#8FB8B0', 0.2),
  sand: hex('#4A3A6A', 0.15), sandB: hex('#54447A', 0.15), coral: hex('#FF2E9A', 0.5), coralB: hex('#19F0FF', 0.6), coralC: hex('#B6FF3B', 0.5),
  flesh: hex('#7A2A4A', 0.2), fleshB: hex('#8A3458', 0.25), pulse: hex('#FF2E9A', 0.9), brass: hex('#C9A25E', 0.2), membrane: hex('#4A1A3A', 0.3),
  lino: hex('#9AA6A0'), linoB: hex('#A8B2AA'), schoolWall: hex('#C9D6D2'), board: hex('#2E4A3A'), chalk: hex('#F4F0EA', 0.6), locker: hex('#4F7A8E'),
};

export const PROCS2: Record<string, Proc> = {
  // ---------------- Cloud Orchard
  cloud: ground(PAL.cloud, PAL.cloudB, PAL.cloudSide, (b, c, y) => { if (c.v === 2) b.sphere(0.8, y + 0.2, -0.6, 0.5, 8, PAL.cloud, 0.5); }),
  cloudramp: ramp(PAL.cloud, PAL.cloudSide),
  cloudwall: (b, c) => { const h = c.cell / 2; b.box(-h, -0.3, -h, h, 1.5, h, PAL.cloudSide, { top: PAL.cloud }); b.sphere(0, 2.4 + (c.v % 2), 0, 1.9, 10, PAL.cloud, 0.6); },
  planettree: (b, c) => {
    PROCS2.cloud(b, c);
    b.cyl(0, 0, 0, 0.35, 0.22, 3.2, 7, PAL.trunk);
    b.sphere(0, 3.9, 0, 1.6, 10, PAL.leaf, 0.75);
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + c.v; b.sphere(Math.cos(a) * 1.4, 3.3 + (i % 2) * 0.6, Math.sin(a) * 1.4, 0.18, 8, hex(['#BDE7FF', '#FFE7A3', '#D9C8FF'][i % 3], 0.8)); b.cyl(Math.cos(a) * 1.4, 3.3 + (i % 2) * 0.6, Math.sin(a) * 1.4, 0.32, 0.32, 0.02, 10, hex('#FFF4E6', 0.6), { cap: false }); }
  },
  glassarch: (b, c) => { PROCS2.cloud(b, c); b.box(-1.8, 0, -0.3, -1.0, 4, 0.3, hex('#BDE7FF', 0.7)); b.box(1.0, 0, -0.3, 1.8, 4, 0.3, hex('#BDE7FF', 0.7)); b.box(-1.8, 4, -0.3, 1.8, 4.5, 0.3, hex('#FFC9DE', 0.7)); },
  ringedplanet: (b, c) => { b.cyl(0, 0, 0, 0.2, 0.3, 0.6, 6, PAL.trunk); b.sphere(0, 1.1, 0, 0.45, 10, hex(['#FFC9DE', '#BDE7FF', '#FFE7A3', '#D9C8FF'][c.v], 0.6)); b.push().translate(0, 1.1, 0).rotateZ(0.4); b.cyl(0, 0, 0, 0.8, 0.8, 0.02, 14, hex('#FFF4E6', 0.8), { cap: false }); b.pop(); },
  ladder: (b) => { b.box(-0.3, 0, -0.05, -0.25, 2.6, 0.05, PAL.trunk); b.box(0.25, 0, -0.05, 0.3, 2.6, 0.05, PAL.trunk); for (let i = 0; i < 7; i++) b.box(-0.3, 0.3 + i * 0.35, -0.03, 0.3, 0.34 + i * 0.35, 0.03, PAL.trunk); },
  cloudsheep: (b) => { b.sphere(0, 0.6, 0, 0.5, 8, PAL.cloud, 0.8); b.sphere(0, 0.7, 0.5, 0.22, 6, hex('#3A2A50')); for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) b.cyl(x, 0, z, 0.06, 0.06, 0.3, 4, hex('#3A2A50')); },
  skywell: (b) => { b.cyl(0, 0, 0, 1.6, 1.6, 0.9, 12, hex('#F6F1FA')); b.cyl(0, 0.9, 0, 1.4, 1.4, 0.02, 12, hex('#BDE7FF', 1)); b.cyl(0, 0.9, 0, 0.12, 0.12, 5, 6, PAL.trunk); b.sphere(0, 6, 0, 0.7, 10, hex('#FFE7A3', 1)); },
  // ---------------- Lantern Market
  boardwalk: lane(PAL.plank, PAL.kerbW, null, 0.1),
  canalside: ground(hex('#3A3050'), hex('#40355A'), PAL.kerbW),
  stall: (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, PAL.plankB);
    b.box(-1.4, 0, -1.2, 1.4, 1.0, 1.2, PAL.plank);
    for (const [x, z] of [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.2], [1.4, 1.2]]) b.box(x - 0.06, 0, z - 0.06, x + 0.06, 2.6, z + 0.06, PAL.plank);
    b.box(-1.6, 2.6, -1.4, 1.6, 2.75, 1.4, [PAL.stallRed, hex('#00E0C6', 0.1), hex('#7A5CFF', 0.1)][c.v % 3]);
    for (let i = 0; i < 4; i++) b.cyl(-1.0 + i * 0.66, 2.1, 1.25, 0.12, 0.12, 0.25, 6, PAL.lanternGlow);
    for (let i = 0; i < 5; i++) b.cbox(-1.1 + i * 0.55, 1.0, 0.2, 0.3, 0.2 + (i % 2) * 0.15, 0.3, hex(['#FFB000', '#FF3D7F', '#00E0C6', '#FFF27A', '#7A5CFF'][i], 0.4));
  },
  teahouse: (b, c) => block(PAL.plankB, hex('#7A3E48'), hex('#3A2A2A'), 5.5, PAL.lanternGlow, hex('#FFD9A0', 0.6))(b, c),
  lanternpost: (b, c) => { b.cyl(0, 0, 0, 0.06, 0.06, 2.4, 5, PAL.kerbW); b.cyl(0, 2.0, 0.3, 0.18, 0.18, 0.4, 8, hex(['#FFB000', '#FF3D7F', '#FFF27A'][c.v % 3], 1)); b.box(-0.03, 2.35, 0, 0.03, 2.4, 0.3, PAL.kerbW); },
  hanginglanterns: (b, c) => { for (let i = 0; i < 5; i++) b.cyl(-1.6 + i * 0.8, -0.3 + Math.sin(i * 2 + c.v) * 0.15, 0, 0.13, 0.13, 0.3, 6, hex(['#FFB000', '#FF3D7F', '#FFF27A', '#00E0C6'][(i + c.v) % 4], 1)); b.box(-1.8, 0.1, -0.01, 1.8, 0.12, 0.01, PAL.kerbW); },
  crate: (b) => b.cbox(0, 0, 0, 0.9, 0.8, 0.9, PAL.paperW),
  greatlantern: (b) => { b.cyl(0, 0, 0, 1.4, 1.4, 0.6, 12, PAL.plank); b.cyl(0, 0.6, 0, 1.2, 1.8, 2.6, 12, hex('#FF3D7F', 1)); b.cyl(0, 3.2, 0, 1.8, 1.0, 2.0, 12, hex('#FFB000', 1)); b.cyl(0, 5.2, 0, 0.3, 0.3, 1.6, 6, PAL.kerbW); },
  marketwall: wall(hex('#3A2A2A'), hex('#4A3A3A'), 4, hex('#FFB000', 0.8)),
  // ---------------- Tidal Stair
  whitestone: ground(PAL.white, PAL.whiteB, hex('#CFCBD8')),
  whitestairs: ramp(PAL.white, hex('#CFCBD8'), 8),
  sea: (b, c) => { const h = c.cell / 2; b.box(-h, -0.6, -h, h, 0.1, h, PAL.seaDeep, { top: c.v % 2 ? PAL.sea : mixc(PAL.sea, PAL.seaDeep, 0.4) }); },
  tidepool: (b, c) => { PROCS2.whitestone(b, c); b.box(-1.5, 0.0, -1.5, 1.5, 0.08, 1.5, PAL.sea); },
  staircolumn: (b, c) => { PROCS2.whitestone(b, c); b.cyl(0, 0, 0, 0.6, 0.5, 6, 10, PAL.white); b.sphere(0, 6.3, 0, 0.4, 8, PAL.moon); },
  bollard: (b) => { b.cyl(0, 0, 0, 0.25, 0.3, 0.8, 8, hex('#E6E4EE')); b.cyl(0, 0.8, 0, 0.3, 0.2, 0.1, 8, hex('#E6E4EE')); },
  buoy: (b) => { b.sphere(0, 0.5, 0, 0.45, 8, hex('#E0484A', 0.2)); b.cyl(0, 0.9, 0, 0.05, 0.05, 0.5, 4, PAL.rail); b.sphere(0, 1.45, 0, 0.12, 6, PAL.moon); },
  moongate: (b) => { b.box(-2.2, 0, -0.4, -1.4, 6, 0.4, PAL.white); b.box(1.4, 0, -0.4, 2.2, 6, 0.4, PAL.white); b.box(-2.2, 6, -0.4, 2.2, 6.8, 0.4, PAL.white); b.sphere(-0.6, 4.5, 0, 0.5, 10, PAL.moon); b.sphere(0.7, 3.6, 0, 0.35, 10, hex('#BDE7FF', 1)); },
  // ---------------- Origami Metro
  rail: (b, c) => { lane(hex('#4A4552'), PAL.paperB, null, 0.2)(b, c); const lines = String(c.tile?.mesh?.params?.lines ?? 's'); if (lines === 's') { for (const x of [-0.7, 0.7]) b.box(x - 0.05, 0, -2, x + 0.05, 0.12, 2, PAL.rail); for (let z = -1.8; z < 2; z += 0.6) b.box(-1, 0, z, 1, 0.06, z + 0.2, PAL.sleeper); } },
  platform: ground(PAL.paper, PAL.paperB, hex('#CFC4AE')),
  paperblock: (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, PAL.paperB);
    // folded facets: a stack of slightly rotated boxes
    for (let i = 0; i < 4; i++) { b.push().rotateY((i % 2 ? 1 : -1) * 0.08 * (c.v + 1)); b.box(-1.5 + i * 0.05, i * 2, -1.5, 1.5 - i * 0.05, i * 2 + 2, 1.5, i % 2 ? PAL.paper : PAL.paperB); b.pop(); }
    b.box(-0.4, 0, 1.5, 0.4, 2, 1.55, PAL.ink);
  },
  tickethall: (b, c) => block(PAL.paper, PAL.paperB, PAL.ink, 4, hex('#FFE7A3', 0.8), PAL.ink)(b, c),
  papertree: (b) => { b.cyl(0, 0, 0, 0.12, 0.08, 1.4, 4, PAL.paperB); b.push().translate(0, 1.4, 0); b.cyl(0, 0, 0, 1.0, 0, 1.6, 4, PAL.paper); b.pop(); },
  paperwall: wall(PAL.paperB, PAL.paper, 6, PAL.ink),
  // ---------------- Drowned Library
  aisle: lane(PAL.flood, hex('#1F3A44'), null, 0.2),
  floodfloor: ground(PAL.flood, PAL.floodB, hex('#1F3A44')),
  bookstack: (b, c) => {
    const h = c.cell / 2;
    b.box(-h, -0.3, -h, h, 0, h, PAL.floodB);
    b.box(-1.7, 0, -0.8, 1.7, 4.5, 0.8, hex('#3A2A2A'));
    for (let s = 0; s < 5; s++) for (let i = 0; i < 9; i++) b.box(-1.6 + i * 0.36, 0.1 + s * 0.88, 0.75, -1.35 + i * 0.36, 0.7 + s * 0.88 - ((i + s + c.v) % 3) * 0.08, 0.82, [PAL.book, PAL.bookB, PAL.bookC][(i + s + c.v) % 3]);
  },
  readingpool: (b, c) => { PROCS2.floodfloor(b, c); b.box(-1.5, 0, -1.5, 1.5, 0.06, 1.5, PAL.green); },
  deepshelves: wall(hex('#3A2A2A'), hex('#2E5E6E'), 7, PAL.green),
  // ---------------- Static Field
  meadow: ground(PAL.meadow, PAL.meadowB, hex('#4A5A3A'), (b, c, y) => { for (let i = 0; i < 3; i++) b.cbox(-1.2 + i * 1.1, y, -0.5 + ((i + c.v) % 3) * 0.6, 0.05, 0.4, 0.05, hex('#8FB8B0')); }),
  meadowramp: ramp(PAL.meadowB, hex('#4A5A3A')),
  tvmound: (b, c) => { PROCS2.meadow(b, c); b.sphere(0, 0, 0, 1.6, 10, PAL.meadowB, 0.6); b.cbox(0, 0.6, 0.4, 1.1, 0.9, 0.8, PAL.tv); b.box(-0.45, 0.75, 0.81, 0.45, 1.35, 0.83, PAL.screen); },
  antenna: (b, c) => { PROCS2.meadow(b, c); b.cyl(0, 0, 0, 0.08, 0.04, 8, 4, PAL.rail); for (let i = 0; i < 4; i++) b.box(-0.8 + i * 0.1, 5 + i * 0.8, -0.02, 0.8 - i * 0.1, 5.05 + i * 0.8, 0.02, PAL.rail); },
  tvflower: (b, c) => { b.cyl(0, 0, 0, 0.04, 0.04, 0.7, 4, hex('#4A5A3A')); b.push().translate(0, 0.7, 0).rotateX(-0.2 - c.v * 0.05); b.cbox(0, 0, 0, 0.55, 0.45, 0.4, PAL.tv); b.box(-0.22, 0.08, 0.2, 0.22, 0.38, 0.22, hex(['#C9D6D2', '#BDE7FF', '#FFC9DE', '#E8C27A'][c.v], 0.95)); b.pop(); },
  greatscreen: (b) => { b.cbox(0, 0, 0, 4.2, 0.6, 1.6, PAL.tv); b.cbox(0, 0.6, 0, 4, 4, 1.2, PAL.tv); b.box(-1.8, 1.0, 0.61, 1.8, 4.3, 0.63, PAL.screen); },
  statichedge: wall(hex('#3A4A30'), hex('#4A5A3A'), 3),
  // ---------------- Fractal Reef
  reefsand: ground(PAL.sand, PAL.sandB, hex('#1A1428'), (b, c, y) => { if (c.v === 1) b.sphere(0.6, y, 0.4, 0.3, 6, PAL.coralC, 0.5); }),
  reeframp: ramp(PAL.sandB, hex('#1A1428')),
  coraltree: (b, c) => {
    PROCS2.reefsand(b, c);
    // a small recursive branching coral (fractal-ish)
    const branch = (x: number, y: number, z: number, len: number, ang: number, rot: number, depth: number) => {
      const ex = x + Math.sin(ang) * Math.cos(rot) * len, ey = y + Math.cos(ang) * len, ez = z + Math.sin(ang) * Math.sin(rot) * len;
      const col = [PAL.coral, PAL.coralB, PAL.coralC][(depth + c.v) % 3];
      b.push().translate(x, y, z).rotateY(-rot).rotateZ(-ang);
      b.cyl(0, 0, 0, 0.12 * (depth + 1) * 0.5, 0.09 * (depth + 1) * 0.5, len, 5, col, { cap: false });
      b.pop();
      if (depth > 0) for (let k = 0; k < 3; k++) branch(ex, ey, ez, len * 0.68, ang * 0.5 + 0.55 * (k - 1) + 0.2, rot + k * 2.1, depth - 1);
      else b.sphere(ex, ey, ez, 0.12, 5, col);
    };
    branch(0, 0, 0, 2.0, 0, c.v, 3);
  },
  braincoral: (b, c) => { PROCS2.reefsand(b, c); b.sphere(0, 0.4, 0, 1.5, 12, PAL.coral, 0.55); },
  anemone: (b, c) => { b.cyl(0, 0, 0, 0.25, 0.3, 0.4, 8, PAL.coralB); for (let i = 0; i < 8; i++) { const a = i * 0.785 + c.v; b.push().translate(Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2).rotateZ(Math.cos(a) * 0.4).rotateX(Math.sin(a) * 0.4); b.cyl(0, 0, 0, 0.04, 0.02, 0.6, 4, PAL.coral); b.pop(); } },
  glasssponge: (b) => { b.cyl(0, 0, 0, 0.3, 0.5, 1.8, 8, hex('#BDE7FF', 0.6)); },
  heartcoral: (b) => { b.sphere(0, 2.5, 0, 2.2, 14, PAL.coral, 0.9); b.cyl(0, 0, 0, 0.8, 1.2, 1.6, 10, PAL.flesh); for (let i = 0; i < 6; i++) b.cyl(Math.cos(i) * 1.6, 3, Math.sin(i) * 1.6, 0.2, 0.1, 3, 5, PAL.coralB); },
  reefwall: wall(hex('#3A2A5A', 0.18), PAL.coralB, 6, PAL.coral),
  // ---------------- The Veins
  tube: (b, c) => { lane(PAL.membrane, PAL.flesh, PAL.pulse, 0.6)(b, c); },
  membrane: ground(PAL.fleshB, PAL.flesh, hex('#3A0A20')),
  veinwall: (b, c) => { const h = c.cell / 2; b.box(-h, -0.3, -h, h, 0, h, PAL.fleshB); b.sphere(0, 1.6, 0, 1.9, 10, PAL.flesh, 1.4); for (let i = 0; i < 3; i++) b.cyl(-1.2 + i * 1.2, 0, 1.6, 0.12, 0.12, 4, 5, PAL.pulse); },
  organpipes: (b, c) => { const h = c.cell / 2; b.box(-h, -0.3, -h, h, 0, h, PAL.fleshB); for (let i = 0; i < 7; i++) b.cyl(-1.2 + i * 0.4, 0, (i % 2) * 0.3, 0.17, 0.17, 4 + Math.abs(3 - i) * 1.4 + c.v * 0.2, 8, PAL.brass); },
  valve: (b) => { b.cyl(0, 0, 0, 0.15, 0.15, 0.9, 6, PAL.brass); b.cyl(0, 0.9, 0, 0.4, 0.4, 0.06, 10, hex('#E0484A', 0.2), { cap: false }); },
  pulsenode: (b) => { b.sphere(0, 0.75, 0, 0.6, 10, PAL.pulse); b.cyl(0, 0, 0, 0.2, 0.3, 0.4, 6, PAL.flesh); },
  veinborder: wall(PAL.flesh, PAL.fleshB, 6, PAL.pulse),
  // ---------------- Night School
  corridor: lane(PAL.lino, hex('#6A7470'), hex('#C9D6D2', 0.05), 0.12),
  schoolyard: ground(hex('#5A6A5A'), hex('#62725F'), hex('#3A4A3A')),
  classroom: (b, c) => {
    block(hex('#5A6A5A'), PAL.schoolWall, hex('#8E96A3'), 3.4, hex('#BDE7FF', 0.2), hex('#E8C27A', 0.9))(b, c);
    b.box(-1.2, 1.2, 1.56, -0.5, 1.9, 1.6, PAL.board); b.box(-1.15, 1.6, 1.61, -0.6, 1.62, 1.62, PAL.chalk);
  },
  labroom: (b, c) => block(hex('#5A6A5A'), hex('#BFD3D8'), hex('#8E96A3'), 3.4, hex('#7FE0E8', 0.6), hex('#E8C27A', 0.9))(b, c),
  musicroom: (b, c) => block(hex('#5A6A5A'), hex('#D9C8FF'), hex('#8E96A3'), 3.4, hex('#FFE7A3', 0.7), hex('#E8C27A', 0.9))(b, c),
  artroom: (b, c) => block(hex('#5A6A5A'), hex('#FFC9DE'), hex('#8E96A3'), 3.4, hex('#FF9AD5', 0.6), hex('#E8C27A', 0.9))(b, c),
  lockers: (b, c) => { for (let i = 0; i < 4; i++) { b.box(-0.9 + i * 0.45, 0, -0.25, -0.47 + i * 0.45, 2, 0.25, PAL.locker); if ((i + c.v) % 3 === 0) b.box(-0.88 + i * 0.45, 1.6, 0.25, -0.5 + i * 0.45, 1.65, 0.27, PAL.chalk); } },
  schoolwall: wall(PAL.schoolWall, hex('#8E96A3'), 6, hex('#FFE7A3', 0.6)),
};
