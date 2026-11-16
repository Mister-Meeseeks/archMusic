// Resonators of acoustic instruments (chapter 4.1): their modes of vibration,
// the frequency ratios of those modes, their shapes, and how an exciter
// (pluck, bow, breath, strike) sets them going.
//
// Sources for the numbers (all standard; see the chapter's verify callouts):
// - Ideal string, open and closed pipes: textbook standing waves.
// - Stiff string: f_n = n f0 sqrt(1 + B n^2) (Fletcher 1964), normalized so mode 1 = 1.
// - Ideal circular membrane: zeros of the Bessel functions J_m (Abramowitz & Stegun).
// - Timpani: Rossing's measured ratios relative to the (1,1) "principal" mode,
//   about 1 : 1.50 : 1.98 : 2.44 : 2.94 (Fletcher & Rossing 1998).
// - Tabla: Raman (1934): the loaded head brings the modes close to 1:2:3:4:5.
// - Free bar: (beta_n L)^2 with beta_n L = 4.730, 7.853, 10.996, 14.137, 17.279.
// - Marimba: bars undercut so mode 2 sits two octaves up (4x) and mode 3 near 10x.
// - Church bell: the "ideal" named partials hum, prime, tierce, quint, nominal...
//   Ratios relative to the prime; the nodal patterns are approximate.

export type Shape = '1d' | 'disk' | 'bell';

export type Mode = {
  /** frequency relative to mode 1 (the lowest listed mode, unless noted) */
  r: number;
  label: string;
  /** disk/bell: nodal diameters (m) and nodal circles (n - 1) */
  m?: number;
  n?: number;
};

export type ResonatorId = 'string' | 'open' | 'closed' | 'membrane' | 'timpani' | 'tabla' | 'bar' | 'marimba' | 'bell';
export type Excite = 'pluck' | 'bow' | 'blow' | 'strike';

export type Resonator = {
  id: ResonatorId;
  label: string;
  family: string; // Hornbostel–Sachs family
  blurb: string;
  shape: Shape;
  f1: number; // Hz of the first listed mode
  excitations: Excite[];
  /** decay time constant (s) of mode k (0-based) when struck/plucked */
  tau: (k: number, mode: Mode) => number;
  /** where a strike/pluck point slider makes sense: [min, max, default, label] */
  position?: [number, number, number, string];
  modes: (stiffness: number) => Mode[];
};

// ---------- Bessel functions (for the membrane) ----------

/** J_m(x) by the integral (1/π)∫₀^π cos(mτ − x sin τ) dτ (Simpson, 96 steps). */
export function besselJ(m: number, x: number): number {
  const N = 96;
  const h = Math.PI / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * h;
    const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    s += w * Math.cos(m * t - x * Math.sin(t));
  }
  return (s * h) / 3 / Math.PI;
}

/** Zeros j_{m,k} of J_m, k = 1, 2, 3. */
export const BESSEL_ZEROS: Record<number, number[]> = {
  0: [2.4048, 5.5201, 8.6537],
  1: [3.8317, 7.0156, 10.1735],
  2: [5.1356, 8.4172, 11.6198],
  3: [6.3802, 9.761],
  4: [7.5883, 11.0647],
  5: [8.7715],
};

// The ten lowest modes of an ideal circular membrane, (m, n).
const DISK: [number, number][] = [
  [0, 1],
  [1, 1],
  [2, 1],
  [0, 2],
  [3, 1],
  [1, 2],
  [4, 1],
  [2, 2],
  [0, 3],
  [5, 1],
];
const j = (m: number, n: number) => BESSEL_ZEROS[m][n - 1];
const diskLabel = (m: number, n: number) => `(${m},${n})`;

// ---------- free bar ----------

const BAR_BL = [4.73004, 7.85320, 10.99561, 14.13717, 17.27876];

