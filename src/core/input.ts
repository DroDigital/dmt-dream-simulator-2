/**
 * Input: keyboard + mouse (Pointer Lock) as one device, up to 4 gamepads.
 * Devices are sampled once per simulation tick into a quantised InputFrame per player,
 * so live play and Afterimage replay feed the sim identical numbers.
 */
import { tuning } from './tuning.ts';

export const BTN = {
  DRIFT: 1 << 0,
  FLOAT: 1 << 1,
  BLINK: 1 << 2,
  INTERACT: 1 << 3,
  LIE: 1 << 4,
  QUICK_L: 1 << 5,
  QUICK_R: 1 << 6,
  PHOTO: 1 << 7,
  START: 1 << 8,
  ANY: 1 << 9,
} as const;

export interface InputFrame {
  /** Strafe (-1..1, right positive) and forward (-1..1). Quantised to 1/127. */
  mx: number;
  mz: number;
  /** Look deltas this tick in radians (yaw right positive, pitch up positive). Quantised to 1e-5. */
  lx: number;
  ly: number;
  buttons: number;
}

export const EMPTY_FRAME: Readonly<InputFrame> = Object.freeze({ mx: 0, mz: 0, lx: 0, ly: 0, buttons: 0 });

export function quantiseFrame(f: InputFrame): InputFrame {
  return {
    mx: Math.round(Math.max(-1, Math.min(1, f.mx)) * 127) / 127,
    mz: Math.round(Math.max(-1, Math.min(1, f.mz)) * 127) / 127,
    lx: Math.round(f.lx * 1e5) / 1e5,
    ly: Math.round(f.ly * 1e5) / 1e5,
    buttons: f.buttons | 0,
  };
}

/** Pack frames into a compact Int32 log (4 ints per frame) for saves. */
export function packFrame(f: InputFrame): [number, number, number, number] {
  return [((Math.round(f.mx * 127) & 0xff) << 8) | (Math.round(f.mz * 127) & 0xff), Math.round(f.lx * 1e5), Math.round(f.ly * 1e5), f.buttons];
}
export function unpackFrame(a: number, b: number, c: number, d: number): InputFrame {
  const sx = (a >> 8) & 0xff, sz = a & 0xff;
  return { mx: ((sx << 24) >> 24) / 127, mz: ((sz << 24) >> 24) / 127, lx: b / 1e5, ly: c / 1e5, buttons: d };
}

export type DeviceId = 'kbm' | `pad${number}`;

export interface PlayerBinding {
  invertY: boolean;
  lookSens: number;
  rumble: boolean;
}

export class InputSystem {
  private keys = new Set<string>();
  private mouseButtons = 0;
  private mdx = 0;
  private mdy = 0;
  private target: HTMLElement | null = null;
  /** Device assigned to each player slot (index = player). */
  readonly slots: DeviceId[] = [];
  readonly bindings: PlayerBinding[] = [];
  /** Devices that pressed something this tick while unassigned (join requests). */
  readonly joinRequests: DeviceId[] = [];
  private padPrev = new Map<number, number>();
  enabled = true;

