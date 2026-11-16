// Interval lab for chapter 3.1. Three views of a single interval:
//
//   stack       ratios multiply, cents add: stack just intervals and watch
//               the fraction and the cents total; play the stack as notes
//               and as a chord. Shows the inversion of the result.
//   categories  a minor-or-major-third test at seven sizes from 300 to 400
//               cents, with the listener's identification curve plotted
//               (the classic categorical-perception picture).
//   tune        tune the upper note by ear: harmonic fifth, third, or octave
//               (beats guide you to the just ratio), or a melodic octave of
//               pure tones (no beats; listeners often set it a little wide).
//
// Every picture is drawn from the numbers that drive the sound.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdditiveVoice } from '../../lib/audio';
import { harmonic } from '../../lib/dissonance';
import {
  type Frac,
  PALETTE,
  THIRD_STEPS,
  boundary,
  fracCents,
  fracText,
  intervalName,
  invert,
  mul,
} from '../../lib/intervals';
import { harmonicWave, loop, note, startRun, type Run } from '../../lib/sequence';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

export type IntervalMode = 'stack' | 'categories' | 'tune';
const MODE_LABEL: Record<IntervalMode, string> = {
  stack: 'Stack intervals',
  categories: 'Minor or major?',
  tune: 'Tune by ear',
};
const TITLES: Record<IntervalMode, string> = {
  stack: 'Ratios multiply, cents add',
  categories: 'Minor third or major third?',
  tune: 'Tune it by ear',
};
const CAPTIONS: Record<IntervalMode, string> = {
  stack:
    'Each colored bar is one interval, drawn to scale on a ruler marked in cents, with the twelve equal-tempered semitones as ticks. The fraction multiplies as you stack; the cents simply add. Every interval here is a just (small-number) ratio. Play sounds the notes one at a time, then together.',
  categories:
    'Each trial plays two notes at one of seven sizes between a minor third (300 cents) and a major third (400 cents), starting on a random pitch. Your answers are plotted as the percentage of "major" at each size. A smooth diagonal would mean you hear size continuously; a steep step means you hear two categories.',
  tune:
    'The upper note starts out of tune by a random amount. Use the slider and the fine buttons until it sounds right, then press Done to see where you landed against the just ratio and the equal-tempered size. The slider has no numbers on purpose.',
};

const W = 680;
const ROOT_STACK = 220;

