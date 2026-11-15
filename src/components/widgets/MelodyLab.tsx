// Melody lab. Two modes:
// - "transform": pick a tune and a transformation (transpose, same contour,
//   octave-scramble, inversion, retrograde, shuffle, rhythm removed); hear
//   which ones keep the tune recognizable. The plot shows the original
//   (faint) and the transformed notes, with the contour line drawn through
//   them, and the contour as Parsons code (U/D/R).
// - "stats": interval sizes across the little corpus of tunes, and what a
//   melody does after a step versus after a leap. Computed live from the
//   same tunes the transform mode plays.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TRANSFORMS, TUNES, intervalStats, parsons, transform, type Note, type Transform, type Tune } from '../../lib/melodies';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'transform' | 'stats';
const CORPUS = TUNES.filter((t) => t.id !== 'beethoven5');

export default function MelodyLab(props: { initialMode?: Mode; tune?: string; transforms?: Transform[]; tunes?: string[] }) {
  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'transform');
  const tuneList = props.tunes ? TUNES.filter((t) => props.tunes!.includes(t.id)) : TUNES;
  const [tuneId, setTuneId] = useState(props.tune ?? tuneList[0].id);
  const [tf, setTf] = useState<Transform>('original');
  const [mystery, setMystery] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);
  const tfList = props.transforms ? TRANSFORMS.filter((t) => props.transforms!.includes(t.id)) : TRANSFORMS;

  const tune = TUNES.find((t) => t.id === tuneId) ?? TUNES[0];
  const notes = useMemo(() => transform(tune.notes, tf), [tune, tf]);

  const stop = useCallback(() => {
    run.current?.stop(0.1);
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, tuneId, tf, stop]);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 8, 1.5);
    const eighth = 30 / (tune.bpm ?? 120);
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    let u = 0;
    notes.forEach(([m, d], i) => {
      const t = r.t0 + u * eighth;
      if (m) note(r, { f: midiToHz(m), t, dur: d * eighth * 0.85, gain: 0.2, attack: 0.01, release: 0.12, wave });
      timers.current.push(window.setTimeout(() => setNow(i), lead + u * eighth * 1000));
      u += d;
    });
    timers.current.push(window.setTimeout(() => stop(), lead + (u * eighth + 0.3) * 1000));
    setPlaying(true);
  };

  const newMystery = () => {
    const pool = CORPUS.filter((t) => t.id !== tuneId);
    setTuneId(pool[Math.floor(Math.random() * pool.length)].id);
    setMystery(true);
  };

  return (
    <Widget
      kicker="Lab"
      title={mode === 'transform' ? 'What makes a tune the same tune?' : 'Steps, leaps, and what comes next'}
      caption={
        mode === 'transform' ? (
          <>
            Notes are bars: time across, pitch up. The faint bars are the original tune; the solid ones are what you'll
            hear. The line through them is the <strong>contour</strong>, and the letters below spell it out: U for up, D
            for down, R for a repeated note.
          </>
        ) : (
          <>
            Computed from the {CORPUS.length} folk and children's tunes in this lab (the same ones you can play in the
            other mode): {intervalStats(CORPUS).total} melodic intervals in all. Left: how big each move from one note to
            the next is. Right: what the melody does on the following move, after a step and after a leap.
          </>
        )
      }
    >
      <div className="w-controls">
        {mode === 'transform' && <PlayButton playing={playing} onClick={play} />}
        <Segmented
          label="Lab"
          value={mode}
          options={[
            { value: 'transform', label: 'Transform' },
            { value: 'stats', label: 'Statistics' },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === 'transform' ? (
        <>
          <div className="w-controls">
            {mystery ? (
              <>
                <span className="w-label">Tune</span>
                <span className="w-mystery">Mystery tune</span>
                <button type="button" className="w-chip" onClick={() => setMystery(false)}>
                  Reveal
                </button>
                <button type="button" className="w-chip" onClick={newMystery}>
                  Another
                </button>
              </>
            ) : (
              <>
                <Segmented label="Tune" value={tuneId} options={tuneList.map((t) => ({ value: t.id, label: t.name }))} onChange={setTuneId} />
                <button type="button" className="w-chip" onClick={newMystery}>
                  Mystery tune
                </button>
              </>
            )}
          </div>
          <div className="w-controls">
            <Segmented label="Transform" value={tf} options={tfList.map((t) => ({ value: t.id, label: t.label }))} onChange={setTf} />
          </div>
          <Roll original={tune.notes} notes={notes} now={now} showOriginal={tf !== 'original' && !mystery} />
          <div className="w-controls">
            <Readout label="Contour">
              <span className="w-mono">{parsons(notes)}</span>
            </Readout>
          </div>
          <p className="w-note">{TRANSFORMS.find((t) => t.id === tf)?.blurb}</p>
        </>
      ) : (
        <Stats tunes={CORPUS} />
      )}
    </Widget>
  );
}

