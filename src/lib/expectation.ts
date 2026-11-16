// Expectation models for the expectation chapter (v1-06). Framework-free.
//
// 1. A toy next-note predictor, in the spirit of IDyOM (Pearce 2005) but far
//    simpler. It has up to three parts:
//    - schema: style knowledge learned from OTHER tunes in the corpus
//      (interval given the previous move, pitch class, a pull toward the
//      middle of the range so far). This is "schematic" expectation.
//    - dynamic: patterns that have already occurred earlier in THIS hearing
//      (exact-context matches in the notes heard so far).
//    - veridical: memory of this exact tune (exact-context matches anywhere
//      in it), as if you'd heard it many times.
//    Surprisal (information content) of a note = -log2 P(note).
//
// 2. A Saffran-style statistical-learning stream: made-up three-tone "words"
//    strung together with no gaps, so only the transitional probabilities
//    between tones mark where words begin and end.

import { TUNES, type Tune } from './melodies';

// ---------------------------------------------------------------- predictor

export type Listener = 'schematic' | 'dynamic' | 'veridical';

/** The pitch range the model predicts over (G3 to G5). */
export const LO = 55;
export const HI = 79;
const MAXI = 12;

type Ctx = 'start' | 'rep' | 'su' | 'sd' | 'lu' | 'ld';
const ctxOf = (prev: number | null): Ctx => {
  if (prev === null) return 'start';
  if (prev === 0) return 'rep';
  if (Math.abs(prev) <= 2) return prev > 0 ? 'su' : 'sd';
  return prev > 0 ? 'lu' : 'ld';
};

export type Schema = {
  /** P(interval | previous move class), interval in -MAXI..MAXI */
  int: Record<Ctx, number[]>;
  /** P(pitch class) */
  pc: number[];
  /** tunes it was trained on */
  trainedOn: string[];
};

export const pitchesOf = (t: Tune) => t.notes.map(([m]) => m).filter((m) => m > 0);

/** Corpus for the predictor: every tune except the short Beethoven motif (minor key). */
export const EXPECT_CORPUS = TUNES.filter((t) => t.id !== 'beethoven5');

export function trainSchema(tunes: Tune[]): Schema {
  const ctxs: Ctx[] = ['start', 'rep', 'su', 'sd', 'lu', 'ld'];
  const int = Object.fromEntries(ctxs.map((c) => [c, new Array(2 * MAXI + 1).fill(0.3)])) as Record<Ctx, number[]>;
  const pc = new Array(12).fill(0.5);
  for (const t of tunes) {
    const p = pitchesOf(t);
    p.forEach((m, i) => {
      pc[m % 12] += 1;
      if (i === 0) return;
      const iv = m - p[i - 1];
      if (Math.abs(iv) > MAXI) return;
      const c = ctxOf(i >= 2 ? p[i - 1] - p[i - 2] : null);
      int[c][iv + MAXI] += 1;
    });
  }
  const norm = (a: number[]) => {
    const s = a.reduce((x, y) => x + y, 0);
    return a.map((v) => v / s);
  };
  // Back off: blend each context's interval distribution with the overall one,
  // so a context seen only a few times in this small corpus isn't overconfident.
  const all = norm(ctxs.reduce((acc, c) => acc.map((v, i) => v + int[c][i]), new Array(2 * MAXI + 1).fill(0)));
  for (const c of ctxs) int[c] = norm(int[c]).map((v, i) => 0.5 * v + 0.5 * all[i]);
  return { int, pc: norm(pc), trainedOn: tunes.map((t) => t.id) };
}

/** Continuations of the longest suffix of `hist` (2..maxK notes) found in `mem`. */
function memoryMatch(hist: number[], mem: number[], memEnd: number, maxK: number): { k: number; counts: Map<number, number> } {
  for (let k = Math.min(maxK, hist.length); k >= 2; k--) {
    const suf = hist.slice(hist.length - k);
    const counts = new Map<number, number>();
    for (let j = 0; j + k < memEnd; j++) {
      let ok = true;
      for (let q = 0; q < k; q++) if (mem[j + q] !== suf[q]) { ok = false; break; }
      if (ok) counts.set(mem[j + k], (counts.get(mem[j + k]) ?? 0) + 1);
    }
    if (counts.size) return { k, counts };
  }
  return { k: 0, counts: new Map() };
}

