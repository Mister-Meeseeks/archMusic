// Scales and tuning systems, four ways (chapter 3.2).
//   fifths — stack pure 3:2 fifths from C and watch a scale appear: 5 notes
//            give a five-note scale, 7 the major-scale pattern, 12 the chromatic. The 13th
//            misses C by the Pythagorean comma, which you can hear.
//   keys   — five historical keyboard tunings. Pick a key and hear I–IV–V–I;
//            the bars show every fifth and major third on the keyboard, so
//            you can see where each tuning hides its error (and the wolf).
//   pump   — C–Am–Dm–G–C with every chord tuned pure and the shared notes
//            held: each trip round ends a syntonic comma (81:80) flat.
//   edo    — divide the octave into N equal steps and see how close the
//            nearest steps come to 3:2, 5:4, 6:5 and 7:4.
// Every number drawn comes from src/lib/temperament.ts, the same values the
// sound uses.

import { useCallback, useMemo, useRef, useState } from 'react';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import {
  C4,
  FIFTH,
  PC_NAMES,
  PYTHAGOREAN_COMMA,
  SYNTONIC_COMMA,
  TARGETS,
  TUNINGS,
  cents,
  checkTriad,
  circleFifths,
  commaPump,
  edoApprox,
  equalPump,
  freqOf,
  mod,
  pumpVoicing,
  scaleSteps,
  stackFifths,
  type TuningId,
} from '../../lib/temperament';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type LabMode = 'fifths' | 'keys' | 'pump' | 'edo';
const LAB_LABELS: Record<LabMode, string> = { fifths: 'Stacking fifths', keys: 'Tunings and keys', pump: 'The comma pump', edo: 'Equal divisions' };

type Ev = { t: number; dur: number; freqs: number[]; idx: number; gain?: number };

const STEP_NAMES: [number, string][] = [
  [294.1, 'gap of a minor third'],
  [203.9, 'whole tone'],
  [113.7, 'large half step'],
  [90.2, 'small half step'],
  [23.5, 'Pythagorean comma'],
];
const stepName = (s: number) => STEP_NAMES.find(([c]) => Math.abs(c - s) < 0.5)?.[1] ?? '';

const STACK_NOTE: Record<number, string> = {
  1: 'Just C. Add a fifth.',
  2: 'C and G: a fifth (folded into one octave, G sits 702¢ above C).',
  3: 'C, D, G. Already two sizes of gap.',
  4: 'C, D, G, A.',
  5: 'Five notes, C D E G A: a five-note scale with no half steps at all, found in folk music worldwide (chapter 3.4 calls it the pentatonic scale). Just two step sizes.',
  6: 'Six notes: B squeezes in, making the first half step.',
  7: 'Seven notes: C D E F♯ G A B. Five whole tones and two half steps: the step pattern of the major scale. (Starting the chain a fifth lower, on F, gives exactly the white keys.)',
  8: 'Eight notes: a third step size appears.',
  9: 'Nine notes.',
  10: 'Ten notes.',
  11: 'Eleven notes.',
  12: 'Twelve notes: the chromatic scale. Nearly even, but the half steps come in two sizes, 90¢ and 114¢.',
  13: 'The 13th fifth lands on B♯, which should be C. It overshoots by 23.5¢: the Pythagorean comma. The circle of fifths is really a spiral.',
};

const KEY_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // circle of fifths
const TUNING_ORDER: TuningId[] = ['pythagorean', 'just', 'meantone', 'werckmeister', 'equal'];
const EDO_PRESETS = [5, 7, 12, 17, 19, 22, 24, 31, 41, 53];

const sign = (v: number, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d));