/** Free–free bar mode shape at x ∈ [0, 1] (unnormalized). */
export function barShape(k: number, x: number): number {
  const b = BAR_BL[k];
  const s = (Math.cosh(b) - Math.cos(b)) / (Math.sinh(b) - Math.sin(b));
  const bx = b * x;
  return Math.cosh(bx) + Math.cos(bx) - s * (Math.sinh(bx) + Math.sin(bx));
}
const barMax = BAR_BL.map((_, k) => {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, Math.abs(barShape(k, i / 200)));
  return m;
});
/** Normalized so the largest excursion is 1. */
export const barShapeN = (k: number, x: number) => barShape(k, x) / barMax[k];
/** Nodes of the bar's first mode (where a marimba bar is suspended). */
export const BAR_NODES = [0.2242, 0.7758];

// ---------- the resonators ----------

export const RESONATORS: Resonator[] = [
  {
    id: 'string',
    label: 'String',
    family: 'Chordophone',
    blurb: 'Fixed at both ends: whole numbers of half-waves fit, so the modes are harmonics. A stiff wire (piano) bends the series sharp.',
    shape: '1d',
    f1: 110,
    excitations: ['pluck', 'bow'],
    tau: (k) => 2.6 / (1 + 0.28 * k),
    position: [0.04, 0.5, 0.18, 'Pluck point'],
    modes: (B) =>
      Array.from({ length: 10 }, (_, k) => {
        const n = k + 1;
        return { r: (n * Math.sqrt(1 + B * n * n)) / Math.sqrt(1 + B), label: `${n}` };
      }),
  },
  {
    id: 'open',
    label: 'Open pipe',
    family: 'Aerophone',
    blurb: 'Open at both ends, like a flute: the air sways most at the open ends. Every harmonic fits.',
    shape: '1d',
    f1: 262,
    excitations: ['blow'],
    tau: () => 1,
    modes: () => Array.from({ length: 8 }, (_, k) => ({ r: k + 1, label: `${k + 1}` })),
  },
  {
    id: 'closed',
    label: 'Closed pipe',
    family: 'Aerophone',
    blurb: 'Closed at one end, like a clarinet (the reed end acts closed): only odd harmonics fit, and the lowest note is an octave lower than an open pipe the same length.',
    shape: '1d',
    f1: 147,
    excitations: ['blow'],
    tau: () => 1,
    modes: () => Array.from({ length: 8 }, (_, k) => ({ r: 2 * k + 1, label: `${2 * k + 1}` })),
  },
  {
    id: 'membrane',
    label: 'Drumhead',
    family: 'Membranophone',
    blurb: 'An ideal stretched circle. Its modes have nodal lines (diameters) and nodal circles, and their frequencies are not whole-number multiples.',
    shape: 'disk',
    f1: 120,
    excitations: ['strike'],
    tau: (k, md) => (md.m === 0 ? 0.22 : 0.9 / (1 + 0.25 * k)),
    position: [0, 0.9, 0.5, 'Strike point (center → edge)'],
    modes: () => DISK.map(([m, n]) => ({ r: j(m, n) / j(0, 1), label: diskLabel(m, n), m, n })),
  },
  {
    id: 'timpani',
    label: 'Timpani',
    family: 'Membranophone',
    blurb: 'The kettle’s air and the surrounding air load the head, pulling the (m,1) modes into a near-harmonic series. The (0,1) mode dies almost at once.',
    shape: 'disk',
    f1: 175,
    excitations: ['strike'],
    tau: (k, md) => (md.m === 0 ? 0.08 : 1.6 / (1 + 0.3 * k)),
    position: [0, 0.9, 0.7, 'Strike point (center → edge)'],
    modes: () => [
      { r: 0.85, label: '(0,1)', m: 0, n: 1 },
      { r: 1, label: '(1,1)', m: 1, n: 1 },
      { r: 1.5, label: '(2,1)', m: 2, n: 1 },
      { r: 1.98, label: '(3,1)', m: 3, n: 1 },
      { r: 2.44, label: '(4,1)', m: 4, n: 1 },
      { r: 2.94, label: '(5,1)', m: 5, n: 1 },
    ],
  },
  {
    id: 'tabla',
    label: 'Tabla',
    family: 'Membranophone',
    blurb: 'The same drumhead patterns, but the black paste patch (syahi) loads the center and retunes them to about 1 : 2 : 3 : 4 : 5. A drum with a clear pitch.',
    shape: 'disk',
    f1: 280,
    excitations: ['strike'],
    tau: (k, md) => (md.m === 0 && md.n === 1 ? 0.9 : 1.1 / (1 + 0.2 * k)),
    position: [0, 0.9, 0.75, 'Strike point (center → edge)'],
    modes: () =>
      (
        [
          [0, 1, 1],
          [1, 1, 2],
          [2, 1, 3],
          [0, 2, 3],
          [3, 1, 4],
          [1, 2, 4],
          [4, 1, 5],
          [2, 2, 5],
          [0, 3, 5],
        ] as [number, number, number][]
      ).map(([m, n, r]) => ({ r, label: diskLabel(m, n), m, n })),
  },
  {
    id: 'bar',
    label: 'Bar',
    family: 'Idiophone',
    blurb: 'A uniform bar, free at both ends (a glockenspiel bar): stiffness makes the modes climb fast, 1 : 2.76 : 5.40 : 8.93.',
    shape: '1d',
    f1: 523,
    excitations: ['strike'],
    tau: (k) => 2.2 / (1 + 1.2 * k),
    position: [0, 0.5, 0.5, 'Strike point (end → middle)'],
    modes: () => BAR_BL.map((b, k) => ({ r: (b * b) / (BAR_BL[0] * BAR_BL[0]), label: `${k + 1}` })),
  },
  {
    id: 'marimba',
    label: 'Marimba bar',
    family: 'Idiophone',
    blurb: 'The same bar with an arch carved out underneath. The maker tunes mode 2 to two octaves (4×) and mode 3 to about 10×.',
    shape: '1d',
    f1: 262,
    excitations: ['strike'],
    tau: (k) => [1.1, 0.35, 0.12][k] ?? 0.1,
    position: [0, 0.5, 0.5, 'Strike point (end → middle)'],
    modes: () => [
      { r: 1, label: '1' },
      { r: 4, label: '2' },
      { r: 10, label: '3' },
    ],
  },
  {
    id: 'bell',
    label: 'Bell',
    family: 'Idiophone',
    blurb: 'A tuned church bell, seen from above. Its named partials include a minor third (the tierce) that gives bells their plaintive sound.',
    shape: 'bell',
    f1: 131,
    excitations: ['strike'],
    tau: (k) => [7, 4.5, 3.5, 2, 2.6, 1.8, 1.5, 1.3][k] ?? 1.2,
    modes: () => [
      { r: 1, label: 'hum', m: 2, n: 0 },
      { r: 2, label: 'prime', m: 2, n: 1 },
      { r: 2.4, label: 'tierce', m: 3, n: 1 },
      { r: 3, label: 'quint', m: 3, n: 1 },
      { r: 4, label: 'nominal', m: 4, n: 1 },
      { r: 5, label: 'deciem', m: 4, n: 1 },
      { r: 5.33, label: 'undeciem', m: 2, n: 2 },
      { r: 6, label: 'duodeciem', m: 5, n: 1 },
    ],
  },
];

