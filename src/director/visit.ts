/**
 * A Visit is one stay in one realm instance: layout + physics world + live object state.
 * Seed = hash(nightSeed, linkIndex). All visit randomness comes from `rng`.
 */
import { PCG32 } from '../core/rng.ts';
import { PhysicsWorld } from '../core/physics.ts';
import { tuning } from '../core/tuning.ts';
import { buildWalkGrid, floorHeight, rotateRect } from '../realms/layoutgen.ts';
import type { Components, KitDef, Layout, RealmData, Tag } from '../realms/types.ts';

export interface WorldObject {
  /** Index into Visit.objects (stable for the visit). */
  id: number;
  kind: 'prop' | 'tile';
  defId: string;
  /** Layout prop index or cell index. */
  src: number;
  x: number; y: number; z: number;
  /** Visual centre height for gaze/notice targeting. */
  cy: number;
  radius: number;
  height: number;
  rot: number;
  tags: Tag[];
  components: Components;
  /** Mutable dream state. */
  hidden: boolean;
  /** Recolour / swap marker for peripheral mutations (view reads it). */
  variant: number;
  /** Carried by a dreamer (index) or -1. */
  carriedBy: number;
}

let visitCounter = 0;

export class Visit {
  readonly id: number;
  readonly realm: string;
  readonly seed: number;
  readonly kit: KitDef;
  readonly layout: Layout;
  readonly physics: PhysicsWorld;
  readonly rng: PCG32;
  readonly objects: WorldObject[] = [];
  /** Ids of objects with the Linkable component. */
  readonly linkables: number[] = [];
  readonly size: number;
  /** Tick the visit was created. */
  readonly createdTick: number;
  /** Tick when the last dreamer left (for disposal / follow window). */
  emptySince = -1;

  constructor(data: RealmData, layout: Layout, seed: number, tick: number) {
    this.id = ++visitCounter;
    this.realm = layout.realm;
    this.seed = seed;
    this.kit = data.kit;
    this.layout = layout;
    this.rng = new PCG32(seed, 0x7151);
    this.createdTick = tick;
    this.size = layout.grid * layout.cell;
    const m = tuning.move;
    this.physics = new PhysicsWorld({ radius: m.radius, height: m.eyeHeight + 0.2, stepHeight: m.stepHeight, maxSlopeDeg: m.maxSlopeDeg });
    this.buildObjects();
    this.buildPhysics();
  }

  private buildObjects(): void {
    const { layout, kit } = this;
    const tiles = new Map(kit.tiles.map((t) => [t.id, t]));
    // tiles with components (linkable houses, glass walls, monoliths)
    for (let c = 0; c < layout.cells.length; c++) {
      const v = layout.variants[layout.cells[c]];
      const t = tiles.get(v.id)!;
      if (!t.components?.linkable && !t.components?.anomaly) continue;
      const cx = c % layout.grid, cz = Math.floor(c / layout.grid);
      const base = t.floor.kind === 'flat' || t.floor.kind === 'solid' ? t.floor.level * layout.levelHeight : 0;
      const h = t.floor.kind === 'solid' ? t.floor.height : Math.max(1, ...(t.footprints ?? []).map((f) => f.height));
      this.objects.push({
        id: this.objects.length, kind: 'tile', defId: t.id, src: c,
        x: (cx + 0.5) * layout.cell, y: base, z: (cz + 0.5) * layout.cell, cy: base + Math.min(h, 3) * 0.6,
        radius: layout.cell * 0.5, height: h, rot: v.rot, tags: t.tags ?? [], components: t.components ?? {},
        hidden: false, variant: 0, carriedBy: -1,
      });
    }
    layout.props.forEach((p, i) => {
      this.objects.push({
        id: this.objects.length, kind: 'prop', defId: p.id, src: i,
        x: p.x, y: p.y, z: p.z, cy: p.y + Math.max(0.15, p.height * 0.55), radius: p.radius, height: p.height, rot: p.rot,
        tags: p.tags, components: p.components, hidden: false, variant: 0, carriedBy: -1,
      });
    });
    for (const o of this.objects) if (o.components.linkable) this.linkables.push(o.id);
  }

