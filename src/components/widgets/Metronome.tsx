// Metronome for the rhythm vocabulary: beat, tempo (with tap-tempo),
// meter (beats per bar, accented downbeat), and subdivision (eighths,
// sixteenths, triplets). Uses the same lookahead scheduling as the
// groove engine, so clicks are sample-accurate.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudio } from '../../lib/audio';
import { playClick } from '../../lib/rhythm';
import { PlayButton, Readout, Segmented, Slider, Widget, useAudioOwner } from './ui';

type Sub = 1 | 2 | 3 | 4;
const SUB_LABEL: Record<Sub, string> = { 1: 'Beats only', 2: 'Eighths', 3: 'Triplets', 4: 'Sixteenths' };
const COUNT: Record<Sub, string[]> = { 1: [''], 2: ['', '&'], 3: ['', 'trip', 'let'], 4: ['', 'e', '&', 'a'] };

export default function Metronome(props: {
  bpm?: number;
  beatsPerBar?: number;
  subdivision?: Sub;
  /** Which controls to show. Default: all. */
  controls?: ('tempo' | 'tap' | 'meter' | 'subdivision')[];
}) {
  const controls = props.controls ?? ['tempo', 'tap', 'meter', 'subdivision'];
  const [bpm, setBpm] = useState(props.bpm ?? 100);
  const [beats, setBeats] = useState(props.beatsPerBar ?? 4);
  const [sub, setSub] = useState<Sub>(props.subdivision ?? 1);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<{ beat: number; sub: number } | null>(null);

  const live = useRef({ bpm, beats, sub });
  live.current = { bpm, beats, sub };
  const sched = useRef<{ timer?: number; raf?: number; next: number; i: number; visual: { t: number; beat: number; sub: number }[] }>({
    next: 0,
    i: 0,
    visual: [],
  });

  const stop = useCallback(() => {
    const s = sched.current;
    window.clearInterval(s.timer);
    if (s.raf) cancelAnimationFrame(s.raf);
    s.timer = undefined;
    s.visual = [];
    setPos(null);
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => stop(), [stop]);

  const start = () => {
    const { ctx } = getAudio();
    const s = sched.current;
    s.next = ctx.currentTime + 0.08;
    s.i = 0;
    const tick = () => {
      const now = getAudio().ctx.currentTime;
      if (s.next < now - 0.2) s.next = now + 0.05; // resync after throttling
      while (s.next < now + 0.15) {
        const { bpm, beats, sub } = live.current;
        const perBar = beats * sub;
        const k = s.i % perBar;
        const beat = Math.floor(k / sub);
        const subIdx = k % sub;
        playClick(s.next, subIdx > 0 ? 'sub' : beat === 0 ? 'accent' : 'beat');
        s.visual.push({ t: s.next, beat, sub: subIdx });
        s.next += 60 / bpm / sub;
        s.i = (k + 1) % perBar;
      }
    };
    s.timer = window.setInterval(tick, 25);
    tick();
    const frame = () => {
      const now = getAudio().ctx.currentTime;
      let last: { beat: number; sub: number } | null = null;
      while (s.visual.length && s.visual[0].t <= now) last = s.visual.shift()!;
      if (last) setPos({ beat: last.beat, sub: last.sub });
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
    setPlaying(true);
  };

  // Restart the count from the downbeat when the meter or subdivision changes.
  useEffect(() => {
    sched.current.i = 0;
  }, [beats, sub]);

  // ---- tap tempo ----
  const taps = useRef<number[]>([]);
  const [tapped, setTapped] = useState<number | null>(null);
  const tap = () => {
    const now = performance.now();
    const t = taps.current;
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0; // new tapping session
    t.push(now);
    if (t.length > 8) t.shift();
    if (t.length >= 3) {
      const gaps = t.slice(1).map((x, i) => x - t[i]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      setTapped(Math.round(60000 / mean));
    }
  };

  return (
    <Widget
      kicker="Lab"
      title="Metronome"
      caption={
        <>
          Each circle is a beat, and the first one in the bar (the downbeat) is accented with a higher click. Smaller
          marks are subdivisions, with their spoken count. <strong>Tap</strong> along with any music, at least three
          taps, to measure its tempo.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={() => (playing ? stop() : start())} />
        {controls.includes('tap') && (
          <>
            <button type="button" className="w-play small w-tap" onClick={tap}>
              Tap
            </button>
            {tapped !== null && (
              <span className="w-tap-result">
                You tapped <strong>{tapped} BPM</strong>{' '}
                {controls.includes('tempo') && (
                  <button type="button" className="w-chip" onClick={() => setBpm(Math.min(220, Math.max(40, tapped)))}>
                    use it
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </div>

      <div className="w-metro" aria-hidden>
        {Array.from({ length: beats }, (_, b) => (
          <div key={b} className="w-metro-beat">
            <span className={'w-metro-dot' + (b === 0 ? ' is-down' : '') + (pos?.beat === b && pos.sub === 0 ? ' is-on' : '')}>
              {b + 1}
            </span>
            {sub > 1 && (
              <span className="w-metro-subs">
                {Array.from({ length: sub - 1 }, (_, s) => (
                  <span key={s} className={'w-metro-sub' + (pos?.beat === b && pos.sub === s + 1 ? ' is-on' : '')}>
                    {COUNT[sub][s + 1]}
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="w-controls w-stack">
        {controls.includes('tempo') && (
          <Slider
            label="Tempo"
            min={40}
            max={220}
            step={1}
            value={bpm}
            onChange={setBpm}
            display={`${bpm} BPM · ${(60000 / bpm).toFixed(0)} ms per beat`}
          />
        )}
        {controls.includes('meter') && (
          <Segmented
            label="Beats per bar"
            value={beats}
            options={[2, 3, 4, 6].map((n) => ({ value: n, label: `${n}` }))}
            onChange={setBeats}
          />
        )}
        {controls.includes('subdivision') && (
          <Segmented
            label="Subdivision"
            value={sub}
            options={([1, 2, 3, 4] as Sub[]).map((n) => ({ value: n, label: SUB_LABEL[n] }))}
            onChange={setSub}
          />
        )}
      </div>
      <div className="w-readouts">
        <Readout label="Count it">
          {Array.from({ length: Math.min(beats, 4) }, (_, b) => [String(b + 1), ...COUNT[sub].slice(1)].join(' ')).join('  ')}
          {beats > 4 ? ' …' : ''}
        </Readout>
      </div>
    </Widget>
  );
}