/** Probability of each candidate pitch LO..HI (index = midi - LO) for the note after `hist`. */
export function predict(schema: Schema, hist: number[], listener: Listener, whole?: number[]): number[] {
  const n = HI - LO + 1;
  const out = new Array(n).fill(0);
  const last = hist.length ? hist[hist.length - 1] : null;
  const ctx = ctxOf(hist.length >= 2 ? hist[hist.length - 1] - hist[hist.length - 2] : null);
  const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 64;
  for (let i = 0; i < n; i++) {
    const m = LO + i;
    let p = Math.pow(schema.pc[m % 12], 0.6);
    if (last !== null) {
      const iv = m - last;
      p *= Math.abs(iv) <= MAXI ? schema.int[ctx][iv + MAXI] : 1e-4;
    }
    // pull toward the middle of what's been heard so far (regression to the mean)
    p *= Math.exp(-0.5 * ((m - mean) / 7) ** 2);
    out[i] = p;
  }
  const s = out.reduce((a, b) => a + b, 0);
  let probs = out.map((v) => v / s);

  const blend = (counts: Map<number, number>, w: number) => {
    const tot = [...counts.values()].reduce((a, b) => a + b, 0);
    const mem = new Array(n).fill(0);
    counts.forEach((cnt, m) => {
      if (m >= LO && m <= HI) mem[m - LO] = cnt / tot;
    });
    probs = probs.map((v, i) => (1 - w) * v + w * mem[i]);
  };
  if (listener === 'dynamic' || listener === 'veridical') {
    const { k, counts } = memoryMatch(hist, hist, hist.length, 6);
    if (k) blend(counts, Math.min(0.75, 0.2 * k));
  }
  if (listener === 'veridical' && whole) {
    const { k, counts } = memoryMatch(hist, whole, whole.length, 8);
    if (k) blend(counts, k >= 3 ? 0.92 : 0.7);
    else if (hist.length < 2 && whole.length) {
      // the opening: memory knows how the tune starts
      const m = whole[hist.length];
      blend(new Map([[m, 1]]), 0.9);
    }
  }
  return probs;
}

export const surprisal = (p: number) => -Math.log2(Math.max(p, 1e-6));

export type NoteInfo = { midi: number; p: number; bits: number; top: number; probs: number[] };

/** Surprisal of every note of a tune for a given listener. Schema is trained leaving this tune out. */
export function profile(tune: Tune, listener: Listener): NoteInfo[] {
  const schema = trainSchema(EXPECT_CORPUS.filter((t) => t.id !== tune.id));
  const p = pitchesOf(tune);
  return p.map((m, i) => {
    const probs = predict(schema, p.slice(0, i), listener, p);
    const pr = m >= LO && m <= HI ? probs[m - LO] : 1e-6;
    let top = 0;
    probs.forEach((v, j) => (v > probs[top] ? (top = j) : 0));
    return { midi: m, p: pr, bits: surprisal(pr), top: LO + top, probs };
  });
}

// ---------------------------------------------------------------- statistical learning

/**
 * Six three-tone "words" over one octave from middle C. Modeled on the tone
 * words of Saffran, Johnson, Aslin & Newport (1999): ADB, DFE, GG♯A, FCF♯, D♯ED, CC♯D.
 */
export const TONE_WORDS: number[][] = [
  [69, 62, 71], // A D B
  [62, 65, 64], // D F E
  [67, 68, 69], // G G♯ A
  [65, 60, 66], // F C F♯
  [63, 64, 62], // D♯ E D
  [60, 61, 62], // C C♯ D
];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sequence of word indices: random order, never the same word twice in a row. */
export function wordStream(count: number, seed = 1): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let w: number;
    do w = Math.floor(r() * TONE_WORDS.length);
    while (out.length && w === out[out.length - 1]);
    out.push(w);
  }
  return out;
}

/** Measured transitional probabilities in a stream: average within words vs across word boundaries. */
export function transitionStats(words: number[]): { within: number; across: number } {
  const tones: { m: number; boundaryAfter: boolean }[] = [];
  words.forEach((w) => TONE_WORDS[w].forEach((m, k) => tones.push({ m, boundaryAfter: k === 2 })));
  const pair = new Map<string, number>();
  const first = new Map<number, number>();
  for (let i = 0; i + 1 < tones.length; i++) {
    const key = `${tones[i].m}>${tones[i + 1].m}`;
    pair.set(key, (pair.get(key) ?? 0) + 1);
    first.set(tones[i].m, (first.get(tones[i].m) ?? 0) + 1);
  }
  const tp = (a: number, b: number) => (pair.get(`${a}>${b}`) ?? 0) / (first.get(a) || 1);
  let w = 0, wn = 0, x = 0, xn = 0;
  for (let i = 0; i + 1 < tones.length; i++) {
    const v = tp(tones[i].m, tones[i + 1].m);
    if (tones[i].boundaryAfter) (x += v), xn++;
    else (w += v), wn++;
  }
  return { within: wn ? w / wn : 0, across: xn ? x / xn : 0 };
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Test pairs: a real word vs a "part-word" that straddles a boundary (end of one word + start of another). */
export function testPairs(count: number, seed = 7): { word: number[]; part: number[]; wordFirst: boolean }[] {
  const r = rng(seed);
  const out: { word: number[]; part: number[]; wordFirst: boolean }[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 500) {
    const a = Math.floor(r() * 6);
    let b = Math.floor(r() * 6);
    if (b === a) b = (b + 1) % 6;
    const A = TONE_WORDS[a];
    const B = TONE_WORDS[b];
    const part = r() < 0.5 ? [A[1], A[2], B[0]] : [A[2], B[0], B[1]];
    if (TONE_WORDS.some((w) => same(w, part))) continue;
    const word = TONE_WORDS[Math.floor(r() * 6)];
    if (out.some((o) => same(o.word, word) && same(o.part, part))) continue;
    out.push({ word, part, wordFirst: r() < 0.5 });
  }
  return out;
}