  attach(el: HTMLElement): void {
    this.target = el;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons = 0; });
  }

  get pointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    if (this.target && !this.pointerLocked) this.target.requestPointerLock?.()?.catch?.(() => {});
  }

  addPlayer(device: DeviceId): number {
    const existing = this.slots.indexOf(device);
    if (existing >= 0) return existing;
    if (this.slots.length >= 4) return -1;
    this.slots.push(device);
    this.bindings.push({ invertY: false, lookSens: 1, rumble: true });
    return this.slots.length - 1;
  }

  removePlayer(index: number): void {
    this.slots.splice(index, 1);
    this.bindings.splice(index, 1);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown') {
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    } else this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.mdx += e.movementX;
    this.mdy += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    this.mouseButtons |= 1 << e.button;
    if (!this.pointerLocked) this.requestPointerLock();
  };
  private onMouseUp = (e: MouseEvent) => { this.mouseButtons &= ~(1 << e.button); };

  isKeyDown(code: string): boolean { return this.keys.has(code); }

  /** Sample all players for one tick. `first` = first sim step of this render frame (receives mouse delta). */
  sample(dt: number, first: boolean): InputFrame[] {
    this.joinRequests.length = 0;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const frames: InputFrame[] = [];
    const kbmActive = this.keys.size > 0 || this.mouseButtons !== 0;
    if (kbmActive && !this.slots.includes('kbm')) this.joinRequests.push('kbm');
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const id: DeviceId = `pad${p.index}`;
      const pressed = p.buttons.some((b) => b.pressed);
      if (pressed && !this.slots.includes(id)) this.joinRequests.push(id);
    }
    for (let s = 0; s < this.slots.length; s++) {
      const dev = this.slots[s];
      const bind = this.bindings[s];
      let f: InputFrame;
      if (!this.enabled) f = { ...EMPTY_FRAME };
      else if (dev === 'kbm') f = this.sampleKbm(first, bind);
      else {
        const pad = Array.from(pads).find((p) => p && `pad${p.index}` === dev) ?? null;
        f = pad ? this.samplePad(pad, dt, bind) : { ...EMPTY_FRAME };
      }
      frames.push(quantiseFrame(f));
    }
    if (first) { this.mdx = 0; this.mdy = 0; }
    return frames;
  }

  private sampleKbm(first: boolean, bind: PlayerBinding): InputFrame {
    const k = this.keys;
    const mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const mz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const len = Math.hypot(mx, mz) || 1;
    const sens = tuning.look.mouseSens * bind.lookSens;
    let buttons = 0;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) buttons |= BTN.DRIFT;
    if (k.has('Space')) buttons |= BTN.FLOAT;
    if (this.mouseButtons & 4) buttons |= BTN.BLINK;
    if (this.mouseButtons & 1) buttons |= BTN.INTERACT;
    if (k.has('KeyC')) buttons |= BTN.LIE;
    if (k.has('KeyQ')) buttons |= BTN.QUICK_L;
    if (k.has('KeyE')) buttons |= BTN.QUICK_R;
    if (k.has('KeyP')) buttons |= BTN.PHOTO;
    if (k.has('Escape') || k.has('Backspace')) buttons |= BTN.START;
    if (k.size || this.mouseButtons) buttons |= BTN.ANY;
    return {
      mx: mx / len, mz: mz / len,
      lx: first ? this.mdx * sens : 0,
      ly: first ? -this.mdy * sens * (bind.invertY ? -1 : 1) : 0,
      buttons,
    };
  }

  private samplePad(p: Gamepad, dt: number, bind: PlayerBinding): InputFrame {
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const ax = dz(p.axes[0] ?? 0), az = -dz(p.axes[1] ?? 0);
    const rx = dz(p.axes[2] ?? 0), ry = -dz(p.axes[3] ?? 0);
    const curve = (v: number) => Math.sign(v) * v * v;
    const sens = tuning.look.padSens * bind.lookSens * dt;
    const b = (i: number) => p.buttons[i]?.pressed ?? false;
    let buttons = 0;
    if (b(10)) buttons |= BTN.DRIFT;
    if (b(0)) buttons |= BTN.FLOAT;
    if (b(1)) buttons |= BTN.BLINK;
    if (b(2)) buttons |= BTN.INTERACT;
    if (b(13)) buttons |= BTN.LIE;
    if (b(4)) buttons |= BTN.QUICK_L;
    if (b(5)) buttons |= BTN.QUICK_R;
    if (b(8)) buttons |= BTN.PHOTO;
    if (b(9)) buttons |= BTN.START;
    if (p.buttons.some((x) => x.pressed)) buttons |= BTN.ANY;
    const len = Math.max(1, Math.hypot(ax, az));
    return { mx: ax / len, mz: az / len, lx: curve(rx) * sens, ly: curve(ry) * sens * (bind.invertY ? -1 : 1), buttons };
  }

  /** Rumble via Gamepad vibrationActuator (no-op for keyboard). */
  rumble(player: number, ms: number, strong: number, weak = strong * 0.5): void {
    const dev = this.slots[player];
    if (!dev || dev === 'kbm' || !this.bindings[player]?.rumble) return;
    const idx = Number(dev.slice(3));
    const pad = navigator.getGamepads?.()[idx];
    const act = (pad as unknown as { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
    act?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
