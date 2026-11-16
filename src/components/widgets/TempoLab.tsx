// Tempo lab (chapter 2.1). Three modes:
// - "tempo": one tune at any tempo. The plot is a fixed 12-second window, so a
//   faster tempo packs more notes into the same stretch of time. Readouts give
//   the beat length, the shortest gap between notes, and the traditional
//   tempo marking for that speed.
// - "rubato": the same tune performed with different timing curves (deadpan,
//   phrase arch, ritardando, accelerando, random wobble). The top plot is the
//   local tempo note by note; the bottom plot is the notes as played (solid)
//   over the notes as written (faint). Optional steady click for comparison.
// - "drift": eight bars of drums that gradually speed up or slow down by a
//   chosen amount, with a mystery option and an optional steady click track
//   that makes the drift obvious.
// Every plot is computed from the same timing that drives the audio
// (src/lib/tempo.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TUNES, type Tune } from '../../lib/melodies';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiToHz } from '../../lib/tuning';
import { playDrum } from '../../lib/rhythm';
import { BEAT_MAX_MS, BEAT_MIN_MS } from '../../lib/meter';
import { CURVES, driftBeats, markingsFor, perform, type Curve } from '../../lib/tempo';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'tempo' | 'rubato' | 'drift';
const MODE_LABELS: Record<Mode, string> = { tempo: 'Tempo', rubato: 'Expressive timing', drift: 'Drift' };
const W = 640;

function click(r: Run, t: number, strong = false) {
  note(r, { f: strong ? 1760 : 1320, t, dur: 0.015, gain: strong ? 0.22 : 0.16, attack: 0.002, release: 0.04, wave: 'triangle' });
}

