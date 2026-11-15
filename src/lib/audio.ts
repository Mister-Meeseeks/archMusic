// Shared Web Audio plumbing for all widgets.
//
// - One AudioContext for the whole page (browsers limit these). It is
//   resumed on every play (contexts get suspended/interrupted by device
//   changes, sleep, or tab backgrounding) and recreated if it was closed.
// - Master chain: voices -> master gain -> destination. No compressor:
//   levels are budgeted instead (each voice is normalized; chords split the
//   level), so nothing can clip, and there is no stateful node that can get
//   stuck if it ever receives a bad value.
// - Every parameter write goes through `safe()`, so a NaN/Infinity can never
//   reach the audio graph.
// - "One widget sounds at a time": a widget calls claimAudio(stop) before
//   making sound, which silences whichever widget was playing before.
// - Debugging: `window.__archAudio` exposes the context and a live level meter.

import type { Partial } from './dissonance';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let meter: AnalyserNode | null = null;

const MASTER_LEVEL = 0.3;

function log(...args: unknown[]) {
  console.info('[audio]', ...args);
}

export function getAudio(): { ctx: AudioContext; out: AudioNode } {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    master.connect(ctx.destination);
    master.connect(meter);
    ctx.addEventListener('statechange', () => log('context state:', ctx?.state));
    log('created context, sample rate', ctx.sampleRate);
    exposeDebug();
  }
  // 'suspended' (autoplay policy, backgrounding) or Safari's 'interrupted'
  // (device change, other app took audio): always try to resume on use.
  if (ctx.state !== 'running') {
    ctx.resume().catch((e) => log('resume failed:', e));
  }
  return { ctx, out: master! };
}

function exposeDebug() {
  if (typeof window === 'undefined') return;
  (window as any).__archAudio = {
    get ctx() {
      return ctx;
    },
    get state() {
      return ctx?.state;
    },
    /** Current RMS of the master output (0 = silence). */
    level() {
      if (!meter) return 0;
      const buf = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      return Math.sqrt(s / buf.length);
    },
  };
}

// If the tab comes back after being hidden (or the machine wakes), make sure
// the context is running again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running' && currentStop) {
      ctx.resume().catch(() => {});
    }
  });
}

let currentStop: (() => void) | null = null;

/** Register `stop` as the active sound source, stopping any previous one. */
export function claimAudio(stop: () => void) {
  if (currentStop && currentStop !== stop) {
    const prev = currentStop;
    currentStop = null;
    try {
      prev();
    } catch (e) {
      log('error stopping previous source:', e);
    }
  }
  currentStop = stop;
}

export function releaseAudio(stop: () => void) {
  if (currentStop === stop) currentStop = null;
}

const RAMP = 0.03; // seconds; smooths parameter changes to avoid clicks
const MAX_FREQ = 14000; // skip partials above this (inaudible-ish, alias-prone)

/** Only finite numbers ever reach an AudioParam. */
function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function setParam(p: AudioParam, value: number, at: number, tc = RAMP / 3) {
  p.setTargetAtTime(safe(value, p.value), at, tc);
}

/**
 * A tone built from sine partials (additive synthesis).
 * `spectrum` gives partials relative to the fundamental: f is a frequency
 * multiplier (1, 2, 3... for a harmonic tone), a is amplitude.
 * Peak amplitude of one voice is at most `level` (partials normalized to sum 1).
 */
export class AdditiveVoice {
  private level: number;
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private env: GainNode;
  private spectrum: Partial[] = [];
  private f0: number;
  private stopped = false;

  constructor(spectrum: Partial[], f0: number, level = 1) {
    const { ctx, out } = getAudio();
    this.level = safe(level, 0);
    this.f0 = safe(f0, 440);
    this.env = ctx.createGain();
    this.env.gain.value = 0;
    this.env.connect(out);
    this.build(spectrum);
  }

  private targetGain(p: Partial, total: number) {
    return p.f * this.f0 > MAX_FREQ ? 0 : (p.a / total) * this.level;
  }