export const resonator = (id: ResonatorId) => RESONATORS.find((r) => r.id === id)!;

// ---------- 1D mode shapes ----------

/** Displacement shape of mode k (0-based) at x ∈ [0, 1] for 1D resonators. */
export function shape1d(id: ResonatorId, k: number, x: number): number {
  switch (id) {
    case 'string':
      return Math.sin((k + 1) * Math.PI * x);
    case 'open': // air displacement: antinodes at both open ends
      return Math.cos((k + 1) * Math.PI * x);
    case 'closed': // closed at x = 0 (node), open at x = 1 (antinode)
      return Math.sin(((2 * k + 1) * Math.PI * x) / 2);
    case 'bar':
    case 'marimba':
      return barShapeN(Math.min(k, BAR_BL.length - 1), x);
    default:
      return 0;
  }
}

// ---------- excitation → amplitudes ----------

/**
 * Amplitude of each mode for a given exciter and position.
 * - pluck: a triangle-shaped release at point p → |sin(nπp)|/n² (stiffness ignored).
 * - bow: Helmholtz motion → a sawtooth, 1/n.
 * - blow: open pipe 1/n with a gentle roll-off; closed pipe odd harmonics, 1/n.
 * - strike: proportional to how much the mode moves at the strike point, times
 *   a soft-mallet roll-off for higher modes.
 */
