// A small synthesizer: the three classic recipes, each as one function that
// schedules a voice on the audio clock.
//
//   subtractive  oscillator(s) → low-pass filter (with its own envelope) → amplifier (ADSR)
//   fm           sine carrier whose frequency is wobbled by a sine modulator; the
//                modulation index (how hard) has its own decay
//   string       Karplus–Strong plucked string: a burst of noise recirculating
//                through a short delay with a gentle low-pass (a physical model)
//
// Every voice returns { release(t) } so held notes can be let go.

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type Method = 'subtractive' | 'fm' | 'string';

export type SynthParams = {
  method: Method;
  // subtractive
  wave: Wave;
  detune: number; // cents; > 0 adds a second oscillator detuned up, first detuned down
  cutoff: number; // Hz
  resonance: number; // filter Q
  envAmount: number; // octaves the filter opens above cutoff at note start
  filterDecay: number; // seconds for the filter to fall back to cutoff
  // fm
  ratio: number; // modulator frequency / carrier frequency
  index: number; // peak modulation index
  indexDecay: number; // seconds for the index to fall toward indexSustain × index
  indexSustain: number;
  // string
  brightness: number; // 0..1: how bright the initial burst is
  damping: number; // 0..1: how fast the string loses energy
  // amplifier
  attack: number;
  decay: number;
  sustain: number; // 0..1
  release: number;
};

export const DEFAULT_SYNTH: SynthParams = {
  method: 'subtractive',
  wave: 'sawtooth',
  detune: 0,
  cutoff: 12000,
  resonance: 0.7,
  envAmount: 0,
  filterDecay: 0.3,
  ratio: 1,
  index: 2,
  indexDecay: 0.6,
  indexSustain: 0.2,
  brightness: 0.7,
  damping: 0.3,
  attack: 0.005,
  decay: 0.2,
  sustain: 0.8,
  release: 0.2,
};

export type Preset = { id: string; label: string; blurb: string; p: Partial<SynthParams>; pattern?: boolean };