export default function TempoLab(props: {
  initialMode?: Mode;
  modes?: Mode[];
  tune?: string;
  tunes?: string[];
  bpm?: number;
  curve?: Curve;
  curves?: Curve[];
  title?: string;
}) {
  const modes = props.modes ?? ['tempo', 'rubato', 'drift'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  const tuneList: Tune[] = props.tunes ? TUNES.filter((t) => props.tunes!.includes(t.id)) : TUNES.filter((t) => ['ode', 'twinkle', 'birthday', 'jingle'].includes(t.id));
  const [tuneId, setTuneId] = useState(props.tune ?? tuneList[0].id);
  const tune = TUNES.find((t) => t.id === tuneId) ?? tuneList[0];

  const [bpm, setBpm] = useState(props.bpm ?? 100);
  const [clicks, setClicks] = useState(true);
  const curveList = props.curves ? CURVES.filter((c) => props.curves!.includes(c.id)) : CURVES;
  const [curve, setCurve] = useState<Curve>(props.curve ?? curveList[0].id);
  const [depth, setDepth] = useState(0.3);
  const [drift, setDrift] = useState(0.06);
  const [mystery, setMystery] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState<number | null>(null); // seconds into the run
  const run = useRef<Run | null>(null);
  const raf = useRef(0);
  const endTimer = useRef(0);

  const stop = useCallback(() => {
    run.current?.stop(0.08);
    run.current = null;
    cancelAnimationFrame(raf.current);
    window.clearTimeout(endTimer.current);
    setPlaying(false);
    setHead(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, tuneId, curve, stop]);

  // ----- derived timing -----
  const written = useMemo(() => perform(tune.notes, bpm, 'deadpan', 0), [tune, bpm]);
  const played = useMemo(() => perform(tune.notes, bpm, curve, depth), [tune, bpm, curve, depth]);
  const driftTimes = useMemo(() => driftBeats(32, 100, drift), [drift]);

  const beatMs = 60000 / bpm;
  const shortestEighths = Math.min(...tune.notes.filter(([m]) => m).map(([, d]) => d));
  const shortestMs = shortestEighths * (30000 / bpm);
  const passage = written.length ? written[written.length - 1].t + written[written.length - 1].dur : 0;

  const startClock = (r: Run, length: number) => {
    const tick = () => {
      if (!run.current) return;
      setHead(r.ctx.currentTime - r.t0);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    endTimer.current = window.setTimeout(() => stop(), ((r.t0 - r.ctx.currentTime) + length + 0.4) * 1000);
  };

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.12);
    run.current = r;
    let length = 0;
    if (mode === 'tempo' || mode === 'rubato') {
      const wave = harmonicWave(r.ctx, 8, 1.5);
      const notes = mode === 'tempo' ? written : played;
      notes.forEach((n) => {
        if (n.midi) note(r, { f: midiToHz(n.midi), t: r.t0 + n.t, dur: n.dur * 0.85, gain: 0.2, attack: 0.01, release: 0.12, wave });
      });
      length = notes[notes.length - 1].t + notes[notes.length - 1].dur;
      if (clicks) {
        const beat = 60 / bpm;
        // tunes with a pickup (Happy Birthday) still start on a beat, so beats from 0 line up
        const end = mode === 'tempo' ? length : Math.max(length, passage);
        for (let t = 0; t < end - 0.01; t += beat) click(r, r.t0 + t);
      }
    } else {
      const times = driftTimes;
      for (let b = 0; b < 32; b++) {
        const t = r.t0 + times[b];
        const half = (times[b + 1] - times[b]) / 2;
        const inBar = b % 4;
        if (inBar === 0 || inBar === 2) playDrum('kick', t, 0.55, r.bus);
        if (inBar === 1 || inBar === 3) playDrum('snare', t, 0.45, r.bus);
        playDrum('hat', t, 0.3, r.bus);
        playDrum('hat', t + half, 0.2, r.bus);
        if (clicks) click(r, r.t0 + (b * 60) / 100, inBar === 0);
      }
      length = Math.max(times[32], (32 * 60) / 100);
    }
    setPlaying(true);
    startClock(r, length);
  };

  const newMystery = () => {
    stop();
    const opts = [0, 0.03, 0.06, 0.12, -0.06];
    setDrift(opts[Math.floor(Math.random() * opts.length)]);
    setMystery(true);
    setRevealed(false);
  };
  const hidden = mode === 'drift' && mystery && !revealed;

  // ----- captions and titles -----
  const title =
    props.title ?? (mode === 'tempo' ? 'One tune, any tempo' : mode === 'rubato' ? 'Shaping time: expressive timing' : 'Can you hear the band speed up?');
  const caption =
    mode === 'tempo' ? (
      <>
        Notes are bars: time across, pitch up. The window is always 12 seconds, so at a faster tempo more of the tune fits
        in it. The thin vertical lines are the beats. Readouts give the length of one beat, the shortest gap from one
        note to the next, and the traditional tempo word for this speed.
      </>
    ) : mode === 'rubato' ? (
      <>
        Top: the local tempo while each note sounds (the dashed line is the written tempo). Bottom: the notes as played
        (solid) over the notes exactly as written (faint). The phrase-arch curve is a stylized version of the shape
        measured in pianists' timing, not a copy of any one performance.
      </>
    ) : (
      <>
        Eight bars of drums starting at 100 BPM. The tempo changes smoothly from the first beat to the last. Top: the
        drums' tempo bar by bar (dashed = steady click). Bottom: how far each beat has moved ahead of (up) or behind
        (down) the click, in milliseconds.
      </>
    );

  return (
    <Widget kicker="Lab" title={title} caption={caption}>
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented label="Mode" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))} onChange={setMode} />
        </div>
      )}

      {mode !== 'drift' && tuneList.length > 1 && (
        <div className="w-controls">
          <Segmented label="Tune" value={tuneId} options={tuneList.map((t) => ({ value: t.id, label: t.name }))} onChange={setTuneId} />
        </div>
      )}

      {mode === 'tempo' && <TempoPlot notes={written} bpm={bpm} head={head} />}
      {mode === 'rubato' && <RubatoPlot played={played} written={written} bpm={bpm} head={head} />}
      {mode === 'drift' && <DriftPlot times={driftTimes} hidden={hidden} head={head} />}

      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        {mode !== 'drift' && (
          <Slider label="Tempo" value={bpm} min={mode === 'tempo' ? 30 : 60} max={mode === 'tempo' ? 240 : 160} step={1} onChange={setBpm} display={`${bpm} BPM`} />
        )}
        <button type="button" className={'w-chip' + (clicks ? ' is-on' : '')} onClick={() => setClicks(!clicks)} aria-pressed={clicks}>
          {mode === 'drift' ? 'Steady click track' : mode === 'rubato' ? 'Steady click' : 'Beat clicks'}
        </button>
      </div>

      {mode === 'rubato' && (
        <>
          <div className="w-controls">
            <Segmented label="Timing" value={curve} options={curveList.map((c) => ({ value: c.id, label: c.label }))} onChange={setCurve} />
            {curve !== 'deadpan' && (
              <Slider label="Amount" value={depth} min={0} max={0.5} step={0.01} onChange={setDepth} display={`${Math.round(depth * 100)}%`} />
            )}
          </div>
          <p className="w-note">{CURVES.find((c) => c.id === curve)?.blurb}</p>
        </>
      )}

      {mode === 'drift' && (
        <div className="w-controls">
          {!mystery ? (
            <Segmented
              label="Change by the end"
              value={drift}
              options={[
                { value: -0.06, label: '−6%' },
                { value: 0, label: 'Steady' },
                { value: 0.03, label: '+3%' },
                { value: 0.06, label: '+6%' },
                { value: 0.12, label: '+12%' },
              ]}
              onChange={(v) => {
                stop();
                setDrift(v);
              }}
            />
          ) : (
            <>
              <span className="w-label">Change by the end</span>
              <span className="w-mystery">{revealed ? fmtDrift(drift) : 'Mystery'}</span>
              {!revealed && (
                <button type="button" className="w-chip" onClick={() => setRevealed(true)}>
                  Reveal
                </button>
              )}
            </>
          )}
          <button type="button" className="w-chip" onClick={newMystery}>
            {mystery ? 'Another mystery' : 'Mystery drift'}
          </button>
          {mystery && (
            <button type="button" className="w-chip" onClick={() => { stop(); setMystery(false); }}>
              Choose it myself
            </button>
          )}
        </div>
      )}

      <div className="w-readouts">
        {mode === 'tempo' && (
          <>
            <Readout label="Marking">{markingsFor(bpm).join(' / ')}</Readout>
            <Readout label="One beat">{Math.round(beatMs)} ms</Readout>
            <Readout label="Shortest gap">{Math.round(shortestMs)} ms</Readout>
            <Readout label="Whole tune">{passage.toFixed(1)} s</Readout>
          </>
        )}
        {mode === 'rubato' && <RubatoReadouts played={played} written={written} />}
        {mode === 'drift' && (
          <>
            <Readout label="Tempo at the end">{hidden ? '?' : `${Math.round(100 * (1 + drift))} BPM`}</Readout>
            <Readout label="Last beat vs click">{hidden ? '?' : fmtOffset(((32 * 60) / 100 - driftTimes[32]) * 1000)}</Readout>
          </>
        )}
      </div>
      {mode === 'tempo' && <p className="w-note">{beatNote(beatMs)}</p>}
    </Widget>
  );
}

