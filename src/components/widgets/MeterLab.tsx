// Beat induction. Two labs:
//
// - "range": a click train whose spacing you control, on a map of the range
//   where a beat can be felt (roughly 200 ms to 1.8 s between beats, with a
//   preference near 600 ms; London 2012). Tap along and the lab measures
//   your tapping: how far apart your taps are, how steady, and how early.
// - "find": a looping rhythm on a grid. A simplified Povel & Essens (1985)
//   clock model marks which tones sound accented and ranks every candidate
//   beat by how much evidence counts against it. Pick a beat to hear it
//   played under the rhythm, edit the rhythm, or tap your own beat and see
//   which one you chose.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loop, startRun, type Run } from '../../lib/sequence';
import { playDrum } from '../../lib/rhythm';
import {
  BEAT_MAX_MS,
  BEAT_MIN_MS,
  BEAT_PREFERRED_MS,
  RHYTHMS,
  accents,
  metricalDots,
  rankClocks,
  type Clock,
  type Step,
} from '../../lib/meter';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Mode = 'range' | 'find';
type Mark = { t: number; step: number; ms: number };

/** A short wooden "tok" for the rhythm itself. */
function tok(run: Run, t: number, loud: boolean) {
  const { ctx } = run;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(loud ? 1320 : 1180, t);
  o.frequency.exponentialRampToValueAtTime(loud ? 1150 : 1050, t + 0.05);
  const g = ctx.createGain();
  const peak = loud ? 0.5 : 0.24;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g).connect(run.bus);
  o.start(t);
  o.stop(t + 0.09);
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const TAP_KEEP = 10;

