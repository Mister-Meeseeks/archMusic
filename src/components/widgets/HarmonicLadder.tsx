// The harmonic series as notes. Harmonics of a low C, each played as a pure
// tone, with the nearest piano key and how far off it is (in cents).

import { useCallback, useEffect, useRef, useState } from 'react';
import { playNotes } from '../../lib/audio';
import { sine } from '../../lib/dissonance';
import { harmonic } from '../../lib/dissonance';
import { INTERVALS, midiName, midiToHz, ratioToCents } from '../../lib/tuning';
import { PlayButton, Widget, useAudioOwner } from './ui';

const N = 16;

function nearestKey(f: number) {
  const m = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(m);
  return { name: midiName(r), cents: Math.round((m - r) * 100) };
}

function stepName(n: number): string {
  // interval between harmonic n-1 and n
  const c = ratioToCents(n / (n - 1));
  const iv = INTERVALS.reduce((b, x) => (Math.abs(x.semis * 100 - c) < Math.abs(b.semis * 100 - c) ? x : b));
  return `${n}:${n - 1} · ${Math.round(c)}¢ (≈ ${iv.name})`;
}

export default function HarmonicLadder({ rootMidi = 36 }: { rootMidi?: number }) {
  const f0 = midiToHz(rootMidi);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const handle = useRef<{ stop: () => void } | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setActive(null);
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => stop(), [stop]);

  const climb = () => {
    if (playing) return stop();
    const freqs = Array.from({ length: N }, (_, k) => f0 * (k + 1));
    const dur = 0.5;
    handle.current = playNotes(sine, freqs, { mode: 'up', noteDur: dur, onEnd: () => (setPlaying(false), setActive(null)) });
    freqs.forEach((_, k) => timers.current.push(window.setTimeout(() => setActive(k + 1), k * dur * 1000)));
    setPlaying(true);
  };

  const one = (n: number) => {
    stop();
    handle.current = playNotes(sine, [f0 * n], { noteDur: 0.9, onEnd: () => (setPlaying(false), setActive(null)) });
    setActive(n);
    setPlaying(true);
  };

  const together = () => {
    stop();
    handle.current = playNotes(harmonic(N, 0.85), [f0], { noteDur: 2, onEnd: () => setPlaying(false) });
    setPlaying(true);
  };

  return (
    <Widget
      kicker="Lab"
      title="The harmonic series as notes"
      caption={
        <>
          The first {N} harmonics of {midiName(rootMidi)} ({f0.toFixed(1)} Hz), each played as a pure tone. “Nearest key”
          is the closest note on a piano and how far the harmonic is from it in cents. Highlighted rows are more than
          15 cents off, too far to match any piano key.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing && active !== null} onClick={climb} label={playing && active !== null ? 'Stop' : 'Climb the series'} />
        <button type="button" className="w-play small" onClick={together}>
          <span className="w-play-icon" aria-hidden>▶</span>All {N} together
        </button>
      </div>
      <div className="w-ladder" role="table" aria-label="Harmonic series">
        <div className="w-ladder-row w-ladder-head" role="row">
          <span>Harmonic</span>
          <span>Frequency</span>
          <span>Nearest key</span>
          <span className="w-ladder-step">Step up from the one below</span>
        </div>
        {Array.from({ length: N }, (_, k) => {
          const n = k + 1;
          const f = f0 * n;
          const key = nearestKey(f);
          const off = Math.abs(key.cents) > 15;
          return (
            <button
              type="button"
              key={n}
              role="row"
              className={'w-ladder-row' + (active === n ? ' is-now' : '') + (off ? ' is-off' : '')}
              onClick={() => one(n)}
            >
              <span>
                <strong>{n}</strong>
                {n === 1 && <span className="muted"> (fundamental)</span>}
              </span>
              <span>{f.toFixed(1)} Hz</span>
              <span>
                {key.name}{' '}
                <span className={off ? 'key-rough' : 'muted'}>
                  {key.cents === 0 ? '±0¢' : `${key.cents > 0 ? '+' : ''}${key.cents}¢`}
                </span>
              </span>
              <span className="w-ladder-step muted">{n > 1 ? stepName(n) : '—'}</span>
            </button>
          );
        })}
      </div>
    </Widget>
  );
}
