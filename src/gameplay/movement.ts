/** Dreamer locomotion and look: springs and eases everywhere, nothing linear. */
import { BTN, type InputFrame } from '../core/input.ts';
import { DEG, tuning } from '../core/tuning.ts';
import type { PhysicsWorld, CharacterHandle } from '../core/physics.ts';

export interface Body {
  x: number; y: number; z: number;
  vx: number; vz: number; ax: number; az: number; vy: number;
  yaw: number; pitch: number;
  /** Look targets (input integrates into these; the view follows with a spring). */
  yawT: number; pitchT: number;
  yawV: number; pitchV: number;
  roll: number;
  quickTurn: number; quickFrom: number; quickTo: number;
  floatT: number;
  grounded: boolean;
  fallStartY: number;
  airTime: number;
}

export function makeBody(x: number, y: number, z: number, yaw: number): Body {
  return {
    x, y, z, vx: 0, vz: 0, ax: 0, az: 0, vy: 0, yaw, pitch: 0, yawT: yaw, pitchT: 0, yawV: 0, pitchV: 0, roll: 0,
    quickTurn: 0, quickFrom: 0, quickTo: 0, floatT: 0, grounded: true, fallStartY: y, airTime: 0,
  };
}

/** Critically damped spring step for value x toward target with velocity v. */
export function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const nx = (f * x + dt * v + hhoo * target) * det;
  const nv = (v + hoo * (target - x)) * det;
  return [nx, nv];
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface MoveResult {
  /** Fell more than 1.5 m this landing. */
  fell: boolean;
  moved: number;
}

/**
 * Advance look + locomotion for one tick. `scale` = dreamer size (Giant/Tiny laws), `gravityMul` (Feather),
 * `timeScale` (ghost doors), `floatLimit` (seconds of float, Infinity at Clear).
 */
export function stepBody(
  b: Body, input: InputFrame, prevButtons: number, dt: number, phys: PhysicsWorld, ch: CharacterHandle,
  opts: { scale?: number; gravityMul?: number; timeScale?: number; floatLimit?: number; mirror?: boolean; lookScale?: number; frozen?: boolean } = {},
): MoveResult {
  const ts = opts.timeScale ?? 1;
  const sdt = dt * ts;
  const lookScale = opts.lookScale ?? 1;
  const mirror = opts.mirror ? -1 : 1;
  // ---- look ----
  const pressed = input.buttons & ~prevButtons;
  if (b.quickTurn <= 0) {
    if (pressed & BTN.QUICK_L) { b.quickTurn = tuning.look.quickTurnS; b.quickFrom = b.yawT; b.quickTo = b.yawT - 90 * DEG * mirror; }
    else if (pressed & BTN.QUICK_R) { b.quickTurn = tuning.look.quickTurnS; b.quickFrom = b.yawT; b.quickTo = b.yawT + 90 * DEG * mirror; }
  }
  if (b.quickTurn > 0) {
    b.quickTurn = Math.max(0, b.quickTurn - dt);
    const t = 1 - b.quickTurn / tuning.look.quickTurnS;
    b.yawT = b.quickFrom + (b.quickTo - b.quickFrom) * easeInOut(t);
  }
  b.yawT += input.lx * lookScale * mirror;
  b.pitchT = Math.max(-85 * DEG, Math.min(85 * DEG, b.pitchT + input.ly * lookScale));
  const omega = tuning.look.springOmega;
  [b.yaw, b.yawV] = spring(b.yaw, b.yawV, b.yawT, omega, dt);
  [b.pitch, b.pitchV] = spring(b.pitch, b.pitchV, b.pitchT, omega, dt);
  const rollT = Math.max(-tuning.look.rollMaxDeg, Math.min(tuning.look.rollMaxDeg, -b.yawV * 0.9)) * DEG;
  b.roll += (rollT - b.roll) * (1 - Math.exp(-8 * dt));

  // ---- locomotion ----
  const scale = opts.scale ?? 1;
  const speed = (input.buttons & BTN.DRIFT ? tuning.move.drift : tuning.move.walk) * scale;
  const frozen = opts.frozen ?? false;
  const sx = frozen ? 0 : input.mx * mirror, sz = frozen ? 0 : input.mz;
  // forward = (sin yaw, -cos yaw) in x/z (yaw 0 looks toward -z, i.e. north)
  const fx = Math.sin(b.yaw), fz = -Math.cos(b.yaw);
  const rx = Math.cos(b.yaw), rz = Math.sin(b.yaw);
  const tvx = (fx * sz + rx * sx) * speed;
  const tvz = (fz * sz + rz * sx) * speed;
  [b.vx, b.ax] = spring(b.vx, b.ax, tvx, tuning.move.accelOmega, sdt);
  [b.vz, b.az] = spring(b.vz, b.az, tvz, tuning.move.accelOmega, sdt);

  // gravity + float
  const g = tuning.move.gravity * (opts.gravityMul ?? 1) * Math.max(0.3, Math.sqrt(scale));
  const floating = (input.buttons & BTN.FLOAT) !== 0 && !b.grounded && b.floatT < (opts.floatLimit ?? tuning.move.floatTime);
  if (floating) b.floatT += sdt;
  if (b.grounded) b.floatT = 0;
  b.vy -= g * sdt;
  if (floating && b.vy < 0) b.vy = Math.max(b.vy, -2.2 * tuning.move.floatFallScale * 4 * Math.sqrt(scale));
  b.vy = Math.max(b.vy, -40);

  const wasGrounded = b.grounded;
  const ox = b.x, oz = b.z;
  phys.move(ch, b.vx * sdt, b.vy * sdt, b.vz * sdt);
  b.x = ch.x; b.y = ch.y; b.z = ch.z;
  b.grounded = ch.grounded;
  let fell = false;
  if (b.grounded) {
    if (!wasGrounded && b.fallStartY - b.y > 1.5 * scale) fell = true;
    b.vy = Math.max(b.vy, -0.5);
    if (b.vy < 0) b.vy = -0.5;
    b.fallStartY = b.y;
    b.airTime = 0;
  } else {
    b.airTime += sdt;
    if (b.y > b.fallStartY) b.fallStartY = b.y;
  }
  // keep velocity honest when blocked
  if (sdt > 0) {
    const realVx = (b.x - ox) / sdt, realVz = (b.z - oz) / sdt;
    if (Math.abs(realVx) < Math.abs(b.vx)) b.vx = realVx;
    if (Math.abs(realVz) < Math.abs(b.vz)) b.vz = realVz;
  }
  return { fell, moved: Math.hypot(b.x - ox, b.z - oz) };
}
