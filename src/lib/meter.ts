// Beat induction: which beat does a rhythm suggest?
//
// A simplified version of Povel & Essens's (1985) "clock model":
//
// 1. Accents. In a sequence of identical tones, some tones sound accented
//    just because of where they fall: (a) an isolated tone, (b) the second
//    tone of a pair, (c) the first and last tones of a run of three or more.
//    (A run, or cluster, is tones on consecutive grid steps.) We also count
//    any tone played loud.
// 2. Clocks. A candidate beat is a period (in grid steps) and a phase (the
//    step it starts on). Each tick of the clock that lands on silence is
//    strong evidence against it (weight 4); a tick on an unaccented tone is
//    weak evidence against it (weight 1).
// 3. The best clock has the least counterevidence.
//
// Simplifications (say so where it's shown): we only consider periods that
// divide the loop, so every clock repeats with the pattern, and that tick at
// least three times per loop (two ticks fit too easily); we only consider
// beats between 200 and 1800 ms apart (the range where a beat can be felt);
// and we divide by the number of ticks so slow and fast clocks compare
// fairly. Ties go to the clock nearest 600 ms, a typical preferred beat.

export type Step = 0 | 1 | 2; // silent, tone, loud tone

export type Clock = {
  period: number; // steps between ticks
  phase: number; // step of the first tick
  ms: number; // beat duration at the current speed
  silent: number; // ticks on silence
  unaccented: number; // ticks on unaccented tones
  ticks: number;
  score: number; // (4·silent + unaccented) / ticks; 0 = perfect fit, 4 = worst
};

export type RhythmPattern = {
  id: string;
  label: string;
  steps: Step[];
  /** Default milliseconds per grid step. */
  stepMs: number;
  /** Steps per bar, if the pattern implies one (used for the bar level of the grid). */
  bar?: number;
  blurb: string;
};

/** Povel–Essens accents for a looping pattern. */
export function accents(steps: Step[]): boolean[] {
  const n = steps.length;
  const on = steps.map((s) => s > 0);
  const out = steps.map((s) => s === 2);
  if (on.every(Boolean)) return out; // one endless run: no positional accents at all
  for (let i = 0; i < n; i++) {
    if (!on[i]) continue;
    const prev = on[(i - 1 + n) % n];
    const next = on[(i + 1) % n];
    if (!prev && !next) out[i] = true; // isolated
    else if (!prev && next) {
      // start of a run: find its length
      let len = 1;
      while (on[(i + len) % n] && len < n) len++;
      if (len >= 3) {
        out[i] = true;
        out[(i + len - 1) % n] = true;
      } else out[(i + 1) % n] = true; // a pair: the second tone
    }
  }
  return out;
}

export const BEAT_MIN_MS = 200;
export const BEAT_MAX_MS = 1800;
export const BEAT_PREFERRED_MS = 600;

/** Every candidate clock for the pattern at this speed, best first. */
export function rankClocks(steps: Step[], stepMs: number): Clock[] {
  const n = steps.length;
  const acc = accents(steps);
  const out: Clock[] = [];
  for (let p = 1; p <= n / 3; p++) {
    if (n % p) continue;
    const ms = p * stepMs;
    if (ms < BEAT_MIN_MS || ms > BEAT_MAX_MS) continue;
    for (let ph = 0; ph < p; ph++) {
      let silent = 0;
      let unaccented = 0;
      let ticks = 0;
      for (let i = ph; i < n; i += p) {
        ticks++;
        if (steps[i] === 0) silent++;
        else if (!acc[i]) unaccented++;
      }
      out.push({ period: p, phase: ph, ms, silent, unaccented, ticks, score: (4 * silent + unaccented) / ticks });
    }
  }
  const pref = (c: Clock) => Math.abs(Math.log(c.ms / BEAT_PREFERRED_MS));
  return out.sort((a, b) => a.score - b.score || pref(a) - pref(b) || a.phase - b.phase);
}

/**
 * Levels of a metrical grid (Lerdahl & Jackendoff's dots): for each step,
 * how many levels of the hierarchy have a beat there. Levels: every step,
 * half-beats (if the beat divides evenly in two), beats, and bars.
 */
export function metricalDots(n: number, period: number, phase: number, bar?: number): number[] {
  const levels = [1];
  if (period % 2 === 0 && period > 2) levels.push(period / 2);
  levels.push(period);
  if (bar && bar > period && bar % period === 0) levels.push(bar);
  else if (n / period >= 2 && n / period <= 4) levels.push(n);
  return Array.from({ length: n }, (_, i) => levels.filter((L) => (((i - phase) % L) + L) % L === 0).length);
}

const fromOnsets = (n: number, on: number[], loud: number[] = []): Step[] =>
  Array.from({ length: n }, (_, i) => (loud.includes(i) ? 2 : on.includes(i) ? 1 : 0));

export const RHYTHMS: RhythmPattern[] = [
  {
    id: 'even',
    label: 'Identical ticks',
    steps: fromOnsets(8, [0, 1, 2, 3, 4, 5, 6, 7]),
    stepMs: 300,
    blurb: 'Eight identical clicks, evenly spaced. Nothing in the sound groups them.',
  },
  {
    id: 'strong',
    label: 'Clear beat',
    // Povel & Essens-style: nine tones in 16 steps, intervals 1 1 1 1 2 2 3 1 4.
    steps: fromOnsets(16, [0, 1, 2, 3, 4, 6, 8, 11, 12]),
    stepMs: 160,
    bar: 16,
    blurb: 'Nine tones, no loud ones. The accents that grouping creates line up with a steady beat.',
  },
  {
    id: 'weak',
    label: 'Unclear beat',
    // The same nine tones and the same set of gaps, reordered: 4 1 2 3 1 1 1 2 1.
    steps: fromOnsets(16, [0, 4, 5, 7, 10, 11, 12, 13, 15]),
    stepMs: 160,
    bar: 16,
    blurb: 'The same tones and the same gaps, in a different order. Now no steady beat fits well.',
  },
  {
    id: 'tresillo',
    label: '3 + 3 + 2',
    steps: fromOnsets(16, [0, 3, 6, 8, 11, 14]),
    stepMs: 150,
    bar: 8,
    blurb: 'The tresillo: groups of 3, 3, and 2 sixteenths, repeated.',
  },
  {
    id: 'clave',
    label: 'Son clave',
    steps: fromOnsets(16, [0, 3, 6, 10, 12]),
    stepMs: 150,
    bar: 16,
    blurb: 'The son clave of Cuban music: five strokes over two halves (3 + 2).',
  },
  {
    id: 'hemiola',
    label: '6/8 or 3/4?',
    steps: fromOnsets(12, [0, 3, 6, 8, 10], [0, 6]),
    stepMs: 170,
    blurb: 'Six beats grouped two ways in alternation: long-long, then short-short-short.',
  },
  {
    id: 'bell',
    label: '12-pulse bell',
    steps: fromOnsets(12, [0, 2, 4, 5, 7, 9, 11]),
    stepMs: 150,
    bar: 12,
    blurb: 'A bell pattern used across West Africa and the Afro-Cuban diaspora: seven strokes in twelve pulses.',
  },
  {
    id: 'blank',
    label: 'Make your own',
    steps: fromOnsets(16, []),
    stepMs: 150,
    bar: 16,
    blurb: 'Click the cells to add tones (click again for a loud tone, and again to clear).',
  },
];
