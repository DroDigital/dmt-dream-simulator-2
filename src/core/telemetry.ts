/** Local-only telemetry. Never sends anything over the network. */
export interface Telemetry {
  track(event: string, props: Record<string, unknown>): void;
}

export interface TelemetryRecord { t: number; event: string; props: Record<string, unknown> }

export class RingTelemetry implements Telemetry {
  private buf: TelemetryRecord[] = [];
  private capacity: number;
  private clock: () => number;
  constructor(capacity = 20000, clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : 0)) {
    this.capacity = capacity;
    this.clock = clock;
  }
  track(event: string, props: Record<string, unknown>): void {
    this.buf.push({ t: Math.round(this.clock()), event, props });
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }
  records(): readonly TelemetryRecord[] { return this.buf; }
  exportJson(): string { return JSON.stringify({ exportedAt: new Date().toISOString(), records: this.buf }, null, 1); }
  clear(): void { this.buf = []; }
}

export const telemetry = new RingTelemetry();
