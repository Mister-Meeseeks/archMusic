// Polyrhythm, polymeter, and phasing. Three labs:
//
// - "ratio": two pulses dividing one cycle into n and m equal parts. A clock
//   face shows both pulses around one cycle; the grid shows them on the
//   smallest common grid (lcm(n, m) cells) with the composite rhythm below.
// - "polymeter": a short figure (loop A) repeating over a bar (loop B, kick
//   and hi-hat) on the same step pulse. Different lengths drift apart and
//   line up again every lcm(a, b) steps.
// - "phase": a 12-pulse pattern against a copy of itself (one in each ear).
//   The copy moves ahead gradually, pausing at each whole-pulse offset (the
//   Piano Phase process), or jumps one pulse every few cycles (the Clapping
//   Music process).
//
// Everything drawn comes from the same state that schedules the audio.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { harmonicWave, loop, startRun, type Run } from '../../lib/sequence';
import { playDrum } from '../../lib/rhythm';
import {
  METERS,
  PHASE_PATTERNS,
  RATIOS,
  compositeGaps,
  lcm,
  midiHz,
  phaseComposite,
  ratioGrid,
} from '../../lib/polyrhythm';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Mode = 'ratio' | 'polymeter' | 'phase';
type Lead = 'equal' | 'a' | 'b';

// ---------- sounds ----------

function panned(run: Run, pan: number): AudioNode {
  const p = run.ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(run.bus);
  return p;
}

/** High wooden "tok" (pulse A). */
function tok(run: Run, t: number, vel: number, dest: AudioNode, hi = false) {
  if (vel <= 0) return;
  const { ctx } = run;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  const f = hi ? 1480 : 1250;
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.88, t + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.42 * vel, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.1);
}

/** Low hand-drum "dum" (pulse B). */
function dum(run: Run, t: number, vel: number, dest: AudioNode) {
  if (vel <= 0) return;
  const { ctx } = run;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(175, t);
  o.frequency.exponentialRampToValueAtTime(115, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.75 * vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.25);
}

/** A hand clap: a few quick noise bursts through a band-pass. */
function clap(run: Run, t: number, vel: number, dest: AudioNode, centre: number) {
  const { ctx } = run;
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const s = i / ctx.sampleRate;
    // three short bursts then a tail
    const burst = s < 0.03 ? Math.exp(-((s % 0.01) / 0.002)) : 0;
    const tail = s >= 0.02 ? Math.exp(-(s - 0.02) / 0.03) : 0;
    d[i] = (Math.random() * 2 - 1) * Math.max(burst, tail * 0.8);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = centre;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 2.2 * vel;
  src.connect(bp).connect(g).connect(dest);
  src.start(t);
}

/** A short plucked piano-ish note. */
function pluck(run: Run, t: number, f: number, dest: AudioNode, dur: number) {
  const { ctx } = run;
  const o = ctx.createOscillator();
  o.setPeriodicWave(harmonicWave(ctx, 8, 1.6));
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, dur * 1.6));
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + Math.max(0.14, dur * 1.7));
}

// ---------- the lab ----------

type PhaseMark = { t: number; k: number; phi: number; held: boolean };

