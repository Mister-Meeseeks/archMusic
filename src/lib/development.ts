// Repetition, variation, and development (chapter 5.2). Framework-free.
//
//   MOTIFS / OPS / develop   a motif and a chain of operations, each applied to
//                            the previous segment: repeat, sequence up or down
//                            a scale step, invert, stretch (augment), squeeze
//                            (diminish), keep the tail (fragment), keep the head.
//                            Pitch moves are diatonic: they stay in the motif's scale.
//   THEME / VARIATIONS       "Twinkle" (the theme of Mozart's K. 265) with a
//                            harmonization, and variations that each change some
//                            dimensions and keep others.
//
// Notes are [midi, length] as in melodies.ts: length in eighth notes, midi 0 = rest.

import type { Note } from './melodies';

// ---------- scales ----------

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Position of a MIDI note in a scale (C-based): octave*7 + degree. Non-scale notes snap down. */
function toStep(m: number, scale: number[]): number {
  const oct = Math.floor(m / 12);
  const pc = m % 12;
  let deg = 0;
  for (let i = 0; i < scale.length; i++) if (scale[i] <= pc) deg = i;
  return oct * 7 + deg;
}
function fromStep(s: number, scale: number[]): number {
  const oct = Math.floor(s / 7);
  const deg = ((s % 7) + 7) % 7;
  return oct * 12 + scale[deg];
}
/** Move a note `k` scale steps (diatonic transposition). */
export function stepBy(m: number, k: number, scale: number[]): number {
  return m ? fromStep(toStep(m, scale) + k, scale) : 0;
}

// ---------- motifs and operations ----------

export type Motif = { id: string; name: string; notes: Note[]; scale: number[]; bpm: number; blurb: string };

export const MOTIFS: Motif[] = [
  {
    id: 'fate',
    name: 'Short-short-short-long',
    notes: [[0, 1], [67, 1], [67, 1], [67, 1], [63, 4]],
    scale: MINOR,
    bpm: 108,
    blurb: 'The rhythm and the falling third of Beethoven’s Fifth (in C minor).',
  },
  {
    id: 'twinkle',
    name: 'Twinkle (opening)',
    notes: [[60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4]],
    scale: MAJOR,
    bpm: 112,
    blurb: 'The first phrase of Twinkle, Twinkle: a leap up, a step up, a step back.',
  },
  {
    id: 'turn',
    name: 'Running figure',
    notes: [[72, 1], [71, 1], [72, 1], [74, 1], [76, 2], [72, 2]],
    scale: MAJOR,
    bpm: 96,
    blurb: 'A Baroque-style turn around a note, then a leap down: good for sequences.',
  },
];

export type Op = 'repeat' | 'seqDown' | 'seqUp' | 'invert' | 'augment' | 'diminish' | 'fragment' | 'head';

export const OPS: { id: Op; label: string; blurb: string }[] = [
  { id: 'repeat', label: 'Repeat', blurb: 'The same again, exactly.' },
  { id: 'seqDown', label: 'Step down', blurb: 'Sequence: the same shape one scale step lower.' },
  { id: 'seqUp', label: 'Step up', blurb: 'Sequence: the same shape one scale step higher.' },
  { id: 'invert', label: 'Invert', blurb: 'Upside down: every move up becomes a move down by the same number of scale steps.' },
  { id: 'augment', label: 'Stretch', blurb: 'Augmentation: every note twice as long.' },
  { id: 'diminish', label: 'Squeeze', blurb: 'Diminution: every note half as long.' },
  { id: 'fragment', label: 'Keep the end', blurb: 'Fragmentation: keep only the second half of the previous segment.' },
  { id: 'head', label: 'Keep the start', blurb: 'Fragmentation: keep only the first half of the previous segment.' },
];

const pitchedCount = (n: Note[]) => n.filter(([m]) => m > 0).length;

