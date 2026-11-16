/**
 * Postcards: one 256x144 render per realm, made during the load at night start (§3.6).
 * Shown on ghost doors and the free-link ring.
 */
import * as THREE from 'three/webgpu';
import type { Game } from '../director/game.ts';
import { Visit } from '../director/visit.ts';
import { hash } from '../core/rng.ts';
import { DREAM_REALMS, REALM_DATA } from '../realms/registry.ts';
import { RealmView } from './realmview.ts';
import { SCENE_MRT } from './pane.ts';
import { U } from './lofi.ts';

export class Postcards {
  readonly cards = new Map<string, THREE.RenderTarget>();
  private builtFor = -1;

  get(realm: string): THREE.Texture | null {
    return this.cards.get(realm)?.textures[0] ?? null;
  }

  build(renderer: THREE.WebGPURenderer, game: Game): void {
    if (this.builtFor === game.nightSeed) return;
    this.builtFor = game.nightSeed;
    for (const realm of DREAM_REALMS) {
      let rt = this.cards.get(realm);
      if (!rt) {
        rt = new THREE.RenderTarget(256, 144, { count: 3, type: THREE.HalfFloatType, depthBuffer: true });
        rt.textures[0].name = 'output'; rt.textures[1].name = 'emissive'; rt.textures[2].name = 'normal';
        for (const t of rt.textures) { t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; }
        this.cards.set(realm, rt);
      }
      const seed = hash(game.nightSeed, 0xc0de);
      const visit = new Visit(REALM_DATA[realm], game.layoutFor(realm, seed), seed, 0);
      const rv = new RealmView(visit);
      const cam = new THREE.PerspectiveCamera(70, 256 / 144, 0.1, 500);
      cam.rotation.order = 'YXZ';
      const lm = visit.layout.landmark;
      const sp = visit.layout.spawns[0];
      cam.position.set(sp.x, sp.y + 1.6, sp.z);
      cam.lookAt(lm.x, lm.y + 3, lm.z);
      rv.applyAtmos();
      (U.snapGrid.value as THREE.Vector2).set(128, 72);
      renderer.setRenderTarget(rt);
      renderer.setMRT(SCENE_MRT);
      renderer.render(rv.scene, cam);
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      rv.dispose();
      visit.dispose();
    }
  }
}