export default function ScaleTuningLab(props: {
  initialMode?: LabMode;
  modes?: LabMode[];
  tuning?: TuningId;
  tunings?: TuningId[];
  keyPc?: number;
  edo?: number;
  title?: string;
}) {
  const modes = props.modes ?? (['fifths', 'keys', 'pump', 'edo'] as LabMode[]);
  const [lab, setLab] = useState<LabMode>(props.initialMode ?? modes[0]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [now, setNow] = useState(-1);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);

  // fifths
  const [count, setCount] = useState(7);
  // keys
  const tunings = props.tunings ?? TUNING_ORDER;
  const [tuning, setTuning] = useState<TuningId>(props.tuning ?? tunings[0]);
  const [keyPc, setKeyPc] = useState(props.keyPc ?? 0);
  // pump
  const [pure, setPure] = useState(true);
  const [cycles, setCycles] = useState(3);
  // edo
  const [edo, setEdo] = useState(props.edo ?? 12);

  const stop = useCallback(() => {
    run.current?.stop();
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(null);
    setNow(-1);
  }, []);
  useAudioOwner(playing !== null, stop);

  const play = (id: string, evs: Ev[]) => {
    stop();
    const r = startRun(0.08);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.2);
    let end = 0;
    for (const e of evs) {
      const g = (e.gain ?? 0.2) / Math.sqrt(Math.max(1, e.freqs.length));
      e.freqs.forEach((f) => note(r, { f, t: r.t0 + e.t, dur: e.dur, gain: g, attack: 0.03, release: 0.25, wave }));
      timers.current.push(window.setTimeout(() => setNow(e.idx), 80 + e.t * 1000));
      end = Math.max(end, e.t + e.dur);
    }
    timers.current.push(
      window.setTimeout(() => {
        if (run.current === r) stop();
      }, 80 + (end + 0.5) * 1000),
    );
    setPlaying(id);
  };
  const toggle = (id: string, make: () => Ev[]) => (playing === id ? stop() : play(id, make()));
  const switchLab = (m: LabMode) => {
    stop();
    setLab(m);
  };

  // ---------- fifths: derived ----------
  const stack = useMemo(() => stackFifths(count), [count]);
  const steps = useMemo(() => scaleSteps(stack), [stack]);
  const fifthsScale = (): Ev[] => {
    const sorted = steps.sorted;
    const evs: Ev[] = sorted.map((nt, i) => ({ t: i * 0.38, dur: 0.34, freqs: [C4 * 2 ** (nt.cents / 1200)], idx: nt.n }));
    evs.push({ t: sorted.length * 0.38, dur: 0.7, freqs: [C4 * 2], idx: 0 });
    return evs;
  };
  const fifthsChain = (): Ev[] =>
    stack.map((nt, i) => ({ t: i * 0.5, dur: 0.46, freqs: [C4 * 2 ** (nt.cents / 1200)], idx: nt.n }));
  const commaEvs = (): Ev[] => {
    const bs = C4 * 2 ** (PYTHAGOREAN_COMMA / 1200);
    return [
      { t: 0, dur: 1.1, freqs: [C4], idx: 0 },
      { t: 1.3, dur: 1.1, freqs: [bs], idx: 12 },
      { t: 2.7, dur: 4.5, freqs: [C4, bs], idx: 13, gain: 0.26 },
    ];
  };

  // ---------- keys: derived ----------
  const table = TUNINGS[tuning].table;
  const fifthsRing = useMemo(() => circleFifths(table), [table]);
  const thirds = useMemo(() => KEY_ORDER.map((pc) => checkTriad(table, pc)), [table]);
  const prog = [0, 5, 7, 0].map((s) => mod(keyPc + s, 12));
  const progChecks = prog.slice(0, 3).map((pc) => checkTriad(table, pc));
  const triad = (pc: number) => {
    const oct = pc <= 4 ? 4 : 3;
    return [freqOf(table, pc, oct - 1), freqOf(table, pc, oct), freqOf(table, pc + 4, oct), freqOf(table, pc + 7, oct)];
  };
  const progEvs = (): Ev[] => prog.map((pc, i) => ({ t: i * 1.5, dur: i === 3 ? 2.2 : 1.35, freqs: triad(pc), idx: i, gain: 0.3 }));
  const holdEvs = (): Ev[] => [{ t: 0, dur: 5, freqs: triad(keyPc), idx: 0, gain: 0.3 }];

  // ---------- pump: derived ----------
  const pumpChords = useMemo(() => (pure ? commaPump(cycles) : equalPump(cycles)), [pure, cycles]);
  const eqRef = useMemo(() => equalPump(cycles), [cycles]);
  const drift = pumpChords.map((c, i) => cents(c.root / eqRef[i].root));
  const pumpEvs = (): Ev[] => {
    const evs: Ev[] = pumpChords.map((c, i) => ({ t: i * 1.15, dur: 1.05, freqs: pumpVoicing(c, pure), idx: i, gain: 0.3 }));
    // then the opening chord again, at its original pitch, for comparison
    const t = pumpChords.length * 1.15 + 0.5;
    evs.push({ t, dur: 2, freqs: pumpVoicing(pumpChords[0], pure), idx: pumpChords.length, gain: 0.3 });
    return evs;
  };

  // ---------- edo: derived ----------
  const approx = TARGETS.map((tg) => ({ ...tg, ...edoApprox(edo, tg.ratio) }));
  const edoScale = (): Ev[] => {
    const dt = Math.min(0.3, 5 / edo);
    return Array.from({ length: edo + 1 }, (_, k) => ({ t: k * dt, dur: dt * 0.92, freqs: [C4 * 2 ** (k / edo)], idx: k }));
  };
  const triadEvs = (third: number, fifth: number): Ev[] => {
    const f = [C4, C4 * 2 ** (third / 1200), C4 * 2 ** (fifth / 1200)];
    return [
      { t: 0, dur: 0.5, freqs: [f[0]], idx: -1 },
      { t: 0.55, dur: 0.5, freqs: [f[1]], idx: -1 },
      { t: 1.1, dur: 0.5, freqs: [f[2]], idx: -1 },
      { t: 1.75, dur: 3.2, freqs: [C4 / 2, ...f], idx: -1, gain: 0.3 },
    ];
  };

  const title =
    props.title ??
    (lab === 'fifths'
      ? 'A scale from stacked fifths'
      : lab === 'keys'
        ? 'One keyboard, every key'
        : lab === 'pump'
          ? 'Pure chords drift'
          : 'Dividing the octave equally');

  const caption =
    lab === 'fifths' ? (
      <>
        Each new note is a pure 3:2 fifth above the last, folded back into one octave. Notes sit around the circle at
        their true size in cents (a full turn is an octave). Each new note is drawn a little further out, so the
        13th, which should be C again, shows where it really lands. The strip below shows the scale's steps,
        colored by size.
      </>
    ) : lab === 'keys' ? (
      <>
        A keyboard has only twelve pitches per octave, tuned once. The bars show how far each fifth and each major
        third on that keyboard is from pure (3:2 and 5:4), in cents, in circle-of-fifths order. Red marks an interval
        bad enough to howl. Outlined columns are the chords you're about to hear. {TUNINGS[tuning].blurb}
      </>
    ) : lab === 'pump' ? (
      <>
        Every chord is tuned pure, and each note shared with the previous chord stays exactly where it was (as a
        choir would). The dots show each chord's root against an equal-tempered keyboard (the 0 line). With pure
        tuning, each trip round lands a syntonic comma ({SYNTONIC_COMMA.toFixed(1)}¢) lower. At the end you hear the
        opening chord again at its original pitch.
      </>
    ) : (
      <>
        The octave divided into {edo} equal steps of {(1200 / edo).toFixed(1)}¢. Colored dots on the circle are the
        pure intervals; the nearest step to each is joined to it. The bars show the error of that nearest step in
        cents. Most people start to notice a mistuning somewhere around 5–10¢, so bars inside the shaded band are
        close to pure.
      </>
    );

  return (
    <Widget kicker="Lab" title={title} caption={caption}>
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented label="Lab" value={lab} options={modes.map((m) => ({ value: m, label: LAB_LABELS[m] }))} onChange={switchLab} />
        </div>
      )}

      {lab === 'fifths' && (
        <>
          <div className="w-controls">
            <Slider label="Notes" value={count} min={1} max={13} step={1} onChange={(v) => setCount(v)} display={`${count} (${count - 1} fifths)`} />
          </div>
          <FifthsPlot stack={stack} steps={steps} now={playing ? now : -1} />
          <p className="st-note">{STACK_NOTE[count]}</p>
          <div className="w-readouts">
            <Readout label="Step sizes">
              {steps.sizes.map((s, i) => (
                <span key={i} className={'st-size st-c' + i}>
                  {s.count} × {s.size.toFixed(1)}¢{stepName(s.size) ? ` (${stepName(s.size)})` : ''}
                </span>
              ))}
            </Readout>
          </div>
          <div className="w-controls">
            <PlayButton playing={playing === 'scale'} onClick={() => toggle('scale', fifthsScale)} label={playing === 'scale' ? 'Stop' : 'Play the scale'} />
            <PlayButton playing={playing === 'chain'} onClick={() => toggle('chain', fifthsChain)} label={playing === 'chain' ? 'Stop' : 'Play in stacking order'} />
            {count >= 13 && (
              <PlayButton playing={playing === 'comma'} onClick={() => toggle('comma', commaEvs)} label={playing === 'comma' ? 'Stop' : 'Hear the comma: C, B♯, together'} />
            )}
          </div>
        </>
      )}

      {lab === 'keys' && (
        <>
          <div className="w-controls">
            <Segmented label="Tuning" value={tuning} options={tunings.map((t) => ({ value: t, label: TUNINGS[t].label }))} onChange={setTuning} />
          </div>
          <div className="w-controls">
            <span className="w-label">Key</span>
            <div className="w-chips" role="radiogroup" aria-label="Key">
              {KEY_ORDER.map((pc) => (
                <button key={pc} type="button" role="radio" aria-checked={pc === keyPc} className={'w-chip' + (pc === keyPc ? ' is-on' : '')} onClick={() => setKeyPc(pc)}>
                  {PC_NAMES[pc]}
                </button>
              ))}
            </div>
          </div>
          <KeysPlot fifths={fifthsRing} thirds={thirds} used={prog.slice(0, 3)} />
          <div className="w-table st-table">
            {progChecks.map((c, i) => (
              <div key={i} className={'st-row' + (playing && now === i ? ' is-now' : '') + (c.wolf ? ' is-wolf' : '')}>
                <strong>{['I', 'IV', 'V'][i]} = {c.name}</strong>
                <span>
                  third {c.third.toFixed(1)}¢ <span className="muted">({sign(c.thirdErr)} vs 5:4)</span>
                </span>
                <span>
                  fifth {c.fifth.toFixed(1)}¢ <span className="muted">({sign(c.fifthErr)} vs 3:2)</span>
                </span>
                {c.wolf && <span className="key-rough">howls</span>}
              </div>
            ))}
          </div>
          <div className="w-controls">
            <PlayButton playing={playing === 'prog'} onClick={() => toggle('prog', progEvs)} label={playing === 'prog' ? 'Stop' : `Play I–IV–V–I in ${PC_NAMES[keyPc]}`} />
            <PlayButton playing={playing === 'hold'} onClick={() => toggle('hold', holdEvs)} label={playing === 'hold' ? 'Stop' : `Hold the ${PC_NAMES[keyPc]} chord`} />
          </div>
        </>
      )}

      {lab === 'pump' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Tuning"
              value={pure ? 'pure' : 'equal'}
              options={[
                { value: 'pure', label: 'Every chord pure' },
                { value: 'equal', label: 'Equal temperament' },
              ]}
              onChange={(v) => setPure(v === 'pure')}
            />
            <Segmented label="Trips" value={cycles} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={setCycles} />
          </div>
          <PumpPlot chords={pumpChords.map((c) => c.name)} drift={drift} now={playing ? now : -1} />
          <div className="w-readouts">
            <Readout label="Each trip round">{pure ? `${sign(-SYNTONIC_COMMA)}¢ (81:80)` : '0¢'}</Readout>
            <Readout label={`After ${cycles} trip${cycles > 1 ? 's' : ''}`}>{sign(drift[drift.length - 1])}¢</Readout>
            <Readout label="Thirds">{pure ? 'pure (5:4, 6:5)' : 'major +13.7¢, minor −15.6¢'}</Readout>
          </div>
          <div className="w-controls">
            <PlayButton playing={playing === 'pump'} onClick={() => toggle('pump', pumpEvs)} label={playing === 'pump' ? 'Stop' : 'Play C–Am–Dm–G–C'} />
          </div>
        </>
      )}

      {lab === 'edo' && (
        <>
          <div className="w-controls">
            <Slider label="Steps per octave" value={edo} min={5} max={53} step={1} onChange={(v) => setEdo(v)} display={`${edo}-TET`} />
          </div>
          <div className="w-controls">
            <div className="w-chips">
              {EDO_PRESETS.map((n) => (
                <button key={n} type="button" className={'w-chip' + (n === edo ? ' is-on' : '')} onClick={() => setEdo(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <EdoPlot n={edo} approx={approx} now={playing === 'escale' ? now : -1} />
          <div className="w-controls">
            <PlayButton playing={playing === 'escale'} onClick={() => toggle('escale', edoScale)} label={playing === 'escale' ? 'Stop' : `Play all ${edo} steps`} />
            <PlayButton playing={playing === 'etriad'} onClick={() => toggle('etriad', () => triadEvs(approx[1].size, approx[0].size))} label={playing === 'etriad' ? 'Stop' : `Major triad in ${edo}-TET`} />
            <PlayButton playing={playing === 'jtriad'} onClick={() => toggle('jtriad', () => triadEvs(cents(5 / 4), FIFTH))} label={playing === 'jtriad' ? 'Stop' : 'Pure triad (4:5:6)'} />
          </div>
        </>
      )}
    </Widget>
  );
}

// ---------- plots ----------

function FifthsPlot({ stack, steps, now }: { stack: ReturnType<typeof stackFifths>; steps: ReturnType<typeof scaleSteps>; now: number }) {
  const cx = 260, cy = 158, R0 = 62, DR = 4;
  const pos = (c: number, rad: number) => {
    const a = (c / 1200) * 2 * Math.PI - Math.PI / 2;
    return [r2(cx + rad * Math.cos(a)), r2(cy + rad * Math.sin(a))];
  };
  const pts = stack.map((nt) => pos(nt.cents, R0 + nt.n * DR));
  const sizeIdx = (s: number) => steps.sizes.findIndex((x) => Math.abs(x.size - s) < 0.05);
  const X0 = 30, X1 = 490, SY = 336;
  const sx = (c: number) => r2(X0 + (c / 1200) * (X1 - X0));
  const last = stack.length === 13 ? stack[12] : null;
  return (
    <svg className="w-plot" viewBox="0 0 520 364" role="img" aria-label="Stacked fifths around an octave circle, and the resulting scale steps">
      <circle cx={cx} cy={cy} r={R0 - 8} className="st-ring" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x1, y1] = pos(i * 100, R0 - 14);
        const [x2, y2] = pos(i * 100, R0 - 4);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-grid" />;
      })}
      {pts.slice(1).map(([x, y], i) => (
        <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={x} y2={y} className="stroke-grid st-chain" />
      ))}
      {last && (() => {
        const [ax, ay] = pos(0, R0 + 12 * DR + 18);
        const [bx, by] = pos(last.cents, R0 + 12 * DR + 18);
        const rr = R0 + 12 * DR + 18;
        return (
          <g>
            <path d={`M${ax},${ay} A${rr},${rr} 0 0 1 ${bx},${by}`} className="stroke-rough thick" />
            <text x={r2(bx + 8)} y={r2(by - 8)} className="w-tick key-rough">comma {PYTHAGOREAN_COMMA.toFixed(1)}¢</text>
          </g>
        );
      })()}
      {stack.map((nt, i) => {
        const [x, y] = pts[i];
        const [lx, ly] = pos(nt.cents, R0 + nt.n * DR + 13);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={nt.n === now ? 7 : 5} className={nt.n === 12 ? 'tone-b' : 'tone-a'} />
            <text x={lx} y={r2(ly + 4)} textAnchor="middle" className="w-tick st-name">
              {nt.name}
            </text>
          </g>
        );
      })}
      {/* the scale as an octave strip */}
      <text x={X0} y={SY - 26} className="w-tick">The scale, C to C (one octave = 1200¢)</text>
      {steps.sorted.map((nt, i) => {
        const a = nt.cents, b = a + steps.steps[i];
        const k = sizeIdx(steps.steps[i]);
        return (
          <g key={i}>
            <rect x={sx(a)} y={SY - 12} width={Math.max(1, r2(sx(b) - sx(a)))} height={12} className={'st-seg st-c' + k} />
            {sx(b) - sx(a) > 26 && (
              <text x={r2((sx(a) + sx(b)) / 2)} y={SY + 14} textAnchor="middle" className="w-tick">
                {Math.round(steps.steps[i])}
              </text>
            )}
          </g>
        );
      })}
      {steps.sorted.map((nt, i) => (
        <line key={'t' + i} x1={sx(nt.cents)} x2={sx(nt.cents)} y1={SY - 18} y2={SY + 2} className="stroke-ink" />
      ))}
      <line x1={X1} x2={X1} y1={SY - 18} y2={SY + 2} className="stroke-ink" />
    </svg>
  );
}

