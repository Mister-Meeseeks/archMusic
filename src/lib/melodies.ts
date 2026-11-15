// A tiny corpus of public-domain tunes, melodic transformations, and the
// interval statistics the melody chapter talks about. Framework-free, so it
// can be tested in node.
//
// Notes are [midi, length]; length is in eighth notes; midi 0 = rest.
// Every tune is written in C (major) or C minor so they're easy to compare.

export type Note = [number, number];
export type Tune = { id: string; name: string; notes: Note[]; bpm?: number };

const rep = (a: Note[], n = 2): Note[] => Array.from({ length: n }, () => a).flat();

export const TUNES: Tune[] = [
  {
    id: 'ode',
    name: 'Ode to Joy',
    notes: [
      ...[64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((m): Note => [m, 2]),
      [64, 3], [62, 1], [62, 4],
      ...[64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((m): Note => [m, 2]),
      [62, 3], [60, 1], [60, 4],
    ],
  },
  {
    id: 'twinkle',
    name: 'Twinkle, Twinkle',
    notes: [
      [60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4],
      [65, 2], [65, 2], [64, 2], [64, 2], [62, 2], [62, 2], [60, 4],
    ],
  },
  {
    id: 'frere',
    name: 'Frère Jacques',
    notes: [
      ...rep([[60, 2], [62, 2], [64, 2], [60, 2]]),
      ...rep([[64, 2], [65, 2], [67, 4]]),
      ...rep([[67, 1], [69, 1], [67, 1], [65, 1], [64, 2], [60, 2]]),
      ...rep([[60, 2], [55, 2], [60, 4]]),
    ],
  },
  {
    id: 'mary',
    name: 'Mary Had a Little Lamb',
    notes: [
      [64, 2], [62, 2], [60, 2], [62, 2], [64, 2], [64, 2], [64, 4],
      [62, 2], [62, 2], [62, 4], [64, 2], [67, 2], [67, 4],
      [64, 2], [62, 2], [60, 2], [62, 2], [64, 2], [64, 2], [64, 2], [64, 2],
      [62, 2], [62, 2], [64, 2], [62, 2], [60, 8],
    ],
  },
  {
    id: 'yankee',
    name: 'Yankee Doodle',
    notes: [
      [60, 2], [60, 2], [62, 2], [64, 2], [60, 2], [64, 2], [62, 4],
      [60, 2], [60, 2], [62, 2], [64, 2], [60, 4], [59, 4],
      [60, 2], [60, 2], [62, 2], [64, 2], [65, 2], [64, 2], [62, 2], [60, 2],
      [59, 2], [55, 2], [57, 2], [59, 2], [60, 4], [60, 4],
    ],
  },
  {
    id: 'birthday',
    name: 'Happy Birthday',
    bpm: 100,
    notes: [
      [55, 1.5], [55, 0.5], [57, 2], [55, 2], [60, 2], [59, 4],
      [55, 1.5], [55, 0.5], [57, 2], [55, 2], [62, 2], [60, 4],
      [55, 1.5], [55, 0.5], [67, 2], [64, 2], [60, 2], [59, 2], [57, 4],
      [65, 1.5], [65, 0.5], [64, 2], [60, 2], [62, 2], [60, 4],
    ],
  },
  {
    id: 'row',
    name: 'Row, Row, Row Your Boat',
    notes: [
      [60, 3], [60, 3], [60, 2], [62, 1], [64, 3],
      [64, 2], [62, 1], [64, 2], [65, 1], [67, 6],
      [72, 1], [72, 1], [72, 1], [67, 1], [67, 1], [67, 1], [64, 1], [64, 1], [64, 1], [60, 1], [60, 1], [60, 1],
      [67, 2], [65, 1], [64, 2], [62, 1], [60, 6],
    ],
  },
  {
    id: 'jingle',
    name: 'Jingle Bells',
    bpm: 132,
    notes: [
      [64, 2], [64, 2], [64, 4], [64, 2], [64, 2], [64, 4],
      [64, 2], [67, 2], [60, 3], [62, 1], [64, 8],
      [65, 2], [65, 2], [65, 3], [65, 1], [65, 2], [64, 2], [64, 2], [64, 1], [64, 1],
      [64, 2], [62, 2], [62, 2], [64, 2], [62, 4], [67, 4],
      [64, 2], [64, 2], [64, 4], [64, 2], [64, 2], [64, 4],
      [64, 2], [67, 2], [60, 3], [62, 1], [64, 8],
      [65, 2], [65, 2], [65, 3], [65, 1], [65, 2], [64, 2], [64, 2], [64, 1], [64, 1],
      [67, 2], [67, 2], [65, 2], [62, 2], [60, 8],
    ],
  },
  {
    id: 'beethoven5',
    name: 'Beethoven 5 (opening)',
    bpm: 108,
    notes: [
      [0, 1], [67, 1], [67, 1], [67, 1], [63, 8],
      [0, 1], [65, 1], [65, 1], [65, 1], [62, 10],
    ],
  },
];

export const tuneById = (id: string) => TUNES.find((t) => t.id === id) ?? TUNES[0];

// ---------- transformations ----------

export type Transform = 'original' | 'transpose' | 'inversion' | 'retrograde' | 'contour' | 'octaves' | 'shuffle' | 'flat';

export const TRANSFORMS: { id: Transform; label: string; blurb: string }[] = [
  { id: 'original', label: 'Original', blurb: 'The tune as written.' },
  { id: 'transpose', label: 'Transposed', blurb: 'Every note moved up 5 semitones. Every interval is unchanged.' },
  { id: 'contour', label: 'Same contour', blurb: 'Same ups and downs and rhythm, but every interval resized.' },
  { id: 'octaves', label: 'Octave-scrambled', blurb: 'Same note names, each one moved to a random octave.' },
  { id: 'inversion', label: 'Inverted', blurb: 'Every interval flipped: up becomes down by the same amount.' },
  { id: 'retrograde', label: 'Backwards', blurb: 'The notes and rhythm in reverse order (retrograde).' },
  { id: 'shuffle', label: 'Shuffled', blurb: 'Same notes and rhythm, pitches in a random order.' },
  { id: 'flat', label: 'Rhythm removed', blurb: 'Same pitches, every note the same length.' },
];

/** Deterministic pseudo-random numbers so a transform is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pitched = (n: Note[]) => n.filter(([m]) => m > 0);

export function transform(notes: Note[], t: Transform, seed = 7): Note[] {
  const r = rng(seed);
  const first = pitched(notes)[0]?.[0] ?? 60;
  switch (t) {
    case 'original':
      return notes;
    case 'transpose':
      return notes.map(([m, d]) => [m ? m + 5 : 0, d]);
    case 'inversion':
      return notes.map(([m, d]) => [m ? 2 * first - m : 0, d]);
    case 'retrograde':
      return [...notes].reverse();
    case 'octaves':
      return notes.map(([m, d]) => [m ? m + 12 * (Math.floor(r() * 3) - 1) : 0, d]);
    case 'flat':
      return pitched(notes).map(([m]) => [m, 2]);
    case 'shuffle': {
      const ps = pitched(notes).map(([m]) => m);
      for (let i = ps.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [ps[i], ps[j]] = [ps[j], ps[i]];
      }
      let k = 0;
      return notes.map(([m, d]) => [m ? ps[k++] : 0, d]);
    }
    case 'contour': {
      // keep the direction of every move (up / down / same), change its size
      let prevIn = first;
      let prevOut = first;
      return notes.map(([m, d]) => {
        if (!m) return [0, d];
        const iv = m - prevIn;
        prevIn = m;
        let size = iv === 0 ? 0 : Math.abs(iv);
        if (size) {
          const options = [1, 2, 3, 4, 5, 7].filter((s) => s !== size);
          size = options[Math.floor(r() * options.length)];
        }
        prevOut = prevOut + Math.sign(iv) * size;
        return [prevOut, d];
      });
    }
  }
}

/** Contour as Parsons code: * for the first note, then U (up), D (down), R (repeat). */
export function parsons(notes: Note[]): string {
  const ps = pitched(notes).map(([m]) => m);
  return ps.map((m, i) => (i === 0 ? '*' : m > ps[i - 1] ? 'U' : m < ps[i - 1] ? 'D' : 'R')).join('');
}

// ---------- interval statistics ----------

export type Follow = { same: number; reverse: number; repeat: number };

export type IntervalStats = {
  counts: number[]; // index = interval size in semitones (0..12), last bucket = 12 or more
  total: number;
  repeats: number; // 0
  steps: number; // 1–2 semitones
  leaps: number; // 3+
  /** What the next move does after a step (1–2 semitones) and after a leap (5+ semitones). */
  after: { step: Follow; leap: Follow };
};

export function intervalStats(tunes: Tune[]): IntervalStats {
  const counts = Array(13).fill(0);
  const after = { step: { same: 0, reverse: 0, repeat: 0 }, leap: { same: 0, reverse: 0, repeat: 0 } };
  for (const t of tunes) {
    const ps = pitched(t.notes).map(([m]) => m);
    for (let i = 1; i < ps.length; i++) {
      const iv = ps[i] - ps[i - 1];
      const size = Math.abs(iv);
      counts[Math.min(12, size)]++;
      if (i + 1 >= ps.length) continue;
      const kind = size >= 1 && size <= 2 ? 'step' : size >= 5 ? 'leap' : null;
      if (!kind) continue;
      const next = ps[i + 1] - ps[i];
      const f = after[kind];
      if (next === 0) f.repeat++;
      else if (Math.sign(next) === Math.sign(iv)) f.same++;
      else f.reverse++;
    }
  }
  const total = counts.reduce((s, c) => s + c, 0);
  return {
    counts,
    total,
    repeats: counts[0],
    steps: counts[1] + counts[2],
    leaps: total - counts[0] - counts[1] - counts[2],
    after,
  };
}
