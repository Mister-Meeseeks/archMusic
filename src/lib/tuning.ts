// Pitch, interval, and tuning helpers.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

export function midiName(m: number): string {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

export function ratioToCents(r: number): number {
  return 1200 * Math.log2(r);
}

export function centsToRatio(c: number): number {
  return 2 ** (c / 1200);
}

export type NamedInterval = {
  short: string;
  name: string;
  semis: number;
  /** Simplest common just-intonation ratio [num, den]. */
  just: [number, number];
};

export const INTERVALS: NamedInterval[] = [
  { short: 'P1', name: 'unison', semis: 0, just: [1, 1] },
  { short: 'm2', name: 'minor 2nd', semis: 1, just: [16, 15] },
  { short: 'M2', name: 'major 2nd', semis: 2, just: [9, 8] },
  { short: 'm3', name: 'minor 3rd', semis: 3, just: [6, 5] },
  { short: 'M3', name: 'major 3rd', semis: 4, just: [5, 4] },
  { short: 'P4', name: 'perfect 4th', semis: 5, just: [4, 3] },
  { short: 'TT', name: 'tritone', semis: 6, just: [45, 32] },
  { short: 'P5', name: 'perfect 5th', semis: 7, just: [3, 2] },
  { short: 'm6', name: 'minor 6th', semis: 8, just: [8, 5] },
  { short: 'M6', name: 'major 6th', semis: 9, just: [5, 3] },
  { short: 'm7', name: 'minor 7th', semis: 10, just: [16, 9] },
  { short: 'M7', name: 'major 7th', semis: 11, just: [15, 8] },
  { short: 'P8', name: 'octave', semis: 12, just: [2, 1] },
];

/** Nearest named interval to a size in cents (within an octave+). */
export function nearestInterval(cents: number): { iv: NamedInterval; offset: number } {
  let best = INTERVALS[0];
  for (const iv of INTERVALS)
    if (Math.abs(iv.semis * 100 - cents) < Math.abs(best.semis * 100 - cents)) best = iv;
  return { iv: best, offset: cents - best.semis * 100 };
}

/** Tuning systems, as ratios above the root, for the intervals we compare. */
export type TuningSystem = 'pythagorean' | 'just' | 'equal';

export const TUNINGS: Record<TuningSystem, { label: string; blurb: string; ratios: Record<string, number> }> = {
  pythagorean: {
    label: 'Pythagorean',
    blurb: 'Every interval built by stacking pure 3:2 fifths. Medieval European theory.',
    ratios: { m3: 32 / 27, M3: 81 / 64, P5: 3 / 2 },
  },
  just: {
    label: 'Just',
    blurb: 'Intervals tuned to small whole-number ratios, so partials coincide exactly.',
    ratios: { m3: 6 / 5, M3: 5 / 4, P5: 3 / 2 },
  },
  equal: {
    label: '12-tone equal',
    blurb: 'The octave split into 12 identical steps. Modern default; a compromise.',
    ratios: { m3: 2 ** (3 / 12), M3: 2 ** (4 / 12), P5: 2 ** (7 / 12) },
  },
};

// ---------- spelling ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** Conventional root spellings for major/minor keys on each pitch class. */
const ROOT_MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const ROOT_MINOR = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

/**
 * Spell a note `semis` above a root, `steps` letter names up (2 = a third,
 * 4 = a fifth), so chords get correct names: E major = E–G♯–B, not E–A♭–B.
 */
function spellAbove(rootName: string, rootPc: number, steps: number, semis: number): string {
  const li = LETTERS.indexOf(rootName[0]);
  const letter = LETTERS[(li + steps) % 7];
  const target = (rootPc + semis) % 12;
  const diff = ((target - NATURAL_PC[LETTERS.indexOf(letter)] + 18) % 12) - 6;
  return letter + (ACCIDENTAL[diff] ?? '?');
}

/** Correctly spelled triad, e.g. spellTriad(64, 'major') -> ['E', 'G♯', 'B']. */
export function spellTriad(rootMidi: number, quality: 'major' | 'minor'): string[] {
  const pc = ((rootMidi % 12) + 12) % 12;
  const root = (quality === 'major' ? ROOT_MAJOR : ROOT_MINOR)[pc];
  return [root, spellAbove(root, pc, 2, quality === 'major' ? 4 : 3), spellAbove(root, pc, 4, 7)];
}

/** Letter steps spanned by each interval size in semitones (tritone spelled as an augmented 4th). */
const INTERVAL_STEPS = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 7];

/** Correctly spelled pair for an ascending interval, e.g. spellInterval(64, 4) -> ['E', 'G♯']. */
export function spellInterval(rootMidi: number, semis: number): [string, string] {
  const pc = ((rootMidi % 12) + 12) % 12;
  const root = ROOT_MAJOR[pc];
  return [root, spellAbove(root, pc, INTERVAL_STEPS[semis] % 7, semis % 12)];
}
