// Equal-loudness contours from ISO 226:2003 (normal equal-loudness-level
// contours). For a loudness level in phons, returns the sound pressure level
// (dB SPL) a pure tone at each frequency needs in order to sound as loud as
// a 1 kHz tone at that many dB. The standard covers 20 Hz–12.5 kHz and
// 20–90 phon (to 80 phon above 4 kHz); the 0-ish curve is the threshold.
//
// Parameters (f, αf, Lu, Tf) are the standard's Table 1.

export const ISO_F = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
  4000, 5000, 6300, 8000, 10000, 12500,
];
const AF = [
  0.532, 0.506, 0.48, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.33, 0.315, 0.301, 0.288, 0.276, 0.267, 0.259, 0.253,
  0.25, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301,
];
const LU = [
  -31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1, -0.4, 0.0, 0.3, 0.5, 0.0, -2.7,
  -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1,
];
/** Threshold of hearing (dB SPL), the "0 phon" reference of the standard. */
export const ISO_TF = [
  78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3.0, 2.2, 2.4, 3.5, 1.7, -1.3,
  -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3,
];

/** dB SPL at each ISO_F frequency for a loudness level of `phon`. */
export function contour(phon: number): number[] {
  return ISO_F.map((_, i) => {
    const af = AF[i];
    const Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15) + Math.pow(0.4 * Math.pow(10, (ISO_TF[i] + LU[i]) / 10 - 9), af);
    return (10 / af) * Math.log10(Af) - LU[i] + 94;
  });
}

/** dB SPL for `phon` at frequency f, interpolated on a log-frequency axis. */
export function splAt(f: number, phon: number): number {
  const c = contour(phon);
  if (f <= ISO_F[0]) return c[0];
  for (let i = 1; i < ISO_F.length; i++) {
    if (f <= ISO_F[i]) {
      const u = Math.log(f / ISO_F[i - 1]) / Math.log(ISO_F[i] / ISO_F[i - 1]);
      return c[i - 1] + u * (c[i] - c[i - 1]);
    }
  }
  return c[c.length - 1];
}

/** How many dB louder (in SPL) a tone at f must be than a 1 kHz tone to match it, at a given loudness level. */
export function boostVs1k(f: number, phon: number): number {
  return splAt(f, phon) - phon;
}
