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
    let buttons = this.rng.chance(0.4) ? BTN.DRIFT : 0;
    if (this.rng.chance(0.004)) buttons |= BTN.BLINK;
    if (this.rng.chance(0.01)) buttons |= BTN.INTERACT;
    // sometimes stop and look around (lets the bot notice things)
    if ((game.tick >> 7) % 4 === 3) return { mx: 0, mz: 0, lx: Math.round(Math.sin(game.tick * 0.02) * 0.004 * 1e5) / 1e5, ly: 0, buttons };
    return { mx: Math.round((this.rng.next() - 0.5) * 0.4 * 127) / 127, mz: 1, lx: Math.round(this.turn * 1e5) / 1e5, ly: 0, buttons };
  }
}

/** An attentive bot: looks at the nearest live anomaly it has not noticed yet, otherwise wanders. */
export class AttentiveBot {
  private wander: Bot;
  private player: number;
  constructor(seed: number, player = 0) { this.wander = new Bot(seed, player); this.player = player; }
  frame(game: Game): InputFrame {
    const d = game.dreamers[this.player];
    if (game.mode === 'morning' || d.state !== 'dreaming') return this.wander.frame(game);
    const vd = game.directors.get(d.visit.id);
    let best: { x: number; y: number; z: number } | null = null, bestD = Infinity;
    for (const a of vd?.anomalies ?? []) {
      if (a.noticed & (1 << d.index)) continue;
      if (a.visibleTo !== -1 && !(a.visibleTo & (1 << d.index))) continue;
      const dist = Math.hypot(a.x - d.body.x, a.z - d.body.z);
      const w = a.kind === "motif" ? dist * 0.2 : dist;
      if (w < bestD && (dist < 60 || a.kind === "motif")) { bestD = w; best = a; }
    }
    if (!best) return this.wander.frame(game);
    const [ex, ey, ez] = game.eye(d);
    const yaw = Math.atan2(best.x - ex, -(best.z - ez));
    const pitch = Math.atan2(best.y - ey, Math.hypot(best.x - ex, best.z - ez));
    let dy = yaw - d.body.yawT;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const dp = pitch - d.body.pitchT;
    const q = (v: number) => Math.round(Math.max(-0.05, Math.min(0.05, v * 0.15)) * 1e5) / 1e5;
    return { mx: 0, mz: bestD > 25 ? 0.6 : 0, lx: q(dy), ly: q(dp), buttons: 0 };
  }
}
