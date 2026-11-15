// The master plan. Chapters listed here show up on the contents page even
// before they're written. Link content to the outline with the `volume` and
// `chapter` frontmatter fields.
//
// Source: the six-volume outline from the initial planning conversation, plus
// an Overture (vol 0) and the Musical Atlas (vol 7). Expect this to evolve.

export type OutlineVolume = { n: number; title: string; blurb: string; chapters: string[] };

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

export const OUTLINE: OutlineVolume[] = [
  {
    n: 0,
    title: 'Overture',
    blurb: 'One song taken apart along every dimension: a preview of what the course teaches you to hear.',
    chapters: [
      'What is a piece of music doing that I don’t yet know how to hear?',
      'The toolkit: notes, intervals, chords, beats, and bars',
    ],
  },
  {
    n: 1,
    title: 'Sound and Perception',
    blurb: 'The physics of sound, the biology of hearing, and how vibrations become auditory objects.',
    chapters: [
      'Vibrations, waves, frequency, amplitude, and phase',
      'Harmonics, spectra, resonance, and the harmonic series',
      'From ear to percept: pitch, loudness, and timbre',
      'Auditory scene analysis: hearing instruments, not a mass of frequencies',
      'What makes a chord dissonant? Beating, roughness, and consonance',
      'Attention, memory, expectation, and emotional response',
    ],
  },
  {
    n: 2,
    title: 'Time and Rhythm',
    blurb: 'Pulse, meter, subdivision, syncopation, groove, polyrhythm, and rhythmic expectation.',
    chapters: [
      'Musical time: tempo, pulse, events, and meter',
      'Why we hear beats nobody plays',
      'Subdivision, syncopation, accent, and grouping',
      'Polyrhythm, cross-rhythm, polymeter, and phase',
      'Swing, microtiming, and groove',
      'Rhythmic traditions: funk, jazz, Afro-Cuban, West African, tala, techno',
      'Rhythm and the body: entrainment, dance, synchrony',
    ],
  },
  {
    n: 3,
    title: 'Pitch and Musical Grammar',
    blurb: 'Intervals, tuning, scales, melody, harmony, counterpoint, and other pitch grammars.',
    chapters: [
      'Pitch, intervals, ratios, and tuning',
      'Why scales exist: 12-TET and its alternatives',
      'Melody: contour, motif, phrasing, ornament',
      'Tonal centers, modes, and pitch hierarchies',
      'Vertical harmony: chords, voice leading, tension',
      'Functional harmony and the Western tonal tradition',
      'Jazz, modal, chromatic, and extended harmony',
      'Counterpoint: independent melodies together',
      'Post-tonal harmony: atonality and serialism',
      'Other pitch grammars: raga, maqam, gamelan',
    ],
  },
  {
    n: 4,
    title: 'Timbre and Sound Design',
    blurb: 'Instruments as physical systems, the voice, synthesis, recording, and mixing as composition.',
    chapters: [
      'Acoustic instruments as physical systems',
      'The human voice: formants, breath, expression',
      'Envelopes and spectral evolution',
      'Orchestration: how sources combine',
      'Synthesis: additive, subtractive, FM, granular, wavetable, physical modeling',
      'Sampling, looping, distortion, filtering, stretching',
      'Recording, microphones, reverb, and space',
      'Mixing and mastering as composition',
      'Timbre-driven composition: from spectralism to modern pop',
    ],
  },
  {
    n: 5,
    title: 'Composition and Musical Architecture',
    blurb: 'Phrases, repetition, development, tension, form, process, texture, and meaning.',
    chapters: [
      'The phrase and recognizable units',
      'Repetition, variation, transformation, development',
      'Novelty, predictability, and attention',
      'Tension, release, contrast, climax',
      'Form: verse-chorus, blues, sonata, rondo, through-composed',
      'Cyclic and process forms: ostinato, minimalism, loops',
      'Layering, texture, and attention management',
      'Composition, improvisation, and open forms',
      'Narrative, lyrics, emotion, and meaning',
    ],
  },
  {
    n: 6,
    title: 'Music as a Human System',
    blurb: 'Communication, performance, transmission, culture, technology, genre, and economics.',
    chapters: [
      'Music as communication, ritual, entertainment, identity',
      'Performance, improvisation, and coordination',
      'Oral tradition, notation, recording',
      'Musical cultures as systems of learned expectations',
      'Histories and relationships of major traditions',
      'How instruments and technology shape composition',
      'Genres as evolving ecosystems',
      'The economics of music',
      'Borrowing, hybridization, diffusion',
    ],
  },
  {
    n: 7,
    title: 'The Musical Atlas',
    blurb: 'Case studies that trace one piece through every layer: acoustics to culture.',
    chapters: ['I Feel Love (1977)'],
  },
];

/** Chapter id prefix used by concepts.yaml, e.g. chapterKey(1, 5) = 'v1-05'. */
export function chapterKey(volume: number, chapter: number): string {
  return `v${volume}-${String(chapter).padStart(2, '0')}`;
}

/** Human label for a chapter key, e.g. 'v1-05' -> '1.5', 'v0-02' -> 'Overture 2'. */
export function chapterLabel(key: string): string {
  const [, v, c] = key.match(/^v(\d)-(\d+)$/) ?? [];
  if (!v) return key;
  const n = Number(c);
  if (v === '0') return `Overture ch. ${n}`;
  if (v === '7') return `Atlas ${n}`;
  return `${v}.${n}`;
}

export function volumeLabel(n: number): string {
  if (n === 0) return 'Overture';
  if (n === 7) return 'Atlas';
  return `Volume ${ROMAN[n]}`;
}
