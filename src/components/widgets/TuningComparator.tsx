// The same interval in three tuning systems. The key number is the beat
// rate between the near-coinciding partials: zero in just intonation, slow
// in equal temperament, fast in Pythagorean (for thirds).

import { useCallback, useRef, useState } from 'react';
import { type ChordHandle, playChord } from '../../lib/audio';
import { harmonic } from '../../lib/dissonance';
import { TUNINGS, type TuningSystem, midiName, midiToHz, ratioToCents } from '../../lib/tuning';
import { Segmented, Widget, useAudioOwner } from './ui';

type Shape = 'M3' | 'm3' | 'P5' | 'triad';

// Just ratio of each interval: upper/lower = p/q -> lower's p-th harmonic
// sits near upper's q-th harmonic, and they beat at |p*f1 - q*f2|.
const JUST: Record<string, [number, number]> = { M3: [5, 4], m3: [6, 5], P5: [3, 2] };

const SPECTRUM = harmonic(10, 0.9);

function notesFor(shape: Shape, sys: TuningSystem, root: number): number[] {
  const r = TUNINGS[sys].ratios;
  if (shape === 'triad') return [root, root * r.M3, root * r.P5];
  return [root, root * r[shape]];
}

type Beat = { label: string; rate: number; cents: number; dev: number };

function beatsFor(shape: Shape, sys: TuningSystem, root: number): Beat[] {
  const r = TUNINGS[sys].ratios;
  const pairs: [string, number, number, [number, number]][] =
    shape === 'triad'
      ? [
          ['3rd (root→3)', root, root * r.M3, JUST.M3],
          ['5th (root→5)', root, root * r.P5, JUST.P5],
          ['m3 (3→5)', root * r.M3, root * r.P5, JUST.m3],
        ]
      : [[shape, root, root * r[shape], JUST[shape]]];
  return pairs.map(([label, f1, f2, [p, q]]) => ({
    label,
    rate: Math.abs(p * f1 - q * f2),
    cents: ratioToCents(f2 / f1),
    dev: ratioToCents(f2 / f1) - ratioToCents(p / q),
  }));
}

function Pulse({ rate }: { rate: number }) {
  // A dot that pulses at the beat rate (capped so it stays visible).
  if (rate < 0.05) return <span className="w-pulse is-still" title="no beating" />;
  const shown = Math.min(rate, 12);
  return <span className="w-pulse" style={{ animationDuration: `${1 / shown}s` }} title={`${rate.toFixed(1)} beats/s`} />;
}

export default function TuningComparator(props: { initialShape?: Shape; rootMidi?: number }) {
  const [shape, setShape] = useState<Shape>(props.initialShape ?? 'M3');
  const [playing, setPlaying] = useState<TuningSystem | null>(null);
  const handle = useRef<ChordHandle | null>(null);
  const rootMidi = props.rootMidi ?? 60;
  const root = midiToHz(rootMidi);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(null);
  }, []);
  useAudioOwner(playing !== null, stop);

  const play = (sys: TuningSystem, s: Shape = shape) => {
    handle.current?.stop();
    handle.current = playChord(SPECTRUM, notesFor(s, sys, root));
    setPlaying(sys);
  };

  const changeShape = (s: Shape) => {
    setShape(s);
    if (playing) play(playing, s);
  };

  return (
    <Widget
      kicker="Lab"
      title="One interval, three tunings"
      caption={
        <>
          Root {midiName(rootMidi)} ({root.toFixed(1)} Hz). “Beats/s” is the rate at which the nearly coinciding partials
          pulse against each other (the dot pulses at that rate, capped at 12/s so you can see it). Listen for the
          shimmer or wobble in the Pythagorean third, compared with the stillness of the just third.
        </>
      }
    >
      <div className="w-controls">
        <Segmented
          label="Interval"
          value={shape}
          options={[
            { value: 'M3', label: 'Major 3rd' },
            { value: 'm3', label: 'Minor 3rd' },
            { value: 'P5', label: 'Perfect 5th' },
            { value: 'triad', label: 'Major triad' },
          ]}
          onChange={changeShape}
        />
      </div>
      <div className="w-table">
        {(Object.keys(TUNINGS) as TuningSystem[]).map((sys) => {
          const beats = beatsFor(shape, sys, root);
          return (
            <div key={sys} className={'w-trow' + (playing === sys ? ' is-playing' : '')}>
              <button type="button" className="w-play small" onClick={() => (playing === sys ? stop() : play(sys))}>
                <span className="w-play-icon" aria-hidden>
                  {playing === sys ? '■' : '▶'}
                </span>
                {TUNINGS[sys].label}
              </button>
              <span className="w-tblurb muted">{TUNINGS[sys].blurb}</span>
              <span className="w-tbeats">
                {beats.map((b) => (
                  <span key={b.label} className="w-tbeat">
                    {shape === 'triad' && <span className="muted">{b.label}: </span>}
                    {b.cents.toFixed(1)}¢{' '}
                    <span className="muted">
                      ({b.dev >= 0 ? '+' : ''}
                      {b.dev.toFixed(1)} vs just)
                    </span>{' '}
                    <Pulse rate={b.rate} /> <strong>{b.rate.toFixed(1)}</strong> beats/s
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}