export default function PolyrhythmLab(props: {
  initialMode?: Mode;
  /** Which labs to offer (default: all three). */
  modes?: Mode[];
  /** Starting ratio for the ratio lab, e.g. "3:2". */
  ratio?: string;
  /** Hide the n and m sliders, offering only the preset buttons. */
  presetsOnly?: boolean;
  /** Starting preset id for the polymeter lab. */
  meter?: string;
  /** Starting pattern id for the phase lab ('melody' | 'bell'). */
  pattern?: string;
  /** Starting phase method. */
  method?: 'drift' | 'steps';
  title?: string;
}) {
  const offeredModes = props.modes ?? ['ratio', 'polymeter', 'phase'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? offeredModes[0]);
  const startRatio = RATIOS.find((r) => r.id === props.ratio) ?? RATIOS[0];

  // ratio lab
  const [n, setN] = useState(startRatio.n);
  const [m, setM] = useState(startRatio.m);
  const [cycle, setCycle] = useState(1.6); // seconds per cycle
  const [muteA, setMuteA] = useState(false);
  const [muteB, setMuteB] = useState(false);
  const [lead, setLead] = useState<Lead>('equal');

  // polymeter lab
  const startMeter = METERS.find((p) => p.id === props.meter) ?? METERS[0];
  const [meterId, setMeterId] = useState(startMeter.id);
  const [figA, setFigA] = useState<(0 | 1 | 2)[]>(startMeter.a);
  const [barB, setBarB] = useState(startMeter.b);
  const [stepMs, setStepMs] = useState(170);
  const [muteFig, setMuteFig] = useState(false);
  const [muteBar, setMuteBar] = useState(false);

  // phase lab
  const [patId, setPatId] = useState(props.pattern ?? 'melody');
  const [method, setMethod] = useState<'drift' | 'steps'>(props.method ?? 'drift');
  const [driftCycles, setDriftCycles] = useState(6); // cycles per one-pulse drift
  const [holdCycles, setHoldCycles] = useState(4); // cycles to hold each whole offset
  const [shiftEvery, setShiftEvery] = useState(4); // cycles between sudden shifts
  const [pulseMs, setPulseMs] = useState(150);

  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null); // ratio: fractional cycle position; polymeter: step index
  const [phaseNow, setPhaseNow] = useState<{ phi: number; held: boolean; k: number } | null>(null);

  const grid = useMemo(() => ratioGrid(n, m), [n, m]);
  const pat = PHASE_PATTERNS.find((p) => p.id === patId) ?? PHASE_PATTERNS[0];

  const live = useRef({ mode, n, m, cycle, muteA, muteB, lead, figA, barB, stepMs, muteFig, muteBar, pat, method, driftCycles, holdCycles, shiftEvery, pulseMs });
  live.current = { mode, n, m, cycle, muteA, muteB, lead, figA, barB, stepMs, muteFig, muteBar, pat, method, driftCycles, holdCycles, shiftEvery, pulseMs };

  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const marks = useRef<{ t: number; v: number; dur: number }[]>([]);
  const pmarks = useRef<PhaseMark[]>([]);
  const phaseState = useRef({ phi: 0, hold: 0, target: 1, nextJ: 0, sinceShift: 0 });
  const raf = useRef(0);

  const stop = useCallback(() => {
    run.current?.stop(0.05);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    cancelAnimationFrame(raf.current);
    marks.current = [];
    pmarks.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, stop]);

  const resetPhase = () => {
    const st = phaseState.current;
    // Unison = any whole number of cycles of offset. Jump forward to the next
    // one so the scheduler's pattern indices stay consistent mid-play.
    const N = 12;
    st.phi = Math.ceil(st.phi / N - 1e-9) * N;
    st.target = st.phi + 1;
    st.hold = holdCycles * N;
    st.sinceShift = 0;
    setPhaseNow(run.current ? { phi: 0, held: true, k: 0 } : null);
  };

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1, 0.85);
    run.current = r;
    marks.current = [];
    pmarks.current = [];
    const left = panned(r, -0.35);
    const right = panned(r, 0.35);
    const hardL = panned(r, -0.7);
    const hardR = panned(r, 0.7);
    const st = phaseState.current;
    // restart the phase process from where it is, at the start of a cycle
    st.nextJ = Math.ceil(st.phi - 1e-9);
    st.sinceShift = 0;
    // start (or resume) by sitting at the current whole-pulse offset for a while
    if (Math.abs(st.phi - Math.round(st.phi)) < 1e-9) st.hold = live.current.holdCycles * 12;
    let pulseK = 0;

    cancel.current = loop(r, (t, i) => {
      const p = live.current;
      if (p.mode === 'ratio') {
        const g = ratioGrid(p.n, p.m);
        const c = i % g.cells;
        const dur = p.cycle / g.cells;
        const va = p.lead === 'b' ? 0.45 : p.lead === 'a' ? 1 : 0.75;
        const vb = p.lead === 'a' ? 0.45 : p.lead === 'b' ? 1 : 0.75;
        const down = c === 0;
        if (g.a[c] && !p.muteA) tok(r, t, down ? va : va * 0.85, left, down);
        if (g.b[c] && !p.muteB) dum(r, t, down ? vb : vb * 0.85, right);
        marks.current.push({ t, v: c / g.cells, dur: p.cycle });
        if (marks.current.length > 200) marks.current.splice(0, 100);
        return dur;
      }
      if (p.mode === 'polymeter') {
        const la = p.figA.length;
        const a = p.figA[i % la];
        if (a && !p.muteFig) tok(r, t, a === 2 ? 1 : 0.6, left, a === 2);
        if (!p.muteBar) {
          if (i % p.barB === 0) playDrum('kick', t, 0.9, right);
          playDrum('hat', t, i % p.barB === 0 ? 0.7 : 0.4, right);
        }
        marks.current.push({ t, v: i, dur: p.stepMs / 1000 });
        if (marks.current.length > 200) marks.current.splice(0, 100);
        return p.stepMs / 1000;
      }
      // phase: one call per pulse of the steady part
      const s = p.pulseMs / 1000;
      const N = p.pat.onsets.length;
      const k = pulseK++;
      const kc = k % N;
      // steady part (left)
      if (p.pat.onsets[kc]) {
        if (p.pat.midi) pluck(r, t, midiHz(p.pat.midi[kc]), hardL, s);
        else clap(r, t, 0.9, hardL, 1150);
      }
      // advance the moving part. phi is kept unwrapped (it only grows), so
      // absolute pattern indices stay consistent; it's shown modulo N.
      if (p.method === 'drift') {
        if (st.hold > 0) st.hold--;
        else {
          st.phi += 1 / (N * p.driftCycles);
          if (st.phi >= st.target - 1e-9) {
            st.phi = st.target;
            st.hold = p.holdCycles * N;
            st.target += 1;
          }
        }
      } else if (kc === 0 && k > 0) {
        // Clapping Music: jump one pulse at the start of a cycle, every few cycles
        st.sinceShift++;
        if (st.sinceShift >= p.shiftEvery) {
          st.sinceShift = 0;
          st.phi = Math.round(st.phi) + 1;
          st.target = st.phi + 1;
        }
      }
      // the moving part (right) plays pattern element J at steady-part position J - phi
      st.nextJ = Math.max(st.nextJ, Math.ceil(k + st.phi - 1e-9));
      while (st.nextJ - st.phi < k + 1 - 1e-9) {
        const pos = Math.max(0, st.nextJ - st.phi - k);
        const j = ((st.nextJ % N) + N) % N;
        const tj = t + pos * s;
        if (p.pat.onsets[j]) {
          if (p.pat.midi) pluck(r, tj, midiHz(p.pat.midi[j]), hardR, s);
          else clap(r, tj, 0.9, hardR, 1500);
        }
        st.nextJ++;
      }
      pmarks.current.push({ t, k, phi: st.phi % N, held: p.method === 'drift' ? st.hold > 0 || Math.abs(st.phi - Math.round(st.phi)) < 1e-9 : true });
      if (pmarks.current.length > 300) pmarks.current.splice(0, 150);
      return s;
    });

    const frame = () => {
      if (!run.current) return;
      const tnow = r.ctx.currentTime;
      const lm = live.current.mode;
      if (lm === 'phase') {
        let cur: PhaseMark | null = null;
        for (const x of pmarks.current) if (x.t <= tnow) cur = x;
        if (cur) setPhaseNow({ phi: cur.phi, held: cur.held, k: cur.k });
      } else {
        let cur: { t: number; v: number; dur: number } | null = null;
        for (const x of marks.current) if (x.t <= tnow) cur = x;
        if (cur) {
          if (lm === 'ratio') setNow(cur.v + (tnow - cur.t) / cur.dur);
          else setNow(cur.v);
        }
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  const chooseMeter = (id: string) => {
    const p = METERS.find((x) => x.id === id)!;
    setMeterId(id);
    setFigA(p.a);
    setBarB(p.b);
  };
  const meter = METERS.find((p) => p.id === meterId) ?? METERS[0];
  const figEdited = figA.length !== meter.a.length || figA.some((v, i) => v !== meter.a[i]) || barB !== meter.b;

  const titles: Record<Mode, string> = {
    ratio: 'Two pulses at once',
    polymeter: 'Loops of different lengths',
    phase: 'Out of phase',
  };

  const captions: Record<Mode, ReactNode> = {
    ratio: (
      <>
        Two steady pulses share one cycle. The <span className="tone-a-text">high tok</span> (left ear) divides it
        into <strong>A</strong> equal parts and the <span className="tone-b-text">low drum</span> (right ear) into{' '}
        <strong>B</strong>. The clock face shows one trip around the cycle; the grid spreads the same cycle over the
        smallest grid that holds both pulses (A × B cells when they share no common factor). The bottom row is what
        you actually hear: the composite rhythm. <strong>Lead with</strong> makes one pulse louder, which tends to
        make it the beat.
      </>
    ),
    polymeter: (
      <>
        Both loops step at the same speed. The <span className="tone-a-text">figure</span> (wood blocks, left) repeats
        every few steps; the <span className="tone-b-text">bar</span> (kick and hi-hat, right) repeats every 4, 8, or
        16. Shaded blocks mark each repeat of each loop. Where both loops start together, a line marks the point
        where they line up again. Click the figure's cells to edit it; the grid scrolls one page at a time for long
        cycles.
      </>
    ),
    phase: (
      <>
        Two identical 12-pulse patterns, one in each ear. The top row stays put. The bottom row is the moving copy,
        drawn shifted by how far ahead it is. In <strong>Gradual drift</strong>, the copy speeds up slightly until it
        is exactly one pulse ahead, holds there for a few cycles, then drifts again (the process of Reich's{' '}
        <em>Piano Phase</em>). In <strong>Sudden steps</strong>, it jumps one pulse ahead every few cycles (the process
        of <em>Clapping Music</em>, though with a different pattern). After twelve pulses of offset the two are back
        in unison.
      </>
    ),
  };

  return (
    <Widget kicker="Lab" title={props.title ?? titles[mode]} caption={captions[mode]}>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        {offeredModes.length > 1 && (
          <Segmented
            label="Lab"
            value={mode}
            options={offeredModes.map((v) => ({ value: v, label: v === 'ratio' ? 'Polyrhythm' : v === 'polymeter' ? 'Polymeter' : 'Phasing' }))}
            onChange={setMode}
          />
        )}
      </div>

      {mode === 'ratio' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Ratio"
              value={`${n}:${m}`}
              options={RATIOS.map((r) => ({ value: r.id, label: r.label }))}
              onChange={(id) => {
                const p = RATIOS.find((r) => r.id === id)!;
                setN(p.n);
                setM(p.m);
              }}
            />
          </div>
          {!props.presetsOnly && (
            <div className="w-controls">
              <Slider label="A (high)" min={1} max={8} step={1} value={n} onChange={setN} display={`${n} per cycle`} />
              <Slider label="B (low)" min={1} max={8} step={1} value={m} onChange={setM} display={`${m} per cycle`} />
            </div>
          )}
          <RatioView n={n} m={m} grid={grid} now={now} muteA={muteA} muteB={muteB} />
          <div className="w-controls">
            <div className="w-chips">
              <button type="button" className={'w-chip' + (muteA ? '' : ' is-on')} aria-pressed={!muteA} onClick={() => setMuteA((v) => !v)}>
                Pulse A
              </button>
              <button type="button" className={'w-chip' + (muteB ? '' : ' is-on')} aria-pressed={!muteB} onClick={() => setMuteB((v) => !v)}>
                Pulse B
              </button>
            </div>
            <Segmented
              label="Lead with"
              value={lead}
              options={[
                { value: 'equal', label: 'Neither' },
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ]}
              onChange={setLead}
            />
            <Slider label="Cycle" min={0.8} max={4} step={0.1} value={cycle} onChange={setCycle} display={`${cycle.toFixed(1)} s`} />
          </div>
          <div className="w-readouts">
            <Readout label="Pulse A">{Math.round((cycle * 1000) / n)} ms apart</Readout>
            <Readout label="Pulse B">{Math.round((cycle * 1000) / m)} ms apart</Readout>
            <Readout label="Composite">
              {grid.onsets} notes per cycle, gaps {compositeGaps(grid).join('-')} (in grid cells)
            </Readout>
            <Readout label="Either pulse could be the beat?">
              {[n, m]
                .map((k, i) => {
                  const ms = (cycle * 1000) / k;
                  return `${i ? 'B' : 'A'} ${ms >= 200 && ms <= 1800 ? 'yes' : ms < 200 ? 'too fast' : 'too slow'}`;
                })
                .join(', ')}
            </Readout>
          </div>
        </>
      )}

      {mode === 'polymeter' && (
        <>
          <div className="w-controls">
            <Segmented label="Pattern" value={meterId} options={METERS.map((p) => ({ value: p.id, label: p.label }))} onChange={chooseMeter} />
          </div>
          <p className="w-note">
            {meter.blurb}
            {figEdited && (
              <>
                {' '}
                <button type="button" className="w-chip" onClick={() => chooseMeter(meterId)}>
                  reset
                </button>
              </>
            )}
          </p>
          <MeterView
            fig={figA}
            bar={barB}
            now={now}
            onCell={(i) => setFigA((f) => f.map((v, k) => (k === i ? (((v + 1) % 3) as 0 | 1 | 2) : v)))}
          />
          <div className="w-controls">
            <Slider
              label="Figure length"
              min={2}
              max={16}
              step={1}
              value={figA.length}
              onChange={(len) => setFigA((f) => (len > f.length ? [...f, ...Array(len - f.length).fill(0)] : f.slice(0, len)))}
              display={`${figA.length} steps`}
            />
            <Segmented
              label="Bar"
              value={barB}
              options={[
                { value: 4, label: '4' },
                { value: 8, label: '8' },
                { value: 16, label: '16' },
              ]}
              onChange={setBarB}
            />
          </div>
          <div className="w-controls">
            <div className="w-chips">
              <button type="button" className={'w-chip' + (muteFig ? '' : ' is-on')} aria-pressed={!muteFig} onClick={() => setMuteFig((v) => !v)}>
                Figure
              </button>
              <button type="button" className={'w-chip' + (muteBar ? '' : ' is-on')} aria-pressed={!muteBar} onClick={() => setMuteBar((v) => !v)}>
                Bar
              </button>
            </div>
            <Slider label="Speed" min={90} max={300} step={5} value={stepMs} onChange={setStepMs} display={`${stepMs} ms per step`} />
          </div>
          <div className="w-readouts">
            <Readout label="Lines up again every">
              {lcm(figA.length, barB)} steps = {lcm(figA.length, barB) / figA.length} figures = {lcm(figA.length, barB) / barB} bar
              {lcm(figA.length, barB) / barB === 1 ? '' : 's'} ({((lcm(figA.length, barB) * stepMs) / 1000).toFixed(1)} s)
            </Readout>
            <Readout label="Now">
              {now === null
                ? 'press Play'
                : `bar ${Math.floor(now / barB) + 1}, figure ${Math.floor(now / figA.length) + 1}${now % lcm(figA.length, barB) === 0 ? ' · together' : ''}`}
            </Readout>
          </div>
        </>
      )}

      {mode === 'phase' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Pattern"
              value={patId}
              options={PHASE_PATTERNS.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(id) => {
                setPatId(id);
                resetPhase();
              }}
            />
            <Segmented
              label="Process"
              value={method}
              options={[
                { value: 'drift', label: 'Gradual drift' },
                { value: 'steps', label: 'Sudden steps' },
              ]}
              onChange={(v) => {
                setMethod(v);
                phaseState.current.phi = Math.floor(phaseState.current.phi + 1e-9);
                phaseState.current.target = phaseState.current.phi + 1;
                phaseState.current.hold = 0;
              }}
            />
          </div>
          <p className="w-note">{pat.blurb}</p>
          <PhaseView onsets={pat.onsets} midi={pat.midi} state={phaseNow} />
          <div className="w-controls">
            {method === 'drift' ? (
              <>
                <Slider
                  label="Drift"
                  min={2}
                  max={16}
                  step={1}
                  value={driftCycles}
                  onChange={setDriftCycles}
                  display={`1 pulse per ${driftCycles} cycles`}
                />
                <Slider label="Hold" min={0} max={8} step={1} value={holdCycles} onChange={setHoldCycles} display={holdCycles ? `${holdCycles} cycles` : 'no pause'} />
              </>
            ) : (
              <Slider label="Shift every" min={1} max={12} step={1} value={shiftEvery} onChange={setShiftEvery} display={`${shiftEvery} cycles`} />
            )}
            <Slider label="Speed" min={110} max={300} step={5} value={pulseMs} onChange={setPulseMs} display={`${pulseMs} ms per pulse`} />
            <button type="button" className="w-chip" onClick={resetPhase}>
              Back to unison
            </button>
          </div>
          <div className="w-readouts">
            <Readout label="Moving part is ahead by">
              {phaseNow ? `${phaseNow.phi.toFixed(phaseNow.held ? 0 : 2)} of 12 pulses` : 'press Play'}
            </Readout>
            <Readout label="State">
              {!phaseNow
                ? '—'
                : Math.abs(phaseNow.phi) < 1e-6 || Math.abs(phaseNow.phi - 12) < 1e-6
                  ? 'unison'
                  : phaseNow.held
                    ? `locked, ${Math.round(phaseNow.phi)} pulse${Math.round(phaseNow.phi) === 1 ? '' : 's'} apart`
                    : 'drifting: the parts blur'}
            </Readout>
            {phaseNow && phaseNow.held && (
              <Readout label="Together">
                {(() => {
                  const c = phaseComposite(pat.onsets, Math.round(phaseNow.phi));
                  return `${c.union} of 12 pulses sound; ${c.together} struck by both`;
                })()}
              </Readout>
            )}
          </div>
        </>
      )}
    </Widget>
  );
}