export function amplitudes(res: Resonator, modes: Mode[], ex: Excite, pos: number): number[] {
  const raw = modes.map((md, k) => {
    if (ex === 'pluck') return Math.abs(Math.sin((k + 1) * Math.PI * pos)) / (k + 1) ** 2;
    if (ex === 'bow') return 1 / (k + 1);
    if (ex === 'blow') return (1 / md.r) * Math.exp(-md.r / 10);
    // strike
    if (res.shape === 'disk') {
      const m = md.m ?? 0;
      const n = md.n ?? 1;
      const shapeAt = Math.abs(besselJ(m, BESSEL_ZEROS[m][n - 1] * pos));
      return shapeAt * Math.exp(-md.r / 4);
    }
    if (res.shape === '1d') return Math.abs(shape1d(res.id, k, pos)) * Math.exp(-md.r / 14);
    // bell: a fixed recipe (strong hum, prime, tierce, nominal)
    return [0.6, 0.7, 0.8, 0.25, 1, 0.45, 0.35, 0.3][k] ?? 0.2;
  });
  const max = Math.max(...raw, 1e-9);
  return raw.map((a) => (a / max < 0.004 ? 0 : a / max));
}

// ---------- harmonic or not? ----------

export type Verdict = {
  /** reference fundamental, as a ratio (mode-1 = 1) */
  ref: number;
  /** per mode: nearest harmonic number of ref and the error in cents */
  fit: { h: number; cents: number }[];
  /** weighted RMS error in cents, over the clearly sounding modes */
  rms: number;
  /** weighted RMS error as a fraction of the spacing between harmonics (0–0.5) */
  frac: number;
  label: 'harmonic' | 'nearly harmonic' | 'inharmonic';
};

/**
 * Do the clearly sounding modes line up as harmonics of one fundamental?
 * Tries the lowest clearly sounding mode, and half of it, as the fundamental.
 * Error is measured as a fraction of the gap between neighboring harmonics,
 * so a low guessed fundamental can't fit everything by making the gaps tiny.
 * `weights` should be amplitude times how long each mode lasts, so modes
 * that die at once barely count; modes under 20% of the strongest are ignored.
 */
export function harmonicity(modes: Mode[], weights: number[]): Verdict {
  const wmax = Math.max(...weights, 1e-9);
  const live = (i: number) => (weights[i] ?? 0) >= 0.2 * wmax;
  const lowest = Math.min(...modes.filter((_, i) => live(i)).map((m) => m.r));
  let best: Verdict | null = null;
  for (const div of [1, 2]) {
    const ref = lowest / div;
    const fit = modes.map((m) => {
      const h = Math.max(1, Math.round(m.r / ref));
      return { h, cents: 1200 * Math.log2(m.r / (h * ref)) };
    });
    let wsum = 0;
    let fsum = 0;
    let csum = 0;
    modes.forEach((m, i) => {
      if (!live(i)) return;
      const w = weights[i];
      wsum += w;
      fsum += w * (m.r / ref - fit[i].h) ** 2;
      csum += w * fit[i].cents ** 2;
    });
    const frac = Math.sqrt(fsum / (wsum || 1)) + (div - 1) * 0.015; // slight preference for the lowest mode itself
    const rms = Math.sqrt(csum / (wsum || 1));
    if (!best || frac < best.frac)
      best = { ref, fit, rms, frac, label: frac < 0.02 && rms < 4 ? 'harmonic' : frac < 0.1 ? 'nearly harmonic' : 'inharmonic' };
  }
  return best!;
}