/** Apply one operation to a segment. */
export function applyOp(seg: Note[], op: Op, scale: number[]): Note[] {
  switch (op) {
    case 'repeat':
      return seg;
    case 'seqDown':
      return seg.map(([m, d]) => [stepBy(m, -1, scale), d]);
    case 'seqUp':
      return seg.map(([m, d]) => [stepBy(m, 1, scale), d]);
    case 'invert': {
      const first = seg.find(([m]) => m > 0)?.[0] ?? 60;
      const s0 = toStep(first, scale);
      return seg.map(([m, d]) => [m ? fromStep(2 * s0 - toStep(m, scale), scale) : 0, d]);
    }
    case 'augment':
      return seg.map(([m, d]) => [m, Math.min(16, d * 2)]);
    case 'diminish':
      return seg.map(([m, d]) => [m, Math.max(0.5, d / 2)]);
    case 'fragment':
    case 'head': {
      // split by pitched notes; keep rests attached to the note that follows them
      const idx = seg.map((n, i) => (n[0] > 0 ? i : -1)).filter((i) => i >= 0);
      if (idx.length <= 1) return seg;
      const half = Math.ceil(idx.length / 2);
      if (op === 'head') return seg.slice(0, idx[half - 1] + 1);
      const from = idx[idx.length - half];
      // include a rest directly before the kept part (it carries the upbeat feel)
      const start = from > 0 && seg[from - 1][0] === 0 ? from - 1 : from;
      return seg.slice(start);
    }
  }
}

export type Segment = { op: Op | 'motif'; notes: Note[] };

/** Build a development: the motif, then each operation applied to the previous segment. */
export function develop(motif: Motif, ops: Op[]): Segment[] {
  const out: Segment[] = [{ op: 'motif', notes: motif.notes }];
  for (const op of ops) out.push({ op, notes: applyOp(out[out.length - 1].notes, op, motif.scale) });
  return out;
}

export const segmentNotes = (segs: Segment[]) => segs.map((s) => pitchedCount(s.notes));

export const DEV_PRESETS: { id: string; label: string; motif: string; ops: Op[]; blurb: string }[] = [
  { id: 'answer', label: 'Statement and answer', motif: 'fate', ops: ['seqDown'], blurb: 'The motif, then the same shape a step lower: how the Fifth opens.' },
  { id: 'climb', label: 'Climbing sequence', motif: 'turn', ops: ['seqUp', 'seqUp', 'seqUp'], blurb: 'The same figure on higher and higher steps: a staircase that builds momentum.' },
  {
    id: 'liquidate',
    label: 'Liquidation',
    motif: 'fate',
    ops: ['seqDown', 'fragment', 'seqUp', 'seqUp', 'fragment', 'repeat', 'repeat', 'repeat'],
    blurb: 'The motif is cut down until only its last note is left, repeated: the shape dissolves into pure rhythm.',
  },
  { id: 'mirror', label: 'Mirror', motif: 'twinkle', ops: ['invert', 'seqUp'], blurb: 'The phrase, then upside down. Still related, much harder to recognize.' },
  { id: 'stretch', label: 'Stretch and squeeze', motif: 'fate', ops: ['augment', 'diminish', 'diminish', 'repeat'], blurb: 'The same notes slower, then faster and faster.' },
];

// ---------- theme and variations ----------

/** The theme: Twinkle, Twinkle (the first strain; 4 bars of 8 eighths). */
export const THEME: Note[] = [
  [60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4],
  [65, 2], [65, 2], [64, 2], [64, 2], [62, 2], [62, 2], [60, 4],
];
/** One chord per half bar (4 eighths). */
export const THEME_CHORDS = ['C', 'C', 'F', 'C', 'F', 'C', 'G', 'C'];

export type Dimension = 'melody' | 'rhythm' | 'harmony' | 'mode' | 'register' | 'tempo' | 'texture';
export const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'melody', label: 'Melody notes' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'harmony', label: 'Chords' },
  { id: 'mode', label: 'Major/minor' },
  { id: 'register', label: 'Register' },
  { id: 'tempo', label: 'Tempo' },
  { id: 'texture', label: 'Accompaniment' },
];

export type Accomp = 'block' | 'alberti' | 'high' | 'arpeggio';

export type Variation = {
  id: string;
  label: string;
  blurb: string;
  melody: Note[];
  chords: string[];
  accomp: Accomp;
  tempo: number; // multiplier on the base tempo
  changed: Dimension[];
};

