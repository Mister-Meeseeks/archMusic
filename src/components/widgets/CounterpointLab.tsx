// Counterpoint lab. Three modes:
// - "round":   one tune in 1–4 staggered voices. Choose the tune, the number
//              of voices, and how many bars apart they enter; mute voices;
//              same or different timbres. The plot marks every moment where
//              the voices clash (a second, seventh, or tritone), computed from
//              the notes you hear.
// - "species": first-species counterpoint against Fux's cantus firmus. Pick a
//              preset or click to write your own upper line; the plot labels
//              the interval at each note and the motion between notes, and
//              lists the rule violations, from the same analysis.
// - "count":   how many voices can you hear? A random texture of 1–5 lines,
//              all in one timbre (as in Huron's 1989 experiment); guess, then
//              reveal it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TUNES } from '../../lib/melodies';
import { BAR_EIGHTHS, CANTUS, SPECIES_PRESETS, analyze, clashes, makeTexture, roundVoices, snapWhite, type Motion, type Placed } from '../../lib/counterpoint';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'round' | 'species' | 'count';
const MODE_LABEL: Record<Mode, string> = { round: 'Rounds', species: 'Two voices', count: 'How many voices?' };
const VOICE_NAMES = ['Voice 1', 'Voice 2', 'Voice 3', 'Voice 4', 'Voice 5'];

/** Per-voice timbres: distinct harmonic recipes, or one shared organ-like tone. */
function voiceWave(ctx: AudioContext, v: number, different: boolean): PeriodicWave | OscillatorType {
  if (!different) return harmonicWave(ctx, 8, 1.4);
  return [harmonicWave(ctx, 8, 1.4), 'triangle', harmonicWave(ctx, 14, 0.9), harmonicWave(ctx, 3, 2.5)][v % 4] as PeriodicWave | OscillatorType;
}
const VOICE_GAIN = [0.16, 0.24, 0.1, 0.2];

