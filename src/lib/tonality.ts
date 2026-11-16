// Tonal centers and modes: the seven diatonic modes, note spelling, the
// Krumhansl–Kessler probe-tone profiles, and Krumhansl–Schmuckler key
// finding. Framework-free, so it can be tested in node.

import type { Note } from './melodies';

export type ModeId = 'lydian' | 'ionian' | 'mixolydian' | 'dorian' | 'aeolian' | 'phrygian' | 'locrian';

export type ModeInfo = {
  id: ModeId;
  name: string;
  /** Semitones above the tonic for degrees 1–7. */
  semis: number[];
  /** The white key that is home when this mode uses only white keys. */
  white: string;
  /** Degrees that differ from major, as labels (e.g. '♭3'). */
  vsMajor: string[];
  /** The degree (0-based) that gives the mode its color. */
  color: number;
  colorLabel: string;
  blurb: string;
};

// Ordered from brightest to darkest: each step lowers one more degree.
export const MODES: ModeInfo[] = [
  { id: 'lydian', name: 'Lydian', semis: [0, 2, 4, 6, 7, 9, 11], white: 'F', vsMajor: ['♯4'], color: 3, colorLabel: '♯4', blurb: 'Major with a raised 4th: bright, floating, a little unreal.' },
  { id: 'ionian', name: 'Ionian (major)', semis: [0, 2, 4, 5, 7, 9, 11], white: 'C', vsMajor: [], color: 6, colorLabel: '7', blurb: 'The major scale. Its 7th sits a half step under home and leans into it.' },
  { id: 'mixolydian', name: 'Mixolydian', semis: [0, 2, 4, 5, 7, 9, 10], white: 'G', vsMajor: ['♭7'], color: 6, colorLabel: '♭7', blurb: 'Major with a lowered 7th: bluesy, rock, folk; home without the lean.' },
  { id: 'dorian', name: 'Dorian', semis: [0, 2, 3, 5, 7, 9, 10], white: 'D', vsMajor: ['♭3', '♭7'], color: 5, colorLabel: '6', blurb: 'Minor with a raised 6th: minor but not tragic; funk, jazz, folk.' },
  { id: 'aeolian', name: 'Aeolian (natural minor)', semis: [0, 2, 3, 5, 7, 8, 10], white: 'A', vsMajor: ['♭3', '♭6', '♭7'], color: 5, colorLabel: '♭6', blurb: 'The natural minor scale: darker, with a sighing ♭6.' },
  { id: 'phrygian', name: 'Phrygian', semis: [0, 1, 3, 5, 7, 8, 10], white: 'E', vsMajor: ['♭2', '♭3', '♭6', '♭7'], color: 1, colorLabel: '♭2', blurb: 'Minor with a lowered 2nd: a half step above home; flamenco, metal.' },
  { id: 'locrian', name: 'Locrian', semis: [0, 1, 3, 5, 6, 8, 10], white: 'B', vsMajor: ['♭2', '♭3', '♭5', '♭6', '♭7'], color: 4, colorLabel: '♭5', blurb: 'No perfect 5th above home, so home barely holds. Rare as a real key.' },
];

export const modeById = (id: ModeId) => MODES.find((m) => m.id === id)!;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** Spell a seven-note scale (one letter per degree) from a tonic letter and semitone pattern. */
export function spellScale(tonicLetter: string, tonicPc: number, semis: number[]): string[] {
  const li = LETTERS.indexOf(tonicLetter);
  return semis.map((s, i) => {
    const L = (li + i) % 7;
    const pc = (tonicPc + s) % 12;
    let d = (((pc - LETTER_PC[L]) % 12) + 12) % 12;
    if (d > 6) d -= 12;
    const acc = d === 0 ? '' : d === 1 ? '♯' : d === -1 ? '♭' : d === 2 ? '𝄪' : d === -2 ? '𝄫' : '?';
    return LETTERS[L] + acc;
  });
}

export const letterPc = (letter: string) => LETTER_PC[LETTERS.indexOf(letter)];

// ---------- probe-tone profiles ----------
// Krumhansl & Kessler (1982), as tabulated in Krumhansl (1990), index 0 = tonic.
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Profile rotated so index = absolute pitch class, for a key on `tonicPc`. */
export const rotated = (profile: number[], tonicPc: number) => Array.from({ length: 12 }, (_, pc) => profile[(pc - tonicPc + 12) % 12]);

// ---------- key finding (Krumhansl–Schmuckler) ----------

/** Total duration of each pitch class in a tune (rests ignored). */
export function pcDurations(notes: Note[]): number[] {
  const h = new Array(12).fill(0);
  for (const [m, len] of notes) if (m > 0) h[m % 12] += len;
  return h;
}

export type KeyGuess = { tonicPc: number; minor: boolean; r: number; name: string };

const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
export const keyName = (pc: number, minor: boolean) => (minor ? MINOR_NAMES[pc] + ' minor' : KEY_NAMES[pc] + ' major');

/** All 24 major and minor keys ranked by how well their profile matches the tune's durations. */
export function findKeys(notes: Note[]): KeyGuess[] {
  const h = pcDurations(notes);
  const out: KeyGuess[] = [];
  for (let pc = 0; pc < 12; pc++) {
    out.push({ tonicPc: pc, minor: false, r: correlation(h, rotated(KK_MAJOR, pc)), name: keyName(pc, false) });
    out.push({ tonicPc: pc, minor: true, r: correlation(h, rotated(KK_MINOR, pc)), name: keyName(pc, true) });
  }
  return out.sort((a, b) => b.r - a.r);
}

// ---------- modal tunes for the key-finding lab ----------
// "Drunken Sailor" (traditional sea shanty), in D Dorian: C natural and B
// natural over a D home. Lengths in eighth notes; rhythm simplified.
const line = (a: number, b: number, c: number, d: number): Note[] => [
  [a, 2], [a, 1], [a, 1], [a, 2], [a, 1], [a, 1],
  [a, 2], [b, 2], [c, 2], [d, 2],
];
export const SAILOR: Note[] = [
  ...line(69, 62, 65, 69),
  ...line(67, 60, 64, 67),
  ...line(69, 71, 72, 74),
  [72, 2], [69, 2], [67, 2], [64, 2], [62, 4], [62, 4],
];

/** A short phrase in scale degrees (0 = home, 7 = home an octave up, -1 = 7th below), lengths in eighths. */
export const MODAL_PHRASE: [number, number][] = [
  [0, 2], [2, 2], [4, 2], [5, 2], [4, 2], [3, 1], [2, 1], [1, 4],
  [2, 2], [4, 2], [6, 2], [7, 2], [5, 4], [4, 4],
  [3, 2], [2, 2], [1, 2], [-1, 2], [0, 8],
];

/** MIDI note for scale degree `d` (may be negative or ≥ 7) of a mode on `tonicMidi`. */
export function degreeMidi(tonicMidi: number, semis: number[], d: number): number {
  const oct = Math.floor(d / 7);
  const i = ((d % 7) + 7) % 7;
  return tonicMidi + 12 * oct + semis[i];
}
