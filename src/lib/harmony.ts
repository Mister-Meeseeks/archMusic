// Chords, voicings, and voice leading. Framework-free, used by VoicingLab.
//
//   QUALITIES          triad and seventh-chord types as semitones above the root
//   diatonicChord      the chord built by stacking thirds on a degree of C major
//   voiceChord         a concrete voicing: inversion (which tone is in the bass)
//                      and spacing (close, open, or spread like the harmonic series)
//   leadVoices         four-part voice leading through a progression: either
//                      "block" (every voice moves in parallel) or "smooth" (a search
//                      for the voicing that moves least, avoiding parallel fifths and
//                      octaves). The search is the model behind the lab's display.
//   parallels          parallel fifths/octaves between two voicings

import { NOTE_NAMES } from './tuning';

export type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'maj7' | '7' | 'm7' | 'm7b5' | 'dim7';

export const QUALITIES: Record<Quality, { label: string; suffix: string; semis: number[]; degrees: string }> = {
  maj: { label: 'Major', suffix: '', semis: [0, 4, 7], degrees: '1 3 5' },
  min: { label: 'Minor', suffix: 'm', semis: [0, 3, 7], degrees: '1 ♭3 5' },
  dim: { label: 'Diminished', suffix: '°', semis: [0, 3, 6], degrees: '1 ♭3 ♭5' },
  aug: { label: 'Augmented', suffix: '+', semis: [0, 4, 8], degrees: '1 3 ♯5' },
  maj7: { label: 'Major seventh', suffix: 'maj7', semis: [0, 4, 7, 11], degrees: '1 3 5 7' },
  '7': { label: 'Dominant seventh', suffix: '7', semis: [0, 4, 7, 10], degrees: '1 3 5 ♭7' },
  m7: { label: 'Minor seventh', suffix: 'm7', semis: [0, 3, 7, 10], degrees: '1 ♭3 5 ♭7' },
  m7b5: { label: 'Half-diminished', suffix: 'm7♭5', semis: [0, 3, 6, 10], degrees: '1 ♭3 ♭5 ♭7' },
  dim7: { label: 'Diminished seventh', suffix: '°7', semis: [0, 3, 6, 9], degrees: '1 ♭3 ♭5 𝄫7' },
};

export function qualityOf(semis: number[]): Quality | null {
  const key = semis.join(',');
  for (const [q, v] of Object.entries(QUALITIES)) if (v.semis.join(',') === key) return q as Quality;
  return null;
}

// ---------- spelling ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const ACC: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** Letter index (0 = C) and accidental of a pitch-class name like "E♭". */
function parseName(name: string): number {
  return LETTERS.indexOf(name[0]);
}

/** Spell a chord's tones with correct letters (each tone a third above the last). */
export function spellChord(rootPc: number, semis: number[], rootName = NOTE_NAMES[rootPc % 12]): string[] {
  const l0 = parseName(rootName);
  return semis.map((s, i) => {
    const letter = (l0 + 2 * i) % 7;
    const target = (rootPc + s) % 12;
    let d = (target - NATURAL[letter] + 12) % 12;
    if (d > 6) d -= 12;
    return LETTERS[letter] + (ACC[d] ?? '?');
  });
}

// ---------- diatonic chords in C major ----------

export const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export type ChordSpec = { rootPc: number; q: Quality; symbol: string; roman: string; rootName: string };

export function romanFor(degree: number, q: Quality): string {
  const upper = q === 'maj' || q === 'aug' || q === 'maj7' || q === '7';
  const base = upper ? ROMAN[degree] : ROMAN[degree].toLowerCase();
  const tail: Record<Quality, string> = { maj: '', min: '', dim: '°', aug: '+', maj7: 'maj7', '7': '7', m7: '7', m7b5: 'ø7', dim7: '°7' };
  return base + tail[q];
}

/** The chord on scale degree `degree` (0–6) of C major: stack thirds from the scale. */
export function diatonicChord(degree: number, sevenths = false): ChordSpec & { pcs: number[]; semis: number[] } {
  const n = sevenths ? 4 : 3;
  const pcs = Array.from({ length: n }, (_, i) => C_MAJOR[(degree + 2 * i) % 7]);
  const rootPc = pcs[0];
  const semis = pcs.map((p) => (p - rootPc + 12) % 12);
  const q = qualityOf(semis)!;
  const rootName = LETTERS[degree];
  return { rootPc, q, pcs, semis, rootName, symbol: rootName + QUALITIES[q].suffix, roman: romanFor(degree, q) };
}