export default function CounterpointLab(props: { initialMode?: Mode; modes?: Mode[]; tune?: string; tunes?: string[] }) {
  const modes = props.modes ?? (['round', 'species', 'count'] as Mode[]);
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);

  // shared playback
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<number | null>(null); // playhead, in eighths
  const run = useRef<Run | null>(null);
  const gains = useRef<GainNode[]>([]);
  const raf = useRef(0);
  const timer = useRef(0);

  // round state
  const tuneIds = props.tunes ?? ['frere', 'row', 'mary', 'ode'];
  const [tuneId, setTuneId] = useState(props.tune ?? tuneIds[0]);
  const [voices, setVoices] = useState(4);
  const [delayBars, setDelayBars] = useState(2);
  const [different, setDifferent] = useState(true);
  const [muted, setMuted] = useState<boolean[]>([false, false, false, false, false]);

  // species state
  const [preset, setPreset] = useState('good');
  const [cp, setCp] = useState<number[]>(SPECIES_PRESETS[0].cp);

  // count state
  const [seed, setSeed] = useState(7);
  const [count, setCount] = useState(3);
  const [guess, setGuess] = useState<number | null>(null);
  const [tally, setTally] = useState<{ n: number; ok: boolean }[]>([]);

  const stop = useCallback(() => {
    run.current?.stop(0.1);
    run.current = null;
    cancelAnimationFrame(raf.current);
    window.clearTimeout(timer.current);
    gains.current = [];
    setPlaying(false);
    setPos(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, tuneId, voices, delayBars, different, preset, seed, stop]);

  // live mute
  useEffect(() => {
    gains.current.forEach((g, v) => g.gain.setTargetAtTime(muted[v] ? 0 : 1, g.context.currentTime, 0.02));
  }, [muted]);

  const tune = TUNES.find((t) => t.id === tuneId) ?? TUNES[0];
  const bar = BAR_EIGHTHS[tune.id] ?? 8;
  const round = useMemo(() => roundVoices(tune, voices, delayBars * bar), [tune, voices, delayBars, bar]);
  const roundClash = useMemo(() => clashes(round.notes, round.total, (v) => !muted[v]), [round, muted]);

  const cantusNotes: Placed[] = useMemo(() => CANTUS.map((m, i) => ({ m, t: i * 4, d: 4, v: 1 })), []);
  const cpNotes: Placed[] = useMemo(() => cp.map((m, i) => ({ m, t: i * 4, d: 4, v: 0 })), [cp]);
  const species = useMemo(() => analyze(CANTUS, cp), [cp]);

  const texture = useMemo(() => makeTexture(count, seed), [count, seed]);

  const playNotes = (notes: Placed[], total: number, eighth: number, nVoices: number, diff: boolean) => {
    if (playing) return stop();
    const r = startRun(0.12);
    run.current = r;
    gains.current = Array.from({ length: nVoices }, (_, v) => {
      const g = r.ctx.createGain();
      g.gain.value = muted[v] ? 0 : 1;
      g.connect(r.bus);
      return g;
    });
    const level = nVoices >= 4 ? 0.7 : 1;
    for (const p of notes)
      note(r, {
        f: midiToHz(p.m),
        t: r.t0 + p.t * eighth,
        dur: p.d * eighth * 0.88,
        gain: (diff ? VOICE_GAIN[p.v % 4] : 0.15) * level,
        attack: 0.015,
        release: 0.12,
        wave: voiceWave(r.ctx, p.v, diff),
        dest: gains.current[p.v],
      });
    const tick = () => {
      if (!run.current) return;
      setPos((r.ctx.currentTime - r.t0) / eighth);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    timer.current = window.setTimeout(stop, ((r.t0 - r.ctx.currentTime) + total * eighth + 0.4) * 1000);
    setPlaying(true);
  };

  const play = () => {
    if (mode === 'round') playNotes(round.notes, round.total, 30 / (tune.bpm ?? 132), voices, different);
    else if (mode === 'species') playNotes([...cpNotes, ...cantusNotes], CANTUS.length * 4, 0.24, 2, true);
    else playNotes(texture, 32, 0.3, count, false);
  };

  const toggleMute = (v: number) => setMuted((m) => m.map((x, i) => (i === v ? !x : x)));
  const setNote = (i: number, m: number) => {
    setPreset('custom');
    setCp((c) => c.map((x, k) => (k === i ? m : x)));
  };
  const newTexture = () => {
    setCount(1 + Math.floor(Math.random() * 5));
    setSeed(Math.floor(Math.random() * 1e6));
    setGuess(null);
  };
  const answer = (n: number) => {
    if (guess !== null) return;
    setGuess(n);
    setTally((t) => [...t, { n: count, ok: n === count }]);
  };

  const title =
    mode === 'round' ? 'One tune against itself' : mode === 'species' ? 'Two voices, note against note' : 'How many voices can you hear?';

  return (
    <Widget kicker="Lab" title={title} caption={<Caption mode={mode} />}>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        {modes.length > 1 && (
          <Segmented label="Lab" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
        )}
      </div>

      {mode === 'round' && (
        <>
          <div className="w-controls">
            <Segmented label="Tune" value={tuneId} options={tuneIds.map((id) => ({ value: id, label: TUNES.find((t) => t.id === id)?.name ?? id }))} onChange={setTuneId} />
          </div>
          <div className="w-controls">
            <Segmented label="Voices" value={voices} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={setVoices} />
            <Segmented label="Each enters after" value={delayBars} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} bar${n > 1 ? 's' : ''}` }))} onChange={setDelayBars} />
            <button type="button" className={'w-chip' + (different ? ' is-on' : '')} onClick={() => setDifferent((d) => !d)}>
              Different timbres
            </button>
          </div>
          <MuteRow n={voices} muted={muted} onToggle={toggleMute} />
          <Roll notes={round.notes} total={round.total} pos={pos} muted={muted} bar={bar} clash={roundClash} />
          <div className="w-controls">
            <Readout label="Clashing">{voices > 1 ? `${Math.round(roundClash.frac * 100)}% of the time` : '—'}</Readout>
            <Readout label="Tune length">{Math.round(tune.notes.reduce((s, [, d]) => s + d, 0) / bar)} bars</Readout>
          </div>
        </>
      )}

      {mode === 'species' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Upper voice"
              value={preset}
              options={[...SPECIES_PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(preset === 'custom' ? [{ value: 'custom', label: 'Yours' }] : [])]}
              onChange={(id) => {
                const p = SPECIES_PRESETS.find((x) => x.id === id);
                if (p) {
                  setPreset(id);
                  setCp(p.cp);
                }
              }}
            />
          </div>
          <MuteRow n={2} names={['Upper voice', 'Cantus firmus']} muted={muted} onToggle={toggleMute} />
          <SpeciesPlot cp={cp} a={species} pos={pos} onSet={setNote} />
          <div className="w-controls">
            <Readout label="Contrary motion">
              {species.stats.contrary} of {species.stats.moving} moves
            </Readout>
            <Readout label="Parallel fifths/octaves">{species.stats.parallels}</Readout>
            <Readout label="Dissonances">{species.stats.dissonances}</Readout>
          </div>
          <p className="w-note">{SPECIES_PRESETS.find((p) => p.id === preset)?.blurb ?? 'Your line. Click in any column to move the upper note there.'}</p>
          {species.flags.length > 0 && (
            <ul className="cp-flags">
              {species.flags.slice(0, 6).map((f, i) => (
                <li key={i} className={f.kind === 'error' ? 'is-error' : ''}>
                  {f.text}
                </li>
              ))}
              {species.flags.length > 6 && <li>…and {species.flags.length - 6} more.</li>}
            </ul>
          )}
        </>
      )}

      {mode === 'count' && (
        <>
          <div className="w-controls">
            <button type="button" className="w-chip" onClick={newTexture}>
              New texture
            </button>
            <div className="w-seg" role="group" aria-label="Your answer">
              <span className="w-label">Voices heard</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={guess === n ? 'is-on' : ''} onClick={() => answer(n)} disabled={guess !== null && guess !== n}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {guess === null ? (
            <div className="cp-hidden">Play it (as often as you like), then answer. The notes appear after you answer.</div>
          ) : (
            <>
              <Roll notes={texture} total={32} pos={pos} muted={[]} bar={8} />
              <p className="w-note">
                {guess === count ? 'Right: ' : `Not quite: you said ${guess}, and there were `}
                <strong>
                  {count} voice{count > 1 ? 's' : ''}
                </strong>
                . Play it again and try to follow each one.
              </p>
            </>
          )}
          <Tally tally={tally} />
        </>
      )}
    </Widget>
  );
}

function Caption({ mode }: { mode: Mode }) {
  if (mode === 'round')
    return (
      <>
        Each color is one voice singing the same tune, entering later than the one before. Time runs left to right, pitch
        upward. The red marks under the plot show every moment where two sounding notes clash (a second, a seventh, or a
        tritone apart), computed from exactly what you hear; muted voices don't count.
      </>
    );
  if (mode === 'species')
    return (
      <>
        Bottom (orange): the cantus firmus Fux uses in his first lesson. Top (blue): a counterpoint, one note against each
        note. The number between them is the interval (3 = third, 5 = fifth, 8 = octave, 10 = tenth); green numbers are
        imperfect consonances, gold are perfect consonances, red are dissonances. Letters underneath name the motion from
        each note to the next: <strong>C</strong>ontrary, <strong>O</strong>blique, <strong>S</strong>imilar,{' '}
        <strong>P</strong>arallel. Click anywhere in a column to move the upper voice's note there (white keys only).
      </>
    );
  return (
    <>
      Between one and five lines, all in the same organ-like timbre, four bars long. Each line keeps to its own register and
      its own rhythm, and they never clash, so the only question is how many you can pull apart. Your record is kept below
      (it resets when you leave the page).
    </>
  );
}

function MuteRow({ n, muted, onToggle, names }: { n: number; muted: boolean[]; onToggle: (v: number) => void; names?: string[] }) {
  return (
    <div className="w-controls">
      <span className="w-label">Hear</span>
      <div className="w-chips">
        {Array.from({ length: n }, (_, v) => (
          <button key={v} type="button" className={'w-chip cp-voice-chip' + (muted[v] ? '' : ' is-on')} onClick={() => onToggle(v)}>
            <span className={`cp-dot cp-v${v}`} aria-hidden />
            {(names ?? VOICE_NAMES)[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Roll(props: { notes: Placed[]; total: number; pos: number | null; muted: boolean[]; bar: number; clash?: { flags: boolean[]; step: number } }) {
  const { notes, total, pos, muted, bar, clash } = props;
  const W = 680;
  const H = 200;
  const ms = notes.map((n) => n.m);
  const nv = Math.max(1, ...notes.map((n) => n.v + 1)); // same-pitch voices are nudged apart slightly
  const lo = Math.min(...ms) - 2;
  const hi = Math.max(...ms) + 2;
  const x = scale(0, total, 36, W - 8);
  const y = scale(lo, hi, H - 26, 8);
  const cs: number[] = [];
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) cs.push(m);
  const bars: number[] = [];
  for (let b = 0; b <= total; b += bar) bars.push(b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Piano roll of all voices, with clashes marked">
      {bars.map((b) => (
        <line key={'b' + b} x1={x(b)} x2={x(b)} y1={8} y2={H - 26} className="stroke-grid" />
      ))}
      {cs.map((m) => (
        <g key={m}>
          <line x1={36} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={30} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {notes.map((n, i) => (
        <rect
          key={i}
          x={x(n.t)}
          y={r2(y(n.m) - 2.5 + (n.v - (nv - 1) / 2) * 2.2)}
          width={r2(Math.max(2, x(n.t + n.d) - x(n.t) - 1.5))}
          height={5}
          rx={2}
          className={`cp-note cp-f${n.v}` + (muted[n.v] ? ' is-muted' : '') + (pos !== null && pos >= n.t && pos < n.t + n.d ? ' is-now' : '')}
        />
      ))}
      {clash &&
        clash.flags.map((f, i) =>
          f ? <rect key={'c' + i} x={x(i * clash.step)} y={H - 20} width={r2(x(clash.step) - x(0) + 0.3)} height={8} className="cp-clash" /> : null,
        )}
      {clash && (
        <text x={30} y={H - 12} textAnchor="end" className="w-tick">
          clash
        </text>
      )}
      {pos !== null && pos >= 0 && pos <= total && <line x1={x(pos)} x2={x(pos)} y1={4} y2={H - 10} className="cp-playhead" />}
    </svg>
  );
}

const MOTION_LETTER: Record<Motion, string> = { contrary: 'C', oblique: 'O', similar: 'S', parallel: 'P', static: '–' };

function SpeciesPlot({ cp, a, pos, onSet }: { cp: number[]; a: ReturnType<typeof analyze>; pos: number | null; onSet: (i: number, m: number) => void }) {
  const W = 680;
  const H = 250;
  const n = CANTUS.length;
  const lo = 55;
  const hi = 81;
  const colW = (W - 50) / n;
  const cx = (i: number) => r2(44 + colW * i + colW / 2);
  const y = scale(lo, hi, H - 40, 10);
  const yInv = (py: number) => lo + ((H - 40 - py) / (H - 40 - 10)) * (hi - lo);
  const svgRef = useRef<SVGSVGElement>(null);
  const now = pos === null ? -1 : Math.floor(pos / 4);
  const click = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const b = svg.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    const py = ((e.clientY - b.top) / b.height) * H;
    const i = Math.floor((px - 44) / colW);
    if (i < 0 || i >= n) return;
    const m = Math.max(57, Math.min(81, snapWhite(yInv(py))));
    onSet(i, m);
  };
  const cs = [60, 72];
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-plot cp-species" role="img" aria-label="Two-voice counterpoint with intervals and motions labeled" onPointerDown={click}>
      {cs.map((m) => (
        <g key={m}>
          <line x1={40} x2={W - 6} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={34} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {a.cols.map((c, i) => (
        <g key={i}>
          <rect x={r2(44 + colW * i + 1)} y={6} width={r2(colW - 2)} height={H - 44} rx={4} className={'cp-col' + (i === now ? ' is-now' : '')} />
          <line x1={cx(i)} x2={cx(i)} y1={y(c.lo)} y2={y(c.hi)} className={`cp-span q-${c.q}`} />
          <rect x={r2(cx(i) - colW * 0.36)} y={r2(y(c.lo) - 4)} width={r2(colW * 0.72)} height={8} rx={2} className="cp-note cp-f1" />
          <rect x={r2(cx(i) - colW * 0.36)} y={r2(y(c.hi) - 4)} width={r2(colW * 0.72)} height={8} rx={2} className="cp-note cp-f0" />
          <text x={cx(i)} y={r2((y(c.lo) + y(c.hi)) / 2 + 4)} textAnchor="middle" className={`cp-num q-${c.q}`}>
            {c.crossed ? '×' : c.num}
          </text>
        </g>
      ))}
      {a.motions.map((m, i) => {
        const bad = m === 'parallel' && a.cols[i + 1].q === 'perfect' && a.cols[i].q === 'perfect';
        return (
          <g key={'m' + i}>
            {bad && (
              <>
                <line x1={cx(i)} x2={cx(i + 1)} y1={y(a.cols[i].hi)} y2={y(a.cols[i + 1].hi)} className="cp-par" />
                <line x1={cx(i)} x2={cx(i + 1)} y1={y(a.cols[i].lo)} y2={y(a.cols[i + 1].lo)} className="cp-par" />
              </>
            )}
            <text x={r2(44 + colW * (i + 1))} y={H - 20} textAnchor="middle" className={'cp-motion' + (bad ? ' is-bad' : '')}>
              {MOTION_LETTER[m]}
            </text>
          </g>
        );
      })}
      <text x={44} y={H - 4} className="w-tick">
        motion between notes: C contrary · O oblique · S similar · P parallel
      </text>
    </svg>
  );
}

function Tally({ tally }: { tally: { n: number; ok: boolean }[] }) {
  if (!tally.length) return null;
  const rows = [1, 2, 3, 4, 5]
    .map((n) => {
      const t = tally.filter((x) => x.n === n);
      return { n, tries: t.length, ok: t.filter((x) => x.ok).length };
    })
    .filter((r) => r.tries);
  return (
    <div className="w-controls">
      <span className="w-label">Your record</span>
      {rows.map((r) => (
        <Readout key={r.n} label={`${r.n} voice${r.n > 1 ? 's' : ''}`}>
          {r.ok}/{r.tries}
        </Readout>
      ))}
    </div>
  );
}
