import { BTN, type InputFrame } from '../../src/core/input.ts';
import { PCG32 } from '../../src/core/rng.ts';
import type { Game } from '../../src/director/game.ts';

/** A scripted wandering bot: lies down in the Flat, then walks, turns and drifts toward things. */
export class Bot {
  private rng: PCG32;
  private turnT = 0;
  private turn = 0;
  private player: number;
  constructor(seed: number, player = 0) { this.rng = new PCG32(seed, 0xb07); this.player = player; }
  frame(game: Game): InputFrame {
    const d = game.dreamers[this.player];
    if (game.mode === 'morning') return { mx: 0, mz: 0, lx: 0, ly: 0, buttons: d.state === 'lying' ? 0 : BTN.LIE };
    if (this.turnT <= 0) { this.turnT = 30 + this.rng.int(120); this.turn = (this.rng.next() - 0.5) * 0.06; }
    this.turnT--;
    const buttons = this.rng.chance(0.4) ? BTN.DRIFT : 0;
    return { mx: Math.round((this.rng.next() - 0.5) * 0.4 * 127) / 127, mz: 1, lx: Math.round(this.turn * 1e5) / 1e5, ly: 0, buttons };
  }
}
