// A reference keyboard for the basic vocabulary.
//   mode="interval" (default): click a key to hear it, click a second to hear
//     both and see the interval (semitones, cents, frequency ratio).
//   mode="triad": click a key to build a major or minor triad on it and see
//     how it's stacked from thirds.

import { useCallback, useEffect, useRef, useState } from 'react';
import { playNotes } from '../../lib/audio';
import { harmonic } from '../../lib/dissonance';
import { INTERVALS, midiName, midiToHz, spellTriad } from '../../lib/tuning';
import { Readout, Segmented, Widget, useAudioOwner } from './ui';

const SPECTRUM = harmonic(8, 0.8);
const BLACK = new Set([1, 3, 6, 8, 10]); // pitch classes of black keys
const WW = 30; // white key width (viewBox units)
const WH = 118;
const BW = 18;
const BH = 74;

function intervalName(semis: number): string {
  if (semis === 0) return 'unison (same note)';
  const oct = Math.floor(semis / 12);
  const rem = semis % 12;
  if (rem === 0) return oct === 1 ? 'octave' : `${oct} octaves`;
  const base = INTERVALS[rem].name;
  if (oct === 0) return base;
  const compound: Record<number, string> = { 1: '9th', 2: '9th', 3: '10th', 4: '10th', 5: '11th', 6: 'augmented 11th', 7: '12th', 8: '13th', 9: '13th', 10: '14th', 11: '14th' };
  const quality = rem === 6 ? '' : rem === 5 || rem === 7 ? 'perfect ' : [1, 3, 8, 10].includes(rem) ? 'minor ' : 'major ';
  return oct === 1 ? `${base} + an octave (a ${quality}${compound[rem]})` : `${base} + ${oct} octaves`;
}


