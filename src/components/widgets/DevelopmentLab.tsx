// Development lab (chapter 5.2). Two modes:
// - "develop": a motif and a chain of operations (repeat, sequence, invert,
//   stretch, squeeze, fragment). Each step is applied to the previous segment,
//   so you can hear a motif being worked over and, with fragmentation, cut down
//   until almost nothing is left (liquidation). The roll draws exactly the notes
//   that play, one color band per segment.
// - "variations": the theme of Mozart's K. 265 (Twinkle) and variations that
//   each change some musical dimensions and keep the rest. The tags show which.
//   The accompaniment is generated from the chord list shown under the roll.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEV_PRESETS,
  DIMENSIONS,
  MOTIFS,
  OPS,
  THEME,
  VARIATIONS,
  develop,
  variationById,
  type Accomp,
  type Op,
  type Variation,
} from '../../lib/development';
import { parseSymbol, QUALITIES } from '../../lib/harmony';
import type { Note } from '../../lib/melodies';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'develop' | 'variations';
const MAX_STEPS = 10;

export default function DevelopmentLab(props: {
  initialMode?: Mode;
  modes?: Mode[];
  preset?: string;
  variation?: string;
  variations?: string[];
}) {
  const modes = props.modes ?? ['develop', 'variations'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  const p0 = DEV_PRESETS.find((p) => p.id === props.preset) ?? DEV_PRESETS[0];
  const [motifId, setMotifId] = useState(p0.motif);
  const [ops, setOps] = useState<Op[]>(p0.ops);
  const [presetId, setPresetId] = useState<string | null>(p0.id);
  const varList = props.variations ? VARIATIONS.filter((v) => props.variations!.includes(v.id)) : VARIATIONS;
  const [varId, setVarId] = useState(props.variation ?? varList[0].id);
  const [themeFirst, setThemeFirst] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<{ seg: number; i: number } | null>(null);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);

  const motif = MOTIFS.find((m) => m.id === motifId) ?? MOTIFS[0];
  const segs = useMemo(() => develop(motif, ops), [motif, ops]);
  const variation = variationById(varId);

  const stop = useCallback(() => {
    run.current?.stop(0.1);
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, motifId, ops, varId, themeFirst, stop]);

  const play = () => {
    if (playing || run.current) return stop();
    const r = startRun(0.1);
    run.current = r;
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    const wave = harmonicWave(r.ctx, 8, 1.5);
    let endU = 0;
    if (mode === 'develop') {
      const eighth = 30 / motif.bpm;
      let u = 0;
      segs.forEach((s, si) => {
        s.notes.forEach(([m, d], i) => {
          const t = r.t0 + u * eighth;
          if (m) note(r, { f: midiToHz(m), t, dur: d * eighth * 0.85, gain: 0.2, attack: 0.008, release: 0.1, wave });
          timers.current.push(window.setTimeout(() => setNow({ seg: si, i }), lead + u * eighth * 1000));
          u += d;
        });
        u += 1; // a breath between segments
      });
      endU = u * eighth;
    } else {
      const queue: Variation[] = themeFirst && variation.id !== 'theme' ? [VARIATIONS[0], variation] : [variation];
      let tSec = 0;
      queue.forEach((v, qi) => {
        const eighth = 30 / (112 * v.tempo);
        const start = r.t0 + tSec;
        scheduleVariation(r, v, start, eighth, wave);
        let u = 0;
        v.melody.forEach(([, d], i) => {
          timers.current.push(window.setTimeout(() => setNow({ seg: qi, i }), lead + (tSec + u * eighth) * 1000));
          u += d;
        });
        tSec += u * eighth + 0.6;
      });
      endU = tSec;
    }
    timers.current.push(window.setTimeout(() => stop(), lead + (endU + 0.4) * 1000));
    setPlaying(true);
  };

  const addOp = (op: Op) => {
    if (ops.length >= MAX_STEPS) return;
    setOps([...ops, op]);
    setPresetId(null);
  };
  const choosePreset = (id: string) => {
    const p = DEV_PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setMotifId(p.motif);
    setOps(p.ops);
  };

  const preset = DEV_PRESETS.find((p) => p.id === presetId);
  const counts = segs.map((s) => s.notes.filter(([m]) => m > 0).length);
  // which variation is sounding (when the theme plays first, segment 0 is the theme)
  const showingTheme = themeFirst && now?.seg === 0 && variation.id !== 'theme';
  const shownVar = showingTheme ? VARIATIONS[0] : variation;

  return (
    <Widget
      kicker="Lab"
      title={mode === 'develop' ? 'Working over a motif' : 'Theme and variations'}
      caption={
        mode === 'develop' ? (
          <>
            Each step takes the <em>previous</em> segment and changes it, the way a composer spins a passage out of a
            motif. Notes are bars (time across, pitch up); each colored band is one segment, labeled with what was done
            to it. Sequences and inversions move by steps of the motif's own scale, so they stay in key. The numbers
            under the bands count the notes left in each segment.
          </>
        ) : (
          <>
            The theme Mozart used for his variations K. 265, known in English as Twinkle, Twinkle. Each variation
            changes some things and keeps others; the tags show which. The faint bars are the theme, for comparison;
            the chord symbols underneath are the harmony the accompaniment plays.
          </>
        )
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        {modes.length > 1 && (
          <Segmented
            label="Lab"
            value={mode}
            options={[
              { value: 'develop', label: 'Develop a motif' },
              { value: 'variations', label: 'Variations' },
            ].filter((o) => modes.includes(o.value as Mode)) as { value: Mode; label: string }[]}
            onChange={setMode}
          />
        )}
      </div>

      {mode === 'develop' ? (
        <>
          <div className="w-controls">
            <Segmented label="Example" value={presetId ?? ''} options={DEV_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={choosePreset} />
          </div>
          <div className="w-controls">
            <Segmented
              label="Motif"
              value={motifId}
              options={MOTIFS.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(v) => {
                setMotifId(v);
                setPresetId(null);
              }}
            />
          </div>
          <div className="w-controls dev-ops">
            <span className="w-label">Then</span>
            <div className="w-chips">
              {OPS.map((o) => (
                <button key={o.id} type="button" className="w-chip" title={o.blurb} disabled={ops.length >= MAX_STEPS} onClick={() => addOp(o.id)}>
                  + {o.label}
                </button>
              ))}
              <button type="button" className="w-chip" disabled={!ops.length} onClick={() => { setOps(ops.slice(0, -1)); setPresetId(null); }}>
                Undo
              </button>
              <button type="button" className="w-chip" disabled={!ops.length} onClick={() => { setOps([]); setPresetId(null); }}>
                Clear
              </button>
            </div>
          </div>
          <DevRoll segs={segs} counts={counts} now={now} />
          <p className="w-note">{preset ? preset.blurb : motif.blurb}</p>
          <div className="w-controls">
            <Readout label="Segments">{segs.length}</Readout>
            <Readout label="Notes per segment">
              <span className="w-mono">{counts.join(' → ')}</span>
            </Readout>
          </div>
        </>
      ) : (
        <>
          <div className="w-controls">
            <Segmented label="Play" value={varId} options={varList.map((v) => ({ value: v.id, label: v.label }))} onChange={setVarId} />
            {variation.id !== 'theme' && (
              <button type="button" className={'w-chip' + (themeFirst ? ' is-on' : '')} aria-pressed={themeFirst} onClick={() => setThemeFirst(!themeFirst)}>
                Theme first
              </button>
            )}
          </div>
          <VarRoll v={shownVar} now={now ? now.i : null} ghost={shownVar.id !== 'theme'} />
          <div className="dev-tags" aria-label="What this variation changes">
            {DIMENSIONS.map((d) => {
              const changed = shownVar.changed.includes(d.id);
              return (
                <span key={d.id} className={'dev-tag' + (changed ? ' is-changed' : '')}>
                  {d.label}: {changed ? 'changed' : 'kept'}
                </span>
              );
            })}
          </div>
          <p className="w-note">
            {showingTheme ? 'Now: the theme. The variation follows.' : variation.blurb}
          </p>
        </>
      )}
    </Widget>
  );
}

// ---------- audio for the variations ----------

function chordTones(sym: string) {
  const c = parseSymbol(sym);
  return { rootPc: c.rootPc, semis: QUALITIES[c.q].semis };
}

function scheduleVariation(r: Run, v: Variation, start: number, eighth: number, wave: PeriodicWave) {
  // melody
  let u = 0;
  const lowMelody = v.melody.some(([m]) => m && m < 50);
  for (const [m, d] of v.melody) {
    if (m) note(r, { f: midiToHz(m), t: start + u * eighth, dur: d * eighth * 0.85, gain: lowMelody ? 0.26 : 0.19, attack: 0.008, release: 0.12, wave });
    u += d;
  }
  // accompaniment: one chord per half bar (4 eighths)
  v.chords.forEach((sym, k) => {
    const t0 = start + k * 4 * eighth;
    accompany(r, v.accomp, chordTones(sym), t0, eighth);
  });
}

function accompany(r: Run, style: Accomp, c: { rootPc: number; semis: number[] }, t0: number, eighth: number) {
  const soft = { attack: 0.01, release: 0.18, wave: 'triangle' as OscillatorType };
  const bass = 36 + c.rootPc;
  const mid = c.semis.map((s) => 52 + ((c.rootPc + s - 52) % 12 + 12) % 12).sort((a, b) => a - b); // chord tones E3..D♯4
  if (style === 'block') {
    note(r, { f: midiToHz(bass), t: t0, dur: 3.6 * eighth, gain: 0.12, ...soft });
    mid.forEach((m) => note(r, { f: midiToHz(m), t: t0, dur: 3.6 * eighth, gain: 0.045, ...soft }));
  } else if (style === 'alberti') {
    // low - high - middle - high, the classical "Alberti bass"
    const [a, b, cc] = [mid[0], mid[mid.length - 1], mid[1]];
    [a, b, cc, b].forEach((m, i) => note(r, { f: midiToHz(m), t: t0 + i * eighth, dur: eighth * 0.8, gain: 0.07, ...soft }));
  } else if (style === 'arpeggio') {
    const tones = [bass, ...mid.map((m) => m + 0)];
    tones.slice(0, 4).forEach((m, i) => note(r, { f: midiToHz(m), t: t0 + i * eighth, dur: (4 - i) * eighth * 0.95, gain: i ? 0.05 : 0.11, ...soft }));
  } else {
    // high: repeated chords above a bass-register melody
    const hi = mid.map((m) => m + 12);
    [0, 2].forEach((b) => hi.forEach((m) => note(r, { f: midiToHz(m), t: t0 + b * eighth, dur: eighth * 1.6, gain: 0.04, ...soft })));
  }
}

// ---------- displays ----------

function place(n: Note[], u0 = 0) {
  let u = u0;
  return n.map(([m, d]) => {
    const r = { m, u, d };
    u += d;
    return r;
  });
}

function DevRoll({ segs, counts, now }: { segs: { op: string; notes: Note[] }[]; counts: number[]; now: { seg: number; i: number } | null }) {
  const W = 680;
  const H = 200;
  const GAP = 1;
  const placed: { si: number; notes: ReturnType<typeof place>; u0: number; u1: number }[] = [];
  let u = 0;
  segs.forEach((s, si) => {
    const p = place(s.notes, u);
    const len = s.notes.reduce((a, [, d]) => a + d, 0);
    placed.push({ si, notes: p, u0: u, u1: u + len });
    u += len + GAP;
  });
  const total = Math.max(16, u - GAP);
  const all = segs.flatMap((s) => s.notes.map(([m]) => m)).filter((m) => m > 0);
  const lo = Math.min(...all) - 2;
  const hi = Math.max(...all) + 2;
  const x = scale(0, total, 40, W - 8);
  const y = scale(lo, hi, H - 40, 24);
  const label = (op: string) => (op === 'motif' ? 'Motif' : OPS.find((o) => o.id === op)?.label ?? op);
  const cs: number[] = [];
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) cs.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Piano roll of the developed motif, one band per segment">
      {cs.map((m) => (
        <g key={m}>
          <line x1={40} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={34} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {placed.map((p) => {
        const x0 = x(p.u0) - 2;
        const x1 = x(p.u1) + 1;
        const narrow = x1 - x0 < 46;
        return (
          <g key={p.si}>
            <rect x={x0} y={14} width={r2(x1 - x0)} height={H - 34} rx={5} className={'dev-band' + (p.si % 2 ? ' is-alt' : '') + (now?.seg === p.si ? ' is-now' : '')} />
            <text x={r2((x0 + x1) / 2)} y={H - 8} textAnchor="middle" className="w-tick">
              {counts[p.si]}
            </text>
            {!narrow && (
              <text x={r2(x0 + 4)} y={27} className="w-tick dev-band-label">
                {label(segs[p.si].op)}
              </text>
            )}
            {narrow && (
              <text x={r2((x0 + x1) / 2)} y={27} textAnchor="middle" className="w-tick dev-band-label">
                {label(segs[p.si].op).split(' ')[0].slice(0, 5)}
              </text>
            )}
            {p.notes
              .map((n, i) => ({ ...n, i }))
              .filter((n) => n.m > 0)
              .map((n) => (
                <rect
                  key={n.i}
                  x={x(n.u)}
                  y={r2(y(n.m) - 4)}
                  width={r2(Math.max(2, x(n.u + n.d) - x(n.u) - 2))}
                  height={8}
                  rx={2}
                  className={'note-bar' + (now?.seg === p.si && now.i === n.i ? ' is-now' : '')}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

function VarRoll({ v, now, ghost }: { v: Variation; now: number | null; ghost: boolean }) {
  const W = 680;
  const H = 210;
  const total = 32;
  const notes = place(v.melody);
  const theme = place(THEME);
  const shown = [...v.melody, ...(ghost ? THEME : [])].map(([m]) => m).filter((m) => m > 0);
  const lo = Math.min(...shown) - 2;
  const hi = Math.max(...shown) + 2;
  const x = scale(0, total, 40, W - 8);
  const y = scale(lo, hi, H - 44, 12);
  const cs: number[] = [];
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) cs.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label={`Piano roll of the ${v.label} variation, with its chords`}>
      {cs.map((m) => (
        <g key={m}>
          <line x1={40} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={34} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {[8, 16, 24].map((b) => (
        <line key={b} x1={x(b)} x2={x(b)} y1={8} y2={H - 30} className="stroke-grid" />
      ))}
      {ghost &&
        theme
          .filter((n) => n.m > 0)
          .map((n, k) => <rect key={'g' + k} x={x(n.u)} y={r2(y(n.m) - 3)} width={r2(x(n.u + n.d) - x(n.u) - 2)} height={6} rx={2} className="note-ghost" />)}
      {notes
        .map((n, i) => ({ ...n, i }))
        .filter((n) => n.m > 0)
        .map((n) => (
          <rect
            key={n.i}
            x={x(n.u)}
            y={r2(y(n.m) - 4)}
            width={r2(Math.max(2, x(n.u + n.d) - x(n.u) - 1.5))}
            height={8}
            rx={2}
            className={'note-bar' + (now === n.i ? ' is-now' : '')}
          />
        ))}
      {v.chords.map((c, k) => (
        <text key={k} x={r2(x(k * 4) + 4)} y={H - 12} className={'dev-chord' + (c !== variationById('theme').chords[k] ? ' is-changed' : '')}>
          {c}
        </text>
      ))}
    </svg>
  );
}