export default function MeterLab(props: {
  initialMode?: Mode;
  /** Rhythm ids to offer in the "find" lab (default: all). */
  patterns?: string[];
  pattern?: string;
  /** Hide the lab switch. */
  lock?: boolean;
}) {
  const offered = useMemo(() => (props.patterns ? RHYTHMS.filter((r) => props.patterns!.includes(r.id)) : RHYTHMS), [props.patterns]);
  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'find');
  const [pid, setPid] = useState(props.pattern ?? offered[0].id);
  const base = RHYTHMS.find((r) => r.id === pid) ?? offered[0];
  const [steps, setSteps] = useState<Step[]>(base.steps);
  const [stepMs, setStepMs] = useState(base.stepMs);
  const [ioi, setIoi] = useState(600);
  const [clockKey, setClockKey] = useState<string>('none'); // 'none' | `${period}:${phase}`
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [taps, setTaps] = useState<number[]>([]); // audio-clock times
  const [tapPos, setTapPos] = useState<number[]>([]); // fractional step positions (find) or asynchronies (range)

  const n = steps.length;
  const ranked = useMemo(() => rankClocks(steps, stepMs), [steps, stepMs]);
  const acc = useMemo(() => accents(steps), [steps]);
  const chosen: Clock | null = clockKey === 'none' ? null : ranked.find((c) => `${c.period}:${c.phase}` === clockKey) ?? null;
  const edited = steps.some((s, i) => s !== base.steps[i]);

  const live = useRef({ mode, steps, stepMs, ioi, chosen, bar: base.bar });
  live.current = { mode, steps, stepMs, ioi, chosen, bar: base.bar };
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const marks = useRef<Mark[]>([]);
  const raf = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    run.current?.stop(0.05);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    cancelAnimationFrame(raf.current);
    marks.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, stop]);

  const choosePattern = (id: string) => {
    const r = RHYTHMS.find((x) => x.id === id)!;
    setPid(id);
    setSteps(r.steps);
    setStepMs(r.stepMs);
    setClockKey('none');
    setTaps([]);
    setTapPos([]);
  };

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1);
    run.current = r;
    setTaps([]);
    setTapPos([]);
    cancel.current = loop(r, (t, i) => {
      const p = live.current;
      if (p.mode === 'range') {
        tok(r, t, false);
        marks.current.push({ t, step: i, ms: p.ioi });
        if (marks.current.length > 64) marks.current.splice(0, marks.current.length - 64);
        return p.ioi / 1000;
      }
      const N = p.steps.length;
      const s = i % N;
      if (p.steps[s]) tok(r, t, p.steps[s] === 2);
      const c = p.chosen;
      if (c && (((s - c.phase) % c.period) + c.period) % c.period === 0) {
        const dots = metricalDots(N, c.period, c.phase, p.bar)[s];
        const isBar = dots >= (c.period % 2 === 0 && c.period > 2 ? 4 : 3);
        playDrum('kick', t, isBar ? 0.95 : 0.55, r.bus);
      }
      marks.current.push({ t, step: s, ms: p.stepMs });
      if (marks.current.length > 96) marks.current.splice(0, marks.current.length - 96);
      return p.stepMs / 1000;
    });
    const frame = () => {
      if (!run.current) return;
      const tnow = r.ctx.currentTime;
      let cur: number | null = null;
      for (const m of marks.current) if (m.t <= tnow) cur = m.step;
      setNow(cur);
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  // ---- tapping ----
  const tap = useCallback(() => {
    const r = run.current;
    if (!r) return;
    // When you hear a click, it left the speakers outputLatency after its scheduled time.
    const T = r.ctx.currentTime - ((r.ctx as any).outputLatency ?? 0);
    const ms = marks.current;
    let m: Mark | null = null;
    for (const x of ms) if (x.t <= T) m = x;
    if (!m) return;
    const next = ms.find((x) => x.t > T);
    setTaps((prev) => [...prev, T].slice(-TAP_KEEP));
    if (live.current.mode === 'range') {
      // signed asynchrony to the nearest click, in ms
      const d0 = T - m.t;
      const d1 = next ? T - next.t : Infinity;
      const a = Math.abs(d0) <= Math.abs(d1) ? d0 : d1;
      setTapPos((prev) => [...prev, a * 1000].slice(-TAP_KEEP));
    } else {
      const N = live.current.steps.length;
      const pos = (m.step + (T - m.t) / (m.ms / 1000)) % N;
      setTapPos((prev) => [...prev, pos].slice(-TAP_KEEP));
    }
  }, []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat || !(e.key === ' ' || e.key === 't' || e.key === 'T')) return;
      if (!root.current?.matches(':hover, :focus-within')) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!run.current) return;
      e.preventDefault();
      tap();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [tap]);

  // tap statistics
  const gaps = taps.slice(1).map((t, i) => (t - taps[i]) * 1000).filter((g) => g < 4000);
  const tapMs = gaps.length >= 2 ? median(gaps) : null;
  const tapCv = tapMs && gaps.length >= 3 ? Math.sqrt(gaps.reduce((a, g) => a + (g - tapMs) ** 2, 0) / gaps.length) / tapMs : null;

  let tapped: { period: number; phase: number; asyncMs: number } | null = null;
  if (mode === 'find' && tapMs && tapPos.length >= 3) {
    const period = Math.max(1, Math.round(tapMs / stepMs));
    // circular mean of positions modulo the period
    let sx = 0;
    let sy = 0;
    for (const p of tapPos) {
      const a = ((p % period) / period) * 2 * Math.PI;
      sx += Math.cos(a);
      sy += Math.sin(a);
    }
    const meanPos = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period;
    const phase = Math.round(meanPos) % period;
    let async = meanPos - phase;
    if (async > period / 2) async -= period;
    tapped = { period, phase, asyncMs: async * stepMs };
  }
  const meanAsync = mode === 'range' && tapPos.length >= 3 ? tapPos.reduce((a, b) => a + b, 0) / tapPos.length : null;

  const cycleStep = (i: number) => {
    setSteps((s) => s.map((v, k) => (k === i ? (((v + 1) % 3) as Step) : v)));
    setTapPos([]);
    setTaps([]);
  };

  const best = ranked[0];
  const describe = (c: Clock) => `every ${c.period} step${c.period > 1 ? 's' : ''} from step ${c.phase + 1}`;

  return (
    <div ref={root}>
      <Widget
        kicker="Lab"
        title={mode === 'range' ? 'Where a beat can live' : 'Find the beat'}
        caption={
          mode === 'range' ? (
            <>
              A steady click. Drag <strong>Spacing</strong> to change the time between clicks; the map shows where that
              sits relative to the range in which listeners feel a beat (approximate boundaries from London 2012; they
              vary from person to person). Press <strong>Tap</strong> (or the space bar while the pointer is over the lab)
              along with the clicks. The lab reports how far apart your taps are, how steady they are, and whether they
              land early or late.
            </>
          ) : (
            <>
              A looping rhythm, one cell per grid step, played as identical "toks" (bigger circles are louder). The
              small wedges mark tones that a simple model of perception (after Povel &amp; Essens 1985) predicts will
              sound accented, just from how the tones are grouped in time. The list ranks every steady beat that fits
              the loop (beats 200–1800 ms apart that repeat with it at least three times): each beat that lands on silence counts heavily against it, each beat on an unaccented tone
              counts a little. Choose one to hear it as a low drum under the rhythm; the dots under the grid then show
              its metrical hierarchy. Click cells to edit the rhythm. Tap along to see which beat <em>you</em> chose.
            </>
          )
        }
      >
        <div className="w-controls">
          <PlayButton playing={playing} onClick={play} />
          <button type="button" className="w-play small w-tap" onPointerDown={tap} disabled={!playing}>
            Tap
          </button>
          {!props.lock && (
            <Segmented
              label="Lab"
              value={mode}
              options={[
                { value: 'range', label: 'Beat range' },
                { value: 'find', label: 'Find the beat' },
              ]}
              onChange={(m) => {
                setMode(m);
                setTaps([]);
                setTapPos([]);
              }}
            />
          )}
        </div>

        {mode === 'range' ? (
          <>
            <RangeMap ioi={ioi} tapMs={tapMs} />
            <div className="w-controls">
              <Slider
                label="Spacing"
                min={Math.log(60)}
                max={Math.log(3000)}
                step={0.01}
                value={Math.log(ioi)}
                onChange={(v) => setIoi(Math.round(Math.exp(v)))}
                display={`${ioi} ms · ${(60000 / ioi).toFixed(0)} per minute`}
              />
            </div>
            <div className="w-readouts">
              <Readout label="Your taps">
                {tapMs ? `every ${Math.round(tapMs)} ms${tapMs > ioi * 1.5 ? ` (every ${Math.round(tapMs / ioi)} clicks)` : ''}` : 'tap at least three times'}
              </Readout>
              <Readout label="Steadiness">{tapCv !== null ? `±${(tapCv * 100).toFixed(1)}% variation` : '—'}</Readout>
              <Readout label="Timing">
                {meanAsync !== null && tapMs && tapMs < ioi * 1.5
                  ? `${Math.abs(Math.round(meanAsync))} ms ${meanAsync < 0 ? 'early' : 'late'} on average`
                  : '—'}
              </Readout>
            </div>
          </>
        ) : (
          <>
            <div className="w-controls">
              <Segmented label="Rhythm" value={pid} options={offered.map((r) => ({ value: r.id, label: r.label }))} onChange={choosePattern} />
            </div>
            <p className="w-note">
              {base.blurb}
              {edited && (
                <>
                  {' '}
                  <button type="button" className="w-chip" onClick={() => choosePattern(pid)}>
                    reset
                  </button>
                </>
              )}
            </p>
            <Grid steps={steps} acc={acc} clock={chosen} bar={base.bar} now={now} taps={tapPos} onCell={cycleStep} />
            <div className="w-bars">
              <button
                type="button"
                className={'w-bar-row' + (clockKey === 'none' ? ' is-playing' : '')}
                onClick={() => setClockKey('none')}
              >
                <span className="w-bar-label">No beat: just the rhythm</span>
                <span />
              </button>
              {ranked.slice(0, 10).map((c, k) => {
                const key = `${c.period}:${c.phase}`;
                return (
                  <button
                    type="button"
                    key={key}
                    className={'w-bar-row' + (clockKey === key ? ' is-playing' : '')}
                    onClick={() => setClockKey(key)}
                  >
                    <span className="w-bar-label">
                      <span>
                        {k === 0 ? <strong>Best: </strong> : null}
                        {describe(c)} <span className="w-tick-text">· {Math.round(c.ms)} ms</span>
                      </span>
                    </span>
                    <span className="w-bar-track" title={`${c.silent} on silence, ${c.unaccented} on unaccented tones, of ${c.ticks} beats`}>
                      <span className="w-bar-fill" style={{ width: `${r2((c.score / 4) * 100)}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="w-controls">
              <Slider
                label="Speed"
                min={90}
                max={320}
                step={5}
                value={stepMs}
                onChange={setStepMs}
                display={`${stepMs} ms per step`}
              />
            </div>
            <div className="w-readouts">
              <Readout label="Model's best beat">
                {steps.every((s) => !s)
                  ? 'add some tones'
                  : best && best.score === ranked[1]?.score && acc.every((a) => !a)
                    ? 'no preference: nothing in the sound groups the tones'
                    : best
                      ? `${describe(best)}: ${best.silent} of ${best.ticks} beats on silence`
                      : 'none in range'}
              </Readout>
              <Readout label="You tapped">
                {tapped
                  ? `${describe({ period: tapped.period, phase: tapped.phase } as Clock)} (${Math.round(tapped.period * stepMs)} ms), ${Math.abs(Math.round(tapped.asyncMs))} ms ${tapped.asyncMs < 0 ? 'early' : 'late'}`
                  : playing
                    ? 'tap along at least three times'
                    : 'press Play, then tap'}
              </Readout>
            </div>
          </>
        )}
      </Widget>
    </div>
  );
}

function Grid(props: {
  steps: Step[];
  acc: boolean[];
  clock: Clock | null;
  bar?: number;
  now: number | null;
  taps: number[];
  onCell: (i: number) => void;
}) {
  const { steps, acc, clock, now } = props;
  const n = steps.length;
  const W = 680;
  const X0 = 24;
  const cw = (W - 2 * X0) / n;
  const cx = (i: number) => r2(X0 + (i + 0.5) * cw);
  const Y = 46;
  const dots = clock ? metricalDots(n, clock.period, clock.phase, props.bar) : null;
  const maxDots = dots ? Math.max(...dots) : 0;
  const H = 150;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot is-clickable" role="img" aria-label="The rhythm on a grid, with predicted accents and the chosen beat's metrical grid">
      {steps.map((s, i) => {
        const onBeat = clock && (((i - clock.phase) % clock.period) + clock.period) % clock.period === 0;
        return (
          <g key={i} onClick={() => props.onCell(i)} style={{ cursor: 'pointer' }}>
            <rect x={r2(X0 + i * cw + 1)} y={10} width={r2(cw - 2)} height={H - 20} rx={4} className={now === i ? 'meter-now' : 'meter-cell'} />
            <text x={cx(i)} y={24} textAnchor="middle" className="w-tick">
              {i + 1}
            </text>
            {s > 0 ? (
              <circle cx={cx(i)} cy={Y + 8} r={s === 2 ? 10 : 7} className="tone-a" />
            ) : (
              <circle cx={cx(i)} cy={Y + 8} r={2} className="fill-ink" opacity={0.25} />
            )}
            {s > 0 && props.acc[i] && <path d={`M${cx(i) - 6},${Y - 12} L${cx(i) + 6},${Y - 8} L${cx(i) - 6},${Y - 4}`} className="stroke-ink" />}
            {dots &&
              Array.from({ length: dots[i] }, (_, l) => {
                const cls = !onBeat || l === 0 ? 'fill-ink' : s === 0 ? 'fill-rough' : acc[i] ? 'fill-match' : 'fill-muted';
                return <circle key={l} cx={cx(i)} cy={Y + 34 + (maxDots - 1 - l) * 11} r={onBeat && l > 0 ? 3.6 : 2.4} className={cls} />;
              })}
          </g>
        );
      })}
      {dots && (
        <text x={W - X0} y={Y + 34 + maxDots * 11 + 6} textAnchor="end" className="w-tick">
          beats: <tspan className="key-match">on an accent</tspan> · <tspan className="key-muted">on a plain tone</tspan> ·{' '}
          <tspan className="key-rough">on silence</tspan>
        </text>
      )}
      {props.taps.map((p, k) => (
        <line key={k} x1={r2(X0 + p * cw)} x2={r2(X0 + p * cw)} y1={H - 22} y2={H - 12} className="stroke-b" opacity={0.35 + (0.65 * (k + 1)) / props.taps.length} />
      ))}
      {props.taps.length > 0 && (
        <text x={X0} y={H - 1} className="w-tick">
          your taps
        </text>
      )}
    </svg>
  );
}

function RangeMap({ ioi, tapMs }: { ioi: number; tapMs: number | null }) {
  const W = 680;
  const H = 120;
  const L0 = Math.log(60);
  const L1 = Math.log(3000);
  const x = (ms: number) => r2(20 + ((Math.log(ms) - L0) / (L1 - L0)) * (W - 40));
  const zones = [
    { a: 60, b: 100, label: 'a blur', cls: 'zone-out' },
    { a: 100, b: BEAT_MIN_MS, label: 'too fast: grouped', cls: 'zone-edge' },
    { a: BEAT_MIN_MS, b: BEAT_MAX_MS, label: 'a beat can be felt', cls: 'zone-in' },
    { a: BEAT_MAX_MS, b: 3000, label: 'separate events', cls: 'zone-edge' },
  ];
  const ticks = [100, 200, 300, 500, 1000, 2000];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Time between clicks on a map of the beat range">
      {zones.map((z) => (
        <rect key={z.label} x={x(z.a)} y={28} width={r2(x(z.b) - x(z.a))} height={34} className={z.cls} />
      ))}
      <line x1={x(BEAT_PREFERRED_MS)} x2={x(BEAT_PREFERRED_MS)} y1={22} y2={68} className="stroke-ink dashed thin" />
      <text x={x(BEAT_PREFERRED_MS)} y={16} textAnchor="middle" className="w-tick">
        preferred ≈ 600 ms
      </text>
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={84} textAnchor="middle" className="w-tick">
          {t >= 1000 ? `${t / 1000} s` : `${t}`}
        </text>
      ))}
      <text x={W - 20} y={100} textAnchor="end" className="w-tick">
        time between events (log scale) →
      </text>
      <path d={`M${x(ioi)},26 l-6,-9 h12 z`} className="fill-ink" />
      <line x1={x(ioi)} x2={x(ioi)} y1={26} y2={64} className="stroke-ink thick" />
      {zones.map((z) => (
        <text key={z.label} x={r2((x(z.a) + x(z.b)) / 2)} y={49} textAnchor="middle" className="w-tick halo">
          {z.label}
        </text>
      ))}
      {tapMs && tapMs >= 60 && tapMs <= 3000 && (
        <>
          <circle cx={x(tapMs)} cy={74} r={5} className="tone-b" />
          <text x={x(tapMs)} y={112} textAnchor="middle" className="w-tick">
            your taps
          </text>
        </>
      )}
    </svg>
  );
}