function Roll({ original, notes, now, showOriginal }: { original: Note[]; notes: Note[]; now: number | null; showOriginal: boolean }) {
  const W = 680;
  const H = 180;
  const len = (n: Note[]) => n.reduce((s, [, d]) => s + d, 0);
  const total = Math.max(len(original), len(notes));
  const all = [...original, ...notes].map(([m]) => m).filter((m) => m > 0);
  const lo = Math.min(...all) - 2;
  const hi = Math.max(...all) + 2;
  const x = scale(0, total, 36, W - 10);
  const y = scale(lo, hi, H - 14, 10);
  const place = (n: Note[]) => {
    let u = 0;
    return n.map(([m, d]) => {
      const r = { m, x0: x(u), x1: x(u + d), u };
      u += d;
      return r;
    });
  };
  const orig = place(original);
  const cur = place(notes);
  const pitchedCur = cur.map((n, i) => ({ ...n, i })).filter((n) => n.m > 0);
  const contour = pitchedCur.map((n, k) => `${k ? 'L' : 'M'}${r2((n.x0 + n.x1) / 2)},${y(n.m)}`).join(' ');
  // C gridlines
  const cs = [];
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) cs.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Piano roll of the melody with its contour">
      {cs.map((m) => (
        <g key={m}>
          <line x1={36} x2={W - 10} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={30} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {showOriginal &&
        orig
          .filter((n) => n.m > 0)
          .map((n, k) => <rect key={'o' + k} x={n.x0} y={r2(y(n.m) - 3)} width={r2(Math.max(2, n.x1 - n.x0 - 2))} height={6} rx={2} className="note-ghost" />)}
      <path d={contour} className="contour-line" />
      {pitchedCur.map((n) => (
        <rect
          key={n.i}
          x={n.x0}
          y={r2(y(n.m) - 4)}
          width={r2(Math.max(2, n.x1 - n.x0 - 2))}
          height={8}
          rx={2}
          className={'note-bar' + (now === n.i ? ' is-now' : '')}
        />
      ))}
    </svg>
  );
}

function Stats({ tunes }: { tunes: Tune[] }) {
  const s = useMemo(() => intervalStats(tunes), [tunes]);
  const W = 680;
  const H = 200;
  const HW = 400;
  const max = Math.max(...s.counts);
  const bx = scale(0, 13, 30, HW - 10);
  const by = scale(0, max, H - 40, 16);
  const bw = bx(1) - bx(0) - 4;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const rows: { label: string; f: { same: number; reverse: number; repeat: number } }[] = [
    { label: 'after a step', f: s.after.step },
    { label: 'after a leap', f: s.after.leap },
  ];
  const fx0 = HW + 30;
  const fx1 = W - 12;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Histogram of interval sizes, and what follows steps and leaps">
        {s.counts.map((c, i) => (
          <g key={i}>
            <rect x={r2(bx(i) + 2)} y={by(c)} width={r2(bw)} height={r2(by(0) - by(c))} className={i === 0 ? 'bar-repeat' : i <= 2 ? 'bar-step' : 'bar-leap'} />
            <text x={r2(bx(i) + 2 + bw / 2)} y={H - 26} textAnchor="middle" className="w-tick">
              {i === 12 ? '12+' : i}
            </text>
            {c > 0 && (
              <text x={r2(bx(i) + 2 + bw / 2)} y={by(c) - 4} textAnchor="middle" className="w-tick">
                {c}
              </text>
            )}
          </g>
        ))}
        <text x={30} y={H - 8} className="w-tick">
          interval size (semitones): 0 = repeated note, 1–2 = step, 3+ = leap
        </text>

        {rows.map((r, k) => {
          const tot = r.f.same + r.f.reverse + r.f.repeat || 1;
          const yy = 40 + k * 66;
          const w = (n: number) => ((fx1 - fx0) * n) / tot;
          return (
            <g key={r.label}>
              <text x={fx0} y={yy - 8} className="w-tick">
                {r.label} ({tot} cases)
              </text>
              <rect x={fx0} y={yy} width={r2(w(r.f.same))} height={22} className="bar-same" />
              <rect x={r2(fx0 + w(r.f.same))} y={yy} width={r2(w(r.f.repeat))} height={22} className="bar-repeat" />
              <rect x={r2(fx0 + w(r.f.same + r.f.repeat))} y={yy} width={r2(w(r.f.reverse))} height={22} className="bar-reverse" />
              <text x={fx0 + 4} y={yy + 36} className="w-tick">
                same way {pct(r.f.same, tot)}% · repeat {pct(r.f.repeat, tot)}% · turn back {pct(r.f.reverse, tot)}%
              </text>
            </g>
          );
        })}
      </svg>
      <div className="w-controls">
        <Readout label="Steps">{pct(s.steps, s.total)}%</Readout>
        <Readout label="Repeated notes">{pct(s.repeats, s.total)}%</Readout>
        <Readout label="Leaps">{pct(s.leaps, s.total)}%</Readout>
      </div>
    </>
  );
}