function fmtDrift(d: number) {
  return d === 0 ? 'Steady' : `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%`;
}
function fmtOffset(ms: number) {
  if (Math.abs(ms) < 1) return 'together';
  return `${Math.round(Math.abs(ms))} ms ${ms > 0 ? 'ahead' : 'behind'}`;
}
function beatNote(ms: number) {
  if (ms < BEAT_MIN_MS + 50) return 'Beats this short are hard to feel as beats: most listeners start feeling every second or fourth one instead (chapter 2.2).';
  if (ms > BEAT_MAX_MS - 300) return 'Beats this far apart stop feeling connected: you start waiting for each one instead of anticipating it (chapter 2.2).';
  if (ms > 450 && ms < 800) return 'Close to the beat length most people find easiest to tap along with.';
  return '';
}

// ---------- plots ----------

type T = ReturnType<typeof perform>;

function pitchScale(notes: T, y0: number, y1: number) {
  const ms = notes.filter((n) => n.midi).map((n) => n.midi);
  const lo = Math.min(...ms) - 1;
  const hi = Math.max(...ms) + 1;
  return scale(lo, hi, y1, y0);
}

function TempoPlot(props: { notes: T; bpm: number; head: number | null }) {
  const WIN = 12;
  const H = 170;
  const x = scale(0, WIN, 30, W - 10);
  const y = pitchScale(props.notes, 14, H - 30);
  const beat = 60 / props.bpm;
  const beats: number[] = [];
  for (let t = 0; t <= WIN + 1e-6; t += beat) beats.push(t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="The tune's notes in a fixed 12-second window, with beat lines">
      {beats.length < 200 && beats.map((t, i) => <line key={i} x1={x(t)} x2={x(t)} y1={8} y2={H - 26} className="stroke-grid" />)}
      {Array.from({ length: WIN + 1 }, (_, s) => (
        <text key={s} x={x(s)} y={H - 10} textAnchor="middle" className="w-tick">
          {s}
          {s === WIN ? ' s' : ''}
        </text>
      ))}
      {props.notes
        .filter((n) => n.midi && n.t < WIN)
        .map((n, i) => (
          <rect
            key={i}
            x={x(n.t)}
            y={r2(y(n.midi) - 3)}
            width={r2(Math.max(2, x(Math.min(WIN, n.t + n.dur)) - x(n.t) - 2))}
            height={6}
            rx={2}
            className={'note-bar' + (props.head != null && props.head >= n.t && props.head < n.t + n.dur ? ' is-now' : '')}
          />
        ))}
      {props.head != null && props.head <= WIN && <line x1={x(props.head)} x2={x(props.head)} y1={6} y2={H - 26} className="tempo-head" />}
    </svg>
  );
}

