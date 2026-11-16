// Interval arithmetic and naming for chapter 3.1.
//
// Ratios multiply, cents add: stacking intervals multiplies their frequency
// ratios, which is the same as adding their sizes in cents (cents are a
// logarithmic unit: 1200 × log2(ratio)). Names follow the letter-counting
// convention from the Toolkit, extended to compound intervals (larger than an
// octave: a 10th is a 3rd plus an octave).

import { INTERVALS, ratioToCents } from './tuning';

export type Frac = [number, number];

export function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}

export function reduce([n, d]: Frac): Frac {
  const g = gcd(n, d) || 1;
  return [n / g, d / g];
}

export function mul(a: Frac, b: Frac): Frac {
  return reduce([a[0] * b[0], a[1] * b[1]]);
}

export const fracCents = (f: Frac) => ratioToCents(f[0] / f[1]);
export const fracText = (f: Frac) => `${f[0]}/${f[1]}`;

/** The just intervals offered for stacking. */
export type JustStep = { short: string; name: string; ratio: Frac };
export const PALETTE: JustStep[] = [
  { short: 'M2', name: 'major second', ratio: [9, 8] },
  { short: 'm3', name: 'minor third', ratio: [6, 5] },
  { short: 'M3', name: 'major third', ratio: [5, 4] },
  { short: 'P4', name: 'perfect fourth', ratio: [4, 3] },
  { short: 'P5', name: 'perfect fifth', ratio: [3, 2] },
  { short: 'm6', name: 'minor sixth', ratio: [8, 5] },
  { short: 'M6', name: 'major sixth', ratio: [5, 3] },
  { short: 'P8', name: 'octave', ratio: [2, 1] },
];

/** Letter-name number of each simple interval (tritone counted as a 4th). */
const NUMBER = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];
const ORDINAL: Record<number, string> = {
  2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh',
  9: 'ninth', 10: 'tenth', 11: 'eleventh', 12: 'twelfth', 13: 'thirteenth', 14: 'fourteenth',
};
const QUALITY: Record<string, string> = { m: 'minor', M: 'major', P: 'perfect' };

export type IntervalName = { name: string; short: string; semis: number; offset: number };

/**
 * Name of the nearest equal-tempered interval to a size in cents, including
 * compound intervals up to three octaves. `offset` is cents away from it.
 */
export function intervalName(cents: number): IntervalName {
  const semis = Math.max(0, Math.round(cents / 100));
  const offset = cents - semis * 100;
  const oct = Math.floor(semis / 12);
  const s = semis % 12;
  if (s === 0) {
    const name = oct === 0 ? 'unison' : oct === 1 ? 'octave' : `${oct === 2 ? 'two' : 'three'} octaves`;
    return { name, short: oct === 0 ? 'P1' : oct === 1 ? 'P8' : `${oct}×P8`, semis, offset };
  }
  const simple = INTERVALS[s];
  if (s === 6) {
    const name = oct === 0 ? 'tritone' : `tritone + ${oct === 1 ? 'an octave' : `${oct} octaves`}`;
    return { name, short: oct === 0 ? 'TT' : `TT+${oct}`, semis, offset };
  }
  const num = NUMBER[s] + 7 * oct;
  const q = QUALITY[simple.short[0]];
  const ord = ORDINAL[num];
  if (!ord) return { name: `${simple.name} + ${oct} octaves`, short: `${simple.short}+${oct}`, semis, offset };
  return { name: `${q} ${ord}`, short: `${simple.short[0]}${num}`, semis, offset };
}

/** Inversion of a simple interval: its complement within the octave. */
export function invert(ratio: Frac): Frac {
  return reduce([2 * ratio[1], ratio[0]]);
}

/** Sizes (cents) for the minor-or-major-third test, evenly spaced from m3 to M3. */
export const THIRD_STEPS = [300, 317, 333, 350, 367, 383, 400];

/** Where an identification curve crosses 50%, by linear interpolation (null if it never does). */
export function boundary(points: { x: number; p: number }[]): number | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if ((a.p - 0.5) * (b.p - 0.5) <= 0 && a.p !== b.p) return a.x + ((0.5 - a.p) / (b.p - a.p)) * (b.x - a.x);
  }
  return null;
}