/** Parse a chord symbol from the lab's progressions: "C", "Am", "G7", "Dm7", "Cmaj7", "Bm7♭5", "B°". */
export function parseSymbol(sym: string): ChordSpec {
  const m = sym.match(/^([A-G])([♯♭]?)(.*)$/)!;
  const rootName = m[1] + m[2];
  const rootPc = (NATURAL[LETTERS.indexOf(m[1])] + (m[2] === '♯' ? 1 : m[2] === '♭' ? -1 : 0) + 12) % 12;
  const suffix = m[3];
  const q = (Object.keys(QUALITIES) as Quality[]).find((k) => QUALITIES[k].suffix === suffix) ?? 'maj';
  const deg = C_MAJOR.indexOf(rootPc);
  return { rootPc, q, rootName, symbol: sym, roman: deg >= 0 ? romanFor(deg, q) : '' };
}

// ---------- voicing ----------

export type Spacing = 'close' | 'open' | 'spread';

/** Smallest MIDI note above `above` (exclusive) with pitch class `pc`. */
const nextAbove = (above: number, pc: number) => above + 1 + ((pc - (above + 1)) % 12 + 12) % 12;

/**
 * A concrete voicing, bottom to top.
 * - inversion k puts chord tone k (0 = root, 1 = third, 2 = fifth, 3 = seventh) in the bass.
 * - close: every tone stacked as tightly as possible above the bass.
 * - open: skip a chord tone each time (root, fifth, third, seventh...).
 * - spread: the bass, its octave, then the rest close together higher up:
 *   wide intervals at the bottom, narrow at the top, like the harmonic series.
 * Triads get a fourth note: the bass doubled on top (in close and open).
 */
export function voiceChord(rootMidi: number, semis: number[], inversion: number, spacing: Spacing): number[] {
  const n = semis.length;
  const inv = Math.min(inversion, n - 1);
  const rot = semis.map((_, i) => (rootMidi + semis[(inv + i) % n]) % 12);
  const bass = rootMidi + semis[inv];
  const out = [bass];
  const place = (pcs: number[]) => {
    for (const pc of pcs) out.push(nextAbove(out[out.length - 1], pc));
  };
  if (spacing === 'close') {
    place(rot.slice(1));
    if (n === 3) place([rot[0]]);
  } else if (spacing === 'open') {
    const order = [...rot.map((_, i) => i).filter((i) => i % 2 === 0), ...rot.map((_, i) => i).filter((i) => i % 2 === 1)];
    place(order.slice(1).map((i) => rot[i]));
    if (n === 3) place([rot[0]]);
  } else {
    out.push(bass + 12);
    // close stack of all chord tones starting at least an octave and a fifth above the bass
    const start = bass + 18;
    const first = rot.map((pc) => nextAbove(start, pc)).reduce((a, b) => Math.min(a, b));
    out.push(first);
    const i0 = rot.indexOf(first % 12);
    for (let k = 1; k < n; k++) out.push(nextAbove(out[out.length - 1], rot[(i0 + k) % n]));
  }
  return out;
}

// ---------- voice leading ----------

export type Parallel = { lo: number; hi: number; kind: 'fifths' | 'octaves' };

/** Parallel perfect fifths/octaves (or unisons) between two voicings of equal size. */
export function parallels(a: number[], b: number[]): Parallel[] {
  const out: Parallel[] = [];
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const ia = (((a[j] - a[i]) % 12) + 12) % 12;
      const ib = (((b[j] - b[i]) % 12) + 12) % 12;
      const di = b[i] - a[i];
      const dj = b[j] - a[j];
      if (ia === ib && (ia === 0 || ia === 7) && di !== 0 && dj !== 0 && Math.sign(di) === Math.sign(dj))
        out.push({ lo: i, hi: j, kind: ia === 7 ? 'fifths' : 'octaves' });
    }
  return out;
}

export const motion = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(b[i] - v), 0);

const RANGES: [number, number][] = [
  [36, 52], // bass  C2–E3
  [48, 67], // tenor C3–G4
  [55, 74], // alto  G3–D5
  [60, 79], // soprano C4–G5
];

