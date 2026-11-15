// Scheduling helpers for widgets that play a fixed passage (a progression,
// a build-up). Everything is scheduled up front on the audio clock into a
// per-run bus, so timing is exact and stopping is one gain ramp.

import { getAudio } from './audio';

export type Run = {
  ctx: AudioContext;
  bus: GainNode;
  /** Audio-clock time of beat 0 of the passage. */
  t0: number;
  stop: (release?: number) => void;
  stopped: () => boolean;
};

export function startRun(lead = 0.1, level = 1): Run {
  const { ctx, out } = getAudio();
  const bus = ctx.createGain();
  bus.gain.value = level;
  bus.connect(out);
  let done = false;
  return {
    ctx,
    bus,
    t0: ctx.currentTime + lead,
    stopped: () => done,
    stop(release = 0.08) {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + release);
      window.setTimeout(() => bus.disconnect(), (release + 0.1) * 1000);
    },
  };
}

const waveCache = new WeakMap<AudioContext, Map<string, PeriodicWave>>();

/** A PeriodicWave with harmonic amplitudes 1/n^tilt (n = 1..count). Cached per context. */
export function harmonicWave(ctx: AudioContext, count = 10, tilt = 1.2): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  const key = `${count}:${tilt}`;
  let w = m.get(key);
  if (!w) {
    const real = new Float32Array(count + 1);
    const imag = new Float32Array(count + 1);
    for (let n = 1; n <= count; n++) imag[n] = 1 / Math.pow(n, tilt);
    w = ctx.createPeriodicWave(real, imag);
    m.set(key, w);
  }
  return w;
}

export type NoteOpts = {
  f: number;
  t: number; // audio-clock start
  dur: number; // seconds until release begins
  gain: number;
  attack?: number;
  release?: number;
  wave?: PeriodicWave | OscillatorType;
  detune?: number; // cents
  dest?: AudioNode;
};

/** One scheduled note with an attack/sustain/release envelope. */
export function note(run: Run, o: NoteOpts) {
  const { ctx } = run;
  const attack = o.attack ?? 0.02;
  const release = o.release ?? 0.25;
  const osc = ctx.createOscillator();
  if (o.wave instanceof PeriodicWave) osc.setPeriodicWave(o.wave);
  else osc.type = o.wave ?? 'sine';
  osc.frequency.value = o.f;
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + attack);
  g.gain.setValueAtTime(o.gain, o.t + Math.max(attack, o.dur));
  g.gain.setTargetAtTime(0, o.t + Math.max(attack, o.dur), release / 4);
  osc.connect(g).connect(o.dest ?? run.bus);
  osc.start(o.t);
  osc.stop(o.t + Math.max(attack, o.dur) + release * 1.5);
  osc.onended = () => g.disconnect();
}

/** A looping white-noise source (2 s buffer). */
export function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

/** "m:ss" or "h:mm:ss" (or a number of seconds) → seconds. */
export function toSeconds(v: string | number): number {
  if (typeof v === 'number') return v;
  return v.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Open-ended playback: calls `schedule(t, i)` for event i at audio time t,
 * a little ahead of the clock, and advances by the duration it returns.
 * Parameter changes (read inside `schedule`) take effect on the next event.
 * Stops by itself once the run is stopped. Returns a cancel function.
 */
export function loop(run: Run, schedule: (t: number, i: number) => number, ahead = 0.25): () => void {
  let next = run.t0;
  let i = 0;
  const tick = () => {
    if (run.stopped()) return cancel();
    while (next < run.ctx.currentTime + ahead) {
      const d = schedule(next, i++);
      next += Math.max(0.01, d);
    }
  };
  const id = window.setInterval(tick, 40);
  const cancel = () => window.clearInterval(id);
  tick();
  return cancel;
}
