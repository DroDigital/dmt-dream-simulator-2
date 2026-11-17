/**
 * Afterimage (§3.13, unlocks night 20): replay the previous night exactly from seed + input log.
 * Repeat the same inputs -> the same dream. Deviate (any live input that differs) -> it branches.
 */
import { EMPTY_FRAME, unpackFrame, type InputFrame } from '../core/input.ts';
import { Game, type NightRecord } from './game.ts';

export class AfterimagePlayer {
  readonly game: Game;
  private rec: NightRecord;
  private i = 0;
  branched = false;
  readonly ticks: number;

  constructor(rec: NightRecord) {
    this.rec = rec;
    this.game = Game.fromSnapshot(rec.snapshot);
    this.game.startNight();
    this.ticks = rec.log.length / 4 / rec.snapshot.players;
  }

  get done(): boolean { return this.game.mode !== 'night'; }

  /** Logged frames for the next tick, or live frames once the dreamer deviates. */
  frames(live?: InputFrame[]): InputFrame[] {
    const n = this.rec.snapshot.players;
    if (!this.branched && this.i < this.ticks) {
      const out: InputFrame[] = [];
      for (let p = 0; p < n; p++) {
        const k = (this.i * n + p) * 4;
        const l = this.rec.log;
        out.push(unpackFrame(l[k], l[k + 1], l[k + 2], l[k + 3]));
      }
      this.i++;
      const deviates = live?.some((f, p) => f && (Math.abs(f.mx) + Math.abs(f.mz) > 0.3 || (f.buttons & ~(out[p]?.buttons ?? 0)) !== 0));
      if (!deviates) return out;
      this.branched = true;
    }
    return live ?? out_empty(n);
  }

  step(live?: InputFrame[]): void {
    this.game.step(this.frames(live));
  }
}

function out_empty(n: number): InputFrame[] {
  return Array.from({ length: n }, () => ({ ...EMPTY_FRAME }));
}

/** Headless full replay; returns the replayed night record. */
export function replayNight(rec: NightRecord, maxTicks = 60 * 60 * 40): NightRecord {
  const p = new AfterimagePlayer(rec);
  for (let t = 0; t < maxTicks && !p.done; t++) p.step();
  return p.game.lastNight!;
}
