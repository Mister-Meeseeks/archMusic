// Auditory streaming. Two modes:
//
// - "gallop": van Noorden's ABA_ sequence. Close in pitch and slow, the tones
//   form one stream with a galloping rhythm; far apart and fast, they split
//   into two streams (a fast A A A A and a slow B _ B _), and the gallop
//   disappears. A small map shows where the current setting sits relative to
//   van Noorden's (1975) two boundaries (redrawn approximately).
// - "melodies": two familiar tunes with their notes interleaved (Dowling
//   1973). In the same register they merge into gibberish; pull one away in
//   pitch, or give it a different timbre, and both tunes pop out.

import { useCallback, useEffect, useRef, useState } from 'react';
import { harmonicWave, loop, note, startRun, type Run } from '../../lib/sequence';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'gallop' | 'melodies';

// ---- van Noorden boundaries (approximate redrawing; see the chapter's verify note) ----
// x: tones per second; y: semitones between A and B.
const trt = (rate: number) => 1000 / rate; // ms between tone onsets
export const fissionBoundary = (rate: number) => 1.2 + 0.004 * (trt(rate) - 40);
export const coherenceBoundary = (rate: number) => 2 + 0.07 * (trt(rate) - 40);

function percept(rate: number, semis: number): 'one' | 'either' | 'two' {
  if (semis < fissionBoundary(rate)) return 'one';
  if (semis > coherenceBoundary(rate)) return 'two';
  return 'either';
}

// ---- two public-domain tunes, as [midi, length in eighth notes] ----
// Tune 1: "Twinkle, Twinkle, Little Star" (first two lines, twice). Tune 2: "Frère Jacques".
const T1: [number, number][] = (() => {
  const a: [number, number][] = [
    [60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4],
    [65, 2], [65, 2], [64, 2], [64, 2], [62, 2], [62, 2], [60, 4],
  ];
  return [...a, ...a];
})();
const T2: [number, number][] = [
  [60, 2], [62, 2], [64, 2], [60, 2], [60, 2], [62, 2], [64, 2], [60, 2],
  [64, 2], [65, 2], [67, 4], [64, 2], [65, 2], [67, 4],
  [67, 1], [69, 1], [67, 1], [65, 1], [64, 2], [60, 2], [67, 1], [69, 1], [67, 1], [65, 1], [64, 2], [60, 2],
  [60, 2], [55, 2], [60, 4], [60, 2], [55, 2], [60, 4],
];
const UNITS = 64;

type Ev = { slot: number; tune: 1 | 2; midi: number; len: number };
function onsets(tune: [number, number][], which: 1 | 2): Ev[] {
  let u = 0;
  return tune.map(([midi, len]) => {
    const ev: Ev = { slot: 2 * u + (which === 2 ? 1 : 0), tune: which, midi, len };
    u += len;
    return ev;
  });
}
const EVENTS: Ev[] = [...onsets(T1, 1), ...onsets(T2, 2)].sort((a, b) => a.slot - b.slot);
const BY_SLOT = new Map(EVENTS.map((e) => [e.slot, e]));
const SLOTS = UNITS * 2;

