/**
 * Fixed 60 Hz simulation with render interpolation. Pauses when the window loses focus.
 */
export interface LoopHooks {
  /** One fixed simulation step. */
  step(dt: number): void;
  /** Render with interpolation factor alpha in [0,1) between the previous and current sim state. */
  render(alpha: number, frameDt: number): void;
}

export class FixedLoop {
  readonly dt: number;
  private acc = 0;
  private last = -1;
  private running = false;
  private raf = 0;
  paused = false;
  /** Time scale (photo mode / debug). Sim still steps at fixed dt. */
  timeScale = 1;
  maxSteps: number;
  stepsLastFrame = 0;

  private hooks: LoopHooks;

  constructor(hooks: LoopHooks, hz = 60, maxSteps = 8) {
    this.hooks = hooks;
    this.dt = 1 / hz;
    this.maxSteps = maxSteps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    const frame = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      this.tick(t / 1000);
    };
    this.raf = requestAnimationFrame(frame);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('focus', this.onFocus);
      document.addEventListener('visibilitychange', this.onVis);
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVis);
    }
  }

  /** Advance by wall-clock time `now` in seconds. Exposed for tests. */
  tick(now: number): void {
    if (this.last < 0) this.last = now;
    let frameDt = Math.min(0.25, now - this.last);
    this.last = now;
    if (this.paused) { this.hooks.render(0, 0); return; }
    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.hooks.step(this.dt);
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0; // drop time rather than spiral
    this.stepsLastFrame = steps;
    this.hooks.render(this.acc / this.dt, frameDt);
  }

  private onBlur = () => { this.paused = true; };
  private onFocus = () => { this.paused = false; this.last = -1; };
  private onVis = () => { if (document.hidden) this.paused = true; };
}