  private build(spectrum: Partial[]) {
    const { ctx } = getAudio();
    const t = ctx.currentTime;
    this.disposeOscs(t);
    this.spectrum = spectrum;
    const total = spectrum.reduce((s, p) => s + p.a, 0) || 1;
    for (const p of spectrum) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = Math.min(safe(p.f * this.f0, 440), ctx.sampleRate / 2);
      const g = ctx.createGain();
      g.gain.value = 0;
      setParam(g.gain, this.targetGain(p, total), t);
      osc.connect(g).connect(this.env);
      osc.start(t);
      this.oscs.push(osc);
      this.gains.push(g);
    }
  }

  private disposeOscs(t: number) {
    const oscs = this.oscs;
    const gains = this.gains;
    gains.forEach((g) => setParam(g.gain, 0, t));
    oscs.forEach((o) => {
      try {
        o.stop(t + RAMP * 3);
      } catch {}
    });
    // Disconnect once silent so nodes can be garbage-collected.
    setTimeout(() => {
      oscs.forEach((o) => o.disconnect());
      gains.forEach((g) => g.disconnect());
    }, RAMP * 3000 + 100);
    this.oscs = [];
    this.gains = [];
  }

  setSpectrum(spectrum: Partial[]) {
    if (this.stopped) return;
    if (spectrum.length === this.spectrum.length && spectrum.every((p, i) => p.f === this.spectrum[i].f)) {
      const { ctx } = getAudio();
      const total = spectrum.reduce((s, p) => s + p.a, 0) || 1;
      this.spectrum = spectrum;
      spectrum.forEach((p, i) => setParam(this.gains[i].gain, this.targetGain(p, total), ctx.currentTime));
    } else {
      this.build(spectrum);
    }
  }

  setF0(f0: number) {
    if (this.stopped || !Number.isFinite(f0)) return;
    const { ctx } = getAudio();
    this.f0 = f0;
    const t = ctx.currentTime;
    const total = this.spectrum.reduce((s, p) => s + p.a, 0) || 1;
    this.spectrum.forEach((p, i) => {
      setParam(this.oscs[i].frequency, Math.min(p.f * f0, ctx.sampleRate / 2), t);
      setParam(this.gains[i].gain, this.targetGain(p, total), t);
    });
  }

  start(attack = 0.04) {
    const { ctx } = getAudio();
    const g = this.env.gain;
    g.cancelScheduledValues(ctx.currentTime);
    setParam(g, 1, ctx.currentTime, attack / 3);
  }

  /**
   * A plucked/struck note: instant attack, then exponential decay, all
   * scheduled on the audio clock (so it works even if the context is still
   * starting up), then disposes itself.
   */
  pluck(decay = 1.5) {
    if (this.stopped) return;
    this.stopped = true;
    const { ctx } = getAudio();
    const t = ctx.currentTime;
    const g = this.env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 0.004);
    g.setTargetAtTime(0, t + 0.01, decay / 3);
    const end = t + decay * 2.5;
    const env = this.env;
    this.oscs.forEach((o, i) => {
      try {
        o.stop(end);
      } catch {}
      if (i === 0) o.onended = () => env.disconnect();
    });
  }

  /** Fade out and dispose. Safe to call more than once. */
  stop(release = 0.08) {
    if (this.stopped) return;
    this.stopped = true;
    const { ctx } = getAudio();
    const t = ctx.currentTime;
    this.env.gain.cancelScheduledValues(t);
    setParam(this.env.gain, 0, t, release / 3);
    const env = this.env;
    const oscs = this.oscs;
    oscs.forEach((o) => {
      try {
        o.stop(t + release * 3);
      } catch {}
    });
    setTimeout(() => {
      oscs.forEach((o) => o.disconnect());
      env.disconnect();
    }, release * 3000 + 100);
  }
}

export type ChordHandle = { stop: () => void; setFreqs: (freqs: number[]) => void };

/**
 * Play several voices together. The handle can retune them in place
 * (setFreqs), which is much cheaper than re-triggering a new chord on every
 * slider movement.
 */
export function playChord(spectrum: Partial[], freqs: number[]): ChordHandle {
  // Split the level so the sum of all voices peaks at most at 1.
  const level = 1 / Math.max(1, freqs.length);
  let voices = freqs.map((f) => new AdditiveVoice(spectrum, f, level));
  voices.forEach((v) => v.start());
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      voices.forEach((v) => v.stop(0.15));
    },
    setFreqs(next: number[]) {
      if (stopped) return;
      if (next.length !== voices.length) {
        voices.forEach((v) => v.stop(0.05));
        voices = next.map((f) => new AdditiveVoice(spectrum, f, 1 / Math.max(1, next.length)));
        voices.forEach((v) => v.start(0.02));
      } else {
        next.forEach((f, i) => voices[i].setF0(f));
      }
    },
  };
}

/**
 * Play notes together (a chord/interval) or one after another (melodic),
 * then stop by itself. Returns a handle so it can be cut short.
 */
export function playNotes(
  spectrum: Partial[],
  freqs: number[],
  opts: { mode?: 'together' | 'up'; noteDur?: number; onEnd?: () => void } = {},
): { stop: () => void } {
  const mode = opts.mode ?? 'together';
  const noteDur = opts.noteDur ?? 1.2;
  const timers: number[] = [];
  let current: ChordHandle | null = null;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    timers.forEach((t) => window.clearTimeout(t));
    current?.stop();
    opts.onEnd?.();
  };
  if (mode === 'together') {
    current = playChord(spectrum, freqs);
    timers.push(window.setTimeout(finish, noteDur * 1000 * 1.4));
  } else {
    freqs.forEach((f, i) => {
      timers.push(
        window.setTimeout(() => {
          current?.stop();
          current = playChord(spectrum, [f]);
        }, i * noteDur * 1000),
      );
    });
    timers.push(window.setTimeout(finish, freqs.length * noteDur * 1000));
  }
  return { stop: finish };
}
