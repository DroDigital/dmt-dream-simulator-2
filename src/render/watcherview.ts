/**
 * The Watcher's look: a 2.4 m figure in a long coat whose body is a hole: a screen-space,
 * colour-inverted view of the scene behind him, mixed with static. Original design.
 */
import * as THREE from 'three/webgpu';
import * as TSLNS from 'three/tsl';
import { MeshBuilder, hex } from './meshkit.ts';
import { snappedVertex, U } from './lofi.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
const { Fn, vec3, vec4, float, fract, sin, dot, floor, mix, screenCoordinate, viewportSharedTexture, screenUV, mrt } = TSLNS as any;

let holeMat: THREE.MeshBasicNodeMaterial | null = null;

function holeMaterial(): THREE.MeshBasicNodeMaterial {
  if (holeMat) return holeMat;
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true; // drawn after the opaque scene so the hole can see what is behind him
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.vertexNode = snappedVertex;
  m.colorNode = Fn(() => {
    const behind: N = viewportSharedTexture(screenUV).rgb;
    const px: N = floor(screenCoordinate.xy.div(2));
    const n: N = fract(sin(dot(px.add(floor(U.time.mul(24)).mul(13.1)), TSLNS.vec2(12.9898, 78.233) as N)).mul(43758.5453));
    const inv: N = vec3(1).sub(behind);
    return vec4(mix(inv, vec3(n), float(0.35)), 1);
  })();
  m.mrtNode = mrt({ emissive: vec4(0, 0, 0, 1) });
  holeMat = m;
  return m;
}

export function watcherMesh(): THREE.Group {
  const g = new THREE.Group();
  const b = new MeshBuilder();
  // the hole: coat body + head, slightly inset inside the coat edges
  b.cyl(0, 0.05, 0, 0.5, 0.34, 1.75, 10, hex('#000000'));
  b.cyl(0, 1.8, 0, 0.34, 0.42, 0.25, 10, hex('#000000'));
  b.sphere(0, 2.22, 0, 0.18, 10, hex('#000000'), 1.15);
  g.add(new THREE.Mesh(b.toGeometry(), holeMaterial()));
  // coat rim + hat brim in near-black (never fully black: tiny emissive)
  const rim = new MeshBuilder();
  rim.cyl(0, 0.0, 0, 0.53, 0.53, 0.06, 10, hex('#16121C', 0.02), { cap: false });
  rim.cyl(0, 2.38, 0, 0.32, 0.32, 0.04, 10, hex('#16121C', 0.02));
  rim.cyl(0, 2.42, 0, 0.17, 0.15, 0.2, 10, hex('#16121C', 0.02));
  const rimMat = new THREE.MeshBasicNodeMaterial({ color: 0x16121c });
  g.add(new THREE.Mesh(rim.toGeometry(), rimMat));
  return g;
}
