// Counterpoint: rounds, two-voice (first-species) analysis, and random
// multi-voice textures for a "how many voices?" test. Framework-free, used
// by CounterpointLab. Times are in eighth notes, as in melodies.ts.
//
//   roundVoices   one tune entering in 1–4 voices at a fixed delay
//   clashes       where the combined voices form a dissonance (a second,
//                 seventh, or tritone between any two sounding notes)
//   analyze       a first-species exercise: the interval at each note, the
//                 motion between notes, and the textbook rule violations
//   makeTexture   n independent lines over a simple progression, each in its
//                 own register band with its own rhythm (all one timbre)

import type { Note, Tune } from './melodies';

/** Eighth notes per bar, for the tunes the round mode offers. */
export const BAR_EIGHTHS: Record<string, number> = { frere: 8, row: 6, twinkle: 8, ode: 8, mary: 8, yankee: 8 };

export type Placed = { m: number; t: number; d: number; v: number };

export const tuneLength = (n: Note[]) => n.reduce((s, [, d]) => s + d, 0);

function place(notes: Note[], v: number, offset: number, reps: number): Placed[] {
  const out: Placed[] = [];
  let u = offset;
  for (let r = 0; r < reps; r++)
    for (const [m, d] of notes) {
      if (m) out.push({ m, t: u, d, v });
      u += d;
    }
  return out;
}

/** A round: `voices` copies of the tune, each entering `delay` eighths after the last, each sung `reps` times. */
export function roundVoices(tune: Tune, voices: number, delay: number, reps = 2): { notes: Placed[]; total: number } {
  const len = tuneLength(tune.notes);
  const notes: Placed[] = [];
  for (let v = 0; v < voices; v++) notes.push(...place(tune.notes, v, v * delay, reps));
  return { notes, total: (voices - 1) * delay + reps * len };
}

const DISSONANT = new Set([1, 2, 6, 10, 11]);
export const isDissonant = (a: number, b: number) => DISSONANT.has(Math.abs(a - b) % 12);

/**
 * Slice time into half-eighths and mark each slice where two or more voices
 * sound and any pair forms a second, seventh, or tritone. `frac` is the share
 * of multi-voice time that is dissonant.
 */
export function clashes(notes: Placed[], total: number, active: (v: number) => boolean = () => true) {
  const step = 0.5;
  const n = Math.ceil(total / step);
  const flags: boolean[] = [];
  let multi = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const x = i * step + step / 2;
    const sounding = notes.filter((p) => active(p.v) && p.t <= x && x < p.t + p.d).map((p) => p.m);
    let f = false;
    for (let a = 0; a < sounding.length && !f; a++) for (let b = a + 1; b < sounding.length; b++) if (isDissonant(sounding[a], sounding[b])) f = true;
    if (sounding.length >= 2) multi++;
    if (f) bad++;
    flags.push(f);
  }
  return { flags, step, frac: multi ? bad / multi : 0 };
}

// ---------- first species ----------

/** The Dorian cantus firmus Fux uses for his first lesson (D F E D G F A G F E D). */
export const CANTUS = [62, 65, 64, 62, 67, 65, 69, 67, 65, 64, 62];

const third = [65, 69, 67, 65, 71, 69, 72, 71, 69, 67, 65];
export const SPECIES_PRESETS: { id: string; label: string; cp: number[]; blurb: string }[] = [
  {
    id: 'good',
    label: 'A textbook solution',
    cp: [69, 69, 67, 69, 71, 72, 72, 71, 74, 73, 74],
    blurb: 'Only consonances, mostly steps, plenty of contrary and oblique motion, no parallel fifths or octaves, and a stepwise approach to the final octave.',
  },
  { id: 'thirds', label: 'Parallel thirds', cp: third, blurb: 'Every note a third above the cantus. All consonant, all legal in isolation, but the top line only shadows the bottom one.' },
  { id: 'fifths', label: 'Parallel fifths', cp: CANTUS.map((m) => m + 7), blurb: 'The cantus doubled a fifth higher, like early organum. Listen for one thicker line instead of two.' },
  { id: 'octaves', label: 'Parallel octaves', cp: CANTUS.map((m) => m + 12), blurb: 'The cantus doubled an octave higher. The two "voices" fuse almost completely.' },
];

export type Motion = 'parallel' | 'similar' | 'contrary' | 'oblique' | 'static';
export type IQuality = 'perfect' | 'imperfect' | 'dissonant';

// letter index for each pitch class (sharps count as the letter below: C♯ is a kind of C)
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const letterOf = (m: number) => Math.floor(m / 12) * 7 + LETTER[((m % 12) + 12) % 12];

/** Interval number as musicians count it (unison = 1, third = 3, octave = 8, tenth = 10). */
export const intervalNumber = (lo: number, hi: number) => Math.abs(letterOf(hi) - letterOf(lo)) + 1;

export function quality(semis: number): IQuality {
  const s = Math.abs(semis) % 12;
  if (s === 0 || s === 7) return 'perfect';
  if (s === 3 || s === 4 || s === 8 || s === 9) return 'imperfect';
  return 'dissonant';
}