function KeysPlot({ fifths, thirds, used }: { fifths: ReturnType<typeof circleFifths>; thirds: ReturnType<typeof checkTriad>[]; used: number[] }) {
  const X0 = 64, W = 36, Y5 = 70, Y3 = 190, K = 1.6; // px per cent
  const usedIdx = used.map((pc) => KEY_ORDER.indexOf(pc));
  return (
    <svg className="w-plot" viewBox="0 0 520 262" role="img" aria-label="Deviation from pure of every fifth and major third on the keyboard">
      {usedIdx.map((i, k) => (
        <rect key={k} x={X0 + i * W + 2} y={8} width={W - 4} height={244} rx={5} className="st-used" />
      ))}
      <text x={8} y={Y5 - 44} className="w-tick">Fifths</text>
      <text x={8} y={Y5 + 4} className="w-tick">pure</text>
      <text x={8} y={Y3 - 44} className="w-tick">Major thirds</text>
      <text x={8} y={Y3 + 4} className="w-tick">pure</text>
      <line x1={X0} x2={X0 + 12 * W} y1={Y5} y2={Y5} className="stroke-ink thin" />
      <line x1={X0} x2={X0 + 12 * W} y1={Y3} y2={Y3} className="stroke-ink thin" />
      {fifths.map((f, i) => {
        const e = f.size - FIFTH;
        const h = Math.max(-40, Math.min(40, e)) * K;
        const bad = Math.abs(e) > 12;
        return (
          <g key={i}>
            <rect x={X0 + i * W + 9} y={r2(h > 0 ? Y5 - h : Y5)} width={W - 18} height={Math.max(1, r2(Math.abs(h)))} className={bad ? 'st-bar is-bad' : 'st-bar'} />
            <text x={X0 + i * W + W / 2} y={r2(h > 0 ? Y5 - h - 4 : Y5 - h + 12)} textAnchor="middle" className={'w-tick' + (bad ? ' key-rough' : '')}>
              {Math.abs(e) < 0.05 ? '0' : sign(e, Math.abs(e) < 10 ? 1 : 0)}
            </text>
            <text x={X0 + i * W + W / 2} y={Y5 + 42} textAnchor="middle" className="w-tick">
              {f.from}–{f.to}
            </text>
          </g>
        );
      })}
      {thirds.map((t, i) => {
        const e = t.thirdErr;
        const h = Math.max(-40, Math.min(46, e)) * K;
        const bad = Math.abs(e) > 30;
        return (
          <g key={i}>
            <rect x={X0 + i * W + 9} y={r2(h > 0 ? Y3 - h : Y3)} width={W - 18} height={Math.max(1, r2(Math.abs(h)))} className={bad ? 'st-bar is-bad' : 'st-bar is-third'} />
            <text x={X0 + i * W + W / 2} y={r2(h > 0 ? Y3 - h - 4 : Y3 - h + 12)} textAnchor="middle" className={'w-tick' + (bad ? ' key-rough' : '')}>
              {Math.abs(e) < 0.05 ? '0' : sign(e, Math.abs(e) < 10 ? 1 : 0)}
            </text>
            <text x={X0 + i * W + W / 2} y={Y3 + 58} textAnchor="middle" className="w-tick">
              {PC_NAMES[KEY_ORDER[i]]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PumpPlot({ chords, drift, now }: { chords: string[]; drift: number[]; now: number }) {
  const X0 = 50, X1 = 500, Y0 = 30, Y1 = 200, MIN = -90, MAX = 20;
  const x = (i: number) => r2(X0 + (i / Math.max(1, chords.length - 1)) * (X1 - X0));
  const y = (c: number) => r2(Y0 + ((MAX - c) / (MAX - MIN)) * (Y1 - Y0));
  const path = drift.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d)}`).join(' ');
  return (
    <svg className="w-plot" viewBox="0 0 520 236" role="img" aria-label="Pitch drift of each chord's root against an equal-tempered keyboard">
      {[0, -20, -40, -60, -80].map((c) => (
        <g key={c}>
          <line x1={X0} x2={X1} y1={y(c)} y2={y(c)} className={c === 0 ? 'stroke-ink thin' : 'stroke-grid'} />
          <text x={X0 - 6} y={y(c) + 4} textAnchor="end" className="w-tick">
            {c}¢
          </text>
        </g>
      ))}
      <text x={X1} y={y(0) - 6} textAnchor="end" className="w-tick">equal-tempered keyboard</text>
      <path d={path} className="stroke-a" />
      {drift.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d)} r={i === now ? 7 : 4.5} className={chords[i] === 'C' ? 'tone-b' : 'tone-a'} />
          <text x={x(i)} y={Y1 + 24} textAnchor="middle" className="w-tick">
            {chords[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

const TARGET_CLASS = ['st-t0', 'st-t1', 'st-t2', 'st-t3'];

function EdoPlot({ n, approx, now }: { n: number; approx: (ReturnType<typeof edoApprox> & { label: string; ratio: number })[]; now: number }) {
  const cx = 112, cy = 125, R = 92;
  const pos = (c: number, rad: number) => {
    const a = (c / 1200) * 2 * Math.PI - Math.PI / 2;
    return [r2(cx + rad * Math.cos(a)), r2(cy + rad * Math.sin(a))];
  };
  const BX0 = 330, BX1 = 500, BMID = (BX0 + BX1) / 2, K = (BX1 - BX0) / 2 / 50;
  return (
    <svg className="w-plot" viewBox="0 0 520 250" role="img" aria-label={`The octave divided into ${n} equal steps, and how close they come to pure intervals`}>
      <circle cx={cx} cy={cy} r={R} className="st-ring" />
      {Array.from({ length: n }, (_, k) => {
        const [x1, y1] = pos((k * 1200) / n, R - 7);
        const [x2, y2] = pos((k * 1200) / n, R + 7);
        return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} className={k === now ? 'stroke-rough thick' : 'stroke-ink'} />;
      })}
      {approx.map((a, i) => {
        const [jx, jy] = pos(cents(a.ratio), R - 22);
        const [sx, sy] = pos(a.size, R - 7);
        return (
          <g key={i}>
            <line x1={jx} y1={jy} x2={sx} y2={sy} className={'st-link ' + TARGET_CLASS[i]} />
            <circle cx={jx} cy={jy} r={5} className={'st-dot ' + TARGET_CLASS[i]} />
          </g>
        );
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" className="w-tick">
        {n} steps of {(1200 / n).toFixed(1)}¢
      </text>
      {/* error bars */}
      <rect x={r2(BMID - 7 * K)} y={22} width={r2(14 * K)} height={200} className="fill-band" />
      <line x1={BMID} x2={BMID} y1={22} y2={222} className="stroke-ink thin" />
      <text x={BX0} y={240} textAnchor="middle" className="w-tick">−50¢</text>
      <text x={BMID} y={240} textAnchor="middle" className="w-tick">pure</text>
      <text x={BX1} y={240} textAnchor="middle" className="w-tick">+50¢</text>
      {approx.map((a, i) => {
        const y = 46 + i * 50;
        const e = Math.max(-50, Math.min(50, a.err));
        return (
          <g key={i}>
            <text x={BX0 - 70} y={y - 6} className={'w-tick st-lbl ' + TARGET_CLASS[i]}>
              {a.label}
            </text>
            <text x={BX0 - 70} y={y + 9} className="w-tick">
              step {a.step}: {sign(a.err)}¢
            </text>
            <rect x={r2(e < 0 ? BMID + e * K : BMID)} y={y - 7} width={Math.max(1.5, r2(Math.abs(e) * K))} height={14} className={'st-ebar ' + TARGET_CLASS[i]} />
          </g>
        );
      })}
    </svg>
  );
}