export default function StreamingLab({ initialMode = 'gallop' as Mode }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [rate, setRate] = useState(initialMode === 'gallop' ? 8 : 8);
  const [semis, setSemis] = useState(initialMode === 'gallop' ? 3 : 0);
  const [timbre, setTimbre] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [slot, setSlot] = useState<number | null>(null);
  const params = useRef({ mode, rate, semis, timbre });
  params.current = { mode, rate, semis, timbre };
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const marks = useRef<{ t: number; slot: number }[]>([]);
  const raf = useRef(0);

  const stop = useCallback(() => {
    run.current?.stop(0.06);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    cancelAnimationFrame(raf.current);
    marks.current = [];
    setPlaying(false);
    setSlot(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, stop]);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.08);
    run.current = r;
    const soft = harmonicWave(r.ctx, 3, 2.5);
    const bright = harmonicWave(r.ctx, 14, 0.7);
    cancel.current = loop(r, (t, i) => {
      const p = params.current;
      const step = 1 / p.rate;
      if (p.mode === 'gallop') {
        const s = i % 4; // A B A _
        if (s !== 3) {
          const isB = s === 1;
          const m = 72 + (isB ? p.semis : 0);
          note(r, {
            f: midiToHz(m),
            t,
            dur: step * 0.7,
            gain: isB && p.timbre ? 0.09 : 0.16,
            attack: 0.006,
            release: 0.03,
            wave: isB && p.timbre ? bright : soft,
          });
        }
        marks.current.push({ t, slot: i % 16 });
      } else {
        const sl = i % SLOTS;
        const ev = BY_SLOT.get(sl);
        if (ev) {
          const two = ev.tune === 2;
          note(r, {
            f: midiToHz(ev.midi + (two ? p.semis : 0)),
            t,
            dur: Math.min(ev.len * 2 * step, 0.5) * 0.8,
            gain: two && p.timbre ? 0.08 : 0.15,
            attack: 0.008,
            release: 0.05,
            wave: two && p.timbre ? bright : soft,
          });
        }
        marks.current.push({ t, slot: sl });
      }
      if (marks.current.length > 64) marks.current.splice(0, marks.current.length - 64);
      return step;
    });
    const frame = () => {
      if (!run.current) return;
      const now = r.ctx.currentTime;
      let cur: number | null = null;
      for (const m of marks.current) if (m.t <= now) cur = m.slot;
      setSlot(cur);
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  const pc = percept(rate, semis);

  return (
    <Widget
      kicker="Lab"
      title={mode === 'gallop' ? 'One stream or two?' : 'Two tunes, interleaved'}
      caption={
        mode === 'gallop' ? (
          <>
            A repeating pattern of three tones and a gap: A, B, A, rest. The left plot shows the tones in time (across)
            and pitch (up). The right plot is a map of what listeners in van Noorden's experiments reported, redrawn
            approximately: below the lower line they always heard <strong>one stream</strong> (a gallop); above the
            upper line they couldn't help hearing <strong>two</strong>; in between, either, depending on attention and
            how long they'd been listening. The dot is your current setting.
          </>
        ) : (
          <>
            Two well-known tunes play at once, with their notes alternating: tune 1, tune 2, tune 1, tune 2. The plot
            shows every note (time across, pitch up). <strong>Separation</strong> moves tune 2 up in pitch;{' '}
            <strong>different timbres</strong> gives tune 2 a brighter, buzzier sound in the same register.
          </>
        )
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Lab"
          value={mode}
          options={[
            { value: 'gallop', label: 'Gallop' },
            { value: 'melodies', label: 'Two tunes' },
          ]}
          onChange={(m) => {
            setMode(m);
            setSemis(m === 'gallop' ? 3 : 0);
            setRate(8);
          }}
        />
        <button type="button" className={'w-chip' + (timbre ? ' is-on' : '')} aria-pressed={timbre} onClick={() => setTimbre((v) => !v)}>
          {mode === 'gallop' ? 'Different timbre for B' : 'Different timbres'}
        </button>
        {mode === 'melodies' && (
          <button type="button" className={'w-chip' + (reveal ? ' is-on' : '')} aria-pressed={reveal} onClick={() => setReveal((v) => !v)}>
            Color by tune
          </button>
        )}
      </div>

      {mode === 'gallop' ? <GallopPlots rate={rate} semis={semis} slot={slot} timbre={timbre} /> : <MelodyPlot semis={semis} slot={slot} reveal={reveal} />}

      <div className="w-controls">
        <Slider
          label={mode === 'gallop' ? 'A to B' : 'Separation'}
          min={0}
          max={mode === 'gallop' ? 15 : 24}
          step={1}
          value={semis}
          onChange={setSemis}
          display={`${semis} semitone${semis === 1 ? '' : 's'}`}
        />
        <Slider label="Speed" min={4} max={20} step={1} value={rate} onChange={setRate} display={`${rate} tones/s`} />
        {mode === 'gallop' && (
          <Readout label="Listeners typically hear">
            {timbre ? 'two streams (timbre also splits them)' : pc === 'one' ? 'one stream: a gallop' : pc === 'two' ? 'two streams' : 'either; it can flip'}
          </Readout>
        )}
      </div>
    </Widget>
  );
}

function GallopPlots({ rate, semis, slot, timbre }: { rate: number; semis: number; slot: number | null; timbre: boolean }) {
  const W = 680;
  const H = 170;
  const LW = 400; // left plot width
  const pc = timbre ? 'two' : percept(rate, semis);
  const y = scale(0, 15, H - 30, 20);
  const xs = (i: number) => 20 + i * ((LW - 40) / 15);
  const pts = Array.from({ length: 16 }, (_, i) => i).filter((i) => i % 4 !== 3);
  const pos = (i: number) => ({ x: xs(i), y: i % 4 === 1 ? y(semis) : y(0) });

  // right: the boundary map
  const mx0 = LW + 40;
  const mx1 = W - 12;
  const mx = scale(4, 20, mx0, mx1);
  const my = scale(0, 15, H - 30, 14);
  const curve = (f: (r: number) => number) =>
    Array.from({ length: 33 }, (_, k) => 4 + k * 0.5)
      .map((r, k) => `${k ? 'L' : 'M'}${mx(r)},${my(Math.min(15, f(r)))}`)
      .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Tones in time and pitch, and a map of the streaming boundaries">
      {/* left: the pattern */}
      <line x1={20} x2={LW - 20} y1={H - 22} y2={H - 22} className="w-axis" />
      <text x={20} y={H - 6} className="w-tick">
        time →
      </text>
      <text x={LW - 20} y={H - 6} textAnchor="end" className="w-tick">
        {pc === 'one' ? 'heard as: da-di-da  da-di-da' : pc === 'two' ? 'heard as: two separate rhythms' : 'heard as: either'}
      </text>
      {pc !== 'two' &&
        [0, 4, 8, 12].map((c) => (
          <path
            key={'g' + c}
            d={`M${pos(c).x},${pos(c).y} L${pos(c + 1).x},${pos(c + 1).y} L${pos(c + 2).x},${pos(c + 2).y}`}
            className="stream-link"
            strokeDasharray={pc === 'either' ? '4 4' : undefined}
          />
        ))}
      {pc !== 'one' && (
        <>
          <path
            d={pts
              .filter((i) => i % 4 !== 1)
              .map((i, k) => `${k ? 'L' : 'M'}${pos(i).x},${pos(i).y}`)
              .join(' ')}
            className="stream-link stream-a"
            strokeDasharray={pc === 'either' ? '4 4' : undefined}
          />
          <path
            d={pts
              .filter((i) => i % 4 === 1)
              .map((i, k) => `${k ? 'L' : 'M'}${pos(i).x},${pos(i).y}`)
              .join(' ')}
            className="stream-link stream-b"
            strokeDasharray={pc === 'either' ? '4 4' : undefined}
          />
        </>
      )}
      {pts.map((i) => (
        <circle
          key={i}
          cx={pos(i).x}
          cy={pos(i).y}
          r={slot === i ? 8 : 6}
          className={(i % 4 === 1 ? 'tone-b' : 'tone-a') + (slot === i ? ' is-now' : '')}
        />
      ))}
      {pts.slice(0, 2).map((i) => (
        <text key={'l' + i} x={pos(i).x} y={pos(i).y - 12} textAnchor="middle" className="w-tick">
          {i % 4 === 1 ? 'B' : 'A'}
        </text>
      ))}

      {/* right: the map */}
      <path d={`${curve(coherenceBoundary)} L${mx(20)},${my(15)} L${mx(4)},${my(15)} Z`} className="region-two" />
      <path d={`${curve(fissionBoundary)} L${mx(20)},${my(0)} L${mx(4)},${my(0)} Z`} className="region-one" />
      <path d={curve(coherenceBoundary)} className="boundary" />
      <path d={curve(fissionBoundary)} className="boundary" />
      <line x1={mx0} x2={mx1} y1={H - 30} y2={H - 30} className="w-axis" />
      <line x1={mx0} x2={mx0} y1={14} y2={H - 30} className="w-axis" />
      <text x={mx(5)} y={my(13.2)} className="w-tick">
        two streams
      </text>
      <text x={mx(12)} y={my(0.4) - 4} className="w-tick">
        one stream
      </text>
      <text x={mx(13.5)} y={my(4.6)} className="w-tick">
        either
      </text>
      <text x={(mx0 + mx1) / 2} y={H - 12} textAnchor="middle" className="w-tick">
        speed (tones/s) →
      </text>
      <text x={mx0 - 6} y={my(15) + 8} textAnchor="end" className="w-tick">
        15
      </text>
      <text x={mx0 - 6} y={my(0)} textAnchor="end" className="w-tick">
        0
      </text>
      <circle cx={mx(rate)} cy={my(semis)} r={5} className="map-dot" />
    </svg>
  );
}

function MelodyPlot({ semis, slot, reveal }: { semis: number; slot: number | null; reveal: boolean }) {
  const W = 680;
  const H = 180;
  const lo = 54;
  const hi = 70 + Math.max(semis, 4);
  const x = scale(0, SLOTS, 12, W - 12);
  const y = scale(lo, hi, H - 14, 12);
  const now = slot;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Notes of two interleaved tunes in time and pitch">
      {EVENTS.map((e, k) => {
        const m = e.midi + (e.tune === 2 ? semis : 0);
        const cls = reveal ? (e.tune === 1 ? 'tone-a' : 'tone-b') : 'tone-n';
        return (
          <rect
            key={k}
            x={x(e.slot)}
            y={r2(y(m) - 3)}
            width={r2(Math.max(3, Math.min(e.len * 2, 5) * (x(1) - x(0)) * 0.8))}
            height={6}
            rx={2}
            className={cls + (now === e.slot ? ' is-now' : '')}
          />
        );
      })}
      {now !== null && <line x1={x(now)} x2={x(now)} y1={8} y2={H - 8} className="playhead" />}
    </svg>
  );
}
