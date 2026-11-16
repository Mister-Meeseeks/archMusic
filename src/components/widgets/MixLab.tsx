// A small mixing desk. Four synthesized stems (drums, bass, chords, lead)
// play a four-bar loop. Each stem runs through its own channel strip:
//
//   source → low cut (high-pass) → high cut (low-pass) → fader → pan ─┬→ mix bus
//                                                                    └→ reverb send
//
// The bass, chords and lead pass through a shared "duck" gain that the kick
// can pull down on every beat (sidechain ducking, the pumping sound). The mix
// bus then goes through a compressor (Web Audio's DynamicsCompressorNode),
// make-up gain, a "master loudness" drive into a limiter and a soft clipper,
// and finally an optional loudness-normalization gain that turns the result
// down to a fixed average level, the way streaming services do.
//
// Displays: a live, measured spectrum of every stem (analysers after each
// fader), a "stage" map drawn from the settings (left–right = pan, up–down =
// the frequency band the EQ leaves, size = level, faintness = reverb), the
// compressor's gain reduction, and in mastering mode the output's recent peak
// envelope, average level and crest factor.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loop, startRun, type Run } from '../../lib/sequence';
import { DEFAULT_SYNTH, synthVoice, type SynthParams } from '../../lib/synth';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type StemId = 'drums' | 'bass' | 'chords' | 'lead';
type Strip = { level: number; pan: number; lowCut: number; highCut: number; reverb: number; mute: boolean; solo: boolean };
type Mix = Record<StemId, Strip>;
type Bus = { threshold: number; ratio: number; duck: number; drive: number; normalize: boolean };
type PresetId = 'raw' | 'carved' | 'pump' | 'far';
type Mode = 'mix' | 'master';

const STEMS: { id: StemId; label: string; color: string; bands: [number, number][] }[] = [
  // `bands`: where the stem's energy mostly lives (Hz), used only for the stage map
  { id: 'drums', label: 'Drums', color: '--muted', bands: [[40, 180], [5000, 14000]] },
  { id: 'bass', label: 'Bass', color: '--tone-a', bands: [[45, 1200]] },
  { id: 'chords', label: 'Chords', color: '--c-check', bands: [[100, 7000]] },
  { id: 'lead', label: 'Lead', color: '--tone-b', bands: [[300, 6000]] },
];

const OPEN: Strip = { level: 0, pan: 0, lowCut: 20, highCut: 18000, reverb: 0, mute: false, solo: false };
const strip = (s: Partial<Strip>): Strip => ({ ...OPEN, ...s });
const PRESETS: Record<PresetId, { label: string; mix: Mix; bus: Partial<Bus> }> = {
  raw: {
    label: 'Unmixed',
    mix: { drums: strip({}), bass: strip({}), chords: strip({ level: 2 }), lead: strip({ level: -7 }) },
    // same bus compression as Carved, so the comparison isn't won by loudness
    bus: { threshold: -18, ratio: 4, duck: 0 },
  },
  carved: {
    label: 'Carved',
    mix: {
      drums: strip({ level: 0 }),
      bass: strip({ level: -1, highCut: 2200 }),
      chords: strip({ level: -7, lowCut: 320, highCut: 6000, pan: -0.35, reverb: 0.35 }),
      lead: strip({ level: -1, lowCut: 220, pan: 0.3, reverb: 0.2 }),
    },
    bus: { threshold: -18, ratio: 4, duck: 0 },
  },
  pump: {
    label: 'Pumping',
    mix: {
      drums: strip({ level: 0 }),
      bass: strip({ level: -1, highCut: 2200 }),
      chords: strip({ level: -2, lowCut: 320, highCut: 6000, reverb: 0.3 }),
      lead: strip({ level: -4, lowCut: 220, pan: 0.3, reverb: 0.2 }),
    },
    bus: { threshold: -18, ratio: 4, duck: 0.85 },
  },
  far: {
    label: 'Near and far',
    mix: {
      drums: strip({ level: -3, highCut: 5000, reverb: 0.6 }),
      bass: strip({ level: -2, highCut: 1500 }),
      chords: strip({ level: -10, lowCut: 320, highCut: 2500, pan: -0.5, reverb: 0.9 }),
      lead: strip({ level: 0, lowCut: 220, pan: 0, reverb: 0 }),
    },
    bus: { threshold: -12, ratio: 2, duck: 0 },
  },
};
const PRESET_BLURB: Record<PresetId, string> = {
  raw: 'Every part at about the same level, all in the middle, nothing filtered. The chords’ low notes sit on top of the bass, and the lead is buried in the chords.',
  carved: 'The same parts with space carved out: the chords lose their low end and move left, the lead moves right and comes up, the bass loses its top, and a little reverb pushes the chords back.',
  pump: 'The kick pulls the other parts down on every beat and lets them swell back up: sidechain ducking used as an effect.',
  far: 'Depth: the lead is loud, bright and dry (close); the chords and drums are quieter, duller and wetter with reverb (far away).',
};
const DEFAULT_BUS: Bus = { threshold: 0, ratio: 4, duck: 0, drive: 0, normalize: false };

