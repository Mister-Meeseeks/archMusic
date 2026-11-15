// Harmonics, waveforms, and spectra (Vol I ch. 2 and Vol IV).

import { getAudio } from './audio';

/** Amplitudes of harmonics 1..N (index 0 = fundamental). */
export type Recipe = number[];

export const N_HARM = 16;

export const RECIPES: { id: string; label: string; amps: Recipe; blurb: string }[] = [
  { id: 'sine', label: 'Sine', amps: [1], blurb: 'Only the fundamental: a pure tone.' },
  {
    id: 'saw',
    label: 'Bright (all harmonics)',
    amps: Array.from({ length: N_HARM }, (_, k) => 1 / (k + 1)),
    blurb: 'Every harmonic, each weaker in proportion (1, 1/2, 1/3…). This is a sawtooth wave: bright and buzzy, a bit like a bowed string.',
  },
  {
    id: 'odd',
    label: 'Hollow (odd harmonics)',
    amps: Array.from({ length: N_HARM }, (_, k) => ((k + 1) % 2 ? 1 / (k + 1) : 0)),
    blurb: 'Only the odd harmonics (1, 3, 5…). This is a square wave: hollow and woody, reminiscent of a clarinet’s low register.',
  },
  {
    id: 'brass',
    label: 'Brassy',
    amps: [0.55, 0.85, 1, 0.9, 0.75, 0.6, 0.48, 0.38, 0.3, 0.24, 0.19, 0.15, 0.12, 0.09, 0.07, 0.05],
    blurb: 'Strong middle harmonics, stronger than the fundamental. Loud brass instruments are rich in these.',
  },
  {
    id: 'soft',
    label: 'Soft (few harmonics)',
    amps: [1, 0.35, 0.12, 0.04],
    blurb: 'A strong fundamental and a few weak harmonics: mellow, like a flute or a softly sung “oo”.',
  },
];

export function padRecipe(r: Recipe, n = N_HARM): Recipe {
  return Array.from({ length: n }, (_, k) => r[k] ?? 0);
}

/** Sample one waveform period (or `periods`) from a recipe and phases. Peak-normalized to ±1. */
export function waveform(amps: Recipe, phases: number[], samples = 400, periods = 2): number[] {
  const out = new Array(samples).fill(0);
  for (let i = 0; i < samples; i++) {
    const x = (i / samples) * periods * 2 * Math.PI;
    let v = 0;
    for (let k = 0; k < amps.length; k++) if (amps[k]) v += amps[k] * Math.sin((k + 1) * x + (phases[k] ?? 0));
    out[i] = v;
  }
  const peak = Math.max(1e-9, ...out.map(Math.abs));
  return out.map((v) => v / peak);
}

/**
 * Ideal plucked string: harmonic n has amplitude proportional to
 * sin(n·π·p) / n², where p is the pluck point as a fraction of the length.
 * Harmonics with a node at the pluck point vanish (pluck at the middle → no
 * even harmonics). Returned normalized so the largest is 1.
 */
export function pluckRecipe(p: number, n = N_HARM): Recipe {
  const a = Array.from({ length: n }, (_, k) => Math.abs(Math.sin((k + 1) * Math.PI * p)) / (k + 1) ** 2);
  const m = Math.max(...a);
  return a.map((v) => v / m);
}

/** A PeriodicWave for a recipe with phases (exact harmonics in one oscillator). */
export function periodicWave(amps: Recipe, phases: number[]): PeriodicWave {
  const { ctx } = getAudio();
  const n = amps.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 0; k < amps.length; k++) {
    const phi = phases[k] ?? 0;
    // a·sin(x + φ) = a·cosφ·sin(x) + a·sinφ·cos(x)
    imag[k + 1] = amps[k] * Math.cos(phi);
    real[k + 1] = amps[k] * Math.sin(phi);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** Overall gain that keeps any recipe at a comfortable, comparable loudness. */
export function recipeGain(amps: Recipe): number {
  const rms = Math.sqrt(amps.reduce((s, a) => s + a * a, 0) / 2) || 1;
  return 0.35 / rms;
}

// ---------- pitch detection (for the microphone lab) ----------

/**
 * Fundamental-frequency estimate from a block of samples, using a simple
 * version of the YIN method (de Cheveigné & Kawahara 2002). Returns null when
 * the signal isn't clearly periodic or is too quiet.
 */
export function detectPitch(buf: Float32Array, sampleRate: number, minHz = 60, maxHz = 1200): number | null {
  let rms = 0;
  for (const v of buf) rms += v * v;
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return null;
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minLag = Math.floor(sampleRate / maxHz);
  const W = buf.length - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + lag];
      s += diff * diff;
    }
    d[lag] = s;
  }
  // Cumulative-mean-normalized difference
  const cm = new Float32Array(maxLag + 1);
  cm[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag];
    cm[lag] = (d[lag] * lag) / (running || 1);
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cm[lag] < 0.15) {
      while (lag + 1 <= maxLag && cm[lag + 1] < cm[lag]) lag++;
      // Parabolic interpolation for sub-sample accuracy
      const a = cm[lag - 1] ?? cm[lag];
      const b = cm[lag];
      const c = cm[lag + 1] ?? cm[lag];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return sampleRate / (lag + (Number.isFinite(shift) ? shift : 0));
    }
  }
  return null;
}
