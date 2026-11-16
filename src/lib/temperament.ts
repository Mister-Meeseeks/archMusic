// Scales and tuning systems (chapter 3.2). Framework-free.
//
// Everything is in cents above C (0–1200). A "keyboard tuning" is a table of
// 12 pitch classes, the way a harpsichord or organ is actually tuned: once set,
// every key has to use the same 12 pitches.

export const FIFTH = 1200 * Math.log2(3 / 2); // 701.955
export const THIRD = 1200 * Math.log2(5 / 4); // 386.314
export const MINOR_THIRD = 1200 * Math.log2(6 / 5); // 315.641
export const PYTHAGOREAN_COMMA = 12 * FIFTH - 7 * 1200; // 23.460
export const SYNTONIC_COMMA = 1200 * Math.log2(81 / 80); // 21.506

export const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Names along a chain of fifths upward from C (index = number of fifths). */
export const FIFTH_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'];

export const mod = (x: number, m: number) => ((x % m) + m) % m;
export const cents = (ratio: number) => 1200 * Math.log2(ratio);

// ---------- stacking fifths ----------

export type StackNote = { n: number; name: string; cents: number };

/** The first `count` notes of a chain of pure fifths from C, folded into one octave. */
export function stackFifths(count: number, fifth = FIFTH): StackNote[] {
  return Array.from({ length: count }, (_, n) => ({ n, name: FIFTH_NAMES[n] ?? `+${n}`, cents: mod(n * fifth, 1200) }));
}

/** The scale those notes make: sorted, with the step sizes between neighbours (last step wraps to the octave). */
export function scaleSteps(notes: StackNote[]) {
  const sorted = [...notes].sort((a, b) => a.cents - b.cents);
  const steps = sorted.map((nt, i) => (i + 1 < sorted.length ? sorted[i + 1].cents : 1200 + sorted[0].cents) - nt.cents);
  // distinct step sizes (to 0.1 cent)
  const sizes: { size: number; count: number }[] = [];
  for (const s of steps) {
    const hit = sizes.find((x) => Math.abs(x.size - s) < 0.05);
    if (hit) hit.count++;
    else sizes.push({ size: s, count: 1 });
  }
  sizes.sort((a, b) => b.size - a.size);
  return { sorted, steps, sizes };
}

// ---------- keyboard tunings ----------

export type TuningId = 'pythagorean' | 'just' | 'meantone' | 'werckmeister' | 'equal';

/** A 12-note tuning made from a chain of equal fifths running E♭ … G♯ (the usual layout). */
function chainTuning(fifth: number): number[] {
  const t = new Array(12).fill(0);
  for (let n = -3; n <= 8; n++) t[mod(7 * n, 12)] = mod(n * fifth, 1200);
  return t;
}

const QUARTER_COMMA_FIFTH = FIFTH - SYNTONIC_COMMA / 4; // 696.578: four of them make a pure 5:4 (plus two octaves)

// A common 5-limit just keyboard centred on C.
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8];

export const TUNINGS: Record<TuningId, { label: string; short: string; table: number[]; blurb: string }> = {
  pythagorean: {
    label: 'Pythagorean',
    short: 'Pyth.',
    table: chainTuning(FIFTH),
    blurb: 'Eleven pure fifths from E♭ to G♯. The leftover fifth, G♯–E♭, is short by a Pythagorean comma.',
  },
  just: {
    label: 'Just (tuned for C)',
    short: 'Just',
    table: JUST_RATIOS.map(cents),
    blurb: 'Pure 3:2 fifths and 5:4 thirds around C. Perfect in C major; some chords elsewhere (even D minor) are badly out.',
  },
  meantone: {
    label: 'Quarter-comma meantone',
    short: 'Meantone',
    table: chainTuning(QUARTER_COMMA_FIFTH),
    blurb: 'Every fifth narrowed by a quarter of a syntonic comma so that the major thirds are pure. The leftover fifth G♯–E♭ is the wolf.',
  },
  werckmeister: {
    label: 'Werckmeister III (1691)',
    short: 'Werck.',
    // Four fifths (C–G–D–A and B–F♯) narrowed by a quarter Pythagorean comma, the rest pure.
    table: [0, 90.225, 192.18, 294.135, 390.225, 498.045, 588.27, 696.09, 792.18, 888.27, 996.09, 1092.18],
    blurb: 'A well temperament: no wolf, every key usable, but keys near C have purer thirds than keys far away.',
  },
  equal: {
    label: '12-tone equal',
    short: 'Equal',
    table: Array.from({ length: 12 }, (_, i) => i * 100),
    blurb: 'Twelve identical semitones. Every key is the same; every fifth is 2¢ narrow and every major third 14¢ wide.',
  },
};

/** Size in cents of the interval `semis` semitones above pitch class `pc` in a keyboard tuning. */
export function intervalAt(table: number[], pc: number, semis: number): number {
  return mod(table[mod(pc + semis, 12)] - table[mod(pc, 12)], 1200) + 1200 * Math.floor(semis / 12);
}