/** The scale-neighbor of a note in C major (dir +1 above, -1 below). */
const neighbor = (m: number, dir: number) => stepBy(m, dir, MAJOR);

function toMinor(n: Note[]): Note[] {
  // lower E, A, B (scale degrees 3, 6, 7) by a semitone
  return n.map(([m, d]) => [m && [4, 9, 11].includes(m % 12) ? m - 1 : m, d]);
}

function ornamented(): Note[] {
  // each quarter note becomes four sixteenths: note, upper neighbor, note, lower neighbor;
  // the long notes at the ends of phrases become a turn and a held note
  const out: Note[] = [];
  for (const [m, d] of THEME) {
    if (d === 2) out.push([m, 0.5], [neighbor(m, 1), 0.5], [m, 0.5], [neighbor(m, -1), 0.5]);
    else out.push([neighbor(m, 1), 0.5], [m, 0.5], [neighbor(m, -1), 0.5], [m, 0.5], [m, 2]);
  }
  return out;
}

function dotted(): Note[] {
  // pairs of equal quarter notes become long-short (dotted) pairs
  const out: Note[] = [];
  for (let i = 0; i < THEME.length; i++) {
    const [m, d] = THEME[i];
    const nx = THEME[i + 1];
    if (d === 2 && nx && nx[1] === 2 && i % 2 === (i < 7 ? 0 : 1)) {
      out.push([m, 3], [nx[0], 1]);
      i++;
    } else out.push([m, d]);
  }
  return out;
}

export const VARIATIONS: Variation[] = [
  { id: 'theme', label: 'Theme', blurb: 'The tune plainly, with simple chords.', melody: THEME, chords: THEME_CHORDS, accomp: 'block', tempo: 1, changed: [] },
  {
    id: 'ornament',
    label: 'Decorated',
    blurb: 'Every melody note circled by its neighbors in quick notes. The tune is still there on the beats, hidden in the decoration.',
    melody: ornamented(),
    chords: THEME_CHORDS,
    accomp: 'block',
    tempo: 1,
    changed: ['melody', 'rhythm'],
  },
  {
    id: 'minor',
    label: 'Minor',
    blurb: 'The same tune and rhythm with three notes lowered: the theme in the minor mode.',
    melody: toMinor(THEME),
    chords: ['Cm', 'Cm', 'Fm', 'Cm', 'Fm', 'Cm', 'G', 'Cm'],
    accomp: 'alberti',
    tempo: 1,
    changed: ['mode', 'texture'],
  },
  {
    id: 'dotted',
    label: 'New rhythm',
    blurb: 'Equal notes turned into long-short pairs. Same pitches, a different gait.',
    melody: dotted(),
    chords: THEME_CHORDS,
    accomp: 'block',
    tempo: 1,
    changed: ['rhythm'],
  },
  {
    id: 'reharm',
    label: 'New chords',
    blurb: 'The melody untouched, the chords underneath replaced. The tune sounds as if it means something different.',
    melody: THEME,
    chords: ['C', 'Em', 'F', 'Em', 'Dm', 'Am', 'G7', 'C'],
    accomp: 'arpeggio',
    tempo: 1,
    changed: ['harmony', 'texture'],
  },
  {
    id: 'bass',
    label: 'Tune in the bass',
    blurb: 'The melody moved two octaves down, with chords above it. Same notes, a different place in the texture.',
    melody: THEME.map(([m, d]): Note => [m - 24, d]),
    chords: THEME_CHORDS,
    accomp: 'high',
    tempo: 1,
    changed: ['register', 'texture'],
  },
  {
    id: 'adagio',
    label: 'Slow',
    blurb: 'Half the speed, with flowing chords: the tune turned into a slow, expressive song.',
    melody: THEME,
    chords: ['C', 'Am', 'F', 'C', 'Dm', 'C', 'G7', 'C'],
    accomp: 'arpeggio',
    tempo: 0.55,
    changed: ['tempo', 'harmony', 'texture'],
  },
];

export const variationById = (id: string) => VARIATIONS.find((v) => v.id === id) ?? VARIATIONS[0];