// ---------- views ----------

function RatioView(props: { n: number; m: number; grid: ReturnType<typeof ratioGrid>; now: number | null; muteA: boolean; muteB: boolean }) {
  const { n, m, grid, now } = props;
  const W = 680;
  const H = 220;
  const CX = 112;
  const CY = 110;
  const RA = 86;
  const RB = 56;
  const ang = (f: number) => f * 2 * Math.PI - Math.PI / 2;
  const frac = now === null ? null : now - Math.floor(now);
  const lit = (k: number, count: number) => {
    if (frac === null) return false;
    const pos = k / count;
    const d = frac - pos;
    return d >= 0 && d < 0.09;
  };
  const GX0 = 268;
  const GX1 = 664;
  const cw = (GX1 - GX0) / grid.cells;
  const rows = [
    { y: 52, label: `A: ${n}`, on: grid.a, cls: 'tone-a', muted: props.muteA },
    { y: 104, label: `B: ${m}`, on: grid.b, cls: 'tone-b', muted: props.muteB },
  ];
  const cur = frac === null ? null : Math.floor(frac * grid.cells);
  const rad = Math.max(2.5, Math.min(8, cw * 0.36));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label={`${n} against ${m}: a clock face and a grid of the two pulses and their composite rhythm`}>
      {/* clock face */}
      <circle cx={CX} cy={CY} r={RA} className="stroke-grid" fill="none" />
      <circle cx={CX} cy={CY} r={RB} className="stroke-grid" fill="none" />
      {Array.from({ length: n }, (_, k) => {
        const a = ang(k / n);
        return (
          <g key={`a${k}`} opacity={props.muteA ? 0.3 : 1}>
            <line x1={r2(CX)} y1={r2(CY)} x2={r2(CX + RA * Math.cos(a))} y2={r2(CY + RA * Math.sin(a))} className="stroke-grid" />
            <circle cx={r2(CX + RA * Math.cos(a))} cy={r2(CY + RA * Math.sin(a))} r={lit(k, n) ? 11 : 8} className="tone-a" />
          </g>
        );
      })}
      {Array.from({ length: m }, (_, k) => {
        const a = ang(k / m);
        const x = CX + RB * Math.cos(a);
        const y = CY + RB * Math.sin(a);
        const s = lit(k, m) ? 10 : 7;
        return <rect key={`b${k}`} x={r2(x - s)} y={r2(y - s)} width={s * 2} height={s * 2} rx={2} className="tone-b" opacity={props.muteB ? 0.3 : 1} />;
      })}
      {frac !== null && (
        <line x1={CX} y1={CY} x2={r2(CX + (RA + 10) * Math.cos(ang(frac)))} y2={r2(CY + (RA + 10) * Math.sin(ang(frac)))} className="stroke-ink" strokeWidth={2} />
      )}
      <circle cx={CX} cy={CY} r={3} className="fill-ink" />
      <text x={CX} y={CY + RA + 22} textAnchor="middle" className="w-tick">
        one cycle
      </text>

      {/* grid */}
      {cur !== null && <rect x={r2(GX0 + cur * cw)} y={30} width={r2(cw)} height={162} className="fill-band" />}
      {Array.from({ length: grid.cells + 1 }, (_, c) => (
        <line key={c} x1={r2(GX0 + c * cw)} x2={r2(GX0 + c * cw)} y1={34} y2={186} className="stroke-grid" />
      ))}
      {rows.map((row) => (
        <g key={row.label} opacity={row.muted ? 0.3 : 1}>
          <text x={GX0 - 10} y={row.y + 4} textAnchor="end" className="poly-label">
            {row.label}
          </text>
          {row.on.map((on, c) =>
            on ? <circle key={c} cx={r2(GX0 + (c + 0.5) * cw)} cy={row.y} r={rad} className={row.cls} /> : null,
          )}
        </g>
      ))}
      <text x={GX0 - 10} y={160} textAnchor="end" className="poly-label">
        Heard
      </text>
      {grid.a.map((a, c) => {
        const b = grid.b[c] && !props.muteB;
        const aa = a && !props.muteA;
        if (!aa && !b) return null;
        const x = GX0 + (c + 0.5) * cw;
        return (
          <g key={c}>
            {aa && b ? (
              <>
                <circle cx={r2(x)} cy={156} r={rad + 1.5} className="tone-b" />
                <circle cx={r2(x)} cy={156} r={rad * 0.6} className="tone-a" />
              </>
            ) : (
              <circle cx={r2(x)} cy={156} r={rad} className={aa ? 'tone-a' : 'tone-b'} />
            )}
          </g>
        );
      })}
      <text x={(GX0 + GX1) / 2} y={208} textAnchor="middle" className="w-tick">
        {grid.cells} cells per cycle
      </text>
    </svg>
  );
}

