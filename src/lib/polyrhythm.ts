// Polyrhythm, polymeter, and phasing: the arithmetic behind PolyrhythmLab.
//
// - Polyrhythm (n:m): two pulses dividing the same cycle into n and m equal
//   parts. The smallest grid that holds both has lcm(n, m) cells; pulse A
//   sounds every lcm/n cells, pulse B every lcm/m cells. Together they make
//   n + m - gcd(n, m) distinct onsets per cycle (the composite rhythm).
// - Polymeter: two loops on the same step pulse but of different lengths
//   (a and b steps). They line up again every lcm(a, b) steps.
// - Phasing (Reich): a 12-pulse pattern against a copy of itself. The copy
//   runs `phi` pulses ahead; phi drifts gradually (Piano Phase) or jumps one
//   pulse at a time (Clapping Music).

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

export type RatioGrid = { cells: number; a: boolean[]; b: boolean[]; both: boolean[]; onsets: number };

/** The lcm grid for an n:m polyrhythm. */
export function ratioGrid(n: number, m: number): RatioGrid {
  const cells = lcm(n, m);
  const a = Array.from({ length: cells }, (_, c) => c % (cells / n) === 0);
  const b = Array.from({ length: cells }, (_, c) => c % (cells / m) === 0);
  const both = a.map((x, c) => x && b[c]);
  const onsets = a.filter((x, c) => x || b[c]).length; // = n + m - gcd(n, m)
  return { cells, a, b, both, onsets };
}

/** Inter-onset gaps of the composite rhythm, in cells (e.g. 3:2 → [2, 1, 1, 2]). */
export function compositeGaps(g: RatioGrid): number[] {
  const on = g.a.map((x, c) => (x || g.b[c] ? c : -1)).filter((c) => c >= 0);
  return on.map((c, i) => (i + 1 < on.length ? on[i + 1] : g.cells) - c);
}

export type RatioPreset = { id: string; n: number; m: number; label: string; say?: string[] };

/**
 * Common ratios. `say` is a mnemonic phrase with one syllable per composite
 * onset (used only in the chapter text and table; listed here for reference).
 */
export const RATIOS: RatioPreset[] = [
  { id: '3:2', n: 3, m: 2, label: '3 : 2', say: ['nice', 'cup', 'of', 'tea'] },
  { id: '4:3', n: 4, m: 3, label: '4 : 3', say: ['pass', 'the', 'god', 'damn', 'but', 'ter'] },
  { id: '3:4', n: 3, m: 4, label: '3 : 4' },
  { id: '5:4', n: 5, m: 4, label: '5 : 4' },
  { id: '5:3', n: 5, m: 3, label: '5 : 3' },
  { id: '7:4', n: 7, m: 4, label: '7 : 4' },
];

export type MeterPreset = {
  id: string;
  label: string;
  /** Loop A: the cross-pattern (1 = tone, 2 = accented tone, 0 = rest). */
  a: (0 | 1 | 2)[];
  /** Loop B length in steps: the "bar" kept by kick and hi-hat. */
  b: number;
  blurb: string;
};

export const METERS: MeterPreset[] = [
  { id: '3v4', label: '3 against 4', a: [2, 0, 1], b: 4, blurb: 'A 3-step figure over a 4-step bar: they line up every 12 steps.' },
  { id: '5v4', label: '5 against 4', a: [2, 0, 1, 1, 0], b: 4, blurb: 'A 5-step figure over a 4-step bar: 20 steps before they meet again.' },
  { id: '3v8', label: '3s across 8', a: [2, 0, 1], b: 8, blurb: 'Groups of three across a bar of eight: the figure lands somewhere new in each bar.' },
  { id: '7v8', label: '7 against 8', a: [2, 0, 1, 0, 1, 1, 0], b: 8, blurb: 'A 7-step riff over a bar of 8: it slips back one step every bar.' },
  {
    id: '13v16',
    label: '13 against 16',
    a: [2, 0, 1, 1, 0, 1, 0, 2, 0, 1, 0, 1, 1],
    b: 16,
    blurb: 'A long 13-step riff over a 16-step bar, metal style: 208 steps (13 bars) before it comes round.',
  },
];

export type PhasePattern = { id: string; label: string; onsets: boolean[]; midi?: number[]; blurb: string };

const x = (s: string) => s.split('').map((c) => c === 'x');

export const PHASE_PATTERNS: PhasePattern[] = [
  {
    id: 'melody',
    label: 'Twelve-note melody',
    onsets: Array(12).fill(true),
    // An original pattern in the style of early minimalism (not Reich's).
    midi: [64, 71, 67, 74, 69, 71, 64, 67, 74, 71, 69, 67],
    blurb: 'Twelve quick notes, two identical piano-like parts, one in each ear.',
  },
  {
    id: 'bell',
    label: '12-pulse bell pattern',
    onsets: x('x.x.xx.x.x.x'),
    blurb: 'The West African 12-pulse bell pattern (seven strokes), clapped by two players, one in each ear.',
  },
];

/** Distinct onset positions when a 12-pulse pattern meets a copy shifted by an integer offset. */
export function phaseComposite(onsets: boolean[], offset: number): { union: number; together: number } {
  const n = onsets.length;
  let union = 0;
  let together = 0;
  for (let i = 0; i < n; i++) {
    const a = onsets[i];
    const b = onsets[(((i + offset) % n) + n) % n];
    if (a || b) union++;
    if (a && b) together++;
  }
  return { union, together };
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