// ---- the music: four bars, Am F C G, at 118 BPM ----
const BPM = 118;
const STEP = 60 / BPM / 4; // a sixteenth
const BARS = 4;
const CHORDS = [
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [43, 48, 52, 55, 60],
  [43, 50, 55, 59, 62],
];
const ROOTS = [33, 29, 36, 31];
const BASSLINE = [0, 0, 12, 0, 0, 0, 12, 7]; // eighth notes, semitones above the root
const LEAD: [number, number, number][][] = [
  [[0, 76, 4], [4, 74, 2], [6, 72, 2], [8, 72, 6], [14, 69, 2]],
  [[0, 69, 4], [4, 72, 4], [8, 77, 6], [14, 76, 2]],
  [[0, 76, 4], [4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 79, 4]],
  [[0, 74, 8], [8, 71, 4], [12, 67, 4]],
];
const BASS_P: SynthParams = { ...DEFAULT_SYNTH, wave: 'sawtooth', cutoff: 420, resonance: 1.5, envAmount: 2, filterDecay: 0.15, attack: 0.003, decay: 0.2, sustain: 0.6, release: 0.06 };
const PAD_P: SynthParams = { ...DEFAULT_SYNTH, wave: 'sawtooth', detune: 10, cutoff: 3000, resonance: 0.7, envAmount: 0, attack: 0.25, decay: 0.5, sustain: 0.85, release: 0.5 };
const LEAD_P: SynthParams = { ...DEFAULT_SYNTH, wave: 'sawtooth', detune: 5, cutoff: 1600, resonance: 1, envAmount: 1.2, filterDecay: 0.3, attack: 0.012, decay: 0.3, sustain: 0.7, release: 0.15 };

const dbToGain = (db: number) => Math.pow(10, db / 20);
const fmtHz = (f: number) => (f >= 1000 ? `${r2(f / 1000)} kHz` : `${Math.round(f)} Hz`);

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}

/** A synthetic room: two channels of noise decaying exponentially (decorrelated for width). */
function reverbIR(ctx: BaseAudioContext, seconds = 2.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // a short pre-delay, then a decay of about 60 dB over `seconds`, getting darker as it goes
      d[i] = t < 0.015 ? 0 : (Math.random() * 2 - 1) * Math.exp((-6.9 * t) / seconds) * 0.5;
    }
    // crude darkening: one-pole low-pass whose smoothing grows with time
    let y = 0;
    for (let i = 0; i < len; i++) {
      const a = 0.15 + 0.8 * (i / len);
      y = y * a + d[i] * (1 - a);
      d[i] = y;
    }
  }
  return b;
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.36);
  o.onended = () => g.disconnect();
}

