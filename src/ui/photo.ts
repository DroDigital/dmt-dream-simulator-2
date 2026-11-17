/**
 * Photo mode (P / View button): freezes the dream, frees the camera within 5 m of the dreamer,
 * offers every Glyph Suite preset as a filter with live coverage / contrast / cell size, saves PNG.
 * Keys: WASD move, mouse look, Q/E filter, [ ] coverage, - = contrast, , . cell size, Enter save, P exit.
 */
import * as THREE from 'three/webgpu';
import type { Game } from '../director/game.ts';
import type { View } from '../render/view.ts';
import { PRESET_IDS, preset, type GlyphStyle } from '../render/glyph/styles.ts';
import { tuning } from '../core/tuning.ts';

export class PhotoMode {
  active = false;
  private filters: string[] = ['none', ...PRESET_IDS()];
  private idx = 0;
  private coverage = 1;
  private contrast = 0.3;
  private cellPx = 8;
  private origin = new THREE.Vector3();
  readonly cam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private keys = new Set<string>();
  private saveNext = false;
  private label: HTMLDivElement;

  private game: Game;
  private view: View;
  private canvas: HTMLCanvasElement;

  constructor(game: Game, view: View, ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.game = game; this.view = view; this.canvas = canvas;
    this.label = document.createElement('div');
    this.label.className = 'debug';
    this.label.style.cssText = 'left:auto;right:12px;top:auto;bottom:12px;display:none';
    ui.appendChild(this.label);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      this.cam.yaw += e.movementX * tuning.look.mouseSens;
      this.cam.pitch = Math.max(-1.4, Math.min(1.4, this.cam.pitch - e.movementY * tuning.look.mouseSens));
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down && e.code === 'KeyP') { this.toggle(); return; }
    if (!this.active) return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (!down) return;
    if (e.code === 'KeyQ') this.idx = (this.idx + this.filters.length - 1) % this.filters.length;
    if (e.code === 'KeyE') this.idx = (this.idx + 1) % this.filters.length;
    if (e.code === 'BracketLeft') this.coverage = Math.max(0.05, this.coverage - 0.05);
    if (e.code === 'BracketRight') this.coverage = Math.min(1, this.coverage + 0.05);
    if (e.code === 'Minus') this.contrast = Math.max(0, this.contrast - 0.1);
    if (e.code === 'Equal') this.contrast = Math.min(2, this.contrast + 0.1);
    if (e.code === 'Comma') this.cellPx = Math.max(4, this.cellPx - 1);
    if (e.code === 'Period') this.cellPx = Math.min(24, this.cellPx + 1);
    if (e.code === 'Enter') this.saveNext = true;
    this.apply();
  }

  toggle(): void {
    this.active = !this.active;
    const d = this.game.dreamers[0];
    if (this.active && d) {
      this.origin.set(d.body.x, d.body.y + tuning.move.eyeHeight, d.body.z);
      this.cam.pos.copy(this.origin);
      this.cam.yaw = d.body.yaw;
      this.cam.pitch = d.body.pitch;
    }
    this.label.style.display = this.active ? 'block' : 'none';
    this.apply();
  }

  private apply(): void {
    const id = this.filters[this.idx];
    let style: GlyphStyle | null = null;
    if (id !== 'none') style = { ...preset(id), coverage: this.coverage, contrast: this.contrast, cellPx: this.cellPx, depthCells: false, ripples: false };
    this.view.photoStyle = this.active ? style : null;
    this.view.photoPane = this.active ? this.view.panes[0] ?? null : null;
    this.view.photoCamera = this.active ? this.cam : null;
    this.label.textContent = `photo  ${id}  coverage ${this.coverage.toFixed(2)}  contrast ${this.contrast.toFixed(1)}  cell ${this.cellPx}px   [Q/E filter  [ ] coverage  - = contrast  , . cell  Enter save  P exit]`;
  }

  /** Per frame: free camera within 5 m. Returns true while the sim should stay frozen. */
  update(dt: number): boolean {
    if (!this.active) return false;
    const k = this.keys;
    const f = new THREE.Vector3(Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    const r = new THREE.Vector3(Math.cos(this.cam.yaw), 0, Math.sin(this.cam.yaw));
    const v = new THREE.Vector3();
    if (k.has('KeyW')) v.add(f); if (k.has('KeyS')) v.sub(f);
    if (k.has('KeyD')) v.add(r); if (k.has('KeyA')) v.sub(r);
    if (k.has('Space')) v.y += 1; if (k.has('KeyC')) v.y -= 1;
    this.cam.pos.addScaledVector(v, dt * 2);
    const off = this.cam.pos.clone().sub(this.origin);
    if (off.length() > 5) this.cam.pos.copy(this.origin).add(off.setLength(5));
    return true;
  }

  /** Call right after the frame is drawn so the canvas still holds it. */
  afterRender(): void {
    if (!this.saveNext) return;
    this.saveNext = false;
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dmt-night${this.game.night}-${this.filters[this.idx]}.png`;
      a.click();
    }, 'image/png');
  }
}