function RubatoPlot(props: { played: T; written: T; bpm: number; head: number | null }) {
  const end = Math.max(...[props.played, props.written].map((ns) => ns[ns.length - 1].t + ns[ns.length - 1].dur));
  const H = 250;
  const TOP0 = 10, TOP1 = 92, BOT0 = 112, BOT1 = H - 28;
  const x = scale(0, end, 44, W - 10);
  const bpms = props.played.map((n) => n.bpm);
  const lo = Math.min(props.bpm * 0.6, ...bpms);
  const hi = Math.max(props.bpm * 1.4, ...bpms);
  const ty = scale(lo, hi, TOP1, TOP0);
  const y = pitchScale(props.written, BOT0, BOT1);
  let path = '';
  props.played.forEach((n, i) => {
    path += `${i ? 'L' : 'M'}${x(n.t)},${ty(n.bpm)} L${x(n.t + n.dur)},${ty(n.bpm)} `;
  });
  const secs = Math.ceil(end);
  const step = secs > 24 ? 4 : secs > 12 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Local tempo over time, and the notes as played over the notes as written">
      <line x1={44} x2={W - 10} y1={ty(props.bpm)} y2={ty(props.bpm)} className="stroke-grid" strokeDasharray="4 4" />
      <text x={38} y={ty(props.bpm) + 4} textAnchor="end" className="w-tick">
        {props.bpm}
      </text>
      <text x={38} y={TOP0 + 8} textAnchor="end" className="w-tick">
        BPM
      </text>
      <path d={path} className="tempo-curve" />
      {props.written
        .filter((n) => n.midi)
        .map((n, i) => (
          <rect key={'w' + i} x={x(n.t)} y={r2(y(n.midi) - 3)} width={r2(Math.max(2, x(n.t + n.dur) - x(n.t) - 2))} height={6} rx={2} className="note-ghost" />
        ))}
      {props.played
        .filter((n) => n.midi)
        .map((n, i) => (
          <rect
            key={'p' + i}
            x={x(n.t)}
            y={r2(y(n.midi) - 3)}
            width={r2(Math.max(2, x(n.t + n.dur) - x(n.t) - 2))}
            height={6}
            rx={2}
            className={'note-bar' + (props.head != null && props.head >= n.t && props.head < n.t + n.dur ? ' is-now' : '')}
          />
        ))}
      {Array.from({ length: Math.floor(secs / step) + 1 }, (_, k) => k * step)
        .filter((s) => s <= end + 0.01)
        .map((s) => (
          <text key={s} x={x(s)} y={H - 10} textAnchor="middle" className="w-tick">
            {s}
            {s === 0 ? ' s' : ''}
          </text>
        ))}
      {props.head != null && props.head <= end && <line x1={x(props.head)} x2={x(props.head)} y1={6} y2={BOT1 + 4} className="tempo-head" />}
    </svg>
  );
}