function MeterView(props: { fig: (0 | 1 | 2)[]; bar: number; now: number | null; onCell: (i: number) => void }) {
  const { fig, bar, now } = props;
  const la = fig.length;
  const total = lcm(la, bar);
  const PAGE = 48;
  const page = now === null ? 0 : Math.floor((now % total) / PAGE);
  const start = page * PAGE;
  const span = Math.min(PAGE, total - start);
  const W = 680;
  const X0 = 70;
  const X1 = 664;
  const cw = (X1 - X0) / Math.min(PAGE, total);
  const H = 150;
  const cur = now === null ? null : (now % total) - start;
  const rad = Math.max(2.5, Math.min(7, cw * 0.32));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot is-clickable" role="img" aria-label="A figure loop and a bar loop of different lengths on one step grid">
      {cur !== null && cur >= 0 && cur < span && <rect x={r2(X0 + cur * cw)} y={18} width={r2(cw)} height={104} className="fill-band" />}
      {Array.from({ length: span }, (_, k) => {
        const i = start + k;
        const x = X0 + k * cw;
        const fa = i % la;
        const fb = i % bar;
        const copyA = Math.floor(i / la) % 2;
        const copyB = Math.floor(i / bar) % 2;
        return (
          <g key={i}>
            <rect
              x={r2(x + 0.5)}
              y={26}
              width={r2(cw - 1)}
              height={34}
              rx={2}
              className={copyA ? 'poly-cell-a2' : 'poly-cell-a'}
              onClick={() => props.onCell(fa)}
              style={{ cursor: 'pointer' }}
            />
            {fig[fa] > 0 && <circle cx={r2(x + cw / 2)} cy={43} r={fig[fa] === 2 ? rad + 1.5 : rad} className="tone-a" style={{ pointerEvents: 'none' }} />}
            <rect x={r2(x + 0.5)} y={76} width={r2(cw - 1)} height={34} rx={2} className={copyB ? 'poly-cell-b2' : 'poly-cell-b'} />
            {fb === 0 ? (
              <rect x={r2(x + cw / 2 - rad)} y={r2(93 - rad)} width={r2(rad * 2)} height={r2(rad * 2)} rx={1.5} className="tone-b" />
            ) : (
              <circle cx={r2(x + cw / 2)} cy={93} r={1.8} className="fill-ink" opacity={0.45} />
            )}
            {fa === 0 && <line x1={r2(x)} x2={r2(x)} y1={22} y2={64} className="stroke-a" strokeWidth={2} />}
            {fb === 0 && <line x1={r2(x)} x2={r2(x)} y1={72} y2={114} className="stroke-b" strokeWidth={2} />}
            {i % total === 0 && <line x1={r2(x)} x2={r2(x)} y1={14} y2={124} className="stroke-ink" strokeWidth={2.5} />}
          </g>
        );
      })}
      <text x={X0 - 10} y={47} textAnchor="end" className="poly-label">
        Figure: {la}
      </text>
      <text x={X0 - 10} y={97} textAnchor="end" className="poly-label">
        Bar: {bar}
      </text>
      <text x={X0} y={140} className="w-tick">
        steps {start + 1}–{start + span} of {total}
        {total > PAGE ? ` (page ${page + 1} of ${Math.ceil(total / PAGE)})` : ''}
      </text>
    </svg>
  );
}