export function motionOf(l1: number, u1: number, l2: number, u2: number): Motion {
  const dl = l2 - l1;
  const du = u2 - u1;
  if (!dl && !du) return 'static';
  if (!dl || !du) return 'oblique';
  if (Math.sign(dl) !== Math.sign(du)) return 'contrary';
  // parallel: the same interval number (a third to a third, major or minor)
  return intervalNumber(l2, u2) === intervalNumber(l1, u1) && Math.sign(u2 - l2) === Math.sign(u1 - l1) ? 'parallel' : 'similar';
}

export type Flag = { at: number; kind: 'error' | 'warn'; text: string };

export function analyze(cf: number[], cp: number[]) {
  const cols = cf.map((lo, i) => {
    const hi = cp[i];
    const semis = hi - lo;
    return { lo, hi, semis, num: intervalNumber(lo, hi), q: quality(semis), crossed: semis < 0 };
  });
  const motions: Motion[] = [];
  const flags: Flag[] = [];
  const last = cf.length - 1;
  if (cols[0].q !== 'perfect') flags.push({ at: 0, kind: 'warn', text: 'Begin on a unison, fifth, or octave.' });
  const endS = Math.abs(cols[last].semis) % 12;
  if (endS !== 0) flags.push({ at: last, kind: 'error', text: 'End on a unison or octave.' });
  cols.forEach((c, i) => {
    if (c.q === 'dissonant') flags.push({ at: i, kind: 'error', text: `Note ${i + 1}: a dissonance (${c.num === 4 ? 'a fourth counts as one in two voices' : 'second, seventh, or tritone'}). First species allows consonances only.` });
    if (c.crossed) flags.push({ at: i, kind: 'warn', text: `Note ${i + 1}: the voices cross; the ear may swap them.` });
  });
  for (let i = 1; i < cf.length; i++) {
    const a = cols[i - 1];
    const b = cols[i];
    const mo = motionOf(a.lo, a.hi, b.lo, b.hi);
    motions.push(mo);
    if (mo === 'parallel' && b.q === 'perfect' && a.q === 'perfect')
      flags.push({ at: i, kind: 'error', text: `Notes ${i}–${i + 1}: parallel ${Math.abs(b.semis) % 12 === 7 ? 'fifths' : 'octaves'}. The two voices fuse.` });
    else if (mo === 'similar' && b.q === 'perfect')
      flags.push({ at: i, kind: 'warn', text: `Notes ${i}–${i + 1}: similar motion into a perfect interval (a "hidden" ${Math.abs(b.semis) % 12 === 7 ? 'fifth' : 'octave'}).` });
    const leap = Math.abs(cp[i] - cp[i - 1]);
    if (leap > 12) flags.push({ at: i, kind: 'warn', text: `Notes ${i}–${i + 1}: a leap larger than an octave.` });
    else if (leap === 6) flags.push({ at: i, kind: 'warn', text: `Notes ${i}–${i + 1}: a leap of a tritone, hard to sing.` });
  }
  const count = (m: Motion) => motions.filter((x) => x === m).length;
  const moving = motions.length;
  return {
    cols,
    motions,
    flags,
    stats: {
      contrary: count('contrary'),
      oblique: count('oblique'),
      similar: count('similar'),
      parallel: count('parallel'),
      moving,
      perfect: cols.filter((c) => c.q === 'perfect').length,
      parallels: flags.filter((f) => f.text.includes('parallel')).length,
      dissonances: cols.filter((c) => c.q === 'dissonant').length,
    },
  };
}

/** Nearest white key (C major / D Dorian pitch set) to a fractional MIDI number. */
export function snapWhite(m: number): number {
  const r = Math.round(m);
  const white = (x: number) => [0, 2, 4, 5, 7, 9, 11].includes(((x % 12) + 12) % 12);
  if (white(r)) return r;
  return m < r ? r - 1 : r + 1;
}

// ---------- random textures ----------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROG = [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2], [0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]];
const BANDS: [number, number][] = [[45, 52], [53, 59], [60, 66], [67, 73], [74, 81]];
const BAND_SETS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const RHYTHMS = [[4], [2, 2], [2, 1, 1], [1, 1, 2], [3, 1], [1, 1, 1, 1], [2, 2], [4]];

/**
 * `n` independent lines, 4 bars of 4/4 (32 eighths) over C Am F G C F G C.
 * Each line stays in its own register band (no crossings, no unisons), picks
 * its own rhythm in each half bar (re-rolled if it matches the line below),
 * and moves between tones of the current chord (to one of the two nearest),
 * so the voices never clash: the only difficulty left is hearing them apart.
 */
export function makeTexture(n: number, seed: number): Placed[] {
  const rand = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const out: Placed[] = [];
  const prevRhythm: number[][] = [];
  BAND_SETS[n].forEach((b, v) => {
    const [lo, hi] = BANDS[b];
    let prev = Math.round((lo + hi) / 2);
    PROG.forEach((chord, h) => {
      let r = pick(RHYTHMS);
      if (v > 0 && prevRhythm[h] && prevRhythm[h].join() === r.join()) r = pick(RHYTHMS);
      prevRhythm[h] = r;
      let u = h * 4;
      r.forEach((d, k) => {
        const pool: number[] = [];
        for (let m = lo; m <= hi; m++) {
          const pc = m % 12;
          if (chord.includes(pc) && (k === 0 || m !== prev)) pool.push(m);
        }
        const cand = (pool.length ? pool : [prev]).sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev)).slice(0, 2);
        const m = pick(cand);
        out.push({ m, t: u, d, v });
        prev = m;
        u += d;
      });
    });
  });
  return out;
}
