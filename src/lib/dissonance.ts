// Sensory dissonance (roughness) model and spectrum generators.
//
// Model: Sethares' parameterization of the Plomp & Levelt (1965) curve.
// For each pair of sine partials, roughness rises quickly as they separate,
// peaks at roughly a quarter of a critical bandwidth, then decays. The
// critical band widens with frequency, which is why `s` depends on the
// lower frequency. Total roughness = sum over all pairs.
//
// Refs: Plomp & Levelt, JASA 38 (1965); Sethares, "Tuning, Timbre,
// Spectrum, Scale" (2nd ed., 2005), ch. 3 and appendix E.

export type Partial = { f: number; a: number }; // f: Hz or multiplier; a: amplitude

const DSTAR = 0.24;
const S1 = 0.0207;
const S2 = 18.96;
const B1 = 3.51;
const B2 = 5.75;

/** Roughness contributed by two sine partials (absolute Hz). */
export function pairRoughness(f1: number, a1: number, f2: number, a2: number): number {
  const lo = Math.min(f1, f2);
  const diff = Math.abs(f2 - f1);
  const s = DSTAR / (S1 * lo + S2);
  return Math.min(a1, a2) * (Math.exp(-B1 * s * diff) - Math.exp(-B2 * s * diff));
}

/** Total roughness of a set of partials (absolute Hz). */
export function roughness(partials: Partial[]): number {
  let d = 0;
  for (let i = 0; i < partials.length; i++)
    for (let j = i + 1; j < partials.length; j++)
      d += pairRoughness(partials[i].f, partials[i].a, partials[j].f, partials[j].a);
  return d;
}

/** Place a relative spectrum at fundamental f0 (Hz). */
export function atPitch(spectrum: Partial[], f0: number): Partial[] {
  return spectrum.map((p) => ({ f: p.f * f0, a: p.a }));
}

/** Roughness of several tones sounding together. */
export function chordRoughness(spectrum: Partial[], freqs: number[]): number {
  return roughness(freqs.flatMap((f) => atPitch(spectrum, f)));
}

/**
 * Roughness *between* two tones only (excludes each tone's internal
 * roughness, which is constant as the interval changes).
 */
export function intervalRoughness(spectrum: Partial[], f0: number, ratio: number): number {
  const a = atPitch(spectrum, f0);
  const b = atPitch(spectrum, f0 * ratio);
  let d = 0;
  for (const p of a) for (const q of b) d += pairRoughness(p.f, p.a, q.f, q.a);
  return d;
}

// ---------- spectra ----------

export const sine: Partial[] = [{ f: 1, a: 1 }];

/** Harmonic tone: partials at 1, 2, 3... with geometric amplitude rolloff. */
export function harmonic(n: number, rolloff = 0.88): Partial[] {
  return Array.from({ length: n }, (_, k) => ({ f: k + 1, a: rolloff ** k }));
}

/**
 * "Stretched" tone (Sethares): partial k sits at stretch^(log2 k), so the
 * 2nd partial lands at `stretch` instead of 2. stretch = 2 gives a normal
 * harmonic tone; 2.1 is mildly bell/piano-like; stretch < 2 compresses.
 */
export function stretched(n: number, stretch: number, rolloff = 0.88): Partial[] {
  return Array.from({ length: n }, (_, k) => ({
    f: stretch ** Math.log2(k + 1),
    a: rolloff ** k,
  }));
}

/** Sample the interval-roughness curve over a cents range. */
export function dissonanceCurve(
  spectrum: Partial[],
  f0: number,
  maxCents = 1250,
  steps = 500,
): { cents: number; d: number }[] {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const cents = (i / steps) * maxCents;
    out.push({ cents, d: intervalRoughness(spectrum, f0, 2 ** (cents / 1200)) });
  }
  return out;
}

// ---------- critical band ----------

/** Equivalent rectangular bandwidth (Glasberg & Moore 1990), Hz. */
export function erb(f: number): number {
  return 24.7 * (4.37 * (f / 1000) + 1);
}