function PhaseView(props: { onsets: boolean[]; midi?: number[]; state: { phi: number; held: boolean } | null }) {
  const { onsets, midi } = props;
  const N = onsets.length;
  const phi = props.state?.phi ?? 0;
  const W = 680;
  const X0 = 110;
  const X1 = 560;
  const cw = (X1 - X0) / N;
  const H = 180;
  const lo = midi ? Math.min(...midi) : 0;
  const hi = midi ? Math.max(...midi) : 1;
  const yOf = (base: number, j: number) => (midi ? base + 14 - ((midi[j] - lo) / Math.max(1, hi - lo)) * 28 : base);
  // The moving copy plays element j at position j - phi: draw it shifted left by phi (wrapping).
  const moving = Array.from({ length: N }, (_, j) => {
    let pos = j - phi;
    pos = ((pos % N) + N) % N;
    return { j, pos };
  });
  // dial
  const DX = 622;
  const DY = 90;
  const DR = 40;
  const a = (phi / N) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Two copies of a 12-pulse pattern, the lower one shifted by the current phase offset">
      {Array.from({ length: N + 1 }, (_, c) => (
        <line key={c} x1={r2(X0 + c * cw)} x2={r2(X0 + c * cw)} y1={20} y2={150} className="stroke-grid" />
      ))}
      <text x={X0 - 12} y={54} textAnchor="end" className="poly-label">
        Steady (L)
      </text>
      <text x={X0 - 12} y={118} textAnchor="end" className="poly-label">
        Moving (R)
      </text>
      {onsets.map((on, j) =>
        on ? <circle key={`s${j}`} cx={r2(X0 + (j + 0.5) * cw)} cy={r2(yOf(50, j))} r={7} className="tone-a" /> : <circle key={`s${j}`} cx={r2(X0 + (j + 0.5) * cw)} cy={50} r={2} className="fill-ink" opacity={0.3} />,
      )}
      {moving.map(({ j, pos }) => {
        const x = X0 + (pos + 0.5) * cw;
        const wrapX = x - N * cw; // ghost for the wrap-around edge
        const draw = (xx: number, key: string) =>
          onsets[j] ? <circle key={key} cx={r2(xx)} cy={r2(yOf(114, j))} r={7} className="tone-b" /> : <circle key={key} cx={r2(xx)} cy={114} r={2} className="fill-ink" opacity={0.3} />;
        return (
          <g key={`m${j}`}>
            {draw(x, 'm')}
            {pos > N - 0.5 && draw(wrapX, 'w')}
          </g>
        );
      })}
      <text x={X0} y={170} className="w-tick">
        pulse 1
      </text>
      <text x={X1} y={170} textAnchor="end" className="w-tick">
        pulse {N}
      </text>
      {/* phase dial */}
      <circle cx={DX} cy={DY} r={DR} className="stroke-grid" fill="none" />
      {Array.from({ length: N }, (_, k) => {
        const aa = (k / N) * 2 * Math.PI - Math.PI / 2;
        return <circle key={k} cx={r2(DX + DR * Math.cos(aa))} cy={r2(DY + DR * Math.sin(aa))} r={1.8} className="fill-ink" opacity={0.5} />;
      })}
      <line x1={DX} y1={DY} x2={r2(DX + (DR - 4) * Math.cos(a))} y2={r2(DY + (DR - 4) * Math.sin(a))} className="stroke-b" strokeWidth={3} />
      <circle cx={DX} cy={DY} r={3} className="fill-ink" />
      <text x={DX} y={DY + DR + 18} textAnchor="middle" className="w-tick">
        offset
      </text>
    </svg>
  );
}
