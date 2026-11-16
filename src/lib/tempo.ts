// Musical time (chapter 2.1): tempo markings, expressive timing curves, and
// gradual tempo drift. Framework-free so it can be tested in node.
//
// Timing model for expressive performance. A tune is a list of [midi, length]
// notes with lengths in eighth notes (see melodies.ts). A performance assigns
// each note a local tempo multiplier m (1 = the written tempo, 1.2 = 20%
// faster); its duration in seconds is length × (30 / bpm) / m. Phrases are
// found by a simple rule: a phrase ends after a note at least a half note long
// (4 eighths), or at the end of the tune.
//
// The "phrase arch" curve follows the shape Todd (1985, 1992) proposed and Repp
// (1992) measured in pianists' timing: start a little under tempo, move ahead
// through the middle of the phrase, slow down into its end, and stretch the
// phrase's last note. It's a stylized parabola, not a fit to any recording.

import type { Note } from './melodies';

// ---------- tempo markings ----------

/**
 * Traditional Italian tempo terms with rough metronome ranges. The ranges are
 * conventions from metronome markings and modern reference tables; the terms
 * themselves describe character, and composers and editions disagree.
 */
export const TEMPO_MARKINGS: { term: string; meaning: string; lo: number; hi: number }[] = [
  { term: 'Grave', meaning: 'heavy, solemn', lo: 25, hi: 45 },
  { term: 'Largo', meaning: 'broad', lo: 40, hi: 60 },
  { term: 'Adagio', meaning: 'at ease', lo: 55, hi: 76 },
  { term: 'Andante', meaning: 'walking', lo: 73, hi: 108 },
  { term: 'Moderato', meaning: 'moderate', lo: 98, hi: 120 },
  { term: 'Allegro', meaning: 'cheerful, lively', lo: 112, hi: 160 },
  { term: 'Vivace', meaning: 'lively, brisk', lo: 156, hi: 176 },
  { term: 'Presto', meaning: 'very fast', lo: 168, hi: 200 },
  { term: 'Prestissimo', meaning: 'as fast as possible', lo: 200, hi: 300 },
];

/** The marking(s) whose rough range includes this tempo. */
export function markingsFor(bpm: number): string[] {
  const hits = TEMPO_MARKINGS.filter((m) => bpm >= m.lo && bpm <= m.hi).map((m) => m.term);
  if (hits.length) return hits;
  return [bpm < TEMPO_MARKINGS[0].lo ? 'slower than Grave' : 'faster than Prestissimo'];
}

// ---------- expressive timing ----------

export type Curve = 'deadpan' | 'arch' | 'ritardando' | 'accelerando' | 'wobble';

export const CURVES: { id: Curve; label: string; blurb: string }[] = [
  { id: 'deadpan', label: 'Deadpan', blurb: 'Exactly as written, like a machine. Every beat the same length.' },
  {
    id: 'arch',
    label: 'Phrase arch',
    blurb: 'Push ahead into the middle of each phrase, slow into its end, and linger on its last note. The shape measured in many performances.',
  },
  { id: 'ritardando', label: 'Final ritardando', blurb: 'Steady until near the end, then slow down to finish (ritardando).' },
  { id: 'accelerando', label: 'Accelerando', blurb: 'Gradually faster from start to finish.' },
  {
    id: 'wobble',
    label: 'Random wobble',
    blurb: 'About the same amount of tempo change as the arch, but scattered at random. Not tied to the music.',
  },
];

/** Indices of the last note of each phrase. */
export function phraseEnds(notes: Note[]): number[] {
  const ends: number[] = [];
  notes.forEach(([, d], i) => {
    if (d >= 4 || i === notes.length - 1) ends.push(i);
  });
  return ends;
}

// Small seeded PRNG (mulberry32), so server and client render the same wobble.
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

export type Timed = {
  midi: number;
  /** Seconds from the start. */
  t: number;
  /** Seconds. */
  dur: number;
  /** Written position in eighths (deadpan onset). */
  pos: number;
  /** Local tempo in BPM while this note sounds. */
  bpm: number;
  phraseEnd: boolean;
};

/**
 * Onset times for a performance of `notes` at base tempo `bpm` (quarter-note
 * beats) shaped by `curve`. `depth` (0–1) sets how far the tempo strays:
 * at depth 0.3 the arch runs from about 15% slow to 15% fast.
 */
export function perform(notes: Note[], bpm: number, curve: Curve, depth: number): Timed[] {
  const ends = new Set(phraseEnds(notes));
  const total = notes.reduce((s, [, d]) => s + d, 0);
  const eighth = 30 / bpm;
  // phrase start/end positions (in eighths) for each note
  const bounds: { a: number; b: number }[] = [];
  let a = 0;
  let pos = 0;
  const startOf: number[] = [];
  notes.forEach(([, d], i) => {
    startOf.push(pos);
    pos += d;
    if (ends.has(i)) {
      for (let k = bounds.length; k <= i; k++) bounds[k] = { a, b: pos };
      a = pos;
    }
  });
  const rand = rng(11);
  const out: Timed[] = [];
  let t = 0;
  notes.forEach(([m, d], i) => {
    const mid = startOf[i] + d / 2;
    const { a: pa, b: pb } = bounds[i];
    const x = (mid - pa) / Math.max(1e-9, pb - pa); // position in phrase
    const g = mid / total; // position in tune
    let mul = 1;
    let stretch = 1;
    switch (curve) {
      case 'arch':
        mul = 1 + depth * (0.5 - (2 * x - 1) ** 2);
        if (ends.has(i)) stretch = 1 + depth * 0.8;
        break;
      case 'ritardando':
        mul = g < 0.7 ? 1 : 1 - depth * 1.3 * ((g - 0.7) / 0.3);
        break;
      case 'accelerando':
        mul = 1 + depth * 1.2 * g;
        break;
      case 'wobble': {
        // uniform in ±0.8·depth: about the same tempo range as the arch
        mul = 1 + depth * 0.8 * (rand() * 2 - 1);
        break;
      }
    }
    mul = Math.max(0.35, mul);
    const dur = (d * eighth * stretch) / mul;
    out.push({ midi: m, t, dur, pos: startOf[i], bpm: (bpm * mul) / stretch, phraseEnd: ends.has(i) });
    t += dur;
  });
  return out;
}

// ---------- tempo drift ----------

/**
 * Beat times (seconds) for `beats` beats starting at `bpm` and changing
 * smoothly by `drift` (e.g. 0.05 = 5% faster by the end). The tempo changes
 * linearly with beat number.
 */
export function driftBeats(beats: number, bpm: number, drift: number): number[] {
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i <= beats; i++) {
    times.push(t);
    const local = bpm * (1 + (drift * i) / beats);
    t += 60 / local;
  }
  return times;
}