export const SYNTH_PRESETS: Preset[] = [
  { id: 'sine', label: 'Sine', blurb: 'One sine wave, no filtering: the plainest possible tone.', p: { method: 'subtractive', wave: 'sine', cutoff: 12000, envAmount: 0 } },
  { id: 'saw', label: 'Raw saw', blurb: 'A sawtooth wave, filter wide open: every harmonic, bright and buzzy.', p: { method: 'subtractive', wave: 'sawtooth', cutoff: 12000, envAmount: 0, resonance: 0.7 } },
  { id: 'dark', label: 'Filtered saw', blurb: 'The same sawtooth with the filter closed down to 400 Hz: the upper harmonics are carved away.', p: { method: 'subtractive', wave: 'sawtooth', cutoff: 400, envAmount: 0, resonance: 0.7 } },
  {
    id: 'brass',
    label: 'Synth brass',
    blurb: 'Filter opens at the start of each note and settles: the brightness swells and fades the way a brass note does.',
    p: { method: 'subtractive', wave: 'sawtooth', detune: 6, cutoff: 700, resonance: 1, envAmount: 2.2, filterDecay: 0.7, attack: 0.06, decay: 0.4, sustain: 0.8, release: 0.25 },
  },
  {
    id: 'pluck',
    label: 'Pluck',
    blurb: 'A fast filter envelope and no sustain: a bright click that darkens as it dies away.',
    p: { method: 'subtractive', wave: 'sawtooth', detune: 0, cutoff: 250, resonance: 2, envAmount: 5, filterDecay: 0.18, attack: 0.002, decay: 0.5, sustain: 0, release: 0.3 },
  },
  {
    id: 'acid',
    label: 'Acid bass',
    blurb: 'Low cutoff, high resonance, a snappy filter envelope, playing a repeating pattern. Sweep the cutoff and resonance while it plays.',
    p: { method: 'subtractive', wave: 'sawtooth', detune: 0, cutoff: 320, resonance: 14, envAmount: 3, filterDecay: 0.22, attack: 0.003, decay: 0.25, sustain: 0.5, release: 0.06 },
    pattern: true,
  },
  // v7-01
  {
    id: 'seqbass',
    label: 'Sequencer bass',
    blurb: 'A sawtooth through a resonant low-pass whose envelope snaps open and shut on every note: a short, punchy, octave-bouncing bass of the kind early sequencers made famous.',
    p: { method: 'subtractive', wave: 'sawtooth', detune: 0, cutoff: 260, resonance: 4, envAmount: 3.2, filterDecay: 0.11, attack: 0.002, decay: 0.16, sustain: 0.35, release: 0.05 },
    pattern: true,
  },
  {
    id: 'pad',
    label: 'Pad',
    blurb: 'Two detuned sawtooth waves, a slow attack and a long release: the slow beating between them makes it shimmer.',
    p: { method: 'subtractive', wave: 'sawtooth', detune: 12, cutoff: 1400, resonance: 0.8, envAmount: 0.5, filterDecay: 1.5, attack: 0.7, decay: 0.6, sustain: 0.8, release: 1.6 },
  },
  {
    id: 'epiano',
    label: 'FM e-piano',
    blurb: 'FM with a 1:1 ratio and a quickly decaying index: a bright, bell-like attack that mellows into a rounder tone.',
    p: { method: 'fm', ratio: 1, index: 3, indexDecay: 0.5, indexSustain: 0.15, attack: 0.002, decay: 2, sustain: 0, release: 0.5 },
  },
  {
    id: 'bell',
    label: 'FM bell',
    blurb: 'FM with a ratio of 3.5: the sidebands fall between the harmonics, so the spectrum is inharmonic, like a bell.',
    p: { method: 'fm', ratio: 3.5, index: 5, indexDecay: 2.5, indexSustain: 0.2, attack: 0.002, decay: 3.5, sustain: 0, release: 2.5 },
  },
  {
    id: 'fmbass',
    label: 'FM bass',
    blurb: 'FM with a 1:1 ratio and a very fast index decay: a percussive, slap-like attack.',
    p: { method: 'fm', ratio: 1, index: 5, indexDecay: 0.12, indexSustain: 0.1, attack: 0.002, decay: 0.6, sustain: 0.4, release: 0.15 },
    pattern: true,
  },
  {
    id: 'string',
    label: 'Plucked string',
    blurb: 'A physical model (Karplus–Strong): a burst of noise circulating in a delay line exactly one period long.',
    p: { method: 'string', brightness: 0.75, damping: 0.25, attack: 0.001, decay: 3, sustain: 1, release: 0.3 },
  },
];

export type Voice = { release: (t: number, fade?: number) => void; end: number };

const LEVEL = 0.22;
const clampF = (ctx: BaseAudioContext, f: number) => Math.max(20, Math.min(f, ctx.sampleRate / 2 - 100));

function ampEnvelope(ctx: BaseAudioContext, p: SynthParams, t: number, peak: number): { node: GainNode; release: (t: number, fade?: number) => number } {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, p.attack));
  g.gain.setTargetAtTime(peak * p.sustain, t + p.attack, Math.max(0.005, p.decay / 3));
  let relAt: number | null = null;
  let relV = 0;
  let relTau = 0.01;
  return {
    node: g,
    release(tr: number, fade?: number) {
      const at = Math.max(tr, ctx.currentTime);
      const rel = fade ?? p.release;
      // the level the envelope will have at `at`: still in ADSR, or already fading from an earlier release
      const v = relAt === null ? estimateEnv(p, at - t, peak) : relV * Math.exp(-Math.max(0, at - relAt) / relTau);
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(v, at);
      relAt = at;
      relV = v;
      relTau = Math.max(0.005, rel / 4);
      g.gain.setTargetAtTime(0, at, relTau);
      return at + rel * 1.6 + 0.05;
    },
  };
}

/** Value of the ADSR (before release) `dt` seconds after note start. */
export function estimateEnv(p: Pick<SynthParams, 'attack' | 'decay' | 'sustain'>, dt: number, peak = 1): number {
  if (dt <= 0) return 0;
  if (dt < p.attack) return (peak * dt) / p.attack;
  const tau = Math.max(0.005, p.decay / 3);
  return peak * (p.sustain + (1 - p.sustain) * Math.exp(-(dt - p.attack) / tau));
}

