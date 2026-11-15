// Rhythm engine shared by the groove widgets.
//
// - Drum voices synthesized from oscillators and noise (no samples, so no
//   rights questions). Classic analog-drum-machine recipes, simplified.
// - A lookahead scheduler ("A Tale of Two Clocks", C. Wilson): a JS timer
//   wakes every 25 ms and schedules any hits falling in the next ~150 ms on
//   the audio clock, which is sample-accurate. JS timers alone jitter by
//   10+ ms, which would ruin exactly the microtiming we want to demonstrate.
// - Step timing is computed incrementally, so tempo/swing changes while
//   playing never cause jumps.
// - Swing, per-instrument offsets ("push"/"lay back"), random humanization.
// - A syncopation measure (simplified Longuet-Higgins & Lee).

import { getAudio } from './audio';

export type DrumId = 'kick' | 'snare' | 'hat' | 'ride';
export const DRUMS: DrumId[] = ['kick', 'snare', 'hat', 'ride'];
export const DRUM_LABELS: Record<DrumId, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hi-hat', ride: 'Ride' };

/** Step states: 0 off, 1 normal, 2 accent, 3 ghost (very soft). */
export type StepState = 0 | 1 | 2 | 3;
export const VELOCITY: Record<StepState, number> = { 0: 0, 1: 0.72, 2: 1, 3: 0.28 };

export const STEPS = 16; // one bar of 4/4 in sixteenth notes
export const STEPS_PER_BEAT = 4;

export type Pattern = Record<DrumId, StepState[]>;

export type GrooveParams = {
  bpm: number;
  /** Fraction of a swing pair taken by its first note: 0.5 straight, 0.667 triplet swing, 0.75 hard. */
  swing: number;
  /** What gets swung: 8th notes (jazz) or 16th notes (funk, hip-hop, house). */
  swingUnit: '8th' | '16th';
  /** Per-instrument timing offset in ms. Positive = late ("laid back"), negative = early ("pushing"). */
  offsets: Record<DrumId, number>;
  /** Standard deviation of random timing scatter per hit, ms. */
  humanize: number;
};

// ---------- timing ----------

/** Time of step i from the start of the bar, in seconds, with swing (no offsets/jitter). */
export function stepTime(i: number, p: Pick<GrooveParams, 'bpm' | 'swing' | 'swingUnit'>): number {
  const d = 60 / p.bpm / STEPS_PER_BEAT; // straight sixteenth
  const u = p.swingUnit === '8th' ? 2 : 1; // steps per half of a swing pair
  const pair = 2 * u * d;
  const k = Math.floor(i / (2 * u));
  const w = i % (2 * u);
  const off = w < u ? w * d * 2 * p.swing : pair * p.swing + (w - u) * d * 2 * (1 - p.swing);
  return k * pair + off;
}

export function barDuration(bpm: number) {
  return (60 / bpm) * (STEPS / STEPS_PER_BEAT);
}

/** Long:short ratio for a swing fraction, e.g. 0.667 -> 2.0 */
export function swingRatio(s: number) {
  return s / (1 - s);
}

// ---------- drum synthesis ----------

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

function env(ctx: AudioContext, t: number, peak: number, decay: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

/** Schedule one drum hit at audio-clock time t with velocity 0..1. */
export function playDrum(id: DrumId, t: number, vel: number) {
  if (vel <= 0) return;
  const { ctx, out } = getAudio();
  t = Math.max(t, ctx.currentTime);
  // Opt-in debug log for timing tests: set window.__archRhythmLog = [] to record hits.
  const log = typeof window !== 'undefined' ? (window as any).__archRhythmLog : null;
  if (Array.isArray(log)) log.push({ id, t, vel, scheduledAt: ctx.currentTime });
  if (id === 'kick') {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = env(ctx, t, 1.0 * vel, 0.42);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.45);
  } else if (id === 'snare') {
    const n = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const gn = env(ctx, t, 0.55 * vel, 0.17);
    n.connect(hp).connect(gn).connect(out);
    n.start(t);
    n.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const go = env(ctx, t, 0.35 * vel, 0.1);
    o.connect(go).connect(out);
    o.start(t);
    o.stop(t + 0.12);
  } else if (id === 'hat') {
    const n = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = env(ctx, t, 0.3 * vel, 0.045);
    n.connect(hp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.06);
  } else {
    // Ride: a cluster of inharmonic square waves (the analog-cymbal trick), band-passed, long decay.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const g = env(ctx, t, 0.16 * vel, 0.7);
    bp.connect(hp).connect(g).connect(out);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 160 * r;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.72);
    }
    const n = noise(ctx);
    const gn = env(ctx, t, 0.05 * vel, 0.25);
    n.connect(hp);
    n.connect(gn).connect(out);
    n.start(t);
    n.stop(t + 0.3);
  }
}