  private buildPhysics(): void {
    const { layout, kit, physics } = this;
    const size = this.size;
    const res = layout.cell <= 2 ? 0.5 : 1;
    const n = Math.round(size / res);
    const heights = new Float32Array((n + 1) * (n + 1));
    const tiles = new Map(kit.tiles.map((t) => [t.id, t]));
    const baseH = (x: number, z: number) => {
      const cx = Math.min(layout.grid - 1, Math.max(0, Math.floor(x / layout.cell)));
      const cz = Math.min(layout.grid - 1, Math.max(0, Math.floor(z / layout.cell)));
      const v = layout.variants[layout.cells[cz * layout.grid + cx]];
      const t = tiles.get(v.id)!;
      const f = t.floor.kind === 'solid' ? { kind: 'flat' as const, level: t.floor.level } : t.floor;
      return floorHeight(f, v.rot, x - cx * layout.cell, z - cz * layout.cell, layout.cell, layout.levelHeight);
    };
    for (let xi = 0; xi <= n; xi++) for (let zi = 0; zi <= n; zi++) {
      // sample just inside the cell so each vertex takes the higher of its neighbours' floors
      const x = xi * res, z = zi * res, e = 0.01;
      heights[xi * (n + 1) + zi] = Math.max(baseH(x - e, z - e), baseH(x + e, z - e), baseH(x - e, z + e), baseH(x + e, z + e));
    }
    physics.addHeightfield(n, heights, size);

    for (let c = 0; c < layout.cells.length; c++) {
      const v = layout.variants[layout.cells[c]];
      const t = tiles.get(v.id)!;
      const cx = c % layout.grid, cz = Math.floor(c / layout.grid);
      const ox = cx * layout.cell, oz = cz * layout.cell;
      const linkObj = t.components?.linkable ? this.objects.find((o) => o.kind === 'tile' && o.src === c) : undefined;
      if (t.floor.kind === 'solid') {
        const y0 = t.floor.level * layout.levelHeight;
        const hc = layout.cell / 2;
        physics.addBox(ox + hc, y0 + t.floor.height / 2, oz + hc, hc, t.floor.height / 2, hc);
        if (linkObj) physics.addSensorBox(linkObj.id, ox + hc, y0 + t.floor.height / 2, oz + hc, hc + 0.25, t.floor.height / 2, hc + 0.25);
      }
      for (const fp of t.footprints ?? []) {
        const r = rotateRect(fp.rect, v.rot, layout.cell);
        const y0 = t.floor.kind === 'flat' ? t.floor.level * layout.levelHeight : 0;
        const hx = (r[2] - r[0]) / 2, hz = (r[3] - r[1]) / 2;
        physics.addBox(ox + (r[0] + r[2]) / 2, y0 + fp.height / 2, oz + (r[1] + r[3]) / 2, hx, fp.height / 2, hz);
        if (linkObj) physics.addSensorBox(linkObj.id, ox + (r[0] + r[2]) / 2, y0 + fp.height / 2, oz + (r[1] + r[3]) / 2, hx + 0.25, fp.height / 2, hz + 0.25);
      }
    }
    for (const o of this.objects) {
      if (o.kind !== 'prop') continue;
      if (o.radius > 0) physics.addCylinder(o.x, o.y - 0.2, o.z, o.radius, o.height + 0.2);
      if (o.components.linkable) physics.addSensorCylinder(o.id, o.x, o.y - 0.2, o.z, Math.max(o.radius, 0.3) + 0.25, o.height + 0.4);
    }
    // realm edge: tall invisible walls
    const wall = 30;
    physics.addBox(-0.5, wall / 2, size / 2, 0.5, wall, size / 2 + 1);
    physics.addBox(size + 0.5, wall / 2, size / 2, 0.5, wall, size / 2 + 1);
    physics.addBox(size / 2, wall / 2, -0.5, size / 2 + 1, wall, 0.5);
    physics.addBox(size / 2, wall / 2, size + 0.5, size / 2 + 1, wall, 0.5);
    physics.step();
  }

  /** Walkability grid (lazily built; used by entities and the Director). */
  private _walk: ReturnType<typeof buildWalkGrid> | null = null;
  get walk() {
    if (!this._walk) this._walk = buildWalkGrid(this.kit, this.layout, true);
    return this._walk;
  }

  dispose(): void {
    this.physics.dispose();
  }
}
