/**
 * The 10-second capture (§4): a lucid dreamer touches a vending machine in Evening Suburb; time slows;
 * two ghost doors rise showing the Prism Cathedral and the Glyph Desert; they walk into the Glyph Desert
 * and the suburb pours away into moving characters.
 *
 * Scripted input: walk to the nearest vending machine, touch it, then steer into the right-hand door.
 */
import type { InputFrame } from '../core/input.ts';
import type { Game } from '../director/game.ts';

export function setupCapture(game: Game): (g: Game) => InputFrame[] {
  game.forcedDoors = ['prism-cathedral', 'glyph-desert'];
  let phase: 'flat' | 'approach' | 'doors' | 'after' = 'flat';
  return (g) => g.dreamers.map((d) => {
    if (g.mode === 'morning') return { mx: 0, mz: 0, lx: 0, ly: 0, buttons: d.state === 'lying' ? 0 : 16 };
    if (d.state !== 'dreaming') return { mx: 0, mz: 0, lx: 0, ly: 0, buttons: 0 };
    if (phase === 'flat') { phase = 'approach'; d.lucidity = 62; d.level = 2; }
    const steer = (tx: number, tz: number, speed: number): InputFrame => {
      const yaw = Math.atan2(tx - d.body.x, -(tz - d.body.z));
      let dy = yaw - d.body.yawT;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      const pitchErr = -0.05 - d.body.pitchT;
      return { mx: 0, mz: Math.abs(dy) < 0.6 ? speed : 0.1, lx: Math.round(Math.max(-0.04, Math.min(0.04, dy * 0.12)) * 1e5) / 1e5, ly: Math.round(pitchErr * 0.1 * 1e5) / 1e5, buttons: 0 };
    };
    if (d.doors) {
      phase = 'doors';
      const door = d.doors.doors.find((x) => x.realm === 'glyph-desert')!;
      return d.doors.t < 1.2 ? { mx: 0, mz: 0, lx: 0, ly: 0, buttons: 0 } : steer(door.x, door.z, 0.55);
    }
    if (phase === 'doors' || d.visit.realm !== 'evening-suburb') { phase = 'after'; return { mx: 0, mz: 0.35, lx: 0.004, ly: 0, buttons: 0 }; }
    // nearest vending machine
    let best = null as null | { x: number; z: number }, bd = Infinity;
    for (const o of d.visit.objects) if (o.defId === 'vending-machine' && !o.hidden) {
      const dist = Math.hypot(o.x - d.body.x, o.z - d.body.z);
      if (dist < bd) { bd = dist; best = o; }
    }
    if (!best) return { mx: 0, mz: 1, lx: 0, ly: 0, buttons: 0 };
    return steer(best.x, best.z, bd > 6 ? 1 : 0.5);
  });
}
