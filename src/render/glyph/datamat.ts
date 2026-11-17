import * as THREE from 'three/webgpu';

/**
 * A material for data passes: alpha is a payload channel, so the material must be "transparent"
 * (three forces alpha = 1 on opaque materials) with blending disabled.
 */
export function dataMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true;
  m.blending = THREE.NoBlending;
  m.depthTest = false;
  m.depthWrite = false;
  return m;
}
