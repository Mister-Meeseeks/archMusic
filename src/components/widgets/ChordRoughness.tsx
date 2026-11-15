// Modeled roughness of common chords and voicings, across registers.
// The point: the *same* chord gets rougher as it moves down, and spreading
// the voicing fixes it. That's the acoustics behind "low interval limits"
// and open bass voicings.

import { useCallback, useMemo, useRef, useState } from 'react';
import { type ChordHandle, playChord } from '../../lib/audio';
import { chordRoughness, harmonic } from '../../lib/dissonance';
import { midiName, midiToHz } from '../../lib/tuning';
import { Slider, Widget, useAudioOwner } from './ui';

type Chord = { id: string; label: string; semis: number[]; note?: string };

const DEFAULT_CHORDS: Chord[] = [
  { id: 'power', label: 'Power chord', semis: [0, 7, 12], note: '1 5 8' },
  { id: 'maj', label: 'Major triad, close', semis: [0, 4, 7], note: '1 3 5' },
  { id: 'majopen', label: 'Major triad, open', semis: [0, 7, 16], note: '1 5 10' },
  { id: 'min', label: 'Minor triad', semis: [0, 3, 7], note: '1 ♭3 5' },
  { id: 'sus4', label: 'Sus4', semis: [0, 5, 7], note: '1 4 5' },
  { id: 'dim', label: 'Diminished', semis: [0, 3, 6], note: '1 ♭3 ♭5' },
  { id: 'aug', label: 'Augmented', semis: [0, 4, 8], note: '1 3 ♯5' },
  { id: 'dom7', label: 'Dominant 7th', semis: [0, 4, 7, 10], note: '1 3 5 ♭7' },
  { id: 'maj7', label: 'Major 7th', semis: [0, 4, 7, 11], note: '1 3 5 7' },
  { id: 'cluster', label: 'Cluster', semis: [0, 1, 2], note: '1 ♭2 2' },
];

const SPECTRUM = harmonic(8);

/** Roughness from interactions *between* notes (each note's own internal roughness removed). */
function interaction(semis: number[], root: number): number {
  const freqs = semis.map((s) => midiToHz(root + s));
  const self = freqs.reduce((sum, f) => sum + chordRoughness(SPECTRUM, [f]), 0);
  return chordRoughness(SPECTRUM, freqs) - self;
}

export default function ChordRoughness(props: { chords?: string[]; initialMidi?: number }) {
  const chordKey = props.chords?.join(',');
  const chords = useMemo(
    () => (props.chords ? DEFAULT_CHORDS.filter((c) => props.chords!.includes(c.id)) : DEFAULT_CHORDS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chordKey],
  );
  const [midi, setMidi] = useState(props.initialMidi ?? 60);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const handle = useRef<ChordHandle | null>(null);

  // Fixed scale across all registers, so bars visibly grow as you go down.
  const globalMax = useMemo(() => {
    let m = 0;
    for (let r = 36; r <= 72; r += 3) for (const c of chords) m = Math.max(m, interaction(c.semis, r));
    return m;
  }, [chords]);

  const values = useMemo(() => chords.map((c) => interaction(c.semis, midi)), [chords, midi]);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlayingId(null);
  }, []);
  useAudioOwner(playingId !== null, stop);

  const play = (c: Chord, root = midi) => {
    handle.current?.stop();
    handle.current = playChord(
      SPECTRUM,
      c.semis.map((s) => midiToHz(root + s)),
    );
    setPlayingId(c.id);
  };

  const toggle = (c: Chord) => (playingId === c.id ? stop() : play(c));

  const changeMidi = (m: number) => {
    setMidi(m);
    // Retune the sounding chord in place (cheap) rather than re-triggering it.
    const c = chords.find((x) => x.id === playingId);
    if (c && handle.current) handle.current.setFreqs(c.semis.map((s) => midiToHz(m + s)));
  };

  return (
    <Widget
      kicker="Lab"
      title="Chord roughness across registers"
      caption={
        <>
          Bars show modeled roughness from the <em>interactions between notes</em> (harmonic tones, 8 partials), all on one
          fixed scale. Click a chord to hear it, then drag the register slider while it plays. Four-note chords
          naturally score higher because they have more note pairs. A limitation of the model: very low seconds and
          clusters are only a few Hz apart, <em>below</em> the roughness peak. They come out as slow, muddy beating,
          which a roughness model scores lower than your ear judges it.
        </>
      }
    >
      <Slider
        label="Root"
        min={36}
        max={72}
        step={1}
        value={midi}
        onChange={changeMidi}
        display={`${midiName(midi)} · ${midiToHz(midi).toFixed(0)} Hz`}
      />
      <div className="w-bars">
        {chords.map((c, i) => (
          <button
            type="button"
            key={c.id}
            className={'w-bar-row' + (playingId === c.id ? ' is-playing' : '')}
            onClick={() => toggle(c)}
          >
            <span className="w-bar-label">
              <span className="w-play-icon" aria-hidden>
                {playingId === c.id ? '■' : '▶'}
              </span>
              {c.label} <span className="muted">{c.note}</span>
            </span>
            <span className="w-bar-track">
              <span className="w-bar-fill" style={{ width: `${Math.min(100, (values[i] / globalMax) * 100).toFixed(2)}%` }} />
            </span>
          </button>
        ))}
      </div>
    </Widget>
  );
}
