/**
 * Procedural low-poly geometry builder. Every part carries an RGBA vertex colour where
 * alpha = emissive strength (0..1), which the lo-fi material routes to the light layer.
 */
import * as THREE from 'three/webgpu';

export type RGBA = [number, number, number, number];

export function hex(h: string, emissive = 0): RGBA {
  const v = parseInt(h.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, emissive];
}
export function mixc(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
export function shade(c: RGBA, k: number): RGBA {
  return [c[0] * k, c[1] * k, c[2] * k, c[3]];
}

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  /** Texel density: uv units per metre. */
  uvScale = 0.5;
  private m = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];

  push(): this { this.stack.push(this.m.clone()); return this; }
  pop(): this { this.m = this.stack.pop() ?? new THREE.Matrix4(); return this; }
  translate(x: number, y: number, z: number): this { this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z)); return this; }
  rotateY(a: number): this { this.m.multiply(new THREE.Matrix4().makeRotationY(a)); return this; }
  rotateX(a: number): this { this.m.multiply(new THREE.Matrix4().makeRotationX(a)); return this; }
  rotateZ(a: number): this { this.m.multiply(new THREE.Matrix4().makeRotationZ(a)); return this; }
  scale(x: number, y: number, z: number): this { this.m.multiply(new THREE.Matrix4().makeScale(x, y, z)); return this; }

  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private nm = new THREE.Matrix3();

  tri(a: number[], b: number[], c: number[], col: RGBA, ua: number[], ub: number[], uc: number[]): void {
    this.nm.getNormalMatrix(this.m);
    const p = [a, b, c].map((q) => this.v.set(q[0], q[1], q[2]).applyMatrix4(this.m).toArray());
    const e1 = new THREE.Vector3(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    const e2 = new THREE.Vector3(p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]);
    this.n.crossVectors(e1, e2).normalize();
    for (let i = 0; i < 3; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.col.push(col[0], col[1], col[2], col[3]);
    }
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }

  quad(a: number[], b: number[], c: number[], d: number[], col: RGBA, w = 1, h = 1): void {
    const s = this.uvScale;
    this.tri(a, b, c, col, [0, 0], [w * s, 0], [w * s, h * s]);
    this.tri(a, c, d, col, [0, 0], [w * s, h * s], [0, h * s]);
  }

  /** Axis-aligned box from min corner to max corner (local space). Faces optional colours. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGBA, opts: { top?: RGBA; bottom?: boolean; sides?: RGBA } = {}): this {
    const top = opts.top ?? col;
    const side = opts.sides ?? col;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, w, d); // top
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(col, 0.6), w, d);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shade(side, 0.92), w, h); // +z (south)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(side, 0.8), w, h); // -z (north)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(side, 0.86), d, h); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(side, 0.74), d, h); // -x
    return this;
  }

  /** Box centred at (cx, cz) on the floor y0. */
  cbox(cx: number, y0: number, cz: number, w: number, h: number, d: number, col: RGBA, opts?: { top?: RGBA; bottom?: boolean }): this {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, col, opts);
  }

  /** Cylinder / cone / frustum along +y. */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, col: RGBA, opts: { cap?: boolean; capCol?: RGBA } = {}): this {
    const cap = opts.cap ?? true;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, r: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const k = 0.8 + 0.2 * Math.cos(a0 - 0.8);
      this.quad(p(a0, r0, y0), p(a0, r1, y0 + h), p(a1, r1, y0 + h), p(a1, r0, y0), shade(col, k), (r0 + r1) * 0.5, h);
      if (cap && r1 > 0.001) this.tri([cx, y0 + h, cz], p(a1, r1, y0 + h), p(a0, r1, y0 + h), opts.capCol ?? col, [0, 0], [r1, 0], [0, r1]);
    }
    return this;
  }

  /** Low-poly sphere (icosphere-ish via lat/long). */
  sphere(cx: number, cy: number, cz: number, r: number, seg: number, col: RGBA, squashY = 1): this {
    const rings = Math.max(3, Math.floor(seg / 2));
    const pt = (i: number, j: number) => {
      const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI;
      return [cx + Math.sin(ph) * Math.cos(th) * r, cy + Math.cos(ph) * r * squashY, cz + Math.sin(ph) * Math.sin(th) * r];
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
      const k = 0.75 + 0.25 * (1 - j / rings);
      const c = shade(col, k);
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (j > 0) this.tri(a, cc, b, c, [0, 0], [1, 1], [1, 0]);
      if (j < rings - 1) this.tri(a, d, cc, c, [0, 0], [0, 1], [1, 1]);
    }
    return this;
  }

  /** Flat quad facing +z, centred, of size w x h at height y (a sign, a window pane). */
  panel(cx: number, cy: number, cz: number, w: number, h: number, col: RGBA, rotY = 0): this {
    this.push().translate(cx, cy, cz).rotateY(rotY);
    this.quad([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], col, w, h);
    this.quad([w / 2, -h / 2, 0], [-w / 2, -h / 2, 0], [-w / 2, h / 2, 0], [w / 2, h / 2, 0], shade(col, 0.85), w, h);
    return this.pop();
  }

  /** Wedge ramp: rises from y0 at +z edge to y1 at -z edge (local tile, centred, size c). */
  ramp(c: number, y0: number, y1: number, col: RGBA, sideCol: RGBA): this {
    const h = c / 2;
    this.quad([-h, y0, h], [h, y0, h], [h, y1, -h], [-h, y1, -h], col, c, c * 1.1);
    // sides (triangles + base box)
    this.tri([h, 0, h], [h, 0, -h], [h, y1, -h], shade(sideCol, 0.86), [0, 0], [1, 0], [1, 1]);
    this.tri([h, 0, h], [h, y1, -h], [h, y0, h], shade(sideCol, 0.86), [0, 0], [1, 1], [0, 1]);
    this.tri([-h, 0, -h], [-h, 0, h], [-h, y0, h], shade(sideCol, 0.74), [0, 0], [1, 0], [1, 1]);
    this.tri([-h, 0, -h], [-h, y0, h], [-h, y1, -h], shade(sideCol, 0.74), [0, 0], [1, 1], [0, 1]);
    this.quad([h, 0, -h], [-h, 0, -h], [-h, y1, -h], [h, y1, -h], shade(sideCol, 0.8), c, y1);
    if (y0 > 0) this.quad([-h, 0, h], [h, 0, h], [h, y0, h], [-h, y0, h], shade(sideCol, 0.92), c, y0);
    return this;
  }

  get triangleCount(): number { return this.pos.length / 9; }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