function hat(ctx: BaseAudioContext, dest: AudioNode, t: number, level: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  s.connect(hp).connect(g).connect(dest);
  s.start(t, Math.random() * 0.3);
  s.stop(t + 0.1);
  s.onended = () => g.disconnect();
}

type StemNodes = { input: GainNode; hp: BiquadFilterNode; lp: BiquadFilterNode; fader: GainNode; pan: StereoPannerNode; send: GainNode; an: AnalyserNode };
type Graph = {
  stems: Record<StemId, StemNodes>;
  duck: GainNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  drive: GainNode;
  limiter: DynamicsCompressorNode;
  norm: GainNode;
  outAn: AnalyserNode;
};

const effGain = (s: Strip, anySolo: boolean) => (s.mute || (anySolo && !s.solo) ? 0 : dbToGain(s.level));
const makeupDb = (b: Bus) => (-b.threshold * (1 - 1 / b.ratio)) * 0.5;

export default function MixLab(props: { initialMode?: Mode; modes?: Mode[]; preset?: PresetId; presets?: PresetId[] }) {
  const modes = props.modes ?? ['mix', 'master'];
  const presetIds = props.presets ?? (Object.keys(PRESETS) as PresetId[]);
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  const [preset, setPreset] = useState<PresetId | null>(props.preset ?? 'raw');
  const [mix, setMix] = useState<Mix>(PRESETS[props.preset ?? 'raw'].mix);
  const [bus, setBus] = useState<Bus>({ ...DEFAULT_BUS, ...PRESETS[props.preset ?? 'raw'].bus });
  const [focus, setFocus] = useState<StemId>('chords');
  const [playing, setPlaying] = useState(false);
  const [meters, setMeters] = useState({ gr: 0, rms: -60, peak: -60, norm: 0 });

  const params = useRef({ mix, bus });
  params.current = { mix, bus };
  const run = useRef<Run | null>(null);
  const graph = useRef<Graph | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const raf = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const envCanvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>([]);
  const rmsSmooth = useRef(0);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const stop = useCallback(() => {
    cancel.current?.();
    cancel.current = null;
    run.current?.stop(0.08);
    run.current = null;
    graph.current = null;
    cancelAnimationFrame(raf.current);
    history.current = [];
    rmsSmooth.current = 0;
    for (const c of [canvas.current, envCanvas.current]) c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setPlaying(false);
    setMeters({ gr: 0, rms: -60, peak: -60, norm: 0 });
  }, []);
  useAudioOwner(playing, stop);

  // ---- settings → audio graph ----
  const apply = (g: Graph, ctx: AudioContext, m: Mix, b: Bus, immediate = false) => {
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.02) => (immediate ? (p.value = v) : p.setTargetAtTime(v, t, tc));
    const anySolo = STEMS.some((s) => m[s.id].solo);
    for (const s of STEMS) {
      const st = m[s.id];
      const n = g.stems[s.id];
      set(n.fader.gain, effGain(st, anySolo));
      set(n.pan.pan, st.pan);
      set(n.hp.frequency, st.lowCut);
      set(n.lp.frequency, Math.min(st.highCut, ctx.sampleRate / 2 - 100));
      set(n.send.gain, st.reverb * 0.6);
    }
    set(g.comp.threshold, b.threshold, 0.01);
    set(g.comp.ratio, b.ratio, 0.01);
    set(g.makeup.gain, dbToGain(makeupDb(b)));
    set(g.drive.gain, dbToGain(b.drive));
  };
  useEffect(() => {
    if (graph.current && run.current) apply(graph.current, run.current.ctx, mix, bus);
  }, [mix, bus]);

  const play = () => {
    if (playing || run.current) return stop(); // run.current guards a double click before re-render
    const r = startRun(0.12);
    run.current = r;
    const { ctx } = r;

    const mixBus = ctx.createGain();
    const duck = ctx.createGain();
    duck.connect(mixBus);
    const verb = ctx.createConvolver();
    verb.buffer = reverbIR(ctx);
    verb.connect(mixBus);

    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6;
    comp.attack.value = 0.01;
    comp.release.value = 0.15;
    const makeup = ctx.createGain();
    // headroom: the unmastered mix sits about 12 dB below the limiter, so
    // 'Master loudness' has room to push it into limiting
    const trim = ctx.createGain();
    trim.gain.value = dbToGain(-12);
    const drive = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = (0.7 * Math.tanh(x * 1.4)) / Math.tanh(1.4);
    }
    clip.curve = curve;
    const norm = ctx.createGain();
    const outAn = ctx.createAnalyser();
    outAn.fftSize = 2048;
    mixBus.connect(comp).connect(makeup).connect(trim).connect(drive).connect(limiter).connect(clip);
    clip.connect(outAn);
    clip.connect(norm).connect(r.bus);

    const stems = {} as Record<StemId, StemNodes>;
    for (const s of STEMS) {
      const input = ctx.createGain();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      const fader = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const send = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0.85;
      input.connect(hp).connect(lp).connect(fader);
      fader.connect(an);
      fader.connect(pan);
      pan.connect(s.id === 'drums' ? mixBus : duck);
      pan.connect(send).connect(verb);
      stems[s.id] = { input, hp, lp, fader, pan, send, an };
    }
    stems.chords.input.gain.value = 0.32; // five-note chords: share the level
    stems.drums.input.gain.value = 1;
    stems.bass.input.gain.value = 1.1;
    stems.lead.input.gain.value = 0.9;
    const g: Graph = { stems, duck, comp, makeup, drive, limiter, norm, outAn };
    graph.current = g;
    apply(g, ctx, params.current.mix, params.current.bus, true);

    cancel.current = loop(r, (t, i) => {
      const step = i % 16;
      const bar = Math.floor(i / 16) % BARS;
      const { bus: b } = params.current;
      if (step % 4 === 0) {
        kick(ctx, stems.drums.input, t);
        // sidechain: the kick pulls the other stems down, then they swell back
        if (b.duck > 0) {
          duck.gain.setTargetAtTime(1 - b.duck, t, 0.004);
          duck.gain.setTargetAtTime(1, t + 0.05, 0.09);
        } else duck.gain.setTargetAtTime(1, t, 0.02);
      }
      hat(ctx, stems.drums.input, t, step % 4 === 2 ? 0.16 : 0.05);
      if (step % 2 === 0) {
        const semis = BASSLINE[step / 2];
        synthVoice(ctx, stems.bass.input, BASS_P, midiToHz(ROOTS[bar] + semis), t, STEP * 1.5);
      }
      if (step === 0) for (const m of CHORDS[bar]) synthVoice(ctx, stems.chords.input, PAD_P, midiToHz(m), t, STEP * 15);
      for (const [s, m, len] of LEAD[bar]) if (s === step) synthVoice(ctx, stems.lead.input, LEAD_P, midiToHz(m), t, STEP * len * 0.92);
      return STEP;
    });

    const frame = () => {
      const gg = graph.current;
      if (!gg || !run.current) return;
      // output level: RMS and peak of the limiter output (before normalization)
      const buf = new Float32Array(gg.outAn.fftSize);
      gg.outAn.getFloatTimeDomainData(buf);
      let s = 0;
      let pk = 0;
      for (const v of buf) {
        s += v * v;
        pk = Math.max(pk, Math.abs(v));
      }
      const rms = Math.sqrt(s / buf.length);
      // slow average over a few seconds, like a loudness meter's integration
      rmsSmooth.current = rmsSmooth.current ? rmsSmooth.current * 0.985 + rms * 0.015 : rms;
      const target = 0.1; // about the unpushed mix's own average level (−20 dB)
      const normDb = params.current.bus.normalize && rmsSmooth.current > 1e-4 ? Math.max(-24, Math.min(6, 20 * Math.log10(target / rmsSmooth.current))) : 0;
      gg.norm.gain.setTargetAtTime(dbToGain(normDb), run.current.ctx.currentTime, 0.1);
      const out = dbToGain(normDb);
      history.current.push(pk * out);
      if (history.current.length > 300) history.current.shift();
      const recentPeak = Math.max(...history.current.slice(-180)); // about the last three seconds
      setMeters({ gr: gg.comp.reduction, rms: 20 * Math.log10(Math.max(1e-6, rmsSmooth.current * out)), peak: 20 * Math.log10(Math.max(1e-6, recentPeak)), norm: normDb });
      drawSpectrum();
      drawEnvelope();
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  // ---- live displays ----
  const drawSpectrum = () => {
    const gg = graph.current;
    const c = canvas.current;
    if (!gg || !c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const g2 = c.getContext('2d')!;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, cw, ch);
    const css = getComputedStyle(c);
    const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
    const fLo = 30;
    const fHi = 16000;
    const x0 = 8;
    const x1 = cw - 8;
    const fx = (f: number) => x0 + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (x1 - x0);
    const dy = (db: number) => ch - 18 - ((Math.max(-100, Math.min(-20, db)) + 100) / 80) * (ch - 26);
    g2.strokeStyle = col('--grid');
    g2.fillStyle = col('--muted');
    g2.font = '10px system-ui, sans-serif';
    g2.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      g2.beginPath();
      g2.moveTo(fx(f), 4);
      g2.lineTo(fx(f), ch - 16);
      g2.stroke();
      g2.fillText(fmtHz(f).replace(' ', ''), fx(f) + 2, ch - 5);
    }
    const sr = gg.outAn.context.sampleRate;
    for (const s of STEMS) {
      const an = gg.stems[s.id].an;
      const fd = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(fd);
      const binHz = sr / an.fftSize;
      const color = col(s.color);
      g2.beginPath();
      g2.moveTo(fx(fLo), dy(-200));
      // one point per pixel column, taking the loudest bin in that column
      let lastX = -1;
      let acc = -200;
      for (let k = Math.ceil(fLo / binHz); k * binHz < fHi && k < fd.length; k++) {
        const x = Math.round(fx(k * binHz));
        acc = Math.max(acc, fd[k]);
        if (x !== lastX) {
          g2.lineTo(x, dy(acc));
          lastX = x;
          acc = -200;
        }
      }
      g2.lineTo(fx(fHi), dy(-200));
      g2.closePath();
      g2.globalAlpha = s.id === focusRef.current ? 0.35 : 0.12;
      g2.fillStyle = color;
      g2.fill();
      g2.globalAlpha = 1;
      g2.strokeStyle = color;
      g2.lineWidth = s.id === focusRef.current ? 1.8 : 1;
      g2.stroke();
    }
  };

  const drawEnvelope = () => {
    const c = envCanvas.current;
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const g2 = c.getContext('2d')!;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, cw, ch);
    const css = getComputedStyle(c);
    const h = history.current;
    const mid = ch / 2;
    g2.strokeStyle = css.getPropertyValue('--grid').trim() || '#ddd';
    g2.beginPath();
    g2.moveTo(0, mid - (ch / 2 - 4));
    g2.lineTo(cw, mid - (ch / 2 - 4));
    g2.moveTo(0, mid + (ch / 2 - 4));
    g2.lineTo(cw, mid + (ch / 2 - 4));
    g2.stroke();
    g2.fillStyle = css.getPropertyValue('--tone-a').trim() || '#2f6db5';
    const w = cw / 300;
    h.forEach((p, i) => {
      const a = Math.min(1, p / 0.7) * (ch / 2 - 4); // 0.7 = the output ceiling
      g2.fillRect(cw - (h.length - i) * w, mid - a, Math.max(1, w), 2 * a);
    });
  };

  // ---- helpers for controls ----
  const choosePreset = (id: PresetId) => {
    setPreset(id);
    setMix(PRESETS[id].mix);
    setBus((b) => ({ ...DEFAULT_BUS, drive: b.drive, normalize: b.normalize, ...PRESETS[id].bus }));
  };
  const edit = (id: StemId, patch: Partial<Strip>) => {
    setPreset(null);
    setFocus(id);
    setMix((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  };
  const editBus = (patch: Partial<Bus>) => {
    if ('threshold' in patch || 'ratio' in patch || 'duck' in patch) setPreset(null);
    setBus((b) => ({ ...b, ...patch }));
  };
  // log sliders for the filters: slider value 0..1000
  const toLog = (v: number, lo: number, hi: number) => Math.round(lo * Math.pow(hi / lo, v / 1000));
  const fromLog = (f: number, lo: number, hi: number) => (1000 * Math.log(f / lo)) / Math.log(hi / lo);

  // ---- the stage map (from settings) ----
  const SW = 680;
  const SH = 220;
  const SX0 = 60;
  const SX1 = SW - 60;
  const SY0 = 16;
  const SY1 = SH - 24;
  const sfLo = 30;
  const sfHi = 16000;
  const sy = (f: number) => r2(SY1 - (Math.log(f / sfLo) / Math.log(sfHi / sfLo)) * (SY1 - SY0));
  const sx = (pan: number) => r2(SX0 + ((pan + 1) / 2) * (SX1 - SX0));
  const anySolo = STEMS.some((s) => mix[s.id].solo);
  const blobs = STEMS.flatMap((s) => {
    const st = mix[s.id];
    const gn = effGain(st, anySolo);
    if (gn === 0) return [];
    return s.bands
      .map(([lo, hi]) => [Math.max(lo, st.lowCut), Math.min(hi, st.highCut)] as [number, number])
      .filter(([lo, hi]) => hi > lo * 1.15)
      .map(([lo, hi], k) => {
        const size = Math.max(0.25, Math.min(1.4, 1 + st.level / 18)) * (1 - st.reverb * 0.35);
        return {
          key: s.id + k,
          id: s.id,
          label: k === 0 ? s.label : '',
          color: s.color,
          cx: sx(st.pan),
          y0: sy(hi),
          y1: sy(lo),
          rx: r2(26 * size + 6),
          op: r2(Math.max(0.25, 0.85 - st.reverb * 0.55)),
          verb: st.reverb,
        };
      });
  });

  const gr = Math.min(0, meters.gr);
  const crest = meters.peak - meters.rms;

  return (
    <Widget
      kicker="Lab"
      title={mode === 'mix' ? 'A small mixing desk' : 'Mastering and the loudness war'}
      caption={
        mode === 'mix' ? (
          <>
            Four synthesized parts, each with its own channel: level, pan, a low cut and a high cut (simple EQ), and how
            much of it goes to a shared reverb. The <strong>spectrum</strong> is measured live from each part after its
            fader; the highlighted one is the part you last touched. The <strong>stage</strong> is drawn from the
            settings, not measured: left to right is pan, up and down is the frequency range the EQ leaves, size is level,
            and faint, haloed shapes have more reverb (they sound further away). The whole mix then passes through one
            compressor. The kick can also <em>duck</em> the other parts on every beat.
          </>
        ) : (
          <>
            The finished mix goes through a limiter. <strong>Master loudness</strong> pushes the mix harder into it: the
            average level rises, but the peaks can't, so the waveform flattens into a solid block and the difference
            between peaks and average (the <strong>crest factor</strong>) shrinks. Turn on{' '}
            <strong>loudness normalization</strong> to do what streaming services do: measure the average level and
            turn the whole track down (or up) to one target. The level is averaged over the last few seconds here,
            not over the whole track, and it's a plain average, not the weighted LUFS measure services use.
          </>
        )
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        {modes.length > 1 && (
          <Segmented label="View" value={mode} onChange={(v) => setMode(v as Mode)} options={[{ value: 'mix', label: 'Mixing' }, { value: 'master', label: 'Mastering' }].filter((o) => modes.includes(o.value as Mode)) as { value: Mode; label: string }[]} />
        )}
      </div>

      {mode === 'mix' && (
        <>
          <div className="w-controls">
            <Segmented label="Mix" value={preset ?? ('' as PresetId)} onChange={(v) => choosePreset(v as PresetId)} options={presetIds.map((id) => ({ value: id, label: PRESETS[id].label }))} />
          </div>
          <p className="w-note">{preset ? PRESET_BLURB[preset] : 'Your own mix.'}</p>

          <div className="mix-canvas-wrap">
            <canvas ref={canvas} className="w-canvas mix-canvas" style={{ height: 150 }} aria-label="Live spectrum of each part" />
            {!playing && <span className="mix-canvas-hint">Press Play to see each part's spectrum</span>}
          </div>
          <div className="mix-legend">
            {STEMS.map((s) => (
              <button type="button" key={s.id} className={'mix-key' + (focus === s.id ? ' is-on' : '')} style={{ ['--k' as any]: `var(${s.color})` }} onClick={() => setFocus(s.id)}>
                <span className="mix-swatch" /> {s.label}
              </button>
            ))}
          </div>

          <svg viewBox={`0 0 ${SW} ${SH}`} className="w-plot" role="img" aria-label="Stage map: each part placed by pan and frequency range">
            <line x1={SX0} x2={SX1} y1={SY1} y2={SY1} className="stroke-grid" />
            <line x1={sx(0)} x2={sx(0)} y1={SY0} y2={SY1} className="stroke-grid" strokeDasharray="3 4" />
            {[100, 1000, 10000].map((f) => (
              <g key={f}>
                <line x1={SX0} x2={SX1} y1={sy(f)} y2={sy(f)} className="stroke-grid" strokeDasharray="2 5" />
                <text x={SX0 - 6} y={sy(f) + 4} textAnchor="end" className="w-tick">{fmtHz(f)}</text>
              </g>
            ))}
            <text x={SX0} y={SH - 6} className="w-tick">left</text>
            <text x={sx(0)} y={SH - 6} textAnchor="middle" className="w-tick">center</text>
            <text x={SX1} y={SH - 6} textAnchor="end" className="w-tick">right</text>
            {blobs.map((b) => (
              <g key={b.key} style={{ ['--k' as any]: `var(${b.color})` }} className={'mix-blob' + (b.id === focus ? ' is-focus' : '')}>
                {b.verb > 0.05 && <rect x={r2(b.cx - b.rx - 8)} y={r2(b.y0 - 8)} width={r2(2 * b.rx + 16)} height={r2(b.y1 - b.y0 + 16)} rx={r2(b.rx)} className="mix-halo" strokeDasharray="3 4" opacity={r2(0.3 + b.verb * 0.6)} />}
                <rect x={r2(b.cx - b.rx)} y={b.y0} width={r2(2 * b.rx)} height={r2(Math.max(8, b.y1 - b.y0))} rx={r2(Math.min(b.rx, 14))} className="mix-body" opacity={b.op} />
                {b.label && <text x={b.cx} y={r2((b.y0 + b.y1) / 2 + 4)} textAnchor="middle" className="mix-label">{b.label}</text>}
              </g>
            ))}
          </svg>

          <div className="mix-strips">
            {STEMS.map((s) => {
              const st = mix[s.id];
              return (
                <div key={s.id} className={'mix-strip' + (focus === s.id ? ' is-focus' : '')} style={{ ['--k' as any]: `var(${s.color})` }} onPointerDown={() => setFocus(s.id)}>
                  <div className="mix-strip-head">
                    <span className="mix-swatch" />
                    <strong>{s.label}</strong>
                    <button type="button" className={'w-chip mix-ms' + (st.mute ? ' is-on' : '')} aria-pressed={st.mute} onClick={() => edit(s.id, { mute: !st.mute })}>M</button>
                    <button type="button" className={'w-chip mix-ms' + (st.solo ? ' is-on' : '')} aria-pressed={st.solo} onClick={() => edit(s.id, { solo: !st.solo })}>S</button>
                  </div>
                  <Slider label="Level" value={st.level} min={-24} max={6} step={0.5} onChange={(v) => edit(s.id, { level: v })} display={`${st.level > 0 ? '+' : ''}${st.level} dB`} />
                  <Slider label="Pan" value={st.pan} min={-1} max={1} step={0.05} onChange={(v) => edit(s.id, { pan: v })} display={st.pan === 0 ? 'C' : `${Math.round(Math.abs(st.pan) * 100)} ${st.pan < 0 ? 'L' : 'R'}`} />
                  <Slider label="Low cut" value={fromLog(st.lowCut, 20, 2000)} min={0} max={1000} step={1} onChange={(v) => edit(s.id, { lowCut: toLog(v, 20, 2000) })} display={st.lowCut <= 21 ? 'off' : fmtHz(st.lowCut)} />
                  <Slider label="High cut" value={fromLog(st.highCut, 500, 18000)} min={0} max={1000} step={1} onChange={(v) => edit(s.id, { highCut: toLog(v, 500, 18000) })} display={st.highCut >= 17900 ? 'off' : fmtHz(st.highCut)} />
                  <Slider label="Reverb" value={st.reverb} min={0} max={1} step={0.05} onChange={(v) => edit(s.id, { reverb: v })} display={`${Math.round(st.reverb * 100)}%`} />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mix-bus">
        <div className="mix-bus-controls">
          <Slider label="Compressor threshold" value={bus.threshold} min={-36} max={0} step={1} onChange={(v) => editBus({ threshold: v })} display={bus.threshold === 0 ? 'off' : `${bus.threshold} dB`} />
          <Segmented label="Ratio" value={bus.ratio} onChange={(v) => editBus({ ratio: v as number })} options={[2, 4, 10].map((v) => ({ value: v, label: `${v}:1` }))} />
          {mode === 'mix' && <Slider label="Kick ducks the rest" value={bus.duck} min={0} max={0.95} step={0.05} onChange={(v) => editBus({ duck: v })} display={bus.duck ? `${Math.round(bus.duck * 100)}%` : 'off'} />}
          {mode === 'master' && (
            <>
              <Slider label="Master loudness" value={bus.drive} min={0} max={18} step={1} onChange={(v) => editBus({ drive: v })} display={`+${bus.drive} dB`} />
              <button type="button" className={'w-chip' + (bus.normalize ? ' is-on' : '')} aria-pressed={bus.normalize} onClick={() => editBus({ normalize: !bus.normalize })}>
                Loudness normalization
              </button>
            </>
          )}
        </div>
        <div className="mix-meter" aria-label="Compressor gain reduction">
          <span className="w-label">Gain reduction</span>
          <div className="mix-meter-track">
            <div className="mix-meter-fill" style={{ width: `${Math.min(100, (-gr / 18) * 100)}%` }} />
          </div>
          <span className="w-value">{gr < -0.05 ? `${r2(gr).toFixed(1)} dB` : '0 dB'}</span>
        </div>
      </div>

      {mode === 'master' && (
        <>
          <div className="mix-canvas-wrap">
            <canvas ref={envCanvas} className="w-canvas mix-canvas" style={{ height: 110 }} aria-label="Peak envelope of the output over the last few seconds" />
            {!playing && <span className="mix-canvas-hint">Press Play to see the output's peaks over the last few seconds</span>}
          </div>
          <div className="w-controls">
            <Readout label="Average level">{playing ? `${r2(meters.rms).toFixed(1)} dB` : '–'}</Readout>
            <Readout label="Peak">{playing ? `${r2(meters.peak).toFixed(1)} dB` : '–'}</Readout>
            <Readout label="Crest factor">{playing ? `${r2(crest).toFixed(1)} dB` : '–'}</Readout>
            <Readout label="Normalization">{playing && bus.normalize ? `${meters.norm > 0 ? '+' : ''}${r2(meters.norm).toFixed(1)} dB` : 'off'}</Readout>
          </div>
        </>
      )}
    </Widget>
  );
}
