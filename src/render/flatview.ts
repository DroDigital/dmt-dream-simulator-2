/** Lantern Flat extras: placed souvenirs on their slots and the impossible city beyond the window. */
import * as THREE from 'three/webgpu';
import { MeshBuilder, hex } from './meshkit.ts';
import { plainMaterial, souvenirMesh } from './entities.ts';
import { ROOM_SLOTS } from '../realms/lantern-flat/flat.ts';
import type { Household } from '../director/household.ts';
import { PCG32 } from '../core/rng.ts';

export class FlatExtras {
  readonly group = new THREE.Group();
  private placed = new Map<string, { id: string; mesh: THREE.Object3D }>();

  constructor() {
    // the impossible city: towers that rise forever, some upside down, lit windows
    const b = new MeshBuilder();
    const rng = new PCG32(77);
    for (let i = 0; i < 160; i++) {
      const x = rng.range(-120, 130), z = rng.range(-260, -18);
      const w = rng.range(3, 9), h = rng.range(10, 70), d = rng.range(3, 9);
      const y0 = rng.chance(0.15) ? rng.range(40, 90) : -30; // a few float
      const body = hex(rng.pick(['#2A2440', '#33294A', '#1F2236', '#3A2C40']), 0.05);
      b.box(x, y0, z, x + w, y0 + h, z + d, body);
      for (let k = 0; k < 6; k++) {
        const wy = y0 + rng.range(2, h - 2), wx = x + rng.range(0.3, w - 0.8);
        b.box(wx, wy, z + d, wx + 0.5, wy + 0.7, z + d + 0.05, hex(rng.pick(['#FFD9A0', '#FFC9DE', '#BDE7FF', '#FFE7A3']), 1));
      }
    }
    for (let i = 0; i < 6; i++) b.sphere(rng.range(-80, 80), rng.range(60, 120), rng.range(-300, -200), rng.range(3, 8), 10, hex('#FFF4E6', 1));
    const city = new THREE.Mesh(b.toGeometry(), plainMaterial());
    this.group.add(city);
  }

  sync(h: Household, time: number): void {
    for (const slot of ROOM_SLOTS) {
      const id = h.room[slot.id];
      const cur = this.placed.get(slot.id);
      if (cur && cur.id !== id) { this.group.remove(cur.mesh); this.placed.delete(slot.id); }
      if (id && !this.placed.has(slot.id)) {
        const mesh = souvenirMesh(id);
        mesh.position.set(slot.x, slot.y, slot.z);
        this.group.add(mesh);
        this.placed.set(slot.id, { id, mesh });
      }
      const p = this.placed.get(slot.id);
      if (p) p.mesh.rotation.y = Math.sin(time * 0.3 + slot.x) * 0.3;
    }
  }
}