/** Metronome click: 'accent' (downbeat), 'beat', or 'sub' (subdivision). */
export function playClick(t: number, kind: 'accent' | 'beat' | 'sub') {
  const { ctx, out } = getAudio();
  t = Math.max(t, ctx.currentTime);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = kind === 'accent' ? 1760 : kind === 'beat' ? 1175 : 880;
  const g = env(ctx, t, kind === 'accent' ? 0.9 : kind === 'beat' ? 0.6 : 0.22, kind === 'sub' ? 0.03 : 0.05);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.08);
  const log = typeof window !== 'undefined' ? (window as any).__archRhythmLog : null;
  if (Array.isArray(log)) log.push({ id: 'click-' + kind, t, vel: 1, scheduledAt: ctx.currentTime });
}

// ---------- player ----------

function gauss() {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const LOOKAHEAD = 0.15; // seconds
const TICK_MS = 25;

/**
 * Loops a one-bar pattern. Reads pattern/params through `get()` on every
 * tick, so edits take effect immediately and smoothly.
 */
export class GroovePlayer {
  private timer: number | undefined;
  private raf = 0;
  private nextTime = 0;
  private nextStep = 0;
  private visual: { time: number; step: number }[] = [];
  onStep: ((step: number) => void) | null = null;

  constructor(private get: () => { pattern: Pattern; params: GrooveParams }) {}

  get playing() {
    return this.timer !== undefined;
  }

  start() {
    if (this.playing) return;
    const { ctx } = getAudio();
    this.nextTime = ctx.currentTime + 0.08;
    this.nextStep = 0;
    this.visual = [];
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    const frame = () => {
      const now = getAudio().ctx.currentTime;
      let step: number | null = null;
      while (this.visual.length && this.visual[0].time <= now) step = this.visual.shift()!.step;
      if (step !== null) this.onStep?.(step);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = undefined;
    cancelAnimationFrame(this.raf);
    this.visual = [];
    this.onStep?.(-1);
  }

  private tick() {
    const { ctx } = getAudio();
    // If the tab was throttled and we fell far behind, resync instead of bursting.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const { pattern, params } = this.get();
      const i = this.nextStep;
      for (const id of DRUMS) {
        const s = pattern[id][i];
        if (!s) continue;
        const jitter = params.humanize > 0 ? (gauss() * params.humanize) / 1000 : 0;
        playDrum(id, this.nextTime + params.offsets[id] / 1000 + jitter, VELOCITY[s]);
      }
      this.visual.push({ time: this.nextTime, step: i });
      // Advance by this step's (swung) duration under the *current* params.
      const t0 = stepTime(i, params);
      const t1 = i + 1 === STEPS ? barDuration(params.bpm) : stepTime(i + 1, params);
      this.nextTime += t1 - t0;
      this.nextStep = (i + 1) % STEPS;
    }
  }
}

// ---------- syncopation ----------

/**
 * Metrical weights for a 16-step 4/4 bar (Longuet-Higgins & Lee style):
 * 0 downbeat, -1 half bar, -2 beats, -3 eighth offbeats, -4 sixteenths.
 */
export const METRIC_WEIGHTS = [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4];

/**
 * Simplified Longuet-Higgins & Lee syncopation for a looping one-bar onset
 * pattern: for each note, look at the silent positions until the next note;
 * if the strongest of them outranks the note, that's a syncopation worth the
 * difference in weight. Sum over notes.
 */
export function syncopation(onsets: boolean[]): number {
  const n = onsets.length;
  const idx = onsets.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return 0;
  let total = 0;
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const j = idx[(a + 1) % idx.length] + (a + 1 === idx.length ? n : 0);
    let strongest = -Infinity;
    for (let k = i + 1; k < j; k++) strongest = Math.max(strongest, METRIC_WEIGHTS[k % n]);
    if (strongest > METRIC_WEIGHTS[i]) total += strongest - METRIC_WEIGHTS[i];
  }
  return total;
}

/** Syncopation of the kick + snare line (ghost notes ignored). */
export function patternSyncopation(p: Pattern): number {
  return syncopation(p.kick.map((k, i) => (k === 1 || k === 2) || p.snare[i] === 1 || p.snare[i] === 2));
}

