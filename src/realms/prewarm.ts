/**
 * Pre-warm: generate likely next layouts in a Web Worker so linking never stalls the main thread.
 * The visit seed of the next link is known in advance (hash(nightSeed, linkIndex)); only the realm is not,
 * so we prepare every dream realm for the next few link indices. Results are identical to synchronous
 * generation, so determinism is unaffected.
 */
import type { Game } from '../director/game.ts';
import { DREAM_REALMS } from './registry.ts';
import { hash } from '../core/rng.ts';

export class Prewarmer {
  private worker: Worker | null = null;
  private inflight = new Set<string>();
  private game: Game;

  constructor(game: Game) {
    this.game = game;
    try {
      this.worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { realm, seed, layout } = e.data;
        this.inflight.delete(`${realm}:${seed}`);
        if (layout) this.game.provideLayout(realm, seed, layout);
      };
    } catch { this.worker = null; }
  }

  /** Call every frame; cheap when nothing is needed. */
  update(): void {
    if (!this.worker) return;
    const g = this.game;
    const seeds: number[] = [];
    if (g.mode === 'night') for (let k = 0; k < 2; k++) seeds.push(g.visitSeed(g.linkIndex + k));
    else {
      // morning: tonight's first visit and the postcards
      const nightSeed = hash(g.runSeed, g.night);
      seeds.push(hash(nightSeed, 0), hash(nightSeed, 0xc0de));
    }
    for (const seed of seeds) for (const realm of DREAM_REALMS) {
      const key = `${realm}:${seed}`;
      if (this.inflight.has(key) || g.hasLayout(realm, seed)) continue;
      if (this.inflight.size >= 3) return;
      this.inflight.add(key);
      this.worker.postMessage({ realm, seed });
    }
  }
}