function RubatoReadouts(props: { played: T; written: T }) {
  const len = (ns: T) => ns[ns.length - 1].t + ns[ns.length - 1].dur;
  const bpms = props.played.map((n) => n.bpm);
  const gap = Math.max(...props.played.map((n, i) => Math.abs(n.t - props.written[i].t)));
  return (
    <>
      <Readout label="Length">
        {len(props.played).toFixed(1)} s <span className="w-tick-text">(as written {len(props.written).toFixed(1)} s)</span>
      </Readout>
      <Readout label="Tempo range">
        {Math.round(Math.min(...bpms))}–{Math.round(Math.max(...bpms))} BPM
      </Readout>
      <Readout label="Furthest from written">{Math.round(gap * 1000)} ms</Readout>
    </>
  );
}

function DriftPlot(props: { times: number[]; hidden: boolean; head: number | null }) {
  const H = 210;
  const TOP0 = 12, TOP1 = 92, BOT0 = 116, BOT1 = H - 30;
  const beats = props.times.length - 1;
  const bx = scale(0, beats, 44, W - 10);
  const tempos = props.times.slice(0, -1).map((t, i) => 60 / (props.times[i + 1] - t));
  const ty = scale(84, 116, TOP1, TOP0);
  const offs = props.times.slice(0, -1).map((t, i) => ((i * 60) / 100 - t) * 1000);
  const maxOff = Math.max(60, ...offs.map(Math.abs));
  const oy = scale(-maxOff, maxOff, BOT1, BOT0);
  const mid = oy(0);
  const headBeat = props.head == null ? null : props.times.findIndex((t) => t > props.head!) - 1;
  if (props.hidden)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Hidden until you reveal the answer">
        <text x={W / 2} y={H / 2 - 6} textAnchor="middle" className="w-tick">
          Steady, faster, or slower? Listen, decide, then press Reveal.
        </text>
        <text x={W / 2} y={H / 2 + 14} textAnchor="middle" className="w-tick">
          (Try it with and without the click track.)
        </text>
        {headBeat != null && headBeat >= 0 && (
          <text x={W / 2} y={H / 2 + 40} textAnchor="middle" className="w-tick">
            bar {Math.floor(headBeat / 4) + 1} of 8
          </text>
        )}
      </svg>
    );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="The drums' tempo over eight bars, and how far each beat drifts from a steady click">
      {[88, 100, 112].map((v) => (
        <g key={v}>
          <line x1={44} x2={W - 10} y1={ty(v)} y2={ty(v)} className="stroke-grid" strokeDasharray={v === 100 ? '4 4' : undefined} />
          <text x={38} y={ty(v) + 4} textAnchor="end" className="w-tick">
            {v}
          </text>
        </g>
      ))}
      <text x={38} y={TOP0 + 2} textAnchor="end" className="w-tick">
        BPM
      </text>
      <path d={tempos.map((v, i) => `${i ? 'L' : 'M'}${bx(i + 0.5)},${ty(v)}`).join(' ')} className="tempo-curve" />
      <line x1={44} x2={W - 10} y1={mid} y2={mid} className="stroke-grid" />
      <text x={38} y={mid + 4} textAnchor="end" className="w-tick">
        0 ms
      </text>
      <text x={38} y={BOT0 + 8} textAnchor="end" className="w-tick">
        ahead
      </text>
      <text x={38} y={BOT1} textAnchor="end" className="w-tick">
        behind
      </text>
      {offs.map((o, i) => (
        <rect
          key={i}
          x={r2(bx(i + 0.5) - 4)}
          y={Math.min(mid, oy(o))}
          width={8}
          height={r2(Math.max(0.5, Math.abs(oy(o) - mid)))}
          className={'drift-bar' + (headBeat === i ? ' is-now' : '')}
        />
      ))}
      {Array.from({ length: 9 }, (_, b) => (
        <g key={b}>
          <line x1={bx(b * 4)} x2={bx(b * 4)} y1={TOP0} y2={BOT1} className="stroke-grid" />
          {b < 8 && (
            <text x={bx(b * 4 + 2)} y={H - 10} textAnchor="middle" className="w-tick">
              bar {b + 1}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