export type ChordCheck = { root: number; name: string; quality: 'major' | 'minor'; third: number; fifth: number; thirdErr: number; fifthErr: number; wolf: boolean };

/** How pure a triad on `root` is in a tuning: its third and fifth against the just 5:4 (or 6:5) and 3:2. */
export function checkTriad(table: number[], root: number, quality: 'major' | 'minor' = 'major'): ChordCheck {
  const third = intervalAt(table, root, quality === 'major' ? 4 : 3);
  const fifth = intervalAt(table, root, 7);
  const pure = quality === 'major' ? THIRD : MINOR_THIRD;
  return {
    root,
    name: PC_NAMES[mod(root, 12)] + (quality === 'minor' ? 'm' : ''),
    quality,
    third,
    fifth,
    thirdErr: third - pure,
    fifthErr: fifth - FIFTH,
    // a fifth more than ~12¢ off, or a third more than ~30¢ off, howls
    wolf: Math.abs(fifth - FIFTH) > 12 || Math.abs(third - pure) > 30,
  };
}

/** The twelve fifths of a tuning, in circle-of-fifths order from C (C–G, G–D, …, F–C). */
export function circleFifths(table: number[]) {
  return Array.from({ length: 12 }, (_, i) => {
    const pc = mod(7 * i, 12);
    return { from: PC_NAMES[pc], to: PC_NAMES[mod(pc + 7, 12)], size: intervalAt(table, pc, 7) };
  });
}

export const C4 = 261.6256; // equal-tempered middle C (A4 = 440)

/** Frequency of pitch class `pc` in `octave` (4 = middle-C octave) for a keyboard tuning, with C held fixed. */
export function freqOf(table: number[], pc: number, octave = 4): number {
  const p = mod(pc, 12);
  const oct = octave + Math.floor(pc / 12);
  return C4 * 2 ** (oct - 4) * 2 ** (table[p] / 1200);
}

// ---------- the comma pump ----------

export type PumpChord = { name: string; quality: 'major' | 'minor'; root: number }; // root in Hz

/**
 * C – Am – Dm – G – C, every chord tuned pure and each common note held where
 * it is. Returns the chords for `cycles` trips round; each trip ends a
 * syntonic comma (81:80) lower than it started.
 */
export function commaPump(cycles: number, start = C4 / 2): PumpChord[] {
  const out: PumpChord[] = [];
  let c = start;
  for (let k = 0; k < cycles; k++) {
    const a = (c * 5) / 3 / 2; // A: a pure major sixth above C, down an octave (C is A's minor third)
    const d = (a * 4) / 3; // D: a pure fourth above A
    const g = ((d * 4) / 3) / 2; // G: a pure fourth above D, down an octave
    out.push({ name: 'C', quality: 'major', root: c }, { name: 'Am', quality: 'minor', root: a }, { name: 'Dm', quality: 'minor', root: d }, { name: 'G', quality: 'major', root: g });
    c = (g * 4) / 3; // back to C: a pure fourth above G
  }
  out.push({ name: 'C', quality: 'major', root: c });
  return out;
}

/** The same progression on an equal-tempered keyboard (no drift). */
export function equalPump(cycles: number, start = C4 / 2): PumpChord[] {
  const st = (s: number) => start * 2 ** (s / 12);
  const one = [
    { name: 'C', quality: 'major' as const, root: st(0) },
    { name: 'Am', quality: 'minor' as const, root: st(-3) },
    { name: 'Dm', quality: 'minor' as const, root: st(2) },
    { name: 'G', quality: 'major' as const, root: st(-5) },
  ];
  return [...Array.from({ length: cycles }, () => one).flat(), { name: 'C', quality: 'major', root: st(0) }];
}

/** Triad frequencies for a pump chord: pure ratios, or equal-tempered steps. */
export function pumpVoicing(ch: PumpChord, pure: boolean): number[] {
  const r = ch.root;
  const third = pure ? (ch.quality === 'major' ? 5 / 4 : 6 / 5) : 2 ** ((ch.quality === 'major' ? 4 : 3) / 12);
  const fifth = pure ? 3 / 2 : 2 ** (7 / 12);
  return [r, r * 2, r * 2 * third, r * 2 * fifth];
}

// ---------- equal divisions of the octave ----------

export type Target = { label: string; ratio: number };
export const TARGETS: Target[] = [
  { label: 'Fifth 3:2', ratio: 3 / 2 },
  { label: 'Major third 5:4', ratio: 5 / 4 },
  { label: 'Minor third 6:5', ratio: 6 / 5 },
  { label: 'Harmonic seventh 7:4', ratio: 7 / 4 },
];

/** Best approximation of a ratio in N-tone equal temperament: step number and error in cents. */
export function edoApprox(n: number, ratio: number) {
  const exact = cents(ratio);
  const step = Math.round((exact / 1200) * n);
  const size = (step * 1200) / n;
  return { step, size, err: size - exact };
}