const stringCache = new Map<string, AudioBuffer>();

/** Karplus–Strong: a noise burst recirculating through a one-period delay line with an averaging low-pass. */
function stringBuffer(ctx: BaseAudioContext, f: number, brightness: number, damping: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${f.toFixed(2)}:${brightness}:${damping}`;
  const hit = stringCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 3);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  // The averaging filter adds half a sample of delay, so the loop is N + 0.5 samples long.
  const N = Math.max(2, Math.round(sr / f - 0.5));
  const line = new Float32Array(N);
  // initial burst: noise, pre-smoothed for a darker pluck
  let prev = 0;
  const smooth = 1 - brightness * 0.95;
  for (let i = 0; i < N; i++) {
    const n = Math.random() * 2 - 1;
    prev = prev * smooth + n * (1 - smooth);
    line[i] = prev;
  }
  // remove DC so the string doesn't thump
  const mean = line.reduce((s, v) => s + v, 0) / N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  const loss = 0.9995 - damping * 0.012;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const a = line[idx];
    const b = line[(idx + 1) % N];
    out[i] = a;
    line[idx] = loss * 0.5 * (a + b);
    idx = (idx + 1) % N;
  }
  // normalize
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
  if (stringCache.size > 64) stringCache.clear();
  stringCache.set(key, buf);
  return buf;
}

/**
 * Start a voice at audio time t. If `dur` is given, the voice releases
 * itself after `dur` seconds; otherwise call release().
 */
export function synthVoice(ctx: BaseAudioContext, dest: AudioNode, p: SynthParams, f: number, t: number, dur?: number): Voice {
  const stops: AudioScheduledSourceNode[] = [];
  let amp: ReturnType<typeof ampEnvelope>;

  if (p.method === 'subtractive') {
    amp = ampEnvelope(ctx, p, t, LEVEL / (1 + Math.max(0, p.resonance - 1) * 0.06));
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.resonance;
    const peakF = clampF(ctx, p.cutoff * Math.pow(2, p.envAmount));
    filter.frequency.setValueAtTime(peakF, t);
    filter.frequency.setTargetAtTime(clampF(ctx, p.cutoff), t + 0.002, Math.max(0.005, p.filterDecay / 3));
    const detunes = p.detune > 0 ? [-p.detune, p.detune] : [0];
    for (const d of detunes) {
      const o = ctx.createOscillator();
      o.type = p.wave;
      o.frequency.value = f;
      o.detune.value = d;
      const g = ctx.createGain();
      g.gain.value = 1 / detunes.length;
      o.connect(g).connect(filter);
      o.start(t);
      stops.push(o);
    }
    filter.connect(amp.node);
  } else if (p.method === 'fm') {
    amp = ampEnvelope(ctx, p, t, LEVEL * 0.7);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    const fm = f * p.ratio;
    mod.frequency.value = fm;
    const depth = ctx.createGain();
    // index I means a peak frequency deviation of I × modulator frequency
    depth.gain.setValueAtTime(p.index * fm, t);
    depth.gain.setTargetAtTime(p.index * fm * p.indexSustain, t + 0.001, Math.max(0.005, p.indexDecay / 3));
    mod.connect(depth).connect(car.frequency);
    car.connect(amp.node);
    car.start(t);
    mod.start(t);
    stops.push(car, mod);
  } else {
    amp = ampEnvelope(ctx, { ...p, attack: 0.001, sustain: 1 }, t, LEVEL * 1.3);
    const src = ctx.createBufferSource();
    src.buffer = stringBuffer(ctx, f, p.brightness, p.damping);
    src.connect(amp.node);
    src.start(t);
    stops.push(src);
  }

  amp.node.connect(dest);
  let released = false;
  const voice: Voice = {
    end: Infinity,
    release(tr: number, fade?: number) {
      if (released && fade === undefined) return;
      released = true;
      const end = amp.release(tr, fade);
      voice.end = end;
      stops.forEach((s) => {
        try {
          s.stop(end);
        } catch {}
      });
      stops[0].onended = () => amp.node.disconnect();
    },
  };
  if (dur !== undefined) voice.release(t + dur);
  return voice;
}
