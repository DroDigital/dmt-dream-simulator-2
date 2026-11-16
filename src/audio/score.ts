/**
 * Generative audio (Tone.js on Web Audio). Original motifs only.
 *  - quadrant score: a mode per chart quadrant, key from the night seed
 *  - 4 music layers enter with lucidity level (drone, arpeggio, night-theme bells, shimmer), 4 s fades
 *  - cues: notice chime in the night key, link family by tag, blink heartbeat, ghost-door slowdown,
 *    Watcher low-pass, souvenir pick-up, wake (room tone + clock)
 */
import * as Tone from 'tone';
import type { Game } from '../director/game.ts';
import { quadrantOf } from '../director/resonance.ts';
import { ATMOS } from '../realms/atmos.ts';
import { PCG32 } from '../core/rng.ts';

const MODES: Record<string, number[]> = {
  halo: [0, 2, 4, 6, 7, 9, 11],      // lydian
  bloom: [0, 2, 4, 7, 9, 12, 14],    // major pentatonic (spread)
  hush: [0, 2, 3, 5, 7, 9, 10],      // dorian
  undertow: [0, 1, 3, 5, 7, 8, 10],  // phrygian
  centre: [0, 2, 4, 5, 7, 9, 10],    // mixolydian
};

function midiToHz(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

export class Score {
  private started = false;
  private master!: Tone.Volume;
  private lowpass!: Tone.Filter;
  private music!: Tone.Volume;
  private sfx!: Tone.Volume;
  private layers: Tone.Volume[] = [];
  private drone!: Tone.PolySynth;
  private arp!: Tone.Synth;
  private bells!: Tone.PolySynth;
  private shimmer!: Tone.PolySynth;
  private chime!: Tone.PolySynth;
  private noise!: Tone.NoiseSynth;
  private noiseFilter!: Tone.Filter;
  private thump!: Tone.MembraneSynth;
  private tick!: Tone.MetalSynth;
  private loops: Tone.Loop[] = [];
  private root = 50;
  private mode = MODES.centre;
  private theme = [0, 2, 4, 1];
  private game: Game | null = null;
  private lastLevel = -1;
  private quadrant = 'centre';
  muted = false;
  /** Audio-only variation (never feeds the sim). */
  private rng = new PCG32(0xa0d10);

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.started = true;
    const reverb = new Tone.Reverb({ decay: 6, wet: 0.35 });
    const limiter = new Tone.Limiter(-2);
    this.lowpass = new Tone.Filter(18000, 'lowpass');
    this.master = new Tone.Volume(-6);
    this.master.chain(this.lowpass, reverb, limiter, Tone.getDestination());
    this.music = new Tone.Volume(-4).connect(this.master);
    this.sfx = new Tone.Volume(-2).connect(this.master);
    for (let i = 0; i < 4; i++) this.layers.push(new Tone.Volume(-60).connect(this.music));

    this.drone = new Tone.PolySynth(Tone.AMSynth, { harmonicity: 1.5, envelope: { attack: 4, decay: 1, sustain: 0.8, release: 6 }, oscillator: { type: 'sine' } }).connect(this.layers[0]);
    this.drone.volume.value = -14;
    this.arp = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 1.2 } }).connect(this.layers[1]);
    this.arp.volume.value = -18;
    this.bells = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3.01, modulationIndex: 8, envelope: { attack: 0.005, decay: 1.4, sustain: 0, release: 1.6 } }).connect(this.layers[2]);
    this.bells.volume.value = -20;
    this.shimmer = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 3, decay: 1, sustain: 0.6, release: 5 } }).connect(this.layers[3]);
    this.shimmer.volume.value = -26;
    this.chime = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 3, envelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 1.2 } }).connect(this.sfx);
    this.chime.volume.value = -12;
    this.noiseFilter = new Tone.Filter(1200, 'bandpass').connect(this.sfx);
    this.noise = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.01, decay: 0.5, sustain: 0 } }).connect(this.noiseFilter);
    this.noise.volume.value = -14;
    this.thump = new Tone.MembraneSynth({ octaves: 3, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(this.sfx);
    this.thump.volume.value = -14;
    this.tick = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, resonance: 800 }).connect(this.sfx);
    this.tick.volume.value = -34;

    const transport = Tone.getTransport();
    transport.bpm.value = 64;
    this.loops.push(new Tone.Loop((time) => this.onBar(time), '2m').start(0));
    this.loops.push(new Tone.Loop((time) => this.onArp(time), '8n').start(0));
    this.loops.push(new Tone.Loop((time) => this.onBell(time), '2n').start('1m'));
    transport.start();
    if (this.game) this.attach(this.game);
  }

  private note(deg: number, octave = 0): number {
    const n = this.mode.length;
    const o = Math.floor(deg / n);
    const d = ((deg % n) + n) % n;
    return midiToHz(this.root + this.mode[d] + 12 * (o + octave));
  }

  private bar = 0;
  private onBar(time: number): void {
    this.bar++;
    const chordRoot = [0, 3, 4, 1][this.bar % 4];
    this.drone.triggerAttackRelease([this.note(chordRoot, -1), this.note(chordRoot + 2, -1), this.note(chordRoot + 4, -1)], '2m', time);
    this.shimmer.triggerAttackRelease([this.note(chordRoot + 4, 2), this.note(chordRoot + 6, 2)], '2m', time);
  }
  private arpStep = 0;
  private onArp(time: number): void {
    this.arpStep++;
    if (this.arpStep % 2 && this.rng.next() < 0.4) return; // breathing gaps
    const pat = [0, 2, 4, 6, 4, 2];
    this.arp.triggerAttackRelease(this.note(pat[this.arpStep % pat.length] + [0, 3, 4, 1][this.bar % 4], 1), '16n', time);
  }
  private bellStep = 0;
  private onBell(time: number): void {
    const deg = this.theme[this.bellStep++ % this.theme.length];
    if (this.bellStep % (this.theme.length + 2) >= this.theme.length) return;
    this.bells.triggerAttackRelease(this.note(deg, 1), '4n', time);
  }

  attach(game: Game): void {
    this.game = game;
    if (!this.started) return;
    game.events.on('nightStart', (e) => {
      this.theme = e.plan.theme;
      this.root = 45 + (e.plan.seed % 12);
      this.setQuadrant(quadrantOf(e.plan.startPos));
      this.duck(0.5);
    });
    game.events.on('notice', (e) => {
      if (!this.started) return;
      const deg = this.theme[Math.floor(e.value) % this.theme.length];
      this.chime.triggerAttackRelease([this.note(deg, 2), this.note(deg + 4, 2)], '8n');
    });
    game.events.on('link', (e) => this.linkSound(e.kind));
    game.events.on('blink', () => {
      const now = Tone.now();
      this.thump.triggerAttackRelease('C1', '16n', now);
      this.thump.triggerAttackRelease('C1', '16n', now + 0.22);
    });
    game.events.on('pickup', () => this.chime.triggerAttackRelease([this.note(0, 2), this.note(2, 2), this.note(4, 2)], '16n'));
    game.events.on('doors', (e) => {
      Tone.getTransport().bpm.rampTo(e.open ? 22 : 64, e.open ? 0.6 : 0.4);
    });
    game.events.on('reunion', () => {
      // the dreamers' trail sounds harmonise
      const now = Tone.now();
      [0, 2, 4, 7].forEach((d, i) => this.chime.triggerAttackRelease(this.note(d, 1), '2n', now + i * 0.12));
    });
    game.events.on('hands', () => this.chime.triggerAttackRelease([this.note(0, 1), this.note(4, 1)], '4n'));
    game.events.on('lantern', () => this.bells.triggerAttackRelease(this.note(2, 2), '8n'));
    game.events.on('call', () => {
      const now = Tone.now();
      for (let i = 0; i < 4; i++) this.chime.triggerAttackRelease([this.note(5, 2), this.note(7, 2)], '16n', now + i * 0.18);
    });
    game.events.on('wake', (e) => {
      if (e.reason === 'watcher') {
        // 1 s of silence, then the wake chime
        this.master.volume.rampTo(-80, 0.05);
        this.master.volume.rampTo(-6, 0.3, Tone.now() + 1);
        this.chime.triggerAttackRelease([this.note(0, 1), this.note(4, 1), this.note(7, 1)], '1n', Tone.now() + 1.05);
      }
    });
    game.events.on('nightEnd', () => {
      // wake: clock ticks in the room
      const now = Tone.now();
      for (let i = 0; i < 6; i++) this.tick.triggerAttackRelease('C6', '64n', now + 1 + i);
    });
  }

  private linkSound(kind: string): void {
    if (!this.started) return;
    const now = Tone.now();
    switch (kind) {
      case 'pour': this.noiseFilter.frequency.setValueAtTime(3000, now); this.noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 0.6); this.noise.triggerAttackRelease(0.6, now); break;
      case 'fold': this.noiseFilter.frequency.setValueAtTime(2500, now); this.noise.triggerAttackRelease(0.08, now); this.noise.triggerAttackRelease(0.08, now + 0.15); break;
      case 'shatter': [0, 0.05, 0.11, 0.18].forEach((t, i) => this.chime.triggerAttackRelease(this.note(7 + i * 2, 2), '32n', now + t)); break;
      case 'bloom': this.chime.triggerAttackRelease([this.note(0, 1), this.note(4, 1), this.note(7, 1)], '2n', now); break;
      case 'glyph': [0, 0.07, 0.14, 0.21, 0.28].forEach((t, i) => this.arp.triggerAttackRelease(this.note((i * 3) % 7, 2), '64n', now + t)); break;
      default: this.thump.triggerAttackRelease('G1', '8n', now); break;
    }
  }

  private setQuadrant(q: string): void {
    if (q === this.quadrant) return;
    this.quadrant = q;
    this.mode = MODES[q] ?? MODES.centre;
  }

  private duck(seconds: number): void {
    this.music.volume.rampTo(-30, 0.05);
    this.music.volume.rampTo(-4, seconds + 1.5, Tone.now() + seconds);
  }

  /** Per-frame update: layers follow the highest lucidity; Watcher low-pass; breath thinning. */
  update(game: Game): void {
    if (!this.started) return;
    const night = game.mode === 'night';
    const level = night ? Math.max(0, ...game.dreamers.map((d) => d.level)) : 0;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.layers.forEach((l, i) => l.volume.rampTo(i <= level ? (i === 0 ? -2 : -6) : -60, 4));
    }
    if (night) this.setQuadrant(quadrantOf(game.resonance));
    const realm = game.dreamers[0]?.visit.realm ?? 'lantern-flat';
    // the Watcher: low-pass closes progressively as he nears
    const wd = night ? Math.min(...game.dreamers.map((d) => game.watcherNear(d))) : Infinity;
    const near = Math.max(0, Math.min(1, (10 - wd) / 10));
    const doors = game.dreamers.some((d) => d.doors);
    this.lowpass.frequency.rampTo(doors ? 2200 : 18000 * Math.pow(0.02, near), 0.25);
    const hush = (night && game.hasLaw('hush')) || this.muted;
    this.music.mute = hush;
    // last 30 s of breath: thin out
    const thin = night && game.breath < 30 ? 1 - game.breath / 30 : 0;
    this.layers[0]?.volume.rampTo(level >= 0 ? -2 - thin * 18 : -60, 0.5);
    void ATMOS[realm];
  }
}

export const score = new Score();