function pitchesIn([lo, hi]: [number, number], pcs: number[]) {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

export type LeadOpts = { style: 'smooth' | 'block'; bass: 'root' | 'smooth' };

/**
 * Four voices (bass, tenor, alto, soprano) through a progression.
 * Block: root in the bass, the upper three in close root position, all moving
 * in parallel. Smooth: for each chord, search every voicing in range and keep
 * the one with the least total motion, with a heavy penalty for parallel
 * fifths/octaves and a small one for inversions (if allowed) and big spacing.
 */
export function leadVoices(chords: ChordSpec[], opts: LeadOpts): number[][] {
  if (opts.style === 'block') {
    return chords.map((c) => {
      const semis = QUALITIES[c.q].semis;
      const bass = 36 + c.rootPc;
      const up = 48 + c.rootPc;
      const upper = semis.length === 4 ? semis.slice(1) : semis;
      return [bass, ...upper.map((s) => up + s)];
    });
  }
  const out: number[][] = [];
  let prev: number[] = [48, 55, 60, 64]; // a target for the first chord: C2-ish bass, middle-register upper voices
  chords.forEach((c, ci) => {
    const semis = QUALITIES[c.q].semis;
    const pcs = semis.map((s) => (c.rootPc + s) % 12);
    const required = semis.length === 4 ? [pcs[0], pcs[1], pcs[3]] : pcs; // fifth optional in sevenths
    // first and last chords stay in root position; in between, a third in the bass is cheap, a fifth less so
    const edge = ci === 0 || ci === chords.length - 1;
    const bassCands = pitchesIn(RANGES[0], opts.bass === 'root' || edge ? [pcs[0]] : pcs);
    const inversionCost = (pc: number) => (pc === pcs[0] ? 0 : pc === pcs[1] ? 1 : semis.length === 3 && pc === pcs[2] ? 6 : 3);
    const cands = [1, 2, 3].map((v) => pitchesIn(RANGES[v], pcs));
    let best: number[] | null = null;
    let bestCost = Infinity;
    for (const b of bassCands) {
      const bassCost = (ci === 0 ? Math.abs(b - 45) : Math.abs(b - prev[0])) + inversionCost(b % 12);
      for (const t of cands[0])
        for (const a of cands[1]) {
          if (a <= t || a - t > 12) continue;
          for (const s of cands[2]) {
            if (s <= a || s - a > 12) continue;
            if (t < b) continue;
            const v = [b, t, a, s];
            const have = new Set(v.map((m) => m % 12));
            if (!required.every((p) => have.has(p))) continue;
            let cost = bassCost + Math.abs(t - prev[1]) + Math.abs(a - prev[2]) + Math.abs(s - prev[3]);
            if (ci > 0) cost += 12 * parallels(prev, v).length;
            // doubling the third of a major triad sounds heavy; prefer doubling the root
            if (v.filter((m) => m % 12 === pcs[1]).length > 1) cost += semis.length === 3 ? 2 : 4;
            // a doubled seventh has nowhere good to go: both copies want to step down
            if (semis.length === 4 && v.filter((m) => m % 12 === pcs[3]).length > 1) cost += 6;
            if (t - b > 19) cost += 2;
            if (cost < bestCost) {
              bestCost = cost;
              best = v;
            }
          }
        }
    }
    const v = best ?? prev;
    out.push(v);
    prev = v;
  });
  return out;
}

/** Name of the bass note for a slash chord, spelled from the chord. */
export function slashSymbol(c: ChordSpec, bassMidi: number): string {
  const semis = QUALITIES[c.q].semis;
  const names = spellChord(c.rootPc, semis, c.rootName);
  const idx = semis.findIndex((s) => (c.rootPc + s) % 12 === bassMidi % 12);
  return idx <= 0 ? c.symbol : `${c.symbol}/${names[idx]}`;
}

/** Short interval label for a gap in semitones (m3, P5, 8ve+M3...). */
export function gapLabel(semis: number): string {
  const names = ['8ve', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7'];
  if (semis === 0) return 'uni';
  if (semis < 12) return names[semis];
  if (semis === 12) return '8ve';
  if (semis === 24) return '2 8ves';
  return `8ve+${names[semis % 12] === '8ve' ? '8ve' : names[semis % 12]}`;
}