// ---------- shared one-shot player ----------
function useOneShot() {
  const [playing, setPlaying] = useState(false);
  const run = useRef<Run | null>(null);
  const timer = useRef<number | null>(null);
  const stop = useCallback(() => {
    run.current?.stop(0.06);
    run.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  /** Schedule notes into a fresh run; `total` seconds later it stops itself. */
  const play = (schedule: (r: Run) => number) => {
    stop();
    const r = startRun(0.08);
    run.current = r;
    const total = schedule(r);
    setPlaying(true);
    timer.current = window.setTimeout(stop, (total + 0.4) * 1000);
  };
  return { playing, stop, play };
}

// ---------- stack ----------
const PRESETS: { label: string; steps: string[] }[] = [
  { label: 'Fifth + fourth', steps: ['P5', 'P4'] },
  { label: 'Major + minor third', steps: ['M3', 'm3'] },
  { label: 'Thirds and a fourth', steps: ['M3', 'm3', 'P4'] },
  { label: 'Octave + major third', steps: ['P8', 'M3'] },
];
const MAX_CENTS = 2400;

function Stack() {
  const [steps, setSteps] = useState<string[]>(['P5', 'P4']);
  const { playing, stop, play } = useOneShot();
  const items = steps.map((s) => PALETTE.find((p) => p.short === s)!);
  const ratio = items.reduce<Frac>((acc, it) => mul(acc, it.ratio), [1, 1]);
  const total = fracCents(ratio);
  const nm = intervalName(total);
  const canAdd = (r: Frac) => total + fracCents(r) <= MAX_CENTS + 1 && steps.length < 6;

  const maxC = total > 1250 ? MAX_CENTS : 1200;
  const x = scale(0, maxC, 24, W - 24);
  let cum = 0;
  const bars = items.map((it, i) => {
    const c = fracCents(it.ratio);
    const b = { x0: x(cum), x1: x(cum + c), c, it, i };
    cum += c;
    return b;
  });
  const ticks = Array.from({ length: maxC / 100 + 1 }, (_, k) => k);

  const playStack = () => {
    if (playing) return stop();
    play((r) => {
      const wave = harmonicWave(r.ctx, 8, 1.3);
      const freqs = [ROOT_STACK];
      let f = ROOT_STACK;
      for (const it of items) freqs.push((f *= it.ratio[0] / it.ratio[1]));
      const gap = 0.5;
      freqs.forEach((fr, i) => note(r, { f: fr, t: r.t0 + i * gap, dur: 0.42, gain: 0.16, wave }));
      const tc = r.t0 + freqs.length * gap + 0.25;
      const g = 0.32 / Math.sqrt(freqs.length + 1);
      freqs.forEach((fr) => note(r, { f: fr, t: tc, dur: 1.8, gain: g, wave, attack: 0.04, release: 0.6 }));
      return freqs.length * gap + 0.25 + 2.4;
    });
  };
  useEffect(() => stop(), [steps, stop]);

  const sum = items.map((it) => Math.round(fracCents(it.ratio))).join(' + ');
  const product = items.map((it) => fracText(it.ratio)).join(' × ');
  const inv = total > 0.5 && total <= 1200.5 ? invert(ratio) : null;

  return (
    <>
      <div className="w-controls">
        <div className="w-chips" role="group" aria-label="Add an interval">
          {PALETTE.map((p) => (
            <button type="button" key={p.short} className="w-chip" disabled={!canAdd(p.ratio)} onClick={() => setSteps([...steps, p.short])} title={`${p.name}, ${fracText(p.ratio)}`}>
              + {p.short} <span className="il-chip-ratio">{fracText(p.ratio)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="w-controls">
        <button type="button" className="w-chip" disabled={!steps.length} onClick={() => setSteps(steps.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className="w-chip" disabled={!steps.length} onClick={() => setSteps([])}>
          Clear
        </button>
        <span className="w-label">Examples</span>
        <div className="w-chips">
          {PRESETS.map((p) => (
            <button type="button" key={p.label} className={'w-chip' + (p.steps.join() === steps.join() ? ' is-on' : '')} onClick={() => setSteps(p.steps)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <svg className="w-plot" viewBox={`0 0 ${W} 170`} role="img" aria-label={`Stacked intervals totaling ${Math.round(total)} cents`}>
        {ticks.map((k) => {
          const isOct = k % 12 === 0;
          return (
            <g key={k}>
              <line x1={x(k * 100)} x2={x(k * 100)} y1={isOct ? 112 : 118} y2={128} className={isOct ? 'il-axis' : 'stroke-grid il-tick'} />
              <text x={x(k * 100)} y={142} textAnchor="middle" className="il-tick-label">
                {intervalName(k * 100).short}
              </text>
              {k % (maxC > 1200 ? 4 : 2) === 0 && (
                <text x={x(k * 100)} y={160} textAnchor="middle" className="il-cents-label">
                  {k * 100}
                </text>
              )}
            </g>
          );
        })}
        <line x1={x(0)} x2={x(maxC)} y1={128} y2={128} className="il-axis" />
        {bars.map((b) => (
          <g key={b.i}>
            <rect x={b.x0} y={98} width={Math.max(1, r2(b.x1 - b.x0 - 1.5))} height={14} rx={3} className={b.i % 2 ? 'tone-b' : 'tone-a'} />
            <text x={r2((b.x0 + b.x1) / 2)} y={b.i % 2 ? 72 : 88} textAnchor="middle" className="il-bar-label">
              {b.it.short} {fracText(b.it.ratio)} · {Math.round(b.c)}¢
            </text>
          </g>
        ))}
        {steps.length > 0 && (
          <g>
            <line x1={x(total)} x2={x(total)} y1={30} y2={128} className="il-total" />
            <text x={Math.min(x(total), W - 150)} y={22} textAnchor={x(total) > W - 150 ? 'start' : 'middle'} className="il-total-label">
              {fracText(ratio)} = {Math.round(total)}¢
            </text>
          </g>
        )}
        {!steps.length && (
          <text x={W / 2} y={70} textAnchor="middle" className="il-hint">
            Add an interval to start stacking
          </text>
        )}
      </svg>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={playStack} label={playing ? 'Stop' : 'Play the stack'} />
      </div>
      {steps.length > 0 && (
        <div className="w-readouts">
          <Readout label="Ratios multiply">
            {product} = {fracText(ratio)}
          </Readout>
          <Readout label="Cents add">
            {sum} = {Math.round(total)}
          </Readout>
          <Readout label="Nearest name">
            {nm.name}
            {Math.abs(nm.offset) >= 0.5 ? ` (${nm.offset > 0 ? '+' : '−'}${Math.abs(Math.round(nm.offset))}¢ from equal temperament)` : ' (exactly equal-tempered)'}
          </Readout>
          {inv && total < 1199.5 && (
            <Readout label="Its inversion">
              {intervalName(1200 - total).name}: {fracText(inv)}, {Math.round(1200 - total)}¢
            </Readout>
          )}
        </div>
      )}
    </>
  );
}

// ---------- categories ----------
type Trial = { cents: number; major: boolean };
type Ctx = 'melodic' | 'harmonic';

function Categories() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [current, setCurrent] = useState<{ cents: number; root: number } | null>(null);
  const [answered, setAnswered] = useState(true);
  const [ctx, setCtx] = useState<Ctx>('melodic');
  const [reveal, setReveal] = useState(false);
  const [last, setLast] = useState<string>('');
  const bag = useRef<number[]>([]);
  const { playing, stop, play } = useOneShot();

  const sound = (c: { cents: number; root: number }, mode: Ctx) => {
    play((r) => {
      const wave = harmonicWave(r.ctx, 8, 1.3);
      const hi = c.root * 2 ** (c.cents / 1200);
      if (mode === 'melodic') {
        note(r, { f: c.root, t: r.t0, dur: 0.55, gain: 0.2, wave });
        note(r, { f: hi, t: r.t0 + 0.7, dur: 0.55, gain: 0.2, wave });
        return 1.6;
      }
      note(r, { f: c.root, t: r.t0, dur: 1.1, gain: 0.15, wave, attack: 0.03 });
      note(r, { f: hi, t: r.t0, dur: 1.1, gain: 0.15, wave, attack: 0.03 });
      return 1.6;
    });
  };

  const next = () => {
    if (!bag.current.length) bag.current = [...THIRD_STEPS].sort(() => Math.random() - 0.5);
    const cents = bag.current.pop()!;
    const root = 196 * 2 ** (Math.random() * 0.75); // G3 to about D♯4, so absolute pitch gives no clue
    const c = { cents, root };
    setCurrent(c);
    setAnswered(false);
    setLast('');
    sound(c, ctx);
  };

  const answer = (major: boolean) => {
    if (!current || answered) return;
    setTrials([...trials, { cents: current.cents, major }]);
    setAnswered(true);
    const nearer = current.cents === 350 ? 'exactly halfway' : current.cents < 350 ? 'nearer minor' : 'nearer major';
    setLast(reveal ? `That one was ${current.cents} cents (${nearer}).` : 'Recorded.');
  };

  const points = THIRD_STEPS.map((x) => {
    const at = trials.filter((t) => t.cents === x);
    return { x, n: at.length, p: at.length ? at.filter((t) => t.major).length / at.length : NaN };
  });
  const have = points.filter((p) => p.n > 0);
  const b = trials.length >= 14 ? boundary(have.map((p) => ({ x: p.x, p: p.p }))) : null;
  const sx = scale(290, 410, 50, W - 20);
  const sy = scale(0, 1, 170, 24);
  const path = have.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)} ${sy(p.p)}`).join('');

  return (
    <>
      <div className="w-controls">
        <Segmented
          label="Notes"
          value={ctx}
          options={[
            { value: 'melodic', label: 'One after the other' },
            { value: 'harmonic', label: 'Together' },
          ]}
          onChange={(v) => setCtx(v)}
        />
        <button type="button" className={'w-chip' + (reveal ? ' is-on' : '')} onClick={() => setReveal(!reveal)}>
          Tell me each size
        </button>
      </div>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={next} label={answered ? 'Play the next one' : 'Skip to a new one'} />
        <button type="button" className="w-chip" disabled={!current} onClick={() => current && sound(current, ctx)}>
          Hear it again
        </button>
        <button type="button" className="w-quiz-btn il-answer" disabled={answered} onClick={() => answer(false)}>
          Minor third
        </button>
        <button type="button" className="w-quiz-btn il-answer" disabled={answered} onClick={() => answer(true)}>
          Major third
        </button>
      </div>
      <p className="w-note il-status" aria-live="polite">
        {last || (answered ? 'Press play for a new interval.' : 'Minor or major?')}
      </p>
      <svg className="w-plot" viewBox={`0 0 ${W} 210`} role="img" aria-label="Your identification curve: percentage answered major at each interval size">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={sx(290)} x2={sx(410)} y1={sy(v)} y2={sy(v)} className="stroke-grid" />
            <text x={sx(290) - 6} y={sy(v) + 4} textAnchor="end" className="il-tick-label">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <line x1={sx(350)} x2={sx(350)} y1={sy(0)} y2={sy(1)} className="il-mid" />
        <text x={sx(350) + 5} y={sy(1) + 12} className="il-tick-label">
          halfway
        </text>
        {THIRD_STEPS.map((x) => (
          <text key={x} x={sx(x)} y={192} textAnchor="middle" className="il-tick-label">
            {x}¢
          </text>
        ))}
        <text x={sx(300)} y={206} textAnchor="middle" className="il-cents-label">
          minor third
        </text>
        <text x={sx(400)} y={206} textAnchor="middle" className="il-cents-label">
          major third
        </text>
        <text x={14} y={sy(0.5)} className="il-cents-label" transform={`rotate(-90 14 ${sy(0.5)})`} textAnchor="middle">
          answered “major”
        </text>
        {path && <path d={path} className="il-curve" />}
        {have.map((p) => (
          <g key={p.x}>
            <circle cx={sx(p.x)} cy={sy(p.p)} r={5} className="tone-a" />
            <text x={sx(p.x)} y={sy(p.p) - 9} textAnchor="middle" className="il-tick-label">
              {p.n}
            </text>
          </g>
        ))}
        {b !== null && <line x1={sx(b)} x2={sx(b)} y1={sy(0)} y2={sy(1)} className="il-total" />}
        {!trials.length && (
          <text x={sx(318)} y={sy(0.75)} textAnchor="middle" className="il-hint">
            Your answers will appear here
          </text>
        )}
      </svg>
      <div className="w-readouts">
        <Readout label="Answers">{trials.length}</Readout>
        <Readout label="Your boundary">{b !== null ? `about ${Math.round(b)} cents` : trials.length < 14 ? 'answer at least 14' : 'no clear crossing yet'}</Readout>
        <button type="button" className="w-chip" disabled={!trials.length} onClick={() => { setTrials([]); setLast(''); }}>
          Start over
        </button>
      </div>
    </>
  );
}

// ---------- tune ----------
type Target = 'P5' | 'M3' | 'P8' | 'P8m';
const TARGETS: Record<Target, { label: string; et: number; just: number; root: number; melodic: boolean; justText: string }> = {
  P5: { label: 'Fifth, together', et: 700, just: 702, root: 220, melodic: false, justText: '3/2' },
  M3: { label: 'Major third, together', et: 400, just: 386.3, root: 261.63, melodic: false, justText: '5/4' },
  P8: { label: 'Octave, together', et: 1200, just: 1200, root: 220, melodic: false, justText: '2/1' },
  P8m: { label: 'Octave, pure tones in turn', et: 1200, just: 1200, root: 330, melodic: true, justText: '2/1' },
};
const RANGE = 80;

function Tune() {
  const [target, setTarget] = useState<Target>('P5');
  const [offset, setOffset] = useState(45); // cents from equal temperament
  // The slider's centre is moved by a hidden amount each round, so the
  // thumb's position doesn't give away which way the note is out of tune.
  const [shift, setShift] = useState(-17);
  const [done, setDone] = useState(false);
  const [history, setHistory] = useState<Record<Target, number[]>>({ P5: [], M3: [], P8: [], P8m: [] });
  const [playing, setPlaying] = useState(false);
  const voices = useRef<AdditiveVoice[] | null>(null);
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const live = useRef({ target, offset });
  live.current = { target, offset };
  const T = TARGETS[target];

  const stop = useCallback(() => {
    voices.current?.forEach((v) => v.stop());
    voices.current = null;
    run.current?.stop(0.06);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const upper = (t: Target, off: number) => TARGETS[t].root * 2 ** ((TARGETS[t].et + off) / 1200);

  const start = (t: Target) => {
    stop();
    const tg = TARGETS[t];
    if (!tg.melodic) {
      const sp = harmonic(8);
      voices.current = [new AdditiveVoice(sp, tg.root, 0.45), new AdditiveVoice(sp, upper(t, live.current.offset), 0.45)];
      voices.current.forEach((v) => v.start());
    } else {
      const r = startRun(0.08);
      run.current = r;
      cancel.current = loop(r, (time, i) => {
        const { target: tt, offset: off } = live.current;
        const f = i % 2 ? upper(tt, off) : TARGETS[tt].root;
        note(r, { f, t: time, dur: 0.45, gain: 0.22, wave: 'sine', attack: 0.03, release: 0.12 });
        return i % 2 ? 0.8 : 0.6;
      });
    }
    setPlaying(true);
  };

  const toggle = () => (playing ? stop() : start(target));
  const change = (v: number) => {
    const o = Math.max(-RANGE - 40, Math.min(RANGE + 40, v));
    setOffset(o);
    if (voices.current) voices.current[1].setF0(upper(target, o));
  };
  const newRound = (t: Target = target) => {
    const sign = Math.random() < 0.5 ? -1 : 1;
    const o = sign * (25 + Math.random() * 40);
    setOffset(o);
    const sh = Math.round((Math.random() * 2 - 1) * 35);
    setShift(Math.max(o - 75, Math.min(o + 75, sh)));
    setDone(false);
    if (voices.current) voices.current[1].setF0(upper(t, o));
  };
  const pickTarget = (t: Target) => {
    setTarget(t);
    newRound(t);
    if (playing) start(t);
  };
  const finish = () => {
    setDone(true);
    setHistory({ ...history, [target]: [...history[target], T.et + offset] });
  };
  useEffect(() => stop, [stop]);

  const yours = T.et + offset;
  const sx = scale(T.et - 30, T.et + 30, 30, W - 30);
  const hist = history[target];
  const clampX = (c: number) => sx(Math.max(T.et - 30, Math.min(T.et + 30, c)));
  const avg = hist.length ? hist.reduce((s, c) => s + c, 0) / hist.length : null;
  const fmt = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}`;

  return (
    <>
      <div className="w-controls">
        <Segmented label="Interval" value={target} options={(Object.keys(TARGETS) as Target[]).map((k) => ({ value: k, label: TARGETS[k].label }))} onChange={pickTarget} />
      </div>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        <Slider label="Upper note" value={offset - shift} min={-RANGE} max={RANGE} step={0.5} onChange={(v) => change(v + shift)} display={done ? `${fmt(offset)}¢` : '?'} />
        <div className="w-chips" role="group" aria-label="Fine tuning">
          {[-5, -1, 1, 5].map((d) => (
            <button type="button" key={d} className="w-chip" onClick={() => change(offset + d)}>
              {d > 0 ? `+${d}` : `−${-d}`}
            </button>
          ))}
        </div>
      </div>
      <div className="w-controls">
        <button type="button" className="w-chip is-on" disabled={done} onClick={finish}>
          Done: show me
        </button>
        <button type="button" className="w-chip" onClick={() => newRound()}>
          New round
        </button>
      </div>
      <svg className="w-plot" viewBox={`0 0 ${W} 110`} role="img" aria-label="Your tuning settings compared with the just and equal-tempered sizes">
        <line x1={sx(T.et - 30)} x2={sx(T.et + 30)} y1={60} y2={60} className="il-axis" />
        {[-30, -20, -10, 0, 10, 20, 30].map((d) => (
          <g key={d}>
            <line x1={sx(T.et + d)} x2={sx(T.et + d)} y1={56} y2={64} className="il-axis" />
            <text x={sx(T.et + d)} y={80} textAnchor="middle" className="il-tick-label">
              {T.et + d}¢
            </text>
          </g>
        ))}
        <line x1={sx(T.et)} x2={sx(T.et)} y1={30} y2={60} className="il-et" />
        <text x={sx(T.et) + (T.just > T.et ? -5 : 5)} y={36} textAnchor={T.just > T.et ? 'end' : 'start'} className="il-cents-label">
          equal
        </text>
        {Math.abs(T.just - T.et) > 0.5 ? (
          <g>
            <line x1={sx(T.just)} x2={sx(T.just)} y1={30} y2={60} className="il-just" />
            <text x={sx(T.just) + (T.just > T.et ? 5 : -5)} y={36} textAnchor={T.just > T.et ? 'start' : 'end'} className="il-just-label">
              just {T.justText}
            </text>
          </g>
        ) : (
          <text x={sx(T.et)} y={12} textAnchor="middle" className="il-just-label">
            just {T.justText} is the same
          </text>
        )}
        {hist.map((c, i) => (
          <circle key={i} cx={clampX(c)} cy={60} r={5} className={i === hist.length - 1 && done ? 'tone-b' : 'il-past'} />
        ))}
        <text x={W / 2} y={102} textAnchor="middle" className="il-hint-small">
          {hist.length ? `${hist.length} setting${hist.length > 1 ? 's' : ''}; the newest is orange` : 'Your settings will appear here'}
        </text>
      </svg>
      <div className="w-readouts">
        {done ? (
          <>
            <Readout label="You set">{yours.toFixed(1)}¢</Readout>
            <Readout label="From just">{fmt(yours - T.just)}¢</Readout>
            <Readout label="From equal">{fmt(yours - T.et)}¢</Readout>
          </>
        ) : (
          <Readout label="Your setting">hidden until you press Done</Readout>
        )}
        {avg !== null && hist.length > 1 && <Readout label="Your average">{avg.toFixed(1)}¢</Readout>}
      </div>
    </>
  );
}

export default function IntervalLab(props: { initialMode?: IntervalMode; modes?: IntervalMode[] }) {
  const modes = props.modes ?? (['stack', 'categories', 'tune'] as IntervalMode[]);
  const [mode, setMode] = useState<IntervalMode>(props.initialMode ?? modes[0]);
  return (
    <Widget kicker="Lab" title={TITLES[mode]} caption={CAPTIONS[mode]}>
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented label="View" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
        </div>
      )}
      {mode === 'stack' && <Stack />}
      {mode === 'categories' && <Categories />}
      {mode === 'tune' && <Tune />}
    </Widget>
  );
}