// ---------- pattern helpers ----------

/** Build a pattern from step lists, e.g. { kick: [0, 8], snare: { 4: 2, 12: 2 } }. */
export function pat(spec: Partial<Record<DrumId, number[] | Record<number, StepState>>>): Pattern {
  const out = {} as Pattern;
  for (const id of DRUMS) {
    const row: StepState[] = Array(STEPS).fill(0);
    const s = spec[id];
    if (Array.isArray(s)) s.forEach((i) => (row[i] = 1));
    else if (s) for (const [k, v] of Object.entries(s)) row[Number(k)] = v;
    out[id] = row;
  }
  return out;
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
const ALL16 = Array.from({ length: 16 }, (_, i) => i);

export type Preset = {
  id: string;
  label: string;
  pattern: Pattern;
  params: Partial<GrooveParams>;
  blurb: string;
};

export const PRESETS: Preset[] = [
  {
    id: 'rock',
    label: 'Basic rock beat',
    pattern: pat({ kick: [0, 8, 10], snare: { 4: 2, 12: 2 }, hat: EIGHTHS }),
    params: { bpm: 100, swing: 0.5, swingUnit: '16th' },
    blurb: 'Kick on 1 and 3, snare backbeat on 2 and 4, steady eighth-note hi-hat.',
  },
  {
    id: 'four',
    label: 'Four-on-the-floor',
    pattern: pat({ kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] }),
    params: { bpm: 120, swing: 0.5, swingUnit: '16th' },
    blurb: 'Disco and house: kick on every beat, hi-hat on the offbeats in between.',
  },
  {
    id: 'funk',
    label: 'Funk with ghost notes',
    pattern: pat({
      kick: { 0: 2, 6: 1, 10: 1 },
      snare: { 4: 2, 7: 3, 9: 3, 12: 2, 15: 3 },
      hat: Object.fromEntries(ALL16.map((i) => [i, i % 2 === 0 ? 1 : 3])) as Record<number, StepState>,
    }),
    params: { bpm: 96, swing: 0.5, swingUnit: '16th' },
    blurb: 'Sixteenth-note hi-hat, syncopated kick, and quiet "ghost" snare notes between the backbeats.',
  },
  {
    id: 'shuffle',
    label: 'Half-time shuffle',
    pattern: pat({
      kick: { 0: 2, 11: 1, 14: 1 },
      snare: { 3: 3, 7: 3, 8: 2, 11: 3, 15: 3 },
      hat: Object.fromEntries(ALL16.map((i) => [i, i % 2 === 0 ? 1 : 3])) as Record<number, StepState>,
    }),
    params: { bpm: 86, swing: 0.667, swingUnit: '16th' },
    blurb: 'Triplet-swung sixteenths with ghost notes; the backbeat lands only on beat 3, so it feels half as fast.',
  },
  {
    id: 'jazz',
    label: 'Jazz ride pattern',
    pattern: pat({ ride: { 0: 2, 4: 2, 6: 1, 8: 2, 12: 2, 14: 1 }, hat: [4, 12], kick: { 0: 3, 4: 3, 8: 3, 12: 3 } }),
    params: { bpm: 140, swing: 0.667, swingUnit: '8th' },
    blurb: 'The "spang-a-lang" ride cymbal with swung eighths, hi-hat pedal on 2 and 4, feathered kick.',
  },
  {
    id: 'laidback',
    label: 'Laid-back neo-soul',
    pattern: pat({
      kick: { 0: 2, 7: 1, 10: 1 },
      snare: { 4: 2, 12: 2 },
      hat: Object.fromEntries(EIGHTHS.map((i) => [i, 1]).concat([[15, 3]])) as Record<number, StepState>,
    }),
    params: { bpm: 84, swing: 0.56, swingUnit: '16th', offsets: { kick: -8, snare: 28, hat: 0, ride: 0 } },
    blurb: 'A slow groove with the snare dragged ~30 ms behind the beat and the kick slightly ahead.',
  },
];

export const DEFAULT_PARAMS: GrooveParams = {
  bpm: 100,
  swing: 0.5,
  swingUnit: '16th',
  offsets: { kick: 0, snare: 0, hat: 0, ride: 0 },
  humanize: 0,
};

export function presetParams(p: Preset): GrooveParams {
  return { ...DEFAULT_PARAMS, ...p.params, offsets: { ...DEFAULT_PARAMS.offsets, ...(p.params.offsets ?? {}) } };
}