export default function KeyboardRef({
  low = 48,
  high = 84,
  mode = 'interval',
}: {
  low?: number;
  high?: number;
  mode?: 'interval' | 'triad';
}) {
  const [a, setA] = useState<number | null>(60);
  const [b, setB] = useState<number | null>(mode === 'interval' ? 67 : null);
  const [quality, setQuality] = useState<'major' | 'minor'>('major');
  const [playing, setPlaying] = useState(false);
  const handle = useRef<{ stop: () => void } | null>(null);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => handle.current?.stop(), []);

  const sound = (notes: number[], how: 'together' | 'up' = 'together') => {
    handle.current?.stop();
    handle.current = playNotes(SPECTRUM, notes.map(midiToHz), {
      mode: how,
      noteDur: how === 'up' ? 0.6 : 1.3,
      onEnd: () => setPlaying(false),
    });
    setPlaying(true);
  };

  const triad = (root: number, q = quality) => [root, root + (q === 'major' ? 4 : 3), root + 7];

  const press = (m: number) => {
    if (mode === 'triad') {
      const root = Math.min(m, high - 7);
      setA(root);
      sound(triad(root));
      return;
    }
    if (a === null || b !== null) {
      setA(m);
      setB(null);
      sound([m]);
    } else {
      setB(m);
      sound([a, m]);
    }
  };

  const chord = mode === 'triad' && a !== null ? triad(a) : [];
  const selClass = (m: number) =>
    mode === 'triad' ? (m === a ? 'sel-a' : chord.includes(m) ? 'sel-b' : '') : m === a ? 'sel-a' : m === b ? 'sel-b' : '';

  // Layout: white keys in a row, black keys on top.
  const keys = [];
  let wx = 0;
  const whitePos = new Map<number, number>();
  for (let m = low; m <= high; m++) {
    if (!BLACK.has(m % 12)) {
      whitePos.set(m, wx);
      wx += WW;
    }
  }
  const width = wx;
  for (let m = low; m <= high; m++) {
    if (BLACK.has(m % 12)) continue;
    const x = whitePos.get(m)!;
    const sel = selClass(m);
    keys.push(
      <g key={m} onClick={() => press(m)}>
        <rect x={x} y={0} width={WW} height={WH} rx={3} className={'white ' + sel} />
        {(m % 12 === 0 || m === 69) && (
          <text x={x + WW / 2} y={WH - 8} textAnchor="middle" className={'key-label' + (sel ? ' on-sel' : '')}>
            {midiName(m)}
          </text>
        )}
      </g>,
    );
  }
  for (let m = low; m <= high; m++) {
    if (!BLACK.has(m % 12)) continue;
    const x = whitePos.get(m - 1)! + WW - BW / 2;
    keys.push(<rect key={m} x={x} y={0} width={BW} height={BH} rx={2} className={'black ' + selClass(m)} onClick={() => press(m)} />);
  }

  const describe = (m: number) =>
    `${midiName(m)}${m === 60 ? ' (middle C)' : ''}${m === 69 ? ' (tuning A)' : ''} · ${midiToHz(m).toFixed(1)} Hz`;

  // ---------- triad mode ----------
  if (mode === 'triad') {
    return (
      <Widget
        kicker="Lab"
        title="Building a chord"
        caption={
          <>
            Click any key to build a triad on it: that key is the <span className="key-a">root</span>, and the{' '}
            <span className="key-b">third and fifth</span> are stacked above it. Switch between major and minor and
            notice that only the middle note moves, by one semitone.
          </>
        }
      >
        <div className="w-controls">
          <Segmented
            label="Quality"
            value={quality}
            options={[
              { value: 'major', label: 'Major' },
              { value: 'minor', label: 'Minor' },
            ]}
            onChange={(q) => {
              setQuality(q);
              if (a !== null) sound(triad(a, q));
            }}
          />
          {a !== null && (
            <>
              <button type="button" className="w-play small" onClick={() => sound(chord)}>
                <span className="w-play-icon" aria-hidden>▶</span>Together
              </button>
              <button type="button" className="w-play small" onClick={() => sound(chord, 'up')}>
                <span className="w-play-icon" aria-hidden>▶</span>One at a time
              </button>
            </>
          )}
        </div>
        <svg viewBox={`0 0 ${width} ${WH}`} className="w-keys" role="img" aria-label="Piano keyboard">
          {keys}
        </svg>
        {a !== null && (
          <div className="w-readouts">
            <Readout label="Chord">
              <strong>
                {spellTriad(a, quality)[0]} {quality}
              </strong>{' '}
              <span className="muted">({spellTriad(a, quality).join('–')})</span>
            </Readout>
            <Readout label="Root → third">
              {quality === 'major' ? 'major 3rd · 4 semitones' : 'minor 3rd · 3 semitones'}
            </Readout>
            <Readout label="Third → fifth">
              {quality === 'major' ? 'minor 3rd · 3 semitones' : 'major 3rd · 4 semitones'}
            </Readout>
            <Readout label="Root → fifth">perfect 5th · 7 semitones</Readout>
          </div>
        )}
      </Widget>
    );
  }

  // ---------- interval mode ----------
  const lo = a !== null && b !== null ? Math.min(a, b) : null;
  const hi = a !== null && b !== null ? Math.max(a, b) : null;
  const semis = lo !== null && hi !== null ? hi - lo : null;

  return (
    <Widget
      kicker="Reference"
      title="The keyboard as a map"
      caption={
        <>
          Click a key to hear it, then click a second key to hear both together and see the interval between them.
          The labeled keys are the Cs (each starts a new octave number) and A4, the 440 Hz note orchestras tune to.
          Colored keys: <span className="key-a">first note</span>, <span className="key-b">second note</span>.
        </>
      }
    >
      <svg viewBox={`0 0 ${width} ${WH}`} className="w-keys" role="img" aria-label="Piano keyboard">
        {keys}
      </svg>
      <div className="w-readouts">
        {a !== null && (
          <Readout label="First note">
            <span className="key-a">{describe(a)}</span>
          </Readout>
        )}
        {b !== null && (
          <Readout label="Second note">
            <span className="key-b">{describe(b)}</span>
          </Readout>
        )}
      </div>
      {semis !== null && lo !== null && hi !== null && (
        <div className="w-readouts">
          <Readout label="Interval">
            <strong>{intervalName(semis)}</strong>
          </Readout>
          <Readout label="Size">
            {semis} semitone{semis === 1 ? '' : 's'} · {semis * 100} cents
          </Readout>
          <Readout label="Frequency ratio">
            {(midiToHz(hi) / midiToHz(lo)).toFixed(3)} : 1
            {semis <= 12 && <span className="muted"> (pure version {INTERVALS[semis].just.join(':')})</span>}
          </Readout>
        </div>
      )}
      {a !== null && b !== null && (
        <div className="w-controls">
          <button type="button" className="w-play small" onClick={() => sound([a, b])}>
            <span className="w-play-icon" aria-hidden>▶</span>Together
          </button>
          <button type="button" className="w-play small" onClick={() => sound([a, b], 'up')}>
            <span className="w-play-icon" aria-hidden>▶</span>One after the other
          </button>
        </div>
      )}
    </Widget>
  );
}
